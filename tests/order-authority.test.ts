import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, accept } from "./fixtures.ts";
import type { Actor, Role } from "../src/server/core.ts";
import type { Owner } from "../src/server/database.ts";
import { Application } from "../src/server/application.ts";

function user(f: ReturnType<typeof fixture>, role: Role, name: string = role) {
  const result = f.app.identity.createUser(f.actor, `ordering-${name}`, {
    name,
    email: `ordering-${name}@example.test`,
    password: "long-ordering-test-password",
    role,
    sites: role === "buyer" ? [] : [f.w1],
    ...(role === "buyer" ? { accountId: f.buyer } : {}),
  });
  return f.app.identity.currentActor({ ...f.actor, id: result.id });
}
function change(
  f: ReturnType<typeof fixture>,
  actor: Actor,
  updates: Record<string, unknown>,
) {
  const row = f.app.identity.users(f.actor).find((u) => u.id === actor.id)!;
  f.app.identity.updateUser(
    f.actor,
    `ordering-grant-${actor.id}-${row.revision}`,
    {
      userId: actor.id,
      revision: row.revision,
      name: actor.name,
      email: row.email,
      role: actor.role,
      sites: actor.sites,
      ...(actor.accountId ? { accountId: actor.accountId } : {}),
      active: true,
      currentPassword: "long-test-only-password",
      reason: "Synthetic ordering authority change",
      ...updates,
    },
  );
}
function facts(f: ReturnType<typeof fixture>) {
  const owners: [Owner, string[]][] = [
    [
      "orders",
      [
        "carts",
        "quotes",
        "orders",
        "lines",
        "amendments",
        "reservation_deadlines",
        "reservation_history",
      ],
    ],
    ["inventory", ["units", "allocations", "movements"]],
    ["billing", ["holds", "invoices", "lines", "counters"]],
    ["platform", ["commands", "audit", "audit_order", "audit_clock", "events"]],
  ];
  return owners.flatMap(([owner, tables]) =>
    tables.map((table) =>
      f.app.database
        .owned(owner)
        .all(`SELECT * FROM ${owner}_${table} ORDER BY rowid`),
    ),
  );
}
function denied(operations: (() => unknown)[], code = "FORBIDDEN") {
  for (const operation of operations) assert.throws(operation, { code });
}
function prepared(f: ReturnType<typeof fixture>, actor: Actor) {
  const input = {
    accountId: f.buyer,
    warehouseId: f.w1,
    revision: 0,
    lines: [{ productId: f.product, quantity: 2 }],
  };
  const cart = f.app.orders.saveCart(actor, "authority-cart", input);
  const quoteInput = { cartId: cart.id, revision: cart.revision };
  const quote = f.app.orders.quote(actor, "authority-quote", quoteInput);
  const acceptInput = { quoteId: quote.id, allowBackorder: false };
  const order = f.app.orders.accept(actor, "authority-accept", acceptInput);
  const line = f.app.orders.lines(actor, order.id)[0];
  assert.ok(line);
  const cancelInput = {
    orderId: order.id,
    lineId: line.id,
    revision: 1,
    quantity: 1,
    reason: "Synthetic cancellation",
  };
  f.app.orders.cancel(actor, "authority-cancel", cancelInput);
  const allocateInput = { orderId: order.id, revision: 2 };
  f.app.orders.allocate(actor, "authority-allocate", allocateInput);
  const amendInput = {
    orderId: order.id,
    lineId: line.id,
    revision: 3,
    quantity: 3,
    allowBackorder: false,
    reason: "Synthetic amendment",
  };
  f.app.orders.amend(actor, "authority-amend", amendInput);
  const deadlineInput = {
    orderId: order.id,
    revision: 4,
    expiresAt: Date.now() + 60000,
    reason: "Synthetic deadline",
  };
  f.app.orders.reservationDeadline(actor, "authority-deadline", deadlineInput);
  // Synthetic owning clock fixture; no production command permits past deadlines.
  f.app.database
    .owned("orders")
    .run(
      "UPDATE orders_reservation_deadlines SET expires_at=1 WHERE order_id=?",
      order.id,
    );
  const expireInput = {
    orderId: order.id,
    revision: 5,
    reason: "Synthetic expiry",
  };
  f.app.orders.expireReservations(actor, "authority-expire", expireInput);
  return {
    id: order.id,
    cart,
    quote,
    replay: (current: Actor, prefix = "authority") => [
      () => f.app.orders.saveCart(current, `${prefix}-cart`, input),
      () => f.app.orders.quote(current, `${prefix}-quote`, quoteInput),
      () => f.app.orders.accept(current, `${prefix}-accept`, acceptInput),
      () => f.app.orders.cancel(current, `${prefix}-cancel`, cancelInput),
      () => f.app.orders.allocate(current, `${prefix}-allocate`, allocateInput),
      () => f.app.orders.amend(current, `${prefix}-amend`, amendInput),
      () =>
        f.app.orders.reservationDeadline(
          current,
          `${prefix}-deadline`,
          deadlineInput,
        ),
      () =>
        f.app.orders.expireReservations(
          current,
          `${prefix}-expire`,
          expireInput,
        ),
    ],
  };
}
function reads(f: ReturnType<typeof fixture>, actor: Actor, orderId: string) {
  return [
    () => f.app.orders.order(actor, orderId),
    () => f.app.orders.lines(actor, orderId),
    () => f.app.orders.carts(actor),
    () => f.app.orders.list(actor),
    () => f.app.orders.orderPage(actor),
    () => f.app.orders.orderCounts(actor),
    () => f.app.orders.amendments(actor, orderId),
    () => f.app.orders.reservations(actor, orderId),
    () => f.app.orders.salesEvidence(actor),
    () => f.app.orders.assertReservationCurrent(actor, orderId),
  ];
}

test("ordering unavailable principals cannot read or return any of eight saved/new commands", (t) => {
  const f = fixture(t),
    actor = user(f, "admin"),
    p = prepared(f, actor);
  change(f, actor, { active: false });
  const before = facts(f);
  for (const invalid of [
    actor,
    { ...actor, id: "absent-order-principal" },
    { ...actor, orgId: "foreign-org" },
  ])
    denied([
      ...reads(f, invalid, p.id),
      ...p.replay(invalid),
      ...p.replay(invalid, "new"),
    ]);
  assert.deepEqual(facts(f), before);
});

test("ordering demoted administrators cannot replay carts quotes acceptance cancellation or other writes", (t) => {
  const f = fixture(t),
    actor = user(f, "admin"),
    p = prepared(f, actor);
  change(f, actor, { role: "support" });
  const before = facts(f);
  denied([
    ...p.replay(actor),
    ...p.replay(actor, "new"),
    () => f.app.orders.carts(actor),
    () => f.app.orders.salesEvidence(actor),
  ]);
  assert.equal(f.app.orders.order(actor, p.id).id, p.id);
  assert.deepEqual(facts(f), before);
});

test("forced password changes fence ordering reads saved commands and owning shipment writes", (t) => {
  const f = fixture(t),
    actor = user(f, "admin"),
    p = prepared(f, actor);
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
      actor.id,
    );
  const before = facts(f);
  denied(
    [
      ...reads(f, actor, p.id),
      ...p.replay(actor),
      ...p.replay(actor, "new"),
      () => f.app.orders.completeShipment(actor, p.id, new Map()),
      () =>
        f.app.orders.shortPick(
          actor,
          {
            orderId: p.id,
            revision: 6,
            allocationId: "absent",
            unitRevision: 1,
            quantity: 1,
            reason: "Denied",
          },
          "denied-short",
        ),
    ],
    "PASSWORD_CHANGE_REQUIRED",
  );
  assert.deepEqual(facts(f), before);
});

test("buyer cart/order scope follows persisted account despite forged role and reassignment", (t) => {
  const f = fixture(t),
    id = accept(f).id,
    actor = user(f, "buyer");
  const other = f.app.identity.createCustomer(f.actor, "other-order-account", {
    name: "Other synthetic account",
    tier: "standard",
    creditLimit: 1000000,
  }).id;
  f.app.catalog.setPurchasingPolicy(f.actor, "synthetic-extra-account-access", {
    accountId: other,
    mode: "all",
    requiresReview: false,
    productIds: [],
    revision: 0,
    reason: "Explicit synthetic account access for this test.",
  });
  const otherCart = f.app.orders.saveCart(f.actor, "other-cart", {
    accountId: other,
    warehouseId: f.w2,
    revision: 0,
    lines: [{ productId: f.product, quantity: 1 }],
  });
  const q = f.app.orders.quote(f.actor, "other-quote", {
    cartId: otherCart.id,
    revision: 1,
  });
  const otherOrder = f.app.orders.accept(f.actor, "other-order", {
    quoteId: q.id,
    allowBackorder: true,
  }).id;
  const forged = { ...actor, role: "admin" as const, accountId: other };
  const before = facts(f);
  denied([
    () => f.app.orders.order(forged, otherOrder),
    () => f.app.orders.lines(forged, otherOrder),
  ]);
  assert.deepEqual(
    f.app.orders.carts(forged).map((c) => c.account_id),
    [f.buyer],
  );
  assert.deepEqual(facts(f), before);
  change(f, actor, { accountId: other });
  const after = facts(f);
  denied([
    () => f.app.orders.order(actor, id),
    () => f.app.orders.lines(actor, id),
  ]);
  assert.equal(f.app.orders.order(actor, otherOrder).id, otherOrder);
  assert.deepEqual(
    f.app.orders.carts(actor).map((c) => c.account_id),
    [other],
  );
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET account_id=NULL WHERE id=?", actor.id);
  assert.deepEqual(
    f.app.orders.carts({ ...actor, role: "admin", accountId: null }),
    [],
  );
  denied([() => f.app.orders.order(actor, otherOrder)]);
  assert.deepEqual(facts(f), after);
});

test("warehouse order detail and lines honor current sites even with forged administrator fields", (t) => {
  const f = fixture(t),
    id = accept(f).id,
    actor = user(f, "warehouse");
  change(f, actor, { sites: [f.w2] });
  const before = facts(f),
    forged = { ...actor, role: "admin" as const, sites: [f.w1] };
  denied([
    () => f.app.orders.order(forged, id),
    () => f.app.orders.lines(forged, id),
    () => f.app.orders.completeShipment(forged, id, new Map()),
  ]);
  assert.deepEqual(f.app.orders.orderPage(forged).items, []);
  assert.deepEqual(facts(f), before);
});

test("current commercial and buyer roles permit native cart quote acceptance and cancellation despite supplied negative roles", (t) => {
  for (const role of ["commercial", "buyer"] as const) {
    const f = fixture(t),
      actor = user(f, role),
      supplied = { ...actor, role: "warehouse" as const, sites: [] };
    const saved = f.app.orders.saveCart(supplied, "valid-cart", {
      accountId: f.buyer,
      warehouseId: f.w1,
      revision: 0,
      lines: [{ productId: f.product, quantity: 2 }],
    });
    const quote = f.app.orders.quote(supplied, "valid-quote", {
      cartId: saved.id,
      revision: 1,
    });
    const input = { quoteId: quote.id, allowBackorder: false };
    const accepted = f.app.orders.accept(supplied, "valid-accept", input);
    assert.deepEqual(
      f.app.orders.accept(supplied, "valid-accept", input),
      accepted,
    );
    const line = f.app.orders.lines(supplied, accepted.id)[0];
    assert.ok(line);
    assert.equal(line.unit_price, 10000);
    assert.equal(line.unit_tax, 1300);
    assert.equal(line.allocated, 2);
    f.app.orders.cancel(supplied, "valid-cancel", {
      orderId: accepted.id,
      lineId: line.id,
      revision: 1,
      quantity: 1,
      reason: "Synthetic cancellation",
    });
    assert.equal(f.app.orders.lines(supplied, accepted.id)[0]!.canceled, 1);
    assert.equal(f.app.orders.carts(supplied).length, 1);
  }
});

test("independent ordering grant changes and actual restart deny all saved/new command results", (t) => {
  const f = fixture(t),
    actor = user(f, "admin"),
    p = prepared(f, actor),
    second = new Application(f.path, "CA");
  try {
    change({ ...f, app: second }, actor, { role: "support" });
  } finally {
    second.close();
  }
  const before = facts(f);
  denied([...p.replay(actor), ...p.replay(actor, "new")]);
  f.app.close();
  f.app = new Application(f.path, "CA");
  denied([...p.replay(actor), ...p.replay(actor, "restart")]);
  assert.deepEqual(facts(f), before);
});

test("owning shipment completion and shortage operations reject supplied warehouse roles for commercial users", (t) => {
  const f = fixture(t),
    id = accept(f).id,
    actor = user(f, "commercial"),
    forged = { ...actor, role: "warehouse" as const };
  const before = facts(f);
  denied([
    () => f.app.orders.completeShipment(forged, id, new Map([[f.product, 1]])),
    () =>
      f.app.orders.shortPick(
        forged,
        {
          orderId: id,
          revision: 1,
          allocationId: "absent",
          unitRevision: 1,
          quantity: 1,
          reason: "Denied",
        },
        "denied-short",
      ),
  ]);
  assert.deepEqual(facts(f), before);
});

test("buyer account reassignment fences all four completed ordering commands before replay", (t) => {
  const f = fixture(t),
    actor = user(f, "buyer");
  const cartInput = {
    accountId: f.buyer,
    warehouseId: f.w1,
    revision: 0,
    lines: [{ productId: f.product, quantity: 2 }],
  };
  const cart = f.app.orders.saveCart(actor, "buyer-cart", cartInput);
  const quoteInput = { cartId: cart.id, revision: 1 };
  const quote = f.app.orders.quote(actor, "buyer-quote", quoteInput);
  const acceptInput = { quoteId: quote.id, allowBackorder: false };
  const order = f.app.orders.accept(actor, "buyer-accept", acceptInput);
  const cancelInput = {
    orderId: order.id,
    lineId: f.app.orders.lines(actor, order.id)[0]!.id,
    revision: 1,
    quantity: 1,
    reason: "Synthetic cancellation",
  };
  f.app.orders.cancel(actor, "buyer-cancel", cancelInput);
  const other = f.app.identity.createCustomer(f.actor, "buyer-reassignment", {
    name: "Other synthetic customer",
    tier: "standard",
    creditLimit: 1000000,
  }).id;
  change(f, actor, { accountId: other });
  const before = facts(f);
  for (const prefix of ["buyer", "new"])
    denied([
      () => f.app.orders.saveCart(actor, `${prefix}-cart`, cartInput),
      () => f.app.orders.quote(actor, `${prefix}-quote`, quoteInput),
      () => f.app.orders.accept(actor, `${prefix}-accept`, acceptInput),
      () => f.app.orders.cancel(actor, `${prefix}-cancel`, cancelInput),
    ]);
  assert.deepEqual(facts(f), before);
});
