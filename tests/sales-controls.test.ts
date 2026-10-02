import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { fixture, accept, ship } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import type { Actor } from "../src/server/core.ts";
type Fixture = ReturnType<typeof fixture>;
function part(f: Fixture, orderId: string, quantity: number, key: string) {
  const picks = f.app.fulfillment.picks(f.actor, orderId),
    selected: { allocationId: string; quantity: number }[] = [];
  let remaining = quantity;
  for (const a of picks) {
    const qty = Math.min(remaining, a.quantity - a.consumed - a.released);
    if (!qty) continue;
    if (a.stage === "reserved")
      f.app.fulfillment.pick(f.actor, key + a.id, {
        orderId,
        allocationId: a.id,
        serial: a.serial,
      });
    selected.push({ allocationId: a.id, quantity: qty });
    remaining -= qty;
    if (!remaining) break;
  }
  assert.equal(remaining, 0);
  const p = f.app.fulfillment.pack(f.actor, key + "pack", {
    orderId,
    revision: f.app.orders.order(f.actor, orderId).revision,
    mode: "collection",
    address: "PRIVATE-ADDRESS",
    lines: selected,
  });
  return f.app.fulfillment.commit(f.actor, key + "ship", {
    shipmentId: p.id,
    handoverEvidence: "PRIVATE-EVIDENCE",
  });
}
for (const region of ["CA", "US"] as const)
  test(`sales agreement: ${region} partial serialized supply and restart preserve native agreement`, (t) => {
    const f = fixture(t, {}, region),
      order = accept(f, 3);
    part(f, order.id, 1, "first");
    const first = f.app.reconciliation(f.actor).sales;
    assert.equal(first.issues.count, 0);
    assert.equal(first.shippedQuantity, "1");
    assert.equal(first.invoicedQuantity, "1");
    part(f, order.id, 2, "second");
    const result = f.app.reconciliation(f.actor).sales;
    assert.deepEqual(result, {
      orders: 1,
      shipments: 2,
      invoices: 2,
      openingInvoices: 0,
      allocations: 3,
      movements: 3,
      shippedQuantity: "3",
      shippedCost: "18000",
      movementQuantity: "3",
      movementCost: "18000",
      invoicedQuantity: "3",
      invoiceNet: "30000",
      invoiceTax: "3900",
      issues: { count: 0, items: [], truncated: false },
    });
    assert(!JSON.stringify(result).includes("PRIVATE-"));
    f.app.close();
    f.app = new Application(f.path, region);
    assert.deepEqual(f.app.reconciliation(f.actor).sales, result);
  });

test("sales agreement: repeated bulk allocation across partial shipments has exact consumption and original cost", (t) => {
  const f = fixture(t);
  f.product = f.app.catalog.create(f.actor, "bulk", {
    sku: "BULK",
    name: "Synthetic bulk",
    serialized: false,
    unitPrice: 125,
    taxBasisPoints: 0,
  }).id;
  const po = f.app.procurement.create(f.actor, "bulk-po", {
    supplierId: f.supplier,
    warehouseId: f.w1,
    lines: [{ productId: f.product, quantity: 5, unitCost: 17 }],
  });
  const line = f.app.procurement.orders(f.actor).find((o) => o.id === po.id)!
    .lines[0]!;
  f.app.procurement.receive(f.actor, "bulk-receive", {
    poId: po.id,
    lineId: String(line.id),
    quantity: 5,
    serials: [],
    deliveryRef: "BULK",
    bin: "B-1",
    quarantine: false,
  });
  const order = accept(f, 5);
  part(f, order.id, 2, "first");
  part(f, order.id, 3, "second");
  const result = f.app.reconciliation(f.actor).sales;
  assert.equal(result.issues.count, 0);
  assert.equal(result.allocations, 1);
  assert.equal(result.shippedQuantity, "5");
  assert.equal(result.shippedCost, "85");
  assert.equal(result.movementCost, "85");
  assert.equal(result.invoiceNet, "625");
});

test("sales agreement: internally balanced invoice with excess goods is detected only by sales controls", (t) => {
  const f = fixture(t),
    sale = ship(f, accept(f).id),
    store = f.app.database.owned("billing");
  store.run(
    "UPDATE billing_lines SET quantity=2 WHERE invoice_id=?",
    sale.invoiceId,
  );
  store.run(
    "UPDATE billing_invoices SET net=20000,tax=2600,total=22600 WHERE id=?",
    sale.invoiceId,
  );
  const r = f.app.reconciliation(f.actor);
  assert.equal(r.stock.issues.count, 0);
  assert.equal(r.billing.issues.count, 0);
  assert.deepEqual(r.sales.issues.items, [
    {
      code: "SALE_INVOICE_QUANTITY",
      recordId: sale.invoiceId,
      expected: "1",
      actual: "2",
    },
  ]);
});
test("sales agreement: internally balanced price and tax changes retain total but disagree with accepted order", (t) => {
  const f = fixture(t),
    sale = ship(f, accept(f).id),
    store = f.app.database.owned("billing");
  store.run(
    "UPDATE billing_lines SET unit_price=9000,unit_tax=2300 WHERE invoice_id=?",
    sale.invoiceId,
  );
  store.run(
    "UPDATE billing_invoices SET net=9000,tax=2300 WHERE id=?",
    sale.invoiceId,
  );
  const r = f.app.reconciliation(f.actor);
  assert.equal(r.billing.issues.count, 0);
  assert.equal(r.sales.invoiceNet, "9000");
  assert.equal(r.sales.invoiceTax, "2300");
  assert.deepEqual(
    r.sales.issues.items.map((i) => i.code),
    ["SALE_INVOICE_PRICE", "SALE_INVOICE_TAX"],
  );
});
const faults = [
  ["orders", "UPDATE orders_lines SET shipped=0", "SALE_ORDER_SHIPPED"],
  [
    "inventory",
    "UPDATE inventory_allocations SET consumed=0",
    "SALE_ALLOCATION_CONSUMED",
  ],
  [
    "inventory",
    "UPDATE inventory_movements SET reference='missing' WHERE type='shipment'",
    "SALE_ORPHAN_MOVEMENT",
  ],
  [
    "inventory",
    "UPDATE inventory_movements SET warehouse_id='missing' WHERE type='shipment'",
    "SALE_STOCK_DEDUCTION",
  ],
  [
    "inventory",
    "UPDATE inventory_allocations SET unit_id='missing'",
    "SALE_ALLOCATION_UNIT",
  ],
  [
    "inventory",
    "UPDATE inventory_allocations SET product_id='missing'",
    "SALE_ALLOCATION_PRODUCT",
  ],
  [
    "fulfillment",
    "UPDATE fulfillment_shipments SET account_id='missing'",
    "SALE_SHIPMENT_ACCOUNT",
  ],
  [
    "fulfillment",
    "UPDATE fulfillment_shipments SET order_id='missing'",
    "SALE_SHIPMENT_ORDER",
  ],
  [
    "fulfillment",
    "UPDATE fulfillment_shipments SET invoice_id=NULL",
    "SALE_SHIPMENT_INVOICE",
  ],
  [
    "billing",
    "UPDATE billing_invoices SET shipment_id='opening:fake'",
    "SALE_INVOICE_SHIPMENT",
  ],
  [
    "billing",
    "UPDATE billing_invoices SET account_id='missing'",
    "SALE_INVOICE_ACCOUNT",
  ],
  [
    "billing",
    "UPDATE billing_lines SET product_id='missing'",
    "SALE_INVOICE_PRODUCT",
  ],
] as const;
for (const [owner, sql, code] of faults)
  test(`sales agreement: ${code} observes independent retained ${owner} corruption`, (t) => {
    const f = fixture(t);
    ship(f, accept(f).id);
    f.app.database.owned(owner).run(sql);
    const result = f.app.reconciliation(f.actor).sales;
    assert(
      result.issues.items.some((i) => i.code === code),
      JSON.stringify(result.issues),
    );
  });

test("sales agreement: equal total shipment cost drift cannot hide differing unit deduction evidence", (t) => {
  const f = fixture(t),
    order = accept(f, 2);
  const a = part(f, order.id, 1, "a"),
    b = part(f, order.id, 1, "b"),
    store = f.app.database.owned("fulfillment");
  for (const [s, cost] of [
    [a, 7000],
    [b, 5000],
  ] as const) {
    const units = JSON.parse(f.app.fulfillment.shipment(f.actor, s.id).units);
    units[0].unitCost = cost;
    store.run(
      "UPDATE fulfillment_shipments SET units=? WHERE id=?",
      JSON.stringify(units),
      s.id,
    );
  }
  const r = f.app.reconciliation(f.actor);
  assert.equal(r.stock.issues.count, 0);
  assert.equal(r.billing.issues.count, 0);
  assert.equal(r.sales.shippedCost, r.sales.movementCost);
  assert.equal(r.sales.issues.count, 4);
  assert(r.sales.issues.items.every((i) => i.code === "SALE_STOCK_DEDUCTION"));
});
for (const [column, raw, code] of [
  ["units", "PRIVATE-SERIAL {bad", "SALE_UNIT_EVIDENCE"],
  ["lines", '{"PRIVATE-ADDRESS":"unexpected"}', "SALE_PACKED_EVIDENCE"],
  [
    "units",
    '[{"unitId":"PRIVATE-SERIAL","productId":"p","warehouseId":"w","quantity":9007199254740992,"unitCost":1}]',
    "SALE_UNIT_EVIDENCE",
  ],
] as const)
  test(`sales agreement: invalid ${column} evidence is reported without echoing private JSON`, (t) => {
    const f = fixture(t);
    ship(f, accept(f).id);
    f.app.database
      .owned("fulfillment")
      .run(`UPDATE fulfillment_shipments SET ${column}=?`, raw);
    const r = f.app.reconciliation(f.actor).sales;
    assert(r.issues.items.some((i) => i.code === code));
    assert(!JSON.stringify(r).includes("PRIVATE-"));
  });

test("sales agreement: wrong currency is flagged and excluded from regional line amounts without exchange", (t) => {
  const f = fixture(t);
  ship(f, accept(f).id);
  f.app.database
    .owned("billing")
    .run("UPDATE billing_invoices SET currency='USD'");
  const r = f.app.reconciliation(f.actor).sales;
  assert.equal(r.invoiceNet, "0");
  assert.equal(r.invoiceTax, "0");
  assert.equal(r.invoicedQuantity, "1");
  assert(r.issues.items.some((i) => i.code === "SALE_INVOICE_CURRENCY"));
});

test("sales agreement: scoped orphan deductions retain exact 64-bit totals and bounded redacted details", (t) => {
  const f = fixture(t),
    store = f.app.database.owned("inventory"),
    unit = f.app.inventory.trace(f.actor, "S1").unit;
  for (let i = 0; i < 125; i++)
    store.run(
      "INSERT INTO inventory_movements VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      `orphan-${i}`,
      f.actor.orgId,
      unit.id,
      f.w1,
      "shipment",
      -1,
      6000,
      `missing-${i}`,
      "PRIVATE-REASON",
      "PRIVATE-ACTOR",
      new Date().toISOString(),
    );
  store.run(
    "UPDATE inventory_movements SET quantity=-9007199254740993,unit_cost=9007199254740993 WHERE id='orphan-124'",
  );
  const r = f.app.reconciliation(f.actor).sales;
  assert.equal(r.movementQuantity, "9007199254741117");
  assert.equal(r.movementCost, String(9007199254740993n ** 2n + 124n * 6000n));
  assert.equal(r.issues.count, 127);
  assert.equal(r.issues.items.length, 100);
  assert.equal(r.issues.truncated, true);
  assert(!JSON.stringify(r).includes("PRIVATE-"));
});

test("sales agreement: own reads fence competing writers through all four modules and release on failure", (t) => {
  const f = fixture(t),
    db = new DatabaseSync(f.path, { timeout: 1 });
  const original = f.app.billing.salesEvidence.bind(f.app.billing);
  t.mock.method(f.app.billing, "salesEvidence", (actor: Actor) => {
    assert.throws(
      () => db.prepare("UPDATE orders_lines SET shipped=0").run(),
      /locked/,
    );
    return original(actor);
  });
  try {
    ship(f, accept(f).id);
    const before = db.prepare("SELECT * FROM orders_lines").all();
    assert.equal(f.app.reconciliation(f.actor).sales.issues.count, 0);
    assert.deepEqual(db.prepare("SELECT * FROM orders_lines").all(), before);
    t.mock.method(f.app.fulfillment, "salesEvidence", () => {
      throw new Error("synthetic sales read failure");
    });
    assert.throws(
      () => f.app.reconciliation(f.actor),
      /synthetic sales read failure/,
    );
    assert.equal(
      db.prepare("UPDATE orders_lines SET shipped=0").run().changes,
      1,
    );
  } finally {
    db.close();
  }
});

test("sales agreement: warranty return and replacement do not create a second ordinary invoice or deduction", (t) => {
  const f = fixture(t);
  ship(f, accept(f).id);
  const c = f.app.warranty.submit(f.actor, "claim", {
    accountId: f.buyer,
    unitId: f.app.inventory.trace(f.actor, "S1").unit.id,
    type: "warranty",
    issue: "Synthetic failure",
    evidence: "PRIVATE-EVIDENCE",
  });
  f.app.warranty.review(f.actor, "review", {
    claimId: c.id,
    approved: true,
    reason: "Synthetic approval",
  });
  f.app.warranty.receive(f.actor, "receive-return", {
    claimId: c.id,
    warehouseId: f.w2,
    bin: "Q",
    serial: "S1",
  });
  f.app.warranty.inspect(f.actor, "inspect", {
    claimId: c.id,
    findings: "Synthetic failure",
  });
  const r = f.app.warranty.reserveReplacement(f.actor, "reserve", {
    claimId: c.id,
    newUnitId: f.app.inventory.trace(f.actor, "S2").unit.id,
    oldDisposition: "scrap",
    coveragePolicy: "inherit_original",
    reason: "Synthetic approval",
  });
  f.app.warranty.dispatchReplacement(f.actor, "dispatch", {
    replacementId: r.id,
    revision: 1,
    serial: "S2",
    recipient: "Synthetic recipient",
    address: "PRIVATE-ADDRESS",
    carrier: "Synthetic carrier",
    tracking: "Synthetic tracking",
    evidence: "PRIVATE-EVIDENCE",
  });
  const result = f.app.reconciliation(f.actor);
  assert.equal(result.stock.issues.count, 0);
  assert.equal(result.sales.issues.count, 0);
  assert.equal(result.sales.shipments, 1);
  assert.equal(result.sales.invoices, 1);
  assert.equal(result.sales.movements, 1);
});

test("sales agreement: foreign module evidence referencing native identifiers is excluded from the entire scan", (t) => {
  const f = fixture(t);
  ship(f, accept(f).id);
  const before = f.app.reconciliation(f.actor).sales;
  f.app.database
    .owned("orders")
    .run(
      `INSERT INTO orders_orders SELECT id||'-foreign','foreign',account_id,warehouse_id,state,revision,currency,total,created_at FROM orders_orders`,
    );
  f.app.database
    .owned("orders")
    .run(
      `INSERT INTO orders_lines SELECT id||'-foreign','foreign',order_id||'-foreign',product_id,description,quantity,shipped,canceled,allocated,unit_price,unit_tax FROM orders_lines`,
    );
  f.app.database
    .owned("fulfillment")
    .run(
      `INSERT INTO fulfillment_shipments SELECT id||'-foreign','foreign',order_id,account_id,warehouse_id,state,mode,address,tracking,carrier,lines,units,invoice_id,created_at,shipped_at FROM fulfillment_shipments`,
    );
  f.app.database
    .owned("billing")
    .run(
      `INSERT INTO billing_invoices SELECT id||'-foreign','foreign',account_id,order_id,shipment_id,number,currency,net,tax,total,created_at FROM billing_invoices`,
    );
  f.app.database
    .owned("billing")
    .run(
      `INSERT INTO billing_lines SELECT id||'-foreign','foreign',invoice_id||'-foreign',product_id,description,quantity,unit_price,unit_tax FROM billing_lines`,
    );
  f.app.database
    .owned("inventory")
    .run(
      `INSERT INTO inventory_allocations SELECT id||'-foreign','foreign',order_id,product_id,warehouse_id,unit_id,quantity,consumed,released,stage FROM inventory_allocations`,
    );
  f.app.database
    .owned("inventory")
    .run(
      `INSERT INTO inventory_movements SELECT id||'-foreign','foreign',unit_id,warehouse_id,type,quantity,unit_cost,reference,reason,actor_id,created_at FROM inventory_movements WHERE type='shipment'`,
    );
  const after = f.app.reconciliation(f.actor).sales;
  assert.deepEqual(after, before);
  assert(!JSON.stringify(after).includes("foreign"));
});

test("sales agreement: packed and void supply has no shipment money until handover, inconsistent retained links are flagged", (t) => {
  const f = fixture(t),
    order = accept(f),
    a = f.app.fulfillment.picks(f.actor, order.id)[0]!;
  f.app.fulfillment.pick(f.actor, "pick", {
    orderId: order.id,
    allocationId: a.id,
    serial: a.serial,
  });
  const packed = f.app.fulfillment.pack(f.actor, "pack", {
    orderId: order.id,
    revision: f.app.orders.order(f.actor, order.id).revision,
    mode: "collection",
    address: "PRIVATE-ADDRESS",
    lines: [{ allocationId: a.id, quantity: 1 }],
  });
  const pending = f.app.reconciliation(f.actor).sales;
  assert.equal(pending.issues.count, 0);
  assert.equal(pending.shipments, 0);
  assert.equal(pending.invoices, 0);
  f.app.fulfillment.void(f.actor, "void", {
    shipmentId: packed.id,
    reason: "Synthetic correction",
  });
  assert.deepEqual(f.app.reconciliation(f.actor).sales, pending);
  f.app.database
    .owned("fulfillment")
    .run(
      "UPDATE fulfillment_shipments SET invoice_id='missing' WHERE id=?",
      packed.id,
    );
  assert(
    f.app
      .reconciliation(f.actor)
      .sales.issues.items.some((i) => i.code === "SALE_UNCOMMITTED_EVIDENCE"),
  );
});
