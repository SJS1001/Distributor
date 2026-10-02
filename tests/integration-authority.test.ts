import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, accept, ship, chooseProviders } from "./fixtures.ts";
import type { Actor, Role } from "../src/server/core.ts";
import { Application } from "../src/server/application.ts";
import { ProviderRuntime } from "../src/server/provider-runtime.ts";
import type { Owner } from "../src/server/database.ts";

function user(f: ReturnType<typeof fixture>, role: Role) {
  const result = f.app.identity.createUser(f.actor, `integration-${role}`, {
    name: `Integration ${role}`,
    email: `integration-${role}@example.test`,
    password: "long-integration-test-password",
    role,
    sites: role === "buyer" ? [] : [f.w1],
    ...(role === "buyer" ? { accountId: f.buyer } : {}),
  });
  return f.app.identity.currentActor({ ...f.actor, id: result.id });
}
function change(
  f: ReturnType<typeof fixture>,
  a: Actor,
  updates: Record<string, unknown>,
) {
  const row = f.app.identity.users(f.actor).find((u) => u.id === a.id)!;
  f.app.identity.updateUser(
    f.actor,
    `integration-grant-${a.id}-${row.revision}`,
    {
      userId: a.id,
      revision: row.revision,
      name: row.name,
      email: row.email,
      role: row.role,
      sites: row.sites,
      ...(row.accountId ? { accountId: row.accountId } : {}),
      active: true,
      currentPassword: "long-test-only-password",
      reason: "Synthetic integration authority change",
      ...updates,
    },
  );
}
function setup(t: Parameters<typeof fixture>[0]) {
  const f = fixture(t),
    shipment = ship(f, accept(f).id),
    a = user(f, "finance");
  chooseProviders(f, f.actor, "choice", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["stripe"],
    version: 1,
    acknowledgment: "Synthetic processor choice",
  });
  const effect = f.app.integration.checkout(a, "checkout", {
    invoiceId: shipment.invoiceId,
  });
  const input = {
    bindingId: "authority-binding",
    eventId: "authority-event",
    sessionId: "cs_test_authority",
    effectId: effect.id,
    hash: "synthetic-signed-hash",
  };
  const callback = f.app.integration.receiveCallback(a, input);
  const processing = f.app.integration.receiveCallback(a, {
    ...input,
    eventId: "processing-event",
  });
  const attempt = f.app.integration.claimCallback(a, processing.id).attempts;
  const blocked = f.app.integration.receiveCallback(a, {
    ...input,
    eventId: "blocked-event",
  });
  const blockedAttempt = f.app.integration.claimCallback(
    a,
    blocked.id,
  ).attempts;
  f.app.integration.finishCallback(a, blocked.id, blockedAttempt, "blocked");
  return Object.assign(f, {
    a,
    shipment,
    effect,
    input,
    callback,
    processing,
    attempt,
    blocked,
  });
}
function facts(f: ReturnType<typeof fixture>) {
  const tables: [Owner, string[]][] = [
    [
      "integration",
      [
        "effects",
        "inbox",
        "callbacks",
        "refund_callbacks",
        "operation_leases",
        "refund_polls",
        "payment_allocations",
        "accounting_refunds",
        "credit_applications",
        "checkout_renewals",
        "checkout_observations",
      ],
    ],
    [
      "billing",
      ["invoices", "lines", "payments", "credits", "refunds", "counters"],
    ],
    ["inventory", ["units", "movements", "allocations"]],
    ["orders", ["orders", "lines"]],
    ["platform", ["commands", "audit", "audit_order", "audit_clock", "events"]],
  ];
  return tables.flatMap(([owner, names]) =>
    names.map((name) =>
      f.app.database
        .owned(owner)
        .all(`SELECT * FROM ${owner}_${name} ORDER BY rowid`),
    ),
  );
}
function operations(f: ReturnType<typeof setup>, a: Actor) {
  const i = f.app.integration;
  return [
    () => i.effect(a, f.effect.id),
    () => i.list(a),
    () => i.pending(a),
    () => i.callbacks(a),
    () => i.refundCallbacks.list(a),
    () => i.dueCallbacks(a, f.input.bindingId),
    () => i.receiveCallback(a, f.input),
    () => i.receiveCallback(a, { ...f.input, eventId: "new-event" }),
    () => i.claimCallback(a, f.callback.id),
    () => i.finishCallback(a, f.processing.id, f.attempt, "completed"),
    () => i.retryCallback(a, f.blocked.id),
    () => i.accountingCsv(a),
  ];
}
function denied(ops: (() => unknown)[], code = "FORBIDDEN") {
  const outcomes = ops.map((op) => {
    try {
      op();
      return "allowed";
    } catch (error) {
      return (error as { code: string }).code;
    }
  });
  assert.deepEqual(
    outcomes,
    ops.map(() => code),
  );
}
test("provider queues reject missing, foreign and inactive principals before reads, duplicate receipts or callback mutations", (t) => {
  const f = setup(t);
  for (const a of [
    { ...f.a, id: "missing" },
    { ...f.a, orgId: "foreign" },
  ]) {
    const before = facts(f);
    denied(operations(f, a));
    assert.deepEqual(facts(f), before);
  }
  change(f, f.a, { active: false });
  const before = facts(f);
  denied(operations(f, f.a));
  assert.deepEqual(facts(f), before);
});
test("provider queues use current roles before reads, duplicate receipts, claims, completion and retries", (t) => {
  const f = setup(t);
  change(f, f.a, { role: "warehouse", sites: [f.w1] });
  const before = facts(f);
  denied(operations(f, f.a));
  assert.deepEqual(facts(f), before);
});
test("required password changes block provider queue reads and all checkout callback mutations", (t) => {
  const f = setup(t);
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_user_security SET password_change_required=1,revision=revision+1 WHERE user_id=?",
      f.a.id,
    );
  const before = facts(f);
  denied(operations(f, f.a), "PASSWORD_CHANGE_REQUIRED");
  assert.deepEqual(facts(f), before);
});
test("provider queues honor independent promotions and revocations across restart without trusting supplied finance grants", (t) => {
  const f = setup(t),
    a = user(f, "warehouse"),
    other = new Application(f.path);
  try {
    const before = facts(f);
    denied(operations(f, { ...a, role: "admin" }));
    assert.deepEqual(facts(f), before);
    change({ ...f, app: other }, a, { role: "finance" });
    assert.equal(f.app.integration.pending(a)[0]!.id, f.effect.id);
    assert.equal(f.app.integration.callbacks(a).length, 3);
    assert.equal(f.app.integration.accountingCsv(a).includes("11300"), true);
    assert.deepEqual(f.app.integration.receiveCallback(a, f.input), {
      id: f.callback.id,
      duplicate: true,
    });
    change({ ...f, app: other }, a, { role: "warehouse" });
    const revoked = facts(f);
    denied(operations(f, { ...a, role: "admin" }));
    assert.deepEqual(facts(f), revoked);
    f.app.close();
    f.app = new Application(f.path);
    denied(operations(f, { ...a, role: "admin" }));
    assert.deepEqual(facts(f), revoked);
    change({ ...f, app: other }, a, { role: "finance" });
    assert.deepEqual(f.app.integration.receiveCallback(a, f.input), {
      id: f.callback.id,
      duplicate: true,
    });
  } finally {
    other.close();
  }
});
test("provider effect reads enforce current buyer account and financial kind scope", (t) => {
  const f = setup(t),
    buyer = user(f, "buyer"),
    commercial = user(f, "commercial");
  assert.equal(f.app.integration.effect(buyer, f.effect.id).id, f.effect.id);
  const account = f.app.identity.createCustomer(f.actor, "other-buyer", {
    name: "Other buyer",
    tier: "standard",
    creditLimit: 100000,
  }).id;
  change(f, buyer, { accountId: account });
  const before = facts(f);
  denied([
    () =>
      f.app.integration.effect(
        { ...buyer, role: "admin", accountId: f.buyer },
        f.effect.id,
      ),
  ]);
  assert.equal(f.app.integration.list(buyer).length, 0);
  // An owning synthetic accounting intent distinguishes financial data from checkout visibility.
  f.app.database
    .owned("integration")
    .run(
      "INSERT INTO integration_effects(id,org_id,account_id,provider,kind,reference,payload,state,created_at,residency_version) VALUES(?,?,?,?,?,?,?,?,?,?)",
      "private-payment",
      f.actor.orgId,
      f.buyer,
      "quickbooks",
      "payment",
      "synthetic-payment",
      "{}",
      "pending",
      new Date().toISOString(),
      2,
    );
  denied([() => f.app.integration.effect(commercial, "private-payment")]);
  assert.equal(
    f.app.integration.list(commercial).some((e) => e.id === "private-payment"),
    false,
  );
  assert.equal(
    f.app.integration.effect(f.a, "private-payment").id,
    "private-payment",
  );
  // The denied buyer read itself preserved all native and integration facts.
  assert.deepEqual(
    facts(f).map((rows, n) =>
      n === 0 ? rows.filter((r) => r.id !== "private-payment") : rows,
    ),
    before,
  );
});
test("fresh callback authority preserves attempt fencing and valid recovery without repeating cash", (t) => {
  const f = setup(t);
  f.app.database
    .owned("integration")
    .run(
      "UPDATE integration_callbacks SET started_at=1 WHERE id=?",
      f.processing.id,
    );
  assert.equal(f.app.integration.recoverCallbacks(), 1);
  const successor = f.app.integration.claimCallback(f.a, f.processing.id);
  const before = facts(f);
  f.app.integration.finishCallback(f.a, f.processing.id, f.attempt, "failed");
  assert.deepEqual(facts(f), before);
  f.app.integration.finishCallback(
    f.a,
    f.processing.id,
    successor.attempts,
    "completed",
  );
  assert.equal(
    f.app.integration.callbacks(f.a).find((c) => c.id === f.processing.id)!
      .state,
    "completed",
  );
  assert.equal(f.app.billing.totals(f.actor, f.shipment.invoiceId).paid, 0);
  assert.equal(
    f.app.integration.retryCallback(f.a, f.blocked.id).state,
    "pending",
  );
});
test("checkout callback mutations recheck authority after acquiring their transaction", (t) => {
  for (const operation of [
    "receive",
    "duplicate",
    "claim",
    "finish",
    "retry",
  ] as const) {
    const f = setup(t),
      transaction = f.app.database.transaction.bind(f.app.database);
    let revoke = true;
    t.mock.method(f.app.database, "transaction", (fn: () => unknown) => {
      if (revoke) {
        revoke = false;
        f.app.database
          .owned("iam")
          .run("UPDATE iam_users SET active=0 WHERE id=?", f.a.id);
      }
      return transaction(fn);
    });
    const before = facts(f),
      i = f.app.integration;
    denied([
      () => {
        if (operation === "receive")
          return i.receiveCallback(f.a, { ...f.input, eventId: "fresh-event" });
        if (operation === "duplicate") return i.receiveCallback(f.a, f.input);
        if (operation === "claim") return i.claimCallback(f.a, f.callback.id);
        if (operation === "finish")
          return i.finishCallback(f.a, f.processing.id, f.attempt, "completed");
        return i.retryCallback(f.a, f.blocked.id);
      },
    ]);
    assert.deepEqual(facts(f), before);
  }
});
test("support can inspect provider queues but cannot run checkout callback writes; recovery hold blocks retry and claim", (t) => {
  const f = setup(t),
    support = user(f, "support"),
    i = f.app.integration;
  assert.equal(i.pending(support).length, 1);
  assert.equal(i.callbacks(support).length, 3);
  const before = facts(f);
  denied([
    () => i.receiveCallback(support, f.input),
    () => i.dueCallbacks(support, f.input.bindingId),
    () => i.claimCallback(support, f.callback.id),
    () => i.finishCallback(support, f.processing.id, f.attempt, "completed"),
    () => i.retryCallback(support, f.blocked.id),
  ]);
  assert.deepEqual(facts(f), before);
  f.app.platform.isolateRestore(
    "synthetic-authority",
    new Date().toISOString(),
  );
  const held = facts(f);
  denied(
    [
      () => i.claimCallback(f.a, f.callback.id),
      () => i.retryCallback(f.a, f.blocked.id),
    ],
    "RECOVERY_HOLD",
  );
  assert.deepEqual(facts(f), held);
  // A signed minimal receipt remains durable during isolation, with no cash.
  assert.equal(i.receiveCallback(f.a, f.input).duplicate, true);
  assert.equal(f.app.billing.totals(f.actor, f.shipment.invoiceId).paid, 0);
});
test("revocation during settlement verification retains an interrupted receipt for a qualified successor without cash", async (t) => {
  const f = setup(t);
  // Only one callback is due in this timing scenario.
  f.app.integration.finishCallback(
    f.a,
    f.processing.id,
    f.attempt,
    "completed",
  );
  f.app.database
    .owned("integration")
    .run(
      "UPDATE integration_effects SET state='completed',external_ref='cs_test_authority' WHERE id=?",
      f.effect.id,
    );
  let reads = 0;
  const runtime = new ProviderRuntime(f.app, [
    {
      id: f.input.bindingId,
      orgId: f.actor.orgId,
      workerUserId: f.a.id,
      stripe: {
        webhookSecret: "whsec_synthetic",
        adapter: {
          execute: async () => {
            throw new Error("No provider writes permitted");
          },
          lookup: async () => null,
          verifyWebhook: () => {
            throw new Error("Unused");
          },
          verifySettlement: async () => {
            reads++;
            change(f, f.a, { role: "warehouse" });
            return {
              paid: true,
              amount: 11300,
              currency: "cad",
              paymentId: "pi_authority",
              effectId: f.effect.id,
              livemode: false,
            };
          },
        },
      },
    },
  ]);
  await assert.rejects(runtime.tick(), { code: "FORBIDDEN" });
  assert.equal(reads, 1);
  assert.equal(f.app.billing.totals(f.actor, f.shipment.invoiceId).paid, 0);
  assert.equal(
    f.app.integration.callbacks(f.actor).find((c) => c.id === f.callback.id)!
      .state,
    "processing",
  );
  f.app.database
    .owned("integration")
    .run(
      "UPDATE integration_callbacks SET started_at=1 WHERE id=?",
      f.callback.id,
    );
  assert.equal(f.app.integration.recoverCallbacks(), 1);
  const successor = f.app.integration.claimCallback(f.actor, f.callback.id);
  assert.equal(successor.attempts, 2);
  const before = facts(f);
  denied([
    () => f.app.integration.finishCallback(f.a, f.callback.id, 1, "completed"),
  ]);
  assert.deepEqual(facts(f), before);
  f.app.integration.finishCallback(
    f.actor,
    f.callback.id,
    successor.attempts,
    "waiting",
  );
  f.app.database
    .owned("integration")
    .run(
      "UPDATE integration_callbacks SET retry_at=0 WHERE id=?",
      f.callback.id,
    );
  const replacement = new ProviderRuntime(f.app, [
    {
      id: f.input.bindingId,
      orgId: f.actor.orgId,
      workerUserId: f.actor.id,
      stripe: {
        webhookSecret: "whsec_synthetic",
        adapter: {
          execute: async () => {
            throw new Error("No provider writes permitted");
          },
          lookup: async () => null,
          verifyWebhook: () => {
            throw new Error("Unused");
          },
          verifySettlement: async () => {
            reads++;
            return {
              paid: true,
              amount: 11300,
              currency: "cad",
              paymentId: "pi_authority",
              effectId: f.effect.id,
              livemode: false,
            };
          },
        },
      },
    },
  ]);
  assert.equal((await replacement.tick()).settled, 1);
  assert.equal(reads, 2);
  assert.equal(f.app.billing.totals(f.actor, f.shipment.invoiceId).paid, 11300);
  const settled = facts(f);
  assert.equal((await replacement.tick()).settled, 0);
  assert.equal(
    f.app.integration.receiveCallback(f.actor, f.input).duplicate,
    true,
  );
  assert.deepEqual(facts(f), settled);
});
