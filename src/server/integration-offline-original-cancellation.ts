import { types } from "node:util";
import { canonical, check, digest, permit, type Actor } from "./core.ts";
import { Database } from "./database.ts";
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
/** Root must retain this exact preimage along with the signed envelope/private
 * evidence. Platform retains its hash, not this record or command preimages. */
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
    const resultHash = digest(canonical(record));
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
