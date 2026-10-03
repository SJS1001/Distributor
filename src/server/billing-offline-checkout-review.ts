import { types } from "node:util";
import { canonical, check, digest, type Actor } from "./core.ts";
import type { Database, Store } from "./database.ts";
import type { Identity } from "./iam.ts";
import type { Billing } from "./billing.ts";
import {
  refundStatuses,
  type RefundStatus,
  type OfflineFailedRefundReview,
} from "./billing-refunds.ts";

type Frozen<T> = T extends object
  ? { readonly [K in keyof T]: Frozen<T[K]> }
  : T;
type Facts = Pick<
  OfflineFailedRefundReview,
  | "invoice"
  | "invoiceLines"
  | "credits"
  | "creditLines"
  | "payments"
  | "refunds"
  | "providerMappings"
  | "observations"
  | "manualProofs"
  | "notices"
  | "noticeUpdates"
  | "noticeReads"
>;
export type OfflineCheckoutBillingReview = Frozen<
  Facts & {
    version: 1;
    purpose: "billing.offline-checkout-native-history.v1";
    orgId: string;
    region: "CA" | "US";
    currency: "CAD" | "USD";
    accountId: string;
    openingDocuments: [];
    openingLines: [];
    capacity: {
      credited: number;
      paid: number;
      refunded: number;
      balance: number;
      pendingReservations: number;
      invoiceAvailable: number;
      payments: { paymentId: string; reserved: number; available: number }[];
    };
    factsHash: string;
  }
>;
export const offlineCheckoutBillingLimits = Object.freeze({
  rowsPerSet: 1000,
  rows: 4096,
  fieldBytes: 65536,
  rowBytes: 131072,
  bytes: 2097152,
});
function reviewAssert(value: unknown): asserts value {
  check(
    value,
    "OFFLINE_CHECKOUT_BILLING_REVIEW",
    "Complete native Billing history is inconsistent.",
  );
}
function bounded(value: unknown): asserts value {
  check(
    value,
    "OFFLINE_CHECKOUT_BILLING_LIMIT",
    "Complete native Billing history exceeds the fixed review bound.",
  );
}
const exactText = (v: unknown, max = 160, multiline = false): v is string =>
  typeof v === "string" &&
  !!v &&
  v === v.trim() &&
  v.length <= max &&
  !(multiline ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/ : /[\x00-\x1f\x7f]/).test(v);
const exactTime = (v: unknown): v is string =>
  typeof v === "string" &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString() === v;
const safe = (v: unknown, min = 0): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min;
const sum = (values: number[]) =>
  values.reduce((n, v) => {
    reviewAssert(safe(v));
    const next = n + v;
    reviewAssert(safe(next));
    return next;
  }, 0);
function frozen<T>(value: T): Frozen<T> {
  const copy = structuredClone(value);
  const freeze = (v: unknown): void => {
    if (v && typeof v === "object") {
      Object.values(v).forEach(freeze);
      Object.freeze(v);
    }
  };
  freeze(copy);
  return copy as Frozen<T>;
}

// Every retained column is fixed owning schema, never a caller-selected query.
const sets = {
  invoice: [
    "billing_invoices",
    "id org_id account_id order_id shipment_id number currency net tax total created_at",
    "net tax total",
    "id",
  ],
  invoiceLines: [
    "billing_lines",
    "id org_id invoice_id product_id description quantity unit_price unit_tax",
    "quantity unit_price unit_tax",
    "id",
  ],
  credits: [
    "billing_credits",
    "id org_id invoice_id reference number reason net tax total created_at",
    "net tax total",
    "id",
  ],
  creditLines: [
    "billing_credit_lines",
    "id org_id credit_id invoice_line_id quantity",
    "quantity",
    "id",
  ],
  payments: [
    "billing_payments",
    "id org_id invoice_id provider external_ref amount created_at",
    "amount",
    "id",
  ],
  refunds: [
    "billing_refunds",
    "id org_id invoice_id payment_id amount reference state created_at",
    "amount",
    "id",
  ],
  providerMappings: [
    "billing_refund_provider",
    "refund_id org_id external_ref status",
    "",
    "refund_id,org_id",
  ],
  observations: [
    "billing_refund_observations",
    "id org_id refund_id external_ref status applied created_at",
    "id applied",
    "id",
  ],
  manualProofs: [
    "billing_refund_proofs",
    "org_id external_ref refund_id created_at",
    "",
    "refund_id,org_id,external_ref",
  ],
  notices: [
    "billing_refund_alerts",
    "seq org_id refund_id invoice_id status state revision created_at updated_at",
    "seq revision",
    "seq",
  ],
  noticeUpdates: [
    "billing_refund_alert_updates",
    "org_id refund_id revision status state source created_at",
    "revision",
    "refund_id,revision,org_id",
  ],
  noticeReads: [
    "billing_refund_alert_reads",
    "org_id refund_id actor_id revision acknowledged_at",
    "revision",
    "refund_id,actor_id,org_id",
  ],
} as const;
type SetName = keyof typeof sets;

/** Complete bounded native Billing consistency only. Trusted composition must
 * supply these actual owners on the same Database. No authority/transport grant. */
export class BillingOfflineCheckoutReview {
  private readonly store: Store;
  constructor(
    private readonly database: Database,
    private readonly identity: Identity,
    private readonly billing: Billing,
  ) {
    this.store = database.owned("billing");
  }
  getInTransaction(
    supplied: Pick<Actor, "id" | "orgId">,
    invoiceId: unknown,
  ): OfflineCheckoutBillingReview {
    this.database.requireTransaction();
    // Reject even revoked proxies before descriptors; only two data values are
    // admitted. Ignore stale role/sites supplied by a real historical Actor.
    reviewAssert(exactText(invoiceId, 128));
    reviewAssert(
      supplied && typeof supplied === "object" && !types.isProxy(supplied),
    );
    const user = Object.getOwnPropertyDescriptor(supplied, "id"),
      organization = Object.getOwnPropertyDescriptor(supplied, "orgId");
    reviewAssert(
      user && "value" in user && organization && "value" in organization,
    );
    reviewAssert(
      exactText(user.value, 128) && exactText(organization.value, 128),
    );
    const unchanged = this.store.get("SELECT total_changes() AS n")!.n;
    const actor = this.identity.workerActor(organization.value, user.value);
    // SQL parameters are detached primitive identities. Closure includes reverse
    // links, foreign copied keys and local orphans rather than hiding them in
    // scoped inner joins. Unattributable local orphans conservatively refuse.
    const cte = `WITH target AS (SELECT ? AS id, ? AS org),
    line_ids AS (SELECT id FROM billing_lines WHERE invoice_id=(SELECT id FROM target)),
    credit_ids AS (SELECT id FROM billing_credits WHERE invoice_id=(SELECT id FROM target)),
    payment_ids AS (SELECT id FROM billing_payments WHERE invoice_id=(SELECT id FROM target)),
    refund_ids AS (SELECT id FROM billing_refunds WHERE invoice_id=(SELECT id FROM target) OR payment_id IN payment_ids),
    selected_refunds AS (SELECT id FROM refund_ids)
   `;
    const params = [invoiceId, actor.orgId];
    const local = "org_id=(SELECT org FROM target)";
    const orphan = (parent: string, key: string) =>
      `(${local} AND NOT EXISTS(SELECT 1 FROM ${parent} p WHERE p.id=${key} AND p.org_id=(SELECT org FROM target)))`;
    const where: Record<SetName, string> = {
      invoice: "id=(SELECT id FROM target)",
      invoiceLines: `invoice_id=(SELECT id FROM target) OR id IN(SELECT invoice_line_id FROM billing_credit_lines WHERE credit_id IN credit_ids) OR ${orphan("billing_invoices", "billing_lines.invoice_id")}`,
      credits: `invoice_id=(SELECT id FROM target) OR id IN(SELECT credit_id FROM billing_credit_lines WHERE invoice_line_id IN line_ids) OR ${orphan("billing_invoices", "billing_credits.invoice_id")}`,
      creditLines: `credit_id IN credit_ids OR invoice_line_id IN line_ids OR ${orphan("billing_credits", "billing_credit_lines.credit_id")} OR ${orphan("billing_lines", "billing_credit_lines.invoice_line_id")}`,
      payments: `invoice_id=(SELECT id FROM target) OR id IN(SELECT payment_id FROM billing_refunds WHERE id IN refund_ids) OR ${orphan("billing_invoices", "billing_payments.invoice_id")}`,
      refunds: `id IN refund_ids OR ${orphan("billing_invoices", "billing_refunds.invoice_id")} OR ${orphan("billing_payments", "billing_refunds.payment_id")}`,
      providerMappings: "",
      observations: "",
      manualProofs: "",
      notices: "",
      noticeUpdates: "",
      noticeReads: "",
    };
    for (const name of [
      "providerMappings",
      "observations",
      "manualProofs",
      "notices",
      "noticeUpdates",
      "noticeReads",
    ] as const) {
      const table = sets[name][0];
      where[name] =
        `refund_id IN selected_refunds OR ${orphan("billing_refunds", `${table}.refund_id`)}`;
    }
    where.notices += " OR invoice_id=(SELECT id FROM target)";
    // Imported/opening history requires a separate explicit historical capacity
    // profile. Refuse by numeric existence before opening values can be read.
    check(
      !this.store.get(
        `${cte} SELECT 1 AS n FROM billing_opening_documents WHERE invoice_id=(SELECT id FROM target) LIMIT 1`,
        ...params,
      ) &&
        !this.store.get(
          `${cte} SELECT 1 AS n FROM billing_opening_lines WHERE invoice_id=(SELECT id FROM target) OR line_id IN line_ids LIMIT 1`,
          ...params,
        ),
      "OFFLINE_CHECKOUT_BILLING_OPENING_REQUIRED",
      "Opening Billing history requires its owning review profile.",
    );
    let count = 0,
      expandedBytes = 2048;
    // All sets pass before ANY retained row enters JS, including a later set
    // that would exhaust the complete aggregate budget. No JSON measurement.
    for (const name of Object.keys(sets) as SetName[]) {
      const [table, fields, numbers] = sets[name],
        cols = fields.split(" "),
        ints = numbers.split(" ");
      const from = `FROM ${table} WHERE ${where[name]}`;
      const n = this.store.get<{ n: number }>(
        `${cte} SELECT COUNT(*) AS n FROM (SELECT 1 ${from} LIMIT 1001)`,
        ...params,
      )!.n;
      bounded(
        safe(n) &&
          n <= offlineCheckoutBillingLimits.rowsPerSet &&
          (count += n) <= offlineCheckoutBillingLimits.rows,
      );
      const sizes = cols.map((c) => `length(CAST(${c} AS BLOB))`),
        bytes = sizes.join("+");
      const invalid = cols
        .map((c) =>
          ints.includes(c)
            ? `(typeof(${c})!='integer' OR ${c}<0 OR ${c}>9007199254740991)`
            : `typeof(${c})!='text'`,
        )
        .join(" OR ");
      const meta = this.store.get<{
        bad: number;
        field: number;
        row: number;
        total: number;
      }>(
        `${cte} SELECT COALESCE(MAX(CASE WHEN ${invalid} THEN 1 ELSE 0 END),0) AS bad,COALESCE(MAX(MAX(${sizes.join(",")})),0) AS field,COALESCE(MAX(${bytes}),0) AS row,COALESCE(SUM(${bytes}),0) AS total ${from}`,
        ...params,
      )!;
      bounded(
        meta.bad === 0 &&
          [meta.field, meta.row, meta.total].every((v) => safe(v)) &&
          meta.field <= offlineCheckoutBillingLimits.fieldBytes &&
          meta.row <= offlineCheckoutBillingLimits.rowBytes,
      );
      expandedBytes +=
        6 * meta.total + n * (fields.length + 6 * cols.length + 4);
      bounded(expandedBytes <= offlineCheckoutBillingLimits.bytes);
    }
    // Exact provider/bank identity collisions are ambiguous even across copied
    // tenants. Numeric refusal only; never return another tenant's values.
    reviewAssert(
      !this.store.get(
        `${cte} SELECT 1 AS n FROM billing_payments a JOIN billing_payments b ON a.provider=b.provider AND a.external_ref=b.external_ref AND a.id!=b.id WHERE a.id IN payment_ids LIMIT 1`,
        ...params,
      ),
    );
    for (const table of [
      "billing_refund_provider",
      "billing_refund_observations",
      "billing_refund_proofs",
    ]) {
      reviewAssert(
        !this.store.get(
          `${cte} SELECT 1 AS n FROM ${table} a JOIN ${table} b ON a.external_ref=b.external_ref AND (a.refund_id!=b.refund_id OR a.org_id!=b.org_id) WHERE a.refund_id IN refund_ids LIMIT 1`,
          ...params,
        ),
      );
    }
    const read = <K extends SetName>(
      name: K,
    ): (K extends "invoice"
      ? Facts["invoice"]
      : Facts[K] extends readonly (infer V)[]
        ? V
        : never)[] => {
      const [table, fields, numbers, order] = sets[name];
      const columns = fields.split(" "),
        texts = columns.filter((c) => !numbers.split(" ").includes(c));
      // The native driver replaces malformed UTF-8. Compare its exact encoding
      // against the SAME bounded native text read, never hash replacement bytes.
      // These internal hex witnesses are discarded; they are not public facts.
      const witnesses = texts.map(
        (c) => `hex(CAST(${c} AS BLOB)) AS bytes_${c}`,
      );
      const rows = this.store.all(
        `${cte} SELECT ${columns.concat(witnesses).join(",")} FROM ${table} WHERE ${where[name]} ORDER BY ${order}`,
        ...params,
      );
      return rows.map((row) => {
        for (const c of texts)
          reviewAssert(
            typeof row[c] === "string" &&
              Buffer.from(row[c], "utf8").toString("hex").toUpperCase() ===
                row[`bytes_${c}`],
          );
        return Object.fromEntries(columns.map((c) => [c, row[c]]));
      }) as never;
    };
    const invoices = read("invoice");
    reviewAssert(invoices.length === 1);
    const invoice = invoices[0]!,
      invoiceLines = read("invoiceLines"),
      credits = read("credits"),
      creditLines = read("creditLines"),
      payments = read("payments"),
      refunds = read("refunds"),
      providerMappings = read("providerMappings"),
      observations = read("observations"),
      manualProofs = read("manualProofs"),
      notices = read("notices"),
      noticeUpdates = read("noticeUpdates"),
      noticeReads = read("noticeReads");
    const org = this.identity.organization(actor);
    reviewAssert(
      invoice.org_id === actor.orgId && exactText(invoice.account_id),
    );
    const customer = this.identity.customer(actor, invoice.account_id);
    reviewAssert(
      ["CA", "US"].includes(org.region) &&
        ["CAD", "USD"].includes(org.currency) &&
        customer.org_id === org.id &&
        customer.currency === org.currency &&
        invoice.currency === org.currency,
    );
    reviewAssert(
      invoice.org_id === org.id &&
        invoice.currency === org.currency &&
        [
          invoice.id,
          invoice.account_id,
          invoice.order_id,
          invoice.shipment_id,
          invoice.number,
        ].every((v) => exactText(v)) &&
        exactTime(invoice.created_at) &&
        [invoice.net, invoice.tax, invoice.total].every((v) => safe(v)) &&
        invoice.net + invoice.tax === invoice.total,
    );
    reviewAssert(invoiceLines.length > 0);
    for (const line of invoiceLines)
      reviewAssert(
        line.org_id === org.id &&
          line.invoice_id === invoice.id &&
          [line.id, line.product_id].every((v) => exactText(v)) &&
          exactText(line.description, 2000, true) &&
          safe(line.quantity, 1) &&
          line.quantity <= 100000 &&
          safe(line.unit_price) &&
          safe(line.unit_tax),
      );
    reviewAssert(
      sum(invoiceLines.map((l) => l.quantity * l.unit_price)) === invoice.net &&
        sum(invoiceLines.map((l) => l.quantity * l.unit_tax)) === invoice.tax,
    );
    const linesById = new Map(invoiceLines.map((l) => [l.id, l]));
    const creditsById = new Map(credits.map((c) => [c.id, c]));
    for (const c of creditLines)
      reviewAssert(
        c.org_id === org.id &&
          exactText(c.id) &&
          creditsById.has(c.credit_id) &&
          linesById.has(c.invoice_line_id) &&
          safe(c.quantity, 1),
      );
    for (const c of credits) {
      reviewAssert(
        c.org_id === org.id &&
          c.invoice_id === invoice.id &&
          [c.id, c.reference, c.number].every((v) => exactText(v)) &&
          exactText(c.reason, 1000, true) &&
          exactTime(c.created_at) &&
          c.created_at >= invoice.created_at &&
          [c.net, c.tax, c.total].every((v) => safe(v)),
      );
      const linked = creditLines.filter((l) => l.credit_id === c.id);
      reviewAssert(
        new Set(linked.map((l) => l.invoice_line_id)).size === linked.length,
      );
      reviewAssert(
        linked.length > 0 &&
          sum(
            linked.map(
              (l) => l.quantity * linesById.get(l.invoice_line_id)!.unit_price,
            ),
          ) === c.net &&
          sum(
            linked.map(
              (l) => l.quantity * linesById.get(l.invoice_line_id)!.unit_tax,
            ),
          ) === c.tax &&
          c.net + c.tax === c.total,
      );
      this.billing.recordedCredit(actor, c.id); // Bounded original owning invariant.
    }
    for (const line of invoiceLines)
      reviewAssert(
        sum(
          creditLines
            .filter((l) => l.invoice_line_id === line.id)
            .map((l) => l.quantity),
        ) <= line.quantity,
      );
    const paymentsById = new Map(payments.map((p) => [p.id, p]));
    for (const p of payments)
      reviewAssert(
        p.org_id === org.id &&
          p.invoice_id === invoice.id &&
          exactText(p.id) &&
          ["stripe", "manual"].includes(p.provider) &&
          exactText(p.external_ref) &&
          (p.provider !== "stripe" ||
            /^pi_[a-zA-Z0-9_]+$/.test(p.external_ref)) &&
          safe(p.amount, 1) &&
          p.amount <= 1e12 &&
          exactTime(p.created_at) &&
          p.created_at >= invoice.created_at,
      );
    for (const r of refunds)
      reviewAssert(
        r.org_id === org.id &&
          r.invoice_id === invoice.id &&
          paymentsById.has(r.payment_id) &&
          exactText(r.id) &&
          exactText(r.reference) &&
          safe(r.amount, 1) &&
          r.amount <= 1e12 &&
          ["pending", "unknown", "completed", "rejected"].includes(r.state) &&
          exactTime(r.created_at) &&
          r.created_at >= paymentsById.get(r.payment_id)!.created_at,
      );

    const ids = refunds.map((r) => r.id);
    for (const rows of [
      providerMappings,
      observations,
      manualProofs,
      notices,
      noticeUpdates,
      noticeReads,
    ])
      for (const r of rows)
        reviewAssert(r.org_id === org.id && ids.includes(r.refund_id));
    for (const r of refunds) {
      const p = paymentsById.get(r.payment_id)!;
      const mappings = providerMappings.filter((v) => v.refund_id === r.id),
        obs = observations.filter((v) => v.refund_id === r.id),
        proofs = manualProofs.filter((v) => v.refund_id === r.id),
        alerts = notices.filter((v) => v.refund_id === r.id),
        updates = noticeUpdates.filter((v) => v.refund_id === r.id),
        reads = noticeReads.filter((v) => v.refund_id === r.id);
      reviewAssert(
        mappings.length <= 1 && proofs.length <= 1 && alerts.length <= 1,
      );
      if (p.provider === "manual") {
        reviewAssert(
          !mappings.length &&
            !obs.length &&
            !alerts.length &&
            !updates.length &&
            !reads.length &&
            ((r.state === "pending" && !proofs.length) ||
              (r.state === "completed" && proofs.length === 1)),
        );
        for (const proof of proofs)
          reviewAssert(
            exactText(proof.external_ref) &&
              exactTime(proof.created_at) &&
              proof.created_at >= r.created_at,
          );
        continue;
      }
      reviewAssert(!proofs.length);
      let status: RefundStatus | null = null,
        at = r.created_at;
      const transitions: { status: RefundStatus; at: string }[] = [];
      let noticed: RefundStatus | null = null;
      for (const o of obs) {
        reviewAssert(
          safe(o.id, 1) &&
            /^re_[a-zA-Z0-9_]+$/.test(o.external_ref) &&
            exactText(o.external_ref) &&
            refundStatuses.includes(o.status) &&
            exactTime(o.created_at) &&
            o.created_at >= at &&
            (o.applied === 0 || o.applied === 1),
        );
        reviewAssert(
          mappings.length === 1 && o.external_ref === mappings[0]!.external_ref,
        );
        const applied =
          status === null ||
          (status !== "failed" &&
            status !== "canceled" &&
            (status !== "succeeded" || o.status !== "pending"));
        reviewAssert(o.applied === Number(applied));
        if (applied) {
          status = o.status;
          if (
            (noticed !== null ||
              ["failed", "canceled", "requires_action"].includes(status)) &&
            noticed !== status
          ) {
            transitions.push({ status, at: o.created_at });
            noticed = status;
          }
        }
        at = o.created_at;
      }
      reviewAssert(
        status === null
          ? !mappings.length && ["pending", "unknown"].includes(r.state)
          : mappings.length === 1 &&
              mappings[0]!.status === status &&
              r.state ===
                (status === "succeeded"
                  ? "completed"
                  : status === "failed" || status === "canceled"
                    ? "rejected"
                    : "unknown"),
      );
      if (!alerts.length) {
        reviewAssert(!transitions.length && !updates.length && !reads.length);
        continue;
      }
      const a = alerts[0]!;
      reviewAssert(
        status !== null &&
          a.invoice_id === invoice.id &&
          a.status === status &&
          safe(a.seq, 1) &&
          safe(a.revision, 1) &&
          updates.length === a.revision &&
          exactTime(a.created_at) &&
          exactTime(a.updated_at) &&
          a.created_at >= r.created_at &&
          a.updated_at >= a.created_at,
      );
      const state = (s: RefundStatus) =>
        ["failed", "canceled", "requires_action"].includes(s)
          ? "open"
          : "resolved";
      reviewAssert(a.state === state(a.status));
      // Legacy notice initialization may start at an existing exception. It is
      // retained as such, never reconstructed as a fresh provider observation.
      const suffixes =
        updates[0]?.source === "existing-state"
          ? transitions
              .map((_, i) => transitions.slice(i))
              .filter((xs) =>
                ["failed", "canceled", "requires_action"].includes(
                  xs[0]!.status,
                ),
              )
          : [transitions];
      reviewAssert(
        suffixes.some(
          (xs) =>
            xs.length === updates.length &&
            xs[0]!.at <= a.created_at &&
            (updates[0]!.source === "existing-state" ||
              a.created_at === updates[0]!.created_at) &&
            xs.every(
              (x, i) =>
                x.status === updates[i]!.status &&
                x.at <= updates[i]!.created_at &&
                (!xs[i + 1] || updates[i]!.created_at <= xs[i + 1]!.at),
            ),
        ),
      );
      let previous = a.created_at;
      for (const [index, u] of updates.entries()) {
        reviewAssert(
          u.revision === index + 1 &&
            refundStatuses.includes(u.status) &&
            u.state === state(u.status) &&
            exactTime(u.created_at) &&
            u.created_at >= previous &&
            (u.source === "observation" ||
              (index === 0 && u.source === "existing-state")),
        );
        previous = u.created_at;
      }
      reviewAssert(
        updates.at(-1)!.status === a.status &&
          updates.at(-1)!.created_at === a.updated_at,
      );
      for (const read of reads)
        reviewAssert(
          exactText(read.actor_id) &&
            safe(read.revision, 1) &&
            read.revision <= a.revision &&
            exactTime(read.acknowledged_at) &&
            read.acknowledged_at >= updates[read.revision - 1]!.created_at,
        );
    }

    const credited = sum(credits.map((c) => c.total)),
      paid = sum(payments.map((p) => p.amount)),
      refunded = sum(
        refunds.filter((r) => r.state === "completed").map((r) => r.amount),
      ),
      pendingReservations = sum(
        refunds
          .filter((r) => r.state === "pending" || r.state === "unknown")
          .map((r) => r.amount),
      );
    const balance = invoice.total - credited - paid + refunded;
    reviewAssert(
      Number.isSafeInteger(balance) &&
        credited <= invoice.total &&
        refunded <= paid &&
        pendingReservations <= Math.max(0, -balance),
    );
    const totals = { credited, paid, refunded, balance };
    reviewAssert(
      canonical(this.billing.totals(actor, invoice.id)) === canonical(totals),
    );
    const paymentCapacity = payments.map((p) => {
      const reserved = sum(
        refunds
          .filter((r) => r.payment_id === p.id && r.state !== "rejected")
          .map((r) => r.amount),
      );
      reviewAssert(reserved <= p.amount);
      return { paymentId: p.id, reserved, available: p.amount - reserved };
    });
    // Completed cash cannot exceed the credit/overpayment entitlement either.
    reviewAssert(
      refunded + pendingReservations <=
        Math.max(0, paid - invoice.total + credited),
    );
    const body = {
      version: 1 as const,
      purpose: "billing.offline-checkout-native-history.v1" as const,
      orgId: org.id,
      region: org.region,
      currency: org.currency,
      accountId: invoice.account_id,
      invoice,
      invoiceLines,
      credits,
      creditLines,
      payments,
      refunds,
      providerMappings,
      observations,
      manualProofs,
      notices,
      noticeUpdates,
      noticeReads,
      openingDocuments: [] as [],
      openingLines: [] as [],
      capacity: {
        ...totals,
        pendingReservations,
        invoiceAvailable: Math.max(0, -balance) - pendingReservations,
        payments: paymentCapacity,
      },
    };
    const raw = canonical(body);
    bounded(Buffer.byteLength(raw) <= offlineCheckoutBillingLimits.bytes);
    reviewAssert(
      this.store.get("SELECT total_changes() AS n")!.n === unchanged,
    );
    return frozen({ ...body, factsHash: digest(raw) });
  }
}
