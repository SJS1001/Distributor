import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { fixture, accept, ship } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import type { Adapter, EffectResult } from "../src/server/integration.ts";

function setup(t: Parameters<typeof fixture>[0]) {
  const f = fixture(t),
    shipment = ship(f, accept(f).id);
  function choice(mode: "strict" | "provider-exceptions", version = 1) {
    return f.app.identity.residencyChoice(f.actor, "choice" + version, {
      accountId: f.buyer,
      region: "CA",
      mode,
      providers: mode === "strict" ? [] : ["stripe", "quickbooks"],
      version,
      acknowledgment: "Synthetic customer choice",
    });
  }
  choice("provider-exceptions");
  const input = {
    invoiceId: shipment.invoiceId,
    customerRef: "c-1",
    itemRefs: { [f.product]: "i-1" },
    taxCodeRef: "t-1",
    taxRateRef: "r-1",
  };
  const effect = f.app.integration.accounting(f.actor, "queue", input);
  return { ...f, invoiceId: shipment.invoiceId, effect, input, choice };
}
const result = (reference = "qbo-synthetic"): EffectResult => ({
  reference,
  result: { total: 11300, currency: "CAD" },
});
const adapter = (value: EffectResult | null = result()): Adapter => ({
  execute: async () => value!,
  lookup: async () => value,
});
function deferred() {
  let resolve!: (value: EffectResult | null) => void;
  const promise = new Promise<EffectResult | null>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function unknown(f: ReturnType<typeof setup>) {
  await f.app.integration.execute(f.actor, f.effect.id, {
    ...adapter(),
    execute: async () => {
      throw Error("synthetic secret response");
    },
  });
}
function forced(f: ReturnType<typeof setup>, value: number) {
  f.app.database
    .owned("iam")
    .run(
      "INSERT INTO iam_user_security(user_id,revision,password_change_required,updated_at) VALUES(?,1,?,?) ON CONFLICT(user_id) DO UPDATE SET password_change_required=excluded.password_change_required,updated_at=excluded.updated_at",
      f.actor.id,
      value,
      new Date().toISOString(),
    );
}

test("recovered accounting sender cannot complete or release a successor's exclusive read claim", async (t) => {
  const f = setup(t),
    send = deferred(),
    read = deferred();
  let sends = 0;
  const sending = f.app.integration.execute(f.actor, f.effect.id, {
    ...adapter(),
    execute: async () => {
      sends++;
      return (await send.promise)!;
    },
  });
  await assert.rejects(
    f.app.integration.execute(f.actor, f.effect.id, adapter()),
    { code: "STATE" },
  );
  assert.equal(f.app.integration.recoverStale(-1, f.actor.orgId), 1);
  assert.equal(f.app.integration.recoverStale(-1, f.actor.orgId), 0);
  const reading = f.app.integration.reconcile(f.actor, f.effect.id, {
    ...adapter(),
    lookup: async () => read.promise,
  });
  send.resolve(result("abandoned-send"));
  await assert.rejects(sending, { code: "STATE" });
  await assert.rejects(
    f.app.integration.reconcile(f.actor, f.effect.id, adapter()),
    { code: "STATE" },
  );
  read.resolve(result("qualified-read"));
  assert.equal((await reading).state, "completed");
  assert.equal(
    f.app.integration.effect(f.actor, f.effect.id).external_ref,
    "qualified-read",
  );
  assert.equal(sends, 1);
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).paid, 0);
});

test("read claims persist across connections, recover only in their organization, and fence stale absence", async (t) => {
  const f = setup(t);
  await unknown(f);
  const read = deferred(),
    reading = f.app.integration.reconcile(f.actor, f.effect.id, {
      ...adapter(),
      lookup: async () => read.promise,
    });
  const other = new Application(f.path);
  try {
    await assert.rejects(
      other.integration.reconcile(f.actor, f.effect.id, adapter()),
      { code: "STATE" },
    );
    assert.equal(
      other.integration.recoverStale(-1, "different-organization"),
      0,
    );
    assert.equal(other.integration.recoverStale(-1, f.actor.orgId), 1);
    await other.integration.reconcile(f.actor, f.effect.id, adapter());
    read.resolve(null);
    await assert.rejects(reading, { code: "STATE" });
    assert.equal(
      f.app.integration.effect(f.actor, f.effect.id).state,
      "completed",
    );
  } finally {
    other.close();
  }
});

test("accounting and checkout cached intents require current grants, credential change, consent and restore clearance", (t) => {
  const f = setup(t),
    checkout = { invoiceId: f.invoiceId };
  f.app.integration.checkout(f.actor, "checkout", checkout);
  const iam = f.app.database.owned("iam");
  iam.run("UPDATE iam_users SET role='commercial' WHERE id=?", f.actor.id);
  assert.throws(() => f.app.integration.accounting(f.actor, "queue", f.input), {
    code: "FORBIDDEN",
  });
  assert.throws(
    () => f.app.integration.checkout(f.actor, "checkout", checkout),
    { code: "FORBIDDEN" },
  );
  iam.run("UPDATE iam_users SET role='admin',active=0 WHERE id=?", f.actor.id);
  assert.throws(() => f.app.integration.accounting(f.actor, "queue", f.input), {
    code: "FORBIDDEN",
  });
  iam.run("UPDATE iam_users SET active=1 WHERE id=?", f.actor.id);
  forced(f, 1);
  assert.throws(() => f.app.integration.accounting(f.actor, "queue", f.input), {
    code: "PASSWORD_CHANGE_REQUIRED",
  });
  assert.throws(
    () => f.app.integration.checkout(f.actor, "checkout", checkout),
    { code: "PASSWORD_CHANGE_REQUIRED" },
  );
  forced(f, 0);
  f.choice("strict", 2);
  assert.throws(() => f.app.integration.accounting(f.actor, "queue", f.input), {
    code: "RESIDENCY_BLOCKED",
  });
  assert.throws(
    () => f.app.integration.checkout(f.actor, "checkout", checkout),
    { code: "RESIDENCY_BLOCKED" },
  );
  f.choice("provider-exceptions", 3);
  f.app.platform.isolateRestore("synthetic", new Date().toISOString());
  assert.throws(() => f.app.integration.accounting(f.actor, "queue", f.input), {
    code: "RECOVERY_HOLD",
  });
  assert.throws(
    () => f.app.integration.checkout(f.actor, "checkout", checkout),
    { code: "RECOVERY_HOLD" },
  );
  assert.equal(f.app.integration.list(f.actor).length, 2);
});

test("provider completion rechecks active role/security and leaves unknown for qualified reconciliation", async (t) => {
  for (const change of ["active=0", "role='commercial'", "password-change"]) {
    const f = setup(t),
      iam = f.app.database.owned("iam");
    const a: Adapter = {
      ...adapter(),
      execute: async () => {
        if (change === "password-change") forced(f, 1);
        else iam.run(`UPDATE iam_users SET ${change} WHERE id=?`, f.actor.id);
        return result();
      },
    };
    await assert.rejects(f.app.integration.execute(f.actor, f.effect.id, a), {
      code:
        change === "password-change" ? "PASSWORD_CHANGE_REQUIRED" : "FORBIDDEN",
    });
    assert.equal(
      f.app.integration.effect(f.actor, f.effect.id).state,
      "unknown",
    );
    assert.equal(
      f.app.integration.effect(f.actor, f.effect.id).external_ref,
      null,
    );
    iam.run(
      "UPDATE iam_users SET active=1,role='admin' WHERE id=?",
      f.actor.id,
    );
    forced(f, 0);
    await f.app.integration.reconcile(f.actor, f.effect.id, adapter());
    assert.equal(
      f.app.integration.effect(f.actor, f.effect.id).state,
      "completed",
    );
  }
});

test("fresh support grants remain eligible and deactivated principals never call adapters", async (t) => {
  const f = setup(t),
    iam = f.app.database.owned("iam");
  let calls = 0;
  const a: Adapter = {
    execute: async () => {
      calls++;
      return result();
    },
    lookup: async () => {
      calls++;
      return result();
    },
  };
  iam.run("UPDATE iam_users SET active=0 WHERE id=?", f.actor.id);
  await assert.rejects(f.app.integration.execute(f.actor, f.effect.id, a), {
    code: "FORBIDDEN",
  });
  assert.equal(calls, 0);
  iam.run(
    "UPDATE iam_users SET active=1,role='support' WHERE id=?",
    f.actor.id,
  );
  await f.app.integration.execute(f.actor, f.effect.id, a);
  assert.equal(calls, 1);
});

test("consent withdrawal during authorized I/O retains observed result but blocks subsequent reads", async (t) => {
  const f = setup(t);
  await unknown(f);
  await f.app.integration.reconcile(f.actor, f.effect.id, {
    ...adapter(),
    lookup: async () => {
      f.choice("strict", 2);
      return null;
    },
  });
  let calls = 0;
  await assert.rejects(
    f.app.integration.reconcile(f.actor, f.effect.id, {
      ...adapter(),
      lookup: async () => {
        calls++;
        return result();
      },
    }),
    { code: "RESIDENCY_BLOCKED" },
  );
  assert.equal(calls, 0);
  f.choice("provider-exceptions", 3);
  await f.app.integration.reconcile(f.actor, f.effect.id, {
    ...adapter(),
    lookup: async () => {
      f.choice("strict", 4);
      return result();
    },
  });
  assert.equal(
    f.app.integration.effect(f.actor, f.effect.id).state,
    "completed",
  );
});

test("restore hold acquired during I/O rejects binding and provider settlement without native cash", async (t) => {
  const f = setup(t);
  await assert.rejects(
    f.app.integration.execute(f.actor, f.effect.id, {
      ...adapter(),
      execute: async () => {
        f.app.platform.isolateRestore("synthetic", new Date().toISOString());
        return result();
      },
    }),
    { code: "RECOVERY_HOLD" },
  );
  assert.equal(f.app.integration.effect(f.actor, f.effect.id).state, "unknown");
  assert.equal(
    f.app.integration.effect(f.actor, f.effect.id).external_ref,
    null,
  );
  const g = setup(t),
    checkout = g.app.integration.checkout(g.actor, "checkout", {
      invoiceId: g.invoiceId,
    });
  await g.app.integration.execute(
    g.actor,
    checkout.id,
    adapter(result("cs_synthetic")),
  );
  await assert.rejects(
    g.app.integration.stripeSettlement(
      g.actor,
      { id: "evt", sessionId: "cs_synthetic" },
      async () => {
        g.app.platform.isolateRestore("synthetic", new Date().toISOString());
        return {
          paid: true,
          amount: 11300,
          currency: "cad",
          paymentId: "pi_synthetic",
        };
      },
    ),
    { code: "RECOVERY_HOLD" },
  );
  assert.equal(g.app.billing.totals(g.actor, g.invoiceId).paid, 0);
});

test("settlement rereads grants after verification and rejects cached actors before another provider read", async (t) => {
  const f = setup(t),
    checkout = f.app.integration.checkout(f.actor, "checkout", {
      invoiceId: f.invoiceId,
    });
  await f.app.integration.execute(
    f.actor,
    checkout.id,
    adapter(result("cs_synthetic")),
  );
  let calls = 0;
  const verify = async () => {
    calls++;
    f.app.database
      .owned("iam")
      .run("UPDATE iam_users SET role='support' WHERE id=?", f.actor.id);
    return {
      paid: true,
      amount: 11300,
      currency: "cad",
      paymentId: "pi_synthetic",
    };
  };
  const event = { id: "evt", sessionId: "cs_synthetic" };
  await assert.rejects(
    f.app.integration.stripeSettlement(f.actor, event, verify),
    { code: "FORBIDDEN" },
  );
  await assert.rejects(
    f.app.integration.stripeSettlement(f.actor, event, verify),
    { code: "FORBIDDEN" },
  );
  assert.equal(calls, 1);
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).paid, 0);
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='admin' WHERE id=?", f.actor.id);
  await f.app.integration.stripeSettlement(f.actor, event, async () => ({
    paid: true,
    amount: 11300,
    currency: "cad",
    paymentId: "pi_synthetic",
  }));
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).paid, 11300);
});

test("late completion event failure rolls back binding then releases the owned claim", async (t) => {
  const f = setup(t),
    event = f.app.platform.event.bind(f.app.platform);
  t.mock.method(
    f.app.platform,
    "event",
    (...args: Parameters<typeof event>) => {
      if (args[1] === "integration.completed")
        throw Error("synthetic late write failure");
      return event(...args);
    },
  );
  await assert.rejects(
    f.app.integration.execute(f.actor, f.effect.id, adapter()),
    /synthetic late write/,
  );
  const e = f.app.integration.effect(f.actor, f.effect.id);
  assert.equal(e.state, "unknown");
  assert.equal(e.external_ref, null);
  assert.equal(e.result, null);
  f.app.platform.event = event;
  await f.app.integration.reconcile(f.actor, f.effect.id, adapter());
  assert.equal(
    f.app.integration.effect(f.actor, f.effect.id).state,
    "completed",
  );
});

test("lookup failure/absence releases claim and never authorizes another send; legacy running intents recover", async (t) => {
  const f = setup(t);
  await unknown(f);
  await assert.rejects(
    f.app.integration.reconcile(f.actor, f.effect.id, {
      ...adapter(),
      lookup: async () => {
        throw Error("secret synthetic body");
      },
    }),
  );
  assert.ok(
    !f.app.integration.effect(f.actor, f.effect.id).error!.includes("secret"),
  );
  assert.equal(
    (await f.app.integration.reconcile(f.actor, f.effect.id, adapter(null)))
      .state,
    "unknown",
  );
  await assert.rejects(
    f.app.integration.execute(f.actor, f.effect.id, adapter()),
    { code: "STATE" },
  );
  const store = f.app.database.owned("integration");
  store.run(
    "DELETE FROM integration_operation_leases WHERE effect_id=?",
    f.effect.id,
  );
  store.run(
    "UPDATE integration_effects SET state='running',started_at=0 WHERE id=?",
    f.effect.id,
  );
  assert.equal(f.app.integration.recoverStale(), 1);
  await f.app.integration.reconcile(f.actor, f.effect.id, adapter());
});

test("grant checks happen after transaction acquisition for cached commands, claims and completion", async (t) => {
  const f = setup(t),
    iam = f.app.database.owned("iam"),
    transaction = f.app.database.transaction.bind(f.app.database);
  let revoke = false;
  t.mock.method(f.app.database, "transaction", (fn: () => unknown) => {
    if (revoke) {
      revoke = false;
      iam.run("UPDATE iam_users SET active=0 WHERE id=?", f.actor.id);
    }
    return transaction(fn);
  });
  revoke = true;
  assert.throws(() => f.app.integration.accounting(f.actor, "queue", f.input), {
    code: "FORBIDDEN",
  });
  iam.run("UPDATE iam_users SET active=1 WHERE id=?", f.actor.id);
  revoke = true;
  assert.throws(
    () =>
      f.app.integration.checkout(f.actor, "checkout", {
        invoiceId: f.invoiceId,
      }),
    { code: "FORBIDDEN" },
  );
  iam.run("UPDATE iam_users SET active=1 WHERE id=?", f.actor.id);
  revoke = true;
  await assert.rejects(
    f.app.integration.execute(f.actor, f.effect.id, adapter()),
    {
      code: "FORBIDDEN",
    },
  );
  assert.equal(f.app.integration.effect(f.actor, f.effect.id).state, "pending");
  iam.run("UPDATE iam_users SET active=1 WHERE id=?", f.actor.id);
  await assert.rejects(
    f.app.integration.execute(f.actor, f.effect.id, {
      ...adapter(),
      execute: async () => {
        revoke = true;
        return result();
      },
    }),
    { code: "FORBIDDEN" },
  );
  assert.equal(f.app.integration.effect(f.actor, f.effect.id).state, "unknown");
  assert.equal(
    f.app.integration.effect(f.actor, f.effect.id).external_ref,
    null,
  );
});

test(
  "separate accounting workers contend for one durable reconciliation claim and one completion",
  { timeout: 10000 },
  async (t) => {
    const f = setup(t);
    await unknown(f);
    const children = [0, 1].map(() =>
      fork(new URL("./integration-operation-child.ts", import.meta.url), [], {
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      }),
    );
    t.after(() => {
      for (const child of children) child.kill();
    });
    const ready = children.map(
      (child) =>
        new Promise<void>((resolve, reject) => {
          child.once("error", reject);
          child.once("message", () => resolve());
        }),
    );
    for (const child of children)
      child.send({
        action: "init",
        path: f.path,
        actor: f.actor,
        effectId: f.effect.id,
      });
    await Promise.all(ready);
    const receipts = children.map(
      (child) =>
        new Promise<{ ok: boolean; code?: string }>((resolve, reject) => {
          child.once("error", reject);
          child.once("message", resolve);
        }),
    );
    for (const child of children) child.send({ action: "go" });
    const results = await Promise.all(receipts);
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(results.filter((r) => !r.ok && r.code === "STATE").length, 1);
    assert.equal(
      f.app.integration.effect(f.actor, f.effect.id).state,
      "completed",
    );
    assert.equal(
      f.app.database
        .owned("platform")
        .all(
          "SELECT * FROM platform_events WHERE reference=? AND type='integration.completed'",
          f.effect.id,
        ).length,
      1,
    );
  },
);
