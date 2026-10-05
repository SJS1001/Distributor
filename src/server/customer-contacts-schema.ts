export const CUSTOMER_CONTACTS_SCHEMA = [
  {
    type: "table",
    name: "iam_customer_contacts",
    tbl_name: "iam_customer_contacts",
    sql: "CREATE TABLE iam_customer_contacts(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,account_id TEXT NOT NULL,name TEXT NOT NULL,title TEXT NOT NULL,email TEXT NOT NULL,phone TEXT NOT NULL,archived INTEGER NOT NULL CHECK(archived IN(0,1)),revision INTEGER NOT NULL CHECK(revision>0),created_at TEXT NOT NULL,created_by TEXT NOT NULL,updated_at TEXT NOT NULL,updated_by TEXT NOT NULL) STRICT",
  },
  {
    type: "index",
    name: "iam_customer_contacts_account",
    tbl_name: "iam_customer_contacts",
    sql: "CREATE INDEX iam_customer_contacts_account ON iam_customer_contacts(org_id,account_id,updated_at,id)",
  },
] as const;
export const CUSTOMER_CONTACTS_DDL = CUSTOMER_CONTACTS_SCHEMA.map(
  (o) => o.sql,
).join(";");
export const CUSTOMER_CONTACTS_INITIALIZE = CUSTOMER_CONTACTS_DDL.replaceAll(
  "CREATE TABLE",
  "CREATE TABLE IF NOT EXISTS",
).replaceAll("CREATE INDEX", "CREATE INDEX IF NOT EXISTS");
