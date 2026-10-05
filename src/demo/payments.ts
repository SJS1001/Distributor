import Stripe from "stripe";
import { DemoAccounting } from "./accounting.ts";
import type { PaymentScenario } from "./scenarios.ts";
import { randomBytes } from "node:crypto";
import { canonical, digest, check, type Actor } from "../server/core.ts";
import type { Application } from "../server/application.ts";
import type { Effect, EffectResult } from "../server/integration.ts";
import type { RefundIntent } from "../server/billing-refunds.ts";
import {
  ProviderRuntime,
  type Settlement,
  type StripeGateway,
} from "../server/provider-runtime.ts";

/** Per-workspace fictional processor. Only the SDK's offline signature helpers
 * are used; no credentials, environment configuration or network transports. */
export class DemoPayments implements StripeGateway {
  private readonly signatures = new Stripe("sk_test_demo_offline_only")
    .webhooks;
  private readonly results = new Map<string, EffectResult>();
  private readonly payments = new Map<string, Settlement>();
  private readonly identities = new Map<string, string>();
  constructor(private readonly scenario: PaymentScenario = "success") {}
  private identity(effect: Effect) {
    return digest(
      canonical({
        org: effect.org_id,
        account: effect.account_id,
        provider: effect.provider,
        kind: effect.kind,
        reference: effect.reference,
        payload: effect.payload,
      }),
    );
  }
  private previous(effect: Effect) {
    const identity = this.identities.get(effect.id);
    check(
      !identity || identity === this.identity(effect),
      "PAYMENT_MISMATCH",
      "Simulated payment request changed after delivery.",
    );
    return this.results.get(effect.id);
  }

  async execute(effect: Effect, beforeWrite: () => void = () => {}) {
    check(
      effect.provider === "stripe" &&
        ["checkout", "refund"].includes(effect.kind),
      "PROVIDER_OPERATION",
      "This demo processor only supports checkout and refund.",
    );
    const previous = this.previous(effect);
    if (previous) return structuredClone(previous);
    const suffix = effect.id.replaceAll("-", "");
    let result: EffectResult;
    let settlement: Settlement | undefined;
    if (effect.kind === "checkout") {
      const payload = JSON.parse(effect.payload) as {
        amount: number;
        currency: string;
      };
      const paid = !["unpaid", "expired"].includes(this.scenario);
      result = {
        reference: `cs_test_demo_${suffix}`,
        result: {
          amount: payload.amount,
          currency: payload.currency,
          checkoutUrl: null,
          status: paid
            ? "complete"
            : this.scenario === "expired"
              ? "expired"
              : "open",
          paymentStatus: paid ? "paid" : "unpaid",
          expiresAt:
            Math.floor(Date.now() / 1000) +
            (this.scenario === "expired" ? -1 : 1800),
          simulated: true,
        },
      };
      if (paid)
        settlement = {
          paid: true,
          amount: payload.amount,
          currency: payload.currency,
          paymentId: `pi_demo_${suffix}`,
          effectId: effect.id,
          livemode: false,
        };
    } else {
      const payload = JSON.parse(effect.payload) as RefundIntent;
      const payment = [...this.payments.values()].find(
        (p) => p.paymentId === payload.paymentId,
      );
      check(
        payment &&
          payment.amount === payload.paymentAmount &&
          payment.currency === payload.currency &&
          payload.amount > 0 &&
          payload.amount <= payment.amount,
        "REFUND_MISMATCH",
        "Refund must refer to this workspace's simulated payment.",
      );
      const refunded = [...this.results.values()].reduce(
        (sum, r) =>
          r.result.paymentId === payload.paymentId &&
          r.result.status !== "failed"
            ? sum + Number(r.result.amount)
            : sum,
        0,
      );
      check(
        refunded + payload.amount <= payment.amount,
        "REFUND_MISMATCH",
        "Simulated payment is already refunded.",
      );
      result = {
        reference: `re_demo_${suffix}`,
        result: {
          effectId: effect.id,
          refundId: payload.refundId,
          paymentId: payload.paymentId,
          amount: payload.amount,
          currency: payload.currency,
          status:
            this.scenario === "pending-refund"
              ? "pending"
              : this.scenario === "failed-refund"
                ? "failed"
                : "succeeded",
          simulated: true,
        },
      };
    }
    beforeWrite();
    this.identities.set(effect.id, this.identity(effect));
    this.results.set(effect.id, structuredClone(result));
    if (settlement) this.payments.set(result.reference, settlement);
    return structuredClone(result);
  }
  async lookup(effect: Effect) {
    return structuredClone(this.previous(effect) ?? null);
  }
  async expireCheckout(effect: Effect, beforeWrite: () => void = () => {}) {
    const result = this.previous(effect);
    check(
      result && effect.kind === "checkout",
      "NOT_FOUND",
      "Simulated checkout not found.",
    );
    beforeWrite();
    if (result.result.status === "open") {
      result.result.status = "expired";
      result.result.expiresAt = Math.floor(Date.now() / 1000);
    }
    return structuredClone(result);
  }
  verifyWebhook(raw: Buffer, signature: string, secret: string) {
    return this.signatures.constructEvent(raw, signature, secret);
  }
  async verifySettlement(sessionId: string) {
    const payment = this.payments.get(sessionId);
    check(
      payment,
      "NOT_FOUND",
      "Simulated payment not found in this workspace.",
    );
    return structuredClone(payment);
  }
  completedEvent(effectId: string, secret: string) {
    const result = this.results.get(effectId);
    if (!result || !this.payments.has(result.reference)) return null;
    const raw = JSON.stringify({
      id: `evt_demo_${effectId.replaceAll("-", "")}`,
      object: "event",
      type: "checkout.session.completed",
      livemode: false,
      data: {
        object: {
          id: result.reference,
          object: "checkout.session",
          mode: "payment",
          livemode: false,
          metadata: { effect_id: effectId },
        },
      },
    });
    return {
      raw: Buffer.from(raw),
      signature: this.signatures.generateTestHeaderString({
        payload: raw,
        secret,
      }),
    };
  }
}

/** Normal durable callback receipts and worker settlement, with fictional transport. */
export class DemoProviderRuntime extends ProviderRuntime {
  private readonly signingSecret: string;
  private readonly processor: DemoPayments;
  private readonly undelivered = new Set<string>();
  constructor(
    app: Application,
    actor: Actor,
    scenario: PaymentScenario = "success",
  ) {
    const processor = new DemoPayments(scenario);
    const secret = `whsec_${randomBytes(32).toString("hex")}`;
    super(app, [
      {
        id: "demo",
        orgId: actor.orgId,
        workerUserId: actor.id,
        stripe: { adapter: processor, webhookSecret: secret },
        quickbooks: new DemoAccounting(),
      },
    ]);
    this.processor = processor;
    this.signingSecret = secret;
  }
  override async execute(actor: Actor, effectId: string) {
    const result = await super.execute(actor, effectId);
    this.undelivered.add(effectId);
    this.deliver(effectId);
    return result;
  }
  private deliver(effectId: string) {
    const event = this.processor.completedEvent(effectId, this.signingSecret);
    if (event) this.receiveStripe("demo", event.raw, event.signature);
    this.undelivered.delete(effectId);
  }
  override async tick(limit = 20) {
    // Like a processor retrying delivery after a temporary permission failure,
    // retain undelivered events until the native durable receipt accepts them.
    for (const effectId of this.undelivered) this.deliver(effectId);
    return super.tick(limit);
  }
}
