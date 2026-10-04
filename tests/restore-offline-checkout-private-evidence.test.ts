import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { fixture, accept, ship, chooseProviders } from "./fixtures.ts";
import { canonical, digest } from "../src/server/core.ts";
import { Application } from "../src/server/application.ts";
import { Database } from "../src/server/database.ts";
import { Identity } from "../src/server/iam.ts";
import { Billing } from "../src/server/billing.ts";
import { IntegrationCheckouts } from "../src/server/integration-checkouts.ts";
import { IntegrationOfflineCheckoutReview } from "../src/server/integration-offline-checkout-review.ts";
import {
  compareOfflineCheckoutPaidEvidence as compare,
  type OfflineCheckoutEvidenceInput,
} from "../src/server/integration-offline-checkout-evidence.ts";
import {
  RestoreOfflineCheckoutNativeJoin as Join,
  isCapturedOfflineCheckoutNativeJoin as captured,
} from "../src/server/restore-offline-checkout-native-join.ts";

async function nativeSetup(
  t: TestContext,
  region: "CA" | "US" = "CA",
  currency: "CAD" | "USD" = "CAD",
  reports = false,
) {
  const f = fixture(t, { eventReports: reports }, region, currency),
    invoiceId = ship(f, accept(f).id).invoiceId;
  chooseProviders(f, f.actor, "choice", {
    accountId: f.buyer,
    region,
    mode: "provider-exceptions",
    providers: ["stripe"],
    version: 1,
    acknowledgment: "Synthetic permission only",
  });
  const effect = f.app.integration.checkout(f.actor, "checkout", { invoiceId });
  let calls = 0;
  assert.equal(
    (
      await f.app.integration.execute(f.actor, effect.id, {
        execute: async () => {
          calls++;
          throw Error("Synthetic lost reply; no provider IO");
        },
        lookup: async () => {
          calls++;
          return null;
        },
      })
    ).state,
    "unknown",
  );
  const user = f.app.identity.createUser(f.actor, "finance", {
    name: "Review finance",
    email: "checkout-review@example.test",
    password: "synthetic-long-password",
    role: "finance",
    sites: [],
  });
  const actor = { id: user.id, orgId: f.actor.orgId };
  const hold = () => {
    for (const suffix of ["", "-wal", "-shm"])
      if (fs.existsSync(f.path + suffix)) fs.chmodSync(f.path + suffix, 0o600);
    f.app.database.transaction(() =>
      f.app.platform.isolateRestore(
        digest("synthetic-checkout-snapshot"),
        "2026-10-01T00:00:00.000Z",
      ),
    );
  };
  const input = () =>
    f.app.database.transaction(() => {
      const candidate = new IntegrationOfflineCheckoutReview(
        f.app.database,
        f.app.identity,
        f.app.billing,
        f.app.integration.checkouts,
      ).getInTransaction(
        f.app.identity.workerActor(actor.orgId, actor.id),
        effect.id,
      );
      const candidateStore =
          f.app.database.captureRestoreCandidateInTransaction(),
        amount = candidate.invoice.total,
        currency = candidate.invoice.currency.toLowerCase() as "cad" | "usd",
        metadata = { effect_id: effect.id };
      return {
        version: 1,
        profile: "stripe-first-unknown-checkout-paid-v1",
        source: structuredClone(candidate),
        candidate,
        candidateStore,
        binding: {
          provider: "stripe",
          mode: "test",
          scope: "direct-account",
          orgId: f.actor.orgId,
          accountId: f.buyer,
          runtimeBindingId: "synthetic-runtime-binding",
          stripeAccountId: "acct_synthetic",
        },
        provider: {
          stripeAccountId: "acct_synthetic",
          session: {
            object: "checkout.session",
            id: "cs_test_synthetic",
            mode: "payment",
            livemode: false,
            status: "complete",
            payment_status: "paid",
            amount_total: amount,
            currency,
            expires_at: 1893456000,
            url: null,
            metadata,
            payment_intent: {
              object: "payment_intent",
              id: "pi_synthetic",
              status: "succeeded",
              livemode: false,
              amount,
              amount_received: amount,
              currency,
              metadata,
              on_behalf_of: null,
              transfer_data: null,
              application_fee_amount: null,
            },
          },
        },
      } satisfies OfflineCheckoutEvidenceInput;
    });
  const join = () =>
    new Join(
      f.app.database,
      f.app.identity,
      f.app.billing,
      f.app.integration.checkouts,
    );
  return Object.assign(f, {
    invoiceId,
    effectId: effect.id,
    reviewer: actor,
    hold,
    input,
    join,
    calls: () => calls,
  });
}
type F = Awaited<ReturnType<typeof nativeSetup>>;
function totals(f: F) {
  return f.app.database.owned("integration").get("SELECT total_changes() AS n")!
    .n;
}
function frozen(v: unknown) {
  if (v !== null && typeof v === "object") {
    assert.ok(Object.isFrozen(v));
    Object.values(v).forEach(frozen);
  }
}
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RestoreOfflineCheckoutPrivateEvidence as Private,
  checkoutPrivateTask,
  checkoutPrivateEvidenceBytes,
  type CheckoutPrivateHandle,
} from "../src/server/restore-offline-checkout-private-evidence.ts";
import { SCHEMA_VERSION } from "../src/server/schema.ts";
import { offlineTaskBinding } from "../src/server/restore-offline-envelope.ts";
function json(v: any): string {
  if (Array.isArray(v)) return `[${v.map(json).join(",")}]`;
  if (v !== null && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${json(v[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}
const refused = {
  code: "RESTORE_OFFLINE_CHECKOUT_PRIVATE",
  message: "Checkout private evidence capture did not complete.",
};
async function setup(
  t: TestContext,
  region: "CA" | "US" = "CA",
  currency: "CAD" | "USD" = "CAD",
  reports = false,
  beforeHold?: (f: F) => void | Promise<void>,
) {
  const f = await nativeSetup(t, region, currency, reports);
  await beforeHold?.(f);
  f.hold();
  f.app.database.transaction(() => {
    const { logicalHash: _hash, ...candidate } =
      f.app.database.captureRestoreCandidateInTransaction();
    f.app.platform.offline.createGenerationInTransaction(
      {
        version: 1,
        schemaVersion: SCHEMA_VERSION,
        instanceId: digest("synthetic-private-checkout-instance"),
        ...candidate,
        organizations: candidate.organizations.map((o) => ({
          id: o.id,
          currency: o.currency,
        })),
      },
      null,
      [],
    );
    for (const transition of [
      { kind: "isolate", sessionId: "checkout-session" },
      { kind: "open" },
    ] as const) {
      const s = f.app.platform.offline.readInTransaction()!;
      f.app.platform.offline.transitionInTransaction(
        s.state.generation,
        s.anchor,
        transition,
        [],
      );
    }
  });
  const inputData = f.input(),
    root = fs.mkdtempSync(join(tmpdir(), "checkout-private-")),
    file = join(root, "report.json");
  fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const envelope: any = f.app.database.transaction(() => {
    const s = f.app.platform.offline.readInTransaction()!,
      session = s.state.sessions.at(-1)!,
      stat = fs.lstatSync(f.path);
    const {
      version: _v,
      schemaVersion: _schema,
      ...recovery
    } = s.state.generation;
    const h = digest("synthetic-qualification-not-proof");
    return {
      version: 1,
      purpose: "distributor-restore-offline-task-v1",
      requestId: "private-checkout",
      preparedBy: "external-preparer",
      executorId: "external-executor",
      preparedAt: "2026-10-04T01:00:00.000Z",
      expiresAt: "2026-10-04T01:15:00.000Z",
      recovery,
      session: {
        id: session.id,
        revision: session.revision,
        lineageHash: session.lineageHash,
      },
      candidate: {
        logicalHash: inputData.candidateStore.logicalHash,
        file: { dev: stat.dev, ino: stat.ino },
      },
      source: {
        identity: "synthetic-source",
        baseline: { logicalHash: h, durableCursor: "start", auditSequence: 1 },
        end: { logicalHash: h, durableCursor: "end", auditSequence: 2 },
        intervalEvidenceHash: h,
      },
      task: {
        ...checkoutPrivateTask,
        orgId: f.actor.orgId,
        siteIds: [],
        subjectId: f.effectId,
        expectedRevision: 0,
        expectedStateHash: inputData.candidate.factsHash,
        payloadHash: digest(canonical(inputData)),
        priorClaim: null,
      },
      evidence: { setHash: h, items: [], qualificationHash: h },
      operations: {
        authorityId: "external-operations",
        revision: 1,
        adapterIdentity: "synthetic-not-qualified",
        fenceTokenHash: h,
        observationHash: h,
      },
      trust: { authorityId: "external-trust", revision: 1, registryHash: h },
    };
  });
  const manifest = {
    version: 1 as const,
    root,
    files: [{ reference: "checkout-report", path: "report.json" }],
  };
  const write = (bytes: Buffer = Buffer.from(json(inputData))) => {
    fs.writeFileSync(file, bytes, { mode: 0o600 });
    envelope.evidence.items = [
      {
        reference: "checkout-report",
        bytes: bytes.length,
        sha256: digest(bytes),
      },
    ];
    envelope.evidence.setHash = digest(canonical(envelope.evidence.items));
    return bytes;
  };
  const bytes = write(),
    reader = new Private(
      f.app.database,
      f.app.identity,
      f.app.billing,
      f.app.integration.checkouts,
    );
  const read = () => reader.read(envelope, manifest);
  const run = () => {
    const h = read();
    h.complete();
    return f.app.database.transaction(() => h.reviewInTransaction(f.reviewer));
  };
  const snapshot = () =>
    f.app.database.transaction(() =>
      canonical({
        candidate: f.app.database.captureRestoreCandidateInTransaction(),
        offline: f.app.platform.offline.readInTransaction(),
      }),
    );
  return Object.assign(f, {
    inputData,
    root,
    file,
    envelope,
    manifest,
    bytes,
    write,
    reader,
    read,
    run,
    snapshot,
  });
}
function tracked(t: TestContext) {
  const allocations: Buffer[] = [],
    opened: number[] = [],
    closed: number[] = [];
  const alloc = Buffer.alloc,
    open = fs.openSync,
    close = fs.closeSync;
  t.mock.method(Buffer, "alloc", (...args: Parameters<typeof Buffer.alloc>) => {
    const b = alloc(...args);
    allocations.push(b);
    return b;
  });
  t.mock.method(fs, "openSync", (...args: Parameters<typeof fs.openSync>) => {
    const fd = open(...args);
    opened.push(fd);
    return fd;
  });
  t.mock.method(fs, "closeSync", (fd: number) => {
    closed.push(fd);
    return close(fd);
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return { allocations, opened, closed };
}
for (const [region, currency] of [
  ["CA", "CAD"],
  ["CA", "USD"],
  ["US", "USD"],
] as const)
  for (const reports of [false, true])
    test(`${region}/${currency} reports=${reports}: same captured bytes, current native/open phase, no reopen/IO/writes`, async (t) => {
      const f = await setup(t, region, currency, reports),
        before = f.snapshot(),
        n = totals(f),
        io = tracked(t),
        h = f.read();
      assert.deepEqual(Object.keys(h).sort(), [
        "captureForApplicationInTransaction",
        "complete",
        "dispose",
        "reviewInTransaction",
      ]);
      assert.equal(io.opened.length, 1);
      assert.deepEqual(io.opened, io.closed);
      const summary = h.complete();
      frozen(summary);
      assert.equal(summary.envelopeBinding, offlineTaskBinding(f.envelope));
      assert.equal(summary.bytes, f.bytes.length);
      assert.equal(summary.qualification, "unverified");
      const c = compare(f.inputData);
      fs.unlinkSync(f.file);
      const result = f.app.database.transaction(() =>
        h.reviewInTransaction(f.reviewer),
      );
      frozen(result);
      assert.equal(result.native.comparisonHash, c.hash);
      assert.equal(result.native.candidateHash, c.candidateHash);
      assert.equal(result.payloadHash, f.envelope.task.payloadHash);
      assert.equal(result.status, "native-private-checkout-consistency-only");
      assert.equal(result.phase.envelopeBinding, result.envelopeBinding);
      assert(
        result.native.requiredChecks.includes(
          "qualified-source-candidate-fences-and-authority-through-commit",
        ),
      );
      assert(
        result.native.requiredChecks.includes(
          "fixed-checkout-owner-application-contract-required",
        ),
      );
      assert(
        result.phase.requiredChecks.includes(
          "current-signatures-clock-trust-and-revocation",
        ),
      );
      assert.equal(totals(f), n);
      assert.equal(f.snapshot(), before);
      assert.equal(f.calls(), 1);
      assert.equal(io.opened.length, 1);
      const owned = io.allocations.filter((b) => b.length === f.bytes.length);
      assert(owned.length);
      assert(owned.every((b) => b.every((v) => v === 0)));
      assert.throws(() => h.complete(), refused);
      assert.throws(
        () =>
          f.app.database.transaction(() => h.reviewInTransaction(f.reviewer)),
        refused,
      );
      assert.doesNotThrow(() => h.dispose());
      assert.doesNotThrow(() => h[Symbol.dispose]());
      assert.throws(() => f.app.platform.assertProviderAccess(), {
        code: "RECOVERY_HOLD",
      });
    });
test("pending, repeated complete, disposed and forged/proxy handle identities fail and erase captures", async (t) => {
  const f = await setup(t),
    io = tracked(t);
  let trapped = false;
  const proxy = new Proxy(
    {},
    {
      get() {
        trapped = true;
        throw Error("trap");
      },
      getPrototypeOf() {
        trapped = true;
        throw Error("trap");
      },
    },
  );
  for (const mode of [
    "pending",
    "disposed",
    "completed-disposed",
    "double-complete",
    "fake",
  ]) {
    const h = f.read();
    if (mode === "pending")
      assert.throws(
        () =>
          f.app.database.transaction(() => h.reviewInTransaction(f.reviewer)),
        refused,
      );
    if (mode === "disposed") h.dispose();
    if (mode === "completed-disposed") {
      h.complete();
      h.dispose();
    }
    if (mode === "double-complete") {
      h.complete();
      assert.throws(() => h.complete(), refused);
    }
    if (mode === "fake") {
      h.complete();
      assert.throws(
        () => h.reviewInTransaction.call(proxy as any, f.reviewer),
        refused,
      );
    }
    assert.throws(() => h.complete(), refused);
  }
  assert.equal(trapped, false);
  assert.deepEqual(io.opened, io.closed);
  assert(
    io.allocations
      .filter((b) => b.length === f.bytes.length)
      .every((b) => b.every((v) => v === 0)),
  );
});
for (const change of [
  "replace",
  "parent",
  "symlink",
  "hardlink",
  "mode",
  "append",
])
  test(`private identity ${change} between stream and completion refuses and erases`, async (t) => {
    const f = await setup(t),
      io = tracked(t),
      h = f.read();
    if (change === "replace") {
      fs.renameSync(f.file, f.file + ".old");
      fs.writeFileSync(f.file, f.bytes, { mode: 0o600 });
    }
    if (change === "parent") {
      fs.renameSync(f.root, f.root + "-old");
      fs.mkdirSync(f.root, { mode: 0o700 });
      fs.writeFileSync(f.file, f.bytes, { mode: 0o600 });
      t.after(() =>
        fs.rmSync(f.root + "-old", { recursive: true, force: true }),
      );
    }
    if (change === "symlink") {
      fs.renameSync(f.file, f.file + ".old");
      fs.symlinkSync(f.file + ".old", f.file);
    }
    if (change === "hardlink") fs.linkSync(f.file, f.file + ".link");
    if (change === "mode") fs.chmodSync(f.file, 0o644);
    if (change === "append") fs.appendFileSync(f.file, " ");
    assert.throws(() => h.complete(), refused);
    assert.deepEqual(io.opened, io.closed);
    assert(
      io.allocations
        .filter((b) => b.length === f.bytes.length)
        .every((b) => b.every((v) => v === 0)),
    );
  });
test("interrupted stream, reentrant read and reentrant completion poison the outer capture", async (t) => {
  const f = await setup(t),
    io = tracked(t),
    read = fs.readSync,
    stat = fs.lstatSync;
  for (const mode of ["interrupt", "read"]) {
    let reached = false;
    t.mock.method(fs, "readSync", ((...args: any[]) => {
      if (!reached) {
        reached = true;
        if (mode === "interrupt")
          throw Object.assign(Error(f.file), { code: "EINTR" });
        assert.throws(() => f.read(), refused);
      }
      return Reflect.apply(read, fs, args);
    }) as typeof fs.readSync);
    syncBuiltinESMExports();
    assert.throws(() => f.read(), refused);
    assert(reached);
    t.mock.method(fs, "readSync", read);
    syncBuiltinESMExports();
  }
  const h = f.read();
  let reached = false;
  t.mock.method(fs, "lstatSync", ((...args: any[]) => {
    if (!reached) {
      reached = true;
      assert.throws(() => h.complete(), refused);
    }
    return Reflect.apply(stat, fs, args);
  }) as typeof fs.lstatSync);
  syncBuiltinESMExports();
  assert.throws(() => h.complete(), refused);
  assert(reached);
  assert.deepEqual(io.opened, io.closed);
  assert(
    io.allocations
      .filter((b) => b.length === f.bytes.length)
      .every((b) => b.every((v) => v === 0)),
  );
});
test("reentrant review/disposal during native file pin poisons the outer result", async (t) => {
  const f = await setup(t),
    io = tracked(t),
    stat = fs.lstatSync;
  for (const mode of ["review", "dispose", "other-read"]) {
    const h = f.read();
    h.complete();
    let reached = false;
    t.mock.method(fs, "lstatSync", ((...args: any[]) => {
      if (!reached) {
        reached = true;
        if (mode === "dispose") h.dispose();
        else if (mode === "review")
          assert.throws(() => h.reviewInTransaction(f.reviewer), refused);
        else assert.throws(() => f.read(), refused);
      }
      return Reflect.apply(stat, fs, args);
    }) as typeof fs.lstatSync);
    syncBuiltinESMExports();
    assert.throws(
      () => f.app.database.transaction(() => h.reviewInTransaction(f.reviewer)),
      refused,
    );
    assert(reached);
    t.mock.method(fs, "lstatSync", stat);
    syncBuiltinESMExports();
  }
  assert(
    io.allocations
      .filter((b) => b.length === f.bytes.length)
      .every((b) => b.every((v) => v === 0)),
  );
});

test("strict one-item manifest/envelope/task bounds and payload/state/subject joins", async (t) => {
  const f = await setup(t),
    before = f.snapshot();
  const cases: [string, (e: any, m: any) => void][] = [
    ["owner", (e) => (e.task.owner = "billing")],
    ["task", (e) => (e.task.name = "integration.other.import")],
    ["version", (e) => (e.task.version = 2)],
    ["revision", (e) => (e.task.expectedRevision = 1)],
    ["claim", (e) => (e.task.priorClaim = {})],
    ["site", (e) => (e.task.siteIds = [f.w1])],
    [
      "extra evidence",
      (e) => {
        e.evidence.items.push({ ...e.evidence.items[0], reference: "other" });
        e.evidence.setHash = digest(canonical(e.evidence.items));
      },
    ],
    [
      "extra manifest",
      (_e, m) => m.files.push({ reference: "other", path: "other" }),
    ],
    ["empty manifest", (_e, m) => (m.files = [])],
    ["extra key", (_e, m) => (m.complete = true)],
    ["reference", (_e, m) => (m.files[0].reference = "other")],
    ["path traversal", (_e, m) => (m.files[0].path = "../report.json")],
    ["absolute child", (_e, m) => (m.files[0].path = f.file)],
    [
      "empty bytes",
      (e) => {
        e.evidence.items[0].bytes = 0;
        e.evidence.setHash = digest(canonical(e.evidence.items));
      },
    ],
    [
      "oversize",
      (e) => {
        e.evidence.items[0].bytes = checkoutPrivateEvidenceBytes + 1;
        e.evidence.setHash = digest(canonical(e.evidence.items));
      },
    ],
    [
      "size",
      (e) => {
        e.evidence.items[0].bytes++;
        e.evidence.setHash = digest(canonical(e.evidence.items));
      },
    ],
    [
      "file hash",
      (e) => {
        e.evidence.items[0].sha256 = digest("changed");
        e.evidence.setHash = digest(canonical(e.evidence.items));
      },
    ],
    ["set hash", (e) => (e.evidence.setHash = digest("changed"))],
    ["payload", (e) => (e.task.payloadHash = digest("changed"))],
    ["state", (e) => (e.task.expectedStateHash = digest("changed"))],
    ["subject", (e) => (e.task.subjectId = "another")],
    ["org", (e) => (e.task.orgId = "another")],
    ["candidate", (e) => (e.candidate.logicalHash = digest("changed"))],
    ["candidate file", (e) => e.candidate.file.ino++],
    ["session", (e) => (e.session.lineageHash = digest("changed"))],
  ];
  for (const [name, change] of cases)
    await t.test(name, () => {
      const e = structuredClone(f.envelope),
        m = structuredClone(f.manifest);
      change(e, m);
      assert.throws(() => {
        const h = f.reader.read(e, m);
        try {
          h.complete();
          f.app.database.transaction(() => h.reviewInTransaction(f.reviewer));
        } finally {
          h.dispose();
        }
      }, refused);
    });
  assert.equal(f.snapshot(), before);
});
test("canonical exact bytes refuse alternative encoding, duplicates, malformed/lossy UTF8, BOM, numbers and allocation excess", async (t) => {
  const f = await setup(t),
    before = f.snapshot();
  const cases: [string, Buffer][] = [
    ["pretty", Buffer.from(JSON.stringify(f.inputData, null, 2))],
    ["newline", Buffer.from(json(f.inputData) + "\n")],
    [
      "duplicate",
      Buffer.from(
        json(f.inputData).replace('"version":1', '"version":1,"version":1'),
      ),
    ],
    ["BOM", Buffer.concat([Buffer.from([239, 187, 191]), f.bytes])],
    ["invalid UTF8", Buffer.from([195, 40])],
    ["surrogate UTF8", Buffer.from([237, 160, 128])],
    ["replacement", Buffer.from('{"x":"�"}')],
    ["lone surrogate", Buffer.from('{"x":"\\ud800"}')],
    ["unsafe number", Buffer.from('{"x":9007199254740993}')],
    ["negative zero", Buffer.from('{"x":-0}')],
    ["overflow", Buffer.from('{"x":1e999}')],
    ["array", Buffer.from(json({ x: Array(129).fill(null) }))],
    ["depth", Buffer.from("[".repeat(22) + "null" + "]".repeat(22))],
    ["scalar", Buffer.from(json({ x: "x".repeat(65537) }))],
    ["large file", Buffer.alloc(checkoutPrivateEvidenceBytes + 1, 32)],
    ["extra key", Buffer.from(json({ ...f.inputData, allowed: true }))],
  ];
  for (const [name, bytes] of cases)
    await t.test(name, () => {
      f.write(bytes);
      assert.throws(() => f.run(), refused);
    });
  f.write();
  assert(f.run());
  assert.equal(f.snapshot(), before);
});
test("valid supplementary Unicode stays exact while original input mutation cannot replace captured bytes", async (t) => {
  const f = await setup(t);
  f.inputData.binding.runtimeBindingId = "synthetic-😀";
  f.envelope.task.payloadHash = digest(canonical(f.inputData));
  f.write();
  const expected = compare(f.inputData),
    h = f.read();
  h.complete();
  f.inputData.provider.session.payment_intent.id = "pi_mutated";
  f.envelope.task.subjectId = "mutated";
  f.manifest.files[0]!.path = "mutated";
  const result = f.app.database.transaction(() =>
    h.reviewInTransaction(f.reviewer),
  );
  assert.equal(result.native.comparisonHash, expected.hash);
});
test("proxy/accessor/prototype envelopes and manifests reject before any caller trap", async (t) => {
  const f = await setup(t);
  let trapped = false;
  const trap = () => {
    trapped = true;
    throw Error("private trap");
  };
  const proxy = new Proxy(
    {},
    {
      get: trap,
      ownKeys: trap,
      getPrototypeOf: trap,
      getOwnPropertyDescriptor: trap,
    },
  );
  const rev = Proxy.revocable({}, {});
  rev.revoke();
  const e1 = structuredClone(f.envelope);
  Object.defineProperty(e1, "task", { get: trap, enumerable: true });
  const e2 = structuredClone(f.envelope);
  e2.evidence.items = proxy;
  const e3 = structuredClone(f.envelope);
  Object.setPrototypeOf(e3.task, { inherited: true });
  const m1 = structuredClone(f.manifest);
  Object.defineProperty(m1.files[0], "path", { get: trap, enumerable: true });
  const m2 = structuredClone(f.manifest);
  m2.files = rev.proxy as any;
  const m3 = structuredClone(f.manifest);
  Object.defineProperty(m3.files, "0", { get: trap, enumerable: true });
  for (const e of [proxy, rev.proxy, e1, e2, e3])
    assert.throws(() => f.reader.read(e, f.manifest), refused);
  for (const m of [proxy, rev.proxy, m1, m2, m3])
    assert.throws(() => f.reader.read(f.envelope, m), refused);
  const fake = Object.create(Private.prototype);
  assert.throws(() => fake.read(proxy, proxy), refused);
  const h = f.read();
  h.complete();
  assert.throws(
    () => f.app.database.transaction(() => h.reviewInTransaction(proxy)),
    refused,
  );
  assert.equal(trapped, false);
});
test("captured byte mutation refuses before comparison and always erases", async (t) => {
  const f = await setup(t),
    io = tracked(t),
    h = f.read();
  h.complete();
  const b = io.allocations.find((b) => b.length === f.bytes.length)!;
  assert(b);
  b[0] = 0;
  assert.throws(
    () => f.app.database.transaction(() => h.reviewInTransaction(f.reviewer)),
    refused,
  );
  assert(b.every((v) => v === 0));
});
test("after completion current IAM, raw hold, nonOPEN phase, native history and writer are mandatory", async (t) => {
  const f = await setup(t);
  let h = f.read();
  h.complete();
  assert.throws(() => h.reviewInTransaction(f.reviewer), refused);
  for (const change of [
    "active",
    "role",
    "password",
    "org",
    "choice",
    "hold",
    "phase",
    "history",
    "claim",
    "settlement",
  ]) {
    const before = f.snapshot();
    h = f.read();
    h.complete();
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          const iam = f.app.database.owned("iam"),
            i = f.app.database.owned("integration");
          if (change === "active")
            iam.run("UPDATE iam_users SET active=0 WHERE id=?", f.reviewer.id);
          if (change === "role")
            iam.run(
              "UPDATE iam_users SET role='support' WHERE id=?",
              f.reviewer.id,
            );
          if (change === "org")
            iam.run(
              "UPDATE iam_users SET org_id='other' WHERE id=?",
              f.reviewer.id,
            );
          if (change === "password")
            iam.run(
              "INSERT INTO iam_user_security VALUES(?,1,1,'2026-10-04T00:00:00.000Z') ON CONFLICT(user_id) DO UPDATE SET password_change_required=1",
              f.reviewer.id,
            );
          if (change === "choice")
            iam.run(
              "UPDATE iam_accounts SET provider_exceptions='[]' WHERE id=?",
              f.buyer,
            );
          if (change === "hold")
            f.app.database
              .owned("platform")
              .run("DELETE FROM platform_recovery");
          if (change === "phase") {
            const s = f.app.platform.offline.readInTransaction()!;
            f.app.platform.offline.transitionInTransaction(
              s.state.generation,
              s.anchor,
              { kind: "drain" },
              [],
            );
          }
          if (change === "history")
            i.run(
              "UPDATE integration_effects SET error='changed' WHERE id=?",
              f.effectId,
            );
          if (change === "claim")
            i.run(
              "UPDATE integration_operation_leases SET token='copied',started_at=1 WHERE effect_id=?",
              f.effectId,
            );
          if (change === "settlement")
            f.app.billing.verifiedPayment(
              f.actor,
              f.invoiceId,
              1,
              "stripe",
              "pi_changed",
            );
          assert.throws(() => h.reviewInTransaction(f.reviewer), refused);
          throw Error("rollback fixture");
        }),
      /rollback fixture/,
    );
    assert.equal(f.snapshot(), before);
    assert.throws(() => h.complete(), refused);
  }
});
test("actual sameDB owner graph substitution and own method callbacks refuse without invocation", async (t) => {
  const f = await setup(t),
    other = fixture(t),
    before = f.snapshot();
  let trapped = false;
  const hook = () => {
    trapped = true;
    throw Error("owner hook");
  };
  const good = [
    f.app.database,
    f.app.identity,
    f.app.billing,
    f.app.integration.checkouts,
  ] as const;
  for (let index = 0; index < 4; index++)
    for (const replacement of [
      new Proxy(good[index]!, { get: hook, getPrototypeOf: hook }),
      Object.create(Object.getPrototypeOf(good[index]!)),
    ]) {
      const args: [Database, Identity, Billing, IntegrationCheckouts] = [
        ...good,
      ];
      (args as unknown[])[index] = replacement;
      assert.throws(() => new Private(...args));
    }
  assert.throws(
    () =>
      new Private(
        other.app.database,
        f.app.identity,
        f.app.billing,
        f.app.integration.checkouts,
      ),
  );
  assert.throws(
    () =>
      new Private(
        f.app.database,
        other.app.identity,
        f.app.billing,
        f.app.integration.checkouts,
      ),
  );
  // Actual second object on SAME Database is not the original linked owner graph.
  const substitute = Object.assign(
    Object.create(Billing.prototype),
    f.app.billing,
  );
  assert.throws(
    () =>
      new Private(
        f.app.database,
        f.app.identity,
        substitute,
        f.app.integration.checkouts,
      ),
  );
  const h = f.read();
  h.complete();
  Object.defineProperty(
    f.app.database,
    "captureRestoreCandidateInTransaction",
    { value: hook, configurable: true },
  );
  try {
    assert.throws(
      () => f.app.database.transaction(() => h.reviewInTransaction(f.reviewer)),
      refused,
    );
  } finally {
    delete (f.app.database as any).captureRestoreCandidateInTransaction;
  }
  assert.equal(trapped, false);
  assert.equal(f.snapshot(), before);
});
test("native database pathname replacement after private completion refuses", async (t) => {
  const f = await setup(t),
    h = f.read();
  h.complete();
  fs.renameSync(f.path, f.path + ".held");
  fs.copyFileSync(f.path + ".held", f.path);
  try {
    assert.throws(
      () => f.app.database.transaction(() => h.reviewInTransaction(f.reviewer)),
      refused,
    );
  } finally {
    fs.unlinkSync(f.path);
    fs.renameSync(f.path + ".held", f.path);
  }
});
test("independent completed capture survives native rollback and exact application reopen without reopening evidence", async (t) => {
  const f = await setup(t),
    before = f.snapshot(),
    h = f.read();
  h.complete();
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        assert(h.reviewInTransaction(f.reviewer));
        throw Error("rollback read");
      }),
    /rollback read/,
  );
  assert.equal(f.snapshot(), before);
  assert.throws(() => h.complete(), refused);
  f.app.close();
  f.app = new Application(f.path, "CA", { eventReports: false });
  const r = new Private(
      f.app.database,
      f.app.identity,
      f.app.billing,
      f.app.integration.checkouts,
    ),
    next = r.read(f.envelope, f.manifest);
  next.complete();
  fs.unlinkSync(f.file);
  assert(
    f.app.database.transaction(() => next.reviewInTransaction(f.reviewer)),
  );
  assert.equal(f.snapshot(), before);
});

test("JSON refusal and pending discard erase bytes; actor accessors never execute", async (t) => {
  const f = await setup(t),
    io = tracked(t);
  const pending = f.read();
  pending.dispose();
  pending.dispose();
  f.write(Buffer.from('{"bad":"\\ud800"}'));
  const malformed = f.read();
  malformed.complete();
  assert.throws(
    () =>
      f.app.database.transaction(() =>
        malformed.reviewInTransaction(f.reviewer),
      ),
    refused,
  );
  f.write();
  const h = f.read();
  h.complete();
  let getter = false;
  const a = {
    orgId: f.reviewer.orgId,
    get id() {
      getter = true;
      throw Error("private actor");
    },
  };
  assert.throws(
    () => f.app.database.transaction(() => h.reviewInTransaction(a)),
    refused,
  );
  assert.equal(getter, false);
  assert(io.allocations.length > 0);
  assert(io.allocations.every((b) => b.every((x) => x === 0)));
  assert.deepEqual(io.opened, io.closed);
});
test("distinct captures cannot substitute tokens or stale phase; identity refusal does not invoke proxy traps", async (t) => {
  const f = await setup(t),
    first = f.read(),
    second = f.read();
  first.complete();
  second.complete();
  let trapped = false;
  const rev = Proxy.revocable(
    {},
    {
      get() {
        trapped = true;
        throw Error("trap");
      },
    },
  );
  rev.revoke();
  assert.throws(() => first.complete.call(rev.proxy as any), refused);
  assert.equal(trapped, false);
  assert(
    f.app.database.transaction(() => second.reviewInTransaction(f.reviewer)),
  );
  const h = f.read();
  h.complete();
  const before = f.snapshot();
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        const s = f.app.platform.offline.readInTransaction()!;
        f.app.platform.offline.transitionInTransaction(
          s.state.generation,
          s.anchor,
          { kind: "drain" },
          [],
        );
        assert.throws(() => h.reviewInTransaction(f.reviewer), refused);
        throw Error("rollback phase");
      }),
    /rollback phase/,
  );
  assert.equal(f.snapshot(), before);
});

import * as ApplicationCapture from "../src/server/restore-offline-checkout-private-evidence.ts";
import {
  RestoreOfflineCheckoutReferenceJoin,
  isCapturedOfflineCheckoutReferenceJoin,
} from "../src/server/restore-offline-checkout-reference-join.ts";
import { isCapturedOfflineCheckoutComparison } from "../src/server/integration-offline-checkout-evidence.ts";
async function applicationSetup(...args: Parameters<typeof setup>) {
  const f = await setup(...args);
  f.envelope.task.expectedStateHash = f.app.database.transaction(
    () =>
      new RestoreOfflineCheckoutReferenceJoin(
        f.app.database,
        f.app.identity,
        f.app.billing,
        f.app.integration.checkouts,
      ).getInTransaction(f.reviewer, compare(f.inputData)).hash,
  );
  return f;
}
for (const [region, currency] of [
  ["CA", "CAD"],
  ["CA", "USD"],
  ["US", "USD"],
] as const)
  for (const reports of [false, true])
    test(`application capture ${region}/${currency} reports=${reports}: actual branded comparison/reference/phase and zero writes`, async (t) => {
      const f = await applicationSetup(t, region, currency, reports),
        before = f.snapshot(),
        n = totals(f),
        io = tracked(t),
        h = f.read();
      h.complete();
      fs.unlinkSync(f.file);
      const capture = f.app.database.transaction(() =>
        h.captureForApplicationInTransaction(f.reviewer),
      );
      frozen(capture);
      assert(
        ApplicationCapture.isCapturedCheckoutPrivateApplicationCapture(capture),
      );
      assert(isCapturedOfflineCheckoutComparison(capture.comparison));
      assert(isCapturedOfflineCheckoutReferenceJoin(capture.referenceJoin));
      assert(captured(capture.native));
      assert.equal(capture.envelopeBinding, offlineTaskBinding(f.envelope));
      assert.equal(capture.setHash, f.envelope.evidence.setHash);
      assert.equal(capture.payloadHash, f.envelope.task.payloadHash);
      assert.deepEqual(capture.comparison, compare(f.inputData));
      assert.equal(capture.referenceJoin.nativeJoinHash, capture.native.hash);
      assert.equal(capture.phase.envelopeBinding, capture.envelopeBinding);
      const joined = f.app.database.transaction(() =>
        new RestoreOfflineCheckoutReferenceJoin(
          f.app.database,
          f.app.identity,
          f.app.billing,
          f.app.integration.checkouts,
        ).getInTransaction(f.reviewer, capture.comparison),
      );
      assert.deepEqual(joined, capture.referenceJoin);
      assert.equal(
        capture.comparison.outcome.reference,
        f.inputData.provider.session.id,
      );
      assert.equal(
        capture.comparison.outcome.settlement.paymentId,
        f.inputData.provider.session.payment_intent.id,
      );
      const { captureHash, ...body } = capture;
      assert.equal(
        captureHash,
        digest(
          canonical({
            domain:
              "distributor-offline-checkout-private-application-capture-v1",
            body,
          }),
        ),
      );
      assert(
        capture.referenceJoin.requiredChecks.includes(
          "qualified-source-candidate-fences-and-authority-through-commit",
        ),
      );
      assert(
        capture.referenceJoin.requiredChecks.includes(
          "fixed-checkout-owner-application-contract-required",
        ),
      );
      assert.equal("input" in capture, false);
      assert.equal("bytes" in capture, false);
      assert.equal("allowed" in capture, false);
      assert.equal(totals(f), n);
      assert.equal(f.snapshot(), before);
      assert.equal(f.calls(), 1);
      assert.equal(io.opened.length, 1);
      assert.deepEqual(io.opened, io.closed);
      assert(
        io.allocations
          .filter((b) => b.length === f.bytes.length)
          .every((b) => b.every((v) => v === 0)),
      );
      assert.throws(
        () => h.captureForApplicationInTransaction(f.reviewer),
        refused,
      );
      assert.throws(() => h.reviewInTransaction(f.reviewer), refused);
      h.dispose();
    });

test("application capture brand rejects forged hashes/clones/prototypes and normal/revoked proxies without traps", async (t) => {
  const f = await applicationSetup(t),
    h = f.read();
  h.complete();
  const c = f.app.database.transaction(() =>
    h.captureForApplicationInTransaction(f.reviewer),
  );
  let traps = 0;
  const trap = () => {
    traps++;
    throw Error("private trap");
  };
  const p = new Proxy(c, {
    get: trap,
    getPrototypeOf: trap,
    ownKeys: trap,
    getOwnPropertyDescriptor: trap,
  });
  const rev = Proxy.revocable(c, {});
  rev.revoke();
  for (const value of [
    null,
    undefined,
    {},
    structuredClone(c),
    Object.freeze({ ...c }),
    Object.create(c),
    p,
    rev.proxy,
    () => c,
  ])
    assert.equal(
      ApplicationCapture.isCapturedCheckoutPrivateApplicationCapture(value),
      false,
    );
  const changed = structuredClone(c);
  changed.comparison.outcome.settlement.paymentId = "pi_forged";
  const { captureHash: _hash, ...body } = changed;
  const rehashed = {
    ...changed,
    captureHash: digest(
      canonical({
        domain: "distributor-offline-checkout-private-application-capture-v1",
        body,
      }),
    ),
  };
  assert.equal(
    ApplicationCapture.isCapturedCheckoutPrivateApplicationCapture(rehashed),
    false,
  );
  assert.equal(traps, 0);
  assert(ApplicationCapture.isCapturedCheckoutPrivateApplicationCapture(c));
  assert.throws(() => {
    (c.comparison.outcome.settlement as any).paymentId = "changed";
  }, TypeError);
});

test("review and application capture are mutually exclusive; pending/disposed/fake receivers cannot consume", async (t) => {
  const f = await applicationSetup(t),
    io = tracked(t),
    before = f.snapshot();
  for (const operation of ["review", "capture"]) {
    f.envelope.task.expectedStateHash =
      operation === "review"
        ? f.inputData.candidate.factsHash
        : f.app.database.transaction(
            () =>
              new RestoreOfflineCheckoutReferenceJoin(
                f.app.database,
                f.app.identity,
                f.app.billing,
                f.app.integration.checkouts,
              ).getInTransaction(f.reviewer, compare(f.inputData)).hash,
          );
    const h = f.read();
    h.complete();
    const r = f.app.database.transaction(() =>
      operation === "review"
        ? h.reviewInTransaction(f.reviewer)
        : h.captureForApplicationInTransaction(f.reviewer),
    );
    assert.equal(
      ApplicationCapture.isCapturedCheckoutPrivateApplicationCapture(r),
      operation === "capture",
    );
    if (operation === "review") {
      assert.equal("comparison" in r, false);
      assert.equal("referenceJoin" in r, false);
      assert.equal("captureHash" in r, false);
    }
    assert.throws(
      () => h.captureForApplicationInTransaction(f.reviewer),
      refused,
    );
    assert.throws(() => h.reviewInTransaction(f.reviewer), refused);
    assert.throws(() => h.complete(), refused);
    h.dispose();
  }
  let trapped = false;
  const p = new Proxy(
    {},
    {
      get() {
        trapped = true;
        throw Error("trap");
      },
      getPrototypeOf() {
        trapped = true;
        throw Error("trap");
      },
    },
  );
  for (const mode of ["pending", "disposed", "receiver"]) {
    const h = f.read();
    if (mode !== "pending") h.complete();
    if (mode === "disposed") h.dispose();
    assert.throws(
      () =>
        f.app.database.transaction(() =>
          mode === "receiver"
            ? h.captureForApplicationInTransaction.call(p as any, f.reviewer)
            : h.captureForApplicationInTransaction(f.reviewer),
        ),
      refused,
    );
    assert.throws(() => h.complete(), refused);
  }
  assert.equal(trapped, false);
  assert.equal(f.snapshot(), before);
  assert(
    io.allocations
      .filter((b) => b.length === f.bytes.length)
      .every((b) => b.every((x) => x === 0)),
  );
  assert.deepEqual(io.opened, io.closed);
});

for (const mode of ["capture", "review", "read", "dispose"] as const)
  test(`application capture ${mode} reentry poisons outer mint and erases`, async (t) => {
    const f = await applicationSetup(t),
      io = tracked(t),
      h = f.read();
    h.complete();
    let reached = false;
    const stat = fs.lstatSync;
    t.mock.method(fs, "lstatSync", ((...args: any[]) => {
      if (!reached) {
        reached = true;
        if (mode === "dispose") h.dispose();
        else if (mode === "read") assert.throws(() => f.read(), refused);
        else
          assert.throws(
            () =>
              mode === "capture"
                ? h.captureForApplicationInTransaction(f.reviewer)
                : h.reviewInTransaction(f.reviewer),
            refused,
          );
      }
      return Reflect.apply(stat, fs, args);
    }) as typeof fs.lstatSync);
    syncBuiltinESMExports();
    assert.throws(
      () =>
        f.app.database.transaction(() =>
          h.captureForApplicationInTransaction(f.reviewer),
        ),
      refused,
    );
    assert(reached);
    assert.throws(() => h.complete(), refused);
    assert(
      io.allocations
        .filter((b) => b.length === f.bytes.length)
        .every((b) => b.every((x) => x === 0)),
    );
  });

test("application envelope digest cannot be replaced after capture; same allocation is checked again and erased on failure", async (t) => {
  const f = await applicationSetup(t),
    io = tracked(t);
  f.envelope.task.payloadHash = digest("wrong input");
  let h = f.read();
  h.complete();
  assert.throws(
    () =>
      f.app.database.transaction(() =>
        h.captureForApplicationInTransaction(f.reviewer),
      ),
    refused,
  );
  f.envelope.task.payloadHash = digest(canonical(f.inputData));
  h = f.read();
  h.complete();
  const bytes = io.allocations.findLast((b) => b.length === f.bytes.length)!;
  assert(bytes);
  bytes[0] = bytes[0]! ^ 1;
  assert.throws(
    () =>
      f.app.database.transaction(() =>
        h.captureForApplicationInTransaction(f.reviewer),
      ),
    refused,
  );
  assert(bytes.every((v) => v === 0));
  const fresh = f.read();
  fresh.complete();
  const expected = compare(f.inputData);
  f.inputData.provider.session.id = "cs_test_mutated";
  f.envelope.task.payloadHash = digest(canonical(f.inputData));
  const c = f.app.database.transaction(() =>
    fresh.captureForApplicationInTransaction(f.reviewer),
  );
  assert.deepEqual(c.comparison, expected);
});

for (const change of [
  "active",
  "role",
  "password",
  "org",
  "hold",
  "history",
  "claim",
  "phase",
])
  test(`application fresh ${change} refusal rolls back fixture mutation and disposes`, async (t) => {
    const f = await applicationSetup(t),
      before = f.snapshot(),
      io = tracked(t),
      h = f.read();
    h.complete();
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          const iam = f.app.database.owned("iam"),
            i = f.app.database.owned("integration");
          if (change === "active")
            iam.run("UPDATE iam_users SET active=0 WHERE id=?", f.reviewer.id);
          if (change === "role")
            iam.run(
              "UPDATE iam_users SET role='support' WHERE id=?",
              f.reviewer.id,
            );
          if (change === "password")
            iam.run(
              "INSERT INTO iam_user_security VALUES(?,1,1,'2026-10-04T00:00:00.000Z') ON CONFLICT(user_id) DO UPDATE SET password_change_required=1",
              f.reviewer.id,
            );
          if (change === "org")
            iam.run(
              "UPDATE iam_users SET org_id='foreign' WHERE id=?",
              f.reviewer.id,
            );
          if (change === "hold")
            f.app.database
              .owned("platform")
              .run("DELETE FROM platform_recovery");
          if (change === "history")
            i.run(
              "UPDATE integration_effects SET error='changed' WHERE id=?",
              f.effectId,
            );
          if (change === "claim")
            i.run(
              "UPDATE integration_operation_leases SET token='copied',started_at=1 WHERE effect_id=?",
              f.effectId,
            );
          if (change === "phase") {
            const s = f.app.platform.offline.readInTransaction()!;
            f.app.platform.offline.transitionInTransaction(
              s.state.generation,
              s.anchor,
              { kind: "drain" },
              [],
            );
          }
          assert.throws(
            () => h.captureForApplicationInTransaction(f.reviewer),
            refused,
          );
          throw Error("rollback application fixture");
        }),
      /rollback application fixture/,
    );
    assert.equal(f.snapshot(), before);
    assert.throws(() => h.complete(), refused);
    assert(
      io.allocations
        .filter((b) => b.length === f.bytes.length)
        .every((b) => b.every((v) => v === 0)),
    );
  });

test("application capture requires actual writer and current unmodified owning methods", async (t) => {
  const f = await applicationSetup(t),
    before = f.snapshot();
  let h = f.read();
  h.complete();
  assert.throws(
    () => h.captureForApplicationInTransaction(f.reviewer),
    refused,
  );
  h = f.read();
  h.complete();
  let called = false;
  Object.defineProperty(f.app.billing, "verifiedPayment", {
    value: () => {
      called = true;
      throw Error("foreign");
    },
    configurable: true,
  });
  try {
    assert.throws(
      () =>
        f.app.database.transaction(() =>
          h.captureForApplicationInTransaction(f.reviewer),
        ),
      refused,
    );
  } finally {
    delete (f.app.billing as any).verifiedPayment;
  }
  assert.equal(called, false);
  assert.equal(f.snapshot(), before);
});

for (const reference of ["payment", "session"] as const)
  test(`application actual ${reference} collision outside selected invoice refuses even with current candidate/native facts`, async (t) => {
    const f = await setup(t, "CA", "CAD", false, async (f) => {
      const otherBuyer = f.app.identity.createCustomer(
        f.actor,
        "collision-buyer",
        {
          name: "Synthetic collision customer",
          tier: "standard",
          creditLimit: 1000000,
        },
      ).id;
      const other = { ...f, buyer: otherBuyer },
        invoiceId = ship(
          other,
          accept(other, 1, "collision-order").id,
        ).invoiceId;
      if (reference === "payment")
        f.app.database.transaction(() =>
          f.app.billing.verifiedPayment(
            f.actor,
            invoiceId,
            1,
            "stripe",
            "pi_synthetic",
          ),
        );
      else {
        chooseProviders(other, f.actor, "collision-choice", {
          accountId: otherBuyer,
          region: "CA",
          mode: "provider-exceptions",
          providers: ["stripe"],
          version: 1,
          acknowledgment: "Synthetic only",
        });
        const e = f.app.integration.checkout(f.actor, "collision-checkout", {
          invoiceId,
        });
        const result = {
          reference: "cs_test_synthetic",
          result: {
            amount: 11300,
            currency: "cad",
            status: "complete",
            paymentStatus: "paid",
            expiresAt: 1893456000,
          },
        };
        await f.app.integration.execute(f.actor, e.id, {
          execute: async () => result,
          lookup: async () => result,
        });
      }
    });
    const comparison = compare(f.inputData),
      before = f.snapshot(),
      n = totals(f);
    // Prove the selected baseline native join succeeds; this refusal needs the
    // new actual global owning reference join, not merely an old candidate hash.
    assert(
      f.app.database.transaction(() =>
        f.join().getInTransaction(f.reviewer, comparison),
      ),
    );
    assert.throws(
      () =>
        f.app.database.transaction(() =>
          new RestoreOfflineCheckoutReferenceJoin(
            f.app.database,
            f.app.identity,
            f.app.billing,
            f.app.integration.checkouts,
          ).getInTransaction(f.reviewer, comparison),
        ),
      {
        code:
          reference === "payment"
            ? "OFFLINE_CHECKOUT_PAYMENT_REFERENCE_COLLISION"
            : "OFFLINE_CHECKOUT_SESSION_REFERENCE_COLLISION",
      },
    );
    const h = f.read();
    h.complete();
    assert.throws(
      () =>
        f.app.database.transaction(() =>
          h.captureForApplicationInTransaction(f.reviewer),
        ),
      refused,
    );
    assert.equal(totals(f), n);
    assert.equal(f.snapshot(), before);
  });

test("application reference change in same writer after completion is visible and whole fixture rolls back", async (t) => {
  let invoiceId = "";
  const f = await applicationSetup(t, "CA", "CAD", false, (f) => {
    invoiceId = ship(f, accept(f, 1, "later-payment").id).invoiceId;
  });
  const before = f.snapshot(),
    h = f.read();
  h.complete();
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        f.app.billing.verifiedPayment(
          f.actor,
          invoiceId,
          1,
          "stripe",
          "pi_synthetic",
        );
        assert.throws(
          () => h.captureForApplicationInTransaction(f.reviewer),
          refused,
        );
        throw Error("rollback late payment");
      }),
    /rollback late payment/,
  );
  assert.equal(f.snapshot(), before);
  assert.throws(() => h.complete(), refused);
});

test("application capture after exact reopen is fresh native consistency; old process capture is not durable qualification", async (t) => {
  const f = await applicationSetup(t),
    h = f.read();
  h.complete();
  const c = f.app.database.transaction(() =>
      h.captureForApplicationInTransaction(f.reviewer),
    ),
    before = f.snapshot();
  f.app.close();
  f.app = new Application(f.path, "CA", { eventReports: false });
  const reader = new Private(
      f.app.database,
      f.app.identity,
      f.app.billing,
      f.app.integration.checkouts,
    ),
    next = reader.read(f.envelope, f.manifest);
  next.complete();
  const result = f.app.database.transaction(() =>
    next.captureForApplicationInTransaction(f.reviewer),
  );
  assert.deepEqual(result, c);
  assert.notEqual(result, c);
  assert(
    ApplicationCapture.isCapturedCheckoutPrivateApplicationCapture(result),
  );
  assert.equal(f.snapshot(), before);
  assert(
    result.referenceJoin.requiredChecks.includes(
      "qualified-stripe-account-runtime-binding-and-provider-truth",
    ),
  );
});

test("application capture refuses a logically identical write during phase review and outer rollback conserves state", async (t) => {
  const f = await applicationSetup(t),
    io = tracked(t),
    h = f.read(),
    before = f.snapshot();
  h.complete();
  let injected = false;
  const stat = fs.lstatSync;
  t.mock.method(fs, "lstatSync", ((...args: any[]) => {
    if (
      !injected &&
      new Error().stack?.includes(
        "RestoreOfflineNativePhase.reviewInTransaction",
      )
    ) {
      injected = true;
      f.app.database
        .owned("integration")
        .run(
          "UPDATE integration_effects SET error=error WHERE id=?",
          f.effectId,
        );
    }
    return Reflect.apply(stat, fs, args);
  }) as typeof fs.lstatSync);
  syncBuiltinESMExports();
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        const n = totals(f);
        assert.throws(
          () => h.captureForApplicationInTransaction(f.reviewer),
          refused,
        );
        assert(injected);
        assert.equal(totals(f), (n as number) + 1);
        throw Error("fixture rollback");
      }),
    /fixture rollback/,
  );
  assert.equal(f.snapshot(), before);
  assert.throws(() => h.complete(), refused);
  assert(
    io.allocations
      .filter((b) => b.length === f.bytes.length)
      .every((b) => b.every((x) => x === 0)),
  );
});

test("application requires enhanced reference hash while redacted review retains native hash contract", async (t) => {
  const f = await applicationSetup(t);
  const enhanced = f.envelope.task.expectedStateHash;
  assert.notEqual(enhanced, f.inputData.candidate.factsHash);
  f.envelope.task.expectedStateHash = f.inputData.candidate.factsHash;
  const rejected = f.read();
  rejected.complete();
  assert.throws(
    () =>
      f.app.database.transaction(() =>
        rejected.captureForApplicationInTransaction(f.reviewer),
      ),
    refused,
  );
  const reviewed = f.read();
  reviewed.complete();
  assert.equal(
    f.app.database.transaction(() => reviewed.reviewInTransaction(f.reviewer))
      .status,
    "native-private-checkout-consistency-only",
  );
  f.envelope.task.expectedStateHash = enhanced;
  const accepted = f.read();
  accepted.complete();
  assert.equal(
    f.app.database.transaction(() =>
      accepted.captureForApplicationInTransaction(f.reviewer),
    ).referenceJoin.hash,
    enhanced,
  );
});

for (const application of [false, true])
  for (const target of ["offline", "restore"] as const)
    for (const prototype of [false, true])
      for (const late of [false, true])
        test(`${application ? "application" : "review"} phase ${target} ${prototype ? "prototype" : "instance"} wrapper ${late ? "during phase filesystem read" : "after completion"} refuses before hook and disposes`, async (t) => {
          const f = await (application ? applicationSetup(t) : setup(t)),
            io = tracked(t),
            h = f.read(),
            before = f.snapshot(),
            object = f.app.platform[target],
            subject = prototype ? Object.getPrototypeOf(object) : object,
            key =
              target === "offline"
                ? "readInTransaction"
                : "offlineReleaseHistoryInTransaction",
            descriptor = Object.getOwnPropertyDescriptor(subject, key),
            original = (object as any)[key];
          h.complete();
          let hooks = 0,
            injected = false;
          const inject = () => {
            injected = true;
            Object.defineProperty(subject, key, {
              value: function (...args: unknown[]) {
                hooks++;
                return original.apply(this, args);
              },
              configurable: true,
              writable: true,
            });
          };
          if (late) {
            const stat = fs.lstatSync;
            t.mock.method(fs, "lstatSync", ((...args: any[]) => {
              if (
                !injected &&
                new Error().stack?.includes(
                  "RestoreOfflineNativePhase.reviewInTransaction",
                )
              )
                inject();
              return Reflect.apply(stat, fs, args);
            }) as typeof fs.lstatSync);
            syncBuiltinESMExports();
          } else inject();
          try {
            assert.throws(
              () =>
                f.app.database.transaction(() => {
                  const n = totals(f);
                  assert.throws(
                    () =>
                      application
                        ? h.captureForApplicationInTransaction(f.reviewer)
                        : h.reviewInTransaction(f.reviewer),
                    refused,
                  );
                  assert.equal(totals(f), n);
                  throw Error("fixture rollback");
                }),
              /fixture rollback/,
            );
          } finally {
            if (descriptor) Object.defineProperty(subject, key, descriptor);
            else delete (subject as any)[key];
            t.mock.restoreAll();
            syncBuiltinESMExports();
          }
          assert(injected);
          assert.equal(hooks, 0);
          assert.equal(f.snapshot(), before);
          assert.throws(() => h.complete(), refused);
          assert(
            io.allocations
              .filter((b) => b.length === f.bytes.length)
              .every((b) => b.every((x) => x === 0)),
          );
        });

for (const target of ["offline", "restore"] as const)
  for (const link of ["database", "store"] as const)
    test(`application phase actual ${target}.${link} identity replacement refuses without hooks`, async (t) => {
      const f = await applicationSetup(t),
        io = tracked(t),
        h = f.read(),
        before = f.snapshot(),
        object = f.app.platform[target],
        descriptor = Object.getOwnPropertyDescriptor(object, link)!;
      h.complete();
      let hooks = 0;
      const replacement = new Proxy(
        {},
        {
          get() {
            hooks++;
            throw Error("unexpected");
          },
          ownKeys() {
            hooks++;
            return [];
          },
          getPrototypeOf() {
            hooks++;
            return null;
          },
        },
      );
      Object.defineProperty(object, link, {
        ...descriptor,
        value: replacement,
      });
      try {
        assert.throws(
          () =>
            f.app.database.transaction(() =>
              h.captureForApplicationInTransaction(f.reviewer),
            ),
          refused,
        );
      } finally {
        Object.defineProperty(object, link, descriptor);
      }
      assert.equal(hooks, 0);
      assert.equal(f.snapshot(), before);
      assert.throws(() => h.complete(), refused);
      assert(
        io.allocations
          .filter((b) => b.length === f.bytes.length)
          .every((b) => b.every((x) => x === 0)),
      );
    });
