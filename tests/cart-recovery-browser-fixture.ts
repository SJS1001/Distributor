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
    "unavailable",
    "unavailable-staff",
    "unavailable-empty",
    "unavailable-review",
    "durable",
    "storage",
    "tabs",
    "malformed",
    "changed-review",
    "cleanup",
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
    if (name.startsWith("unavailable")) {
      const retired = f.app.catalog.create(f.actor, `retired-${name}`, {
        sku: `RETIRED-${name}`,
        name: `Retired synthetic ${name}`,
        serialized: true,
        unitPrice: 5000,
        taxBasisPoints: 1300,
      }).id;
      const reviewLines = [];
      if (name === "unavailable-review") {
        const secondRetired = f.app.catalog.create(f.actor, "review-retired", {
          sku: "RETIRED-SECOND",
          name: "Second retired synthetic product",
          serialized: false,
          unitPrice: 4321,
          taxBasisPoints: 1300,
        }).id;
        const available = f.app.catalog.create(f.actor, "review-available", {
          sku: "REVIEW-ACTIVE",
          name: "Available synthetic review product",
          serialized: false,
          unitPrice: 1234,
          taxBasisPoints: 1300,
        }).id;
        reviewLines.push(
          { productId: secondRetired, quantity: 3 },
          { productId: available, quantity: 2 },
        );
      }
      f.app.orders.saveCart(f.actor, `retired-cart-${name}`, {
        accountId: account,
        warehouseId: f.w1,
        revision: 0,
        lines: [
          ...(name === "unavailable-empty"
            ? []
            : [{ productId: f.product, quantity: 1 }]),
          { productId: retired, quantity: 2 },
          ...reviewLines,
        ],
      });
      // Simulate a catalog product becoming inactive after a native draft save.
      f.app.database
        .owned("catalog")
        .run("UPDATE catalog_products SET active=0 WHERE id=?", retired);
      if (name === "unavailable-review")
        f.app.database
          .owned("catalog")
          .run(
            "UPDATE catalog_products SET active=0 WHERE id=?",
            reviewLines[0]!.productId,
          );
    }
  }
  const http = await createHttp(f.app, { origin: "http://127.0.0.1:3139" });
  await http.listen({ host: "127.0.0.1", port: 3139 });
  return http;
}
