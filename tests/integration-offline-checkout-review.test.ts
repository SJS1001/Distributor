import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { fixture, accept, ship, chooseProviders } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { canonical, digest, type Actor } from "../src/server/core.ts";
import { Store } from "../src/server/database.ts";
import { IntegrationOfflineCheckoutReview } from "../src/server/integration-offline-checkout-review.ts";

const refused = { code: "OFFLINE_CHECKOUT_REVIEW" };
const limit = { code: "OFFLINE_CHECKOUT_REVIEW_LIMIT" };
function reader(f: ReturnType<typeof fixture>) {
  return new IntegrationOfflineCheckoutReview(
    f.app.database,
    f.app.identity,
    f.app.billing,
    f.app.integration.checkouts,
  );
}
async function setup(
  t: Parameters<typeof fixture>[0],
  region: "CA" | "US" = "CA",
  currency: "CAD" | "USD" = "CAD",
  renew = 0,
) {
  const f = fixture(t, {}, region, currency),
    invoiceId = ship(f, accept(f).id).invoiceId;
  chooseProviders(f, f.actor, "choice", {
    accountId: f.buyer,
    region,
    mode: "provider-exceptions",
    providers: ["stripe"],
    version: 1,
    acknowledgment: "Synthetic permission only",
  });
  let effect = f.app.integration.checkout(f.actor, "checkout", { invoiceId });
  const chain = [effect.id];
  for (let i = 0; i < renew; i++) {
    effect = f.app.integration.renewCheckout(f.actor, `renew-${i}`, {
      effectId: effect.id,
      reviewVersion: f.app.integration.checkouts.reviewVersion(
        f.app.integration.effect(f.actor, effect.id),
      ),
      amount: 11300,
      reason: "Reviewed synthetic replacement",
    });
    chain.push(effect.id);
  }
  let calls = 0;
  const adapter = {
    execute: async () => {
      calls++;
      throw Error("Synthetic lost response");
    },
    lookup: async () => {
      calls++;
      return null;
    },
  };
  assert.equal(
    (await f.app.integration.execute(f.actor, effect.id, adapter)).state,
    "unknown",
  );
  const review = () =>
    f.app.database.transaction(() =>
      reader(f).getInTransaction(f.actor, effect.id),
    );
  return Object.assign(f, {
    invoiceId,
    effectId: effect.id,
    chain,
    review,
    adapter,
    calls: () => calls,
  });
}
type F = Awaited<ReturnType<typeof setup>>;
function integration(f: F) {
  return f.app.database.owned("integration");
}
function hold(f: F) {
  f.app.database
    .owned("platform")
    .run(
      "INSERT INTO platform_recovery(id,snapshot_hash,restored_at,source_completed_at) VALUES(1,?,?,?)",
      "a".repeat(64),
      "2026-10-03T00:00:00.000Z",
      "2026-10-02T23:59:00.000Z",
    );
}
function snapshot(f: F) {
  return canonical([
    integration(f).all("SELECT * FROM integration_effects ORDER BY id"),
    integration(f).all(
      "SELECT * FROM integration_checkout_renewals ORDER BY successor_id",
    ),
    integration(f).all(
      "SELECT * FROM integration_checkout_observations ORDER BY sequence",
    ),
    integration(f).all(
      "SELECT * FROM integration_operation_leases ORDER BY effect_id",
    ),
  ]);
}
function frozen(v: unknown) {
  if (v && typeof v === "object") {
    assert.ok(Object.isFrozen(v));
    for (const x of Object.values(v)) frozen(x);
  }
}
for (const [region, currency] of [
  ["CA", "CAD"],
  ["CA", "USD"],
  ["US", "USD"],
] as const)
  test(`actual unknown checkout under hold ${region}/${currency}: empty collections, deterministic immutable facts and no IO`, async (t) => {
    const f = await setup(t, region, currency);
    hold(f);
    const before = snapshot(f),
      r = f.review(),
      { factsHash, ...facts } = r;
    assert.equal(r.organization.region, region);
    assert.equal(r.organization.currency, currency);
    assert.equal(r.targetId, f.effectId);
    assert.deepEqual(r.chain, [f.effectId]);
    assert.equal(r.effects[0]!.state, "unknown");
    assert.deepEqual(r.renewals, []);
    assert.deepEqual(r.observations, []);
    assert.deepEqual(r.inbox, []);
    assert.deepEqual(r.allocationPayments, []);
    assert.equal(r.collections.integration_operation_leases!.length, 1);
    for (const [name, rows] of Object.entries(r.collections))
      if (name !== "integration_operation_leases") assert.deepEqual(rows, []);
    assert.equal(factsHash, digest(canonical(facts)));
    frozen(r);
    assert.deepEqual(f.review(), r);
    assert.throws(() => {
      (r.effects[0] as any).state = "completed";
    }, TypeError);
    assert.equal(snapshot(f), before);
    assert.equal(f.calls(), 1);
    assert.throws(() => f.app.platform.assertProviderAccess(), {
      code: "RECOVERY_HOLD",
    });
  });

test("complete two-step native unsent renewal chain remains blocked and current unknown obligation survives", async (t) => {
  const f = await setup(t, "CA", "CAD", 2),
    before = snapshot(f),
    r = f.review();
  assert.deepEqual(r.chain, f.chain);
  assert.equal(r.renewals.length, 2);
  assert.equal(r.currentId, f.effectId);
  assert.equal(r.effects.filter((e) => e.state === "blocked").length, 2);
  assert.equal(snapshot(f), before);
});

test("complete native not-found observations are retained in sequence, not a history page", async (t) => {
  const f = await setup(t);
  for (let i = 0; i < 23; i++)
    await f.app.integration.reconcile(f.actor, f.effectId, f.adapter);
  const r = f.review();
  assert.equal(r.observations.length, 23);
  assert.equal(
    f.app.integration.checkouts.history(f.actor, f.effectId).items.length,
    20,
  );
  for (const row of r.observations) {
    assert.equal(digest(String(row.snapshot)), row.hash);
    assert.equal(JSON.parse(String(row.snapshot)).outcome, "not_found");
  }
});

test("actual expired predecessor proof and successor uncertainty are checked together", async (t) => {
  const f = await setup(t);
  await f.app.integration.reconcile(f.actor, f.effectId, {
    execute: async () => {
      throw Error("no send");
    },
    lookup: async () => ({
      reference: "cs_test_expired",
      result: {
        amount: 11300,
        currency: "cad",
        status: "expired",
        paymentStatus: "unpaid",
        expiresAt: 1900000000,
      },
    }),
  });
  const successor = f.app.integration.renewCheckout(f.actor, "renew-expired", {
    effectId: f.effectId,
    reviewVersion: f.app.integration.checkouts.reviewVersion(
      f.app.integration.effect(f.actor, f.effectId),
    ),
    amount: 11300,
    reason: "Expired unpaid fixture",
  });
  await f.app.integration.execute(f.actor, successor.id, f.adapter);
  const r = f.app.database.transaction(() =>
    reader(f).getInTransaction(f.actor, successor.id),
  );
  assert.equal(r.effects.length, 2);
  assert.equal(r.observations.length, 1);
  assert.deepEqual(r.chain, [f.effectId, successor.id]);
  const old = f.app.integration.effect(f.actor, f.effectId);
  integration(f).run(
    "UPDATE integration_effects SET result=? WHERE id=?",
    canonical({ ...JSON.parse(old.result!), expiresAt: 1900000001 }),
    f.effectId,
  );
  assert.throws(
    () =>
      f.app.database.transaction(() =>
        reader(f).getInTransaction(f.actor, successor.id),
      ),
    refused,
  );
});

test("actual callback for an unknown session stays a pending obligation with opaque received-body hash", async (t) => {
  const f = await setup(t);
  f.app.integration.receiveCallback(f.actor, {
    bindingId: "synthetic-binding",
    eventId: "evt_pending",
    effectId: f.effectId,
    sessionId: "cs_test_pending",
    hash: digest("synthetic raw signed event, not qualified"),
  });
  const r = f.review();
  assert.equal(r.collections.integration_callbacks!.length, 1);
  assert.equal(r.collections.integration_callbacks![0]!.state, "pending");
  assert.deepEqual(r.inbox, []);
});

test("real in-flight lookup lease is returned unchanged; read creates no claim or provider call", async (t) => {
  const f = await setup(t);
  let release!: (v: null) => void;
  const pending = f.app.integration.reconcile(f.actor, f.effectId, {
    execute: async () => {
      throw Error("unexpected send");
    },
    lookup: () =>
      new Promise<null>((resolve) => {
        release = resolve;
      }),
  });
  try {
    const r = f.review();
    assert.equal(
      typeof r.collections.integration_operation_leases![0]!.token,
      "string",
    );
    assert.equal(r.effects[0]!.state, "unknown");
  } finally {
    release(null);
    await pending;
  }
});

test("same existing native writer is required; uncommitted facts are read and rolled back", async (t) => {
  const f = await setup(t);
  assert.throws(() => reader(f).getInTransaction(f.actor, f.effectId), {
    code: "TRANSACTION",
  });
  const before = f.review(),
    stop = Error("rollback");
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        integration(f).run(
          "UPDATE integration_effects SET error='uncommitted local fact' WHERE id=?",
          f.effectId,
        );
        const r = reader(f).getInTransaction(f.actor, f.effectId);
        assert.notEqual(r.factsHash, before.factsHash);
        assert.equal(r.effects[0]!.error, "uncommitted local fact");
        throw stop;
      }),
    (e) => e === stop,
  );
  assert.deepEqual(f.review(), before);
  f.app.close();
  f.app = new Application(f.path, "CA");
  assert.deepEqual(
    f.app.database.transaction(() =>
      reader(f).getInTransaction(f.actor, f.effectId),
    ),
    before,
  );
});

for (const sql of [
  "UPDATE iam_users SET active=0 WHERE id=?",
  "UPDATE iam_users SET role='support' WHERE id=?",
  "UPDATE iam_users SET role='finance',account_id='foreign' WHERE id=?",
  "UPDATE iam_users SET org_id='foreign' WHERE id=?",
  "INSERT INTO iam_user_security(user_id,revision,password_change_required,updated_at) VALUES(?,1,1,'2026-10-03T00:00:00.000Z')",
])
  test(`fresh native authority refusal: ${sql}`, async (t) => {
    const f = await setup(t);
    f.app.database.owned("iam").run(sql, f.actor.id);
    assert.throws(f.review, (e) =>
      ["FORBIDDEN", "PASSWORD_CHANGE_REQUIRED"].includes((e as any).code),
    );
  });

test("proxy/accessor effect and actor inputs execute no user callbacks", async (t) => {
  const f = await setup(t);
  let calls = 0;
  const trap = new Proxy(
    {},
    {
      get() {
        calls++;
        throw Error("callback");
      },
      ownKeys() {
        calls++;
        throw Error("callback");
      },
      getOwnPropertyDescriptor() {
        calls++;
        throw Error("callback");
      },
    },
  );
  const getter = {
    get id() {
      calls++;
      return f.actor.id;
    },
    orgId: f.actor.orgId,
  } as Actor;
  for (const input of [
    trap,
    {},
    [],
    null,
    42,
    "",
    " id ",
    "x\0y",
    "x".repeat(161),
  ])
    assert.throws(
      () =>
        f.app.database.transaction(() =>
          reader(f).getInTransaction(f.actor, input),
        ),
      refused,
    );
  for (const actor of [trap, getter])
    assert.throws(
      () =>
        f.app.database.transaction(() =>
          reader(f).getInTransaction(actor as Actor, f.effectId),
        ),
      refused,
    );
  assert.equal(calls, 0);
});

for (const [label, sql, args] of [
  [
    "wrong account",
    "UPDATE integration_effects SET account_id='copied' WHERE id=?",
    [],
  ],
  [
    "wrong currency",
    "UPDATE integration_effects SET payload=replace(payload,'cad','usd') WHERE id=?",
    [],
  ],
  [
    "noncanonical intent",
    "UPDATE integration_effects SET payload=payload||' ' WHERE id=?",
    [],
  ],
  [
    "wrong invoice reference",
    "UPDATE integration_effects SET reference='wrong' WHERE id=?",
    [],
  ],
  [
    "foreign lease",
    "UPDATE integration_operation_leases SET org_id='foreign' WHERE effect_id=?",
    [],
  ],
  [
    "orphan lease",
    "UPDATE integration_operation_leases SET effect_id='orphan' WHERE effect_id=?",
    [],
  ],
  [
    "unpaired claim",
    "UPDATE integration_operation_leases SET token='claim' WHERE effect_id=?",
    [],
  ],
] as const)
  test(`native retained corruption refuses: ${label}`, async (t) => {
    const f = await setup(t);
    integration(f).run(sql, ...args, f.effectId);
    assert.throws(f.review);
  });

for (const change of [
  "hash='" + "0".repeat(64) + "'",
  "invoice_id='foreign'",
  "account_id='foreign'",
  "org_id='foreign'",
  "effect_id='orphan'",
])
  test(`complete observation linkage refuses ${change}`, async (t) => {
    const f = await setup(t);
    await f.app.integration.reconcile(f.actor, f.effectId, f.adapter);
    // External test-only corruption bypasses FK solely to reproduce a damaged copy.
    const db = new DatabaseSync(f.path);
    try {
      db.exec("PRAGMA foreign_keys=OFF");
      db.exec(`UPDATE integration_checkout_observations SET ${change}`);
    } finally {
      db.close();
    }
    assert.throws(f.review, refused);
  });

for (const change of [
  "review_version='" + "0".repeat(64) + "'",
  "invoice_id='other'",
  "org_id='foreign'",
  "predecessor_id=successor_id",
])
  test(`complete renewal linkage refuses ${change}`, async (t) => {
    const f = await setup(t, "CA", "CAD", 1);
    integration(f).run(`UPDATE integration_checkout_renewals SET ${change}`);
    assert.throws(f.review);
  });

test("foreign exact native scope collision refuses without leaking copied values", async (t) => {
  const f = await setup(t),
    e = f.app.integration.effect(f.actor, f.effectId);
  integration(f).run(
    "INSERT INTO integration_effects SELECT 'foreign-id','other-org',account_id,provider,kind,'foreign-reference',payload,state,NULL,NULL,created_at,residency_version,started_at,'PRIVATE-COLLISION' FROM integration_effects WHERE id=?",
    e.id,
  );
  assert.throws(
    f.review,
    (e) =>
      (e as any).code === refused.code &&
      !(e as Error).message.includes("PRIVATE"),
  );
});

test("actual native payment demonstrates missing complete same-writer Billing history port", async (t) => {
  const f = await setup(t);
  f.app.billing.manualPayment(f.actor, "payment", {
    invoiceId: f.invoiceId,
    amount: 100,
    reference: "synthetic-bank",
    reason: "Native recorded payment",
  });
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).paid, 100);
  assert.throws(
    () =>
      f.app.database.transaction(() =>
        f.app.billing.paymentHistory.list(f.actor),
      ),
    /transaction/i,
  );
  assert.throws(f.review, {
    code: "OFFLINE_CHECKOUT_BILLING_HISTORY_REQUIRED",
  });
});

test("actual settled other checkout creates unattributed global Stripe inbox and cannot be called empty", async (t) => {
  const f = await setup(t);
  const other = fixture(t);
  const otherInvoice = ship(other, accept(other).id).invoiceId;
  // The native settlement is on the same store but another invoice, with a second order.
  const invoiceId = ship(f, accept(f, 1, "other-order").id).invoiceId;
  const e = f.app.integration.checkout(f.actor, "other-checkout", {
    invoiceId,
  });
  const result = {
    reference: "cs_test_other",
    result: {
      amount: 11300,
      currency: "cad",
      status: "complete",
      paymentStatus: "paid",
      expiresAt: 1900000000,
    },
  };
  await f.app.integration.execute(f.actor, e.id, {
    execute: async () => result,
    lookup: async () => result,
  });
  await f.app.integration.stripeSettlement(
    f.actor,
    { id: "evt_other", sessionId: result.reference, effectId: e.id },
    async () => ({
      paid: true,
      amount: 11300,
      currency: "cad",
      paymentId: "pi_other",
    }),
  );
  assert.equal(other.app.billing.totals(other.actor, otherInvoice).paid, 0);
  assert.throws(f.review, { code: "OFFLINE_CHECKOUT_INBOX_HISTORY_REQUIRED" });
});

function noMaterialization(f: F, expected = limit) {
  const all = Store.prototype.all,
    parse = JSON.parse,
    stringify = JSON.stringify;
  let rows = 0,
    retainedParse = 0,
    retainedStringify = 0;
  Store.prototype.all = function (this: Store, sql: string, ...args: any[]) {
    if (/FROM integration_/.test(sql)) rows++;
    return all.call(this, sql, ...args);
  } as typeof all;
  JSON.parse = ((s: string, ...args: any[]) => {
    if (s.includes("OVERSIZED")) retainedParse++;
    return (parse as any)(s, ...args);
  }) as typeof parse;
  JSON.stringify = ((v: unknown, ...args: any[]) => {
    if (typeof v === "string" && v.includes("OVERSIZED")) retainedStringify++;
    return (stringify as any)(v, ...args);
  }) as typeof stringify;
  try {
    assert.throws(f.review, expected);
    assert.equal(rows, 0);
    assert.equal(retainedParse, 0);
    assert.equal(retainedStringify, 0);
  } finally {
    Store.prototype.all = all;
    JSON.parse = parse;
    JSON.stringify = stringify;
  }
}
for (const [column, value] of [
  ["reference", "OVERSIZED" + "é".repeat(33000)],
  ["error", "OVERSIZED\0" + "x".repeat(65536)],
  ["created_at", "OVERSIZED" + "🙂".repeat(17000)],
  ["payload", "OVERSIZED" + "x".repeat(65536)],
] as const)
  test(`SQL byte preflight before retained materialization: ${column}`, async (t) => {
    const f = await setup(t);
    integration(f).run(
      `UPDATE integration_effects SET ${column}=? WHERE id=?`,
      value,
      f.effectId,
    );
    noMaterialization(f);
  });

test("complete set count refuses before reading any Integration text", async (t) => {
  const f = await setup(t);
  integration(f).run(
    "WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<65) INSERT INTO integration_inbox SELECT 'stripe','extra-'||i,?,? FROM n",
    "a".repeat(64),
    "2026-10-03T00:00:00.000Z",
  );
  noMaterialization(f);
});

test("complete aggregate across fixed tables is bounded before materialization", async (t) => {
  const f = await setup(t);
  const value = "OVERSIZED" + "x".repeat(60000);
  integration(f).run(
    "UPDATE integration_effects SET error=?,result=?,reference=? WHERE id=?",
    value,
    value,
    value,
    f.effectId,
  );
  integration(f).run(
    "UPDATE integration_operation_leases SET token=? WHERE effect_id=?",
    value,
    f.effectId,
  );
  integration(f).run(
    "INSERT INTO integration_inbox VALUES('other',?,?,?)",
    value,
    value,
    value,
  );
  noMaterialization(f);
});

for (const value of [
  '{"invoiceId":"x","invoiceId":"y"}',
  canonical({ x: JSON.parse("[".repeat(18) + "0" + "]".repeat(18)) }),
  canonical({ nodes: Array.from({ length: 129 }, () => 0) }),
])
  test(`bounded strict JSON refuses ${value.length} bytes`, async (t) => {
    const f = await setup(t);
    integration(f).run(
      "UPDATE integration_effects SET payload=? WHERE id=?",
      value,
      f.effectId,
    );
    assert.throws(f.review);
  });

test("total_changes guards unexpected mutation by an actual owning read and caller rollback restores rows", async (t) => {
  const f = await setup(t),
    before = snapshot(f),
    original = f.app.integration.checkouts.assertIdentity.bind(
      f.app.integration.checkouts,
    );
  f.app.integration.checkouts.assertIdentity = (a, e) => {
    integration(f).run(
      "UPDATE integration_effects SET error=error WHERE id=?",
      e.id,
    );
    return original(a, e);
  };
  assert.throws(f.review, refused);
  assert.equal(snapshot(f), before);
});

test("latest verified observation must match retained result; an older matching proof is insufficient", async (t) => {
  const f = await setup(t);
  const result = {
    reference: "cs_test_repeat",
    result: {
      amount: 11300,
      currency: "cad",
      status: "open",
      paymentStatus: "unpaid",
      expiresAt: 1900000000,
    },
  };
  const good = { execute: async () => result, lookup: async () => result };
  await f.app.integration.reconcile(f.actor, f.effectId, good);
  await f.app.integration.refreshCheckout(f.actor, f.effectId, good);
  await f.app.integration.refreshCheckout(f.actor, f.effectId, {
    ...good,
    lookup: async () => null,
  });
  assert.equal(f.review().observations.length, 3);
  const rows = integration(f).all(
    "SELECT * FROM integration_checkout_observations WHERE effect_id=? ORDER BY sequence",
    f.effectId,
  );
  const changed = canonical({
    ...JSON.parse(String(rows[1]!.snapshot)),
    status: "expired",
  });
  integration(f).run(
    "UPDATE integration_checkout_observations SET snapshot=?,hash=? WHERE id=?",
    changed,
    digest(changed),
    String(rows[1]!.id),
  );
  assert.throws(f.review, refused);
});

test("review retains its writer lock and cannot observe a separate connection's later write", async (t) => {
  const f = await setup(t),
    contender = new DatabaseSync(f.path, { timeout: 10 });
  try {
    f.app.database.transaction(() => {
      reader(f).getInTransaction(f.actor, f.effectId);
      assert.throws(() => contender.exec("BEGIN IMMEDIATE"), /locked/);
    });
  } finally {
    contender.close();
  }
});

test("fresh real finance principal is accepted independently of stale caller role fields", async (t) => {
  const f = await setup(t);
  const user = f.app.identity.createUser(f.actor, "finance-reviewer", {
    email: "reviewer@synthetic.test",
    name: "Finance reviewer",
    role: "finance",
    sites: [f.w1],
    password: "long-synthetic-password",
  });
  const finance = f.app.identity.currentActor({ ...f.actor, id: user.id });
  const r = f.app.database.transaction(() =>
    reader(f).getInTransaction({ ...finance, role: "buyer" }, f.effectId),
  );
  assert.equal(r.factsHash, f.review().factsHash);
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='support' WHERE id=?", user.id);
  assert.throws(
    () =>
      f.app.database.transaction(() =>
        reader(f).getInTransaction({ ...finance, role: "admin" }, f.effectId),
      ),
    { code: "FORBIDDEN" },
  );
});

for (const [table, column] of [
  ["integration_checkout_observations", "actor_id"],
  ["integration_checkout_observations", "snapshot"],
  ["integration_operation_leases", "token"],
  ["integration_callbacks", "binding_id"],
  ["integration_checkout_renewals", "reason"],
] as const)
  test(`SQL preflight covers complete ${table}.${column} UTF-8/NUL bytes`, async (t) => {
    const f = await setup(t, "CA", "CAD", 1);
    await f.app.integration.reconcile(f.actor, f.effectId, f.adapter);
    f.app.integration.receiveCallback(f.actor, {
      bindingId: "binding",
      eventId: "evt_pending",
      effectId: f.effectId,
      sessionId: "cs_test_pending",
      hash: digest("synthetic event"),
    });
    integration(f).run(
      `UPDATE ${table} SET ${column}=?`,
      "OVERSIZED\0" + "é".repeat(33000),
    );
    noMaterialization(f);
  });

test("row sum is bounded even when each fixed column is below 64KiB", async (t) => {
  const f = await setup(t),
    value = "OVERSIZED" + "x".repeat(65490);
  integration(f).run(
    "UPDATE integration_effects SET account_id=?,reference=?,payload=?,error=?,result=? WHERE id=?",
    value,
    value,
    value,
    value,
    value,
    f.effectId,
  );
  noMaterialization(f);
});

test("foreign allocation with copied invoice scope and detached effect cannot disappear", async (t) => {
  const f = await setup(t);
  integration(f).run(
    "INSERT INTO integration_payment_allocations VALUES('detached','foreign',?,'private-payment',100)",
    f.invoiceId,
  );
  assert.throws(
    f.review,
    (e) =>
      (e as any).code === refused.code &&
      !(e as Error).message.includes("private-payment"),
  );
});

test("a real unknown predecessor with a pending successor is an explicit unsupported profile and keeps both obligations", async (t) => {
  const f = await setup(t);
  const expired = {
    reference: "cs_test_old",
    result: {
      amount: 11300,
      currency: "cad",
      status: "expired",
      paymentStatus: "unpaid",
      expiresAt: 1900000000,
    },
  };
  await f.app.integration.reconcile(f.actor, f.effectId, {
    execute: async () => expired,
    lookup: async () => expired,
  });
  const successor = f.app.integration.renewCheckout(f.actor, "next", {
    effectId: f.effectId,
    reviewVersion: f.app.integration.checkouts.reviewVersion(
      f.app.integration.effect(f.actor, f.effectId),
    ),
    amount: 11300,
    reason: "Native expired replacement",
  });
  await f.app.integration.refreshCheckout(f.actor, f.effectId, f.adapter);
  assert.equal(f.app.integration.effect(f.actor, f.effectId).state, "unknown");
  const before = snapshot(f);
  assert.throws(f.review, { code: "OFFLINE_CHECKOUT_REVIEW_PROFILE" });
  assert.equal(
    f.app.integration.effect(f.actor, successor.id).state,
    "pending",
  );
  assert.equal(snapshot(f), before);
});

test("uncommitted actual Billing payment on the same writer is seen and refusal rolls the payment back", async (t) => {
  const f = await setup(t),
    before = f.review();
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        f.app.billing.verifiedPayment(
          f.actor,
          f.invoiceId,
          100,
          "stripe",
          "pi_uncommitted",
        );
        reader(f).getInTransaction(f.actor, f.effectId);
      }),
    { code: "OFFLINE_CHECKOUT_BILLING_HISTORY_REQUIRED" },
  );
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).paid, 0);
  assert.deepEqual(f.review(), before);
});

test("parsed node count is bounded before recursive canonicalization", async (t) => {
  const f = await setup(t),
    payload = canonical({
      tree: Array.from({ length: 64 }, () =>
        Array.from({ length: 64 }, () => 0),
      ),
    });
  assert.ok(Buffer.byteLength(payload) < 65536);
  integration(f).run(
    "UPDATE integration_effects SET payload=? WHERE id=?",
    payload,
    f.effectId,
  );
  assert.throws(f.review, limit);
});

test("unsafe retained integer is refused numerically before a variable row is fetched", async (t) => {
  const f = await setup(t);
  integration(f).run(
    "UPDATE integration_effects SET residency_version=9223372036854775807 WHERE id=?",
    f.effectId,
  );
  noMaterialization(f);
});

test("copied refund-import provenance attached to a checkout is an independent profile blocker", async (t) => {
  const f = await setup(t);
  integration(f).run(
    "INSERT INTO integration_offline_failed_refunds VALUES(?,?,?,?,?,?)",
    f.effectId,
    f.actor.orgId,
    "copied-request",
    "a".repeat(64),
    "{}",
    digest("{}"),
  );
  const before = snapshot(f);
  assert.throws(f.review, { code: "OFFLINE_CHECKOUT_REVIEW_PROFILE" });
  assert.equal(snapshot(f), before);
});

test("provenance identity bytes are preflighted without parsing retained record", async (t) => {
  const f = await setup(t);
  integration(f).run(
    "INSERT INTO integration_offline_failed_refunds VALUES(?,?,?,?,?,?)",
    f.effectId,
    f.actor.orgId,
    "OVERSIZED\0" + "é".repeat(33000),
    "a".repeat(64),
    "{}",
    digest("{}"),
  );
  noMaterialization(f);
});
