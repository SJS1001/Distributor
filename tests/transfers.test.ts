import { test } from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { Inventory } from "../src/server/inventory.ts";
import { Application } from "../src/server/application.ts";
import type { Actor } from "../src/server/core.ts";
import { fixture } from "./fixtures.ts";

function warehouseUser(
  f: ReturnType<typeof fixture>,
  name: string,
  sites: string[],
) {
  const row = f.app.identity.createUser(f.actor, name, {
    name,
    email: `${name}@example.test`,
    password: "long-transfer-password",
    role: "warehouse",
    sites,
  });
  return f.app.identity.currentActor({ ...f.actor, id: row.id });
}
function grants(f: ReturnType<typeof fixture>, actor: Actor, sites: string[]) {
  const row = f.app.identity.users(f.actor).find((u) => u.id === actor.id)!;
  f.app.identity.updateUser(f.actor, `grant-${actor.id}-${row.revision}`, {
    userId: actor.id,
    revision: Number(row.revision),
    name: actor.name,
    email: String(row.email),
    role: "warehouse",
    sites,
    active: true,
    currentPassword: "long-test-only-password",
    reason: "Synthetic transfer access change",
  });
}

function bulk(f: ReturnType<typeof fixture>, quantity = 6) {
  const productId = f.app.catalog.create(f.actor, "transfer-bulk", {
    sku: "TR-1",
    name: "Synthetic transfer supplies",
    serialized: false,
    unitPrice: 2500,
    taxBasisPoints: 1300,
  }).id;
  const po = f.app.procurement.create(f.actor, "transfer-po", {
    supplierId: f.supplier,
    warehouseId: f.w1,
    lines: [{ productId, quantity, unitCost: 1000 }],
  }).id;
  const line = f.app.procurement.orders(f.actor).find((p) => p.id === po)!
    .lines[0]!;
  f.app.procurement.receive(f.actor, "transfer-stock", {
    poId: po,
    lineId: String(line.id),
    quantity,
    serials: [],
    deliveryRef: "TRANSFER-STOCK-1",
    bin: "A-2",
    quarantine: false,
  });
  return f.app.inventory
    .stock(f.actor)
    .find((u) => u.product_id === productId)!;
}

test("partial bulk arrivals survive restart, separate damaged/quarantine custody and conserve quantity/cost without duplicate business receipts", (t) => {
  const f = fixture(t),
    u = bulk(f);
  const transfer = f.app.inventory.dispatchTransfer(f.actor, "dispatch", {
    unitId: u.id,
    quantity: 4,
    revision: u.revision,
    destinationId: f.w2,
    reason: "Synthetic relocation",
  });
  const payload = {
    transferId: transfer.id,
    lineId: transfer.lineId,
    quantity: 2,
    serial: null,
    receiptRef: "ARRIVAL-USABLE",
    bin: "B-1",
    condition: "usable" as const,
    reason: "Two cartons arrived undamaged",
  };
  const received = f.app.inventory.receiveTransfer(f.actor, "arrive", payload);
  assert.equal(received.remainingQuantity, 2);
  assert.equal(f.app.inventory.availability(f.actor, u.product_id, f.w1), 2);
  assert.equal(f.app.inventory.availability(f.actor, u.product_id, f.w2), 2);
  assert.throws(
    () =>
      f.app.inventory.adjustCount(f.actor, "stale-count", {
        unitId: u.id,
        revision: u.revision,
        count: 6,
        reason: "Count started before dispatch",
      }),
    { code: "REVISION" },
  );
  assert.throws(
    () =>
      f.app.inventory.adjustCount(f.actor, "transit-count", {
        unitId: transfer.unitId,
        revision: f.app.inventory.unit(f.actor, transfer.unitId).revision,
        count: 3,
        reason: "Cannot count in-transit custody",
      }),
    { code: "STATE" },
  );
  assert.equal(f.app.inventory.unit(f.actor, transfer.unitId).state, "transit");
  const partial = f.app.inventory.transfers(f.actor)[0]!;
  assert.equal(partial.state, "partially-received");
  assert.equal(partial.lines[0]!.quantity, 4);
  assert.equal(partial.lines[0]!.receivedQuantity, 2);
  assert.equal(partial.lines[0]!.remainingQuantity, 2);
  assert.throws(
    () =>
      f.app.inventory.receiveTransfer(
        { ...f.actor, id: "absent-operator" },
        "new-key",
        payload,
      ),
    { code: "FORBIDDEN" },
  );
  const otherReceiver = warehouseUser(f, "destination-operator", [f.w2]);
  assert.deepEqual(
    f.app.inventory.receiveTransfer(otherReceiver, "new-key", payload),
    received,
  );
  assert.throws(
    () =>
      f.app.inventory.receiveTransfer(f.actor, "changed-ref", {
        ...payload,
        quantity: 1,
      }),
    { code: "RECEIPT_CONFLICT" },
  );
  assert.throws(
    () =>
      f.app.inventory.receiveTransfer(f.actor, "too-many", {
        ...payload,
        receiptRef: "OVER",
        quantity: 3,
      }),
    { code: "QUANTITY" },
  );
  assert.equal(
    f.app.inventory.transfers(f.actor)[0]!.lines[0]!.receipts.length,
    1,
  );
  f.app.close();
  f.app = new Application(f.path);
  const damaged = f.app.inventory.receiveTransfer(f.actor, "damaged", {
    ...payload,
    quantity: 1,
    receiptRef: "ARRIVAL-DAMAGED",
    bin: "D-1",
    condition: "damaged",
    reason: "Carton crushed in transit",
  });
  assert.equal(damaged.remainingQuantity, 1);
  const quarantined = f.app.inventory.receiveTransfer(f.actor, "quarantine", {
    ...payload,
    quantity: 1,
    receiptRef: "ARRIVAL-QUARANTINE",
    bin: "Q-1",
    condition: "quarantine",
    reason: "Inspect seal before sale",
  });
  assert.equal(quarantined.remainingQuantity, 0);
  assert.equal(f.app.inventory.transfers(f.actor)[0]!.state, "received");
  assert.deepEqual(
    f.app.inventory.receiveTransfer(f.actor, "after-closed", payload),
    received,
  );
  assert.throws(
    () =>
      f.app.inventory.receiveTransfer(f.actor, "extra", {
        ...payload,
        receiptRef: "EXTRA",
        quantity: 1,
      }),
    { code: "STATE" },
  );
  const stock = f.app.inventory
    .stock(f.actor)
    .filter((s) => s.product_id === u.product_id);
  assert.equal(
    stock.reduce((sum, s) => sum + s.quantity, 0),
    6,
  );
  assert.equal(
    stock.reduce((sum, s) => sum + s.quantity * s.cost, 0),
    6000,
  );
  assert.equal(
    stock
      .filter((s) => s.condition === "damaged")
      .reduce((sum, s) => sum + s.quantity, 0),
    1,
  );
  assert.equal(
    stock
      .filter((s) => s.condition === "quarantine")
      .reduce((sum, s) => sum + s.quantity, 0),
    1,
  );
  assert.equal(stock.filter((s) => s.state === "transit").length, 0);
  assert.equal(f.app.inventory.availability(f.actor, u.product_id, f.w2), 2);
  assert.equal(f.app.billing.invoices(f.actor).length, 0);
  const onward = f.app.inventory.unit(f.actor, received.unitId);
  f.app.inventory.dispatchTransfer(f.actor, "onward", {
    unitId: onward.id,
    quantity: 2,
    revision: onward.revision,
    destinationId: f.w1,
    reason: "Synthetic onward relocation",
  });
  const historical = f.app.inventory
    .transfers(f.actor)
    .find((tr) => tr.id === transfer.id)!.lines[0]!;
  assert.equal(historical.quantity, 4);
  assert.equal(historical.receivedQuantity, 4);
  assert.equal(historical.remainingQuantity, 0);
  assert.equal(historical.receipts.length, 3);
});

test("serialized arrivals require the exact scan, one unit, matching line and current destination grants even on retry", (t) => {
  const f = fixture(t),
    u = f.app.inventory.trace(f.actor, "S3").unit,
    sourceOnly = warehouseUser(f, "source-operator", [f.w1]);
  const dispatch = {
    unitId: u.id,
    quantity: 1,
    revision: u.revision,
    destinationId: f.w2,
    reason: "Synthetic serial relocation",
  };
  const transfer = f.app.inventory.dispatchTransfer(
    sourceOnly,
    "dispatch",
    dispatch,
  );
  const payload = {
    transferId: transfer.id,
    lineId: transfer.lineId,
    quantity: 1,
    serial: "S3",
    receiptRef: "SERIAL-ARRIVAL",
    bin: "B-1",
    condition: "quarantine" as const,
    reason: "Synthetic inspection required",
  };
  for (const [change, code] of [
    [{ serial: "S2" }, "SERIAL"],
    [{ serial: null }, "SERIAL"],
    [{ quantity: 2 }, "QUANTITY"],
    [{ quantity: 0 }, "VALIDATION"],
    [{ lineId: "foreign-line" }, "NOT_FOUND"],
  ] as const)
    assert.throws(
      () =>
        f.app.inventory.receiveTransfer(f.actor, "invalid", {
          ...payload,
          ...change,
        }),
      { code },
    );
  assert.deepEqual(
    f.app.inventory.transferDestinations(sourceOnly).map((w) => w.name),
    ["Ottawa", "Toronto"],
  );
  assert.equal(f.app.inventory.warehouses(sourceOnly).length, 1);
  assert.equal(
    f.app.inventory.stock(sourceOnly).some((s) => s.warehouse_id === f.w2),
    false,
  );
  assert.throws(
    () => f.app.inventory.receiveTransfer(sourceOnly, "receive", payload),
    { code: "FORBIDDEN" },
  );
  assert.equal(
    f.app.inventory.transfers(f.actor)[0]!.lines[0]!.receipts.length,
    0,
  );
  assert.equal(f.app.inventory.trace(f.actor, "S3").unit.state, "transit");
  assert.equal(f.app.inventory.availability(f.actor, f.product, f.w2), 0);
  const arrived = f.app.inventory.receiveTransfer(f.actor, "receive", payload);
  assert.deepEqual(
    f.app.inventory.dispatchTransfer(sourceOnly, "dispatch", dispatch),
    transfer,
  );
  grants(f, sourceOnly, [f.w2]);
  assert.throws(
    () =>
      f.app.inventory.dispatchTransfer(
        { ...sourceOnly, sites: [f.w1] },
        "dispatch",
        dispatch,
      ),
    { code: "FORBIDDEN" },
  );
  grants(f, sourceOnly, [f.w1]);
  assert.throws(
    () =>
      f.app.inventory.dispatchTransfer(sourceOnly, "dispatch", {
        ...dispatch,
        quantity: 2,
      }),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  assert.equal(arrived.unitId, u.id);
  assert.equal(
    f.app.inventory.trace(f.actor, "S3").unit.condition,
    "quarantine",
  );
  assert.equal(f.app.inventory.availability(f.actor, f.product, f.w2), 0);
  assert.throws(
    () => f.app.inventory.receiveTransfer(sourceOnly, "receive", payload),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () =>
      f.app.inventory.receiveTransfer(
        { ...f.actor, orgId: "other-org" },
        "receive",
        payload,
      ),
    { code: "FORBIDDEN" },
  );
});

test("synthetic Inventory transfer backfill reconstructs immutable quantities from dispatch movements and preserves unknown historical receipt evidence", (t) => {
  const f = fixture(t),
    u = bulk(f);
  const legacy = f.app.inventory.dispatchTransfer(f.actor, "legacy-transit", {
    unitId: u.id,
    quantity: 4,
    revision: u.revision,
    destinationId: f.w2,
    reason: "Historical fixture",
  });
  const serial = f.app.inventory.trace(f.actor, "S3").unit;
  const completed = f.app.inventory.dispatchTransfer(
    f.actor,
    "legacy-complete",
    {
      unitId: serial.id,
      quantity: 1,
      revision: serial.revision,
      destinationId: f.w2,
      reason: "Historical serial",
    },
  );
  // Emulate pre-portion storage: the old receiver wrote stock, a movement and the whole-line flags only.
  const store = f.app.database.owned("inventory");
  store.run(
    "UPDATE inventory_units SET warehouse_id=?,state='stock',revision=revision+1 WHERE id=?",
    f.w2,
    serial.id,
  );
  store.run(
    "UPDATE inventory_transfer_lines SET received=1 WHERE transfer_id=?",
    completed.id,
  );
  store.run(
    "UPDATE inventory_transfers SET state='received' WHERE id=?",
    completed.id,
  );
  store.migrate(
    "DROP TABLE inventory_transfer_receipts; DROP TABLE inventory_transfer_manifest;",
  );
  // Restore synthetic missing owned tables before startup validates the current schema.
  new Inventory(f.app.database, f.app.platform, f.app.catalog, f.app.identity);
  f.app.close();
  f.app = new Application(f.path);
  const rows = f.app.inventory.transfers(f.actor);
  const historical = rows.find((tr) => tr.id === completed.id)!.lines[0]!;
  assert.equal(historical.quantity, 1);
  assert.equal(historical.receivedQuantity, 1);
  assert.equal(historical.remainingQuantity, 0);
  assert.equal(historical.legacyReceived, true);
  assert.deepEqual(historical.receipts, []);
  const pending = rows.find((tr) => tr.id === legacy.id)!.lines[0]!;
  assert.equal(pending.quantity, 4);
  assert.equal(pending.remainingQuantity, 4);
  f.app.inventory.receiveTransfer(f.actor, "legacy-partial", {
    transferId: legacy.id,
    lineId: legacy.lineId,
    quantity: 1,
    serial: null,
    receiptRef: "LEGACY-NEW-ARRIVAL",
    bin: "B-1",
    condition: "usable",
    reason: "New evidence after upgrade",
  });
  f.app.close();
  f.app = new Application(f.path);
  assert.equal(
    f.app.inventory.transfers(f.actor).find((tr) => tr.id === legacy.id)!
      .lines[0]!.remainingQuantity,
    3,
  );
});

test(
  "separate processes race for the last in-transit portion: exactly one receipt commits",
  { timeout: 10000 },
  async (t) => {
    const f = fixture(t),
      u = bulk(f, 2);
    const transfer = f.app.inventory.dispatchTransfer(f.actor, "dispatch", {
      unitId: u.id,
      quantity: 2,
      revision: u.revision,
      destinationId: f.w2,
      reason: "Synthetic concurrent transfer",
    });
    const children: ChildProcess[] = [];
    t.after(() => children.forEach((child) => child.kill()));
    const jobs = [0, 1].map((i) => {
      const child = fork(new URL("./transfer-child.ts", import.meta.url), [], {
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      });
      children.push(child);
      let readyResolve: () => void,
        resultResolve: (r: { ok: boolean; code?: string }) => void;
      const ready = new Promise<void>((r) => (readyResolve = r));
      const result = new Promise<{ ok: boolean; code?: string }>(
        (resolve, reject) => {
          resultResolve = resolve;
          let stderr = "";
          child.stderr?.on("data", (c) => (stderr += String(c)));
          child.on("error", reject);
          child.on("exit", (code) => {
            if (code !== 0)
              reject(new Error(`Transfer child exit ${code}: ${stderr}`));
          });
        },
      );
      child.on("message", (m: any) =>
        m.ready ? readyResolve() : resultResolve(m),
      );
      child.send({
        action: "init",
        input: {
          path: f.path,
          actor: f.actor,
          key: `race-${i}`,
          payload: {
            transferId: transfer.id,
            lineId: transfer.lineId,
            quantity: 2,
            serial: null,
            receiptRef: `RACE-ARRIVAL-${i}`,
            bin: "B-1",
            condition: "usable",
            reason: "Synthetic simultaneous receivers",
          },
        },
      });
      return { ready, result };
    });
    await Promise.all(jobs.map((j) => j.ready));
    children.forEach((child) => child.send({ action: "go" }));
    const results = await Promise.all(jobs.map((j) => j.result));
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(results.find((r) => !r.ok)?.code, "STATE");
    const received = f.app.inventory.transfers(f.actor)[0]!;
    assert.equal(received.state, "received");
    assert.equal(received.lines[0]!.receipts.length, 1);
    assert.equal(f.app.inventory.availability(f.actor, u.product_id, f.w1), 0);
    assert.equal(f.app.inventory.availability(f.actor, u.product_id, f.w2), 2);
    assert.equal(
      f.app.inventory
        .stock(f.actor)
        .filter((s) => s.product_id === u.product_id)
        .reduce((sum, s) => sum + s.quantity * s.cost, 0),
      2000,
    );
  },
);
