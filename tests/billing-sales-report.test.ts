import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, accept, ship } from "./fixtures.ts";
import { seedCustomerPricing } from "./customer-pricing-fixture.ts";
import { createHttp } from "../src/server/http.ts";
import { Application } from "../src/server/application.ts";

type F = ReturnType<typeof fixture>;
const period = { from: "2026-10-01", to: "2026-10-31" };
function invoice(
  f: F,
  id: string,
  options: {
    accountId?: string;
    currency?: string;
    date?: string;
    quantity?: number;
    price?: number;
    tax?: number;
    shipping?: number;
  } = {},
) {
  const s = f.app.database.owned("billing"),
    q = options.quantity ?? 2,
    p = options.price ?? 5001,
    t = options.tax ?? 650,
    shipping = options.shipping ?? 0;
  s.run(
    "INSERT INTO billing_invoices VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    id,
    f.actor.orgId,
    options.accountId ?? f.buyer,
    "order-" + id,
    "ship-" + id,
    "INV-" + id,
    options.currency ?? "CAD",
    q * p + shipping,
    q * t,
    q * (p + t) + shipping,
    options.date ?? "2026-10-05T12:00:00.000Z",
  );
  s.run(
    "INSERT INTO billing_lines VALUES(?,?,?,?,?,?,?,?)",
    "line-" + id,
    f.actor.orgId,
    id,
    f.product,
    "Original sold product",
    q,
    p,
    t,
  );
  if (shipping) {
    s.run(
      "INSERT INTO billing_lines VALUES(?,?,?,?,?,?,?,?)",
      "freight-" + id,
      f.actor.orgId,
      id,
      "shipping:" + id,
      "Reviewed shipping",
      1,
      shipping,
      0,
    );
    s.run(
      "INSERT INTO billing_shipping_snapshots VALUES(?,?,?,?,?)",
      f.actor.orgId,
      id,
      "order-" + id,
      JSON.stringify({
        treatment: "extra",
        net: shipping,
        tax: 0,
        reason: "Customer terms",
        revision: 1,
      }),
      "freight-" + id,
    );
  }
  return id;
}
function credit(
  f: F,
  id: string,
  invoiceId: string,
  lineId: string,
  q: number,
  p: number,
  t: number,
  date = "2026-10-06T12:00:00.000Z",
) {
  const s = f.app.database.owned("billing");
  s.run(
    "INSERT INTO billing_credits VALUES(?,?,?,?,?,?,?,?,?,?)",
    id,
    f.actor.orgId,
    invoiceId,
    "ref-" + id,
    "CN-" + id,
    "Returned original item",
    q * p,
    q * t,
    q * (p + t),
    date,
  );
  s.run(
    "INSERT INTO billing_credit_lines VALUES(?,?,?,?,?)",
    "credit-line-" + id,
    f.actor.orgId,
    id,
    lineId,
    q,
  );
}
test("complete currency-separated sales use exact original lines; shipping, independent-period credits and cash remain separate", (t) => {
  const f = fixture(t),
    p = seedCustomerPricing(f),
    s = f.app.database.owned("billing");
  invoice(f, "a", { shipping: 999 });
  invoice(f, "older", { date: "2026-09-30T23:59:59.999Z" });
  invoice(f, "usd", {
    accountId: p.other,
    currency: "USD",
    quantity: 1,
    price: 77,
    tax: 3,
  });
  credit(f, "c", "a", "line-a", 1, 5001, 650);
  credit(f, "freight", "a", "freight-a", 1, 999, 0);
  credit(f, "old-credit", "older", "line-older", 1, 5001, 650);
  s.run(
    "INSERT INTO billing_payments VALUES(?,?,?,?,?,?,?)",
    "pay",
    f.actor.orgId,
    "a",
    "manual",
    "bank",
    7000,
    "2026-10-08T12:00:00.000Z",
  );
  for (const [state, amount] of [
    ["completed", 1000],
    ["pending", 200],
    ["unknown", 300],
    ["rejected", 400],
  ] as const)
    s.run(
      "INSERT INTO billing_refunds VALUES(?,?,?,?,?,?,?,?)",
      "refund-" + state,
      f.actor.orgId,
      "a",
      "pay",
      amount,
      "refund-" + state,
      state,
      "2026-10-09T12:00:00.000Z",
    );
  const result = f.app.billing.salesReport(f.actor, period),
    cad = result.currencies[0]!;
  assert.deepEqual(cad, {
    currency: "CAD",
    invoiceCount: 1,
    productQuantity: 2,
    productNet: 10002,
    shippingNet: 999,
    invoiceTax: 1300,
    invoiceTotal: 12301,
    creditCount: 3,
    creditedProductQuantity: 2,
    productCredits: 10002,
    shippingCredits: 999,
    creditTax: 1300,
    creditTotal: 12301,
    netSales: 0,
    netTax: 0,
    netTotal: 0,
    payments: 7000,
    refundsCompleted: 1000,
    refundsPending: 200,
    refundsUnknown: 300,
  });
  assert.equal(result.currencies[1]!.currency, "USD");
  assert.equal(result.currencies[1]!.invoiceTotal, 80);
  assert.equal(
    result.details.items.find((e) => e.id === "line-a")!.unitPrice,
    5001,
  );
  assert.equal(
    result.details.items.find((e) => e.id === "credit-line-c")!.total,
    -5651,
  );
  assert.equal(
    result.details.items.find((e) => e.id === "freight-a")!.shipping,
    true,
  );
  assert.equal(
    result.details.items.find((e) => e.id === "refund-rejected")!.refundState,
    "rejected",
  );
  assert.equal(
    result.daily.find((d) => d.date === "2026-10-06" && d.currency === "CAD")!
      .creditNet,
    11001,
  );
  assert.equal(
    result.daily.find((d) => d.date === "2026-10-08")!.payments,
    7000,
  );
  f.app.catalog.setPrice(f.actor, "later-price", {
    productId: f.product,
    tier: "standard",
    unitPrice: 999999,
  });
  assert.deepEqual(
    f.app.billing.salesReport(f.actor, period).currencies,
    result.currencies,
  );
  const buyer = f.app.billing.salesReport(p.buyer, period);
  assert.equal(buyer.accountId, f.buyer);
  assert.equal(buyer.currencies.length, 1);
  assert.ok(buyer.details.items.every((e) => e.accountId === f.buyer));
  assert.throws(
    () => f.app.billing.salesReport(p.buyer, { ...period, accountId: p.other }),
    { code: "FORBIDDEN" },
  );
  assert.equal(
    f.app.billing.salesReport(f.actor, { ...period, accountId: p.other })
      .currencies[0]!.currency,
    "USD",
  );
});

test("native fulfillment invoice appears without synthetic write; report survives restart", (t) => {
  const f = fixture(t),
    order = accept(f),
    shipped = ship(f, order.id),
    day = new Date().toISOString().slice(0, 10);
  const report = f.app.billing.salesReport(f.actor, { from: day, to: day });
  assert.equal(report.currencies[0]!.productNet, 10000);
  assert.equal(report.currencies[0]!.invoiceTotal, 11300);
  assert.equal(report.details.items[0]!.invoiceId, shipped.invoiceId);
  f.app.close();
  f.app = new Application(f.path, "CA");
  assert.deepEqual(
    f.app.billing.salesReport(f.actor, { from: day, to: day }).currencies,
    report.currencies,
  );
});

test("366-day validated date range and exact integer/fact guards reject ambiguous results", (t) => {
  const f = fixture(t);
  for (const [from, to] of [
    ["2026-02-30", "2026-03-01"],
    ["2026-10-05", "2026-10-04"],
    ["2025-01-01", "2026-01-02"],
    ["2026-1-01", "2026-02-01"],
  ])
    assert.throws(
      () => f.app.billing.salesReport(f.actor, { from: from!, to: to! }),
      { code: "VALIDATION" },
    );
  assert.equal(
    f.app.billing.salesReport(f.actor, { from: "2024-01-01", to: "2024-12-31" })
      .currencies.length,
    0,
  );
  assert.equal(
    f.app.billing.salesReport(f.actor, { from: "9999-12-31", to: "9999-12-31" })
      .currencies.length,
    0,
  );
  invoice(f, "boundary", { date: "2026-10-31T23:59:59.999Z" });
  invoice(f, "outside", { date: "2026-11-01T00:00:00.000Z" });
  assert.equal(
    f.app.billing.salesReport(f.actor, period).currencies[0]!.invoiceCount,
    1,
  );
  f.app.database
    .owned("billing")
    .run(
      "UPDATE billing_invoices SET net=net+1,total=total+1 WHERE id='boundary'",
    );
  assert.throws(() => f.app.billing.salesReport(f.actor, period), {
    code: "REPORT_FACTS",
  });
  f.app.database
    .owned("billing")
    .run(
      "UPDATE billing_invoices SET net=net-1,total=total-1 WHERE id='boundary'",
    );
  invoice(f, "too-large", {
    price: Number.MAX_SAFE_INTEGER,
    quantity: 2,
    tax: 0,
  });
  assert.throws(() => f.app.billing.salesReport(f.actor, period));
});

test("latest100 drilldown is stable and bounded while aggregates include all106 invoices; opening sale facts excluded", (t) => {
  const f = fixture(t),
    s = f.app.database.owned("billing");
  for (let n = 0; n < 106; n++)
    invoice(f, String(n).padStart(3, "0"), { quantity: 1, price: 100, tax: 0 });
  invoice(f, "opening", { price: 2000 });
  s.run(
    "INSERT INTO billing_opening_documents VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    "opening",
    f.actor.orgId,
    "source",
    "opening",
    "batch",
    "hash",
    "2026-10-05T00:00:00.000Z",
    "2026-10-05T00:00:00.000Z",
    "2026-11-05T00:00:00.000Z",
    0,
    0,
    0,
    5300,
    f.actor.id,
    "2026-10-05T00:00:00.000Z",
  );
  credit(f, "opening-credit", "opening", "line-opening", 1, 2000, 650);
  s.run(
    "INSERT INTO billing_payments VALUES(?,?,?,?,?,?,?)",
    "opening-payment",
    f.actor.orgId,
    "opening",
    "manual",
    "opening-bank",
    500,
    "2026-10-08T12:00:00.000Z",
  );
  const r = f.app.billing.salesReport(f.actor, period);
  assert.equal(r.currencies[0]!.invoiceCount, 106);
  assert.equal(r.currencies[0]!.productNet, 10600);
  assert.equal(r.currencies[0]!.creditCount, 0);
  assert.equal(r.currencies[0]!.payments, 500);
  assert.equal(r.details.items.length, 100);
  assert.equal(r.details.truncated, true);
  assert.equal(r.details.items[0]!.origin, "opening");
  assert.equal(r.details.items[1]!.id, "line-105");
  assert.deepEqual(
    f.app.billing.salesReport(f.actor, period).details,
    r.details,
  );
});

test("HTTP sales report validates scope and dates, uses current identity and returns private no-store results", async (t) => {
  const f = fixture(t),
    p = seedCustomerPricing(f);
  invoice(f, "http");
  const origin = "https://sales.example.test",
    http = await createHttp(f.app, { origin });
  await http.ready();
  t.after(() => void http.close());
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: {
      email: "pricing-buyer@example.test",
      password: "long-test-only-password",
    },
  });
  const headers = {
      cookie: `${login.cookies[0]!.name}=${login.cookies[0]!.value}`,
    },
    url = "/api/reports/sales?from=2026-10-01&to=2026-10-31";
  const response = await http.inject({ url, headers });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers["cache-control"]!, /no-store/);
  assert.equal(response.json().accountId, f.buyer);
  assert.equal(
    (await http.inject({ url: url + "&accountId=" + p.other, headers }))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await http.inject({
        url: "/api/reports/sales?from=2026-02-30&to=2026-03-01",
        headers,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await http.inject({ url: "/api/reports/sales?from=2026-10-01", headers }))
      .statusCode,
    400,
  );
  assert.equal((await http.inject({ url })).statusCode, 401);
  const identity = f.app.database.owned("iam");
  identity.run("UPDATE iam_users SET role='warehouse' WHERE id=?", p.buyer.id);
  assert.throws(() => f.app.billing.salesReport(p.buyer, period), {
    code: "FORBIDDEN",
  });
});
