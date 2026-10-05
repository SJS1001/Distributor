import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, accept, ship, chooseProviders } from "./fixtures.ts";
import { DemoProviderRuntime } from "../src/demo/payments.ts";
import { DemoAccounting } from "../src/demo/accounting.ts";

function setup(t: Parameters<typeof fixture>[0]) {
  const f = fixture(t);
  const invoiceId = ship(f, accept(f, 2).id).invoiceId;
  chooseProviders(f, f.actor, "consent", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["quickbooks", "stripe"],
    version: 1,
    acknowledgment: "Fictional simulation only",
  });
  const parent = f.app.integration.accounting(f.actor, "invoice", {
    invoiceId,
    customerRef: "demo-customer",
    itemRefs: { [f.product]: "demo-item" },
    taxCodeRef: "demo-tax",
    taxRateRef: "demo-rate",
  });
  const runtime = new DemoProviderRuntime(f.app, f.actor);
  return { ...f, invoiceId, parent, runtime };
}
function credit(f: ReturnType<typeof setup>) {
  return f.app.billing.issueCredit(f.actor, "credit", {
    invoiceId: f.invoiceId,
    reference: "DEMO-CREDIT",
    reason: "Fictional return",
    lines: [
      {
        lineId: String(f.app.billing.lines(f.actor, f.invoiceId)[0]!.id),
        quantity: 1,
      },
    ],
  });
}

test("demo accounting delivers invoices and applies credits through native commands without altering native money", async (t) => {
  const f = setup(t);
  await f.runtime.tick();
  assert.equal(
    f.app.integration.effect(f.actor, f.parent.id).state,
    "completed",
  );
  const before = await f.runtime.refreshAccountingBalance(
    f.actor,
    f.parent.id,
    "before",
  );
  assert.equal(before.providerBalance, 22600);
  const c = credit(f);
  f.app.integration.accountingCredit(f.actor, "post-credit", {
    creditId: c.id,
  });
  await f.runtime.tick();
  const native = f.app.billing.totals(f.actor, f.invoiceId);
  const application = f.app.integration.accountingCreditApplication(
    f.actor,
    "apply-credit",
    { creditId: c.id, amount: 11300 },
  );
  await f.runtime.tick();
  assert.equal(
    f.app.integration.effect(f.actor, application.id).state,
    "completed",
  );
  const after = await f.runtime.refreshAccountingBalance(
    f.actor,
    f.parent.id,
    "after",
  );
  assert.equal(after.providerBalance, 11300);
  assert.equal(after.difference, 0);
  assert.deepEqual(f.app.billing.totals(f.actor, f.invoiceId), native);
  await f.runtime.tick();
  assert.equal(
    (await f.runtime.refreshAccountingBalance(f.actor, f.parent.id, "retry"))
      .providerBalance,
    11300,
  );
});

test("demo cash payment, refund expense and credit linkage finish the native accounting sequence", async (t) => {
  const f = setup(t);
  f.app.integration.checkout(f.actor, "checkout", { invoiceId: f.invoiceId });
  await f.runtime.tick();
  const payment = f.app.billing.refunds
    .payments(f.actor)
    .find((p) => p.invoice_id === f.invoiceId)!;
  const cash = f.app.integration.accountingPayment(f.actor, "cash", {
    paymentId: String(payment.id),
    appliedAmount: 22600,
    depositAccountRef: "demo-bank",
  });
  await f.runtime.tick();
  assert.equal(f.app.integration.effect(f.actor, cash.id).state, "completed");
  const c = credit(f);
  f.app.integration.accountingCredit(f.actor, "post-credit", {
    creditId: c.id,
  });
  const refund = f.app.billing.refundRequest(f.actor, "refund", {
    invoiceId: f.invoiceId,
    paymentId: String(payment.id),
    amount: 11300,
    reference: "DEMO-REFUND",
    reason: "Fictional return",
  });
  f.app.integration.refund(f.actor, "send-refund", { refundId: refund.id });
  await f.runtime.tick();
  const expense = f.app.integration.accountingRefund(f.actor, "expense", {
    refundId: refund.id,
    creditId: c.id,
    bankAccountRef: "demo-bank",
    receivableAccountRef: "demo-ar",
    nonTaxCodeRef: "demo-non",
    expenseDate: new Date().toISOString().slice(0, 10),
  });
  await f.runtime.tick();
  assert.equal(
    f.app.integration.effect(f.actor, expense.id).state,
    "completed",
  );
  const apply = f.app.integration.accountingRefundApplication(f.actor, "link", {
    refundId: refund.id,
  });
  const native = f.app.billing.totals(f.actor, f.invoiceId);
  await f.runtime.tick();
  assert.equal(f.app.integration.effect(f.actor, apply.id).state, "completed");
  assert.equal(
    JSON.parse(f.app.integration.effect(f.actor, apply.id).result!).simulated,
    true,
  );
  assert.deepEqual(f.app.billing.totals(f.actor, f.invoiceId), native);
  const balance = await f.runtime.refreshAccountingBalance(
    f.actor,
    f.parent.id,
    "balance",
  );
  assert.equal(balance.providerBalance, 0);
  assert.equal(balance.difference, 0);
  assert.equal(native.refunded, 11300);
});

test("accounting simulation honors final refusal, detached results, identity and workspace boundaries", async (t) => {
  const f = setup(t),
    a = new DemoAccounting(),
    b = new DemoAccounting();
  const effect = f.app.integration.effect(f.actor, f.parent.id);
  await assert.rejects(
    a.execute(effect, () => {
      throw new Error("revoked");
    }),
    /revoked/,
  );
  assert.equal(await a.lookup(effect), null);
  const first = await a.execute(effect);
  first.result.total = 1;
  assert.equal((await a.lookup(effect))!.result.total, 22600);
  assert.equal(await b.lookup(effect), null);
  await assert.rejects(a.lookup({ ...effect, org_id: "foreign" }), {
    code: "ACCOUNTING_MISMATCH",
  });
  await assert.rejects(a.execute({ ...effect, payload: "{}" }), {
    code: "ACCOUNTING_MISMATCH",
  });
  assert.equal((await a.execute(effect)).reference, first.reference);
  const completed = {
    ...effect,
    state: "completed",
    external_ref: first.reference,
  };
  const balance = await a.readInvoiceBalance(completed);
  balance.balance = 1;
  assert.equal((await a.readInvoiceBalance(completed)).balance, 22600);
  await assert.rejects(b.readInvoiceBalance(completed), {
    code: "ACCOUNTING_INVOICE_REQUIRED",
  });
});

test("customer withdrawal and revoked finance grants stop simulated accounting", async (t) => {
  const f = setup(t);
  chooseProviders(f, f.actor, "withdraw", {
    accountId: f.buyer,
    region: "CA",
    mode: "strict",
    providers: [],
    version: 2,
    acknowledgment: "Withdraw fictional permission",
  });
  await f.runtime.tick();
  assert.notEqual(
    f.app.integration.effect(f.actor, f.parent.id).state,
    "completed",
  );
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='support' WHERE id=?", f.actor.id);
  await assert.rejects(f.runtime.tick(), { code: "FORBIDDEN" });
});
