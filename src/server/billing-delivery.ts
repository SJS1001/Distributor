import {
  account,
  check,
  digest,
  id,
  integer,
  now,
  permit,
  text,
  type Actor,
  type Row,
} from "./core.ts";
import type { Database, Store } from "./database.ts";
import type { Identity } from "./iam.ts";
import type { Platform } from "./platform.ts";
import type { BillingDocuments, DocumentKind } from "./billing-documents.ts";

const readers = [
  "finance",
  "commercial",
  "buyer",
  "warranty",
  "support",
] as const;
export const receiptStatement =
  "I confirm receipt of this PDF for my customer account. This does not confirm payment or agreement with its contents.";

export type InboxPageInput = { after?: string; limit?: number };
type HistoryKind = "downloads" | "acknowledgments";

type Publication = Row & {
  id: string;
  state: "available" | "withdrawn";
  revision: number;
};

// Native account-portal delivery, independent of email or payment processors.
export class BillingDelivery {
  private store: Store;
  constructor(
    database: Database,
    private platform: Platform,
    private identity: Identity,
    private documents: BillingDocuments,
  ) {
    this.store = database.owned("billing");
    this.store.migrate(`
      CREATE TABLE IF NOT EXISTS billing_publications(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,account_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('invoice','credit')),document_id TEXT NOT NULL,number TEXT NOT NULL,filename TEXT NOT NULL,facts_hash TEXT NOT NULL,content_hash TEXT NOT NULL,renderer_hash TEXT NOT NULL,size INTEGER NOT NULL,review_download_id TEXT NOT NULL,published_by TEXT NOT NULL,published_at TEXT NOT NULL,reason TEXT NOT NULL,revision INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN('available','withdrawn')),withdrawn_by TEXT,withdrawn_at TEXT,withdrawal_reason TEXT) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS billing_publication_available ON billing_publications(org_id,kind,document_id) WHERE state='available';
      CREATE INDEX IF NOT EXISTS billing_publication_account ON billing_publications(org_id,account_id,published_at);
      CREATE TABLE IF NOT EXISTS billing_portal_downloads(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,publication_id TEXT NOT NULL,account_id TEXT NOT NULL,actor_id TEXT NOT NULL,content_hash TEXT NOT NULL,size INTEGER NOT NULL,requested_at TEXT NOT NULL,state TEXT NOT NULL CHECK(state='prepared')) STRICT;
      CREATE INDEX IF NOT EXISTS billing_portal_download_history ON billing_portal_downloads(org_id,publication_id,actor_id);
      CREATE TABLE IF NOT EXISTS billing_acknowledgments(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,publication_id TEXT NOT NULL,account_id TEXT NOT NULL,actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,download_id TEXT NOT NULL,content_hash TEXT NOT NULL,statement_version INTEGER NOT NULL CHECK(statement_version=1),statement TEXT NOT NULL,acknowledged_at TEXT NOT NULL,UNIQUE(org_id,publication_id,actor_id)) STRICT;
    `);
  }
  private current(actor: Actor) {
    actor = this.identity.currentActor(actor);
    permit(actor, [...readers]);
    return actor;
  }
  private buyer(actor: Actor) {
    actor = this.current(actor);
    check(
      actor.role === "buyer" && actor.accountId,
      "FORBIDDEN",
      "Only a current buyer may confirm receipt for their own account.",
      403,
    );
    return actor;
  }
  private publication(actor: Actor, publicationId: string) {
    const row = this.store.get<Publication>(
      "SELECT * FROM billing_publications WHERE org_id=? AND id=?",
      actor.orgId,
      publicationId,
    );
    check(row, "NOT_FOUND", "Portal document not found.", 404);
    account(actor, String(row.account_id));
    return row;
  }
  private bytes(
    actor: Actor,
    publication: ReturnType<BillingDelivery["publication"]>,
  ) {
    const document = this.documents.publishedRendition(
      actor,
      publication.kind as DocumentKind,
      String(publication.document_id),
    );
    check(
      document.facts.accountId === publication.account_id &&
        document.factsHash === publication.facts_hash &&
        document.contentHash === publication.content_hash &&
        document.rendererHash === publication.renderer_hash &&
        document.bytes.length === publication.size,
      "DOCUMENT_INTEGRITY",
      "Portal publication does not match its original PDF.",
      500,
    );
    return document.bytes;
  }
  private available(actor: Actor, publicationId: string) {
    const publication = this.publication(actor, publicationId);
    check(
      publication.state === "available",
      "DOCUMENT_WITHDRAWN",
      "This portal publication was withdrawn. Contact the distributor.",
    );
    return publication;
  }
  publish(
    actor: Actor,
    key: string,
    input: { downloadId: string; reason: string },
  ) {
    actor = this.current(actor);
    const result = this.platform.command(
      actor,
      "billing.portal.publish",
      key,
      input,
      () => {
        permit(this.identity.currentActor(actor), ["finance"]);
        this.documents.reviewedDownload(actor, input.downloadId);
      },
      () => {
        const reason = text(input.reason, "Publication review evidence", 1000);
        const document = this.documents.reviewedDownload(
          actor,
          input.downloadId,
        );
        check(
          !this.store.get(
            "SELECT id FROM billing_publications WHERE org_id=? AND kind=? AND document_id=? AND state='available'",
            actor.orgId,
            document.facts.kind,
            document.facts.documentId,
          ),
          "ALREADY_PUBLISHED",
          "This document is already available in the customer inbox.",
        );
        const publicationId = id();
        this.store.run(
          "INSERT INTO billing_publications VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          publicationId,
          actor.orgId,
          document.facts.accountId,
          document.facts.kind,
          document.facts.documentId,
          document.facts.number,
          document.filename,
          document.factsHash,
          document.contentHash,
          document.rendererHash,
          document.bytes.length,
          input.downloadId,
          actor.id,
          now(),
          reason,
          1,
          "available",
          null,
          null,
          null,
        );
        this.platform.event(actor, "billing.portal.published", publicationId, {
          accountId: document.facts.accountId,
          kind: document.facts.kind,
          documentId: document.facts.documentId,
          contentHash: document.contentHash,
        });
        return { id: publicationId };
      },
    );
    // A lost publication response retried after withdrawal reports current state.
    return this.publication(actor, result.id);
  }
  withdraw(
    actor: Actor,
    key: string,
    input: { publicationId: string; revision: number; reason: string },
  ) {
    actor = this.current(actor);
    return this.platform.command(
      actor,
      "billing.portal.withdraw",
      key,
      input,
      () => {
        permit(this.identity.currentActor(actor), ["finance"]);
        this.publication(actor, input.publicationId);
      },
      () => {
        const publication = this.available(actor, input.publicationId);
        check(
          integer(input.revision, "Publication revision", 1) ===
            publication.revision,
          "STALE_REVISION",
          "Portal publication changed. Reload before withdrawing.",
        );
        const reason = text(input.reason, "Withdrawal reason", 1000),
          at = now();
        this.store.run(
          "UPDATE billing_publications SET state='withdrawn',revision=revision+1,withdrawn_by=?,withdrawn_at=?,withdrawal_reason=? WHERE org_id=? AND id=?",
          actor.id,
          at,
          reason,
          actor.orgId,
          input.publicationId,
        );
        this.platform.event(
          actor,
          "billing.portal.withdrawn",
          input.publicationId,
          { contentHash: publication.content_hash, reason },
        );
        return {
          id: input.publicationId,
          state: "withdrawn",
          revision: input.revision + 1,
          withdrawnAt: at,
        };
      },
    );
  }
  download(actor: Actor, key: string, publicationId: string) {
    actor = this.buyer(actor);
    const receipt = this.platform.command(
      actor,
      "billing.portal.download",
      key,
      { publicationId },
      () => {
        actor = this.buyer(actor);
        this.bytes(actor, this.available(actor, publicationId));
      },
      () => {
        const publication = this.available(actor, publicationId),
          receipt = {
            id: id(),
            publicationId,
            contentHash: String(publication.content_hash),
            size: Number(publication.size),
            requestedAt: now(),
            state: "prepared",
            filename: String(publication.filename),
          };
        this.store.run(
          "INSERT INTO billing_portal_downloads VALUES(?,?,?,?,?,?,?,?,?)",
          receipt.id,
          actor.orgId,
          publicationId,
          actor.accountId,
          actor.id,
          receipt.contentHash,
          receipt.size,
          receipt.requestedAt,
          receipt.state,
        );
        return receipt;
      },
    );
    const bytes = this.bytes(actor, this.available(actor, publicationId));
    check(
      receipt.contentHash ===
        String(this.publication(actor, publicationId).content_hash),
      "DOCUMENT_INTEGRITY",
      "Portal download receipt does not match this PDF.",
      500,
    );
    return { receipt, bytes };
  }
  acknowledge(
    actor: Actor,
    key: string,
    input: {
      publicationId: string;
      downloadId: string;
      contentHash: string;
      confirmation: "received";
    },
  ) {
    actor = this.buyer(actor);
    return this.platform.command(
      actor,
      "billing.portal.acknowledge",
      key,
      input,
      () => {
        actor = this.buyer(actor);
        const publication = this.available(actor, input.publicationId);
        this.bytes(actor, publication);
        check(
          input.confirmation === "received",
          "VALIDATION",
          "Explicit receipt confirmation is required.",
          400,
        );
        const download = this.store.get(
          "SELECT * FROM billing_portal_downloads WHERE org_id=? AND id=? AND publication_id=? AND actor_id=? AND account_id=?",
          actor.orgId,
          input.downloadId,
          input.publicationId,
          actor.id,
          actor.accountId,
        );
        check(
          download &&
            download.content_hash === publication.content_hash &&
            input.contentHash === publication.content_hash &&
            download.size === publication.size,
          "RECEIPT_MISMATCH",
          "Confirmation must refer to your own download of this exact published PDF.",
        );
      },
      () => {
        const previous = this.store.get(
          "SELECT * FROM billing_acknowledgments WHERE org_id=? AND publication_id=? AND actor_id=?",
          actor.orgId,
          input.publicationId,
          actor.id,
        );
        if (previous) return { ...previous };
        const ackId = id();
        this.store.run(
          "INSERT INTO billing_acknowledgments VALUES(?,?,?,?,?,?,?,?,?,?,?)",
          ackId,
          actor.orgId,
          input.publicationId,
          actor.accountId,
          actor.id,
          actor.name,
          input.downloadId,
          input.contentHash,
          1,
          receiptStatement,
          now(),
        );
        this.platform.event(
          actor,
          "billing.portal.acknowledged",
          input.publicationId,
          {
            acknowledgmentId: ackId,
            contentHash: input.contentHash,
            statementVersion: 1,
          },
        );
        return {
          ...this.store.get(
            "SELECT * FROM billing_acknowledgments WHERE org_id=? AND id=?",
            actor.orgId,
            ackId,
          )!,
        };
      },
    );
  }
  // Cursors select positions only; every query independently applies current access.
  // A high-water rowid excludes later insertions even when timestamps tie/backdate.
  private pageRows(
    actor: Actor,
    table:
      | "billing_publications"
      | "billing_portal_downloads"
      | "billing_acknowledgments",
    where: string,
    values: (string | number | null)[],
    scope: string,
    input: InboxPageInput,
  ) {
    const limit = integer(input.limit ?? 50, "Page size", 1, 100);
    const scopeHash = digest(
      JSON.stringify([
        actor.orgId,
        actor.id,
        actor.role,
        actor.accountId,
        scope,
      ]),
    );
    let high = Number(
      this.store.get(
        `SELECT COALESCE(MAX(rowid),0) AS position FROM ${table} WHERE ${where}`,
        ...values,
      )!.position,
    );
    let before = high + 1;
    if (input.after !== undefined) {
      let token: unknown;
      if (
        typeof input.after === "string" &&
        /^[A-Za-z0-9_-]{1,512}$/.test(input.after)
      ) {
        try {
          token = JSON.parse(
            Buffer.from(input.after, "base64url").toString("utf8"),
          );
        } catch {}
      }
      check(
        Array.isArray(token) &&
          token.length === 4 &&
          token[0] === 1 &&
          Number.isSafeInteger(token[1]) &&
          token[1] > 0 &&
          Number.isSafeInteger(token[2]) &&
          token[2] > 0 &&
          token[2] <= token[1] &&
          token[3] === scopeHash,
        "INVALID_CURSOR",
        "History position is invalid for your current access. Reload the first page.",
        400,
      );
      high = token[1];
      before = token[2];
    }
    const rows = this.store.all(
      `SELECT rowid AS position,* FROM ${table} WHERE ${where} AND rowid<=? AND rowid<? ORDER BY rowid DESC LIMIT ?`,
      ...values,
      high,
      before,
      limit + 1,
    );
    const items = rows.slice(0, limit);
    const next =
      rows.length > limit
        ? Buffer.from(
            JSON.stringify([1, high, items.at(-1)!.position, scopeHash]),
          ).toString("base64url")
        : null;
    return { items: items.map(({ position: _position, ...row }) => row), next };
  }
  private evidence(actor: Actor, publication: Publication, maximum: number) {
    const values = [
      actor.orgId,
      String(publication.id),
      actor.role === "buyer" ? actor.id : null,
      actor.id,
    ];
    const downloads = this.store.all(
      "SELECT id,actor_id,content_hash,size,requested_at,state FROM billing_portal_downloads WHERE org_id=? AND publication_id=? AND (? IS NULL OR actor_id=?) ORDER BY rowid DESC LIMIT ?",
      ...values,
      maximum,
    );
    const acknowledgments = this.store.all(
      "SELECT * FROM billing_acknowledgments WHERE org_id=? AND publication_id=? AND (? IS NULL OR actor_id=?) ORDER BY rowid DESC LIMIT ?",
      ...values,
      maximum,
    );
    const downloadCount = Number(
      this.store.get(
        "SELECT COUNT(*) AS count FROM billing_portal_downloads WHERE org_id=? AND publication_id=? AND (? IS NULL OR actor_id=?)",
        ...values,
      )!.count,
    );
    const acknowledgmentCount = Number(
      this.store.get(
        "SELECT COUNT(*) AS count FROM billing_acknowledgments WHERE org_id=? AND publication_id=? AND (? IS NULL OR actor_id=?)",
        ...values,
      )!.count,
    );
    return {
      ...publication,
      downloads,
      acknowledgments,
      downloadCount,
      acknowledgmentCount,
    };
  }
  page(actor: Actor, input: InboxPageInput = {}) {
    actor = this.current(actor);
    const page = this.pageRows(
      actor,
      "billing_publications",
      "org_id=? AND (? IS NULL OR account_id=?)",
      [
        actor.orgId,
        actor.role === "buyer" ? actor.accountId : null,
        actor.accountId,
      ],
      "publications",
      input,
    );
    return {
      ...page,
      items: page.items.map((p) => this.evidence(actor, p as Publication, 5)),
    };
  }
  history(
    actor: Actor,
    publicationId: string,
    kind: HistoryKind,
    input: InboxPageInput = {},
  ) {
    actor = this.current(actor);
    this.publication(actor, publicationId); // Withdrawal retains readable evidence.
    check(
      kind === "downloads" || kind === "acknowledgments",
      "VALIDATION",
      "Unknown inbox history kind.",
      400,
    );
    const page = this.pageRows(
      actor,
      kind === "downloads"
        ? "billing_portal_downloads"
        : "billing_acknowledgments",
      "org_id=? AND publication_id=? AND (? IS NULL OR actor_id=?)",
      [
        actor.orgId,
        publicationId,
        actor.role === "buyer" ? actor.id : null,
        actor.id,
      ],
      `${publicationId}:${kind}`,
      input,
    );
    return {
      ...page,
      items: page.items.map((row) =>
        kind === "downloads"
          ? {
              id: row.id,
              actor_id: row.actor_id,
              content_hash: row.content_hash,
              size: row.size,
              requested_at: row.requested_at,
              state: row.state,
            }
          : row,
      ),
    };
  }
  list(actor: Actor) {
    actor = this.current(actor);
    // Compatibility endpoint retains its historical bounded shape.
    return this.store
      .all<Publication>(
        "SELECT * FROM billing_publications WHERE org_id=? AND (? IS NULL OR account_id=?) ORDER BY published_at DESC,rowid DESC LIMIT 200",
        actor.orgId,
        actor.role === "buyer" ? actor.accountId : null,
        actor.accountId,
      )
      .map((p) => this.evidence(actor, p, 200));
  }
}
