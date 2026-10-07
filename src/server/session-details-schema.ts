// Recognition details are separate from session credentials. Historical sessions
// receive only a random reference during explicit upgrade; no dates are inferred.
export const SESSION_DETAILS_SCHEMA = [
  {
    type: "table",
    name: "iam_session_details",
    tbl_name: "iam_session_details",
    sql: "CREATE TABLE iam_session_details(session_hash TEXT PRIMARY KEY REFERENCES iam_sessions(hash) ON DELETE CASCADE,reference TEXT NOT NULL UNIQUE CHECK(length(reference)=32),created_at INTEGER,last_activity_at INTEGER,device_description TEXT CHECK(device_description IS NULL OR length(device_description)<=100),CHECK(created_at IS NULL OR created_at>0),CHECK(last_activity_at IS NULL OR last_activity_at>0)) STRICT",
  },
] as const;
export const SESSION_DETAILS_DDL = SESSION_DETAILS_SCHEMA.map(
  (o) => o.sql,
).join(";");
export const SESSION_DETAILS_INITIALIZE = SESSION_DETAILS_DDL.replaceAll(
  "CREATE TABLE",
  "CREATE TABLE IF NOT EXISTS",
);
export const SESSION_DETAILS_BACKFILL =
  "INSERT INTO iam_session_details(session_hash,reference) SELECT hash,lower(hex(randomblob(16))) FROM iam_sessions";
