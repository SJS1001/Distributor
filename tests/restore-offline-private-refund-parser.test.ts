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

for (const [region, currency] of [
  ["CA", "CAD"],
  ["CA", "USD"],
  ["US", "USD"],
])
  test(`fixed parser ${region}/${currency} consumes same private allocation once and returns frozen comparison`, (t) => {
    const input = fixture();
    for (const n of [input.native, input.sourceNative]) {
      n.organization.region = region!;
      n.organization.currency =
        n.account.currency =
        n.invoice.currency =
          currency!;
      n.effect.payload = intentBytes.replace(
        '"cad"',
        JSON.stringify(currency!.toLowerCase()),
      );
    }
    input.provider.refund.currency = input.provider.paymentIntent.currency =
      currency!.toLowerCase();
    const expected = compareOfflineFailedRefundEvidence(input);
    const f = setup(t, Buffer.from(canonical(input)));
    f.envelope.recovery.region = region!;
    f.envelope.recovery.organizations[0]!.currency = currency!;
    const io = observe(t),
      handle = f.read();
    handle.complete();
    const before = io.counts(),
      allocation = io.buffers[1]!;
    assert.deepEqual(allocation, f.contents[0]);
    const result = handle.compareFailedRefund("report-0");
    assert.deepEqual(result, expected);
    assert.equal(result.request.bodyHash, hash(result.request.body));
    assert.equal(result.outcome.result.status, "failed");
    assert.deepEqual(io.decoded, [allocation]);
    assert.equal(io.decoded[0], allocation);
    assert.deepEqual(io.counts(), before);
    frozen(result);
    zero(io.buffers);
    input.native.refund.amount = 1;
    assert.equal(result.native.refund.amount, 300);
    assert.throws(() => handle.compareFailedRefund("report-0"), refusal);
    assert.throws(() => handle.complete(), refusal);
  });

for (const operation of ["replace", "remove"])
  test(`after completion ${operation} source file cannot redirect fixed parsing of historical bytes`, (t) => {
    const f = setup(t),
      io = observe(t),
      handle = f.read();
    const summary = handle.complete();
    const path = join(f.root, "report-0");
    if (operation === "replace") {
      fs.renameSync(path, path + ".old");
      fs.writeFileSync(path, "private changed source", { mode: 0o600 });
    } else fs.unlinkSync(path);
    const before = io.counts();
    const result = handle.compareFailedRefund("report-0");
    assert.equal(result.outcome.reference, "re_failed");
    assert.equal(summary.qualification, "unverified");
    assert.deepEqual(io.counts(), before);
    zero(io.buffers);
    assert.throws(() => handle.complete(), refusal);
  });

for (const selection of [
  "unselected",
  "unknown",
  "no-capture",
  "other-capture",
])
  test(`reference ${selection} refuses and zeroes every capture`, (t) => {
    const f = setup(t);
    if (selection === "unselected") f.capture.references = ["report-1"];
    const io = observe(t);
    const handle =
      selection === "no-capture"
        ? readOfflinePrivateEvidence(f.envelope, f.manifest)
        : f.read();
    handle.complete();
    assert.throws(
      () =>
        handle.compareFailedRefund(
          selection === "unknown"
            ? "missing-private-ref"
            : selection === "other-capture"
              ? "report-1"
              : "report-0",
        ),
      refusal,
    );
    zero(io.buffers);
    assert.throws(() => handle.compareFailedRefund("report-0"), refusal);
  });

for (const mode of [
  "before-complete",
  "disposed",
  "repeated",
  "failed-complete",
])
  test(`${mode} parser call permanently disposes all allocations`, (t) => {
    const f = setup(t),
      io = observe(t),
      handle = f.read();
    if (mode === "failed-complete") {
      fs.writeFileSync(join(f.root, "report-1"), "changed");
      assert.throws(() => handle.complete(), refusal);
    } else if (mode !== "before-complete") handle.complete();
    if (mode === "disposed") handle.dispose();
    if (mode === "repeated") handle.compareFailedRefund("report-0");
    assert.throws(() => handle.compareFailedRefund("report-0"), refusal);
    zero(io.buffers);
    assert.throws(() => handle.complete(), refusal);
  });

for (const field of ["owner", "name", "version"] as const)
  test(`wrong task ${field} refuses before decode and consumes the handle`, (t) => {
    const f = setup(t);
    if (field === "owner") f.envelope.task.owner = "billing";
    if (field === "name") f.envelope.task.name = "integration.other.import";
    if (field === "version") f.envelope.task.version = 2;
    const io = observe(t),
      handle = f.read();
    handle.complete();
    assert.throws(() => handle.compareFailedRefund("report-0"), refusal);
    assert.deepEqual(io.decoded, []);
    zero(io.buffers);
  });

test("task and selection config are detached before a caller changes them", (t) => {
  const f = setup(t),
    io = observe(t),
    handle = f.read();
  f.envelope.task.owner = "billing";
  f.envelope.task.name = "wrong";
  f.envelope.task.version = 3;
  f.capture.references = [];
  f.manifest.files = [];
  handle.complete();
  assert.equal(
    handle.compareFailedRefund("report-0").outcome.result.amount,
    300,
  );
  zero(io.buffers);
});

for (const attack of [
  "proxy",
  "revoked-proxy",
  "accessor",
  "boxed-string",
  "null",
  "number",
  "whitespace",
  "NUL",
  "oversized",
])
  test(`reference ${attack} is rejected without descriptor/accessor/proxy callbacks`, (t) => {
    const f = setup(t),
      io = observe(t),
      handle = f.read();
    handle.complete();
    let callbacks = 0;
    const trap = () => {
      callbacks++;
      throw new Error("private reference trap");
    };
    const pair = Proxy.revocable(
      {},
      {
        get: trap,
        ownKeys: trap,
        getPrototypeOf: trap,
        getOwnPropertyDescriptor: trap,
      },
    );
    let ref: unknown;
    if (attack === "proxy" || attack === "revoked-proxy") {
      ref = pair.proxy;
      if (attack === "revoked-proxy") pair.revoke();
    }
    if (attack === "accessor")
      ref = Object.defineProperty({}, "toString", { get: trap });
    if (attack === "boxed-string") ref = new String("report-0");
    if (attack === "null") ref = null;
    if (attack === "number") ref = 0;
    if (attack === "whitespace") ref = " report-0";
    if (attack === "NUL") ref = "report-0\0";
    if (attack === "oversized") ref = "x".repeat(2001);
    assert.throws(() => handle.compareFailedRefund(ref), refusal);
    assert.equal(callbacks, 0);
    assert.deepEqual(io.decoded, []);
    zero(io.buffers);
  });

const malformed: [string, () => Buffer][] = [
  ["invalid UTF8 byte", () => Buffer.from([0xff])],
  ["overlong UTF8", () => Buffer.from([0xc0, 0xaf])],
  ["truncated UTF8", () => Buffer.from([0xe2, 0x82])],
  ["UTF8 surrogate", () => Buffer.from([0xed, 0xa0, 0x80])],
  [
    "BOM",
    () =>
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from(canonical(fixture())),
      ]),
  ],
  ["malformed JSON", () => Buffer.from('{"private-secret":')],
  ["trailing data", () => Buffer.from(canonical(fixture()) + "null")],
  [
    "duplicate root key",
    () =>
      Buffer.from(
        canonical(fixture()).replace('"version":1', '"version":0,"version":1'),
      ),
  ],
  [
    "duplicate identical nested key",
    () =>
      Buffer.from(
        canonical(fixture()).replace(
          '"amount":300',
          '"amount":300,"amount":300',
        ),
      ),
  ],
  [
    "duplicate escaped key",
    () =>
      Buffer.from(
        canonical(fixture()).replace(
          '"version":1',
          '"ver\\u0073ion":1,"version":1',
        ),
      ),
  ],
  ["leading whitespace", () => Buffer.from(" " + canonical(fixture()))],
  ["trailing whitespace", () => Buffer.from(canonical(fixture()) + "\n")],
  ["alternative property order", () => Buffer.from(JSON.stringify(fixture()))],
  [
    "alternative number spelling",
    () =>
      Buffer.from(canonical(fixture()).replace('"version":1', '"version":1.0')),
  ],
  [
    "alternative escaped key",
    () =>
      Buffer.from(
        canonical(fixture()).replace('"version":1', '"ver\\u0073ion":1'),
      ),
  ],
  ["lone surrogate", () => Buffer.from('"\\ud800"')],
  ["negative zero", () => Buffer.from("-0")],
  ["exponent overflow", () => Buffer.from("1e999")],
  ["unsafe integer", () => Buffer.from("9007199254740992")],
  ["escaped prototype key", () => Buffer.from('{"\\u005f_proto__":1}')],
  ["raw NUL", () => Buffer.from('{"x":"private\0value"}')],
];
for (const [name, make] of malformed)
  test(`strict private JSON refuses ${name} with redaction and zeroing`, (t) => {
    const f = setup(t, make()),
      io = observe(t),
      handle = f.read();
    handle.complete();
    let result: OfflineFailedRefundComparison | undefined;
    assert.throws(
      () => {
        result = handle.compareFailedRefund("report-0");
      },
      (error: unknown) => {
        assert.equal((error as Error).message, refusal.message);
        assert.equal((error as { code: string }).code, refusal.code);
        assert.equal(JSON.stringify(error).includes(f.root), false);
        assert.equal(String(error).includes("private-secret"), false);
        assert.equal("cause" in (error as object), false);
        return true;
      },
    );
    assert.equal(result, undefined);
    zero(io.buffers);
    assert.throws(() => handle.compareFailedRefund("report-0"), refusal);
  });

for (const [name, bytes] of [
  ["deep", Buffer.from("[".repeat(10000) + "0" + "]".repeat(10000))],
  [
    "many nodes",
    Buffer.from(
      JSON.stringify(Array.from({ length: 64 }, () => Array(64).fill(0))),
    ),
  ],
  ["wide array", Buffer.from(JSON.stringify(Array(129).fill(0)))],
  [
    "wide object",
    Buffer.from(
      JSON.stringify(
        Object.fromEntries(Array.from({ length: 65 }, (_, i) => ["k" + i, 0])),
      ),
    ),
  ],
  ["long key", Buffer.from(JSON.stringify({ ["k".repeat(129)]: 0 }))],
  ["long value", Buffer.from(JSON.stringify("x".repeat(8193)))],
] as const)
  test(`bounded iterative preflight rejects ${name} before any recursive canonical serialization`, (t) => {
    const f = setup(t, bytes),
      io = observe(t),
      handle = f.read();
    handle.complete();
    const stringify = JSON.stringify;
    let calls = 0;
    const spy = t.mock.method(JSON, "stringify", ((
      ...args: Parameters<typeof stringify>
    ) => {
      calls++;
      return Reflect.apply(stringify, JSON, args);
    }) as typeof stringify);
    let error: unknown;
    try {
      handle.compareFailedRefund("report-0");
    } catch (e) {
      error = e;
    }
    spy.mock.restore();
    assert.equal((error as { code: string }).code, refusal.code);
    assert.equal(calls, 0);
    zero(io.buffers);
  });

for (const size of [65536, 65537])
  test(`UTF8 parser budget ${size} bytes checks before decode or JSON materialization`, (t) => {
    // 3-byte characters distinguish UTF8 bytes from JS code units.
    const bytes = Buffer.from(
      '"' + "雪".repeat(21844) + "x".repeat(size - 65534) + '"',
    );
    assert.equal(bytes.length, size);
    const f = setup(t, bytes),
      io = observe(t),
      handle = f.read();
    handle.complete();
    const parse = JSON.parse;
    let calls = 0;
    const spy = t.mock.method(JSON, "parse", ((
      ...args: Parameters<typeof parse>
    ) => {
      calls++;
      return Reflect.apply(parse, JSON, args);
    }) as typeof parse);
    assert.throws(() => handle.compareFailedRefund("report-0"), refusal);
    assert.equal(io.decoded.length, size > 65536 ? 0 : 1);
    assert.equal(calls, size > 65536 ? 0 : 1);
    spy.mock.restore();
    zero(io.buffers);
  });

const inconsistent: [string, (input: ReturnType<typeof fixture>) => void][] = [
  [
    "native amount",
    (x) => {
      x.native.refund.amount++;
    },
  ],
  [
    "native account",
    (x) => {
      x.native.effect.account_id = "other-account";
    },
  ],
  [
    "native refund",
    (x) => {
      x.native.refund.id = "other-refund";
    },
  ],
  [
    "native payment",
    (x) => {
      x.native.payment.external_ref = "pi_other";
    },
  ],
  [
    "native status",
    (x) => {
      x.native.refund.state = "failed";
    },
  ],
  [
    "source native",
    (x) => {
      x.sourceNative.payment.amount++;
    },
  ],
  [
    "source history",
    (x) => {
      x.sourceHistory.poll.retry_at++;
    },
  ],
  [
    "candidate history",
    (x) => {
      x.candidateHistory.receipts[0]!.requestHash = "0".repeat(64);
    },
  ],
  [
    "provider amount",
    (x) => {
      x.provider.refund.amount++;
    },
  ],
  [
    "provider account",
    (x) => {
      x.provider.stripeAccountId = "acct_other";
    },
  ],
  [
    "provider status",
    (x) => {
      x.provider.refund.status = "succeeded";
    },
  ],
  [
    "provider payment",
    (x) => {
      x.provider.refund.payment_intent = "pi_other";
    },
  ],
  [
    "binding org",
    (x) => {
      x.binding.orgId = "other-org";
    },
  ],
  [
    "unproven allowed flag",
    (x) => {
      Object.assign(x, { allowed: true });
    },
  ],
  [
    "secret",
    (x) => {
      Object.assign(x.provider, { secretKey: "private-sk-test-synthetic" });
    },
  ],
  [
    "qualification flag",
    (x) => {
      Object.assign(x.binding, { qualified: true });
    },
  ],
  [
    "extra native field",
    (x) => {
      Object.assign(x.native.payment, { secret: "private-account-secret" });
    },
  ],
];
for (const [name, change] of inconsistent)
  test(`fixed owner comparator refuses ${name} and consumes all captures`, (t) => {
    const input = fixture();
    change(input);
    const f = setup(t, Buffer.from(canonical(input))),
      io = observe(t),
      handle = f.read();
    handle.complete();
    assert.throws(() => handle.compareFailedRefund("report-0"), refusal);
    zero(io.buffers);
    assert.throws(() => handle.compareFailedRefund("report-0"), refusal);
  });

test("success preserves the original handle enumeration and historical summary without exposing captures", (t) => {
  const f = setup(t),
    io = observe(t),
    handle = f.read();
  assert.deepEqual(Object.keys(handle).sort(), ["complete", "dispose"]);
  assert.equal(JSON.stringify(handle), "{}");
  const descriptor = Object.getOwnPropertyDescriptor(
    handle,
    "compareFailedRefund",
  )!;
  assert.equal(descriptor.enumerable, false);
  assert.equal(descriptor.writable, false);
  assert.equal(descriptor.configurable, false);
  const summary = handle.complete(),
    result = handle.compareFailedRefund("report-0");
  assert.equal(summary.qualification, "unverified");
  assert.equal(JSON.stringify(result).includes(f.root), false);
  assert.equal("allowed" in result, false);
  assert.equal("qualified" in result, false);
  zero(io.buffers);
  handle.dispose();
  assert.throws(() => handle.complete(), refusal);
});

test("canonical multibyte text and supplementary Unicode remain exact comparator facts", (t) => {
  const input = fixture();
  input.refundRequest.reason = "Révision 雪 😀";
  const requestHash = hash(canonical(input.refundRequest));
  input.candidateHistory.receipts[0]!.requestHash = requestHash;
  input.sourceHistory.receipts[0]!.requestHash = requestHash;
  const expected = compareOfflineFailedRefundEvidence(input);
  const f = setup(t, Buffer.from(canonical(input))),
    io = observe(t),
    handle = f.read();
  handle.complete();
  const result = handle.compareFailedRefund("report-0");
  assert.deepEqual(result, expected);
  zero(io.buffers);
});
