import { types } from "node:util";
import {
  account,
  canonical,
  check,
  digest,
  now,
  permit,
  text,
  type Actor,
  type Row,
} from "./core.ts";
import type { Database, Store } from "./database.ts";
import type { Platform } from "./platform.ts";
import type { Billing, RecordedPayment } from "./billing.ts";
import type { Identity } from "./iam.ts";
import { BillingRefundAlerts } from "./billing-refund-alerts.ts";
import { BillingRefundHistory } from "./billing-refund-history.ts";

export type RefundStatus =
  "pending" | "requires_action" | "succeeded" | "failed" | "canceled";
export type RefundIntent = {
  refundId: string;
  invoiceId: string;
  paymentId: string;
  paymentAmount: number;
  amount: number;
  currency: string;
};
/** Detached native comparison input, never provider evidence or authority. */
export type OfflineFailedRefundTuple = Readonly<
  RefundIntent & {
    externalReference: string;
    currency: "cad" | "usd";
    status: "failed";
  }
>;
export type OfflineFailedRefundApplicationReceipt = Readonly<{
  version: 1;
  refundId: string;
  observationId: number;
  applied: true;
  state: "rejected";
  status: "failed";
  /** Public notice identity is the native refund ID; sequence is separate. */
  noticeId: string;
  noticeSequence: number;
  noticeRevision: 1;
  noticeStatus: "failed";
  noticeState: "open";
}>;

export type AccountingRefundFact = {
  id: string;
  invoiceId: string;
  paymentId: string;
  amount: number;
  currency: string;
  state: string;
  cashReference: string | null;
};
export const refundStatuses = [
  "pending",
  "requires_action",
  "succeeded",
  "failed",
  "canceled",
] as const;
type RefundRow = {
  id: string;
  org_id: string;
  invoice_id: string;
  payment_id: string;
  amount: number;
  reference: string;
  state: string;
  created_at: string;
  provider: string;
  provider_reference: string | null;
  provider_status: string | null;
};
type NativeRefund = Pick<
  RefundRow,
  | "id"
  | "org_id"
  | "invoice_id"
  | "payment_id"
  | "amount"
  | "reference"
  | "state"
  | "created_at"
>;
type NativeInvoice = {
  id: string;
  org_id: string;
  account_id: string;
  order_id: string;
  shipment_id: string;
  number: string;
  currency: string;
  net: number;
  tax: number;
  total: number;
  created_at: string;
};
type NativeLine = {
  id: string;
  org_id: string;
  invoice_id: string;
  product_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  unit_tax: number;
};
type NativeCredit = {
  id: string;
  org_id: string;
  invoice_id: string;
  reference: string;
  number: string;
  reason: string;
  net: number;
  tax: number;
  total: number;
  created_at: string;
};
type NativeCreditLine = {
  id: string;
  org_id: string;
  credit_id: string;
  invoice_line_id: string;
  quantity: number;
};
type RefundProvider = {
  refund_id: string;
  org_id: string;
  external_ref: string;
  status: RefundStatus;
};
type RefundObservation = RefundProvider & {
  id: number;
  applied: number;
  created_at: string;
};
type RefundProof = {
  org_id: string;
  external_ref: string;
  refund_id: string;
  created_at: string;
};
type RefundNotice = {
  seq: number;
  org_id: string;
  refund_id: string;
  invoice_id: string;
  status: RefundStatus;
  state: string;
  revision: number;
  created_at: string;
  updated_at: string;
};
type RefundNoticeUpdate = {
  org_id: string;
  refund_id: string;
  revision: number;
  status: RefundStatus;
  state: string;
  source: string;
  created_at: string;
};
type RefundNoticeRead = {
  org_id: string;
  refund_id: string;
  actor_id: string;
  revision: number;
  acknowledged_at: string;
};
type Frozen<T> = T extends object
  ? { readonly [K in keyof T]: Frozen<T[K]> }
  : T;
export type OfflineFailedRefundReview = Frozen<{
  version: 1;
  orgId: string;
  region: "CA" | "US";
  currency: "CAD" | "USD";
  refund: NativeRefund;
  invoice: NativeInvoice;
  originalPayment: RecordedPayment;
  intent: RefundIntent;
  invoiceLines: NativeLine[];
  credits: NativeCredit[];
  creditLines: NativeCreditLine[];
  payments: RecordedPayment[];
  refunds: NativeRefund[];
  providerMappings: RefundProvider[];
  observations: RefundObservation[];
  manualProofs: RefundProof[];
  notices: RefundNotice[];
  noticeUpdates: RefundNoticeUpdate[];
  noticeReads: RefundNoticeRead[];
  capacity: {
    credited: number;
    paid: number;
    refunded: number;
    balance: number;
    pendingReservations: number;
    invoiceAvailable: number;
    originalPaymentReserved: number;
    originalPaymentAvailable: number;
  };
  factsHash: string;
}>;
/** Complete retained Billing consistency, never proof of an offline import. */
export type OfflineFailedRefundRecovery = Frozen<{
  version: 1;
  purpose: "billing.offline-failed-refund-result.v1";
  receipt: OfflineFailedRefundApplicationReceipt;
  failed: OfflineFailedRefundTuple;
  native: OfflineFailedRefundReview;
  factsHash: string;
}>;
/** Refuse oversized complete facts, never return an apparently complete page. */
export const offlineRefundReviewLimits = Object.freeze({
  rowsPerSet: 1000,
  bytes: 1048576,
});
const reviewAssert = (condition: unknown) =>
  check(
    condition,
    "OFFLINE_REFUND_REVIEW",
    "Complete native refund facts are inconsistent or unsupported.",
  );
const exactText = (v: unknown, max = 160) =>
  typeof v === "string" && !!v && v === v.trim() && v.length <= max;
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

function captureOfflineFailedRefundTuple(
  value: unknown,
): OfflineFailedRefundTuple {
  function valid(condition: unknown): asserts condition {
    check(
      condition,
      "OFFLINE_REFUND_INPUT",
      "Supply an exact bounded native failed-refund tuple.",
      400,
    );
  }
  // isProxy also handles revoked proxies without running any trap. Do not
  // reflect, enumerate, clone, stringify or access properties before this check.
  valid(value !== null && typeof value === "object" && !types.isProxy(value));
  const prototype = Object.getPrototypeOf(value);
  valid(prototype === Object.prototype || prototype === null);
  const fields = [
    "refundId",
    "invoiceId",
    "paymentId",
    "paymentAmount",
    "amount",
    "currency",
    "externalReference",
    "status",
  ] as const;
  const keys = Reflect.ownKeys(value);
  valid(
    keys.length === fields.length &&
      keys.every(
        (key) =>
          typeof key === "string" &&
          fields.includes(key as (typeof fields)[number]),
      ),
  );
  const data: Record<string, unknown> = Object.create(null);
  for (const key of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    valid(descriptor && descriptor.enumerable && "value" in descriptor);
    data[key] = descriptor.value;
  }
  const boundedText = (v: unknown, max: number): v is string =>
    typeof v === "string" &&
    v.length > 0 &&
    v.length <= max &&
    v.trim() === v &&
    !v.includes("\0") &&
    Buffer.byteLength(v) <= max;
  valid(
    boundedText(data.refundId, 128) &&
      boundedText(data.invoiceId, 128) &&
      boundedText(data.paymentId, 128) &&
      /^pi_[A-Za-z0-9_]+$/.test(data.paymentId) &&
      boundedText(data.externalReference, 160) &&
      /^re_[A-Za-z0-9_]+$/.test(data.externalReference) &&
      safe(data.paymentAmount, 1) &&
      data.paymentAmount <= 1e12 &&
      safe(data.amount, 1) &&
      data.amount <= data.paymentAmount &&
      (data.currency === "cad" || data.currency === "usd") &&
      data.status === "failed",
  );
  return Object.freeze({
    refundId: data.refundId,
    invoiceId: data.invoiceId,
    paymentId: data.paymentId,
    paymentAmount: data.paymentAmount,
    amount: data.amount,
    currency: data.currency,
    externalReference: data.externalReference,
    status: data.status,
  }) as OfflineFailedRefundTuple;
}

export class BillingRefunds {
  readonly alerts: BillingRefundAlerts;
  readonly history: BillingRefundHistory;
  constructor(
    private database: Database,
    private identity: Identity,
    private store: Store,
    private platform: Platform,
    private billing: Billing,
  ) {
    store.migrate(`
      CREATE TABLE IF NOT EXISTS billing_refund_provider(refund_id TEXT PRIMARY KEY,org_id TEXT NOT NULL,external_ref TEXT NOT NULL,status TEXT NOT NULL,UNIQUE(org_id,external_ref)) STRICT;
      CREATE TABLE IF NOT EXISTS billing_refund_observations(id INTEGER PRIMARY KEY,org_id TEXT NOT NULL,refund_id TEXT NOT NULL,external_ref TEXT NOT NULL,status TEXT NOT NULL,applied INTEGER NOT NULL CHECK(applied IN(0,1)),created_at TEXT NOT NULL) STRICT;
    `);
    this.alerts = new BillingRefundAlerts(database, store, identity, platform);
    this.history = new BillingRefundHistory(database, store, identity, this);
  }
  /** Native Billing facts only. Does not determine Integration/offline eligibility,
   * authenticate historical provider truth, or grant any mutation/transport right. */
  reviewOfflineFailedRefundInTransaction(
    actor: Actor,
    refundId: string,
  ): OfflineFailedRefundReview {
    return this.captureOfflineRefundInTransaction(actor, refundId, "unknown");
  }
  /** Exact retained result selected by original observation/notice identities.
   * Later ignored observations and notice acknowledgements are retained in full.
   * Root must separately join the Platform receipt and Integration provenance;
   * this owning read cannot authenticate evidence, retry, import or release. */
  recoverOfflineFailedRefundInTransaction(
    actor: Actor,
    refundId: string,
    observationId: number,
    noticeSequence: number,
    failed: OfflineFailedRefundTuple,
  ): OfflineFailedRefundRecovery {
    this.database.requireTransaction();
    check(
      typeof refundId === "string" &&
        exactText(refundId, 128) &&
        !refundId.includes("\0") &&
        Buffer.byteLength(refundId) <= 128 &&
        safe(observationId, 1) &&
        safe(noticeSequence, 1),
      "OFFLINE_REFUND_INPUT",
      "Supply the exact retained refund, observation and notice identities.",
      400,
    );
    const captured = captureOfflineFailedRefundTuple(failed);
    const native = this.captureOfflineRefundInTransaction(
      actor,
      refundId,
      "rejected",
    );
    const own = <T extends { refund_id: string }>(rows: readonly T[]) =>
      rows.filter((row) => row.refund_id === refundId);
    const observations = own(native.observations),
      mappings = own(native.providerMappings),
      notices = own(native.notices),
      updates = own(native.noticeUpdates);
    const first = observations[0],
      notice = notices[0];
    check(
      captured.refundId === refundId &&
        canonical(native.intent) ===
          canonical({
            refundId: captured.refundId,
            invoiceId: captured.invoiceId,
            paymentId: captured.paymentId,
            paymentAmount: captured.paymentAmount,
            amount: captured.amount,
            currency: captured.currency,
          }) &&
        first?.id === observationId &&
        first.applied === 1 &&
        first.status === "failed" &&
        first.external_ref === captured.externalReference &&
        observations.slice(1).every((row) => row.applied === 0) &&
        mappings.length === 1 &&
        mappings[0]!.status === "failed" &&
        mappings[0]!.external_ref === captured.externalReference &&
        !own(native.manualProofs).length &&
        notices.length === 1 &&
        notice?.seq === noticeSequence &&
        notice.revision === 1 &&
        notice.status === "failed" &&
        notice.state === "open" &&
        updates.length === 1 &&
        updates[0]!.source === "observation",
      "OFFLINE_REFUND_RECOVERY",
      "Retained Billing result does not match the original failed transition.",
    );
    // Reference collisions can sit outside the selected invoice or have no
    // surviving refund. Return numeric existence only, never unrelated text.
    check(
      !this.store.get(
        `SELECT 1 AS conflict WHERE
        EXISTS(SELECT 1 FROM billing_refund_provider WHERE org_id=? AND external_ref=? AND refund_id<>?) OR
        EXISTS(SELECT 1 FROM billing_refund_observations WHERE org_id=? AND external_ref=? AND refund_id<>?) OR
        EXISTS(SELECT 1 FROM billing_refund_proofs WHERE org_id=? AND external_ref=?)`,
        native.orgId,
        captured.externalReference,
        refundId,
        native.orgId,
        captured.externalReference,
        refundId,
        native.orgId,
        captured.externalReference,
      ),
      "OFFLINE_REFUND_RECOVERY",
      "Retained Billing provider identity has conflicting history.",
    );
    const receipt: OfflineFailedRefundApplicationReceipt = {
      version: 1,
      refundId,
      observationId,
      applied: true,
      state: "rejected",
      status: "failed",
      noticeId: refundId,
      noticeSequence,
      noticeRevision: 1,
      noticeStatus: "failed",
      noticeState: "open",
    };
    const body = {
      version: 1 as const,
      purpose: "billing.offline-failed-refund-result.v1" as const,
      receipt,
      failed: captured,
      native,
    };
    const raw = canonical(body);
    check(
      Buffer.byteLength(raw) <= offlineRefundReviewLimits.bytes,
      "OFFLINE_REFUND_REVIEW_LIMIT",
      "Complete native refund recovery exceeds the byte bound.",
    );
    return frozen({ ...body, factsHash: digest(raw) });
  }
  private captureOfflineRefundInTransaction(
    actor: Actor,
    refundId: string,
    state: "unknown" | "rejected",
  ): OfflineFailedRefundReview {
    this.database.requireTransaction();
    actor = this.history.reader(actor);
    permit(actor, ["finance"]);
    check(
      !actor.accountId,
      "FORBIDDEN",
      "Current finance staff authority is required.",
      403,
    );
    check(
      refundId === text(refundId, "Refund", 128),
      "VALIDATION",
      "Use the exact native refund ID.",
      400,
    );
    // Fixed Billing-owned column sets: no caller SQL/columns or foreign store.
    // Every current retained column returned by this projection is counted,
    // including identity/timestamp fields that will later fail shape validation.
    const columns = {
      invoice:
        "id org_id account_id order_id shipment_id number currency net tax total created_at",
      invoiceLines:
        "id org_id invoice_id product_id description quantity unit_price unit_tax",
      credits:
        "id org_id invoice_id reference number reason net tax total created_at",
      creditLines: "id org_id credit_id invoice_line_id quantity",
      payments: "id org_id invoice_id provider external_ref amount created_at",
      refunds:
        "id org_id invoice_id payment_id amount reference state created_at",
      providerMappings: "refund_id org_id external_ref status",
      observations:
        "id org_id refund_id external_ref status applied created_at",
      manualProofs: "org_id external_ref refund_id created_at",
      notices:
        "seq org_id refund_id invoice_id status state revision created_at updated_at",
      noticeUpdates: "org_id refund_id revision status state source created_at",
      noticeReads: "org_id refund_id actor_id revision acknowledged_at",
    } as const;
    const preflight = (
      set: keyof typeof columns,
      sql: string,
      params: string[],
      used: number,
    ) => {
      // Numeric metadata only, before any retained row reaches JavaScript.
      // Ordering is irrelevant to these complete-set checks; do not sort text
      // merely to count a bounded sentinel. All SQL here is fixed owning code.
      const source = sql.replace(/ ORDER BY [a-z_,]+$/, "");
      // Overflow refuses the entire set, never an apparently complete page.
      const count = this.store.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM (SELECT 1 FROM (${source}) LIMIT ?)`,
        ...params,
        offlineRefundReviewLimits.rowsPerSet + 1,
      )!;
      check(
        safe(count.n) && count.n <= offlineRefundReviewLimits.rowsPerSet,
        "OFFLINE_REFUND_REVIEW_LIMIT",
        "Complete native refund history exceeds the review bound.",
      );
      // CAST AS BLOB counts UTF-8 bytes (including embedded NUL), not Unicode
      // characters. SQLite returns only numeric metadata, never retained text.
      // No JSON function or JavaScript serializer runs to measure these bytes.
      const rowBytes = columns[set]
        .split(" ")
        .map((column) => `COALESCE(length(CAST(${column} AS BLOB)),0)`)
        .join("+");
      const sizes = this.store.get<{ total: number; largest: number }>(
        `SELECT COALESCE(SUM(${rowBytes}),0) AS total, COALESCE(MAX(${rowBytes}),0) AS largest FROM (${source})`,
        ...params,
      )!;
      check(
        safe(sizes.total) &&
          safe(sizes.largest) &&
          sizes.largest <= offlineRefundReviewLimits.bytes &&
          sizes.total <= offlineRefundReviewLimits.bytes - used,
        "OFFLINE_REFUND_REVIEW_LIMIT",
        "Complete native refund facts exceed the byte bound.",
      );
      return sizes.total;
    };
    // get()/intent() use native invoice and original-payment readers. Preflight
    // their full rows first using only the exact scoped caller ID as a parameter.
    // The scalar checks are a separate budget because collections below repeat
    // these rows; the final canonical body check still includes every duplicate.
    const target = "SELECT * FROM billing_refunds WHERE org_id=? AND id=?";
    const targetParams = [actor.orgId, refundId];
    let scalarBytes = preflight("refunds", target, targetParams, 0);
    const invoiceScope = `SELECT invoice_id FROM (${target})`;
    scalarBytes += preflight(
      "invoice",
      `SELECT * FROM billing_invoices WHERE org_id=? AND id IN (${invoiceScope})`,
      [actor.orgId, ...targetParams],
      scalarBytes,
    );
    preflight(
      "payments",
      `SELECT * FROM billing_payments WHERE org_id=? AND id IN (SELECT payment_id FROM (${target})) AND invoice_id IN (${invoiceScope})`,
      [actor.orgId, ...targetParams, ...targetParams],
      scalarBytes,
    );
    // Imported snapshots are unsupported; do not materialize their source text
    // through billing.invoice() merely to reject them afterward.
    reviewAssert(
      !this.store.get(
        `SELECT 1 FROM billing_opening_documents WHERE invoice_id IN (${invoiceScope})`,
        ...targetParams,
      ),
    );
    const { row, invoice: scopedInvoice } = this.get(actor, refundId);
    const intent = this.intent(actor, refundId);
    const org = this.identity.organization(actor);
    const customer = this.identity.customer(actor, scopedInvoice.account_id);
    reviewAssert(
      row.state === state &&
        customer.org_id === org.id &&
        customer.currency === org.currency &&
        scopedInvoice.currency === org.currency,
    );
    let bytes = 0,
      retainedBytes = 0;
    const bounded = <T extends Row>(
      set: keyof typeof columns,
      sql: string,
      ...params: string[]
    ): T[] => {
      retainedBytes += preflight(set, sql, params, retainedBytes);
      const rows = this.store.all<T>(sql, ...params);
      // Exact canonical checks additionally cover key/punctuation overhead and
      // escaping. Retained text has already passed the numeric SQL preflight.
      bytes += Buffer.byteLength(canonical(rows));
      check(
        bytes <= offlineRefundReviewLimits.bytes,
        "OFFLINE_REFUND_REVIEW_LIMIT",
        "Complete native refund facts exceed the byte bound.",
      );
      return rows;
    };
    const invoice = bounded<NativeInvoice>(
      "invoice",
      "SELECT * FROM billing_invoices WHERE id=?",
      scopedInvoice.id,
    )[0]!;
    const invoiceLines = bounded<NativeLine>(
      "invoiceLines",
      "SELECT * FROM billing_lines WHERE invoice_id=? ORDER BY id",
      invoice.id,
    );
    const credits = bounded<NativeCredit>(
      "credits",
      "SELECT * FROM billing_credits WHERE invoice_id=? ORDER BY id",
      invoice.id,
    );
    const creditLines = bounded<NativeCreditLine>(
      "creditLines",
      "SELECT * FROM billing_credit_lines WHERE credit_id IN (SELECT id FROM billing_credits WHERE invoice_id=?) OR invoice_line_id IN (SELECT id FROM billing_lines WHERE invoice_id=?) ORDER BY id",
      invoice.id,
      invoice.id,
    );
    const payments = bounded<RecordedPayment>(
      "payments",
      "SELECT * FROM billing_payments WHERE invoice_id=? OR id=? ORDER BY id",
      invoice.id,
      String(row.payment_id),
    );
    const refunds = bounded<NativeRefund>(
      "refunds",
      "SELECT * FROM billing_refunds WHERE invoice_id=? OR payment_id IN (SELECT id FROM billing_payments WHERE invoice_id=?) ORDER BY id",
      invoice.id,
      invoice.id,
    );
    const refund = refunds.find((r) => r.id === refundId)!;
    const originalPayment = payments.find((p) => p.id === refund?.payment_id)!;
    reviewAssert(
      refund &&
        originalPayment &&
        originalPayment.provider === "stripe" &&
        /^pi_[a-zA-Z0-9_]+$/.test(originalPayment.external_ref),
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
          exactText(line.description, 2000) &&
          safe(line.quantity, 1) &&
          line.quantity <= 100000 &&
          safe(line.unit_price) &&
          safe(line.unit_tax),
      );
    reviewAssert(
      sum(invoiceLines.map((l) => l.quantity * l.unit_price)) === invoice.net &&
        sum(invoiceLines.map((l) => l.quantity * l.unit_tax)) === invoice.tax,
    );
    reviewAssert(
      !this.store.get(
        "SELECT 1 FROM billing_opening_lines WHERE invoice_id=? OR line_id IN (SELECT id FROM billing_lines WHERE invoice_id=?)",
        invoice.id,
        invoice.id,
      ),
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
          exactText(c.reason, 1000) &&
          exactTime(c.created_at) &&
          c.created_at >= invoice.created_at &&
          [c.net, c.tax, c.total].every((v) => safe(v)),
      );
      const linked = creditLines.filter((l) => l.credit_id === c.id);
      reviewAssert(
        new Set(linked.map((l) => l.invoice_line_id)).size === linked.length,
      );
      this.billing.recordedCredit(actor, c.id); // Existing original-line/amount invariant.
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
    reviewAssert(
      canonical(this.billing.recordedPayment(actor, originalPayment.id)) ===
        canonical(originalPayment),
    );
    reviewAssert(
      canonical(intent) ===
        canonical({
          refundId: refund.id,
          invoiceId: invoice.id,
          paymentId: originalPayment.external_ref,
          paymentAmount: originalPayment.amount,
          amount: refund.amount,
          currency: invoice.currency.toLowerCase(),
        }),
    );
    const marks = refunds.map(() => "?").join(","),
      ids = refunds.map((r) => r.id);
    const providerMappings = bounded<RefundProvider>(
      "providerMappings",
      `SELECT * FROM billing_refund_provider WHERE refund_id IN (${marks}) ORDER BY refund_id`,
      ...ids,
    );
    const observations = bounded<RefundObservation>(
      "observations",
      `SELECT * FROM billing_refund_observations WHERE refund_id IN (${marks}) ORDER BY id`,
      ...ids,
    );
    const manualProofs = bounded<RefundProof>(
      "manualProofs",
      `SELECT * FROM billing_refund_proofs WHERE refund_id IN (${marks}) ORDER BY refund_id`,
      ...ids,
    );
    const notices = bounded<RefundNotice>(
      "notices",
      `SELECT * FROM billing_refund_alerts WHERE refund_id IN (${marks}) ORDER BY seq`,
      ...ids,
    );
    const noticeUpdates = bounded<RefundNoticeUpdate>(
      "noticeUpdates",
      `SELECT * FROM billing_refund_alert_updates WHERE refund_id IN (${marks}) ORDER BY refund_id,revision`,
      ...ids,
    );
    const noticeReads = bounded<RefundNoticeRead>(
      "noticeReads",
      `SELECT * FROM billing_refund_alert_reads WHERE refund_id IN (${marks}) ORDER BY refund_id,actor_id`,
      ...ids,
    );
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
    const totals = this.billing.totals(actor, invoice.id);
    const credited = sum(credits.map((c) => c.total)),
      paid = sum(payments.map((p) => p.amount)),
      refunded = sum(
        refunds.filter((r) => r.state === "completed").map((r) => r.amount),
      ),
      pendingReservations = sum(
        refunds
          .filter((r) => ["pending", "unknown"].includes(r.state))
          .map((r) => r.amount),
      );
    const balance = invoice.total - credited - paid + refunded;
    reviewAssert(
      Number.isSafeInteger(balance) &&
        canonical(totals) ===
          canonical({ credited, paid, refunded, balance }) &&
        -balance >= pendingReservations,
    );
    for (const p of payments)
      reviewAssert(
        sum(
          refunds
            .filter((r) => r.payment_id === p.id && r.state !== "rejected")
            .map((r) => r.amount),
        ) <= p.amount,
      );
    const originalPaymentReserved = sum(
      refunds
        .filter(
          (r) => r.payment_id === originalPayment.id && r.state !== "rejected",
        )
        .map((r) => r.amount),
    );
    const body = {
      version: 1 as const,
      orgId: org.id,
      region: org.region,
      currency: org.currency,
      refund,
      invoice,
      originalPayment,
      intent,
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
      capacity: {
        ...totals,
        pendingReservations,
        invoiceAvailable: -balance - pendingReservations,
        originalPaymentReserved,
        originalPaymentAvailable:
          originalPayment.amount - originalPaymentReserved,
      },
    };
    const raw = canonical(body);
    check(
      Buffer.byteLength(raw) <= offlineRefundReviewLimits.bytes,
      "OFFLINE_REFUND_REVIEW_LIMIT",
      "Complete native refund facts exceed the byte bound.",
    );
    return frozen({ ...body, factsHash: digest(raw) });
  }

  /** Trusted internal prerequisite only. Root must independently qualify evidence,
   * approvals, source/candidate fences and commit-spanning authority. A hash is
   * consistency, never authority. No public route or replay contract is supplied. */
  applyOfflineFailedRefundInTransaction(
    actor: Actor,
    refundId: string,
    expectedFactsHash: string,
    failed: OfflineFailedRefundTuple,
  ): OfflineFailedRefundApplicationReceipt {
    this.database.requireTransaction();
    const captured = captureOfflineFailedRefundTuple(failed);
    check(
      typeof refundId === "string" &&
        refundId.length > 0 &&
        refundId.length <= 128 &&
        refundId.trim() === refundId &&
        !refundId.includes("\0") &&
        Buffer.byteLength(refundId) <= 128 &&
        typeof expectedFactsHash === "string" &&
        /^[a-f0-9]{64}$/.test(expectedFactsHash),
      "OFFLINE_REFUND_INPUT",
      "Supply the exact refund ID and native review hash.",
      400,
    );
    actor = this.history.reader(actor);
    permit(actor, ["finance"]);
    check(
      !actor.accountId,
      "FORBIDDEN",
      "Current finance staff authority is required.",
      403,
    );
    const reviewed = this.reviewOfflineFailedRefundInTransaction(
      actor,
      refundId,
    );
    check(
      reviewed.factsHash === expectedFactsHash,
      "OFFLINE_REFUND_STALE",
      "Native refund review changed.",
    );
    check(
      captured.refundId === refundId &&
        captured.invoiceId === reviewed.intent.invoiceId &&
        captured.paymentId === reviewed.intent.paymentId &&
        captured.paymentAmount === reviewed.intent.paymentAmount &&
        captured.amount === reviewed.intent.amount &&
        captured.currency === reviewed.intent.currency,
      "REFUND_MISMATCH",
      "Failed refund tuple differs from current native intent.",
    );
    check(
      reviewed.refund.state === "unknown" &&
        [
          reviewed.providerMappings,
          reviewed.observations,
          reviewed.manualProofs,
          reviewed.notices,
          reviewed.noticeUpdates,
          reviewed.noticeReads,
        ].every((rows) => !rows.some((row) => row.refund_id === refundId)),
      "OFFLINE_REFUND_HISTORY",
      "Only the first unobserved unknown refund is supported.",
    );
    // Count/existence only, including orphan observations/proofs outside the
    // selected invoice. Native provider-reference uniqueness is organization scoped.
    check(
      !this.store.get(
        `SELECT 1 AS conflict WHERE
       EXISTS(SELECT 1 FROM billing_refund_provider WHERE org_id=? AND external_ref=?) OR
       EXISTS(SELECT 1 FROM billing_refund_observations WHERE org_id=? AND external_ref=?) OR
       EXISTS(SELECT 1 FROM billing_refund_proofs WHERE org_id=? AND external_ref=?)`,
        actor.orgId,
        captured.externalReference,
        actor.orgId,
        captured.externalReference,
        actor.orgId,
        captured.externalReference,
      ),
      "REFUND_MISMATCH",
      "Provider refund identity already has retained native history.",
    );
    // The caller owns this actual writer transaction and must propagate every
    // failure to Database.transaction. Owner-issued savepoints are forbidden;
    // swallowing an error and committing partial owner work is unsupported.
    const status = this.observe(
      actor,
      reviewed.intent,
      captured.externalReference,
      captured,
    );
    const counts = this.store.get<{
      observations: number;
      providers: number;
      proofs: number;
      notices: number;
      updates: number;
      reads: number;
    }>(
      `SELECT
        (SELECT count(*) FROM billing_refund_observations WHERE refund_id=?) AS observations,
        (SELECT count(*) FROM billing_refund_provider WHERE refund_id=?) AS providers,
        (SELECT count(*) FROM billing_refund_proofs WHERE refund_id=?) AS proofs,
        (SELECT count(*) FROM billing_refund_alerts WHERE refund_id=?) AS notices,
        (SELECT count(*) FROM billing_refund_alert_updates WHERE refund_id=?) AS updates,
        (SELECT count(*) FROM billing_refund_alert_reads WHERE refund_id=?) AS reads`,
      refundId,
      refundId,
      refundId,
      refundId,
      refundId,
      refundId,
    )!;
    check(
      status === "failed" &&
        counts.observations === 1 &&
        counts.providers === 1 &&
        counts.proofs === 0 &&
        counts.notices === 1 &&
        counts.updates === 1 &&
        counts.reads === 0,
      "OFFLINE_REFUND_APPLICATION",
      "Native failed refund result is absent or ambiguous.",
    );
    // Exact sole row identities after proven zero -> one transition. Never a
    // MAX(id), newest observation, guessed revision or caller timestamp.
    const observation = this.store.get<{ id: number }>(
      "SELECT id FROM billing_refund_observations WHERE refund_id=? AND org_id=? AND external_ref=? AND status='failed' AND applied=1",
      refundId,
      actor.orgId,
      captured.externalReference,
    );
    const notice = this.store.get<{ seq: number; revision: number }>(
      "SELECT seq,revision FROM billing_refund_alerts WHERE refund_id=? AND org_id=? AND invoice_id=? AND status='failed' AND state='open' AND revision=1",
      refundId,
      actor.orgId,
      reviewed.intent.invoiceId,
    );
    check(
      observation &&
        safe(observation.id, 1) &&
        notice &&
        safe(notice.seq, 1) &&
        this.store.get(
          "SELECT 1 FROM billing_refund_alert_updates WHERE refund_id=? AND org_id=? AND revision=1 AND status='failed' AND state='open' AND source='observation'",
          refundId,
          actor.orgId,
        ) &&
        this.store.get(
          "SELECT 1 FROM billing_refund_provider WHERE refund_id=? AND org_id=? AND external_ref=? AND status='failed'",
          refundId,
          actor.orgId,
          captured.externalReference,
        ) &&
        this.store.get(
          "SELECT 1 FROM billing_refunds WHERE id=? AND org_id=? AND state='rejected'",
          refundId,
          actor.orgId,
        ),
      "OFFLINE_REFUND_APPLICATION",
      "Native failed refund identities do not match the transition.",
    );
    const receipt: OfflineFailedRefundApplicationReceipt = Object.freeze({
      version: 1,
      refundId,
      observationId: observation.id,
      applied: true,
      state: "rejected",
      status: "failed",
      noticeId: refundId,
      noticeSequence: notice.seq,
      noticeRevision: 1,
      noticeStatus: "failed",
      noticeState: "open",
    });
    return receipt;
  }

  get(actor: Actor, refundId: string) {
    const row = this.store.get(
      "SELECT * FROM billing_refunds WHERE org_id=? AND id=?",
      actor.orgId,
      refundId,
    );
    check(row, "NOT_FOUND", "Refund not found.", 404);
    const invoice = this.billing.invoice(actor, String(row.invoice_id));
    const payment = this.store.get(
      "SELECT * FROM billing_payments WHERE org_id=? AND id=? AND invoice_id=?",
      actor.orgId,
      String(row.payment_id),
      invoice.id,
    );
    check(payment, "NOT_FOUND", "Original payment not found.", 404);
    return { row, invoice, payment };
  }
  intent(actor: Actor, refundId: string): RefundIntent {
    permit(actor, ["finance"]);
    const { row, invoice, payment } = this.get(actor, refundId);
    check(
      payment.provider === "stripe" &&
        /^pi_/.test(String(payment.external_ref)),
      "STATE",
      "Refund requires a verified Stripe payment.",
    );
    return {
      refundId,
      invoiceId: invoice.id,
      paymentId: String(payment.external_ref),
      paymentAmount: Number(payment.amount),
      amount: Number(row.amount),
      currency: invoice.currency.toLowerCase(),
    };
  }
  accountingFact(actor: Actor, refundId: string): AccountingRefundFact {
    permit(actor, ["finance", "support"]);
    const { row, invoice } = this.get(actor, refundId);
    const proof = this.store.get(
        "SELECT external_ref FROM billing_refund_proofs WHERE org_id=? AND refund_id=?",
        actor.orgId,
        refundId,
      ),
      provider = this.store.get(
        "SELECT external_ref FROM billing_refund_provider WHERE org_id=? AND refund_id=?",
        actor.orgId,
        refundId,
      );
    return {
      id: refundId,
      invoiceId: invoice.id,
      paymentId: String(row.payment_id),
      amount: Number(row.amount),
      currency: invoice.currency,
      state: String(row.state),
      cashReference: proof
        ? String(proof.external_ref)
        : provider
          ? String(provider.external_ref)
          : null,
    };
  }
  markUnknown(actor: Actor, refundId: string) {
    const { row } = this.get(actor, refundId);
    check(
      row.state === "pending",
      "STATE",
      "Only pending refunds may be sent.",
    );
    this.store.run(
      "UPDATE billing_refunds SET state='unknown' WHERE org_id=? AND id=?",
      actor.orgId,
      refundId,
    );
  }
  assertReadyToSend(actor: Actor, intent: RefundIntent) {
    check(
      canonical(this.intent(actor, intent.refundId)) === canonical(intent),
      "REFUND_MISMATCH",
      "Native refund intent changed.",
    );
    const { row } = this.get(actor, intent.refundId);
    check(
      row.state === "unknown" &&
        !this.store.get(
          "SELECT refund_id FROM billing_refund_provider WHERE org_id=? AND refund_id=?",
          actor.orgId,
          intent.refundId,
        ),
      "STATE",
      "Refund is no longer awaiting its first send.",
    );
  }
  observe(
    actor: Actor,
    intent: RefundIntent,
    reference: string,
    result: Record<string, unknown>,
  ) {
    permit(actor, ["finance"]);
    check(
      canonical(this.intent(actor, intent.refundId)) === canonical(intent),
      "REFUND_MISMATCH",
      "Native refund intent changed.",
    );
    check(
      /^re_[a-zA-Z0-9_]+$/.test(reference) &&
        result.refundId === intent.refundId &&
        result.paymentId === intent.paymentId &&
        result.amount === intent.amount &&
        result.currency === intent.currency &&
        refundStatuses.includes(result.status as RefundStatus),
      "REFUND_MISMATCH",
      "Provider refund identity, amount or currency differs from the intent.",
    );
    const old = this.store.get(
      "SELECT * FROM billing_refund_provider WHERE org_id=? AND refund_id=?",
      actor.orgId,
      intent.refundId,
    );
    check(
      !old || old.external_ref === reference,
      "REFUND_MISMATCH",
      "Provider refund identity changed.",
    );
    const bound = this.store.get(
      "SELECT refund_id FROM billing_refund_provider WHERE org_id=? AND external_ref=?",
      actor.orgId,
      reference,
    );
    check(
      !bound || bound.refund_id === intent.refundId,
      "REFUND_MISMATCH",
      "Provider refund is already bound to another request.",
    );
    const status = result.status as RefundStatus;
    // Failed/canceled observations are terminal. Pending observations cannot undo success;
    // a later bank failure or returned transfer requiring action can undo success with history retained.
    const applied =
      !old ||
      (old.status !== "failed" &&
        old.status !== "canceled" &&
        (old.status !== "succeeded" ||
          status === "failed" ||
          status === "canceled" ||
          status === "requires_action" ||
          status === "succeeded"));
    this.store.run(
      "INSERT INTO billing_refund_observations(org_id,refund_id,external_ref,status,applied,created_at) VALUES(?,?,?,?,?,?)",
      actor.orgId,
      intent.refundId,
      reference,
      status,
      applied ? 1 : 0,
      now(),
    );
    if (applied) {
      this.store.run(
        "INSERT INTO billing_refund_provider VALUES(?,?,?,?) ON CONFLICT(refund_id) DO UPDATE SET status=excluded.status",
        intent.refundId,
        actor.orgId,
        reference,
        status,
      );
      this.store.run(
        "UPDATE billing_refunds SET state=? WHERE org_id=? AND id=?",
        status === "succeeded"
          ? "completed"
          : status === "failed" || status === "canceled"
            ? "rejected"
            : "unknown",
        actor.orgId,
        intent.refundId,
      );
    }
    if (applied)
      this.alerts.observe(actor, intent.refundId, intent.invoiceId, status);
    this.platform.audit(actor, "billing.refund.observed", intent.refundId, {
      reference,
      status,
      applied,
    });
    return this.store.get(
      "SELECT status FROM billing_refund_provider WHERE refund_id=?",
      intent.refundId,
    )!.status as RefundStatus;
  }
  list(actor: Actor) {
    return this.database.transaction(() => {
      actor = this.history.reader(actor);
      return this.store
        .all<RefundRow>(
          "SELECT r.*,p.provider,b.external_ref AS provider_reference,b.status AS provider_status FROM billing_refunds r JOIN billing_payments p ON p.id=r.payment_id AND p.org_id=r.org_id LEFT JOIN billing_refund_provider b ON b.refund_id=r.id WHERE r.org_id=? ORDER BY r.created_at DESC,r.id",
          actor.orgId,
        )
        .map((row) => {
          this.get(actor, String(row.id));
          return {
            ...row,
            observations: this.store.all(
              "SELECT status,applied,created_at FROM billing_refund_observations WHERE org_id=? AND refund_id=? ORDER BY id",
              actor.orgId,
              String(row.id),
            ),
          };
        });
    });
  }
  payments(actor: Actor) {
    return this.billing.paymentHistory.list(actor);
  }
}
