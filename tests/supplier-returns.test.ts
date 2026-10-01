import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { Application } from "../src/server/application.ts";
import { fixture, accept } from "./fixtures.ts";

function serialReturn(f: ReturnType<typeof fixture>, serial = "S3") {
  const u = f.app.inventory.trace(f.actor, serial).unit;
  return {
    receiptId: f.app.inventory.purchaseOrigin(f.actor, u.id)!,
    unitId: u.id,
    revision: u.revision,
    quantity: 1,
    serial,
    returnRef: `RETURN-${serial}`,
    reason: "Synthetic supplier-approved defect",
    handoverEvidence: "Synthetic courier custody receipt",
  };
}
function warehouseReader(f: ReturnType<typeof fixture>, warehouseId: string) {
  const user = f.app.identity.createUser(f.actor, "return-reader", {
    email: "warehouse@return.example.test",
    name: "Synthetic warehouse reader",
    password: "long-test-only-password",
    role: "warehouse",
    sites: [warehouseId],
  });
  return f.app.identity.currentActor({ ...f.actor, id: user.id });
}
function bulk(f: ReturnType<typeof fixture>) {
  const product = f.app.catalog.create(f.actor, "bulk", {
    sku: "RETURN-BULK",
    name: "Synthetic return supplies",
    serialized: false,
    unitPrice: 2500,
    taxBasisPoints: 1300,
  }).id;
  const po = f.app.procurement.create(f.actor, "bulk-po", {
    supplierId: f.supplier,
    warehouseId: f.w1,
    lines: [{ productId: product, quantity: 6, unitCost: 1000 }],
  }).id;
  const line = f.app.procurement.orders(f.actor).find((p) => p.id === po)!
    .lines[0]!;
  const receipt = f.app.procurement.receive(f.actor, "bulk-receipt", {
    poId: po,
    lineId: String(line.id),
    quantity: 6,
    serials: [],
    deliveryRef: "RETURN-BULK-STOCK",
    bin: "R-1",
    quarantine: false,
  });
  return {
    product,
    po,
    receipt,
    unit: f.app.inventory.unit(f.actor, receipt.unitIds[0]!),
  };
}

test("supplier serial return preserves purchase and external custody evidence through restart/new-key retry without customer credit or duplicate stock removal", (t) => {
  const f = fixture(t),
    input = serialReturn(f);
  assert.throws(
    () =>
      f.app.procurement.returnStock(
        { ...f.actor, role: "warehouse", sites: [f.w1] },
        "denied",
        input,
      ),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () =>
      f.app.procurement.returnStock(f.actor, "wrong-serial", {
        ...input,
        serial: "S2",
      }),
    { code: "SERIAL" },
  );
  assert.throws(
    () =>
      f.app.procurement.returnStock(
        { ...f.actor, orgId: "foreign" },
        "foreign",
        input,
      ),
    { code: "NOT_FOUND" },
  );
  const result = f.app.procurement.returnStock(f.actor, "return", input);
  assert.equal(result.value, 6000);
  assert.equal(f.app.inventory.trace(f.actor, "S3").unit.quantity, 0);
  const physical = f.app.inventory
    .stock(f.actor)
    .filter((u) => u.product_id === f.product);
  assert.equal(
    physical.reduce((s, u) => s + u.quantity, 0),
    2,
  );
  assert.equal(
    physical.reduce((s, u) => s + u.quantity * u.cost, 0),
    12000,
  );
  assert.equal(18000 - result.value, 12000);
  const po = f.app.procurement.orders(f.actor).find((p) => p.id === f.po)!;
  assert.equal(po.state, "received");
  assert.equal(po.lines[0]!.received, 3);
  assert.equal(f.app.billing.invoices(f.actor).length, 0);
  assert.equal(f.app.billing.credits(f.actor).length, 0);
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(
    f.app.procurement.returnStock({ ...f.actor, id: "other-admin" }, "other", {
      ...input,
      returnRef: " RETURN-S3 ",
    }),
    result,
  );
  assert.deepEqual(
    f.app.procurement.returnStock(f.actor, "return", input),
    result,
  );
  assert.equal(f.app.procurement.returns(f.actor).length, 1);
  assert.equal(
    f.app.inventory
      .trace(f.actor, "S3")
      .movements.filter((m) => m.type === "supplier.return").length,
    1,
  );
  assert.throws(
    () =>
      f.app.procurement.returnStock(f.actor, "conflict", {
        ...input,
        reason: "Changed reason",
      }),
    { code: "RECEIPT_CONFLICT" },
  );
  assert.throws(
    () =>
      f.app.procurement.returnStock(
        { ...f.actor, role: "finance" },
        "return",
        input,
      ),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () =>
      f.app.procurement.returnStock(f.actor, "second", {
        ...input,
        returnRef: "SECOND",
        revision: result.revision,
      }),
    { code: "STOCK" },
  );
  assert.equal(f.app.procurement.returns(warehouseReader(f, f.w2)).length, 0);
});

test("bulk supplier returns follow original purchase lineage through split dispatch, partial arrival and recovered loss at original cost", (t) => {
  const f = fixture(t),
    b = bulk(f);
  const tr = f.app.inventory.dispatchTransfer(f.actor, "dispatch", {
    unitId: b.unit.id,
    revision: b.unit.revision,
    quantity: 4,
    destinationId: f.w2,
    reason: "Synthetic relocation",
  });
  const received = f.app.inventory.receiveTransfer(f.actor, "arrival", {
    transferId: tr.id,
    lineId: tr.lineId,
    quantity: 1,
    serial: null,
    receiptRef: "PART",
    bin: "B-1",
    condition: "damaged",
    reason: "Synthetic damaged arrival",
  });
  const transit = f.app.inventory.unit(f.actor, tr.unitId);
  const loss = f.app.inventory.approveTransferLoss(f.actor, "loss", {
    transferId: tr.id,
    lineId: tr.lineId,
    revision: transit.revision,
    quantity: 1,
    serial: null,
    lossRef: "LOSS",
    reason: "Synthetic confirmed shortage",
  });
  const recovered = f.app.inventory.recoverTransferLoss(f.actor, "recover", {
    lossId: loss.lossId,
    quantity: 1,
    serial: null,
    receiptRef: "FOUND",
    bin: "B-2",
    condition: "quarantine",
    reason: "Synthetic recovered defect",
  });
  f.app.close();
  f.app = new Application(f.path);
  const inputs = [received.unitId, recovered.unitId].map((unitId, i) => ({
    receiptId: b.receipt.id,
    unitId,
    revision: f.app.inventory.unit(f.actor, unitId).revision,
    quantity: 1,
    serial: null,
    returnRef: `BULK-${i}`,
    reason: "Supplier accepted defective portion",
    handoverEvidence: `HANDOVER-${i}`,
  }));
  for (const input of inputs) {
    assert.equal(
      f.app.inventory.purchaseOrigin(f.actor, input.unitId),
      b.receipt.id,
    );
    const r = f.app.procurement.returnStock(f.actor, input.returnRef, input);
    assert.equal(r.unitCost, 1000);
  }
  const remaining = f.app.inventory
    .stock(f.actor)
    .filter((u) => u.product_id === b.product);
  assert.equal(
    remaining.reduce((s, u) => s + u.quantity, 0),
    4,
  );
  assert.equal(
    remaining.reduce((s, u) => s + u.quantity * u.cost, 0),
    4000,
  );
  const returns = f.app.procurement.returns(f.actor);
  assert.equal(
    returns.reduce((s, r) => s + r.quantity * r.unit_cost, 0),
    2000,
  );
  assert.equal(6000 - 2000, 4000);
  const destination = warehouseReader(f, f.w2);
  assert.equal(f.app.procurement.returns(destination).length, 2);
  const history = f.app.procurement
    .receipts(f.actor)
    .find((r) => r.id === b.receipt.id)!;
  assert.equal(history.returnedQuantity, 2);
  assert.equal(history.quantity, 6);
  assert.equal(
    f.app.procurement.orders(f.actor).find((p) => p.id === b.po)!.state,
    "received",
  );
});

test("supplier returns reject stale, reserved, transit, unrelated receipt and quantities above original purchase even after count gains", (t) => {
  const f = fixture(t),
    input = serialReturn(f, "S1"),
    b = bulk(f);
  assert.throws(
    () =>
      f.app.procurement.returnStock(f.actor, "unrelated", {
        ...input,
        receiptId: b.receipt.id,
      }),
    { code: "PROVENANCE" },
  );
  accept(f, 1); // FIFO reserves S1.
  assert.throws(
    () => f.app.procurement.returnStock(f.actor, "reserved", input),
    { code: "STOCK" },
  );
  const tr = f.app.inventory.dispatchTransfer(f.actor, "dispatch-s3", {
    unitId: serialReturn(f).unitId,
    revision: 1,
    quantity: 1,
    destinationId: f.w2,
    reason: "Synthetic transfer",
  });
  assert.throws(
    () =>
      f.app.procurement.returnStock(f.actor, "transit", {
        ...serialReturn(f),
        unitId: tr.unitId,
      }),
    { code: "STATE" },
  );
  f.app.inventory.adjustCount(f.actor, "gain", {
    unitId: b.unit.id,
    revision: b.unit.revision,
    count: 10,
    reason: "Synthetic discovered stock",
  });
  const request = {
    receiptId: b.receipt.id,
    unitId: b.unit.id,
    revision: 2,
    quantity: 7,
    serial: null,
    returnRef: "EXCESS",
    reason: "Synthetic test",
    handoverEvidence: "Synthetic evidence",
  };
  assert.throws(
    () => f.app.procurement.returnStock(f.actor, "excess", request),
    { code: "QUANTITY" },
  );
  assert.throws(
    () =>
      f.app.procurement.returnStock(f.actor, "stale", {
        ...request,
        quantity: 1,
        revision: 1,
      }),
    { code: "REVISION" },
  );
  assert.equal(f.app.procurement.returns(f.actor).length, 0);
  assert.equal(f.app.inventory.unit(f.actor, b.unit.id).quantity, 10);
});

test(
  "separate-process supplier handover competes with dispatch and deduplicates identical handovers",
  { timeout: 10000 },
  async (t) => {
    for (const identical of [false, true]) {
      const f = fixture(t),
        input = serialReturn(f);
      const operations = [
        { operation: "return", payload: input },
        {
          operation: identical ? "return" : "dispatch",
          payload: identical
            ? input
            : {
                unitId: input.unitId,
                revision: input.revision,
                quantity: 1,
                destinationId: f.w2,
                reason: "Competing dispatch",
              },
        },
      ];
      const children = operations.map((operation, i) =>
        fork(new URL("./supplier-return-child.ts", import.meta.url), [], {
          execArgv: ["--import", "tsx"],
          stdio: ["ignore", "ignore", "pipe", "ipc"],
        }),
      );
      t.after(() => children.forEach((c) => c.kill()));
      const ready: Promise<void>[] = [];
      const results: Promise<{
        ok: boolean;
        result?: unknown;
        code?: string;
      }>[] = [];
      children.forEach((child, i) => {
        let readyResolve: () => void,
          resultResolve: (v: any) => void,
          reject: (e: Error) => void;
        ready.push(new Promise<void>((r) => (readyResolve = r)));
        results.push(
          new Promise((r, j) => {
            resultResolve = r;
            reject = j;
          }),
        );
        let stderr = "";
        child.stderr?.on("data", (d) => (stderr += String(d)));
        child.on("message", (m: any) =>
          m.ready ? readyResolve() : resultResolve(m),
        );
        child.on("error", reject!);
        child.on("exit", (code) => {
          if (code !== 0) reject(new Error(`Child exit ${code}: ${stderr}`));
        });
        child.send({
          action: "init",
          input: {
            path: f.path,
            actor: f.actor,
            key: `race-${i}`,
            ...operations[i],
          },
        });
      });
      await Promise.all(ready);
      children.forEach((c) => c.send({ action: "go" }));
      const outcomes = await Promise.all(results);
      assert.equal(outcomes.filter((r) => r.ok).length, identical ? 2 : 1);
      if (identical) assert.deepEqual(outcomes[0]!.result, outcomes[1]!.result);
      const returned = outcomes[0]!.ok;
      assert.equal(f.app.procurement.returns(f.actor).length, returned ? 1 : 0);
      assert.equal(
        f.app.inventory.trace(f.actor, "S3").unit.quantity,
        returned ? 0 : 1,
      );
      assert.equal(f.app.inventory.transfers(f.actor).length, returned ? 0 : 1);
      assert.equal(
        f.app.inventory
          .stock(f.actor)
          .filter((u) => u.product_id === f.product)
          .reduce((s, u) => s + u.quantity * u.cost, 0),
        returned ? 12000 : 18000,
      );
    }
  },
);

test("historical split lots with missing source evidence cannot invent purchase provenance after restart", (t) => {
  const f = fixture(t),
    b = bulk(f);
  const transfer = f.app.inventory.dispatchTransfer(f.actor, "split", {
    unitId: b.unit.id,
    revision: b.unit.revision,
    quantity: 2,
    destinationId: f.w2,
    reason: "Synthetic legacy split",
  });
  const arrival = f.app.inventory.receiveTransfer(f.actor, "arrival", {
    transferId: transfer.id,
    lineId: transfer.lineId,
    quantity: 2,
    serial: null,
    receiptRef: "LEGACY-ARRIVAL",
    bin: "B-1",
    condition: "usable",
    reason: "Synthetic arrival",
  });
  f.app.database
    .owned("inventory")
    .run(
      "DELETE FROM inventory_transfer_origins WHERE line_id=?",
      transfer.lineId,
    );
  f.app.close();
  f.app = new Application(f.path);
  assert.equal(f.app.inventory.purchaseOrigin(f.actor, arrival.unitId), null);
  assert.throws(
    () =>
      f.app.procurement.returnStock(f.actor, "unproven", {
        receiptId: b.receipt.id,
        unitId: arrival.unitId,
        revision: f.app.inventory.unit(f.actor, arrival.unitId).revision,
        quantity: 1,
        serial: null,
        returnRef: "UNPROVEN",
        reason: "Cannot guess origin",
        handoverEvidence: "Synthetic evidence",
      }),
    { code: "PROVENANCE" },
  );
  assert.equal(f.app.procurement.returns(f.actor).length, 0);
  assert.equal(f.app.inventory.unit(f.actor, arrival.unitId).quantity, 2);
  assert.equal(
    f.app.inventory.purchaseOrigin(f.actor, b.unit.id),
    b.receipt.id,
  );
});
