import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseProviders, fixture, accept, ship } from "./fixtures.ts";
import {
  ProviderRuntime,
  configuredProviders,
  type StripeGateway,
} from "../src/server/provider-runtime.ts";
import { StripeAdapter } from "../src/server/providers.ts";
import { createHttp } from "../src/server/http.ts";
import { Application } from "../src/server/application.ts";

const secret = "whsec_synthetic_test_only",
  origin = "http://127.0.0.1:3000";
function setup(t: Parameters<typeof fixture>[0]) {
  const f = fixture(t),
    shipment = ship(f, accept(f).id);
  chooseProviders(f, f.actor, "choice", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["stripe"],
    version: 1,
    acknowledgment: "Synthetic processor exception",
  });
  const effect = f.app.integration.checkout(f.actor, "checkout", {
    invoiceId: shipment.invoiceId,
  });
  const sdk = new StripeAdapter("sk_test_synthetic_no_network", origin, false);
  let sent = 0,
    reads = 0,
    loseResponse = false,
    failRead = false,
    mismatch = false;
  const gateway: StripeGateway = {
    execute: async () => {
      sent++;
      if (loseResponse) throw new Error("secret provider error");
      return {
        reference: "cs_test_fixture",
        result: { checkoutUrl: "https://checkout.stripe.com/test" },
      };
    },
    lookup: async () => ({ reference: "cs_test_fixture", result: {} }),
    verifyWebhook: (raw, signature, endpointSecret) =>
      sdk.verifyWebhook(raw, signature, endpointSecret),
    verifySettlement: async () => {
      reads++;
      if (failRead) throw new Error("secret provider response");
      return {
        paid: true,
        amount: mismatch ? 11301 : 11300,
        currency: "cad",
        paymentId: "pi_fixture",
        effectId: effect.id,
        livemode: false,
      };
    },
  };
  const runtime = new ProviderRuntime(f.app, [
    {
      id: "ca-test",
      orgId: f.actor.orgId,
      workerUserId: f.actor.id,
      stripe: { adapter: gateway, webhookSecret: secret },
    },
  ]);
  const event = (overrides: Record<string, unknown> = {}) => ({
    id: "evt_fixture",
    object: "event",
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        id: "cs_test_fixture",
        object: "checkout.session",
        mode: "payment",
        livemode: false,
        metadata: { effect_id: effect.id },
        description: "Synthetic é test",
      },
    },
    ...overrides,
  });
  const signed = (
    body = JSON.stringify(event(), null, 2),
    timestamp?: number,
  ) => ({
    body,
    signature: sdk.client.webhooks.generateTestHeaderString({
      payload: body,
      secret,
      timestamp,
    }),
  });
  return {
    ...f,
    shipment,
    effect,
    runtime,
    event,
    signed,
    counts: () => ({ sent, reads }),
    lost: () => {
      loseResponse = true;
    },
    failRead: (value: boolean) => {
      failRead = value;
    },
    mismatch: () => {
      mismatch = true;
    },
  };
}

test("signed raw HTTP callbacks commit before provider IO, settle once, and reject invalid signatures/scopes", async (t) => {
  const f = setup(t),
    http = await createHttp(f.app, {
      origin,
      providers: f.runtime,
      staticRoot: "/nonexistent",
    });
  t.after(() => http.close());
  const send = (
    body: string,
    signature?: string,
    url = "/webhooks/stripe/ca-test",
  ) =>
    http.inject({
      method: "POST",
      url,
      headers: {
        "content-type": "application/json",
        ...(signature ? { "stripe-signature": signature } : {}),
      },
      payload: body,
    });
  const signed = f.signed();
  assert.equal((await send(signed.body)).statusCode, 400);
  assert.equal(
    (await send(signed.body + " ", signed.signature)).statusCode,
    400,
  );
  assert.equal(
    (await send(signed.body, f.signed(signed.body, 1).signature)).statusCode,
    400,
  );
  for (const overrides of [{ livemode: true }, { account: "acct_other" }]) {
    const bad = f.signed(JSON.stringify(f.event(overrides)));
    assert.equal((await send(bad.body, bad.signature)).statusCode, 400);
  }
  assert.equal(
    (await send(signed.body, signed.signature, "/webhooks/stripe/other"))
      .statusCode,
    404,
  );
  assert.equal(f.app.integration.callbacks(f.actor).length, 0);
  const unsupported = f.signed(
    JSON.stringify(f.event({ type: "payment_intent.created" })),
  );
  assert.equal(
    (await send(unsupported.body, unsupported.signature)).json().ignored,
    true,
  );
  const response = await send(signed.body, signed.signature);
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().duplicate, false);
  assert.deepEqual(f.counts(), { sent: 0, reads: 0 });
  assert.equal(f.app.integration.callbacks(f.actor)[0]!.state, "pending");
  assert.deepEqual(await f.runtime.tick(), {
    recoveredEffects: 0,
    recoveredCallbacks: 0,
    sent: 1,
    settled: 1,
    deferred: 0,
  });
  assert.equal(f.app.billing.totals(f.actor, f.shipment.invoiceId).paid, 11300);
  assert.equal(
    (await send(signed.body, signed.signature)).json().duplicate,
    true,
  );
  const second = f.signed(
    JSON.stringify(f.event({ id: "evt_second_delivery" })),
  );
  assert.equal((await send(second.body, second.signature)).statusCode, 200);
  await f.runtime.tick();
  assert.equal(f.app.billing.totals(f.actor, f.shipment.invoiceId).paid, 11300);
  assert.deepEqual(f.counts(), { sent: 1, reads: 2 });
  const changed = f.signed(JSON.stringify(f.event({ created: 123 })));
  assert.equal((await send(changed.body, changed.signature)).statusCode, 409);
});

test("lost sends never auto-repeat; callback waits for reconciliation and consent withdrawal prevents settlement fetch", async (t) => {
  const f = setup(t),
    signed = f.signed();
  f.lost();
  f.runtime.receiveStripe(
    "ca-test",
    Buffer.from(signed.body),
    signed.signature,
  );
  await f.runtime.tick();
  assert.equal(f.app.integration.effect(f.actor, f.effect.id).state, "unknown");
  assert.equal(f.app.integration.callbacks(f.actor)[0]!.state, "waiting");
  assert.deepEqual(f.counts(), { sent: 1, reads: 0 });
  await f.runtime.tick();
  assert.deepEqual(f.counts(), { sent: 1, reads: 0 });
  await f.runtime.reconcile(f.actor, f.effect.id);
  const callback = f.app.integration.callbacks(f.actor)[0]!;
  chooseProviders(f, f.actor, "withdraw", {
    accountId: f.buyer,
    region: "CA",
    mode: "strict",
    providers: [],
    version: 2,
    acknowledgment: "Synthetic withdrawal",
  });
  f.app.integration.retryCallback(f.actor, callback.id);
  await f.runtime.tick();
  assert.equal(f.app.integration.callbacks(f.actor)[0]!.state, "blocked");
  assert.equal(f.counts().reads, 0);
  chooseProviders(f, f.actor, "restore", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["stripe"],
    version: 3,
    acknowledgment: "Synthetic restored exception",
  });
  f.app.integration.retryCallback(f.actor, callback.id);
  await f.runtime.tick();
  assert.equal(f.app.integration.callbacks(f.actor)[0]!.state, "completed");
  assert.equal(f.app.billing.totals(f.actor, f.shipment.invoiceId).paid, 11300);
});

test("provider verification retries safely after failure/restart and mismatched money requires review", async (t) => {
  const f = setup(t),
    signed = f.signed();
  f.failRead(true);
  f.runtime.receiveStripe(
    "ca-test",
    Buffer.from(signed.body),
    signed.signature,
  );
  await f.runtime.tick();
  let callback = f.app.integration.callbacks(f.actor)[0]!;
  assert.equal(callback.state, "waiting");
  assert.ok(!callback.error?.includes("secret"));
  assert.equal(f.app.billing.totals(f.actor, f.shipment.invoiceId).paid, 0);
  f.failRead(false);
  f.mismatch();
  f.app.integration.retryCallback(f.actor, callback.id);
  await f.runtime.tick();
  assert.equal(f.app.integration.callbacks(f.actor)[0]!.state, "failed");
  assert.equal(f.app.billing.totals(f.actor, f.shipment.invoiceId).paid, 0);
  // A process interrupted after claiming is recovered to a safe read-only retry.
  f.app.database
    .owned("integration")
    .run(
      "UPDATE integration_callbacks SET state='processing',started_at=1 WHERE id=?",
      callback.id,
    );
  assert.equal(f.app.integration.recoverCallbacks(), 1);
  assert.equal(f.app.integration.callbacks(f.actor)[0]!.state, "waiting");
});

test("worker re-reads finance grants, claims serialize, and disabled/partial environment configuration fails closed", async (t) => {
  const f = setup(t);
  assert.equal(
    configuredProviders(f.app, {
      PROVIDERS_ENABLED: "false",
      STRIPE_TEST_KEY: "anything",
    }),
    undefined,
  );
  assert.throws(
    () => configuredProviders(f.app, { PROVIDERS_ENABLED: "true" }),
    { code: "PROVIDER_CONFIG" },
  );
  const outcomes = await Promise.allSettled([
    f.runtime.execute(f.actor, f.effect.id),
    f.runtime.execute(f.actor, f.effect.id),
  ]);
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(f.counts().sent, 1);
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='support' WHERE id=?", f.actor.id);
  const signed = f.signed();
  assert.throws(
    () =>
      f.runtime.receiveStripe(
        "ca-test",
        Buffer.from(signed.body),
        signed.signature,
      ),
    { code: "FORBIDDEN" },
  );
  await assert.rejects(f.runtime.tick(), { code: "FORBIDDEN" });
  assert.equal(f.counts().reads, 0);
});

test("durable callbacks can be claimed by a new database connection; an abandoned attempt cannot overwrite its successor", async (t) => {
  const f = setup(t),
    signed = f.signed();
  f.runtime.receiveStripe(
    "ca-test",
    Buffer.from(signed.body),
    signed.signature,
  );
  const callback = f.app.integration.callbacks(f.actor)[0]!;
  const abandoned = f.app.integration.claimCallback(f.actor, callback.id);
  f.app.database
    .owned("integration")
    .run(
      "UPDATE integration_callbacks SET started_at=1 WHERE id=?",
      callback.id,
    );
  const restarted = new Application(f.path);
  try {
    assert.equal(restarted.integration.recoverCallbacks(), 1);
    const successor = restarted.integration.claimCallback(f.actor, callback.id);
    assert.equal(successor.attempts, 2);
    f.app.integration.finishCallback(
      f.actor,
      callback.id,
      abandoned.attempts,
      "failed",
      "Old attempt",
    );
    assert.equal(
      restarted.integration.callbacks(f.actor)[0]!.state,
      "processing",
    );
    restarted.integration.finishCallback(
      f.actor,
      callback.id,
      successor.attempts,
      "waiting",
    );
    assert.equal(f.app.integration.callbacks(f.actor)[0]!.state, "waiting");
  } finally {
    restarted.close();
  }
});

test("authenticated HTTP processing enforces current session grants and body errors stay bounded", async (t) => {
  const f = setup(t),
    http = await createHttp(f.app, {
      origin,
      providers: f.runtime,
      staticRoot: "/nonexistent",
    });
  t.after(() => http.close());
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: {
      email: "admin@example.test",
      password: "long-test-only-password",
    },
  });
  const cookie = login.cookies[0]!,
    headers = {
      origin,
      cookie: `${cookie.name}=${cookie.value}`,
      "x-csrf-token": login.json().csrf,
    };
  const url = `/api/effects/${f.effect.id}/execute`;
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url,
        headers: { ...headers, "x-csrf-token": "bad" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await http.inject({ method: "POST", url, headers })).statusCode,
    200,
  );
  assert.equal(
    (await http.inject({ method: "POST", url, headers })).statusCode,
    409,
  );
  assert.equal(f.counts().sent, 1);
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_users SET role='buyer',account_id=? WHERE id=?",
      f.buyer,
      f.actor.id,
    );
  assert.equal(
    (await http.inject({ method: "POST", url, headers })).statusCode,
    403,
  );
  const malformed = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin, "content-type": "application/json" },
    payload: "{bad",
  });
  assert.equal(malformed.statusCode, 400);
  assert.equal(malformed.json().code, "REQUEST_BODY");
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: "/webhooks/stripe/ca-test",
        headers: { "content-type": "application/json" },
        payload: " ".repeat(256 * 1024 + 1),
      })
    ).statusCode,
    413,
  );
});
