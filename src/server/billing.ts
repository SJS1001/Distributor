import { BillingSalesReport } from "./billing-sales-report.ts";
import type { SalesReportFilter } from "../shared/billing-sales-report.ts";
import { shippingTermsInitialize } from "./shipping-terms-schema.ts";
import {
  unspecifiedShipping,
  type ShippingTerms,
  type InvoiceShipping,
} from "../shared/shipping-terms.ts";
import { analyticsPeriod } from "../shared/operational-analytics.ts";
import type { SQLInputValue } from "node:sqlite";
import type { BillingSalesEvidence } from "./sales-evidence.ts";
import {
  invoiceQueueStates,
  type InvoiceQueueState,
} from "../shared/invoice-queue.ts";
import {
  account,
  check,
  id,
  integer,
  now,
  permit,
  text,
  type Actor,
  type Role,
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
export type InvoiceSource = {
  accountId: string;
  orderId: string;
  shipmentId: string;
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
  shipping?: InvoiceShipping;
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
type CreditRow = Omit<RecordedCredit, "lines"> & {
  org_id: string;
  reference: string;
  reason: string;
};
export class Billing {
  private store: Store;
  readonly opening: BillingOpening;
  readonly refunds: BillingRefunds;
  readonly paymentHistory: BillingPaymentHistory;
  readonly documents: BillingDocuments;
  readonly delivery: BillingDelivery;
  constructor(
    private database: Database,
    private platform: Platform,
    private identity: Identity,
    catalog: Catalog,
    private authorizeInvoiceSource: (
      actor: Actor,
      source: InvoiceSource,
    ) => void,
    startupMaintenance = true,
  ) {
    this.store = database.owned("billing");
    this.store.migrate(shippingTermsInitialize("billing"));
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
      startupMaintenance,
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
  private current(
    actor: Actor,
    roles: Role[] = [
      "warehouse",
      "commercial",
      "finance",
      "warranty",
      "support",
      "buyer",
    ],
  ) {
    actor = this.identity.currentActor(actor);
    permit(actor, roles);
    check(
      !this.identity.security(actor).passwordChangeRequired,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before accessing billing.",
      403,
    );
    return actor;
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
    actor = this.current(actor);
    const row = this.store.get<InvoiceRow>(
      "SELECT * FROM billing_invoices WHERE org_id=? AND id=?",
      actor.orgId,
      invoiceId,
    );
    check(row, "NOT_FOUND", "Invoice not found.", 404);
    account(actor, row.account_id);
    const opening = this.opening.snapshot(actor, invoiceId);
    if (actor.role === "warehouse") {
      check(
        !opening && row.order_id && row.shipment_id,
        "FORBIDDEN",
        "Warehouse access requires a native shipment invoice.",
        403,
      );
      this.authorizeInvoiceSource(actor, {
        accountId: row.account_id,
        orderId: row.order_id,
        shipmentId: row.shipment_id,
      });
    }
    return {
      ...row,
      shipping: this.shippingSnapshot(actor, invoiceId),
      origin: opening ? "opening" : "native",
      opening,
      ...(opening ? { order_id: null, shipment_id: null } : {}),
    };
  }
  private shippingSnapshot(actor: Actor, invoiceId: string): InvoiceShipping {
    const row = this.store.get<{ terms: string; line_id: string | null }>(
      "SELECT terms,line_id FROM billing_shipping_snapshots WHERE org_id=? AND invoice_id=?",
      actor.orgId,
      invoiceId,
    );
    return {
      ...(row
        ? (JSON.parse(row.terms) as ShippingTerms)
        : unspecifiedShipping()),
      charged: !!row?.line_id,
      lineId: row?.line_id ?? null,
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
          kind:
            this.shippingSnapshot(actor, invoiceId).lineId === line.id
              ? ("shipping" as const)
              : ("product" as const),
          historical_credited_quantity: historical,
          credited_quantity: historical + subsequent,
          creditable_quantity: Number(line.quantity) - historical - subsequent,
        };
      });
  }
  // Opening provenance, rather than an ID prefix, distinguishes historical documents.
  salesEvidence(actor: Actor): BillingSalesEvidence {
    actor = this.current(actor, ["finance"]);
    return {
      invoices: this.store.all(
        `SELECT i.id,i.order_id AS "order",i.shipment_id AS shipment,i.account_id AS account,i.currency,
         CASE WHEN o.invoice_id IS NULL THEN 0 ELSE 1 END AS opening
         FROM billing_invoices i LEFT JOIN billing_opening_documents o ON o.org_id=i.org_id AND o.invoice_id=i.id
         WHERE i.org_id=? ORDER BY i.rowid`,
        actor.orgId,
      ),
      lines: this.store.all(
        `SELECT id,invoice_id AS invoice,product_id AS product,CAST(quantity AS TEXT) AS quantity,
         CAST(unit_price AS TEXT) AS price,CAST(unit_tax AS TEXT) AS tax
         FROM billing_lines WHERE org_id=? AND NOT EXISTS(SELECT 1 FROM billing_shipping_snapshots s WHERE s.org_id=billing_lines.org_id AND s.line_id=billing_lines.id) ORDER BY rowid`,
        actor.orgId,
      ),
    };
  }
  health(actor: Actor) {
    actor = this.current(actor, ["support"]);
    return {
      id: "native-refunds",
      label: "Native refunds",
      states: this.store.all<{
        state: string;
        count: number;
        oldestCreatedAt: string | null;
      }>(
        "SELECT state,COUNT(*) AS count,MIN(created_at) AS oldestCreatedAt FROM billing_refunds WHERE org_id=? GROUP BY state ORDER BY state",
        actor.orgId,
      ),
    };
  }
  // Internal owning operation: Application.reconciliation supplies authority and snapshot.
  controlTotals(actor: Actor, currency: string) {
    actor = this.current(actor, ["finance"]);
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
    actor = this.current(actor);
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
    actor = this.current(actor, ["commercial", "buyer"]);
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
    actor = this.current(actor, ["commercial", "buyer", "warehouse"]);
    const hold = this.store.get(
      "SELECT account_id,amount FROM billing_holds WHERE org_id=? AND order_id=?",
      actor.orgId,
      orderId,
    );
    if (hold) account(actor, String(hold.account_id));
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
    actor = this.current(actor, ["commercial", "buyer"]);
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
    shipping: ShippingTerms = unspecifiedShipping(),
  ) {
    actor = this.current(actor, ["warehouse"]);
    // The fulfillment owner checks current custody before saved results or
    // invoice effects. Capture below runs inside its native handover transaction.
    this.authorizeInvoiceSource(actor, { accountId, orderId, shipmentId });
    check(lines.length > 0, "VALIDATION", "Invoice requires lines.", 400);
    const customer = this.identity.customer(actor, accountId);
    const old = this.store.get<InvoiceRow>(
      "SELECT * FROM billing_invoices WHERE org_id=? AND shipment_id=?",
      actor.orgId,
      shipmentId,
    );
    if (old) {
      check(
        old.account_id === accountId && old.order_id === orderId,
        "INVOICE_SOURCE",
        "Saved invoice does not match native shipment custody.",
      );
      return { id: old.id, number: old.number };
    }
    // An authorized retry only reads the verified native invoice. New money,
    // including the once-per-order freight charge, requires atomic handover.
    this.database.requireTransaction();
    const alreadyCharged = this.store.get(
      "SELECT invoice_id FROM billing_shipping_snapshots WHERE org_id=? AND order_id=? AND line_id IS NOT NULL",
      actor.orgId,
      orderId,
    );
    const chargeShipping = shipping.treatment === "extra" && !alreadyCharged;
    const shippingLineId = chargeShipping ? id() : null;
    const invoiceLines = chargeShipping
      ? [
          ...lines,
          {
            productId: `shipping:${orderId}`,
            description: "Agreed shipping charge (once per order)",
            quantity: 1,
            unitPrice: shipping.net,
            unitTax: shipping.tax,
          },
        ]
      : lines;
    const net = invoiceLines.reduce(
        (sum, l) => sum + l.quantity * l.unitPrice,
        0,
      ),
      tax = invoiceLines.reduce((sum, l) => sum + l.quantity * l.unitTax, 0),
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
    for (const l of invoiceLines)
      this.store.run(
        "INSERT INTO billing_lines VALUES(?,?,?,?,?,?,?,?)",
        l.productId === `shipping:${orderId}` ? shippingLineId! : id(),
        actor.orgId,
        invoiceId,
        l.productId,
        l.description,
        l.quantity,
        l.unitPrice,
        l.unitTax,
      );
    this.store.run(
      "INSERT INTO billing_shipping_snapshots VALUES(?,?,?,?,?)",
      actor.orgId,
      invoiceId,
      orderId,
      JSON.stringify(shipping),
      shippingLineId,
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
    actor = this.current(actor, [
      "finance",
      "commercial",
      "buyer",
      "warranty",
      "support",
    ]);
    return this.store
      .all<InvoiceRow>(
        "SELECT * FROM billing_invoices WHERE org_id=? AND (?=0 OR account_id=?) ORDER BY created_at DESC",
        actor.orgId,
        actor.role === "buyer" ? 1 : 0,
        actor.accountId,
      )
      .map((i) => ({
        ...this.invoice(actor, i.id),
        hasActivePublication: this.hasActivePublication(actor, "invoice", i.id),
        ...this.totals(actor, i.id),
        lines: this.lines(actor, i.id),
      }));
  }
  private invoiceView(actor: Actor, invoiceId: string) {
    return {
      ...this.invoice(actor, invoiceId),
      hasActivePublication: this.hasActivePublication(
        actor,
        "invoice",
        invoiceId,
      ),
      ...this.totals(actor, invoiceId),
      lines: this.lines(actor, invoiceId),
    };
  }
  // Owning SQL projection uses the same native and opening facts as totals().
  // Pending/unknown/rejected refunds never reduce the customer's credit balance.
  private invoiceBalances() {
    return `WITH balances AS (
      SELECT i.*,
        i.total-COALESCE(o.credited,0)-COALESCE(o.paid,0)+COALESCE(o.refunded,0)
        -COALESCE((SELECT SUM(c.total) FROM billing_credits c WHERE c.org_id=i.org_id AND c.invoice_id=i.id),0)
        -COALESCE((SELECT SUM(p.amount) FROM billing_payments p WHERE p.org_id=i.org_id AND p.invoice_id=i.id),0)
        +COALESCE((SELECT SUM(r.amount) FROM billing_refunds r WHERE r.org_id=i.org_id AND r.invoice_id=i.id AND r.state='completed'),0)
        AS balance
      FROM billing_invoices i
      LEFT JOIN billing_opening_documents o ON o.org_id=i.org_id AND o.invoice_id=i.id
      WHERE i.org_id=? AND (?=0 OR i.account_id=?)
    )`;
  }
  invoicePage(
    actor: Actor,
    input: { after?: string; state?: InvoiceQueueState } = {},
  ) {
    return this.database.transaction(() => {
      actor = this.current(actor, [
        "finance",
        "commercial",
        "buyer",
        "warranty",
        "support",
      ]);
      const state = input.state ?? null;
      check(
        state === null || invoiceQueueStates.includes(state),
        "VALIDATION",
        "Choose a supported invoice balance.",
        400,
      );
      let anchor: Invoice | undefined;
      if (input.after !== undefined) {
        const encoded = text(input.after, "Invoice cursor", 512);
        let cursor: unknown;
        try {
          const decoded = Buffer.from(encoded, "base64url");
          check(
            decoded.toString("base64url") === encoded,
            "VALIDATION",
            "Invalid invoice cursor.",
            400,
          );
          cursor = JSON.parse(decoded.toString("utf8"));
        } catch {
          check(false, "VALIDATION", "Invalid invoice cursor.", 400);
        }
        check(
          Array.isArray(cursor) &&
            cursor.length === 3 &&
            cursor[0] === 1 &&
            cursor[1] === state &&
            typeof cursor[2] === "string" &&
            cursor[2].length > 0 &&
            cursor[2].length <= 128,
          "VALIDATION",
          "Invoice cursor does not match this queue.",
          400,
        );
        // A payment or credit may change an anchor's balance; its custody still applies.
        anchor = this.invoice(actor, cursor[2]);
      }
      let where =
        state === "unpaid"
          ? "balance>0"
          : state === "settled"
            ? "balance=0"
            : state === "credit"
              ? "balance<0"
              : "1=1";
      const parameters = [
        actor.orgId,
        actor.role === "buyer" ? 1 : 0,
        actor.accountId,
      ] as SQLInputValue[];
      if (anchor) {
        where += " AND (created_at<? OR (created_at=? AND id<?))";
        parameters.push(anchor.created_at, anchor.created_at, anchor.id);
      }
      const rows = this.store.all<InvoiceRow>(
        `${this.invoiceBalances()} SELECT * FROM balances WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT 21`,
        ...parameters,
      );
      const items = rows
        .slice(0, 20)
        .map((row) => this.invoiceView(actor, row.id));
      return {
        items,
        next:
          rows.length > 20
            ? Buffer.from(JSON.stringify([1, state, items[19]!.id])).toString(
                "base64url",
              )
            : null,
      };
    });
  }
  invoiceSummary(actor: Actor) {
    return this.database.transaction(() => {
      actor = this.current(actor, [
        "finance",
        "commercial",
        "buyer",
        "warranty",
        "support",
      ]);
      const row = this.store.get(
        `${this.invoiceBalances()}
        SELECT COUNT(*) AS total,COALESCE(SUM(balance>0),0) AS unpaid,
        COALESCE(SUM(balance=0),0) AS settled,COALESCE(SUM(balance<0),0) AS credit,
        COALESCE(SUM(MAX(0,balance)),0) AS due FROM balances`,
        actor.orgId,
        actor.role === "buyer" ? 1 : 0,
        actor.accountId,
      )!;
      return {
        total: Number(row.total),
        unpaid: Number(row.unpaid),
        settled: Number(row.settled),
        credit: Number(row.credit),
        due: Number(row.due),
      };
    });
  }
  salesReport(actor: Actor, filter: SalesReportFilter) {
    return new BillingSalesReport(
      this.database,
      this.store,
      this.identity,
    ).read(actor, filter);
  }
  operationalAnalytics(actor: Actor, asOf = new Date().toISOString()) {
    return this.database.transaction(() => {
      actor = this.current(actor, [
        "finance",
        "commercial",
        "buyer",
        "warranty",
        "support",
      ]);
      const period = analyticsPeriod(asOf);
      const balances = this.store.all<{
        currency: string;
        due: number;
        unpaid: number;
      }>(
        `${this.invoiceBalances()} SELECT currency,COALESCE(SUM(MAX(0,balance)),0) AS due,SUM(balance>0) AS unpaid FROM balances GROUP BY currency ORDER BY currency`,
        actor.orgId,
        actor.role === "buyer" ? 1 : 0,
        actor.accountId,
      );
      const rows = this.store.all<{
        date: string;
        currency: string;
        amount: number;
      }>(
        `SELECT substr(created_at,1,10) AS date,currency,SUM(total) AS amount FROM billing_invoices WHERE org_id=? AND (?=0 OR account_id=?) AND created_at>=? AND created_at<? GROUP BY date,currency`,
        actor.orgId,
        actor.role === "buyer" ? 1 : 0,
        actor.accountId,
        period.previousStart,
        period.endExclusive,
      );
      const aging = this.documents.aging(actor);
      const buckets = [
        "notDue",
        "days1to30",
        "days31to60",
        "days61to90",
        "daysOver90",
        "unknownDue",
      ] as const;
      const currencies = [
        ...new Set([
          ...balances.map((row) => row.currency),
          ...rows.map((row) => row.currency),
          ...aging.accounts.flatMap((row) =>
            row.invoices.map((invoice) => invoice.currency),
          ),
        ]),
      ].sort();
      return {
        period,
        balances,
        agingAsOf: aging.observedAt,
        agingBasis: aging.dateBasis,
        aging: currencies.map((currency) => ({
          currency,
          buckets: buckets.map((bucket) => ({
            bucket,
            amount: aging.accounts
              .flatMap((account) => account.invoices)
              .filter(
                (invoice) =>
                  invoice.currency === currency && invoice.bucket === bucket,
              )
              .reduce((sum, invoice) => sum + Math.max(0, invoice.balance), 0),
          })),
        })),
        history: currencies.map((currency) => ({
          currency,
          days: period.days.map((date) => ({
            date,
            amount:
              rows.find((row) => row.date === date && row.currency === currency)
                ?.amount ?? 0,
          })),
        })),
      };
    });
  }
  recordedPayment(actor: Actor, paymentId: string): RecordedPayment {
    actor = this.current(actor, ["finance", "support"]);
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
    actor = this.current(actor, ["finance", "warranty"]);
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
        actor = this.current(actor, ["finance"]);
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
    actor = this.current(actor, ["finance"]);
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
        actor = this.current(actor, ["finance"]);
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
        actor = this.current(actor, ["finance"]);
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
      () => {
        actor = this.current(actor, ["finance"]);
      },
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
    actor = this.current(actor, ["finance", "support"]);
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
    actor = this.current(actor, [
      "finance",
      "commercial",
      "buyer",
      "warranty",
      "support",
    ]);
    return this.store
      .all<
        CreditRow & {
          account_id: string;
          invoice_number: string;
          currency: string;
        }
      >(
        "SELECT c.*,i.account_id,i.number AS invoice_number,i.currency FROM billing_credits c JOIN billing_invoices i ON i.org_id=c.org_id AND i.id=c.invoice_id WHERE c.org_id=? AND (?=0 OR i.account_id=?) ORDER BY c.created_at DESC",
        actor.orgId,
        actor.role === "buyer" ? 1 : 0,
        actor.accountId,
      )
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
