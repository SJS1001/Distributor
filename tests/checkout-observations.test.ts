import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, accept, ship, chooseProviders } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import type { Actor, Role } from "../src/server/core.ts";
import type { Adapter, EffectResult } from "../src/server/integration.ts";
import type {
  CheckoutHistoryPage,
  CheckoutObservation,
} from "../src/shared/checkout.ts";

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
function receipt(
  changes: Record<string, unknown> = {},
  reference = "cs_test_history",
): EffectResult {
  return {
    reference,
    result: {
      amount: 11300,
      currency: "cad",
      status: "open",
      paymentStatus: "unpaid",
      expiresAt: 1900000000,
      checkoutUrl: "https://checkout.stripe.com/private_bearer",
      privateSecret: "private-provider-secret",
      actorScope: "private-provider-actor",
      ...changes,
    },
  };
}
function adapter(value: EffectResult | null = receipt()): Adapter {
  return {
    execute: async () => {
      assert.ok(value);
      return value;
    },
    lookup: async () => value,
    expireCheckout: async (_effect, guard) => {
      guard();
      assert.ok(value);
      return value;
    },
  };
}
function history(
  f: F,
  effectId = f.effect.id,
  after?: string,
): CheckoutHistoryPage {
  return f.app.integration.checkouts.history(f.actor, effectId, after);
}
function user(f: F, role: Role, accountId = f.buyer): Actor {
  const u = f.app.identity.createUser(f.actor, `user-${role}-${accountId}`, {
    email: `${role}-${accountId}@history.example.test`,
    name: "Synthetic history user",
    password: "long-test-only-password",
    role,
    sites: [f.w1],
    ...(role === "buyer" ? { accountId } : {}),
  });
  return f.app.identity.currentActor({ ...f.actor, id: u.id });
}
function otherAccount(f: F) {
  return f.app.identity.createCustomer(f.actor, "other-account", {
    name: "Synthetic isolated buyer",
    tier: "standard",
    creditLimit: 1000000,
  }).id;
}
function renew(f: F, effectId: string, key: string) {
  const view = f.app.integration
    .list(f.actor)
    .find((e) => e.id === effectId)!.checkout!;
  return f.app.integration.renewCheckout(f.actor, key, {
    effectId,
    reviewVersion: view.reviewVersion,
    amount: f.app.billing.totals(f.actor, f.invoiceId).balance,
    reason: "Synthetic reviewed successor",
  });
}
function publicSnapshot(item: CheckoutObservation) {
  assert.deepEqual(
    Object.keys(item).sort(),
    [
      "id",
      "effectId",
      "invoiceId",
      "observedAt",
      "source",
      "outcome",
      "reference",
      "amount",
      "currency",
      "status",
      "paymentStatus",
      "expiresAt",
    ].sort(),
  );
  assert.match(item.observedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.doesNotMatch(
    JSON.stringify(item),
    /checkout\.stripe|private-provider|private_bearer|claim_token|actor_id|org_id|account_id/,
  );
}
function native(f: F) {
  const billing = f.app.database.owned("billing");
  return {
    invoice: f.app.billing.invoice(f.actor, f.invoiceId),
    totals: f.app.billing.totals(f.actor, f.invoiceId),
    payments: billing.all("SELECT * FROM billing_payments ORDER BY id"),
    refunds: billing.all("SELECT * FROM billing_refunds ORDER BY id"),
  };
}

test("immutable send/refresh/close history spans renewal generations and restart, retaining frozen money and native cash", async (t) => {
  const f = setup(t),
    initial = native(f),
    originalPayload = f.app.integration.effect(f.actor, f.effect.id).payload;
  assert.deepEqual(history(f), { items: [], next: null });
  await f.app.integration.execute(f.actor, f.effect.id, adapter());
  const sent = history(f).items[0]!;
  await f.app.integration.refreshCheckout(
    f.actor,
    f.effect.id,
    adapter(receipt({ status: "complete", paymentStatus: "paid" })),
  );
  assert.deepEqual(history(f).items[1], sent);
  assert.deepEqual(native(f), initial);
  await f.app.integration.refreshCheckout(f.actor, f.effect.id, adapter());
  await f.app.integration.closeCheckout(
    f.actor,
    f.effect.id,
    adapter(receipt({ status: "expired" })),
  );
  assert.deepEqual(native(f), initial);
  const saved = history(f),
    predecessor = f.app.integration.effect(f.actor, f.effect.id);
  f.app.billing.manualPayment(f.actor, "bank", {
    invoiceId: f.invoiceId,
    amount: 300,
    reference: "SYNTHETIC-BANK",
    reason: "Synthetic separate bank evidence",
  });
  const afterBank = native(f),
    next = renew(f, f.effect.id, "renew");
  assert.deepEqual(history(f), saved);
  await f.app.integration.execute(
    f.actor,
    next.id,
    adapter(receipt({ amount: 11000, status: "expired" }, "cs_test_successor")),
  );
  const second = renew(f, next.id, "renew-again");
  await f.app.integration.execute(
    f.actor,
    second.id,
    adapter(receipt({ amount: 11000 }, "cs_test_second_successor")),
  );
  const page = history(f);
  assert.deepEqual(page.items.slice(2), saved.items);
  assert.deepEqual(
    page.items.map((i) => i.source),
    ["send", "send", "close", "refresh", "refresh", "send"],
  );
  assert.deepEqual(
    page.items.map((i) => i.amount),
    [11000, 11000, 11300, 11300, 11300, 11300],
  );
  assert.ok(
    page.items.every((i) => i.currency === "CAD" && i.outcome === "verified"),
  );
  page.items.forEach(publicSnapshot);
  assert.deepEqual(history(f, next.id), page);
  assert.deepEqual(history(f, second.id), page);
  assert.deepEqual(f.app.integration.effect(f.actor, f.effect.id), predecessor);
  assert.equal(
    f.app.integration.effect(f.actor, f.effect.id).payload,
    originalPayload,
  );
  assert.deepEqual(native(f), afterBank);
  // Mutating a returned object must never mutate the retained snapshot.
  page.items[0]!.status = "complete";
  const restarted = new Application(f.path, "CA");
  t.after(() => restarted.close());
  assert.equal(
    restarted.integration.checkouts.history(f.actor, second.id).items[0]!
      .status,
    "open",
  );
  assert.deepEqual(
    restarted.integration.checkouts.history(f.actor, next.id),
    history(f),
  );
});

for (const [label, changes] of [
  [
    "legacy partial",
    { amount: undefined, paymentStatus: undefined, expiresAt: undefined },
  ],
  ["wrong money", { amount: 1 }],
  ["wrong currency", { currency: "usd" }],
  ["invalid status", { status: "private-provider-secret" }],
  ["invalid payment status", { paymentStatus: "unknown" }],
  ["invalid expiry", { expiresAt: 1.5 }],
] as const)
  test(`${label} receipt archives unverified null proof without changing prior operation behavior`, async (t) => {
    const f = setup(t),
      before = native(f),
      value = receipt(changes);
    value.result = JSON.parse(JSON.stringify(value.result));
    assert.equal(
      (await f.app.integration.execute(f.actor, f.effect.id, adapter(value)))
        .state,
      "completed",
    );
    const item = history(f).items[0]!;
    assert.equal(item.outcome, "unverified");
    assert.equal(item.amount, 11300);
    assert.equal(item.currency, "CAD");
    assert.equal(item.status, null);
    assert.equal(item.paymentStatus, null);
    assert.equal(item.expiresAt, null);
    publicSnapshot(item);
    assert.deepEqual(native(f), before);
  });

test("null lookup archives not_found, reconcile records verified recovery, and older results stay unchanged", async (t) => {
  const f = setup(t),
    before = native(f);
  await f.app.integration.execute(f.actor, f.effect.id, adapter());
  const old = history(f).items[0]!,
    result = f.app.integration.effect(f.actor, f.effect.id).result;
  assert.equal(
    (
      await f.app.integration.refreshCheckout(
        f.actor,
        f.effect.id,
        adapter(null),
      )
    ).state,
    "unknown",
  );
  const missing = history(f).items[0]!;
  assert.equal(missing.source, "refresh");
  assert.equal(missing.outcome, "not_found");
  assert.equal(missing.status, null);
  assert.equal(missing.paymentStatus, null);
  assert.equal(missing.expiresAt, null);
  assert.equal(f.app.integration.effect(f.actor, f.effect.id).result, result);
  await f.app.integration.reconcile(
    f.actor,
    f.effect.id,
    adapter(receipt({ status: "expired" })),
  );
  assert.deepEqual(history(f).items.slice(1), [missing, old]);
  assert.equal(history(f).items[0]!.source, "reconcile");
  assert.equal(history(f).items[0]!.outcome, "verified");
  history(f).items.forEach(publicSnapshot);
  assert.deepEqual(native(f), before);
});

test("history pages twenty newest completions by sequence with scoped opaque continuation", async (t) => {
  const f = setup(t);
  await f.app.integration.execute(f.actor, f.effect.id, adapter());
  const recorded = [history(f).items[0]!];
  for (let i = 0; i < 22; i++) {
    await f.app.integration.refreshCheckout(
      f.actor,
      f.effect.id,
      adapter(receipt({ expiresAt: 1900000001 + i })),
    );
    recorded.push(history(f).items[0]!);
  }
  const page = history(f);
  assert.equal(page.items.length, 20);
  assert.ok(page.next);
  assert.equal(page.next, page.items.at(-1)!.id);
  const tail = history(f, f.effect.id, page.next);
  assert.equal(tail.next, null);
  assert.deepEqual([...page.items, ...tail.items], recorded.toReversed());
  const invoiceId = ship(f, accept(f, 1, "second-invoice").id).invoiceId;
  const other = f.app.integration.checkout(f.actor, "second-checkout", {
    invoiceId,
  });
  await f.app.integration.execute(
    f.actor,
    other.id,
    adapter(receipt({}, "cs_test_other_invoice")),
  );
  const foreign = history(f, other.id).items[0]!.id;
  for (const cursor of ["invalid", "1", foreign])
    assert.throws(() => history(f, f.effect.id, cursor), { code: "CURSOR" });
  for (const cursor of ["", " ", "x".repeat(129)])
    assert.throws(() => history(f, f.effect.id, cursor), {
      code: "VALIDATION",
    });
  assert.deepEqual(history(f), page);
});

test("fresh roles, account and invoice scope defeat forged actors and isolate buyers", async (t) => {
  const f = setup(t),
    buyer = user(f, "buyer"),
    foreign = otherAccount(f);
  await f.app.integration.execute(f.actor, f.effect.id, adapter());
  for (const role of ["finance", "commercial", "support"] as const)
    assert.deepEqual(
      f.app.integration.checkouts.history(user(f, role), f.effect.id),
      history(f),
    );
  assert.deepEqual(
    f.app.integration.checkouts.history(buyer, f.effect.id),
    history(f),
  );
  const stranger = user(f, "buyer", foreign);
  assert.throws(
    () =>
      f.app.integration.checkouts.history(
        { ...stranger, role: "admin", accountId: null },
        f.effect.id,
      ),
    { code: "FORBIDDEN" },
  );
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET account_id=? WHERE id=?", foreign, buyer.id);
  assert.throws(() => f.app.integration.checkouts.history(buyer, f.effect.id), {
    code: "FORBIDDEN",
  });
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET account_id=? WHERE id=?", f.buyer, buyer.id);
  f.app.database
    .owned("billing")
    .run(
      "UPDATE billing_invoices SET account_id=? WHERE id=?",
      foreign,
      f.invoiceId,
    );
  assert.throws(() => f.app.integration.checkouts.history(buyer, f.effect.id), {
    code: "FORBIDDEN",
  });
  assert.throws(() => history(f), { code: "PAYMENT_MISMATCH" });
});

for (const restriction of ["role", "inactive", "password"] as const)
  test(`fresh ${restriction} revocation denies retained history and continuation`, async (t) => {
    const f = setup(t),
      finance = user(f, "finance");
    await f.app.integration.execute(f.actor, f.effect.id, adapter());
    const id = history(f).items[0]!.id;
    if (restriction === "role")
      f.app.database
        .owned("iam")
        .run("UPDATE iam_users SET role='warehouse' WHERE id=?", finance.id);
    if (restriction === "inactive")
      f.app.database
        .owned("iam")
        .run("UPDATE iam_users SET active=0 WHERE id=?", finance.id);
    if (restriction === "password") {
      const u = f.app.identity.users(f.actor).find((u) => u.id === finance.id)!;
      f.app.identity.resetPassword(f.actor, "reset", {
        userId: finance.id,
        revision: u.revision,
        password: "new-test-only-password",
        currentPassword: "long-test-only-password",
        reason: "Synthetic revocation",
      });
    }
    for (const after of [undefined, id])
      assert.throws(
        () =>
          f.app.integration.checkouts.history(
            { ...finance, role: "admin" },
            f.effect.id,
            after,
          ),
        {
          code:
            restriction === "password"
              ? "PASSWORD_CHANGE_REQUIRED"
              : "FORBIDDEN",
        },
      );
  });

for (const action of ["send", "refresh", "close"] as const)
  test(`late ${action} claim cannot archive or overwrite a successor observation`, async (t) => {
    const f = setup(t);
    if (action !== "send")
      await f.app.integration.execute(f.actor, f.effect.id, adapter());
    const before = history(f);
    let resolve!: (value: EffectResult) => void;
    const paused: Adapter = {
      ...adapter(),
      execute: () =>
        new Promise((r) => {
          resolve = r;
        }),
      lookup: () =>
        new Promise((r) => {
          resolve = r;
        }),
      expireCheckout: () =>
        new Promise((r) => {
          resolve = r;
        }),
    };
    const pending =
      action === "send"
        ? f.app.integration.execute(f.actor, f.effect.id, paused)
        : action === "close"
          ? f.app.integration.closeCheckout(f.actor, f.effect.id, paused)
          : f.app.integration.refreshCheckout(f.actor, f.effect.id, paused);
    const restarted = new Application(f.path, "CA");
    t.after(() => restarted.close());
    assert.equal(restarted.integration.recoverStale(-1, f.actor.orgId), 1);
    if (action === "send")
      await restarted.integration.reconcile(
        f.actor,
        f.effect.id,
        adapter(receipt({ status: "expired" })),
      );
    else
      await restarted.integration.refreshCheckout(
        f.actor,
        f.effect.id,
        adapter(receipt({ status: "expired" })),
      );
    const retained = history(f),
      effect = f.app.integration.effect(f.actor, f.effect.id);
    assert.equal(retained.items.length, before.items.length + 1);
    resolve(receipt());
    await assert.rejects(pending, { code: "STATE" });
    assert.deepEqual(history(f), retained);
    assert.deepEqual(f.app.integration.effect(f.actor, f.effect.id), effect);
  });

for (const action of ["send", "refresh", "close"] as const)
  test(`${action} completion rollback leaves no observation and keeps older snapshots`, async (t) => {
    const f = setup(t);
    if (action !== "send")
      await f.app.integration.execute(f.actor, f.effect.id, adapter());
    const before = history(f),
      result = f.app.integration.effect(f.actor, f.effect.id).result;
    const original = f.app.integration.checkouts.recordObservation.bind(
      f.app.integration.checkouts,
    );
    const fault = t.mock.method(
      f.app.integration.checkouts,
      "recordObservation",
      (...args: Parameters<typeof original>) => {
        original(...args);
        throw Error("Synthetic failure after archive insertion");
      },
    );
    const pending =
      action === "send"
        ? f.app.integration.execute(f.actor, f.effect.id, adapter())
        : action === "close"
          ? f.app.integration.closeCheckout(
              f.actor,
              f.effect.id,
              adapter(receipt({ status: "expired" })),
            )
          : f.app.integration.refreshCheckout(
              f.actor,
              f.effect.id,
              adapter(receipt({ status: "expired" })),
            );
    await assert.rejects(pending, /after archive insertion/);
    assert.deepEqual(history(f), before);
    assert.equal(f.app.integration.effect(f.actor, f.effect.id).result, result);
    fault.mock.restore();
  });

test("startup never fabricates history from legacy completed receipts or pending renewal generations", (t) => {
  const f = setup(t),
    value = receipt({ status: "expired" });
  f.app.database
    .owned("integration")
    .run(
      "UPDATE integration_effects SET state='completed',external_ref=?,result=? WHERE id=?",
      value.reference,
      JSON.stringify(value.result),
      f.effect.id,
    );
  const next = renew(f, f.effect.id, "legacy-renew");
  const restarted = new Application(f.path, "CA");
  t.after(() => restarted.close());
  assert.deepEqual(
    restarted.integration.checkouts.history(f.actor, f.effect.id),
    { items: [], next: null },
  );
  assert.deepEqual(restarted.integration.checkouts.history(f.actor, next.id), {
    items: [],
    next: null,
  });
});

test("failed provider I/O invents no observation; null reconciliation records only the actual absence", async (t) => {
  const f = setup(t),
    before = native(f);
  const failed: Adapter = {
    ...adapter(),
    execute: async () => {
      throw Error("Synthetic lost send response");
    },
    lookup: async () => {
      throw Error("Synthetic read failure");
    },
  };
  assert.equal(
    (await f.app.integration.execute(f.actor, f.effect.id, failed)).state,
    "unknown",
  );
  assert.deepEqual(history(f), { items: [], next: null });
  await assert.rejects(
    f.app.integration.reconcile(f.actor, f.effect.id, failed),
    /read failure/,
  );
  assert.deepEqual(history(f), { items: [], next: null });
  await f.app.integration.reconcile(f.actor, f.effect.id, adapter(null));
  const absent = history(f).items[0]!;
  assert.equal(absent.source, "reconcile");
  assert.equal(absent.outcome, "not_found");
  assert.equal(absent.reference, null);
  assert.equal(absent.status, null);
  assert.equal(absent.paymentStatus, null);
  assert.equal(absent.expiresAt, null);
  await f.app.integration.reconcile(f.actor, f.effect.id, adapter());
  const saved = history(f);
  await assert.rejects(
    f.app.integration.refreshCheckout(f.actor, f.effect.id, failed),
    /read failure/,
  );
  assert.deepEqual(history(f), saved);
  assert.deepEqual(native(f), before);
});

test("unsupported references and private receipt fields never enter the public archive", async (t) => {
  const f = setup(t);
  await f.app.integration.execute(
    f.actor,
    f.effect.id,
    adapter(receipt({}, "https://private-provider-secret.example.test/bearer")),
  );
  const item = history(f).items[0]!;
  assert.equal(item.outcome, "unverified");
  assert.equal(item.reference, null);
  assert.equal(item.status, null);
  assert.equal(item.paymentStatus, null);
  assert.equal(item.expiresAt, null);
  publicSnapshot(item);
});

test("fresh organization and effect account scope prevent reads of retained history", async (t) => {
  const f = setup(t),
    buyer = user(f, "buyer"),
    foreign = otherAccount(f);
  await f.app.integration.execute(f.actor, f.effect.id, adapter());
  const saved = history(f);
  assert.throws(
    () =>
      f.app.integration.checkouts.history(
        { ...f.actor, orgId: "foreign-organization" },
        f.effect.id,
      ),
    { code: "FORBIDDEN" },
  );
  f.app.database
    .owned("integration")
    .run(
      "UPDATE integration_effects SET account_id=? WHERE id=?",
      foreign,
      f.effect.id,
    );
  assert.throws(() => f.app.integration.checkouts.history(buyer, f.effect.id), {
    code: "FORBIDDEN",
  });
  assert.throws(() => history(f), { code: "PAYMENT_MISMATCH" });
  f.app.database
    .owned("integration")
    .run(
      "UPDATE integration_effects SET account_id=?,org_id='foreign-organization' WHERE id=?",
      f.buyer,
      f.effect.id,
    );
  assert.throws(() => history(f), { code: "NOT_FOUND" });
  f.app.database
    .owned("integration")
    .run(
      "UPDATE integration_effects SET org_id=? WHERE id=?",
      f.actor.orgId,
      f.effect.id,
    );
  assert.deepEqual(history(f), saved);
});

test("history HTTP uses strict GET params/query, no-store, real sessions and fresh scoped authorization", async (t) => {
  const f = setup(t),
    buyer = user(f, "buyer"),
    stranger = user(f, "buyer", otherAccount(f));
  await f.app.integration.execute(f.actor, f.effect.id, adapter());
  const http = await createHttp(f.app, {
    origin: "http://localhost:3000",
    staticRoot: "/nonexistent-distributor-test",
  });
  t.after(() => http.close());
  const headers = (actor: Actor) => {
    const email = f.app.identity
      .users(f.actor)
      .find((u) => u.id === actor.id)!.email;
    const login = f.app.identity.login(email, "long-test-only-password");
    return {
      cookie: `distributor_session=${login.token}`,
      origin: "http://localhost:3000",
      "x-csrf-token": login.csrf,
    };
  };
  const buyerHeaders = headers(buyer),
    strangerHeaders = headers(stranger),
    adminHeaders = headers(f.actor),
    path = `/api/effects/${f.effect.id}/checkout/history`;
  assert.equal((await http.inject({ url: path })).statusCode, 401);
  const response = await http.inject({ url: path, headers: buyerHeaders });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.deepEqual(response.json(), history(f));
  assert.doesNotMatch(
    response.body,
    /checkout\.stripe|private-provider|claim_token|actor_id|account_id/,
  );
  for (const query of [
    "?unknown=1",
    "?after=",
    "?after=%20",
    `?after=${"x".repeat(129)}`,
    "?after=not-a-cursor",
    "?after=a&after=b",
  ])
    assert.equal(
      (await http.inject({ url: path + query, headers: adminHeaders }))
        .statusCode,
      400,
      query,
    );
  for (const [id, expected] of [
    ["%20", 400],
    ["x".repeat(129), 414],
  ] as const)
    assert.equal(
      (
        await http.inject({
          url: `/api/effects/${id}/checkout/history`,
          headers: adminHeaders,
        })
      ).statusCode,
      expected,
    );
  assert.equal(
    (await http.inject({ method: "POST", url: path, headers: adminHeaders }))
      .statusCode,
    404,
  );
  const foreign = await http.inject({ url: path, headers: strangerHeaders });
  assert.equal(foreign.statusCode, 403);
  assert.doesNotMatch(foreign.body, /cs_test_history|private-provider/);
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET active=0 WHERE id=?", buyer.id);
  assert.equal(
    (await http.inject({ url: path, headers: buyerHeaders })).statusCode,
    401,
  );
});
