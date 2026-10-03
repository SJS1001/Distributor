// Schema 19: immutable Integration-owned import provenance. Empty on upgrade;
// storage alone supplies no approval, provider truth or execution authority.
const table = "integration_offline_failed_refunds";
export const INTEGRATION_OFFLINE_REFUND_SCHEMA = [
  {
    type: "table",
    name: table,
    tbl_name: table,
    sql: `CREATE TABLE ${table}(effect_id TEXT PRIMARY KEY REFERENCES integration_effects(id),org_id TEXT NOT NULL,request_id TEXT NOT NULL,binding TEXT NOT NULL UNIQUE,record TEXT NOT NULL CHECK(length(CAST(record AS BLOB)) BETWEEN 1 AND 65536),record_hash TEXT NOT NULL CHECK(length(record_hash)=64),UNIQUE(org_id,request_id)) STRICT`,
  },
  ...(["UPDATE", "DELETE"] as const).map((operation) => ({
    type: "trigger",
    name: `${table}_no_${operation.toLowerCase()}`,
    tbl_name: table,
    sql: `CREATE TRIGGER ${table}_no_${operation.toLowerCase()} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'Offline refund provenance is append-only'); END`,
  })),
];
export const INTEGRATION_OFFLINE_REFUND_DDL =
  INTEGRATION_OFFLINE_REFUND_SCHEMA.map((o) => o.sql).join(";");
export const INTEGRATION_OFFLINE_REFUND_INITIALIZE_DDL =
  INTEGRATION_OFFLINE_REFUND_SCHEMA.map((o) =>
    o.sql.replace(/^CREATE (TABLE|TRIGGER) /, "CREATE $1 IF NOT EXISTS "),
  ).join(";");
