import {
  canonical,
  check,
  digest,
  id,
  integer,
  now,
  permit,
  text,
  type Actor,
} from "./core.ts";
import type { Database, Store } from "./database.ts";
import type { Identity } from "./iam.ts";
import type { Platform } from "./platform.ts";
import type { Billing } from "./billing.ts";
import type { Integration, Effect, Adapter } from "./integration.ts";

export type AccountingBalance = {
  reference: string;
  total: number;
  currency: string;
  balance: number;
  syncToken: string;
};
export type BalanceObservation = {
  id: string;
  sequence: number;
  effectId: string;
  invoiceId: string;
  reference: string;
  currency: string;
  total: number;
  credited: number;
  paid: number;
  refunded: number;
  nativeBalance: number;
  providerBalance: number;
  difference: number;
  syncToken: string;
  requestedAt: string;
  observedAt: string;
};
type Read = {
  id: string;
  effect_id: string;
  hash: string;
  token: string | null;
  result: string | null;
};

// Read-only comparisons own their history and claims, never the native ledger
// or the delivery state of an already completed accounting document.
export class IntegrationAccountingBalances {
  constructor(
    private database: Database,
    private store: Store,
    private platform: Platform,
    private identity: Identity,
    private billing: Billing,
    private integration: Integration,
  ) {
    store.migrate(`
      CREATE TABLE IF NOT EXISTS integration_balance_reads(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,effect_id TEXT NOT NULL,command_key TEXT NOT NULL,hash TEXT NOT NULL,token TEXT,started_at INTEGER,requested_at TEXT NOT NULL,result TEXT,error TEXT,UNIQUE(org_id,command_key)) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS integration_balance_claim ON integration_balance_reads(org_id,effect_id) WHERE token IS NOT NULL;
      CREATE TABLE IF NOT EXISTS integration_balance_observations(sequence INTEGER PRIMARY KEY,read_id TEXT NOT NULL UNIQUE,org_id TEXT NOT NULL,effect_id TEXT NOT NULL,result TEXT NOT NULL) STRICT;
      CREATE INDEX IF NOT EXISTS integration_balance_history ON integration_balance_observations(org_id,effect_id,sequence);
    `);
  }
  private principal(actor: Actor) {
    actor = this.identity.currentActor(actor);
    permit(actor, ["finance"]);
    check(
      !actor.accountId,
      "FORBIDDEN",
      "Buyer principals cannot read accounting balances.",
      403,
    );
    check(
      !this.identity.security(actor).passwordChangeRequired,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before reading accounting balances.",
      403,
    );
    return actor;
  }
  private effect(actor: Actor, effectId: string) {
    const effect = this.integration.effect(actor, effectId);
    check(
      effect.provider === "quickbooks" &&
        effect.kind === "invoice" &&
        effect.state === "completed" &&
        effect.external_ref,
      "ACCOUNTING_INVOICE_REQUIRED",
      "Only a completed QuickBooks invoice has a balance to compare.",
    );
    this.billing.invoice(actor, effect.reference);
    return effect;
  }
  private hash(effect: Effect) {
    return digest(
      canonical({
        effectId: effect.id,
        invoiceId: effect.reference,
        reference: effect.external_ref,
        payload: effect.payload,
      }),
    );
  }
  latest(actor: Actor, effectId: string): BalanceObservation | null {
    actor = this.principal(actor);
    this.effect(actor, effectId);
    const row = this.store.get<{ result: string }>(
      "SELECT result FROM integration_balance_observations WHERE org_id=? AND effect_id=? ORDER BY sequence DESC LIMIT 1",
      actor.orgId,
      effectId,
    );
    return row ? JSON.parse(row.result) : null;
  }
  history(
    actor: Actor,
    effectId: string,
    page: { after?: number; limit?: number } = {},
  ) {
    actor = this.principal(actor);
    this.effect(actor, effectId);
    const after = integer(
        page.after ?? 0,
        "History cursor",
        0,
        Number.MAX_SAFE_INTEGER,
      ),
      limit = integer(page.limit ?? 20, "History page size", 1, 100);
    const rows = this.store.all<{ sequence: number; result: string }>(
      "SELECT sequence,result FROM integration_balance_observations WHERE org_id=? AND effect_id=? AND sequence>? ORDER BY sequence LIMIT ?",
      actor.orgId,
      effectId,
      after,
      limit + 1,
    );
    return {
      items: rows
        .slice(0, limit)
        .map((r) => JSON.parse(r.result) as BalanceObservation),
      next: rows.length > limit ? rows[limit - 1]!.sequence : null,
    };
  }
  // Called inside the integration recovery transaction; stale completions and
  // releases can only act on the token they actually acquired.
  recover(milliseconds: number, orgId: string | null) {
    return Number(
      this.store.run(
        "UPDATE integration_balance_reads SET token=NULL,started_at=NULL,error='Balance read interrupted; explicitly retry verification.' WHERE token IS NOT NULL AND started_at<? AND (? IS NULL OR org_id=?)",
        Date.now() - milliseconds,
        orgId,
        orgId,
      ).changes,
    );
  }
  async refresh(actor: Actor, effectId: string, key: string, adapter: Adapter) {
    const token = id();
    const claim = this.database.transaction(() => {
      actor = this.principal(actor);
      this.platform.assertProviderAccess();
      const effect = this.effect(actor, effectId);
      this.identity.providerAllowed(actor, effect.account_id, "quickbooks");
      key = text(key, "Balance read key", 128);
      const hash = this.hash(effect),
        old = this.store.get<Read>(
          "SELECT * FROM integration_balance_reads WHERE org_id=? AND command_key=?",
          actor.orgId,
          key,
        );
      if (old) {
        check(
          old.hash === hash,
          "IDEMPOTENCY_CONFLICT",
          "Balance read key belongs to a different invoice identity.",
        );
        if (old.result)
          return { cached: JSON.parse(old.result) as BalanceObservation };
      }
      check(
        adapter.readInvoiceBalance,
        "PROVIDER_DISABLED",
        "Accounting balance reads are not configured.",
        503,
      );
      check(
        !this.store.get(
          "SELECT id FROM integration_balance_reads WHERE org_id=? AND effect_id=? AND token IS NOT NULL",
          actor.orgId,
          effectId,
        ),
        "STATE",
        "This invoice already has an active balance read.",
      );
      const readId = old?.id ?? id(),
        requestedAt = now();
      if (old)
        this.store.run(
          "UPDATE integration_balance_reads SET token=?,started_at=?,requested_at=?,error=NULL WHERE id=?",
          token,
          Date.now(),
          requestedAt,
          readId,
        );
      else
        this.store.run(
          "INSERT INTO integration_balance_reads(id,org_id,effect_id,command_key,hash,token,started_at,requested_at) VALUES(?,?,?,?,?,?,?,?)",
          readId,
          actor.orgId,
          effectId,
          key,
          hash,
          token,
          Date.now(),
          requestedAt,
        );
      this.platform.audit(actor, "accounting.balance.requested", readId, {
        effectId,
      });
      return { effect, readId, hash, requestedAt };
    });
    if ("cached" in claim) return claim.cached!;
    try {
      const balance = await adapter.readInvoiceBalance!(claim.effect);
      return this.database.transaction(() => {
        actor = this.principal(actor);
        this.platform.assertProviderAccess();
        const effect = this.effect(actor, effectId);
        this.identity.providerAllowed(actor, effect.account_id, "quickbooks");
        const read = this.store.get<Read>(
          "SELECT * FROM integration_balance_reads WHERE org_id=? AND id=?",
          actor.orgId,
          claim.readId,
        );
        check(
          read?.token === token && this.hash(effect) === claim.hash,
          "STATE",
          "Balance read claim or invoice identity changed; read again.",
        );
        const invoice = this.billing.invoice(actor, effect.reference),
          totals = this.billing.totals(actor, invoice.id);
        check(
          balance.reference === effect.external_ref &&
            balance.total === invoice.total &&
            balance.currency === invoice.currency &&
            Number.isSafeInteger(balance.balance) &&
            balance.balance >= 0 &&
            balance.balance <= invoice.total &&
            typeof balance.syncToken === "string" &&
            /^\d{1,160}$/.test(balance.syncToken),
          "ACCOUNTING_MISMATCH",
          "QuickBooks invoice identity, currency or balance differs from the original document.",
        );
        const sequence = Number(
          this.store.run(
            "INSERT INTO integration_balance_observations(read_id,org_id,effect_id,result) VALUES(?,?,?,?)",
            read.id,
            actor.orgId,
            effectId,
            "{}",
          ).lastInsertRowid,
        );
        const observation: BalanceObservation = {
          id: read.id,
          sequence,
          effectId,
          invoiceId: invoice.id,
          reference: balance.reference,
          currency: invoice.currency,
          total: invoice.total,
          credited: totals.credited,
          paid: totals.paid,
          refunded: totals.refunded,
          nativeBalance: totals.balance,
          providerBalance: balance.balance,
          difference: balance.balance - totals.balance,
          syncToken: balance.syncToken,
          requestedAt: claim.requestedAt,
          observedAt: now(),
        };
        this.store.run(
          "UPDATE integration_balance_observations SET result=? WHERE sequence=?",
          canonical(observation),
          sequence,
        );
        this.store.run(
          "UPDATE integration_balance_reads SET token=NULL,started_at=NULL,result=?,error=NULL WHERE id=? AND token=?",
          canonical(observation),
          read.id,
          token,
        );
        this.platform.audit(actor, "accounting.balance.observed", read.id, {
          effectId,
          difference: observation.difference,
        });
        return observation;
      });
    } catch (error) {
      this.database.transaction(() => {
        const released = this.store.run(
          "UPDATE integration_balance_reads SET token=NULL,started_at=NULL,error='Balance verification incomplete; explicitly retry the read.' WHERE id=? AND token=?",
          claim.readId,
          token,
        );
        if (released.changes)
          this.platform.audit(
            actor,
            "accounting.balance.incomplete",
            claim.readId,
            { effectId },
          );
      });
      throw error;
    }
  }
}
