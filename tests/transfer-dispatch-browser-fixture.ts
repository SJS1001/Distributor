import { fixture } from "./fixtures.ts";
import { createHttp } from "./browser-http.ts";

export async function transferDispatchBrowser(after: (fn: () => void) => void) {
  const f = fixture({ after });
  for (let i = 1; i <= 8; i++) {
    const productId = f.app.catalog.create(f.actor, `dispatch-product-${i}`, {
      sku: `DISPATCH-${i}`,
      name: `Synthetic dispatch lot ${i}`,
      serialized: false,
      unitPrice: 2500,
      taxBasisPoints: 1300,
    }).id;
    const poId = f.app.procurement.create(f.actor, `dispatch-po-${i}`, {
      supplierId: f.supplier,
      warehouseId: f.w1,
      lines: [{ productId, quantity: 6, unitCost: 1234 }],
    }).id;
    f.app.procurement.receive(f.actor, `dispatch-stock-${i}`, {
      poId,
      lineId: String(f.app.procurement.order(f.actor, poId).lines[0]!.id),
      quantity: 6,
      serials: [],
      deliveryRef: `SYNTHETIC-DISPATCH-STOCK-${i}`,
      bin: "A-1",
      quarantine: false,
    });
  }
  for (const [email, name] of [
    ["dispatch@example.test", "Synthetic source operator"],
    ["dispatch-other@example.test", "Synthetic second source operator"],
  ])
    f.app.identity.createUser(f.actor, `dispatch-user-${email}`, {
      email: email!,
      name: name!,
      role: "warehouse",
      sites: [f.w1],
      password: "long-test-only-password",
    });
  const http = await createHttp(f.app, { origin: "http://127.0.0.1:3162" });
  await http.listen({ host: "127.0.0.1", port: 3162 });
  return http;
}
