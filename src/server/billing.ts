import {
  account,
  check,
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
import { BillingPaymentHistory } from "./billing-payment-history.ts";
import { BillingRefunds } from "./billing-refunds.ts";
import { billingControls } from "./billing-controls.ts";
import { BillingOpening } from "./billing-opening.ts";
import { BillingDocuments } from "./billing-documents.ts";
import { BillingDelivery } from "./billing-delivery.ts";
import type { Catalog } from "./catalog.ts";
export type CommercialLine = {
  productId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  unitTax: number;
};
type InvoiceRow = {
  id: string;
  org_id: string;
  account_id: string;
  order_id: string | null;
  shipment_id: string | null;
  number: string;
  currency: string;
  net: number;
  tax: number;
  total: number;
  created_at: string;
};
type InvoiceLineRow = {
  id: string;
  org_id: string;
  invoice_id: string;
  product_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  unit_tax: number;
};
export type Invoice = InvoiceRow & {
  origin?: "native" | "opening";
  opening?: ReturnType<BillingOpening["snapshot"]>;
};
export type RecordedPayment = {
  id: string;
  org_id: string;
  invoice_id: string;
  provider: string;
  external_ref: string;
  amount: number;
  created_at: string;
};
export type RecordedCredit = {
  id: string;
  invoice_id: string;
  number: string;
  net: number;
  tax: number;
  total: number;
  created_at: string;
  lines: (CommercialLine & { invoiceLineId: string })[];
};
export class Billing {
  private store: Store;
  readonly opening: BillingOpening;
  readonly refunds: BillingRefunds;
  readonly paymentHistory: BillingPaymentHistory;
  readonly documents: BillingDocuments;
  readonly delivery: BillingDelivery;
  constructor(
    database: Database,
    private platform: Platform,
    private identity: Identity,
    catalog: Catalog,
  ) {
    this.store = database.owned("billing");
    this.store.migrate(`
    CREATE TABLE IF NOT EXISTS billing_holds(order_id TEXT PRIMARY KEY,org_id TEXT NOT NULL,account_id TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>=0)) STRICT;
    CREATE TABLE IF NOT EXISTS billing_counters(org_id TEXT PRIMARY KEY,value INTEGER NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS billing_invoices(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,account_id TEXT NOT NULL,order_id TEXT NOT NULL,shipment_id TEXT NOT NULL,number TEXT NOT NULL,currency TEXT NOT NULL,net INTEGER NOT NULL,tax INTEGER NOT NULL,total INTEGER NOT NULL,created_at TEXT NOT NULL,UNIQUE(org_id,shipment_id),UNIQUE(org_id,number),CHECK(total=net+tax AND net>=0 AND tax>=0)) STRICT;
    CREATE TABLE IF NOT EXISTS billing_lines(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,invoice_id TEXT NOT NULL,product_id TEXT NOT NULL,description TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0),unit_price INTEGER NOT NULL CHECK(unit_price>=0),unit_tax INTEGER NOT NULL CHECK(unit_tax>=0),UNIQUE(invoice_id,product_id)) STRICT;
    CREATE TABLE IF NOT EXISTS billing_credits(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,invoice_id TEXT NOT NULL,reference TEXT NOT NULL,number TEXT NOT NULL,reason TEXT NOT NULL,net INTEGER NOT NULL,tax INTEGER NOT NULL,total INTEGER NOT NULL,created_at TEXT NOT NULL,UNIQUE(org_id,reference),UNIQUE(org_id,number),CHECK(total=net+tax AND net>=0 AND tax>=0)) STRICT;
    CREATE TABLE IF NOT EXISTS billing_credit_lines(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,credit_id TEXT NOT NULL,invoice_line_id TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0)) STRICT;
    CREATE TABLE IF NOT EXISTS billing_payments(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,invoice_id TEXT NOT NULL,provider TEXT NOT NULL,external_ref TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),created_at TEXT NOT NULL,UNIQUE(org_id,provider,external_ref)) STRICT;
    CREATE TABLE IF NOT EXISTS billing_refunds(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,invoice_id TEXT NOT NULL,payment_id TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),reference TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('pending','unknown','completed','rejected')),created_at TEXT NOT NULL,UNIQUE(org_id,reference)) STRICT;
    CREATE TABLE IF NOT EXISTS billing_refund_proofs(org_id TEXT NOT NULL,external_ref TEXT NOT NULL,refund_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(org_id,external_ref),UNIQUE(refund_id)) STRICT;
  `);
    this.paymentHistory = new BillingPaymentHistory(
      database,
      this.store,
      identity,
    );
    this.refunds = new BillingRefunds(
      database,
      identity,
      this.store,
      platform,
      this,
    );
    this.opening = new BillingOpening(this.store, identity, catalog, platform);
    this.documents = new BillingDocuments(database, platform, identity, this);
    this.delivery = new BillingDelivery(
      database,
      platform,
      identity,
      this.documents,
    );
  }
  private number(actor: Actor, prefix: string): string {
    while (true) {
      this.store.run(
        "INSERT INTO billing_counters VALUES(?,1) ON CONFLICT(org_id) DO UPDATE SET value=value+1",
        actor.orgId,
      );
      const candidate = `${prefix}-${new Date().getUTCFullYear()}-${String(this.store.get("SELECT value FROM billing_counters WHERE org_id=?", actor.orgId)!.value).padStart(6, "0")}`;
      if (
        !this.store.get(
          "SELECT id FROM billing_invoices WHERE org_id=? AND number=?",
          actor.orgId,
          candidate,
        ) &&
        !this.store.get(
          "SELECT id FROM billing_credits WHERE org_id=? AND number=?",
          actor.orgId,
          candidate,
        )
      )
        return candidate;
    }
  }
  invoice(actor: Actor, invoiceId: string): Invoice {
    const row = this.store.get<InvoiceRow>(
      "SELECT * FROM billing_invoices WHERE org_id=? AND id=?",
      actor.orgId,
      invoiceId,
    );
    check(row, "NOT_FOUND", "Invoice not found.", 404);
    account(actor, row.account_id);
    const opening = this.opening.snapshot(actor, invoiceId);
    return {
      ...row,
      origin: opening ? "opening" : "native",
      opening,
      ...(opening ? { order_id: null, shipment_id: null } : {}),
    };
  }
  lines(actor: Actor, invoiceId: string) {
    this.invoice(actor, invoiceId);
    return this.store
      .all<InvoiceLineRow>(
        "SELECT * FROM billing_lines WHERE org_id=? AND invoice_id=? ORDER BY rowid",
        actor.orgId,
        invoiceId,
      )
      .map((line) => {
        const historical = this.opening.creditedQuantity(
            actor,
            String(line.id),
          ),
          subsequent = Number(
            this.store.get(
              "SELECT COALESCE(SUM(quantity),0) AS quantity FROM billing_credit_lines WHERE org_id=? AND invoice_line_id=?",
              actor.orgId,
              String(line.id),
            )!.quantity,
          );
        return {
          ...line,
          historical_credited_quantity: historical,
          credited_quantity: historical + subsequent,
          creditable_quantity: Number(line.quantity) - historical - subsequent,
        };
      });
  }
  // Internal owning operation: Application.reconciliation supplies authority and snapshot.
  controlTotals(actor: Actor, currency: string) {
    return billingControls(this.store, actor, currency);
  }
  totals(actor: Actor, invoiceId: string) {
    const invoice = this.invoice(actor, invoiceId);
    const credited = Number(
        this.store.get(
          "SELECT COALESCE(SUM(total),0) AS amount FROM billing_credits WHERE org_id=? AND invoice_id=?",
          actor.orgId,
          invoiceId,
        )!.amount,
      ),
      paid = Number(
        this.store.get(
          "SELECT COALESCE(SUM(amount),0) AS amount FROM billing_payments WHERE org_id=? AND invoice_id=?",
          actor.orgId,
          invoiceId,
        )!.amount,
      ),
      refunded = Number(
        this.store.get(
          "SELECT COALESCE(SUM(amount),0) AS amount FROM billing_refunds WHERE org_id=? AND invoice_id=? AND state='completed'",
          actor.orgId,
          invoiceId,
        )!.amount,
      );
    const historical = invoice.opening;
    const combined = {
      credited: credited + Number(historical?.credited ?? 0),
      paid: paid + Number(historical?.paid ?? 0),
      refunded: refunded + Number(historical?.refunded ?? 0),
    };
    return {
      ...combined,
      balance:
        invoice.total - combined.credited - combined.paid + combined.refunded,
    };
  }
  exposure(actor: Actor, accountId: string) {
    this.identity.customer(actor, accountId);
    const holds = Number(
      this.store.get(
        "SELECT COALESCE(SUM(amount),0) AS amount FROM billing_holds WHERE org_id=? AND account_id=?",
        actor.orgId,
        accountId,
      )!.amount,
    );
    const due = this.store
      .all<InvoiceRow>(
        "SELECT * FROM billing_invoices WHERE org_id=? AND account_id=?",
        actor.orgId,
        accountId,
      )
      .reduce(
        (sum, i) => sum + Math.max(0, this.totals(actor, i.id).balance),
        0,
      );
    return { holds, due, total: holds + due };
  }
  commitExposure(
    actor: Actor,
    accountId: string,
    orderId: string,
    amount: number,
  ) {
    const customer = this.identity.customer(actor, accountId);
    check(!customer.held, "CREDIT_HOLD", "Account is on hold.");
    check(
      this.exposure(actor, accountId).total + amount <= customer.credit_limit,
      "CREDIT_LIMIT",
      "Order exceeds the account credit limit.",
    );
    this.store.run(
      "INSERT INTO billing_holds VALUES(?,?,?,?)",
      orderId,
      actor.orgId,
      accountId,
      integer(amount, "order total", 0, 1e12),
    );
  }
  releaseExposure(actor: Actor, orderId: string, amount: number) {
    const hold = this.store.get(
      "SELECT amount FROM billing_holds WHERE org_id=? AND order_id=?",
      actor.orgId,
      orderId,
    );
    check(
      hold && Number(hold.amount) >= amount,
      "EXPOSURE",
      "Order exposure does not match the requested release.",
    );
    this.store.run(
      "UPDATE billing_holds SET amount=amount-? WHERE org_id=? AND order_id=?",
      amount,
      actor.orgId,
      orderId,
    );
  }
  increaseExposure(
    actor: Actor,
    accountId: string,
    orderId: string,
    amount: number,
  ) {
    integer(amount, "additional order exposure", 1, 1e12);
    const customer = this.identity.customer(actor, accountId),
      hold = this.store.get(
        "SELECT account_id,amount FROM billing_holds WHERE org_id=? AND order_id=?",
        actor.orgId,
        orderId,
      );
    check(
      hold && hold.account_id === accountId,
      "EXPOSURE",
      "Order exposure is unavailable.",
    );
    check(!customer.held, "CREDIT_HOLD", "Account is on hold.");
    check(
      this.exposure(actor, accountId).total + amount <= customer.credit_limit,
      "CREDIT_LIMIT",
      "Amendment exceeds the account credit limit.",
    );
    integer(Number(hold.amount) + amount, "order exposure", 0, 1e12);
    this.store.run(
      "UPDATE billing_holds SET amount=amount+? WHERE org_id=? AND order_id=?",
      amount,
      actor.orgId,
      orderId,
    );
  }
  issue(
    actor: Actor,
    accountId: string,
    orderId: string,
    shipmentId: string,
    lines: CommercialLine[],
  ) {
    check(lines.length > 0, "VALIDATION", "Invoice requires lines.", 400);
    const customer = this.identity.customer(actor, accountId);
    const old = this.store.get<InvoiceRow>(
      "SELECT * FROM billing_invoices WHERE org_id=? AND shipment_id=?",
      actor.orgId,
      shipmentId,
    );
    if (old) return { id: old.id, number: old.number };
    const net = lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0),
      tax = lines.reduce((sum, l) => sum + l.quantity * l.unitTax, 0),
      total = integer(net + tax, "invoice total", 0, 1e12),
      invoiceId = id(),
      number = this.number(actor, "INV");
    this.releaseExposure(actor, orderId, total);
    this.store.run(
      "INSERT INTO billing_invoices VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      invoiceId,
      actor.orgId,
      accountId,
      orderId,
      shipmentId,
      number,
      customer.currency,
      net,
      tax,
      total,
      now(),
    );
    for (const l of lines)
      this.store.run(
        "INSERT INTO billing_lines VALUES(?,?,?,?,?,?,?,?)",
        id(),
        actor.orgId,
        invoiceId,
        l.productId,
        l.description,
        l.quantity,
        l.unitPrice,
        l.unitTax,
      );
    this.platform.event(actor, "billing.invoice.issued", invoiceId, {
      orderId,
      shipmentId,
      total,
      currency: customer.currency,
    });
    this.documents.captureInvoice(actor, invoiceId);
    return { id: invoiceId, number };
  }
  invoices(actor: Actor) {
    permit(actor, ["finance", "commercial", "buyer", "warranty", "support"]);
    return this.store
      .all<InvoiceRow>(
        "SELECT * FROM billing_invoices WHERE org_id=? AND (? IS NULL OR account_id=?) ORDER BY created_at DESC",
        actor.orgId,
        actor.role === "buyer" ? actor.accountId : null,
        actor.accountId,
      )
      .map((i) => ({
        ...this.invoice(actor, i.id),
        hasActivePublication: this.hasActivePublication(actor, "invoice", i.id),
        ...this.totals(actor, i.id),
        lines: this.lines(actor, i.id),
      }));
  }
  recordedPayment(actor: Actor, paymentId: string): RecordedPayment {
    permit(actor, ["finance", "support"]);
    const payment = this.store.get<RecordedPayment>(
      "SELECT * FROM billing_payments WHERE org_id=? AND id=?",
      actor.orgId,
      paymentId,
    );
    check(payment, "NOT_FOUND", "Recorded payment not found.", 404);
    this.invoice(actor, payment.invoice_id);
    return payment;
  }
  credit(
    actor: Actor,
    invoiceId: string,
    reference: string,
    reason: string,
    lines: { lineId: string; quantity: number }[],
  ) {
    const invoice = this.invoice(actor, invoiceId);
    text(reason, "credit reason", 1000);
    check(lines.length > 0, "VALIDATION", "Credit requires lines.", 400);
    check(
      !this.store.get(
        "SELECT id FROM billing_credits WHERE org_id=? AND reference=?",
        actor.orgId,
        reference,
      ),
      "DUPLICATE_CREDIT",
      "This business reference was already credited.",
    );
    let net = 0,
      tax = 0;
    const seen = new Set<string>();
    for (const l of lines) {
      check(!seen.has(l.lineId), "VALIDATION", "Duplicate credit line.", 400);
      seen.add(l.lineId);
      const original = this.store.get(
        "SELECT * FROM billing_lines WHERE org_id=? AND invoice_id=? AND id=?",
        actor.orgId,
        invoiceId,
        l.lineId,
      );
      check(original, "NOT_FOUND", "Invoice line not found.", 404);
      const qty = integer(l.quantity, "credit quantity", 1, 100000),
        previous = Number(
          this.store.get(
            "SELECT COALESCE(SUM(quantity),0) AS quantity FROM billing_credit_lines WHERE org_id=? AND invoice_line_id=?",
            actor.orgId,
            l.lineId,
          )!.quantity,
        );
      check(
        qty + previous + this.opening.creditedQuantity(actor, l.lineId) <=
          Number(original.quantity),
        "OVER_CREDIT",
        "Credit exceeds the remaining invoiced quantity.",
      );
      net += qty * Number(original.unit_price);
      tax += qty * Number(original.unit_tax);
    }
    const creditId = id(),
      number = this.number(actor, "CR");
    this.store.run(
      "INSERT INTO billing_credits VALUES(?,?,?,?,?,?,?,?,?,?)",
      creditId,
      actor.orgId,
      invoice.id,
      reference,
      number,
      reason,
      net,
      tax,
      net + tax,
      now(),
    );
    for (const l of lines)
      this.store.run(
        "INSERT INTO billing_credit_lines VALUES(?,?,?,?,?)",
        id(),
        actor.orgId,
        creditId,
        l.lineId,
        l.quantity,
      );
    this.platform.event(actor, "billing.credit.issued", creditId, {
      invoiceId,
      total: net + tax,
    });
    this.documents.captureCredit(actor, creditId);
    return { id: creditId, number, total: net + tax };
  }
  issueCredit(
    actor: Actor,
    key: string,
    input: {
      invoiceId: string;
      reference: string;
      reason: string;
      lines: { lineId: string; quantity: number }[];
    },
  ) {
    return this.platform.command(
      actor,
      "billing.credit",
      key,
      input,
      () => {
        permit(actor, ["finance"]);
        this.invoice(actor, input.invoiceId);
      },
      () =>
        this.credit(
          actor,
          input.invoiceId,
          text(input.reference, "business reference"),
          input.reason,
          input.lines,
        ),
    );
  }
  verifiedPayment(
    actor: Actor,
    invoiceId: string,
    amount: number,
    provider: string,
    externalRef: string,
  ) {
    const invoice = this.invoice(actor, invoiceId);
    const old = this.store.get(
      "SELECT * FROM billing_payments WHERE org_id=? AND provider=? AND external_ref=?",
      actor.orgId,
      provider,
      externalRef,
    );
    if (old) {
      check(
        old.invoice_id === invoiceId && old.amount === amount,
        "PAYMENT_CONFLICT",
        "Payment reference already applied with different details.",
      );
      return { id: String(old.id) };
    }
    const qty = integer(amount, "payment amount", 1, 1e12);
    check(
      provider !== "manual" || qty <= this.totals(actor, invoiceId).balance,
      "OVERPAYMENT",
      "Manual payment exceeds the open invoice balance.",
    );
    const paymentId = id();
    this.store.run(
      "INSERT INTO billing_payments VALUES(?,?,?,?,?,?,?)",
      paymentId,
      actor.orgId,
      invoice.id,
      provider,
      externalRef,
      qty,
      now(),
    );
    this.platform.event(actor, "billing.payment.applied", paymentId, {
      invoiceId,
      amount: qty,
      provider,
    });
    return { id: paymentId };
  }
  manualPayment(
    actor: Actor,
    key: string,
    input: {
      invoiceId: string;
      amount: number;
      reference: string;
      reason: string;
    },
  ) {
    return this.platform.command(
      actor,
      "billing.payment.manual",
      key,
      input,
      () => {
        permit(actor, ["finance"]);
        this.invoice(actor, input.invoiceId);
      },
      () => {
        text(input.reason, "verified payment evidence", 1000);
        return this.verifiedPayment(
          actor,
          input.invoiceId,
          input.amount,
          "manual",
          text(input.reference, "bank/payment reference"),
        );
      },
    );
  }
  refundRequest(
    actor: Actor,
    key: string,
    input: {
      invoiceId: string;
      paymentId: string;
      amount: number;
      reference: string;
      reason: string;
    },
  ) {
    return this.platform.command(
      actor,
      "billing.refund.request",
      key,
      input,
      () => {
        permit(actor, ["finance"]);
        this.invoice(actor, input.invoiceId);
      },
      () => {
        text(input.reason, "refund reason", 1000);
        const payment = this.store.get(
          "SELECT * FROM billing_payments WHERE org_id=? AND invoice_id=? AND id=?",
          actor.orgId,
          input.invoiceId,
          input.paymentId,
        );
        check(payment, "NOT_FOUND", "Payment not found.", 404);
        const amount = integer(input.amount, "refund amount", 1, 1e12),
          pending = Number(
            this.store.get(
              "SELECT COALESCE(SUM(amount),0) AS amount FROM billing_refunds WHERE org_id=? AND invoice_id=? AND state IN('pending','unknown')",
              actor.orgId,
              input.invoiceId,
            )!.amount,
          ),
          used = Number(
            this.store.get(
              "SELECT COALESCE(SUM(amount),0) AS amount FROM billing_refunds WHERE payment_id=? AND state<>'rejected'",
              input.paymentId,
            )!.amount,
          );
        check(
          amount <= -this.totals(actor, input.invoiceId).balance - pending &&
            used + amount <= Number(payment.amount),
          "OVER_REFUND",
          "Refund exceeds available credited cash.",
        );
        const refundId = id();
        this.store.run(
          "INSERT INTO billing_refunds VALUES(?,?,?,?,?,?,?,?)",
          refundId,
          actor.orgId,
          input.invoiceId,
          input.paymentId,
          amount,
          text(input.reference, "refund reference"),
          "pending",
          now(),
        );
        this.platform.event(actor, "billing.refund.requested", refundId, {
          invoiceId: input.invoiceId,
          amount,
        });
        return { id: refundId, state: "pending" };
      },
    );
  }
  manualRefund(
    actor: Actor,
    key: string,
    input: { refundId: string; reference: string; reason: string },
  ) {
    return this.platform.command(
      actor,
      "billing.refund.manual",
      key,
      input,
      () => permit(actor, ["finance"]),
      () => {
        const refund = this.store.get(
          "SELECT * FROM billing_refunds WHERE org_id=? AND id=?",
          actor.orgId,
          input.refundId,
        );
        check(refund, "NOT_FOUND", "Refund not found.", 404);
        const payment = this.store.get(
          "SELECT * FROM billing_payments WHERE org_id=? AND id=?",
          actor.orgId,
          String(refund.payment_id),
        )!;
        check(
          payment.provider === "manual" && refund.state === "pending",
          "STATE",
          "Only pending manual-payment refunds use manual verification.",
        );
        text(input.reference, "bank refund reference");
        text(input.reason, "refund evidence", 1000);
        check(
          !this.store.get(
            "SELECT refund_id FROM billing_refund_proofs WHERE org_id=? AND external_ref=?",
            actor.orgId,
            input.reference,
          ),
          "REFUND_REFERENCE",
          "This bank refund reference already verifies another refund.",
        );
        this.store.run(
          "INSERT INTO billing_refund_proofs VALUES(?,?,?,?)",
          actor.orgId,
          input.reference,
          input.refundId,
          now(),
        );
        this.store.run(
          "UPDATE billing_refunds SET state='completed' WHERE id=?",
          input.refundId,
        );
        this.platform.audit(
          actor,
          "billing.refund.verified",
          input.refundId,
          input,
        );
        return { id: input.refundId, state: "completed" };
      },
    );
  }
  private hasActivePublication(
    actor: Actor,
    kind: "invoice" | "credit",
    documentId: string,
  ) {
    return !!this.store.get(
      "SELECT id FROM billing_publications WHERE org_id=? AND kind=? AND document_id=? AND state='available'",
      actor.orgId,
      kind,
      documentId,
    );
  }
  recordedCredit(actor: Actor, creditId: string): RecordedCredit {
    permit(actor, ["finance", "support"]);
    const credit = this.store.get<Omit<RecordedCredit, "lines">>(
      "SELECT id,invoice_id,number,net,tax,total,created_at FROM billing_credits WHERE org_id=? AND id=?",
      actor.orgId,
      creditId,
    );
    check(credit, "NOT_FOUND", "Credit not found.", 404);
    this.invoice(actor, credit.invoice_id);
    const lines = this.store.all<CommercialLine & { invoiceLineId: string }>(
      `SELECT l.id AS invoiceLineId,l.product_id AS productId,l.description,
       c.quantity,l.unit_price AS unitPrice,l.unit_tax AS unitTax
       FROM billing_credit_lines c JOIN billing_lines l
       ON l.org_id=c.org_id AND l.id=c.invoice_line_id
       WHERE c.org_id=? AND c.credit_id=? AND l.invoice_id=? ORDER BY c.rowid`,
      actor.orgId,
      creditId,
      credit.invoice_id,
    );
    check(
      lines.length > 0 &&
        lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0) ===
          credit.net &&
        lines.reduce((sum, l) => sum + l.quantity * l.unitTax, 0) ===
          credit.tax &&
        credit.total === credit.net + credit.tax,
      "ACCOUNTING_CREDIT_MISMATCH",
      "Credit lines do not reconcile to the original credit.",
    );
    return { ...credit, lines };
  }
  credits(actor: Actor) {
    permit(actor, ["finance", "commercial", "buyer", "warranty", "support"]);
    return this.store
      .all(
        "SELECT * FROM billing_credits WHERE org_id=? ORDER BY created_at DESC",
        actor.orgId,
      )
      .filter((c) => {
        const i = this.store.get<InvoiceRow>(
          "SELECT * FROM billing_invoices WHERE org_id=? AND id=?",
          actor.orgId,
          String(c.invoice_id),
        )!;
        return actor.role !== "buyer" || i.account_id === actor.accountId;
      })
      .map((c) => ({
        ...c,
        hasActivePublication: this.hasActivePublication(
          actor,
          "credit",
          String(c.id),
        ),
      }));
  }
}
