// Frozen schema-17 additions; prior recovery records and business rows are retained.
export const RESTORE_ACTIVATION_SCHEMA = [
  {
    type: "table",
    name: "platform_restore_releases",
    tbl_name: "platform_restore_releases",
    sql: "CREATE TABLE platform_restore_releases(id TEXT PRIMARY KEY,state TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),record TEXT NOT NULL,hash TEXT NOT NULL) STRICT",
  },
  {
    type: "index",
    name: "platform_restore_single_release",
    tbl_name: "platform_restore_releases",
    sql: "CREATE UNIQUE INDEX platform_restore_single_release ON platform_restore_releases((1)) WHERE state NOT IN('rolled-back','superseded')",
  },
];
export const RESTORE_ACTIVATION_DDL = RESTORE_ACTIVATION_SCHEMA.map(
  (o) => o.sql,
).join(";");
