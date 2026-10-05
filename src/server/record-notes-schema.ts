export const RECORD_NOTES_SCHEMA = [
  {
    type: "table",
    name: "notes_records",
    tbl_name: "notes_records",
    sql: "CREATE TABLE notes_records(sequence INTEGER PRIMARY KEY,id TEXT NOT NULL UNIQUE,org_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('customer','product','order','invoice','shipment')),record_id TEXT NOT NULL,body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 4000),author_id TEXT NOT NULL,author_name TEXT NOT NULL,created_at TEXT NOT NULL) STRICT",
  },
  {
    type: "table",
    name: "notes_verifications",
    tbl_name: "notes_verifications",
    sql: "CREATE TABLE notes_verifications(note_id TEXT PRIMARY KEY REFERENCES notes_records(id),org_id TEXT NOT NULL,verifier_id TEXT NOT NULL,verifier_name TEXT NOT NULL,verified_at TEXT NOT NULL) STRICT",
  },
  {
    type: "index",
    name: "notes_record_page",
    tbl_name: "notes_records",
    sql: "CREATE INDEX notes_record_page ON notes_records(org_id,kind,record_id,sequence)",
  },
  ...["notes_records", "notes_verifications"].flatMap((table) =>
    ["UPDATE", "DELETE"].map((operation) => ({
      type: "trigger",
      name: `${table}_immutable_${operation.toLowerCase()}`,
      tbl_name: table,
      sql: `CREATE TRIGGER ${table}_immutable_${operation.toLowerCase()} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'Record notes are append-only'); END`,
    })),
  ),
] as const;
export const RECORD_NOTES_DDL = RECORD_NOTES_SCHEMA.map((o) => o.sql).join(";");
export const RECORD_NOTES_INITIALIZE = RECORD_NOTES_DDL.replaceAll(
  "CREATE TABLE",
  "CREATE TABLE IF NOT EXISTS",
)
  .replaceAll("CREATE INDEX", "CREATE INDEX IF NOT EXISTS")
  .replaceAll("CREATE TRIGGER", "CREATE TRIGGER IF NOT EXISTS");
