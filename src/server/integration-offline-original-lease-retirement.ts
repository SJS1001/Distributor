import { types } from "node:util";
import {
  canonical,
  check,
  digest,
  permit,
  type Actor,
  type Row,
} from "./core.ts";
import { Database, Store } from "./database.ts";
import { Identity } from "./iam.ts";
import { Platform } from "./platform.ts";
import { IntegrationCosts } from "./integration-costs.ts";
import {
  StockJournalDelivery,
  type OfflineOriginalLeaseReview,
  type OfflineOriginalLeaseRetirementInput,
  type OfflineOriginalLeaseRetirementReceipt,
} from "./stock-journal-delivery.ts";
import { PlatformOfflineOriginalLeaseCommandReviewReader } from "./platform-offline-original-lease-command-review.ts";
import { PlatformOfflineOriginalCommandReviewReader } from "./platform-offline-original-command-review.ts";
import { RestoreOfflineNativePhase } from "./restore-offline-native-phase.ts";
import { RestoreOfflineCommitRecoveryReader } from "./restore-offline-commit-recovery.ts";
import { RestoreOfflineStorage } from "./restore-offline-storage.ts";
import {
  parseOfflineTaskEnvelope,
  canonicalOfflineTaskEnvelope,
  offlineTaskBinding,
  type OfflineTaskEnvelopeV1,
} from "./restore-offline-envelope.ts";
import { ORIGINAL_LEASE_PROVENANCE_TABLE as table } from "./integration-offline-original-lease-schema.ts";

export const ORIGINAL_LEASE_TASK = "integration.original-lease.retire" as const;
const purpose =
  "distributor-integration-offline-original-lease-retirement-v1" as const;
export const originalLeaseTaskLimits = Object.freeze({
  rows: 128,
  envelopeBytes: 1048576,
  recordBytes: 16777216,
  rowBytes: 18 * 1024 * 1024,
  totalBytes: 64 * 1024 * 1024,
  nodes: 65536,
  containers: 8192,
  depth: 64,
});
const requiredChecks = Object.freeze([
  "CLAIM_START_TIMESTAMP_NOT_IN_PLATFORM_AUDIT",
  "SOURCE_PROVIDER_AND_CURRENT_COMMIT_AUTHORITY_NOT_QUALIFIED",
  "HISTORICAL_RECEIPTS_ARE_NOT_EXTERNAL_PROVENANCE",
  "SOURCE_COMPLETENESS_UNQUALIFIED",
  "CURRENT_EXTERNAL_AUTHORITY_REQUIRED",
  "RECOVERY_HOLD_RETAINED",
] as const);
const payloadKeys = [
  "journalId",
  "orgId",
  "leaseId",
  "leaseActor",
  "leaseStarted",
  "leaseMode",
  "dispatched",
  "requestRef",
  "sourceId",
  "sourceHash",
  "attemptId",
  "reviewHash",
  "expectedFactsHash",
] as const;
export type OriginalLeaseRetirementPayload =
  Readonly<OfflineOriginalLeaseRetirementInput>;
export type OriginalLeaseRetirementRecord = Readonly<{
  version: 1;
  purpose: typeof purpose;
  status: "native-owner-only";
  binding: string;
  generationHash: string;
  requestId: string;
  orgId: string;
  journalId: string;
  preparerId: string;
  executorId: string;
  payloadHash: string;
  phaseHash: string;
  payload: OriginalLeaseRetirementPayload;
  before: OfflineOriginalLeaseReview;
  commandBeforeHash: string;
  commandAfterHash: string;
  nativeBeforeHash: string;
  nativeAfterHash: string;
  observation: OfflineOriginalLeaseRetirementReceipt["observation"];
  requiredChecks: typeof requiredChecks;
}>;
export type OriginalLeaseRetirementResult = Readonly<{
  version: 1;
  status:
    | "native-owner-application-provisional"
    | "native-owner-recovery-consistency-only";
  record: OriginalLeaseRetirementRecord;
  resultHash: string;
  receipt: NonNullable<
    ReturnType<
      RestoreOfflineCommitRecoveryReader["getInTransaction"]
    >["receipt"]
  >;
  after: ReturnType<StockJournalDelivery["readOfflineOriginalInTransaction"]>;
  requiredChecks: typeof requiredChecks;
}>;
function insist(v: unknown): asserts v {
  check(
    v,
    "OFFLINE_ORIGINAL_LEASE_TASK",
    "Exact native original lease task or retained recovery refused.",
  );
}
function bounded(v: unknown): asserts v {
  check(
    v,
    "OFFLINE_ORIGINAL_LEASE_TASK_LIMIT",
    "Original lease provenance exceeds the complete bounded profile.",
  );
}
function fields(v: unknown, keys: readonly string[]) {
  insist(!types.isProxy(v) && v !== null && typeof v === "object");
  insist([Object.prototype, null].includes(Object.getPrototypeOf(v)));
  const names = Reflect.ownKeys(v);
  insist(
    names.length === keys.length &&
      names.every((k) => typeof k === "string" && keys.includes(k)),
  );
  const result: Record<string, unknown> = {};
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(v, k);
    insist(d && d.enumerable && "value" in d && !types.isProxy(d.value));
    result[k] = d.value;
  }
  return result;
}
function id(v: unknown): asserts v is string {
  insist(typeof v === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(v));
}
function hash(v: unknown): asserts v is string {
  insist(typeof v === "string" && /^[a-f0-9]{64}$/.test(v));
}
function locator(v: unknown): Actor {
  const r = fields(v, ["id", "orgId"]);
  id(r.id);
  id(r.orgId);
  return { id: r.id, orgId: r.orgId } as Actor;
}
function payload(v: unknown): OriginalLeaseRetirementPayload {
  const r = fields(v, payloadKeys);
  for (const k of payloadKeys) {
    const x = r[k];
    if (k === "leaseStarted")
      insist(
        Number.isSafeInteger(x) &&
          !Object.is(x, -0) &&
          Number(x) >= 0 &&
          Number(x) <= Number.MAX_SAFE_INTEGER - 120000,
      );
    else if (k === "dispatched") insist(x === 0 || x === 1);
    else if (k === "leaseMode") insist(x === "write" || x === "lookup");
    else if (k.endsWith("Hash")) hash(x);
    else if (k === "requestRef")
      insist(typeof x === "string" && /^DJ-[a-f0-9]{18}$/.test(x));
    else if (k === "attemptId" && x === "") continue;
    else id(x);
  }
  return Object.freeze({ ...r }) as OriginalLeaseRetirementPayload;
}
function frozen<T>(v: T): T {
  if (v && typeof v === "object") {
    Object.values(v).forEach(frozen);
    Object.freeze(v);
  }
  return v;
}
function own(o: object, k: string): unknown {
  const d = Object.getOwnPropertyDescriptor(o, k);
  insist(d && "value" in d);
  return d.value;
}
function owner(o: unknown, p: object): asserts o is object {
  insist(
    !types.isProxy(o) &&
      o !== null &&
      typeof o === "object" &&
      Object.getPrototypeOf(o) === p,
  );
  for (const k of Object.getOwnPropertyNames(p))
    if (k !== "constructor") insist(!Object.hasOwn(o, k));
}
function parsed(raw: string): unknown {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    insist(false);
  }
  const stack: [unknown, number][] = [[value, 0]];
  let n = 0;
  while (stack.length) {
    const [v, d] = stack.pop()!;
    bounded(
      ++n <= originalLeaseTaskLimits.nodes &&
        d <= originalLeaseTaskLimits.depth,
    );
    if (typeof v === "string")
      insist(!v.includes("\0") && Buffer.from(v).toString() === v);
    if (typeof v === "number")
      insist(Number.isSafeInteger(v) && !Object.is(v, -0));
    if (v && typeof v === "object") {
      const values = Object.values(v);
      bounded(
        n + stack.length + values.length <= originalLeaseTaskLimits.nodes,
      );
      for (const x of values) stack.push([x, d + 1]);
    }
  }
  insist(canonical(value) === raw);
  return value;
}
const recordKeys = [
  "version",
  "purpose",
  "status",
  "binding",
  "generationHash",
  "requestId",
  "orgId",
  "journalId",
  "preparerId",
  "executorId",
  "payloadHash",
  "phaseHash",
  "payload",
  "before",
  "commandBeforeHash",
  "commandAfterHash",
  "nativeBeforeHash",
  "nativeAfterHash",
  "observation",
  "requiredChecks",
] as const;
function record(value: unknown): OriginalLeaseRetirementRecord {
  const r = fields(value, recordKeys);
  insist(
    r.version === 1 &&
      r.purpose === purpose &&
      r.status === "native-owner-only",
  );
  for (const k of [
    "binding",
    "generationHash",
    "payloadHash",
    "phaseHash",
    "commandBeforeHash",
    "commandAfterHash",
    "nativeBeforeHash",
    "nativeAfterHash",
  ])
    hash(r[k]);
  for (const k of [
    "requestId",
    "orgId",
    "journalId",
    "preparerId",
    "executorId",
  ])
    id(r[k]);
  const p = payload(r.payload);
  insist(
    r.payloadHash === digest(canonical(p)) &&
      p.expectedFactsHash === r.nativeBeforeHash &&
      p.journalId === r.journalId &&
      p.orgId === r.orgId,
  );
  const o = fields(r.observation, [
    "revision",
    "body",
    "hash",
    "recordedBy",
    "recordedAt",
  ]);
  hash(o.hash);
  id(o.recordedBy);
  insist(
    Number.isSafeInteger(o.revision) &&
      Number(o.revision) > 0 &&
      o.recordedBy === r.executorId,
  );
  insist(
    typeof o.recordedAt === "string" &&
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(o.recordedAt) &&
      Number.isFinite(Date.parse(o.recordedAt)) &&
      new Date(o.recordedAt).toISOString() === o.recordedAt,
  );
  insist(
    canonical(o.body) ===
      canonical({
        outcome: "unknown",
        cause: "restore-interrupted",
        leaseId: p.leaseId,
        requestRef: p.requestRef,
      }),
  );
  insist(
    o.hash ===
      digest(
        canonical({
          journalId: r.journalId,
          orgId: r.orgId,
          revision: o.revision,
          body: o.body,
          recordedBy: o.recordedBy,
          recordedAt: o.recordedAt,
        }),
      ),
  );
  insist(canonical(r.requiredChecks) === canonical(requiredChecks));
  // Only called for bounded parsed retained JSON or internally constructed owner data.
  const b = r.before as OfflineOriginalLeaseReview;
  insist(
    b &&
      b.version === 1 &&
      b.purpose === "distributor-stock-journal-offline-lease-review-v1" &&
      b.orgId === r.orgId &&
      b.journalId === r.journalId,
  );
  const { hash: bh, ...body } = b;
  insist(bh === r.nativeBeforeHash && digest(canonical(body)) === bh);
  bounded(
    Buffer.byteLength(canonical(r)) <= originalLeaseTaskLimits.recordBytes,
  );
  return frozen(r) as OriginalLeaseRetirementRecord;
}
/** INTERNAL prerequisite, unwired. Only root's qualified guard may compose it.
 * Both principals are exact inert {id,orgId} locators. Returned application is
 * provisional until outer COMMIT; hashes and requiredChecks confer no authority. */
export class IntegrationOfflineOriginalLeaseRetirement {
  readonly #store: Store;
  readonly #phase: RestoreOfflineNativePhase;
  readonly #recovery: RestoreOfflineCommitRecoveryReader;
  #active = false;
  constructor(
    private readonly database: Database,
    private readonly identity: Identity,
    private readonly platform: Platform,
    private readonly journals: StockJournalDelivery,
  ) {
    this.owners();
    this.#store = database.owned("integration");
    this.#phase = new RestoreOfflineNativePhase(database, platform);
    this.#recovery = new RestoreOfflineCommitRecoveryReader(
      database,
      platform,
      identity,
    );
  }
  private owners() {
    for (const [o, p] of [
      [this.database, Database.prototype],
      [this.identity, Identity.prototype],
      [this.platform, Platform.prototype],
      [this.journals, StockJournalDelivery.prototype],
    ] as const)
      owner(o, p);
    for (const o of [this.identity, this.platform, this.journals])
      insist(own(o, "database") === this.database);
    insist(
      own(this.identity, "platform") === this.platform &&
        own(this.journals, "platform") === this.platform &&
        own(this.journals, "identity") === this.identity,
    );
    const costs = own(this.journals, "costs");
    owner(costs, IntegrationCosts.prototype);
    insist(
      own(costs, "database") === this.database &&
        own(costs, "identity") === this.identity &&
        own(costs, "platform") === this.platform &&
        own(costs, "journals") === this.journals,
    );
    const offline = own(this.platform, "offline");
    owner(offline, RestoreOfflineStorage.prototype);
    insist(own(offline, "database") === this.database);
    for (const [o, name] of [
      [this.identity, "iam"],
      [this.platform, "platform"],
      [this.journals, "integration"],
      [costs, "integration"],
      [offline, "platform"],
    ] as const) {
      const s = own(o, "store");
      owner(s, Store.prototype);
      insist(own(s, "database") === this.database && own(s, "owner") === name);
    }
  }
  private actors(p: Actor, e: Actor) {
    this.owners();
    this.database.requireTransaction();
    insist(p.id !== e.id && p.orgId === e.orgId);
    const actors = [p, e].map((l) => {
      const a = this.identity.currentActor(l);
      permit(a, ["finance"]);
      insist(!a.accountId && !this.identity.security(a).passwordChangeRequired);
      return a;
    });
    insist(this.platform.rawRecoveryHoldInTransaction());
    return { preparer: actors[0]!, executor: actors[1]! };
  }
  private envelope(e: OfflineTaskEnvelopeV1, p: Actor, x: Actor) {
    insist(
      e.preparedBy === p.id &&
        e.executorId === x.id &&
        e.task.owner === "integration" &&
        e.task.name === ORIGINAL_LEASE_TASK &&
        e.task.version === 1 &&
        e.task.orgId === p.orgId &&
        e.task.siteIds.length === 0,
    );
    bounded(
      Buffer.byteLength(canonicalOfflineTaskEnvelope(e)) <=
        originalLeaseTaskLimits.envelopeBytes,
    );
    return e;
  }
  private bind(
    e: OfflineTaskEnvelopeV1,
    p: OriginalLeaseRetirementPayload,
    b: OfflineOriginalLeaseReview,
  ) {
    const a = b.attempts.find((a) => a.row.id === b.journalId);
    insist(a);
    insist(
      e.task.subjectId === p.journalId &&
        e.task.orgId === p.orgId &&
        e.task.expectedStateHash === p.expectedFactsHash &&
        p.expectedFactsHash === b.hash &&
        e.task.payloadHash === digest(canonical(p)) &&
        e.task.expectedRevision === (a.observations.at(-1)?.revision ?? 0),
    );
    insist(
      canonical(e.task.priorClaim) ===
        canonical({
          operationId: p.journalId,
          tokenHash: digest(p.leaseId),
          revision: e.task.expectedRevision,
          stateHash: b.hash,
        }),
    );
    insist(
      canonical(p) ===
        canonical({
          journalId: a.row.id,
          orgId: a.row.org_id,
          leaseId: a.row.lease_id,
          leaseActor: a.row.lease_actor,
          leaseStarted: a.row.lease_started,
          leaseMode: a.row.lease_mode,
          dispatched: a.row.dispatched,
          requestRef: `DJ-${digest(a.row.id).slice(0, 18)}`,
          sourceId: a.row.source_id,
          sourceHash: a.plan.input.sourceHash,
          attemptId: a.row.attempt_id,
          reviewHash: a.row.review_hash,
          expectedFactsHash: b.hash,
        }),
    );
  }
  private storage() {
    const cols =
      "journal_id org_id request_id binding generation_hash envelope record record_hash before_hash after_hash observation_hash".split(
        " ",
      );
    const sum = cols.map((c) => `length(CAST(${c} AS BLOB))`).join("+");
    const r = this.#store.get(
      `SELECT COUNT(*) n,COALESCE(SUM(${sum}),0) bytes,COALESCE(MAX(${sum}),0) largest,COALESCE(MAX(CASE WHEN ${cols.map((c) => `typeof(${c})!='text' OR instr(CAST(${c} AS BLOB),x'00')>0`).join(" OR ")} THEN 1 ELSE 0 END),0) bad,COALESCE(MAX(length(CAST(envelope AS BLOB))),0) env,COALESCE(MAX(length(CAST(record AS BLOB))),0) rec FROM ${table}`,
    )!;
    bounded(
      Number.isSafeInteger(r.n) &&
        Number(r.n) <= originalLeaseTaskLimits.rows &&
        Number.isSafeInteger(r.bytes) &&
        Number(r.bytes) <= originalLeaseTaskLimits.totalBytes &&
        Number(r.largest) <= originalLeaseTaskLimits.rowBytes &&
        Number(r.env) <= originalLeaseTaskLimits.envelopeBytes &&
        Number(r.rec) <= originalLeaseTaskLimits.recordBytes,
    );
    insist(r.bad === 0);
    for (const c of ["envelope", "record"]) {
      const j = this.#store.get(
        `SELECT COALESCE(MAX(1+length(${c})-length(replace(replace(replace(replace(${c},',',''),':',''),'[',''),'{',''))),0) nodes,COALESCE(MAX(length(${c})-length(replace(replace(${c},'[',''),'{',''))),0) containers FROM ${table}`,
      )!;
      bounded(
        Number(j.nodes) <= originalLeaseTaskLimits.nodes &&
          Number(j.containers) <= originalLeaseTaskLimits.containers,
      );
      insist(
        this.#store.get(
          `SELECT COUNT(*) n FROM ${table} WHERE NOT json_valid(${c})`,
        )!.n === 0,
      );
    }
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    return this.#store
      .all(
        `SELECT ${cols.map((c) => `CAST(${c} AS BLOB) AS ${c}`).join(",")} FROM ${table} ORDER BY org_id,request_id`,
      )
      .map((raw) => {
        const row: Record<string, string> = {};
        for (const c of cols) {
          const b = raw[c];
          insist(b instanceof Uint8Array);
          try {
            row[c] = decoder.decode(b);
          } catch {
            insist(false);
          }
          insist(Buffer.from(row[c]!).equals(Buffer.from(b)));
        }
        const e = parseOfflineTaskEnvelope(parsed(row.envelope!)),
          r = record(parsed(row.record!));
        insist(
          canonicalOfflineTaskEnvelope(e) === row.envelope &&
            canonical(r) === row.record &&
            digest(row.record!) === row.record_hash &&
            offlineTaskBinding(e) === row.binding &&
            r.binding === row.binding &&
            r.generationHash === row.generation_hash &&
            digest(canonical(e.recovery)) === row.generation_hash &&
            r.orgId === row.org_id &&
            r.requestId === row.request_id &&
            r.journalId === row.journal_id &&
            r.nativeBeforeHash === row.before_hash &&
            r.nativeAfterHash === row.after_hash &&
            r.observation.hash === row.observation_hash,
        );
        this.envelope(
          e,
          { id: r.preparerId, orgId: r.orgId } as Actor,
          { id: r.executorId, orgId: r.orgId } as Actor,
        );
        this.bind(e, payload(r.payload), r.before);
        return { row, envelope: e, record: r };
      });
  }
  private closure(
    rows: ReturnType<IntegrationOfflineOriginalLeaseRetirement["storage"]>,
    state: NonNullable<ReturnType<RestoreOfflineStorage["readInTransaction"]>>,
  ) {
    const {
        version: _,
        schemaVersion: __,
        ...generation
      } = state.state.generation,
      generationHash = digest(canonical(generation));
    const receipts = state.state.sessions.flatMap((s) =>
      s.history.flatMap((h) =>
        h.receipt &&
        h.receipt.owner === "integration" &&
        h.receipt.taskName === ORIGINAL_LEASE_TASK
          ? [{ s, h, r: h.receipt }]
          : [],
      ),
    );
    const relevant = rows.filter(
      (x) => x.record.generationHash === generationHash,
    );
    insist(receipts.length === relevant.length);
    for (const x of relevant) {
      const matches = receipts.filter(
        (y) =>
          y.r.binding === x.record.binding ||
          (y.r.orgId === x.record.orgId &&
            y.r.requestId === x.record.requestId),
      );
      insist(matches.length === 1);
      const m = matches[0]!;
      insist(
        m.r.binding === x.record.binding &&
          m.r.orgId === x.record.orgId &&
          m.r.requestId === x.record.requestId &&
          m.r.resultHash === x.row.record_hash &&
          m.r.payloadHash === x.envelope.task.payloadHash &&
          m.r.beforeCandidateHash === x.envelope.candidate.logicalHash &&
          m.s.id === x.envelope.session.id &&
          m.h.revision === x.envelope.session.revision + 1 &&
          m.h.previousHash === x.envelope.session.lineageHash,
      );
    }
  }
  applyInTransaction(
    preparerInput: unknown,
    executorInput: unknown,
    envelopeInput: unknown,
    payloadInput: unknown,
  ): OriginalLeaseRetirementResult {
    const p = locator(preparerInput),
      x = locator(executorInput),
      e = this.envelope(parseOfflineTaskEnvelope(envelopeInput), p, x),
      input = payload(payloadInput);
    insist(!this.#active);
    this.#active = true;
    try {
      this.actors(p, x);
      const phase = this.#phase.reviewInTransaction(e),
        state = this.platform.offline.readInTransaction();
      insist(state);
      const rows = this.storage();
      this.closure(rows, state);
      insist(
        !rows.some(
          (r) =>
            r.row.journal_id === input.journalId ||
            r.row.binding === offlineTaskBinding(e) ||
            (r.row.org_id === e.task.orgId && r.row.request_id === e.requestId),
        ),
      );
      bounded(rows.length < originalLeaseTaskLimits.rows);
      const before = this.journals.readOfflineLeaseRetirementInTransaction(
        p,
        input.journalId,
      );
      this.bind(e, input, before);
      const commands = new PlatformOfflineOriginalLeaseCommandReviewReader(
        this.database,
        this.identity,
        this.journals,
      ).getInTransaction(p, input.journalId);
      insist(
        commands.nativeReviewHash === before.hash &&
          canonical(commands.blockers) === canonical(requiredChecks),
      );
      this.actors(p, x);
      insist(
        canonical(this.platform.offline.readInTransaction()) ===
          canonical(state),
      );
      const native = this.journals.retireOfflineOriginalLeaseInTransaction(x, {
        ...input,
      });
      const commandAfter = new PlatformOfflineOriginalCommandReviewReader(
        this.database,
        this.identity,
        this.journals,
      ).getInTransaction(x, input.journalId);
      insist(
        canonical(commandAfter.blockers) === canonical(requiredChecks.slice(2)),
      );
      const r = record({
        version: 1,
        purpose,
        status: "native-owner-only",
        binding: offlineTaskBinding(e),
        generationHash: digest(canonical(e.recovery)),
        requestId: e.requestId,
        orgId: e.task.orgId,
        journalId: e.task.subjectId,
        preparerId: p.id,
        executorId: x.id,
        payloadHash: e.task.payloadHash,
        phaseHash: digest(canonical(phase)),
        payload: input,
        before,
        commandBeforeHash: commands.factsHash,
        commandAfterHash: commandAfter.factsHash,
        nativeBeforeHash: before.hash,
        nativeAfterHash: native.after.hash,
        observation: native.observation,
        requiredChecks,
      });
      const raw = canonical(r),
        resultHash = digest(raw);
      this.#store.run(
        `INSERT INTO ${table}(journal_id,org_id,request_id,binding,generation_hash,envelope,record,record_hash,before_hash,after_hash,observation_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
        r.journalId,
        r.orgId,
        r.requestId,
        r.binding,
        r.generationHash,
        canonicalOfflineTaskEnvelope(e),
        raw,
        resultHash,
        r.nativeBeforeHash,
        r.nativeAfterHash,
        r.observation.hash,
      );
      this.actors(p, x);
      insist(
        canonical(this.platform.offline.readInTransaction()) ===
          canonical(state),
      );
      this.platform.offline.transitionInTransaction(
        state.state.generation,
        state.anchor,
        {
          kind: "record-task",
          receipt: {
            owner: "integration",
            orgId: r.orgId,
            taskName: ORIGINAL_LEASE_TASK,
            requestId: r.requestId,
            binding: r.binding,
            payloadHash: r.payloadHash,
            beforeCandidateHash: e.candidate.logicalHash,
            resultHash,
          },
        },
        [],
      );
      return frozen({
        ...this.recover(p, x, e),
        status: "native-owner-application-provisional" as const,
      });
    } finally {
      this.#active = false;
    }
  }
  recoverRetainedInTransaction(
    preparerInput: unknown,
    executorInput: unknown,
    envelopeInput: unknown,
  ): OriginalLeaseRetirementResult {
    const p = locator(preparerInput),
      x = locator(executorInput),
      e = this.envelope(parseOfflineTaskEnvelope(envelopeInput), p, x);
    insist(!this.#active);
    this.#active = true;
    try {
      return this.recover(p, x, e);
    } finally {
      this.#active = false;
    }
  }
  private recover(
    p: Actor,
    x: Actor,
    e: OfflineTaskEnvelopeV1,
  ): OriginalLeaseRetirementResult {
    this.actors(p, x);
    const changes = this.#store.get("SELECT total_changes() n")!.n,
      state = this.platform.offline.readInTransaction();
    insist(state);
    const rows = this.storage();
    this.closure(rows, state);
    const selected = rows.filter(
      (r) =>
        r.row.binding === offlineTaskBinding(e) ||
        (r.row.org_id === e.task.orgId && r.row.request_id === e.requestId) ||
        r.row.journal_id === e.task.subjectId,
    );
    insist(selected.length === 1);
    const retained = selected[0]!,
      r = retained.record;
    insist(
      retained.row.envelope === canonicalOfflineTaskEnvelope(e) &&
        r.preparerId === p.id &&
        r.executorId === x.id,
    );
    const recovery = this.#recovery.getInTransaction(x, e);
    insist(
      recovery.receipt &&
        recovery.receipt.resultHash === retained.row.record_hash,
    );
    const after = this.journals.readOfflineOriginalInTransaction(
      x,
      r.journalId,
    );
    insist(after.hash === r.nativeAfterHash);
    const expected = structuredClone(r.before) as unknown as {
      hash: string;
      purpose: string;
      attempts: { row: Row; observations: unknown[]; history: Row[] }[];
    };
    const a = expected.attempts.find((a) => a.row.id === r.journalId);
    insist(a);
    insist(
      r.observation.revision === e.task.expectedRevision + 1 &&
        r.observation.recordedBy === x.id &&
        canonical(r.observation.body) ===
          canonical({
            outcome: "unknown",
            cause: "restore-interrupted",
            leaseId: r.payload.leaseId,
            requestRef: r.payload.requestRef,
          }),
    );
    Object.assign(a.row, {
      state: "unknown",
      lease_id: null,
      lease_actor: null,
      lease_started: null,
      lease_mode: null,
    });
    a.observations.push(r.observation);
    a.history.push({
      journal_id: r.journalId,
      org_id: r.orgId,
      revision: r.observation.revision,
      body: canonical(r.observation.body),
      hash: r.observation.hash,
      recorded_by: r.observation.recordedBy,
      recorded_at: r.observation.recordedAt,
    });
    const { hash: _, purpose: __, ...expectedFacts } = expected,
      { hash: ___, purpose: ____, ...actualFacts } = after;
    insist(canonical(expectedFacts) === canonical(actualFacts));
    const commands = new PlatformOfflineOriginalCommandReviewReader(
      this.database,
      this.identity,
      this.journals,
    ).getInTransaction(x, r.journalId);
    insist(commands.factsHash === r.commandAfterHash);
    this.actors(p, x);
    insist(
      canonical(this.platform.offline.readInTransaction()) ===
        canonical(state) &&
        canonical(this.storage()) === canonical(rows) &&
        this.#store.get("SELECT total_changes() n")!.n === changes,
    );
    return frozen({
      version: 1,
      status: "native-owner-recovery-consistency-only",
      record: r,
      resultHash: retained.row.record_hash!,
      receipt: recovery.receipt,
      after,
      requiredChecks,
    });
  }
}
