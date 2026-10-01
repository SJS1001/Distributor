import {
  canonical,
  check,
  digest,
  DomainError,
  permit,
  type Actor,
} from "./core.ts";
import type { Database, Store } from "./database.ts";
import type { Billing } from "./billing.ts";
import type { Identity } from "./iam.ts";
import type { Platform } from "./platform.ts";
import type { Effect, Integration } from "./integration.ts";
import { checkoutUrl } from "../shared/checkout.ts";

// Native money and current permission govern access to a retained provider link.
// Opening a link performs no provider request and never records a payment.
export class IntegrationCheckouts {
  private store: Store;
  constructor(
    database: Database,
    private identity: Identity,
    private billing: Billing,
    private platform: Platform,
    private integration: Integration,
  ) {
    this.store = database.owned("integration");
    this.store
      .migrate(`CREATE TABLE IF NOT EXISTS integration_checkout_renewals(successor_id TEXT PRIMARY KEY REFERENCES integration_effects(id),org_id TEXT NOT NULL,invoice_id TEXT NOT NULL,predecessor_id TEXT NOT NULL UNIQUE REFERENCES integration_effects(id),reason TEXT NOT NULL,review_version TEXT NOT NULL,created_at TEXT NOT NULL) STRICT;
      CREATE INDEX IF NOT EXISTS integration_checkout_renewal_invoice ON integration_checkout_renewals(org_id,invoice_id);`);
  }
  invoiceId(effect: Effect): string {
    check(
      effect.provider === "stripe" && effect.kind === "checkout",
      "STATE",
      "This operation is not an invoice checkout.",
    );
    return (
      this.store.get<{ invoice_id: string }>(
        "SELECT invoice_id FROM integration_checkout_renewals WHERE org_id=? AND successor_id=?",
        effect.org_id,
        effect.id,
      )?.invoice_id ?? effect.reference
    );
  }
  successor(effect: Effect) {
    return this.store.get<{ successor_id: string }>(
      "SELECT successor_id FROM integration_checkout_renewals WHERE org_id=? AND predecessor_id=?",
      effect.org_id,
      effect.id,
    );
  }
  current(actor: Actor, invoiceId: string) {
    return this.store.get<Effect>(
      `SELECT e.* FROM integration_effects e LEFT JOIN integration_checkout_renewals r ON r.successor_id=e.id AND r.org_id=e.org_id
      WHERE e.org_id=? AND e.provider='stripe' AND e.kind='checkout' AND ((r.successor_id IS NULL AND e.reference=?) OR r.invoice_id=?)
      AND NOT EXISTS(SELECT 1 FROM integration_checkout_renewals s WHERE s.org_id=e.org_id AND s.predecessor_id=e.id)`,
      actor.orgId,
      invoiceId,
      invoiceId,
    );
  }
  reviewVersion(effect: Effect) {
    return digest(
      canonical({
        id: effect.id,
        state: effect.state,
        reference: effect.external_ref,
        result: effect.result,
        error: effect.error,
        successor: this.successor(effect)?.successor_id ?? null,
      }),
    );
  }
  private proof(effect: Effect) {
    const payload = JSON.parse(effect.payload);
    let result: Record<string, unknown> | null = null;
    try {
      result = JSON.parse(effect.result ?? "null");
    } catch {
      /* Historical invalid receipts remain blocked. */
    }
    return result &&
      result.amount === payload.amount &&
      result.currency === payload.currency &&
      /^cs_test_[a-zA-Z0-9_]+$/.test(effect.external_ref ?? "") &&
      ["open", "complete", "expired"].includes(String(result.status)) &&
      ["unpaid", "paid", "no_payment_required"].includes(
        String(result.paymentStatus),
      ) &&
      Number.isSafeInteger(result.expiresAt) &&
      Number(result.expiresAt) > 0
      ? result
      : null;
  }
  assertReplaceable(actor: Actor, effect: Effect) {
    this.assertIdentity(actor, effect);
    permit(actor, ["finance"]);
    check(
      !actor.accountId,
      "FORBIDDEN",
      "Buyer principals cannot replace checkout.",
      403,
    );
    check(
      !this.successor(effect),
      "CHECKOUT_SUPERSEDED",
      "This checkout has already been replaced.",
    );
    check(
      !this.store.get(
        "SELECT token FROM integration_operation_leases WHERE org_id=? AND effect_id=? AND token IS NOT NULL",
        actor.orgId,
        effect.id,
      ),
      "STATE",
      "Checkout verification is already in progress.",
    );
    const proof = this.proof(effect);
    check(
      (effect.state === "pending" && !effect.external_ref && !effect.error) ||
        (effect.state === "completed" &&
          !effect.error &&
          proof?.status === "expired" &&
          proof.paymentStatus === "unpaid"),
      "CHECKOUT_REVIEW_REQUIRED",
      "Reconcile the existing checkout and confirm it expired unpaid before replacement. An unsent pending checkout may also be replaced.",
    );
  }
  assertClosable(actor: Actor, effect: Effect) {
    this.assertIdentity(actor, effect);
    permit(actor, ["finance"]);
    check(
      !actor.accountId,
      "FORBIDDEN",
      "Buyer principals cannot close checkout.",
      403,
    );
    check(
      !this.successor(effect),
      "CHECKOUT_SUPERSEDED",
      "This checkout has already been replaced.",
    );
    const proof = this.proof(effect);
    check(
      effect.state === "completed" &&
        !effect.error &&
        proof?.paymentStatus === "unpaid" &&
        ["open", "expired"].includes(String(proof.status)),
      "CHECKOUT_REVIEW_REQUIRED",
      "Refresh and reconcile checkout before closing it; completed payments cannot be closed.",
    );
  }
  private principal(actor: Actor) {
    actor = this.identity.currentActor(actor);
    permit(actor, ["finance", "support", "commercial", "buyer"]);
    check(
      !this.identity.security(actor).passwordChangeRequired,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before reviewing checkout.",
      403,
    );
    return actor;
  }
  assertReadyToSend(actor: Actor, effect: Effect) {
    if (effect.provider !== "stripe" || effect.kind !== "checkout") return;
    const invoice = this.assertIdentity(actor, effect);
    const p = JSON.parse(effect.payload);
    check(
      !this.successor(effect),
      "CHECKOUT_SUPERSEDED",
      "This checkout has already been replaced.",
    );
    check(
      this.billing.totals(actor, invoice.id).balance === p.amount &&
        p.amount > 0,
      "CHECKOUT_BALANCE_CHANGED",
      "Invoice balance changed; finance must review the checkout before sending.",
    );
  }
  private assertIdentity(actor: Actor, effect: Effect) {
    const p = JSON.parse(effect.payload);
    const invoice = this.billing.invoice(actor, this.invoiceId(effect));
    check(
      p.invoiceId === invoice.id &&
        effect.account_id === invoice.account_id &&
        p.currency === invoice.currency.toLowerCase() &&
        Number.isSafeInteger(p.amount) &&
        p.amount > 0,
      "PAYMENT_MISMATCH",
      "Checkout does not match this invoice.",
    );
    return invoice;
  }
  describe(actor: Actor, effect: Effect) {
    actor = this.principal(actor);
    check(
      effect.provider === "stripe" && effect.kind === "checkout",
      "STATE",
      "This operation is not an invoice checkout.",
    );
    const invoice = this.billing.invoice(actor, this.invoiceId(effect)),
      payload = JSON.parse(effect.payload),
      proof = this.proof(effect),
      finance = ["admin", "finance"].includes(actor.role) && !actor.accountId,
      available = !effect.error && !this.successor(effect),
      base = {
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        amount: payload.amount as number,
        currency: invoice.currency,
        currentBalance: this.billing.totals(actor, invoice.id).balance,
        reviewVersion: this.reviewVersion(effect),
        replacementReason: this.store.get<{ reason: string }>(
          "SELECT reason FROM integration_checkout_renewals WHERE org_id=? AND successor_id=?",
          actor.orgId,
          effect.id,
        )?.reason,
        canRenew:
          finance &&
          available &&
          ((effect.state === "pending" && !effect.external_ref) ||
            (effect.state === "completed" &&
              proof?.status === "expired" &&
              proof.paymentStatus === "unpaid")),
        canClose:
          finance &&
          available &&
          effect.state === "completed" &&
          proof?.paymentStatus === "unpaid" &&
          ["open", "expired"].includes(String(proof.status)),
      };
    const status = (state: string, message: string, expiresAt?: number) => ({
      ...base,
      canRenew:
        base.canRenew &&
        base.currentBalance > 0 &&
        !["blocked", "paid"].includes(state),
      canClose: base.canClose && state !== "blocked",
      state,
      message,
      ...(expiresAt ? { expiresAt } : {}),
    });
    if (this.platform.recoveryHold())
      return status(
        "blocked",
        "Checkout is paused until restore recovery is cleared.",
      );
    try {
      this.identity.providerAllowed(actor, invoice.account_id, "stripe");
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      return status(
        "blocked",
        "Review the customer's current Stripe processing permission before checkout.",
      );
    }
    if (this.successor(effect))
      return status(
        "superseded",
        "This checkout was replaced after finance review. Use the current invoice checkout.",
      );
    const balance = this.billing.totals(actor, invoice.id).balance;
    if (balance <= 0)
      return status("paid", "This invoice has no amount left to pay.");
    if (
      payload.invoiceId !== invoice.id ||
      effect.account_id !== invoice.account_id ||
      payload.currency !== invoice.currency.toLowerCase() ||
      payload.amount !== balance
    )
      return status(
        "balance-changed",
        "Invoice balance changed; contact finance to review the payment amount.",
      );
    if (effect.state !== "completed")
      return status(
        effect.state,
        effect.state === "unknown"
          ? "Finance must reconcile the existing checkout before another payment attempt."
          : "Awaiting configured payment processing.",
      );
    if (effect.error)
      return status(
        "unverified",
        "Finance must refresh the checkout status before opening it.",
      );
    let result: Record<string, unknown>;
    try {
      result = JSON.parse(effect.result ?? "null");
    } catch {
      return status("unverified", "Finance must review the checkout receipt.");
    }
    if (
      !result ||
      result.amount !== payload.amount ||
      result.currency !== payload.currency ||
      !/^cs_test_[a-zA-Z0-9_]+$/.test(effect.external_ref ?? "") ||
      !["open", "complete", "expired"].includes(String(result.status)) ||
      !["unpaid", "paid", "no_payment_required"].includes(
        String(result.paymentStatus),
      ) ||
      typeof result.expiresAt !== "number" ||
      !Number.isSafeInteger(result.expiresAt) ||
      result.expiresAt <= 0
    )
      return status(
        "unverified",
        "Finance must refresh the checkout status before opening it.",
      );
    if (result.status === "complete" || result.paymentStatus !== "unpaid")
      return status(
        "complete",
        "Checkout finished; finance must verify the payment before it changes the invoice.",
      );
    if (result.status === "expired" || result.expiresAt * 1000 <= Date.now())
      return status(
        "expired",
        "Checkout expired; contact finance for a reviewed payment method.",
        result.expiresAt,
      );
    if (!checkoutUrl(result.checkoutUrl))
      return status("unverified", "Finance must review the checkout address.");
    if (!["admin", "finance", "buyer"].includes(actor.role))
      return status("blocked", "Only the buyer or finance can open checkout.");
    return status(
      "ready",
      "Current invoice amount is ready for checkout.",
      result.expiresAt,
    );
  }
  open(actor: Actor, effectId: string) {
    actor = this.principal(actor);
    permit(actor, ["finance", "buyer"]);
    const effect = this.integration.effect(actor, effectId),
      status = this.describe(actor, effect);
    check(status.state === "ready", "CHECKOUT_UNAVAILABLE", status.message);
    const url = checkoutUrl(JSON.parse(effect.result!).checkoutUrl);
    check(url, "CHECKOUT_UNAVAILABLE", "Checkout address is unavailable.");
    return { ...status, url };
  }
}
