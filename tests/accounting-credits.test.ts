import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { fixture, accept, ship } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { QuickBooksAdapter } from "../src/server/providers.ts";
import { createHttp } from "../src/server/http.ts";
import type {
  AccountingCreditIntent,
  EffectResult,
} from "../src/server/integration.ts";

async function setup(t: Parameters<typeof fixture>[0]) {
  const f = fixture(t),
    invoiceId = ship(f, accept(f, 2).id).invoiceId;
  f.app.identity.residencyChoice(f.actor, "consent", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["quickbooks"],
    version: 1,
    acknowledgment: "Synthetic consent",
  });
  const parent = f.app.integration.accounting(f.actor, "invoice", {
    invoiceId,
    customerRef: "customer-1",
    itemRefs: { [f.product]: "item-1" },
    taxCodeRef: "tax-1",
    taxRateRef: "rate-1",
  });
  await f.app.integration.execute(f.actor, parent.id, {
    execute: async () => ({ reference: "invoice-1", result: {} }),
    lookup: async () => null,
  });
  const line = f.app.billing.lines(f.actor, invoiceId)[0]!;
  const credit = f.app.billing.issueCredit(f.actor, "credit", {
    invoiceId,
    reference: "PRIVATE-REFERENCE",
    reason: "Private finance reason",
    lines: [{ lineId: line.id, quantity: 1 }],
  });
  return Object.assign(f, {
    invoiceId,
    creditId: credit.id,
    parent,
    input: { creditId: credit.id },
  });
}
function facts(f: Awaited<ReturnType<typeof setup>>) {
  return {
    stock: f.app.inventory.stock(f.actor),
    invoices: f.app.billing.invoices(f.actor),
    credits: f.app.billing.credits(f.actor),
    payments: f.app.billing.refunds.payments(f.actor),
    totals: f.app.billing.totals(f.actor, f.invoiceId),
  };
}
const result: EffectResult = {
  reference: "credit:credit-1",
  result: { total: 11300, currency: "CAD", unappliedAmount: 11300 },
};

test("credit handoff freezes partial original money/mappings, survives restart and reconciles a lost response without native mutations", async (t) => {
  const f = await setup(t),
    before = facts(f),
    queued = f.app.integration.accountingCredit(f.actor, "queue", f.input);
  const p = JSON.parse(
    f.app.integration.effect(f.actor, queued.id).payload,
  ) as AccountingCreditIntent;
  assert.equal(p.invoice.total, 22600);
  assert.equal(p.credit.total, 11300);
  assert.equal(p.credit.tax, 1300);
  assert.equal(p.lines[0]!.quantity, 1);
  assert.equal(p.lines[0]!.unitPrice, 10000);
  assert.equal(p.lines[0]!.unitTax, 1300);
  assert.equal(p.lines[0]!.itemRef, "item-1");
  assert.equal(p.externalInvoiceRef, "invoice-1");
  assert.equal(p.customerRef, "customer-1");
  assert.ok(!JSON.stringify(p).includes("Private finance reason"));
  assert.ok(!JSON.stringify(p).includes("PRIVATE-REFERENCE"));
  assert.deepEqual(
    f.app.integration.accountingCredit(f.actor, "another-key", f.input),
    queued,
  );
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(
    f.app.integration.accountingCredit(f.actor, "queue", f.input),
    queued,
  );
  let sends = 0;
  const adapter = {
    execute: async () => {
      sends++;
      throw Error("Lost synthetic response");
    },
    lookup: async () => result,
  };
  assert.equal(
    (await f.app.integration.execute(f.actor, queued.id, adapter)).state,
    "unknown",
  );
  await assert.rejects(f.app.integration.execute(f.actor, queued.id, adapter), {
    code: "STATE",
  });
  assert.equal(
    (await f.app.integration.reconcile(f.actor, queued.id, adapter)).state,
    "completed",
  );
  assert.equal(sends, 1);
  assert.deepEqual(facts(f), before);
});

test("credit queue rechecks current authority/consent/restore before cached receipts and hides internal operations from buyers/commercial", async (t) => {
  const f = await setup(t),
    queued = f.app.integration.accountingCredit(f.actor, "queue", f.input),
    iam = f.app.database.owned("iam");
  for (const role of ["commercial", "buyer", "support"]) {
    iam.run(
      "UPDATE iam_users SET role=?,account_id=? WHERE id=?",
      role,
      role === "buyer" ? f.buyer : null,
      f.actor.id,
    );
    assert.throws(
      () => f.app.integration.accountingCredit(f.actor, "queue", f.input),
      { code: "FORBIDDEN" },
    );
    const list = f.app.integration.list(f.app.identity.currentActor(f.actor));
    assert.equal(
      list.some((e) => e.id === queued.id),
      role === "support",
    );
  }
  iam.run(
    "UPDATE iam_users SET role='admin',account_id=NULL,active=0 WHERE id=?",
    f.actor.id,
  );
  assert.throws(
    () => f.app.integration.accountingCredit(f.actor, "queue", f.input),
    { code: "FORBIDDEN" },
  );
  iam.run("UPDATE iam_users SET active=1 WHERE id=?", f.actor.id);
  iam.run(
    "INSERT INTO iam_user_security(user_id,revision,password_change_required,updated_at) VALUES(?,1,1,?)",
    f.actor.id,
    new Date().toISOString(),
  );
  assert.throws(
    () => f.app.integration.accountingCredit(f.actor, "queue", f.input),
    { code: "PASSWORD_CHANGE_REQUIRED" },
  );
  iam.run(
    "UPDATE iam_user_security SET password_change_required=0 WHERE user_id=?",
    f.actor.id,
  );
  f.app.identity.residencyChoice(f.actor, "withdraw", {
    accountId: f.buyer,
    region: "CA",
    mode: "strict",
    providers: [],
    version: 2,
    acknowledgment: "Synthetic withdrawal",
  });
  assert.throws(
    () => f.app.integration.accountingCredit(f.actor, "queue", f.input),
    { code: "RESIDENCY_BLOCKED" },
  );
  f.app.identity.residencyChoice(f.actor, "restore-choice", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["quickbooks"],
    version: 3,
    acknowledgment: "Synthetic reconsent",
  });
  f.app.platform.isolateRestore("Synthetic", new Date().toISOString());
  assert.throws(
    () => f.app.integration.accountingCredit(f.actor, "queue", f.input),
    { code: "RECOVERY_HOLD" },
  );
});

test("credits require a completed parent and exact original mappings; corrupted credit totals fail closed", async (t) => {
  const f = await setup(t),
    store = f.app.database.owned("integration"),
    billing = f.app.database.owned("billing");
  store.run(
    "UPDATE integration_effects SET state='unknown' WHERE id=?",
    f.parent.id,
  );
  assert.throws(
    () => f.app.integration.accountingCredit(f.actor, "queue", f.input),
    { code: "ACCOUNTING_INVOICE_REQUIRED" },
  );
  store.run(
    "UPDATE integration_effects SET state='completed' WHERE id=?",
    f.parent.id,
  );
  const p = JSON.parse(f.app.integration.effect(f.actor, f.parent.id).payload);
  p.lines[0].unitPrice++;
  store.run(
    "UPDATE integration_effects SET payload=? WHERE id=?",
    JSON.stringify(p),
    f.parent.id,
  );
  assert.throws(
    () => f.app.integration.accountingCredit(f.actor, "queue", f.input),
    { code: "ACCOUNTING_CREDIT_MISMATCH" },
  );
  p.lines[0].unitPrice--;
  store.run(
    "UPDATE integration_effects SET payload=? WHERE id=?",
    JSON.stringify(p),
    f.parent.id,
  );
  billing.run(
    "UPDATE billing_credits SET net=net+1,total=total+1 WHERE id=?",
    f.creditId,
  );
  assert.throws(
    () => f.app.integration.accountingCredit(f.actor, "queue", f.input),
    { code: "ACCOUNTING_CREDIT_MISMATCH" },
  );
  assert.equal(
    f.app.integration.list(f.actor).filter((e) => e.kind === "credit").length,
    0,
  );
});

test("late audit failure rolls credit intent and command receipt back atomically", async (t) => {
  const f = await setup(t),
    before = facts(f),
    audit = t.mock.method(f.app.platform, "audit", () => {
      throw Error("Late synthetic audit failure");
    });
  assert.throws(
    () => f.app.integration.accountingCredit(f.actor, "queue", f.input),
    /audit failure/,
  );
  audit.mock.restore();
  assert.equal(
    f.app.integration.list(f.actor).filter((e) => e.kind === "credit").length,
    0,
  );
  assert.equal(
    f.app.integration.accountingCredit(f.actor, "queue", f.input).state,
    "pending",
  );
  assert.deepEqual(facts(f), before);
});

async function providerFixture(
  t: Parameters<typeof fixture>[0] & { mock: any },
) {
  const f = await setup(t),
    queued = f.app.integration.accountingCredit(f.actor, "queue", f.input),
    effect = f.app.integration.effect(f.actor, queued.id),
    p = JSON.parse(effect.payload) as AccountingCreditIntent;
  const invoice = {
    Id: "invoice-1",
    DocNumber: p.invoice.number,
    TotalAmt: 226,
    CustomerRef: { value: p.customerRef },
    CurrencyRef: { value: "CAD" },
    PrivateNote: `Distributor effect ${p.invoiceEffectId}`,
  };
  const credit = {
    Id: "credit-1",
    DocNumber: p.credit.number,
    TxnDate: p.credit.created_at.slice(0, 10),
    TotalAmt: 113,
    RemainingCredit: 113,
    CustomerRef: { value: p.customerRef },
    CurrencyRef: { value: "CAD" },
    PrivateNote: `Distributor effect ${effect.id}`,
    Line: [
      {
        Amount: 100,
        DetailType: "SalesItemLineDetail",
        SalesItemLineDetail: {
          ItemRef: { value: "item-1" },
          Qty: 1,
          UnitPrice: 100,
          TaxCodeRef: { value: "tax-1" },
        },
      },
      { Amount: 100, DetailType: "SubTotalLineDetail" },
    ],
    TxnTaxDetail: {
      TotalTax: 13,
      TaxLine: [
        {
          Amount: 13,
          DetailType: "TaxLineDetail",
          TaxLineDetail: {
            TaxRateRef: { value: "rate-1" },
            NetAmountTaxable: 100,
          },
        },
      ],
    },
  };
  const responses: {
    invoice: any;
    credit: any;
    preferences: any;
    rows: any[];
  } = {
    invoice,
    credit,
    preferences: { SalesFormsPrefs: { AutoApplyCredit: false } },
    rows: [credit],
  };
  const fetch = t.mock.method(
    globalThis,
    "fetch",
    async (url: string | URL | Request, init?: RequestInit) =>
      new Response(
        JSON.stringify(
          String(url).includes("/preferences")
            ? { Preferences: responses.preferences }
            : String(url).includes("/query?")
              ? { QueryResponse: { CreditMemo: responses.rows } }
              : init?.method === "POST"
                ? { CreditMemo: responses.credit }
                : { Invoice: responses.invoice },
        ),
        { status: 200 },
      ),
  );
  return {
    f,
    effect,
    p,
    invoice,
    credit,
    responses,
    fetch,
    qbo: new QuickBooksAdapter("12345", async () => "synthetic-token", true),
  };
}

test("sandbox credit adapter reads automation/parent then posts minimal exact original lines and tax", async (t) => {
  const f = await providerFixture(t),
    sent = await f.qbo.execute(f.effect);
  assert.equal(sent.reference, "credit:credit-1");
  assert.equal(sent.result.unappliedAmount, 11300);
  const calls = f.fetch.mock.calls;
  assert.equal(calls.length, 3);
  const [url, init] = calls[2].arguments;
  assert.equal(
    new URL(String(url)).hostname,
    "sandbox-quickbooks.api.intuit.com",
  );
  assert.equal(new URL(String(url)).searchParams.get("requestid"), f.effect.id);
  const body = JSON.parse(String(init.body));
  assert.deepEqual(
    body.Line,
    f.credit.Line.slice(0, 1).map((l) => ({
      ...l,
      Description: f.p.lines[0]!.description,
    })),
  );
  assert.deepEqual(body.TxnTaxDetail, f.credit.TxnTaxDetail);
  assert.equal(body.TxnDate, f.p.credit.created_at.slice(0, 10));
  assert.ok(!JSON.stringify(body).includes("PRIVATE-REFERENCE"));
  assert.ok(!JSON.stringify(body).includes("Private finance reason"));
  assert.equal(body.LinkedTxn, undefined);
  assert.equal(body.CreditCardPayment, undefined);
  const before = calls.length;
  const disabled = new QuickBooksAdapter("12345", async () => {
    throw Error("Token must not be read");
  });
  await assert.rejects(disabled.execute(f.effect), {
    code: "PROVIDER_DISABLED",
  });
  await assert.rejects(disabled.lookup(f.effect), {
    code: "PROVIDER_DISABLED",
  });
  assert.equal(calls.length, before);
});

test("credit preflight refuses unknown/enabled auto-application and altered parent without a POST", async (t) => {
  const f = await providerFixture(t);
  for (const preferences of [
    {},
    { SalesFormsPrefs: {} },
    { SalesFormsPrefs: { AutoApplyCredit: true } },
  ]) {
    f.responses.preferences = preferences;
    await assert.rejects(f.qbo.execute(f.effect), {
      code: "ACCOUNTING_CREDIT_AUTOMATION",
    });
  }
  f.responses.preferences = { SalesFormsPrefs: { AutoApplyCredit: false } };
  for (const change of [
    { Id: "other" },
    { PrivateNote: "other" },
    { TotalAmt: 226.001 },
    { CustomerRef: { value: "other" } },
    { CurrencyRef: { value: "USD" } },
  ]) {
    f.responses.invoice = { ...f.invoice, ...change };
    await assert.rejects(f.qbo.execute(f.effect), {
      code: "ACCOUNTING_INVOICE_MISMATCH",
    });
  }
  assert.ok(
    f.fetch.mock.calls.every((c: any) => c.arguments[1]?.method !== "POST"),
  );
});

test("credit auto-application racing creation retains an unknown outcome and cannot trigger another send", async (t) => {
  const f = await providerFixture(t),
    before = facts(f.f);
  f.responses.credit = { ...f.credit, RemainingCredit: 100 };
  const sent = await f.f.app.integration.execute(f.f.actor, f.effect.id, f.qbo);
  assert.equal(sent.state, "unknown");
  await assert.rejects(
    f.f.app.integration.execute(f.f.actor, f.effect.id, f.qbo),
    { code: "STATE" },
  );
  assert.equal(
    f.fetch.mock.calls.filter(
      (c: { arguments: [unknown, RequestInit?] }) =>
        c.arguments[1]?.method === "POST",
    ).length,
    1,
  );
  f.responses.rows = [f.responses.credit];
  await assert.rejects(
    f.f.app.integration.reconcile(f.f.actor, f.effect.id, f.qbo),
    { code: "ACCOUNTING_MISMATCH" },
  );
  assert.equal(
    f.f.app.integration.effect(f.f.actor, f.effect.id).state,
    "unknown",
  );
  assert.deepEqual(facts(f.f), before);
});

test("credit reconciliation rejects duplicate/substituted/applied/tax-adjusted documents; absence never permits resend", async (t) => {
  const f = await providerFixture(t);
  assert.equal((await f.qbo.lookup(f.effect))!.reference, "credit:credit-1");
  assert.match(
    new URL(String(f.fetch.mock.calls[0].arguments[0])).searchParams.get(
      "query",
    )!,
    /CreditMemo.*maxresults 2/,
  );
  const wrongLine = structuredClone(f.credit.Line);
  wrongLine[0]!.SalesItemLineDetail!.Qty = 2;
  const wrongTax = structuredClone(f.credit.TxnTaxDetail);
  wrongTax.TaxLine[0]!.TaxLineDetail.TaxRateRef.value = "other";
  for (const change of [
    { Id: "" },
    { DocNumber: "wrong" },
    { PrivateNote: "foreign" },
    { TotalAmt: 113.001 },
    { RemainingCredit: 100 },
    { TxnDate: "2000-01-01" },
    { CustomerRef: { value: "other" } },
    { CurrencyRef: { value: "USD" } },
    { LinkedTxn: [{ TxnId: "another-invoice", TxnType: "Payment" }] },
    { Line: wrongLine },
    {
      Line: [...f.credit.Line, { Amount: 1, DetailType: "DiscountLineDetail" }],
    },
    { TxnTaxDetail: wrongTax },
  ]) {
    f.responses.rows = [{ ...f.credit, ...change }];
    await assert.rejects(f.qbo.lookup(f.effect), {
      code: "ACCOUNTING_MISMATCH",
    });
  }
  f.responses.rows = [f.credit, f.credit];
  await assert.rejects(f.qbo.lookup(f.effect), {
    code: "ACCOUNTING_DUPLICATE",
  });
  f.responses.rows = [];
  assert.equal(await f.qbo.lookup(f.effect), null);
  await f.f.app.integration.execute(f.f.actor, f.effect.id, {
    execute: async () => {
      throw Error("lost");
    },
    lookup: async () => null,
  });
  await f.f.app.integration.reconcile(f.f.actor, f.effect.id, f.qbo);
  assert.equal(
    f.f.app.integration.effect(f.f.actor, f.effect.id).state,
    "unknown",
  );
  await assert.rejects(
    f.f.app.integration.execute(f.f.actor, f.effect.id, f.qbo),
    { code: "STATE" },
  );
});

test("strict HTTP credit command retries one intent and rejects foreign organization credit IDs", async (t) => {
  const f = await setup(t),
    origin = "http://127.0.0.1:3000",
    http = await createHttp(f.app, {
      origin,
      staticRoot: "/nonexistent-distributor-test",
    });
  await http.ready();
  t.after(() => http.close());
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: {
      email: "admin@example.test",
      password: "long-test-only-password",
    },
  });
  const cookies = login.cookies.map((c) => `${c.name}=${c.value}`).join("; "),
    csrf = login.json().csrf;
  const post = (payload: unknown) =>
    http.inject({
      method: "POST",
      url: "/api/commands/quickbooks.credit",
      headers: {
        origin,
        cookie: cookies,
        "x-csrf-token": csrf,
        "idempotency-key": "queue",
      },
      payload: payload as any,
    });
  assert.equal(
    (await post({ ...f.input, customerRef: "forged" })).statusCode,
    400,
  );
  const queued = await post(f.input);
  assert.equal(queued.statusCode, 200);
  assert.deepEqual((await post(f.input)).json(), queued.json());
  const other = await setup(t),
    foreign = other.app.database
      .owned("billing")
      .get<any>("SELECT * FROM billing_credits WHERE id=?", other.creditId)!;
  f.app.database
    .owned("billing")
    .run(
      "INSERT INTO billing_credits VALUES(?,?,?,?,?,?,?,?,?,?)",
      foreign.id,
      foreign.org_id,
      foreign.invoice_id,
      foreign.reference,
      foreign.number,
      foreign.reason,
      foreign.net,
      foreign.tax,
      foreign.total,
      foreign.created_at,
    );
  assert.equal((await post({ creditId: foreign.id })).json().code, "NOT_FOUND");
  assert.equal(
    f.app.integration.list(f.actor).filter((e) => e.kind === "credit").length,
    1,
  );
});

test(
  "separate processes queue the same credit once under competing command keys",
  { timeout: 10000 },
  async (t) => {
    const f = await setup(t),
      children = [0, 1].map(() =>
        fork(new URL("./accounting-credit-child.ts", import.meta.url), [], {
          execArgv: ["--import", "tsx"],
          stdio: ["ignore", "pipe", "pipe", "ipc"],
        }),
      );
    t.after(() => children.forEach((c) => c.kill()));
    const ready = children.map(
      (c) =>
        new Promise<void>((resolve, reject) => {
          c.once("error", reject);
          c.once("message", () => resolve());
        }),
    );
    children.forEach((c, i) =>
      c.send({
        action: "init",
        path: f.path,
        actor: f.actor,
        creditId: f.creditId,
        key: `child-${i}`,
      }),
    );
    await Promise.all(ready);
    const outcomes = children.map(
      (c) =>
        new Promise<any>((resolve, reject) => {
          c.once("error", reject);
          c.once("message", resolve);
        }),
    );
    children.forEach((c) => c.send({ action: "go" }));
    const results = await Promise.all(outcomes);
    assert.ok(results.every((r) => r.ok));
    assert.equal(results[0].value.id, results[1].value.id);
    assert.equal(
      f.app.integration.list(f.actor).filter((e) => e.kind === "credit").length,
      1,
    );
  },
);
