// Version 5: retained claim assessment provenance; historical rows stay absent.
export const CLAIM_COVERAGE_SCHEMA = [
  {
    type: "table",
    name: "warranty_claim_coverage",
    tbl_name: "warranty_claim_coverage",
    sql: "CREATE TABLE warranty_claim_coverage(claim_id TEXT PRIMARY KEY REFERENCES warranty_claims(id),org_id TEXT NOT NULL,snapshot TEXT NOT NULL) STRICT",
  },
] as const;
export const CLAIM_COVERAGE_DDL = CLAIM_COVERAGE_SCHEMA.map(
  (entry) => entry.sql,
).join(";");
export const CLAIM_COVERAGE_INITIALIZE_DDL = CLAIM_COVERAGE_DDL.replace(
  "CREATE TABLE",
  "CREATE TABLE IF NOT EXISTS",
);
