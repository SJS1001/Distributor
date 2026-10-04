import { types } from "node:util";
import { canonical, check, digest, type Actor } from "./core.ts";
import type { Database } from "./database.ts";
import type { Identity } from "./iam.ts";
import type { Billing } from "./billing.ts";
import type { IntegrationCheckouts } from "./integration-checkouts.ts";
import { IntegrationOfflineCheckoutReview } from "./integration-offline-checkout-review.ts";
import {
  BillingOfflineCheckoutReferenceReview,
  isCapturedOfflineCheckoutPaymentReferenceReview,
} from "./billing-offline-checkout-reference-review.ts";
import { isCapturedOfflineCheckoutComparison } from "./integration-offline-checkout-evidence.ts";
const purpose = "integration-offline-checkout-session-reference-review-v1";
const columns = {
  integration_effects:
    "id org_id account_id provider kind reference payload state external_ref result created_at residency_version started_at error",
  integration_checkout_renewals:
    "successor_id org_id invoice_id predecessor_id reason review_version created_at",
  integration_checkout_observations:
    "sequence id org_id account_id invoice_id effect_id claim_token actor_id snapshot hash",
  integration_callbacks:
    "id org_id binding_id event_id session_id effect_id hash state attempts started_at retry_at error created_at",
  integration_inbox: "provider event_id hash created_at",
  integration_operation_leases: "effect_id org_id token started_at",
  integration_payment_allocations:
    "effect_id org_id invoice_id payment_id applied_amount",
  integration_refund_callbacks:
    "id org_id binding_id event_id effect_id provider_reference event_type hash state attempts started_at retry_at error created_at",
  integration_refund_polls: "effect_id org_id token started_at retry_at",
  integration_offline_failed_refunds:
    "effect_id org_id request_id binding record record_hash",
  integration_accounting_refunds:
    "effect_id org_id invoice_id refund_id credit_id amount",
  integration_credit_applications:
    "effect_id org_id invoice_id credit_id amount",
  integration_credit_cancellations:
    "effect_id org_id actor_id reason review_version amount created_at",
  integration_balance_reads:
    "id org_id effect_id command_key hash token started_at requested_at result error",
  integration_balance_observations: "sequence read_id org_id effect_id result",
} as const;
type Table = keyof typeof columns;
type Rows = Record<Table, Record<string, any>[]>;
const numeric = new Set(
  "sequence residency_version started_at attempts retry_at applied_amount amount".split(
    " ",
  ),
);
const nullable = new Set(
  "external_ref result started_at error token".split(" "),
);
export const checkoutSessionReferenceLimits = Object.freeze({
  rowsPerSet: 64,
  rows: 512,
  fieldBytes: 65536,
  rowBytes: 131072,
  bytes: 2097152,
  jsonDepth: 16,
  jsonNodes: 4096,
  totalJsonNodes: 16384,
});
function intact(v: unknown): asserts v {
  check(
    v,
    "OFFLINE_CHECKOUT_SESSION_REFERENCE_REVIEW",
    "Complete native checkout reference history is inconsistent.",
  );
}
function bounded(v: unknown): asserts v {
  check(
    v,
    "OFFLINE_CHECKOUT_SESSION_REFERENCE_LIMIT",
    "Complete checkout reference history exceeds the fixed bound.",
  );
}
function profile(v: unknown): asserts v {
  check(
    v,
    "OFFLINE_CHECKOUT_SESSION_REFERENCE_PROFILE_REQUIRED",
    "Complete checkout reference history requires another owning profile.",
  );
}
function collision(v: unknown): asserts v {
  check(
    v,
    "OFFLINE_CHECKOUT_SESSION_REFERENCE_COLLISION",
    "Proposed checkout identity conflicts with retained native history.",
  );
}
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
function freeze<T>(v: T): T {
  if (v !== null && typeof v === "object") {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
}
const issued = new WeakSet<object>();
export function isCapturedOfflineCheckoutSessionReferenceReview(
  v: unknown,
): v is OfflineCheckoutSessionReferenceReview {
  return v !== null && typeof v === "object" && issued.has(v);
}
// Pin the actual fixed sibling owner operations. No caller adapter/callback or
// serializable receipt is accepted as current proof.
const assertBilling =
  BillingOfflineCheckoutReferenceReview.prototype
    .assertOwningCompositionInTransaction;
const readBilling =
  BillingOfflineCheckoutReferenceReview.prototype.getInTransaction;
const readCheckout =
  IntegrationOfflineCheckoutReview.prototype.getInTransaction;

export class IntegrationOfflineCheckoutReferenceReview {
  readonly #database: Database;
  readonly #identity: Identity;
  readonly #checkouts: IntegrationCheckouts;
  readonly #billing: BillingOfflineCheckoutReferenceReview;
  readonly #native: IntegrationOfflineCheckoutReview;
  #busy = false;
  #poison = false;
  constructor(
    database: Database,
    identity: Identity,
    billing: Billing,
    checkouts: IntegrationCheckouts,
  ) {
    this.#billing = new BillingOfflineCheckoutReferenceReview(
      database,
      identity,
      billing,
      checkouts,
    );
    this.#database = database;
    this.#identity = identity;
    this.#checkouts = checkouts;
    this.#native = new IntegrationOfflineCheckoutReview(
      database,
      identity,
      billing,
      checkouts,
    );
  }
  #scan(orgId: string, reference: string) {
    const store = this.#database.owned("integration");
    let rows = 0,
      bytes = 0,
      jsonNodes = 0;
    for (const [table, fixed] of Object.entries(columns)) {
      const fields = fixed.split(" "),
        sizes = fields.map((c) => `COALESCE(length(CAST(${c} AS BLOB)),0)`),
        sum = sizes.join("+");
      const n = Number(
        store.get(
          `SELECT COUNT(*) AS n FROM (SELECT 1 FROM ${table} LIMIT 65)`,
        )!.n,
      );
      bounded(n <= 64 && (rows += n) <= 512);
      const m = store.get<{
        field: number;
        row: number;
        total: number;
        bad: number;
      }>(
        `SELECT COALESCE(MAX(MAX(${sizes.join(",")})),0) AS field,COALESCE(MAX(${sum}),0) AS row,COALESCE(SUM(${sum}),0) AS total,COALESCE(MAX(CASE WHEN ${fields.map((c) => `(${nullable.has(c) ? `${c} IS NOT NULL AND ` : ""}(${numeric.has(c) ? `typeof(${c})!='integer' OR ${c}<0 OR ${c}>9007199254740991` : `typeof(${c})!='text' OR instr(CAST(${c} AS BLOB),x'00')>0`}))`).join(" OR ")} THEN 1 ELSE 0 END),0) AS bad FROM ${table}`,
      )!;
      intact(m.bad === 0);
      bounded(
        [m.field, m.row, m.total].every(Number.isSafeInteger) &&
          m.field <= 65536 &&
          m.row <= 131072,
      );
      bytes += m.total * 6 + n * fields.length * 128;
      bounded(bytes <= 2097152);
    }
    const result = {} as Rows;
    for (const [table, fixed] of Object.entries(columns)) {
      const fields = fixed.split(" "),
        text = fields.filter((c) => !numeric.has(c));
      result[table as Table] = store
        .all(
          `SELECT ${fields.join(",")},${text.map((c) => `hex(CAST(${c} AS BLOB)) AS witness_${c}`).join(",")} FROM ${table} ORDER BY ${table === "integration_checkout_observations" || table === "integration_balance_observations" ? "sequence" : "rowid"}`,
        )
        .map((row) => {
          for (const c of text) {
            if (row[c] === null) continue;
            const hex = row[`witness_${c}`];
            intact(typeof hex === "string" && typeof row[c] === "string");
            let decoded: string;
            try {
              decoded = utf8.decode(Buffer.from(hex, "hex"));
            } catch {
              intact(false);
            }
            intact(
              decoded === row[c] &&
                Buffer.from(decoded, "utf8").toString("hex").toUpperCase() ===
                  hex &&
                !decoded.includes("\0"),
            );
          }
          return Object.fromEntries(fields.map((c) => [c, row[c]]));
        });
    }
    const json = (raw: unknown): Record<string, any> => {
      intact(typeof raw === "string");
      bounded(Buffer.byteLength(raw) <= 65536);
      // Count an overestimate of nodes and real bracket depth outside JSON strings
      // BEFORE JSON.parse. Escaped delimiters never change depth.
      let depth = 0,
        nodes = 1,
        quoted = false,
        escape = false;
      for (const c of raw) {
        if (quoted) {
          if (escape) escape = false;
          else if (c === "\\") escape = true;
          else if (c === '"') quoted = false;
          continue;
        }
        if (c === '"') {
          quoted = true;
          nodes++;
        } else if (c === "{" || c === "[") {
          depth++;
          nodes++;
          bounded(depth <= 16);
        } else if (c === "}" || c === "]") {
          depth--;
          intact(depth >= 0);
        } else if (c === "," || c === ":") nodes++;
        bounded(nodes <= 4096);
      }
      intact(!quoted && depth === 0);
      jsonNodes += nodes;
      bounded(jsonNodes <= 16384);
      let v: any;
      try {
        v = JSON.parse(raw);
      } catch {
        intact(false);
      }
      const stack = [v];
      let count = 0;
      while (stack.length) {
        const value = stack.pop();
        bounded(++count <= 4096);
        if (value !== null && typeof value === "object") {
          const entries = Object.entries(value);
          bounded(entries.length <= 128);
          for (const [k, x] of entries) {
            bounded(Buffer.byteLength(k) <= 64);
            intact(
              !/[\u0000\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(
                k,
              ) &&
                ![
                  "__proto__",
                  "constructor",
                  "prototype",
                  "then",
                  "toJSON",
                ].includes(k),
            );
            collision(!k.includes(reference));
            stack.push(x);
          }
        } else if (typeof value === "string") {
          intact(
            !value.includes("\0") &&
              !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(
                value,
              ),
          );
          collision(!value.includes(reference));
        } else
          intact(
            value === null ||
              typeof value === "boolean" ||
              (typeof value === "number" &&
                Number.isSafeInteger(value) &&
                !Object.is(value, -0)),
          );
      }
      intact(
        v !== null &&
          typeof v === "object" &&
          !Array.isArray(v) &&
          canonical(v) === raw,
      );
      return v;
    };
    // Reference occurrences cannot hide in a foreign scope, stale observation,
    // callback, alternate kind/provider label or canonical nested JSON spelling.
    for (const set of Object.values(result))
      for (const row of set)
        for (const value of Object.values(row))
          if (typeof value === "string") collision(!value.includes(reference));
    const payloads = new Map<string, Record<string, any>>();
    for (const e of result.integration_effects) {
      payloads.set(e.id, json(e.payload));
      if (e.result !== null) json(e.result);
    }
    for (const o of result.integration_checkout_observations) json(o.snapshot);
    for (const r of result.integration_offline_failed_refunds) {
      json(r.binding);
      json(r.record);
    }
    for (const r of result.integration_balance_reads)
      if (r.result !== null) json(r.result);
    for (const r of result.integration_balance_observations) json(r.result);
    check(
      Object.entries(result).every(
        ([name, set]) =>
          name === "integration_inbox" || set.every((r) => r.org_id === orgId),
      ),
      "OFFLINE_CHECKOUT_SESSION_REFERENCE_SCOPE_REQUIRED",
      "Complete checkout reference review requires scoped native histories for every retained organization.",
    );
    const byId = new Map(result.integration_effects.map((e) => [e.id, e]));
    for (const [name, set] of Object.entries(result)) {
      if (name === "integration_effects" || name === "integration_inbox")
        continue;
      for (const r of set) {
        if (name === "integration_checkout_renewals")
          intact(byId.has(r.predecessor_id) && byId.has(r.successor_id));
        else if (name === "integration_balance_observations")
          intact(
            result.integration_balance_reads.some((b) => b.id === r.read_id),
          );
        else intact(byId.has(r.effect_id));
      }
    }
    check(
      result.integration_callbacks.length === 0,
      "OFFLINE_CHECKOUT_SESSION_CALLBACK_HISTORY_REQUIRED",
      "Retained callback provenance requires its owning complete attribution contract.",
    );
    check(
      result.integration_inbox.length === 0,
      "OFFLINE_CHECKOUT_SESSION_INBOX_HISTORY_REQUIRED",
      "Retained settlement inbox provenance requires its owning complete attribution contract.",
    );
    check(
      result.integration_operation_leases.every(
        (r) => r.token === null && r.started_at === null,
      ),
      "OFFLINE_CHECKOUT_SESSION_ACTIVE_CLAIM_REQUIRED",
      "Retained active claims require an owning reconciled history profile.",
    );
    const allowed = new Set([
      "integration_effects",
      "integration_checkout_renewals",
      "integration_checkout_observations",
      "integration_operation_leases",
    ]);
    profile(
      Object.entries(result).every(
        ([name, set]) => allowed.has(name) || set.length === 0,
      ),
    );
    profile(
      result.integration_effects.every(
        (e) => e.provider === "stripe" && e.kind === "checkout",
      ),
    );
    for (const p of payloads.values())
      intact(
        typeof p.invoiceId === "string" &&
          p.invoiceId.length > 0 &&
          p.invoiceId.length <= 128,
      );
    return { rows: result, payloads };
  }
  getInTransaction(actorInput: unknown, comparisonInput: unknown) {
    if (this.#busy) {
      this.#poison = true;
      intact(false);
    }
    this.#busy = true;
    this.#poison = false;
    try {
      assertBilling.call(this.#billing);
      intact(isCapturedOfflineCheckoutComparison(comparisonInput));
      intact(
        actorInput !== null &&
          typeof actorInput === "object" &&
          !types.isProxy(actorInput),
      );
      intact(
        Object.getPrototypeOf(actorInput) === Object.prototype &&
          Reflect.ownKeys(actorInput).length === 2,
      );
      const id = Object.getOwnPropertyDescriptor(actorInput, "id"),
        org = Object.getOwnPropertyDescriptor(actorInput, "orgId");
      intact(id && org && "value" in id && "value" in org);
      for (const v of [id.value, org.value])
        intact(
          typeof v === "string" &&
            v.length > 0 &&
            v.length <= 128 &&
            v.trim() === v &&
            !/[\u0000-\u001f\u007f\ud800-\udfff]/.test(v),
        );
      const comparison = comparisonInput,
        locator = { id: id.value as string, orgId: org.value as string };
      const authority = () => {
        const a = this.#identity.workerActor(locator.orgId, locator.id);
        intact(a.orgId === comparison.orgId);
        this.#identity.providerAllowed(a, comparison.accountId, "stripe");
        return a;
      };
      const actor = authority(),
        store = this.#database.owned("integration"),
        changes = store.get("SELECT total_changes() AS n")!.n;
      const first = this.#scan(actor.orgId, comparison.outcome.reference);
      const billing = readBilling.call(this.#billing, locator, comparison);
      intact(isCapturedOfflineCheckoutPaymentReferenceReview(billing));
      const reviews = [];
      for (const invoiceId of [
        ...new Set(
          [...first.payloads.values()].map((p) => p.invoiceId as string),
        ),
      ].sort()) {
        const current = this.#checkouts.current(actor, invoiceId);
        intact(current);
        check(
          current.state === "unknown",
          "OFFLINE_CHECKOUT_SESSION_CURRENT_HISTORY_REQUIRED",
          "A complete terminal-current checkout history operation is required.",
        );
        reviews.push(readCheckout.call(this.#native, actor, current.id));
      }
      const covered = (table: Table, ids: unknown[]) =>
        intact(
          canonical(ids.slice().sort()) ===
            canonical(
              first.rows[table]
                .map((r) =>
                  table === "integration_checkout_renewals"
                    ? r.successor_id
                    : table === "integration_operation_leases"
                      ? r.effect_id
                      : r.id,
                )
                .sort(),
            ),
        );
      covered(
        "integration_effects",
        reviews.flatMap((r) => r.effects.map((e) => e.id)),
      );
      covered(
        "integration_checkout_renewals",
        reviews.flatMap((r) => r.renewals.map((e) => e.successor_id)),
      );
      covered(
        "integration_checkout_observations",
        reviews.flatMap((r) => r.observations.map((e) => e.id)),
      );
      covered(
        "integration_operation_leases",
        reviews.flatMap((r) =>
          r.collections.integration_operation_leases!.map((e) => e.effect_id),
        ),
      );
      const factsHash = digest(
        canonical({
          purpose: "integration-offline-checkout-session-reference-facts-v1",
          rows: first.rows,
          reviews: reviews.map((r) => ({
            invoiceId: r.invoice.id,
            factsHash: r.factsHash,
          })),
        }),
      );
      intact(
        canonical(
          this.#scan(actor.orgId, comparison.outcome.reference).rows,
        ) === canonical(first.rows),
      );
      assertBilling.call(this.#billing);
      authority();
      const last = readBilling.call(this.#billing, locator, comparison);
      intact(last.hash === billing.hash);
      intact(
        store.get("SELECT total_changes() AS n")!.n === changes &&
          !this.#poison,
      );
      const body = {
        version: 1 as const,
        purpose,
        orgId: actor.orgId,
        actorId: actor.id,
        accountId: comparison.accountId,
        invoiceId: comparison.invoiceId,
        effectId: comparison.effectId,
        reference: comparison.outcome.reference,
        comparisonHash: comparison.hash,
        bindingHash: billing.bindingHash,
        candidateHash: comparison.candidateHash,
        billingReferenceHash: billing.hash,
        factsHash,
        disposition: "no-retained-reference-match" as const,
        requiredChecks: billing.requiredChecks.filter(
          (c) =>
            c !==
            "integration-proposed-session-reference-history-contract-required",
        ),
      };
      const receipt = freeze({ ...body, hash: digest(canonical(body)) });
      issued.add(receipt);
      return receipt;
    } finally {
      this.#busy = false;
    }
  }
}
export type OfflineCheckoutSessionReferenceReview = ReturnType<
  IntegrationOfflineCheckoutReferenceReview["getInTransaction"]
>;
