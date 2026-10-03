import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import fs from "node:fs";
import { accept, chooseProviders, fixture, ship } from "./fixtures.ts";
import { canonical, digest, type Actor } from "../src/server/core.ts";
import { Application } from "../src/server/application.ts";
import { compareOfflineFailedRefundEvidence } from "../src/server/integration-offline-refund-evidence.ts";
import { RestoreOfflineRefundNativeJoin } from "../src/server/restore-offline-refund-native-join.ts";
import {
  IntegrationOfflineFailedRefund,
  offlineFailedRefundTask,
} from "../src/server/integration-offline-failed-refund.ts";
import { parseOfflineRecoveryGeneration } from "../src/server/restore-offline-phase.ts";
import { RestoreOfflineCommitGuard } from "../src/server/restore-offline-commit-guard.ts";
import { Store } from "../src/server/database.ts";
import { SCHEMA_VERSION } from "../src/server/schema.ts";
const h = (s: string) => digest("synthetic-offline-write:" + s);
async function setup(
  t: TestContext,
  region: "CA" | "US" = "CA",
  currency: "CAD" | "USD" = "CAD",
) {
  const f = fixture(t, {}, region, currency);
  const invoiceId = ship(f, accept(f, 2).id).invoiceId;
  chooseProviders(f, f.actor, "join-choice", {
    accountId: f.buyer,
    region,
    mode: "provider-exceptions",
    providers: ["stripe"],
    version: 1,
    acknowledgment: "Synthetic test consent",
  });
  const payment = f.app.database.transaction(() =>
    f.app.billing.verifiedPayment(
      f.actor,
      invoiceId,
      22600,
      "stripe",
      "pi_native_join",
    ),
  );
  f.app.billing.issueCredit(f.actor, "join-credit", {
    invoiceId,
    reference: "JOIN-CREDIT",
    reason: "Synthetic credit",
    lines: [
      {
        lineId: String(f.app.billing.lines(f.actor, invoiceId)[0]!.id),
        quantity: 1,
      },
    ],
  });
  const request = {
    invoiceId,
    paymentId: payment.id,
    amount: 5000,
    reference: "JOIN-REFUND",
    reason: "Original native refund reason",
  };
  const refund = f.app.billing.refundRequest(f.actor, "join-request", request);
  const effect = f.app.integration.refund(f.actor, "join-queue", {
    refundId: refund.id,
  });
  await assert.rejects(
    f.app.integration.execute(f.actor, effect.id, {
      execute: async (_effect, beforeWrite) => {
        beforeWrite?.();
        throw Error("synthetic lost response; no provider called");
      },
      lookup: async () => {
        throw Error("unexpected lookup");
      },
    }),
    /synthetic lost response/,
  );
  const { id } = f.app.identity.createUser(f.actor, "join-finance", {
    name: "Native join finance",
    email: "native-join@example.test",
    password: "synthetic-long-password",
    role: "finance",
    sites: [],
  });
  const finance = f.app.identity.currentActor({ ...f.actor, id });
  f.app.platform.isolateRestore(
    digest("synthetic-join-source"),
    new Date().toISOString(),
  );
  // Synthetic evidence assembled from fixed fixture owner tables, independently
  // of the join under test. No provider truth/source qualification is asserted.
  const billing = f.app.database.owned("billing"),
    integration = f.app.database.owned("integration"),
    platform = f.app.database.owned("platform");
  const invoice = billing.get(
    "SELECT id,org_id,account_id,currency,total FROM billing_invoices WHERE id=?",
    invoiceId,
  )!;
  const nativeRefund = billing.get(
    "SELECT id,org_id,invoice_id,payment_id,amount,reference,state FROM billing_refunds WHERE id=?",
    refund.id,
  )!;
  const originalPayment = billing.get(
    "SELECT id,org_id,invoice_id,provider,external_ref,amount FROM billing_payments WHERE id=?",
    payment.id,
  )!;
  const nativeEffect = integration.get(
    "SELECT * FROM integration_effects WHERE id=?",
    effect.id,
  )!;
  const native = {
    organization: { id: f.actor.orgId, region, currency },
    account: { id: f.buyer, org_id: f.actor.orgId, currency },
    invoice: { ...invoice },
    payment: { ...originalPayment },
    refund: { ...nativeRefund },
    effect: { ...nativeEffect },
  };
  const receipts = ["billing.refund.request", "stripe.refund"].map((name) => {
    const row = platform.get(
      "SELECT * FROM platform_commands WHERE org_id=? AND name=?",
      f.actor.orgId,
      name,
    )!;
    return {
      orgId: row.org_id,
      actorId: row.actor_id,
      command: row.name,
      key: row.key,
      requestHash: row.hash,
      result: JSON.parse(String(row.result)),
      createdAt: row.created_at,
    };
  });
  const history = {
    orgId: f.actor.orgId,
    effectId: effect.id,
    refundId: refund.id,
    coverage: "complete-for-subject",
    poll: {
      ...integration.get(
        "SELECT * FROM integration_refund_polls WHERE effect_id=?",
        effect.id,
      )!,
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
    receipts,
  };
  const input = {
    version: 1,
    native,
    sourceNative: structuredClone(native),
    candidateHistory: history,
    sourceHistory: structuredClone(history),
    refundRequest: request,
    binding: {
      provider: "stripe",
      mode: "test",
      scope: "direct-account",
      orgId: f.actor.orgId,
      accountId: f.buyer,
      runtimeBindingId: "synthetic-runtime",
      stripeAccountId: "acct_synthetic",
      profile: "stripe-failed-refund-v1",
    },
    provider: {
      stripeAccountId: "acct_synthetic",
      livemode: false,
      coverage: "complete-for-effect",
      matchingRefundIds: ["re_native_join"],
      paymentIntent: {
        object: "payment_intent",
        id: "pi_native_join",
        status: "succeeded",
        livemode: false,
        amount_received: 22600,
        currency: currency.toLowerCase(),
      },
      refund: {
        object: "refund",
        id: "re_native_join",
        payment_intent: "pi_native_join",
        amount: 5000,
        currency: currency.toLowerCase(),
        status: "failed",
        metadata: { effect_id: effect.id, refund_id: refund.id },
      },
    },
  };
  const reader = new RestoreOfflineRefundNativeJoin(
    f.app.database,
    f.app.identity,
    f.app.billing,
  );
  return {
    ...f,
    replaceApp(app: Application) {
      f.app = app;
    },
    input,
    reader,
    finance,
    effectId: effect.id,
    refundId: refund.id,
  };
}

type Fixture = Awaited<ReturnType<typeof prepared>>;
async function prepared(
  t: TestContext,
  region: "CA" | "US" = "CA",
  currency: "CAD" | "USD" = "CAD",
  beforeGeneration?: (f: Awaited<ReturnType<typeof setup>>) => void,
  afterOpen?: (f: Awaited<ReturnType<typeof setup>>) => void,
) {
  const f = await setup(t, region, currency);
  beforeGeneration?.(f);
  for (const suffix of ["", "-wal", "-shm"])
    if (fs.existsSync(f.path + suffix)) fs.chmodSync(f.path + suffix, 0o600);
  f.app.database.transaction(() => {
    const { logicalHash: _logical, ...candidate } =
      f.app.database.captureRestoreCandidateInTransaction();
    const generation = parseOfflineRecoveryGeneration({
      version: 1,
      instanceId: h("instance"),
      schemaVersion: SCHEMA_VERSION,
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
      { kind: "isolate", sessionId: "synthetic-session" },
      [],
    );
    state = f.app.platform.offline.readInTransaction()!;
    f.app.platform.offline.transitionInTransaction(
      generation,
      state.anchor,
      { kind: "open" },
      [],
    );
    afterOpen?.(f);
  });
  const comparison = compareOfflineFailedRefundEvidence(f.input);
  const envelope = f.app.database.transaction(() => {
    const retained = f.app.platform.offline.readInTransaction()!,
      {
        version: _version,
        schemaVersion: _schema,
        ...recovery
      } = retained.state.generation,
      session = retained.state.sessions.at(-1)!,
      candidate = f.app.database.captureRestoreCandidateInTransaction(),
      file = fs.lstatSync(f.path, { bigint: true }),
      joined = f.reader.getInTransaction(f.finance, comparison);
    return {
      version: 1,
      purpose: "distributor-restore-offline-task-v1",
      requestId: "synthetic-write",
      preparedBy: "synthetic-preparer",
      executorId: "synthetic-executor",
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
        ...offlineFailedRefundTask,
        orgId: f.actor.orgId,
        siteIds: [],
        subjectId: f.effectId,
        expectedRevision: 0,
        expectedStateHash: joined.hash,
        payloadHash: digest(
          canonical({ version: 1, comparisonInputHash: comparison.inputHash }),
        ),
        priorClaim: null,
      },
      evidence: {
        setHash: h("set"),
        items: [
          { reference: "synthetic-evidence", sha256: h("bytes"), bytes: 1 },
        ],
        qualificationHash: h("qualification"),
      },
      operations: {
        authorityId: "synthetic-operations",
        revision: 1,
        adapterIdentity: "synthetic-unqualified",
        fenceTokenHash: h("fence"),
        observationHash: h("observation"),
      },
      trust: {
        authorityId: "synthetic-trust",
        revision: 1,
        registryHash: h("registry"),
      },
    };
  });
  return {
    ...f,
    comparison,
    envelope,
    operation: new IntegrationOfflineFailedRefund(
      f.app.database,
      f.app.identity,
      f.app.billing,
      f.app.platform,
    ),
  };
}
function apply(
  f: Fixture,
  actor = f.finance,
  envelope: unknown = f.envelope,
  comparison: unknown = f.comparison,
) {
  return f.app.database.transaction(() =>
    f.operation.applyInTransaction(actor, envelope, comparison),
  );
}
function conservation(f: Fixture) {
  return canonical(
    (["billing", "integration", "platform"] as const).map((owner) => {
      const s = f.app.database.owned(owner);
      return s
        .all<{ name: string }>(
          "SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE ? ORDER BY name",
          owner + "_%",
        )
        .map((r) => [
          r.name,
          s.all("SELECT * FROM " + r.name + " ORDER BY rowid"),
        ]);
    }),
  );
}
for (const [region, currency] of [
  ["CA", "CAD"],
  ["CA", "USD"],
  ["US", "USD"],
] as const)
  test(`native fixed first failed refund ${region}/${currency} commits exact owning results and recovery`, async (t) => {
    const f = await prepared(t, region, currency),
      result = apply(f),
      before = conservation(f),
      recovered = recover(f);
    assert.equal(result.status, "native-owner-application-only");
    assert.equal(recovered.resultHash, result.resultHash);
    assert.deepEqual(recovered.receipt, result.receipt);
    assert.equal(conservation(f), before);
    const i = f.app.database.owned("integration"),
      b = f.app.database.owned("billing");
    assert.equal(
      i.get("SELECT state FROM integration_effects WHERE id=?", f.effectId)!
        .state,
      "completed",
    );
    assert.equal(
      b.get("SELECT state FROM billing_refunds WHERE id=?", f.refundId)!.state,
      "rejected",
    );
    assert.equal(
      i.get("SELECT COUNT(*) AS n FROM integration_offline_failed_refunds")!.n,
      1,
    );
    assert.equal(
      f.app.database.transaction(
        () =>
          f.app.platform.offline
            .readInTransaction()!
            .state.sessions.at(-1)!
            .history.filter((x) => x.receipt).length,
      ),
      1,
    );
    assert(
      Object.isFrozen(result) &&
        Object.isFrozen(result.receipt) &&
        Object.isFrozen(recovered),
    );
    assert.throws(() => apply(f));
    assert.equal(conservation(f), before);
  });
test("caller native writer required and default application guard remains disabled", async (t) => {
  const f = await prepared(t);
  assert.throws(
    () => f.operation.applyInTransaction(f.finance, f.envelope, f.comparison),
    /transaction/i,
  );
  assert.throws(
    () =>
      new RestoreOfflineCommitGuard(f.app.database, f.app.platform).execute(
        f.envelope,
      ),
    /guard/i,
  );
});
test("actual late Platform request conflict rolls back Billing, Integration and provenance writes", async (t) => {
  const f = await prepared(t, "CA", "CAD", undefined, (ready) => {
    const retained = ready.app.platform.offline.readInTransaction()!;
    ready.app.platform.offline.transitionInTransaction(
      retained.state.generation,
      retained.anchor,
      {
        kind: "record-task",
        receipt: {
          owner: "integration",
          orgId: ready.finance.orgId,
          taskName: offlineFailedRefundTask.name,
          requestId: "synthetic-write",
          binding: h("prior-binding"),
          payloadHash: h("prior-payload"),
          beforeCandidateHash: h("prior-candidate"),
          resultHash: h("prior-result"),
        },
      },
      [],
    );
  });
  const before = conservation(f),
    originalRun = Store.prototype.run;
  let provenanceWritten = false;
  Store.prototype.run = function (sql, ...parameters) {
    const result = originalRun.call(this, sql, ...parameters);
    if (sql.startsWith("INSERT INTO integration_offline_failed_refunds"))
      provenanceWritten = true;
    return result;
  };
  try {
    assert.throws(() => apply(f), /receipt identity or binding was reused/i);
  } finally {
    Store.prototype.run = originalRun;
  }
  assert.equal(provenanceWritten, true);
  assert.equal(conservation(f), before);
});
for (const name of ["clone", "proxy", "getter", "revoked"] as const)
  test(`reject ${name} comparison without callbacks or partial write`, async (t) => {
    const f = await prepared(t),
      before = conservation(f);
    let hits = 0;
    let input: unknown;
    if (name === "clone") input = structuredClone(f.comparison);
    if (name === "proxy")
      input = new Proxy(f.comparison, {
        get() {
          hits++;
          throw Error("trap");
        },
      });
    if (name === "getter")
      input = {
        get native() {
          hits++;
          throw Error("getter");
        },
      };
    if (name === "revoked") {
      const p = Proxy.revocable(f.comparison, {});
      p.revoke();
      input = p.proxy;
    }
    assert.throws(() => apply(f, f.finance, f.envelope, input), {
      code: "OFFLINE_FAILED_REFUND_APPLICATION",
    });
    assert.equal(hits, 0);
    assert.equal(conservation(f), before);
  });
for (const field of [
  "expectedStateHash",
  "payloadHash",
  "subjectId",
  "owner",
  "name",
  "siteIds",
  "expectedRevision",
  "priorClaim",
] as const)
  test(`fixed task refuses changed ${field} atomically`, async (t) => {
    const f = await prepared(t),
      before = conservation(f),
      e = structuredClone(f.envelope);
    const changes: Record<string, unknown> = {
      expectedStateHash: h("changed"),
      payloadHash: h("changed"),
      subjectId: "other",
      owner: "billing",
      name: "other.task",
      siteIds: [f.w1],
      expectedRevision: 1,
      priorClaim: {
        operationId: "other",
        tokenHash: h("token"),
        revision: 1,
        stateHash: h("state"),
      },
    };
    (e.task as unknown as Record<string, unknown>)[field] = changes[field];
    assert.throws(() => apply(f, f.finance, e));
    assert.equal(conservation(f), before);
  });
test("unsupported trigger schema refuses before any owner mutation", async (t) => {
  const f = await prepared(t);
  f.app.database.transaction(() =>
    f.app.database
      .owned("integration")
      .migrate(
        "CREATE TRIGGER integration_offline_fail_test BEFORE INSERT ON integration_offline_failed_refunds BEGIN SELECT RAISE(ABORT,'synthetic unsupported schema'); END",
      ),
  );
  const before = conservation(f);
  assert.throws(() => apply(f), { code: "RESTORE_OFFLINE_NATIVE_PHASE" });
  assert.equal(conservation(f), before);
});
test("outer rollback removes all native writes and receipt", async (t) => {
  const f = await prepared(t),
    before = conservation(f);
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        f.operation.applyInTransaction(f.finance, f.envelope, f.comparison);
        throw Error("synthetic outer rollback");
      }),
    /synthetic outer rollback/,
  );
  assert.equal(conservation(f), before);
});
test("reopen recovers exactly retained original receipt", async (t) => {
  const f = await prepared(t),
    result = apply(f);
  f.app.close();
  const app = new Application(f.path, "CA", { eventReports: false });
  f.app = app;
  f.replaceApp(app);
  const operation = new IntegrationOfflineFailedRefund(
    app.database,
    app.identity,
    app.billing,
    app.platform,
  );
  const recovered = app.database.transaction(() =>
    operation.recoverInTransaction(f.finance, f.envelope),
  );
  assert.deepEqual(recovered.receipt, result.receipt);
  assert.equal(recovered.resultHash, result.resultHash);
});

function recover(
  f: Fixture,
  actor: Actor = f.finance,
  envelope: unknown = f.envelope,
) {
  return f.app.database.transaction(() =>
    f.operation.recoverInTransaction(actor, envelope),
  );
}
for (const method of ["apply", "recover"] as const) {
  for (const invalid of ["inactive", "buyer", "password", "hold"] as const)
    test(`${method} rechecks current ${invalid} without partial writes`, async (t) => {
      const f = await prepared(t);
      if (method === "recover") apply(f);
      const iam = f.app.database.owned("iam");
      if (invalid === "inactive")
        iam.run("UPDATE iam_users SET active=0 WHERE id=?", f.finance.id);
      if (invalid === "buyer")
        iam.run(
          "UPDATE iam_users SET role='buyer',account_id=? WHERE id=?",
          f.buyer,
          f.finance.id,
        );
      if (invalid === "password")
        iam.run(
          "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
          f.finance.id,
        );
      if (invalid === "hold")
        f.app.database.owned("platform").run("DELETE FROM platform_recovery");
      const before = conservation(f);
      assert.throws(() => (method === "apply" ? apply(f) : recover(f)));
      assert.equal(conservation(f), before);
    });
  test(`${method} refuses actor proxy, revoked proxy and accessor without traps`, async (t) => {
    const f = await prepared(t);
    if (method === "recover") apply(f);
    let hits = 0;
    const proxy = Proxy.revocable(f.finance, {
      get() {
        hits++;
        throw Error("trap");
      },
      getOwnPropertyDescriptor() {
        hits++;
        throw Error("trap");
      },
    });
    const accessor = { ...f.finance };
    Object.defineProperty(accessor, "id", {
      get() {
        hits++;
        throw Error("getter");
      },
    });
    const before = conservation(f);
    for (const actor of [proxy.proxy, accessor])
      assert.throws(() =>
        method === "apply" ? apply(f, actor) : recover(f, actor),
      );
    proxy.revoke();
    assert.throws(() =>
      method === "apply" ? apply(f, proxy.proxy) : recover(f, proxy.proxy),
    );
    assert.equal(hits, 0);
    assert.equal(conservation(f), before);
  });
}
test("offline phase excludes ordinary acknowledgment while later ignored observations retain the original receipt", async (t) => {
  const f = await prepared(t),
    original = apply(f);
  const beforeAcknowledgment = conservation(f);
  assert.throws(
    () =>
      f.app.billing.refunds.alerts.acknowledge(f.finance, "later-read", {
        noticeId: f.refundId,
        revision: 1,
      }),
    { code: "RESTORE_OFFLINE_EXCLUSION" },
  );
  assert.equal(conservation(f), beforeAcknowledgment);
  f.app.database.transaction(() => {
    const intent = f.app.billing.refunds.intent(f.finance, f.refundId);
    for (const status of ["pending", "succeeded", "failed"] as const)
      f.app.billing.refunds.observe(f.finance, intent, "re_native_join", {
        ...intent,
        status,
      });
  });
  const before = conservation(f),
    found = recover(f);
  assert.deepEqual(found.receipt, original.receipt);
  assert.equal(found.resultHash, original.resultHash);
  assert.equal(conservation(f), before);
});
test("immutable provenance refuses update, delete and implicit replacement", async (t) => {
  const f = await prepared(t),
    original = apply(f),
    s = f.app.database.owned("integration");
  const before = conservation(f);
  for (const sql of [
    "UPDATE integration_offline_failed_refunds SET record_hash=record_hash",
    "DELETE FROM integration_offline_failed_refunds",
    "INSERT OR REPLACE INTO integration_offline_failed_refunds SELECT * FROM integration_offline_failed_refunds",
  ])
    assert.throws(
      () => f.app.database.transaction(() => s.run(sql)),
      /append-only/,
    );
  assert.equal(conservation(f), before);
  assert.deepEqual(recover(f).receipt, original.receipt);
});
for (const sql of [
  "UPDATE integration_effects SET result='{}' WHERE id=?",
  "UPDATE integration_effects SET payload='{}' WHERE id=?",
  "UPDATE integration_effects SET external_ref='re_changed' WHERE id=?",
  "UPDATE integration_effects SET state='unknown' WHERE id=?",
  "UPDATE integration_refund_polls SET token='copied' WHERE effect_id=?",
  "UPDATE integration_refund_polls SET retry_at=1 WHERE effect_id=?",
])
  test(`recovery refuses changed retained owner state ${sql.split(" SET ")[1]!.split(" WHERE")[0]}`, async (t) => {
    const f = await prepared(t);
    apply(f);
    f.app.database.owned("integration").run(sql, f.effectId);
    const before = conservation(f);
    assert.throws(() => recover(f));
    assert.equal(conservation(f), before);
  });
for (const [name, sql] of [
  [
    "checkout allocation pointing at the refund effect",
    "INSERT INTO integration_payment_allocations VALUES(?,?,'copied-invoice','copied-payment',1)",
  ],
  [
    "accounting refund pointing at the Stripe effect",
    "INSERT INTO integration_accounting_refunds VALUES(?,?,'copied-invoice','copied-refund','copied-credit',1)",
  ],
  [
    "orphan accounting balance observation",
    "INSERT INTO integration_balance_observations(read_id,org_id,effect_id,result) VALUES(?,?, 'missing-effect','{}')",
  ],
] as const)
  for (const method of ["apply", "recover"] as const)
    test(`${method} refuses ${name} without partial writes`, async (t) => {
      const damage = (ready: Awaited<ReturnType<typeof setup>>) =>
        ready.app.database
          .owned("integration")
          .run(sql, ready.effectId, ready.finance.orgId);
      const f = await prepared(t);
      if (method === "recover") apply(f);
      // Capture the admissible comparison/envelope first. The later retained
      // damage must be caught again by this operation before owner writes.
      damage(f);
      const before = conservation(f);
      assert.throws(() => (method === "apply" ? apply(f) : recover(f)), {
        code: "OFFLINE_FAILED_REFUND_APPLICATION",
      });
      assert.equal(conservation(f), before);
    });
for (const [name, sql, value] of [
  [
    "NUL tail",
    "UPDATE integration_effects SET payload=? WHERE id=?",
    "{}\0" + "x".repeat(65536),
  ],
  [
    "UTF8 byte",
    "UPDATE integration_effects SET payload=CAST(x'ff' AS TEXT) WHERE id=?",
    undefined,
  ],
  [
    "oversize UTF8",
    "UPDATE integration_effects SET error=? WHERE id=?",
    "é".repeat(32769),
  ],
  [
    "deep JSON",
    "UPDATE integration_effects SET payload=? WHERE id=?",
    "[".repeat(129) + "0" + "]".repeat(129),
  ],
  [
    "unsafe integer",
    "UPDATE integration_refund_polls SET started_at=9007199254740992 WHERE effect_id=?",
    undefined,
  ],
] as const)
  test(`recovery complete preflight rejects ${name} before owner row fetch`, async (t) => {
    const f = await prepared(t);
    apply(f);
    const s = f.app.database.owned("integration");
    if (value === undefined) s.run(sql, f.effectId);
    else s.run(sql, value, f.effectId);
    const original = Store.prototype.get;
    let selected = 0;
    t.mock.method(
      Store.prototype,
      "get",
      function (this: Store, ...args: Parameters<Store["get"]>) {
        if (/SELECT \*/.test(args[0]) && /FROM integration_/.test(args[0]))
          selected++;
        return original.apply(this, args);
      },
    );
    assert.throws(() => recover(f));
    assert.equal(selected, 0);
  });
