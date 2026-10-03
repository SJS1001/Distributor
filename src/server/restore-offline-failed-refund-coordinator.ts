import { types } from "node:util";
import { canonical, check, permit, type Actor } from "./core.ts";
import { Database } from "./database.ts";
import { Identity } from "./iam.ts";
import { Billing } from "./billing.ts";
import { Platform } from "./platform.ts";
import {
  IntegrationOfflineFailedRefund,
  offlineFailedRefundTask,
} from "./integration-offline-failed-refund.ts";
import { RestoreOfflineFailedRefundPrivateEvidence } from "./restore-offline-private-evidence.ts";
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
export type OfflineFailedRefundQualification = Readonly<{
  purpose: "distributor-offline-current-refund-qualification-v1";
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
    comparisonInputHash: string;
    provider: "stripe";
    mode: "test";
    subjectId: string;
    reference: string;
  }>;
}>;
export type OfflineFailedRefundHost = Readonly<{
  adapter: OfflineCommitAdapter;
  readCurrent(request: OfflineCommitRequest): OfflineFailedRefundQualification;
}>;
const code = "RESTORE_OFFLINE_REFUND_COORDINATOR";
function insist(ok: unknown): asserts ok {
  check(ok, code, "Current offline refund qualification did not complete.");
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
function captureHost(input: OfflineFailedRefundHost): OfflineFailedRefundHost {
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
  }) as OfflineFailedRefundHost;
}

/** One fixed task, real owners and actual outer COMMIT. Undefined host remains
 * closed. Synthetic adapters exercise composition only, never qualification. */
export class RestoreOfflineFailedRefundCoordinator {
  readonly #operation: IntegrationOfflineFailedRefund;
  readonly #private = new RestoreOfflineFailedRefundPrivateEvidence();
  readonly #host: OfflineFailedRefundHost | undefined;
  constructor(
    private readonly database: Database,
    private readonly identity: Identity,
    billing: Billing,
    private readonly platform: Platform,
    host?: OfflineFailedRefundHost,
  ) {
    this.#operation = new IntegrationOfflineFailedRefund(
      database,
      identity,
      billing,
      platform,
    );
    this.#host = host === undefined ? undefined : captureHost(host);
  }
  execute(
    actorInput: Actor,
    envelopeInput: unknown,
    approvalInput: unknown,
    manifestInput: unknown,
    referenceInput: unknown,
  ) {
    const host = this.#host;
    insist(host);
    // Capture ONLY principal locators; current grants are always native.
    const actorRecord = record(actorInput, [
      "id",
      "orgId",
      "accountId",
      "role",
      "sites",
      "name",
    ]);
    insist(
      typeof actorRecord.id === "string" &&
        /^[A-Za-z0-9_-]{1,160}$/.test(actorRecord.id) &&
        typeof actorRecord.orgId === "string" &&
        /^[A-Za-z0-9_-]{1,160}$/.test(actorRecord.orgId),
    );
    const locator = Object.freeze({
      id: actorRecord.id,
      orgId: actorRecord.orgId,
    }) as Actor;
    const envelope = parseOfflineTaskEnvelope(detach(envelopeInput)),
      approvals = detach(approvalInput),
      manifest = detach(manifestInput);
    const reference = detach(referenceInput);
    insist(
      typeof reference === "string" &&
        envelope.evidence.items.length === 1 &&
        envelope.evidence.items[0]!.reference === reference,
    );
    insist(
      envelope.executorId === locator.id &&
        envelope.task.orgId === locator.orgId,
    );
    let comparisonHash: string | undefined,
      providerReference: string | undefined,
      previousNow: number | undefined;
    const qualified = (request: OfflineCommitRequest) => {
      this.database.requireTransaction();
      const store = this.database.owned("integration"),
        changes = store.get("SELECT total_changes() AS n")!.n;
      insist(host.adapter.assertHeld(request) === undefined);
      const captured = host.readCurrent(request);
      insist(store.get("SELECT total_changes() AS n")!.n === changes);
      const q = detach(captured) as OfflineFailedRefundQualification;
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
        "comparisonInputHash",
        "provider",
        "mode",
        "subjectId",
        "reference",
      ]);
      insist(
        q.purpose === "distributor-offline-current-refund-qualification-v1" &&
          q.envelopeBinding === offlineTaskBinding(envelope),
      );
      insist(
        typeof q.now === "string" &&
          typeof q.evidence.comparisonInputHash === "string" &&
          typeof q.evidence.reference === "string" &&
          q.evidence.reference.length > 0 &&
          q.evidence.reference.length <= 160,
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
      insist(
        q.evidence.setHash === envelope.evidence.setHash &&
          q.evidence.qualificationHash ===
            envelope.evidence.qualificationHash &&
          q.evidence.provider === "stripe" &&
          q.evidence.mode === "test" &&
          q.evidence.subjectId === envelope.task.subjectId &&
          /^[a-f0-9]{64}$/.test(q.evidence.comparisonInputHash),
      );
      if (comparisonHash !== undefined)
        insist(
          q.evidence.comparisonInputHash === comparisonHash &&
            q.evidence.reference === providerReference,
        );
      const actor = this.identity.currentActor(locator);
      permit(actor, ["finance"]);
      insist(
        !actor.accountId &&
          !this.identity.security(actor).passwordChangeRequired,
      );
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
      task: offlineFailedRefundTask,
      operation: (actual) => {
        const request: OfflineCommitRequest = Object.freeze({
          purpose: "distributor-offline-commit-v1",
          envelopeBinding: offlineTaskBinding(actual),
          envelope: actual,
        });
        qualified(request);
        const handle = this.#private.read(actual, manifest);
        try {
          handle.complete();
          const q = qualified(request),
            comparison = handle.compareFailedRefund(reference);
          comparisonHash = comparison.inputHash;
          providerReference = comparison.outcome.reference;
          insist(
            q.evidence.comparisonInputHash === comparisonHash &&
              q.evidence.reference === providerReference,
          );
          qualified(request);
          this.#operation.applyInTransaction(locator, actual, comparison);
        } finally {
          handle.dispose();
        }
      },
    });
    return guard.execute(envelope);
  }
  /** Read-only exact durable native receipt. Absence refuses; never retry here. */
  recoverInTransaction(actor: Actor, envelope: unknown) {
    return this.#operation.recoverInTransaction(actor, envelope);
  }
}
