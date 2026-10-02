// Version 4: preserve reservations; only this explicit local receipt releases them.
export const ACCOUNTING_CANCELLATION_SCHEMA = [
  {
    type: "table",
    name: "integration_credit_cancellations",
    tbl_name: "integration_credit_cancellations",
    sql: "CREATE TABLE integration_credit_cancellations(effect_id TEXT PRIMARY KEY REFERENCES integration_credit_applications(effect_id),org_id TEXT NOT NULL,actor_id TEXT NOT NULL,reason TEXT NOT NULL,review_version TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),created_at TEXT NOT NULL) STRICT",
  },
] as const;
export const ACCOUNTING_CANCELLATION_DDL = ACCOUNTING_CANCELLATION_SCHEMA.map(
  (entry) => entry.sql,
).join(";");
export const ACCOUNTING_CANCELLATION_INITIALIZE_DDL =
  ACCOUNTING_CANCELLATION_DDL.replace(
    "CREATE TABLE",
    "CREATE TABLE IF NOT EXISTS",
  );
