// Version 3 additions. Exact identities shared by initialization and clone upgrade.
export const QUICKBOOKS_REVOCATION_SCHEMA = [
  {
    type: "table",
    name: "integration_credential_revocations",
    tbl_name: "integration_credential_revocations",
    sql: "CREATE TABLE integration_credential_revocations(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,binding_id TEXT NOT NULL,worker_id TEXT NOT NULL,account_id TEXT NOT NULL,realm TEXT NOT NULL,client_id TEXT NOT NULL,credential_revision INTEGER NOT NULL,disabled_revision INTEGER NOT NULL,residency_version INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN('sending','unknown','confirmed','released')),claim TEXT,started_at INTEGER NOT NULL,finished_at INTEGER,evidence TEXT,UNIQUE(org_id,binding_id,credential_revision)) STRICT",
  },
  {
    type: "index",
    name: "integration_revocation_binding",
    tbl_name: "integration_credential_revocations",
    sql: "CREATE INDEX integration_revocation_binding ON integration_credential_revocations(org_id,binding_id,state)",
  },
] as const;
export const QUICKBOOKS_REVOCATION_DDL = QUICKBOOKS_REVOCATION_SCHEMA.map(
  (entry) => entry.sql,
).join(";");
export const QUICKBOOKS_REVOCATION_INITIALIZE_DDL =
  QUICKBOOKS_REVOCATION_SCHEMA.map((entry) =>
    entry.sql.replace(/^CREATE (INDEX|TABLE)/, "CREATE $1 IF NOT EXISTS"),
  ).join(";");
