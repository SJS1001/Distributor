// Schema 18: storage provenance only. No generation or session is backfilled.
const tables = [
  [
    "platform_offline_generations",
    "instance_id TEXT PRIMARY KEY,created_revision INTEGER NOT NULL UNIQUE CHECK(created_revision>0),generation TEXT NOT NULL,generation_hash TEXT NOT NULL",
  ],
  [
    "platform_offline_journal",
    "revision INTEGER PRIMARY KEY CHECK(revision>0),instance_id TEXT NOT NULL REFERENCES platform_offline_generations(instance_id),record TEXT NOT NULL,previous_hash TEXT NOT NULL,state_hash TEXT NOT NULL,hash TEXT NOT NULL",
  ],
  [
    "platform_offline_head",
    "id INTEGER PRIMARY KEY CHECK(id=1),instance_id TEXT NOT NULL REFERENCES platform_offline_generations(instance_id),revision INTEGER NOT NULL REFERENCES platform_offline_journal(revision),state TEXT NOT NULL,state_hash TEXT NOT NULL,journal_hash TEXT NOT NULL",
  ],
  [
    "platform_offline_receipts",
    "owner TEXT NOT NULL,org_id TEXT NOT NULL,task_name TEXT NOT NULL,request_id TEXT NOT NULL,binding TEXT NOT NULL UNIQUE,instance_id TEXT NOT NULL REFERENCES platform_offline_generations(instance_id),session_id TEXT NOT NULL,revision INTEGER NOT NULL UNIQUE REFERENCES platform_offline_journal(revision),record TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(owner,org_id,task_name,request_id)",
  ],
] as const;
export const RESTORE_OFFLINE_SCHEMA = [
  ...tables.map(([name, columns]) => ({
    type: "table",
    name,
    tbl_name: name,
    sql: `CREATE TABLE ${name}(${columns}) STRICT`,
  })),
  ...tables
    .filter(([name]) => name !== "platform_offline_head")
    .flatMap(([table]) =>
      (["UPDATE", "DELETE"] as const).map((operation) => {
        const name = `${table}_no_${operation.toLowerCase()}`;
        return {
          type: "trigger",
          name,
          tbl_name: table,
          sql: `CREATE TRIGGER ${name} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'Offline provenance is append-only'); END`,
        };
      }),
    ),
];
export const RESTORE_OFFLINE_DDL = RESTORE_OFFLINE_SCHEMA.map(
  (o) => o.sql,
).join(";");
