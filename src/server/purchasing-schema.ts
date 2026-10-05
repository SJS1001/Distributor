export const PURCHASING_SCHEMA = [
  {
    type: "table",
    name: "catalog_account_policies",
    tbl_name: "catalog_account_policies",
    sql: "CREATE TABLE catalog_account_policies(org_id TEXT NOT NULL,account_id TEXT NOT NULL,mode TEXT NOT NULL CHECK(mode IN('none','all','selected')),requires_review INTEGER NOT NULL CHECK(requires_review IN(0,1)),revision INTEGER NOT NULL CHECK(revision>0),PRIMARY KEY(org_id,account_id)) STRICT",
  },
  {
    type: "table",
    name: "catalog_entitlements",
    tbl_name: "catalog_entitlements",
    sql: "CREATE TABLE catalog_entitlements(org_id TEXT NOT NULL,account_id TEXT NOT NULL,product_id TEXT NOT NULL,PRIMARY KEY(org_id,account_id,product_id)) STRICT",
  },
  {
    type: "table",
    name: "catalog_product_policies",
    tbl_name: "catalog_product_policies",
    sql: "CREATE TABLE catalog_product_policies(org_id TEXT NOT NULL,product_id TEXT NOT NULL,requires_review INTEGER NOT NULL CHECK(requires_review IN(0,1)),revision INTEGER NOT NULL CHECK(revision>0),PRIMARY KEY(org_id,product_id)) STRICT",
  },
  {
    type: "table",
    name: "orders_review_requests",
    tbl_name: "orders_review_requests",
    sql: "CREATE TABLE orders_review_requests(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,account_id TEXT NOT NULL,warehouse_id TEXT NOT NULL,quote_id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),status TEXT NOT NULL CHECK(status IN('awaiting_approval','information_needed','declined','withdrawn','accepted')),lines TEXT NOT NULL,total INTEGER NOT NULL,currency TEXT NOT NULL,allow_backorder INTEGER NOT NULL CHECK(allow_backorder IN(0,1)),expires_at INTEGER NOT NULL,policy_hash TEXT NOT NULL,review_reason TEXT NOT NULL,message TEXT NOT NULL,order_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(org_id,quote_id)) STRICT",
  },
  {
    type: "table",
    name: "orders_review_history",
    tbl_name: "orders_review_history",
    sql: "CREATE TABLE orders_review_history(org_id TEXT NOT NULL,request_id TEXT NOT NULL,revision INTEGER NOT NULL,action TEXT NOT NULL,message TEXT NOT NULL,staff_note TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,quote_id TEXT NOT NULL,lines TEXT NOT NULL,total INTEGER NOT NULL,currency TEXT NOT NULL,allow_backorder INTEGER NOT NULL,expires_at INTEGER NOT NULL,policy_hash TEXT NOT NULL,review_reason TEXT NOT NULL,PRIMARY KEY(org_id,request_id,revision)) STRICT",
  },
  {
    type: "table",
    name: "orders_review_quotes",
    tbl_name: "orders_review_quotes",
    sql: "CREATE TABLE orders_review_quotes(org_id TEXT NOT NULL,quote_id TEXT NOT NULL,request_id TEXT NOT NULL,PRIMARY KEY(org_id,quote_id)) STRICT",
  },
  {
    type: "index",
    name: "orders_review_page",
    tbl_name: "orders_review_requests",
    sql: "CREATE INDEX orders_review_page ON orders_review_requests(org_id,account_id,created_at,id)",
  },
] as const;
export const PURCHASING_DDL = PURCHASING_SCHEMA.map((o) => o.sql).join(";");
export function purchasingInitialize(owner: "catalog" | "orders") {
  return PURCHASING_SCHEMA.filter((o) => o.name.startsWith(owner + "_"))
    .map((o) =>
      o.sql
        .replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS")
        .replace("CREATE INDEX", "CREATE INDEX IF NOT EXISTS"),
    )
    .join(";");
}
