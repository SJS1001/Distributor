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
  BillingOfflineCheckoutReferenceReview as Join,
  isCapturedOfflineCheckoutPaymentReferenceReview as captured,
} from "../src/server/billing-offline-checkout-reference-review.ts";
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

test("actual cross-invoice PaymentIntent collision previously outside selected history now refuses", async (t) => {
  const f = await setup(t),
    invoiceId = ship(f, accept(f, 1, "other-order").id).invoiceId;
  const payment = f.app.database.transaction(() =>
    f.app.billing.verifiedPayment(
      f.actor,
      invoiceId,
      11300,
      "stripe",
      "pi_synthetic",
    ),
  );
  assert.equal(
    f.app.billing.recordedPayment(f.actor, payment.id).invoice_id,
    invoiceId,
  );
  f.hold();
  const c = compare(f.input());
  assert.throws(() => run(f, c), {
    code: "OFFLINE_CHECKOUT_PAYMENT_REFERENCE_COLLISION",
  });
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).paid, 0);
});
test("other invoice manual and Stripe payments with distinct references are completely validated without exposing them", async (t) => {
  const f = await setup(t),
    invoiceId = ship(f, accept(f, 1, "other-order").id).invoiceId;
  f.app.database.transaction(() =>
    f.app.billing.verifiedPayment(
      f.actor,
      invoiceId,
      100,
      "stripe",
      "pi_unrelated",
    ),
  );
  f.app.billing.manualPayment(f.actor, "manual-other", {
    invoiceId,
    amount: 100,
    reference: "synthetic-bank",
    reason: "Synthetic manual receipt",
  });
  f.hold();
  const r = run(f, compare(f.input()));
  assert.ok(captured(r));
  const raw = canonical(r);
  assert.ok(!raw.includes("pi_unrelated") && !raw.includes("synthetic-bank"));
});
test("uncommitted proposed reference collision refuses before stale candidate check and rolls back", async (t) => {
  const f = await setup(t),
    invoiceId = ship(f, accept(f, 1, "other-order").id).invoiceId;
  f.hold();
  const c = compare(f.input()),
    j = f.join();
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        f.app.billing.verifiedPayment(
          f.actor,
          invoiceId,
          100,
          "stripe",
          "pi_synthetic",
        );
        assert.throws(() => j.getInTransaction(f.reviewer, c), {
          code: "OFFLINE_CHECKOUT_PAYMENT_REFERENCE_COLLISION",
        });
        throw Error("rollback-collision");
      }),
    /rollback-collision/,
  );
  assert.ok(captured(run(f, c, j)));
});
for (const [name, sql, value, code] of [
  [
    "orphan payment",
    "UPDATE billing_payments SET invoice_id=? WHERE external_ref='pi_unrelated'",
    "missing",
    "OFFLINE_CHECKOUT_PAYMENT_REFERENCE_REVIEW",
  ],
  [
    "cross-org payment",
    "UPDATE billing_payments SET org_id=? WHERE external_ref='pi_unrelated'",
    "foreign",
    "OFFLINE_CHECKOUT_PAYMENT_REFERENCE_SCOPE_REQUIRED",
  ],
  [
    "UTF8 field bytes",
    "UPDATE billing_lines SET description=? WHERE invoice_id=?",
    "€".repeat(22000),
    "OFFLINE_CHECKOUT_PAYMENT_REFERENCE_LIMIT",
  ],
  [
    "embedded NUL",
    "UPDATE billing_lines SET description=? WHERE invoice_id=?",
    "private\0value",
    "OFFLINE_CHECKOUT_PAYMENT_REFERENCE_REVIEW",
  ],
] as const)
  test(`global ${name} cannot vanish through selected invoice filters`, async (t) => {
    const f = await setup(t),
      invoiceId = ship(f, accept(f, 1, "other-order").id).invoiceId;
    f.app.database.transaction(() =>
      f.app.billing.verifiedPayment(
        f.actor,
        invoiceId,
        100,
        "stripe",
        "pi_unrelated",
      ),
    );
    f.hold();
    const c = compare(f.input()),
      j = f.join();
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          f.app.database
            .owned("billing")
            .run(
              sql,
              value,
              ...(sql.includes("invoice_id=?") && sql.includes("description")
                ? [invoiceId]
                : []),
            );
          assert.throws(() => j.getInTransaction(f.reviewer, c), { code });
          throw Error("rollback-corruption");
        }),
      /rollback-corruption/,
    );
    assert.ok(captured(run(f, c, j)));
  });
test("fatal SQLite UTF8 and global count exhaustion refuse before candidate work", async (t) => {
  const f = await setup(t);
  f.hold();
  const c = compare(f.input()),
    j = f.join(),
    s = f.app.database.owned("billing");
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        s.run(
          "UPDATE billing_lines SET description=CAST(X'80' AS TEXT) WHERE invoice_id=?",
          f.invoiceId,
        );
        assert.throws(() => j.getInTransaction(f.reviewer, c), {
          code: "OFFLINE_CHECKOUT_PAYMENT_REFERENCE_REVIEW",
        });
        throw Error("rollback-utf8");
      }),
    /rollback-utf8/,
  );
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        for (let i = 0; i < 257; i++)
          s.run(
            "INSERT INTO billing_payments VALUES(?,?,?,?,?,?,?)",
            `payment-${i}`,
            f.actor.orgId,
            f.invoiceId,
            "manual",
            `reference-${i}`,
            1,
            "2026-10-01T00:00:00.000Z",
          );
        assert.throws(() => j.getInTransaction(f.reviewer, c), {
          code: "OFFLINE_CHECKOUT_PAYMENT_REFERENCE_LIMIT",
        });
        throw Error("rollback-count");
      }),
    /rollback-count/,
  );
  assert.ok(captured(run(f, c, j)));
});

async function rich(t: TestContext) {
  const f = await setup(t),
    invoiceId = ship(f, accept(f, 2, "rich-order").id).invoiceId;
  const p = f.app.database.transaction(() =>
    f.app.billing.verifiedPayment(
      f.actor,
      invoiceId,
      20000,
      "stripe",
      "pi_other_rich",
    ),
  );
  const m = f.app.billing.manualPayment(f.actor, "rich-manual", {
    invoiceId,
    amount: 2600,
    reference: "rich-bank",
    reason: "Synthetic payment",
  });
  f.app.billing.issueCredit(f.actor, "rich-credit", {
    invoiceId,
    reference: "rich-credit",
    reason: "Synthetic credit",
    lines: [
      {
        lineId: String(f.app.billing.lines(f.actor, invoiceId)[0]!.id),
        quantity: 2,
      },
    ],
  });
  const request = (paymentId: string, amount: number, reference: string) =>
    f.app.billing.refundRequest(f.actor, reference, {
      invoiceId,
      paymentId,
      amount,
      reference,
      reason: "Synthetic refund",
    }).id;
  const refund = request(p.id, 5000, "rich-refund"),
    sibling = request(p.id, 1000, "rich-sibling"),
    manual = request(m.id, 2000, "rich-manual-refund");
  f.app.billing.manualRefund(f.actor, "rich-proof", {
    refundId: manual,
    reference: "rich-repayment",
    reason: "Synthetic proof",
  });
  f.app.database.transaction(() =>
    f.app.billing.refunds.markUnknown(f.actor, refund),
  );
  for (const status of ["requires_action", "succeeded", "pending"] as const)
    f.app.database.transaction(() => {
      const intent = f.app.billing.refunds.intent(f.actor, refund);
      f.app.billing.refunds.observe(f.actor, intent, "re_other_rich", {
        ...intent,
        status,
      });
    });
  f.app.billing.refunds.alerts.acknowledge(
    f.app.identity.workerActor(f.reviewer.orgId, f.reviewer.id),
    "rich-read",
    { noticeId: refund, revision: 2 },
  );
  f.hold();
  return Object.assign(f, { richInvoice: invoiceId, refund, sibling });
}
test("complete actual sibling credit/refund/provider/notice/read histories are conserved", async (t) => {
  const f = await rich(t),
    s = f.app.database.owned("billing"),
    c = compare(f.input());
  for (const table of [
    "billing_credits",
    "billing_credit_lines",
    "billing_refunds",
    "billing_refund_provider",
    "billing_refund_observations",
    "billing_refund_proofs",
    "billing_refund_alerts",
    "billing_refund_alert_updates",
    "billing_refund_alert_reads",
  ])
    assert.ok(Number(s.get(`SELECT COUNT(*) AS n FROM ${table}`)!.n) > 0);
  const r = run(f, c);
  assert.ok(captured(r));
  assert.ok(!canonical(r).includes("re_other_rich"));
  for (const [name, sql, code] of [
    [
      "mapping collision",
      "UPDATE billing_refund_provider SET external_ref='pi_synthetic'",
      "OFFLINE_CHECKOUT_PAYMENT_REFERENCE_COLLISION",
    ],
    [
      "observation collision",
      "UPDATE billing_refund_observations SET external_ref='pi_synthetic'",
      "OFFLINE_CHECKOUT_PAYMENT_REFERENCE_COLLISION",
    ],
    [
      "proof collision",
      "UPDATE billing_refund_proofs SET external_ref='pi_synthetic'",
      "OFFLINE_CHECKOUT_PAYMENT_REFERENCE_COLLISION",
    ],
    [
      "orphan refund",
      "UPDATE billing_refunds SET payment_id='missing'",
      "OFFLINE_CHECKOUT_PAYMENT_REFERENCE_REVIEW",
    ],
    [
      "orphan update",
      "UPDATE billing_refund_alert_updates SET refund_id='missing'",
      "OFFLINE_CHECKOUT_PAYMENT_REFERENCE_REVIEW",
    ],
    [
      "orphan read",
      "UPDATE billing_refund_alert_reads SET refund_id='missing'",
      "OFFLINE_CHECKOUT_PAYMENT_REFERENCE_REVIEW",
    ],
    [
      "wrong notice invoice",
      "UPDATE billing_refund_alerts SET invoice_id='missing'",
      "OFFLINE_CHECKOUT_PAYMENT_REFERENCE_REVIEW",
    ],
    [
      "oversize update timestamp",
      "UPDATE billing_refund_alert_updates SET created_at=replace(hex(zeroblob(32769)),'0','x')",
      "OFFLINE_CHECKOUT_PAYMENT_REFERENCE_LIMIT",
    ],
  ] as const)
    await t.test(name, () => {
      assert.throws(
        () =>
          f.app.database.transaction(() => {
            s.run(sql);
            assert.throws(() => f.join().getInTransaction(f.reviewer, c), {
              code,
            });
            throw Error("rollback-rich");
          }),
        /rollback-rich/,
      );
      assert.deepEqual(run(f, c), r);
    });
});
test("global aggregate budget, safe integer bound and foreign provider-label collision are not scoped away", async (t) => {
  const f = await setup(t);
  f.hold();
  const c = compare(f.input()),
    j = f.join(),
    s = f.app.database.owned("billing");
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        for (let i = 0; i < 8; i++)
          s.run(
            "INSERT INTO billing_payments VALUES(?,?,?,?,?,?,?)",
            `aggregate-${i}`,
            f.actor.orgId,
            f.invoiceId,
            "manual",
            "é".repeat(30000) + i,
            1,
            "2026-10-01T00:00:00.000Z",
          );
        assert.throws(() => j.getInTransaction(f.reviewer, c), {
          code: "OFFLINE_CHECKOUT_PAYMENT_REFERENCE_LIMIT",
        });
        throw Error("rollback-aggregate");
      }),
    /rollback-aggregate/,
  );
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        s.run(
          "INSERT INTO billing_payments VALUES(?,?,?,?,?,?,?)",
          "foreign-payment",
          "foreign-org",
          f.invoiceId,
          "copied-provider",
          "pi_synthetic",
          1,
          "2026-10-01T00:00:00.000Z",
        );
        assert.throws(() => j.getInTransaction(f.reviewer, c), {
          code: "OFFLINE_CHECKOUT_PAYMENT_REFERENCE_COLLISION",
        });
        throw Error("rollback-foreign");
      }),
    /rollback-foreign/,
  );
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        s.run(
          "INSERT INTO billing_payments VALUES(?,?,?,?,?,?,?)",
          "unsafe",
          f.actor.orgId,
          f.invoiceId,
          "manual",
          "unsafe-reference",
          9007199254740992,
          "2026-10-01T00:00:00.000Z",
        );
        assert.throws(() => j.getInTransaction(f.reviewer, c), {
          code: "OFFLINE_CHECKOUT_PAYMENT_REFERENCE_REVIEW",
        });
        throw Error("rollback-integer");
      }),
    /rollback-integer/,
  );
  assert.ok(captured(run(f, c, j)));
});

test("more than one normal history page is captured; changing an early retained payment changes the complete facts hash", async (t) => {
  const f = await setup(t),
    invoiceId = ship(f, accept(f, 1, "page-order").id).invoiceId;
  const payments = [];
  for (let i = 0; i < 40; i++)
    payments.push(
      f.app.database.transaction(() =>
        f.app.billing.verifiedPayment(
          f.actor,
          invoiceId,
          1,
          "stripe",
          `pi_history_${i}`,
        ),
      ),
    );
  f.hold();
  const c = compare(f.input()),
    before = run(f, c);
  f.app.database
    .owned("billing")
    .run("UPDATE billing_payments SET amount=2 WHERE id=?", payments[0]!.id);
  assert.throws(() => run(f, c));
  const after = run(f, compare(f.input()));
  assert.notEqual(after.factsHash, before.factsHash);
  assert.ok(!canonical(after).includes("pi_history_0"));
});
test("finance with a current customer scope never receives a global reference receipt", async (t) => {
  const f = await setup(t);
  f.hold();
  const c = compare(f.input());
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_users SET account_id=? WHERE id=?",
      f.buyer,
      f.reviewer.id,
    );
  assert.throws(() => run(f, c), { code: "FORBIDDEN" });
});
