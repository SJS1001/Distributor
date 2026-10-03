import { canonical, check, digest, type Actor, type Row } from "./core.ts";
import type { Database, Store } from "./database.ts";
import type { Identity } from "./iam.ts";
import type { Billing } from "./billing.ts";
import type { Effect } from "./integration.ts";

type Frozen<T> = T extends object
  ? { readonly [K in keyof T]: Frozen<T[K]> }
  : T;
const MAX_ROWS = 64;
const MAX_TOTAL_ROWS = 512;
const MAX_BYTES = 2 * 1024 * 1024;
// All retained columns of these fixed Integration-owned tables. No runtime
// schema reflection or caller SQL/column port. Keep identity and timing fields
// in the same pre-materialization profile as payload/result/error strings.
const tables = {
  integration_effects:
    "id org_id account_id provider kind reference payload state external_ref result created_at residency_version started_at error",
  integration_refund_polls: "effect_id org_id token started_at retry_at",
  integration_refund_callbacks:
    "id org_id binding_id event_id effect_id provider_reference event_type hash state attempts started_at retry_at error created_at",
  integration_callbacks:
    "id org_id binding_id event_id session_id effect_id hash state attempts started_at retry_at error created_at",
  integration_inbox: "provider event_id hash created_at",
  integration_operation_leases: "effect_id org_id token started_at",
  integration_payment_allocations:
    "effect_id org_id invoice_id payment_id applied_amount",
  integration_accounting_refunds:
    "effect_id org_id invoice_id refund_id credit_id amount",
  integration_credit_applications:
    "effect_id org_id invoice_id credit_id amount",
  integration_credit_cancellations:
    "effect_id org_id actor_id reason review_version amount created_at",
  integration_checkout_renewals:
    "successor_id org_id invoice_id predecessor_id reason review_version created_at",
  integration_checkout_observations:
    "sequence id org_id account_id invoice_id effect_id claim_token actor_id snapshot hash",
  integration_balance_reads:
    "id org_id effect_id command_key hash token started_at requested_at result error",
  integration_balance_observations: "sequence read_id org_id effect_id result",
} as const;
type Table = keyof typeof tables;
function consistent(value: unknown): asserts value {
  check(
    value,
    "OFFLINE_REFUND_REVIEW",
    "Retained Integration refund lineage is inconsistent.",
  );
}
function bounded(value: unknown): asserts value {
  check(
    value,
    "OFFLINE_REFUND_REVIEW_LIMIT",
    "Retained Integration refund review exceeds its bounded profile.",
  );
}
function parse(value: unknown): Record<string, any> {
  consistent(typeof value === "string");
  bounded(Buffer.byteLength(value) <= 65536);
  let result: unknown;
  try {
    result = JSON.parse(value);
  } catch {
    consistent(false);
  }
  consistent(
    result !== null && typeof result === "object" && !Array.isArray(result),
  );
  let nodes = 0;
  function visit(v: unknown, depth: number) {
    bounded(depth <= 16 && ++nodes <= 4096);
    if (v && typeof v === "object")
      for (const child of Object.values(v)) visit(child, depth + 1);
  }
  visit(result, 0);
  return result as Record<string, any>;
}
function freeze<T>(value: T): Frozen<T> {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as Frozen<T>;
}
function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function token(row: Row) {
  consistent(
    (row.token === null && row.started_at === null) ||
      (typeof row.token === "string" &&
        row.token.length > 0 &&
        row.token.length <= 160 &&
        Number.isSafeInteger(row.started_at) &&
        Number(row.started_at) >= 0),
  );
}

/** Internal Integration owner. No SQL, callback, evidence or authority port is
 * accepted from callers. All reads use the caller's existing writer transaction. */
export class IntegrationOfflineRefundReview {
  private readonly store: Store;
  constructor(
    private database: Database,
    private identity: Identity,
    private billing: Billing,
  ) {
    this.store = database.owned("integration");
  }
  getInTransaction(actor: Actor, effectId: string) {
    this.database.requireTransaction();
    actor = this.identity.workerActor(actor.orgId, actor.id);
    consistent(
      typeof effectId === "string" &&
        effectId.length > 0 &&
        effectId.length <= 160 &&
        effectId.trim() === effectId,
    );
    const unchanged = this.store.get("SELECT total_changes() AS n")!.n;
    let count = 0;
    let bytes = 0;
    // Fixed module-private SQL only. Public input is just the scoped effect ID.
    const rows = (
      table: Table,
      where: string,
      args: (string | number | null)[],
      order = "rowid",
    ): Row[] => {
      const n = this.store.get(
        `SELECT COUNT(*) AS n FROM (SELECT 1 FROM ${table} WHERE ${where} LIMIT ?)`,
        ...args,
        MAX_ROWS + 1,
      )!.n;
      bounded(Number(n) <= MAX_ROWS && (count += Number(n)) <= MAX_TOTAL_ROWS);
      // Only numeric metadata crosses into JavaScript before the complete set
      // passes. BLOB length counts UTF-8 and text after embedded NUL; no JSON
      // construction/parsing is used to measure the retained values.
      const sizes = tables[table]
        .split(" ")
        .map((column) => `COALESCE(length(CAST(${column} AS BLOB)),0)`);
      const rowBytes = sizes.join("+");
      const budget = this.store.get<{
        field: number;
        row: number;
        total: number;
      }>(
        `SELECT COALESCE(MAX(MAX(${sizes.join(",")})),0) AS field,
          COALESCE(MAX(${rowBytes}),0) AS row,
          COALESCE(SUM(${rowBytes}),0) AS total
         FROM ${table} WHERE ${where}`,
        ...args,
      )!;
      bounded(
        [budget.field, budget.row, budget.total].every(nonnegativeInteger) &&
          budget.field <= 65536 &&
          budget.row <= MAX_BYTES &&
          budget.total <= MAX_BYTES - bytes,
      );
      bytes += budget.total;
      const result = this.store.all(
        `SELECT * FROM ${table} WHERE ${where} ORDER BY ${order}`,
        ...args,
      );
      for (const row of result)
        for (const value of Object.values(row)) {
          consistent(
            value === null ||
              typeof value === "string" ||
              (typeof value === "number" && Number.isSafeInteger(value)),
          );
          if (typeof value === "string") {
            const size = Buffer.byteLength(value);
            bounded(size <= 65536);
          }
        }
      return result;
    };
    const target = rows("integration_effects", "org_id=? AND id=?", [
      actor.orgId,
      effectId,
    ])[0];
    check(target, "NOT_FOUND", "Refund operation not found.", 404);
    consistent(target.provider === "stripe" && target.kind === "refund");
    const effect = target as unknown as Effect;
    const organization = this.identity.organization(actor);
    const account = this.identity.customer(actor, effect.account_id);
    // Existing task-shaped Billing reads only. Complete Billing history is NOT
    // available at this baseline; never simulate the separately owned new API.
    const native = this.billing.refunds.get(actor, effect.reference);
    const intent = this.billing.refunds.intent(actor, effect.reference);
    const accountingFact = this.billing.refunds.accountingFact(
      actor,
      effect.reference,
    );
    consistent(
      native.row.org_id === actor.orgId &&
        native.invoice.org_id === actor.orgId &&
        native.invoice.account_id === account.id &&
        native.payment.org_id === actor.orgId &&
        native.invoice.currency === organization.currency &&
        account.currency === organization.currency,
    );
    consistent(
      effect.payload === canonical(intent) &&
        intent.refundId === effect.reference &&
        intent.invoiceId === native.invoice.id &&
        native.row.payment_id === native.payment.id &&
        intent.amount > 0 &&
        Number.isSafeInteger(intent.amount) &&
        intent.amount <= 1e12 &&
        Number.isSafeInteger(intent.paymentAmount) &&
        intent.paymentAmount > 0 &&
        intent.paymentAmount <= 1e12 &&
        intent.amount <= intent.paymentAmount,
    );
    // Scan the bounded account scope, plus direct identities and known native
    // refund paths, to catch copied rows whose account/org was altered.
    const effects = rows(
      "integration_effects",
      `account_id=? OR reference IN (?,?,?) OR CASE WHEN json_valid(payload) THEN json_extract(payload,'$.refundId')=? OR json_extract(payload,'$.refund.refundId')=? OR json_extract(payload,'$.invoiceId')=? OR json_extract(payload,'$.invoice.id')=? OR json_extract(payload,'$.credit.invoice.id')=? OR json_extract(payload,'$.refund.credit.invoice.id')=? OR json_extract(payload,'$.paymentId') IN (?,?) OR json_extract(payload,'$.payment.id')=? OR json_extract(payload,'$.refund.paymentId')=? ELSE 0 END`,
      [
        account.id,
        effect.reference,
        native.invoice.id,
        String(native.payment.id),
        effect.reference,
        effect.reference,
        native.invoice.id,
        native.invoice.id,
        native.invoice.id,
        native.invoice.id,
        String(native.payment.id),
        intent.paymentId,
        String(native.payment.id),
        String(native.payment.id),
      ],
      "id",
    ) as unknown as Effect[];
    const byId = new Map(effects.map((e) => [e.id, e]));
    const payloads = new Map<string, Record<string, any>>();
    for (const e of effects) {
      consistent(e.org_id === actor.orgId && e.account_id === account.id);
      consistent(["stripe", "quickbooks"].includes(e.provider));
      payloads.set(e.id, parse(e.payload));
      if (e.result !== null) parse(e.result);
    }
    const ids = effects.map((e) => e.id);
    const placeholders = ids.map(() => "?").join(",");
    const linked = `effect_id IN (${placeholders})`;
    const scoped = (list: Row[]) => {
      for (const r of list)
        consistent(r.org_id === actor.orgId && byId.has(String(r.effect_id)));
      return list;
    };
    const polls = scoped(
      rows("integration_refund_polls", linked, ids, "effect_id"),
    );
    for (const e of effects)
      if (e.provider === "stripe" && e.kind === "refund")
        consistent(polls.filter((r) => r.effect_id === e.id).length === 1);
    for (const p of polls) {
      token(p);
      consistent(nonnegativeInteger(p.retry_at));
      consistent(
        byId.get(String(p.effect_id))!.provider === "stripe" &&
          byId.get(String(p.effect_id))!.kind === "refund",
      );
    }
    const leases = scoped(
      rows("integration_operation_leases", linked, ids, "effect_id"),
    );
    for (const lease of leases) token(lease);
    const refundCallbacks = scoped(
      rows(
        "integration_refund_callbacks",
        `${linked} OR (? IS NOT NULL AND provider_reference=?)`,
        [...ids, effect.external_ref, effect.external_ref],
        "id",
      ),
    );
    // A copied effect_id must not hide a callback whose retained session still
    // identifies a selected native checkout. Never attribute unrelated inbox rows.
    const checkoutSessions = effects
      .filter(
        (e) =>
          e.provider === "stripe" && e.kind === "checkout" && e.external_ref,
      )
      .map((e) => e.external_ref!);
    const checkoutCallbacks = scoped(
      rows(
        "integration_callbacks",
        checkoutSessions.length
          ? `${linked} OR session_id IN (${checkoutSessions.map(() => "?").join(",")})`
          : linked,
        [...ids, ...checkoutSessions],
        "id",
      ),
    );
    for (const [list, kind] of [
      [refundCallbacks, "refund"],
      [checkoutCallbacks, "checkout"],
    ] as const)
      for (const c of list) {
        const e = byId.get(String(c.effect_id))!;
        consistent(
          e.provider === "stripe" &&
            e.kind === kind &&
            typeof c.hash === "string" &&
            /^[a-f0-9]{64}$/.test(c.hash),
        );
        consistent(
          Number(c.attempts) >= 0 &&
            Number(c.retry_at) >= 0 &&
            ((c.state === "processing" &&
              Number.isSafeInteger(c.started_at) &&
              Number(c.started_at) >= 0) ||
              (c.state !== "processing" && c.started_at === null)),
        );
        if (kind === "refund")
          consistent(
            typeof c.provider_reference === "string" &&
              /^re_[a-zA-Z0-9_]+$/.test(c.provider_reference) &&
              ["refund.created", "refund.updated", "refund.failed"].includes(
                String(c.event_type),
              ) &&
              (!e.external_ref || e.external_ref === c.provider_reference),
          );
        else {
          consistent(!e.external_ref || e.external_ref === c.session_id);
          const matches = effects.filter(
            (candidate) =>
              candidate.provider === "stripe" &&
              candidate.kind === "checkout" &&
              candidate.external_ref === c.session_id,
          );
          consistent(
            matches.length === 0 ||
              (matches.length === 1 && matches[0]!.id === e.id),
          );
        }
      }
    const callbacks = [...refundCallbacks, ...checkoutCallbacks];
    for (const c of callbacks) {
      const aliases = rows(
        "integration_callbacks",
        "event_id=?",
        [String(c.event_id)],
        "id",
      );
      const refundAliases = rows(
        "integration_refund_callbacks",
        "event_id=?",
        [String(c.event_id)],
        "id",
      );
      consistent(aliases.length + refundAliases.length === 1);
    }
    const eventIds = callbacks.map((c) => String(c.event_id));
    const inbox = eventIds.length
      ? rows(
          "integration_inbox",
          `event_id IN (${eventIds.map(() => "?").join(",")})`,
          eventIds,
          "provider,event_id",
        )
      : [];
    for (const receipt of inbox)
      consistent(
        receipt.provider === "stripe" &&
          checkoutCallbacks.some((c) => c.event_id === receipt.event_id) &&
          !refundCallbacks.some((c) => c.event_id === receipt.event_id) &&
          typeof receipt.hash === "string" &&
          /^[a-f0-9]{64}$/.test(receipt.hash),
      );
    const paymentAllocations = scoped(
      rows(
        "integration_payment_allocations",
        `${linked} OR invoice_id=? OR payment_id=?`,
        [...ids, native.invoice.id, String(native.payment.id)],
        "effect_id",
      ),
    );
    const refundMappings = scoped(
      rows(
        "integration_accounting_refunds",
        `${linked} OR invoice_id=? OR refund_id=?`,
        [...ids, native.invoice.id, effect.reference],
        "effect_id",
      ),
    );
    const creditApplications = scoped(
      rows(
        "integration_credit_applications",
        `${linked} OR invoice_id=?`,
        [...ids, native.invoice.id],
        "effect_id",
      ),
    );
    const cancellations = scoped(
      rows("integration_credit_cancellations", linked, ids, "effect_id"),
    );
    const parent = (parentId: unknown, kind: string, reference: unknown) => {
      consistent(typeof parentId === "string");
      const e = byId.get(parentId);
      consistent(
        e &&
          e.provider === "quickbooks" &&
          e.kind === kind &&
          e.state === "completed" &&
          typeof reference === "string" &&
          e.external_ref === reference,
      );
      return e;
    };
    const invoiceSummary = (invoice: Record<string, any> | undefined) => {
      consistent(
        invoice &&
          typeof invoice.id === "string" &&
          invoice.id.length > 0 &&
          typeof invoice.number === "string" &&
          invoice.number.length > 0 &&
          nonnegativeInteger(invoice.total) &&
          invoice.currency === organization.currency,
      );
      // Descendants intentionally retain only this immutable subset.
      return {
        id: invoice.id,
        number: invoice.number,
        total: invoice.total,
        currency: invoice.currency,
      };
    };
    for (const e of effects) {
      const p = payloads.get(e.id)!;
      if (e.provider === "stripe") {
        consistent(["checkout", "refund"].includes(e.kind));
        if (e.kind === "refund")
          consistent(
            p.refundId === e.reference && typeof p.invoiceId === "string",
          );
        else
          consistent(
            p.invoiceId === e.reference || e.reference.startsWith("renewal:"),
          );
        continue;
      }
      consistent(
        [
          "invoice",
          "credit",
          "payment",
          "credit-application",
          "refund-expense",
          "refund-application",
        ].includes(e.kind),
      );
      if (e.kind === "invoice") {
        consistent(invoiceSummary(p.invoice).id === e.reference);
      }
      if (e.kind === "credit" || e.kind === "payment") {
        const original = parent(
          p.invoiceEffectId,
          "invoice",
          p.externalInvoiceRef,
        );
        consistent(
          p.invoice?.id === original.reference &&
            canonical(invoiceSummary(p.invoice)) ===
              canonical(invoiceSummary(payloads.get(original.id)!.invoice)),
        );
        if (e.kind === "credit") consistent(p.credit?.id === e.reference);
        else consistent(p.payment?.id === e.reference);
      }
      if (e.kind === "credit-application") {
        const credit = parent(
          p.creditEffectId,
          "credit",
          `credit:${p.externalCreditRef}`,
        );
        consistent(canonical(p.credit) === credit.payload);
      }
      if (e.kind === "refund-expense") {
        consistent(p.refundId === e.reference);
        const credit = parent(
          p.creditEffectId,
          "credit",
          `credit:${p.externalCreditRef}`,
        );
        const payment = parent(
          p.paymentEffectId,
          "payment",
          `payment:${p.externalPaymentRef}`,
        );
        consistent(
          canonical(p.credit) === credit.payload &&
            canonical(p.payment) === payment.payload &&
            typeof p.paymentId === "string" &&
            p.paymentId === p.payment?.payment?.id &&
            typeof p.credit?.invoice?.id === "string" &&
            p.credit.invoice.id === p.payment?.invoice?.id,
        );
      }
      if (e.kind === "refund-application") {
        const expense = parent(
          p.expenseEffectId,
          "refund-expense",
          `expense:${p.externalExpenseRef}`,
        );
        consistent(
          canonical(p.refund) === expense.payload &&
            p.refund.refundId === e.reference,
        );
      }
    }
    for (const r of paymentAllocations) {
      const e = byId.get(String(r.effect_id))!,
        p = payloads.get(e.id)!;
      consistent(
        e.provider === "quickbooks" &&
          e.kind === "payment" &&
          r.payment_id === e.reference &&
          p.payment?.id === r.payment_id &&
          p.invoice?.id === r.invoice_id &&
          p.appliedAmount === r.applied_amount,
      );
    }
    for (const r of refundMappings) {
      const e = byId.get(String(r.effect_id))!,
        p = payloads.get(e.id)!;
      consistent(
        e.provider === "quickbooks" &&
          e.kind === "refund-expense" &&
          e.reference === r.refund_id &&
          p.refundId === r.refund_id &&
          p.credit?.credit?.id === r.credit_id &&
          p.credit?.invoice?.id === r.invoice_id &&
          p.amount === r.amount,
      );
    }
    for (const r of creditApplications) {
      const e = byId.get(String(r.effect_id))!,
        p = payloads.get(e.id)!;
      consistent(
        e.provider === "quickbooks" &&
          e.kind === "credit-application" &&
          p.credit?.credit?.id === r.credit_id &&
          p.credit?.invoice?.id === r.invoice_id &&
          p.amount === r.amount,
      );
    }
    for (const e of effects)
      for (const [kind, list] of [
        ["payment", paymentAllocations],
        ["refund-expense", refundMappings],
        ["credit-application", creditApplications],
      ] as const)
        if (e.provider === "quickbooks" && e.kind === kind)
          consistent(list.filter((r) => r.effect_id === e.id).length === 1);
    for (const r of cancellations) {
      const application = creditApplications.find(
        (a) => a.effect_id === r.effect_id,
      );
      consistent(
        application &&
          application.amount === r.amount &&
          byId.get(String(r.effect_id))!.state === "blocked" &&
          typeof r.review_version === "string" &&
          /^[a-f0-9]{64}$/.test(r.review_version),
      );
    }
    const renewals = rows(
      "integration_checkout_renewals",
      `successor_id IN (${placeholders}) OR predecessor_id IN (${placeholders}) OR invoice_id=?`,
      [...ids, ...ids, native.invoice.id],
      "successor_id",
    );
    for (const r of renewals) {
      const a = byId.get(String(r.predecessor_id)),
        b = byId.get(String(r.successor_id));
      consistent(
        r.org_id === actor.orgId &&
          a?.kind === "checkout" &&
          b?.kind === "checkout" &&
          a.provider === "stripe" &&
          b.provider === "stripe" &&
          b.reference === `renewal:${a.id}` &&
          payloads.get(a.id)!.invoiceId === r.invoice_id &&
          payloads.get(b.id)!.invoiceId === r.invoice_id,
      );
    }
    const checkoutObservations = scoped(
      rows(
        "integration_checkout_observations",
        `${linked} OR invoice_id=?`,
        [...ids, native.invoice.id],
        "sequence",
      ),
    );
    for (const r of checkoutObservations) {
      const snapshot = parse(r.snapshot),
        e = byId.get(String(r.effect_id))!;
      consistent(
        e.provider === "stripe" &&
          e.kind === "checkout" &&
          r.account_id === account.id &&
          snapshot.id === r.id &&
          snapshot.effectId === e.id &&
          snapshot.invoiceId === r.invoice_id &&
          payloads.get(e.id)!.invoiceId === r.invoice_id &&
          digest(String(r.snapshot)) === r.hash &&
          nonnegativeInteger(snapshot.amount) &&
          snapshot.amount > 0 &&
          snapshot.amount === payloads.get(e.id)!.amount &&
          snapshot.currency === organization.currency &&
          payloads.get(e.id)!.currency === organization.currency.toLowerCase(),
      );
    }
    const balanceReads = scoped(
      rows("integration_balance_reads", linked, ids, "id"),
    );
    const balanceObservations = scoped(
      rows("integration_balance_observations", linked, ids, "sequence"),
    );
    for (const r of balanceReads) {
      token(r);
      const e = byId.get(String(r.effect_id))!;
      consistent(e.provider === "quickbooks" && e.kind === "invoice");
      if (r.result !== null) {
        const p = parse(r.result);
        const invoice = invoiceSummary(payloads.get(e.id)!.invoice);
        consistent(
          p.id === r.id &&
            p.effectId === e.id &&
            p.invoiceId === e.reference &&
            e.state === "completed" &&
            typeof e.external_ref === "string" &&
            p.reference === e.external_ref &&
            p.total === invoice.total &&
            p.currency === invoice.currency &&
            p.requestedAt === r.requested_at &&
            [p.total, p.credited, p.paid, p.refunded, p.providerBalance].every(
              nonnegativeInteger,
            ) &&
            p.providerBalance <= p.total &&
            Number.isSafeInteger(p.nativeBalance) &&
            Number.isSafeInteger(p.difference),
        );
        // Compare historical arithmetic exactly, not with today's native balance.
        consistent(
          BigInt(p.nativeBalance) ===
            BigInt(p.total) -
              BigInt(p.credited) -
              BigInt(p.paid) +
              BigInt(p.refunded) &&
            BigInt(p.difference) ===
              BigInt(p.providerBalance) - BigInt(p.nativeBalance),
        );
      }
    }
    for (const r of balanceObservations) {
      const read = balanceReads.find((x) => x.id === r.read_id),
        p = parse(r.result);
      consistent(
        read &&
          read.effect_id === r.effect_id &&
          read.result === r.result &&
          p.id === r.read_id &&
          p.sequence === r.sequence &&
          p.effectId === r.effect_id,
      );
    }
    for (const r of balanceReads)
      if (r.result !== null)
        consistent(
          balanceObservations.filter((o) => o.read_id === r.id).length === 1,
        );
    if (effect.result !== null) {
      const result = parse(effect.result);
      consistent(
        effect.state === "completed" &&
          /^re_[a-zA-Z0-9_]+$/.test(effect.external_ref ?? "") &&
          result.effectId === effect.id &&
          result.refundId === intent.refundId &&
          result.paymentId === intent.paymentId &&
          result.amount === intent.amount &&
          result.currency === intent.currency &&
          [
            "pending",
            "requires_action",
            "succeeded",
            "failed",
            "canceled",
          ].includes(result.status) &&
          accountingFact.cashReference === effect.external_ref,
      );
      consistent(
        native.row.state ===
          (result.status === "succeeded"
            ? "completed"
            : ["failed", "canceled"].includes(result.status)
              ? "rejected"
              : "unknown"),
      );
    } else
      consistent(effect.external_ref === null && effect.state !== "completed");
    const blockers = new Set<string>([
      "BILLING_COMPLETE_HISTORY_REQUIRED",
      "PLATFORM_RECEIPT_HISTORY_REQUIRED",
      "INBOX_UNATTRIBUTED_HISTORY_UNAVAILABLE",
    ]);
    if (effect.state !== "unknown" || native.row.state !== "unknown")
      blockers.add("NOT_FIRST_UNKNOWN_REFUND");
    if (effect.external_ref || effect.result || accountingFact.cashReference)
      blockers.add("RETAINED_PROVIDER_OR_MANUAL_OUTCOME");
    if (polls.some((p) => p.token !== null))
      blockers.add("RETAINED_REFUND_CLAIM");
    if (leases.length) blockers.add("RETAINED_GENERIC_LEASES");
    if (callbacks.length || inbox.length)
      blockers.add("RETAINED_CALLBACK_LINEAGE");
    if (
      effects.some((e) => e.provider === "quickbooks") ||
      paymentAllocations.length ||
      refundMappings.length ||
      creditApplications.length
    )
      blockers.add("RETAINED_ACCOUNTING_LINEAGE");
    if (balanceReads.length || balanceObservations.length)
      blockers.add("RETAINED_BALANCE_LINEAGE");
    if (checkoutObservations.length || renewals.length)
      blockers.add("RETAINED_CHECKOUT_LINEAGE");
    const facts = {
      version: 1 as const,
      orgId: actor.orgId,
      accountId: account.id,
      region: organization.region,
      currency: organization.currency,
      effectId,
      effect,
      intent,
      billing: { ...native, accountingFact },
      account,
      scope: "bounded-account-effects-and-direct-subject-links" as const,
      effects,
      polls,
      leases,
      refundCallbacks,
      checkoutCallbacks,
      inbox,
      paymentAllocations,
      refundMappings,
      creditApplications,
      cancellations,
      renewals,
      checkoutObservations,
      balanceReads,
      balanceObservations,
      blockers: [...blockers].sort(),
    };
    const encoded = canonical(facts);
    bounded(Buffer.byteLength(encoded) <= MAX_BYTES);
    consistent(this.store.get("SELECT total_changes() AS n")!.n === unchanged);
    return freeze(
      structuredClone({
        ...facts,
        hash: digest(
          canonical({
            purpose: "distributor-integration-offline-refund-review-v1",
            facts,
          }),
        ),
      }),
    );
  }
}
export type IntegrationOfflineFailedRefundReview = ReturnType<
  IntegrationOfflineRefundReview["getInTransaction"]
>;
