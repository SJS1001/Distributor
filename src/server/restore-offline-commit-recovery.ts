import { lstatSync } from "node:fs";
import { isAbsolute } from "node:path";
import { types } from "node:util";
import { canonical, check, DomainError, permit, type Actor } from "./core.ts";
import { Database, Store } from "./database.ts";
import { Identity } from "./iam.ts";
import { MultiFactor } from "./iam-mfa.ts";
import { FactorCipher } from "./totp.ts";
import { RestoreOfflineStorage } from "./restore-offline-storage.ts";
import { RestoreActivation } from "./restore-activation.ts";
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
// Module-load baselines, never descriptors learned after a host callback.
const descriptors = new Map<object, PropertyDescriptorMap>(
  [
    Database,
    Store,
    Identity,
    MultiFactor,
    FactorCipher,
    Platform,
    RestoreOfflineStorage,
    RestoreActivation,
  ].map((c) => [c.prototype, Object.getOwnPropertyDescriptors(c.prototype)]),
);
// Descriptor-only capture is also safe for legacy construction. Strict entry
// validates every captured child before using it; no private runtime data leaves.
function member(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || types.isProxy(value))
    return undefined;
  const d = Object.getOwnPropertyDescriptor(value, key);
  return d && "value" in d ? d.value : undefined;
}
function owner(value: unknown, prototype: object): asserts value is object {
  insist(value && typeof value === "object" && !types.isProxy(value));
  insist(Object.getPrototypeOf(value) === prototype);
  const keys = Reflect.ownKeys(value);
  insist(keys.length <= 64);
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    insist(d && "value" in d);
  }
  const pinned = descriptors.get(prototype)!,
    current = Object.getOwnPropertyDescriptors(prototype);
  insist(Reflect.ownKeys(current).length === Reflect.ownKeys(pinned).length);
  for (const key of Reflect.ownKeys(pinned)) {
    const a = current[key as string],
      b = pinned[key as string]!;
    insist(
      a &&
        a.value === b.value &&
        a.get === b.get &&
        a.set === b.set &&
        a.enumerable === b.enumerable &&
        a.configurable === b.configurable &&
        a.writable === b.writable,
    );
    if (key !== "constructor")
      insist(!Object.getOwnPropertyDescriptor(value, key));
  }
}
function principal(input: Actor): Actor {
  insist(input && typeof input === "object" && !types.isProxy(input));
  insist(Object.getPrototypeOf(input) === Object.prototype);
  const keys = Reflect.ownKeys(input);
  insist(keys.length <= 16);
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(input, k);
    insist(typeof k === "string" && d && "value" in d && d.enumerable);
  }
  const id = member(input, "id"),
    orgId = member(input, "orgId");
  for (const value of [id, orgId])
    insist(typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value));
  // Only inert locators reach IAM. Current native grants are freshly resolved.
  return { id, orgId } as Actor;
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
  readonly #graph: readonly (readonly [unknown, object])[];
  readonly #links: readonly (readonly [unknown, string, unknown])[];
  #busy = false;
  #poison = false;
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
    this.#path = member(database, "path") as string;
    const offline = member(platform, "offline"),
      restore = member(platform, "restore"),
      mfa = member(identity, "mfa"),
      cipher = member(mfa, "cipher");
    const objects = [
      [platform, Platform.prototype, "platform"],
      [offline, RestoreOfflineStorage.prototype, "platform"],
      [restore, RestoreActivation.prototype, "platform"],
      [identity, Identity.prototype, "iam"],
      [mfa, MultiFactor.prototype, "iam"],
    ] as const;
    this.#graph = [
      [database, Database.prototype],
      [cipher, FactorCipher.prototype],
      ...objects.map(([v, p]) => [v, p] as const),
      ...objects.map(([v]) => [member(v, "store"), Store.prototype] as const),
    ];
    this.#links = [
      [platform, "offline", offline],
      [platform, "restore", restore],
      [identity, "platform", platform],
      [identity, "mfa", mfa],
      [mfa, "platform", platform],
      [mfa, "cipher", cipher],
      [identity, "region", member(identity, "region")],
      [identity, "mfaRequiredRoles", member(identity, "mfaRequiredRoles")],
      ...objects.flatMap(([v, , namespace]) => {
        const store = member(v, "store");
        return [
          [v, "database", database],
          [v, "store", store],
          [store, "database", database],
          [store, "owner", namespace],
        ] as const;
      }),
    ];
  }
  #owners() {
    insist(!this.#poison);
    for (const [v, p] of this.#graph) owner(v, p);
    for (const [v, key, expected] of this.#links)
      insist(member(v, key) === expected);
    insist(member(this.#database, "path") === this.#path);
    const roles = member(this.#identity, "mfaRequiredRoles");
    insist(roles && typeof roles === "object" && !types.isProxy(roles));
    insist(
      Array.isArray(roles) && Object.getPrototypeOf(roles) === Array.prototype,
    );
    const length = member(roles, "length");
    insist(
      typeof length === "number" &&
        Number.isSafeInteger(length) &&
        length <= 16,
    );
    insist(Reflect.ownKeys(roles).length === length + 1);
    for (let i = 0; i < length; i++)
      insist(typeof member(roles, String(i)) === "string");
    const restore = member(this.#platform, "restore");
    const accessor = descriptors.get(RestoreActivation.prototype)!
      .offlineStorage!.get!;
    insist(accessor.call(restore) === member(this.#platform, "offline"));
  }
  /** Fixed checkout recovery entry. No caller strictness switch or authority. */
  getCapturedCheckoutInTransaction(
    actor: Actor,
    envelopeInput: unknown,
  ): OfflineCommitRecovery {
    if (this.#busy) {
      this.#poison = true;
      insist(false);
    }
    this.#busy = true;
    this.#poison = false;
    try {
      return this.#get(actor, envelopeInput, true);
    } finally {
      this.#busy = false;
    }
  }
  getInTransaction(
    actor: Actor,
    envelopeInput: unknown,
  ): OfflineCommitRecovery {
    return this.#get(actor, envelopeInput, false);
  }
  #get(
    actor: Actor,
    envelopeInput: unknown,
    strict: boolean,
  ): OfflineCommitRecovery {
    if (strict) this.#owners();
    this.#database.requireTransaction();
    try {
      if (strict) actor = principal(actor);
      const counter = member(this.#platform, "store") as Store;
      const changes = strict
        ? counter.get("SELECT total_changes() AS n")!.n
        : undefined;
      const hold = strict
        ? this.#platform.rawRecoveryHoldInTransaction()
        : undefined;
      if (strict) insist(hold);
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
      if (strict) this.#owners();
      insist(
        file.isFile() &&
          !file.isSymbolicLink() &&
          envelope.candidate.file.dev === number(file.dev) &&
          envelope.candidate.file.ino === number(file.ino),
      );
      const unchanged = pinRestoreCandidateFiles(this.#path, file);
      if (strict) this.#owners();
      // This validates the complete bounded journal, all generations, canonical
      // receipt rows, append sequence, hashes and durable head before lookup.
      const retained = this.#platform.offline.readInTransaction();
      if (strict) this.#owners();
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
      if (strict) this.#owners();
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
      if (strict) this.#owners();
      unchanged();
      if (strict) {
        this.#owners();
        const refreshed = this.#identity.currentActor(actor);
        permit(refreshed, ["finance"]);
        insist(
          !refreshed.accountId &&
            !this.#identity.security(refreshed).passwordChangeRequired,
        );
        insist(
          canonical(this.#platform.rawRecoveryHoldInTransaction()) ===
            canonical(hold),
        );
        insist(counter.get("SELECT total_changes() AS n")!.n === changes);
        this.#owners();
      }
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
