import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, ship, accept, chooseProviders } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { canonical, digest, type Actor } from "../src/server/core.ts";
import { Store } from "../src/server/database.ts";
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
// Fixtures share native setup vocabulary with the earlier tests; the assertions
// below independently challenge the exported review, never its private helpers.
const invalid = { code: "OFFLINE_REFUND_REVIEW" };
function inside(f: Fixture) {
  return f.app.integration.reviewOfflineFailedRefundInTransaction(
    f.actor,
    f.effectId,
  );
}
function corrupt(f: Fixture, sql: string, ...args: (string | number)[]) {
  const before = review(f);
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        f.app.database.owned("integration").run(sql, ...args);
        inside(f);
      }),
    invalid,
  );
  assert.deepEqual(review(f), before);
}
async function checkout(f: Fixture) {
  const currency = f.app.identity.organization(f.actor).currency.toLowerCase();
  const invoiceId = ship(f, accept(f, 1, "observation").id).invoiceId;
  const effect = f.app.integration.checkout(f.actor, "observe", { invoiceId });
  await f.app.integration.execute(f.actor, effect.id, {
    execute: async () => ({
      reference: "cs_test_boundary",
      result: {
        amount: 11300,
        currency,
        status: "complete",
        paymentStatus: "paid",
        expiresAt: 1900000000,
      },
    }),
    lookup: async () => {
      throw Error("no lookup");
    },
  });
  f.app.integration.receiveCallback(f.actor, {
    bindingId: "boundary-binding",
    eventId: "evt_boundary",
    sessionId: "cs_test_boundary",
    effectId: effect.id,
    hash: digest("synthetic raw event bytes"),
  });
  await f.app.integration.stripeSettlement(
    f.actor,
    {
      id: "evt_boundary",
      sessionId: "cs_test_boundary",
      effectId: effect.id,
    },
    async () => ({
      paid: true,
      amount: 11300,
      currency,
      paymentId: "pi_boundary_second",
    }),
  );
  return effect;
}
async function ledger(f: Fixture) {
  const currency = f.app.identity.organization(f.actor).currency;
  const invoice = f.app.integration.accounting(f.actor, "ledger", {
    invoiceId: f.invoiceId,
    customerRef: "customer",
    itemRefs: { [f.product]: "item" },
    taxCodeRef: "tax",
    taxRateRef: "rate",
  });
  await f.app.integration.execute(f.actor, invoice.id, {
    execute: async () => ({ reference: "ledger-invoice", result: {} }),
    lookup: async () => null,
  });
  const payment = f.app.integration.accountingPayment(
    f.actor,
    "ledger-payment",
    {
      paymentId: f.paymentId,
      appliedAmount: 11300,
      depositAccountRef: "bank",
    },
  );
  await f.app.integration.execute(f.actor, payment.id, {
    execute: async () => ({ reference: "payment:ledger-payment", result: {} }),
    lookup: async () => null,
  });
  await f.app.integration.balances.refresh(
    f.actor,
    invoice.id,
    "boundary-balance",
    {
      execute: async () => {
        throw Error("no write");
      },
      lookup: async () => null,
      readInvoiceBalance: async () => ({
        reference: "ledger-invoice",
        total: 22600,
        currency,
        balance: 0,
        syncToken: "1",
      }),
    },
  );
  return { invoice, payment };
}

test("boundary: fresh authority is checked before materializing any Integration rows", async (t) => {
  const f = await setup(t);
  const iam = f.app.database.owned("iam");
  const original = Store.prototype.all;
  let integrationReads = 0;
  t.mock.method(
    Store.prototype,
    "all",
    function (
      this: Store,
      sql: string,
      ...args: Parameters<Store["all"]> extends [string, ...infer P] ? P : never
    ) {
      if (/FROM integration_/i.test(sql)) integrationReads++;
      return original.call(this, sql, ...args);
    },
  );
  const mutations = [
    ["role='support'", "FORBIDDEN"],
    ["active=0", "FORBIDDEN"],
    ["account_id='buyer-copy'", "FORBIDDEN"],
    ["org_id='foreign-copy'", "FORBIDDEN"],
  ];
  for (const [change, code] of mutations) {
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          iam.run(`UPDATE iam_users SET ${change} WHERE id=?`, f.actor.id);
          inside(f);
        }),
      { code },
    );
  }
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        iam.run(
          "INSERT INTO iam_user_security(user_id,revision,password_change_required,updated_at) VALUES(?,1,1,'2026-10-03T00:00:00.000Z')",
          f.actor.id,
        );
        inside(f);
      }),
    { code: "PASSWORD_CHANGE_REQUIRED" },
  );
  assert.equal(integrationReads, 0);
  assert.throws(() => review(f, { ...f.actor, orgId: "foreign-copy" }), {
    code: "FORBIDDEN",
  });
  assert.throws(
    () =>
      f.app.integration.reviewOfflineFailedRefundInTransaction(
        f.actor,
        f.effectId,
      ),
    { code: "TRANSACTION" },
  );
  assert.equal(review(f).effectId, f.effectId);
});

test("boundary: row count and promised payload byte preflights precede SELECT star", async (t) => {
  const f = await setup(t),
    s = f.app.database.owned("integration");
  const original = Store.prototype.all;
  const selected: string[] = [];
  t.mock.method(
    Store.prototype,
    "all",
    function (
      this: Store,
      sql: string,
      ...args: Parameters<Store["all"]> extends [string, ...infer P] ? P : never
    ) {
      selected.push(sql);
      return original.call(this, sql, ...args);
    },
  );
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        s.run(
          "UPDATE integration_effects SET error=? WHERE id=?",
          "é".repeat(32769),
          f.effectId,
        );
        inside(f);
      }),
    { code: "OFFLINE_REFUND_REVIEW_LIMIT" },
  );
  assert(
    !selected.some((sql) => /SELECT \* FROM integration_effects/.test(sql)),
  );
  selected.length = 0;
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        for (let n = 0; n < 65; n++)
          s.run(
            "INSERT INTO integration_refund_callbacks(id,org_id,binding_id,event_id,effect_id,provider_reference,event_type,hash,state,created_at) VALUES(?,?,?, ?,?,'re_boundary','refund.failed',?,'pending','2026-10-03T00:00:00.000Z')",
            `cb-${n}`,
            f.actor.orgId,
            "binding",
            `evt_${n}`,
            f.effectId,
            digest("raw"),
          );
        inside(f);
      }),
    { code: "OFFLINE_REFUND_REVIEW_LIMIT" },
  );
  assert(
    !selected.some((sql) =>
      /SELECT \* FROM integration_refund_callbacks/.test(sql),
    ),
  );
  assert.equal(review(f).refundCallbacks.length, 0);
});

test("boundary: terminal checkout lineage survives hold, writer rollback, freeze and restart", async (t) => {
  const f = await setup(t);
  await checkout(f);
  f.app.platform.isolateRestore(
    "boundary-synthetic",
    "2026-10-03T00:00:00.000Z",
  );
  const s = f.app.database.owned("integration"),
    before = review(f);
  assert.equal(before.checkoutObservations.length, 1);
  assert.equal(before.inbox.length, 1);
  frozen(before);
  const changes = s.get("SELECT total_changes() AS n")!.n;
  assert.deepEqual(review(f), before);
  assert.equal(s.get("SELECT total_changes() AS n")!.n, changes);
  assert.throws(() => {
    (before.checkoutObservations[0] as any).snapshot = "{}";
  }, TypeError);
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        s.run(
          "UPDATE integration_refund_polls SET token='retained-exact',started_at=123,retry_at=456 WHERE effect_id=?",
          f.effectId,
        );
        const changed = inside(f);
        assert.equal(changed.polls[0]!.token, "retained-exact");
        assert.equal(changed.polls[0]!.retry_at, 456);
        assert.notEqual(changed.hash, before.hash);
        assert.equal(before.polls[0]!.token, null);
        throw Error("rollback boundary");
      }),
    /rollback boundary/,
  );
  assert.deepEqual(review(f), before);
  f.app.close();
  f.app = new Application(f.path, "CA");
  assert.deepEqual(review(f), before);
  assert(f.app.platform.recoveryHold());
});

for (const [name, sql] of [
  [
    "foreign observation org",
    "UPDATE integration_checkout_observations SET org_id='foreign'",
  ],
  [
    "foreign observation account",
    "UPDATE integration_checkout_observations SET account_id='foreign'",
  ],
  [
    "malformed observation JSON",
    "UPDATE integration_checkout_observations SET snapshot='{'",
  ],
  [
    "copied callback subject",
    "UPDATE integration_callbacks SET effect_id='orphan'",
  ],
  ["foreign callback org", "UPDATE integration_callbacks SET org_id='foreign'"],
  [
    "copied inbox provider",
    "UPDATE integration_inbox SET provider='quickbooks'",
  ],
] as const)
  test(`boundary: refuses ${name}`, async (t) => {
    const f = await setup(t);
    await checkout(f);
    corrupt(f, sql);
  });

for (const [field, value] of [
  ["amount", 1],
  ["currency", "USD"],
] as const)
  test(`boundary GAP: resealed checkout snapshot ${field} contradicting immutable intent is refused`, async (t) => {
    const f = await setup(t);
    await checkout(f);
    const s = f.app.database.owned("integration");
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          const row = s.get("SELECT * FROM integration_checkout_observations")!;
          const snapshot = JSON.parse(String(row.snapshot));
          assert.equal(snapshot.amount, 11300);
          assert.equal(snapshot.currency, "CAD");
          snapshot[field] = value;
          const encoded = canonical(snapshot);
          s.run(
            "UPDATE integration_checkout_observations SET snapshot=?,hash=? WHERE id=?",
            encoded,
            digest(encoded),
            String(row.id),
          );
          inside(f);
        }),
      invalid,
    );
  });

test("boundary: native ledger mapping and balance history remain complete", async (t) => {
  const f = await setup(t),
    chain = await ledger(f),
    r = review(f);
  assert.equal(r.paymentAllocations.length, 1);
  assert.equal(r.balanceReads.length, 1);
  assert.equal(r.balanceObservations.length, 1);
  assert(r.effects.some((e) => e.id === chain.payment.id));
  assert(r.blockers.includes("RETAINED_ACCOUNTING_LINEAGE"));
  corrupt(f, "UPDATE integration_payment_allocations SET org_id='foreign'");
  corrupt(f, "UPDATE integration_payment_allocations SET applied_amount=1");
  corrupt(f, "UPDATE integration_balance_observations SET org_id='foreign'");
  corrupt(f, "UPDATE integration_balance_observations SET result='{}'");
  corrupt(f, "DELETE FROM integration_balance_observations");
});

test("boundary GAP: consistent copies of a contradictory balance arithmetic result are refused", async (t) => {
  const f = await setup(t);
  await ledger(f);
  const s = f.app.database.owned("integration");
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        const row = s.get("SELECT * FROM integration_balance_observations")!;
        const result = JSON.parse(String(row.result));
        assert.equal(
          result.difference,
          result.providerBalance - result.nativeBalance,
        );
        result.difference = 999;
        const encoded = canonical(result);
        s.run("UPDATE integration_balance_observations SET result=?", encoded);
        s.run("UPDATE integration_balance_reads SET result=?", encoded);
        inside(f);
      }),
    invalid,
  );
});

test("boundary GAP: copied accounting parent payload contradicting its descendant snapshot is refused", async (t) => {
  const f = await setup(t),
    chain = await ledger(f);
  const native = review(f);
  assert.equal(
    JSON.parse(native.effects.find((e) => e.id === chain.invoice.id)!.payload)
      .invoice.total,
    22600,
  );
  assert.equal(
    JSON.parse(native.effects.find((e) => e.id === chain.payment.id)!.payload)
      .invoice.total,
    22600,
  );
  corrupt(
    f,
    "UPDATE integration_effects SET payload=json_set(payload,'$.invoice.total',1) WHERE id=?",
    chain.invoice.id,
  );
});

test("boundary: Billing manual proof and unattributed inbox remain explicit owner completeness dependencies", async (t) => {
  const f = await setup(t),
    before = review(f);
  f.app.database
    .owned("billing")
    .run(
      "INSERT INTO billing_refund_proofs VALUES(?,?,?,?)",
      f.actor.orgId,
      "manual-boundary",
      f.refundId,
      "2026-10-03T00:00:00.000Z",
    );
  f.app.database
    .owned("integration")
    .run(
      "INSERT INTO integration_inbox VALUES('stripe','unattributed',?,'2026-10-03T00:00:00.000Z')",
      digest("opaque"),
    );
  const r = review(f);
  assert.equal(r.billing.accountingFact.cashReference, "manual-boundary");
  assert(r.blockers.includes("BILLING_COMPLETE_HISTORY_REQUIRED"));
  assert(r.blockers.includes("INBOX_UNATTRIBUTED_HISTORY_UNAVAILABLE"));
  assert(r.blockers.includes("PLATFORM_RECEIPT_HISTORY_REQUIRED"));
  assert(r.blockers.includes("RETAINED_PROVIDER_OR_MANUAL_OUTCOME"));
  assert.equal(r.inbox.length, 0);
  assert.notEqual(r.hash, before.hash);
});

for (const [name, sql] of [
  ["poll org", "UPDATE integration_refund_polls SET org_id='foreign'"],
  [
    "partial poll claim",
    "UPDATE integration_refund_polls SET token='claim',started_at=NULL",
  ],
  [
    "negative poll start",
    "UPDATE integration_refund_polls SET token='claim',started_at=-1",
  ],
  ["missing poll", "DELETE FROM integration_refund_polls"],
] as const)
  test(`boundary: refuses ${name} without clearing copied claims`, async (t) => {
    const f = await setup(t);
    corrupt(f, sql);
  });

test("boundary GAP: a negative retained refund retry time is refused", async (t) => {
  const f = await setup(t);
  corrupt(f, "UPDATE integration_refund_polls SET retry_at=-1");
});

test("boundary: generic accounting lease is retained verbatim, including a terminal effect", async (t) => {
  const f = await setup(t),
    { payment } = await ledger(f);
  const s = f.app.database.owned("integration"),
    before = review(f);
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        s.run(
          "UPDATE integration_operation_leases SET token='exact-lease',started_at=987 WHERE effect_id=?",
          payment.id,
        );
        const r = inside(f),
          lease = r.leases.find((x) => x.effect_id === payment.id)!;
        assert.equal(lease.token, "exact-lease");
        assert.equal(lease.started_at, 987);
        assert(r.blockers.includes("RETAINED_GENERIC_LEASES"));
        assert.equal(
          r.effects.find((x) => x.id === payment.id)!.state,
          "completed",
        );
        assert.notEqual(r.hash, before.hash);
        throw Error("rollback lease");
      }),
    /rollback lease/,
  );
  assert.deepEqual(review(f), before);
  corrupt(
    f,
    "UPDATE integration_operation_leases SET org_id='foreign' WHERE effect_id=?",
    payment.id,
  );
});

test("boundary: copied accounting mapping cannot hide a foreign effect behind matching native invoice", async (t) => {
  const f = await setup(t),
    { payment } = await ledger(f);
  corrupt(
    f,
    "UPDATE integration_effects SET org_id='foreign',account_id='foreign' WHERE id=?",
    payment.id,
  );
});

test("boundary: malformed foreign Billing manual proof remains a declared dependency, not an Integration completeness assertion", async (t) => {
  const f = await setup(t);
  f.app.database
    .owned("billing")
    .run(
      "INSERT INTO billing_refund_proofs VALUES('foreign',?,?,?)",
      "copied-manual",
      f.refundId,
      "not-a-time",
    );
  const r = review(f);
  assert.equal(r.billing.accountingFact.cashReference, null);
  assert(r.blockers.includes("BILLING_COMPLETE_HISTORY_REQUIRED"));
  assert(!("manualProofs" in r));
  assert(!("qualified" in r));
  assert(!("allowed" in r));
});

test("repair: retained session links detect copied callbacks across scope and remain bounded before materialization", async (t) => {
  const f = await setup(t);
  await checkout(f);
  corrupt(
    f,
    "UPDATE integration_callbacks SET effect_id='orphan',org_id='foreign'",
  );
  const original = Store.prototype.all,
    selected: string[] = [];
  t.mock.method(
    Store.prototype,
    "all",
    function (
      this: Store,
      sql: string,
      ...args: Parameters<Store["all"]> extends [string, ...infer P] ? P : never
    ) {
      selected.push(sql);
      return original.call(this, sql, ...args);
    },
  );
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        const s = f.app.database.owned("integration");
        for (let i = 0; i < 65; i++)
          s.run(
            "INSERT INTO integration_callbacks SELECT ?,org_id,binding_id,?,session_id,'orphan',hash,state,attempts,started_at,retry_at,error,created_at FROM integration_callbacks WHERE event_id='evt_boundary'",
            `copy-${i}`,
            `evt_copy_${i}`,
          );
        inside(f);
      }),
    { code: "OFFLINE_REFUND_REVIEW_LIMIT" },
  );
  assert(
    !selected.some((sql) => /SELECT \* FROM integration_callbacks/.test(sql)),
  );
});

test("repair: Canadian USD checkout and accounting history retain their configured currency", async (t) => {
  const f = await setup(t, "CA", "USD");
  await checkout(f);
  await ledger(f);
  const r = review(f);
  assert.equal(r.currency, "USD");
  assert.equal(
    JSON.parse(String(r.checkoutObservations[0]!.snapshot)).currency,
    "USD",
  );
  assert.equal(
    JSON.parse(String(r.balanceObservations[0]!.result)).currency,
    "USD",
  );
});

test("repair: historical balances survive a later native payment without being compared to current totals", async (t) => {
  const f = await setup(t);
  await ledger(f);
  const before = review(f),
    historical = JSON.parse(String(before.balanceObservations[0]!.result));
  f.app.database.transaction(() =>
    f.app.billing.verifiedPayment(
      f.actor,
      f.invoiceId,
      1,
      "stripe",
      "pi_later_boundary",
    ),
  );
  assert.notEqual(
    f.app.billing.totals(f.actor, f.invoiceId).balance,
    historical.nativeBalance,
  );
  assert.deepEqual(review(f).balanceObservations, before.balanceObservations);
});

test("repair: shared immutable accounting summary fields cannot diverge", async (t) => {
  const f = await setup(t),
    { payment } = await ledger(f);
  for (const [field, value] of [
    ["number", "copied-number"],
    ["currency", "USD"],
    ["total", 0],
  ] as const)
    corrupt(
      f,
      `UPDATE integration_effects SET payload=json_set(payload,'$.invoice.${field}',?) WHERE id=?`,
      value,
      payment.id,
    );
});

test("repair: matching balance copies cannot conceal negative components, wrong bindings or rounded arithmetic", async (t) => {
  const f = await setup(t);
  await ledger(f);
  const s = f.app.database.owned("integration");
  const changes = [
    { credited: -1 },
    { paid: "22600" },
    { refunded: 0.5 },
    { reference: "other-invoice" },
    { currency: "USD" },
    { total: 1 },
    { requestedAt: "copied" },
    // Float subtraction can lose the one-cent contradiction at the safe-int edge.
    {
      total: 22600,
      credited: Number.MAX_SAFE_INTEGER,
      paid: 22602,
      refunded: 2,
      nativeBalance: -Number.MAX_SAFE_INTEGER + 1,
      difference: Number.MAX_SAFE_INTEGER - 1,
      providerBalance: 0,
    },
  ];
  for (const change of changes) {
    const before = review(f);
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          const row = s.get(
            "SELECT result FROM integration_balance_observations",
          )!;
          const result = { ...JSON.parse(String(row.result)), ...change };
          const encoded = canonical(result);
          s.run("UPDATE integration_balance_reads SET result=?", encoded);
          s.run(
            "UPDATE integration_balance_observations SET result=?",
            encoded,
          );
          inside(f);
        }),
      invalid,
    );
    assert.deepEqual(review(f), before);
  }
});
