import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture, ship } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { minimumOrderAssessment } from "../src/shared/customer-minimum-order.ts";
import { createHttp } from "../src/server/http.ts";
function set(
  f: ReturnType<typeof fixture>,
  minimumSubtotal: number,
  minimumEquipmentQuantity: number,
) {
  const previous = f.app.identity.minimumOrders.get(f.actor, f.buyer);
  return f.app.identity.minimumOrders.save(
    f.actor,
    `minimum-${previous.revision}`,
    {
      accountId: f.buyer,
      expectedRevision: previous.revision,
      minimumSubtotal,
      minimumEquipmentQuantity,
      reason: "Reviewed synthetic customer minimum",
    },
  );
}
function quote(
  f: ReturnType<typeof fixture>,
  quantity = 1,
  productId = f.product,
) {
  const previous = f.app.orders.orderEntry(f.actor, f.buyer, f.w1).cart;
  const cart = f.app.orders.saveCart(
    f.actor,
    `cart-${previous?.revision ?? 0}`,
    {
      accountId: f.buyer,
      warehouseId: f.w1,
      revision: previous?.revision ?? 0,
      lines: [{ productId, quantity }],
    },
  );
  return f.app.orders.quote(f.actor, `quote-${cart.revision}`, {
    cartId: cart.id,
    revision: cart.revision,
  });
}
test("per-customer minimum defaults, reviewed audit, exact retries, revisions and durable restart", (t) => {
  const f = fixture(t),
    initial = f.app.identity.minimumOrders.get(f.actor, f.buyer);
  assert.equal(initial.minimumSubtotal, 0);
  assert.equal(initial.minimumEquipmentQuantity, 0);
  assert.equal(initial.revision, 0);
  const input = {
    accountId: f.buyer,
    expectedRevision: 0,
    minimumSubtotal: 20000,
    minimumEquipmentQuantity: 2,
    reason: "Agreed purchasing terms",
  };
  const saved = f.app.identity.minimumOrders.save(f.actor, "policy", input);
  assert.deepEqual(
    f.app.identity.minimumOrders.save(f.actor, "policy", input),
    saved,
  );
  assert.throws(
    () =>
      f.app.identity.minimumOrders.save(f.actor, "policy", {
        ...input,
        minimumSubtotal: 1,
      }),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  assert.throws(
    () => f.app.identity.minimumOrders.save(f.actor, "stale", input),
    { code: "STALE_VERSION" },
  );
  assert.throws(() => set(f, -1, 0), { code: "VALIDATION" });
  const audit = f.app.database
    .owned("platform")
    .all<{ detail: string }>(
      "SELECT detail FROM platform_audit WHERE action='account.minimum-order.saved'",
    );
  assert.equal(audit.length, 1);
  assert.equal(JSON.parse(audit[0]!.detail).reason, input.reason);
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(f.app.identity.minimumOrders.get(f.actor, f.buyer), saved);
  const other = f.app.identity.createCustomer(f.actor, "other", {
    name: "Other",
    tier: "standard",
    creditLimit: 100000,
  }).id;
  assert.equal(
    f.app.identity.minimumOrders.get(f.actor, other).minimumSubtotal,
    0,
  );
});
test("current policy enforces merchandise before tax, quantity, accessory-only and atomic amendment without blocking drafts or quotes", (t) => {
  const f = fixture(t),
    q = quote(f);
  set(f, 11000, 2); // Tax-inclusive total11300 must not satisfy merchandise11000.
  assert.throws(
    () =>
      f.app.orders.accept(f.actor, "fail", {
        quoteId: q.id,
        allowBackorder: false,
      }),
    (e) => {
      assert.equal((e as any).code, "MINIMUM_ORDER");
      assert.match((e as Error).message, /10\.00.*1 more equipment/);
      return true;
    },
  );
  assert.equal(f.app.orders.list(f.actor).length, 0);
  const q2 = quote(f, 2),
    accepted = f.app.orders.accept(f.actor, "success", {
      quoteId: q2.id,
      allowBackorder: false,
    });
  const order = f.app.orders.order(f.actor, accepted.id),
    line = f.app.orders.lines(f.actor, order.id)[0]!;
  assert.throws(
    () =>
      f.app.orders.amend(f.actor, "reduce", {
        orderId: order.id,
        lineId: line.id,
        revision: order.revision,
        quantity: 1,
        allowBackorder: false,
        reason: "Reduce",
      }),
    { code: "MINIMUM_ORDER" },
  );
  assert.equal(f.app.orders.lines(f.actor, order.id)[0]!.quantity, 2);
  const accessory = f.app.catalog.create(f.actor, "accessory", {
    sku: "A1",
    name: "Accessory",
    serialized: false,
    unitPrice: 50000,
    taxBasisPoints: 1300,
  }).id;
  const qa = quote(f, 1, accessory);
  assert.throws(
    () =>
      f.app.orders.accept(f.actor, "accessory-order", {
        quoteId: qa.id,
        allowBackorder: true,
      }),
    { code: "MINIMUM_ORDER" },
  );
  set(f, 0, 0);
  assert.equal(
    f.app.orders.accept(f.actor, "disabled", {
      quoteId: qa.id,
      allowBackorder: true,
    }).status,
    "accepted",
  );
});
test("new customer minimum preserves accepted-order fulfillment and shortage cancellation", (t) => {
  const f = fixture(t),
    q = quote(f, 2);
  const accepted = f.app.orders.accept(f.actor, "grandfather", {
    quoteId: q.id,
    allowBackorder: false,
  });
  set(f, 100000, 10);
  const order = f.app.orders.order(f.actor, accepted.id),
    line = f.app.orders.lines(f.actor, order.id)[0]!;
  f.app.orders.cancel(f.actor, "shortage", {
    orderId: order.id,
    lineId: line.id,
    revision: order.revision,
    quantity: 1,
    reason: "Synthetic shortage",
  });
  assert.equal(f.app.orders.lines(f.actor, order.id)[0]!.canceled, 1);
  const fulfillment = fixture(t),
    fulfillmentQuote = quote(fulfillment);
  const fulfillmentOrder = fulfillment.app.orders.accept(
    fulfillment.actor,
    "fulfillment",
    { quoteId: fulfillmentQuote.id, allowBackorder: false },
  );
  set(fulfillment, 100000, 10);
  ship(fulfillment, fulfillmentOrder.id);
  assert.equal(
    fulfillment.app.orders.lines(fulfillment.actor, fulfillmentOrder.id)[0]!
      .shipped,
    1,
  );
});
test("review approval and resubmission use current customer minimum and prevent stale quote bypass", (t) => {
  const f = fixture(t);
  f.app.catalog.setPurchasingPolicy(f.actor, "review-policy", {
    accountId: f.buyer,
    mode: "all",
    requiresReview: true,
    productIds: [],
    revision: 1,
    reason: "Reviewed requests",
  });
  const q = quote(f),
    submitted = f.app.orders.accept(f.actor, "submit", {
      quoteId: q.id,
      allowBackorder: false,
    });
  const r = f.app.orders.reviewRequest(f.actor, submitted.id);
  set(f, 0, 2);
  assert.throws(
    () =>
      f.app.orders.decideReview(f.actor, "approve", {
        requestId: r.id,
        revision: r.revision,
        expectedHash: r.expectedHash,
        action: "approve",
        message: "Approve",
        staffNote: "Reviewed",
      }),
    { code: "MINIMUM_ORDER" },
  );
  assert.throws(
    () =>
      f.app.orders.resubmitReview(f.actor, "resubmit", {
        requestId: r.id,
        revision: r.revision,
        quoteId: q.id,
        allowBackorder: false,
        message: "Submit again",
      }),
    { code: "MINIMUM_ORDER" },
  );
  assert.equal(f.app.orders.list(f.actor).length, 0);
  const q2 = quote(f, 2);
  const renewed = f.app.orders.resubmitReview(f.actor, "resubmit-good", {
    requestId: r.id,
    revision: r.revision,
    quoteId: q2.id,
    allowBackorder: false,
    message: "Added equipment",
  });
  assert.equal(renewed.status, "awaiting_approval");
});
test("HTTP buyer reads scoped minimum; buyer/finance/support cannot edit and forged role is refused", async (t) => {
  const f = fixture(t);
  set(f, 20000, 2);
  const http = await createHttp(f.app, { origin: "http://localhost" });
  t.after(() => http.close());
  for (const role of ["buyer", "finance", "support", "commercial"] as const) {
    const user = f.app.identity.createUser(f.actor, role, {
      name: role,
      email: `${role}@example.test`,
      password: "long-test-password",
      role,
      sites: [],
      accountId: role === "buyer" ? f.buyer : undefined,
    });
    const actor = f.app.identity.currentActor({ ...f.actor, id: user.id });
    assert.equal(
      f.app.identity.minimumOrders.get(actor, f.buyer).canManage,
      role === "commercial",
    );
    if (role !== "commercial")
      assert.throws(
        () =>
          f.app.identity.minimumOrders.save(actor, role, {
            accountId: f.buyer,
            expectedRevision: 1,
            minimumSubtotal: 0,
            minimumEquipmentQuantity: 0,
            reason: "Change",
          }),
        { code: "FORBIDDEN" },
      );
    if (role === "commercial") {
      const login = f.app.identity.login(
        `${role}@example.test`,
        "long-test-password",
      );
      const saved = await http.inject({
        method: "POST",
        url: "/api/commands/account.minimum-order.save",
        headers: {
          origin: "http://localhost",
          cookie: `distributor_session=${login.token}`,
          "x-csrf-token": login.csrf,
          "idempotency-key": "http-commercial",
        },
        payload: {
          accountId: f.buyer,
          expectedRevision: 1,
          minimumSubtotal: 25000,
          minimumEquipmentQuantity: 2,
          reason: "Synthetic agreement",
        },
      });
      assert.equal(saved.statusCode, 200, saved.body);
      assert.equal(saved.json().revision, 2);
      assert.equal(saved.json().minimumSubtotal, 25000);
    }
    if (role === "buyer") {
      assert.equal(
        f.app.identity.minimumOrders.get({ ...actor, role: "admin" }, f.buyer)
          .canManage,
        false,
      );
      assert.throws(
        () =>
          f.app.identity.minimumOrders.save(
            { ...actor, role: "admin" },
            "forged",
            {
              accountId: f.buyer,
              expectedRevision: 1,
              minimumSubtotal: 0,
              minimumEquipmentQuantity: 0,
              reason: "Forged",
            },
          ),
        { code: "FORBIDDEN" },
      );
      const other = f.app.identity.createCustomer(f.actor, "foreign", {
        name: "Other",
        tier: "standard",
        creditLimit: 0,
      }).id;
      assert.throws(() => f.app.identity.minimumOrders.get(actor, other), {
        code: "FORBIDDEN",
      });
      const login = f.app.identity.login(
        `${role}@example.test`,
        "long-test-password",
      );
      const response = await http.inject({
        url: `/api/accounts/${f.buyer}/minimum-order`,
        headers: { cookie: `distributor_session=${login.token}` },
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().minimumSubtotal, 20000);
      assert.equal(response.json().canManage, false);
      const blocked = await http.inject({
        method: "POST",
        url: "/api/commands/account.minimum-order.save",
        headers: {
          origin: "http://localhost",
          cookie: `distributor_session=${login.token}`,
          "x-csrf-token": login.csrf,
          "idempotency-key": "http-buyer",
        },
        payload: {
          accountId: f.buyer,
          expectedRevision: 1,
          minimumSubtotal: 0,
          minimumEquipmentQuantity: 0,
          reason: "Bypass",
        },
      });
      assert.equal(blocked.statusCode, 403);
    }
  }
});
test("shared assessment counts equipment consistently and excludes tax/freight", () => {
  const policy = {
    currency: "CAD",
    minimumSubtotal: 12000,
    minimumEquipmentQuantity: 2,
  };
  const result = minimumOrderAssessment(policy, [
    { quantity: 1, unitPrice: 10000, serialized: 1 },
    { quantity: 2, unitPrice: 1000, serialized: 0 },
  ]);
  assert.equal(result.subtotal, 12000);
  assert.equal(result.equipmentQuantity, 1);
  assert.equal(result.missingSubtotal, 0);
  assert.equal(result.missingEquipmentQuantity, 1);
  assert.equal(result.met, false);
});
