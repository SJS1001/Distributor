import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, accept, ship } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { Store } from "../src/server/database.ts";
import { createHttp } from "../src/server/http.ts";
import type { Actor, Role } from "../src/server/core.ts";

type Fixture = ReturnType<typeof fixture>;
function setup(
  t: Parameters<typeof fixture>[0],
  count = 43,
  region: "CA" | "US" = "CA",
) {
  const f = fixture(t, {}, region),
    invoiceId = ship(f, accept(f).id).invoiceId;
  const payment = f.app.database.transaction(() =>
    f.app.billing.verifiedPayment(
      f.actor,
      invoiceId,
      11300,
      "stripe",
      "pi_history_synthetic",
    ),
  );
  f.app.billing.issueCredit(f.actor, "history-credit", {
    invoiceId,
    reference: "HISTORY-CREDIT",
    reason: "Synthetic history fixture",
    lines: [
      {
        lineId: String(f.app.billing.lines(f.actor, invoiceId)[0]!.id),
        quantity: 1,
      },
    ],
  });
  const refunds = Array.from({ length: count }, (_, index) =>
    f.app.billing.refundRequest(f.actor, `history-refund-${index}`, {
      invoiceId,
      paymentId: payment.id,
      amount: 1,
      reference: `HISTORY-${index}`,
      reason: "Synthetic history fixture",
    }),
  );
  // Force tied timestamps in this synthetic fixture, independent of wall-clock speed.
  f.app.database
    .owned("billing")
    .run(
      "UPDATE billing_refunds SET created_at='2026-10-01T00:00:00.000Z' WHERE org_id=?",
      f.actor.orgId,
    );
  return Object.assign(f, { invoiceId, paymentId: payment.id, refunds });
}
function observe(f: ReturnType<typeof setup>, refundId: string, count: number) {
  const intent = f.app.billing.refunds.intent(f.actor, refundId);
  for (let i = 0; i < count; i++)
    f.app.database.transaction(() =>
      f.app.billing.refunds.observe(
        f.actor,
        intent,
        `re_history_${refundId.replaceAll("-", "_")}`,
        { ...intent, status: i === 0 ? "succeeded" : "pending" },
      ),
    );
}
function user(f: Fixture, role: Role) {
  const row = f.app.identity.createUser(f.actor, `history-${role}`, {
    name: role,
    email: `history-${role}@example.test`,
    password: "long-page-test-password",
    role,
    sites: [],
    accountId: role === "buyer" ? f.buyer : undefined,
  });
  return f.app.identity.currentActor({ ...f.actor, id: row.id });
}
function native(f: Fixture) {
  return {
    invoices: f.app.billing.invoices(f.actor),
    credits: f.app.billing.credits(f.actor),
    stock: f.app.inventory.stock(f.actor),
    orders: f.app.orders.list(f.actor),
    accounts: f.app.identity.customers(f.actor),
    payments: f.app.billing.refunds.payments(f.actor),
  };
}
for (const region of ["CA", "US"] as const)
  test(`refund pages traverse tied timestamps once after restart, preserve money and exclude newer arrivals (${region})`, (t) => {
    const f = setup(t, 43, region),
      sorted = f.refunds
        .map((r) => r.id)
        .sort()
        .reverse();
    const first = f.app.billing.refunds.history.page(f.actor);
    assert.equal(first.items.length, 20);
    assert.equal(first.next, sorted[19]);
    assert.ok(
      first.items.every(
        (r) => r.currency === (region === "CA" ? "CAD" : "USD"),
      ),
    );
    const newer = f.app.billing.refundRequest(f.actor, "history-newer", {
      invoiceId: f.invoiceId,
      paymentId: f.paymentId,
      amount: 1,
      reference: "NEWER",
      reason: "Synthetic newer request",
    });
    f.app.database
      .owned("billing")
      .run(
        "UPDATE billing_refunds SET created_at='2099-01-01T00:00:00.000Z' WHERE id=?",
        newer.id,
      );
    const before = native(f);
    f.app.close();
    f.app = new Application(f.path, region);
    const second = f.app.billing.refunds.history.page(f.actor, first.next!);
    const third = f.app.billing.refunds.history.page(f.actor, second.next!);
    assert.equal(second.items.length, 20);
    assert.equal(third.items.length, 3);
    assert.equal(third.next, null);
    assert.deepEqual(
      [...first.items, ...second.items, ...third.items].map((r) => r.id),
      sorted,
    );
    assert.equal(
      f.app.billing.refunds.history.page(f.actor).items[0]!.id,
      newer.id,
    );
    assert.deepEqual(native(f), before);
  });
test("refund observation pages retain applied and unapplied outcomes with newest-first continuation after restart", (t) => {
  const f = setup(t, 2),
    refundId = f.refunds[0]!.id;
  observe(f, refundId, 43);
  const before = native(f),
    first = f.app.billing.refunds.history.observations(f.actor, refundId);
  assert.equal(first.items.length, 20);
  assert.ok(
    first.items.every((r) => r.applied === false && r.status === "pending"),
  );
  const old = f.app.billing.refunds
    .list(f.actor)
    .find((r) => r.id === refundId)!;
  assert.equal(old.state, "completed");
  assert.equal(old.provider_status, "succeeded");
  assert.ok(
    !("observations" in f.app.billing.refunds.history.page(f.actor).items[0]!),
  );
  f.app.close();
  f.app = new Application(f.path);
  observe(f, refundId, 1);
  const second = f.app.billing.refunds.history.observations(
    f.actor,
    refundId,
    first.next!,
  );
  const third = f.app.billing.refunds.history.observations(
    f.actor,
    refundId,
    second.next!,
  );
  const rows = [...first.items, ...second.items, ...third.items];
  assert.equal(rows.length, 43);
  assert.equal(new Set(rows.map((r) => r.id)).size, 43);
  assert.ok(rows.slice(0, -1).every((r) => !r.applied));
  assert.equal(rows.at(-1)!.status, "succeeded");
  assert.equal(rows.at(-1)!.applied, true);
  assert.equal(third.next, null);
  assert.equal(
    f.app.billing.refunds.history.observations(f.actor, refundId).items[0]!.id,
    rows[0]!.id + 1,
  );
  assert.deepEqual(native(f), before);
  assert.deepEqual(
    f.app.billing.refunds.history.observations(f.actor, f.refunds[1]!.id),
    { items: [], next: null },
  );
});
test("refund cursors cannot cross organization, refund, absent or invalid identities", (t) => {
  const f = setup(t, 2),
    [one, two] = f.refunds;
  observe(f, one!.id, 1);
  observe(f, two!.id, 1);
  const foreignCursor = f.app.billing.refunds.history.observations(
    f.actor,
    two!.id,
  ).items[0]!.id;
  assert.throws(
    () =>
      f.app.billing.refunds.history.observations(
        f.actor,
        one!.id,
        foreignCursor,
      ),
    { code: "CURSOR" },
  );
  for (const invalid of [
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ])
    assert.throws(
      () =>
        f.app.billing.refunds.history.observations(f.actor, one!.id, invalid),
      { code: "VALIDATION" },
    );
  assert.throws(
    () => f.app.billing.refunds.history.observations(f.actor, "absent"),
    { code: "NOT_FOUND" },
  );
  assert.throws(
    () => f.app.billing.refunds.history.observations(f.actor, one!.id, 999999),
    { code: "CURSOR" },
  );
  f.app.database
    .owned("billing")
    .run("UPDATE billing_refunds SET org_id='foreign' WHERE id=?", two!.id);
  for (const id of [two!.id, "absent"])
    assert.throws(() => f.app.billing.refunds.history.page(f.actor, id), {
      code: "CURSOR",
    });
  assert.throws(
    () => f.app.billing.refunds.history.observations(f.actor, two!.id),
    { code: "NOT_FOUND" },
  );
  for (const id of ["", "x".repeat(129)])
    assert.throws(() => f.app.billing.refunds.history.page(f.actor, id), {
      code: "VALIDATION",
    });
});
test("refund reads recheck actual role, active principal and password gate, including compatibility history", (t) => {
  const f = setup(t, 23),
    finance = user(f, "finance"),
    support = user(f, "support"),
    buyer = user(f, "buyer"),
    id = f.refunds[0]!.id;
  const first = f.app.billing.refunds.history.page(finance);
  for (const actor of [finance, support]) {
    assert.deepEqual(f.app.billing.refunds.history.page(actor), first);
    assert.deepEqual(f.app.billing.refunds.history.observations(actor, id), {
      items: [],
      next: null,
    });
  }
  const reads = (actor: Actor) => [
    () => f.app.billing.refunds.history.page(actor, first.next!),
    () => f.app.billing.refunds.history.observations(actor, id),
    () => f.app.billing.refunds.list(actor),
  ];
  for (const read of reads({ ...buyer, role: "admin", accountId: null }))
    assert.throws(read, { code: "FORBIDDEN" });
  const store = f.app.database.owned("iam");
  store.run(
    "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
    finance.id,
  );
  for (const read of reads(finance))
    assert.throws(read, { code: "PASSWORD_CHANGE_REQUIRED" });
  store.run(
    "UPDATE iam_user_security SET password_change_required=0 WHERE user_id=?",
    finance.id,
  );
  store.run("UPDATE iam_users SET role='warehouse' WHERE id=?", finance.id);
  for (const read of reads({ ...finance, role: "admin" }))
    assert.throws(read, { code: "FORBIDDEN" });
  store.run("UPDATE iam_users SET active=0 WHERE id=?", support.id);
  for (const read of reads(support)) assert.throws(read, { code: "FORBIDDEN" });
});
test("refund summary and observation reads materialize only 21 rows, without eager observation queries", (t) => {
  const f = setup(t, 103);
  observe(f, f.refunds[0]!.id, 43);
  const original = Store.prototype.all,
    counts: number[] = [],
    obsCounts: number[] = [];
  let summaries = true;
  Store.prototype.all = function (query, ...params) {
    if (summaries)
      assert.ok(!query.includes("FROM billing_refund_observations"));
    const rows = original.call(this, query, ...params);
    if (query.includes("FROM billing_refunds")) counts.push(rows.length);
    if (query.includes("FROM billing_refund_observations"))
      obsCounts.push(rows.length);
    return rows as any;
  };
  try {
    let after: string | undefined;
    let seen = 0;
    do {
      const page = f.app.billing.refunds.history.page(f.actor, after);
      seen += page.items.length;
      after = page.next ?? undefined;
    } while (after);
    assert.equal(seen, 103);
    assert.deepEqual(counts, [21, 21, 21, 21, 21, 3]);
    summaries = false;
    let cursor: number | undefined;
    let observed = 0;
    do {
      const page = f.app.billing.refunds.history.observations(
        f.actor,
        f.refunds[0]!.id,
        cursor,
      );
      observed += page.items.length;
      cursor = page.next ?? undefined;
    } while (cursor);
    assert.equal(observed, 43);
    assert.deepEqual(obsCounts, [21, 21, 3]);
  } finally {
    Store.prototype.all = original;
  }
});
test("HTTP refund pages require sign-in and reject malformed, repeated or unknown cursor fields", async (t) => {
  const f = setup(t, 23),
    refundId = f.refunds[0]!.id;
  observe(f, refundId, 23);
  const origin = "http://127.0.0.1:3000",
    http = await createHttp(f.app, {
      origin,
      staticRoot: "/nonexistent-distributor-test",
    });
  await http.ready();
  t.after(() => http.close());
  for (const url of [
    "/api/billing/refunds/page",
    `/api/billing/refunds/${refundId}/observations`,
  ])
    assert.equal((await http.inject({ url })).statusCode, 401);
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: {
      email: "admin@example.test",
      password: "long-test-only-password",
    },
  });
  const c = login.cookies[0]!,
    headers = { cookie: `${c.name}=${c.value}`, origin };
  const page = await http.inject({ url: "/api/billing/refunds/page", headers });
  assert.equal(page.statusCode, 200);
  assert.equal(page.json().items.length, 20);
  assert.equal(
    (
      await http.inject({
        url: `/api/billing/refunds/page?after=${page.json().next}`,
        headers,
      })
    ).json().items.length,
    3,
  );
  const obs = `/api/billing/refunds/${refundId}/observations`,
    first = await http.inject({ url: obs, headers });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().items.length, 20);
  assert.equal(
    (
      await http.inject({ url: `${obs}?after=${first.json().next}`, headers })
    ).json().items.length,
    3,
  );
  for (const q of [
    "?after=",
    "?after=0",
    "?after=01",
    "?after=-1",
    "?after=1.5",
    "?after=9007199254740992",
    "?after=1&after=2",
    "?limit=100",
    "?accountId=other",
  ])
    assert.equal(
      (await http.inject({ url: obs + q, headers })).statusCode,
      400,
      q,
    );
  for (const q of [
    "?after=",
    "?after=unknown",
    `?after=${"x".repeat(129)}`,
    "?after=a&after=b",
    "?limit=100",
  ])
    assert.equal(
      (await http.inject({ url: "/api/billing/refunds/page" + q, headers }))
        .statusCode,
      400,
      q,
    );
});
