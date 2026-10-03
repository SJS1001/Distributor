import { types } from "node:util";
import { canonical, check, digest, type Actor } from "./core.ts";
import type { Database, Store } from "./database.ts";
import type { Identity } from "./iam.ts";
import type { Billing } from "./billing.ts";
import type { Effect } from "./integration.ts";

const purpose = "distributor-integration-offline-refund-negative-history-v1";
const profile = Object.freeze({
  rowsPerTable: 256,
  totalRows: 512,
  fieldBytes: 65536,
  rowBytes: 131072,
  totalBytes: 2097152,
  jsonNodesPerDocument: 4096,
  totalJsonNodes: 16384,
});
// Complete fixed Integration-owned sets, deliberately not scoped by tenant or
// target. No caller-provided table, predicate, projection or executable port.
const columns = {
  integration_effects:
    "id org_id account_id provider kind reference payload state external_ref result created_at residency_version started_at error",
  integration_inbox: "provider event_id hash created_at",
  integration_refund_callbacks:
    "id org_id binding_id event_id effect_id provider_reference event_type hash state attempts started_at retry_at error created_at",
  integration_callbacks:
    "id org_id binding_id event_id session_id effect_id hash state attempts started_at retry_at error created_at",
  integration_offline_failed_refunds:
    "effect_id org_id request_id binding record record_hash",
} as const;
function bounded(value: unknown): asserts value {
  check(
    value,
    "OFFLINE_REFUND_NEGATIVE_HISTORY_LIMIT",
    "Native negative history exceeds its bounded profile.",
  );
}
function consistent(value: unknown): asserts value {
  check(
    value,
    "OFFLINE_REFUND_NEGATIVE_HISTORY",
    "Native negative history cannot be established.",
  );
}
function primitive(
  value: unknown,
  reference: boolean,
): asserts value is string {
  check(
    !types.isProxy(value) &&
      typeof value === "string" &&
      value.length > 0 &&
      value.length <= 160 &&
      value.trim() === value &&
      (reference ? /^re_[A-Za-z0-9_]+$/ : /^[A-Za-z0-9_-]+$/).test(value),
    "OFFLINE_REFUND_NEGATIVE_HISTORY_INPUT",
    "Supply exact bounded native identities.",
    400,
  );
}
function freeze<T>(value: T): Frozen<T> {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as Frozen<T>;
}
type Frozen<T> = T extends object
  ? { readonly [K in keyof T]: Frozen<T[K]> }
  : T;

/** Local native consistency only. Never a completeness discharge, evidence
 * qualification, current external authority, mutation or transport permit. */
export class IntegrationOfflineRefundNegativeHistory {
  private readonly store: Store;
  constructor(
    private readonly database: Database,
    private readonly identity: Identity,
    private readonly billing: Billing,
  ) {
    this.store = database.owned("integration");
  }
  getInTransaction(actor: Actor, effectId: string, proposedReference: string) {
    this.database.requireTransaction();
    // typeof/isProxy never invokes getters, coercion or proxy traps, including
    // revoked proxies. Neither input is an object/descriptor-bearing record.
    primitive(effectId, false);
    primitive(proposedReference, true);
    actor = this.identity.workerActor(actor.orgId, actor.id);
    const unchanged = this.store.get("SELECT total_changes() AS n")!.n;
    let totalRows = 0,
      totalBytes = 0;
    const counts = {} as Record<keyof typeof columns, number>;
    // Only numeric aggregates leave SQLite until ALL five complete sets pass.
    for (const [table, fixed] of Object.entries(columns)) {
      const n = Number(
        this.store.get(
          `SELECT COUNT(*) AS n FROM (SELECT 1 FROM ${table} LIMIT ?)`,
          profile.rowsPerTable + 1,
        )!.n,
      );
      bounded(
        n <= profile.rowsPerTable && (totalRows += n) <= profile.totalRows,
      );
      const fields = fixed.split(" ");
      const sizes = fields.map((c) => `COALESCE(length(CAST(${c} AS BLOB)),0)`);
      const row = sizes.join("+");
      const stats = this.store.get<{
        field: number;
        row: number;
        total: number;
        invalid: number;
      }>(
        `SELECT COALESCE(MAX(MAX(${sizes.join(",")})),0) AS field,
         COALESCE(MAX(${row}),0) AS row, COALESCE(SUM(${row}),0) AS total,
         COALESCE(SUM(CASE WHEN ${fields.map((c) => `(typeof(${c}) NOT IN ('null','text','integer') OR instr(CAST(${c} AS BLOB),x'00')>0)`).join(" OR ")} THEN 1 ELSE 0 END),0) AS invalid FROM ${table}`,
      )!;
      bounded(
        [stats.field, stats.row, stats.total].every(
          (n) => Number.isSafeInteger(n) && n >= 0,
        ) &&
          stats.field <= profile.fieldBytes &&
          stats.row <= profile.rowBytes &&
          stats.total <= profile.totalBytes - totalBytes,
      );
      consistent(stats.invalid === 0);
      totalBytes += stats.total;
      counts[table as keyof typeof columns] = n;
    }
    // There is no native proof assigning all orphan history to this subject.
    // Refuse even apparently unrelated/terminal rows. No tenant rows are fetched,
    // no record parser is guessed, and the fixed error discloses no identities.
    consistent(
      counts.integration_inbox === 0 &&
        counts.integration_refund_callbacks === 0 &&
        counts.integration_callbacks === 0 &&
        counts.integration_offline_failed_refunds === 0,
    );
    // No json_tree/json_each: those virtual tables are outside the native
    // owner authorizer. Scalar SQL keeps foreign text inside SQLite. Escape-
    // bearing JSON is conservatively unsupported, so quoted ASCII reference
    // matching cannot miss a Unicode/escaped spelling. Even keys count as a
    // collision. This does not infer meaning from an arbitrary JSON document.
    const json = this.store.get<{
      largest: number;
      total: number;
      conflicts: number;
      invalid: number;
    }>(
      `WITH documents AS (
        SELECT payload AS raw FROM integration_effects UNION ALL
        SELECT result FROM integration_effects WHERE result IS NOT NULL
      ), sizes AS (
        SELECT 1+length(raw)-length(replace(replace(replace(replace(raw,',',''),':',''),'[',''),'{','')) AS nodes,
          CASE WHEN instr(raw,json_quote(?))>0 THEN 1 ELSE 0 END AS conflicts,
          CASE WHEN NOT json_valid(raw) OR instr(raw,char(92))>0 THEN 1 ELSE 0 END AS invalid
        FROM documents
      ) SELECT COALESCE(MAX(nodes),0) AS largest, COALESCE(SUM(nodes),0) AS total,
        COALESCE(SUM(conflicts),0) AS conflicts, COALESCE(SUM(invalid),0) AS invalid FROM sizes`,
      proposedReference,
    )!;
    // Punctuation count is an upper bound on JSON value nodes, including
    // punctuation inside strings. It intentionally overcounts, never truncates.
    bounded(
      json.largest <= profile.jsonNodesPerDocument &&
        json.total <= profile.totalJsonNodes,
    );
    consistent(json.invalid === 0);
    consistent(
      json.conflicts === 0 &&
        this.store.get(
          "SELECT COUNT(*) AS n FROM integration_effects WHERE external_ref=? OR reference=?",
          proposedReference,
          proposedReference,
        )!.n === 0,
    );
    const effect = this.store.get<Effect>(
      `SELECT ${columns.integration_effects.split(" ").join(",")} FROM integration_effects WHERE org_id=? AND id=?`,
      actor.orgId,
      effectId,
    );
    consistent(
      effect &&
        effect.provider === "stripe" &&
        effect.kind === "refund" &&
        effect.state === "unknown" &&
        effect.external_ref === null &&
        effect.result === null,
    );
    const billing = this.billing.refunds.reviewOfflineFailedRefundInTransaction(
      actor,
      effect.reference,
    );
    consistent(
      billing.orgId === actor.orgId &&
        billing.invoice.account_id === effect.account_id &&
        billing.refund.id === effect.reference &&
        billing.refund.state === "unknown" &&
        effect.payload === canonical(billing.intent),
    );
    const facts = {
      version: 1 as const,
      purpose,
      profile,
      orgId: actor.orgId,
      accountId: effect.account_id,
      region: billing.region,
      currency: billing.currency,
      effectId,
      proposedReference,
      effect: { ...effect },
      intent: { ...billing.intent },
      billingReviewHash: billing.factsHash,
      negativeHistory: {
        scope:
          "all-native-integration-effects-inbox-refund-and-checkout-callbacks-offline-imports" as const,
        inboxRows: 0 as const,
        refundCallbackRows: 0 as const,
        checkoutCallbackRows: 0 as const,
        offlineImportRows: 0 as const,
        referenceCollisions: 0 as const,
        scannedEffectRows: counts.integration_effects,
      },
    };
    consistent(this.store.get("SELECT total_changes() AS n")!.n === unchanged);
    return freeze({ ...facts, hash: digest(canonical(facts)) });
  }
}
export type IntegrationOfflineRefundNegativeHistoryFacts = ReturnType<
  IntegrationOfflineRefundNegativeHistory["getInTransaction"]
>;
