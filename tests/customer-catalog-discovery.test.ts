import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.ts";
import { seedCustomerPricing } from "./customer-pricing-fixture.ts";
import { createHttp } from "../src/server/http.ts";
import { readNavigation, navigationHash } from "../src/web/navigation.ts";

test("customer category filtering precedes bounded pagination and exact selection checks entitlement", async (t) => {
  const f = fixture(t),
    p = seedCustomerPricing(f);
  const ids = Array.from(
    { length: 24 },
    (_, index) =>
      f.app.catalog.create(f.actor, `category-${index}`, {
        sku: `AA-${String(index).padStart(2, "0")}`,
        name: `Bulk ${index}`,
        serialized: false,
        unitPrice: 1000,
        taxBasisPoints: 1300,
      }).id,
  );
  assert.ok(
    !f.app.catalog
      .customerProductPage(p.buyer, f.buyer)
      .items.some((row) => row.id === f.product),
  );
  const equipment = f.app.catalog.customerProductPage(
    p.buyer,
    f.buyer,
    undefined,
    "",
    "serialized",
  );
  assert.deepEqual(
    equipment.items.map((row) => row.id),
    [f.product],
  );
  assert.equal(equipment.next, null);
  assert.equal(equipment.items[0]!.unit_price, 8199);
  const first = f.app.catalog.customerProductPage(
    p.buyer,
    f.buyer,
    undefined,
    "",
    "bulk",
  );
  const second = f.app.catalog.customerProductPage(
    p.buyer,
    f.buyer,
    first.next!,
    "",
    "bulk",
  );
  assert.deepEqual(
    [...first.items, ...second.items].map((row) => row.id),
    ids,
  );
  assert.equal(second.next, null);
  const selected = f.app.catalog.customerProductPage(
    p.buyer,
    f.buyer,
    undefined,
    "",
    "",
    ids[23],
  );
  assert.deepEqual(
    selected.items.map((row) => row.id),
    [ids[23]],
  );
  assert.equal(selected.next, null);
  // Direct selections use the same visibility, retirement and current-price predicates.
  f.app.catalog.setProductAvailability(f.actor, "hide-direct-product", {
    productId: ids[22]!,
    hidden: true,
    outOfStock: false,
    expectedAvailableOn: null,
    revision: 0,
    reason: "Synthetic hidden product",
  });
  f.app.database
    .owned("catalog")
    .run("UPDATE catalog_products SET active=0 WHERE id=?", ids[21]!);
  for (const productId of [ids[22], ids[21], "unknown-product"]) {
    assert.deepEqual(
      f.app.catalog.customerProductPage(
        p.buyer,
        f.buyer,
        undefined,
        "",
        "bulk",
        productId,
      ),
      { items: [], next: null },
    );
  }
  const foreign = fixture(t);
  assert.deepEqual(
    f.app.catalog.customerProductPage(
      p.buyer,
      f.buyer,
      undefined,
      "",
      "serialized",
      foreign.product,
    ),
    { items: [], next: null },
  );
  assert.throws(
    () =>
      f.app.catalog.customerProductPage(
        foreign.actor,
        f.buyer,
        undefined,
        "",
        "",
        f.product,
      ),
    { code: "FORBIDDEN" },
  );
  const directEquipment = f.app.catalog.customerProductPage(
    p.buyer,
    f.buyer,
    undefined,
    "",
    "serialized",
    f.product,
  );
  assert.deepEqual(directEquipment, equipment);
  assert.ok(
    directEquipment.items.every(
      (row) =>
        !("unitCostCents" in row) && !("tier" in row) && !("org_id" in row),
    ),
  );
  f.app.catalog.setPurchasingPolicy(f.actor, "discovery-restrict", {
    ...f.app.catalog.purchasingPolicy(f.actor, f.buyer),
    mode: "selected",
    productIds: [f.product],
    reason: "Restrict synthetic account",
  });
  assert.deepEqual(
    f.app.catalog.customerProductPage(
      p.buyer,
      f.buyer,
      undefined,
      "",
      "bulk",
      ids[23],
    ),
    { items: [], next: null },
  );
  assert.throws(
    () =>
      f.app.catalog.customerProductPage(
        p.buyer,
        p.other,
        undefined,
        "",
        "",
        f.product,
      ),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () =>
      f.app.catalog.customerProductPage(
        p.buyer,
        f.buyer,
        undefined,
        "",
        "unsupported",
      ),
    { code: "VALIDATION" },
  );
  const http = await createHttp(f.app, {
    origin: "http://localhost",
    secureCookies: false,
  });
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
  const cookie = login.headers["set-cookie"]!.toString().split(";")[0]!;
  const response = await http.inject({
    headers: { cookie },
    method: "GET",
    url: `/api/catalog/customer-products/page?accountId=${f.buyer}&category=unsupported`,
  });
  assert.equal(response.statusCode, 400);
});

test("Shop locations allow only safe product metadata", () => {
  const hash = navigationHash({ page: "Shop", productId: "product-123" });
  assert.equal(hash, "#page=Shop&product=product-123");
  assert.equal(readNavigation(hash).productId, "product-123");
  assert.equal(
    readNavigation("#page=Shop&product=%3Cscript%3E").productId,
    undefined,
  );
  assert.equal(
    readNavigation("#page=Billing&product=product-123").productId,
    undefined,
  );
});

test("photo-first customer discovery paginates published photos before unpictured products without omissions", async (t) => {
  const f = fixture(t),
    p = seedCustomerPricing(f);
  const { createCanvas } = await import("@napi-rs/canvas");
  const canvas = createCanvas(10, 10);
  canvas.getContext("2d").fillRect(0, 0, 10, 10);
  const ids: string[] = [];
  for (let i = 0; i < 25; i++) {
    const product = f.app.catalog.create(f.actor, `photo-sort-${i}`, {
      sku: `${i < 21 ? "AA" : "ZZ"}-${String(i).padStart(2, "0")}`,
      name: `Discovery fixture ${i}`,
      serialized: false,
      unitPrice: 1000,
      taxBasisPoints: 1300,
    });
    ids.push(product.id);
    if (i >= 20) {
      const image = await f.app.catalogMedia.upload(
        f.actor,
        `photo-upload-${i}`,
        product.id,
        {
          kind: "image",
          title: "Synthetic photo",
          altText: "Synthetic fixture artwork",
          mediaType: "image/png",
          contentBase64: canvas.toBuffer("image/png").toString("base64"),
        },
      );
      if (i > 20)
        await f.app.catalogMedia.publish(
          f.actor,
          `photo-publish-${i}`,
          product.id,
          image.id,
          {
            expectedVersion: image.version,
            permissionAffirmed: true,
            permissionBasis: "Owned synthetic fixture artwork",
          },
        );
    }
  }
  const first = f.app.catalog.customerProductPage(
    p.buyer,
    f.buyer,
    undefined,
    "",
    "",
    undefined,
    "images-first",
  );
  assert.deepEqual(
    first.items.slice(0, 4).map((p) => p.id),
    ids.slice(21),
  );
  assert.ok(first.next);
  const second = f.app.catalog.customerProductPage(
    p.buyer,
    f.buyer,
    first.next!,
    "",
    "",
    undefined,
    "images-first",
  );
  const all = [...first.items, ...second.items];
  assert.equal(second.next, null);
  assert.equal(all.length, 26);
  assert.equal(new Set(all.map((p) => p.id)).size, 26);
  assert.ok(all.slice(4).every((p) => !p.hasPublishedImage));
  const selected = f.app.catalog.customerProductPage(
    p.buyer,
    f.buyer,
    undefined,
    "",
    "bulk",
    ids[0],
    "images-first",
  );
  assert.deepEqual(
    selected.items.map((p) => p.id),
    [ids[0]],
  );
  assert.throws(
    () =>
      f.app.catalog.customerProductPage(
        p.buyer,
        f.buyer,
        undefined,
        "",
        "",
        undefined,
        "invalid",
      ),
    /supported catalog sort/,
  );
});
