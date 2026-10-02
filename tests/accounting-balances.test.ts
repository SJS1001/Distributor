import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { chooseProviders, fixture, accept, ship } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { QuickBooksAdapter } from "../src/server/providers.ts";
import { ProviderRuntime } from "../src/server/provider-runtime.ts";
import { createHttp } from "../src/server/http.ts";
import type { Adapter, Effect } from "../src/server/integration.ts";

async function setup(t: Parameters<typeof fixture>[0]) {
  const f = fixture(t),
    invoiceId = ship(f, accept(f).id).invoiceId;
  chooseProviders(f, f.actor, "choice", {
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
  return Object.assign(f, { invoiceId, parent });
}
const adapter = (balance = 11300): Adapter => ({
  execute: async () => {
    throw Error("never send");
  },
  lookup: async () => null,
  readInvoiceBalance: async (effect) => ({
    reference: effect.external_ref!,
    total: 11300,
    currency: "CAD",
    balance,
    syncToken: "1",
  }),
});
function facts(f: Awaited<ReturnType<typeof setup>>) {
  return {
    // Owning facts remain comparable after password authority is revoked.
    stock: f.app.database
      .owned("inventory")
      .all(
        "SELECT * FROM inventory_units WHERE org_id=? ORDER BY id",
        f.actor.orgId,
      ),
    // Independent owning-store oracle can compare conserved native facts
    // after authority is revoked; public order reads must deny that actor.
    orders: f.app.database
      .owned("orders")
      .all(
        "SELECT * FROM orders_orders WHERE org_id=? ORDER BY id",
        f.actor.orgId,
      ),
    orderLines: f.app.database
      .owned("orders")
      .all(
        "SELECT * FROM orders_lines WHERE org_id=? ORDER BY id",
        f.actor.orgId,
      ),
    invoices: f.app.database
      .owned("billing")
      .all(
        "SELECT * FROM billing_invoices WHERE org_id=? ORDER BY id",
        f.actor.orgId,
      ),
    credits: f.app.database
      .owned("billing")
      .all(
        "SELECT * FROM billing_credits WHERE org_id=? ORDER BY id",
        f.actor.orgId,
      ),
    payments: f.app.database
      .owned("billing")
      .all(
        "SELECT * FROM billing_payments WHERE org_id=? ORDER BY id",
        f.actor.orgId,
      ),
    // Independent native-state oracle remains readable after the test revokes
    // the captured actor's password authority; the public read must deny it.
    refunds: f.app.database
      .owned("billing")
      .all(
        "SELECT * FROM billing_refunds WHERE org_id=? ORDER BY id",
        f.actor.orgId,
      ),
    effect: f.app.integration.effect(f.actor, f.parent.id),
  };
}

test("balance observations compare original money without changing native facts and retain retries across restart", async (t) => {
  const f = await setup(t),
    before = facts(f);
  let calls = 0;
  const a = adapter();
  a.readInvoiceBalance = async (effect) => {
    calls++;
    return {
      reference: effect.external_ref!,
      total: 11300,
      currency: "CAD",
      balance: 5000,
      syncToken: "2",
    };
  };
  const first = await f.app.integration.balances.refresh(
    f.actor,
    f.parent.id,
    "read",
    a,
  );
  assert.equal(first.difference, -6300);
  assert.equal(first.nativeBalance, 11300);
  assert.equal(calls, 1);
  assert.deepEqual(facts(f), before);
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(
    await f.app.integration.balances.refresh(f.actor, f.parent.id, "read", a),
    first,
  );
  assert.equal(calls, 1);
  const second = await f.app.integration.balances.refresh(
    f.actor,
    f.parent.id,
    "second",
    adapter(),
  );
  assert.equal(second.difference, 0);
  assert.deepEqual(
    f.app.integration.balances.history(f.actor, f.parent.id, { limit: 1 }),
    { items: [first], next: first.sequence },
  );
  assert.deepEqual(
    f.app.integration.balances.history(f.actor, f.parent.id, {
      after: first.sequence,
      limit: 1,
    }),
    { items: [second], next: null },
  );
  assert.deepEqual(
    f.app.integration.list(f.actor).find((e) => e.id === f.parent.id)
      ?.accountingBalance,
    second,
  );
  assert.deepEqual(facts(f), before);
  assert.throws(
    () =>
      f.app.integration.balances.history(f.actor, f.parent.id, { limit: 101 }),
    { code: "VALIDATION" },
  );
});

test("a paid invoice and credit snapshot exposes an unapplied difference; native changes during a read use completion-time money", async (t) => {
  const f = await setup(t);
  f.app.billing.verifiedPayment(
    f.actor,
    f.invoiceId,
    11300,
    "stripe",
    "pi_synthetic",
  );
  const line = f.app.billing.lines(f.actor, f.invoiceId)[0]!;
  const a = adapter(0);
  a.readInvoiceBalance = async (effect) => {
    f.app.billing.issueCredit(f.actor, "credit", {
      invoiceId: f.invoiceId,
      reference: "synthetic-credit",
      reason: "Synthetic",
      lines: [{ lineId: line.id, quantity: 1 }],
    });
    return {
      reference: effect.external_ref!,
      total: 11300,
      currency: "CAD",
      balance: 0,
      syncToken: "3",
    };
  };
  const observation = await f.app.integration.balances.refresh(
    f.actor,
    f.parent.id,
    "read",
    a,
  );
  assert.equal(observation.paid, 11300);
  assert.equal(observation.credited, 11300);
  assert.equal(observation.refunded, 0);
  assert.equal(observation.nativeBalance, -11300);
  assert.equal(observation.difference, 11300);
});

test("current finance, password, consent and restore clearance precede cached observations; history stays scoped", async (t) => {
  const f = await setup(t);
  await f.app.integration.balances.refresh(
    f.actor,
    f.parent.id,
    "read",
    adapter(),
  );
  const iam = f.app.database.owned("iam");
  for (const role of ["support", "commercial", "buyer"]) {
    iam.run(
      "UPDATE iam_users SET role=?,account_id=? WHERE id=?",
      role,
      role === "buyer" ? f.buyer : null,
      f.actor.id,
    );
    await assert.rejects(
      f.app.integration.balances.refresh(
        f.actor,
        f.parent.id,
        "read",
        adapter(),
      ),
      { code: "FORBIDDEN" },
    );
    const current = f.app.identity.currentActor(f.actor);
    assert.equal(
      f.app.integration.list(current).find((e) => e.id === f.parent.id)
        ?.accountingBalance,
      undefined,
    );
    assert.throws(
      () => f.app.integration.balances.history(f.actor, f.parent.id),
      { code: "FORBIDDEN" },
    );
  }
  iam.run(
    "UPDATE iam_users SET role='admin',account_id=NULL WHERE id=?",
    f.actor.id,
  );
  assert.throws(
    () =>
      f.app.integration.balances.history(
        { ...f.actor, orgId: "foreign" },
        f.parent.id,
      ),
    { code: "FORBIDDEN" },
  );
  iam.run(
    "INSERT INTO iam_user_security(user_id,revision,password_change_required,updated_at) VALUES(?,1,1,?) ON CONFLICT(user_id) DO UPDATE SET password_change_required=1",
    f.actor.id,
    new Date().toISOString(),
  );
  await assert.rejects(
    f.app.integration.balances.refresh(f.actor, f.parent.id, "read", adapter()),
    { code: "PASSWORD_CHANGE_REQUIRED" },
  );
  assert.throws(
    () => f.app.integration.balances.history(f.actor, f.parent.id),
    { code: "PASSWORD_CHANGE_REQUIRED" },
  );
  iam.run(
    "UPDATE iam_user_security SET password_change_required=0 WHERE user_id=?",
    f.actor.id,
  );
  chooseProviders(f, f.actor, "withdraw", {
    accountId: f.buyer,
    region: "CA",
    mode: "strict",
    providers: [],
    version: 2,
    acknowledgment: "Synthetic withdrawal",
  });
  await assert.rejects(
    f.app.integration.balances.refresh(f.actor, f.parent.id, "read", adapter()),
    { code: "RESIDENCY_BLOCKED" },
  );
  assert.equal(
    f.app.integration.balances.history(f.actor, f.parent.id).items.length,
    1,
  );
  chooseProviders(f, f.actor, "restore-choice", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["quickbooks"],
    version: 3,
    acknowledgment: "Synthetic new permission",
  });
  f.app.database
    .owned("platform")
    .run(
      "INSERT INTO platform_recovery(id,snapshot_hash,restored_at,source_completed_at) VALUES(1,'synthetic','2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z')",
    );
  await assert.rejects(
    f.app.integration.balances.refresh(f.actor, f.parent.id, "read", adapter()),
    { code: "RECOVERY_HOLD" },
  );
});

test("claim contention and recovery fence late reads and preserve the successor's immutable observation", async (t) => {
  const f = await setup(t);
  let resolve!: (v: any) => void;
  const a = adapter();
  a.readInvoiceBalance = () => new Promise((r) => (resolve = r));
  const old = f.app.integration.balances.refresh(
    f.actor,
    f.parent.id,
    "old",
    a,
  );
  await assert.rejects(
    f.app.integration.balances.refresh(
      f.actor,
      f.parent.id,
      "other",
      adapter(),
    ),
    { code: "STATE" },
  );
  const peer = new Application(f.path);
  t.after(() => peer.close());
  await assert.rejects(
    peer.integration.balances.refresh(f.actor, f.parent.id, "peer", adapter()),
    { code: "STATE" },
  );
  f.app.database
    .owned("integration")
    .run(
      "UPDATE integration_balance_reads SET started_at=0 WHERE token IS NOT NULL",
    );
  assert.equal(f.app.integration.recoverStale(), 1);
  const second = await peer.integration.balances.refresh(
    f.actor,
    f.parent.id,
    "second",
    adapter(10000),
  );
  resolve({
    reference: "invoice-1",
    total: 11300,
    currency: "CAD",
    balance: 0,
    syncToken: "9",
  });
  await assert.rejects(old, { code: "STATE" });
  assert.deepEqual(
    f.app.integration.balances.latest(f.actor, f.parent.id),
    second,
  );
  const retried = await f.app.integration.balances.refresh(
    f.actor,
    f.parent.id,
    "old",
    adapter(5000),
  );
  assert.ok(retried.sequence > second.sequence);
  assert.deepEqual(
    f.app.integration.balances.latest(f.actor, f.parent.id),
    retried,
  );
});

test("late audit rollback and identity/permission changes cannot publish observations; failures persist no raw errors", async (t) => {
  const f = await setup(t),
    before = facts(f),
    audit = f.app.platform.audit.bind(f.app.platform);
  f.app.platform.audit = (...args) => {
    if (args[1] === "accounting.balance.observed")
      throw Error("SECRET-SYNTHETIC-ERROR");
    return audit(...args);
  };
  await assert.rejects(
    f.app.integration.balances.refresh(f.actor, f.parent.id, "read", adapter()),
    /SECRET-SYNTHETIC/,
  );
  assert.equal(
    f.app.integration.balances.history(f.actor, f.parent.id).items.length,
    0,
  );
  assert.deepEqual(facts(f), before);
  assert.ok(
    !JSON.stringify(
      f.app.database
        .owned("integration")
        .all("SELECT * FROM integration_balance_reads"),
    ).includes("SECRET"),
  );
  f.app.platform.audit = audit;
  await f.app.integration.balances.refresh(
    f.actor,
    f.parent.id,
    "read",
    adapter(),
  );
  const a = adapter();
  a.readInvoiceBalance = async (e) => {
    f.app.database
      .owned("iam")
      .run("UPDATE iam_users SET role='commercial' WHERE id=?", f.actor.id);
    return {
      reference: e.external_ref!,
      total: 11300,
      currency: "CAD",
      balance: 0,
      syncToken: "1",
    };
  };
  await assert.rejects(
    f.app.integration.balances.refresh(f.actor, f.parent.id, "revoked", a),
    { code: "FORBIDDEN" },
  );
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='admin' WHERE id=?", f.actor.id);
  assert.equal(
    f.app.integration.balances.history(f.actor, f.parent.id).items.length,
    1,
  );
  const b = adapter();
  b.readInvoiceBalance = async (e) => {
    f.app.database
      .owned("integration")
      .run(
        "UPDATE integration_effects SET external_ref='changed' WHERE id=?",
        e.id,
      );
    return {
      reference: e.external_ref!,
      total: 11300,
      currency: "CAD",
      balance: 0,
      syncToken: "1",
    };
  };
  await assert.rejects(
    f.app.integration.balances.refresh(f.actor, f.parent.id, "changed", b),
    { code: "STATE" },
  );
  await assert.rejects(
    f.app.integration.balances.refresh(f.actor, f.parent.id, "read", adapter()),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
});

test("completion rechecks consent, credential status and restore isolation, and invalid money cannot publish or change native facts", async (t) => {
  for (const restriction of ["consent", "password", "restore"] as const) {
    const f = await setup(t),
      before = facts(f);
    const a = adapter();
    a.readInvoiceBalance = async (e) => {
      if (restriction === "consent")
        chooseProviders(f, f.actor, "withdraw-during", {
          accountId: f.buyer,
          region: "CA",
          mode: "strict",
          providers: [],
          version: 2,
          acknowledgment: "Synthetic withdrawal during read",
        });
      if (restriction === "password")
        f.app.database
          .owned("iam")
          .run(
            "INSERT INTO iam_user_security(user_id,revision,password_change_required,updated_at) VALUES(?,1,1,?) ON CONFLICT(user_id) DO UPDATE SET password_change_required=1",
            f.actor.id,
            new Date().toISOString(),
          );
      if (restriction === "restore")
        f.app.database
          .owned("platform")
          .run(
            "INSERT INTO platform_recovery VALUES(1,'synthetic',?,?)",
            new Date().toISOString(),
            new Date().toISOString(),
          );
      return {
        reference: e.external_ref!,
        total: 11300,
        currency: "CAD",
        balance: 0,
        syncToken: "1",
      };
    };
    await assert.rejects(
      f.app.integration.balances.refresh(
        f.actor,
        f.parent.id,
        "changed-permission",
        a,
      ),
      {
        code: {
          consent: "RESIDENCY_BLOCKED",
          password: "PASSWORD_CHANGE_REQUIRED",
          restore: "RECOVERY_HOLD",
        }[restriction],
      },
    );
    assert.equal(
      f.app.database
        .owned("integration")
        .get<{ count: number }>(
          "SELECT count(*) count FROM integration_balance_observations",
        )!.count,
      0,
    );
    if (restriction === "password") {
      assert.throws(() => f.app.inventory.stock(f.actor), {
        code: "PASSWORD_CHANGE_REQUIRED",
      });
      assert.throws(() => f.app.orders.list(f.actor), {
        code: "PASSWORD_CHANGE_REQUIRED",
      });
      assert.throws(() => f.app.billing.invoices(f.actor), {
        code: "PASSWORD_CHANGE_REQUIRED",
      });
      assert.throws(() => f.app.billing.credits(f.actor), {
        code: "PASSWORD_CHANGE_REQUIRED",
      });
      assert.throws(() => f.app.billing.refunds.list(f.actor), {
        code: "PASSWORD_CHANGE_REQUIRED",
      });
      assert.throws(() => f.app.billing.refunds.payments(f.actor), {
        code: "PASSWORD_CHANGE_REQUIRED",
      });
    }
    assert.deepEqual(facts(f), before);
  }
  const f = await setup(t),
    before = facts(f);
  for (const change of [
    { reference: "other" },
    { total: 1 },
    { currency: "USD" },
    { balance: -1 },
    { balance: 11301 },
    { balance: 0.1 },
    { balance: NaN },
    { syncToken: "x" },
  ]) {
    const a = adapter();
    a.readInvoiceBalance = async (e) => ({
      reference: e.external_ref!,
      total: 11300,
      currency: "CAD",
      balance: 0,
      syncToken: "1",
      ...change,
    });
    await assert.rejects(
      f.app.integration.balances.refresh(f.actor, f.parent.id, "invalid", a),
      { code: "ACCOUNTING_MISMATCH" },
    );
  }
  assert.equal(
    f.app.integration.balances.history(f.actor, f.parent.id).items.length,
    0,
  );
  assert.deepEqual(facts(f), before);
});

test("failed acquisition audit creates neither claim nor provider call and permits the same key after correction", async (t) => {
  const f = await setup(t),
    audit = f.app.platform.audit.bind(f.app.platform);
  let calls = 0;
  const a = adapter();
  a.readInvoiceBalance = async (e) => {
    calls++;
    return {
      reference: e.external_ref!,
      total: 11300,
      currency: "CAD",
      balance: 0,
      syncToken: "1",
    };
  };
  f.app.platform.audit = (...args) => {
    if (args[1] === "accounting.balance.requested")
      throw Error("synthetic acquisition fault");
    return audit(...args);
  };
  await assert.rejects(
    f.app.integration.balances.refresh(f.actor, f.parent.id, "retry", a),
    /acquisition fault/,
  );
  assert.equal(calls, 0);
  assert.equal(
    f.app.database
      .owned("integration")
      .get<{ count: number }>(
        "SELECT count(*) count FROM integration_balance_reads",
      )!.count,
    0,
  );
  f.app.platform.audit = audit;
  await f.app.integration.balances.refresh(f.actor, f.parent.id, "retry", a);
  assert.equal(calls, 1);
});

test("sandbox balance GET checks exact identity/marker/customer/currency/money, rejects invalid cents and remains default-disabled", async (t) => {
  const f = await setup(t),
    effect = f.app.integration.effect(f.actor, f.parent.id),
    payload = JSON.parse(effect.payload),
    a = new QuickBooksAdapter("12345", async () => "synthetic-token", true);
  const invoice = {
    Id: "invoice-1",
    DocNumber: payload.invoice.number,
    TotalAmt: 113,
    CurrencyRef: { value: "CAD" },
    CustomerRef: { value: "customer-1" },
    PrivateNote: `Distributor effect ${effect.id}`,
    Balance: 0.29,
    SyncToken: "1",
  };
  let current: any = invoice;
  const original = globalThis.fetch;
  t.after(() => (globalThis.fetch = original));
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(
      String(url),
      "https://sandbox-quickbooks.api.intuit.com/v3/company/12345/invoice/invoice-1",
    );
    assert.equal(options?.method, "GET");
    assert.equal(options?.body, undefined);
    return new Response(JSON.stringify({ Invoice: current }), { status: 200 });
  };
  assert.equal((await a.readInvoiceBalance(effect)).balance, 29);
  for (const changed of [
    { Id: "wrong" },
    { PrivateNote: "wrong" },
    { CustomerRef: { value: "wrong" } },
    { CurrencyRef: { value: "USD" } },
    { TotalAmt: 112 },
    { Balance: -1 },
    { Balance: 114 },
    { Balance: 0.291 },
    { Balance: null },
    { Balance: "1" },
    { Balance: undefined },
    { SyncToken: "" },
  ]) {
    current = { ...invoice, ...changed };
    await assert.rejects(a.readInvoiceBalance(effect), {
      code: "ACCOUNTING_MISMATCH",
    });
  }
  const previous = calls;
  await assert.rejects(
    new QuickBooksAdapter("12345", async () => {
      throw Error("never read token");
    }).readInvoiceBalance(effect),
    { code: "PROVIDER_DISABLED" },
  );
  assert.equal(calls, previous);
});

test("HTTP balance refresh enforces origin/CSRF/key and strict paged history; cached observation requires current authority", async (t) => {
  const f = await setup(t),
    runtime = new ProviderRuntime(f.app, [
      {
        id: "synthetic",
        orgId: f.actor.orgId,
        workerUserId: f.actor.id,
        quickbooks: adapter(),
      },
    ]),
    http = await createHttp(f.app, {
      origin: "http://localhost",
      providers: runtime,
    });
  t.after(() => void http.close());
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin: "http://localhost" },
    payload: {
      email: "admin@example.test",
      password: "long-test-only-password",
    },
  });
  assert.equal(login.statusCode, 200);
  const cookie = login.headers["set-cookie"]!.toString().split(";")[0]!,
    csrf = login.json().csrf,
    headers = {
      cookie,
      origin: "http://localhost",
      "x-csrf-token": csrf,
      "idempotency-key": "read",
    },
    url = `/api/effects/${f.parent.id}/balance`;
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url,
        headers: { ...headers, "x-csrf-token": "wrong" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url,
        headers: { ...headers, origin: "http://foreign" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url,
        headers,
        payload: { balance: 0, invoiceId: "forged" },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url,
        headers: {
          cookie,
          origin: "http://localhost",
          "x-csrf-token": login.json().csrf,
        },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await http.inject({
        method: "GET",
        url: `${url}-history?extra=forged`,
        headers: { cookie },
      })
    ).statusCode,
    400,
  );
  const result = await http.inject({ method: "POST", url, headers });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(
    (await http.inject({ method: "POST", url, headers })).json(),
    result.json(),
  );
  const history = await http.inject({
    method: "GET",
    url: `${url}-history?limit=1`,
    headers: { cookie },
  });
  assert.equal(history.statusCode, 200);
  assert.equal(history.json().items.length, 1);
  assert.equal(
    (
      await http.inject({
        method: "GET",
        url: `${url}-history?limit=101`,
        headers: { cookie },
      })
    ).statusCode,
    400,
  );
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='support' WHERE id=?", f.actor.id);
  assert.equal(
    (await http.inject({ method: "POST", url, headers })).statusCode,
    403,
  );
});

test("separate processes contend one invoice read and cannot create a second saved comparison", async (t) => {
  const f = await setup(t);
  const children = Array.from({ length: 2 }, () =>
    fork(new URL("./accounting-balance-child.ts", import.meta.url), [], {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    }),
  );
  t.after(() =>
    children.forEach((c) => {
      if (c.connected) c.kill();
    }),
  );
  const wait = (c: (typeof children)[number]) =>
    new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("Child timeout")), 10000);
      c.once("message", (value) => {
        clearTimeout(timer);
        resolve(value);
      });
      c.once("error", reject);
      c.once("exit", (code) => {
        if (code) reject(Error(`Child exited ${code}`));
      });
    });
  await Promise.all(
    children.map(async (c) => {
      const ready = wait(c);
      c.send({
        action: "init",
        path: f.path,
        actor: f.actor,
        effectId: f.parent.id,
      });
      assert.equal((await ready).ready, true);
    }),
  );
  const results = await Promise.all(
    children.map(async (c, i) => {
      const done = wait(c);
      c.send({ action: "go", key: `read-${i}` });
      return done;
    }),
  );
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(results.find((r) => !r.ok).code, "STATE");
  assert.equal(
    f.app.integration.balances.history(f.actor, f.parent.id).items.length,
    1,
  );
});
