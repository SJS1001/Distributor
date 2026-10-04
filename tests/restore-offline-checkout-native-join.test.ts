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
  RestoreOfflineCheckoutNativeJoin as Join,
  isCapturedOfflineCheckoutNativeJoin as captured,
} from "../src/server/restore-offline-checkout-native-join.ts";

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
const refused = { code: "OFFLINE_CHECKOUT_NATIVE_JOIN" };
function run(f: F, c: unknown, j = f.join()) {
  return f.app.database.transaction(() => j.getInTransaction(f.reviewer, c));
}
function totals(f: F) {
  return f.app.database.owned("integration").get("SELECT total_changes() AS n")!
    .n;
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
  test(`real held same-writer ${region}/${currency} join captures current facts, no writes or transport`, async (t) => {
    const f = await setup(t, region, currency);
    f.hold();
    const input = f.input(),
      c = compare(input),
      n = totals(f),
      j = f.join(),
      r = run(f, c, j);
    assert.equal(totals(f), n);
    assert.equal(f.calls(), 1);
    frozen(r);
    assert.ok(captured(r));
    assert.equal(captured(structuredClone(r)), false);
    assert.equal(r.comparisonHash, c.hash);
    assert.equal(r.candidateHash, digest(canonical(input.candidateStore)));
    assert.equal(r.nativeHash, input.candidate.factsHash);
    const { hash, ...body } = r;
    assert.equal(hash, digest(canonical(body)));
    assert.deepEqual(run(f, c, j), r);
    assert.ok(
      r.requiredChecks.includes(
        "integration-proposed-session-reference-history-contract-required",
      ),
    );
    assert.ok(
      r.requiredChecks.includes(
        "qualified-source-candidate-fences-and-authority-through-commit",
      ),
    );
    assert.equal("outcome" in r, false);
    assert.equal("allowed" in r, false);
    assert.equal("qualified" in r, false);
    assert.throws(() => f.app.platform.assertProviderAccess(), {
      code: "RECOVERY_HOLD",
    });
  });
test("requires existing writer, branded exact comparison, raw hold and exact candidate", async (t) => {
  const f = await setup(t);
  f.hold();
  const c = compare(f.input()),
    j = f.join();
  assert.throws(() => j.getInTransaction(f.reviewer, c), {
    code: "TRANSACTION",
  });
  for (const v of [structuredClone(c), { ...c }, {}, null])
    assert.throws(() => run(f, v, j), refused);
  const v = f.input();
  v.candidateStore.logicalHash = "0".repeat(64);
  assert.throws(() => run(f, compare(v)), refused);
  f.app.database.owned("platform").run("DELETE FROM platform_recovery");
  assert.throws(() => run(f, c, j), { code: "OFFLINE_CHECKOUT_RAW_HOLD" });
});
test("caller proxy/accessor/grants cannot execute or replace current authority", async (t) => {
  const f = await setup(t);
  f.hold();
  const c = compare(f.input()),
    j = f.join();
  let calls = 0;
  const hook = () => {
    calls++;
    throw Error("PRIVATE");
  };
  const p = new Proxy(
      {},
      {
        get: hook,
        ownKeys: hook,
        getPrototypeOf: hook,
        getOwnPropertyDescriptor: hook,
      },
    ),
    rv = Proxy.revocable({}, {});
  rv.revoke();
  for (const v of [p, rv.proxy]) {
    assert.throws(() => run(f, v, j), refused);
    assert.equal(captured(v), false);
    assert.throws(
      () => f.app.database.transaction(() => j.getInTransaction(v, c)),
      refused,
    );
  }
  for (const a of [
    { ...f.reviewer, role: "admin" },
    {
      get id() {
        return hook();
      },
      orgId: f.actor.orgId,
    },
    { id: "\ud800", orgId: f.actor.orgId },
    { id: f.reviewer.id, orgId: "foreign" },
  ])
    assert.throws(() =>
      f.app.database.transaction(() => j.getInTransaction(a, c)),
    );
  assert.equal(calls, 0);
});
for (const [name, sql, args, code] of [
  ["revoked", "UPDATE iam_users SET active=0 WHERE id=?", [], "FORBIDDEN"],
  [
    "sales role",
    "UPDATE iam_users SET role='sales' WHERE id=?",
    [],
    "FORBIDDEN",
  ],
  [
    "customer scope",
    "UPDATE iam_users SET account_id=? WHERE id=?",
    ["buyer"],
    "FORBIDDEN",
  ],
  [
    "tenant changed",
    "UPDATE iam_users SET org_id='foreign' WHERE id=?",
    [],
    "FORBIDDEN",
  ],
  [
    "password change",
    "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
    [],
    "PASSWORD_CHANGE_REQUIRED",
  ],
] as const)
  test(`fresh ${name} refuses retained comparison even inside uncommitted writer`, async (t) => {
    const f = await setup(t);
    f.hold();
    const c = compare(f.input()),
      j = f.join();
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          f.app.database
            .owned("iam")
            .run(
              sql,
              ...args.map((a) => (a === "buyer" ? f.buyer : a)),
              f.reviewer.id,
            );
          assert.throws(() => j.getInTransaction(f.reviewer, c), { code });
          throw Error("rollback-native-authority");
        }),
      /rollback-native-authority/,
    );
    assert.ok(captured(run(f, c, j)));
  });
test("current processing choice withdrawal refuses without changing hold or retained evidence", async (t) => {
  const f = await setup(t);
  f.hold();
  const c = compare(f.input());
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_accounts SET provider_exceptions='[]' WHERE id=?",
      f.buyer,
    );
  assert.throws(() => run(f, c), { code: "RESIDENCY_BLOCKED" });
});
test("same-writer changed intent/history and uncommitted payment cannot hide behind old snapshot", async (t) => {
  const f = await setup(t);
  f.hold();
  const c = compare(f.input()),
    j = f.join();
  for (const sql of [
    "UPDATE integration_effects SET error='changed native history' WHERE id=?",
    "UPDATE integration_operation_leases SET token='active',started_at=1 WHERE effect_id=?",
  ]) {
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          f.app.database.owned("integration").run(sql, f.effectId);
          assert.throws(() => j.getInTransaction(f.reviewer, c), refused);
          throw Error("rollback-history");
        }),
      /rollback-history/,
    );
    assert.ok(captured(run(f, c, j)));
  }
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        // Actual owning native task; the join must see this uncommitted payment.
        f.app.billing.verifiedPayment(
          f.actor,
          f.invoiceId,
          1,
          "stripe",
          "pi_uncommitted",
        );
        assert.throws(() => j.getInTransaction(f.reviewer, c), {
          code: "OFFLINE_CHECKOUT_BILLING_HISTORY_REQUIRED",
        });
        assert.throws(
          () =>
            new IntegrationOfflineCheckoutReview(
              f.app.database,
              f.app.identity,
              f.app.billing,
              f.app.integration.checkouts,
            ).getInTransaction(
              f.app.identity.workerActor(f.reviewer.orgId, f.reviewer.id),
              f.effectId,
            ),
          { code: "OFFLINE_CHECKOUT_BILLING_HISTORY_REQUIRED" },
        );
        throw Error("rollback-payment");
      }),
    /rollback-payment/,
  );
  assert.ok(captured(run(f, c, j)));
});
test("read-only join survives rollback and application reopen with exact native bytes", async (t) => {
  const f = await setup(t);
  f.hold();
  const c = compare(f.input()),
    first = run(f, c);
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        assert.equal(f.join().getInTransaction(f.reviewer, c).hash, first.hash);
        throw Error("rollback-read");
      }),
    /rollback-read/,
  );
  f.app.close();
  f.app = new Application(f.path, "CA");
  assert.deepEqual(run(f, c), first);
});
test("owner substitution/cross-database/forged prototypes and own overrides are rejected without callback", async (t) => {
  const f = await setup(t),
    other = fixture(t);
  let calls = 0;
  const hook = () => {
    calls++;
    throw Error("PRIVATE callback");
  };
  const good = [
    f.app.database,
    f.app.identity,
    f.app.billing,
    f.app.integration.checkouts,
  ] as const;
  const prototypes = [
    Database.prototype,
    Identity.prototype,
    Billing.prototype,
    IntegrationCheckouts.prototype,
  ];
  for (let i = 0; i < 4; i++)
    for (const value of [
      Object.create(prototypes[i]!),
      new Proxy(good[i]!, { get: hook, getPrototypeOf: hook }),
      Object.assign(Object.create(prototypes[i]!), good[i]),
    ]) {
      const args: [Database, Identity, Billing, IntegrationCheckouts] = [
        ...good,
      ];
      (args as unknown[])[i] = value;
      assert.throws(() => new Join(...args), refused);
    }
  assert.throws(
    () =>
      new Join(
        other.app.database,
        f.app.identity,
        f.app.billing,
        f.app.integration.checkouts,
      ),
    refused,
  );
  const j = f.join();
  f.hold();
  const c = compare(f.input());
  Object.defineProperty(f.app.identity, "workerActor", {
    value: hook,
    configurable: true,
  });
  assert.throws(() => run(f, c, j), refused);
  delete (f.app.identity as any).workerActor;
  Object.defineProperty(f.app.integration.checkouts, "current", {
    get: hook,
    configurable: true,
  });
  assert.throws(() => run(f, c, j), refused);
  delete (f.app.integration.checkouts as any).current;
  assert.equal(calls, 0);
  assert.ok(captured(run(f, c, j)));
});
test("owner method reentry injection is refused before a hook executes", async (t) => {
  const f = await setup(t);
  f.hold();
  const c = compare(f.input()),
    j = f.join();
  let calls = 0;
  const original = Identity.prototype.workerActor;
  try {
    Identity.prototype.workerActor = function () {
      calls++;
      try {
        j.getInTransaction(f.reviewer, c);
      } catch {}
      return f.actor;
    };
    assert.throws(() => run(f, c, j), refused);
  } finally {
    Identity.prototype.workerActor = original;
  }
  assert.equal(calls, 0);
  assert.ok(captured(run(f, c, j)));
});

test("native proposed PaymentIntent collision on another invoice demonstrates the explicit missing Billing task contract", async (t) => {
  const f = await setup(t),
    otherInvoice = ship(f, accept(f, 1, "other-invoice").id).invoiceId;
  const payment = f.app.database.transaction(() =>
    f.app.billing.verifiedPayment(
      f.actor,
      otherInvoice,
      11300,
      "stripe",
      "pi_synthetic",
    ),
  );
  assert.equal(
    f.app.billing.recordedPayment(f.actor, payment.id).external_ref,
    "pi_synthetic",
  );
  f.hold();
  const c = compare(f.input()),
    r = run(f, c);
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).paid, 0);
  assert.ok(
    r.requiredChecks.includes(
      "billing-proposed-payment-reference-history-contract-required",
    ),
  );
  // Selected native invoice facts really are consistent. This receipt must NEVER
  // be interpreted as proposed-reference absence or permission to record payment.
  assert.equal("referenceAvailable" in r, false);
  assert.equal("allowed" in r, false);
});
test("native proposed session collision on another customer demonstrates the explicit missing Integration task contract", async (t) => {
  const f = await setup(t),
    otherBuyer = f.app.identity.createCustomer(f.actor, "other-buyer", {
      name: "Other synthetic customer",
      tier: "standard",
      creditLimit: 1000000,
    }).id;
  const other = { ...f, buyer: otherBuyer },
    invoiceId = ship(
      other,
      accept(other, 1, "other-customer-order").id,
    ).invoiceId;
  chooseProviders(other, f.actor, "other-choice", {
    accountId: otherBuyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["stripe"],
    version: 1,
    acknowledgment: "Synthetic permission only",
  });
  const e = f.app.integration.checkout(f.actor, "other-session", { invoiceId });
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
  assert.equal(
    f.app.integration.effect(f.actor, e.id).external_ref,
    result.reference,
  );
  f.hold();
  const input = f.input();
  assert.equal(input.candidate.observations.length, 0);
  const r = run(f, compare(input));
  assert.ok(
    r.requiredChecks.includes(
      "integration-proposed-session-reference-history-contract-required",
    ),
  );
  assert.equal("referenceAvailable" in r, false);
});
test("actual settled sibling checkout leaves an unattributed Stripe inbox and refuses the narrow profile", async (t) => {
  const f = await setup(t),
    invoiceId = ship(f, accept(f, 1, "other-paid-order").id).invoiceId,
    e = f.app.integration.checkout(f.actor, "paid-checkout", { invoiceId });
  const result = {
    reference: "cs_test_paid",
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
  await f.app.integration.stripeSettlement(
    f.actor,
    { id: "evt_synthetic", sessionId: result.reference, effectId: e.id },
    async () => ({
      paid: true,
      amount: 11300,
      currency: "cad",
      paymentId: "pi_other",
      effectId: e.id,
      livemode: false,
    }),
  );
  f.hold();
  assert.throws(f.input, { code: "OFFLINE_CHECKOUT_INBOX_HISTORY_REQUIRED" });
});
for (const [name, sql, value, code] of [
  [
    "retained UTF8 field byte bound",
    "UPDATE integration_effects SET error=? WHERE id=?",
    "€".repeat(22000),
    "OFFLINE_CHECKOUT_REVIEW_LIMIT",
  ],
  [
    "retained embedded NUL field byte bound",
    "UPDATE integration_effects SET error=? WHERE id=?",
    "\0".repeat(65537),
    "OFFLINE_CHECKOUT_REVIEW_LIMIT",
  ],
  [
    "changed immutable payload",
    "UPDATE integration_effects SET payload=? WHERE id=?",
    "{}",
    "OFFLINE_CHECKOUT_REVIEW",
  ],
  [
    "foreign copied account",
    "UPDATE integration_effects SET account_id=? WHERE id=?",
    "foreign",
    "NOT_FOUND",
  ],
] as const)
  test(`actual ${name} refuses under the same writer`, async (t) => {
    const f = await setup(t);
    f.hold();
    const c = compare(f.input()),
      j = f.join();
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          f.app.database.owned("integration").run(sql, value, f.effectId);
          assert.throws(() => j.getInTransaction(f.reviewer, c), { code });
          throw Error("rollback-corruption");
        }),
      /rollback-corruption/,
    );
    assert.ok(captured(run(f, c, j)));
  });
test("owner collection count limit precedes retained row materialization and leaves original history intact", async (t) => {
  const f = await setup(t);
  f.hold();
  const c = compare(f.input()),
    j = f.join(),
    store = f.app.database.owned("integration");
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        for (let i = 0; i < 64; i++)
          store.run(
            "INSERT INTO integration_effects(id,org_id,account_id,provider,kind,reference,payload,state,external_ref,result,created_at,residency_version,started_at,error) SELECT ?,org_id,account_id,provider,kind,?,payload,state,external_ref,result,created_at,residency_version,started_at,error FROM integration_effects WHERE id=?",
            `synthetic-overflow-${i}`,
            `synthetic-reference-${i}`,
            f.effectId,
          );
        assert.throws(() => j.getInTransaction(f.reviewer, c), {
          code: "OFFLINE_CHECKOUT_REVIEW_LIMIT",
        });
        throw Error("rollback-count");
      }),
    /rollback-count/,
  );
  assert.ok(captured(run(f, c, j)));
});

test("actual reconcile observation history remains visible and is explicitly unsupported by first-attempt comparator", async (t) => {
  const f = await setup(t);
  await f.app.integration.reconcile(f.actor, f.effectId, {
    execute: async () => {
      throw Error("send forbidden");
    },
    lookup: async () => null,
  });
  f.hold();
  const input = f.input();
  assert.ok(input.candidate.observations.length > 0);
  assert.throws(() => compare(input), {
    code: "OFFLINE_CHECKOUT_EVIDENCE_PROFILE",
  });
});
test("selected native foreign identity collision and orphan retained lineage refuse, never disappear through scope", async (t) => {
  const f = await setup(t);
  f.hold();
  const c = compare(f.input()),
    j = f.join(),
    s = f.app.database.owned("integration");
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        s.run(
          "INSERT INTO integration_effects(id,org_id,account_id,provider,kind,reference,payload,state,external_ref,result,created_at,residency_version,started_at,error) SELECT 'synthetic-foreign','foreign-org',account_id,provider,kind,reference,payload,state,external_ref,result,created_at,residency_version,started_at,error FROM integration_effects WHERE id=?",
          f.effectId,
        );
        assert.throws(() => j.getInTransaction(f.reviewer, c), {
          code: "OFFLINE_CHECKOUT_REVIEW",
        });
        throw Error("rollback-foreign");
      }),
    /rollback-foreign/,
  );
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        s.run(
          "INSERT INTO integration_callbacks(id,org_id,binding_id,event_id,session_id,effect_id,hash,state,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
          "orphan",
          f.actor.orgId,
          "binding",
          "evt_orphan",
          "cs_test_orphan",
          "missing",
          digest("synthetic-orphan"),
          "pending",
          "2026-10-01T00:00:00.000Z",
        );
        assert.throws(() => j.getInTransaction(f.reviewer, c), {
          code: "OFFLINE_CHECKOUT_REVIEW",
        });
        throw Error("rollback-orphan");
      }),
    /rollback-orphan/,
  );
  assert.ok(captured(run(f, c, j)));
});
test("Billing complete scalar byte preflight still runs for a selected zero-settlement invoice", async (t) => {
  const f = await setup(t);
  f.hold();
  const c = compare(f.input()),
    j = f.join();
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        f.app.database
          .owned("billing")
          .run(
            "UPDATE billing_lines SET description=? WHERE invoice_id=?",
            "€".repeat(22000),
            f.invoiceId,
          );
        assert.throws(() => j.getInTransaction(f.reviewer, c), {
          code: "OFFLINE_CHECKOUT_BILLING_LIMIT",
        });
        throw Error("rollback-billing-bound");
      }),
    /rollback-billing-bound/,
  );
  assert.ok(captured(run(f, c, j)));
});

test("caught synchronous reentry poisons the outer review; native same-writer writes cannot hide behind equal logical facts", async (t) => {
  const f = await setup(t);
  f.hold();
  const c = compare(f.input()),
    j = f.join(),
    original = fs.lstatSync;
  for (const operation of ["reenter", "write-same-value"] as const) {
    let calls = 0;
    // Test-only instrumentation of the actual shared filesystem pin, not a
    // production callback/source/authority port. Restore builtin ESM bindings.
    try {
      (fs as { lstatSync: typeof fs.lstatSync }).lstatSync = ((
        ...args: Parameters<typeof fs.lstatSync>
      ) => {
        if (calls++ === 0) {
          if (operation === "reenter")
            assert.throws(() => j.getInTransaction(f.reviewer, c), refused);
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
      assert.throws(() => run(f, c, j), refused);
      assert.ok(calls > 0);
    } finally {
      (fs as { lstatSync: typeof fs.lstatSync }).lstatSync = original;
      syncBuiltinESMExports();
    }
    assert.ok(captured(run(f, c, j)));
  }
});
test("Integration retained-byte bound refuses before the shared candidate reader even opens its pathname pin", async (t) => {
  const f = await setup(t);
  f.hold();
  const c = compare(f.input()),
    j = f.join(),
    original = fs.lstatSync;
  let calls = 0;
  try {
    (fs as { lstatSync: typeof fs.lstatSync }).lstatSync = ((
      ...args: Parameters<typeof fs.lstatSync>
    ) => {
      calls++;
      return original(...args);
    }) as typeof fs.lstatSync;
    syncBuiltinESMExports();
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          f.app.database
            .owned("integration")
            .run(
              "UPDATE integration_effects SET error=? WHERE id=?",
              "\0".repeat(65537),
              f.effectId,
            );
          assert.throws(() => j.getInTransaction(f.reviewer, c), {
            code: "OFFLINE_CHECKOUT_REVIEW_LIMIT",
          });
          assert.equal(calls, 0);
          throw Error("rollback-before-pin");
        }),
      /rollback-before-pin/,
    );
  } finally {
    (fs as { lstatSync: typeof fs.lstatSync }).lstatSync = original;
    syncBuiltinESMExports();
  }
  assert.ok(captured(run(f, c, j)));
});

test("owner data accessors and nested owning-method substitutions refuse without executing hooks", async (t) => {
  const f = await setup(t);
  f.hold();
  const c = compare(f.input()),
    j = f.join();
  let calls = 0;
  const hook = () => {
    calls++;
    throw Error("PRIVATE hook");
  };
  for (const [object, key] of [
    [f.app.database, "path"],
    [f.app.identity, "region"],
    [f.app.billing, "opening"],
    [f.app.identity, "mfa"],
    [f.app.identity.residency, "assertCurrent"],
    [f.app.billing.opening, "snapshot"],
    [f.app.identity.mfa, "summary"],
  ] as const) {
    const original = Object.getOwnPropertyDescriptor(object, key);
    try {
      Object.defineProperty(object, key, { get: hook, configurable: true });
      assert.throws(() => run(f, c, j), refused);
    } finally {
      if (original) Object.defineProperty(object, key, original);
      else Reflect.deleteProperty(object, key);
    }
  }
  assert.equal(calls, 0);
  assert.ok(captured(run(f, c, j)));
});

test("invalid retained UTF8 cannot be captured as an exact selected native error", async (t) => {
  const f = await setup(t);
  f.app.database
    .owned("integration")
    .run(
      "UPDATE integration_effects SET error=CAST(X'80' AS TEXT) WHERE id=?",
      f.effectId,
    );
  f.hold();
  const input = f.input();
  assert.equal(input.candidate.effects[0]!.error, "\ufffd");
  assert.throws(() => compare(input), { code: "OFFLINE_CHECKOUT_EVIDENCE" });
});
