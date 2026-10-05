import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture } from "./fixtures.ts";
import { seedCustomerPricing } from "./customer-pricing-fixture.ts";
import { createHttp } from "../src/server/http.ts";
import { Application } from "../src/server/application.ts";
import type {
  PricingPolicyInput,
  ProductMsrpInput,
} from "../src/shared/customer-pricing.ts";

type F = ReturnType<typeof fixture>;
const msrp = (f: F, value: number | null) =>
  f.app.catalog.setProductMsrp(
    f.actor,
    `msrp-${f.app.catalog.productMsrp(f.actor, f.product).revision}`,
    {
      ...f.app.catalog.productMsrp(f.actor, f.product),
      msrpCents: value,
      reason: "Reviewed manufacturer MSRP",
    },
  );
const policy = (f: F, patch: Partial<PricingPolicyInput>) =>
  f.app.catalog.setPricingPolicy(
    f.actor,
    `policy-${f.app.catalog.pricingPolicy(f.actor, f.buyer).revision}`,
    {
      ...f.app.catalog.pricingPolicy(f.actor, f.buyer),
      reason: "Reviewed customer terms",
      ...patch,
    },
  );
for (const region of ["CA", "US"] as const)
  test(`explicit MSRP multiplier is shared by browse, selected cart, quote, tax and immutable accepted sale (${region})`, (t) => {
    const f = fixture(t, {}, region),
      p = seedCustomerPricing(f);
    assert.equal(
      f.app.catalog.customerProducts(p.buyer, f.buyer)[0]!.unit_price,
      8199,
    );
    assert.deepEqual(f.app.catalog.pricingPolicy(f.actor, f.buyer), {
      accountId: f.buyer,
      multiplierBp: null,
      displayMode: "net_only",
      revision: 0,
    });
    msrp(f, 10001);
    policy(f, { multiplierBp: 5000, displayMode: "detailed" });
    const product = f.app.catalog.customerProducts(p.buyer, f.buyer)[0]!;
    assert.equal(product.unit_price, 5001);
    assert.equal(product.unit_tax, 650);
    assert.deepEqual(product.pricing, {
      msrpCents: 10001,
      discountBp: 5000,
      savingsCents: 5000,
    });
    assert.deepEqual(
      f.app.catalog.customerProductPage(p.buyer, f.buyer).items,
      [product],
    );
    assert.deepEqual(
      f.app.catalog.selectedCustomerProducts(p.buyer, f.buyer, [f.product]),
      [{ ...product, active: 1 }],
    );
    assert.deepEqual(f.app.dashboard(p.buyer).products, [product]);
    assert.equal(
      f.app.catalog.customerProducts(p.partner, p.other)[0]!.unit_price,
      4200,
    );
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
    assert.equal(quote.lines[0]!.unitPrice, 5001);
    assert.equal(quote.total, 11302);
    assert.equal("pricing" in quote.lines[0]!, false);
    const accepted = f.app.orders.accept(p.buyer, "pricing-accept", {
      quoteId: quote.id,
      allowBackorder: false,
    });
    msrp(f, 20000);
    policy(f, { multiplierBp: 2500, displayMode: "net_only" });
    assert.equal(f.app.orders.lines(p.buyer, accepted.id)[0]!.unit_price, 5001);
    assert.equal(f.app.orders.lines(p.buyer, accepted.id)[0]!.unit_tax, 650);
    assert.equal(
      "pricing" in f.app.catalog.customerProducts(p.buyer, f.buyer)[0]!,
      false,
    );
    assert.deepEqual(
      f.app.orders.quote(p.buyer, "pricing-quote", {
        cartId: cart.id,
        revision: cart.revision,
      }),
      quote,
    );
    policy(f, { multiplierBp: null });
    assert.equal(
      f.app.catalog.customerProducts(p.buyer, f.buyer)[0]!.unit_price,
      8199,
    );
    f.app.close();
    f.app = new Application(f.path, region);
    assert.equal(
      f.app.catalog.productMsrp(f.actor, f.product).msrpCents,
      20000,
    );
    assert.equal(
      f.app.catalog.pricingHistory(f.actor, { accountId: f.buyer }).items
        .length,
      3,
    );
  });

test("zero/full multiplier and tier zero remain exact; no fabricated positive savings above MSRP", (t) => {
  const f = fixture(t),
    p = seedCustomerPricing(f);
  msrp(f, 10001);
  policy(f, { multiplierBp: 0, displayMode: "detailed" });
  let row = f.app.catalog.customerProducts(p.buyer, f.buyer)[0]!;
  assert.equal(row.unit_price, 0);
  assert.equal(row.unit_tax, 0);
  assert.deepEqual(row.pricing, {
    msrpCents: 10001,
    savingsCents: 10001,
    discountBp: 10000,
  });
  policy(f, { multiplierBp: 10000 });
  row = f.app.catalog.customerProducts(p.buyer, f.buyer)[0]!;
  assert.equal(row.unit_price, 10001);
  assert.equal(row.pricing!.savingsCents, 0);
  policy(f, { multiplierBp: null });
  f.app.catalog.setPrice(f.actor, "free", {
    productId: f.product,
    tier: "standard",
    unitPrice: 0,
  });
  assert.equal(
    f.app.catalog.customerProducts(p.buyer, f.buyer)[0]!.unit_price,
    0,
  );
  f.app.catalog.setPrice(f.actor, "above", {
    productId: f.product,
    tier: "standard",
    unitPrice: 20000,
  });
  assert.equal(
    "pricing" in f.app.catalog.customerProducts(p.buyer, f.buyer)[0]!,
    false,
  );
});

test("missing MSRP refuses policy activation, filters new unpriceable products and keeps selected quantities removable", (t) => {
  const f = fixture(t),
    p = seedCustomerPricing(f);
  assert.throws(() => policy(f, { multiplierBp: 8000 }), {
    code: "PRICING_MSRP_REQUIRED",
  });
  assert.equal(f.app.catalog.pricingPolicy(f.actor, f.buyer).revision, 0);
  msrp(f, 10000);
  policy(f, { multiplierBp: 8000 });
  const other = f.app.catalog.create(f.actor, "unpriced", {
    sku: "NEW",
    name: "Missing MSRP",
    serialized: false,
    unitPrice: 1,
    taxBasisPoints: 1300,
  }).id;
  assert.deepEqual(
    f.app.catalog.customerProductPage(p.buyer, f.buyer).items.map((r) => r.id),
    [f.product],
  );
  assert.equal(f.app.dashboard(p.buyer).products.length, 1);
  assert.throws(() => f.app.catalog.price(p.buyer, other, f.buyer), {
    code: "PRICING_MSRP_REQUIRED",
  });
  const cart = f.app.orders.saveCart(p.buyer, "save", {
    accountId: f.buyer,
    warehouseId: f.w1,
    revision: 0,
    lines: [{ productId: f.product, quantity: 1 }],
  });
  msrp(f, null);
  const selected = f.app.orders.orderEntry(p.buyer, f.buyer, f.w1);
  assert.equal(selected.products[0]!.active, 0);
  assert.match(selected.products[0]!.unavailableReason!, /MSRP/);
  assert.equal(selected.cart!.lines[0]!.quantity, 1);
  assert.throws(
    () =>
      f.app.orders.quote(p.buyer, "blocked", {
        cartId: cart.id,
        revision: cart.revision,
      }),
    { code: "PRICING_MSRP_REQUIRED" },
  );
  const removed = f.app.orders.saveCart(p.buyer, "remove", {
    accountId: f.buyer,
    warehouseId: f.w1,
    revision: cart.revision,
    lines: [],
  });
  assert.equal(removed.revision, 2);
});

test("admin current-authority checks, revision, idempotency and append-only visible history", (t) => {
  const f = fixture(t),
    p = seedCustomerPricing(f);
  const input: ProductMsrpInput = {
    productId: f.product,
    msrpCents: 12345,
    revision: 0,
    reason: "Manufacturer price update",
  };
  for (const actor of [
    p.buyer,
    p.commercial,
    { ...p.buyer, role: "admin" as const },
  ]) {
    assert.throws(() => f.app.catalog.setProductMsrp(actor, "denied", input), {
      code: "FORBIDDEN",
    });
    assert.throws(
      () => f.app.catalog.pricingHistory(actor, { productId: f.product }),
      { code: "FORBIDDEN" },
    );
  }
  const result = f.app.catalog.setProductMsrp(f.actor, "exact", input);
  assert.deepEqual(
    f.app.catalog.setProductMsrp(f.actor, "exact", input),
    result,
  );
  assert.throws(
    () =>
      f.app.catalog.setProductMsrp(f.actor, "exact", {
        ...input,
        msrpCents: 9,
      }),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  assert.throws(() => f.app.catalog.setProductMsrp(f.actor, "stale", input), {
    code: "REVISION",
  });
  let history = f.app.catalog.pricingHistory(f.actor, { productId: f.product });
  assert.equal(history.items.filter((r) => r.kind === "msrp").length, 1);
  const change = history.items.find((r) => r.kind === "msrp")!;
  assert.deepEqual(change.before, {
    productId: f.product,
    msrpCents: null,
    revision: 0,
  });
  assert.deepEqual(change.after, result);
  assert.equal(change.reason, input.reason);
  assert.equal(change.actorId, f.actor.id);
  for (const value of [-1, 10001, 0.5, NaN, undefined])
    assert.throws(
      () => policy(f, { multiplierBp: value } as Partial<PricingPolicyInput>),
      { code: "VALIDATION" },
    );
  for (let i = 1; i <= 22; i++) msrp(f, 10000 + i);
  history = f.app.catalog.pricingHistory(f.actor, { productId: f.product });
  assert.equal(history.items.length, 20);
  assert.ok(history.next);
  const next = f.app.catalog.pricingHistory(f.actor, {
    productId: f.product,
    after: history.next!,
  });
  assert.equal(next.items.length, 5);
  assert.equal(
    new Set([...history.items, ...next.items].map((r) => r.id)).size,
    25,
  );
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='commercial' WHERE id=?", f.actor.id);
  assert.throws(() => f.app.catalog.setProductMsrp(f.actor, "exact", input), {
    code: "FORBIDDEN",
  });
});

test("HTTP policies/MSRP/history are admin-only with validated commands and buyer net-only payloads", async (t) => {
  const f = fixture(t),
    p = seedCustomerPricing(f),
    origin = "https://pricing.example.test",
    http = await createHttp(f.app, { origin });
  await http.ready();
  t.after(() => void http.close());
  async function login(email: string) {
    const r = await http.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: { email, password: "long-test-only-password" },
    });
    assert.equal(r.statusCode, 200);
    return {
      origin,
      cookie: `${r.cookies[0]!.name}=${r.cookies[0]!.value}`,
      "x-csrf-token": r.json().csrf as string,
    };
  }
  const admin = await login("admin@example.test"),
    buyer = await login("pricing-buyer@example.test");
  const input = {
    productId: f.product,
    msrpCents: 10000,
    revision: 0,
    reason: "HTTP MSRP",
  };
  for (const url of [
    `/api/catalog/pricing/${f.buyer}`,
    `/api/catalog/products/${f.product}/msrp`,
    `/api/catalog/pricing-history?productId=${f.product}`,
  ])
    assert.equal((await http.inject({ url, headers: buyer })).statusCode, 403);
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: "/api/commands/catalog.product-msrp.set",
        headers: { ...buyer, "idempotency-key": "denied" },
        payload: input,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: "/api/commands/catalog.product-msrp.set",
        headers: { origin, cookie: admin.cookie, "idempotency-key": "csrf" },
        payload: input,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: "/api/commands/catalog.product-msrp.set",
        headers: { ...admin, "idempotency-key": "http" },
        payload: input,
      })
    ).statusCode,
    200,
  );
  policy(f, { multiplierBp: 8000, displayMode: "detailed" });
  let response = await http.inject({
    url: `/api/catalog/customer-products?accountId=${f.buyer}`,
    headers: buyer,
  });
  assert.equal(response.json()[0].pricing.msrpCents, 10000);
  policy(f, { displayMode: "net_only" });
  response = await http.inject({
    url: `/api/catalog/customer-products/page?accountId=${f.buyer}`,
    headers: buyer,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().items[0].unit_price, 8000);
  assert.doesNotMatch(response.body, /msrp|savings|discount|multiplier/i);
  assert.match(String(response.headers["cache-control"]), /no-store/);
});
