import { fixture } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";
import { seedOrderQueue } from "./order-queue-fixture.ts";
import { seedInvoiceQueue } from "./invoice-queue-fixture.ts";
import { catalogLifecycleBrowser } from "./catalog-lifecycle-browser-fixture.ts";
const cleanup: (() => void)[] = [];
const f = fixture({ after: (fn) => cleanup.push(fn) });
seedOrderQueue(f, 45);
seedInvoiceQueue(f, 45);
f.app.identity.createUser(f.actor, "report-browser-buyer", {
  name: "Report buyer",
  email: "report-buyer@example.test",
  password: "long-test-only-password",
  role: "buyer",
  sites: [],
  accountId: f.buyer,
});
const http = await createHttp(f.app, {
  origin: "http://127.0.0.1:3218",
  secureCookies: false,
});
await http.listen({ host: "127.0.0.1", port: 3218 });
const catalog = await catalogLifecycleBrowser((fn) => cleanup.push(fn));
async function stop() {
  await http.close();
  await catalog.close();
  cleanup.forEach((fn) => fn());
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
