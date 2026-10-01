import {
  check,
  DomainError,
  id,
  integer,
  now,
  permit,
  type Actor,
} from "./core.ts";
import type { Database, Store } from "./database.ts";
import type { Identity } from "./iam.ts";
import type { Platform } from "./platform.ts";
import type { Adapter, Integration } from "./integration.ts";
import type { RefundIntent } from "./billing-refunds.ts";

export type RefundCallback = {
  id: string;
  org_id: string;
  binding_id: string;
  event_id: string;
  effect_id: string;
  provider_reference: string;
  event_type: string;
  hash: string;
  state: string;
  attempts: number;
  started_at: number | null;
  retry_at: number;
  error: string | null;
  created_at: string;
};

export class IntegrationRefundCallbacks {
  constructor(
    private database: Database,
    private store: Store,
    private platform: Platform,
    private identity: Identity,
    private integration: Integration,
  ) {
    store.migrate(`
      CREATE TABLE IF NOT EXISTS integration_refund_callbacks(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,binding_id TEXT NOT NULL,event_id TEXT NOT NULL,effect_id TEXT NOT NULL,provider_reference TEXT NOT NULL,event_type TEXT NOT NULL,hash TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('pending','processing','waiting','blocked','failed','completed')),attempts INTEGER NOT NULL DEFAULT 0,started_at INTEGER,retry_at INTEGER NOT NULL DEFAULT 0,error TEXT,created_at TEXT NOT NULL,UNIQUE(org_id,binding_id,event_id)) STRICT;
      CREATE INDEX IF NOT EXISTS integration_refund_callback_due ON integration_refund_callbacks(org_id,binding_id,state,retry_at,created_at,id);
    `);
  }
  private principal(actor: Actor) {
    const current = this.identity.workerActor(actor.orgId, actor.id);
    permit(current, ["finance"]);
    return current;
  }
  // Trusted signature-verifying runtime only. Event status/customer payload is never retained or applied.
  receive(
    actor: Actor,
    input: {
      bindingId: string;
      eventId: string;
      effectId: string;
      reference: string;
      eventType: string;
      hash: string;
      refundId: string;
      paymentId: string;
      amount: number;
      currency: string;
    },
  ) {
    return this.database.transaction(() => {
      actor = this.principal(actor);
      const effect = this.integration.effect(actor, input.effectId);
      const intent = JSON.parse(effect.payload) as RefundIntent;
      check(
        effect.provider === "stripe" &&
          effect.kind === "refund" &&
          effect.reference === input.refundId &&
          intent.refundId === input.refundId &&
          intent.paymentId === input.paymentId &&
          intent.amount === input.amount &&
          intent.currency === input.currency &&
          (!effect.external_ref || effect.external_ref === input.reference),
        "REFUND_MISMATCH",
        "Signed refund identity or money differs from the native intent.",
      );
      const checkout = this.store.get(
        "SELECT id FROM integration_callbacks WHERE org_id=? AND binding_id=? AND event_id=?",
        actor.orgId,
        input.bindingId,
        input.eventId,
      );
      check(!checkout, "EVENT_CONFLICT", "Signed event identity changed.");
      const old = this.store.get<RefundCallback>(
        "SELECT * FROM integration_refund_callbacks WHERE org_id=? AND binding_id=? AND event_id=?",
        actor.orgId,
        input.bindingId,
        input.eventId,
      );
      if (old) {
        check(
          old.hash === input.hash,
          "EVENT_CONFLICT",
          "Signed event identity changed.",
        );
        return { id: old.id, duplicate: true };
      }
      const callbackId = id();
      this.store.run(
        "INSERT INTO integration_refund_callbacks(id,org_id,binding_id,event_id,effect_id,provider_reference,event_type,hash,state,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        callbackId,
        actor.orgId,
        input.bindingId,
        input.eventId,
        effect.id,
        input.reference,
        input.eventType,
        input.hash,
        "pending",
        now(),
      );
      this.platform.audit(
        actor,
        "integration.refund-callback.received",
        callbackId,
        { binding: input.bindingId, event: input.eventType },
      );
      return { id: callbackId, duplicate: false };
    });
  }
  list(actor: Actor) {
    actor = this.identity.currentActor(actor);
    permit(actor, ["finance", "support"]);
    return this.store
      .all<RefundCallback>(
        "SELECT * FROM integration_refund_callbacks WHERE org_id=? ORDER BY created_at DESC,id LIMIT 200",
        actor.orgId,
      )
      .map((c) => ({ ...c, kind: "refund" as const }));
  }
  due(actor: Actor, bindingId: string, limit: number) {
    actor = this.principal(actor);
    return this.store.all<RefundCallback>(
      "SELECT * FROM integration_refund_callbacks WHERE org_id=? AND binding_id=? AND state IN('pending','waiting') AND retry_at<=? ORDER BY created_at,id LIMIT ?",
      actor.orgId,
      bindingId,
      Date.now(),
      integer(limit, "worker batch size", 1, 100),
    );
  }
  private assertClaim(actor: Actor, callbackId: string, attempt: number) {
    const current = this.store.get<RefundCallback>(
      "SELECT * FROM integration_refund_callbacks WHERE org_id=? AND id=?",
      actor.orgId,
      callbackId,
    );
    check(
      current?.state === "processing" && current.attempts === attempt,
      "STATE",
      "Refund callback lease changed; verify again.",
    );
  }
  private finish(
    actor: Actor,
    callbackId: string,
    attempt: number,
    state: "completed" | "waiting" | "blocked" | "failed",
    error: string | null = null,
  ) {
    const updated = this.store.run(
      "UPDATE integration_refund_callbacks SET state=?,started_at=NULL,error=?,retry_at=? WHERE org_id=? AND id=? AND state='processing' AND attempts=?",
      state,
      error,
      state === "waiting" ? Date.now() + 30000 : 0,
      actor.orgId,
      callbackId,
      attempt,
    );
    if (Number(updated.changes))
      this.platform.audit(
        actor,
        `integration.refund-callback.${state}`,
        callbackId,
        {},
      );
  }
  async run(actor: Actor, callbackId: string, adapter: Adapter) {
    const callback = this.database.transaction(() => {
      actor = this.principal(actor);
      this.platform.assertProviderAccess();
      const row = this.store.get<RefundCallback>(
        "SELECT * FROM integration_refund_callbacks WHERE org_id=? AND id=?",
        actor.orgId,
        callbackId,
      );
      check(
        row &&
          ["pending", "waiting"].includes(row.state) &&
          row.retry_at <= Date.now(),
        "STATE",
        "Refund callback is not ready for processing.",
      );
      this.store.run(
        "UPDATE integration_refund_callbacks SET state='processing',started_at=?,attempts=attempts+1,error=NULL WHERE id=?",
        Date.now(),
        callbackId,
      );
      return { ...row, attempts: row.attempts + 1 };
    });
    try {
      await this.integration.refunds.run(
        actor,
        callback.effect_id,
        adapter,
        false,
        {
          reference: callback.provider_reference,
          assertCurrent: () =>
            this.assertClaim(actor, callbackId, callback.attempts),
          complete: () =>
            this.finish(actor, callbackId, callback.attempts, "completed"),
        },
      );
      return { state: "completed" as const };
    } catch (error) {
      const code = error instanceof DomainError ? error.code : "";
      const state = [
        "RESIDENCY_BLOCKED",
        "FORBIDDEN",
        "PASSWORD_CHANGE_REQUIRED",
        "RECOVERY_HOLD",
      ].includes(code)
        ? "blocked"
        : ["REFUND_MISMATCH", "REFUND_DUPLICATE", "EVENT_CONFLICT"].includes(
              code,
            )
          ? "failed"
          : "waiting";
      this.database.transaction(() =>
        this.finish(
          actor,
          callbackId,
          callback.attempts,
          state,
          state === "blocked"
            ? "Current permission, residency choice or recovery hold prevents verification."
            : state === "failed"
              ? "Refund identity or money differs; finance review required."
              : "Verification incomplete; a read-only retry is scheduled.",
        ),
      );
      return { state };
    }
  }
  retry(actor: Actor, callbackId: string) {
    return this.database.transaction(() => {
      actor = this.principal(actor);
      this.platform.assertProviderAccess();
      const row = this.store.get<RefundCallback>(
        "SELECT * FROM integration_refund_callbacks WHERE org_id=? AND id=?",
        actor.orgId,
        callbackId,
      );
      check(row, "NOT_FOUND", "Callback not found.", 404);
      check(
        ["blocked", "waiting", "failed"].includes(row.state),
        "STATE",
        "Callback cannot be retried in its current state.",
      );
      this.store.run(
        "UPDATE integration_refund_callbacks SET state='pending',retry_at=0,error=NULL WHERE id=?",
        callbackId,
      );
      this.platform.audit(
        actor,
        "integration.refund-callback.retry",
        callbackId,
        {},
      );
      return { id: callbackId, state: "pending" };
    });
  }
  has(actor: Actor, callbackId: string) {
    return !!this.store.get(
      "SELECT id FROM integration_refund_callbacks WHERE org_id=? AND id=?",
      actor.orgId,
      callbackId,
    );
  }
  recover(milliseconds: number, orgId: string | null) {
    return Number(
      this.store.run(
        "UPDATE integration_refund_callbacks SET state='waiting',started_at=NULL,retry_at=0,error='Worker interrupted; safely verify refund again.' WHERE state='processing' AND started_at<? AND (? IS NULL OR org_id=?)",
        Date.now() - milliseconds,
        orgId,
        orgId,
      ).changes,
    );
  }
}
