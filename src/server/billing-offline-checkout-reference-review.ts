import { types } from "node:util";
import { canonical, check, digest } from "./core.ts";
import { Database, Store } from "./database.ts";
import { Identity } from "./iam.ts";
import { MultiFactor } from "./iam-mfa.ts";
import { FactorCipher } from "./totp.ts";
import { BillingOpening } from "./billing-opening.ts";
import { ProviderResidency } from "./iam-residency.ts";
import { Billing } from "./billing.ts";
import { Platform } from "./platform.ts";
import { Integration } from "./integration.ts";
import { IntegrationCheckouts } from "./integration-checkouts.ts";
import { IntegrationOfflineCheckoutReview } from "./integration-offline-checkout-review.ts";
import { BillingOfflineCheckoutReview } from "./billing-offline-checkout-review.ts";
import { isCapturedOfflineCheckoutComparison } from "./integration-offline-checkout-evidence.ts";

const purpose = "billing-offline-checkout-payment-reference-review-v1";
function intact(value: unknown): asserts value {
  check(
    value,
    "OFFLINE_CHECKOUT_PAYMENT_REFERENCE_REVIEW",
    "Complete native payment reference history is inconsistent.",
  );
}
// Trusted composition must supply actual owners. Pin method identities at module
// load; reject proxies before any reflection and reject instance overrides. This
// is not a sandbox against arbitrary code modifying the module/runtime itself.
const prototypes = [
  Database,
  Store,
  Identity,
  ProviderResidency,
  MultiFactor,
  FactorCipher,
  BillingOpening,
  Billing,
  Platform,
  Integration,
  IntegrationCheckouts,
  IntegrationOfflineCheckoutReview,
  BillingOfflineCheckoutReview,
].map((c) => c.prototype);
const methods = new Map<object, PropertyDescriptorMap>(
  prototypes.map((p) => [p, Object.getOwnPropertyDescriptors(p)]),
);
function owner(value: unknown, prototype: object): asserts value is object {
  intact(value !== null && typeof value === "object" && !types.isProxy(value));
  intact(Object.getPrototypeOf(value) === prototype);
  const ownKeys = Reflect.ownKeys(value);
  intact(ownKeys.length <= 64);
  for (const key of ownKeys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    intact(d && "value" in d);
  }
  const pinned = methods.get(prototype)!;
  const current = Object.getOwnPropertyDescriptors(prototype);
  intact(Reflect.ownKeys(current).length === Reflect.ownKeys(pinned).length);
  for (const [key, d] of Object.entries(pinned)) {
    const now = current[key];
    intact(
      now && now.value === d.value && now.get === d.get && now.set === d.set,
    );
    if (key !== "constructor")
      intact(!Object.getOwnPropertyDescriptor(value, key));
  }
}
function member(value: object, name: string): unknown {
  const d = Object.getOwnPropertyDescriptor(value, name);
  intact(d && "value" in d);
  return d.value;
}
function principal(input: unknown) {
  intact(input !== null && typeof input === "object" && !types.isProxy(input));
  intact(Object.getPrototypeOf(input) === Object.prototype);
  intact(Reflect.ownKeys(input).length === 2);
  const id = member(input, "id"),
    orgId = member(input, "orgId");
  for (const v of [id, orgId])
    intact(
      typeof v === "string" &&
        v.length > 0 &&
        v.length <= 128 &&
        v.trim() === v &&
        !/[\u0000-\u001f\u007f\ud800-\udfff]/.test(v),
    );
  return { id: id as string, orgId: orgId as string };
}
function frozen<T>(v: T): T {
  if (v !== null && typeof v === "object") {
    Object.values(v).forEach(frozen);
    Object.freeze(v);
  }
  return v;
}

const sets = {
  invoice: [
    "billing_invoices",
    "id org_id account_id order_id shipment_id number currency net tax total created_at",
    "net tax total",
    "id",
  ],
  invoiceLines: [
    "billing_lines",
    "id org_id invoice_id product_id description quantity unit_price unit_tax",
    "quantity unit_price unit_tax",
    "id",
  ],
  credits: [
    "billing_credits",
    "id org_id invoice_id reference number reason net tax total created_at",
    "net tax total",
    "id",
  ],
  creditLines: [
    "billing_credit_lines",
    "id org_id credit_id invoice_line_id quantity",
    "quantity",
    "id",
  ],
  payments: [
    "billing_payments",
    "id org_id invoice_id provider external_ref amount created_at",
    "amount",
    "id",
  ],
  refunds: [
    "billing_refunds",
    "id org_id invoice_id payment_id amount reference state created_at",
    "amount",
    "id",
  ],
  providerMappings: [
    "billing_refund_provider",
    "refund_id org_id external_ref status",
    "",
    "refund_id,org_id",
  ],
  observations: [
    "billing_refund_observations",
    "id org_id refund_id external_ref status applied created_at",
    "id applied",
    "id",
  ],
  manualProofs: [
    "billing_refund_proofs",
    "org_id external_ref refund_id created_at",
    "",
    "refund_id,org_id,external_ref",
  ],
  notices: [
    "billing_refund_alerts",
    "seq org_id refund_id invoice_id status state revision created_at updated_at",
    "seq revision",
    "seq",
  ],
  noticeUpdates: [
    "billing_refund_alert_updates",
    "org_id refund_id revision status state source created_at",
    "revision",
    "refund_id,revision,org_id",
  ],
  noticeReads: [
    "billing_refund_alert_reads",
    "org_id refund_id actor_id revision acknowledged_at",
    "revision",
    "refund_id,actor_id,org_id",
  ],
  openingDocuments: [
    "billing_opening_documents",
    "invoice_id org_id source_ref source_id batch_id source_hash cutoff_at issued_at due_at credited paid refunded balance created_by imported_at",
    "credited paid refunded balance",
    "invoice_id",
  ],
  openingLines: [
    "billing_opening_lines",
    "line_id org_id invoice_id credited_quantity",
    "credited_quantity",
    "line_id",
  ],
} as const;
export const checkoutPaymentReferenceLimits = Object.freeze({
  rowsPerSet: 256,
  rows: 1024,
  fieldBytes: 65536,
  rowBytes: 131072,
  bytes: 2097152,
});
type Rows = Record<keyof typeof sets, Record<string, any>[]>;
function bounded(v: unknown): asserts v {
  check(
    v,
    "OFFLINE_CHECKOUT_PAYMENT_REFERENCE_LIMIT",
    "Complete payment reference history exceeds the fixed bound.",
  );
}
function profile(v: unknown): asserts v {
  check(
    v,
    "OFFLINE_CHECKOUT_PAYMENT_REFERENCE_SCOPE_REQUIRED",
    "Complete payment reference review requires an owning scoped history profile.",
  );
}
function collision(v: unknown): asserts v {
  check(
    v,
    "OFFLINE_CHECKOUT_PAYMENT_REFERENCE_COLLISION",
    "Proposed payment identity conflicts with retained native history.",
  );
}
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

const issued = new WeakSet<object>();
export function isCapturedOfflineCheckoutPaymentReferenceReview(
  v: unknown,
): v is OfflineCheckoutPaymentReferenceReview {
  return v !== null && typeof v === "object" && issued.has(v);
}
/** Read-only, call-scoped current consistency. Discharges only the proposed
 * payment-reference closure within this fixed profile; external checks remain.
 * It cannot authorize an import, release, retry or provider request. */
export class BillingOfflineCheckoutReferenceReview {
  readonly #database: Database;
  readonly #identity: Identity;
  readonly #billing: Billing;
  readonly #checkouts: IntegrationCheckouts;
  readonly #platform: Platform;
  readonly #integration: IntegrationOfflineCheckoutReview;
  readonly #billingReview: BillingOfflineCheckoutReview;
  #busy = false;
  #poison = false;
  constructor(
    database: Database,
    identity: Identity,
    billing: Billing,
    checkouts: IntegrationCheckouts,
  ) {
    this.#database = database;
    this.#identity = identity;
    this.#billing = billing;
    this.#checkouts = checkouts;
    owner(identity, Identity.prototype);
    const platform = member(identity, "platform");
    owner(platform, Platform.prototype);
    this.#platform = platform as Platform;
    this.#owners();
    this.#integration = new IntegrationOfflineCheckoutReview(
      database,
      identity,
      billing,
      checkouts,
    );
    this.#billingReview = new BillingOfflineCheckoutReview(
      database,
      identity,
      billing,
    );
  }
  #owners() {
    const db = this.#database,
      iam = this.#identity,
      billing = this.#billing,
      checkouts = this.#checkouts,
      platform = this.#platform;
    owner(db, Database.prototype);
    owner(iam, Identity.prototype);
    owner(billing, Billing.prototype);
    owner(checkouts, IntegrationCheckouts.prototype);
    owner(platform, Platform.prototype);
    const path = member(db, "path");
    intact(
      typeof path === "string" &&
        path.length > 0 &&
        path.length <= 4096 &&
        !path.includes("\0"),
    );
    const region = member(iam, "region");
    intact(region === "CA" || region === "US");
    const opening = member(billing, "opening");
    owner(opening, BillingOpening.prototype);
    intact(
      member(opening, "identity") === iam &&
        member(opening, "platform") === platform &&
        member(opening, "store") === member(billing, "store"),
    );
    const mfa = member(iam, "mfa");
    owner(mfa, MultiFactor.prototype);
    intact(
      member(mfa, "database") === db && member(mfa, "platform") === platform,
    );
    const mfaStore = member(mfa, "store");
    owner(mfaStore, Store.prototype);
    intact(
      member(mfaStore, "database") === db &&
        member(mfaStore, "owner") === "iam",
    );
    owner(member(mfa, "cipher"), FactorCipher.prototype);
    const integration = member(checkouts, "integration");
    owner(integration, Integration.prototype);
    for (const o of [iam, billing, platform, integration])
      intact(member(o, "database") === db);
    for (const o of [billing, checkouts, integration])
      intact(member(o, "identity") === iam);
    for (const o of [iam, billing, checkouts, integration])
      intact(member(o, "platform") === platform);
    for (const o of [checkouts, integration])
      intact(member(o, "billing") === billing);
    intact(member(integration, "checkouts") === checkouts);
    const residency = member(iam, "residency");
    owner(residency, ProviderResidency.prototype);
    intact(member(residency, "platform") === platform);
    intact(member(residency, "region") === region);
    const roles = member(iam, "mfaRequiredRoles");
    intact(
      roles !== null &&
        typeof roles === "object" &&
        !types.isProxy(roles) &&
        Array.isArray(roles) &&
        Object.getPrototypeOf(roles) === Array.prototype,
    );
    const length = member(roles, "length");
    intact(
      typeof length === "number" &&
        length <= 16 &&
        Reflect.ownKeys(roles).length === length + 1,
    );
    for (let i = 0; i < length; i++)
      intact(typeof member(roles, String(i)) === "string");
    const residencyStore = member(residency, "store");
    owner(residencyStore, Store.prototype);
    intact(
      member(residencyStore, "database") === db &&
        member(residencyStore, "owner") === "iam",
    );
    for (const [o, name] of [
      [iam, "iam"],
      [billing, "billing"],
      [platform, "platform"],
      [integration, "integration"],
      [checkouts, "integration"],
    ] as const) {
      const s = member(o, "store");
      owner(s, Store.prototype);
      intact(member(s, "database") === db && member(s, "owner") === name);
    }
  }
  /** Fixed composition check for the adjacent Integration-owned reader. No
   * SQL/callback/facts/permission port, and no authority receipt is returned. */
  assertOwningCompositionInTransaction() {
    this.#assertComposition();
  }
  #assertComposition() {
    this.#owners();
    owner(this.#integration, IntegrationOfflineCheckoutReview.prototype);
    owner(this.#billingReview, BillingOfflineCheckoutReview.prototype);
    this.#database.requireTransaction();
    check(
      this.#platform.rawRecoveryHoldInTransaction(),
      "OFFLINE_CHECKOUT_REFERENCE_RAW_HOLD",
      "Current raw recovery hold is required.",
    );
  }
  #scan(orgId: string, reference: string) {
    const store = this.#database.owned("billing");
    let rows = 0,
      bytes = 0;
    // ALL global fixed sets pass numeric type/count/byte/NUL aggregates before
    // any retained field is returned to JS. No scoped WHERE or page can hide it.
    for (const [table, fixed, numeric] of Object.values(sets)) {
      const fields = fixed.split(" "),
        numbers = numeric.split(" ");
      const n = Number(
        store.get(
          `SELECT COUNT(*) AS n FROM (SELECT 1 FROM ${table} LIMIT 257)`,
        )!.n,
      );
      bounded(n <= 256 && (rows += n) <= 1024);
      const sizes = fields.map((c) => `COALESCE(length(CAST(${c} AS BLOB)),0)`),
        sum = sizes.join("+");
      const meta = store.get<{
        field: number;
        row: number;
        total: number;
        bad: number;
      }>(
        `SELECT COALESCE(MAX(MAX(${sizes.join(",")})),0) AS field,COALESCE(MAX(${sum}),0) AS row,COALESCE(SUM(${sum}),0) AS total,COALESCE(MAX(CASE WHEN ${fields.map((c) => (numbers.includes(c) ? `(typeof(${c})!='integer' OR ${c}<0 OR ${c}>9007199254740991)` : `(typeof(${c})!='text' OR instr(CAST(${c} AS BLOB),x'00')>0)`)).join(" OR ")} THEN 1 ELSE 0 END),0) AS bad FROM ${table}`,
      )!;
      intact(meta.bad === 0);
      bounded(
        [meta.field, meta.row, meta.total].every(Number.isSafeInteger) &&
          meta.field <= 65536 &&
          meta.row <= 131072,
      );
      bytes += 6 * meta.total + n * fields.length * 128;
      bounded(bytes <= 2097152);
    }
    const result = {} as Rows;
    for (const [name, [table, fixed, numeric, order]] of Object.entries(sets)) {
      const fields = fixed.split(" "),
        numbers = numeric.split(" "),
        text = fields.filter((c) => !numbers.includes(c));
      const selected = store.all(
        `SELECT ${fields.join(",")},${text.map((c) => `hex(CAST(${c} AS BLOB)) AS witness_${c}`).join(",")} FROM ${table} ORDER BY ${order}`,
      );
      result[name as keyof Rows] = selected.map((row) => {
        for (const c of text) {
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
    // Do not restrict the collision search to current tenant/invoice/provider.
    // Even a malformed copied provider label cannot hide a retained identity.
    for (const name of [
      "payments",
      "providerMappings",
      "observations",
      "manualProofs",
    ] as const)
      collision(!result[name].some((r) => r.external_ref === reference));
    profile(
      Object.values(result).every((set) =>
        set.every((r) => r.org_id === orgId),
      ),
    );
    profile(
      result.openingDocuments.length === 0 && result.openingLines.length === 0,
    );
    const invoices = new Map(result.invoice.map((r) => [r.id, r])),
      credits = new Map(result.credits.map((r) => [r.id, r])),
      lines = new Map(result.invoiceLines.map((r) => [r.id, r])),
      payments = new Map(result.payments.map((r) => [r.id, r])),
      refunds = new Map(result.refunds.map((r) => [r.id, r]));
    const same = (
      row: Record<string, any>,
      parent: Record<string, any> | undefined,
    ) => {
      intact(parent && parent.org_id === row.org_id);
      return parent;
    };
    for (const r of [
      ...result.invoiceLines,
      ...result.credits,
      ...result.payments,
    ])
      same(r, invoices.get(r.invoice_id));
    for (const r of result.creditLines) {
      const credit = same(r, credits.get(r.credit_id)),
        line = same(r, lines.get(r.invoice_line_id));
      intact(credit.invoice_id === line.invoice_id);
    }
    for (const r of result.refunds) {
      same(r, invoices.get(r.invoice_id));
      const payment = same(r, payments.get(r.payment_id));
      intact(payment.invoice_id === r.invoice_id);
    }
    for (const name of [
      "providerMappings",
      "observations",
      "manualProofs",
      "notices",
      "noticeUpdates",
      "noticeReads",
    ] as const)
      for (const r of result[name]) {
        const refund = same(r, refunds.get(r.refund_id));
        if (name === "notices") intact(refund.invoice_id === r.invoice_id);
        if (name === "noticeUpdates" || name === "noticeReads")
          intact(
            result.notices.some(
              (n) => n.refund_id === r.refund_id && n.org_id === r.org_id,
            ),
          );
      }
    return result;
  }
  getInTransaction(actorInput: unknown, comparisonInput: unknown) {
    if (this.#busy) {
      this.#poison = true;
      intact(false);
    }
    this.#busy = true;
    this.#poison = false;
    try {
      this.#assertComposition();
      intact(isCapturedOfflineCheckoutComparison(comparisonInput));
      const comparison = comparisonInput,
        locator = principal(actorInput),
        store = this.#database.owned("billing"),
        changes = store.get("SELECT total_changes() AS n")!.n;
      const authority = () => {
        const actor = this.#identity.workerActor(locator.orgId, locator.id);
        intact(actor.orgId === comparison.orgId);
        this.#identity.providerAllowed(actor, comparison.accountId, "stripe");
        return actor;
      };
      const actor = authority(),
        hold = this.#platform.rawRecoveryHoldInTransaction();
      check(
        hold,
        "OFFLINE_CHECKOUT_REFERENCE_RAW_HOLD",
        "Current raw recovery hold is required.",
      );
      const rows = this.#scan(
        actor.orgId,
        comparison.outcome.settlement.paymentId,
      );
      const histories = rows.invoice.map((invoice) =>
        this.#billingReview.getInTransaction(actor, invoice.id),
      );
      const billing = histories.find(
        (r) => r.invoice.id === comparison.invoiceId,
      );
      intact(billing && billing.accountId === comparison.accountId);
      const native = this.#integration.getInTransaction(
        actor,
        comparison.effectId,
      );
      intact(
        native.factsHash === comparison.nativeHash &&
          native.invoice.id === comparison.invoiceId &&
          native.accountId === comparison.accountId,
      );
      const candidate = this.#database.captureRestoreCandidateInTransaction();
      intact(digest(canonical(candidate)) === comparison.candidateHash);
      const factsHash = digest(
        canonical({
          purpose: "billing-offline-checkout-payment-reference-facts-v1",
          rows,
          histories: histories.map((r) => ({
            invoiceId: r.invoice.id,
            factsHash: r.factsHash,
          })),
        }),
      );
      intact(
        canonical(
          this.#scan(actor.orgId, comparison.outcome.settlement.paymentId),
        ) === canonical(rows),
      );
      this.#assertComposition();
      authority();
      intact(
        canonical(hold) ===
          canonical(this.#platform.rawRecoveryHoldInTransaction()),
      );
      intact(
        canonical(candidate) ===
          canonical(this.#database.captureRestoreCandidateInTransaction()),
      );
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
        reference: comparison.outcome.settlement.paymentId,
        comparisonHash: comparison.hash,
        bindingHash: digest(canonical(comparison.binding)),
        candidateHash: comparison.candidateHash,
        nativeHash: native.factsHash,
        factsHash,
        disposition: "no-retained-reference-match" as const,
        requiredChecks: comparison.requiredChecks.filter(
          (c) =>
            c !==
            "billing-proposed-payment-reference-history-contract-required",
        ),
      };
      const receipt = frozen({ ...body, hash: digest(canonical(body)) });
      issued.add(receipt);
      return receipt;
    } finally {
      this.#busy = false;
    }
  }
}
export type OfflineCheckoutPaymentReferenceReview = ReturnType<
  BillingOfflineCheckoutReferenceReview["getInTransaction"]
>;
