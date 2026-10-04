// Proposed schema22 component only. Root owns frozen profiles and migration wiring.
// Empty installation supplies no legacy provenance or authority.
export const ORIGINAL_LEASE_PROVENANCE_TABLE =
  "integration_offline_original_leases";
export const INTEGRATION_OFFLINE_ORIGINAL_LEASE_SCHEMA = [
  {
    type: "table",
    name: ORIGINAL_LEASE_PROVENANCE_TABLE,
    tbl_name: ORIGINAL_LEASE_PROVENANCE_TABLE,
    sql: `CREATE TABLE ${ORIGINAL_LEASE_PROVENANCE_TABLE}(journal_id TEXT PRIMARY KEY REFERENCES integration_stock_journals(id),org_id TEXT NOT NULL,request_id TEXT NOT NULL,binding TEXT NOT NULL UNIQUE,generation_hash TEXT NOT NULL,envelope TEXT NOT NULL CHECK(length(CAST(envelope AS BLOB)) BETWEEN 1 AND 1048576),record TEXT NOT NULL CHECK(length(CAST(record AS BLOB)) BETWEEN 1 AND 16777216),record_hash TEXT NOT NULL CHECK(length(record_hash)=64),before_hash TEXT NOT NULL CHECK(length(before_hash)=64),after_hash TEXT NOT NULL CHECK(length(after_hash)=64),observation_hash TEXT NOT NULL CHECK(length(observation_hash)=64),UNIQUE(org_id,request_id)) STRICT`,
  },
  ...(["UPDATE", "DELETE"] as const).map((op) => ({
    type: "trigger",
    name: `${ORIGINAL_LEASE_PROVENANCE_TABLE}_no_${op.toLowerCase()}`,
    tbl_name: ORIGINAL_LEASE_PROVENANCE_TABLE,
    sql: `CREATE TRIGGER ${ORIGINAL_LEASE_PROVENANCE_TABLE}_no_${op.toLowerCase()} BEFORE ${op} ON ${ORIGINAL_LEASE_PROVENANCE_TABLE} BEGIN SELECT RAISE(ABORT,'Original lease provenance is append-only'); END`,
  })),
];
export const INTEGRATION_OFFLINE_ORIGINAL_LEASE_DDL =
  INTEGRATION_OFFLINE_ORIGINAL_LEASE_SCHEMA.map((o) => o.sql).join(";");
export const INTEGRATION_OFFLINE_ORIGINAL_LEASE_INITIALIZE_DDL =
  INTEGRATION_OFFLINE_ORIGINAL_LEASE_SCHEMA.map((o) =>
    o.sql.replace(/^CREATE (TABLE|TRIGGER) /, "CREATE $1 IF NOT EXISTS "),
  ).join(";");
