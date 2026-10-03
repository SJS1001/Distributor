import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { Application } from "../src/server/application.ts";
import { canonical, digest, type Actor } from "../src/server/core.ts";
import { journalFixture, postedResult } from "./stock-journal-fixture.ts";
import { policy } from "./cost-correction-fixture.ts";

function setup(
  t: TestContext,
  region: "CA" | "US" = "CA",
  currency: "CAD" | "USD" = region === "CA" ? "CAD" : "USD",
) {
  const c = journalFixture(t, region, false, undefined, currency),
    journal = c.approve(),
    lease = c.j.claim(c.f.actor, journal.id, "write")!;
  c.j.beforeWrite(lease);
  c.j.unresolved(lease, "transport-uncertain");
  c.f.app.platform.isolateRestore(
    digest("synthetic stock journal backup"),
    new Date().toISOString(),
  );
  return { ...c, journal };
}
type F = ReturnType<typeof setup>;
function inside(c: F, actor: Actor = c.reviewer, id = c.journal.id) {
  return c.f.app.integration.costs.journals.readOfflineOriginalInTransaction(
    actor,
    id,
  );
}
function read(c: F) {
  return c.f.app.database.transaction(() => inside(c));
}
function frozen(x: unknown) {
  if (x && typeof x === "object") {
    assert(Object.isFrozen(x));
    Object.values(x).forEach(frozen);
  }
}
function snapshot(c: F) {
  return canonical(
    (["integration", "platform", "inventory"] as const).map((owner) => {
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
}
const invalid = { code: "OFFLINE_ORIGINAL_REVIEW" },
  limit = { code: "OFFLINE_ORIGINAL_LIMIT" };
for (const region of ["CA", "US"] as const)
  test(`${region}: exact unknown native original, complete immutable source and history`, (t) => {
    const c = setup(t, region),
      before = snapshot(c);
    const r = c.f.app.database.transaction(() => {
      const changes = c.f.app.database
        .owned("integration")
        .get("SELECT total_changes() AS n")!.n;
      const r = inside(c);
      assert.equal(
        c.f.app.database
          .owned("integration")
          .get("SELECT total_changes() AS n")!.n,
        changes,
      );
      return r;
    });
    assert.equal(r.region, region);
    assert.equal(r.currency, region === "CA" ? "CAD" : "USD");
    assert.equal(r.journalId, c.journal.id);
    assert.equal(r.attempts.length, 1);
    assert.equal(r.attempts[0]!.row.state, "unknown");
    assert.equal(r.source.file.bytes, c.file.bytes);
    assert.equal(r.attempts[0]!.row.plan, canonical(r.attempts[0]!.plan));
    assert.equal(r.attempts[0]!.history.length, 1);
    assert.equal(
      r.attempts[0]!.references[0]!.request_ref,
      c.journal.requestRef,
    );
    assert.equal(r.debit, 18000);
    assert.equal(r.credit, 18000);
    const { hash, ...facts } = r;
    assert.equal(hash, digest(canonical(facts)));
    assert.notEqual(hash, r.attempts[0]!.row.review_hash);
    frozen(r);
    assert.throws(() => {
      (r.attempts[0]!.plan.input as any).realm = "other";
    }, TypeError);
    assert.deepEqual(read(c), r);
    assert.equal(snapshot(c), before);
    assert.throws(() => c.f.app.platform.assertProviderAccess(), {
      code: "RECOVERY_HOLD",
    });
    const existing = c.f.app.database.transaction(() =>
      c.j.originalReconciliationInTransaction(c.reviewer, c.original.id),
    );
    assert(existing.issues.some((x) => x.code === "RECOVERY_HOLD"));
    assert.equal(existing.canConfirm, false);
  });
test("CA/USD retains existing native QuickBooks refusal; no synthetic bypass creates an unknown journal", (t) => {
  const c = journalFixture(t, "CA", false, undefined, "USD");
  assert.equal(JSON.parse(c.file.bytes).currency, "USD");
  assert.throws(() => c.approve(), { code: "JOURNAL_SOURCE" });
});
test("writer and actual raw restored hold are mandatory", (t) => {
  const c = setup(t);
  assert.throws(() => inside(c), { code: "TRANSACTION" });
  assert.throws(
    () =>
      c.f.app.database.transaction(() => {
        c.f.app.database.owned("platform").run("DELETE FROM platform_recovery");
        inside(c);
      }),
    { code: "RECOVERY_HOLD" },
  );
  assert.equal(read(c).hold.id, 1);
});
test("strict actor locator and journal primitives never trigger accessors, coercion or proxy traps", (t) => {
  const c = setup(t);
  let traps = 0;
  const trap = () => {
    traps++;
    throw Error("trap");
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
  const revoked = Proxy.revocable({}, { get: trap });
  revoked.revoke();
  const getter = Object.defineProperty({ ...c.reviewer }, "id", { get: trap });
  const hidden = Object.defineProperty({ ...c.reviewer }, "hidden", {
    value: 1,
  });
  for (const a of [
    p,
    revoked.proxy,
    getter,
    hidden,
    { ...c.reviewer, [Symbol("extra")]: 1 },
    Object.create(c.reviewer),
    null,
    { id: p, orgId: c.reviewer.orgId },
  ])
    assert.throws(
      () =>
        c.f.app.database.transaction(() =>
          c.j.readOfflineOriginalInTransaction(a as Actor, c.journal.id),
        ),
      { code: "OFFLINE_ORIGINAL_INPUT" },
    );
  for (const id of [
    p,
    revoked.proxy,
    { toString: trap },
    new String(c.journal.id),
    undefined,
    null,
    Symbol("id"),
    1,
    "",
    "x".repeat(161),
    "é",
    "id\0hidden",
    "id\n",
  ])
    assert.throws(
      () =>
        c.f.app.database.transaction(() =>
          c.j.readOfflineOriginalInTransaction(c.reviewer, id as string),
        ),
      { code: "OFFLINE_ORIGINAL_INPUT" },
    );
  assert.equal(traps, 0);
});
for (const change of [
  "role='support'",
  "active=0",
  "org_id='other'",
  "account_id='buyer'",
])
  test(`fresh IAM refuses ${change} despite stale admin assertions`, (t) => {
    const c = setup(t),
      before = read(c);
    assert.throws(
      () =>
        c.f.app.database.transaction(() => {
          c.f.app.database
            .owned("iam")
            .run(`UPDATE iam_users SET ${change} WHERE id=?`, c.reviewer.id);
          inside(c, { ...c.reviewer, role: "admin", accountId: null });
        }),
      { code: "FORBIDDEN" },
    );
    assert.deepEqual(read(c), before);
  });
test("password and regional organization revocation are fresh", (t) => {
  const c = setup(t);
  assert.throws(
    () =>
      c.f.app.database.transaction(() => {
        c.f.app.database
          .owned("iam")
          .run(
            "INSERT INTO iam_user_security VALUES(?,1,1,'2026-10-03T00:00:00.000Z') ON CONFLICT(user_id) DO UPDATE SET password_change_required=1",
            c.reviewer.id,
          );
        inside(c);
      }),
    { code: "PASSWORD_CHANGE_REQUIRED" },
  );
  assert.throws(
    () =>
      c.f.app.database.transaction(() => {
        c.f.app.database
          .owned("iam")
          .run(
            "UPDATE iam_organizations SET region='US' WHERE id=?",
            c.reviewer.orgId,
          );
        inside(c);
      }),
    { code: "FORBIDDEN" },
  );
});
for (const change of [
  "lease_id='copied'",
  "lease_actor='copied'",
  "lease_started=-1",
  "lease_mode='lookup'",
  "external_id='999'",
  "state='posted'",
  "state='pending'",
  "state='cancelled'",
])
  test(`contradictory current native ${change} refuses atomically`, (t) => {
    const c = setup(t),
      before = snapshot(c);
    assert.throws(() =>
      c.f.app.database.transaction(() => {
        c.f.app.database
          .owned("integration")
          .run(
            `UPDATE integration_stock_journals SET ${change} WHERE id=?`,
            c.journal.id,
          );
        inside(c);
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
  "UPDATE integration_stock_journal_references SET realm='98765'",
  "UPDATE integration_stock_journals SET decision_by=created_by",
  "UPDATE integration_stock_journals SET plan='{}'",
  "UPDATE integration_cost_packets SET content_hash='bad'",
])
  test(`complete retained evidence refuses ${sql}`, (t) => {
    const c = setup(t),
      before = read(c);
    assert.throws(() =>
      c.f.app.database.transaction(() => {
        c.f.app.database.owned("integration").run(sql);
        inside(c);
      }),
    );
    assert.deepEqual(read(c), before);
  });
test("second complete independent leaf cannot silently own the same source date", (t) => {
  const c = setup(t),
    s = c.f.app.database.owned("integration"),
    before = read(c);
  assert.throws(() =>
    c.f.app.database.transaction(() => {
      // Copy into rejected slot first; changing attempt produces a non-native
      // independent competitor without bypassing the existing unique index.
      s.run(
        "INSERT INTO integration_stock_journals SELECT 'other',org_id,realm,binding_id,source_id,leg,posting_date,'missing-predecessor',plan,review_hash,state,created_by,created_at,decision_by,decision_at,decision_reason,lease_id,lease_actor,lease_started,lease_mode,dispatched,external_id FROM integration_stock_journals WHERE id=?",
        c.journal.id,
      );
      inside(c);
    }),
  );
  assert.deepEqual(read(c), before);
});
function noMaterialization(t: TestContext, c: F, expected = limit) {
  const execute = c.f.app.database.execute.bind(c.f.app.database);
  let strings = 0;
  function scan(v: unknown) {
    if (typeof v === "string") strings += Buffer.byteLength(v);
    else if (v && typeof v === "object") Object.values(v).forEach(scan);
  }
  const spy = t.mock.method(
    c.f.app.database,
    "execute",
    (
      owner: Parameters<typeof execute>[0],
      fn: Parameters<typeof execute>[1],
    ) => {
      const r = execute(owner, fn);
      if (owner === "integration") scan(r);
      return r;
    },
  );
  try {
    assert.throws(() => read(c), expected);
  } finally {
    spy.mock.restore();
  }
  assert.equal(
    strings,
    0,
    "No Integration source/history text materialized before overflow refusal",
  );
}
for (const field of ["plan", "created_by", "decision_reason"])
  test(`UTF-8 journal ${field} preflight precedes materialization`, (t) => {
    const c = setup(t);
    c.f.app.database
      .owned("integration")
      .run(
        `UPDATE integration_stock_journals SET ${field}=? WHERE id=?`,
        "marker\0" + "界".repeat(670000),
        c.journal.id,
      );
    noMaterialization(t, c);
  });
for (const field of ["artifact", "input", "report", "receipt"])
  test(`UTF-8 source ${field} preflight precedes owning source API`, (t) => {
    const c = setup(t);
    c.f.app.database
      .owned("integration")
      .run(
        `UPDATE integration_cost_packets SET ${field}=? WHERE id=?`,
        "界".repeat(670000),
        c.original.id,
      );
    noMaterialization(t, c);
  });
test("complete observation count refuses rather than truncates", (t) => {
  const c = setup(t),
    s = c.f.app.database.owned("integration");
  for (let n = 2; n <= 129; n++)
    s.run(
      "INSERT INTO integration_stock_journal_observations SELECT journal_id,?,org_id,body,hash,recorded_by,recorded_at FROM integration_stock_journal_observations WHERE revision=1",
      n,
    );
  noMaterialization(t, c);
});
test("source JSON complexity refuses before parse/materialization", (t) => {
  const c = setup(t);
  c.f.app.database
    .owned("integration")
    .run(
      "UPDATE integration_cost_packets SET artifact=?",
      JSON.stringify(Array(8200).fill(0)),
    );
  noMaterialization(t, c);
});
test("aggregate UTF-8 budget counts all returned and scoped-source columns", (t) => {
  const c = setup(t),
    s = c.f.app.database.owned("integration");
  for (let n = 2; n <= 7; n++)
    s.run(
      "INSERT INTO integration_cost_policies SELECT org_id,?,input,policy_hash,?,created_at FROM integration_cost_policies WHERE revision=1",
      n,
      "界".repeat(500000),
    );
  noMaterialization(t, c);
});
test("cancelled predecessor retained exactly; ready then unknown retry changes projection without erasing history", (t) => {
  const c = journalFixture(t),
    first = c.approve(),
    lease = c.j.claim(c.f.actor, first.id, "write")!;
  c.j.beforeWrite(lease);
  c.j.unresolved(lease, "transport-uncertain");
  const proof = c.j.recordOriginalCancellationEvidence(c.f.actor, "proof", {
    journalId: first.id,
    requestRef: first.requestRef,
    reviewHash: c.j.originalCancellationEvidenceReview(c.f.actor, first.id)
      .reviewHash,
    externalRef: "synthetic:final-cancellation",
    evidence: "Synthetic exact cancellation and nonposting",
    cancellationFinal: true,
    nonPostingVerified: true,
    noLaterPosting: true,
  });
  c.j.cancelOriginalAttempt(c.reviewer, "cancel", {
    journalId: first.id,
    requestRef: first.requestRef,
    evidenceHash: proof.evidence.evidenceHash,
    reason: "Synthetic independent decision",
  });
  const ready = c.j.prepareOriginalRetry(c.f.actor, "retry", {
    journalId: first.id,
    reviewHash: c.j.originalRetryReview(c.f.actor, first.id).reviewHash,
    reason: "Synthetic distinct attempt",
  });
  c.j.decide(c.reviewer, "retry-approved", {
    journalId: ready.id,
    reviewHash: ready.reviewHash,
    decision: "approve",
    reason: "Synthetic independent approval",
  });
  const next = c.j.claim(c.f.actor, ready.id, "write")!;
  c.j.beforeWrite(next);
  c.j.unresolved(next, "transport-uncertain");
  c.f.app.platform.isolateRestore(
    digest("synthetic backup"),
    new Date().toISOString(),
  );
  const f = { ...c, journal: c.j.detail(c.reviewer, ready.id) },
    r = read(f);
  assert.equal(r.attempts.length, 2);
  const original = r.attempts.find((a) => a.row.id === first.id)!;
  assert.equal(original.row.state, "cancelled");
  assert.equal(original.history.length, 3);
  assert.equal(
    r.attempts.find((a) => a.row.id === ready.id)!.lineage.length,
    1,
  );
  assert.throws(
    () =>
      c.f.app.database.transaction(() =>
        c.j.readOfflineOriginalInTransaction(c.reviewer, first.id),
      ),
    invalid,
  );
});
test("later native lookup outcome changes hash; historical capture remains detached", (t) => {
  const c = setup(t),
    before = read(c),
    s = c.f.app.database.owned("integration");
  // Native method under ordinary gates, then a new isolated capture. No provider IO.
  c.f.app.database.owned("platform").run("DELETE FROM platform_recovery");
  const lease = c.j.claim(c.f.actor, c.journal.id, "lookup")!;
  c.j.unresolved(lease, "lookup-miss");
  c.f.app.platform.isolateRestore(
    digest("synthetic stock journal backup"),
    before.hold.source_completed_at,
  );
  const after = read(c);
  assert.equal(before.attempts[0]!.history.length, 1);
  assert.equal(after.attempts[0]!.history.length, 2);
  assert.notEqual(before.hash, after.hash);
});
test("closed or replaced posting policy conservatively refuses", (t) => {
  const c = setup(t);
  c.f.app.database.owned("platform").run("DELETE FROM platform_recovery");
  c.c.configure(c.f.actor, "closed", {
    ...policy(1),
    closedThrough: "2099-12-31",
  });
  c.f.app.platform.isolateRestore(digest("backup"), new Date().toISOString());
  assert.throws(() => read(c), invalid);
});
test("posted original is outside the unknown subtype", (t) => {
  const c = journalFixture(t),
    journal = c.approve(),
    lease = c.j.claim(c.f.actor, journal.id, "write")!;
  c.j.beforeWrite(lease);
  c.j.posted(lease, postedResult(lease));
  c.f.app.platform.isolateRestore(digest("backup"), new Date().toISOString());
  assert.throws(() => read({ ...c, journal }), invalid);
});
test("outer rollback and reopen preserve exact facts and all native rows", (t) => {
  const c = setup(t),
    r = read(c),
    before = snapshot(c),
    stop = Error("rollback");
  assert.throws(
    () =>
      c.f.app.database.transaction(() => {
        assert.deepEqual(inside(c), r);
        throw stop;
      }),
    stop,
  );
  assert.equal(snapshot(c), before);
  c.f.app.close();
  c.f.app = new Application(c.f.path, "CA", { eventReports: false });
  assert.deepEqual(read(c), r);
  assert.equal(snapshot(c), before);
});

test("later independently approved permission history is complete and changes the digest", (t) => {
  const c = setup(t),
    before = read(c);
  c.f.app.database.owned("platform").run("DELETE FROM platform_recovery");
  const r = c.f.app.identity.organizationResidency,
    current = r.current(c.f.actor);
  r.choose(c.f.actor, "renew", {
    region: "CA",
    revision: current.choice.revision,
    mode: "provider-exception",
    realm: "12345",
    acknowledgment: "Synthetic renewed permission",
    acceptance: {
      disclosureId: current.terms!.id,
      disclosureHash: current.terms!.hash,
      representative: "Synthetic finance",
      evidenceRef: "synthetic:renew",
    },
  });
  const review = c.j.permissionReview(c.f.actor, c.journal.id),
    prepared = c.j.preparePermission(c.f.actor, "permission", {
      journalId: c.journal.id,
      reviewHash: review.journal.reviewHash,
      previousPermissionHash: review.previousPermissionHash,
      authority: review.authority,
      mode: review.mode,
      reason: "Synthetic permission review",
    });
  c.j.decidePermission(c.reviewer, "permission-decision", {
    journalId: c.journal.id,
    permissionReviewId: prepared.id,
    permissionReviewHash: prepared.reviewHash,
    decision: "approve",
    reason: "Synthetic independent permission review",
  });
  c.f.app.platform.isolateRestore(
    digest("synthetic stock journal backup"),
    before.hold.source_completed_at,
  );
  const after = read(c);
  assert.equal(after.attempts[0]!.history.length, 3);
  assert.equal(after.attempts[0]!.permission.reviews.length, 1);
  assert.equal(after.attempts[0]!.permission.mode, "lookup");
  assert.notEqual(after.hash, before.hash);
  assert.equal(before.attempts[0]!.history.length, 1);
});
test("prepared and approved other dates remain explicit; posted other dates conservatively refuse", (t) => {
  const c = journalFixture(t, "CA", false, [
    "2026-10-01",
    "2026-10-02",
    "2026-10-03",
  ]);
  const journal = c.approve({ ...c.make(), postingDate: "2026-10-01" }),
    lease = c.j.claim(c.f.actor, journal.id, "write")!;
  c.j.beforeWrite(lease);
  c.j.unresolved(lease, "transport-uncertain");
  const ready = c.j.prepare(c.f.actor, "other-date", {
    ...c.make(),
    postingDate: "2026-10-02",
  });
  c.f.app.platform.isolateRestore(digest("backup"), new Date().toISOString());
  const f = { ...c, journal },
    first = read(f);
  assert.equal(first.dates.length, 3);
  assert.equal(
    first.attempts.find((a) => a.row.id === ready.id)!.row.state,
    "ready",
  );
  c.f.app.database.owned("platform").run("DELETE FROM platform_recovery");
  c.j.decide(c.reviewer, "approve-other", {
    journalId: ready.id,
    reviewHash: ready.reviewHash,
    decision: "approve",
    reason: "Synthetic other-date approval",
  });
  c.f.app.platform.isolateRestore(digest("backup"), new Date().toISOString());
  assert.equal(
    read(f).attempts.find((a) => a.row.id === ready.id)!.row.state,
    "pending",
  );
  c.f.app.database.owned("platform").run("DELETE FROM platform_recovery");
  const other = c.j.claim(c.f.actor, ready.id, "write")!;
  c.j.beforeWrite(other);
  c.j.posted(other, postedResult(other));
  c.f.app.platform.isolateRestore(digest("backup"), new Date().toISOString());
  assert.throws(() => read(f), invalid);
});
test("missing source movement reservation and copied other-org source history refuse", (t) => {
  const c = setup(t),
    s = c.f.app.database.owned("integration"),
    before = read(c);
  for (const sql of [
    "DELETE FROM integration_cost_sources",
    "UPDATE integration_cost_sources SET org_id='foreign'",
  ]) {
    assert.throws(
      () =>
        c.f.app.database.transaction(() => {
          s.run(sql);
          inside(c);
        }),
      invalid,
    );
    assert.deepEqual(read(c), before);
  }
});

for (const kind of ["duplicate-lease", "prior-posted", "unclassified"] as const)
  test(`RED retained ${kind} history cannot masquerade as a fresh unknown`, (t) => {
    const c = setup(t),
      s = c.f.app.database.owned("integration"),
      original = s.get(
        "SELECT * FROM integration_stock_journal_observations WHERE journal_id=?",
        c.journal.id,
      )!;
    const first = JSON.parse(String(original.body));
    const bodies =
      kind === "duplicate-lease"
        ? [first, first]
        : kind === "prior-posted"
          ? [{ outcome: "posted", requestRef: c.journal.requestRef }, first]
          : [first, { kind: "invented-native-fact" }];
    assert.throws(
      () =>
        c.f.app.database.transaction(() => {
          s.run(
            "DELETE FROM integration_stock_journal_observations WHERE journal_id=?",
            c.journal.id,
          );
          bodies.forEach((body, i) => {
            const revision = i + 1,
              recordedBy = String(original.recorded_by),
              recordedAt = String(original.recorded_at);
            const hash = digest(
              canonical({
                journalId: c.journal.id,
                orgId: c.f.actor.orgId,
                revision,
                body,
                recordedBy,
                recordedAt,
              }),
            );
            s.run(
              "INSERT INTO integration_stock_journal_observations VALUES(?,?,?,?,?,?,?)",
              c.journal.id,
              revision,
              c.f.actor.orgId,
              canonical(body),
              hash,
              recordedBy,
              recordedAt,
            );
          });
          inside(c);
        }),
      invalid,
    );
  });

test("RED escaped embedded source complexity is bounded before the plan/source reaches JavaScript", (t) => {
  const c = setup(t),
    s = c.f.app.database.owned("integration"),
    row = s.get(
      "SELECT plan FROM integration_stock_journals WHERE id=?",
      c.journal.id,
    )!;
  const plan = JSON.parse(String(row.plan)),
    bytes = "[".repeat(513) + "0" + "]".repeat(513);
  plan.intent.source = { bytes, hash: digest(bytes) };
  plan.input.sourceHash = plan.intent.source.hash;
  const raw = canonical(plan).replace(
    JSON.stringify(bytes),
    '"' + "\\u005b".repeat(513) + "0" + "\\u005d".repeat(513) + '"',
  );
  assert.equal(JSON.parse(raw).intent.source.bytes, bytes);
  s.run(
    "UPDATE integration_stock_journals SET plan=?,review_hash=? WHERE id=?",
    raw,
    digest(raw),
    c.journal.id,
  );
  noMaterialization(t, c);
});
