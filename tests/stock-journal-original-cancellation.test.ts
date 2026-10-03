import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { canonical, digest } from "../src/server/core.ts";
import { createHttp } from "../src/server/http.ts";
import { journalFixture, postedResult } from "./stock-journal-fixture.ts";

function uncertain(t: TestContext) {
  const fixture = journalFixture(t),
    journal = fixture.approve(),
    lease = fixture.j.claim(fixture.f.actor, journal.id, "write")!;
  fixture.j.beforeWrite(lease);
  fixture.j.unresolved(lease, "transport-uncertain");
  return { ...fixture, journal };
}
function proofInput(fixture: ReturnType<typeof uncertain>) {
  const { f, j, journal } = fixture;
  return {
    journalId: journal.id,
    reviewHash: j.originalCancellationEvidenceReview(f.actor, journal.id)
      .reviewHash,
    requestRef: journal.requestRef,
    externalRef: "synthetic:final-cancellation-case",
    evidence:
      "Synthetic exact-request cancellation, verified non-posting and prevention of later posting",
    cancellationFinal: true as const,
    nonPostingVerified: true as const,
    noLaterPosting: true as const,
  };
}
function facts(path: string) {
  const db = new DatabaseSync(path);
  try {
    return digest(
      canonical(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
          )
          .all()
          .map(({ name }) =>
            db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all(),
          ),
      ),
    );
  } finally {
    db.close();
  }
}

test("original cancellation refuses absent proof and lookup misses, exact-field violations and incomplete final attestations atomically", (t) => {
  const fixture = uncertain(t),
    { f, j, journal, reviewer } = fixture,
    input = proofInput(fixture),
    before = facts(f.path);
  assert.throws(() => j.originalCancellationReview(reviewer, journal.id), {
    code: "JOURNAL_CANCELLATION_EVIDENCE",
  });
  assert.throws(
    () =>
      j.cancelOriginalAttempt(reviewer, "no-proof", {
        journalId: journal.id,
        requestRef: journal.requestRef,
        evidenceHash: "0".repeat(64),
        reason: "Lookup miss is insufficient",
      }),
    { code: "JOURNAL_CANCELLATION_EVIDENCE" },
  );
  for (const field of [
    "cancellationFinal",
    "nonPostingVerified",
    "noLaterPosting",
  ])
    assert.throws(
      () =>
        j.recordOriginalCancellationEvidence(f.actor, field, {
          ...input,
          [field]: false,
        } as any),
      { code: "JOURNAL_CANCELLATION_EVIDENCE" },
    );
  for (const malformed of [
    { ...input, extra: true },
    { ...input, evidence: "" },
    { ...input, requestRef: "DJ-invalid" },
    { ...input, reviewHash: "bad" },
  ])
    assert.throws(() =>
      j.recordOriginalCancellationEvidence(f.actor, "malformed", malformed),
    );
  assert.equal(facts(f.path), before);
  const lookup = j.claim(f.actor, journal.id, "lookup")!;
  j.unresolved(lookup, "lookup-miss");
  const missing = facts(f.path);
  assert.throws(() => j.originalCancellationReview(reviewer, journal.id), {
    code: "JOURNAL_CANCELLATION_EVIDENCE",
  });
  assert.throws(
    () => j.recordOriginalCancellationEvidence(f.actor, "stale", input),
    { code: "JOURNAL_REVIEW_CHANGED" },
  );
  assert.equal(facts(f.path), missing);
});

test("original cancellation binds the newest complete history and superseded proof requires another review", (t) => {
  const fixture = uncertain(t),
    { f, j, journal, reviewer } = fixture,
    firstInput = proofInput(fixture),
    first = j.recordOriginalCancellationEvidence(f.actor, "first", firstInput);
  const lookup = j.claim(f.actor, journal.id, "lookup")!;
  assert.throws(
    () =>
      j.cancelOriginalAttempt(reviewer, "running", {
        journalId: journal.id,
        requestRef: journal.requestRef,
        evidenceHash: first.evidence.evidenceHash,
        reason: "Cannot cancel during lookup",
      }),
    { code: "JOURNAL_STATE" },
  );
  j.unresolved(lookup, "lookup-miss");
  assert.throws(() => j.originalCancellationReview(reviewer, journal.id), {
    code: "JOURNAL_CANCELLATION_EVIDENCE",
  });
  const currentInput = proofInput(fixture),
    current = j.recordOriginalCancellationEvidence(
      f.actor,
      "current",
      currentInput,
    ),
    before = facts(f.path);
  assert.throws(
    () =>
      j.cancelOriginalAttempt(reviewer, "stale", {
        journalId: journal.id,
        requestRef: journal.requestRef,
        evidenceHash: first.evidence.evidenceHash,
        reason: "Must bind the newest proof",
      }),
    { code: "JOURNAL_CANCELLATION" },
  );
  assert.throws(
    () =>
      j.cancelOriginalAttempt(reviewer, "wrong-ref", {
        journalId: journal.id,
        requestRef: "DJ-" + "0".repeat(18),
        evidenceHash: current.evidence.evidenceHash,
        reason: "Wrong reference",
      }),
    { code: "JOURNAL_CANCELLATION" },
  );
  assert.equal(facts(f.path), before);
  assert.deepEqual(
    j.recordOriginalCancellationEvidence(f.actor, "first", firstInput),
    first,
  );
  assert.equal(
    j.cancelOriginalAttempt(reviewer, "current-cancel", {
      journalId: journal.id,
      requestRef: journal.requestRef,
      evidenceHash: current.evidence.evidenceHash,
      reason: "Newest separately reviewed proof",
    }).state,
    "cancelled",
  );
});

test("original review and local cancellation remain available during restored-store isolation", (t) => {
  const fixture = uncertain(t),
    { f, j, journal, reviewer } = fixture,
    input = proofInput(fixture),
    db = new DatabaseSync(f.path);
  db.prepare("INSERT INTO platform_recovery VALUES(1,?,?,?)").run(
    "synthetic",
    "2026-10-03T00:00:00Z",
    "2026-10-02T00:00:00Z",
  );
  db.close();
  const before = facts(f.path);
  assert.equal(
    j.originalCancellationEvidenceReview(f.actor, journal.id).reviewHash,
    input.reviewHash,
  );
  assert.equal(facts(f.path), before);
  const proof = j.recordOriginalCancellationEvidence(
    f.actor,
    "held-proof",
    input,
  );
  assert.equal(
    j.originalCancellationReview(reviewer, journal.id).canConfirm,
    true,
  );
  assert.equal(
    j.cancelOriginalAttempt(reviewer, "held-cancel", {
      journalId: journal.id,
      requestRef: journal.requestRef,
      evidenceHash: proof.evidence.evidenceHash,
      reason: "Local review during isolation",
    }).state,
    "cancelled",
  );
  assert.throws(() => j.claim(f.actor, journal.id, "write"), {
    code: "RECOVERY_HOLD",
  });
});

test("original cancellation refreshes finance authority before reads, new decisions and cached recovery", (t) => {
  const fixture = uncertain(t),
    { f, j, journal, reviewer } = fixture,
    input = proofInput(fixture),
    proof = j.recordOriginalCancellationEvidence(f.actor, "proof", input),
    cancelInput = {
      journalId: journal.id,
      requestRef: journal.requestRef,
      evidenceHash: proof.evidence.evidenceHash,
      reason: "Independent synthetic cancellation",
    };
  const before = facts(f.path);
  assert.throws(() =>
    j.originalCancellationEvidenceReview(
      { ...f.actor, orgId: "foreign" },
      journal.id,
    ),
  );
  assert.throws(() =>
    j.recordOriginalCancellationEvidence(
      { ...f.actor, orgId: "foreign" },
      "foreign",
      input,
    ),
  );
  assert.throws(() =>
    j.cancelOriginalAttempt(
      { ...reviewer, orgId: "foreign" },
      "foreign",
      cancelInput,
    ),
  );
  assert.equal(facts(f.path), before);
  const db = new DatabaseSync(f.path);
  db.prepare("UPDATE iam_users SET role='sales' WHERE id=?").run(reviewer.id);
  const revoked = facts(f.path);
  assert.throws(() => j.originalCancellationReview(reviewer, journal.id), {
    code: "FORBIDDEN",
  });
  assert.throws(
    () => j.cancelOriginalAttempt(reviewer, "cancel", cancelInput),
    { code: "FORBIDDEN" },
  );
  assert.equal(facts(f.path), revoked);
  db.prepare("UPDATE iam_users SET role='finance' WHERE id=?").run(reviewer.id);
  j.cancelOriginalAttempt(reviewer, "cancel", cancelInput);
  db.prepare("UPDATE iam_users SET role='sales' WHERE id=?").run(reviewer.id);
  const cancelled = facts(f.path);
  assert.throws(
    () => j.cancelOriginalAttempt(reviewer, "cancel", cancelInput),
    { code: "FORBIDDEN" },
  );
  assert.equal(facts(f.path), cancelled);
  db.prepare("UPDATE iam_users SET role='sales' WHERE id=?").run(f.actor.id);
  const revokedProof = facts(f.path);
  assert.throws(
    () => j.recordOriginalCancellationEvidence(f.actor, "proof", input),
    { code: "FORBIDDEN" },
  );
  assert.equal(facts(f.path), revokedProof);
  db.close();
});

test("original final evidence verifies the full history beyond the detail cap and permanent reference ownership", (t) => {
  const fixture = uncertain(t),
    { f, j, journal } = fixture;
  for (let i = 0; i < 103; i++)
    j.unresolved(j.claim(f.actor, journal.id, "lookup")!, "lookup-miss");
  const input = proofInput(fixture);
  assert.equal(j.detail(f.actor, journal.id).olderObservations, true);
  const db = new DatabaseSync(f.path),
    first = db
      .prepare(
        "SELECT hash FROM integration_stock_journal_observations WHERE journal_id=? AND revision=1",
      )
      .get(journal.id)!;
  db.prepare(
    "UPDATE integration_stock_journal_observations SET hash=? WHERE journal_id=? AND revision=1",
  ).run("0".repeat(64), journal.id);
  const corrupt = facts(f.path);
  assert.throws(
    () => j.recordOriginalCancellationEvidence(f.actor, "corrupt", input),
    { code: "JOURNAL_INTEGRITY" },
  );
  assert.equal(facts(f.path), corrupt);
  db.prepare(
    "UPDATE integration_stock_journal_observations SET hash=? WHERE journal_id=? AND revision=1",
  ).run(String(first.hash), journal.id);
  db.prepare(
    "DELETE FROM integration_stock_journal_references WHERE journal_id=?",
  ).run(journal.id);
  const missing = facts(f.path);
  assert.throws(
    () => j.originalCancellationEvidenceReview(f.actor, journal.id),
    { code: "JOURNAL_INTEGRITY" },
  );
  assert.equal(facts(f.path), missing);
  db.close();
});

test("original evidence and cancellation rollback every effect when command receipt persistence fails", (t) => {
  const fixture = uncertain(t),
    { f, j, journal, reviewer } = fixture,
    input = proofInput(fixture),
    db = new DatabaseSync(f.path);
  db.exec(
    "CREATE TRIGGER synthetic_receipt_failure BEFORE INSERT ON platform_commands WHEN new.name='accounting.journal.original-cancellation.evidence' BEGIN SELECT RAISE(ABORT,'synthetic receipt failure'); END",
  );
  const before = facts(f.path);
  assert.throws(
    () => j.recordOriginalCancellationEvidence(f.actor, "proof", input),
    /synthetic receipt failure/,
  );
  assert.equal(facts(f.path), before);
  db.exec("DROP TRIGGER synthetic_receipt_failure");
  const proof = j.recordOriginalCancellationEvidence(f.actor, "proof", input),
    cancelInput = {
      journalId: journal.id,
      requestRef: journal.requestRef,
      evidenceHash: proof.evidence.evidenceHash,
      reason: "Independent synthetic review",
    };
  db.exec(
    "CREATE TRIGGER synthetic_receipt_failure BEFORE INSERT ON platform_commands WHEN new.name='accounting.journal.cancel-original' BEGIN SELECT RAISE(ABORT,'synthetic receipt failure'); END",
  );
  const retained = facts(f.path);
  assert.throws(
    () => j.cancelOriginalAttempt(reviewer, "cancel", cancelInput),
    /synthetic receipt failure/,
  );
  assert.equal(facts(f.path), retained);
  assert.equal(j.detail(f.actor, journal.id).state, "unknown");
  db.exec("DROP TRIGGER synthetic_receipt_failure");
  assert.equal(
    j.cancelOriginalAttempt(reviewer, "cancel", cancelInput).state,
    "cancelled",
  );
  db.close();
});

test("original cached evidence and cancellation receipts refuse forged result fields", (t) => {
  const fixture = uncertain(t),
    { f, j, journal, reviewer } = fixture,
    input = proofInput(fixture),
    proof = j.recordOriginalCancellationEvidence(f.actor, "proof", input),
    cancelInput = {
      journalId: journal.id,
      requestRef: journal.requestRef,
      evidenceHash: proof.evidence.evidenceHash,
      reason: "Synthetic independent review",
    },
    cancelled = j.cancelOriginalAttempt(reviewer, "cancel", cancelInput),
    db = new DatabaseSync(f.path);
  for (const forged of [
    { ...proof, evidence: { ...proof.evidence, evidenceHash: undefined } },
    { ...proof, journal: { ...proof.journal, externalId: "999" } },
  ]) {
    db.prepare(
      "UPDATE platform_commands SET result=? WHERE actor_id=? AND key='proof'",
    ).run(JSON.stringify(forged), f.actor.id);
    const before = facts(f.path);
    assert.throws(
      () => j.recordOriginalCancellationEvidence(f.actor, "proof", input),
      { code: "JOURNAL_INTEGRITY" },
    );
    assert.equal(facts(f.path), before);
  }
  db.prepare(
    "UPDATE platform_commands SET result=? WHERE actor_id=? AND key='proof'",
  ).run(canonical(proof), f.actor.id);
  db.prepare(
    "UPDATE platform_commands SET result=? WHERE actor_id=? AND key='cancel'",
  ).run(canonical({ ...cancelled, dispatched: false }), reviewer.id);
  const before = facts(f.path);
  assert.throws(
    () => j.cancelOriginalAttempt(reviewer, "cancel", cancelInput),
    { code: "JOURNAL_INTEGRITY" },
  );
  assert.equal(facts(f.path), before);
  db.close();
});

test("original evidence refuses non-original, pending and internally inconsistent uncertain ownership", (t) => {
  const pending = journalFixture(t),
    approved = pending.approve();
  assert.throws(
    () =>
      pending.j.originalCancellationEvidenceReview(
        pending.f.actor,
        approved.id,
      ),
    { code: "JOURNAL_STATE" },
  );
  const correction = journalFixture(t, "CA", true),
    corrected = correction.approve();
  correction.j.unresolved(
    correction.j.claim(correction.f.actor, corrected.id, "write")!,
    "transport-uncertain",
  );
  assert.throws(
    () =>
      correction.j.originalCancellationEvidenceReview(
        correction.f.actor,
        corrected.id,
      ),
    { code: "JOURNAL_STATE" },
  );
  const fixture = uncertain(t),
    { f, j, journal } = fixture,
    input = proofInput(fixture),
    db = new DatabaseSync(f.path);
  db.prepare(
    "UPDATE integration_stock_journals SET lease_id='synthetic-unreleased' WHERE id=?",
  ).run(journal.id);
  const before = facts(f.path);
  assert.throws(
    () => j.recordOriginalCancellationEvidence(f.actor, "inconsistent", input),
    { code: "JOURNAL_INTEGRITY" },
  );
  assert.equal(facts(f.path), before);
  db.close();
});

test("original evidence refuses an uncertain row whose retained outcome history was removed", (t) => {
  const fixture = uncertain(t),
    { f, j, journal } = fixture,
    db = new DatabaseSync(f.path);
  db.prepare(
    "DELETE FROM integration_stock_journal_observations WHERE journal_id=?",
  ).run(journal.id);
  const before = facts(f.path);
  assert.throws(
    () => j.originalCancellationEvidenceReview(f.actor, journal.id),
    { code: "JOURNAL_INTEGRITY" },
  );
  assert.equal(facts(f.path), before);
  db.close();
});

for (const region of ["CA", "US"] as const)
  test(`${region} HTTP original evidence and separate cancellation use authenticated exact task-shaped controls`, async (t) => {
    const fixture = journalFixture(t, region),
      { f, j, reviewer } = fixture,
      journal = fixture.approve(),
      lease = j.claim(f.actor, journal.id, "write")!;
    j.beforeWrite(lease);
    j.unresolved(lease, "transport-uncertain");
    const http = await createHttp(f.app, { origin: "http://localhost" });
    t.after(() => void http.close());
    const evidenceUrl = `/api/accounting/journals/${journal.id}/original-cancellation-evidence-review`,
      cancellationUrl = `/api/accounting/journals/${journal.id}/original-cancellation-review`;
    for (const url of [evidenceUrl, cancellationUrl])
      assert.equal((await http.inject({ method: "GET", url })).statusCode, 401);
    const session = async (email: string, password: string) => {
        const login = await http.inject({
          method: "POST",
          url: "/api/login",
          headers: { origin: "http://localhost" },
          payload: { email, password },
        });
        assert.equal(login.statusCode, 200);
        return {
          cookie: login.headers["set-cookie"]!.toString().split(";")[0]!,
          origin: "http://localhost",
          "x-csrf-token": login.json().csrf,
        };
      },
      admin = await session("admin@example.test", "long-test-only-password"),
      finance = await session(
        "finance@example.test",
        "test-only-long-password",
      ),
      post = (name: string, payload: unknown, key: string, headers = admin) =>
        http.inject({
          method: "POST",
          url: `/api/commands/accounting.journal.${name}`,
          headers: { ...headers, "idempotency-key": key },
          payload: payload as any,
        });
    const before = facts(f.path),
      read = await http.inject({
        method: "GET",
        url: evidenceUrl,
        headers: admin,
      });
    assert.equal(read.statusCode, 200, read.body);
    assert.equal(read.headers["cache-control"], "no-store");
    assert.deepEqual(
      read.json(),
      j.originalCancellationEvidenceReview(f.actor, journal.id),
    );
    for (const url of [evidenceUrl, cancellationUrl])
      assert.equal(
        (
          await http.inject({
            method: "GET",
            url: url + "?dispatch=true",
            headers: admin,
          })
        ).statusCode,
        400,
      );
    assert.equal(facts(f.path), before);
    const input = {
      ...proofInput({ ...fixture, journal }),
      reviewHash: read.json().reviewHash,
    };
    assert.equal(
      (
        await post("original-cancellation.evidence", input, "csrf", {
          ...admin,
          "x-csrf-token": "bad",
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await post("original-cancellation.evidence", input, "origin", {
          ...admin,
          origin: "http://elsewhere",
        })
      ).statusCode,
      403,
    );
    // The HTTP boundary deliberately audits authorization refusals.
    const denied = facts(f.path);
    for (const invalid of [
      { ...input, extra: true },
      { ...input, noLaterPosting: false },
      { ...input, requestRef: "invalid" },
    ])
      assert.equal(
        (await post("original-cancellation.evidence", invalid, "invalid"))
          .statusCode,
        400,
      );
    assert.equal(facts(f.path), denied);
    const response = await post(
      "original-cancellation.evidence",
      input,
      "proof",
    );
    assert.equal(response.statusCode, 200, response.body);
    const proof = response.json();
    assert.deepEqual(
      (await post("original-cancellation.evidence", input, "proof")).json(),
      proof,
    );
    const review = await http.inject({
      method: "GET",
      url: cancellationUrl,
      headers: finance,
    });
    assert.equal(review.statusCode, 200, review.body);
    assert.equal(review.headers["cache-control"], "no-store");
    assert.deepEqual(
      review.json(),
      j.originalCancellationReview(reviewer, journal.id),
    );
    const cancel = {
        journalId: journal.id,
        requestRef: journal.requestRef,
        evidenceHash: proof.evidence.evidenceHash,
        reason: "Synthetic independent HTTP review",
      },
      retained = facts(f.path);
    assert.equal(
      (
        await post(
          "cancel-original",
          { ...cancel, retry: true },
          "extra",
          finance,
        )
      ).statusCode,
      400,
    );
    assert.equal(
      (await post("cancel-original", cancel, "self")).statusCode,
      409,
    );
    assert.equal(facts(f.path), retained);
    const cancelled = await post("cancel-original", cancel, "cancel", finance);
    assert.equal(cancelled.statusCode, 200, cancelled.body);
    assert.equal(cancelled.json().state, "cancelled");
    assert.deepEqual(
      (await post("cancel-original", cancel, "cancel", finance)).json(),
      cancelled.json(),
    );
    assert.equal(j.detail(f.actor, journal.id).state, "cancelled");
  });

for (const region of ["CA", "US"] as const)
  test(`original journal ${region} retains final non-posting evidence and a separate cancellation decision`, (t) => {
    const { f, j, approve, reviewer, make } = journalFixture(t, region),
      journal = approve(),
      lease = j.claim(f.actor, journal.id, "write")!;
    j.beforeWrite(lease);
    j.unresolved(lease, "transport-uncertain");
    const review = j.originalCancellationEvidenceReview(f.actor, journal.id);
    const input = {
      journalId: journal.id,
      reviewHash: review.reviewHash,
      requestRef: journal.requestRef,
      externalRef: "synthetic:final-cancellation-case",
      evidence:
        "Synthetic receiver checked the exact request and prevented later posting",
      cancellationFinal: true as const,
      nonPostingVerified: true as const,
      noLaterPosting: true as const,
    };
    const proof = j.recordOriginalCancellationEvidence(f.actor, "proof", input);
    assert.equal(proof.evidence.input.externalRef, input.externalRef);
    assert.equal(proof.evidence.recordedBy, f.actor.id);
    assert.equal(j.detail(f.actor, journal.id).state, "unknown");
    assert.equal(
      j.originalCancellationReview(f.actor, journal.id).canConfirm,
      false,
    );
    assert.equal(
      j.originalCancellationReview(reviewer, journal.id).canConfirm,
      true,
    );
    const cancelInput = {
      journalId: journal.id,
      requestRef: journal.requestRef,
      evidenceHash: proof.evidence.evidenceHash,
      reason: "Synthetic independent final non-posting review",
    };
    assert.throws(() => j.cancelOriginalAttempt(f.actor, "self", cancelInput), {
      code: "JOURNAL_CANCELLATION",
    });
    const cancelled = j.cancelOriginalAttempt(reviewer, "cancel", cancelInput);
    assert.equal(cancelled.state, "cancelled");
    assert.equal(cancelled.requestRef, journal.requestRef);
    assert.equal(cancelled.dispatched, true);
    assert.equal(cancelled.externalId, null);
    assert.equal(cancelled.cancellation.recordedBy, reviewer.id);
    assert.equal(j.claim(f.actor, journal.id, "write"), null);
    assert.equal(j.claim(f.actor, journal.id, "lookup"), null);
    assert.throws(() => j.prepare(f.actor, "duplicate", make()), {
      code: "JOURNAL_DUPLICATE",
    });
    assert.deepEqual(
      j.cancelOriginalAttempt(reviewer, "cancel", cancelInput),
      cancelled,
    );
    assert.deepEqual(
      j.recordOriginalCancellationEvidence(f.actor, "proof", input),
      proof,
    );
    const incomplete = f.app.integration.costs.journalReconciliation(
      reviewer,
      journal.sourceId,
    );
    assert.equal(incomplete.canConfirm, false);
    assert.equal(incomplete.dates[0]!.journal!.state, "cancelled");
  });

test("original evidence receipt recovers its historical unknown view after a lookup posts", (t) => {
  const { f, j, approve, reviewer } = journalFixture(t),
    journal = approve(),
    write = j.claim(f.actor, journal.id, "write")!;
  j.beforeWrite(write);
  j.unresolved(write, "transport-uncertain");
  const review = j.originalCancellationEvidenceReview(f.actor, journal.id),
    input = {
      journalId: journal.id,
      reviewHash: review.reviewHash,
      requestRef: journal.requestRef,
      externalRef: "synthetic:receiver-case",
      evidence: "Synthetic case evidence requiring independent review",
      cancellationFinal: true as const,
      nonPostingVerified: true as const,
      noLaterPosting: true as const,
    },
    proof = j.recordOriginalCancellationEvidence(f.actor, "proof", input),
    lookup = j.claim(f.actor, journal.id, "lookup")!;
  assert.deepEqual(
    j.recordOriginalCancellationEvidence(f.actor, "proof", input),
    proof,
  );
  j.posted(lookup, postedResult(lookup));
  assert.deepEqual(
    j.recordOriginalCancellationEvidence(f.actor, "proof", input),
    proof,
  );
  assert.equal(j.detail(f.actor, journal.id).state, "posted");
  assert.throws(() => j.originalCancellationReview(reviewer, journal.id), {
    code: "JOURNAL_STATE",
  });
  assert.throws(
    () =>
      j.cancelOriginalAttempt(reviewer, "cancel", {
        journalId: journal.id,
        requestRef: journal.requestRef,
        evidenceHash: proof.evidence.evidenceHash,
        reason:
          "Synthetic now-conflicting evidence must not cancel a posted request",
      }),
    { code: "JOURNAL_STATE" },
  );
});
