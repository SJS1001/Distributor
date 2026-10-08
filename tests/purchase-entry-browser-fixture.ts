import { fixture } from "./fixtures.ts";
import { createHttp } from "./browser-http.ts";

export async function purchaseEntryBrowser(after: (fn: () => void) => void) {
  const f = fixture({ after });
  for (let n = 0; n < 43; n++)
    f.app.procurement.supplier(f.actor, `search-supplier-${n}`, {
      name: `Z Supplier ${String(n).padStart(2, "0")}`,
    });
  f.app.procurement.supplier(f.actor, "literal-supplier", {
    name: "Z%_ Supplier literal",
  });
  for (let n = 0; n < 43; n++)
    f.app.catalog.create(f.actor, `purchase-product-${n}`, {
      sku: `BUY-${String(n).padStart(2, "0")}`,
      name: `Purchase fixture ${n}`,
      serialized: false,
      unitPrice: 9999,
      taxBasisPoints: 0,
    });
  const http = await createHttp(f.app, { origin: "http://127.0.0.1:3142" });
  await http.listen({ host: "127.0.0.1", port: 3142 });
  return http;
}
