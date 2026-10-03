import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fixture, accept, ship } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { canonical, digest, type Actor, type Row } from "../src/server/core.ts";
import { Store } from "../src/server/database.ts";
import { BillingOfflineCheckoutReview } from "../src/server/billing-offline-checkout-review.ts";

const refusal = { code: "OFFLINE_CHECKOUT_BILLING_REVIEW" };
const limit = { code: "OFFLINE_CHECKOUT_BILLING_LIMIT" };
function reader(f: ReturnType<typeof fixture>) {
  return new BillingOfflineCheckoutReview(
    f.app.database,
    f.app.identity,
    f.app.billing,
  );
}
function setup(
  t: TestContext,
  region: "CA" | "US" = "CA",
  currency: "CAD" | "USD" = "CAD",
) {
  const f = fixture(t, { eventReports: true }, region, currency);
  const invoiceId = ship(f, accept(f, 2).id).invoiceId;
  const user = f.app.identity.createUser(f.actor, "reviewer", {
    email: "reviewer@synthetic.test",
    name: "Native finance",
    role: "finance",
    sites: [f.w1],
    password: "long-synthetic-password",
  });
  const finance = f.app.identity.currentActor({ ...f.actor, id: user.id });
  const review = () =>
    f.app.database.transaction(() =>
      reader(f).getInTransaction(finance, invoiceId),
    );
  const stripe = (amount: number, reference = "pi_native") =>
    f.app.database.transaction(() =>
      f.app.billing.verifiedPayment(
        f.actor,
        invoiceId,
        amount,
        "stripe",
        reference,
      ),
    );
  const manual = (amount: number, reference = "bank_native") =>
    f.app.billing.manualPayment(f.actor, reference, {
      invoiceId,
      amount,
      reference,
      reason: "Synthetic native payment",
    });
  const credit = (quantity = 2) =>
    f.app.billing.issueCredit(f.actor, `credit-${quantity}`, {
      invoiceId,
      reference: `credit-${quantity}`,
      reason: "Synthetic native credit",
      lines: [
        {
          lineId: String(f.app.billing.lines(f.actor, invoiceId)[0]!.id),
          quantity,
        },
      ],
    });
  const request = (paymentId: string, amount: number, reference = "refund") =>
    f.app.billing.refundRequest(f.actor, reference, {
      invoiceId,
      paymentId,
      amount,
      reference,
      reason: "Synthetic refund",
    }).id;
  const observe = (
    refundId: string,
    status: "pending" | "requires_action" | "succeeded" | "failed" | "canceled",
  ) =>
    f.app.database.transaction(() => {
      const intent = f.app.billing.refunds.intent(f.actor, refundId);
      f.app.billing.refunds.observe(
        f.actor,
        intent,
        `re_${refundId.replace(/-/g, "_")}`,
        { ...intent, status },
      );
    });
  return Object.assign(f, {
    invoiceId,
    finance,
    review,
    stripe,
    manual,
    credit,
    request,
    observe,
  });
}
type F = ReturnType<typeof setup>;
function store(f: F) {
  return f.app.database.owned("billing");
}
function snapshot(f: F) {
  const tables = [
    "billing_invoices",
    "billing_lines",
    "billing_credits",
    "billing_credit_lines",
    "billing_payments",
    "billing_refunds",
    "billing_refund_provider",
    "billing_refund_observations",
    "billing_refund_proofs",
    "billing_refund_alerts",
    "billing_refund_alert_updates",
    "billing_refund_alert_reads",
  ];
  return canonical(
    tables.map((table) => [
      table,
      store(f).all(`SELECT * FROM ${table} ORDER BY rowid`),
    ]),
  );
}
function rich(
  t: TestContext,
  region: "CA" | "US" = "CA",
  currency: "CAD" | "USD" = "CAD",
) {
  const f = setup(t, region, currency),
    p = f.stripe(20000),
    m = f.manual(2600);
  f.credit();
  const target = f.request(p.id, 5000),
    sibling = f.request(p.id, 1000, "sibling"),
    manual = f.request(m.id, 2000, "manual-refund");
  f.app.billing.manualRefund(f.actor, "bank-proof", {
    refundId: manual,
    reference: "bank-repayment",
    reason: "Synthetic refund proof",
  });
  f.app.database.transaction(() =>
    f.app.billing.refunds.markUnknown(f.actor, target),
  );
  f.observe(target, "requires_action");
  f.observe(target, "succeeded");
  f.observe(target, "pending");
  f.app.billing.refunds.alerts.acknowledge(f.finance, "notice-read", {
    noticeId: target,
    revision: 2,
  });
  return Object.assign(f, {
    target,
    sibling,
    manualRefund: manual,
    paymentId: p.id,
  });
}
for (const [region, currency] of [
  ["CA", "CAD"],
  ["CA", "USD"],
  ["US", "USD"],
] as const) {
  test(`native ${region}/${currency} unpaid, partial manual, full Stripe settlement and frozen hash`, (t) => {
    const f = setup(t, region, currency),
      a = f.review();
    assert.equal(a.region, region);
    assert.equal(a.currency, currency);
    assert.equal(a.capacity.balance, 22600);
    for (const name of [
      "credits",
      "creditLines",
      "payments",
      "refunds",
      "providerMappings",
      "observations",
      "manualProofs",
      "notices",
      "noticeUpdates",
      "noticeReads",
      "openingDocuments",
      "openingLines",
    ] as const)
      assert.deepEqual(a[name], []);
    f.manual(2600);
    assert.equal(f.review().capacity.balance, 20000);
    f.stripe(20000);
    const before = snapshot(f),
      b = f.review();
    assert.equal(b.capacity.paid, 22600);
    assert.equal(b.capacity.balance, 0);
    assert.equal(b.payments.length, 2);
    assert.equal(snapshot(f), before);
    const { factsHash, ...body } = b;
    assert.equal(factsHash, digest(canonical(body)));
    assert.equal(b.purpose, "billing.offline-checkout-native-history.v1");
    assert(
      Object.isFrozen(b) &&
        Object.isFrozen(b.invoice) &&
        Object.isFrozen(b.payments) &&
        Object.isFrozen(b.payments[0]) &&
        Object.isFrozen(b.capacity.payments),
    );
    assert.throws(() => Object.assign(b.invoice, { total: 1 }), TypeError);
    assert.equal(a.payments.length, 0);
  });
  test(`native ${region}/${currency} complete mixed credit/refund/notice histories under hold`, (t) => {
    const f = rich(t, region, currency),
      before = snapshot(f);
    f.app.platform.isolateRestore(
      "synthetic-native-history",
      new Date().toISOString(),
    );
    const r = f.review();
    assert.equal(r.credits.length, 1);
    assert.equal(r.creditLines.length, 1);
    assert.equal(r.refunds.length, 3);
    assert.equal(r.manualProofs.length, 1);
    assert.equal(r.providerMappings.length, 1);
    assert.equal(r.observations.length, 3);
    assert.equal(r.observations.at(-1)!.applied, 0);
    assert.equal(r.notices.length, 1);
    assert.equal(r.noticeUpdates.length, 2);
    assert.equal(r.noticeReads.length, 1);
    assert.equal(r.capacity.credited, 22600);
    assert.equal(r.capacity.refunded, 7000);
    assert.equal(r.capacity.pendingReservations, 1000);
    assert.equal(r.capacity.invoiceAvailable, 14600);
    assert.equal(snapshot(f), before);
  });
}
test("same held writer sees uncommitted actual payment; rollback and reopen preserve facts", (t) => {
  const f = setup(t),
    before = f.review(),
    bytes = snapshot(f);
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        f.app.billing.verifiedPayment(
          f.actor,
          f.invoiceId,
          5000,
          "stripe",
          "pi_uncommitted",
        );
        const r = reader(f).getInTransaction(f.finance, f.invoiceId);
        assert.equal(r.capacity.paid, 5000);
        const other = new DatabaseSync(f.path, { timeout: 1 });
        try {
          assert.throws(() => other.exec("BEGIN IMMEDIATE"), /locked/);
        } finally {
          other.close();
        }
        throw Error("roll back fixture");
      }),
    /roll back fixture/,
  );
  assert.equal(snapshot(f), bytes);
  assert.deepEqual(f.review(), before);
  f.app.close();
  f.app = new Application(f.path, "CA", { eventReports: true });
  assert.deepEqual(f.review(), before);
});
test("requires caller writer and fresh native role/account/password/tenant authority", (t) => {
  const f = setup(t);
  assert.throws(() => reader(f).getInTransaction(f.finance, f.invoiceId), {
    code: "TRANSACTION",
  });
  assert.equal(
    f.app.database.transaction(() =>
      reader(f).getInTransaction(
        { ...f.finance, role: "buyer" } as Actor,
        f.invoiceId,
      ),
    ).invoice.id,
    f.invoiceId,
  );
  for (const sql of [
    "UPDATE iam_users SET active=0 WHERE id=?",
    "UPDATE iam_users SET role='support' WHERE id=?",
    "UPDATE iam_users SET account_id='copied-account' WHERE id=?",
    "UPDATE iam_users SET org_id='copied-org' WHERE id=?",
    "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
  ]) {
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          f.app.database.owned("iam").run(sql, f.finance.id);
          assert.throws(
            () => reader(f).getInTransaction(f.finance, f.invoiceId),
            /principal|permitted|buyer|password|permission/i,
          );
          throw Error("fixture rollback");
        }),
      /fixture rollback/,
    );
  }
  assert.equal(f.review().invoice.id, f.invoiceId);
});
test("hostile actor and invoice identities never run getters/proxy/coercion callbacks", (t) => {
  const f = setup(t);
  let calls = 0;
  const trap = () => {
    calls++;
    throw Error("executed callback");
  };
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  const actorValues = [
    new Proxy(
      {},
      {
        get: trap,
        getOwnPropertyDescriptor: trap,
        getPrototypeOf: trap,
        ownKeys: trap,
      },
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
    { id: { toString: trap }, orgId: f.actor.orgId },
  ];
  for (const value of actorValues)
    assert.throws(
      () =>
        f.app.database.transaction(() =>
          reader(f).getInTransaction(value as Actor, f.invoiceId),
        ),
      refusal,
    );
  for (const value of [
    null,
    {},
    new Proxy({}, { get: trap }),
    { toString: trap },
    " ",
    "x".repeat(129),
    "bad\0id",
  ])
    assert.throws(
      () =>
        f.app.database.transaction(() =>
          reader(f).getInTransaction(f.finance, value),
        ),
      refusal,
    );
  assert.equal(calls, 0);
});
test("complete native histories exceed ordinary page sizes and retain every ignored observation", (t) => {
  const f = rich(t);
  for (let i = 0; i < 30; i++) f.observe(f.target, "pending");
  for (let i = 0; i < 30; i++) f.stripe(1, `pi_extra_${i}`);
  const r = f.review();
  assert.equal(r.payments.length, 32);
  assert.equal(r.observations.length, 33);
  assert.equal(r.observations.filter((o) => o.applied === 0).length, 31);
  assert.equal(r.capacity.paid, 22630);
});
for (const status of [
  "pending",
  "requires_action",
  "succeeded",
  "failed",
  "canceled",
] as const)
  test(`native Stripe refund ${status} conservation and notice history`, (t) => {
    const f = setup(t),
      p = f.stripe(22600);
    f.credit();
    const id = f.request(p.id, 1000);
    f.observe(id, status);
    const r = f.review();
    assert.equal(r.providerMappings[0]!.status, status);
    assert.equal(
      r.refunds[0]!.state,
      status === "succeeded"
        ? "completed"
        : ["failed", "canceled"].includes(status)
          ? "rejected"
          : "unknown",
    );
  });

test("local payment copied onto foreign invoice identity cannot disappear from closure", (t) => {
  const f = setup(t),
    b = store(f);
  b.run(
    "INSERT INTO billing_invoices SELECT 'foreign-invoice','foreign-org',account_id,'foreign-order','foreign-shipment','foreign-number',currency,net,tax,total,created_at FROM billing_invoices WHERE id=?",
    f.invoiceId,
  );
  b.run(
    "INSERT INTO billing_payments VALUES('orphan-local',?, 'foreign-invoice','stripe','pi_copied',1,?)",
    f.actor.orgId,
    new Date().toISOString(),
  );
  assert.throws(f.review, refusal);
});

const corruptions: [string, (f: ReturnType<typeof rich>) => void][] = [
  [
    "invoice tenant",
    (f) =>
      store(f).run(
        "UPDATE billing_invoices SET org_id='foreign' WHERE id=?",
        f.invoiceId,
      ),
  ],
  [
    "invoice account",
    (f) =>
      store(f).run(
        "UPDATE billing_invoices SET account_id='missing' WHERE id=?",
        f.invoiceId,
      ),
  ],
  [
    "invoice currency",
    (f) =>
      store(f).run(
        "UPDATE billing_invoices SET currency='USD' WHERE id=?",
        f.invoiceId,
      ),
  ],
  [
    "invoice net/line mismatch",
    (f) =>
      store(f).run(
        "UPDATE billing_invoices SET net=net+1,total=total+1 WHERE id=?",
        f.invoiceId,
      ),
  ],
  [
    "line copied org",
    (f) =>
      store(f).run(
        "UPDATE billing_lines SET org_id='foreign' WHERE invoice_id=?",
        f.invoiceId,
      ),
  ],
  [
    "line detached invoice",
    (f) =>
      store(f).run(
        "UPDATE billing_lines SET invoice_id='missing' WHERE invoice_id=?",
        f.invoiceId,
      ),
  ],
  [
    "credit copied org",
    (f) =>
      store(f).run(
        "UPDATE billing_credits SET org_id='foreign' WHERE invoice_id=?",
        f.invoiceId,
      ),
  ],
  [
    "credit moved invoice reverse line",
    (f) =>
      store(f).run(
        "UPDATE billing_credits SET invoice_id='missing' WHERE invoice_id=?",
        f.invoiceId,
      ),
  ],
  [
    "credit original amount",
    (f) =>
      store(f).run(
        "UPDATE billing_credits SET net=net+1,total=total+1 WHERE invoice_id=?",
        f.invoiceId,
      ),
  ],
  [
    "credit line orphan",
    (f) =>
      store(f).run("UPDATE billing_credit_lines SET invoice_line_id='missing'"),
  ],
  [
    "credit line duplicated",
    (f) =>
      store(f).run(
        "INSERT INTO billing_credit_lines SELECT 'duplicate-line',org_id,credit_id,invoice_line_id,quantity FROM billing_credit_lines",
      ),
  ],
  [
    "credit exceeds sold",
    (f) => store(f).run("UPDATE billing_credit_lines SET quantity=3"),
  ],
  [
    "payment copied org",
    (f) =>
      store(f).run(
        "UPDATE billing_payments SET org_id='foreign' WHERE id=?",
        f.paymentId,
      ),
  ],
  [
    "payment wrong invoice reverse refund",
    (f) =>
      store(f).run(
        "UPDATE billing_payments SET invoice_id='missing' WHERE id=?",
        f.paymentId,
      ),
  ],
  [
    "payment invalid Stripe reference",
    (f) =>
      store(f).run(
        "UPDATE billing_payments SET external_ref='session_not_payment' WHERE id=?",
        f.paymentId,
      ),
  ],
  [
    "payment unsupported provider",
    (f) =>
      store(f).run(
        "UPDATE billing_payments SET provider='other' WHERE id=?",
        f.paymentId,
      ),
  ],
  [
    "refund wrong invoice reverse payment",
    (f) =>
      store(f).run(
        "UPDATE billing_refunds SET invoice_id='missing' WHERE id=?",
        f.target,
      ),
  ],
  [
    "refund missing payment",
    (f) =>
      store(f).run(
        "UPDATE billing_refunds SET payment_id='missing' WHERE id=?",
        f.sibling,
      ),
  ],
  [
    "sibling reservation exceeds entitlement",
    (f) =>
      store(f).run(
        "UPDATE billing_refunds SET amount=21000 WHERE id=?",
        f.sibling,
      ),
  ],
  [
    "manual proof missing",
    (f) => store(f).run("DELETE FROM billing_refund_proofs"),
  ],
  [
    "provider mapping missing",
    (f) => store(f).run("DELETE FROM billing_refund_provider"),
  ],
  [
    "provider mapping wrong org",
    (f) => store(f).run("UPDATE billing_refund_provider SET org_id='foreign'"),
  ],
  [
    "provider mapping wrong status",
    (f) => store(f).run("UPDATE billing_refund_provider SET status='failed'"),
  ],
  [
    "provider mapping wrong reference",
    (f) =>
      store(f).run(
        "UPDATE billing_refund_provider SET external_ref='re_wrong'",
      ),
  ],
  [
    "observation false applied",
    (f) =>
      store(f).run(
        "UPDATE billing_refund_observations SET applied=1 WHERE status='pending'",
      ),
  ],
  [
    "observation removed initial",
    (f) =>
      store(f).run(
        "DELETE FROM billing_refund_observations WHERE status='requires_action'",
      ),
  ],
  [
    "observation chronology",
    (f) =>
      store(f).run(
        "UPDATE billing_refund_observations SET created_at='2000-01-01T00:00:00.000Z'",
      ),
  ],
  [
    "notice wrong invoice",
    (f) =>
      store(f).run("UPDATE billing_refund_alerts SET invoice_id='missing'"),
  ],
  [
    "notice wrong revision",
    (f) => store(f).run("UPDATE billing_refund_alerts SET revision=3"),
  ],
  [
    "notice update missing",
    (f) =>
      store(f).run("DELETE FROM billing_refund_alert_updates WHERE revision=1"),
  ],
  [
    "notice update source",
    (f) =>
      store(f).run(
        "UPDATE billing_refund_alert_updates SET source='existing-state' WHERE revision=2",
      ),
  ],
  [
    "notice read future revision",
    (f) => store(f).run("UPDATE billing_refund_alert_reads SET revision=3"),
  ],
  [
    "notice read wrong org",
    (f) =>
      store(f).run("UPDATE billing_refund_alert_reads SET org_id='foreign'"),
  ],
  [
    "orphan notice linked invoice",
    (f) => store(f).run("UPDATE billing_refund_alerts SET refund_id='missing'"),
  ],
];
for (const [name, corrupt] of corruptions)
  test(`refuses native retained ${name}`, (t) => {
    const f = rich(t);
    corrupt(f);
    const bytes = snapshot(f);
    assert.throws(f.review);
    assert.equal(snapshot(f), bytes);
  });

for (const table of [
  "billing_refund_provider",
  "billing_refund_observations",
  "billing_refund_proofs",
  "billing_refund_alerts",
  "billing_refund_alert_updates",
  "billing_refund_alert_reads",
])
  test(`complete ${table} local orphan is not silently omitted`, (t) => {
    const f = rich(t);
    store(f).run(`UPDATE ${table} SET refund_id='missing'`);
    assert.throws(f.review, refusal);
  });
for (const table of [
  "billing_payments",
  "billing_refund_provider",
  "billing_refund_observations",
  "billing_refund_proofs",
])
  test(`copied ${table} external identity collision is refused without foreign values`, (t) => {
    const f = rich(t),
      b = store(f);
    if (table === "billing_payments")
      b.run(
        "INSERT INTO billing_payments SELECT 'foreign-payment','PRIVATE-FOREIGN', 'foreign-invoice',provider,external_ref,amount,created_at FROM billing_payments WHERE id=?",
        f.paymentId,
      );
    else if (table === "billing_refund_provider")
      b.run(
        "INSERT INTO billing_refund_provider SELECT 'foreign-refund','PRIVATE-FOREIGN',external_ref,status FROM billing_refund_provider",
      );
    else if (table === "billing_refund_observations")
      b.run(
        "INSERT INTO billing_refund_observations(org_id,refund_id,external_ref,status,applied,created_at) SELECT 'PRIVATE-FOREIGN','foreign-refund',external_ref,status,applied,created_at FROM billing_refund_observations LIMIT 1",
      );
    else
      b.run(
        "INSERT INTO billing_refund_proofs SELECT 'PRIVATE-FOREIGN',external_ref,'foreign-refund',created_at FROM billing_refund_proofs",
      );
    assert.throws(f.review, (error: unknown) => {
      assert.equal((error as { code: string }).code, refusal.code);
      assert(!String(error).includes("PRIVATE-FOREIGN"));
      return true;
    });
  });

// Instrument only retained Billing reads, not current IAM's independent reader.
function noMaterialization(f: F, fn: () => void) {
  const all = Store.prototype.all,
    get = Store.prototype.get;
  let calls = 0;
  Store.prototype.all = function <T extends Row = Row>(
    this: Store,
    sql: string,
    ...params: SQLInputValue[]
  ) {
    if (
      /SELECT (?:\*|id,|refund_id,|org_id,|seq,)/.test(sql) &&
      /FROM billing_/.test(sql)
    )
      calls++;
    return all.call(this, sql, ...params) as T[];
  };
  Store.prototype.get = function <T extends Row = Row>(
    this: Store,
    sql: string,
    ...params: SQLInputValue[]
  ) {
    if (/SELECT \* FROM billing_/.test(sql)) calls++;
    return get.call(this, sql, ...params) as T | undefined;
  };
  try {
    fn();
    assert.equal(
      calls,
      0,
      "preflight must finish before retained Billing materialization",
    );
  } finally {
    Store.prototype.all = all;
    Store.prototype.get = get;
  }
}
const byteColumns = [
  ["billing_invoices", "number"],
  ["billing_lines", "description"],
  ["billing_credits", "reason"],
  ["billing_credit_lines", "id"],
  ["billing_payments", "external_ref"],
  ["billing_refunds", "reference"],
  ["billing_refund_provider", "external_ref"],
  ["billing_refund_observations", "external_ref"],
  ["billing_refund_proofs", "external_ref"],
  ["billing_refund_alerts", "updated_at"],
  ["billing_refund_alert_updates", "created_at"],
  ["billing_refund_alert_reads", "actor_id"],
] as const;
for (const [table, column] of byteColumns)
  test(`${table} UTF8 bytes after NUL bounded before any retained materialization`, (t) => {
    const f = rich(t);
    store(f).run(
      `UPDATE ${table} SET ${column}=? WHERE rowid=(SELECT MIN(rowid) FROM ${table})`,
      "x\0" + "界".repeat(22000),
    );
    noMaterialization(f, () => assert.throws(f.review, limit));
  });
const integerColumns = [
  ["billing_invoices", "net"],
  ["billing_lines", "quantity"],
  ["billing_credits", "net"],
  ["billing_credit_lines", "quantity"],
  ["billing_payments", "amount"],
  ["billing_refunds", "amount"],
  ["billing_refund_observations", "id"],
  ["billing_refund_alerts", "revision"],
  ["billing_refund_alert_updates", "revision"],
  ["billing_refund_alert_reads", "revision"],
] as const;
for (const [table, column] of integerColumns)
  test(`${table} unsafe native integer refused before JS conversion`, (t) => {
    const f = rich(t);
    if (column === "net")
      store(f).run(
        `UPDATE ${table} SET net=9223372036854775807,tax=0,total=9223372036854775807`,
      );
    else
      store(f).run(
        `UPDATE ${table} SET ${column}=9223372036854775807 WHERE rowid=(SELECT MIN(rowid) FROM ${table})`,
      );
    noMaterialization(f, () => assert.throws(f.review, limit));
  });
test("complete expanded aggregate refuses before first retained row even when each field/row fits", (t) => {
  const f = rich(t);
  store(f).run(
    "UPDATE billing_refund_alert_updates SET created_at=?",
    "界".repeat(18000),
  );
  store(f).run(
    "UPDATE billing_refund_alert_reads SET acknowledged_at=?",
    "界".repeat(18000),
  );
  store(f).run(
    "UPDATE billing_refund_observations SET created_at=?",
    "界".repeat(18000),
  );
  store(f).run(
    "UPDATE billing_refund_proofs SET created_at=?",
    "界".repeat(18000),
  );
  noMaterialization(f, () => assert.throws(f.review, limit));
});
test("full row byte bound precedes materialization even when fields fit", (t) => {
  const f = setup(t),
    s = "x".repeat(50000);
  store(f).run(
    "UPDATE billing_invoices SET number=?,order_id=?,shipment_id=? WHERE id=?",
    s,
    s,
    s,
    f.invoiceId,
  );
  noMaterialization(f, () => assert.throws(f.review, limit));
});
test("complete set over 1000 rows refuses instead of paging", (t) => {
  const f = rich(t);
  f.app.database.transaction(() => {
    for (let i = 0; i < 1001; i++)
      store(f).run(
        "INSERT INTO billing_refund_observations(org_id,refund_id,external_ref,status,applied,created_at) VALUES(?,?, 're_boundary','pending',0,?)",
        f.actor.orgId,
        f.target,
        new Date().toISOString(),
      );
  });
  noMaterialization(f, () => assert.throws(f.review, limit));
});
test("opening line profile is explicitly refused without reading any retained text", (t) => {
  const f = setup(t),
    line = String(f.app.billing.lines(f.actor, f.invoiceId)[0]!.id);
  store(f).run(
    "INSERT INTO billing_opening_lines VALUES(?,?,?,0)",
    line,
    f.actor.orgId,
    f.invoiceId,
  );
  noMaterialization(f, () =>
    assert.throws(f.review, {
      code: "OFFLINE_CHECKOUT_BILLING_OPENING_REQUIRED",
    }),
  );
});
test("opening document profile explicitly refuses oversized source text before materialization", (t) => {
  const f = setup(t),
    at = new Date().toISOString();
  store(f).run(
    "INSERT INTO billing_opening_documents VALUES(?,?,?,?,?,?,?,?,?,0,0,0,22600,?,?)",
    f.invoiceId,
    f.actor.orgId,
    "private\0" + "界".repeat(30000),
    "source",
    "batch",
    "a".repeat(64),
    at,
    at,
    at,
    f.actor.id,
    at,
  );
  noMaterialization(f, () =>
    assert.throws(f.review, {
      code: "OFFLINE_CHECKOUT_BILLING_OPENING_REQUIRED",
    }),
  );
});

for (const hex of ["ff", "f09080"])
  test(`malformed SQLite UTF8 ${hex} must not become a different hashed JS string`, (t) => {
    const f = setup(t);
    store(f).run(
      `UPDATE billing_lines SET description=CAST(x'${hex}' AS TEXT) WHERE invoice_id=?`,
      f.invoiceId,
    );
    assert.throws(f.review, refusal);
  });
test("native partial credit without payment/refund and Stripe overpayment remain representable", (t) => {
  const f = setup(t);
  f.credit(1);
  assert.equal(f.review().capacity.balance, 11300);
  f.stripe(20000);
  const r = f.review();
  assert.equal(r.capacity.balance, -8700);
  assert.equal(r.capacity.invoiceAvailable, 8700);
  assert.equal(r.refunds.length, 0);
});
test("refund reservation cannot consume another payment capacity even within invoice entitlement", (t) => {
  const f = rich(t);
  store(f).run(
    "UPDATE billing_refunds SET payment_id=(SELECT id FROM billing_payments WHERE provider='manual'),amount=2601 WHERE id=?",
    f.sibling,
  );
  assert.throws(f.review, refusal);
});
test("bounded aggregate row count is checked before row decoding", (t) => {
  const f = setup(t),
    b = store(f),
    line = String(f.app.billing.lines(f.actor, f.invoiceId)[0]!.id);
  f.app.database.transaction(() => {
    // Deliberately malformed but small raw facts: type/byte/count refusal precedes
    // semantic reconciliation. No recursive SQL permission or disabled guard.
    for (let i = 0; i < 1000; i++) {
      b.run(
        "INSERT INTO billing_credits VALUES(?,'x',?,?,?,'x',0,0,0,'x')",
        `c${i}`,
        f.invoiceId,
        `r${i}`,
        `n${i}`,
      );
      b.run(
        "INSERT INTO billing_credit_lines VALUES(?,'x',?,?,1)",
        `l${i}`,
        `c${i}`,
        line,
      );
      b.run(
        "INSERT INTO billing_payments VALUES(?,'x',?,'manual',?,1,'x')",
        `p${i}`,
        f.invoiceId,
        `p${i}`,
      );
      b.run(
        "INSERT INTO billing_refunds VALUES(?,'x',?,?,1,?,'pending','x')",
        `r${i}`,
        f.invoiceId,
        `p${i}`,
        `r${i}`,
      );
    }
    for (let i = 0; i < 100; i++)
      b.run(
        "INSERT INTO billing_refund_provider VALUES(?,'x',?,'pending')",
        `r${i}`,
        `e${i}`,
      );
  });
  noMaterialization(f, () => assert.throws(f.review, limit));
});

test("actual multibyte native bank reference and multiline credit reason retain exact text", (t) => {
  const f = setup(t);
  f.manual(1000, "銀行-évidence");
  const reason = "Crédit — 測定\nReviewed evidence";
  f.app.billing.issueCredit(f.actor, "unicode-credit", {
    invoiceId: f.invoiceId,
    reference: "unicode-credit",
    reason,
    lines: [
      {
        lineId: String(f.app.billing.lines(f.actor, f.invoiceId)[0]!.id),
        quantity: 1,
      },
    ],
  });
  const r = f.review();
  assert.equal(r.credits[0]!.reason, reason);
  assert.equal(r.payments[0]!.external_ref, "銀行-évidence");
  const { factsHash, ...body } = r;
  assert.equal(factsHash, digest(canonical(body)));
});
for (const sql of [
  "UPDATE iam_accounts SET currency='USD' WHERE id=?",
  "UPDATE iam_accounts SET org_id='foreign-org' WHERE id=?",
])
  test(`current native account scope refuses ${sql}`, (t) => {
    const f = setup(t);
    f.app.database.owned("iam").run(sql, f.buyer);
    assert.throws(f.review);
  });
test("later native history damage changes review refusal inside the same writer", (t) => {
  const f = rich(t),
    before = f.review();
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        assert.equal(
          reader(f).getInTransaction(f.finance, f.invoiceId).factsHash,
          before.factsHash,
        );
        store(f).run(
          "DELETE FROM billing_refund_alert_updates WHERE revision=1",
        );
        assert.throws(
          () => reader(f).getInTransaction(f.finance, f.invoiceId),
          refusal,
        );
        throw Error("fixture rollback");
      }),
    /fixture rollback/,
  );
  assert.deepEqual(f.review(), before);
});
