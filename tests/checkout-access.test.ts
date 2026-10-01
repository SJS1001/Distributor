import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseProviders, fixture, accept, ship } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import type { Actor } from "../src/server/core.ts";
import type { Adapter, EffectResult } from "../src/server/integration.ts";
import { createHttp } from "../src/server/http.ts";
import {
  ProviderRuntime,
  type StripeGateway,
} from "../src/server/provider-runtime.ts";
import { StripeAdapter } from "../src/server/providers.ts";
import type Stripe from "stripe";
function setup(t: Parameters<typeof fixture>[0]) {
  const f = fixture(t),
    invoiceId = ship(f, accept(f).id).invoiceId;
  chooseProviders(f, f.actor, "permission", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["stripe"],
    version: 1,
    acknowledgment: "Synthetic permission",
  });
  const effect = f.app.integration.checkout(f.actor, "checkout", { invoiceId });
  return { ...f, invoiceId, effect };
}
const receipt = (changes: Record<string, unknown> = {}): EffectResult => ({
  reference: "cs_test_access",
  result: {
    amount: 11300,
    currency: "cad",
    status: "open",
    paymentStatus: "unpaid",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    checkoutUrl: "https://checkout.stripe.com/synthetic-access",
    ...changes,
  },
});
const adapter = (value = receipt()): Adapter => ({
  execute: async () => value,
  lookup: async () => value,
});
function buyer(
  f: ReturnType<typeof setup>,
  accountId = f.buyer,
  role: Actor["role"] = "buyer",
) {
  const user = f.app.identity.createUser(f.actor, `user-${accountId}-${role}`, {
    email: `${accountId}-${role}@example.test`,
    name: "Synthetic user",
    password: "long-test-only-password",
    role,
    ...(role === "buyer" ? { accountId } : {}),
    sites: [f.w1],
  });
  return {
    ...f.actor,
    id: user.id,
    role,
    accountId: role === "buyer" ? accountId : null,
  };
}
function pay(f: ReturnType<typeof setup>, amount: number) {
  f.app.billing.manualPayment(f.actor, "manual", {
    invoiceId: f.invoiceId,
    amount,
    reference: "BANK-ACCESS",
    reason: "Synthetic verified bank evidence",
  });
}
const state = (f: ReturnType<typeof setup>) =>
  f.app.integration.list(f.actor).find((e) => e.id === f.effect.id)!.checkout!;

test("checkout exposes invoice context without a bearer URL; only a fresh scoped open returns the current link", async (t) => {
  const f = setup(t),
    b = buyer(f);
  assert.equal(state(f).state, "pending");
  await f.app.integration.execute(f.actor, f.effect.id, adapter());
  assert.equal(state(f).state, "ready");
  assert.equal(state(f).amount, 11300);
  assert.equal(state(f).currency, "CAD");
  assert.equal(f.app.integration.list(b)[0]!.result, null);
  assert.ok(
    !JSON.stringify(f.app.integration.list(f.actor)).includes(
      "checkout.stripe.com",
    ),
  );
  assert.equal(
    f.app.integration.checkouts.open(b, f.effect.id).url,
    receipt().result.checkoutUrl,
  );
  const other = f.app.identity.createCustomer(f.actor, "other", {
    name: "Other",
    tier: "standard",
    creditLimit: 1,
  }).id;
  const stranger = buyer(f, other),
    support = buyer(f, f.buyer, "support"),
    commercial = buyer(f, f.buyer, "commercial");
  for (const principal of [stranger, support, commercial])
    assert.throws(
      () => f.app.integration.checkouts.open(principal, f.effect.id),
      { code: "FORBIDDEN" },
    );
  assert.equal(f.app.integration.list(stranger).length, 0);
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET active=0 WHERE id=?", b.id);
  assert.throws(() => f.app.integration.checkouts.open(b, f.effect.id), {
    code: "FORBIDDEN",
  });
  assert.throws(() => f.app.integration.list(b), { code: "FORBIDDEN" });
});

test("a changed balance prevents pending checkout I/O and closes an already published checkout", async (t) => {
  for (const amount of [1, 11300]) {
    const f = setup(t);
    pay(f, amount);
    let sends = 0;
    await assert.rejects(
      f.app.integration.execute(f.actor, f.effect.id, {
        ...adapter(),
        execute: async () => {
          sends++;
          return receipt();
        },
      }),
      { code: "CHECKOUT_BALANCE_CHANGED" },
    );
    assert.equal(sends, 0);
    assert.equal(
      f.app.integration.effect(f.actor, f.effect.id).state,
      "pending",
    );
  }
  const f = setup(t);
  await f.app.integration.execute(f.actor, f.effect.id, adapter());
  pay(f, 500);
  assert.equal(state(f).state, "balance-changed");
  assert.throws(() => f.app.integration.checkouts.open(f.actor, f.effect.id), {
    code: "CHECKOUT_UNAVAILABLE",
  });
});

test("checkout completion, expiry, missing legacy fields and unsupported addresses never yield a launch URL", async (t) => {
  for (const [changes, expected] of [
    [{ expiresAt: Math.floor(Date.now() / 1000) }, "expired"],
    [{ status: "expired" }, "expired"],
    [
      { status: "complete", paymentStatus: "unpaid", checkoutUrl: null },
      "complete",
    ],
    [{ paymentStatus: "paid" }, "complete"],
    [{ expiresAt: undefined }, "unverified"],
    [{ amount: 11301 }, "unverified"],
    [{ currency: "usd" }, "unverified"],
    [{ checkoutUrl: "https://checkout.stripe.com:8443/x" }, "unverified"],
    [{ checkoutUrl: "javascript:alert(1)" }, "unverified"],
  ] as const) {
    const f = setup(t);
    const value = receipt(changes);
    // JSON-normalize legacy missing properties, as a real recorded receipt does.
    value.result = JSON.parse(JSON.stringify(value.result));
    await f.app.integration.execute(f.actor, f.effect.id, adapter(value));
    assert.equal(state(f).state, expected);
    assert.throws(
      () => f.app.integration.checkouts.open(f.actor, f.effect.id),
      { code: "CHECKOUT_UNAVAILABLE" },
    );
    assert.equal(f.app.billing.totals(f.actor, f.invoiceId).paid, 0);
  }
});

test("checkout rechecks native balance immediately before SDK write after its claim is acquired", async (t) => {
  const f = setup(t);
  let writes = 0;
  const outcome = await f.app.integration.execute(f.actor, f.effect.id, {
    ...adapter(),
    execute: async (_effect, beforeWrite) => {
      pay(f, 1);
      beforeWrite!();
      writes++;
      return receipt();
    },
  });
  assert.equal(writes, 0);
  assert.equal(outcome.state, "unknown");
  assert.equal(state(f).state, "balance-changed");
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).paid, 1);
});

test("checkout refresh retains authorized observations after consent withdrawal and rolls back a late event failure", async (t) => {
  const f = setup(t);
  await f.app.integration.execute(f.actor, f.effect.id, adapter());
  let resolve!: (v: EffectResult) => void;
  const pending = f.app.integration.refreshCheckout(f.actor, f.effect.id, {
    ...adapter(),
    lookup: () =>
      new Promise((r) => {
        resolve = r;
      }),
  });
  chooseProviders(f, f.actor, "withdraw-during-read", {
    accountId: f.buyer,
    region: "CA",
    mode: "strict",
    providers: [],
    version: 2,
    acknowledgment: "Synthetic withdrawal during read",
  });
  resolve(receipt({ status: "expired" }));
  await pending;
  assert.equal(
    JSON.parse(f.app.integration.effect(f.actor, f.effect.id).result!).status,
    "expired",
  );
  assert.equal(state(f).state, "blocked");
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).paid, 0);
  const g = setup(t);
  await g.app.integration.execute(g.actor, g.effect.id, adapter());
  const original = g.app.integration.effect(g.actor, g.effect.id).result;
  const event = g.app.platform.event.bind(g.app.platform);
  const fault = t.mock.method(
    g.app.platform,
    "event",
    (...args: Parameters<typeof event>) => {
      if (args[1] === "integration.checkout-refreshed")
        throw Error("Synthetic late event fault");
      return event(...args);
    },
  );
  await assert.rejects(
    g.app.integration.refreshCheckout(
      g.actor,
      g.effect.id,
      adapter(receipt({ status: "expired" })),
    ),
    /late event fault/,
  );
  assert.equal(g.app.integration.effect(g.actor, g.effect.id).result, original);
  assert.equal(state(g).state, "unverified");
  fault.mock.restore();
  await g.app.integration.refreshCheckout(g.actor, g.effect.id, adapter());
  assert.equal(state(g).state, "ready");
});

test("current provider withdrawal, changed terms, password grants and restore hold block retained checkout access", async (t) => {
  const f = setup(t),
    b = buyer(f);
  await f.app.integration.execute(f.actor, f.effect.id, adapter());
  chooseProviders(f, f.actor, "withdraw", {
    accountId: f.buyer,
    region: "CA",
    mode: "strict",
    providers: [],
    version: 2,
    acknowledgment: "Withdraw",
  });
  assert.equal(state(f).state, "blocked");
  assert.throws(() => f.app.integration.checkouts.open(b, f.effect.id), {
    code: "CHECKOUT_UNAVAILABLE",
  });
  chooseProviders(f, f.actor, "reaccept", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["stripe"],
    version: 3,
    acknowledgment: "Reviewed again",
  });
  assert.equal(state(f).state, "ready");
  f.app.platform.isolateRestore("synthetic", new Date().toISOString());
  assert.equal(state(f).state, "blocked");
  assert.throws(() => f.app.integration.checkouts.open(b, f.effect.id), {
    code: "CHECKOUT_UNAVAILABLE",
  });
  const g = setup(t),
    user = buyer(g);
  await g.app.integration.execute(g.actor, g.effect.id, adapter());
  g.app.database
    .owned("iam")
    .run(
      "UPDATE iam_user_security SET revision=revision+1,password_change_required=1,updated_at=? WHERE user_id=?",
      new Date().toISOString(),
      user.id,
    );
  assert.throws(() => g.app.integration.checkouts.open(user, g.effect.id), {
    code: "PASSWORD_CHANGE_REQUIRED",
  });
  const terms = g.app.identity.residency
    .current(g.actor)
    .find((d) => d.provider === "stripe")!;
  g.app.identity.residency.withdraw(g.actor, "withdraw-terms", {
    provider: "stripe",
    disclosureId: terms.id,
    reason: "Synthetic change",
  });
  assert.equal(state(g).state, "blocked");
});

test("checkout refresh retains exclusive claims across restart, fences abandoned responses and never repeats a send", async (t) => {
  const f = setup(t);
  let sends = 0,
    resolve!: (v: EffectResult) => void;
  await f.app.integration.execute(f.actor, f.effect.id, {
    ...adapter(),
    execute: async () => {
      sends++;
      return receipt();
    },
  });
  const pending = f.app.integration.refreshCheckout(f.actor, f.effect.id, {
    ...adapter(),
    lookup: () =>
      new Promise((r) => {
        resolve = r;
      }),
  });
  assert.equal(state(f).state, "unverified");
  const other = new Application(f.path, "CA");
  t.after(() => other.close());
  await assert.rejects(
    other.integration.refreshCheckout(f.actor, f.effect.id, adapter()),
    { code: "STATE" },
  );
  assert.equal(other.integration.recoverStale(-1, f.actor.orgId), 1);
  await other.integration.refreshCheckout(
    f.actor,
    f.effect.id,
    adapter(receipt({ status: "expired" })),
  );
  resolve(receipt());
  await assert.rejects(pending, { code: "STATE" });
  assert.equal(state(f).state, "expired");
  assert.equal(sends, 1);
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).paid, 0);
});

test("failed or substituted checkout refresh blocks the old link and a later exact read can recover it", async (t) => {
  const f = setup(t);
  await f.app.integration.execute(f.actor, f.effect.id, adapter());
  await assert.rejects(
    f.app.integration.refreshCheckout(f.actor, f.effect.id, {
      ...adapter(),
      lookup: async () => {
        throw Error("Private provider failure");
      },
    }),
  );
  assert.equal(state(f).state, "unverified");
  const replacement = { ...receipt(), reference: "cs_test_substitute" };
  await assert.rejects(
    f.app.integration.refreshCheckout(
      f.actor,
      f.effect.id,
      adapter(replacement),
    ),
    { code: "PAYMENT_MISMATCH" },
  );
  assert.equal(
    f.app.integration.effect(f.actor, f.effect.id).external_ref,
    "cs_test_access",
  );
  assert.equal(state(f).state, "unverified");
  await f.app.integration.refreshCheckout(f.actor, f.effect.id, adapter());
  assert.equal(state(f).state, "ready");
});

test("Stripe checkout runs the last permission guard before create and refresh reads the exact bound session", async (t) => {
  const f = setup(t),
    a = new StripeAdapter("sk_test_synthetic", "http://127.0.0.1:3000", true);
  let creates = 0,
    reads = 0;
  t.mock.method(a.client.checkout.sessions, "create", async () => {
    creates++;
    throw Error("Must not send");
  });
  await assert.rejects(
    a.execute(f.app.integration.effect(f.actor, f.effect.id), () => {
      throw Error("Changed permission");
    }),
  );
  assert.equal(creates, 0);
  await f.app.integration.execute(f.actor, f.effect.id, adapter());
  const effect = f.app.integration.effect(f.actor, f.effect.id);
  t.mock.method(a.client.checkout.sessions, "retrieve", async (id: string) => {
    reads++;
    assert.equal(id, "cs_test_access");
    return {
      id,
      object: "checkout.session",
      mode: "payment",
      livemode: false,
      metadata: { effect_id: effect.id },
      amount_total: 11300,
      currency: "cad",
      status: "complete",
      payment_status: "unpaid",
      expires_at: 10,
      url: null,
    } as unknown as Stripe.Checkout.Session;
  });
  const result = await a.lookup(effect);
  assert.equal(reads, 1);
  assert.equal(result!.result.status, "complete");
  assert.equal(result!.result.paymentStatus, "unpaid");
});

test("authenticated checkout HTTP launch rechecks stale display state; refresh enforces finance, CSRF and exact fields", async (t) => {
  const f = setup(t),
    b = buyer(f),
    gateway: StripeGateway = {
      ...adapter(),
      verifyWebhook: () => {
        throw Error("No callback fixture");
      },
      verifySettlement: async () => {
        throw Error("No settlement fixture");
      },
    };
  const http = await createHttp(f.app, {
    origin: "http://localhost:3000",
    providers: new ProviderRuntime(f.app, [
      {
        id: "test",
        orgId: f.actor.orgId,
        workerUserId: f.actor.id,
        stripe: { adapter: gateway, webhookSecret: "whsec_test" },
      },
    ]),
  });
  t.after(() => http.close());
  await f.app.integration.execute(f.actor, f.effect.id, adapter());
  const login = async (email: string) => {
    const r = await http.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin: "http://localhost:3000" },
      payload: { email, password: "long-test-only-password" },
    });
    assert.equal(r.statusCode, 200);
    return {
      cookie: `distributor_session=${r.cookies[0]!.value}`,
      "x-csrf-token": r.json().csrf,
      origin: "http://localhost:3000",
    };
  };
  const headers = await login(`${f.buyer}-buyer@example.test`),
    path = `/api/effects/${f.effect.id}/checkout`,
    refresh = `/api/effects/${f.effect.id}/refresh-checkout`;
  assert.equal((await http.inject({ url: path })).statusCode, 401);
  const open = await http.inject({ url: path, headers });
  assert.equal(open.statusCode, 200);
  assert.equal(open.headers["cache-control"], "no-store");
  assert.equal(
    (await http.inject({ method: "POST", url: refresh, headers })).statusCode,
    403,
  );
  const admin = await login("admin@example.test");
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: refresh,
        headers: { ...admin, "x-csrf-token": "wrong" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: refresh,
        headers: admin,
        payload: { unexpected: true },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await http.inject({ method: "POST", url: refresh, headers: admin }))
      .statusCode,
    200,
  );
  pay(f, 11300);
  const stale = await http.inject({ url: path, headers });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().code, "CHECKOUT_UNAVAILABLE");
  assert.ok(!stale.body.includes("checkout.stripe.com"));
  assert.equal(state(f).state, "paid");
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).paid, 11300);
});
