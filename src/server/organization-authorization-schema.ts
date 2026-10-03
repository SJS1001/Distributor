export const ORGANIZATION_AUTHORIZATION_SCHEMA = [
  {
    type: "table",
    name: "integration_ledger_authorizations",
    tbl_name: "integration_ledger_authorizations",
    sql: "CREATE TABLE integration_ledger_authorizations(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,binding_id TEXT NOT NULL,worker_id TEXT NOT NULL,realm TEXT NOT NULL,client_id TEXT NOT NULL,redirect_uri TEXT NOT NULL,state_hash TEXT NOT NULL UNIQUE,credential_revision INTEGER NOT NULL,authority TEXT NOT NULL,expires_at INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN('pending','exchanging','completed','canceled','denied','unknown','expired')),claim TEXT,started_at INTEGER,installed_revision INTEGER) STRICT",
  },
  {
    type: "index",
    name: "integration_ledger_authorization_binding",
    tbl_name: "integration_ledger_authorizations",
    sql: "CREATE INDEX integration_ledger_authorization_binding ON integration_ledger_authorizations(org_id,binding_id)",
  },
] as const;
export const ORGANIZATION_AUTHORIZATION_DDL =
  ORGANIZATION_AUTHORIZATION_SCHEMA.map((o) => o.sql).join(";");
export const ORGANIZATION_AUTHORIZATION_INITIALIZE_DDL =
  ORGANIZATION_AUTHORIZATION_DDL.replaceAll(
    "CREATE TABLE",
    "CREATE TABLE IF NOT EXISTS",
  ).replaceAll("CREATE INDEX", "CREATE INDEX IF NOT EXISTS");
