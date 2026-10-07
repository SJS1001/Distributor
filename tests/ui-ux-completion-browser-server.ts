import { fixture, accept } from "./fixtures.ts";
import { seedInvoiceQueue } from "./invoice-queue-fixture.ts";
import { createHttp } from "../src/server/http.ts";

const cleanup: (() => void)[] = [];
const f = fixture({ after: (fn) => cleanup.push(fn) });
accept(f, 1, "completion-open-order");
seedInvoiceQueue(f, 45, "completion-invoice");
f.app.identity.createUser(f.actor, "completion-buyer", {
  name: "Synthetic completion buyer",
  email: "completion-buyer@example.test",
  password: "long-test-only-password",
  role: "buyer",
  sites: [],
  accountId: f.buyer,
});
const http = await createHttp(f.app, {
  origin: "http://127.0.0.1:3237",
  secureCookies: false,
});
await http.listen({ host: "127.0.0.1", port: 3237 });
async function stop() {
  await http.close();
  cleanup.forEach((fn) => fn());
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
