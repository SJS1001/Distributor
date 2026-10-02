import { fixture } from "./fixtures.ts";
import { seedClaimQueue } from "./claim-queue-fixture.ts";
import { createHttp } from "../src/server/http.ts";
export async function claimQueueBrowser(after: (fn: () => void) => void) {
  const f = fixture({ after });
  seedClaimQueue(f);
  f.app.identity.createUser(f.actor, "queue-buyer", {
    email: "queue-buyer@example.test",
    name: "Synthetic queue buyer",
    password: "long-test-only-password",
    role: "buyer",
    accountId: f.buyer,
    sites: [],
  });
  const http = await createHttp(f.app, { origin: "http://127.0.0.1:3130" });
  await http.listen({ host: "127.0.0.1", port: 3130 });
  return http;
}
