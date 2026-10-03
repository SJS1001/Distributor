// Synthetic owner/API evidence only; no provider request or actual finance qualification.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { canonical, digest } from "../src/server/core.ts";
import { policy } from "./cost-correction-fixture.ts";
import { createHttp } from "../src/server/http.ts";
import { journalFixture, postedResult } from "./stock-journal-fixture.ts";

function cancelled(t: TestContext, region: "CA" | "US" = "CA") {
  const context = journalFixture(t, region),
    { f, j, reviewer } = context,
    journal = context.approve(),
    lease = j.claim(f.actor, journal.id, "write")!;
  j.beforeWrite(lease);
  j.unresolved(lease, "transport-uncertain");
  const proof = j.recordOriginalCancellationEvidence(f.actor, "proof", {
    journalId: journal.id,
    requestRef: journal.requestRef,
    reviewHash: j.originalCancellationEvidenceReview(f.actor, journal.id)
      .reviewHash,
    externalRef: "synthetic:final-cancellation",
    evidence:
      "Synthetic final exact-request cancellation and verified non-posting",
    cancellationFinal: true,
    nonPostingVerified: true,
    noLaterPosting: true,
  });
  const terminal = j.cancelOriginalAttempt(reviewer, "cancel", {
    journalId: journal.id,
    requestRef: journal.requestRef,
    evidenceHash: proof.evidence.evidenceHash,
    reason: "Synthetic separate cancellation review",
  });
  return { ...context, journal: terminal };
}

test("a cancelled original gets a new independently approved identity and one reconciled posting without replacing its history", (t) => {
  const { f, j, journal, reviewer, original } = cancelled(t),
    previous = j.detail(f.actor, journal.id),
    review = j.originalRetryReview(f.actor, journal.id),
    input = {
      journalId: journal.id,
      reviewHash: review.reviewHash,
      reason: "Synthetic fresh retry review",
    },
    retry = j.prepareOriginalRetry(f.actor, "retry", input);
  assert.equal(retry.state, "ready");
  assert.notEqual(retry.id, journal.id);
  assert.notEqual(retry.requestRef, journal.requestRef);
  assert.equal(retry.attemptId, journal.id);
  assert.equal(
    retry.plan.predecessor!.cancellationHash,
    journal.cancellation.hash,
  );
  assert.deepEqual(retry.plan.intent, previous.plan.intent);
  assert.deepEqual(j.detail(f.actor, journal.id), previous);
  assert.throws(() => j.claim(f.actor, retry.id, "write"), {
    code: "JOURNAL_STATE",
  });
  assert.throws(
    () =>
      j.decide(f.actor, "self", {
        journalId: retry.id,
        reviewHash: retry.reviewHash,
        decision: "approve",
        reason: "Self approval",
      }),
    { code: "JOURNAL_SEPARATE_REVIEW" },
  );
  j.decide(reviewer, "approve-retry", {
    journalId: retry.id,
    reviewHash: retry.reviewHash,
    decision: "approve",
    reason: "Synthetic independent retry approval",
  });
  const lease = j.claim(f.actor, retry.id, "write")!;
  j.beforeWrite(lease);
  j.posted(lease, postedResult(lease));
  assert.deepEqual(j.prepareOriginalRetry(f.actor, "retry", input), retry);
  assert.deepEqual(j.detail(f.actor, journal.id), previous);
  const reconciliation = f.app.integration.costs.journalReconciliation(
    reviewer,
    original.id,
  );
  assert.equal(reconciliation.canConfirm, true);
  assert.equal(reconciliation.dates.length, 1);
  assert.equal(reconciliation.dates[0]!.journal!.id, retry.id);
  assert.equal(reconciliation.debit, 18000);
  assert.equal(reconciliation.credit, 18000);
  assert.equal(j.claim(f.actor, journal.id, "write"), null);
});

for (const region of ["CA", "US"] as const)
  test(`${region} authenticated original retry API preserves exact recovery and separate approval`, async (t) => {
    const { f, j, journal } = cancelled(t, region);
    const http = await createHttp(f.app, { origin: "http://localhost" });
    t.after(() => void http.close());
    const url = `/api/accounting/journals/${journal.id}/original-retry-review`;
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
    assert.equal(login.statusCode, 200, login.body);
    const headers = {
      cookie: login.headers["set-cookie"]!.toString().split(";")[0]!,
      origin: "http://localhost",
      "x-csrf-token": login.json().csrf,
    };
    const read = await http.inject({ method: "GET", url, headers });
    assert.equal(read.statusCode, 200, read.body);
    assert.equal(read.headers["cache-control"], "no-store");
    assert.deepEqual(read.json(), j.originalRetryReview(f.actor, journal.id));
    assert.equal(
      (
        await http.inject({
          method: "GET",
          url: url + "?dispatch=true",
          headers,
        })
      ).statusCode,
      400,
    );
    const input = {
      journalId: journal.id,
      reviewHash: read.json().reviewHash,
      reason: "Synthetic HTTP retry",
    };
    const post = (payload: unknown, key = "http-retry", selected = headers) =>
      http.inject({
        method: "POST",
        url: "/api/commands/accounting.journal.original-retry.prepare",
        headers: { ...selected, "idempotency-key": key },
        payload: payload as any,
      });
    assert.equal(
      (await post(input, "csrf", { ...headers, "x-csrf-token": "bad" }))
        .statusCode,
      403,
    );
    assert.equal(
      (await post(input, "origin", { ...headers, origin: "http://elsewhere" }))
        .statusCode,
      403,
    );
    for (const invalid of [
      { ...input, extra: true },
      { ...input, reviewHash: "bad" },
      { ...input, reason: "" },
    ])
      assert.equal((await post(invalid, "invalid")).statusCode, 400);
    const response = await post(input);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().state, "ready");
    assert.deepEqual((await post(input)).json(), response.json());
    assert.equal((await post(input, "competing")).statusCode, 409);
    assert.equal(
      (
        await http.inject({
          method: "POST",
          url: "/api/commands/accounting.journal.decide",
          headers: { ...headers, "idempotency-key": "self" },
          payload: {
            journalId: response.json().id,
            reviewHash: response.json().reviewHash,
            decision: "approve",
            reason: "Self approval refused",
          },
        })
      ).statusCode,
      403,
    );
    assert.equal(j.detail(f.actor, journal.id).state, "cancelled");
  });

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
function retryInput(context: ReturnType<typeof cancelled>) {
  return {
    journalId: context.journal.id,
    reviewHash: context.j.originalRetryReview(
      context.f.actor,
      context.journal.id,
    ).reviewHash,
    reason: "Synthetic separately reviewed retry",
  };
}
function approveRetry(context: ReturnType<typeof cancelled>, key = "retry") {
  const input = retryInput(context),
    retry = context.j.prepareOriginalRetry(context.f.actor, key, input);
  context.j.decide(context.reviewer, key + "-decision", {
    journalId: retry.id,
    reviewHash: retry.reviewHash,
    decision: "approve",
    reason: "Synthetic independent review",
  });
  return { input, retry };
}

test("fresh original retry refuses stale reviews, malformed input, foreign authority and generic preparation bypass without changing facts", (t) => {
  const context = cancelled(t),
    { f, j, journal } = context,
    input = retryInput(context),
    before = facts(f.path);
  for (const invalid of [
    { ...input, extra: true },
    { ...input, reviewHash: "bad" },
    { ...input, reason: "" },
    { ...input, journalId: "" },
  ])
    assert.throws(() => j.prepareOriginalRetry(f.actor, "invalid", invalid));
  assert.throws(
    () =>
      j.prepareOriginalRetry(f.actor, "stale", {
        ...input,
        reviewHash: "0".repeat(64),
      }),
    { code: "JOURNAL_REVIEW_CHANGED" },
  );
  assert.throws(() =>
    j.prepareOriginalRetry({ ...f.actor, orgId: "foreign" }, "foreign", input),
  );
  assert.throws(() =>
    j.originalRetryReview({ ...f.actor, orgId: "foreign" }, journal.id),
  );
  assert.throws(
    () =>
      j.prepare(f.actor, "bypass", {
        ...context.make(),
        attemptId: journal.id,
      }),
    { code: "JOURNAL_ATTEMPT" },
  );
  assert.equal(facts(f.path), before);
});

test("unresolved, pending and posted originals cannot precede a fresh attempt", (t) => {
  const context = journalFixture(t),
    { f, j } = context,
    journal = context.approve();
  assert.throws(() => j.originalRetryReview(f.actor, journal.id), {
    code: "JOURNAL_PREDECESSOR",
  });
  const lease = j.claim(f.actor, journal.id, "write")!;
  j.beforeWrite(lease);
  j.unresolved(lease, "transport-uncertain");
  assert.throws(() => j.originalRetryReview(f.actor, journal.id), {
    code: "JOURNAL_PREDECESSOR",
  });
  const lookup = j.claim(f.actor, journal.id, "lookup")!;
  j.posted(lookup, postedResult(lookup));
  const before = facts(f.path);
  assert.throws(() => j.originalRetryReview(f.actor, journal.id), {
    code: "JOURNAL_PREDECESSOR",
  });
  assert.equal(facts(f.path), before);
});

test("one retained successor wins and a rejected successor permits a separately prepared new identity", (t) => {
  const context = cancelled(t),
    { f, j, reviewer, journal } = context,
    input = retryInput(context),
    first = j.prepareOriginalRetry(f.actor, "first", input),
    before = facts(f.path);
  assert.throws(() => j.prepareOriginalRetry(f.actor, "competing", input), {
    code: "JOURNAL_DUPLICATE",
  });
  assert.throws(() => j.originalRetryReview(f.actor, journal.id), {
    code: "JOURNAL_DUPLICATE",
  });
  assert.equal(facts(f.path), before);
  j.decide(reviewer, "reject", {
    journalId: first.id,
    reviewHash: first.reviewHash,
    decision: "reject",
    reason: "Synthetic reviewer refuses this attempt",
  });
  const next = j.prepareOriginalRetry(f.actor, "next", retryInput(context));
  assert.notEqual(next.id, first.id);
  assert.notEqual(next.requestRef, first.requestRef);
  assert.equal(j.detail(f.actor, first.id).state, "rejected");
  assert.deepEqual(j.prepareOriginalRetry(f.actor, "first", input), first);
  assert.equal(
    f.app.integration.costs.journalReconciliation(reviewer, context.original.id)
      .dates[0]!.journal!.id,
    next.id,
  );
});

test("retry receipts recover during provider isolation but fresh attempts and revoked principals are refused", (t) => {
  const context = cancelled(t),
    { f, j, journal } = context,
    input = retryInput(context),
    retry = j.prepareOriginalRetry(f.actor, "retry", input),
    db = new DatabaseSync(f.path);
  db.prepare("INSERT INTO platform_recovery VALUES(1,?,?,?)").run(
    "synthetic",
    "2026-10-03T00:00:00Z",
    "2026-10-02T00:00:00Z",
  );
  const held = facts(f.path);
  assert.deepEqual(j.prepareOriginalRetry(f.actor, "retry", input), retry);
  assert.throws(() => j.originalRetryReview(f.actor, journal.id), {
    code: "RECOVERY_HOLD",
  });
  assert.throws(() => j.prepareOriginalRetry(f.actor, "fresh", input), {
    code: "RECOVERY_HOLD",
  });
  assert.equal(facts(f.path), held);
  db.prepare("UPDATE iam_users SET role='sales' WHERE id=?").run(f.actor.id);
  const revoked = facts(f.path);
  assert.throws(() => j.prepareOriginalRetry(f.actor, "retry", input), {
    code: "FORBIDDEN",
  });
  assert.equal(facts(f.path), revoked);
  db.close();
});

test("preparation and its receipt roll back together when receipt storage fails", (t) => {
  const context = cancelled(t),
    { f, j } = context,
    input = retryInput(context),
    db = new DatabaseSync(f.path);
  db.exec(
    "CREATE TRIGGER retry_receipt_failure BEFORE INSERT ON platform_commands WHEN NEW.name='accounting.journal.original-retry.prepare' BEGIN SELECT RAISE(ABORT,'synthetic receipt failure'); END",
  );
  const before = facts(f.path);
  assert.throws(
    () => j.prepareOriginalRetry(f.actor, "retry", input),
    /synthetic receipt failure/,
  );
  assert.equal(facts(f.path), before);
  db.exec("DROP TRIGGER retry_receipt_failure");
  db.close();
  assert.equal(j.prepareOriginalRetry(f.actor, "retry", input).state, "ready");
});

for (const region of ["CA", "US"] as const)
  test(`${region} repeated final cancellations retain every ancestor and reconcile only the posted leaf`, (t) => {
    let context = cancelled(t, region);
    const originals = [context.j.detail(context.f.actor, context.journal.id)];
    for (let n = 0; n < 3; n++) {
      const { retry } = approveRetry(context, `retry-${n}`),
        lease = context.j.claim(context.f.actor, retry.id, "write")!;
      context.j.beforeWrite(lease);
      if (n === 2) {
        context.j.posted(lease, postedResult(lease));
        const costs = context.f.app.integration.costs,
          review = costs.journalReconciliation(
            context.reviewer,
            context.original.id,
          );
        assert.equal(review.canConfirm, true);
        assert.equal(review.dates[0]!.journal!.id, retry.id);
        const input = {
          packetId: context.original.id,
          contentHash: review.contentHash,
          reviewHash: review.reviewHash,
          externalRef: "synthetic:retry-chain-reconciliation",
          reason: "Synthetic independent exact leaf reconciliation",
          confirmation: "all-dates-reconciled" as const,
          journals: review.dates.map((d) => ({
            journalId: d.journal!.id,
            postingDate: d.postingDate,
            externalId: d.journal!.posted!.externalId,
            syncToken: "0",
            debit: d.debit,
            credit: d.credit,
            evidenceRef: "synthetic:independent-ledger-check",
          })),
        };
        const accepted = costs.reconcileJournals(
          context.reviewer,
          "reconcile",
          input,
        );
        assert.equal(accepted.state, "accepted");
        assert.deepEqual(
          costs.reconcileJournals(context.reviewer, "reconcile", input),
          accepted,
        );
        for (const original of originals)
          assert.deepEqual(
            context.j.detail(context.f.actor, original.id),
            original,
          );
        break;
      }
      context.j.unresolved(lease, "transport-uncertain");
      const proof = context.j.recordOriginalCancellationEvidence(
        context.f.actor,
        `proof-${n}`,
        {
          journalId: retry.id,
          requestRef: retry.requestRef,
          reviewHash: context.j.originalCancellationEvidenceReview(
            context.f.actor,
            retry.id,
          ).reviewHash,
          externalRef: `synthetic:final-cancellation-${n}`,
          evidence: "Synthetic verified final cancellation and non-posting",
          cancellationFinal: true,
          nonPostingVerified: true,
          noLaterPosting: true,
        },
      );
      const terminal = context.j.cancelOriginalAttempt(
        context.reviewer,
        `cancel-${n}`,
        {
          journalId: retry.id,
          requestRef: retry.requestRef,
          evidenceHash: proof.evidence.evidenceHash,
          reason: "Synthetic independent final cancellation",
        },
      );
      originals.push(context.j.detail(context.f.actor, terminal.id));
      context = { ...context, journal: terminal };
    }
  });

for (const damage of [
  "history",
  "reference",
  "stamp",
  "missing-parent",
] as const)
  test(`a damaged ${damage} blocks retry reads, cached recovery and writes`, (t) => {
    const context = cancelled(t),
      { f, j, journal } = context,
      { input, retry } = approveRetry(context),
      db = new DatabaseSync(f.path);
    if (damage === "history")
      db.prepare(
        "DELETE FROM integration_stock_journal_observations WHERE journal_id=? AND revision=1",
      ).run(journal.id);
    if (damage === "reference")
      db.prepare(
        "DELETE FROM integration_stock_journal_references WHERE journal_id=?",
      ).run(journal.id);
    if (damage === "missing-parent") {
      db.exec("PRAGMA foreign_keys=OFF");
      db.prepare("DELETE FROM integration_stock_journals WHERE id=?").run(
        journal.id,
      );
    }
    if (damage === "stamp") {
      const row = db
        .prepare("SELECT plan FROM integration_stock_journals WHERE id=?")
        .get(retry.id)!;
      const plan = JSON.parse(row.plan as string);
      plan.predecessor.cancellationHash = "0".repeat(64);
      db.prepare(
        "UPDATE integration_stock_journals SET plan=?,review_hash=? WHERE id=?",
      ).run(canonical(plan), digest(canonical(plan)), retry.id);
    }
    const before = facts(f.path);
    assert.throws(() => j.detail(f.actor, retry.id));
    assert.throws(() => j.queue(f.actor, { sourceId: context.original.id }));
    assert.throws(() => j.prepareOriginalRetry(f.actor, "retry", input));
    assert.throws(() => j.claim(f.actor, retry.id, "write"));
    assert.throws(() =>
      f.app.integration.costs.journalReconciliation(
        context.reviewer,
        context.original.id,
      ),
    );
    assert.equal(facts(f.path), before);
    db.close();
  });

test("current finance policy drift blocks fresh retry and approved writes without erasing preparation receipts", (t) => {
  const context = cancelled(t),
    { f, j, c, journal } = context,
    { input, retry } = approveRetry(context);
  c.configure(f.actor, "changed-policy", { ...policy(1), closedThrough: null });
  const before = facts(f.path);
  assert.throws(() => j.claim(f.actor, retry.id, "write"), {
    code: "JOURNAL_POLICY",
  });
  assert.deepEqual(j.prepareOriginalRetry(f.actor, "retry", input), retry);
  assert.equal(j.detail(f.actor, journal.id).state, "cancelled");
  assert.equal(facts(f.path), before);
});

test("retry review and lineage retain the full predecessor history beyond the visible page", (t) => {
  const context = journalFixture(t),
    { f, j, reviewer } = context,
    journal = context.approve();
  let lease = j.claim(f.actor, journal.id, "write")!;
  j.beforeWrite(lease);
  for (let n = 0; n < 105; n++) {
    j.unresolved(lease, "lookup-miss");
    lease = j.claim(f.actor, journal.id, "lookup")!;
  }
  j.unresolved(lease, "lookup-miss");
  const proof = j.recordOriginalCancellationEvidence(f.actor, "long-proof", {
    journalId: journal.id,
    requestRef: journal.requestRef,
    reviewHash: j.originalCancellationEvidenceReview(f.actor, journal.id)
      .reviewHash,
    externalRef: "synthetic:long-history-final-cancellation",
    evidence: "Synthetic final non-posting proof after all lookup observations",
    cancellationFinal: true,
    nonPostingVerified: true,
    noLaterPosting: true,
  });
  const terminal = j.cancelOriginalAttempt(reviewer, "long-cancel", {
    journalId: journal.id,
    requestRef: journal.requestRef,
    evidenceHash: proof.evidence.evidenceHash,
    reason: "Synthetic independent long history cancellation",
  });
  const retryContext = { ...context, journal: terminal },
    review = j.originalRetryReview(f.actor, journal.id),
    { retry } = approveRetry(retryContext);
  assert.equal(j.detail(f.actor, journal.id).observations.length, 100);
  assert.equal(review.cancellation.revision, 108);
  assert.equal(
    retry.plan.predecessor!.historyHash,
    review.snapshot.historyHash,
  );
  const next = j.claim(f.actor, retry.id, "write")!;
  j.beforeWrite(next);
  j.posted(next, postedResult(next));
  assert.equal(
    f.app.integration.costs.journalReconciliation(reviewer, context.original.id)
      .canConfirm,
    true,
  );
});
