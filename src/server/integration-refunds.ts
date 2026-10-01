import { canonical, check, id, permit, type Actor } from "./core.ts";
import type { Database, Store } from "./database.ts";
import type { Platform } from "./platform.ts";
import type { Identity } from "./iam.ts";
import type { Billing } from "./billing.ts";
import type {
  Adapter,
  Effect,
  EffectResult,
  Integration,
} from "./integration.ts";
import type { RefundIntent } from "./billing-refunds.ts";

export class IntegrationRefunds {
  constructor(
    private database: Database,
    private store: Store,
    private platform: Platform,
    private identity: Identity,
    private billing: Billing,
    private integration: Integration,
  ) {
    store.migrate(
      `CREATE TABLE IF NOT EXISTS integration_refund_polls(effect_id TEXT PRIMARY KEY,org_id TEXT NOT NULL,token TEXT,started_at INTEGER,retry_at INTEGER NOT NULL DEFAULT 0) STRICT;`,
    );
  }
  register(actor: Actor, effectId: string) {
    this.store.run(
      "INSERT OR IGNORE INTO integration_refund_polls(effect_id,org_id) VALUES(?,?)",
      effectId,
      actor.orgId,
    );
  }
  private principal(actor: Actor) {
    const current = this.identity.currentActor(actor);
    permit(current, ["finance"]);
    // Same restriction as a background finance worker, including forced credential change.
    return this.identity.workerActor(current.orgId, current.id);
  }
  async run(
    actor: Actor,
    effectId: string,
    adapter: Adapter,
    send: boolean,
    verification?: {
      reference: string;
      assertCurrent: () => void;
      complete: () => void;
    },
  ) {
    actor = this.principal(actor);
    this.platform.assertProviderAccess();
    const token = id();
    const effect = this.database.transaction(() => {
      actor = this.principal(actor);
      this.platform.assertProviderAccess();
      verification?.assertCurrent();
      const e = this.integration.effect(actor, effectId);
      check(
        e.provider === "stripe" && e.kind === "refund",
        "STATE",
        "This operation is not a Stripe refund.",
      );
      check(
        send
          ? e.state === "pending"
          : ["unknown", "completed"].includes(e.state),
        "STATE",
        "Refund operation is not ready for this action.",
      );
      check(
        !verification ||
          (!send &&
            (!e.external_ref || e.external_ref === verification.reference)),
        "REFUND_MISMATCH",
        "Bound refund reference differs from signed event.",
      );
      this.identity.providerAllowed(actor, e.account_id, "stripe");
      const poll = this.store.get(
        "SELECT token FROM integration_refund_polls WHERE org_id=? AND effect_id=?",
        actor.orgId,
        effectId,
      );
      check(
        poll && !poll.token,
        "STATE",
        "Refund verification is already in progress.",
      );
      this.store.run(
        "UPDATE integration_refund_polls SET token=?,started_at=? WHERE effect_id=?",
        token,
        Date.now(),
        effectId,
      );
      if (send) {
        this.billing.refunds.markUnknown(actor, e.reference);
        this.store.run(
          "UPDATE integration_effects SET state='running',started_at=?,error=NULL WHERE id=?",
          Date.now(),
          effectId,
        );
      }
      return e;
    });
    try {
      const result = send
        ? await adapter.execute(effect)
        : await adapter.lookup(
            verification
              ? { ...effect, external_ref: verification.reference }
              : effect,
          );
      actor = this.principal(actor);
      return this.database.transaction(() => {
        actor = this.principal(actor);
        this.platform.assertProviderAccess();
        verification?.assertCurrent();
        const poll = this.store.get(
          "SELECT token FROM integration_refund_polls WHERE org_id=? AND effect_id=?",
          actor.orgId,
          effectId,
        );
        check(
          poll?.token === token,
          "STATE",
          "Refund worker lease changed; its result must be read again.",
        );
        // Consent was checked before I/O. An already observed result is retained even if
        // consent is withdrawn during I/O; no further provider reads are allowed afterwards.
        let status: string | null = null;
        if (result) {
          check(
            result.result.effectId === effect.id &&
              (!verification || result.reference === verification.reference),
            "REFUND_MISMATCH",
            "Provider effect identity differs from the refund intent.",
          );
          status = this.billing.refunds.observe(
            actor,
            JSON.parse(effect.payload) as RefundIntent,
            result.reference,
            result.result,
          );
          const current = this.integration.effect(actor, effectId);
          check(
            !current.external_ref || current.external_ref === result.reference,
            "REFUND_MISMATCH",
            "Bound refund reference changed.",
          );
          this.store.run(
            "UPDATE integration_effects SET state='completed',external_ref=?,result=?,error=NULL WHERE id=?",
            result.reference,
            canonical({ ...result.result, status }),
            effectId,
          );
          this.platform.event(actor, "integration.refund.observed", effectId, {
            reference: result.reference,
            status,
          });
        } else {
          check(
            !effect.external_ref && !verification,
            "REFUND_MISMATCH",
            "Previously bound refund was not returned by the provider.",
          );
          this.store.run(
            "UPDATE integration_effects SET state='unknown',error=? WHERE id=?",
            "No confirmed refund result; reconcile before any resend.",
            effectId,
          );
        }
        this.store.run(
          "UPDATE integration_refund_polls SET token=NULL,started_at=NULL,retry_at=? WHERE effect_id=?",
          Date.now() + 30000,
          effectId,
        );
        verification?.complete();
        return {
          id: effectId,
          state: this.integration.effect(actor, effectId).state,
          status,
        };
      });
    } catch (error) {
      this.database.transaction(() => {
        const poll = this.store.get(
          "SELECT token FROM integration_refund_polls WHERE org_id=? AND effect_id=?",
          effect.org_id,
          effectId,
        );
        if (poll?.token !== token) return;
        this.store.run(
          "UPDATE integration_effects SET state=CASE WHEN state='running' THEN 'unknown' ELSE state END,error=? WHERE id=?",
          "Refund verification incomplete; reconcile with a provider read before retrying.",
          effectId,
        );
        this.store.run(
          "UPDATE integration_refund_polls SET token=NULL,started_at=NULL,retry_at=? WHERE effect_id=?",
          Date.now() + 30000,
          effectId,
        );
        this.platform.audit(
          actor,
          "integration.refund.unconfirmed",
          effectId,
          {},
        );
      });
      throw error;
    }
  }
  recover(milliseconds: number, orgId: string | null) {
    return this.database.transaction(() =>
      Number(
        this.store.run(
          "UPDATE integration_refund_polls SET token=NULL,started_at=NULL,retry_at=0 WHERE token IS NOT NULL AND started_at<? AND (? IS NULL OR org_id=?)",
          Date.now() - milliseconds,
          orgId,
          orgId,
        ).changes,
      ),
    );
  }
  due(actor: Actor, limit: number) {
    actor = this.principal(actor);
    return this.store.all<Effect>(
      "SELECT e.* FROM integration_effects e JOIN integration_refund_polls p ON p.effect_id=e.id WHERE e.org_id=? AND e.provider='stripe' AND e.kind='refund' AND e.state='completed' AND p.token IS NULL AND p.retry_at<=? AND json_extract(e.result,'$.status') IN('pending','requires_action') ORDER BY p.retry_at,e.id LIMIT ?",
      actor.orgId,
      Date.now(),
      limit,
    );
  }
}
