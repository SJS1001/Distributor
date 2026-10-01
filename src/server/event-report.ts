import { canonical, digest } from "./core.ts";
import { type Database, type Store } from "./database.ts";
import { type EventConsumer, type LocalEvent } from "./event-delivery.ts";

// Optional metadata report, never a stock, money or provider authority.
export class EventReport implements EventConsumer {
  readonly id = "event-report";
  readonly version = 1;
  readonly eventVersions = [1];
  private store: Store;
  constructor(database: Database) {
    this.store = database.owned("report");
    this.store.migrate(`
      CREATE TABLE IF NOT EXISTS report_events(event_id TEXT PRIMARY KEY,org_id TEXT NOT NULL,type TEXT NOT NULL,reference TEXT NOT NULL,occurred_at TEXT NOT NULL,payload_hash TEXT NOT NULL) STRICT;
      CREATE INDEX IF NOT EXISTS report_events_org ON report_events(org_id,occurred_at,event_id);
    `);
  }
  apply(event: LocalEvent) {
    this.store.run(
      "INSERT INTO report_events VALUES(?,?,?,?,?,?)",
      event.id,
      event.orgId,
      event.type,
      event.reference,
      event.createdAt,
      digest(canonical(event.payload)),
    );
  }
}
