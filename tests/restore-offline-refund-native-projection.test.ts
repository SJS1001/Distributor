import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { canonical as legacyCanonical, digest } from "../src/server/core.ts";
import {
  compareOfflineFailedRefundEvidence,
  type OfflineFailedRefundComparison,
} from "../src/server/integration-offline-refund-evidence.ts";
import { readOfflinePrivateEvidence } from "../src/server/restore-offline-private-evidence.ts";

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

// Independent encoding of the fixed comparator's code-unit JSON domain.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}
const refusal = {
  code: "RESTORE_OFFLINE_PRIVATE_EVIDENCE",
  message: "Offline private evidence binding did not complete.",
};

function setup(
  t: TestContext,
  bytes: Buffer = Buffer.from(canonical(fixture())),
) {
  const root = fs.mkdtempSync(join(tmpdir(), "offline-refund-parser-"));
  fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const contents = [bytes, Buffer.from("other private capture")];
  const items = contents.map((b, i) => ({
    reference: `report-${i}`,
    sha256: digest(b),
    bytes: b.length,
  }));
  const manifest = {
    version: 1,
    root,
    files: items.map((item, i) => ({
      reference: item.reference,
      path: `report-${i}`,
    })),
  };
  manifest.files.forEach((file, i) =>
    fs.writeFileSync(join(root, file.path), contents[i]!, { mode: 0o600 }),
  );
  const h = "a".repeat(64),
    at = "2026-10-03T16:00:00.000Z";
  const envelope = {
    version: 1,
    purpose: "distributor-restore-offline-task-v1",
    requestId: "synthetic-request",
    preparedBy: "preparer",
    executorId: "executor",
    preparedAt: at,
    expiresAt: "2026-10-03T16:15:00.000Z",
    recovery: {
      instanceId: "recovery",
      snapshotHash: h,
      restoredAt: at,
      sourceCompletedAt: at,
      schemaHash: h,
      region: "CA",
      organizations: [{ id: "org-1", currency: "CAD" }],
    },
    session: { id: "session", revision: 1, lineageHash: h },
    candidate: { logicalHash: h, file: { dev: 1, ino: 2 } },
    source: {
      identity: "source",
      baseline: { logicalHash: h, durableCursor: "baseline", auditSequence: 1 },
      end: { logicalHash: h, durableCursor: "end", auditSequence: 2 },
      intervalEvidenceHash: h,
    },
    task: {
      name: "integration.stripe-refund-failed.import",
      version: 1,
      owner: "integration",
      orgId: "org-1",
      siteIds: [],
      subjectId: "effect-1",
      expectedRevision: 1,
      expectedStateHash: h,
      payloadHash: h,
      priorClaim: null,
    },
    evidence: {
      setHash: digest(legacyCanonical(items)),
      items,
      qualificationHash: h,
    },
    operations: {
      authorityId: "operations",
      revision: 1,
      adapterIdentity: "adapter",
      fenceTokenHash: h,
      observationHash: h,
    },
    trust: { authorityId: "trust", revision: 1, registryHash: h },
  };
  const capture = {
    references: ["report-0", "report-1"],
    maxBytes: contents.reduce((sum, b) => sum + b.length, 0),
  };
  return {
    root,
    contents,
    manifest,
    envelope,
    capture,
    read: () => readOfflinePrivateEvidence(envelope, manifest, capture),
  };
}

function observe(t: TestContext) {
  const buffers: Buffer[] = [],
    decoded: unknown[] = [];
  let opens = 0,
    reads = 0;
  const alloc = Buffer.alloc,
    open = fs.openSync,
    read = fs.readSync,
    decode = TextDecoder.prototype.decode;
  t.mock.method(Buffer, "alloc", ((
    ...args: Parameters<typeof Buffer.alloc>
  ) => {
    const b = Reflect.apply(alloc, Buffer, args);
    buffers.push(b);
    return b;
  }) as typeof Buffer.alloc);
  t.mock.method(fs, "openSync", ((...args: Parameters<typeof fs.openSync>) => {
    opens++;
    return Reflect.apply(open, fs, args);
  }) as typeof fs.openSync);
  t.mock.method(fs, "readSync", ((...args: Parameters<typeof fs.readSync>) => {
    reads++;
    return Reflect.apply(read, fs, args);
  }) as typeof fs.readSync);
  t.mock.method(
    TextDecoder.prototype,
    "decode",
    function (this: TextDecoder, ...args: Parameters<typeof decode>) {
      decoded.push(args[0]);
      return Reflect.apply(decode, this, args);
    },
  );
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return { buffers, decoded, counts: () => ({ opens, reads }) };
}
function zero(buffers: Buffer[]) {
  assert.ok(buffers.length > 0);
  assert.ok(buffers.every((b) => b.every((v) => v === 0)));
}
function frozen(value: unknown) {
  if (value && typeof value === "object") {
    assert.ok(Object.isFrozen(value));
    Object.values(value).forEach(frozen);
  }
}

function distinctFixture(region = "CA", currency = "CAD") {
  const input = fixture();
  input.refundRequest.reason = 'Partial credit for line "B" — reçu №7';
  input.candidateHistory.receipts[0]!.actorId = "finance-request-42";
  input.candidateHistory.receipts[0]!.key = "original-request-key-17";
  input.candidateHistory.receipts[0]!.requestHash = hash(
    canonical(input.refundRequest),
  );
  input.candidateHistory.receipts[0]!.createdAt = "2026-09-30T23:59:58.123Z";
  input.candidateHistory.receipts[1]!.actorId = "finance-queue-9";
  input.candidateHistory.receipts[1]!.key = "original-queue-key-63";
  input.candidateHistory.receipts[1]!.createdAt = "2026-10-01T00:00:04.987Z";
  input.candidateHistory.poll.retry_at = Number.MAX_SAFE_INTEGER;
  input.sourceHistory = structuredClone(input.candidateHistory);
  for (const native of [input.native, input.sourceNative]) {
    native.organization.region = region;
    native.organization.currency =
      native.account.currency =
      native.invoice.currency =
        currency;
    native.effect.payload = intentBytes.replace(
      '"cad"',
      JSON.stringify(currency.toLowerCase()),
    );
  }
  input.provider.refund.currency = input.provider.paymentIntent.currency =
    currency.toLowerCase();
  return input;
}

function projection(
  result: OfflineFailedRefundComparison,
  original: ReturnType<typeof fixture>,
) {
  assert.equal(
    canonical(result.refundRequest),
    canonical(original.refundRequest),
  );
  assert.equal(
    canonical(result.candidateHistory),
    canonical(original.candidateHistory),
  );
  assert.equal(result.refundRequest.reason, original.refundRequest.reason);
  assert.notEqual(result.refundRequest, original.refundRequest);
  assert.notEqual(result.candidateHistory, original.candidateHistory);
  assert.notEqual(result.candidateHistory.poll, original.candidateHistory.poll);
  assert.notEqual(
    result.candidateHistory.receipts,
    original.candidateHistory.receipts,
  );
  for (const i of [0, 1] as const) {
    const actual = result.candidateHistory.receipts[i],
      expected = original.candidateHistory.receipts[i]!;
    assert.notEqual(actual, expected);
    assert.notEqual(actual.result, expected.result);
    for (const key of [
      "orgId",
      "actorId",
      "command",
      "key",
      "requestHash",
      "createdAt",
    ] as const)
      assert.equal(actual[key], expected[key]);
    assert.equal(actual.result.id, expected.result.id);
    assert.equal(actual.result.state, expected.result.state);
  }
  frozen(result);
  assert.deepEqual(Object.keys(result).sort(), [
    "binding",
    "candidateHistory",
    "inputHash",
    "native",
    "outcome",
    "refundRequest",
    "request",
    "version",
  ]);
}

for (const [region, currency] of [
  ["CA", "CAD"],
  ["CA", "USD"],
  ["US", "USD"],
] as const) {
  test(`direct ${region}/${currency}: exact captured request and full history project without aliases`, () => {
    const input = distinctFixture(region, currency),
      before = structuredClone(input);
    const result = compareOfflineFailedRefundEvidence(input);
    projection(result, before);
    projection(result, input);
    assert.equal(
      result.candidateHistory.poll.retry_at,
      Number.MAX_SAFE_INTEGER,
    );
    assert.equal(
      result.inputHash,
      hash(
        canonical({
          purpose: "distributor-offline-failed-refund-comparison-v1",
          input: before,
        }),
      ),
    );
    const stable = canonical(result);
    input.refundRequest.reason = "mutated caller";
    input.candidateHistory.poll.retry_at = 0;
    input.candidateHistory.receipts[0]!.actorId = "changed";
    input.candidateHistory.receipts[1]!.result.id = "changed";
    input.sourceHistory.receipts.length = 0;
    assert.equal(canonical(result), stable);
    assert.throws(() => {
      (result.refundRequest as { reason: string }).reason = "changed";
    }, TypeError);
    assert.throws(() => {
      (result.candidateHistory.poll as { retry_at: number }).retry_at = 0;
    }, TypeError);
    assert.throws(() => {
      (result.candidateHistory.receipts[0].result as { id: string }).id =
        "changed";
    }, TypeError);
    assert.throws(() => {
      (result.candidateHistory.receipts as unknown as unknown[]).pop();
    }, TypeError);
  });

  test(`opaque ${region}/${currency}: projection uses consumed captured bytes, with no second open or read`, (t) => {
    const input = distinctFixture(region, currency),
      before = structuredClone(input);
    const f = setup(t, Buffer.from(canonical(input)));
    f.envelope.recovery.region = region;
    f.envelope.recovery.organizations[0]!.currency = currency;
    const io = observe(t),
      handle = f.read();
    const summary = handle.complete();
    assert.equal(summary.qualification, "unverified");
    const allocation = io.buffers.find(
      (b) => b.length === f.contents[0]!.length && b.equals(f.contents[0]!),
    );
    assert.ok(allocation);
    // Completed historical byte capture survives path removal. Reopening would fail.
    fs.unlinkSync(join(f.root, "report-0"));
    const counts = io.counts();
    input.refundRequest.reason = "caller changed after read";
    input.candidateHistory.receipts[0]!.key = "caller changed key";
    const result = handle.compareFailedRefund("report-0");
    projection(result, before);
    assert.deepEqual(io.counts(), counts);
    assert.equal(io.decoded.length, 1);
    assert.equal(io.decoded[0], allocation);
    zero(io.buffers);
    assert.throws(() => handle.compareFailedRefund("report-0"), refusal);
    assert.throws(() => handle.complete(), refusal);
    handle.dispose();
    handle[Symbol.dispose]();
    assert.deepEqual(io.counts(), counts);
    assert.equal(
      canonical(result.refundRequest),
      canonical(before.refundRequest),
    );
    assert.deepEqual(Object.keys(handle).sort(), ["complete", "dispose"]);
  });
}

test("fixed baseline digest, provider request bytes and outcome remain identical after projection", () => {
  const input = fixture(),
    result = compareOfflineFailedRefundEvidence(input);
  projection(result, input);
  // Recorded from exact excluded e8829bb comparator before the change.
  assert.equal(
    result.inputHash,
    "da9b6af63558e198f110ad1b9a53c79b7eb1d778ea2ddb25f5f86dac742580f9",
  );
  assert.deepEqual(result.request, {
    body: '{"amount":300,"metadata":{"effect_id":"effect-1","refund_id":"refund-1"},"payment_intent":"pi_original"}',
    bodyHash:
      "5d24997a5726c7f6177f1679a51e49bd30a2404fd65a1aa6744db8f7808be2a2",
    idempotencyKey: "distributor:effect-1",
  });
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
});

test("maximum supported reason survives with exact original request hash, without normalization", () => {
  const input = distinctFixture();
  input.refundRequest.reason = "é".repeat(1000);
  input.candidateHistory.receipts[0]!.requestHash = hash(
    canonical(input.refundRequest),
  );
  input.sourceHistory = structuredClone(input.candidateHistory);
  projection(compareOfflineFailedRefundEvidence(input), input);
});

const changedHistory: [string, (f: ReturnType<typeof fixture>) => void][] = [
  [
    "actor",
    (f) => {
      f.sourceHistory.receipts[0]!.actorId = "other-actor";
    },
  ],
  [
    "key",
    (f) => {
      f.sourceHistory.receipts[1]!.key = "other-key";
    },
  ],
  [
    "timestamp",
    (f) => {
      f.sourceHistory.receipts[1]!.createdAt = "2026-10-01T00:00:05.000Z";
    },
  ],
  [
    "request hash",
    (f) => {
      f.sourceHistory.receipts[0]!.requestHash = "b".repeat(64);
    },
  ],
  [
    "result",
    (f) => {
      f.sourceHistory.receipts[0]!.result.id = "another-refund";
    },
  ],
  [
    "poll retry",
    (f) => {
      f.sourceHistory.poll.retry_at++;
    },
  ],
];
for (const [label, change] of changedHistory)
  test(`mismatched source ${label} never becomes a projected native fact, including via private handle`, (t) => {
    const input = fixture();
    change(input);
    assert.throws(
      () => compareOfflineFailedRefundEvidence(input),
      /OFFLINE_REFUND_EVIDENCE/,
    );
    const f = setup(t, Buffer.from(canonical(input))),
      io = observe(t),
      handle = f.read();
    handle.complete();
    const counts = io.counts();
    assert.throws(() => handle.compareFailedRefund("report-0"), refusal);
    assert.throws(() => handle.compareFailedRefund("report-0"), refusal);
    assert.throws(() => handle.complete(), refusal);
    assert.deepEqual(io.counts(), counts);
    zero(io.buffers);
  });

for (const location of [
  "request",
  "history",
  "poll",
  "receipts",
  "receipt-result",
] as const)
  test(`projected ${location} rejects accessors and normal/revoked proxies before traps execute`, () => {
    for (const mode of ["accessor", "proxy", "revoked"] as const) {
      const input = fixture();
      let traps = 0;
      let target: object = input,
        key = "refundRequest";
      if (location === "history") key = "candidateHistory";
      if (location === "poll" || location === "receipts") {
        target = input.candidateHistory;
        key = location;
      }
      if (location === "receipt-result") {
        target = input.candidateHistory.receipts[0]!;
        key = "result";
      }
      const original = (target as Record<string, unknown>)[key];
      if (mode === "accessor")
        Object.defineProperty(target, key, {
          enumerable: true,
          get() {
            traps++;
            return original;
          },
        });
      else {
        const wrapped = Proxy.revocable(original as object, {
          getPrototypeOf() {
            traps++;
            throw Error("trap");
          },
          ownKeys() {
            traps++;
            throw Error("trap");
          },
          get() {
            traps++;
            throw Error("trap");
          },
          getOwnPropertyDescriptor() {
            traps++;
            throw Error("trap");
          },
        });
        if (mode === "revoked") wrapped.revoke();
        (target as Record<string, unknown>)[key] = wrapped.proxy;
      }
      assert.throws(
        () => compareOfflineFailedRefundEvidence(input),
        /OFFLINE_REFUND_EVIDENCE/,
      );
      assert.equal(traps, 0);
    }
  });

const invalid: [string, (f: ReturnType<typeof fixture>) => void][] = [
  [
    "overlong reason",
    (f) => {
      f.refundRequest.reason = "x".repeat(1001);
      f.candidateHistory.receipts[0]!.requestHash = hash(
        canonical(f.refundRequest),
      );
    },
  ],
  [
    "overlong original key",
    (f) => {
      f.candidateHistory.receipts[0]!.key = "x".repeat(129);
    },
  ],
  [
    "nonpending result",
    (f) => {
      f.candidateHistory.receipts[1]!.result.state = "completed";
    },
  ],
  [
    "unsafe poll retry",
    (f) => {
      f.candidateHistory.poll.retry_at = Number.MAX_SAFE_INTEGER + 1;
    },
  ],
  [
    "extra request authority",
    (f) => {
      Object.assign(f.refundRequest, { authorized: true });
    },
  ],
  [
    "extra history qualification",
    (f) => {
      Object.assign(f.candidateHistory, { qualified: true });
    },
  ],
  [
    "reason changed without original hash",
    (f) => {
      f.refundRequest.reason = "another reason";
    },
  ],
];
for (const [label, change] of invalid)
  test(`${label} still refuses direct and captured projection`, (t) => {
    const input = fixture();
    change(input);
    input.sourceHistory = structuredClone(input.candidateHistory);
    assert.throws(
      () => compareOfflineFailedRefundEvidence(input),
      /OFFLINE_REFUND_EVIDENCE/,
    );
    const f = setup(t, Buffer.from(canonical(input))),
      handle = f.read();
    handle.complete();
    assert.throws(() => handle.compareFailedRefund("report-0"), refusal);
    assert.throws(() => handle.complete(), refusal);
  });
