import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "../src/server/application.ts";
import { seedGreePilot } from "../src/demo/gree-pilot-seed.ts";

test("Gree pilot uses native stock/order/incoming flows and a scoped buyer; refuses reseeding", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "gree-pilot-"));
  const app = new Application(join(directory, "app.db"), "CA");
  t.after(() => {
    app.close();
    rmSync(directory, { recursive: true });
  });
  const currentPassword = "only-for-local-test-admin";
  const actor = app.identity.bootstrap(
    "Sample pilot",
    "admin@example.test",
    currentPassword,
    "CAD",
  );
  const access = {
    currentPassword,
    buyerEmail: "sample-buyer@example.test",
    buyerPassword: "only-for-local-test-buyer",
  };
  const result = seedGreePilot(app, actor, access);
  assert.equal(app.catalog.products(actor).length, 11);
  assert.equal(app.identity.customers(actor).length, 3);
  assert.equal(app.procurement.orders(actor).length, 12);
  assert.equal(
    app.inventory.stock(actor).filter((unit) => unit.condition === "quarantine")
      .length,
    2,
  );
  assert.equal(app.identity.residency.current(actor).length, 0);
  const session = app.identity.login(access.buyerEmail, access.buyerPassword);
  assert.equal(session.actor.role, "buyer");
  assert.equal(session.passwordChangeRequired, true);
  app.identity.changePassword(session.actor, "change-sample-password", {
    currentPassword: access.buyerPassword,
    password: "replacement-local-buyer-password",
  });
  const buyer = app.identity.login(
    access.buyerEmail,
    "replacement-local-buyer-password",
  ).actor;
  assert.equal(app.identity.customers(buyer).length, 1);
  const catalog = app.catalog.customerProductPage(
    buyer,
    result.customerIds[0]!,
  );
  assert.equal(catalog.items.length, 11);
  assert.equal(
    catalog.items.find((p) => p.sku === "SAMPLE-GREE-CHARMO")!.unit_price,
    134550,
  );
  assert.throws(() =>
    app.catalog.customerProductPage(buyer, result.customerIds[1]!),
  );
  assert.throws(() => app.orders.order(buyer, result.orderIds[2]!));
  assert.throws(() => app.catalog.productPage(buyer));
  const cart = app.orders.saveCart(buyer, "sample-buyer-cart", {
    accountId: result.customerIds[0]!,
    warehouseId: result.warehouseId,
    revision: Number(app.orders.carts(buyer)[0]?.revision ?? 0),
    lines: [{ productId: result.productIds[1]!, quantity: 1 }],
  });
  const quote = app.orders.quote(buyer, "sample-buyer-quote", {
    cartId: cart.id,
    revision: cart.revision,
  });
  const order = app.orders.accept(buyer, "sample-buyer-order", {
    quoteId: quote.id,
    allowBackorder: false,
  });
  assert.equal(
    app.orders.order(buyer, order.id).account_id,
    result.customerIds[0],
  );
  assert.throws(() => seedGreePilot(app, actor, access), /empty pilot/);
  assert.equal(app.catalog.products(actor).length, 11);
});
