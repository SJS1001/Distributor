import { test } from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { Application } from "../src/server/application.ts";
import { fixture } from "./fixtures.ts";
import type { Role } from "../src/server/core.ts";

function user(f: ReturnType<typeof fixture>, role: Role, name: string = role) {
  const row = f.app.identity.createUser(f.actor, name, {
    name,
    email: `${name}@example.test`,
    password: "long-transfer-password",
    role,
    sites: [f.w1, f.w2],
  });
  return f.app.identity.currentActor({ ...f.actor, id: row.id });
}

function transferBulk(f: ReturnType<typeof fixture>, quantity = 6) {
  const product = f.app.catalog.create(f.actor, "loss-bulk", {
    sku: "LOSS-1",
    name: "Synthetic loss supplies",
    serialized: false,
    unitPrice: 2500,
    taxBasisPoints: 1300,
  }).id;
  const po = f.app.procurement.create(f.actor, "loss-po", {
    supplierId: f.supplier,
    warehouseId: f.w1,
    lines: [{ productId: product, quantity, unitCost: 1000 }],
  }).id;
  f.app.procurement.receive(f.actor, "loss-stock", {
    poId: po,
    lineId: String(
      f.app.procurement.orders(f.actor).find((p) => p.id === po)!.lines[0]!.id,
    ),
    quantity,
    serials: [],
    deliveryRef: "LOSS-STOCK",
    bin: "A-1",
    quarantine: false,
  });
  return f.app.inventory.stock(f.actor).find((u) => u.product_id === product)!;
}

test("approved partial transit losses, arrivals and later recovery retain evidence and reconcile original quantity/cost through restart", (t) => {
  const f = fixture(t),
    original = transferBulk(f);
  const tr = f.app.inventory.dispatchTransfer(f.actor, "dispatch", {
    unitId: original.id,
    quantity: 4,
    revision: original.revision,
    destinationId: f.w2,
    reason: "Synthetic loss relocation",
  });
  const approval = {
    transferId: tr.id,
    lineId: tr.lineId,
    revision: f.app.inventory.unit(f.actor, tr.unitId).revision,
    quantity: 2,
    serial: null,
    lossRef: "CLAIM-1",
    reason:
      "Operator count and carrier investigation approve two missing cartons",
  };
  const loss = f.app.inventory.approveTransferLoss(f.actor, "loss", approval);
  const line = () =>
    f.app.inventory.transfers(f.actor).find((r) => r.id === tr.id)!.lines[0]!;
  assert.equal(line().remainingQuantity, 2);
  assert.equal(line().lostQuantity, 2);
  assert.equal(line().receivedQuantity, 0);
  assert.equal(line().legacyReceived, false);
  assert.equal(
    f.app.inventory.transfers(f.actor)[0]!.state,
    "partially-reconciled",
  );
  assert.throws(
    () =>
      f.app.inventory.approveTransferLoss(
        { ...f.actor, id: "absent-admin" },
        "another-key",
        approval,
      ),
    { code: "FORBIDDEN" },
  );
  assert.deepEqual(
    f.app.inventory.approveTransferLoss(
      user(f, "admin", "other-admin"),
      "another-key",
      approval,
    ),
    loss,
  );
  assert.throws(
    () =>
      f.app.inventory.approveTransferLoss(f.actor, "conflict", {
        ...approval,
        quantity: 1,
      }),
    { code: "RECEIPT_CONFLICT" },
  );
  assert.throws(
    () =>
      f.app.inventory.approveTransferLoss(f.actor, "stale", {
        ...approval,
        lossRef: "STALE",
      }),
    { code: "REVISION" },
  );
  const current = f.app.inventory.unit(f.actor, tr.unitId).revision;
  assert.throws(
    () =>
      f.app.inventory.approveTransferLoss(f.actor, "over", {
        ...approval,
        revision: current,
        quantity: 3,
        lossRef: "OVER",
      }),
    { code: "QUANTITY" },
  );
  // A found portion does not remove any of the other two still in transit.
  const recovery = {
    lossId: loss.lossId,
    quantity: 1,
    serial: null,
    receiptRef: "FOUND-1",
    bin: "Q-1",
    condition: "quarantine" as const,
    reason: "One recovered carton awaits inspection",
  };
  const recovered = f.app.inventory.recoverTransferLoss(
    f.actor,
    "found",
    recovery,
  );
  assert.equal(recovered.remainingLostQuantity, 1);
  assert.equal(line().remainingQuantity, 2);
  assert.equal(line().lostQuantity, 1);
  assert.equal(line().receivedQuantity, 1);
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(
    f.app.inventory.recoverTransferLoss(f.actor, "found-new-key", recovery),
    recovered,
  );
  assert.throws(
    () =>
      f.app.inventory.recoverTransferLoss(f.actor, "conflict", {
        ...recovery,
        bin: "B-2",
      }),
    { code: "RECEIPT_CONFLICT" },
  );
  assert.throws(
    () =>
      f.app.inventory.recoverTransferLoss(f.actor, "over", {
        ...recovery,
        receiptRef: "FOUND-OVER",
        quantity: 2,
      }),
    { code: "QUANTITY" },
  );
  f.app.inventory.receiveTransfer(f.actor, "arrive", {
    transferId: tr.id,
    lineId: tr.lineId,
    quantity: 2,
    serial: null,
    receiptRef: "ARRIVED-REMAINDER",
    bin: "B-1",
    condition: "usable",
    reason: "The two unlost cartons arrived",
  });
  assert.equal(
    f.app.inventory.transfers(f.actor)[0]!.state,
    "reconciled-with-loss",
  );
  assert.equal(line().receivedQuantity, 3);
  assert.equal(line().remainingQuantity, 0);
  assert.equal(line().lostQuantity, 1);
  assert.equal(line().legacyReceived, false);
  const positions = f.app.inventory
    .stock(f.actor)
    .filter((u) => u.product_id === original.product_id);
  assert.equal(
    positions.reduce((sum, u) => sum + u.quantity, 0),
    5,
  );
  assert.equal(
    positions.reduce((sum, u) => sum + u.quantity * u.cost, 0),
    5000,
  );
  assert.equal(
    line().receivedQuantity + line().remainingQuantity + line().lostQuantity,
    4,
  );
  assert.equal(
    positions.reduce((sum, u) => sum + u.quantity * u.cost, 0) +
      line().lostQuantity * 1000,
    6000,
  );
  assert.equal(
    f.app.inventory.availability(f.actor, original.product_id, f.w1),
    2,
  );
  assert.equal(
    f.app.inventory.availability(f.actor, original.product_id, f.w2),
    2,
  );
  f.app.inventory.recoverTransferLoss(f.actor, "found-last", {
    ...recovery,
    receiptRef: "FOUND-2",
    condition: "damaged",
  });
  assert.equal(f.app.inventory.transfers(f.actor)[0]!.state, "received");
  assert.equal(line().receivedQuantity, 4);
  assert.equal(line().lossQuantity, 2);
  assert.equal(line().lostQuantity, 0);
  assert.equal(line().losses.length, 1);
  assert.equal(line().losses[0]!.recoveries.length, 2);
  assert.equal(
    f.app.inventory
      .stock(f.actor)
      .filter((u) => u.product_id === original.product_id)
      .reduce((sum, u) => sum + u.quantity * u.cost, 0),
    6000,
  );
  assert.equal(f.app.billing.invoices(f.actor).length, 0);
});

test("serial loss/recovery preserves identity, excludes lost stock and requires current administrator authority on new and cached results", (t) => {
  const f = fixture(t),
    u = f.app.inventory.trace(f.actor, "S3").unit;
  const tr = f.app.inventory.dispatchTransfer(f.actor, "dispatch", {
    unitId: u.id,
    quantity: 1,
    revision: u.revision,
    destinationId: f.w2,
    reason: "Synthetic serial relocation",
  });
  const payload = {
    transferId: tr.id,
    lineId: tr.lineId,
    revision: f.app.inventory.unit(f.actor, u.id).revision,
    quantity: 1,
    serial: "S3",
    lossRef: "SERIAL-LOSS",
    reason: "Investigation confirmed missing serial",
  };
  const warehouse = user(f, "warehouse");
  for (const actor of [warehouse, user(f, "support")])
    assert.throws(
      () => f.app.inventory.approveTransferLoss(actor, "loss", payload),
      { code: "FORBIDDEN" },
    );
  for (const [change, code] of [
    [{ serial: "S2" }, "SERIAL"],
    [{ quantity: 2 }, "QUANTITY"],
    [{ lineId: "unknown" }, "NOT_FOUND"],
    [{ reason: " " }, "VALIDATION"],
  ] as const)
    assert.throws(
      () =>
        f.app.inventory.approveTransferLoss(f.actor, "invalid", {
          ...payload,
          ...change,
        }),
      { code },
    );
  const loss = f.app.inventory.approveTransferLoss(f.actor, "loss", payload);
  assert.equal(f.app.inventory.trace(f.actor, "S3").unit.quantity, 0);
  assert.equal(
    f.app.inventory.transfers(f.actor)[0]!.state,
    "reconciled-with-loss",
  );
  assert.equal(
    f.app.inventory.transfers(f.actor)[0]!.lines[0]!.legacyReceived,
    false,
  );
  assert.throws(
    () => f.app.inventory.approveTransferLoss(warehouse, "loss", payload),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () =>
      f.app.inventory.approveTransferLoss(
        { ...f.actor, orgId: "foreign" },
        "loss",
        payload,
      ),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () =>
      f.app.inventory.receiveTransfer(f.actor, "ordinary-arrival", {
        transferId: tr.id,
        lineId: tr.lineId,
        quantity: 1,
        serial: "S3",
        receiptRef: "WRONG-ROUTE",
        bin: "B-1",
        condition: "usable",
        reason: "Must recover from loss rather than receive again",
      }),
    { code: "STATE" },
  );
  const found = {
    lossId: loss.lossId,
    quantity: 1,
    serial: "S3",
    receiptRef: "FOUND-S3",
    bin: "Q-1",
    condition: "quarantine" as const,
    reason: "Carrier found missing serialized carton",
  };
  assert.throws(
    () =>
      f.app.inventory.recoverTransferLoss(f.actor, "wrong", {
        ...found,
        serial: "S2",
      }),
    { code: "SERIAL" },
  );
  assert.throws(
    () =>
      f.app.inventory.recoverTransferLoss(f.actor, "over", {
        ...found,
        quantity: 2,
      }),
    { code: "QUANTITY" },
  );
  assert.throws(
    () =>
      f.app.inventory.recoverTransferLoss(
        { ...f.actor, orgId: "foreign" },
        "found",
        found,
      ),
    { code: "FORBIDDEN" },
  );
  const recovery = f.app.inventory.recoverTransferLoss(f.actor, "found", found);
  assert.equal(recovery.unitId, u.id);
  assert.throws(
    () => f.app.inventory.recoverTransferLoss(warehouse, "found", found),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () =>
      f.app.inventory.recoverTransferLoss(f.actor, "duplicate-serial", {
        ...found,
        receiptRef: "OTHER",
      }),
    { code: "QUANTITY" },
  );
  const trace = f.app.inventory.trace(f.actor, "S3");
  assert.equal(trace.unit.warehouse_id, f.w2);
  assert.equal(trace.unit.quantity, 1);
  assert.equal(trace.unit.condition, "quarantine");
  assert.equal(trace.unit.cost, 6000);
  assert.deepEqual(
    trace.movements
      .filter((m) => String(m.type).startsWith("transfer."))
      .map((m) => [m.type, m.quantity, m.unit_cost]),
    [
      ["transfer.dispatch", -1, 6000],
      ["transfer.loss", -1, 6000],
      ["transfer.recover", 1, 6000],
    ],
  );
  assert.equal(f.app.inventory.availability(f.actor, f.product, f.w2), 0);
  assert.equal(f.app.inventory.transfers(f.actor)[0]!.state, "received");
});

test(
  "separate-process arrival versus loss and competing recoveries cannot consume the same last transit or lost portion",
  { timeout: 10000 },
  async (t) => {
    const f = fixture(t),
      u = transferBulk(f, 2);
    const tr = f.app.inventory.dispatchTransfer(f.actor, "dispatch", {
      unitId: u.id,
      quantity: 2,
      revision: u.revision,
      destinationId: f.w2,
      reason: "Synthetic reconciliation race",
    });
    const children: ChildProcess[] = [];
    t.after(() => children.forEach((c) => c.kill()));
    const race = async (
      jobs: { operation: "receive" | "loss" | "recover"; payload: unknown }[],
    ) => {
      const group = jobs.map((job, i) => {
        const child = fork(
          new URL("./transfer-child.ts", import.meta.url),
          [],
          {
            execArgv: ["--import", "tsx"],
            stdio: ["ignore", "ignore", "pipe", "ipc"],
          },
        );
        children.push(child);
        let readyResolve: () => void;
        const ready = new Promise<void>((resolve) => {
          readyResolve = resolve;
        });
        const result = new Promise<{ ok: boolean; code?: string }>(
          (resolve, reject) => {
            let stderr = "";
            child.stderr?.on("data", (c) => {
              stderr += String(c);
            });
            child.on("error", reject);
            child.on("exit", (code) => {
              if (code !== 0)
                reject(
                  new Error(`Reconciliation child exit ${code}: ${stderr}`),
                );
            });
            child.on("message", (m: any) => {
              if (m.ready) readyResolve();
              else resolve(m);
            });
          },
        );
        child.send({
          action: "init",
          input: {
            path: f.path,
            actor: f.actor,
            key: `${job.operation}-${i}`,
            ...job,
          },
        });
        return { child, ready, result };
      });
      await Promise.all(group.map((j) => j.ready));
      group.forEach((j) => j.child.send({ action: "go" }));
      return Promise.all(group.map((j) => j.result));
    };
    const results = await race([
      {
        operation: "receive",
        payload: {
          transferId: tr.id,
          lineId: tr.lineId,
          quantity: 2,
          serial: null,
          receiptRef: "RACE-ARRIVAL",
          bin: "B-1",
          condition: "usable",
          reason: "Concurrent physical arrival",
        },
      },
      {
        operation: "loss",
        payload: {
          transferId: tr.id,
          lineId: tr.lineId,
          revision: f.app.inventory.unit(f.actor, tr.unitId).revision,
          quantity: 2,
          serial: null,
          lossRef: "RACE-LOSS",
          reason: "Concurrent loss approval",
        },
      },
    ]);
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(results.find((r) => !r.ok)?.code, "STATE");
    const first = f.app.inventory.transfers(f.actor)[0]!.lines[0]!;
    assert.equal(first.remainingQuantity, 0);
    assert.equal(first.receivedQuantity + first.lostQuantity, 2);
    assert.equal(first.receipts.length + first.losses.length, 1);
    // A distinct serial loss guarantees the recovery race runs regardless of which arrival/loss won.
    const serial = f.app.inventory.trace(f.actor, "S3").unit;
    const serialTr = f.app.inventory.dispatchTransfer(
      f.actor,
      "serial-dispatch",
      {
        unitId: serial.id,
        quantity: 1,
        revision: serial.revision,
        destinationId: f.w2,
        reason: "Synthetic recovery race",
      },
    );
    const loss = f.app.inventory.approveTransferLoss(f.actor, "serial-loss", {
      transferId: serialTr.id,
      lineId: serialTr.lineId,
      revision: f.app.inventory.unit(f.actor, serial.id).revision,
      quantity: 1,
      serial: "S3",
      lossRef: "SERIAL-RACE-LOSS",
      reason: "Missing before recovery contention",
    });
    const recovered = await race(
      [0, 1].map((i) => ({
        operation: "recover" as const,
        payload: {
          lossId: loss.lossId,
          quantity: 1,
          serial: "S3",
          receiptRef: `RECOVERY-${i}`,
          bin: "Q-1",
          condition: "quarantine",
          reason: "Concurrent found-serial processing",
        },
      })),
    );
    assert.equal(recovered.filter((r) => r.ok).length, 1);
    assert.equal(recovered.find((r) => !r.ok)?.code, "QUANTITY");
    assert.equal(
      f.app.inventory.transfers(f.actor).find((r) => r.id === serialTr.id)!
        .lines[0]!.losses[0]!.recoveries.length,
      1,
    );
    assert.equal(f.app.inventory.trace(f.actor, "S3").unit.quantity, 1);
  },
);
