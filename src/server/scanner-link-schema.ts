export const SCANNER_LINK_SCHEMA = [
  {
    type: "table",
    name: "platform_scanner_links",
    tbl_name: "platform_scanner_links",
    sql: "CREATE TABLE platform_scanner_links(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,actor_id TEXT NOT NULL,attempt_key TEXT NOT NULL,request_hash TEXT NOT NULL,channel TEXT NOT NULL CHECK(channel IN('email','sms')),recipient_hint TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('unknown','accepted','confirmed','rejected')),created_at TEXT NOT NULL,UNIQUE(org_id,actor_id,attempt_key)) STRICT",
  },
] as const;
export const SCANNER_LINK_INITIALIZE = SCANNER_LINK_SCHEMA.map((o) =>
  o.sql.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS"),
).join(";");
