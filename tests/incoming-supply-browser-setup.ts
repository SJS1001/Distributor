import { fixture } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";

export default async function setup() {
  const cleanup: (() => void)[] = [];
  const f = fixture({ after: (fn) => cleanup.push(fn) });
  const cart = f.app.orders.saveCart(f.actor, "incoming-ui-cart", {
    accountId: f.buyer,
    warehouseId: f.w1,
    revision: 0,
    lines: [{ productId: f.product, quantity: 6 }],
  });
  const quote = f.app.orders.quote(f.actor, "incoming-ui-quote", {
    cartId: cart.id,
    revision: cart.revision,
  });
  f.app.orders.accept(f.actor, "incoming-ui-order", {
    quoteId: quote.id,
    allowBackorder: true,
  });
  f.app.procurement.create(f.actor, "incoming-ui-purchase", {
    supplierId: f.supplier,
    warehouseId: f.w1,
    lines: [{ productId: f.product, quantity: 6, unitCost: 6000 }],
  });
  const http = await createHttp(f.app, { origin: "http://127.0.0.1:3191" });
  try {
    await http.listen({ host: "127.0.0.1", port: 3191 });
  } catch (error) {
    await http.close();
    for (const fn of cleanup.reverse()) fn();
    throw error;
  }
  return async () => {
    await http.close();
    for (const fn of cleanup.reverse()) fn();
  };
}
