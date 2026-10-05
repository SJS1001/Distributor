export const INCOMING_SUPPLY_SCHEMA = [
  {
    type: "table",
    name: "orders_incoming_commitments",
    tbl_name: "orders_incoming_commitments",
    sql: "CREATE TABLE orders_incoming_commitments(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,order_id TEXT NOT NULL,line_id TEXT NOT NULL,po_id TEXT NOT NULL,purchase_line_id TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0),held INTEGER NOT NULL DEFAULT 0,converted INTEGER NOT NULL DEFAULT 0,released INTEGER NOT NULL DEFAULT 0,priority INTEGER NOT NULL CHECK(priority BETWEEN 1 AND 999),reason TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,CHECK(held>=0 AND converted>=0 AND released>=0 AND held+converted+released<=quantity)) STRICT",
  },
  {
    type: "index",
    name: "orders_incoming_supply",
    tbl_name: "orders_incoming_commitments",
    sql: "CREATE INDEX orders_incoming_supply ON orders_incoming_commitments(org_id,purchase_line_id,priority,created_at,id)",
  },
  {
    type: "table",
    name: "orders_incoming_history",
    tbl_name: "orders_incoming_history",
    sql: "CREATE TABLE orders_incoming_history(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,commitment_id TEXT NOT NULL,action TEXT NOT NULL,quantity INTEGER NOT NULL,reference TEXT NOT NULL,reason TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL) STRICT",
  },
  {
    type: "table",
    name: "inventory_incoming_holds",
    tbl_name: "inventory_incoming_holds",
    sql: "CREATE TABLE inventory_incoming_holds(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,commitment_id TEXT NOT NULL,order_id TEXT NOT NULL,unit_id TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0),settled INTEGER NOT NULL DEFAULT 0 CHECK(settled>=0 AND settled<=quantity)) STRICT",
  },
] as const;
export const INCOMING_SUPPLY_DDL = INCOMING_SUPPLY_SCHEMA.map(
  (o) => o.sql,
).join(";");
export function incomingSupplyInitialize(owner: "orders" | "inventory") {
  return INCOMING_SUPPLY_SCHEMA.filter((o) => o.name.startsWith(owner + "_"))
    .map((o) =>
      o.sql
        .replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS")
        .replace("CREATE INDEX", "CREATE INDEX IF NOT EXISTS"),
    )
    .join(";");
}
