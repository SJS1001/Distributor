export const COST_CORRECTION_RETRY_SCHEMA = [
  {
    type: "table",
    name: "integration_cost_correction_retries",
    tbl_name: "integration_cost_correction_retries",
    sql: "CREATE TABLE integration_cost_correction_retries(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,correction_id TEXT NOT NULL REFERENCES integration_cost_corrections(id),leg TEXT NOT NULL CHECK(leg IN('reversal','replacement')),predecessor TEXT NOT NULL,input TEXT NOT NULL,plan TEXT NOT NULL,review_hash TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('ready','reviewed','rejected')),created_by TEXT NOT NULL,created_at TEXT NOT NULL,decision_by TEXT,decision_at TEXT,decision_reason TEXT) STRICT",
  },
  {
    type: "index",
    name: "integration_cost_retry_once",
    tbl_name: "integration_cost_correction_retries",
    sql: "CREATE UNIQUE INDEX integration_cost_retry_once ON integration_cost_correction_retries(correction_id,leg,predecessor) WHERE state='reviewed'",
  },
  {
    type: "table",
    name: "integration_cost_retry_references",
    tbl_name: "integration_cost_retry_references",
    sql: "CREATE TABLE integration_cost_retry_references(org_id TEXT NOT NULL,receiver_ref TEXT NOT NULL,external_ref TEXT NOT NULL,retry_id TEXT NOT NULL UNIQUE REFERENCES integration_cost_correction_retries(id),PRIMARY KEY(org_id,receiver_ref,external_ref)) STRICT",
  },
  {
    type: "table",
    name: "integration_cost_retry_outcomes",
    tbl_name: "integration_cost_retry_outcomes",
    sql: "CREATE TABLE integration_cost_retry_outcomes(retry_id TEXT NOT NULL REFERENCES integration_cost_retry_references(retry_id),revision INTEGER NOT NULL CHECK(revision>0),org_id TEXT NOT NULL,input TEXT NOT NULL,evidence_hash TEXT NOT NULL,recorded_by TEXT NOT NULL,recorded_at TEXT NOT NULL,PRIMARY KEY(retry_id,revision)) STRICT",
  },
] as const;
export const COST_CORRECTION_RETRY_DDL = COST_CORRECTION_RETRY_SCHEMA.map(
  (o) => o.sql,
).join(";");
export const COST_CORRECTION_RETRY_INITIALIZE_DDL =
  COST_CORRECTION_RETRY_DDL.replaceAll(
    "CREATE TABLE",
    "CREATE TABLE IF NOT EXISTS",
  ).replaceAll("CREATE UNIQUE INDEX", "CREATE UNIQUE INDEX IF NOT EXISTS");
