import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.ts";
import { seedCustomerPricing } from "./customer-pricing-fixture.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import type { Actor } from "../src/server/core.ts";

function change(
  f: ReturnType<typeof fixture>,
  actor: Actor,
  changes: Record<string, unknown>,
) {
  const row = f.app.identity.users(f.actor).find((u) => u.id === actor.id)!;
  f.app.identity.updateUser(
    f.actor,
    `pricing-grant-${row.id}-${row.revision}`,
    {
      userId: actor.id,
      revision: row.revision,
      name: actor.name,
      email: row.email,
      role: actor.role,
      sites: actor.sites,
      accountId: actor.accountId ?? undefined,
      active: true,
      currentPassword: "long-test-only-password",
      reason: "Synthetic pricing access change",
      ...changes,
    },
  );
}
function facts(f: ReturnType<typeof fixture>, includeAudit = true) {
  return [
    ...["products", "prices"].map((n) =>
      f.app.database
        .owned("catalog")
        .all(`SELECT * FROM catalog_${n} ORDER BY rowid`),
    ),
    ...["commands", ...(includeAudit ? ["audit"] : []), "events"].map((n) =>
      f.app.database
        .owned("platform")
        .all(`SELECT * FROM platform_${n} ORDER BY rowid`),
    ),
    ...["carts", "quotes", "orders"].map((n) =>
      f.app.database
        .owned("orders")
        .all(`SELECT * FROM orders_${n} ORDER BY rowid`),
    ),
  ];
}

test("buyer dashboard never exposes catalog base prices when a tier price exists", (t) => {
  const f = fixture(t),
    p = seedCustomerPricing(f);
  const products = f.app.dashboard(p.buyer).products;
  assert.equal(products[0]!.unit_price, 8199);
  assert.equal("org_id" in products[0]!, false);
  assert.equal("active" in products[0]!, false);
});

test("customer catalog denies forced password changes and unassigned buyers without exposing base prices", (t) => {
  const f = fixture(t),
    p = seedCustomerPricing(f);
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET account_id=NULL WHERE id=?", p.buyer.id);
  // The existing sold-unit dashboard reader also refuses missing assignment.
  assert.throws(() => f.app.dashboard(p.buyer), { code: "VALIDATION" });
  assert.throws(
    () =>
      f.app.catalog.customerProducts(
        { ...p.buyer, role: "admin", accountId: f.buyer },
        f.buyer,
      ),
    { code: "FORBIDDEN" },
  );
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
      p.commercial.id,
    );
  const before = facts(f);
  assert.throws(() => f.app.catalog.customerProducts(p.commercial, f.buyer), {
    code: "PASSWORD_CHANGE_REQUIRED",
  });
  assert.deepEqual(facts(f), before);
});

test("customer catalog omits inactive/foreign products and refuses mixed currency without writes", (t) => {
  const f = fixture(t),
    p = seedCustomerPricing(f),
    store = f.app.database.owned("catalog");
  store.run(
    "INSERT INTO catalog_products VALUES(?,?,?,?,?,?,?,?,?)",
    "foreign-product",
    "foreign-org",
    "PRIVATE",
    "Synthetic foreign catalog",
    0,
    50,
    0,
    "CAD",
    1,
  );
  assert.deepEqual(
    f.app.catalog.customerProducts(p.buyer, f.buyer).map((r) => r.id),
    [f.product],
  );
  store.run("UPDATE catalog_products SET currency='USD' WHERE id=?", f.product);
  const before = facts(f);
  assert.throws(() => f.app.catalog.customerProducts(p.buyer, f.buyer), {
    code: "CURRENCY",
  });
  assert.deepEqual(facts(f), before);
});

test("customer catalog rejects unrelated staff and follows independent price/grant changes after restart", (t) => {
  const f = fixture(t),
    p = seedCustomerPricing(f);
  for (const role of ["finance", "warehouse", "warranty", "support"] as const)
    assert.throws(
      () => f.app.catalog.customerProducts(p.user(role, role), f.buyer),
      { code: "FORBIDDEN" },
    );
  const second = new Application(f.path, "CA");
  try {
    second.catalog.setPrice(f.actor, "independent-pricing", {
      productId: f.product,
      tier: "standard",
      unitPrice: 7700,
    });
    assert.equal(
      f.app.catalog.customerProducts(p.buyer, f.buyer)[0]!.unit_price,
      7700,
    );
    change({ ...f, app: second }, p.commercial, { role: "support", sites: [] });
  } finally {
    second.close();
  }
  assert.throws(() => f.app.catalog.customerProducts(p.commercial, f.buyer), {
    code: "FORBIDDEN",
  });
  f.app.close();
  f.app = new Application(f.path, "CA");
  assert.equal(f.app.dashboard(p.buyer).products[0]!.unit_price, 7700);
  assert.throws(() => f.app.catalog.customerProducts(p.commercial, f.buyer), {
    code: "FORBIDDEN",
  });
});

for (const region of ["CA", "US"] as const)
  test(`customer catalog and buyer dashboard use private tier prices (${region})`, (t) => {
    const f = fixture(t, {}, region),
      p = seedCustomerPricing(f),
      before = facts(f);
    const rows = f.app.catalog.customerProducts(p.buyer, f.buyer);
    assert.deepEqual(rows, [
      {
        id: f.product,
        sku: "EQ-1",
        name: "Synthetic equipment",
        serialized: 1,
        unit_price: 8199,
        unit_tax: 1066,
        tax_bp: 1300,
        currency: region === "CA" ? "CAD" : "USD",
      },
    ]);
    assert.deepEqual(f.app.dashboard(p.buyer).products, rows);
    assert.equal(f.app.dashboard(p.partner).products[0]!.unit_price, 4200);
    assert.equal(f.app.dashboard(f.actor).products[0]!.unit_price, 10000);
    assert.equal(
      f.app.catalog.customerProducts(p.commercial, p.other)[0]!.unit_price,
      4200,
    );
    assert.throws(() => f.app.catalog.customerProducts(p.buyer, p.other), {
      code: "FORBIDDEN",
    });
    assert.throws(() => f.app.catalog.customerProducts(p.partner, f.buyer), {
      code: "FORBIDDEN",
    });
    assert.deepEqual(facts(f), before);
  });

test("customer pricing keeps zero overrides and base fallback, and requires a renewed quote after price drift/restart", (t) => {
  const f = fixture(t),
    p = seedCustomerPricing(f);
  const free = f.app.catalog.create(f.actor, "free-product", {
    sku: "FREE",
    name: "Synthetic free accessory",
    serialized: false,
    unitPrice: 500,
    taxBasisPoints: 1300,
  }).id;
  f.app.catalog.setPrice(f.actor, "zero-price", {
    productId: free,
    tier: "standard",
    unitPrice: 0,
  });
  const fallback = f.app.catalog.create(f.actor, "fallback-product", {
    sku: "BASE",
    name: "Synthetic base accessory",
    serialized: false,
    unitPrice: 150,
    taxBasisPoints: 1300,
  }).id;
  const rows = f.app.catalog.customerProducts(p.buyer, f.buyer);
  assert.equal(rows.find((r) => r.id === free)!.unit_price, 0);
  assert.equal(rows.find((r) => r.id === free)!.unit_tax, 0);
  assert.equal(rows.find((r) => r.id === fallback)!.unit_price, 150);
  assert.equal(rows.find((r) => r.id === fallback)!.unit_tax, 20);
  const cart = f.app.orders.saveCart(p.buyer, "pricing-cart", {
    accountId: f.buyer,
    warehouseId: f.w1,
    revision: 0,
    lines: [{ productId: f.product, quantity: 2 }],
  });
  const quote = f.app.orders.quote(p.buyer, "pricing-quote", {
    cartId: cart.id,
    revision: cart.revision,
  });
  assert.equal(quote.total, 18530);
  f.app.catalog.setPrice(f.actor, "price-drift", {
    productId: f.product,
    tier: "standard",
    unitPrice: 9100,
  });
  f.app.close();
  f.app = new Application(f.path, "CA");
  assert.equal(
    f.app.catalog
      .customerProducts(p.buyer, f.buyer)
      .find((r) => r.id === f.product)!.unit_price,
    9100,
  );
  const before = facts(f);
  assert.throws(
    () =>
      f.app.orders.accept(p.buyer, "stale-pricing-accept", {
        quoteId: quote.id,
        allowBackorder: false,
      }),
    { code: "PRICE_CHANGED" },
  );
  assert.deepEqual(facts(f), before);
  const renewed = f.app.orders.quote(p.buyer, "renewed-pricing-quote", {
    cartId: cart.id,
    revision: cart.revision,
  });
  const accepted = f.app.orders.accept(p.buyer, "pricing-accept", {
    quoteId: renewed.id,
    allowBackorder: false,
  });
  const order = f.app.orders.order(p.buyer, accepted.id);
  const lines = f.app.orders.lines(p.buyer, accepted.id);
  assert.equal(order.total, 20566);
  assert.equal(lines[0]!.unit_price, 9100);
  assert.equal(lines[0]!.unit_tax, 1183);
  assert.equal(f.app.inventory.availability(f.actor, f.product, f.w1), 1);
});

test("customer pricing rechecks persisted account assignment and role before any projection", (t) => {
  const f = fixture(t),
    p = seedCustomerPricing(f);
  change(f, p.buyer, { accountId: p.other });
  assert.throws(() => f.app.catalog.customerProducts(p.buyer, f.buyer), {
    code: "FORBIDDEN",
  });
  assert.equal(
    f.app.catalog.customerProducts(p.buyer, p.other)[0]!.unit_price,
    4200,
  );
  assert.equal(f.app.dashboard(p.buyer).products[0]!.unit_price, 4200);
  change(f, p.buyer, { role: "support", accountId: undefined });
  const before = facts(f);
  assert.throws(
    () =>
      f.app.catalog.customerProducts({ ...p.buyer, role: "admin" }, p.other),
    { code: "FORBIDDEN" },
  );
  assert.deepEqual(facts(f), before);
  assert.equal(
    f.app.catalog.customerProducts(
      { ...p.commercial, role: "support" },
      p.other,
    )[0]!.unit_price,
    4200,
  );
});

test("customer pricing refuses inactive/foreign/missing principals and missing accounts even for an empty catalog", (t) => {
  const f = fixture(t),
    p = seedCustomerPricing(f);
  f.app.database.owned("catalog").run("UPDATE catalog_products SET active=0");
  assert.deepEqual(f.app.catalog.customerProducts(p.buyer, f.buyer), []);
  assert.throws(
    () => f.app.catalog.customerProducts(f.actor, "absent-customer"),
    { code: "NOT_FOUND" },
  );
  for (const actor of [
    { ...p.buyer, orgId: "foreign" },
    { ...p.buyer, id: "absent" },
  ])
    assert.throws(() => f.app.catalog.customerProducts(actor, f.buyer), {
      code: "FORBIDDEN",
    });
  change(f, p.buyer, { active: false });
  const before = facts(f);
  assert.throws(() => f.app.catalog.customerProducts(p.buyer, f.buyer), {
    code: "FORBIDDEN",
  });
  assert.deepEqual(facts(f), before);
});

test("HTTP customer pricing is scoped, no-store, strictly validated and revoked with sessions", async (t) => {
  const f = fixture(t),
    p = seedCustomerPricing(f),
    http = await createHttp(f.app, { origin: "http://localhost" });
  t.after(() => http.close());
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin: "http://localhost" },
    payload: {
      email: "pricing-buyer@example.test",
      password: "long-test-only-password",
    },
  });
  assert.equal(login.statusCode, 200);
  const headers = {
    cookie: `${login.cookies[0]!.name}=${login.cookies[0]!.value}`,
  };
  const url = `/api/catalog/customer-products?accountId=${f.buyer}`;
  assert.equal((await http.inject({ url })).statusCode, 401);
  const before = facts(f, false),
    own = await http.inject({ url, headers });
  assert.equal(own.statusCode, 200);
  assert.equal(own.headers["cache-control"], "no-store");
  assert.equal(own.json()[0].unit_price, 8199);
  const dashboard = await http.inject({ url: "/api/dashboard", headers });
  assert.deepEqual(dashboard.json().products, own.json());
  assert.equal(
    (
      await http.inject({
        url: `/api/catalog/customer-products?accountId=${p.other}`,
        headers,
      })
    ).statusCode,
    403,
  );
  for (const query of [
    "",
    "?accountId=",
    `?accountId=${f.buyer}&tier=partner`,
    `?accountId=${"x".repeat(129)}`,
  ])
    assert.equal(
      (
        await http.inject({
          url: `/api/catalog/customer-products${query}`,
          headers,
        })
      ).statusCode,
      400,
    );
  assert.deepEqual(facts(f, false), before);
  const deniedAudit = f.app.database
    .owned("platform")
    .all(
      "SELECT * FROM platform_audit WHERE action='authorization.denied' AND reference='/api/catalog/customer-products'",
    );
  assert.equal(deniedAudit.length, 1);
  assert.equal(deniedAudit[0]!.actor_id, p.buyer.id);
  change(f, p.buyer, { accountId: p.other });
  assert.equal((await http.inject({ url, headers })).statusCode, 401);
});
