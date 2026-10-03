import {
  check,
  canonical,
  digest,
  DomainError,
  permit,
  text,
  type Actor,
} from "./core.ts";
import { type Application } from "./application.ts";
import { type Adapter } from "./integration.ts";
import { StripeAdapter, QuickBooksAdapter } from "./providers.ts";
import type Stripe from "stripe";

export type Settlement = {
  paid: boolean;
  amount: number;
  currency: string;
  paymentId: string;
  effectId: string;
  livemode: boolean;
};
export type StripeGateway = Adapter & {
  verifyWebhook(raw: Buffer, signature: string, secret: string): Stripe.Event;
  verifySettlement(sessionId: string): Promise<Settlement>;
};
export type ProviderBinding = {
  id: string;
  orgId: string;
  workerUserId: string;
  stripe?: { adapter: StripeGateway; webhookSecret: string };
  quickbooks?: Adapter;
};

export class ProviderRuntime {
  private bindings: ProviderBinding[];
  constructor(
    private app: Application,
    bindings: ProviderBinding[],
  ) {
    check(
      bindings.length > 0,
      "PROVIDER_CONFIG",
      "No provider bindings configured.",
      500,
    );
    check(
      new Set(bindings.map((b) => b.id)).size === bindings.length &&
        new Set(bindings.map((b) => b.orgId)).size === bindings.length,
      "PROVIDER_CONFIG",
      "Provider bindings must have unique IDs and organizations.",
      500,
    );
    this.bindings = bindings.map((b) => {
      check(
        /^[a-zA-Z0-9_-]{1,80}$/.test(b.id) && (b.stripe || b.quickbooks),
        "PROVIDER_CONFIG",
        "Invalid provider binding.",
        500,
      );
      text(b.orgId, "provider organization");
      text(b.workerUserId, "worker principal");
      if (b.stripe)
        check(
          /^whsec_.+/.test(b.stripe.webhookSecret),
          "PROVIDER_CONFIG",
          "Stripe signing secret is required.",
          500,
        );
      // Fail startup when a configured principal has no current regional finance grant.
      this.app.identity.workerActor(b.orgId, b.workerUserId);
      return { ...b };
    });
  }
  private binding(actor: Actor) {
    this.app.identity.organization(actor);
    const binding = this.bindings.find((b) => b.orgId === actor.orgId);
    check(
      binding,
      "PROVIDER_DISABLED",
      "No provider is configured for this organization.",
      503,
    );
    return binding;
  }
  private adapter(actor: Actor, provider: string): Adapter {
    const binding = this.binding(actor);
    const adapter =
      provider === "stripe"
        ? binding.stripe?.adapter
        : provider === "quickbooks"
          ? binding.quickbooks
          : undefined;
    check(
      adapter,
      "PROVIDER_DISABLED",
      "This provider is not configured for this organization.",
      503,
    );
    return adapter;
  }
  async execute(actor: Actor, effectId: string) {
    permit(actor, ["finance", "support"]);
    const effect = this.app.integration.effect(actor, effectId);
    // Configuration errors precede the durable claim, so they cannot invent an unknown outcome.
    return this.app.integration.execute(
      actor,
      effect.id,
      this.adapter(actor, effect.provider),
    );
  }
  async reconcile(actor: Actor, effectId: string) {
    permit(actor, ["finance", "support"]);
    const effect = this.app.integration.effect(actor, effectId);
    return this.app.integration.reconcile(
      actor,
      effect.id,
      this.adapter(actor, effect.provider),
    );
  }
  async refreshCheckout(actor: Actor, effectId: string) {
    return this.app.integration.refreshCheckout(
      actor,
      effectId,
      this.adapter(actor, "stripe"),
    );
  }
  async closeCheckout(actor: Actor, effectId: string) {
    return this.app.integration.closeCheckout(
      actor,
      effectId,
      this.adapter(actor, "stripe"),
    );
  }
  async refreshRefund(actor: Actor, effectId: string) {
    const effect = this.app.integration.effect(actor, effectId);
    return this.app.integration.refunds.run(
      actor,
      effectId,
      this.adapter(actor, "stripe"),
      false,
    );
  }
  async refreshAccountingBalance(actor: Actor, effectId: string, key: string) {
    return this.app.integration.balances.refresh(
      actor,
      effectId,
      key,
      this.adapter(actor, "quickbooks"),
    );
  }
  receiveStripe(bindingId: string, raw: Buffer, signature: unknown) {
    const binding = this.bindings.find((b) => b.id === bindingId);
    check(binding?.stripe, "NOT_FOUND", "Webhook endpoint not found.", 404);
    check(
      typeof signature === "string" && signature.length <= 2000,
      "WEBHOOK_SIGNATURE",
      "Stripe signature is missing or invalid.",
      400,
    );
    let event: Stripe.Event;
    try {
      event = binding.stripe.adapter.verifyWebhook(
        raw,
        signature,
        binding.stripe.webhookSecret,
      );
    } catch {
      throw new DomainError(
        "WEBHOOK_SIGNATURE",
        "Stripe signature is missing or invalid.",
        400,
      );
    }
    check(
      event.livemode === false && !event.account,
      "WEBHOOK_SCOPE",
      "Only this binding's test account events are supported.",
      400,
    );
    const actor = this.app.identity.workerActor(
      binding.orgId,
      binding.workerUserId,
    );
    if (
      ["refund.created", "refund.updated", "refund.failed"].includes(event.type)
    ) {
      const refund = event.data.object as Stripe.Refund;
      check(
        refund.object === "refund" && /^re_[a-zA-Z0-9_]+$/.test(refund.id),
        "WEBHOOK_SCOPE",
        "Unsupported refund event.",
        400,
      );
      // Manual/provider-created refunds without Distributor markers belong to separate reconciliation.
      if (!refund.metadata?.effect_id && !refund.metadata?.refund_id)
        return { received: true, ignored: true };
      const eventId = text(event.id, "Stripe event ID"),
        effectId = text(
          refund.metadata?.effect_id,
          "Distributor refund operation",
        ),
        refundId = text(
          refund.metadata?.refund_id,
          "Distributor refund identity",
        ),
        paymentId =
          typeof refund.payment_intent === "string"
            ? refund.payment_intent
            : refund.payment_intent?.id;
      check(
        /^evt_[a-zA-Z0-9_]+$/.test(eventId) &&
          typeof paymentId === "string" &&
          /^pi_[a-zA-Z0-9_]+$/.test(paymentId),
        "WEBHOOK_SCOPE",
        "Invalid refund event identity.",
        400,
      );
      const receipt = this.app.integration.refundCallbacks.receive(actor, {
        bindingId: binding.id,
        eventId,
        effectId,
        refundId,
        paymentId,
        reference: refund.id,
        amount: refund.amount,
        currency: refund.currency,
        eventType: event.type,
        hash: digest(canonical(event)),
      });
      return { received: true, ...receipt };
    }
    if (
      ![
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
      ].includes(event.type)
    )
      return { received: true, ignored: true };
    const session = event.data.object as Stripe.Checkout.Session;
    check(
      session.object === "checkout.session" &&
        session.mode === "payment" &&
        session.livemode === false,
      "WEBHOOK_SCOPE",
      "Unsupported checkout event.",
      400,
    );
    const eventId = text(event.id, "Stripe event ID"),
      sessionId = text(session.id, "Stripe checkout ID"),
      effectId = text(
        session.metadata?.effect_id,
        "Distributor checkout identity",
      );
    check(
      /^evt_/.test(eventId) && /^cs_test_/.test(sessionId),
      "WEBHOOK_SCOPE",
      "Invalid test event identity.",
      400,
    );
    const receipt = this.app.integration.receiveCallback(actor, {
      bindingId: binding.id,
      eventId,
      sessionId,
      effectId,
      hash: digest(canonical(event)),
    });
    return { received: true, ...receipt };
  }
  async tick(limit = 20) {
    this.app.platform.assertProviderAccess();
    const report = {
      recoveredEffects: 0,
      recoveredCallbacks: 0,
      sent: 0,
      settled: 0,
      deferred: 0,
    };
    for (const binding of this.bindings) {
      const actor = () =>
        this.app.identity.workerActor(binding.orgId, binding.workerUserId);
      actor();
      report.recoveredEffects += this.app.integration.recoverStale(
        120000,
        binding.orgId,
      );
      this.app.integration.refunds.recover(120000, binding.orgId);
      report.recoveredCallbacks += this.app.integration.recoverCallbacks(
        120000,
        binding.orgId,
      );
      for (const effect of this.app.integration.pending(actor(), limit)) {
        // Re-read grants for every operation. Consent and state are checked inside the claim transaction.
        try {
          await this.execute(actor(), effect.id);
          report.sent++;
        } catch (error) {
          if (
            !(error instanceof DomainError) ||
            !["STATE", "RESIDENCY_BLOCKED", "PROVIDER_DISABLED"].includes(
              error.code,
            )
          )
            throw error;
          report.deferred++;
        }
      }
      if (!binding.stripe) continue;
      for (const effect of this.app.integration.refunds.due(actor(), limit)) {
        try {
          await this.refreshRefund(actor(), effect.id);
        } catch {
          report.deferred++;
        }
      }
      for (const callback of this.app.integration.refundCallbacks.due(
        actor(),
        binding.id,
        limit,
      )) {
        try {
          const outcome = await this.app.integration.refundCallbacks.run(
            actor(),
            callback.id,
            binding.stripe.adapter,
          );
          if (outcome.state === "completed") report.settled++;
          else report.deferred++;
        } catch (error) {
          if (error instanceof DomainError && error.code === "STATE") continue;
          throw error;
        }
      }
      for (const callback of this.app.integration.dueCallbacks(
        actor(),
        binding.id,
        limit,
      )) {
        const principal = actor();
        let attempt: number;
        try {
          attempt = this.app.integration.claimCallback(
            principal,
            callback.id,
          ).attempts;
        } catch (error) {
          if (error instanceof DomainError && error.code === "STATE") continue;
          throw error;
        }
        try {
          await this.app.integration.stripeSettlement(
            principal,
            {
              // Namespace the legacy settlement inbox by trusted binding and organization.
              id: `${binding.orgId}/${binding.id}/${callback.event_id}`,
              sessionId: callback.session_id,
              effectId: callback.effect_id,
            },
            async (sessionId) => {
              const payment =
                await binding.stripe!.adapter.verifySettlement(sessionId);
              check(
                payment.effectId === callback.effect_id &&
                  payment.livemode === false,
                "PAYMENT_MISMATCH",
                "Retrieved checkout identity differs from signed event.",
              );
              // Revoked grants cannot write cash; the durable receipt remains available for a qualified worker.
              actor();
              return payment;
            },
          );
          this.app.integration.finishCallback(
            principal,
            callback.id,
            attempt,
            "completed",
          );
          report.settled++;
        } catch (error) {
          const code =
            error instanceof DomainError ? error.code : "PROVIDER_UNAVAILABLE";
          const state = ["RESIDENCY_BLOCKED", "FORBIDDEN"].includes(code)
            ? "blocked"
            : [
                  "PAYMENT_MISMATCH",
                  "EVENT_CONFLICT",
                  "PAYMENT_CONFLICT",
                ].includes(code)
              ? "failed"
              : "waiting";
          this.app.integration.finishCallback(
            principal,
            callback.id,
            attempt,
            state,
            state === "blocked"
              ? "Current permission or residency choice prevents verification."
              : state === "failed"
                ? "Provider identity or money differs; finance review required."
                : "Verification incomplete; a read-only retry is scheduled.",
          );
          report.deferred++;
        }
      }
    }
    return report;
  }
}

export function configuredProviders(
  app: Application,
  env: NodeJS.ProcessEnv = process.env,
  options: { organizationAuthorizationConfigured?: boolean } = {},
) {
  if (env.PROVIDERS_ENABLED !== "true") return undefined;
  const required = (name: string) => {
    check(env[name], "PROVIDER_CONFIG", `Missing ${name}.`, 500);
    return env[name]!;
  };
  const hasStripe = !!env.STRIPE_TEST_KEY || !!env.STRIPE_WEBHOOK_SECRET;
  check(
    !env.QUICKBOOKS_CREDENTIAL_MODE ||
      ["environment", "managed"].includes(env.QUICKBOOKS_CREDENTIAL_MODE),
    "PROVIDER_CONFIG",
    "Unknown QuickBooks credential mode.",
    500,
  );
  const managedQbo = env.QUICKBOOKS_CREDENTIAL_MODE === "managed";
  check(
    !managedQbo || !env.QUICKBOOKS_ACCESS_TOKEN,
    "PROVIDER_CONFIG",
    "Managed credentials cannot use an environment access token.",
    500,
  );
  const hasQbo =
    managedQbo || !!env.QUICKBOOKS_REALM_ID || !!env.QUICKBOOKS_ACCESS_TOKEN;
  // A separately validated organization authorization service does not grant
  // buyer payment/accounting delivery and needs no buyer credentials.
  if (!hasStripe && !hasQbo && options.organizationAuthorizationConfigured)
    return undefined;
  check(
    hasStripe || hasQbo,
    "PROVIDER_CONFIG",
    "Provider access enabled without credentials.",
    500,
  );
  const managedBinding = managedQbo
    ? {
        id: required("PROVIDER_BINDING_ID"),
        orgId: required("PROVIDER_ORG_ID"),
        workerUserId: required("PROVIDER_WORKER_USER_ID"),
        realm: required("QUICKBOOKS_REALM_ID"),
        clientId: required("QUICKBOOKS_CLIENT_ID"),
      }
    : undefined;
  const clientSecret = managedQbo
    ? required("QUICKBOOKS_CLIENT_SECRET")
    : undefined;
  if (managedBinding) {
    check(
      app.providerCredentials.available,
      "CREDENTIAL_KEY",
      "Managed provider encryption key is unavailable.",
      500,
    );
    check(
      /^[\x21-\x7e]{1,8192}$/.test(clientSecret!),
      "PROVIDER_CONFIG",
      "Invalid QuickBooks client secret.",
      500,
    );
    app.providerCredentials.status(managedBinding);
  }
  return new ProviderRuntime(app, [
    {
      id: required("PROVIDER_BINDING_ID"),
      orgId: required("PROVIDER_ORG_ID"),
      workerUserId: required("PROVIDER_WORKER_USER_ID"),
      stripe: hasStripe
        ? {
            adapter: new StripeAdapter(
              required("STRIPE_TEST_KEY"),
              required("PUBLIC_ORIGIN"),
              true,
            ),
            webhookSecret: required("STRIPE_WEBHOOK_SECRET"),
          }
        : undefined,
      quickbooks: hasQbo
        ? new QuickBooksAdapter(
            required("QUICKBOOKS_REALM_ID"),
            managedBinding
              ? (effect) =>
                  app.providerCredentials.access(
                    managedBinding,
                    clientSecret!,
                    effect,
                  )
              : async () => required("QUICKBOOKS_ACCESS_TOKEN"),
            true,
            (effect) => {
              check(
                effect.org_id === required("PROVIDER_ORG_ID"),
                "FORBIDDEN",
                "Provider organization differs.",
                403,
              );
              const actor = app.identity.workerActor(
                effect.org_id,
                required("PROVIDER_WORKER_USER_ID"),
              );
              app.platform.assertProviderAccess();
              app.identity.providerAllowed(
                actor,
                effect.account_id,
                "quickbooks",
              );
              app.integration.assertAccountingRefundReady(actor, effect);
            },
          )
        : undefined,
    },
  ]);
}
