import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture, accept } from "./fixtures.ts";
import type { Actor, Role } from "../src/server/core.ts";
import { createHttp } from "../src/server/http.ts";
import type { ProductAvailabilityInput } from "../src/shared/product-availability.ts";

type Fixture = ReturnType<typeof fixture>;
function user(f: Fixture, role: Role) {
  const u = f.app.identity.createUser(f.actor, `availability-${role}`, {
    name: role,
    email: `${role}@availability.test`,
    password: "long-test-only-password",
    role,
    sites: role === "buyer" ? [] : [f.w1],
    accountId: f.buyer,
  });
  return f.app.identity.currentActor({ ...f.actor, id: u.id });
}
function change(
  f: Fixture,
  patch: Partial<ProductAvailabilityInput>,
  key?: string,
) {
  const before = f.app.catalog.productAvailability(f.actor, f.product);
  return f.app.catalog.setProductAvailability(
    f.actor,
    key ?? `availability-${before.revision}`,
    { ...before, reason: "Synthetic product availability review", ...patch },
  );
}
function quote(f: Fixture, actor: Actor = f.actor) {
  const previous = f.app.orders.orderEntry(actor, f.buyer, f.w1).cart;
  const cart = f.app.orders.saveCart(actor, `cart-${previous?.revision ?? 0}`, {
    accountId: f.buyer,
    warehouseId: f.w1,
    revision: previous?.revision ?? 0,
    lines: [{ productId: f.product, quantity: 1 }],
  });
  return {
    cart,
    q: f.app.orders.quote(actor, `quote-${cart.revision}`, {
      cartId: cart.id,
      revision: cart.revision,
    }),
  };
}
function facts(f: Fixture) {
  return [
    f.app.database.owned("orders").all("SELECT * FROM orders_orders"),
    f.app.database.owned("orders").all("SELECT * FROM orders_lines"),
    f.app.database.owned("inventory").all("SELECT * FROM inventory_units"),
    f.app.database.owned("inventory").all("SELECT * FROM inventory_movements"),
    f.app.database
      .owned("inventory")
      .all("SELECT * FROM inventory_allocations"),
    f.app.database.owned("billing").all("SELECT * FROM billing_holds"),
  ];
}

test("global hiding closes browse, direct product/media/price, cart, stale quote and staff-on-behalf; unhide preserves account restrictions", (t) => {
  const f = fixture(t),
    b = user(f, "buyer"),
    { cart, q } = quote(f, b);
  const before = facts(f);
  change(f, { hidden: true });
  assert.deepEqual(f.app.catalog.customerProducts(b, f.buyer), []);
  assert.deepEqual(f.app.catalog.products(b), []);
  assert.deepEqual(
    f.app.catalog.customerProductPage(b, f.buyer, undefined, "EQ-1").items,
    [],
  );
  assert.equal(
    f.app.catalog.productPage(f.actor).items[0]!.availability!.hidden,
    true,
  );
  for (const read of [
    () => f.app.catalog.product(b, f.product),
    () => f.app.catalog.authorizeResourceAccess(b, f.product),
    () => f.app.catalog.price(b, f.product, f.buyer),
    () => f.app.catalog.selectedCustomerProducts(b, f.buyer, [f.product]),
    () => f.app.orders.orderEntry(b, f.buyer, f.w1),
  ])
    assert.throws(read, { code: "PRODUCT_ACCESS" });
  for (const actor of [b, f.actor]) {
    assert.throws(
      () =>
        f.app.orders.saveCart(actor, `hidden-cart-${actor.id}`, {
          accountId: f.buyer,
          warehouseId: f.w1,
          revision: cart.revision,
          lines: [{ productId: f.product, quantity: 1 }],
        }),
      { code: "PRODUCT_ACCESS" },
    );
    assert.throws(
      () =>
        f.app.orders.quote(actor, `hidden-quote-${actor.id}`, {
          cartId: cart.id,
          revision: cart.revision,
        }),
      { code: "PRODUCT_ACCESS" },
    );
    assert.throws(
      () =>
        f.app.orders.accept(actor, `hidden-accept-${actor.id}`, {
          quoteId: q.id,
          allowBackorder: false,
        }),
      { code: "PRODUCT_ACCESS" },
    );
  }
  assert.throws(
    () =>
      f.app.orders.quote(b, `quote-${cart.revision}`, {
        cartId: cart.id,
        revision: cart.revision,
      }),
    { code: "PRODUCT_ACCESS" },
  );
  assert.deepEqual(facts(f), before);
  const policy = f.app.catalog.purchasingPolicy(f.actor, f.buyer);
  f.app.catalog.setPurchasingPolicy(f.actor, "revoke", {
    ...policy,
    mode: "none",
    reason: "Synthetic grant revoked",
  });
  change(f, { hidden: false });
  assert.deepEqual(f.app.catalog.customerProducts(b, f.buyer), []);
});

test("availability badge and expected date are advisory and preserve warehouse balances and ordering", (t) => {
  const f = fixture(t),
    b = user(f, "buyer"),
    before = facts(f);
  const availability = change(f, {
    outOfStock: true,
    expectedAvailableOn: "2027-02-28",
  });
  assert.equal(availability.revision, 1);
  assert.deepEqual(facts(f), before);
  for (const product of [
    f.app.catalog.customerProducts(b, f.buyer)[0]!,
    f.app.catalog.customerProductPage(b, f.buyer).items[0]!,
    f.app.catalog.selectedCustomerProducts(b, f.buyer, [f.product])[0]!,
  ]) {
    assert.equal(product.outOfStock, true);
    assert.equal(product.expectedAvailableOn, "2027-02-28");
  }
  const order = accept(f);
  assert.equal(order.status, "accepted");
  change(f, { hidden: true });
  assert.equal(f.app.orders.order(b, order.id).id, order.id);
  assert.equal(f.app.orders.lines(b, order.id).length, 1);
  assert.equal(f.app.orders.list(b).length, 1);
  change(f, { hidden: false, outOfStock: false, expectedAvailableOn: null });
  assert.equal(
    f.app.catalog.customerProducts(b, f.buyer)[0]!.outOfStock,
    false,
  );
});

test("hiding after submission prevents pending approval with zero financial or inventory effects, but retains request history", (t) => {
  const f = fixture(t),
    b = user(f, "buyer"),
    p = f.app.catalog.purchasingPolicy(f.actor, f.buyer);
  f.app.catalog.setPurchasingPolicy(f.actor, "review-required", {
    ...p,
    requiresReview: true,
    reason: "Synthetic review",
  });
  const { q } = quote(f, b),
    pending = f.app.orders.accept(b, "pending", {
      quoteId: q.id,
      allowBackorder: false,
    });
  assert.equal(pending.status, "awaiting_approval");
  const before = facts(f);
  change(f, { hidden: true });
  const request = f.app.orders.reviewRequest(f.actor, pending.id);
  assert.throws(
    () =>
      f.app.orders.decideReview(f.actor, "approve-hidden", {
        requestId: request.id,
        revision: request.revision,
        expectedHash: request.expectedHash,
        action: "approve",
        message: "Reviewed",
        staffNote: "",
      }),
    { code: "PRODUCT_ACCESS" },
  );
  assert.deepEqual(facts(f), before);
  assert.equal(
    f.app.orders.reviewRequest(b, request.id).status,
    "awaiting_approval",
  );
  assert.equal(
    f.app.orders.withdrawReview(b, "withdraw-hidden", {
      requestId: request.id,
      revision: request.revision,
    }).status,
    "withdrawn",
  );
});

test("admin availability uses fresh identity, tenant scoping, revision, exact replay, valid dates and one audit", (t) => {
  const f = fixture(t),
    b = user(f, "buyer"),
    commercial = user(f, "commercial");
  const input = {
    ...f.app.catalog.productAvailability(f.actor, f.product),
    hidden: true,
    reason: "Synthetic hide",
  };
  for (const actor of [
    b,
    commercial,
    { ...commercial, role: "admin" as const },
  ]) {
    assert.throws(() => f.app.catalog.productAvailability(actor, f.product), {
      code: "FORBIDDEN",
    });
    assert.throws(
      () => f.app.catalog.setProductAvailability(actor, "deny", input),
      { code: "FORBIDDEN" },
    );
  }
  assert.throws(() =>
    f.app.catalog.productAvailability(
      { ...f.actor, orgId: "foreign" },
      f.product,
    ),
  );
  assert.throws(
    () =>
      f.app.catalog.setProductAvailability(f.actor, "unknown", {
        ...input,
        productId: "foreign-product",
      }),
    { code: "NOT_FOUND" },
  );
  const result = f.app.catalog.setProductAvailability(f.actor, "exact", input);
  assert.deepEqual(
    f.app.catalog.setProductAvailability(f.actor, "exact", input),
    result,
  );
  assert.throws(
    () =>
      f.app.catalog.setProductAvailability(f.actor, "exact", {
        ...input,
        hidden: false,
      }),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  assert.throws(
    () => f.app.catalog.setProductAvailability(f.actor, "stale", input),
    { code: "REVISION" },
  );
  for (const expectedAvailableOn of [
    "2027-02-29",
    "2026-13-01",
    "tomorrow",
    undefined,
  ])
    assert.throws(
      () =>
        change(
          f,
          { expectedAvailableOn } as Partial<ProductAvailabilityInput>,
          `date-${expectedAvailableOn}`,
        ),
      { code: "VALIDATION" },
    );
  const audits = f.app.database
    .owned("platform")
    .all<{ detail: string }>(
      "SELECT detail FROM platform_audit WHERE action='catalog.product-availability.changed'",
    );
  assert.equal(audits.length, 1);
  assert.equal(JSON.parse(audits[0]!.detail).before.hidden, false);
  assert.equal(JSON.parse(audits[0]!.detail).availability.hidden, true);
});

test("HTTP availability command requires administrator and CSRF; buyer catalog reflects changes immediately", async (t) => {
  const f = fixture(t);
  user(f, "buyer");
  user(f, "commercial");
  const origin = "https://availability.example.test",
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
    buyer = await login("buyer@availability.test"),
    commercial = await login("commercial@availability.test");
  const path = `/api/catalog/products/${f.product}/availability`,
    url = "/api/commands/catalog.product-availability.set";
  const get = await http.inject({ url: path, headers: admin });
  assert.equal(get.statusCode, 200);
  const payload = {
    ...get.json(),
    hidden: true,
    outOfStock: true,
    expectedAvailableOn: "2027-01-20",
    reason: "Synthetic HTTP control",
  };
  for (const headers of [buyer, commercial]) {
    assert.equal((await http.inject({ url: path, headers })).statusCode, 403);
    assert.equal(
      (
        await http.inject({
          method: "POST",
          url,
          headers: { ...headers, "idempotency-key": "denied" },
          payload,
        })
      ).statusCode,
      403,
    );
  }
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url,
        headers: { origin, cookie: admin.cookie, "idempotency-key": "no-csrf" },
        payload,
      })
    ).statusCode,
    403,
  );
  const result = await http.inject({
    method: "POST",
    url,
    headers: { ...admin, "idempotency-key": "hide" },
    payload,
  });
  assert.equal(result.statusCode, 200, result.body);
  assert.deepEqual(
    f.app.catalog.customerProducts(
      f.app.identity.currentActor({
        ...f.actor,
        id: f.app.identity
          .users(f.actor)
          .find((u) => u.email === "buyer@availability.test")!.id as string,
      }),
      f.buyer,
    ),
    [],
  );
  const invalid = await http.inject({
    method: "POST",
    url,
    headers: { ...admin, "idempotency-key": "invalid" },
    payload: { ...payload, revision: 1, expectedAvailableOn: "2027-02-30" },
  });
  assert.equal(invalid.statusCode, 400);
});
