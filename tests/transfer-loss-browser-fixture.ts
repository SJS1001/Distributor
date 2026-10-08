import { fixture } from "./fixtures.ts";
import { createHttp } from "./browser-http.ts";

export async function transferLossBrowser(after: (fn: () => void) => void) {
  const f = fixture({ after });
  for (let i = 1; i <= 10; i++) {
    const productId = f.app.catalog.create(f.actor, `loss-product-${i}`, {
      sku: `LOSS-${i}`,
      name: `Synthetic loss lot ${i}`,
      serialized: false,
      unitPrice: 2500,
      taxBasisPoints: 1300,
    }).id;
    const poId = f.app.procurement.create(f.actor, `loss-po-${i}`, {
      supplierId: f.supplier,
      warehouseId: f.w1,
      lines: [{ productId, quantity: 6, unitCost: 1234 }],
    }).id;
    f.app.procurement.receive(f.actor, `loss-stock-${i}`, {
      poId,
      lineId: String(f.app.procurement.order(f.actor, poId).lines[0]!.id),
      quantity: 6,
      serials: [],
      deliveryRef: `SYNTHETIC-LOSS-STOCK-${i}`,
      bin: "A-1",
      quarantine: false,
    });
    const stock = f.app.inventory
      .stock(f.actor)
      .find((u) => u.product_id === productId)!;
    f.app.inventory.dispatchTransfer(f.actor, `loss-dispatch-${i}`, {
      unitId: stock.id,
      revision: stock.revision,
      quantity: 6,
      destinationId: f.w2,
      reason: "Synthetic loss recovery dispatch",
    });
  }
  const serial = f.app.inventory.stock(f.actor).find((u) => u.serial === "S1")!;
  f.app.inventory.dispatchTransfer(f.actor, "loss-serial-dispatch", {
    unitId: serial.id,
    revision: serial.revision,
    quantity: 1,
    destinationId: f.w2,
    reason: "Synthetic scanned loss dispatch",
  });
  for (const [email, name] of [
    ["loss@example.test", "Synthetic loss administrator"],
    ["loss-other@example.test", "Synthetic second loss administrator"],
  ])
    f.app.identity.createUser(f.actor, `loss-user-${email}`, {
      email: email!,
      name: name!,
      role: "admin",
      sites: [f.w1, f.w2],
      password: "long-test-only-password",
    });
  const http = await createHttp(f.app, { origin: "http://127.0.0.1:3163" });
  await http.listen({ host: "127.0.0.1", port: 3163 });
  return http;
}
