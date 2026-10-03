import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { fixture, accept, ship } from "./fixtures.ts";
import { canonical, digest, type Actor } from "../src/server/core.ts";
import { Store } from "../src/server/database.ts";
import { Application } from "../src/server/application.ts";
import {
  offlineRefundReviewLimits,
  type OfflineFailedRefundTuple,
} from "../src/server/billing-refunds.ts";

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
function commitDirect(f: Fixture) {
  const reviewed = f.app.billing.refunds.reviewOfflineFailedRefundInTransaction(
    f.finance,
    f.refundId,
  );
  return f.app.billing.refunds.applyOfflineFailedRefundInTransaction(
    f.finance,
    f.refundId,
    reviewed.factsHash,
    f.tuple,
  );
}
function commit(f: Fixture) {
  return f.app.database.transaction(() => commitDirect(f));
}
type Receipt = ReturnType<typeof commit>;
function direct(f: Fixture, r: Receipt, actor = f.finance, tuple = f.tuple) {
  return f.app.billing.refunds.recoverOfflineFailedRefundInTransaction(
    actor,
    r.refundId,
    r.observationId,
    r.noticeSequence,
    tuple,
  );
}
function recover(f: Fixture, r: Receipt) {
  return f.app.database.transaction(() => direct(f, r));
}
function b(f: Fixture) {
  return f.app.database.owned("billing");
}
function snapshot(f: Fixture) {
  return canonical(
    ["billing", "platform", "integration", "inventory", "orders"].map(
      (owner) => {
        const s = f.app.database.owned(owner as "billing");
        return s
          .all<{ name: string }>(
            "SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE ? ORDER BY name",
            `${owner}_%`,
          )
          .map(({ name }) => [
            name,
            s.all(`SELECT * FROM ${name} ORDER BY rowid`),
          ]);
      },
    ),
  );
}
function rollback(f: Fixture, action: () => void) {
  const stop = Error("synthetic rollback");
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        action();
        throw stop;
      }),
    (e) => e === stop,
  );
}
for (const [region, currency] of [
  ["CA", "CAD"],
  ["CA", "USD"],
  ["US", "USD"],
] as const) {
  test(`exact Billing result after lost reply, acknowledgements and reopen ${region}/${currency}`, (t) => {
    const f = setup(t, region, currency);
    // Native unrelated history makes sole-row/latest-ID guessing incorrect.
    f.app.database.transaction(() => {
      const intent = f.app.billing.refunds.intent(f.finance, f.siblingId);
      f.app.billing.refunds.observe(f.finance, intent, "re_sibling", {
        ...intent,
        status: "failed",
      });
    });
    let receipt: Receipt | undefined;
    assert.throws(() => {
      receipt = commit(f);
      throw Error("synthetic lost reply after native COMMIT");
    }, /lost reply/);
    const r = receipt!;
    assert(r.observationId > 1);
    assert(r.noticeSequence > 1);
    const initial = recover(f, r);
    assert.deepEqual(initial.receipt, r);
    assert.deepEqual(initial.failed, f.tuple);
    assert.equal(initial.native.refund.state, "rejected");
    assert.throws(
      () =>
        f.app.database.transaction(() =>
          f.app.billing.refunds.reviewOfflineFailedRefundInTransaction(
            f.finance,
            f.refundId,
          ),
        ),
      { code: "OFFLINE_REFUND_REVIEW" },
    );
    f.app.billing.refunds.alerts.acknowledge(f.finance, "synthetic-read", {
      noticeId: f.refundId,
      revision: 1,
    });
    f.app.database.transaction(() => {
      const intent = f.app.billing.refunds.intent(f.finance, f.refundId);
      for (let i = 0; i < 25; i++)
        f.app.billing.refunds.observe(
          f.finance,
          intent,
          f.tuple.externalReference,
          { ...intent, status: i % 2 ? "pending" : "succeeded" },
        );
    });
    f.app.close();
    f.app = new Application(f.path, region);
    const before = snapshot(f),
      found = recover(f, r);
    assert.deepEqual(found.receipt, r);
    assert.equal(
      found.native.observations.filter((row) => row.refund_id === f.refundId)
        .length,
      26,
    );
    assert.equal(
      found.native.noticeReads.filter((row) => row.refund_id === f.refundId)
        .length,
      1,
    );
    assert.notEqual(found.factsHash, initial.factsHash);
    const { factsHash, ...body } = found;
    assert.equal(factsHash, digest(canonical(body)));
    assert.equal(found.purpose, "billing.offline-failed-refund-result.v1");
    assert.equal(snapshot(f), before);
    assert(Object.isFrozen(found));
    assert(Object.isFrozen(found.failed));
    assert(Object.isFrozen(found.receipt));
    assert(Object.isFrozen(found.native.observations));
    assert(Object.isFrozen(found.native.observations[0]));
    assert.throws(() => {
      (found.receipt as { observationId: number }).observationId = 99;
    }, TypeError);
    f.tuple = { ...f.tuple, externalReference: "re_changed_input" };
    assert.notEqual(found.failed.externalReference, f.tuple.externalReference);
  });
}
test("unknown, absent, later observation and wrong notice identities cannot substitute", (t) => {
  const f = setup(t);
  assert.throws(
    () =>
      recover(f, {
        version: 1,
        refundId: f.refundId,
        observationId: 1,
        applied: true,
        state: "rejected",
        status: "failed",
        noticeId: f.refundId,
        noticeSequence: 1,
        noticeRevision: 1,
        noticeStatus: "failed",
        noticeState: "open",
      }),
    { code: "OFFLINE_REFUND_REVIEW" },
  );
  const r = commit(f);
  f.app.database.transaction(() =>
    f.app.billing.refunds.observe(
      f.finance,
      f.app.billing.refunds.intent(f.finance, f.refundId),
      f.tuple.externalReference,
      { ...f.tuple, status: "failed" },
    ),
  );
  const before = snapshot(f);
  for (const changed of [
    { ...r, observationId: r.observationId + 1 },
    { ...r, observationId: r.observationId + 100 },
    { ...r, noticeSequence: r.noticeSequence + 1 },
    { ...r, refundId: f.siblingId },
  ])
    assert.throws(() => recover(f, changed));
  assert.equal(snapshot(f), before);
});
for (const field of [
  "paymentId",
  "invoiceId",
  "refundId",
  "paymentAmount",
  "amount",
  "currency",
  "externalReference",
] as const) {
  test(`original failed tuple mismatch refuses ${field}`, (t) => {
    const f = setup(t),
      r = commit(f),
      before = snapshot(f);
    const tuple = {
      ...f.tuple,
      [field]:
        typeof f.tuple[field] === "number"
          ? Number(f.tuple[field]) + 1
          : field === "currency"
            ? "usd"
            : field === "paymentId"
              ? "pi_other"
              : "re_other",
    };
    assert.throws(
      () =>
        f.app.database.transaction(() =>
          direct(f, r, f.finance, tuple as OfflineFailedRefundTuple),
        ),
      { code: "OFFLINE_REFUND_RECOVERY" },
    );
    assert.equal(snapshot(f), before);
  });
}
test("current native finance, staff, password, active and organization authority wins", (t) => {
  const f = setup(t),
    r = commit(f),
    iam = f.app.database.owned("iam");
  for (const sql of [
    "UPDATE iam_users SET role='support' WHERE id=?",
    "UPDATE iam_users SET active=0 WHERE id=?",
    "UPDATE iam_users SET org_id='other' WHERE id=?",
    "UPDATE iam_users SET account_id='attached' WHERE id=?",
    "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
  ])
    rollback(f, () => {
      iam.run(sql, f.finance.id);
      const before = snapshot(f);
      assert.throws(
        () => direct(f, r, { ...f.finance, role: "admin", accountId: null }),
        {
          code: sql.includes("password_change")
            ? "PASSWORD_CHANGE_REQUIRED"
            : "FORBIDDEN",
        },
      );
      assert.equal(snapshot(f), before);
    });
  assert.throws(() => direct(f, r), { code: "TRANSACTION" });
});
test("strict primitive identities and tuple descriptors do not execute caller traps", (t) => {
  const f = setup(t),
    r = commit(f);
  let traps = 0;
  const hostile = {
    toString() {
      traps++;
      throw Error("trap");
    },
  };
  const getter = Object.defineProperty({ ...f.tuple }, "amount", {
    get() {
      traps++;
      throw Error("getter");
    },
    enumerable: true,
  });
  f.app.database.transaction(() => {
    for (const id of [hostile, " x", "x\0", "é".repeat(100)])
      assert.throws(() => direct(f, { ...r, refundId: id as string }), {
        code: "OFFLINE_REFUND_INPUT",
      });
    for (const id of [0, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])
      assert.throws(() => direct(f, { ...r, observationId: id }), {
        code: "OFFLINE_REFUND_INPUT",
      });
    for (const tuple of [
      getter,
      new Proxy(f.tuple, {
        getOwnPropertyDescriptor() {
          traps++;
          throw Error("proxy");
        },
      }),
    ])
      assert.throws(() => direct(f, r, f.finance, tuple), {
        code: "OFFLINE_REFUND_INPUT",
      });
  });
  assert.equal(traps, 0);
});
for (const sql of [
  "UPDATE billing_refund_observations SET applied=0 WHERE refund_id=?",
  "UPDATE billing_refund_provider SET status='succeeded' WHERE refund_id=?",
  "UPDATE billing_refund_alert_updates SET source='existing-state' WHERE refund_id=?",
  "UPDATE billing_refund_alerts SET seq=seq+100 WHERE refund_id=?",
  "DELETE FROM billing_refund_alert_updates WHERE refund_id=?",
  "UPDATE billing_refund_observations SET org_id='other' WHERE refund_id=?",
])
  test(`damaged complete native result refuses: ${sql.split(" ").slice(0, 3).join(" ")}`, (t) => {
    const f = setup(t),
      r = commit(f);
    rollback(f, () => {
      b(f).run(sql, f.refundId);
      const before = snapshot(f);
      assert.throws(() => direct(f, r));
      assert.equal(snapshot(f), before);
    });
  });
for (const table of ["billing_refund_observations", "billing_refund_proofs"])
  test(`orphan provider-reference collision refuses ${table}`, (t) => {
    const f = setup(t),
      r = commit(f);
    rollback(f, () => {
      if (table.endsWith("observations"))
        b(f).run(
          "INSERT INTO billing_refund_observations(org_id,refund_id,external_ref,status,applied,created_at) VALUES(?,?,?,'failed',1,?)",
          f.finance.orgId,
          "orphan",
          f.tuple.externalReference,
          new Date().toISOString(),
        );
      else
        b(f).run(
          "INSERT INTO billing_refund_proofs VALUES(?,?,?,?)",
          f.finance.orgId,
          f.tuple.externalReference,
          "orphan",
          new Date().toISOString(),
        );
      const before = snapshot(f);
      assert.throws(() => direct(f, r), { code: "OFFLINE_REFUND_RECOVERY" });
      assert.equal(snapshot(f), before);
    });
  });
test("all acknowledgements are bounded before retained rows materialize", (t) => {
  const f = setup(t),
    r = commit(f);
  const at = b(f).get<{ updated_at: string }>(
    "SELECT updated_at FROM billing_refund_alerts WHERE refund_id=?",
    f.refundId,
  )!.updated_at;
  f.app.database.transaction(() => {
    for (let i = 0; i <= offlineRefundReviewLimits.rowsPerSet; i++)
      b(f).run(
        "INSERT INTO billing_refund_alert_reads VALUES(?,?,?,?,?)",
        f.finance.orgId,
        f.refundId,
        `synthetic-reader-${i}`,
        1,
        at,
      );
  });
  const all = Store.prototype.all;
  let materialized = 0;
  t.mock.method(
    Store.prototype,
    "all",
    function (
      this: Store,
      sql: string,
      ...params: Parameters<Store["all"]> extends [string, ...infer P]
        ? P
        : never
    ) {
      if (sql.startsWith("SELECT * FROM billing_refund_alert_reads"))
        materialized++;
      return all.call(this, sql, ...params);
    },
  );
  assert.throws(() => recover(f, r), { code: "OFFLINE_REFUND_REVIEW_LIMIT" });
  assert.equal(materialized, 0);
});
test("UTF-8 bytes after embedded NUL are bounded before exact recovery materializes", (t) => {
  const f = setup(t),
    r = commit(f);
  b(f).run(
    "UPDATE billing_refunds SET reference=? WHERE id=?",
    "synthetic\0" + "é".repeat(offlineRefundReviewLimits.bytes / 2),
    f.refundId,
  );
  const get = Store.prototype.get;
  let materialized = 0;
  t.mock.method(
    Store.prototype,
    "get",
    function (
      this: Store,
      sql: string,
      ...params: Parameters<Store["get"]> extends [string, ...infer P]
        ? P
        : never
    ) {
      if (sql.startsWith("SELECT * FROM billing_refunds")) materialized++;
      return get.call(this, sql, ...params);
    },
  );
  assert.throws(() => recover(f, r), { code: "OFFLINE_REFUND_REVIEW_LIMIT" });
  assert.equal(materialized, 0);
});
test("recovery observes an outer rollback without restoring an absent result", (t) => {
  const f = setup(t);
  let r: Receipt | undefined;
  rollback(f, () => {
    r = commitDirect(f);
    assert.deepEqual(direct(f, r).receipt, r);
  });
  assert.throws(() => recover(f, r!), { code: "OFFLINE_REFUND_REVIEW" });
});
