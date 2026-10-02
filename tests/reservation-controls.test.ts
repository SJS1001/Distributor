import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Application } from "../src/server/application.ts";
import type { Actor } from "../src/server/core.ts";
import { fixture, accept, ship } from "./fixtures.ts";

test("reservation controls: an unshipped order with a missing reservation cannot appear healthy", (t) => {
  const f = fixture(t),
    order = accept(f);
  f.app.database
    .owned("inventory")
    .run("DELETE FROM inventory_allocations WHERE order_id=?", order.id);
  const r = f.app.reconciliation(f.actor);
  assert.equal(r.stock.issues.count, 0);
  assert.equal(r.billing.issues.count, 0);
  assert(r.sales.issues.items.some((i) => i.code === "SALE_ORDER_RESERVED"));
});

type Fixture = ReturnType<typeof fixture>;
function codes(f: Fixture) {
  return f.app.reconciliation(f.actor).sales.issues.items.map((i) => i.code);
}
function unchanged(f: Fixture, fn: () => void) {
  const db = new DatabaseSync(f.path);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as { name: string }[];
  const read = () =>
    tables.map(({ name }) => db.prepare(`SELECT * FROM "${name}"`).all());
  try {
    const before = read();
    fn();
    assert.deepEqual(read(), before);
  } finally {
    db.close();
  }
}
function pack(f: Fixture, orderId: string, key = "pack", quantity?: number) {
  const a = f.app.fulfillment.picks(f.actor, orderId)[0]!;
  if (a.stage === "reserved")
    f.app.fulfillment.pick(f.actor, key + "pick", {
      orderId,
      allocationId: a.id,
      serial: a.serial,
    });
  return f.app.fulfillment.pack(f.actor, key, {
    orderId,
    revision: f.app.orders.order(f.actor, orderId).revision,
    mode: "collection",
    address: "PRIVATE-ADDRESS",
    lines: [
      {
        allocationId: a.id,
        quantity: quantity ?? a.quantity - a.consumed - a.released,
      },
    ],
  });
}
function bulk(f: Fixture) {
  f.product = f.app.catalog.create(f.actor, "bulk", {
    sku: "BULK",
    name: "PRIVATE-NAME",
    serialized: false,
    unitPrice: 125,
    taxBasisPoints: 0,
  }).id;
  const po = f.app.procurement.create(f.actor, "bulk-po", {
    supplierId: f.supplier,
    warehouseId: f.w1,
    lines: [{ productId: f.product, quantity: 5, unitCost: 17 }],
  }).id;
  const line = f.app.procurement.orders(f.actor).find((p) => p.id === po)!
    .lines[0]!;
  f.app.procurement.receive(f.actor, "bulk-receive", {
    poId: po,
    lineId: String(line.id),
    quantity: 5,
    serials: [],
    deliveryRef: "PRIVATE-DELIVERY",
    bin: "B-1",
    quarantine: false,
  });
}
for (const region of ["CA", "US"] as const)
  test(`reservation controls: ${region} partial packs, handover, void, cancellation and restart remain healthy`, (t) => {
    const f = fixture(t, {}, region);
    bulk(f);
    const order = accept(f, 5),
      first = pack(f, order.id, "first", 2),
      second = pack(f, order.id, "second", 2);
    unchanged(f, () => assert.deepEqual(codes(f), []));
    f.app.fulfillment.commit(f.actor, "commit-first", {
      shipmentId: first.id,
      handoverEvidence: "PRIVATE-EVIDENCE",
    });
    assert.deepEqual(codes(f), []);
    f.app.fulfillment.void(f.actor, "void-second", {
      shipmentId: second.id,
      reason: "PRIVATE-REASON",
    });
    f.app.fulfillment.pick(f.actor, "unpick", {
      orderId: order.id,
      allocationId: f.app.fulfillment.picks(f.actor, order.id)[0]!.id,
      serial: null,
      unpick: true,
    });
    f.app.orders.cancel(f.actor, "cancel", {
      orderId: order.id,
      lineId: f.app.orders.lines(f.actor, order.id)[0]!.id,
      revision: f.app.orders.order(f.actor, order.id).revision,
      quantity: 3,
      reason: "PRIVATE-CANCEL",
    });
    unchanged(f, () => assert.deepEqual(codes(f), []));
    f.app.close();
    f.app = new Application(f.path, region);
    unchanged(f, () => assert.deepEqual(codes(f), []));
  });

test("reservation controls: short picks and expired unpicked promises leave picked/packed stock valid", (t) => {
  let clock = 1900000000000;
  t.mock.method(Date, "now", () => clock);
  const f = fixture(t),
    order = accept(f, 3);
  const packed = pack(f, order.id),
    a = f.app.fulfillment
      .picks(f.actor, order.id)
      .find((a) => a.stage === "reserved")!;
  f.app.fulfillment.shortPick(f.actor, "short", {
    orderId: order.id,
    revision: f.app.orders.order(f.actor, order.id).revision,
    allocationId: a.id,
    unitRevision: a.unitRevision,
    quantity: 1,
    reason: "PRIVATE-SHORT",
  });
  assert.deepEqual(codes(f), []);
  f.app.orders.reservationDeadline(f.actor, "deadline", {
    orderId: order.id,
    revision: f.app.orders.order(f.actor, order.id).revision,
    expiresAt: clock + 1000,
    reason: "PRIVATE-DEADLINE",
  });
  clock += 1001;
  f.app.orders.expireReservations(f.actor, "expire", {
    orderId: order.id,
    revision: f.app.orders.order(f.actor, order.id).revision,
    reason: "PRIVATE-EXPIRE",
  });
  assert.deepEqual(codes(f), []);
  f.app.fulfillment.commit(f.actor, "commit", {
    shipmentId: packed.id,
    handoverEvidence: "PRIVATE-EVIDENCE",
  });
  assert.deepEqual(codes(f), []);
});

const faults = [
  ["orders", "UPDATE orders_lines SET allocated=0", "SALE_ORDER_RESERVED"],
  [
    "inventory",
    "UPDATE inventory_allocations SET released=1",
    "SALE_ORDER_RESERVED",
  ],
  [
    "inventory",
    "UPDATE inventory_allocations SET order_id='missing'",
    "SALE_RESERVATION_ORDER",
  ],
  [
    "inventory",
    "UPDATE inventory_allocations SET product_id='missing'",
    "SALE_RESERVATION_LINE",
  ],
  [
    "inventory",
    "UPDATE inventory_allocations SET product_id='missing'",
    "SALE_RESERVATION_PRODUCT",
  ],
  [
    "inventory",
    "UPDATE inventory_allocations SET warehouse_id='missing'",
    "SALE_RESERVATION_WAREHOUSE",
  ],
  [
    "inventory",
    "UPDATE inventory_allocations SET unit_id='missing'",
    "SALE_RESERVATION_UNIT",
  ],
  [
    "inventory",
    "UPDATE inventory_units SET warehouse_id='missing'",
    "SALE_RESERVATION_UNIT_WAREHOUSE",
  ],
  [
    "inventory",
    "UPDATE inventory_units SET condition='quarantine'",
    "SALE_RESERVATION_UNAVAILABLE",
  ],
  [
    "inventory",
    "UPDATE inventory_units SET state='transit'",
    "SALE_RESERVATION_UNAVAILABLE",
  ],
  [
    "inventory",
    "UPDATE inventory_units SET quantity=0",
    "SALE_UNIT_OVERRESERVED",
  ],
] as const;
for (const [owner, sql, code] of faults)
  test(`reservation controls: ${code} detects independent outstanding promise drift`, (t) => {
    const f = fixture(t);
    accept(f);
    f.app.database.owned(owner).run(sql);
    unchanged(f, () => assert(codes(f).includes(code)));
  });

for (const [sql, code] of [
  ["UPDATE inventory_allocations SET quantity=0", "SALE_RESERVATION_RANGE"],
  ["UPDATE inventory_allocations SET consumed=-1", "SALE_RESERVATION_RANGE"],
  ["UPDATE inventory_allocations SET released=-1", "SALE_RESERVATION_RANGE"],
  ["UPDATE inventory_allocations SET consumed=2", "SALE_RESERVATION_RANGE"],
  [
    "UPDATE inventory_allocations SET stage='unknown'",
    "SALE_RESERVATION_STAGE",
  ],
  ["UPDATE orders_lines SET allocated=2", "SALE_ORDER_QUANTITY_RANGE"],
] as const)
  test(`reservation controls: ${code} reports corrupt retained bounds (${sql})`, (t) => {
    const f = fixture(t);
    accept(f);
    const db = new DatabaseSync(f.path);
    try {
      db.exec("PRAGMA ignore_check_constraints=ON");
      db.exec(sql);
    } finally {
      db.close();
    }
    unchanged(f, () => assert(codes(f).includes(code)));
  });

test("reservation controls: equal order totals cannot hide opposite product reservation drift", (t) => {
  const f = fixture(t),
    first = accept(f);
  bulk(f);
  const second = accept(f, 2, "second");
  const inv = f.app.database.owned("inventory"),
    a = f.app.inventory.allocations(f.actor, first.id)[0]!,
    b = f.app.inventory.allocations(f.actor, second.id)[0]!;
  inv.run(
    "UPDATE inventory_allocations SET quantity=quantity+1 WHERE id=?",
    a.id,
  );
  inv.run(
    "UPDATE inventory_allocations SET quantity=quantity-1 WHERE id=?",
    b.id,
  );
  const r = f.app.reconciliation(f.actor).sales;
  assert.equal(
    r.issues.items.filter((i) => i.code === "SALE_ORDER_RESERVED").length,
    2,
  );
  assert(r.issues.items.some((i) => i.code === "SALE_UNIT_OVERRESERVED"));
});

const packFaults = [
  [
    "inventory",
    "UPDATE inventory_allocations SET stage='reserved'",
    "SALE_PACK_NOT_PICKED",
  ],
  [
    "inventory",
    "UPDATE inventory_allocations SET released=1",
    "SALE_PACK_OVERCOMMITTED",
  ],
  ["inventory", "DELETE FROM inventory_allocations", "SALE_PACK_ALLOCATION"],
  [
    "fulfillment",
    "UPDATE fulfillment_shipments SET order_id='missing'",
    "SALE_PACK_ALLOCATION_SCOPE",
  ],
  [
    "fulfillment",
    "UPDATE fulfillment_shipments SET warehouse_id='missing'",
    "SALE_PACK_ALLOCATION_SCOPE",
  ],
] as const;
for (const [owner, sql, code] of packFaults)
  test(`reservation controls: ${code} flags invalid active packing before handover`, (t) => {
    const f = fixture(t),
      o = accept(f);
    pack(f, o.id);
    f.app.database.owned(owner).run(sql);
    unchanged(f, () => assert(codes(f).includes(code)));
  });

test("reservation controls: separate active packs cannot each promise the same remaining bulk stock", (t) => {
  const f = fixture(t);
  bulk(f);
  const o = accept(f, 3);
  pack(f, o.id, "first", 2);
  pack(f, o.id, "second", 1);
  const store = f.app.database.owned("fulfillment"),
    s = f.app.fulfillment.shipments(f.actor).find((s) => s.state === "packed")!,
    lines = s.lines;
  lines[0].quantity = 3;
  store.run(
    "UPDATE fulfillment_shipments SET lines=? WHERE id=?",
    JSON.stringify(lines),
    s.id,
  );
  assert(codes(f).includes("SALE_PACK_OVERCOMMITTED"));
});

test("reservation controls: duplicate active packing lines and malformed private JSON are diagnosed without echo", (t) => {
  const f = fixture(t),
    o = accept(f),
    s = pack(f, o.id),
    store = f.app.database.owned("fulfillment"),
    lines = JSON.parse(f.app.fulfillment.shipment(f.actor, s.id).lines);
  store.run(
    "UPDATE fulfillment_shipments SET lines=? WHERE id=?",
    JSON.stringify([...lines, ...lines]),
    s.id,
  );
  assert(codes(f).includes("SALE_PACK_DUPLICATE_ALLOCATION"));
  assert(codes(f).includes("SALE_PACK_OVERCOMMITTED"));
  store.run(
    "UPDATE fulfillment_shipments SET lines=? WHERE id=?",
    "PRIVATE-RAW {bad",
    s.id,
  );
  const result = f.app.reconciliation(f.actor);
  assert(codes(f).includes("SALE_PACKED_EVIDENCE"));
  assert(!JSON.stringify(result).includes("PRIVATE-"));
});

test("reservation controls: released historical reservation remains valid after stock transfers to another site", (t) => {
  const f = fixture(t),
    o = accept(f);
  f.app.orders.cancel(f.actor, "cancel", {
    orderId: o.id,
    lineId: f.app.orders.lines(f.actor, o.id)[0]!.id,
    revision: 1,
    quantity: 1,
    reason: "PRIVATE-CANCEL",
  });
  const u = f.app.inventory.trace(f.actor, "S1").unit;
  f.app.inventory.dispatchTransfer(f.actor, "transfer", {
    unitId: u.id,
    quantity: 1,
    revision: u.revision,
    destinationId: f.w2,
    reason: "PRIVATE-TRANSFER",
  });
  assert.deepEqual(codes(f), []);
});

function replacement(f: Fixture) {
  ship(f, accept(f).id);
  const claim = f.app.warranty.submit(f.actor, "claim", {
    accountId: f.buyer,
    unitId: f.app.inventory.trace(f.actor, "S1").unit.id,
    type: "warranty",
    issue: "PRIVATE-ISSUE",
    evidence: "PRIVATE-EVIDENCE",
  });
  f.app.warranty.review(f.actor, "review", {
    claimId: claim.id,
    approved: true,
    reason: "PRIVATE-REVIEW",
  });
  f.app.warranty.receive(f.actor, "return", {
    claimId: claim.id,
    warehouseId: f.w2,
    bin: "Q",
    serial: "S1",
  });
  f.app.warranty.inspect(f.actor, "inspect", {
    claimId: claim.id,
    findings: "PRIVATE-FINDINGS",
  });
  return f.app.warranty.reserveReplacement(f.actor, "replace", {
    claimId: claim.id,
    newUnitId: f.app.inventory.trace(f.actor, "S2").unit.id,
    oldDisposition: "scrap",
    coveragePolicy: "inherit_original",
    reason: "PRIVATE-REPLACE",
  });
}
test("reservation controls: replacement and ordinary promises share the same stock capacity", (t) => {
  const f = fixture(t);
  replacement(f);
  assert.deepEqual(codes(f), []);
  const o = accept(f, 1, "other"),
    a = f.app.inventory.allocations(f.actor, o.id)[0]!;
  f.app.database
    .owned("inventory")
    .run(
      "UPDATE inventory_allocations SET unit_id=? WHERE id=?",
      f.app.inventory.trace(f.actor, "S2").unit.id,
      a.id,
    );
  assert(codes(f).includes("SALE_UNIT_OVERRESERVED"));
});
for (const [sql, code] of [
  [
    "UPDATE inventory_replacements SET unit_id='missing'",
    "SALE_REPLACEMENT_UNIT",
  ],
  [
    "UPDATE inventory_units SET condition='damaged' WHERE serial='S2'",
    "SALE_REPLACEMENT_UNAVAILABLE",
  ],
  [
    "UPDATE inventory_units SET serial=NULL WHERE serial='S2'",
    "SALE_REPLACEMENT_UNAVAILABLE",
  ],
] as const)
  test(`reservation controls: ${code} flags unavailable replacement custody`, (t) => {
    const f = fixture(t);
    replacement(f);
    f.app.database.owned("inventory").run(sql);
    unchanged(f, () => assert(codes(f).includes(code)));
  });

test("reservation controls: bounded details preserve exact 64-bit promise comparisons without leaking serials", (t) => {
  const f = fixture(t);
  accept(f);
  const inv = f.app.database.owned("inventory");
  for (let i = 0; i < 125; i++)
    inv.run(
      "INSERT INTO inventory_allocations SELECT ?,org_id,order_id,product_id,warehouse_id,unit_id,quantity,consumed,released,stage FROM inventory_allocations LIMIT 1",
      `extra-${i}`,
    );
  inv.run(
    "UPDATE inventory_allocations SET quantity=9007199254740993 WHERE id='extra-124'",
  );
  const r = f.app.reconciliation(f.actor).sales;
  assert(r.issues.items.some((i) => i.code === "UNSAFE_RESERVATION_INTEGER"));
  assert(
    r.issues.items.some(
      (i) =>
        i.code === "SALE_ORDER_RESERVED" && i.expected === "9007199254741118",
    ),
  );
  assert(!JSON.stringify(r).includes("S1"));
  // Each orphan adds independent order and line diagnostics; all are counted.
  inv.run("UPDATE inventory_allocations SET order_id='missing'");
  const bounded = f.app.reconciliation(f.actor).sales.issues;
  assert(bounded.count > 100);
  assert.equal(bounded.items.length, 100);
  assert(bounded.truncated);
});

test("reservation controls: all added owning projections exclude foreign organization facts", (t) => {
  const f = fixture(t);
  accept(f);
  const before = f.app.reconciliation(f.actor),
    inv = f.app.database.owned("inventory");
  inv.run(
    "INSERT INTO inventory_units SELECT id||'-foreign','foreign',product_id,'missing',bin,serial,0,cost,'damaged','sold',revision FROM inventory_units",
  );
  inv.run(
    "INSERT INTO inventory_allocations SELECT id||'-foreign','foreign',order_id,product_id,'missing',unit_id,10,0,0,stage FROM inventory_allocations",
  );
  inv.run(
    "INSERT INTO inventory_replacements VALUES('foreign-hold','foreign','missing','reserved')",
  );
  const after = f.app.reconciliation(f.actor);
  assert.deepEqual(after.sales, before.sales);
  assert.equal(after.snapshotHash, before.snapshotHash);
});

test("reservation controls: new projection scan is fenced and preserves original reviewed bytes after restart", (t) => {
  const f = fixture(t),
    o = accept(f),
    good = f.app.reconciliation(f.actor),
    saved = f.app.prepareReconciliation(f.actor, "saved", {
      expectedHash: good.snapshotHash,
    });
  const competing = new DatabaseSync(f.path, { timeout: 1 }),
    original = f.app.inventory.salesEvidence.bind(f.app.inventory);
  const scan = t.mock.method(
    f.app.inventory,
    "salesEvidence",
    (actor: Actor) => {
      assert.throws(
        () =>
          competing
            .prepare("UPDATE inventory_allocations SET released=1")
            .run(),
        /locked/,
      );
      return original(actor);
    },
  );
  assert.equal(f.app.reconciliation(f.actor).snapshotHash, good.snapshotHash);
  scan.mock.restore();
  const originalBytes = f.app.platform.reconciliationDocument(
    f.actor,
    saved.id,
  ).content;
  competing
    .prepare("UPDATE inventory_allocations SET released=1 WHERE order_id=?")
    .run(o.id);
  competing.close();
  assert.throws(
    () =>
      f.app.prepareReconciliation(f.actor, "stale", {
        expectedHash: good.snapshotHash,
      }),
    { code: "STALE_RECONCILIATION" },
  );
  const bad = f.app.reconciliation(f.actor);
  assert.notEqual(bad.snapshotHash, good.snapshotHash);
  assert(bad.sales.issues.count > 0);
  f.app.close();
  f.app = new Application(f.path, "CA");
  assert.equal(
    f.app.platform.reconciliationDocument(f.actor, saved.id).content,
    originalBytes,
  );
  assert.deepEqual(f.app.reconciliation(f.actor).sales, bad.sales);
});
