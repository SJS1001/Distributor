import { fixture } from "./fixtures.ts";
import { seedCustomerPricing } from "./customer-pricing-fixture.ts";
export function seedCatalogEntry(f: ReturnType<typeof fixture>) {
  const p = seedCustomerPricing(f);
  const ids = Array.from(
    { length: 45 },
    (_, i) =>
      f.app.catalog.create(f.actor, `entry-product-${i}`, {
        sku: `PAGE-${String(i).padStart(2, "0")}`,
        name: i === 42 ? "Literal %_ widget" : `Paged product ${i}`,
        serialized: false,
        unitPrice: 2000 + i,
        taxBasisPoints: 1300,
      }).id,
  );
  f.app.catalog.setPrice(f.actor, "entry-last-price", {
    productId: ids[44]!,
    tier: "standard",
    unitPrice: 777,
  });
  const cart = f.app.orders.saveCart(p.buyer, "entry-cart", {
    accountId: f.buyer,
    warehouseId: f.w1,
    revision: 0,
    lines: [
      { productId: ids[44]!, quantity: 3 },
      { productId: ids[43]!, quantity: 2 },
    ],
  });
  f.app.database
    .owned("catalog")
    .run("UPDATE catalog_products SET active=0 WHERE id=?", ids[43]!);
  return { ...p, ids, cart };
}

export function seedSavedCartQueue(f: ReturnType<typeof fixture>) {
  const rows = Array.from({ length: 44 }, (_, i) => {
    const warehouse = f.app.inventory.createWarehouse(
      f.actor,
      `queue-site-${i}`,
      { name: `Queue ${String(i).padStart(2, "0")}` },
    ).id;
    const cart = f.app.orders.saveCart(f.actor, `queue-cart-${i}`, {
      accountId: f.buyer,
      warehouseId: warehouse,
      revision: 0,
      lines: [{ productId: f.product, quantity: i + 1 }],
    });
    const id = `queue-cart-${String(i).padStart(2, "0")}`;
    f.app.database
      .owned("orders")
      .run(
        "UPDATE orders_carts SET id=?,updated_at='2099-01-01T00:00:00.000Z' WHERE id=?",
        id,
        cart.id,
      );
    return { id, warehouse };
  });
  return rows;
}
