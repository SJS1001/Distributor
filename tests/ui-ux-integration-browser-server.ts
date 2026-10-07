import { fixture, accept } from "./fixtures.ts";
import { seedClaimQueue } from "./claim-queue-fixture.ts";
import { createHttp } from "../src/server/http.ts";

const cleanup: (() => void)[] = [];
const f = fixture({ after: (fn) => cleanup.push(fn) });
seedClaimQueue(f, 3, "integration");
accept(f, 1, "integration-open-order");
f.app.identity.createUser(f.actor, "integration-buyer", {
  name: "Synthetic integration buyer",
  email: "integration-buyer@example.test",
  password: "long-test-only-password",
  role: "buyer",
  sites: [],
  accountId: f.buyer,
});
const invoice = f.app.billing.invoices(f.actor)[0]!;
await f.app.billing.documents.download(
  f.actor,
  "integration-readable-download",
  "invoice",
  invoice.id,
);
const http = await createHttp(f.app, {
  origin: "http://127.0.0.1:3217",
  secureCookies: false,
});
// Localhost fixture has no TLS listener; WebKit otherwise upgrades assets.
// Production policy is unchanged, and every other fixture directive remains.
http.addHook("onSend", async (_request, reply, payload) => {
  const policy = reply.getHeader("Content-Security-Policy");
  if (typeof policy === "string")
    reply.header(
      "Content-Security-Policy",
      policy.replace(/upgrade-insecure-requests;?/g, ""),
    );
  return payload;
});
await http.listen({ host: "127.0.0.1", port: 3217 });
async function stop() {
  await http.close();
  cleanup.forEach((fn) => fn());
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
