import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Application } from "../src/server/application.ts";
import { canonical, digest, type Actor } from "../src/server/core.ts";
import { journalFixture } from "./stock-journal-fixture.ts";

function setup(
  t: TestContext,
  region: "CA" | "US" = "CA",
  dispatched = false,
  lookup = false,
) {
  const c = journalFixture(t, region),
    journal = c.approve();
  let lease = c.j.claim(c.f.actor, journal.id, "write")!;
  if (dispatched) c.j.beforeWrite(lease);
  if (lookup) {
    c.j.unresolved(lease, "transport-uncertain");
    lease = c.j.claim(c.f.actor, journal.id, "lookup")!;
  }
  c.f.app.platform.isolateRestore(
    digest("synthetic copied running lease"),
    new Date().toISOString(),
  );
  return { ...c, journal, lease };
}
type F = ReturnType<typeof setup>;
function read(c: F) {
  return c.f.app.database.transaction(() =>
    c.j.readOfflineLeaseRetirementInTransaction(c.reviewer, c.journal.id),
  );
}
function input(c: F) {
  const review = read(c),
    a = review.attempts.find((a) => a.row.id === c.journal.id)!;
  return {
    journalId: c.journal.id,
    orgId: review.orgId,
    leaseId: c.lease.leaseId,
    leaseActor: c.lease.actor.id,
    leaseStarted: c.lease.started,
    leaseMode: c.lease.mode,
    dispatched: a.row.dispatched,
    requestRef: c.journal.requestRef,
    sourceId: a.row.source_id,
    sourceHash: a.plan.input.sourceHash,
    attemptId: a.row.attempt_id,
    reviewHash: a.row.review_hash,
    expectedFactsHash: review.hash,
  };
}
function apply(c: F, value = input(c), actor: Actor = c.reviewer) {
  return c.f.app.database.transaction(() =>
    c.j.retireOfflineOriginalLeaseInTransaction(actor, value),
  );
}
function snapshot(c: F) {
  return canonical(
    (["integration", "platform", "inventory", "billing", "iam"] as const).map(
      (owner) => {
        const s = c.f.app.database.owned(owner);
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
function frozen(v: unknown) {
  if (v && typeof v === "object") {
    assert(Object.isFrozen(v));
    Object.values(v).forEach(frozen);
  }
}
test("ordinary unresolved refuses reconstructed copied lease under hold without writes", (t) => {
  const c = setup(t),
    before = snapshot(c);
  assert.throws(
    () => c.j.unresolved(structuredClone(c.lease), "transport-uncertain"),
    { code: "JOURNAL_LEASE" },
  );
  assert.equal(snapshot(c), before);
});
for (const region of ["CA", "US"] as const)
  for (const dispatched of [false, true])
    for (const lookup of [false, true])
      test(`${region} dispatched=${dispatched} lookup=${lookup}: exact running original retires only to unknown`, (t) => {
        const c = setup(t, region, dispatched, lookup),
          before = read(c),
          value = input(c),
          receipt = apply(c, value);
        frozen(before);
        frozen(receipt);
        assert.equal(
          receipt.purpose,
          "distributor-stock-journal-offline-lease-retirement-v1",
        );
        assert.equal(receipt.beforeHash, before.hash);
        assert.equal(receipt.observation.body.cause, "restore-interrupted");
        const after = c.f.app.database.transaction(() =>
          c.j.readOfflineOriginalInTransaction(c.reviewer, c.journal.id),
        );
        assert.equal(after.hash, receipt.after.hash);
        const row = after.attempts.find((a) => a.row.id === c.journal.id)!.row;
        assert.equal(row.state, "unknown");
        assert.equal(row.dispatched, dispatched ? 1 : 0);
        for (const k of [
          "lease_id",
          "lease_actor",
          "lease_started",
          "lease_mode",
        ] as const)
          assert.equal(row[k], null);
        assert.equal(canonical(before.source), canonical(after.source));
        assert.equal(
          canonical(before.sourceReservations),
          canonical(after.sourceReservations),
        );
        assert.equal(
          canonical(before.attempts[0]!.references),
          canonical(after.attempts[0]!.references),
        );
        const saved = snapshot(c);
        assert.throws(() => apply(c, value));
        assert.equal(snapshot(c), saved);
        assert.throws(() => c.j.claim(c.f.actor, c.journal.id, "write"), {
          code: "RECOVERY_HOLD",
        });
      });

test("actual writer and raw hold are mandatory; read is deterministic and has zero changes", (t) => {
  const c = setup(t),
    value = input(c),
    before = snapshot(c);
  assert.throws(
    () => c.j.readOfflineLeaseRetirementInTransaction(c.reviewer, c.journal.id),
    { code: "TRANSACTION" },
  );
  assert.throws(
    () => c.j.retireOfflineOriginalLeaseInTransaction(c.reviewer, value),
    { code: "TRANSACTION" },
  );
  c.f.app.database.transaction(() => {
    const s = c.f.app.database.owned("integration"),
      count = s.get("SELECT total_changes() AS n")!.n;
    const first = c.j.readOfflineLeaseRetirementInTransaction(
      c.reviewer,
      c.journal.id,
    );
    assert.deepEqual(
      first,
      c.j.readOfflineLeaseRetirementInTransaction(c.reviewer, c.journal.id),
    );
    const { hash, ...facts } = first;
    assert.equal(hash, digest(canonical(facts)));
    assert.equal(s.get("SELECT total_changes() AS n")!.n, count);
  });
  assert.throws(
    () =>
      c.f.app.database.transaction(() => {
        c.f.app.database.owned("platform").run("DELETE FROM platform_recovery");
        c.j.retireOfflineOriginalLeaseInTransaction(c.reviewer, value);
      }),
    { code: "RECOVERY_HOLD" },
  );
  assert.equal(snapshot(c), before);
});
for (const change of [
  "role='support'",
  "active=0",
  "org_id='foreign'",
  "account_id='buyer'",
])
  test(`fresh retirement authority refuses ${change}`, (t) => {
    const c = setup(t),
      value = input(c),
      before = snapshot(c);
    assert.throws(
      () =>
        c.f.app.database.transaction(() => {
          c.f.app.database
            .owned("iam")
            .run(`UPDATE iam_users SET ${change} WHERE id=?`, c.reviewer.id);
          c.j.retireOfflineOriginalLeaseInTransaction(
            { ...c.reviewer, role: "admin", accountId: null },
            value,
          );
        }),
      { code: "FORBIDDEN" },
    );
    assert.equal(snapshot(c), before);
  });
test("forced password change and wrong organization locator refuse", (t) => {
  const c = setup(t),
    value = input(c),
    before = snapshot(c);
  assert.throws(() => apply(c, value, { ...c.reviewer, orgId: "foreign" }), {
    code: "FORBIDDEN",
  });
  assert.throws(
    () =>
      c.f.app.database.transaction(() => {
        c.f.app.database
          .owned("iam")
          .run(
            "INSERT INTO iam_user_security VALUES(?,1,1,'2026-10-04T00:00:00.000Z') ON CONFLICT(user_id) DO UPDATE SET password_change_required=1",
            c.reviewer.id,
          );
        c.j.retireOfflineOriginalLeaseInTransaction(c.reviewer, value);
      }),
    { code: "PASSWORD_CHANGE_REQUIRED" },
  );
  assert.equal(snapshot(c), before);
});
for (const key of [
  "orgId",
  "journalId",
  "leaseId",
  "leaseActor",
  "requestRef",
  "sourceId",
  "sourceHash",
  "attemptId",
  "reviewHash",
  "expectedFactsHash",
] as const)
  test(`exact captured ${key} mismatch refuses`, (t) => {
    const c = setup(t),
      value = input(c),
      before = snapshot(c);
    value[key] = key.endsWith("Hash")
      ? "a".repeat(64)
      : key === "requestRef"
        ? "DJ-" + "a".repeat(18)
        : "other";
    assert.throws(() => apply(c, value));
    assert.equal(snapshot(c), before);
  });
for (const change of [
  "lease_id='successor'",
  "lease_actor='other'",
  "lease_started=lease_started+1",
  "lease_started=-1",
  "lease_mode='lookup'",
  "dispatched=1",
  "decision_reason='changed'",
])
  test(`changed retained ${change} invalidates exact review`, (t) => {
    const c = setup(t),
      value = input(c),
      before = snapshot(c);
    assert.throws(() =>
      c.f.app.database.transaction(() => {
        c.f.app.database
          .owned("integration")
          .run(
            `UPDATE integration_stock_journals SET ${change} WHERE id=?`,
            c.journal.id,
          );
        c.j.retireOfflineOriginalLeaseInTransaction(c.reviewer, value);
      }),
    );
    assert.equal(snapshot(c), before);
  });
for (const sql of [
  "DELETE FROM integration_stock_journal_observations",
  "UPDATE integration_stock_journal_observations SET revision=2",
  "UPDATE integration_stock_journal_observations SET org_id='foreign'",
  "UPDATE integration_stock_journal_observations SET body='{}'",
  "DELETE FROM integration_stock_journal_references",
  "UPDATE integration_stock_journal_references SET request_ref='DJ-corrupt'",
  "UPDATE integration_stock_journal_references SET org_id='foreign'",
  "UPDATE integration_stock_journals SET decision_by=created_by",
  "UPDATE integration_stock_journals SET plan='{}'",
  "UPDATE integration_cost_packets SET content_hash='bad'",
])
  test(`complete copied history refuses ${sql}`, (t) => {
    const c = setup(t, "CA", true, true),
      value = input(c),
      before = snapshot(c);
    assert.throws(() =>
      c.f.app.database.transaction(() => {
        c.f.app.database.owned("integration").run(sql);
        c.j.retireOfflineOriginalLeaseInTransaction(c.reviewer, value);
      }),
    );
    assert.equal(snapshot(c), before);
  });

test("strict inert input rejects proxies including revoked and accessors with zero traps", (t) => {
  const c = setup(t),
    value = input(c),
    before = snapshot(c);
  let traps = 0;
  const trap = () => {
    traps++;
    throw Error("input trap");
  };
  const p = new Proxy(
    {},
    {
      get: trap,
      ownKeys: trap,
      getPrototypeOf: trap,
      getOwnPropertyDescriptor: trap,
    },
  );
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  const getter = { ...value };
  Object.defineProperty(getter, "leaseId", { enumerable: true, get: trap });
  const hidden = { ...value };
  Object.defineProperty(hidden, "sourceId", {
    value: value.sourceId,
    enumerable: false,
  });
  for (const bad of [
    p,
    revoked.proxy,
    getter,
    hidden,
    { ...value, extra: 1 },
    { ...value, [Symbol("hidden")]: 1 },
    Object.assign(Object.create(null), value),
    { ...value, leaseId: p },
    { ...value, leaseStarted: NaN },
    { ...value, leaseStarted: -1 },
    { ...value, leaseMode: "unknown" },
    { ...value, requestRef: "DJ-a\0b" },
    { ...value, sourceId: "x".repeat(161) },
    { ...value, expectedFactsHash: "A".repeat(64) },
  ])
    assert.throws(() => apply(c, bad as typeof value));
  for (const actor of [
    p,
    revoked.proxy,
    { ...c.reviewer, sites: p },
    Object.defineProperty({ ...c.reviewer }, "id", { get: trap }),
  ])
    assert.throws(() => apply(c, value, actor as Actor));
  for (const journalId of [p, revoked.proxy, { toString: trap }])
    assert.throws(() =>
      c.f.app.database.transaction(() =>
        c.j.readOfflineLeaseRetirementInTransaction(
          c.reviewer,
          journalId as string,
        ),
      ),
    );
  assert.equal(traps, 0);
  assert.equal(snapshot(c), before);
});

for (const kind of ["utf8", "nul", "json", "count", "aggregate"] as const)
  test(`pre-materialization ${kind} budget refuses without returning owning text`, (t) => {
    const c = setup(t),
      s = c.f.app.database.owned("integration");
    if (kind === "utf8" || kind === "nul")
      s.run(
        "UPDATE integration_stock_journals SET decision_reason=?",
        kind === "utf8" ? "界".repeat(666667) : "x\0y",
      );
    if (kind === "json")
      s.run(
        "UPDATE integration_stock_journals SET plan=?",
        "[".repeat(513) + "0" + "]".repeat(513),
      );
    if (kind === "count")
      c.f.app.database.transaction(() => {
        for (let i = 0; i < 129; i++)
          s.run(
            "INSERT INTO integration_stock_journal_observations VALUES(?,?,?,?,?,?,?)",
            c.journal.id,
            i + 1,
            c.f.actor.orgId,
            "{}",
            "a".repeat(64),
            c.f.actor.id,
            "2026-10-04T00:00:00.000Z",
          );
      });
    if (kind === "aggregate")
      c.f.app.database.transaction(() => {
        for (let i = 0; i < 5; i++)
          s.run(
            "INSERT INTO integration_stock_journal_observations VALUES(?,?,?,?,?,?,?)",
            c.journal.id,
            i + 1,
            c.f.actor.orgId,
            "x".repeat(1_700_000),
            "a".repeat(64),
            c.f.actor.id,
            "2026-10-04T00:00:00.000Z",
          );
      });
    const execute = c.f.app.database.execute.bind(c.f.app.database);
    let returnedBytes = 0;
    const scan = (v: unknown) => {
      if (typeof v === "string") returnedBytes += Buffer.byteLength(v);
      else if (v && typeof v === "object") Object.values(v).forEach(scan);
    };
    const spy = t.mock.method(
      c.f.app.database,
      "execute",
      (...args: Parameters<typeof execute>) => {
        const r = execute(...args);
        if (args[0] === "integration") scan(r);
        return r;
      },
    );
    assert.throws(() => read(c), {
      code:
        kind === "nul" ? "OFFLINE_ORIGINAL_REVIEW" : "OFFLINE_ORIGINAL_LIMIT",
    });
    spy.mock.restore();
    assert.equal(returnedBytes, 0);
  });

test("real late SQLite audit failure is reached after state and observation writes and rolls back all owners", (t) => {
  const c = setup(t),
    value = input(c),
    before = snapshot(c),
    db = new DatabaseSync(c.f.path);
  db.exec(
    "CREATE TRIGGER synthetic_lease_audit_failure BEFORE INSERT ON platform_audit WHEN NEW.action='accounting.journal.observed' BEGIN SELECT RAISE(ABORT,'synthetic lease audit failure'); END",
  );
  const audit = c.f.app.platform.audit.bind(c.f.app.platform);
  let reached = 0;
  const spy = t.mock.method(
    c.f.app.platform,
    "audit",
    (...args: Parameters<typeof audit>) => {
      if (args[1] === "accounting.journal.observed") {
        const s = c.f.app.database.owned("integration");
        assert.equal(
          s.get(
            "SELECT state FROM integration_stock_journals WHERE id=?",
            c.journal.id,
          )!.state,
          "unknown",
        );
        assert.equal(
          s.get(
            "SELECT COUNT(*) AS n FROM integration_stock_journal_observations WHERE journal_id=?",
            c.journal.id,
          )!.n,
          1,
        );
        reached++;
      }
      return audit(...args);
    },
  );
  try {
    assert.throws(() => apply(c, value), /synthetic lease audit failure/);
    assert.equal(reached, 1);
    assert.equal(snapshot(c), before);
  } finally {
    spy.mock.restore();
    db.exec("DROP TRIGGER synthetic_lease_audit_failure");
    db.close();
  }
});
for (const fault of ["authority", "hold", "immutable-source"] as const)
  test(`post-audit ${fault} corruption rolls back native and audit writes`, (t) => {
    const c = setup(t),
      value = input(c),
      before = snapshot(c),
      audit = c.f.app.platform.audit.bind(c.f.app.platform);
    let reached = 0;
    const spy = t.mock.method(
      c.f.app.platform,
      "audit",
      (...args: Parameters<typeof audit>) => {
        audit(...args);
        reached++;
        if (fault === "authority")
          c.f.app.database
            .owned("iam")
            .run("UPDATE iam_users SET active=0 WHERE id=?", c.reviewer.id);
        if (fault === "hold")
          c.f.app.database
            .owned("platform")
            .run("DELETE FROM platform_recovery");
        if (fault === "immutable-source")
          c.f.app.database
            .owned("integration")
            .run(
              "UPDATE integration_stock_journals SET decision_reason='altered' WHERE id=?",
              c.journal.id,
            );
      },
    );
    assert.throws(() => apply(c, value));
    spy.mock.restore();
    assert.equal(reached, 1);
    assert.equal(snapshot(c), before);
  });
test("outer abort preserves running lease; reopened reader retires copied lease and refuses replay", (t) => {
  const c = setup(t, "US", true),
    value = input(c),
    before = snapshot(c);
  assert.throws(
    () =>
      c.f.app.database.transaction(() => {
        c.j.retireOfflineOriginalLeaseInTransaction(c.reviewer, value);
        throw Error("outer abort");
      }),
    /outer abort/,
  );
  assert.equal(snapshot(c), before);
  c.f.app.close();
  c.f.app = new Application(c.f.path, "US", { eventReports: false });
  c.j = c.f.app.integration.costs.journals;
  assert.equal(read(c).hash, value.expectedFactsHash);
  const receipt = apply(c, value),
    after = snapshot(c);
  c.f.app.close();
  c.f.app = new Application(c.f.path, "US", { eventReports: false });
  c.j = c.f.app.integration.costs.journals;
  assert.equal(
    c.f.app.database.transaction(() =>
      c.j.readOfflineOriginalInTransaction(c.reviewer, c.journal.id),
    ).hash,
    receipt.after.hash,
  );
  assert.throws(() => apply(c, value));
  assert.equal(snapshot(c), after);
});
test("independent SQLite writer cannot replace held lease; committed replacement invalidates old review", (t) => {
  const c = setup(t),
    value = input(c),
    db = new DatabaseSync(c.f.path);
  try {
    db.exec("PRAGMA busy_timeout=0");
    c.f.app.database.transaction(() => {
      assert.throws(
        () =>
          db
            .prepare(
              "UPDATE integration_stock_journals SET lease_id='newer' WHERE id=?",
            )
            .run(c.journal.id),
        /locked/,
      );
      assert.equal(
        c.j.readOfflineLeaseRetirementInTransaction(c.reviewer, c.journal.id)
          .hash,
        value.expectedFactsHash,
      );
    });
    db.prepare(
      "UPDATE integration_stock_journals SET lease_id='newer' WHERE id=?",
    ).run(c.journal.id);
    const before = snapshot(c);
    assert.throws(() => apply(c, value));
    assert.equal(snapshot(c), before);
  } finally {
    db.close();
  }
});
test("CA/USD original posting profile and correction running lease remain explicitly unsupported", (t) => {
  const ca = journalFixture(t, "CA", false, undefined, "USD");
  assert.throws(() => ca.approve());
  const c = journalFixture(t, "CA", true),
    j = c.approve();
  c.j.claim(c.f.actor, j.id, "write");
  c.f.app.platform.isolateRestore(
    digest("synthetic correction"),
    new Date().toISOString(),
  );
  assert.throws(
    () =>
      c.f.app.database.transaction(() =>
        c.j.readOfflineLeaseRetirementInTransaction(c.reviewer, j.id),
      ),
    { code: "OFFLINE_ORIGINAL_REVIEW" },
  );
});

test("cancelled predecessor remains immutable and independently approved retry remains unknown after retirement", (t) => {
  const c = journalFixture(t, "CA"),
    ancestor = c.approve(),
    first = c.j.claim(c.f.actor, ancestor.id, "write")!;
  c.j.beforeWrite(first);
  c.j.unresolved(first, "transport-uncertain");
  const evidence = c.j.recordOriginalCancellationEvidence(
    c.f.actor,
    "ancestor-evidence",
    {
      journalId: ancestor.id,
      requestRef: ancestor.requestRef,
      reviewHash: c.j.originalCancellationEvidenceReview(c.f.actor, ancestor.id)
        .reviewHash,
      externalRef: "synthetic:cancelled-ancestor",
      evidence: "Synthetic final exact request cancellation",
      cancellationFinal: true,
      nonPostingVerified: true,
      noLaterPosting: true,
    },
  );
  c.j.cancelOriginalAttempt(c.reviewer, "ancestor-cancel", {
    journalId: ancestor.id,
    requestRef: ancestor.requestRef,
    evidenceHash: evidence.evidence.evidenceHash,
    reason: "Synthetic independent cancellation",
  });
  const retry = c.j.prepareOriginalRetry(c.f.actor, "retry-prepare", {
    journalId: ancestor.id,
    reviewHash: c.j.originalRetryReview(c.f.actor, ancestor.id).reviewHash,
    reason: "Synthetic independently reviewed retry",
  });
  const journal = c.j.decide(c.reviewer, "retry-approve", {
    journalId: retry.id,
    reviewHash: retry.reviewHash,
    decision: "approve",
    reason: "Synthetic independent retry approval",
  });
  const lease = c.j.claim(c.f.actor, journal.id, "write")!;
  c.f.app.platform.isolateRestore(
    digest("synthetic ancestor"),
    new Date().toISOString(),
  );
  const f = { ...c, journal, lease },
    before = read(f),
    receipt = apply(f);
  assert.equal(
    canonical(before.attempts.find((a) => a.row.id === ancestor.id)),
    canonical(receipt.after.attempts.find((a) => a.row.id === ancestor.id)),
  );
  assert.equal(
    receipt.after.attempts.find((a) => a.row.id === journal.id)!.row.attempt_id,
    ancestor.id,
  );
  assert.throws(
    () =>
      c.j.prepareOriginalRetry(c.f.actor, "forbidden-new-retry", {
        journalId: ancestor.id,
        reviewHash: "a".repeat(64),
        reason: "Still held",
      }),
    { code: "RECOVERY_HOLD" },
  );
});
test("another retained original owner for the same source/date cannot be hidden by target selection", (t) => {
  const c = setup(t),
    value = input(c),
    s = c.f.app.database.owned("integration"),
    before = snapshot(c);
  assert.throws(() =>
    c.f.app.database.transaction(() => {
      // Retained corruption copied by restore; the unique native preparation index
      // normally prevents this. A distinct predecessor slot must not hide a row.
      s.run(
        "INSERT INTO integration_stock_journals SELECT 'other',org_id,realm,binding_id,source_id,leg,posting_date,'other-attempt',plan,review_hash,state,created_by,created_at,decision_by,decision_at,decision_reason,'other-lease',lease_actor,lease_started,lease_mode,dispatched,external_id FROM integration_stock_journals WHERE id=?",
        c.journal.id,
      );
      c.j.retireOfflineOriginalLeaseInTransaction(c.reviewer, value);
    }),
  );
  assert.equal(snapshot(c), before);
});
test("new native observation after review defeats retirement; successful receipt is detached from input and conserves foreign owners", (t) => {
  const c = setup(t),
    value = input(c),
    before = snapshot(c);
  assert.throws(() =>
    c.f.app.database.transaction(() => {
      c.j.unresolved(c.lease, "authority-changed");
      c.j.retireOfflineOriginalLeaseInTransaction(c.reviewer, value);
    }),
  );
  assert.equal(snapshot(c), before);
  const stable = () =>
    canonical(
      (["inventory", "billing", "iam"] as const).map((owner) => {
        const s = c.f.app.database.owned(owner);
        return s
          .all<{ name: string }>(
            "SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE ? ORDER BY name",
            `${owner}_%`,
          )
          .map(({ name }) => [
            name,
            s.all(`SELECT * FROM ${name} ORDER BY rowid`),
          ]);
      }),
    );
  const original = stable(),
    receipt = apply(c, value),
    bytes = canonical(receipt);
  value.leaseId = "changed";
  value.expectedFactsHash = "b".repeat(64);
  assert.equal(canonical(receipt), bytes);
  assert.equal(stable(), original);
  assert.throws(
    () => Object.assign(receipt.after.attempts[0]!.row, { dispatched: 1 }),
    TypeError,
  );
  const { hash, ...facts } = receipt;
  assert.equal(hash, digest(canonical(facts)));
});
