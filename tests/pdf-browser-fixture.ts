import { fixture, accept, ship } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";

export async function pdfBoundaryBrowser(after: (fn: () => void) => void) {
  const f = fixture({ after });
  const costs = f.app.integration.costs;
  const source = costs.source(f.actor);
  const packet = costs.prepare(f.actor, "fixture-cost", {
    version: 1,
    batchRef: "PDF-BOUNDARY-COST",
    afterSequence: 0,
    throughSequence: source.throughSequence,
    inventoryAccount: "1200",
    mappings: [{ type: "receipt", offsetAccount: "2100" }],
    expectedMovements: 3,
    expectedIncrease: 18000,
    expectedDecrease: 0,
    expectedOpeningValue: 0,
    expectedClosingValue: 18000,
    acknowledgment:
      "Synthetic regional cost reconciliation; not finance approval",
  });
  costs.decide(f.actor, "fixture-cost-approve", {
    packetId: packet.id,
    reviewHash: packet.reviewHash,
    decision: "approve",
    reason: "Synthetic cost file preparation",
  });
  const invoice = ship(f, accept(f).id).invoiceId;
  const prepared = await f.app.billing.documents.download(
    f.actor,
    "fixture-pdf",
    "invoice",
    invoice,
  );
  f.app.billing.delivery.publish(f.actor, "fixture-publish", {
    downloadId: prepared.receipt.id,
    reason: "Synthetic fixture PDF review",
  });
  const claim = f.app.warranty.submit(f.actor, "fixture-claim", {
    accountId: f.buyer,
    unitId: f.app.inventory.trace(f.actor, "S1").unit.id,
    type: "warranty",
    issue: "Synthetic download boundary",
    evidence: "Synthetic fixture",
  });
  f.app.warranty.evidence.upload(f.actor, "fixture-evidence", claim.id, {
    filename: "boundary.txt",
    mediaType: "text/plain",
    audience: "customer",
    description: "Synthetic download test",
    contentBase64: Buffer.from("Synthetic boundary evidence").toString(
      "base64",
    ),
  });
  ship(f, accept(f, 1, "second-invoice").id);
  accept(f, 1, "open-boundary");
  f.app.identity.createUser(f.actor, "pdf-buyer", {
    email: "pdf-buyer@example.test",
    name: "Synthetic PDF buyer",
    password: "initial-pdf-buyer-password",
    role: "buyer",
    accountId: f.buyer,
    sites: [],
  });
  f.app.identity.changePassword(
    f.app.identity.login("pdf-buyer@example.test", "initial-pdf-buyer-password")
      .actor,
    "pdf-buyer-password",
    {
      currentPassword: "initial-pdf-buyer-password",
      password: "long-pdf-buyer-password",
    },
  );
  const http = await createHttp(f.app, { origin: "http://127.0.0.1:3166" });
  await http.listen({ host: "127.0.0.1", port: 3166 });
  return http;
}
