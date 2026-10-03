import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { compareOfflineFailedRefundEvidence } from "../src/server/integration-offline-refund-evidence.ts";

// Independent native fixture: canonical strings are literal, not helper-derived.
const intentBytes =
  '{"amount":300,"currency":"cad","invoiceId":"invoice-1","paymentAmount":1000,"paymentId":"pi_original","refundId":"refund-1"}';
const refundRequestBytes =
  '{"amount":300,"invoiceId":"invoice-1","paymentId":"payment-1","reason":"Original credit","reference":"REF-1"}';
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function fixture() {
  const native = {
    organization: { id: "org-1", region: "CA", currency: "CAD" },
    account: { id: "account-1", org_id: "org-1", currency: "CAD" },
    invoice: {
      id: "invoice-1",
      org_id: "org-1",
      account_id: "account-1",
      currency: "CAD",
      total: 1000,
    },
    payment: {
      id: "payment-1",
      org_id: "org-1",
      invoice_id: "invoice-1",
      provider: "stripe",
      external_ref: "pi_original",
      amount: 1000,
    },
    refund: {
      id: "refund-1",
      org_id: "org-1",
      invoice_id: "invoice-1",
      payment_id: "payment-1",
      amount: 300,
      reference: "REF-1",
      state: "unknown",
    },
    effect: {
      id: "effect-1",
      org_id: "org-1",
      account_id: "account-1",
      provider: "stripe",
      kind: "refund",
      reference: "refund-1",
      payload: intentBytes,
      state: "unknown",
      external_ref: null,
      result: null,
      created_at: "2026-10-01T00:00:00.000Z",
      residency_version: 2,
      started_at: 100,
      error: "Refund verification incomplete",
    },
  };
  const history = {
    orgId: "org-1",
    effectId: "effect-1",
    refundId: "refund-1",
    coverage: "complete-for-subject",
    poll: {
      effect_id: "effect-1",
      org_id: "org-1",
      token: null,
      started_at: null,
      retry_at: 30100,
    },
    providerMappings: [],
    observations: [],
    callbacks: [],
    manualProofs: [],
    notices: [],
    noticeUpdates: [],
    noticeReads: [],
    accountingDescendants: [],
    genericLeases: [],
    receipts: [
      {
        orgId: "org-1",
        actorId: "finance-1",
        command: "billing.refund.request",
        key: "refund-key",
        requestHash: hash(refundRequestBytes),
        result: { id: "refund-1", state: "pending" },
        createdAt: "2026-10-01T00:00:00.000Z",
      },
      {
        orgId: "org-1",
        actorId: "finance-1",
        command: "stripe.refund",
        key: "queue-key",
        requestHash: hash('{"refundId":"refund-1"}'),
        result: { id: "effect-1", state: "pending" },
        createdAt: "2026-10-01T00:00:00.000Z",
      },
    ],
  };
  return {
    version: 1,
    native,
    sourceNative: structuredClone(native),
    candidateHistory: history,
    sourceHistory: structuredClone(history),
    refundRequest: {
      invoiceId: "invoice-1",
      paymentId: "payment-1",
      amount: 300,
      reference: "REF-1",
      reason: "Original credit",
    },
    binding: {
      provider: "stripe",
      mode: "test",
      scope: "direct-account",
      orgId: "org-1",
      accountId: "account-1",
      runtimeBindingId: "binding-1",
      stripeAccountId: "acct_original",
      profile: "stripe-failed-refund-v1",
    },
    provider: {
      stripeAccountId: "acct_original",
      livemode: false,
      paymentIntent: {
        object: "payment_intent",
        id: "pi_original",
        status: "succeeded",
        livemode: false,
        amount_received: 1000,
        currency: "cad",
      },
      refund: {
        object: "refund",
        id: "re_failed",
        payment_intent: "pi_original",
        amount: 300,
        currency: "cad",
        status: "failed",
        metadata: { effect_id: "effect-1", refund_id: "refund-1" },
      },
      coverage: "complete-for-effect",
      matchingRefundIds: ["re_failed"],
    },
  };
}
function rejects(value: unknown) {
  assert.throws(
    () => compareOfflineFailedRefundEvidence(value),
    /OFFLINE_REFUND_EVIDENCE/,
  );
}

test("exact native failed test-refund comparison returns expected request/result and stable frozen facts", () => {
  const f = fixture();
  const result = compareOfflineFailedRefundEvidence(f);
  const body =
    '{"amount":300,"metadata":{"effect_id":"effect-1","refund_id":"refund-1"},"payment_intent":"pi_original"}';
  assert.equal(result.request.body, body);
  assert.equal(result.request.idempotencyKey, "distributor:effect-1");
  assert.equal(result.request.bodyHash, hash(body));
  assert.deepEqual(result.outcome, {
    reference: "re_failed",
    result: {
      effectId: "effect-1",
      refundId: "refund-1",
      paymentId: "pi_original",
      amount: 300,
      currency: "cad",
      status: "failed",
    },
  });
  assert.match(result.inputHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    compareOfflineFailedRefundEvidence(structuredClone(f)),
    result,
  );
  f.native.refund.amount = 1;
  f.provider.refund.metadata.effect_id = "changed";
  assert.equal(result.native.refund.amount, 300);
  assert.equal(result.outcome.result.effectId, "effect-1");
  function frozen(value: unknown) {
    if (value && typeof value === "object") {
      assert(Object.isFrozen(value));
      for (const child of Object.values(value)) frozen(child);
    }
  }
  frozen(result);
  assert.throws(() => {
    (result.outcome.result as { amount: number }).amount = 4;
  }, TypeError);
});

test("US/USD and original partial-refund amounts are preserved", () => {
  const f = fixture();
  for (const n of [f.native, f.sourceNative]) {
    n.organization.region = "US";
    n.organization.currency = n.account.currency = n.invoice.currency = "USD";
    n.effect.payload = intentBytes.replace('"cad"', '"usd"');
  }
  f.provider.refund.currency = f.provider.paymentIntent.currency = "usd";
  assert.equal(
    compareOfflineFailedRefundEvidence(f).outcome.result.currency,
    "usd",
  );
});

test("Canadian organizations retain their native USD refund currency", () => {
  const f = fixture();
  for (const n of [f.native, f.sourceNative]) {
    n.organization.currency = n.account.currency = n.invoice.currency = "USD";
    n.effect.payload = intentBytes.replace('"cad"', '"usd"');
  }
  f.provider.refund.currency = f.provider.paymentIntent.currency = "usd";
  assert.equal(
    compareOfflineFailedRefundEvidence(f).outcome.result.currency,
    "usd",
  );
});

test("every supplied node rejects normal and revoked proxies before any trap", () => {
  const paths: (string | number)[][] = [];
  function visit(v: unknown, path: (string | number)[]) {
    if (v !== null && typeof v === "object") {
      paths.push(path);
      for (const [k, child] of Object.entries(v)) visit(child, [...path, k]);
    }
  }
  visit(fixture(), []);
  for (const path of paths)
    for (const revoked of [false, true]) {
      let traps = 0;
      const handler = Object.fromEntries(
        [
          "get",
          "has",
          "ownKeys",
          "getPrototypeOf",
          "getOwnPropertyDescriptor",
          "set",
          "defineProperty",
          "deleteProperty",
          "isExtensible",
          "preventExtensions",
          "setPrototypeOf",
        ].map((k) => [
          k,
          () => {
            traps++;
            throw Error("trap invoked");
          },
        ]),
      );
      const f = fixture() as unknown as Record<string, unknown>;
      let parent: any = f;
      for (const k of path.slice(0, -1)) parent = parent[k];
      const target = path.length ? parent[path.at(-1)!] : f;
      const proxy = Proxy.revocable(target, handler);
      if (revoked) proxy.revoke();
      if (path.length) parent[path.at(-1)!] = proxy.proxy;
      rejects(path.length ? f : proxy.proxy);
      assert.equal(traps, 0, `${path.join(".")}: revoked=${revoked}`);
    }
});

test("strict capture rejects getters, hidden/symbol keys, prototypes, cycles, holes and collection overflow", () => {
  let reads = 0;
  const mutations: ((f: any) => void)[] = [
    (f) =>
      Object.defineProperty(f.provider.refund, "amount", {
        enumerable: true,
        get() {
          reads++;
          return 300;
        },
      }),
    (f) =>
      Object.defineProperty(f.binding, "secret", {
        value: "hidden",
        enumerable: false,
      }),
    (f) => {
      f.binding[Symbol("secret")] = "x";
    },
    (f) => Object.setPrototypeOf(f.binding, { inherited: true }),
    (f) => {
      f.binding = Object.create(null);
    },
    (f) => {
      f.provider.refund.metadata = f;
    },
    (f) => {
      f.provider.matchingRefundIds = new Array(1);
    },
    (f) => {
      f.provider.matchingRefundIds.extra = true;
    },
    (f) => {
      f.provider.matchingRefundIds = Array(129).fill("re_failed");
    },
    (f) => {
      f.native.effect.payload = "x".repeat(8193);
    },
    (f) => {
      f.binding.toJSON = () => {
        reads++;
        return {};
      };
    },
    (f) => {
      f.native.refund.amount = NaN;
    },
    (f) => {
      f.native.refund.amount = -0;
    },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f);
    rejects(f);
  }
  assert.equal(reads, 0);
});

test("native identity, result, receipt and unsupported-lineage mismatches fail closed", () => {
  const mutations: ((f: any) => void)[] = [
    (f) => {
      f.native.account.org_id = "other";
    },
    (f) => {
      f.native.invoice.account_id = "other";
    },
    (f) => {
      f.native.payment.invoice_id = "other";
    },
    (f) => {
      f.native.refund.payment_id = "pi_original";
    },
    (f) => {
      f.native.effect.reference = "other";
    },
    (f) => {
      f.native.effect.payload += " ";
    },
    (f) => {
      f.native.effect.result = "{}";
    },
    (f) => {
      f.native.effect.external_ref = "re_failed";
    },
    (f) => {
      f.native.effect.state = "running";
    },
    (f) => {
      f.native.refund.state = "completed";
    },
    (f) => {
      f.native.refund.amount = 1001;
    },
    (f) => {
      f.sourceNative.payment.amount = 999;
    },
    (f) => {
      f.binding.stripeAccountId = "acct_other";
    },
    (f) => {
      f.binding.mode = "live";
    },
    (f) => {
      f.binding.scope = "connect";
    },
    (f) => {
      f.binding.apiKey = "sk_test_fake";
    },
    (f) => {
      f.provider.paymentIntent.status = "processing";
    },
    (f) => {
      f.provider.paymentIntent.livemode = true;
    },
    (f) => {
      f.provider.refund.status = "succeeded";
    },
    (f) => {
      f.provider.refund.id = "pi_failed";
    },
    (f) => {
      f.provider.refund.payment_intent = { id: "pi_original" };
    },
    (f) => {
      f.provider.refund.metadata.refund_id = "other";
    },
    (f) => {
      f.provider.refund.currency = "usd";
    },
    (f) => {
      f.provider.refund.amount = 301;
    },
    (f) => {
      f.provider.matchingRefundIds.push("re_second");
    },
    (f) => {
      f.provider.coverage = "first-page";
    },
    (f) => {
      f.candidateHistory.coverage = "partial";
    },
    (f) => {
      f.candidateHistory.poll.token = "abandoned";
    },
    (f) => {
      f.sourceHistory.poll.retry_at++;
    },
    (f) => {
      f.candidateHistory.observations.push({ status: "failed" });
    },
    (f) => {
      f.candidateHistory.receipts.pop();
    },
    (f) => {
      f.candidateHistory.receipts[0].requestHash = "a".repeat(64);
    },
    (f) => {
      f.refundRequest.reason = "Replacement reason";
    },
    (f) => {
      f.candidateHistory.receipts[1].result.state = "completed";
    },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f);
    rejects(f);
  }
});

test("native cross-bindings are checked even when source and candidate agree on corruption", () => {
  const mutations: ((n: any) => void)[] = [
    (n) => {
      n.organization.region = "US";
    },
    (n) => {
      n.account.org_id = "other";
    },
    (n) => {
      n.account.currency = "USD";
    },
    (n) => {
      n.invoice.org_id = "other";
    },
    (n) => {
      n.invoice.account_id = "other";
    },
    (n) => {
      n.invoice.currency = "USD";
    },
    (n) => {
      n.payment.org_id = "other";
    },
    (n) => {
      n.payment.invoice_id = "other";
    },
    (n) => {
      n.payment.external_ref = "pi_other";
    },
    (n) => {
      n.payment.amount = 299;
    },
    (n) => {
      n.refund.org_id = "other";
    },
    (n) => {
      n.refund.invoice_id = "other";
    },
    (n) => {
      n.refund.payment_id = "other";
    },
    (n) => {
      n.refund.reference = "other";
    },
    (n) => {
      n.refund.amount = 301;
    },
    (n) => {
      n.effect.org_id = "other";
    },
    (n) => {
      n.effect.account_id = "other";
    },
    (n) => {
      n.effect.reference = "other";
    },
    (n) => {
      n.effect.payload = intentBytes.replace(
        '"paymentAmount":1000',
        '"paymentAmount":999',
      );
    },
    (n) => {
      n.effect.payload = intentBytes.replace(
        '"currency":"cad"',
        '"currency":"CAD"',
      );
    },
    (n) => {
      n.effect.payload = intentBytes.replace("{", '{"extra":1,');
    },
    (n) => {
      n.effect.created_at = "2026-02-30T00:00:00.000Z";
    },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f.native);
    f.sourceNative = structuredClone(f.native);
    rejects(f);
  }
});

test("matching source history cannot mask incorrect receipts, subjects or unsupported rows", () => {
  const mutations: ((h: any) => void)[] = [
    (h) => {
      h.orgId = "other";
    },
    (h) => {
      h.effectId = "other";
    },
    (h) => {
      h.refundId = "other";
    },
    (h) => {
      h.poll.org_id = "other";
    },
    (h) => {
      h.poll.effect_id = "other";
    },
    (h) => {
      h.poll.started_at = 100;
    },
    (h) => {
      h.receipts.reverse();
    },
    (h) => {
      h.receipts[0].orgId = "other";
    },
    (h) => {
      h.receipts[1].orgId = "other";
    },
    (h) => {
      h.receipts[0].result.id = "other";
    },
    (h) => {
      h.receipts[1].result.id = "other";
    },
    (h) => {
      h.receipts[0].requestHash = "a".repeat(64);
    },
    (h) => {
      h.receipts[1].requestHash = "a".repeat(64);
    },
    (h) => {
      h.receipts.push(structuredClone(h.receipts[1]));
    },
    ...[
      "providerMappings",
      "observations",
      "callbacks",
      "manualProofs",
      "notices",
      "noticeUpdates",
      "noticeReads",
      "accountingDescendants",
      "genericLeases",
    ].map((key) => (h: any) => {
      h[key] = [{ id: "prior" }];
    }),
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f.candidateHistory);
    f.sourceHistory = structuredClone(f.candidateHistory);
    rejects(f);
  }
});

test("every object rejects unknown, hidden, symbol and accessor fields without evaluating them", () => {
  const paths: string[][] = [];
  function visit(v: unknown, path: string[]) {
    if (v !== null && typeof v === "object") {
      paths.push(path);
      for (const [key, child] of Object.entries(v))
        visit(child, [...path, key]);
    }
  }
  visit(fixture(), []);
  let reads = 0;
  for (const path of paths)
    for (const mode of ["unknown", "hidden", "symbol", "accessor"]) {
      const f = fixture();
      let node: any = f;
      for (const key of path) node = node[key];
      const key = mode === "symbol" ? Symbol("unexpected") : "unexpected";
      Object.defineProperty(
        node,
        key,
        mode === "accessor"
          ? {
              enumerable: true,
              get() {
                reads++;
                return "x";
              },
            }
          : { enumerable: mode !== "hidden", value: "x" },
      );
      rejects(f);
    }
  const f = fixture();
  Object.defineProperty(f.provider.matchingRefundIds, "0", {
    enumerable: true,
    get() {
      reads++;
      return "re_failed";
    },
  });
  rejects(f);
  assert.equal(reads, 0);
});

test("function proxies, proxies in scalar slots and proxied prototypes invoke no traps", () => {
  let traps = 0;
  const handler = {
    get() {
      traps++;
      throw Error("get");
    },
    getPrototypeOf() {
      traps++;
      throw Error("prototype");
    },
    ownKeys() {
      traps++;
      throw Error("keys");
    },
  };
  for (const target of [{}, [], () => {}])
    for (const revoked of [false, true]) {
      const p = Proxy.revocable(target, handler);
      if (revoked) p.revoke();
      rejects(p.proxy);
      const f: any = fixture();
      f.provider.refund.amount = p.proxy;
      rejects(f);
      const g: any = fixture();
      Object.setPrototypeOf(g.binding, p.proxy);
      rejects(g);
    }
  assert.equal(traps, 0);
});

test("hash binds all accepted supplied assertions without authenticating them", () => {
  const f = fixture();
  function independentCanonical(v: any): string {
    if (Array.isArray(v)) return `[${v.map(independentCanonical).join(",")}]`;
    if (v && typeof v === "object")
      return `{${Object.keys(v)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${independentCanonical(v[k])}`)
        .join(",")}}`;
    return JSON.stringify(v);
  }
  const expected = hash(
    independentCanonical({
      purpose: "distributor-offline-failed-refund-comparison-v1",
      input: f,
    }),
  );
  const first = compareOfflineFailedRefundEvidence(f);
  assert.equal(first.inputHash, expected);
  f.binding.runtimeBindingId = "claimed-other-binding";
  const second = compareOfflineFailedRefundEvidence(f);
  assert.notEqual(first.inputHash, second.inputHash);
  assert(!("allowed" in second) && !("qualified" in second));
  assert.equal(first.binding.runtimeBindingId, "binding-1");
});

test("every scalar rejects a malformed type and every required field rejects omission", () => {
  const scalarPaths: string[][] = [];
  const propertyPaths: string[][] = [];
  function visit(v: unknown, path: string[]) {
    if (v !== null && typeof v === "object") {
      for (const [key, child] of Object.entries(v)) {
        propertyPaths.push([...path, key]);
        visit(child, [...path, key]);
      }
    } else scalarPaths.push(path);
  }
  visit(fixture(), []);
  for (const path of scalarPaths) {
    const f = fixture();
    let parent: any = f;
    for (const key of path.slice(0, -1)) parent = parent[key];
    const key = path.at(-1)!;
    parent[key] = typeof parent[key] === "string" ? null : "invalid-type";
    rejects(f);
  }
  for (const path of propertyPaths) {
    const f = fixture();
    let parent: any = f;
    for (const key of path.slice(0, -1)) parent = parent[key];
    delete parent[path.at(-1)!];
    rejects(f);
  }
});

test("provider comparisons independently bind every supported settlement identity and money field", () => {
  const mutations: ((p: any) => void)[] = [
    (p) => {
      p.stripeAccountId = "acct_different";
    },
    (p) => {
      p.livemode = true;
    },
    (p) => {
      p.paymentIntent.object = "charge";
    },
    (p) => {
      p.paymentIntent.id = "pi_different";
    },
    (p) => {
      p.paymentIntent.amount_received = 999;
    },
    (p) => {
      p.paymentIntent.currency = "usd";
    },
    (p) => {
      p.refund.object = "charge";
    },
    (p) => {
      p.refund.metadata.effect_id = "other";
    },
    (p) => {
      p.refund.payment_intent = "pi_different";
    },
    (p) => {
      p.matchingRefundIds = ["re_different"];
    },
    (p) => {
      p.refund.amount = 0;
    },
    (p) => {
      p.refund.amount = 1.5;
    },
    (p) => {
      p.refund.amount = 1e12 + 1;
    },
    ...["pending", "requires_action", "canceled", "unknown"].map(
      (status) => (p: any) => {
        p.refund.status = status;
      },
    ),
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f.provider);
    rejects(f);
  }
});

test("capture budgets and foreign builtin prototypes refuse without serializing input", () => {
  for (const value of [
    new Map(),
    new Set(),
    new Date(0),
    new Uint8Array(0),
    /x/,
    new String("x"),
    1n,
    Symbol("x"),
    undefined,
  ]) {
    const f: any = fixture();
    f.binding = value;
    rejects(f);
  }
  const deep: any = fixture();
  let node = deep.binding;
  for (let i = 0; i < 20; i++) {
    node.extra = {};
    node = node.extra;
  }
  rejects(deep);
  const wide: any = fixture();
  wide.binding = Object.fromEntries(
    Array.from({ length: 65 }, (_, i) => [`key${i}`, "x"]),
  );
  rejects(wide);
  const large: any = fixture();
  large.binding = Object.fromEntries(
    Array.from({ length: 16 }, (_, i) => [`key${i}`, "x".repeat(8192)]),
  );
  rejects(large);
  const longKey: any = fixture();
  longKey.binding["x".repeat(129)] = 1;
  rejects(longKey);
  const many: any = fixture();
  many.binding = Array.from({ length: 128 }, () => Array(128).fill(1));
  rejects(many);
});
