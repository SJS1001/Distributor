import { fixture } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";
const cleanup: (() => void)[] = [];
const f = fixture({ after: (fn) => cleanup.push(fn) });
f.app.identity.createCustomer(f.actor, "other", {
  name: "Other customer",
  tier: "standard",
  creditLimit: 100000,
});
f.app.identity.createUser(f.actor, "min-buyer", {
  name: "Minimum buyer",
  email: "minimum-buyer@example.test",
  password: "long-test-only-password",
  role: "buyer",
  sites: [],
  accountId: f.buyer,
});
f.app.catalog.create(f.actor, "accessory", {
  sku: "ACC-1",
  name: "Synthetic accessory",
  serialized: false,
  unitPrice: 2000,
  taxBasisPoints: 1300,
});
const http = await createHttp(f.app, {
  origin: "http://127.0.0.1:3254",
  secureCookies: false,
});
// This HTTP-only synthetic server has no TLS listener. WebKit upgrades assets
// under this directive; preserve every other production CSP directive.
http.addHook("onSend", async (_request, reply, payload) => {
  const policy = reply.getHeader("Content-Security-Policy");
  if (typeof policy === "string")
    reply.header(
      "Content-Security-Policy",
      policy.replace(/upgrade-insecure-requests;?/g, ""),
    );
  return payload;
});
await http.listen({ host: "127.0.0.1", port: 3254 });
async function stop() {
  await http.close();
  cleanup.forEach((fn) => fn());
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
