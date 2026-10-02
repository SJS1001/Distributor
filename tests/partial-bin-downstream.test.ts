import { test } from "node:test";
import assert from "node:assert/strict";
import { Application } from "../src/server/application.ts";
import { fork, type ChildProcess } from "node:child_process";
import { fixture } from "./fixtures.ts";

type Fixture = ReturnType<typeof fixture>;

function receivedBulk(f: Fixture) {
  const productId = f.app.catalog.create(f.actor, "downstream-product", {
    sku: "SPLIT-DOWNSTREAM",
    name: "Synthetic bulk custody",
    serialized: false,
    unitPrice: 9999,
    taxBasisPoints: 0,
  }).id;
  const poId = f.app.procurement.create(f.actor, "downstream-po", {
    supplierId: f.supplier,
    warehouseId: f.w1,
    lines: [{ productId, quantity: 6, unitCost: 125 }],
  }).id;
  const lineId = String(f.app.procurement.order(f.actor, poId).lines[0]!.id);
  const receipt = f.app.procurement.receive(f.actor, "downstream-receipt", {
    poId,
    lineId,
    quantity: 6,
    serials: [],
    deliveryRef: "SPLIT-DOWNSTREAM-DELIVERY",
    bin: "RECEIVING",
    quarantine: false,
  });
  return {
    productId,
    poId,
    receiptId: receipt.id,
    unitId: receipt.unitIds[0]!,
  };
}

function split(f: Fixture, unitId: string, quantity: number, bin: string) {
  const unit = f.app.inventory.unit(f.actor, unitId);
  return f.app.inventory.relocate(f.actor, `split-${bin}`, {
    unitId,
    revision: unit.revision,
    sourceBin: unit.bin,
    bin,
    quantity,
    serial: null,
    reason: "Synthetic partial bulk putaway",
  });
}

function returnInput(
  f: Fixture,
  receiptId: string,
  unitId: string,
  ref: string,
) {
  return {
    receiptId,
    unitId,
    revision: f.app.inventory.unit(f.actor, unitId).revision,
    quantity: 1,
    serial: null,
    returnRef: ref,
    reason: "Synthetic supplier-approved defect",
    handoverEvidence: `Synthetic custody receipt ${ref}`,
  };
}

for (const region of ["CA", "US"] as const) {
  test(`${region} split lots share the original supplier return limit even after independent count gains`, (t) => {
    const f = fixture(t, {}, region),
      b = receivedBulk(f);
    const moved = split(f, b.unitId, 4, "RETURN-BIN");
    const returned = f.app.procurement.returnStock(f.actor, "first-return", {
      ...returnInput(f, b.receiptId, moved.id, "FOUR-MOVED"),
      quantity: 4,
    });
    assert.equal(returned.value, 500);
    const remainder = f.app.inventory.unit(f.actor, b.unitId);
    f.app.inventory.adjustCount(f.actor, "found-at-source", {
      unitId: remainder.id,
      revision: remainder.revision,
      count: 3,
      reason: "Synthetic independently observed one-unit count gain",
    });
    f.app.close();
    f.app = new Application(f.path, region);
    const excess = {
      ...returnInput(f, b.receiptId, b.unitId, "OVER-ORIGINAL"),
      quantity: 3,
    };
    const stockBefore = f.app.inventory.stock(f.actor),
      costsBefore = f.app.inventory.costs.window(f.actor, 0);
    assert.throws(
      () => f.app.procurement.returnStock(f.actor, "excess-return", excess),
      { code: "QUANTITY" },
    );
    assert.deepEqual(f.app.inventory.stock(f.actor), stockBefore);
    assert.deepEqual(f.app.inventory.costs.window(f.actor, 0), costsBefore);
    f.app.procurement.returnStock(f.actor, "remaining-return", {
      ...excess,
      quantity: 2,
      returnRef: "TWO-REMAINING",
    });
    assert.throws(
      () =>
        f.app.procurement.returnStock(
          f.actor,
          "count-gain-return",
          returnInput(f, b.receiptId, b.unitId, "COUNT-GAIN-ONLY"),
        ),
      { code: "QUANTITY" },
    );
    const history = f.app.procurement
      .receipts(f.actor)
      .find((r) => r.id === b.receiptId)!;
    assert.deepEqual([history.quantity, history.returnedQuantity], [6, 6]);
    assert.equal(f.app.inventory.unit(f.actor, b.unitId).quantity, 1);
    assert.equal(f.app.inventory.controlTotals(f.actor).value, "18125");
    assert.equal(f.app.inventory.costs.window(f.actor, 0).closingValue, 18125);
    assert.deepEqual(
      f.app.procurement
        .returns(f.actor)
        .map((r) => r.quantity)
        .sort(),
      [2, 4],
    );
    assert.deepEqual(
      f.app.procurement.returnStock(f.actor, "first-return", {
        ...returnInput(f, b.receiptId, moved.id, "FOUR-MOVED"),
        revision: 1,
        quantity: 4,
      }),
      returned,
    );
  });

  test(`${region} destination-only warehouse readers see only their split descendants and fresh authority governs cached handovers`, (t) => {
    const f = fixture(t, {}, region),
      b = receivedBulk(f);
    const moved = split(f, b.unitId, 4, "B-1");
    const tr = f.app.inventory.dispatchTransfer(
      f.actor,
      "destination-transfer",
      {
        unitId: moved.id,
        revision: f.app.inventory.unit(f.actor, moved.id).revision,
        quantity: 2,
        destinationId: f.w2,
        reason: "Synthetic split-stock transfer",
      },
    );
    const arrival = f.app.inventory.receiveTransfer(
      f.actor,
      "destination-arrival",
      {
        transferId: tr.id,
        lineId: tr.lineId,
        quantity: 2,
        serial: null,
        receiptRef: "DESTINATION",
        bin: "DESTINATION",
        condition: "usable",
        reason: "Synthetic destination receipt",
      },
    );
    const created = f.app.identity.createUser(f.actor, "destination-reader", {
      email: "destination-reader@example.test",
      name: "Synthetic destination reader",
      password: "long-test-only-password",
      role: "warehouse",
      sites: [f.w2],
    });
    const reader = f.app.identity.currentActor({ ...f.actor, id: created.id });
    const receipt = f.app.procurement
      .receipts(reader)
      .find((r) => r.id === b.receiptId)!;
    assert.ok(
      receipt,
      "Original receipt is discoverable through destination custody",
    );
    assert.deepEqual(
      receipt.candidates.map((c) => [c.id, c.quantity, c.cost, c.warehouse_id]),
      [[arrival.unitId, 2, 125, f.w2]],
    );
    assert.equal(
      f.app.inventory.purchaseOrigin(reader, arrival.unitId),
      b.receiptId,
    );
    assert.throws(() => f.app.inventory.purchaseOrigin(reader, b.unitId), {
      code: "FORBIDDEN",
    });
    const input = returnInput(
      f,
      b.receiptId,
      arrival.unitId,
      "DESTINATION-HANDOVER",
    );
    assert.throws(
      () => f.app.procurement.returnStock(reader, "reader-handover", input),
      { code: "FORBIDDEN" },
    );
    const createdAdmin = f.app.identity.createUser(f.actor, "handover-admin", {
      email: "handover-admin@example.test",
      name: "Synthetic handover administrator",
      password: "long-test-only-password",
      role: "admin",
      sites: [],
    });
    const admin = f.app.identity.currentActor({
      ...f.actor,
      id: createdAdmin.id,
    });
    const result = f.app.procurement.returnStock(
      admin,
      "destination-handover",
      input,
    );
    const change = (id: string, role: "warehouse", sites: string[]) => {
      const row = f.app.identity.users(f.actor).find((u) => u.id === id)!;
      f.app.identity.updateUser(f.actor, `change-${id}`, {
        userId: id,
        revision: Number(row.revision),
        name: String(row.name),
        email: String(row.email),
        role,
        sites,
        active: true,
        currentPassword: "long-test-only-password",
        reason: "Synthetic current grant change",
      });
    };
    change(reader.id, "warehouse", [f.w1]);
    change(admin.id, "warehouse", [f.w2]);
    f.app.close();
    f.app = new Application(f.path, region);
    assert.equal(
      f.app.procurement
        .receipts(reader)
        .find((r) => r.id === b.receiptId)!
        .candidates.some((c) => c.id === arrival.unitId),
      false,
    );
    assert.throws(
      () => f.app.inventory.purchaseOrigin(reader, arrival.unitId),
      { code: "FORBIDDEN" },
    );
    const before = f.app.inventory.stock(f.actor);
    assert.throws(
      () => f.app.procurement.returnStock(admin, "destination-handover", input),
      { code: "FORBIDDEN" },
    );
    assert.throws(
      () => f.app.procurement.returnStock(admin, "different-key", input),
      { code: "FORBIDDEN" },
    );
    assert.deepEqual(
      f.app.procurement.returnStock(f.actor, "authorized-recovery", input),
      result,
    );
    assert.deepEqual(f.app.inventory.stock(f.actor), before);
    assert.equal(f.app.procurement.returns(f.actor).length, 1);
    assert.equal(f.app.inventory.controlTotals(f.actor).value, "18625");
  });

  test(
    `${region} independent supplier handovers from split lots cannot exceed shared receipt capacity`,
    { timeout: 15000 },
    async (t) => {
      const f = fixture(t, {}, region),
        b = receivedBulk(f),
        moved = split(f, b.unitId, 4, "RACE-BIN");
      const source = f.app.inventory.unit(f.actor, b.unitId);
      f.app.inventory.adjustCount(f.actor, "race-gain", {
        unitId: source.id,
        revision: source.revision,
        count: 3,
        reason:
          "Synthetic independently counted gain before competing handovers",
      });
      const payloads = [
        {
          ...returnInput(f, b.receiptId, b.unitId, "RACE-SOURCE"),
          quantity: 3,
        },
        {
          ...returnInput(f, b.receiptId, moved.id, "RACE-DESTINATION"),
          quantity: 4,
        },
      ];
      const children: ChildProcess[] = [];
      t.after(() => children.forEach((child) => child.kill()));
      const ready: Promise<void>[] = [],
        outcomes: Promise<{ ok: boolean; code?: string }>[] = [];
      for (let i = 0; i < 2; i++) {
        const child = fork(
          new URL("./supplier-return-child.ts", import.meta.url),
          [],
          {
            execArgv: ["--import", "tsx"],
            stdio: ["ignore", "ignore", "pipe", "ipc"],
          },
        );
        children.push(child);
        let onReady!: () => void,
          onResult!: (r: { ok: boolean; code?: string }) => void,
          failReady!: (e: Error) => void,
          failResult!: (e: Error) => void;
        ready.push(
          new Promise((resolve, reject) => {
            onReady = resolve;
            failReady = reject;
          }),
        );
        outcomes.push(
          new Promise((resolve, reject) => {
            onResult = resolve;
            failResult = reject;
          }),
        );
        let received = false,
          stderr = "";
        const fail = (error: Error) => {
          failReady(error);
          failResult(error);
        };
        child.stderr?.on("data", (chunk) => {
          stderr += String(chunk);
        });
        child.on("error", fail);
        child.on("exit", (code) => {
          if (!received)
            fail(Error(`Supplier handover child exited ${code}: ${stderr}`));
        });
        child.on("message", (message: any) => {
          if (message.ready) onReady();
          else {
            received = true;
            onResult(message);
          }
        });
        child.send({
          action: "init",
          input: {
            path: f.path,
            region,
            actor: f.actor,
            key: `race-return-${i}`,
            operation: "return",
            payload: payloads[i],
          },
        });
      }
      await Promise.all(ready);
      children.forEach((child) => child.send({ action: "go" }));
      const results = await Promise.all(outcomes);
      assert.equal(results.filter((r) => r.ok).length, 1);
      assert.equal(results.find((r) => !r.ok)!.code, "QUANTITY");
      const returnedQuantity = results[0]!.ok ? 3 : 4;
      assert.equal(f.app.procurement.returns(f.actor).length, 1);
      assert.equal(
        f.app.procurement.receipts(f.actor).find((r) => r.id === b.receiptId)!
          .returnedQuantity,
        returnedQuantity,
      );
      assert.equal(
        f.app.inventory
          .stock(f.actor)
          .filter((u) => u.product_id === b.productId)
          .reduce((s, u) => s + u.quantity, 0),
        results[0]!.ok ? 4 : 3,
      );
      assert.equal(
        f.app.inventory.costs.window(f.actor, 0).closingValue,
        results[0]!.ok ? 18500 : 18375,
      );
      f.app.close();
      f.app = new Application(f.path, region);
      assert.equal(
        f.app.inventory.controlTotals(f.actor).value,
        results[0]!.ok ? "18500" : "18375",
      );
      const winningIndex = results[0]!.ok ? 0 : 1;
      f.app.procurement.returnStock(
        f.actor,
        "winning-handover-retry",
        payloads[winningIndex]!,
      );
      assert.equal(f.app.procurement.returns(f.actor).length, 1);
    },
  );

  test(`${region} repeated bin splits, partial transfer, loss recovery and supplier returns conserve receipt, quantity and original-cost journals`, (t) => {
    const f = fixture(t, {}, region),
      b = receivedBulk(f);
    const first = split(f, b.unitId, 4, "B-1");
    const second = split(f, first.id, 3, "B-2");
    const dispatchInput = {
      unitId: second.id,
      revision: f.app.inventory.unit(f.actor, second.id).revision,
      quantity: 2,
      destinationId: f.w2,
      reason: "Synthetic onward transfer after putaway",
    };
    const tr = f.app.inventory.dispatchTransfer(
      f.actor,
      "onward",
      dispatchInput,
    );
    const arrivalInput = {
      transferId: tr.id,
      lineId: tr.lineId,
      quantity: 1,
      serial: null,
      receiptRef: "DOWNSTREAM-ARRIVAL",
      bin: "DESTINATION-DAMAGED",
      condition: "damaged" as const,
      reason: "Synthetic damaged partial arrival",
    };
    const arrived = f.app.inventory.receiveTransfer(
      f.actor,
      "arrived",
      arrivalInput,
    );
    const lossInput = {
      transferId: tr.id,
      lineId: tr.lineId,
      revision: f.app.inventory.unit(f.actor, tr.unitId).revision,
      quantity: 1,
      serial: null,
      lossRef: "DOWNSTREAM-LOSS",
      reason: "Synthetic investigated one-unit shortage",
    };
    const loss = f.app.inventory.approveTransferLoss(
      f.actor,
      "lost",
      lossInput,
    );
    assert.equal(f.app.inventory.controlTotals(f.actor).value, "18625");
    const recoveryInput = {
      lossId: loss.lossId,
      quantity: 1,
      serial: null,
      receiptRef: "DOWNSTREAM-FOUND",
      bin: "DESTINATION-QUARANTINE",
      condition: "quarantine" as const,
      reason: "Synthetic later recovered defective carton",
    };
    const recovered = f.app.inventory.recoverTransferLoss(
      f.actor,
      "found",
      recoveryInput,
    );
    assert.equal(f.app.inventory.controlTotals(f.actor).value, "18750");
    assert.equal(
      f.app.inventory.transfers(f.actor).find((x) => x.id === tr.id)!.state,
      "received",
    );
    const ids = [
      b.unitId,
      first.id,
      second.id,
      arrived.unitId,
      recovered.unitId,
    ];
    for (const id of ids)
      assert.equal(f.app.inventory.purchaseOrigin(f.actor, id), b.receiptId);
    assert.deepEqual(
      ids.map((id) => f.app.inventory.unit(f.actor, id).quantity),
      [2, 1, 1, 1, 1],
    );
    assert.deepEqual(
      [arrived.unitId, recovered.unitId].map(
        (id) => f.app.inventory.unit(f.actor, id).condition,
      ),
      ["damaged", "quarantine"],
    );
    f.app.close();
    f.app = new Application(f.path, region);
    assert.deepEqual(
      f.app.inventory.dispatchTransfer(f.actor, "onward", dispatchInput),
      tr,
    );
    assert.deepEqual(
      f.app.inventory.receiveTransfer(f.actor, "arrived-again", arrivalInput),
      arrived,
    );
    assert.deepEqual(
      f.app.inventory.approveTransferLoss(f.actor, "lost-again", lossInput),
      loss,
    );
    assert.deepEqual(
      f.app.inventory.recoverTransferLoss(
        f.actor,
        "found-again",
        recoveryInput,
      ),
      recovered,
    );
    const inputs = [arrived.unitId, recovered.unitId, b.unitId].map((id, i) =>
      returnInput(f, b.receiptId, id, `DOWNSTREAM-RETURN-${i}`),
    );
    const results = inputs.map((input) =>
      f.app.procurement.returnStock(f.actor, input.returnRef, input),
    );
    assert.deepEqual(
      results.map((r) => [r.quantity, r.unitCost, r.value]),
      [
        [1, 125, 125],
        [1, 125, 125],
        [1, 125, 125],
      ],
    );
    assert.equal(f.app.inventory.controlTotals(f.actor).value, "18375");
    assert.equal(f.app.inventory.controlTotals(f.actor).issues.count, 0);
    const history = f.app.procurement
      .receipts(f.actor)
      .find((r) => r.id === b.receiptId)!;
    assert.deepEqual([history.quantity, history.returnedQuantity], [6, 3]);
    assert.deepEqual(
      history.candidates
        .map((c) => [c.quantity, c.cost, c.warehouse_id])
        .sort(),
      [
        [1, 125, f.w1],
        [1, 125, f.w1],
        [1, 125, f.w1],
      ].sort(),
    );
    assert.equal(f.app.procurement.order(f.actor, b.poId).state, "received");
    assert.equal(
      f.app.procurement.order(f.actor, b.poId).lines[0]!.received,
      6,
    );
    const source = f.app.integration.costs.source(f.actor);
    assert.deepEqual(
      [
        source.movements.length,
        source.increase,
        source.decrease,
        source.closingValue,
      ],
      [15, 18875, 500, 18375],
    );
    assert.deepEqual(
      source.movements
        .filter((m) => m.productId === b.productId)
        .map((m) => [m.type, m.quantity, m.unitCost, m.valueDelta]),
      [
        ["receipt", 6, 125, 750],
        ["relocation.split.out", -4, 125, 0],
        ["relocation.split.in", 4, 125, 0],
        ["relocation.split.out", -3, 125, 0],
        ["relocation.split.in", 3, 125, 0],
        ["transfer.dispatch", -2, 125, 0],
        ["transfer.receive", 1, 125, 0],
        ["transfer.loss", -1, 125, -125],
        ["transfer.recover", 1, 125, 125],
        ["supplier.return", -1, 125, -125],
        ["supplier.return", -1, 125, -125],
        ["supplier.return", -1, 125, -125],
      ],
    );
    const prepared = f.app.integration.costs.prepare(
      f.actor,
      "downstream-costs",
      {
        version: 1,
        batchRef: "DOWNSTREAM-COSTS",
        afterSequence: 0,
        throughSequence: source.throughSequence,
        inventoryAccount: "1200",
        mappings: [
          { type: "receipt", offsetAccount: "2100" },
          { type: "transfer.loss", offsetAccount: "5000" },
          { type: "transfer.recover", offsetAccount: "5000" },
          { type: "supplier.return", offsetAccount: "2100" },
        ],
        expectedMovements: 15,
        expectedIncrease: 18875,
        expectedDecrease: 500,
        expectedOpeningValue: 0,
        expectedClosingValue: 18375,
        acknowledgment:
          "Synthetic independent original-cost review; no receiver acceptance claimed",
      },
    );
    assert.equal(prepared.state, "ready");
    const approved = f.app.integration.costs.decide(
      f.actor,
      "downstream-costs-approve",
      {
        packetId: prepared.id,
        reviewHash: prepared.reviewHash,
        decision: "approve",
        reason:
          "Synthetic six-unit custody and three-unit supplier handover review",
      },
    );
    assert.deepEqual(
      [
        approved.region,
        approved.currency,
        approved.controls.debit,
        approved.controls.credit,
        approved.receipt,
      ],
      [region, region === "CA" ? "CAD" : "USD", 19375, 19375, null],
    );
    const file = f.app.integration.costs.download(f.actor, approved.id);
    const journal = f.app.integration.costs.detail(f.actor, approved.id).report
      .journal;
    assert.equal(journal.length, 18);
    assert.deepEqual(
      journal.slice(-6).map((l) => [l.account, l.debit, l.credit]),
      [
        ["1200", 0, 125],
        ["2100", 125, 0],
        ["1200", 0, 125],
        ["2100", 125, 0],
        ["1200", 0, 125],
        ["2100", 125, 0],
      ],
    );
    const beforeCredit = f.app.inventory.stock(f.actor);
    const creditInput = {
      returnId: results[0]!.id,
      revision: 0,
      reference: "DOWNSTREAM-SUPPLIER-CREDIT",
      evidence:
        "Synthetic credit note with separately reviewed five-cent difference",
      amount: 130,
      currency: region === "CA" ? "CAD" : "USD",
    };
    const credit = f.app.procurement.followups.credit(
      f.actor,
      "downstream-credit",
      creditInput,
    );
    assert.deepEqual(
      [
        f.app.procurement.followups.summary(f.actor, results[0]!.id)
          .originalCost,
        f.app.procurement.followups.summary(f.actor, results[0]!.id)
          .creditAmount,
      ],
      [125, 130],
    );
    assert.deepEqual(f.app.inventory.stock(f.actor), beforeCredit);
    assert.deepEqual(f.app.billing.invoices(f.actor), []);
    assert.deepEqual(f.app.billing.credits(f.actor), []);
    f.app.close();
    f.app = new Application(f.path, region);
    inputs.forEach((input, i) =>
      assert.deepEqual(
        f.app.procurement.returnStock(f.actor, `after-restart-${i}`, input),
        results[i],
      ),
    );
    assert.deepEqual(
      f.app.procurement.followups.credit(f.actor, "credit-again", creditInput),
      credit,
    );
    assert.deepEqual(
      f.app.integration.costs.download(f.actor, approved.id),
      file,
    );
    assert.equal(f.app.inventory.controlTotals(f.actor).value, "18375");
    assert.equal(f.app.procurement.returns(f.actor).length, 3);
    assert.equal(f.app.inventory.costs.window(f.actor, 0).movements.length, 15);
  });
}
