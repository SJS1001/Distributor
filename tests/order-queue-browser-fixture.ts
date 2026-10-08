import { fixture } from "./fixtures.ts";
import { seedOrderQueue } from "./order-queue-fixture.ts";
import { createHttp } from "./browser-http.ts";
export async function orderQueueBrowser(
  after: (fn: () => void) => void,
  port = 3134,
) {
  const f = fixture({ after });
  seedOrderQueue(f);
  const other = f.app.identity.createCustomer(f.actor, "unrelated", {
    name: "Unrelated customer",
    tier: "standard",
    creditLimit: 0,
  }).id;
  seedOrderQueue(f, 80, "unrelated", other, f.w2);
  f.app.identity.createUser(f.actor, "queue-buyer", {
    email: "queue-buyer@example.test",
    name: "Synthetic queue buyer",
    password: "long-test-only-password",
    role: "buyer",
    accountId: f.buyer,
    sites: [],
  });
  const http = await createHttp(f.app, { origin: `http://127.0.0.1:${port}` });
  await http.listen({ host: "127.0.0.1", port });
  return http;
}
