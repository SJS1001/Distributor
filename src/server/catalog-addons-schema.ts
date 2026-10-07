// Staff-chosen add-on products (install kits, brackets and similar) suggested
// with a main unit. The set row carries the revision; member rows keep order.
export const CATALOG_ADDONS_SCHEMA = [
  {
    type: "table",
    name: "catalog_product_addon_sets",
    tbl_name: "catalog_product_addon_sets",
    sql: "CREATE TABLE catalog_product_addon_sets(org_id TEXT NOT NULL,product_id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),PRIMARY KEY(org_id,product_id)) STRICT",
  },
  {
    type: "table",
    name: "catalog_product_addons",
    tbl_name: "catalog_product_addons",
    sql: "CREATE TABLE catalog_product_addons(org_id TEXT NOT NULL,product_id TEXT NOT NULL,addon_product_id TEXT NOT NULL,position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 11),CHECK(addon_product_id<>product_id),PRIMARY KEY(org_id,product_id,addon_product_id),UNIQUE(org_id,product_id,position)) STRICT",
  },
] as const;
export const CATALOG_ADDONS_DDL = CATALOG_ADDONS_SCHEMA.map((o) => o.sql).join(
  ";",
);
export const CATALOG_ADDONS_INITIALIZE = CATALOG_ADDONS_DDL.replaceAll(
  "CREATE TABLE",
  "CREATE TABLE IF NOT EXISTS",
);
