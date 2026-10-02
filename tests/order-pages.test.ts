import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, accept } from "./fixtures.ts";
import { seedOrderQueue } from "./order-queue-fixture.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import { Store } from "../src/server/database.ts";
import type { Actor, Role } from "../src/server/core.ts";
import {
  orderQueueStates,
  type OrderQueueState,
} from "../src/shared/order-queue.ts";
function user(
  f: ReturnType<typeof fixture>,
  role: Role,
  sites = [f.w1],
  accountId = f.buyer,
) {
  const row = f.app.identity.createUser(f.actor, `page-${role}`, {
    name: role,
    email: `page-${role}@example.test`,
    password: "long-page-test-password",
    role,
    sites: role === "buyer" ? [] : sites,
    accountId,
  });
  return f.app.identity.currentActor({ ...f.actor, id: row.id });
}
function update(
  f: ReturnType<typeof fixture>,
  actor: Actor,
  changes: Record<string, unknown>,
) {
  const row = f.app.identity.users(f.actor).find((u) => u.id === actor.id)!;
  f.app.identity.updateUser(f.actor, `change-${actor.id}-${row.revision}`, {
    userId: actor.id,
    revision: Number(row.revision),
    name: actor.name,
    email: String(row.email),
    role: actor.role,
    accountId: actor.accountId ?? undefined,
    sites: actor.sites,
    active: true,
    currentPassword: "long-test-only-password",
    reason: "Synthetic grants change",
    ...changes,
  });
}
test("order queue filters before row limits with tied-time stable boundaries, live cursor state changes and SQLite restart", (t) => {
  const f = fixture(t);
  seedOrderQueue(f, 63, "matching");
  seedOrderQueue(f, 80, "zz-unrelated", f.buyer, f.w2);
  const warehouse = user(f, "warehouse"),
    store = f.app.database.owned("orders");
  const first = f.app.orders.orderPage(warehouse, undefined, "open");
  assert.equal(first.items.length, 20);
  assert.ok(
    first.items.every(
      (o) => o.state === "open" && o.id.startsWith("matching-"),
    ),
  );
  store.run("UPDATE orders_orders SET state='closed' WHERE id=?", first.next!);
  f.app.close();
  f.app = new Application(f.path);
  const second = f.app.orders.orderPage(warehouse, first.next!, "open"),
    third = f.app.orders.orderPage(warehouse, second.next!, "open");
  assert.equal(second.items.length, 20);
  assert.equal(third.items.length, 2);
  assert.equal(third.next, null);
  const ids = [...first.items, ...second.items, ...third.items].map(
    (o) => o.id,
  );
  assert.equal(new Set(ids).size, 42);
  assert.deepEqual(
    ids,
    Array.from({ length: 63 }, (_, i) => 62 - i)
      .filter((i) => i % 3 !== 0)
      .map((i) => `matching-${String(i).padStart(3, "0")}`),
  );
  assert.deepEqual(f.app.orders.orderCounts(warehouse), {
    total: 63,
    open: 41,
  });
  assert.ok(
    f.app.orders
      .orderPage(warehouse, undefined, "closed")
      .items.every((o) => o.state === "closed"),
  );
});
test("order pages isolate buyers, warehouse grants and organizations before cursors/counts, ignoring forged actor fields", (t) => {
  const f = fixture(t);
  seedOrderQueue(f, 23, "owned");
  const other = f.app.identity.createCustomer(f.actor, "other", {
    name: "Other",
    tier: "standard",
    creditLimit: 0,
  }).id;
  seedOrderQueue(f, 80, "zz-other", other, f.w2);
  const buyer = user(f, "buyer"),
    warehouse = user(f, "warehouse");
  for (const actor of [buyer, warehouse]) {
    const page = f.app.orders.orderPage(actor);
    assert.equal(page.items.length, 20);
    assert.equal(f.app.orders.orderPage(actor, page.next!).items.length, 3);
    assert.deepEqual(f.app.orders.orderCounts(actor), { total: 23, open: 15 });
    assert.throws(() => f.app.orders.orderPage(actor, "zz-other-000"), {
      code: "CURSOR",
    });
  }
  assert.deepEqual(
    f.app.orders.orderPage({
      ...buyer,
      role: "admin",
      accountId: other,
      sites: [f.w2],
    }),
    f.app.orders.orderPage(buyer),
  );
  const cursor = f.app.orders.orderPage(warehouse).next!;
  update(f, warehouse, { sites: [f.w2] });
  assert.throws(() => f.app.orders.orderPage(warehouse, cursor), {
    code: "CURSOR",
  });
  assert.equal(f.app.orders.orderCounts(warehouse).total, 80);
  update(f, warehouse, { sites: [] });
  assert.deepEqual(f.app.orders.orderPage(warehouse), {
    items: [],
    next: null,
  });
  assert.deepEqual(f.app.orders.orderCounts(warehouse), { total: 0, open: 0 });
  assert.deepEqual(f.app.orders.list(warehouse), []);
  update(f, buyer, { accountId: other });
  assert.equal(f.app.orders.orderCounts(buyer).total, 80);
  assert.throws(() => f.app.orders.orderPage(buyer, "owned-000"), {
    code: "CURSOR",
  });
  f.app.database
    .owned("orders")
    .run(
      "UPDATE orders_orders SET org_id='another-org' WHERE id='zz-other-000'",
    );
  assert.throws(() => f.app.orders.orderPage(f.actor, "zz-other-000"), {
    code: "CURSOR",
  });
});
test("order queue, counts and compatibility list reread password and disabled-user authority", (t) => {
  const f = fixture(t);
  seedOrderQueue(f, 23);
  const warehouse = user(f, "warehouse");
  const cursor = f.app.orders.orderPage(warehouse).next!;
  const iam = f.app.database.owned("iam");
  iam.run(
    "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
    warehouse.id,
  );
  for (const read of [
    () => f.app.orders.orderPage(warehouse, cursor),
    () => f.app.orders.orderCounts(warehouse),
    () => f.app.orders.list(warehouse),
  ])
    assert.throws(read, { code: "PASSWORD_CHANGE_REQUIRED" });
  iam.run(
    "UPDATE iam_user_security SET password_change_required=0 WHERE user_id=?",
    warehouse.id,
  );
  update(f, warehouse, { active: false });
  for (const read of [
    () => f.app.orders.orderPage({ ...warehouse, role: "admin" }, cursor),
    () => f.app.orders.orderCounts(warehouse),
    () => f.app.orders.list(warehouse),
  ])
    assert.throws(read, { code: "FORBIDDEN" });
});
test("order queue validates supported filters and scoped cursors without writes", (t) => {
  const f = fixture(t);
  seedOrderQueue(f);
  const store = f.app.database.owned("orders");
  const snapshot = () => [
    store.all("SELECT * FROM orders_orders ORDER BY id"),
    store.all("SELECT * FROM orders_lines ORDER BY id"),
    store.all("SELECT * FROM orders_reservation_deadlines"),
    store.all("SELECT * FROM orders_reservation_history"),
  ];
  const before = snapshot();
  for (const state of orderQueueStates)
    assert.ok(
      f.app.orders
        .orderPage(f.actor, undefined, state)
        .items.every((o) => o.state === state),
    );
  for (const state of ["", null, 1, {}, "unknown", "open' OR 1=1 --"])
    assert.throws(
      () =>
        f.app.orders.orderPage(f.actor, undefined, state as OrderQueueState),
      { code: "VALIDATION" },
    );
  for (const cursor of ["", " ", "x".repeat(129)])
    assert.throws(() => f.app.orders.orderPage(f.actor, cursor), {
      code: "VALIDATION",
    });
  assert.throws(() => f.app.orders.orderPage(f.actor, "absent"), {
    code: "CURSOR",
  });
  assert.deepEqual(snapshot(), before);
});
test("order pages return at most 21 owning rows and enrich only 20 visible orders", (t) => {
  const f = fixture(t);
  seedOrderQueue(f, 103);
  const original = Store.prototype.all;
  const orderRows: number[] = [],
    lineIds: string[] = [];
  t.mock.method(
    Store.prototype,
    "all",
    function (this: Store, query: string, ...params: any[]) {
      const rows = original.call(this, query, ...params);
      if (query.includes("FROM orders_orders")) orderRows.push(rows.length);
      if (query.includes("FROM orders_lines"))
        lineIds.push(String(params.at(-1)));
      return rows;
    },
  );
  let next: string | undefined;
  let seen = 0;
  do {
    const page = f.app.orders.orderPage(f.actor, next);
    seen += page.items.length;
    next = page.next ?? undefined;
  } while (next);
  assert.equal(seen, 103);
  assert.deepEqual(orderRows, [21, 21, 21, 21, 21, 3]);
  assert.equal(lineIds.length, 103);
  assert.equal(new Set(lineIds).size, 103);
});
test("native accepted order remains open through partial fulfillment and closes after all quantities ship with exact page projection", (t) => {
  const f = fixture(t);
  const order = accept(f, 2);
  let delivery = 0;
  const partial = () => {
    const picks = f.app.fulfillment.picks(f.actor, order.id);
    const a = picks.find((a) => a.packable > 0 || a.stage === "reserved")!;
    if (a.stage !== "picked")
      f.app.fulfillment.pick(f.actor, `pick-${a.id}`, {
        orderId: order.id,
        allocationId: a.id,
        serial: a.serial,
      });
    const packed = f.app.fulfillment.pack(f.actor, `pack-${delivery}`, {
      orderId: order.id,
      revision: f.app.orders.order(f.actor, order.id).revision,
      mode: "collection",
      address: "Synthetic counter",
      lines: [{ allocationId: a.id, quantity: 1 }],
    });
    f.app.fulfillment.commit(f.actor, `ship-${delivery++}`, {
      shipmentId: packed.id,
      handoverEvidence: "Synthetic test handover",
    });
  };

  assert.deepEqual(f.app.orders.orderCounts(f.actor), { total: 1, open: 1 });
  const before = f.app.orders.list(f.actor);
  assert.deepEqual(f.app.orders.orderPage(f.actor).items, before);
  partial();
  assert.equal(
    f.app.orders.orderPage(f.actor, undefined, "open").items[0]!.lines[0]!
      .shipped,
    1,
  );
  assert.equal(f.app.orders.orderCounts(f.actor).open, 1);
  partial();
  assert.deepEqual(f.app.orders.orderPage(f.actor, undefined, "open"), {
    items: [],
    next: null,
  });
  assert.equal(f.app.orders.orderCounts(f.actor).open, 0);
  assert.deepEqual(
    f.app.orders.orderPage(f.actor, undefined, "closed").items,
    f.app.orders.list(f.actor),
  );
});
test("HTTP order pages bound the dashboard and preserve full scoped counts, refusing malformed queries and unauthenticated access", async (t) => {
  const f = fixture(t);
  seedOrderQueue(f, 43);
  const origin = "http://127.0.0.1:3000",
    http = await createHttp(f.app, {
      origin,
      staticRoot: "/nonexistent-distributor-test",
    });
  await http.ready();
  t.after(() => http.close());
  assert.equal(
    (await http.inject({ url: "/api/orders/page" })).statusCode,
    401,
  );
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
    headers = { origin, cookie: `${cookie.name}=${cookie.value}` };
  const first = await http.inject({ url: "/api/orders/page", headers });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().items.length, 20);
  const dashboard = (
    await http.inject({ url: "/api/dashboard", headers })
  ).json();
  assert.deepEqual(dashboard.orders, first.json().items);
  assert.equal(dashboard.orderNext, first.json().next);
  assert.deepEqual(dashboard.orderCounts, { total: 43, open: 28 });
  const second = await http.inject({
    url: `/api/orders/page?after=${first.json().next}`,
    headers,
  });
  assert.equal(second.json().items.length, 20);
  for (const query of [
    "state=",
    "state=bad",
    "state=open&state=closed",
    "after=",
    "after=x&after=y",
    "limit=500",
    "state=open&extra=bad",
    "after=" + "x".repeat(129),
  ])
    assert.equal(
      (await http.inject({ url: `/api/orders/page?${query}`, headers }))
        .statusCode,
      400,
      query,
    );
  for (const state of orderQueueStates) {
    const page = await http.inject({
      url: `/api/orders/page?state=${state}`,
      headers,
    });
    assert.equal(page.statusCode, 200);
    assert.ok(page.json().items.every((o: any) => o.state === state));
  }
});
test("order page holds one current-authority snapshot while lines are read, refusing an independent concurrent writer", (t) => {
  const f = fixture(t);
  seedOrderQueue(f);
  const other = new Application(f.path);
  t.after(() => other.close());
  const original = Store.prototype.all;
  let tested = false;
  t.mock.method(
    Store.prototype,
    "all",
    function (this: Store, query: string, ...params: any[]) {
      const rows = original.call(this, query, ...params);
      if (query.includes("FROM orders_orders") && !tested) {
        tested = true;
        assert.throws(
          () =>
            other.database
              .owned("orders")
              .run(
                "UPDATE orders_orders SET state='closed' WHERE id='queue-044'",
              ),
          /locked|busy/i,
        );
      }
      return rows;
    },
  );
  const page = f.app.orders.orderPage(f.actor, undefined, "open");
  assert.ok(tested);
  assert.ok(page.items.every((o) => o.state === "open"));
  other.database
    .owned("orders")
    .run("UPDATE orders_orders SET state='closed' WHERE id='queue-044'");
  assert.equal(f.app.orders.orderCounts(f.actor).open, 29);
});
test("fresh queue refresh exposes newer creations without duplicating earlier continuations and retains public reservation summaries", (t) => {
  const f = fixture(t);
  seedOrderQueue(f, 43);
  const first = f.app.orders.orderPage(f.actor);
  const store = f.app.database.owned("orders");
  store.run(
    "INSERT INTO orders_reservation_deadlines(org_id,order_id,expires_at) VALUES(?,?,1)",
    f.actor.orgId,
    first.items[0]!.id,
  );
  seedOrderQueue(f, 1, "newer");
  store.run(
    "UPDATE orders_orders SET created_at='2026-10-01T12:00:00.000Z',state='open' WHERE id='newer-000'",
  );
  const second = f.app.orders.orderPage(f.actor, first.next!);
  assert.ok(!second.items.some((o) => o.id === "newer-000"));
  assert.equal(f.app.orders.orderPage(f.actor).items[0]!.id, "newer-000");
  const overdue = f.app.orders
    .orderPage(f.actor)
    .items.find((o) => o.id === first.items[0]!.id)!;
  assert.deepEqual(overdue.reservation, { expiresAt: 1, overdue: true });
});
test("native cancellation moves an unfulfilled order to closed without any invented canceled-order state", (t) => {
  const f = fixture(t);
  const accepted = accept(f);
  const order = f.app.orders.order(f.actor, accepted.id),
    line = f.app.orders.lines(f.actor, order.id)[0]!;
  f.app.orders.cancel(f.actor, "cancel", {
    orderId: order.id,
    lineId: line.id,
    quantity: 1,
    revision: order.revision,
    reason: "Synthetic customer cancellation",
  });
  assert.deepEqual(f.app.orders.orderCounts(f.actor), { total: 1, open: 0 });
  const page = f.app.orders.orderPage(f.actor, undefined, "closed");
  assert.equal(page.items[0]!.lines[0]!.canceled, 1);
  assert.equal(page.items[0]!.lines[0]!.shipped, 0);
});
