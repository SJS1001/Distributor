import { COST_CORRECTION_OUTCOME_INITIALIZE_DDL } from "./cost-correction-outcome-schema.ts";
import {
  canonical,
  check,
  digest,
  id,
  integer,
  now,
  permit,
  text,
  type Actor,
} from "./core.ts";
import { Database, type Store } from "./database.ts";
import { Identity } from "./iam.ts";
import { Platform } from "./platform.ts";
import type {
  CostInput,
  CostReport,
  CostPacketView,
  JournalLine,
} from "./integration-costs.ts";
import { COST_CORRECTION_INITIALIZE_DDL } from "./cost-correction-schema.ts";

export type CostPolicyInput = {
  previousRevision: number;
  policyVersion: string;
  mappingVersion: string;
  establishedValuation: string;
  period: "monthly";
  closedThrough: string | null;
  inventoryPostingOwner: "distributor";
  inventoryAccount: string;
  mappings: { type: string; offsetAccount: string }[];
  financeEvidence: string;
};
export type CorrectionOutcomeInput = {
  correctionId: string;
  contentHash: string;
  leg: "reversal" | "replacement";
  previousRevision: number;
  outcome: "posted" | "cancelled-unposted" | "unknown";
  receiverRef: string;
  receiverRegion: "CA" | "US";
  currency: "CAD" | "USD";
  externalRef: string;
  debit: number;
  credit: number;
  postingDate: string | null;
  evidence: string;
};
export type CorrectionOutcomeObservation = {
  revision: number;
  input: CorrectionOutcomeInput;
  evidenceHash: string;
  recordedBy: string;
  recordedAt: string;
};
export type CorrectionInput = {
  originalId: string;
  originalHash: string;
  policyRevision: number;
  postingDate: string;
  outcome: "posted" | "unposted" | "unknown";
  receiverRef: string;
  externalRef: string;
  originalPostingDate: string | null;
  outcomeEvidence: string;
  cancellationEvidence: string | null;
  priorPeriodEvidence: string | null;
  reason: string;
};
type Correction = {
  id: string;
  org_id: string;
  original_id: string;
  original_hash: string;
  input: string;
  plan: string;
  review_hash: string;
  state: "ready" | "blocked" | "rejected" | "reviewed";
  created_by: string;
  created_at: string;
  decision_by: string | null;
  decision_at: string | null;
  decision_reason: string | null;
  artifact: string | null;
  content_hash: string | null;
};
const hash = (raw: string) => {
  check(
    typeof raw === "string" && /^[a-f0-9]{64}$/.test(raw),
    "VALIDATION",
    "Expected a lowercase SHA256 fingerprint.",
    400,
  );
  return raw;
};
export function accountingDate(raw: string) {
  const parsed =
    typeof raw === "string" ? new Date(raw + "T00:00:00.000Z") : new Date(NaN);
  check(
    typeof raw === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(raw) &&
      Number(raw.slice(0, 4)) >= 1900 &&
      Number(raw.slice(0, 4)) <= 9999 &&
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === raw,
    "VALIDATION",
    "Use a valid accounting date (YYYY-MM-DD).",
    400,
  );
  return raw;
}
const account = (raw: string) => {
  const value = text(raw, "Account code", 80);
  check(
    /^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(value),
    "VALIDATION",
    "Invalid account code.",
    400,
  );
  return value;
};

/** File handoffs only. Receiver evidence is an operator attestation, never an
 * inferred QuickBooks posting outcome. Original native custody and claims stay intact. */
export class CostCorrections {
  private store: Store;
  constructor(
    private database: Database,
    private platform: Platform,
    private identity: Identity,
    private original: (
      actor: Actor,
      packetId: string,
    ) => { packet: CostPacketView; report: CostReport; artifact: string },
  ) {
    this.store = database.owned("integration");
    this.store.migrate(COST_CORRECTION_INITIALIZE_DDL);
    this.store.migrate(COST_CORRECTION_OUTCOME_INITIALIZE_DDL);
  }
  private principal(actor: Actor) {
    actor = this.identity.currentActor(actor);
    permit(actor, ["finance"]);
    check(
      !actor.accountId && !this.identity.security(actor).passwordChangeRequired,
      "FORBIDDEN",
      "A current internal finance principal is required.",
      403,
    );
    return actor;
  }
  private current(actor: Actor) {
    const row = this.store.get(
      "SELECT * FROM integration_cost_policies WHERE org_id=? ORDER BY revision DESC LIMIT 1",
      actor.orgId,
    );
    if (!row) return null;
    const input = JSON.parse(String(row.input)) as CostPolicyInput;
    check(
      digest(canonical(input)) === String(row.policy_hash),
      "COST_INTEGRITY",
      "Correction policy failed its integrity check.",
    );
    return {
      revision: Number(row.revision),
      hash: String(row.policy_hash),
      input,
    };
  }
  policy(actor: Actor) {
    return this.database.transaction(() => this.current(this.principal(actor)));
  }
  configure(actor: Actor, key: string, input: CostPolicyInput) {
    actor = this.principal(actor);
    return this.platform.command(
      actor,
      "accounting.cost.policy",
      key,
      input,
      () => {
        actor = this.principal(actor);
        this.platform.assertProviderAccess();
      },
      () => {
        integer(
          input.previousRevision,
          "Previous policy revision",
          0,
          Number.MAX_SAFE_INTEGER - 1,
        );
        check(
          input.period === "monthly" &&
            input.inventoryPostingOwner === "distributor",
          "COST_POLICY",
          "Select monthly periods and one Distributor inventory posting owner.",
          400,
        );
        const current = this.current(actor);
        check(
          input.previousRevision === (current?.revision ?? 0),
          "REVISION_CONFLICT",
          "Review the current accounting policy before replacing it.",
        );
        const inventoryAccount = account(input.inventoryAccount);
        check(
          Array.isArray(input.mappings) &&
            input.mappings.length > 0 &&
            input.mappings.length <= 30,
          "VALIDATION",
          "Supply 1–30 reviewed movement mappings.",
          400,
        );
        const mappings = input.mappings
          .map((m) => ({
            type: text(m.type, "Movement type", 80),
            offsetAccount: account(m.offsetAccount),
          }))
          .sort((a, b) => a.type.localeCompare(b.type));
        check(
          new Set(mappings.map((m) => m.type)).size === mappings.length &&
            mappings.every((m) => m.offsetAccount !== inventoryAccount),
          "COST_POLICY",
          "Each movement needs one offset account distinct from inventory.",
        );
        const closedThrough =
          input.closedThrough === null
            ? null
            : accountingDate(input.closedThrough);
        check(
          !current?.input.closedThrough ||
            (closedThrough !== null &&
              closedThrough >= current.input.closedThrough),
          "COST_PERIOD",
          "This workflow cannot reopen a closed accounting period.",
        );
        const normalized: CostPolicyInput = {
          previousRevision: input.previousRevision,
          policyVersion: text(input.policyVersion, "Policy version", 100),
          mappingVersion: text(input.mappingVersion, "Mapping version", 100),
          establishedValuation: text(
            input.establishedValuation,
            "Established valuation and finance basis",
            2000,
          ),
          period: "monthly",
          closedThrough,
          inventoryPostingOwner: "distributor",
          inventoryAccount,
          mappings,
          financeEvidence: text(
            input.financeEvidence,
            "Responsible finance review",
            2000,
          ),
        };
        const revision = input.previousRevision + 1;
        this.store.run(
          "INSERT INTO integration_cost_policies VALUES(?,?,?,?,?,?)",
          actor.orgId,
          revision,
          canonical(normalized),
          digest(canonical(normalized)),
          actor.id,
          now(),
        );
        return this.current(actor)!;
      },
    );
  }
  private row(actor: Actor, correctionId: string) {
    const row = this.store.get(
      "SELECT * FROM integration_cost_corrections WHERE org_id=? AND id=?",
      actor.orgId,
      text(correctionId, "Correction ID"),
    );
    check(row, "NOT_FOUND", "Correction not found.", 404);
    return row as unknown as Correction;
  }
  private view(row: Correction) {
    return {
      id: row.id,
      originalId: row.original_id,
      originalHash: row.original_hash,
      input: JSON.parse(row.input) as CorrectionInput,
      state: row.state,
      reviewHash: row.review_hash,
      createdBy: row.created_by,
      createdAt: row.created_at,
      decisionBy: row.decision_by,
      decisionAt: row.decision_at,
      decisionReason: row.decision_reason,
      contentHash: row.content_hash,
    };
  }
  private plan(actor: Actor, input: CorrectionInput) {
    const policy = this.current(actor);
    check(
      policy && policy.revision === input.policyRevision,
      "COST_POLICY",
      "Correction must use the current reviewed policy revision.",
    );
    const source = this.original(actor, input.originalId),
      { packet, report } = source;
    check(
      packet.contentHash === input.originalHash &&
        digest(source.artifact) === input.originalHash,
      "COST_INTEGRITY",
      "Correction must bind the exact immutable approved original.",
    );
    check(
      !policy.input.closedThrough ||
        input.postingDate > policy.input.closedThrough,
      "COST_PERIOD",
      "Correction posting date belongs to a closed period.",
    );
    this.assertReferenceAvailable(
      actor,
      input.receiverRef,
      input.externalRef,
      packet.id,
    );
    check(
      !this.store.get(
        "SELECT packet_id FROM integration_cost_receipts WHERE org_id=? AND receiver_ref=? AND external_ref=? AND packet_id<>?",
        actor.orgId,
        input.receiverRef,
        input.externalRef,
        packet.id,
      ),
      "COST_REFERENCE_CONFLICT",
      "Original outcome reference identifies another cost handoff.",
    );
    const receipt = packet.receipt;
    check(
      !receipt ||
        (receipt.receiverRef === input.receiverRef &&
          receipt.externalRef === input.externalRef),
      "COST_OUTCOME",
      "Ledger evidence differs from the original receiver acceptance.",
    );
    if (input.outcome === "posted") {
      check(
        input.originalPostingDate !== null,
        "COST_OUTCOME",
        "Posted outcomes require the verified original ledger posting date.",
      );
      check(
        !policy.input.closedThrough ||
          input.originalPostingDate > policy.input.closedThrough ||
          input.priorPeriodEvidence,
        "COST_PRIOR_PERIOD",
        "Responsible finance must review correction of a closed prior period.",
      );
    }
    if (input.outcome === "unposted")
      check(
        input.cancellationEvidence,
        "COST_OUTCOME",
        "Verified non-posting and receiver cancellation evidence are required before replacement.",
      );
    const mappings = new Map(
      policy.input.mappings.map((m) => [m.type, m.offsetAccount]),
    );
    const movements = new Map(report.movements.map((m) => [m.id, m]));
    const oldInput = packet.input as CostInput;
    const replacement: JournalLine[] = report.journal.map((line) => {
      const movement = movements.get(line.movementId);
      check(movement, "COST_INTEGRITY", "Journal movement lineage is missing.");
      const offset = mappings.get(movement.type);
      check(
        offset,
        "COST_POLICY",
        "Policy does not map every original movement type.",
      );
      return {
        ...line,
        date: input.postingDate,
        account:
          line.account === oldInput.inventoryAccount
            ? policy.input.inventoryAccount
            : offset,
      };
    });
    const reversal: JournalLine[] =
      input.outcome === "posted"
        ? report.journal.map((line) => ({
            ...line,
            date: input.postingDate,
            debit: line.credit,
            credit: line.debit,
          }))
        : [];
    check(
      canonical(replacement.map((l) => l.account)) !==
        canonical(report.journal.map((l) => l.account)),
      "COST_NO_CHANGE",
      "This workflow corrects account mappings; source quantity, value or valuation errors require their own inventory/finance review.",
    );
    for (const lines of [reversal, replacement]) {
      const debit = lines.reduce(
          (sum, l) =>
            sum +
            BigInt(
              integer(l.debit, "Journal debit", 0, Number.MAX_SAFE_INTEGER),
            ),
          0n,
        ),
        credit = lines.reduce(
          (sum, l) =>
            sum +
            BigInt(
              integer(l.credit, "Journal credit", 0, Number.MAX_SAFE_INTEGER),
            ),
          0n,
        );
      check(
        debit === credit && debit <= BigInt(Number.MAX_SAFE_INTEGER),
        "COST_CONTROL",
        "Each correction journal must balance within the exact supported integer range.",
      );
    }
    return {
      orgId: actor.orgId,
      originalReceipt: packet.receipt,
      originalId: packet.id,
      originalHash: packet.contentHash,
      region: packet.region,
      currency: packet.currency,
      policy,
      input,
      reversal,
      replacement,
      debit: report.debit,
      credit: report.credit,
    };
  }
  prepare(actor: Actor, key: string, input: CorrectionInput) {
    actor = this.principal(actor);
    return this.platform.command(
      actor,
      "accounting.cost.correction.prepare",
      key,
      input,
      () => {
        actor = this.principal(actor);
        this.platform.assertProviderAccess();
      },
      () => {
        const normalized: CorrectionInput = {
          originalId: text(input.originalId, "Original packet ID"),
          originalHash: hash(input.originalHash),
          policyRevision: integer(
            input.policyRevision,
            "Policy revision",
            1,
            Number.MAX_SAFE_INTEGER,
          ),
          postingDate: accountingDate(input.postingDate),
          outcome: input.outcome,
          receiverRef: text(input.receiverRef, "Ledger receiver", 100),
          externalRef: text(input.externalRef, "Ledger outcome reference", 160),
          originalPostingDate:
            input.originalPostingDate === null
              ? null
              : accountingDate(input.originalPostingDate),
          outcomeEvidence: text(
            input.outcomeEvidence,
            "Verified ledger outcome evidence",
            2000,
          ),
          cancellationEvidence:
            input.cancellationEvidence === null
              ? null
              : text(
                  input.cancellationEvidence,
                  "Receiver cancellation evidence",
                  2000,
                ),
          priorPeriodEvidence:
            input.priorPeriodEvidence === null
              ? null
              : text(
                  input.priorPeriodEvidence,
                  "Prior period finance review",
                  2000,
                ),
          reason: text(input.reason, "Correction reason", 2000),
        };
        check(
          ["posted", "unposted", "unknown"].includes(normalized.outcome),
          "VALIDATION",
          "Invalid posting outcome.",
          400,
        );
        check(
          !this.store.get(
            "SELECT id FROM integration_cost_corrections WHERE org_id=? AND original_id=? AND state='reviewed'",
            actor.orgId,
            normalized.originalId,
          ),
          "COST_CORRECTION_CONFLICT",
          "The original already has an approved correction; repeated reversals are forbidden.",
        );
        const plan = this.plan(actor, normalized),
          correctionId = id();
        this.store.run(
          "INSERT INTO integration_cost_corrections(id,org_id,original_id,original_hash,input,plan,review_hash,state,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
          correctionId,
          actor.orgId,
          normalized.originalId,
          normalized.originalHash,
          canonical(normalized),
          canonical(plan),
          digest(canonical(plan)),
          normalized.outcome === "unknown" ? "blocked" : "ready",
          actor.id,
          now(),
        );
        return { ...this.view(this.row(actor, correctionId)), plan };
      },
    );
  }
  detail(actor: Actor, correctionId: string) {
    return this.database.transaction(() => {
      actor = this.principal(actor);
      const row = this.row(actor, correctionId);
      // Keep the frozen review visible after a policy change; never silently re-plan it.
      return {
        ...this.view(row),
        plan: JSON.parse(row.plan) as unknown,
        artifact: row.artifact ? (JSON.parse(row.artifact) as unknown) : null,
      };
    });
  }
  list(actor: Actor, originalId: string) {
    return this.database.transaction(() => {
      actor = this.principal(actor);
      this.original(actor, originalId);
      return (
        this.store.all(
          "SELECT * FROM integration_cost_corrections WHERE org_id=? AND original_id=? ORDER BY created_at DESC,id DESC LIMIT 100",
          actor.orgId,
          originalId,
        ) as unknown as Correction[]
      ).map((row) => this.view(row));
    });
  }
  decide(
    actor: Actor,
    key: string,
    input: {
      correctionId: string;
      reviewHash: string;
      decision: "approve" | "reject";
      reason: string;
    },
  ) {
    actor = this.principal(actor);
    return this.platform.command(
      actor,
      "accounting.cost.correction.decide",
      key,
      input,
      () => {
        actor = this.principal(actor);
        this.platform.assertProviderAccess();
        this.row(actor, input.correctionId);
      },
      () => {
        const row = this.row(actor, input.correctionId),
          reason = text(input.reason, "Review reason", 2000);
        check(
          ["approve", "reject"].includes(input.decision),
          "VALIDATION",
          "Invalid correction decision.",
          400,
        );
        check(
          row.review_hash === input.reviewHash,
          "COST_REVIEW_CHANGED",
          "Review the exact prepared correction.",
        );
        if (["reviewed", "rejected"].includes(row.state)) {
          check(
            row.state ===
              (input.decision === "approve" ? "reviewed" : "rejected") &&
              row.decision_by === actor.id &&
              row.decision_reason === reason,
            "COST_DECISION_CONFLICT",
            "Correction already has another decision.",
          );
          return this.view(row);
        }
        check(
          actor.id !== row.created_by,
          "COST_SEPARATE_REVIEW",
          "A different current finance principal must review this correction.",
          403,
        );
        let artifact: string | null = null,
          contentHash: string | null = null;
        if (input.decision === "approve") {
          check(
            row.state === "ready",
            "COST_OUTCOME",
            "Unknown ledger outcomes cannot be approved or transmitted.",
          );
          const plan = this.plan(
            actor,
            JSON.parse(row.input) as CorrectionInput,
          );
          check(
            digest(canonical(plan)) === row.review_hash,
            "COST_REVIEW_CHANGED",
            "Original acceptance or current policy changed after preparation.",
          );
          check(
            !this.store.get(
              "SELECT id FROM integration_cost_corrections WHERE org_id=? AND original_id=? AND state='reviewed'",
              actor.orgId,
              row.original_id,
            ),
            "COST_CORRECTION_CONFLICT",
            "Another correction already claims this original.",
          );
          artifact =
            canonical({
              version: 1,
              kind: "stock-cost-account-mapping-correction",
              correctionId: row.id,
              ...plan,
              reviewHash: row.review_hash,
              preparedBy: row.created_by,
              preparedAt: row.created_at,
              reviewedBy: actor.id,
              reviewedAt: now(),
              reason,
            }) + "\n";
          contentHash = digest(artifact);
        }
        this.store.run(
          "UPDATE integration_cost_corrections SET state=?,decision_by=?,decision_at=?,decision_reason=?,artifact=?,content_hash=? WHERE org_id=? AND id=?",
          input.decision === "approve" ? "reviewed" : "rejected",
          actor.id,
          now(),
          reason,
          artifact,
          contentHash,
          actor.orgId,
          row.id,
        );
        this.platform.audit(
          actor,
          "accounting.cost.correction.decided",
          row.id,
          {
            originalHash: row.original_hash,
            contentHash,
            decision: input.decision,
          },
        );
        return this.view(this.row(actor, row.id));
      },
    );
  }

  /** Integration-owned ledger identities. Reservations survive cancellation and uncertainty. */
  assertReferenceAvailable(
    actor: Actor,
    receiver: string,
    external: string,
    originalId?: string,
  ) {
    check(
      !this.store.get(
        "SELECT correction_id FROM integration_cost_correction_references WHERE org_id=? AND receiver_ref=? AND external_ref=?",
        actor.orgId,
        receiver,
        external,
      ) &&
        !this.store.get(
          "SELECT id FROM integration_cost_corrections WHERE org_id=? AND state='reviewed' AND json_extract(input,'$.receiverRef')=? AND json_extract(input,'$.externalRef')=? AND original_id<>?",
          actor.orgId,
          receiver,
          external,
          originalId ?? "",
        ),
      "COST_REFERENCE_CONFLICT",
      "Ledger reference is already reserved by a correction or its original outcome.",
    );
  }
  private observations(
    actor: Actor,
    correctionId: string,
  ): CorrectionOutcomeObservation[] {
    return (["reversal", "replacement"] as const)
      .flatMap((leg) =>
        this.store
          .all(
            "SELECT * FROM integration_cost_correction_outcomes WHERE org_id=? AND correction_id=? AND leg=? ORDER BY revision DESC LIMIT 100",
            actor.orgId,
            correctionId,
            leg,
          )
          .reverse(),
      )
      .map((row) => {
        const input = JSON.parse(String(row.input)) as CorrectionOutcomeInput;
        const observation = {
          revision: Number(row.revision),
          input,
          recordedBy: String(row.recorded_by),
          recordedAt: String(row.recorded_at),
        };
        check(
          digest(canonical(observation)) === row.evidence_hash &&
            input.correctionId === correctionId &&
            input.leg === row.leg &&
            input.previousRevision === observation.revision - 1,
          "COST_INTEGRITY",
          "Ledger observation failed its integrity check.",
        );
        return { ...observation, evidenceHash: String(row.evidence_hash) };
      });
  }
  outcomes(actor: Actor, correctionId: string) {
    return this.database.transaction(() =>
      this.outcomeSnapshot(this.principal(actor), correctionId),
    );
  }
  private outcomeSnapshot(actor: Actor, correctionId: string) {
    const file = this.approvedFile(actor, correctionId);
    const artifact = JSON.parse(file.bytes) as {
      orgId: string;
      correctionId: string;
      region: "CA" | "US";
      currency: "CAD" | "USD";
      input: CorrectionInput;
      reversal: JournalLine[];
      replacement: JournalLine[];
    };
    check(
      artifact.orgId === actor.orgId && artifact.correctionId === correctionId,
      "COST_INTEGRITY",
      "Correction artifact identity does not match this organization and correction.",
    );
    const observations = this.observations(actor, correctionId);
    return {
      correctionId,
      contentHash: file.hash,
      receiverRef: artifact.input.receiverRef,
      receiverRegion: artifact.region,
      currency: artifact.currency,
      legs: (["reversal", "replacement"] as const)
        .filter((leg) => artifact[leg].length > 0)
        .map((leg) => {
          const history = observations.filter((o) => o.input.leg === leg);
          const total = artifact[leg].reduce(
            (sum, l) =>
              sum +
              BigInt(
                integer(l.debit, "Journal debit", 0, Number.MAX_SAFE_INTEGER),
              ),
            0n,
          );
          const credit = artifact[leg].reduce(
            (sum, l) =>
              sum +
              BigInt(
                integer(l.credit, "Journal credit", 0, Number.MAX_SAFE_INTEGER),
              ),
            0n,
          );
          check(
            total === credit && total <= BigInt(Number.MAX_SAFE_INTEGER),
            "COST_CONTROL",
            "Journal total exceeds safe accounting limits.",
          );
          const reference = this.store.get(
            "SELECT receiver_ref,external_ref FROM integration_cost_correction_references WHERE org_id=? AND correction_id=? AND leg=?",
            actor.orgId,
            correctionId,
            leg,
          );
          check(
            history.length
              ? reference?.receiver_ref === artifact.input.receiverRef &&
                  reference.external_ref === history.at(-1)!.input.externalRef
              : !reference,
            "COST_INTEGRITY",
            "Ledger observation does not match its retained request reservation.",
          );
          return {
            leg,
            debit: Number(total),
            credit: Number(total),
            postingDate: artifact[leg][0]!.date,
            current: history.at(-1) ?? null,
            history,
          };
        }),
    };
  }
  observe(actor: Actor, key: string, input: CorrectionOutcomeInput) {
    actor = this.principal(actor);
    return this.platform.command(
      actor,
      "accounting.cost.correction.observe",
      key,
      input,
      () => {
        actor = this.principal(actor);
        this.platform.assertProviderAccess();
        this.outcomeSnapshot(actor, input.correctionId);
      },
      () => {
        const state = this.outcomeSnapshot(actor, input.correctionId);
        const normalized: CorrectionOutcomeInput = {
          ...input,
          correctionId: text(input.correctionId, "Correction ID"),
          contentHash: hash(input.contentHash),
          previousRevision: integer(
            input.previousRevision,
            "Previous observation revision",
            0,
            Number.MAX_SAFE_INTEGER - 1,
          ),
          receiverRef: text(input.receiverRef, "Ledger receiver", 100),
          externalRef: text(
            input.externalRef,
            "Ledger journal or request reference",
            160,
          ),
          debit: integer(
            input.debit,
            "Intended debit total",
            0,
            Number.MAX_SAFE_INTEGER,
          ),
          credit: integer(
            input.credit,
            "Intended credit total",
            0,
            Number.MAX_SAFE_INTEGER,
          ),
          postingDate:
            input.postingDate === null
              ? null
              : accountingDate(input.postingDate),
          evidence: text(input.evidence, "Ledger observation evidence", 2000),
        };
        check(
          ["posted", "cancelled-unposted", "unknown"].includes(
            normalized.outcome,
          ),
          "VALIDATION",
          "Invalid ledger observation outcome.",
          400,
        );
        check(
          state.contentHash === normalized.contentHash,
          "COST_INTEGRITY",
          "Observe the exact approved correction artifact.",
        );
        check(
          state.receiverRef === normalized.receiverRef &&
            state.receiverRegion === normalized.receiverRegion &&
            state.currency === normalized.currency,
          "RESIDENCY",
          "Ledger observation must match the approved receiver, region and currency.",
        );
        const leg = state.legs.find((l) => l.leg === normalized.leg);
        check(leg, "COST_LEG", "This approved correction has no such journal.");
        check(
          leg.debit === normalized.debit &&
            leg.credit === normalized.credit &&
            (normalized.outcome === "posted"
              ? normalized.postingDate === leg.postingDate
              : normalized.postingDate === null),
          "COST_CONTROL",
          "Intended journal totals and observed posting date must match the approved leg; unknown or cancelled outcomes have no posting date.",
        );
        if (
          leg.current &&
          canonical(leg.current.input) === canonical(normalized)
        )
          return leg.current;
        check(
          normalized.previousRevision === (leg.current?.revision ?? 0),
          "REVISION_CONFLICT",
          "Reload the retained journal observations before adding evidence.",
        );
        check(
          !leg.current || leg.current.input.outcome === "unknown",
          "COST_OUTCOME_FINAL",
          "A terminal journal observation is immutable; further corrections require a separate reviewed process.",
        );
        if (leg.current)
          check(
            leg.current.input.externalRef === normalized.externalRef,
            "COST_REFERENCE_CONFLICT",
            "Resolve the same uncertain request reference; changing it risks a duplicate posting.",
          );
        else {
          this.assertReferenceAvailable(
            actor,
            normalized.receiverRef,
            normalized.externalRef,
          );
          check(
            !this.store.get(
              "SELECT packet_id FROM integration_cost_receipts WHERE org_id=? AND receiver_ref=? AND external_ref=?",
              actor.orgId,
              normalized.receiverRef,
              normalized.externalRef,
            ),
            "COST_REFERENCE_CONFLICT",
            "Ledger reference already identifies an original cost handoff.",
          );
        }
        if (
          normalized.leg === "replacement" &&
          normalized.outcome === "posted"
        ) {
          const reversal = state.legs.find((l) => l.leg === "reversal");
          check(
            !reversal || reversal.current?.input.outcome === "posted",
            "COST_REVERSAL_REQUIRED",
            "Retain verified reversal posting evidence before replacement posting evidence.",
          );
        }
        if (!leg.current)
          this.store.run(
            "INSERT INTO integration_cost_correction_references VALUES(?,?,?,?,?)",
            actor.orgId,
            normalized.receiverRef,
            normalized.externalRef,
            state.correctionId,
            normalized.leg,
          );
        const observation = {
          revision: normalized.previousRevision + 1,
          input: normalized,
          recordedBy: actor.id,
          recordedAt: now(),
        };
        const evidenceHash = digest(canonical(observation));
        this.store.run(
          "INSERT INTO integration_cost_correction_outcomes VALUES(?,?,?,?,?,?,?,?)",
          state.correctionId,
          normalized.leg,
          observation.revision,
          actor.orgId,
          canonical(normalized),
          evidenceHash,
          actor.id,
          observation.recordedAt,
        );
        this.platform.audit(
          actor,
          "accounting.cost.correction.observed",
          state.correctionId,
          {
            leg: normalized.leg,
            outcome: normalized.outcome,
            revision: observation.revision,
            evidenceHash,
          },
        );
        return { ...observation, evidenceHash };
      },
    );
  }

  download(actor: Actor, correctionId: string) {
    return this.database.transaction(() =>
      this.approvedFile(this.principal(actor), correctionId),
    );
  }
  private approvedFile(actor: Actor, correctionId: string) {
    const row = this.row(actor, correctionId);
    check(
      row.state === "reviewed" &&
        row.artifact &&
        row.content_hash &&
        digest(row.artifact) === row.content_hash,
      "COST_REVIEW_REQUIRED",
      "Only the intact approved correction can be downloaded.",
    );
    return {
      bytes: row.artifact,
      hash: row.content_hash,
      filename: `distributor-cost-correction-${row.id}.json`,
    };
  }
}
