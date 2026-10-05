export const ORDER_PRICE_OVERRIDES_SCHEMA = [
  {
    type: "table",
    name: "orders_price_overrides",
    tbl_name: "orders_price_overrides",
    sql: "CREATE TABLE orders_price_overrides(org_id TEXT NOT NULL,cart_id TEXT NOT NULL,product_id TEXT NOT NULL,revision INTEGER NOT NULL,cart_revision INTEGER NOT NULL,cart_fingerprint TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('active','pending','approved','rejected','cleared')),unit_price INTEGER,assessment TEXT NOT NULL,reason TEXT NOT NULL,proposer_id TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(org_id,cart_id,product_id,revision)) STRICT",
  },
  {
    type: "table",
    name: "orders_price_override_snapshots",
    tbl_name: "orders_price_override_snapshots",
    sql: "CREATE TABLE orders_price_override_snapshots(org_id TEXT NOT NULL,quote_id TEXT NOT NULL,cart_id TEXT NOT NULL,product_id TEXT NOT NULL,override_revision INTEGER NOT NULL,terms TEXT NOT NULL,order_id TEXT,PRIMARY KEY(org_id,quote_id,product_id)) STRICT",
  },
] as const;
export const ORDER_PRICE_OVERRIDES_DDL = ORDER_PRICE_OVERRIDES_SCHEMA.map(
  (o) => o.sql,
).join(";");
export const ORDER_PRICE_OVERRIDES_INITIALIZE =
  ORDER_PRICE_OVERRIDES_SCHEMA.map((o) =>
    o.sql.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS"),
  ).join(";");
