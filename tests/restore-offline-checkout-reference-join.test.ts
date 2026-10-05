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
  RestoreOfflineCheckoutReferenceJoin as Join,
  isCapturedOfflineCheckoutReferenceJoin as captured,
} from "../src/server/restore-offline-checkout-reference-join.ts";

async function setup(
  t: TestContext,
  region: "CA" | "US" = "CA",
  currency: "CAD" | "USD" = "CAD",
  eventReports = true,
) {
  const f = fixture(t, { eventReports }, region, currency),
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
const refused = { code: "OFFLINE_CHECKOUT_REFERENCE_JOIN" };
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

import { RestoreOfflineCheckoutNativeJoin as OriginalJoin } from "../src/server/restore-offline-checkout-native-join.ts";
import { BillingOfflineCheckoutReferenceReview as PaymentReview } from "../src/server/billing-offline-checkout-reference-review.ts";
import { IntegrationOfflineCheckoutReferenceReview as SessionReview } from "../src/server/integration-offline-checkout-reference-review.ts";
import { Store } from "../src/server/database.ts";
const remaining = [
  "qualified-stripe-account-runtime-binding-and-provider-truth",
  "qualified-complete-source-interval-and-command-provenance",
  "qualified-source-candidate-fences-and-authority-through-commit",
  "fixed-checkout-owner-application-contract-required",
];
for (const [region, currency] of [
  ["CA", "CAD"],
  ["CA", "USD"],
  ["US", "USD"],
] as const)
  for (const reports of [false, true])
    test(`enhanced ${region}/${currency} reports=${reports}: exact three receipts, only three discharged checks`, async (t) => {
      const f = await setup(t, region, currency, reports);
      f.hold();
      const c = compare(f.input()),
        j = f.join(),
        before = totals(f);
      const r = run(f, c, j);
      frozen(r);
      assert.ok(captured(r));
      assert.equal(captured(structuredClone(r)), false);
      assert.equal(captured(new Proxy(r, {})), false);
      assert.equal(r.purpose, "distributor-offline-checkout-reference-join-v1");
      assert.equal(r.paymentReference, c.outcome.settlement.paymentId);
      assert.equal(r.sessionReference, c.outcome.reference);
      assert.equal(r.bindingHash, digest(canonical(c.binding)));
      assert.equal(r.outcomeHash, digest(canonical(c.outcome)));
      assert.equal(r.candidateHash, c.candidateHash);
      assert.deepEqual(r.requiredChecks, remaining);
      const args = [
        f.app.database,
        f.app.identity,
        f.app.billing,
        f.app.integration.checkouts,
      ] as const;
      f.app.database.transaction(() => {
        const old = new OriginalJoin(...args).getInTransaction(f.reviewer, c);
        const payment = new PaymentReview(...args).getInTransaction(
          f.reviewer,
          c,
        );
        const session = new SessionReview(...args).getInTransaction(
          f.reviewer,
          c,
        );
        assert.equal(r.nativeJoinHash, old.hash);
        assert.equal(r.paymentReferenceHash, payment.hash);
        assert.equal(r.sessionReferenceHash, session.hash);
        assert.equal(session.billingReferenceHash, payment.hash);
        assert.equal(old.requiredChecks.length, c.requiredChecks.length - 1);
        assert.ok(
          old.requiredChecks.includes(
            "billing-proposed-payment-reference-history-contract-required",
          ),
        );
      });
      const { hash, ...body } = r;
      assert.equal(
        hash,
        digest(
          canonical({
            domain: "distributor-offline-checkout-reference-join-receipt-v1",
            body,
          }),
        ),
      );
      assert.deepEqual(run(f, c, j), r);
      assert.equal(totals(f), before);
      assert.equal(f.calls(), 1);
      for (const key of [
        "allowed",
        "qualified",
        "outcome",
        "provider",
        "billing",
        "session",
        "native",
      ])
        assert.equal(key in r, false);
      assert.throws(() => f.app.platform.assertProviderAccess(), {
        code: "RECOVERY_HOLD",
      });
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
      assert.throws(() => run(f, c, j), {
        code:
          operation === "reenter"
            ? "OFFLINE_CHECKOUT_REFERENCE_JOIN"
            : "OFFLINE_CHECKOUT_PAYMENT_REFERENCE_REVIEW",
      });
      assert.ok(calls > 0);
    } finally {
      (fs as { lstatSync: typeof fs.lstatSync }).lstatSync = original;
      syncBuiltinESMExports();
    }
    assert.ok(captured(run(f, c, j)));
  }
});
test("native proposed PaymentIntent collision on another invoice is refused by the composed actual Billing receipt", async (t) => {
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
  const c = compare(f.input());
  assert.throws(() => run(f, c), {
    code: "OFFLINE_CHECKOUT_PAYMENT_REFERENCE_COLLISION",
  });
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).paid, 0);
});
test("native proposed session collision on another customer is refused by the composed actual Integration receipt", async (t) => {
  const f = await setup(t),
    otherBuyer = f.app.identity.createCustomer(f.actor, "other-buyer", {
      name: "Other synthetic customer",
      tier: "standard",
      creditLimit: 1000000,
    }).id;
  f.app.catalog.setPurchasingPolicy(f.actor, "synthetic-extra-account-access", {
    accountId: otherBuyer,
    mode: "all",
    requiresReview: false,
    productIds: [],
    revision: 0,
    reason: "Explicit synthetic account access for this test.",
  });
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

test("existing writer, exact issued comparison, candidate and raw hold are mandatory", async (t) => {
  const f = await setup(t);
  f.hold();
  const c = compare(f.input()),
    j = f.join();
  assert.throws(() => j.getInTransaction(f.reviewer, c), {
    code: "TRANSACTION",
  });
  for (const lookalike of [structuredClone(c), { ...c }, {}, null])
    assert.throws(() => run(f, lookalike, j), refused);
  const wrong = f.input();
  wrong.candidateStore.logicalHash = "0".repeat(64);
  assert.throws(() => run(f, compare(wrong), j), {
    code: "OFFLINE_CHECKOUT_PAYMENT_REFERENCE_REVIEW",
  });
  f.app.database.owned("platform").run("DELETE FROM platform_recovery");
  assert.throws(() => run(f, c, j), {
    code: "OFFLINE_CHECKOUT_REFERENCE_RAW_HOLD",
  });
});
test("current native drift and active claim are refused in the caller writer; rollback restores eligibility", async (t) => {
  const f = await setup(t);
  f.hold();
  const c = compare(f.input()),
    j = f.join();
  for (const [sql, code] of [
    [
      "UPDATE integration_effects SET error='changed' WHERE id=?",
      "OFFLINE_CHECKOUT_PAYMENT_REFERENCE_REVIEW",
    ],
    [
      "UPDATE integration_operation_leases SET token='busy',started_at=1 WHERE effect_id=?",
      "OFFLINE_CHECKOUT_SESSION_ACTIVE_CLAIM_REQUIRED",
    ],
  ]) {
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          f.app.database.owned("integration").run(sql!, f.effectId);
          assert.throws(() => j.getInTransaction(f.reviewer, c), { code });
          throw Error("rollback-drift");
        }),
      /rollback-drift/,
    );
    assert.ok(captured(run(f, c, j)));
  }
});
test("uncommitted actual payment reference collision on sibling invoice is visible and rolled back", async (t) => {
  const f = await setup(t),
    otherInvoice = ship(f, accept(f, 1, "sibling").id).invoiceId;
  f.hold();
  const c = compare(f.input()),
    j = f.join();
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        const p = f.app.billing.verifiedPayment(
          f.actor,
          otherInvoice,
          1,
          "stripe",
          "pi_synthetic",
        );
        assert.equal(
          f.app.billing.recordedPayment(f.actor, p.id).external_ref,
          "pi_synthetic",
        );
        const n = totals(f);
        assert.throws(() => j.getInTransaction(f.reviewer, c), {
          code: "OFFLINE_CHECKOUT_PAYMENT_REFERENCE_COLLISION",
        });
        assert.equal(totals(f), n);
        throw Error("rollback-collision");
      }),
    /rollback-collision/,
  );
  assert.ok(captured(run(f, c, j)));
});
test("complete unrelated pending checkout is conservatively refused without changing its obligation", async (t) => {
  const f = await setup(t),
    invoiceId = ship(f, accept(f, 1, "pending").id).invoiceId;
  const e = f.app.integration.checkout(f.actor, "pending-checkout", {
    invoiceId,
  });
  assert.equal(e.state, "pending");
  f.hold();
  const c = compare(f.input()),
    before = totals(f);
  assert.throws(() => run(f, c), {
    code: "OFFLINE_CHECKOUT_SESSION_CURRENT_HISTORY_REQUIRED",
  });
  assert.equal(f.app.integration.effect(f.actor, e.id).state, "pending");
  assert.equal(totals(f), before);
});
test("constructor rejects forged, proxy and cross-application owner graph before callbacks", async (t) => {
  const f = await setup(t),
    other = fixture(t);
  let calls = 0;
  const hook = () => {
    calls++;
    throw Error("PRIVATE owner hook");
  };
  const good = [
    f.app.database,
    f.app.identity,
    f.app.billing,
    f.app.integration.checkouts,
  ] as const;
  const foreign = [
    other.app.database,
    other.app.identity,
    other.app.billing,
    other.app.integration.checkouts,
  ];
  for (let i = 0; i < 4; i++)
    for (const value of [
      foreign[i],
      Object.create(Object.getPrototypeOf(good[i])),
      new Proxy(good[i]!, { get: hook, getPrototypeOf: hook, ownKeys: hook }),
    ]) {
      const args: [Database, Identity, Billing, IntegrationCheckouts] = [
        ...good,
      ];
      (args as unknown[])[i] = value;
      assert.throws(() => new Join(...args), {
        code: "OFFLINE_CHECKOUT_NATIVE_JOIN",
      });
    }
  assert.equal(calls, 0);
});
test("composition method descriptor replacements cannot supply forged branded receipts or execute hooks", async (t) => {
  const f = await setup(t);
  f.hold();
  const c = compare(f.input()),
    j = f.join();
  let calls = 0;
  const hook = () => {
    calls++;
    throw Error("PRIVATE method hook");
  };
  for (const prototype of [
    OriginalJoin.prototype,
    PaymentReview.prototype,
    SessionReview.prototype,
  ]) {
    const descriptor = Object.getOwnPropertyDescriptor(
      prototype,
      "getInTransaction",
    )!;
    try {
      Object.defineProperty(prototype, "getInTransaction", {
        get: hook,
        configurable: true,
      });
      assert.throws(() => run(f, c, j), refused);
    } finally {
      Object.defineProperty(prototype, "getInTransaction", descriptor);
    }
  }
  assert.equal(calls, 0);
  assert.ok(captured(run(f, c, j)));
});
test("actual owner data/method/Store substitution refuses before callback invocation", async (t) => {
  const f = await setup(t),
    other = fixture(t);
  f.hold();
  const c = compare(f.input()),
    j = f.join();
  let calls = 0;
  const hook = () => {
    calls++;
    throw Error("PRIVATE graph hook");
  };
  for (const [object, key] of [
    [f.app.database, "path"],
    [f.app.identity, "workerActor"],
    [f.app.billing, "store"],
    [f.app.integration.checkouts, "current"],
    [Store.prototype, "get"],
  ] as const) {
    const old = Object.getOwnPropertyDescriptor(object, key);
    try {
      Object.defineProperty(object, key, { get: hook, configurable: true });
      assert.throws(() => run(f, c, j), {
        code: "OFFLINE_CHECKOUT_PAYMENT_REFERENCE_REVIEW",
      });
    } finally {
      if (old) Object.defineProperty(object, key, old);
      else Reflect.deleteProperty(object, key);
    }
  }
  const old = Object.getOwnPropertyDescriptor(f.app.billing, "store")!;
  try {
    Object.defineProperty(f.app.billing, "store", {
      ...old,
      value: other.app.database.owned("billing"),
    });
    assert.throws(() => run(f, c, j), {
      code: "OFFLINE_CHECKOUT_PAYMENT_REFERENCE_REVIEW",
    });
  } finally {
    Object.defineProperty(f.app.billing, "store", old);
  }
  assert.equal(calls, 0);
  assert.ok(captured(run(f, c, j)));
});
for (const [value, code] of [
  ["€".repeat(22000), "OFFLINE_CHECKOUT_SESSION_REFERENCE_LIMIT"],
  ["\0".repeat(65537), "OFFLINE_CHECKOUT_SESSION_REFERENCE_REVIEW"],
])
  test(`global retained-byte preflight refuses ${value![0] === "€" ? "multibyte" : "NUL"} before candidate filesystem capture`, async (t) => {
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
                value!,
                f.effectId,
              );
            assert.throws(() => j.getInTransaction(f.reviewer, c), { code });
            assert.equal(calls, 0);
            throw Error("rollback-limit");
          }),
        /rollback-limit/,
      );
    } finally {
      (fs as { lstatSync: typeof fs.lstatSync }).lstatSync = original;
      syncBuiltinESMExports();
    }
    assert.ok(captured(run(f, c, j)));
  });
test("global malformed UTF8 and complete count refuse without admitting replacement text or truncation", async (t) => {
  const f = await setup(t);
  f.hold();
  const c = compare(f.input()),
    j = f.join(),
    s = f.app.database.owned("integration");
  for (const mode of ["utf8", "count"]) {
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          if (mode === "utf8")
            s.run(
              "UPDATE integration_effects SET error=CAST(X'80' AS TEXT) WHERE id=?",
              f.effectId,
            );
          else
            for (let i = 0; i < 64; i++)
              s.run(
                "INSERT INTO integration_effects(id,org_id,account_id,provider,kind,reference,payload,state,external_ref,result,created_at,residency_version,started_at,error) SELECT ?,org_id,account_id,provider,kind,?,payload,state,external_ref,result,created_at,residency_version,started_at,error FROM integration_effects WHERE id=?",
                `overflow-${i}`,
                `ref-${i}`,
                f.effectId,
              );
          assert.throws(() => j.getInTransaction(f.reviewer, c), {
            code:
              mode === "utf8"
                ? "OFFLINE_CHECKOUT_SESSION_REFERENCE_REVIEW"
                : "OFFLINE_CHECKOUT_SESSION_REFERENCE_LIMIT",
          });
          throw Error("rollback-resource");
        }),
      /rollback-resource/,
    );
    assert.ok(captured(run(f, c, j)));
  }
});
