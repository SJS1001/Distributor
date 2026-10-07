import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture } from "./fixtures.ts";

function seed(f: ReturnType<typeof fixture>) {
  const accessory = (key: string, sku: string, name: string) =>
    f.app.catalog.create(f.actor, key, {
      sku,
      name,
      serialized: false,
      unitPrice: 2500,
      taxBasisPoints: 1300,
    }).id;
  const bracket = accessory("bracket", "BRK-1", "Synthetic wall bracket"),
    kit = accessory("kit", "KIT-1", "Synthetic install kit");
  const user = f.app.identity.createUser(f.actor, "addon-buyer", {
    name: "Add-on buyer",
    email: "addon-buyer@example.test",
    password: "long-test-only-password",
    role: "buyer",
    sites: [],
    accountId: f.buyer,
  });
  const buyer = f.app.identity.currentActor({
    ...f.actor,
    id: user.id,
  });
  return { bracket, kit, buyer };
}

test("staff configure ordered add-ons with revision checks and validation", (t) => {
  const f = fixture(t),
    { bracket, kit, buyer } = seed(f);
  assert.deepEqual(f.app.catalog.productAddons(f.actor, f.product), {
    productId: f.product,
    addons: [],
    revision: 0,
  });
  const input = {
    productId: f.product,
    addonIds: [kit, bracket],
    revision: 0,
    reason: "Install kit and bracket fit this unit",
  };
  const saved = f.app.catalog.setProductAddons(f.actor, "addons-1", input);
  assert.equal(saved.revision, 1);
  assert.deepEqual(
    saved.addons.map((a) => a.sku),
    ["KIT-1", "BRK-1"],
  );
  // Replaying the same command key returns the committed result unchanged.
  assert.deepEqual(
    f.app.catalog.setProductAddons(f.actor, "addons-1", input),
    saved,
  );
  assert.deepEqual(f.app.catalog.productAddons(f.actor, f.product), saved);
  assert.throws(
    () =>
      f.app.catalog.setProductAddons(f.actor, "addons-stale", {
        ...input,
        addonIds: [bracket],
      }),
    { code: "REVISION" },
  );
  for (const [key, addonIds, code] of [
    ["self", [f.product], "VALIDATION"],
    ["duplicate", [kit, kit], "VALIDATION"],
    ["missing", ["missing-product"], "NOT_FOUND"],
  ] as const)
    assert.throws(
      () =>
        f.app.catalog.setProductAddons(f.actor, `addons-${key}`, {
          ...input,
          addonIds: [...addonIds],
          revision: 1,
        }),
      { code },
    );
  assert.throws(
    () =>
      f.app.catalog.setProductAddons(f.actor, "addons-too-many", {
        ...input,
        addonIds: Array.from({ length: 13 }, (_, i) => `p-${i}`),
        revision: 1,
      }),
    { code: "VALIDATION" },
  );
  assert.throws(
    () =>
      f.app.catalog.setProductAddons(buyer, "addons-buyer", {
        ...input,
        revision: 1,
      }),
    { code: "FORBIDDEN" },
  );
  const cleared = f.app.catalog.setProductAddons(f.actor, "addons-clear", {
    ...input,
    addonIds: [],
    revision: 1,
  });
  assert.deepEqual(cleared.addons, []);
  assert.equal(cleared.revision, 2);
});

test("buyers see only configured add-ons they may purchase, at account prices", (t) => {
  const f = fixture(t),
    { bracket, kit, buyer } = seed(f);
  f.app.catalog.setProductAddons(f.actor, "addons", {
    productId: f.product,
    addonIds: [kit, bracket],
    revision: 0,
    reason: "Install kit and bracket fit this unit",
  });
  const all = f.app.catalog.customerAddons(buyer, f.buyer, [f.product, kit]);
  // Only the main unit has add-ons; the kit has none of its own.
  assert.deepEqual(
    all.suggestions.map((s) => [
      s.productId,
      s.addons.map((a) => [a.sku, a.unit_price, a.unit_tax]),
    ]),
    [
      [
        f.product,
        [
          ["KIT-1", 2500, 325],
          ["BRK-1", 2500, 325],
        ],
      ],
    ],
  );
  // Restricting the account's catalog removes the bracket from suggestions.
  const policy = f.app.catalog.purchasingPolicy(f.actor, f.buyer);
  f.app.catalog.setPurchasingPolicy(f.actor, "selected", {
    ...policy,
    mode: "selected",
    productIds: [f.product, kit],
    reason: "Synthetic selected catalog",
  });
  assert.deepEqual(
    f.app.catalog
      .customerAddons(buyer, f.buyer, [f.product])
      .suggestions[0]!.addons.map((a) => a.sku),
    ["KIT-1"],
  );
  // A main unit the account cannot buy discloses nothing about its add-ons.
  f.app.catalog.setPurchasingPolicy(f.actor, "kit-only", {
    ...f.app.catalog.purchasingPolicy(f.actor, f.buyer),
    mode: "selected",
    productIds: [kit, bracket],
    reason: "Synthetic accessory-only catalog",
  });
  assert.deepEqual(
    f.app.catalog.customerAddons(buyer, f.buyer, [f.product]).suggestions,
    [],
  );
  for (const ids of [[], [kit, kit]])
    assert.throws(() => f.app.catalog.customerAddons(buyer, f.buyer, ids), {
      code: "VALIDATION",
    });
});
