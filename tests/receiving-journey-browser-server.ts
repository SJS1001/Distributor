import { fixture } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";
const cleanup: (() => void)[] = [];
const f = fixture({ after: (fn) => cleanup.push(fn) });
for (const role of ["commercial", "warehouse"] as const)
  f.app.identity.createUser(f.actor, `receiving-${role}`, {
    name: `Receiving ${role}`,
    email: `receiving-${role}@example.test`,
    password: "long-test-only-password",
    role,
    sites: [],
  });
for (const browser of ["chromium", "webkit"]) {
  const productId = f.app.catalog.create(
    f.actor,
    `receiving-product-${browser}`,
    {
      sku: `RECEIVE-${browser}`,
      name: `Receiving equipment ${browser}`,
      serialized: true,
      unitPrice: 10000,
      taxBasisPoints: 1300,
    },
  ).id;
  f.app.procurement.create(f.actor, `receiving-po-${browser}`, {
    supplierId: f.supplier,
    warehouseId: f.w1,
    lines: [{ productId, quantity: 2, unitCost: 6000 }],
  });
}
const http = await createHttp(f.app, {
  origin: "http://127.0.0.1:3229",
  secureCookies: false,
});
// WebKit upgrades localhost assets under this directive; this HTTP-only fixture
// has no TLS listener. Keep all other production CSP directives.
http.addHook("onSend", async (_request, reply, payload) => {
  const policy = reply.getHeader("Content-Security-Policy");
  if (typeof policy === "string")
    reply.header(
      "Content-Security-Policy",
      policy.replace(/upgrade-insecure-requests;?/g, ""),
    );
  return payload;
});
await http.listen({ host: "127.0.0.1", port: 3229 });
async function stop() {
  await http.close();
  cleanup.forEach((fn) => fn());
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
