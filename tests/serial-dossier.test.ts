import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, accept, ship } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import type { Actor, Role } from "../src/server/core.ts";

type Fixture = ReturnType<typeof fixture>;
function facts(f: Fixture) {
  return Object.fromEntries(
    (
      [
        ["inventory", ["units", "movements", "allocations"]],
        ["procurement", ["orders", "receipts"]],
        ["orders", ["orders"]],
        ["fulfillment", ["shipments"]],
        ["billing", ["invoices", "credits", "payments"]],
        ["warranty", ["claims", "replacements"]],
        ["platform", ["commands", "audit", "events"]],
      ] as const
    ).flatMap(([owner, tables]) =>
      tables.map((table) => [
        `${owner}_${table}`,
        f.app.database
          .owned(owner)
          .all(`SELECT * FROM ${owner}_${table} ORDER BY rowid`),
      ]),
    ),
  );
}
function transfer(f: Fixture, destinationId: string, key: string) {
  const u = f.app.inventory.trace(f.actor, "S1").unit;
  const tr = f.app.inventory.dispatchTransfer(f.actor, key, {
    unitId: u.id,
    quantity: 1,
    revision: u.revision,
    destinationId,
    reason: "Synthetic serial relocation",
  });
  f.app.inventory.receiveTransfer(f.actor, `${key}-arrival`, {
    transferId: tr.id,
    lineId: tr.lineId,
    quantity: 1,
    serial: "S1",
    receiptRef: key,
    bin: "DOSSIER",
    condition: "usable",
    reason: "Synthetic arrival",
  });
  return tr.id;
}
function staff(f: Fixture, role: Role = "warehouse", sites = [f.w1]) {
  const row = f.app.identity.createUser(f.actor, `dossier-${role}`, {
    email: `dossier-${role}@example.test`,
    name: role,
    role,
    sites,
    password: "long-test-only-password",
    ...(role === "buyer" ? { accountId: f.buyer } : {}),
  });
  return f.app.identity.currentActor({ ...f.actor, id: row.id });
}
function grants(f: Fixture, actor: Actor, changes: Record<string, unknown>) {
  const row = f.app.identity.users(f.actor).find((u) => u.id === actor.id)!;
  f.app.identity.updateUser(
    f.actor,
    `dossier-grants-${row.id}-${row.revision}`,
    {
      userId: row.id,
      revision: row.revision,
      email: row.email,
      name: actor.name,
      role: actor.role,
      sites: actor.sites,
      active: true,
      currentPassword: "long-test-only-password",
      reason: "Synthetic dossier grant review",
      ...changes,
    },
  );
}
for (const region of ["CA", "US"] as const)
  test(`${region} serial dossier links original receipt, transfers, committed sale, invoice and claim across restart without writes`, (t) => {
    const f = fixture(t, {}, region);
    const out = transfer(f, f.w2, "dossier-out"),
      back = transfer(f, f.w1, "dossier-back");
    const order = accept(f, 1, "dossier-sale"),
      sale = ship(f, order.id);
    const unitId = f.app.inventory.trace(f.actor, "S1").unit.id;
    const claim = f.app.warranty.submit(f.actor, "dossier-claim", {
      accountId: f.buyer,
      unitId,
      type: "warranty",
      issue: "Synthetic serial failure",
      evidence: "Synthetic report",
    });
    const before = facts(f),
      dossier = f.app.serialDossier(f.actor, { serial: "S1" });
    assert.equal(dossier.movements.unit.id, unitId);
    assert.equal(dossier.movements.unit.state, "sold");
    assert.deepEqual(
      new Set(
        dossier.movements.items
          .filter((m) => m.type.startsWith("transfer."))
          .map((m) => m.reference),
      ),
      new Set([out, back]),
    );
    assert.equal(dossier.receipt?.purchaseOrderId, f.po);
    assert.equal(dossier.receipt?.deliveryReference, "DEL-1");
    assert.equal(dossier.receipt?.warehouseId, f.w1);
    assert.equal(dossier.shipments.items.length, 1);
    assert.equal(dossier.shipments.items[0]?.id, sale.id);
    assert.equal(dossier.shipments.items[0]?.orderId, order.id);
    assert.equal(dossier.shipments.items[0]?.invoice?.id, sale.invoiceId);
    assert.equal(dossier.shipments.items[0]?.invoice?.total, 11300);
    assert.equal(
      dossier.shipments.items[0]?.invoice?.currency,
      region === "CA" ? "CAD" : "USD",
    );
    assert.equal(dossier.claims.items[0]?.id, claim.id);
    assert.equal(dossier.claims.items[0]?.invoiceId, sale.invoiceId);
    assert.equal(dossier.claims.items[0]?.relationship, "claimed");
    assert.deepEqual(facts(f), before);
    f.app.close();
    f.app = new Application(f.path, region);
    assert.deepEqual(f.app.serialDossier(f.actor, { serial: "S1" }), dossier);
    assert.deepEqual(facts(f), before);
  });

test("serial dossier bounds repeated native sales and claims, traverses equal timestamps, and binds every cursor to serial, section and sites", (t) => {
  const f = fixture(t),
    actor = staff(f),
    ids: string[] = [],
    sales: string[] = [];
  const unitId = f.app.inventory.trace(f.actor, "S1").unit.id;
  for (let n = 1; n <= 22; n++) {
    const sale = ship(f, accept(f, 1, `dossier-sale-${n}`).id);
    sales.push(sale.id);
    const c = f.app.warranty.submit(f.actor, `dossier-claim-${n}`, {
      accountId: f.buyer,
      unitId,
      type: "return",
      issue: `Synthetic return ${n}`,
      evidence: "Synthetic report",
    });
    ids.push(c.id);
    f.app.warranty.review(f.actor, `dossier-approve-${n}`, {
      claimId: c.id,
      approved: true,
      reason: "Synthetic approval",
    });
    f.app.warranty.receive(f.actor, `dossier-receive-${n}`, {
      claimId: c.id,
      warehouseId: f.w1,
      bin: "DOSSIER",
      serial: "S1",
    });
    f.app.warranty.inspect(f.actor, `dossier-inspect-${n}`, {
      claimId: c.id,
      findings: "Synthetic working unit",
    });
    f.app.warranty.dispose(f.actor, `dossier-restock-${n}`, {
      claimId: c.id,
      disposition: "restock",
      reason: "Synthetic accepted return",
    });
  }
  f.app.database
    .owned("warranty")
    .run(
      "UPDATE warranty_claims SET created_at='2026-10-02T00:00:00.000Z' WHERE unit_id=?",
      unitId,
    );
  f.app.database
    .owned("fulfillment")
    .run(
      "UPDATE fulfillment_shipments SET shipped_at='2026-10-02T00:00:00.000Z' WHERE org_id=?",
      f.actor.orgId,
    );
  const before = facts(f),
    first = f.app.serialDossier(actor, { serial: "S1" });
  assert.deepEqual(
    first.claims.items.map((c) => c.id),
    ids.slice(-20).reverse(),
  );
  assert.deepEqual(
    first.shipments.items.map((s) => s.id),
    sales.slice(-20).reverse(),
  );
  assert.equal(first.movements.items.length, 20);
  assert.ok(first.claims.next);
  assert.ok(first.shipments.next);
  assert.ok(first.movements.next);
  const older = f.app.serialDossier(actor, {
    serial: "S1",
    claimAfter: first.claims.next!,
    shipmentAfter: first.shipments.next!,
  });
  assert.deepEqual(
    older.claims.items.map((c) => c.id),
    ids.slice(0, 2).reverse(),
  );
  assert.deepEqual(
    older.shipments.items.map((s) => s.id),
    sales.slice(0, 2).reverse(),
  );
  assert.equal(older.claims.next, null);
  assert.equal(older.shipments.next, null);
  for (const input of [
    { serial: "S2", claimAfter: first.claims.next! },
    { serial: "S2", shipmentAfter: first.shipments.next! },
    { serial: "S1", shipmentAfter: first.claims.next! },
    { serial: "S1", claimAfter: first.shipments.next! },
    { serial: "S1", claimAfter: first.claims.next! + "=" },
    { serial: "S1", claimAfter: "invalid" },
  ])
    assert.throws(() => f.app.serialDossier(actor, input), {
      code: "VALIDATION",
    });
  const token = JSON.parse(
    Buffer.from(first.claims.next!, "base64url").toString(),
  );
  const forged = Buffer.from(
    JSON.stringify([...token.slice(0, 5), "foreign-claim"]),
  ).toString("base64url");
  assert.throws(
    () => f.app.serialDossier(actor, { serial: "S1", claimAfter: forged }),
    { code: "VALIDATION" },
  );
  assert.deepEqual(facts(f), before);
  grants(f, actor, { sites: [f.w1, f.w2] });
  assert.throws(
    () =>
      f.app.serialDossier(actor, {
        serial: "S1",
        claimAfter: first.claims.next!,
      }),
    { code: "VALIDATION" },
  );
});

test("serial dossier hides receipt and sales outside current warehouse grants and rechecks role, password and active status", (t) => {
  const f = fixture(t),
    actor = staff(f, "warehouse", [f.w2]);
  const sale = ship(f, accept(f).id),
    unitId = f.app.inventory.trace(f.actor, "S1").unit.id;
  const c = f.app.warranty.submit(f.actor, "dossier-cross-site", {
    accountId: f.buyer,
    unitId,
    type: "return",
    issue: "Synthetic return",
    evidence: "Synthetic",
  });
  f.app.warranty.review(f.actor, "dossier-cross-approval", {
    claimId: c.id,
    approved: true,
    reason: "Synthetic approval",
  });
  f.app.warranty.receive(f.actor, "dossier-cross-arrival", {
    claimId: c.id,
    warehouseId: f.w2,
    bin: "Q",
    serial: "S1",
  });
  const read = () =>
    f.app.serialDossier(
      { ...actor, role: "admin" as const, sites: [f.w1, f.w2] },
      { serial: "S1" },
    );
  const page = read();
  assert.equal(page.receipt, null);
  assert.deepEqual(page.shipments.items, []);
  assert.equal(page.claims.items[0]?.id, c.id);
  assert.equal(page.claims.items[0]?.invoiceId, sale.invoiceId);
  assert.ok(page.movements.items.every((m) => m.warehouse_id === f.w2));
  grants(f, actor, { sites: [f.w1] });
  assert.throws(read, { code: "FORBIDDEN" });
  grants(f, actor, { sites: [f.w2], role: "support" });
  assert.throws(read, { code: "FORBIDDEN" });
  grants(f, actor, { sites: [f.w2] });
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
      actor.id,
    );
  assert.throws(read, { code: "PASSWORD_CHANGE_REQUIRED" });
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_user_security SET password_change_required=0 WHERE user_id=?",
      actor.id,
    );
  grants(f, actor, { active: false });
  assert.throws(read, { code: "FORBIDDEN" });
});

test("serial dossier follows replacement lineage without inventing a new sale or invoice", (t) => {
  const f = fixture(t),
    sale = ship(f, accept(f).id);
  const original = f.app.inventory.trace(f.actor, "S1").unit;
  const replacement = f.app.inventory.trace(f.actor, "S2").unit;
  const claim = f.app.warranty.submit(f.actor, "dossier-replacement-claim", {
    accountId: f.buyer,
    unitId: original.id,
    type: "warranty",
    issue: "Synthetic failure",
    evidence: "Synthetic report",
  });
  f.app.warranty.review(f.actor, "dossier-replacement-review", {
    claimId: claim.id,
    approved: true,
    reason: "Synthetic approval",
  });
  f.app.warranty.receive(f.actor, "dossier-replacement-receive", {
    claimId: claim.id,
    warehouseId: f.w1,
    bin: "Q",
    serial: "S1",
  });
  f.app.warranty.inspect(f.actor, "dossier-replacement-inspect", {
    claimId: claim.id,
    findings: "Synthetic inspected failure",
  });
  const reserved = f.app.warranty.reserveReplacement(
    f.actor,
    "dossier-replacement-reserve",
    {
      claimId: claim.id,
      newUnitId: replacement.id,
      oldDisposition: "scrap",
      coveragePolicy: "inherit_original",
      reason: "Synthetic replacement approval",
    },
  );
  const beforeReservedRead = facts(f);
  const candidate = f.app.serialDossier(f.actor, { serial: "S2" });
  assert.equal(candidate.claims.items[0]?.replacementState, "reserved");
  assert.deepEqual(facts(f), beforeReservedRead);
  f.app.warranty.handoverReplacement(f.actor, "dossier-replacement-handover", {
    replacementId: reserved.id,
    revision: 1,
    serial: "S2",
    recipient: "Synthetic recipient",
    evidence: "Synthetic collection",
  });
  const before = facts(f),
    dossier = f.app.serialDossier(f.actor, { serial: "S2" });
  assert.equal(dossier.receipt?.purchaseOrderId, f.po);
  assert.deepEqual(dossier.shipments.items, []);
  assert.equal(dossier.claims.items[0]?.id, claim.id);
  assert.equal(dossier.claims.items[0]?.unitId, original.id);
  assert.equal(dossier.claims.items[0]?.invoiceId, sale.invoiceId);
  assert.equal(dossier.claims.items[0]?.relationship, "replacement");
  assert.equal(dossier.claims.items[0]?.replacementState, "handed_over");
  assert.deepEqual(facts(f), before);
});

test("serial dossier HTTP requires authenticated staff, strict serial/cursor input and conserves native facts", async (t) => {
  const f = fixture(t),
    actor = staff(f, "finance"),
    http = await createHttp(f.app, { origin: "http://localhost:3000" });
  t.after(() => http.close());
  staff(f, "buyer");
  const login = async (role: string) => {
    const r = await http.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin: "http://localhost:3000" },
      payload: {
        email: `dossier-${role}@example.test`,
        password: "long-test-only-password",
      },
    });
    assert.equal(r.statusCode, 200);
    return r.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  };
  const cookie = await login("finance"),
    buyerCookie = await login("buyer"),
    before = facts(f);
  const response = await http.inject({
    url: "/api/serials/dossier?serial=S1",
    headers: { cookie },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(
    response.json(),
    JSON.parse(JSON.stringify(f.app.serialDossier(actor, { serial: "S1" }))),
  );
  for (const suffix of [
    "",
    "?serial=",
    "?serial=S1&unitId=other",
    "?serial=S1&limit=1000",
    "?serial=S1&claimAfter=bad",
    "?serial=S1&shipmentAfter=bad",
    "?serial=S1&movementAfter=bad",
  ])
    assert.equal(
      (
        await http.inject({
          url: "/api/serials/dossier" + suffix,
          headers: { cookie },
        })
      ).statusCode,
      400,
    );
  assert.equal(
    (
      await http.inject({
        url: "/api/serials/dossier?serial=missing",
        headers: { cookie },
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (await http.inject({ url: "/api/serials/dossier?serial=S1" })).statusCode,
    401,
  );
  assert.deepEqual(facts(f), before);
  assert.equal(
    (
      await http.inject({
        url: "/api/serials/dossier?serial=S1",
        headers: { cookie: buyerCookie },
      })
    ).statusCode,
    403,
  );
  const afterDenied = facts(f);
  const audit = afterDenied.platform_audit as { action: string }[];
  assert.equal(audit.length, (before.platform_audit as unknown[]).length + 1);
  assert.equal(audit.at(-1)?.action, "authorization.denied");
  assert.deepEqual(
    { ...afterDenied, platform_audit: before.platform_audit },
    before,
  );
});
