import { fixture } from "./fixtures.ts";
import { createHttp } from "./browser-http.ts";

export async function retiredReceivingBrowser(after: (fn: () => void) => void) {
  const f = fixture({ after });
  const productId = f.app.catalog.create(f.actor, "retired-delivery-product", {
    sku: "RETIRED-DELIVERY",
    name: "Synthetic customer-retired equipment",
    serialized: true,
    unitPrice: 99900,
    taxBasisPoints: 0,
  }).id;
  const poId = f.app.procurement.create(f.actor, "retired-delivery-po", {
    supplierId: f.supplier,
    warehouseId: f.w1,
    lines: [{ productId, quantity: 2, unitCost: 4321 }],
  }).id;
  f.app.procurement.drafts.save(f.actor, "retired-delivery-draft", {
    poId,
    lineId: String(f.app.procurement.order(f.actor, poId).lines[0]!.id),
    deliveryRef: "RETIRED-PART-1",
    observedSku: "RETIRED-DELIVERY",
    quantity: 1,
    serials: [],
    bin: "RETIRED-R",
    quarantine: true,
    draftId: null,
    revision: 0,
  });
  f.app.catalog.retire(f.actor, "retired-delivery-retire", {
    productId,
    expectedHash: f.app.catalog.lifecycleReview(f.actor, productId)
      .expectedHash,
    reason: "Synthetic withdrawal from customer ordering",
  });
  f.app.identity.createUser(f.actor, "retired-delivery-worker", {
    name: "Synthetic warehouse worker",
    email: "receiving@example.test",
    password: "long-test-only-password",
    role: "warehouse",
    sites: [f.w1],
  });
  const http = await createHttp(f.app, { origin: "http://127.0.0.1:3147" });
  await http.listen({ host: "127.0.0.1", port: 3147 });
  return http;
}
