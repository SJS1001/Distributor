import {
  account,
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
  constructor(private database: Database) {
    this.store = database.owned("platform");
    this.store.migrate(`
      CREATE TABLE IF NOT EXISTS platform_commands (org_id TEXT NOT NULL, actor_id TEXT NOT NULL, name TEXT NOT NULL, key TEXT NOT NULL, hash TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(org_id,actor_id,name,key)) STRICT;
      CREATE TABLE IF NOT EXISTS platform_audit (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL, reference TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS platform_events (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, type TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, reference TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS platform_projections (event_id TEXT PRIMARY KEY, org_id TEXT NOT NULL, type TEXT NOT NULL, reference TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS platform_recovery (id INTEGER PRIMARY KEY CHECK(id=1), snapshot_hash TEXT NOT NULL, restored_at TEXT NOT NULL, source_completed_at TEXT NOT NULL) STRICT;
    `);
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
    permit(actor, ["support"]);
    return this.store.all(
      "SELECT * FROM platform_events WHERE org_id=? ORDER BY created_at DESC LIMIT 200",
      actor.orgId,
    );
  }
  audits(actor: Actor) {
    permit(actor, ["support"]);
    return this.store.all(
      "SELECT * FROM platform_audit WHERE org_id=? ORDER BY created_at DESC LIMIT 200",
      actor.orgId,
    );
  }
  // Compile-time application composition; no business module imports the optional report.
  configureProjection(run: () => number) {
    this.projection = run;
  }
  project(enabled: boolean) {
    return enabled ? (this.projection?.() ?? 0) : 0;
  }
}
