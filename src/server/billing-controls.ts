import { permit, type Actor } from "./core.ts";
import type { Store } from "./database.ts";
import { IssueCollector } from "./control-issues.ts";
import type { BillingControls } from "../shared/reconciliation.ts";
type Amounts = { net: bigint; tax: bigint };
type Invoice = Amounts & {
  total: bigint;
  lineNet: bigint;
  lineTax: bigint;
  lines: number;
  currency: string;
  credited: bigint;
  paid: bigint;
  refunded: bigint;
  historicalCredit: bigint;
  openingBalance: bigint | null;
  openingPaid: bigint;
  openingRefunded: bigint;
  historicalLineCredit: bigint;
  pending: bigint;
};
// Native documents are the control ledger, not provider callbacks or cached PDFs.
// The caller supplies one authorized snapshot across both owning modules.
export function billingControls(
  store: Store,
  actor: Actor,
  currency: string,
): BillingControls {
  permit(actor, ["finance"]);
  const issues = new IssueCollector(),
    invoices = new Map<string, Invoice>(),
    lines = new Map<
      string,
      Amounts & { invoice: string; quantity: bigint; credited: bigint }
    >(),
    credits = new Map<
      string,
      Amounts & {
        invoice: string;
        total: bigint;
        lineNet: bigint;
        lineTax: bigint;
        lines: number;
      }
    >(),
    payments = new Map<
      string,
      { invoice: string; amount: bigint; held: bigint }
    >();
  const exact = (value: string, id: string) => {
    const n = BigInt(value);
    if (
      n > BigInt(Number.MAX_SAFE_INTEGER) ||
      n < -BigInt(Number.MAX_SAFE_INTEGER)
    )
      issues.add("UNSAFE_BILLING_INTEGER", id);
    return n;
  };
  store.visit<{
    id: string;
    currency: string;
    net: string;
    tax: string;
    total: string;
    credited: string;
    paid: string;
    refunded: string;
    balance: string | null;
  }>(
    `SELECT i.id,i.currency,CAST(i.net AS TEXT) AS net,CAST(i.tax AS TEXT) AS tax,CAST(i.total AS TEXT) AS total,
     CAST(COALESCE(o.credited,0) AS TEXT) AS credited,CAST(COALESCE(o.paid,0) AS TEXT) AS paid,CAST(COALESCE(o.refunded,0) AS TEXT) AS refunded,CAST(o.balance AS TEXT) AS balance
     FROM billing_invoices i LEFT JOIN billing_opening_documents o ON o.org_id=i.org_id AND o.invoice_id=i.id WHERE i.org_id=? ORDER BY i.rowid`,
    [actor.orgId],
    (r) => {
      const net = exact(r.net, r.id),
        tax = exact(r.tax, r.id),
        total = exact(r.total, r.id),
        credited = exact(r.credited, r.id),
        paid = exact(r.paid, r.id),
        refunded = exact(r.refunded, r.id);
      invoices.set(r.id, {
        net,
        tax,
        total,
        currency: r.currency,
        lineNet: 0n,
        lineTax: 0n,
        lines: 0,
        credited,
        paid,
        refunded,
        historicalCredit: credited,
        openingPaid: paid,
        openingRefunded: refunded,
        openingBalance: r.balance === null ? null : exact(r.balance, r.id),
        historicalLineCredit: 0n,
        pending: 0n,
      });
      issues.compare("INVOICE_ARITHMETIC", r.id, net + tax, total);
      if (r.currency !== currency)
        issues.add("INVOICE_CURRENCY", r.id, currency, r.currency);
    },
  );
  store.visit<{
    id: string;
    invoice: string;
    quantity: string;
    price: string;
    tax: string;
    historical: string;
  }>(
    `SELECT l.id,l.invoice_id AS invoice,CAST(l.quantity AS TEXT) AS quantity,CAST(l.unit_price AS TEXT) AS price,CAST(l.unit_tax AS TEXT) AS tax,CAST(COALESCE(o.credited_quantity,0) AS TEXT) AS historical
     FROM billing_lines l LEFT JOIN billing_opening_lines o ON o.org_id=l.org_id AND o.invoice_id=l.invoice_id AND o.line_id=l.id WHERE l.org_id=? ORDER BY l.rowid`,
    [actor.orgId],
    (r) => {
      const quantity = exact(r.quantity, r.id),
        net = exact(r.price, r.id),
        tax = exact(r.tax, r.id),
        historical = exact(r.historical, r.id),
        invoice = invoices.get(r.invoice);
      lines.set(r.id, {
        invoice: r.invoice,
        quantity,
        net,
        tax,
        credited: historical,
      });
      if (!invoice) issues.add("ORPHAN_INVOICE_LINE", r.id);
      else {
        invoice.lines++;
        invoice.lineNet += quantity * net;
        invoice.lineTax += quantity * tax;
        invoice.historicalLineCredit += historical * (net + tax);
      }
      if (historical > 0n && invoice?.openingBalance === null)
        issues.add("UNEXPECTED_OPENING_LINE", r.id);
    },
  );
  store.visit<{
    id: string;
    invoice: string;
    net: string;
    tax: string;
    total: string;
  }>(
    "SELECT id,invoice_id AS invoice,CAST(net AS TEXT) AS net,CAST(tax AS TEXT) AS tax,CAST(total AS TEXT) AS total FROM billing_credits WHERE org_id=? ORDER BY rowid",
    [actor.orgId],
    (r) => {
      const net = exact(r.net, r.id),
        tax = exact(r.tax, r.id),
        total = exact(r.total, r.id),
        invoice = invoices.get(r.invoice);
      credits.set(r.id, {
        invoice: r.invoice,
        net,
        tax,
        total,
        lineNet: 0n,
        lineTax: 0n,
        lines: 0,
      });
      if (!invoice) issues.add("ORPHAN_CREDIT", r.id);
      else invoice.credited += total;
      issues.compare("CREDIT_ARITHMETIC", r.id, net + tax, total);
    },
  );
  store.visit<{ id: string; credit: string; line: string; quantity: string }>(
    "SELECT id,credit_id AS credit,invoice_line_id AS line,CAST(quantity AS TEXT) AS quantity FROM billing_credit_lines WHERE org_id=? ORDER BY rowid",
    [actor.orgId],
    (r) => {
      const quantity = exact(r.quantity, r.id),
        credit = credits.get(r.credit),
        line = lines.get(r.line);
      if (!credit || !line || credit.invoice !== line.invoice)
        issues.add("CREDIT_LINE_ORIGIN", r.id);
      else {
        credit.lines++;
        credit.lineNet += quantity * line.net;
        credit.lineTax += quantity * line.tax;
        line.credited += quantity;
      }
    },
  );
  store.visit<{ id: string; invoice: string; amount: string }>(
    "SELECT id,invoice_id AS invoice,CAST(amount AS TEXT) AS amount FROM billing_payments WHERE org_id=? ORDER BY rowid",
    [actor.orgId],
    (r) => {
      const amount = exact(r.amount, r.id),
        invoice = invoices.get(r.invoice);
      payments.set(r.id, { invoice: r.invoice, amount, held: 0n });
      if (!invoice) issues.add("ORPHAN_PAYMENT", r.id);
      else invoice.paid += amount;
    },
  );
  let refunds = 0,
    pendingRefunds = 0n,
    uncertainRefunds = 0n;
  store.visit<{
    id: string;
    invoice: string;
    payment: string;
    amount: string;
    state: string;
  }>(
    "SELECT id,invoice_id AS invoice,payment_id AS payment,CAST(amount AS TEXT) AS amount,state FROM billing_refunds WHERE org_id=? ORDER BY rowid",
    [actor.orgId],
    (r) => {
      refunds++;
      const amount = exact(r.amount, r.id),
        invoice = invoices.get(r.invoice),
        payment = payments.get(r.payment);
      if (!invoice || !payment || payment.invoice !== r.invoice)
        issues.add("REFUND_ORIGIN", r.id);
      if (payment && r.state !== "rejected") payment.held += amount;
      if (invoice && r.state === "completed") invoice.refunded += amount;
      if (invoice && ["pending", "unknown"].includes(r.state))
        invoice.pending += amount;
      if (invoice?.currency === currency && r.state === "pending")
        pendingRefunds += amount;
      if (invoice?.currency === currency && r.state === "unknown")
        uncertainRefunds += amount;
    },
  );
  let total = 0n,
    credited = 0n,
    paid = 0n,
    refunded = 0n,
    balance = 0n;
  for (const [id, i] of invoices) {
    if (!i.lines) issues.add("MISSING_INVOICE_LINES", id);
    issues.compare("INVOICE_NET", id, i.lineNet, i.net);
    issues.compare("INVOICE_TAX", id, i.lineTax, i.tax);
    if (i.openingBalance !== null) {
      issues.compare(
        "OPENING_CREDIT",
        id,
        i.historicalLineCredit,
        i.historicalCredit,
      );
      issues.compare(
        "OPENING_BALANCE",
        id,
        i.total - i.historicalCredit - i.openingPaid + i.openingRefunded,
        i.openingBalance,
      );
      if (i.openingRefunded > i.openingPaid)
        issues.add(
          "OPENING_REFUND_CAPACITY",
          id,
          i.openingPaid,
          i.openingRefunded,
        );
    }
    if (i.credited > i.total)
      issues.add("INVOICE_CREDIT_CAPACITY", id, i.total, i.credited);
    // Historical opening refunds are independent imported facts. Native completed
    // refunds must fit cash entitlement after those retained historical refunds.
    const nativeCompleted = i.refunded - i.openingRefunded,
      entitlement = i.paid - i.total + i.credited - i.openingRefunded;
    if (nativeCompleted > (entitlement > 0n ? entitlement : 0n))
      issues.add(
        "INVOICE_COMPLETED_REFUND_CAPACITY",
        id,
        entitlement > 0n ? entitlement : 0n,
        nativeCompleted,
      );
    const available = i.paid - i.total + i.credited - i.refunded;
    if (i.pending > (available > 0n ? available : 0n))
      issues.add(
        "INVOICE_REFUND_CAPACITY",
        id,
        available > 0n ? available : 0n,
        i.pending,
      );
    // Mixed currency is reported and never summed into the regional money totals.
    if (i.currency === currency) {
      total += i.total;
      credited += i.credited;
      paid += i.paid;
      refunded += i.refunded;
      balance += i.total - i.credited - i.paid + i.refunded;
    }
  }
  for (const [id, c] of credits) {
    if (!c.lines) issues.add("MISSING_CREDIT_LINES", id);
    issues.compare("CREDIT_NET", id, c.lineNet, c.net);
    issues.compare("CREDIT_TAX", id, c.lineTax, c.tax);
  }
  for (const [id, l] of lines)
    if (l.credited > l.quantity)
      issues.add("LINE_CREDIT_CAPACITY", id, l.quantity, l.credited);
  for (const [id, p] of payments)
    if (p.held > p.amount)
      issues.add("PAYMENT_REFUND_CAPACITY", id, p.amount, p.held);
  // Detect detached opening evidence even when no parent enters the maps.
  for (const [table, column, parent, code] of [
    [
      "billing_opening_documents",
      "invoice_id",
      "billing_invoices",
      "ORPHAN_OPENING_DOCUMENT",
    ],
    [
      "billing_opening_lines",
      "line_id",
      "billing_lines",
      "ORPHAN_OPENING_LINE",
    ],
  ])
    store.visit<{ id: string }>(
      `SELECT o.${column} AS id FROM ${table} o LEFT JOIN ${parent} p ON p.org_id=o.org_id AND p.id=o.${column} WHERE o.org_id=? AND p.id IS NULL ORDER BY o.rowid`,
      [actor.orgId],
      (r) => issues.add(code!, r.id),
    );
  store.visit<{ id: string }>(
    `SELECT o.line_id AS id FROM billing_opening_lines o JOIN billing_lines l ON l.org_id=o.org_id AND l.id=o.line_id WHERE o.org_id=? AND o.invoice_id<>l.invoice_id ORDER BY o.rowid`,
    [actor.orgId],
    (r) => issues.add("OPENING_LINE_ORIGIN", r.id),
  );
  return {
    invoices: invoices.size,
    credits: credits.size,
    payments: payments.size,
    refunds,
    total: String(total),
    credited: String(credited),
    paid: String(paid),
    refunded: String(refunded),
    balance: String(balance),
    pendingRefunds: String(pendingRefunds),
    uncertainRefunds: String(uncertainRefunds),
    issues: issues.result(),
  };
}
