import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { generateKeyPairSync, sign } from "node:crypto";
import { canonical, digest } from "../src/server/core.ts";
import { Application } from "../src/server/application.ts";
import { checkoutPaidFixture } from "./offline-checkout-paid-fixture.ts";
import {
  RestoreOfflineCheckoutPaidCoordinator as Coordinator,
  type OfflineCheckoutPaidHost,
  type OfflineCheckoutPaidQualification,
} from "../src/server/restore-offline-checkout-paid-coordinator.ts";
import { compareOfflineCheckoutPaidEvidence } from "../src/server/integration-offline-checkout-evidence.ts";
import { RestoreOfflineCheckoutReferenceJoin } from "../src/server/restore-offline-checkout-reference-join.ts";
import { RestoreOfflineCheckoutNativeJoin } from "../src/server/restore-offline-checkout-native-join.ts";
import { RestoreOfflineCheckoutPrivateEvidence } from "../src/server/restore-offline-checkout-private-evidence.ts";
import { IntegrationOfflineCheckoutPaid } from "../src/server/integration-offline-checkout-paid.ts";
import { RestoreOfflineNativePhase } from "../src/server/restore-offline-native-phase.ts";
import { RestoreOfflineStorage } from "../src/server/restore-offline-storage.ts";
import { RestoreActivation } from "../src/server/restore-activation.ts";
import { RestoreOfflineCommitGuard } from "../src/server/restore-offline-commit-guard.ts";
import { RestoreOfflineCommitRecoveryReader } from "../src/server/restore-offline-commit-recovery.ts";
import { BillingOfflineCheckoutReferenceReview } from "../src/server/billing-offline-checkout-reference-review.ts";
import { IntegrationOfflineCheckoutReferenceReview } from "../src/server/integration-offline-checkout-reference-review.ts";
import {
  offlineTaskBinding,
  offlineTaskApprovalMessage,
} from "../src/server/restore-offline-envelope.ts";
import { offlineApprovalRosterFingerprint } from "../src/server/restore-offline-approvals.ts";

// Actual native fixtures and signatures; the host is synthetic, not qualified
// infrastructure. These tests never make a provider request.
async function ready(
  t: TestContext,
  region: "CA" | "US" = "CA",
  currency: "CAD" | "USD" = "CAD",
  reports = false,
) {
  const f = await checkoutPaidFixture(t, region, currency, reports),
    a = f.app;
  const comparison = compareOfflineCheckoutPaidEvidence(f.inputData);
  const reference = a.database.transaction(() =>
    new RestoreOfflineCheckoutReferenceJoin(
      a.database,
      a.identity,
      a.billing,
      a.integration.checkouts,
    ).getInTransaction(f.executor, comparison),
  );
  f.envelope.task.expectedStateHash = reference.hash;
  const pairs = [
    generateKeyPairSync("ed25519"),
    generateKeyPairSync("ed25519"),
  ];
  const roster = pairs.map((p, i) => ({
    id: i === 0 ? "finance-signer" : "security-signer",
    role: i === 0 ? ("finance" as const) : ("security" as const),
    personId: "signer-person-" + i,
    publicKey: p.publicKey.export({ type: "spki", format: "pem" }).toString(),
  }));
  f.envelope.trust.registryHash = offlineApprovalRosterFingerprint(roster);
  const approvals = roster.map((r, i) => ({
    signerId: r.id,
    role: r.role,
    binding: offlineTaskBinding(f.envelope),
    signature: sign(
      null,
      Buffer.from(offlineTaskApprovalMessage(f.envelope, r.id, r.role)),
      pairs[i]!.privateKey,
    ).toString("base64"),
  }));
  const q: OfflineCheckoutPaidQualification = {
    purpose: "distributor-offline-current-checkout-paid-qualification-v1",
    envelopeBinding: offlineTaskBinding(f.envelope),
    now: "2026-10-04T01:00:01.000Z",
    trust: structuredClone(f.envelope.trust),
    roster,
    associations: {
      preparer: { id: f.reviewer.id, personId: "preparer-person" },
      executor: { id: f.executor.id, personId: "executor-person" },
      operations: {
        id: f.envelope.operations.authorityId,
        personId: "operations-person",
      },
    },
    evidence: {
      setHash: f.envelope.evidence.setHash,
      qualificationHash: f.envelope.evidence.qualificationHash,
      payloadHash: f.envelope.task.payloadHash,
      referenceJoinHash: reference.hash,
      comparisonHash: comparison.hash,
      provider: "stripe",
      mode: "test",
      stripeAccountId: comparison.binding.stripeAccountId,
      runtimeBindingId: comparison.binding.runtimeBindingId,
      subjectId: f.effectId,
    },
  };
  let calls = 0,
    holds = 0,
    held = false;
  const state = {
    qualification: q,
    onRead: (_n: number) => {},
    onAssert: () => {},
    cleanupFailure: false,
    committedWhileHeld: 0,
  };
  const host: OfflineCheckoutPaidHost = {
    adapter: {
      identity: f.envelope.operations.adapterIdentity,
      hold(_r, commit) {
        holds++;
        held = true;
        try {
          commit();
          assert(held);
          assert.throws(() => a.database.requireTransaction());
          const observer = new DatabaseSync(f.path);
          try {
            assert.equal(
              observer
                .prepare(
                  "SELECT COUNT(*) AS n FROM integration_offline_checkout_paid",
                )
                .get()!.n,
              1,
            );
            state.committedWhileHeld++;
          } finally {
            observer.close();
          }
        } finally {
          held = false;
        }
        if (state.cleanupFailure)
          throw Error("synthetic lost response after commit");
      },
      assertHeld() {
        assert(held);
        state.onAssert();
      },
    },
    readCurrent() {
      state.onRead(++calls);
      return state.qualification;
    },
  };
  const coordinator = new Coordinator(
    a.database,
    a.identity,
    a.platform,
    a.billing,
    a.integration.checkouts,
    host,
  );
  return Object.assign(f, {
    comparison,
    reference,
    pairs,
    roster,
    approvals,
    state,
    host,
    coordinator,
    hostCalls: () => calls,
    holds: () => holds,
  });
}
type F = Awaited<ReturnType<typeof ready>>;
function execute(f: F) {
  return f.coordinator.execute(
    f.reviewer,
    f.executor,
    f.envelope,
    f.approvals,
    f.manifest,
  );
}
function recover(f: F) {
  return f.app.database.transaction(() =>
    f.coordinator.recoverRetainedInTransaction(
      f.executor,
      f.reviewer,
      f.envelope,
    ),
  );
}
function snapshot(f: F) {
  const db = new DatabaseSync(f.path);
  try {
    return canonical(
      db
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all()
        .map((r) => [
          r.name,
          db.prepare(`SELECT * FROM ${r.name} ORDER BY rowid`).all(),
        ]),
    );
  } finally {
    db.close();
  }
}
function applied(f: F) {
  return (
    f.app.database
      .owned("integration")
      .get("SELECT COUNT(*) n FROM integration_offline_checkout_paid")!.n === 1
  );
}
function resign(f: F) {
  for (const [i, a] of f.approvals.entries()) {
    a.binding = offlineTaskBinding(f.envelope);
    a.signature = sign(
      null,
      Buffer.from(offlineTaskApprovalMessage(f.envelope, a.signerId, a.role)),
      f.pairs[i]!.privateKey,
    ).toString("base64");
  }
  (f.state.qualification as any).envelopeBinding = offlineTaskBinding(
    f.envelope,
  );
}
for (const [region, currency] of [
  ["CA", "CAD"],
  ["CA", "USD"],
  ["US", "USD"],
] as const)
  for (const reports of [false, true])
    test(`${region}/${currency} reports=${reports}: signed private paid checkout commits exactly once and recovers without host`, async (t) => {
      const f = await ready(t, region, currency, reports),
        result = execute(f);
      assert.equal(result.status, "committed");
      assert.equal(f.state.committedWhileHeld, 1);
      assert(Object.isFrozen(result));
      const receipts = f.app.database.transaction(() =>
        f.app.platform.offline
          .readInTransaction()!
          .state.sessions.flatMap((s) =>
            s.history.flatMap((h) => (h.receipt ? [h.receipt] : [])),
          ),
      );
      assert.equal(receipts.length, 1);
      assert.equal(receipts[0]!.resultHash, result.resultHash);
      const calls = f.hostCalls(),
        before = snapshot(f),
        retained = recover(f);
      assert.equal(retained.resultHash, result.resultHash);
      assert.equal(f.hostCalls(), calls);
      assert.equal(snapshot(f), before);
      assert.equal(f.calls(), 1);
      assert.throws(() => execute(f));
      assert.equal(snapshot(f), before);
    });
test("unconfigured coordinator refuses without host or candidate effects", async (t) => {
  const f = await ready(t),
    a = f.app,
    before = snapshot(f),
    c = new Coordinator(
      a.database,
      a.identity,
      a.platform,
      a.billing,
      a.integration.checkouts,
    );
  assert.throws(() =>
    c.execute(f.reviewer, f.executor, f.envelope, f.approvals, f.manifest),
  );
  assert.equal(f.holds(), 0);
  assert.equal(snapshot(f), before);
});
test("postCOMMIT adapter failure returns recovery-required and never retries owner", async (t) => {
  const f = await ready(t);
  f.state.cleanupFailure = true;
  const result = execute(f);
  assert.equal(result.status, "committed-recovery-required");
  assert.equal(recover(f).resultHash, result.resultHash);
  const before = snapshot(f);
  assert.throws(() => execute(f));
  assert.equal(snapshot(f), before);
});
test("actual restart recovery requires no private file or host and conserves rows", async (t) => {
  const f = await ready(t),
    result = execute(f);
  fs.unlinkSync(f.file);
  f.app.close();
  const a = new Application(f.path, "CA", { eventReports: false });
  f.app = a;
  const c = new Coordinator(
    a.database,
    a.identity,
    a.platform,
    a.billing,
    a.integration.checkouts,
  );
  const before = snapshot(f),
    n = a.database.owned("integration").get("SELECT total_changes() AS n")!.n;
  const recovered = a.database.transaction(() =>
    c.recoverRetainedInTransaction(f.executor, f.reviewer, f.envelope),
  );
  assert.equal(recovered.resultHash, result.resultHash);
  assert.equal(
    a.database.owned("integration").get("SELECT total_changes() AS n")!.n,
    n,
  );
  assert.equal(snapshot(f), before);
});
for (const key of [
  "setHash",
  "qualificationHash",
  "payloadHash",
  "referenceJoinHash",
  "comparisonHash",
  "stripeAccountId",
  "runtimeBindingId",
  "subjectId",
] as const)
  test(`late qualified ${key} drift rolls back owner and Platform receipt`, async (t) => {
    const f = await ready(t),
      before = snapshot(f);
    let reached = false;
    f.state.onRead = () => {
      if (applied(f)) {
        reached = true;
        (f.state.qualification.evidence as any)[key] = digest("changed");
      }
    };
    assert.throws(() => execute(f));
    assert(reached);
    assert.equal(snapshot(f), before);
  });
for (const mode of [
  "expired",
  "clock",
  "roster",
  "trust",
  "same-person",
  "identity-reassignment",
  "role",
  "raw-write",
] as const)
  test(`late ${mode} refusal rolls back actual tentative native effect`, async (t) => {
    const f = await ready(t),
      before = snapshot(f);
    let reached = false;
    f.state.onRead = () => {
      if (!applied(f)) return;
      reached = true;
      const q = f.state.qualification as any;
      if (mode === "expired") q.now = f.envelope.expiresAt;
      else if (mode === "clock") q.now = f.envelope.preparedAt;
      else if (mode === "roster") q.roster = q.roster.slice(1);
      else if (mode === "trust") q.trust.revision++;
      else if (mode === "same-person")
        q.associations.executor.personId = q.associations.preparer.personId;
      else if (mode === "identity-reassignment")
        q.associations.executor.personId = "changed-independent-person";
      else if (mode === "role")
        f.app.database
          .owned("iam")
          .run("UPDATE iam_users SET role='support' WHERE id=?", f.executor.id);
      else
        f.app.database
          .owned("integration")
          .run(
            "UPDATE integration_effects SET error=error WHERE id=?",
            f.effectId,
          );
    };
    assert.throws(() => execute(f));
    assert(reached);
    assert.equal(snapshot(f), before);
  });
test("raw payload hash is not comparator input-domain hash", async (t) => {
  const f = await ready(t),
    before = snapshot(f);
  assert.notEqual(f.comparison.inputHash, f.envelope.task.payloadHash);
  f.envelope.task.payloadHash = f.comparison.inputHash;
  (f.state.qualification.evidence as any).payloadHash = f.comparison.inputHash;
  resign(f);
  assert.throws(() => execute(f));
  assert.equal(snapshot(f), before);
});
test("signature change and cross-duty signer cannot import", async (t) => {
  const f = await ready(t),
    before = snapshot(f);
  f.approvals[0]!.signature = Buffer.alloc(64).toString("base64");
  assert.throws(() => execute(f));
  assert.equal(snapshot(f), before);
});
test("swallowed reentry before guard validation poisons outer attempt", async (t) => {
  const f = await ready(t),
    before = snapshot(f);
  let reached = false;
  f.state.onRead = () => {
    if (!reached) {
      reached = true;
      assert.throws(() => f.coordinator.execute(null, null, null, null, null));
    }
  };
  assert.throws(() => execute(f));
  assert(reached);
  assert.equal(snapshot(f), before);
});
test("caller data is detached before hooks; malformed proxy/getter/async inputs invoke no traps or hosts", async (t) => {
  const f = await ready(t),
    before = snapshot(f);
  let traps = 0;
  const trap = () => {
      traps++;
      throw Error("trap");
    },
    p = new Proxy(
      {},
      {
        get: trap,
        ownKeys: trap,
        getPrototypeOf: trap,
        getOwnPropertyDescriptor: trap,
      },
    ),
    r = Proxy.revocable({}, {});
  r.revoke();
  const getter = Object.defineProperty({}, "id", {
    enumerable: true,
    get: trap,
  });
  for (const bad of [p, r.proxy, getter, Promise.resolve(null)])
    for (const position of [0, 1, 2, 3, 4]) {
      const args: any[] = [
        f.reviewer,
        f.executor,
        f.envelope,
        f.approvals,
        f.manifest,
      ];
      args[position] = bad;
      assert.throws(() =>
        f.coordinator.execute(args[0], args[1], args[2], args[3], args[4]),
      );
    }
  assert.equal(traps, 0);
  assert.equal(f.holds(), 0);
  assert.equal(snapshot(f), before);
});
test("private byte mutation under host lease refuses and conserves rows", async (t) => {
  const f = await ready(t),
    before = snapshot(f);
  f.state.onRead = () => {
    fs.writeFileSync(f.file, Buffer.alloc(f.bytes.length, 0x20));
  };
  assert.throws(() => execute(f));
  assert.equal(snapshot(f), before);
});
const helpers = [
  [IntegrationOfflineCheckoutPaid.prototype, "applyInTransaction"],
  [IntegrationOfflineCheckoutPaid.prototype, "recoverRetainedInTransaction"],
  [RestoreOfflineCheckoutPrivateEvidence.prototype, "read"],
  [RestoreOfflineCheckoutReferenceJoin.prototype, "getInTransaction"],
  [RestoreOfflineCheckoutNativeJoin.prototype, "getInTransaction"],
  [BillingOfflineCheckoutReferenceReview.prototype, "getInTransaction"],
  [IntegrationOfflineCheckoutReferenceReview.prototype, "getInTransaction"],
  [RestoreOfflineNativePhase.prototype, "reviewInTransaction"],
  [RestoreOfflineNativePhase.prototype, "reviewCapturedCheckoutInTransaction"],
  [RestoreOfflineCommitRecoveryReader.prototype, "getInTransaction"],
  [
    RestoreOfflineCommitRecoveryReader.prototype,
    "getCapturedCheckoutInTransaction",
  ],
  [RestoreOfflineStorage.prototype, "readInTransaction"],
  [RestoreActivation.prototype, "offlineReleaseHistoryInTransaction"],
  [RestoreOfflineCommitGuard.prototype, "execute"],
  [RestoreOfflineCommitGuard.prototype, "executeCapturedCheckout"],
] as const;
for (const [prototype, method] of helpers)
  for (const stage of ["early", "late"] as const)
    test(`${prototype.constructor.name}.${method} replacement ${stage} refuses before hook`, async (t) => {
      const f = await ready(t),
        before = snapshot(f),
        d = Object.getOwnPropertyDescriptor(prototype, method)!;
      let hooks = 0,
        reached = false;
      f.state.onRead = () => {
        if (stage === "late" && !applied(f)) return;
        reached = true;
        Object.defineProperty(prototype, method, {
          ...d,
          value: () => {
            hooks++;
            return {};
          },
        });
      };
      try {
        assert.throws(() => execute(f));
      } finally {
        Object.defineProperty(prototype, method, d);
      }
      assert(reached);
      assert.equal(hooks, 0);
      assert.equal(snapshot(f), before);
    });
for (const key of ["offline", "restore"] as const)
  test(`actual Platform.${key} link replacement cannot execute traps`, async (t) => {
    const f = await ready(t),
      a = f.app,
      before = snapshot(f),
      old = a.platform[key];
    let traps = 0;
    f.state.onRead = () => {
      (a.platform as any)[key] = new Proxy(
        {},
        {
          get() {
            traps++;
            throw Error("trap");
          },
          getPrototypeOf() {
            traps++;
            throw Error("trap");
          },
        },
      );
    };
    try {
      assert.throws(() => execute(f));
    } finally {
      (a.platform as any)[key] = old;
    }
    assert.equal(traps, 0);
    assert.equal(snapshot(f), before);
  });

test("capture-shaped manifest, genuine capture and cloned capture cannot substitute for private read", async (t) => {
  const f = await ready(t),
    h = f.read();
  h.complete();
  const capture = f.app.database.transaction(() =>
    h.captureForApplicationInTransaction(f.executor),
  );
  const before = snapshot(f);
  for (const input of [
    capture,
    structuredClone(capture),
    { ...capture, captureHash: digest("forged") },
  ])
    assert.throws(() =>
      f.coordinator.execute(
        f.reviewer,
        f.executor,
        f.envelope,
        f.approvals,
        input,
      ),
    );
  assert.equal(f.holds(), 0);
  assert.equal(snapshot(f), before);
});

test("outer caller-held writer refuses before host callback", async (t) => {
  const f = await ready(t),
    before = snapshot(f);
  assert.throws(() => f.app.database.transaction(() => execute(f)));
  assert.equal(f.holds(), 0);
  assert.equal(snapshot(f), before);
});

for (const component of [
  "adapter",
  "readCurrent",
  "hold",
  "assertHeld",
] as const)
  test(`asynchronous ${component} refuses during static configuration with no hook calls`, async (t) => {
    const f = await ready(t),
      a = f.app;
    let called = 0;
    const asyncHook = async () => {
      called++;
    };
    const host: any = { ...f.host, adapter: { ...f.host.adapter } };
    if (component === "adapter") host.adapter = Promise.resolve(host.adapter);
    else if (component === "readCurrent") host.readCurrent = asyncHook;
    else host.adapter[component] = asyncHook;
    assert.throws(
      () =>
        new Coordinator(
          a.database,
          a.identity,
          a.platform,
          a.billing,
          a.integration.checkouts,
          host,
        ),
    );
    assert.equal(called, 0);
    assert.equal(f.holds(), 0);
  });

test("thenable qualification is rejected without invoking then getter", async (t) => {
  const f = await ready(t),
    before = snapshot(f);
  let traps = 0;
  (f.state as any).qualification = Object.defineProperty({}, "then", {
    enumerable: true,
    get() {
      traps++;
      throw Error("then getter");
    },
  });
  assert.throws(() => execute(f));
  assert.equal(traps, 0);
  assert.equal(snapshot(f), before);
});

for (const key of ["offline", "restore"] as const)
  test(`foreign native Platform.${key} with real class/store is rejected before host`, async (t) => {
    const f = await ready(t),
      other = await ready(t),
      a = f.app,
      old = a.platform[key];
    (a.platform as any)[key] = other.app.platform[key];
    try {
      assert.throws(
        () =>
          new Coordinator(
            a.database,
            a.identity,
            a.platform,
            a.billing,
            a.integration.checkouts,
            f.host,
          ),
      );
    } finally {
      (a.platform as any)[key] = old;
    }
    assert.equal(f.holds(), 0);
  });

test("current finance role loss refuses before any qualification read", async (t) => {
  const f = await ready(t);
  f.app.database.transaction(() =>
    f.app.database
      .owned("iam")
      .run("UPDATE iam_users SET role='support' WHERE id=?", f.executor.id),
  );
  const before = snapshot(f);
  assert.throws(() => execute(f));
  assert.equal(f.hostCalls(), 0);
  assert.equal(snapshot(f), before);
});

test("retained recovery refuses replaced helper before result and makes zero host calls", async (t) => {
  const f = await ready(t);
  execute(f);
  const before = snapshot(f),
    calls = f.hostCalls(),
    p = IntegrationOfflineCheckoutPaid.prototype,
    d = Object.getOwnPropertyDescriptor(p, "recoverRetainedInTransaction")!;
  let hooks = 0;
  Object.defineProperty(p, "recoverRetainedInTransaction", {
    ...d,
    value: () => {
      hooks++;
      return { resultHash: digest("forged") };
    },
  });
  try {
    assert.throws(() => recover(f));
  } finally {
    Object.defineProperty(p, "recoverRetainedInTransaction", d);
  }
  assert.equal(hooks, 0);
  assert.equal(f.hostCalls(), calls);
  assert.equal(snapshot(f), before);
});

test("signed native-only state hash cannot replace enhanced reference state", async (t) => {
  const f = await ready(t),
    before = snapshot(f);
  f.envelope.task.expectedStateHash = f.comparison.nativeHash;
  (f.state.qualification.evidence as any).referenceJoinHash =
    f.comparison.nativeHash;
  resign(f);
  assert.throws(() => execute(f));
  assert.equal(snapshot(f), before);
});

test("retained recovery requires the exact original envelope and principal order without host qualification", async (t) => {
  const f = await ready(t);
  execute(f);
  const before = snapshot(f),
    calls = f.hostCalls();
  const altered = structuredClone(f.envelope);
  altered.task.payloadHash = digest("not the original bytes");
  assert.throws(() =>
    f.app.database.transaction(() =>
      f.coordinator.recoverRetainedInTransaction(
        f.executor,
        f.reviewer,
        altered,
      ),
    ),
  );
  assert.throws(() =>
    f.app.database.transaction(() =>
      f.coordinator.recoverRetainedInTransaction(
        f.reviewer,
        f.executor,
        f.envelope,
      ),
    ),
  );
  assert.equal(f.hostCalls(), calls);
  assert.equal(snapshot(f), before);
});

test("retained recovery checks current executor authority and does not use old capture as a permit", async (t) => {
  const f = await ready(t);
  execute(f);
  f.app.database.transaction(() =>
    f.app.database
      .owned("iam")
      .run("UPDATE iam_users SET role='support' WHERE id=?", f.executor.id),
  );
  const before = snapshot(f),
    calls = f.hostCalls();
  assert.throws(() => recover(f));
  assert.equal(f.hostCalls(), calls);
  assert.equal(snapshot(f), before);
});

for (const stage of ["apply", "recover"] as const)
  for (const point of ["early", "final"] as const)
    for (const selfRemoving of [false, true])
      test(`coordinator ${stage} refuses ${point} shared-reader ${selfRemoving ? "self-removing" : "persistent"} offline hook before invocation`, async (t) => {
        const f = await ready(t);
        if (stage === "recover") execute(f);
        const before = snapshot(f),
          originalStat = fs.lstatSync;
        const target = f.app.platform.offline,
          key = "readInTransaction",
          descriptor = Object.getOwnPropertyDescriptor(target, key),
          original = target.readInTransaction;
        let reads = 0,
          injected = false,
          hits = 0;
        Object.defineProperty(fs, "lstatSync", {
          configurable: true,
          writable: true,
          value: (...args: any[]) => {
            const stack = new Error().stack ?? "";
            if (
              stack.includes("RestoreOfflineCommitRecoveryReader.") &&
              stack.includes("RestoreOfflineCheckoutPaidCoordinator.") &&
              !stack.includes("IntegrationOfflineCheckoutPaid.") &&
              !stack.includes("captureRestoreCandidateInTransaction") &&
              ++reads === (point === "early" ? 1 : 9)
            ) {
              injected = true;
              Object.defineProperty(target, key, {
                configurable: true,
                writable: true,
                value: function (this: typeof target, ...parameters: any[]) {
                  hits++;
                  if (selfRemoving) {
                    if (descriptor)
                      Object.defineProperty(target, key, descriptor);
                    else Reflect.deleteProperty(target, key);
                  }
                  return original.apply(this, parameters as []);
                },
              });
            }
            return (originalStat as any)(...args);
          },
        });
        syncBuiltinESMExports();
        try {
          assert.throws(() => (stage === "apply" ? execute(f) : recover(f)));
        } finally {
          Object.defineProperty(fs, "lstatSync", {
            configurable: true,
            writable: true,
            value: originalStat,
          });
          syncBuiltinESMExports();
          if (descriptor) Object.defineProperty(target, key, descriptor);
          else Reflect.deleteProperty(target, key);
        }
        assert.equal(
          injected,
          true,
          "the coordinator's own receipt reader reached the filesystem boundary",
        );
        assert.equal(hits, 0, "a substituted owner hook must never execute");
        assert.equal(snapshot(f), before);
        if (stage === "recover")
          assert.equal(recover(f).status, "native-owner-application-only");
      });

for (const point of ["early", "final"] as const)
  for (const selfRemoving of [false, true])
    test(`coordinator commit phase refuses ${point} ${selfRemoving ? "self-removing" : "persistent"} offline hook before invocation`, async (t) => {
      const f = await ready(t),
        before = snapshot(f),
        stat = fs.lstatSync,
        target = f.app.platform.offline,
        key = "readInTransaction",
        descriptor = Object.getOwnPropertyDescriptor(target, key),
        original = target.readInTransaction;
      let reads = 0,
        reached = false,
        hits = 0;
      Object.defineProperty(fs, "lstatSync", {
        configurable: true,
        writable: true,
        value: (...args: any[]) => {
          const limit = Error.stackTraceLimit;
          let stack: string;
          try {
            Error.stackTraceLimit = 50;
            stack = new Error().stack ?? "";
          } finally {
            Error.stackTraceLimit = limit;
          }
          if (
            stack.includes("RestoreOfflineNativePhase.") &&
            stack.includes("RestoreOfflineCommitGuard.") &&
            !stack.includes("RestoreOfflineCheckoutPrivateEvidence.") &&
            !stack.includes("IntegrationOfflineCheckoutPaid.") &&
            !stack.includes("captureRestoreCandidateInTransaction") &&
            ++reads === (point === "early" ? 1 : 9)
          ) {
            reached = true;
            Object.defineProperty(target, key, {
              configurable: true,
              writable: true,
              value: function (this: typeof target, ...parameters: any[]) {
                hits++;
                if (selfRemoving) {
                  if (descriptor)
                    Object.defineProperty(target, key, descriptor);
                  else Reflect.deleteProperty(target, key);
                }
                return original.apply(this, parameters as []);
              },
            });
          }
          return Reflect.apply(stat, fs, args);
        },
      });
      syncBuiltinESMExports();
      try {
        assert.throws(() => execute(f));
      } finally {
        Object.defineProperty(fs, "lstatSync", { value: stat });
        syncBuiltinESMExports();
        if (descriptor) Object.defineProperty(target, key, descriptor);
        else Reflect.deleteProperty(target, key);
      }
      assert(reached);
      assert.equal(hits, 0);
      assert.equal(snapshot(f), before);
    });
for (const key of ["documents", "delivery"] as const)
  test(`coordinator constructor rejects Billing.${key} proxy before descriptor traps`, async (t) => {
    const f = await ready(t),
      a = f.app,
      before = snapshot(f),
      old = a.billing[key];
    let traps = 0;
    (a.billing as any)[key] = new Proxy(old, {
      getOwnPropertyDescriptor() {
        traps++;
        throw Error("constructor descriptor trap");
      },
      getPrototypeOf() {
        traps++;
        throw Error("constructor prototype trap");
      },
      ownKeys() {
        traps++;
        throw Error("constructor keys trap");
      },
    });
    try {
      assert.throws(
        () =>
          new Coordinator(
            a.database,
            a.identity,
            a.platform,
            a.billing,
            a.integration.checkouts,
            f.host,
          ),
      );
    } finally {
      (a.billing as any)[key] = old;
    }
    assert.equal(traps, 0);
    assert.equal(f.holds(), 0);
    assert.equal(snapshot(f), before);
  });
