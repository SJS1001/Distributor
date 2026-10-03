import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, accept, ship, chooseProviders } from "./fixtures.ts";
import { canonical, digest } from "../src/server/core.ts";
import { offlineRefundReviewLimits } from "../src/server/billing-refunds.ts";

async function setup(
  t: Parameters<typeof fixture>[0],
  region: "CA" | "US" = "CA",
  currency: "CAD" | "USD" = region === "CA" ? "CAD" : "USD",
  reports = false,
) {
  const f = fixture(t, { eventReports: reports }, region, currency);
  const invoiceId = ship(f, accept(f, 2).id).invoiceId;
  const manual = f.app.billing.manualPayment(f.actor, "manual-payment", {
    invoiceId,
    amount: 2000,
    reference: "SYNTHETIC-BANK",
    reason: "Synthetic manual payment",
  });
  const payment = f.app.database.transaction(() =>
    f.app.billing.verifiedPayment(
      f.actor,
      invoiceId,
      20600,
      "stripe",
      "pi_synthetic_original",
    ),
  );
  const credit = f.app.billing.issueCredit(f.actor, "credit", {
    invoiceId,
    reference: "SYNTHETIC-CREDIT",
    reason: "Synthetic full credit",
    lines: [
      {
        lineId: String(f.app.billing.lines(f.actor, invoiceId)[0]!.id),
        quantity: 2,
      },
    ],
  });
  const request = (key: string, paymentId: string, amount: number) =>
    f.app.billing.refundRequest(f.actor, key, {
      invoiceId,
      paymentId,
      amount,
      reference: key,
      reason: "Synthetic refund",
    }).id;
  const refundId = request("target-refund", payment.id, 5000);
  const pendingId = request("other-reservation", payment.id, 1000);
  const manualRefundId = request("manual-refund", manual.id, 2000);
  f.app.billing.manualRefund(f.actor, "manual-proof", {
    refundId: manualRefundId,
    reference: "SYNTHETIC-REFUND-BANK",
    reason: "Synthetic bank verification",
  });
  chooseProviders(f, f.actor, "stripe-choice", {
    accountId: f.buyer,
    region,
    mode: "provider-exceptions",
    providers: ["stripe"],
    version: 1,
    acknowledgment: "Synthetic provider choice",
  });
  const effect = f.app.integration.refund(f.actor, "queue", { refundId });
  let simulatedAttempts = 0;
  await assert.rejects(
    f.app.integration.execute(f.actor, effect.id, {
      execute: async () => {
        simulatedAttempts++;
        throw Error("Synthetic lost response; no provider called");
      },
      lookup: async () => {
        throw Error("Unexpected lookup");
      },
    }),
    /Synthetic lost response/,
  );
  assert.equal(f.app.integration.effect(f.actor, effect.id).state, "unknown");
  const user = f.app.identity.createUser(f.actor, "finance", {
    email: "finance@synthetic.test",
    name: "Native finance",
    role: "finance",
    sites: [f.w1],
    password: "long-synthetic-password",
  });
  const finance = f.app.identity.currentActor({ ...f.actor, id: user.id });
  const billing = f.app.database.owned("billing");
  const review = () =>
    f.app.database.transaction(() =>
      f.app.billing.refunds.reviewOfflineFailedRefundInTransaction(
        finance,
        refundId,
      ),
    );
  const observe = (
    status: "pending" | "requires_action" | "succeeded" | "failed" | "canceled",
  ) =>
    f.app.database.transaction(() => {
      const intent = f.app.billing.refunds.intent(f.actor, refundId);
      return f.app.billing.refunds.observe(f.actor, intent, "re_synthetic", {
        ...intent,
        status,
      });
    });
  const rows = () =>
    canonical(
      billing
        .all<{ name: string }>(
          "SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE 'billing_%' ORDER BY name",
        )
        .map(({ name }) => [
          name,
          billing.all(`SELECT * FROM ${name} ORDER BY rowid`),
        ]),
    );
  return {
    ...f,
    finance,
    invoiceId,
    paymentId: payment.id,
    refundId,
    pendingId,
    manualRefundId,
    creditId: credit.id,
    effectId: effect.id,
    billing,
    review,
    observe,
    rows,
    attempts: () => simulatedAttempts,
  };
}

for (const [region, currency, reports] of [
  ["CA", "CAD", false],
  ["CA", "USD", true],
  ["US", "USD", false],
] as const)
  test(`offline Billing native unknown refund facts ${region}/${currency}/${reports} preserve complete capacity under hold`, async (t) => {
    const f = await setup(t, region, currency, reports);
    f.app.platform.isolateRestore(
      "synthetic-offline-review",
      new Date().toISOString(),
    );
    const before = f.rows(),
      r = f.review();
    const { factsHash, ...body } = r;
    assert.equal(factsHash, digest(canonical(body)));
    assert.equal(r.refund.id, f.refundId);
    assert.equal(r.refund.state, "unknown");
    assert.equal(r.originalPayment.id, f.paymentId);
    assert.equal(r.intent.paymentId, "pi_synthetic_original");
    assert.equal(r.intent.currency, currency.toLowerCase());
    assert.equal(r.invoice.account_id, f.buyer);
    assert.equal(r.refunds.length, 3);
    assert.equal(r.manualProofs.length, 1);
    assert.equal(r.providerMappings.length, 0);
    assert.equal(r.observations.length, 0);
    assert.equal(r.notices.length, 0);
    assert.deepEqual(r.capacity, {
      credited: 22600,
      paid: 22600,
      refunded: 2000,
      balance: -20600,
      pendingReservations: 6000,
      invoiceAvailable: 14600,
      originalPaymentReserved: 6000,
      originalPaymentAvailable: 14600,
    });
    assert.deepEqual(f.review(), r);
    assert.equal(f.rows(), before);
    assert.equal(f.attempts(), 1);
    assert.equal(
      f.app.integration.effect(f.actor, f.effectId).state,
      "unknown",
    );
    assert.throws(() => f.app.platform.assertProviderAccess(), {
      code: "RECOVERY_HOLD",
    });
  });

test("offline Billing review requires existing writer and fresh current finance/password/org authority", async (t) => {
  const f = await setup(t);
  assert.throws(
    () =>
      f.app.billing.refunds.reviewOfflineFailedRefundInTransaction(
        f.finance,
        f.refundId,
      ),
    { code: "TRANSACTION" },
  );
  const iam = f.app.database.owned("iam"),
    before = f.rows();
  for (const sql of [
    "UPDATE iam_users SET active=0 WHERE id=?",
    "UPDATE iam_users SET role='support' WHERE id=?",
    "UPDATE iam_users SET role='buyer',account_id='foreign' WHERE id=?",
    "UPDATE iam_users SET org_id='foreign' WHERE id=?",
    "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
  ]) {
    const rollback = Error("test rollback");
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          iam.run(sql, f.finance.id);
          assert.throws(
            () =>
              f.app.billing.refunds.reviewOfflineFailedRefundInTransaction(
                f.finance,
                f.refundId,
              ),
            (e: any) =>
              ["FORBIDDEN", "PASSWORD_CHANGE_REQUIRED"].includes(e.code),
          );
          throw rollback;
        }),
      (e) => e === rollback,
    );
    assert.equal(f.rows(), before);
  }
  const foreign = { ...f.finance, orgId: "foreign" };
  assert.throws(
    () =>
      f.app.database.transaction(() =>
        f.app.billing.refunds.reviewOfflineFailedRefundInTransaction(
          foreign,
          f.refundId,
        ),
      ),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () =>
      f.app.database.transaction(() =>
        f.app.billing.refunds.reviewOfflineFailedRefundInTransaction(
          f.finance,
          " " + f.refundId,
        ),
      ),
    { code: "VALIDATION" },
  );
});

test("offline Billing detached deep-frozen facts bind actual uncommitted native changes and rollback", async (t) => {
  const f = await setup(t),
    prior = f.review(),
    before = f.rows(),
    rollback = Error("rollback");
  assert(
    Object.isFrozen(prior) &&
      Object.isFrozen(prior.refunds) &&
      Object.isFrozen(prior.refunds[0]),
  );
  assert.throws(() => {
    (prior.refund as any).amount = 1;
  }, TypeError);
  assert.throws(() => {
    (prior.manualProofs as any).push({});
  }, TypeError);
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        f.billing.run(
          "UPDATE billing_refunds SET reference='changed-uncommitted-reference' WHERE id=?",
          f.refundId,
        );
        const inside =
          f.app.billing.refunds.reviewOfflineFailedRefundInTransaction(
            f.finance,
            f.refundId,
          );
        assert.equal(inside.refund.reference, "changed-uncommitted-reference");
        assert.notEqual(inside.factsHash, prior.factsHash);
        assert.equal(prior.refund.reference, "target-refund");
        throw rollback;
      }),
    (e) => e === rollback,
  );
  assert.equal(f.rows(), before);
  assert.deepEqual(f.review(), prior);
});

test("offline Billing returns complete prior observations/notices/reads as native facts, not first-slice eligibility", async (t) => {
  const f = await setup(t);
  for (let n = 0; n < 25; n++) {
    f.observe("requires_action");
    f.observe("pending");
  }
  f.observe("requires_action");
  const notice = f.app.billing.refunds.alerts.page(f.finance).items[0]!;
  f.app.billing.refunds.alerts.acknowledge(f.finance, "read-notice", {
    noticeId: f.refundId,
    revision: notice.revision,
  });
  f.app.platform.isolateRestore("synthetic", new Date().toISOString());
  const before = f.rows(),
    r = f.review();
  assert.equal(r.observations.length, 51);
  assert.equal(r.noticeUpdates.length, 51);
  assert.equal(r.notices[0]!.revision, 51);
  assert.equal(r.noticeReads[0]!.revision, 51);
  assert.equal(r.providerMappings[0]!.status, "requires_action");
  assert.equal(r.refund.state, "unknown");
  assert.equal(f.rows(), before);
  for (const flag of ["allowed", "qualified", "importPermit", "eligible"])
    assert(!Object.hasOwn(r, flag));
});

test("offline Billing malformed bindings, capacity, credit lines and manual proofs refuse without writes", async (t) => {
  const f = await setup(t),
    before = f.rows();
  const attacks = [
    () =>
      f.billing.run(
        "UPDATE billing_refunds SET org_id='foreign' WHERE id=?",
        f.refundId,
      ),
    () =>
      f.billing.run(
        "UPDATE billing_refunds SET payment_id='missing' WHERE id=?",
        f.refundId,
      ),
    () =>
      f.billing.run(
        "UPDATE billing_payments SET invoice_id='foreign' WHERE id=?",
        f.paymentId,
      ),
    () =>
      f.billing.run(
        "UPDATE billing_payments SET external_ref='invalid' WHERE id=?",
        f.paymentId,
      ),
    () =>
      f.billing.run(
        "UPDATE billing_payments SET amount=100 WHERE id=?",
        f.paymentId,
      ),
    () =>
      f.billing.run(
        "UPDATE billing_payments SET provider='manual' WHERE id=?",
        f.paymentId,
      ),
    () =>
      f.billing.run(
        "UPDATE billing_invoices SET account_id='foreign' WHERE id=?",
        f.invoiceId,
      ),
    () =>
      f.billing.run(
        "UPDATE billing_invoices SET currency='EUR' WHERE id=?",
        f.invoiceId,
      ),
    () =>
      f.billing.run(
        "UPDATE billing_lines SET quantity=1 WHERE invoice_id=?",
        f.invoiceId,
      ),
    () =>
      f.billing.run(
        "UPDATE billing_credits SET net=net+1,total=total+1 WHERE id=?",
        f.creditId,
      ),
    () =>
      f.billing.run(
        "UPDATE billing_credit_lines SET quantity=3 WHERE credit_id=?",
        f.creditId,
      ),
    () =>
      f.billing.run(
        "UPDATE billing_credit_lines SET org_id='foreign' WHERE credit_id=?",
        f.creditId,
      ),
    () =>
      f.billing.run(
        "UPDATE billing_refunds SET amount=22000 WHERE id=?",
        f.pendingId,
      ),
    () =>
      f.billing.run(
        "UPDATE billing_refunds SET invoice_id='foreign' WHERE id=?",
        f.pendingId,
      ),
    () =>
      f.billing.run(
        "UPDATE billing_refunds SET created_at='not-time' WHERE id=?",
        f.pendingId,
      ),
    () =>
      f.billing.run(
        "UPDATE billing_refund_proofs SET org_id='foreign' WHERE refund_id=?",
        f.manualRefundId,
      ),
    () =>
      f.billing.run(
        "DELETE FROM billing_refund_proofs WHERE refund_id=?",
        f.manualRefundId,
      ),
    () =>
      f.billing.run(
        "INSERT INTO billing_refund_proofs VALUES(?,?,?,?)",
        f.actor.orgId,
        "forged-stripe-proof",
        f.refundId,
        new Date().toISOString(),
      ),
  ];
  for (const attack of attacks) {
    const rollback = Error("test rollback");
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          attack();
          assert.throws(() =>
            f.app.billing.refunds.reviewOfflineFailedRefundInTransaction(
              f.finance,
              f.refundId,
            ),
          );
          throw rollback;
        }),
      (e) => e === rollback,
    );
    assert.equal(f.rows(), before);
    f.review();
  }
});

test("offline Billing complete history replay rejects damaged mapping, middle observation, notice/update/read facts", async (t) => {
  const f = await setup(t);
  f.observe("requires_action");
  f.observe("pending");
  f.observe("requires_action");
  f.app.billing.refunds.alerts.acknowledge(f.finance, "read", {
    noticeId: f.refundId,
    revision: 3,
  });
  const before = f.rows();
  for (const sql of [
    "UPDATE billing_refund_provider SET status='succeeded'",
    "UPDATE billing_refund_provider SET org_id='foreign'",
    "UPDATE billing_refund_observations SET applied=0 WHERE id=(SELECT MIN(id)+1 FROM billing_refund_observations)",
    "UPDATE billing_refund_observations SET external_ref='re_wrong' WHERE id=(SELECT MIN(id) FROM billing_refund_observations)",
    "DELETE FROM billing_refund_alert_updates WHERE revision=2",
    "UPDATE billing_refund_alert_updates SET state='resolved' WHERE revision=1",
    "UPDATE billing_refund_alert_updates SET created_at='not-time' WHERE revision=1",
    "UPDATE billing_refund_alerts SET revision=4",
    "UPDATE billing_refund_alerts SET invoice_id='foreign'",
    "UPDATE billing_refund_alerts SET created_at='2000-01-01T00:00:00.000Z'",
    "UPDATE billing_refund_alert_reads SET revision=99",
    "UPDATE billing_refund_alert_reads SET org_id='foreign'",
  ]) {
    const rollback = Error("rollback");
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          f.billing.run(sql);
          assert.throws(
            () =>
              f.app.billing.refunds.reviewOfflineFailedRefundInTransaction(
                f.finance,
                f.refundId,
              ),
            { code: "OFFLINE_REFUND_REVIEW" },
          );
          throw rollback;
        }),
      (e) => e === rollback,
    );
    assert.equal(f.rows(), before);
    f.review();
  }
});

test("offline Billing bounded complete history refuses overflow instead of a truncated page", async (t) => {
  const f = await setup(t);
  for (let i = 0; i < offlineRefundReviewLimits.rowsPerSet; i++)
    f.observe("pending");
  assert.equal(
    f.review().observations.length,
    offlineRefundReviewLimits.rowsPerSet,
  );
  f.observe("pending");
  const before = f.rows();
  assert.throws(() => f.review(), { code: "OFFLINE_REFUND_REVIEW_LIMIT" });
  assert.equal(f.rows(), before);
});

test("offline Billing refuses a terminal target; reservations remain native accounting facts", async (t) => {
  const f = await setup(t);
  f.observe("failed");
  assert.throws(() => f.review(), { code: "OFFLINE_REFUND_REVIEW" });
  assert.equal(
    f.app.billing.refunds.get(f.finance, f.refundId).row.state,
    "rejected",
  );
});

test("offline Billing replays ignored pending after success and later action without inventing eligibility", async (t) => {
  const f = await setup(t);
  f.observe("succeeded");
  f.observe("pending");
  f.observe("requires_action");
  const r = f.review();
  assert.deepEqual(
    r.observations.map((o) => o.applied),
    [1, 0, 1],
  );
  assert.equal(r.refund.state, "unknown");
  assert.equal(r.noticeUpdates.length, 1);
  assert.equal(r.notices[0]!.status, "requires_action");
  assert.equal(r.capacity.originalPaymentReserved, 6000);
});

test("offline Billing notices retain legacy existing-state source and reject false lineage", async (t) => {
  const f = await setup(t);
  f.observe("requires_action");
  f.observe("pending");
  f.observe("requires_action");
  const rollback = Error("rollback legacy fixture");
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        // Test-only reconstruction of the documented pre-notice initialization form:
        // the last retained exception is exposed as revision one, with original
        // observations unchanged. This does not claim a new observation occurred.
        f.billing.run("DELETE FROM billing_refund_alert_updates");
        f.billing.run(
          "UPDATE billing_refund_alerts SET revision=1,created_at=(SELECT MAX(created_at) FROM billing_refund_observations)",
        );
        f.billing.run(
          "INSERT INTO billing_refund_alert_updates SELECT org_id,refund_id,revision,status,state,'existing-state',updated_at FROM billing_refund_alerts",
        );
        const r = f.app.billing.refunds.reviewOfflineFailedRefundInTransaction(
          f.finance,
          f.refundId,
        );
        assert.equal(r.observations.length, 3);
        assert.equal(r.noticeUpdates.length, 1);
        assert.equal(r.noticeUpdates[0]!.source, "existing-state");
        f.billing.run(
          "UPDATE billing_refund_alert_updates SET status='failed',state='open'",
        );
        assert.throws(
          () =>
            f.app.billing.refunds.reviewOfflineFailedRefundInTransaction(
              f.finance,
              f.refundId,
            ),
          { code: "OFFLINE_REFUND_REVIEW" },
        );
        throw rollback;
      }),
    (e) => e === rollback,
  );
});

test("offline Billing complete byte budget rejects oversized retained facts without truncation", async (t) => {
  const f = await setup(t),
    before = f.rows(),
    rollback = Error("rollback");
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        f.billing.run(
          "UPDATE billing_lines SET description=? WHERE invoice_id=?",
          "x".repeat(offlineRefundReviewLimits.bytes + 1),
          f.invoiceId,
        );
        assert.throws(
          () =>
            f.app.billing.refunds.reviewOfflineFailedRefundInTransaction(
              f.finance,
              f.refundId,
            ),
          { code: "OFFLINE_REFUND_REVIEW_LIMIT" },
        );
        throw rollback;
      }),
    (e) => e === rollback,
  );
  assert.equal(f.rows(), before);
});

test("offline Billing refuses imported opening facts instead of excluding them from capacity", async (t) => {
  const f = await setup(t),
    rollback = Error("rollback");
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        f.billing.run(
          "INSERT INTO billing_opening_documents VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          f.invoiceId,
          f.actor.orgId,
          "synthetic-source",
          "synthetic-id",
          "synthetic-batch",
          "a".repeat(64),
          "2026-10-01T00:00:00.000Z",
          "2026-10-01T00:00:00.000Z",
          "2026-10-02T00:00:00.000Z",
          0,
          0,
          0,
          22600,
          f.actor.id,
          new Date().toISOString(),
        );
        assert.throws(
          () =>
            f.app.billing.refunds.reviewOfflineFailedRefundInTransaction(
              f.finance,
              f.refundId,
            ),
          { code: "OFFLINE_REFUND_REVIEW" },
        );
        throw rollback;
      }),
    (e) => e === rollback,
  );
});

test("offline Billing projection reads only Billing and fresh IAM owners and emits no receipts or events", async (t) => {
  const f = await setup(t);
  const seen = new Set<string>();
  const execute = f.app.database.execute.bind(f.app.database);
  t.mock.method(
    f.app.database,
    "execute",
    (
      owner: Parameters<typeof execute>[0],
      fn: Parameters<typeof execute>[1],
    ) => {
      seen.add(owner);
      return execute(owner, fn);
    },
  );
  for (const method of ["audit", "event", "command"] as const)
    t.mock.method(f.app.platform, method, () => {
      throw Error("Read-only projection attempted a receipt/event write");
    });
  const before = f.rows();
  f.review();
  assert.deepEqual([...seen].sort(), ["billing", "iam"]);
  assert.equal(f.rows(), before);
});
