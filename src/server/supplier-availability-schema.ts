export const SUPPLIER_AVAILABILITY_SCHEMA = [
  {
    type: "table",
    name: "procurement_supplier_changes",
    tbl_name: "procurement_supplier_changes",
    sql: "CREATE TABLE procurement_supplier_changes(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,supplier_id TEXT NOT NULL REFERENCES procurement_suppliers(id),revision INTEGER NOT NULL CHECK(revision>0),active INTEGER NOT NULL CHECK(active IN(0,1)),actor_id TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(org_id,supplier_id,revision)) STRICT",
  },
] as const;
export const SUPPLIER_AVAILABILITY_DDL = SUPPLIER_AVAILABILITY_SCHEMA.map(
  (entry) => entry.sql,
).join(";");
export const SUPPLIER_AVAILABILITY_INITIALIZE_DDL =
  SUPPLIER_AVAILABILITY_DDL.replaceAll(
    "CREATE TABLE",
    "CREATE TABLE IF NOT EXISTS",
  );
