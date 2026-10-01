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
import type { Database, Store } from "./database.ts";
import type { Identity } from "./iam.ts";
import type { Platform } from "./platform.ts";
import type { Billing } from "./billing.ts";
import { renderDocument, rendererHash } from "./document-pdf.ts";

export type DocumentKind = "invoice" | "credit";
type Party = {
  name: string;
  address: string;
  taxRegistration: string;
  version: number;
};
type Profile = Party & {
  termDays: number | null;
  reason: string;
  updatedAt: string;
};
export type DocumentFacts = {
  kind: DocumentKind;
  documentId: string;
  accountId: string;
  number: string;
  issuedAt: string;
  dueAt: string | null;
  capturedAt: string;
  currency: string;
  issuer: Party;
  customer: Party;
  identityBasis: string;
  terms: { days: number | null; version: number; basis: string };
  net: number;
  tax: number;
  total: number;
  lines: {
    description: string;
    quantity: number;
    unitPrice: number;
    unitTax: number;
  }[];
  originalNumber?: string;
  reason?: string;
  reference?: string;
  opening?: {
    sourceRef: string;
    sourceId: string;
    cutoffAt: string;
    credited: number;
    paid: number;
    refunded: number;
    balance: number;
  };
};
type FactsRow = { facts: string; hash: string };
const readers = [
  "finance",
  "commercial",
  "buyer",
  "warranty",
  "support",
] as const;
const day = (timestamp: string) =>
  Date.parse(timestamp.slice(0, 10) + "T00:00:00.000Z");
const contentHash = (bytes: Uint8Array) => digest(Buffer.from(bytes));

export class BillingDocuments {
  private store: Store;
  constructor(
    database: Database,
    private platform: Platform,
    private identity: Identity,
    private billing: Billing,
  ) {
    this.store = database.owned("billing");
    this.store.migrate(`
      CREATE TABLE IF NOT EXISTS billing_profiles(org_id TEXT NOT NULL,target_id TEXT NOT NULL,version INTEGER NOT NULL,profile TEXT NOT NULL,PRIMARY KEY(org_id,target_id)) STRICT;
      CREATE TABLE IF NOT EXISTS billing_document_facts(org_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('invoice','credit')),document_id TEXT NOT NULL,account_id TEXT NOT NULL,hash TEXT NOT NULL,facts TEXT NOT NULL,PRIMARY KEY(org_id,kind,document_id)) STRICT;
      CREATE TABLE IF NOT EXISTS billing_document_renditions(org_id TEXT NOT NULL,kind TEXT NOT NULL,document_id TEXT NOT NULL,facts_hash TEXT NOT NULL,renderer_hash TEXT NOT NULL,bytes BLOB NOT NULL,content_hash TEXT NOT NULL,generated_at TEXT NOT NULL,PRIMARY KEY(org_id,kind,document_id)) STRICT;
      CREATE TABLE IF NOT EXISTS billing_downloads(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,account_id TEXT NOT NULL,actor_id TEXT NOT NULL,kind TEXT NOT NULL,document_id TEXT NOT NULL,number TEXT NOT NULL,filename TEXT NOT NULL,content_hash TEXT NOT NULL,size INTEGER NOT NULL,requested_at TEXT NOT NULL,state TEXT NOT NULL CHECK(state='prepared')) STRICT;
    `);
  }
  private current(actor: Actor) {
    const current = this.identity.currentActor(actor);
    permit(current, [...readers]);
    return current;
  }
  private authorize(actor: Actor, kind: DocumentKind, documentId: string) {
    actor = this.current(actor);
    check(
      kind === "invoice" || kind === "credit",
      "VALIDATION",
      "Invalid document kind.",
      400,
    );
    if (kind === "invoice") return this.billing.invoice(actor, documentId);
    const credit = this.store.get(
      "SELECT * FROM billing_credits WHERE org_id=? AND id=?",
      actor.orgId,
      documentId,
    );
    check(credit, "NOT_FOUND", "Credit note not found.", 404);
    return this.billing.invoice(actor, String(credit.invoice_id));
  }
  private profile(actor: Actor, accountId: string | null): Profile {
    const row = this.store.get(
      "SELECT profile FROM billing_profiles WHERE org_id=? AND target_id=?",
      actor.orgId,
      accountId ?? "issuer",
    );
    return row
      ? JSON.parse(String(row.profile))
      : {
          name: accountId
            ? this.identity.customer(actor, accountId).name
            : this.identity.organization(actor).name,
          address: "",
          taxRegistration: "",
          termDays: null,
          reason: "Not configured",
          version: 0,
          updatedAt: "",
        };
  }
  profiles(actor: Actor) {
    actor = this.current(actor);
    permit(actor, ["finance"]);
    return {
      issuer: this.profile(actor, null),
      customers: this.identity
        .customers(actor)
        .map((c) => ({ accountId: c.id, ...this.profile(actor, c.id) })),
    };
  }
  configure(
    actor: Actor,
    key: string,
    input: {
      accountId: string | null;
      name: string;
      address: string;
      taxRegistration: string;
      termDays: number | null;
      version: number;
      reason: string;
    },
  ) {
    actor = this.identity.currentActor(actor);
    return this.platform.command(
      actor,
      "billing.profile",
      key,
      input,
      () => {
        permit(this.identity.currentActor(actor), ["finance"]);
        if (input.accountId !== null)
          this.identity.customer(actor, input.accountId);
        else this.identity.organization(actor);
      },
      () => {
        const previous = this.profile(actor, input.accountId);
        check(
          integer(input.version, "profile version", 0, 1e9) ===
            previous.version,
          "STALE_REVISION",
          "Billing profile changed. Reload before editing.",
        );
        check(
          input.accountId !== null || input.termDays === null,
          "VALIDATION",
          "Issuer profile cannot set customer terms.",
          400,
        );
        const optional = (value: unknown, label: string, max: number) => {
          check(
            typeof value === "string" &&
              value.length <= max &&
              !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value),
            "VALIDATION",
            `${label} is invalid.`,
            400,
          );
          return value.trim();
        };
        const profile: Profile = {
          name: text(
            optional(input.name, "billing name", 200),
            "billing name",
            200,
          ),
          address: optional(input.address, "billing address", 1000),
          taxRegistration: optional(
            input.taxRegistration,
            "tax registration",
            200,
          ),
          termDays:
            input.termDays === null
              ? null
              : integer(input.termDays, "terms days", 0, 365),
          reason: text(
            optional(input.reason, "profile change evidence", 1000),
            "profile change evidence",
            1000,
          ),
          version: previous.version + 1,
          updatedAt: now(),
        };
        this.store.run(
          "INSERT INTO billing_profiles VALUES(?,?,?,?) ON CONFLICT(org_id,target_id) DO UPDATE SET version=excluded.version,profile=excluded.profile",
          actor.orgId,
          input.accountId ?? "issuer",
          profile.version,
          canonical(profile),
        );
        this.platform.audit(
          actor,
          "billing.profile.changed",
          input.accountId ?? "issuer",
          { previous, profile },
        );
        return profile;
      },
    );
  }
  private row(actor: Actor, kind: DocumentKind, documentId: string) {
    return this.store.get<FactsRow>(
      "SELECT facts,hash FROM billing_document_facts WHERE org_id=? AND kind=? AND document_id=?",
      actor.orgId,
      kind,
      documentId,
    );
  }
  private save(actor: Actor, facts: DocumentFacts) {
    check(
      facts.total === facts.net + facts.tax &&
        facts.net ===
          facts.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0) &&
        facts.tax ===
          facts.lines.reduce((s, l) => s + l.quantity * l.unitTax, 0),
      "DOCUMENT_RECONCILIATION",
      "Document facts do not reconcile with original lines.",
    );
    const serialized = canonical(facts),
      hash = digest(serialized);
    this.store.run(
      "INSERT INTO billing_document_facts VALUES(?,?,?,?,?,?)",
      actor.orgId,
      facts.kind,
      facts.documentId,
      facts.accountId,
      hash,
      serialized,
    );
    return facts;
  }
  private read(row: FactsRow): DocumentFacts {
    check(
      digest(row.facts) === row.hash,
      "DOCUMENT_INTEGRITY",
      "Stored document facts failed integrity verification.",
      500,
    );
    return JSON.parse(row.facts);
  }
  // Called by billing inside the same issuance transaction; never records a delivery.
  captureInvoice(actor: Actor, invoiceId: string, atIssue = true) {
    const existing = this.row(actor, "invoice", invoiceId);
    if (existing) return this.read(existing);
    const invoice = this.billing.invoice(actor, invoiceId),
      issuer = this.profile(actor, null),
      customer = this.profile(actor, invoice.account_id),
      opening = invoice.opening;
    const dueAt = opening
      ? String(opening.due_at)
      : atIssue && customer.termDays !== null
        ? new Date(
            Date.parse(invoice.created_at) + customer.termDays * 86400000,
          ).toISOString()
        : null;
    const party = (p: Profile): Party => ({
      name: p.name,
      address: p.address,
      taxRegistration: p.taxRegistration,
      version: p.version,
    });
    return this.save(actor, {
      kind: "invoice",
      documentId: invoice.id,
      accountId: invoice.account_id,
      number: invoice.number,
      issuedAt: invoice.created_at,
      dueAt,
      capturedAt: now(),
      currency: invoice.currency,
      issuer: party(issuer),
      customer: party(customer),
      identityBasis:
        atIssue && !opening
          ? "Captured at native issuance"
          : "Current billing identities at reconstruction; original identities unavailable",
      terms: {
        days: atIssue && !opening ? customer.termDays : null,
        version: atIssue && !opening ? customer.version : 0,
        basis: opening
          ? "Original imported due date"
          : atIssue
            ? customer.termDays === null
              ? "Not recorded at issuance"
              : "Customer billing profile at issuance"
            : "Legacy native due date not recorded",
      },
      net: invoice.net,
      tax: invoice.tax,
      total: invoice.total,
      lines: this.billing.lines(actor, invoiceId).map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unit_price,
        unitTax: l.unit_tax,
      })),
      ...(opening
        ? {
            opening: {
              sourceRef: String(opening.source_ref),
              sourceId: String(opening.source_id),
              cutoffAt: String(opening.cutoff_at),
              credited: Number(opening.credited),
              paid: Number(opening.paid),
              refunded: Number(opening.refunded),
              balance: Number(opening.balance),
            },
          }
        : {}),
    });
  }
  captureCredit(actor: Actor, creditId: string) {
    const existing = this.row(actor, "credit", creditId);
    if (existing) return this.read(existing);
    const credit = this.store.get(
      "SELECT * FROM billing_credits WHERE org_id=? AND id=?",
      actor.orgId,
      creditId,
    );
    check(credit, "NOT_FOUND", "Credit note not found.", 404);
    const original = this.captureInvoice(
      actor,
      String(credit.invoice_id),
      false,
    );
    const { opening: _opening, ...base } = original;
    return this.save(actor, {
      ...base,
      kind: "credit",
      documentId: creditId,
      number: String(credit.number),
      issuedAt: String(credit.created_at),
      capturedAt: now(),
      dueAt: null,
      originalNumber: original.number,
      reason: String(credit.reason),
      reference: String(credit.reference),
      net: Number(credit.net),
      tax: Number(credit.tax),
      total: Number(credit.total),
      lines: this.store
        .all(
          "SELECT l.description,l.unit_price,l.unit_tax,c.quantity FROM billing_credit_lines c JOIN billing_lines l ON l.org_id=c.org_id AND l.id=c.invoice_line_id WHERE c.org_id=? AND c.credit_id=? ORDER BY c.rowid",
          actor.orgId,
          creditId,
        )
        .map((l) => ({
          description: String(l.description),
          quantity: Number(l.quantity),
          unitPrice: Number(l.unit_price),
          unitTax: Number(l.unit_tax),
        })),
    });
  }
  facts(actor: Actor, kind: DocumentKind, documentId: string) {
    this.authorize(actor, kind, documentId);
    const row = this.row(actor, kind, documentId);
    return row ? { hash: row.hash, facts: this.read(row) } : null;
  }
  async download(
    actor: Actor,
    key: string,
    kind: DocumentKind,
    documentId: string,
    reauthenticate: () => Actor = () => this.identity.currentActor(actor),
  ) {
    actor = this.current(actor);
    this.platform.command(
      actor,
      "billing.document.prepare",
      `${kind}:${documentId}`,
      { kind, documentId },
      () => {
        this.authorize(actor, kind, documentId);
      },
      () => {
        if (kind === "invoice") this.captureInvoice(actor, documentId, false);
        else this.captureCredit(actor, documentId);
        return { hash: this.row(actor, kind, documentId)!.hash };
      },
    );
    const row = this.row(actor, kind, documentId)!,
      facts = this.read(row);
    let rendition = this.store.get(
      "SELECT * FROM billing_document_renditions WHERE org_id=? AND kind=? AND document_id=?",
      actor.orgId,
      kind,
      documentId,
    );
    const bytes = rendition
      ? Buffer.from(rendition.bytes as Uint8Array)
      : await renderDocument(facts, row.hash);
    // Rendering may yield. Re-read the session/principal before committing or returning cached bytes.
    const refreshed = reauthenticate();
    check(
      refreshed.id === actor.id && refreshed.orgId === actor.orgId,
      "FORBIDDEN",
      "Document principal changed.",
      403,
    );
    actor = this.current(refreshed);
    const receipt = this.platform.command(
      actor,
      "billing.document.download",
      key,
      { kind, documentId },
      () => {
        this.authorize(actor, kind, documentId);
      },
      () => {
        rendition = this.store.get(
          "SELECT * FROM billing_document_renditions WHERE org_id=? AND kind=? AND document_id=?",
          actor.orgId,
          kind,
          documentId,
        );
        if (!rendition) {
          this.store.run(
            "INSERT INTO billing_document_renditions VALUES(?,?,?,?,?,?,?,?)",
            actor.orgId,
            kind,
            documentId,
            row.hash,
            rendererHash,
            bytes,
            contentHash(bytes),
            now(),
          );
          rendition = this.store.get(
            "SELECT * FROM billing_document_renditions WHERE org_id=? AND kind=? AND document_id=?",
            actor.orgId,
            kind,
            documentId,
          )!;
        }
        this.verifyRendition(rendition, row.hash);
        const receipt = {
          id: id(),
          kind,
          documentId,
          number: facts.number,
          filename: `${kind === "invoice" ? "Invoice" : "Credit"}_${facts.number.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120)}.pdf`,
          contentHash: String(rendition.content_hash),
          size: (rendition.bytes as Uint8Array).length,
          requestedAt: now(),
          state: "prepared",
        };
        this.store.run(
          "INSERT INTO billing_downloads VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
          receipt.id,
          actor.orgId,
          facts.accountId,
          actor.id,
          kind,
          documentId,
          facts.number,
          receipt.filename,
          receipt.contentHash,
          receipt.size,
          receipt.requestedAt,
          receipt.state,
        );
        return receipt;
      },
    );
    rendition = this.store.get(
      "SELECT * FROM billing_document_renditions WHERE org_id=? AND kind=? AND document_id=?",
      actor.orgId,
      kind,
      documentId,
    )!;
    this.verifyRendition(rendition, row.hash);
    check(
      receipt.contentHash === rendition.content_hash,
      "DOCUMENT_INTEGRITY",
      "Download receipt does not match stored bytes.",
      500,
    );
    return { receipt, bytes: Buffer.from(rendition.bytes as Uint8Array) };
  }
  private verifyRendition(row: Record<string, unknown>, factsHash: string) {
    check(
      row.facts_hash === factsHash &&
        row.content_hash === contentHash(row.bytes as Uint8Array),
      "DOCUMENT_INTEGRITY",
      "Stored PDF failed integrity verification.",
      500,
    );
  }
  downloads(actor: Actor) {
    actor = this.current(actor);
    return this.store.all(
      "SELECT id,account_id,actor_id,kind,document_id,number,filename,content_hash,size,requested_at,state FROM billing_downloads WHERE org_id=? AND (? IS NULL OR account_id=?) ORDER BY requested_at DESC,rowid DESC LIMIT 200",
      actor.orgId,
      actor.role === "buyer" ? actor.accountId : null,
      actor.accountId,
    );
  }
  aging(actor: Actor) {
    actor = this.current(actor);
    const observedAt = now(),
      groups = new Map<
        string,
        {
          accountId: string;
          name: string;
          currency: string;
          notDue: number;
          days1to30: number;
          days31to60: number;
          days61to90: number;
          daysOver90: number;
          unknownDue: number;
          open: number;
          creditBalance: number;
          net: number;
          holds: number;
          pendingRefunds: number;
          invoices: unknown[];
        }
      >();
    for (const customer of this.identity.customers(actor))
      groups.set(customer.id, {
        accountId: customer.id,
        name: customer.name,
        currency: customer.currency,
        notDue: 0,
        days1to30: 0,
        days31to60: 0,
        days61to90: 0,
        daysOver90: 0,
        unknownDue: 0,
        open: 0,
        creditBalance: 0,
        net: 0,
        holds: this.billing.exposure(actor, customer.id).holds,
        pendingRefunds: 0,
        invoices: [],
      });
    for (const invoice of this.billing.invoices(actor)) {
      const group = groups.get(invoice.account_id)!;
      const row = this.row(actor, "invoice", invoice.id),
        facts = row ? this.read(row) : null;
      const dueAt = invoice.opening
        ? String(invoice.opening.due_at)
        : (facts?.dueAt ?? null);
      const overdueDays = dueAt
        ? Math.max(0, Math.floor((day(observedAt) - day(dueAt)) / 86400000))
        : null;
      const bucket =
        overdueDays === null
          ? "unknownDue"
          : overdueDays === 0
            ? "notDue"
            : overdueDays <= 30
              ? "days1to30"
              : overdueDays <= 60
                ? "days31to60"
                : overdueDays <= 90
                  ? "days61to90"
                  : "daysOver90";
      const positive = Math.max(0, invoice.balance),
        creditBalance = Math.max(0, -invoice.balance);
      group[bucket] += positive;
      group.open += positive;
      group.creditBalance += creditBalance;
      group.net += invoice.balance;
      const pendingRefunds = Number(
        this.store.get(
          "SELECT COALESCE(SUM(amount),0) AS amount FROM billing_refunds WHERE org_id=? AND invoice_id=? AND state IN('pending','unknown')",
          actor.orgId,
          invoice.id,
        )!.amount,
      );
      group.pendingRefunds += pendingRefunds;
      group.invoices.push({
        id: invoice.id,
        number: invoice.number,
        origin: invoice.origin,
        dueAt,
        dueBasis: invoice.opening
          ? "Original imported due date"
          : (facts?.terms.basis ?? "Legacy native due date not recorded"),
        overdueDays,
        bucket,
        total: invoice.total,
        credited: invoice.credited,
        paid: invoice.paid,
        refunded: invoice.refunded,
        balance: invoice.balance,
        pendingRefunds,
      });
    }
    return {
      observedAt,
      dateBasis:
        "UTC calendar days; current ledger balances, not a historical statement",
      accounts: [...groups.values()],
    };
  }
  agingCsv(actor: Actor) {
    actor = this.current(actor);
    permit(actor, ["finance"]);
    const report = this.aging(actor);
    const cell = (value: unknown) =>
      typeof value === "number"
        ? String(value)
        : `"${String(value)
            .replace(/^(?:\s*[=+@-]|[\t\r\n])/, "'$&")
            .replace(/"/g, '""')}"`;
    const rows: unknown[][] = [
      [
        "observed_at",
        "account_id",
        "customer",
        "currency",
        "not_due_cents",
        "days_1_30_cents",
        "days_31_60_cents",
        "days_61_90_cents",
        "days_over_90_cents",
        "unknown_due_cents",
        "open_cents",
        "credit_balance_cents",
        "net_cents",
        "order_holds_cents",
        "pending_refunds_cents",
      ],
    ];
    report.accounts.forEach((a) =>
      rows.push([
        report.observedAt,
        a.accountId,
        a.name,
        a.currency,
        a.notDue,
        a.days1to30,
        a.days31to60,
        a.days61to90,
        a.daysOver90,
        a.unknownDue,
        a.open,
        a.creditBalance,
        a.net,
        a.holds,
        a.pendingRefunds,
      ]),
    );
    const csv = rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
    this.platform.command(
      actor,
      "billing.aging.export",
      id(),
      { observedAt: report.observedAt, contentHash: digest(csv) },
      () => {
        permit(this.identity.currentActor(actor), ["finance"]);
      },
      () => ({
        observedAt: report.observedAt,
        contentHash: digest(csv),
        accountIds: report.accounts.map((a) => a.accountId),
        state: "prepared",
      }),
    );
    return csv;
  }
}
