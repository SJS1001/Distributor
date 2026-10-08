import { fixture } from "./fixtures.ts";
import { seedSupplierReturns } from "./supplier-return-queue-fixture.ts";
import { createHttp } from "./browser-http.ts";
export async function supplierReturnQueueBrowser(
  after: (fn: () => void) => void,
) {
  const f = fixture({ after });
  seedSupplierReturns(f);
  seedSupplierReturns(f, 25, "OTHER", f.w2);
  for (const role of ["warehouse", "finance"] as const)
    f.app.identity.createUser(f.actor, `return-queue-${role}`, {
      email: `return-queue-${role}@example.test`,
      name: "Synthetic supplier queue reader",
      password: "long-test-only-password",
      role,
      sites: [f.w1],
    });
  const http = await createHttp(f.app, { origin: "http://127.0.0.1:3143" });
  await http.listen({ host: "127.0.0.1", port: 3143 });
  return http;
}
