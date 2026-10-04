import { types } from "node:util";
import { canonical, check, digest, permit, type Actor } from "./core.ts";
import { Database } from "./database.ts";
import { Identity } from "./iam.ts";
import { StockJournalDelivery } from "./stock-journal-delivery.ts";
import { PlatformOfflineOriginalCommandReviewReader } from "./platform-offline-original-command-review.ts";
import { Platform } from "./platform.ts";
import { IntegrationOfflineOriginalCancellation } from "./integration-offline-original-cancellation.ts";
import { RestoreOfflineOriginalPrivateEvidence } from "./restore-offline-private-evidence.ts";
import {
  RestoreOfflineCommitGuard,
  type OfflineCommitAdapter,
  type OfflineCommitRequest,
} from "./restore-offline-commit-guard.ts";
import {
  offlineTaskBinding,
  parseOfflineTaskEnvelope,
} from "./restore-offline-envelope.ts";
import {
  offlineApprovalRosterFingerprint,
  verifyOfflineTaskApprovals,
  type OfflineApprovalRosterEntry,
  type OfflineApprovalAssociations,
} from "./restore-offline-approvals.ts";

/** Trusted static host composition only. This reader independently resolves
 * CURRENT authority, source interval, recovery instance, provider evidence and
 * roster/revocation for the exact binding under the adapter's commit interlock.
 * The adapter must additionally keep the signed lifetime and provider
 * qualification valid through actual COMMIT return; sampled clock checks or
 * an expiring lease alone cannot supply that independently qualified guarantee.
 * Returning caller assertions or archived qualification is not this contract.
 * No provider IO, candidate writes, async work or retained callbacks.
 * Infrastructure qualification remains external; there is no Application route. */
export type OfflineOriginalCancellationQualification = Readonly<{
  purpose: "distributor-offline-current-original-cancellation-qualification-v1";
  envelopeBinding: string;
  now: string;
  trust: Readonly<{
    authorityId: string;
    revision: number;
    registryHash: string;
  }>;
  roster: readonly OfflineApprovalRosterEntry[];
  associations: OfflineApprovalAssociations;
  evidence: Readonly<{
    setHash: string;
    qualificationHash: string;
    payloadHash: string;
    captureHash: string;
    commandReviewHash: string;
    reasonHash: string;
    provider: "quickbooks";
    mode: "sandbox";
    subjectId: string;
    reference: string;
  }>;
}>;
export type OfflineOriginalCancellationHost = Readonly<{
  adapter: OfflineCommitAdapter;
  readCurrent(
    request: OfflineCommitRequest,
  ): OfflineOriginalCancellationQualification;
}>;
const code = "RESTORE_OFFLINE_ORIGINAL_CANCELLATION_COORDINATOR";
function insist(ok: unknown): asserts ok {
  check(
    ok,
    code,
    "Current offline original cancellation qualification did not complete.",
  );
}

// Detach every untrusted input before trusted host code can mutate its source.
// Proxies are refused before reflection; arrays are bounded before enumeration.
function detach(input: unknown): any {
  let nodes = 0,
    bytes = 0;
  function visit(value: unknown, depth: number): any {
    insist(++nodes <= 20000 && depth <= 16);
    if (typeof value === "string") {
      bytes += Buffer.byteLength(value);
      insist(
        value.length <= 8192 &&
          bytes <= 1024 * 1024 &&
          !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
            value,
          ),
      );
      return value;
    }
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") {
      insist(Number.isSafeInteger(value) && !Object.is(value, -0));
      return value;
    }
    insist(value && typeof value === "object" && !types.isProxy(value));
    const array = Array.isArray(value),
      prototype = Object.getPrototypeOf(value);
    insist(
      array
        ? prototype === Array.prototype
        : prototype === Object.prototype || prototype === null,
    );
    if (array) {
      const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
      insist(Number.isSafeInteger(length) && length >= 0 && length <= 1000);
      insist(Reflect.ownKeys(value).length === length + 1);
      const result = [];
      for (let i = 0; i < length; i++) {
        const d = Object.getOwnPropertyDescriptor(value, String(i));
        insist(d && "value" in d && d.enumerable);
        result.push(visit(d.value, depth + 1));
      }
      return Object.freeze(result);
    }
    let count = 0;
    for (const key in value) insist(++count <= 64 && Object.hasOwn(value, key));
    const keys = Reflect.ownKeys(value);
    insist(keys.length === count);
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      insist(
        typeof key === "string" &&
          key.length <= 160 &&
          !["__proto__", "constructor", "prototype"].includes(key),
      );
      // Property names consume the same UTF-8 budget and Unicode validation
      // as values; bounded node/key counts alone do not bound their bytes.
      visit(key, depth + 1);
      const d = Object.getOwnPropertyDescriptor(value, key);
      insist(d && "value" in d && d.enumerable);
      result[key] = visit(d.value, depth + 1);
    }
    return Object.freeze(result);
  }
  return visit(input, 0);
}
function record(input: unknown, keys: string[]) {
  insist(
    input &&
      typeof input === "object" &&
      !types.isProxy(input) &&
      !Array.isArray(input),
  );
  const prototype = Object.getPrototypeOf(input);
  insist(prototype === Object.prototype || prototype === null);
  const own = Reflect.ownKeys(input);
  insist(
    own.length === keys.length &&
      own.every((k) => typeof k === "string" && keys.includes(k)),
  );
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(input, key);
    insist(d && "value" in d && d.enumerable);
    result[key] = d.value;
  }
  return result;
}
function sync(value: unknown): asserts value is (...args: any[]) => any {
  insist(
    typeof value === "function" &&
      !types.isProxy(value) &&
      !types.isAsyncFunction(value) &&
      !types.isGeneratorFunction(value),
  );
}
function captureHost(
  input: OfflineOriginalCancellationHost,
): OfflineOriginalCancellationHost {
  const host = record(input, ["adapter", "readCurrent"]),
    adapter = record(host.adapter, ["identity", "hold", "assertHeld"]);
  sync(host.readCurrent);
  sync(adapter.hold);
  sync(adapter.assertHeld);
  insist(
    typeof adapter.identity === "string" &&
      /^[A-Za-z0-9_-]{1,160}$/.test(adapter.identity),
  );
  return Object.freeze({
    adapter: Object.freeze({
      identity: adapter.identity,
      hold: adapter.hold,
      assertHeld: adapter.assertHeld,
    }),
    readCurrent: host.readCurrent,
  }) as OfflineOriginalCancellationHost;
}

const task = Object.freeze({
  owner: "integration",
  name: "integration.quickbooks-original-cancelled.import",
  version: 1,
});
function principal(input: unknown): Actor {
  insist(input && typeof input === "object" && !types.isProxy(input));
  const prototype = Object.getPrototypeOf(input);
  insist(prototype === Object.prototype || prototype === null);
  const out: Record<string, string> = {};
  for (const key of ["id", "orgId"]) {
    const d = Object.getOwnPropertyDescriptor(input, key);
    insist(
      d &&
        "value" in d &&
        d.enumerable &&
        typeof d.value === "string" &&
        /^[A-Za-z0-9_-]{1,160}$/.test(d.value),
    );
    out[key] = d.value;
  }
  return Object.freeze({ id: out.id!, orgId: out.orgId! }) as Actor;
}
/** Fixed signed original cancellation under the actual outer COMMIT. Missing
 * trusted host stays closed; historical consistency alone grants no authority. */
export class RestoreOfflineOriginalCancellationCoordinator {
  readonly #operation: IntegrationOfflineOriginalCancellation;
  readonly #private: RestoreOfflineOriginalPrivateEvidence;
  readonly #commands: PlatformOfflineOriginalCommandReviewReader;
  readonly #host: OfflineOriginalCancellationHost | undefined;
  readonly #ownerMethods: readonly Readonly<{
    owner: object;
    prototype: object;
    methods: readonly (readonly [string, unknown])[];
  }>[];
  readonly #ownerLinks: readonly (readonly [object, string, object])[];
  constructor(
    private readonly database: Database,
    private readonly identity: Identity,
    journals: StockJournalDelivery,
    private readonly platform: Platform,
    host?: OfflineOriginalCancellationHost,
  ) {
    this.#ownerMethods = [
      [database, Database.prototype],
      [identity, Identity.prototype],
      [journals, StockJournalDelivery.prototype],
      [platform, Platform.prototype],
    ].map(([owner, prototype]) => {
      insist(
        owner &&
          !types.isProxy(owner) &&
          Object.getPrototypeOf(owner) === prototype,
      );
      const methods = Object.getOwnPropertyNames(prototype!)
        .filter((key) => key !== "constructor")
        .map(
          (key) =>
            [
              key,
              Object.getOwnPropertyDescriptor(prototype!, key)?.value,
            ] as const,
        );
      return Object.freeze({
        owner: owner!,
        prototype: prototype!,
        methods: Object.freeze(methods),
      });
    });
    this.#ownerLinks = Object.freeze([
      Object.freeze([identity, "database", database] as const),
      Object.freeze([journals, "database", database] as const),
      Object.freeze([platform, "database", database] as const),
      Object.freeze([identity, "platform", platform] as const),
      Object.freeze([journals, "identity", identity] as const),
      Object.freeze([journals, "platform", platform] as const),
    ]);
    this.owners();
    this.#operation = new IntegrationOfflineOriginalCancellation(
      database,
      identity,
      platform,
      journals,
    );
    this.#private = new RestoreOfflineOriginalPrivateEvidence(
      database,
      identity,
      journals,
    );
    this.#commands = new PlatformOfflineOriginalCommandReviewReader(
      database,
      identity,
      journals,
    );
    this.#host = host === undefined ? undefined : captureHost(host);
  }
  private owners() {
    for (const { owner, prototype, methods } of this.#ownerMethods) {
      insist(
        !types.isProxy(owner) && Object.getPrototypeOf(owner) === prototype,
      );
      for (const [key, method] of methods)
        insist(
          !Object.hasOwn(owner, key) &&
            Object.getOwnPropertyDescriptor(prototype, key)?.value === method,
        );
    }
    for (const [owner, key, expected] of this.#ownerLinks) {
      const descriptor = Object.getOwnPropertyDescriptor(owner, key);
      insist(
        descriptor && "value" in descriptor && descriptor.value === expected,
      );
    }
  }
  execute(
    evidenceActorInput: unknown,
    cancellationActorInput: unknown,
    envelopeInput: unknown,
    approvalInput: unknown,
    manifestInput: unknown,
    referenceInput: unknown,
  ) {
    this.owners();
    const host = this.#host;
    insist(host);
    // BOTH locators are inert before any trusted host or native owner callback.
    const evidenceActor = principal(evidenceActorInput),
      cancellationActor = principal(cancellationActorInput);
    insist(
      evidenceActor.id !== cancellationActor.id &&
        evidenceActor.orgId === cancellationActor.orgId,
    );
    const envelope = parseOfflineTaskEnvelope(detach(envelopeInput)),
      approvals = detach(approvalInput),
      manifest = detach(manifestInput),
      reference = detach(referenceInput);
    insist(
      typeof reference === "string" &&
        envelope.evidence.items.length === 1 &&
        envelope.evidence.items[0]!.reference === reference,
    );
    insist(
      envelope.preparedBy === evidenceActor.id &&
        envelope.executorId === cancellationActor.id &&
        envelope.task.orgId === evidenceActor.orgId,
    );
    insist(
      envelope.task.owner === task.owner &&
        envelope.task.name === task.name &&
        envelope.task.version === task.version &&
        envelope.task.siteIds.length === 0 &&
        envelope.task.priorClaim === null,
    );
    let previousNow: number | undefined,
      qualificationEvidence: string | undefined;
    const qualified = (request: OfflineCommitRequest) => {
      this.owners();
      this.database.requireTransaction();
      const store = this.database.owned("integration"),
        changes = store.get("SELECT total_changes() AS n")!.n;
      insist(host.adapter.assertHeld(request) === undefined);
      const captured = host.readCurrent(request);
      this.owners();
      insist(store.get("SELECT total_changes() AS n")!.n === changes);
      const q = detach(captured) as OfflineOriginalCancellationQualification;
      record(q, [
        "purpose",
        "envelopeBinding",
        "now",
        "trust",
        "roster",
        "associations",
        "evidence",
      ]);
      record(q.evidence, [
        "setHash",
        "qualificationHash",
        "payloadHash",
        "captureHash",
        "commandReviewHash",
        "reasonHash",
        "provider",
        "mode",
        "subjectId",
        "reference",
      ]);
      insist(
        q.purpose ===
          "distributor-offline-current-original-cancellation-qualification-v1" &&
          q.envelopeBinding === offlineTaskBinding(envelope),
      );
      insist(
        typeof q.now === "string" &&
          typeof q.evidence.reference === "string" &&
          q.evidence.reference.length > 0 &&
          Buffer.byteLength(q.evidence.reference) <= 2000 &&
          !q.evidence.reference.includes("\0"),
      );
      const now = Date.parse(q.now);
      insist(
        Number.isFinite(now) &&
          new Date(now).toISOString() === q.now &&
          now >= Date.parse(envelope.preparedAt) &&
          now < Date.parse(envelope.expiresAt) &&
          (previousNow === undefined || now >= previousNow),
      );
      previousNow = now;
      insist(
        canonical(q.trust) === canonical(envelope.trust) &&
          offlineApprovalRosterFingerprint(q.roster) ===
            envelope.trust.registryHash,
      );
      verifyOfflineTaskApprovals(envelope, approvals, q.roster, q.associations);
      for (const key of [
        "payloadHash",
        "captureHash",
        "commandReviewHash",
        "reasonHash",
      ] as const)
        insist(
          typeof q.evidence[key] === "string" &&
            /^[a-f0-9]{64}$/.test(q.evidence[key]),
        );
      insist(
        q.evidence.setHash === envelope.evidence.setHash &&
          q.evidence.qualificationHash ===
            envelope.evidence.qualificationHash &&
          q.evidence.payloadHash === envelope.task.payloadHash &&
          q.evidence.provider === "quickbooks" &&
          q.evidence.mode === "sandbox" &&
          q.evidence.subjectId === envelope.task.subjectId,
      );
      const evidenceHash = canonical(q.evidence);
      insist(
        qualificationEvidence === undefined ||
          qualificationEvidence === evidenceHash,
      );
      qualificationEvidence = evidenceHash;
      for (const locator of [evidenceActor, cancellationActor]) {
        const actor = this.identity.currentActor(locator);
        permit(actor, ["finance"]);
        insist(
          !actor.accountId &&
            !this.identity.security(actor).passwordChangeRequired,
        );
      }
      return q;
    };
    const guard = new RestoreOfflineCommitGuard(this.database, this.platform, {
      adapter: {
        identity: host.adapter.identity,
        hold: (request, commit) => host.adapter.hold(request, commit),
        assertHeld: (request) => {
          qualified(request);
        },
      },
      task,
      operation: (actual) => {
        const request: OfflineCommitRequest = Object.freeze({
          purpose: "distributor-offline-commit-v1",
          envelopeBinding: offlineTaskBinding(actual),
          envelope: actual,
        });
        qualified(request);
        // Ordinary commands must be joined BEFORE offline owner effects. Missing
        // preimages or unjoined other-source commands cannot be guessed away.
        const commands = this.#commands.getInTransaction(
          evidenceActor,
          actual.task.subjectId,
        );
        insist(
          commands.nativeHash === actual.task.expectedStateHash &&
            !commands.blockers.includes(
              "DECISION_REQUEST_PREIMAGE_NOT_RETAINED",
            ) &&
            !commands.blockers.includes(
              "OTHER_SOURCE_RECEIPTS_NOT_OWNER_JOINED",
            ),
        );
        const handle = this.#private.read(actual, manifest, {
          references: [reference],
          maxBytes: 16_016_384,
        });
        try {
          handle.complete();
          const q = qualified(request),
            cap = handle.captureOriginalJournal(reference, evidenceActor),
            reason = cap.claim.attestation.evidence;
          insist(
            q.evidence.captureHash === cap.hash &&
              q.evidence.commandReviewHash === commands.factsHash &&
              q.evidence.reference === cap.claim.attestation.externalRef &&
              q.evidence.reasonHash === digest(canonical(reason)),
          );
          qualified(request);
          this.#operation.applyInTransaction(
            evidenceActor,
            cancellationActor,
            actual,
            cap,
            reason,
          );
        } finally {
          handle.dispose();
        }
      },
    });
    return guard.execute(envelope);
  }
  /** Read only, exact native/Platform receipt proof, never repeat an uncertain write. */
  recoverInTransaction(
    evidenceActor: unknown,
    cancellationActor: unknown,
    envelope: unknown,
    record: unknown,
  ) {
    this.owners();
    return this.#operation.recoverInTransaction(
      principal(evidenceActor),
      principal(cancellationActor),
      envelope,
      record,
    );
  }
}
