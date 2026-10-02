import { fixture, accept, ship } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";

export async function serialDossierBrowser(after: (fn: () => void) => void) {
  const f = fixture({ after });
  f.app.identity.createUser(f.actor, "dossier-browser-worker", {
    email: "warehouse@example.test",
    name: "Synthetic dossier worker",
    role: "warehouse",
    sites: [f.w1],
    password: "long-test-only-password",
  });
  const unitId = f.app.inventory.trace(f.actor, "S1").unit.id;
  for (let n = 1; n <= 22; n++) {
    ship(f, accept(f, 1, `dossier-browser-sale-${n}`).id);
    const claim = f.app.warranty.submit(f.actor, `dossier-browser-claim-${n}`, {
      accountId: f.buyer,
      unitId,
      type: "return",
      issue: `Synthetic dossier return ${n}`,
      evidence: "Synthetic report",
    });
    f.app.warranty.review(f.actor, `dossier-browser-approve-${n}`, {
      claimId: claim.id,
      approved: true,
      reason: "Synthetic approval",
    });
    f.app.warranty.receive(f.actor, `dossier-browser-receive-${n}`, {
      claimId: claim.id,
      warehouseId: f.w1,
      bin: "DOSSIER",
      serial: "S1",
    });
    f.app.warranty.inspect(f.actor, `dossier-browser-inspect-${n}`, {
      claimId: claim.id,
      findings: "Synthetic working unit",
    });
    f.app.warranty.dispose(f.actor, `dossier-browser-restock-${n}`, {
      claimId: claim.id,
      disposition: "restock",
      reason: "Synthetic accepted return",
    });
  }
  const http = await createHttp(f.app, { origin: "http://127.0.0.1:3146" });
  await http.listen({ host: "127.0.0.1", port: 3146 });
  return http;
}
