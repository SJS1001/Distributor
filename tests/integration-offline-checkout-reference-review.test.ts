import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { fixture, accept, ship, chooseProviders } from "./fixtures.ts";
import { canonical, digest } from "../src/server/core.ts";
import { Application } from "../src/server/application.ts";
import { Database } from "../src/server/database.ts";
import { Identity } from "../src/server/iam.ts";
import { Billing } from "../src/server/billing.ts";
import { IntegrationCheckouts } from "../src/server/integration-checkouts.ts";
import { IntegrationOfflineCheckoutReview } from "../src/server/integration-offline-checkout-review.ts";
import {
  compareOfflineCheckoutPaidEvidence as compare,
  type OfflineCheckoutEvidenceInput,
} from "../src/server/integration-offline-checkout-evidence.ts";
import {
  IntegrationOfflineCheckoutReferenceReview as Join,
  isCapturedOfflineCheckoutSessionReferenceReview as captured,
} from "../src/server/integration-offline-checkout-reference-review.ts";
async function setup(
  t: TestContext,
  region: "CA" | "US" = "CA",
  currency: "CAD" | "USD" = "CAD",
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
  const effect = f.app.integration.checkout(f.actor, "checkout", { invoiceId });
  let calls = 0;
  assert.equal(
    (
      await f.app.integration.execute(f.actor, effect.id, {
        execute: async () => {
          calls++;
          throw Error("Synthetic lost reply; no provider IO");
        },
        lookup: async () => {
          calls++;
          return null;
        },
      })
    ).state,
    "unknown",
  );
  const user = f.app.identity.createUser(f.actor, "finance", {
    name: "Review finance",
    email: "checkout-review@example.test",
    password: "synthetic-long-password",
    role: "finance",
    sites: [],
  });
  const actor = { id: user.id, orgId: f.actor.orgId };
  const hold = () => {
    for (const suffix of ["", "-wal", "-shm"])
      if (fs.existsSync(f.path + suffix)) fs.chmodSync(f.path + suffix, 0o600);
    f.app.database.transaction(() =>
      f.app.platform.isolateRestore(
        digest("synthetic-checkout-snapshot"),
        "2026-10-01T00:00:00.000Z",
      ),
    );
  };
  const input = () =>
    f.app.database.transaction(() => {
      const candidate = new IntegrationOfflineCheckoutReview(
        f.app.database,
        f.app.identity,
        f.app.billing,
        f.app.integration.checkouts,
      ).getInTransaction(
        f.app.identity.workerActor(actor.orgId, actor.id),
        effect.id,
      );
      const candidateStore =
          f.app.database.captureRestoreCandidateInTransaction(),
        amount = candidate.invoice.total,
        currency = candidate.invoice.currency.toLowerCase() as "cad" | "usd",
        metadata = { effect_id: effect.id };
      return {
        version: 1,
        profile: "stripe-first-unknown-checkout-paid-v1",
        source: structuredClone(candidate),
        candidate,
        candidateStore,
        binding: {
          provider: "stripe",
          mode: "test",
          scope: "direct-account",
          orgId: f.actor.orgId,
          accountId: f.buyer,
          runtimeBindingId: "synthetic-runtime-binding",
          stripeAccountId: "acct_synthetic",
        },
        provider: {
          stripeAccountId: "acct_synthetic",
          session: {
            object: "checkout.session",
            id: "cs_test_synthetic",
            mode: "payment",
            livemode: false,
            status: "complete",
            payment_status: "paid",
            amount_total: amount,
            currency,
            expires_at: 1893456000,
            url: null,
            metadata,
            payment_intent: {
              object: "payment_intent",
              id: "pi_synthetic",
              status: "succeeded",
              livemode: false,
              amount,
              amount_received: amount,
              currency,
              metadata,
              on_behalf_of: null,
              transfer_data: null,
              application_fee_amount: null,
            },
          },
        },
      } satisfies OfflineCheckoutEvidenceInput;
    });
  const join = () =>
    new Join(
      f.app.database,
      f.app.identity,
      f.app.billing,
      f.app.integration.checkouts,
    );
  return Object.assign(f, {
    invoiceId,
    effectId: effect.id,
    reviewer: actor,
    hold,
    input,
    join,
    calls: () => calls,
  });
}
type F = Awaited<ReturnType<typeof setup>>;

function run(f: F, c: unknown, j = f.join()) {
  return f.app.database.transaction(() => j.getInTransaction(f.reviewer, c));
}
function frozen(v: unknown) {
  if (v !== null && typeof v === "object") {
    assert.ok(Object.isFrozen(v));
    Object.values(v).forEach(frozen);
  }
}
for (const [region, currency] of [
  ["CA", "CAD"],
  ["CA", "USD"],
  ["US", "USD"],
] as const)
  test(`actual ${region}/${currency} complete reference absence under held writer is frozen consistency only`, async (t) => {
    const f = await setup(t, region, currency);
    f.hold();
    const c = compare(f.input()),
      j = f.join(),
      store = f.app.database.owned("billing"),
      before = store.get("SELECT total_changes() AS n")!.n,
      r = run(f, c, j);
    assert.equal(store.get("SELECT total_changes() AS n")!.n, before);
    assert.equal(f.calls(), 1);
    assert.ok(captured(r));
    frozen(r);
    assert.deepEqual(run(f, c, j), r);
    assert.equal(r.disposition, "no-retained-reference-match");
    assert.equal(r.comparisonHash, c.hash);
    assert.equal(r.candidateHash, c.candidateHash);
    const { hash, ...body } = r;
    assert.equal(hash, digest(canonical(body)));
    assert.equal(captured(structuredClone(r)), false);
    assert.equal("rows" in r, false);
    assert.equal("allowed" in r, false);
    assert.ok(
      r.requiredChecks.includes(
        "qualified-stripe-account-runtime-binding-and-provider-truth",
      ),
    );
    assert.throws(() => f.app.platform.assertProviderAccess(), {
      code: "RECOVERY_HOLD",
    });
  });
test("caller hooks, grants and copied comparisons never substitute actual current proof", async (t) => {
  const f = await setup(t);
  f.hold();
  const c = compare(f.input()),
    j = f.join();
  let calls = 0;
  const hook = () => {
    calls++;
    throw Error("PRIVATE hook");
  };
  const proxy = new Proxy(
      {},
      {
        get: hook,
        ownKeys: hook,
        getOwnPropertyDescriptor: hook,
        getPrototypeOf: hook,
      },
    ),
    r = Proxy.revocable({}, {});
  r.revoke();
  assert.throws(() => j.getInTransaction(f.reviewer, c), {
    code: "TRANSACTION",
  });
  for (const bad of [proxy, r.proxy, { ...c }, structuredClone(c), null]) {
    assert.throws(() => run(f, bad, j));
    assert.equal(captured(bad), false);
  }
  for (const actor of [
    proxy,
    r.proxy,
    { ...f.reviewer, role: "admin" },
    {
      get id() {
        return hook();
      },
      orgId: f.actor.orgId,
    },
    { id: { toString: hook }, orgId: f.actor.orgId },
    { id: "x".repeat(129), orgId: f.actor.orgId },
    { id: "\0", orgId: f.actor.orgId },
  ])
    assert.throws(() =>
      f.app.database.transaction(() => j.getInTransaction(actor, c)),
    );
  assert.equal(calls, 0);
});
for (const [name, sql, code] of [
  ["inactive", "UPDATE iam_users SET active=0 WHERE id=?", "FORBIDDEN"],
  ["role", "UPDATE iam_users SET role='warehouse' WHERE id=?", "FORBIDDEN"],
  [
    "password",
    "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
    "PASSWORD_CHANGE_REQUIRED",
  ],
  ["tenant", "UPDATE iam_users SET org_id='foreign' WHERE id=?", "FORBIDDEN"],
] as const)
  test(`fresh ${name} authority refuses uncommitted changes then rollback recovers`, async (t) => {
    const f = await setup(t);
    f.hold();
    const c = compare(f.input()),
      j = f.join();
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          f.app.database.owned("iam").run(sql, f.reviewer.id);
          assert.throws(() => j.getInTransaction(f.reviewer, c), { code });
          throw Error("rollback-authority");
        }),
      /rollback-authority/,
    );
    assert.ok(captured(run(f, c, j)));
  });
test("hold/current candidate and Stripe choice remain mandatory; read-only reopen preserves result", async (t) => {
  const f = await setup(t);
  f.hold();
  const c = compare(f.input()),
    first = run(f, c);
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        f.app.database.owned("platform").run("DELETE FROM platform_recovery");
        assert.throws(() => f.join().getInTransaction(f.reviewer, c), {
          code: "OFFLINE_CHECKOUT_REFERENCE_RAW_HOLD",
        });
        throw Error("rollback-hold");
      }),
    /rollback-hold/,
  );
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        f.app.database
          .owned("iam")
          .run(
            "UPDATE iam_accounts SET provider_exceptions='[]' WHERE id=?",
            f.buyer,
          );
        assert.throws(() => f.join().getInTransaction(f.reviewer, c), {
          code: "RESIDENCY_BLOCKED",
        });
        throw Error("rollback-choice");
      }),
    /rollback-choice/,
  );
  const bad = f.input();
  bad.candidateStore.logicalHash = "0".repeat(64);
  assert.throws(() => run(f, compare(bad)));
  f.app.close();
  f.app = new Application(f.path, "CA");
  assert.deepEqual(run(f, c), first);
});
test("actual owner graph rejects cross-store/prototype/substituted hooks", async (t) => {
  const f = await setup(t),
    other = fixture(t);
  let calls = 0;
  const hook = () => {
    calls++;
    throw Error("PRIVATE hook");
  };
  const args = [
    f.app.database,
    f.app.identity,
    f.app.billing,
    f.app.integration.checkouts,
  ] as const;
  for (let i = 0; i < 4; i++) {
    const a: [Database, Identity, Billing, IntegrationCheckouts] = [...args];
    (a as unknown[])[i] = Object.create(Object.getPrototypeOf(args[i]));
    assert.throws(() => new Join(...a));
    (a as unknown[])[i] = new Proxy(args[i]!, { getPrototypeOf: hook });
    assert.throws(() => new Join(...a));
  }
  assert.throws(
    () =>
      new Join(
        other.app.database,
        ...(args.slice(1) as [Identity, Billing, IntegrationCheckouts]),
      ),
  );
  f.hold();
  const c = compare(f.input()),
    j = f.join();
  for (const [o, key] of [
    [f.app.identity, "workerActor"],
    [f.app.billing, "invoice"],
    [f.app.integration.checkouts, "current"],
  ] as const) {
    Object.defineProperty(o, key, { get: hook, configurable: true });
    try {
      assert.throws(() => run(f, c, j));
    } finally {
      Reflect.deleteProperty(o, key);
    }
  }
  assert.equal(calls, 0);
});
test("caught reentry and attempted logically identical writes poison the current review", async (t) => {
  const f = await setup(t);
  f.hold();
  const c = compare(f.input()),
    j = f.join(),
    original = fs.lstatSync;
  for (const mode of ["reentry", "write"]) {
    let calls = 0;
    try {
      (fs as { lstatSync: typeof fs.lstatSync }).lstatSync = ((
        ...args: Parameters<typeof fs.lstatSync>
      ) => {
        if (calls++ === 0) {
          if (mode === "reentry")
            assert.throws(() => j.getInTransaction(f.reviewer, c));
          else
            f.app.database
              .owned("integration")
              .run(
                "UPDATE integration_effects SET error=error WHERE id=?",
                f.effectId,
              );
        }
        return original(...args);
      }) as typeof fs.lstatSync;
      syncBuiltinESMExports();
      assert.throws(() => run(f, c, j));
      assert.ok(calls > 0);
    } finally {
      (fs as { lstatSync: typeof fs.lstatSync }).lstatSync = original;
      syncBuiltinESMExports();
    }
    assert.ok(captured(run(f, c, j)));
  }
});

test("actual other-customer session collision previously outside selected history now refuses", async (t) => {
  const f = await setup(t),
    buyer = f.app.identity.createCustomer(f.actor, "other-buyer", {
      name: "Synthetic other",
      tier: "standard",
      creditLimit: 1000000,
    }).id,
    other = { ...f, buyer };
  f.app.catalog.setPurchasingPolicy(f.actor, "synthetic-extra-account-access", {
    accountId: buyer,
    mode: "all",
    requiresReview: false,
    productIds: [],
    revision: 0,
    reason: "Explicit synthetic account access for this test.",
  });
  const invoiceId = ship(other, accept(other, 1, "other-order").id).invoiceId;
  chooseProviders(other, f.actor, "other-choice", {
    accountId: buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["stripe"],
    version: 1,
    acknowledgment: "Synthetic consent",
  });
  const e = f.app.integration.checkout(f.actor, "other-checkout", {
    invoiceId,
  });
  const result = {
    reference: "cs_test_synthetic",
    result: {
      amount: 11300,
      currency: "cad",
      status: "complete",
      paymentStatus: "paid",
      expiresAt: 1893456000,
    },
  };
  await f.app.integration.execute(f.actor, e.id, {
    execute: async () => result,
    lookup: async () => result,
  });
  f.hold();
  const input = f.input();
  assert.equal(input.candidate.observations.length, 0);
  assert.throws(() => run(f, compare(input)), {
    code: "OFFLINE_CHECKOUT_SESSION_REFERENCE_COLLISION",
  });
});
test("complete real sibling renewal chain and reconcile observations are covered without truncation", async (t) => {
  const f = await setup(t),
    buyer = f.app.identity.createCustomer(f.actor, "other-buyer", {
      name: "Synthetic other",
      tier: "standard",
      creditLimit: 1000000,
    }).id,
    other = { ...f, buyer };
  f.app.catalog.setPurchasingPolicy(f.actor, "synthetic-extra-account-access", {
    accountId: buyer,
    mode: "all",
    requiresReview: false,
    productIds: [],
    revision: 0,
    reason: "Explicit synthetic account access for this test.",
  });
  const invoiceId = ship(other, accept(other, 1, "other-order").id).invoiceId;
  chooseProviders(other, f.actor, "other-choice", {
    accountId: buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["stripe"],
    version: 1,
    acknowledgment: "Synthetic consent",
  });
  let e = f.app.integration.checkout(f.actor, "other-checkout", { invoiceId });
  e = f.app.integration.renewCheckout(f.actor, "renew-other", {
    effectId: e.id,
    reviewVersion: f.app.integration.checkouts.reviewVersion(
      f.app.integration.effect(f.actor, e.id),
    ),
    amount: 11300,
    reason: "Synthetic replacement",
  });
  const adapter = {
    execute: async () => {
      throw Error("synthetic lost reply");
    },
    lookup: async () => null,
  };
  await f.app.integration.execute(f.actor, e.id, adapter);
  await f.app.integration.reconcile(f.actor, e.id, adapter);
  f.hold();
  const r = run(f, compare(f.input()));
  assert.ok(captured(r));
  assert.equal("observations" in r, false);
});
test("actual retained callback collision and otherwise unqualified callback history both refuse", async (t) => {
  const f = await setup(t);
  f.hold();
  const c = compare(f.input()),
    j = f.join();
  for (const sessionId of ["cs_test_synthetic", "cs_test_unrelated"]) {
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          f.app.database
            .owned("integration")
            .run(
              "INSERT INTO integration_callbacks(id,org_id,binding_id,event_id,session_id,effect_id,hash,state,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
              "callback",
              f.actor.orgId,
              "synthetic-binding",
              "evt_synthetic",
              sessionId,
              f.effectId,
              digest("synthetic-event"),
              "pending",
              "2026-10-01T00:00:00.000Z",
            );
          assert.throws(() => j.getInTransaction(f.reviewer, c), {
            code:
              sessionId === "cs_test_synthetic"
                ? "OFFLINE_CHECKOUT_SESSION_REFERENCE_COLLISION"
                : "OFFLINE_CHECKOUT_SESSION_CALLBACK_HISTORY_REQUIRED",
          });
          throw Error("rollback-callback");
        }),
      /rollback-callback/,
    );
  }
  assert.ok(captured(run(f, c, j)));
});
for (const [name, raw, code] of [
  [
    "duplicate JSON",
    '{"invoiceId":"x","invoiceId":"y"}',
    "OFFLINE_CHECKOUT_SESSION_REFERENCE_REVIEW",
  ],
  [
    "deep JSON",
    '{"x":'.repeat(18) + "0" + "}".repeat(18),
    "OFFLINE_CHECKOUT_SESSION_REFERENCE_LIMIT",
  ],
  [
    "escaped session",
    '{"x":"cs_test_\\u0073ynthetic"}',
    "OFFLINE_CHECKOUT_SESSION_REFERENCE_COLLISION",
  ],
  [
    "unpaired surrogate",
    '{"x":"\\ud800"}',
    "OFFLINE_CHECKOUT_SESSION_REFERENCE_REVIEW",
  ],
  [
    "NUL escape",
    '{"x":"\\u0000"}',
    "OFFLINE_CHECKOUT_SESSION_REFERENCE_REVIEW",
  ],
  [
    "unsafe integer",
    '{"x":9007199254740992}',
    "OFFLINE_CHECKOUT_SESSION_REFERENCE_REVIEW",
  ],
  [
    "field byte limit",
    "€".repeat(22000),
    "OFFLINE_CHECKOUT_SESSION_REFERENCE_LIMIT",
  ],
] as const)
  test(`complete canonical JSON refuses ${name} before normal owning parse`, async (t) => {
    const f = await setup(t);
    f.hold();
    const c = compare(f.input()),
      j = f.join();
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          f.app.database
            .owned("integration")
            .run(
              "UPDATE integration_effects SET payload=? WHERE id=?",
              raw,
              f.effectId,
            );
          assert.throws(() => j.getInTransaction(f.reviewer, c), { code });
          throw Error("rollback-json");
        }),
      /rollback-json/,
    );
    assert.ok(captured(run(f, c, j)));
  });
test("global orphan, foreign copied identity and invalid UTF8 refuse without row disclosure", async (t) => {
  const f = await setup(t);
  f.hold();
  const c = compare(f.input()),
    j = f.join(),
    s = f.app.database.owned("integration");
  for (const [sql, code] of [
    [
      "UPDATE integration_effects SET org_id='foreign'",
      "OFFLINE_CHECKOUT_SESSION_REFERENCE_SCOPE_REQUIRED",
    ],
    [
      "UPDATE integration_effects SET error=CAST(X'80' AS TEXT)",
      "OFFLINE_CHECKOUT_SESSION_REFERENCE_REVIEW",
    ],
    [
      "UPDATE integration_operation_leases SET effect_id='missing'",
      "OFFLINE_CHECKOUT_SESSION_REFERENCE_REVIEW",
    ],
  ]) {
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          s.run(sql!);
          assert.throws(() => j.getInTransaction(f.reviewer, c), { code });
          throw Error("rollback-global");
        }),
      /rollback-global/,
    );
  }
  assert.ok(captured(run(f, c, j)));
});

test("raw hold is required before reading malformed retained global history", async (t) => {
  const f = await setup(t);
  f.hold();
  const c = compare(f.input()),
    j = f.join();
  f.app.database.owned("platform").run("DELETE FROM platform_recovery");
  f.app.database
    .owned("integration")
    .run(
      "UPDATE integration_effects SET error=? WHERE id=?",
      "x".repeat(65537),
      f.effectId,
    );
  assert.throws(() => run(f, c, j), {
    code: "OFFLINE_CHECKOUT_REFERENCE_RAW_HOLD",
  });
});

for (const sessionId of ["cs_test_synthetic", "cs_test_unrelated"])
  test(`actual callback owner retains ${sessionId} and reference review refuses precisely`, async (t) => {
    const f = await setup(t);
    f.hold();
    const c = compare(f.input());
    f.app.integration.receiveCallback(f.actor, {
      bindingId: "synthetic-binding",
      eventId: "evt_synthetic",
      sessionId,
      effectId: f.effectId,
      hash: digest("synthetic-event"),
    });
    assert.throws(() => run(f, c), {
      code:
        sessionId === "cs_test_synthetic"
          ? "OFFLINE_CHECKOUT_SESSION_REFERENCE_COLLISION"
          : "OFFLINE_CHECKOUT_SESSION_CALLBACK_HISTORY_REQUIRED",
    });
  });
test("unrelated terminal-current native session is explicitly unsupported rather than silently omitted", async (t) => {
  const f = await setup(t),
    buyer = f.app.identity.createCustomer(f.actor, "terminal-buyer", {
      name: "Synthetic other",
      tier: "standard",
      creditLimit: 1000000,
    }).id,
    other = { ...f, buyer };
  f.app.catalog.setPurchasingPolicy(f.actor, "synthetic-extra-account-access", {
    accountId: buyer,
    mode: "all",
    requiresReview: false,
    productIds: [],
    revision: 0,
    reason: "Explicit synthetic account access for this test.",
  });
  const invoiceId = ship(
    other,
    accept(other, 1, "terminal-order").id,
  ).invoiceId;
  chooseProviders(other, f.actor, "terminal-choice", {
    accountId: buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["stripe"],
    version: 1,
    acknowledgment: "Synthetic consent",
  });
  const e = f.app.integration.checkout(f.actor, "terminal", { invoiceId }),
    result = {
      reference: "cs_test_distinct",
      result: {
        amount: 11300,
        currency: "cad",
        status: "expired",
        paymentStatus: "unpaid",
        expiresAt: 1893456000,
      },
    };
  await f.app.integration.execute(f.actor, e.id, {
    execute: async () => result,
    lookup: async () => result,
  });
  f.hold();
  assert.throws(() => run(f, compare(f.input())), {
    code: "OFFLINE_CHECKOUT_SESSION_CURRENT_HISTORY_REQUIRED",
  });
});
test("complete global set count and aggregate UTF8 bounds run before recursive candidate work", async (t) => {
  const f = await setup(t);
  f.hold();
  const c = compare(f.input()),
    j = f.join(),
    s = f.app.database.owned("integration"),
    original = fs.lstatSync;
  let pins = 0;
  try {
    (fs as { lstatSync: typeof fs.lstatSync }).lstatSync = ((
      ...args: Parameters<typeof fs.lstatSync>
    ) => {
      pins++;
      return original(...args);
    }) as typeof fs.lstatSync;
    syncBuiltinESMExports();
    for (const mode of ["count", "aggregate"]) {
      assert.throws(
        () =>
          f.app.database.transaction(() => {
            for (let i = 0; i < (mode === "count" ? 64 : 8); i++)
              s.run(
                "INSERT INTO integration_effects(id,org_id,account_id,provider,kind,reference,payload,state,external_ref,result,created_at,residency_version,started_at,error) SELECT ?,org_id,account_id,provider,kind,?,payload,state,external_ref,result,created_at,residency_version,started_at,? FROM integration_effects WHERE id=?",
                `extra-${i}`,
                `reference-${i}`,
                mode === "aggregate" ? "é".repeat(30000) : null,
                f.effectId,
              );
            assert.throws(() => j.getInTransaction(f.reviewer, c), {
              code: "OFFLINE_CHECKOUT_SESSION_REFERENCE_LIMIT",
            });
            assert.equal(pins, 0);
            throw Error("rollback-bounds");
          }),
        /rollback-bounds/,
      );
    }
  } finally {
    (fs as { lstatSync: typeof fs.lstatSync }).lstatSync = original;
    syncBuiltinESMExports();
  }
  assert.ok(captured(run(f, c, j)));
});
test("selected historical observation remains outside the first-attempt comparison", async (t) => {
  const f = await setup(t);
  await f.app.integration.reconcile(f.actor, f.effectId, {
    execute: async () => {
      throw Error("unused");
    },
    lookup: async () => null,
  });
  // Selected first-attempt comparisons correctly refuse observations; use the
  // original first-attempt issued comparison from another unchanged selected
  // invoice in the sibling-history positive test for broad admission. Here the
  // owning malformed observation itself must be rejected, independently.
  f.hold();
  assert.throws(() => compare(f.input()), {
    code: "OFFLINE_CHECKOUT_EVIDENCE_PROFILE",
  });
});

test("complete observations beyond normal page size are native-validated, including damaged oldest history", async (t) => {
  const f = await setup(t),
    buyer = f.app.identity.createCustomer(f.actor, "history-buyer", {
      name: "Synthetic other",
      tier: "standard",
      creditLimit: 1000000,
    }).id,
    other = { ...f, buyer };
  f.app.catalog.setPurchasingPolicy(f.actor, "synthetic-extra-account-access", {
    accountId: buyer,
    mode: "all",
    requiresReview: false,
    productIds: [],
    revision: 0,
    reason: "Explicit synthetic account access for this test.",
  });
  const invoiceId = ship(other, accept(other, 1, "history-order").id).invoiceId;
  chooseProviders(other, f.actor, "history-choice", {
    accountId: buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["stripe"],
    version: 1,
    acknowledgment: "Synthetic consent",
  });
  const e = f.app.integration.checkout(f.actor, "history", { invoiceId }),
    adapter = {
      execute: async () => {
        throw Error("synthetic loss");
      },
      lookup: async () => null,
    };
  await f.app.integration.execute(f.actor, e.id, adapter);
  for (let i = 0; i < 23; i++)
    await f.app.integration.reconcile(f.actor, e.id, adapter);
  assert.equal(
    f.app.integration.checkouts.history(f.actor, e.id).items.length,
    20,
  );
  f.hold();
  assert.ok(captured(run(f, compare(f.input()))));
  f.app.database
    .owned("integration")
    .run(
      "UPDATE integration_checkout_observations SET hash=? WHERE sequence=(SELECT MIN(sequence) FROM integration_checkout_observations WHERE effect_id=?)",
      "0".repeat(64),
      e.id,
    );
  assert.throws(() => run(f, compare(f.input())), {
    code: "OFFLINE_CHECKOUT_REVIEW",
  });
});
test("retained settlement inbox remains an explicit unavailable attribution contract", async (t) => {
  const f = await setup(t);
  f.hold();
  const c = compare(f.input());
  f.app.database
    .owned("integration")
    .run(
      "INSERT INTO integration_inbox VALUES(?,?,?,?)",
      "stripe",
      "evt_unattributed",
      digest("synthetic-event"),
      "2026-10-01T00:00:00.000Z",
    );
  assert.throws(() => run(f, c), {
    code: "OFFLINE_CHECKOUT_SESSION_INBOX_HISTORY_REQUIRED",
  });
});
test("historical proposed reference cannot hide behind a foreign organization or copied provider label", async (t) => {
  const f = await setup(t);
  f.hold();
  const c = compare(f.input()),
    s = f.app.database.owned("integration");
  s.run(
    "INSERT INTO integration_effects(id,org_id,account_id,provider,kind,reference,payload,state,external_ref,result,created_at,residency_version,started_at,error) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    "foreign",
    "foreign-org",
    "foreign-account",
    "copied-provider",
    "copied-kind",
    "foreign-native-ref",
    "{}",
    "unknown",
    "cs_test_synthetic",
    null,
    "2026-10-01T00:00:00.000Z",
    1,
    null,
    null,
  );
  assert.throws(() => run(f, c), {
    code: "OFFLINE_CHECKOUT_SESSION_REFERENCE_COLLISION",
  });
});

test("actual owning observation append is visible uncommitted and collision refusal rolls it back", async (t) => {
  const f = await setup(t);
  f.hold();
  const c = compare(f.input()),
    j = f.join();
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        f.app.integration.checkouts.recordObservation(
          f.actor,
          f.app.integration.effect(f.actor, f.effectId),
          "synthetic-inflight-claim",
          "reconcile",
          {
            reference: "cs_test_synthetic",
            result: {
              amount: 11300,
              currency: "cad",
              status: "complete",
              paymentStatus: "paid",
              expiresAt: 1893456000,
            },
          },
        );
        assert.throws(() => j.getInTransaction(f.reviewer, c), {
          code: "OFFLINE_CHECKOUT_SESSION_REFERENCE_COLLISION",
        });
        throw Error("rollback-owning-observation");
      }),
    /rollback-owning-observation/,
  );
  assert.ok(captured(run(f, c, j)));
});
test("retained active claim is an explicit independent blocker", async (t) => {
  const f = await setup(t);
  f.hold();
  const c = compare(f.input()),
    j = f.join();
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        f.app.database
          .owned("integration")
          .run(
            "UPDATE integration_operation_leases SET token='synthetic-active',started_at=1 WHERE effect_id=?",
            f.effectId,
          );
        assert.throws(() => j.getInTransaction(f.reviewer, c), {
          code: "OFFLINE_CHECKOUT_SESSION_ACTIVE_CLAIM_REQUIRED",
        });
        throw Error("rollback-claim");
      }),
    /rollback-claim/,
  );
  assert.ok(captured(run(f, c, j)));
});
test("strict JSON keys, aggregate nodes, noncanonical serialization and private error redaction", async (t) => {
  const f = await setup(t);
  f.hold();
  const c = compare(f.input()),
    j = f.join();
  for (const raw of [
    '{"__proto__":{}}',
    '{"then":{}}',
    '{"x":"PRIVATE\\u0000value"}',
    '{"' + "€".repeat(22) + '":0}',
    "\ufeff{}",
    "{} trailing",
    '{"x":-0}',
    '{"x":[' + "0,".repeat(5000) + "0]}",
    '{ "invoiceId":"private" }',
  ]) {
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          f.app.database
            .owned("integration")
            .run(
              "UPDATE integration_effects SET payload=? WHERE id=?",
              raw,
              f.effectId,
            );
          assert.throws(
            () => j.getInTransaction(f.reviewer, c),
            (e: unknown) => {
              assert.ok(e instanceof Error);
              assert.ok(
                !e.message.includes("PRIVATE") &&
                  !e.message.includes("private"),
              );
              return true;
            },
          );
          throw Error("rollback-canonical");
        }),
      /rollback-canonical/,
    );
  }
  assert.ok(captured(run(f, c, j)));
});
