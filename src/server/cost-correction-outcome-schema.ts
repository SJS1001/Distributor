export const COST_CORRECTION_OUTCOME_SCHEMA = [
  {
    type: "table",
    name: "integration_cost_correction_references",
    tbl_name: "integration_cost_correction_references",
    sql: "CREATE TABLE integration_cost_correction_references(org_id TEXT NOT NULL,receiver_ref TEXT NOT NULL,external_ref TEXT NOT NULL,correction_id TEXT NOT NULL REFERENCES integration_cost_corrections(id),leg TEXT NOT NULL CHECK(leg IN('reversal','replacement')),PRIMARY KEY(org_id,receiver_ref,external_ref),UNIQUE(correction_id,leg)) STRICT",
  },
  {
    type: "table",
    name: "integration_cost_correction_outcomes",
    tbl_name: "integration_cost_correction_outcomes",
    sql: "CREATE TABLE integration_cost_correction_outcomes(correction_id TEXT NOT NULL,leg TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),org_id TEXT NOT NULL,input TEXT NOT NULL,evidence_hash TEXT NOT NULL,recorded_by TEXT NOT NULL,recorded_at TEXT NOT NULL,PRIMARY KEY(correction_id,leg,revision),FOREIGN KEY(correction_id,leg) REFERENCES integration_cost_correction_references(correction_id,leg)) STRICT",
  },
] as const;
export const COST_CORRECTION_OUTCOME_DDL = COST_CORRECTION_OUTCOME_SCHEMA.map(
  (o) => o.sql,
).join(";");
export const COST_CORRECTION_OUTCOME_INITIALIZE_DDL =
  COST_CORRECTION_OUTCOME_DDL.replaceAll(
    "CREATE TABLE",
    "CREATE TABLE IF NOT EXISTS",
  );
