import { fixture, accept, ship } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";
export async function coveragePolicyBrowser(after: (fn: () => void) => void) {
  const f = fixture({ after });
  const shipment = ship(f, accept(f).id);
  // Simulate a pre-version-six sale: no historical handover policy was retained.
  f.app.database
    .owned("fulfillment")
    .run("DELETE FROM fulfillment_coverage WHERE shipment_id=?", shipment.id);
  f.app.database
    .owned("fulfillment")
    .run(
      "UPDATE fulfillment_shipments SET shipped_at=? WHERE id=?",
      "2024-02-29T12:00:00.000Z",
      shipment.id,
    );
  f.app.identity.createUser(f.actor, "coverage-buyer", {
    email: "coverage-buyer@example.test",
    name: "Synthetic warranty buyer",
    password: "long-test-only-password",
    role: "buyer",
    accountId: f.buyer,
    sites: [],
  });
  const http = await createHttp(f.app, { origin: "http://127.0.0.1:3129" });
  await http.listen({ host: "127.0.0.1", port: 3129 });
  return http;
}
