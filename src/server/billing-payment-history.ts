import { check, permit, text, type Actor } from "./core.ts";
import type { Database, Store } from "./database.ts";
import type { Identity } from "./iam.ts";
import type { RecordedPayment } from "./billing.ts";
import type { PaymentPage, PaymentSummary } from "../shared/payment-history.ts";

export class BillingPaymentHistory {
  constructor(
    private database: Database,
    private store: Store,
    private identity: Identity,
  ) {}
  private reader(actor: Actor) {
    actor = this.identity.currentActor(actor);
    permit(actor, ["finance", "support"]);
    check(
      !this.identity.security(actor).passwordChangeRequired,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before reviewing cash payments.",
      403,
    );
    return actor;
  }
  // Compatibility projection; the browser uses the bounded page operation.
  list(actor: Actor): RecordedPayment[] {
    return this.database.transaction(() => {
      actor = this.reader(actor);
      return this.store.all<RecordedPayment>(
        "SELECT p.* FROM billing_payments p JOIN billing_invoices i ON i.org_id=p.org_id AND i.id=p.invoice_id WHERE p.org_id=? ORDER BY p.created_at DESC,p.id DESC",
        actor.orgId,
      );
    });
  }
  page(
    actor: Actor,
    after?: string,
    invoiceId?: string,
    accountId?: string,
  ): PaymentPage {
    return this.database.transaction(() => {
      actor = this.reader(actor);
      if (accountId !== undefined) {
        check(
          text(accountId, "Customer", 128) === accountId,
          "VALIDATION",
          "Use the exact customer ID.",
          400,
        );
        this.identity.customer(actor, accountId);
      }
      if (invoiceId !== undefined) {
        invoiceId = text(invoiceId, "Invoice", 128);
        check(
          this.store.get(
            "SELECT id FROM billing_invoices WHERE org_id=? AND id=?",
            actor.orgId,
            invoiceId,
          ),
          "NOT_FOUND",
          "Invoice is unavailable in your current scope.",
          404,
        );
      }
      const cursor =
        after === undefined
          ? undefined
          : this.store.get<{ id: string; created_at: string }>(
              `SELECT p.id,p.created_at FROM billing_payments p JOIN billing_invoices i ON i.org_id=p.org_id AND i.id=p.invoice_id WHERE p.org_id=? AND p.id=?${invoiceId ? " AND p.invoice_id=?" : ""}${accountId ? " AND i.account_id=?" : ""}`,
              actor.orgId,
              text(after, "Payment cursor", 128),
              ...(invoiceId ? [invoiceId] : []),
              ...(accountId ? [accountId] : []),
            );
      check(
        after === undefined || cursor,
        "CURSOR",
        "Payment cursor is unavailable in your current scope.",
        400,
      );
      const rows = this.store.all<PaymentSummary>(
        `SELECT p.id,p.invoice_id,p.amount,p.provider,p.external_ref,p.created_at,i.number AS invoiceNumber,i.currency FROM billing_payments p JOIN billing_invoices i ON i.org_id=p.org_id AND i.id=p.invoice_id WHERE p.org_id=?${invoiceId ? " AND p.invoice_id=?" : ""}${accountId ? " AND i.account_id=?" : ""}${cursor ? " AND (p.created_at<? OR (p.created_at=? AND p.id<?))" : ""} ORDER BY p.created_at DESC,p.id DESC LIMIT 21`,
        actor.orgId,
        ...(invoiceId ? [invoiceId] : []),
        ...(accountId ? [accountId] : []),
        ...(cursor ? [cursor.created_at, cursor.created_at, cursor.id] : []),
      );
      return {
        items: rows.slice(0, 20),
        next: rows.length > 20 ? rows[19]!.id : null,
      };
    });
  }
}
