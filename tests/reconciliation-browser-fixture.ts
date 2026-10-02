import { fixture, accept, ship } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";
export async function reconciliationBrowser(after: (fn: () => void) => void) {
  const f = fixture({ after });
  ship(f, accept(f).id);
  // Deliberate retained stock fault; reporting must never repair it.
  const unit = f.app.inventory.trace(f.actor, "S2").unit;
  f.app.database
    .owned("inventory")
    .run("UPDATE inventory_units SET quantity=2 WHERE id=?", unit.id);
  const http = await createHttp(f.app, { origin: "http://127.0.0.1:3132" });
  await http.listen({ host: "127.0.0.1", port: 3132 });
  return http;
}
