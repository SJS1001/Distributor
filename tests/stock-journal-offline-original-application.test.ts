import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Application } from "../src/server/application.ts";
import { canonical, digest, type Actor } from "../src/server/core.ts";
import type {
  OfflineOriginalJournalReview,
  OfflineOriginalCancellationProof,
} from "../src/server/stock-journal-delivery.ts";
import {
  StockJournalOfflineOriginalEvidence,
  type OfflineOriginalEvidenceInput,
  type OfflineOriginalCancellationSnapshot,
} from "../src/server/stock-journal-offline-original-evidence.ts";
import { journalFixture } from "./stock-journal-fixture.ts";
function setup(t: TestContext, region: "CA" | "US" = "CA", ancestors = 0) {
  const c = journalFixture(t, region);
  let journal = c.approve();
  for (let i = 0; i <= ancestors; i++) {
    const lease = c.j.claim(c.f.actor, journal.id, "write")!;
    c.j.beforeWrite(lease);
    c.j.unresolved(lease, "transport-uncertain");
    if (i === ancestors) break;
    const proof = c.j.recordOriginalCancellationEvidence(
      c.f.actor,
      `proof-${i}`,
      {
        journalId: journal.id,
        requestRef: journal.requestRef,
        reviewHash: c.j.originalCancellationEvidenceReview(
          c.f.actor,
          journal.id,
        ).reviewHash,
        externalRef: `synthetic:final-case-${i}`,
        evidence:
          "Synthetic exact-request final cancellation and no future posting",
        cancellationFinal: true,
        nonPostingVerified: true,
        noLaterPosting: true,
      },
    );
    c.j.cancelOriginalAttempt(c.reviewer, `cancel-${i}`, {
      journalId: journal.id,
      requestRef: journal.requestRef,
      evidenceHash: proof.evidence.evidenceHash,
      reason: "Synthetic independent cancellation",
    });
    const ready = c.j.prepareOriginalRetry(c.f.actor, `retry-${i}`, {
      journalId: journal.id,
      reviewHash: c.j.originalRetryReview(c.f.actor, journal.id).reviewHash,
      reason: "Synthetic retry, separately approved",
    });
    journal = c.j.decide(c.reviewer, `retry-approve-${i}`, {
      journalId: ready.id,
      reviewHash: ready.reviewHash,
      decision: "approve",
      reason: "Independent retry approval",
    });
  }
  c.f.app.platform.isolateRestore(
    digest("synthetic-backup"),
    new Date().toISOString(),
  );
  return { ...c, journal };
}
type F = ReturnType<typeof setup>;
function comparator(app: Application) {
  return new StockJournalOfflineOriginalEvidence(
    app.database,
    app.identity,
    app.integration.costs.journals,
  );
}
function native(c: F) {
  return c.f.app.database.transaction(() =>
    c.f.app.integration.costs.journals.readOfflineOriginalInTransaction(
      c.reviewer,
      c.journal.id,
    ),
  );
}
// Independently reproduce the existing cancellation snapshot, not comparator output.
function inputFor(
  p: OfflineOriginalJournalReview,
): OfflineOriginalEvidenceInput {
  const a = p.attempts.find((x) => x.row.id === p.journalId)!,
    d = p.dates.find((x) => x.postingDate === a.row.posting_date)!;
  const snapshot: OfflineOriginalCancellationSnapshot = {
    version: 1,
    orgId: p.orgId,
    journalId: p.journalId,
    reviewHash: a.row.review_hash,
    sourceId: a.row.source_id,
    sourceHash: p.source.file.hash,
    postingDate: a.row.posting_date,
    realm: a.row.realm,
    bindingId: a.row.binding_id,
    requestRef: String(a.references[0]!.request_ref),
    region: p.region,
    currency: p.currency,
    debit: d.debit,
    credit: d.credit,
    historyHash: digest(canonical(a.observations.map((x) => x.hash))),
  };
  return structuredClone({
    version: 1,
    source: p,
    candidate: p,
    providerClaims: [
      {
        profile: "quickbooks-sandbox-original-final-cancellation-unposted-v1",
        outcome: "cancelled-unposted",
        request: { ...snapshot, intentHash: digest(canonical(a.plan.intent)) },
        attestation: {
          journalId: p.journalId,
          requestRef: snapshot.requestRef,
          reviewHash: digest(canonical(snapshot)),
          externalRef: "synthetic:provider-case-1",
          evidence:
            "Synthetic assertion only: exact final cancellation and no future posting",
          cancellationFinal: true,
          nonPostingVerified: true,
          noLaterPosting: true,
        },
      },
    ],
  });
}
function captured(c: F) {
  const input = inputFor(native(c));
  return c.f.app.database.transaction(() =>
    comparator(c.f.app).captureInTransaction(c.f.actor, c.journal.id, input),
  );
}
const reason = "Synthetic independent final nonposting cancellation";
function apply(c: F, cap = captured(c)) {
  return c.f.app.database.transaction(() =>
    c.f.app.integration.costs.journals.applyOfflineOriginalCancellationInTransaction(
      c.f.actor,
      c.reviewer,
      cap,
      reason,
    ),
  );
}
function recover(c: F, proof: OfflineOriginalCancellationProof) {
  return c.f.app.database.transaction(() =>
    c.f.app.integration.costs.journals.readOfflineOriginalCancellationInTransaction(
      c.reviewer,
      c.journal.id,
      proof.proof.evidence.evidenceHash,
      proof.proof.cancellation.hash,
    ),
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
for (const region of ["CA", "US"] as const)
  test(`${region}: exact native evidence/cancellation bodies, separate authors, full conservation and retained proof`, (t) => {
    const c = setup(t, region),
      cap = captured(c),
      before = cap.native;
    const commands = c.f.app.database
      .owned("platform")
      .get("SELECT count(*) AS n FROM platform_commands")!.n;
    const audits = c.f.app.database
      .owned("platform")
      .get("SELECT count(*) AS n FROM platform_audit")!.n as number;
    const proof = apply(c, cap),
      target = proof.attempts.find((a) => a.row.id === c.journal.id)!;
    assert.equal(target.row.state, "cancelled");
    assert.equal(target.history.length, before.attempts[0]!.history.length + 2);
    assert.equal(proof.proof.evidence.recordedBy, c.f.actor.id);
    assert.equal(proof.proof.cancellation.recordedBy, c.reviewer.id);
    assert.equal(
      proof.proof.evidence.revision + 1,
      proof.proof.cancellation.revision,
    );
    assert.deepEqual(proof.proof.evidence.input, cap.claim.attestation);
    assert.deepEqual(proof.proof.evidence.snapshot, cap.cancellationSnapshot);
    assert.deepEqual(proof.proof.cancellation.body, {
      outcome: "cancelled-unposted",
      evidenceHash: proof.proof.evidence.evidenceHash,
      reason,
      requestRef: c.journal.requestRef,
    });
    assert.deepEqual(target.observations.at(-2)!.body, {
      kind: "original-cancellation-evidence",
      input: cap.claim.attestation,
      snapshot: cap.cancellationSnapshot,
    });
    for (const key of [
      "packet",
      "source",
      "sourceReservations",
      "policies",
      "currentPolicy",
      "hold",
      "dates",
      "debit",
      "credit",
    ] as const)
      assert.deepEqual(proof[key], before[key]);
    assert.deepEqual(target.references, before.attempts[0]!.references);
    assert.equal(target.row.dispatched, before.attempts[0]!.row.dispatched);
    for (const key of [
      "lease_id",
      "lease_actor",
      "lease_started",
      "lease_mode",
      "external_id",
    ] as const)
      assert.equal(target.row[key], null);
    assert.equal(
      c.f.app.database
        .owned("platform")
        .get("SELECT count(*) AS n FROM platform_commands")!.n,
      commands,
    );
    assert.equal(
      c.f.app.database
        .owned("platform")
        .get("SELECT count(*) AS n FROM platform_audit")!.n,
      audits + 2,
    );
    const { hash, ...facts } = proof;
    assert.equal(hash, digest(canonical(facts)));
    assert.notEqual(hash, cap.hash);
    frozen(proof);
    assert.throws(() => {
      (proof.source as any).accepted = true;
    }, TypeError);
    assert.deepEqual(recover(c, proof), proof);
    const after = snapshot(c);
    assert.throws(() => apply(c, cap));
    assert.equal(snapshot(c), after);
    assert.throws(() => native(c), { code: "OFFLINE_ORIGINAL_REVIEW" });
    assert.throws(() => c.j.claim(c.f.actor, c.journal.id, "lookup"), {
      code: "RECOVERY_HOLD",
    });
    assert.throws(
      () =>
        c.j.prepareOriginalRetry(c.f.actor, "blocked-retry", {
          journalId: c.journal.id,
          reviewHash: c.j.originalRetryReview(c.f.actor, c.journal.id)
            .reviewHash,
          reason,
        }),
      { code: "RECOVERY_HOLD" },
    );
    const recon = c.f.app.database.transaction(() =>
      c.j.originalReconciliationInTransaction(c.reviewer, c.original.id),
    );
    assert.equal(recon.canConfirm, false);
    assert(recon.issues.some((x) => x.code === "RECOVERY_HOLD"));
  });
test("CA/USD keeps actual native source preparation refusal", (t) => {
  const c = journalFixture(t, "CA", false, undefined, "USD");
  assert.throws(() => c.approve(), { code: "JOURNAL_SOURCE" });
});
test("a cancelled predecessor and complete final leaf retain original retry proof", (t) => {
  const c = setup(t, "CA", 1),
    cap = captured(c),
    proof = apply(c, cap);
  assert.equal(proof.attempts.length, 2);
  assert(proof.attempts.every((a) => a.row.state === "cancelled"));
  assert.deepEqual(
    proof.attempts.find((a) => a.row.id !== c.journal.id),
    cap.native.attempts.find((a) => a.row.id !== c.journal.id),
  );
  assert.deepEqual(recover(c, proof), proof);
  // Ordinary native retry is independently gated; remove only the test hold to
  // exercise its unchanged existing cancellation/predecessor contract.
  c.f.app.database.owned("platform").run("DELETE FROM platform_recovery");
  const review = c.j.originalRetryReview(c.f.actor, c.journal.id);
  const retry = c.j.prepareOriginalRetry(c.f.actor, "native-retry", {
    journalId: c.journal.id,
    reviewHash: review.reviewHash,
    reason,
  });
  assert.equal(retry.state, "ready");
  assert.notEqual(retry.id, c.journal.id);
  assert.equal(
    retry.plan.predecessor!.cancellationHash,
    proof.proof.cancellation.hash,
  );
  c.f.app.platform.isolateRestore(
    digest("new synthetic backup"),
    new Date().toISOString(),
  );
  assert.throws(() => recover(c, proof));
});
test("outer writer, two distinct current staff principals, and exact raw hold are mandatory", (t) => {
  const c = setup(t),
    cap = captured(c),
    before = snapshot(c);
  assert.throws(
    () =>
      c.j.applyOfflineOriginalCancellationInTransaction(
        c.f.actor,
        c.reviewer,
        cap,
        reason,
      ),
    { code: "TRANSACTION" },
  );
  assert.throws(
    () =>
      c.f.app.database.transaction(() =>
        c.j.applyOfflineOriginalCancellationInTransaction(
          c.f.actor,
          c.f.actor,
          cap,
          reason,
        ),
      ),
    { code: "JOURNAL_CANCELLATION" },
  );
  assert.throws(
    () =>
      c.f.app.database.transaction(() => {
        c.f.app.database.owned("platform").run("DELETE FROM platform_recovery");
        c.j.applyOfflineOriginalCancellationInTransaction(
          c.f.actor,
          c.reviewer,
          cap,
          reason,
        );
      }),
    { code: "RECOVERY_HOLD" },
  );
  assert.equal(snapshot(c), before);
});
for (const who of ["evidence", "cancellation"] as const)
  for (const change of [
    "role='support'",
    "active=0",
    "org_id='other'",
    "account_id='buyer'",
  ])
    test(`fresh ${who} authority refuses ${change}`, (t) => {
      const c = setup(t),
        cap = captured(c),
        actor = who === "evidence" ? c.f.actor : c.reviewer,
        before = snapshot(c);
      assert.throws(
        () =>
          c.f.app.database.transaction(() => {
            c.f.app.database
              .owned("iam")
              .run(`UPDATE iam_users SET ${change} WHERE id=?`, actor.id);
            c.j.applyOfflineOriginalCancellationInTransaction(
              c.f.actor,
              c.reviewer,
              cap,
              reason,
            );
          }),
        { code: "FORBIDDEN" },
      );
      assert.equal(snapshot(c), before);
    });
for (const who of ["evidence", "cancellation"] as const)
  test(`fresh ${who} password change refusal`, (t) => {
    const c = setup(t),
      cap = captured(c),
      actor = who === "evidence" ? c.f.actor : c.reviewer;
    assert.throws(
      () =>
        c.f.app.database.transaction(() => {
          c.f.app.database
            .owned("iam")
            .run(
              "INSERT INTO iam_user_security VALUES(?,1,1,'2026-10-03T00:00:00.000Z') ON CONFLICT(user_id) DO UPDATE SET password_change_required=1",
              actor.id,
            );
          c.j.applyOfflineOriginalCancellationInTransaction(
            c.f.actor,
            c.reviewer,
            cap,
            reason,
          );
        }),
      { code: "PASSWORD_CHANGE_REQUIRED" },
    );
  });
test("forged/copy/proxy capture refused before native hooks; primitive reason/actor traps never execute", (t) => {
  const c = setup(t),
    cap = captured(c);
  let traps = 0;
  const trap = () => {
    traps++;
    throw Error("trap");
  };
  const proxy = new Proxy(
    {},
    {
      get: trap,
      ownKeys: trap,
      getPrototypeOf: trap,
      getOwnPropertyDescriptor: trap,
    },
  );
  const rev = Proxy.revocable({}, {});
  rev.revoke();
  const spy = t.mock.method(c.f.app.identity, "currentActor", () => {
    throw Error("must not call IAM");
  });
  for (const v of [
    structuredClone(cap),
    Object.freeze({ ...cap }),
    proxy,
    rev.proxy,
    Object.defineProperty({}, "native", { get: trap }),
    null,
  ])
    assert.throws(
      () =>
        c.j.applyOfflineOriginalCancellationInTransaction(
          c.f.actor,
          c.reviewer,
          v as any,
          reason,
        ),
      { code: "OFFLINE_ORIGINAL_EVIDENCE" },
    );
  assert.equal(spy.mock.callCount(), 0);
  spy.mock.restore();
  for (const r of [
    proxy,
    rev.proxy,
    "",
    " x",
    "界".repeat(667),
    "bad\0suffix",
    "\ud800",
  ])
    assert.throws(() =>
      c.f.app.database.transaction(() =>
        c.j.applyOfflineOriginalCancellationInTransaction(
          c.f.actor,
          c.reviewer,
          cap,
          r as string,
        ),
      ),
    );
  for (const actor of [
    proxy,
    rev.proxy,
    { ...c.reviewer, sites: [proxy] },
    Object.defineProperty({ ...c.reviewer }, "id", { get: trap }),
    { ...c.reviewer, sites: new Array(1) },
  ])
    assert.throws(() =>
      c.f.app.database.transaction(() =>
        c.j.applyOfflineOriginalCancellationInTransaction(
          c.f.actor,
          actor as Actor,
          cap,
          reason,
        ),
      ),
    );
  assert.equal(traps, 0);
});
test("actual later native observation makes prior capture stale", (t) => {
  const c = setup(t),
    cap = captured(c);
  c.f.app.database.owned("platform").run("DELETE FROM platform_recovery");
  const lease = c.j.claim(c.f.actor, c.journal.id, "lookup")!;
  c.j.unresolved(lease, "lookup-miss");
  c.f.app.platform.isolateRestore(
    digest("synthetic-backup"),
    cap.native.hold.source_completed_at,
  );
  const before = snapshot(c);
  assert.throws(() => apply(c, cap));
  assert.equal(snapshot(c), before);
});
for (const sql of [
  "DELETE FROM integration_stock_journal_references",
  "DELETE FROM integration_stock_journal_observations",
  "UPDATE integration_stock_journals SET plan='{}'",
  "UPDATE integration_stock_journals SET decision_by=created_by",
  "UPDATE integration_cost_sources SET org_id='foreign'",
])
  test(`apply rechecks native facts: ${sql}`, (t) => {
    const c = setup(t),
      cap = captured(c),
      before = snapshot(c);
    assert.throws(() =>
      c.f.app.database.transaction(() => {
        c.f.app.database.owned("integration").run(sql);
        c.j.applyOfflineOriginalCancellationInTransaction(
          c.f.actor,
          c.reviewer,
          cap,
          reason,
        );
      }),
    );
    assert.equal(snapshot(c), before);
  });
for (const sql of [
  "DELETE FROM integration_stock_journal_observations WHERE revision=2",
  "UPDATE integration_stock_journal_observations SET body='{}' WHERE revision=3",
  "UPDATE integration_stock_journal_observations SET org_id='foreign' WHERE revision=2",
  "UPDATE integration_stock_journal_observations SET recorded_by='same'",
  "DELETE FROM integration_stock_journal_references",
  "UPDATE integration_stock_journals SET lease_id='active'",
  "UPDATE integration_stock_journals SET external_id='posted'",
  "UPDATE integration_stock_journals SET state='unknown'",
])
  test(`complete recovery refuses ${sql}`, (t) => {
    const c = setup(t),
      proof = apply(c),
      before = snapshot(c);
    assert.throws(() =>
      c.f.app.database.transaction(() => {
        c.f.app.database.owned("integration").run(sql);
        c.j.readOfflineOriginalCancellationInTransaction(
          c.reviewer,
          c.journal.id,
          proof.proof.evidence.evidenceHash,
          proof.proof.cancellation.hash,
        );
      }),
    );
    assert.equal(snapshot(c), before);
  });
test("recovery requires both exact hashes and fresh authority, is read-only and works after reopen", (t) => {
  const c = setup(t),
    proof = apply(c),
    before = snapshot(c);
  const inside = () =>
    c.j.readOfflineOriginalCancellationInTransaction(
      c.reviewer,
      c.journal.id,
      proof.proof.evidence.evidenceHash,
      proof.proof.cancellation.hash,
    );
  assert.throws(inside, { code: "TRANSACTION" });
  for (const hashes of [
    [digest("wrong"), proof.proof.cancellation.hash],
    [proof.proof.evidence.evidenceHash, digest("wrong")],
  ])
    assert.throws(() =>
      c.f.app.database.transaction(() =>
        c.j.readOfflineOriginalCancellationInTransaction(
          c.reviewer,
          c.journal.id,
          hashes[0]!,
          hashes[1]!,
        ),
      ),
    );
  c.f.app.database.transaction(() => {
    const s = c.f.app.database.owned("integration"),
      n = s.get("SELECT total_changes() AS n")!.n;
    assert.deepEqual(inside(), proof);
    assert.equal(s.get("SELECT total_changes() AS n")!.n, n);
  });
  assert.throws(
    () =>
      c.f.app.database.transaction(() => {
        c.f.app.database
          .owned("iam")
          .run("UPDATE iam_users SET active=0 WHERE id=?", c.reviewer.id);
        inside();
      }),
    { code: "FORBIDDEN" },
  );
  assert.equal(snapshot(c), before);
  c.f.app.close();
  c.f.app = new Application(c.f.path, "CA", { eventReports: false });
  assert.deepEqual(recover(c, proof), proof);
  assert.equal(snapshot(c), before);
});
for (const fail of ["second observation", "state update"])
  test(`real SQLite ${fail} failure rolls back observations, audit and state`, (t) => {
    const c = setup(t),
      cap = captured(c),
      db = new DatabaseSync(c.f.path);
    const ddl =
      fail === "second observation"
        ? "CREATE TRIGGER synthetic_late_failure BEFORE INSERT ON integration_stock_journal_observations WHEN NEW.revision=3 BEGIN SELECT RAISE(ABORT,'synthetic late SQL failure'); END"
        : "CREATE TRIGGER synthetic_late_failure BEFORE UPDATE ON integration_stock_journals WHEN NEW.state='cancelled' BEGIN SELECT RAISE(ABORT,'synthetic late SQL failure'); END";
    db.exec(ddl);
    const before = snapshot(c);
    try {
      assert.throws(() => apply(c, cap), /synthetic late SQL failure/);
      assert.equal(snapshot(c), before);
    } finally {
      db.exec("DROP TRIGGER synthetic_late_failure");
      db.close();
    }
    assert.equal(native(c).attempts[0]!.history.length, 1);
  });
test("native audit failure escapes and rolls back; successful owner call is still subject to outer rollback", (t) => {
  const c = setup(t),
    cap = captured(c),
    before = snapshot(c);
  const original = c.f.app.platform.audit.bind(c.f.app.platform);
  let calls = 0;
  const spy = t.mock.method(
    c.f.app.platform,
    "audit",
    (...args: Parameters<typeof original>) => {
      original(...args);
      if (++calls === 2) throw Error("synthetic audit failure");
    },
  );
  assert.throws(() => apply(c, cap), /synthetic audit failure/);
  spy.mock.restore();
  assert.equal(snapshot(c), before);
  assert.throws(
    () =>
      c.f.app.database.transaction(() => {
        c.j.applyOfflineOriginalCancellationInTransaction(
          c.f.actor,
          c.reviewer,
          cap,
          reason,
        );
        throw Error("outer rollback");
      }),
    /outer rollback/,
  );
  assert.equal(snapshot(c), before);
});
test("late apparently valid retained change cannot escape complete before/after conservation", (t) => {
  const c = setup(t),
    cap = captured(c),
    before = snapshot(c),
    original = c.f.app.platform.audit.bind(c.f.app.platform);
  const spy = t.mock.method(
    c.f.app.platform,
    "audit",
    (...args: Parameters<typeof original>) => {
      original(...args);
      c.f.app.database
        .owned("integration")
        .run(
          "UPDATE integration_stock_journals SET decision_reason='other' WHERE id=?",
          c.journal.id,
        );
    },
  );
  assert.throws(() => apply(c, cap));
  spy.mock.restore();
  assert.equal(snapshot(c), before);
});
test("recovery oversized UTF8 preflight materializes zero owning text", (t) => {
  const c = setup(t),
    proof = apply(c);
  c.f.app.database
    .owned("integration")
    .run(
      "UPDATE integration_stock_journal_observations SET body=? WHERE revision=2",
      "x\0" + "界".repeat(666667),
    );
  const execute = c.f.app.database.execute.bind(c.f.app.database);
  let bytes = 0;
  function scan(v: unknown) {
    if (typeof v === "string") bytes += Buffer.byteLength(v);
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
  assert.throws(() => recover(c, proof), { code: "OFFLINE_ORIGINAL_LIMIT" });
  spy.mock.restore();
  assert.equal(bytes, 0);
});

test("changed independent native permission history invalidates the old capture", (t) => {
  const c = setup(t),
    cap = captured(c);
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
    p = c.j.preparePermission(c.f.actor, "permission", {
      journalId: c.journal.id,
      reviewHash: review.journal.reviewHash,
      previousPermissionHash: review.previousPermissionHash,
      authority: review.authority,
      mode: review.mode,
      reason,
    });
  c.j.decidePermission(c.reviewer, "approve-permission", {
    journalId: c.journal.id,
    permissionReviewId: p.id,
    permissionReviewHash: p.reviewHash,
    decision: "approve",
    reason,
  });
  c.f.app.platform.isolateRestore(
    digest("synthetic-backup"),
    cap.native.hold.source_completed_at,
  );
  const before = snapshot(c);
  assert.throws(() => apply(c, cap));
  assert.equal(snapshot(c), before);
  const currentProof = apply(c);
  assert.equal(currentProof.attempts[0]!.permission.reviews.length, 1);
});
test("a capture issued for another native store/org supplies no owning proof", (t) => {
  const c = setup(t),
    other = setup(t),
    cap = captured(other),
    before = snapshot(c);
  assert.throws(() => apply(c, cap));
  assert.equal(snapshot(c), before);
});
test("validly rehashed same-author terminal observation still fails independent cancellation proof", (t) => {
  const c = setup(t),
    proof = apply(c),
    s = c.f.app.database.owned("integration"),
    o = proof.proof.cancellation;
  const forged = digest(
    canonical({
      journalId: c.journal.id,
      orgId: c.reviewer.orgId,
      revision: o.revision,
      body: o.body,
      recordedBy: c.f.actor.id,
      recordedAt: o.recordedAt,
    }),
  );
  s.run(
    "UPDATE integration_stock_journal_observations SET recorded_by=?,hash=? WHERE journal_id=? AND revision=?",
    c.f.actor.id,
    forged,
    c.journal.id,
    o.revision,
  );
  assert.throws(
    () =>
      c.f.app.database.transaction(() =>
        c.j.readOfflineOriginalCancellationInTransaction(
          c.reviewer,
          c.journal.id,
          proof.proof.evidence.evidenceHash,
          forged,
        ),
      ),
    { code: "JOURNAL_INTEGRITY" },
  );
});
test("complete global history refuses orphan observations and foreign reference copies without leaking rows", (t) => {
  const c = setup(t),
    proof = apply(c),
    db = new DatabaseSync(c.f.path);
  // Deliberate damaged-backup fixture only. Native connections keep their FK
  // enforcement; this separate connection creates otherwise unreachable damage.
  db.exec("PRAGMA foreign_keys=OFF");
  try {
    for (const sql of [
      "INSERT INTO integration_stock_journal_observations SELECT 'orphan',1,'foreign',body,hash,recorded_by,recorded_at FROM integration_stock_journal_observations WHERE revision=1",
      "UPDATE integration_stock_journal_references SET org_id='foreign'",
    ]) {
      db.exec(sql);
      assert.throws(() => recover(c, proof), {
        code: "OFFLINE_ORIGINAL_REVIEW",
      });
      db.exec(
        "DELETE FROM integration_stock_journal_observations WHERE journal_id='orphan'",
      );
      db.prepare(
        "UPDATE integration_stock_journal_references SET org_id=?",
      ).run(c.reviewer.orgId);
    }
  } finally {
    db.close();
  }
  assert.deepEqual(recover(c, proof), proof);
});
for (const subtype of ["count", "aggregate", "JSON complexity"])
  test(`recovery ${subtype} preflight precedes all owning text`, (t) => {
    const c = setup(t),
      proof = apply(c),
      s = c.f.app.database.owned("integration");
    if (subtype === "count")
      for (let i = 4; i <= 129; i++)
        s.run(
          "INSERT INTO integration_stock_journal_observations SELECT journal_id,?,org_id,body,hash,recorded_by,recorded_at FROM integration_stock_journal_observations WHERE revision=1",
          i,
        );
    if (subtype === "aggregate") {
      for (let i = 4; i <= 6; i++)
        s.run(
          "INSERT INTO integration_stock_journal_observations SELECT journal_id,?,org_id,body,hash,recorded_by,recorded_at FROM integration_stock_journal_observations WHERE revision=1",
          i,
        );
      s.run(
        "UPDATE integration_stock_journal_observations SET body=?",
        JSON.stringify("x".repeat(1_500_000)),
      );
    }
    if (subtype === "JSON complexity")
      s.run(
        "UPDATE integration_stock_journal_observations SET body=? WHERE revision=2",
        "[".repeat(513) + "0" + "]".repeat(513),
      );
    const execute = c.f.app.database.execute.bind(c.f.app.database);
    let bytes = 0;
    function scan(v: unknown) {
      if (typeof v === "string") bytes += Buffer.byteLength(v);
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
    assert.throws(() => recover(c, proof), { code: "OFFLINE_ORIGINAL_LIMIT" });
    spy.mock.restore();
    assert.equal(bytes, 0);
  });
test("fresh recovery hold/password policy remains mandatory after retained cancellation", (t) => {
  const c = setup(t),
    proof = apply(c);
  for (const change of ["hold", "password", "policy"]) {
    assert.throws(() =>
      c.f.app.database.transaction(() => {
        if (change === "hold")
          c.f.app.database
            .owned("platform")
            .run("DELETE FROM platform_recovery");
        if (change === "password")
          c.f.app.database
            .owned("iam")
            .run(
              "INSERT INTO iam_user_security VALUES(?,1,1,'2026-10-03T00:00:00.000Z') ON CONFLICT(user_id) DO UPDATE SET password_change_required=1",
              c.reviewer.id,
            );
        if (change === "policy")
          c.f.app.database
            .owned("integration")
            .run(
              "UPDATE integration_cost_policies SET policy_hash=?",
              digest("other"),
            );
        c.j.readOfflineOriginalCancellationInTransaction(
          c.reviewer,
          c.journal.id,
          proof.proof.evidence.evidenceHash,
          proof.proof.cancellation.hash,
        );
      }),
    );
  }
});
