// Frozen schema-17 additions; physical and accounting history stay append-only.
export const INVENTORY_QUANTITY_SCHEMA = [
  {
    type: "table",
    name: "inventory_quantity_corrections",
    tbl_name: "inventory_quantity_corrections",
    sql: "CREATE TABLE inventory_quantity_corrections(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,unit_id TEXT NOT NULL,reference TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('ready','reviewed','rejected')),record TEXT NOT NULL,hash TEXT NOT NULL,UNIQUE(org_id,reference)) STRICT",
  },
  {
    type: "index",
    name: "inventory_quantity_pending",
    tbl_name: "inventory_quantity_corrections",
    sql: "CREATE UNIQUE INDEX inventory_quantity_pending ON inventory_quantity_corrections(org_id,unit_id) WHERE state='ready'",
  },
] as const;
export const INVENTORY_QUANTITY_DDL = INVENTORY_QUANTITY_SCHEMA.map(
  (o) => o.sql,
).join(";");
export const INVENTORY_QUANTITY_INITIALIZE_DDL =
  INVENTORY_QUANTITY_DDL.replaceAll(
    "CREATE TABLE",
    "CREATE TABLE IF NOT EXISTS",
  ).replaceAll("CREATE UNIQUE INDEX", "CREATE UNIQUE INDEX IF NOT EXISTS");
