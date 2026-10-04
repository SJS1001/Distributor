import { check, integer, now, permit, type Actor } from "./core.ts";
import type { Database, Store } from "./database.ts";
import type { Identity } from "./iam.ts";
import type { Platform } from "./platform.ts";
import type { RefundStatus } from "./billing-refunds.ts";

type Notice = {
  seq: number;
  org_id: string;
  refund_id: string;
  invoice_id: string;
  status: RefundStatus;
  state: "open" | "resolved";
  revision: number;
  created_at: string;
  updated_at: string;
};
const needsReview = (status: RefundStatus) =>
  ["failed", "canceled", "requires_action"].includes(status);
const message = (status: RefundStatus) => {
  switch (status) {
    case "failed":
      return "The refund failed. Contact the distributor to review repayment. A previous refund confirmation may have been reversed.";
    case "canceled":
      return "The refund was canceled. Contact the distributor to review repayment.";
    case "requires_action":
      return "The refund needs further review. Contact the distributor using your usual support channel. Do not send bank details or payment credentials through this inbox.";
    case "pending":
      return "The refund is being processed again. A completed repayment has not been confirmed.";
    case "succeeded":
      return "The refund is now confirmed. The earlier exception has been resolved.";
  }
};

export class BillingRefundAlerts {
  constructor(
    private database: Database,
    private store: Store,
    private identity: Identity,
    private platform: Platform,
    startupMaintenance = true,
  ) {
    database.transaction(() => {
      store.migrate(`
        CREATE TABLE IF NOT EXISTS billing_refund_alerts(seq INTEGER PRIMARY KEY,org_id TEXT NOT NULL,refund_id TEXT NOT NULL,invoice_id TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('pending','requires_action','succeeded','failed','canceled')),state TEXT NOT NULL CHECK(state IN('open','resolved')),revision INTEGER NOT NULL CHECK(revision>0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(org_id,refund_id)) STRICT;
        CREATE INDEX IF NOT EXISTS billing_refund_alert_scope ON billing_refund_alerts(org_id,seq);
        CREATE TABLE IF NOT EXISTS billing_refund_alert_updates(org_id TEXT NOT NULL,refund_id TEXT NOT NULL,revision INTEGER NOT NULL,status TEXT NOT NULL,state TEXT NOT NULL,source TEXT NOT NULL CHECK(source IN('observation','existing-state')),created_at TEXT NOT NULL,PRIMARY KEY(org_id,refund_id,revision)) STRICT;
        CREATE TABLE IF NOT EXISTS billing_refund_alert_reads(org_id TEXT NOT NULL,refund_id TEXT NOT NULL,actor_id TEXT NOT NULL,revision INTEGER NOT NULL,acknowledged_at TEXT NOT NULL,PRIMARY KEY(org_id,refund_id,actor_id)) STRICT;
      `);
      if (startupMaintenance) {
        // Existing verified exceptions become visible without reconstructing notices
        // for older transitions. The original observation history remains authoritative.
        store.run(
          `INSERT OR IGNORE INTO billing_refund_alerts(org_id,refund_id,invoice_id,status,state,revision,created_at,updated_at)
        SELECT r.org_id,r.id,r.invoice_id,p.status,'open',1,COALESCE((SELECT MAX(o.created_at) FROM billing_refund_observations o WHERE o.org_id=r.org_id AND o.refund_id=r.id),r.created_at),?
        FROM billing_refunds r JOIN billing_refund_provider p ON p.org_id=r.org_id AND p.refund_id=r.id WHERE p.status IN('failed','canceled','requires_action')`,
          now(),
        );
        store.run(
          `INSERT OR IGNORE INTO billing_refund_alert_updates SELECT org_id,refund_id,revision,status,state,'existing-state',updated_at FROM billing_refund_alerts`,
        );
      }
    });
  }
  private principal(actor: Actor) {
    const current = this.identity.currentActor(actor);
    check(
      !this.identity.security(current).passwordChangeRequired,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before reviewing refund notices.",
      403,
    );
    permit(current, ["finance", "support", "buyer"]);
    return current;
  }
  private scoped(actor: Actor, refundId: string) {
    const row = this.store.get<Notice>(
      `SELECT a.* FROM billing_refund_alerts a JOIN billing_invoices i ON i.org_id=a.org_id AND i.id=a.invoice_id WHERE a.org_id=? AND a.refund_id=? AND (? IS NULL OR i.account_id=?)`,
      actor.orgId,
      refundId,
      actor.role === "buyer" ? (actor.accountId ?? "") : null,
      actor.accountId,
    );
    check(row, "NOT_FOUND", "Refund notice not found.", 404);
    return row;
  }
  // Billing's verified observation transaction owns this write. No provider
  // event payload, bank detail, internal reason or external identity is copied.
  observe(
    actor: Actor,
    refundId: string,
    invoiceId: string,
    status: RefundStatus,
  ) {
    const old = this.store.get<Notice>(
      "SELECT * FROM billing_refund_alerts WHERE org_id=? AND refund_id=?",
      actor.orgId,
      refundId,
    );
    if ((!old && !needsReview(status)) || old?.status === status) return;
    const revision = (old?.revision ?? 0) + 1,
      at = now(),
      state = needsReview(status) ? "open" : "resolved";
    this.store.run(
      `INSERT INTO billing_refund_alerts(org_id,refund_id,invoice_id,status,state,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(org_id,refund_id) DO UPDATE SET status=excluded.status,state=excluded.state,revision=excluded.revision,updated_at=excluded.updated_at`,
      actor.orgId,
      refundId,
      invoiceId,
      status,
      state,
      revision,
      at,
      at,
    );
    this.store.run(
      "INSERT INTO billing_refund_alert_updates VALUES(?,?,?,?,?,'observation',?)",
      actor.orgId,
      refundId,
      revision,
      status,
      state,
      at,
    );
    this.platform.audit(actor, "billing.refund.notice", refundId, {
      revision,
      status,
      state,
    });
  }
  private project(
    actor: Actor,
    row: Notice & {
      number: string;
      account_id: string;
      amount: number;
      currency: string;
      read_revision: number;
    },
  ) {
    return {
      id: row.refund_id,
      invoiceId: row.invoice_id,
      number: row.number,
      ...(actor.role === "buyer" ? {} : { accountId: row.account_id }),
      amount: row.amount,
      currency: row.currency,
      status: row.status,
      state: row.state,
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      acknowledged: row.read_revision >= row.revision,
      message: message(row.status),
    };
  }
  page(actor: Actor, input: { after?: number; limit?: number } = {}) {
    return this.database.transaction(() => {
      actor = this.principal(actor);
      const limit = integer(input.limit ?? 25, "notice page size", 1, 100),
        after =
          input.after === undefined
            ? null
            : integer(
                input.after,
                "notice continuation",
                1,
                Number.MAX_SAFE_INTEGER,
              );
      const scope = actor.role === "buyer" ? (actor.accountId ?? "") : null;
      const rows = this.store.all<
        Notice & {
          number: string;
          account_id: string;
          amount: number;
          currency: string;
          read_revision: number;
        }
      >(
        `SELECT a.*,i.number,i.account_id,i.currency,r.amount,COALESCE(v.revision,0) AS read_revision FROM billing_refund_alerts a JOIN billing_invoices i ON i.org_id=a.org_id AND i.id=a.invoice_id JOIN billing_refunds r ON r.org_id=a.org_id AND r.id=a.refund_id LEFT JOIN billing_refund_alert_reads v ON v.org_id=a.org_id AND v.refund_id=a.refund_id AND v.actor_id=? WHERE a.org_id=? AND (? IS NULL OR i.account_id=?) AND (? IS NULL OR a.seq<?) ORDER BY a.seq DESC LIMIT ?`,
        actor.id,
        actor.orgId,
        scope,
        scope,
        after,
        after,
        limit + 1,
      );
      const unread = Number(
        this.store.get(
          `SELECT COUNT(*) AS n FROM billing_refund_alerts a JOIN billing_invoices i ON i.org_id=a.org_id AND i.id=a.invoice_id LEFT JOIN billing_refund_alert_reads v ON v.org_id=a.org_id AND v.refund_id=a.refund_id AND v.actor_id=? WHERE a.org_id=? AND (? IS NULL OR i.account_id=?) AND COALESCE(v.revision,0)<a.revision`,
          actor.id,
          actor.orgId,
          scope,
          scope,
        )!.n,
      );
      return {
        items: rows.slice(0, limit).map((row) => this.project(actor, row)),
        next: rows.length > limit ? rows[limit - 1]!.seq : null,
        unread,
      };
    });
  }
  history(
    actor: Actor,
    refundId: string,
    input: { after?: number; limit?: number } = {},
  ) {
    return this.database.transaction(() => {
      actor = this.principal(actor);
      this.scoped(actor, refundId);
      const limit = integer(
          input.limit ?? 25,
          "notice history page size",
          1,
          100,
        ),
        after =
          input.after === undefined
            ? null
            : integer(
                input.after,
                "notice history continuation",
                1,
                Number.MAX_SAFE_INTEGER,
              );
      const rows = this.store.all<{
        revision: number;
        status: RefundStatus;
        state: string;
        source: string;
        created_at: string;
      }>(
        "SELECT revision,status,state,source,created_at FROM billing_refund_alert_updates WHERE org_id=? AND refund_id=? AND (? IS NULL OR revision<?) ORDER BY revision DESC LIMIT ?",
        actor.orgId,
        refundId,
        after,
        after,
        limit + 1,
      );
      return {
        items: rows.slice(0, limit).map((row) => ({
          revision: row.revision,
          status: row.status,
          state: row.state,
          source: row.source,
          createdAt: row.created_at,
          message: message(row.status),
        })),
        next: rows.length > limit ? rows[limit - 1]!.revision : null,
      };
    });
  }
  acknowledge(
    actor: Actor,
    key: string,
    input: { noticeId: string; revision: number },
  ) {
    return this.platform.command(
      actor,
      "billing.refund.notice.acknowledge",
      key,
      input,
      () => {
        actor = this.principal(actor);
        this.scoped(actor, input.noticeId);
      },
      () => {
        const row = this.scoped(actor, input.noticeId),
          revision = integer(input.revision, "notice revision", 1);
        check(
          row.revision === revision,
          "STALE",
          "This refund notice changed. Refresh and review its latest status.",
        );
        const at = now();
        this.store.run(
          `INSERT INTO billing_refund_alert_reads VALUES(?,?,?,?,?) ON CONFLICT(org_id,refund_id,actor_id) DO UPDATE SET revision=excluded.revision,acknowledged_at=excluded.acknowledged_at WHERE billing_refund_alert_reads.revision<excluded.revision`,
          actor.orgId,
          input.noticeId,
          actor.id,
          revision,
          at,
        );
        return {
          noticeId: input.noticeId,
          revision,
          acknowledgedAt: String(
            this.store.get(
              "SELECT acknowledged_at FROM billing_refund_alert_reads WHERE org_id=? AND refund_id=? AND actor_id=?",
              actor.orgId,
              input.noticeId,
              actor.id,
            )!.acknowledged_at,
          ),
        };
      },
    );
  }
}
