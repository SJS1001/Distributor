import { lstatSync } from "node:fs";
import { isAbsolute } from "node:path";
import { types } from "node:util";
import { canonical, check, DomainError, permit, type Actor } from "./core.ts";
import { Database } from "./database.ts";
import { Identity } from "./iam.ts";
import { Platform } from "./platform.ts";
import { SCHEMA_VERSION } from "./schema.ts";
import { pinRestoreCandidateFiles } from "./restore-candidate-snapshot.ts";
import {
  offlineTaskBinding,
  parseOfflineTaskEnvelope,
} from "./restore-offline-envelope.ts";
import type { OfflineTaskReceipt } from "./restore-offline-phase.ts";

const code = "RESTORE_OFFLINE_COMMIT_RECOVERY";
const message = "Exact offline task receipt recovery refused.";
const requiredChecks = Object.freeze([
  "independent-current-trust-and-authority",
  "matching-owning-module-result-and-provenance",
  "qualified-source-and-provider-evidence",
  "separate-current-execution-or-release-permit",
] as const);
export type OfflineCommitRecovery = Readonly<{
  version: 1;
  status: "retained-task-receipt-consistency-only" | "no-retained-task-receipt";
  envelopeBinding: string;
  receipt: Readonly<OfflineTaskReceipt> | null;
  session: Readonly<{ id: string; revision: number; lineageHash: string }>;
  storage: Readonly<{
    revision: number;
    stateHash: string;
    journalHash: string;
  }>;
  requiredChecks: typeof requiredChecks;
}>;
function insist(value: unknown): asserts value {
  check(value, code, message);
}
function number(value: bigint) {
  insist(value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER));
  return Number(value);
}

/** Native historical receipt consistency, not a mutation/retry/release permit.
 * Root supplies the same Application's actual Database, Platform and Identity.
 * Recovery is deliberately limited to the same pinned candidate and retained
 * native restore generation. A replaced/released generation needs a separately
 * qualified historical procedure, never an automatic retry of this envelope.
 */
export class RestoreOfflineCommitRecoveryReader {
  readonly #database: Database;
  readonly #platform: Platform;
  readonly #identity: Identity;
  readonly #path: string;
  constructor(database: Database, platform: Platform, identity: Identity) {
    insist(
      !types.isProxy(database) &&
        !types.isProxy(platform) &&
        !types.isProxy(identity) &&
        Object.getPrototypeOf(database) === Database.prototype &&
        Object.getPrototypeOf(platform) === Platform.prototype &&
        Object.getPrototypeOf(identity) === Identity.prototype,
    );
    this.#database = database;
    this.#platform = platform;
    this.#identity = identity;
    this.#path = database.path;
  }
  getInTransaction(
    actor: Actor,
    envelopeInput: unknown,
  ): OfflineCommitRecovery {
    this.#database.requireTransaction();
    try {
      const current = this.#identity.currentActor(actor);
      permit(current, ["finance"]);
      insist(
        !current.accountId &&
          !this.#identity.security(current).passwordChangeRequired,
      );
      const envelope = parseOfflineTaskEnvelope(envelopeInput);
      insist(envelope.task.orgId === current.orgId);
      insist(isAbsolute(this.#path) && this.#database.path === this.#path);
      const file = lstatSync(this.#path, { bigint: true });
      insist(
        file.isFile() &&
          !file.isSymbolicLink() &&
          envelope.candidate.file.dev === number(file.dev) &&
          envelope.candidate.file.ino === number(file.ino),
      );
      const unchanged = pinRestoreCandidateFiles(this.#path, file);
      // This validates the complete bounded journal, all generations, canonical
      // receipt rows, append sequence, hashes and durable head before lookup.
      const retained = this.#platform.offline.readInTransaction();
      insist(retained);
      const {
        version: _version,
        schemaVersion,
        ...generation
      } = retained.state.generation;
      insist(
        schemaVersion === SCHEMA_VERSION &&
          canonical(envelope.recovery) === canonical(generation),
      );
      const { instanceId: _instance, ...nativeGeneration } = generation;
      const { logicalHash: _changedAfterCommit, ...candidate } =
        this.#database.captureRestoreCandidateInTransaction();
      insist(canonical(nativeGeneration) === canonical(candidate));
      const session = retained.state.sessions.find(
        (item) => item.id === envelope.session.id,
      );
      insist(session);
      const preceding = session.history.find(
        (step) => step.revision === envelope.session.revision,
      );
      insist(preceding?.lineageHash === envelope.session.lineageHash);
      const binding = offlineTaskBinding(envelope);
      const matches = retained.state.sessions.flatMap((item) =>
        item.history
          .filter((step) => {
            const r = step.receipt;
            return (
              r &&
              (r.binding === binding ||
                (r.owner === envelope.task.owner &&
                  r.orgId === current.orgId &&
                  r.taskName === envelope.task.name &&
                  r.requestId === envelope.requestId))
            );
          })
          .map((step) => ({ sessionId: item.id, step })),
      );
      insist(matches.length <= 1);
      const found = matches[0];
      const receipt = found?.step.receipt ?? null;
      if (found) {
        insist(
          receipt &&
            found.sessionId === session.id &&
            found.step.kind === "record-task" &&
            found.step.revision === envelope.session.revision + 1 &&
            found.step.previousHash === envelope.session.lineageHash &&
            receipt.owner === envelope.task.owner &&
            receipt.orgId === current.orgId &&
            receipt.taskName === envelope.task.name &&
            receipt.requestId === envelope.requestId &&
            receipt.binding === binding &&
            receipt.payloadHash === envelope.task.payloadHash &&
            receipt.beforeCandidateHash === envelope.candidate.logicalHash,
        );
      }
      insist(
        canonical(this.#platform.offline.readInTransaction()) ===
          canonical(retained) && this.#database.path === this.#path,
      );
      unchanged();
      return Object.freeze({
        version: 1,
        status: receipt
          ? "retained-task-receipt-consistency-only"
          : "no-retained-task-receipt",
        envelopeBinding: binding,
        receipt: receipt ? Object.freeze({ ...receipt }) : null,
        session: Object.freeze({
          id: session.id,
          revision: session.revision,
          lineageHash: session.lineageHash,
        }),
        storage: Object.freeze({
          revision: retained.anchor.revision,
          stateHash: retained.anchor.stateHash,
          journalHash: retained.anchor.journalHash,
        }),
        requiredChecks,
      });
    } catch {
      // Do not leak private paths, raw envelopes, rows or provider evidence.
      throw new DomainError(code, message);
    }
  }
}
