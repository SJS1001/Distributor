import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.ts";
import type { Actor, Role } from "../src/server/core.ts";
import { Application } from "../src/server/application.ts";

function user(
  f: ReturnType<typeof fixture>,
  role: Role,
  name: string = role,
  sites = [f.w1],
) {
  const row = f.app.identity.createUser(f.actor, name, {
    name,
    email: `${name}@example.test`,
    password: "long-authority-password",
    role,
    sites: role === "buyer" ? [] : sites,
    accountId: f.buyer,
  });
  return f.app.identity.currentActor({ ...f.actor, id: row.id });
}
function change(
  f: ReturnType<typeof fixture>,
  actor: Actor,
  changes: Record<string, unknown>,
) {
  const row = f.app.identity.users(f.actor).find((u) => u.id === actor.id)!;
  f.app.identity.updateUser(f.actor, `change-${actor.id}-${row.revision}`, {
    userId: actor.id,
    revision: Number(row.revision),
    name: actor.name,
    email: String(row.email),
    role: actor.role,
    sites: actor.sites,
    active: true,
    currentPassword: "long-test-only-password",
    reason: "Synthetic inventory access change",
    ...changes,
  });
}
function facts(f: ReturnType<typeof fixture>) {
  return [
    ...[
      "warehouses",
      "units",
      "allocations",
      "replacements",
      "short_picks",
      "movements",
      "cost_sequences",
      "cost_clock",
      "transfers",
      "transfer_lines",
      "transfer_origins",
      "transfer_manifest",
      "transfer_receipts",
      "transfer_losses",
      "transfer_recoveries",
      "serial_reviews",
      "counts",
    ].map((n) =>
      f.app.database
        .owned("inventory")
        .all(`SELECT * FROM inventory_${n} ORDER BY rowid`),
    ),
    ...["commands", "audit", "audit_order", "audit_clock", "events"].map((n) =>
      f.app.database
        .owned("platform")
        .all(`SELECT * FROM platform_${n} ORDER BY rowid`),
    ),
  ];
}
function reads(f: ReturnType<typeof fixture>, actor: Actor) {
  const unitId = String(
    f.app.database
      .owned("inventory")
      .get(
        "SELECT id FROM inventory_units WHERE org_id=? AND serial='S1'",
        f.actor.orgId,
      )!.id,
  );
  return [
    () => f.app.inventory.warehouses(actor),
    () => f.app.inventory.transferDestinations(actor),
    () => f.app.inventory.warehouseByName(actor, "Toronto"),
    () => f.app.inventory.stock(actor),
    () => f.app.inventory.purchaseOrigin(actor, unitId),
    () => f.app.inventory.trace(actor, "S1"),
    () => f.app.inventory.transfers(actor),
  ];
}
function commands(f: ReturnType<typeof fixture>, actor: Actor) {
  const inventory = f.app.inventory;
  const warehouse = { name: "Authority warehouse" };
  inventory.createWarehouse(actor, "warehouse", warehouse);
  const first = inventory.trace(f.actor, "S1").unit;
  const inspect = {
    unitId: first.id,
    revision: first.revision,
    condition: "quarantine" as const,
    reason: "Synthetic inspection",
  };
  inventory.inspect(actor, "inspect", inspect);
  const second = inventory.trace(f.actor, "S2").unit;
  const dispatch = {
    unitId: second.id,
    revision: second.revision,
    quantity: 1,
    destinationId: f.w2,
    reason: "Synthetic relocation",
  };
  const transfer = inventory.dispatchTransfer(actor, "dispatch", dispatch);
  const receive = {
    transferId: transfer.id,
    lineId: transfer.lineId,
    quantity: 1,
    serial: "S2",
    receiptRef: "ARRIVAL",
    bin: "B-1",
    condition: "usable" as const,
    reason: "Synthetic arrival",
  };
  inventory.receiveTransfer(actor, "receive", receive);
  const third = inventory.trace(f.actor, "S3").unit;
  const lost = inventory.dispatchTransfer(f.actor, "lost-dispatch", {
    unitId: third.id,
    revision: third.revision,
    quantity: 1,
    destinationId: f.w2,
    reason: "Synthetic lost carton",
  });
  const approve = {
    transferId: lost.id,
    lineId: lost.lineId,
    revision: inventory.unit(f.actor, lost.unitId).revision,
    quantity: 1,
    serial: "S3",
    lossRef: "LOSS",
    reason: "Synthetic investigated loss",
  };
  const loss = inventory.approveTransferLoss(actor, "approve", approve);
  const recover = {
    lossId: loss.lossId,
    quantity: 1,
    serial: "S3",
    receiptRef: "FOUND",
    bin: "Q-1",
    condition: "quarantine" as const,
    reason: "Synthetic recovered carton",
  };
  inventory.recoverTransferLoss(actor, "recover", recover);
  return (principal: Actor, prefix = "") => [
    () => inventory.createWarehouse(principal, prefix + "warehouse", warehouse),
    () => inventory.inspect(principal, prefix + "inspect", inspect),
    () => inventory.dispatchTransfer(principal, prefix + "dispatch", dispatch),
    () => inventory.receiveTransfer(principal, prefix + "receive", receive),
    () => inventory.approveTransferLoss(principal, prefix + "approve", approve),
    () => inventory.recoverTransferLoss(principal, prefix + "recover", recover),
  ];
}

test("inventory reads use persisted warehouse grants and cannot be expanded by supplied actor fields", (t) => {
  const f = fixture(t),
    warehouse = user(f, "warehouse");
  assert.deepEqual(
    f.app.inventory.warehouses({ ...warehouse, role: "admin", sites: [f.w2] }),
    f.app.inventory.warehouses(warehouse),
  );
  assert.deepEqual(
    f.app.inventory.stock({ ...warehouse, role: "admin", sites: [f.w2] }),
    f.app.inventory.stock(warehouse),
  );
  const before = facts(f);
  change(f, warehouse, { sites: [f.w2] });
  const afterChange = facts(f);
  assert.equal(f.app.inventory.stock(warehouse).length, 0);
  assert.deepEqual(
    f.app.inventory.warehouses(warehouse).map((w) => w.id),
    [f.w2],
  );
  assert.deepEqual(
    f.app.inventory.transferDestinations(warehouse).map((w) => w.name),
    ["Ottawa", "Toronto"],
  );
  assert.throws(
    () => f.app.inventory.trace({ ...warehouse, role: "admin" }, "S1"),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () =>
      f.app.inventory.purchaseOrigin(
        warehouse,
        f.app.inventory.trace(f.actor, "S1").unit.id,
      ),
    { code: "FORBIDDEN" },
  );
  assert.deepEqual(facts(f), afterChange);
  assert.deepEqual(afterChange.slice(0, 17), before.slice(0, 17));
  // Catalog access remains available for actual buyers and commercial staff.
  assert.equal(f.app.inventory.warehouses(user(f, "buyer")).length, 2);
  assert.equal(f.app.inventory.warehouses(user(f, "commercial")).length, 2);
});

test("inventory reads reject absent, foreign and deactivated principals without changing owning facts", (t) => {
  const f = fixture(t),
    actor = user(f, "admin", "read-admin");
  change(f, actor, { active: false });
  const before = facts(f);
  for (const principal of [
    actor,
    { ...f.actor, id: "absent" },
    { ...f.actor, orgId: "foreign" },
  ])
    for (const read of reads(f, principal))
      assert.throws(read, { code: "FORBIDDEN" });
  assert.deepEqual(facts(f), before);
});

test("required password changes precede all inventory reads and six existing or new command results", (t) => {
  const f = fixture(t),
    actor = user(f, "admin", "password-admin"),
    retry = commands(f, actor);
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
      actor.id,
    );
  const before = facts(f);
  for (const action of [
    ...reads(f, actor),
    ...retry(actor),
    ...retry(actor, "new-"),
  ])
    assert.throws(action, { code: "PASSWORD_CHANGE_REQUIRED" });
  assert.deepEqual(facts(f), before);
});

test("deactivation, nonexistent identity and foreign organization precede inventory command replay and effects", (t) => {
  const f = fixture(t),
    actor = user(f, "admin", "disabled-admin"),
    retry = commands(f, actor);
  change(f, actor, { active: false });
  const before = facts(f);
  for (const principal of [
    actor,
    { ...actor, id: "absent" },
    { ...actor, orgId: "foreign" },
  ])
    for (const action of [...retry(principal), ...retry(principal, "new-")])
      assert.throws(action, { code: "FORBIDDEN" });
  assert.deepEqual(facts(f), before);
});

test("persisted role changes deny forged admin inventory commands, including completed retries", (t) => {
  const f = fixture(t),
    actor = user(f, "admin", "changed-admin"),
    retry = commands(f, actor);
  change(f, actor, { role: "finance", sites: [f.w1, f.w2] });
  const before = facts(f);
  for (const action of [
    ...retry(actor),
    ...retry({ ...actor, role: "admin", sites: [f.w1, f.w2] }, "new-"),
  ])
    assert.throws(action, { code: "FORBIDDEN" });
  assert.equal(f.app.inventory.stock(actor).length, 3);
  assert.deepEqual(facts(f), before);
});

test("transfer retries reauthorize original source and destination after independent grant changes and SQLite restart", (t) => {
  const f = fixture(t),
    source = user(f, "warehouse", "source"),
    destination = user(f, "warehouse", "destination", [f.w2]);
  const u = f.app.inventory.trace(f.actor, "S1").unit;
  const dispatch = {
    unitId: u.id,
    revision: u.revision,
    quantity: 1,
    destinationId: f.w2,
    reason: "Synthetic transfer",
  };
  const tr = f.app.inventory.dispatchTransfer(source, "dispatch", dispatch);
  const receive = {
    transferId: tr.id,
    lineId: tr.lineId,
    quantity: 1,
    serial: "S1",
    receiptRef: "S1-ARRIVAL",
    bin: "B-1",
    condition: "usable" as const,
    reason: "Synthetic arrival",
  };
  const arrived = f.app.inventory.receiveTransfer(
    destination,
    "receive",
    receive,
  );
  assert.deepEqual(
    f.app.inventory.dispatchTransfer(source, "dispatch", dispatch),
    tr,
  );
  assert.deepEqual(
    f.app.inventory.receiveTransfer(destination, "other-key", receive),
    arrived,
  );
  const other = new Application(f.path);
  t.after(() => other.close());
  change({ ...f, app: other }, source, { sites: [f.w2] });
  change({ ...f, app: other }, destination, { sites: [f.w1] });
  f.app.close();
  f.app = new Application(f.path);
  const before = facts(f);
  assert.throws(
    () => f.app.inventory.dispatchTransfer(source, "dispatch", dispatch),
    { code: "FORBIDDEN" },
  );
  for (const key of ["receive", "new-receive"])
    assert.throws(
      () => f.app.inventory.receiveTransfer(destination, key, receive),
      { code: "FORBIDDEN" },
    );
  assert.deepEqual(
    f.app.inventory.stock(source).map((s) => s.serial),
    ["S1"],
  );
  assert.deepEqual(
    f.app.inventory.stock(destination).map((s) => s.serial),
    ["S2", "S3"],
  );
  assert.throws(() => f.app.inventory.trace(destination, "S1"), {
    code: "FORBIDDEN",
  });
  assert.deepEqual(facts(f), before);
});

test("inspection retries deny revoked warehouse grants before cached return or a new stock effect", (t) => {
  const f = fixture(t),
    warehouse = user(f, "warehouse");
  const u = f.app.inventory.trace(f.actor, "S1").unit;
  const input = {
    unitId: u.id,
    revision: u.revision,
    condition: "quarantine" as const,
    reason: "Synthetic inspection",
  };
  const inspected = f.app.inventory.inspect(warehouse, "inspect", input);
  assert.deepEqual(
    f.app.inventory.inspect(warehouse, "inspect", input),
    inspected,
  );
  change(f, warehouse, { sites: [f.w2] });
  const before = facts(f);
  for (const key of ["inspect", "new-inspect"])
    assert.throws(
      () =>
        f.app.inventory.inspect(
          { ...warehouse, role: "admin", sites: [f.w1] },
          key,
          input,
        ),
      { code: "FORBIDDEN" },
    );
  assert.deepEqual(facts(f), before);
});

test("transfer lists use current site scope and support cannot impersonate warehouse or administrator", (t) => {
  const f = fixture(t),
    warehouse = user(f, "warehouse"),
    support = user(f, "support"),
    third = f.app.inventory.createWarehouse(f.actor, "third", {
      name: "Third site",
    }).id;
  const u = f.app.inventory.trace(f.actor, "S1").unit;
  const dispatch = {
    unitId: u.id,
    revision: u.revision,
    quantity: 1,
    destinationId: f.w2,
    reason: "Synthetic transfer",
  };
  const tr = f.app.inventory.dispatchTransfer(warehouse, "dispatch", dispatch);
  change(f, warehouse, { role: "support", sites: [third] });
  assert.equal(
    f.app.inventory.transfers({ ...warehouse, role: "admin", sites: [f.w1] })
      .length,
    0,
  );
  assert.equal(f.app.inventory.transfers(support)[0]!.id, tr.id);
  const before = facts(f);
  assert.throws(
    () => f.app.inventory.dispatchTransfer(warehouse, "dispatch", dispatch),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () =>
      f.app.inventory.inspect({ ...support, role: "warehouse" }, "inspect", {
        unitId: f.app.inventory.trace(f.actor, "S2").unit.id,
        revision: 1,
        condition: "quarantine",
        reason: "Synthetic forbidden inspection",
      }),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () =>
      f.app.inventory.warehouseByName({ ...support, role: "admin" }, "Toronto"),
    { code: "FORBIDDEN" },
  );
  assert.deepEqual(facts(f), before);
});
