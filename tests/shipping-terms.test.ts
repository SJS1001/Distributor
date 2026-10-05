import { test } from "node:test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import assert from "node:assert/strict";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import { chooseProviders, fixture, ship } from "./fixtures.ts";
import { seedCustomerPricing } from "./customer-pricing-fixture.ts";
type F = ReturnType<typeof fixture>;
function cart(f: F, quantity = 2) {
  return f.app.orders.saveCart(f.actor, `cart-${quantity}`, {
    accountId: f.buyer,
    warehouseId: f.w1,
    revision: 0,
    lines: [{ productId: f.product, quantity }],
  });
}
function terms(
  f: F,
  c: ReturnType<typeof cart>,
  treatment: "extra" | "included" | "unspecified" = "extra",
  key = "shipping",
) {
  return f.app.orders.setCartShipping(f.actor, key, {
    cartId: c.id,
    cartRevision: c.revision,
    treatment,
    net: treatment === "extra" ? 701 : 0,
    tax: treatment === "extra" ? 37 : 0,
    reason: "Reviewed explicit freight tax evidence",
  });
}
function order(f: F, c: ReturnType<typeof cart>) {
  const q = f.app.orders.quote(f.actor, "quote", {
    cartId: c.id,
    revision: c.revision,
  });
  const o = f.app.orders.accept(f.actor, "order", {
    quoteId: q.id,
    allowBackorder: false,
  });
  return { q, o };
}
function partial(f: F, orderId: string, key: string) {
  const p = f.app.fulfillment
    .picks(f.actor, orderId)
    .find((p) => p.quantity > p.consumed + p.released)!;
  f.app.fulfillment.pick(f.actor, key + "pick", {
    orderId,
    allocationId: p.id,
    serial: p.serial,
  });
  const packed = f.app.fulfillment.pack(f.actor, key + "pack", {
    orderId,
    revision: f.app.orders.order(f.actor, orderId).revision,
    mode: "collection",
    address: "Synthetic counter",
    lines: [{ allocationId: p.id, quantity: 1 }],
  });
  const input = {
    shipmentId: packed.id,
    handoverEvidence: "Synthetic handover",
  };
  const result = f.app.fulfillment.commit(f.actor, key + "ship", input);
  assert.deepEqual(
    f.app.fulfillment.commit(f.actor, key + "ship", input),
    result,
  );
  return result;
}
for (const region of ["CA", "US"] as const)
  test(`explicit shipping is held and charged once across partial shipment restart/retry, credit and documents (${region})`, (t) => {
    const f = fixture(t, {}, region),
      c = cart(f);
    terms(f, c);
    const { q, o } = order(f, c);
    assert.equal(q.total, 23338);
    assert.equal(q.shipping.tax, 37);
    assert.equal(f.app.billing.exposure(f.actor, f.buyer).total, 23338);
    const first = partial(f, o.id, "first");
    const inv = f.app.billing.invoice(f.actor, first.invoiceId);
    assert.equal(inv.total, 12038);
    assert.equal(inv.shipping?.charged, true);
    const freight = f.app.billing
      .lines(f.actor, inv.id)
      .find((l) => l.kind === "shipping")!;
    assert.equal(freight.unit_tax, 37);
    assert.equal(f.app.billing.exposure(f.actor, f.buyer).total, 23338);
    assert.deepEqual(
      f.app.billing.documents.facts(f.actor, "invoice", inv.id)!.facts.shipping,
      inv.shipping,
    );
    f.app.close();
    f.app = new Application(f.path, region);
    const second = partial(f, o.id, "second"),
      secondInvoice = f.app.billing.invoice(f.actor, second.invoiceId);
    assert.equal(secondInvoice.total, 11300);
    assert.equal(secondInvoice.shipping?.charged, false);
    assert.equal(
      f.app.billing
        .lines(f.actor, secondInvoice.id)
        .filter((l) => l.kind === "shipping").length,
      0,
    );
    assert.equal(f.app.reconciliation(f.actor).sales.issues.count, 0);
    const input = {
      invoiceId: inv.id,
      reference: "FREIGHT-REFUND",
      reason: "Refund agreed freight",
      lines: [{ lineId: freight.id, quantity: 1 }],
    };
    const credit = f.app.billing.issueCredit(f.actor, "freight-credit", input);
    assert.deepEqual(
      f.app.billing.issueCredit(f.actor, "freight-credit", input),
      credit,
    );
    assert.equal(f.app.billing.totals(f.actor, inv.id).credited, 738);
    assert.equal(f.app.billing.exposure(f.actor, f.buyer).total, 22600);
    assert.equal(
      f.app.billing.documents.facts(f.actor, "credit", credit.id)!.facts
        .shipping?.net,
      701,
    );
    assert.throws(() =>
      f.app.billing.issueCredit(f.actor, "duplicate-credit", {
        ...input,
        reference: "SECOND",
      }),
    );
    assert.equal(f.app.orders.shipping(f.actor, o.id).net, 701);
  });
test("included and historical unspecified terms never create fabricated charge lines", (t) => {
  for (const treatment of ["included", "unspecified"] as const) {
    const f = fixture(t),
      c = cart(f, 1);
    if (treatment === "included") terms(f, c, treatment);
    const { q, o } = order(f, c);
    assert.equal(q.shipping.treatment, treatment);
    assert.equal(q.total, 11300);
    const shipped = ship(f, o.id),
      i = f.app.billing.invoice(f.actor, shipped.invoiceId);
    assert.equal(i.total, 11300);
    assert.equal(i.shipping?.treatment, treatment);
    assert.equal(i.shipping?.charged, false);
  }
});
test("unchanged saved cart preserves reviewed terms, changes invalidate quotes and need review", (t) => {
  const f = fixture(t),
    c = cart(f);
  terms(f, c);
  const same = f.app.orders.saveCart(f.actor, "same", {
    accountId: f.buyer,
    warehouseId: f.w1,
    revision: c.revision,
    lines: [{ productId: f.product, quantity: 2 }],
  });
  assert.equal(
    f.app.orders.cartShipping(f.actor, c.id).shipping.treatment,
    "extra",
  );
  const q = f.app.orders.quote(f.actor, "q", {
    cartId: c.id,
    revision: same.revision,
  });
  terms(f, same, "included", "changed");
  assert.throws(
    () =>
      f.app.orders.accept(f.actor, "stale", {
        quoteId: q.id,
        allowBackorder: false,
      }),
    { code: "SHIPPING_CHANGED" },
  );
  f.app.orders.saveCart(f.actor, "different", {
    accountId: f.buyer,
    warehouseId: f.w1,
    revision: same.revision,
    lines: [{ productId: f.product, quantity: 3 }],
  });
  assert.equal(
    f.app.orders.cartShipping(f.actor, c.id).shipping.treatment,
    "unspecified",
  );
});
test("full pre-shipment cancel releases freight; cancel after first shipment retains charge; canceled-only amendment releases hold", (t) => {
  for (const mode of ["cancel", "amend", "after-shipment"]) {
    const f = fixture(t),
      c = cart(f);
    terms(f, c);
    const { o } = order(f, c);
    if (mode === "after-shipment") partial(f, o.id, "first");
    let current = f.app.orders.order(f.actor, o.id),
      line = f.app.orders.lines(f.actor, o.id)[0]!;
    f.app.orders.cancel(f.actor, "cancel", {
      orderId: o.id,
      lineId: line.id,
      quantity: mode === "cancel" ? 2 : 1,
      revision: current.revision,
      reason: "Synthetic cancel",
    });
    if (mode === "amend") {
      current = f.app.orders.order(f.actor, o.id);
      f.app.orders.amend(f.actor, "amend", {
        orderId: o.id,
        lineId: line.id,
        quantity: 1,
        revision: current.revision,
        reason: "Remove last unshipped unit",
        allowBackorder: false,
      });
    }
    assert.equal(
      f.app.billing.exposure(f.actor, f.buyer).total,
      mode === "after-shipment" ? 12038 : 0,
    );
    assert.equal(f.app.orders.shipping(f.actor, o.id).net, 701);
  }
});
test("HTTP shipping is explicit, staff managed, scoped, strict and idempotent", async (t) => {
  const f = fixture(t),
    p = seedCustomerPricing(f),
    c = cart(f),
    origin = "https://shipping.example.test",
    http = await createHttp(f.app, { origin });
  await http.ready();
  t.after(() => void http.close());
  async function login(email: string) {
    const r = await http.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: { email, password: "long-test-only-password" },
    });
    assert.equal(r.statusCode, 200);
    return {
      origin,
      cookie: `${r.cookies[0]!.name}=${r.cookies[0]!.value}`,
      "x-csrf-token": r.json().csrf as string,
    };
  }
  const admin = await login("admin@example.test"),
    buyer = await login("pricing-buyer@example.test"),
    other = await login("pricing-partner@example.test");
  const payload = {
    cartId: c.id,
    cartRevision: c.revision,
    treatment: "extra",
    net: 701,
    tax: 37,
    reason: "Explicit reviewed freight tax",
  };
  const command = (
    headers: typeof admin,
    key: string,
    value: Record<string, unknown> = payload,
  ) =>
    http.inject({
      method: "POST",
      url: "/api/commands/cart.shipping.set",
      headers: { ...headers, "idempotency-key": key },
      payload: value,
    });
  assert.equal((await command(buyer, "forbidden")).statusCode, 403);
  assert.equal(
    (await http.inject({ url: `/api/carts/${c.id}/shipping`, headers: other }))
      .statusCode,
    403,
  );
  assert.equal(
    (await command(admin, "unknown", { ...payload, unitPrice: 1 })).statusCode,
    400,
  );
  assert.equal(
    (await command(admin, "invalid", { ...payload, treatment: "included" }))
      .statusCode,
    400,
  );
  const a = await command(admin, "saved"),
    b = await command(admin, "saved");
  assert.equal(a.statusCode, 200);
  assert.deepEqual(a.json(), b.json());
  const read = await http.inject({
    url: `/api/carts/${c.id}/shipping`,
    headers: buyer,
  });
  assert.equal(read.json().shipping.tax, 37);
  assert.throws(() => f.app.orders.cartShipping(p.partner, c.id), {
    code: "FORBIDDEN",
  });
});

test("shipping PDFs and queued accounting retain explicit freight amounts and require its own mapping", async (t) => {
  const f = fixture(t),
    c = cart(f, 1);
  terms(f, c);
  const { o } = order(f, c),
    sent = ship(f, o.id);
  const invoice = f.app.billing.invoice(f.actor, sent.invoiceId),
    lines = f.app.billing.lines(f.actor, invoice.id),
    freight = lines.find((l) => l.kind === "shipping")!;
  const rendered = await f.app.billing.documents.download(
    f.actor,
    "shipping-pdf",
    "invoice",
    invoice.id,
  );
  const task = getDocument({
      data: new Uint8Array(rendered.bytes),
      useSystemFonts: false,
    }),
    pdf = await task.promise;
  const words: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p),
      content = await page.getTextContent();
    words.push(...content.items.flatMap((i) => ("str" in i ? [i.str] : [])));
  }
  await task.destroy();
  const content = words.join(" ");
  assert.match(content, /Shipping extra: CAD 7.01/);
  assert.match(content, /CAD 0.37 explicit shipping tax/);
  assert.match(content, /Agreed shipping charge/);
  chooseProviders(f, f.actor, "qb-choice", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["quickbooks"],
    version: 1,
    acknowledgment: "Synthetic reviewed customer exception",
  });
  const input = {
    invoiceId: invoice.id,
    customerRef: "customer",
    itemRefs: { [f.product]: "product-item" },
    taxCodeRef: "reviewed-code",
    taxRateRef: "reviewed-rate",
  };
  assert.throws(
    () => f.app.integration.accounting(f.actor, "missing-freight-map", input),
    { code: "VALIDATION" },
  );
  const queued = f.app.integration.accounting(f.actor, "mapped-freight", {
    ...input,
    itemRefs: {
      ...input.itemRefs,
      [freight.product_id]: "freight-service-item",
    },
  });
  const payload = JSON.parse(
    f.app.integration.effect(f.actor, queued.id).payload,
  );
  assert.equal(payload.lines.length, 2);
  assert.equal(payload.lines[1].itemRef, "freight-service-item");
  assert.equal(payload.lines[1].unitPrice, 701);
  assert.equal(payload.lines[1].unitTax, 37);
  assert.equal(payload.invoice.total, 12038);
});
