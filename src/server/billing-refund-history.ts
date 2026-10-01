import { check, integer, permit, text, type Actor } from "./core.ts";
import type { Database, Store } from "./database.ts";
import type { Identity } from "./iam.ts";
import type { BillingRefunds } from "./billing-refunds.ts";
import type {
  RefundPage,
  RefundSummary,
  RefundObservationPage,
  RefundObservation,
} from "../shared/refund-history.ts";

export class BillingRefundHistory {
  constructor(
    private database: Database,
    private store: Store,
    private identity: Identity,
    private refunds: BillingRefunds,
  ) {}
  reader(actor: Actor) {
    actor = this.identity.currentActor(actor);
    permit(actor, ["finance", "support"]);
    check(
      !this.identity.security(actor).passwordChangeRequired,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before reviewing cash refunds.",
      403,
    );
    return actor;
  }
  page(actor: Actor, after?: string): RefundPage {
    return this.database.transaction(() => {
      actor = this.reader(actor);
      const cursor =
        after === undefined
          ? undefined
          : this.store.get<{ id: string; created_at: string }>(
              "SELECT r.id,r.created_at FROM billing_refunds r JOIN billing_invoices i ON i.org_id=r.org_id AND i.id=r.invoice_id JOIN billing_payments p ON p.org_id=r.org_id AND p.id=r.payment_id AND p.invoice_id=r.invoice_id WHERE r.org_id=? AND r.id=?",
              actor.orgId,
              text(after, "Refund cursor", 128),
            );
      check(
        after === undefined || cursor,
        "CURSOR",
        "Refund cursor is unavailable in your current scope.",
        400,
      );
      const rows = this.store.all<RefundSummary>(
        `SELECT r.id,r.invoice_id,r.payment_id,r.amount,r.reference,r.state,r.created_at,p.provider,b.external_ref AS provider_reference,b.status AS provider_status,i.number AS invoiceNumber,i.currency FROM billing_refunds r JOIN billing_invoices i ON i.org_id=r.org_id AND i.id=r.invoice_id JOIN billing_payments p ON p.org_id=r.org_id AND p.id=r.payment_id AND p.invoice_id=r.invoice_id LEFT JOIN billing_refund_provider b ON b.org_id=r.org_id AND b.refund_id=r.id WHERE r.org_id=?${cursor ? " AND (r.created_at<? OR (r.created_at=? AND r.id<?))" : ""} ORDER BY r.created_at DESC,r.id DESC LIMIT 21`,
        actor.orgId,
        ...(cursor ? [cursor.created_at, cursor.created_at, cursor.id] : []),
      );
      return {
        items: rows.slice(0, 20),
        next: rows.length > 20 ? rows[19]!.id : null,
      };
    });
  }
  observations(
    actor: Actor,
    refundId: string,
    after?: number,
  ): RefundObservationPage {
    return this.database.transaction(() => {
      actor = this.reader(actor);
      refundId = text(refundId, "Refund", 128);
      this.refunds.get(actor, refundId);
      const cursor =
        after === undefined
          ? null
          : integer(
              after,
              "Refund observation cursor",
              1,
              Number.MAX_SAFE_INTEGER,
            );
      check(
        cursor === null ||
          this.store.get(
            "SELECT id FROM billing_refund_observations WHERE org_id=? AND refund_id=? AND id=?",
            actor.orgId,
            refundId,
            cursor,
          ),
        "CURSOR",
        "Refund observation cursor is unavailable in your current scope.",
        400,
      );
      const rows = this.store.all<
        Omit<RefundObservation, "applied"> & { applied: number }
      >(
        "SELECT id,external_ref AS reference,status,applied,created_at AS observedAt FROM billing_refund_observations WHERE org_id=? AND refund_id=? AND (? IS NULL OR id<?) ORDER BY id DESC LIMIT 21",
        actor.orgId,
        refundId,
        cursor,
        cursor,
      );
      return {
        items: rows
          .slice(0, 20)
          .map((row) => ({ ...row, applied: !!row.applied })),
        next: rows.length > 20 ? rows[19]!.id : null,
      };
    });
  }
}
