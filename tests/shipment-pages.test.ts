import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, accept, ship } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import { Store } from "../src/server/database.ts";
import type { Actor, Role } from "../src/server/core.ts";
import {
  shipmentQueueStates,
  type ShipmentQueueState,
} from "../src/shared/shipment-queue.ts";

type Fixture = ReturnType<typeof fixture>;
// Deliberately tied-time history fixtures; these are not physical shipment proof.
function seed(
  f: Fixture,
  count: number,
  prefix = "page",
  accountId = f.buyer,
  warehouseId = f.w1,
) {
  const store = f.app.database.owned("fulfillment");
  for (let i = 0; i < count; i++)
    store.run(
      "INSERT INTO fulfillment_shipments(id,org_id,order_id,account_id,warehouse_id,state,mode,address,lines,created_at) VALUES(?,?,?,?,?,'packed','carrier',?,'[]',?)",
      `${prefix}-${String(i).padStart(3, "0")}`,
      f.actor.orgId,
      "synthetic-history-order",
      accountId,
      warehouseId,
      `${prefix} destination ${i}`,
      "2026-09-30T12:00:00.000Z",
    );
}
function user(f: Fixture, role: Role, sites = [f.w1], accountId = f.buyer) {
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
function update(f: Fixture, actor: Actor, changes: Record<string, unknown>) {
  const row = f.app.identity.users(f.actor).find((u) => u.id === actor.id)!;
  f.app.identity.updateUser(
    f.actor,
    `page-change-${actor.id}-${row.revision}`,
    {
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
    },
  );
}
test("shipment status filters precede row limits, use latest revisions and retain scoped live cursors after status changes", (t) => {
  const f = fixture(t);
  seed(f, 43, "matching");
  seed(f, 80, "zz-unrelated", f.buyer, f.w2);
  const store = f.app.database.owned("fulfillment");
  store.run(
    "UPDATE fulfillment_shipments SET state='shipped',shipped_at=created_at WHERE id LIKE 'matching-%'",
  );
  for (let i = 0; i < 43; i++) {
    const id = `matching-${String(i).padStart(3, "0")}`;
    for (const [revision, state] of [
      [1, "in_transit"],
      [2, "delayed"],
    ] as const)
      store.run(
        "INSERT INTO fulfillment_delivery_history(id,org_id,shipment_id,revision,state,reference,reference_key,evidence,observed_at,actor_id,created_at,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,'operator')",
        `${id}-${revision}`,
        f.actor.orgId,
        id,
        revision,
        state,
        `${id}-${revision}`,
        `${id}-${revision}`,
        "Private evidence must not leak",
        "2026-09-30T12:00:00.000Z",
        f.actor.id,
        "2026-09-30T12:00:00.000Z",
      );
  }
  const warehouse = user(f, "warehouse");
  const before = store.all("SELECT * FROM fulfillment_shipments ORDER BY id");
  const first = f.app.fulfillment.shipmentPage(warehouse, undefined, "delayed");
  assert.equal(first.items.length, 20);
  assert.equal(first.next, "matching-023");
  assert.ok(first.items.every((s) => s.delivery?.state === "delayed"));
  assert.ok(!JSON.stringify(first).includes("Private evidence"));
  assert.deepEqual(
    f.app.fulfillment.shipmentPage(warehouse, undefined, "in_transit"),
    { items: [], next: null },
  );
  // The cursor is an accessible creation boundary, even after leaving the filter.
  store.run(
    "INSERT INTO fulfillment_delivery_history(id,org_id,shipment_id,revision,state,reference,reference_key,evidence,observed_at,actor_id,created_at,source) VALUES('cursor-changed',?,?,3,'delivered','changed','changed','New evidence',?,?,?,'operator')",
    f.actor.orgId,
    first.next,
    "2026-09-30T12:00:00.000Z",
    f.actor.id,
    "2026-09-30T12:00:00.000Z",
  );
  f.app.close();
  f.app = new Application(f.path);
  const second = f.app.fulfillment.shipmentPage(
    warehouse,
    first.next!,
    "delayed",
  );
  const third = f.app.fulfillment.shipmentPage(
    warehouse,
    second.next!,
    "delayed",
  );
  assert.equal(second.items.length, 20);
  assert.equal(third.items.length, 3);
  assert.equal(third.next, null);
  const ids = [...first.items, ...second.items, ...third.items].map(
    (s) => s.id,
  );
  assert.equal(new Set(ids).size, 43);
  assert.deepEqual(
    ids,
    Array.from(
      { length: 43 },
      (_, i) => `matching-${String(42 - i).padStart(3, "0")}`,
    ),
  );
  assert.equal(
    f.app.fulfillment.shipmentPage(warehouse, undefined, "delayed").items
      .length,
    20,
  );
  assert.equal(
    f.app.fulfillment.shipmentPage(warehouse, undefined, "shipped").items
      .length,
    20,
  );
  assert.deepEqual(
    f.app.database
      .owned("fulfillment")
      .all("SELECT * FROM fulfillment_shipments ORDER BY id"),
    before,
  );
  for (const invalid of ["", "unknown", null, 1, {}, "delayed' OR 1=1 --"])
    assert.throws(
      () =>
        f.app.fulfillment.shipmentPage(
          warehouse,
          undefined,
          invalid as ShipmentQueueState,
        ),
      { code: "VALIDATION" },
    );
  assert.throws(
    () =>
      f.app.fulfillment.shipmentPage(warehouse, "zz-unrelated-000", "packed"),
    { code: "CURSOR" },
  );
  update(f, warehouse, { sites: [f.w2] });
  assert.throws(
    () => f.app.fulfillment.shipmentPage(warehouse, first.next!, "delayed"),
    { code: "CURSOR" },
  );
  assert.deepEqual(
    f.app.fulfillment.shipmentPage(warehouse, undefined, "delayed"),
    { items: [], next: null },
  );
});
test("every shipment queue state uses native defaults and latest scoped history without inventing outcomes", (t) => {
  const f = fixture(t);
  seed(f, shipmentQueueStates.length);
  const store = f.app.database.owned("fulfillment");
  const expected = new Map<string, string[]>();
  shipmentQueueStates.forEach((state, i) => {
    const id = `page-${String(i).padStart(3, "0")}`;
    if (["packed", "void"].includes(state))
      store.run(
        "UPDATE fulfillment_shipments SET state=? WHERE id=?",
        state,
        id,
      );
    else {
      store.run(
        "UPDATE fulfillment_shipments SET state='shipped',mode=?,shipped_at=created_at WHERE id=?",
        state === "collected" ? "collection" : "carrier",
        id,
      );
      if (!["shipped", "handed_over", "collected"].includes(state))
        store.run(
          "INSERT INTO fulfillment_delivery_history(id,org_id,shipment_id,revision,state,reference,reference_key,evidence,observed_at,actor_id,created_at,source) VALUES(?,?,?,1,?,'ref','ref','private',?,?,?,'operator')",
          `${id}-history`,
          f.actor.orgId,
          id,
          state,
          "2026-09-30T12:00:00.000Z",
          f.actor.id,
          "2026-09-30T12:00:00.000Z",
        );
    }
    expected.set(state, [id]);
  });
  expected.set("handed_over", ["page-003", "page-001"]);
  expected.set("shipped", [
    "page-009",
    "page-008",
    "page-007",
    "page-006",
    "page-005",
    "page-004",
    "page-003",
    "page-001",
  ]);
  // A different organization's newer history with the same native ID is ignored.
  store.run(
    "INSERT INTO fulfillment_delivery_history(id,org_id,shipment_id,revision,state,reference,reference_key,evidence,observed_at,actor_id,created_at,source) VALUES('foreign','foreign','page-003',100,'lost','foreign','foreign','foreign',?,?,?,'operator')",
    "2026-09-30T12:00:00.000Z",
    f.actor.id,
    "2026-09-30T12:00:00.000Z",
  );
  for (const state of shipmentQueueStates)
    assert.deepEqual(
      f.app.fulfillment
        .shipmentPage(f.actor, undefined, state)
        .items.map((s) => s.id),
      expected.get(state),
      state,
    );
});
test("shipment pages traverse tied timestamps exactly once across restart; new newer shipments await refresh", (t) => {
  const f = fixture(t);
  seed(f, 43);
  const first = f.app.fulfillment.shipmentPage(f.actor);
  assert.equal(first.items.length, 20);
  assert.equal(first.next, "page-023");
  seed(f, 1, "zz-new");
  f.app.close();
  f.app = new Application(f.path);
  const second = f.app.fulfillment.shipmentPage(f.actor, first.next!);
  const third = f.app.fulfillment.shipmentPage(f.actor, second.next!);
  assert.equal(second.items.length, 20);
  assert.equal(third.items.length, 3);
  assert.equal(third.next, null);
  const ids = [...first.items, ...second.items, ...third.items].map(
    (s) => s.id,
  );
  assert.equal(new Set(ids).size, 43);
  assert.deepEqual(
    ids,
    Array.from(
      { length: 43 },
      (_, i) => `page-${String(42 - i).padStart(3, "0")}`,
    ),
  );
  assert.equal(
    f.app.fulfillment.shipmentPage(f.actor).items[0]!.id,
    "zz-new-000",
  );
});
test("buyer and warehouse predicates precede limits; cursors cannot cross current account/site/organization", (t) => {
  const f = fixture(t);
  const other = f.app.identity.createCustomer(f.actor, "page-other", {
    name: "Other",
    tier: "standard",
    creditLimit: 1000000,
  }).id;
  seed(f, 23, "owned");
  seed(f, 35, "zz-other", other, f.w2);
  const buyer = user(f, "buyer"),
    warehouse = user(f, "warehouse");
  for (const actor of [buyer, warehouse]) {
    const first = f.app.fulfillment.shipmentPage(actor, undefined, "packed");
    assert.equal(first.items.length, 20);
    assert.ok(first.items.every((s) => s.id.startsWith("owned-")));
    assert.equal(
      f.app.fulfillment.shipmentPage(actor, first.next!, "packed").items.length,
      3,
    );
    assert.throws(
      () => f.app.fulfillment.shipmentPage(actor, "zz-other-000", "packed"),
      {
        code: "CURSOR",
      },
    );
  }
  assert.deepEqual(
    f.app.fulfillment.shipmentPage({
      ...buyer,
      role: "admin",
      accountId: other,
      sites: [f.w2],
    }),
    f.app.fulfillment.shipmentPage(buyer),
  );
  const cursor = f.app.fulfillment.shipmentPage(warehouse).next!;
  update(f, warehouse, { sites: [f.w2] });
  assert.throws(() => f.app.fulfillment.shipmentPage(warehouse, cursor), {
    code: "CURSOR",
  });
  assert.ok(
    f.app.fulfillment
      .shipmentPage(warehouse)
      .items.every((s) => s.warehouse_id === f.w2),
  );
  update(f, warehouse, { sites: [] });
  assert.deepEqual(f.app.fulfillment.shipmentPage(warehouse), {
    items: [],
    next: null,
  });
  const store = f.app.database.owned("fulfillment");
  store.run(
    "UPDATE fulfillment_shipments SET org_id='other-org' WHERE id='zz-other-000'",
  );
  assert.throws(() => f.app.fulfillment.shipmentPage(f.actor, "zz-other-000"), {
    code: "CURSOR",
  });
  assert.throws(() => f.app.fulfillment.shipmentPage(f.actor, "absent"), {
    code: "CURSOR",
  });
  assert.throws(() => f.app.fulfillment.shipmentPage(f.actor, ""), {
    code: "VALIDATION",
  });
  assert.throws(
    () => f.app.fulfillment.shipmentPage(f.actor, "x".repeat(129)),
    { code: "VALIDATION" },
  );
});
test("page and compatibility projections reread real grants, active status and required password change", (t) => {
  const f = fixture(t);
  seed(f, 23);
  const warehouse = user(f, "warehouse");
  const cursor = f.app.fulfillment.shipmentPage(warehouse).next!;
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
      warehouse.id,
    );
  for (const read of [
    () => f.app.fulfillment.shipmentPage(warehouse, cursor),
    () => f.app.fulfillment.shipmentPage(warehouse, cursor, "packed"),
    () => f.app.fulfillment.shipments(warehouse),
  ])
    assert.throws(read, { code: "PASSWORD_CHANGE_REQUIRED" });
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_user_security SET password_change_required=0 WHERE user_id=?",
      warehouse.id,
    );
  update(f, warehouse, { active: false });
  assert.throws(
    () =>
      f.app.fulfillment.shipmentPage({ ...warehouse, role: "admin" }, cursor),
    { code: "FORBIDDEN" },
  );
});
test("paged latest delivery summaries preserve original shipment shape and native state through void, collection and carrier outcomes", (t) => {
  const f = fixture(t);
  const order = accept(f, 1, "real-collection");
  const result = ship(f, order.id);
  const id = result.id;
  const carrierOrder = accept(f, 1, "real-carrier");
  const pick = f.app.fulfillment.picks(f.actor, carrierOrder.id)[0]!;
  f.app.fulfillment.pick(f.actor, "page-pick", {
    orderId: carrierOrder.id,
    allocationId: pick.id,
    serial: pick.serial,
  });
  const carrier = f.app.fulfillment.pack(f.actor, "page-pack", {
    orderId: carrierOrder.id,
    revision: f.app.orders.order(f.actor, carrierOrder.id).revision,
    mode: "carrier",
    address: "Synthetic carrier destination",
    lines: [{ allocationId: pick.id, quantity: 1 }],
  });
  f.app.fulfillment.commit(f.actor, "page-carrier", {
    shipmentId: carrier.id,
    carrier: "Synthetic carrier",
    tracking: "PAGE-TRACK",
    handoverEvidence: "Synthetic handover",
  });
  assert.deepEqual(
    f.app.fulfillment
      .shipmentPage(f.actor, undefined, "collected")
      .items.map((s) => s.id),
    [id],
  );
  assert.deepEqual(
    f.app.fulfillment
      .shipmentPage(f.actor, undefined, "handed_over")
      .items.map((s) => s.id),
    [carrier.id],
  );
  const before = {
    units: f.app.inventory.stock(f.actor),
    orders: f.app.orders.list(f.actor),
    invoices: f.app.billing.invoices(f.actor),
    accounts: f.app.identity.customers(f.actor),
  };
  const time = new Date().toISOString();
  f.app.fulfillment.confirmDelivery(f.actor, "page-delivered", {
    shipmentId: id,
    reference: "Page collection evidence",
    deliveredAt: time,
  });
  for (const [revision, state] of [
    [0, "delayed"],
    [1, "returned"],
  ] as const)
    f.app.fulfillment.updateDelivery(f.actor, `page-event-${revision}`, {
      shipmentId: carrier.id,
      revision,
      state,
      observedAt: time,
      reference: `PAGE-REF-${revision}`,
      evidence: "Private synthetic delivery observation",
    });
  seed(f, 2);
  f.app.database
    .owned("fulfillment")
    .run("UPDATE fulfillment_shipments SET state='void' WHERE id='page-000'");
  for (const [state, ids] of [
    ["delivered", [id]],
    ["returned", [carrier.id]],
    ["delayed", []],
    ["handed_over", []],
    ["collected", []],
    ["void", ["page-000"]],
    ["packed", ["page-001"]],
  ] as const) {
    assert.deepEqual(
      f.app.fulfillment
        .shipmentPage(f.actor, undefined, state)
        .items.map((s) => s.id),
      [...ids],
      state,
    );
  }
  const all = f.app.fulfillment.shipments(f.actor),
    page = f.app.fulfillment.shipmentPage(f.actor);
  assert.deepEqual(page.items, all);
  const actual = page.items.find((s) => s.id === id)!;
  assert.deepEqual(actual.delivery, {
    revision: 1,
    state: "delivered",
    observedAt: time,
  });
  assert.deepEqual(page.items.find((s) => s.id === carrier.id)!.delivery, {
    revision: 2,
    state: "returned",
    observedAt: time,
  });
  assert.equal(actual.invoice_id, result.invoiceId);
  assert.equal(actual.units.length, 1);
  assert.equal(actual.lines.length, 1);
  assert.equal(page.items.find((s) => s.state === "void")!.delivery, null);
  assert.equal(page.items.find((s) => s.state === "packed")!.delivery, null);
  assert.ok(!("delivery_revision" in actual));
  assert.ok(!JSON.stringify(page).includes("Page collection evidence"));
  assert.deepEqual(
    {
      units: f.app.inventory.stock(f.actor),
      orders: f.app.orders.list(f.actor),
      invoices: f.app.billing.invoices(f.actor),
      accounts: f.app.identity.customers(f.actor),
    },
    before,
  );
});
test("shipment continuation returns at most 21 database rows and uses one joined summary query", (t) => {
  const f = fixture(t);
  seed(f, 103);
  const originalAll = Store.prototype.all,
    originalGet = Store.prototype.get;
  const counts: number[] = [],
    sql: string[] = [];
  Store.prototype.all = function (query, ...params) {
    const rows = originalAll.call(this, query, ...params);
    if (query.includes("FROM fulfillment_shipments")) {
      counts.push(rows.length);
      sql.push(query);
    }
    return rows as any;
  };
  Store.prototype.get = function (query, ...params) {
    assert.ok(!query.includes("SELECT * FROM fulfillment_delivery_history"));
    return originalGet.call(this, query, ...params) as any;
  };
  try {
    let next: string | undefined;
    let seen = 0;
    do {
      const page = f.app.fulfillment.shipmentPage(f.actor, next, "packed");
      seen += page.items.length;
      next = page.next ?? undefined;
    } while (next);
    assert.equal(seen, 103);
    assert.deepEqual(counts, [21, 21, 21, 21, 21, 3]);
    assert.ok(
      sql.every((s) => s.includes("LEFT JOIN fulfillment_delivery_history")),
    );
  } finally {
    Store.prototype.all = originalAll;
    Store.prototype.get = originalGet;
  }
});
test("HTTP shipment pages reject malformed/unknown queries and unauthenticated access; dashboard supplies only the first page", async (t) => {
  const f = fixture(t);
  seed(f, 43);
  const origin = "http://127.0.0.1:3000",
    http = await createHttp(f.app, {
      origin,
      staticRoot: "/nonexistent-distributor-test",
    });
  await http.ready();
  t.after(() => http.close());
  assert.equal(
    (await http.inject({ url: "/api/shipments/page" })).statusCode,
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
  const c = login.cookies[0]!,
    headers = { cookie: `${c.name}=${c.value}`, origin };
  const first = await http.inject({ url: "/api/shipments/page", headers });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().items.length, 20);
  const filtered = await http.inject({
    url: "/api/shipments/page?state=packed",
    headers,
  });
  assert.equal(filtered.statusCode, 200);
  assert.deepEqual(filtered.json(), first.json());
  assert.deepEqual(
    (
      await http.inject({ url: "/api/shipments/page?state=delayed", headers })
    ).json(),
    { items: [], next: null },
  );
  const dashboard = await http.inject({ url: "/api/dashboard", headers });
  assert.deepEqual(dashboard.json().shipments, first.json().items);
  assert.equal(dashboard.json().shipmentNext, first.json().next);
  const next = await http.inject({
    url: `/api/shipments/page?after=${first.json().next}`,
    headers,
  });
  assert.equal(next.json().items.length, 20);
  for (const q of [
    "?after=",
    "?after=unknown",
    `?after=${"x".repeat(129)}`,
    "?limit=100",
    "?state=",
    "?state=unknown",
    "?state=lost&state=delayed",
    "?accountId=other",
    "?after=page-022&after=page-021",
  ])
    assert.equal(
      (await http.inject({ url: `/api/shipments/page${q}`, headers }))
        .statusCode,
      400,
      q,
    );
});
