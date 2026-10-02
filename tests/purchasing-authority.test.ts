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
    reason: "Synthetic purchasing access change",
    ...changes,
  });
}
function delivery(f: ReturnType<typeof fixture>, key = "incoming") {
  const po = f.app.procurement.create(f.actor, key, {
    supplierId: f.supplier,
    warehouseId: f.w1,
    lines: [{ productId: f.product, quantity: 1, unitCost: 7000 }],
  });
  return {
    poId: po.id,
    lineId: String(
      f.app.procurement.orders(f.actor).find((p) => p.id === po.id)!.lines[0]!
        .id,
    ),
    deliveryRef: key,
    quantity: 1,
    serials: [key],
    bin: "R-1",
    quarantine: true,
    observedSku: "EQ-1",
    draftId: null,
    revision: 0,
  };
}
function facts(f: ReturnType<typeof fixture>) {
  return [
    ...[
      "suppliers",
      "orders",
      "lines",
      "receipts",
      "returns",
      "drafts",
      "draft_versions",
    ].map((n) =>
      f.app.database
        .owned("procurement")
        .all(`SELECT * FROM procurement_${n} ORDER BY rowid`),
    ),
    ...["units", "movements"].map((n) =>
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
function reads(f: ReturnType<typeof fixture>, actor: Actor, draftId: string) {
  return [
    () => f.app.procurement.suppliers(actor),
    () => f.app.procurement.orders(actor),
    () => f.app.procurement.receipts(actor),
    () => f.app.procurement.returns(actor),
    () => f.app.procurement.drafts.list(actor),
    () => f.app.procurement.drafts.history(actor, draftId),
  ];
}
test("purchasing reads use persisted roles/sites and deny absent, foreign and disabled principals without changing facts", (t) => {
  const f = fixture(t),
    input = delivery(f),
    warehouse = user(f, "warehouse"),
    buyer = user(f, "buyer");
  const saved = f.app.procurement.drafts.save(f.actor, "save", input);
  const before = facts(f);
  for (const principal of [
    buyer,
    { ...buyer, role: "admin" as const },
    { ...f.actor, id: "absent" },
    { ...f.actor, orgId: "foreign" },
  ])
    for (const read of reads(f, principal, saved.id))
      assert.throws(read, { code: "FORBIDDEN" });
  assert.deepEqual(
    f.app.procurement
      .orders({ ...warehouse, role: "admin", sites: [f.w2] })
      .map((p) => p.id)
      .sort(),
    f.app.procurement
      .orders(warehouse)
      .map((p) => p.id)
      .sort(),
  );
  assert.deepEqual(facts(f), before);
  change(f, warehouse, { sites: [f.w2] });
  assert.equal(f.app.procurement.orders(warehouse).length, 0);
  assert.equal(f.app.procurement.receipts(warehouse).length, 0);
  assert.equal(f.app.procurement.drafts.list(warehouse).length, 0);
  assert.throws(() => f.app.procurement.drafts.history(warehouse, saved.id), {
    code: "FORBIDDEN",
  });
  change(f, warehouse, { active: false });
  for (const read of reads(f, warehouse, saved.id))
    assert.throws(read, { code: "FORBIDDEN" });
});
test("receipt save, confirm and discard retries reauthorize warehouse grants after independent connection changes and restart", (t) => {
  const f = fixture(t),
    input = delivery(f),
    warehouse = user(f, "warehouse");
  const saved = f.app.procurement.drafts.save(warehouse, "save", input);
  const confirm = { draftId: saved.id, revision: 1 };
  f.app.procurement.drafts.confirm(warehouse, "confirm", confirm);
  const discardedInput = delivery(f, "discarded");
  const discarded = f.app.procurement.drafts.save(
    warehouse,
    "discard-save",
    discardedInput,
  );
  const discard = {
    draftId: discarded.id,
    revision: 1,
    reason: "Synthetic cancelled delivery",
  };
  f.app.procurement.drafts.discard(warehouse, "discard", discard);
  const other = new Application(f.path);
  t.after(() => other.close());
  const row = other.identity.users(f.actor).find((u) => u.id === warehouse.id)!;
  other.identity.updateUser(f.actor, "other-grant", {
    userId: warehouse.id,
    revision: Number(row.revision),
    name: warehouse.name,
    email: String(row.email),
    role: "warehouse",
    sites: [f.w2],
    active: true,
    currentPassword: "long-test-only-password",
    reason: "Synthetic independent revoke",
  });
  f.app.close();
  f.app = new Application(f.path);
  const before = facts(f);
  for (const action of [
    () => f.app.procurement.drafts.save(warehouse, "save", input),
    () => f.app.procurement.drafts.confirm(warehouse, "confirm", confirm),
    () => f.app.procurement.drafts.confirm(warehouse, "fresh-confirm", confirm),
    () => f.app.procurement.drafts.discard(warehouse, "discard", discard),
    () =>
      f.app.procurement.drafts.save(warehouse, "new-save", {
        ...input,
        deliveryRef: "new",
        serials: ["new"],
      }),
  ])
    assert.throws(action, { code: "FORBIDDEN" });
  assert.deepEqual(facts(f), before);
});
test("purchasing password restrictions precede reads and every existing or new command result", (t) => {
  const f = fixture(t),
    actor = user(f, "admin", "purchasing-admin"),
    input = delivery(f);
  const saved = f.app.procurement.drafts.save(actor, "save", input);
  const receive = { ...input, deliveryRef: "direct" };
  f.app.procurement.receive(actor, "receive", receive);
  const create = {
    supplierId: f.supplier,
    warehouseId: f.w1,
    lines: [{ productId: f.product, quantity: 1, unitCost: 5000 }],
  };
  f.app.procurement.create(actor, "create", create);
  f.app.procurement.supplier(actor, "supplier", { name: "Other supplier" });
  const unit = f.app.inventory.trace(f.actor, "S1").unit;
  const receipt = f.app.procurement
    .receipts(f.actor)
    .find((r) => r.po_id === f.po)!;
  const returned = {
    receiptId: receipt.id,
    unitId: unit.id,
    revision: unit.revision,
    quantity: 1,
    serial: "S1",
    returnRef: "RETURN",
    reason: "Synthetic defect",
    handoverEvidence: "Synthetic signed handover",
  };
  f.app.procurement.returnStock(actor, "return", returned);
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
      actor.id,
    );
  const before = facts(f);
  for (const action of [
    ...reads(f, actor, saved.id),
    () =>
      f.app.procurement.supplier(actor, "supplier", { name: "Other supplier" }),
    () =>
      f.app.procurement.supplier(actor, "new-supplier", {
        name: "Restricted supplier",
      }),
    () => f.app.procurement.create(actor, "create", create),
    () => f.app.procurement.create(actor, "new-create", create),
    () => f.app.procurement.receive(actor, "receive", receive),
    () => f.app.procurement.receive(actor, "new-receive", receive),
    () => f.app.procurement.returnStock(actor, "return", returned),
    () => f.app.procurement.returnStock(actor, "new-return", returned),
    () => f.app.procurement.drafts.save(actor, "save", input),
    () =>
      f.app.procurement.drafts.confirm(actor, "confirm", {
        draftId: saved.id,
        revision: 1,
      }),
    () =>
      f.app.procurement.drafts.discard(actor, "discard", {
        draftId: saved.id,
        revision: 1,
        reason: "Restricted",
      }),
  ])
    assert.throws(action, { code: "PASSWORD_CHANGE_REQUIRED" });
  assert.deepEqual(facts(f), before);
});
test("revoked commercial and administrator duties deny purchasing writes and retries; forged grants cannot elevate", (t) => {
  const f = fixture(t),
    commercial = user(f, "commercial"),
    admin = user(f, "admin", "second-admin"),
    warehouse = user(f, "warehouse");
  const create = {
    supplierId: f.supplier,
    warehouseId: f.w1,
    lines: [{ productId: f.product, quantity: 1, unitCost: 5000 }],
  };
  f.app.procurement.supplier(commercial, "supplier", {
    name: "Commercial supplier",
  });
  f.app.procurement.create(commercial, "create", create);
  const input = delivery(f);
  f.app.procurement.receive(warehouse, "receive", input);
  change(f, commercial, { role: "support", sites: [] });
  change(f, warehouse, { sites: [f.w2] });
  change(f, admin, { role: "finance" });
  const unit = f.app.inventory.trace(f.actor, "S2").unit,
    receipt = f.app.procurement
      .receipts(f.actor)
      .find((r) => r.po_id === f.po)!;
  const before = facts(f);
  for (const action of [
    () =>
      f.app.procurement.supplier(commercial, "supplier", {
        name: "Commercial supplier",
      }),
    () => f.app.procurement.create(commercial, "create", create),
    () =>
      f.app.procurement.create(
        { ...commercial, role: "admin" },
        "forged",
        create,
      ),
    () => f.app.procurement.receive(warehouse, "receive", input),
    () =>
      f.app.procurement.receive(
        { ...warehouse, sites: [f.w1] },
        "new-receive",
        input,
      ),
    () =>
      f.app.procurement.returnStock(admin, "return", {
        receiptId: receipt.id,
        unitId: unit.id,
        revision: unit.revision,
        quantity: 1,
        serial: "S2",
        returnRef: "FORBIDDEN",
        reason: "Defect",
        handoverEvidence: "Synthetic",
      }),
  ])
    assert.throws(action, { code: "FORBIDDEN" });
  assert.deepEqual(facts(f), before);
});
test("supplier receipts remain visible at the stock's current permitted site after transfer, without exposing unrelated origins", (t) => {
  const f = fixture(t),
    warehouse = user(f, "warehouse", "destination-worker", [f.w2]);
  const unit = f.app.inventory.trace(f.actor, "S1").unit;
  const transfer = f.app.inventory.dispatchTransfer(f.actor, "dispatch", {
    unitId: unit.id,
    quantity: 1,
    revision: unit.revision,
    destinationId: f.w2,
    reason: "Synthetic transfer",
  });
  f.app.inventory.receiveTransfer(f.actor, "arrive", {
    transferId: transfer.id,
    lineId: transfer.lineId,
    quantity: 1,
    serial: "S1",
    receiptRef: "ARRIVE",
    bin: "B-1",
    condition: "usable",
    reason: "Synthetic arrival",
  });
  const received = f.app.procurement.receipts({ ...warehouse, sites: [f.w1] });
  assert.equal(received.length, 1);
  assert.equal(received[0]!.po_id, f.po);
  assert.deepEqual(
    received[0]!.candidates.map((u) => u.warehouse_id),
    [f.w2],
  );
  assert.equal(f.app.procurement.orders(warehouse).length, 0);
});

test("absent, foreign and disabled principals cannot execute or retrieve any purchasing command, including completed draft decisions", (t) => {
  const f = fixture(t),
    actor = user(f, "admin", "command-admin");
  const input = delivery(f, "direct-security");
  const pending = delivery(f, "pending-security");
  const confirmation = delivery(f, "confirmed-security");
  const discarded = delivery(f, "discard-security");
  const saved = f.app.procurement.drafts.save(actor, "save", pending);
  const confirmedDraft = f.app.procurement.drafts.save(
    actor,
    "confirmation-save",
    confirmation,
  );
  const discardedDraft = f.app.procurement.drafts.save(
    actor,
    "discard-save",
    discarded,
  );
  const unit = f.app.inventory.trace(f.actor, "S3").unit;
  const supplierInput = { name: "Security supplier" };
  const createInput = {
    supplierId: f.supplier,
    warehouseId: f.w1,
    lines: [{ productId: f.product, quantity: 1, unitCost: 5000 }],
  };
  const returnInput = {
    receiptId: f.app.inventory.purchaseOrigin(f.actor, unit.id)!,
    unitId: unit.id,
    revision: unit.revision,
    quantity: 1,
    serial: "S3",
    returnRef: "SECURITY-RETURN",
    reason: "Synthetic defect",
    handoverEvidence: "Synthetic handover",
  };
  const confirmInput = { draftId: confirmedDraft.id, revision: 1 };
  const discardInput = {
    draftId: discardedDraft.id,
    revision: 1,
    reason: "Synthetic cancelled delivery",
  };
  const commands = [
    (a: Actor, key: string) =>
      f.app.procurement.supplier(a, key, supplierInput),
    (a: Actor, key: string) => f.app.procurement.create(a, key, createInput),
    (a: Actor, key: string) => f.app.procurement.receive(a, key, input),
    (a: Actor, key: string) =>
      f.app.procurement.returnStock(a, key, returnInput),
    (a: Actor, key: string) =>
      f.app.procurement.drafts.save(a, key, {
        ...pending,
        draftId: saved.id,
        revision: 1,
      }),
    (a: Actor, key: string) =>
      f.app.procurement.drafts.confirm(a, key, confirmInput),
    (a: Actor, key: string) =>
      f.app.procurement.drafts.discard(a, key, discardInput),
  ];
  commands.forEach((command, i) => command(actor, `command-${i}`));
  // Each invalid principal must leave the independent owning stores unchanged,
  // including command receipts, audit and public events.
  change(f, actor, { active: false });
  const before = facts(f);
  for (const principal of [
    actor,
    { ...actor, id: "absent" },
    { ...actor, orgId: "foreign" },
  ]) {
    for (const read of reads(f, principal, saved.id))
      assert.throws(read, { code: "FORBIDDEN" });
    commands.forEach((command, i) => {
      assert.throws(() => command(principal, `command-${i}`), {
        code: "FORBIDDEN",
      });
      assert.throws(() => command(principal, `new-${i}`), {
        code: "FORBIDDEN",
      });
    });
    assert.deepEqual(facts(f), before);
  }
  // Required password changes also fence already-completed confirm/discard keys.
  change(f, actor, { active: true });
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
      actor.id,
    );
  const restricted = facts(f);
  commands.forEach((command, i) => {
    assert.throws(() => command(actor, `command-${i}`), {
      code: "PASSWORD_CHANGE_REQUIRED",
    });
    assert.throws(() => command(actor, `new-${i}`), {
      code: "PASSWORD_CHANGE_REQUIRED",
    });
  });
  assert.deepEqual(facts(f), restricted);
});
