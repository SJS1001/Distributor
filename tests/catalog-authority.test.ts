import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, accept } from "./fixtures.ts";
import type { Actor, Role } from "../src/server/core.ts";
import { Application } from "../src/server/application.ts";

function user(f: ReturnType<typeof fixture>, role: Role, name = role) {
  const result = f.app.identity.createUser(f.actor, name, {
    name,
    email: `catalog-${name}@example.test`,
    password: "long-catalog-password",
    role,
    sites: role === "buyer" ? [] : [f.w1],
    accountId: f.buyer,
  });
  return f.app.identity.currentActor({ ...f.actor, id: result.id });
}
function change(
  f: ReturnType<typeof fixture>,
  actor: Actor,
  updates: Record<string, unknown>,
) {
  const row = f.app.identity.users(f.actor).find((u) => u.id === actor.id)!;
  f.app.identity.updateUser(f.actor, `grant-${actor.id}-${row.revision}`, {
    userId: actor.id,
    revision: row.revision,
    name: actor.name,
    email: row.email,
    role: actor.role,
    sites: actor.sites,
    ...(actor.accountId ? { accountId: actor.accountId } : {}),
    active: true,
    currentPassword: "long-test-only-password",
    reason: "Synthetic catalog access change",
    ...updates,
  });
}
function facts(f: ReturnType<typeof fixture>) {
  return [
    ...["products", "prices"].map((n) =>
      f.app.database
        .owned("catalog")
        .all(`SELECT * FROM catalog_${n} ORDER BY rowid`),
    ),
    ...["commands", "audit", "audit_order", "audit_clock", "events"].map((n) =>
      f.app.database
        .owned("platform")
        .all(`SELECT * FROM platform_${n} ORDER BY rowid`),
    ),
  ];
}
const newProduct = {
  sku: "AUTH-1",
  name: "Synthetic catalog item",
  serialized: false,
  unitPrice: 2400,
  taxBasisPoints: 1300,
};
function importRow(f: ReturnType<typeof fixture>) {
  return {
    sourceId: "SOURCE-1",
    targetId: f.product,
    sku: "EQ-1",
    name: "Synthetic equipment",
    serialized: true,
    unitPrice: 10000,
    taxBasisPoints: 1300,
  };
}
function reads(f: ReturnType<typeof fixture>, actor: Actor) {
  return [
    () => f.app.catalog.product(actor, f.product),
    () => f.app.catalog.products(actor),
    () => f.app.catalog.productBySku(actor, "EQ-1"),
    () => f.app.catalog.price(actor, f.product, f.buyer),
    () => f.app.catalog.reviewImport(actor, importRow(f)),
    () => f.app.catalog.applyImport(actor, importRow(f)),
    () =>
      f.app.catalog.applyImport(actor, {
        ...importRow(f),
        targetId: null,
        sku: "DENIED-IMPORT",
      }),
  ];
}
function commands(f: ReturnType<typeof fixture>, actor: Actor) {
  const price = { productId: f.product, tier: "standard", unitPrice: 8100 };
  f.app.catalog.create(actor, "create-authority", newProduct);
  f.app.catalog.setPrice(actor, "price-authority", price);
  return (key: string) => [
    () =>
      f.app.catalog.create(
        actor,
        key ? `${key}-create` : "create-authority",
        newProduct,
      ),
    () =>
      f.app.catalog.setPrice(
        actor,
        key ? `${key}-price` : "price-authority",
        price,
      ),
  ];
}
function denied(operations: (() => unknown)[], code = "FORBIDDEN") {
  for (const operation of operations) assert.throws(operation, { code });
}

test("catalog reads and both cached/new commands reject unavailable principals without writes", (t) => {
  const f = fixture(t),
    actor = user(f, "admin"),
    operations = commands(f, actor);
  change(f, actor, { active: false });
  const before = facts(f);
  denied([...reads(f, actor), ...operations(""), ...operations("new")]);
  for (const invalid of [
    { ...actor, id: "absent-principal" },
    { ...actor, orgId: "foreign-organization" },
  ])
    denied(reads(f, invalid));
  assert.deepEqual(facts(f), before);
});

test("catalog role changes are checked before cached results and forged administrator fields", (t) => {
  const f = fixture(t),
    actor = user(f, "admin"),
    operations = commands(f, actor);
  change(f, actor, { role: "support", sites: [] });
  const before = facts(f);
  denied([
    ...operations(""),
    ...operations("new"),
    () => f.app.catalog.productBySku(actor, "EQ-1"),
    () => f.app.catalog.reviewImport(actor, importRow(f)),
    () => f.app.catalog.applyImport(actor, importRow(f)),
  ]);
  assert.equal(f.app.catalog.product(actor, f.product).sku, "EQ-1");
  assert.deepEqual(facts(f), before);
});

test("persisted commercial grants allow edits despite forged caller role and exact retries remain read-only", (t) => {
  const f = fixture(t),
    persisted = user(f, "commercial"),
    actor = { ...persisted, role: "support" as const, sites: [] };
  const operations = commands(f, actor),
    before = facts(f);
  for (const operation of operations("")) operation();
  assert.deepEqual(facts(f), before);
  assert.equal(f.app.catalog.price(actor, f.product, f.buyer).unitPrice, 8100);
});

test("forced password changes deny all catalog reads, imports and both cached/new commands", (t) => {
  const f = fixture(t),
    actor = user(f, "admin"),
    operations = commands(f, actor);
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
      actor.id,
    );
  const before = facts(f);
  denied(
    [...reads(f, actor), ...operations(""), ...operations("new")],
    "PASSWORD_CHANGE_REQUIRED",
  );
  assert.deepEqual(facts(f), before);
});

test("buyer pricing uses persisted account even with forged role/account, and follows reassignment", (t) => {
  const f = fixture(t),
    actor = user(f, "buyer");
  const other = f.app.identity.createCustomer(f.actor, "other", {
    name: "Other synthetic buyer",
    tier: "other-tier",
    creditLimit: 100000,
  }).id;
  f.app.catalog.setPurchasingPolicy(f.actor, "explicit-purchasing-" + other, {
    accountId: other,
    mode: "all",
    requiresReview: false,
    productIds: [],
    revision: 0,
    reason: "Explicit synthetic test catalog access",
  });
  f.app.catalog.setPrice(f.actor, "standard", {
    productId: f.product,
    tier: "standard",
    unitPrice: 8100,
  });
  f.app.catalog.setPrice(f.actor, "other", {
    productId: f.product,
    tier: "other-tier",
    unitPrice: 4300,
  });
  assert.equal(f.app.catalog.price(actor, f.product, f.buyer).unitPrice, 8100);
  denied([
    () =>
      f.app.catalog.price(
        { ...actor, role: "admin", accountId: other },
        f.product,
        other,
      ),
  ]);
  change(f, actor, { accountId: other });
  const before = facts(f);
  denied([() => f.app.catalog.price(actor, f.product, f.buyer)]);
  assert.equal(f.app.catalog.price(actor, f.product, other).unitPrice, 4300);
  assert.deepEqual(facts(f), before);
});

test("independent grant changes and SQLite restart fence prior catalog retries", (t) => {
  const f = fixture(t),
    actor = user(f, "commercial"),
    operations = commands(f, actor);
  const second = new Application(f.path, "CA");
  try {
    change({ ...f, app: second }, actor, { role: "warehouse" });
  } finally {
    second.close();
  }
  const before = facts(f);
  denied([...operations(""), ...operations("new")]);
  assert.deepEqual(facts(f), before);
  f.app.close();
  f.app = new Application(f.path, "CA");
  denied([
    () => f.app.catalog.create(actor, "create-authority", newProduct),
    () =>
      f.app.catalog.setPrice(actor, "price-authority", {
        productId: f.product,
        tier: "standard",
        unitPrice: 8100,
      }),
  ]);
  assert.deepEqual(facts(f), before);
});

test("fresh catalog authority preserves import matching and accepted order price snapshots", (t) => {
  const f = fixture(t);
  f.app.catalog.setPrice(f.actor, "before-order", {
    productId: f.product,
    tier: "standard",
    unitPrice: 8100,
  });
  const accepted = accept(f),
    before = f.app.orders.order(f.actor, accepted.id);
  f.app.catalog.setPrice(f.actor, "after-order", {
    productId: f.product,
    tier: "standard",
    unitPrice: 9100,
  });
  assert.deepEqual(f.app.orders.order(f.actor, accepted.id), before);
  assert.equal(
    f.app.catalog.price(f.actor, f.product, f.buyer).unitPrice,
    9100,
  );
  assert.equal(
    f.app.catalog.applyImport(f.actor, importRow(f)).targetId,
    f.product,
  );
  assert.equal(f.app.catalog.products(f.actor).length, 1);
});
