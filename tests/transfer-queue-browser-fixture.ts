import { fixture } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";

export async function transferQueueBrowser(after: (fn: () => void) => void) {
  const f = fixture({ after });
  const hidden = f.app.inventory.createWarehouse(f.actor, "queue-hidden-site", {
    name: "Synthetic restricted destination",
  }).id;
  const productId = f.app.catalog.create(f.actor, "queue-product", {
    sku: "TRANSFER-QUEUE",
    name: "Synthetic transfer queue supplies",
    serialized: false,
    unitPrice: 2500,
    taxBasisPoints: 1300,
  }).id;
  const poId = f.app.procurement.create(f.actor, "queue-po", {
    supplierId: f.supplier,
    warehouseId: f.w1,
    lines: [{ productId, quantity: 144, unitCost: 1000 }],
  }).id;
  const lineId = String(
    f.app.procurement.orders(f.actor).find((p) => p.id === poId)!.lines[0]!.id,
  );
  f.app.procurement.receive(f.actor, "queue-stock", {
    poId,
    lineId,
    quantity: 144,
    serials: [],
    deliveryRef: "SYNTHETIC-QUEUE-STOCK",
    bin: "A-1",
    quarantine: false,
  });
  const source = f.app.inventory
    .stock(f.actor)
    .find((u) => u.product_id === productId)!;
  const transfers = Array.from({ length: 48 }, (_, i) =>
    f.app.inventory.dispatchTransfer(f.actor, `queue-dispatch-${i}`, {
      unitId: source.id,
      quantity: 3,
      revision: f.app.inventory.unit(f.actor, source.id).revision,
      destinationId: i < 45 ? f.w2 : hidden,
      reason: "Synthetic queue dispatch",
    }),
  );
  const receive = (index: number, quantity: number) =>
    f.app.inventory.receiveTransfer(f.actor, `queue-arrival-${index}`, {
      transferId: transfers[index]!.id,
      lineId: transfers[index]!.lineId,
      quantity,
      serial: null,
      receiptRef: `SYNTHETIC-ARRIVAL-${index}`,
      bin: "B-1",
      condition: "usable",
      reason: "Synthetic arrival evidence",
    });
  receive(0, 3);
  receive(1, 1);
  const loss = (index: number, quantity: number) =>
    f.app.inventory.approveTransferLoss(f.actor, `queue-loss-${index}`, {
      transferId: transfers[index]!.id,
      lineId: transfers[index]!.lineId,
      quantity,
      revision: f.app.inventory.unit(f.actor, transfers[index]!.unitId)
        .revision,
      serial: null,
      lossRef: `SYNTHETIC-LOSS-${index}`,
      reason: "Synthetic retained loss evidence",
    });
  loss(2, 1);
  loss(3, 3);
  const recovered = loss(4, 3);
  f.app.inventory.recoverTransferLoss(f.actor, "queue-recovery", {
    lossId: recovered.lossId,
    quantity: 3,
    serial: null,
    receiptRef: "SYNTHETIC-FOUND",
    bin: "Q-1",
    condition: "quarantine",
    reason: "Synthetic recovery evidence",
  });
  // Freeze metadata to test tied-time traversal independently of clock speed.
  f.app.database
    .owned("inventory")
    .run(
      "UPDATE inventory_transfers SET created_at=? WHERE org_id=?",
      "2026-10-02T12:00:00.000Z",
      f.actor.orgId,
    );
  f.app.identity.createUser(f.actor, "transfer-queue-operator", {
    email: "transfer-queue@example.test",
    name: "Synthetic destination operator",
    password: "long-test-only-password",
    role: "warehouse",
    sites: [f.w2],
  });
  f.app.identity.createUser(f.actor, "transfer-queue-support", {
    email: "transfer-support@example.test",
    name: "Synthetic transfer support",
    password: "long-test-only-password",
    role: "support",
    sites: [f.w2],
  });
  f.app.identity.createUser(f.actor, "transfer-queue-restricted-support", {
    email: "transfer-restricted@example.test",
    name: "Synthetic restricted support",
    password: "long-test-only-password",
    role: "support",
    sites: [hidden],
  });
  const http = await createHttp(f.app, { origin: "http://127.0.0.1:3160" });
  await http.listen({ host: "127.0.0.1", port: 3160 });
  return http;
}
