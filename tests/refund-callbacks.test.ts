import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import type Stripe from "stripe";
import { chooseProviders, fixture, accept, ship } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { StripeAdapter } from "../src/server/providers.ts";
import { ProviderRuntime } from "../src/server/provider-runtime.ts";
import { createHttp } from "../src/server/http.ts";
import type { Adapter, Effect } from "../src/server/integration.ts";

function setup(t: TestContext) {
  const f = fixture(t),
    shipment = ship(f, accept(f).id);
  chooseProviders(f, f.actor, "consent", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["stripe"],
    version: 1,
    acknowledgment: "Synthetic outside-region test processing",
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
    reason: "Synthetic private reason",
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
    reason: "Synthetic private refund reason",
  });
  const effect = f.app.integration.effect(
    f.actor,
    f.app.integration.refund(f.actor, "queue", { refundId: refund.id }).id,
  );
  const adapter = new StripeAdapter(
      "sk_test_synthetic",
      "http://localhost",
      true,
    ),
    secret = "whsec_synthetic";
  let status: NonNullable<Stripe.Refund["status"]> = "succeeded",
    failRead = false,
    mismatch = false;
  const refundObject = () =>
    ({
      object: "refund",
      id: "re_synthetic",
      payment_intent: "pi_synthetic",
      amount: 11300,
      currency: "cad",
      status,
      metadata: { effect_id: effect.id, refund_id: refund.id },
    }) as unknown as Stripe.Refund;
  const original = t.mock.method(
    adapter.client.paymentIntents,
    "retrieve",
    async () => ({
      object: "payment_intent",
      id: "pi_synthetic",
      livemode: false,
      status: "succeeded",
      amount_received: 11300,
      currency: "cad",
    }),
  );
  const creates = t.mock.method(adapter.client.refunds, "create", async () =>
    refundObject(),
  );
  const reads = t.mock.method(adapter.client.refunds, "retrieve", async () => {
    if (failRead) throw Error("secret customer bank details");
    return { ...refundObject(), amount: mismatch ? 11301 : 11300 };
  });
  t.mock.method(adapter.client.refunds, "list", async () => {
    throw Error("Callback must read exact refund identity");
  });
  const runtime = new ProviderRuntime(f.app, [
    {
      id: "ca-test",
      orgId: f.actor.orgId,
      workerUserId: f.actor.id,
      stripe: { adapter, webhookSecret: secret },
    },
  ]);
  const event = (
    eventId = "evt_refund",
    eventType = "refund.updated",
    object: Record<string, unknown> = {},
    overrides: Record<string, unknown> = {},
  ) => ({
    object: "event",
    id: eventId,
    type: eventType,
    livemode: false,
    created: 1,
    data: { object: { ...refundObject(), ...object } },
    ...overrides,
  });
  const signed = (e = event()) => {
    const raw = JSON.stringify(e);
    return {
      raw,
      signature: adapter.client.webhooks.generateTestHeaderString({
        payload: raw,
        secret,
      }),
    };
  };
  const receive = (e = event()) => {
    const s = signed(e);
    const receipt = runtime.receiveStripe(
      "ca-test",
      Buffer.from(s.raw),
      s.signature,
    );
    assert.ok("id" in receipt);
    return receipt;
  };
  const result = (e: Effect, s = "failed") => ({
    reference: "re_synthetic",
    result: { ...JSON.parse(e.payload), effectId: e.id, status: s },
  });
  return Object.assign(f, {
    effect,
    refundId: refund.id,
    invoiceId: shipment.invoiceId,
    adapter,
    runtime,
    original,
    creates,
    reads,
    event,
    signed,
    receive,
    result,
    status: (s: NonNullable<Stripe.Refund["status"]>) => {
      status = s;
    },
    fail: (v: boolean) => {
      failRead = v;
    },
    mismatch: (v: boolean) => {
      mismatch = v;
    },
  });
}

test("signed refund HTTP ingress commits minimal identities before I/O, duplicates safely, and validates scope/money", async (t) => {
  const f = setup(t),
    http = await createHttp(f.app, {
      origin: "http://localhost",
      providers: f.runtime,
      staticRoot: "/nonexistent",
    });
  t.after(() => http.close());
  const post = async (e: ReturnType<typeof f.event>) => {
    const s = f.signed(e);
    return http.inject({
      method: "POST",
      url: "/webhooks/stripe/ca-test",
      headers: {
        "content-type": "application/json",
        "stripe-signature": s.signature,
      },
      payload: s.raw,
    });
  };
  for (const changes of [{ livemode: true }, { account: "acct_other" }])
    assert.equal(
      (await post(f.event("evt_bad", "refund.updated", {}, changes)))
        .statusCode,
      400,
    );
  for (const object of [
    { object: "charge" },
    { id: "other" },
    { payment_intent: "pi_other" },
    { amount: 11301 },
    { currency: "usd" },
    { metadata: { effect_id: f.effect.id } },
    { metadata: { effect_id: "foreign", refund_id: f.refundId } },
  ])
    assert.notEqual(
      (await post(f.event("evt_bad", "refund.updated", object))).statusCode,
      200,
    );
  assert.equal(
    (
      await post(f.event("evt_manual", "refund.created", { metadata: {} }))
    ).json().ignored,
    true,
  );
  const signed = f.signed();
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: "/webhooks/stripe/ca-test",
        headers: {
          "content-type": "application/json",
          "stripe-signature": signed.signature,
        },
        payload: signed.raw + " ",
      })
    ).statusCode,
    400,
  );
  assert.equal(f.app.integration.callbacks(f.actor).length, 0);
  const response = await post(
    f.event("evt_refund", "refund.failed", {
      status: "failed",
      description: "Sensitive raw customer data",
    }),
  );
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().duplicate, false);
  assert.equal(f.reads.mock.calls.length, 0);
  assert.equal(f.creates.mock.calls.length, 0);
  assert.equal(f.original.mock.calls.length, 0);
  const callback = f.app.integration.callbacks(f.actor)[0]!;
  assert.equal(callback.kind, "refund");
  assert.equal(callback.state, "pending");
  assert.ok(!JSON.stringify(callback).includes("Sensitive"));
  assert.equal(
    (
      await post(
        f.event("evt_refund", "refund.failed", {
          status: "failed",
          description: "Sensitive raw customer data",
        }),
      )
    ).json().duplicate,
    true,
  );
  assert.equal(
    (
      await post(
        f.event("evt_refund", "refund.failed", {
          status: "failed",
          description: "Changed raw data",
        }),
      )
    ).statusCode,
    409,
  );
  await f.runtime.tick(); // Signed old failure is only a hint; current read is succeeded.
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).refunded, 11300);
  assert.equal(f.app.integration.callbacks(f.actor)[0]!.state, "completed");
  assert.equal(f.creates.mock.calls.length, 1);
});

test("late failure after success and delayed events read current status without resending cash across restart", async (t) => {
  const f = setup(t);
  await f.runtime.execute(f.actor, f.effect.id);
  f.status("failed");
  f.receive(f.event("evt_failed", "refund.failed"));
  await f.runtime.tick();
  const notice = f.app.billing.refunds.alerts.page(f.actor).items[0]!;
  assert.equal(notice.status, "failed");
  assert.equal(notice.revision, 1);
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).refunded, 0);
  f.app.close();
  f.app = new Application(f.path);
  const runtime = new ProviderRuntime(f.app, [
    {
      id: "ca-test",
      orgId: f.actor.orgId,
      workerUserId: f.actor.id,
      stripe: { adapter: f.adapter, webhookSecret: "whsec_synthetic" },
    },
  ]);
  const delayed = f.signed(
    f.event("evt_delayed", "refund.created", { status: "pending" }),
  );
  runtime.receiveStripe("ca-test", Buffer.from(delayed.raw), delayed.signature);
  await runtime.tick();
  assert.equal(
    f.app.billing.refunds.list(f.actor)[0]!.provider_status,
    "failed",
  );
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).refunded, 0);
  assert.equal(
    f.app.integration.callbacks(f.actor).filter((c) => c.state === "completed")
      .length,
    2,
  );
  assert.equal(f.creates.mock.calls.length, 1);
  assert.equal(
    f.app.billing.refunds.alerts.page(f.actor).items[0]!.revision,
    1,
  );
});

test("unknown lost send is bound by exact signed refund identity and absence never authorizes a resend", async (t) => {
  const f = setup(t);
  await assert.rejects(
    f.app.integration.execute(f.actor, f.effect.id, {
      execute: async () => {
        throw Error("lost");
      },
      lookup: async () => null,
    }),
  );
  assert.equal(
    f.app.integration.effect(f.actor, f.effect.id).external_ref,
    null,
  );
  const callback = f.receive();
  await f.runtime.tick();
  assert.equal(f.reads.mock.calls[0]!.arguments[0], "re_synthetic");
  assert.equal(
    f.app.integration.effect(f.actor, f.effect.id).external_ref,
    "re_synthetic",
  );
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).refunded, 11300);
  assert.equal(f.creates.mock.calls.length, 0);
  f.receive(f.event("evt_absence"));
  const c = f.app.integration
    .callbacks(f.actor)
    .find((c) => c.id !== callback.id)!;
  await f.app.integration.refundCallbacks.run(f.actor, c.id, {
    execute: async () => {
      throw Error("never");
    },
    lookup: async () => null,
  });
  assert.equal(
    f.app.integration.callbacks(f.actor).find((row) => row.id === c.id)!.state,
    "failed",
  );
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).refunded, 11300);
  await assert.rejects(f.runtime.execute(f.actor, f.effect.id), {
    code: "STATE",
  });
});

test("provider mismatches fail for finance review; transient failure redacts and retries without new repayment", async (t) => {
  const f = setup(t);
  await f.runtime.execute(f.actor, f.effect.id);
  const c = f.receive();
  f.mismatch(true);
  await f.runtime.tick();
  assert.equal(f.app.integration.callbacks(f.actor)[0]!.state, "failed");
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).refunded, 11300);
  f.mismatch(false);
  f.fail(true);
  f.app.integration.retryCallback(f.actor, c.id);
  await f.runtime.tick();
  const waiting = f.app.integration.callbacks(f.actor)[0]!;
  assert.equal(waiting.state, "waiting");
  assert.ok(!waiting.error!.includes("secret"));
  const count = f.reads.mock.calls.length;
  await f.runtime.tick();
  assert.equal(f.reads.mock.calls.length, count);
  f.fail(false);
  f.status("failed");
  f.app.integration.retryCallback(f.actor, c.id);
  await f.runtime.tick();
  assert.equal(f.app.integration.callbacks(f.actor)[0]!.state, "completed");
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).refunded, 0);
  assert.equal(f.creates.mock.calls.length, 1);
});

test("permission and consent changes prevent callback reads; passive signed receipt survives withdrawal", async (t) => {
  const f = setup(t);
  await f.runtime.execute(f.actor, f.effect.id);
  chooseProviders(f, f.actor, "withdraw", {
    accountId: f.buyer,
    region: "CA",
    mode: "strict",
    providers: [],
    version: 2,
    acknowledgment: "Synthetic withdrawal",
  });
  const c = f.receive();
  f.status("failed");
  await f.runtime.tick();
  assert.equal(f.app.integration.callbacks(f.actor)[0]!.state, "blocked");
  assert.equal(f.reads.mock.calls.length, 0);
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).refunded, 11300);
  chooseProviders(f, f.actor, "allow", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["stripe"],
    version: 3,
    acknowledgment: "Synthetic restored consent",
  });
  f.app.integration.retryCallback(f.actor, c.id);
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='support' WHERE id=?", f.actor.id);
  await assert.rejects(
    f.app.integration.refundCallbacks.run(f.actor, c.id, f.adapter),
    { code: "FORBIDDEN" },
  );
  assert.throws(() => f.receive(f.event("evt_revoked")), { code: "FORBIDDEN" });
  assert.equal(f.reads.mock.calls.length, 0);
});

test("current grants and recovery are checked after I/O and failed completion rolls back native observations", async (t) => {
  for (const change of ["role", "password", "restore", "audit"]) {
    const f = setup(t);
    await f.runtime.execute(f.actor, f.effect.id);
    const c = f.receive();
    let reads = 0;
    const a: Adapter = {
      execute: async () => {
        throw Error("never");
      },
      lookup: async (e) => {
        reads++;
        if (change === "role")
          f.app.database
            .owned("iam")
            .run("UPDATE iam_users SET role='support' WHERE id=?", f.actor.id);
        if (change === "password")
          f.app.database
            .owned("iam")
            .run(
              "INSERT INTO iam_user_security VALUES(?,1,1,?)",
              f.actor.id,
              new Date().toISOString(),
            );
        if (change === "restore")
          f.app.platform.isolateRestore("synthetic", new Date().toISOString());
        if (change === "audit")
          f.app.database
            .owned("platform")
            .migrate(
              "CREATE TRIGGER platform_fail_refund_callback BEFORE INSERT ON platform_audit WHEN NEW.action='integration.refund-callback.completed' BEGIN SELECT RAISE(ABORT,'synthetic late audit failure'); END;",
            );
        return f.result(e);
      },
    };
    await f.app.integration.refundCallbacks.run(f.actor, c.id, a);
    assert.equal(reads, 1);
    assert.equal(f.app.billing.totals(f.actor, f.invoiceId).refunded, 11300);
    if (change === "password")
      assert.throws(() => f.app.billing.refunds.list(f.actor), {
        code: "PASSWORD_CHANGE_REQUIRED",
      });
    assert.equal(
      f.app.database
        .owned("billing")
        .get<{ count: number }>(
          "SELECT count(*) count FROM billing_refund_observations WHERE org_id=? AND refund_id=?",
          f.actor.orgId,
          f.refundId,
        )!.count,
      1,
    );
    const row = f.app.database
      .owned("integration")
      .get("SELECT state FROM integration_refund_callbacks WHERE id=?", c.id)!;
    assert.equal(row.state, change === "audit" ? "waiting" : "blocked");
  }
});

test("abandoned callback claim cannot change cash or release a successor's refund read", async (t) => {
  const f = setup(t);
  await f.runtime.execute(f.actor, f.effect.id);
  const c = f.receive();
  let enter!: () => void,
    resolve!: (value: ReturnType<typeof f.result>) => void;
  const entered = new Promise<void>((r) => (enter = r));
  const first = f.app.integration.refundCallbacks.run(f.actor, c.id, {
    execute: async () => {
      throw Error("never");
    },
    lookup: async () => {
      enter();
      return new Promise((r) => (resolve = r));
    },
  });
  await entered;
  f.app.database
    .owned("integration")
    .run(
      "UPDATE integration_refund_callbacks SET started_at=1 WHERE id=?",
      c.id,
    );
  f.app.database
    .owned("integration")
    .run(
      "UPDATE integration_refund_polls SET started_at=1 WHERE effect_id=?",
      f.effect.id,
    );
  const second = new Application(f.path);
  t.after(() => second.close());
  assert.equal(second.integration.recoverCallbacks(), 1);
  assert.equal(second.integration.refunds.recover(120000, f.actor.orgId), 1);
  let enterSecond!: () => void,
    resolveSecond!: (value: ReturnType<typeof f.result>) => void;
  const secondEntered = new Promise<void>((r) => (enterSecond = r));
  const successor = second.integration.refundCallbacks.run(f.actor, c.id, {
    execute: async () => {
      throw Error("never");
    },
    lookup: async () => {
      enterSecond();
      return new Promise((r) => (resolveSecond = r));
    },
  });
  await secondEntered;
  resolve(f.result(f.effect));
  await first;
  assert.equal(second.integration.callbacks(f.actor)[0]!.state, "processing");
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).refunded, 11300);
  resolveSecond(f.result(f.effect));
  await successor;
  assert.equal(second.integration.callbacks(f.actor)[0]!.state, "completed");
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).refunded, 0);
});

test("returned transfer requires action after success reserves cash again and can succeed after customer correction", async (t) => {
  const f = setup(t);
  await f.runtime.execute(f.actor, f.effect.id);
  f.status("requires_action");
  f.receive();
  await f.runtime.tick();
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).refunded, 0);
  assert.equal(f.app.billing.refunds.list(f.actor)[0]!.state, "unknown");
  const b = f.app.database
    .owned("billing")
    .get("SELECT payment_id FROM billing_refunds WHERE id=?", f.refundId)!;
  assert.throws(
    () =>
      f.app.billing.refundRequest(f.actor, "extra", {
        invoiceId: f.invoiceId,
        paymentId: String(b.payment_id),
        amount: 1,
        reference: "EXTRA",
        reason: "Synthetic",
      }),
    { code: "OVER_REFUND" },
  );
  f.status("succeeded");
  f.receive(f.event("evt_corrected"));
  await f.runtime.tick();
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).refunded, 11300);
  assert.deepEqual(
    f.app.billing.refunds.list(f.actor)[0]!.observations.map((o) => o.status),
    ["succeeded", "requires_action", "succeeded"],
  );
});

test("refund callback HTTP lists and retry require finance/current session with tenant privacy", async (t) => {
  const f = setup(t);
  await f.runtime.execute(f.actor, f.effect.id);
  const c = f.receive();
  f.fail(true);
  await f.runtime.tick();
  const other = fixture(t),
    foreign = other.actor;
  const iam = f.app.database.owned("iam");
  const org = other.app.identity.organization(foreign);
  iam.run(
    "INSERT INTO iam_organizations VALUES(?,?,?,?,?)",
    org.id,
    org.name,
    org.region,
    org.currency,
    org.policy,
  );
  const user = other.app.database
    .owned("iam")
    .get("SELECT * FROM iam_users WHERE id=?", foreign.id)!;
  iam.run(
    "INSERT INTO iam_users(id,org_id,email,name,role,sites,salt,password_hash) VALUES(?,?,?,?,?,?,?,?)",
    String(user.id),
    String(user.org_id),
    "foreign@example.test",
    String(user.name),
    String(user.role),
    String(user.sites),
    String(user.salt),
    String(user.password_hash),
  );
  assert.equal(f.app.integration.callbacks(foreign).length, 0);
  assert.throws(() => f.app.integration.retryCallback(foreign, c.id), {
    code: "NOT_FOUND",
  });
  const foreignRuntime = new ProviderRuntime(f.app, [
    {
      id: "foreign",
      orgId: foreign.orgId,
      workerUserId: foreign.id,
      stripe: { adapter: f.adapter, webhookSecret: "whsec_synthetic" },
    },
  ]);
  const s = f.signed();
  assert.throws(
    () =>
      foreignRuntime.receiveStripe("foreign", Buffer.from(s.raw), s.signature),
    { code: "NOT_FOUND" },
  );
  for (const role of ["buyer", "commercial"] as const)
    assert.throws(
      () =>
        f.app.integration.callbacks({
          ...f.actor,
          role,
          accountId: role === "buyer" ? f.buyer : null,
        }),
      { code: "FORBIDDEN" },
    );
  const http = await createHttp(f.app, {
    origin: "http://localhost",
    providers: f.runtime,
    staticRoot: "/nonexistent",
  });
  t.after(() => http.close());
  const session = f.app.identity.login(
      "admin@example.test",
      "long-test-only-password",
    ),
    headers = {
      origin: "http://localhost",
      cookie: `distributor_session=${session.token}`,
      "x-csrf-token": session.csrf,
    },
    url = `/api/provider-callbacks/${c.id}/retry`;
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url,
        headers: { cookie: headers.cookie },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await http.inject({ method: "POST", url, headers })).statusCode,
    200,
  );
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='support' WHERE id=?", f.actor.id);
  assert.equal(
    (await http.inject({ method: "POST", url, headers })).statusCode,
    403,
  );
});

test("separate processes claim one signed callback, retrieve once and reverse one repayment", async (t) => {
  const f = setup(t);
  await f.runtime.execute(f.actor, f.effect.id);
  const callback = f.receive();
  const { fork } = await import("node:child_process");
  const children: import("node:child_process").ChildProcess[] = [];
  const started: Promise<void>[] = [],
    finished: Promise<any>[] = [];
  for (let i = 0; i < 2; i++) {
    const child = fork(new URL("./refund-child.ts", import.meta.url), [], {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    children.push(child);
    let ready!: () => void,
      resolve!: (v: any) => void,
      reject!: (e: Error) => void;
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
      if (code) reject(Error(`Refund callback child ${code}: ${stderr}`));
    });
    child.send({
      action: "init",
      path: f.path,
      actor: f.actor,
      effectId: f.effect.id,
      callbackId: callback.id,
    });
  }
  t.after(() => children.forEach((c) => c.kill()));
  await Promise.all(started);
  children.forEach((c) => c.send({ action: "go" }));
  const outcomes = await Promise.all(finished);
  assert.equal(
    outcomes.filter((v) => v.ok).length,
    1,
    JSON.stringify(outcomes),
  );
  assert.equal(outcomes.find((v) => !v.ok).code, "STATE");
  assert.equal(outcomes.find((v) => v.ok).reads, 1);
  assert.equal(f.app.integration.callbacks(f.actor)[0]!.attempts, 1);
  assert.equal(f.app.integration.callbacks(f.actor)[0]!.state, "completed");
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).refunded, 0);
  assert.deepEqual(
    f.app.billing.refunds.list(f.actor)[0]!.observations.map((o) => o.status),
    ["succeeded", "failed"],
  );
  assert.equal(f.creates.mock.calls.length, 1);
});

test("receipt and audit commit together and signed event identities cannot switch operation kinds", (t) => {
  const f = setup(t),
    integration = f.app.database.owned("integration"),
    platform = f.app.database.owned("platform");
  platform.migrate(
    "CREATE TRIGGER platform_fail_refund_receipt BEFORE INSERT ON platform_audit WHEN NEW.action='integration.refund-callback.received' BEGIN SELECT RAISE(ABORT,'synthetic ingress failure'); END;",
  );
  assert.throws(() => f.receive());
  assert.equal(f.app.integration.callbacks(f.actor).length, 0);
  platform.migrate("DROP TRIGGER platform_fail_refund_receipt;");
  f.receive();
  assert.throws(
    () =>
      f.app.integration.receiveCallback(f.actor, {
        bindingId: "ca-test",
        eventId: "evt_refund",
        effectId: f.effect.id,
        sessionId: "cs_synthetic",
        hash: "test",
      }),
    { code: "EVENT_CONFLICT" },
  );
  f.app.integration.receiveCallback(f.actor, {
    bindingId: "ca-test",
    eventId: "evt_checkout",
    effectId: f.effect.id,
    sessionId: "cs_synthetic",
    hash: "test",
  });
  assert.throws(() => f.receive(f.event("evt_checkout")), {
    code: "EVENT_CONFLICT",
  });
  assert.equal(
    integration.all("SELECT * FROM integration_refund_callbacks").length,
    1,
  );
  assert.equal(f.reads.mock.calls.length, 0);
});
