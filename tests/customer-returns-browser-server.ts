import { fixture, accept, ship } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";

const cleanup: (() => void)[] = [];
const f = fixture({ after: (fn) => cleanup.push(fn) });
for (const browser of ["chromium", "webkit", "foreign"]) {
  const accountId = f.app.identity.createCustomer(f.actor, `rma-${browser}`, {
    name: `Synthetic returns ${browser}`,
    tier: "standard",
    creditLimit: 1000000,
  }).id;
  f.app.catalog.setPurchasingPolicy(f.actor, `rma-policy-${browser}`, {
    accountId,
    mode: "all",
    requiresReview: false,
    productIds: [],
    revision: 0,
    reason: "Synthetic returns purchasing access",
  });
  const sale = { ...f, buyer: accountId };
  ship(sale, accept(sale, 1, `rma-sale-${browser}`).id);
  f.app.identity.createUser(f.actor, `rma-user-${browser}`, {
    name: `Synthetic returns buyer ${browser}`,
    email: `returns-${browser}@example.test`,
    password: "long-test-only-password",
    role: "buyer",
    accountId,
    sites: [],
  });
  if (browser === "foreign") {
    const unit = f.app.warranty.soldUnitPage(f.actor, { accountId }).items[0]!;
    f.app.warranty.submit(f.actor, "rma-foreign-claim", {
      accountId,
      unitId: unit.id,
      type: "return",
      issue: "Private foreign customer issue",
      evidence: "Private foreign evidence",
    });
  }
}
f.app.identity.createUser(f.actor, "rma-warranty", {
  name: "Synthetic warranty reviewer",
  email: "returns-warranty@example.test",
  password: "long-test-only-password",
  role: "warranty",
  sites: [f.w1],
});
// The original fixture buyer has no sale: exercise the customer empty state.
f.app.identity.createUser(f.actor, "rma-empty", {
  name: "Synthetic buyer without sold serials",
  email: "returns-empty@example.test",
  password: "long-test-only-password",
  role: "buyer",
  accountId: f.buyer,
  sites: [],
});
const http = await createHttp(f.app, {
  origin: "http://127.0.0.1:3230",
  secureCookies: false,
});
// A localhost-only fixture has no TLS listener. WebKit otherwise upgrades its
// assets; preserve every other production CSP directive.
http.addHook("onSend", async (_request, reply, payload) => {
  const policy = reply.getHeader("Content-Security-Policy");
  if (typeof policy === "string")
    reply.header(
      "Content-Security-Policy",
      policy.replace(/upgrade-insecure-requests;?/g, ""),
    );
  return payload;
});
await http.listen({ host: "127.0.0.1", port: 3230 });
async function stop() {
  await http.close();
  cleanup.forEach((fn) => fn());
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
