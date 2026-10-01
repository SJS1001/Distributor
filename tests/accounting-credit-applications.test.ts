import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { fixture, accept, ship } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { QuickBooksAdapter } from "../src/server/providers.ts";
import { createHttp } from "../src/server/http.ts";
import type {
  AccountingCreditApplicationIntent,
  EffectResult,
} from "../src/server/integration.ts";

async function setup(t: Parameters<typeof fixture>[0]) {
  const f = fixture(t),
    invoiceId = ship(f, accept(f, 2).id).invoiceId;
  f.app.identity.residencyChoice(f.actor, "choice", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["quickbooks"],
    version: 1,
    acknowledgment: "Synthetic accounting consent",
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
  const creditId = f.app.billing.issueCredit(f.actor, "credit", {
    invoiceId,
    reference: "PRIVATE-REFERENCE",
    reason: "Private reason",
    lines: [{ lineId: line.id, quantity: 1 }],
  }).id;
  const credit = f.app.integration.accountingCredit(f.actor, "queue-credit", {
    creditId,
  });
  await f.app.integration.execute(f.actor, credit.id, {
    execute: async () => ({ reference: "credit:credit-1", result: {} }),
    lookup: async () => null,
  });
  return Object.assign(f, { invoiceId, creditId, parent, credit, line });
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
const outcome: EffectResult = {
  reference: "payment:application-1",
  result: { amount: 5000, currency: "CAD" },
};

test("partial credit applications reserve original capacity, retry across restart and retain unknown reservations without native mutation", async (t) => {
  const f = await setup(t),
    before = facts(f),
    input = { creditId: f.creditId, amount: 5000 },
    queued = f.app.integration.accountingCreditApplication(
      f.actor,
      "first",
      input,
    );
  const p = JSON.parse(
    f.app.integration.effect(f.actor, queued.id).payload,
  ) as AccountingCreditApplicationIntent;
  assert.equal(p.creditEffectId, f.credit.id);
  assert.equal(p.externalCreditRef, "credit-1");
  assert.equal(p.credit.externalInvoiceRef, "invoice-1");
  assert.equal(p.amount, 5000);
  assert.match(p.applicationRef, /^DC-[a-f0-9]{18}$/);
  assert.match(p.applicationDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(!JSON.stringify(p).includes("Private reason"));
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(
    f.app.integration.accountingCreditApplication(f.actor, "first", input),
    queued,
  );
  assert.throws(
    () =>
      f.app.integration.accountingCreditApplication(f.actor, "first", {
        ...input,
        amount: 6000,
      }),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  let sends = 0;
  const adapter = {
    execute: async () => {
      sends++;
      throw Error("lost");
    },
    lookup: async () => null as EffectResult | null,
  };
  assert.equal(
    (await f.app.integration.execute(f.actor, queued.id, adapter)).state,
    "unknown",
  );
  assert.equal(
    (await f.app.integration.reconcile(f.actor, queued.id, adapter)).state,
    "unknown",
  );
  await assert.rejects(f.app.integration.execute(f.actor, queued.id, adapter), {
    code: "STATE",
  });
  f.app.integration.accountingCreditApplication(f.actor, "second", {
    creditId: f.creditId,
    amount: 6300,
  });
  assert.throws(
    () =>
      f.app.integration.accountingCreditApplication(f.actor, "third", {
        creditId: f.creditId,
        amount: 1,
      }),
    { code: "ACCOUNTING_ALLOCATION" },
  );
  assert.equal(
    (
      await f.app.integration.reconcile(f.actor, queued.id, {
        ...adapter,
        lookup: async () => outcome,
      })
    ).state,
    "completed",
  );
  assert.equal(sends, 1);
  assert.deepEqual(
    f.app.integration.list(f.actor).find((e) => e.id === f.credit.id)!
      .creditApplication,
    { reservedAmount: 11300, availableCredit: 0, availableInvoice: 11300 },
  );
  assert.deepEqual(facts(f), before);
});

test("cash and credit share invoice capacity in either queue order, across multiple original credits", async (t) => {
  for (const cashFirst of [false, true]) {
    const f = await setup(t),
      paymentId = f.app.billing.verifiedPayment(
        f.actor,
        f.invoiceId,
        22600,
        "stripe",
        `pi-${cashFirst}`,
      ).id;
    if (cashFirst)
      f.app.integration.accountingPayment(f.actor, "cash", {
        paymentId,
        appliedAmount: 17000,
        depositAccountRef: "bank-1",
      });
    else
      f.app.integration.accountingCreditApplication(f.actor, "apply", {
        creditId: f.creditId,
        amount: 11300,
      });
    assert.throws(
      () =>
        cashFirst
          ? f.app.integration.accountingCreditApplication(f.actor, "too-much", {
              creditId: f.creditId,
              amount: 5601,
            })
          : f.app.integration.accountingPayment(f.actor, "too-much", {
              paymentId,
              appliedAmount: 11301,
              depositAccountRef: "bank-1",
            }),
      { code: "ACCOUNTING_ALLOCATION" },
    );
    if (cashFirst)
      f.app.integration.accountingCreditApplication(f.actor, "rest", {
        creditId: f.creditId,
        amount: 5600,
      });
    else
      f.app.integration.accountingPayment(f.actor, "rest", {
        paymentId,
        appliedAmount: 11300,
        depositAccountRef: "bank-1",
      });
    const another = f.app.billing.issueCredit(f.actor, "credit-2", {
      invoiceId: f.invoiceId,
      reference: "SECOND",
      reason: "Synthetic",
      lines: [{ lineId: f.line.id, quantity: 1 }],
    });
    const effect = f.app.integration.accountingCredit(f.actor, "q2", {
      creditId: another.id,
    });
    await f.app.integration.execute(f.actor, effect.id, {
      execute: async () => ({ reference: "credit:credit-2", result: {} }),
      lookup: async () => null,
    });
    assert.throws(
      () =>
        f.app.integration.accountingCreditApplication(f.actor, "new-credit", {
          creditId: another.id,
          amount: 1,
        }),
      { code: "ACCOUNTING_ALLOCATION" },
    );
  }
});

test("current finance/password/customer choice and restore guard cached applications and privacy", async (t) => {
  const f = await setup(t),
    input = { creditId: f.creditId, amount: 5000 },
    queued = f.app.integration.accountingCreditApplication(
      f.actor,
      "apply",
      input,
    ),
    iam = f.app.database.owned("iam");
  for (const role of ["commercial", "buyer", "support"]) {
    iam.run(
      "UPDATE iam_users SET role=?,account_id=? WHERE id=?",
      role,
      role === "buyer" ? f.buyer : null,
      f.actor.id,
    );
    assert.throws(
      () =>
        f.app.integration.accountingCreditApplication(f.actor, "apply", input),
      { code: "FORBIDDEN" },
    );
    assert.equal(
      f.app.integration
        .list(f.app.identity.currentActor(f.actor))
        .some((e) => e.id === queued.id),
      role === "support",
    );
  }
  iam.run(
    "UPDATE iam_users SET role='admin',account_id=NULL,active=0 WHERE id=?",
    f.actor.id,
  );
  assert.throws(
    () =>
      f.app.integration.accountingCreditApplication(f.actor, "apply", input),
    { code: "FORBIDDEN" },
  );
  iam.run("UPDATE iam_users SET active=1 WHERE id=?", f.actor.id);
  iam.run(
    "INSERT INTO iam_user_security(user_id,revision,password_change_required,updated_at) VALUES(?,1,1,?)",
    f.actor.id,
    new Date().toISOString(),
  );
  assert.throws(
    () =>
      f.app.integration.accountingCreditApplication(f.actor, "apply", input),
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
    () =>
      f.app.integration.accountingCreditApplication(f.actor, "apply", input),
    { code: "RESIDENCY_BLOCKED" },
  );
  f.app.identity.residencyChoice(f.actor, "restore-choice", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["quickbooks"],
    version: 3,
    acknowledgment: "Synthetic",
  });
  f.app.platform.isolateRestore("Synthetic", new Date().toISOString());
  assert.throws(
    () =>
      f.app.integration.accountingCreditApplication(f.actor, "apply", input),
    { code: "RECOVERY_HOLD" },
  );
});

test("applications require reconciled immutable original credit and roll reservation/effect/receipt back on audit failure", async (t) => {
  const f = await setup(t),
    input = { creditId: f.creditId, amount: 11300 },
    integration = f.app.database.owned("integration"),
    billing = f.app.database.owned("billing"),
    before = facts(f);
  integration.run(
    "UPDATE integration_effects SET state='unknown' WHERE id=?",
    f.credit.id,
  );
  assert.throws(
    () => f.app.integration.accountingCreditApplication(f.actor, "a", input),
    { code: "ACCOUNTING_CREDIT_REQUIRED" },
  );
  integration.run(
    "UPDATE integration_effects SET state='completed' WHERE id=?",
    f.credit.id,
  );
  billing.run(
    "UPDATE billing_credits SET number='CHANGED' WHERE id=?",
    f.creditId,
  );
  assert.throws(
    () => f.app.integration.accountingCreditApplication(f.actor, "a", input),
    { code: "ACCOUNTING_CREDIT_MISMATCH" },
  );
  billing.run(
    "UPDATE billing_credits SET number=? WHERE id=?",
    JSON.parse(f.app.integration.effect(f.actor, f.credit.id).payload).credit
      .number,
    f.creditId,
  );
  const audit = t.mock.method(f.app.platform, "audit", () => {
    throw Error("Late audit failure");
  });
  assert.throws(
    () => f.app.integration.accountingCreditApplication(f.actor, "a", input),
    /audit failure/,
  );
  audit.mock.restore();
  assert.equal(
    integration.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM integration_credit_applications",
    )!.count,
    0,
  );
  assert.equal(
    f.app.integration
      .list(f.actor)
      .filter((e) => e.kind === "credit-application").length,
    0,
  );
  assert.equal(
    f.app.integration.accountingCreditApplication(f.actor, "a", input).state,
    "pending",
  );
  assert.deepEqual(facts(f), before);
});

test("strict HTTP application boundary rejects forged fields/amounts and cached access after revocation", async (t) => {
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
    }),
    cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join("; "),
    headers = {
      origin,
      cookie,
      "x-csrf-token": login.json().csrf,
      "idempotency-key": "apply",
    },
    input = { creditId: f.creditId, amount: 5000 },
    post = (payload: any, h = headers) =>
      http.inject({
        method: "POST",
        url: "/api/commands/quickbooks.credit.apply",
        headers: h,
        payload,
      });
  for (const value of [
    { ...input, customerRef: "forged" },
    { ...input, amount: 0 },
    { ...input, amount: 0.1 },
    { ...input, amount: -1 },
  ])
    assert.equal((await post(value)).statusCode, 400);
  assert.equal(
    (await post(input, { ...headers, origin: "https://foreign.test" }))
      .statusCode,
    403,
  );
  assert.equal(
    (await post(input, { ...headers, "x-csrf-token": "bad" })).statusCode,
    403,
  );
  const queued = await post(input);
  assert.equal(queued.statusCode, 200);
  assert.deepEqual((await post(input)).json(), queued.json());
  const other = await setup(t);
  assert.equal(
    (
      await post(
        { creditId: other.creditId, amount: 5000 },
        { ...headers, "idempotency-key": "foreign" },
      )
    ).statusCode,
    404,
  );
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='support' WHERE id=?", f.actor.id);
  assert.equal((await post(input)).statusCode, 403);
});

test(
  "independent processes contend remaining credit capacity without over-allocation",
  { timeout: 10000 },
  async (t) => {
    const f = await setup(t),
      children = [0, 1].map(() =>
        fork(
          new URL("./accounting-credit-application-child.ts", import.meta.url),
          [],
          {
            execArgv: ["--import", "tsx"],
            stdio: ["ignore", "pipe", "pipe", "ipc"],
          },
        ),
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
        amount: 7000,
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
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(results.find((r) => !r.ok).code, "ACCOUNTING_ALLOCATION");
    assert.equal(
      f.app.integration
        .list(f.actor)
        .filter((e) => e.kind === "credit-application").length,
      1,
    );
    assert.equal(
      f.app.integration.list(f.actor).find((e) => e.id === f.credit.id)!
        .creditApplication!.reservedAmount,
      7000,
    );
  },
);

async function providerFixture(
  t: Parameters<typeof fixture>[0] & { mock: any },
) {
  const f = await setup(t),
    queued = f.app.integration.accountingCreditApplication(f.actor, "apply", {
      creditId: f.creditId,
      amount: 5000,
    }),
    effect = f.app.integration.effect(f.actor, queued.id),
    p = JSON.parse(effect.payload) as AccountingCreditApplicationIntent;
  const invoice = {
    Id: "invoice-1",
    DocNumber: p.credit.invoice.number,
    TotalAmt: 226,
    Balance: 170,
    PrivateNote: `Distributor effect ${p.credit.invoiceEffectId}`,
    CustomerRef: { value: "customer-1" },
    CurrencyRef: { value: "CAD" },
  };
  const credit = {
    Id: "credit-1",
    DocNumber: p.credit.credit.number,
    TxnDate: p.credit.credit.created_at.slice(0, 10),
    TotalAmt: 113,
    RemainingCredit: 80,
    PrivateNote: `Distributor effect ${p.creditEffectId}`,
    CustomerRef: { value: "customer-1" },
    CurrencyRef: { value: "CAD" },
    LinkedTxn: [{ TxnId: "previous-application", TxnType: "Payment" }],
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
  const payment = {
    Id: "application-1",
    TotalAmt: 0,
    UnappliedAmt: 0,
    PaymentRefNum: p.applicationRef,
    TxnDate: p.applicationDate,
    PrivateNote: `Distributor effect ${effect.id}`,
    ProcessPayment: false,
    CustomerRef: { value: "customer-1" },
    CurrencyRef: { value: "CAD" },
    Line: [
      { Amount: 50, LinkedTxn: [{ TxnId: "invoice-1", TxnType: "Invoice" }] },
      { Amount: 50, LinkedTxn: [{ TxnId: "credit-1", TxnType: "CreditMemo" }] },
    ],
  };
  const responses: {
    invoice: any;
    credit: any;
    payment: any;
    preferences: any;
    rows: any[];
  } = {
    invoice,
    credit,
    payment,
    preferences: { SalesFormsPrefs: { AutoApplyCredit: false } },
    rows: [payment],
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
              ? { QueryResponse: { Payment: responses.rows } }
              : init?.method === "POST"
                ? { Payment: responses.payment }
                : String(url).includes("/creditmemo/")
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
    payment,
    responses,
    fetch,
    qbo: new QuickBooksAdapter("12345", async () => "synthetic", true),
  };
}

test("credit application adapter verifies original documents then posts zero cash with two exact accounting links", async (t) => {
  const f = await providerFixture(t),
    sent = await f.qbo.execute(f.effect);
  assert.equal(sent.reference, "payment:application-1");
  assert.equal(sent.result.amount, 5000);
  assert.equal(f.fetch.mock.calls.length, 4);
  const [url, init] = f.fetch.mock.calls[3].arguments;
  assert.equal(
    new URL(String(url)).hostname,
    "sandbox-quickbooks.api.intuit.com",
  );
  assert.equal(new URL(String(url)).searchParams.get("requestid"), f.effect.id);
  const body = JSON.parse(String(init.body));
  assert.equal(body.TotalAmt, 0);
  assert.equal(body.ProcessPayment, false);
  assert.equal(body.PaymentRefNum, f.p.applicationRef);
  assert.equal(body.TxnDate, f.p.applicationDate);
  assert.equal(body.DepositToAccountRef, undefined);
  assert.deepEqual(body.Line, f.payment.Line);
  assert.deepEqual(await f.qbo.lookup(f.effect), sent);
  assert.equal(f.fetch.mock.calls[4].arguments[1].method, "GET");
  assert.match(
    decodeURIComponent(String(f.fetch.mock.calls[4].arguments[0])),
    /PaymentRefNum = 'DC-[a-f0-9]{18}' maxresults 2/,
  );
});

test("a changed application response retains its reservation and reconciles by read without another send", async (t) => {
  const f = await providerFixture(t),
    before = facts(f.f);
  f.responses.payment = { ...f.payment, TotalAmt: 50 };
  assert.equal(
    (await f.f.app.integration.execute(f.f.actor, f.effect.id, f.qbo)).state,
    "unknown",
  );
  assert.equal(
    f.f.app.integration.list(f.f.actor).find((e) => e.id === f.f.credit.id)!
      .creditApplication!.reservedAmount,
    5000,
  );
  await assert.rejects(
    f.f.app.integration.execute(f.f.actor, f.effect.id, f.qbo),
    { code: "STATE" },
  );
  assert.equal(
    (await f.f.app.integration.reconcile(f.f.actor, f.effect.id, f.qbo)).state,
    "completed",
  );
  assert.equal(
    f.fetch.mock.calls.filter((c: any) => c.arguments[1].method === "POST")
      .length,
    1,
  );
  assert.deepEqual(facts(f.f), before);
});

test("application preflight rejects changed original money/identity/settings and insufficient exact balances before POST", async (t) => {
  const f = await providerFixture(t);
  for (const preferences of [
    {},
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
    { DocNumber: "other" },
    { CustomerRef: { value: "foreign" } },
    { CurrencyRef: { value: "USD" } },
    { TotalAmt: 226.001 },
    { PrivateNote: "wrong" },
    { Balance: 49.99 },
    { Balance: 50.001 },
    { Balance: 227 },
  ]) {
    f.responses.invoice = { ...f.invoice, ...change };
    await assert.rejects(f.qbo.execute(f.effect), {
      code: "ACCOUNTING_INVOICE_MISMATCH",
    });
  }
  f.responses.invoice = f.invoice;
  for (const change of [
    { Id: "other" },
    { DocNumber: "other" },
    { PrivateNote: "wrong" },
    { CustomerRef: { value: "foreign" } },
    { CurrencyRef: { value: "USD" } },
    { TotalAmt: 113.001 },
    { RemainingCredit: 80.001 },
    { RemainingCredit: -1 },
    { RemainingCredit: 114 },
    { Line: [] },
    { TxnTaxDetail: { TotalTax: 0 } },
  ]) {
    f.responses.credit = { ...f.credit, ...change };
    await assert.rejects(f.qbo.execute(f.effect), {
      code: "ACCOUNTING_MISMATCH",
    });
  }
  f.responses.credit = { ...f.credit, RemainingCredit: 49.99 };
  await assert.rejects(f.qbo.execute(f.effect), {
    code: "ACCOUNTING_ALLOCATION",
  });
  assert.ok(
    f.fetch.mock.calls.every((c: any) => c.arguments[1].method === "GET"),
  );
  const token = t.mock.fn(async () => "not-used"),
    disabled = new QuickBooksAdapter("12345", token);
  const count = f.fetch.mock.calls.length;
  await assert.rejects(disabled.execute(f.effect), {
    code: "PROVIDER_DISABLED",
  });
  await assert.rejects(disabled.lookup(f.effect), {
    code: "PROVIDER_DISABLED",
  });
  assert.equal(token.mock.calls.length, 0);
  assert.equal(f.fetch.mock.calls.length, count);
});

test("application reconciliation rejects charging cash, changed links/money/markers and duplicates; absence remains unknown", async (t) => {
  const f = await providerFixture(t);
  for (const change of [
    { Id: "" },
    { TotalAmt: 50 },
    { UnappliedAmt: 1 },
    { ProcessPayment: true },
    { PrivateNote: "wrong" },
    { PaymentRefNum: "wrong" },
    { CustomerRef: { value: "foreign" } },
    { CurrencyRef: { value: "USD" } },
    { TxnDate: "2000-01-01" },
    { Line: [] },
    { Line: [f.payment.Line[0], f.payment.Line[0]] },
    { Line: [f.payment.Line[0], { ...f.payment.Line[1], Amount: 50.001 }] },
    {
      Line: [
        f.payment.Line[0],
        { Amount: 50, LinkedTxn: [{ TxnId: "other", TxnType: "CreditMemo" }] },
      ],
    },
    { Line: [...f.payment.Line, f.payment.Line[1]] },
  ]) {
    f.responses.rows = [{ ...f.payment, ...change }];
    await assert.rejects(f.qbo.lookup(f.effect), {
      code: "ACCOUNTING_MISMATCH",
    });
  }
  f.responses.rows = [{ ...f.payment, Line: [...f.payment.Line].reverse() }];
  assert.equal(
    (await f.qbo.lookup(f.effect))!.reference,
    "payment:application-1",
  );
  f.responses.rows = [f.payment, f.payment];
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
  assert.equal(
    (await f.f.app.integration.reconcile(f.f.actor, f.effect.id, f.qbo)).state,
    "unknown",
  );
  await assert.rejects(
    f.f.app.integration.execute(f.f.actor, f.effect.id, f.qbo),
    { code: "STATE" },
  );
  assert.equal(
    f.f.app.integration.list(f.f.actor).find((e) => e.id === f.f.credit.id)!
      .creditApplication!.reservedAmount,
    5000,
  );
});
