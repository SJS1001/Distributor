export const ENROLLMENT_SCHEMA = [
  {
    type: "table",
    name: "enrollment_applications",
    tbl_name: "enrollment_applications",
    sql: "CREATE TABLE enrollment_applications(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,business_name TEXT NOT NULL,contact_name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT NOT NULL,province TEXT NOT NULL,business_number TEXT NOT NULL,notes TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('pending','approved','rejected','activated')),created_at TEXT NOT NULL,reviewed_at TEXT,review_reason TEXT,tier TEXT,credit_limit INTEGER,account_id TEXT,sponsor TEXT,sponsor_revision INTEGER,token_hash TEXT UNIQUE,expires_at INTEGER,user_id TEXT,UNIQUE(org_id,email)) STRICT",
  },
  {
    type: "index",
    name: "enrollment_queue",
    tbl_name: "enrollment_applications",
    sql: "CREATE INDEX enrollment_queue ON enrollment_applications(org_id,id)",
  },
  {
    type: "table",
    name: "enrollment_limits",
    tbl_name: "enrollment_limits",
    sql: "CREATE TABLE enrollment_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL CHECK(count>=0),reset_at INTEGER NOT NULL) STRICT",
  },
] as const;
export const ENROLLMENT_DDL = ENROLLMENT_SCHEMA.map((o) => o.sql).join(";");
export const ENROLLMENT_INITIALIZE = ENROLLMENT_DDL.replaceAll(
  "CREATE TABLE",
  "CREATE TABLE IF NOT EXISTS",
).replaceAll("CREATE INDEX", "CREATE INDEX IF NOT EXISTS");
