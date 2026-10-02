import { test } from "node:test";
import { fixture, accept, ship } from "./fixtures.ts";
import assert from "node:assert/strict";
import { Application } from "../src/server/application.ts";
import { type Actor, DomainError } from "../src/server/core.ts";

test("real database: receipt → transfer → order → shipment/invoice → quarantine return → restock/credit → refund survives restart", (t) => {
  const f = fixture(t),
    u = f.app.inventory.trace(f.actor, "S3").unit;
  const transfer = f.app.inventory.dispatchTransfer(f.actor, "transfer", {
    unitId: u.id,
    quantity: 1,
    revision: u.revision,
    destinationId: f.w2,
    reason: "Test transfer",
  });
  assert.equal(f.app.inventory.availability(f.actor, f.product, f.w1), 2);
  assert.equal(f.app.inventory.availability(f.actor, f.product, f.w2), 0);
  f.app.inventory.receiveTransfer(f.actor, "transferReceive", {
    transferId: transfer.id,
    lineId: transfer.lineId,
    quantity: 1,
    serial: "S3",
    receiptRef: "TEST-TRANSFER-1",
    bin: "B-1",
    condition: "usable",
    reason: "Synthetic arrival evidence",
  });
  assert.equal(f.app.inventory.availability(f.actor, f.product, f.w2), 1);
  const order = accept(f);
  const shipment = ship(f, order.id);
  const invoice = f.app.billing.invoice(f.actor, shipment.invoiceId);
  assert.equal(invoice.total, 11300);
  assert.equal(f.app.billing.exposure(f.actor, f.buyer).total, 11300);
  f.app.billing.manualPayment(f.actor, "payment", {
    invoiceId: invoice.id,
    amount: 11300,
    reference: "BANK-1",
    reason: "Synthetic bank statement",
  });
  const unit = f.app.inventory.trace(f.actor, "S1").unit;
  const claim = f.app.warranty.submit(f.actor, "claim", {
    accountId: f.buyer,
    unitId: unit.id,
    type: "return",
    issue: "Synthetic return",
    evidence: "fixture",
  });
  f.app.warranty.review(f.actor, "approve", {
    claimId: claim.id,
    approved: true,
    reason: "Test approval",
  });
  f.app.warranty.receive(f.actor, "return", {
    claimId: claim.id,
    warehouseId: f.w1,
    bin: "Q-1",
    serial: "S1",
  });
  assert.equal(
    f.app.inventory.trace(f.actor, "S1").unit.condition,
    "quarantine",
  );
  assert.equal(f.app.inventory.availability(f.actor, f.product, f.w1), 1);
  f.app.warranty.inspect(f.actor, "inspect", {
    claimId: claim.id,
    findings: "Sealed, undamaged",
  });
  f.app.warranty.dispose(f.actor, "dispose", {
    claimId: claim.id,
    disposition: "restock",
    reason: "Inspection passed",
  });
  f.app.warranty.credit(f.actor, "credit", {
    claimId: claim.id,
    reason: "Approved return credit",
  });
  assert.equal(f.app.billing.totals(f.actor, invoice.id).balance, -11300);
  assert.equal(f.app.inventory.availability(f.actor, f.product, f.w1), 2);
  const payment = f.app.database
    .owned("billing")
    .get("SELECT id FROM billing_payments WHERE invoice_id=?", invoice.id)!;
  const refund = f.app.billing.refundRequest(f.actor, "refund", {
    invoiceId: invoice.id,
    paymentId: String(payment.id),
    amount: 6000,
    reference: "REF-1",
    reason: "Customer return, first portion",
  });
  const remainder = f.app.billing.refundRequest(f.actor, "refund-remainder", {
    invoiceId: invoice.id,
    paymentId: String(payment.id),
    amount: 5300,
    reference: "REF-2",
    reason: "Customer return, remainder",
  });
  f.app.billing.manualRefund(f.actor, "refundVerify", {
    refundId: refund.id,
    reference: "BANK-REF-1",
    reason: "Synthetic bank evidence",
  });
  assert.throws(
    () =>
      f.app.billing.manualRefund(f.actor, "refundVerify-remainder", {
        refundId: remainder.id,
        reference: "BANK-REF-1",
        reason: "Repeated bank evidence must not verify two refunds",
      }),
    (e: unknown) => e instanceof DomainError && e.code === "REFUND_REFERENCE",
  );
  assert.equal(f.app.billing.totals(f.actor, invoice.id).balance, -5300);
  f.app.billing.manualRefund(f.actor, "refundVerify-remainder", {
    refundId: remainder.id,
    reference: "BANK-REF-2",
    reason: "Independent synthetic bank evidence",
  });
  assert.equal(f.app.billing.totals(f.actor, invoice.id).balance, 0);
  const second = new Application(f.path);
  try {
    assert.equal(second.billing.invoice(f.actor, invoice.id).total, 11300);
    assert.equal(second.billing.totals(f.actor, invoice.id).balance, 0);
    assert.equal(
      second.inventory.trace(f.actor, "S1").unit.condition,
      "usable",
    );
  } finally {
    second.close();
  }
});
test("idempotent command + permanent delivery identity + quote identity cannot duplicate stock/orders", (t) => {
  const f = fixture(t);
  const receipt = f.app.procurement.receive(f.actor, "receive", {
    poId: f.po,
    lineId: String(
      f.app.procurement.orders(f.actor).find((p) => p.id === f.po)!.lines[0]!
        .id,
    ),
    deliveryRef: "DEL-1",
    quantity: 3,
    serials: ["S1", "S2", "S3"],
    bin: "A-1",
    quarantine: false,
  });
  assert.equal(receipt.unitIds.length, 3);
  assert.equal(f.app.inventory.stock(f.actor).length, 3);
  assert.throws(
    () =>
      f.app.procurement.receive(f.actor, "receive2", {
        poId: f.po,
        lineId: String(
          f.app.procurement.orders(f.actor).find((p) => p.id === f.po)!
            .lines[0]!.id,
        ),
        deliveryRef: "DEL-1",
        quantity: 1,
        serials: ["S4"],
        bin: "A-1",
        quarantine: false,
      }),
    { code: "DUPLICATE_DELIVERY" },
  );
  const cart = f.app.orders.saveCart(f.actor, "cart", {
    accountId: f.buyer,
    warehouseId: f.w1,
    revision: 0,
    lines: [{ productId: f.product, quantity: 1 }],
  });
  const quote = f.app.orders.quote(f.actor, "quote", {
    cartId: cart.id,
    revision: cart.revision,
  });
  const a = f.app.orders.accept(f.actor, "accept", {
      quoteId: quote.id,
      allowBackorder: false,
    }),
    b = f.app.orders.accept(f.actor, "other", {
      quoteId: quote.id,
      allowBackorder: false,
    });
  assert.equal(a.id, b.id);
  assert.equal(f.app.orders.list(f.actor).length, 1);
  assert.throws(
    () =>
      f.app.orders.accept(f.actor, "accept", {
        quoteId: quote.id,
        allowBackorder: true,
      }),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
});
test("stock/credit failure rolls back exposure, orders, reservations and command receipts atomically", (t) => {
  const f = fixture(t);
  assert.throws(() => accept(f, 4), { code: "STOCK" });
  assert.equal(f.app.billing.exposure(f.actor, f.buyer).total, 0);
  assert.equal(f.app.orders.list(f.actor).length, 0);
  assert.equal(f.app.inventory.availability(f.actor, f.product, f.w1), 3);
  f.app.identity.setHold(f.actor, "held", {
    accountId: f.buyer,
    held: true,
    reason: "Test finance hold",
  });
  assert.throws(() => accept(f, 1, "held-order"), { code: "CREDIT_HOLD" });
  assert.equal(f.app.inventory.availability(f.actor, f.product, f.w1), 3);
});
test("scopes, table ownership and cached receipts reauthorize current actor grants", (t) => {
  const f = fixture(t),
    order = accept(f);
  const foreign = f.app.identity.createCustomer(f.actor, "other", {
    name: "Other account",
    tier: "standard",
    creditLimit: 1000000,
  }).id;
  const buyer: Actor = {
    ...f.actor,
    id: "buyer-test",
    role: "buyer",
    accountId: foreign,
    sites: [],
  };
  assert.throws(() => f.app.orders.order(buyer, order.id), {
    code: "FORBIDDEN",
  });
  assert.throws(() => f.app.orders.list(buyer), { code: "FORBIDDEN" });
  const persistedBuyer = f.app.identity.createUser(f.actor, "scoped-buyer", {
    name: "Scoped buyer",
    email: "scoped-buyer@example.test",
    password: "long-test-only-password",
    role: "buyer",
    accountId: foreign,
    sites: [],
  });
  const authorizedBuyer = f.app.identity.currentActor({
    ...f.actor,
    id: persistedBuyer.id,
  });
  assert.throws(() => f.app.orders.order(authorizedBuyer, order.id), {
    code: "FORBIDDEN",
  });
  assert.equal(f.app.orders.list(authorizedBuyer).length, 0);
  assert.throws(
    () =>
      f.app.database.owned("inventory").all("SELECT * FROM billing_invoices"),
    /prohibited|authorized/,
  );
  assert.throws(
    () => f.app.database.owned("inventory").run("DELETE FROM billing_holds"),
    /authorized/,
  );
  for (const sql of [
    "DROP TABLE billing_holds",
    "ALTER TABLE billing_holds ADD COLUMN foreign_write TEXT",
    "PRAGMA writable_schema=ON",
    "ATTACH DATABASE ':memory:' AS external_db",
  ])
    assert.throws(
      () => f.app.database.owned("inventory").migrate(sql),
      /authorized/,
    );
  const revoked: Actor = { ...f.actor, role: "buyer", accountId: f.buyer };
  assert.throws(
    () => f.app.inventory.createWarehouse(revoked, "w1", { name: "Toronto" }),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () => f.app.database.transaction(() => Promise.resolve("forbidden async")),
    DomainError,
  );
});
test("picked stock rejects cancellation; unpick releases once and preserves quantity conservation", (t) => {
  const f = fixture(t),
    order = accept(f),
    p = f.app.fulfillment.picks(f.actor, order.id)[0]!;
  f.app.fulfillment.pick(f.actor, "pick", {
    orderId: order.id,
    allocationId: p.id,
    serial: p.serial,
  });
  const line = f.app.orders.lines(f.actor, order.id)[0]!;
  assert.throws(
    () =>
      f.app.orders.cancel(f.actor, "cancel", {
        orderId: order.id,
        lineId: line.id,
        quantity: 1,
        revision: 1,
        reason: "Test",
      }),
    { code: "PICKED" },
  );
  assert.equal(f.app.billing.exposure(f.actor, f.buyer).total, 11300);
  f.app.fulfillment.pick(f.actor, "unpick", {
    orderId: order.id,
    allocationId: p.id,
    serial: p.serial,
    unpick: true,
  });
  f.app.orders.cancel(f.actor, "cancel", {
    orderId: order.id,
    lineId: line.id,
    quantity: 1,
    revision: 1,
    reason: "Test",
  });
  assert.equal(f.app.inventory.availability(f.actor, f.product, f.w1), 3);
  assert.equal(f.app.billing.exposure(f.actor, f.buyer).total, 0);
  assert.equal(f.app.orders.order(f.actor, order.id).state, "closed");
});
test("optional projections are removable without altering native workflow", (t) => {
  const f = fixture(t);
  assert.equal(f.app.platform.project(false), 0);
  const order = accept(f);
  ship(f, order.id);
  assert.ok(f.app.platform.project(true) > 0);
  assert.equal(f.app.platform.project(true), 0);
  assert.equal(f.app.platform.project(false), 0);
  assert.equal(f.app.billing.invoices(f.actor).length, 1);
});
