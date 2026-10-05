import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, accept, ship } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { DomainError, digest, type Actor } from "../src/server/core.ts";
import type { Owner } from "../src/server/database.ts";

function operator(f: ReturnType<typeof fixture>, sites = [f.w1]) {
  const { id } = f.app.identity.createUser(f.actor, "site-operator", {
    name: "Synthetic warehouse operator",
    email: "site-operator@example.test",
    password: "long-invoice-site-password",
    role: "warehouse",
    sites,
  });
  return f.app.identity.currentActor({ ...f.actor, id });
}
function facts(f: ReturnType<typeof fixture>) {
  return Object.fromEntries(
    (
      ["billing", "fulfillment", "orders", "inventory", "platform"] as Owner[]
    ).flatMap((owner) => {
      const store = f.app.database.owned(owner);
      return store
        .all<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE ? ORDER BY name",
          `${owner}_%`,
        )
        .map(({ name }) => [
          name,
          store.all(`SELECT * FROM ${name} ORDER BY rowid`),
        ]);
    }),
  );
}
function denied(fn: () => unknown, code = "FORBIDDEN", status = 403) {
  assert.throws(fn, (e: unknown) => {
    assert.ok(e instanceof DomainError);
    assert.equal(e.code, code);
    assert.equal(e.status, status);
    return true;
  });
}
function readDenied(
  f: ReturnType<typeof fixture>,
  actor: Actor,
  invoiceId: string,
  code = "FORBIDDEN",
  status = 403,
) {
  denied(() => f.app.billing.invoice(actor, invoiceId), code, status);
  denied(() => f.app.billing.lines(actor, invoiceId), code, status);
  denied(() => f.app.billing.totals(actor, invoiceId), code, status);
}
function retry(
  f: ReturnType<typeof fixture>,
  actor: Actor,
  shipment: ReturnType<typeof ship>,
  orderId: string,
  accountId: string = f.buyer,
) {
  return f.app.billing.issue(actor, accountId, orderId, shipment.id, [
    {
      productId: f.product,
      description: "Synthetic equipment",
      quantity: 1,
      unitPrice: 10000,
      unitTax: 1300,
    },
  ]);
}

test("warehouse invoice details, lines, balances and issuance retries require the current shipment site", (t) => {
  const f = fixture(t),
    order = accept(f),
    shipment = ship(f, order.id);
  const otherSite = operator(f, [f.w2]),
    before = facts(f);
  readDenied(f, otherSite, shipment.invoiceId);
  denied(() => retry(f, otherSite, shipment, order.id));
  assert.deepEqual(facts(f), before);
});

test("stale and forged warehouse grants cannot retain invoice access after independent revocation and restart", (t) => {
  const f = fixture(t),
    order = accept(f),
    shipment = ship(f, order.id),
    stale = operator(f);
  assert.equal(
    f.app.billing.invoice(stale, shipment.invoiceId).id,
    shipment.invoiceId,
  );
  const independent = new Application(f.path);
  try {
    independent.database
      .owned("iam")
      .run(
        "UPDATE iam_users SET sites=? WHERE id=?",
        JSON.stringify([f.w2]),
        stale.id,
      );
  } finally {
    independent.close();
  }
  const forged = { ...stale, role: "admin" as const, sites: [f.w1, f.w2] },
    before = facts(f);
  for (const actor of [stale, forged]) {
    readDenied(f, actor, shipment.invoiceId);
    denied(() => retry(f, actor, shipment, order.id));
  }
  assert.deepEqual(facts(f), before);
  f.app.close();
  f.app = new Application(f.path);
  readDenied(f, forged, shipment.invoiceId);
  assert.deepEqual(facts(f), before);
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_users SET sites=? WHERE id=?",
      JSON.stringify([f.w1]),
      stale.id,
    );
  assert.equal(
    f.app.billing.invoice(stale, shipment.invoiceId).id,
    shipment.invoiceId,
  );
  assert.deepEqual(retry(f, stale, shipment, order.id), {
    id: shipment.invoiceId,
    number: f.app.billing.invoice(f.actor, shipment.invoiceId).number,
  });
  assert.deepEqual(facts(f), before);
});

test("warehouse users without any site grant cannot read native invoices or saved issuance results", (t) => {
  const f = fixture(t),
    order = accept(f),
    shipment = ship(f, order.id),
    actor = operator(f, []),
    before = facts(f);
  readDenied(f, { ...actor, sites: [f.w1] }, shipment.invoiceId);
  denied(() => retry(f, actor, shipment, order.id));
  assert.deepEqual(facts(f), before);
});

test("new invoice issuance refuses an ungranted or void shipment before any native effects", (t) => {
  const f = fixture(t),
    order = accept(f),
    otherSite = operator(f, [f.w2]);
  const picks = f.app.fulfillment.picks(f.actor, order.id);
  for (const pick of picks)
    f.app.fulfillment.pick(f.actor, `site-pick-${pick.id}`, {
      orderId: order.id,
      allocationId: pick.id,
      serial: pick.serial,
    });
  const packed = f.app.fulfillment.pack(f.actor, "site-pack", {
    orderId: order.id,
    revision: f.app.orders.order(f.actor, order.id).revision,
    mode: "collection",
    address: "Synthetic counter",
    lines: picks.map((p) => ({ allocationId: p.id, quantity: p.quantity })),
  });
  const issue = (actor: Actor) =>
    retry(f, actor, { id: packed.id, invoiceId: "not-issued" }, order.id);
  const before = facts(f);
  denied(() => issue(otherSite));
  // Valid native custody is not enough to create new money outside the
  // handover transaction. Read-only retries above remain supported.
  denied(() => issue(f.actor), "TRANSACTION", 409);
  assert.deepEqual(facts(f), before);
  assert.equal(f.app.billing.invoices(f.actor).length, 0);
  f.app.fulfillment.void(f.actor, "site-void", {
    shipmentId: packed.id,
    reason: "Synthetic cancelled collection",
  });
  const afterVoid = facts(f);
  denied(() => issue(f.actor), "INVOICE_SOURCE", 409);
  assert.deepEqual(facts(f), afterVoid);
});

test("issuance validates owning shipment account and order before returning a saved invoice or writing money", (t) => {
  const f = fixture(t),
    order = accept(f),
    shipment = ship(f, order.id),
    actor = operator(f),
    before = facts(f);
  denied(
    () => retry(f, actor, shipment, "unrelated-order"),
    "INVOICE_SOURCE",
    409,
  );
  denied(
    () => retry(f, f.actor, shipment, order.id, "unrelated-account"),
    "INVOICE_SOURCE",
    409,
  );
  denied(
    () => retry(f, actor, { ...shipment, id: "absent-shipment" }, order.id),
    "NOT_FOUND",
    404,
  );
  assert.deepEqual(facts(f), before);
});

test("warehouse invoice access refuses mismatched native provenance while finance visibility remains intact", (t) => {
  const f = fixture(t),
    order = accept(f),
    shipment = ship(f, order.id),
    actor = operator(f);
  f.app.database
    .owned("billing")
    .run(
      "UPDATE billing_invoices SET order_id=? WHERE id=?",
      "different-order",
      shipment.invoiceId,
    );
  const before = facts(f);
  readDenied(f, actor, shipment.invoiceId, "INVOICE_SOURCE", 409);
  denied(() => retry(f, actor, shipment, order.id), "INVOICE_SOURCE", 409);
  denied(() => retry(f, f.actor, shipment, order.id), "INVOICE_SOURCE", 409);
  assert.equal(
    f.app.billing.invoice(f.actor, shipment.invoiceId).id,
    shipment.invoiceId,
  );
  assert.deepEqual(facts(f), before);
});

test("historical opening invoices have no warehouse entitlement even when the user has all sites", (t) => {
  const f = fixture(t),
    actor = operator(f, [f.w1, f.w2]);
  const input = {
    version: 1 as const,
    batchRef: "SITE-OPENING",
    sourceRef: "SYNTHETIC-SITE-OPENING",
    sourceHash: digest("Independent synthetic opening document"),
    cutoffAt: "2026-09-01T00:00:00.000Z",
    region: "CA" as const,
    currency: "CAD" as const,
    expectedQuantity: 1,
    expectedValue: 11300,
    expectedNet: 10000,
    expectedTax: 1300,
    expectedCredited: 0,
    expectedPaid: 0,
    expectedRefunded: 0,
    acknowledgment:
      "Synthetic source rights, freeze, amounts and independent balance reviewed",
    rows: [
      {
        sourceId: "OPEN-1",
        accountId: f.buyer,
        number: "HISTORICAL-SITE-1",
        issuedAt: "2026-08-01T00:00:00.000Z",
        dueAt: "2026-08-31T00:00:00.000Z",
        net: 10000,
        tax: 1300,
        total: 11300,
        credited: 0,
        paid: 0,
        refunded: 0,
        balance: 11300,
        lines: [
          {
            productId: f.product,
            description: "Original equipment",
            quantity: 1,
            unitPrice: 10000,
            unitTax: 1300,
            creditedQuantity: 0,
          },
        ],
      },
    ],
  };
  const review = f.app.migration.documents.preview(
    f.actor,
    "opening-site-preview",
    input,
  );
  const applied = f.app.migration.documents.decide(
    f.actor,
    "opening-site-approve",
    {
      batchId: review.id,
      reviewHash: review.reviewHash,
      decision: "approve",
      reason: "Synthetic independent historical amount review",
    },
  );
  const invoiceId = applied.mappings[0]!.invoiceId,
    before = facts(f);
  assert.equal(f.app.billing.invoice(f.actor, invoiceId).origin, "opening");
  readDenied(f, actor, invoiceId);
  assert.deepEqual(facts(f), before);
});

test("authorized warehouse handover captures immutable invoice facts and exact retries without duplicated money or stock", (t) => {
  const f = fixture(t),
    order = accept(f),
    actor = operator(f);
  const shipment = ship({ ...f, actor }, order.id),
    before = facts(f);
  const invoice = f.app.billing.invoice(actor, shipment.invoiceId);
  assert.equal(invoice.total, 11300);
  assert.equal(f.app.billing.lines(actor, invoice.id)[0]!.quantity, 1);
  assert.equal(f.app.billing.totals(actor, invoice.id).balance, 11300);
  assert.deepEqual(retry(f, actor, shipment, order.id), {
    id: invoice.id,
    number: invoice.number,
  });
  assert.ok(
    f.app.database
      .owned("billing")
      .get(
        "SELECT hash FROM billing_document_facts WHERE document_id=?",
        invoice.id,
      ),
  );
  assert.deepEqual(facts(f), before);
});
