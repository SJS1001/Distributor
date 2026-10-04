// Schema 21: original Canada Post import preimages. Empty on every upgrade.
// Native member FKs stay within Integration; Platform journal correspondence is
// verified through its complete owning reader, never foreign SQL or a grant.
const table = "integration_offline_canada_post_members";
export const INTEGRATION_OFFLINE_CANADA_POST_SCHEMA = [
  {
    type: "table",
    name: table,
    tbl_name: table,
    sql: `CREATE TABLE ${table}(booking_id TEXT PRIMARY KEY REFERENCES integration_carrier_bookings(id),group_id TEXT NOT NULL,org_id TEXT NOT NULL,request_id TEXT NOT NULL,binding TEXT NOT NULL UNIQUE,envelope TEXT NOT NULL CHECK(length(CAST(envelope AS BLOB)) BETWEEN 1 AND 65536),envelope_hash TEXT NOT NULL CHECK(length(envelope_hash)=64),record TEXT NOT NULL CHECK(length(CAST(record AS BLOB)) BETWEEN 1 AND 65536),record_hash TEXT NOT NULL CHECK(length(record_hash)=64),UNIQUE(org_id,request_id),FOREIGN KEY(group_id,booking_id) REFERENCES integration_canada_post_members(group_id,booking_id)) STRICT`,
  },
  ...(["UPDATE", "DELETE"] as const).map((operation) => ({
    type: "trigger",
    name: `${table}_no_${operation.toLowerCase()}`,
    tbl_name: table,
    sql: `CREATE TRIGGER ${table}_no_${operation.toLowerCase()} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'Offline Canada Post provenance is append-only'); END`,
  })),
];
export const INTEGRATION_OFFLINE_CANADA_POST_DDL =
  INTEGRATION_OFFLINE_CANADA_POST_SCHEMA.map((o) => o.sql).join(";");
export const INTEGRATION_OFFLINE_CANADA_POST_INITIALIZE_DDL =
  INTEGRATION_OFFLINE_CANADA_POST_SCHEMA.map((o) =>
    o.sql.replace(/^CREATE (TABLE|TRIGGER) /, "CREATE $1 IF NOT EXISTS "),
  ).join(";");
