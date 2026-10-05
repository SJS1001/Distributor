import { test } from "node:test";
import { fork, type ChildProcess } from "node:child_process";
import type {
  OrderRequest,
  OrderRequestDecisionInput,
  OrderRequestWithdrawInput,
  OrderRequestResubmitInput,
} from "../src/shared/purchasing.ts";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.ts";
import type { Actor } from "../src/server/core.ts";
import { Application } from "../src/server/application.ts";

type Fixture = ReturnType<typeof fixture>;
function buyer(f: Fixture, accountId = f.buyer, name = "purchasing-buyer") {
  const user = f.app.identity.createUser(f.actor, name, {
    name,
    email: `${name}@example.test`,
    password: "long-test-only-password",
    role: "buyer",
    sites: [],
    accountId,
  });
  return f.app.identity.currentActor({ ...f.actor, id: user.id });
}
function policy(
  f: Fixture,
  review = true,
  mode: "all" | "none" | "selected" = "all",
  productIds: string[] = [],
) {
  const current = f.app.catalog.purchasingPolicy(f.actor, f.buyer);
  return f.app.catalog.setPurchasingPolicy(
    f.actor,
    `policy-${current.revision}`,
    {
      ...current,
      requiresReview: review,
      mode,
      productIds,
      reason: "Synthetic reviewed purchasing policy",
    },
  );
}
function quote(f: Fixture, actor = f.actor, quantity = 1) {
  const current = f.app.orders.orderEntry(actor, f.buyer, f.w1).cart;
  const cart = f.app.orders.saveCart(actor, `cart-${current?.revision ?? 0}`, {
    accountId: f.buyer,
    warehouseId: f.w1,
    revision: current?.revision ?? 0,
    lines: [{ productId: f.product, quantity }],
  });
  return f.app.orders.quote(actor, `quote-${cart.revision}`, {
    cartId: cart.id,
    revision: cart.revision,
  });
}
function submit(f: Fixture, actor = f.actor, quantity = 1) {
  const q = quote(f, actor, quantity);
  const result = f.app.orders.accept(actor, `accept-${q.id}`, {
    quoteId: q.id,
    allowBackorder: false,
  });
  assert.equal(result.status, "awaiting_approval");
  return f.app.orders.reviewRequest(actor, result.id);
}
function decide(
  f: Fixture,
  requestId: string,
  actor = f.actor,
  action: "approve" | "decline" | "request_information" = "approve",
) {
  const r = f.app.orders.reviewRequest(actor, requestId);
  return f.app.orders.decideReview(actor, `decide-${r.id}-${r.revision}`, {
    requestId,
    revision: r.revision,
    expectedHash: r.expectedHash,
    action,
    message: "Reviewed synthetic request",
    staffNote: "Internal synthetic note",
  });
}
function effects(f: Fixture) {
  return [
    f.app.database.owned("orders").all("SELECT * FROM orders_orders"),
    f.app.database.owned("orders").all("SELECT * FROM orders_lines"),
    f.app.database
      .owned("inventory")
      .all("SELECT * FROM inventory_allocations"),
    f.app.database.owned("billing").all("SELECT * FROM billing_holds"),
    f.app.database
      .owned("platform")
      .all("SELECT * FROM platform_events WHERE type='orders.accepted'"),
  ];
}

test("unconfigured account is closed by default across browse, resource, cart and forged buyer identity", (t) => {
  const f = fixture(t);
  const accountId = f.app.identity.createCustomer(f.actor, "new-account", {
    name: "Unconfigured",
    tier: "standard",
    creditLimit: 10000,
  }).id;
  const b = buyer(f, accountId);
  assert.equal(f.app.catalog.purchasingPolicy(b, accountId).mode, "none");
  assert.deepEqual(f.app.catalog.customerProducts(b, accountId), []);
  assert.deepEqual(f.app.catalog.customerProductPage(b, accountId), {
    items: [],
    next: null,
  });
  assert.throws(() => f.app.catalog.authorizeResourceAccess(b, f.product), {
    code: "PRODUCT_ACCESS",
  });
  for (const actor of [b, f.actor])
    assert.throws(
      () =>
        f.app.orders.saveCart(actor, `blocked-${actor.id}`, {
          accountId,
          warehouseId: f.w1,
          revision: 0,
          lines: [{ productId: f.product, quantity: 1 }],
        }),
      { code: "PRODUCT_ACCESS" },
    );
  assert.throws(
    () =>
      f.app.catalog.customerProducts(
        { ...b, role: "admin", accountId: f.buyer },
        f.buyer,
      ),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () =>
      f.app.catalog.setPurchasingPolicy(b, "forge", {
        accountId,
        mode: "all",
        requiresReview: false,
        revision: 0,
        productIds: [],
        reason: "forged",
      }),
    { code: "FORBIDDEN" },
  );
});

test("selected entitlement filters browsing and rejects saved cart/quote/accept after revocation", (t) => {
  const f = fixture(t),
    b = buyer(f);
  policy(f, false, "selected", [f.product]);
  assert.deepEqual(
    f.app.catalog.customerProductPage(b, f.buyer).items.map((p) => p.id),
    [f.product],
  );
  const q = quote(f, b);
  policy(f, false, "none");
  assert.deepEqual(f.app.catalog.customerProducts(b, f.buyer), []);
  assert.throws(() => f.app.orders.orderEntry(b, f.buyer, f.w1), {
    code: "PRODUCT_ACCESS",
  });
  const c = f.app.orders.carts(b)[0]!;
  assert.throws(
    () =>
      f.app.orders.quote(b, "revoked-quote", {
        cartId: c.id,
        revision: c.revision,
      }),
    { code: "PRODUCT_ACCESS" },
  );
  assert.throws(
    () =>
      f.app.orders.accept(b, "revoked-accept", {
        quoteId: q.id,
        allowBackorder: true,
      }),
    { code: "PRODUCT_ACCESS" },
  );
});

test("pending request has no commercial effects; authorized approval accepts exactly once and hides staff notes", (t) => {
  const f = fixture(t),
    b = buyer(f);
  policy(f);
  const before = effects(f),
    request = submit(f, b);
  assert.deepEqual(effects(f), before);
  assert.equal(request.status, "awaiting_approval");
  assert.throws(() => decide(f, request.id, b), { code: "FORBIDDEN" });
  const accepted = decide(f, request.id);
  assert.equal(accepted.status, "accepted");
  assert.ok(accepted.orderId);
  assert.equal(f.app.orders.list(b).length, 1);
  assert.equal(
    f.app.orders
      .reviewRequest(b, request.id)
      .history.some((h) => "staffNote" in h),
    false,
  );
  const stale = {
    requestId: request.id,
    revision: request.revision,
    expectedHash: request.expectedHash,
    action: "approve" as const,
    message: "Reviewed synthetic request",
    staffNote: "Internal synthetic note",
  };
  assert.deepEqual(
    f.app.orders.decideReview(f.actor, `decide-${request.id}-1`, stale),
    accepted,
  );
  assert.throws(() => f.app.orders.decideReview(f.actor, "competing", stale), {
    code: "REVIEW_CHANGED",
  });
  assert.equal(
    f.app.database
      .owned("platform")
      .all("SELECT * FROM platform_events WHERE type='orders.accepted'").length,
    1,
  );
});

test("product flag alone requires review and supplied approval fields cannot bypass native gate", (t) => {
  const f = fixture(t),
    b = buyer(f);
  f.app.catalog.setProductPurchasingPolicy(f.actor, "product-review", {
    productId: f.product,
    requiresReview: true,
    revision: 0,
    reason: "Qualified equipment review",
  });
  const q = quote(f, b);
  assert.equal(q.requiresReview, true);
  const before = effects(f);
  const result = f.app.orders.accept(b, "tamper", {
    ...{
      quoteId: q.id,
      allowBackorder: false,
      approved: true,
      requiresReview: false,
    },
  });
  assert.equal(result.status, "awaiting_approval");
  assert.deepEqual(effects(f), before);
});

test("request withdrawal, information and resubmission invalidate stale staff decisions and preserve quote history", (t) => {
  const f = fixture(t),
    b = buyer(f);
  policy(f);
  const original = submit(f, b),
    info = decide(f, original.id, f.actor, "request_information");
  assert.equal(info.status, "information_needed");
  const q = quote(f, b, 2);
  const updated = f.app.orders.resubmitReview(b, "resubmit", {
    requestId: original.id,
    revision: info.revision,
    quoteId: q.id,
    allowBackorder: false,
    message: "Please review updated units",
  });
  assert.equal(updated.revision, 3);
  assert.equal(updated.lines[0]!.quantity, 2);
  assert.throws(
    () =>
      f.app.orders.decideReview(f.actor, "old-review", {
        requestId: original.id,
        revision: original.revision,
        expectedHash: original.expectedHash,
        action: "approve",
        message: "Stale review",
      }),
    { code: "REVIEW_CHANGED" },
  );
  assert.throws(
    () =>
      f.app.orders.accept(b, "old-quote", {
        quoteId: original.quoteId,
        allowBackorder: false,
      }),
    { code: "REQUEST_STATE" },
  );
  const withdrawn = f.app.orders.withdrawReview(b, "withdraw", {
    requestId: original.id,
    revision: updated.revision,
  });
  assert.equal(withdrawn.status, "withdrawn");
  assert.throws(
    () =>
      f.app.orders.accept(b, "withdrawn-quote", {
        quoteId: q.id,
        allowBackorder: false,
      }),
    { code: "REQUEST_STATE" },
  );
  assert.equal(f.app.orders.list(b).length, 0);
  const snapshots = f.app.database
    .owned("orders")
    .all(
      "SELECT quote_id,total,revision FROM orders_review_history ORDER BY revision",
    );
  assert.equal(snapshots.length, 4);
  assert.notEqual(snapshots[0]!.quote_id, snapshots[2]!.quote_id);
});

for (const change of [
  "expiry",
  "price",
  "entitlement",
  "policy",
  "hold",
  "stock",
  "credit",
] as const)
  test(`approval revalidates ${change} with atomic rollback`, (t) => {
    const f = fixture(t);
    policy(f);
    const request = submit(f);
    if (change === "expiry")
      f.app.database
        .owned("orders")
        .run(
          "UPDATE orders_quotes SET expires_at=1 WHERE id=?",
          request.quoteId,
        );
    if (change === "price")
      f.app.catalog.setPrice(f.actor, "new-price", {
        productId: f.product,
        tier: "standard",
        unitPrice: 11000,
      });
    if (change === "entitlement") policy(f, true, "none");
    if (change === "policy")
      f.app.catalog.setProductPurchasingPolicy(f.actor, "new-product-policy", {
        productId: f.product,
        requiresReview: true,
        revision: 0,
        reason: "Changed policy",
      });
    if (change === "hold")
      f.app.database
        .owned("iam")
        .run("UPDATE iam_accounts SET held=1 WHERE id=?", f.buyer);
    if (change === "credit")
      f.app.database
        .owned("iam")
        .run("UPDATE iam_accounts SET credit_limit=1 WHERE id=?", f.buyer);
    if (change === "stock")
      f.app.database
        .owned("inventory")
        .run(
          "UPDATE inventory_units SET condition='quarantine' WHERE org_id=?",
          f.actor.orgId,
        );
    const before = effects(f);
    const codes = {
      expiry: "QUOTE_EXPIRED",
      price: "PRICE_CHANGED",
      entitlement: "PRODUCT_ACCESS",
      policy: "POLICY_CHANGED",
      hold: "CREDIT_HOLD",
      stock: "STOCK",
      credit: "POLICY_CHANGED",
    };
    assert.throws(() => decide(f, request.id), { code: codes[change] });
    assert.deepEqual(effects(f), before);
    assert.equal(
      f.app.orders.reviewRequest(f.actor, request.id).status,
      "awaiting_approval",
    );
  });

test("scope and current identity govern request detail, mutation and cached replay across restart", (t) => {
  const f = fixture(t),
    b = buyer(f);
  policy(f);
  const request = submit(f, b);
  const otherId = f.app.identity.createCustomer(f.actor, "other", {
    name: "Other",
    tier: "standard",
    creditLimit: 100000,
  }).id;
  const other = buyer(f, otherId, "other-buyer");
  assert.deepEqual(f.app.orders.reviewRequests(other), {
    items: [],
    next: null,
  });
  assert.throws(() => f.app.orders.reviewRequest(other, request.id), {
    code: "FORBIDDEN",
  });
  assert.throws(
    () =>
      f.app.orders.withdrawReview(
        { ...other, accountId: f.buyer },
        "other-withdraw",
        { requestId: request.id, revision: request.revision },
      ),
    { code: "FORBIDDEN" },
  );
  f.app.close();
  f.app = new Application(f.path, "CA");
  assert.equal(
    f.app.orders.reviewRequest(b, request.id).status,
    "awaiting_approval",
  );
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET account_id=? WHERE id=?", otherId, b.id);
  assert.throws(
    () =>
      f.app.orders.accept(b, `accept-${request.quoteId}`, {
        quoteId: request.quoteId,
        allowBackorder: false,
      }),
    { code: "FORBIDDEN" },
  );
});

for (const customer of [false, true])
  for (const product of [false, true])
    test(`customer review ${customer}, product review ${product} determines native acceptance`, (t) => {
      const f = fixture(t);
      policy(f, customer);
      f.app.catalog.setProductPurchasingPolicy(f.actor, "flag", {
        productId: f.product,
        requiresReview: product,
        revision: 0,
        reason: "Synthetic flag matrix",
      });
      const q = quote(f);
      assert.equal(q.requiresReview, customer || product);
      const result = f.app.orders.accept(f.actor, "matrix-accept", {
        quoteId: q.id,
        allowBackorder: false,
      });
      assert.equal(
        result.status,
        customer || product ? "awaiting_approval" : "accepted",
      );
      assert.equal(
        f.app.orders.list(f.actor).length,
        customer || product ? 0 : 1,
      );
      if (result.status === "awaiting_approval") {
        const request = f.app.orders.reviewRequest(f.actor, result.id);
        assert.match(request.reviewReason, /requires distributor approval/);
        assert.equal(
          f.app.database
            .owned("orders")
            .get(
              "SELECT review_reason FROM orders_review_history WHERE request_id=?",
              request.id,
            )!.review_reason,
          request.reviewReason,
        );
      }
    });

test("mixed products hold the whole request and a post-quote policy flip requires renewed buyer terms", (t) => {
  const f = fixture(t);
  const second = f.app.catalog.create(f.actor, "second", {
    sku: "EQ-2",
    name: "Second equipment",
    serialized: false,
    unitPrice: 200,
    taxBasisPoints: 1300,
  }).id;
  f.app.catalog.setProductPurchasingPolicy(f.actor, "flag", {
    productId: second,
    requiresReview: true,
    revision: 0,
    reason: "Synthetic mixed basket",
  });
  const cart = f.app.orders.saveCart(f.actor, "mixed", {
    accountId: f.buyer,
    warehouseId: f.w1,
    revision: 0,
    lines: [
      { productId: f.product, quantity: 1 },
      { productId: second, quantity: 1 },
    ],
  });
  const q = f.app.orders.quote(f.actor, "mixed-quote", {
    cartId: cart.id,
    revision: cart.revision,
  });
  const before = effects(f);
  assert.equal(
    f.app.orders.accept(f.actor, "mixed-submit", {
      quoteId: q.id,
      allowBackorder: true,
    }).status,
    "awaiting_approval",
  );
  assert.deepEqual(effects(f), before);
  const clean = quote(f);
  policy(f, true);
  assert.throws(
    () =>
      f.app.orders.accept(f.actor, "flipped", {
        quoteId: clean.id,
        allowBackorder: false,
      }),
    { code: "POLICY_CHANGED" },
  );
  assert.deepEqual(effects(f), before);
});

test("revocation applies to cached quotes and exact catalog/search/cursor reads; retained requests can be withdrawn", (t) => {
  const f = fixture(t),
    b = buyer(f);
  policy(f);
  const request = submit(f, b),
    cart = f.app.orders.carts(b)[0]!;
  policy(f, true, "none");
  assert.throws(
    () =>
      f.app.orders.quote(b, `quote-${cart.revision}`, {
        cartId: cart.id,
        revision: cart.revision,
      }),
    { code: "PRODUCT_ACCESS" },
  );
  assert.throws(() => f.app.catalog.product(b, f.product), {
    code: "PRODUCT_ACCESS",
  });
  assert.throws(() => f.app.catalog.price(b, f.product, f.buyer), {
    code: "PRODUCT_ACCESS",
  });
  assert.deepEqual(
    f.app.catalog.customerProductPage(b, f.buyer, undefined, "EQ"),
    { items: [], next: null },
  );
  assert.throws(
    () => f.app.catalog.customerProductPage(b, f.buyer, f.product),
    { code: "CURSOR" },
  );
  assert.equal(f.app.orders.reviewRequest(b, request.id).lines.length, 1);
  assert.equal(
    f.app.orders.withdrawReview(b, "withdraw-revoked", {
      requestId: request.id,
      revision: request.revision,
    }).status,
    "withdrawn",
  );
});

test("changed policy rejects stale staff decline/info decisions and idempotency rejects changed approval payload", (t) => {
  const f = fixture(t);
  policy(f);
  const request = submit(f);
  const old = {
    requestId: request.id,
    revision: request.revision,
    expectedHash: request.expectedHash,
    action: "decline" as const,
    message: "Initial review",
  };
  f.app.catalog.setProductPurchasingPolicy(f.actor, "updated-policy", {
    productId: f.product,
    requiresReview: true,
    revision: 0,
    reason: "Changed policy",
  });
  assert.throws(
    () => f.app.orders.decideReview(f.actor, "stale-decline", old),
    { code: "REVIEW_CHANGED" },
  );
  const current = f.app.orders.reviewRequest(f.actor, request.id);
  const declined = f.app.orders.decideReview(f.actor, "decline", {
    ...old,
    expectedHash: current.expectedHash,
  });
  assert.equal(declined.status, "declined");
  assert.throws(
    () =>
      f.app.orders.decideReview(f.actor, "decline", {
        ...old,
        expectedHash: current.expectedHash,
        message: "Different payload",
      }),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  assert.equal(f.app.orders.list(f.actor).length, 0);
});

type RaceInput = {
  actor: Actor;
  key: string;
  action: "decide" | "withdraw" | "resubmit";
  payload:
    | OrderRequestDecisionInput
    | OrderRequestWithdrawInput
    | OrderRequestResubmitInput;
};
type RaceResult = { ok: boolean; code?: string; result?: OrderRequest };
async function race(
  t: { after: (fn: () => void) => void },
  f: Fixture,
  inputs: RaceInput[],
) {
  const children: ChildProcess[] = [],
    ready: Promise<void>[] = [],
    results: Promise<RaceResult>[] = [];
  for (const input of inputs) {
    const child = fork(new URL("./purchasing-child.ts", import.meta.url), [], {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    children.push(child);
    let markReady!: () => void,
      resolveResult!: (r: RaceResult) => void,
      rejectResult!: (e: Error) => void,
      rejectReady!: (e: Error) => void;
    ready.push(
      new Promise<void>((resolve, reject) => {
        markReady = resolve;
        rejectReady = reject;
      }),
    );
    results.push(
      new Promise<RaceResult>((resolve, reject) => {
        resolveResult = resolve;
        rejectResult = reject;
      }),
    );
    let stderr = "";
    child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
    child.on("message", (message: any) =>
      message.ready ? markReady() : resolveResult(message),
    );
    const reject = (error: Error) => {
      rejectReady(error);
      rejectResult(error);
    };
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0)
        reject(new Error(`Review process exited ${code}: ${stderr}`));
    });
    child.send({ action: "init", input: { ...input, path: f.path } });
  }
  t.after(() => children.forEach((child) => child.kill()));
  await Promise.all(ready);
  children.forEach((child) => child.send({ action: "go" }));
  return Promise.all(results);
}
function approval(f: Fixture, r: OrderRequest, key: string): RaceInput {
  return {
    actor: f.actor,
    key,
    action: "decide",
    payload: {
      requestId: r.id,
      revision: r.revision,
      expectedHash: r.expectedHash,
      action: "approve",
      message: "Concurrent synthetic approval",
    },
  };
}
for (const sameKey of [false, true])
  test(
    `separate-process approval contention with ${sameKey ? "same" : "different"} keys commits one order`,
    { timeout: 10000 },
    async (t) => {
      const f = fixture(t);
      policy(f);
      const request = submit(f);
      const inputs = [
        approval(f, request, "approval-a"),
        approval(f, request, sameKey ? "approval-a" : "approval-b"),
      ];
      const results = await race(t, f, inputs);
      assert.equal(results.filter((r) => r.ok).length, sameKey ? 2 : 1);
      if (!sameKey)
        assert.equal(results.find((r) => !r.ok)?.code, "REVIEW_CHANGED");
      else
        assert.equal(results[0]!.result!.orderId, results[1]!.result!.orderId);
      assert.equal(f.app.orders.list(f.actor).length, 1);
      assert.equal(f.app.billing.exposure(f.actor, f.buyer).total, 11300);
      assert.equal(f.app.inventory.availability(f.actor, f.product, f.w1), 2);
      assert.equal(effects(f)[4]!.length, 1);
    },
  );
for (const resource of ["stock", "credit"] as const)
  test(
    `separate-process approvals contend for remaining ${resource}`,
    { timeout: 10000 },
    async (t) => {
      const f = fixture(t);
      policy(f);
      if (resource === "credit")
        f.app.database
          .owned("iam")
          .run(
            "UPDATE iam_accounts SET credit_limit=11300 WHERE id=?",
            f.buyer,
          );
      if (resource === "stock")
        f.app.database
          .owned("inventory")
          .run(
            "UPDATE inventory_units SET condition='quarantine' WHERE serial IN('S2','S3')",
          );
      const first = submit(f),
        second = submit(f);
      const results = await race(t, f, [
        approval(f, first, "first"),
        approval(f, second, "second"),
      ]);
      assert.equal(results.filter((r) => r.ok).length, 1);
      assert.equal(
        results.find((r) => !r.ok)?.code,
        resource === "stock" ? "STOCK" : "CREDIT_LIMIT",
      );
      assert.equal(f.app.orders.list(f.actor).length, 1);
      assert.equal(f.app.billing.exposure(f.actor, f.buyer).total, 11300);
      const failedId = results[0]!.ok ? second.id : first.id;
      assert.equal(
        f.app.orders.reviewRequest(f.actor, failedId).status,
        "awaiting_approval",
      );
    },
  );
for (const action of ["withdraw", "resubmit"] as const)
  test(
    `separate-process ${action} and approval reject the losing revision`,
    { timeout: 10000 },
    async (t) => {
      const f = fixture(t),
        b = buyer(f);
      policy(f);
      const request = submit(f, b);
      const next = quote(f, b, 2);
      const payload =
        action === "withdraw"
          ? { requestId: request.id, revision: request.revision }
          : {
              requestId: request.id,
              revision: request.revision,
              quoteId: next.id,
              allowBackorder: false,
              message: "Updated customer request",
            };
      const results = await race(t, f, [
        approval(f, request, "staff-decision"),
        { actor: b, key: "buyer-change", action, payload },
      ]);
      assert.equal(results.filter((r) => r.ok).length, 1);
      assert.ok(
        ["REVISION", "REVIEW_CHANGED"].includes(
          results.find((r) => !r.ok)!.code!,
        ),
      );
      const current = f.app.orders.reviewRequest(b, request.id);
      assert.equal(current.revision, 2);
      assert.equal(f.app.orders.list(b).length, results[0]!.ok ? 1 : 0);
      assert.equal(
        f.app.billing.exposure(f.actor, f.buyer).total,
        results[0]!.ok ? 11300 : 0,
      );
    },
  );

for (const action of ["withdraw", "resubmit"] as const)
  test(`cached ${action} receipt hides staff notes after current actor becomes a buyer`, (t) => {
    const f = fixture(t);
    policy(f);
    const actor = buyer(f);
    f.app.database
      .owned("iam")
      .run(
        "UPDATE iam_users SET role='commercial',account_id=NULL WHERE id=?",
        actor.id,
      );
    const request = submit(f, actor);
    const information = decide(f, request.id, f.actor, "request_information");
    const q = quote(f, actor);
    const input = {
      requestId: request.id,
      revision: information.revision,
      quoteId: q.id,
      allowBackorder: false,
      message: "Synthetic response",
    };
    const run = () =>
      action === "withdraw"
        ? f.app.orders.withdrawReview(actor, "role-changing-receipt", input)
        : f.app.orders.resubmitReview(actor, "role-changing-receipt", input);
    assert.ok(
      run().history.some((h) => h.staffNote === "Internal synthetic note"),
    );
    f.app.database
      .owned("iam")
      .run(
        "UPDATE iam_users SET role='buyer',account_id=? WHERE id=?",
        f.buyer,
        actor.id,
      );
    assert.equal(
      run().history.some((h) => "staffNote" in h),
      false,
    );
  });
