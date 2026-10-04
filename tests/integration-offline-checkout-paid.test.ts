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
  RestoreOfflineCheckoutReferenceJoin as Join,
  isCapturedOfflineCheckoutReferenceJoin as captured,
} from "../src/server/restore-offline-checkout-reference-join.ts";

async function setup(
  t: TestContext,
  region: "CA" | "US" = "CA",
  currency: "CAD" | "USD" = "CAD",
  eventReports = true,
) {
  const f = fixture(t, { eventReports }, region, currency),
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
  const preparerId = f.app.identity.createUser(f.actor, "preparer", {
    name: "Independent finance preparer",
    email: "preparer@example.test",
    password: "synthetic-long-password",
    role: "finance",
    sites: [],
  }).id;
  const preparer = { id: preparerId, orgId: f.actor.orgId };
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
    preparer,
    hold,
    input,
    join,
    calls: () => calls,
  });
}

import { INTEGRATION_OFFLINE_CHECKOUT_PAID_INITIALIZE_DDL } from "../src/server/integration-offline-checkout-paid-schema.ts";
import { IntegrationOfflineCheckoutPaid } from "../src/server/integration-offline-checkout-paid.ts";
function operation(f: { app: Application }) {
  return new IntegrationOfflineCheckoutPaid(
    f.app.database,
    f.app.identity,
    f.app.billing,
    f.app.integration.checkouts,
  );
}
for (const [region, currency] of [
  ["CA", "CAD"],
  ["CA", "USD"],
  ["US", "USD"],
] as const)
  for (const reports of [false, true])
    test(`registered ${region}/${currency} reports=${reports}: actual schema22 and independent native preparation`, async (t) => {
      const f = await setup(t, region, currency, reports);
      // Root's registered DDL, explicitly initialized in fresh synthetic setup.
      f.app.database
        .owned("integration")
        .migrate(INTEGRATION_OFFLINE_CHECKOUT_PAID_INITIALIZE_DDL);
      f.hold();
      const c = compare(f.input());
      const before = f.app.database.transaction(() =>
        f.app.database.captureRestoreCandidateInTransaction(),
      );
      const prepared = f.app.database.transaction(() =>
        operation(f).prepareInTransaction(f.reviewer, f.preparer, c),
      );
      assert.equal(
        prepared.referenceJoinHash,
        f.app.database.transaction(
          () => f.join().getInTransaction(f.reviewer, c).hash,
        ),
      );
      assert.equal(prepared.expectedStateHash, prepared.referenceJoinHash);
      assert.equal(prepared.nativeIntent.paymentReference, "pi_synthetic");
      assert.equal(prepared.nativeIntent.sessionReference, "cs_test_synthetic");
      assert.deepEqual(
        f.app.database.transaction(() =>
          f.app.database.captureRestoreCandidateInTransaction(),
        ),
        before,
      );
      assert.equal(f.app.billing.totals(f.actor, f.invoiceId).paid, 0);
      assert.equal(
        f.app.integration.effect(f.actor, f.effectId).state,
        "unknown",
      );
      assert.equal(f.calls(), 1);
      f.app.close();
      f.app = new Application(f.path, region, { eventReports: reports });
      assert.deepEqual(
        f.app.database.transaction(() =>
          operation(f).prepareInTransaction(f.reviewer, f.preparer, c),
        ),
        prepared,
      );
    });

const code = { code: "OFFLINE_CHECKOUT_PAID" };
test("same writer, independent fresh finance principals and inert caller locators are required", async (t) => {
  const f = await setup(t);
  f.hold();
  const c = compare(f.input()),
    op = operation(f);
  assert.throws(() => op.prepareInTransaction(f.reviewer, f.preparer, c), {
    code: "TRANSACTION",
  });
  assert.throws(
    () =>
      f.app.database.transaction(() =>
        op.prepareInTransaction(f.reviewer, f.reviewer, c),
      ),
    code,
  );
  let hits = 0;
  const hook = () => {
    hits++;
    throw Error("PRIVATE callback");
  };
  const proxy = new Proxy(
    {},
    {
      get: hook,
      ownKeys: hook,
      getPrototypeOf: hook,
      getOwnPropertyDescriptor: hook,
    },
  );
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  for (const bad of [
    proxy,
    revoked.proxy,
    {
      get id() {
        return hook();
      },
      orgId: f.actor.orgId,
    },
    { ...f.reviewer, role: "admin" },
  ])
    assert.throws(
      () =>
        f.app.database.transaction(() =>
          op.prepareInTransaction(bad, f.preparer, c),
        ),
      code,
    );
  for (const bad of [proxy, revoked.proxy, structuredClone(c), { ...c }])
    assert.throws(
      () =>
        f.app.database.transaction(() =>
          op.prepareInTransaction(f.reviewer, f.preparer, bad),
        ),
      code,
    );
  assert.equal(hits, 0);
});
for (const who of ["reviewer", "preparer"] as const)
  for (const [name, sql, expected] of [
    ["revoked", "UPDATE iam_users SET active=0 WHERE id=?", "FORBIDDEN"],
    ["sales", "UPDATE iam_users SET role='sales' WHERE id=?", "FORBIDDEN"],
    [
      "password",
      "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
      "PASSWORD_CHANGE_REQUIRED",
    ],
    [
      "foreign",
      "UPDATE iam_users SET org_id='foreign' WHERE id=?",
      "FORBIDDEN",
    ],
  ] as const)
    test(`current ${who} ${name} refuses and uncommitted revocation rolls back`, async (t) => {
      const f = await setup(t);
      f.hold();
      const c = compare(f.input()),
        op = operation(f);
      const before = f.app.database.transaction(() =>
        op.prepareInTransaction(f.reviewer, f.preparer, c),
      );
      assert.throws(
        () =>
          f.app.database.transaction(() => {
            f.app.database.owned("iam").run(sql, f[who].id);
            assert.throws(
              () => op.prepareInTransaction(f.reviewer, f.preparer, c),
              { code: expected },
            );
            throw Error("rollback-authority");
          }),
        /rollback-authority/,
      );
      assert.deepEqual(
        f.app.database.transaction(() =>
          op.prepareInTransaction(f.reviewer, f.preparer, c),
        ),
        before,
      );
    });
test("new provenance table is STRICT and append-only including conflict replacement", async (t) => {
  const f = await setup(t);
  const s = f.app.database.owned("integration");
  const args = [
    f.effectId,
    f.actor.orgId,
    "synthetic-request",
    digest("binding"),
    "{}",
    digest("{}"),
  ];
  s.run(
    "INSERT INTO integration_offline_checkout_paid VALUES(?,?,?,?,?,?)",
    ...args,
  );
  assert.throws(
    () => s.run("UPDATE integration_offline_checkout_paid SET record='[]'"),
    /append-only/,
  );
  assert.throws(
    () => s.run("DELETE FROM integration_offline_checkout_paid"),
    /append-only/,
  );
  assert.throws(
    () =>
      s.run(
        "INSERT OR REPLACE INTO integration_offline_checkout_paid VALUES(?,?,?,?,?,?)",
        ...args,
      ),
    /append-only/,
  );
  assert.throws(
    () =>
      s.run(
        "INSERT INTO integration_offline_checkout_paid VALUES(?,?,?,?,?,?)",
        "new",
        f.actor.orgId,
        "new",
        "binding",
        Buffer.from("{}"),
        digest("{}"),
      ),
    /TEXT|text/,
  );
  assert.equal(
    s.get("SELECT COUNT(*) AS n FROM integration_offline_checkout_paid")!.n,
    1,
  );
});
test("global extra effects, active lease, NUL/UTF8 bytes refuse before any candidate pathname read", async (t) => {
  const f = await setup(t);
  f.hold();
  const c = compare(f.input()),
    op = operation(f),
    s = f.app.database.owned("integration"),
    old = fs.lstatSync;
  for (const mode of ["extra", "lease", "nul", "utf8", "invalid"]) {
    let reads = 0;
    try {
      (fs as { lstatSync: typeof fs.lstatSync }).lstatSync = ((
        ...args: Parameters<typeof fs.lstatSync>
      ) => {
        reads++;
        return old(...args);
      }) as typeof fs.lstatSync;
      syncBuiltinESMExports();
      assert.throws(
        () =>
          f.app.database.transaction(() => {
            if (mode === "extra")
              s.run(
                "INSERT INTO integration_effects(id,org_id,account_id,provider,kind,reference,payload,state,external_ref,result,created_at,residency_version,started_at,error) SELECT 'other',org_id,account_id,provider,kind,'other',payload,state,external_ref,result,created_at,residency_version,started_at,error FROM integration_effects WHERE id=?",
                f.effectId,
              );
            if (mode === "lease")
              s.run(
                "UPDATE integration_operation_leases SET token='active',started_at=1 WHERE effect_id=?",
                f.effectId,
              );
            if (mode === "nul" || mode === "utf8")
              s.run(
                "UPDATE integration_effects SET error=? WHERE id=?",
                (mode === "nul" ? "\0" : "€").repeat(65537),
                f.effectId,
              );
            if (mode === "invalid")
              s.run(
                "UPDATE integration_effects SET error=CAST(X'80' AS TEXT) WHERE id=?",
                f.effectId,
              );
            assert.throws(
              () => op.prepareInTransaction(f.reviewer, f.preparer, c),
              {
                code:
                  mode === "extra" || mode === "lease"
                    ? "OFFLINE_CHECKOUT_PAID_PROFILE"
                    : "OFFLINE_CHECKOUT_PAID",
              },
            );
            assert.equal(reads, 0);
            throw Error("rollback-bound");
          }),
        /rollback-bound/,
      );
    } finally {
      (fs as { lstatSync: typeof fs.lstatSync }).lstatSync = old;
      syncBuiltinESMExports();
    }
  }
});
test("owner method and graph accessors refuse before hooks execute", async (t) => {
  const f = await setup(t);
  f.hold();
  const c = compare(f.input()),
    op = operation(f);
  let hits = 0;
  const hook = () => {
    hits++;
    throw Error("PRIVATE hook");
  };
  for (const [obj, key] of [
    [f.app.database, "requireTransaction"],
    [f.app.billing, "verifiedPayment"],
    [f.app.platform, "audit"],
    [f.app.platform.offline, "transitionInTransaction"],
    [f.app.identity, "workerActor"],
    [f.app.platform, "offline"],
  ] as const) {
    const d = Object.getOwnPropertyDescriptor(obj, key);
    try {
      Object.defineProperty(obj, key, { get: hook, configurable: true });
      assert.throws(() =>
        f.app.database.transaction(() =>
          op.prepareInTransaction(f.reviewer, f.preparer, c),
        ),
      );
    } finally {
      if (d) Object.defineProperty(obj, key, d);
      else Reflect.deleteProperty(obj, key);
    }
  }
  assert.equal(hits, 0);
});

import { parseOfflineRecoveryGeneration } from "../src/server/restore-offline-phase.ts";
import {
  parseOfflineTaskEnvelope,
  offlineTaskBinding,
} from "../src/server/restore-offline-envelope.ts";
import { RestoreOfflineNativePhase } from "../src/server/restore-offline-native-phase.ts";
import { SCHEMA_VERSION } from "../src/server/schema.ts";

// Real Platform generation/phase and byte-exact synthetic evidence. The external
// IDs below are deliberately NOT native principal IDs or qualified authority.
async function opened(
  t: TestContext,
  region: "CA" | "US" = "CA",
  currency: "CAD" | "USD" = "CAD",
  reports = true,
) {
  const f = await setup(t, region, currency, reports);
  f.hold();
  f.app.database.transaction(() => {
    const { logicalHash: _logical, ...candidate } =
      f.app.database.captureRestoreCandidateInTransaction();
    const generation = parseOfflineRecoveryGeneration({
      version: 1,
      schemaVersion: SCHEMA_VERSION,
      instanceId: digest("synthetic-paid-instance"),
      ...candidate,
      organizations: candidate.organizations.map((o) => ({
        id: o.id,
        currency: o.currency,
      })),
    });
    f.app.platform.offline.createGenerationInTransaction(generation, null, []);
    let state = f.app.platform.offline.readInTransaction()!;
    f.app.platform.offline.transitionInTransaction(
      generation,
      state.anchor,
      { kind: "isolate", sessionId: "synthetic-paid-session" },
      [],
    );
    state = f.app.platform.offline.readInTransaction()!;
    f.app.platform.offline.transitionInTransaction(
      generation,
      state.anchor,
      { kind: "open" },
      [],
    );
  });
  const input = f.input(),
    comparison = compare(input);
  // Private parser requires deterministic code-unit property order; the payload
  // hash separately retains the existing core.canonical convention.
  const privateJSON = (v: any): string =>
    v === null || typeof v !== "object"
      ? JSON.stringify(v)
      : Array.isArray(v)
        ? `[${v.map(privateJSON).join(",")}]`
        : `{${Object.keys(v)
            .sort()
            .map((k) => `${JSON.stringify(k)}:${privateJSON(v[k])}`)
            .join(",")}}`;
  const raw = Buffer.from(privateJSON(input)),
    item = {
      reference: "synthetic-paid-evidence",
      sha256: digest(raw),
      bytes: raw.length,
    };
  const envelope = f.app.database.transaction(() => {
    const retained = f.app.platform.offline.readInTransaction()!,
      {
        version: _v,
        schemaVersion: _s,
        ...recovery
      } = retained.state.generation;
    const session = retained.state.sessions.at(-1)!,
      candidate = f.app.database.captureRestoreCandidateInTransaction(),
      file = fs.lstatSync(f.path, { bigint: true });
    const h = (s: string) => digest("synthetic-paid:" + s);
    return parseOfflineTaskEnvelope({
      version: 1,
      purpose: "distributor-restore-offline-task-v1",
      requestId: "synthetic-paid-import",
      preparedBy: "external-preparer-unqualified",
      executorId: "external-executor-unqualified",
      preparedAt: "2000-01-01T00:00:00.000Z",
      expiresAt: "2000-01-01T00:10:00.000Z",
      recovery,
      session: {
        id: session.id,
        revision: session.revision,
        lineageHash: session.lineageHash,
      },
      candidate: {
        logicalHash: candidate.logicalHash,
        file: { dev: Number(file.dev), ino: Number(file.ino) },
      },
      source: {
        identity: "synthetic-source",
        baseline: {
          logicalHash: h("baseline"),
          durableCursor: "start",
          auditSequence: 0,
        },
        end: { logicalHash: h("end"), durableCursor: "end", auditSequence: 1 },
        intervalEvidenceHash: h("interval"),
      },
      task: {
        owner: "integration",
        name: "integration.checkout-paid.import",
        version: 1,
        orgId: f.actor.orgId,
        siteIds: [],
        subjectId: f.effectId,
        expectedRevision: 0,
        expectedStateHash: f.join().getInTransaction(f.reviewer, comparison)
          .hash,
        payloadHash: digest(canonical(input)),
        priorClaim: null,
      },
      evidence: {
        setHash: digest(canonical([item])),
        items: [item],
        qualificationHash: h("unqualified"),
      },
      operations: {
        authorityId: "unqualified-operations",
        revision: 1,
        adapterIdentity: "unqualified",
        fenceTokenHash: h("fence"),
        observationHash: h("observation"),
      },
      trust: {
        authorityId: "unqualified-trust",
        revision: 1,
        registryHash: h("registry"),
      },
    });
  });
  return { f, input, comparison, envelope, raw };
}
test("real open phase binds the original raw-input payload hash, distinct from derived comparison/native intent", async (t) => {
  const { f, input, comparison, envelope } = await opened(t);
  const before = f.app.database.transaction(() =>
    f.app.database.captureRestoreCandidateInTransaction(),
  );
  f.app.database.transaction(() => {
    const prepared = operation(f).prepareInTransaction(
      f.reviewer,
      f.preparer,
      comparison,
    );
    assert.equal(envelope.task.payloadHash, digest(canonical(input)));
    assert.notEqual(envelope.task.payloadHash, comparison.inputHash);
    assert.notEqual(
      envelope.task.payloadHash,
      digest(canonical(prepared.nativeIntent)),
    );
    assert.equal(envelope.task.expectedStateHash, prepared.referenceJoinHash);
    const phase = new RestoreOfflineNativePhase(
      f.app.database,
      f.app.platform,
    ).reviewInTransaction(envelope);
    assert.equal(phase.envelopeBinding, offlineTaskBinding(envelope));
    assert.equal(phase.candidateHash, before.logicalHash);
    assert.equal(phase.status, "native-phase-consistency-only");
    assert.deepEqual(
      f.app.database.captureRestoreCandidateInTransaction(),
      before,
    );
  });
  assert.notEqual(envelope.preparedBy, f.preparer.id);
  assert.notEqual(envelope.executorId, f.reviewer.id);
  assert.equal(f.calls(), 1);
});

test("caught synchronous candidate-read reentry poisons preparation and a fresh call still succeeds", async (t) => {
  const f = await setup(t);
  f.hold();
  const c = compare(f.input()),
    op = operation(f);
  const original = fs.lstatSync;
  let entered = false,
    caught = false;
  Object.defineProperty(fs, "lstatSync", {
    value: ((...args: any[]) => {
      if (!entered) {
        entered = true;
        assert.throws(
          () => op.prepareInTransaction(f.reviewer, f.preparer, c),
          code,
        );
        caught = true;
      }
      return (original as any)(...args);
    }) as typeof fs.lstatSync,
    configurable: true,
    writable: true,
  });
  syncBuiltinESMExports();
  try {
    assert.throws(
      () =>
        f.app.database.transaction(() =>
          op.prepareInTransaction(f.reviewer, f.preparer, c),
        ),
      code,
    );
  } finally {
    Object.defineProperty(fs, "lstatSync", {
      value: original,
      configurable: true,
      writable: true,
    });
    syncBuiltinESMExports();
  }
  assert.equal(caught, true);
  assert.equal(
    f.app.database.transaction(() =>
      op.prepareInTransaction(f.reviewer, f.preparer, c),
    ).nativeIntent.effectId,
    f.effectId,
  );
});

test("readonly recovery refuses absent and malformed retained provenance without materializing private errors", async (t) => {
  const { f, envelope } = await opened(t),
    op = operation(f),
    integration = f.app.database.owned("integration");
  assert.throws(
    () => op.recoverRetainedInTransaction(f.reviewer, f.preparer, envelope),
    {
      code: "TRANSACTION",
    },
  );
  assert.throws(
    () =>
      f.app.database.transaction(() =>
        op.recoverRetainedInTransaction(f.reviewer, f.preparer, envelope),
      ),
    { code: "OFFLINE_CHECKOUT_PAID" },
  );
  const before = f.app.database.transaction(() =>
    f.app.database.captureRestoreCandidateInTransaction(),
  );
  for (const raw of [
    '{"PRIVATE-secret":1,"PRIVATE-secret":2}',
    '{"PRIVATE-secret":',
    " ".repeat(65530),
    JSON.stringify({ "PRIVATE-secret": "\u0000" }),
    "[".repeat(25) + "0" + "]".repeat(25),
  ]) {
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          integration.run(
            "INSERT INTO integration_offline_checkout_paid VALUES(?,?,?,?,?,?)",
            f.effectId,
            f.actor.orgId,
            envelope.requestId,
            offlineTaskBinding(envelope),
            raw,
            digest(raw),
          );
          const changes = integration.get("SELECT total_changes() n")!.n;
          assert.throws(
            () =>
              op.recoverRetainedInTransaction(f.reviewer, f.preparer, envelope),
            (e: any) => {
              assert.equal(e.code, "OFFLINE_CHECKOUT_PAID");
              assert.equal(
                e.message,
                "Fixed native paid checkout application or recovery refused.",
              );
              assert.equal(String(e).includes("PRIVATE"), false);
              return true;
            },
          );
          assert.equal(integration.get("SELECT total_changes() n")!.n, changes);
          throw Error("rollback-malformed-provenance");
        }),
      /rollback-malformed-provenance/,
    );
    assert.deepEqual(
      f.app.database.transaction(() =>
        f.app.database.captureRestoreCandidateInTransaction(),
      ),
      before,
    );
  }
});

import { checkoutPaidFixture } from "./offline-checkout-paid-fixture.ts";
import { isCapturedCheckoutPrivateApplicationCapture } from "../src/server/restore-offline-checkout-private-evidence.ts";
async function applicationFixture(
  t: TestContext,
  region: "CA" | "US" = "CA",
  currency: "CAD" | "USD" = "CAD",
  reports = true,
) {
  const f = await checkoutPaidFixture(t, region, currency, reports);
  const comparison = compare(f.inputData);
  f.envelope.task.expectedStateHash = f.app.database.transaction(
    () =>
      new Join(
        f.app.database,
        f.app.identity,
        f.app.billing,
        f.app.integration.checkouts,
      ).getInTransaction(f.executor, comparison).hash,
  );
  // The task never maps these signed external names into native IAM IDs.
  f.envelope.preparedBy = "unqualified-external-preparer";
  f.envelope.executorId = "unqualified-external-executor";
  return f;
}
function captureInWriter(f: Awaited<ReturnType<typeof applicationFixture>>) {
  const h = f.read();
  h.complete();
  try {
    return h.captureForApplicationInTransaction(f.executor);
  } finally {
    h.dispose();
  }
}
function applyCaptured(f: Awaited<ReturnType<typeof applicationFixture>>) {
  return f.app.database.transaction(() =>
    operation(f).applyInTransaction(
      f.executor,
      f.reviewer,
      f.envelope,
      captureInWriter(f),
    ),
  );
}
function recoverCaptured(f: Awaited<ReturnType<typeof applicationFixture>>) {
  return f.app.database.transaction(() =>
    operation(f).recoverRetainedInTransaction(
      f.executor,
      f.reviewer,
      f.envelope,
    ),
  );
}
for (const [region, currency] of [
  ["CA", "CAD"],
  ["CA", "USD"],
  ["US", "USD"],
] as const)
  for (const reports of [false, true])
    test(`actual private capture ${region}/${currency} reports=${reports}: one payment/receipt, lost-response recovery and restart`, async (t) => {
      const f = await applicationFixture(t, region, currency, reports);
      const integration = f.app.database.owned("integration"),
        beforeEffect = { ...f.app.integration.effect(f.actor, f.effectId) },
        beforeNative = f.snapshot();
      const result = applyCaptured(f);
      assert.equal(Object.isFrozen(result), true);
      assert.equal(result.status, "native-owner-application-only");
      assert.equal(result.amount, f.inputData.candidate.invoice.total);
      assert.equal(result.currency, currency.toLowerCase());
      assert.equal(result.referenceJoinHash, f.envelope.task.expectedStateHash);
      assert.equal(result.binding, offlineTaskBinding(f.envelope));
      assert.equal(result.paymentReference, "pi_synthetic");
      assert.equal(result.sessionReference, "cs_test_synthetic");
      assert.notEqual(f.snapshot(), beforeNative);
      const afterEffect = f.app.integration.effect(f.actor, f.effectId);
      assert.equal(afterEffect.state, "completed");
      assert.equal(afterEffect.payload, beforeEffect.payload);
      assert.equal(afterEffect.created_at, beforeEffect.created_at);
      assert.equal(afterEffect.external_ref, result.sessionReference);
      assert.equal(
        f.app.billing.totals(f.actor, f.invoiceId).paid,
        result.amount,
      );
      assert.equal(f.app.billing.totals(f.actor, f.invoiceId).balance, 0);
      assert.equal(
        integration.get(
          "SELECT COUNT(*) n FROM integration_offline_checkout_paid",
        )!.n,
        1,
      );
      for (const table of [
        "integration_callbacks",
        "integration_inbox",
        "integration_payment_allocations",
        "integration_checkout_observations",
      ])
        assert.equal(integration.get(`SELECT COUNT(*) n FROM ${table}`)!.n, 0);
      const retained = f.app.database.transaction(() =>
        f.app.platform.offline.readInTransaction(),
      )!;
      const receipts = retained.state.sessions.flatMap((s) =>
        s.history.flatMap((h) => (h.receipt ? [h.receipt] : [])),
      );
      assert.equal(receipts.length, 1);
      assert.equal(receipts[0]!.resultHash, result.resultHash);
      assert.equal(receipts[0]!.payloadHash, digest(canonical(f.inputData)));
      const afterNative = f.snapshot();
      assert.deepEqual(recoverCaptured(f), result);
      assert.equal(f.snapshot(), afterNative);
      f.app.close();
      f.app = new Application(f.path, region, { eventReports: reports });
      assert.deepEqual(recoverCaptured(f), result);
      assert.equal(f.snapshot(), afterNative);
      assert.equal(f.calls(), 1); // only synthetic initial lost response; no transport in import/recovery
    });

test("genuine capture required before traversal; signed envelope cannot substitute native intent or another binding", async (t) => {
  const f = await applicationFixture(t),
    op = operation(f),
    before = f.snapshot();
  const capture = f.app.database.transaction(() => captureInWriter(f));
  assert.equal(isCapturedCheckoutPrivateApplicationCapture(capture), true);
  let hits = 0;
  const hook = () => {
    hits++;
    throw Error("PRIVATE trap");
  };
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  for (const bad of [
    structuredClone(capture),
    new Proxy(capture, { get: hook, ownKeys: hook, getPrototypeOf: hook }),
    revoked.proxy,
    {
      get comparison() {
        return hook();
      },
    },
  ])
    assert.throws(
      () =>
        f.app.database.transaction(() =>
          op.applyInTransaction(f.executor, f.reviewer, f.envelope, bad),
        ),
      code,
    );
  assert.equal(hits, 0);
  for (const field of ["payload", "state", "set", "binding"]) {
    const envelope = structuredClone(f.envelope);
    if (field === "payload")
      envelope.task.payloadHash = digest(
        canonical(
          f.app.database.transaction(() =>
            op.prepareInTransaction(f.executor, f.reviewer, capture.comparison),
          ).nativeIntent,
        ),
      );
    if (field === "state")
      envelope.task.expectedStateHash = capture.comparison.nativeHash;
    if (field === "set") envelope.evidence.setHash = digest("wrong-set");
    if (field === "binding") envelope.requestId = "another-request";
    assert.throws(
      () =>
        f.app.database.transaction(() =>
          op.applyInTransaction(f.executor, f.reviewer, envelope, capture),
        ),
      code,
    );
    assert.equal(f.snapshot(), before);
  }
  assert.throws(
    () => op.applyInTransaction(f.executor, f.reviewer, f.envelope, capture),
    { code: "TRANSACTION" },
  );
  assert.throws(
    () =>
      f.app.database.transaction(() =>
        op.applyInTransaction(f.executor, f.executor, f.envelope, capture),
      ),
    code,
  );
});

for (const [name, owner, sql, param] of [
  [
    "pending",
    "integration",
    "UPDATE integration_effects SET state='pending' WHERE id=?",
    "effectId",
  ],
  [
    "mismatched intent",
    "integration",
    "UPDATE integration_effects SET payload='{}' WHERE id=?",
    "effectId",
  ],
  [
    "active lease",
    "integration",
    "UPDATE integration_operation_leases SET token='active',started_at=1 WHERE effect_id=?",
    "effectId",
  ],
  [
    "revoked executor",
    "iam",
    "UPDATE iam_users SET active=0 WHERE id=?",
    "executor",
  ],
  [
    "revoked preparer",
    "iam",
    "UPDATE iam_users SET active=0 WHERE id=?",
    "reviewer",
  ],
  [
    "password change",
    "iam",
    "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
    "executor",
  ],
  [
    "foreign tenant",
    "iam",
    "UPDATE iam_users SET org_id='foreign' WHERE id=?",
    "reviewer",
  ],
] as const)
  test(`issued capture rechecks current ${name} and refuses without owner writes`, async (t) => {
    const f = await applicationFixture(t),
      op = operation(f),
      capture = f.app.database.transaction(() => captureInWriter(f)),
      before = f.snapshot();
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          const s = f.app.database.owned(owner),
            key = param === "effectId" ? f.effectId : f[param].id;
          s.run(sql, key);
          const n = s.get("SELECT total_changes() n")!.n;
          assert.throws(
            () =>
              op.applyInTransaction(
                f.executor,
                f.reviewer,
                f.envelope,
                capture,
              ),
            (e: any) => {
              assert.match(
                e.code,
                /^(OFFLINE_CHECKOUT|FORBIDDEN|PASSWORD_CHANGE_REQUIRED)/,
              );
              return true;
            },
          );
          assert.equal(s.get("SELECT total_changes() n")!.n, n);
          throw Error("rollback-current-change");
        }),
      /rollback-current-change/,
    );
    assert.equal(f.snapshot(), before);
  });

test("caller outer rollback conserves payment, effect, provenance, audit and sole receipt; capture grants no repeat payment", async (t) => {
  const f = await applicationFixture(t),
    before = f.snapshot();
  let result: any;
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        result = operation(f).applyInTransaction(
          f.executor,
          f.reviewer,
          f.envelope,
          captureInWriter(f),
        );
        assert.equal(
          f.app.billing.totals(f.actor, f.invoiceId).paid,
          result.amount,
        );
        throw Error("outer-native-rollback");
      }),
    /outer-native-rollback/,
  );
  assert.equal(f.snapshot(), before);
  const original = applyCaptured(f),
    after = f.snapshot();
  assert.deepEqual(recoverCaptured(f), original);
  assert.throws(() => applyCaptured(f), {
    code: "RESTORE_OFFLINE_CHECKOUT_PRIVATE",
  });
  assert.equal(f.snapshot(), after);
  assert.throws(
    () =>
      f.app.database.transaction(() =>
        operation(f).recoverRetainedInTransaction(
          f.reviewer,
          f.executor,
          f.envelope,
        ),
      ),
    code,
  );
  assert.equal(f.snapshot(), after);
});

import { DatabaseSync } from "node:sqlite";
for (const point of ["audit", "receipt"] as const)
  test(`late native SQLite ${point} failure rolls back all prior writes`, async (t) => {
    const f = await applicationFixture(t),
      before = f.snapshot(),
      prepare = DatabaseSync.prototype.prepare;
    let payment = false,
      provenance = false,
      failed = false;
    Object.defineProperty(DatabaseSync.prototype, "prepare", {
      configurable: true,
      writable: true,
      value: function (this: DatabaseSync, sql: string) {
        if (sql.startsWith("INSERT INTO billing_payments")) payment = true;
        if (sql.startsWith("INSERT INTO integration_offline_checkout_paid"))
          provenance = true;
        const fail =
          point === "audit"
            ? sql.startsWith("INSERT INTO platform_audit ")
            : sql.startsWith("INSERT INTO platform_offline_journal ");
        if (fail && provenance) {
          failed = true;
          throw Error("synthetic-late-SQLite-fault");
        }
        return prepare.call(this, sql);
      },
    });
    try {
      assert.throws(() => applyCaptured(f), /synthetic-late-SQLite-fault/);
    } finally {
      Object.defineProperty(DatabaseSync.prototype, "prepare", {
        configurable: true,
        writable: true,
        value: prepare,
      });
    }
    assert.equal(payment, true);
    assert.equal(provenance, true);
    assert.equal(failed, true);
    assert.equal(f.snapshot(), before);
    const result = applyCaptured(f);
    assert.deepEqual(recoverCaptured(f), result);
  });

for (const [name, owner, sql] of [
  [
    "effect result",
    "integration",
    "UPDATE integration_effects SET result='{}'",
  ],
  [
    "effect payload",
    "integration",
    "UPDATE integration_effects SET payload='{}'",
  ],
  [
    "effect session",
    "integration",
    "UPDATE integration_effects SET external_ref='cs_test_other'",
  ],
  [
    "new active claim",
    "integration",
    "UPDATE integration_operation_leases SET token='active',started_at=1",
  ],
  [
    "payment reference",
    "billing",
    "UPDATE billing_payments SET external_ref='pi_other'",
  ],
  ["payment amount", "billing", "UPDATE billing_payments SET amount=amount+1"],
  [
    "orphan allocation",
    "integration",
    "INSERT INTO integration_payment_allocations VALUES('orphan','foreign','missing','missing',1)",
  ],
] as const)
  test(`recovery revalidates ${name} in same writer without changes`, async (t) => {
    const f = await applicationFixture(t),
      result = applyCaptured(f),
      before = f.snapshot();
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          const s = f.app.database.owned(owner);
          s.run(sql);
          const n = s.get("SELECT total_changes() n")!.n;
          assert.throws(
            () =>
              operation(f).recoverRetainedInTransaction(
                f.executor,
                f.reviewer,
                f.envelope,
              ),
            code,
          );
          assert.equal(s.get("SELECT total_changes() n")!.n, n);
          throw Error("rollback-recovery-damage");
        }),
      /rollback-recovery-damage/,
    );
    assert.equal(f.snapshot(), before);
    assert.deepEqual(recoverCaptured(f), result);
  });

test("reverse global task correspondence rejects unrelated paid receipt, preserving both receipts", async (t) => {
  const f = await applicationFixture(t);
  applyCaptured(f);
  f.app.database.transaction(() => {
    const s = f.app.platform.offline.readInTransaction()!;
    f.app.platform.offline.transitionInTransaction(
      s.state.generation,
      s.anchor,
      {
        kind: "record-task",
        receipt: {
          owner: "integration",
          orgId: f.actor.orgId,
          taskName: "integration.checkout-paid.import",
          requestId: "orphan",
          binding: digest("orphan"),
          payloadHash: digest("orphan-payload"),
          beforeCandidateHash: digest("orphan-candidate"),
          resultHash: digest("orphan-result"),
        },
      },
      [],
    );
  });
  const before = f.snapshot();
  assert.throws(() => recoverCaptured(f), code);
  assert.equal(f.snapshot(), before);
});

test("current raw hold is mandatory for both application and historical recovery", async (t) => {
  const f = await applicationFixture(t),
    cap = f.app.database.transaction(() => captureInWriter(f));
  for (const done of [false, true]) {
    if (done) applyCaptured(f);
    const before = f.snapshot();
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          f.app.database.owned("platform").run("DELETE FROM platform_recovery");
          assert.throws(
            () =>
              done
                ? operation(f).recoverRetainedInTransaction(
                    f.executor,
                    f.reviewer,
                    f.envelope,
                  )
                : operation(f).applyInTransaction(
                    f.executor,
                    f.reviewer,
                    f.envelope,
                    cap,
                  ),
            {
              code: done
                ? "OFFLINE_CHECKOUT_PAID"
                : "OFFLINE_CHECKOUT_REFERENCE_RAW_HOLD",
            },
          );
          throw Error("rollback-hold");
        }),
      /rollback-hold/,
    );
    assert.equal(f.snapshot(), before);
  }
});

test("new actual native PaymentIntent and same-value candidate mutation refuse before payment application", async (t) => {
  const f = await applicationFixture(t),
    cap = f.app.database.transaction(() => captureInWriter(f)),
    before = f.snapshot();
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        f.app.billing.verifiedPayment(
          f.app.identity.workerActor(f.executor.orgId, f.executor.id),
          f.invoiceId,
          1,
          "stripe",
          "pi_synthetic",
        );
        const n = f.app.database
          .owned("integration")
          .get("SELECT total_changes() n")!.n;
        assert.throws(
          () =>
            operation(f).applyInTransaction(
              f.executor,
              f.reviewer,
              f.envelope,
              cap,
            ),
          (e: any) => {
            assert.match(e.code, /^OFFLINE_CHECKOUT/);
            return true;
          },
        );
        assert.equal(
          f.app.database.owned("integration").get("SELECT total_changes() n")!
            .n,
          n,
        );
        throw Error("rollback-payment-collision");
      }),
    /rollback-payment-collision/,
  );
  assert.equal(f.snapshot(), before);
  const op = operation(f),
    original = fs.lstatSync;
  let hit = false;
  Object.defineProperty(fs, "lstatSync", {
    configurable: true,
    writable: true,
    value: (...args: any[]) => {
      if (!hit) {
        hit = true;
        f.app.database
          .owned("integration")
          .run(
            "UPDATE integration_effects SET state=state WHERE id=?",
            f.effectId,
          );
      }
      return (original as any)(...args);
    },
  });
  syncBuiltinESMExports();
  try {
    assert.throws(
      () =>
        f.app.database.transaction(() =>
          op.applyInTransaction(f.executor, f.reviewer, f.envelope, cap),
        ),
      (e: any) => {
        assert.match(e.code, /^OFFLINE_CHECKOUT/);
        return true;
      },
    );
  } finally {
    Object.defineProperty(fs, "lstatSync", {
      configurable: true,
      writable: true,
      value: original,
    });
    syncBuiltinESMExports();
  }
  assert.equal(hit, true);
  assert.equal(f.snapshot(), before);
});

test("actual stored provenance append-only guards and original record hash are independently visible", async (t) => {
  const f = await applicationFixture(t),
    result = applyCaptured(f),
    s = f.app.database.owned("integration"),
    row = s.get("SELECT * FROM integration_offline_checkout_paid")!;
  assert.equal(digest(String(row.record)), result.resultHash);
  const record = JSON.parse(String(row.record));
  assert.equal(canonical(record), row.record);
  assert.equal(record.capture.payloadHash, digest(canonical(f.inputData)));
  assert.notEqual(record.capture.payloadHash, record.comparison.inputHash);
  assert.equal(record.intent.referenceJoinHash, result.referenceJoinHash);
  assert.equal(record.capture.captureHash, result.captureHash);
  const before = f.snapshot();
  for (const sql of [
    "UPDATE integration_offline_checkout_paid SET record=record",
    "DELETE FROM integration_offline_checkout_paid",
    "INSERT OR REPLACE INTO integration_offline_checkout_paid SELECT * FROM integration_offline_checkout_paid",
  ])
    assert.throws(
      () => s.run(sql),
      /Offline checkout provenance is append-only/,
    );
  assert.equal(f.snapshot(), before);
  assert.deepEqual(recoverCaptured(f), result);
});

test("captured application refreshes exact owner descriptors before executing substituted methods", async (t) => {
  const f = await applicationFixture(t),
    cap = f.app.database.transaction(() => captureInWriter(f)),
    op = operation(f),
    before = f.snapshot();
  let hits = 0;
  for (const [object, key] of [
    [f.app.billing, "verifiedPayment"],
    [f.app.platform, "audit"],
    [f.app.platform.offline, "transitionInTransaction"],
  ] as const) {
    Object.defineProperty(object, key, {
      configurable: true,
      get() {
        hits++;
        throw Error("private-hook");
      },
    });
    try {
      assert.throws(
        () =>
          f.app.database.transaction(() =>
            op.applyInTransaction(f.executor, f.reviewer, f.envelope, cap),
          ),
        (e: any) => {
          assert.match(e.code, /^OFFLINE_CHECKOUT/);
          return true;
        },
      );
    } finally {
      Reflect.deleteProperty(object, key);
    }
  }
  assert.equal(hits, 0);
  assert.equal(f.snapshot(), before);
});
