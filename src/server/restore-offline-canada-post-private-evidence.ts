import { CarrierBookings } from "./carrier-bookings.ts";
import { RestoreOfflineNativePhase } from "./restore-offline-native-phase.ts";
import { types } from "node:util";
import { canonical, digest, DomainError } from "./core.ts";
import { Database } from "./database.ts";
import { Identity } from "./iam.ts";
import { Platform } from "./platform.ts";
import { Fulfillment } from "./fulfillment.ts";
import {
  parseOfflineTaskEnvelope,
  offlineTaskBinding,
  type OfflineTaskEnvelopeV1,
} from "./restore-offline-envelope.ts";
import {
  readRestorePrivateOriginalEvidence,
  type RestoreEvidenceManifest,
} from "./restore-private-evidence.ts";
import { canadaPostOfflineMemberEvidenceLimits } from "./canada-post-offline-member-evidence.ts";
import {
  RestoreOfflineCanadaPostNativeJoin,
  type CanadaPostNativeJoin,
} from "./restore-offline-canada-post-native-join.ts";

export const canadaPostPrivateTask = Object.freeze({
  owner: "integration",
  name: "integration.canada-post-member.import",
  version: 1,
});
export const canadaPostPrivateEvidenceBytes = 16_000_000; // <= legacy original-profile 16,016,384
function fail(): never {
  throw new DomainError(
    "RESTORE_OFFLINE_CANADA_POST_PRIVATE",
    "Canada Post private evidence capture did not complete.",
  );
}
function need(v: unknown): asserts v {
  if (!v) fail();
}
function data(input: unknown, json = false): any {
  let nodes = 0,
    bytes = 0;
  const active = new WeakSet<object>();
  function copy(v: unknown, depth: number): any {
    need(!types.isProxy(v));
    need(++nodes <= (json ? 100000 : 20000) && depth <= (json ? 24 : 12));
    if (typeof v === "string") {
      need(
        v.length <=
          (json ? canadaPostOfflineMemberEvidenceLimits.string : 4096) &&
          !/[\ud800-\udfff]/u.test(v),
      );
      bytes += Buffer.byteLength(v);
      need(bytes <= (json ? canadaPostPrivateEvidenceBytes : 1024 * 1024));
      return v;
    }
    if (v === null || typeof v === "boolean") return v;
    if (typeof v === "number") {
      need(Number.isFinite(v) && !Object.is(v, -0));
      return v;
    }
    need(v && typeof v === "object" && !active.has(v));
    const array = Array.isArray(v),
      proto = Object.getPrototypeOf(v);
    need(
      array
        ? proto === Array.prototype
        : proto === Object.prototype || proto === null,
    );
    active.add(v);
    let length = 0,
      count = 0;
    if (array) {
      const d = Object.getOwnPropertyDescriptor(v, "length");
      need(
        d &&
          "value" in d &&
          Number.isSafeInteger(d.value) &&
          d.value >= 0 &&
          d.value <= (json ? 4000 : 1000),
      );
      length = d.value;
    }
    for (const key in v)
      need(Object.hasOwn(v, key) && ++count <= (array ? length : 64));
    const keys = Reflect.ownKeys(v);
    need(keys.length === count + (array ? 1 : 0));
    const out: any = array ? [] : {};
    for (const key of keys) {
      need(
        typeof key === "string" &&
          key.length <= 128 &&
          !/[\ud800-\udfff]/u.test(key),
      );
      if (array && key === "length") continue;
      need(!["__proto__", "constructor", "prototype"].includes(key));
      if (array) need(/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < length);
      const d = Object.getOwnPropertyDescriptor(v, key);
      need(d && "value" in d && d.enumerable);
      bytes += Buffer.byteLength(key);
      need(bytes <= (json ? canadaPostPrivateEvidenceBytes : 1024 * 1024));
      out[key] = copy(d.value, depth + 1);
    }
    need(!array || count === length);
    active.delete(v);
    return out;
  }
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
// Code-unit ordering for PRIVATE JSON only; legacy projection/set hash domains
// continue to use core.canonical's localeCompare ordering unchanged.
function jsonCanonical(v: any): string {
  if (Array.isArray(v)) return `[${v.map(jsonCanonical).join(",")}]`;
  if (v !== null && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${jsonCanonical(v[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}
type State = "pending" | "completed" | "joining" | "disposed";
type Internal = {
  native: RestoreOfflineCanadaPostNativeJoin;
  envelope: OfflineTaskEnvelopeV1;
  input?: unknown;
  state: State;
  reader: RestoreOfflineCanadaPostPrivateEvidence;
  dispose: () => void;
  owner?: CarrierBookings;
  joined?: CanadaPostNativeJoin;
  apply?: (actor: unknown) => CanadaPostPrivateApplication;
};
const captures = new WeakMap<object, Internal>();
/** Identity-only internal bridge, never a payload getter or authority assertion. */
export function isInternalCanadaPostPrivateCapture(
  token: unknown,
  native: unknown,
  envelope: unknown,
  input: unknown,
): boolean {
  if (token === null || typeof token !== "object") return false;
  const held = captures.get(token);
  return (
    !!held &&
    held.state === "joining" &&
    held.native === native &&
    held.envelope === envelope &&
    held.input === input
  );
}
/** Fixed private bridge: no bytes or facts are returned and no caller function runs. */
export function isInternalCanadaPostOwnerCapture(
  token: unknown,
  owner: unknown,
  envelope: unknown,
  input: unknown,
  joined: unknown,
): boolean {
  if (!token || typeof token !== "object") return false;
  const held = captures.get(token);
  return (
    !!held &&
    held.state === "joining" &&
    held.owner === owner &&
    held.envelope === envelope &&
    held.input === input &&
    held.joined === joined
  );
}
export type CanadaPostPrivateApplication = Readonly<{
  envelope: OfflineTaskEnvelopeV1;
  joined: CanadaPostNativeJoin;
  result: ReturnType<
    CarrierBookings["applyOfflineCanadaPostMemberInTransaction"]
  >;
}>;
export type CanadaPostPrivateHandle = Readonly<{
  complete(): Readonly<{
    status: "historical-byte-binding";
    envelopeBinding: string;
    setHash: string;
    bytes: number;
    qualification: "unverified";
  }>;
  reviewInTransaction(actorLocator: unknown): CanadaPostNativeJoin;
  dispose(): void;
  [Symbol.dispose](): void;
}>;

/** Trusted host composition only: no task registry or envelope-selected adapter.
 * Constructors never initialize native storage. The handle's closure binds the
 * real native join and one capture; no caller-supplied native capture is accepted. */
export class RestoreOfflineCanadaPostPrivateEvidence {
  readonly #native: RestoreOfflineCanadaPostNativeJoin;
  readonly #owner?: CarrierBookings;
  readonly #phase: RestoreOfflineNativePhase;
  #reading = false;
  #reentered = false;
  constructor(
    database: Database,
    identity: Identity,
    platform: Platform,
    fulfillment: Fulfillment,
    carrier?: CarrierBookings,
  ) {
    if (carrier) {
      need(
        !types.isProxy(carrier) &&
          Object.getPrototypeOf(carrier) === CarrierBookings.prototype,
      );
      for (const [key, d] of Object.entries(
        Object.getOwnPropertyDescriptors(CarrierBookings.prototype),
      ))
        if (typeof d.value === "function") need(!Object.hasOwn(carrier, key));
      carrier.assertOfflineCanadaPostOwner(
        database,
        identity,
        platform,
        fulfillment,
      );
    }
    this.#owner = carrier;
    this.#phase = new RestoreOfflineNativePhase(database, platform);
    this.#native = new RestoreOfflineCanadaPostNativeJoin(
      database,
      identity,
      platform,
      fulfillment,
    );
  }
  /** Identity-only cleanup of this reader's handle; never invokes caller properties. */
  discardApplicationCapture(handle: unknown) {
    if (!handle || typeof handle !== "object") return;
    const held = captures.get(handle);
    if (held?.reader === this) held.dispose();
  }
  applyInTransaction(
    handle: unknown,
    actor: unknown,
  ): CanadaPostPrivateApplication {
    need(handle && typeof handle === "object");
    const held = captures.get(handle);
    need(held?.reader === this && held.owner === this.#owner && held.apply);
    return held.apply(actor);
  }
  read(
    envelopeInput: unknown,
    manifestInput: unknown,
  ): CanadaPostPrivateHandle {
    let ownsRead = false;
    let pending:
      ReturnType<typeof readRestorePrivateOriginalEvidence> | undefined;
    let captured: ReadonlyMap<string, Buffer> | undefined;
    let token: CanadaPostPrivateHandle | undefined;
    let held: Internal | undefined;
    const dispose = () => {
      if (held) {
        held.state = "disposed";
        held.input = undefined;
        held.joined = undefined;
        held.apply = undefined;
      }
      if (token) captures.delete(token);
      pending?.discard();
      pending = undefined;
      if (captured) for (const b of captured.values()) b.fill(0);
      captured = undefined;
    };
    try {
      if (this.#reading) {
        this.#reentered = true;
        fail();
      }
      this.#reading = true;
      this.#reentered = false;
      ownsRead = true;
      const native = this.#native; // Private-field brand is checked before any input traversal.
      const envelope = parseOfflineTaskEnvelope(data(envelopeInput));
      need(
        envelope.task.name === canadaPostPrivateTask.name &&
          envelope.task.owner === canadaPostPrivateTask.owner &&
          envelope.task.version === 1,
      );
      need(envelope.evidence.items.length === 1);
      const item = envelope.evidence.items[0]!;
      need(item.bytes > 0 && item.bytes <= canadaPostPrivateEvidenceBytes);
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
      need(!this.#reentered);
      held = {
        native,
        envelope,
        state: "pending",
        reader: this,
        dispose,
        owner: this.#owner,
      };
      const owner = this.#owner,
        phase = this.#phase;
      const consume = (actor: unknown, apply: boolean): any => {
        try {
          need(held?.state === "completed" && captured && token);
          held.state = "joining";
          const bytes = captured.get(item.reference);
          need(bytes && bytes.length <= canadaPostPrivateEvidenceBytes);
          const text = new TextDecoder("utf-8", {
            fatal: true,
            ignoreBOM: true,
          }).decode(bytes);
          const input = data(JSON.parse(text), true);
          need(
            jsonCanonical(input) === text &&
              digest(canonical(input)) === envelope.task.payloadHash,
          );
          held.input = input;
          const joined = native.joinCapturedInTransaction(
            token,
            actor,
            envelope,
            input,
          );
          need(held.state === "joining");
          if (!apply) return joined;
          need(
            owner &&
              !types.isProxy(owner) &&
              Object.getPrototypeOf(owner) === CarrierBookings.prototype,
          );
          for (const [key, d] of Object.entries(
            Object.getOwnPropertyDescriptors(CarrierBookings.prototype),
          ))
            if (typeof d.value === "function") need(!Object.hasOwn(owner, key));
          phase.reviewInTransaction(envelope);
          held.joined = joined;
          const result = owner.applyOfflineCanadaPostMemberInTransaction(
            token,
            envelope,
            input,
            joined,
          );
          need(held.state === "joining");
          return Object.freeze({ envelope, joined, result });
        } catch {
          fail();
        } finally {
          dispose();
        }
      };
      held.apply = (actor) => consume(actor, true);
      token = Object.freeze({
        dispose,
        [Symbol.dispose]: dispose,
        complete() {
          try {
            need(held?.state === "pending" && pending);
            held.state = "completed";
            const result = pending.complete();
            captured = result.captured;
            pending = undefined;
            need(
              held.state === "completed" &&
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
            return Object.freeze({
              status: "historical-byte-binding" as const,
              envelopeBinding: offlineTaskBinding(envelope),
              setHash,
              bytes: item.bytes,
              qualification: "unverified" as const,
            });
          } catch {
            dispose();
            fail();
          }
        },
        reviewInTransaction(actor: unknown) {
          return consume(actor, false) as CanadaPostNativeJoin;
        },
      });
      captures.set(token, held);
      return token;
    } catch {
      dispose();
      return fail();
    } finally {
      if (ownsRead) this.#reading = false;
    }
  }
}
