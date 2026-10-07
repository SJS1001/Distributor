import { fixture, accept, ship } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";
const cleanup: (() => void)[] = [];
const f = fixture({ after: (fn) => cleanup.push(fn) });
ship(f, accept(f, 1, "ux-invoice-order").id);
f.app.catalog.setPurchasingPolicy(f.actor, "review-policy", {
  ...f.app.catalog.purchasingPolicy(f.actor, f.buyer),
  requiresReview: true,
  reason: "Synthetic review browser fixture",
});
f.app.catalog.setPrice(f.actor, "buyer-price", {
  productId: f.product,
  tier: "standard",
  unitPrice: 8199,
});
f.app.identity.createUser(f.actor, "shop-buyer", {
  name: "Storefront buyer",
  email: "shop-buyer@example.test",
  password: "long-test-only-password",
  role: "buyer",
  sites: [],
  accountId: f.buyer,
});
const part = f.app.catalog.create(f.actor, "part", {
  sku: "PART-2",
  name: "Synthetic replacement part",
  serialized: false,
  unitPrice: 2500,
  taxBasisPoints: 1300,
});
f.app.catalog.setProductAddons(f.actor, "ux-addons", {
  productId: f.product,
  addonIds: [part.id],
  revision: 0,
  reason: "Synthetic accessory for purchasing hierarchy verification",
});
if (process.env.STOREFRONT_DISCOVERY === "1")
  for (let index = 0; index < 21; index++) {
    f.app.catalog.create(f.actor, `bulk-page-${index}`, {
      sku: `AA-${String(index).padStart(2, "0")}`,
      name: `Synthetic bulk item ${index}`,
      serialized: false,
      unitPrice: 1000,
      taxBasisPoints: 1300,
    });
  }
const http = await createHttp(f.app, {
  origin: "http://127.0.0.1:3216",
  secureCookies: false,
});
await http.listen({ host: "127.0.0.1", port: 3216 });
async function stop() {
  await http.close();
  cleanup.forEach((fn) => fn());
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
