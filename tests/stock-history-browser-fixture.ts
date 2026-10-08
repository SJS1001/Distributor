import { fixture } from "./fixtures.ts";
import { createHttp } from "./browser-http.ts";

export async function stockHistoryBrowser(after: (fn: () => void) => void) {
  const f = fixture({ after });
  f.app.identity.createUser(f.actor, "history-browser-worker", {
    email: "warehouse@example.test",
    name: "Synthetic history worker",
    role: "warehouse",
    sites: [f.w1],
    password: "long-test-only-password",
  });
  const productId = f.app.catalog.create(f.actor, "history-browser-product", {
    sku: "HISTORY-BULK",
    name: "Synthetic bulk history",
    serialized: false,
    unitPrice: 400,
    taxBasisPoints: 0,
  }).id;
  const poId = f.app.procurement.create(f.actor, "history-browser-po", {
    supplierId: f.supplier,
    warehouseId: f.w1,
    lines: [{ productId, quantity: 6, unitCost: 125 }],
  }).id;
  f.app.procurement.receive(f.actor, "history-browser-receipt", {
    poId,
    lineId: String(f.app.procurement.order(f.actor, poId).lines[0]!.id),
    deliveryRef: "HISTORY-BULK-RECEIPT-" + "R".repeat(100),
    quantity: 6,
    serials: [],
    bin: "BULK-A",
    quarantine: true,
  });
  const unitId = f.app.inventory
    .stock(f.actor)
    .find((u) => u.product_id === productId)!.id;
  for (let n = 1; n <= 25; n++) {
    const u = f.app.inventory.unit(f.actor, unitId);
    f.app.inventory.relocate(f.actor, `history-browser-move-${n}`, {
      unitId,
      revision: u.revision,
      sourceBin: u.bin,
      bin: `HISTORY-${n}`,
      serial: null,
      reason: `Synthetic putaway ${n}`,
    });
  }
  const http = await createHttp(f.app, { origin: "http://127.0.0.1:3145" });
  await http.listen({ host: "127.0.0.1", port: 3145 });
  return http;
}
