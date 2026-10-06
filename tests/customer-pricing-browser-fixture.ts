import { fixture } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";

// The customer pricing journey's synthetic server. Its own config, the shared
// browser fleet and the remaining-navigation setup all start this same server.
export const customerPricingOrigin = "http://127.0.0.1:3138";
export async function customerPricingBrowser(after: (fn: () => void) => void) {
  const f = fixture({ after });
  f.app.catalog.setProductMsrp(f.actor, "pricing-browser-msrp", {
    productId: f.product,
    msrpCents: 12500,
    revision: 0,
    reason: "Synthetic manufacturer MSRP",
  });
  f.app.catalog.setPrice(f.actor, "pricing-browser-tier", {
    productId: f.product,
    tier: "standard",
    unitPrice: 8000,
  });
  f.app.identity.createUser(f.actor, "pricing-browser-buyer", {
    name: "Pricing buyer",
    email: "pricing-buyer@example.test",
    password: "long-test-only-password",
    role: "buyer",
    sites: [],
    accountId: f.buyer,
  });
  const http = await createHttp(f.app, {
    origin: customerPricingOrigin,
    secureCookies: false,
  });
  await http.listen({ host: "127.0.0.1", port: 3138 });
  return http;
}
