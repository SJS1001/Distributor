import { account, canonical, check, now, permit, type Actor } from "./core.ts";
import type { Store } from "./database.ts";
import type { Platform } from "./platform.ts";
import type { Billing } from "./billing.ts";

export type RefundStatus =
  "pending" | "requires_action" | "succeeded" | "failed" | "canceled";
export type RefundIntent = {
  refundId: string;
  invoiceId: string;
  paymentId: string;
  paymentAmount: number;
  amount: number;
  currency: string;
};
export const refundStatuses = [
  "pending",
  "requires_action",
  "succeeded",
  "failed",
  "canceled",
] as const;
type RefundRow = {
  id: string;
  org_id: string;
  invoice_id: string;
  payment_id: string;
  amount: number;
  reference: string;
  state: string;
  created_at: string;
  provider: string;
  provider_reference: string | null;
  provider_status: string | null;
};
export class BillingRefunds {
  constructor(
    private store: Store,
    private platform: Platform,
    private billing: Billing,
  ) {
    store.migrate(`
      CREATE TABLE IF NOT EXISTS billing_refund_provider(refund_id TEXT PRIMARY KEY,org_id TEXT NOT NULL,external_ref TEXT NOT NULL,status TEXT NOT NULL,UNIQUE(org_id,external_ref)) STRICT;
      CREATE TABLE IF NOT EXISTS billing_refund_observations(id INTEGER PRIMARY KEY,org_id TEXT NOT NULL,refund_id TEXT NOT NULL,external_ref TEXT NOT NULL,status TEXT NOT NULL,applied INTEGER NOT NULL CHECK(applied IN(0,1)),created_at TEXT NOT NULL) STRICT;
    `);
  }
  get(actor: Actor, refundId: string) {
    const row = this.store.get(
      "SELECT * FROM billing_refunds WHERE org_id=? AND id=?",
      actor.orgId,
      refundId,
    );
    check(row, "NOT_FOUND", "Refund not found.", 404);
    const invoice = this.billing.invoice(actor, String(row.invoice_id));
    const payment = this.store.get(
      "SELECT * FROM billing_payments WHERE org_id=? AND id=? AND invoice_id=?",
      actor.orgId,
      String(row.payment_id),
      invoice.id,
    );
    check(payment, "NOT_FOUND", "Original payment not found.", 404);
    return { row, invoice, payment };
  }
  intent(actor: Actor, refundId: string): RefundIntent {
    permit(actor, ["finance"]);
    const { row, invoice, payment } = this.get(actor, refundId);
    check(
      payment.provider === "stripe" &&
        /^pi_/.test(String(payment.external_ref)),
      "STATE",
      "Refund requires a verified Stripe payment.",
    );
    return {
      refundId,
      invoiceId: invoice.id,
      paymentId: String(payment.external_ref),
      paymentAmount: Number(payment.amount),
      amount: Number(row.amount),
      currency: invoice.currency.toLowerCase(),
    };
  }
  markUnknown(actor: Actor, refundId: string) {
    const { row } = this.get(actor, refundId);
    check(
      row.state === "pending",
      "STATE",
      "Only pending refunds may be sent.",
    );
    this.store.run(
      "UPDATE billing_refunds SET state='unknown' WHERE org_id=? AND id=?",
      actor.orgId,
      refundId,
    );
  }
  observe(
    actor: Actor,
    intent: RefundIntent,
    reference: string,
    result: Record<string, unknown>,
  ) {
    permit(actor, ["finance"]);
    check(
      canonical(this.intent(actor, intent.refundId)) === canonical(intent),
      "REFUND_MISMATCH",
      "Native refund intent changed.",
    );
    check(
      /^re_[a-zA-Z0-9_]+$/.test(reference) &&
        result.refundId === intent.refundId &&
        result.paymentId === intent.paymentId &&
        result.amount === intent.amount &&
        result.currency === intent.currency &&
        refundStatuses.includes(result.status as RefundStatus),
      "REFUND_MISMATCH",
      "Provider refund identity, amount or currency differs from the intent.",
    );
    const old = this.store.get(
      "SELECT * FROM billing_refund_provider WHERE org_id=? AND refund_id=?",
      actor.orgId,
      intent.refundId,
    );
    check(
      !old || old.external_ref === reference,
      "REFUND_MISMATCH",
      "Provider refund identity changed.",
    );
    const bound = this.store.get(
      "SELECT refund_id FROM billing_refund_provider WHERE org_id=? AND external_ref=?",
      actor.orgId,
      reference,
    );
    check(
      !bound || bound.refund_id === intent.refundId,
      "REFUND_MISMATCH",
      "Provider refund is already bound to another request.",
    );
    const status = result.status as RefundStatus;
    // Failed/canceled observations are terminal. Pending observations cannot undo success;
    // a later bank failure can undo success while preserving all earlier observations.
    const applied =
      !old ||
      (old.status !== "failed" &&
        old.status !== "canceled" &&
        (old.status !== "succeeded" ||
          status === "failed" ||
          status === "canceled" ||
          status === "succeeded"));
    this.store.run(
      "INSERT INTO billing_refund_observations(org_id,refund_id,external_ref,status,applied,created_at) VALUES(?,?,?,?,?,?)",
      actor.orgId,
      intent.refundId,
      reference,
      status,
      applied ? 1 : 0,
      now(),
    );
    if (applied) {
      this.store.run(
        "INSERT INTO billing_refund_provider VALUES(?,?,?,?) ON CONFLICT(refund_id) DO UPDATE SET status=excluded.status",
        intent.refundId,
        actor.orgId,
        reference,
        status,
      );
      this.store.run(
        "UPDATE billing_refunds SET state=? WHERE org_id=? AND id=?",
        status === "succeeded"
          ? "completed"
          : status === "failed" || status === "canceled"
            ? "rejected"
            : "unknown",
        actor.orgId,
        intent.refundId,
      );
    }
    this.platform.audit(actor, "billing.refund.observed", intent.refundId, {
      reference,
      status,
      applied,
    });
    return this.store.get(
      "SELECT status FROM billing_refund_provider WHERE refund_id=?",
      intent.refundId,
    )!.status as RefundStatus;
  }
  list(actor: Actor) {
    permit(actor, ["finance", "support"]);
    return this.store
      .all<RefundRow>(
        "SELECT r.*,p.provider,b.external_ref AS provider_reference,b.status AS provider_status FROM billing_refunds r JOIN billing_payments p ON p.id=r.payment_id AND p.org_id=r.org_id LEFT JOIN billing_refund_provider b ON b.refund_id=r.id WHERE r.org_id=? ORDER BY r.created_at DESC,r.id",
        actor.orgId,
      )
      .map((row) => {
        this.get(actor, String(row.id));
        return {
          ...row,
          observations: this.store.all(
            "SELECT status,applied,created_at FROM billing_refund_observations WHERE org_id=? AND refund_id=? ORDER BY id",
            actor.orgId,
            String(row.id),
          ),
        };
      });
  }
  payments(actor: Actor) {
    permit(actor, ["finance", "support"]);
    return this.store
      .all(
        "SELECT p.* FROM billing_payments p JOIN billing_invoices i ON i.id=p.invoice_id AND i.org_id=p.org_id WHERE p.org_id=? ORDER BY p.created_at DESC",
        actor.orgId,
      )
      .filter((row) => {
        this.billing.invoice(actor, String(row.invoice_id));
        return true;
      });
  }
}
