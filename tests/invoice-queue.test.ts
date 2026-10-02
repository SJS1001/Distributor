import { test } from "node:test";
import assert from "node:assert/strict";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import { Store } from "../src/server/database.ts";
import { digest, type Actor, type Role, type Row } from "../src/server/core.ts";
import type { SQLInputValue } from "node:sqlite";
import { fixture, accept, ship } from "./fixtures.ts";
import { seedInvoiceQueue } from "./invoice-queue-fixture.ts";
const cursor = (id: string, state: string | null = null) =>
  Buffer.from(JSON.stringify([1, state, id])).toString("base64url");
function user(f: ReturnType<typeof fixture>, role: Role, accountId = f.buyer) {
  const row = f.app.identity.createUser(f.actor, `invoice-${role}`, {
    email: `${role}@example.test`,
    name: role,
    password: "long-test-only-password",
    role,
    accountId: role === "buyer" ? accountId : undefined,
    sites: role === "buyer" ? [] : [f.w1],
  });
  return f.app.identity.currentActor({ ...f.actor, id: row.id });
}
function change(
  f: ReturnType<typeof fixture>,
  actor: Actor,
  changes: Record<string, unknown>,
) {
  const row = f.app.identity.users(f.actor).find((u) => u.id === actor.id)!;
  f.app.identity.updateUser(f.actor, `change-${row.id}-${row.revision}`, {
    userId: actor.id,
    revision: row.revision,
    email: row.email,
    name: actor.name,
    role: actor.role,
    sites: actor.sites,
    accountId: actor.accountId ?? undefined,
    active: true,
    currentPassword: "long-test-only-password",
    reason: "Synthetic invoice scope change",
    ...changes,
  });
}
function facts(f: ReturnType<typeof fixture>) {
  return [
    "invoices",
    "lines",
    "payments",
    "credits",
    "credit_lines",
    "refunds",
    "opening_documents",
    "document_facts",
  ]
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
async function session(
  f: ReturnType<typeof fixture>,
  email = "admin@example.test",
) {
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
test("invoice dashboard bounds headers while its summary covers every current balance", (t) => {
  const f = fixture(t);
  seedInvoiceQueue(f);
  const before = facts(f),
    view = f.app.dashboard(f.actor);
  assert.equal(view.invoices.length, 20);
  assert.ok(view.invoiceNext);
  assert.deepEqual(view.invoiceSummary, {
    total: 45,
    unpaid: 15,
    settled: 15,
    credit: 15,
    due: 169500,
  });
  assert.notEqual(
    view.invoices.reduce((sum, row) => sum + Math.max(0, row.balance), 0),
    view.invoiceSummary.due,
  );
  assert.deepEqual(facts(f), before);
});
test("invoice traversal orders tied times, survives restart and excludes newer inserts from a continuation", (t) => {
  const f = fixture(t),
    ids = seedInvoiceQueue(f);
  const before = facts(f),
    first = f.app.billing.invoicePage(f.actor);
  assert.equal(first.next, cursor(ids[25]!));
  f.app.close();
  f.app = new Application(f.path, "CA");
  assert.deepEqual(f.app.billing.invoicePage(f.actor), first);
  assert.deepEqual(facts(f), before);
  seedInvoiceQueue(f, 1, "z-later");
  const second = f.app.billing.invoicePage(f.actor, { after: first.next! }),
    third = f.app.billing.invoicePage(f.actor, { after: second.next! });
  assert.equal(second.items.length, 20);
  assert.equal(third.items.length, 5);
  assert.equal(third.next, null);
  assert.deepEqual(
    [...first.items, ...second.items, ...third.items].map((i) => i.id),
    ids.reverse(),
  );
});
test("invoice filtering happens before its limit and only twenty headers receive lines and current totals", (t) => {
  const f = fixture(t);
  seedInvoiceQueue(f, 90);
  const before = facts(f),
    all = Store.prototype.all,
    queries: { sql: string; params: SQLInputValue[] }[] = [];
  Store.prototype.all = function <T extends Row = Row>(
    sql: string,
    ...params: SQLInputValue[]
  ): T[] {
    if (
      sql.includes("FROM billing_invoices") ||
      sql.includes("FROM billing_lines")
    )
      queries.push({ sql, params });
    return all.call(this, sql, ...params) as T[];
  };
  let page: ReturnType<typeof f.app.billing.invoicePage>;
  try {
    page = f.app.billing.invoicePage(f.actor, { state: "unpaid" });
  } finally {
    Store.prototype.all = all;
  }
  assert.equal(page!.items.length, 20);
  assert.ok(page!.items.every((i) => i.balance === 11300));
  const headers = queries.filter((q) =>
    q.sql.includes("FROM billing_invoices"),
  );
  assert.equal(headers.length, 1);
  assert.match(headers[0]!.sql, /WHERE balance>0.*LIMIT 21/);
  assert.deepEqual(
    queries
      .filter((q) => q.sql.includes("FROM billing_lines"))
      .map((q) => q.params.at(-1))
      .sort(),
    page!.items.map((i) => i.id).sort(),
  );
  assert.deepEqual(facts(f), before);
  const anchor = page!.items.at(-1)!;
  f.app.billing.manualPayment(f.actor, "settle-anchor", {
    invoiceId: anchor.id,
    amount: 11300,
    reference: "anchor-paid",
    reason: "Synthetic bank evidence",
  });
  const next = f.app.billing.invoicePage(f.actor, {
    after: page!.next!,
    state: "unpaid",
  });
  assert.equal(next.items.length, 10);
  assert.ok(next.items.every((i) => i.balance > 0));
  assert.throws(
    () =>
      f.app.billing.invoicePage(f.actor, {
        after: page!.next!,
        state: "credit",
      }),
    { code: "VALIDATION" },
  );
});
test("buyer invoice pages, summaries and off-page credit identity follow current account grants before materialization", (t) => {
  const f = fixture(t),
    buyer = user(f, "buyer"),
    own = seedInvoiceQueue(f);
  const other = f.app.identity.createCustomer(f.actor, "other", {
    name: "Other customer",
    tier: "standard",
    creditLimit: 0,
  }).id;
  seedInvoiceQueue(f, 80, "z-other", other);
  const first = f.app.billing.invoicePage(buyer);
  assert.equal(first.items.length, 20);
  assert.ok(first.items.every((i) => i.account_id === f.buyer));
  assert.equal(f.app.billing.invoiceSummary(buyer).total, 45);
  const credit = f.app.billing
    .credits(buyer)
    .find((c) => c.invoice_id === own[2])!;
  assert.equal(credit.invoice_number, `SYNTHETIC-${own[2]}`);
  assert.equal(credit.account_id, f.buyer);
  assert.equal(credit.currency, "CAD");
  assert.ok(!first.items.some((i) => i.id === credit.invoice_id));
  assert.throws(
    () => f.app.billing.invoicePage(buyer, { after: cursor("z-other-079") }),
    { code: "FORBIDDEN" },
  );
  change(f, buyer, { accountId: other });
  const before = facts(f);
  assert.throws(
    () => f.app.billing.invoicePage(buyer, { after: first.next! }),
    { code: "FORBIDDEN" },
  );
  assert.equal(f.app.billing.invoiceSummary(buyer).total, 80);
  f.app.close();
  f.app = new Application(f.path, "CA");
  assert.equal(f.app.billing.invoicePage(buyer).items[0]!.account_id, other);
  assert.deepEqual(facts(f), before);
});
test("invoice queue and summary deny forged, unavailable, demoted and password-restricted principals without financial effects", (t) => {
  const f = fixture(t),
    warehouse = user(f, "warehouse"),
    finance = user(f, "finance");
  seedInvoiceQueue(f);
  const before = facts(f);
  for (const actor of [
    { ...f.actor, id: "missing" },
    { ...warehouse, role: "admin" as const },
  ]) {
    assert.throws(() => f.app.billing.invoicePage(actor));
    assert.throws(() => f.app.billing.invoiceSummary(actor));
  }
  assert.deepEqual(facts(f), before);
  const independent = new Application(f.path, "CA");
  independent.database
    .owned("iam")
    .run("UPDATE iam_users SET role='warehouse' WHERE id=?", finance.id);
  independent.close();
  const demoted = facts(f);
  assert.throws(() => f.app.billing.invoicePage(finance), {
    code: "FORBIDDEN",
  });
  assert.throws(() => f.app.billing.invoiceSummary(finance), {
    code: "FORBIDDEN",
  });
  assert.deepEqual(facts(f), demoted);
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='finance' WHERE id=?", finance.id);
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
      finance.id,
    );
  const restricted = facts(f);
  assert.throws(() => f.app.billing.invoicePage(finance), {
    code: "PASSWORD_CHANGE_REQUIRED",
  });
  assert.throws(() => f.app.billing.invoiceSummary(finance), {
    code: "PASSWORD_CHANGE_REQUIRED",
  });
  assert.deepEqual(facts(f), restricted);
});
test("invoice balance filters include approved opening facts, native credits, payments and only completed refunds", (t) => {
  const f = fixture(t);
  const input = {
    version: 1 as const,
    batchRef: "QUEUE-OPENING",
    sourceRef: "SYNTHETIC-QUEUE",
    sourceHash: digest("Synthetic opening"),
    cutoffAt: "2026-09-01T00:00:00.000Z",
    region: "CA" as const,
    currency: "CAD" as const,
    expectedQuantity: 1,
    expectedValue: 13600,
    expectedNet: 30000,
    expectedTax: 3900,
    expectedCredited: 11300,
    expectedPaid: 10000,
    expectedRefunded: 1000,
    acknowledgment: "Synthetic frozen original balances reviewed",
    rows: [
      {
        sourceId: "opening",
        accountId: f.buyer,
        number: "OPENING-QUEUE",
        issuedAt: "2026-08-01T00:00:00.000Z",
        dueAt: "2026-08-31T00:00:00.000Z",
        net: 30000,
        tax: 3900,
        total: 33900,
        credited: 11300,
        paid: 10000,
        refunded: 1000,
        balance: 13600,
        lines: [
          {
            productId: f.product,
            description: "Historical equipment",
            quantity: 3,
            unitPrice: 10000,
            unitTax: 1300,
            creditedQuantity: 1,
          },
        ],
      },
    ],
  };
  const batch = f.app.migration.documents.preview(
    f.actor,
    "queue-preview",
    input,
  );
  f.app.migration.documents.decide(f.actor, "queue-approve", {
    batchId: batch.id,
    reviewHash: batch.reviewHash,
    decision: "approve",
    reason: "Independent synthetic source and control review",
  });
  const invoice = f.app.billing.invoicePage(f.actor).items[0]!;
  assert.equal(invoice.origin, "opening");
  assert.equal(invoice.balance, 13600);
  f.app.billing.manualPayment(f.actor, "opening-settle", {
    invoiceId: invoice.id,
    amount: 13600,
    reference: "new-cash",
    reason: "Verified synthetic new cash",
  });
  f.app.billing.issueCredit(f.actor, "opening-credit", {
    invoiceId: invoice.id,
    reference: "new-credit",
    reason: "Synthetic unit credit",
    lines: [{ lineId: invoice.lines[0]!.id, quantity: 1 }],
  });
  assert.equal(
    f.app.billing.invoicePage(f.actor, { state: "credit" }).items[0]!.balance,
    -11300,
  );
  const payment = f.app.database
    .owned("billing")
    .get("SELECT id FROM billing_payments WHERE invoice_id=?", invoice.id)!;
  const store = f.app.database.owned("billing");
  for (const [index, state] of [
    "pending",
    "unknown",
    "rejected",
    "completed",
  ].entries())
    store.run(
      "INSERT INTO billing_refunds VALUES(?,?,?,?,?,?,?,?)",
      `refund-${index}`,
      f.actor.orgId,
      invoice.id,
      payment.id!,
      11300,
      `ref-${index}`,
      state,
      "2026-10-02T00:00:00.000Z",
    );
  assert.equal(
    f.app.billing.invoicePage(f.actor, { state: "settled" }).items[0]!.balance,
    0,
  );
  assert.deepEqual(f.app.billing.invoiceSummary(f.actor), {
    total: 1,
    unpaid: 0,
    settled: 1,
    credit: 0,
    due: 0,
  });
  for (const state of ["unpaid", "credit"] as const)
    assert.deepEqual(f.app.billing.invoicePage(f.actor, { state }), {
      items: [],
      next: null,
    });
  assert.deepEqual(
    f.app.billing.invoicePage(f.actor).items.map((i) => i.balance),
    f.app.billing.invoices(f.actor).map((i) => i.balance),
  );
});
test("loaded older native invoices retain exact manual-payment retries and immutable original line amounts", (t) => {
  const f = fixture(t),
    nativeId = ship(f, accept(f).id).invoiceId;
  f.app.database
    .owned("billing")
    .run(
      "UPDATE billing_invoices SET created_at='2000-01-01T00:00:00.000Z' WHERE id=?",
      nativeId,
    );
  seedInvoiceQueue(f);
  let page = f.app.billing.invoicePage(f.actor);
  while (page.next)
    page = f.app.billing.invoicePage(f.actor, { after: page.next });
  const invoice = page.items.find((i) => i.id === nativeId)!;
  assert.equal(invoice.lines[0]!.unit_price, 10000);
  const input = {
    invoiceId: invoice.id,
    amount: invoice.balance,
    reference: "oldest-cash",
    reason: "Synthetic exact bank evidence",
  };
  const result = f.app.billing.manualPayment(f.actor, "oldest-pay", input),
    before = facts(f);
  assert.deepEqual(
    f.app.billing.manualPayment(f.actor, "oldest-pay", input),
    result,
  );
  assert.deepEqual(facts(f), before);
  assert.equal(
    f.app.billing
      .invoicePage(f.actor, { state: "settled" })
      .items.find((i) => i.id === invoice.id)!.balance,
    0,
  );
});
test("invoice HTTP queue validates state, cursor and unknown fields and refreshes read-session authority", async (t) => {
  const f = fixture(t),
    finance = user(f, "finance");
  seedInvoiceQueue(f);
  const { http, headers } = await session(f, "finance@example.test");
  t.after(() => http.close());
  const path = "/api/billing/invoices/page";
  const first = await http.inject({ method: "GET", url: path, headers });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().items.length, 20);
  assert.match(first.headers["cache-control"]!, /no-store/);
  for (const query of [
    "?state=paid",
    "?state=",
    "?after=",
    "?after=" + "a".repeat(513),
    "?after=invalid",
    "?after=" + cursor("missing"),
    "?limit=900",
    "?accountId=other",
    "?unknown=1",
  ])
    assert.ok(
      [400, 404].includes(
        (await http.inject({ method: "GET", url: path + query, headers }))
          .statusCode,
      ),
      query,
    );
  for (const after of [
    cursor("missing", "unpaid"),
    Buffer.from('[2,null,"missing"]').toString("base64url"),
    Buffer.from("{}").toString("base64url"),
  ])
    assert.throws(() => f.app.billing.invoicePage(finance, { after }), {
      code: "VALIDATION",
    });
  change(f, finance, { active: false });
  assert.equal(
    (
      await http.inject({
        method: "GET",
        url: path + "?after=" + first.json().next,
        headers,
      })
    ).statusCode,
    401,
  );
});

test("invoice pages keep an unassigned buyer empty and ignore stale supplied negative roles for currently authorized finance", (t) => {
  const f = fixture(t),
    buyer = user(f, "buyer"),
    finance = user(f, "finance");
  seedInvoiceQueue(f);
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET account_id=NULL WHERE id=?", buyer.id);
  const before = facts(f);
  assert.deepEqual(
    f.app.billing.invoicePage({ ...buyer, role: "admin", accountId: f.buyer }),
    { items: [], next: null },
  );
  assert.deepEqual(f.app.billing.invoiceSummary(buyer), {
    total: 0,
    unpaid: 0,
    settled: 0,
    credit: 0,
    due: 0,
  });
  assert.equal(
    f.app.billing.invoicePage({ ...finance, role: "warehouse" }).items.length,
    20,
  );
  assert.equal(
    f.app.billing.invoiceSummary({ ...finance, role: "warehouse" }).total,
    45,
  );
  assert.deepEqual(facts(f), before);
});
