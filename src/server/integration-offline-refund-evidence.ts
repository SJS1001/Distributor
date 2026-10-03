import { createHash } from "node:crypto";
import { types } from "node:util";
import type { RefundIntent } from "./billing-refunds.ts";
import type { Effect } from "./integration.ts";

// Consistency only: caller-supplied coverage/account/status claims are not proof.
export type OfflineRefundNative = {
  organization: { id: string; region: "CA" | "US"; currency: "CAD" | "USD" };
  account: { id: string; org_id: string; currency: "CAD" | "USD" };
  invoice: {
    id: string;
    org_id: string;
    account_id: string;
    currency: "CAD" | "USD";
    total: number;
  };
  payment: {
    id: string;
    org_id: string;
    invoice_id: string;
    provider: "stripe";
    external_ref: string;
    amount: number;
  };
  refund: {
    id: string;
    org_id: string;
    invoice_id: string;
    payment_id: string;
    amount: number;
    reference: string;
    state: "unknown";
  };
  effect: Omit<
    Effect,
    "provider" | "kind" | "state" | "external_ref" | "result"
  > & {
    provider: "stripe";
    kind: "refund";
    state: "unknown";
    external_ref: null;
    result: null;
  };
};
export type OfflineRefundReceipt = {
  orgId: string;
  actorId: string;
  command: "billing.refund.request" | "stripe.refund";
  key: string;
  requestHash: string;
  result: { id: string; state: "pending" };
  createdAt: string;
};
export type OfflineRefundEmptyHistory = {
  orgId: string;
  effectId: string;
  refundId: string;
  coverage: "complete-for-subject";
  poll: {
    effect_id: string;
    org_id: string;
    token: null;
    started_at: null;
    retry_at: number;
  };
  providerMappings: readonly never[];
  observations: readonly never[];
  callbacks: readonly never[];
  manualProofs: readonly never[];
  notices: readonly never[];
  noticeUpdates: readonly never[];
  noticeReads: readonly never[];
  accountingDescendants: readonly never[];
  genericLeases: readonly never[];
  // One original native request and one queue receipt, in that order.
  receipts: readonly [OfflineRefundReceipt, OfflineRefundReceipt];
};
export type OfflineFailedRefundEvidenceInput = {
  version: 1;
  native: OfflineRefundNative;
  sourceNative: OfflineRefundNative;
  candidateHistory: OfflineRefundEmptyHistory;
  sourceHistory: OfflineRefundEmptyHistory;
  refundRequest: {
    invoiceId: string;
    paymentId: string;
    amount: number;
    reference: string;
    reason: string;
  };
  binding: {
    provider: "stripe";
    mode: "test";
    scope: "direct-account";
    orgId: string;
    accountId: string;
    runtimeBindingId: string;
    stripeAccountId: string;
    profile: "stripe-failed-refund-v1";
  };
  provider: {
    stripeAccountId: string;
    livemode: false;
    coverage: "complete-for-effect";
    matchingRefundIds: readonly [string];
    paymentIntent: {
      object: "payment_intent";
      id: string;
      status: "succeeded";
      livemode: false;
      amount_received: number;
      currency: "cad" | "usd";
    };
    refund: {
      object: "refund";
      id: string;
      payment_intent: string;
      amount: number;
      currency: "cad" | "usd";
      status: "failed";
      metadata: { effect_id: string; refund_id: string };
    };
  };
};
type Frozen<T> = T extends object
  ? { readonly [K in keyof T]: Frozen<T[K]> }
  : T;
export type OfflineFailedRefundComparison = Frozen<{
  version: 1;
  native: OfflineRefundNative;
  /** Exact captured assertions for a later native join, never qualified truth. */
  refundRequest: OfflineFailedRefundEvidenceInput["refundRequest"];
  candidateHistory: OfflineRefundEmptyHistory;
  binding: OfflineFailedRefundEvidenceInput["binding"];
  request: { body: string; bodyHash: string; idempotencyKey: string };
  outcome: {
    reference: string;
    result: {
      effectId: string;
      refundId: string;
      paymentId: string;
      amount: number;
      currency: string;
      status: "failed";
    };
  };
  inputHash: string;
}>;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
function requireFact(ok: unknown): asserts ok {
  if (!ok)
    throw new Error(
      "OFFLINE_REFUND_EVIDENCE: unsupported structure or inconsistent facts",
    );
}

// Never reflect on an untrusted object until isProxy has rejected both ordinary
// and revoked proxies. Descriptors avoid invoking accessors; only detached data
// reaches schema checks, JSON serialization, hashing or property reads below.
function capture(input: unknown): Json {
  const active = new WeakSet<object>();
  let nodes = 0;
  let characters = 0;
  function copy(value: unknown, depth: number): Json {
    requireFact(!types.isProxy(value));
    requireFact(++nodes <= 4096 && depth <= 16);
    if (typeof value === "string") {
      characters += value.length;
      requireFact(value.length <= 8192 && characters <= 65536);
      return value;
    }
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") {
      requireFact(Number.isSafeInteger(value) && !Object.is(value, -0));
      return value;
    }
    requireFact(typeof value === "object" && value !== null);
    requireFact(!active.has(value));
    const array = Array.isArray(value);
    requireFact(
      Object.getPrototypeOf(value) ===
        (array ? Array.prototype : Object.prototype),
    );
    active.add(value);
    const keys = Reflect.ownKeys(value);
    requireFact(keys.length <= (array ? 129 : 64));
    const output: Json[] | { [key: string]: Json } = array
      ? []
      : Object.create(null);
    let length = 0;
    if (array) {
      const descriptor = Object.getOwnPropertyDescriptor(value, "length");
      requireFact(
        descriptor && "value" in descriptor && descriptor.enumerable === false,
      );
      length = descriptor.value;
      requireFact(
        Number.isSafeInteger(length) &&
          length >= 0 &&
          length <= 128 &&
          keys.length === length + 1,
      );
    }
    for (const key of keys) {
      requireFact(typeof key === "string" && key.length <= 128);
      characters += key.length;
      requireFact(characters <= 65536);
      if (array && key === "length") continue;
      requireFact(!["__proto__", "constructor", "prototype"].includes(key));
      if (array)
        requireFact(/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < length);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      requireFact(descriptor?.enumerable === true && "value" in descriptor);
      Object.defineProperty(output, key, {
        value: copy(descriptor.value, depth + 1),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    active.delete(value);
    return output;
  }
  return copy(input, 0);
}

type Schema = (value: Json) => void;
const literal =
  (...values: Json[]): Schema =>
  (value) =>
    requireFact(values.includes(value));
const string =
  (max: number, pattern?: RegExp): Schema =>
  (value) =>
    requireFact(
      typeof value === "string" &&
        value.length > 0 &&
        value.length <= max &&
        value.trim() === value &&
        !/[\u0000-\u001f\u007f]/.test(value) &&
        (!pattern || pattern.test(value)),
    );
const integer =
  (min: number, max = 1e12): Schema =>
  (value) =>
    requireFact(
      typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value >= min &&
        value <= max,
    );
const nullable =
  (schema: Schema): Schema =>
  (value) => {
    if (value !== null) schema(value);
  };
const object =
  (shape: Record<string, Schema>): Schema =>
  (value) => {
    requireFact(
      value !== null && typeof value === "object" && !Array.isArray(value),
    );
    const keys = Object.keys(value);
    requireFact(
      keys.length === Object.keys(shape).length &&
        keys.every((k) => Object.hasOwn(shape, k)),
    );
    for (const [key, validate] of Object.entries(shape)) validate(value[key]!);
  };
const array =
  (schema: Schema, length: number): Schema =>
  (value) => {
    requireFact(Array.isArray(value) && value.length === length);
    for (const child of value) schema(child);
  };
const id = string(128, /^[A-Za-z0-9_-]+$/);
const money = integer(1);
const currency = literal("CAD", "USD");
const timestamp: Schema = (value) => {
  string(
    24,
    /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/,
  )(value);
  const text = value as string;
  const year = Number(text.slice(0, 4)),
    month = Number(text.slice(5, 7)),
    day = Number(text.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  requireFact(
    day <=
      [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!,
  );
};
const pi = string(128, /^pi_[A-Za-z0-9_]+$/);
const re = string(128, /^re_[A-Za-z0-9_]+$/);
const acct = string(128, /^acct_[A-Za-z0-9_]+$/);
const receipt = object({
  orgId: id,
  actorId: id,
  command: literal("billing.refund.request", "stripe.refund"),
  key: string(128),
  requestHash: string(64, /^[a-f0-9]{64}$/),
  result: object({ id, state: literal("pending") }),
  createdAt: timestamp,
});
const empty = array(literal(), 0);
const history = object({
  orgId: id,
  effectId: id,
  refundId: id,
  coverage: literal("complete-for-subject"),
  poll: object({
    effect_id: id,
    org_id: id,
    token: literal(null),
    started_at: literal(null),
    retry_at: integer(0, Number.MAX_SAFE_INTEGER),
  }),
  providerMappings: empty,
  observations: empty,
  callbacks: empty,
  manualProofs: empty,
  notices: empty,
  noticeUpdates: empty,
  noticeReads: empty,
  accountingDescendants: empty,
  genericLeases: empty,
  receipts: array(receipt, 2),
});
const native = object({
  organization: object({ id, region: literal("CA", "US"), currency }),
  account: object({ id, org_id: id, currency }),
  invoice: object({
    id,
    org_id: id,
    account_id: id,
    currency,
    total: integer(0),
  }),
  payment: object({
    id,
    org_id: id,
    invoice_id: id,
    provider: literal("stripe"),
    external_ref: pi,
    amount: money,
  }),
  refund: object({
    id,
    org_id: id,
    invoice_id: id,
    payment_id: id,
    amount: money,
    reference: string(160),
    state: literal("unknown"),
  }),
  effect: object({
    id,
    org_id: id,
    account_id: id,
    provider: literal("stripe"),
    kind: literal("refund"),
    reference: id,
    payload: string(8192),
    state: literal("unknown"),
    external_ref: literal(null),
    result: literal(null),
    created_at: timestamp,
    residency_version: integer(1),
    started_at: nullable(integer(0, Number.MAX_SAFE_INTEGER)),
    error: nullable(string(2048)),
  }),
});
const inputSchema = object({
  version: literal(1),
  native,
  sourceNative: native,
  candidateHistory: history,
  sourceHistory: history,
  refundRequest: object({
    invoiceId: id,
    paymentId: id,
    amount: money,
    reference: string(160),
    reason: string(1000),
  }),
  binding: object({
    provider: literal("stripe"),
    mode: literal("test"),
    scope: literal("direct-account"),
    orgId: id,
    accountId: id,
    runtimeBindingId: string(80, /^[A-Za-z0-9_-]+$/),
    stripeAccountId: acct,
    profile: literal("stripe-failed-refund-v1"),
  }),
  provider: object({
    stripeAccountId: acct,
    livemode: literal(false),
    coverage: literal("complete-for-effect"),
    matchingRefundIds: array(re, 1),
    paymentIntent: object({
      object: literal("payment_intent"),
      id: pi,
      status: literal("succeeded"),
      livemode: literal(false),
      amount_received: money,
      currency: literal("cad", "usd"),
    }),
    refund: object({
      object: literal("refund"),
      id: re,
      payment_intent: pi,
      amount: money,
      currency: literal("cad", "usd"),
      status: literal("failed"),
      metadata: object({ effect_id: id, refund_id: id }),
    }),
  }),
});

// Code-point key order for the new comparison domain. The fixed native intent
// and request keys have the same order under core.canonical; their original
// bytes/hashes are compared exactly, never normalized. Detached objects only.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function freeze<T>(value: T): Frozen<T> {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as Frozen<T>;
}

/** Compares supplied assertions only. No authentication, completeness, finality,
 * source fencing, current permission or import authorization is established. */
export function compareOfflineFailedRefundEvidence(
  input: unknown,
): OfflineFailedRefundComparison {
  const captured = capture(input);
  inputSchema(captured);
  const facts = captured as unknown as OfflineFailedRefundEvidenceInput;
  const n = facts.native;
  const { organization: org, account, invoice, payment, refund, effect } = n;
  requireFact(canonical(n) === canonical(facts.sourceNative));
  requireFact(
    canonical(facts.candidateHistory) === canonical(facts.sourceHistory),
  );
  requireFact(
    (org.region === "CA" || org.currency === "USD") &&
      account.org_id === org.id &&
      account.currency === org.currency &&
      invoice.org_id === org.id &&
      invoice.account_id === account.id &&
      invoice.currency === org.currency,
  );
  requireFact(
    payment.org_id === org.id &&
      payment.invoice_id === invoice.id &&
      refund.org_id === org.id &&
      refund.invoice_id === invoice.id &&
      refund.payment_id === payment.id &&
      refund.amount <= payment.amount,
  );
  requireFact(
    effect.org_id === org.id &&
      effect.account_id === account.id &&
      effect.reference === refund.id,
  );
  const intent: RefundIntent = {
    refundId: refund.id,
    invoiceId: invoice.id,
    paymentId: payment.external_ref,
    paymentAmount: payment.amount,
    amount: refund.amount,
    currency: invoice.currency.toLowerCase(),
  };
  // Exact canonical bytes: never JSON.parse and normalize a changed old payload.
  requireFact(effect.payload === canonical(intent));
  const request = facts.refundRequest;
  requireFact(
    request.invoiceId === invoice.id &&
      request.paymentId === payment.id &&
      request.amount === refund.amount &&
      request.reference === refund.reference,
  );
  const h = facts.candidateHistory;
  requireFact(
    h.orgId === org.id &&
      h.effectId === effect.id &&
      h.refundId === refund.id &&
      h.poll.org_id === org.id &&
      h.poll.effect_id === effect.id,
  );
  const [original, queued] = h.receipts;
  requireFact(
    original.orgId === org.id &&
      original.command === "billing.refund.request" &&
      original.result.id === refund.id &&
      original.requestHash === digest(canonical(request)),
  );
  requireFact(
    queued.orgId === org.id &&
      queued.command === "stripe.refund" &&
      queued.result.id === effect.id &&
      queued.requestHash === digest(canonical({ refundId: refund.id })),
  );
  const { binding, provider } = facts;
  requireFact(
    binding.orgId === org.id &&
      binding.accountId === account.id &&
      provider.stripeAccountId === binding.stripeAccountId,
  );
  const p = provider.paymentIntent;
  const r = provider.refund;
  requireFact(
    p.id === intent.paymentId &&
      p.amount_received === intent.paymentAmount &&
      p.currency === intent.currency,
  );
  requireFact(
    r.payment_intent === intent.paymentId &&
      r.amount === intent.amount &&
      r.currency === intent.currency &&
      r.metadata.effect_id === effect.id &&
      r.metadata.refund_id === refund.id &&
      provider.matchingRefundIds[0] === r.id,
  );
  const body = canonical({
    payment_intent: intent.paymentId,
    amount: intent.amount,
    metadata: { effect_id: effect.id, refund_id: refund.id },
  });
  return freeze({
    version: 1 as const,
    native: n,
    refundRequest: request,
    candidateHistory: h,
    binding,
    request: {
      body,
      bodyHash: digest(body),
      idempotencyKey: `distributor:${effect.id}`,
    },
    outcome: {
      reference: r.id,
      result: {
        effectId: effect.id,
        refundId: refund.id,
        paymentId: payment.external_ref,
        amount: refund.amount,
        currency: intent.currency,
        status: "failed" as const,
      },
    },
    inputHash: digest(
      canonical({
        purpose: "distributor-offline-failed-refund-comparison-v1",
        input: captured,
      }),
    ),
  });
}
