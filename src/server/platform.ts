import {
  canonical,
  check,
  digest,
  id,
  now,
  permit,
  text,
  type Actor,
} from "./core.ts";
import { Database, type Store } from "./database.ts";

export class Platform {
  private store: Store;
  private projection?: () => number;
  private readAuthority?: (actor: Actor) => Actor;
  constructor(private database: Database) {
    this.store = database.owned("platform");
    this.store.migrate(`
      CREATE TABLE IF NOT EXISTS platform_commands (org_id TEXT NOT NULL, actor_id TEXT NOT NULL, name TEXT NOT NULL, key TEXT NOT NULL, hash TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(org_id,actor_id,name,key)) STRICT;
      CREATE TABLE IF NOT EXISTS platform_audit (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL, reference TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS platform_events (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, type TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, reference TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS platform_projections (event_id TEXT PRIMARY KEY, org_id TEXT NOT NULL, type TEXT NOT NULL, reference TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS platform_recovery (id INTEGER PRIMARY KEY CHECK(id=1), snapshot_hash TEXT NOT NULL, restored_at TEXT NOT NULL, source_completed_at TEXT NOT NULL) STRICT;
    `);
    // Preserve existing IDs/bytes. A durable sequence avoids timestamp ties,
    // clock rollback and rowid changes during later SQLite maintenance.
    this.database.transaction(() =>
      this.store.migrate(`
      CREATE TABLE IF NOT EXISTS platform_audit_order (sequence INTEGER PRIMARY KEY, audit_id TEXT NOT NULL UNIQUE REFERENCES platform_audit(id), org_id TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS platform_audit_clock (id INTEGER PRIMARY KEY CHECK(id=1),sequence INTEGER NOT NULL) STRICT;
      INSERT INTO platform_audit_clock VALUES(1,0) ON CONFLICT(id) DO NOTHING;
      CREATE INDEX IF NOT EXISTS platform_audit_order_org ON platform_audit_order(org_id,sequence);
      INSERT INTO platform_audit_order(sequence,audit_id,org_id)
        SELECT rowid,id,org_id FROM platform_audit WHERE id NOT IN (SELECT audit_id FROM platform_audit_order) ORDER BY rowid;
      UPDATE platform_audit_clock SET sequence=MAX(sequence,COALESCE((SELECT MAX(sequence) FROM platform_audit_order),0)) WHERE id=1;
      CREATE TRIGGER IF NOT EXISTS platform_audit_sequence AFTER INSERT ON platform_audit BEGIN
        UPDATE platform_audit_clock SET sequence=sequence+1 WHERE id=1;
        INSERT INTO platform_audit_order(sequence,audit_id,org_id) SELECT sequence,new.id,new.org_id FROM platform_audit_clock WHERE id=1;
      END;
    `),
    );
  }
  recoveryHold() {
    return this.store.get("SELECT * FROM platform_recovery WHERE id=1") ?? null;
  }
  assertProviderAccess() {
    check(
      !this.recoveryHold(),
      "RECOVERY_HOLD",
      "Restored database is isolated. Reconcile external outcomes and customer choices before provider activation.",
      503,
    );
  }
  // Filesystem-authorized restore orchestration only; never exposed as a tenant command.
  isolateRestore(snapshotHash: string, sourceCompletedAt: string) {
    this.store.run(
      "INSERT INTO platform_recovery VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET snapshot_hash=excluded.snapshot_hash,restored_at=excluded.restored_at,source_completed_at=excluded.source_completed_at",
      snapshotHash,
      now(),
      sourceCompletedAt,
    );
  }
  command<T>(
    actor: Actor,
    name: string,
    key: string,
    payload: unknown,
    authorize: (cachedResult?: T) => void,
    perform: () => T,
  ): T {
    text(key, "Idempotency key", 128);
    return this.database.transaction(() => {
      const old = this.store.get(
        "SELECT hash,result FROM platform_commands WHERE org_id=? AND actor_id=? AND name=? AND key=?",
        actor.orgId,
        actor.id,
        name,
        key,
      );
      const cachedResult = old
        ? (JSON.parse(String(old.result)) as T)
        : undefined;
      authorize(cachedResult);
      const hash = digest(canonical(payload));
      if (old) {
        check(
          old.hash === hash,
          "IDEMPOTENCY_CONFLICT",
          "This request key was already used with different inputs.",
        );
        return cachedResult!;
      }
      const result = perform();
      this.store.run(
        "INSERT INTO platform_commands VALUES(?,?,?,?,?,?,?)",
        actor.orgId,
        actor.id,
        name,
        key,
        hash,
        JSON.stringify(result),
        now(),
      );
      this.audit(actor, name, key, { requestHash: hash });
      return result;
    });
  }
  audit(actor: Actor, action: string, reference: string, detail: unknown) {
    this.store.run(
      "INSERT INTO platform_audit VALUES(?,?,?,?,?,?,?)",
      id(),
      actor.orgId,
      actor.id,
      action,
      reference,
      canonical(detail),
      now(),
    );
  }
  event(actor: Actor, type: string, reference: string, payload: unknown) {
    this.store.run(
      "INSERT INTO platform_events(id,org_id,type,reference,payload,created_at) VALUES(?,?,?,?,?,?)",
      id(),
      actor.orgId,
      type,
      reference,
      canonical(payload),
      now(),
    );
  }
  events(actor: Actor) {
    actor = this.authorizeRead(actor);
    return this.store.all(
      "SELECT * FROM platform_events WHERE org_id=? ORDER BY created_at DESC LIMIT 200",
      actor.orgId,
    );
  }
  audits(actor: Actor) {
    actor = this.authorizeRead(actor);
    return this.store.all(
      "SELECT * FROM platform_audit WHERE org_id=? ORDER BY created_at DESC LIMIT 200",
      actor.orgId,
    );
  }
  configureReadAuthority(authorize: (actor: Actor) => Actor) {
    this.readAuthority = authorize;
  }
  private authorizeRead(actor: Actor) {
    check(
      this.readAuthority,
      "AUTHORITY",
      "Audit authority is unavailable.",
      503,
    );
    const current = this.readAuthority(actor);
    permit(current, ["support"]);
    return current;
  }
  auditPage(actor: Actor, after?: string) {
    actor = this.authorizeRead(actor);
    let before: number | null = null;
    if (after !== undefined) {
      after = text(after, "Audit cursor", 128);
      const cursor = this.store.get(
        "SELECT sequence FROM platform_audit_order WHERE org_id=? AND audit_id=?",
        actor.orgId,
        after,
      );
      check(cursor, "CURSOR", "Audit cursor is unavailable.", 400);
      before = Number(cursor.sequence);
    }
    const rows = this.store.all(
      `SELECT a.id,a.actor_id,a.action,a.reference,a.created_at FROM platform_audit_order o
       JOIN platform_audit a ON a.id=o.audit_id AND a.org_id=o.org_id
       WHERE o.org_id=? ${before === null ? "" : "AND o.sequence<?"}
       ORDER BY o.sequence DESC LIMIT 21`,
      ...[actor.orgId, ...(before === null ? [] : [before])],
    );
    const items = rows.slice(0, 20);
    return { items, next: rows.length > 20 ? String(items.at(-1)!.id) : null };
  }
  // Compile-time application composition; no business module imports the optional report.
  configureProjection(run: () => number) {
    this.projection = run;
  }
  project(enabled: boolean) {
    return enabled ? (this.projection?.() ?? 0) : 0;
  }
}
