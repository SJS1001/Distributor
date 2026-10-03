// Version 14 additions. Exact identities shared by initialization and clone upgrade.
export const ORGANIZATION_REVOCATION_SCHEMA = [
  {
    type: "table",
    name: "integration_ledger_revocations",
    tbl_name: "integration_ledger_revocations",
    sql: "CREATE TABLE integration_ledger_revocations(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,binding_id TEXT NOT NULL,worker_id TEXT NOT NULL,realm TEXT NOT NULL,client_id TEXT NOT NULL,credential_revision INTEGER NOT NULL,disabled_revision INTEGER NOT NULL,authority TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('sending','unknown','confirmed','released')),claim TEXT,started_at INTEGER NOT NULL,finished_at INTEGER,evidence TEXT,review_revision INTEGER,UNIQUE(org_id,binding_id,credential_revision)) STRICT",
  },
  {
    type: "index",
    name: "integration_ledger_revocation_binding",
    tbl_name: "integration_ledger_revocations",
    sql: "CREATE INDEX integration_ledger_revocation_binding ON integration_ledger_revocations(org_id,binding_id,state)",
  },
] as const;
export const ORGANIZATION_REVOCATION_DDL = ORGANIZATION_REVOCATION_SCHEMA.map(
  (entry) => entry.sql,
).join(";");
export const ORGANIZATION_REVOCATION_INITIALIZE_DDL =
  ORGANIZATION_REVOCATION_SCHEMA.map((entry) =>
    entry.sql.replace(/^CREATE (INDEX|TABLE)/, "CREATE $1 IF NOT EXISTS"),
  ).join(";");
