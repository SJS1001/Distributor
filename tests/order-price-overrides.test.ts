import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, ship } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import type { Actor, Role } from "../src/server/core.ts";
type F = ReturnType<typeof fixture>;
function user(f: F, role: Role, name: string = role): Actor {
  const u = f.app.identity.createUser(f.actor, name, {
    name,
    email: name + "@example.test",
    password: "long-test-only-password",
    role,
    sites: role === "buyer" ? [] : [f.w1],
    ...(role === "buyer" ? { accountId: f.buyer } : {}),
  });
  return f.app.identity.currentActor({ ...f.actor, id: u.id });
}
function cart(f: F) {
  return f.app.orders.saveCart(f.actor, "cart", {
    accountId: f.buyer,
    warehouseId: f.w1,
    revision: 0,
    lines: [{ productId: f.product, quantity: 1 }],
  });
}
function configure(f: F) {
  f.app.catalog.setPriceApprovalPolicy(f.actor, "guardrails", {
    revision: 0,
    maxDiscountBp: 2000,
    minMarginBp: 2000,
    reason: "Reviewed commercial guardrails",
  });
  f.app.catalog.setReviewedUnitCost(f.actor, "cost", {
    productId: f.product,
    revision: 0,
    unitCostCents: 6000,
    reason: "Reviewed product replacement cost",
  });
}
function input(
  f: F,
  c: ReturnType<typeof cart>,
  unitPrice = 9000,
  revision = 0,
) {
  return {
    cartId: c.id,
    cartRevision: c.revision,
    productId: f.product,
    revision,
    unitPrice,
    reason: "One-off customer offer",
  };
}
function quote(f: F, c: ReturnType<typeof cart>, key = "quote") {
  return f.app.orders.quote(f.actor, key, {
    cartId: c.id,
    revision: c.revision,
  });
}
test("mandatory MFA blocks direct override authority and incomplete historical approvers at buyer acceptance", (t) => {
  const f = fixture(t),
    c = cart(f),
    buyer = user(f, "buyer"),
    admin2 = user(f, "admin", "approver"),
    proposal = input(f, c),
    r = f.app.orders.priceOverrides.set(f.actor, "offer", proposal),
    decision = {
      ...proposal,
      revision: r.revision,
      decision: "approve" as const,
    };
  f.app.orders.priceOverrides.decide(admin2, "approved", decision);
  const q = quote(f, c);
  f.app.close();
  f.app = new Application(f.path, "CA", {
    mfaEncryptionKey: "ab".repeat(32),
    mfaRequiredRoles: ["admin"],
  });
  for (const operation of [
    () => f.app.orders.priceOverrides.cart(f.actor, c.id),
    () => f.app.orders.priceOverrides.set(f.actor, "offer", proposal),
    () => f.app.orders.priceOverrides.decide(admin2, "approved", decision),
    () =>
      f.app.orders.priceOverrides.clear(f.actor, "clear", {
        ...proposal,
        revision: 2,
      }),
    () =>
      f.app.database.transaction(() =>
        f.app.orders.priceOverrides.resolve(f.actor, c.id),
      ),
  ])
    assert.throws(operation, { code: "MFA_ENROLLMENT_REQUIRED" });
  assert.throws(
    () =>
      f.app.orders.quote(buyer, "buyer-quote", {
        cartId: c.id,
        revision: c.revision,
      }),
    { code: "PRICE_OVERRIDE_CHANGED" },
  );
  assert.throws(
    () =>
      f.app.orders.accept(buyer, "buyer-accept", {
        quoteId: q.id,
        allowBackorder: false,
      }),
    { code: "PRICE_OVERRIDE_CHANGED" },
  );
  assert.equal(
    f.app.database
      .owned("orders")
      .get("SELECT COUNT(*) AS n FROM orders_orders")!.n,
    0,
  );
  assert.equal(
    f.app.database
      .owned("orders")
      .get("SELECT COUNT(*) AS n FROM orders_price_overrides")!.n,
    2,
  );
});
test("within-policy one-off override survives restart/retry, freezes sale/credit and cannot be reused", (t) => {
  const f = fixture(t),
    c = cart(f);
  configure(f);
  const commercial = user(f, "commercial");
  const proposed = f.app.orders.priceOverrides.set(
    commercial,
    "offer",
    input(f, c),
  );
  assert.equal(proposed.status, "active");
  assert.deepEqual(
    f.app.orders.priceOverrides.set(commercial, "offer", input(f, c)),
    proposed,
  );
  const q = quote(f, c);
  assert.equal(q.total, 10170);
  assert.equal(q.lines[0]!.unitPrice, 9000);
  assert.equal(
    (q.lines[0] as { ordinaryUnitPrice: number }).ordinaryUnitPrice,
    10000,
  );
  assert.doesNotMatch(
    JSON.stringify(q),
    /unitCost|authorityHash|minMargin|assessment/,
  );
  f.app.close();
  f.app = new Application(f.path);
  const o = f.app.orders.accept(f.actor, "accept", {
    quoteId: q.id,
    allowBackorder: false,
  });
  assert.deepEqual(
    f.app.orders.accept(f.actor, "accept", {
      quoteId: q.id,
      allowBackorder: false,
    }),
    o,
  );
  assert.throws(() => quote(f, c, "used"), { code: "PRICE_OVERRIDE_CHANGED" });
  const inv = f.app.billing.invoice(f.actor, ship(f, o.id).invoiceId);
  assert.equal(inv.total, 10170);
  f.app.catalog.setPrice(f.actor, "ordinary-change", {
    productId: f.product,
    tier: "standard",
    unitPrice: 12000,
  });
  const line = f.app.billing.lines(f.actor, inv.id)[0]!;
  const credit = f.app.billing.issueCredit(f.actor, "credit", {
    invoiceId: inv.id,
    reference: "OVERRIDE-CREDIT",
    reason: "Reviewed return",
    lines: [{ lineId: line.id, quantity: 1 }],
  });
  assert.equal(credit.total, 10170);
  assert.equal(f.app.orders.lines(f.actor, o.id)[0]!.unit_price, 9000);
  f.app.orders.priceOverrides.clear(commercial, "clear", {
    ...input(f, c),
    revision: proposed.revision,
  });
  assert.equal(quote(f, c, "ordinary").total, 13560);
});
test("unconfigured, missing cost and zero-price require separate current admin; pending/rejected block quoting", (t) => {
  const f = fixture(t),
    c = cart(f),
    admin2 = user(f, "admin", "admin2");
  let result = f.app.orders.priceOverrides.set(f.actor, "missing", input(f, c));
  assert.equal(result.status, "pending");
  assert.throws(() => quote(f, c), { code: "PRICE_OVERRIDE_PENDING" });
  const decision = {
    ...input(f, c),
    revision: result.revision,
    decision: "approve" as const,
  };
  assert.throws(
    () => f.app.orders.priceOverrides.decide(f.actor, "self", decision),
    { code: "SEPARATE_APPROVER" },
  );
  result = f.app.orders.priceOverrides.decide(admin2, "reject", {
    ...decision,
    decision: "reject",
  });
  assert.equal(result.status, "rejected");
  assert.throws(() => quote(f, c, "rejected"), {
    code: "PRICE_OVERRIDE_PENDING",
  });
  result = f.app.orders.priceOverrides.set(
    f.actor,
    "new",
    input(f, c, 0, result.revision),
  );
  result = f.app.orders.priceOverrides.decide(admin2, "approve", {
    ...decision,
    revision: result.revision,
  });
  assert.equal(quote(f, c, "approved").total, 0);
  const history = f.app.orders.priceOverrides.cart(f.actor, c.id).history;
  assert.deepEqual(
    history.map((h) => h.status),
    ["approved", "pending", "rejected", "pending"],
  );
  assert.equal(history[0]!.proposerId, f.actor.id);
  assert.equal(history[0]!.actorId, admin2.id);
});
test("limits compare normal negotiated net, and reviewed cost/policy/price/cart changes revoke old acceptance", (t) => {
  const f = fixture(t),
    c = cart(f);
  configure(f);
  f.app.catalog.setPrice(f.actor, "negotiated", {
    productId: f.product,
    tier: "standard",
    unitPrice: 8000,
  });
  let r = f.app.orders.priceOverrides.set(
    f.actor,
    "exception",
    input(f, c, 6300),
  );
  assert.equal(r.status, "pending");
  r = f.app.orders.priceOverrides.set(
    f.actor,
    "within",
    input(f, c, 7800, r.revision),
  );
  assert.equal(r.status, "active");
  const q = quote(f, c);
  f.app.catalog.setReviewedUnitCost(f.actor, "cost2", {
    productId: f.product,
    revision: 1,
    unitCostCents: 6100,
    reason: "Updated reviewed cost",
  });
  assert.throws(
    () =>
      f.app.orders.accept(f.actor, "stale", {
        quoteId: q.id,
        allowBackorder: false,
      }),
    { code: "PRICE_OVERRIDE_CHANGED" },
  );
  assert.equal(f.app.orders.list(f.actor).length, 0);
  r = f.app.orders.priceOverrides.set(
    f.actor,
    "re-review",
    input(f, c, 7800, r.revision),
  );
  const q2 = quote(f, c, "q2");
  f.app.catalog.setPriceApprovalPolicy(f.actor, "policy2", {
    revision: 1,
    maxDiscountBp: 2000,
    minMarginBp: 1000,
    reason: "Reviewed policy change",
  });
  assert.throws(
    () =>
      f.app.orders.accept(f.actor, "stale2", {
        quoteId: q2.id,
        allowBackorder: false,
      }),
    { code: "PRICE_OVERRIDE_CHANGED" },
  );
  r = f.app.orders.priceOverrides.set(
    f.actor,
    "again",
    input(f, c, 7800, r.revision),
  );
  const q3 = quote(f, c, "q3");
  f.app.orders.saveCart(f.actor, "quantity", {
    accountId: f.buyer,
    warehouseId: f.w1,
    revision: c.revision,
    lines: [{ productId: f.product, quantity: 2 }],
  });
  assert.throws(
    () =>
      f.app.orders.accept(f.actor, "stale3", {
        quoteId: q3.id,
        allowBackorder: false,
      }),
    { code: "PRICE_OVERRIDE_CHANGED" },
  );
});
test("a changed override after quote blocks acceptance, stale revisions cannot overwrite history, ordinary quote cannot bypass a new pending price", (t) => {
  const f = fixture(t),
    c = cart(f);
  configure(f);
  const old = quote(f, c, "old");
  let r = f.app.orders.priceOverrides.set(f.actor, "first", input(f, c));
  assert.throws(
    () =>
      f.app.orders.accept(f.actor, "old", {
        quoteId: old.id,
        allowBackorder: false,
      }),
    { code: "PRICE_OVERRIDE_CHANGED" },
  );
  const q = quote(f, c);
  r = f.app.orders.priceOverrides.set(
    f.actor,
    "second",
    input(f, c, 9100, r.revision),
  );
  assert.throws(
    () =>
      f.app.orders.accept(f.actor, "changed", {
        quoteId: q.id,
        allowBackorder: false,
      }),
    { code: "PRICE_OVERRIDE_CHANGED" },
  );
  assert.throws(
    () => f.app.orders.priceOverrides.set(f.actor, "stale", input(f, c)),
    { code: "REVISION" },
  );
  assert.equal(
    f.app.orders.priceOverrides.cart(f.actor, c.id).history.length,
    2,
  );
});
test("buyers cannot read, submit, clear or approve override evidence; revoked approver cannot authorize acceptance", async (t) => {
  const f = fixture(t),
    c = cart(f),
    buyer = user(f, "buyer"),
    admin2 = user(f, "admin", "otheradmin");
  const r = f.app.orders.priceOverrides.set(f.actor, "offer", input(f, c));
  for (const op of [
    () => f.app.orders.priceOverrides.cart(buyer, c.id),
    () => f.app.orders.priceOverrides.set(buyer, "buyer-set", input(f, c)),
    () => f.app.orders.priceOverrides.clear(buyer, "buyer-clear", input(f, c)),
    () =>
      f.app.orders.priceOverrides.decide(buyer, "buyer-approve", {
        ...input(f, c),
        decision: "approve",
      }),
  ])
    assert.throws(op, { code: "FORBIDDEN" });
  f.app.orders.priceOverrides.decide(admin2, "approved", {
    ...input(f, c),
    revision: r.revision,
    decision: "approve",
  });
  const q = quote(f, c);
  const row = f.app.identity.users(f.actor).find((u) => u.id === admin2.id)!;
  f.app.identity.updateUser(f.actor, "revoke", {
    userId: admin2.id,
    revision: row.revision,
    name: admin2.name,
    email: row.email,
    role: "commercial",
    sites: admin2.sites,
    active: true,
    currentPassword: "long-test-only-password",
    reason: "Role revoked",
  });
  assert.throws(
    () =>
      f.app.orders.accept(buyer, "after-revoke", {
        quoteId: q.id,
        allowBackorder: false,
      }),
    { code: "FORBIDDEN" },
  );
  const http = await createHttp(f.app, { origin: "http://localhost" });
  t.after(() => http.close());
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin: "http://localhost" },
    payload: {
      email: "buyer@example.test",
      password: "long-test-only-password",
    },
  });
  assert.equal(login.statusCode, 200);
  const cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const response = await http.inject({
    method: "GET",
    url: `/api/carts/${c.id}/price-overrides`,
    headers: { cookie },
  });
  assert.equal(response.statusCode, 403);
  assert.doesNotMatch(response.body, /unitCost|authorityHash|One-off customer/);
});

test("HTTP overrides enforce exact staff payloads, current authorization, idempotency and hidden internal evidence", async (t) => {
  const f = fixture(t),
    c = cart(f);
  configure(f);
  user(f, "buyer");
  const origin = "https://overrides.example.test",
    http = await createHttp(f.app, { origin });
  t.after(() => http.close());
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
    buyer = await login("buyer@example.test"),
    payload = input(f, c);
  async function send(
    headers: Record<string, string>,
    body: unknown,
    key: string,
  ) {
    return http.inject({
      method: "POST",
      url: "/api/commands/cart.price-override.set",
      headers: { ...headers, "idempotency-key": key },
      payload: body as Record<string, unknown>,
    });
  }
  assert.equal(
    (await send(admin, { ...payload, unitCostCents: 0 }, "forged-cost"))
      .statusCode,
    400,
  );
  assert.equal((await send(buyer, payload, "buyer")).statusCode, 403);
  const first = await send(admin, payload, "offer");
  assert.equal(first.statusCode, 200);
  assert.equal((await send(admin, payload, "offer")).body, first.body);
  assert.equal(
    (await send(admin, { ...payload, unitPrice: 9100 }, "offer")).statusCode,
    409,
  );
  const quoteResponse = await http.inject({
    method: "POST",
    url: "/api/commands/cart.quote",
    headers: { ...buyer, "idempotency-key": "buyer-quote" },
    payload: { cartId: c.id, revision: c.revision },
  });
  assert.equal(quoteResponse.statusCode, 200);
  assert.equal(quoteResponse.json().lines[0].unitPrice, 9000);
  assert.doesNotMatch(
    quoteResponse.body,
    /unitCost|authorityHash|minMargin|assessment|proposerId/,
  );
});
