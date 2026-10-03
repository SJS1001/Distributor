export const STOCK_JOURNAL_SCHEMA = [
  {
    type: "table",
    name: "integration_stock_journals",
    tbl_name: "integration_stock_journals",
    sql: "CREATE TABLE integration_stock_journals(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,realm TEXT NOT NULL,binding_id TEXT NOT NULL,source_id TEXT NOT NULL,leg TEXT NOT NULL CHECK(leg IN('original','reversal','replacement')),posting_date TEXT NOT NULL,attempt_id TEXT NOT NULL,plan TEXT NOT NULL,review_hash TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('ready','rejected','pending','running','unknown','posted','cancelled')),created_by TEXT NOT NULL,created_at TEXT NOT NULL,decision_by TEXT,decision_at TEXT,decision_reason TEXT,lease_id TEXT,lease_actor TEXT,lease_started INTEGER,lease_mode TEXT CHECK(lease_mode IN('write','lookup')),dispatched INTEGER NOT NULL DEFAULT 0 CHECK(dispatched IN(0,1)),external_id TEXT) STRICT",
  },
  {
    type: "index",
    name: "integration_stock_journal_source",
    tbl_name: "integration_stock_journals",
    sql: "CREATE UNIQUE INDEX integration_stock_journal_source ON integration_stock_journals(org_id,source_id,leg,posting_date,attempt_id) WHERE state<>'rejected'",
  },
  {
    type: "table",
    name: "integration_stock_journal_references",
    tbl_name: "integration_stock_journal_references",
    sql: "CREATE TABLE integration_stock_journal_references(org_id TEXT NOT NULL,realm TEXT NOT NULL,request_ref TEXT NOT NULL,journal_id TEXT NOT NULL UNIQUE REFERENCES integration_stock_journals(id),PRIMARY KEY(org_id,realm,request_ref)) STRICT",
  },
  {
    type: "index",
    name: "integration_stock_journal_external",
    tbl_name: "integration_stock_journals",
    sql: "CREATE UNIQUE INDEX integration_stock_journal_external ON integration_stock_journals(org_id,realm,external_id) WHERE external_id IS NOT NULL",
  },
  {
    type: "table",
    name: "integration_stock_journal_observations",
    tbl_name: "integration_stock_journal_observations",
    sql: "CREATE TABLE integration_stock_journal_observations(journal_id TEXT NOT NULL REFERENCES integration_stock_journals(id),revision INTEGER NOT NULL CHECK(revision>0),org_id TEXT NOT NULL,body TEXT NOT NULL,hash TEXT NOT NULL,recorded_by TEXT NOT NULL,recorded_at TEXT NOT NULL,PRIMARY KEY(journal_id,revision)) STRICT",
  },
] as const;
export const STOCK_JOURNAL_DDL = STOCK_JOURNAL_SCHEMA.map((o) => o.sql).join(
  ";",
);
export const STOCK_JOURNAL_INITIALIZE_DDL = STOCK_JOURNAL_DDL.replaceAll(
  "CREATE TABLE",
  "CREATE TABLE IF NOT EXISTS",
).replaceAll("CREATE UNIQUE INDEX", "CREATE UNIQUE INDEX IF NOT EXISTS");
