import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, accept, ship } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";
import { canonical, digest } from "../src/server/core.ts";
import { Application } from "../src/server/application.ts";

type Fixture = ReturnType<typeof fixture>;
function reviewer(f: Fixture) {
  const user = f.app.identity.createUser(f.actor, "valuation-reviewer", {
    email: "valuation@example.test",
    name: "Synthetic finance reviewer",
    password: "long-test-only-password",
    role: "finance",
    sites: [f.w1, f.w2],
  });
  return f.app.identity.currentActor({ ...f.actor, id: user.id });
}
function policy(f: Fixture, productId: string) {
  return f.app.inventory.valuations.configure(f.actor, "valuation-policy", {
    productId,
    previousRevision: 0,
    policyVersion: "synthetic-1",
    establishedBasis: "Synthetic accountant-approved customer basis",
    establishedMethod: "specific-identification",
    effectiveFrom: "2026-01-01",
    closedThrough: "2026-08-31",
    financeEvidence: "Synthetic established method and opening evidence",
    nonInterchangeableEvidence: "Synthetic non-interchangeable equipment",
  });
}
function prepare(
  f: Fixture,
  unitId: string,
  targetValue: number,
  reference = "VALUE-1",
) {
  const review = f.app.inventory.valuations.review(f.actor, unitId);
  return f.app.inventory.valuations.prepare(f.actor, `prepare-${reference}`, {
    unitId,
    reviewHash: review.reviewHash,
    reference,
    kind: "write-down",
    targetValue,
    postingDate: "2026-10-03",
    reason: "Synthetic valuation decrease",
    evidence: "Synthetic independently established recoverable lot value",
    accountantEvidence:
      "Synthetic accountant classification and period treatment",
  });
}
test("separately approved valuation preserves acquisition cost and retained accounting evidence across restart", (t) => {
  const f = fixture(t),
    second = reviewer(f);
  const u = f.app.inventory.stock(f.actor).find((s) => s.serial === "S1")!;
  policy(f, u.product_id);
  const before = f.app.inventory.costs.window(f.actor, 0);
  const prepared = prepare(f, u.id, 4000);
  assert.equal(prepared.state, "ready");
  assert.equal(f.app.inventory.costs.window(f.actor, 0).closingValue, 18000);
  assert.throws(
    () =>
      f.app.inventory.valuations.decide(f.actor, "own-review", {
        valuationId: prepared.id,
        reviewHash: prepared.reviewHash,
        decision: "approve",
        reason: "Synthetic review",
      }),
    { code: "VALUATION_SEPARATION" },
  );
  const approved = f.app.inventory.valuations.decide(second, "approve", {
    valuationId: prepared.id,
    reviewHash: prepared.reviewHash,
    decision: "approve",
    reason: "Synthetic independent approval",
  });
  assert.equal(approved.state, "reviewed");
  assert.equal(f.app.inventory.unit(f.actor, u.id).cost, 6000);
  assert.equal(f.app.inventory.unit(f.actor, u.id).revision, u.revision + 1);
  const after = f.app.inventory.costs.window(f.actor, before.throughSequence);
  assert.equal(after.openingValue, 18000);
  assert.equal(after.closingValue, 16000);
  assert.equal(after.decrease, 2000);
  assert.equal(after.movements[0]!.quantity, 0);
  assert.equal(after.movements[0]!.unitCost, 6000);
  assert.equal(after.movements[0]!.accountingDate, "2026-10-03");
  const historical = f.app.inventory.costs.window(
    f.actor,
    0,
    before.throughSequence,
  );
  assert.deepEqual({ ...historical, more: false }, before);
  assert.equal(historical.more, true);
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(
    f.app.inventory.valuations.get(second, approved.id),
    approved,
  );
  assert.deepEqual(
    f.app.inventory.valuations.decide(second, "approve", {
      valuationId: prepared.id,
      reviewHash: prepared.reviewHash,
      decision: "approve",
      reason: "Synthetic independent approval",
    }),
    approved,
  );
  assert.equal(f.app.inventory.costs.window(f.actor, 0).closingValue, 16000);
});

function approveValue(
  f: Fixture,
  second: ReturnType<typeof reviewer>,
  unitId: string,
  target: number,
  ref: string,
) {
  const p = prepare(f, unitId, target, ref);
  return f.app.inventory.valuations.decide(second, `approve-${ref}`, {
    valuationId: p.id,
    reviewHash: p.reviewHash,
    decision: "approve",
    reason: "Synthetic independent approval",
  });
}
function bulk(f: Fixture) {
  const productId = f.app.catalog.create(f.actor, "bulk", {
    sku: "VALUE-BULK",
    name: "Synthetic valued bulk",
    serialized: false,
    unitPrice: 2500,
    taxBasisPoints: 1300,
  }).id;
  const po = f.app.procurement.create(f.actor, "bulk-po", {
    supplierId: f.supplier,
    warehouseId: f.w1,
    lines: [{ productId, quantity: 6, unitCost: 1000 }],
  }).id;
  const line = f.app.procurement.orders(f.actor).find((p) => p.id === po)!
    .lines[0]!;
  f.app.procurement.receive(f.actor, "bulk-receive", {
    poId: po,
    lineId: String(line.id),
    quantity: 6,
    serials: [],
    deliveryRef: "VALUE-BULK",
    bin: "B",
    quarantine: false,
  });
  const u = f.app.inventory
    .stock(f.actor)
    .find((u) => u.product_id === productId)!;
  f.app.inventory.valuations.configure(f.actor, "bulk-policy", {
    productId,
    previousRevision: 0,
    policyVersion: "synthetic-fifo",
    establishedBasis: "Synthetic established basis",
    establishedMethod: "fifo-receipt-layers",
    effectiveFrom: "2026-01-01",
    closedThrough: null,
    financeEvidence: "Synthetic accountant-approved receipt-layer method",
  });
  return u;
}
test("fractional lot carrying value follows partial transfer, loss and complete recovery without losing minor units", (t) => {
  const f = fixture(t),
    second = reviewer(f),
    u = bulk(f);
  approveValue(f, second, u.id, 4001, "BULK-WRITEDOWN");
  assert.equal(f.app.inventory.costs.window(f.actor, 0).closingValue, 22001);
  const tr = f.app.inventory.dispatchTransfer(f.actor, "dispatch", {
    unitId: u.id,
    quantity: 4,
    revision: f.app.inventory.unit(f.actor, u.id).revision,
    destinationId: f.w2,
    reason: "Synthetic partial transfer",
  });
  assert.equal(f.app.inventory.costs.window(f.actor, 0).closingValue, 22001);
  const lost = f.app.inventory.approveTransferLoss(f.actor, "loss", {
    transferId: tr.id,
    lineId: tr.lineId,
    revision: f.app.inventory.unit(f.actor, tr.unitId).revision,
    quantity: 3,
    serial: null,
    lossRef: "LOSS-3",
    reason: "Synthetic physical loss",
  });
  assert.equal(f.app.inventory.costs.window(f.actor, 0).closingValue, 20001);
  f.app.inventory.recoverTransferLoss(f.actor, "recover-1", {
    lossId: lost.lossId,
    quantity: 1,
    serial: null,
    receiptRef: "FOUND-1",
    bin: "Q",
    condition: "quarantine",
    reason: "Synthetic recovery",
  });
  assert.equal(f.app.inventory.costs.window(f.actor, 0).closingValue, 20667);
  f.app.inventory.recoverTransferLoss(f.actor, "recover-2", {
    lossId: lost.lossId,
    quantity: 2,
    serial: null,
    receiptRef: "FOUND-2",
    bin: "Q",
    condition: "quarantine",
    reason: "Synthetic remaining recovery",
  });
  const window = f.app.inventory.costs.window(f.actor, 0);
  assert.equal(window.closingValue, 22001);
  assert.deepEqual(
    window.movements
      .filter((m) => m.type === "transfer.recover")
      .map((m) => m.valueDelta),
    [666, 1334],
  );
  assert.equal(
    window.movements.find((m) => m.type === "transfer.loss")!.valueDelta,
    -2000,
  );
  f.app.inventory.receiveTransfer(f.actor, "arrive", {
    transferId: tr.id,
    lineId: tr.lineId,
    quantity: 1,
    serial: null,
    receiptRef: "ARRIVE",
    bin: "D",
    condition: "usable",
    reason: "Synthetic arrival",
  });
  f.app.close();
  f.app = new Application(f.path);
  assert.equal(f.app.inventory.costs.window(f.actor, 0).closingValue, 22001);
  assert.ok(
    f.app.inventory
      .stock(f.actor)
      .filter((s) => s.product_id === u.product_id)
      .every((s) => s.cost === 1000),
  );
});

test("exact policy recovery refuses missing retained policy while conserving later policy revisions", (t) => {
  const f = fixture(t),
    u = f.app.inventory.stock(f.actor)[0]!;
  const first = policy(f, u.product_id),
    { orgId, revision, createdBy, createdAt, policyHash, ...input } = first;
  f.app.inventory.valuations.configure(f.actor, "close-later-period", {
    ...input,
    previousRevision: 1,
    policyVersion: "synthetic-2",
    closedThrough: "2026-09-30",
  });
  assert.deepEqual(
    f.app.inventory.valuations.configure(f.actor, "valuation-policy", input),
    first,
  );
  f.app.database
    .owned("inventory")
    .run(
      "DELETE FROM inventory_valuation_policies WHERE org_id=? AND product_id=? AND revision=1",
      f.actor.orgId,
      u.product_id,
    );
  assert.throws(
    () =>
      f.app.inventory.valuations.configure(f.actor, "valuation-policy", input),
    { code: "VALUATION_INTEGRITY" },
  );
});

test("prepared receipt remains exact after approval and refuses changed historical preparation", (t) => {
  const f = fixture(t),
    second = reviewer(f),
    u = f.app.inventory.stock(f.actor)[0]!;
  policy(f, u.product_id);
  const p = prepare(f, u.id, 4000),
    input = p.input;
  f.app.inventory.valuations.decide(second, "approve", {
    valuationId: p.id,
    reviewHash: p.reviewHash,
    decision: "approve",
    reason: "Synthetic approval",
  });
  assert.equal(
    JSON.stringify(
      f.app.inventory.valuations.prepare(f.actor, "prepare-VALUE-1", input),
    ),
    JSON.stringify(p),
  );
  f.app.database
    .owned("platform")
    .run(
      "UPDATE platform_commands SET result=? WHERE org_id=? AND actor_id=? AND name='inventory.valuation.prepare' AND key='prepare-VALUE-1'",
      JSON.stringify({ ...p, input: { ...input, targetValue: 1 } }),
      f.actor.orgId,
      f.actor.id,
    );
  assert.throws(
    () => f.app.inventory.valuations.prepare(f.actor, "prepare-VALUE-1", input),
    { code: "VALUATION_INTEGRITY" },
  );
  assert.equal(f.app.inventory.costs.window(f.actor, 0).closingValue, 16000);
});

test("valuation approval refuses changed custody or policy and closed dates without booking value", (t) => {
  const f = fixture(t),
    second = reviewer(f),
    u = f.app.inventory.stock(f.actor)[0]!;
  const established = policy(f, u.product_id),
    p = prepare(f, u.id, 4000);
  const { orgId, revision, createdBy, createdAt, policyHash, ...input } =
    established;
  f.app.inventory.valuations.configure(f.actor, "new-period", {
    ...input,
    previousRevision: 1,
    policyVersion: "synthetic-2",
    closedThrough: "2026-10-03",
  });
  assert.throws(
    () =>
      f.app.inventory.valuations.decide(second, "stale", {
        valuationId: p.id,
        reviewHash: p.reviewHash,
        decision: "approve",
        reason: "Synthetic review",
      }),
    { code: "VALUATION_STALE" },
  );
  const review = f.app.inventory.valuations.review(f.actor, u.id);
  assert.throws(
    () =>
      f.app.inventory.valuations.prepare(f.actor, "closed", {
        ...p.input,
        reviewHash: review.reviewHash,
        reference: "CLOSED",
      }),
    { code: "VALUATION_PERIOD" },
  );
  assert.throws(
    () =>
      f.app.inventory.valuations.configure(f.actor, "reopen", {
        ...input,
        previousRevision: 2,
        closedThrough: null,
      }),
    { code: "VALUATION_PERIOD" },
  );
  assert.throws(
    () =>
      f.app.inventory.valuations.configure(f.actor, "change-method", {
        ...input,
        previousRevision: 2,
        establishedMethod: "fifo-receipt-layers",
      }),
    { code: "VALUATION_METHOD_CHANGE" },
  );
  const fresh = f.app.inventory.valuations.prepare(f.actor, "fresh", {
    ...p.input,
    reviewHash: review.reviewHash,
    postingDate: "2026-10-04",
    reference: "FRESH",
  });
  f.app.inventory.relocate(f.actor, "move", {
    unitId: u.id,
    revision: u.revision,
    sourceBin: u.bin,
    bin: "CHANGED",
    serial: u.serial,
    reason: "Synthetic changed physical position",
  });
  assert.throws(
    () =>
      f.app.inventory.valuations.decide(second, "stale-custody", {
        valuationId: fresh.id,
        reviewHash: fresh.reviewHash,
        decision: "approve",
        reason: "Synthetic review",
      }),
    { code: "VALUATION_STALE" },
  );
  const rejected = f.app.inventory.valuations.decide(second, "reject-stale", {
    valuationId: fresh.id,
    reviewHash: fresh.reviewHash,
    decision: "reject",
    reason: "Synthetic stale review rejection",
  });
  assert.equal(rejected.state, "rejected");
  assert.equal(rejected.movementId, null);
  assert.equal(f.app.inventory.costs.window(f.actor, 0).closingValue, 18000);
});

test("current finance authority and restoration hold precede exact cached valuation writes", (t) => {
  const f = fixture(t),
    second = reviewer(f),
    u = f.app.inventory.stock(f.actor)[0]!;
  policy(f, u.product_id);
  const p = prepare(f, u.id, 4000),
    decision = {
      valuationId: p.id,
      reviewHash: p.reviewHash,
      decision: "approve" as const,
      reason: "Synthetic approval",
    };
  f.app.inventory.valuations.decide(second, "approve", decision);
  const iam = f.app.database.owned("iam");
  iam.run("UPDATE iam_users SET role='warehouse' WHERE id=?", second.id);
  assert.throws(
    () => f.app.inventory.valuations.decide(second, "approve", decision),
    { code: "FORBIDDEN" },
  );
  iam.run(
    "UPDATE iam_users SET role='finance',sites='[]' WHERE id=?",
    second.id,
  );
  assert.throws(
    () => f.app.inventory.valuations.decide(second, "approve", decision),
    { code: "FORBIDDEN" },
  );
  iam.run(
    "UPDATE iam_users SET sites=? WHERE id=?",
    JSON.stringify([f.w1, f.w2]),
    second.id,
  );
  iam.run(
    "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
    second.id,
  );
  assert.throws(
    () => f.app.inventory.valuations.decide(second, "approve", decision),
    { code: "PASSWORD_CHANGE_REQUIRED" },
  );
  iam.run(
    "UPDATE iam_user_security SET password_change_required=0 WHERE user_id=?",
    second.id,
  );
  f.app.platform.isolateRestore(
    "Synthetic isolated restore",
    new Date().toISOString(),
  );
  assert.throws(
    () => f.app.inventory.valuations.decide(second, "approve", decision),
    { code: "RECOVERY_HOLD" },
  );
  assert.throws(
    () =>
      f.app.inventory.valuations.prepare(f.actor, "prepare-VALUE-1", p.input),
    { code: "RECOVERY_HOLD" },
  );
  assert.equal(f.app.inventory.valuations.get(second, p.id).state, "reviewed");
});

test("adjusted serial cost survives shipment, return and bounded reversal", (t) => {
  const f = fixture(t),
    second = reviewer(f),
    order = accept(f);
  const picked = f.app.fulfillment.picks(f.actor, order.id)[0]!,
    u = f.app.inventory.unit(f.actor, picked.unit_id as string);
  policy(f, u.product_id);
  approveValue(f, second, u.id, 4000, "SALE-VALUE");
  const shipped = ship(f, order.id);
  assert.equal(f.app.inventory.costs.window(f.actor, 0).closingValue, 12000);
  f.app.database.transaction(() =>
    f.app.inventory.receiveReturn(f.actor, u.id, f.w1, "Q", shipped.id),
  );
  assert.equal(f.app.inventory.costs.window(f.actor, 0).closingValue, 16000);
  const review = f.app.inventory.valuations.review(f.actor, u.id),
    input = {
      unitId: u.id,
      reviewHash: review.reviewHash,
      reference: "REVERSAL",
      kind: "reversal" as const,
      targetValue: 6001,
      postingDate: "2026-10-03",
      reason: "Synthetic recovery in value",
      evidence: "Synthetic revised recoverable value",
      accountantEvidence: "Synthetic accountant classification",
    };
  assert.throws(
    () => f.app.inventory.valuations.prepare(f.actor, "exceeds-cost", input),
    { code: "VALUATION_DIRECTION" },
  );
  const p = f.app.inventory.valuations.prepare(f.actor, "reversal", {
    ...input,
    targetValue: 5000,
  });
  f.app.inventory.valuations.decide(second, "approve-reversal", {
    valuationId: p.id,
    reviewHash: p.reviewHash,
    decision: "approve",
    reason: "Synthetic reversal review",
  });
  assert.equal(f.app.inventory.costs.window(f.actor, 0).closingValue, 17000);
  assert.equal(f.app.inventory.unit(f.actor, u.id).cost, 6000);
  f.app.database.transaction(() =>
    f.app.inventory.returnDisposition(
      f.actor,
      u.id,
      "scrap",
      "SCRAP",
      "Synthetic scrapping",
    ),
  );
  assert.equal(f.app.inventory.costs.window(f.actor, 0).closingValue, 12000);
});

test("partial relocation and arrival conserve value and count disposal releases the retained rounding remainder", (t) => {
  const f = fixture(t),
    second = reviewer(f),
    u = bulk(f);
  approveValue(f, second, u.id, 4001, "SPLIT-VALUE");
  const move = f.app.inventory.relocate(f.actor, "move", {
    unitId: u.id,
    revision: f.app.inventory.unit(f.actor, u.id).revision,
    sourceBin: u.bin,
    bin: "SECOND",
    serial: null,
    quantity: 4,
    reason: "Synthetic bulk relocation",
  });
  assert.equal(f.app.inventory.costs.window(f.actor, 0).closingValue, 22001);
  const moved = f.app.inventory
    .stock(f.actor)
    .find((s) => s.product_id === u.product_id && s.bin === "SECOND")!;
  const transfer = f.app.inventory.dispatchTransfer(f.actor, "dispatch", {
    unitId: moved.id,
    quantity: 4,
    revision: moved.revision,
    destinationId: f.w2,
    reason: "Synthetic full transfer",
  });
  for (const quantity of [1, 3])
    f.app.inventory.receiveTransfer(f.actor, `arrival-${quantity}`, {
      transferId: transfer.id,
      lineId: transfer.lineId,
      quantity,
      serial: null,
      receiptRef: `ARRIVAL-${quantity}`,
      bin: "D",
      condition: "usable",
      reason: "Synthetic partial arrival",
    });
  assert.equal(f.app.inventory.costs.window(f.actor, 0).closingValue, 22001);
  f.app.inventory.adjustCount(f.actor, "count", {
    unitId: u.id,
    revision: f.app.inventory.unit(f.actor, u.id).revision,
    count: 0,
    reason: "Synthetic complete loss at source",
  });
  assert.equal(f.app.inventory.costs.window(f.actor, 0).closingValue, 20667);
  assert.equal(
    f.app.inventory.costs
      .window(f.actor, 0)
      .movements.find((m) => m.type === "count")!.valueDelta,
    -1334,
  );
});

for (const damage of [
  "missing effect",
  "changed effect hash",
  "rehashed arithmetic",
  "missing position",
  "changed position hash",
  "missing policy",
  "missing split",
])
  test(`cost source and valuation review refuse ${damage}`, (t) => {
    const f = fixture(t),
      second = reviewer(f),
      u = bulk(f);
    approveValue(f, second, u.id, 4001, "VALUE");
    f.app.inventory.relocate(f.actor, "move", {
      unitId: u.id,
      revision: f.app.inventory.unit(f.actor, u.id).revision,
      sourceBin: u.bin,
      bin: "SECOND",
      serial: null,
      quantity: 4,
      reason: "Synthetic split",
    });
    const store = f.app.database.owned("inventory");
    if (damage === "missing effect")
      store.run("DELETE FROM inventory_value_effects WHERE unit_id=?", u.id);
    if (damage === "changed effect hash")
      store.run(
        "UPDATE inventory_value_effects SET hash=? WHERE unit_id=?",
        "0".repeat(64),
        u.id,
      );
    if (damage === "rehashed arithmetic") {
      const row = store.get<{ movement_id: string; record: string }>(
        "SELECT * FROM inventory_value_effects WHERE unit_id=? LIMIT 1",
        u.id,
      )!;
      const value = { ...JSON.parse(row.record), valueDelta: -1 };
      store.run(
        "UPDATE inventory_value_effects SET record=?,hash=? WHERE movement_id=?",
        canonical(value),
        digest(canonical(value)),
        row.movement_id,
      );
    }
    if (damage === "missing position")
      store.run(
        "DELETE FROM inventory_valuation_positions WHERE unit_id=?",
        u.id,
      );
    if (damage === "changed position hash")
      store.run(
        "UPDATE inventory_valuation_positions SET hash=? WHERE unit_id=?",
        "0".repeat(64),
        u.id,
      );
    if (damage === "missing policy")
      store.run(
        "DELETE FROM inventory_valuation_policies WHERE product_id=?",
        u.product_id,
      );
    if (damage === "missing split")
      store.run(
        "DELETE FROM inventory_value_splits WHERE org_id=?",
        f.actor.orgId,
      );
    assert.throws(() => f.app.integration.costs.source(f.actor), {
      code: "VALUATION_INTEGRITY",
    });
    assert.throws(() => f.app.inventory.valuations.review(f.actor, u.id), {
      code: "VALUATION_INTEGRITY",
    });
  });

test("late audit failure rolls back valuation, movement and exact command receipt together", (t) => {
  const f = fixture(t),
    second = reviewer(f),
    u = f.app.inventory.stock(f.actor)[0]!;
  policy(f, u.product_id);
  const p = prepare(f, u.id, 4000),
    input = {
      valuationId: p.id,
      reviewHash: p.reviewHash,
      decision: "approve" as const,
      reason: "Synthetic independent approval",
    };
  const platform = f.app.database.owned("platform");
  platform.migrate(
    "CREATE TRIGGER platform_valuation_test_failure BEFORE INSERT ON platform_audit WHEN NEW.action='inventory.valuation.decide' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END;",
  );
  assert.throws(
    () => f.app.inventory.valuations.decide(second, "approve", input),
    /synthetic audit failure/,
  );
  assert.equal(f.app.inventory.valuations.get(second, p.id).state, "ready");
  assert.equal(f.app.inventory.costs.window(f.actor, 0).closingValue, 18000);
  assert.equal(f.app.inventory.unit(f.actor, u.id).revision, u.revision);
  platform.migrate("DROP TRIGGER platform_valuation_test_failure;");
  f.app.inventory.valuations.decide(second, "approve", input);
  assert.equal(f.app.inventory.costs.window(f.actor, 0).closingValue, 16000);
});

test("valuation posting uses the explicit open date and preserves already approved accounting bytes", (t) => {
  const f = fixture(t),
    second = reviewer(f),
    costs = f.app.integration.costs;
  const firstInput = {
    version: 1 as const,
    batchRef: "ORIGINAL",
    afterSequence: 0,
    throughSequence: costs.source(f.actor).throughSequence,
    inventoryAccount: "1200",
    mappings: [{ type: "receipt", offsetAccount: "2100" }],
    expectedMovements: 3,
    expectedIncrease: 18000,
    expectedDecrease: 0,
    expectedOpeningValue: 0,
    expectedClosingValue: 18000,
    acknowledgment: "Synthetic reviewed posting owner and receiver",
  };
  const first = costs.prepare(f.actor, "first", firstInput);
  costs.decide(f.actor, "approve-first", {
    packetId: first.id,
    reviewHash: first.reviewHash,
    decision: "approve",
    reason: "Synthetic review",
  });
  const originalBytes = costs.download(f.actor, first.id).bytes;
  const u = f.app.inventory.stock(f.actor)[0]!;
  policy(f, u.product_id);
  const review = f.app.inventory.valuations.review(f.actor, u.id);
  const prepared = f.app.inventory.valuations.prepare(
    f.actor,
    "backdated-open",
    {
      unitId: u.id,
      reviewHash: review.reviewHash,
      reference: "OPEN-DATE",
      kind: "write-down",
      targetValue: 4000,
      postingDate: "2026-09-01",
      reason: "Synthetic decrease",
      evidence: "Synthetic value evidence",
      accountantEvidence: "Synthetic permitted period",
    },
  );
  f.app.inventory.valuations.decide(second, "approve-valuation", {
    valuationId: prepared.id,
    reviewHash: prepared.reviewHash,
    decision: "approve",
    reason: "Synthetic independent review",
  });
  const source = costs.source(f.actor);
  const p = costs.prepare(f.actor, "next", {
    ...firstInput,
    batchRef: "VALUE",
    afterSequence: firstInput.throughSequence,
    throughSequence: source.throughSequence,
    mappings: [{ type: "valuation.adjustment", offsetAccount: "5100" }],
    expectedMovements: 1,
    expectedIncrease: 0,
    expectedDecrease: 2000,
    expectedOpeningValue: 18000,
    expectedClosingValue: 16000,
  });
  costs.decide(f.actor, "approve-next", {
    packetId: p.id,
    reviewHash: p.reviewHash,
    decision: "approve",
    reason: "Synthetic review",
  });
  const packet = JSON.parse(costs.download(f.actor, p.id).bytes);
  assert.deepEqual(
    packet.report.journal.map(
      (line: {
        date: string;
        account: string;
        debit: number;
        credit: number;
      }) => [line.date, line.account, line.debit, line.credit],
    ),
    [
      ["2026-09-01", "1200", 0, 2000],
      ["2026-09-01", "5100", 2000, 0],
    ],
  );
  assert.equal(costs.download(f.actor, first.id).bytes, originalBytes);
});

test("valuation HTTP controls require current sessions, strict fields, CSRF and a separate reviewer", async (t) => {
  const f = fixture(t),
    second = reviewer(f),
    u = f.app.inventory.stock(f.actor)[0]!;
  const http = await createHttp(f.app, { origin: "http://localhost" });
  t.after(() => void http.close());
  const url = `/api/stock/${u.id}/valuation-review`;
  assert.equal((await http.inject({ url })).statusCode, 401);
  const login = async (email: string) => {
    const r = await http.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin: "http://localhost" },
      payload: { email, password: "long-test-only-password" },
    });
    assert.equal(r.statusCode, 200);
    return {
      cookie: r.headers["set-cookie"]!.toString().split(";")[0]!,
      origin: "http://localhost",
      "x-csrf-token": r.json().csrf,
      "idempotency-key": "valuation",
    };
  };
  const headers = await login("admin@example.test"),
    finance = await login("valuation@example.test");
  const post = (name: string, payload: unknown, h = headers) =>
    http.inject({
      method: "POST",
      url: `/api/commands/inventory.valuation.${name}`,
      headers: { ...h, "content-type": "application/json" },
      payload: JSON.stringify(payload),
    });
  const policyInput = {
    productId: u.product_id,
    previousRevision: 0,
    policyVersion: "HTTP-1",
    establishedBasis: "Synthetic accountant basis",
    establishedMethod: "specific-identification",
    effectiveFrom: "2026-01-01",
    closedThrough: null,
    financeEvidence: "Synthetic established method",
    nonInterchangeableEvidence: "Synthetic non-interchangeable equipment",
  };
  assert.equal(
    (await post("policy", policyInput, { ...headers, "x-csrf-token": "wrong" }))
      .statusCode,
    403,
  );
  assert.equal(
    (await post("policy", { ...policyInput, hiddenOverride: true })).statusCode,
    400,
  );
  assert.equal((await post("policy", policyInput)).statusCode, 200);
  const response = await http.inject({ url, headers });
  assert.equal(response.statusCode, 200);
  const review = response.json(),
    input = {
      unitId: u.id,
      reviewHash: review.reviewHash,
      reference: "HTTP-VALUE",
      kind: "write-down",
      targetValue: 4000,
      postingDate: "2026-10-03",
      reason: "Synthetic decrease",
      evidence: "Synthetic assessed value",
      accountantEvidence: "Synthetic period classification",
    };
  assert.equal(
    (await post("prepare", { ...input, targetValue: "4000" })).statusCode,
    400,
  );
  const prep = await post("prepare", input);
  assert.equal(prep.statusCode, 200);
  const p = prep.json(),
    decision = {
      valuationId: p.id,
      reviewHash: p.reviewHash,
      decision: "approve",
      reason: "Synthetic review",
    };
  const own = await post("decide", decision);
  assert.equal(own.statusCode, 409);
  assert.equal(own.json().code, "VALUATION_SEPARATION");
  assert.equal((await post("decide", decision, finance)).statusCode, 200);
  const history = await http.inject({
    url: `/api/stock/${u.id}/valuations`,
    headers: finance,
  });
  assert.equal(history.statusCode, 200);
  assert.equal(history.json().rows[0].state, "reviewed");
  assert.equal(
    (
      await http.inject({
        url: `/api/stock/valuations/${p.id}`,
        headers: finance,
      })
    ).json().id,
    p.id,
  );
  assert.equal(
    (
      await http.inject({
        url: `/api/stock/${u.id}/valuations?unsupported=1`,
        headers: finance,
      })
    ).statusCode,
    400,
  );
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='warehouse' WHERE id=?", second.id);
  assert.equal((await post("decide", decision, finance)).statusCode, 403);
});

test("valuation policy review is scoped to current stock custody and current finance authority", async (t) => {
  const f = fixture(t),
    u = f.app.inventory.stock(f.actor)[0]!;
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
  };
  const url = `/api/stock/${u.id}/valuation-policy`;
  const empty = await http.inject({ url, headers });
  assert.equal(empty.statusCode, 200);
  assert.equal(empty.json().policy, null);
  const configured = policy(f, u.product_id);
  const current = await http.inject({ url, headers });
  assert.equal(current.statusCode, 200);
  assert.deepEqual(current.json().policy, configured);
  assert.equal(
    (await http.inject({ url: "/api/stock/missing/valuation-policy", headers }))
      .statusCode,
    404,
  );
  assert.equal(
    (await http.inject({ url: "/api/stock/valuations/missing", headers }))
      .statusCode,
    404,
  );
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_users SET sites='[]',role='finance' WHERE id=?",
      f.actor.id,
    );
  assert.equal((await http.inject({ url, headers })).statusCode, 403);
});
