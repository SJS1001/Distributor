import { fixture } from "./fixtures.ts";
import { createHttp } from "./browser-http.ts";

export async function inventoryValuationBrowser(
  after: (fn: () => void) => void,
  port = 3291,
  currency: "CAD" | "USD" = "CAD",
) {
  const f = fixture({ after }, {}, "CA", currency);
  f.app.identity.createUser(f.actor, "valuation-finance", {
    email: "valuation@example.test",
    name: "Synthetic valuation reviewer",
    role: "finance",
    sites: [f.w1, f.w2],
    password: "long-test-only-password",
  });
  const http = await createHttp(f.app, { origin: `http://127.0.0.1:${port}` });
  await http.listen({ host: "127.0.0.1", port });
  return http;
}
