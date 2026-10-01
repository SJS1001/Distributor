import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseProviders, fixture, accept, ship } from "./fixtures.ts";
import { type Adapter } from "../src/server/integration.ts";

test("strict residency blocks intent; named customer exceptions are versioned and withdrawn before sending", async (t) => {
  const f = fixture(t),
    shipment = ship(f, accept(f).id);
  assert.throws(
    () =>
      f.app.integration.checkout(f.actor, "checkout", {
        invoiceId: shipment.invoiceId,
      }),
    { code: "RESIDENCY_BLOCKED" },
  );
  assert.equal(f.app.integration.list(f.actor).length, 0);
  chooseProviders(f, f.actor, "choice", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["stripe"],
    version: 1,
    acknowledgment: "Synthetic acceptance of outside-region Stripe processing",
  });
  assert.throws(
    () =>
      chooseProviders(f, f.actor, "stale", {
        accountId: f.buyer,
        region: "CA",
        mode: "strict",
        providers: [],
        version: 1,
        acknowledgment: "Revoked",
      }),
    { code: "REVISION" },
  );
  assert.throws(
    () =>
      chooseProviders(f, f.actor, "migration", {
        accountId: f.buyer,
        region: "US",
        mode: "strict",
        providers: [],
        version: 2,
        acknowledgment: "Move",
      }),
    { code: "REGIONAL_MIGRATION_REQUIRED" },
  );
  const effect = f.app.integration.checkout(f.actor, "checkout", {
    invoiceId: shipment.invoiceId,
  });
  assert.equal(
    f.app.integration.effect(f.actor, effect.id).residency_version,
    2,
  );
  assert.throws(
    () => f.app.identity.providerAllowed(f.actor, f.buyer, "quickbooks"),
    { code: "RESIDENCY_BLOCKED" },
  );
  chooseProviders(f, f.actor, "revoke", {
    accountId: f.buyer,
    region: "CA",
    mode: "strict",
    providers: [],
    version: 2,
    acknowledgment: "Customer withdrew processor permission",
  });
  let sent = 0;
  const adapter: Adapter = {
    execute: async () => {
      sent++;
      return { reference: "never", result: {} };
    },
    lookup: async () => null,
  };
  await assert.rejects(f.app.integration.execute(f.actor, effect.id, adapter), {
    code: "RESIDENCY_BLOCKED",
  });
  assert.equal(sent, 0);
  assert.equal(f.app.integration.effect(f.actor, effect.id).state, "pending");
});
test("lost provider response enters unknown, never auto-resends, reconciles once, and deduplicates verified settlement", async (t) => {
  const f = fixture(t),
    shipment = ship(f, accept(f).id);
  chooseProviders(f, f.actor, "choice", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["stripe"],
    version: 1,
    acknowledgment: "Synthetic provider acceptance",
  });
  const effect = f.app.integration.checkout(f.actor, "checkout", {
    invoiceId: shipment.invoiceId,
  });
  let sent = 0,
    found = false;
  const adapter: Adapter = {
    execute: async () => {
      sent++;
      throw new Error("Secret response must not reach client");
    },
    lookup: async () =>
      found
        ? {
            reference: "cs_test_fixture",
            result: { checkoutUrl: "https://checkout.stripe.com/test-fixture" },
          }
        : null,
  };
  assert.equal(
    (await f.app.integration.execute(f.actor, effect.id, adapter)).state,
    "unknown",
  );
  assert.ok(
    !f.app.integration.effect(f.actor, effect.id).error?.includes("Secret"),
  );
  await assert.rejects(f.app.integration.execute(f.actor, effect.id, adapter), {
    code: "STATE",
  });
  assert.equal(
    (await f.app.integration.reconcile(f.actor, effect.id, adapter)).state,
    "unknown",
  );
  found = true;
  assert.equal(
    (await f.app.integration.reconcile(f.actor, effect.id, adapter)).state,
    "completed",
  );
  assert.equal(sent, 1);
  // A manual payment arriving after checkout creation must not suppress actual provider cash.
  f.app.billing.manualPayment(f.actor, "manual", {
    invoiceId: shipment.invoiceId,
    amount: 11300,
    reference: "BANK-1",
    reason: "Synthetic bank confirmation",
  });
  const event = { id: "evt_fixture", sessionId: "cs_test_fixture" },
    verify = async () => ({
      paid: true,
      amount: 11300,
      currency: "cad",
      paymentId: "pi_fixture",
    });
  assert.deepEqual(
    await f.app.integration.stripeSettlement(f.actor, event, verify),
    { duplicate: false },
  );
  assert.deepEqual(
    await f.app.integration.stripeSettlement(f.actor, event, verify),
    { duplicate: true },
  );
  assert.equal(
    f.app.billing.totals(f.actor, shipment.invoiceId).balance,
    -11300,
  );
  await assert.rejects(
    f.app.integration.stripeSettlement(
      f.actor,
      { id: "evt_wrong", sessionId: "cs_test_fixture" },
      async () => ({
        paid: true,
        amount: 999,
        currency: "usd",
        paymentId: "pi_wrong",
      }),
    ),
    { code: "PAYMENT_MISMATCH" },
  );
  assert.equal(f.app.billing.totals(f.actor, shipment.invoiceId).paid, 22600);
  assert.equal(
    f.app.integration.checkout(f.actor, "checkout", {
      invoiceId: shipment.invoiceId,
    }).id,
    effect.id,
  );
});
test("abandoned running provider operation recovers only to unknown; regional store mismatch rejects organization access", (t) => {
  const f = fixture(t),
    shipment = ship(f, accept(f).id);
  chooseProviders(f, f.actor, "choice", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["stripe"],
    version: 1,
    acknowledgment: "Synthetic acceptance",
  });
  const effect = f.app.integration.checkout(f.actor, "checkout", {
    invoiceId: shipment.invoiceId,
  });
  f.app.database
    .owned("integration")
    .run(
      "UPDATE integration_effects SET state='running',started_at=1 WHERE id=?",
      effect.id,
    );
  assert.equal(f.app.integration.recoverStale(), 1);
  assert.equal(f.app.integration.effect(f.actor, effect.id).state, "unknown");
  assert.equal(f.app.integration.recoverStale(), 0);
  f.app.identity.region = "US";
  assert.throws(() => f.app.identity.organization(f.actor), {
    code: "FORBIDDEN",
  });
});
