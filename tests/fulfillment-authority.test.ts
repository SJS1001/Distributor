import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, accept } from "./fixtures.ts";
import type { Actor, Role } from "../src/server/core.ts";
import type { Owner } from "../src/server/database.ts";
import { Application } from "../src/server/application.ts";

function user(f: ReturnType<typeof fixture>, role: Role, name: string = role) {
  const result = f.app.identity.createUser(f.actor, `fulfillment-${name}`, {
    name,
    email: `fulfillment-${name}@example.test`,
    password: "long-fulfillment-test-password",
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
    `fulfillment-grant-${actor.id}-${row.revision}`,
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
      reason: "Synthetic fulfillment authority change",
      ...updates,
    },
  );
}
function facts(f: ReturnType<typeof fixture>) {
  const owners: [Owner, string[]][] = [
    [
      "fulfillment",
      ["shipments", "coverage", "delivery", "delivery_history", "short_picks"],
    ],
    [
      "orders",
      ["orders", "lines", "reservation_deadlines", "reservation_history"],
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
  const order = accept(f, 3);
  const allocations = f.app.fulfillment.picks(f.actor, order.id);
  const first = allocations[0]!,
    short = allocations[2]!;
  const shortage = {
    orderId: order.id,
    revision: 1,
    allocationId: short.id,
    unitRevision: short.unitRevision,
    quantity: 1,
    reason: "Synthetic unavailable serial",
  };
  f.app.fulfillment.shortPick(actor, "authority-short", shortage);
  const pick = {
    orderId: order.id,
    allocationId: first.id,
    serial: first.serial,
  };
  f.app.fulfillment.pick(actor, "authority-pick", pick);
  const pack = {
    orderId: order.id,
    revision: f.app.orders.order(f.actor, order.id).revision,
    mode: "carrier" as const,
    address: "Synthetic recipient address",
    lines: [{ allocationId: first.id, quantity: 1 }],
  };
  const discarded = f.app.fulfillment.pack(actor, "authority-pack", pack);
  const voidInput = {
    shipmentId: discarded.id,
    reason: "Synthetic packing correction",
  };
  f.app.fulfillment.void(actor, "authority-void", voidInput);
  const packed = f.app.fulfillment.pack(actor, "actual-pack", pack);
  const commit = {
    shipmentId: packed.id,
    carrier: "Synthetic carrier",
    tracking: "SYNTHETIC-TRACK",
    handoverEvidence: "Synthetic custody evidence",
  };
  f.app.fulfillment.commit(actor, "authority-ship", commit);
  const shipment = f.app.fulfillment.shipment(f.actor, packed.id);
  const update = {
    shipmentId: packed.id,
    revision: 0,
    state: "in_transit" as const,
    reference: "Synthetic carrier observation",
    evidence: "Synthetic private observation",
    observedAt: shipment.shipped_at!,
  };
  f.app.fulfillment.updateDelivery(actor, "authority-update", update);
  const confirm = {
    shipmentId: packed.id,
    reference: "Synthetic delivery confirmation",
    deliveredAt: shipment.shipped_at!,
  };
  f.app.fulfillment.confirmDelivery(actor, "authority-confirm", confirm);
  return {
    orderId: order.id,
    shipmentId: packed.id,
    unitId: first.unit_id,
    pack,
    replay: (current: Actor, prefix = "authority") => [
      () => f.app.fulfillment.shortPick(current, `${prefix}-short`, shortage),
      () => f.app.fulfillment.pick(current, `${prefix}-pick`, pick),
      () => f.app.fulfillment.pack(current, `${prefix}-pack`, pack),
      () => f.app.fulfillment.void(current, `${prefix}-void`, voidInput),
      () => f.app.fulfillment.commit(current, `${prefix}-ship`, commit),
      () =>
        f.app.fulfillment.updateDelivery(current, `${prefix}-update`, update),
      () =>
        f.app.fulfillment.confirmDelivery(
          current,
          `${prefix}-confirm`,
          confirm,
        ),
    ],
  };
}
function reads(
  f: ReturnType<typeof fixture>,
  actor: Actor,
  p: ReturnType<typeof prepared>,
) {
  return [
    () => f.app.fulfillment.shipment(actor, p.shipmentId),
    () => f.app.fulfillment.shipments(actor),
    () => f.app.fulfillment.shipmentPage(actor),
    () => f.app.fulfillment.packedGoods(actor, p.shipmentId),
    () => f.app.fulfillment.picks(actor, p.orderId),
    () => f.app.fulfillment.shortPicks(actor, p.orderId),
    () => f.app.fulfillment.deliveryHistory(actor, p.shipmentId),
    () => f.app.fulfillment.shipmentCoverage(actor, p.shipmentId),
    () => f.app.fulfillment.soldSerial(actor, p.shipmentId, p.unitId),
    () => f.app.fulfillment.soldUnit(actor, p.unitId, f.buyer, p.shipmentId),
    () => f.app.fulfillment.salesEvidence(actor),
  ];
}

test("fulfillment unavailable principals cannot read or replay any of seven saved/new commands", (t) => {
  const f = fixture(t),
    actor = user(f, "admin"),
    p = prepared(f, actor);
  change(f, actor, { active: false });
  const before = facts(f);
  for (const invalid of [
    actor,
    { ...actor, id: "absent-fulfillment-principal" },
    { ...actor, orgId: "foreign-org" },
  ])
    denied([
      ...reads(f, invalid, p),
      ...p.replay(invalid),
      ...p.replay(invalid, "new"),
    ]);
  assert.deepEqual(facts(f), before);
});

test("demotion fences packing cached results and all fulfillment writes using current roles", (t) => {
  const f = fixture(t),
    actor = user(f, "admin"),
    p = prepared(f, actor);
  change(f, actor, { role: "support" });
  const before = facts(f);
  denied([
    ...p.replay(actor),
    ...p.replay(actor, "new"),
    () => f.app.fulfillment.picks(actor, p.orderId),
    () => f.app.fulfillment.salesEvidence(actor),
  ]);
  assert.equal(
    f.app.fulfillment.shipment(actor, p.shipmentId).id,
    p.shipmentId,
  );
  assert.deepEqual(facts(f), before);
});

test("required password changes fence every fulfillment read and saved/new write", (t) => {
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
    [...reads(f, actor, p), ...p.replay(actor), ...p.replay(actor, "new")],
    "PASSWORD_CHANGE_REQUIRED",
  );
  assert.deepEqual(facts(f), before);
});

test("shipment detail and serial sales follow a buyer's persisted account and role", (t) => {
  const f = fixture(t),
    p = prepared(f, f.actor),
    buyer = user(f, "buyer");
  const other = f.app.identity.createCustomer(f.actor, "other-buyer", {
    name: "Other synthetic buyer",
    tier: "standard",
    creditLimit: 1000000,
  }).id;
  change(f, buyer, { accountId: other });
  const forged = {
    ...buyer,
    role: "admin" as const,
    accountId: f.buyer,
    sites: [f.w1],
  };
  const before = facts(f);
  denied([
    () => f.app.fulfillment.shipment(forged, p.shipmentId),
    () => f.app.fulfillment.shipmentCoverage(forged, p.shipmentId),
  ]);
  assert.equal(
    f.app.fulfillment.soldSerial(forged, p.shipmentId, p.unitId),
    null,
  );
  assert.deepEqual(f.app.fulfillment.shipments(forged), []);
  assert.deepEqual(facts(f), before);
});

test("warehouse reassignment fences shipment detail serial sales and all saved/new fulfillment commands", (t) => {
  const f = fixture(t),
    actor = user(f, "warehouse"),
    p = prepared(f, actor);
  change(f, actor, { sites: [f.w2] });
  const forged = { ...actor, role: "admin" as const, sites: [f.w1, f.w2] };
  const before = facts(f);
  denied([
    () => f.app.fulfillment.shipment(forged, p.shipmentId),
    () => f.app.fulfillment.soldSerial(forged, p.shipmentId, p.unitId),
    () => f.app.fulfillment.soldUnit(forged, p.unitId, f.buyer, p.shipmentId),
    ...p.replay(forged),
    ...p.replay(forged, "new"),
  ]);
  assert.deepEqual(f.app.fulfillment.shipmentPage(forged).items, []);
  assert.deepEqual(facts(f), before);
});

test("current warehouse grants permit packing despite a stale supplied buyer role and account", (t) => {
  const f = fixture(t),
    actor = user(f, "warehouse"),
    order = accept(f);
  const stale = {
    ...actor,
    role: "buyer" as const,
    accountId: "unrelated-account",
    sites: [],
  };
  const picks = f.app.fulfillment.picks(stale, order.id),
    first = picks[0]!;
  f.app.fulfillment.pick(stale, "valid-pick", {
    orderId: order.id,
    allocationId: first.id,
    serial: first.serial,
  });
  const input = {
    orderId: order.id,
    revision: f.app.orders.order(f.actor, order.id).revision,
    mode: "collection" as const,
    address: "Synthetic counter",
    lines: [{ allocationId: first.id, quantity: 1 }],
  };
  const packed = f.app.fulfillment.pack(stale, "valid-pack", input);
  assert.deepEqual(f.app.fulfillment.pack(stale, "valid-pack", input), packed);
  assert.equal(f.app.fulfillment.shipment(stale, packed.id).id, packed.id);
  assert.equal(f.app.fulfillment.picks(stale, order.id)[0]!.packed, 1);
  assert.equal(f.app.billing.invoices(f.actor).length, 0);
});

test("independent persisted grant changes survive restart before fulfillment saved/new command replay", (t) => {
  const f = fixture(t),
    actor = user(f, "admin"),
    p = prepared(f, actor);
  const other = new Application(f.path);
  try {
    other.database
      .owned("iam")
      .run("UPDATE iam_users SET role='support' WHERE id=?", actor.id);
  } finally {
    other.close();
  }
  f.app.close();
  f.app = new Application(f.path);
  const before = facts(f);
  denied([
    ...p.replay(actor),
    ...p.replay(actor, "new"),
    () => f.app.fulfillment.salesEvidence(actor),
    () => f.app.fulfillment.picks(actor, p.orderId),
  ]);
  assert.deepEqual(facts(f), before);
});

test("persisted warehouse scope applies to serial sale lookup without caller forgery", (t) => {
  const f = fixture(t),
    p = prepared(f, f.actor),
    actor = user(f, "warehouse");
  change(f, actor, { sites: [f.w2] });
  const current = f.app.identity.currentActor(actor),
    before = facts(f);
  denied([
    () => f.app.fulfillment.soldSerial(current, p.shipmentId, p.unitId),
    () => f.app.fulfillment.soldUnit(current, p.unitId, f.buyer, p.shipmentId),
  ]);
  assert.deepEqual(facts(f), before);
});

test("buyers retain only their current shipment and public delivery history despite supplied staff grants", (t) => {
  const f = fixture(t),
    p = prepared(f, f.actor),
    buyer = user(f, "buyer");
  const supplied = {
    ...buyer,
    role: "admin" as const,
    accountId: "wrong-account",
    sites: [f.w1],
  };
  assert.equal(
    f.app.fulfillment.shipment(supplied, p.shipmentId).account_id,
    f.buyer,
  );
  assert.ok(f.app.fulfillment.soldSerial(supplied, p.shipmentId, p.unitId));
  assert.ok(f.app.fulfillment.shipmentCoverage(supplied, p.shipmentId));
  const history = f.app.fulfillment.deliveryHistory(
    supplied,
    p.shipmentId,
  ).items;
  assert.equal(history.length, 2);
  for (const item of history) {
    assert.equal("reference" in item, false);
    assert.equal("evidence" in item, false);
    assert.equal("actorId" in item, false);
  }
  const before = facts(f);
  denied([
    ...p.replay(supplied),
    ...p.replay(supplied, "new"),
    () => f.app.fulfillment.picks(supplied, p.orderId),
    () => f.app.fulfillment.salesEvidence(supplied),
  ]);
  assert.deepEqual(facts(f), before);
  // Synthetic missing-assignment fixture; user administration requires an account.
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET account_id=NULL WHERE id=?", buyer.id);
  assert.deepEqual(f.app.fulfillment.shipmentPage(supplied).items, []);
  assert.equal(
    f.app.fulfillment.soldSerial(supplied, p.shipmentId, p.unitId),
    null,
  );
  denied([() => f.app.fulfillment.shipment(supplied, p.shipmentId)]);
});
