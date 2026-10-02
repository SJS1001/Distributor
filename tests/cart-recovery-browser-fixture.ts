import { fixture } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";

export async function cartRecoveryBrowser(after: (fn: () => void) => void) {
  const f = fixture({ after });
  // Journeys share this synthetic database and reserve ten units in total.
  // Receive enough independent native stock rather than weakening allocation.
  const purchase = f.app.procurement.create(f.actor, "cart-recovery-stock", {
    supplierId: f.supplier,
    warehouseId: f.w1,
    lines: [{ productId: f.product, quantity: 7, unitCost: 6000 }],
  });
  const line = f.app.procurement
    .orders(f.actor)
    .find((p) => p.id === purchase.id)!.lines[0]!;
  f.app.procurement.receive(f.actor, "cart-recovery-receipt", {
    poId: purchase.id,
    lineId: line.id as string,
    deliveryRef: "SYNTHETIC-CART-RECOVERY",
    quantity: 7,
    serials: ["CR1", "CR2", "CR3", "CR4", "CR5", "CR6", "CR7"],
    bin: "A-1",
    quarantine: false,
  });
  for (const name of [
    "quote",
    "lost",
    "edited",
    "conflict",
    "invalid",
    "timeout",
  ]) {
    const account = f.app.identity.createCustomer(f.actor, `cart-${name}`, {
      name: `Cart recovery ${name}`,
      tier: "standard",
      creditLimit: 1000000,
    }).id;
    f.app.identity.createUser(f.actor, `cart-user-${name}`, {
      name: `Cart recovery ${name}`,
      email: `cart-${name}@example.test`,
      password: "long-test-only-password",
      role: "buyer",
      accountId: account,
      sites: [],
    });
  }
  const http = await createHttp(f.app, { origin: "http://127.0.0.1:3139" });
  await http.listen({ host: "127.0.0.1", port: 3139 });
  return http;
}
