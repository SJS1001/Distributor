import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fixture } from "./fixtures.ts";
import {
  approvedCorrection,
  outcomeInput,
  policy,
} from "./cost-correction-fixture.ts";
import type { CorrectionRetryInput } from "../src/server/cost-corrections.ts";
import { Application } from "../src/server/application.ts";
import { createBackup, restoreBackup } from "../src/server/recovery.ts";
import { inspectSchema, upgradeSchema } from "../src/server/schema-upgrade.ts";
function retryInput(
  f: ReturnType<typeof fixture>,
  correctionId: string,
  leg: "reversal" | "replacement",
  externalRef = "synthetic-retry-1",
): CorrectionRetryInput {
  const state = f.app.integration.costs.corrections.outcomes(
      f.actor,
      correctionId,
    ),
    journal = state.legs.find((l) => l.leg === leg)!;
  return {
    correctionId,
    contentHash: state.contentHash,
    leg,
    previousAttemptId: journal.attemptId,
    previousRevision: journal.current?.revision ?? 1,
    previousEvidenceHash: journal.current?.evidenceHash ?? "b".repeat(64),
    policyRevision: state.policyRevision,
    externalRef,
    reason:
      "Synthetic independently verified non-posting requires a new request",
  };
}
for (const region of ["CA", "US"] as const)
  for (const leg of ["reversal", "replacement"] as const)
    test(`${region} ${leg} separately reviewed retries preserve cancelled references, partial effects, chain history and native cost custody`, (t) => {
      const f = fixture(t, {}, region),
        { c, approved, reviewer, original } = approvedCorrection(f),
        file = c.download(f.actor, approved.id),
        originalFile = f.app.integration.costs.download(f.actor, original.id),
        stock = f.app.inventory.stock(f.actor),
        cursor = f.app.integration.costs.source(f.actor);
      if (leg === "replacement")
        c.observe(
          reviewer,
          "reverse-posted",
          outcomeInput(f, approved.id, "reversal", {
            outcome: "posted",
            postingDate: "2026-10-03",
            evidence: "Synthetic reversal independently posted",
          }),
        );
      assert.throws(
        () =>
          c.prepareRetry(
            f.actor,
            "not-cancelled",
            retryInput(f, approved.id, leg),
          ),
        { code: "COST_RETRY_CANCELLED" },
      );
      c.observe(reviewer, "unknown", outcomeInput(f, approved.id, leg));
      assert.throws(
        () =>
          c.prepareRetry(
            f.actor,
            "unknown-no-retry",
            retryInput(f, approved.id, leg),
          ),
        { code: "COST_RETRY_CANCELLED" },
      );
      const cancelledInput = outcomeInput(f, approved.id, leg, {
          outcome: "cancelled-unposted",
          evidence:
            "Synthetic receiver final cancellation and independently verified non-posting",
        }),
        cancelled = c.observe(reviewer, "cancelled", cancelledInput),
        preparedInput = retryInput(f, approved.id, leg);
      assert.throws(
        () =>
          c.prepareRetry(f.actor, "old-ref", {
            ...preparedInput,
            externalRef: cancelled.input.externalRef,
          }),
        { code: "COST_REFERENCE_CONFLICT" },
      );
      assert.throws(
        () =>
          c.prepareRetry(f.actor, "wrong-evidence", {
            ...preparedInput,
            previousEvidenceHash: "c".repeat(64),
          }),
        { code: "COST_REVIEW_CHANGED" },
      );
      assert.throws(
        () =>
          c.prepareRetry(f.actor, "original-ref", {
            ...preparedInput,
            externalRef: "synthetic-journal-1",
          }),
        { code: "COST_REFERENCE_CONFLICT" },
      );
      const prepared = c.prepareRetry(f.actor, "prepare", preparedInput),
        competitor = c.prepareRetry(f.actor, "competitor", {
          ...preparedInput,
          externalRef: "synthetic-competing-retry",
        }),
        decision = {
          retryId: prepared.id,
          reviewHash: prepared.reviewHash,
          decision: "approve" as const,
          reason: "Synthetic separate finance review",
        };
      assert.deepEqual(
        c.prepareRetry(f.actor, "prepare", preparedInput),
        prepared,
      );
      assert.throws(() => c.decideRetry(f.actor, "self-review", decision), {
        code: "COST_SEPARATE_REVIEW",
      });
      assert.throws(
        () =>
          c.observe(
            reviewer,
            "unapproved",
            outcomeInput(f, approved.id, leg, {
              attemptId: prepared.id,
              externalRef: preparedInput.externalRef,
            }),
          ),
        { code: "COST_ATTEMPT_CHANGED" },
      );
      const approvedRetry = c.decideRetry(reviewer, "approve", decision);
      const otherLeg = leg === "reversal" ? "replacement" : "reversal";
      assert.throws(
        () =>
          c.observe(
            reviewer,
            "cross-leg-ref",
            outcomeInput(f, approved.id, otherLeg, {
              externalRef: preparedInput.externalRef,
            }),
          ),
        {
          code:
            otherLeg === "reversal"
              ? "COST_OUTCOME_FINAL"
              : "COST_REFERENCE_CONFLICT",
        },
      );

      assert.deepEqual(
        c.decideRetry(reviewer, "approve", decision),
        approvedRetry,
      );
      assert.deepEqual(
        c.decideRetry(reviewer, "same-decision", decision),
        approvedRetry,
      );
      assert.throws(
        () =>
          c.decideRetry(reviewer, "competing-approve", {
            ...decision,
            retryId: competitor.id,
            reviewHash: competitor.reviewHash,
          }),
        { code: "COST_RETRY_CANCELLED" },
      );
      assert.deepEqual(
        c.observe(reviewer, "cancelled", cancelledInput),
        cancelled,
        "historical exact receipt remains historical",
      );
      assert.throws(
        () => c.observe(reviewer, "old-attempt-new-key", cancelledInput),
        { code: "COST_ATTEMPT_CHANGED" },
      );
      const nextUnknown = outcomeInput(f, approved.id, leg);
      assert.equal(nextUnknown.attemptId, prepared.id);
      assert.equal(nextUnknown.externalRef, preparedInput.externalRef);
      assert.throws(
        () =>
          c.observe(reviewer, "wrong-reference", {
            ...nextUnknown,
            externalRef: "unapproved-ref",
          }),
        { code: "COST_REFERENCE_CONFLICT" },
      );
      c.observe(reviewer, "retry-unknown", nextUnknown);
      assert.throws(
        () =>
          c.prepareRetry(
            f.actor,
            "uncertain-retry",
            retryInput(f, approved.id, leg, "synthetic-retry-2"),
          ),
        { code: "COST_RETRY_CANCELLED" },
      );
      c.observe(
        reviewer,
        "retry-cancel",
        outcomeInput(f, approved.id, leg, {
          outcome: "cancelled-unposted",
          evidence:
            "Synthetic second attempt cancelled with non-posting verified",
        }),
      );
      const second = c.prepareRetry(
        f.actor,
        "prepare-second",
        retryInput(f, approved.id, leg, "synthetic-retry-2"),
      );
      c.decideRetry(reviewer, "approve-second", {
        ...decision,
        retryId: second.id,
        reviewHash: second.reviewHash,
      });
      assert.equal(c.retryDetail(reviewer, prepared.id).history.length, 2);
      assert.equal(
        c.retryDetail(reviewer, prepared.id).history.at(-1)!.input.outcome,
        "cancelled-unposted",
      );
      c.observe(
        reviewer,
        "retry-posted",
        outcomeInput(f, approved.id, leg, {
          outcome: "posted",
          postingDate: "2026-10-03",
          evidence: "Synthetic fresh reference journal independently posted",
        }),
      );
      assert.throws(
        () =>
          c.prepareRetry(
            f.actor,
            "posted-no-retry",
            retryInput(f, approved.id, leg, "synthetic-retry-3"),
          ),
        { code: "COST_RETRY_CANCELLED" },
      );
      const final = c
        .outcomes(reviewer, approved.id)
        .legs.find((l) => l.leg === leg)!;
      assert.equal(final.current!.input.outcome, "posted");
      assert.equal(
        final.initialHistory.at(-1)!.evidenceHash,
        cancelled.evidenceHash,
      );
      assert.equal(final.attemptId, second.id);
      assert.equal(final.retries.length, 3);
      assert.deepEqual(c.download(reviewer, approved.id), file);
      assert.deepEqual(
        f.app.integration.costs.download(reviewer, original.id),
        originalFile,
      );
      assert.deepEqual(f.app.inventory.stock(f.actor), stock);
      assert.deepEqual(f.app.integration.costs.source(f.actor), cursor);
      f.app.close();
      f.app = new Application(f.path, region);
      assert.deepEqual(
        f.app.integration.costs.corrections
          .outcomes(reviewer, approved.id)
          .legs.find((l) => l.leg === leg),
        final,
      );
    });
test("replacement retry remains held until the current reversal is conclusively posted", (t) => {
  const f = fixture(t),
    { c, approved, reviewer } = approvedCorrection(f);
  c.observe(
    reviewer,
    "cancel-replacement",
    outcomeInput(f, approved.id, "replacement", {
      outcome: "cancelled-unposted",
    }),
  );
  const p = c.prepareRetry(
    f.actor,
    "prepare",
    retryInput(f, approved.id, "replacement"),
  );
  c.decideRetry(reviewer, "approve", {
    retryId: p.id,
    reviewHash: p.reviewHash,
    decision: "approve",
    reason: "Synthetic review",
  });
  assert.throws(
    () =>
      c.observe(
        reviewer,
        "post-no-reversal",
        outcomeInput(f, approved.id, "replacement", {
          outcome: "posted",
          postingDate: "2026-10-03",
        }),
      ),
    { code: "COST_REVERSAL_REQUIRED" },
  );
  c.observe(
    reviewer,
    "uncertain-reversal",
    outcomeInput(f, approved.id, "reversal"),
  );
  assert.throws(
    () =>
      c.observe(
        reviewer,
        "post-unknown-reversal",
        outcomeInput(f, approved.id, "replacement", {
          outcome: "posted",
          postingDate: "2026-10-03",
        }),
      ),
    { code: "COST_REVERSAL_REQUIRED" },
  );
});
test("changed policy, scoped authority, rejection and corruption cannot authorize retries", (t) => {
  const f = fixture(t),
    { c, approved, reviewer } = approvedCorrection(f, "unposted");
  c.observe(
    reviewer,
    "cancel",
    outcomeInput(f, approved.id, "replacement", {
      outcome: "cancelled-unposted",
    }),
  );
  const p = c.prepareRetry(
      f.actor,
      "prepare",
      retryInput(f, approved.id, "replacement"),
    ),
    decision = {
      retryId: p.id,
      reviewHash: p.reviewHash,
      decision: "approve" as const,
      reason: "Synthetic review",
    };
  assert.throws(() =>
    c.retryDetail({ ...reviewer, orgId: "another-org" }, p.id),
  );
  c.configure(f.actor, "changed-policy", {
    ...policy(1),
    closedThrough: "2026-10-03",
  });
  assert.throws(() => c.decideRetry(reviewer, "stale", decision), {
    code: "COST_POLICY",
  });
  assert.equal(c.retryDetail(reviewer, p.id).state, "ready");
  assert.equal(
    c.decideRetry(reviewer, "reject", { ...decision, decision: "reject" })
      .state,
    "rejected",
  );
  assert.throws(
    () => c.decideRetry(reviewer, "approve-after-reject", decision),
    { code: "COST_DECISION_CONFLICT" },
  );
  f.app.database
    .owned("integration")
    .run(
      "UPDATE integration_cost_correction_retries SET plan=replace(plan,'Synthetic','Tampered') WHERE id=?",
      p.id,
    );
  assert.throws(() => c.retryDetail(reviewer, p.id), {
    code: "COST_INTEGRITY",
  });
});
for (const region of ["CA", "US"] as const)
  for (const eventReports of [false, true])
    test(`${region}/${eventReports} held clones and encrypted restores preserve nonempty retry reviews, references and observations`, async (t) => {
      const f = fixture(t, { eventReports }, region),
        { c, approved, reviewer } = approvedCorrection(f, "unposted");
      c.observe(
        reviewer,
        "cancel",
        outcomeInput(f, approved.id, "replacement", {
          outcome: "cancelled-unposted",
        }),
      );
      const p = c.prepareRetry(
          f.actor,
          "prepare",
          retryInput(f, approved.id, "replacement"),
        ),
        decision = {
          retryId: p.id,
          reviewHash: p.reviewHash,
          decision: "approve" as const,
          reason: "Synthetic review",
        };
      c.decideRetry(reviewer, "approve", decision);
      const obs = outcomeInput(f, approved.id, "replacement");
      c.observe(reviewer, "unknown", obs);
      const before = c.outcomes(reviewer, approved.id),
        detail = c.retryDetail(reviewer, p.id),
        dir = dirname(f.path),
        clone = join(dir, "clone.db"),
        restore = join(dir, "restore.db"),
        archive = join(dir, "encrypted.backup"),
        key = randomBytes(32);
      f.app.platform.isolateRestore("b".repeat(64), "2026-10-03T00:00:00.000Z");
      await upgradeSchema(
        f.path,
        clone,
        inspectSchema(f.path).schemaHash,
        region,
      );
      await createBackup(f.path, archive, region, key);
      await restoreBackup(archive, restore, region, key);
      for (const path of [clone, restore]) {
        const app = new Application(path, region, { eventReports });
        try {
          const copy = app.integration.costs.corrections;
          assert.deepEqual(copy.outcomes(reviewer, approved.id), before);
          assert.deepEqual(copy.retryDetail(reviewer, p.id), detail);
          assert.throws(() => copy.decideRetry(reviewer, "approve", decision), {
            code: "RECOVERY_HOLD",
          });
          assert.throws(() => copy.observe(reviewer, "unknown", obs), {
            code: "RECOVERY_HOLD",
          });
        } finally {
          app.close();
        }
      }
    });
