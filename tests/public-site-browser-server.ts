import { fixture } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";
const cleanup: (() => void)[] = [];
const f = fixture({ after: (fn) => cleanup.push(fn) });
f.app.identity.createUser(f.actor, "pilot-buyer", {
  email: "pilot-buyer@example.test",
  password: "synthetic-buyer-password",
  name: "Sample buyer",
  role: "buyer",
  accountId: f.buyer,
  sites: [],
  requirePasswordChange: false,
});
const http = await createHttp(f.app, {
  origin: "http://127.0.0.1:3125",
  enrollmentOrganizationId: f.actor.orgId,
  secureCookies: false,
});
await http.listen({ host: "127.0.0.1", port: 3125 });
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await http.close();
  cleanup.forEach((fn) => fn());
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
