import { fixture } from "./fixtures.ts";
import type { Actor, Role } from "../src/server/core.ts";

export function seedCustomerPricing(f: ReturnType<typeof fixture>) {
  const other = f.app.identity.createCustomer(f.actor, "pricing-other", {
    name: "Other pricing customer",
    tier: "partner",
    creditLimit: 1000000,
  }).id;
  f.app.catalog.setPrice(f.actor, "pricing-standard", {
    productId: f.product,
    tier: "standard",
    unitPrice: 8199,
  });
  f.app.catalog.setPrice(f.actor, "pricing-partner", {
    productId: f.product,
    tier: "partner",
    unitPrice: 4200,
  });
  const user = (name: string, role: Role, accountId = f.buyer): Actor => {
    const { id } = f.app.identity.createUser(f.actor, `pricing-${name}`, {
      name,
      email: `pricing-${name}@example.test`,
      password: "long-test-only-password",
      role,
      sites: role === "buyer" ? [] : [f.w1],
      accountId: role === "buyer" ? accountId : undefined,
    });
    return f.app.identity.currentActor({ ...f.actor, id });
  };
  return {
    other,
    buyer: user("buyer", "buyer"),
    partner: user("partner", "buyer", other),
    commercial: user("commercial", "commercial"),
    user,
  };
}
