import type { Owner } from "../src/server/database.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, accept, ship } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import type { Role } from "../src/server/core.ts";
const reason = "Synthetic operator review of product availability";
function input(f: ReturnType<typeof fixture>, productId: string = f.product) {
  return {
    productId,
    expectedHash: f.app.catalog.lifecycleReview(f.actor, productId)
      .expectedHash,
    reason,
  };
}
function user(f: ReturnType<typeof fixture>, role: Role) {
  const u = f.app.identity.createUser(f.actor, `life-${role}`, {
    name: role,
    email: `${role}@lifecycle.test`,
    password: "long-test-only-password",
    role,
    sites: [f.w1],
    accountId: f.buyer,
  });
  return f.app.identity.currentActor({ ...f.actor, id: u.id });
}
function schema(f: ReturnType<typeof fixture>) {
  return f.app.database
    .owned("platform")
    .all<{ type: string; name: string; sql: string }>(
      "SELECT type,name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name",
    );
}
function facts(f: ReturnType<typeof fixture>) {
  return schema(f)
    .filter((x) => x.type === "table" && !x.name.startsWith("sqlite_"))
    .map((x) => {
      const module = x.name.split("_")[0]! as Owner;
      return [
        x.name,
        f.app.database
          .owned(module)
          .all(`SELECT * FROM ${x.name} ORDER BY rowid`),
      ];
    });
}
for (const region of ["CA", "US"] as const)
  test(`catalog lifecycle ${region}: persisted retire/reactivate is exact, retains identifiers/prices and conserves native records`, (t) => {
    const f = fixture(t, {}, region),
      order = accept(f);
    const before = facts(f),
      retirement = input(f),
      originalSchema = schema(f);
    f.app.catalog.retire(f.actor, "retire", retirement);
    const after = facts(f);
    assert.equal(f.app.catalog.product(f.actor, f.product).active, 0);
    assert.equal(f.app.catalog.products(f.actor).length, 0);
    assert.equal(
      f.app.catalog.customerProductPage(f.actor, f.buyer).items.length,
      0,
    );
    assert.equal(
      f.app.orders.orderEntry(f.actor, f.buyer, f.w1).products[0]!.active,
      0,
    );
    assert.deepEqual(
      after.filter(
        (x) =>
          !String(x[0]).startsWith("catalog_") &&
          !String(x[0]).startsWith("platform_"),
      ),
      before.filter(
        (x) =>
          !String(x[0]).startsWith("catalog_") &&
          !String(x[0]).startsWith("platform_"),
      ),
    );
    assert.deepEqual(f.app.catalog.retire(f.actor, "retire", retirement), {
      id: f.product,
      active: 0,
    });
    assert.deepEqual(facts(f), after);
    f.app.close();
    f.app = new Application(f.path, region);
    assert.deepEqual(
      f.app.catalog
        .lifecycleHistory(f.actor, f.product)
        .items.map((x) => [x.fromActive, x.toActive, x.reason]),
      [[1, 0, reason]],
    );
    assert.deepEqual(schema(f), originalSchema);
    // Already accepted commitments remain fulfillable; catalog retirement does not cancel the order.
    ship(f, order.id);
    assert.equal(f.app.billing.invoices(f.actor).length, 1);
    const historical = f.app.billing.invoices(f.actor);
    f.app.catalog.reactivate(f.actor, "reactivate", input(f));
    assert.equal(
      f.app.catalog.customerProductPage(f.actor, f.buyer).items[0]!.unit_price,
      10000,
    );
    assert.deepEqual(f.app.billing.invoices(f.actor), historical);
    assert.equal(f.app.catalog.product(f.actor, f.product).sku, "EQ-1");
    assert.equal(
      f.app.catalog.lifecycleHistory(f.actor, f.product).items.length,
      2,
    );
  });

test("catalog retirement refuses both a new quote and an already-reviewed unaccepted quote", (t) => {
  const f = fixture(t),
    cart = f.app.orders.saveCart(f.actor, "cart", {
      accountId: f.buyer,
      warehouseId: f.w1,
      revision: 0,
      lines: [{ productId: f.product, quantity: 1 }],
    }),
    quote = f.app.orders.quote(f.actor, "quote", {
      cartId: cart.id,
      revision: cart.revision,
    });
  f.app.catalog.retire(f.actor, "retire", input(f));
  const before = facts(f);
  assert.throws(
    () =>
      f.app.orders.quote(f.actor, "newquote", {
        cartId: cart.id,
        revision: cart.revision,
      }),
    { code: "PRODUCT" },
  );
  assert.throws(
    () =>
      f.app.orders.accept(f.actor, "accept", {
        quoteId: quote.id,
        allowBackorder: false,
      }),
    { code: "PRODUCT" },
  );
  assert.deepEqual(facts(f), before);
});

test("catalog review rejects changed prices and ABA lifecycle drift; cached requests preserve original outcomes", (t) => {
  const f = fixture(t),
    stale = input(f);
  f.app.catalog.retire(f.actor, "first", stale);
  f.app.catalog.reactivate(f.actor, "second", input(f));
  const before = facts(f);
  assert.throws(() => f.app.catalog.retire(f.actor, "stale", stale), {
    code: "REVIEW_CHANGED",
  });
  assert.deepEqual(facts(f), before);
  assert.deepEqual(f.app.catalog.retire(f.actor, "first", stale), {
    id: f.product,
    active: 0,
  });
  assert.equal(f.app.catalog.product(f.actor, f.product).active, 1);
  assert.throws(
    () =>
      f.app.catalog.retire(f.actor, "first", {
        ...stale,
        reason: "Different reason",
      }),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  const reviewed = input(f);
  f.app.database
    .owned("catalog")
    .run(
      "UPDATE catalog_products SET unit_price=unit_price+1 WHERE id=?",
      f.product,
    );
  assert.throws(() => f.app.catalog.retire(f.actor, "price-drift", reviewed), {
    code: "REVIEW_CHANGED",
  });
});

test("catalog lifecycle rejects unavailable, demoted and forced-password principals before cached outcomes", (t) => {
  const f = fixture(t),
    commercial = user(f, "commercial"),
    reviewed = input(f);
  f.app.catalog.retire(commercial, "retire", reviewed);
  for (const change of ["role", "password", "active"] as const) {
    const iam = f.app.database.owned("iam");
    if (change === "role")
      iam.run("UPDATE iam_users SET role='support' WHERE id=?", commercial.id);
    else if (change === "password") {
      iam.run(
        "UPDATE iam_users SET role='commercial' WHERE id=?",
        commercial.id,
      );
      iam.run(
        "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
        commercial.id,
      );
    } else {
      iam.run(
        "UPDATE iam_user_security SET password_change_required=0 WHERE user_id=?",
        commercial.id,
      );
      iam.run("UPDATE iam_users SET active=0 WHERE id=?", commercial.id);
    }
    const before = facts(f);
    for (const read of [
      () => f.app.catalog.lifecycleReview(commercial, f.product),
      () => f.app.catalog.lifecycleHistory(commercial, f.product),
      () => f.app.catalog.retire(commercial, "retire", reviewed),
      () => f.app.catalog.reactivate(commercial, "new", reviewed),
    ])
      assert.throws(read, {
        code: change === "password" ? "PASSWORD_CHANGE_REQUIRED" : "FORBIDDEN",
      });
    assert.deepEqual(facts(f), before);
  }
});

test("catalog staff projection and lifecycle deny buyers, foreign products/cursors and malformed reviews without effects", (t) => {
  const f = fixture(t),
    buyer = user(f, "buyer");
  const before = facts(f);
  for (const operation of [
    () => f.app.catalog.productPage(buyer),
    () => f.app.catalog.lifecycleReview(buyer, f.product),
    () => f.app.catalog.lifecycleHistory(buyer, f.product),
    () => f.app.catalog.retire({ ...buyer, role: "admin" }, "forged", input(f)),
  ])
    assert.throws(operation, { code: "FORBIDDEN" });
  for (const value of ["", "x".repeat(1001)])
    assert.throws(
      () =>
        f.app.catalog.retire(f.actor, "invalid", {
          ...input(f),
          reason: value,
        }),
      { code: "VALIDATION" },
    );
  assert.throws(
    () =>
      f.app.catalog.retire(f.actor, "bad-hash", {
        ...input(f),
        expectedHash: "bad",
      }),
    { code: "VALIDATION" },
  );
  assert.throws(
    () => f.app.catalog.lifecycleHistory(f.actor, f.product, "foreign-cursor"),
    { code: "CURSOR" },
  );
  assert.throws(
    () => f.app.catalog.lifecycleReview(f.actor, "foreign-product"),
    { code: "NOT_FOUND" },
  );
  assert.throws(() => f.app.catalog.productPage(f.actor, "foreign-cursor"), {
    code: "CURSOR",
  });
  assert.throws(
    () => f.app.catalog.productPage(f.actor, undefined, "", "invalid"),
    { code: "VALIDATION" },
  );
  assert.throws(
    () => f.app.catalog.reactivate(f.actor, "already-active", input(f)),
    { code: "PRODUCT_STATE" },
  );
  assert.deepEqual(facts(f), before);
});

test("catalog lifecycle pages use durable sequence across timestamp ties, append, restart and product scope", (t) => {
  const f = fixture(t);
  for (let n = 0; n < 25; n++)
    (n % 2
      ? f.app.catalog.reactivate.bind(f.app.catalog)
      : f.app.catalog.retire.bind(f.app.catalog))(f.actor, `change-${n}`, {
      ...input(f),
      reason: `Synthetic lifecycle ${n}`,
    });
  f.app.database
    .owned("platform")
    .run(
      "UPDATE platform_audit SET created_at='2026-10-02T00:00:00.000Z' WHERE action='product.lifecycle'",
    );
  const first = f.app.catalog.lifecycleHistory(f.actor, f.product);
  assert.equal(first.items.length, 20);
  assert.ok(first.next);
  f.app.catalog.reactivate(f.actor, "append", input(f));
  f.app.close();
  f.app = new Application(f.path, "CA");
  const second = f.app.catalog.lifecycleHistory(
    f.actor,
    f.product,
    first.next!,
  );
  assert.equal(second.items.length, 5);
  assert.equal(second.next, null);
  assert.equal(
    new Set([...first.items, ...second.items].map((x) => x.id)).size,
    25,
  );
  assert.equal(second.items.at(-1)!.reason, "Synthetic lifecycle 0");
  const other = f.app.catalog.create(f.actor, "other", {
    sku: "OTHER",
    name: "Other",
    serialized: false,
    unitPrice: 0,
    taxBasisPoints: 0,
  }).id;
  assert.throws(
    () => f.app.catalog.lifecycleHistory(f.actor, other, first.next!),
    { code: "CURSOR" },
  );
  f.app.database
    .owned("platform")
    .run(
      "UPDATE platform_audit SET detail='corrupt' WHERE id=?",
      first.items[0]!.id,
    );
  assert.throws(() => f.app.catalog.lifecycleReview(f.actor, f.product), {
    code: "HISTORY_INTEGRITY",
  });
});

test("staff catalog search and active/retired paging retain inactive anchors", (t) => {
  const f = fixture(t),
    ids = [];
  for (let n = 0; n < 43; n++)
    ids.push(
      f.app.catalog.create(f.actor, `page-${n}`, {
        sku: `AAA-${String(n).padStart(2, "0")}`,
        name: n === 42 ? "Literal %_ item" : `Item ${n}`,
        serialized: false,
        unitPrice: 1,
        taxBasisPoints: 0,
      }).id,
    );
  const first = f.app.catalog.productPage(f.actor);
  assert.equal(first.items.length, 20);
  f.app.catalog.retire(f.actor, "anchor", input(f, first.next!));
  const second = f.app.catalog.productPage(f.actor, first.next!);
  assert.equal(second.items.length, 20);
  assert.equal(
    new Set([...first.items, ...second.items].map((x) => x.id)).size,
    40,
  );
  assert.deepEqual(
    f.app.catalog
      .productPage(f.actor, undefined, "%_", "all")
      .items.map((x) => x.id),
    [ids[42]],
  );
  assert.equal(
    f.app.catalog.productPage(f.actor, undefined, "", "retired").items.length,
    1,
  );
  assert.ok(first.items.every((x) => !("org_id" in x)));
});

test("HTTP catalog lifecycle schemas, no-store responses and scoped commands use the actual session", async (t) => {
  const f = fixture(t),
    origin = "http://127.0.0.1:3117",
    http = await createHttp(f.app, { origin });
  t.after(() => http.close());
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: {
      email: "admin@example.test",
      password: "long-test-only-password",
    },
  });
  const cookie = login.headers["set-cookie"]!.toString().split(";")[0]!;
  const headers = {
    cookie,
    origin,
    "x-csrf-token": login.json().csrf,
    "idempotency-key": "http-retire",
  };
  const review = await http.inject({
    method: "GET",
    url: `/api/catalog/products/${f.product}/review`,
    headers: { cookie },
  });
  assert.equal(review.statusCode, 200);
  assert.equal(review.headers["cache-control"], "no-store");
  const retired = await http.inject({
    method: "POST",
    url: "/api/commands/product.retire",
    headers,
    payload: {
      productId: f.product,
      expectedHash: review.json().expectedHash,
      reason,
    },
  });
  assert.equal(retired.statusCode, 200, retired.body);
  assert.equal(
    (
      await http.inject({
        method: "GET",
        url: "/api/catalog/products/page?state=retired&q=EQ",
        headers: { cookie },
      })
    ).json().items.length,
    1,
  );
  const before = facts(f);
  for (const url of [
    "/api/catalog/products/page?state=bad",
    "/api/catalog/products/page?after=",
    "/api/catalog/products/page?extra=x",
    `/api/catalog/products/${f.product}/history?extra=x`,
  ])
    assert.equal(
      (await http.inject({ method: "GET", url, headers: { cookie } }))
        .statusCode,
      400,
      url,
    );
  assert.deepEqual(facts(f), before);
});
