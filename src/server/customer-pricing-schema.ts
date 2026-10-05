export const CUSTOMER_PRICING_SCHEMA = [
  {
    type: "table",
    name: "catalog_account_pricing",
    tbl_name: "catalog_account_pricing",
    sql: "CREATE TABLE catalog_account_pricing(org_id TEXT NOT NULL,account_id TEXT NOT NULL,multiplier_bp INTEGER CHECK(multiplier_bp BETWEEN 0 AND 10000),display_mode TEXT NOT NULL CHECK(display_mode IN('detailed','net_only')),revision INTEGER NOT NULL CHECK(revision>0),PRIMARY KEY(org_id,account_id)) STRICT",
  },
  {
    type: "table",
    name: "catalog_product_msrp",
    tbl_name: "catalog_product_msrp",
    sql: "CREATE TABLE catalog_product_msrp(org_id TEXT NOT NULL,product_id TEXT NOT NULL,msrp_cents INTEGER CHECK(msrp_cents BETWEEN 0 AND 1000000000),revision INTEGER NOT NULL CHECK(revision>0),PRIMARY KEY(org_id,product_id)) STRICT",
  },
  {
    type: "table",
    name: "catalog_pricing_history",
    tbl_name: "catalog_pricing_history",
    sql: "CREATE TABLE catalog_pricing_history(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,account_id TEXT,product_id TEXT,kind TEXT NOT NULL CHECK(kind IN('policy','msrp','tier')),before_json TEXT NOT NULL,after_json TEXT NOT NULL,reason TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL) STRICT",
  },
] as const;
export const CUSTOMER_PRICING_DDL = CUSTOMER_PRICING_SCHEMA.map(
  (o) => o.sql,
).join(";");
export const CUSTOMER_PRICING_INITIALIZE = CUSTOMER_PRICING_DDL.replaceAll(
  "CREATE TABLE",
  "CREATE TABLE IF NOT EXISTS",
);
