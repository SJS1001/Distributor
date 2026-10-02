import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, accept, ship } from "./fixtures.ts";
import type { Actor, Role } from "../src/server/core.ts";
import type { Owner } from "../src/server/database.ts";
import { Application } from "../src/server/application.ts";

function user(f: ReturnType<typeof fixture>, role: Role) {
  const result = f.app.identity.createUser(f.actor, `billing-${role}`, {
    name: role,
    email: `billing-${role}@example.test`,
    password: "long-billing-test-password",
    role,
    sites: role === "buyer" ? [] : [f.w1],
    ...(role === "buyer" ? { accountId: f.buyer } : {}),
  });
  return f.app.identity.currentActor({ ...f.actor, id: result.id });
}
function change(
  f: ReturnType<typeof fixture>,
  actor: Actor,
  updates: Record<string, unknown>,
) {
  const row = f.app.identity.users(f.actor).find((u) => u.id === actor.id)!;
  f.app.identity.updateUser(
    f.actor,
    `billing-grant-${actor.id}-${row.revision}`,
    {
      userId: actor.id,
      revision: row.revision,
      name: actor.name,
      email: row.email,
      role: actor.role,
      sites: actor.sites,
      ...(actor.accountId ? { accountId: actor.accountId } : {}),
      active: true,
      currentPassword: "long-test-only-password",
      reason: "Synthetic billing authority change",
      ...updates,
    },
  );
}
function facts(f: ReturnType<typeof fixture>) {
  const owners: [Owner, string[]][] = [
    [
      "billing",
      [
        "holds",
        "counters",
        "invoices",
        "lines",
        "credits",
        "credit_lines",
        "payments",
        "refunds",
        "refund_proofs",
        "document_facts",
      ],
    ],
    ["orders", ["orders", "lines"]],
    ["inventory", ["units", "allocations", "movements"]],
    ["platform", ["commands", "audit", "audit_order", "audit_clock", "events"]],
  ];
  return owners.flatMap(([owner, tables]) =>
    tables.map((table) =>
      f.app.database
        .owned(owner)
        .all(`SELECT * FROM ${owner}_${table} ORDER BY rowid`),
    ),
  );
}
function denied(operations: (() => unknown)[], code = "FORBIDDEN") {
  for (const operation of operations) assert.throws(operation, { code });
}
function prepared(f: ReturnType<typeof fixture>, actor: Actor) {
  const order = accept(f),
    shipment = ship(f, order.id),
    invoiceId = shipment.invoiceId;
  const line = f.app.billing.lines(f.actor, invoiceId)[0]!;
  const paymentInput = {
    invoiceId,
    amount: 11300,
    reference: "PAY-AUTHORITY",
    reason: "Synthetic bank receipt",
  };
  const payment = f.app.billing.manualPayment(
    actor,
    "authority-payment",
    paymentInput,
  );
  const creditInput = {
    invoiceId,
    reference: "CR-AUTHORITY",
    reason: "Synthetic approved credit",
    lines: [{ lineId: line.id, quantity: 1 }],
  };
  const credit = f.app.billing.issueCredit(
    actor,
    "authority-credit",
    creditInput,
  );
  const refundInput = {
    invoiceId,
    paymentId: payment.id,
    amount: 11300,
    reference: "REF-AUTHORITY",
    reason: "Synthetic refund request",
  };
  const refund = f.app.billing.refundRequest(
    actor,
    "authority-refund",
    refundInput,
  );
  const proofInput = {
    refundId: refund.id,
    reference: "BANK-REF-AUTHORITY",
    reason: "Synthetic bank refund proof",
  };
  const proof = f.app.billing.manualRefund(
    actor,
    "authority-proof",
    proofInput,
  );
  return {
    orderId: order.id,
    shipmentId: shipment.id,
    invoiceId,
    lineId: line.id,
    credit,
    payment,
    refund,
    proof,
    replay: (current: Actor, prefix = "authority") => [
      () =>
        f.app.billing.manualPayment(current, `${prefix}-payment`, paymentInput),
      () => f.app.billing.issueCredit(current, `${prefix}-credit`, creditInput),
      () =>
        f.app.billing.refundRequest(current, `${prefix}-refund`, refundInput),
      () => f.app.billing.manualRefund(current, `${prefix}-proof`, proofInput),
    ],
  };
}
function reads(
  f: ReturnType<typeof fixture>,
  actor: Actor,
  p: ReturnType<typeof prepared>,
) {
  return [
    () => f.app.billing.invoice(actor, p.invoiceId),
    () => f.app.billing.lines(actor, p.invoiceId),
    () => f.app.billing.totals(actor, p.invoiceId),
    () => f.app.billing.invoices(actor),
    () => f.app.billing.credits(actor),
    () => f.app.billing.recordedPayment(actor, p.payment.id),
    () => f.app.billing.recordedCredit(actor, p.credit.id),
    () => f.app.billing.salesEvidence(actor),
    () => f.app.billing.controlTotals(actor, "CAD"),
    () => f.app.billing.exposure(actor, f.buyer),
  ];
}
function owningWrites(
  f: ReturnType<typeof fixture>,
  actor: Actor,
  p: ReturnType<typeof prepared>,
) {
  return [
    () =>
      f.app.billing.credit(
        actor,
        p.invoiceId,
        "own-credit",
        "Synthetic credit",
        [{ lineId: p.lineId, quantity: 1 }],
      ),
    () =>
      f.app.billing.verifiedPayment(
        actor,
        p.invoiceId,
        1,
        "manual",
        "own-payment",
      ),
    () => f.app.billing.commitExposure(actor, f.buyer, "own-order", 1),
    () => f.app.billing.increaseExposure(actor, f.buyer, p.orderId, 1),
    () => f.app.billing.releaseExposure(actor, p.orderId, 0),
    () =>
      f.app.billing.issue(actor, f.buyer, p.orderId, p.shipmentId, [
        {
          productId: f.product,
          description: "Synthetic equipment",
          quantity: 1,
          unitPrice: 10000,
          unitTax: 1300,
        },
      ]),
  ];
}

test("billing unavailable principals cannot read or replay saved/new financial commands or owning writes", (t) => {
  const f = fixture(t),
    actor = user(f, "admin"),
    p = prepared(f, actor);
  change(f, actor, { active: false });
  const before = facts(f);
  for (const invalid of [
    actor,
    { ...actor, id: "absent-billing-principal" },
    { ...actor, orgId: "foreign-org" },
  ])
    denied([
      ...reads(f, invalid, p),
      ...p.replay(invalid),
      ...p.replay(invalid, "new"),
      ...owningWrites(f, invalid, p),
    ]);
  assert.deepEqual(facts(f), before);
});

test("current support role cannot replay financial results after demotion or perform owning writes", (t) => {
  const f = fixture(t),
    actor = user(f, "admin"),
    p = prepared(f, actor);
  change(f, actor, { role: "support" });
  const before = facts(f);
  denied([
    ...p.replay(actor),
    ...p.replay(actor, "new"),
    ...owningWrites(f, actor, p),
    () => f.app.billing.salesEvidence(actor),
    () => f.app.billing.controlTotals(actor, "CAD"),
  ]);
  assert.equal(f.app.billing.invoice(actor, p.invoiceId).id, p.invoiceId);
  assert.equal(
    f.app.billing.recordedPayment(actor, p.payment.id).id,
    p.payment.id,
  );
  assert.deepEqual(facts(f), before);
});

test("billing password-change requirements fence reads and saved/new commands before effects", (t) => {
  const f = fixture(t),
    actor = user(f, "admin"),
    p = prepared(f, actor);
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
      actor.id,
    );
  const before = facts(f);
  denied(
    [
      ...reads(f, actor, p),
      ...p.replay(actor),
      ...p.replay(actor, "new"),
      ...owningWrites(f, actor, p),
    ],
    "PASSWORD_CHANGE_REQUIRED",
  );
  assert.deepEqual(facts(f), before);
});

test("buyer account reassignment overrides supplied administrator role for billing reads and retries", (t) => {
  const f = fixture(t),
    p = prepared(f, f.actor),
    buyer = user(f, "buyer");
  const second = f.app.identity.createCustomer(
    f.actor,
    "other-billing-account",
    { name: "Other synthetic account", tier: "standard", creditLimit: 1000000 },
  ).id;
  change(f, buyer, { accountId: second });
  const forged = { ...buyer, role: "admin" as const, accountId: f.buyer };
  const before = facts(f);
  denied([
    () => f.app.billing.invoice(forged, p.invoiceId),
    () => f.app.billing.lines(forged, p.invoiceId),
    () => f.app.billing.totals(forged, p.invoiceId),
    () => f.app.billing.recordedCredit(forged, p.credit.id),
    () => f.app.billing.recordedPayment(forged, p.payment.id),
    ...p.replay(forged),
    ...p.replay(forged, "new"),
    ...owningWrites(f, forged, p),
  ]);
  assert.deepEqual(f.app.billing.invoices(forged), []);
  assert.deepEqual(f.app.billing.credits(forged), []);
  assert.deepEqual(facts(f), before);
});

test("unassigned buyers see no billing collections despite forged roles and account assignments", (t) => {
  const f = fixture(t),
    p = prepared(f, f.actor),
    buyer = user(f, "buyer");
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET account_id=NULL WHERE id=?", buyer.id);
  const forged = { ...buyer, role: "finance" as const, accountId: f.buyer },
    before = facts(f);
  assert.deepEqual(f.app.billing.invoices(forged), []);
  assert.deepEqual(f.app.billing.credits(forged), []);
  denied([
    () => f.app.billing.invoice(forged, p.invoiceId),
    ...p.replay(forged),
  ]);
  assert.deepEqual(facts(f), before);
});

test("current finance permissions allow exact retries with stale supplied buyer fields", (t) => {
  const f = fixture(t),
    actor = user(f, "finance"),
    p = prepared(f, actor),
    before = facts(f);
  const stale = {
    ...actor,
    role: "buyer" as const,
    accountId: "unrelated-account",
    sites: [],
  };
  assert.deepEqual(
    p.replay(stale).map((op) => op()),
    [p.payment, p.credit, p.refund, p.proof],
  );
  assert.equal(
    f.app.billing.recordedPayment(stale, p.payment.id).amount,
    11300,
  );
  assert.equal(f.app.billing.recordedCredit(stale, p.credit.id).total, 11300);
  assert.deepEqual(f.app.billing.totals(stale, p.invoiceId), {
    credited: 11300,
    paid: 11300,
    refunded: 11300,
    balance: 0,
  });
  assert.equal(f.app.billing.invoices(stale).length, 1);
  assert.equal(f.app.billing.credits(stale).length, 1);
  assert.equal(f.app.billing.salesEvidence(stale).invoices.length, 1);
  f.app.billing.controlTotals(stale, "CAD");
  assert.deepEqual(facts(f), before);
});

test("independent billing grant revocation survives restart before saved results and fresh writes", (t) => {
  const f = fixture(t),
    actor = user(f, "admin"),
    p = prepared(f, actor);
  const other = new Application(f.path);
  try {
    other.database
      .owned("iam")
      .run("UPDATE iam_users SET role='support' WHERE id=?", actor.id);
  } finally {
    other.close();
  }
  f.app.close();
  f.app = new Application(f.path);
  const before = facts(f);
  denied([
    ...p.replay(actor),
    ...p.replay(actor, "new"),
    ...owningWrites(f, actor, p),
    () => f.app.billing.salesEvidence(actor),
    () => f.app.billing.controlTotals(actor, "CAD"),
  ]);
  assert.deepEqual(facts(f), before);
});

test("current buyer billing collections and detail stay within their assigned account", (t) => {
  const f = fixture(t),
    p = prepared(f, f.actor),
    buyer = user(f, "buyer");
  const second = f.app.identity.createCustomer(
    f.actor,
    "other-buyer-billing-account",
    {
      name: "Other synthetic account",
      tier: "standard",
      creditLimit: 1000000,
    },
  ).id;
  const other = ship(
    { ...f, buyer: second },
    accept({ ...f, buyer: second }, 1, "other-order").id,
  );
  const otherLine = f.app.billing.lines(f.actor, other.invoiceId)[0]!;
  f.app.billing.issueCredit(f.actor, "other-account-credit", {
    invoiceId: other.invoiceId,
    reference: "OTHER-CR",
    reason: "Synthetic second account credit",
    lines: [{ lineId: otherLine.id, quantity: 1 }],
  });
  const forged = { ...buyer, role: "admin" as const, accountId: second },
    before = facts(f);
  assert.deepEqual(
    f.app.billing.invoices(forged).map((i) => i.id),
    [p.invoiceId],
  );
  assert.deepEqual(
    f.app.billing.credits(forged).map((c) => c.id),
    [p.credit.id],
  );
  assert.equal(f.app.billing.invoice(forged, p.invoiceId).account_id, f.buyer);
  assert.equal(f.app.billing.totals(forged, p.invoiceId).balance, 0);
  assert.equal(f.app.billing.lines(forged, p.invoiceId)[0]!.quantity, 1);
  denied([
    () => f.app.billing.invoice(forged, other.invoiceId),
    () => f.app.billing.lines(forged, other.invoiceId),
    () => f.app.billing.totals(forged, other.invoiceId),
    () => f.app.billing.recordedPayment(forged, p.payment.id),
    () => f.app.billing.recordedCredit(forged, p.credit.id),
    ...p.replay(forged),
    ...p.replay(forged, "new"),
  ]);
  assert.deepEqual(facts(f), before);
});

test("owning warranty credit and verified finance worker payment use current roles and conserve money", (t) => {
  const f = fixture(t),
    shipment = ship(f, accept(f).id),
    warranty = user(f, "warranty"),
    finance = user(f, "finance");
  const line = f.app.billing.lines(f.actor, shipment.invoiceId)[0]!;
  const stale = {
    ...warranty,
    role: "buyer" as const,
    accountId: "unrelated-account",
  };
  const credit = f.app.database.transaction(() =>
    f.app.billing.credit(
      stale,
      shipment.invoiceId,
      "WARRANTY-AUTHORITY",
      "Synthetic warranty remedy",
      [{ lineId: line.id, quantity: 1 }],
    ),
  );
  assert.equal(credit.total, 11300);
  const worker = f.app.identity.workerActor(finance.orgId, finance.id);
  const payment = f.app.database.transaction(() =>
    f.app.billing.verifiedPayment(
      { ...worker, role: "buyer", accountId: "unrelated-account" },
      shipment.invoiceId,
      11300,
      "stripe",
      "SYNTHETIC-VERIFIED-PAYMENT",
    ),
  );
  assert.equal(
    f.app.billing.recordedPayment(finance, payment.id).amount,
    11300,
  );
  assert.deepEqual(f.app.billing.totals(f.actor, shipment.invoiceId), {
    credited: 11300,
    paid: 11300,
    refunded: 0,
    balance: -11300,
  });
  const before = facts(f);
  assert.deepEqual(
    f.app.database.transaction(() =>
      f.app.billing.verifiedPayment(
        worker,
        shipment.invoiceId,
        11300,
        "stripe",
        "SYNTHETIC-VERIFIED-PAYMENT",
      ),
    ),
    payment,
  );
  denied([
    () =>
      f.app.billing.manualPayment(stale, "warranty-payment", {
        invoiceId: shipment.invoiceId,
        amount: 1,
        reference: "BAD",
        reason: "Synthetic rejected payment",
      }),
  ]);
  assert.deepEqual(facts(f), before);
});
