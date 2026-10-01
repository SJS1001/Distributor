import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { fixture, accept, ship } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { QuickBooksAdapter } from "../src/server/providers.ts";
import type {
  Adapter,
  AccountingPaymentIntent,
  EffectResult,
} from "../src/server/integration.ts";
import { createHttp } from "../src/server/http.ts";

async function setup(t: Parameters<typeof fixture>[0], amount = 11300) {
  const f = fixture(t),
    invoiceId = ship(f, accept(f).id).invoiceId;
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
    execute: async () => ({
      reference: "invoice-1",
      result: { total: 11300, currency: "CAD" },
    }),
    lookup: async () => null,
  });
  const paymentId = f.app.billing.verifiedPayment(
    f.actor,
    invoiceId,
    amount,
    "stripe",
    "pi_synthetic",
  ).id;
  return Object.assign(f, {
    invoiceId,
    parent,
    paymentId,
    input: {
      paymentId,
      appliedAmount: Math.min(11300, amount),
      depositAccountRef: "bank-1",
    },
  });
}
const result: EffectResult = {
  reference: "payment:payment-1",
  result: { amount: 11300, appliedAmount: 11300, currency: "CAD" },
};
const adapter: Adapter = {
  execute: async () => result,
  lookup: async () => result,
};
function facts(f: Awaited<ReturnType<typeof setup>>) {
  return {
    payments: f.app.billing.refunds.payments(f.actor),
    totals: f.app.billing.totals(f.actor, f.invoiceId),
    stock: f.app.inventory.stock(f.actor),
    invoices: f.app.billing.invoices(f.actor),
  };
}

test("accounting cash intent freezes native payment and mappings, survives restart and never changes native money/stock", async (t) => {
  const f = await setup(t, 12000),
    before = facts(f);
  const queued = f.app.integration.accountingPayment(f.actor, "queue", f.input);
  const payload = JSON.parse(
    f.app.integration.effect(f.actor, queued.id).payload,
  ) as AccountingPaymentIntent;
  assert.equal(payload.payment.amount, 12000);
  assert.equal(payload.payment.external_ref, "pi_synthetic");
  assert.equal(payload.externalInvoiceRef, "invoice-1");
  assert.equal(payload.customerRef, "customer-1");
  assert.match(payload.paymentRef, /^DP-[a-f0-9]{18}$/);
  assert.deepEqual(
    f.app.integration.accountingPayment(f.actor, "other-key", f.input),
    queued,
  );
  assert.throws(
    () =>
      f.app.integration.accountingPayment(f.actor, "changed", {
        ...f.input,
        depositAccountRef: "bank-2",
      }),
    { code: "EFFECT_CONFLICT" },
  );
  assert.throws(
    () =>
      f.app.integration.accountingPayment(f.actor, "queue", {
        ...f.input,
        appliedAmount: 0,
      }),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(
    f.app.integration.accountingPayment(f.actor, "queue", f.input),
    queued,
  );
  await f.app.integration.execute(f.actor, queued.id, adapter);
  assert.deepEqual(facts(f), before);
  assert.equal(
    f.app.database
      .owned("integration")
      .all("SELECT * FROM integration_payment_allocations").length,
    1,
  );
  assert.equal(
    f.app.integration.accountingPayment(f.actor, "latest", f.input).state,
    "completed",
  );
});

test("accounting cash requires completed invoice, bounded integer application and current scoped finance authority before cached retries", async (t) => {
  const f = await setup(t);
  f.app.database
    .owned("integration")
    .run(
      "UPDATE integration_effects SET state='unknown' WHERE id=?",
      f.parent.id,
    );
  assert.throws(
    () => f.app.integration.accountingPayment(f.actor, "pending", f.input),
    { code: "ACCOUNTING_INVOICE_REQUIRED" },
  );
  f.app.database
    .owned("integration")
    .run(
      "UPDATE integration_effects SET state='completed' WHERE id=?",
      f.parent.id,
    );
  for (const appliedAmount of [-1, 11301, 0.5, NaN])
    assert.throws(
      () =>
        f.app.integration.accountingPayment(f.actor, "invalid", {
          ...f.input,
          appliedAmount,
        }),
      { code: "VALIDATION" },
    );
  assert.throws(
    () =>
      f.app.integration.accountingPayment(f.actor, "blank", {
        ...f.input,
        depositAccountRef: " ",
      }),
    { code: "VALIDATION" },
  );
  assert.throws(
    () =>
      f.app.integration.accountingPayment(f.actor, "missing", {
        ...f.input,
        paymentId: "missing",
      }),
    { code: "NOT_FOUND" },
  );
  f.app.integration.accountingPayment(f.actor, "queue", f.input);
  const iam = f.app.database.owned("iam");
  for (const role of ["commercial", "support", "buyer"]) {
    iam.run(
      "UPDATE iam_users SET role=?,account_id=? WHERE id=?",
      role,
      role === "buyer" ? f.buyer : null,
      f.actor.id,
    );
    assert.throws(
      () => f.app.integration.accountingPayment(f.actor, "queue", f.input),
      { code: "FORBIDDEN" },
    );
    if (["commercial", "buyer"].includes(role)) {
      const visible = f.app.integration.list(
        f.app.identity.currentActor(f.actor),
      );
      assert.equal(
        visible.some((e) => e.kind === "invoice"),
        true,
      );
      assert.equal(
        visible.some((e) => e.kind === "payment"),
        false,
      );
    }
  }
  iam.run(
    "UPDATE iam_users SET role='admin',account_id=NULL,active=0 WHERE id=?",
    f.actor.id,
  );
  assert.throws(
    () => f.app.integration.accountingPayment(f.actor, "queue", f.input),
    { code: "FORBIDDEN" },
  );
  iam.run("UPDATE iam_users SET active=1 WHERE id=?", f.actor.id);
  iam.run(
    "INSERT INTO iam_user_security(user_id,revision,password_change_required,updated_at) VALUES(?,1,1,?)",
    f.actor.id,
    new Date().toISOString(),
  );
  assert.throws(
    () => f.app.integration.accountingPayment(f.actor, "queue", f.input),
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
    acknowledgment: "Withdraw synthetic permission",
  });
  assert.throws(
    () => f.app.integration.accountingPayment(f.actor, "queue", f.input),
    { code: "RESIDENCY_BLOCKED" },
  );
  f.app.identity.residencyChoice(f.actor, "allow", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["quickbooks"],
    version: 3,
    acknowledgment: "Restore synthetic permission",
  });
  f.app.platform.isolateRestore("synthetic", new Date().toISOString());
  assert.throws(
    () => f.app.integration.accountingPayment(f.actor, "queue", f.input),
    { code: "RECOVERY_HOLD" },
  );
});

test("pending and unknown cash applications reserve original invoice capacity; unapplied excess remains available", async (t) => {
  const f = await setup(t, 8000),
    other = f.app.billing.verifiedPayment(
      f.actor,
      f.invoiceId,
      8000,
      "stripe",
      "pi_other",
    ).id;
  const one = f.app.integration.accountingPayment(f.actor, "one", f.input);
  let sends = 0;
  await f.app.integration.execute(f.actor, one.id, {
    ...adapter,
    execute: async () => {
      sends++;
      throw Error("synthetic lost response");
    },
  });
  assert.equal(f.app.integration.effect(f.actor, one.id).state, "unknown");
  assert.throws(
    () =>
      f.app.integration.accountingPayment(f.actor, "two", {
        ...f.input,
        paymentId: other,
      }),
    { code: "ACCOUNTING_ALLOCATION" },
  );
  const two = f.app.integration.accountingPayment(f.actor, "unapplied", {
    ...f.input,
    paymentId: other,
    appliedAmount: 3300,
  });
  await assert.rejects(f.app.integration.execute(f.actor, one.id, adapter), {
    code: "STATE",
  });
  await f.app.integration.reconcile(f.actor, one.id, {
    ...adapter,
    lookup: async () => null,
  });
  assert.equal(f.app.integration.effect(f.actor, one.id).state, "unknown");
  await f.app.integration.reconcile(f.actor, one.id, adapter);
  assert.equal(f.app.integration.effect(f.actor, one.id).state, "completed");
  assert.equal(f.app.integration.effect(f.actor, two.id).state, "pending");
  assert.equal(sends, 1);
  assert.equal(
    f.app.database
      .owned("integration")
      .get<{ amount: number }>(
        "SELECT SUM(applied_amount) AS amount FROM integration_payment_allocations",
      )!.amount,
    11300,
  );
});

test("late event failure rolls accounting intent, allocation and command receipt back together", async (t) => {
  const f = await setup(t),
    audit = t.mock.method(f.app.platform, "audit", () => {
      throw Error("synthetic late audit failure");
    });
  assert.throws(
    () => f.app.integration.accountingPayment(f.actor, "queue", f.input),
    /late audit/,
  );
  audit.mock.restore();
  assert.equal(
    f.app.integration.list(f.actor).filter((e) => e.kind === "payment").length,
    0,
  );
  assert.equal(
    f.app.database
      .owned("integration")
      .all("SELECT * FROM integration_payment_allocations").length,
    0,
  );
  const queued = f.app.integration.accountingPayment(f.actor, "queue", f.input);
  assert.equal(queued.state, "pending");
});

test("QuickBooks cash adapter verifies external invoice before posting and binds every returned payment field", async (t) => {
  const f = await setup(t, 12000),
    queued = f.app.integration.accountingPayment(f.actor, "queue", f.input),
    effect = f.app.integration.effect(f.actor, queued.id),
    p = JSON.parse(effect.payload) as AccountingPaymentIntent;
  const qbo = new QuickBooksAdapter(
    "12345",
    async () => "synthetic-token",
    true,
  );
  const validInvoice = {
    Id: "invoice-1",
    DocNumber: p.invoice.number,
    CustomerRef: { value: p.customerRef },
    CurrencyRef: { value: "CAD" },
    TotalAmt: 113,
    Balance: 113,
    PrivateNote: `Distributor effect ${p.invoiceEffectId}`,
  };
  const valid = {
    Id: "payment-1",
    TotalAmt: 120,
    UnappliedAmt: 7,
    CustomerRef: { value: p.customerRef },
    CurrencyRef: { value: "CAD" },
    DepositToAccountRef: { value: "bank-1" },
    TxnDate: p.payment.created_at.slice(0, 10),
    PaymentRefNum: p.paymentRef,
    PrivateNote: `Distributor effect ${effect.id}`,
    ProcessPayment: false,
    Line: [
      { Amount: 113, LinkedTxn: [{ TxnId: "invoice-1", TxnType: "Invoice" }] },
    ],
  };
  let invoice: any = validInvoice,
    payment: any = valid,
    rows = [valid];
  const fetch = t.mock.method(
    globalThis,
    "fetch",
    async (url: string | URL | Request, init?: RequestInit) =>
      new Response(
        JSON.stringify(
          String(url).includes("/query?")
            ? { QueryResponse: { Payment: rows } }
            : init?.method === "POST"
              ? { Payment: payment }
              : { Invoice: invoice },
        ),
        { status: 200 },
      ),
  );
  const sent = await qbo.execute(effect);
  assert.equal(sent.reference, "payment:payment-1");
  assert.equal(sent.result.unappliedAmount, 700);
  const [target, init] = fetch.mock.calls[1]!.arguments;
  assert.equal(
    new URL(String(target)).hostname,
    "sandbox-quickbooks.api.intuit.com",
  );
  assert.equal(
    new URL(String(target)).searchParams.get("requestid"),
    effect.id,
  );
  const body = JSON.parse(String(init!.body));
  assert.equal(body.ProcessPayment, false);
  assert.equal(body.TotalAmt, 120);
  assert.equal(body.Line[0].LinkedTxn[0].TxnId, "invoice-1");
  assert.equal(body.DepositToAccountRef.value, "bank-1");
  for (const change of [
    { Id: "wrong" },
    { CustomerRef: { value: "other" } },
    { CurrencyRef: { value: "USD" } },
    { TotalAmt: 113.001 },
    { Balance: 112.99 },
    { Balance: 113.001 },
    { PrivateNote: "unrelated" },
  ]) {
    invoice = { ...validInvoice, ...change };
    const count = fetch.mock.calls.length;
    await assert.rejects(qbo.execute(effect), {
      code: "ACCOUNTING_INVOICE_MISMATCH",
    });
    assert.equal(fetch.mock.calls.length, count + 1); // No cash POST after a bad read.
  }
  invoice = validInvoice;
  for (const change of [
    { Id: "" },
    { TotalAmt: 120.001 },
    { UnappliedAmt: 0 },
    { PrivateNote: "other" },
    { PaymentRefNum: "other" },
    { CustomerRef: { value: "other" } },
    { CurrencyRef: { value: "USD" } },
    { DepositToAccountRef: { value: "other" } },
    { TxnDate: "2000-01-01" },
    { ProcessPayment: true },
    { Line: [] },
    {
      Line: [
        {
          ...valid.Line[0],
          LinkedTxn: [{ TxnId: "other", TxnType: "Invoice" }],
        },
      ],
    },
  ]) {
    payment = { ...valid, ...change };
    rows = [payment];
    await assert.rejects(qbo.execute(effect), { code: "ACCOUNTING_MISMATCH" });
    await assert.rejects(qbo.lookup(effect), { code: "ACCOUNTING_MISMATCH" });
  }
  rows = [valid];
  assert.deepEqual(await qbo.lookup(effect), sent);
  const query = new URL(
    String(fetch.mock.calls.at(-1)!.arguments[0]),
  ).searchParams.get("query");
  assert.equal(
    query,
    `select * from Payment where PaymentRefNum = '${p.paymentRef}' maxresults 2`,
  );
  rows = [valid, valid];
  await assert.rejects(qbo.lookup(effect), { code: "ACCOUNTING_DUPLICATE" });
  rows = [];
  assert.equal(await qbo.lookup(effect), null);
  const count = fetch.mock.calls.length;
  for (const kind of ["shipment", "checkout"]) {
    await assert.rejects(qbo.execute({ ...effect, kind }), {
      code: "PROVIDER_OPERATION",
    });
    await assert.rejects(qbo.lookup({ ...effect, kind }), {
      code: "PROVIDER_OPERATION",
    });
  }
  await assert.rejects(
    new QuickBooksAdapter("12345", async () => "unused").execute(effect),
    { code: "PROVIDER_DISABLED" },
  );
  assert.equal(fetch.mock.calls.length, count);
});

test("fully unapplied cash has no invoice link and rejects a substituted application", async (t) => {
  const f = await setup(t),
    queued = f.app.integration.accountingPayment(f.actor, "queue", {
      ...f.input,
      appliedAmount: 0,
    }),
    effect = f.app.integration.effect(f.actor, queued.id),
    p = JSON.parse(effect.payload) as AccountingPaymentIntent;
  const valid = {
    Id: "cash-1",
    TotalAmt: 113,
    UnappliedAmt: 113,
    CustomerRef: { value: "customer-1" },
    CurrencyRef: { value: "CAD" },
    DepositToAccountRef: { value: "bank-1" },
    TxnDate: p.payment.created_at.slice(0, 10),
    PaymentRefNum: p.paymentRef,
    PrivateNote: `Distributor effect ${effect.id}`,
    Line: [],
  };
  let row: any = valid;
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(JSON.stringify({ QueryResponse: { Payment: [row] } }), {
        status: 200,
      }),
  );
  const qbo = new QuickBooksAdapter("12345", async () => "synthetic", true);
  assert.equal((await qbo.lookup(effect))!.result.appliedAmount, 0);
  row = {
    ...valid,
    Line: [{ Amount: 0, LinkedTxn: [{ TxnId: "other", TxnType: "Invoice" }] }],
  };
  await assert.rejects(qbo.lookup(effect), { code: "ACCOUNTING_MISMATCH" });
});

test("HTTP accounting cash command rejects forged fields, lost responses retry one intent, and foreign payment IDs stay isolated", async (t) => {
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
  const cookie = login.cookies[0]!,
    headers = {
      origin,
      cookie: `${cookie.name}=${cookie.value}`,
      "x-csrf-token": login.json().csrf,
      "idempotency-key": "http-cash",
    };
  const post = (payload: any) =>
    http.inject({
      method: "POST",
      url: "/api/commands/quickbooks.payment",
      headers,
      payload,
    });
  assert.equal((await post({ ...f.input, amount: 1 })).statusCode, 400);
  const queued = await post(f.input);
  assert.equal(queued.statusCode, 200);
  assert.deepEqual((await post(f.input)).json(), queued.json());
  assert.equal(
    (await post({ ...f.input, appliedAmount: 1 })).json().code,
    "IDEMPOTENCY_CONFLICT",
  );
  const other = fixture(t),
    foreign = ship(other, accept(other).id).invoiceId;
  const foreignPayment = other.app.billing.verifiedPayment(
    other.actor,
    foreign,
    100,
    "manual",
    "foreign",
  ).id;
  // An actual foreign-organization row in the same store must stay inaccessible.
  const foreignRow = other.app.billing.recordedPayment(
    other.actor,
    foreignPayment,
  );
  f.app.database
    .owned("billing")
    .run(
      "INSERT INTO billing_payments VALUES(?,?,?,?,?,?,?)",
      foreignRow.id,
      foreignRow.org_id,
      foreignRow.invoice_id,
      foreignRow.provider,
      foreignRow.external_ref,
      foreignRow.amount,
      foreignRow.created_at,
    );
  assert.equal(
    (await post({ ...f.input, paymentId: foreignPayment })).json().code,
    "NOT_FOUND",
  );
  assert.equal(
    f.app.integration.list(f.actor).filter((e) => e.kind === "payment").length,
    1,
  );
});

test(
  "separate processes cannot reserve more cash application than the original invoice",
  { timeout: 10000 },
  async (t) => {
    const f = await setup(t, 8000),
      other = f.app.billing.verifiedPayment(
        f.actor,
        f.invoiceId,
        8000,
        "stripe",
        "pi_second",
      ).id;
    const children = [f.paymentId, other].map(() =>
      fork(new URL("./accounting-payment-child.ts", import.meta.url), [], {
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      }),
    );
    t.after(() => children.forEach((child) => child.kill()));
    const ready = children.map(
      (child) =>
        new Promise<void>((resolve, reject) => {
          child.once("error", reject);
          child.once("message", () => resolve());
        }),
    );
    children.forEach((child, i) =>
      child.send({
        action: "init",
        path: f.path,
        actor: f.actor,
        paymentId: [f.paymentId, other][i],
      }),
    );
    await Promise.all(ready);
    const outcomes = children.map(
      (child) =>
        new Promise<any>((resolve, reject) => {
          child.once("error", reject);
          child.once("message", resolve);
        }),
    );
    children.forEach((child) => child.send({ action: "go" }));
    const results = await Promise.all(outcomes);
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(
      results.filter((r) => !r.ok && r.code === "ACCOUNTING_ALLOCATION").length,
      1,
    );
    assert.equal(
      f.app.database
        .owned("integration")
        .get<{ amount: number }>(
          "SELECT SUM(applied_amount) AS amount FROM integration_payment_allocations",
        )!.amount,
      8000,
    );
  },
);
