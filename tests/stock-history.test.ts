import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import type { Actor, Role } from "../src/server/core.ts";

type Fixture = ReturnType<typeof fixture>;
function worker(f: Fixture, role: Role = "warehouse", sites = [f.w1]) {
  const row = f.app.identity.createUser(f.actor, `history-${role}`, {
    email: `history-${role}@example.test`,
    name: role,
    role,
    sites,
    password: "long-test-only-password",
    ...(role === "buyer" ? { accountId: f.buyer } : {}),
  });
  return f.app.identity.currentActor({ ...f.actor, id: row.id });
}
function change(f: Fixture, actor: Actor, changes: Record<string, unknown>) {
  const row = f.app.identity.users(f.actor).find((u) => u.id === actor.id)!;
  f.app.identity.updateUser(
    f.actor,
    `history-change-${row.id}-${row.revision}`,
    {
      userId: row.id,
      revision: row.revision,
      email: row.email,
      name: actor.name,
      role: actor.role,
      sites: actor.sites,
      accountId: actor.accountId ?? undefined,
      active: true,
      currentPassword: "long-test-only-password",
      reason: "Synthetic history access change",
      ...changes,
    },
  );
}
function facts(f: Fixture) {
  return ["units", "movements", "allocations", "cost_sequences"]
    .map((name) =>
      f.app.database
        .owned("inventory")
        .all(`SELECT * FROM inventory_${name} ORDER BY rowid`),
    )
    .concat(
      ["audit", "commands", "events"].map((name) =>
        f.app.database
          .owned("platform")
          .all(`SELECT * FROM platform_${name} ORDER BY rowid`),
      ),
    );
}
function move(f: Fixture, unitId: string, n: number) {
  const u = f.app.inventory.unit(f.actor, unitId);
  return f.app.inventory.relocate(f.actor, `history-move-${unitId}-${n}`, {
    unitId,
    revision: u.revision,
    sourceBin: u.bin,
    bin: `HISTORY-${n}`,
    serial: u.serial,
    reason: `Synthetic putaway ${n}`,
  });
}
function bulk(f: Fixture) {
  const productId = f.app.catalog.create(f.actor, "history-bulk", {
    sku: "HISTORY-BULK",
    name: "Synthetic bulk history",
    serialized: false,
    unitPrice: 400,
    taxBasisPoints: 0,
  }).id;
  const poId = f.app.procurement.create(f.actor, "history-bulk-po", {
    supplierId: f.supplier,
    warehouseId: f.w1,
    lines: [{ productId, quantity: 6, unitCost: 125 }],
  }).id;
  f.app.procurement.receive(f.actor, "history-bulk-receipt", {
    poId,
    lineId: String(f.app.procurement.order(f.actor, poId).lines[0]!.id),
    deliveryRef: "HISTORY-BULK-RECEIPT",
    quantity: 6,
    serials: [],
    bin: "BULK-A",
    quarantine: true,
  });
  return f.app.inventory
    .stock(f.actor)
    .find((u) => u.product_id === productId)!;
}

// Removing the page bound, insertion ordering or scope binding must break these observations.
for (const region of ["CA", "US"] as const)
  test(`${region} stock history traverses original-cost serial and bulk movements without native writes`, (t) => {
    const f = fixture(t, {}, region),
      actor = worker(f),
      lot = bulk(f);
    const unitId = f.app.inventory.trace(f.actor, "S1").unit.id;
    for (let n = 1; n <= 25; n++) move(f, unitId, n);
    move(f, lot.id, 1);
    // Tied timestamps must not skip committed movements or reorder UUIDs.
    f.app.database
      .owned("inventory")
      .run(
        "UPDATE inventory_movements SET created_at='2026-10-02T00:00:00.000Z' WHERE unit_id=?",
        unitId,
      );
    const before = facts(f);
    const first = f.app.inventory.movementPage(actor, { unitId });
    assert.equal(first.items.length, 20);
    assert.ok(first.next);
    assert.equal(first.unit.bin, "HISTORY-25");
    assert.equal(first.unit.serial, "S1");
    assert.deepEqual(
      first.items.map((m) => m.reason),
      Array.from(
        { length: 20 },
        (_, i) =>
          `"${i === 19 ? "HISTORY-5" : `HISTORY-${24 - i}`}" → "HISTORY-${25 - i}": Synthetic putaway ${25 - i}`,
      ),
    );
    assert.ok(
      first.items.every(
        (m) =>
          m.quantity === 0 && m.unit_cost === 6000 && m.type === "relocation",
      ),
    );
    assert.deepEqual(facts(f), before);
    f.app.close();
    f.app = new Application(f.path, region);
    assert.deepEqual(
      f.app.inventory.movementPage(actor, { serial: "S1" }),
      first,
    );
    move(f, unitId, 26);
    const older = f.app.inventory.movementPage(actor, {
      unitId,
      after: first.next!,
    });
    assert.equal(older.items.length, 6);
    assert.equal(older.next, null);
    assert.deepEqual(
      older.items.slice(0, 5).map((m) => m.type),
      ["relocation", "relocation", "relocation", "relocation", "relocation"],
    );
    assert.equal(older.items[5]!.type, "receipt");
    assert.equal(older.items[5]!.quantity, 1);
    assert.equal(older.items[5]!.unit_cost, 6000);
    assert.equal(
      new Set([...first.items, ...older.items].map((m) => m.id)).size,
      26,
    );
    assert.equal(older.unit.bin, "HISTORY-26");
    const last = f.app.inventory.movementPage(actor, { unitId: lot.id });
    assert.equal(last.unit.serial, null);
    assert.equal(last.unit.quantity, 6);
    assert.deepEqual(
      last.items.map((m) => [m.type, m.quantity, m.unit_cost]),
      [
        ["relocation", 0, 125],
        ["receipt", 6, 125],
      ],
    );
    assert.equal(last.next, null);
    // The sole later relocation is the only intentional change after the baseline.
    const afterMove = facts(f);
    f.app.inventory.movementPage(actor, { serial: "S1" });
    f.app.inventory.movementPage(actor, { unitId: lot.id });
    assert.deepEqual(facts(f), afterMove);
    assert.notDeepEqual(afterMove, before);
  });

test("stock history rejects foreign identifiers/cursors and hides other-site movements", (t) => {
  const f = fixture(t),
    actor = worker(f),
    unitId = f.app.inventory.trace(f.actor, "S1").unit.id;
  for (let n = 1; n <= 22; n++) move(f, unitId, n);
  const store = f.app.database.owned("inventory");
  store.run(
    "INSERT INTO inventory_movements SELECT 'history-foreign', 'foreign-org', unit_id, warehouse_id, type, quantity, unit_cost, 'PRIVATE-FOREIGN', reason, actor_id, created_at FROM inventory_movements WHERE unit_id=? LIMIT 1",
    unitId,
  );
  store.run(
    "INSERT INTO inventory_movements SELECT 'history-other-site', org_id, unit_id, ?, type, quantity, unit_cost, 'PRIVATE-OTHER-SITE', reason, actor_id, created_at FROM inventory_movements WHERE unit_id=? LIMIT 1",
    f.w2,
    unitId,
  );
  const page = f.app.inventory.movementPage(actor, { unitId });
  assert.equal(page.items.length, 20);
  assert.ok(!JSON.stringify(page).includes("PRIVATE"));
  assert.equal(
    f.app.inventory.movementPage(f.actor, { unitId }).items[0]!.reference,
    "PRIVATE-OTHER-SITE",
  );
  const other = f.app.inventory.trace(f.actor, "S2").unit.id;
  const before = facts(f);
  const anchor = JSON.parse(Buffer.from(page.next!, "base64url").toString());
  const forged = (id: string) =>
    Buffer.from(JSON.stringify([...anchor.slice(0, 4), id])).toString(
      "base64url",
    );
  for (const input of [
    { unitId: other, after: page.next! },
    { unitId, after: forged("history-foreign") },
    { unitId, after: forged("history-other-site") },
    { unitId, after: "invalid" },
    { unitId, after: page.next! + "=" },
    { unitId, serial: "S1" },
    {},
    { serial: "" },
    { unitId: "missing" },
    { serial: "missing" },
  ])
    assert.throws(() => f.app.inventory.movementPage(actor, input));
  assert.deepEqual(facts(f), before);
});

test("stock history rechecks persisted role, warehouse, password and active grants before every page", (t) => {
  const f = fixture(t),
    actor = worker(f),
    unitId = f.app.inventory.trace(f.actor, "S1").unit.id;
  for (let n = 1; n <= 22; n++) move(f, unitId, n);
  const first = f.app.inventory.movementPage(actor, { unitId });
  change(f, actor, { sites: [f.w2] });
  assert.throws(
    () =>
      f.app.inventory.movementPage(
        { ...actor, role: "admin", sites: [f.w1, f.w2] },
        { unitId, after: first.next! },
      ),
    { code: "FORBIDDEN" },
  );
  change(f, actor, { sites: [f.w1], role: "buyer", accountId: f.buyer });
  assert.throws(() => f.app.inventory.movementPage(actor, { unitId }), {
    code: "FORBIDDEN",
  });
  change(f, actor, { sites: [f.w1], role: "warehouse", accountId: undefined });
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
      actor.id,
    );
  assert.throws(() => f.app.inventory.movementPage(actor, { unitId }), {
    code: "PASSWORD_CHANGE_REQUIRED",
  });
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_user_security SET password_change_required=0 WHERE user_id=?",
      actor.id,
    );
  change(f, actor, { active: false });
  assert.throws(() => f.app.inventory.movementPage(actor, { unitId }), {
    code: "FORBIDDEN",
  });
});

test("stock history HTTP supports exact serial/unit selection, strict inputs and finance access without writes", async (t) => {
  const f = fixture(t),
    finance = worker(f, "finance"),
    http = await createHttp(f.app, { origin: "http://localhost:3000" });
  t.after(() => http.close());
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin: "http://localhost:3000" },
    payload: {
      email: "history-finance@example.test",
      password: "long-test-only-password",
    },
  });
  assert.equal(login.statusCode, 200);
  const cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const unitId = f.app.inventory.trace(f.actor, "S1").unit.id,
    before = facts(f);
  const response = await http.inject({
    url: `/api/stock/history?serial=S1`,
    headers: { cookie },
  });
  assert.equal(response.statusCode, 200);
  const expected = f.app.inventory.movementPage(finance, { unitId });
  assert.deepEqual(response.json(), {
    ...expected,
    items: expected.items.map((m) => ({
      ...m,
      currentActorName: "Administrator",
    })),
  });
  for (const suffix of [
    "?serial=S1&unitId=" + unitId,
    "",
    "?serial=S1&limit=1000",
    "?serial=S1&after=bad",
    "?serial=",
    "?unitId=missing",
  ]) {
    const r = await http.inject({
      url: "/api/stock/history" + suffix,
      headers: { cookie },
    });
    assert.equal(r.statusCode, suffix.endsWith("missing") ? 404 : 400);
  }
  assert.equal(
    (await http.inject({ url: "/api/stock/history?serial=S1" })).statusCode,
    401,
  );
  assert.deepEqual(facts(f), before);
});
