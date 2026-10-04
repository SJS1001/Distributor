import { types } from "node:util";
import { canonical, check, digest, permit, type Actor } from "./core.ts";
import { Database, type Store } from "./database.ts";
import { Identity } from "./iam.ts";
import { Platform } from "./platform.ts";
import {
  StockJournalDelivery,
  type OfflineOriginalCancellationProof,
} from "./stock-journal-delivery.ts";
import { assertCapturedOfflineOriginalEvidence } from "./stock-journal-offline-original-evidence.ts";
import { RestoreOfflineOriginalNativeJoin } from "./restore-offline-original-native-join.ts";
import { PlatformOfflineOriginalObservationReviewReader } from "./platform-offline-original-observation-review.ts";
import { RestoreOfflineNativePhase } from "./restore-offline-native-phase.ts";
import { RestoreOfflineCommitRecoveryReader } from "./restore-offline-commit-recovery.ts";
import {
  offlineTaskBinding,
  parseOfflineTaskEnvelope,
} from "./restore-offline-envelope.ts";

const purpose =
  "distributor-integration-offline-original-cancellation-result-v1";
const hashFields = [
  "binding",
  "payloadHash",
  "nativeBeforeHash",
  "captureHash",
  "nativeJoinHash",
  "phaseHash",
  "evidenceHash",
  "cancellationHash",
  "nativeAfterHash",
  "auditsAfterHash",
] as const;
const idFields = [
  "requestId",
  "orgId",
  "journalId",
  "evidenceActorId",
  "cancellationActorId",
] as const;
/** Exact Integration-retained result preimage. Platform binds its hash;
 * neither record nor receipt supplies independent evidence/authority. */
export type OfflineOriginalCancellationRecord = Readonly<
  {
    version: 1;
    purpose: typeof purpose;
    status: "native-owner-only";
    reason: string;
  } & Record<(typeof hashFields)[number] | (typeof idFields)[number], string>
>;
type Receipt = NonNullable<
  ReturnType<RestoreOfflineCommitRecoveryReader["getInTransaction"]>["receipt"]
>;
export type OfflineOriginalCancellationResult = Readonly<{
  version: 1;
  status:
    "native-owner-application-only" | "native-owner-recovery-consistency-only";
  record: OfflineOriginalCancellationRecord;
  resultHash: string;
  receipt: Receipt;
  proof: OfflineOriginalCancellationProof;
}>;
function insist(v: unknown): asserts v {
  check(
    v,
    "OFFLINE_ORIGINAL_CANCELLATION_TASK",
    "Fixed native original cancellation application or retained recovery refused.",
  );
}
function fields(input: unknown, keys: readonly string[]) {
  insist(!types.isProxy(input) && input !== null && typeof input === "object");
  insist([Object.prototype, null].includes(Object.getPrototypeOf(input)));
  const names = Reflect.ownKeys(input);
  insist(
    names.length === keys.length &&
      names.every((k) => typeof k === "string" && keys.includes(k)),
  );
  const out: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(input, key);
    insist(d && d.enumerable && "value" in d && !types.isProxy(d.value));
    out[key] = d.value;
  }
  return out;
}
function id(v: unknown): asserts v is string {
  insist(typeof v === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(v));
}
function reasonText(v: unknown): asserts v is string {
  insist(
    typeof v === "string" &&
      v.length > 0 &&
      v.length <= 2000 &&
      Buffer.byteLength(v) <= 2000 &&
      v.trim() === v &&
      !v.includes("\0") &&
      Buffer.from(v).toString() === v,
  );
}
function recordInput(input: unknown): OfflineOriginalCancellationRecord {
  const r = fields(input, [
    "version",
    "purpose",
    "status",
    "reason",
    ...hashFields,
    ...idFields,
  ]);
  insist(
    r.version === 1 &&
      r.purpose === purpose &&
      r.status === "native-owner-only",
  );
  reasonText(r.reason);
  hashFields.forEach((k) =>
    insist(typeof r[k] === "string" && /^[a-f0-9]{64}$/.test(r[k] as string)),
  );
  idFields.forEach((k) => id(r[k]));
  // Fixed primitive schema is bounded before any canonicalization.
  insist(Buffer.byteLength(canonical(r)) <= 16_384);
  return Object.freeze({ ...r }) as OfflineOriginalCancellationRecord;
}
function locator(input: unknown): Actor {
  const r = fields(input, ["id", "orgId"]);
  id(r.id);
  id(r.orgId);
  return { id: r.id, orgId: r.orgId } as Actor;
}
/** No route or provider adapter. Trusted root composition supplies these exact
 * owners from ONE Application, propagates every exception through its outer
 * writer, and separately holds qualified authority/evidence/fences through COMMIT.
 * Actor arguments are strictly {id,orgId} locators, never supplied Actor grants. */
export class IntegrationOfflineOriginalCancellation {
  readonly #store: Store;
  readonly #join: RestoreOfflineOriginalNativeJoin;
  readonly #audits: PlatformOfflineOriginalObservationReviewReader;
  readonly #phase: RestoreOfflineNativePhase;
  readonly #recovery: RestoreOfflineCommitRecoveryReader;
  constructor(
    private readonly database: Database,
    private readonly identity: Identity,
    private readonly platform: Platform,
    private readonly journals: StockJournalDelivery,
  ) {
    for (const [owner, prototype] of [
      [database, Database.prototype],
      [identity, Identity.prototype],
      [platform, Platform.prototype],
      [journals, StockJournalDelivery.prototype],
    ] as const)
      insist(
        owner &&
          !types.isProxy(owner) &&
          Object.getPrototypeOf(owner) === prototype,
      );
    this.#store = database.owned("integration");
    this.#join = new RestoreOfflineOriginalNativeJoin(
      database,
      identity,
      journals,
    );
    this.#audits = new PlatformOfflineOriginalObservationReviewReader(
      database,
      identity,
    );
    this.#phase = new RestoreOfflineNativePhase(database, platform);
    this.#recovery = new RestoreOfflineCommitRecoveryReader(
      database,
      platform,
      identity,
    );
  }
  /** Full fixed table preflight; no foreign text is selected or returned.
   * Limits intentionally fail closed instead of truncating retained history. */
  private provenancePreflight() {
    const size = this.#store.get<{ n: number; bytes: number; bad: number }>(`
      SELECT COUNT(*) AS n,COALESCE(SUM(length(CAST(journal_id AS BLOB))+length(CAST(org_id AS BLOB))+length(CAST(request_id AS BLOB))+length(CAST(binding AS BLOB))+length(CAST(envelope AS BLOB))+length(CAST(envelope_hash AS BLOB))+length(CAST(record AS BLOB))+length(CAST(record_hash AS BLOB))),0) AS bytes,
      COALESCE(MAX(CASE WHEN typeof(journal_id)!='text' OR typeof(org_id)!='text' OR typeof(request_id)!='text' OR typeof(binding)!='text' OR typeof(envelope)!='text' OR typeof(envelope_hash)!='text' OR typeof(record)!='text' OR typeof(record_hash)!='text'
      OR length(CAST(journal_id AS BLOB)) NOT BETWEEN 1 AND 160 OR length(CAST(org_id AS BLOB)) NOT BETWEEN 1 AND 160 OR length(CAST(request_id AS BLOB)) NOT BETWEEN 1 AND 160
      OR journal_id GLOB '*[^A-Za-z0-9_-]*' OR org_id GLOB '*[^A-Za-z0-9_-]*' OR request_id GLOB '*[^A-Za-z0-9_-]*'
      OR length(CAST(binding AS BLOB))!=64 OR binding GLOB '*[^a-f0-9]*' OR length(CAST(envelope_hash AS BLOB))!=64 OR envelope_hash GLOB '*[^a-f0-9]*' OR length(CAST(record_hash AS BLOB))!=64 OR record_hash GLOB '*[^a-f0-9]*'
      OR length(CAST(envelope AS BLOB)) NOT BETWEEN 1 AND 4194304 OR length(CAST(record AS BLOB)) NOT BETWEEN 1 AND 16384
      OR instr(journal_id,char(0)) OR instr(org_id,char(0)) OR instr(request_id,char(0)) OR instr(binding,char(0)) OR instr(envelope,char(0)) OR instr(envelope_hash,char(0)) OR instr(record,char(0)) OR instr(record_hash,char(0))
      THEN 1 ELSE 0 END),0) AS bad FROM integration_offline_original_cancellations`)!;
    insist(
      Number.isSafeInteger(size.n) &&
        size.n >= 0 &&
        size.n <= 1024 &&
        Number.isSafeInteger(size.bytes) &&
        size.bytes >= 0 &&
        size.bytes <= 16 * 1024 * 1024 &&
        size.bad === 0,
    );
    // Scalar SQL only: json_tree violates native table ownership. Count
    // punctuation conservatively, including inside strings, before JSON parse.
    const complexity = this.#store.get<{ nodes: number; containers: number }>(
      `WITH docs AS (SELECT record AS raw FROM integration_offline_original_cancellations UNION ALL SELECT envelope FROM integration_offline_original_cancellations) SELECT COALESCE(MAX(1+length(raw)-length(replace(replace(replace(replace(raw,',',''),':',''),'[',''),'{',''))),0) AS nodes,COALESCE(MAX(length(raw)-length(replace(replace(raw,'[',''),'{',''))),0) AS containers FROM docs`,
    )!;
    insist(complexity.nodes <= 32768 && complexity.containers <= 4096);
    insist(
      this.#store.get(
        `SELECT COUNT(*) AS n FROM integration_offline_original_cancellations WHERE NOT json_valid(record) OR NOT json_valid(envelope)`,
      )!.n === 0,
    );
    insist(
      this.#store.get(
        `SELECT COUNT(*) AS n FROM integration_offline_original_cancellations WHERE json_type(record)!='object' OR json_type(envelope)!='object'`,
      )!.n === 0,
    );
    // Integration owns both tables. Orphan/cross-org rows cannot disappear
    // through subject filtering, and no other tenant's text is materialized.
    insist(
      this.#store.get(
        `SELECT COUNT(*) AS n FROM integration_offline_original_cancellations p LEFT JOIN integration_stock_journals j ON j.id=p.journal_id WHERE j.id IS NULL OR p.org_id!=j.org_id`,
      )!.n === 0,
    );
  }
  private provenanceMatches(
    envelope: ReturnType<typeof parseOfflineTaskEnvelope>,
  ) {
    const binding = offlineTaskBinding(envelope);
    return this.#store.get<{ n: number; bad: number }>(
      `SELECT COUNT(*) AS n,COALESCE(MAX(CASE WHEN journal_id!=? OR org_id!=? OR request_id!=? OR binding!=? THEN 1 ELSE 0 END),0) AS bad FROM integration_offline_original_cancellations WHERE journal_id=? OR binding=? OR (org_id=? AND request_id=?)`,
      envelope.task.subjectId,
      envelope.task.orgId,
      envelope.requestId,
      binding,
      envelope.task.subjectId,
      binding,
      envelope.task.orgId,
      envelope.requestId,
    )!;
  }
  private readProvenance(
    envelope: ReturnType<typeof parseOfflineTaskEnvelope>,
  ) {
    this.provenancePreflight();
    const matches = this.provenanceMatches(envelope);
    insist(matches.n === 1 && matches.bad === 0);
    const rows = this.#store.all<{
      journal_id: string;
      org_id: string;
      request_id: string;
      binding: string;
      envelope_bytes: Uint8Array;
      envelope_hash: string;
      record_bytes: Uint8Array;
      record_hash: string;
    }>(
      `SELECT journal_id,org_id,request_id,binding,CAST(envelope AS BLOB) AS envelope_bytes,envelope_hash,CAST(record AS BLOB) AS record_bytes,record_hash FROM integration_offline_original_cancellations WHERE journal_id=? OR binding=? OR (org_id=? AND request_id=?)`,
      envelope.task.subjectId,
      offlineTaskBinding(envelope),
      envelope.task.orgId,
      envelope.requestId,
    );
    insist(rows.length === 1);
    const row = rows[0]!;
    let envelopeText: string,
      recordText: string,
      record: OfflineOriginalCancellationRecord,
      storedEnvelope: ReturnType<typeof parseOfflineTaskEnvelope>;
    try {
      const decoder = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      });
      envelopeText = decoder.decode(row.envelope_bytes);
      recordText = decoder.decode(row.record_bytes);
      record = recordInput(JSON.parse(recordText));
      storedEnvelope = parseOfflineTaskEnvelope(JSON.parse(envelopeText));
    } catch {
      insist(false);
    }
    insist(
      canonical(record) === recordText &&
        digest(recordText) === row.record_hash &&
        canonical(storedEnvelope) === envelopeText &&
        digest(envelopeText) === row.envelope_hash &&
        envelopeText === canonical(envelope),
    );
    insist(
      row.journal_id === record.journalId &&
        row.org_id === record.orgId &&
        row.request_id === record.requestId &&
        row.binding === record.binding &&
        row.binding === offlineTaskBinding(storedEnvelope),
    );
    return record;
  }
  private actors(evidenceInput: unknown, cancellationInput: unknown) {
    // Capture BOTH before any owner hooks, including IAM.
    const e = locator(evidenceInput),
      c = locator(cancellationInput);
    insist(e.id !== c.id && e.orgId === c.orgId);
    const actors = [e, c].map((x) => {
      const a = this.identity.currentActor(x);
      permit(a, ["finance"]);
      insist(!a.accountId && !this.identity.security(a).passwordChangeRequired);
      return a;
    });
    insist(this.platform.rawRecoveryHoldInTransaction());
    return { evidence: actors[0]!, cancellation: actors[1]!, e, c };
  }
  private envelope(
    input: unknown,
    actors: ReturnType<IntegrationOfflineOriginalCancellation["actors"]>,
  ) {
    const e = parseOfflineTaskEnvelope(input),
      t = e.task;
    insist(
      t.owner === "integration" &&
        t.name === "integration.quickbooks-original-cancelled.import" &&
        t.version === 1 &&
        t.orgId === actors.e.orgId &&
        t.siteIds.length === 0 &&
        t.priorClaim === null &&
        e.preparedBy === actors.e.id &&
        e.executorId === actors.c.id,
    );
    return e;
  }
  private proofAudits(actor: Actor, proof: OfflineOriginalCancellationProof) {
    const audits = this.#audits.getInTransaction(actor);
    insist(audits.orgId === proof.orgId);
    const ids = new Set(proof.attempts.map((a) => a.row.id));
    const selected = audits.audits.filter((a) => ids.has(a.journalId)),
      used = new Set<string>();
    for (const attempt of proof.attempts) {
      let sequence = 0;
      for (const observation of attempt.observations) {
        const matches = selected.filter(
          (a) =>
            a.journalId === attempt.row.id &&
            a.revision === observation.revision,
        );
        insist(matches.length === 1);
        const a = matches[0]!;
        insist(
          a.hash === observation.hash &&
            a.actorId === observation.recordedBy &&
            a.sequence > sequence &&
            !used.has(a.id),
        );
        used.add(a.id);
        sequence = a.sequence;
      }
    }
    insist(used.size === selected.length);
    return audits;
  }
  applyInTransaction(
    evidenceActor: unknown,
    cancellationActor: unknown,
    envelopeInput: unknown,
    capturedInput: unknown,
    reasonInput: unknown,
  ): OfflineOriginalCancellationResult {
    this.database.requireTransaction();
    assertCapturedOfflineOriginalEvidence(capturedInput);
    insist(!types.isProxy(reasonInput));
    reasonText(reasonInput);
    const parsedEnvelope = parseOfflineTaskEnvelope(envelopeInput);
    const actors = this.actors(evidenceActor, cancellationActor),
      envelope = this.envelope(parsedEnvelope, actors),
      cap = capturedInput;
    const target = cap.native.attempts.find(
      (a) => a.row.id === cap.native.journalId,
    );
    insist(
      target &&
        envelope.task.orgId === cap.native.orgId &&
        envelope.task.subjectId === cap.native.journalId &&
        envelope.task.expectedRevision ===
          target.observations.at(-1)?.revision &&
        envelope.task.expectedStateHash === cap.native.hash,
    );
    const payloadHash = digest(
      canonical({
        version: 1,
        source: cap.native,
        candidate: cap.native,
        providerClaims: [cap.claim],
      }),
    );
    insist(payloadHash === envelope.task.payloadHash);
    // Existing private task v1 signs this assertion text. A separate arbitrary
    // cancellation reason is deliberately unsupported by this fixed task.
    const reason = reasonInput;
    insist(reason === cap.claim.attestation.evidence);
    const envelopeText = canonical(envelope);
    insist(Buffer.byteLength(envelopeText) <= 4 * 1024 * 1024);
    this.provenancePreflight();
    insist(this.provenanceMatches(envelope).n === 0);
    const phase = this.#phase.reviewInTransaction(envelope),
      retained = this.platform.offline.readInTransaction();
    insist(
      retained &&
        retained.anchor.revision === phase.storage.revision &&
        retained.anchor.stateHash === phase.storage.stateHash &&
        retained.anchor.journalHash === phase.storage.journalHash,
    );
    const joined = this.#join.getInTransaction(actors.e, cap);
    insist(joined.capture.hash === cap.hash);
    this.actors(actors.e, actors.c);
    const proof = this.journals.applyOfflineOriginalCancellationInTransaction(
      actors.e,
      actors.c,
      joined.capture,
      reason,
    );
    const audits = this.proofAudits(actors.c, proof);
    this.actors(actors.e, actors.c);
    insist(
      canonical(this.platform.offline.readInTransaction()) ===
        canonical(retained),
    );
    const record = recordInput({
      version: 1,
      purpose,
      status: "native-owner-only",
      reason,
      binding: offlineTaskBinding(envelope),
      requestId: envelope.requestId,
      orgId: envelope.task.orgId,
      journalId: envelope.task.subjectId,
      evidenceActorId: actors.e.id,
      cancellationActorId: actors.c.id,
      payloadHash,
      nativeBeforeHash: cap.native.hash,
      captureHash: cap.hash,
      nativeJoinHash: joined.hash,
      phaseHash: digest(canonical(phase)),
      evidenceHash: proof.proof.evidence.evidenceHash,
      cancellationHash: proof.proof.cancellation.hash,
      nativeAfterHash: proof.hash,
      auditsAfterHash: audits.hash,
    });
    const recordText = canonical(record),
      resultHash = digest(recordText);
    // Actual owner write in the SAME outer transaction, before the sole task receipt.
    this.#store.run(
      "INSERT INTO integration_offline_original_cancellations(journal_id,org_id,request_id,binding,envelope,envelope_hash,record,record_hash) VALUES(?,?,?,?,?,?,?,?)",
      record.journalId,
      record.orgId,
      record.requestId,
      record.binding,
      envelopeText,
      digest(envelopeText),
      recordText,
      resultHash,
    );
    this.platform.offline.transitionInTransaction(
      retained.state.generation,
      retained.anchor,
      {
        kind: "record-task",
        receipt: {
          owner: envelope.task.owner,
          orgId: envelope.task.orgId,
          taskName: envelope.task.name,
          requestId: envelope.requestId,
          binding: record.binding,
          payloadHash,
          beforeCandidateHash: envelope.candidate.logicalHash,
          resultHash,
        },
      },
      [],
    );
    // Also validates the exact retained receipt, owner/audit joins and BOTH
    // refreshed principals AFTER the final write. Any failure must roll back.
    const result = this.recoverInTransaction(
      actors.e,
      actors.c,
      envelope,
      record,
    );
    return Object.freeze({
      ...result,
      status: "native-owner-application-only",
    });
  }
  /** Read-only recovery from actual durable owner preimages, not caller facts.
   * Absence/collision is a refusal, never permission to reexecute. */
  recoverRetainedInTransaction(
    evidenceActor: unknown,
    cancellationActor: unknown,
    envelopeInput: unknown,
  ): OfflineOriginalCancellationResult {
    this.database.requireTransaction();
    const parsed = parseOfflineTaskEnvelope(envelopeInput),
      actors = this.actors(evidenceActor, cancellationActor),
      envelope = this.envelope(parsed, actors);
    const record = this.readProvenance(envelope);
    return this.recoverInTransaction(actors.e, actors.c, envelope, record);
  }
  recoverInTransaction(
    evidenceActor: unknown,
    cancellationActor: unknown,
    envelopeInput: unknown,
    retainedRecordInput: unknown,
  ): OfflineOriginalCancellationResult {
    this.database.requireTransaction();
    // This is a bounded inert preimage, NOT a process-issued capture or a grant.
    const record = recordInput(retainedRecordInput),
      parsedEnvelope = parseOfflineTaskEnvelope(envelopeInput);
    const actors = this.actors(evidenceActor, cancellationActor),
      envelope = this.envelope(parsedEnvelope, actors);
    insist(
      record.binding === offlineTaskBinding(envelope) &&
        record.requestId === envelope.requestId &&
        record.orgId === envelope.task.orgId &&
        record.journalId === envelope.task.subjectId &&
        record.payloadHash === envelope.task.payloadHash &&
        record.nativeBeforeHash === envelope.task.expectedStateHash &&
        record.evidenceActorId === actors.e.id &&
        record.cancellationActorId === actors.c.id,
    );
    insist(canonical(this.readProvenance(envelope)) === canonical(record));
    const resultHash = digest(canonical(record)),
      retained = this.#recovery.getInTransaction(actors.c, envelope);
    insist(retained.receipt && retained.receipt.resultHash === resultHash);
    const proof = this.journals.readOfflineOriginalCancellationInTransaction(
      actors.c,
      record.journalId,
      record.evidenceHash,
      record.cancellationHash,
    );
    insist(
      proof.orgId === record.orgId &&
        proof.hash === record.nativeAfterHash &&
        proof.proof.evidence.recordedBy === record.evidenceActorId &&
        proof.proof.cancellation.recordedBy === record.cancellationActorId &&
        proof.proof.evidence.revision === envelope.task.expectedRevision + 1 &&
        proof.proof.cancellation.revision ===
          envelope.task.expectedRevision + 2 &&
        proof.proof.evidence.input.evidence === record.reason &&
        proof.proof.cancellation.body.reason === record.reason,
    );
    const audits = this.proofAudits(actors.c, proof);
    insist(audits.hash === record.auditsAfterHash);
    this.actors(actors.e, actors.c);
    return Object.freeze({
      version: 1,
      status: "native-owner-recovery-consistency-only",
      record,
      resultHash,
      receipt: retained.receipt,
      proof,
    });
  }
}
