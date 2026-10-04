// Declaration only. Root must register this exact schema in the supported native
// schema profiles/upgrade and initialization before the task can execute.
// Constructors never create or backfill it. Provenance is not execution authority.
const table = "integration_offline_checkout_paid";
export const INTEGRATION_OFFLINE_CHECKOUT_PAID_SCHEMA = Object.freeze([
  Object.freeze({
    type: "table",
    name: table,
    tbl_name: table,
    sql: `CREATE TABLE ${table}(effect_id TEXT PRIMARY KEY REFERENCES integration_effects(id),org_id TEXT NOT NULL,request_id TEXT NOT NULL,binding TEXT NOT NULL UNIQUE,record TEXT NOT NULL CHECK(length(CAST(record AS BLOB)) BETWEEN 1 AND 65536),record_hash TEXT NOT NULL CHECK(length(record_hash)=64),UNIQUE(org_id,request_id)) STRICT`,
  }),
  ...(["UPDATE", "DELETE"] as const).map((operation) =>
    Object.freeze({
      type: "trigger",
      name: `${table}_no_${operation.toLowerCase()}`,
      tbl_name: table,
      sql: `CREATE TRIGGER ${table}_no_${operation.toLowerCase()} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'Offline checkout provenance is append-only'); END`,
    }),
  ),
]);
export const INTEGRATION_OFFLINE_CHECKOUT_PAID_DDL =
  INTEGRATION_OFFLINE_CHECKOUT_PAID_SCHEMA.map((o) => o.sql).join(";");
export const INTEGRATION_OFFLINE_CHECKOUT_PAID_INITIALIZE_DDL =
  INTEGRATION_OFFLINE_CHECKOUT_PAID_SCHEMA.map((o) =>
    o.sql.replace(/^CREATE (TABLE|TRIGGER) /, "CREATE $1 IF NOT EXISTS "),
  ).join(";");
