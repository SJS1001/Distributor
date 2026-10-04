import { types } from "node:util";
import { canonical, digest, DomainError } from "./core.ts";
import { Database, Store } from "./database.ts";
import { Identity } from "./iam.ts";
import { Billing } from "./billing.ts";
import { IntegrationCheckouts } from "./integration-checkouts.ts";
import { Platform } from "./platform.ts";
import { RestoreOfflineNativePhase } from "./restore-offline-native-phase.ts";
import { RestoreOfflineCheckoutNativeJoin } from "./restore-offline-checkout-native-join.ts";
import { RestoreOfflineCheckoutReferenceJoin } from "./restore-offline-checkout-reference-join.ts";
import {
  compareOfflineCheckoutPaidEvidence,
  offlineCheckoutEvidenceLimits,
  type OfflineCheckoutComparison,
} from "./integration-offline-checkout-evidence.ts";
import {
  parseOfflineTaskEnvelope,
  offlineTaskBinding,
} from "./restore-offline-envelope.ts";
import {
  readRestorePrivateOriginalEvidence,
  type RestoreEvidenceManifest,
} from "./restore-private-evidence.ts";

export const checkoutPrivateTask = Object.freeze({
  owner: "integration",
  name: "integration.checkout-paid.import",
  version: 1,
});
// This fixed profile is smaller than the existing 16,016,384-byte original cap.
export const checkoutPrivateEvidenceBytes = offlineCheckoutEvidenceLimits.bytes;
const nativeReview =
  RestoreOfflineCheckoutNativeJoin.prototype.getInTransaction;
const phaseReview =
  RestoreOfflineNativePhase.prototype.reviewCapturedCheckoutInTransaction;
const referenceReview =
  RestoreOfflineCheckoutReferenceJoin.prototype.getInTransaction;
const readCounter = Store.prototype.get;
const applicationCaptureDomain =
  "distributor-offline-checkout-private-application-capture-v1";
const applicationCaptures = new WeakSet<object>();
/** Process provenance only. No inspection/coercion of untrusted values, including
 * revoked proxies. This is not external qualification or a reusable permission. */
export function isCapturedCheckoutPrivateApplicationCapture(
  value: unknown,
): value is CheckoutPrivateApplicationCapture {
  return (
    value !== null &&
    typeof value === "object" &&
    applicationCaptures.has(value)
  );
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function fail(): never {
  throw new DomainError(
    "RESTORE_OFFLINE_CHECKOUT_PRIVATE",
    "Checkout private evidence capture did not complete.",
  );
}
function need(v: unknown): asserts v {
  if (!v) fail();
}
const wellFormed = (s: string) =>
  !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(
    s,
  );
// Inputs are inert, detached and bounded BEFORE parser/property/hash traversal.
function data(input: unknown, evidence = false): any {
  let nodes = 0,
    bytes = 0;
  const seen = new WeakSet<object>();
  const charge = (s: string, key = false) => {
    const max = key
      ? 64
      : evidence
        ? offlineCheckoutEvidenceLimits.stringBytes
        : 4096;
    need(
      s.length <= max &&
        wellFormed(s) &&
        !s.includes("\0") &&
        !s.includes("\ufffd"),
    );
    const n = Buffer.byteLength(s);
    need(n <= max);
    bytes += n + 8;
    need(bytes <= (evidence ? checkoutPrivateEvidenceBytes : 1024 * 1024));
  };
  const copy = (v: unknown, depth: number): any => {
    need(!types.isProxy(v));
    need(
      ++nodes <= (evidence ? offlineCheckoutEvidenceLimits.nodes : 20000) &&
        depth <= (evidence ? offlineCheckoutEvidenceLimits.depth : 12),
    );
    bytes += 8;
    need(bytes <= (evidence ? checkoutPrivateEvidenceBytes : 1024 * 1024));
    if (typeof v === "string") {
      charge(v);
      return v;
    }
    if (v === null || typeof v === "boolean") return v;
    if (typeof v === "number") {
      need(Number.isSafeInteger(v) && !Object.is(v, -0));
      return v;
    }
    need(v && typeof v === "object" && !seen.has(v));
    const array = Array.isArray(v),
      proto = Object.getPrototypeOf(v);
    need(
      array
        ? proto === Array.prototype
        : proto === Object.prototype || proto === null,
    );
    seen.add(v);
    let length = 0,
      count = 0;
    if (array) {
      const d = Object.getOwnPropertyDescriptor(v, "length");
      need(
        d &&
          "value" in d &&
          Number.isSafeInteger(d.value) &&
          d.value >= 0 &&
          d.value <=
            (evidence ? offlineCheckoutEvidenceLimits.arrayItems : 1000),
      );
      length = d.value;
    }
    for (const key in v)
      need(Object.hasOwn(v, key) && ++count <= (array ? length : 64));
    const keys = Reflect.ownKeys(v);
    need(keys.length === count + (array ? 1 : 0));
    const out: any = array ? [] : {};
    for (const key of keys) {
      need(typeof key === "string");
      charge(key, true);
      if (array && key === "length") continue;
      need(!["__proto__", "constructor", "prototype"].includes(key));
      need(!array || (/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < length));
      const d = Object.getOwnPropertyDescriptor(v, key);
      need(d && "value" in d && d.enumerable);
      out[key] = copy(d.value, depth + 1);
    }
    need(!array || count === length);
    seen.delete(v);
    return out;
  };
  return copy(input, 0);
}
function fields(v: any, keys: string[]) {
  need(
    v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      Object.keys(v).length === keys.length &&
      keys.every((k) => Object.hasOwn(v, k)),
  );
}
// Private JSON uses code-unit key ordering. Existing core.canonical hash domains
// are unchanged and are checked separately below.
function json(v: any): string {
  if (Array.isArray(v)) return `[${v.map(json).join(",")}]`;
  if (v !== null && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${json(v[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}
// Bound nesting and structural allocation before JSON.parse. Syntax, duplicate
// keys and noncanonical spellings are subsequently refused by exact reencoding.
function preflight(text: string) {
  let quoted = false,
    escaped = false,
    depth = 0,
    containers = 0,
    strings = 0;
  for (const c of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') {
      quoted = true;
      need(++strings <= offlineCheckoutEvidenceLimits.nodes * 2);
    } else if (c === "[" || c === "{") {
      need(
        ++depth <= offlineCheckoutEvidenceLimits.depth &&
          ++containers <= offlineCheckoutEvidenceLimits.nodes,
      );
    } else if (c === "]" || c === "}") need(--depth >= 0);
  }
  need(!quoted && depth === 0);
}
type State = "pending" | "completing" | "completed" | "reviewing" | "disposed";
type Internal = { reader: RestoreOfflineCheckoutPrivateEvidence; state: State };
const captures = new WeakMap<object, Internal>();
export type CheckoutPrivateReview = Readonly<{
  version: 1;
  status: "native-private-checkout-consistency-only";
  envelopeBinding: string;
  setHash: string;
  payloadHash: string;
  native: ReturnType<RestoreOfflineCheckoutNativeJoin["getInTransaction"]>;
  phase: ReturnType<RestoreOfflineNativePhase["reviewInTransaction"]>;
}>;
export type CheckoutPrivateApplicationCapture = Readonly<{
  version: 1;
  purpose: "native-private-checkout-application-consistency-only";
  envelopeBinding: string;
  setHash: string;
  payloadHash: string;
  comparison: OfflineCheckoutComparison;
  referenceJoin: ReturnType<
    RestoreOfflineCheckoutReferenceJoin["getInTransaction"]
  >;
  native: CheckoutPrivateReview["native"];
  phase: CheckoutPrivateReview["phase"];
  captureHash: string;
}>;
export type CheckoutPrivateHandle = Readonly<{
  complete(): Readonly<{
    status: "historical-byte-binding";
    envelopeBinding: string;
    setHash: string;
    bytes: number;
    qualification: "unverified";
  }>;
  reviewInTransaction(actorLocator: unknown): CheckoutPrivateReview;
  captureForApplicationInTransaction(
    actorLocator: unknown,
  ): CheckoutPrivateApplicationCapture;
  dispose(): void;
  [Symbol.dispose](): void;
}>;
/** Fixed internal review/application capture only. No raw payload getter,
 * owning mutation, task registry or external qualification/COMMIT contract. */
export class RestoreOfflineCheckoutPrivateEvidence {
  readonly #native: RestoreOfflineCheckoutNativeJoin;
  readonly #phase: RestoreOfflineNativePhase;
  readonly #references: RestoreOfflineCheckoutReferenceJoin;
  readonly #counter: Store;
  #busy = false;
  #poison = false;
  constructor(
    database: Database,
    identity: Identity,
    billing: Billing,
    checkouts: IntegrationCheckouts,
  ) {
    // Native constructor validates the actual complete same-Database owner graph
    // without invoking untrusted descriptors. Only then obtain its Platform.
    this.#native = new RestoreOfflineCheckoutNativeJoin(
      database,
      identity,
      billing,
      checkouts,
    );
    const platform = Object.getOwnPropertyDescriptor(
      identity,
      "platform",
    )?.value;
    need(platform instanceof Platform);
    this.#phase = new RestoreOfflineNativePhase(database, platform);
    this.#references = new RestoreOfflineCheckoutReferenceJoin(
      database,
      identity,
      billing,
      checkouts,
    );
    this.#counter = database.owned("integration");
  }
  #enter() {
    if (this.#busy) {
      this.#poison = true;
      fail();
    }
    this.#busy = true;
    this.#poison = false;
  }
  read(envelopeInput: unknown, manifestInput: unknown): CheckoutPrivateHandle {
    let entered = false,
      pending:
        ReturnType<typeof readRestorePrivateOriginalEvidence> | undefined,
      captured: ReadonlyMap<string, Buffer> | undefined,
      token: CheckoutPrivateHandle | undefined;
    const reader = this,
      held: Internal = { reader: this, state: "pending" };
    const dispose = () => {
      held.state = "disposed";
      if (token) captures.delete(token);
      pending?.discard();
      pending = undefined;
      if (captured) for (const b of captured.values()) b.fill(0);
      captured = undefined;
    };
    const identity = (self: unknown) =>
      need(
        self !== null &&
          typeof self === "object" &&
          self === token &&
          captures.get(self) === held &&
          held.reader === reader,
      );
    try {
      this.#enter();
      entered = true;
      const native = this.#native,
        phase = this.#phase;
      const envelope = parseOfflineTaskEnvelope(data(envelopeInput));
      need(
        envelope.task.owner === checkoutPrivateTask.owner &&
          envelope.task.name === checkoutPrivateTask.name &&
          envelope.task.version === 1 &&
          envelope.task.expectedRevision === 0 &&
          envelope.task.priorClaim === null &&
          envelope.task.siteIds.length === 0,
      );
      need(envelope.evidence.items.length === 1);
      const item = envelope.evidence.items[0]!;
      need(item.bytes > 0 && item.bytes <= checkoutPrivateEvidenceBytes);
      const m = data(manifestInput);
      fields(m, ["version", "root", "files"]);
      need(m.version === 1 && Array.isArray(m.files) && m.files.length === 1);
      fields(m.files[0], ["reference", "path"]);
      need(m.files[0].reference === item.reference);
      const setHash = digest(canonical([item]));
      need(setHash === envelope.evidence.setHash);
      pending = readRestorePrivateOriginalEvidence(
        new Map([[item.reference, item.sha256]]),
        m as RestoreEvidenceManifest,
        { references: [item.reference], maxBytes: item.bytes },
      );
      need(!this.#poison);
      // Both fixed operations consume the very same allocation/lifetime. No
      // caller callback or caller-supplied comparison/reference receipt enters.
      const consume = (
        self: unknown,
        actorLocator: unknown,
        application: boolean,
      ): CheckoutPrivateReview | CheckoutPrivateApplicationCapture => {
        let owns = false;
        try {
          identity(self);
          reader.#enter();
          owns = true;
          need(held.state === "completed" && captured);
          held.state = "reviewing";
          const bytes = captured.get(item.reference);
          need(
            bytes &&
              bytes.length === item.bytes &&
              digest(bytes) === item.sha256,
          );
          const text = new TextDecoder("utf-8", {
            fatal: true,
            ignoreBOM: true,
          }).decode(bytes);
          preflight(text);
          const input = data(JSON.parse(text), true);
          need(
            json(input) === text &&
              digest(canonical(input)) === envelope.task.payloadHash,
          );
          const comparison = compareOfflineCheckoutPaidEvidence(input);
          need(
            comparison.orgId === envelope.task.orgId &&
              comparison.effectId === envelope.task.subjectId &&
              (application ||
                comparison.nativeHash === envelope.task.expectedStateHash),
          );
          // Validate current native owner graph before invoking phase reads on it.
          const joined = nativeReview.call(native, actorLocator, comparison);
          // Native join first validates the current actual owner graph. A fixed
          // counter covers phase/reference reads too, detecting even logically
          // identical attempted writes without reading foreign business tables.
          const changes = application
            ? readCounter.call(reader.#counter, "SELECT total_changes() AS n")!
                .n
            : undefined;
          const current = phaseReview.call(phase, envelope);
          if (application) {
            const referenceJoin = referenceReview.call(
              reader.#references,
              actorLocator,
              comparison,
            );
            const finalPhase = phaseReview.call(phase, envelope);
            need(
              held.state === "reviewing" &&
                !reader.#poison &&
                referenceJoin.hash === envelope.task.expectedStateHash &&
                referenceJoin.comparisonHash === comparison.hash &&
                referenceJoin.nativeJoinHash === joined.hash &&
                referenceJoin.candidateHash === joined.candidateHash &&
                canonical(finalPhase) === canonical(current) &&
                current.envelopeBinding === offlineTaskBinding(envelope) &&
                readCounter.call(
                  reader.#counter,
                  "SELECT total_changes() AS n",
                )!.n === changes,
            );
            const body = {
              version: 1 as const,
              purpose:
                "native-private-checkout-application-consistency-only" as const,
              envelopeBinding: current.envelopeBinding,
              setHash,
              payloadHash: envelope.task.payloadHash,
              comparison,
              referenceJoin,
              native: joined,
              phase: finalPhase,
            };
            const result = freeze({
              ...body,
              captureHash: digest(
                canonical({ domain: applicationCaptureDomain, body }),
              ),
            });
            applicationCaptures.add(result);
            return result;
          }
          need(
            held.state === "reviewing" &&
              !reader.#poison &&
              current.envelopeBinding === offlineTaskBinding(envelope),
          );
          return Object.freeze({
            version: 1,
            status: "native-private-checkout-consistency-only",
            envelopeBinding: current.envelopeBinding,
            setHash,
            payloadHash: envelope.task.payloadHash,
            native: joined,
            phase: current,
          });
        } catch {
          return fail();
        } finally {
          dispose();
          if (owns) reader.#busy = false;
        }
      };
      token = Object.freeze({
        dispose() {
          need(this === token);
          dispose();
        },
        [Symbol.dispose]() {
          need(this === token);
          dispose();
        },
        complete() {
          let owns = false;
          try {
            identity(this);
            reader.#enter();
            owns = true;
            need(held.state === "pending" && pending);
            held.state = "completing";
            const result = pending.complete();
            captured = result.captured;
            pending = undefined;
            need(
              held.state === "completing" &&
                !reader.#poison &&
                result.files === 1 &&
                result.bytes === item.bytes &&
                result.setHash === setHash &&
                captured.size === 1,
            );
            const bytes = captured.get(item.reference);
            need(
              bytes &&
                bytes.length === item.bytes &&
                digest(bytes) === item.sha256,
            );
            held.state = "completed";
            return Object.freeze({
              status: "historical-byte-binding" as const,
              envelopeBinding: offlineTaskBinding(envelope),
              setHash,
              bytes: item.bytes,
              qualification: "unverified" as const,
            });
          } catch {
            dispose();
            return fail();
          } finally {
            if (owns) reader.#busy = false;
          }
        },
        reviewInTransaction(actorLocator: unknown): CheckoutPrivateReview {
          return consume(this, actorLocator, false) as CheckoutPrivateReview;
        },
        captureForApplicationInTransaction(
          actorLocator: unknown,
        ): CheckoutPrivateApplicationCapture {
          return consume(
            this,
            actorLocator,
            true,
          ) as CheckoutPrivateApplicationCapture;
        },
      });
      captures.set(token, held);
      return token;
    } catch {
      dispose();
      return fail();
    } finally {
      if (entered) this.#busy = false;
    }
  }
}
