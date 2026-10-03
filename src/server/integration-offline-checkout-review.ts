import { types } from "node:util";
import { canonical, check, digest, type Actor, type Row } from "./core.ts";
import type { Database, Store } from "./database.ts";
import type { Identity } from "./iam.ts";
import type { Billing } from "./billing.ts";
import type { IntegrationCheckouts } from "./integration-checkouts.ts";
import type { Effect } from "./integration.ts";

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
type Frozen<T> = T extends object
  ? { readonly [K in keyof T]: Frozen<T[K]> }
  : T;
const LIMIT = 2 * 1024 * 1024;
function intact(v: unknown): asserts v {
  check(
    v,
    "OFFLINE_CHECKOUT_REVIEW",
    "Retained checkout lineage is inconsistent.",
  );
}
function bounded(v: unknown): asserts v {
  check(
    v,
    "OFFLINE_CHECKOUT_REVIEW_LIMIT",
    "Checkout history exceeds the fixed review profile.",
  );
}
function profile(v: unknown): asserts v {
  check(
    v,
    "OFFLINE_CHECKOUT_REVIEW_PROFILE",
    "Retained checkout history requires another owning review profile.",
  );
}
function identifier(v: unknown): asserts v is string {
  intact(
    typeof v === "string" &&
      v.length > 0 &&
      v.length <= 160 &&
      v === v.trim() &&
      !/[\x00-\x1f\x7f]/.test(v),
  );
}
function integer(v: unknown, minimum = 0): asserts v is number {
  intact(typeof v === "number" && Number.isSafeInteger(v) && v >= minimum);
}
function stamp(v: unknown): asserts v is string {
  intact(
    typeof v === "string" &&
      v.length <= 32 &&
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString() === v,
  );
}
function hash(v: unknown) {
  intact(typeof v === "string" && /^[a-f0-9]{64}$/.test(v));
}
function json(value: unknown): Record<string, any> {
  intact(typeof value === "string");
  bounded(Buffer.byteLength(value) <= 65536);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    intact(false);
  }
  const stack: [unknown, number][] = [[parsed, 0]];
  let nodes = 0;
  while (stack.length) {
    const [v, depth] = stack.pop()!;
    bounded(++nodes <= 4096 && depth <= 16);
    if (v && typeof v === "object") {
      const children = Object.values(v);
      bounded(
        children.length <= 128 &&
          nodes + stack.length + children.length <= 4096,
      );
      for (const child of children) stack.push([child, depth + 1]);
    } else
      intact(
        v === null ||
          typeof v === "string" ||
          typeof v === "boolean" ||
          (typeof v === "number" && Number.isSafeInteger(v)),
      );
  }
  intact(parsed && typeof parsed === "object" && !Array.isArray(parsed));
  intact(canonical(parsed) === value);
  return parsed as Record<string, any>;
}
function exact(v: Record<string, any>, keys: string) {
  intact(Object.keys(v).sort().join(" ") === keys.split(" ").sort().join(" "));
}
function freeze<T>(v: T): Frozen<T> {
  if (v && typeof v === "object") {
    for (const child of Object.values(v)) freeze(child);
    Object.freeze(v);
  }
  return v as Frozen<T>;
}

/** Native facts only. Caller owns the existing writer transaction. No hold,
 * receipt, source completeness, provider truth or import authority is inferred. */
export class IntegrationOfflineCheckoutReview {
  private readonly store: Store;
  constructor(
    private readonly database: Database,
    private readonly identity: Identity,
    private readonly billing: Billing,
    private readonly checkouts: IntegrationCheckouts,
  ) {
    this.store = database.owned("integration");
  }

  getInTransaction(supplied: Actor, effectId: unknown) {
    this.database.requireTransaction();
    identifier(effectId);
    // Read only two data descriptors; no actor getter, proxy trap or coercion.
    intact(
      supplied && typeof supplied === "object" && !types.isProxy(supplied),
    );
    const org = Object.getOwnPropertyDescriptor(supplied, "orgId"),
      user = Object.getOwnPropertyDescriptor(supplied, "id");
    intact(org && "value" in org && user && "value" in user);
    identifier(org.value);
    identifier(user.value);
    const actor = this.identity.workerActor(org.value, user.value);
    const unchanged = this.store.get("SELECT total_changes() AS n")!.n;
    let count = 0,
      expandedBytes = 0;
    // Whole-store metadata preflight is deliberately conservative. It avoids
    // JSON predicates or retained identifiers before every fixed set is bounded.
    // Numeric metadata only; BLOB length includes UTF-8 and bytes after NUL.
    for (const table of Object.keys(columns) as Table[]) {
      const fields = columns[table].split(" ");
      const n = Number(
        this.store.get(
          `SELECT COUNT(*) AS n FROM (SELECT 1 FROM ${table} LIMIT 65)`,
        )!.n,
      );
      bounded(n <= 64 && (count += n) <= 512);
      const sizes = fields.map((c) => `COALESCE(length(CAST(${c} AS BLOB)),0)`),
        sum = sizes.join("+");
      const meta = this.store.get<{
        field: number;
        row: number;
        total: number;
        bad: number;
      }>(
        `SELECT COALESCE(MAX(MAX(${sizes.join(",")})),0) AS field,COALESCE(MAX(${sum}),0) AS row,COALESCE(SUM(${sum}),0) AS total, COALESCE(MAX(CASE WHEN ${fields.map((c) => `(typeof(${c}) NOT IN ('null','text','integer') OR (typeof(${c})='integer' AND (${c} > 9007199254740991 OR ${c} < -9007199254740991)))`).join(" OR ")} THEN 1 ELSE 0 END),0) AS bad FROM ${table}`,
      )!;
      bounded(
        [meta.field, meta.row, meta.total].every(
          (x) => Number.isSafeInteger(x) && x >= 0,
        ) &&
          meta.bad === 0 &&
          meta.field <= 65536 &&
          meta.row <= 256 * 1024,
      );
      // Six bytes per input byte covers JSON escapes; fixed overhead covers keys.
      expandedBytes += 6 * meta.total + n * fields.length * 128;
      bounded(expandedBytes <= LIMIT);
    }
    // Inbox has no org/effect/payment identity or retained event+payment
    // preimage. Refuse global Stripe history before presenting an empty set.
    check(
      Number(
        this.store.get(
          "SELECT COUNT(*) AS n FROM integration_inbox WHERE provider='stripe'",
        )!.n,
      ) === 0,
      "OFFLINE_CHECKOUT_INBOX_HISTORY_REQUIRED",
      "Owning attribution of retained Stripe settlement inbox history is required.",
    );
    const rows = (table: Table): Row[] =>
      this.store.all(
        `SELECT ${columns[table].split(" ").join(",")} FROM ${table}${table === "integration_inbox" ? "" : " WHERE org_id=?"} ORDER BY ${table === "integration_checkout_observations" || table === "integration_balance_observations" ? "sequence" : "rowid"}`,
        ...(table === "integration_inbox" ? [] : [actor.orgId]),
      );
    const effects = rows("integration_effects") as unknown as Effect[];
    const target = effects.find((e) => e.id === effectId);
    intact(
      target && target.provider === "stripe" && target.kind === "checkout",
    );
    profile(target.state === "unknown");
    const payloads = new Map<string, Record<string, any>>();
    for (const e of effects) payloads.set(e.id, json(e.payload));
    const input = payloads.get(target.id)!;
    identifier(input.invoiceId);
    const invoiceId = input.invoiceId;
    identifier(target.account_id);
    // Related non-checkout effects cannot be silently omitted. This initial
    // profile conservatively refuses any such work for the same account.
    profile(
      effects
        .filter((e) => e.account_id === target.account_id)
        .every((e) => e.provider === "stripe" && e.kind === "checkout"),
    );
    const renewals = rows("integration_checkout_renewals");
    const byId = new Map(effects.map((e) => [e.id, e]));
    for (const r of renewals)
      intact(
        byId.has(String(r.predecessor_id)) && byId.has(String(r.successor_id)),
      );
    const selected = effects.filter(
      (e) =>
        e.reference === invoiceId ||
        payloads.get(e.id)!.invoiceId === invoiceId ||
        renewals.some(
          (r) =>
            r.invoice_id === invoiceId &&
            (r.predecessor_id === e.id || r.successor_id === e.id),
        ),
    );
    const ids = selected.map((e) => e.id),
      marks = ids.map(() => "?").join(",");
    const noForeign = (
      table: Table,
      clause: string,
      args: (string | null)[],
    ) => {
      intact(
        Number(
          this.store.get(
            `SELECT COUNT(*) AS n FROM ${table} WHERE org_id<>? AND (${clause})`,
            actor.orgId,
            ...args,
          )!.n,
        ) === 0,
      );
    };
    noForeign(
      "integration_effects",
      `id IN (${marks}) OR account_id=? OR reference=? OR CASE WHEN json_valid(payload) THEN json_extract(payload,'$.invoiceId')=? ELSE 0 END`,
      [...ids, target.account_id, invoiceId, invoiceId],
    );
    noForeign(
      "integration_checkout_renewals",
      `invoice_id=? OR predecessor_id IN (${marks}) OR successor_id IN (${marks})`,
      [invoiceId, ...ids, ...ids],
    );
    noForeign(
      "integration_checkout_observations",
      `invoice_id=? OR account_id=? OR effect_id IN (${marks})`,
      [invoiceId, target.account_id, ...ids],
    );
    const related = renewals.filter(
      (r) =>
        r.invoice_id === invoiceId ||
        ids.includes(String(r.predecessor_id)) ||
        ids.includes(String(r.successor_id)),
    );
    const organization = this.identity.organization(actor);
    const account = this.identity.customer(actor, target.account_id);
    const invoice = this.billing.invoice(actor, invoiceId);
    profile(invoice.origin === "native");
    const totals = this.billing.totals(actor, invoiceId);
    // Billing's complete payment list/page start a new transaction. Its totals
    // and recordedPayment reads cannot prove a complete payment-bearing history.
    check(
      totals.paid === 0 && totals.refunded === 0 && totals.credited === 0,
      "OFFLINE_CHECKOUT_BILLING_HISTORY_REQUIRED",
      "Complete same-writer Billing invoice settlement history is required.",
    );
    intact(
      invoice.org_id === actor.orgId &&
        invoice.account_id === target.account_id &&
        invoice.currency === organization.currency &&
        account.currency === organization.currency,
    );
    integer(invoice.total, 1);
    intact(totals.balance === invoice.total);
    identifier(invoice.number);
    const results = new Map<string, Record<string, any> | null>();
    for (const e of selected) {
      identifier(e.id);
      identifier(e.reference);
      stamp(e.created_at);
      integer(e.residency_version, 1);
      intact(
        e.org_id === actor.orgId &&
          e.account_id === target.account_id &&
          e.provider === "stripe" &&
          e.kind === "checkout",
      );
      const p = payloads.get(e.id)!;
      exact(p, "invoiceId amount currency number");
      intact(
        p.invoiceId === invoice.id &&
          p.amount === invoice.total &&
          p.currency === invoice.currency.toLowerCase() &&
          p.number === invoice.number,
      );
      intact(this.checkouts.invoiceId(e) === invoiceId);
      this.checkouts.assertIdentity(actor, e);
      if (e.started_at !== null) integer(e.started_at);
      if (e.error !== null)
        intact(typeof e.error === "string" && e.error.length <= 65536);
      const result = e.result === null ? null : json(e.result);
      if (result) {
        exact(
          result,
          `amount currency status paymentStatus expiresAt${"checkoutUrl" in result ? " checkoutUrl" : ""}`,
        );
        intact(
          result.amount === p.amount &&
            result.currency === p.currency &&
            ["open", "complete", "expired"].includes(result.status) &&
            ["paid", "unpaid", "no_payment_required"].includes(
              result.paymentStatus,
            ),
        );
        integer(result.expiresAt, 1);
        intact(
          typeof e.external_ref === "string" &&
            /^cs_test_[a-zA-Z0-9_]+$/.test(e.external_ref),
        );
        if ("checkoutUrl" in result)
          intact(
            typeof result.checkoutUrl === "string" &&
              result.checkoutUrl.length <= 4096,
          );
      } else intact(e.external_ref === null);
      results.set(e.id, result);
    }
    intact(selected.length > 0 && related.length === selected.length - 1);
    const root = selected.filter(
      (e) => !related.some((r) => r.successor_id === e.id),
    );
    intact(root.length === 1 && root[0]!.reference === invoiceId);
    const chain: string[] = [];
    let next: string | undefined = root[0]!.id;
    while (next) {
      intact(!chain.includes(next));
      chain.push(next);
      const outgoing = related.filter((r) => r.predecessor_id === next);
      intact(outgoing.length <= 1);
      const r = outgoing[0];
      if (!r) break;
      const predecessor = byId.get(String(r.predecessor_id))!,
        successor = byId.get(String(r.successor_id));
      intact(
        successor &&
          ids.includes(successor.id) &&
          r.invoice_id === invoiceId &&
          successor.reference === `renewal:${predecessor.id}`,
      );
      stamp(r.created_at);
      intact(
        r.created_at >= predecessor.created_at &&
          r.created_at >= successor.created_at,
      );
      intact(
        typeof r.reason === "string" &&
          r.reason.length > 0 &&
          r.reason.length <= 1000 &&
          r.reason.trim() === r.reason,
      );
      hash(r.review_version);
      const unsent = predecessor.state === "blocked";
      if (unsent)
        intact(
          predecessor.result === null &&
            predecessor.external_ref === null &&
            predecessor.started_at === null &&
            predecessor.error ===
              "Replaced by a reviewed checkout before sending.",
        );
      else {
        const proof = results.get(predecessor.id);
        profile(
          predecessor.state === "completed" &&
            predecessor.error === null &&
            proof?.status === "expired" &&
            proof.paymentStatus === "unpaid",
        );
      }
      intact(
        r.review_version ===
          digest(
            canonical({
              id: predecessor.id,
              state: unsent ? "pending" : predecessor.state,
              reference: predecessor.external_ref,
              result: predecessor.result,
              error: unsent ? null : predecessor.error,
              successor: null,
            }),
          ),
      );
      intact(
        this.checkouts.successor(predecessor)?.successor_id === successor.id,
      );
      next = successor.id;
    }
    intact(chain.length === selected.length);
    profile(chain.at(-1) === target.id);
    intact(
      this.checkouts.current(actor, invoiceId)?.id === target.id &&
        !this.checkouts.successor(target),
    );
    const observations = rows("integration_checkout_observations");
    for (const r of observations) intact(byId.has(String(r.effect_id)));
    const selectedObservations = observations.filter(
      (r) =>
        r.invoice_id === invoiceId ||
        r.account_id === target.account_id ||
        ids.includes(String(r.effect_id)),
    );
    const snapshots = new Map<string, Record<string, any>[]>();
    for (const r of selectedObservations) {
      intact(
        ids.includes(String(r.effect_id)) &&
          r.org_id === actor.orgId &&
          r.invoice_id === invoiceId &&
          r.account_id === target.account_id,
      );
      integer(r.sequence, 1);
      identifier(r.id);
      identifier(r.claim_token);
      identifier(r.actor_id);
      hash(r.hash);
      const s = json(r.snapshot),
        e = byId.get(String(r.effect_id))!;
      exact(
        s,
        "id effectId invoiceId observedAt source outcome reference amount currency status paymentStatus expiresAt",
      );
      intact(
        digest(String(r.snapshot)) === r.hash &&
          s.id === r.id &&
          s.effectId === e.id &&
          s.invoiceId === invoiceId &&
          s.amount === invoice.total &&
          s.currency === invoice.currency,
      );
      stamp(s.observedAt);
      intact(s.observedAt >= e.created_at);
      intact(
        ["send", "reconcile", "refresh", "close"].includes(s.source) &&
          ["verified", "not_found", "unverified"].includes(s.outcome),
      );
      if (s.reference !== null)
        intact(
          typeof s.reference === "string" &&
            /^cs_test_[a-zA-Z0-9_]+$/.test(s.reference),
        );
      if (s.outcome === "verified") {
        intact(
          s.reference !== null &&
            ["open", "complete", "expired"].includes(s.status) &&
            ["paid", "unpaid", "no_payment_required"].includes(s.paymentStatus),
        );
        integer(s.expiresAt, 1);
      } else
        intact(
          s.status === null && s.paymentStatus === null && s.expiresAt === null,
        );
      intact(e.state !== "blocked");
      const list = snapshots.get(e.id) ?? [];
      list.push(s);
      snapshots.set(e.id, list);
    }
    for (const e of selected) {
      const result = results.get(e.id),
        history = snapshots.get(e.id) ?? [];
      if (result) {
        const latest = history.filter((s) => s.outcome !== "not_found").at(-1);
        intact(
          latest &&
            latest.outcome === "verified" &&
            latest.reference === e.external_ref &&
            latest.status === result.status &&
            latest.paymentStatus === result.paymentStatus &&
            latest.expiresAt === result.expiresAt,
        );
        intact(
          history.every(
            (s) => s.reference === null || s.reference === e.external_ref,
          ),
        );
      } else
        intact(
          history.every(
            (s) => s.outcome === "not_found" && s.reference === null,
          ),
        );
    }
    const sessions = selected.flatMap((e) =>
      e.external_ref ? [e.external_ref] : [],
    );
    if (sessions.length)
      noForeign(
        "integration_effects",
        `external_ref IN (${sessions.map(() => "?").join(",")})`,
        sessions,
      );
    const collections: Record<string, Row[]> = {};
    for (const table of [
      "integration_operation_leases",
      "integration_callbacks",
      "integration_payment_allocations",
      "integration_refund_callbacks",
      "integration_refund_polls",
      "integration_offline_failed_refunds",
      "integration_accounting_refunds",
      "integration_credit_applications",
      "integration_credit_cancellations",
      "integration_balance_reads",
      "integration_balance_observations",
    ] as const) {
      const extra =
        table === "integration_callbacks" && sessions.length
          ? ` OR session_id IN (${sessions.map(() => "?").join(",")})`
          : "";
      const invoiceScope = columns[table].split(" ").includes("invoice_id")
        ? " OR invoice_id=?"
        : "";
      noForeign(table, `effect_id IN (${marks})${extra}${invoiceScope}`, [
        ...ids,
        ...(extra ? sessions : []),
        ...(invoiceScope ? [invoiceId] : []),
      ]);
      const all = rows(table);
      for (const r of all) intact(byId.has(String(r.effect_id)));
      const relatedRows = all.filter(
        (r) =>
          ids.includes(String(r.effect_id)) ||
          r.invoice_id === invoiceId ||
          (table === "integration_callbacks" &&
            sessions.includes(String(r.session_id))),
      );
      if (table === "integration_operation_leases") {
        for (const r of relatedRows) {
          intact(ids.includes(String(r.effect_id)));
          intact(
            (r.token === null && r.started_at === null) ||
              (typeof r.token === "string" &&
                r.token.length > 0 &&
                r.token.length <= 160 &&
                Number.isSafeInteger(r.started_at) &&
                Number(r.started_at) >= 0),
          );
          if (byId.get(String(r.effect_id))!.state === "blocked")
            intact(r.token === null);
        }
        intact(relatedRows.some((r) => r.effect_id === target.id));
      } else if (table === "integration_callbacks") {
        for (const r of relatedRows) {
          intact(ids.includes(String(r.effect_id)));
          identifier(r.id);
          identifier(r.binding_id);
          identifier(r.event_id);
          identifier(r.session_id);
          hash(r.hash);
          stamp(r.created_at);
          integer(r.attempts);
          integer(r.retry_at);
          intact(
            /^cs_test_[a-zA-Z0-9_]+$/.test(String(r.session_id)) &&
              [
                "pending",
                "processing",
                "waiting",
                "blocked",
                "failed",
                "completed",
              ].includes(String(r.state)),
          );
          if (r.started_at !== null) integer(r.started_at);
          const e = byId.get(String(r.effect_id))!;
          intact(!e.external_ref || e.external_ref === r.session_id);
          profile(r.state !== "completed");
        }
      } else profile(relatedRows.length === 0);
      collections[table] = relatedRows;
    }
    const native = {
      purpose: "integration-offline-unknown-checkout-native-review/v1" as const,
      organization: {
        id: actor.orgId,
        region: organization.region,
        currency: organization.currency,
      },
      accountId: target.account_id,
      invoice: {
        id: invoice.id,
        number: invoice.number,
        accountId: invoice.account_id,
        currency: invoice.currency,
        total: invoice.total,
        origin: invoice.origin,
      },
      totals,
      targetId: target.id,
      currentId: chain.at(-1)!,
      chain,
      effects: selected.sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
      ),
      renewals: related.sort((a, b) =>
        String(a.successor_id) < String(b.successor_id)
          ? -1
          : String(a.successor_id) > String(b.successor_id)
            ? 1
            : 0,
      ),
      observations: selectedObservations,
      collections,
      inbox: [] as Row[],
      billingScope:
        "current-native-invoice-and-zero-settlement-totals" as const,
      // These are the facts for the (empty) Integration allocation set, not a
      // declaration of exhaustive Billing payment/credit/refund provenance.
      allocationPayments: [] as Row[],
    };
    intact(this.store.get("SELECT total_changes() AS n")!.n === unchanged);
    const encoded = canonical(native);
    bounded(Buffer.byteLength(encoded) <= LIMIT);
    // Every object is freshly read/constructed; no caller or owning object escapes.
    return freeze({ ...native, factsHash: digest(encoded) });
  }
}
