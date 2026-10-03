import { fixture } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";
export async function costCorrectionBrowser(after: (fn: () => void) => void) {
  const f = fixture({ after });
  const costs = f.app.integration.costs;
  const source = costs.source(f.actor);
  const p = costs.prepare(f.actor, "original", {
    version: 1,
    batchRef: "CORRECTION-ORIGINAL",
    afterSequence: 0,
    throughSequence: source.throughSequence,
    inventoryAccount: "1200",
    mappings: [{ type: "receipt", offsetAccount: "2100" }],
    expectedMovements: 3,
    expectedIncrease: 18000,
    expectedDecrease: 0,
    expectedOpeningValue: 0,
    expectedClosingValue: 18000,
    acknowledgment: "Synthetic original controls",
  });
  costs.decide(f.actor, "approve-original", {
    packetId: p.id,
    reviewHash: p.reviewHash,
    decision: "approve",
    reason: "Synthetic original approval",
  });
  f.app.identity.createUser(f.actor, "independent-finance", {
    email: "finance@example.test",
    name: "Synthetic independent finance",
    password: "long-test-only-password",
    role: "finance",
    sites: [],
  });
  const http = await createHttp(f.app, { origin: "http://127.0.0.1:3167" });
  await http.listen({ host: "127.0.0.1", port: 3167 });
  return http;
}
