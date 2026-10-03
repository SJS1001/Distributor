import { types } from "node:util";
import { canonical, check, digest, permit, type Actor } from "./core.ts";
import { Database, type Store } from "./database.ts";
import { Identity } from "./iam.ts";
import { Billing } from "./billing.ts";
import { Platform } from "./platform.ts";
import type { OfflineFailedRefundTuple } from "./billing-refunds.ts";
import { isCapturedOfflineFailedRefundComparison } from "./integration-offline-refund-evidence.ts";
import { RestoreOfflineRefundNativeJoin } from "./restore-offline-refund-native-join.ts";
import { RestoreOfflineNativePhase } from "./restore-offline-native-phase.ts";
import { RestoreOfflineCommitRecoveryReader } from "./restore-offline-commit-recovery.ts";
import {
  offlineTaskBinding,
  parseOfflineTaskEnvelope,
} from "./restore-offline-envelope.ts";

export const offlineFailedRefundTask = Object.freeze({
  owner: "integration",
  name: "integration.offline-failed-refund",
  version: 1,
});
const purpose = "distributor-integration-offline-failed-refund-application-v1";
function insist(value: unknown): asserts value {
  check(
    value,
    "OFFLINE_FAILED_REFUND_APPLICATION",
    "Fixed native offline refund application or recovery refused.",
  );
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const recoveryColumns = {
  integration_effects:
    "id org_id account_id provider kind reference payload state external_ref result created_at residency_version started_at error",
  integration_inbox: "provider event_id hash created_at",
  integration_refund_callbacks:
    "id org_id binding_id event_id effect_id provider_reference event_type hash state attempts started_at retry_at error created_at",
  integration_callbacks:
    "id org_id binding_id event_id session_id effect_id hash state attempts started_at retry_at error created_at",
  integration_offline_failed_refunds:
    "effect_id org_id request_id binding record record_hash",
  integration_refund_polls: "effect_id org_id token started_at retry_at",
  integration_operation_leases: "effect_id org_id token started_at",
  integration_checkout_renewals:
    "successor_id org_id invoice_id predecessor_id reason review_version created_at",
  integration_checkout_observations:
    "sequence id org_id account_id invoice_id effect_id claim_token actor_id snapshot hash",
  integration_payment_allocations:
    "effect_id org_id invoice_id payment_id applied_amount",
  integration_accounting_refunds:
    "effect_id org_id invoice_id refund_id credit_id amount",
  integration_credit_applications:
    "effect_id org_id invoice_id credit_id amount",
  integration_credit_cancellations:
    "effect_id org_id actor_id reason review_version amount created_at",
  integration_balance_reads:
    "id org_id effect_id command_key hash token started_at requested_at result error",
  integration_balance_observations: "sequence read_id org_id effect_id result",
} as const;

type NativeJoin = ReturnType<
  RestoreOfflineRefundNativeJoin["getInTransaction"]
>;
type RetainedRecord = {
  version: number;
  purpose: string;
  envelope: ReturnType<typeof parseOfflineTaskEnvelope>;
  actor: { id: string; orgId: string };
  binding: string;
  phase: ReturnType<RestoreOfflineNativePhase["reviewInTransaction"]>;
  nativeJoin: Omit<NativeJoin, "reviews" | "requiredChecks" | "hash">;
  nativeJoinHash: string;
  failed: OfflineFailedRefundTuple;
  afterEffect: NativeJoin["native"]["effect"];
  receipt: ReturnType<
    Billing["refunds"]["applyOfflineFailedRefundInTransaction"]
  >;
};
/** Internal static owner operation. Caller MUST propagate every error through
 * the enclosing native transaction. Application has no route/configuration for
 * this operation: native consistency does not supply independently qualified
 * evidence, authority or a fence held through actual COMMIT. */
export class IntegrationOfflineFailedRefund {
  readonly #store: Store;
  readonly #join: RestoreOfflineRefundNativeJoin;
  readonly #phase: RestoreOfflineNativePhase;
  readonly #recovery: RestoreOfflineCommitRecoveryReader;
  constructor(
    private readonly database: Database,
    private readonly identity: Identity,
    private readonly billing: Billing,
    private readonly platform: Platform,
  ) {
    for (const [owner, prototype] of [
      [database, Database.prototype],
      [identity, Identity.prototype],
      [billing, Billing.prototype],
      [platform, Platform.prototype],
    ] as const)
      insist(
        owner &&
          !types.isProxy(owner) &&
          Object.getPrototypeOf(owner) === prototype,
      );
    this.#store = database.owned("integration");
    this.#join = new RestoreOfflineRefundNativeJoin(
      database,
      identity,
      billing,
    );
    this.#phase = new RestoreOfflineNativePhase(database, platform);
    this.#recovery = new RestoreOfflineCommitRecoveryReader(
      database,
      platform,
      identity,
    );
  }
  private actor(input: Actor) {
    insist(input && typeof input === "object" && !types.isProxy(input));
    const locator: Record<string, string> = {};
    for (const key of ["id", "orgId"]) {
      const d = Object.getOwnPropertyDescriptor(input, key);
      insist(
        d &&
          "value" in d &&
          typeof d.value === "string" &&
          /^[A-Za-z0-9_-]{1,160}$/.test(d.value),
      );
      locator[key] = d.value;
    }
    const actor = this.identity.currentActor(locator as unknown as Actor);
    permit(actor, ["finance"]);
    insist(
      !actor.accountId && !this.identity.security(actor).passwordChangeRequired,
    );
    insist(this.platform.rawRecoveryHoldInTransaction());
    return actor;
  }
  private envelope(input: unknown, actor: Actor) {
    const envelope = parseOfflineTaskEnvelope(input),
      task = envelope.task;
    insist(
      task.owner === offlineFailedRefundTask.owner &&
        task.name === offlineFailedRefundTask.name &&
        task.version === 1 &&
        task.orgId === actor.orgId &&
        task.siteIds.length === 0 &&
        task.expectedRevision === 0 &&
        task.priorClaim === null,
    );
    return envelope;
  }
  applyInTransaction(
    actorInput: Actor,
    envelopeInput: unknown,
    comparisonInput: unknown,
  ) {
    this.database.requireTransaction();
    insist(isCapturedOfflineFailedRefundComparison(comparisonInput));
    const actor = this.actor(actorInput),
      envelope = this.envelope(envelopeInput, actor);
    this.recoveryPreflight(0);
    const comparison = comparisonInput;
    insist(
      envelope.task.subjectId === comparison.native.effect.id &&
        envelope.task.payloadHash ===
          digest(
            canonical({
              version: 1,
              comparisonInputHash: comparison.inputHash,
            }),
          ),
    );
    const phase = this.#phase.reviewInTransaction(envelope);
    const joined = this.#join.getInTransaction(actor, comparison);
    insist(envelope.task.expectedStateHash === joined.hash);
    const {
      reviews,
      requiredChecks: _required,
      hash: nativeJoinHash,
      ...nativeJoin
    } = joined;
    const failed: OfflineFailedRefundTuple = {
      refundId: joined.refundId,
      invoiceId: joined.native.invoice.id,
      paymentId: joined.native.payment.external_ref,
      paymentAmount: joined.native.payment.amount,
      amount: joined.native.refund.amount,
      currency: joined.native.organization.currency === "CAD" ? "cad" : "usd",
      externalReference: comparison.outcome.reference,
      status: "failed",
    };
    const result = canonical(comparison.outcome.result);
    const afterEffect = {
      ...joined.native.effect,
      state: "completed",
      external_ref: failed.externalReference,
      result,
      started_at: null,
      error: null,
    };
    const binding = offlineTaskBinding(envelope);
    const before = {
      version: 1,
      purpose,
      envelope,
      actor: { id: actor.id, orgId: actor.orgId },
      binding,
      phase,
      nativeJoin,
      nativeJoinHash,
      failed,
      afterEffect,
    };
    // Reserve ample room for the exact native receipt BEFORE the first mutation.
    insist(Buffer.byteLength(canonical(before)) <= 60_000);
    const receipt = this.billing.refunds.applyOfflineFailedRefundInTransaction(
      actor,
      joined.refundId,
      reviews.billing.factsHash,
      failed,
    );
    const updated = this.#store.run(
      "UPDATE integration_effects SET state='completed',external_ref=?,result=?,started_at=NULL,error=NULL WHERE id=? AND org_id=? AND state='unknown' AND external_ref IS NULL AND result IS NULL",
      failed.externalReference,
      result,
      joined.effectId,
      actor.orgId,
    );
    insist(updated.changes === 1);
    const record = canonical({ ...before, receipt });
    insist(Buffer.byteLength(record) <= 65_536);
    const resultHash = digest(record);
    this.#store.run(
      "INSERT INTO integration_offline_failed_refunds(effect_id,org_id,request_id,binding,record,record_hash) VALUES(?,?,?,?,?,?)",
      joined.effectId,
      actor.orgId,
      envelope.requestId,
      binding,
      record,
      resultHash,
    );
    const retained = this.platform.offline.readInTransaction();
    insist(retained);
    this.platform.offline.transitionInTransaction(
      retained.state.generation,
      retained.anchor,
      {
        kind: "record-task",
        receipt: {
          owner: envelope.task.owner,
          orgId: actor.orgId,
          taskName: envelope.task.name,
          requestId: envelope.requestId,
          binding,
          payloadHash: envelope.task.payloadHash,
          beforeCandidateHash: envelope.candidate.logicalHash,
          resultHash,
        },
      },
      [],
    );
    return freeze({
      version: 1,
      status: "native-owner-application-only",
      effectId: joined.effectId,
      refundId: joined.refundId,
      binding,
      resultHash,
      receipt,
    });
  }
  private recoveryPreflight(expectedProvenance: 0 | 1) {
    let rows = 0,
      bytes = 0;
    const counts: Record<string, number> = {};
    for (const [table, fixed] of Object.entries(recoveryColumns)) {
      const n = this.#store.get(
        "SELECT COUNT(*) AS n FROM (SELECT 1 FROM " + table + " LIMIT 257)",
      )!.n;
      insist(
        Number.isSafeInteger(n) &&
          Number(n) <= 256 &&
          (rows += Number(n)) <= 512,
      );
      const columns = fixed.split(" "),
        sizes = columns.map((c) => `COALESCE(length(CAST(${c} AS BLOB)),0)`);
      const invalid = columns
        .map(
          (c) =>
            `(typeof(${c}) NOT IN ('null','text','integer') OR (typeof(${c})='integer' AND (${c}>9007199254740991 OR ${c} < -9007199254740991)) OR instr(CAST(${c} AS BLOB),x'00')>0)`,
        )
        .join(" OR ");
      const meta = this.#store.get<{
        field: number;
        row: number;
        total: number;
        bad: number;
      }>(
        `SELECT COALESCE(MAX(MAX(${sizes.join(",")})),0) AS field,COALESCE(MAX(${sizes.join("+")}),0) AS row,COALESCE(SUM(${sizes.join("+")}),0) AS total,COALESCE(SUM(CASE WHEN ${invalid} THEN 1 ELSE 0 END),0) AS bad FROM ${table}`,
      )!;
      insist(
        [meta.field, meta.row, meta.total].every(
          (n) => Number.isSafeInteger(n) && n >= 0,
        ) &&
          meta.field <= 65_536 &&
          meta.row <= 131_072 &&
          (bytes += meta.total) <= 2_097_152 &&
          meta.bad === 0,
      );
      counts[table] = Number(n);
    }
    insist(
      counts.integration_inbox === 0 &&
        counts.integration_callbacks === 0 &&
        counts.integration_refund_callbacks === 0 &&
        counts.integration_offline_failed_refunds === expectedProvenance &&
        counts.integration_operation_leases === 0 &&
        counts.integration_checkout_renewals === 0 &&
        counts.integration_checkout_observations === 0 &&
        counts.integration_payment_allocations === 0 &&
        counts.integration_accounting_refunds === 0 &&
        counts.integration_credit_applications === 0 &&
        counts.integration_credit_cancellations === 0 &&
        counts.integration_balance_reads === 0 &&
        counts.integration_balance_observations === 0,
    );
    const json = this.#store.get<{
      nodes: number;
      containers: number;
      bad: number;
    }>(
      `WITH docs AS (SELECT payload AS raw FROM integration_effects UNION ALL SELECT result FROM integration_effects WHERE result IS NOT NULL UNION ALL SELECT record FROM integration_offline_failed_refunds)
      SELECT COALESCE(MAX(1+length(raw)-length(replace(replace(replace(replace(raw,',',''),':',''),'[',''),'{',''))),0) AS nodes,
      COALESCE(MAX(length(raw)-length(replace(replace(raw,'[',''),'{',''))),0) AS containers,
      COALESCE(SUM(CASE WHEN typeof(raw)<>'text' THEN 1 ELSE 0 END),0) AS bad FROM docs`,
    )!;
    insist(json.nodes <= 4096 && json.containers <= 128 && json.bad === 0);
    insist(
      this.#store.get(
        `WITH docs AS (SELECT payload AS raw FROM integration_effects UNION ALL SELECT result FROM integration_effects WHERE result IS NOT NULL UNION ALL SELECT record FROM integration_offline_failed_refunds) SELECT COUNT(*) AS n FROM docs WHERE NOT json_valid(raw)`,
      )!.n === 0,
    );
  }
  recoverInTransaction(actorInput: Actor, envelopeInput: unknown) {
    this.database.requireTransaction();
    const actor = this.actor(actorInput),
      envelope = this.envelope(envelopeInput, actor);
    const changes = this.#store.get("SELECT total_changes() AS n")!.n;
    this.recoveryPreflight(1);
    const retained = this.#recovery.getInTransaction(actor, envelope);
    insist(
      retained.receipt &&
        retained.status === "retained-task-receipt-consistency-only",
    );
    const row = this.#store.get<{
      effect_id: string;
      org_id: string;
      request_id: string;
      binding: string;
      record: string;
      record_hash: string;
      raw: string;
    }>(
      "SELECT *,hex(CAST(record AS BLOB)) AS raw FROM integration_offline_failed_refunds WHERE effect_id=? AND org_id=?",
      envelope.task.subjectId,
      actor.orgId,
    );
    insist(
      row &&
        typeof row.record === "string" &&
        Buffer.from(row.record).toString("hex").toUpperCase() === row.raw &&
        row.request_id === envelope.requestId &&
        row.binding === retained.envelopeBinding &&
        row.record_hash === retained.receipt.resultHash &&
        row.record_hash === digest(row.record),
    );
    const record = JSON.parse(row.record) as RetainedRecord;
    insist(
      canonical(record) === row.record &&
        canonical(Object.keys(record).sort()) ===
          canonical(
            [
              "version",
              "purpose",
              "envelope",
              "actor",
              "binding",
              "phase",
              "nativeJoin",
              "nativeJoinHash",
              "failed",
              "afterEffect",
              "receipt",
            ].sort(),
          ),
    );
    insist(
      record.version === 1 &&
        record.purpose === purpose &&
        record.binding === row.binding &&
        canonical(parseOfflineTaskEnvelope(record.envelope)) ===
          canonical(envelope) &&
        record.nativeJoinHash === digest(canonical(record.nativeJoin)) &&
        record.nativeJoinHash === envelope.task.expectedStateHash,
    );
    const original = record.nativeJoin.native;
    const failed: OfflineFailedRefundTuple = {
      refundId: original.refund.id,
      invoiceId: original.invoice.id,
      paymentId: original.payment.external_ref,
      paymentAmount: original.payment.amount,
      amount: original.refund.amount,
      currency: original.organization.currency === "CAD" ? "cad" : "usd",
      externalReference: record.nativeJoin.proposedReference,
      status: "failed",
    };
    insist(
      record.nativeJoin.orgId === actor.orgId &&
        record.nativeJoin.effectId === row.effect_id &&
        record.nativeJoin.refundId === original.refund.id &&
        original.effect.id === row.effect_id &&
        original.effect.state === "unknown" &&
        original.effect.external_ref === null &&
        original.effect.result === null &&
        envelope.task.payloadHash ===
          digest(
            canonical({
              version: 1,
              comparisonInputHash: record.nativeJoin.comparisonInputHash,
            }),
          ) &&
        canonical(failed) === canonical(record.failed),
    );
    const result = canonical({
      effectId: row.effect_id,
      refundId: failed.refundId,
      paymentId: failed.paymentId,
      amount: failed.amount,
      currency: failed.currency,
      status: "failed",
    });
    const afterEffect = {
      ...original.effect,
      state: "completed",
      external_ref: failed.externalReference,
      result,
      started_at: null,
      error: null,
    };
    insist(canonical(record.afterEffect) === canonical(afterEffect));
    const effect = this.#store.get(
      "SELECT *,hex(CAST(payload AS BLOB)) AS payload_raw,hex(CAST(result AS BLOB)) AS result_raw FROM integration_effects WHERE id=? AND org_id=?",
      row.effect_id,
      actor.orgId,
    );
    insist(
      effect &&
        typeof effect.payload === "string" &&
        typeof effect.result === "string" &&
        Buffer.from(effect.payload).toString("hex").toUpperCase() ===
          effect.payload_raw &&
        Buffer.from(effect.result).toString("hex").toUpperCase() ===
          effect.result_raw,
    );
    const {
      payload_raw: _payloadRaw,
      result_raw: _resultRaw,
      ...currentEffect
    } = effect;
    const poll = this.#store.get(
      "SELECT * FROM integration_refund_polls WHERE effect_id=?",
      row.effect_id,
    );
    insist(
      canonical(currentEffect) === canonical(afterEffect) &&
        canonical(poll) === canonical(record.nativeJoin.history.poll),
    );
    insist(
      this.#store.get(
        "SELECT COUNT(*) AS n FROM integration_effects WHERE external_ref=? AND id<>?",
        failed.externalReference,
        row.effect_id,
      )!.n === 0,
    );
    const billing =
      this.billing.refunds.recoverOfflineFailedRefundInTransaction(
        actor,
        failed.refundId,
        record.receipt.observationId,
        record.receipt.noticeSequence,
        failed,
      );
    insist(canonical(billing.receipt) === canonical(record.receipt));
    insist(this.#store.get("SELECT total_changes() AS n")!.n === changes);
    return freeze({
      version: 1,
      status: "native-commit-recovery-consistency-only",
      effectId: row.effect_id,
      refundId: failed.refundId,
      binding: row.binding,
      resultHash: row.record_hash,
      receipt: billing.receipt,
      requiredChecks: retained.requiredChecks,
    });
  }
}
