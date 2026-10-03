import { types } from "node:util";
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
  type Row,
} from "./core.ts";
import { Database, type Store } from "./database.ts";
import { Identity } from "./iam.ts";
import { Platform } from "./platform.ts";
import type { IntegrationCosts, JournalLine } from "./integration-costs.ts";
import type { Effect, EffectResult } from "./integration.ts";
import type { LedgerAuthority } from "./organization-residency.ts";
import {
  stockJournalIntent,
  type StockJournalIntent,
} from "./quickbooks-stock-journal.ts";
import { STOCK_JOURNAL_INITIALIZE_DDL } from "./stock-journal-schema.ts";
import {
  reconciliationControls,
  type JournalReconciliationDate,
  type JournalReconciliationSnapshot,
} from "./stock-journal-reconciliation.ts";
import {
  journalPermissions,
  permissionInput,
  permissionDecision,
  type JournalPermissionInput,
  type JournalPermissionDecision,
} from "./stock-journal-permissions.ts";
import {
  originalCancellationEvidenceInput,
  originalCancellationInput,
  type OriginalCancellationEvidenceInput,
  type OriginalCancellationInput,
} from "./stock-journal-original-cancellation.ts";

import {
  assertCapturedOfflineOriginalEvidence,
  StockJournalOfflineOriginalEvidence,
  type CapturedOfflineOriginalEvidence,
} from "./stock-journal-offline-original-evidence.ts";

// Fixed offline profile; no caller-selected SQL, source or validation port.
const offlineOriginalProfile = Object.freeze({
  rowsPerTable: 128,
  totalRows: 512,
  fieldBytes: 2_000_000,
  rowBytes: 4_000_000,
  totalBytes: 8_000_000,
  jsonNodes: 8192,
  jsonContainers: 512,
});
const offlineOriginalColumns = {
  integration_stock_journals:
    "id org_id realm binding_id source_id leg posting_date attempt_id plan review_hash state created_by created_at decision_by decision_at decision_reason lease_id lease_actor lease_started lease_mode dispatched external_id",
  integration_stock_journal_observations:
    "journal_id revision org_id body hash recorded_by recorded_at",
  integration_stock_journal_references: "org_id realm request_ref journal_id",
  integration_cost_packets:
    "sequence id org_id batch_ref region currency input input_hash report review_hash state created_by created_at decision_by decision_at decision_reason artifact content_hash receipt",
  integration_cost_policies:
    "org_id revision input policy_hash created_by created_at",
  integration_cost_corrections:
    "id org_id original_id original_hash input plan review_hash state created_by created_at decision_by decision_at decision_reason artifact content_hash",
  integration_cost_receipts: "org_id receiver_ref external_ref packet_id",
  integration_cost_sources: "org_id movement_id packet_id",
} as const;
function offlineOriginalCheck(value: unknown): asserts value {
  check(
    value,
    "OFFLINE_ORIGINAL_REVIEW",
    "Native original journal history is inconsistent or unsupported.",
  );
}
function offlineOriginalBound(value: unknown): asserts value {
  check(
    value,
    "OFFLINE_ORIGINAL_LIMIT",
    "Native original journal exceeds its bounded profile.",
  );
}
function offlineOriginalId(value: unknown): asserts value is string {
  check(
    !types.isProxy(value) &&
      typeof value === "string" &&
      value.length > 0 &&
      value.length <= 160 &&
      value.trim() === value &&
      /^[A-Za-z0-9_-]+$/.test(value),
    "OFFLINE_ORIGINAL_INPUT",
    "Use exact native actor and journal identities.",
    400,
  );
}
function offlineOriginalActor(actor: Actor): Actor {
  check(
    !types.isProxy(actor) &&
      actor !== null &&
      typeof actor === "object" &&
      [Object.prototype, null].includes(Object.getPrototypeOf(actor)),
    "OFFLINE_ORIGINAL_INPUT",
    "Use a native actor locator.",
    400,
  );
  const fields = Object.getOwnPropertyDescriptors(actor);
  for (const key of Reflect.ownKeys(fields))
    check(
      typeof key === "string" &&
        ["id", "orgId", "role", "accountId", "sites", "name"].includes(key) &&
        "value" in fields[key]! &&
        fields[key]!.enumerable,
      "OFFLINE_ORIGINAL_INPUT",
      "Use native actor data fields.",
      400,
    );
  const id = fields.id?.value,
    orgId = fields.orgId?.value;
  offlineOriginalId(id);
  offlineOriginalId(orgId);
  // Only primitive locators survive capture; supplied grants are discarded.
  return { id, orgId } as Actor;
}
type OfflineFrozen<T> = T extends object
  ? { readonly [K in keyof T]: OfflineFrozen<T[K]> }
  : T;
function offlineOriginalFreeze<T>(value: T): OfflineFrozen<T> {
  if (value && typeof value === "object") {
    Object.values(value).forEach(offlineOriginalFreeze);
    Object.freeze(value);
  }
  return value as OfflineFrozen<T>;
}

function offlineCancellationHash(value: unknown): asserts value is string {
  check(
    !types.isProxy(value) &&
      typeof value === "string" &&
      /^[a-f0-9]{64}$/.test(value),
    "OFFLINE_ORIGINAL_APPLICATION",
    "Use an exact retained observation hash.",
  );
}
function offlineCancellationActor(value: Actor): Actor {
  const locator = offlineOriginalActor(value);
  // Discarded grants must still be inert: never execute nested caller values.
  const fields = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(fields)) {
    const v: unknown = descriptor.value;
    offlineOriginalCheck(!types.isProxy(v));
    if (key === "sites") {
      offlineOriginalCheck(
        Array.isArray(v) && Object.getPrototypeOf(v) === Array.prototype,
      );
      const keys = Reflect.ownKeys(v);
      offlineOriginalBound(keys.length <= 129);
      const ds = Object.getOwnPropertyDescriptors(v) as unknown as Record<
        string,
        PropertyDescriptor
      >;
      const length = ds.length!.value;
      offlineOriginalCheck(
        Number.isSafeInteger(length) &&
          length >= 0 &&
          length <= 128 &&
          keys.length === length + 1,
      );
      for (let i = 0; i < length; i++) {
        const d = ds[String(i)];
        offlineOriginalCheck(d && d.enumerable && "value" in d);
        offlineOriginalId(d.value);
      }
    } else {
      offlineOriginalCheck(
        v === null ||
          (typeof v === "string" &&
            Buffer.byteLength(v) <= 2000 &&
            !v.includes("\0")),
      );
    }
  }
  return locator;
}

export type JournalDeliveryInput = {
  sourceId: string;
  sourceHash: string;
  leg: StockJournalIntent["leg"];
  postingDate: string;
  attemptId: string | null;
  bindingId: string;
  realm: string;
  policyRevision: number;
  authority: LedgerAuthority;
  accounts: StockJournalIntent["accounts"];
  reason: string;
};
export type OriginalRetryInput = {
  journalId: string;
  reviewHash: string;
  reason: string;
};
type Plan = {
  input: JournalDeliveryInput;
  intent: StockJournalIntent;
  policyHash: string;
  predecessor?: {
    journalId: string;
    reviewHash: string;
    cancellationHash: string;
    historyHash: string;
  };
};
type Journal = {
  id: string;
  org_id: string;
  realm: string;
  binding_id: string;
  source_id: string;
  leg: StockJournalIntent["leg"];
  posting_date: string;
  attempt_id: string;
  plan: string;
  review_hash: string;
  state:
    | "ready"
    | "rejected"
    | "pending"
    | "running"
    | "unknown"
    | "posted"
    | "cancelled";
  created_by: string;
  created_at: string;
  decision_by: string | null;
  decision_at: string | null;
  decision_reason: string | null;
  lease_id: string | null;
  lease_actor: string | null;
  lease_started: number | null;
  lease_mode: "write" | "lookup" | null;
  dispatched: number;
  external_id: string | null;
};
export type JournalQueueInput = {
  sourceId?: string;
  state?: Journal["state"];
  after?: string;
};
export type JournalLease = Readonly<{
  journalId: string;
  orgId: string;
  actor: Readonly<Actor>;
  leaseId: string;
  started: number;
  mode: "write" | "lookup";
  effect: Readonly<Effect>;
  bindingId: string;
  realm: string;
  authority: Readonly<LedgerAuthority>;
}>;
const leaseDuration = 120_000;
const requestRef = (journalId: string) =>
  `DJ-${digest(journalId).slice(0, 18)}`;
export const stockJournalReceiver = (realm: string) =>
  `quickbooks-sandbox:${realm}`;
// Native ownership only. HTTP may expose review and history operations, never
// leases or provider I/O. Only a separately wired transport can use these leases.
export class StockJournalDelivery {
  private readonly store: Store;
  private readonly leases = new WeakSet<object>();
  constructor(
    private readonly database: Database,
    private readonly platform: Platform,
    private readonly identity: Identity,
    private readonly costs: IntegrationCosts,
  ) {
    this.store = database.owned("integration");
    this.store.migrate(STOCK_JOURNAL_INITIALIZE_DDL);
  }
  private principal(actor: Actor) {
    actor = this.identity.currentActor(actor);
    permit(actor, ["finance"]);
    check(
      !actor.accountId,
      "FORBIDDEN",
      "Organization finance authority is required.",
      403,
    );
    check(
      !this.identity.security(actor).passwordChangeRequired,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before journal operations.",
      403,
    );
    return actor;
  }
  private row(actor: Actor, journalId: string) {
    const row = this.store.get<Journal>(
      "SELECT * FROM integration_stock_journals WHERE org_id=? AND id=?",
      actor.orgId,
      journalId,
    );
    check(row, "NOT_FOUND", "Journal delivery not found.", 404);
    const checked = this.checkedRow(row);
    if (checked.leg === "original") this.originalLineage(actor, checked);
    return checked;
  }
  private checkedRow(row: Journal) {
    const plan = JSON.parse(row.plan) as Plan;
    check(
      digest(row.plan) === row.review_hash &&
        plan.intent.organizationId === row.org_id &&
        plan.input.sourceId === row.source_id &&
        plan.input.leg === row.leg &&
        plan.input.postingDate === row.posting_date &&
        (plan.input.attemptId ?? "") === row.attempt_id &&
        plan.input.bindingId === row.binding_id &&
        plan.input.realm === row.realm &&
        plan.intent.realmId === row.realm &&
        plan.intent.leg === row.leg &&
        plan.intent.postingDate === row.posting_date &&
        plan.intent.source.hash === plan.input.sourceHash,
      "JOURNAL_INTEGRITY",
      "Journal delivery differs from its frozen review.",
    );
    stockJournalIntent(plan.intent);
    return row;
  }
  private view(row: Journal) {
    return {
      id: row.id,
      sourceId: row.source_id,
      sourceHash: (JSON.parse(row.plan) as Plan).input.sourceHash,
      leg: row.leg,
      postingDate: row.posting_date,
      attemptId: row.attempt_id || null,
      bindingId: row.binding_id,
      realm: row.realm,
      reviewHash: row.review_hash,
      requestRef: requestRef(row.id),
      state: row.state,
      externalId: row.external_id,
      createdBy: row.created_by,
      createdAt: row.created_at,
      decisionBy: row.decision_by,
      decisionAt: row.decision_at,
      decisionReason: row.decision_reason,
      leaseStarted: row.lease_started,
      leaseMode: row.lease_mode,
      dispatched: !!row.dispatched,
      plan: JSON.parse(row.plan) as Plan,
    };
  }
  private source(actor: Actor, input: JournalDeliveryInput, write: boolean) {
    if (input.leg === "original") {
      if (input.attemptId !== null) {
        const predecessor = this.row(actor, input.attemptId);
        check(
          predecessor.leg === "original" &&
            predecessor.state === "cancelled" &&
            predecessor.source_id === input.sourceId &&
            predecessor.posting_date === input.postingDate &&
            predecessor.realm === input.realm &&
            predecessor.binding_id === input.bindingId,
          "JOURNAL_PREDECESSOR",
          "A fresh original must retain its cancelled exact source/date/company predecessor.",
        );
        this.originalCancelledProof(actor, predecessor);
      }
      const source = this.costs.deliverySourceInTransaction(
        actor,
        input.sourceId,
      );
      if (write)
        check(
          !source.accepted && !source.superseded,
          "JOURNAL_SUPERSEDED",
          "Accepted or corrected originals cannot be sent again.",
        );
      return source.file;
    }
    const source = this.costs.corrections.deliverySourceInTransaction(
      actor,
      input.sourceId,
    );
    const document = JSON.parse(source.file.bytes);
    check(
      source.state.receiverRef === stockJournalReceiver(input.realm),
      "JOURNAL_COMPANY",
      "Correction approval must identify this sandbox company receiver.",
    );
    if (write) {
      check(
        !source.superseded,
        "JOURNAL_SUPERSEDED",
        "A reviewed successor freezes this correction's delivery.",
      );
      const leg = source.state.legs.find((l) => l.leg === input.leg);
      check(
        leg && leg.attemptId === input.attemptId,
        "JOURNAL_ATTEMPT",
        "Use the current independently approved correction attempt.",
      );
      check(
        !leg.current,
        "JOURNAL_OUTCOME",
        "An observed attempt requires reconciliation, not another write.",
      );
      if (input.leg === "replacement") {
        const reversal = source.state.legs.find((l) => l.leg === "reversal");
        const nativeReversal = reversal
          ? this.store.get(
              "SELECT state,external_id FROM integration_stock_journals WHERE org_id=? AND source_id=? AND leg='reversal' AND attempt_id=? AND state<>'rejected'",
              actor.orgId,
              input.sourceId,
              reversal.attemptId ?? "",
            )
          : null;
        check(
          !reversal ||
            (nativeReversal
              ? nativeReversal.state === "posted" &&
                (!reversal.current ||
                  reversal.current.input.outcome === "posted")
              : reversal.current?.input.outcome === "posted"),
          "JOURNAL_REVERSAL_REQUIRED",
          "Retain verified reversal posting before replacement delivery.",
        );
      }
      if (input.attemptId) {
        const retry = leg.retries.find((r) => r.id === input.attemptId);
        check(
          retry?.state === "reviewed",
          "JOURNAL_ATTEMPT",
          "Retry approval is required.",
        );
        // Manual retries can skip native delivery entirely. Resolving only the
        // immediate predecessor would let a later retry overtake an older
        // dispatched/uncertain journal. Every other native attempt for this leg
        // must retain final cancellation (or rejection) before another write.
        check(
          !this.store.get(
            "SELECT id FROM integration_stock_journals WHERE org_id=? AND source_id=? AND leg=? AND attempt_id<>? AND state NOT IN('cancelled','rejected')",
            actor.orgId,
            input.sourceId,
            input.leg,
            input.attemptId,
          ),
          "JOURNAL_PREDECESSOR",
          "Resolve every earlier native delivery before a fresh retry.",
        );
      }
      const policy = this.costs.corrections.deliveryPolicyInTransaction(actor);
      check(
        policy &&
          policy.hash === document.policy.hash &&
          policy.revision === document.policy.revision,
        "JOURNAL_POLICY",
        "Correction delivery requires its current approved policy.",
      );
    }
    return source.file;
  }
  private plan(
    actor: Actor,
    input: JournalDeliveryInput,
    enforceOrder = false,
  ): Plan {
    check(
      input &&
        typeof input === "object" &&
        canonical(Object.keys(input).sort()) ===
          canonical(
            [
              "sourceId",
              "sourceHash",
              "leg",
              "postingDate",
              "attemptId",
              "bindingId",
              "realm",
              "policyRevision",
              "authority",
              "accounts",
              "reason",
            ].sort(),
          ),
      "JOURNAL_INPUT",
      "Delivery fields differ from the supported contract.",
    );
    text(input.sourceId, "Journal source");
    text(input.bindingId, "Organization credential binding");
    text(input.reason, "Delivery review reason", 2000);
    integer(
      input.policyRevision,
      "Policy revision",
      1,
      Number.MAX_SAFE_INTEGER,
    );
    check(
      input.leg === "original" ||
        input.leg === "reversal" ||
        input.leg === "replacement",
      "JOURNAL_INPUT",
      "Invalid journal leg.",
    );
    check(
      input.attemptId === null ||
        (typeof input.attemptId === "string" &&
          input.attemptId.length > 0 &&
          input.attemptId.length <= 160),
      "JOURNAL_ATTEMPT",
      "Invalid attempt identity.",
    );
    this.identity.organizationResidency.assertAllowedInTransaction(
      actor,
      input.authority,
    );
    check(
      input.authority.realm === input.realm,
      "JOURNAL_COMPANY",
      "Permission must match the exact sandbox company.",
    );
    const policy = this.costs.corrections.deliveryPolicyInTransaction(actor);
    check(
      policy && policy.revision === input.policyRevision,
      "JOURNAL_POLICY",
      "Select the current reviewed cost policy.",
    );
    check(
      policy.input.inventoryPostingOwner === "distributor",
      "JOURNAL_POSTING_OWNER",
      "Native stock journals require Distributor to own inventory posting.",
    );
    const file = this.source(actor, input, enforceOrder);
    check(
      file.hash === input.sourceHash,
      "JOURNAL_SOURCE",
      "Select the exact approved source hash.",
    );
    // Supersession and observation checks apply to review as well. Ordering alone
    // is deferred until claim so both legs can be independently reviewed in advance.
    if (!enforceOrder) {
      if (input.leg === "original") {
        const original = this.costs.deliverySourceInTransaction(
          actor,
          input.sourceId,
        );
        check(
          !original.accepted && !original.superseded,
          "JOURNAL_SUPERSEDED",
          "Accepted or corrected originals cannot be delivered.",
        );
      } else {
        const source = this.costs.corrections.deliverySourceInTransaction(
            actor,
            input.sourceId,
          ),
          leg = source.state.legs.find((l) => l.leg === input.leg);
        check(
          !source.superseded,
          "JOURNAL_SUPERSEDED",
          "A reviewed successor freezes this correction's delivery.",
        );
        check(
          leg && leg.attemptId === input.attemptId && !leg.current,
          "JOURNAL_ATTEMPT",
          "Select the current unobserved approved attempt.",
        );
        check(
          source.state.policyHash === policy.hash &&
            source.state.policyRevision === policy.revision,
          "JOURNAL_POLICY",
          "Correction delivery requires its current approved policy.",
        );
      }
    }
    const intent = stockJournalIntent({
      version: 1,
      realmId: input.realm,
      organizationId: actor.orgId,
      source: { bytes: file.bytes, hash: file.hash },
      leg: input.leg,
      postingDate: input.postingDate,
      closedThrough: policy.input.closedThrough,
      accounts: input.accounts,
    });
    const plan: Plan = { input, intent, policyHash: policy.hash };
    if (input.leg === "original" && input.attemptId !== null) {
      const predecessor = this.row(actor, input.attemptId),
        previous = JSON.parse(predecessor.plan) as Plan;
      check(
        canonical(intent) === canonical(previous.intent) &&
          policy.hash === previous.policyHash,
        "JOURNAL_REVIEW_CHANGED",
        "Fresh original attempts preserve the approved source, date, accounts, company and policy. Changed journals require a separate correction.",
      );
      plan.predecessor = this.originalCancelledProof(actor, predecessor).stamp;
    }
    return plan;
  }
  preparationReview(
    actor: Actor,
    sourceId: string,
    selection: { leg: JournalDeliveryInput["leg"]; postingDate?: string },
  ) {
    return this.database.transaction(() => {
      actor = this.principal(actor);
      this.platform.assertProviderAccess();
      text(sourceId, "Journal source", 160);
      check(
        selection &&
          typeof selection === "object" &&
          Object.keys(selection).every((key) =>
            ["leg", "postingDate"].includes(key),
          ) &&
          ["original", "reversal", "replacement"].includes(selection.leg) &&
          (selection.postingDate === undefined ||
            typeof selection.postingDate === "string"),
        "JOURNAL_INPUT",
        "Select a supported source leg and date.",
      );
      const authority =
          this.identity.organizationResidency.currentPermissionInTransaction(
            actor,
          ),
        policy = this.costs.corrections.deliveryPolicyInTransaction(actor);
      check(policy, "JOURNAL_POLICY", "Select a current reviewed cost policy.");
      const correction =
          selection.leg === "original"
            ? null
            : this.costs.corrections.deliverySourceInTransaction(
                actor,
                sourceId,
              ),
        file =
          correction?.file ??
          this.costs.deliverySourceInTransaction(actor, sourceId).file,
        document = JSON.parse(file.bytes),
        journal: JournalLine[] =
          selection.leg === "original"
            ? document.report.journal
            : document[selection.leg];
      check(
        Array.isArray(journal) && journal.length > 0 && journal.length <= 20000,
        "JOURNAL_SOURCE",
        "Select a nonempty approved journal leg.",
      );
      const dates = [...new Set(journal.map((line) => line.date))].sort(),
        postingDate =
          selection.postingDate ??
          dates.find(
            (date) =>
              policy.input.closedThrough === null ||
              date > policy.input.closedThrough,
          ) ??
          dates[0]!,
        lines = journal.filter((line) => line.date === postingDate),
        sourceAccounts = [...new Set(lines.map((line) => line.account))].sort();
      check(
        sourceAccounts.length <= 30,
        "JOURNAL_INPUT",
        "Browser preparation supports at most 30 source accounts per date.",
      );
      const attemptId =
        correction?.state.legs.find((leg) => leg.leg === selection.leg)
          ?.attemptId ?? null;
      // Temporary identities validate the immutable source and current native
      // authority only. This read creates no journal, command, lease or binding.
      this.plan(actor, {
        sourceId,
        sourceHash: file.hash,
        leg: selection.leg,
        postingDate,
        attemptId,
        bindingId: "read-only-source-review",
        realm: authority.realm,
        policyRevision: policy.revision,
        authority,
        accounts: sourceAccounts.map((sourceAccount, index) => ({
          sourceAccount,
          accountId: String(index + 1),
        })),
        reason: "Read-only approved source review",
      });
      return {
        sourceId,
        sourceHash: file.hash,
        leg: selection.leg,
        postingDate,
        attemptId,
        authority,
        policyRevision: policy.revision,
        policyHash: policy.hash,
        closedThrough: policy.input.closedThrough,
        establishedValuation: policy.input.establishedValuation,
        approvedBy: String(document.reviewedBy),
        approvedAt: String(document.reviewedAt),
        region: authority.region,
        currency: String(document.currency),
        dates,
        lines,
        sourceAccounts,
      };
    });
  }
  preparationReceipt(actor: Actor, key: string) {
    return this.database.transaction(() => {
      actor = this.principal(actor);
      const retained = this.platform.journalPreparationReceiptInTransaction(
          actor,
          key,
        ),
        receipt = retained.result as ReturnType<
          StockJournalDelivery["prepare"]
        >;
      check(
        receipt &&
          typeof receipt.id === "string" &&
          receipt.plan &&
          digest(canonical(receipt.plan.input)) === retained.requestHash &&
          receipt.createdBy === actor.id &&
          receipt.state === "ready",
        "JOURNAL_INTEGRITY",
        "Preparation receipt differs from its original command.",
      );
      const current = this.view(this.row(actor, receipt.id));
      check(
        canonical(receipt.plan) === canonical(current.plan) &&
          receipt.reviewHash === current.reviewHash &&
          receipt.createdAt === current.createdAt &&
          receipt.requestRef === current.requestRef &&
          canonical({
            ...current,
            state: "ready",
            externalId: null,
            decisionBy: null,
            decisionAt: null,
            decisionReason: null,
            leaseStarted: null,
            leaseMode: null,
            dispatched: false,
          }) === canonical(receipt),
        "JOURNAL_INTEGRITY",
        "Preparation receipt differs from the retained native journal.",
      );
      return { receipt, currentState: current.state };
    });
  }
  prepare(actor: Actor, key: string, raw: JournalDeliveryInput) {
    const input = structuredClone(raw);
    return this.platform.command(
      actor,
      "accounting.journal.prepare",
      key,
      input,
      () => {
        actor = this.principal(actor);
        this.platform.assertProviderAccess();
        check(
          input.leg !== "original" || input.attemptId === null,
          "JOURNAL_ATTEMPT",
          "Use separately reviewed original retry preparation.",
        );
        this.plan(actor, input);
      },
      () => {
        const plan = this.plan(actor, input),
          journalId = id();
        check(
          !this.store.get(
            "SELECT id FROM integration_stock_journals WHERE org_id=? AND source_id=? AND leg=? AND posting_date=? AND attempt_id=? AND state<>'rejected'",
            actor.orgId,
            input.sourceId,
            input.leg,
            input.postingDate,
            input.attemptId ?? "",
          ),
          "JOURNAL_DUPLICATE",
          "This exact source/date/attempt already has a retained delivery.",
        );
        this.store.run(
          "INSERT INTO integration_stock_journals(id,org_id,realm,binding_id,source_id,leg,posting_date,attempt_id,plan,review_hash,state,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
          journalId,
          actor.orgId,
          input.realm,
          input.bindingId,
          input.sourceId,
          input.leg,
          input.postingDate,
          input.attemptId ?? "",
          canonical(plan),
          digest(canonical(plan)),
          "ready",
          actor.id,
          now(),
        );
        return this.view(this.row(actor, journalId));
      },
    );
  }
  decide(
    actor: Actor,
    key: string,
    input: {
      journalId: string;
      reviewHash: string;
      decision: "approve" | "reject";
      reason: string;
    },
  ) {
    return this.platform.command(
      actor,
      "accounting.journal.decide",
      key,
      input,
      () => {
        actor = this.principal(actor);
        this.platform.assertProviderAccess();
        this.row(actor, input.journalId);
      },
      () => {
        const row = this.row(actor, input.journalId),
          reason = text(input.reason, "Delivery decision reason", 2000);
        check(
          input.decision === "approve" || input.decision === "reject",
          "JOURNAL_INPUT",
          "Invalid delivery decision.",
        );
        check(
          row.review_hash === input.reviewHash,
          "JOURNAL_REVIEW_CHANGED",
          "Review the exact frozen delivery.",
        );
        check(
          row.state === "ready",
          "JOURNAL_DECISION",
          "Delivery already has a retained decision.",
        );
        check(
          row.created_by !== actor.id,
          "JOURNAL_SEPARATE_REVIEW",
          "A different current finance principal must approve or reject this delivery.",
          403,
        );
        if (input.decision === "approve") {
          const plan = this.plan(actor, (JSON.parse(row.plan) as Plan).input);
          check(
            digest(canonical(plan)) === row.review_hash,
            "JOURNAL_REVIEW_CHANGED",
            "Source, company permission or current policy changed after preparation.",
          );
          const reference = requestRef(row.id);
          this.costs.corrections.assertReferenceAvailable(
            actor,
            stockJournalReceiver(row.realm),
            reference,
          );
          check(
            !this.store.get(
              "SELECT packet_id FROM integration_cost_receipts WHERE org_id=? AND receiver_ref=? AND external_ref=?",
              actor.orgId,
              stockJournalReceiver(row.realm),
              reference,
            ),
            "JOURNAL_REFERENCE",
            "Receiver reference is already reserved by a cost handoff.",
          );
          this.store.run(
            "INSERT INTO integration_stock_journal_references VALUES(?,?,?,?)",
            actor.orgId,
            row.realm,
            reference,
            row.id,
          );
        }
        this.store.run(
          "UPDATE integration_stock_journals SET state=?,decision_by=?,decision_at=?,decision_reason=? WHERE org_id=? AND id=?",
          input.decision === "approve" ? "pending" : "rejected",
          actor.id,
          now(),
          reason,
          actor.orgId,
          row.id,
        );
        return this.view(this.row(actor, row.id));
      },
    );
  }
  detail(actor: Actor, journalId: string) {
    return this.database.transaction(() => {
      actor = this.principal(actor);
      const row = this.row(actor, journalId);
      const history = this.store.all(
        "SELECT * FROM integration_stock_journal_observations WHERE org_id=? AND journal_id=? ORDER BY revision DESC LIMIT 101",
        actor.orgId,
        journalId,
      );
      return {
        ...this.view(row),
        observations: history
          .slice(0, 100)
          .map((r) => this.observation(actor, journalId, r)),
        olderObservations: history.length > 100,
      };
    });
  }
  private observation(actor: Actor, journalId: string, r: Row) {
    const body = JSON.parse(String(r.body)),
      revision = Number(r.revision),
      recordedBy = String(r.recorded_by),
      recordedAt = String(r.recorded_at);
    check(
      digest(
        canonical({
          journalId,
          orgId: actor.orgId,
          revision,
          body,
          recordedBy,
          recordedAt,
        }),
      ) === r.hash,
      "JOURNAL_INTEGRITY",
      "Journal observation failed integrity.",
    );
    return { revision, hash: String(r.hash), body, recordedBy, recordedAt };
  }
  /** Read-only restored UNKNOWN original; no external evidence or authority.
   * All mutable state is refreshed in the caller's actual existing writer. */
  readOfflineOriginalInTransaction(actor: Actor, journalId: string) {
    return this.readOfflineOriginalFactsInTransaction(
      actor,
      journalId,
      "unknown",
    );
  }
  // Fixed shared validator only; the public UNKNOWN reader keeps its original
  // purpose, fields, hash and refusals. No caller can choose this state profile.
  private readOfflineOriginalFactsInTransaction(
    actor: Actor,
    journalId: string,
    state: "unknown" | "cancelled",
  ) {
    this.database.requireTransaction();
    offlineOriginalId(journalId);
    actor = this.principal(offlineOriginalActor(actor));
    const unchanged = this.store.get("SELECT total_changes() AS n")!.n;
    const hold = this.platform.rawRecoveryHoldInTransaction();
    check(hold, "RECOVERY_HOLD", "A raw restored-store hold is required.");
    let totalRows = 0,
      totalBytes = 0;
    // These source tables are Integration-owned. Preflight the complete sets
    // before calling the actual IntegrationCosts source/policy readers. Never
    // query Inventory/Identity/Platform tables through this store.
    for (const [table, list] of Object.entries(offlineOriginalColumns)) {
      const n = Number(
        this.store.get(
          `SELECT COUNT(*) AS n FROM (SELECT 1 FROM ${table} LIMIT ?)`,
          offlineOriginalProfile.rowsPerTable + 1,
        )!.n,
      );
      offlineOriginalBound(
        n <= offlineOriginalProfile.rowsPerTable &&
          (totalRows += n) <= offlineOriginalProfile.totalRows,
      );
      const fields = list.split(" "),
        sizes = fields.map((c) => `COALESCE(length(CAST(${c} AS BLOB)),0)`),
        sum = sizes.join("+");
      const integers = ["revision", "sequence", "lease_started", "dispatched"];
      const nullable = [
        "decision_by",
        "decision_at",
        "decision_reason",
        "lease_id",
        "lease_actor",
        "lease_started",
        "lease_mode",
        "external_id",
        "artifact",
        "content_hash",
        "receipt",
      ];
      const stats = this.store.get<{
        field: number;
        row: number;
        total: number;
        bad: number;
      }>(
        `SELECT COALESCE(MAX(MAX(${sizes.join(",")})),0) AS field,COALESCE(MAX(${sum}),0) AS row,COALESCE(SUM(${sum}),0) AS total,
         COALESCE(SUM(CASE WHEN ${fields.map((c) => `(typeof(${c}) NOT IN ('${integers.includes(c) ? "integer" : "text"}'${nullable.includes(c) ? ",'null'" : ""}) OR instr(CAST(${c} AS BLOB),x'00')>0)`).join(" OR ")} THEN 1 ELSE 0 END),0) AS bad FROM ${table}`,
      )!;
      offlineOriginalBound(
        [stats.field, stats.row, stats.total].every(
          (x) => Number.isSafeInteger(x) && x >= 0,
        ) &&
          stats.field <= offlineOriginalProfile.fieldBytes &&
          stats.row <= offlineOriginalProfile.rowBytes &&
          stats.total <= offlineOriginalProfile.totalBytes - totalBytes,
      );
      offlineOriginalCheck(stats.bad === 0);
      totalBytes += stats.total;
    }
    // Scalar-only SQL: json_tree would violate native owner table isolation.
    // Count punctuation conservatively (including inside strings) BEFORE JSON
    // validity or any JavaScript parse. Container count is also a depth bound.
    const documents = `SELECT plan AS raw FROM integration_stock_journals UNION ALL SELECT body FROM integration_stock_journal_observations UNION ALL SELECT input FROM integration_cost_packets UNION ALL SELECT report FROM integration_cost_packets UNION ALL SELECT artifact FROM integration_cost_packets WHERE artifact IS NOT NULL UNION ALL SELECT receipt FROM integration_cost_packets WHERE receipt IS NOT NULL UNION ALL SELECT input FROM integration_cost_policies`;
    const complexity = this.store.get<{ nodes: number; containers: number }>(
      `WITH docs AS (${documents}) SELECT COALESCE(MAX(1+length(raw)-length(replace(replace(replace(replace(raw,',',''),':',''),'[',''),'{',''))),0) AS nodes, COALESCE(MAX(length(raw)-length(replace(replace(raw,'[',''),'{',''))),0) AS containers FROM docs`,
    )!;
    offlineOriginalBound(
      complexity.nodes <= offlineOriginalProfile.jsonNodes &&
        complexity.containers <= offlineOriginalProfile.jsonContainers,
    );
    offlineOriginalCheck(
      this.store.get(
        `WITH docs AS (${documents}) SELECT COUNT(*) AS n FROM docs WHERE NOT json_valid(raw)`,
      )!.n === 0,
    );
    // Source bytes are JSON nested inside a JSON string. Escaped brackets in
    // that string are invisible to the outer lexical complexity preflight.
    // Decode only in SQLite, then preflight the decoded bytes before checkedRow
    // or the protocol validator can materialize/parse that inner document.
    const embedded = this.store.get<{
      bytes: number;
      nodes: number;
      containers: number;
      bad: number;
    }>(`WITH docs AS (SELECT json_extract(plan,'$.intent.source.bytes') AS raw,json_type(plan,'$.intent.source.bytes') AS kind FROM integration_stock_journals)
      SELECT COALESCE(MAX(length(CAST(raw AS BLOB))),0) AS bytes,
      COALESCE(MAX(1+length(raw)-length(replace(replace(replace(replace(raw,',',''),':',''),'[',''),'{',''))),0) AS nodes,
      COALESCE(MAX(length(raw)-length(replace(replace(raw,'[',''),'{',''))),0) AS containers,
      COALESCE(SUM(CASE WHEN kind IS NULL OR kind<>'text' THEN 1 ELSE 0 END),0) AS bad FROM docs`)!;
    offlineOriginalBound(
      embedded.bytes <= offlineOriginalProfile.fieldBytes &&
        embedded.nodes <= offlineOriginalProfile.jsonNodes &&
        embedded.containers <= offlineOriginalProfile.jsonContainers,
    );
    offlineOriginalCheck(embedded.bad === 0);
    // Existence-only checks cover contradictory org copies and orphan history.
    // Complete global sets were preflighted; no foreign tenant row is returned.
    offlineOriginalCheck(
      this.store.get(
        `SELECT COUNT(*) AS n FROM integration_stock_journal_observations o LEFT JOIN integration_stock_journals j ON j.id=o.journal_id WHERE j.id IS NULL OR o.org_id<>j.org_id`,
      )!.n === 0,
    );
    offlineOriginalCheck(
      this.store.get(
        `SELECT COUNT(*) AS n FROM integration_stock_journal_references r LEFT JOIN integration_stock_journals j ON j.id=r.journal_id WHERE j.id IS NULL OR r.org_id<>j.org_id OR r.realm<>j.realm`,
      )!.n === 0,
    );
    offlineOriginalCheck(
      this.store.get(
        `SELECT COUNT(*) AS n FROM integration_stock_journals j LEFT JOIN integration_cost_packets p ON p.id=j.source_id WHERE j.leg='original' AND (p.id IS NULL OR p.org_id<>j.org_id)`,
      )!.n === 0,
    );
    const raw = this.store.get<Journal>(
      `SELECT ${offlineOriginalColumns.integration_stock_journals.split(" ").join(",")} FROM integration_stock_journals WHERE org_id=? AND id=?`,
      actor.orgId,
      journalId,
    );
    offlineOriginalCheck(raw && raw.leg === "original" && raw.state === state);
    offlineOriginalCheck(
      this.store.get(
        `SELECT COUNT(*) AS n FROM integration_cost_sources s LEFT JOIN integration_cost_packets p ON p.id=s.packet_id WHERE p.id IS NULL OR s.org_id<>p.org_id`,
      )!.n === 0,
    );
    offlineOriginalCheck(
      this.store.get(
        `SELECT COUNT(*) AS n FROM integration_cost_corrections WHERE original_id=? AND org_id<>?`,
        raw.source_id,
        actor.orgId,
      )!.n === 0,
    );
    offlineOriginalCheck(
      this.store.get(
        `SELECT COUNT(*) AS n FROM integration_cost_receipts WHERE packet_id=?`,
        raw.source_id,
      )!.n === 0,
    );
    const source = this.costs.deliverySourceInTransaction(actor, raw.source_id);
    offlineOriginalCheck(!source.accepted && !source.superseded);
    const packet = this.store.get(
      `SELECT ${offlineOriginalColumns.integration_cost_packets.split(" ").join(",")} FROM integration_cost_packets WHERE org_id=? AND id=?`,
      actor.orgId,
      raw.source_id,
    )!;
    const organization = this.identity.organization(actor),
      document = JSON.parse(source.file.bytes);
    offlineOriginalCheck(
      document.region === organization.region &&
        document.currency === organization.currency &&
        Array.isArray(document.report.journal) &&
        document.report.journal.length > 0 &&
        document.report.journal.length <= 1000,
    );
    const totals = new Map<string, { debit: bigint; credit: bigint }>();
    for (const line of document.report.journal as JournalLine[]) {
      offlineOriginalCheck(
        typeof line.date === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(line.date) &&
          Number.isFinite(Date.parse(line.date)) &&
          new Date(line.date).toISOString().slice(0, 10) === line.date &&
          Number.isSafeInteger(line.debit) &&
          Number.isSafeInteger(line.credit) &&
          ((line.debit > 0 && line.credit === 0) ||
            (line.credit > 0 && line.debit === 0)),
      );
      const t = totals.get(line.date) ?? { debit: 0n, credit: 0n };
      t.debit += BigInt(line.debit);
      t.credit += BigInt(line.credit);
      totals.set(line.date, t);
    }
    const dates = [...totals]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([postingDate, t]) => {
        offlineOriginalCheck(
          t.debit > 0n &&
            t.debit === t.credit &&
            t.debit <= BigInt(Number.MAX_SAFE_INTEGER),
        );
        return {
          postingDate,
          debit: Number(t.debit),
          credit: Number(t.credit),
        };
      });
    const total = dates.reduce((n, d) => n + BigInt(d.debit), 0n);
    offlineOriginalCheck(
      total <= BigInt(Number.MAX_SAFE_INTEGER) &&
        Number(total) === document.report.debit &&
        Number(total) === document.report.credit,
    );
    const rows = this.store.all<Journal>(
      `SELECT ${offlineOriginalColumns.integration_stock_journals.split(" ").join(",")} FROM integration_stock_journals WHERE org_id=? AND source_id=? ORDER BY posting_date,id`,
      actor.orgId,
      raw.source_id,
    );
    offlineOriginalCheck(rows.every((r) => r.leg === "original"));
    const currentPolicy =
      this.costs.corrections.deliveryPolicyInTransaction(actor);
    offlineOriginalCheck(
      currentPolicy &&
        currentPolicy.input.inventoryPostingOwner === "distributor",
    );
    const attempts = rows.map((row) => {
      this.checkedRow(row);
      const plan = JSON.parse(row.plan) as Plan,
        lineage = this.originalLineage(actor, row),
        date = dates.find((d) => d.postingDate === row.posting_date);
      offlineOriginalCheck(
        date &&
          plan.intent.source.bytes === source.file.bytes &&
          plan.intent.source.hash === source.file.hash &&
          row.realm === raw.realm &&
          row.binding_id === raw.binding_id &&
          plan.policyHash === currentPolicy.hash &&
          plan.input.policyRevision === currentPolicy.revision &&
          (!currentPolicy.input.closedThrough ||
            row.posting_date > currentPolicy.input.closedThrough),
      );
      offlineOriginalCheck(
        plan.input.authority.orgId === actor.orgId &&
          plan.input.authority.region === organization.region &&
          plan.input.authority.realm === row.realm,
      );
      const history = this.store.all(
        `SELECT ${offlineOriginalColumns.integration_stock_journal_observations.split(" ").join(",")} FROM integration_stock_journal_observations WHERE journal_id=? ORDER BY revision`,
        row.id,
      );
      const observations = history.map((r) =>
        this.observation(actor, row.id, r),
      );
      offlineOriginalCheck(observations.every((o, i) => o.revision === i + 1));
      const outcomeLeases = new Set<string>();
      for (const [index, observation] of observations.entries()) {
        const body = observation.body;
        offlineOriginalCheck(
          body && typeof body === "object" && !Array.isArray(body),
        );
        if (body.outcome === "unknown") {
          const expired = ["expired-lease", "clock-rollback"].includes(
            body.cause,
          );
          offlineOriginalCheck(
            canonical(Object.keys(body).sort()) ===
              canonical(
                (expired
                  ? ["outcome", "cause", "leaseId"]
                  : ["outcome", "cause", "leaseId", "requestRef"]
                ).sort(),
              ) &&
              [
                "lookup-miss",
                "transport-uncertain",
                "authority-changed",
                "expired-lease",
                "clock-rollback",
              ].includes(body.cause) &&
              typeof body.leaseId === "string" &&
              body.leaseId.length > 0 &&
              body.leaseId.length <= 160 &&
              !outcomeLeases.has(body.leaseId) &&
              (expired || body.requestRef === requestRef(row.id)),
          );
          outcomeLeases.add(body.leaseId);
        } else if (
          body.kind === "permission-replacement.review" ||
          body.kind === "permission-replacement.decision"
        ) {
          // Exact contents/independent decisions are reduced below by the owner.
        } else if (body.kind === "original-cancellation-evidence") {
          this.originalCancellationEvidence(actor, row, observation.hash);
        } else if (body.outcome === "cancelled-unposted") {
          offlineOriginalCheck(
            row.state === "cancelled" && index === observations.length - 1,
          );
        } else offlineOriginalCheck(false);
      }
      const permission = journalPermissions(
        row.id,
        row.review_hash,
        plan.input.authority,
        observations,
      );
      // Validate the initial authority with the same strict permission grammar,
      // without asserting that a historical permission remains current authority.
      permissionInput({
        journalId: row.id,
        reviewHash: row.review_hash,
        previousPermissionHash: digest(canonical(plan.input.authority)),
        authority: plan.input.authority,
        mode: "lookup",
        reason: "Native offline permission shape",
      });
      offlineOriginalCheck(
        this.store.get(
          `SELECT COUNT(*) AS n FROM integration_stock_journal_references WHERE realm=? AND request_ref=? AND journal_id<>?`,
          row.realm,
          requestRef(row.id),
          row.id,
        )!.n === 0,
      );
      const references = this.store.all(
        `SELECT ${offlineOriginalColumns.integration_stock_journal_references.split(" ").join(",")} FROM integration_stock_journal_references WHERE journal_id=? ORDER BY request_ref`,
        row.id,
      );
      if (row.state === "ready" || row.state === "rejected")
        offlineOriginalCheck(
          references.length === 0 &&
            history.length === 0 &&
            row.external_id === null &&
            row.lease_id === null &&
            row.lease_actor === null &&
            row.lease_started === null &&
            row.lease_mode === null &&
            row.dispatched === 0,
        );
      else
        offlineOriginalCheck(
          references.length === 1 &&
            references[0]!.request_ref === requestRef(row.id) &&
            row.decision_by &&
            row.decision_by !== row.created_by &&
            row.decision_at &&
            row.decision_reason,
        );
      // This first subtype supports unresolved leaf + final cancelled ancestors.
      // Other dates may remain ready/pending; posted/running competing histories
      // conservatively require a separately designed complete projection.
      offlineOriginalCheck(
        ["ready", "rejected", "pending", "unknown", "cancelled"].includes(
          row.state,
        ),
      );
      offlineOriginalCheck(
        row.external_id === null &&
          row.lease_id === null &&
          row.lease_actor === null &&
          row.lease_started === null &&
          row.lease_mode === null,
      );
      if (row.state === "unknown") this.originalCancellationFacts(actor, row);
      if (row.state === "cancelled") this.originalCancelledProof(actor, row);
      if (row.state === "pending")
        offlineOriginalCheck(history.length === 0 && row.dispatched === 0);
      return {
        row: { ...row },
        plan,
        lineage,
        history,
        observations,
        references,
        permission: {
          authority: permission.authority,
          mode: permission.mode,
          reviews: [...permission.reviews.values()],
        },
      };
    });
    const active = rows.filter((r) => r.state !== "rejected");
    for (const date of dates) {
      const same = active.filter((r) => r.posting_date === date.postingDate);
      const leaves = same.filter(
        (r) => !same.some((x) => x.attempt_id === r.id),
      );
      offlineOriginalCheck(leaves.length <= 1);
      for (const predecessor of same.filter((r) =>
        same.some((x) => x.attempt_id === r.id),
      ))
        offlineOriginalCheck(predecessor.state === "cancelled");
      if (date.postingDate === raw.posting_date)
        offlineOriginalCheck(
          leaves.length === 1 && leaves[0]!.id === journalId,
        );
    }
    const sourceReservations = this.store.all(
      `SELECT org_id,movement_id,packet_id FROM integration_cost_sources WHERE packet_id=? ORDER BY movement_id`,
      raw.source_id,
    );
    const sourceMovements = [
      ...new Set(
        (document.report.journal as JournalLine[]).map((l) => l.movementId),
      ),
    ].sort();
    offlineOriginalCheck(
      canonical(sourceReservations.map((r) => r.movement_id).sort()) ===
        canonical(sourceMovements),
    );
    const policies = this.store.all(
      `SELECT ${offlineOriginalColumns.integration_cost_policies.split(" ").join(",")} FROM integration_cost_policies WHERE org_id=? ORDER BY revision`,
      actor.orgId,
    );
    const facts = {
      version: 1 as const,
      sourceReservations,
      policies,
      purpose: "distributor-stock-journal-offline-original-review-v1" as const,
      profile: offlineOriginalProfile,
      orgId: actor.orgId,
      region: organization.region,
      currency: organization.currency,
      journalId,
      hold,
      source,
      packet,
      currentPolicy,
      dates,
      debit: Number(total),
      credit: Number(total),
      attempts,
      blockers: [
        "EXTERNAL_POSTING_TRUTH_UNVERIFIED",
        "SOURCE_COMPLETENESS_UNQUALIFIED",
        "CURRENT_EXTERNAL_AUTHORITY_REQUIRED",
        "RECOVERY_HOLD_RETAINED",
      ] as const,
    };
    offlineOriginalCheck(
      this.store.get("SELECT total_changes() AS n")!.n === unchanged,
    );
    const encoded = canonical(facts);
    offlineOriginalBound(
      Buffer.byteLength(encoded) <= offlineOriginalProfile.totalBytes,
    );
    return offlineOriginalFreeze(
      structuredClone({ ...facts, hash: digest(encoded) }),
    );
  }
  /** Trusted internal owner write only. Caller must qualify evidence/authority
   * and fence through COMMIT, and propagate EVERY error through its outer writer.
   * Process-issued comparison identity is not that qualification or a grant. */
  applyOfflineOriginalCancellationInTransaction(
    evidenceActorInput: Actor,
    cancellationActorInput: Actor,
    captured: CapturedOfflineOriginalEvidence,
    reason: string,
  ): OfflineOriginalCancellationProof {
    // Identity check precedes native hooks and any input field traversal.
    assertCapturedOfflineOriginalEvidence(captured);
    const evidenceLocator = offlineCancellationActor(evidenceActorInput),
      cancellationLocator = offlineCancellationActor(cancellationActorInput);
    check(
      !types.isProxy(reason) &&
        typeof reason === "string" &&
        reason.length > 0 &&
        reason.trim() === reason &&
        Buffer.byteLength(reason) <= 2000 &&
        !reason.includes("\0") &&
        Buffer.from(reason).toString() === reason,
      "OFFLINE_ORIGINAL_APPLICATION",
      "Use an exact bounded independent cancellation reason.",
    );
    this.database.requireTransaction();
    const evidenceActor = this.principal(evidenceLocator),
      cancellationActor = this.principal(cancellationLocator);
    check(
      evidenceActor.orgId === cancellationActor.orgId &&
        evidenceActor.id !== cancellationActor.id,
      "JOURNAL_CANCELLATION",
      "Two distinct current organization finance principals are required.",
    );
    const fresh = new StockJournalOfflineOriginalEvidence(
      this.database,
      this.identity,
      this,
    ).captureInTransaction(evidenceActor, captured.native.journalId, {
      version: 1,
      source: captured.native,
      candidate: captured.native,
      providerClaims: [captured.claim],
    });
    check(
      canonical(fresh) === canonical(captured),
      "JOURNAL_REVIEW_CHANGED",
      "Recapture the exact complete original assertions before applying them.",
    );
    const journalId = fresh.native.journalId;
    this.offlineOriginalNoDescendants(journalId);
    // The actual native reader preflighted the complete sets immediately above.
    // Leave two observation slots; the post-write proof also preflights all bytes.
    offlineOriginalBound(
      Number(
        this.store.get(
          "SELECT COUNT(*) AS n FROM integration_stock_journal_observations",
        )!.n,
      ) +
        2 <=
        offlineOriginalProfile.rowsPerTable,
    );
    const row = this.row(evidenceActor, journalId),
      input = structuredClone(fresh.claim.attestation),
      snapshot = this.originalCancellationSnapshot(evidenceActor, row);
    offlineOriginalCheck(
      canonical(snapshot) === canonical(fresh.cancellationSnapshot),
    );
    originalCancellationEvidenceInput(input);
    // Same bodies/owner audit path as ordinary record/cancel, no Platform.command.
    const evidenceObservation = this.observe(evidenceActor, row, {
      kind: "original-cancellation-evidence",
      input,
      snapshot,
    });
    const evidence = this.originalCancellationEvidence(evidenceActor, row);
    // Refresh after the first audit; exceptions must roll back that observation too.
    this.principal(evidenceLocator);
    this.principal(cancellationLocator);
    offlineOriginalCheck(
      canonical(this.platform.rawRecoveryHoldInTransaction()) ===
        canonical(fresh.native.hold),
    );
    const cancellation = this.observe(cancellationActor, row, {
      outcome: "cancelled-unposted",
      evidenceHash: evidence.evidenceHash,
      reason,
      requestRef: input.requestRef,
    });
    // Exact same native clear fields, with a state/review CAS for this new writer.
    const changed = this.store.run(
      "UPDATE integration_stock_journals SET state='cancelled',lease_id=NULL,lease_actor=NULL,lease_started=NULL,lease_mode=NULL,external_id=NULL WHERE org_id=? AND id=? AND state='unknown' AND review_hash=? AND external_id IS NULL AND lease_id IS NULL AND lease_actor IS NULL AND lease_started IS NULL AND lease_mode IS NULL",
      row.org_id,
      row.id,
      row.review_hash,
    );
    offlineOriginalCheck(changed.changes === 1);
    this.principal(evidenceLocator);
    const proof = this.readOfflineOriginalCancellationInTransaction(
      cancellationLocator,
      journalId,
      evidence.evidenceHash,
      cancellation.hash,
    );
    const {
      hash: _beforeHash,
      purpose: _beforePurpose,
      ...expected
    } = structuredClone(fresh.native);
    const target = expected.attempts.find((a) => a.row.id === journalId)!;
    // structuredClone detaches the frozen capture; only these native differences
    // are admitted. Any audit/trigger corruption elsewhere refuses the writer.
    const mutable = target as unknown as {
      row: Journal;
      history: Row[];
      observations: ReturnType<StockJournalDelivery["observe"]>[];
    };
    mutable.row.state = "cancelled";
    for (const o of [evidenceObservation, cancellation]) {
      mutable.observations.push(o);
      mutable.history.push({
        journal_id: journalId,
        org_id: row.org_id,
        revision: o.revision,
        body: canonical(o.body),
        hash: o.hash,
        recorded_by: o.recordedBy,
        recorded_at: o.recordedAt,
      });
    }
    const {
      hash: _afterHash,
      purpose: _afterPurpose,
      proof: _proof,
      ...actual
    } = proof;
    offlineOriginalCheck(canonical(actual) === canonical(expected));
    return proof;
  }
  private offlineOriginalNoDescendants(journalId: string) {
    // Existence only, across all scopes, after complete owning SQL preflight.
    offlineOriginalCheck(
      this.store.get(
        "SELECT COUNT(*) AS n FROM integration_stock_journals WHERE attempt_id=?",
        journalId,
      )!.n === 0,
    );
  }
  /** Exact retained native outcome, not an offline provenance/authority receipt.
   * Both hashes must come from the caller's separately durable root provenance. */
  readOfflineOriginalCancellationInTransaction(
    actor: Actor,
    journalId: string,
    evidenceHash: string,
    cancellationHash: string,
  ): OfflineOriginalCancellationProof {
    offlineOriginalId(journalId);
    offlineCancellationHash(evidenceHash);
    offlineCancellationHash(cancellationHash);
    actor = offlineCancellationActor(actor);
    this.database.requireTransaction();
    actor = this.principal(actor);
    const before = this.store.get("SELECT total_changes() AS n")!.n;
    const {
      hash: _internalHash,
      purpose: _internalPurpose,
      ...native
    } = this.readOfflineOriginalFactsInTransaction(
      actor,
      journalId,
      "cancelled",
    );
    this.offlineOriginalNoDescendants(journalId);
    const proof = this.originalCancelledProof(
      actor,
      this.row(actor, journalId),
    );
    offlineOriginalCheck(
      proof.evidence.evidenceHash === evidenceHash &&
        proof.cancellation.hash === cancellationHash,
    );
    const facts = {
      ...native,
      purpose:
        "distributor-stock-journal-offline-original-cancellation-v1" as const,
      proof,
    };
    const encoded = canonical(facts);
    offlineOriginalBound(
      Buffer.byteLength(encoded) + 75 <= offlineOriginalProfile.totalBytes,
    );
    offlineOriginalCheck(
      this.store.get("SELECT total_changes() AS n")!.n === before,
    );
    return offlineOriginalFreeze(
      structuredClone({ ...facts, hash: digest(encoded) }),
    );
  }

  originalReconciliationInTransaction(actor: Actor, packetId: string) {
    this.database.requireTransaction();
    actor = this.principal(actor);
    const source = this.costs.deliverySourceInTransaction(actor, packetId),
      document = JSON.parse(source.file.bytes),
      organization = this.identity.organization(actor),
      grouped = new Map<string, { debit: bigint; credit: bigint }>();
    check(
      document.region === organization.region &&
        document.currency === organization.currency &&
        Array.isArray(document.report.journal) &&
        document.report.journal.length > 0 &&
        document.report.journal.length <= 1000,
      "COST_INTEGRITY",
      "Use the complete original regional stock journal.",
    );
    for (const line of document.report.journal as JournalLine[]) {
      check(
        typeof line.date === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(line.date) &&
          Number.isFinite(Date.parse(line.date)) &&
          new Date(line.date).toISOString().slice(0, 10) === line.date &&
          Number.isSafeInteger(line.debit) &&
          line.debit >= 0 &&
          Number.isSafeInteger(line.credit) &&
          line.credit >= 0 &&
          ((line.debit > 0 && line.credit === 0) ||
            (line.credit > 0 && line.debit === 0)),
        "COST_INTEGRITY",
        "Original journal dates and amounts must be exact.",
      );
      const totals = grouped.get(line.date) ?? { debit: 0n, credit: 0n };
      totals.debit += BigInt(line.debit);
      totals.credit += BigInt(line.credit);
      grouped.set(line.date, totals);
    }
    const dates: JournalReconciliationDate[] = [...grouped]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([postingDate, totals]) => {
        check(
          totals.debit === totals.credit &&
            totals.debit > 0n &&
            totals.debit <= BigInt(Number.MAX_SAFE_INTEGER),
          "COST_INTEGRITY",
          "Every original posting date must balance exactly.",
        );
        return {
          postingDate,
          debit: Number(totals.debit),
          credit: Number(totals.credit),
          journal: null,
        };
      });
    const rows = this.store.all<Journal>(
      "SELECT * FROM integration_stock_journals WHERE org_id=? AND source_id=? AND leg='original' AND state<>'rejected' ORDER BY posting_date,id",
      actor.orgId,
      packetId,
    );
    const issues: { code: string; message: string }[] = [];
    for (const raw of rows) {
      const row = this.checkedRow(raw),
        plan = JSON.parse(row.plan) as Plan,
        date = dates.find((d) => d.postingDate === row.posting_date);
      const lineage = this.originalLineage(actor, row);
      check(
        date &&
          plan.intent.source.hash === source.file.hash &&
          plan.intent.source.bytes === source.file.bytes,
        "JOURNAL_INTEGRITY",
        "Every native original must identify one unchanged source date.",
      );
      // Retained cancelled predecessors are verified but never counted as an
      // additional posting date. The one terminal chain leaf supplies evidence.
      if (rows.some((candidate) => candidate.attempt_id === row.id)) {
        this.originalCancelledProof(actor, row);
        continue;
      }
      check(
        !date.journal,
        "JOURNAL_INTEGRITY",
        "Each original date must have one complete attempt chain.",
      );
      const history = this.store
        .all(
          "SELECT * FROM integration_stock_journal_observations WHERE org_id=? AND journal_id=? ORDER BY revision",
          actor.orgId,
          row.id,
        )
        .map((r) => this.observation(actor, row.id, r));
      check(
        history.every((r, i) => r.revision === i + 1),
        "JOURNAL_INTEGRITY",
        "Journal observation history is incomplete.",
      );
      journalPermissions(
        row.id,
        row.review_hash,
        plan.input.authority,
        history,
      );
      if (row.state !== "ready") {
        const reserved = this.store.get(
          "SELECT journal_id FROM integration_stock_journal_references WHERE org_id=? AND realm=? AND request_ref=?",
          actor.orgId,
          row.realm,
          requestRef(row.id),
        );
        check(
          row.decision_by &&
            row.decision_by !== row.created_by &&
            row.decision_at &&
            row.decision_reason &&
            reserved?.journal_id === row.id,
          "JOURNAL_INTEGRITY",
          "An approved journal must retain its independent decision and permanent reference.",
        );
      }
      const last = history.at(-1);
      let posted: NonNullable<JournalReconciliationDate["journal"]>["posted"] =
        null;
      if (row.state === "posted") {
        const body = last?.body,
          result = body?.result,
          received = result?.result;
        check(
          last &&
            body.outcome === "posted" &&
            body.requestRef === requestRef(row.id) &&
            typeof body.leaseId === "string" &&
            body.leaseId.length > 0 &&
            canonical(Object.keys(body).sort()) ===
              canonical(
                ["leaseId", "outcome", "requestRef", "result"].sort(),
              ) &&
            result &&
            canonical(Object.keys(result).sort()) ===
              canonical(["reference", "result"]) &&
            typeof result.reference === "string" &&
            /^[1-9][0-9]{0,29}$/.test(result.reference) &&
            result.reference === row.external_id &&
            received &&
            canonical(Object.keys(received).sort()) ===
              canonical(
                [
                  "realmId",
                  "sourceHash",
                  "leg",
                  "postingDate",
                  "currency",
                  "debit",
                  "credit",
                  "syncToken",
                ].sort(),
              ) &&
            received.realmId === row.realm &&
            received.sourceHash === source.file.hash &&
            received.leg === "original" &&
            received.postingDate === date.postingDate &&
            received.currency === document.currency &&
            received.debit === date.debit &&
            received.credit === date.credit &&
            typeof received.syncToken === "string" &&
            /^[0-9]+$/.test(received.syncToken) &&
            row.lease_id === null &&
            row.lease_actor === null &&
            row.lease_started === null &&
            row.lease_mode === null,
          "JOURNAL_INTEGRITY",
          "Posted original must retain exact final native evidence and cleared lease ownership.",
        );
        posted = {
          externalId: result.reference,
          syncToken: received.syncToken,
          observationHash: last.hash,
          revision: last.revision,
          recordedBy: last.recordedBy,
          recordedAt: last.recordedAt,
        };
        if (last.recordedBy === actor.id)
          issues.push({
            code: "INDEPENDENT_REVIEW",
            message: `Another finance principal must reconcile ${date.postingDate}; you recorded its transport outcome.`,
          });
      } else
        check(
          row.external_id === null,
          "JOURNAL_INTEGRITY",
          "Unposted originals cannot retain a posted identity.",
        );
      date.journal = {
        id: row.id,
        reviewHash: row.review_hash,
        requestRef: requestRef(row.id),
        realm: row.realm,
        bindingId: row.binding_id,
        state: row.state,
        historyHash: digest(
          canonical(
            lineage.length === 0
              ? history.map((r) => r.hash)
              : { history: history.map((r) => r.hash), predecessors: lineage },
          ),
        ),
        posted,
      };
    }
    for (const date of dates)
      if (!date.journal?.posted)
        issues.push({
          code: "DATE_INCOMPLETE",
          message: `${date.postingDate} has no final posted native original.`,
        });
    const companies = new Set(
      rows.map((r) => canonical([r.realm, r.binding_id])),
    );
    if (companies.size > 1)
      issues.push({
        code: "COMPANY_MISMATCH",
        message:
          "All source dates must reconcile to one reviewed company binding.",
      });
    const total = dates.reduce((n, d) => n + BigInt(d.debit), 0n);
    check(
      total <= BigInt(Number.MAX_SAFE_INTEGER) &&
        Number(total) === document.report.debit &&
        Number(total) === document.report.credit,
      "COST_INTEGRITY",
      "Complete date totals must equal the original journal controls.",
    );
    const snapshot: JournalReconciliationSnapshot = {
      version: 1,
      packetId,
      organizationId: actor.orgId,
      contentHash: source.file.hash,
      region: organization.region,
      currency: organization.currency,
      debit: Number(total),
      credit: Number(total),
      receiverRef:
        companies.size === 1 ? stockJournalReceiver(rows[0]!.realm) : null,
      dates,
    };
    const reviewHash = digest(canonical(snapshot));
    if (source.reconciliation)
      check(
        Object.keys(source.reconciliation).sort().join("|") ===
          "journals|reviewHash|snapshot" &&
          source.reconciliation.reviewHash === reviewHash &&
          canonical(source.reconciliation.snapshot) === canonical(snapshot) &&
          reconciliationControls(dates, source.reconciliation.journals),
        "COST_INTEGRITY",
        "Accepted reconciliation must match the complete original native evidence.",
      );
    if (this.platform.recoveryHold())
      issues.push({
        code: "RECOVERY_HOLD",
        message:
          "The restored store remains isolated; confirmation requires its separately authorized release.",
      });
    return {
      ...snapshot,
      reviewHash,
      issues,
      accepted: source.accepted,
      superseded: source.superseded,
      canConfirm: !source.accepted && !source.superseded && issues.length === 0,
    };
  }
  private position(after: string | undefined, scope: string, maximum: number) {
    if (after === undefined) return { high: maximum, before: maximum + 1 };
    let token: unknown;
    if (typeof after === "string" && /^[A-Za-z0-9_-]{1,512}$/.test(after)) {
      try {
        token = JSON.parse(Buffer.from(after, "base64url").toString("utf8"));
      } catch {}
    }
    check(
      Array.isArray(token) &&
        token.length === 4 &&
        token[0] === 1 &&
        Number.isSafeInteger(token[1]) &&
        token[1] > 0 &&
        token[1] <= maximum &&
        Number.isSafeInteger(token[2]) &&
        token[2] > 0 &&
        token[2] <= token[1] &&
        token[3] === scope &&
        Buffer.from(JSON.stringify(token)).toString("base64url") === after,
      "INVALID_CURSOR",
      "Journal history position is invalid. Reload the first page.",
      400,
    );
    return { high: token[1] as number, before: token[2] as number };
  }
  private next(high: number, position: number, scope: string) {
    return Buffer.from(JSON.stringify([1, high, position, scope])).toString(
      "base64url",
    );
  }
  queue(actor: Actor, input: JournalQueueInput = {}) {
    return this.database.transaction(() => {
      actor = this.principal(actor);
      check(
        input &&
          typeof input === "object" &&
          !Array.isArray(input) &&
          Object.keys(input).every((k) =>
            ["sourceId", "state", "after"].includes(k),
          ),
        "JOURNAL_INPUT",
        "Invalid journal queue selection.",
        400,
      );
      const sourceId =
          input.sourceId === undefined
            ? null
            : text(input.sourceId, "Journal source", 160),
        state = input.state ?? null;
      check(
        input.state === undefined ||
          [
            "ready",
            "rejected",
            "pending",
            "running",
            "unknown",
            "posted",
            "cancelled",
          ].includes(input.state),
        "JOURNAL_INPUT",
        "Invalid journal state selection.",
        400,
      );
      const scope = digest(
          canonical([
            "journal-queue",
            actor.orgId,
            actor.id,
            actor.role,
            sourceId,
            state,
          ]),
        ),
        maximum = Number(
          this.store.get(
            "SELECT COALESCE(MAX(rowid),0) AS n FROM integration_stock_journals WHERE org_id=?",
            actor.orgId,
          )!.n,
        ),
        { high, before } = this.position(input.after, scope, maximum);
      if (input.after !== undefined)
        check(
          this.store.get(
            "SELECT id FROM integration_stock_journals WHERE org_id=? AND rowid=?",
            actor.orgId,
            before,
          ),
          "INVALID_CURSOR",
          "Journal queue position is unavailable. Reload the first page.",
          400,
        );
      const rows = this.store.all<Journal & { position: number }>(
        "SELECT rowid AS position,* FROM integration_stock_journals WHERE org_id=? AND (? IS NULL OR source_id=?) AND (? IS NULL OR state=?) AND rowid<=? AND rowid<? ORDER BY rowid DESC LIMIT 21",
        actor.orgId,
        sourceId,
        sourceId,
        state,
        state,
        high,
        before,
      );
      return {
        items: rows.slice(0, 20).map((r) => {
          const row = this.checkedRow(r);
          if (row.leg === "original") this.originalLineage(actor, row);
          const { plan: _plan, ...header } = this.view(row);
          return header;
        }),
        next:
          rows.length > 20 ? this.next(high, rows[19]!.position, scope) : null,
      };
    });
  }
  observations(
    actor: Actor,
    journalId: string,
    input: { after?: string } = {},
  ) {
    return this.database.transaction(() => {
      actor = this.principal(actor);
      this.row(actor, journalId);
      check(
        input &&
          typeof input === "object" &&
          !Array.isArray(input) &&
          Object.keys(input).every((k) => k === "after"),
        "JOURNAL_INPUT",
        "Invalid journal history selection.",
        400,
      );
      const scope = digest(
          canonical([
            "journal-observations",
            actor.orgId,
            actor.id,
            actor.role,
            journalId,
          ]),
        ),
        maximum = Number(
          this.store.get(
            "SELECT COALESCE(MAX(revision),0) AS n FROM integration_stock_journal_observations WHERE org_id=? AND journal_id=?",
            actor.orgId,
            journalId,
          )!.n,
        ),
        { high, before } = this.position(input.after, scope, maximum);
      if (input.after !== undefined)
        check(
          this.store.get(
            "SELECT revision FROM integration_stock_journal_observations WHERE org_id=? AND journal_id=? AND revision=?",
            actor.orgId,
            journalId,
            before,
          ),
          "INVALID_CURSOR",
          "Journal observation position is unavailable. Reload the first page.",
          400,
        );
      const rows = this.store.all(
        "SELECT * FROM integration_stock_journal_observations WHERE org_id=? AND journal_id=? AND revision<=? AND revision<? ORDER BY revision DESC LIMIT 21",
        actor.orgId,
        journalId,
        high,
        before,
      );
      return {
        items: rows
          .slice(0, 20)
          .map((r) => this.observation(actor, journalId, r)),
        next:
          rows.length > 20
            ? this.next(high, Number(rows[19]!.revision), scope)
            : null,
      };
    });
  }
  private permissions(actor: Actor, row: Journal) {
    const observations = this.store
      .all(
        "SELECT * FROM integration_stock_journal_observations WHERE org_id=? AND journal_id=? ORDER BY revision",
        actor.orgId,
        row.id,
      )
      .map((r) => this.observation(actor, row.id, r));
    return journalPermissions(
      row.id,
      row.review_hash,
      (JSON.parse(row.plan) as Plan).input.authority,
      observations,
    );
  }
  private permissionMode(row: Journal): "write" | "lookup" {
    const instant = integer(
      Date.now(),
      "Permission review clock",
      0,
      Number.MAX_SAFE_INTEGER - leaseDuration,
    );
    const expired =
      row.state === "running" &&
      row.lease_started !== null &&
      (instant < row.lease_started ||
        instant >= row.lease_started + leaseDuration);
    check(
      row.state === "unknown" ||
        expired ||
        (row.state === "pending" && !row.dispatched),
      "JOURNAL_PERMISSION_STATE",
      "Only an undispatched pending journal, unknown outcome or expired lease may review replacement permission.",
    );
    return row.state === "unknown" || expired ? "lookup" : "write";
  }
  private permissionFacts(
    actor: Actor,
    row: Journal,
    authority: LedgerAuthority,
    mode: "write" | "lookup",
    enforceOrder = false,
  ) {
    this.identity.organizationResidency.assertAllowedInTransaction(
      actor,
      authority,
    );
    const original = JSON.parse(row.plan) as Plan;
    if (mode === "write") {
      const current = this.plan(
        actor,
        { ...original.input, authority },
        enforceOrder,
      );
      check(
        canonical({
          ...current,
          input: { ...current.input, authority: original.input.authority },
        }) === row.plan,
        "JOURNAL_REVIEW_CHANGED",
        "Source, period, accounts or policy changed from the original reviewed journal.",
      );
    } else {
      check(
        this.source(actor, original.input, false).hash ===
          original.intent.source.hash,
        "JOURNAL_SOURCE",
        "Retained approved source changed.",
      );
    }
  }
  permissionReview(actor: Actor, journalId: string) {
    return this.database.transaction(() => {
      actor = this.principal(actor);
      this.platform.assertProviderAccess();
      const row = this.row(actor, journalId),
        previous = this.permissions(actor, row),
        authority =
          this.identity.organizationResidency.currentPermissionInTransaction(
            actor,
          ),
        mode = this.permissionMode(row);
      permissionInput(
        {
          journalId,
          reviewHash: row.review_hash,
          previousPermissionHash: digest(canonical(previous.authority)),
          authority,
          mode,
          reason: "Prospective replacement review",
        },
        (JSON.parse(row.plan) as Plan).input.authority,
      );
      check(
        canonical(authority) !== canonical(previous.authority),
        "JOURNAL_PERMISSION_UNCHANGED",
        "The journal already retains this permission stamp.",
      );
      check(
        previous.mode !== "lookup" || mode === "lookup",
        "JOURNAL_PERMISSION_STATE",
        "Lookup permission cannot grant another write.",
      );
      this.permissionFacts(actor, row, authority, mode);
      return {
        journal: this.view(row),
        previousAuthority: previous.authority,
        previousPermissionHash: digest(canonical(previous.authority)),
        authority,
        mode,
        disclosure: this.identity.organizationResidency.disclosure(
          actor,
          authority.disclosureId,
        ),
      };
    });
  }
  permissionHistory(actor: Actor, journalId: string, reviewId?: string) {
    return this.database.transaction(() => {
      actor = this.principal(actor);
      const row = this.row(actor, journalId),
        current = this.permissions(actor, row);
      const reviews = [...current.reviews.values()].reverse();
      if (reviewId !== undefined) {
        text(reviewId, "Permission review identity", 160);
        check(
          current.reviews.has(reviewId),
          "NOT_FOUND",
          "Permission review not found.",
          404,
        );
      }
      return {
        journalId: row.id,
        reviewHash: row.review_hash,
        authority: current.authority,
        mode: current.mode,
        reviews:
          reviewId === undefined
            ? reviews.slice(0, 20)
            : [current.reviews.get(reviewId)!],
        olderReviews: reviewId === undefined && reviews.length > 20,
      };
    });
  }
  preparePermission(actor: Actor, key: string, raw: JournalPermissionInput) {
    const input = structuredClone(raw);
    permissionInput(input);
    return this.platform.command(
      actor,
      "accounting.journal.permission.prepare",
      key,
      input,
      (cached) => {
        actor = this.principal(actor);
        const row = this.row(actor, input.journalId),
          history = this.permissions(actor, row);
        permissionInput(input, (JSON.parse(row.plan) as Plan).input.authority);
        if (cached !== undefined) {
          check(
            cached && typeof cached === "object",
            "JOURNAL_INTEGRITY",
            "Permission preparation receipt is damaged.",
          );
          const retained = history.reviews.get(cached.id);
          check(
            retained &&
              canonical({ ...retained, decision: null }) === canonical(cached),
            "JOURNAL_INTEGRITY",
            "Retained permission receipt differs from its original review.",
          );
        } else this.platform.assertProviderAccess();
      },
      () => {
        const row = this.row(actor, input.journalId),
          history = this.permissions(actor, row);
        check(
          input.reviewHash === row.review_hash &&
            input.previousPermissionHash ===
              digest(canonical(history.authority)),
          "JOURNAL_PERMISSION_CHANGED",
          "Review the current permission chain and original journal.",
        );
        check(
          input.mode === this.permissionMode(row) &&
            (history.mode !== "lookup" || input.mode === "lookup"),
          "JOURNAL_PERMISSION_STATE",
          "Review the exact permitted operation.",
        );
        check(
          canonical(input.authority) !== canonical(history.authority),
          "JOURNAL_PERMISSION_UNCHANGED",
          "The journal already retains this permission stamp.",
        );
        this.permissionFacts(actor, row, input.authority, input.mode);
        const reviewId = id(),
          reviewHash = digest(canonical(input)),
          observation = this.observe(actor, row, {
            kind: "permission-replacement.review",
            version: 1,
            id: reviewId,
            input,
            reviewHash,
          });
        return { id: reviewId, input, reviewHash, observation, decision: null };
      },
    );
  }
  decidePermission(actor: Actor, key: string, raw: JournalPermissionDecision) {
    const input = structuredClone(raw);
    permissionDecision(input);
    return this.platform.command(
      actor,
      "accounting.journal.permission.decide",
      key,
      input,
      (cached) => {
        actor = this.principal(actor);
        const row = this.row(actor, input.journalId),
          history = this.permissions(actor, row);
        if (cached !== undefined) {
          const retained = history.reviews.get(
            input.permissionReviewId,
          )?.decision;
          check(
            retained && canonical(retained) === canonical(cached),
            "JOURNAL_INTEGRITY",
            "Retained permission decision receipt changed.",
          );
        } else this.platform.assertProviderAccess();
      },
      () => {
        const row = this.row(actor, input.journalId),
          history = this.permissions(actor, row),
          review = history.reviews.get(input.permissionReviewId);
        check(
          review &&
            review.reviewHash === input.permissionReviewHash &&
            !review.decision,
          "JOURNAL_PERMISSION_REVIEW",
          "Select the exact undecided permission review.",
        );
        check(
          review.observation.recordedBy !== actor.id,
          "JOURNAL_SEPARATE_REVIEW",
          "A different current finance principal must decide this replacement permission.",
          403,
        );
        if (input.decision === "approve") {
          check(
            review.input.previousPermissionHash ===
              digest(canonical(history.authority)),
            "JOURNAL_PERMISSION_CHANGED",
            "Permission chain changed after preparation.",
          );
          check(
            review.input.mode === this.permissionMode(row) &&
              (history.mode !== "lookup" || review.input.mode === "lookup"),
            "JOURNAL_PERMISSION_STATE",
            "The reviewed operation changed after preparation.",
          );
          this.permissionFacts(
            actor,
            row,
            review.input.authority,
            review.input.mode,
          );
        }
        return this.observe(actor, row, {
          kind: "permission-replacement.decision",
          version: 1,
          input,
        });
      },
    );
  }
  private effect(row: Journal, authority: LedgerAuthority): Effect {
    const plan = JSON.parse(row.plan) as Plan;
    return {
      id: row.id,
      org_id: row.org_id,
      account_id: "",
      provider: "quickbooks",
      kind: "stock-cost-journal",
      reference: requestRef(row.id),
      payload: canonical(plan.intent),
      state: row.state,
      external_ref: row.external_id,
      result: null,
      created_at: row.created_at,
      residency_version: authority.revision,
      started_at: row.lease_started,
      error: null,
    };
  }
  private observe(actor: Actor, row: Journal, body: unknown) {
    const revision =
      Number(
        this.store.get(
          "SELECT COALESCE(MAX(revision),0) AS n FROM integration_stock_journal_observations WHERE journal_id=?",
          row.id,
        )!.n,
      ) + 1;
    integer(revision, "Observation revision", 1, Number.MAX_SAFE_INTEGER);
    const bytes = canonical(body),
      recordedAt = now(),
      evidenceHash = digest(
        canonical({
          journalId: row.id,
          orgId: row.org_id,
          revision,
          body,
          recordedBy: actor.id,
          recordedAt,
        }),
      );
    this.store.run(
      "INSERT INTO integration_stock_journal_observations VALUES(?,?,?,?,?,?,?)",
      row.id,
      revision,
      row.org_id,
      bytes,
      evidenceHash,
      actor.id,
      recordedAt,
    );
    this.platform.audit(actor, "accounting.journal.observed", row.id, {
      revision,
      hash: evidenceHash,
    });
    return {
      revision,
      body,
      hash: evidenceHash,
      recordedBy: actor.id,
      recordedAt,
    };
  }
  private clear(
    row: Journal,
    state: "unknown" | "posted" | "cancelled",
    externalId: string | null = row.external_id,
  ) {
    this.store.run(
      "UPDATE integration_stock_journals SET state=?,lease_id=NULL,lease_actor=NULL,lease_started=NULL,lease_mode=NULL,external_id=? WHERE org_id=? AND id=?",
      state,
      externalId,
      row.org_id,
      row.id,
    );
  }
  claim(
    actor: Actor,
    journalId: string,
    mode: "write" | "lookup",
  ): JournalLease | null {
    check(
      mode === "write" || mode === "lookup",
      "JOURNAL_INPUT",
      "Invalid lease mode.",
    );
    return this.database.transaction(() => {
      actor = this.principal(actor);
      this.platform.assertProviderAccess();
      let row = this.row(actor, journalId);
      const instant = integer(
          Date.now(),
          "Lease clock",
          0,
          Number.MAX_SAFE_INTEGER - leaseDuration,
        ),
        permission = this.permissions(actor, row);
      this.identity.organizationResidency.assertAllowedInTransaction(
        actor,
        permission.authority,
      );
      if (row.state === "running") {
        check(
          row.lease_started !== null,
          "JOURNAL_INTEGRITY",
          "Running journal requires a lease.",
        );
        if (
          instant >= row.lease_started &&
          instant < row.lease_started + leaseDuration
        )
          return null;
        this.observe(actor, row, {
          outcome: "unknown",
          cause:
            instant < row.lease_started ? "clock-rollback" : "expired-lease",
          leaseId: row.lease_id,
        });
        this.clear(row, "unknown");
        row = this.row(actor, journalId);
        if (mode === "write") return null;
      }
      if (row.state === "posted" || row.state === "cancelled") return null;
      check(
        mode === "write" ? row.state === "pending" : row.state === "unknown",
        "JOURNAL_STATE",
        "Only pending journals may write; unknown outcomes require read-only reconciliation.",
      );
      check(
        mode !== "write" || permission.mode === "write",
        "JOURNAL_PERMISSION_STATE",
        "Replacement lookup permission cannot grant a write.",
      );
      this.permissionFacts(actor, row, permission.authority, mode, true);
      const leaseId = id();
      this.store.run(
        "UPDATE integration_stock_journals SET state='running',lease_id=?,lease_actor=?,lease_started=?,lease_mode=? WHERE org_id=? AND id=?",
        leaseId,
        actor.id,
        instant,
        mode,
        actor.orgId,
        row.id,
      );
      row = this.row(actor, row.id);
      const lease: JournalLease = Object.freeze({
        journalId: row.id,
        orgId: row.org_id,
        actor: Object.freeze({ ...actor }),
        leaseId,
        started: instant,
        mode,
        effect: Object.freeze(this.effect(row, permission.authority)),
        bindingId: row.binding_id,
        realm: row.realm,
        authority: Object.freeze(structuredClone(permission.authority)),
      });
      this.leases.add(lease);
      this.platform.audit(actor, "accounting.journal.claimed", row.id, {
        leaseId,
        mode,
        reviewHash: row.review_hash,
      });
      return lease;
    });
  }
  private leased(lease: JournalLease) {
    check(
      lease && this.leases.has(lease),
      "JOURNAL_LEASE",
      "Only a native issued lease can own this operation.",
    );
    const row = this.row(lease.actor, lease.journalId),
      instant = Date.now();
    check(
      row.state === "running" &&
        row.lease_id === lease.leaseId &&
        row.lease_actor === lease.actor.id &&
        row.lease_mode === lease.mode &&
        row.lease_started === lease.started &&
        instant >= lease.started &&
        instant < lease.started + leaseDuration,
      "JOURNAL_LEASE",
      "Journal lease changed, expired or has an invalid clock.",
    );
    return row;
  }
  private authority(lease: JournalLease, row: Journal) {
    const actor = this.principal(lease.actor);
    this.platform.assertProviderAccess();
    const permission = this.permissions(actor, row);
    check(
      canonical(permission.authority) === canonical(lease.authority) &&
        (lease.mode !== "write" || permission.mode === "write"),
      "JOURNAL_PERMISSION_CHANGED",
      "Issued lease permission differs from the retained approved chain.",
    );
    this.identity.organizationResidency.assertAllowedInTransaction(
      actor,
      lease.authority,
    );
    check(
      canonical(this.effect(row, permission.authority)) ===
        canonical({ ...lease.effect, external_ref: row.external_id }),
      "JOURNAL_INTEGRITY",
      "Issued effect differs from retained journal.",
    );
    this.permissionFacts(actor, row, permission.authority, lease.mode, true);
    return actor;
  }
  private transportFence(fence?: () => void) {
    if (!fence) return;
    const result: unknown = fence();
    if (result instanceof Promise) void result.catch(() => {});
    check(
      result === undefined,
      "JOURNAL_AUTHORITY",
      "Transport authority must finish synchronously within the journal transaction.",
    );
  }
  guard(lease: JournalLease, transportFence?: () => void) {
    return this.database.transaction(() => {
      const row = this.leased(lease);
      this.authority(lease, row);
      this.transportFence(transportFence);
    });
  }
  beforeWrite(lease: JournalLease, transportFence?: () => void) {
    return this.database.transaction(() => {
      const row = this.leased(lease),
        actor = this.authority(lease, row);
      this.transportFence(transportFence);
      check(
        lease.mode === "write" && !row.dispatched,
        "JOURNAL_WRITE_ONCE",
        "Only an undispatched write lease may cross the provider fence.",
      );
      this.store.run(
        "UPDATE integration_stock_journals SET dispatched=1 WHERE org_id=? AND id=?",
        row.org_id,
        row.id,
      );
      this.platform.audit(actor, "accounting.journal.dispatched", row.id, {
        leaseId: row.lease_id,
        requestRef: requestRef(row.id),
      });
    });
  }
  // Transport observations are evidence only; they do not mutate stock, source
  // receipts or manual correction outcomes and are never inferred from a lookup miss.
  posted(lease: JournalLease, raw: EffectResult, transportFence?: () => void) {
    const result = structuredClone(raw);
    return this.database.transaction(() => {
      const row = this.leased(lease),
        actor = this.authority(lease, row),
        plan = JSON.parse(row.plan) as Plan;
      this.transportFence(transportFence);
      check(
        lease.mode === "lookup" || row.dispatched === 1,
        "JOURNAL_WRITE_REQUIRED",
        "Retain the write fence before a posted transport observation.",
      );
      check(
        typeof result.reference === "string" &&
          /^[1-9][0-9]{0,29}$/.test(result.reference) &&
          result.result &&
          typeof result.result === "object" &&
          !Array.isArray(result.result),
        "JOURNAL_RESPONSE",
        "Invalid receiver journal identity.",
      );
      const document = JSON.parse(plan.intent.source.bytes),
        rows: JournalLine[] = (
          row.leg === "original" ? document.report.journal : document[row.leg]
        ).filter((l: JournalLine) => l.date === row.posting_date);
      const debit = rows.reduce((n, l) => n + BigInt(l.debit), 0n),
        credit = rows.reduce((n, l) => n + BigInt(l.credit), 0n),
        received = result.result;
      check(
        canonical(Object.keys(received).sort()) ===
          canonical(
            [
              "realmId",
              "sourceHash",
              "leg",
              "postingDate",
              "currency",
              "debit",
              "credit",
              "syncToken",
            ].sort(),
          ) &&
          received.realmId === row.realm &&
          received.sourceHash === plan.intent.source.hash &&
          received.leg === row.leg &&
          received.postingDate === row.posting_date &&
          received.currency === document.currency &&
          received.debit === Number(debit) &&
          received.credit === Number(credit) &&
          typeof received.syncToken === "string" &&
          /^[0-9]+$/.test(received.syncToken),
        "JOURNAL_RESPONSE",
        "Receiver observation differs from the exact reviewed journal.",
      );
      this.observe(actor, row, {
        outcome: "posted",
        requestRef: requestRef(row.id),
        leaseId: lease.leaseId,
        result,
      });
      this.clear(row, "posted", result.reference);
      return this.view(this.row(actor, row.id));
    });
  }
  unresolved(
    lease: JournalLease,
    cause: "lookup-miss" | "transport-uncertain" | "authority-changed",
  ) {
    check(
      ["lookup-miss", "transport-uncertain", "authority-changed"].includes(
        cause,
      ),
      "JOURNAL_INPUT",
      "Invalid unresolved observation.",
    );
    check(
      lease && this.leases.has(lease),
      "JOURNAL_LEASE",
      "Only a native issued lease can release its operation.",
    );
    return this.database.transaction(() => {
      const row = this.row(lease.actor, lease.journalId);
      // Local stopping remains possible after expiry, withdrawal, role removal or
      // restore isolation, but an old worker cannot release a successor's lease.
      check(
        row.state === "running" &&
          row.lease_id === lease.leaseId &&
          row.lease_actor === lease.actor.id,
        "JOURNAL_LEASE",
        "Journal ownership changed.",
      );
      this.observe(lease.actor, row, {
        outcome: "unknown",
        cause,
        leaseId: lease.leaseId,
        requestRef: requestRef(row.id),
      });
      this.clear(row, "unknown");
      return this.view(this.row(lease.actor, row.id));
    });
  }
  private originalCancelledProof(actor: Actor, row: Journal) {
    check(
      row.leg === "original" && row.state === "cancelled",
      "JOURNAL_PREDECESSOR",
      "Only a final independently cancelled original can precede a fresh attempt.",
    );
    const { facts, history } = this.originalCancellationFacts(actor, row),
      cancellation = history.at(-1),
      body = cancellation?.body;
    check(
      cancellation &&
        body?.outcome === "cancelled-unposted" &&
        canonical(Object.keys(body).sort()) ===
          canonical(["evidenceHash", "outcome", "reason", "requestRef"]),
      "JOURNAL_INTEGRITY",
      "Retain the complete final original cancellation decision.",
    );
    originalCancellationInput({
      journalId: row.id,
      requestRef: body.requestRef,
      evidenceHash: body.evidenceHash,
      reason: body.reason,
    });
    const evidence = this.originalCancellationEvidence(
      actor,
      row,
      body.evidenceHash,
    );
    check(
      body.requestRef === requestRef(row.id) &&
        evidence.recordedBy !== cancellation.recordedBy &&
        evidence.revision + 1 === cancellation.revision,
      "JOURNAL_INTEGRITY",
      "Original cancellation must independently confirm its latest final non-posting proof.",
    );
    return {
      evidence,
      cancellation,
      snapshot: {
        ...facts,
        historyHash: digest(canonical(history.map((o) => o.hash))),
      },
      stamp: {
        journalId: row.id,
        reviewHash: row.review_hash,
        cancellationHash: cancellation.hash,
        historyHash: digest(canonical(history.map((o) => o.hash))),
      },
    };
  }
  private originalLineage(
    actor: Actor,
    row: Journal,
  ): NonNullable<Plan["predecessor"]>[] {
    const stamps: NonNullable<Plan["predecessor"]>[] = [],
      seen = new Set<string>();
    let current = row;
    while (true) {
      check(
        !seen.has(current.id),
        "JOURNAL_INTEGRITY",
        "Original retry lineage must be acyclic.",
      );
      seen.add(current.id);
      const plan = JSON.parse(current.plan) as Plan;
      check(
        current.leg === "original" &&
          canonical(Object.keys(plan).sort()) ===
            canonical(
              current.attempt_id
                ? ["input", "intent", "policyHash", "predecessor"]
                : ["input", "intent", "policyHash"],
            ),
        "JOURNAL_INTEGRITY",
        "Original attempt differs from its supported immutable lineage contract.",
      );
      if (!current.attempt_id) return stamps;
      const raw = this.store.get<Journal>(
        "SELECT * FROM integration_stock_journals WHERE org_id=? AND id=?",
        actor.orgId,
        current.attempt_id,
      );
      check(raw, "JOURNAL_INTEGRITY", "Original retry predecessor is missing.");
      const predecessor = this.checkedRow(raw),
        previous = JSON.parse(predecessor.plan) as Plan,
        proof = this.originalCancelledProof(actor, predecessor);
      check(
        predecessor.source_id === current.source_id &&
          predecessor.posting_date === current.posting_date &&
          predecessor.realm === current.realm &&
          predecessor.binding_id === current.binding_id &&
          canonical(previous.intent) === canonical(plan.intent) &&
          previous.policyHash === plan.policyHash &&
          canonical(plan.predecessor) === canonical(proof.stamp),
        "JOURNAL_INTEGRITY",
        "Original retry must preserve its complete cancelled predecessor and unchanged journal.",
      );
      stamps.push(proof.stamp);
      current = predecessor;
    }
  }
  private originalRetryDossier(actor: Actor, predecessor: Journal, plan: Plan) {
    const proof = this.originalCancelledProof(actor, predecessor),
      snapshot = {
        journal: this.view(predecessor),
        evidence: proof.evidence,
        cancellation: proof.cancellation,
        snapshot: proof.snapshot,
        plan: {
          ...plan,
          input: {
            ...plan.input,
            reason: "Separately reviewed original retry",
          },
        },
      };
    return { ...snapshot, reviewHash: digest(canonical(snapshot)) };
  }
  originalRetryReview(actor: Actor, journalId: string) {
    return this.database.transaction(() =>
      this.originalRetryReviewInTransaction(actor, journalId),
    );
  }
  private originalRetryReviewInTransaction(actor: Actor, journalId: string) {
    this.database.requireTransaction();
    actor = this.principal(actor);
    this.platform.assertProviderAccess();
    const predecessor = this.row(actor, journalId);
    this.originalCancelledProof(actor, predecessor);
    check(
      !this.store.get(
        "SELECT id FROM integration_stock_journals WHERE org_id=? AND leg='original' AND attempt_id=? AND state<>'rejected'",
        actor.orgId,
        predecessor.id,
      ),
      "JOURNAL_DUPLICATE",
      "This cancelled original already has a retained successor. Review that attempt.",
    );
    const previous = JSON.parse(predecessor.plan) as Plan,
      authority =
        this.identity.organizationResidency.currentPermissionInTransaction(
          actor,
        ),
      plan = this.plan(actor, {
        ...previous.input,
        attemptId: predecessor.id,
        authority,
        reason: "Separately reviewed original retry",
      });
    return this.originalRetryDossier(actor, predecessor, plan);
  }
  prepareOriginalRetry(actor: Actor, key: string, raw: OriginalRetryInput) {
    const input = structuredClone(raw);
    return this.platform.command(
      actor,
      "accounting.journal.original-retry.prepare",
      key,
      input,
      (cached) => {
        actor = this.principal(actor);
        check(
          input &&
            typeof input === "object" &&
            !Array.isArray(input) &&
            canonical(Object.keys(input).sort()) ===
              canonical(["journalId", "reason", "reviewHash"]) &&
            typeof input.reviewHash === "string" &&
            /^[a-f0-9]{64}$/.test(input.reviewHash),
          "JOURNAL_INPUT",
          "Use the exact original retry preparation fields.",
          400,
        );
        text(input.journalId, "Cancelled original", 160);
        text(input.reason, "Fresh original retry reason", 2000);
        if (cached !== undefined) {
          check(
            cached && typeof cached.id === "string",
            "JOURNAL_INTEGRITY",
            "Original retry receipt is damaged.",
          );
          const row = this.row(actor, cached.id),
            plan = JSON.parse(row.plan) as Plan,
            predecessor = this.row(actor, input.journalId),
            current = this.view(row);
          check(
            row.leg === "original" &&
              row.attempt_id === predecessor.id &&
              row.created_by === actor.id &&
              plan.input.reason === input.reason &&
              this.originalRetryDossier(actor, predecessor, plan).reviewHash ===
                input.reviewHash &&
              canonical(cached) ===
                canonical({
                  ...current,
                  state: "ready",
                  externalId: null,
                  decisionBy: null,
                  decisionAt: null,
                  decisionReason: null,
                  leaseStarted: null,
                  leaseMode: null,
                  dispatched: false,
                }),
            "JOURNAL_INTEGRITY",
            "Original retry receipt differs from its retained preparation and predecessor.",
          );
        }
      },
      () => {
        const review = this.originalRetryReviewInTransaction(
          actor,
          input.journalId,
        );
        check(
          review.reviewHash === input.reviewHash,
          "JOURNAL_REVIEW_CHANGED",
          "Review the current complete original cancellation and fresh retry selection.",
        );
        const plan: Plan = {
            ...review.plan,
            input: { ...review.plan.input, reason: input.reason },
          },
          journalId = id();
        this.store.run(
          "INSERT INTO integration_stock_journals(id,org_id,realm,binding_id,source_id,leg,posting_date,attempt_id,plan,review_hash,state,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
          journalId,
          actor.orgId,
          plan.input.realm,
          plan.input.bindingId,
          plan.input.sourceId,
          "original",
          plan.input.postingDate,
          input.journalId,
          canonical(plan),
          digest(canonical(plan)),
          "ready",
          actor.id,
          now(),
        );
        return this.view(this.row(actor, journalId));
      },
    );
  }
  private originalCancellationFacts(actor: Actor, row: Journal) {
    check(
      row.leg === "original",
      "JOURNAL_STATE",
      "Select an original native journal.",
    );
    if (row.state === "unknown" || row.state === "cancelled")
      check(
        row.lease_id === null &&
          row.lease_actor === null &&
          row.lease_started === null &&
          row.lease_mode === null &&
          row.external_id === null,
        "JOURNAL_INTEGRITY",
        "Unresolved or cancelled originals must retain no active lease or posted identity.",
      );
    const file = this.costs.deliverySourceInTransaction(
        actor,
        row.source_id,
      ).file,
      plan = JSON.parse(row.plan) as Plan,
      document = JSON.parse(file.bytes),
      reference = this.store.get(
        "SELECT journal_id FROM integration_stock_journal_references WHERE org_id=? AND realm=? AND request_ref=?",
        actor.orgId,
        row.realm,
        requestRef(row.id),
      ),
      lines = (document.report.journal as JournalLine[]).filter(
        (line) => line.date === row.posting_date,
      ),
      debit = lines.reduce((sum, line) => sum + BigInt(line.debit), 0n),
      credit = lines.reduce((sum, line) => sum + BigInt(line.credit), 0n);
    check(
      file.hash === plan.input.sourceHash &&
        file.bytes === plan.intent.source.bytes &&
        reference?.journal_id === row.id &&
        row.decision_by &&
        row.decision_by !== row.created_by &&
        row.decision_at &&
        row.decision_reason &&
        debit > 0n &&
        debit === credit &&
        debit <= BigInt(Number.MAX_SAFE_INTEGER),
      "JOURNAL_INTEGRITY",
      "Original cancellation must retain its approved source, balanced date, independent decision and permanent reference.",
    );
    const history = this.store
      .all(
        "SELECT * FROM integration_stock_journal_observations WHERE org_id=? AND journal_id=? ORDER BY revision",
        actor.orgId,
        row.id,
      )
      .map((r) => this.observation(actor, row.id, r));
    check(
      history.every((r, i) => r.revision === i + 1),
      "JOURNAL_INTEGRITY",
      "Original cancellation requires complete journal history.",
    );
    const finalOutcome = history.findLast((o) =>
      ["unknown", "posted", "cancelled-unposted"].includes(
        String(o.body.outcome),
      ),
    );
    check(
      finalOutcome?.body.requestRef === requestRef(row.id) &&
        (row.state === "unknown" || row.state === "running"
          ? finalOutcome?.body.outcome === "unknown"
          : row.state === "posted"
            ? finalOutcome?.body.outcome === "posted"
            : row.state === "cancelled" &&
              finalOutcome?.body.outcome === "cancelled-unposted"),
      "JOURNAL_INTEGRITY",
      "Original cancellation requires its retained native outcome history.",
    );
    journalPermissions(row.id, row.review_hash, plan.input.authority, history);
    const facts = {
      version: 1,
      orgId: row.org_id,
      journalId: row.id,
      reviewHash: row.review_hash,
      sourceId: row.source_id,
      sourceHash: file.hash,
      postingDate: row.posting_date,
      realm: row.realm,
      bindingId: row.binding_id,
      requestRef: requestRef(row.id),
      region: document.region as "CA" | "US",
      currency: document.currency as "CAD" | "USD",
      debit: Number(debit),
      credit: Number(credit),
    };
    return { facts, history };
  }
  private originalCancellationSnapshot(actor: Actor, row: Journal) {
    const { facts, history } = this.originalCancellationFacts(actor, row);
    return {
      ...facts,
      historyHash: digest(canonical(history.map((r) => r.hash))),
    };
  }
  originalCancellationEvidenceReview(actor: Actor, journalId: string) {
    return this.database.transaction(() => {
      actor = this.principal(actor);
      const row = this.row(actor, journalId);
      check(
        row.state === "unknown" && row.external_id === null,
        "JOURNAL_STATE",
        "Only an unresolved original can retain final non-posting evidence.",
      );
      const snapshot = this.originalCancellationSnapshot(actor, row);
      return {
        journal: this.view(row),
        snapshot,
        reviewHash: digest(canonical(snapshot)),
      };
    });
  }
  private originalCancellationEvidence(
    actor: Actor,
    row: Journal,
    hash?: string,
  ) {
    const { facts, history } = this.originalCancellationFacts(actor, row),
      index =
        hash === undefined
          ? history.length - 1
          : history.findIndex((o) => o.hash === hash),
      observation = history[index],
      body = observation?.body,
      snapshot = {
        ...facts,
        historyHash: digest(
          canonical(history.slice(0, index).map((r) => r.hash)),
        ),
      };
    check(
      observation &&
        index >= 0 &&
        body?.kind === "original-cancellation-evidence" &&
        canonical(Object.keys(body).sort()) ===
          canonical(["input", "kind", "snapshot"]) &&
        canonical(body.snapshot) === canonical(snapshot),
      "JOURNAL_CANCELLATION_EVIDENCE",
      "Retain current final original cancellation evidence against the complete native history.",
    );
    const input = body.input as OriginalCancellationEvidenceInput;
    originalCancellationEvidenceInput(input);
    check(
      input.journalId === row.id &&
        input.requestRef === requestRef(row.id) &&
        input.reviewHash === digest(canonical(snapshot)),
      "JOURNAL_INTEGRITY",
      "Original cancellation evidence differs from the exact reviewed request.",
    );
    return {
      evidenceHash: observation.hash,
      revision: observation.revision,
      recordedBy: observation.recordedBy,
      recordedAt: observation.recordedAt,
      input,
      snapshot,
    };
  }
  recordOriginalCancellationEvidence(
    actor: Actor,
    key: string,
    raw: OriginalCancellationEvidenceInput,
  ) {
    const input = structuredClone(raw);
    return this.platform.command(
      actor,
      "accounting.journal.original-cancellation.evidence",
      key,
      input,
      (cached) => {
        actor = this.principal(actor);
        originalCancellationEvidenceInput(input);
        const row = this.row(actor, input.journalId);
        if (cached !== undefined) {
          check(
            typeof cached?.evidence?.evidenceHash === "string",
            "JOURNAL_INTEGRITY",
            "Original evidence receipt requires its retained observation hash.",
          );
          const evidence = this.originalCancellationEvidence(
            actor,
            row,
            cached.evidence?.evidenceHash,
          );
          check(
            evidence.recordedBy === actor.id &&
              canonical(evidence.input) === canonical(input) &&
              canonical(cached) ===
                canonical({
                  journal: {
                    ...this.view(row),
                    state: "unknown",
                    externalId: null,
                    leaseStarted: null,
                    leaseMode: null,
                  },
                  evidence,
                }),
            "JOURNAL_INTEGRITY",
            "Original evidence receipt differs from its retained observation.",
          );
        }
      },
      () => {
        const row = this.row(actor, input.journalId);
        check(
          row.state === "unknown" && row.external_id === null,
          "JOURNAL_STATE",
          "Only an unresolved original can retain final non-posting evidence.",
        );
        const snapshot = this.originalCancellationSnapshot(actor, row);
        check(
          input.requestRef === requestRef(row.id) &&
            input.reviewHash === digest(canonical(snapshot)),
          "JOURNAL_REVIEW_CHANGED",
          "Review the exact current original and complete history before recording evidence.",
        );
        this.observe(actor, row, {
          kind: "original-cancellation-evidence",
          input,
          snapshot,
        });
        return {
          journal: this.view(row),
          evidence: this.originalCancellationEvidence(actor, row),
        };
      },
    );
  }
  originalCancellationReview(actor: Actor, journalId: string) {
    return this.database.transaction(() => {
      actor = this.principal(actor);
      const row = this.row(actor, journalId);
      check(
        row.state === "unknown" && row.external_id === null,
        "JOURNAL_STATE",
        "Only an unresolved original can retain final cancellation.",
      );
      const evidence = this.originalCancellationEvidence(actor, row);
      return {
        journal: this.view(row),
        evidence,
        canConfirm: actor.id !== evidence.recordedBy,
      };
    });
  }
  cancelOriginalAttempt(
    actor: Actor,
    key: string,
    raw: OriginalCancellationInput,
  ) {
    const input = structuredClone(raw);
    return this.platform.command(
      actor,
      "accounting.journal.cancel-original",
      key,
      input,
      (cached) => {
        actor = this.principal(actor);
        originalCancellationInput(input);
        const row = this.row(actor, input.journalId);
        if (cached !== undefined) {
          const { history } = this.originalCancellationFacts(actor, row),
            last = history.at(-1),
            evidence = this.originalCancellationEvidence(
              actor,
              row,
              input.evidenceHash,
            );
          check(
            row.state === "cancelled" &&
              evidence.recordedBy !== actor.id &&
              last?.recordedBy === actor.id &&
              canonical(last?.body) ===
                canonical({
                  outcome: "cancelled-unposted",
                  evidenceHash: input.evidenceHash,
                  reason: input.reason,
                  requestRef: input.requestRef,
                }) &&
              canonical(cached) ===
                canonical({ ...this.view(row), cancellation: last }),
            "JOURNAL_INTEGRITY",
            "Original cancellation receipt differs from its retained final decision.",
          );
        }
      },
      () => {
        const row = this.row(actor, input.journalId);
        check(
          row.state === "unknown" && row.external_id === null,
          "JOURNAL_STATE",
          "Only an unresolved original can retain final cancellation.",
        );
        const evidence = this.originalCancellationEvidence(actor, row);
        check(
          actor.id !== evidence.recordedBy &&
            input.evidenceHash === evidence.evidenceHash &&
            input.requestRef === requestRef(row.id),
          "JOURNAL_CANCELLATION",
          "A separate current finance reviewer must bind current final non-posting evidence to this exact original request.",
        );
        const cancellation = this.observe(actor, row, {
          outcome: "cancelled-unposted",
          evidenceHash: input.evidenceHash,
          reason: input.reason,
          requestRef: input.requestRef,
        });
        this.clear(row, "cancelled");
        return { ...this.view(this.row(actor, row.id)), cancellation };
      },
    );
  }
  cancellationReview(actor: Actor, journalId: string) {
    return this.database.transaction(() => {
      actor = this.principal(actor);
      const row = this.row(actor, journalId);
      check(
        row.state === "unknown" && row.leg !== "original",
        "JOURNAL_STATE",
        "Only an unresolved correction attempt can retain final cancellation.",
      );
      const evidence = this.costs.corrections.deliveryCancellationInTransaction(
        actor,
        row.source_id,
        row.leg as "reversal" | "replacement",
        row.attempt_id || null,
      );
      return {
        journal: this.view(row),
        evidence,
        canConfirm: actor.id !== evidence.recordedBy,
      };
    });
  }
  cancelCorrectionAttempt(
    actor: Actor,
    key: string,
    input: {
      journalId: string;
      requestRef: string;
      evidenceHash: string;
      reason: string;
    },
  ) {
    return this.platform.command(
      actor,
      "accounting.journal.cancel",
      key,
      input,
      () => {
        actor = this.principal(actor);
        this.row(actor, input.journalId);
      },
      () => {
        const row = this.row(actor, input.journalId),
          reason = text(input.reason, "Cancellation review reason", 2000);
        check(
          row.state === "unknown" && row.leg !== "original",
          "JOURNAL_STATE",
          "Only an unresolved correction attempt can retain final cancellation.",
        );
        const evidence =
          this.costs.corrections.deliveryCancellationInTransaction(
            actor,
            row.source_id,
            row.leg as "reversal" | "replacement",
            row.attempt_id || null,
          );
        check(
          evidence.evidenceHash === input.evidenceHash &&
            input.requestRef === requestRef(row.id) &&
            actor.id !== evidence.recordedBy,

          "JOURNAL_CANCELLATION",
          "A separate finance reviewer must bind final cancellation evidence to this exact native request reference.",
        );
        const cancellation = this.observe(actor, row, {
          outcome: "cancelled-unposted",
          evidenceHash: evidence.evidenceHash,
          reason,
          requestRef: requestRef(row.id),
        });
        this.clear(row, "cancelled");
        return { ...this.view(this.row(actor, row.id)), cancellation };
      },
    );
  }
}

export type OfflineOriginalJournalReview = ReturnType<
  StockJournalDelivery["readOfflineOriginalInTransaction"]
>;

export type OfflineOriginalCancellationProof = OfflineFrozen<
  Omit<OfflineOriginalJournalReview, "hash" | "purpose"> & {
    purpose: "distributor-stock-journal-offline-original-cancellation-v1";
    proof: ReturnType<StockJournalDelivery["originalCancelledProof"]>;
    hash: string;
  }
>;
