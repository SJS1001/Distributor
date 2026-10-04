import { types } from "node:util";
import { canonical, check, DomainError } from "./core.ts";
import { Database } from "./database.ts";
import { Platform } from "./platform.ts";
import {
  offlineTaskBinding,
  parseOfflineTaskEnvelope,
  type OfflineTaskEnvelopeV1,
} from "./restore-offline-envelope.ts";
import {
  RestoreOfflineNativePhase,
  type OfflineNativePhaseReview,
} from "./restore-offline-native-phase.ts";
import {
  evaluateOfflinePhaseTransition,
  offlinePhaseExpectation,
} from "./restore-offline-phase.ts";

export type OfflineCommitRequest = Readonly<{
  purpose: "distributor-offline-commit-v1";
  envelopeBinding: string;
  envelope: OfflineTaskEnvelopeV1;
}>;

/** TRUSTED HOST ONLY. Not configured from envelopes, assertions or environment
 * flags. Qualification is external to this module. hold must acquire current
 * authority/revocation serialization AND source/candidate fences for the exact
 * request before invoking commit once, synchronously, with no arguments.
 * All three protections remain held until commit RETURNS (after SQLite COMMIT).
 * assertHeld throws on loss; success guarantees protection through that return,
 * not merely at the instant sampled. An expiring remote lease/two reads cannot
 * implement this contract without an independently qualified commit interlock.
 * Both functions are bounded, read-only with respect to the candidate, and must
 * never schedule work, call providers, or retain/invoke commit after returning.
 */
export type OfflineCommitAdapter = Readonly<{
  identity: string;
  hold(request: OfflineCommitRequest, commit: () => void): void;
  assertHeld(request: OfflineCommitRequest): void;
}>;
export type OfflineCommitHost = Readonly<{
  adapter: OfflineCommitAdapter;
  task: Readonly<{ owner: string; name: string; version: number }>;
  /** One STATIC root-composed operation. Must perform all other current signed
   * evidence/IAM/owner checks, own writes and one exact Platform task receipt in
   * this transaction. No transport, nested transaction or asynchronous work.
   * Returning normally does not qualify the adapter or manufacture authority. */
  operation(
    envelope: OfflineTaskEnvelopeV1,
    phase: OfflineNativePhaseReview,
  ): void;
}>;
export type OfflineCommitOutcome = Readonly<{
  version: 1;
  status: "committed" | "committed-recovery-required";
  envelopeBinding: string;
  resultHash: string;
}>;

const code = "RESTORE_OFFLINE_COMMIT_GUARD";
const message =
  "Offline commit guard refused; recover by exact durable receipt if the outcome is uncertain.";
function insist(ok: unknown): asserts ok {
  check(ok, code, message);
}
function record(input: unknown, keys: string[]) {
  insist(input !== null && typeof input === "object" && !types.isProxy(input));
  insist(Object.getPrototypeOf(input) === Object.prototype);
  const own = Reflect.ownKeys(input);
  insist(
    own.length === keys.length &&
      own.every((k) => typeof k === "string" && keys.includes(k)),
  );
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(input, key);
    insist(d && "value" in d && d.enumerable);
    result[key] = d.value;
  }
  return result;
}
function syncFunction(
  value: unknown,
): asserts value is (...args: never[]) => unknown {
  insist(
    typeof value === "function" &&
      !types.isProxy(value) &&
      !types.isAsyncFunction(value) &&
      !types.isGeneratorFunction(value),
  );
}
function identity(value: unknown): string {
  insist(
    typeof value === "string" &&
      value.length > 0 &&
      value.length <= 160 &&
      Buffer.byteLength(value) <= 160 &&
      value === value.trim() &&
      !/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value),
  );
  return value;
}
function captureHost(input: unknown): OfflineCommitHost {
  const h = record(input, ["adapter", "task", "operation"]),
    a = record(h.adapter, ["identity", "hold", "assertHeld"]),
    t = record(h.task, ["owner", "name", "version"]);
  syncFunction(h.operation);
  syncFunction(a.hold);
  syncFunction(a.assertHeld);
  insist(Number.isSafeInteger(t.version) && Number(t.version) > 0);
  return Object.freeze({
    adapter: Object.freeze({
      identity: identity(a.identity),
      hold: a.hold,
      assertHeld: a.assertHeld,
    }),
    task: Object.freeze({
      owner: identity(t.owner),
      name: identity(t.name),
      version: Number(t.version),
    }),
    operation: h.operation,
  }) as OfflineCommitHost;
}

// Shared across guard instances on the same real connection. Reentry poisons
// the active attempt even if trusted host code swallows the nested refusal.
const active = new WeakMap<Database, () => void>();
const capturedPhaseReview =
  RestoreOfflineNativePhase.prototype.reviewCapturedCheckoutInTransaction;

/** No Application wiring. Undefined host configuration is permanently disabled.
 * Trusted composition must supply the same Application's Database and Platform.
 * This is not an executable-code sandbox or infrastructure qualification. */
export class RestoreOfflineCommitGuard {
  readonly #database: Database;
  readonly #platform: Platform;
  readonly #phase: RestoreOfflineNativePhase;
  readonly #host: OfflineCommitHost | undefined;
  readonly #transaction: Database["transaction"];
  constructor(
    database: Database,
    platform: Platform,
    host?: OfflineCommitHost,
  ) {
    this.#phase = new RestoreOfflineNativePhase(database, platform);
    this.#database = database;
    this.#platform = platform;
    this.#transaction = Database.prototype.transaction.bind(database);
    this.#host = host === undefined ? undefined : captureHost(host);
  }
  execute(envelopeInput: unknown): OfflineCommitOutcome {
    return this.#execute(envelopeInput, false);
  }
  /** Fixed checkout composition retains the original native phase graph. */
  executeCapturedCheckout(envelopeInput: unknown): OfflineCommitOutcome {
    return this.#execute(envelopeInput, true);
  }
  #execute(
    envelopeInput: unknown,
    capturedCheckout: boolean,
  ): OfflineCommitOutcome {
    const busy = active.get(this.#database);
    if (busy) {
      busy();
      throw new DomainError(code, message);
    }
    let poisoned = false,
      lifetime = true,
      calls = 0,
      committed = false;
    let resultHash = "",
      binding = "";
    active.set(this.#database, () => {
      poisoned = true;
    });
    try {
      const host = this.#host;
      insist(host);
      // Database.transaction joins schema initialization with a SAVEPOINT.
      // This boundary must own the actual outer COMMIT, never that savepoint
      // or another caller's still-open writer. Owner scopes remain natively
      // refused by Database.transaction itself.
      let existingWriter = false;
      try {
        Database.prototype.requireTransaction.call(this.#database);
        existingWriter = true;
      } catch {
        /* No application writer, or an excluded owner SQL scope. */
      }
      insist(!existingWriter);
      const envelope = parseOfflineTaskEnvelope(envelopeInput);
      if (capturedCheckout)
        insist(
          envelope.task.owner === "integration" &&
            envelope.task.name === "integration.checkout-paid.import" &&
            envelope.task.version === 1,
        );
      insist(
        envelope.task.owner === host.task.owner &&
          envelope.task.name === host.task.name &&
          envelope.task.version === host.task.version &&
          envelope.operations.adapterIdentity === host.adapter.identity,
      );
      binding = offlineTaskBinding(envelope);
      const request: OfflineCommitRequest = Object.freeze({
        purpose: "distributor-offline-commit-v1",
        envelopeBinding: binding,
        envelope,
      });
      const held = () => {
        // No truthy flags/claims/results and no thenable property access.
        insist(host.adapter.assertHeld(request) === undefined && !poisoned);
      };
      const returned = host.adapter.hold(request, (...args: unknown[]) => {
        if (!lifetime || ++calls !== 1 || args.length !== 0 || poisoned) {
          poisoned = true;
          throw new DomainError(code, message);
        }
        try {
          this.#transaction(() => {
            held();
            const review = capturedCheckout
              ? capturedPhaseReview.call(this.#phase, envelope)
              : this.#phase.reviewInTransaction(envelope);
            insist(review.envelopeBinding === request.envelopeBinding);
            const before = this.#platform.offline.readInTransaction();
            insist(before);
            insist(host.operation(envelope, review) === undefined);
            insist(!poisoned);
            const after = this.#platform.offline.readInTransaction();
            const history =
              this.#platform.restore.offlineReleaseHistoryInTransaction();
            insist(
              after &&
                history.releases.length === 0 &&
                history.classification.barrier === "no-recorded-release",
            );
            const step = after.state.sessions.at(-1)?.history.at(-1);
            insist(step?.kind === "record-task" && step.receipt);
            const receipt = step.receipt;
            insist(
              receipt.owner === envelope.task.owner &&
                receipt.orgId === envelope.task.orgId &&
                receipt.taskName === envelope.task.name &&
                receipt.requestId === envelope.requestId &&
                receipt.binding === binding &&
                receipt.payloadHash === envelope.task.payloadHash &&
                receipt.beforeCandidateHash === envelope.candidate.logicalHash,
            );
            const expected = evaluateOfflinePhaseTransition(
              before.state,
              offlinePhaseExpectation(before.state),
              { kind: "record-task", receipt },
              [],
            );
            insist(
              after.anchor.revision === before.anchor.revision + 1 &&
                canonical(after.state) === canonical(expected.next),
            );
            // Owner writes necessarily change logicalHash. Retain the exact raw
            // hold/schema/region/org binding and Database's private inode pin.
            const { logicalHash: _logical, ...candidate } =
              this.#database.captureRestoreCandidateInTransaction();
            const { instanceId: _instance, ...generation } = envelope.recovery;
            insist(canonical(candidate) === canonical(generation));
            resultHash = receipt.resultHash;
            held();
            // No host calls between here and native COMMIT. The qualified
            // adapter must keep the interlock held through transaction return.
          });
          committed = true;
        } catch {
          poisoned = true;
          throw new DomainError(code, message);
        }
      });
      insist(returned === undefined && calls === 1 && !poisoned && committed);
      return Object.freeze({
        version: 1,
        status: "committed",
        envelopeBinding: binding,
        resultHash,
      });
    } catch {
      // Native transaction returns only after COMMIT. Adapter cleanup, a second
      // callback or a thenable return after that point cannot roll SQL back.
      if (committed)
        return Object.freeze({
          version: 1,
          status: "committed-recovery-required",
          envelopeBinding: binding,
          resultHash,
        });
      throw new DomainError(code, message);
    } finally {
      lifetime = false;
      active.delete(this.#database);
    }
  }
}
