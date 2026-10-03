import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fixture, accept, ship, chooseProviders } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { Store } from "../src/server/database.ts";
import { canonical, digest, type Actor, type Row } from "../src/server/core.ts";
import { IntegrationOfflineCheckoutReview } from "../src/server/integration-offline-checkout-review.ts";
const refusal = { code: "OFFLINE_CHECKOUT_REVIEW" };
const billingRefusal = { code: "OFFLINE_CHECKOUT_BILLING_REVIEW" };
const orderRefusal = { code: "OFFLINE_CHECKOUT_SETTLEMENT_ORDER_REQUIRED" };
function reader(f: ReturnType<typeof fixture>) {
  return new IntegrationOfflineCheckoutReview(
    f.app.database,
    f.app.identity,
    f.app.billing,
    f.app.integration.checkouts,
  );
}
async function setup(
  t: TestContext,
  region: "CA" | "US" = "CA",
  currency: "CAD" | "USD" = "CAD",
  options: {
    before?: number;
    renew?: boolean;
    expired?: boolean;
    stripe?: boolean;
  } = {},
) {
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 3, 12) });
  const tick = () => t.mock.timers.tick(10),
    f = fixture(t, {}, region, currency),
    invoiceId = ship(f, accept(f, 2).id).invoiceId;
  const financeId = f.app.identity.createUser(f.actor, "finance", {
    email: "settled@synthetic.test",
    name: "Finance review",
    role: "finance",
    sites: [f.w1],
    password: "synthetic-password-long",
  }).id;
  const finance = f.app.identity.currentActor({ ...f.actor, id: financeId });
  chooseProviders(f, f.actor, "choice", {
    accountId: f.buyer,
    region,
    mode: "provider-exceptions",
    providers: ["stripe", "quickbooks"],
    version: 1,
    acknowledgment: "Synthetic fixture only",
  });
  let n = 0;
  const pay = (amount: number, stripe = options.stripe ?? false) => {
    tick();
    const reference = stripe ? `pi_native_${++n}` : `bank_${++n}`;
    return stripe
      ? f.app.database.transaction(() =>
          f.app.billing.verifiedPayment(
            f.actor,
            invoiceId,
            amount,
            "stripe",
            reference,
          ),
        )
      : f.app.billing.manualPayment(f.actor, reference, {
          invoiceId,
          amount,
          reference,
          reason: "Synthetic recorded payment",
        });
  };
  const credit = (quantity = 1) => {
    tick();
    return f.app.billing.issueCredit(f.actor, "credit", {
      invoiceId,
      reference: "credit",
      reason: "Synthetic credit",
      lines: [
        {
          lineId: String(f.app.billing.lines(f.actor, invoiceId)[0]!.id),
          quantity,
        },
      ],
    });
  };
  const before = options.before ?? 3000;
  if (before) pay(before);
  tick();
  const root = f.app.integration.checkout(f.actor, "checkout", { invoiceId });
  let current = root;
  let localCalls = 0;
  if (options.expired) {
    tick();
    await f.app.integration.execute(f.actor, root.id, {
      execute: async () => {
        localCalls++;
        return {
          reference: "cs_test_original",
          result: {
            amount: 22600 - before,
            currency: currency.toLowerCase(),
            status: "expired",
            paymentStatus: "unpaid",
            expiresAt: Math.floor(Date.now() / 1000) - 1,
          },
        };
      },
      lookup: async () => null,
    });
  }
  if (options.renew || options.expired) {
    pay(1000);
    tick();
    current = f.app.integration.renewCheckout(f.actor, "renew", {
      effectId: root.id,
      reviewVersion: f.app.integration.checkouts.reviewVersion(
        f.app.integration.effect(f.actor, root.id),
      ),
      amount: 21600 - before,
      reason: "Synthetic revised open balance",
    });
  }
  tick();
  assert.equal(
    (
      await f.app.integration.execute(f.actor, current.id, {
        execute: async () => {
          localCalls++;
          throw Error("Synthetic lost send response; no IO");
        },
        lookup: async () => null,
      })
    ).state,
    "unknown",
  );
  const review = () =>
    f.app.database.transaction(() =>
      reader(f).getSettledInTransaction(finance, current.id),
    );
  return Object.assign(f, {
    invoiceId,
    rootId: root.id,
    effectId: current.id,
    finance,
    tick,
    pay,
    credit,
    review,
    calls: () => localCalls,
  });
}
type F = Awaited<ReturnType<typeof setup>>;
const integration = (f: F) => f.app.database.owned("integration"),
  billing = (f: F) => f.app.database.owned("billing");
function frozen(value: unknown) {
  if (value && typeof value === "object") {
    assert(Object.isFrozen(value));
    Object.values(value).forEach(frozen);
  }
}
function rows(f: F) {
  return canonical([
    integration(f).all("SELECT * FROM integration_effects ORDER BY id"),
    integration(f).all(
      "SELECT * FROM integration_checkout_renewals ORDER BY successor_id",
    ),
    integration(f).all(
      "SELECT * FROM integration_checkout_observations ORDER BY sequence",
    ),
    integration(f).all(
      "SELECT * FROM integration_operation_leases ORDER BY effect_id",
    ),
    billing(f).all("SELECT * FROM billing_payments ORDER BY id"),
    billing(f).all("SELECT * FROM billing_refunds ORDER BY id"),
  ]);
}
for (const [region, currency] of [
  ["CA", "CAD"],
  ["CA", "USD"],
  ["US", "USD"],
] as const)
  for (const stripe of [false, true])
    test(`native independent ${stripe ? "Stripe-recorded" : "manual"} settlement ${region}/${currency} retains complete Billing facts and changed-balance chain`, async (t) => {
      const f = await setup(t, region, currency, { renew: true, stripe });
      f.pay(2000);
      f.credit();
      f.app.platform.isolateRestore("synthetic-held", new Date().toISOString());
      const before = rows(f),
        calls = f.calls(),
        r = f.review(),
        { factsHash, ...body } = r;
      assert.equal(
        r.purpose,
        "integration-offline-independently-settled-checkout-native-review/v1",
      );
      assert.equal(
        r.billingScope,
        "complete-native-invoice-settlement-history",
      );
      assert.equal(r.organization.region, region);
      assert.equal(r.organization.currency, currency);
      assert.equal(r.billingHistory.payments.length, 3);
      assert.equal(r.billingHistory.credits.length, 1);
      assert.equal(r.totals.balance, 5300);
      assert.deepEqual(r.chain, [f.rootId, f.effectId]);
      assert.deepEqual(
        r.settlement.balances.map((b) => b.originalAmount).sort(),
        [18600, 19600],
      );
      for (const b of r.settlement.balances)
        assert.equal(b.originalAmount + b.subsequentDelta, r.totals.balance);
      assert.deepEqual(r.accountingAllocations, []);
      assert.equal("allocationPayments" in r, false);
      assert.equal(factsHash, digest(canonical(body)));
      frozen(r);
      assert.equal(rows(f), before);
      assert.equal(f.calls(), calls);
      assert.throws(
        () =>
          f.app.database.transaction(() =>
            reader(f).getInTransaction(f.finance, f.effectId),
          ),
        { code: "OFFLINE_CHECKOUT_BILLING_HISTORY_REQUIRED" },
      );
    });
test("actual expired predecessor observation retains its original smaller amount", async (t) => {
  const f = await setup(t, "CA", "CAD", { expired: true }),
    r = f.review();
  assert.equal(r.observations.length, 1);
  assert.equal(JSON.parse(String(r.observations[0]!.snapshot)).amount, 19600);
  assert.equal(r.billingHistory.capacity.balance, 18600);
  assert.equal(r.renewals.length, 1);
});
test("current history changes require fresh hash without altering frozen original projection", async (t) => {
  const f = await setup(t),
    a = f.review();
  f.pay(1000);
  const b = f.review();
  assert.notEqual(a.factsHash, b.factsHash);
  assert.equal(a.totals.balance, 19600);
  assert.equal(b.totals.balance, 18600);
  assert.equal(a.billingHistory.payments.length, 1);
});
test("uncommitted same-writer payment joins, rollback, competing writer lock and reopen", async (t) => {
  const f = await setup(t),
    before = f.review(),
    old = rows(f);
  f.tick();
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        f.app.billing.verifiedPayment(
          f.actor,
          f.invoiceId,
          1000,
          "stripe",
          "pi_uncommitted",
        );
        const r = reader(f).getSettledInTransaction(f.finance, f.effectId);
        assert.equal(r.totals.paid, 4000);
        const other = new DatabaseSync(f.path, { timeout: 1 });
        try {
          assert.throws(() => other.exec("BEGIN IMMEDIATE"), /locked/);
        } finally {
          other.close();
        }
        throw Error("fixture rollback");
      }),
    /fixture rollback/,
  );
  assert.equal(rows(f), old);
  assert.deepEqual(f.review(), before);
  f.app.close();
  f.app = new Application(f.path, "CA");
  assert.deepEqual(f.review(), before);
});
for (const stripe of [false, true])
  test(`complete ${stripe ? "Stripe-observed" : "manual-proved"} refunds conserve current cash after an unknown checkout`, async (t) => {
    const f = await setup(t, "CA", "USD", { before: 0 }),
      payment = f.pay(22600, stripe);
    f.credit();
    f.tick();
    const r = f.app.billing.refundRequest(f.actor, "refund", {
      invoiceId: f.invoiceId,
      paymentId: payment.id,
      amount: 5000,
      reference: "refund",
      reason: "Synthetic refund",
    });
    if (stripe) {
      for (const status of [
        "requires_action",
        "succeeded",
        "pending",
        "requires_action",
        "succeeded",
      ] as const) {
        f.tick();
        f.app.database.transaction(() => {
          const intent = f.app.billing.refunds.intent(f.actor, r.id);
          f.app.billing.refunds.observe(f.actor, intent, "re_native", {
            ...intent,
            status,
          });
        });
      }
    } else {
      f.tick();
      f.app.billing.manualRefund(f.actor, "proof", {
        refundId: r.id,
        reference: "bank-refund",
        reason: "Synthetic proof",
      });
    }
    const review = f.review();
    assert.equal(review.totals.balance, -6300);
    assert.equal(review.totals.refunded, 5000);
    assert.equal(review.billingHistory.refunds.length, 1);
    assert.equal(
      review.settlement.events.filter((e) => e.kind === "refund").length,
      stripe ? 3 : 1,
    );
    assert.equal(review.settlement.balances[0]!.originalAmount, 22600);
  });
test("complete payment history extends beyond a normal twenty-row page", async (t) => {
  const f = await setup(t);
  for (let i = 0; i < 24; i++) f.pay(1);
  assert.equal(f.review().billingHistory.payments.length, 25);
});
test("zero-settlement remains exclusively on original profile", async (t) => {
  const f = await setup(t, "CA", "CAD", { before: 0 });
  assert.throws(f.review, { code: "OFFLINE_CHECKOUT_REVIEW_PROFILE" });
  const r = f.app.database.transaction(() =>
    reader(f).getInTransaction(f.finance, f.effectId),
  );
  assert.equal(
    r.purpose,
    "integration-offline-unknown-checkout-native-review/v1",
  );
});
test("requires caller writer and fresh role, account, password and tenant checks", async (t) => {
  const f = await setup(t);
  assert.throws(
    () => reader(f).getSettledInTransaction(f.finance, f.effectId),
    { code: "TRANSACTION" },
  );
  for (const sql of [
    "UPDATE iam_users SET active=0 WHERE id=?",
    "UPDATE iam_users SET role='support' WHERE id=?",
    "UPDATE iam_users SET account_id='copied' WHERE id=?",
    "UPDATE iam_users SET org_id='copied' WHERE id=?",
    "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
  ]) {
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          f.app.database.owned("iam").run(sql, f.finance.id);
          assert.throws(() =>
            reader(f).getSettledInTransaction(
              { ...f.finance, role: "admin" },
              f.effectId,
            ),
          );
          throw Error("rollback");
        }),
      /rollback/,
    );
  }
  assert.equal(
    f.app.database.transaction(() =>
      reader(f).getSettledInTransaction(
        { ...f.finance, role: "buyer" },
        f.effectId,
      ),
    ).targetId,
    f.effectId,
  );
});
test("hostile actor/effect descriptors and proxies never execute", async (t) => {
  const f = await setup(t);
  let calls = 0;
  const trap = () => {
    calls++;
    throw Error("trap");
  };
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  for (const supplied of [
    new Proxy(
      {},
      { getOwnPropertyDescriptor: trap, getPrototypeOf: trap, get: trap },
    ),
    revoked.proxy,
    {
      get id() {
        return trap();
      },
      orgId: f.actor.orgId,
    },
    {
      id: f.actor.id,
      get orgId() {
        return trap();
      },
    },
  ])
    assert.throws(
      () =>
        f.app.database.transaction(() =>
          reader(f).getSettledInTransaction(supplied as Actor, f.effectId),
        ),
      refusal,
    );
  for (const id of [
    { toString: trap },
    new Proxy({}, { get: trap }),
    null,
    "x".repeat(161),
    "bad\0id",
  ])
    assert.throws(
      () =>
        f.app.database.transaction(() =>
          reader(f).getSettledInTransaction(f.finance, id),
        ),
      refusal,
    );
  assert.equal(calls, 0);
});
test("same-millisecond native payment and checkout ordering is explicitly unavailable", async (t) => {
  const f = await setup(t);
  const at = f.app.integration.effect(f.actor, f.rootId).created_at;
  billing(f).run("UPDATE billing_payments SET created_at=?", at);
  assert.throws(f.review, orderRefusal);
});
for (const mutation of [
  "UPDATE billing_payments SET amount=amount+1",
  "UPDATE billing_payments SET external_ref='invalid-stripe' , provider='stripe'",
  "UPDATE billing_payments SET invoice_id='missing'",
  "UPDATE billing_payments SET org_id='foreign'",
])
  test(`native payment binding refuses ${mutation}`, async (t) => {
    const f = await setup(t);
    billing(f).run(mutation);
    assert.throws(f.review);
  });
test("changed checkout historical intent cannot borrow current totals", async (t) => {
  const f = await setup(t),
    e = f.app.integration.effect(f.actor, f.effectId),
    p = JSON.parse(e.payload);
  p.amount++;
  integration(f).run(
    "UPDATE integration_effects SET payload=? WHERE id=?",
    canonical(p),
    e.id,
  );
  assert.throws(f.review, refusal);
});
test("changed owning refund history fails before a settled projection escapes", async (t) => {
  const f = await setup(t, "CA", "CAD", { before: 0 }),
    p = f.pay(22600);
  f.credit();
  f.tick();
  const r = f.app.billing.refundRequest(f.actor, "refund", {
    invoiceId: f.invoiceId,
    paymentId: p.id,
    amount: 1000,
    reference: "refund",
    reason: "Synthetic",
  });
  f.tick();
  f.app.billing.manualRefund(f.actor, "proof", {
    refundId: r.id,
    reference: "bank-proof",
    reason: "Synthetic",
  });
  billing(f).run("DELETE FROM billing_refund_proofs");
  assert.throws(f.review, billingRefusal);
});
test("actual Stripe settlement inbox reproduces unavailable checkout-to-payment attribution", async (t) => {
  const f = await setup(t, "CA", "CAD", { expired: true, before: 0 });
  f.tick();
  await f.app.integration.stripeSettlement(
    f.actor,
    {
      id: "evt_native_settlement",
      sessionId: "cs_test_original",
      effectId: f.rootId,
    },
    async () => ({
      paid: true,
      amount: 22600,
      currency: "cad",
      paymentId: "pi_actual_native_settlement",
    }),
  );
  assert.equal(
    billing(f).get(
      "SELECT COUNT(*) AS n FROM billing_payments WHERE provider='stripe'",
    )!.n,
    1,
  );
  assert.equal(
    integration(f).get("SELECT COUNT(*) AS n FROM integration_inbox")!.n,
    1,
  );
  assert.throws(f.review, { code: "OFFLINE_CHECKOUT_INBOX_HISTORY_REQUIRED" });
});
test("real native QuickBooks payment allocation remains a distinct refused owning profile", async (t) => {
  const f = await setup(t),
    paymentId = String(billing(f).get("SELECT id FROM billing_payments")!.id);
  f.tick();
  const parent = f.app.integration.accounting(f.actor, "accounting", {
    invoiceId: f.invoiceId,
    customerRef: "customer-1",
    itemRefs: { [f.product]: "item-1" },
    taxCodeRef: "tax-1",
    taxRateRef: "rate-1",
  });
  f.tick();
  await f.app.integration.execute(f.actor, parent.id, {
    execute: async () => ({ reference: "invoice-1", result: {} }),
    lookup: async () => null,
  });
  f.tick();
  f.app.integration.accountingPayment(f.actor, "accounting-payment", {
    paymentId,
    appliedAmount: 3000,
    depositAccountRef: "bank-1",
  });
  assert.equal(
    integration(f).get(
      "SELECT applied_amount FROM integration_payment_allocations",
    )!.applied_amount,
    3000,
  );
  assert.throws(f.review, {
    code: "OFFLINE_CHECKOUT_ACCOUNTING_PROFILE_REQUIRED",
  });
});

test("malformed Integration UTF8 cannot be silently replaced in a settled hash", async (t) => {
  const f = await setup(t);
  integration(f).run(
    "UPDATE integration_effects SET error=CAST(x'f09080' AS TEXT) WHERE id=?",
    f.effectId,
  );
  assert.throws(f.review, refusal);
});
test("checkout cannot precede the original native invoice", async (t) => {
  const f = await setup(t, "CA", "CAD", { before: 0 });
  f.pay(1000);
  integration(f).run(
    "UPDATE integration_effects SET created_at='2000-01-01T00:00:00.000Z' WHERE id=?",
    f.effectId,
  );
  assert.throws(f.review, refusal);
});
for (const field of ["org_id", "invoice_id", "account_id", "hash"])
  test(`copied observation ${field} remains refused`, async (t) => {
    const f = await setup(t, "CA", "CAD", { expired: true });
    integration(f).run(
      `UPDATE integration_checkout_observations SET ${field}='foreign'`,
    );
    assert.throws(f.review);
  });
test("foreign reverse payment allocation cannot disappear through a different invoice/effect", async (t) => {
  const f = await setup(t),
    paymentId = String(billing(f).get("SELECT id FROM billing_payments")!.id);
  integration(f).run(
    "INSERT INTO integration_payment_allocations VALUES('foreign-effect','foreign-org','foreign-invoice',?,1)",
    paymentId,
  );
  assert.throws(f.review, refusal);
});
test("local reverse payment allocation cannot disappear through a different invoice/effect", async (t) => {
  const f = await setup(t);
  f.tick();
  const invoiceId = ship(f, accept(f, 1, "other-order").id).invoiceId;
  f.tick();
  const other = f.app.integration.checkout(f.actor, "other-checkout", {
    invoiceId,
  });
  const paymentId = String(
    billing(f).get(
      "SELECT id FROM billing_payments WHERE invoice_id=?",
      f.invoiceId,
    )!.id,
  );
  integration(f).run(
    "INSERT INTO integration_payment_allocations VALUES(?,?,?,?,1)",
    other.id,
    f.actor.orgId,
    invoiceId,
    paymentId,
  );
  assert.throws(f.review, {
    code: "OFFLINE_CHECKOUT_ACCOUNTING_PROFILE_REQUIRED",
  });
});
for (const table of [
  "integration_checkout_renewals",
  "integration_checkout_observations",
  "integration_operation_leases",
  "integration_payment_allocations",
])
  test(`orphan retained ${table} cannot disappear`, async (t) => {
    const f = await setup(t, "CA", "CAD", { expired: true });
    // Use actual owner row first, then deliberately damage its relation. The
    // fixture's external connection may disable FKs; production guards stay intact.
    const db = new DatabaseSync(f.path);
    try {
      db.exec("PRAGMA foreign_keys=OFF");
      if (table === "integration_payment_allocations")
        db.prepare(
          "INSERT INTO integration_payment_allocations VALUES('missing',?,?,?,1)",
        ).run(
          f.actor.orgId,
          f.invoiceId,
          String(billing(f).get("SELECT id FROM billing_payments LIMIT 1")!.id),
        );
      else
        db.exec(
          `UPDATE ${table} SET ${table === "integration_checkout_renewals" ? "predecessor_id" : "effect_id"}='missing' WHERE rowid=(SELECT MIN(rowid) FROM ${table})`,
        );
    } finally {
      db.close();
    }
    assert.throws(f.review, refusal);
  });
test("changed renewal review hash and latest observation stay enforced", async (t) => {
  const f = await setup(t, "CA", "CAD", { expired: true });
  integration(f).run(
    "UPDATE integration_checkout_renewals SET review_version=?",
    "a".repeat(64),
  );
  assert.throws(f.review, refusal);
});
test("historical observed amount binds its checkout instead of the invoice original total", async (t) => {
  const f = await setup(t, "CA", "CAD", { expired: true }),
    row = integration(f).get(
      "SELECT snapshot FROM integration_checkout_observations",
    )!,
    s = JSON.parse(String(row.snapshot));
  s.amount = 22600;
  const encoded = canonical(s);
  integration(f).run(
    "UPDATE integration_checkout_observations SET snapshot=?,hash=?",
    encoded,
    digest(encoded),
  );
  assert.throws(f.review, refusal);
});
function beforeMaterialization(
  f: F,
  owner: "integration" | "billing",
  expected: { code: string },
) {
  const old = Store.prototype.all;
  let read = 0;
  Store.prototype.all = function <T extends Row = Row>(
    this: Store,
    sql: string,
    ...params: SQLInputValue[]
  ) {
    if (sql.includes(`FROM ${owner}_`)) read++;
    return old.call(this, sql, ...params) as T[];
  };
  try {
    assert.throws(f.review, expected);
    assert.equal(
      read,
      0,
      "retained rows must not precede the owning preflight",
    );
  } finally {
    Store.prototype.all = old;
  }
}
for (const [owner, sql] of [
  ["integration", "UPDATE integration_effects SET error=?"],
  ["integration", "UPDATE integration_effects SET reference=?"],
  ["billing", "UPDATE billing_payments SET external_ref=?"],
  ["billing", "UPDATE billing_invoices SET number=?"],
] as const)
  test(`UTF8 after NUL preflight: ${sql}`, async (t) => {
    const f = await setup(t);
    f.app.database.owned(owner).run(sql, "private\0" + "界".repeat(22000));
    beforeMaterialization(f, owner, {
      code:
        owner === "integration"
          ? "OFFLINE_CHECKOUT_REVIEW_LIMIT"
          : "OFFLINE_CHECKOUT_BILLING_LIMIT",
    });
  });
test("unsafe retained Integration integer refuses before native driver conversion", async (t) => {
  const f = await setup(t);
  integration(f).run(
    "UPDATE integration_effects SET residency_version=9223372036854775807",
  );
  beforeMaterialization(f, "integration", {
    code: "OFFLINE_CHECKOUT_REVIEW_LIMIT",
  });
});
test("complete Integration row count refuses rather than returning a page", async (t) => {
  const f = await setup(t);
  f.app.database.transaction(() => {
    for (let i = 0; i < 65; i++)
      integration(f).run(
        "INSERT INTO integration_operation_leases VALUES(?,?,NULL,NULL)",
        `other-${i}`,
        f.actor.orgId,
      );
  });
  beforeMaterialization(f, "integration", {
    code: "OFFLINE_CHECKOUT_REVIEW_LIMIT",
  });
});
test("complete Integration aggregate bytes refuse before any retained materialization", async (t) => {
  const f = await setup(t);
  const e = f.app.integration.effect(f.actor, f.effectId);
  f.app.database.transaction(() => {
    for (let i = 0; i < 7; i++)
      integration(f).run(
        "INSERT INTO integration_effects(id,org_id,account_id,provider,kind,reference,payload,state,external_ref,result,created_at,residency_version,started_at,error) VALUES(?,?,?,'stripe','checkout',?,?,'unknown',NULL,NULL,?,1,NULL,?)",
        `unrelated-${i}`,
        f.actor.orgId,
        f.buyer,
        `other-${i}`,
        e.payload,
        e.created_at,
        "x".repeat(60000),
      );
  });
  beforeMaterialization(f, "integration", {
    code: "OFFLINE_CHECKOUT_REVIEW_LIMIT",
  });
});
for (const payload of [
  '{"invoiceId":"x","amount":1,"currency":"cad","number":"x","unknown":true}',
  "[".repeat(18) + "0" + "]".repeat(18),
  '{"large":[' + Array(4200).fill(0).join(",") + "]}",
])
  test(`fixed JSON structural refusal ${payload.length} bytes`, async (t) => {
    const f = await setup(t);
    integration(f).run(
      "UPDATE integration_effects SET payload=? WHERE id=?",
      payload,
      f.effectId,
    );
    assert.throws(f.review);
  });
test("same-writer later monetary history damage refuses and rolls back", async (t) => {
  const f = await setup(t),
    before = f.review();
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        assert.equal(
          reader(f).getSettledInTransaction(f.finance, f.effectId).factsHash,
          before.factsHash,
        );
        billing(f).run("UPDATE billing_payments SET amount=amount+1");
        assert.throws(
          () => reader(f).getSettledInTransaction(f.finance, f.effectId),
          refusal,
        );
        throw Error("rollback");
      }),
    /rollback/,
  );
  assert.deepEqual(f.review(), before);
});

test("actual same-millisecond native bank payment and fresh checkout reproduce ordering gap", async (t) => {
  const f = await setup(t);
  f.tick();
  const invoiceId = ship(f, accept(f, 1, "tie-order").id).invoiceId;
  f.tick();
  f.app.billing.manualPayment(f.actor, "tie-payment", {
    invoiceId,
    amount: 1000,
    reference: "tie-bank",
    reason: "Synthetic native same timestamp",
  });
  const effect = f.app.integration.checkout(f.actor, "tie-checkout", {
    invoiceId,
  });
  assert.equal(
    billing(f).get(
      "SELECT created_at FROM billing_payments WHERE invoice_id=?",
      invoiceId,
    )!.created_at,
    f.app.integration.effect(f.actor, effect.id).created_at,
  );
  f.tick();
  await f.app.integration.execute(f.actor, effect.id, {
    execute: async () => {
      throw Error("Synthetic lost response");
    },
    lookup: async () => null,
  });
  assert.throws(
    () =>
      f.app.database.transaction(() =>
        reader(f).getSettledInTransaction(f.finance, effect.id),
      ),
    orderRefusal,
  );
});
