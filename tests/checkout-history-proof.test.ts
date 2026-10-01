import { test } from "node:test";
import assert from "node:assert/strict";
import { accept, chooseProviders, fixture, ship } from "./fixtures.ts";

for (const malformed of [
  { status: ["open"] },
  { status: ["expired"] },
  { paymentStatus: ["unpaid"] },
  { expiresAt: "1900000000" },
]) {
  test(`checkout history rejects coerced status/expiry proof ${JSON.stringify(malformed)}`, async (t) => {
    const f = fixture(t),
      invoiceId = ship(f, accept(f).id).invoiceId;
    chooseProviders(f, f.actor, "choice", {
      accountId: f.buyer,
      region: "CA",
      mode: "provider-exceptions",
      providers: ["stripe"],
      version: 1,
      acknowledgment: "Synthetic permission",
    });
    const effect = f.app.integration.checkout(f.actor, "checkout", {
      invoiceId,
    });
    const receipt = {
      reference: "cs_test_malformed",
      result: {
        amount: 11300,
        currency: "cad",
        status: "open",
        paymentStatus: "unpaid",
        expiresAt: 1900000000,
        checkoutUrl: "https://checkout.stripe.com/private-test",
        ...malformed,
      },
    };
    await f.app.integration.execute(f.actor, effect.id, {
      execute: async () => receipt,
      lookup: async () => receipt,
    });
    const history = f.app.integration.checkouts.history(f.actor, effect.id);
    assert.equal(history.items.length, 1);
    assert.equal(history.items[0]!.outcome, "unverified");
    assert.equal(history.items[0]!.status, null);
    assert.equal(history.items[0]!.paymentStatus, null);
    assert.equal(history.items[0]!.expiresAt, null);
    assert.throws(() => f.app.integration.checkouts.open(f.actor, effect.id), {
      code: "CHECKOUT_UNAVAILABLE",
    });
    assert.equal(
      f.app.integration.list(f.actor).find((e) => e.id === effect.id)!.checkout!
        .state,
      "unverified",
    );
    assert.ok(!JSON.stringify(history).includes("private-test"));
    assert.equal(f.app.billing.totals(f.actor, invoiceId).paid, 0);
  });
}

test("withdrawn provider permission retains local history but prevents another provider read", async (t) => {
  const f = fixture(t),
    invoiceId = ship(f, accept(f).id).invoiceId;
  chooseProviders(f, f.actor, "choice", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["stripe"],
    version: 1,
    acknowledgment: "Synthetic permission",
  });
  const effect = f.app.integration.checkout(f.actor, "checkout", { invoiceId });
  const receipt = {
    reference: "cs_test_withdrawn",
    result: {
      amount: 11300,
      currency: "cad",
      status: "open",
      paymentStatus: "unpaid",
      expiresAt: 1900000000,
    },
  };
  let calls = 0;
  const adapter = {
    execute: async () => receipt,
    lookup: async () => {
      calls++;
      return receipt;
    },
  };
  await f.app.integration.execute(f.actor, effect.id, adapter);
  const history = f.app.integration.checkouts.history(f.actor, effect.id);
  chooseProviders(f, f.actor, "withdraw", {
    accountId: f.buyer,
    region: "CA",
    mode: "strict",
    providers: [],
    version: 2,
    acknowledgment: "Synthetic withdrawal",
  });
  assert.deepEqual(
    f.app.integration.checkouts.history(f.actor, effect.id),
    history,
  );
  await assert.rejects(
    f.app.integration.refreshCheckout(f.actor, effect.id, adapter),
  );
  assert.equal(calls, 0);
  assert.deepEqual(
    f.app.integration.checkouts.history(f.actor, effect.id),
    history,
  );
});

test("uncertain send and failed lookup create no invented history; corrupt retained bytes fail closed", async (t) => {
  const f = fixture(t),
    invoiceId = ship(f, accept(f).id).invoiceId;
  chooseProviders(f, f.actor, "choice", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["stripe"],
    version: 1,
    acknowledgment: "Synthetic permission",
  });
  const effect = f.app.integration.checkout(f.actor, "checkout", { invoiceId });
  const failed = {
    execute: async () => {
      throw Error("Synthetic network failure");
    },
    lookup: async () => {
      throw Error("Synthetic lookup failure");
    },
  };
  assert.equal(
    (await f.app.integration.execute(f.actor, effect.id, failed)).state,
    "unknown",
  );
  assert.deepEqual(f.app.integration.checkouts.history(f.actor, effect.id), {
    items: [],
    next: null,
  });
  await assert.rejects(
    f.app.integration.reconcile(f.actor, effect.id, failed),
    /lookup failure/,
  );
  assert.deepEqual(f.app.integration.checkouts.history(f.actor, effect.id), {
    items: [],
    next: null,
  });
  const receipt = {
    reference: "cs_test_recovered",
    result: {
      amount: 11300,
      currency: "cad",
      status: "open",
      paymentStatus: "unpaid",
      expiresAt: 1900000000,
    },
  };
  await f.app.integration.reconcile(f.actor, effect.id, {
    execute: async () => receipt,
    lookup: async () => receipt,
  });
  const row = f.app.integration.checkouts.history(f.actor, effect.id).items[0]!;
  f.app.database
    .owned("integration")
    .run(
      "UPDATE integration_checkout_observations SET snapshot=? WHERE id=?",
      JSON.stringify({ ...row, amount: 1 }),
      row.id,
    );
  assert.throws(() => f.app.integration.checkouts.history(f.actor, effect.id), {
    code: "CHECKOUT_HISTORY_INTEGRITY",
  });
  assert.equal(f.app.billing.totals(f.actor, invoiceId).paid, 0);
});
