import { fixture } from "./fixtures.ts";
import { createHttp } from "./browser-http.ts";

export async function countPolicyBrowser(after: (fn: () => void) => void) {
  const f = fixture({ after });
  f.app.identity.createUser(f.actor, "count-reviewer", {
    email: "count-reviewer@example.test",
    name: "Synthetic independent count reviewer",
    password: "long-test-only-password",
    role: "admin",
    sites: [],
  });
  const productId = f.app.catalog.create(f.actor, "count-ui-product", {
    sku: "COUNT-DUTIES-UI",
    name: "Synthetic count review lot",
    serialized: false,
    unitPrice: 500,
    taxBasisPoints: 0,
  }).id;
  const poId = f.app.procurement.create(f.actor, "count-ui-po", {
    supplierId: f.supplier,
    warehouseId: f.w1,
    lines: [{ productId, quantity: 6, unitCost: 125 }],
  }).id;
  const line = f.app.procurement.orders(f.actor).find((p) => p.id === poId)!
    .lines[0]!;
  f.app.procurement.receive(f.actor, "count-ui-receive", {
    poId,
    lineId: String(line.id),
    deliveryRef: "COUNT-UI-LOT",
    quantity: 6,
    serials: [],
    bin: "COUNT-UI",
    quarantine: false,
  });
  const http = await createHttp(f.app, { origin: "http://127.0.0.1:3128" });
  await http.listen({ host: "127.0.0.1", port: 3128 });
  return http;
}
