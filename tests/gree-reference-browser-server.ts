import { fixture } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";
const cleanup: (() => void)[] = [];
const f = fixture({ after: (fn) => cleanup.push(fn) });
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
  origin: "http://127.0.0.1:3221",
  secureCookies: false,
  enrollmentOrganizationId: f.actor.orgId,
});
await http.listen({ host: "127.0.0.1", port: 3221 });
async function stop() {
  await http.close();
  cleanup.forEach((fn) => fn());
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
