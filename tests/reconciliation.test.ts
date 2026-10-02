import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { fixture, accept, ship } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import { digest } from "../src/server/core.ts";
import type { Actor } from "../src/server/core.ts";

function paidCredit(f: ReturnType<typeof fixture>) {
  const invoiceId = ship(f, accept(f).id).invoiceId;
  const payment = f.app.billing.manualPayment(f.actor, "payment", {
    invoiceId,
    amount: 11300,
    reference: "PRIVATE-PAYMENT",
    reason: "PRIVATE-REASON",
  });
  f.app.billing.issueCredit(f.actor, "credit", {
    invoiceId,
    reference: "PRIVATE-CREDIT",
    reason: "PRIVATE-REASON",
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
    amount: 11300,
    reference: "PRIVATE-REFUND",
    reason: "PRIVATE-REASON",
  });
  return { invoiceId, paymentId: payment.id, refundId: refund.id };
}
function codes(issues: { items: { code: string }[] }) {
  return issues.items.map((i) => i.code);
}
test("reconciliation: transit and quarantine receipt conserve original-cost movement controls", (t) => {
  const f = fixture(t),
    u = f.app.inventory.trace(f.actor, "S3").unit;
  const transfer = f.app.inventory.dispatchTransfer(f.actor, "transfer", {
    unitId: u.id,
    quantity: 1,
    revision: u.revision,
    destinationId: f.w2,
    reason: "Synthetic transfer",
  });
  assert.equal(f.app.reconciliation(f.actor).stock.quantity, "3");
  assert.equal(f.app.reconciliation(f.actor).stock.issues.count, 0);
  f.app.inventory.receiveTransfer(f.actor, "receive-transfer", {
    transferId: transfer.id,
    lineId: transfer.lineId,
    quantity: 1,
    serial: "S3",
    receiptRef: "TRANSIT-1",
    bin: "Q-1",
    condition: "quarantine",
    reason: "Synthetic custody",
  });
  const received = f.app.reconciliation(f.actor);
  assert.equal(received.stock.quantity, "3");
  assert.equal(received.stock.value, "18000");
  assert.equal(received.stock.issues.count, 0);
});

test("reconciliation: foreign organization records are excluded and same-total product drift is detected", (t) => {
  const f = fixture(t),
    store = f.app.database.owned("inventory");
  const units = store.all<{ id: string }>(
    "SELECT id FROM inventory_units WHERE org_id=? ORDER BY rowid",
    f.actor.orgId,
  );
  store.run(
    "UPDATE inventory_units SET product_id='synthetic-other-product' WHERE id=?",
    units[0]!.id,
  );
  // Movement attribution follows the retained unit product, so alter only its ledger quantity.
  store.run(
    "UPDATE inventory_movements SET quantity=quantity+1 WHERE unit_id=?",
    units[0]!.id,
  );
  store.run(
    "UPDATE inventory_movements SET quantity=quantity-1 WHERE unit_id=?",
    units[1]!.id,
  );
  store.run(
    "INSERT INTO inventory_units VALUES('foreign-unit','foreign-org','foreign-product','foreign-site','PRIVATE-BIN','PRIVATE-SERIAL',99,99,'usable','stock',1)",
  );
  f.app.database
    .owned("billing")
    .run(
      "INSERT INTO billing_payments VALUES('foreign-payment','foreign-org','foreign-invoice','manual','PRIVATE-TOKEN',999,'2026-10-02T00:00:00.000Z')",
    );
  const r = f.app.reconciliation(f.actor);
  assert.equal(r.stock.quantity, "3");
  assert.equal(r.stock.movementQuantity, "3");
  assert.equal(r.stock.units, 3);
  assert.equal(r.billing.payments, 0);
  assert.equal(r.billing.issues.count, 0);
  assert.equal(
    r.stock.issues.items.filter((i) => i.code === "PRODUCT_QUANTITY").length,
    2,
  );
  assert(!JSON.stringify(r).includes("foreign"));
});

test("reconciliation: rejected refunds release capacity and malformed links cannot appear healthy", (t) => {
  const f = fixture(t),
    sale = paidCredit(f),
    store = f.app.database.owned("billing");
  store.run(
    "UPDATE billing_refunds SET state='rejected' WHERE id=?",
    sale.refundId,
  );
  assert.equal(f.app.reconciliation(f.actor).billing.issues.count, 0);
  assert.equal(f.app.reconciliation(f.actor).billing.pendingRefunds, "0");
  store.run("UPDATE billing_credit_lines SET invoice_line_id='missing'");
  store.run(
    "UPDATE billing_refunds SET payment_id='missing' WHERE id=?",
    sale.refundId,
  );
  const r = f.app.reconciliation(f.actor);
  for (const code of [
    "CREDIT_LINE_ORIGIN",
    "MISSING_CREDIT_LINES",
    "CREDIT_NET",
    "CREDIT_TAX",
    "REFUND_ORIGIN",
  ])
    assert(codes(r.billing.issues).includes(code), code);
});
function dump(db: DatabaseSync) {
  return db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((r) => ({
      name: r.name,
      rows: db.prepare(`SELECT * FROM "${r.name}" ORDER BY rowid`).all(),
    }));
}
for (const region of ["CA", "US"] as const)
  test(`reconciliation: ${region} native stock, credits, pending/completed refunds and restart conserve exact controls without writes`, (t) => {
    const f = fixture(t, {}, region);
    const initial = f.app.reconciliation(f.actor);
    assert.equal(initial.currency, region === "CA" ? "CAD" : "USD");
    assert.equal(initial.stock.quantity, "3");
    assert.equal(initial.stock.value, "18000");
    assert.equal(initial.stock.issues.count, 0);
    assert.equal(initial.billing.invoices, 0);
    const sale = paidCredit(f);
    const db = new DatabaseSync(f.path);
    try {
      const before = dump(db),
        r = f.app.reconciliation(f.actor);
      assert.deepEqual(dump(db), before);
      assert.equal(r.stock.quantity, "2");
      assert.equal(r.stock.value, "12000");
      assert.equal(r.stock.issues.count, 0);
      assert.deepEqual(r.billing, {
        invoices: 1,
        credits: 1,
        payments: 1,
        refunds: 1,
        total: "11300",
        credited: "11300",
        paid: "11300",
        refunded: "0",
        balance: "-11300",
        pendingRefunds: "11300",
        uncertainRefunds: "0",
        issues: { count: 0, items: [], truncated: false },
      });
      assert(!JSON.stringify(r).includes("PRIVATE-"));
      f.app.billing.manualRefund(f.actor, "verify", {
        refundId: sale.refundId,
        reference: "PRIVATE-PROOF",
        reason: "PRIVATE-REASON",
      });
      const completed = f.app.reconciliation(f.actor);
      assert.equal(completed.billing.refunded, "11300");
      assert.equal(completed.billing.balance, "0");
      assert.equal(completed.billing.pendingRefunds, "0");
      assert.equal(completed.billing.issues.count, 0);
      f.app.close();
      f.app = new Application(f.path, region);
      const restarted = f.app.reconciliation(f.actor);
      assert.deepEqual(restarted.billing, completed.billing);
      assert.deepEqual(restarted.stock, completed.stock);
    } finally {
      db.close();
    }
  });

test("reconciliation: historical opening credits/payments/refunds are independent from new native documents", (t) => {
  const f = fixture(t),
    cutoff = new Date().toISOString();
  const input = {
    sourceId: "opening",
    accountId: f.buyer,
    number: "OPEN-1",
    issuedAt: "2026-01-01T00:00:00.000Z",
    dueAt: "2026-02-01T00:00:00.000Z",
    net: 20000,
    tax: 2600,
    total: 22600,
    credited: 11300,
    paid: 5000,
    refunded: 1000,
    balance: 7300,
    lines: [
      {
        productId: f.product,
        description: "PRIVATE-DESCRIPTION",
        quantity: 2,
        unitPrice: 10000,
        unitTax: 1300,
        creditedQuantity: 1,
      },
    ],
  };
  const review = f.app.billing.opening.review(f.actor, input, cutoff);
  f.app.database.transaction(() =>
    f.app.billing.opening.apply(f.actor, review, {
      sourceRef: "PRIVATE-SOURCE",
      sourceHash: digest("opening"),
      cutoffAt: cutoff,
      batchId: "opening",
    }),
  );
  const r = f.app.reconciliation(f.actor);
  assert.equal(r.billing.total, "22600");
  assert.equal(r.billing.credited, "11300");
  assert.equal(r.billing.paid, "5000");
  assert.equal(r.billing.refunded, "1000");
  assert.equal(r.billing.balance, "7300");
  assert.equal(r.billing.issues.count, 0);
  assert.equal(r.stock.quantity, "3");
  assert(!JSON.stringify(r).includes("PRIVATE-"));
});

test("reconciliation: completed refunds cannot exceed invoice credited cash even when payment capacity remains", (t) => {
  const f = fixture(t),
    invoiceId = ship(f, accept(f).id).invoiceId;
  const payment = f.app.billing.manualPayment(f.actor, "payment", {
    invoiceId,
    amount: 11300,
    reference: "PRIVATE-PAYMENT",
    reason: "Synthetic payment",
  });
  const store = f.app.database.owned("billing");
  store.run(
    "INSERT INTO billing_refunds VALUES(?,?,?,?,?,?,?,?)",
    "invalid-refund",
    f.actor.orgId,
    invoiceId,
    payment.id,
    1000,
    "PRIVATE-REFUND",
    "completed",
    new Date().toISOString(),
  );
  const result = f.app.reconciliation(f.actor).billing;
  assert.deepEqual(result.issues.items, [
    {
      code: "INVOICE_COMPLETED_REFUND_CAPACITY",
      recordId: invoiceId,
      expected: "0",
      actual: "1000",
    },
  ]);
  assert.equal(result.refunded, "1000");
  assert.equal(result.balance, "1000");
});

test("reconciliation: per-product drift, missing sequences and invalid movement evidence remain visible", (t) => {
  const f = fixture(t),
    store = f.app.database.owned("inventory");
  const unit = f.app.inventory.trace(f.actor, "S1").unit;
  store.run(
    "UPDATE inventory_units SET quantity=2,cost=7000 WHERE id=?",
    unit.id,
  );
  store.run(
    "DELETE FROM inventory_cost_sequences WHERE movement_id IN (SELECT id FROM inventory_movements WHERE unit_id=?)",
    unit.id,
  );
  store.run(
    "UPDATE inventory_movements SET type='invented',created_at='invalid' WHERE unit_id=?",
    unit.id,
  );
  const r = f.app.reconciliation(f.actor);
  for (const code of [
    "PRODUCT_QUANTITY",
    "PRODUCT_VALUE",
    "MISSING_MOVEMENT_SEQUENCE",
    "UNSUPPORTED_MOVEMENT",
    "MOVEMENT_TIMESTAMP",
  ])
    assert(codes(r.stock.issues).includes(code), code);
  assert.equal(r.stock.quantity, "4");
  assert.equal(r.stock.value, "26000");
});

test("reconciliation: billing detects line arithmetic, refund capacity and currency drift without FX", (t) => {
  const f = fixture(t),
    sale = paidCredit(f),
    store = f.app.database.owned("billing");
  store.run(
    "UPDATE billing_lines SET quantity=2 WHERE invoice_id=?",
    sale.invoiceId,
  );
  store.run(
    "UPDATE billing_refunds SET amount=12000,state='unknown' WHERE id=?",
    sale.refundId,
  );
  let r = f.app.reconciliation(f.actor);
  for (const code of [
    "INVOICE_NET",
    "INVOICE_TAX",
    "PAYMENT_REFUND_CAPACITY",
    "INVOICE_REFUND_CAPACITY",
  ])
    assert(codes(r.billing.issues).includes(code), code);
  assert.equal(r.billing.uncertainRefunds, "12000");
  store.run(
    "UPDATE billing_invoices SET currency='USD' WHERE id=?",
    sale.invoiceId,
  );
  r = f.app.reconciliation(f.actor);
  assert(codes(r.billing.issues).includes("INVOICE_CURRENCY"));
  for (const field of [
    "total",
    "credited",
    "paid",
    "refunded",
    "balance",
    "pendingRefunds",
    "uncertainRefunds",
  ] as const)
    assert.equal(r.billing[field], "0");
});

test("reconciliation: exact integer arithmetic and bounded details survive oversized retained facts", (t) => {
  const f = fixture(t),
    stock = f.app.database.owned("inventory");
  stock.run(
    "UPDATE inventory_units SET quantity=9007199254740993,cost=9007199254740993",
  );
  const r = f.app.reconciliation(f.actor);
  assert.equal(r.stock.quantity, String(3n * 9007199254740993n));
  assert.equal(r.stock.value, String(3n * 9007199254740993n ** 2n));
  assert(codes(r.stock.issues).includes("UNSAFE_STOCK_INTEGER"));
  const bill = f.app.database.owned("billing");
  for (let i = 0; i < 125; i++)
    bill.run(
      "INSERT INTO billing_payments VALUES(?,?,?,?,?,?,?)",
      `orphan-${i}`,
      f.actor.orgId,
      "missing",
      "manual",
      `PRIVATE-${i}`,
      1,
      new Date().toISOString(),
    );
  const issues = f.app.reconciliation(f.actor).billing.issues;
  assert.equal(issues.count, 125);
  assert.equal(issues.items.length, 100);
  assert.equal(issues.truncated, true);
  assert.equal(issues.items[99]!.recordId, "orphan-99");
});

test("reconciliation: fresh persisted authority and forced password change precede reads", (t) => {
  const f = fixture(t),
    iam = f.app.database.owned("iam");
  for (const role of [
    "buyer",
    "warehouse",
    "support",
    "commercial",
    "warranty",
  ]) {
    iam.run("UPDATE iam_users SET role=? WHERE id=?", role, f.actor.id);
    assert.throws(() => f.app.reconciliation(f.actor), { code: "FORBIDDEN" });
  }
  iam.run("UPDATE iam_users SET role='finance' WHERE id=?", f.actor.id);
  assert.equal(f.app.reconciliation(f.actor).stock.quantity, "3");
  iam.run(
    "INSERT INTO iam_user_security VALUES(?,1,1,'2026-10-02T00:00:00.000Z') ON CONFLICT(user_id) DO UPDATE SET password_change_required=1",
    f.actor.id,
  );
  assert.throws(() => f.app.reconciliation(f.actor), {
    code: "PASSWORD_CHANGE_REQUIRED",
  });
  iam.run("UPDATE iam_users SET active=0 WHERE id=?", f.actor.id);
  assert.throws(() => f.app.reconciliation(f.actor), { code: "FORBIDDEN" });
  assert.throws(() => f.app.reconciliation({ ...f.actor, orgId: "foreign" }), {
    code: "FORBIDDEN",
  });
});

test("reconciliation: one snapshot fences a competing writer between stock and money reads, and failed reads release it", (t) => {
  const f = fixture(t),
    competing = new DatabaseSync(f.path, { timeout: 1 });
  const original = f.app.inventory.controlTotals.bind(f.app.inventory);
  let attempts = 0;
  t.mock.method(f.app.inventory, "controlTotals", (actor: Actor) => {
    const result = original(actor);
    attempts++;
    assert.throws(
      () => competing.prepare("UPDATE inventory_units SET cost=cost+1").run(),
      /locked/,
    );
    return result;
  });
  try {
    assert.equal(f.app.reconciliation(f.actor).stock.value, "18000");
    assert.equal(attempts, 1);
    t.mock.method(f.app.billing, "controlTotals", () => {
      throw new Error("synthetic read failure");
    });
    assert.throws(
      () => f.app.reconciliation(f.actor),
      /synthetic read failure/,
    );
    assert.equal(
      competing.prepare("UPDATE inventory_units SET cost=cost+1").run().changes,
      3,
    );
  } finally {
    competing.close();
  }
});

test("reconciliation: HTTP authentication, no-cache, no credentials and revoked role refusal", async (t) => {
  const f = fixture(t),
    origin = "http://127.0.0.1:3000",
    http = await createHttp(f.app, { origin, staticRoot: "/nonexistent" });
  t.after(() => http.close());
  assert.equal(
    (await http.inject({ url: "/api/operations/reconciliation" })).statusCode,
    401,
  );
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: {
      email: "admin@example.test",
      password: "long-test-only-password",
    },
  });
  const cookie = login.cookies[0]!,
    headers = { cookie: `${cookie.name}=${cookie.value}` };
  const response = await http.inject({
    url: "/api/operations/reconciliation",
    headers,
  });
  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers["cache-control"]), /no-store/);
  assert.equal(response.json().stock.quantity, "3");
  assert(!response.body.includes("password"));
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='warehouse' WHERE id=?", f.actor.id);
  assert.equal(
    (await http.inject({ url: "/api/operations/reconciliation", headers }))
      .statusCode,
    403,
  );
});
