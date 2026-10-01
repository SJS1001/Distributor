import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { fixture, accept, ship, chooseProviders } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import type { Actor, Role } from "../src/server/core.ts";
import type {
  Adapter,
  Effect,
  EffectResult,
} from "../src/server/integration.ts";
import { StripeAdapter } from "../src/server/providers.ts";
import { createHttp } from "../src/server/http.ts";
import {
  ProviderRuntime,
  type StripeGateway,
} from "../src/server/provider-runtime.ts";
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
type F = ReturnType<typeof setup>;
const view = (f: F, id = f.effect.id) =>
  f.app.integration.list(f.actor).find((e) => e.id === id)!.checkout!;
const input = (f: F, id = f.effect.id) => ({
  effectId: id,
  reviewVersion: view(f, id).reviewVersion,
  amount: f.app.billing.totals(f.actor, f.invoiceId).balance,
  reason: "Synthetic buyer-visible replacement after finance review",
});
const result = (
  changes: Record<string, unknown> = {},
  reference = "cs_test_renewal",
): EffectResult => ({
  reference,
  result: {
    amount: 11300,
    currency: "cad",
    status: "expired",
    paymentStatus: "unpaid",
    expiresAt: 1900000000,
    checkoutUrl: "https://checkout.stripe.com/synthetic",
    ...changes,
  },
});
const adapter = (value = result()): Adapter => ({
  execute: async () => value,
  lookup: async () => value,
  expireCheckout: async (_e, guard) => {
    guard();
    return value;
  },
});
const effect = (f: F, id = f.effect.id) =>
  f.app.integration.effect(f.actor, id);
function pay(f: F, amount: number, key = "partial") {
  return f.app.billing.manualPayment(f.actor, key, {
    invoiceId: f.invoiceId,
    amount,
    reference: `BANK-${key}`,
    reason: "Synthetic separate bank payment evidence",
  });
}
function user(f: F, role: Role): Actor {
  const u = f.app.identity.createUser(f.actor, `user-${role}`, {
    email: `${role}@renewal.example.test`,
    name: "Synthetic checkout user",
    password: "long-test-only-password",
    role,
    sites: [f.w1],
    ...(role === "buyer" ? { accountId: f.buyer } : {}),
  });
  return f.app.identity.currentActor({ ...f.actor, id: u.id });
}
function generations(f: F) {
  return f.app.database
    .owned("integration")
    .all(
      "SELECT * FROM integration_checkout_renewals ORDER BY created_at,successor_id",
    );
}

test("pending renewal freezes revised native balance, preserves original, and requires explicit send", async (t) => {
  const f = setup(t),
    original = effect(f);
  pay(f, 300);
  assert.equal(view(f).currentBalance, 11000);
  assert.equal(view(f).canRenew, true);
  const reviewed = input(f),
    renewed = f.app.integration.renewCheckout(f.actor, "renew", reviewed);
  assert.equal(renewed.state, "pending");
  assert.equal(effect(f, renewed.id).reference, `renewal:${original.id}`);
  assert.equal(JSON.parse(effect(f, renewed.id).payload).amount, 11000);
  assert.equal(effect(f).payload, original.payload);
  assert.equal(effect(f).reference, original.reference);
  assert.equal(effect(f).result, original.result);
  assert.equal(effect(f).external_ref, original.external_ref);
  assert.equal(view(f).state, "superseded");
  assert.equal(view(f, renewed.id).replacementReason, reviewed.reason);
  assert.deepEqual(
    f.app.integration.renewCheckout(f.actor, "renew", reviewed),
    renewed,
  );
  assert.equal(
    f.app.integration.checkout(f.actor, "fresh-checkout", {
      invoiceId: f.invoiceId,
    }).id,
    renewed.id,
  );
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).paid, 300);
  let sends = 0;
  await assert.rejects(
    f.app.integration.execute(f.actor, original.id, {
      ...adapter(),
      execute: async () => {
        sends++;
        return result();
      },
    }),
    { code: "STATE" },
  );
  assert.equal(sends, 0);
  assert.throws(() => f.app.integration.checkouts.open(f.actor, original.id), {
    code: "CHECKOUT_UNAVAILABLE",
  });
  await f.app.integration.execute(f.actor, renewed.id, {
    ...adapter(),
    execute: async () => {
      sends++;
      return result(
        {
          amount: 11000,
          status: "open",
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        },
        "cs_test_revised",
      );
    },
  });
  assert.equal(sends, 1);
  assert.equal(view(f, renewed.id).state, "ready");
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).paid, 300);
  assert.equal(effect(f).payload, original.payload);
  assert.equal(effect(f).reference, original.reference);
  assert.equal(effect(f).result, original.result);
  assert.equal(effect(f).external_ref, original.external_ref);
});

test("expired renewal chain survives restart, resolves latest generation and retains original sessions and money", async (t) => {
  const f = setup(t);
  await f.app.integration.execute(f.actor, f.effect.id, adapter());
  const originals: Effect[] = [effect(f)];
  let current = f.effect.id;
  for (let i = 0; i < 3; i++) {
    const next = f.app.integration.renewCheckout(
      f.actor,
      `renew-${i}`,
      input(f, current),
    );
    assert.equal(effect(f, next.id).reference, `renewal:${current}`);
    assert.equal(view(f, next.id).invoiceId, f.invoiceId);
    await f.app.integration.execute(
      f.actor,
      next.id,
      adapter(result({}, `cs_test_generation_${i}`)),
    );
    current = next.id;
    if (i < 2) originals.push(effect(f, current));
  }
  const other = new Application(f.path, "CA");
  t.after(() => other.close());
  assert.equal(
    other.integration.checkout(f.actor, "after-restart", {
      invoiceId: f.invoiceId,
    }).id,
    current,
  );
  assert.equal(generations(f).length, 3);
  for (const saved of originals) {
    assert.deepEqual(effect(f, saved.id), saved);
    assert.equal(view(f, saved.id).state, "superseded");
  }
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).paid, 0);
});

for (const [label, changes] of [
  ["open past its clock expiry", { status: "open", expiresAt: 1 }],
  ["complete unpaid", { status: "complete" }],
  ["paid expired", { paymentStatus: "paid" }],
  ["missing exact money", { amount: undefined }],
  ["missing expiry", { expiresAt: undefined }],
  ["wrong currency", { currency: "usd" }],
  ["unsupported status", { status: "unknown" }],
] as const)
  test(`renewal rejects ${label} without a second intent`, async (t) => {
    const f = setup(t),
      value = result(changes);
    value.result = JSON.parse(JSON.stringify(value.result));
    await f.app.integration.execute(f.actor, f.effect.id, adapter(value));
    assert.equal(view(f).canRenew, false);
    assert.throws(
      () => f.app.integration.renewCheckout(f.actor, "reject", input(f)),
      { code: "CHECKOUT_REVIEW_REQUIRED" },
    );
    assert.equal(generations(f).length, 0);
    assert.equal(f.app.integration.list(f.actor).length, 1);
  });

test("running, unknown, error, bound pending and stale reviews never renew", async (t) => {
  for (const patch of [
    "state='running'",
    "state='unknown'",
    "error='uncertain'",
    "external_ref='cs_test_bound'",
  ]) {
    const f = setup(t);
    f.app.database
      .owned("integration")
      .run(`UPDATE integration_effects SET ${patch} WHERE id=?`, f.effect.id);
    assert.throws(
      () => f.app.integration.renewCheckout(f.actor, "reject", input(f)),
      { code: "CHECKOUT_REVIEW_REQUIRED" },
    );
    assert.equal(generations(f).length, 0);
  }
  const f = setup(t),
    stale = input(f);
  await f.app.integration.execute(f.actor, f.effect.id, adapter());
  assert.throws(
    () => f.app.integration.renewCheckout(f.actor, "stale", stale),
    { code: "STALE" },
  );
});

test("review amount, reason and key validation fail atomically; a reused key must match exactly", (t) => {
  const f = setup(t),
    reviewed = input(f);
  for (const patch of [
    { amount: 0 },
    { amount: 1.5 },
    { reason: " " },
    { reason: "x".repeat(1001) },
  ])
    assert.throws(
      () =>
        f.app.integration.renewCheckout(f.actor, "invalid", {
          ...reviewed,
          ...patch,
        }),
      { code: "VALIDATION" },
    );
  assert.throws(
    () =>
      f.app.integration.renewCheckout(f.actor, "wrong-money", {
        ...reviewed,
        amount: 1,
      }),
    { code: "CHECKOUT_BALANCE_CHANGED" },
  );
  for (const key of ["", "x".repeat(129)])
    assert.throws(
      () => f.app.integration.renewCheckout(f.actor, key, reviewed),
      { code: "VALIDATION" },
    );
  assert.equal(generations(f).length, 0);
  f.app.integration.renewCheckout(f.actor, "exact", reviewed);
  assert.throws(
    () =>
      f.app.integration.renewCheckout(f.actor, "exact", {
        ...reviewed,
        reason: "Changed",
      }),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
});

test("cached renewal returns original receipt after later state, but first repeats real current access checks", async (t) => {
  for (const restriction of [
    "role",
    "inactive",
    "password",
    "account",
    "consent",
    "terms",
    "restore",
  ] as const) {
    const f = setup(t),
      finance = user(f, "finance"),
      reviewed = input(f),
      receipt = f.app.integration.renewCheckout(finance, "cached", reviewed);
    await f.app.integration.execute(f.actor, receipt.id, adapter());
    assert.deepEqual(
      f.app.integration.renewCheckout(finance, "cached", reviewed),
      receipt,
    );
    if (restriction === "role")
      f.app.database
        .owned("iam")
        .run("UPDATE iam_users SET role='support' WHERE id=?", finance.id);
    if (restriction === "inactive")
      f.app.database
        .owned("iam")
        .run("UPDATE iam_users SET active=0 WHERE id=?", finance.id);
    if (restriction === "password")
      f.app.database
        .owned("iam")
        .run(
          "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
          finance.id,
        );
    if (restriction === "account")
      f.app.database
        .owned("iam")
        .run(
          "UPDATE iam_users SET role='buyer',account_id=? WHERE id=?",
          f.buyer,
          finance.id,
        );
    if (restriction === "consent")
      chooseProviders(f, f.actor, "withdraw", {
        accountId: f.buyer,
        region: "CA",
        mode: "strict",
        providers: [],
        version: 2,
        acknowledgment: "Withdraw",
      });
    if (restriction === "terms") {
      const terms = f.app.identity.residency
        .current(f.actor)
        .find((d) => d.provider === "stripe")!;
      f.app.identity.residency.withdraw(f.actor, "terms", {
        provider: "stripe",
        disclosureId: terms.id,
        reason: "Synthetic withdrawal",
      });
    }
    if (restriction === "restore")
      f.app.platform.isolateRestore("synthetic", new Date().toISOString());
    assert.throws(
      () =>
        f.app.integration.renewCheckout(
          { ...finance, role: "admin", accountId: null },
          "cached",
          reviewed,
        ),
      (e) => !!(e as { code?: string }).code,
      restriction,
    );
    assert.equal(generations(f).length, 1);
  }
});

test("renewal event and audit failures roll back successor, permanent binding and receipt", (t) => {
  for (const method of ["event", "audit"] as const) {
    const f = setup(t),
      original = effect(f),
      reviewed = input(f),
      platform = f.app.platform;
    const originalMethod = platform[method].bind(platform);
    const mocked = t.mock.method(platform, method, ((...args: any[]) => {
      if (
        String(args[1]).includes("checkout.renew") ||
        String(args[1]).includes("checkout-renewed")
      )
        throw Error("Synthetic late rollback");
      return (originalMethod as Function)(...args);
    }) as (typeof platform)[typeof method]);
    assert.throws(
      () => f.app.integration.renewCheckout(f.actor, "rollback", reviewed),
      /late rollback/,
    );
    assert.deepEqual(effect(f), original);
    assert.equal(generations(f).length, 0);
    assert.equal(f.app.integration.list(f.actor).length, 1);
    mocked.mock.restore();
    assert.equal(
      f.app.integration.renewCheckout(f.actor, "rollback", reviewed).state,
      "pending",
    );
  }
});

test("distinct OS processes competing on the same reviewed predecessor create one successor", async (t) => {
  const f = setup(t),
    reviewed = input(f);
  const children = [0, 1].map((i) =>
    fork(new URL("./checkout-renewal-child.ts", import.meta.url), [], {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    }),
  );
  t.after(() => children.forEach((child) => child.kill()));
  const ready = children.map(
    (child, i) =>
      new Promise<void>((resolve, reject) => {
        child.once("message", (message) => {
          if ((message as any).ready) resolve();
          else reject(Error(JSON.stringify(message)));
        });
        child.once("error", reject);
        child.send({
          action: "init",
          path: f.path,
          actor: f.actor,
          key: `process-${i}`,
          input: reviewed,
        });
      }),
  );
  await Promise.all(ready);
  const responses = children.map(
    (child) =>
      new Promise<any>((resolve, reject) => {
        child.once("message", resolve);
        child.once("error", reject);
        child.once("exit", (code) => {
          if (code) reject(Error(`Child exited ${code}`));
        });
      }),
  );
  children.forEach((child) => child.send({ action: "run" }));
  const values = await Promise.all(responses);
  assert.equal(values.filter((v) => v.ok).length, 1, JSON.stringify(values));
  assert.equal(
    values.filter(
      (v) => !v.ok && ["STALE", "CHECKOUT_SUPERSEDED"].includes(v.code),
    ).length,
    1,
    JSON.stringify(values),
  );
  assert.equal(generations(f).length, 1);
  assert.equal(f.app.integration.list(f.actor).length, 2);
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).paid, 0);
});

const openReceipt = () =>
  result({ status: "open", expiresAt: Math.floor(Date.now() / 1000) + 3600 });
async function opened(f: F) {
  await f.app.integration.execute(f.actor, f.effect.id, adapter(openReceipt()));
}

test("close claim blocks launch and renewal across connections, recovery fences abandoned close", async (t) => {
  const f = setup(t);
  await opened(f);
  let resolve!: (r: EffectResult) => void;
  const pending = f.app.integration.closeCheckout(f.actor, f.effect.id, {
    ...adapter(),
    expireCheckout: () => new Promise((r) => (resolve = r)),
  });
  assert.throws(() => f.app.integration.checkouts.open(f.actor, f.effect.id), {
    code: "CHECKOUT_UNAVAILABLE",
  });
  const other = new Application(f.path, "CA");
  t.after(() => other.close());
  assert.throws(
    () => other.integration.renewCheckout(f.actor, "during-close", input(f)),
    { code: "STATE" },
  );
  await assert.rejects(
    other.integration.closeCheckout(f.actor, f.effect.id, adapter()),
    { code: "CHECKOUT_REVIEW_REQUIRED" },
  );
  assert.equal(other.integration.recoverStale(-1, f.actor.orgId), 1);
  await other.integration.refreshCheckout(
    f.actor,
    f.effect.id,
    adapter(result()),
  );
  const retained = effect(f);
  resolve(openReceipt());
  await assert.rejects(pending, { code: "STATE" });
  assert.deepEqual(effect(f), retained);
  assert.equal(
    f.app.integration.renewCheckout(f.actor, "after-recovery", input(f)).state,
    "pending",
  );
});

test("read lease prevents renewal of an otherwise expired checkout; substituted close response keeps original binding", async (t) => {
  const f = setup(t);
  await f.app.integration.execute(f.actor, f.effect.id, adapter());
  let resolve!: (r: EffectResult) => void;
  const refreshing = f.app.integration.refreshCheckout(f.actor, f.effect.id, {
    ...adapter(),
    lookup: () => new Promise((r) => (resolve = r)),
  });
  assert.throws(
    () => f.app.integration.renewCheckout(f.actor, "leased", input(f)),
    { code: "STATE" },
  );
  resolve(result());
  await refreshing;
  await assert.rejects(
    f.app.integration.closeCheckout(
      f.actor,
      f.effect.id,
      adapter(result({}, "cs_test_substituted")),
    ),
    { code: "PAYMENT_MISMATCH" },
  );
  assert.equal(effect(f).external_ref, "cs_test_renewal");
  assert.equal(effect(f).state, "completed");
  assert.ok(effect(f).error);
  assert.throws(
    () => f.app.integration.renewCheckout(f.actor, "unverified", input(f)),
    { code: "CHECKOUT_REVIEW_REQUIRED" },
  );
  await f.app.integration.refreshCheckout(f.actor, f.effect.id, adapter());
  assert.equal(
    f.app.integration.renewCheckout(f.actor, "verified", input(f)).state,
    "pending",
  );
});

for (const restriction of [
  "role",
  "password",
  "consent",
  "terms",
  "restore",
  "claim",
] as const)
  test(`close fresh pre-write guard rejects ${restriction} during preliminary read`, async (t) => {
    const f = setup(t),
      finance = user(f, "finance");
    await opened(f);
    let writes = 0;
    await assert.rejects(
      f.app.integration.closeCheckout(finance, f.effect.id, {
        ...adapter(),
        expireCheckout: async (_e, guard) => {
          if (restriction === "role")
            f.app.database
              .owned("iam")
              .run(
                "UPDATE iam_users SET role='support' WHERE id=?",
                finance.id,
              );
          if (restriction === "password")
            f.app.database
              .owned("iam")
              .run(
                "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
                finance.id,
              );
          if (restriction === "consent")
            chooseProviders(f, f.actor, "withdraw", {
              accountId: f.buyer,
              region: "CA",
              mode: "strict",
              providers: [],
              version: 2,
              acknowledgment: "Withdraw",
            });
          if (restriction === "terms") {
            const term = f.app.identity.residency
              .current(f.actor)
              .find((d) => d.provider === "stripe")!;
            f.app.identity.residency.withdraw(f.actor, "withdraw-term", {
              provider: "stripe",
              disclosureId: term.id,
              reason: "Synthetic withdrawal",
            });
          }
          if (restriction === "restore")
            f.app.platform.isolateRestore(
              "synthetic",
              new Date().toISOString(),
            );
          if (restriction === "claim")
            f.app.integration.recoverStale(-1, f.actor.orgId);
          guard();
          writes++;
          return result();
        },
      }),
    );
    assert.equal(writes, 0);
    assert.equal(effect(f).external_ref, "cs_test_renewal");
    assert.equal(effect(f).state, "completed");
    assert.ok(effect(f).error);
    assert.equal(generations(f).length, 0);
  });

test("balance change during close is safe, but stale amount cannot renew; close late event rolls back observation", async (t) => {
  const f = setup(t);
  await opened(f);
  const reviewed = input(f);
  let writes = 0;
  await f.app.integration.closeCheckout(f.actor, f.effect.id, {
    ...adapter(),
    expireCheckout: async (_e, guard) => {
      pay(f, 300);
      guard();
      writes++;
      return result();
    },
  });
  assert.equal(writes, 1);
  assert.equal(effect(f).external_ref, "cs_test_renewal");
  assert.throws(
    () =>
      f.app.integration.renewCheckout(f.actor, "stale-money", {
        ...input(f),
        amount: reviewed.amount,
      }),
    { code: "CHECKOUT_BALANCE_CHANGED" },
  );
  const next = f.app.integration.renewCheckout(
    f.actor,
    "current-money",
    input(f),
  );
  assert.equal(JSON.parse(effect(f, next.id).payload).amount, 11000);
  const g = setup(t);
  await opened(g);
  const original = effect(g),
    event = g.app.platform.event.bind(g.app.platform);
  const fault = t.mock.method(
    g.app.platform,
    "event",
    (...args: Parameters<typeof event>) => {
      if (args[1] === "integration.checkout-closed")
        throw Error("Synthetic late close failure");
      return event(...args);
    },
  );
  await assert.rejects(
    g.app.integration.closeCheckout(g.actor, g.effect.id, adapter()),
    /late close failure/,
  );
  assert.equal(effect(g).result, original.result);
  assert.equal(effect(g).external_ref, original.external_ref);
  assert.ok(effect(g).error);
  fault.mock.restore();
  await g.app.integration.refreshCheckout(g.actor, g.effect.id, adapter());
  assert.equal(view(g).canRenew, true);
});

function session(
  e: Effect,
  changes: Record<string, unknown> = {},
): Stripe.Checkout.Session {
  return {
    id: e.external_ref!,
    object: "checkout.session",
    mode: "payment",
    livemode: false,
    metadata: { effect_id: e.id },
    amount_total: 11300,
    currency: "cad",
    status: "open",
    payment_status: "unpaid",
    expires_at: 1900000000,
    url: "https://checkout.stripe.com/synthetic",
    ...changes,
  } as unknown as Stripe.Checkout.Session;
}

test("synthetic Stripe close retrieves exact session then guard then expires using stable idempotency", async (t) => {
  const f = setup(t);
  await opened(f);
  const e = effect(f),
    sdk = new StripeAdapter("sk_test_synthetic", "http://127.0.0.1:3000", true),
    order: string[] = [];
  t.mock.method(
    sdk.client.checkout.sessions,
    "retrieve",
    async (id: string) => {
      assert.equal(id, e.external_ref);
      order.push("retrieve");
      return session(e);
    },
  );
  const keys: string[] = [];
  t.mock.method(
    sdk.client.checkout.sessions,
    "expire",
    async (
      id: string,
      _params: unknown,
      options: { idempotencyKey: string },
    ) => {
      assert.equal(id, e.external_ref);
      order.push("expire");
      keys.push(options.idempotencyKey);
      return session(e, { status: "expired" });
    },
  );
  for (let i = 0; i < 2; i++) {
    const r = await sdk.expireCheckout(e, () => order.push("guard"));
    assert.equal(r.result.status, "expired");
  }
  assert.deepEqual(order, [
    "retrieve",
    "guard",
    "expire",
    "retrieve",
    "guard",
    "expire",
  ]);
  assert.deepEqual(keys, [
    `distributor:expire:${e.id}`,
    `distributor:expire:${e.id}`,
  ]);
});

for (const [label, changes] of [
  ["already expired", { status: "expired" }],
  ["complete", { status: "complete" }],
  ["paid", { payment_status: "paid" }],
  ["wrong id", { id: "cs_test_substituted" }],
  ["wrong metadata", { metadata: { effect_id: "other" } }],
  ["wrong amount", { amount_total: 11299 }],
  ["wrong currency", { currency: "usd" }],
  ["live", { livemode: true }],
  ["unknown", { status: null }],
] as const)
  test(`synthetic Stripe close ${label} performs no write`, async (t) => {
    const f = setup(t);
    await opened(f);
    const e = effect(f),
      sdk = new StripeAdapter(
        "sk_test_synthetic",
        "http://127.0.0.1:3000",
        true,
      );
    let writes = 0,
      guards = 0;
    t.mock.method(sdk.client.checkout.sessions, "retrieve", async () =>
      session(e, changes),
    );
    t.mock.method(sdk.client.checkout.sessions, "expire", async () => {
      writes++;
      return session(e, { status: "expired" });
    });
    if (label === "already expired")
      assert.equal(
        (await sdk.expireCheckout(e, () => guards++)).result.status,
        "expired",
      );
    else await assert.rejects(sdk.expireCheckout(e, () => guards++));
    assert.equal(writes, 0);
    assert.equal(guards, 0);
  });

test("real buyer, commercial and support cannot renew or close; forged finance does not confer authority", async (t) => {
  const f = setup(t),
    reviewed = input(f);
  for (const role of ["buyer", "commercial", "support"] as const) {
    const actual = user(f, role),
      forged = { ...actual, role: "finance" as const, accountId: null };
    assert.throws(
      () => f.app.integration.renewCheckout(forged, `renew-${role}`, reviewed),
      { code: "FORBIDDEN" },
    );
  }
  await opened(f);
  for (const role of ["buyer", "commercial", "support"] as const) {
    const actual = f.app.identity
      .users(f.actor)
      .find((u) => u.email === `${role}@renewal.example.test`)!;
    await assert.rejects(
      f.app.integration.closeCheckout(
        { ...f.actor, id: actual.id, role: "admin" },
        f.effect.id,
        adapter(),
      ),
      { code: "FORBIDDEN" },
    );
  }
  assert.equal(generations(f).length, 0);
});

test("synthetic Stripe guard failure after retrieve does not reach expire", async (t) => {
  const f = setup(t);
  await opened(f);
  const e = effect(f),
    sdk = new StripeAdapter("sk_test_synthetic", "http://127.0.0.1:3000", true),
    order: string[] = [];
  t.mock.method(sdk.client.checkout.sessions, "retrieve", async () => {
    order.push("retrieve");
    return session(e);
  });
  t.mock.method(sdk.client.checkout.sessions, "expire", async () => {
    order.push("expire");
    return session(e, { status: "expired" });
  });
  await assert.rejects(
    sdk.expireCheckout(e, () => {
      order.push("guard");
      throw Error("Synthetic revoked permission");
    }),
    /revoked permission/,
  );
  assert.deepEqual(order, ["retrieve", "guard"]);
});

test("renew and close HTTP enforce strict fields, CSRF, current roles, explicit sends and exact cached receipt", async (t) => {
  const f = setup(t),
    b = user(f, "buyer");
  const gateway: StripeGateway = {
    ...adapter(),
    verifyWebhook: () => {
      throw Error("No webhook fixture");
    },
    verifySettlement: async () => {
      throw Error("No settlement fixture");
    },
  };
  let writes = 0;
  gateway.expireCheckout = async (_e, guard) => {
    guard();
    writes++;
    return result();
  };
  const http = await createHttp(f.app, {
    origin: "http://localhost:3000",
    staticRoot: "/nonexistent-distributor-test",
    providers: new ProviderRuntime(f.app, [
      {
        id: "synthetic",
        orgId: f.actor.orgId,
        workerUserId: f.actor.id,
        stripe: { adapter: gateway, webhookSecret: "whsec_test_synthetic" },
      },
    ]),
  });
  t.after(() => http.close());
  const auth = (actor: Actor) => {
    const email = f.app.identity
      .users(f.actor)
      .find((u) => u.id === actor.id)!.email;
    const login = f.app.identity.login(email, "long-test-only-password");
    return {
      cookie: `distributor_session=${login.token}`,
      "x-csrf-token": login.csrf,
      origin: "http://localhost:3000",
      "idempotency-key": "http-renew",
    };
  };
  const headers = auth(f.actor),
    buyerHeaders = auth(b),
    url = "/api/commands/stripe.checkout.renew",
    reviewed = input(f);
  assert.equal(
    (await http.inject({ method: "POST", url, payload: reviewed })).statusCode,
    403,
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url,
        headers: buyerHeaders,
        payload: reviewed,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url,
        headers: { ...headers, "x-csrf-token": "wrong" },
        payload: reviewed,
      })
    ).statusCode,
    403,
  );
  for (const payload of [
    { ...reviewed, extra: true },
    { ...reviewed, amount: "11300" },
    { ...reviewed, reason: null },
    { ...reviewed, reviewVersion: null },
  ])
    assert.equal(
      (await http.inject({ method: "POST", url, headers, payload })).statusCode,
      400,
    );
  const saved = await http.inject({
    method: "POST",
    url,
    headers,
    payload: reviewed,
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.deepEqual(
    (
      await http.inject({ method: "POST", url, headers, payload: reviewed })
    ).json(),
    saved.json(),
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url,
        headers,
        payload: { ...reviewed, reason: "Different" },
      })
    ).statusCode,
    409,
  );
  const next = saved.json().id as string,
    close = `/api/effects/${next}/close-checkout`;
  assert.equal(effect(f, next).state, "pending");
  assert.equal(writes, 0);
  await f.app.integration.execute(f.actor, next, adapter(openReceipt()));
  assert.equal(
    (await http.inject({ method: "POST", url: close, headers: buyerHeaders }))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: close,
        headers: { ...headers, "x-csrf-token": "wrong" },
      })
    ).statusCode,
    403,
  );
  for (const payload of [{ unexpected: true }, [], null])
    assert.equal(
      (
        await http.inject({
          method: "POST",
          url: close,
          headers: { ...headers, "content-type": "application/json" },
          payload: JSON.stringify(payload),
        })
      ).statusCode,
      400,
    );
  const closed = await http.inject({ method: "POST", url: close, headers });
  assert.equal(closed.statusCode, 200, closed.body);
  assert.equal(writes, 1);
  assert.equal(view(f, next).canRenew, true);
  assert.deepEqual(
    (
      await http.inject({ method: "POST", url, headers, payload: reviewed })
    ).json(),
    saved.json(),
  );
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).paid, 0);
});

test("original callbacks retain original frozen money and session after a revised successor", async (t) => {
  const f = setup(t);
  await f.app.integration.execute(f.actor, f.effect.id, adapter());
  const original = effect(f);
  pay(f, 300);
  const next = f.app.integration.renewCheckout(
    f.actor,
    "replace-expired",
    input(f),
  );
  await f.app.integration.execute(
    f.actor,
    next.id,
    adapter(result({ amount: 11000 }, "cs_test_successor")),
  );
  const verify = async (sessionId: string) => {
    assert.equal(sessionId, original.external_ref);
    return {
      paid: true,
      amount: 11300,
      currency: "cad",
      paymentId: "pi_test_original",
    };
  };
  await assert.rejects(
    f.app.integration.stripeSettlement(
      f.actor,
      {
        id: "evt_wrong_effect",
        sessionId: original.external_ref!,
        effectId: next.id,
      },
      verify,
    ),
    { code: "PAYMENT_MISMATCH" },
  );
  await assert.rejects(
    f.app.integration.stripeSettlement(
      f.actor,
      {
        id: "evt_revised_money",
        sessionId: original.external_ref!,
        effectId: original.id,
      },
      async () => ({
        paid: true,
        amount: 11000,
        currency: "cad",
        paymentId: "pi_test_wrong_money",
      }),
    ),
    { code: "PAYMENT_MISMATCH" },
  );
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).paid, 300);
  const event = {
    id: "evt_original",
    sessionId: original.external_ref!,
    effectId: original.id,
  };
  assert.deepEqual(
    await f.app.integration.stripeSettlement(f.actor, event, verify),
    { duplicate: false },
  );
  assert.deepEqual(
    await f.app.integration.stripeSettlement(f.actor, event, verify),
    { duplicate: true },
  );
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).paid, 11600);
  assert.deepEqual(effect(f), original);
  assert.equal(JSON.parse(effect(f, next.id).payload).amount, 11000);
  assert.equal(effect(f, next.id).external_ref, "cs_test_successor");
});

test("cached renewal receipt is durable across restart after the successor itself is replaced", async (t) => {
  const f = setup(t),
    reviewed = input(f),
    first = f.app.integration.renewCheckout(f.actor, "durable", reviewed);
  await f.app.integration.execute(f.actor, first.id, adapter());
  const second = f.app.integration.renewCheckout(
    f.actor,
    "next",
    input(f, first.id),
  );
  const restarted = new Application(f.path, "CA");
  t.after(() => restarted.close());
  assert.deepEqual(
    restarted.integration.renewCheckout(f.actor, "durable", reviewed),
    first,
  );
  assert.equal(
    restarted.integration.checkout(f.actor, "current", {
      invoiceId: f.invoiceId,
    }).id,
    second.id,
  );
  assert.equal(generations(f).length, 2);
});
