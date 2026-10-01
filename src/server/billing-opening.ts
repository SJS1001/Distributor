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
import { importFields } from "./import-manifest.ts";
import type { Store } from "./database.ts";
import type { Identity } from "./iam.ts";
import type { Catalog } from "./catalog.ts";
import type { Platform } from "./platform.ts";
export type OpeningDocument = {
  sourceId: string;
  accountId: string;
  number: string;
  issuedAt: string;
  dueAt: string;
  net: number;
  tax: number;
  total: number;
  credited: number;
  paid: number;
  refunded: number;
  balance: number;
  lines: {
    productId: string;
    description: string;
    quantity: number;
    unitPrice: number;
    unitTax: number;
    creditedQuantity: number;
  }[];
};
export type DocumentReview = {
  sourceId: string;
  matchKey: string;
  name: string;
  value: number;
  document: OpeningDocument;
  accountHash: string;
  productHashes: string[];
};
export type DocumentMapping = {
  sourceId: string;
  invoiceId: string;
  number: string;
  total: number;
  balance: number;
};
export class BillingOpening {
  constructor(
    private store: Store,
    private identity: Identity,
    private catalog: Catalog,
    private platform: Platform,
  ) {
    store.migrate(`
      CREATE TABLE IF NOT EXISTS billing_opening_documents(invoice_id TEXT PRIMARY KEY,org_id TEXT NOT NULL,source_ref TEXT NOT NULL,source_id TEXT NOT NULL,batch_id TEXT NOT NULL,source_hash TEXT NOT NULL,cutoff_at TEXT NOT NULL,issued_at TEXT NOT NULL,due_at TEXT NOT NULL,credited INTEGER NOT NULL CHECK(credited>=0),paid INTEGER NOT NULL CHECK(paid>=0),refunded INTEGER NOT NULL CHECK(refunded>=0),balance INTEGER NOT NULL CHECK(balance>0),created_by TEXT NOT NULL,imported_at TEXT NOT NULL,UNIQUE(org_id,source_ref,source_id)) STRICT;
      CREATE TABLE IF NOT EXISTS billing_opening_lines(line_id TEXT PRIMARY KEY,org_id TEXT NOT NULL,invoice_id TEXT NOT NULL,credited_quantity INTEGER NOT NULL CHECK(credited_quantity>=0)) STRICT;
    `);
  }
  snapshot(actor: Actor, invoiceId: string) {
    return (
      this.store.get(
        "SELECT * FROM billing_opening_documents WHERE org_id=? AND invoice_id=?",
        actor.orgId,
        invoiceId,
      ) ?? null
    );
  }
  creditedQuantity(actor: Actor, lineId: string) {
    return Number(
      this.store.get(
        "SELECT credited_quantity FROM billing_opening_lines WHERE org_id=? AND line_id=?",
        actor.orgId,
        lineId,
      )?.credited_quantity ?? 0,
    );
  }
  review(actor: Actor, raw: unknown, cutoffAt: string): DocumentReview {
    permit(actor, []);
    const r = importFields(raw, [
      "sourceId",
      "accountId",
      "number",
      "issuedAt",
      "dueAt",
      "net",
      "tax",
      "total",
      "credited",
      "paid",
      "refunded",
      "balance",
      "lines",
    ]);
    const sourceId = text(r.sourceId, "source ID"),
      accountId = text(r.accountId, "customer ID"),
      number = text(r.number, "original invoice number"),
      customer = this.identity.customer(actor, accountId);
    const timestamp = (value: unknown, label: string) => {
      check(
        typeof value === "string" &&
          Number.isFinite(Date.parse(value)) &&
          new Date(value).toISOString() === value,
        "VALIDATION",
        `${label} must be a canonical UTC timestamp.`,
        400,
      );
      return value;
    };
    const issuedAt = timestamp(r.issuedAt, "Issue date"),
      dueAt = timestamp(r.dueAt, "Due date");
    check(
      issuedAt <= cutoffAt && dueAt >= issuedAt,
      "IMPORT_DATES",
      "Issue date must precede the cutoff and due date must not precede issue.",
    );
    check(
      !this.store.get(
        "SELECT id FROM billing_invoices WHERE org_id=? AND number=?",
        actor.orgId,
        number,
      ),
      "DOCUMENT_EXISTS",
      "Original invoice number already exists; reconcile it rather than overwrite or post it again.",
    );
    check(
      Array.isArray(r.lines) && r.lines.length > 0 && r.lines.length <= 100,
      "VALIDATION",
      "Document must contain 1–100 original lines.",
      400,
    );
    const products = new Set<string>(),
      productHashes: string[] = [];
    let net = 0,
      tax = 0,
      credited = 0;
    const lines = r.lines.map((rawLine) => {
      const l = importFields(rawLine, [
          "productId",
          "description",
          "quantity",
          "unitPrice",
          "unitTax",
          "creditedQuantity",
        ]),
        productId = text(l.productId, "product ID"),
        product = this.catalog.product(actor, productId);
      check(
        !products.has(productId),
        "VALIDATION",
        "Duplicate product line; reconcile the source format without losing its amounts.",
        400,
      );
      products.add(productId);
      productHashes.push(digest(canonical(product)));
      check(
        product.currency === customer.currency,
        "REGION",
        "Product and customer currencies must match.",
      );
      const quantity = integer(l.quantity, "original quantity", 1, 100000),
        unitPrice = integer(l.unitPrice, "original unit price", 0, 1e9),
        unitTax = integer(l.unitTax, "original unit tax", 0, 1e9),
        creditedQuantity = integer(
          l.creditedQuantity,
          "previously credited quantity",
          0,
          quantity,
        );
      net += quantity * unitPrice;
      tax += quantity * unitTax;
      credited += creditedQuantity * (unitPrice + unitTax);
      return {
        productId,
        description: text(l.description, "original description", 1000),
        quantity,
        unitPrice,
        unitTax,
        creditedQuantity,
      };
    });
    const document: OpeningDocument = {
      sourceId,
      accountId,
      number,
      issuedAt,
      dueAt,
      net: integer(r.net, "net", 0, 1e12),
      tax: integer(r.tax, "tax", 0, 1e12),
      total: integer(r.total, "total", 1, 1e12),
      credited: integer(r.credited, "previous credits", 0, 1e12),
      paid: integer(r.paid, "previous payments", 0, 1e12),
      refunded: integer(r.refunded, "previous refunds", 0, 1e12),
      balance: integer(r.balance, "outstanding balance", 1, 1e12),
      lines,
    };
    check(
      document.net === net &&
        document.tax === tax &&
        document.total === net + tax &&
        document.credited === credited &&
        document.refunded <= document.paid &&
        document.balance ===
          document.total -
            document.credited -
            document.paid +
            document.refunded,
      "DOCUMENT_RECONCILIATION",
      "Original lines, credit quantities, cash/refund controls and outstanding balance must reconcile exactly.",
    );
    return {
      sourceId,
      matchKey: number,
      name: customer.name,
      value: document.balance,
      document,
      accountHash: digest(canonical(customer)),
      productHashes,
    };
  }
  apply(
    actor: Actor,
    review: DocumentReview,
    evidence: {
      sourceRef: string;
      sourceHash: string;
      cutoffAt: string;
      batchId: string;
    },
  ): DocumentMapping {
    const current = this.review(actor, review.document, evidence.cutoffAt);
    check(
      canonical(current) === canonical(review),
      "IMPORT_STALE",
      "Document mappings changed since review.",
    );
    const invoiceId = id(),
      d = current.document,
      importedAt = now();
    // Existing native schema requires unique non-null custody keys. Opening keys are provenance namespaces, never orders or shipments; public views expose null links.
    this.store.run(
      "INSERT INTO billing_invoices VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      invoiceId,
      actor.orgId,
      d.accountId,
      `opening:${invoiceId}`,
      `opening:${invoiceId}`,
      d.number,
      this.identity.customer(actor, d.accountId).currency,
      d.net,
      d.tax,
      d.total,
      d.issuedAt,
    );
    this.store.run(
      "INSERT INTO billing_opening_documents VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      invoiceId,
      actor.orgId,
      evidence.sourceRef,
      d.sourceId,
      evidence.batchId,
      evidence.sourceHash,
      evidence.cutoffAt,
      d.issuedAt,
      d.dueAt,
      d.credited,
      d.paid,
      d.refunded,
      d.balance,
      actor.id,
      importedAt,
    );
    for (const l of d.lines) {
      const lineId = id();
      this.store.run(
        "INSERT INTO billing_lines VALUES(?,?,?,?,?,?,?,?)",
        lineId,
        actor.orgId,
        invoiceId,
        l.productId,
        l.description,
        l.quantity,
        l.unitPrice,
        l.unitTax,
      );
      this.store.run(
        "INSERT INTO billing_opening_lines VALUES(?,?,?,?)",
        lineId,
        actor.orgId,
        invoiceId,
        l.creditedQuantity,
      );
    }
    this.platform.event(actor, "billing.opening.imported", invoiceId, {
      sourceRef: evidence.sourceRef,
      sourceId: d.sourceId,
      batchId: evidence.batchId,
      total: d.total,
      balance: d.balance,
    });
    return {
      sourceId: d.sourceId,
      invoiceId,
      number: d.number,
      total: d.total,
      balance: d.balance,
    };
  }
}
