import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { chooseProviders, fixture, accept, ship } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { QuickBooksAdapter } from "../src/server/providers.ts";
import { configuredProviders } from "../src/server/provider-runtime.ts";
import { createHttp } from "../src/server/http.ts";
import type {
  AccountingRefundIntent,
  AccountingRefundApplicationIntent,
  Effect,
} from "../src/server/integration.ts";

async function setup(
  t: Parameters<typeof fixture>[0],
  appliedAmount = 22600,
  refundAmount = 5000,
) {
  const f = fixture(t),
    invoiceId = ship(f, accept(f, 2).id).invoiceId;
  chooseProviders(f, f.actor, "choice", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["quickbooks", "stripe"],
    version: 1,
    acknowledgment: "Synthetic permissions",
  });
  const parent = f.app.integration.accounting(f.actor, "invoice", {
    invoiceId,
    customerRef: "customer-1",
    itemRefs: { [f.product]: "item-1" },
    taxCodeRef: "tax-1",
    taxRateRef: "rate-1",
  });
  const delivered = (reference: string) => ({
    execute: async () => ({ reference, result: {} }),
    lookup: async () => null,
  });
  await f.app.integration.execute(f.actor, parent.id, delivered("invoice-1"));
  const payment = f.app.database.transaction(() =>
    f.app.billing.verifiedPayment(
      f.actor,
      invoiceId,
      22600,
      "stripe",
      "pi_synthetic",
    ),
  );
  const cash = f.app.integration.accountingPayment(f.actor, "cash", {
    paymentId: payment.id,
    appliedAmount,
    depositAccountRef: "bank-1",
  });
  await f.app.integration.execute(
    f.actor,
    cash.id,
    delivered("payment:cash-1"),
  );
  const line = f.app.billing.lines(f.actor, invoiceId)[0]!;
  const credit = f.app.billing.issueCredit(f.actor, "credit", {
    invoiceId,
    reference: "CR1",
    reason: "Private native reason",
    lines: [{ lineId: String(line.id), quantity: 1 }],
  });
  const creditId = credit.id;
  const postedCredit = f.app.integration.accountingCredit(
    f.actor,
    "queue-credit",
    { creditId },
  );
  await f.app.integration.execute(
    f.actor,
    postedCredit.id,
    delivered("credit:credit-1"),
  );
  const refund = f.app.billing.refundRequest(f.actor, "refund", {
    invoiceId,
    paymentId: payment.id,
    amount: refundAmount,
    reference: "REF1",
    reason: "Private cash reason",
  });
  const intent = f.app.billing.refunds.intent(f.actor, refund.id);
  f.app.database.transaction(() =>
    f.app.billing.refunds.observe(f.actor, intent, "re_synthetic", {
      ...intent,
      status: "succeeded",
    }),
  );
  const input = {
    refundId: refund.id,
    creditId,
    bankAccountRef: "bank-1",
    receivableAccountRef: "ar-1",
    nonTaxCodeRef: "NON",
    expenseDate: "2026-10-01",
  };
  return Object.assign(f, {
    invoiceId,
    paymentId: payment.id,
    creditId,
    postedCredit,
    parent,
    cash,
    refundId: refund.id,
    intent,
    input,
  });
}
function facts(f: Awaited<ReturnType<typeof setup>>) {
  return {
    stock: f.app.inventory.stock(f.actor),
    invoices: f.app.billing.invoices(f.actor),
    credits: f.app.billing.credits(f.actor),
    payments: f.app.billing.refunds.payments(f.actor),
    refunds: f.app.billing.refunds.list(f.actor),
    totals: f.app.billing.totals(f.actor, f.invoiceId),
  };
}
function expenseEffect(f: Awaited<ReturnType<typeof setup>>) {
  const queued = f.app.integration.accountingRefund(
    f.actor,
    "expense",
    f.input,
  );
  return f.app.integration.effect(f.actor, queued.id);
}
function bankFailure(f: Awaited<ReturnType<typeof setup>>) {
  f.app.database.transaction(() =>
    f.app.billing.refunds.observe(f.actor, f.intent, "re_synthetic", {
      ...f.intent,
      status: "failed",
    }),
  );
}

test("current grants, password, customer choice and restoration guard both cached refund commands and projections", async (t) => {
  const f = await setup(t),
    expense = expenseEffect(f),
    iam = f.app.database.owned("iam");
  await f.app.integration.execute(f.actor, expense.id, {
    execute: async () => confirmedExpense,
    lookup: async () => null,
  });
  const input = { refundId: f.refundId },
    link = f.app.integration.accountingRefundApplication(
      f.actor,
      "link",
      input,
    );
  const retry = () => {
    f.app.integration.accountingRefund(f.actor, "expense", f.input);
    f.app.integration.accountingRefundApplication(f.actor, "link", input);
  };
  const refuse = (code: string) => {
    assert.throws(
      () => f.app.integration.accountingRefund(f.actor, "expense", f.input),
      { code },
    );
    assert.throws(
      () =>
        f.app.integration.accountingRefundApplication(f.actor, "link", input),
      { code },
    );
  };
  for (const role of ["commercial", "buyer", "support"]) {
    iam.run(
      "UPDATE iam_users SET role=?,account_id=? WHERE id=?",
      role,
      role === "buyer" ? f.buyer : null,
      f.actor.id,
    );
    refuse("FORBIDDEN");
    const current = f.app.identity.currentActor(f.actor);
    assert.equal(
      f.app.integration
        .list(current)
        .some((e) => e.id === expense.id || e.id === link.id),
      role === "support",
    );
  }
  iam.run(
    "UPDATE iam_users SET role='admin',account_id=NULL,active=0 WHERE id=?",
    f.actor.id,
  );
  refuse("FORBIDDEN");
  iam.run("UPDATE iam_users SET active=1 WHERE id=?", f.actor.id);
  iam.run(
    "INSERT INTO iam_user_security(user_id,revision,password_change_required,updated_at) VALUES(?,1,1,?)",
    f.actor.id,
    new Date().toISOString(),
  );
  refuse("PASSWORD_CHANGE_REQUIRED");
  iam.run(
    "UPDATE iam_user_security SET password_change_required=0 WHERE user_id=?",
    f.actor.id,
  );
  retry();
  chooseProviders(f, f.actor, "withdraw", {
    accountId: f.buyer,
    region: "CA",
    mode: "strict",
    providers: [],
    version: 2,
    acknowledgment: "Synthetic withdrawal",
  });
  refuse("RESIDENCY_BLOCKED");
  chooseProviders(f, f.actor, "restore-choice", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["quickbooks", "stripe"],
    version: 3,
    acknowledgment: "Synthetic",
  });
  retry();
  f.app.platform.isolateRestore("Synthetic", new Date().toISOString());
  refuse("RECOVERY_HOLD");
});

test("invalid dates, parent mismatches and late audit failures leave no refund reservation, queue or command receipt", async (t) => {
  const f = await setup(t),
    store = f.app.database.owned("integration"),
    before = facts(f),
    count = () =>
      store.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM integration_accounting_refunds",
      )!.n;
  for (const date of ["2026-02-30", "2026-13-01", "2026-10-1", "not-a-date"])
    assert.throws(
      () =>
        f.app.integration.accountingRefund(f.actor, `bad-${date}`, {
          ...f.input,
          expenseDate: date,
        }),
      { code: "VALIDATION" },
    );
  store.run(
    "UPDATE integration_effects SET state='unknown' WHERE id=?",
    f.postedCredit.id,
  );
  assert.throws(
    () => f.app.integration.accountingRefund(f.actor, "expense", f.input),
    { code: "ACCOUNTING_CREDIT_REQUIRED" },
  );
  store.run(
    "UPDATE integration_effects SET state='completed' WHERE id=?",
    f.postedCredit.id,
  );
  const audit = t.mock.method(f.app.platform, "audit", () => {
    throw Error("Late audit failure");
  });
  assert.throws(
    () => f.app.integration.accountingRefund(f.actor, "expense", f.input),
    /audit failure/,
  );
  audit.mock.restore();
  assert.equal(count(), 0);
  assert.equal(
    f.app.integration.list(f.actor).filter((e) => e.kind === "refund-expense")
      .length,
    0,
  );
  const expense = expenseEffect(f);
  assert.equal(count(), 1);
  await f.app.integration.execute(f.actor, expense.id, {
    execute: async () => confirmedExpense,
    lookup: async () => null,
  });
  const linkAudit = t.mock.method(f.app.platform, "audit", () => {
    throw Error("Late link audit failure");
  });
  assert.throws(
    () =>
      f.app.integration.accountingRefundApplication(f.actor, "link", {
        refundId: f.refundId,
      }),
    /audit failure/,
  );
  linkAudit.mock.restore();
  assert.equal(
    f.app.integration
      .list(f.actor)
      .filter((e) => e.kind === "refund-application").length,
    0,
  );
  f.app.integration.accountingRefundApplication(f.actor, "link", {
    refundId: f.refundId,
  });
  assert.equal(count(), 1);
  assert.deepEqual(facts(f), before);
});

test("refund reservations never exceed cash originally applied even with additional native credit", async (t) => {
  const f = await setup(t, 5000);
  expenseEffect(f);
  const next = f.app.billing.refundRequest(f.actor, "refund-two", {
      invoiceId: f.invoiceId,
      paymentId: f.paymentId,
      amount: 1000,
      reference: "REF2",
      reason: "Synthetic",
    }),
    intent = f.app.billing.refunds.intent(f.actor, next.id);
  f.app.database.transaction(() =>
    f.app.billing.refunds.observe(f.actor, intent, "re_second", {
      ...intent,
      status: "succeeded",
    }),
  );
  assert.throws(
    () =>
      f.app.integration.accountingRefund(f.actor, "expense-two", {
        ...f.input,
        refundId: next.id,
      }),
    { code: "ACCOUNTING_ALLOCATION" },
  );
  assert.equal(
    f.app.integration.list(f.actor).filter((e) => e.kind === "refund-expense")
      .length,
    1,
  );
});

test("strict refund HTTP commands derive cash facts and enforce CSRF, organization isolation and current authority before cached retry", async (t) => {
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
    headers = {
      origin,
      cookie: login.cookies.map((c) => `${c.name}=${c.value}`).join("; "),
      "x-csrf-token": login.json().csrf,
      "idempotency-key": "expense",
    };
  const post = (name: string, payload: any, h = headers) =>
    http.inject({
      method: "POST",
      url: `/api/commands/${name}`,
      headers: h,
      payload,
    });
  for (const field of [
    "amount",
    "currency",
    "customerRef",
    "cashReference",
    "externalCreditRef",
  ])
    assert.equal(
      (await post("quickbooks.refund", { ...f.input, [field]: "forged" }))
        .statusCode,
      400,
    );
  assert.equal(
    (
      await post("quickbooks.refund", f.input, {
        ...headers,
        "x-csrf-token": "bad",
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await post("quickbooks.refund", f.input, {
        ...headers,
        origin: "https://foreign.test",
      })
    ).statusCode,
    403,
  );
  const queued = await post("quickbooks.refund", f.input);
  assert.equal(queued.statusCode, 200);
  assert.deepEqual(
    (await post("quickbooks.refund", f.input)).json(),
    queued.json(),
  );
  const other = await setup(t);
  assert.equal(
    (
      await post(
        "quickbooks.refund",
        { ...f.input, refundId: other.refundId },
        { ...headers, "idempotency-key": "foreign" },
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await post(
        "quickbooks.refund",
        { ...f.input, creditId: other.creditId },
        { ...headers, "idempotency-key": "foreign-credit" },
      )
    ).statusCode,
    404,
  );
  await f.app.integration.execute(f.actor, queued.json().id, {
    execute: async () => confirmedExpense,
    lookup: async () => null,
  });
  const linkInput = { refundId: f.refundId },
    linkHeaders = { ...headers, "idempotency-key": "link" };
  assert.equal(
    (
      await post(
        "quickbooks.refund.apply",
        { ...linkInput, amount: 1 },
        linkHeaders,
      )
    ).statusCode,
    400,
  );
  const link = await post("quickbooks.refund.apply", linkInput, linkHeaders);
  assert.equal(link.statusCode, 200);
  assert.deepEqual(
    (await post("quickbooks.refund.apply", linkInput, linkHeaders)).json(),
    link.json(),
  );
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='support' WHERE id=?", f.actor.id);
  assert.equal((await post("quickbooks.refund", f.input)).statusCode, 403);
  assert.equal(
    (await post("quickbooks.refund.apply", linkInput, linkHeaders)).statusCode,
    403,
  );
});
const confirmedExpense = { reference: "expense:expense-1", result: {} };
const confirmedLink = { reference: "payment:link-1", result: {} };

test("refund reservation is shared with credit applications and survives unknown delivery, restart and exact retry without native mutation", async (t) => {
  const f = await setup(t, 11300),
    before = facts(f),
    effect = expenseEffect(f),
    p = JSON.parse(effect.payload) as AccountingRefundIntent;
  assert.equal(p.paymentId, f.paymentId);
  assert.equal(p.externalPaymentRef, "cash-1");
  assert.equal(p.externalCreditRef, "credit-1");
  assert.match(p.expenseRef, /^DR-[a-f0-9]{18}$/);
  assert.ok(!effect.payload.includes("Private"));
  f.app.close();
  f.app = new Application(f.path);
  assert.equal(
    f.app.integration.accountingRefund(f.actor, "expense", f.input).id,
    effect.id,
  );
  assert.equal(
    f.app.integration.accountingRefund(f.actor, "another-key", f.input).id,
    effect.id,
  );
  assert.throws(
    () =>
      f.app.integration.accountingRefund(f.actor, "changed", {
        ...f.input,
        bankAccountRef: "other-bank",
      }),
    { code: "EFFECT_CONFLICT" },
  );
  let sends = 0;
  const adapter = {
    execute: async () => {
      sends++;
      throw Error("lost");
    },
    lookup: async () => null,
  };
  assert.equal(
    (await f.app.integration.execute(f.actor, effect.id, adapter)).state,
    "unknown",
  );
  assert.equal(
    (await f.app.integration.reconcile(f.actor, effect.id, adapter)).state,
    "unknown",
  );
  await assert.rejects(f.app.integration.execute(f.actor, effect.id, adapter), {
    code: "STATE",
  });
  f.app.integration.accountingCreditApplication(f.actor, "other-use", {
    creditId: f.creditId,
    amount: 6300,
  });
  assert.throws(
    () =>
      f.app.integration.accountingCreditApplication(f.actor, "over", {
        creditId: f.creditId,
        amount: 1,
      }),
    { code: "ACCOUNTING_ALLOCATION" },
  );
  assert.equal(
    f.app.integration.list(f.actor).find((e) => e.id === f.postedCredit.id)!
      .creditApplication!.reservedAmount,
    11300,
  );
  assert.equal(
    (
      await f.app.integration.reconcile(f.actor, effect.id, {
        ...adapter,
        lookup: async () => confirmedExpense,
      })
    ).state,
    "completed",
  );
  assert.equal(sends, 1);
  assert.deepEqual(facts(f), before);
});

test("confirmed expense precedes its one zero-cash link; native late failure blocks new sends but keeps remote recovery and warnings", async (t) => {
  const f = await setup(t),
    before = facts(f),
    expense = expenseEffect(f);
  assert.throws(
    () =>
      f.app.integration.accountingRefundApplication(f.actor, "link", {
        refundId: f.refundId,
      }),
    { code: "ACCOUNTING_EXPENSE_REQUIRED" },
  );
  await f.app.integration.execute(f.actor, expense.id, {
    execute: async () => confirmedExpense,
    lookup: async () => null,
  });
  const queued = f.app.integration.accountingRefundApplication(
      f.actor,
      "link",
      { refundId: f.refundId },
    ),
    link = f.app.integration.effect(f.actor, queued.id);
  const p = JSON.parse(link.payload) as AccountingRefundApplicationIntent;
  assert.equal(p.expenseEffectId, expense.id);
  assert.equal(p.externalExpenseRef, "expense-1");
  assert.match(p.applicationRef, /^DA-[a-f0-9]{18}$/);
  assert.equal(
    f.app.integration.accountingRefundApplication(f.actor, "link-new-key", {
      refundId: f.refundId,
    }).id,
    link.id,
  );
  assert.equal(
    (
      await f.app.integration.execute(f.actor, link.id, {
        execute: async () => {
          throw Error("lost");
        },
        lookup: async () => null,
      })
    ).state,
    "unknown",
  );
  assert.deepEqual(facts(f), before);
  bankFailure(f);
  const reversed = facts(f);
  assert.throws(
    () => f.app.integration.accountingRefund(f.actor, "expense", f.input),
    { code: "ACCOUNTING_REFUND_REQUIRED" },
  );
  assert.throws(
    () =>
      f.app.integration.accountingRefundApplication(f.actor, "link", {
        refundId: f.refundId,
      }),
    { code: "ACCOUNTING_REFUND_REQUIRED" },
  );
  assert.equal(
    (
      await f.app.integration.reconcile(f.actor, link.id, {
        execute: async () => {
          throw Error("never");
        },
        lookup: async () => confirmedLink,
      })
    ).state,
    "completed",
  );
  const rows = f.app.integration
    .list(f.actor)
    .filter((e) => e.reference === f.refundId);
  assert.ok(rows.every((e) => e.accountingRefund?.requiresReview));
  assert.ok(rows.every((e) => e.accountingRefund?.nativeState === "rejected"));
  assert.deepEqual(facts(f), reversed);
});

test("native reversal before a send leaves a pending expense and makes no adapter request", async (t) => {
  const f = await setup(t),
    effect = expenseEffect(f);
  bankFailure(f);
  let calls = 0;
  await assert.rejects(
    f.app.integration.execute(f.actor, effect.id, {
      execute: async () => {
        calls++;
        return confirmedExpense;
      },
      lookup: async () => null,
    }),
    { code: "ACCOUNTING_REFUND_MISMATCH" },
  );
  assert.equal(calls, 0);
  assert.equal(f.app.integration.effect(f.actor, effect.id).state, "pending");
});

function responses(effect: Effect) {
  const p = JSON.parse(effect.payload) as AccountingRefundIntent,
    credit = p.credit,
    cash = p.payment;
  const invoice = {
    Id: credit.externalInvoiceRef,
    DocNumber: credit.invoice.number,
    PrivateNote: `Distributor effect ${credit.invoiceEffectId}`,
    TotalAmt: credit.invoice.total / 100,
    CustomerRef: { value: credit.customerRef },
    CurrencyRef: { value: credit.invoice.currency },
    Balance: 0,
    SyncToken: "1",
  };
  const payment = {
    Id: p.externalPaymentRef,
    PrivateNote: `Distributor effect ${p.paymentEffectId}`,
    PaymentRefNum: cash.paymentRef,
    TotalAmt: cash.payment.amount / 100,
    UnappliedAmt: (cash.payment.amount - cash.appliedAmount) / 100,
    CustomerRef: { value: cash.customerRef },
    CurrencyRef: { value: cash.invoice.currency },
    DepositToAccountRef: { value: cash.depositAccountRef },
    TxnDate: cash.payment.created_at.slice(0, 10),
    ProcessPayment: false,
    Line: [
      {
        Amount: cash.appliedAmount / 100,
        LinkedTxn: [{ TxnType: "Invoice", TxnId: cash.externalInvoiceRef }],
      },
    ],
  };
  const memo = {
    Id: p.externalCreditRef,
    DocNumber: credit.credit.number,
    PrivateNote: `Distributor effect ${p.creditEffectId}`,
    TotalAmt: credit.credit.total / 100,
    RemainingCredit: credit.credit.total / 100,
    CustomerRef: { value: credit.customerRef },
    CurrencyRef: { value: credit.invoice.currency },
    SyncToken: "1",
    TxnDate: credit.credit.created_at.slice(0, 10),
    Line: credit.lines.map((l) => ({
      Amount: (l.quantity * l.unitPrice) / 100,
      DetailType: "SalesItemLineDetail",
      SalesItemLineDetail: {
        ItemRef: { value: l.itemRef },
        Qty: l.quantity,
        UnitPrice: l.unitPrice / 100,
        TaxCodeRef: { value: credit.taxCodeRef },
      },
    })),
    TxnTaxDetail: {
      TotalTax: credit.credit.tax / 100,
      TaxLine: [
        {
          Amount: credit.credit.tax / 100,
          DetailType: "TaxLineDetail",
          TaxLineDetail: {
            TaxRateRef: { value: credit.taxRateRef },
            NetAmountTaxable: credit.credit.net / 100,
          },
        },
      ],
    },
  };
  return { p, invoice, payment, memo };
}
function mockProvider(t: Parameters<typeof fixture>[0], effect: Effect) {
  const original = globalThis.fetch,
    response = responses(effect),
    calls: { url: string; body: any }[] = [];
  let expense: any, link: any, rows: any[] | undefined;
  let change: (url: string, value: any) => any = (_url, value) => value;
  globalThis.fetch = async (url, init) => {
    const path = new URL(String(url)).pathname,
      body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: String(url), body });
    assert.match(
      String(url),
      /^https:\/\/sandbox-quickbooks\.api\.intuit\.com\/v3\/company\/123\//,
    );
    let data: any;
    if (path.endsWith("/preferences"))
      data = { Preferences: { SalesFormsPrefs: { AutoApplyCredit: false } } };
    else if (path.endsWith("/invoice/invoice-1"))
      data = { Invoice: structuredClone(response.invoice) };
    else if (path.endsWith("/payment/cash-1"))
      data = { Payment: structuredClone(response.payment) };
    else if (path.endsWith("/creditmemo/credit-1"))
      data = { CreditMemo: structuredClone(response.memo) };
    else if (path.includes("/account/"))
      data = {
        Account: {
          Id: path.split("/").at(-1),
          Active: true,
          AccountType: path.endsWith("bank-1") ? "Bank" : "Accounts Receivable",
          CurrencyRef: { value: "CAD" },
        },
      };
    else if (path.endsWith("/purchase") && body) {
      expense = { Id: "expense-1", ...body };
      data = { Purchase: expense };
    } else if (path.endsWith("/purchase/expense-1"))
      data = { Purchase: structuredClone(expense) };
    else if (path.endsWith("/payment") && body) {
      link = { Id: "link-1", UnappliedAmt: 0, ...body };
      data = { Payment: link };
    } else if (path.endsWith("/query")) {
      const isExpense = new URL(String(url)).searchParams
        .get("query")
        ?.includes("from Purchase");
      data = {
        QueryResponse: {
          [isExpense ? "Purchase" : "Payment"]: rows ?? [
            structuredClone(isExpense ? expense : link),
          ],
        },
      };
    } else throw Error(`Unexpected synthetic path ${path}`);
    return Response.json(change(path, data));
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  return {
    calls,
    response,
    change: (fn: typeof change) => {
      change = fn;
    },
    rows: (value: any[] | undefined) => {
      rows = value;
    },
    expense: () => expense,
    link: () => link,
  };
}

test("sandbox refund expense and exact zero-cash Expense/CreditMemo link send once and support bounded identity reads", async (t) => {
  const f = await setup(t),
    before = facts(f),
    effect = expenseEffect(f),
    mock = mockProvider(t, effect),
    adapter = new QuickBooksAdapter("123", async () => "synthetic", true);
  assert.equal(
    (await f.app.integration.execute(f.actor, effect.id, adapter)).state,
    "completed",
  );
  const posts = mock.calls.filter((c) => c.body);
  assert.equal(posts.length, 1);
  assert.equal(posts[0]!.body.TotalAmt, 50);
  assert.equal(
    posts[0]!.body.Line[0].AccountBasedExpenseLineDetail.AccountRef.value,
    "ar-1",
  );
  assert.equal(posts[0]!.body.TxnTaxDetail.TotalTax, 0);
  assert.equal((await adapter.lookup(effect))!.reference, "expense:expense-1");
  const queued = f.app.integration.accountingRefundApplication(
      f.actor,
      "link",
      { refundId: f.refundId },
    ),
    link = f.app.integration.effect(f.actor, queued.id);
  assert.equal(
    (await f.app.integration.execute(f.actor, link.id, adapter)).state,
    "completed",
  );
  assert.equal(mock.calls.filter((c) => c.body).length, 2);
  assert.equal(mock.link().TotalAmt, 0);
  assert.equal(mock.link().ProcessPayment, false);
  assert.deepEqual(
    mock.link().Line.map((l: any) => l.LinkedTxn[0].TxnType),
    ["Expense", "CreditMemo"],
  );
  assert.equal((await adapter.lookup(link))!.reference, "payment:link-1");
  mock.rows([]);
  assert.equal(await adapter.lookup(link), null);
  mock.rows([mock.link(), mock.link()]);
  await assert.rejects(adapter.lookup(link), { code: "ACCOUNTING_DUPLICATE" });
  mock.rows(undefined);
  mock.change((path, data) => {
    if (path.endsWith("/query"))
      data.QueryResponse.Payment[0].Line[0].LinkedTxn[0].TxnType = "Invoice";
    return data;
  });
  await assert.rejects(adapter.lookup(link), { code: "ACCOUNTING_MISMATCH" });
  assert.deepEqual(facts(f), before);
});

test("preflight rejects unpaid or altered originals, insufficient credit and wrong account mappings before any write", async (t) => {
  const f = await setup(t),
    effect = expenseEffect(f),
    mock = mockProvider(t, effect),
    adapter = new QuickBooksAdapter("123", async () => "synthetic", true);
  for (const [path, mutate, code] of [
    [
      "/preferences",
      (d: any) => {
        d.Preferences.SalesFormsPrefs.AutoApplyCredit = true;
      },
      "ACCOUNTING_CREDIT_AUTOMATION",
    ],
    [
      "/invoice/invoice-1",
      (d: any) => {
        d.Invoice.Balance = 1;
      },
      "ACCOUNTING_INVOICE_MISMATCH",
    ],
    [
      "/payment/cash-1",
      (d: any) => {
        d.Payment.Line[0].LinkedTxn[0].TxnId = "other";
      },
      "ACCOUNTING_MISMATCH",
    ],
    [
      "/creditmemo/credit-1",
      (d: any) => {
        d.CreditMemo.RemainingCredit = 49.99;
      },
      "ACCOUNTING_ALLOCATION",
    ],
    [
      "/account/bank-1",
      (d: any) => {
        d.Account.AccountType = "Credit Card";
      },
      "ACCOUNTING_ACCOUNT_MISMATCH",
    ],
    [
      "/account/ar-1",
      (d: any) => {
        d.Account.CurrencyRef.value = "USD";
      },
      "ACCOUNTING_ACCOUNT_MISMATCH",
    ],
  ] as const) {
    mock.change((p, data) => {
      if (p.endsWith(path)) mutate(data);
      return data;
    });
    await assert.rejects(adapter.execute(effect), { code });
  }
  assert.equal(mock.calls.filter((c) => c.body).length, 0);
});

test("changed expense receipt stays unknown and its exact lookup recovers without repeating the cash record", async (t) => {
  const f = await setup(t),
    before = facts(f),
    effect = expenseEffect(f),
    mock = mockProvider(t, effect),
    adapter = new QuickBooksAdapter("123", async () => "synthetic", true);
  mock.change((path, data) => {
    if (path.endsWith("/purchase"))
      return { Purchase: { ...data.Purchase, TotalAmt: 49.99 } };
    return data;
  });
  assert.equal(
    (await f.app.integration.execute(f.actor, effect.id, adapter)).state,
    "unknown",
  );
  mock.change((_p, data) => data);
  assert.equal(
    (await f.app.integration.reconcile(f.actor, effect.id, adapter)).state,
    "completed",
  );
  assert.equal(mock.calls.filter((c) => c.body).length, 1);
  assert.deepEqual(facts(f), before);
});

test("configured write rechecks native completion after preflight before posting", async (t) => {
  const f = await setup(t),
    effect = expenseEffect(f),
    mock = mockProvider(t, effect);
  const runtime = configuredProviders(f.app, {
    PROVIDERS_ENABLED: "true",
    PROVIDER_BINDING_ID: "synthetic",
    PROVIDER_ORG_ID: f.actor.orgId,
    PROVIDER_WORKER_USER_ID: f.actor.id,
    QUICKBOOKS_REALM_ID: "123",
    QUICKBOOKS_ACCESS_TOKEN: "synthetic",
  })!;
  mock.change((path, data) => {
    if (path.endsWith("/account/ar-1")) bankFailure(f);
    return data;
  });
  assert.equal((await runtime.execute(f.actor, effect.id)).state, "unknown");
  assert.equal(mock.calls.filter((c) => c.body).length, 0);
});

test("write checks fence a recovered claim and a revoked initiating principal after asynchronous preflight", async (t) => {
  for (const change of ["recover", "revoke"] as const) {
    await t.test(change, async (child) => {
      const f = await setup(child),
        effect = expenseEffect(f),
        mock = mockProvider(child, effect),
        adapter = new QuickBooksAdapter("123", async () => "synthetic", true);
      mock.change((path, data) => {
        if (path.endsWith("/account/ar-1")) {
          if (change === "recover")
            f.app.integration.recoverStale(-1, f.actor.orgId);
          else
            f.app.database
              .owned("iam")
              .run(
                "UPDATE iam_users SET role='commercial' WHERE id=?",
                f.actor.id,
              );
        }
        return data;
      });
      if (change === "revoke") {
        await assert.rejects(
          f.app.integration.execute(f.actor, effect.id, adapter),
          { code: "FORBIDDEN" },
        );
        assert.throws(() => f.app.integration.effect(f.actor, effect.id), {
          code: "FORBIDDEN",
        });
        assert.equal(
          f.app.database
            .owned("integration")
            .get("SELECT state FROM integration_effects WHERE id=?", effect.id)!
            .state,
          "unknown",
        );
      } else
        assert.equal(
          (await f.app.integration.execute(f.actor, effect.id, adapter)).state,
          "unknown",
        );
      assert.equal(mock.calls.filter((c) => c.body).length, 0);
    });
  }
});

test(
  "independent refund and invoice-credit processes share the same remaining credit",
  { timeout: 10000 },
  async (t) => {
    const f = await setup(t, 11300, 7000),
      children = [0, 1].map(() =>
        fork(new URL("./accounting-refund-child.ts", import.meta.url), [], {
          execArgv: ["--import", "tsx"],
          stdio: ["ignore", "pipe", "pipe", "ipc"],
        }),
      );
    t.after(() => children.forEach((c) => c.kill()));
    const receive = (c: (typeof children)[number]) =>
      new Promise<any>((resolve, reject) => {
        c.once("error", reject);
        c.once("message", resolve);
        c.once("exit", (code) => {
          if (code) reject(Error(`Child exit ${code}`));
        });
      });
    const ready = children.map(receive);
    children.forEach((c, i) =>
      c.send({
        action: "init",
        path: f.path,
        actor: f.actor,
        key: `race-${i}`,
        kind: i ? "credit" : "refund",
        input: i ? { creditId: f.creditId, amount: 7000 } : f.input,
      }),
    );
    await Promise.all(ready);
    const outcomes = children.map(receive);
    children.forEach((c) => c.send({ action: "go" }));
    const results = await Promise.all(outcomes);
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(results.find((r) => !r.ok).code, "ACCOUNTING_ALLOCATION");
    assert.equal(
      f.app.integration.list(f.actor).find((e) => e.id === f.postedCredit.id)!
        .creditApplication!.reservedAmount,
      7000,
    );
  },
);

test("expense reconciliation rejects ambiguous identities, changed accounts and nonzero tax without another write", async (t) => {
  const f = await setup(t),
    effect = expenseEffect(f),
    mock = mockProvider(t, effect),
    adapter = new QuickBooksAdapter("123", async () => "synthetic", true);
  await f.app.integration.execute(f.actor, effect.id, adapter);
  mock.rows([]);
  assert.equal(await adapter.lookup(effect), null);
  mock.rows([mock.expense(), mock.expense()]);
  await assert.rejects(adapter.lookup(effect), {
    code: "ACCOUNTING_DUPLICATE",
  });
  for (const alter of [
    (e: any) => {
      e.AccountRef.value = "different-bank";
    },
    (e: any) => {
      e.Line[0].AccountBasedExpenseLineDetail.CustomerRef.value =
        "other-customer";
    },
    (e: any) => {
      e.TxnTaxDetail = { TotalTax: 0, TaxLine: [{ Amount: 1 }] };
    },
    (e: any) => {
      e.TxnTaxDetail = { TotalTax: 1 };
    },
    (e: any) => {
      e.DocNumber = "different-refund";
    },
  ]) {
    const changed = structuredClone(mock.expense());
    alter(changed);
    mock.rows([changed]);
    await assert.rejects(adapter.lookup(effect), {
      code: "ACCOUNTING_MISMATCH",
    });
  }
  assert.equal(mock.calls.filter((c) => c.body).length, 1);
  assert.ok(
    mock.calls
      .filter((c) => c.url.includes("/query?"))
      .every((c) =>
        new URL(c.url).searchParams.get("query")!.endsWith("maxresults 2"),
      ),
  );
});

test("confirmed accounting expense is retained when native cash or customer permission changes during the authorized POST", async (t) => {
  for (const change of ["native-reversal", "permission-withdrawal"] as const) {
    await t.test(change, async (child) => {
      const f = await setup(child),
        effect = expenseEffect(f),
        mock = mockProvider(child, effect),
        adapter = new QuickBooksAdapter("123", async () => "synthetic", true);
      let afterChange: ReturnType<typeof facts>;
      mock.change((path, data) => {
        if (path.endsWith("/purchase")) {
          if (change === "native-reversal") bankFailure(f);
          else
            chooseProviders(f, f.actor, "withdraw-during-post", {
              accountId: f.buyer,
              region: "CA",
              mode: "strict",
              providers: [],
              version: 2,
              acknowledgment:
                "Synthetic withdrawal during already authorized I/O",
            });
          afterChange = facts(f);
        }
        return data;
      });
      assert.equal(
        (await f.app.integration.execute(f.actor, effect.id, adapter)).state,
        "completed",
      );
      assert.equal(
        f.app.integration.effect(f.actor, effect.id).external_ref,
        "expense:expense-1",
      );
      assert.deepEqual(facts(f), afterChange!);
      const row = f.app.integration
        .list(f.actor)
        .find((e) => e.id === effect.id)!;
      assert.equal(
        row.accountingRefund!.requiresReview,
        change === "native-reversal",
      );
      assert.throws(
        () =>
          f.app.integration.accountingRefundApplication(
            f.actor,
            "link-after-change",
            { refundId: f.refundId },
          ),
        {
          code:
            change === "native-reversal"
              ? "ACCOUNTING_REFUND_REQUIRED"
              : "RESIDENCY_BLOCKED",
        },
      );
      assert.equal(mock.calls.filter((c) => c.body).length, 1);
    });
  }
});

test("the final asynchronous token step cannot bypass consent or restore holds before a refund POST", async (t) => {
  for (const change of ["permission-withdrawal", "restore"] as const) {
    await t.test(change, async (child) => {
      const f = await setup(child),
        effect = expenseEffect(f),
        mock = mockProvider(child, effect);
      let tokens = 0;
      const adapter = new QuickBooksAdapter(
        "123",
        async () => {
          await Promise.resolve();
          if (++tokens === 7) {
            if (change === "restore")
              f.app.platform.isolateRestore(
                "synthetic",
                new Date().toISOString(),
              );
            else
              chooseProviders(f, f.actor, "withdraw-at-token", {
                accountId: f.buyer,
                region: "CA",
                mode: "strict",
                providers: [],
                version: 2,
                acknowledgment:
                  "Synthetic withdrawal after final preflight read",
              });
          }
          return "synthetic";
        },
        true,
      );
      assert.equal(
        (await f.app.integration.execute(f.actor, effect.id, adapter)).state,
        "unknown",
      );
      assert.equal(tokens, 7);
      assert.equal(mock.calls.filter((c) => c.body).length, 0);
    });
  }
});

test("a late native reversal after reading the expense blocks its zero-cash link POST", async (t) => {
  const f = await setup(t),
    effect = expenseEffect(f),
    mock = mockProvider(t, effect),
    adapter = new QuickBooksAdapter("123", async () => "synthetic", true);
  await f.app.integration.execute(f.actor, effect.id, adapter);
  const queued = f.app.integration.accountingRefundApplication(
    f.actor,
    "late-link",
    { refundId: f.refundId },
  );
  mock.change((path, data) => {
    if (path.endsWith("/purchase/expense-1")) bankFailure(f);
    return data;
  });
  assert.equal(
    (await f.app.integration.execute(f.actor, queued.id, adapter)).state,
    "unknown",
  );
  assert.equal(mock.calls.filter((c) => c.body).length, 1);
  assert.equal(
    f.app.integration.list(f.actor).find((e) => e.id === queued.id)!
      .accountingRefund!.requiresReview,
    true,
  );
});
