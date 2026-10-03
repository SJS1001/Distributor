export const COST_CORRECTION_SCHEMA = [
  {
    type: "table",
    name: "integration_cost_policies",
    tbl_name: "integration_cost_policies",
    sql: "CREATE TABLE integration_cost_policies(org_id TEXT NOT NULL,revision INTEGER NOT NULL,input TEXT NOT NULL,policy_hash TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(org_id,revision)) STRICT",
  },
  {
    type: "table",
    name: "integration_cost_corrections",
    tbl_name: "integration_cost_corrections",
    sql: "CREATE TABLE integration_cost_corrections(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,original_id TEXT NOT NULL REFERENCES integration_cost_packets(id),original_hash TEXT NOT NULL,input TEXT NOT NULL,plan TEXT NOT NULL,review_hash TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('ready','blocked','rejected','reviewed')),created_by TEXT NOT NULL,created_at TEXT NOT NULL,decision_by TEXT,decision_at TEXT,decision_reason TEXT,artifact TEXT,content_hash TEXT) STRICT",
  },
  {
    type: "index",
    name: "integration_cost_correction_once",
    tbl_name: "integration_cost_corrections",
    sql: "CREATE UNIQUE INDEX integration_cost_correction_once ON integration_cost_corrections(org_id,original_id) WHERE state='reviewed'",
  },
] as const;
export const COST_CORRECTION_DDL = COST_CORRECTION_SCHEMA.map(
  (o) => o.sql,
).join(";");
export const COST_CORRECTION_INITIALIZE_DDL = COST_CORRECTION_DDL.replaceAll(
  "CREATE TABLE",
  "CREATE TABLE IF NOT EXISTS",
).replaceAll("CREATE UNIQUE INDEX", "CREATE UNIQUE INDEX IF NOT EXISTS");
