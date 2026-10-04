import { types } from "node:util";
import { canonical, digest, DomainError } from "./core.ts";
import type { IntegrationOfflineCheckoutReview } from "./integration-offline-checkout-review.ts";
import type { Database } from "./database.ts";

export type CheckoutNativeReview = ReturnType<
  IntegrationOfflineCheckoutReview["getInTransaction"]
>;
export type CheckoutCandidateStore = ReturnType<
  Database["captureRestoreCandidateInTransaction"]
>;
export type OfflineCheckoutEvidenceInput = {
  version: 1;
  profile: "stripe-first-unknown-checkout-paid-v1";
  source: CheckoutNativeReview;
  candidate: CheckoutNativeReview;
  candidateStore: CheckoutCandidateStore;
  binding: {
    provider: "stripe";
    mode: "test";
    scope: "direct-account";
    orgId: string;
    accountId: string;
    runtimeBindingId: string;
    stripeAccountId: string;
  };
  provider: {
    stripeAccountId: string;
    session: {
      object: "checkout.session";
      id: string;
      mode: "payment";
      livemode: false;
      status: "complete";
      payment_status: "paid";
      amount_total: number;
      currency: "cad" | "usd";
      expires_at: number;
      url: null;
      metadata: { effect_id: string };
      payment_intent: {
        object: "payment_intent";
        id: string;
        status: "succeeded";
        livemode: false;
        amount: number;
        amount_received: number;
        currency: "cad" | "usd";
        metadata: { effect_id: string };
        on_behalf_of: null;
        transfer_data: null;
        application_fee_amount: null;
      };
    };
  };
};
export const offlineCheckoutEvidenceLimits = Object.freeze({
  bytes: 131072,
  stringBytes: 65536,
  keyBytes: 64,
  nodes: 4096,
  depth: 20,
  keys: 64,
  arrayItems: 128,
});
type Data = Record<string, any>;
function need(v: unknown): asserts v {
  if (!v)
    throw new DomainError(
      "OFFLINE_CHECKOUT_EVIDENCE",
      "Unsupported or inconsistent checkout evidence.",
    );
}
function bound(v: unknown): asserts v {
  if (!v)
    throw new DomainError(
      "OFFLINE_CHECKOUT_EVIDENCE_LIMIT",
      "Checkout evidence exceeds the fixed capture profile.",
    );
}
function profile(v: unknown): asserts v {
  if (!v)
    throw new DomainError(
      "OFFLINE_CHECKOUT_EVIDENCE_PROFILE",
      "Checkout history requires another owning evidence profile.",
    );
}
const wellFormed = (s: string) =>
  !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(
    s,
  );
function string(v: unknown, max = 160): asserts v is string {
  need(
    typeof v === "string" &&
      v.length > 0 &&
      v.length <= max &&
      v === v.trim() &&
      wellFormed(v) &&
      !/[\u0000-\u001f\u007f]/.test(v),
  );
}
function hash(v: unknown): asserts v is string {
  need(typeof v === "string" && /^[a-f0-9]{64}$/.test(v));
}
function integer(
  v: unknown,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): asserts v is number {
  need(
    typeof v === "number" &&
      Number.isSafeInteger(v) &&
      !Object.is(v, -0) &&
      v >= min &&
      v <= max,
  );
}
function instant(v: unknown): asserts v is string {
  string(v, 32);
  need(
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) &&
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString() === v,
  );
}
function fields(v: unknown, names: string): asserts v is Data {
  need(v !== null && typeof v === "object" && !Array.isArray(v));
  need(Object.keys(v).sort().join(" ") === names.split(" ").sort().join(" "));
}
function empty(v: unknown) {
  profile(Array.isArray(v) && v.length === 0);
}
function freeze<T>(v: T): T {
  if (v !== null && typeof v === "object") {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
}
// Bounded descriptor-only capture. No untrusted value reaches canonical/hash,
// clone, coercion or a property read before this complete traversal succeeds.
function capture(input: unknown): unknown {
  let bytes = 0,
    nodes = 0;
  const active = new WeakSet<object>();
  const charge = (s: string, key = false) => {
    bound(
      s.length <=
        (key
          ? offlineCheckoutEvidenceLimits.keyBytes
          : offlineCheckoutEvidenceLimits.stringBytes),
    );
    // The older zero-settlement owner returns decoded SQLite TEXT. This
    // narrow profile refuses U+FFFD too, so a selected lossy UTF-8 decoding
    // cannot be captured as an exact fact (valid literal U+FFFD also refuses).
    need(wellFormed(s) && !s.includes("\0") && !s.includes("\ufffd"));
    const n = Buffer.byteLength(s, "utf8");
    bound(
      n <=
        (key
          ? offlineCheckoutEvidenceLimits.keyBytes
          : offlineCheckoutEvidenceLimits.stringBytes),
    );
    // Worst-case JSON escaping plus separators; checked before serialization.
    bytes += n * 6 + 4;
    bound(bytes <= offlineCheckoutEvidenceLimits.bytes);
  };
  function copy(v: unknown, depth: number): unknown {
    need(!types.isProxy(v));
    bound(
      ++nodes <= offlineCheckoutEvidenceLimits.nodes &&
        depth <= offlineCheckoutEvidenceLimits.depth,
    );
    bytes += 8;
    bound(bytes <= offlineCheckoutEvidenceLimits.bytes);
    if (typeof v === "string") {
      charge(v);
      return v;
    }
    if (v === null || typeof v === "boolean") return v;
    if (typeof v === "number") {
      integer(v, -Number.MAX_SAFE_INTEGER);
      bytes += 16;
      bound(bytes <= offlineCheckoutEvidenceLimits.bytes);
      return v;
    }
    need(v !== null && typeof v === "object" && !active.has(v));
    const array = Array.isArray(v);
    need(
      array
        ? Object.getPrototypeOf(v) === Array.prototype
        : [Object.prototype, null].includes(Object.getPrototypeOf(v)),
    );
    active.add(v);
    const keys = Reflect.ownKeys(v);
    bound(
      keys.length <=
        (array
          ? offlineCheckoutEvidenceLimits.arrayItems + 1
          : offlineCheckoutEvidenceLimits.keys),
    );
    let length = 0;
    if (array) {
      const d = Object.getOwnPropertyDescriptor(v, "length");
      need(d && "value" in d && !d.enumerable);
      integer(d.value, 0, offlineCheckoutEvidenceLimits.arrayItems);
      length = d.value;
      need(keys.length === length + 1);
    }
    const out: Data | unknown[] = array ? [] : {};
    for (const key of keys) {
      need(typeof key === "string");
      charge(key, true);
      if (array && key === "length") continue;
      need(
        !["__proto__", "constructor", "prototype", "then", "toJSON"].includes(
          key,
        ),
      );
      if (array) need(/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < length);
      const d = Object.getOwnPropertyDescriptor(v, key);
      need(d && d.enumerable && "value" in d);
      Object.defineProperty(out, key, {
        value: copy(d.value, depth + 1),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    active.delete(v);
    return out;
  }
  return copy(input, 0);
}
const collectionNames =
  "integration_operation_leases integration_callbacks integration_payment_allocations integration_refund_callbacks integration_refund_polls integration_offline_failed_refunds integration_accounting_refunds integration_credit_applications integration_credit_cancellations integration_balance_reads integration_balance_observations";
function native(v: unknown) {
  fields(
    v,
    "purpose organization accountId invoice totals targetId currentId chain effects renewals observations collections inbox billingScope allocationPayments factsHash",
  );
  profile(
    v.purpose === "integration-offline-unknown-checkout-native-review/v1" &&
      v.billingScope === "current-native-invoice-and-zero-settlement-totals",
  );
  fields(v.organization, "id region currency");
  string(v.organization.id);
  need(
    ["CA", "US"].includes(v.organization.region) &&
      ["CAD", "USD"].includes(v.organization.currency) &&
      (v.organization.region === "CA" || v.organization.currency === "USD"),
  );
  string(v.accountId);
  string(v.targetId);
  need(v.targetId === v.currentId);
  fields(v.invoice, "id number accountId currency total origin");
  string(v.invoice.id);
  string(v.invoice.number);
  integer(v.invoice.total, 1, 1e12);
  need(
    v.invoice.accountId === v.accountId &&
      v.invoice.currency === v.organization.currency &&
      v.invoice.origin === "native",
  );
  fields(v.totals, "credited paid refunded balance");
  profile(
    v.totals.credited === 0 && v.totals.paid === 0 && v.totals.refunded === 0,
  );
  need(v.totals.balance === v.invoice.total);
  profile(
    Array.isArray(v.chain) &&
      v.chain.length === 1 &&
      v.chain[0] === v.targetId &&
      Array.isArray(v.effects) &&
      v.effects.length === 1,
  );
  for (const name of [
    "renewals",
    "observations",
    "inbox",
    "allocationPayments",
  ])
    empty(v[name]);
  fields(v.collections, collectionNames);
  for (const name of collectionNames.split(" "))
    if (name !== "integration_operation_leases") empty(v.collections[name]);
  const leases = v.collections.integration_operation_leases;
  profile(Array.isArray(leases) && leases.length === 1);
  fields(leases[0], "effect_id org_id token started_at");
  need(
    leases[0].effect_id === v.targetId &&
      leases[0].org_id === v.organization.id,
  );
  profile(leases[0].token === null && leases[0].started_at === null);
  const e = v.effects[0];
  fields(
    e,
    "id org_id account_id provider kind reference payload state external_ref result created_at residency_version started_at error",
  );
  need(
    e.id === v.targetId &&
      e.org_id === v.organization.id &&
      e.account_id === v.accountId &&
      e.reference === v.invoice.id &&
      e.provider === "stripe" &&
      e.kind === "checkout",
  );
  profile(
    e.state === "unknown" && e.external_ref === null && e.result === null,
  );
  instant(e.created_at);
  integer(e.residency_version, 1);
  if (e.started_at !== null) integer(e.started_at);
  if (e.error !== null) string(e.error, 8192);
  const intent = {
    invoiceId: v.invoice.id,
    amount: v.invoice.total,
    currency: v.invoice.currency.toLowerCase(),
    number: v.invoice.number,
  };
  need(e.payload === canonical(intent));
  hash(v.factsHash);
  const { factsHash, ...body } = v;
  need(factsHash === digest(canonical(body)));
  return { facts: v, effect: e, intent };
}
const issued = new WeakSet<object>();
export function isCapturedOfflineCheckoutComparison(
  v: unknown,
): v is OfflineCheckoutComparison {
  return v !== null && typeof v === "object" && issued.has(v);
}
/** Fixed assertion comparison only. Arrays, hashes and test-account declarations
 * authenticate neither provider evidence nor source completeness. */
export function compareOfflineCheckoutPaidEvidence(input: unknown) {
  const v = capture(input);
  fields(v, "version profile source candidate candidateStore binding provider");
  need(v.version === 1);
  profile(v.profile === "stripe-first-unknown-checkout-paid-v1");
  const n = native(v.candidate);
  native(v.source);
  need(canonical(v.source) === canonical(v.candidate));
  const store = v.candidateStore;
  fields(
    store,
    "logicalHash schemaHash snapshotHash sourceCompletedAt restoredAt region organizations",
  );
  for (const k of ["logicalHash", "schemaHash", "snapshotHash"]) hash(store[k]);
  instant(store.sourceCompletedAt);
  instant(store.restoredAt);
  need(
    store.region === n.facts.organization.region &&
      store.sourceCompletedAt <= store.restoredAt,
  );
  need(Array.isArray(store.organizations) && store.organizations.length > 0);
  let previous = "";
  for (const org of store.organizations) {
    fields(org, "id currency");
    string(org.id);
    need(
      org.id > previous &&
        ["CAD", "USD"].includes(org.currency) &&
        (store.region === "CA" || org.currency === "USD"),
    );
    previous = org.id;
  }
  need(
    store.organizations.some(
      (o: Data) =>
        o.id === n.facts.organization.id &&
        o.currency === n.facts.organization.currency,
    ),
  );
  const b = v.binding;
  fields(
    b,
    "provider mode scope orgId accountId runtimeBindingId stripeAccountId",
  );
  need(
    b.provider === "stripe" &&
      b.mode === "test" &&
      b.scope === "direct-account" &&
      b.orgId === n.facts.organization.id &&
      b.accountId === n.facts.accountId,
  );
  string(b.runtimeBindingId);
  string(b.stripeAccountId);
  need(/^acct_[A-Za-z0-9_]+$/.test(b.stripeAccountId));
  fields(v.provider, "stripeAccountId session");
  need(v.provider.stripeAccountId === b.stripeAccountId);
  const s = v.provider.session;
  fields(
    s,
    "object id mode livemode status payment_status amount_total currency expires_at url metadata payment_intent",
  );
  string(s.id);
  integer(s.expires_at, 1);
  fields(s.metadata, "effect_id");
  need(
    s.object === "checkout.session" &&
      /^cs_test_[A-Za-z0-9_]+$/.test(s.id) &&
      s.mode === "payment" &&
      s.livemode === false &&
      s.status === "complete" &&
      s.payment_status === "paid" &&
      s.url === null &&
      s.metadata.effect_id === n.effect.id &&
      s.amount_total === n.intent.amount &&
      s.currency === n.intent.currency,
  );
  const p = s.payment_intent;
  fields(
    p,
    "object id status livemode amount amount_received currency metadata on_behalf_of transfer_data application_fee_amount",
  );
  string(p.id);
  fields(p.metadata, "effect_id");
  need(
    p.object === "payment_intent" &&
      /^pi_[A-Za-z0-9_]+$/.test(p.id) &&
      p.status === "succeeded" &&
      p.livemode === false &&
      p.amount === n.intent.amount &&
      p.amount_received === n.intent.amount &&
      p.currency === n.intent.currency &&
      p.metadata.effect_id === n.effect.id &&
      p.on_behalf_of === null &&
      p.transfer_data === null &&
      p.application_fee_amount === null,
  );
  const body = {
    version: 1 as const,
    purpose:
      "distributor-offline-first-unknown-checkout-paid-comparison-v1" as const,
    orgId: b.orgId as string,
    accountId: b.accountId as string,
    invoiceId: n.intent.invoiceId as string,
    effectId: n.effect.id as string,
    nativeHash: n.facts.factsHash as string,
    candidateHash: digest(canonical(store)),
    binding: { ...b } as OfflineCheckoutEvidenceInput["binding"],
    intentHash: digest(n.effect.payload),
    outcome: {
      reference: s.id as string,
      result: {
        amount: n.intent.amount as number,
        currency: n.intent.currency as string,
        status: "complete" as const,
        paymentStatus: "paid" as const,
        expiresAt: s.expires_at as number,
      },
      settlement: {
        paid: true as const,
        amount: n.intent.amount as number,
        currency: n.intent.currency as string,
        effectId: n.effect.id as string,
        livemode: false as const,
        paymentId: p.id as string,
      },
    },
    inputHash: digest(
      canonical({
        purpose: "distributor-offline-first-unknown-checkout-paid-input-v1",
        input: v,
      }),
    ),
    requiredChecks: [
      "qualified-stripe-account-runtime-binding-and-provider-truth",
      "qualified-complete-source-interval-and-command-provenance",
      "current-native-candidate-authority-and-raw-hold",
      "integration-proposed-session-reference-history-contract-required",
      "billing-proposed-payment-reference-history-contract-required",
      "qualified-source-candidate-fences-and-authority-through-commit",
      "fixed-checkout-owner-application-contract-required",
    ] as const,
  };
  const result = freeze({ ...body, hash: digest(canonical(body)) });
  issued.add(result);
  return result;
}
export type OfflineCheckoutComparison = ReturnType<
  typeof compareOfflineCheckoutPaidEvidence
>;
