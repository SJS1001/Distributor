import { fixture } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";

export async function binRelocationBrowser(after: (fn: () => void) => void) {
  const f = fixture({ after });
  f.app.identity.createUser(f.actor, "bin-worker", {
    email: "warehouse@example.test",
    name: "Synthetic bin worker",
    role: "warehouse",
    sites: [f.w1],
    password: "long-test-only-password",
  });
  const productId = f.app.catalog.create(f.actor, "bin-bulk", {
    sku: "BIN-MOVE-BULK",
    name: "Synthetic intact bin lot",
    serialized: false,
    unitPrice: 500,
    taxBasisPoints: 0,
  }).id;
  const poId = f.app.procurement.create(f.actor, "bin-po", {
    supplierId: f.supplier,
    warehouseId: f.w1,
    lines: [{ productId, quantity: 6, unitCost: 125 }],
  }).id;
  f.app.procurement.receive(f.actor, "bin-receive", {
    poId,
    lineId: String(f.app.procurement.order(f.actor, poId).lines[0]!.id),
    deliveryRef: "BIN-BULK",
    quantity: 6,
    serials: [],
    bin: "RECEIVING",
    quarantine: true,
  });
  const http = await createHttp(f.app, { origin: "http://127.0.0.1:3144" });
  await http.listen({ host: "127.0.0.1", port: 3144 });
  return http;
}
