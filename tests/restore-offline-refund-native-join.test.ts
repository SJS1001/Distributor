import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { accept, chooseProviders, fixture, ship } from "./fixtures.ts";
import { canonical, digest, type Actor } from "../src/server/core.ts";
import {
  compareOfflineFailedRefundEvidence,
  isCapturedOfflineFailedRefundComparison,
} from "../src/server/integration-offline-refund-evidence.ts";
import { RestoreOfflineRefundNativeJoin } from "../src/server/restore-offline-refund-native-join.ts";

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
    "synthetic-join-source",
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
    input,
    reader,
    finance,
    effectId: effect.id,
    refundId: refund.id,
  };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
function review(
  f: Fixture,
  input: unknown = compareOfflineFailedRefundEvidence(f.input),
  actor = f.finance,
) {
  return f.app.database.transaction(() =>
    f.reader.getInTransaction(actor, input),
  );
}
function conservation(f: Fixture) {
  return canonical(
    (["integration", "billing", "platform"] as const).map((owner) => {
      const store = f.app.database.owned(owner);
      return store
        .all<{ name: string }>(
          "SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE ? ORDER BY name",
          `${owner}_%`,
        )
        .map(({ name }) => [
          name,
          store.all(`SELECT * FROM ${name} ORDER BY rowid`),
        ]);
    }),
  );
}
function frozen(value: unknown) {
  if (value && typeof value === "object") {
    assert(Object.isFrozen(value));
    Object.values(value).forEach(frozen);
  }
}
for (const [region, currency] of [
  ["CA", "CAD"],
  ["CA", "USD"],
  ["US", "USD"],
] as const)
  test(`actual ${region}/${currency} joins complete owner histories without writes or blocker erasure`, async (t) => {
    const f = await setup(t, region, currency),
      before = conservation(f),
      result = review(f);
    assert.equal(result.status, "native-consistency-only");
    assert.equal(
      result.nativeReviewHashes.billing,
      result.reviews.billing.factsHash,
    );
    assert.deepEqual(result.reviews.integration.blockers, [
      "BILLING_COMPLETE_HISTORY_REQUIRED",
      "INBOX_UNATTRIBUTED_HISTORY_UNAVAILABLE",
      "PLATFORM_RECEIPT_HISTORY_REQUIRED",
    ]);
    assert.equal(result.history.receipts[1].result.state, "pending");
    assert.equal(result.native.organization.region, region);
    assert.equal(result.native.organization.currency, currency);
    const {
      hash,
      reviews: _reviews,
      requiredChecks: _required,
      ...body
    } = result;
    assert.equal(hash, digest(canonical(body)));
    frozen(result);
    assert.equal(conservation(f), before);
    assert.throws(() => f.app.platform.assertProviderAccess(), {
      code: "RECOVERY_HOLD",
    });
  });

for (const field of ["error", "started_at", "residency_version", "created_at"])
  test(`self-consistent captured effect ${field} substitution is refused by actual native join`, async (t) => {
    const f = await setup(t),
      input = structuredClone(f.input);
    const value =
      field === "error"
        ? "substituted error"
        : field === "created_at"
          ? "2026-10-01T00:00:00.000Z"
          : Number(input.native.effect[field]) + 1;
    input.native.effect[field] = value;
    input.sourceNative.effect[field] = value;
    const captured = compareOfflineFailedRefundEvidence(input),
      before = conservation(f);
    assert.throws(() => review(f, captured), {
      code: "OFFLINE_REFUND_NATIVE_JOIN",
    });
    assert.equal(conservation(f), before);
  });
for (const field of ["key", "actorId", "createdAt"])
  for (const index of [0, 1])
    test(`captured receipt ${index}/${field} substitution cannot hide in a valid comparison hash`, async (t) => {
      const f = await setup(t),
        input = structuredClone(f.input);
      const value =
        field === "createdAt"
          ? "2026-10-01T00:00:00.000Z"
          : "substituted-identity";
      input.candidateHistory.receipts[index]![field as "key"] = value;
      input.sourceHistory.receipts[index]![field as "key"] = value;
      assert.throws(
        () => review(f, compareOfflineFailedRefundEvidence(input)),
        { code: "OFFLINE_REFUND_NATIVE_JOIN" },
      );
    });
test("substituted original reason plus recomputed captured hashes still fails actual retained command", async (t) => {
  const f = await setup(t),
    input = structuredClone(f.input);
  input.refundRequest.reason = "Different original reason";
  input.candidateHistory.receipts[0]!.requestHash = digest(
    canonical(input.refundRequest),
  );
  input.sourceHistory.receipts[0]!.requestHash =
    input.candidateHistory.receipts[0]!.requestHash;
  assert.throws(() => review(f, compareOfflineFailedRefundEvidence(input)), {
    code: "OFFLINE_REFUND_NATIVE_JOIN",
  });
});
test("captured retry timestamp must match the complete native poll", async (t) => {
  const f = await setup(t),
    input = structuredClone(f.input);
  input.candidateHistory.poll!.retry_at =
    Number(input.candidateHistory.poll!.retry_at) + 1;
  input.sourceHistory.poll!.retry_at = input.candidateHistory.poll!.retry_at;
  assert.throws(() => review(f, compareOfflineFailedRefundEvidence(input)), {
    code: "OFFLINE_REFUND_NATIVE_JOIN",
  });
});
test("unattributed inbox refuses before older scoped review even when comparison is valid", async (t) => {
  const f = await setup(t),
    captured = compareOfflineFailedRefundEvidence(f.input);
  f.app.database
    .owned("integration")
    .run(
      "INSERT INTO integration_inbox VALUES('stripe','evt_unattributed',?,'2026-10-03T00:00:00.000Z')",
      digest("synthetic"),
    );
  const before = conservation(f);
  assert.throws(() => review(f, captured), {
    code: "OFFLINE_REFUND_NEGATIVE_HISTORY",
  });
  assert.equal(conservation(f), before);
});
test("generic retained lease is checked independently of inherent blocker strings", async (t) => {
  const f = await setup(t),
    captured = compareOfflineFailedRefundEvidence(f.input);
  f.app.database
    .owned("integration")
    .run(
      "INSERT INTO integration_operation_leases VALUES(?,?,NULL,NULL)",
      f.effectId,
      f.actor.orgId,
    );
  assert.throws(() => review(f, captured), {
    code: "OFFLINE_REFUND_NATIVE_JOIN",
  });
});
test("request and queue audit sequence must express original order", async (t) => {
  const f = await setup(t),
    captured = compareOfflineFailedRefundEvidence(f.input),
    store = f.app.database.owned("platform");
  const request = store.get<{ id: string }>(
      "SELECT id FROM platform_audit WHERE action='billing.refund.request'",
    )!,
    queued = store.get<{ id: string }>(
      "SELECT id FROM platform_audit WHERE action='stripe.refund'",
    )!;
  const first = store.get<{ sequence: number }>(
      "SELECT sequence FROM platform_audit_order WHERE audit_id=?",
      request.id,
    )!,
    second = store.get<{ sequence: number }>(
      "SELECT sequence FROM platform_audit_order WHERE audit_id=?",
      queued.id,
    )!;
  store.run(
    "UPDATE platform_audit_order SET sequence=sequence+1000000 WHERE audit_id=?",
    request.id,
  );
  store.run(
    "UPDATE platform_audit_order SET sequence=? WHERE audit_id=?",
    first.sequence,
    queued.id,
  );
  store.run(
    "UPDATE platform_audit_order SET sequence=? WHERE audit_id=?",
    second.sequence,
    request.id,
  );
  assert.throws(() => review(f, captured), {
    code: "OFFLINE_REFUND_NATIVE_JOIN",
  });
});
test("native current command state outside first pending queue is refused", async (t) => {
  const f = await setup(t),
    captured = compareOfflineFailedRefundEvidence(f.input);
  f.app.database
    .owned("platform")
    .run(
      "UPDATE platform_commands SET result=? WHERE name='stripe.refund'",
      JSON.stringify({ id: f.effectId, state: "unknown" }),
    );
  assert.throws(() => review(f, captured), {
    code: "OFFLINE_REFUND_NATIVE_JOIN",
  });
});
test("actual outer writer is required", async (t) => {
  const f = await setup(t);
  assert.throws(
    () =>
      f.reader.getInTransaction(
        f.finance,
        compareOfflineFailedRefundEvidence(f.input),
      ),
    { code: "TRANSACTION" },
  );
});
for (const kind of ["clone", "getter", "proxy", "revoked"])
  test(`comparison ${kind} lookalike is refused without traps or getters`, async (t) => {
    const f = await setup(t),
      original = compareOfflineFailedRefundEvidence(f.input);
    let calls = 0;
    const cloned = structuredClone(original);
    let input: unknown = cloned;
    if (kind === "getter")
      Object.defineProperty(cloned, "native", {
        get() {
          calls++;
          throw Error("getter");
        },
      });
    if (kind === "proxy")
      input = new Proxy(original, {
        get() {
          calls++;
          throw Error("trap");
        },
        getPrototypeOf() {
          calls++;
          throw Error("trap");
        },
      });
    if (kind === "revoked") {
      const revocable = Proxy.revocable(original, {});
      revocable.revoke();
      input = revocable.proxy;
    }
    assert.equal(isCapturedOfflineFailedRefundComparison(original), true);
    assert.equal(isCapturedOfflineFailedRefundComparison(input), false);
    assert.throws(() => review(f, input), {
      code: "OFFLINE_REFUND_NATIVE_JOIN",
    });
    assert.equal(calls, 0);
  });
for (const kind of ["getter", "proxy", "revoked"])
  test(`actor ${kind} identities are refused before native lookup`, async (t) => {
    const f = await setup(t);
    let calls = 0,
      actor: Actor = { ...f.finance };
    if (kind === "getter")
      Object.defineProperty(actor, "orgId", {
        get() {
          calls++;
          throw Error("getter");
        },
      });
    if (kind === "proxy")
      actor = new Proxy(actor, {
        getOwnPropertyDescriptor() {
          calls++;
          throw Error("trap");
        },
        get() {
          calls++;
          throw Error("trap");
        },
      });
    if (kind === "revoked") {
      const revocable = Proxy.revocable(actor, {});
      revocable.revoke();
      actor = revocable.proxy;
    }
    assert.throws(() => review(f, undefined, actor), {
      code: "OFFLINE_REFUND_NATIVE_JOIN",
    });
    assert.equal(calls, 0);
  });
for (const state of ["inactive", "buyer", "password"])
  test(`fresh ${state} native finance principal is refused despite captured grants`, async (t) => {
    const f = await setup(t),
      store = f.app.database.owned("iam");
    if (state === "inactive")
      store.run("UPDATE iam_users SET active=0 WHERE id=?", f.finance.id);
    if (state === "buyer")
      store.run(
        "UPDATE iam_users SET role='buyer',account_id=? WHERE id=?",
        f.buyer,
        f.finance.id,
      );
    if (state === "password")
      store.run(
        "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
        f.finance.id,
      );
    assert.throws(() => review(f), {
      code: state === "password" ? "PASSWORD_CHANGE_REQUIRED" : "FORBIDDEN",
    });
  });
test("detached frozen comparison/native join snapshots retain original bytes after later native changes", async (t) => {
  const f = await setup(t),
    comparison = compareOfflineFailedRefundEvidence(f.input),
    result = review(f, comparison),
    hash = result.hash;
  f.input.refundRequest.reason = "mutated caller";
  assert.equal(
    comparison.refundRequest.reason,
    "Original native refund reason",
  );
  f.app.database
    .owned("integration")
    .run(
      "UPDATE integration_effects SET error='later changed error' WHERE id=?",
      f.effectId,
    );
  assert.equal(result.hash, hash);
  assert.notEqual(result.native.effect.error, "later changed error");
  assert.throws(() => review(f, comparison), {
    code: "OFFLINE_REFUND_NATIVE_JOIN",
  });
});
