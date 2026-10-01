import { check, DomainError, permit, type Actor } from "./core.ts";
import type { Billing } from "./billing.ts";
import type { Identity } from "./iam.ts";
import type { Platform } from "./platform.ts";
import type { Effect, Integration } from "./integration.ts";
import { checkoutUrl } from "../shared/checkout.ts";

// Native money and current permission govern access to a retained provider link.
// Opening a link performs no provider request and never records a payment.
export class IntegrationCheckouts {
  constructor(
    private identity: Identity,
    private billing: Billing,
    private platform: Platform,
    private integration: Integration,
  ) {}
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
    const p = JSON.parse(effect.payload);
    const invoice = this.billing.invoice(actor, effect.reference);
    check(
      p.invoiceId === invoice.id &&
        effect.account_id === invoice.account_id &&
        p.currency === invoice.currency.toLowerCase(),
      "PAYMENT_MISMATCH",
      "Checkout does not match this invoice.",
    );
    check(
      this.billing.totals(actor, invoice.id).balance === p.amount &&
        p.amount > 0,
      "CHECKOUT_BALANCE_CHANGED",
      "Invoice balance changed; finance must review the checkout before sending.",
    );
  }
  describe(actor: Actor, effect: Effect) {
    actor = this.principal(actor);
    check(
      effect.provider === "stripe" && effect.kind === "checkout",
      "STATE",
      "This operation is not an invoice checkout.",
    );
    const invoice = this.billing.invoice(actor, effect.reference),
      payload = JSON.parse(effect.payload),
      base = {
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        amount: payload.amount as number,
        currency: invoice.currency,
      };
    const status = (state: string, message: string, expiresAt?: number) => ({
      ...base,
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
