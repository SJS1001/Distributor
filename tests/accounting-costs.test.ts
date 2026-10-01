import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { fixture, accept, ship } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { digest } from "../src/server/core.ts";
import { createHttp } from "../src/server/http.ts";
import type { CostInput } from "../src/server/integration-costs.ts";

type Fixture = ReturnType<typeof fixture>;
function initial(f: Fixture, batchRef = "COST-1"): CostInput {
  const source = f.app.integration.costs.source(f.actor);
  return {
    version: 1,
    batchRef,
    afterSequence: 0,
    throughSequence: source.throughSequence,
    inventoryAccount: "1200",
    mappings: [{ type: "receipt", offsetAccount: "2100" }],
    expectedMovements: 3,
    expectedIncrease: 18000,
    expectedDecrease: 0,
    expectedOpeningValue: 0,
    expectedClosingValue: 18000,
    acknowledgment:
      "Synthetic independent receipt review; no duplicate external posting; regional receiver qualified.",
  };
}
function approve(f: Fixture, input = initial(f)) {
  const p = f.app.integration.costs.prepare(
    f.actor,
    `prepare-${input.batchRef}`,
    input,
  );
  return f.app.integration.costs.decide(f.actor, `approve-${input.batchRef}`, {
    packetId: p.id,
    reviewHash: p.reviewHash,
    decision: "approve",
    reason: "Synthetic finance review",
  });
}
function receipt(p: ReturnType<typeof approve>) {
  return {
    packetId: p.id,
    contentHash: p.contentHash!,
    receiverRef: "ca-ledger",
    receiverRegion: "CA" as const,
    externalRef: "IMPORT-1",
    debit: p.controls.debit,
    credit: p.controls.credit,
    reason: "Synthetic receiver independently accepted these totals",
  };
}
function inspect(f: Fixture, key: string) {
  const u = f.app.inventory
    .stock(f.actor)
    .find((u) => u.state === "stock" && u.quantity > 0)!;
  f.app.inventory.inspect(f.actor, key, {
    unitId: u.id,
    revision: u.revision,
    condition: "usable",
    reason: "Synthetic inspection",
  });
}
function bulk(f: Fixture, quantity = 6, unitCost = 1000) {
  const product = f.app.catalog.create(f.actor, "bulk", {
    sku: "COST-BULK",
    name: "Synthetic bulk",
    serialized: false,
    unitPrice: 2500,
    taxBasisPoints: 1300,
  }).id;
  const po = f.app.procurement.create(f.actor, "bulk-po", {
    supplierId: f.supplier,
    warehouseId: f.w1,
    lines: [{ productId: product, quantity, unitCost }],
  }).id;
  const line = f.app.procurement.orders(f.actor).find((p) => p.id === po)!
    .lines[0]!;
  f.app.procurement.receive(f.actor, "bulk-receipt", {
    poId: po,
    lineId: String(line.id),
    quantity,
    serials: [],
    deliveryRef: "BULK",
    bin: "B",
    quarantine: false,
  });
  return f.app.inventory.stock(f.actor).find((u) => u.product_id === product)!;
}

test("cost approval freezes balanced original-cost evidence, survives restart and distinguishes export from receiver acceptance", (t) => {
  const f = fixture(t),
    costs = f.app.integration.costs,
    input = initial(f),
    before = {
      stock: f.app.inventory.stock(f.actor),
      invoices: f.app.billing.invoices(f.actor),
      events: f.app.platform.events(f.actor),
    };
  const prepared = costs.prepare(f.actor, "prepare", input);
  assert.equal(prepared.state, "ready");
  assert.equal(prepared.region, "CA");
  assert.equal(prepared.currency, "CAD");
  assert.throws(() => costs.download(f.actor, prepared.id), {
    code: "COST_REVIEW_REQUIRED",
  });
  const p = costs.decide(f.actor, "approve", {
    packetId: prepared.id,
    reviewHash: prepared.reviewHash,
    decision: "approve",
    reason: "Checked three 6000-cent receipts",
  });
  assert.equal(p.state, "reviewed");
  assert.equal(p.receipt, null);
  const file = costs.download(f.actor, p.id),
    data = JSON.parse(file.bytes);
  assert.equal(digest(file.bytes), p.contentHash);
  assert.ok(file.bytes.endsWith("\n"));
  assert.equal(data.report.journal.length, 6);
  assert.equal(data.report.debit, 18000);
  assert.equal(data.report.credit, 18000);
  assert.deepEqual(
    data.report.journal.map((l: any) => [l.account, l.debit, l.credit]),
    Array.from({ length: 3 }, () => [
      ["1200", 6000, 0],
      ["2100", 0, 6000],
    ]).flat(),
  );
  assert.equal(costs.source(f.actor).movements.length, 0);
  assert.deepEqual(f.app.inventory.stock(f.actor), before.stock);
  assert.deepEqual(f.app.billing.invoices(f.actor), before.invoices);
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(
    f.app.integration.costs.prepare(f.actor, "prepare", input),
    prepared,
  );
  assert.deepEqual(f.app.integration.costs.download(f.actor, p.id), file);
  const evidence = receipt(p),
    accepted = f.app.integration.costs.accept(f.actor, "accepted", evidence);
  assert.equal(accepted.state, "accepted");
  assert.deepEqual(
    f.app.integration.costs.accept(f.actor, "accepted-new-key", evidence),
    accepted,
  );
  assert.deepEqual(f.app.integration.costs.download(f.actor, p.id), file);
  assert.throws(
    () =>
      f.app.integration.costs.accept(f.actor, "different", {
        ...evidence,
        reason: "Changed evidence",
      }),
    { code: "COST_ACCEPTANCE_CONFLICT" },
  );
  assert.throws(
    () =>
      f.app.integration.costs.prepare(f.actor, "conflict", {
        ...input,
        expectedIncrease: 1,
      }),
    { code: "COST_REFERENCE_CONFLICT" },
  );
});

test("transfer dispatch and arrivals preserve organization value; loss, recovery, count and shipment use original cost", (t) => {
  const f = fixture(t),
    u = bulk(f),
    tr = f.app.inventory.dispatchTransfer(f.actor, "dispatch", {
      unitId: u.id,
      quantity: 4,
      revision: u.revision,
      destinationId: f.w2,
      reason: "Synthetic transfer",
    });
  assert.equal(f.app.integration.costs.source(f.actor).closingValue, 24000);
  const lost = f.app.inventory.approveTransferLoss(f.actor, "loss", {
    transferId: tr.id,
    lineId: tr.lineId,
    revision: f.app.inventory.unit(f.actor, tr.unitId).revision,
    quantity: 2,
    serial: null,
    lossRef: "LOSS",
    reason: "Two missing units",
  });
  f.app.inventory.recoverTransferLoss(f.actor, "recover", {
    lossId: lost.lossId,
    quantity: 1,
    serial: null,
    receiptRef: "FOUND",
    bin: "Q",
    condition: "quarantine",
    reason: "One found unit",
  });
  f.app.inventory.receiveTransfer(f.actor, "arrive", {
    transferId: tr.id,
    lineId: tr.lineId,
    quantity: 2,
    serial: null,
    receiptRef: "ARRIVE",
    bin: "D",
    condition: "damaged",
    reason: "Two arrived",
  });
  const remaining = f.app.inventory.unit(f.actor, u.id);
  f.app.inventory.adjustCount(f.actor, "count", {
    unitId: u.id,
    revision: remaining.revision,
    count: 1,
    reason: "One remaining source unit missing",
  });
  ship(f, accept(f).id);
  const source = f.app.integration.costs.source(f.actor);
  assert.equal(source.increase, 25000);
  assert.equal(source.decrease, 9000);
  assert.equal(source.closingValue, 16000);
  assert.ok(
    source.movements
      .filter((m) => ["transfer.dispatch", "transfer.receive"].includes(m.type))
      .every((m) => m.valueDelta === 0),
  );
  assert.equal(
    source.movements.find((m) => m.type === "transfer.loss")!.valueDelta,
    -2000,
  );
  assert.equal(
    source.movements.find((m) => m.type === "transfer.recover")!.valueDelta,
    1000,
  );
  const p = approve(f, {
    ...initial(f),
    expectedMovements: source.movements.length,
    expectedIncrease: 25000,
    expectedDecrease: 9000,
    expectedClosingValue: 16000,
    mappings: [
      "receipt",
      "transfer.loss",
      "transfer.recover",
      "count",
      "shipment",
    ].map((type) => ({
      type,
      offsetAccount: type === "receipt" ? "2100" : "5000",
    })),
  });
  assert.equal(p.controls.debit, 34000);
  assert.equal(p.controls.credit, 34000);
  const inventoryLines = f.app.integration.costs
    .detail(f.actor, p.id)
    .report.journal.filter((l) => l.account === "1200");
  assert.equal(
    inventoryLines.reduce((v, l) => v + l.debit - l.credit, 0),
    16000,
  );
});

test("warranty return, reserve, release, handover, repair, restock and scrap reconcile original cost", (t) => {
  const f = fixture(t),
    sale = ship(f, accept(f).id),
    sold = f.app.inventory.stock(f.actor).find((u) => u.state === "sold")!;
  f.app.database.transaction(() =>
    f.app.inventory.receiveReturn(f.actor, sold.id, f.w1, "Q", sale.id),
  );
  f.app.database.transaction(() =>
    f.app.inventory.returnDisposition(
      f.actor,
      sold.id,
      "repair",
      "repair",
      "Synthetic repair",
    ),
  );
  f.app.database.transaction(() =>
    f.app.inventory.returnDisposition(
      f.actor,
      sold.id,
      "restock",
      "restock",
      "Synthetic restock",
    ),
  );
  const replacement = f.app.inventory
    .stock(f.actor)
    .find((u) => u.id !== sold.id && u.quantity === 1)!;
  f.app.database.transaction(() =>
    f.app.inventory.reserveReplacement(
      f.actor,
      "replacement",
      replacement.id,
      f.product,
    ),
  );
  f.app.database.transaction(() =>
    f.app.inventory.releaseReplacement(f.actor, "replacement", "Cancelled"),
  );
  f.app.database.transaction(() =>
    f.app.inventory.reserveReplacement(
      f.actor,
      "replacement-2",
      replacement.id,
      f.product,
    ),
  );
  f.app.database.transaction(() =>
    f.app.inventory.handoverReplacement(
      f.actor,
      "replacement-2",
      replacement.serial!,
      "Synthetic handover",
    ),
  );
  const unit = f.app.inventory.unit(f.actor, sold.id);
  f.app.inventory.inspect(f.actor, "quarantine", {
    unitId: unit.id,
    revision: unit.revision,
    condition: "quarantine",
    reason: "Failed repair",
  });
  f.app.database.transaction(() =>
    f.app.inventory.returnDisposition(
      f.actor,
      sold.id,
      "scrap",
      "scrap",
      "Approved scrap",
    ),
  );
  const source = f.app.integration.costs.source(f.actor);
  assert.equal(source.increase, 24000);
  assert.equal(source.decrease, 18000);
  assert.equal(source.closingValue, 6000);
  assert.ok(
    source.movements
      .filter((m) =>
        [
          "repair",
          "restock",
          "replacement.reserve",
          "replacement.cancel",
          "inspection",
        ].includes(m.type),
      )
      .every((m) => m.valueDelta === 0),
  );
});

test("independent controls and mappings block approval; rejection allows a corrected batch without claiming stock", (t) => {
  const f = fixture(t),
    costs = f.app.integration.costs;
  for (const [field, value] of Object.entries({
    expectedMovements: 2,
    expectedIncrease: 17999,
    expectedDecrease: 1,
    expectedOpeningValue: 1,
    expectedClosingValue: 17999,
  })) {
    const p = costs.prepare(f.actor, field, {
      ...initial(f, field),
      [field]: value,
    });
    assert.equal(p.state, "blocked");
    assert.ok(p.controls.issues.some((i) => i.code === "COST_CONTROL"));
    assert.throws(
      () =>
        costs.decide(f.actor, `approve-${field}`, {
          packetId: p.id,
          reviewHash: p.reviewHash,
          decision: "approve",
          reason: "Attempt",
        }),
      { code: "COST_BLOCKED" },
    );
    costs.decide(f.actor, `reject-${field}`, {
      packetId: p.id,
      reviewHash: p.reviewHash,
      decision: "reject",
      reason: "Correct independent evidence",
    });
  }
  for (const mappings of [[], [{ type: "opening", offsetAccount: "2100" }]]) {
    const p = costs.prepare(f.actor, `map-${mappings.length}`, {
      ...initial(f, `MAP-${mappings.length}`),
      mappings,
    });
    assert.equal(p.state, "blocked");
    assert.ok(p.controls.issues.some((i) => i.code === "COST_MAPPING"));
  }
  assert.throws(
    () =>
      costs.prepare(f.actor, "same-account", {
        ...initial(f),
        mappings: [{ type: "receipt", offsetAccount: "1200" }],
      }),
    { code: "VALIDATION" },
  );
  assert.throws(
    () =>
      costs.prepare(f.actor, "dup-map", {
        ...initial(f),
        mappings: [
          { type: "receipt", offsetAccount: "2100" },
          { type: "receipt", offsetAccount: "3000" },
        ],
      }),
    { code: "VALIDATION" },
  );
  assert.equal(costs.source(f.actor).afterSequence, 0);
  assert.equal(approve(f, initial(f, "CORRECTED")).state, "reviewed");
});

test("frozen cutoffs tolerate later stock, reject changed evidence and prevent skipped or overlapping reviews", (t) => {
  const f = fixture(t),
    costs = f.app.integration.costs,
    input = initial(f),
    p = costs.prepare(f.actor, "prepare", input),
    other = costs.prepare(f.actor, "other", { ...input, batchRef: "OTHER" });
  inspect(f, "later");
  assert.throws(
    () =>
      costs.decide(f.actor, "wrong-hash", {
        packetId: p.id,
        reviewHash: "forged",
        decision: "approve",
        reason: "Review",
      }),
    { code: "COST_REVIEW" },
  );
  costs.decide(f.actor, "approve", {
    packetId: p.id,
    reviewHash: p.reviewHash,
    decision: "approve",
    reason: "Review",
  });
  assert.throws(
    () =>
      costs.decide(f.actor, "other-review", {
        packetId: other.id,
        reviewHash: other.reviewHash,
        decision: "approve",
        reason: "Review",
      }),
    { code: "COST_CURSOR" },
  );
  assert.throws(
    () => costs.prepare(f.actor, "repeat", { ...input, batchRef: "REPEAT" }),
    { code: "COST_CURSOR" },
  );
  const source = costs.source(f.actor);
  assert.equal(source.movements.length, 1);
  assert.equal(source.openingValue, 18000);
  const next = {
    ...input,
    batchRef: "NEXT",
    afterSequence: source.afterSequence,
    throughSequence: source.throughSequence,
    mappings: [],
    expectedMovements: 1,
    expectedIncrease: 0,
    expectedOpeningValue: 18000,
  };
  const n = costs.prepare(f.actor, "next", next);
  const store = f.app.database.owned("inventory");
  store.run(
    "UPDATE inventory_movements SET reason='Changed evidence' WHERE id=?",
    source.movements[0]!.id,
  );
  assert.throws(
    () =>
      costs.decide(f.actor, "changed", {
        packetId: n.id,
        reviewHash: n.reviewHash,
        decision: "approve",
        reason: "Review",
      }),
    { code: "COST_REVIEW" },
  );
  assert.equal(costs.source(f.actor).afterSequence, source.afterSequence);
});

test("late audit faults roll back approval cursor, permanent claims and receiver acceptance", (t) => {
  const f = fixture(t),
    costs = f.app.integration.costs,
    p = costs.prepare(f.actor, "prepare", initial(f)),
    store = f.app.database.owned("integration"),
    audit = t.mock.method(f.app.platform, "audit", () => {
      throw Error("Synthetic late audit fault");
    });
  assert.throws(
    () =>
      costs.decide(f.actor, "approve", {
        packetId: p.id,
        reviewHash: p.reviewHash,
        decision: "approve",
        reason: "Review",
      }),
    /audit fault/,
  );
  assert.equal(costs.detail(f.actor, p.id).state, "ready");
  assert.equal(store.all("SELECT * FROM integration_cost_sources").length, 0);
  assert.equal(store.all("SELECT * FROM integration_cost_cursors").length, 0);
  audit.mock.restore();
  const reviewed = costs.decide(f.actor, "approve", {
    packetId: p.id,
    reviewHash: p.reviewHash,
    decision: "approve",
    reason: "Review",
  });
  const failedReceipt = t.mock.method(f.app.platform, "audit", () => {
    throw Error("Synthetic receipt audit fault");
  });
  assert.throws(
    () => costs.accept(f.actor, "accept", receipt(reviewed)),
    /audit fault/,
  );
  assert.equal(costs.detail(f.actor, p.id).state, "reviewed");
  assert.equal(store.all("SELECT * FROM integration_cost_receipts").length, 0);
  failedReceipt.mock.restore();
  assert.equal(
    costs.accept(f.actor, "accept", receipt(reviewed)).state,
    "accepted",
  );
});

test("acceptance checks exact hash, independent totals, original region and unique receiver references", (t) => {
  const f = fixture(t),
    costs = f.app.integration.costs,
    p = approve(f),
    input = receipt(p);
  for (const [change, code] of [
    [{ contentHash: "forged" }, "COST_INTEGRITY"],
    [{ debit: 17999 }, "COST_CONTROL"],
    [{ credit: 0 }, "COST_CONTROL"],
    [{ receiverRegion: "US" }, "RESIDENCY"],
  ] as const)
    assert.throws(
      () =>
        costs.accept(f.actor, code + JSON.stringify(change), {
          ...input,
          ...change,
        }),
      { code },
    );
  costs.accept(f.actor, "accept", input);
  inspect(f, "next");
  const source = costs.source(f.actor),
    q = approve(f, {
      ...initial(f, "ZERO"),
      afterSequence: source.afterSequence,
      throughSequence: source.throughSequence,
      mappings: [],
      expectedMovements: 1,
      expectedIncrease: 0,
      expectedOpeningValue: 18000,
    });
  assert.throws(
    () =>
      costs.accept(f.actor, "reused", { ...receipt(q), debit: 0, credit: 0 }),
    { code: "COST_ACCEPTANCE_CONFLICT" },
  );
  assert.equal(
    costs.accept(f.actor, "new", { ...receipt(q), externalRef: "IMPORT-2" })
      .state,
    "accepted",
  );
  const store = f.app.database.owned("integration");
  store.run(
    "UPDATE integration_cost_packets SET artifact=artifact||' ' WHERE id=?",
    p.id,
  );
  assert.throws(() => costs.download(f.actor, p.id), {
    code: "COST_INTEGRITY",
  });
});

test("current grants, required password changes and restore hold precede cached writes; history remains scoped", (t) => {
  const f = fixture(t),
    costs = f.app.integration.costs,
    input = initial(f),
    p = approve(f),
    evidence = receipt(p);
  costs.accept(f.actor, "accept", evidence);
  const iam = f.app.database.owned("iam");
  for (const role of ["buyer", "support", "commercial", "warehouse"]) {
    iam.run(
      "UPDATE iam_users SET role=?,account_id=? WHERE id=?",
      role,
      role === "buyer" ? f.buyer : null,
      f.actor.id,
    );
    for (const work of [
      () => costs.source(f.actor),
      () => costs.list(f.actor),
      () => costs.detail(f.actor, p.id),
      () => costs.download(f.actor, p.id),
      () => costs.accept(f.actor, "accept", evidence),
      () => costs.prepare(f.actor, "prepare-COST-1", input),
    ])
      assert.throws(work, { code: "FORBIDDEN" });
  }
  iam.run(
    "UPDATE iam_users SET role='finance',account_id=NULL WHERE id=?",
    f.actor.id,
  );
  assert.equal(costs.detail(f.actor, p.id).state, "accepted");
  iam.run(
    "INSERT INTO iam_user_security(user_id,revision,password_change_required,updated_at) VALUES(?,1,1,?)",
    f.actor.id,
    new Date().toISOString(),
  );
  assert.throws(() => costs.accept(f.actor, "accept", evidence), {
    code: "PASSWORD_CHANGE_REQUIRED",
  });
  iam.run(
    "UPDATE iam_user_security SET password_change_required=0 WHERE user_id=?",
    f.actor.id,
  );
  iam.run("UPDATE iam_users SET active=0 WHERE id=?", f.actor.id);
  assert.throws(() => costs.list(f.actor), { code: "FORBIDDEN" });
  iam.run("UPDATE iam_users SET active=1,role='admin' WHERE id=?", f.actor.id);
  iam.run(
    "INSERT INTO iam_organizations SELECT 'foreign-org',name,region,currency,policy FROM iam_organizations WHERE id=?",
    f.actor.orgId,
  );
  iam.run(
    "INSERT INTO iam_users SELECT 'foreign-user','foreign-org','foreign@example.test',name,NULL,role,sites,salt,password_hash,active FROM iam_users WHERE id=?",
    f.actor.id,
  );
  const foreign = { ...f.actor, id: "foreign-user", orgId: "foreign-org" };
  assert.equal(costs.list(foreign).items.length, 0);
  assert.throws(() => costs.detail(foreign, p.id), { code: "NOT_FOUND" });
  f.app.platform.isolateRestore("Synthetic", new Date().toISOString());
  assert.throws(() => costs.accept(f.actor, "accept", evidence), {
    code: "RECOVERY_HOLD",
  });
  assert.throws(() => costs.prepare(f.actor, "prepare-COST-1", input), {
    code: "RECOVERY_HOLD",
  });
  assert.throws(
    () =>
      costs.decide(f.actor, "approve-COST-1", {
        packetId: p.id,
        reviewHash: p.reviewHash,
        decision: "approve",
        reason: "Synthetic finance review",
      }),
    { code: "RECOVERY_HOLD" },
  );
  assert.equal(costs.list(f.actor).recoveryHold, true);
  assert.equal(digest(costs.download(f.actor, p.id).bytes), p.contentHash);
});

test("unknown movements, malformed evidence, missing sequence and unreconciled custody fail closed", (t) => {
  const f = fixture(t),
    store = f.app.database.owned("inventory"),
    source = f.app.integration.costs.source(f.actor),
    id = source.movements[0]!.id;
  for (const sql of [
    "UPDATE inventory_movements SET type='__proto__' WHERE id=?",
    "UPDATE inventory_movements SET quantity=-1 WHERE id=?",
    "UPDATE inventory_movements SET created_at='2026-02-30T00:00:00.000Z' WHERE id=?",
  ]) {
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          store.run(sql, id);
          f.app.inventory.costs.window(f.actor, 0);
        }),
      { code: "COST_EVIDENCE" },
    );
  }
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        store.run(
          "DELETE FROM inventory_cost_sequences WHERE movement_id=?",
          id,
        );
        f.app.inventory.costs.window(f.actor, 0);
      }),
    { code: "COST_EVIDENCE" },
  );
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        store.run(
          "UPDATE inventory_units SET cost=cost+1 WHERE id=?",
          source.movements[0]!.unitId,
        );
        f.app.inventory.costs.window(f.actor, 0);
      }),
    { code: "COST_RECONCILIATION" },
  );
  assert.deepEqual(f.app.integration.costs.source(f.actor), source);
});

test("bounded sequential packets and paged history retain stable source identities across restart", (t) => {
  const f = fixture(t);
  for (let i = 0; i < 499; i++) inspect(f, `inspection-${i}`);
  const costs = f.app.integration.costs,
    source = costs.source(f.actor);
  assert.equal(source.movements.length, 500);
  assert.equal(source.more, true);
  assert.throws(
    () =>
      costs.prepare(f.actor, "oversized", {
        ...initial(f),
        throughSequence: source.throughSequence + 2,
      }),
    { code: "COST_BATCH_SIZE" },
  );
  approve(f, { ...initial(f), expectedMovements: 500 });
  assert.equal(costs.source(f.actor).movements.length, 2);
  const saved = costs.source(f.actor);
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(f.app.integration.costs.source(f.actor), saved);
  for (let i = 0; i < 23; i++)
    f.app.integration.costs.prepare(f.actor, `preview-${i}`, {
      ...initial(f, `PREVIEW-${i}`),
      afterSequence: saved.afterSequence,
      throughSequence: saved.throughSequence,
      mappings: [],
      expectedMovements: 2,
      expectedIncrease: 0,
      expectedOpeningValue: 18000,
    });
  const page = f.app.integration.costs.list(f.actor),
    older = f.app.integration.costs.list(f.actor, { before: page.next! });
  assert.equal(page.items.length, 20);
  assert.equal(older.items.length, 4);
  assert.equal(older.next, null);
  assert.equal(
    new Set([...page.items, ...older.items].map((p) => p.id)).size,
    24,
  );
});

test("HTTP cost commands enforce session, CSRF and strict fields; download hash matches raw attachment bytes", async (t) => {
  const f = fixture(t),
    http = await createHttp(f.app, { origin: "http://localhost" });
  t.after(() => void http.close());
  assert.equal(
    (await http.inject({ url: "/api/accounting/cost-source" })).statusCode,
    401,
  );
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin: "http://localhost" },
    payload: {
      email: "admin@example.test",
      password: "long-test-only-password",
    },
  });
  const cookie = login.headers["set-cookie"]!.toString().split(";")[0]!,
    headers = {
      cookie,
      origin: "http://localhost",
      "x-csrf-token": login.json().csrf,
      "idempotency-key": "prepare",
    },
    input = initial(f);
  const post = (
    name: string,
    payload: Record<string, unknown>,
    extra: Record<string, string> = {},
  ) =>
    http.inject({
      method: "POST",
      url: `/api/commands/accounting.cost.${name}`,
      headers: { ...headers, ...extra },
      payload,
    });
  assert.equal(
    (await post("prepare", input, { "x-csrf-token": "wrong" })).statusCode,
    403,
  );
  assert.equal(
    (await post("prepare", { ...input, artifact: "forged" })).statusCode,
    400,
  );
  const prepared = await post("prepare", input);
  assert.equal(prepared.statusCode, 200);
  const p = prepared.json(),
    approved = await post(
      "decide",
      {
        packetId: p.id,
        reviewHash: p.reviewHash,
        decision: "approve",
        reason: "Review",
      },
      { "idempotency-key": "approve" },
    );
  assert.equal(approved.statusCode, 200);
  const file = await http.inject({
    url: `/api/accounting/costs/${p.id}/file`,
    headers: { cookie },
  });
  assert.equal(file.statusCode, 200);
  assert.equal(file.headers["x-document-sha256"], digest(file.rawPayload));
  assert.equal(file.headers["cache-control"], "no-store");
  assert.equal(
    (
      await post("accept", receipt(approved.json()), {
        "idempotency-key": "accept",
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await http.inject({
        url: "/api/accounting/costs?limit=20&before=9007199254740991",
        headers: { cookie },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await http.inject({
        url: "/api/accounting/costs?limit=101",
        headers: { cookie },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await http.inject({
        url: "/api/accounting/costs?forged=1",
        headers: { cookie },
      })
    ).statusCode,
    400,
  );
});

test("separate processes approve one competing stock window and preserve exactly one permanent claim per movement", async (t) => {
  const f = fixture(t),
    costs = f.app.integration.costs,
    input = initial(f),
    packets = [
      costs.prepare(f.actor, "a", input),
      costs.prepare(f.actor, "b", { ...input, batchRef: "SECOND" }),
    ];
  const children = packets.map(() =>
    fork(new URL("./accounting-cost-child.ts", import.meta.url), [], {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    }),
  );
  t.after(() =>
    children.forEach((c) => {
      if (c.connected) c.kill();
    }),
  );
  const wait = (c: (typeof children)[number]) =>
    new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("Child timeout")), 10000);
      c.once("message", (v) => {
        clearTimeout(timer);
        resolve(v);
      });
      c.once("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      c.once("exit", (code) => {
        if (code) {
          clearTimeout(timer);
          reject(Error(`Child exited ${code}`));
        }
      });
    });
  await Promise.all(
    children.map(async (c, i) => {
      const ready = wait(c);
      c.send({
        action: "init",
        path: f.path,
        actor: f.actor,
        packet: packets[i],
      });
      assert.equal((await ready).ready, true);
    }),
  );
  const outcomes = await Promise.all(
    children.map((c, i) => {
      const done = wait(c);
      c.send({ action: "go", key: `review-${i}` });
      return done;
    }),
  );
  assert.equal(outcomes.filter((r) => r.ok).length, 1);
  assert.equal(outcomes.find((r) => !r.ok).code, "COST_CURSOR");
  assert.equal(
    f.app.database
      .owned("integration")
      .all("SELECT * FROM integration_cost_sources").length,
    3,
  );
  assert.equal(costs.source(f.actor).movements.length, 0);
});

test("cost controls retain exact amounts above the shared money limit and reject unsafe arithmetic", async (t) => {
  const f = fixture(t),
    unit = bulk(f, 100000, 1000000000),
    total = 100000000018000;
  const source = f.app.integration.costs.source(f.actor);
  assert.equal(source.increase, total);
  assert.equal(source.closingValue, total);
  const http = await createHttp(f.app, { origin: "http://localhost" });
  t.after(() => void http.close());
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin: "http://localhost" },
    payload: {
      email: "admin@example.test",
      password: "long-test-only-password",
    },
  });
  const headers = {
    cookie: login.headers["set-cookie"]!.toString().split(";")[0]!,
    origin: "http://localhost",
    "x-csrf-token": login.json().csrf,
    "idempotency-key": "large",
  };
  const input = {
    ...initial(f),
    expectedMovements: 4,
    expectedIncrease: total,
    expectedClosingValue: total,
  };
  const result = await http.inject({
    method: "POST",
    url: "/api/commands/accounting.cost.prepare",
    headers,
    payload: input,
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.json().state, "ready");
  assert.equal(result.json().controls.debit, total);
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: "/api/commands/accounting.cost.prepare",
        headers,
        payload: { ...input, expectedIncrease: Number.MAX_SAFE_INTEGER + 1 },
      })
    ).statusCode,
    400,
  );
  const store = f.app.database.owned("inventory");
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        store.run(
          "UPDATE inventory_units SET cost=? WHERE id=?",
          Number.MAX_SAFE_INTEGER,
          unit.id,
        );
        store.run(
          "UPDATE inventory_movements SET unit_cost=? WHERE unit_id=?",
          Number.MAX_SAFE_INTEGER,
          unit.id,
        );
        f.app.inventory.costs.window(f.actor, 0);
      }),
    { code: "COST_RANGE" },
  );
  assert.equal(f.app.integration.costs.source(f.actor).closingValue, total);
});

test("zero-cost custody needs no inferred account and supplier returns remove original inventory value", (t) => {
  const f = fixture(t),
    costs = f.app.integration.costs;
  approve(f);
  const zero = bulk(f, 6, 0),
    source = costs.source(f.actor);
  const p = approve(f, {
    ...initial(f, "ZERO-COST"),
    afterSequence: source.afterSequence,
    throughSequence: source.throughSequence,
    mappings: [],
    expectedMovements: 1,
    expectedIncrease: 0,
    expectedOpeningValue: 18000,
  });
  assert.equal(p.controls.debit, 0);
  assert.equal(costs.detail(f.actor, p.id).report.journal.length, 0);
  const receiptId = source.movements[0]!.reference;
  f.app.procurement.returnStock(f.actor, "return-zero", {
    receiptId,
    unitId: zero.id,
    revision: zero.revision,
    quantity: 2,
    serial: null,
    returnRef: "ZERO-RETURN",
    reason: "Synthetic supplier return",
    handoverEvidence: "Two zero-cost units handed over",
  });
  const unit = f.app.inventory.stock(f.actor).find((u) => u.serial === "S1")!;
  const receipt = f.app.database
    .owned("inventory")
    .get<{ reference: string }>(
      "SELECT reference FROM inventory_movements WHERE unit_id=? AND type='receipt'",
      unit.id,
    )!;
  f.app.procurement.returnStock(f.actor, "return-paid", {
    receiptId: receipt.reference,
    unitId: unit.id,
    revision: unit.revision,
    quantity: 1,
    serial: "S1",
    returnRef: "PAID-RETURN",
    reason: "Synthetic supplier return",
    handoverEvidence: "Original serial handed over",
  });
  const after = costs.source(f.actor);
  assert.equal(after.decrease, 6000);
  assert.equal(after.closingValue, 12000);
  assert.deepEqual(
    after.movements.map((m) => m.valueDelta),
    [0, -6000],
  );
});

test("historical sequencing migrates once, rolls back native failures, and never repairs missing evidence on restart", (t) => {
  const f = fixture(t),
    source = f.app.integration.costs.source(f.actor),
    store = f.app.database.owned("inventory");
  store.migrate(
    "DROP TABLE inventory_cost_sequences; DROP TABLE inventory_cost_clock;",
  );
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(f.app.integration.costs.source(f.actor), source);
  const audit = t.mock.method(f.app.platform, "audit", () => {
    throw Error("Synthetic audit fault");
  });
  assert.throws(() => inspect(f, "failed-inspection"), /audit fault/);
  audit.mock.restore();
  assert.deepEqual(f.app.integration.costs.source(f.actor), source);
  inspect(f, "inspection");
  assert.equal(
    f.app.integration.costs.source(f.actor).throughSequence,
    source.throughSequence + 1,
  );
  const currentStore = f.app.database.owned("inventory"),
    missing = source.movements[0]!;
  currentStore.run(
    "DELETE FROM inventory_cost_sequences WHERE movement_id=?",
    missing.id,
  );
  f.app.close();
  f.app = new Application(f.path);
  assert.throws(() => f.app.integration.costs.source(f.actor), {
    code: "COST_EVIDENCE",
  });
  assert.equal(
    f.app.database
      .owned("inventory")
      .get(
        "SELECT * FROM inventory_cost_sequences WHERE movement_id=?",
        missing.id,
      ),
    undefined,
  );
});
