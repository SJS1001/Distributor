// Version 33: local installation records and distinct ordinary-return policies.
export const WARRANTY_REGISTRATION_SCHEMA = [
  {
    type: "table",
    name: "warranty_return_policy",
    tbl_name: "warranty_return_policy",
    sql: "CREATE TABLE warranty_return_policy(org_id TEXT PRIMARY KEY,revision INTEGER NOT NULL CHECK(revision>=1),snapshot TEXT NOT NULL) STRICT",
  },
  {
    type: "table",
    name: "warranty_product_terms",
    tbl_name: "warranty_product_terms",
    sql: "CREATE TABLE warranty_product_terms(org_id TEXT NOT NULL,product_id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>=1),snapshot TEXT NOT NULL,PRIMARY KEY(org_id,product_id)) STRICT",
  },
  {
    type: "table",
    name: "warranty_installations",
    tbl_name: "warranty_installations",
    sql: "CREATE TABLE warranty_installations(org_id TEXT NOT NULL,account_id TEXT NOT NULL,unit_id TEXT NOT NULL,shipment_id TEXT NOT NULL,ownership_id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>=1),snapshot TEXT NOT NULL,PRIMARY KEY(org_id,account_id,unit_id,shipment_id,ownership_id)) STRICT",
  },
  {
    type: "table",
    name: "warranty_installation_history",
    tbl_name: "warranty_installation_history",
    sql: "CREATE TABLE warranty_installation_history(org_id TEXT NOT NULL,account_id TEXT NOT NULL,unit_id TEXT NOT NULL,shipment_id TEXT NOT NULL,ownership_id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>=1),snapshot TEXT NOT NULL,PRIMARY KEY(org_id,account_id,unit_id,shipment_id,ownership_id,revision)) STRICT",
  },
  {
    type: "table",
    name: "warranty_policy_history",
    tbl_name: "warranty_policy_history",
    sql: "CREATE TABLE warranty_policy_history(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('return','terms')),target_id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>=1),snapshot TEXT NOT NULL,reason TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(org_id,kind,target_id,revision)) STRICT",
  },
  {
    type: "table",
    name: "warranty_claim_eligibility",
    tbl_name: "warranty_claim_eligibility",
    sql: "CREATE TABLE warranty_claim_eligibility(claim_id TEXT PRIMARY KEY REFERENCES warranty_claims(id),org_id TEXT NOT NULL,snapshot TEXT NOT NULL) STRICT",
  },
] as const;
export const WARRANTY_REGISTRATION_DDL = WARRANTY_REGISTRATION_SCHEMA.map(
  (o) => o.sql,
).join(";");
export const WARRANTY_REGISTRATION_INITIALIZE =
  WARRANTY_REGISTRATION_DDL.replaceAll(
    "CREATE TABLE",
    "CREATE TABLE IF NOT EXISTS",
  );
