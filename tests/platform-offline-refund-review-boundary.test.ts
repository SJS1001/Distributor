import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture, accept, ship, chooseProviders } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { Store } from "../src/server/database.ts";
import { canonical, digest } from "../src/server/core.ts";
import { platformOfflineRefundReviewLimits as limits } from "../src/server/platform-offline-refund-review.ts";

function setup(
  t: Parameters<typeof fixture>[0],
  region: "CA" | "US" = "CA",
  currency: "CAD" | "USD" = region === "CA" ? "CAD" : "USD",
) {
  const f = fixture(t, {}, region, currency);
  const invoiceId = ship(f, accept(f, 1).id).invoiceId;
  const payment = f.app.database.transaction(() =>
    f.app.billing.verifiedPayment(
      f.actor,
      invoiceId,
      11300,
      "stripe",
      "pi_synthetic",
    ),
  );
  f.app.billing.issueCredit(f.actor, "credit", {
    invoiceId,
    reference: "CREDIT",
    reason: "Synthetic full credit",
    lines: [
      {
        lineId: String(f.app.billing.lines(f.actor, invoiceId)[0]!.id),
        quantity: 1,
      },
    ],
  });
  const input = {
    invoiceId,
    paymentId: payment.id,
    amount: 3000,
    reference: "REFUND",
    reason: "Synthetic refund",
  };
  const refundId = f.app.billing.refundRequest(f.actor, "original", input).id;
  chooseProviders(f, f.actor, "choice", {
    accountId: f.buyer,
    region,
    mode: "provider-exceptions",
    providers: ["stripe"],
    version: 1,
    acknowledgment: "Synthetic consent",
  });
  const effectId = f.app.integration.refund(f.actor, "queue-one", {
    refundId,
  }).id;
  const user = f.app.identity.createUser(f.actor, "reader", {
    email: "finance@synthetic.test",
    name: "Finance reader",
    role: "finance",
    sites: [f.w1],
    password: "long-synthetic-password",
  });
  const finance = f.app.identity.currentActor({ ...f.actor, id: user.id });
  const reader = f.app.platformOfflineRefundReview;
  const read = (
    actor = finance,
    refund: string = refundId,
    effect: string = effectId,
  ) =>
    f.app.database.transaction(() =>
      f.app.platformOfflineRefundReview.getInTransaction(actor, refund, effect),
    );
  return Object.assign(f, {
    input,
    invoiceId,
    refundId,
    effectId,
    finance,
    reader,
    read,
  });
}
function fingerprint(f: ReturnType<typeof setup>) {
  const p = f.app.database.owned("platform");
  return canonical({
    commands: p.all(
      "SELECT * FROM platform_commands ORDER BY org_id,actor_id,name,key",
    ),
    audit: p.all("SELECT * FROM platform_audit ORDER BY id"),
    order: p.all("SELECT * FROM platform_audit_order ORDER BY sequence"),
    clock: p.all("SELECT * FROM platform_audit_clock"),
    hold: p.all("SELECT * FROM platform_recovery"),
    refunds: f.app.database
      .owned("billing")
      .all("SELECT * FROM billing_refunds ORDER BY id"),
    effects: f.app.database
      .owned("integration")
      .all("SELECT * FROM integration_effects ORDER BY id"),
  });
}
const integrity = { code: "RESTORE_RECEIPT_INTEGRITY" };
type Fixture = ReturnType<typeof setup>;
const stamp = "2026-10-03T00:00:00.000Z";

// Explicit Platform-owner fixture mutation. No authorizer or reader is replaced.
function pair(
  f: Fixture,
  key: string,
  result = '{"id":"unrelated","state":"pending"}',
) {
  const p = f.app.database.owned("platform");
  const hash = digest(canonical({ refundId: "unrelated" }));
  p.run(
    "INSERT INTO platform_commands VALUES(?,?,?,?,?,?,?)",
    f.actor.orgId,
    f.actor.id,
    "stripe.refund",
    key,
    hash,
    result,
    stamp,
  );
  f.app.platform.audit(f.actor, "stripe.refund", key, { requestHash: hash });
}

test("composed reader refreshes an already used copied admin and password requirement before any retained allocation", (t) => {
  const f = setup(t),
    iam = f.app.database.owned("iam");
  const copied = {
    ...f.finance,
    role: "admin" as const,
    sites: [],
    accountId: null,
  };
  const before = fingerprint(f);
  const all = t.mock.method(Store.prototype, "all");
  {
    assert.equal(f.read(copied).queues.length, 1);
    for (const column of ["role", "account_id", "active"] as const) {
      assert.throws(
        () =>
          f.app.database.transaction(() => {
            assert.equal(
              f.reader.getInTransaction(copied, f.refundId, f.effectId).queues
                .length,
              1,
            );
            const value =
              column === "role"
                ? "warehouse"
                : column === "account_id"
                  ? f.buyer
                  : 0;
            iam.run(
              `UPDATE iam_users SET ${column}=? WHERE id=?`,
              value,
              f.finance.id,
            );
            all.mock.resetCalls();
            f.reader.getInTransaction(copied, f.refundId, f.effectId);
          }),
        { code: "FORBIDDEN" },
      );
      assert.equal(
        all.mock.calls.filter((c) =>
          /platform_(commands|audit)/.test(String(c.arguments[0])),
        ).length,
        0,
      );
    }
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          iam.run("UPDATE iam_users SET role='admin' WHERE id=?", f.finance.id);
          assert.equal(
            iam.run(
              "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
              f.finance.id,
            ).changes,
            1,
          );
          all.mock.resetCalls();
          f.reader.getInTransaction(copied, f.refundId, f.effectId);
        }),
      { code: "PASSWORD_CHANGE_REQUIRED" },
    );
    assert.equal(
      all.mock.calls.filter((c) =>
        /platform_(commands|audit)/.test(String(c.arguments[0])),
      ).length,
      0,
    );
  }
  assert.equal(fingerprint(f), before);
});

for (const [region, currency] of [
  ["CA", "CAD"],
  ["CA", "USD"],
  ["US", "USD"],
] as const)
  test(`${region}/${currency}: native queue retains every state and replay keeps original pending bytes`, (t) => {
    const f = setup(t, region, currency);
    for (const state of [
      "running",
      "unknown",
      "completed",
      "rejected",
      "blocked",
    ] as const) {
      f.app.database
        .owned("integration")
        .run(
          "UPDATE integration_effects SET state=? WHERE id=?",
          state,
          f.effectId,
        );
      assert.equal(
        f.app.integration.refund(f.finance, `attempt-${state}`, {
          refundId: f.refundId,
        }).state,
        state,
      );
    }
    const before = fingerprint(f);
    assert.equal(
      f.app.integration.refund(f.actor, "queue-one", { refundId: f.refundId })
        .state,
      "pending",
    );
    assert.equal(fingerprint(f), before);
    const result = f.read();
    assert.deepEqual(result.queues.map((q) => q.result.state).sort(), [
      "blocked",
      "completed",
      "pending",
      "rejected",
      "running",
      "unknown",
    ]);
    assert.equal(new Set(result.queues.map((q) => q.audit.id)).size, 6);
    assert.equal(new Set(result.queues.map((q) => q.audit.sequence)).size, 6);
    assert.equal(result.history.commands, 7);
    assert.equal(result.history.audits, 7);
    assert.equal(fingerprint(f), before);
  });

test("properly paired unrelated malformed results refuse; a valid unrelated control succeeds", (t) => {
  const f = setup(t),
    before = fingerprint(f);
  for (const result of [
    '{"id":"unrelated","state":"succeeded"}',
    '{"state":"pending","id":"unrelated","__proto__":{}}',
    '{"id":"unrelated","state":"pending","id":"other"}',
    '[{"id":"unrelated","state":"pending"}]',
    '{"id":"unrelated","state":null}',
    '{"id":"unrelated","state":"pending"}\u0000',
  ]) {
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          pair(f, "paired-unrelated", result);
          f.reader.getInTransaction(f.finance, f.refundId, f.effectId);
        }),
      integrity,
    );
    assert.equal(fingerprint(f), before);
  }
  f.app.database.transaction(() => pair(f, "valid-unrelated"));
  const r = f.read();
  assert.equal(r.history.commands, 3);
  assert.equal(r.queues.length, 1);
});

test("same-time audits preserve sequence, Unicode key distinctions and native late rollback", (t) => {
  const f = setup(t),
    p = f.app.database.owned("platform"),
    first = f.read();
  for (const key of ["é", "e\u0301", "a|b", "a,b"])
    f.app.integration.refund(f.finance, key, { refundId: f.refundId });
  p.run(
    "UPDATE platform_audit SET created_at=? WHERE action='stripe.refund'",
    stamp,
  );
  p.run(
    "UPDATE platform_commands SET created_at=? WHERE name='stripe.refund'",
    stamp,
  );
  const retained = f.read(),
    before = fingerprint(f);
  const q = retained.queues.filter((q) => q.actorId === f.finance.id);
  assert.equal(q.length, 4);
  assert.equal(new Set(q.map((q) => q.key)).size, 4);
  assert.deepEqual(
    [...q]
      .sort((a, b) => a.audit.sequence - b.audit.sequence)
      .map((q) => q.key),
    ["é", "e\u0301", "a|b", "a,b"],
  );
  const originalAudit = f.app.platform.audit.bind(f.app.platform);
  const audit = t.mock.method(
    f.app.platform,
    "audit",
    (...args: Parameters<typeof originalAudit>) => {
      originalAudit(...args);
      if (args[2] === "rolled-back-native") {
        const inside = f.reader.getInTransaction(
          f.finance,
          f.refundId,
          f.effectId,
        );
        assert.equal(inside.queues.length, 6);
        assert.notEqual(inside.history.hash, retained.history.hash);
        throw new Error("late synthetic coordinator refusal");
      }
    },
  );
  try {
    assert.throws(
      () =>
        f.app.integration.refund(f.finance, "rolled-back-native", {
          refundId: f.refundId,
        }),
      /late synthetic coordinator refusal/,
    );
  } finally {
    audit.mock.restore();
  }
  assert.equal(fingerprint(f), before);
  assert.deepEqual(f.read(), retained);
  assert.equal(first.queues.length, 1);
  f.app.close();
  f.app = new Application(f.path, "CA");
  assert.deepEqual(f.read(), retained);
  assert.notStrictEqual(f.read().queues[0], retained.queues[0]);
});

test("unrelated raw history changes bind hashes even when selected receipts are unchanged", (t) => {
  const f = setup(t),
    p = f.app.database.owned("platform");
  pair(f, "unrelated-history");
  const first = f.read();
  p.run(
    "UPDATE platform_commands SET created_at=? WHERE key='unrelated-history'",
    "2026-10-03T00:00:00.001Z",
  );
  const second = f.read();
  assert.deepEqual(second.requests, first.requests);
  assert.deepEqual(second.queues, first.queues);
  assert.notEqual(second.history.hash, first.history.hash);
  assert.notEqual(second.factsHash, first.factsHash);
  assert.ok(Object.isFrozen(second.history));
  assert.ok(Object.isFrozen(second.queues[0]!.audit));
});

test("one-sided missing histories are explicit local absence, never repaired or conflated", (t) => {
  const f = setup(t),
    p = f.app.database.owned("platform"),
    before = fingerprint(f);
  for (const command of ["billing.refund.request", "stripe.refund"]) {
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          p.run(
            "DELETE FROM platform_audit_order WHERE audit_id IN(SELECT id FROM platform_audit WHERE action=?)",
            command,
          );
          p.run("DELETE FROM platform_audit WHERE action=?", command);
          p.run("DELETE FROM platform_commands WHERE name=?", command);
          const r = f.reader.getInTransaction(
            f.finance,
            f.refundId,
            f.effectId,
          );
          assert.equal(
            r.requests.length,
            command === "billing.refund.request" ? 0 : 1,
          );
          assert.equal(r.queues.length, command === "stripe.refund" ? 0 : 1);
          assert.equal(r.history.commands, 1);
          assert.equal(r.history.audits, 1);
          throw new Error("rollback synthetic missing history");
        }),
      /rollback synthetic missing history/,
    );
    assert.equal(fingerprint(f), before);
  }
});

test("NUL/Unicode bytes in every large retained linkage field refuse before either result set materializes", (t) => {
  const f = setup(t),
    p = f.app.database.owned("platform"),
    before = fingerprint(f);
  const all = t.mock.method(Store.prototype, "all"),
    parse = t.mock.method(JSON, "parse");
  const large = "budget-marker\u0000" + "😀".repeat(17000);
  assert.ok(Buffer.byteLength(large) > limits.rowBytes);
  for (const [table, column, where] of [
    ["platform_commands", "key", "name='stripe.refund'"],
    ["platform_commands", "result", "name='stripe.refund'"],
    ["platform_audit", "reference", "action='stripe.refund'"],
    ["platform_audit", "detail", "action='stripe.refund'"],
    [
      "platform_audit_order",
      "org_id",
      "audit_id IN(SELECT id FROM platform_audit WHERE action='stripe.refund')",
    ],
  ]) {
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          // This list is fixed test-owner SQL, never production caller SQL.
          p.run(`UPDATE ${table} SET ${column}=? WHERE ${where}`, large);
          all.mock.resetCalls();
          parse.mock.resetCalls();
          f.reader.getInTransaction(f.finance, f.refundId, f.effectId);
        }),
      integrity,
    );
    assert.equal(
      all.mock.calls.filter((c) =>
        /platform_(commands|audit)/.test(String(c.arguments[0])),
      ).length,
      0,
      `${table}.${column}: materialized`,
    );
    assert.equal(
      parse.mock.calls.filter((c) =>
        String(c.arguments[0]).includes("budget-marker"),
      ).length,
      0,
    );
    assert.equal(fingerprint(f), before);
  }
});

test("short NUL link identities cannot alias native keys or disappear as empty selection", (t) => {
  const f = setup(t),
    p = f.app.database.owned("platform"),
    before = fingerprint(f);
  for (const column of ["key", "actor_id"] as const) {
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          const v =
            column === "key"
              ? "queue-one\u0000suffix"
              : f.actor.id + "\u0000suffix";
          p.run(
            `UPDATE platform_commands SET ${column}=? WHERE name='stripe.refund'`,
            v,
          );
          p.run(
            `UPDATE platform_audit SET ${column === "key" ? "reference" : "actor_id"}=? WHERE action='stripe.refund'`,
            v,
          );
          f.reader.getInTransaction(f.finance, f.refundId, f.effectId);
        }),
      integrity,
    );
    assert.equal(fingerprint(f), before);
  }
});

test("combined exact byte boundary materializes bounded history; one extra byte refuses before allocation or parse", (t) => {
  const f = setup(t),
    p = f.app.database.owned("platform");
  f.app.database.transaction(() => {
    for (let i = 0; i < 150; i++) pair(f, `aggregate-${i}`, "aggregate-marker");
  });
  // Independently sum actual UTF-8 strings, not the production SQL expression.
  const rows = [
    ...p.all(
      "SELECT org_id,actor_id,name,key,hash,result,created_at FROM platform_commands WHERE name IN('billing.refund.request','stripe.refund')",
    ),
    ...p.all(
      "SELECT a.*,o.org_id AS order_org_id FROM platform_audit a LEFT JOIN platform_audit_order o ON o.audit_id=a.id WHERE a.action IN('billing.refund.request','stripe.refund')",
    ),
  ];
  const bytes = rows.reduce(
    (n, row) =>
      n +
      Object.values(row).reduce<number>(
        (m, v) => m + (typeof v === "string" ? Buffer.byteLength(v) : 0),
        0,
      ),
    0,
  );
  let remaining = limits.totalBytes - bytes;
  f.app.database.transaction(() => {
    for (let i = 0; i < 150; i++) {
      const n = Math.min(60000, remaining);
      remaining -= n;
      p.run(
        "UPDATE platform_commands SET result=? WHERE key=?",
        "aggregate-marker" + "x".repeat(n),
        `aggregate-${i}`,
      );
    }
  });
  assert.equal(remaining, 0);
  const measured = p.get(
    "SELECT SUM(length(CAST(result AS BLOB))) AS n FROM platform_commands WHERE key LIKE 'aggregate-%'",
  )!;
  assert.equal(
    measured.n,
    150 * Buffer.byteLength("aggregate-marker") + limits.totalBytes - bytes,
  );
  const all = t.mock.method(Store.prototype, "all"),
    parse = t.mock.method(JSON, "parse");
  assert.throws(() => f.read(), integrity); // At the byte limit, invalid JSON is still rejected.
  assert.equal(
    all.mock.calls.filter((c) =>
      /platform_(commands|audit)/.test(String(c.arguments[0])),
    ).length,
    2,
  );
  assert.equal(
    parse.mock.calls.filter((c) =>
      String(c.arguments[0]).startsWith("aggregate-marker"),
    ).length,
    1,
  );
  p.run(
    "UPDATE platform_commands SET result=result||'x' WHERE key='aggregate-149'",
  );
  all.mock.resetCalls();
  parse.mock.resetCalls();
  assert.throws(() => f.read(), integrity);
  assert.equal(
    all.mock.calls.filter((c) =>
      /platform_(commands|audit)/.test(String(c.arguments[0])),
    ).length,
    0,
  );
  assert.equal(
    parse.mock.calls.filter((c) =>
      String(c.arguments[0]).startsWith("aggregate-marker"),
    ).length,
    0,
  );
});

test("complete foreign-org command/audit excess and unsupported local actions neither poison nor supply scoped facts", (t) => {
  const f = setup(t),
    p = f.app.database.owned("platform"),
    first = f.read();
  f.app.database.transaction(() => {
    for (let i = 0; i <= limits.commands; i++) {
      p.run(
        "INSERT INTO platform_commands VALUES(?,?,?,?,?,?,?)",
        "foreign-org",
        f.actor.id,
        "stripe.refund",
        `foreign-${i}`,
        "bad",
        i === 0 ? "😀".repeat(20000) : "not-json",
        "invalid",
      );
      p.run(
        "INSERT INTO platform_audit VALUES(?,?,?,?,?,?,?)",
        `foreign-audit-${i}`,
        "foreign-org",
        f.actor.id,
        "stripe.refund",
        `foreign-${i}`,
        "not-json",
        "invalid",
      );
    }
    p.run(
      "INSERT INTO platform_commands VALUES(?,?,?,?,?,?,?)",
      f.actor.orgId,
      f.actor.id,
      "stripe.refund.unsupported",
      "unsupported",
      "bad",
      "not-json",
      "invalid",
    );
    p.run(
      "INSERT INTO platform_audit VALUES(?,?,?,?,?,?,?)",
      "unsupported-audit",
      f.actor.orgId,
      f.actor.id,
      "stripe.refund.unsupported",
      "unsupported",
      "not-json",
      "invalid",
    );
  });
  const before = fingerprint(f);
  assert.deepEqual(f.read(), first);
  assert.equal(fingerprint(f), before);
  // Caller-supplied org switch is rechecked against the real IAM user.
  assert.throws(
    () => f.read({ ...f.finance, orgId: "foreign-org", role: "admin" }),
    { code: "FORBIDDEN" },
  );
  assert.deepEqual(f.read(), first);
});
