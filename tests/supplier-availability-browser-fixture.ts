import { fixture } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";

export async function supplierAvailabilityBrowser(
  after: (fn: () => void) => void,
) {
  const f = fixture({ after });
  for (let i = 0; i < 43; i++)
    f.app.procurement.supplier(f.actor, `directory-${i}`, {
      name: `Directory supplier ${String(i).padStart(2, "0")}`,
    });
  for (const name of [
    "Recovery supplier",
    "Revision supplier",
    "Purchase refusal supplier",
    "Committed purchase supplier",
    "History supplier",
  ]) {
    const supplierId = f.app.procurement.supplier(f.actor, `named-${name}`, {
      name,
    }).id;
    if (name === "History supplier")
      for (let i = 0; i < 43; i++)
        f.app.procurement.supplierAvailability(f.actor, `history-${i}`, {
          supplierId,
          revision: i,
          active: i % 2 !== 0,
          reason: `Synthetic availability review ${i + 1}`,
        });
  }
  f.app.identity.createUser(f.actor, "supplier-warehouse", {
    email: "supplier-warehouse@example.test",
    name: "Supplier history warehouse reader",
    password: "long-test-only-password",
    role: "warehouse",
    sites: [f.w1],
  });
  const http = await createHttp(f.app, { origin: "http://127.0.0.1:3157" });
  await http.listen({ host: "127.0.0.1", port: 3157 });
  return http;
}
