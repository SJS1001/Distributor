import { fixture } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";
const cleanup: (() => void)[] = [];
const f = fixture({ after: (fn) => cleanup.push(fn) });
for (const [sku, serialized] of [
  ["OPEN-S", true],
  ["OPEN-B", false],
] as const) {
  f.app.catalog.create(f.actor, `opening-${sku}`, {
    sku,
    name: `Synthetic opening ${sku}`,
    serialized,
    unitPrice: 10000,
    taxBasisPoints: 1300,
  });
}
const product = f.app.catalog.create(f.actor, "bulk", {
  sku: "SUP-1",
  name: "Synthetic supplies",
  serialized: false,
  unitPrice: 2500,
  taxBasisPoints: 1300,
}).id;
const po = f.app.procurement.create(f.actor, "bulk-po", {
  supplierId: f.supplier,
  warehouseId: f.w1,
  lines: [{ productId: product, quantity: 5, unitCost: 1000 }],
}).id;
const line = f.app.procurement.orders(f.actor).find((p) => p.id === po)!
  .lines[0]!;
f.app.procurement.receive(f.actor, "bulk-receipt", {
  poId: po,
  lineId: String(line.id),
  deliveryRef: "BULK-1",
  quantity: 5,
  serials: [],
  bin: "C-1",
  quarantine: false,
});
const transferProduct = f.app.catalog.create(f.actor, "transfer-product", {
  sku: "TR-1",
  name: "Synthetic transfer supplies",
  serialized: false,
  unitPrice: 2500,
  taxBasisPoints: 1300,
}).id;
const transferPo = f.app.procurement.create(f.actor, "transfer-po", {
  supplierId: f.supplier,
  warehouseId: f.w1,
  lines: [{ productId: transferProduct, quantity: 6, unitCost: 1000 }],
}).id;
f.app.procurement.receive(f.actor, "transfer-receipt", {
  poId: transferPo,
  lineId: String(
    f.app.procurement.orders(f.actor).find((p) => p.id === transferPo)!
      .lines[0]!.id,
  ),
  deliveryRef: "TRANSFER-STOCK-1",
  quantity: 6,
  serials: [],
  bin: "T-1",
  quarantine: false,
});
const lossProduct = f.app.catalog.create(f.actor, "loss-product", {
  sku: "LOSS-1",
  name: "Synthetic reconciliation supplies",
  serialized: false,
  unitPrice: 2500,
  taxBasisPoints: 1300,
}).id;
const lossPo = f.app.procurement.create(f.actor, "loss-po", {
  supplierId: f.supplier,
  warehouseId: f.w1,
  lines: [{ productId: lossProduct, quantity: 4, unitCost: 1000 }],
}).id;
f.app.procurement.receive(f.actor, "loss-receipt", {
  poId: lossPo,
  lineId: String(
    f.app.procurement.orders(f.actor).find((p) => p.id === lossPo)!.lines[0]!
      .id,
  ),
  deliveryRef: "LOSS-STOCK-1",
  quantity: 4,
  serials: [],
  bin: "L-1",
  quarantine: false,
});
const countProduct = f.app.catalog.create(f.actor, "count-product", {
  sku: "COUNT-1",
  name: "Synthetic count supplies",
  serialized: false,
  unitPrice: 2500,
  taxBasisPoints: 1300,
}).id;
const countPo = f.app.procurement.create(f.actor, "count-po", {
  supplierId: f.supplier,
  warehouseId: f.w1,
  lines: [{ productId: countProduct, quantity: 6, unitCost: 1000 }],
}).id;
f.app.procurement.receive(f.actor, "count-receipt", {
  poId: countPo,
  lineId: String(
    f.app.procurement.orders(f.actor).find((p) => p.id === countPo)!.lines[0]!
      .id,
  ),
  deliveryRef: "COUNT-STOCK-1",
  quantity: 6,
  serials: [],
  bin: "COUNT-1",
  quarantine: false,
});
const returnProduct = f.app.catalog.create(f.actor, "return-product", {
  sku: "SUPRET-1",
  name: "Synthetic supplier return supplies",
  serialized: false,
  unitPrice: 2500,
  taxBasisPoints: 1300,
}).id;
const returnPo = f.app.procurement.create(f.actor, "return-po", {
  supplierId: f.supplier,
  warehouseId: f.w1,
  lines: [{ productId: returnProduct, quantity: 6, unitCost: 1000 }],
}).id;
f.app.procurement.receive(f.actor, "return-receipt", {
  poId: returnPo,
  lineId: String(
    f.app.procurement.orders(f.actor).find((p) => p.id === returnPo)!.lines[0]!
      .id,
  ),
  deliveryRef: "SUPPLIER-RETURN-STOCK",
  quantity: 6,
  serials: [],
  bin: "RET-1",
  quarantine: false,
});
for (const [name, warehouseId] of [
  ["source", f.w1],
  ["destination", f.w2],
] as const) {
  f.app.identity.createUser(f.actor, `operator-${name}`, {
    name: `Synthetic ${name} operator`,
    email: `${name}@example.test`,
    password: "long-warehouse-test-password",
    role: "warehouse",
    sites: [warehouseId],
  });
}
const http = await createHttp(f.app, { origin: "http://127.0.0.1:3117" });
await http.listen({ host: "127.0.0.1", port: 3117 });
const stop = async () => {
  await http.close();
  cleanup.forEach((fn) => fn());
  process.exit(0);
};
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
