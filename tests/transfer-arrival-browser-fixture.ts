import { fixture } from "./fixtures.ts";
import { createHttp } from "./browser-http.ts";

export async function transferArrivalBrowser(
  after: (fn: () => void) => void,
  port = 3161,
) {
  const f = fixture({ after });
  for (let i = 1; i <= 8; i++) {
    const productId = f.app.catalog.create(f.actor, `arrival-product-${i}`, {
      sku: `ARRIVAL-${i}`,
      name: `Synthetic arrival lot ${i}`,
      serialized: false,
      unitPrice: 2500,
      taxBasisPoints: 1300,
    }).id;
    const poId = f.app.procurement.create(f.actor, `arrival-po-${i}`, {
      supplierId: f.supplier,
      warehouseId: f.w1,
      lines: [{ productId, quantity: 6, unitCost: 1234 }],
    }).id;
    f.app.procurement.receive(f.actor, `arrival-stock-${i}`, {
      poId,
      lineId: String(f.app.procurement.order(f.actor, poId).lines[0]!.id),
      quantity: 6,
      serials: [],
      deliveryRef: `SYNTHETIC-ARRIVAL-STOCK-${i}`,
      bin: "A-1",
      quarantine: false,
    });
    const stock = f.app.inventory
      .stock(f.actor)
      .find((u) => u.product_id === productId)!;
    f.app.inventory.dispatchTransfer(f.actor, `arrival-dispatch-${i}`, {
      unitId: stock.id,
      revision: stock.revision,
      quantity: 6,
      destinationId: f.w2,
      reason: "Synthetic arrival recovery dispatch",
    });
  }
  const serial = f.app.inventory.stock(f.actor).find((u) => u.serial === "S1")!;
  f.app.inventory.dispatchTransfer(f.actor, "arrival-serial-dispatch", {
    unitId: serial.id,
    revision: serial.revision,
    quantity: 1,
    destinationId: f.w2,
    reason: "Synthetic scanned arrival dispatch",
  });
  for (const [email, name] of [
    ["arrival@example.test", "Synthetic destination operator"],
    ["arrival-other@example.test", "Synthetic second destination operator"],
  ])
    f.app.identity.createUser(f.actor, `arrival-user-${email}`, {
      email: email!,
      name: name!,
      role: "warehouse",
      sites: [f.w2],
      password: "long-test-only-password",
    });
  const http = await createHttp(f.app, { origin: `http://127.0.0.1:${port}` });
  await http.listen({ host: "127.0.0.1", port });
  return http;
}
