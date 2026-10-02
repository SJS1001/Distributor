import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import { Store } from "../src/server/database.ts";
import type { Row } from "../src/server/core.ts";
import type { SQLInputValue } from "node:sqlite";

import {
  seedCatalogEntry,
  seedSavedCartQueue,
} from "./catalog-entry-fixture.ts";
function facts(f: ReturnType<typeof fixture>) {
  return ["carts", "quotes", "orders"]
    .map((n) =>
      f.app.database
        .owned("orders")
        .all(`SELECT * FROM orders_${n} ORDER BY rowid`),
    )
    .concat(
      ["commands", "audit", "events"].map((n) =>
        f.app.database
          .owned("platform")
          .all(`SELECT * FROM platform_${n} ORDER BY rowid`),
      ),
    );
}

test("catalog entry traverses bounded customer prices across restart and literal searches", (t) => {
  const f = fixture(t),
    p = seedCatalogEntry(f),
    before = facts(f);
  const first = f.app.catalog.customerProductPage(p.buyer, f.buyer);
  assert.equal(first.items.length, 20);
  assert.ok(first.next);
  f.app.close();
  f.app = new Application(f.path, "CA");
  assert.deepEqual(f.app.catalog.customerProductPage(p.buyer, f.buyer), first);
  const second = f.app.catalog.customerProductPage(
    p.buyer,
    f.buyer,
    first.next!,
  );
  const third = f.app.catalog.customerProductPage(
    p.buyer,
    f.buyer,
    second.next!,
  );
  const all = [...first.items, ...second.items, ...third.items];
  assert.equal(all.length, 45);
  assert.equal(new Set(all.map((p) => p.id)).size, 45);
  assert.equal(third.next, null);
  assert.equal(all.find((x) => x.id === p.ids[44])!.unit_price, 777);
  assert.equal(all.find((x) => x.id === p.ids[44])!.unit_tax, 101);
  assert.ok(all.every((x) => !("org_id" in x) && !("active" in x)));
  assert.deepEqual(
    f.app.catalog
      .customerProductPage(p.buyer, f.buyer, undefined, "%_")
      .items.map((x) => x.id),
    [p.ids[42]],
  );
  assert.deepEqual(
    f.app.catalog
      .customerProductPage(p.buyer, f.buyer, undefined, "pAgEd product 44")
      .items.map((x) => x.id),
    [p.ids[44]],
  );
  assert.deepEqual(
    f.app.catalog.customerProductPage(p.buyer, f.buyer, undefined, "absent"),
    { items: [], next: null },
  );
  assert.deepEqual(facts(f), before);
});

test("selected cart resolves off-page active and unavailable products without scanning other carts", (t) => {
  const f = fixture(t),
    p = seedCatalogEntry(f),
    before = facts(f);
  f.app.orders.saveCart(f.actor, "unrelated-cart", {
    accountId: p.other,
    warehouseId: f.w2,
    revision: 0,
    lines: [{ productId: f.product, quantity: 1 }],
  });
  const now = facts(f),
    calls: string[] = [],
    original = Store.prototype.all;
  Store.prototype.all = function <T extends Row>(
    sql: string,
    ...params: SQLInputValue[]
  ): T[] {
    calls.push(sql);
    return original.call(this, sql, ...params) as T[];
  };
  let entry;
  try {
    entry = f.app.orders.orderEntry(p.buyer, f.buyer, f.w1);
  } finally {
    Store.prototype.all = original;
  }
  assert.equal(entry.cart!.id, p.cart.id);
  assert.equal(entry.cart!.revision, 1);
  assert.deepEqual(entry.cart!.lines, [
    { productId: p.ids[44], quantity: 3 },
    { productId: p.ids[43], quantity: 2 },
  ]);
  assert.equal(entry.products.find((x) => x.id === p.ids[44])!.active, 1);
  assert.equal(entry.products.find((x) => x.id === p.ids[44])!.unit_price, 777);
  assert.equal(entry.products.find((x) => x.id === p.ids[43])!.active, 0);
  assert.equal(entry.products.length, 2);
  assert.ok(
    !calls.some((sql) => sql.includes("FROM orders_carts")),
    "target cart must use a unique scoped lookup",
  );
  assert.ok(
    calls.some((sql) => sql.includes("p.id IN")),
    "saved products must use a bounded identity lookup",
  );
  assert.deepEqual(facts(f), now);
  assert.notDeepEqual(now, before);
  assert.deepEqual(f.app.orders.orderEntry(p.buyer, f.buyer, f.w2), {
    cart: null,
    products: [],
  });
});

test("catalog SQL limits selection before public enrichment and rechecks current tier and grants", (t) => {
  const f = fixture(t),
    p = seedCatalogEntry(f),
    calls: { sql: string; params: SQLInputValue[] }[] = [],
    original = Store.prototype.all;
  Store.prototype.all = function <T extends Row>(
    sql: string,
    ...params: SQLInputValue[]
  ): T[] {
    calls.push({ sql, params });
    return original.call(this, sql, ...params) as T[];
  };
  try {
    f.app.catalog.customerProductPage(p.buyer, f.buyer);
  } finally {
    Store.prototype.all = original;
  }
  const select = calls.find((c) => c.sql.includes("FROM catalog_products"))!;
  assert.match(select.sql, /p.org_id=\?.*p.active=1/s);
  assert.match(select.sql, /LIMIT 21/);
  assert.ok(select.params.includes(p.buyer.orgId));
  const before = facts(f);
  assert.throws(
    () =>
      f.app.catalog.customerProductPage({ ...p.buyer, role: "admin" }, p.other),
    { code: "FORBIDDEN" },
  );
  assert.throws(() => f.app.orders.orderEntry(p.buyer, p.other, f.w1), {
    code: "FORBIDDEN",
  });
  assert.throws(
    () => f.app.orders.orderEntry(p.buyer, f.buyer, "missing-site"),
    { code: "NOT_FOUND" },
  );
  assert.throws(
    () => f.app.catalog.customerProductPage(p.buyer, f.buyer, "missing-cursor"),
    { code: "CURSOR" },
  );
  f.app.database
    .owned("iam")
    .run("UPDATE iam_accounts SET tier='partner' WHERE id=?", f.buyer);
  assert.equal(
    f.app.catalog.customerProductPage(p.buyer, f.buyer).items[0]!.unit_price,
    4200,
  );
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET active=0 WHERE id=?", p.buyer.id);
  assert.throws(() => f.app.catalog.customerProductPage(p.buyer, f.buyer), {
    code: "FORBIDDEN",
  });
  assert.throws(() => f.app.orders.orderEntry(p.buyer, f.buyer, f.w1), {
    code: "FORBIDDEN",
  });
  assert.deepEqual(facts(f), before);
});

test("paged entry HTTP rejects malformed queries, stays private and refuses revoked sessions", async (t) => {
  const f = fixture(t),
    p = seedCatalogEntry(f),
    http = await createHttp(f.app, { origin: "http://127.0.0.1:3117" });
  t.after(() => http.close());
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin: "http://127.0.0.1:3117" },
    payload: {
      email: "pricing-buyer@example.test",
      password: "long-test-only-password",
    },
  });
  const cookie = login.headers["set-cookie"]!.toString().split(";")[0]!;
  const catalog = `/api/catalog/customer-products/page?accountId=${f.buyer}`;
  const entry = `/api/carts/selection?accountId=${f.buyer}&warehouseId=${f.w1}`;
  for (const url of [catalog, entry, "/api/carts/page"]) {
    const r = await http.inject({ method: "GET", url, headers: { cookie } });
    assert.equal(r.statusCode, 200);
    assert.equal(r.headers["cache-control"], "no-store");
  }
  for (const url of [
    "/api/catalog/customer-products/page",
    `${catalog}&after=`,
    `${catalog}&q=${"x".repeat(121)}`,
    `${catalog}&extra=1`,
    `${catalog}&accountId=${p.other}`,
    "/api/carts/selection",
    `${entry}&warehouseId=x`,
    `${entry}&extra=1`,
    "/api/carts/page?after=",
    "/api/carts/page?accountId=",
    "/api/carts/page?warehouseId=x&warehouseId=y",
    "/api/carts/page?extra=1",
    `/api/carts/page?after=${"x".repeat(129)}`,
  ])
    assert.equal(
      (await http.inject({ method: "GET", url, headers: { cookie } }))
        .statusCode,
      400,
      url,
    );
  assert.equal(
    (
      await http.inject({
        method: "GET",
        url: `/api/carts/selection?accountId=${p.other}&warehouseId=${f.w1}`,
        headers: { cookie },
      })
    ).statusCode,
    403,
  );
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET active=0 WHERE id=?", p.buyer.id);
  for (const url of [catalog, entry, "/api/carts/page"])
    assert.equal(
      (await http.inject({ method: "GET", url, headers: { cookie } }))
        .statusCode,
      401,
    );
});

test("saved cart pages bound tied headers before parsing, survive restart and bind customer/site cursors", (t) => {
  const f = fixture(t),
    p = seedCatalogEntry(f),
    rows = seedSavedCartQueue(f);
  const other = f.app.orders.saveCart(f.actor, "queue-other", {
    accountId: p.other,
    warehouseId: f.w1,
    revision: 0,
    lines: [{ productId: f.product, quantity: 9 }],
  });
  const before = facts(f),
    calls: string[] = [],
    original = Store.prototype.all;
  Store.prototype.all = function <T extends Row>(
    sql: string,
    ...params: SQLInputValue[]
  ): T[] {
    calls.push(sql);
    return original.call(this, sql, ...params) as T[];
  };
  let first;
  try {
    first = f.app.orders.cartPage(p.buyer);
  } finally {
    Store.prototype.all = original;
  }
  assert.equal(first.items.length, 20);
  assert.equal(first.items[0]!.id, rows[43]!.id);
  assert.ok(
    calls.some(
      (sql) => sql.includes("FROM orders_carts") && /LIMIT 21/.test(sql),
    ),
  );
  assert.ok(first.items.every((c) => !("lines" in c) && !("org_id" in c)));
  f.app.close();
  f.app = new Application(f.path, "CA");
  assert.deepEqual(f.app.orders.cartPage(p.buyer), first);
  const second = f.app.orders.cartPage(p.buyer, first.next!),
    third = f.app.orders.cartPage(p.buyer, second.next!);
  assert.equal(second.items.length, 20);
  assert.equal(third.items.length, 5);
  assert.equal(third.next, null);
  assert.equal(
    new Set([...first.items, ...second.items, ...third.items].map((c) => c.id))
      .size,
    45,
  );
  assert.equal(third.items.at(-1)!.id, p.cart.id);
  assert.equal(third.items.at(-1)!.products, 2);
  assert.equal(third.items.at(-1)!.units, 5);
  assert.equal(
    f.app.orders.cartPage(p.commercial, undefined, p.other).items[0]!.id,
    other.id,
  );
  assert.deepEqual(
    f.app.orders
      .cartPage(p.buyer, undefined, f.buyer, rows[0]!.warehouse)
      .items.map((c) => c.id),
    [rows[0]!.id],
  );
  assert.throws(() => f.app.orders.cartPage(p.buyer, other.id), {
    code: "CURSOR",
  });
  assert.throws(
    () =>
      f.app.orders.cartPage(
        p.buyer,
        first.next!,
        undefined,
        rows[0]!.warehouse,
      ),
    { code: "CURSOR" },
  );
  assert.throws(
    () =>
      f.app.orders.cartPage({ ...p.buyer, role: "admin" }, undefined, p.other),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () => f.app.orders.cartPage(p.buyer, undefined, undefined, "missing-site"),
    { code: "NOT_FOUND" },
  );
  assert.deepEqual(facts(f), before);
});

test("entry and empty cart/catalog reads recheck password, assignment, role, foreign identities and currency", (t) => {
  const f = fixture(t),
    p = seedCatalogEntry(f),
    foreign = fixture(t),
    q = seedCatalogEntry(foreign),
    before = facts(f);
  assert.throws(
    () => f.app.catalog.customerProductPage(p.buyer, f.buyer, q.ids[0]!),
    { code: "CURSOR" },
  );
  assert.throws(() => f.app.orders.orderEntry(p.buyer, f.buyer, foreign.w1), {
    code: "NOT_FOUND",
  });
  const resolve = (ids: string[]) =>
    f.app.database.transaction(() =>
      f.app.catalog.selectedCustomerProducts(p.buyer, f.buyer, ids),
    );
  assert.throws(() => resolve([q.ids[0]!]), { code: "NOT_FOUND" });
  assert.throws(() => resolve([f.product, f.product]), { code: "VALIDATION" });
  assert.throws(() => resolve(Array(101).fill(f.product)), {
    code: "VALIDATION",
  });
  f.app.database
    .owned("catalog")
    .run("UPDATE catalog_products SET currency='USD' WHERE id=?", p.ids[44]!);
  assert.throws(() => f.app.orders.orderEntry(p.buyer, f.buyer, f.w1), {
    code: "CURRENCY",
  });
  f.app.database
    .owned("catalog")
    .run("UPDATE catalog_products SET currency='CAD' WHERE id=?", p.ids[44]!);
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
      p.buyer.id,
    );
  for (const read of [
    () => resolve([]),
    () =>
      f.app.catalog.customerProductPage(p.buyer, f.buyer, undefined, "absent"),
    () => f.app.orders.orderEntry(p.buyer, f.buyer, f.w2),
    () => f.app.orders.cartPage(p.buyer),
  ])
    assert.throws(read, { code: "PASSWORD_CHANGE_REQUIRED" });
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_user_security SET password_change_required=0 WHERE user_id=?",
      p.buyer.id,
    );
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET account_id=NULL WHERE id=?", p.buyer.id);
  for (const read of [
    () => resolve([]),
    () => f.app.orders.orderEntry(p.buyer, f.buyer, f.w2),
    () => f.app.orders.cartPage(p.buyer),
  ])
    assert.throws(read, { code: "FORBIDDEN" });
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='warehouse' WHERE id=?", p.buyer.id);
  assert.throws(() => f.app.orders.cartPage({ ...p.buyer, role: "admin" }), {
    code: "FORBIDDEN",
  });
  assert.deepEqual(facts(f), before);
});
