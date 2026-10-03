// Frozen schema-16 additions. Acquisition costs and movement bytes stay intact.
export const INVENTORY_VALUATION_SCHEMA = [
  {
    type: "table",
    name: "inventory_valuation_policies",
    tbl_name: "inventory_valuation_policies",
    sql: "CREATE TABLE inventory_valuation_policies(org_id TEXT NOT NULL,product_id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),record TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(org_id,product_id,revision)) STRICT",
  },
  {
    type: "table",
    name: "inventory_valuations",
    tbl_name: "inventory_valuations",
    sql: "CREATE TABLE inventory_valuations(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,unit_id TEXT NOT NULL,reference TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('ready','reviewed','rejected')),record TEXT NOT NULL,hash TEXT NOT NULL,UNIQUE(org_id,reference)) STRICT",
  },
  {
    type: "table",
    name: "inventory_valuation_positions",
    tbl_name: "inventory_valuation_positions",
    sql: "CREATE TABLE inventory_valuation_positions(org_id TEXT NOT NULL,unit_id TEXT NOT NULL,record TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(org_id,unit_id)) STRICT",
  },
  {
    type: "table",
    name: "inventory_value_effects",
    tbl_name: "inventory_value_effects",
    sql: "CREATE TABLE inventory_value_effects(movement_id TEXT PRIMARY KEY,org_id TEXT NOT NULL,unit_id TEXT NOT NULL,record TEXT NOT NULL,hash TEXT NOT NULL) STRICT",
  },
  {
    type: "table",
    name: "inventory_value_splits",
    tbl_name: "inventory_value_splits",
    sql: "CREATE TABLE inventory_value_splits(child_id TEXT PRIMARY KEY,org_id TEXT NOT NULL,sequence INTEGER NOT NULL,record TEXT NOT NULL,hash TEXT NOT NULL) STRICT",
  },
] as const;
export const INVENTORY_VALUATION_DDL = INVENTORY_VALUATION_SCHEMA.map(
  (o) => o.sql,
).join(";");
export const INVENTORY_VALUATION_INITIALIZE_DDL =
  INVENTORY_VALUATION_DDL.replaceAll(
    "CREATE TABLE",
    "CREATE TABLE IF NOT EXISTS",
  );
