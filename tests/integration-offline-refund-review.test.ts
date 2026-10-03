import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, ship, accept, chooseProviders } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { canonical, digest, type Actor } from "../src/server/core.ts";
import type { Region } from "../src/server/iam.ts";

async function setup(
  t: Parameters<typeof fixture>[0],
  region: Region = "CA",
  currency: "CAD" | "USD" = "CAD",
  reports = false,
) {
  const f = fixture(t, { eventReports: reports }, region, currency);
  const invoiceId = ship(f, accept(f, 2).id).invoiceId;
  chooseProviders(f, f.actor, "choice", {
    accountId: f.buyer,
    region,
    mode: "provider-exceptions",
    providers: ["stripe", "quickbooks"],
    version: 1,
    acknowledgment: "Synthetic consent",
  });
  const payment = f.app.database.transaction(() =>
    f.app.billing.verifiedPayment(
      f.actor,
      invoiceId,
      22600,
      "stripe",
      "pi_original",
    ),
  );
  const credit = f.app.billing.issueCredit(f.actor, "credit", {
    invoiceId,
    reference: "CR1",
    reason: "Synthetic original credit",
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
    reference: "REF1",
    reason: "Synthetic refund",
  });
  const effect = f.app.integration.refund(f.actor, "queue", {
    refundId: refund.id,
  });
  let sends = 0;
  await assert.rejects(
    f.app.integration.execute(f.actor, effect.id, {
      execute: async (_e, beforeWrite) => {
        beforeWrite?.();
        sends++;
        throw Error("synthetic lost response");
      },
      lookup: async () => {
        throw Error("unexpected lookup");
      },
    }),
    /synthetic lost response/,
  );
  assert.equal(sends, 1);
  return Object.assign(f, {
    invoiceId,
    paymentId: payment.id,
    refundId: refund.id,
    effectId: effect.id,
    creditId: credit.id,
  });
}
type Fixture = Awaited<ReturnType<typeof setup>>;
test("immutable offline import provenance participates in complete facts and prevents first-import eligibility", async (t) => {
  const f = await setup(t),
    before = review(f),
    store = f.app.database.owned("integration");
  const record = canonical({
    version: 1,
    originalPoll: before.polls[0],
    observationId: 1,
  });
  store.run(
    "INSERT INTO integration_offline_failed_refunds VALUES(?,?,?,?,?,?)",
    f.effectId,
    f.actor.orgId,
    "synthetic-offline-request",
    digest("synthetic-binding"),
    record,
    digest(record),
  );
  const after = review(f);
  assert.notEqual(after.hash, before.hash);
  assert.equal(after.offlineImports.length, 1);
  assert(after.blockers.includes("RETAINED_OFFLINE_REFUND_IMPORT"));
  assert.equal(after.effect.state, "unknown");
  assert.equal(after.billing.row.state, "unknown");
  frozen(after);
});
for (const [name, org, record, hash] of [
  ["foreign organization", "other-org", "{}", digest("{}")],
  ["mismatched retained digest", null, "{}", digest("different")],
  [
    "noncanonical retained record",
    null,
    '{ "version": 1 }',
    digest('{ "version": 1 }'),
  ],
  ["malformed retained JSON", null, "{", digest("{")],
] as const)
  test(`offline provenance review refuses ${name} without owner mutation`, async (t) => {
    const f = await setup(t),
      store = f.app.database.owned("integration");
    store.run(
      "INSERT INTO integration_offline_failed_refunds VALUES(?,?,?,?,?,?)",
      f.effectId,
      org ?? f.actor.orgId,
      "request-a",
      digest("binding-a"),
      record,
      hash,
    );
    const before = store.get("SELECT total_changes() AS n")!.n;
    assert.throws(() => review(f), { code: "OFFLINE_REFUND_REVIEW" });
    assert.equal(store.get("SELECT total_changes() AS n")!.n, before);
  });
function review(f: Fixture, actor: Actor = f.actor) {
  return f.app.database.transaction(() =>
    f.app.integration.reviewOfflineFailedRefundInTransaction(actor, f.effectId),
  );
}
function frozen(value: unknown) {
  if (value && typeof value === "object") {
    assert(Object.isFrozen(value));
    for (const child of Object.values(value)) frozen(child);
  }
}
for (const [region, currency, reports] of [
  ["CA", "CAD", false],
  ["CA", "USD", true],
  ["US", "USD", false],
  ["US", "CAD", true],
] as const) {
  test(`native review preserves held unknown refund and complete owner facts: ${region}/${currency}/${reports}`, async (t) => {
    const f = await setup(t, region, currency, reports);
    f.app.platform.isolateRestore("synthetic-only", "2026-10-03T00:00:00.000Z");
    const store = f.app.database.owned("integration");
    const before = store.get("SELECT total_changes() AS n")!.n;
    const held = f.app.platform.recoveryHold();
    const r = review(f);
    assert.equal(store.get("SELECT total_changes() AS n")!.n, before);
    assert.deepEqual(f.app.platform.recoveryHold(), held);
    assert.equal(r.currency, currency);
    assert.equal(r.effect.state, "unknown");
    assert.equal(r.billing.row.state, "unknown");
    assert.equal(r.intent.paymentId, "pi_original");
    assert.equal(r.billing.payment.id, f.paymentId);
    assert.equal(r.polls.length, 1);
    assert.equal(r.polls[0]!.token, null);
    assert.deepEqual(r.blockers, [
      "BILLING_COMPLETE_HISTORY_REQUIRED",
      "INBOX_UNATTRIBUTED_HISTORY_UNAVAILABLE",
      "PLATFORM_RECEIPT_HISTORY_REQUIRED",
    ]);
    const { hash, ...facts } = r;
    assert.equal(
      hash,
      digest(
        canonical({
          purpose: "distributor-integration-offline-refund-review-v1",
          facts,
        }),
      ),
    );
    assert.deepEqual(review(f), r);
    frozen(r);
    assert.throws(() => {
      (r.polls[0] as any).token = "changed";
    }, TypeError);
    assert.throws(() => {
      (r.intent as any).amount = 1;
    }, TypeError);
    assert.equal(review(f).intent.amount, 5000);
    assert.throws(
      () =>
        f.app.integration.reviewOfflineFailedRefundInTransaction(
          f.actor,
          f.effectId,
        ),
      { code: "TRANSACTION" },
    );
    await assert.rejects(
      f.app.integration.reconcile(f.actor, f.effectId, {
        execute: async () => {
          throw Error("transport");
        },
        lookup: async () => {
          throw Error("transport");
        },
      }),
      { code: "RECOVERY_HOLD" },
    );
  });
}

test("fresh native finance, account, organization and password scope precedes review", async (t) => {
  const f = await setup(t);
  const iam = f.app.database.owned("iam");
  for (const role of ["support", "commercial", "buyer", "warehouse"]) {
    iam.run("UPDATE iam_users SET role=? WHERE id=?", role, f.actor.id);
    assert.throws(
      () => review(f, { ...f.actor, role: "admin", sites: [f.w1] }),
      { code: "FORBIDDEN" },
    );
  }
  iam.run(
    "UPDATE iam_users SET role='admin',account_id=? WHERE id=?",
    f.buyer,
    f.actor.id,
  );
  assert.throws(() => review(f), { code: "FORBIDDEN" });
  iam.run(
    "UPDATE iam_users SET account_id=NULL,active=0 WHERE id=?",
    f.actor.id,
  );
  assert.throws(() => review(f), { code: "FORBIDDEN" });
  iam.run("UPDATE iam_users SET active=1 WHERE id=?", f.actor.id);
  iam.run(
    "INSERT INTO iam_user_security(user_id,revision,password_change_required,updated_at) VALUES(?,1,1,?)",
    f.actor.id,
    "2026-10-03T00:00:00.000Z",
  );
  assert.throws(() => review(f), { code: "PASSWORD_CHANGE_REQUIRED" });
  iam.run(
    "UPDATE iam_user_security SET password_change_required=0 WHERE user_id=?",
    f.actor.id,
  );
  const user = f.app.identity.createUser(f.actor, "foreign-finance", {
    email: "foreign@example.test",
    name: "Foreign finance",
    role: "finance",
    sites: [],
    password: "synthetic-fixture-password",
  });
  // Bootstrap intentionally supports one initial org; this is a copied-scope adversary.
  iam.run(
    "INSERT INTO iam_organizations SELECT 'other-org','Other',region,currency,policy FROM iam_organizations WHERE id=?",
    f.actor.orgId,
  );
  iam.run("UPDATE iam_users SET org_id='other-org' WHERE id=?", user.id);
  const other = { ...f.actor, id: user.id, orgId: "other-org" };
  assert.throws(() => review(f, other), { code: "NOT_FOUND" });
  assert.throws(() => review(f, { ...f.actor, orgId: other.orgId }), {
    code: "FORBIDDEN",
  });
  assert.equal(review(f).effectId, f.effectId);
});

test("review retains exact outstanding claim, sees writer changes, rolls back and survives restart", async (t) => {
  const f = await setup(t);
  const before = review(f);
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        f.app.database
          .owned("integration")
          .run(
            "UPDATE integration_refund_polls SET token='original-claim',started_at=123 WHERE effect_id=?",
            f.effectId,
          );
        const r = f.app.integration.reviewOfflineFailedRefundInTransaction(
          f.actor,
          f.effectId,
        );
        assert.equal(r.polls[0]!.token, "original-claim");
        assert.equal(r.polls[0]!.started_at, 123);
        assert(r.blockers.includes("RETAINED_REFUND_CLAIM"));
        assert.notEqual(r.hash, before.hash);
        assert.equal(before.polls[0]!.token, null);
        throw Error("rollback fixture");
      }),
    /rollback fixture/,
  );
  assert.deepEqual(review(f), before);
  f.app.close();
  f.app = new Application(f.path, "CA");
  assert.deepEqual(review(f), before);
});

test("native terminal callback outcomes remain visible and are never rewritten to unknown", async (t) => {
  const f = await setup(t);
  const callback = f.app.integration.refundCallbacks.receive(f.actor, {
    bindingId: "binding",
    eventId: "evt_failed",
    effectId: f.effectId,
    reference: "re_failed",
    eventType: "refund.failed",
    hash: digest("synthetic signed bytes"),
    refundId: f.refundId,
    paymentId: "pi_original",
    amount: 5000,
    currency: "cad",
  });
  assert.equal(review(f).refundCallbacks[0]!.state, "pending");
  await f.app.integration.refundCallbacks.run(f.actor, callback.id, {
    execute: async () => {
      throw Error("unexpected send");
    },
    lookup: async (e) => ({
      reference: "re_failed",
      result: { ...JSON.parse(e.payload), effectId: e.id, status: "failed" },
    }),
  });
  const r = review(f);
  assert.equal(r.effect.state, "completed");
  assert.equal(r.billing.row.state, "rejected");
  assert.equal(r.refundCallbacks[0]!.state, "completed");
  assert(r.blockers.includes("RETAINED_CALLBACK_LINEAGE"));
  assert(r.blockers.includes("RETAINED_PROVIDER_OR_MANUAL_OUTCOME"));
  assert.equal(r.inbox.length, 0); // Refund completion never inserts checkout inbox receipts.
});

test("copied/malformed owner rows refuse rather than conceal inconsistent lineage", async (t) => {
  const f = await setup(t);
  const store = f.app.database.owned("integration");
  const cases: [string, (s: typeof store) => void][] = [
    [
      "payload whitespace",
      (s) =>
        s.run(
          "UPDATE integration_effects SET payload=payload||' ' WHERE id=?",
          f.effectId,
        ),
    ],
    [
      "invalid JSON",
      (s) =>
        s.run(
          "UPDATE integration_effects SET payload='{' WHERE id=?",
          f.effectId,
        ),
    ],
    [
      "wrong native amount",
      (s) =>
        s.run(
          "UPDATE integration_effects SET payload=json_set(payload,'$.amount',1) WHERE id=?",
          f.effectId,
        ),
    ],
    [
      "wrong account",
      (s) =>
        s.run(
          "UPDATE integration_effects SET account_id='foreign' WHERE id=?",
          f.effectId,
        ),
    ],
    [
      "foreign poll",
      (s) =>
        s.run(
          "UPDATE integration_refund_polls SET org_id='foreign' WHERE effect_id=?",
          f.effectId,
        ),
    ],
    [
      "partial claim",
      (s) =>
        s.run(
          "UPDATE integration_refund_polls SET token='orphan',started_at=NULL WHERE effect_id=?",
          f.effectId,
        ),
    ],
    [
      "missing poll",
      (s) =>
        s.run(
          "DELETE FROM integration_refund_polls WHERE effect_id=?",
          f.effectId,
        ),
    ],
    [
      "fake completed",
      (s) =>
        s.run(
          "UPDATE integration_effects SET state='completed' WHERE id=?",
          f.effectId,
        ),
    ],
    [
      "orphan allocation",
      (s) =>
        s.run(
          "INSERT INTO integration_payment_allocations VALUES('missing',?,?,?,0)",
          f.actor.orgId,
          f.invoiceId,
          f.paymentId,
        ),
    ],
    [
      "foreign copied effect",
      (s) =>
        s.run(
          "INSERT INTO integration_effects SELECT 'copied','foreign',account_id,provider,kind,reference,payload,state,external_ref,result,created_at,residency_version,started_at,error FROM integration_effects WHERE id=?",
          f.effectId,
        ),
    ],
  ];
  for (const [name, corrupt] of cases)
    await t.test(name, () => {
      assert.throws(
        () =>
          f.app.database.transaction(() => {
            corrupt(store);
            f.app.integration.reviewOfflineFailedRefundInTransaction(
              f.actor,
              f.effectId,
            );
          }),
        (e: any) => ["OFFLINE_REFUND_REVIEW", "NOT_FOUND"].includes(e.code),
      );
    });
  assert.equal(review(f).effect.state, "unknown");
});

test("bounded enumeration refuses overflow instead of a successful first page", async (t) => {
  const f = await setup(t);
  const s = f.app.database.owned("integration");
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        for (let i = 0; i < 65; i++)
          s.run(
            "INSERT INTO integration_refund_callbacks(id,org_id,binding_id,event_id,effect_id,provider_reference,event_type,hash,state,created_at) VALUES(?,?,?,?,?,?,'refund.failed',?,'completed',?)",
            `callback-${i}`,
            f.actor.orgId,
            "binding",
            `evt_${i}`,
            f.effectId,
            "re_failed",
            digest("synthetic"),
            "2026-10-03T00:00:00.000Z",
          );
        f.app.integration.reviewOfflineFailedRefundInTransaction(
          f.actor,
          f.effectId,
        );
      }),
    { code: "OFFLINE_REFUND_REVIEW_LIMIT" },
  );
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        s.run(
          "UPDATE integration_effects SET error=? WHERE id=?",
          "x".repeat(65537),
          f.effectId,
        );
        f.app.integration.reviewOfflineFailedRefundInTransaction(
          f.actor,
          f.effectId,
        );
      }),
    { code: "OFFLINE_REFUND_REVIEW_LIMIT" },
  );
});

async function accounting(f: Fixture, appliedAmount = 22600) {
  const delivered = (reference: string) => ({
    execute: async () => ({ reference, result: {} }),
    lookup: async () => null,
  });
  const invoice = f.app.integration.accounting(f.actor, "qb-invoice", {
    invoiceId: f.invoiceId,
    customerRef: "customer",
    itemRefs: { [f.product]: "item" },
    taxCodeRef: "tax",
    taxRateRef: "rate",
  });
  await f.app.integration.execute(f.actor, invoice.id, delivered("invoice-1"));
  const payment = f.app.integration.accountingPayment(f.actor, "qb-payment", {
    paymentId: f.paymentId,
    appliedAmount,
    depositAccountRef: "bank",
  });
  await f.app.integration.execute(
    f.actor,
    payment.id,
    delivered("payment:payment-1"),
  );
  const credit = f.app.integration.accountingCredit(f.actor, "qb-credit", {
    creditId: f.creditId,
  });
  await f.app.integration.execute(
    f.actor,
    credit.id,
    delivered("credit:credit-1"),
  );
  await f.app.integration.refunds.run(
    f.actor,
    f.effectId,
    {
      execute: async () => {
        throw Error("no send");
      },
      lookup: async (e) => ({
        reference: "re_original",
        result: {
          ...JSON.parse(e.payload),
          effectId: e.id,
          status: "succeeded",
        },
      }),
    },
    false,
  );
  const expense = f.app.integration.accountingRefund(f.actor, "qb-refund", {
    refundId: f.refundId,
    creditId: f.creditId,
    bankAccountRef: "bank",
    receivableAccountRef: "ar",
    nonTaxCodeRef: "NON",
    expenseDate: "2026-10-03",
  });
  await f.app.integration.execute(
    f.actor,
    expense.id,
    delivered("expense:expense-1"),
  );
  const link = f.app.integration.accountingRefundApplication(
    f.actor,
    "qb-link",
    { refundId: f.refundId },
  );
  await f.app.integration.execute(
    f.actor,
    link.id,
    delivered("refund-application:link-1"),
  );
  return { invoice, payment, credit, expense, link };
}

test("real accounting descendants and allocations remain complete with exact generic claims", async (t) => {
  const f = await setup(t);
  const chain = await accounting(f);
  const s = f.app.database.owned("integration");
  const before = review(f);
  assert.equal(before.refundMappings.length, 1);
  assert.equal(before.paymentAllocations.length, 1);
  assert(before.effects.some((e) => e.id === chain.link.id));
  assert(before.blockers.includes("RETAINED_ACCOUNTING_LINEAGE"));
  f.app.database.transaction(() => {
    s.run(
      "UPDATE integration_operation_leases SET token='actual-retained-claim',started_at=567 WHERE effect_id=?",
      chain.expense.id,
    );
    const r = f.app.integration.reviewOfflineFailedRefundInTransaction(
      f.actor,
      f.effectId,
    );
    assert.equal(
      r.leases.find((e) => e.effect_id === chain.expense.id)!.token,
      "actual-retained-claim",
    );
    assert.equal(
      r.leases.find((e) => e.effect_id === chain.expense.id)!.started_at,
      567,
    );
    assert(r.blockers.includes("RETAINED_GENERIC_LEASES"));
  });
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        s.run(
          "UPDATE integration_accounting_refunds SET credit_id='wrong-credit' WHERE effect_id=?",
          chain.expense.id,
        );
        f.app.integration.reviewOfflineFailedRefundInTransaction(
          f.actor,
          f.effectId,
        );
      }),
    { code: "OFFLINE_REFUND_REVIEW" },
  );
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        s.run(
          "UPDATE integration_effects SET payload=json_set(payload,'$.refund.amount',1) WHERE id=?",
          chain.link.id,
        );
        f.app.integration.reviewOfflineFailedRefundInTransaction(
          f.actor,
          f.effectId,
        );
      }),
    { code: "OFFLINE_REFUND_REVIEW" },
  );
});

test("native canceled credit allocations and balance history remain retained, including terminal records", async (t) => {
  const f = await setup(t);
  const chain = await accounting(f, 11300);
  const application = f.app.integration.accountingCreditApplication(
    f.actor,
    "apply-rest",
    { creditId: f.creditId, amount: 1000 },
  );
  const view = f.app.integration
    .list(f.actor)
    .find((e) => e.id === application.id)!.accountingApplication!;
  f.app.integration.cancelCreditApplication(f.actor, "cancel-rest", {
    effectId: application.id,
    reviewVersion: view.reviewVersion,
    amount: view.amount,
    reason: "Synthetic retained cancellation",
  });
  await f.app.integration.balances.refresh(
    f.actor,
    chain.invoice.id,
    "balance-read",
    {
      execute: async () => {
        throw Error("no write");
      },
      lookup: async () => null,
      readInvoiceBalance: async () => ({
        reference: "invoice-1",
        total: 22600,
        currency: "CAD",
        balance: 0,
        syncToken: "1",
      }),
    },
  );
  const r = review(f);
  assert.equal(r.creditApplications.length, 1);
  assert.equal(r.cancellations.length, 1);
  assert.equal(r.balanceReads.length, 1);
  assert.equal(r.balanceObservations.length, 1);
  assert(r.blockers.includes("RETAINED_BALANCE_LINEAGE"));
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        f.app.database
          .owned("integration")
          .run("UPDATE integration_balance_observations SET result='{}'");
        f.app.integration.reviewOfflineFailedRefundInTransaction(
          f.actor,
          f.effectId,
        );
      }),
    { code: "OFFLINE_REFUND_REVIEW" },
  );
});

test("original checkout callback and inbox lineage are read without claiming unattributed inbox completeness", async (t) => {
  const f = await setup(t);
  const invoiceId = ship(f, accept(f, 1, "second").id).invoiceId;
  const checkout = f.app.integration.checkout(f.actor, "second-checkout", {
    invoiceId,
  });
  await f.app.integration.execute(f.actor, checkout.id, {
    execute: async (e) => ({
      reference: "cs_test_original",
      result: {
        amount: JSON.parse(e.payload).amount,
        currency: "cad",
        status: "complete",
        paymentStatus: "paid",
        expiresAt: 1900000000,
      },
    }),
    lookup: async () => null,
  });
  f.app.integration.receiveCallback(f.actor, {
    bindingId: "binding",
    eventId: "evt_checkout",
    sessionId: "cs_test_original",
    effectId: checkout.id,
    hash: digest("raw signed event"),
  });
  await f.app.integration.stripeSettlement(
    f.actor,
    {
      id: "evt_checkout",
      sessionId: "cs_test_original",
      effectId: checkout.id,
    },
    async () => ({
      paid: true,
      amount: 11300,
      currency: "cad",
      paymentId: "pi_second",
    }),
  );
  const r = review(f);
  assert.equal(r.checkoutCallbacks.length, 1);
  assert.equal(r.inbox.length, 1);
  assert.equal(r.checkoutObservations.length, 1);
  assert(r.blockers.includes("INBOX_UNATTRIBUTED_HISTORY_UNAVAILABLE"));
  assert.notEqual(r.inbox[0]!.hash, r.checkoutCallbacks[0]!.hash);
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        f.app.database
          .owned("integration")
          .run(
            "UPDATE integration_checkout_observations SET hash=?",
            digest("wrong snapshot"),
          );
        f.app.integration.reviewOfflineFailedRefundInTransaction(
          f.actor,
          f.effectId,
        );
      }),
    { code: "OFFLINE_REFUND_REVIEW" },
  );
});

test("Billing manual proof is never enumerated through foreign SQL; native accounting fact exposes retained cash reference", async (t) => {
  const f = await setup(t);
  f.app.database
    .owned("billing")
    .run(
      "INSERT INTO billing_refund_proofs VALUES(?,?,?,?)",
      f.actor.orgId,
      "manual-copy",
      f.refundId,
      "2026-10-03T00:00:00.000Z",
    );
  const r = review(f);
  assert.equal(r.billing.accountingFact.cashReference, "manual-copy");
  assert(r.blockers.includes("RETAINED_PROVIDER_OR_MANUAL_OUTCOME"));
  assert(r.blockers.includes("BILLING_COMPLETE_HISTORY_REQUIRED"));
});

test("a copied accounting credit cannot hide from its native invoice by changing account scope", async (t) => {
  const f = await setup(t);
  const invoice = f.app.integration.accounting(f.actor, "scope-invoice", {
    invoiceId: f.invoiceId,
    customerRef: "customer",
    itemRefs: { [f.product]: "item" },
    taxCodeRef: "tax",
    taxRateRef: "rate",
  });
  await f.app.integration.execute(f.actor, invoice.id, {
    execute: async () => ({ reference: "invoice-scope", result: {} }),
    lookup: async () => null,
  });
  const credit = f.app.integration.accountingCredit(f.actor, "scope-credit", {
    creditId: f.creditId,
  });
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        f.app.database
          .owned("integration")
          .run(
            "UPDATE integration_effects SET account_id='copied-wrong-account' WHERE id=?",
            credit.id,
          );
        f.app.integration.reviewOfflineFailedRefundInTransaction(
          f.actor,
          f.effectId,
        );
      }),
    { code: "OFFLINE_REFUND_REVIEW" },
  );
});

test("native review neither escapes SQL ownership nor depends on current provider consent", async (t) => {
  const f = await setup(t);
  assert.throws(
    () =>
      f.app.database.transaction(() =>
        f.app.database.execute("integration", () =>
          f.app.integration.reviewOfflineFailedRefundInTransaction(
            f.actor,
            f.effectId,
          ),
        ),
      ),
    { code: "TRANSACTION" },
  );
  for (const table of ["billing_refund_proofs", "platform_commands"])
    assert.throws(
      () => f.app.database.owned("integration").get(`SELECT * FROM ${table}`),
      /prohibited|not authorized|access/i,
    );
  const r = review(f);
  chooseProviders(f, f.actor, "withdraw", {
    accountId: f.buyer,
    region: "CA",
    mode: "strict",
    providers: [],
    version: 2,
    acknowledgment: "Synthetic historical read survives withdrawal",
  });
  const after = review(f);
  assert.equal(after.account.residency_mode, "strict");
  assert.equal(after.effect.residency_version, r.effect.residency_version);
  assert.notEqual(after.hash, r.hash);
  await assert.rejects(
    f.app.integration.reconcile(f.actor, f.effectId, {
      execute: async () => {
        throw Error("transport");
      },
      lookup: async () => {
        throw Error("transport");
      },
    }),
    { code: "RESIDENCY_BLOCKED" },
  );
});

test("copied callback identities and incompatible refund inbox rows are contradictions, not proof", async (t) => {
  const f = await setup(t);
  f.app.integration.refundCallbacks.receive(f.actor, {
    bindingId: "binding",
    eventId: "evt_refund",
    effectId: f.effectId,
    reference: "re_failed",
    eventType: "refund.failed",
    hash: digest("synthetic"),
    refundId: f.refundId,
    paymentId: "pi_original",
    amount: 5000,
    currency: "cad",
  });
  const s = f.app.database.owned("integration");
  for (const corrupt of [
    () =>
      s.run(
        "UPDATE integration_refund_callbacks SET org_id='other' WHERE effect_id=?",
        f.effectId,
      ),
    () =>
      s.run(
        "UPDATE integration_refund_callbacks SET provider_reference='pi_not_refund' WHERE effect_id=?",
        f.effectId,
      ),
    () =>
      s.run(
        "INSERT INTO integration_inbox VALUES('stripe','evt_refund',?,?)",
        digest("unrelated receipt"),
        "2026-10-03T00:00:00.000Z",
      ),
    () =>
      s.run(
        "INSERT INTO integration_refund_callbacks SELECT 'copy',org_id,'other-binding',event_id,effect_id,provider_reference,event_type,hash,state,attempts,started_at,retry_at,error,created_at FROM integration_refund_callbacks WHERE effect_id=?",
        f.effectId,
      ),
  ])
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          corrupt();
          f.app.integration.reviewOfflineFailedRefundInTransaction(
            f.actor,
            f.effectId,
          );
        }),
      { code: "OFFLINE_REFUND_REVIEW" },
    );
  assert.equal(review(f).refundCallbacks.length, 1);
});
