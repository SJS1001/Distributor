export const PRODUCT_AVAILABILITY_SCHEMA = [
  {
    type: "table",
    name: "catalog_product_availability",
    tbl_name: "catalog_product_availability",
    sql: "CREATE TABLE catalog_product_availability(org_id TEXT NOT NULL,product_id TEXT NOT NULL,hidden INTEGER NOT NULL CHECK(hidden IN(0,1)),out_of_stock INTEGER NOT NULL CHECK(out_of_stock IN(0,1)),expected_available_on TEXT,revision INTEGER NOT NULL CHECK(revision>0),PRIMARY KEY(org_id,product_id)) STRICT",
  },
] as const;
export const PRODUCT_AVAILABILITY_DDL = PRODUCT_AVAILABILITY_SCHEMA.map(
  (o) => o.sql,
).join(";");
export const PRODUCT_AVAILABILITY_INITIALIZE = PRODUCT_AVAILABILITY_DDL.replace(
  "CREATE TABLE",
  "CREATE TABLE IF NOT EXISTS",
);
