// Version 2 additions. These exact SQLite identities are shared by fresh
// initialization and the explicit clone upgrade; changing them needs a version.
export const CANADA_POST_SCHEMA = [
  {
    type: "table",
    name: "integration_canada_post_groups",
    tbl_name: "integration_canada_post_groups",
    sql: "CREATE TABLE integration_canada_post_groups(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,warehouse_id TEXT NOT NULL,configuration_hash TEXT NOT NULL,provider_group_id TEXT NOT NULL,review_hash TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('prepared','creating','closed','transmitting','unknown','transmitted','canceled')),token TEXT,started_at INTEGER,observation TEXT,manifest_bytes BLOB,manifest_hash TEXT,created_at TEXT NOT NULL,UNIQUE(org_id,configuration_hash,provider_group_id)) STRICT",
  },
  {
    type: "table",
    name: "integration_canada_post_members",
    tbl_name: "integration_canada_post_members",
    sql: "CREATE TABLE integration_canada_post_members(group_id TEXT NOT NULL REFERENCES integration_canada_post_groups(id),booking_id TEXT NOT NULL REFERENCES integration_carrier_bookings(id),org_id TEXT NOT NULL,review_hash TEXT NOT NULL,active INTEGER NOT NULL CHECK(active IN(0,1)),state TEXT NOT NULL CHECK(state IN('pending','creating','unknown','created')),token TEXT,started_at INTEGER,provider_shipment_id TEXT,tracking TEXT,label_bytes BLOB,label_hash TEXT,PRIMARY KEY(group_id,booking_id)) STRICT",
  },
  {
    type: "index",
    name: "integration_canada_post_active_member",
    tbl_name: "integration_canada_post_members",
    sql: "CREATE UNIQUE INDEX integration_canada_post_active_member ON integration_canada_post_members(booking_id) WHERE active=1",
  },
  {
    type: "index",
    name: "integration_canada_post_groups_org",
    tbl_name: "integration_canada_post_groups",
    sql: "CREATE INDEX integration_canada_post_groups_org ON integration_canada_post_groups(org_id,warehouse_id,created_at,id)",
  },
] as const;

export const CANADA_POST_DDL = CANADA_POST_SCHEMA.map(
  (entry) => entry.sql,
).join(";");
export const CANADA_POST_INITIALIZE_DDL = CANADA_POST_SCHEMA.map((entry) =>
  entry.sql.replace(
    /^CREATE ((?:UNIQUE )?INDEX|TABLE)/,
    "CREATE $1 IF NOT EXISTS",
  ),
).join(";");
