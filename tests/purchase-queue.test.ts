import { test } from "node:test";
import assert from "node:assert/strict";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import { fixture } from "./fixtures.ts";
import { seedPurchaseQueue } from "./purchase-queue-fixture.ts";
import { Store } from "../src/server/database.ts";
import type { SQLInputValue } from "node:sqlite";
import type { Actor, Role, Row } from "../src/server/core.ts";
const cursor = (id: string, state: string | null = null) =>
  Buffer.from(JSON.stringify([1, state, id])).toString("base64url");
function user(
  f: ReturnType<typeof fixture>,
  role: Role,
  sites: string[] = [f.w1],
) {
  const row = f.app.identity.createUser(f.actor, role, {
    email: `${role}@example.test`,
    name: role,
    password: "long-test-only-password",
    role,
    accountId: f.buyer,
    sites: role === "buyer" ? [] : sites,
  });
  return f.app.identity.currentActor({ ...f.actor, id: row.id });
}
function grants(
  f: ReturnType<typeof fixture>,
  actor: Actor,
  changes: Record<string, unknown>,
) {
  const row = f.app.identity.users(f.actor).find((u) => u.id === actor.id)!;
  f.app.identity.updateUser(f.actor, `grant-${actor.id}-${row.revision}`, {
    userId: actor.id,
    revision: Number(row.revision),
    email: String(row.email),
    name: actor.name,
    role: actor.role,
    sites: actor.sites,
    active: true,
    currentPassword: "long-test-only-password",
    reason: "Synthetic purchase queue grant change",
    ...changes,
  });
}
function facts(f: ReturnType<typeof fixture>) {
  return ["orders", "lines", "receipts", "returns", "drafts", "draft_versions"]
    .map((table) =>
      f.app.database
        .owned("procurement")
        .all(`SELECT * FROM procurement_${table} ORDER BY rowid`),
    )
    .concat(
      ["units", "movements", "allocations"].map((table) =>
        f.app.database
          .owned("inventory")
          .all(`SELECT * FROM inventory_${table} ORDER BY rowid`),
      ),
      ["commands", "audit", "events"].map((table) =>
        f.app.database
          .owned("platform")
          .all(`SELECT * FROM platform_${table} ORDER BY rowid`),
      ),
    );
}
async function session(
  f: ReturnType<typeof fixture>,
  email = "admin@example.test",
) {
  const http = await createHttp(f.app, { origin: "http://localhost" });
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin: "http://localhost" },
    payload: { email, password: "long-test-only-password" },
  });
  assert.equal(login.statusCode, 200);
  const cookie = login.cookies[0]!;
  return { http, headers: { cookie: `${cookie.name}=${cookie.value}` } };
}
test("purchasing overview loads twenty headers and retains receipt product identity independently of queue pages", async (t) => {
  const f = fixture(t);
  seedPurchaseQueue(f);
  const { http, headers } = await session(f);
  t.after(() => http.close());
  const result = await http.inject({
    method: "GET",
    url: "/api/purchases",
    headers,
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.json().orders.length, 20);
  assert.ok(result.json().orderNext);
  assert.equal(
    result.json().receipts.find((r: any) => r.po_id === f.po).product_id,
    f.product,
  );
});
test("purchase queue orders tied timestamps deterministically, restarts, and does not repeat later inserted headers", (t) => {
  const f = fixture(t),
    ids = seedPurchaseQueue(f);
  f.app.database
    .owned("procurement")
    .run(
      "UPDATE procurement_orders SET created_at='2000-01-01T00:00:00.000Z' WHERE id=?",
      f.po,
    );
  const before = facts(f),
    first = f.app.procurement.orderPage(f.actor);
  assert.equal(first.items.length, 20);
  assert.equal(first.next, cursor(ids[25]!));
  f.app.close();
  f.app = new Application(f.path, "CA");
  assert.deepEqual(f.app.procurement.orderPage(f.actor), first);
  assert.deepEqual(facts(f), before);
  seedPurchaseQueue(f, 1, "z-later");
  const second = f.app.procurement.orderPage(f.actor, { after: first.next! });
  const third = f.app.procurement.orderPage(f.actor, { after: second.next! });
  assert.equal(second.items.length, 20);
  assert.equal(third.items.length, 6);
  assert.equal(third.next, null);
  assert.deepEqual(
    [...first.items, ...second.items, ...third.items].map((p) => p.id),
    [...ids.reverse(), f.po],
  );
  assert.equal(
    f.app.procurement.order(f.actor, ids.at(-1)!).lines[0]!.product_id,
    f.product,
  );
});
test("purchase filters bind cursors, tolerate completed anchors and materialize only current page lines", (t) => {
  const f = fixture(t);
  seedPurchaseQueue(f);
  const before = facts(f),
    all = Store.prototype.all,
    queries: { sql: string; parameters: SQLInputValue[] }[] = [];
  Store.prototype.all = function <T extends Row = Row>(
    sql: string,
    ...parameters: SQLInputValue[]
  ): T[] {
    if (
      sql.includes("FROM procurement_orders") ||
      sql.includes("FROM procurement_lines")
    )
      queries.push({ sql, parameters });
    return all.call(this, sql, ...parameters) as T[];
  };
  let first: ReturnType<typeof f.app.procurement.orderPage>;
  try {
    first = f.app.procurement.orderPage(f.actor, { state: "open" });
  } finally {
    Store.prototype.all = all;
  }
  assert.equal(first!.items.length, 20);
  assert.ok(first!.items.every((p) => p.state === "open"));
  assert.equal(
    queries.filter((q) => q.sql.includes("FROM procurement_orders")).length,
    1,
  );
  assert.ok(
    queries
      .find((q) => q.sql.includes("FROM procurement_orders"))!
      .sql.includes("LIMIT 21"),
  );
  assert.deepEqual(
    queries
      .filter((q) => q.sql.includes("FROM procurement_lines"))
      .map((q) => q.parameters.at(-1))
      .sort(),
    first!.items.map((p) => p.id).sort(),
  );
  assert.deepEqual(facts(f), before);
  assert.throws(
    () =>
      f.app.procurement.orderPage(f.actor, {
        state: "received",
        after: first!.next!,
      }),
    { code: "VALIDATION" },
  );
  const anchor = first!.items.at(-1)!;
  f.app.procurement.receive(f.actor, "complete-anchor", {
    poId: anchor.id,
    lineId: String(anchor.lines[0]!.id),
    deliveryRef: "ANCHOR",
    quantity: 3,
    serials: ["ANCHOR-1", "ANCHOR-2", "ANCHOR-3"],
    bin: "QUEUE",
    quarantine: false,
  });
  const second = f.app.procurement.orderPage(f.actor, {
    state: "open",
    after: first!.next!,
  });
  assert.equal(second.items.length, 10);
  assert.equal(second.next, null);
  assert.ok(second.items.every((p) => p.state === "open" && p.id < anchor.id));
});
test("purchase pages and detail scope persisted warehouse grants before projection and reject unavailable anchors", (t) => {
  const f = fixture(t);
  seedPurchaseQueue(f, 45, "own");
  seedPurchaseQueue(f, 80, "foreign-site", f.w2);
  const warehouse = user(f, "warehouse"),
    other = f.app.procurement
      .orders(f.actor)
      .find((p) => p.warehouse_id === f.w2)!;
  const page = f.app.procurement.orderPage({
    ...warehouse,
    sites: [f.w2],
    role: "admin",
  });
  assert.equal(page.items.length, 20);
  assert.ok(page.items.every((p) => p.warehouse_id === f.w1));
  assert.throws(() => f.app.procurement.order(warehouse, other.id), {
    code: "NOT_FOUND",
  });
  assert.throws(
    () => f.app.procurement.orderPage(warehouse, { after: cursor(other.id) }),
    { code: "NOT_FOUND" },
  );
  const connection = new Application(f.path);
  t.after(() => connection.close());
  const row = connection.identity
    .users(f.actor)
    .find((u) => u.id === warehouse.id)!;
  connection.identity.updateUser(f.actor, "independent-site", {
    userId: warehouse.id,
    revision: Number(row.revision),
    email: String(row.email),
    name: warehouse.name,
    role: "warehouse",
    sites: [f.w2],
    active: true,
    currentPassword: "long-test-only-password",
    reason: "Synthetic site reassignment",
  });
  assert.throws(
    () => f.app.procurement.orderPage(warehouse, { after: page.next! }),
    { code: "NOT_FOUND" },
  );
  assert.ok(
    f.app.procurement
      .orderPage(warehouse)
      .items.every((p) => p.warehouse_id === f.w2),
  );
  grants(f, warehouse, { sites: [] });
  assert.deepEqual(f.app.procurement.orderPage(warehouse), {
    items: [],
    next: null,
  });
});
test("purchase readers reject unavailable, forged, buyer and password-restricted principals before any result", (t) => {
  const f = fixture(t),
    buyer = user(f, "buyer"),
    finance = user(f, "finance");
  const before = facts(f);
  for (const actor of [
    buyer,
    { ...buyer, role: "admin" as const },
    { ...f.actor, id: "missing" },
    { ...f.actor, orgId: "foreign" },
  ]) {
    assert.throws(() => f.app.procurement.orderPage(actor), {
      code: "FORBIDDEN",
    });
    assert.throws(() => f.app.procurement.order(actor, f.po), {
      code: "FORBIDDEN",
    });
  }
  assert.deepEqual(facts(f), before);
  assert.equal(f.app.procurement.order(finance, f.po).id, f.po);
  f.app.identity.resetPassword(f.actor, "reset-finance", {
    userId: finance.id,
    revision: Number(
      f.app.identity.users(f.actor).find((u) => u.id === finance.id)!.revision,
    ),
    password: "temporary-long-password",
    currentPassword: "long-test-only-password",
    reason: "Synthetic password restriction",
  });
  assert.throws(() => f.app.procurement.orderPage(finance), {
    code: "PASSWORD_CHANGE_REQUIRED",
  });
  assert.throws(() => f.app.procurement.order(finance, f.po), {
    code: "PASSWORD_CHANGE_REQUIRED",
  });
});
test("HTTP purchasing page and off-page details validate fields and revoke continued sessions", async (t) => {
  const f = fixture(t);
  seedPurchaseQueue(f);
  const warehouse = user(f, "warehouse");
  const { http, headers } = await session(f, "warehouse@example.test");
  t.after(() => http.close());
  const url = "/api/purchases/orders/page",
    first = await http.inject({ method: "GET", url, headers });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().items.length, 20);
  assert.equal(
    (
      await http.inject({
        method: "GET",
        url: "/api/purchases/orders/purchase-queue-000",
        headers,
      })
    ).statusCode,
    200,
  );
  for (const query of [
    "?state=missing",
    "?state=",
    "?after=",
    "?after=" + "a".repeat(513),
    "?after=invalid",
    "?after=" + cursor("missing"),
    "?limit=999",
    "?warehouseId=foreign",
    "?unknown=1",
  ])
    assert.ok(
      [400, 404].includes(
        (await http.inject({ method: "GET", url: url + query, headers }))
          .statusCode,
      ),
      query,
    );
  for (const after of [
    cursor("missing", "open"),
    Buffer.from('[2,null,"missing"]').toString("base64url"),
    Buffer.from("{}").toString("base64url"),
  ])
    assert.throws(() => f.app.procurement.orderPage(f.actor, { after }), {
      code: "VALIDATION",
    });
  grants(f, warehouse, { active: false });
  assert.equal(
    (
      await http.inject({
        method: "GET",
        url: url + "?after=" + first.json().next,
        headers,
      })
    ).statusCode,
    401,
  );
});

// Omitting catalog-owned descriptors loses retired SKU identity; using a catalog
// page as a lookup also loses active products beyond that page. Reads must keep
// original purchase facts and freshly enforce site access after restart.
for (const region of ["CA", "US"] as const)
  test(`purchase descriptors ${region}: scoped HTTP reads identify retired and off-page active lines without changing purchase facts`, async (t) => {
    const f = fixture(t, {}, region);
    for (let i = 0; i < 21; i++)
      f.app.catalog.create(f.actor, `descriptor-filler-${i}`, {
        sku: `FIRST-${i}`,
        name: `A synthetic product ${i}`,
        serialized: false,
        unitPrice: 100,
        taxBasisPoints: 0,
      });
    const retired = f.app.catalog.create(f.actor, "descriptor-retired", {
      sku: "RETIRED-EXPECTED",
      name: "Z synthetic retired equipment",
      serialized: true,
      unitPrice: 99900,
      taxBasisPoints: 0,
    }).id;
    const active = f.app.catalog.create(f.actor, "descriptor-active", {
      sku: "ZZ-ACTIVE-EXPECTED",
      name: "Z synthetic active equipment",
      serialized: false,
      unitPrice: 88800,
      taxBasisPoints: 0,
    }).id;
    const poId = f.app.procurement.create(f.actor, "descriptor-po", {
      supplierId: f.supplier,
      warehouseId: f.w1,
      lines: [
        { productId: retired, quantity: 2, unitCost: 4321 },
        { productId: active, quantity: 5, unitCost: 1234 },
      ],
    }).id;
    f.app.catalog.retire(f.actor, "descriptor-retire", {
      productId: retired,
      expectedHash: f.app.catalog.lifecycleReview(f.actor, retired)
        .expectedHash,
      reason: "Synthetic withdrawal from customer ordering",
    });
    const warehouse = user(f, "warehouse");
    f.app.close();
    f.app = new Application(f.path, region);
    assert.ok(!f.app.catalog.products(warehouse).some((p) => p.id === retired));
    assert.ok(
      !f.app.catalog.productPage(warehouse).items.some((p) => p.id === active),
    );
    const { http, headers } = await session(f, "warehouse@example.test");
    t.after(() => http.close());
    const before = facts(f);
    const expected = [
      ["RETIRED-EXPECTED", "Z synthetic retired equipment", 0, 2, 0, 4321],
      ["ZZ-ACTIVE-EXPECTED", "Z synthetic active equipment", 1, 5, 0, 1234],
    ];
    for (const url of [
      "/api/purchases",
      "/api/purchases/orders/page",
      `/api/purchases/orders/${poId}`,
    ]) {
      const response = await http.inject({ method: "GET", url, headers });
      assert.equal(response.statusCode, 200);
      const body = response.json();
      const order = url.endsWith(poId)
        ? body
        : (body.orders ?? body.items).find((p: any) => p.id === poId);
      assert.deepEqual(
        order.lines
          .map((line: any) => [
            line.product_sku,
            line.product_name,
            line.product_active,
            line.quantity,
            line.received,
            line.unit_cost,
          ])
          .sort(),
        expected,
      );
    }
    assert.deepEqual(facts(f), before);
    grants(f, warehouse, { sites: [f.w2] });
    const revokedFacts = facts(f);
    const denied = await http.inject({
      method: "GET",
      url: `/api/purchases/orders/${poId}`,
      headers,
    });
    assert.equal(denied.statusCode, 401);
    assert.ok(!denied.body.includes("RETIRED-EXPECTED"));
    assert.deepEqual(facts(f), revokedFacts);
    const refreshed = await session(f, "warehouse@example.test");
    t.after(() => refreshed.http.close());
    const refreshedFacts = facts(f);
    const outsideSite = await refreshed.http.inject({
      method: "GET",
      url: `/api/purchases/orders/${poId}`,
      headers: refreshed.headers,
    });
    assert.equal(outsideSite.statusCode, 404);
    assert.ok(!outsideSite.body.includes("RETIRED-EXPECTED"));
    const empty = await refreshed.http.inject({
      method: "GET",
      url: "/api/purchases/orders/page",
      headers: refreshed.headers,
    });
    assert.equal(empty.statusCode, 200);
    assert.deepEqual(empty.json(), { items: [], next: null });
    assert.deepEqual(facts(f), refreshedFacts);
  });
