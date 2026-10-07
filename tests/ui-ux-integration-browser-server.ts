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
await http.listen({ host: "127.0.0.1", port: 3217 });
async function stop() {
  await http.close();
  cleanup.forEach((fn) => fn());
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
