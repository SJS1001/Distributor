export const SHIPPING_TERMS_SCHEMA = [
  {
    type: "table",
    name: "orders_cart_shipping",
    tbl_name: "orders_cart_shipping",
    sql: "CREATE TABLE orders_cart_shipping(org_id TEXT NOT NULL,cart_id TEXT NOT NULL,cart_revision INTEGER NOT NULL,cart_fingerprint TEXT NOT NULL,revision INTEGER NOT NULL,terms TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(org_id,cart_id,revision)) STRICT",
  },
  {
    type: "table",
    name: "orders_shipping_snapshots",
    tbl_name: "orders_shipping_snapshots",
    sql: "CREATE TABLE orders_shipping_snapshots(org_id TEXT NOT NULL,quote_id TEXT NOT NULL,cart_id TEXT NOT NULL,cart_revision INTEGER NOT NULL,order_id TEXT,terms TEXT NOT NULL,PRIMARY KEY(org_id,quote_id),UNIQUE(org_id,order_id)) STRICT",
  },
  {
    type: "table",
    name: "billing_shipping_snapshots",
    tbl_name: "billing_shipping_snapshots",
    sql: "CREATE TABLE billing_shipping_snapshots(org_id TEXT NOT NULL,invoice_id TEXT NOT NULL,order_id TEXT NOT NULL,terms TEXT NOT NULL,line_id TEXT,PRIMARY KEY(org_id,invoice_id),UNIQUE(org_id,line_id)) STRICT",
  },
] as const;
export const SHIPPING_TERMS_DDL = SHIPPING_TERMS_SCHEMA.map((o) => o.sql).join(
  ";",
);
export const shippingTermsInitialize = (owner: "orders" | "billing") =>
  SHIPPING_TERMS_SCHEMA.filter((o) => o.name.startsWith(owner + "_"))
    .map((o) => o.sql.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS"))
    .join(";");
