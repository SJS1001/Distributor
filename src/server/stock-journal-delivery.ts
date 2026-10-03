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
import type { IntegrationCosts, JournalLine } from "./integration-costs.ts";
import type { Effect, EffectResult } from "./integration.ts";
import type { LedgerAuthority } from "./organization-residency.ts";
import {
  stockJournalIntent,
  type StockJournalIntent,
} from "./quickbooks-stock-journal.ts";
import { STOCK_JOURNAL_INITIALIZE_DDL } from "./stock-journal-schema.ts";

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
type Plan = {
  input: JournalDeliveryInput;
  intent: StockJournalIntent;
  policyHash: string;
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
// Native ownership only. No HTTP routes, queue polling, adapter registration or
// provider I/O occurs here. Only a separately wired transport can use these leases.
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
      check(
        input.attemptId === null,
        "JOURNAL_ATTEMPT",
        "Original journals cannot reuse correction retry approval.",
      );
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
        // A manual cancellation must also resolve any native previous attempt.
        const previous = retry.input.previousAttemptId ?? "";
        check(
          !this.store.get(
            "SELECT id FROM integration_stock_journals WHERE org_id=? AND source_id=? AND leg=? AND attempt_id=? AND state NOT IN('cancelled','rejected')",
            actor.orgId,
            input.sourceId,
            input.leg,
            previous,
          ),
          "JOURNAL_PREDECESSOR",
          "Resolve the previous native delivery before a fresh retry.",
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
    return { input, intent, policyHash: policy.hash };
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
        observations: history.slice(0, 100).map((r) => {
          check(
            digest(
              canonical({
                journalId,
                orgId: actor.orgId,
                revision: Number(r.revision),
                body: JSON.parse(String(r.body)),
                recordedBy: String(r.recorded_by),
                recordedAt: String(r.recorded_at),
              }),
            ) === r.hash,
            "JOURNAL_INTEGRITY",
            "Journal observation failed integrity.",
          );
          return {
            revision: Number(r.revision),
            hash: String(r.hash),
            body: JSON.parse(String(r.body)),
            recordedBy: String(r.recorded_by),
            recordedAt: String(r.recorded_at),
          };
        }),
        olderObservations: history.length > 100,
      };
    });
  }
  private effect(row: Journal): Effect {
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
      residency_version: plan.input.authority.revision,
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
        plan = JSON.parse(row.plan) as Plan;
      this.identity.organizationResidency.assertAllowedInTransaction(
        actor,
        plan.input.authority,
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
      if (mode === "write")
        check(
          digest(canonical(this.plan(actor, plan.input, true))) ===
            row.review_hash,
          "JOURNAL_REVIEW_CHANGED",
          "Journal authority, source or policy changed since review.",
        );
      else
        check(
          this.source(actor, plan.input, false).hash ===
            plan.intent.source.hash,
          "JOURNAL_SOURCE",
          "Retained approved source changed.",
        );
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
        effect: Object.freeze(this.effect(row)),
        bindingId: row.binding_id,
        realm: row.realm,
        authority: Object.freeze(structuredClone(plan.input.authority)),
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
    this.identity.organizationResidency.assertAllowedInTransaction(
      actor,
      lease.authority,
    );
    const plan = JSON.parse(row.plan) as Plan;
    check(
      canonical(this.effect(row)) ===
        canonical({ ...lease.effect, external_ref: row.external_id }),
      "JOURNAL_INTEGRITY",
      "Issued effect differs from retained journal.",
    );
    if (lease.mode === "write")
      check(
        digest(canonical(this.plan(actor, plan.input, true))) ===
          row.review_hash,
        "JOURNAL_REVIEW_CHANGED",
        "Current journal write authority changed.",
      );
    else
      check(
        this.source(actor, plan.input, false).hash === plan.intent.source.hash,
        "JOURNAL_SOURCE",
        "Retained source changed.",
      );
    return actor;
  }
  guard(lease: JournalLease) {
    return this.database.transaction(() => {
      const row = this.leased(lease);
      this.authority(lease, row);
    });
  }
  beforeWrite(lease: JournalLease) {
    return this.database.transaction(() => {
      const row = this.leased(lease),
        actor = this.authority(lease, row);
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
  posted(lease: JournalLease, raw: EffectResult) {
    const result = structuredClone(raw);
    return this.database.transaction(() => {
      const row = this.leased(lease),
        actor = this.authority(lease, row),
        plan = JSON.parse(row.plan) as Plan;
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
        this.observe(actor, row, {
          outcome: "cancelled-unposted",
          evidenceHash: evidence.evidenceHash,
          reason,
          requestRef: requestRef(row.id),
        });
        this.clear(row, "cancelled");
        return this.view(this.row(actor, row.id));
      },
    );
  }
}
