import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { accept, chooseProviders, fixture, ship } from "./fixtures.ts";
import { canonical, digest } from "../src/server/core.ts";
import { Application } from "../src/server/application.ts";
import { IntegrationOfflineRefundReview } from "../src/server/integration-offline-refund-review.ts";

// These are missing-contract reproductions against the actual native readers.
// No application implementation or fabricated qualification is substituted.
const inherent = [
  "BILLING_COMPLETE_HISTORY_REQUIRED",
  "INBOX_UNATTRIBUTED_HISTORY_UNAVAILABLE",
  "PLATFORM_RECEIPT_HISTORY_REQUIRED",
];
async function setup(
  t: TestContext,
  region: "CA" | "US" = "CA",
  currency: "CAD" | "USD" = "CAD",
) {
  const f = fixture(t, {}, region, currency);
  const invoiceId = ship(f, accept(f, 2).id).invoiceId;
  chooseProviders(f, f.actor, "choice", {
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
      "pi_gap_original",
    ),
  );
  f.app.billing.issueCredit(f.actor, "credit", {
    invoiceId,
    reference: "GAP-CREDIT",
    reason: "Synthetic native credit",
    lines: [
      {
        lineId: String(f.app.billing.lines(f.actor, invoiceId)[0]!.id),
        quantity: 1,
      },
    ],
  });
  const refund = f.app.billing.refundRequest(f.actor, "refund", {
    invoiceId,
    paymentId: payment.id,
    amount: 5000,
    reference: "GAP-REFUND",
    reason: "Synthetic native refund",
  });
  const effect = f.app.integration.refund(f.actor, "queue", {
    refundId: refund.id,
  });
  let syntheticCalls = 0;
  await assert.rejects(
    f.app.integration.execute(f.actor, effect.id, {
      execute: async (_effect, beforeWrite) => {
        beforeWrite?.();
        syntheticCalls++;
        throw Error("synthetic lost response: no provider called");
      },
      lookup: async () => {
        throw Error("unexpected synthetic lookup");
      },
    }),
    /synthetic lost response/,
  );
  assert.equal(syntheticCalls, 1);
  const { id } = f.app.identity.createUser(f.actor, "finance", {
    name: "Gap finance",
    email: "gap-finance@example.test",
    password: "synthetic-long-password",
    role: "finance",
    sites: [],
  });
  const finance = f.app.identity.currentActor({ ...f.actor, id });
  f.app.platform.isolateRestore(
    "synthetic-gap-source",
    new Date().toISOString(),
  );
  return Object.assign(f, {
    invoiceId,
    refundId: refund.id,
    effectId: effect.id,
    finance,
  });
}
type Fixture = Awaited<ReturnType<typeof setup>>;
function reader(f: Fixture) {
  return new IntegrationOfflineRefundReview(
    f.app.database,
    f.app.identity,
    f.app.billing,
  );
}
function review(f: Fixture) {
  return f.app.database.transaction(() =>
    reader(f).getInTransaction(f.finance, f.effectId),
  );
}
function facts(f: Fixture) {
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
for (const [region, currency] of [
  ["CA", "CAD"],
  ["CA", "USD"],
  ["US", "USD"],
] as const)
  test(`clean first-unknown ${region}/${currency} still has all inherent blockers after actual Billing/Platform reads`, async (t) => {
    const f = await setup(t, region, currency),
      before = facts(f);
    const result = f.app.database.transaction(() => {
      const billing =
        f.app.billing.refunds.reviewOfflineFailedRefundInTransaction(
          f.finance,
          f.refundId,
        );
      const platform = f.app.platformOfflineRefundReview.getInTransaction(
        f.finance,
        f.refundId,
        f.effectId,
      );
      const integration = reader(f).getInTransaction(f.finance, f.effectId);
      return { billing, platform, integration };
    });
    const r = result.integration;
    assert.equal(r.region, region);
    assert.equal(r.currency, currency);
    assert.equal(r.effect.state, "unknown");
    assert.equal(r.billing.row.state, "unknown");
    assert.equal(r.effect.result, null);
    assert.equal(r.effect.external_ref, null);
    assert.equal(r.polls.length, 1);
    assert.equal(r.polls[0]!.token, null);
    assert.equal(r.polls[0]!.started_at, null);
    for (const rows of [
      r.offlineImports,
      r.leases,
      r.refundCallbacks,
      r.checkoutCallbacks,
      r.inbox,
      r.paymentAllocations,
      r.refundMappings,
      r.creditApplications,
      r.checkoutObservations,
      r.balanceReads,
      r.balanceObservations,
    ])
      assert.deepEqual(rows, []);
    for (const rows of [
      result.billing.observations,
      result.billing.providerMappings,
      result.billing.manualProofs,
      result.billing.notices,
      result.billing.noticeUpdates,
      result.billing.noticeReads,
    ])
      assert.deepEqual(rows, []);
    assert.equal(result.platform.requests.length, 1);
    assert.equal(result.platform.queues.length, 1);
    assert.deepEqual(r.blockers, inherent);
    assert(Object.isFrozen(r));
    assert(Object.isFrozen(r.blockers));
    assert.equal(facts(f), before);
    assert.throws(() => f.app.platform.assertProviderAccess(), {
      code: "RECOVERY_HOLD",
    });
  });

test("unattributed inbox event cannot be cleared by an unchanged native hash", async (t) => {
  const f = await setup(t),
    before = review(f),
    store = f.app.database.owned("integration");
  store.run(
    "INSERT INTO integration_inbox VALUES(?,?,?,?)",
    "stripe",
    "evt_unattributed_gap",
    digest("synthetic unrelated-or-missing-link event bytes"),
    new Date().toISOString(),
  );
  const retained = facts(f),
    after = review(f);
  assert.equal(store.get("SELECT count(*) AS n FROM integration_inbox")!.n, 1);
  assert.deepEqual(after.inbox, []);
  assert.equal(after.hash, before.hash);
  assert.deepEqual(after.blockers, inherent);
  assert.equal(facts(f), retained);
  // No assertion that this event belongs to the refund: that is the missing fact.
});

for (const org of ["same", "foreign"] as const)
  test(`unlinked ${org}-org callback with proposed re_ identity is outside null-reference review`, async (t) => {
    const f = await setup(t),
      before = review(f),
      store = f.app.database.owned("integration");
    store.run(
      "INSERT INTO integration_refund_callbacks VALUES(?,?,?,?,?,?,?,?,'pending',0,NULL,0,NULL,?)",
      "orphan-gap-callback",
      org === "same" ? f.actor.orgId : "foreign-org",
      "synthetic-binding",
      "evt_orphan_gap",
      "unlinked-effect",
      "re_proposed_gap",
      "refund.failed",
      digest("synthetic event bytes"),
      new Date().toISOString(),
    );
    const retained = facts(f),
      after = review(f);
    assert.deepEqual(after.refundCallbacks, []);
    assert.equal(after.hash, before.hash);
    assert(after.blockers.includes("INBOX_UNATTRIBUTED_HISTORY_UNAVAILABLE"));
    assert.equal(
      store.get(
        "SELECT count(*) AS n FROM integration_refund_callbacks WHERE provider_reference='re_proposed_gap'",
      )!.n,
      1,
    );
    assert.equal(facts(f), retained);
  });

test("claimed polls and generic leases add retained blockers instead of replacing inherent limitations", async (t) => {
  const f = await setup(t),
    before = review(f),
    store = f.app.database.owned("integration");
  const stop = Error("intentional rollback");
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        store.run(
          "UPDATE integration_refund_polls SET token='retained-claim',started_at=123 WHERE effect_id=?",
          f.effectId,
        );
        const retained = facts(f),
          claimed = reader(f).getInTransaction(f.finance, f.effectId);
        assert.deepEqual(
          claimed.blockers,
          [...inherent, "RETAINED_REFUND_CLAIM"].sort(),
        );
        assert.notEqual(claimed.hash, before.hash);
        assert.equal(facts(f), retained);
        store.run(
          "INSERT INTO integration_operation_leases VALUES(?,?,?,?)",
          f.effectId,
          f.actor.orgId,
          "lease",
          123,
        );
        const leased = reader(f).getInTransaction(f.finance, f.effectId);
        assert(leased.blockers.includes("RETAINED_GENERIC_LEASES"));
        assert(inherent.every((code) => leased.blockers.includes(code)));
        throw stop;
      }),
    (e) => e === stop,
  );
  assert.deepEqual(review(f), before);
});

test("arbitrary canonical provenance is retained history, not a qualification token", async (t) => {
  const f = await setup(t),
    store = f.app.database.owned("integration"),
    before = review(f);
  const record = canonical({ version: 1, unverifiedCallerClaim: "complete" });
  store.run(
    "INSERT INTO integration_offline_failed_refunds VALUES(?,?,?,?,?,?)",
    f.effectId,
    f.actor.orgId,
    "synthetic-gap-request",
    digest("binding"),
    record,
    digest(record),
  );
  const after = review(f),
    retained = facts(f);
  assert.notEqual(after.hash, before.hash);
  assert.deepEqual(
    after.blockers,
    [...inherent, "RETAINED_OFFLINE_REFUND_IMPORT"].sort(),
  );
  assert.equal(after.effect.state, "unknown");
  assert.equal(after.billing.row.state, "unknown");
  assert.throws(
    () =>
      store.run(
        "DELETE FROM integration_offline_failed_refunds WHERE effect_id=?",
        f.effectId,
      ),
    /append-only/,
  );
  assert.throws(
    () =>
      store.run(
        "UPDATE integration_offline_failed_refunds SET record='{}' WHERE effect_id=?",
        f.effectId,
      ),
    /append-only/,
  );
  assert.equal(facts(f), retained);
});

test("current native transaction and role/password/org authority remain mandatory during gap reproduction", async (t) => {
  const f = await setup(t),
    iam = f.app.database.owned("iam");
  assert.throws(() => reader(f).getInTransaction(f.finance, f.effectId), {
    code: "TRANSACTION",
  });
  for (const sql of [
    "UPDATE iam_users SET role='support' WHERE id=?",
    "UPDATE iam_users SET active=0 WHERE id=?",
    "UPDATE iam_users SET org_id='other' WHERE id=?",
    "UPDATE iam_users SET account_id='buyer' WHERE id=?",
    "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
  ]) {
    const stop = Error("rollback authority");
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          iam.run(sql, f.finance.id);
          const before = facts(f);
          assert.throws(
            () =>
              reader(f).getInTransaction(
                { ...f.finance, role: "admin", accountId: null },
                f.effectId,
              ),
            {
              code: sql.includes("password_change_required")
                ? "PASSWORD_CHANGE_REQUIRED"
                : "FORBIDDEN",
            },
          );
          assert.equal(facts(f), before);
          throw stop;
        }),
      (e) => e === stop,
    );
  }
  assert.deepEqual(review(f).blockers, inherent);
});

test("reopen retains unknown state and all blockers without any import or receipt append", async (t) => {
  const f = await setup(t),
    before = review(f),
    rows = facts(f);
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(review(f), before);
  assert.equal(facts(f), rows);
  assert.equal(
    f.app.database
      .owned("integration")
      .get("SELECT count(*) AS n FROM integration_offline_failed_refunds")!.n,
    0,
  );
});
