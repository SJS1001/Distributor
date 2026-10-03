import { lstatSync } from "node:fs";
import { isAbsolute } from "node:path";
import { types } from "node:util";
import { canonical, check, DomainError } from "./core.ts";
import { Database } from "./database.ts";
import { Platform } from "./platform.ts";
import { SCHEMA_VERSION } from "./schema.ts";
import { pinRestoreCandidateFiles } from "./restore-candidate-snapshot.ts";
import { offlinePhaseExpectation } from "./restore-offline-phase.ts";
import {
  offlineTaskBinding,
  parseOfflineTaskEnvelope,
} from "./restore-offline-envelope.ts";

const code = "RESTORE_OFFLINE_NATIVE_PHASE";
const message =
  "Offline envelope does not match the current native open phase.";
const requiredChecks = Object.freeze([
  "current-signatures-clock-trust-and-revocation",
  "current-scoped-native-iam",
  "independent-external-authority-and-instance-anchor",
  "qualified-source-and-candidate-fencing",
  "qualified-evidence-and-provider-truth",
  "static-owner-task-payload-and-claim-validation",
] as const);
export type OfflineNativePhaseReview = Readonly<{
  version: 1;
  status: "native-phase-consistency-only";
  envelopeBinding: string;
  candidateHash: string;
  storage: Readonly<{
    revision: number;
    generationHash: string;
    stateHash: string;
    journalHash: string;
  }>;
  session: Readonly<{ revision: number; lineageHash: string }>;
  requiredChecks: typeof requiredChecks;
}>;
function insist(value: unknown): asserts value {
  check(value, code, message);
}
function safeIdentity(value: bigint) {
  insist(value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER));
  return Number(value);
}

/** Fixed native reads only. Trusted composition supplies Database and Platform
 * from the same Application. The result is not an authority or mutation permit. */
export class RestoreOfflineNativePhase {
  readonly #database: Database;
  readonly #platform: Platform;
  readonly #path: string;
  constructor(database: Database, platform: Platform) {
    insist(
      !types.isProxy(database) &&
        !types.isProxy(platform) &&
        database instanceof Database &&
        platform instanceof Platform &&
        Object.getPrototypeOf(database) === Database.prototype &&
        Object.getPrototypeOf(platform) === Platform.prototype,
    );
    this.#database = database;
    this.#platform = platform;
    this.#path = database.path;
  }
  reviewInTransaction(envelopeInput: unknown): OfflineNativePhaseReview {
    this.#database.requireTransaction();
    try {
      const envelope = parseOfflineTaskEnvelope(envelopeInput);
      insist(
        typeof this.#path === "string" &&
          isAbsolute(this.#path) &&
          this.#database.path === this.#path,
      );
      const file = lstatSync(this.#path, { bigint: true });
      insist(file.isFile() && !file.isSymbolicLink());
      insist(
        envelope.candidate.file.dev === safeIdentity(file.dev) &&
          envelope.candidate.file.ino === safeIdentity(file.ino),
      );
      // This outer pin extends the existing Database pin around all native reads.
      // Database still independently compares against its private opened identity.
      const unchanged = pinRestoreCandidateFiles(this.#path, file);
      const retained = this.#platform.offline.readInTransaction();
      const history =
        this.#platform.restore.offlineReleaseHistoryInTransaction();
      insist(retained);
      insist(
        retained.state.releases.length === 0 &&
          history.releases.length === 0 &&
          history.classification.barrier === "no-recorded-release" &&
          history.classification.releaseCount === 0,
      );
      const session = retained.state.sessions.at(-1);
      insist(session?.phase === "open");
      insist(
        envelope.session.id === session.id &&
          envelope.session.revision === session.revision &&
          envelope.session.lineageHash === session.lineageHash,
      );
      const {
        version: _version,
        schemaVersion,
        ...generation
      } = retained.state.generation;
      insist(
        schemaVersion === SCHEMA_VERSION &&
          canonical(envelope.recovery) === canonical(generation),
      );
      const candidate = this.#database.captureRestoreCandidateInTransaction();
      const { instanceId: _instance, ...nativeBinding } = generation;
      const { logicalHash, ...candidateBinding } = candidate;
      insist(
        canonical(nativeBinding) === canonical(candidateBinding) &&
          envelope.candidate.logicalHash === logicalHash,
      );
      // No current()-filtered view: recheck complete native history and the exact
      // durable head before returning, still in this synchronous writer scope.
      const finalHistory =
        this.#platform.restore.offlineReleaseHistoryInTransaction();
      const finalRetained = this.#platform.offline.readInTransaction();
      insist(
        canonical(finalHistory) === canonical(history) &&
          canonical(finalRetained) === canonical(retained) &&
          this.#database.path === this.#path,
      );
      unchanged();
      const expectation = offlinePhaseExpectation(retained.state);
      return Object.freeze({
        version: 1,
        status: "native-phase-consistency-only",
        envelopeBinding: offlineTaskBinding(envelope),
        candidateHash: logicalHash,
        storage: Object.freeze({
          revision: retained.anchor.revision,
          generationHash: expectation.generationHash,
          stateHash: retained.anchor.stateHash,
          journalHash: retained.anchor.journalHash,
        }),
        session: Object.freeze({
          revision: session.revision,
          lineageHash: session.lineageHash,
        }),
        requiredChecks,
      });
    } catch {
      // Filesystem/SQLite diagnostics may contain private paths or raw values.
      // Never return native rows, envelope contents or a chained private error.
      throw new DomainError(code, message);
    }
  }
}
