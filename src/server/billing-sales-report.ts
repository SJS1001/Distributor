import { check, permit, text, type Actor } from "./core.ts";
import type { Database, Store } from "./database.ts";
import type { Identity } from "./iam.ts";
import type {
  SalesReport,
  SalesReportEntry,
  SalesReportFilter,
  SalesTotals,
} from "../shared/billing-sales-report.ts";

const dateMs = (value: string) => {
  check(
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value),
    "VALIDATION",
    "Use a calendar date in YYYY-MM-DD format.",
    400,
  );
  const ms = Date.parse(value + "T00:00:00.000Z");
  check(
    Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value,
    "VALIDATION",
    "Choose a valid calendar date.",
    400,
  );
  return ms;
};
const safe = (value: number) => {
  check(
    Number.isSafeInteger(value),
    "REPORT_RANGE",
    "Report amounts exceed the supported exact integer range; choose a shorter period or one customer.",
    409,
  );
  return value;
};
const add = (a: number, b: number) => safe(a + b);
const amount = (qty: number, unit: number) => safe(safe(qty) * safe(unit));
const emptyTotals = (currency: string): SalesTotals => ({
  currency,
  invoiceCount: 0,
  productQuantity: 0,
  productNet: 0,
  shippingNet: 0,
  invoiceTax: 0,
  invoiceTotal: 0,
  creditCount: 0,
  creditedProductQuantity: 0,
  productCredits: 0,
  shippingCredits: 0,
  creditTax: 0,
  creditTotal: 0,
  netSales: 0,
  netTax: 0,
  netTotal: 0,
  payments: 0,
  refundsCompleted: 0,
  refundsPending: 0,
  refundsUnknown: 0,
});
type DocumentRow = {
  id: string;
  invoice_id: string;
  account_id: string;
  invoice_number: string;
  currency: string;
  net: number;
  tax: number;
  total: number;
  created_at: string;
  reason: string;
};
type LineRow = {
  id: string;
  invoice_id: string;
  document_id: string;
  product_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  unit_tax: number;
  shipping: number;
};
type CashRow = {
  id: string;
  invoice_id: string;
  account_id: string;
  invoice_number: string;
  currency: string;
  amount: number;
  created_at: string;
  state: NonNullable<SalesReportEntry["refundState"]>;
  opening: number;
};

/** Billing-owned facts: today's catalog and payment joins never price a past sale. */
export class BillingSalesReport {
  constructor(
    private database: Database,
    private store: Store,
    private identity: Identity,
  ) {}
  read(actor: Actor, filter: SalesReportFilter): SalesReport {
    return this.database.transaction(() => {
      actor = this.identity.currentActor(actor);
      permit(actor, ["commercial", "finance", "support", "warranty", "buyer"]);
      check(
        !this.identity.security(actor).passwordChangeRequired,
        "PASSWORD_CHANGE_REQUIRED",
        "Change your password before accessing billing.",
        403,
      );
      const start = dateMs(filter.from),
        end = dateMs(filter.to);
      check(
        end >= start && (end - start) / 86400000 < 366,
        "VALIDATION",
        "Choose an ordered date range of at most 366 inclusive days.",
        400,
      );
      const accountId =
        actor.role === "buyer" ? actor.accountId! : (filter.accountId ?? null);
      if (filter.accountId !== undefined)
        this.identity.customer(
          actor,
          text(filter.accountId, "Customer ID", 128),
        );
      if (accountId) this.identity.customer(actor, accountId);
      const args = [
        actor.orgId,
        accountId,
        accountId,
        new Date(start).toISOString(),
        filter.to + "T23:59:59.999Z",
      ];
      const scope = "i.org_id=? AND (? IS NULL OR i.account_id=?)";
      const native =
        "NOT EXISTS(SELECT 1 FROM billing_opening_documents o WHERE o.org_id=i.org_id AND o.invoice_id=i.id)";
      const invoices = this.store.all<DocumentRow>(
        `SELECT i.id,i.id AS invoice_id,i.account_id,i.number AS invoice_number,i.currency,i.net,i.tax,i.total,i.created_at,'' AS reason FROM billing_invoices i WHERE ${scope} AND i.created_at>=? AND i.created_at<=? AND ${native}`,
        ...args,
      );
      const credits = this.store.all<DocumentRow>(
        `SELECT c.id,i.id AS invoice_id,i.account_id,i.number AS invoice_number,i.currency,c.net,c.tax,c.total,c.created_at,c.reason FROM billing_credits c JOIN billing_invoices i ON i.org_id=c.org_id AND i.id=c.invoice_id WHERE ${scope} AND c.created_at>=? AND c.created_at<=? AND ${native}`,
        ...args,
      );
      const shipping =
        "EXISTS(SELECT 1 FROM billing_shipping_snapshots s WHERE s.org_id=l.org_id AND s.invoice_id=l.invoice_id AND s.line_id=l.id)";
      const salesLines = this.store.all<LineRow>(
        `SELECT l.id,l.invoice_id,l.invoice_id AS document_id,l.product_id,l.description,l.quantity,l.unit_price,l.unit_tax,${shipping} AS shipping FROM billing_lines l JOIN billing_invoices i ON i.org_id=l.org_id AND i.id=l.invoice_id WHERE ${scope} AND i.created_at>=? AND i.created_at<=? AND ${native}`,
        ...args,
      );
      const creditLines = this.store.all<LineRow>(
        `SELECT cl.id,l.invoice_id,c.id AS document_id,l.product_id,l.description,cl.quantity,l.unit_price,l.unit_tax,${shipping} AS shipping FROM billing_credit_lines cl JOIN billing_credits c ON c.org_id=cl.org_id AND c.id=cl.credit_id JOIN billing_lines l ON l.org_id=cl.org_id AND l.id=cl.invoice_line_id AND l.invoice_id=c.invoice_id JOIN billing_invoices i ON i.org_id=c.org_id AND i.id=c.invoice_id WHERE ${scope} AND c.created_at>=? AND c.created_at<=? AND ${native}`,
        ...args,
      );
      const opening =
        "EXISTS(SELECT 1 FROM billing_opening_documents o WHERE o.org_id=i.org_id AND o.invoice_id=i.id)";
      const payments = this.store.all<CashRow>(
        `SELECT p.id,p.invoice_id,i.account_id,i.number AS invoice_number,i.currency,p.amount,p.created_at,'completed' AS state,${opening} AS opening FROM billing_payments p JOIN billing_invoices i ON i.org_id=p.org_id AND i.id=p.invoice_id WHERE ${scope} AND p.created_at>=? AND p.created_at<=?`,
        ...args,
      );
      const refunds = this.store.all<CashRow>(
        `SELECT r.id,r.invoice_id,i.account_id,i.number AS invoice_number,i.currency,r.amount,r.created_at,r.state,${opening} AS opening FROM billing_refunds r JOIN billing_invoices i ON i.org_id=r.org_id AND i.id=r.invoice_id WHERE ${scope} AND r.created_at>=? AND r.created_at<=?`,
        ...args,
      );
      const totals = new Map<string, SalesTotals>(),
        days = new Map<string, SalesReport["daily"][number]>();
      const entries: SalesReportEntry[] = [];
      const summary = (currency: string) => {
        if (!totals.has(currency)) totals.set(currency, emptyTotals(currency));
        return totals.get(currency)!;
      };
      const day = (currency: string, date: string) => {
        const key = currency + date.slice(0, 10);
        if (!days.has(key))
          days.set(key, {
            date: date.slice(0, 10),
            currency,
            invoiceNet: 0,
            creditNet: 0,
            payments: 0,
            refundsCompleted: 0,
          });
        return days.get(key)!;
      };
      for (const [docs, lines, kind] of [
        [invoices, salesLines, "sale"],
        [credits, creditLines, "credit"],
      ] as const) {
        const byDoc = new Map(docs.map((d) => [d.id, d]));
        const sums = new Map<string, { net: number; tax: number }>();
        for (const l of lines) {
          const doc = byDoc.get(l.document_id)!;
          check(doc, "REPORT_FACTS", "A report line has no matching document.");
          const net = amount(l.quantity, l.unit_price),
            tax = amount(l.quantity, l.unit_tax),
            total = add(net, tax),
            sign = kind === "sale" ? 1 : -1;
          const s = summary(doc.currency),
            bucket = sums.get(doc.id) ?? { net: 0, tax: 0 };
          bucket.net = add(bucket.net, net);
          bucket.tax = add(bucket.tax, tax);
          sums.set(doc.id, bucket);
          const moneyKey =
            kind === "sale"
              ? l.shipping
                ? "shippingNet"
                : "productNet"
              : l.shipping
                ? "shippingCredits"
                : "productCredits";
          s[moneyKey] = add(s[moneyKey], net);
          if (!l.shipping) {
            const q =
              kind === "sale" ? "productQuantity" : "creditedProductQuantity";
            s[q] = add(s[q], l.quantity);
          }
          entries.push({
            id: l.id,
            kind,
            date: doc.created_at,
            invoiceId: doc.invoice_id,
            invoiceNumber: doc.invoice_number,
            accountId: doc.account_id,
            currency: doc.currency,
            net: sign * net,
            tax: sign * tax,
            total: sign * total,
            quantity: l.quantity,
            unitPrice: l.unit_price,
            unitTax: l.unit_tax,
            productId: l.product_id,
            description: l.description,
            shipping: !!l.shipping,
            ...(doc.reason ? { reason: doc.reason } : {}),
            origin: "native",
          });
        }
        for (const doc of docs) {
          const sum = sums.get(doc.id) ?? { net: 0, tax: 0 };
          check(
            sum.net === safe(doc.net) &&
              sum.tax === safe(doc.tax) &&
              add(sum.net, sum.tax) === safe(doc.total),
            "REPORT_FACTS",
            "Invoice or credit lines do not reconcile with the original document.",
          );
          const s = summary(doc.currency),
            d = day(doc.currency, doc.created_at);
          if (kind === "sale") {
            s.invoiceCount = add(s.invoiceCount, 1);
            s.invoiceTax = add(s.invoiceTax, doc.tax);
            s.invoiceTotal = add(s.invoiceTotal, doc.total);
            d.invoiceNet = add(d.invoiceNet, doc.net);
          } else {
            s.creditCount = add(s.creditCount, 1);
            s.creditTax = add(s.creditTax, doc.tax);
            s.creditTotal = add(s.creditTotal, doc.total);
            d.creditNet = add(d.creditNet, doc.net);
          }
        }
      }
      for (const [rows, kind] of [
        [payments, "payment"],
        [refunds, "refund"],
      ] as const)
        for (const row of rows) {
          const value = safe(row.amount),
            s = summary(row.currency),
            d = day(row.currency, row.created_at);
          if (kind === "payment") {
            s.payments = add(s.payments, value);
            d.payments = add(d.payments, value);
          } else if (row.state === "completed") {
            s.refundsCompleted = add(s.refundsCompleted, value);
            d.refundsCompleted = add(d.refundsCompleted, value);
          } else if (row.state === "pending")
            s.refundsPending = add(s.refundsPending, value);
          else if (row.state === "unknown")
            s.refundsUnknown = add(s.refundsUnknown, value);
          entries.push({
            id: row.id,
            kind,
            date: row.created_at,
            invoiceId: row.invoice_id,
            invoiceNumber: row.invoice_number,
            accountId: row.account_id,
            currency: row.currency,
            net: 0,
            tax: 0,
            total: kind === "payment" ? value : -value,
            ...(kind === "refund" ? { refundState: row.state } : {}),
            origin: row.opening ? "opening" : "native",
          });
        }
      for (const s of totals.values()) {
        s.netSales = add(
          add(s.productNet, s.shippingNet),
          -add(s.productCredits, s.shippingCredits),
        );
        s.netTax = add(s.invoiceTax, -s.creditTax);
        s.netTotal = add(s.netSales, s.netTax);
      }
      entries.sort(
        (a, b) =>
          b.date.localeCompare(a.date) ||
          b.id.localeCompare(a.id) ||
          b.kind.localeCompare(a.kind),
      );
      return {
        from: filter.from,
        to: filter.to,
        accountId,
        generatedAt: new Date().toISOString(),
        basis:
          "Native invoice and credit issue dates, using original line quantities and prices; imported opening-balance documents and their credits excluded from sales. Payments use recording dates and include opening balances. Refunds use request dates and their current observed state, not completion dates. Cash is separate from sales; no revenue-recognition or margin claim.",
        currencies: [...totals.values()].sort((a, b) =>
          a.currency.localeCompare(b.currency),
        ),
        daily: [...days.values()].sort(
          (a, b) =>
            a.date.localeCompare(b.date) ||
            a.currency.localeCompare(b.currency),
        ),
        details: {
          items: entries.slice(0, 100),
          truncated: entries.length > 100,
          limit: 100,
        },
      };
    });
  }
}
