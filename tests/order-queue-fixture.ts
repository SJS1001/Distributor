import type { fixture } from "./fixtures.ts";
// Synthetic tied-time paging records, not accepted customer order evidence.
export function seedOrderQueue(
  f: ReturnType<typeof fixture>,
  count = 45,
  prefix = "queue",
  accountId = f.buyer,
  warehouseId = f.w1,
) {
  const store = f.app.database.owned("orders");
  for (let i = 0; i < count; i++) {
    const id = `${prefix}-${String(i).padStart(3, "0")}`;
    store.run(
      "INSERT INTO orders_orders(id,org_id,account_id,warehouse_id,state,currency,total,created_at) VALUES(?,?,?,?,?,?,?,?)",
      id,
      f.actor.orgId,
      accountId,
      warehouseId,
      i % 3 === 0 ? "closed" : "open",
      "CAD",
      11300,
      "2026-09-30T12:00:00.000Z",
    );
    store.run(
      "INSERT INTO orders_lines(id,org_id,order_id,product_id,description,quantity,shipped,unit_price,unit_tax) VALUES(?,?,?,?,?,1,?,10000,1300)",
      `${id}-line`,
      f.actor.orgId,
      id,
      f.product,
      `Order queue item ${String(i).padStart(3, "0")}`,
      i % 3 === 0 ? 1 : 0,
    );
  }
}
