import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, accept, ship, chooseProviders } from "./fixtures.ts";
import { DemoPayments, DemoProviderRuntime } from "../src/demo/payments.ts";

import type { PaymentScenario } from "../src/demo/scenarios.ts";

function setup(
  t: Parameters<typeof fixture>[0],
  scenario: PaymentScenario = "success",
) {
  const f = fixture(t);
  const shipment = ship(f, accept(f).id);
  chooseProviders(f, f.actor, "consent", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["stripe"],
    version: 1,
    acknowledgment: "Fictional simulation only",
  });
  const effect = f.app.integration.checkout(f.actor, "checkout", {
    invoiceId: shipment.invoiceId,
  });
  return {
    ...f,
    shipment,
    effect,
    runtime: new DemoProviderRuntime(f.app, f.actor, scenario),
  };
}

test("demo uses native checkout, signed callback, settlement and refund exactly once", async (t) => {
  const f = setup(t);
  const first = await f.runtime.tick();
  assert.equal(first.sent, 1);
  assert.equal(first.settled, 1);
  const effect = f.app.integration.effect(f.actor, f.effect.id);
  assert.equal(effect.state, "completed");
  assert.equal(JSON.parse(effect.result!).simulated, true);
  assert.equal(JSON.parse(effect.result!).checkoutUrl, null);
  assert.equal(f.app.integration.callbacks(f.actor)[0]!.state, "completed");
  assert.equal(f.app.billing.totals(f.actor, f.shipment.invoiceId).paid, 11300);
  await f.runtime.tick();
  assert.equal(f.app.billing.totals(f.actor, f.shipment.invoiceId).paid, 11300);
  const payment = f.app.billing.refunds
    .payments(f.actor)
    .find((p) => p.invoice_id === f.shipment.invoiceId)!;
  f.app.billing.issueCredit(f.actor, "credit", {
    invoiceId: f.shipment.invoiceId,
    reference: "DEMO-CREDIT",
    reason: "Fictional return",
    lines: [
      {
        lineId: String(
          f.app.billing.lines(f.actor, f.shipment.invoiceId)[0]!.id,
        ),
        quantity: 1,
      },
    ],
  });
  const refund = f.app.billing.refundRequest(f.actor, "refund", {
    invoiceId: f.shipment.invoiceId,
    paymentId: String(payment.id),
    amount: 11300,
    reference: "DEMO-REFUND",
    reason: "Fictional refund",
  });
  f.app.integration.refund(f.actor, "send-refund", { refundId: refund.id });
  await f.runtime.tick();
  assert.equal(
    f.app.billing.totals(f.actor, f.shipment.invoiceId).refunded,
    11300,
  );
  await f.runtime.tick();
  assert.equal(
    f.app.billing.totals(f.actor, f.shipment.invoiceId).refunded,
    11300,
  );
});

test("withdrawing customer permission prevents demo settlement after checkout", async (t) => {
  const f = setup(t);
  await f.runtime.execute(f.actor, f.effect.id);
  chooseProviders(f, f.actor, "withdraw", {
    accountId: f.buyer,
    region: "CA",
    mode: "strict",
    providers: [],
    version: 2,
    acknowledgment: "Customer withdraws permission",
  });
  await f.runtime.tick();
  assert.equal(f.app.integration.callbacks(f.actor)[0]!.state, "blocked");
  assert.equal(f.app.billing.totals(f.actor, f.shipment.invoiceId).paid, 0);
});

test("revoked worker grants stop demo processing and foreign signatures are refused", async (t) => {
  const f = setup(t);
  assert.throws(
    () => f.runtime.receiveStripe("demo", Buffer.from("{}"), "invalid"),
    { code: "WEBHOOK_SIGNATURE" },
  );
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='support' WHERE id=?", f.actor.id);
  await assert.rejects(f.runtime.tick(), { code: "FORBIDDEN" });
  assert.equal(f.app.integration.effect(f.actor, f.effect.id).state, "pending");
});

test("demo processor keeps workspace results isolated and respects final write refusal", async (t) => {
  const f = setup(t);
  const effect = f.app.integration.effect(f.actor, f.effect.id);
  const a = new DemoPayments(),
    b = new DemoPayments();
  await assert.rejects(
    a.execute(effect, () => {
      throw new Error("revoked");
    }),
    /revoked/,
  );
  assert.equal(await a.lookup(effect), null);
  const result = await a.execute(effect);
  result.result.amount = 1;
  assert.equal((await a.lookup(effect))!.result.amount, 11300);
  assert.equal(await b.lookup(effect), null);
  await assert.rejects(b.verifySettlement(result.reference), {
    code: "NOT_FOUND",
  });
});

test("demo retries a failed callback delivery without creating a second payment", async (t) => {
  const f = setup(t);
  const receive = f.runtime.receiveStripe.bind(f.runtime);
  f.runtime.receiveStripe = () => {
    throw new Error("Temporary delivery failure");
  };
  await assert.rejects(
    f.runtime.execute(f.actor, f.effect.id),
    /Temporary delivery failure/,
  );
  assert.equal(
    f.app.integration.effect(f.actor, f.effect.id).state,
    "completed",
  );
  assert.equal(f.app.billing.totals(f.actor, f.shipment.invoiceId).paid, 0);
  f.runtime.receiveStripe = receive;
  await f.runtime.tick();
  await f.runtime.tick();
  assert.equal(f.app.integration.callbacks(f.actor).length, 1);
  assert.equal(f.app.billing.totals(f.actor, f.shipment.invoiceId).paid, 11300);
});

for (const scenario of ["unpaid", "expired"] as const) {
  test(`demo ${scenario} checkout cannot settle money and can be closed or replaced natively`, async (t) => {
    const f = setup(t, scenario);
    await f.runtime.tick();
    const effect = f.app.integration.effect(f.actor, f.effect.id);
    assert.equal(effect.state, "completed");
    assert.equal(
      JSON.parse(effect.result!).status,
      scenario === "unpaid" ? "open" : "expired",
    );
    assert.equal(f.app.integration.callbacks(f.actor).length, 0);
    assert.equal(f.app.billing.totals(f.actor, f.shipment.invoiceId).paid, 0);
    await f.runtime.refreshCheckout(f.actor, f.effect.id);
    if (scenario === "unpaid")
      await f.runtime.closeCheckout(f.actor, f.effect.id);
    const expired = f.app.integration.effect(f.actor, f.effect.id);
    assert.equal(JSON.parse(expired.result!).status, "expired");
    f.app.integration.checkouts.assertReplaceable(f.actor, expired);
    assert.equal(f.app.billing.totals(f.actor, f.shipment.invoiceId).paid, 0);
  });
}
for (const scenario of ["pending-refund", "failed-refund"] as const) {
  test(`demo ${scenario} preserves native cash and exposes the native exception`, async (t) => {
    const f = setup(t, scenario);
    await f.runtime.tick();
    const payment = f.app.billing.refunds
      .payments(f.actor)
      .find((p) => p.invoice_id === f.shipment.invoiceId)!;
    f.app.billing.issueCredit(f.actor, "credit", {
      invoiceId: f.shipment.invoiceId,
      reference: "DEMO-CREDIT",
      reason: "Fictional return",
      lines: [
        {
          lineId: String(
            f.app.billing.lines(f.actor, f.shipment.invoiceId)[0]!.id,
          ),
          quantity: 1,
        },
      ],
    });
    const refund = f.app.billing.refundRequest(f.actor, "refund", {
      invoiceId: f.shipment.invoiceId,
      paymentId: String(payment.id),
      amount: 11300,
      reference: "DEMO-REFUND",
      reason: "Fictional return",
    });
    const effect = f.app.integration.refund(f.actor, "send-refund", {
      refundId: refund.id,
    });
    await f.runtime.tick();
    await f.runtime.refreshRefund(f.actor, effect.id);
    const observed = JSON.parse(
      f.app.integration.effect(f.actor, effect.id).result!,
    );
    assert.equal(
      observed.status,
      scenario === "pending-refund" ? "pending" : "failed",
    );
    assert.equal(
      f.app.billing.refunds.accountingFact(f.actor, refund.id).state,
      scenario === "pending-refund" ? "unknown" : "rejected",
    );
    assert.equal(
      f.app.billing.totals(f.actor, f.shipment.invoiceId).refunded,
      0,
    );
    assert.equal(
      f.app.billing.totals(f.actor, f.shipment.invoiceId).paid,
      11300,
    );
  });
}
test("simulated payment retries refuse altered tenant or payload identity", async (t) => {
  const f = setup(t),
    adapter = new DemoPayments();
  const effect = f.app.integration.effect(f.actor, f.effect.id);
  await adapter.execute(effect);
  await assert.rejects(adapter.lookup({ ...effect, account_id: "foreign" }), {
    code: "PAYMENT_MISMATCH",
  });
  await assert.rejects(adapter.execute({ ...effect, payload: "{}" }), {
    code: "PAYMENT_MISMATCH",
  });
});
