import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, accept, ship, chooseProviders } from "./fixtures.ts";

for (const amount of [100, 11300])
  test(`fresh checkout resolves current reviewed intent after ${amount}-cent native payment`, async (t) => {
    const f = fixture(t);
    const invoiceId = ship(f, accept(f).id).invoiceId;
    chooseProviders(f, f.actor, "allow", {
      accountId: f.buyer,
      region: "CA",
      mode: "provider-exceptions",
      providers: ["stripe"],
      version: 1,
      acknowledgment: "Synthetic permission",
    });
    const original = f.app.integration.checkout(f.actor, "initial", {
      invoiceId,
    });
    const review = f.app.integration
      .list(f.actor)
      .find((e) => e.id === original.id)!.checkout!;
    const successor = f.app.integration.renewCheckout(f.actor, "renew", {
      effectId: original.id,
      reviewVersion: review.reviewVersion,
      amount: 11300,
      reason: "Synthetic reviewed replacement",
    });
    const frozen = f.app.integration.effect(f.actor, successor.id);
    f.app.billing.manualPayment(f.actor, "payment", {
      invoiceId,
      amount,
      reference: "synthetic-bank",
      reason: "Synthetic native payment observation",
    });
    assert.deepEqual(
      f.app.integration.checkout(f.actor, "fresh", { invoiceId }),
      {
        id: successor.id,
        state: "pending",
      },
    );
    assert.deepEqual(f.app.integration.effect(f.actor, successor.id), frozen);
    assert.throws(
      () => f.app.integration.checkouts.open(f.actor, successor.id),
      {
        code: "CHECKOUT_UNAVAILABLE",
      },
    );
    let providerCalls = 0;
    await assert.rejects(
      f.app.integration.execute(f.actor, successor.id, {
        execute: async () => {
          providerCalls++;
          throw new Error("Unexpected provider write");
        },
        lookup: async () => null,
      }),
      { code: "CHECKOUT_BALANCE_CHANGED" },
    );
    assert.equal(providerCalls, 0);
    chooseProviders(f, f.actor, "withdraw", {
      accountId: f.buyer,
      region: "CA",
      mode: "strict",
      providers: [],
      version: 2,
      acknowledgment: "Synthetic withdrawal",
    });
    assert.throws(() =>
      f.app.integration.checkout(f.actor, "fresh", { invoiceId }),
    );
    assert.throws(() =>
      f.app.integration.checkout(f.actor, "after-withdrawal", { invoiceId }),
    );
  });
