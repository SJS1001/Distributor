import { RestoreActivation } from "./restore-activation.ts";
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
import type {
  DispositionCommandReceipt,
  IntegrationDispositionReceipts,
} from "./integration-restore-dispositions.ts";
import type {
  Reconciliation,
  ReconciliationHistory,
} from "../shared/reconciliation.ts";
import {
  reconciliationCommand,
  retainReconciliation,
  validateReconciliation,
  reconciliationMetadata,
  type RetainedReconciliation,
} from "./reconciliation-receipt.ts";

export class Platform {
  readonly restore: RestoreActivation;
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
    this.restore = new RestoreActivation(database);
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
    const hold =
      this.store.get("SELECT * FROM platform_recovery WHERE id=1") ?? null;
    return hold && !this.restore.permits() ? hold : null;
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
    this.restore.isolate();
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
      this.restore.assertCommandAccess();
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
  // Read-only recovery for the journal owner's one named preparation command.
  // An absent receipt never authorizes abandoning or replacing a pending key.
  journalPreparationReceiptInTransaction(actor: Actor, key: string) {
    this.database.requireTransaction();
    actor = this.authorizeRead(actor);
    permit(actor, ["finance"]);
    text(key, "Preparation key", 128);
    const row = this.store.get(
      "SELECT hash,result FROM platform_commands WHERE org_id=? AND actor_id=? AND name='accounting.journal.prepare' AND key=?",
      actor.orgId,
      actor.id,
      key,
    );
    check(
      row,
      "NOT_FOUND",
      "No committed journal preparation receipt was found for this principal and key.",
      404,
    );
    return {
      requestHash: String(row.hash),
      result: JSON.parse(String(row.result)) as unknown,
    };
  }
  /** Trusted native maintenance port, not external evidence or release authority.
   * The reader is current IAM finance staff; historical authors stay unchanged. */
  integrationDispositionReceipts(actor: Actor): IntegrationDispositionReceipts {
    const principal = structuredClone(actor);
    return Object.freeze<IntegrationDispositionReceipts>({
      forResultInTransaction: (orgId, command, resultId) => {
        this.database.requireTransaction();
        const current = this.reconciliationAuthority(principal);
        check(
          !current.accountId &&
            current.id === principal.id &&
            current.orgId === principal.orgId &&
            orgId === current.orgId,
          "FORBIDDEN",
          "Current organization finance staff authority is required.",
          403,
        );
        const exactText = (v: unknown, max = 160): v is string =>
          typeof v === "string" &&
          v.length > 0 &&
          v.length <= max &&
          v === v.trim();
        check(
          exactText(orgId) &&
            exactText(resultId) &&
            [
              "quickbooks.credit.apply",
              "quickbooks.credit.cancel",
              "stripe.checkout.renew",
            ].includes(command),
          "VALIDATION",
          "Use an exact supported disposition command and result identity.",
          400,
        );
        const receipts: DispositionCommandReceipt[] = [];
        // Scan the complete scoped command history before selecting the result.
        // SQL JSON filtering could hide damaged/ambiguous records as no match.
        // No historical actor filter, page, cache or second connection is safe.
        for (const row of this.store.all(
          "SELECT org_id,actor_id,name,key,hash,result,created_at FROM platform_commands WHERE org_id=? AND name=? ORDER BY actor_id,key",
          orgId,
          command,
        )) {
          let result: unknown;
          try {
            result = JSON.parse(String(row.result));
          } catch {
            // The integrity check below rejects this row, including malformed JSON.
          }
          check(
            row.org_id === orgId &&
              row.name === command &&
              exactText(row.actor_id) &&
              exactText(row.key, 128) &&
              typeof row.hash === "string" &&
              /^[a-f0-9]{64}$/.test(row.hash) &&
              typeof row.created_at === "string" &&
              Number.isFinite(Date.parse(row.created_at)) &&
              new Date(row.created_at).toISOString() === row.created_at &&
              result !== null &&
              typeof result === "object" &&
              !Array.isArray(result) &&
              exactText((result as { id?: unknown }).id) &&
              JSON.stringify(result) === row.result,
            "RESTORE_RECEIPT_INTEGRITY",
            "Retained disposition command history is malformed. Reconcile the original receipts.",
          );
          if ((result as { id: string }).id === resultId)
            receipts.push({
              orgId,
              actorId: row.actor_id as string,
              command,
              key: row.key as string,
              requestHash: row.hash as string,
              result,
              createdAt: row.created_at as string,
            });
        }
        return receipts;
      },
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
  private reconciliationAuthority(actor: Actor) {
    check(
      this.readAuthority,
      "AUTHORITY",
      "Reconciliation authority is unavailable.",
      503,
    );
    const current = this.readAuthority(actor);
    permit(current, ["finance"]);
    return current;
  }
  prepareReconciliation(
    actor: Actor,
    key: string,
    input: { expectedHash: string },
    snapshot: (actor: Actor) => Reconciliation,
  ) {
    actor = this.reconciliationAuthority(actor);
    check(
      typeof input?.expectedHash === "string" &&
        /^[a-f0-9]{64}$/.test(input.expectedHash),
      "REVIEW_HASH",
      "Review the current reconciliation before saving.",
      400,
    );
    let retained: RetainedReconciliation;
    try {
      retained = this.command<RetainedReconciliation>(
        actor,
        reconciliationCommand,
        key,
        input,
        (cached) => {
          actor = this.reconciliationAuthority(actor);
          if (cached !== undefined) {
            const r = validateReconciliation(cached, actor.orgId);
            check(
              r.preparedBy === actor.id,
              "REPORT_INTEGRITY",
              "Retained reconciliation evidence is unavailable. Investigate the original receipt.",
              503,
            );
          }
        },
        () => {
          const report = snapshot(actor);
          check(
            report.snapshotHash === input.expectedHash,
            "STALE_RECONCILIATION",
            "The controls have changed. Run reconciliation and review again before saving.",
          );
          return retainReconciliation(actor, report);
        },
      );
    } catch (e) {
      if (e instanceof SyntaxError)
        check(
          false,
          "REPORT_INTEGRITY",
          "Retained reconciliation evidence is unavailable. Investigate the original receipt.",
          503,
        );
      throw e;
    }
    return reconciliationMetadata(retained);
  }
  private reconciliationRows(
    actor: Actor,
    suffix: string,
    ...args: (string | number)[]
  ) {
    return this.store.all<{ auditId: string; actorId: string; result: string }>(
      `SELECT a.id AS auditId,a.actor_id AS actorId,c.result FROM platform_audit_order o
       JOIN platform_audit a ON a.id=o.audit_id AND a.org_id=o.org_id
       JOIN platform_commands c ON c.org_id=a.org_id AND c.actor_id=a.actor_id AND c.name=a.action AND c.key=a.reference
       WHERE o.org_id=? AND a.action=? ${suffix}`,
      actor.orgId,
      reconciliationCommand,
      ...args,
    );
  }
  private decodeReconciliation(result: string, orgId: string, actorId: string) {
    let value: unknown;
    try {
      value = JSON.parse(result);
    } catch {
      check(
        false,
        "REPORT_INTEGRITY",
        "Retained reconciliation evidence is unavailable. Investigate the original receipt.",
        503,
      );
    }
    const r = validateReconciliation(value, orgId);
    check(
      r.preparedBy === actorId,
      "REPORT_INTEGRITY",
      "Retained reconciliation evidence is unavailable. Investigate the original receipt.",
      503,
    );
    return r;
  }
  reconciliationDocument(actor: Actor, receiptId: string) {
    return this.database.transaction(() => {
      actor = this.reconciliationAuthority(actor);
      receiptId = text(receiptId, "Reconciliation receipt", 128);
      const rows = this.reconciliationRows(
        actor,
        "AND CASE WHEN json_valid(c.result) THEN json_extract(c.result,'$.id') ELSE NULL END=? LIMIT 2",
        receiptId,
      );
      check(
        rows.length === 1,
        "NOT_FOUND",
        "Reconciliation receipt is unavailable.",
        404,
      );
      return this.decodeReconciliation(
        rows[0]!.result,
        actor.orgId,
        rows[0]!.actorId,
      );
    });
  }
  reconciliationHistory(actor: Actor, after?: string): ReconciliationHistory {
    return this.database.transaction(() => {
      actor = this.reconciliationAuthority(actor);
      let before: number | null = null;
      if (after !== undefined) {
        after = text(after, "Reconciliation cursor", 128);
        const cursor = this.store.get(
          "SELECT o.sequence FROM platform_audit_order o JOIN platform_audit a ON a.id=o.audit_id AND a.org_id=o.org_id JOIN platform_commands c ON c.org_id=a.org_id AND c.actor_id=a.actor_id AND c.name=a.action AND c.key=a.reference WHERE o.org_id=? AND a.action=? AND a.id=?",
          actor.orgId,
          reconciliationCommand,
          after,
        );
        check(cursor, "CURSOR", "Reconciliation cursor is unavailable.", 400);
        before = Number(cursor.sequence);
      }
      const rows = this.reconciliationRows(
        actor,
        `${before === null ? "" : "AND o.sequence<?"} ORDER BY o.sequence DESC LIMIT 21`,
        ...(before === null ? [] : [before]),
      );
      return {
        items: rows
          .slice(0, 20)
          .map((r) =>
            reconciliationMetadata(
              this.decodeReconciliation(r.result, actor.orgId, r.actorId),
            ),
          ),
        next: rows.length > 20 ? rows[19]!.auditId : null,
      };
    });
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
  // Owning audit projection for catalog lifecycle review; no foreign-table access.
  catalogLifecyclePage(actor: Actor, productId: string, after?: string) {
    check(
      this.readAuthority,
      "AUTHORITY",
      "Catalog audit authority is unavailable.",
      503,
    );
    actor = this.readAuthority(actor);
    permit(actor, ["commercial"]);
    productId = text(productId, "Product ID", 128);
    let before: number | null = null;
    if (after !== undefined) {
      const cursor = this.store.get(
        `SELECT o.sequence FROM platform_audit_order o JOIN platform_audit a ON a.id=o.audit_id AND a.org_id=o.org_id
         WHERE o.org_id=? AND a.action='product.lifecycle' AND a.reference=? AND a.id=?`,
        actor.orgId,
        productId,
        text(after, "Catalog history cursor", 128),
      );
      check(cursor, "CURSOR", "Catalog history cursor is unavailable.", 400);
      before = Number(cursor.sequence);
    }
    const rows = this.store.all<{
      id: string;
      actorId: string;
      createdAt: string;
      detail: string;
    }>(
      `SELECT a.id,a.actor_id AS actorId,a.created_at AS createdAt,a.detail
       FROM platform_audit_order o JOIN platform_audit a ON a.id=o.audit_id AND a.org_id=o.org_id
       WHERE o.org_id=? AND a.action='product.lifecycle' AND a.reference=?
       ${before === null ? "" : "AND o.sequence<?"} ORDER BY o.sequence DESC LIMIT 21`,
      actor.orgId,
      productId,
      ...(before === null ? [] : [before]),
    );
    return {
      items: rows.slice(0, 20),
      next: rows.length > 20 ? rows[19]!.id : null,
    };
  }
  // Compile-time application composition; no business module imports the optional report.
  configureProjection(run: () => number) {
    this.projection = run;
  }
  project(enabled: boolean) {
    return enabled ? (this.projection?.() ?? 0) : 0;
  }
}
