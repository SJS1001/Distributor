import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fixture } from "./fixtures.ts";
import { seedOrderQueue } from "./order-queue-fixture.ts";
import { seedInvoiceQueue } from "./invoice-queue-fixture.ts";
import { seedStockQueue } from "./stock-queue-fixture.ts";
import { countQueueFixture } from "./count-queue-fixture.ts";
import { Overview } from "../src/web/overview.tsx";
import type { Role } from "../src/server/core.ts";
function user(f: ReturnType<typeof fixture>, role: Role) {
  const row = f.app.identity.createUser(f.actor, `analytics-${role}`, {
    email: `analytics-${role}@example.test`,
    name: role,
    password: "long-test-only-password",
    role,
    accountId: role === "buyer" ? f.buyer : undefined,
    sites: role === "buyer" ? [] : [f.w1],
  });
  return f.app.identity.currentActor({ ...f.actor, id: row.id });
}
test("full dated order counts ignore pagination and enforce current buyer, warehouse and organization scope", (t) => {
  const f = fixture(t);
  seedOrderQueue(f, 45);
  seedOrderQueue(
    f,
    27,
    "other",
    f.app.identity.createCustomer(f.actor, "hidden-order-account", {
      name: "Other",
      tier: "standard",
      creditLimit: 1000000,
    }).id,
    f.w2,
  );
  const store = f.app.database.owned("orders");
  store.run(
    "UPDATE orders_orders SET created_at='2026-08-25T12:00:00.000Z' WHERE id LIKE 'other-%'",
  );
  store.run(
    "INSERT INTO orders_reservation_deadlines VALUES(?,?,?)",
    f.actor.orgId,
    "queue-001",
    1,
  );
  const buyer = user(f, "buyer"),
    warehouse = user(f, "warehouse");
  const report = f.app.orders.operationalAnalytics(
    f.actor,
    "2026-10-04T12:00:00.000Z",
  );
  assert.equal(
    report.states.reduce((n, r) => n + r.count, 0),
    72,
  );
  assert.equal(
    report.history.reduce((n, r) => n + r.count, 0),
    72,
  );
  assert.equal(
    report.history
      .filter((r) => r.date >= report.period.start)
      .reduce((n, r) => n + r.count, 0),
    45,
  );
  assert.equal(report.overdueReservations, 1);
  assert.deepEqual(
    f.app.orders
      .orderPage(buyer, undefined, "open", "overdue")
      .items.map((row) => row.id),
    ["queue-001"],
  );
  assert.equal(f.app.orders.orderPage(f.actor).items.length, 20);
  for (const actor of [buyer, warehouse])
    assert.equal(
      f.app.orders
        .operationalAnalytics(actor, report.period.asOf)
        .states.reduce((n, r) => n + r.count, 0),
      45,
    );
  store.run(
    "INSERT INTO orders_orders VALUES('foreign','other-org','foreign',?,'open',1,'CAD',100,'2026-09-30T00:00:00.000Z')",
    f.w1,
  );
  assert.equal(
    f.app.orders
      .operationalAnalytics(f.actor, report.period.asOf)
      .states.reduce((n, r) => n + r.count, 0),
    72,
  );
  assert.throws(
    () => f.app.orders.detail(buyer, "other-001"),
    /access|permitted/i,
  );
  assert.throws(
    () => f.app.orders.detail(warehouse, "other-001"),
    /access|permitted/i,
  );
  assert.equal(f.app.orders.detail(buyer, "queue-001").id, "queue-001");
});
test("invoice history is original invoiced amount, with full current balances, separate currencies and buyer authorization", (t) => {
  const f = fixture(t);
  seedInvoiceQueue(f, 45);
  seedInvoiceQueue(
    f,
    6,
    "hidden",
    f.app.identity.createCustomer(f.actor, "other-customer", {
      name: "Other",
      tier: "standard",
      creditLimit: 1000000,
    }).id,
  );
  const store = f.app.database.owned("billing");
  store.run(
    "UPDATE billing_invoices SET currency='USD' WHERE id LIKE 'hidden-%'",
  );
  store.run(
    "UPDATE billing_invoices SET created_at='2026-08-25T12:00:00.000Z' WHERE id LIKE 'hidden-%'",
  );
  const buyer = user(f, "buyer"),
    warehouse = user(f, "warehouse");
  const report = f.app.billing.operationalAnalytics(
    f.actor,
    "2026-10-04T12:00:00.000Z",
  );
  assert.equal(
    report.balances.find((r) => r.currency === "CAD")!.due,
    15 * 11300,
  );
  assert.equal(
    report.balances.find((r) => r.currency === "USD")!.due,
    2 * 11300,
  );
  assert.equal(
    report.aging
      .find((r) => r.currency === "USD")!
      .buckets.find((r) => r.bucket === "unknownDue")!.amount,
    2 * 11300,
  );
  assert.equal(
    report.history
      .find((r) => r.currency === "CAD")!
      .days.reduce((n, r) => n + r.amount, 0),
    45 * 11300,
  );
  assert.equal(
    report.history
      .find((r) => r.currency === "USD")!
      .days.reduce((n, r) => n + r.amount, 0),
    6 * 11300,
  );
  const scoped = f.app.billing.operationalAnalytics(buyer, report.period.asOf);
  assert.deepEqual(
    scoped.balances.map((r) => r.currency),
    ["CAD"],
  );
  assert.equal(
    scoped.aging[0]!.buckets.find((r) => r.bucket === "unknownDue")!.amount,
    15 * 11300,
  );
  assert.throws(
    () => f.app.billing.operationalAnalytics(warehouse),
    /permitted/i,
  );
  assert.throws(
    () => f.app.billing.operationalAnalytics({ ...warehouse, role: "admin" }),
    /permitted/i,
  );
});
test("stock exceptions and submitted count totals are complete and warehouse-scoped; inaccessible is null", (t) => {
  const f = fixture(t);
  seedStockQueue(f, 45);
  seedStockQueue(f, 30, f.w2, "remote");
  const warehouse = user(f, "warehouse"),
    buyer = user(f, "buyer");
  const report = f.app.inventory.operationalAnalytics(warehouse);
  assert.equal(
    report.reduce((n, r) => n + r.quantity, 0),
    30,
  );
  assert.ok(report.every((r) => r.warehouseId === f.w1));
  assert.equal(
    f.app.inventory
      .operationalAnalytics(f.actor)
      .reduce((n, r) => n + r.quantity, 0),
    50,
  );
  assert.throws(
    () => f.app.inventory.operationalAnalytics(buyer),
    /permitted/i,
  );
  const counts = countQueueFixture(f, 45, 30);
  const store = f.app.database.owned("inventory");
  store.run(
    "UPDATE inventory_counts SET state='submitted' WHERE org_id=?",
    f.actor.orgId,
  );
  assert.equal(f.app.inventory.countsAwaitingReview(counts.operator), 45);
  assert.equal(f.app.inventory.countsAwaitingReview(f.actor), 75);
  assert.equal(f.app.dashboard(buyer).analytics.stock, null);
  assert.equal(f.app.dashboard(buyer).analytics.countsAwaitingReview, null);
  assert.equal(f.app.dashboard(warehouse).analytics.invoices, null);
});
test("analytics renders dated numeric alternatives, currency-separated money, clear rules and drillthrough controls", (t) => {
  const f = fixture(t);
  seedOrderQueue(f, 45);
  seedInvoiceQueue(f, 45);
  seedStockQueue(f, 45);
  const data = f.app.dashboard(f.actor);
  const html = renderToStaticMarkup(
    React.createElement(Overview, {
      data,
      currency: "CAD",
      staff: true,
      canReadInvoices: true,
      canPrepare: true,
      busy: false,
      navigate: () => {},
      prepare: () => {},
      accountName: () => "Synthetic account",
    }),
  );
  assert.match(html, /Needs attention/);
  assert.match(html, /Counts submitted for review/);
  assert.match(html, /Daily values: current and comparison period/);
  assert.match(html, /not recognized revenue/);
  assert.match(html, /Due date unknown/);
  assert.match(html, /no low-stock threshold/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test("overdue drillthrough filters before paging and authenticated detail uses current record authority", async (t) => {
  const f = fixture(t);
  seedOrderQueue(f, 45);
  const store = f.app.database.owned("orders");
  for (let i = 0; i < 45; i++)
    store.run(
      "INSERT INTO orders_reservation_deadlines VALUES(?,?,?)",
      f.actor.orgId,
      `queue-${String(i).padStart(3, "0")}`,
      1,
    );
  const { createHttp } = await import("../src/server/http.ts");
  const http = await createHttp(f.app, { origin: "http://localhost" });
  t.after(() => http.close());
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin: "http://localhost" },
    payload: {
      email: "admin@example.test",
      password: "long-test-only-password",
    },
  });
  assert.equal(login.statusCode, 200);
  const cookie = login.cookies[0]!;
  const headers = { cookie: `${cookie.name}=${cookie.value}` };
  const first = await http.inject({
    url: "/api/orders/page?reservation=overdue",
    headers,
  });
  assert.equal(first.statusCode, 200);
  const page = first.json();
  assert.equal(page.items.length, 20);
  assert.ok(
    page.items.every(
      (r: { state: string; reservation: { overdue: boolean } }) =>
        r.state === "open" && r.reservation.overdue,
    ),
  );
  const second = await http.inject({
    url: `/api/orders/page?reservation=overdue&after=${page.next}`,
    headers,
  });
  assert.equal(second.json().items.length, 10);
  assert.equal(
    f.app.orders.operationalAnalytics(f.actor).overdueReservations,
    30,
  );
  assert.equal(
    (await http.inject({ url: "/api/orders/queue-001", headers })).statusCode,
    200,
  );
  assert.equal(
    (await http.inject({ url: "/api/orders/queue-001" })).statusCode,
    401,
  );
  assert.equal(
    (
      await http.inject({
        url: "/api/orders/page?reservation=invalid",
        headers,
      })
    ).statusCode,
    400,
  );
});
