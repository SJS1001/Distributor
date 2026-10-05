export const CATALOG_REFERENCE_SCHEMA = [
  {
    type: "table",
    name: "catalog_product_references",
    tbl_name: "catalog_product_references",
    sql: "CREATE TABLE catalog_product_references(org_id TEXT NOT NULL,product_id TEXT NOT NULL,family_id TEXT,model_id TEXT,revision INTEGER NOT NULL CHECK(revision>0),CHECK(family_id IS NOT NULL OR model_id IS NULL),PRIMARY KEY(org_id,product_id)) STRICT",
  },
] as const;
export const CATALOG_REFERENCE_DDL = CATALOG_REFERENCE_SCHEMA.map(
  (o) => o.sql,
).join(";");
export const CATALOG_REFERENCE_INITIALIZE = CATALOG_REFERENCE_DDL.replaceAll(
  "CREATE TABLE",
  "CREATE TABLE IF NOT EXISTS",
);
