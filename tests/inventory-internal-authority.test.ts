import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, accept, ship } from "./fixtures.ts";
import type { Actor, Role } from "../src/server/core.ts";
import { Application } from "../src/server/application.ts";

type Fixture = ReturnType<typeof fixture>;
function user(f: Fixture, role: Role, name = `internal-${role}`) {
  const result = f.app.identity.createUser(f.actor, name, {
    name,
    email: `${name}@example.test`,
    password: "long-authority-password",
    role,
    sites: role === "buyer" ? [] : [f.w1],
    accountId: f.buyer,
  });
  return f.app.identity.currentActor({ ...f.actor, id: result.id });
}
function change(f: Fixture, actor: Actor, changes: Record<string, unknown>) {
  const row = f.app.identity.users(f.actor).find((u) => u.id === actor.id)!;
  return f.app.identity.updateUser(
    f.actor,
    `grant-${actor.id}-${row.revision}`,
    {
      userId: actor.id,
      revision: Number(row.revision),
      name: String(row.name),
      email: String(row.email),
      role: row.role,
      sites: actor.sites,
      active: true,
      currentPassword: "long-test-only-password",
      reason: "Synthetic internal inventory authority review",
      ...changes,
    },
  );
}
function facts(f: Fixture) {
  return (
    [
      "inventory",
      "orders",
      "fulfillment",
      "billing",
      "warranty",
      "platform",
    ] as const
  ).map((owner) => {
    const store = f.app.database.owned(owner);
    return store
      .all<{ name: string }>(
        "SELECT name FROM sqlite_schema WHERE type='table' AND name GLOB ? ORDER BY name",
        `${owner}_*`,
      )
      .map(({ name }) => [
        name,
        store.all(`SELECT * FROM ${name} ORDER BY rowid`),
      ]);
  });
}
function unit(f: Fixture, serial = "S1") {
  return f.app.inventory.trace(f.actor, serial).unit;
}
function operations(f: Fixture, actor: Actor) {
  const i = f.app.inventory,
    u = unit(f);
  return [
    () => i.warehouse(actor, f.w1),
    () => i.unit(actor, u.id),
    () => i.availability(actor, f.product, f.w1),
    () => i.salesEvidence(actor),
    () => i.controlTotals(actor),
    () => i.assertNewSerials(actor, []),
    () =>
      i.receive(
        actor,
        {
          productId: f.product,
          warehouseId: f.w1,
          bin: "A2",
          quantity: 1,
          unitCost: 6000,
          serials: ["INTERNAL-NEW"],
          quarantine: false,
        },
        "internal-receipt",
      ),
    () => i.validateOpening(actor, {}),
    () => i.applyOpening(actor, [], "opening", "Synthetic opening"),
    () =>
      i.returnToSupplier(
        actor,
        {
          unitId: u.id,
          receiptId: "missing-receipt",
          revision: u.revision,
          quantity: 1,
          serial: u.serial,
          reason: "Synthetic supplier return",
        },
        "supplier-return",
      ),
    () => i.reserve(actor, "missing-order", f.product, f.w1, 0),
    () => i.allocations(actor, "missing-order"),
    () => i.pick(actor, "missing-allocation", "S1"),
    () => i.unpick(actor, "missing-allocation"),
    () =>
      i.holdShortPick(
        actor,
        {
          allocationId: "missing-allocation",
          unitRevision: 1,
          quantity: 1,
          reason: "Synthetic shortage",
        },
        "shortage",
      ),
    () => i.release(actor, "missing-order", f.product, 0),
    () => i.ship(actor, "missing-order", [], "shipment"),
    () => i.replacementCustody(actor, "missing-replacement"),
    () => i.reserveReplacement(actor, "replacement", u.id, f.product),
    () =>
      i.releaseReplacement(actor, "missing-replacement", "Synthetic cancel"),
    () =>
      i.handoverReplacement(
        actor,
        "missing-replacement",
        "S1",
        "Synthetic handover",
      ),
    () => i.soldSerialCandidates(actor, "S"),
    () => i.shipmentReference(actor, u.id),
    () => i.soldCustody(actor, u.id),
    () => i.receiveReturn(actor, u.id, f.w1, "Q1", "return"),
    () =>
      i.returnDisposition(
        actor,
        u.id,
        "restock",
        "disposition",
        "Synthetic restock",
      ),
  ];
}

test("all 26 inventory internal entry points reject unavailable principals before empty results, validation or effects", (t) => {
  const f = fixture(t),
    actor = user(f, "admin");
  change(f, actor, { active: false });
  const before = facts(f);
  for (const principal of [
    actor,
    { ...f.actor, id: "absent" },
    { ...f.actor, orgId: "foreign" },
  ])
    for (const operation of operations(f, principal))
      assert.throws(operation, { code: "FORBIDDEN" });
  assert.deepEqual(facts(f), before);
});

test("all 26 inventory internal entry points enforce current password requirements and conserve native facts", (t) => {
  const f = fixture(t),
    actor = user(f, "admin");
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
      actor.id,
    );
  const before = facts(f);
  for (const operation of operations(f, actor))
    assert.throws(operation, { code: "PASSWORD_CHANGE_REQUIRED" });
  assert.deepEqual(facts(f), before);
});

test("demotion cannot be bypassed by forged administrator fields at native mutation and financial control boundaries", (t) => {
  const f = fixture(t),
    actor = user(f, "admin");
  change(f, actor, { role: "support" });
  const before = facts(f),
    actions = operations(f, { ...actor, role: "admin", sites: [f.w1, f.w2] });
  for (const index of [
    3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 24, 25,
  ])
    assert.throws(actions[index]!, { code: "FORBIDDEN" });
  assert.deepEqual(facts(f), before);
});

test("independent connection changes and restart refresh finance control access including stale negative grants", (t) => {
  const f = fixture(t),
    finance = user(f, "finance"),
    support = user(f, "support");
  const expected = f.app.inventory.controlTotals(finance);
  const other = new Application(f.path);
  t.after(() => other.close());
  change({ ...f, app: other }, finance, { role: "support" });
  change({ ...f, app: other }, support, { role: "finance" });
  f.app.close();
  f.app = new Application(f.path);
  const before = facts(f);
  assert.throws(
    () => f.app.inventory.salesEvidence({ ...finance, role: "admin" }),
    { code: "FORBIDDEN" },
  );
  assert.throws(() => f.app.inventory.controlTotals(finance), {
    code: "FORBIDDEN",
  });
  assert.deepEqual(f.app.inventory.controlTotals(support), expected);
  assert.equal(f.app.inventory.salesEvidence(support).units.length, 3);
  assert.deepEqual(facts(f), before);
});

test("warehouse custody uses current site grants for pick, shipment, receipt and replacement operations", (t) => {
  const f = fixture(t),
    actor = user(f, "warehouse"),
    order = accept(f);
  const allocation = f.app.inventory.allocations(f.actor, order.id)[0]!;
  f.app.inventory.pick(actor, allocation.id, "S1");
  const replacementUnit = unit(f, "S2"),
    quarantine = unit(f, "S3");
  f.app.database.transaction(() =>
    f.app.inventory.reserveReplacement(
      f.actor,
      "held",
      replacementUnit.id,
      f.product,
    ),
  );
  f.app.inventory.inspect(f.actor, "quarantine", {
    unitId: quarantine.id,
    revision: quarantine.revision,
    condition: "quarantine",
    reason: "Synthetic inspection",
  });
  change(f, actor, { sites: [f.w2] });
  const forged = { ...actor, sites: [f.w1], role: "admin" as const },
    before = facts(f),
    i = f.app.inventory;
  for (const action of [
    () => i.pick(forged, allocation.id, "S1"),
    () => i.unpick(forged, allocation.id),
    () =>
      i.holdShortPick(
        forged,
        {
          allocationId: allocation.id,
          unitRevision: 1,
          quantity: 1,
          reason: "Synthetic shortage",
        },
        "shortage",
      ),
    () =>
      i.ship(
        forged,
        order.id,
        [{ allocationId: allocation.id, quantity: 1 }],
        "shipment",
      ),
    () =>
      i.receive(
        forged,
        {
          productId: f.product,
          warehouseId: f.w1,
          bin: "A2",
          quantity: 1,
          unitCost: 6000,
          serials: ["S4"],
          quarantine: false,
        },
        "receipt",
      ),
    () => i.replacementCustody(forged, "held"),
    () => i.handoverReplacement(forged, "held", "S2", "Synthetic handover"),
    () => i.receiveReturn(forged, unit(f).id, f.w1, "Q1", "return"),
    () =>
      i.returnDisposition(
        forged,
        quarantine.id,
        "restock",
        "restock",
        "Synthetic restock",
      ),
  ])
    assert.throws(action, { code: "FORBIDDEN" });
  assert.deepEqual(facts(f), before);
});

test("a permission change between order-owner authorization and inventory reservation rolls back the whole command", (t) => {
  const f = fixture(t),
    buyer = user(f, "buyer"),
    before = facts(f);
  const reserve = f.app.inventory.reserve.bind(f.app.inventory);
  let entered = false;
  t.mock.method(
    f.app.inventory,
    "reserve",
    (
      actor: Actor,
      ...args: Parameters<typeof reserve> extends [Actor, ...infer R]
        ? R
        : never
    ) => {
      entered = true;
      f.app.database
        .owned("iam")
        .run("UPDATE iam_users SET role='support' WHERE id=?", buyer.id);
      return reserve(actor, ...args);
    },
  );
  // Cart and quote are independently committed native owner commands.
  const c = f.app.orders.saveCart(buyer, "cart", {
    accountId: f.buyer,
    warehouseId: f.w1,
    revision: 0,
    lines: [{ productId: f.product, quantity: 1 }],
  });
  const q = f.app.orders.quote(buyer, "quote", {
    cartId: c.id,
    revision: c.revision,
  });
  const prepared = facts(f);
  assert.notDeepEqual(prepared, before);
  assert.throws(
    () =>
      f.app.orders.accept(buyer, "accept", {
        quoteId: q.id,
        allowBackorder: false,
      }),
    { code: "FORBIDDEN" },
  );
  assert.equal(entered, true);
  assert.equal(f.app.identity.currentActor(buyer).role, "buyer");
  assert.deepEqual(facts(f), prepared);
});

test("actual buyers retain account-scoped ordering, cancellation and sold-serial coverage across fresh inventory checks", (t) => {
  const f = fixture(t),
    buyer = user(f, "buyer");
  const order = accept({ ...f, actor: buyer });
  const current = f.app.orders.order(buyer, order.id),
    line = f.app.orders.lines(buyer, order.id)[0]!;
  f.app.orders.cancel(buyer, "cancel", {
    orderId: order.id,
    lineId: line.id,
    revision: current.revision,
    quantity: 1,
    reason: "Synthetic customer cancellation",
  });
  assert.equal(f.app.inventory.availability(buyer, f.product, f.w1), 3);
  const soldOrder = accept({ ...f, actor: buyer }, 1, "sold-order");
  ship(f, soldOrder.id);
  const soldUnit = unit(f);
  const before = facts(f);
  assert.equal(
    f.app.warranty.coverage(buyer, soldUnit.id, f.buyer).serial,
    "S1",
  );
  assert.deepEqual(facts(f), before);
  const foreign = f.app.identity.createCustomer(f.actor, "other-account", {
    name: "Other synthetic buyer",
    tier: "standard",
    creditLimit: 1000000,
  }).id;
  const withCustomer = facts(f);
  assert.throws(
    () =>
      f.app.warranty.coverage(
        { ...buyer, accountId: foreign },
        soldUnit.id,
        foreign,
      ),
    { code: "FORBIDDEN" },
  );
  assert.deepEqual(facts(f), withCustomer);
});

test("qualified current grants retain native stock, original cost and replacement/return conservation", (t) => {
  const f = fixture(t),
    warehouse = user(f, "warehouse"),
    warranty = user(f, "warranty");
  const shipped = ship({ ...f, actor: warehouse }, accept(f).id),
    sold = unit(f);
  assert.equal(
    f.app.inventory.shipmentReference(warehouse, sold.id),
    shipped.id,
  );
  assert.equal(
    f.app.inventory.soldCustody(warranty, sold.id).reference,
    shipped.id,
  );
  const replacement = unit(f, "S2");
  f.app.database.transaction(() => {
    f.app.inventory.reserveReplacement(
      warranty,
      "cancelled-hold",
      replacement.id,
      f.product,
    );
    f.app.inventory.releaseReplacement(
      warranty,
      "cancelled-hold",
      "Synthetic revised choice",
    );
    f.app.inventory.reserveReplacement(
      warranty,
      "handover-hold",
      replacement.id,
      f.product,
    );
    f.app.inventory.handoverReplacement(
      warehouse,
      "handover-hold",
      "S2",
      "Synthetic scanned collection",
    );
    f.app.inventory.receiveReturn(warehouse, sold.id, f.w1, "Q1", "return");
    f.app.inventory.returnDisposition(
      warranty,
      sold.id,
      "restock",
      "restock",
      "Synthetic approved inspection",
    );
  });
  assert.equal(unit(f).quantity, 1);
  assert.equal(unit(f).condition, "usable");
  assert.equal(unit(f, "S2").quantity, 0);
  assert.equal(unit(f, "S2").state, "sold");
  assert.equal(unit(f).cost, 6000);
  assert.equal(f.app.inventory.availability(f.actor, f.product, f.w1), 2);
  assert.equal(f.app.billing.invoices(f.actor).length, 1);
});

test("replacement reservations use newly granted warranty authority and current sites before cancellation", (t) => {
  const f = fixture(t),
    actor = user(f, "support"),
    replacement = unit(f);
  change(f, actor, { role: "warranty", sites: [f.w1] });
  f.app.database.transaction(() =>
    f.app.inventory.reserveReplacement(
      actor,
      "new-grant",
      replacement.id,
      f.product,
    ),
  );
  assert.equal(f.app.inventory.availability(f.actor, f.product, f.w1), 2);
  change(f, actor, { role: "warranty", sites: [f.w2] });
  const before = facts(f);
  assert.throws(
    () =>
      f.app.inventory.releaseReplacement(
        { ...actor, role: "admin", sites: [f.w1] },
        "new-grant",
        "Synthetic revoked release",
      ),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () =>
      f.app.inventory.reserveReplacement(
        { ...actor, role: "admin", sites: [f.w1] },
        "another-grant",
        unit(f, "S2").id,
        f.product,
      ),
    { code: "FORBIDDEN" },
  );
  assert.deepEqual(facts(f), before);
  change(f, actor, { role: "warranty", sites: [f.w1] });
  f.app.database.transaction(() =>
    f.app.inventory.releaseReplacement(
      actor,
      "new-grant",
      "Synthetic qualified release",
    ),
  );
  assert.equal(f.app.inventory.availability(f.actor, f.product, f.w1), 3);
});
