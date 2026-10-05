import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture } from "./fixtures.ts";
import { seedCustomerPricing } from "./customer-pricing-fixture.ts";
import { createHttp } from "../src/server/http.ts";
import { Application } from "../src/server/application.ts";
import type { PriceApprovalPolicyInput } from "../src/shared/price-authority.ts";
type F = ReturnType<typeof fixture>;
test("mandatory MFA is enforced for direct authority reads, writes, assessments and idempotent replay", (t) => {
  const f = fixture(t),
    input = {
      productId: f.product,
      unitCostCents: 5000,
      revision: 0,
      reason: "Reviewed baseline",
    };
  f.app.catalog.setReviewedUnitCost(f.actor, "reviewed-cost", input);
  f.app.close();
  f.app = new Application(f.path, "CA", {
    mfaEncryptionKey: "ab".repeat(32),
    mfaRequiredRoles: ["admin"],
  });
  for (const operation of [
    () => f.app.catalog.reviewedUnitCost(f.actor, f.product),
    () => f.app.catalog.priceApprovalPolicy(f.actor),
    () => f.app.catalog.priceAuthorityHistory(f.actor, {}),
    () => f.app.catalog.setReviewedUnitCost(f.actor, "reviewed-cost", input),
    () =>
      f.app.catalog.setPriceApprovalPolicy(f.actor, "policy", {
        maxDiscountBp: 2000,
        minMarginBp: 2000,
        revision: 0,
        reason: "Limits",
      }),
    () =>
      f.app.database.transaction(() =>
        f.app.catalog.assessPriceOverride(f.actor, f.buyer, f.product, 9000),
      ),
  ])
    assert.throws(operation, { code: "MFA_ENROLLMENT_REQUIRED" });
  assert.equal(
    f.app.database
      .owned("catalog")
      .get("SELECT COUNT(*) AS n FROM catalog_price_authority_history")!.n,
    1,
  );
});
const cost = (f: F, unitCostCents: number | null) =>
  f.app.catalog.setReviewedUnitCost(
    f.actor,
    `cost-${f.app.catalog.reviewedUnitCost(f.actor, f.product).revision}`,
    {
      productId: f.product,
      unitCostCents,
      revision: f.app.catalog.reviewedUnitCost(f.actor, f.product).revision,
      reason: "Reviewed wholesale baseline; not receipt valuation",
    },
  );
const policy = (
  f: F,
  maxDiscountBp: number | null,
  minMarginBp: number | null,
) =>
  f.app.catalog.setPriceApprovalPolicy(
    f.actor,
    `policy-${f.app.catalog.priceApprovalPolicy(f.actor).revision}`,
    {
      ...f.app.catalog.priceApprovalPolicy(f.actor),
      maxDiscountBp,
      minMarginBp,
      reason: "Approved exception thresholds",
    },
  );
for (const region of ["CA", "US"] as const)
  test(`pricing authority uses exact negotiated discount and reviewed margin (${region})`, (t) => {
    const f = fixture(t, {}, region),
      p = seedCustomerPricing(f),
      assess = (price: number) =>
        f.app.database.transaction(() =>
          f.app.catalog.assessPriceOverride(p.buyer, f.buyer, f.product, price),
        );
    assert.deepEqual(f.app.catalog.priceApprovalPolicy(f.actor), {
      maxDiscountBp: null,
      minMarginBp: null,
      revision: 0,
    });
    assert.deepEqual(f.app.catalog.reviewedUnitCost(f.actor, f.product), {
      productId: f.product,
      unitCostCents: null,
      currency: region === "CA" ? "CAD" : "USD",
      revision: 0,
    });
    assert.equal(assess(8199).requiresApproval, true);
    assert.equal(assess(8199).reasons.length, 2);
    cost(f, 4500);
    policy(f, 2000, 2500);
    const allowed = assess(7000);
    assert.equal(allowed.ordinaryUnitPrice, 8199);
    assert.equal(allowed.requiresApproval, false);
    assert.equal(allowed.taxBasisPoints, 1300);
    assert.equal(allowed.evidence.unitCostCents, 4500);
    // Discount exact threshold: 8199 * .8 = 6559.2; 6559 must fail, 6560 must pass.
    assert.equal(assess(6559).requiresApproval, true);
    assert.equal(assess(6560).requiresApproval, false);
    policy(f, 10000, 2500);
    assert.equal(assess(6000).requiresApproval, false);
    assert.equal(assess(5999).requiresApproval, true);
    assert.notEqual(assess(7000).authorityHash, allowed.authorityHash);
    const before = assess(7000);
    cost(f, 4501);
    assert.notEqual(assess(7000).authorityHash, before.authorityHash);
    policy(f, 10000, 0);
    cost(f, 0);
    assert.equal(assess(0).requiresApproval, true);
    assert.match(assess(0).reasons.join(" "), /zero selling/);
    assert.equal(assess(1).requiresApproval, false);
    cost(f, null);
    assert.equal(assess(100000).requiresApproval, true);
    cost(f, 1e9);
    assert.equal(assess(1).requiresApproval, true);
    assert.throws(() => assess(Number.MAX_SAFE_INTEGER), {
      code: "VALIDATION",
    });
    assert.throws(
      () => f.app.catalog.assessPriceOverride(p.buyer, f.buyer, f.product, 10),
      { code: "TRANSACTION" },
    );
    assert.throws(
      () =>
        f.app.database.transaction(() =>
          f.app.catalog.assessPriceOverride(p.buyer, p.other, f.product, 10),
        ),
      { code: "FORBIDDEN" },
    );
    const projection = JSON.stringify(
      f.app.catalog.customerProducts(p.buyer, f.buyer),
    );
    assert.ok(!projection.includes("unitCost"));
    assert.ok(!projection.includes("margin"));
  });
test("cost and org policy writes are admin-only, revisioned, idempotent and visible in isolated history", (t) => {
  const f = fixture(t),
    p = seedCustomerPricing(f),
    input = {
      productId: f.product,
      unitCostCents: 1234,
      revision: 0,
      reason: "Supplier schedule reviewed",
    };
  for (const actor of [
    p.buyer,
    p.commercial,
    { ...p.buyer, role: "admin" as const },
  ]) {
    assert.throws(() => f.app.catalog.reviewedUnitCost(actor, f.product), {
      code: "FORBIDDEN",
    });
    assert.throws(() => f.app.catalog.priceApprovalPolicy(actor), {
      code: "FORBIDDEN",
    });
    assert.throws(() => f.app.catalog.priceAuthorityHistory(actor, {}), {
      code: "FORBIDDEN",
    });
    assert.throws(
      () => f.app.catalog.setReviewedUnitCost(actor, "denied", input),
      { code: "FORBIDDEN" },
    );
  }
  const result = f.app.catalog.setReviewedUnitCost(f.actor, "once", input);
  assert.deepEqual(
    f.app.catalog.setReviewedUnitCost(f.actor, "once", input),
    result,
  );
  assert.throws(
    () =>
      f.app.catalog.setReviewedUnitCost(f.actor, "once", {
        ...input,
        unitCostCents: 2000,
      }),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  assert.throws(
    () => f.app.catalog.setReviewedUnitCost(f.actor, "stale", input),
    { code: "REVISION" },
  );
  for (const patch of [
    { maxDiscountBp: null, minMarginBp: 0 },
    { maxDiscountBp: -1, minMarginBp: 0 },
    { maxDiscountBp: 10001, minMarginBp: 0 },
    { maxDiscountBp: 1.5, minMarginBp: 0 },
  ])
    assert.throws(
      () =>
        f.app.catalog.setPriceApprovalPolicy(f.actor, "invalid", {
          revision: 0,
          reason: "Invalid",
          ...patch,
        } as PriceApprovalPolicyInput),
      { code: "VALIDATION" },
    );
  policy(f, 1000, 2500);
  assert.equal(
    f.app.catalog.priceAuthorityHistory(f.actor, {}).items.length,
    1,
  );
  for (let i = 0; i < 21; i++) cost(f, i);
  const first = f.app.catalog.priceAuthorityHistory(f.actor, {
      productId: f.product,
    }),
    second = f.app.catalog.priceAuthorityHistory(f.actor, {
      productId: f.product,
      after: first.next!,
    });
  assert.equal(first.items.length, 20);
  assert.equal(second.items.length, 2);
  assert.equal(
    new Set([...first.items, ...second.items].map((x) => x.id)).size,
    22,
  );
  const original = second.items.find(
    (x) => (x.after as { unitCostCents: number }).unitCostCents === 1234,
  )!;
  assert.equal(original.reason, input.reason);
  assert.equal(
    (original.before as { unitCostCents: null }).unitCostCents,
    null,
  );
  assert.equal(original.actorId, f.actor.id);
  assert.throws(
    () => f.app.catalog.priceAuthorityHistory(f.actor, { after: first.next! }),
    { code: "CURSOR" },
  );
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='commercial' WHERE id=?", f.actor.id);
  assert.throws(
    () => f.app.catalog.setReviewedUnitCost(f.actor, "once", input),
    { code: "FORBIDDEN" },
  );
});
test("HTTP cost remains private and client currency/cost injection is rejected", async (t) => {
  const f = fixture(t);
  seedCustomerPricing(f);
  const origin = "https://distributor.example.test",
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
    return {
      origin,
      cookie: `${r.cookies[0]!.name}=${r.cookies[0]!.value}`,
      "x-csrf-token": r.json().csrf as string,
    };
  }
  const admin = await login("admin@example.test"),
    buyer = await login("pricing-buyer@example.test"),
    payload = {
      productId: f.product,
      unitCostCents: 6000,
      revision: 0,
      reason: "Reviewed cost",
    };
  for (const url of [
    `/api/catalog/products/${f.product}/unit-cost`,
    "/api/catalog/price-approval-policy",
    "/api/catalog/price-authority-history",
  ]) {
    assert.equal((await http.inject({ url, headers: buyer })).statusCode, 403);
    const r = await http.inject({ url, headers: admin });
    assert.equal(r.statusCode, 200);
    assert.match(r.headers["cache-control"]!, /no-store/);
  }
  const command = {
    method: "POST" as const,
    url: "/api/commands/catalog.unit-cost.set",
    headers: { ...admin, "idempotency-key": "cost" },
    payload,
  };
  assert.equal(
    (
      await http.inject({
        ...command,
        payload: { ...payload, currency: "USD" },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await http.inject({
        ...command,
        headers: { ...buyer, "idempotency-key": "cost" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await http.inject({
        ...command,
        headers: { origin, cookie: admin.cookie, "idempotency-key": "csrf" },
      })
    ).statusCode,
    403,
  );
  assert.equal((await http.inject(command)).statusCode, 200);
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: "/api/commands/catalog.price-approval-policy.set",
        headers: { ...admin, "idempotency-key": "policy" },
        payload: {
          maxDiscountBp: 1000,
          minMarginBp: 2000,
          revision: 0,
          reason: "Reviewed policy",
        },
      })
    ).statusCode,
    200,
  );
});
