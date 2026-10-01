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
  const payments = Array.from({ length: count }, (_, i) =>
    f.app.database.transaction(() =>
      f.app.billing.verifiedPayment(
        f.actor,
        invoiceId,
        1,
        "manual",
        `SYNTHETIC-PAGE-${i}`,
      ),
    ),
  );
  f.app.database
    .owned("billing")
    .run(
      "UPDATE billing_payments SET created_at='2026-10-01T00:00:00.000Z' WHERE org_id=?",
      f.actor.orgId,
    );
  return Object.assign(f, { invoiceId, payments });
}
function user(f: Fixture, role: Role) {
  const row = f.app.identity.createUser(f.actor, `payment-reader-${role}`, {
    name: role,
    email: `payment-reader-${role}@example.test`,
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
    payments: f.app.billing.refunds.payments(f.actor),
    stock: f.app.inventory.stock(f.actor),
    orders: f.app.orders.list(f.actor),
    accounts: f.app.identity.customers(f.actor),
  };
}
for (const region of ["CA", "US"] as const)
  test(`payment pages retain original invoice facts, money and tied ordering after restart (${region})`, (t) => {
    const f = setup(t, 43, region),
      sorted = f.payments
        .map((p) => p.id)
        .sort()
        .reverse(),
      first = f.app.billing.paymentHistory.page(f.actor);
    const invoice = f.app.billing.invoice(f.actor, f.invoiceId);
    assert.equal(first.items.length, 20);
    assert.equal(first.next, sorted[19]);
    assert.ok(
      first.items.every(
        (p) =>
          p.currency === (region === "CA" ? "CAD" : "USD") &&
          p.invoiceNumber === invoice.number &&
          p.amount === 1,
      ),
    );
    assert.deepEqual(
      Object.keys(first.items[0]!).sort(),
      [
        "id",
        "invoice_id",
        "invoiceNumber",
        "amount",
        "currency",
        "provider",
        "external_ref",
        "created_at",
      ].sort(),
    );
    const newer = f.app.database.transaction(() =>
      f.app.billing.verifiedPayment(
        f.actor,
        f.invoiceId,
        1,
        "manual",
        "SYNTHETIC-NEWER",
      ),
    );
    f.app.database
      .owned("billing")
      .run(
        "UPDATE billing_payments SET created_at='2099-01-01T00:00:00.000Z' WHERE id=?",
        newer.id,
      );
    const before = native(f);
    f.app.close();
    f.app = new Application(f.path, region);
    const second = f.app.billing.paymentHistory.page(f.actor, first.next!),
      third = f.app.billing.paymentHistory.page(f.actor, second.next!);
    assert.equal(second.items.length, 20);
    assert.equal(third.items.length, 3);
    assert.equal(third.next, null);
    assert.deepEqual(
      [...first.items, ...second.items, ...third.items].map((p) => p.id),
      sorted,
    );
    assert.equal(
      f.app.billing.paymentHistory.page(f.actor).items[0]!.id,
      newer.id,
    );
    assert.deepEqual(native(f), before);
  });
for (const count of [0, 20, 40])
  test(`payment page continuation ends at the exact ${count}-row boundary`, (t) => {
    const f = setup(t, count);
    let next: string | undefined,
      seen: string[] = [];
    do {
      const page = f.app.billing.paymentHistory.page(f.actor, next);
      seen.push(...page.items.map((p) => p.id));
      next = page.next ?? undefined;
    } while (next);
    assert.equal(seen.length, count);
    assert.equal(new Set(seen).size, count);
  });
test("payment cursors reject missing, foreign and orphaned records without disclosing their scope", (t) => {
  const f = setup(t, 3),
    store = f.app.database.owned("billing");
  store.run(
    "UPDATE billing_payments SET org_id='foreign' WHERE id=?",
    f.payments[0]!.id,
  );
  store.run(
    "UPDATE billing_payments SET invoice_id='missing-invoice' WHERE id=?",
    f.payments[1]!.id,
  );
  for (const after of ["missing", f.payments[0]!.id, f.payments[1]!.id])
    assert.throws(() => f.app.billing.paymentHistory.page(f.actor, after), {
      code: "CURSOR",
      message: "Payment cursor is unavailable in your current scope.",
    });
  for (const after of ["", "x".repeat(129)])
    assert.throws(() => f.app.billing.paymentHistory.page(f.actor, after), {
      code: "VALIDATION",
    });
  assert.deepEqual(
    f.app.billing.paymentHistory.page(f.actor).items.map((p) => p.id),
    [f.payments[2]!.id],
  );
  assert.deepEqual(
    f.app.billing.refunds.payments(f.actor).map((p) => p.id),
    [f.payments[2]!.id],
  );
});
test("paged and compatibility payments recheck current grants and password restrictions before querying money", (t) => {
  const f = setup(t),
    finance = user(f, "finance"),
    support = user(f, "support"),
    buyer = user(f, "buyer"),
    page = f.app.billing.paymentHistory.page(finance);
  assert.deepEqual(f.app.billing.paymentHistory.page(support), page);
  const reads = (actor: Actor) => [
    () => f.app.billing.paymentHistory.page(actor, page.next!),
    () => f.app.billing.refunds.payments(actor),
    () => f.app.billing.paymentHistory.page(actor, page.next!, f.invoiceId),
  ];
  const original = Store.prototype.all;
  Store.prototype.all = function (sql, ...params) {
    assert.ok(!sql.includes("billing_payments"), "Unauthorized money query");
    return original.call(this, sql, ...params) as any;
  };
  try {
    for (const read of reads({ ...buyer, role: "admin", accountId: null }))
      assert.throws(read, { code: "FORBIDDEN" });
    for (const read of reads({ ...finance, orgId: "foreign" }))
      assert.throws(read, { code: "FORBIDDEN" });
    const iam = f.app.database.owned("iam");
    iam.run(
      "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
      finance.id,
    );
    for (const read of reads(finance))
      assert.throws(read, { code: "PASSWORD_CHANGE_REQUIRED" });
    iam.run(
      "UPDATE iam_user_security SET password_change_required=0 WHERE user_id=?",
      finance.id,
    );
    iam.run("UPDATE iam_users SET role='warehouse' WHERE id=?", finance.id);
    for (const read of reads({ ...finance, role: "admin" }))
      assert.throws(read, { code: "FORBIDDEN" });
    iam.run("UPDATE iam_users SET active=0 WHERE id=?", support.id);
    for (const read of reads(support))
      assert.throws(read, { code: "FORBIDDEN" });
  } finally {
    Store.prototype.all = original;
  }
});
test("payment page reads materialize at most 21 rows without eager compatibility or document reads", (t) => {
  const f = setup(t, 103),
    original = Store.prototype.all,
    counts: number[] = [];
  Store.prototype.all = function (sql, ...params) {
    const rows = original.call(this, sql, ...params);
    assert.ok(
      !sql.includes("SELECT p.*") &&
        !sql.includes("billing_lines") &&
        !sql.includes("billing_refunds"),
    );
    if (sql.includes("FROM billing_payments")) counts.push(rows.length);
    return rows as any;
  };
  try {
    let after: string | undefined,
      seen = 0;
    do {
      const page = f.app.billing.paymentHistory.page(f.actor, after);
      seen += page.items.length;
      after = page.next ?? undefined;
    } while (after);
    assert.equal(seen, 103);
    assert.deepEqual(counts, [21, 21, 21, 21, 21, 3]);
  } finally {
    Store.prototype.all = original;
  }
});
test("HTTP payment pages authenticate, forbid unexpected queries, return no-store and reject revoked authority", async (t) => {
  const f = setup(t, 23),
    finance = user(f, "finance"),
    origin = "http://127.0.0.1:3000",
    http = await createHttp(f.app, {
      origin,
      staticRoot: "/nonexistent-distributor-test",
    });
  await http.ready();
  t.after(() => http.close());
  const endpoints = [
    "/api/billing/payments/page",
    `/api/billing/invoices/${f.invoiceId}/payments/page`,
  ];
  for (const endpoint of endpoints)
    assert.equal((await http.inject({ url: endpoint })).statusCode, 401);
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: {
      email: "payment-reader-finance@example.test",
      password: "long-page-test-password",
    },
  });
  assert.equal(login.statusCode, 200);
  const c = login.cookies[0]!,
    headers = { cookie: `${c.name}=${c.value}`, origin };
  for (const endpoint of endpoints) {
    const first = await http.inject({ url: endpoint, headers });
    assert.equal(first.statusCode, 200);
    assert.equal(first.headers["cache-control"], "no-store");
    assert.equal(first.json().items.length, 20);
    const second = await http.inject({
      url: `${endpoint}?after=${first.json().next}`,
      headers,
    });
    assert.equal(second.statusCode, 200);
    assert.equal(second.json().items.length, 3);
    assert.equal(second.json().next, null);
    for (const query of [
      "?after=",
      "?after=missing",
      `?after=${"x".repeat(129)}`,
      "?after=a&after=b",
      "?limit=100",
      "?accountId=other",
    ])
      assert.equal(
        (await http.inject({ url: endpoint + query, headers })).statusCode,
        400,
        query,
      );
  }
  assert.equal(
    (
      await http.inject({
        url: "/api/billing/invoices/missing/payments/page",
        headers,
      })
    ).statusCode,
    404,
  );
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
      finance.id,
    );
  for (const endpoint of endpoints)
    assert.equal(
      (await http.inject({ url: endpoint, headers })).statusCode,
      403,
    );
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_user_security SET password_change_required=0 WHERE user_id=?",
      finance.id,
    );
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='warehouse' WHERE id=?", finance.id);
  for (const url of [...endpoints, "/api/billing/payments"])
    assert.equal((await http.inject({ url, headers })).statusCode, 403);
});

test("invoice payment pages isolate invoices and cursor identities across restart", (t) => {
  const f = setup(t, 43),
    secondInvoice = ship(f, accept(f, 1, "second-order").id).invoiceId;
  const second = f.app.database.transaction(() =>
    f.app.billing.verifiedPayment(
      f.actor,
      secondInvoice,
      1,
      "manual",
      "SYNTHETIC-OTHER-INVOICE",
    ),
  );
  const first = f.app.billing.paymentHistory.page(
    f.actor,
    undefined,
    f.invoiceId,
  );
  assert.equal(first.items.length, 20);
  assert.ok(first.items.every((p) => p.invoice_id === f.invoiceId));
  assert.throws(
    () => f.app.billing.paymentHistory.page(f.actor, second.id, f.invoiceId),
    { code: "CURSOR" },
  );
  assert.throws(
    () =>
      f.app.billing.paymentHistory.page(f.actor, first.next!, secondInvoice),
    { code: "CURSOR" },
  );
  assert.throws(
    () => f.app.billing.paymentHistory.page(f.actor, undefined, "missing"),
    { code: "NOT_FOUND" },
  );
  f.app.close();
  f.app = new Application(f.path, "CA");
  const middle = f.app.billing.paymentHistory.page(
      f.actor,
      first.next!,
      f.invoiceId,
    ),
    last = f.app.billing.paymentHistory.page(
      f.actor,
      middle.next!,
      f.invoiceId,
    );
  assert.equal(middle.items.length, 20);
  assert.equal(last.items.length, 3);
  assert.equal(last.next, null);
  assert.equal(
    new Set([...first.items, ...middle.items, ...last.items].map((p) => p.id))
      .size,
    43,
  );
  assert.deepEqual(
    f.app.billing.paymentHistory
      .page(f.actor, undefined, secondInvoice)
      .items.map((p) => p.id),
    [second.id],
  );
  f.app.database
    .owned("billing")
    .run(
      "UPDATE billing_invoices SET org_id='foreign' WHERE id=?",
      secondInvoice,
    );
  assert.throws(
    () => f.app.billing.paymentHistory.page(f.actor, undefined, secondInvoice),
    { code: "NOT_FOUND" },
  );
});
