import assert from "node:assert/strict";
import { test } from "node:test";
import data from "../src/web/gree-catalog-data.json" with { type: "json" };
import { fixture } from "./fixtures.ts";
import { seedCustomerPricing } from "./customer-pricing-fixture.ts";
import { createHttp } from "../src/server/http.ts";
const family = data.products[0]!,
  reference = { familyId: family.id, modelId: family.models[0]!.id };
const mapping = (productId: string) => ({
  productId,
  ...reference,
  revision: 0,
  reason: "Reviewed native manufacturer's model equivalence",
});
test("reference links require reviewed admin mapping and preserve revision/idempotency/current authority", (t) => {
  const f = fixture(t),
    p = seedCustomerPricing(f),
    input = mapping(f.product);
  assert.deepEqual(f.app.catalog.productReference(f.actor, f.product), {
    productId: f.product,
    familyId: null,
    modelId: null,
    revision: 0,
  });
  for (const actor of [
    p.buyer,
    p.commercial,
    { ...p.buyer, role: "admin" as const },
  ]) {
    assert.throws(
      () => f.app.catalog.setProductReference(actor, "denied", input),
      { code: "FORBIDDEN" },
    );
    assert.throws(() => f.app.catalog.productReference(actor, f.product), {
      code: "FORBIDDEN",
    });
  }
  for (const value of [
    { familyId: "invented", modelId: null },
    { familyId: reference.familyId, modelId: null },
    { familyId: reference.familyId, modelId: data.products[1]!.models[0]!.id },
  ])
    assert.throws(
      () =>
        f.app.catalog.setProductReference(f.actor, "invalid-" + value.modelId, {
          ...input,
          ...value,
        }),
      { code: "REFERENCE" },
    );
  const result = f.app.catalog.setProductReference(f.actor, "mapped", input);
  assert.deepEqual(
    f.app.catalog.setProductReference(f.actor, "mapped", input),
    result,
  );
  assert.throws(
    () => f.app.catalog.setProductReference(f.actor, "stale", input),
    { code: "REVISION" },
  );
  assert.throws(
    () =>
      f.app.catalog.setProductReference(f.actor, "mapped", {
        ...input,
        reason: "changed",
      }),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  const rows = f.app.database
    .owned("platform")
    .all<{ detail: string }>(
      "SELECT detail FROM platform_audit WHERE action='catalog.reference.changed'",
    );
  assert.equal(rows.length, 1);
  assert.equal(JSON.parse(rows[0]!.detail).reason, input.reason);
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='commercial' WHERE id=?", f.actor.id);
  assert.throws(
    () => f.app.catalog.setProductReference(f.actor, "mapped", input),
    { code: "FORBIDDEN" },
  );
});
test("customer reference resolution uses current eligibility, explicit prices, global availability and native approval", (t) => {
  const f = fixture(t),
    p = seedCustomerPricing(f);
  assert.deepEqual(f.app.catalog.customerReference(p.buyer, reference), {
    products: [],
    mapped: false,
    truncated: false,
  });
  f.app.catalog.setProductReference(f.actor, "mapped", mapping(f.product));
  const resolved = f.app.catalog.customerReference(p.buyer, reference);
  assert.equal(resolved.products[0]!.unit_price, 8199);
  assert.equal("pricing" in resolved.products[0]!, false);
  assert.equal(resolved.mapped, true);
  assert.throws(
    () => f.app.catalog.customerReference(p.buyer, reference, p.other),
    { code: "FORBIDDEN" },
  );
  f.app.catalog.setProductPurchasingPolicy(f.actor, "approval", {
    productId: f.product,
    requiresReview: true,
    revision: 0,
    reason: "Controlled product",
  });
  assert.equal(
    f.app.catalog.customerReference(p.buyer, reference).mapped,
    true,
  );
  assert.equal(
    f.app.catalog.purchasingSnapshot(p.buyer, f.buyer, [f.product])
      .requiresReview,
    true,
  );
  const availability = (hidden: boolean, outOfStock = false) =>
    f.app.catalog.setProductAvailability(
      f.actor,
      "availability-" + hidden + outOfStock,
      {
        ...f.app.catalog.productAvailability(f.actor, f.product),
        hidden,
        outOfStock,
        expectedAvailableOn: null,
        reason: "Current availability",
      },
    );
  availability(true);
  assert.deepEqual(f.app.catalog.customerReference(p.buyer, reference), {
    products: [],
    mapped: false,
    truncated: false,
  });
  availability(false, true);
  assert.equal(
    f.app.catalog.customerReference(p.buyer, reference).products[0]!.outOfStock,
    true,
  );
  f.app.catalog.setPurchasingPolicy(f.actor, "deny", {
    ...f.app.catalog.purchasingPolicy(f.actor, f.buyer),
    mode: "none",
    reason: "Access revoked",
  });
  assert.equal(
    f.app.catalog.customerReference(p.buyer, reference).mapped,
    false,
  );
  assert.equal(
    f.app.catalog.customerReference(p.partner, reference).products[0]!
      .unit_price,
    4200,
  );
  f.app.catalog.setProductMsrp(f.actor, "msrp", {
    productId: f.product,
    msrpCents: 10001,
    revision: 0,
    reason: "Explicit MSRP",
  });
  f.app.catalog.setPricingPolicy(f.actor, "multiplier", {
    accountId: p.other,
    multiplierBp: 5000,
    displayMode: "detailed",
    revision: 0,
    reason: "Approved terms",
  });
  assert.equal(
    f.app.catalog.customerReference(p.partner, reference).products[0]!
      .unit_price,
    5001,
  );
  f.app.catalog.setProductMsrp(f.actor, "remove-msrp", {
    productId: f.product,
    msrpCents: null,
    revision: 1,
    reason: "Unverified MSRP",
  });
  assert.equal(
    f.app.catalog.customerReference(p.partner, reference).mapped,
    false,
  );
});
test("public requested reference is validated and retained for reviewer without approving a product", (t) => {
  const f = fixture(t),
    input = {
      businessName: "Synthetic Contractor",
      contactName: "Contact",
      email: "reference@example.test",
      phone: "416-555-0100",
      province: "ON" as const,
      acknowledgment: true as const,
      notes: "Interested in reference",
      requestedReference: reference,
    };
  f.app.enrollment.submit(f.actor.orgId, input);
  const row = f.app.enrollment.queue(f.actor).items[0]!;
  assert.match(row.notes, /Interested in reference/);
  assert.ok(row.notes.includes(family.title));
  assert.ok(row.notes.includes(reference.modelId));
  assert.equal(row.status, "pending");
  assert.throws(
    () =>
      f.app.enrollment.submit(f.actor.orgId, {
        ...input,
        requestedReference: { familyId: "invented", modelId: null },
      }),
    { code: "REFERENCE" },
  );
  assert.equal(f.app.enrollment.queue(f.actor).items.length, 1);
});
test("reference HTTP validates scope, CSRF, no-store and optional requested application context", async (t) => {
  const f = fixture(t),
    p = seedCustomerPricing(f),
    origin = "https://distributor.example.test",
    http = await createHttp(f.app, {
      origin,
      enrollmentOrganizationId: f.actor.orgId,
    });
  t.after(() => void http.close());
  await http.ready();
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
    buyer = await login("pricing-buyer@example.test"),
    url = `/api/customer-products/reference?familyId=${reference.familyId}&modelId=${reference.modelId}`;
  assert.equal((await http.inject({ url })).statusCode, 401);
  assert.equal(
    (
      await http.inject({
        url: `/api/catalog/products/${f.product}/reference`,
        headers: buyer,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: "/api/commands/catalog.reference.set",
        headers: { origin, cookie: admin.cookie, "idempotency-key": "csrf" },
        payload: mapping(f.product),
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: "/api/commands/catalog.reference.set",
        headers: { ...admin, "idempotency-key": "map" },
        payload: mapping(f.product),
      })
    ).statusCode,
    200,
  );
  const r = await http.inject({
    url: url + `&accountId=${f.buyer}`,
    headers: buyer,
  });
  assert.equal(r.statusCode, 200);
  assert.match(r.headers["cache-control"]!, /no-store/);
  assert.equal(r.json().products[0].unit_price, 8199);
  assert.equal(
    (await http.inject({ url: url + `&accountId=${p.other}`, headers: buyer }))
      .statusCode,
    403,
  );
  const apply = await http.inject({
    method: "POST",
    url: "/api/enrollment/applications",
    headers: { origin },
    payload: {
      businessName: "Interested",
      contactName: "Buyer",
      email: "apply-reference@example.test",
      phone: "416-555-0100",
      province: "ON",
      acknowledgment: true,
      requestedReference: reference,
    },
  });
  assert.equal(apply.statusCode, 202);
  assert.ok(
    f.app.enrollment.queue(f.actor).items[0]!.notes.includes(reference.modelId),
  );
});
