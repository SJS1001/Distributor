import { lstatSync } from "node:fs";
import { isAbsolute } from "node:path";
import { types } from "node:util";
import { canonical, check, DomainError } from "./core.ts";
import { Database, Store } from "./database.ts";
import { Platform } from "./platform.ts";
import { RestoreOfflineStorage } from "./restore-offline-storage.ts";
import { RestoreActivation } from "./restore-activation.ts";
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
const ownerDescriptors = new Map<object, PropertyDescriptorMap>(
  [Database, Store, Platform, RestoreOfflineStorage, RestoreActivation].map(
    (owner) => [
      owner.prototype,
      Object.getOwnPropertyDescriptors(owner.prototype),
    ],
  ),
);
function member(owner: object, key: string): unknown {
  insist(!types.isProxy(owner));
  const d = Object.getOwnPropertyDescriptor(owner, key);
  insist(d && "value" in d);
  return d.value;
}
function owner(value: unknown, prototype: object): asserts value is object {
  insist(value && typeof value === "object" && !types.isProxy(value));
  insist(Object.getPrototypeOf(value) === prototype);
  insist(Reflect.ownKeys(value).length <= 64);
  for (const key of Reflect.ownKeys(value)) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    insist(d && "value" in d);
  }
  const pinned = ownerDescriptors.get(prototype)!;
  const current = Object.getOwnPropertyDescriptors(prototype);
  insist(Reflect.ownKeys(current).length === Reflect.ownKeys(pinned).length);
  for (const key of Reflect.ownKeys(pinned)) {
    const d = pinned[key as keyof typeof pinned],
      now = current[key as keyof typeof current];
    insist(d);
    insist(
      now &&
        now.value === d.value &&
        now.get === d.get &&
        now.set === d.set &&
        now.enumerable === d.enumerable &&
        now.configurable === d.configurable &&
        now.writable === d.writable,
    );
    if (key !== "constructor")
      insist(!Object.getOwnPropertyDescriptor(value, key));
  }
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
  readonly #graph: readonly (readonly [object, object])[];
  readonly #links: readonly (readonly [object, string, unknown])[];
  constructor(database: Database, platform: Platform) {
    owner(database, Database.prototype);
    owner(platform, Platform.prototype);
    const offline = member(platform, "offline"),
      restore = member(platform, "restore");
    owner(offline, RestoreOfflineStorage.prototype);
    owner(restore, RestoreActivation.prototype);
    const objects = [
      [platform, Platform.prototype],
      [offline, RestoreOfflineStorage.prototype],
      [restore, RestoreActivation.prototype],
    ] as const;
    const stores = objects.map(([value]) => {
      const store = member(value, "store");
      owner(store, Store.prototype);
      insist(
        member(store, "database") === database &&
          member(store, "owner") === "platform",
      );
      insist(member(value, "database") === database);
      return [store, Store.prototype] as const;
    });
    this.#graph = [[database, Database.prototype], ...objects, ...stores];
    this.#links = [
      [platform, "offline", offline],
      [platform, "restore", restore],
      ...objects.flatMap(
        ([value]) =>
          [
            [value, "database", database],
            [value, "store", member(value, "store")],
          ] as const,
      ),
      ...stores.flatMap(
        ([store]) =>
          [
            [store, "database", database],
            [store, "owner", "platform"],
          ] as const,
      ),
    ];
    this.#database = database;
    this.#platform = platform;
    const path = member(database, "path");
    insist(typeof path === "string");
    this.#path = path;
    this.#owners();
  }
  #owners() {
    for (const [value, prototype] of this.#graph) owner(value, prototype);
    for (const [value, key, expected] of this.#links)
      insist(member(value, key) === expected);
    insist(member(this.#database, "path") === this.#path);
  }
  reviewInTransaction(envelopeInput: unknown): OfflineNativePhaseReview {
    this.#owners();
    this.#database.requireTransaction();
    try {
      const envelope = parseOfflineTaskEnvelope(envelopeInput);
      insist(
        typeof this.#path === "string" &&
          isAbsolute(this.#path) &&
          this.#database.path === this.#path,
      );
      const file = lstatSync(this.#path, { bigint: true });
      this.#owners();
      insist(file.isFile() && !file.isSymbolicLink());
      insist(
        envelope.candidate.file.dev === safeIdentity(file.dev) &&
          envelope.candidate.file.ino === safeIdentity(file.ino),
      );
      // This outer pin extends the existing Database pin around all native reads.
      // Database still independently compares against its private opened identity.
      const unchanged = pinRestoreCandidateFiles(this.#path, file);
      this.#owners();
      const retained = this.#platform.offline.readInTransaction();
      this.#owners();
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
      this.#owners();
      const candidate = this.#database.captureRestoreCandidateInTransaction();
      const { instanceId: _instance, ...nativeBinding } = generation;
      const { logicalHash, ...candidateBinding } = candidate;
      insist(
        canonical(nativeBinding) === canonical(candidateBinding) &&
          envelope.candidate.logicalHash === logicalHash,
      );
      // No current()-filtered view: recheck complete native history and the exact
      // durable head before returning, still in this synchronous writer scope.
      this.#owners();
      const finalHistory =
        this.#platform.restore.offlineReleaseHistoryInTransaction();
      this.#owners();
      const finalRetained = this.#platform.offline.readInTransaction();
      insist(
        canonical(finalHistory) === canonical(history) &&
          canonical(finalRetained) === canonical(retained) &&
          this.#database.path === this.#path,
      );
      unchanged();
      this.#owners();
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
