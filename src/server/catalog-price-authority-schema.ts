export const PRICE_AUTHORITY_SCHEMA = [
  {
    type: "table",
    name: "catalog_price_approval_policy",
    tbl_name: "catalog_price_approval_policy",
    sql: "CREATE TABLE catalog_price_approval_policy(org_id TEXT PRIMARY KEY,max_discount_bp INTEGER CHECK(max_discount_bp BETWEEN 0 AND 10000),min_margin_bp INTEGER CHECK(min_margin_bp BETWEEN 0 AND 10000),revision INTEGER NOT NULL CHECK(revision>0),CHECK((max_discount_bp IS NULL)=(min_margin_bp IS NULL))) STRICT",
  },
  {
    type: "table",
    name: "catalog_reviewed_unit_cost",
    tbl_name: "catalog_reviewed_unit_cost",
    sql: "CREATE TABLE catalog_reviewed_unit_cost(org_id TEXT NOT NULL,product_id TEXT NOT NULL,unit_cost_cents INTEGER CHECK(unit_cost_cents BETWEEN 0 AND 1000000000),revision INTEGER NOT NULL CHECK(revision>0),PRIMARY KEY(org_id,product_id)) STRICT",
  },
  {
    type: "table",
    name: "catalog_price_authority_history",
    tbl_name: "catalog_price_authority_history",
    sql: "CREATE TABLE catalog_price_authority_history(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,product_id TEXT,kind TEXT NOT NULL CHECK(kind IN('cost','policy')),before_json TEXT NOT NULL,after_json TEXT NOT NULL,reason TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL) STRICT",
  },
] as const;
export const PRICE_AUTHORITY_DDL = PRICE_AUTHORITY_SCHEMA.map(
  (o) => o.sql,
).join(";");
export const PRICE_AUTHORITY_INITIALIZE = PRICE_AUTHORITY_DDL.replaceAll(
  "CREATE TABLE",
  "CREATE TABLE IF NOT EXISTS",
);
