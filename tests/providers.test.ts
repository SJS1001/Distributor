import { test } from "node:test";
import assert from "node:assert/strict";
import type Stripe from "stripe";
import { fixture, accept, ship } from "./fixtures.ts";
import { StripeAdapter, QuickBooksAdapter } from "../src/server/providers.ts";

function intents(t: Parameters<typeof fixture>[0]) {
  const f = fixture(t),
    shipment = ship(f, accept(f).id);
  f.app.identity.residencyChoice(f.actor, "providers", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["stripe", "quickbooks"],
    version: 1,
    acknowledgment: "Synthetic provider permission",
  });
  const checkout = f.app.integration.checkout(f.actor, "checkout", {
    invoiceId: shipment.invoiceId,
  });
  const accounting = f.app.integration.accounting(f.actor, "accounting", {
    invoiceId: shipment.invoiceId,
    customerRef: "customer-1",
    itemRefs: { [f.product]: "item-1" },
    taxCodeRef: "tax-code-1",
    taxRateRef: "tax-rate-1",
  });
  return {
    ...f,
    checkout: f.app.integration.effect(f.actor, checkout.id),
    accounting: f.app.integration.effect(f.actor, accounting.id),
  };
}

test("Stripe rejects conflicting checkout identity/money/mode/URLs before binding a result", async (t) => {
  const f = intents(t),
    adapter = new StripeAdapter(
      "sk_test_synthetic_no_network",
      "http://127.0.0.1:3000",
      true,
    );
  let response = {
    id: "cs_test_synthetic",
    mode: "payment",
    livemode: false,
    metadata: { effect_id: f.checkout.id },
    amount_total: 11300,
    currency: "cad",
    url: "https://checkout.stripe.com/synthetic",
  } as unknown as Stripe.Checkout.Session; // Partial synthetic SDK response; no network.
  const create = t.mock.method(
    adapter.client.checkout.sessions,
    "create",
    async () => response,
  );
  assert.equal(
    (await adapter.execute(f.checkout)).reference,
    "cs_test_synthetic",
  );
  const [request, options] = create.mock.calls[0]!.arguments;
  assert.equal(request!.metadata!.effect_id, f.checkout.id);
  assert.equal(options!.idempotencyKey, `distributor:${f.checkout.id}`);
  const valid = response;
  for (const change of [
    { metadata: { effect_id: "different" } },
    { amount_total: 11301 },
    { currency: "usd" },
    { mode: "subscription" },
    { livemode: true },
    { url: "javascript:alert(1)" },
    { url: "https://checkout.stripe.com.evil.test/x" },
    { url: "https://user@checkout.stripe.com/x" },
  ]) {
    response = { ...valid, ...change } as Stripe.Checkout.Session;
    await assert.rejects(adapter.execute(f.checkout));
  }
  response = { ...valid, amount_total: 11301 };
  t.mock.method(
    adapter.client.checkout.sessions,
    "list",
    () =>
      ({
        async *[Symbol.asyncIterator]() {
          yield response;
        },
      }) as unknown as ReturnType<typeof adapter.client.checkout.sessions.list>,
  );
  await assert.rejects(adapter.lookup(f.checkout), {
    code: "PAYMENT_MISMATCH",
  });
  response = valid;
  assert.equal((await adapter.lookup(f.checkout))!.reference, valid.id);
});

test("Stripe settlement checks received funds and payment identity independently of checkout completion", async (t) => {
  const adapter = new StripeAdapter(
    "sk_test_synthetic_no_network",
    "http://127.0.0.1:3000",
    true,
  );
  const intent = {
    id: "pi_fixture",
    status: "succeeded",
    livemode: false,
    amount_received: 11300,
    currency: "cad",
    metadata: { effect_id: "effect-1" },
  };
  const valid = {
    id: "cs_test_fixture",
    mode: "payment",
    livemode: false,
    payment_status: "paid",
    amount_total: 11300,
    currency: "cad",
    metadata: { effect_id: "effect-1" },
    payment_intent: intent,
  };
  let response = valid as unknown as Stripe.Checkout.Session;
  t.mock.method(
    adapter.client.checkout.sessions,
    "retrieve",
    async () => response,
  );
  assert.equal((await adapter.verifySettlement(valid.id)).paid, true);
  for (const change of [
    { amount_received: 11299 },
    { currency: "usd" },
    { metadata: { effect_id: "different" } },
    { livemode: true },
  ]) {
    response = {
      ...valid,
      payment_intent: { ...intent, ...change },
    } as unknown as Stripe.Checkout.Session;
    await assert.rejects(adapter.verifySettlement(valid.id), {
      code: "PAYMENT_MISMATCH",
    });
  }
  response = {
    ...valid,
    payment_status: "unpaid",
    payment_intent: null,
  } as unknown as Stripe.Checkout.Session;
  assert.equal((await adapter.verifySettlement(valid.id)).paid, false);
});

test("QuickBooks reconciliation needs the bound effect identity, exact money and one matching invoice", async (t) => {
  const f = intents(t),
    adapter = new QuickBooksAdapter(
      "12345",
      async () => "synthetic-token",
      true,
    );
  const payload = JSON.parse(f.accounting.payload),
    valid = {
      Id: "qbo-1",
      DocNumber: payload.invoice.number,
      TotalAmt: 113,
      CurrencyRef: { value: "CAD" },
      SyncToken: "0",
      CustomerRef: { value: "customer-1" },
      PrivateNote: `Distributor effect ${f.accounting.id}`,
    };
  let rows = [valid];
  const fetch = t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(JSON.stringify({ QueryResponse: { Invoice: rows } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  assert.equal((await adapter.lookup(f.accounting))!.reference, "qbo-1");
  const url = new URL(String(fetch.mock.calls[0]!.arguments[0]));
  assert.equal(url.hostname, "sandbox-quickbooks.api.intuit.com");
  assert.equal(
    url.searchParams.get("query"),
    `select * from Invoice where DocNumber = '${valid.DocNumber}'`,
  );
  for (const change of [
    { PrivateNote: "Unrelated invoice with same number" },
    { TotalAmt: 113.01 },
    { TotalAmt: 113.001 },
    { Id: "" },
    { CustomerRef: { value: "other" } },
    { CurrencyRef: { value: "USD" } },
    { DocNumber: "DIFFERENT" },
  ]) {
    rows = [{ ...valid, ...change }];
    await assert.rejects(adapter.lookup(f.accounting), {
      code: "ACCOUNTING_MISMATCH",
    });
  }
  rows = [valid, valid];
  await assert.rejects(adapter.lookup(f.accounting), {
    code: "ACCOUNTING_DUPLICATE",
  });
  rows = [];
  assert.equal(await adapter.lookup(f.accounting), null);
  fetch.mock.mockImplementation(
    async () =>
      new Response(JSON.stringify({ Invoice: valid }), { status: 200 }),
  );
  assert.equal((await adapter.execute(f.accounting)).reference, "qbo-1");
  const [target, init] = fetch.mock.calls.at(-1)!.arguments;
  assert.equal(
    new URL(String(target)).searchParams.get("requestid"),
    f.accounting.id,
  );
  const posted = JSON.parse(String(init!.body));
  assert.equal(posted.PrivateNote, valid.PrivateNote);
  assert.equal(posted.Line[0].Amount, 100);
  assert.equal(posted.TxnTaxDetail.TotalTax, 13);
  assert.equal(posted.CustomerRef.value, "customer-1");
});
