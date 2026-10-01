import { test } from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { Application } from "../src/server/application.ts";
import { fixture, accept } from "./fixtures.ts";

test("partial packing holds quantities across restart, void and out-of-order handovers; stock/cost/invoices reconcile", (t) => {
  const f = fixture(t);
  const bulk = f.app.catalog.create(f.actor, "bulk", {
    sku: "BULK",
    name: "Synthetic bulk",
    serialized: false,
    unitPrice: 2500,
    taxBasisPoints: 1300,
  }).id;
  const po = f.app.procurement.create(f.actor, "bulk-po", {
    supplierId: f.supplier,
    warehouseId: f.w1,
    lines: [{ productId: bulk, quantity: 5, unitCost: 1000 }],
  }).id;
  const poLine = f.app.procurement.orders(f.actor).find((p) => p.id === po)!
    .lines[0]!;
  f.app.procurement.receive(f.actor, "bulk-receive", {
    poId: po,
    lineId: String(poLine.id),
    deliveryRef: "BULK",
    quantity: 5,
    serials: [],
    bin: "B-1",
    quarantine: false,
  });
  const cart = f.app.orders.saveCart(f.actor, "cart", {
    accountId: f.buyer,
    warehouseId: f.w1,
    revision: 0,
    lines: [
      { productId: f.product, quantity: 1 },
      { productId: bulk, quantity: 4 },
    ],
  });
  const quote = f.app.orders.quote(f.actor, "quote", {
    cartId: cart.id,
    revision: cart.revision,
  });
  const order = f.app.orders.accept(f.actor, "order", {
    quoteId: quote.id,
    allowBackorder: false,
  });
  const picks = f.app.fulfillment.picks(f.actor, order.id);
  for (const p of picks)
    f.app.fulfillment.pick(f.actor, `pick-${p.id}`, {
      orderId: order.id,
      allocationId: p.id,
      serial: p.serial,
    });
  const serial = picks.find((p) => p.product_id === f.product)!,
    supply = picks.find((p) => p.product_id === bulk)!;
  const packing = (lines: { allocationId: string; quantity: number }[]) => ({
    orderId: order.id,
    revision: f.app.orders.order(f.actor, order.id).revision,
    mode: "collection" as const,
    address: "Synthetic counter",
    lines,
  });
  const firstInput = packing([
    { allocationId: serial.id, quantity: 1 },
    { allocationId: supply.id, quantity: 2 },
  ]);
  const first = f.app.fulfillment.pack(f.actor, "first-pack", firstInput);
  assert.deepEqual(
    f.app.fulfillment.pack(f.actor, "first-pack", firstInput),
    first,
  );
  const second = f.app.fulfillment.pack(
    f.actor,
    "second-pack",
    packing([{ allocationId: supply.id, quantity: 1 }]),
  );
  assert.equal(
    f.app.fulfillment.picks(f.actor, order.id).find((p) => p.id === supply.id)!
      .packable,
    1,
  );
  assert.equal(f.app.billing.invoices(f.actor).length, 0);
  assert.equal(
    f.app.inventory.stock(f.actor).find((u) => u.product_id === bulk)!.quantity,
    5,
  );
  assert.equal(f.app.billing.exposure(f.actor, f.buyer).total, 22600);
  assert.throws(
    () =>
      f.app.fulfillment.pack(
        f.actor,
        "overlap",
        packing([{ allocationId: supply.id, quantity: 2 }]),
      ),
    { code: "QUANTITY" },
  );
  assert.throws(
    () =>
      f.app.fulfillment.pick(f.actor, "unpick-packed", {
        orderId: order.id,
        allocationId: supply.id,
        serial: null,
        unpick: true,
      }),
    { code: "PACKED" },
  );

  f.app.close();
  const reopened = new Application(f.path);
  f.app = reopened;
  assert.equal(
    f.app.fulfillment.picks(f.actor, order.id).find((p) => p.id === supply.id)!
      .packed,
    3,
  );
  const voidInput = {
    shipmentId: second.id,
    reason: "Synthetic split changed",
  };
  f.app.fulfillment.void(f.actor, "void-second", voidInput);
  f.app.fulfillment.void(f.actor, "void-second", voidInput);
  assert.equal(
    f.app.fulfillment.picks(f.actor, order.id).find((p) => p.id === supply.id)!
      .packable,
    2,
  );
  const replacement = f.app.fulfillment.pack(
    f.actor,
    "replacement",
    packing([{ allocationId: supply.id, quantity: 1 }]),
  );
  const shipInput = {
    shipmentId: replacement.id,
    handoverEvidence: "Synthetic bulk handover",
  };
  const shippedSecond = f.app.fulfillment.commit(
    f.actor,
    "ship-second",
    shipInput,
  );
  assert.deepEqual(
    f.app.fulfillment.commit(f.actor, "ship-second", shipInput),
    shippedSecond,
  );
  assert.equal(
    f.app.billing.invoice(f.actor, shippedSecond.invoiceId).total,
    2825,
  );
  assert.equal(
    f.app.inventory.stock(f.actor).find((u) => u.product_id === bulk)!.quantity,
    4,
  );
  const shippedFirst = f.app.fulfillment.commit(f.actor, "ship-first", {
    shipmentId: first.id,
    handoverEvidence: "Synthetic serial and bulk handover",
  });
  assert.equal(
    f.app.billing.invoice(f.actor, shippedFirst.invoiceId).total,
    16950,
  );
  assert.equal(f.app.inventory.trace(f.actor, "S1").unit.state, "sold");
  assert.equal(
    f.app.fulfillment.picks(f.actor, order.id).find((p) => p.id === supply.id)!
      .packable,
    1,
  );
  assert.equal(f.app.orders.order(f.actor, order.id).state, "open");
  assert.throws(
    () =>
      f.app.fulfillment.void(f.actor, "void-shipped", {
        shipmentId: first.id,
        reason: "Must reject",
      }),
    { code: "STATE" },
  );
  f.app.fulfillment.pick(f.actor, "unpick-remainder", {
    orderId: order.id,
    allocationId: supply.id,
    serial: null,
    unpick: true,
  });
  const line = f.app.orders
    .lines(f.actor, order.id)
    .find((l) => l.product_id === bulk)!;
  f.app.orders.cancel(f.actor, "cancel-remainder", {
    orderId: order.id,
    lineId: line.id,
    quantity: 1,
    revision: f.app.orders.order(f.actor, order.id).revision,
    reason: "Synthetic unsupplied unit canceled",
  });
  assert.equal(f.app.orders.order(f.actor, order.id).state, "closed");
  const actualLine = f.app.orders
    .lines(f.actor, order.id)
    .find((l) => l.product_id === bulk)!;
  assert.deepEqual(
    [actualLine.shipped, actualLine.allocated, actualLine.canceled],
    [3, 0, 1],
  );
  assert.equal(
    f.app.billing.invoices(f.actor).reduce((sum, i) => sum + i.total, 0),
    19775,
  );
  assert.equal(f.app.billing.exposure(f.actor, f.buyer).total, 19775);
  const stock = f.app.inventory.stock(f.actor);
  assert.equal(
    stock.reduce((sum, u) => sum + u.quantity * u.cost, 0),
    14000,
  );
  assert.equal(stock.find((u) => u.product_id === bulk)!.available, 2);
  assert.equal(f.app.inventory.availability(f.actor, f.product, f.w1), 2);
  assert.equal(
    f.app.fulfillment.shipments(f.actor).filter((s) => s.state === "shipped")
      .length,
    2,
  );
});

test(
  "two separate processes packing the same last serial create exactly one shipment",
  { timeout: 10000 },
  async (t) => {
    const f = fixture(t),
      order = accept(f);
    const p = f.app.fulfillment.picks(f.actor, order.id)[0]!;
    f.app.fulfillment.pick(f.actor, "pick", {
      orderId: order.id,
      allocationId: p.id,
      serial: p.serial,
    });
    const children: ChildProcess[] = [];
    t.after(() => children.forEach((child) => child.kill()));
    const work = [0, 1].map((i) => {
      const child = fork(new URL("./packing-child.ts", import.meta.url), [], {
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      });
      children.push(child);
      let readyResolve: () => void,
        resultResolve: (result: { ok: boolean; code?: string }) => void;
      const ready = new Promise<void>((r) => (readyResolve = r));
      const result = new Promise<{ ok: boolean; code?: string }>(
        (resolve, reject) => {
          resultResolve = resolve;
          let stderr = "";
          child.stderr?.on("data", (c) => (stderr += String(c)));
          child.on("error", reject);
          child.on("exit", (code) => {
            if (code !== 0)
              reject(new Error(`Packing child exit ${code}: ${stderr}`));
          });
        },
      );
      child.on("message", (message: any) =>
        message.ready ? readyResolve() : resultResolve(message),
      );
      child.send({
        action: "init",
        input: {
          path: f.path,
          actor: f.actor,
          key: `race-${i}`,
          payload: {
            orderId: order.id,
            revision: 1,
            mode: "collection",
            address: "Synthetic counter",
            lines: [{ allocationId: p.id, quantity: 1 }],
          },
        },
      });
      return { ready, result };
    });
    await Promise.all(work.map((w) => w.ready));
    children.forEach((child) => child.send({ action: "go" }));
    const results = await Promise.all(work.map((w) => w.result));
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(results.find((r) => !r.ok)?.code, "QUANTITY");
    assert.equal(f.app.fulfillment.shipments(f.actor).length, 1);
    assert.equal(f.app.fulfillment.picks(f.actor, order.id)[0]!.packable, 0);
    assert.equal(f.app.inventory.trace(f.actor, "S1").unit.quantity, 1);
    assert.equal(f.app.billing.invoices(f.actor).length, 0);
  },
);

test("legacy overlapping packing blocks handover without changing stock or billing until a shipment is voided", (t) => {
  const f = fixture(t),
    order = accept(f);
  const allocation = f.app.fulfillment.picks(f.actor, order.id)[0]!;
  f.app.fulfillment.pick(f.actor, "pick", {
    orderId: order.id,
    allocationId: allocation.id,
    serial: allocation.serial,
  });
  const packed = f.app.fulfillment.pack(f.actor, "pack", {
    orderId: order.id,
    revision: f.app.orders.order(f.actor, order.id).revision,
    mode: "collection",
    address: "Synthetic legacy counter",
    lines: [{ allocationId: allocation.id, quantity: 1 }],
  });
  // Emulate a persisted duplicate allowed by the earlier packing implementation.
  f.app.database
    .owned("fulfillment")
    .run(
      "INSERT INTO fulfillment_shipments(id,org_id,order_id,account_id,warehouse_id,state,mode,address,lines,created_at) SELECT ?,org_id,order_id,account_id,warehouse_id,state,mode,address,lines,created_at FROM fulfillment_shipments WHERE id=?",
      "legacy-overlap",
      packed.id,
    );
  const handover = {
    shipmentId: packed.id,
    handoverEvidence: "Synthetic handover",
  };
  assert.throws(() => f.app.fulfillment.commit(f.actor, "handover", handover), {
    code: "PACKING_CONFLICT",
  });
  assert.equal(f.app.inventory.trace(f.actor, "S1").unit.quantity, 1);
  assert.equal(f.app.orders.lines(f.actor, order.id)[0]!.shipped, 0);
  assert.equal(f.app.billing.invoices(f.actor).length, 0);
  assert.equal(
    f.app.fulfillment.shipments(f.actor).filter((s) => s.state === "packed")
      .length,
    2,
  );
  f.app.fulfillment.void(f.actor, "void-legacy", {
    shipmentId: "legacy-overlap",
    reason: "Synthetic legacy reconciliation",
  });
  const shipped = f.app.fulfillment.commit(f.actor, "handover", handover);
  assert.equal(f.app.billing.invoice(f.actor, shipped.invoiceId).total, 11300);
  assert.equal(f.app.inventory.trace(f.actor, "S1").unit.quantity, 0);
  assert.equal(f.app.billing.invoices(f.actor).length, 1);
});
