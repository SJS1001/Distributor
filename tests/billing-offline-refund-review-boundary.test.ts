import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { fixture, accept, ship } from "./fixtures.ts";
import { canonical, digest } from "../src/server/core.ts";
import { offlineRefundReviewLimits } from "../src/server/billing-refunds.ts";

// Independent native fixture. No existing test is imported or modified. Native
// markUnknown models Billing's retained state only; no Integration eligibility
// or provider execution is asserted by this read-only boundary suite.
function setup(
  t: TestContext,
  region: "CA" | "US" = "CA",
  currency: "CAD" | "USD" = "USD",
) {
  const f = fixture(t, { eventReports: true }, region, currency);
  const invoiceId = ship(f, accept(f, 2).id).invoiceId;
  const payment = f.app.database.transaction(() =>
    f.app.billing.verifiedPayment(
      f.actor,
      invoiceId,
      20000,
      "stripe",
      "pi_boundary",
    ),
  );
  const manual = f.app.billing.manualPayment(f.actor, "manual", {
    invoiceId,
    amount: 2600,
    reference: "BOUNDARY-BANK",
    reason: "Synthetic native payment",
  });
  const lineId = String(f.app.billing.lines(f.actor, invoiceId)[0]!.id);
  const credits = ["first", "second"].map((reference) =>
    f.app.billing.issueCredit(f.actor, reference, {
      invoiceId,
      reference,
      reason: "Synthetic split credit",
      lines: [{ lineId, quantity: 1 }],
    }),
  );
  const request = (reference: string, paymentId: string, amount: number) =>
    f.app.billing.refundRequest(f.actor, reference, {
      invoiceId,
      paymentId,
      amount,
      reference,
      reason: "Synthetic refund boundary",
    }).id;
  const target = request("target", payment.id, 5000);
  const sibling = request("sibling", payment.id, 1000);
  const manualRefund = request("manual-refund", manual.id, 2000);
  f.app.billing.manualRefund(f.actor, "proof", {
    refundId: manualRefund,
    reference: "BOUNDARY-REPAYMENT",
    reason: "Synthetic manual proof",
  });
  f.app.database.transaction(() =>
    f.app.billing.refunds.markUnknown(f.actor, target),
  );
  const user = f.app.identity.createUser(f.actor, "reviewer", {
    email: "boundary@synthetic.test",
    name: "Boundary finance",
    role: "finance",
    sites: [f.w1],
    password: "synthetic-long-boundary-password",
  });
  const finance = f.app.identity.currentActor({ ...f.actor, id: user.id });
  const billing = f.app.database.owned("billing");
  const read = () =>
    f.app.billing.refunds.reviewOfflineFailedRefundInTransaction(
      finance,
      target,
    );
  const review = () => f.app.database.transaction(read);
  const observe = (
    refundId: string,
    status: "pending" | "requires_action" | "succeeded" | "failed" | "canceled",
  ) =>
    f.app.database.transaction(() => {
      const intent = f.app.billing.refunds.intent(f.actor, refundId);
      f.app.billing.refunds.observe(
        f.actor,
        intent,
        refundId === target ? "re_target" : "re_sibling",
        { ...intent, status },
      );
    });
  const acknowledge = (refundId: string, revision: number) =>
    f.app.billing.refunds.alerts.acknowledge(
      finance,
      `ack-${refundId}-${revision}`,
      { noticeId: refundId, revision },
    );
  const snapshot = () =>
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
    payment,
    manual,
    lineId,
    credits,
    target,
    sibling,
    manualRefund,
    billing,
    read,
    review,
    observe,
    acknowledge,
    snapshot,
  };
}
type Fixture = ReturnType<typeof setup>;
function rollback(f: Fixture, action: () => void) {
  const stop = Error("intentional boundary rollback");
  try {
    f.app.database.transaction(() => {
      action();
      throw stop;
    });
  } catch (error) {
    if (error !== stop) throw error;
  }
}
function rejectedMutation(
  f: Fixture,
  action: () => void,
  codes = ["OFFLINE_REFUND_REVIEW"],
) {
  const before = f.snapshot();
  rollback(f, () => {
    action();
    const damaged = f.snapshot();
    assert.throws(f.read, (e: any) => codes.includes(e.code));
    assert.equal(
      f.snapshot(),
      damaged,
      "reader must not repair retained corruption",
    );
  });
  assert.equal(f.snapshot(), before);
  f.review();
}

for (const [region, currency] of [
  ["CA", "USD"],
  ["CA", "CAD"],
  ["US", "USD"],
] as const)
  test(`boundary ${region}/${currency}: two credits, sibling reservations and complete native history conserve capacity`, (t) => {
    const f = setup(t, region, currency);
    f.observe(f.sibling, "succeeded");
    f.observe(f.sibling, "pending"); // Retained but ignored after success.
    f.observe(f.sibling, "failed"); // Native reversal releases this reservation.
    f.acknowledge(f.sibling, 1);
    f.observe(f.target, "requires_action");
    f.observe(f.target, "pending");
    f.acknowledge(f.target, 2);
    f.app.platform.isolateRestore("boundary-hold", new Date().toISOString());
    const before = f.snapshot(),
      r = f.review();
    assert.equal(r.region, region);
    assert.equal(r.currency, currency);
    assert.equal(r.intent.currency, currency.toLowerCase());
    assert.equal(r.credits.length, 2);
    assert.equal(r.refunds.length, 3);
    assert.equal(r.observations.length, 5);
    assert.deepEqual(
      r.observations
        .filter((o) => o.refund_id === f.sibling)
        .map((o) => o.applied),
      [1, 0, 1],
    );
    assert.equal(r.noticeUpdates.length, 3);
    assert.equal(r.noticeReads.length, 2);
    assert.deepEqual(r.capacity, {
      credited: 22600,
      paid: 22600,
      refunded: 2000,
      balance: -20600,
      pendingReservations: 5000,
      invoiceAvailable: 15600,
      originalPaymentReserved: 5000,
      originalPaymentAvailable: 15000,
    });
    const { factsHash, ...body } = r;
    assert.equal(factsHash, digest(canonical(body)));
    for (const flag of ["eligible", "allowed", "qualified", "importPermit"])
      assert(!Object.hasOwn(r, flag));
    assert.equal(f.snapshot(), before);
    assert.throws(() => f.app.platform.assertProviderAccess(), {
      code: "RECOVERY_HOLD",
    });
  });

test("boundary copied and malformed sibling history is rejected, not hidden by target scope", async (t) => {
  const f = setup(t);
  f.observe(f.target, "requires_action");
  f.observe(f.target, "pending");
  f.observe(f.target, "requires_action");
  f.acknowledge(f.target, 3);
  f.observe(f.sibling, "requires_action");
  f.acknowledge(f.sibling, 1);
  const attacks: [string, string, ...string[]][] = [
    [
      "missing sibling mapping",
      "DELETE FROM billing_refund_provider WHERE refund_id=?",
      f.sibling,
    ],
    [
      "copied foreign mapping",
      "UPDATE billing_refund_provider SET org_id='foreign' WHERE refund_id=?",
      f.sibling,
    ],
    [
      "unknown mapping status",
      "UPDATE billing_refund_provider SET status='made_up' WHERE refund_id=?",
      f.sibling,
    ],
    [
      "copied observation reference",
      "UPDATE billing_refund_observations SET external_ref='re_target' WHERE refund_id=?",
      f.sibling,
    ],
    [
      "copied observation scope",
      "UPDATE billing_refund_observations SET org_id='foreign' WHERE refund_id=?",
      f.sibling,
    ],
    [
      "malformed sibling observation",
      "UPDATE billing_refund_observations SET status='made_up' WHERE refund_id=?",
      f.sibling,
    ],
    [
      "backdated observation",
      "UPDATE billing_refund_observations SET created_at='2000-01-01T00:00:00.000Z' WHERE refund_id=?",
      f.sibling,
    ],
    [
      "missing first notice update",
      "DELETE FROM billing_refund_alert_updates WHERE refund_id=? AND revision=1",
      f.target,
    ],
    [
      "copied update scope",
      "UPDATE billing_refund_alert_updates SET org_id='foreign' WHERE refund_id=?",
      f.sibling,
    ],
    [
      "copied notice invoice",
      "UPDATE billing_refund_alerts SET invoice_id='foreign-invoice' WHERE refund_id=?",
      f.sibling,
    ],
    [
      "duplicate foreign notice",
      "INSERT INTO billing_refund_alerts(org_id,refund_id,invoice_id,status,state,revision,created_at,updated_at) SELECT 'foreign',refund_id,invoice_id,status,state,revision,created_at,updated_at FROM billing_refund_alerts WHERE refund_id=?",
      f.sibling,
    ],
    [
      "copied read scope",
      "UPDATE billing_refund_alert_reads SET org_id='foreign' WHERE refund_id=?",
      f.sibling,
    ],
    [
      "read copied from newer target revision",
      "UPDATE billing_refund_alert_reads SET revision=3 WHERE refund_id=?",
      f.sibling,
    ],
    [
      "acknowledgement predates update",
      "UPDATE billing_refund_alert_reads SET acknowledged_at='2000-01-01T00:00:00.000Z' WHERE refund_id=?",
      f.sibling,
    ],
    [
      "blank read actor",
      "UPDATE billing_refund_alert_reads SET actor_id=' ' WHERE refund_id=?",
      f.sibling,
    ],
    [
      "foreign proof on sibling Stripe refund",
      "UPDATE billing_refund_proofs SET refund_id=? WHERE refund_id=?",
      f.sibling,
      f.manualRefund,
    ],
  ];
  for (const [name, sql, ...params] of attacks)
    await t.test(name, () =>
      rejectedMutation(f, () => f.billing.run(sql, ...params)),
    );
});

test("boundary conservation checks every sibling payment, credit and reservation", async (t) => {
  const f = setup(t);
  await t.test("per-payment capacity despite adequate invoice credit", () =>
    rejectedMutation(f, () => {
      // Invoice has 20,600 available and 20,001 reservations. Stripe has only
      // 20,000 available: aggregate invoice capacity alone must not permit this.
      f.billing.run(
        "UPDATE billing_refunds SET amount=15001 WHERE id=?",
        f.sibling,
      );
    }),
  );
  await t.test("invoice capacity despite adequate original payment", () =>
    rejectedMutation(f, () => {
      f.billing.run(
        "DELETE FROM billing_credit_lines WHERE credit_id=?",
        f.credits[1]!.id,
      );
      f.billing.run("DELETE FROM billing_credits WHERE id=?", f.credits[1]!.id);
      f.billing.run(
        "UPDATE billing_refunds SET amount=10000 WHERE id=?",
        f.sibling,
      );
    }),
  );
  await t.test(
    "individually reconciled credits cannot duplicate original units",
    () =>
      rejectedMutation(f, () => {
        f.billing.run(
          "UPDATE billing_credit_lines SET quantity=2 WHERE credit_id=?",
          f.credits[1]!.id,
        );
        f.billing.run(
          "UPDATE billing_credits SET net=20000,tax=2600,total=22600 WHERE id=?",
          f.credits[1]!.id,
        );
      }),
  );
  await t.test(
    "credit moved to another invoice remains connected through original line",
    () =>
      rejectedMutation(f, () => {
        f.billing.run(
          "UPDATE billing_credits SET invoice_id='foreign' WHERE id=?",
          f.credits[1]!.id,
        );
      }),
  );
  await t.test(
    "refund moved to another invoice remains connected through original payment",
    () =>
      rejectedMutation(f, () => {
        f.billing.run(
          "UPDATE billing_refunds SET invoice_id='foreign' WHERE id=?",
          f.sibling,
        );
      }),
  );
  await t.test(
    "foreign sibling payment is not excluded by organization filter",
    () =>
      rejectedMutation(f, () => {
        f.billing.run(
          "UPDATE billing_payments SET org_id='foreign' WHERE id=?",
          f.manual.id,
        );
      }),
  );
});

test("boundary same-writer current IAM changes refuse and rollback without altering native facts", async (t) => {
  const f = setup(t),
    iam = f.app.database.owned("iam"),
    prior = f.review();
  const attacks: [string, string][] = [
    ["revoked", "UPDATE iam_users SET active=0 WHERE id=?"],
    ["finance removed", "UPDATE iam_users SET role='support' WHERE id=?"],
    ["tenant moved", "UPDATE iam_users SET org_id='foreign' WHERE id=?"],
    [
      "password change",
      "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
    ],
  ];
  for (const [name, sql] of attacks)
    await t.test(name, () => {
      rejectedMutation(f, () => iam.run(sql, f.finance.id), [
        "FORBIDDEN",
        "PASSWORD_CHANGE_REQUIRED",
      ]);
      assert.deepEqual(f.review(), prior);
    });
  assert.throws(f.read, { code: "TRANSACTION" });
});

test("boundary every returned object is frozen and facts reflect only current same-writer retained state", (t) => {
  const f = setup(t);
  f.observe(f.target, "requires_action");
  f.acknowledge(f.target, 1);
  const prior = f.review();
  const frozen = (value: unknown): void => {
    if (value && typeof value === "object") {
      assert(Object.isFrozen(value));
      Object.values(value).forEach(frozen);
    }
  };
  frozen(prior);
  rollback(f, () => {
    f.billing.run(
      "UPDATE billing_refunds SET reference='same-writer-new-reference' WHERE id=?",
      f.sibling,
    );
    const current = f.read();
    assert.notEqual(current.factsHash, prior.factsHash);
    assert.equal(
      current.refunds.find((r) => r.id === f.sibling)!.reference,
      "same-writer-new-reference",
    );
    assert.equal(
      prior.refunds.find((r) => r.id === f.sibling)!.reference,
      "sibling",
    );
    assert.notStrictEqual(current.refunds[0], prior.refunds[0]);
    assert.throws(
      () => Object.assign(current.capacity, { pendingReservations: 0 }),
      TypeError,
    );
    frozen(current);
  });
  assert.deepEqual(f.review(), prior);
});

// Call-through instrumentation observes the real canonical serializer: native
// queries/rows and the thrown production error are never replaced. The marker
// is synthetic and metrics are numbers only. Tests run synchronously here.
function serializedMarkerBytes(
  t: TestContext,
  read: () => unknown,
  marker: string,
) {
  const stringify = JSON.stringify;
  let encoded = 0;
  const spy = t.mock.method(JSON, "stringify", ((
    value: unknown,
    ...args: unknown[]
  ) => {
    if (typeof value === "string" && value.startsWith(marker))
      encoded += Buffer.byteLength(value);
    return Reflect.apply(stringify, JSON, [value, ...args]);
  }) as typeof JSON.stringify);
  try {
    assert.throws(read, { code: "OFFLINE_REFUND_REVIEW_LIMIT" });
  } finally {
    spy.mock.restore();
  }
  t.diagnostic(
    `synthetic marker UTF-8 bytes passed to JSON.stringify before refusal: ${encoded}`,
  );
  return encoded;
}

test("boundary row-count overflow refuses before serializing any observation of the rejected set", (t) => {
  const f = setup(t);
  f.observe(f.target, "pending");
  f.app.database.transaction(() => {
    const first = f.billing.get<{ id: number }>(
      "SELECT MIN(id) AS id FROM billing_refund_observations",
    )!.id;
    for (let n = 0; n < offlineRefundReviewLimits.rowsPerSet; n++)
      f.billing.run(
        `INSERT INTO billing_refund_observations(org_id,refund_id,external_ref,status,applied,created_at)
        SELECT org_id,refund_id,external_ref,status,applied,created_at
        FROM billing_refund_observations WHERE id=?`,
        first,
      );
  });
  assert.equal(
    f.billing.get("SELECT COUNT(*) AS n FROM billing_refund_observations")!.n,
    1001,
  );
  // Mapping is serialized once before the oversized observation set is reached.
  assert.equal(
    serializedMarkerBytes(t, f.review, "re_target"),
    Buffer.byteLength("re_target"),
  );
});

for (const field of ["description", "reference"] as const)
  test(`boundary RED UTF-8 oversized ${field} is refused before JSON materialization`, (t) => {
    const f = setup(t),
      marker = `BOUNDARY-${field}-`;
    const value =
      marker + "界".repeat(Math.ceil(offlineRefundReviewLimits.bytes / 3));
    assert(value.length < offlineRefundReviewLimits.bytes);
    assert(Buffer.byteLength(value) > offlineRefundReviewLimits.bytes);
    rollback(f, () => {
      if (field === "description")
        f.billing.run(
          "UPDATE billing_lines SET description=? WHERE id=?",
          value,
          f.lineId,
        );
      else
        f.billing.run(
          "UPDATE billing_refunds SET reference=? WHERE id=?",
          value,
          f.target,
        );
      const encoded = serializedMarkerBytes(t, f.read, marker);
      assert.equal(
        encoded,
        0,
        "oversized native row must be rejected before canonical JSON allocates its text",
      );
    });
  });

test("boundary RED aggregate UTF-8 overflow of individually bounded rows is refused before JSON materialization", (t) => {
  const f = setup(t),
    marker = "BOUNDARY-AGGREGATE-",
    value = marker + "界".repeat(1800);
  assert(value.length < 2000);
  const count = 220;
  assert(Buffer.byteLength(value) * count > offlineRefundReviewLimits.bytes);
  rollback(f, () => {
    f.billing.run(
      `WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<?)
      INSERT INTO billing_lines SELECT 'boundary-line-'||x,org_id,invoice_id,'boundary-product-'||x,?,1,0,0
      FROM n,(SELECT * FROM billing_lines WHERE id=?)`,
      count,
      value,
      f.lineId,
    );
    assert.equal(
      f.billing.get(
        "SELECT COUNT(*) AS n FROM billing_lines WHERE invoice_id=?",
        f.invoiceId,
      )!.n,
      count + 1,
    );
    const encoded = serializedMarkerBytes(t, f.read, marker);
    assert.equal(
      encoded,
      0,
      "oversized complete set must be bounded before canonical JSON allocates all retained text",
    );
  });
});

test("boundary real uncommitted observation and notice writes are visible, then rolled back together", (t) => {
  const f = setup(t);
  f.observe(f.target, "requires_action");
  f.acknowledge(f.target, 1);
  const prior = f.review(),
    before = f.snapshot();
  rollback(f, () => {
    const intent = f.app.billing.refunds.intent(f.actor, f.target);
    f.app.billing.refunds.observe(f.actor, intent, "re_target", {
      ...intent,
      status: "pending",
    });
    const current = f.read();
    assert.equal(current.observations.length, 2);
    assert.equal(current.noticeUpdates.length, 2);
    assert.equal(current.providerMappings[0]!.status, "pending");
    assert.equal(current.notices[0]!.revision, 2);
    assert.equal(current.noticeReads[0]!.revision, 1);
    assert.equal(prior.observations.length, 1);
    assert.notEqual(current.factsHash, prior.factsHash);
    assert.deepEqual(current.capacity, prior.capacity);
    // Fresh authority must be checked even after a valid read in this writer.
    f.app.database
      .owned("iam")
      .run("UPDATE iam_users SET active=0 WHERE id=?", f.finance.id);
    assert.throws(f.read, { code: "FORBIDDEN" });
  });
  assert.equal(f.snapshot(), before);
  assert.deepEqual(f.review(), prior);
});

test("boundary complete acknowledgement count refuses overflow before serializing the rejected set", (t) => {
  const f = setup(t),
    marker = "synthetic-extra-reader-";
  f.observe(f.target, "requires_action");
  f.acknowledge(f.target, 1);
  // Deliberately copied retained rows exercise a count bound, not proof that
  // these synthetic actor IDs authenticated. No such historical IAM claim is
  // part of this Billing-only reader's contract.
  f.app.database.transaction(() => {
    for (let i = 0; i < offlineRefundReviewLimits.rowsPerSet; i++)
      f.billing.run(
        `INSERT INTO billing_refund_alert_reads
        SELECT org_id,refund_id,?,revision,acknowledged_at FROM billing_refund_alert_reads
        WHERE refund_id=? AND actor_id=?`,
        marker + i,
        f.target,
        f.finance.id,
      );
  });
  assert.equal(
    f.billing.get("SELECT COUNT(*) AS n FROM billing_refund_alert_reads")!.n,
    1001,
  );
  const before = f.snapshot();
  assert.equal(serializedMarkerBytes(t, f.review, marker), 0);
  assert.equal(f.snapshot(), before);
});

// Call through the actual Database boundary: record only matching retained text
// returned by SQLite to JavaScript. Neither queries nor results are replaced.
function assertNoRetainedMarker(
  t: TestContext,
  f: Fixture,
  marker: string,
  code = "OFFLINE_REFUND_REVIEW_LIMIT",
) {
  const execute = f.app.database.execute.bind(f.app.database);
  let materialized = 0;
  const inspect = (value: unknown): void => {
    if (typeof value === "string" && value.includes(marker))
      materialized += Buffer.byteLength(value);
    else if (value && typeof value === "object")
      Object.values(value).forEach(inspect);
  };
  const spy = t.mock.method(
    f.app.database,
    "execute",
    (
      owner: Parameters<typeof execute>[0],
      fn: Parameters<typeof execute>[1],
    ) => {
      const value = execute(owner, fn);
      if (owner === "billing") inspect(value);
      return value;
    },
  );
  try {
    assert.throws(f.read, { code });
  } finally {
    spy.mock.restore();
  }
  assert.equal(
    materialized,
    0,
    "oversized retained text must not leave SQLite before refusal",
  );
}

test("repair preflights every returned Billing collection and early target scalar before fetching text", async (t) => {
  const f = setup(t),
    marker = "BILLING-PREFLIGHT-",
    value = marker + "界".repeat(350000);
  f.observe(f.target, "requires_action");
  f.acknowledge(f.target, 1);
  const attacks: [string, string, string][] = [
    [
      "target refund reference",
      "UPDATE billing_refunds SET reference=? WHERE id=?",
      f.target,
    ],
    [
      "target payment identity",
      "UPDATE billing_refunds SET payment_id=? WHERE id=?",
      f.target,
    ],
    [
      "invoice account identity",
      "UPDATE billing_invoices SET account_id=? WHERE id=?",
      f.invoiceId,
    ],
    [
      "invoice number",
      "UPDATE billing_invoices SET number=? WHERE id=?",
      f.invoiceId,
    ],
    [
      "invoice currency",
      "UPDATE billing_invoices SET currency=? WHERE id=?",
      f.invoiceId,
    ],
    [
      "original payment reference",
      "UPDATE billing_payments SET external_ref=? WHERE id=?",
      f.payment.id,
    ],
    [
      "invoice line description",
      "UPDATE billing_lines SET description=? WHERE id=?",
      f.lineId,
    ],
    [
      "credit reason",
      "UPDATE billing_credits SET reason=? WHERE id=?",
      f.credits[0]!.id,
    ],
    [
      "credit line identity",
      "UPDATE billing_credit_lines SET invoice_line_id=? WHERE credit_id=?",
      f.credits[0]!.id,
    ],
    [
      "sibling payment reference",
      "UPDATE billing_payments SET external_ref=? WHERE id=?",
      f.manual.id,
    ],
    [
      "sibling refund reference",
      "UPDATE billing_refunds SET reference=? WHERE id=?",
      f.sibling,
    ],
    [
      "provider mapping",
      "UPDATE billing_refund_provider SET status=? WHERE refund_id=?",
      f.target,
    ],
    [
      "observation",
      "UPDATE billing_refund_observations SET external_ref=? WHERE refund_id=?",
      f.target,
    ],
    [
      "manual proof",
      "UPDATE billing_refund_proofs SET external_ref=? WHERE refund_id=?",
      f.manualRefund,
    ],
    [
      "notice",
      "UPDATE billing_refund_alerts SET invoice_id=? WHERE refund_id=?",
      f.target,
    ],
    [
      "notice update",
      "UPDATE billing_refund_alert_updates SET status=? WHERE refund_id=?",
      f.target,
    ],
    [
      "notice read",
      "UPDATE billing_refund_alert_reads SET actor_id=? WHERE refund_id=?",
      f.target,
    ],
  ];
  const before = f.snapshot();
  for (const [name, sql, id] of attacks)
    await t.test(name, (sub) => {
      rollback(f, () => {
        f.billing.run(sql, value, id);
        assertNoRetainedMarker(sub, f, marker);
      });
      assert.equal(f.snapshot(), before);
      f.review();
    });
});

test("repair combined scalar bytes refuse before native get or intent materializes any target text", (t) => {
  const f = setup(t),
    marker = "BILLING-SCALARS-",
    value = marker + "界".repeat(180000);
  assert(Buffer.byteLength(value) < offlineRefundReviewLimits.bytes);
  assert(Buffer.byteLength(value) * 2 > offlineRefundReviewLimits.bytes);
  rollback(f, () => {
    f.billing.run(
      "UPDATE billing_refunds SET reference=? WHERE id=?",
      value,
      f.target,
    );
    f.billing.run(
      "UPDATE billing_invoices SET number=? WHERE id=?",
      value,
      f.invoiceId,
    );
    assertNoRetainedMarker(t, f, marker);
  });
});

test("repair collection bytes are cumulative across sets before the overflowing set is fetched", (t) => {
  const f = setup(t),
    marker = "BILLING-LATE-SET-",
    late = marker + "界".repeat(180000);
  rollback(f, () => {
    for (let i = 0; i < 110; i++)
      f.billing.run(
        `INSERT INTO billing_lines
        SELECT ?,org_id,invoice_id,?, ?,1,0,0 FROM billing_lines WHERE id=?`,
        `budget-line-${i}`,
        `budget-product-${i}`,
        "界".repeat(1800),
        f.lineId,
      );
    f.billing.run(
      "UPDATE billing_refund_proofs SET external_ref=? WHERE refund_id=?",
      late,
      f.manualRefund,
    );
    assert(Buffer.byteLength(late) < offlineRefundReviewLimits.bytes);
    assert(
      110 * 1800 * 3 + Buffer.byteLength(late) >
        offlineRefundReviewLimits.bytes,
    );
    assertNoRetainedMarker(t, f, marker);
  });
});

test("repair UTF-8 SQL byte preflight includes retained text after embedded NUL", (t) => {
  const f = setup(t),
    marker = "BILLING-NUL-";
  rollback(f, () => {
    f.billing.run(
      "UPDATE billing_lines SET description=? WHERE id=?",
      marker + "\0" + "界".repeat(350000),
      f.lineId,
    );
    assertNoRetainedMarker(t, f, marker);
  });
});

test("repair unsupported opening snapshot refuses without fetching its retained strings", (t) => {
  const f = setup(t),
    marker = "BILLING-OPENING-";
  rollback(f, () => {
    f.billing.run(
      `INSERT INTO billing_opening_documents VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      f.invoiceId,
      f.actor.orgId,
      marker + "界".repeat(350000),
      "synthetic-source-id",
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
    assertNoRetainedMarker(t, f, marker, "OFFLINE_REFUND_REVIEW");
  });
});
