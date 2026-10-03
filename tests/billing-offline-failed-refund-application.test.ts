import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { fixture, accept, ship } from "./fixtures.ts";
import { canonical, type Actor } from "../src/server/core.ts";
import { Store } from "../src/server/database.ts";
import type {
  OfflineFailedRefundTuple,
  OfflineFailedRefundApplicationReceipt,
} from "../src/server/billing-refunds.ts";
import { Application } from "../src/server/application.ts";

function setup(
  t: TestContext,
  region: "CA" | "US" = "CA",
  currency: "CAD" | "USD" = "CAD",
) {
  const f = fixture(t, {}, region, currency),
    invoiceId = ship(f, accept(f, 2).id).invoiceId;
  const payment = f.app.database.transaction(() =>
    f.app.billing.verifiedPayment(
      f.actor,
      invoiceId,
      22600,
      "stripe",
      "pi_offline_original",
    ),
  );
  const credit = f.app.billing.issueCredit(f.actor, "credit", {
    invoiceId,
    reference: "SYNTHETIC-CREDIT",
    reason: "Synthetic native full credit",
    lines: [
      {
        lineId: String(f.app.billing.lines(f.actor, invoiceId)[0]!.id),
        quantity: 2,
      },
    ],
  });
  const request = (reference: string, amount: number) =>
    f.app.billing.refundRequest(f.actor, reference, {
      invoiceId,
      paymentId: payment.id,
      amount,
      reference,
      reason: "Synthetic refund",
    }).id;
  const refundId = request("target", 5000),
    siblingId = request("sibling", 1000);
  f.app.database.transaction(() =>
    f.app.billing.refunds.markUnknown(f.actor, refundId),
  );
  const { id } = f.app.identity.createUser(f.actor, "finance", {
    email: "finance@example.test",
    name: "Native finance",
    role: "finance",
    sites: [],
    password: "synthetic-long-finance-password",
  });
  const finance = f.app.identity.currentActor({ ...f.actor, id });
  const tuple: OfflineFailedRefundTuple = {
    ...f.app.billing.refunds.intent(finance, refundId),
    externalReference: "re_offline_failed",
    status: "failed",
    currency: currency.toLowerCase() as "cad" | "usd",
  };
  return Object.assign(f, {
    finance,
    refundId,
    siblingId,
    paymentId: payment.id,
    creditId: credit.id,
    invoiceId,
    tuple,
  });
}
type Fixture = ReturnType<typeof setup>;
function review(f: Fixture) {
  return f.app.database.transaction(() =>
    f.app.billing.refunds.reviewOfflineFailedRefundInTransaction(
      f.finance,
      f.refundId,
    ),
  );
}
function direct(
  f: Fixture,
  hash: string,
  tuple: unknown = f.tuple,
  actor: Actor = f.finance,
) {
  return f.app.billing.refunds.applyOfflineFailedRefundInTransaction(
    actor,
    f.refundId,
    hash,
    tuple as OfflineFailedRefundTuple,
  );
}
function apply(
  f: Fixture,
  hash = review(f).factsHash,
  tuple: unknown = f.tuple,
  actor = f.finance,
) {
  return f.app.database.transaction(() => direct(f, hash, tuple, actor));
}
function snapshot(f: Fixture) {
  return canonical(
    ["billing", "platform", "integration", "inventory", "orders"].map(
      (owner) => {
        const store = f.app.database.owned(owner as "billing");
        return store
          .all<{ name: string }>(
            "SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE ? ORDER BY name",
            `${owner}_%`,
          )
          .map(({ name }) => [
            name,
            store.all(`SELECT * FROM ${name} ORDER BY rowid`),
          ]);
      },
    ),
  );
}
function rollback(f: Fixture, action: () => void) {
  const stop = new Error("fixture rollback");
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        action();
        throw stop;
      }),
    (e) => e === stop,
  );
}
function b(f: Fixture) {
  return f.app.database.owned("billing");
}
function immutableMoney(f: Fixture) {
  return canonical(
    ["invoices", "lines", "payments", "credits", "credit_lines"].map((table) =>
      b(f).all(`SELECT * FROM billing_${table} ORDER BY rowid`),
    ),
  );
}
for (const [region, currency] of [
  ["CA", "CAD"],
  ["CA", "USD"],
  ["US", "USD"],
] as const)
  test(`exact first failed observation/notice receipt and conservation ${region}/${currency}`, (t) => {
    const f = setup(t, region, currency),
      money = immutableMoney(f),
      r = review(f);
    const totals = f.app.billing.totals(f.finance, f.invoiceId);
    // Older sibling history establishes that IDs cannot be guessed as 1/latest.
    f.app.database.transaction(() => {
      const intent = f.app.billing.refunds.intent(f.finance, f.siblingId);
      assert.equal(
        f.app.billing.refunds.observe(f.finance, intent, "re_sibling", {
          ...intent,
          status: "failed",
        }),
        "failed",
      );
    });
    assert.throws(() => apply(f, r.factsHash), {
      code: "OFFLINE_REFUND_STALE",
    });
    const fresh = review(f),
      result: OfflineFailedRefundApplicationReceipt = apply(f, fresh.factsHash);
    const observation = b(f).get<{
      id: number;
      applied: number;
      status: string;
    }>(
      "SELECT id,applied,status FROM billing_refund_observations WHERE refund_id=?",
      f.refundId,
    )!;
    const notice = b(f).get<{ seq: number; revision: number }>(
      "SELECT seq,revision FROM billing_refund_alerts WHERE refund_id=?",
      f.refundId,
    )!;
    assert.deepEqual(result, {
      version: 1,
      refundId: f.refundId,
      observationId: observation.id,
      applied: true,
      state: "rejected",
      status: "failed",
      noticeId: f.refundId,
      noticeSequence: notice.seq,
      noticeRevision: notice.revision,
      noticeStatus: "failed",
      noticeState: "open",
    });
    assert(observation.id > 1);
    assert(notice.seq > 1);
    assert.equal(observation.applied, 1);
    assert.equal(notice.revision, 1);
    assert.equal(
      b(f).get("SELECT state FROM billing_refunds WHERE id=?", f.refundId)!
        .state,
      "rejected",
    );
    assert.equal(immutableMoney(f), money);
    assert.deepEqual(f.app.billing.totals(f.finance, f.invoiceId), totals);
    const invoice = f.app.billing.invoice(f.finance, f.invoiceId);
    assert.equal(invoice.currency, currency);
    const audits = f.app.database
      .owned("platform")
      .all<{ actor_id: string; action: string; detail: string }>(
        "SELECT actor_id,action,detail FROM platform_audit WHERE reference=? AND action IN('billing.refund.observed','billing.refund.notice') ORDER BY action",
        f.refundId,
      );
    assert.deepEqual(
      audits.map((a) => [a.actor_id, a.action, JSON.parse(a.detail)]),
      [
        [
          f.finance.id,
          "billing.refund.notice",
          { revision: 1, status: "failed", state: "open" },
        ],
        [
          f.finance.id,
          "billing.refund.observed",
          {
            reference: f.tuple.externalReference,
            status: "failed",
            applied: true,
          },
        ],
      ],
    );
    assert(Object.isFrozen(result));
    assert.throws(() => {
      (result as { noticeRevision: number }).noticeRevision = 2;
    }, TypeError);
    const after = snapshot(f);
    assert.throws(() => apply(f, fresh.factsHash), {
      code: "OFFLINE_REFUND_REVIEW",
    });
    assert.equal(snapshot(f), after);
  });

test("actual writer required; exact primitive ID/hash validated before writes", (t) => {
  const f = setup(t),
    hash = review(f).factsHash,
    before = snapshot(f);
  assert.throws(() => direct(f, hash), { code: "TRANSACTION" });
  for (const bad of [
    "",
    "A".repeat(64),
    "a".repeat(63),
    "a".repeat(100000),
    {},
    null,
  ])
    assert.throws(() => apply(f, bad as string), {
      code: "OFFLINE_REFUND_INPUT",
    });
  for (const id of ["", " target ", "a".repeat(129), {}, null, "x\0y"])
    assert.throws(
      () =>
        f.app.database.transaction(() =>
          f.app.billing.refunds.applyOfflineFailedRefundInTransaction(
            f.finance,
            id as string,
            hash,
            f.tuple,
          ),
        ),
      { code: "OFFLINE_REFUND_INPUT" },
    );
  assert.equal(snapshot(f), before);
});

test("fresh native role/password/staff/org/active authority defeats caller assertions", (t) => {
  const f = setup(t),
    hash = review(f).factsHash,
    iam = f.app.database.owned("iam");
  for (const sql of [
    "UPDATE iam_users SET role='support' WHERE id=?",
    "UPDATE iam_users SET role='warehouse' WHERE id=?",
    "UPDATE iam_users SET active=0 WHERE id=?",
    "UPDATE iam_users SET org_id='other' WHERE id=?",
    "UPDATE iam_users SET account_id='attached-account' WHERE id=?",
    "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
  ])
    rollback(f, () => {
      iam.run(sql, f.finance.id);
      const before = snapshot(f);
      assert.throws(
        () =>
          direct(f, hash, f.tuple, {
            ...f.finance,
            role: "admin",
            accountId: null,
          }),
        {
          code: sql.includes("password_change_required")
            ? "PASSWORD_CHANGE_REQUIRED"
            : "FORBIDDEN",
        },
      );
      assert.equal(snapshot(f), before);
    });
  assert.throws(
    () => apply(f, hash, f.tuple, { ...f.finance, orgId: "other" }),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () => apply(f, hash, f.tuple, { ...f.finance, id: "unknown" }),
    { code: "FORBIDDEN" },
  );
  rollback(f, () => {
    b(f).run(
      "UPDATE billing_refunds SET org_id='other' WHERE id=?",
      f.refundId,
    );
    assert.throws(() => direct(f, hash), { code: "NOT_FOUND" });
  });
});

test("same writer fresh review detects capacity drift and changed native intent", (t) => {
  const f = setup(t),
    hash = review(f).factsHash;
  for (const [sql, params] of [
    ["UPDATE billing_refunds SET amount=amount+1 WHERE id=?", [f.refundId]],
    ["UPDATE billing_refunds SET reference='changed' WHERE id=?", [f.refundId]],
    [
      "UPDATE billing_payments SET external_ref='pi_changed' WHERE id=?",
      [f.paymentId],
    ],
    ["UPDATE billing_refunds SET amount=amount+1 WHERE id=?", [f.siblingId]],
  ] as [string, string[]][])
    rollback(f, () => {
      b(f).run(sql, ...params);
      const before = snapshot(f);
      assert.throws(() => direct(f, hash), { code: "OFFLINE_REFUND_STALE" });
      assert.equal(snapshot(f), before);
    });
  rollback(f, () => {
    b(f).run("UPDATE billing_refunds SET amount=5001 WHERE id=?", f.refundId);
    const changed =
      f.app.billing.refunds.reviewOfflineFailedRefundInTransaction(
        f.finance,
        f.refundId,
      );
    assert.throws(() => direct(f, changed.factsHash), {
      code: "REFUND_MISMATCH",
    });
  });
  for (const [field, value] of [
    ["refundId", f.siblingId],
    ["invoiceId", "different"],
    ["paymentId", "pi_other"],
    ["paymentAmount", 22601],
    ["amount", 5001],
    ["currency", "usd"],
  ]) {
    const before = snapshot(f);
    assert.throws(() => apply(f, hash, { ...f.tuple, [field!]: value }), {
      code: "REFUND_MISMATCH",
    });
    assert.equal(snapshot(f), before);
  }
});

test("prior coherent pending/requires-action provider history is not first import", (t) => {
  for (const status of ["pending", "requires_action"] as const) {
    const f = setup(t);
    f.app.database.transaction(() =>
      f.app.billing.refunds.observe(
        f.finance,
        f.app.billing.refunds.intent(f.finance, f.refundId),
        "re_prior",
        { ...f.tuple, status },
      ),
    );
    const hash = review(f).factsHash,
      before = snapshot(f);
    assert.throws(() => apply(f, hash), { code: "OFFLINE_REFUND_HISTORY" });
    assert.equal(snapshot(f), before);
  }
});

test("corrupt proof, copied cross-org notice/observation and unsupported pending state refuse", (t) => {
  const f = setup(t),
    hash = review(f).factsHash;
  const changes = [
    () =>
      b(f).run(
        "INSERT INTO billing_refund_proofs VALUES(?,?,?,?)",
        f.actor.orgId,
        "manual-proof",
        f.refundId,
        new Date().toISOString(),
      ),
    () =>
      b(f).run(
        "INSERT INTO billing_refund_observations(org_id,refund_id,external_ref,status,applied,created_at) VALUES(?,?,?,'failed',1,?)",
        "foreign",
        f.refundId,
        "re_copied",
        new Date().toISOString(),
      ),
    () =>
      b(f).run(
        "INSERT INTO billing_refund_alerts(org_id,refund_id,invoice_id,status,state,revision,created_at,updated_at) VALUES(?,?,?,'failed','open',1,?,?)",
        "foreign",
        f.refundId,
        f.invoiceId,
        new Date().toISOString(),
        new Date().toISOString(),
      ),
    () =>
      b(f).run(
        "UPDATE billing_refunds SET state='pending' WHERE id=?",
        f.refundId,
      ),
  ];
  for (const change of changes)
    rollback(f, () => {
      change();
      const before = snapshot(f);
      assert.throws(() => direct(f, hash), { code: "OFFLINE_REFUND_REVIEW" });
      assert.equal(snapshot(f), before);
    });
});

test("retained external identity collisions outside reviewed invoice refuse without newest guesses", (t) => {
  const f = setup(t),
    hash = review(f).factsHash;
  for (const sql of [
    "INSERT INTO billing_refund_provider VALUES('outside-invoice',?,?,'failed')",
    "INSERT INTO billing_refund_observations(org_id,refund_id,external_ref,status,applied,created_at) VALUES(?,'outside-invoice',?,'failed',1,'2026-10-03T00:00:00.000Z')",
    "INSERT INTO billing_refund_proofs VALUES(?,?,'outside-invoice','2026-10-03T00:00:00.000Z')",
  ])
    rollback(f, () => {
      b(f).run(sql, f.actor.orgId, f.tuple.externalReference);
      const before = snapshot(f);
      assert.throws(() => direct(f, hash), { code: "REFUND_MISMATCH" });
      assert.equal(snapshot(f), before);
    });
});

test("strict tuple rejects malformed resources, descriptors, symbols, cycles and prototypes before observe", (t) => {
  const f = setup(t),
    hash = review(f).factsHash,
    before = snapshot(f);
  let invoked = 0,
    getters = 0;
  t.mock.method(f.app.billing.refunds, "observe", () => {
    invoked++;
    throw Error("unexpected observe");
  });
  const accessor = { ...f.tuple };
  Object.defineProperty(accessor, "amount", {
    enumerable: true,
    get: () => {
      getters++;
      return 5000;
    },
  });
  const hidden = { ...f.tuple };
  Object.defineProperty(hidden, "amount", { value: 5000, enumerable: false });
  const symbol = { ...f.tuple, [Symbol("extra")]: 1 };
  const cyclic: Record<string, unknown> = { ...f.tuple };
  cyclic.amount = cyclic;
  const bad: unknown[] = [
    null,
    1,
    [],
    "failed",
    accessor,
    hidden,
    symbol,
    cyclic,
    Object.assign(new Date(), f.tuple),
    Object.assign(Object.create({}), f.tuple),
    { ...f.tuple, extra: true },
    { ...f.tuple, amount: NaN },
    { ...f.tuple, amount: Infinity },
    { ...f.tuple, amount: 0 },
    { ...f.tuple, amount: 1.1 },
    { ...f.tuple, amount: "5000" },
    { ...f.tuple, paymentAmount: Number.MAX_SAFE_INTEGER },
    { ...f.tuple, paymentAmount: 1 },
    { ...f.tuple, currency: "CAD" },
    { ...f.tuple, status: "succeeded" },
    { ...f.tuple, externalReference: "re_bad space" },
    { ...f.tuple, externalReference: "re_" },
    { ...f.tuple, paymentId: "pi_" },
    { ...f.tuple, externalReference: "re_" + "x".repeat(158) },
    { ...f.tuple, refundId: "é".repeat(65) },
    { ...f.tuple, invoiceId: "x".repeat(100000) },
    { ...f.tuple, amount: 1n },
    { ...f.tuple, amount: Symbol("amount") },
    { ...f.tuple, refundId: "x\0y" },
    Object.fromEntries(
      Array.from({ length: 1001 }, (_, i) => [`extra${i}`, i]),
    ),
  ];
  for (const value of bad)
    assert.throws(() => apply(f, hash, value), {
      code: "OFFLINE_REFUND_INPUT",
    });
  assert.equal(getters, 0);
  assert.equal(invoked, 0);
  assert.equal(snapshot(f), before);
});

test("normal/revoked proxies and proxied tuple values execute zero traps", (t) => {
  const f = setup(t),
    hash = review(f).factsHash,
    before = snapshot(f);
  let traps = 0;
  const handler = new Proxy(
    {},
    {
      get: () => () => {
        traps++;
        throw Error("proxy trap");
      },
    },
  );
  const proxy = new Proxy({ ...f.tuple }, handler),
    revoked = Proxy.revocable({ ...f.tuple }, handler);
  revoked.revoke();
  for (const value of [
    proxy,
    revoked.proxy,
    { ...f.tuple, amount: proxy },
    { ...f.tuple, paymentId: revoked.proxy },
  ])
    assert.throws(() => apply(f, hash, value), {
      code: "OFFLINE_REFUND_INPUT",
    });
  assert.equal(traps, 0);
  assert.equal(snapshot(f), before);
});

test("detached captured tuple survives caller mutation at native observe boundary", (t) => {
  const f = setup(t),
    hash = review(f).factsHash;
  const input = { ...f.tuple },
    original = f.app.billing.refunds.observe.bind(f.app.billing.refunds);
  t.mock.method(
    f.app.billing.refunds,
    "observe",
    (...args: Parameters<typeof original>) => {
      input.amount = 99;
      input.externalReference = "re_mutated";
      assert(Object.isFrozen(args[3]));
      assert.equal(args[3].amount, 5000);
      return original(...args);
    },
  );
  const result = apply(f, hash, input);
  assert.equal(result.refundId, f.refundId);
  assert.equal(
    b(f).get(
      "SELECT external_ref FROM billing_refund_provider WHERE refund_id=?",
      f.refundId,
    )!.external_ref,
    "re_offline_failed",
  );
});

for (const failure of [
  "owner-write",
  "notice-audit",
  "observed-audit",
  "missing-notice",
  "extra-observation",
] as const)
  test(`${failure} rolls back exact native transition through the required outer writer abort`, (t) => {
    const f = setup(t),
      hash = review(f).factsHash,
      before = snapshot(f);
    const run = Store.prototype.run,
      audit = f.app.platform.audit.bind(f.app.platform),
      observe = f.app.billing.refunds.observe.bind(f.app.billing.refunds);
    if (failure === "owner-write")
      t.mock.method(
        Store.prototype,
        "run",
        function (
          this: Store,
          sql: string,
          ...args: Parameters<Store["run"]> extends [string, ...infer P]
            ? P
            : never
        ) {
          if (sql.startsWith("UPDATE billing_refunds SET state=?"))
            throw Error("synthetic owner write fault");
          return run.call(this, sql, ...args);
        },
      );
    if (failure.endsWith("audit"))
      t.mock.method(
        f.app.platform,
        "audit",
        (...args: Parameters<typeof audit>) => {
          if (
            args[1] ===
            (failure === "notice-audit"
              ? "billing.refund.notice"
              : "billing.refund.observed")
          )
            throw Error("synthetic audit fault");
          return audit(...args);
        },
      );
    if (failure === "missing-notice")
      t.mock.method(f.app.billing.refunds.alerts, "observe", () => {});
    if (failure === "extra-observation")
      t.mock.method(
        f.app.billing.refunds,
        "observe",
        (...args: Parameters<typeof observe>) => {
          const status = observe(...args);
          observe(...args);
          return status;
        },
      );
    assert.throws(
      () => apply(f, hash),
      failure === "missing-notice" || failure === "extra-observation"
        ? { code: "OFFLINE_REFUND_APPLICATION" }
        : /synthetic.*fault/,
    );
    assert.equal(snapshot(f), before);
    assert.equal(review(f).factsHash, hash);
  });

test("outer transaction rollback and restart preserve first-import state and duplicate refusal", (t) => {
  const f = setup(t),
    hash = review(f).factsHash,
    before = snapshot(f);
  rollback(f, () => {
    direct(f, hash);
  });
  assert.equal(snapshot(f), before);
  f.app.close();
  f.app = new Application(f.path);
  const result = apply(f, hash);
  f.app.close();
  f.app = new Application(f.path);
  const after = snapshot(f);
  assert.throws(() => apply(f, hash), { code: "OFFLINE_REFUND_REVIEW" });
  assert.equal(snapshot(f), after);
  assert.equal(
    b(f).get(
      "SELECT id FROM billing_refund_observations WHERE refund_id=?",
      f.refundId,
    )!.id,
    result.observationId,
  );
});

test("held store keeps provider refusal; narrow operation creates no Integration effects or command receipts", (t) => {
  const f = setup(t);
  f.app.platform.isolateRestore(
    "synthetic-held-refund",
    new Date().toISOString(),
  );
  const effects = f.app.database
    .owned("integration")
    .all("SELECT * FROM integration_effects");
  const commands = f.app.database
    .owned("platform")
    .all("SELECT * FROM platform_commands");
  apply(f);
  assert(f.app.platform.recoveryHold());
  assert.throws(() => f.app.platform.assertProviderAccess(), {
    code: "RECOVERY_HOLD",
  });
  assert.deepEqual(
    f.app.database
      .owned("integration")
      .all("SELECT * FROM integration_effects"),
    effects,
  );
  assert.deepEqual(
    f.app.database.owned("platform").all("SELECT * FROM platform_commands"),
    commands,
  );
});

test("complete native review byte/count limits reject before native mutation", (t) => {
  const f = setup(t),
    hash = review(f).factsHash;
  let calls = 0;
  t.mock.method(f.app.billing.refunds, "observe", () => {
    calls++;
    throw Error("unexpected native write");
  });
  rollback(f, () => {
    b(f).run(
      "UPDATE billing_refunds SET reference=? WHERE id=?",
      "é".repeat(524289),
      f.refundId,
    );
    const before = snapshot(f);
    assert.throws(() => direct(f, hash), {
      code: "OFFLINE_REFUND_REVIEW_LIMIT",
    });
    assert.equal(snapshot(f), before);
  });
  rollback(f, () => {
    for (let i = 0; i < 1001; i++)
      b(f).run(
        "INSERT INTO billing_refund_observations(org_id,refund_id,external_ref,status,applied,created_at) VALUES(?,?,'re_prior','pending',1,'2026-10-03T00:00:00.000Z')",
        f.actor.orgId,
        f.refundId,
      );
    const before = snapshot(f);
    assert.throws(() => direct(f, hash), {
      code: "OFFLINE_REFUND_REVIEW_LIMIT",
    });
    assert.equal(snapshot(f), before);
  });
  assert.equal(calls, 0);
});

test("strict capture supports plain null-prototype records and exact maximum provider identity", (t) => {
  const f = setup(t),
    tuple = Object.assign(Object.create(null), f.tuple, {
      externalReference: "re_" + "x".repeat(157),
    });
  const result = apply(f, review(f).factsHash, tuple);
  assert.equal(result.noticeRevision, 1);
  assert.equal(
    b(f).get(
      "SELECT external_ref FROM billing_refund_provider WHERE refund_id=?",
      f.refundId,
    )!.external_ref,
    tuple.externalReference,
  );
});
