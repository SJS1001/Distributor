export const ORGANIZATION_RESIDENCY_SCHEMA = [
  {
    type: "table",
    name: "iam_ledger_disclosures",
    tbl_name: "iam_ledger_disclosures",
    sql: "CREATE TABLE iam_ledger_disclosures(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,region TEXT NOT NULL CHECK(region IN('CA','US')),version TEXT NOT NULL,body TEXT NOT NULL,hash TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(org_id,region,version)) STRICT",
  },
  {
    type: "table",
    name: "iam_ledger_disclosure_current",
    tbl_name: "iam_ledger_disclosure_current",
    sql: "CREATE TABLE iam_ledger_disclosure_current(org_id TEXT PRIMARY KEY,disclosure_id TEXT NOT NULL REFERENCES iam_ledger_disclosures(id)) STRICT",
  },
  {
    type: "table",
    name: "iam_ledger_choices",
    tbl_name: "iam_ledger_choices",
    sql: "CREATE TABLE iam_ledger_choices(org_id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>1),region TEXT NOT NULL CHECK(region IN('CA','US')),mode TEXT NOT NULL CHECK(mode IN('strict','provider-exception')),realm TEXT,disclosure_id TEXT REFERENCES iam_ledger_disclosures(id),disclosure_hash TEXT,body TEXT NOT NULL,hash TEXT NOT NULL,recorded_by TEXT NOT NULL,recorded_at TEXT NOT NULL,PRIMARY KEY(org_id,revision),CHECK((mode='strict' AND realm IS NULL AND disclosure_id IS NULL AND disclosure_hash IS NULL) OR (mode='provider-exception' AND realm IS NOT NULL AND disclosure_id IS NOT NULL AND disclosure_hash IS NOT NULL))) STRICT",
  },
] as const;
export const ORGANIZATION_RESIDENCY_DDL = ORGANIZATION_RESIDENCY_SCHEMA.map(
  (o) => o.sql,
).join(";");
export const ORGANIZATION_RESIDENCY_INITIALIZE_DDL =
  ORGANIZATION_RESIDENCY_DDL.replaceAll(
    "CREATE TABLE",
    "CREATE TABLE IF NOT EXISTS",
  );
