import type { fixture } from "./fixtures.ts";
// Synthetic tied-time records for paging, never operator purchasing acceptance.
export function seedPurchaseQueue(
  f: ReturnType<typeof fixture>,
  count = 45,
  prefix = "purchase-queue",
  warehouseId = f.w1,
) {
  const store = f.app.database.owned("procurement");
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = `${prefix}-${String(i).padStart(3, "0")}`;
    ids.push(id);
    store.run(
      "INSERT INTO procurement_orders(id,org_id,supplier_id,warehouse_id,state,created_at) VALUES(?,?,?,?,?,?)",
      id,
      f.actor.orgId,
      f.supplier,
      warehouseId,
      i % 3 === 0 ? "received" : "open",
      "2026-09-30T12:00:00.000Z",
    );
    store.run(
      "INSERT INTO procurement_lines(id,org_id,po_id,product_id,quantity,received,unit_cost) VALUES(?,?,?,?,?,?,?)",
      `${id}-line`,
      f.actor.orgId,
      id,
      f.product,
      3,
      i % 3 === 0 ? 3 : 0,
      6000,
    );
  }
  return ids;
}
