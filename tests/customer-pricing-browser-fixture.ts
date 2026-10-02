import { fixture } from "./fixtures.ts";
import { seedCustomerPricing } from "./customer-pricing-fixture.ts";
import { createHttp } from "../src/server/http.ts";
export async function customerPricingBrowser(after: (fn: () => void) => void) {
  const f = fixture({ after });
  seedCustomerPricing(f);
  const http = await createHttp(f.app, { origin: "http://127.0.0.1:3138" });
  await http.listen({ host: "127.0.0.1", port: 3138 });
  return http;
}
