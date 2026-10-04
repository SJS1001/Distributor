// Schema 20: Integration-owned original cancellation preimages. Empty on
// upgrade; neither storage nor a matching hash supplies qualified authority.
const table = "integration_offline_original_cancellations";
export const INTEGRATION_OFFLINE_ORIGINAL_SCHEMA = [
  {
    type: "table",
    name: table,
    tbl_name: table,
    sql: `CREATE TABLE ${table}(journal_id TEXT PRIMARY KEY REFERENCES integration_stock_journals(id),org_id TEXT NOT NULL,request_id TEXT NOT NULL,binding TEXT NOT NULL UNIQUE,envelope TEXT NOT NULL CHECK(length(CAST(envelope AS BLOB)) BETWEEN 1 AND 4194304),envelope_hash TEXT NOT NULL CHECK(length(envelope_hash)=64),record TEXT NOT NULL CHECK(length(CAST(record AS BLOB)) BETWEEN 1 AND 16384),record_hash TEXT NOT NULL CHECK(length(record_hash)=64),UNIQUE(org_id,request_id)) STRICT`,
  },
  ...(["UPDATE", "DELETE"] as const).map((operation) => ({
    type: "trigger",
    name: `${table}_no_${operation.toLowerCase()}`,
    tbl_name: table,
    sql: `CREATE TRIGGER ${table}_no_${operation.toLowerCase()} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'Offline original provenance is append-only'); END`,
  })),
];
export const INTEGRATION_OFFLINE_ORIGINAL_DDL =
  INTEGRATION_OFFLINE_ORIGINAL_SCHEMA.map((o) => o.sql).join(";");
export const INTEGRATION_OFFLINE_ORIGINAL_INITIALIZE_DDL =
  INTEGRATION_OFFLINE_ORIGINAL_SCHEMA.map((o) =>
    o.sql.replace(/^CREATE (TABLE|TRIGGER) /, "CREATE $1 IF NOT EXISTS "),
  ).join(";");
