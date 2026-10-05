import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";
test("HTTP buyer submission stays pending until authorized distributor decision; scoped queue and exact replay", async (t) => {
  const f = fixture(t),
    origin = "https://purchasing.example.test",
    password = "long-test-only-password";
  f.app.identity.createUser(f.actor, "buyer-http", {
    name: "Buyer",
    email: "buyer@purchase.test",
    password,
    role: "buyer",
    accountId: f.buyer,
    sites: [],
  });
  const http = await createHttp(f.app, { origin });
  await http.ready();
  t.after(() => void http.close());
  async function login(email: string) {
    const r = await http.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: { email, password },
    });
    assert.equal(r.statusCode, 200);
    return {
      origin,
      cookie: `${r.cookies[0]!.name}=${r.cookies[0]!.value}`,
      "x-csrf-token": r.json().csrf as string,
    };
  }
  const admin = await login("admin@example.test"),
    buyer = await login("buyer@purchase.test");
  const command = (
    headers: Record<string, string>,
    name: string,
    key: string,
    payload: Record<string, unknown>,
  ) =>
    http.inject({
      method: "POST",
      url: `/api/commands/${name}`,
      headers: { ...headers, "idempotency-key": key },
      payload,
    });
  const policy = (
    await http.inject({
      url: `/api/catalog/purchasing/${f.buyer}`,
      headers: admin,
    })
  ).json();
  let r = await command(buyer, "catalog.purchasing.set", "deny-grant", {
    ...policy,
    requiresReview: true,
    reason: "Unauthorized buyer policy",
  });
  assert.equal(r.statusCode, 403);
  r = await command(admin, "catalog.purchasing.set", "grant-review", {
    ...policy,
    requiresReview: true,
    reason: "Synthetic HTTP review policy",
  });
  assert.equal(r.statusCode, 200, r.body);
  r = await command(buyer, "cart.save", "save", {
    accountId: f.buyer,
    warehouseId: f.w1,
    revision: 0,
    lines: [{ productId: f.product, quantity: 1 }],
  });
  assert.equal(r.statusCode, 200, r.body);
  const cart = r.json();
  r = await command(buyer, "cart.quote", "quote", {
    cartId: cart.id,
    revision: cart.revision,
  });
  assert.equal(r.statusCode, 200, r.body);
  const q = r.json();
  assert.equal(q.requiresReview, true);
  r = await command(buyer, "order.accept", "submit", {
    quoteId: q.id,
    allowBackorder: false,
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().status, "awaiting_approval");
  const id = r.json().requestId;
  assert.equal(f.app.orders.list(f.actor).length, 0);
  const detail = await http.inject({
    url: `/api/order-requests/${id}`,
    headers: buyer,
  });
  assert.equal(detail.statusCode, 200, detail.body);
  const request = detail.json();
  const decision = {
    requestId: id,
    revision: request.revision,
    expectedHash: request.expectedHash,
    action: "approve",
    message: "Approved by distributor",
    staffNote: "Private staff note",
  };
  r = await command(buyer, "order.review.decide", "buyer-approve", decision);
  assert.equal(r.statusCode, 403);
  r = await command(admin, "order.review.decide", "approve", decision);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().status, "accepted");
  const replay = await command(
    admin,
    "order.review.decide",
    "approve",
    decision,
  );
  assert.deepEqual(replay.json(), r.json());
  assert.equal(f.app.orders.list(f.actor).length, 1);
  const visible = (
    await http.inject({ url: `/api/order-requests/${id}`, headers: buyer })
  ).json();
  assert.ok(
    visible.history.every((h: Record<string, unknown>) => !("staffNote" in h)),
  );
  assert.equal(visible.orderId, r.json().orderId);
  const queue = await http.inject({
    url: "/api/order-requests",
    headers: buyer,
  });
  assert.equal(queue.statusCode, 200);
  assert.equal(queue.json().items.length, 1);
  assert.equal(
    (await http.inject({ url: `/api/order-requests/${id}` })).statusCode,
    401,
  );
});
