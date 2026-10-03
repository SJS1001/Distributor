import { types } from "node:util";
import { canonical, check, digest } from "./core.ts";
import { Database, type Store } from "./database.ts";
import { RESTORE_OFFLINE_DDL } from "./restore-offline-schema.ts";
import {
  evaluateOfflinePhaseTransition,
  offlinePhaseExpectation,
  parseOfflineRecoveryGeneration,
  validateOfflinePhaseState,
  type OfflinePhaseState,
  type OfflineRecoveryGeneration,
} from "./restore-offline-phase.ts";

export type OfflineStorageAnchor = Readonly<{
  instanceId: string;
  revision: number;
  stateHash: string;
  journalHash: string;
}>;
export type OfflineStorageSnapshot = Readonly<{
  status: "retained-offline-state";
  anchor: OfflineStorageAnchor;
  state: OfflinePhaseState;
}>;
const zero = "0".repeat(64),
  maxJournal = 1000,
  maxGenerations = 64,
  maxRecordBytes = 4 * 1024 ** 2,
  maxStorageBytes = 64 * 1024 ** 2;
const textColumns = {
  platform_offline_generations: [
    "instance_id",
    "generation",
    "generation_hash",
  ],
  platform_offline_journal: [
    "instance_id",
    "record",
    "previous_hash",
    "state_hash",
    "hash",
  ],
  platform_offline_head: ["instance_id", "state", "state_hash", "journal_hash"],
  platform_offline_receipts: [
    "owner",
    "org_id",
    "task_name",
    "request_id",
    "binding",
    "instance_id",
    "session_id",
    "record",
    "hash",
  ],
} as const;
function insist(value: unknown, message: string): asserts value {
  check(value, "RESTORE_OFFLINE_STORAGE", message);
}
function record(
  value: unknown,
  keys: string[],
): asserts value is Record<string, unknown> {
  insist(
    value !== null &&
      typeof value === "object" &&
      !types.isProxy(value) &&
      Object.getPrototypeOf(value) === Object.prototype,
    "Use plain offline storage inputs.",
  );
  const descriptors = Object.getOwnPropertyDescriptors(value);
  insist(
    Reflect.ownKeys(value).length === keys.length &&
      keys.every((key) => {
        const d = descriptors[key];
        return d && "value" in d && d.enumerable;
      }),
    "Use exact offline storage fields.",
  );
}
function hash(value: unknown): asserts value is string {
  insist(
    typeof value === "string" && /^[a-f0-9]{64}$/.test(value),
    "Offline storage hash is invalid.",
  );
}
function anchor(value: unknown): OfflineStorageAnchor {
  record(value, ["instanceId", "revision", "stateHash", "journalHash"]);
  hash(value.instanceId);
  hash(value.stateHash);
  hash(value.journalHash);
  insist(
    Number.isSafeInteger(value.revision) && Number(value.revision) > 0,
    "Offline storage revision is invalid.",
  );
  return Object.freeze({
    instanceId: value.instanceId,
    revision: Number(value.revision),
    stateHash: value.stateHash,
    journalHash: value.journalHash,
  });
}
function encode(value: unknown) {
  const raw = canonical(value);
  insist(
    Buffer.byteLength(raw) <= maxRecordBytes,
    "Offline storage record limit exceeded.",
  );
  return raw;
}
function decode(raw: unknown): unknown {
  insist(
    typeof raw === "string" && Buffer.byteLength(raw) <= maxRecordBytes,
    "Offline storage record is invalid.",
  );
  try {
    return JSON.parse(raw);
  } catch {
    insist(false, "Offline storage JSON is damaged.");
  }
}
function snapshot(
  state: OfflinePhaseState,
  revision: number,
  journalHash: string,
): OfflineStorageSnapshot {
  return Object.freeze({
    status: "retained-offline-state",
    anchor: Object.freeze({
      instanceId: state.generation.instanceId,
      revision,
      stateHash: offlinePhaseExpectation(state).stateHash,
      journalHash,
    }),
    state,
  });
}
function journalHash(
  revision: number,
  instanceId: string,
  operation: unknown,
  previousHash: string,
  stateHash: string,
) {
  return digest(
    canonical({
      purpose: "distributor-restore-offline-storage-journal-v1",
      revision,
      instanceId,
      operation,
      previousHash,
      stateHash,
    }),
  );
}
function taskRow(state: OfflinePhaseState, revision: number) {
  const session = state.sessions.at(-1),
    receipt = session?.history.at(-1)?.receipt;
  if (!receipt) return null;
  const raw = encode(receipt);
  return {
    owner: receipt.owner,
    org_id: receipt.orgId,
    task_name: receipt.taskName,
    request_id: receipt.requestId,
    binding: receipt.binding,
    instance_id: state.generation.instanceId,
    session_id: session!.id,
    revision,
    record: raw,
    hash: digest(raw),
  };
}
function requestKey(row: NonNullable<ReturnType<typeof taskRow>>) {
  return canonical([row.owner, row.org_id, row.task_name, row.request_id]);
}
function changedHold(
  previous: OfflinePhaseState["generation"],
  next: OfflinePhaseState["generation"],
) {
  return (
    previous.snapshotHash !== next.snapshotHash ||
    previous.restoredAt !== next.restoredAt ||
    previous.sourceCompletedAt !== next.sourceCompletedAt
  );
}

/** Low-level storage only. Every operation joins the caller's existing native
 * writer transaction; callers must allow failures to abort that transaction.
 * No method supplies isolation, current authority, a permit or provider access.
 */
export class RestoreOfflineStorage {
  private store: Store;
  constructor(private database: Database) {
    this.store = database.owned("platform");
    this.store.migrate(
      RESTORE_OFFLINE_DDL.replaceAll(
        "CREATE TABLE ",
        "CREATE TABLE IF NOT EXISTS ",
      ).replaceAll("CREATE TRIGGER ", "CREATE TRIGGER IF NOT EXISTS "),
    );
  }
  private retainedBytes() {
    let total = 0;
    // Fixed identifiers only. Reject oversized damaged cells before fetching text.
    for (const [table, columns] of Object.entries(textColumns)) {
      const lengths = columns.map(
        (column) => `length(CAST(${column} AS BLOB))`,
      );
      const sizes = this.store.get(
        `SELECT coalesce(sum(${lengths.join("+")}),0) AS total,coalesce(max(max(${lengths.join(",")})),0) AS largest FROM ${table}`,
      )!;
      insist(
        Number(sizes.largest) <= maxRecordBytes,
        "Offline retained field limit exceeded.",
      );
      total += Number(sizes.total);
      insist(
        Number.isSafeInteger(total) && total <= maxStorageBytes,
        "Offline retained byte limit exceeded.",
      );
    }
    return total;
  }
  /** Historical retained state, never an assertion of the current generation. */
  readInTransaction(): OfflineStorageSnapshot | null {
    this.database.requireTransaction();
    for (const [table, bound] of [
      ["platform_offline_generations", maxGenerations],
      ["platform_offline_journal", maxJournal],
      ["platform_offline_receipts", maxJournal],
      ["platform_offline_head", 1],
    ] as const) {
      insist(
        Number(this.store.get(`SELECT count(*) AS n FROM ${table}`)!.n) <=
          bound,
        "Offline storage history limit exceeded.",
      );
    }
    this.retainedBytes();
    const generations = this.store.all(
        "SELECT * FROM platform_offline_generations ORDER BY created_revision",
      ),
      heads = this.store.all("SELECT * FROM platform_offline_head"),
      expectedReceipts: NonNullable<ReturnType<typeof taskRow>>[] = [],
      usedInstances = new Set<string>(),
      usedRequests = new Set<string>(),
      usedBindings = new Set<string>();
    let result: OfflineStorageSnapshot | null = null,
      count = 0;
    // Stream records rather than accumulating all historical JSON snapshots.
    this.store.visit(
      "SELECT * FROM platform_offline_journal ORDER BY revision",
      [],
      (row) => {
        insist(
          row.revision === ++count,
          "Offline journal revision is missing or out of order.",
        );
        const operation = decode(row.record);
        insist(
          operation !== null && typeof operation === "object",
          "Offline journal operation is invalid.",
        );
        const kind = (operation as { kind?: unknown }).kind;
        let state: OfflinePhaseState;
        if (kind === "create") {
          record(operation, ["kind", "generation", "releases"]);
          const gen = parseOfflineRecoveryGeneration(operation.generation);
          insist(
            !usedInstances.has(gen.instanceId),
            "Recovery instance was reused.",
          );
          if (result)
            insist(
              changedHold(result.state.generation, gen),
              "Generation replacement requires a changed native restore hold.",
            );
          const saved = generations[usedInstances.size];
          state = validateOfflinePhaseState({
            version: 1,
            generation: gen,
            releases: operation.releases,
            sessions: [],
          });
          insist(
            saved &&
              saved.instance_id === gen.instanceId &&
              saved.created_revision === count &&
              saved.generation === encode(gen) &&
              saved.generation_hash ===
                offlinePhaseExpectation(state).generationHash,
            "Generation provenance is missing or damaged.",
          );
          if (result) this.retainReleasePrefixes(result.state, state);
          usedInstances.add(gen.instanceId);
        } else {
          record(operation, ["kind", "transition", "releases"]);
          insist(
            kind === "transition" && result,
            "Offline transition has no generation.",
          );
          state = evaluateOfflinePhaseTransition(
            result.state,
            offlinePhaseExpectation(result.state),
            operation.transition,
            operation.releases,
          ).next;
          const receipt = taskRow(state, count);
          if (receipt) {
            insist(
              !usedRequests.has(requestKey(receipt)) &&
                !usedBindings.has(receipt.binding),
              "Global offline task identity or binding was reused.",
            );
            usedRequests.add(requestKey(receipt));
            usedBindings.add(receipt.binding);
            expectedReceipts.push(receipt);
          }
        }
        const previousHash = result?.anchor.journalHash ?? zero,
          stateHash = offlinePhaseExpectation(state).stateHash;
        insist(
          row.instance_id === state.generation.instanceId &&
            row.previous_hash === previousHash &&
            row.state_hash === stateHash &&
            row.record === encode(operation),
          "Offline journal binding is inconsistent.",
        );
        const hash = journalHash(
          count,
          state.generation.instanceId,
          operation,
          previousHash,
          stateHash,
        );
        insist(row.hash === hash, "Offline journal hash is inconsistent.");
        result = snapshot(state, count, hash);
      },
    );
    insist(
      generations.length === usedInstances.size,
      "Orphaned recovery generation.",
    );
    const receipts = this.store.all(
      "SELECT * FROM platform_offline_receipts ORDER BY revision",
    );
    insist(
      canonical(receipts) === canonical(expectedReceipts),
      "Offline task receipt provenance is missing or damaged.",
    );
    if (!result) {
      insist(heads.length === 0, "Offline head lacks retained history.");
      return null;
    }
    const current = result as OfflineStorageSnapshot,
      head = heads[0];
    insist(
      heads.length === 1 &&
        head!.id === 1 &&
        head!.instance_id === current.anchor.instanceId &&
        head!.revision === current.anchor.revision &&
        head!.state === encode(current.state) &&
        head!.state_hash === current.anchor.stateHash &&
        head!.journal_hash === current.anchor.journalHash,
      "Offline head does not match its complete retained journal.",
    );
    return current;
  }
  private expected(input: unknown, current: OfflineStorageSnapshot | null) {
    if (current === null)
      insist(input === null, "Expected an empty offline storage head.");
    else
      insist(
        canonical(anchor(input)) === canonical(current.anchor),
        "Stale offline storage head.",
      );
  }
  private nativeGeneration(gen: OfflineRecoveryGeneration) {
    // Fixed same-writer read, not foreign owner SQL and not a qualification grant.
    const candidate = this.database.captureRestoreCandidateInTransaction();
    const metadata = this.store.get(
      "SELECT version FROM platform_schema_version WHERE singleton=1",
    );
    const { version: _format, instanceId: _instance, ...binding } = gen;
    insist(
      canonical(binding) ===
        canonical({
          snapshotHash: candidate.snapshotHash,
          restoredAt: candidate.restoredAt,
          sourceCompletedAt: candidate.sourceCompletedAt,
          schemaVersion: metadata?.version,
          schemaHash: candidate.schemaHash,
          region: candidate.region,
          organizations: candidate.organizations,
        }),
      "Supplied generation differs from the native candidate hold/schema/organizations.",
    );
  }
  createGenerationInTransaction(
    generationInput: unknown,
    expectedHead: unknown,
    retainedReleases: unknown,
  ): OfflineStorageSnapshot {
    this.database.requireTransaction();
    const gen = parseOfflineRecoveryGeneration(generationInput),
      current = this.readInTransaction();
    this.expected(expectedHead, current);
    this.nativeGeneration(gen);
    insist(
      !this.store.get(
        "SELECT instance_id FROM platform_offline_generations WHERE instance_id=?",
        gen.instanceId,
      ),
      "Recovery instance was already retained.",
    );
    insist(
      Number(
        this.store.get(
          "SELECT count(*) AS n FROM platform_offline_generations",
        )!.n,
      ) < maxGenerations,
      "Offline generation limit exceeded.",
    );
    if (current)
      insist(
        changedHold(current.state.generation, gen),
        "Generation replacement requires a changed native restore hold.",
      );
    const state = validateOfflinePhaseState({
      version: 1,
      generation: gen,
      releases: retainedReleases,
      sessions: [],
    });
    // Retained release history must never disappear when the raw generation rotates.
    if (current) this.retainReleasePrefixes(current.state, state);
    return this.append(current, state, {
      kind: "create",
      generation: gen,
      releases: state.releases,
    });
  }
  private retainReleasePrefixes(
    previous: OfflinePhaseState,
    next: OfflinePhaseState,
  ) {
    for (const old of previous.releases) {
      const now = next.releases.find((r) => r.id === old.id);
      insist(
        now &&
          now.binding === old.binding &&
          now.revision >= old.revision &&
          canonical(now.history.slice(0, old.history.length)) ===
            canonical(old.history) &&
          (old.forwardRecoveryRequired !== true ||
            now.forwardRecoveryRequired === true) &&
          (now.revision !== old.revision || canonical(now) === canonical(old)),
        "Generation rotation cannot erase retained release history.",
      );
    }
  }
  transitionInTransaction(
    generationInput: unknown,
    expectedHead: unknown,
    transitionInput: unknown,
    observedReleases: unknown,
  ): OfflineStorageSnapshot {
    this.database.requireTransaction();
    const gen = parseOfflineRecoveryGeneration(generationInput),
      current = this.readInTransaction();
    insist(current, "Offline generation has not been explicitly created.");
    this.expected(expectedHead, current);
    insist(
      canonical(gen) === canonical(current.state.generation),
      "Supplied generation is not the retained storage head.",
    );
    this.nativeGeneration(gen);
    const state = evaluateOfflinePhaseTransition(
      current.state,
      offlinePhaseExpectation(current.state),
      transitionInput,
      observedReleases,
    ).next;
    const session = state.sessions.at(-1)!,
      step = session.history.at(-1)!;
    // Persist only the detached normalized transition produced by the validator.
    const transition =
      step.kind === "isolate"
        ? { kind: step.kind, sessionId: session.id }
        : step.kind === "record-task"
          ? { kind: step.kind, receipt: step.receipt }
          : step.kind === "invalidate"
            ? { kind: step.kind, reason: step.reason }
            : { kind: step.kind };
    const receipt = taskRow(state, current.anchor.revision + 1);
    if (receipt)
      insist(
        !this.store.get(
          "SELECT binding FROM platform_offline_receipts WHERE binding=? OR (owner=? AND org_id=? AND task_name=? AND request_id=?)",
          receipt.binding,
          receipt.owner,
          receipt.org_id,
          receipt.task_name,
          receipt.request_id,
        ),
        "Global offline task identity or binding was already retained.",
      );
    return this.append(current, state, {
      kind: "transition",
      transition,
      releases: state.releases,
    });
  }
  private append(
    current: OfflineStorageSnapshot | null,
    state: OfflinePhaseState,
    operation: { kind: "create" | "transition" } & Record<string, unknown>,
  ) {
    const revision = (current?.anchor.revision ?? 0) + 1;
    insist(
      Number.isSafeInteger(revision) && revision <= maxJournal,
      "Offline journal limit exceeded.",
    );
    const raw = encode(operation),
      rawState = encode(state),
      stateHash = offlinePhaseExpectation(state).stateHash,
      previousHash = current?.anchor.journalHash ?? zero,
      hash = journalHash(
        revision,
        state.generation.instanceId,
        operation,
        previousHash,
        stateHash,
      );
    const receipt =
      operation.kind === "transition" ? taskRow(state, revision) : null;
    // Conservative capacity check includes the old head and all replacement bytes.
    // Refusal occurs before the first write; no pruning or automatic archival.
    insist(
      this.retainedBytes() +
        Buffer.byteLength(raw) +
        Buffer.byteLength(rawState) +
        (operation.kind === "create"
          ? Buffer.byteLength(encode(state.generation))
          : 0) +
        (receipt ? Buffer.byteLength(encode(receipt)) : 0) +
        4096 <=
        maxStorageBytes,
      "Offline retained byte limit exceeded.",
    );
    if (operation.kind === "create")
      this.store.run(
        "INSERT INTO platform_offline_generations VALUES(?,?,?,?)",
        state.generation.instanceId,
        revision,
        encode(state.generation),
        offlinePhaseExpectation(state).generationHash,
      );
    this.store.run(
      "INSERT INTO platform_offline_journal VALUES(?,?,?,?,?,?)",
      revision,
      state.generation.instanceId,
      raw,
      previousHash,
      stateHash,
      hash,
    );
    if (receipt)
      this.store.run(
        "INSERT INTO platform_offline_receipts VALUES(?,?,?,?,?,?,?,?,?,?)",
        receipt.owner,
        receipt.org_id,
        receipt.task_name,
        receipt.request_id,
        receipt.binding,
        receipt.instance_id,
        receipt.session_id,
        revision,
        receipt.record,
        receipt.hash,
      );
    if (current)
      insist(
        this.store.run(
          "UPDATE platform_offline_head SET instance_id=?,revision=?,state=?,state_hash=?,journal_hash=? WHERE id=1 AND instance_id=? AND revision=? AND state_hash=? AND journal_hash=?",
          state.generation.instanceId,
          revision,
          rawState,
          stateHash,
          hash,
          current.anchor.instanceId,
          current.anchor.revision,
          current.anchor.stateHash,
          current.anchor.journalHash,
        ).changes === 1,
        "Offline head CAS failed.",
      );
    else
      this.store.run(
        "INSERT INTO platform_offline_head VALUES(1,?,?,?,?,?)",
        state.generation.instanceId,
        revision,
        rawState,
        stateHash,
        hash,
      );
    return snapshot(state, revision, hash);
  }
}
