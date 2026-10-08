import { fixture, accept, ship } from "./fixtures.ts";
import { createHttp } from "./browser-http.ts";
export async function shipmentCoverageBrowser(after: (fn: () => void) => void) {
  const f = fixture({ after });
  f.app.identity.configureCoverage(f.actor, "original", {
    days: 730,
    revision: 1,
    reason: "Synthetic original duration",
  });
  ship(f, accept(f).id);
  f.app.identity.configureCoverage(f.actor, "later", {
    days: 30,
    revision: 2,
    reason: "Synthetic later duration",
  });
  f.app.identity.createUser(f.actor, "sale-buyer", {
    email: "sale-buyer@example.test",
    name: "Synthetic sale buyer",
    password: "long-test-only-password",
    role: "buyer",
    accountId: f.buyer,
    sites: [],
  });
  const http = await createHttp(f.app, { origin: "http://127.0.0.1:3131" });
  await http.listen({ host: "127.0.0.1", port: 3131 });
  return http;
}
