import { test } from "node:test";
import assert from "node:assert/strict";
import type Stripe from "stripe";
import { chooseProviders, fixture, accept, ship } from "./fixtures.ts";
import { StripeAdapter } from "../src/server/providers.ts";
import type { Adapter, Effect } from "../src/server/integration.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import {
  ProviderRuntime,
  type StripeGateway,
} from "../src/server/provider-runtime.ts";

function setup(t: Parameters<typeof fixture>[0]) {
  const f = fixture(t),
    shipment = ship(f, accept(f).id);
  chooseProviders(f, f.actor, "choice", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["stripe"],
    version: 1,
    acknowledgment: "Synthetic test permission",
  });
  const payment = f.app.database.transaction(() =>
    f.app.billing.verifiedPayment(
      f.actor,
      shipment.invoiceId,
      11300,
      "stripe",
      "pi_synthetic",
    ),
  );
  f.app.billing.issueCredit(f.actor, "credit", {
    invoiceId: shipment.invoiceId,
    reference: "CR1",
    reason: "Synthetic credit",
    lines: [
      {
        lineId: String(f.app.billing.lines(f.actor, shipment.invoiceId)[0]!.id),
        quantity: 1,
      },
    ],
  });
  const refund = f.app.billing.refundRequest(f.actor, "refund", {
    invoiceId: shipment.invoiceId,
    paymentId: payment.id,
    amount: 11300,
    reference: "REF1",
    reason: "Synthetic refund",
  });
  const queued = f.app.integration.refund(f.actor, "queue", {
    refundId: refund.id,
  });
  return Object.assign(f, {
    invoiceId: shipment.invoiceId,
    paymentId: payment.id,
    refundId: refund.id,
    effect: f.app.integration.effect(f.actor, queued.id),
  });
}
function result(e: Effect, status = "succeeded") {
  return {
    reference: "re_synthetic",
    result: { ...JSON.parse(e.payload), effectId: e.id, status },
  };
}
function adapter(status = "succeeded"): Adapter {
  return {
    execute: async (e) => result(e, status),
    lookup: async (e) => result(e, status),
  };
}

test("refund accepted pending reserves cash; verified success and late bank failure preserve observations across restart", async (t) => {
  const f = setup(t);
  await f.app.integration.execute(f.actor, f.effect.id, adapter("pending"));
  assert.equal(f.app.billing.refunds.list(f.actor)[0]!.state, "unknown");
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).refunded, 0);
  assert.throws(
    () =>
      f.app.billing.refundRequest(f.actor, "over", {
        invoiceId: f.invoiceId,
        paymentId: f.paymentId,
        amount: 1,
        reference: "over",
        reason: "attempt",
      }),
    { code: "OVER_REFUND" },
  );
  await f.app.integration.refunds.run(f.actor, f.effect.id, adapter(), false);
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).refunded, 11300);
  f.app.close();
  f.app = new Application(f.path);
  await f.app.integration.refunds.run(
    f.actor,
    f.effect.id,
    adapter("pending"),
    false,
  );
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).refunded, 11300);
  await f.app.integration.refunds.run(
    f.actor,
    f.effect.id,
    adapter("failed"),
    false,
  );
  await f.app.integration.refunds.run(f.actor, f.effect.id, adapter(), false);
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).refunded, 0);
  const r = f.app.billing.refunds.list(f.actor)[0]!;
  assert.equal(r.state, "rejected");
  assert.equal(r.provider_status, "failed");
  assert.deepEqual(
    r.observations.map((o) => [o.status, o.applied]),
    [
      ["pending", 1],
      ["succeeded", 1],
      ["pending", 0],
      ["failed", 1],
      ["succeeded", 0],
    ],
  );
  assert.deepEqual(
    f.app.billing.refundRequest(f.actor, "refund", {
      invoiceId: f.invoiceId,
      paymentId: f.paymentId,
      amount: 11300,
      reference: "REF1",
      reason: "Synthetic refund",
    }),
    { id: f.refundId, state: "pending" },
  );
  assert.equal(f.app.billing.refunds.list(f.actor).length, 1);
});

test("lost refund response never resends; absent reads remain unknown and matching lookup applies cash once", async (t) => {
  const f = setup(t);
  let sends = 0,
    found = false;
  const a: Adapter = {
    execute: async () => {
      sends++;
      throw Error("private provider message");
    },
    lookup: async (e) => (found ? result(e) : null),
  };
  await assert.rejects(f.app.integration.execute(f.actor, f.effect.id, a));
  assert.equal(f.app.integration.effect(f.actor, f.effect.id).state, "unknown");
  assert.equal(f.app.billing.refunds.list(f.actor)[0]!.state, "unknown");
  assert.ok(
    !f.app.integration.effect(f.actor, f.effect.id).error!.includes("private"),
  );
  await assert.rejects(f.app.integration.execute(f.actor, f.effect.id, a), {
    code: "STATE",
  });
  await f.app.integration.reconcile(f.actor, f.effect.id, a);
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).refunded, 0);
  found = true;
  await f.app.integration.reconcile(f.actor, f.effect.id, a);
  await f.app.integration.refunds.run(f.actor, f.effect.id, a, false);
  assert.equal(sends, 1);
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).refunded, 11300);
});

test("refund reference, intent, money and status mismatches cannot write native cash", async (t) => {
  const f = setup(t);
  await f.app.integration.execute(f.actor, f.effect.id, adapter("pending"));
  for (const change of [
    { amount: 11301 },
    { currency: "usd" },
    { paymentId: "pi_other" },
    { refundId: "other" },
    { effectId: "other" },
    { status: "unknown" },
  ]) {
    const a: Adapter = {
      execute: async (e) => result(e),
      lookup: async (e) => {
        const r = result(e);
        return { ...r, result: { ...r.result, ...change } };
      },
    };
    await assert.rejects(
      f.app.integration.refunds.run(f.actor, f.effect.id, a, false),
      { code: "REFUND_MISMATCH" },
    );
  }
  await assert.rejects(
    f.app.integration.refunds.run(
      f.actor,
      f.effect.id,
      {
        ...adapter(),
        lookup: async (e) => ({ ...result(e), reference: "re_other" }),
      },
      false,
    ),
    { code: "REFUND_MISMATCH" },
  );
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).refunded, 0);
  assert.equal(f.app.billing.refunds.list(f.actor)[0]!.observations.length, 1);
});

test("refund queue retries require current consent, recovery clearance and finance grants before cache access", async (t) => {
  const f = setup(t);
  chooseProviders(f, f.actor, "withdraw", {
    accountId: f.buyer,
    region: "CA",
    mode: "strict",
    providers: [],
    version: 2,
    acknowledgment: "Withdraw synthetic permission",
  });
  assert.throws(
    () => f.app.integration.refund(f.actor, "queue", { refundId: f.refundId }),
    { code: "RESIDENCY_BLOCKED" },
  );
  let sent = 0;
  await assert.rejects(
    f.app.integration.execute(f.actor, f.effect.id, {
      ...adapter(),
      execute: async (e) => {
        sent++;
        return result(e);
      },
    }),
    { code: "RESIDENCY_BLOCKED" },
  );
  assert.equal(sent, 0);
  assert.equal(f.app.billing.refunds.list(f.actor)[0]!.state, "pending");
  chooseProviders(f, f.actor, "restore", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["stripe"],
    version: 3,
    acknowledgment: "Restore test permission",
  });
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='support' WHERE id=?", f.actor.id);
  assert.throws(
    () => f.app.integration.refund(f.actor, "queue", { refundId: f.refundId }),
    { code: "FORBIDDEN" },
  );
  await assert.rejects(
    f.app.integration.execute(f.actor, f.effect.id, adapter()),
    { code: "FORBIDDEN" },
  );
});

test("revoked actor during provider I/O leaves native refund unknown for later qualified reconciliation", async (t) => {
  const f = setup(t);
  const a: Adapter = {
    ...adapter(),
    execute: async (e) => {
      f.app.database
        .owned("iam")
        .run("UPDATE iam_users SET active=0 WHERE id=?", f.actor.id);
      return result(e);
    },
  };
  await assert.rejects(f.app.integration.execute(f.actor, f.effect.id, a));
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).refunded, 0);
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET active=1 WHERE id=?", f.actor.id);
  await f.app.integration.reconcile(f.actor, f.effect.id, adapter());
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).refunded, 11300);
});

test("refund lease fences an abandoned sender and serializes concurrent reconciliation", async (t) => {
  const f = setup(t);
  let release!: (r: ReturnType<typeof result>) => void;
  const response = new Promise<ReturnType<typeof result>>((r) => {
    release = r;
  });
  const sending = f.app.integration.execute(f.actor, f.effect.id, {
    ...adapter(),
    execute: async () => response,
  });
  await assert.rejects(
    f.app.integration.execute(f.actor, f.effect.id, adapter()),
    { code: "STATE" },
  );
  f.app.integration.recoverStale(-1, f.actor.orgId);
  f.app.integration.refunds.recover(-1, f.actor.orgId);
  await f.app.integration.reconcile(f.actor, f.effect.id, adapter("pending"));
  release(result(f.effect));
  await assert.rejects(sending, { code: "STATE" });
  assert.equal(f.app.billing.refunds.list(f.actor)[0]!.state, "unknown");
  let finish!: (r: ReturnType<typeof result>) => void;
  const read = new Promise<ReturnType<typeof result>>((r) => {
    finish = r;
  });
  const reading = f.app.integration.refunds.run(
    f.actor,
    f.effect.id,
    { ...adapter(), lookup: async () => read },
    false,
  );
  await assert.rejects(
    f.app.integration.refunds.run(f.actor, f.effect.id, adapter(), false),
    { code: "STATE" },
  );
  finish(result(f.effect));
  await reading;
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).refunded, 11300);
});

test("late observation audit failure rolls back money, reference, effect and history together", async (t) => {
  const f = setup(t);
  const original = f.app.platform.audit.bind(f.app.platform);
  const mock = t.mock.method(
    f.app.platform,
    "audit",
    (...args: Parameters<typeof original>) => {
      if (args[1] === "billing.refund.observed")
        throw Error("synthetic audit fault");
      return original(...args);
    },
  );
  await assert.rejects(
    f.app.integration.execute(f.actor, f.effect.id, adapter()),
    /synthetic audit fault/,
  );
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).refunded, 0);
  assert.equal(f.app.billing.refunds.list(f.actor)[0]!.observations.length, 0);
  assert.equal(
    f.app.integration.effect(f.actor, f.effect.id).external_ref,
    null,
  );
  assert.equal(f.app.integration.effect(f.actor, f.effect.id).state, "unknown");
  mock.mock.restore();
  await f.app.integration.reconcile(f.actor, f.effect.id, adapter());
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).refunded, 11300);
});

test("Stripe SDK refund calls use minimal identity, stable idempotency and a retrieved settled test payment", async (t) => {
  const f = setup(t),
    a = new StripeAdapter(
      "sk_test_synthetic_no_network",
      "http://127.0.0.1:3000",
      true,
    );
  let payment = {
    id: "pi_synthetic",
    livemode: false,
    status: "succeeded",
    amount_received: 11300,
    currency: "cad",
  } as Stripe.PaymentIntent;
  t.mock.method(a.client.paymentIntents, "retrieve", async () => payment);
  let refund = {
    id: "re_synthetic",
    object: "refund",
    amount: 11300,
    currency: "cad",
    payment_intent: "pi_synthetic",
    status: "pending",
    metadata: { effect_id: f.effect.id, refund_id: f.refundId },
  } as unknown as Stripe.Refund;
  const create = t.mock.method(a.client.refunds, "create", async () => refund);
  const actual = await a.execute(f.effect);
  assert.equal(actual.result.status, "pending");
  assert.equal(actual.result.effectId, f.effect.id);
  const [request, options] = create.mock.calls[0]!.arguments;
  assert.deepEqual(request, {
    payment_intent: "pi_synthetic",
    amount: 11300,
    metadata: { effect_id: f.effect.id, refund_id: f.refundId },
  });
  assert.equal(options!.idempotencyKey, `distributor:${f.effect.id}`);
  for (const change of [
    { livemode: true },
    { amount_received: 11299 },
    { currency: "usd" },
    { status: "processing" },
    { id: "pi_other" },
  ]) {
    const old = payment;
    payment = { ...payment, ...change } as Stripe.PaymentIntent;
    await assert.rejects(a.execute(f.effect), { code: "REFUND_MISMATCH" });
    payment = old;
  }
  assert.equal(create.mock.calls.length, 1);
  for (const change of [
    { amount: 11301 },
    { currency: "usd" },
    { payment_intent: "pi_other" },
    { metadata: { effect_id: "other", refund_id: f.refundId } },
    { status: "not_supported" },
  ]) {
    const old = refund;
    refund = { ...refund, ...change } as unknown as Stripe.Refund;
    await assert.rejects(a.execute(f.effect), { code: "REFUND_MISMATCH" });
    refund = old;
  }
  // Exercise the SDK projection through integration and native billing, not just adapter calls.
  await f.app.integration.execute(f.actor, f.effect.id, a);
  assert.equal(f.app.billing.refunds.list(f.actor)[0]!.state, "unknown");
  refund = { ...refund, status: "succeeded" };
  t.mock.method(a.client.refunds, "retrieve", async () => refund);
  await f.app.integration.refunds.run(f.actor, f.effect.id, a, false);
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).refunded, 11300);
  assert.equal(f.app.billing.refunds.list(f.actor)[0]!.observations.length, 2);
});

test("Stripe refund lookup rejects duplicate or exhausted searches and retrieves bound identities exactly", async (t) => {
  const f = setup(t),
    a = new StripeAdapter(
      "sk_test_synthetic_no_network",
      "http://127.0.0.1:3000",
      true,
    );
  t.mock.method(
    a.client.paymentIntents,
    "retrieve",
    async () =>
      ({
        id: "pi_synthetic",
        livemode: false,
        status: "succeeded",
        amount_received: 11300,
        currency: "cad",
      }) as Stripe.PaymentIntent,
  );
  const r = {
    id: "re_synthetic",
    object: "refund",
    amount: 11300,
    currency: "cad",
    payment_intent: "pi_synthetic",
    status: "succeeded",
    metadata: { effect_id: f.effect.id, refund_id: f.refundId },
  } as unknown as Stripe.Refund;
  let rows: Stripe.Refund[] = [];
  let more = false;
  const list = t.mock.method(
    a.client.refunds,
    "list",
    async () =>
      ({ data: rows, has_more: more }) as Stripe.ApiList<Stripe.Refund>,
  );
  assert.equal(await a.lookup(f.effect), null);
  rows = [r];
  assert.equal((await a.lookup(f.effect))!.reference, r.id);
  rows = [r, { ...r, id: "re_duplicate" }];
  await assert.rejects(a.lookup(f.effect), { code: "REFUND_DUPLICATE" });
  rows = [{ ...r, metadata: {} }];
  more = true;
  await assert.rejects(a.lookup(f.effect), { code: "REFUND_LOOKUP_LIMIT" });
  const calls = list.mock.calls.length;
  const retrieve = t.mock.method(a.client.refunds, "retrieve", async () => r);
  assert.equal(
    (await a.lookup({ ...f.effect, external_ref: r.id }))!.reference,
    r.id,
  );
  assert.equal(retrieve.mock.calls[0]!.arguments[0], r.id);
  assert.equal(list.mock.calls.length, calls);
});

test("refund HTTP queues, sends, refreshes and worker polls unresolved statuses with synthetic adapters only", async (t) => {
  const f = setup(t);
  let status = "pending",
    reads = 0;
  const gateway: StripeGateway = {
    execute: async (e) => result(e, status),
    lookup: async (e) => {
      reads++;
      return result(e, status);
    },
    verifyWebhook: () => {
      throw Error("unused");
    },
    verifySettlement: async () => {
      throw Error("unused");
    },
  };
  const runtime = new ProviderRuntime(f.app, [
    {
      id: "synthetic",
      orgId: f.actor.orgId,
      workerUserId: f.actor.id,
      stripe: { adapter: gateway, webhookSecret: "whsec_synthetic" },
    },
  ]);
  const http = await createHttp(f.app, {
    origin: "http://localhost",
    providers: runtime,
  });
  t.after(() => http.close());
  const session = f.app.identity.login(
    "admin@example.test",
    "long-test-only-password",
  );
  const headers = {
    origin: "http://localhost",
    cookie: `distributor_session=${session.token}`,
    "x-csrf-token": session.csrf,
  };
  const sent = await http.inject({
    method: "POST",
    url: `/api/effects/${f.effect.id}/execute`,
    headers,
  });
  assert.equal(sent.statusCode, 200, sent.body);
  status = "succeeded";
  f.app.database
    .owned("integration")
    .run(
      "UPDATE integration_refund_polls SET retry_at=0 WHERE effect_id=?",
      f.effect.id,
    );
  await runtime.tick();
  assert.equal(reads, 1);
  await runtime.tick();
  assert.equal(reads, 1);
  status = "failed";
  const refreshed = await http.inject({
    method: "POST",
    url: `/api/effects/${f.effect.id}/refresh-refund`,
    headers,
  });
  assert.equal(refreshed.statusCode, 200, refreshed.body);
  const refunds = await http.inject({ url: "/api/billing/refunds", headers });
  assert.equal(refunds.json()[0].state, "rejected");
  const payments = await http.inject({ url: "/api/billing/payments", headers });
  assert.equal(payments.json()[0].id, f.paymentId);
  const noCsrf = await http.inject({
    method: "POST",
    url: `/api/effects/${f.effect.id}/refresh-refund`,
    headers: { cookie: headers.cookie },
  });
  assert.equal(noCsrf.statusCode, 403);
});

test("separate processes contend for one refund verification lease and one cash application", async (t) => {
  const f = setup(t);
  await f.app.integration.execute(f.actor, f.effect.id, adapter("pending"));
  const { fork } = await import("node:child_process");
  const children: import("node:child_process").ChildProcess[] = [];
  const started: Promise<void>[] = [];
  const finished: Promise<any>[] = [];
  for (let i = 0; i < 2; i++) {
    const child = fork(new URL("./refund-child.ts", import.meta.url), [], {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    children.push(child);
    let ready!: () => void,
      resolve!: (value: any) => void,
      reject!: (error: Error) => void;
    started.push(
      new Promise((r) => {
        ready = r;
      }),
    );
    finished.push(
      new Promise((r, j) => {
        resolve = r;
        reject = j;
      }),
    );
    let stderr = "";
    child.stderr?.on("data", (v) => (stderr += v));
    child.on("message", (m: any) => (m.ready ? ready() : resolve(m)));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code) reject(Error(`Refund child ${code}: ${stderr}`));
    });
    child.send({
      action: "init",
      path: f.path,
      actor: f.actor,
      effectId: f.effect.id,
    });
  }
  t.after(() => children.forEach((c) => c.kill()));
  await Promise.all(started);
  children.forEach((c) => c.send({ action: "go" }));
  const values = await Promise.all(finished);
  assert.equal(values.filter((v) => v.ok).length, 1, JSON.stringify(values));
  assert.equal(values.find((v) => !v.ok).code, "STATE");
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).refunded, 11300);
  assert.equal(f.app.billing.refunds.list(f.actor)[0]!.observations.length, 2);
});

test("restore hold blocks cached refund queues and all refund provider reads", async (t) => {
  const f = setup(t);
  let reads = 0;
  await f.app.integration.execute(f.actor, f.effect.id, adapter("pending"));
  f.app.platform.isolateRestore("synthetic-snapshot", new Date().toISOString());
  assert.throws(
    () => f.app.integration.refund(f.actor, "queue", { refundId: f.refundId }),
    { code: "RECOVERY_HOLD" },
  );
  await assert.rejects(
    f.app.integration.refunds.run(
      f.actor,
      f.effect.id,
      {
        ...adapter(),
        lookup: async (e) => {
          reads++;
          return result(e);
        },
      },
      false,
    ),
    { code: "RECOVERY_HOLD" },
  );
  assert.equal(reads, 0);
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).refunded, 0);
});

test("buyer and commercial effect lists omit internal refunds and billing evidence reads deny those roles", (t) => {
  const f = setup(t);
  for (const role of ["buyer", "commercial"] as const) {
    const actor = { ...f.actor, role, accountId: f.buyer };
    assert.equal(
      f.app.integration.list(actor).filter((e) => e.kind === "refund").length,
      0,
    );
    assert.throws(() => f.app.billing.refunds.list(actor), {
      code: "FORBIDDEN",
    });
    assert.throws(() => f.app.billing.refunds.payments(actor), {
      code: "FORBIDDEN",
    });
    if (role === "buyer")
      assert.throws(
        () =>
          f.app.integration.effect(
            { ...actor, accountId: "other" },
            f.effect.id,
          ),
        { code: "FORBIDDEN" },
      );
  }
  assert.equal(
    f.app.integration.list(f.actor).filter((e) => e.kind === "refund").length,
    1,
  );
});
