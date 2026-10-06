import { test } from "node:test";
import assert from "node:assert/strict";
import { createHttp } from "../src/server/http.ts";
import type { Role } from "../src/server/core.ts";
import { fixture } from "./fixtures.ts";
import { seedInvoiceQueue } from "./invoice-queue-fixture.ts";

function user(f: ReturnType<typeof fixture>, role: Role, accountId = f.buyer) {
  const row = f.app.identity.createUser(f.actor, `detail-${role}`, {
    email: `${role}@example.test`,
    name: role,
    password: "long-test-only-password",
    role,
    accountId: role === "buyer" ? accountId : undefined,
    sites: role === "buyer" ? [] : [f.w1],
  });
  return f.app.identity.currentActor({ ...f.actor, id: row.id });
}
function facts(f: ReturnType<typeof fixture>) {
  return ["invoices", "lines", "payments", "credits", "refunds"]
    .map((table) =>
      f.app.database
        .owned("billing")
        .all(`SELECT * FROM billing_${table} ORDER BY rowid`),
    )
    .concat(
      ["commands", "audit", "events"].map((table) =>
        f.app.database
          .owned("platform")
          .all(`SELECT * FROM platform_${table} ORDER BY rowid`),
      ),
    );
}
async function session(f: ReturnType<typeof fixture>, email: string) {
  const http = await createHttp(f.app, { origin: "http://localhost" });
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin: "http://localhost" },
    payload: { email, password: "long-test-only-password" },
  });
  assert.equal(login.statusCode, 200);
  const cookie = login.cookies[0]!;
  return { http, headers: { cookie: `${cookie.name}=${cookie.value}` } };
}

test("invoice detail returns the queue's current projection for one invoice without writes", (t) => {
  const f = fixture(t);
  seedInvoiceQueue(f, 3);
  const unpaid = f.app.billing.invoicePage(f.actor, { state: "unpaid" })
    .items[0]!;
  const ids = [undefined, unpaid.id];
  f.app.billing.manualPayment(f.actor, "detail-pay", {
    invoiceId: ids[1]!,
    amount: 4000,
    reference: "detail-paid",
    reason: "Synthetic bank evidence",
  });
  const before = facts(f),
    detail = f.app.billing.invoiceDetail(f.actor, ids[1]!),
    queued = f.app.billing
      .invoicePage(f.actor)
      .items.find((i) => i.id === ids[1]);
  assert.deepEqual(detail, queued);
  assert.equal(detail.paid, 4000);
  assert.equal(detail.balance, unpaid.balance - 4000);
  assert.equal(detail.lines.length, 1);
  assert.deepEqual(facts(f), before);
});

test("invoice detail follows current account custody and role scope", async (t) => {
  const f = fixture(t),
    own = seedInvoiceQueue(f, 1);
  const other = f.app.identity.createCustomer(f.actor, "detail-other", {
    name: "Other customer",
    tier: "standard",
    creditLimit: 0,
  }).id;
  const foreign = seedInvoiceQueue(f, 1, "detail-foreign", other);
  const buyer = user(f, "buyer"),
    warehouse = user(f, "warehouse");
  assert.equal(f.app.billing.invoiceDetail(buyer, own[0]!).id, own[0]);
  assert.throws(() => f.app.billing.invoiceDetail(buyer, foreign[0]!));
  assert.throws(() => f.app.billing.invoiceDetail(warehouse, own[0]!), {
    code: "FORBIDDEN",
  });
  const before = facts(f);
  const { http, headers } = await session(f, "buyer@example.test");
  try {
    const mine = await http.inject({
      method: "GET",
      url: `/api/billing/invoices/${own[0]}`,
      headers,
    });
    assert.equal(mine.statusCode, 200);
    assert.equal(mine.json().number, `SYNTHETIC-${own[0]}`);
    const theirs = await http.inject({
      method: "GET",
      url: `/api/billing/invoices/${foreign[0]}`,
      headers,
    });
    assert.ok([403, 404].includes(theirs.statusCode), theirs.body);
    assert.doesNotMatch(theirs.body, /SYNTHETIC-detail-foreign/);
    const missing = await http.inject({
      method: "GET",
      url: "/api/billing/invoices/no-such-invoice",
      headers,
    });
    assert.equal(missing.statusCode, 404);
    const oversized = await http.inject({
      method: "GET",
      url: `/api/billing/invoices/${"x".repeat(129)}`,
      headers,
    });
    assert.ok([400, 404].includes(oversized.statusCode), oversized.body);
    // The static queue route is not shadowed by the detail parameter.
    const page = await http.inject({
      method: "GET",
      url: "/api/billing/invoices/page",
      headers,
    });
    assert.equal(page.statusCode, 200);
    assert.ok(Array.isArray(page.json().items));
  } finally {
    await http.close();
  }
  const anonymous = await createHttp(f.app, { origin: "http://localhost" });
  try {
    const denied = await anonymous.inject({
      method: "GET",
      url: `/api/billing/invoices/${own[0]}`,
    });
    assert.equal(denied.statusCode, 401);
  } finally {
    await anonymous.close();
  }
  assert.deepEqual(
    facts(f).slice(0, 5),
    before.slice(0, 5),
    "detail reads never change billing facts",
  );
});
