import { canonical, check, id, permit, text, type Actor } from "./core.ts";
import type { Database, Store } from "./database.ts";
import type { Identity } from "./iam.ts";
import type { Platform } from "./platform.ts";
import type {
  Adapter,
  Effect,
  EffectResult,
  Integration,
} from "./integration.ts";

// Each send or reconciliation read has one durable, disposable claim. Recovery
// invalidates its token before a successor can apply an external result.
export class IntegrationOperations {
  constructor(
    private database: Database,
    private store: Store,
    private platform: Platform,
    private identity: Identity,
    private integration: Integration,
  ) {
    store.migrate(
      `CREATE TABLE IF NOT EXISTS integration_operation_leases(effect_id TEXT PRIMARY KEY,org_id TEXT NOT NULL,token TEXT,started_at INTEGER) STRICT;`,
    );
  }
  principal(actor: Actor) {
    actor = this.identity.currentActor(actor);
    permit(actor, ["finance", "support"]);
    check(
      !actor.accountId,
      "FORBIDDEN",
      "Buyer principals cannot run provider work.",
      403,
    );
    check(
      !this.identity.security(actor).passwordChangeRequired,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before running provider work.",
      403,
    );
    return actor;
  }
  // Called inside Integration's recovery transaction, including for read claims.
  recover(milliseconds: number, orgId: string | null) {
    const rows = this.store.all<{ effect_id: string }>(
      "SELECT effect_id FROM integration_operation_leases WHERE token IS NOT NULL AND started_at<? AND (? IS NULL OR org_id=?)",
      Date.now() - milliseconds,
      orgId,
      orgId,
    );
    for (const row of rows) {
      this.store.run(
        "UPDATE integration_effects SET state=CASE WHEN state='running' THEN 'unknown' ELSE state END,error='Worker interrupted; reconcile provider outcome before retry.' WHERE id=?",
        row.effect_id,
      );
      this.store.run(
        "UPDATE integration_operation_leases SET token=NULL,started_at=NULL WHERE effect_id=?",
        row.effect_id,
      );
    }
    return rows.length;
  }
  private release(actor: Actor, effect: Effect, token: string) {
    this.database.transaction(() => {
      const lease = this.store.get(
        "SELECT token FROM integration_operation_leases WHERE org_id=? AND effect_id=?",
        effect.org_id,
        effect.id,
      );
      if (lease?.token !== token) return;
      this.store.run(
        "UPDATE integration_effects SET state=CASE WHEN state='running' THEN 'unknown' ELSE state END,error=? WHERE id=?",
        "Provider verification incomplete; reconcile the external operation before any resend.",
        effect.id,
      );
      this.store.run(
        "UPDATE integration_operation_leases SET token=NULL,started_at=NULL WHERE effect_id=?",
        effect.id,
      );
      this.platform.audit(actor, "integration.unknown", effect.id, {});
    });
  }
  async run(actor: Actor, effectId: string, adapter: Adapter, send: boolean) {
    const token = id();
    const effect = this.database.transaction(() => {
      actor = this.principal(actor);
      this.platform.assertProviderAccess();
      const e = this.integration.effect(actor, effectId);
      check(
        e.kind !== "refund",
        "STATE",
        "Refunds require their own cash verification.",
      );
      check(
        e.state === (send ? "pending" : "unknown"),
        "STATE",
        send
          ? "Only pending operations may be sent."
          : "Only unknown outcomes need reconciliation.",
      );
      this.identity.providerAllowed(actor, e.account_id, e.provider);
      this.store.run(
        "INSERT OR IGNORE INTO integration_operation_leases(effect_id,org_id) VALUES(?,?)",
        effectId,
        actor.orgId,
      );
      const lease = this.store.get(
        "SELECT token FROM integration_operation_leases WHERE org_id=? AND effect_id=?",
        actor.orgId,
        effectId,
      );
      check(
        lease && !lease.token,
        "STATE",
        "Provider verification is already in progress.",
      );
      this.store.run(
        "UPDATE integration_operation_leases SET token=?,started_at=? WHERE effect_id=?",
        token,
        Date.now(),
        effectId,
      );
      if (send)
        this.store.run(
          "UPDATE integration_effects SET state='running',started_at=?,error=NULL WHERE id=?",
          Date.now(),
          effectId,
        );
      return e;
    });
    let result: EffectResult | null;
    try {
      result = send
        ? await adapter.execute(effect)
        : await adapter.lookup(effect);
    } catch (error) {
      this.release(actor, effect, token);
      if (!send) throw error;
      return {
        id: effectId,
        state: this.integration.effect(actor, effectId).state,
      };
    }
    try {
      return this.database.transaction(() => {
        actor = this.principal(actor);
        this.platform.assertProviderAccess();
        const lease = this.store.get(
          "SELECT token FROM integration_operation_leases WHERE org_id=? AND effect_id=?",
          actor.orgId,
          effectId,
        );
        check(
          lease?.token === token,
          "STATE",
          "Provider worker lease changed; its result must be read again.",
        );
        const current = this.integration.effect(actor, effectId);
        check(
          current.state === (send ? "running" : "unknown"),
          "STATE",
          "Provider operation changed during verification.",
        );
        // Current consent authorized this I/O. Retain its observed result even if
        // consent changed during the call; subsequent calls still require consent.
        if (result) {
          this.store.run(
            "UPDATE integration_effects SET state='completed',external_ref=?,result=?,error=NULL WHERE id=?",
            text(result.reference, "provider reference"),
            canonical(result.result),
            effectId,
          );
          this.platform.event(actor, "integration.completed", effectId, {
            provider: effect.provider,
            reference: result.reference,
          });
        } else {
          this.store.run(
            "UPDATE integration_effects SET state='unknown',error=? WHERE id=?",
            "No confirmed provider result; do not re-execute automatically.",
            effectId,
          );
        }
        this.store.run(
          "UPDATE integration_operation_leases SET token=NULL,started_at=NULL WHERE effect_id=?",
          effectId,
        );
        return { id: effectId, state: result ? "completed" : "unknown" };
      });
    } catch (error) {
      this.release(actor, effect, token);
      throw error;
    }
  }
}
