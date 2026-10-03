import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { cancellationFixture } from "./stock-journal-cancellation-fixture.ts";
import { journalFixture } from "./stock-journal-fixture.ts";
import { createHttp } from "../src/server/http.ts";
import { canonical, digest } from "../src/server/core.ts";
function facts(path: string) {
  const db = new DatabaseSync(path);
  try {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all();
    return digest(
      canonical(
        tables.map(({ name }) =>
          db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all(),
        ),
      ),
    );
  } finally {
    db.close();
  }
}
for (const region of ["CA", "US"] as const)
  test(`cancellation review ${region} is read-only, current, independent and available under provider hold`, (t) => {
    const { f, j, journal, reviewer } = cancellationFixture(t, region);
    const before = facts(f.path),
      review = j.cancellationReview(f.actor, journal.id);
    assert.equal(review.journal.requestRef, journal.requestRef);
    assert.equal(
      review.evidence.input.externalRef,
      "synthetic-cancelled-reversal",
    );
    assert.equal(review.evidence.input.outcome, "cancelled-unposted");
    assert.equal(review.evidence.recordedBy, reviewer.id);
    assert.equal(review.canConfirm, true);
    assert.equal(j.cancellationReview(reviewer, journal.id).canConfirm, false);
    assert.equal(facts(f.path), before);
    const db = new DatabaseSync(f.path);
    db.prepare("INSERT INTO platform_recovery VALUES(1,?,?,?)").run(
      "synthetic",
      "2026-10-03T00:00:00Z",
      "2026-10-02T00:00:00Z",
    );
    db.close();
    const held = facts(f.path);
    assert.deepEqual(j.cancellationReview(f.actor, journal.id), review);
    assert.equal(facts(f.path), held);
    const input = {
      journalId: journal.id,
      requestRef: journal.requestRef,
      evidenceHash: review.evidence.evidenceHash,
      reason: "Synthetic separate finance binding",
    };
    assert.throws(() => j.cancelCorrectionAttempt(reviewer, "self", input), {
      code: "JOURNAL_CANCELLATION",
    });
    const result = j.cancelCorrectionAttempt(f.actor, "cancel", input);
    assert.equal(result.state, "cancelled");
    assert.equal(result.cancellation.recordedBy, f.actor.id);
    assert.deepEqual(result.cancellation.body, {
      outcome: "cancelled-unposted",
      evidenceHash: input.evidenceHash,
      requestRef: input.requestRef,
      reason: input.reason,
    });
    assert.deepEqual(
      j.cancelCorrectionAttempt(f.actor, "cancel", input),
      result,
    );
    assert.throws(() => j.cancellationReview(f.actor, journal.id), {
      code: "JOURNAL_STATE",
    });
    assert.throws(() => j.claim(f.actor, journal.id, "write"), {
      code: "RECOVERY_HOLD",
    });
  });
test("cancellation evidence review refuses absent proof, originals, foreign scope, stale principals and corrupt evidence without effects", (t) => {
  const missing = cancellationFixture(t, "CA", false);
  assert.throws(
    () => missing.j.cancellationReview(missing.f.actor, missing.journal.id),
    { code: "COST_RETRY_CANCELLED" },
  );
  const original = journalFixture(t),
    approved = original.approve();
  original.j.unresolved(
    original.j.claim(original.f.actor, approved.id, "write")!,
    "transport-uncertain",
  );
  assert.throws(
    () => original.j.cancellationReview(original.f.actor, approved.id),
    { code: "JOURNAL_STATE" },
  );
  const { f, j, journal, reviewer } = cancellationFixture(t);
  const before = facts(f.path);
  assert.throws(() =>
    j.cancellationReview({ ...f.actor, orgId: "foreign" }, journal.id),
  );
  assert.equal(facts(f.path), before);
  const db = new DatabaseSync(f.path);
  db.prepare("UPDATE iam_users SET role='sales' WHERE id=?").run(reviewer.id);
  const unauthorized = facts(f.path);
  assert.throws(() => j.cancellationReview(reviewer, journal.id), {
    code: "FORBIDDEN",
  });
  assert.equal(facts(f.path), unauthorized);
  db.prepare(
    "UPDATE integration_cost_correction_outcomes SET evidence_hash=?",
  ).run("0".repeat(64));
  db.close();
  const corrupt = facts(f.path);
  assert.throws(() => j.cancellationReview(f.actor, journal.id), {
    code: "COST_INTEGRITY",
  });
  assert.equal(facts(f.path), corrupt);
});
test("HTTP cancellation review is authenticated, no-store and refuses extra fields without mutations", async (t) => {
  const { f, j, journal } = cancellationFixture(t);
  const http = await createHttp(f.app, { origin: "http://localhost" });
  t.after(() => void http.close());
  const url = `/api/accounting/journals/${journal.id}/cancellation-review`;
  assert.equal((await http.inject({ method: "GET", url })).statusCode, 401);
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin: "http://localhost" },
    payload: {
      email: "admin@example.test",
      password: "long-test-only-password",
    },
  });
  assert.equal(login.statusCode, 200);
  const headers = {
      cookie: login.headers["set-cookie"]!.toString().split(";")[0]!,
    },
    before = facts(f.path);
  const response = await http.inject({ method: "GET", url, headers });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.deepEqual(response.json(), j.cancellationReview(f.actor, journal.id));
  assert.equal(
    (await http.inject({ method: "GET", url: url + "?dispatch=true", headers }))
      .statusCode,
    400,
  );
  assert.equal(facts(f.path), before);
});
