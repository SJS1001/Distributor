import { test } from "node:test";
import assert from "node:assert/strict";
import { journalFixture, postedResult } from "./stock-journal-fixture.ts";
import { input, outcomeInput, policy } from "./cost-correction-fixture.ts";

// All outcomes below are explicit synthetic observations through native owners.
// No provider transport or automatic inference of cancellation/posting is used.
for (const region of ["CA", "US"] as const)
  for (const leg of ["reversal", "replacement"] as const)
    for (const nativeState of ["unknown", "running", "posted"] as const)
      test(`${region} ${leg} a skipped ${nativeState} native ancestor still fences a second correction retry`, (t) => {
        const { f, c, j, selected, make, approve, reviewer } = journalFixture(
          t,
          region,
          true,
        );
        const source = c.download(f.actor, selected.id);
        const stock = f.app.inventory.stock(f.actor);
        const cursor = f.app.integration.costs.source(f.actor);
        if (leg === "replacement")
          c.observe(
            reviewer,
            "manual-reversal",
            outcomeInput(f, selected.id, "reversal", {
              outcome: "posted",
              postingDate: "2026-10-03",
            }),
          );
        const ancestor = approve(make(leg), "ancestor");
        const oldLease = j.claim(f.actor, ancestor.id, "write")!;
        j.beforeWrite(oldLease);
        if (nativeState === "unknown")
          j.unresolved(oldLease, "transport-uncertain");
        if (nativeState === "posted")
          j.posted(oldLease, postedResult(oldLease, "499"));
        const cancellation = c.observe(
          reviewer,
          "ancestor-manual-cancellation",
          outcomeInput(f, selected.id, leg, {
            outcome: "cancelled-unposted",
            evidence: "Synthetic independently verified final non-posting",
          }),
        );
        function retry(key: string) {
          const state = c.outcomes(f.actor, selected.id);
          const current = state.legs.find((l) => l.leg === leg)!;
          const draft = c.prepareRetry(f.actor, key, {
            correctionId: selected.id,
            contentHash: state.contentHash,
            leg,
            previousAttemptId: current.attemptId,
            previousRevision: current.current!.revision,
            previousEvidenceHash: current.current!.evidenceHash,
            policyRevision: state.policyRevision,
            externalRef: `synthetic-${key}`,
            reason: "Synthetic separate exact-journal retry",
          });
          return c.decideRetry(reviewer, `${key}-approve`, {
            retryId: draft.id,
            reviewHash: draft.reviewHash,
            decision: "approve",
            reason: "Synthetic independent retry review",
          });
        }
        const intermediate = retry("intermediate");
        c.observe(
          reviewer,
          "intermediate-cancellation",
          outcomeInput(f, selected.id, leg, {
            outcome: "cancelled-unposted",
            evidence:
              "Synthetic intermediate cancelled without native delivery",
          }),
        );
        const final = retry("final");
        const delivery = approve(make(leg, final.id), "final-delivery");
        assert.throws(() => j.claim(f.actor, delivery.id, "write"), {
          code: "JOURNAL_PREDECESSOR",
        });
        assert.equal(j.detail(f.actor, delivery.id).state, "pending");
        assert.equal(j.detail(f.actor, ancestor.id).state, nativeState);
        if (nativeState === "posted") {
          assert.throws(
            () =>
              j.cancelCorrectionAttempt(f.actor, "cannot-cancel-posted", {
                journalId: ancestor.id,
                requestRef: ancestor.requestRef,
                evidenceHash: cancellation.evidenceHash,
                reason:
                  "Synthetic conflicting manual evidence cannot undo native posting",
              }),
            { code: "JOURNAL_STATE" },
          );
          assert.deepEqual(c.download(f.actor, selected.id), source);
          assert.deepEqual(f.app.inventory.stock(f.actor), stock);
          assert.deepEqual(f.app.integration.costs.source(f.actor), cursor);
          return;
        }
        if (nativeState === "running") {
          assert.throws(() => j.beforeWrite(oldLease), {
            code: "JOURNAL_ATTEMPT",
          });
          j.unresolved(oldLease, "transport-uncertain");
        }
        const oldHistory = j.observations(f.actor, ancestor.id);
        // Only a separate, exact native cancellation releases the ancestor fence.
        const cancellationInput = {
          journalId: ancestor.id,
          requestRef: ancestor.requestRef,
          evidenceHash: cancellation.evidenceHash,
          reason: "Synthetic separate confirmation of this native request",
        };
        const cancelled = j.cancelCorrectionAttempt(
          f.actor,
          "ancestor-native-cancel",
          cancellationInput,
        );
        assert.deepEqual(
          j.cancelCorrectionAttempt(
            f.actor,
            "ancestor-native-cancel",
            cancellationInput,
          ),
          cancelled,
        );
        const lease = j.claim(f.actor, delivery.id, "write")!;
        assert.ok(lease);
        j.beforeWrite(lease);
        assert.throws(() => j.beforeWrite(lease), {
          code: "JOURNAL_WRITE_ONCE",
        });
        assert.equal(j.posted(lease, postedResult(lease)).state, "posted");
        assert.notEqual(delivery.requestRef, ancestor.requestRef);
        assert.equal(
          c.retryDetail(reviewer, intermediate.id).history.at(-1)!.input
            .outcome,
          "cancelled-unposted",
        );
        assert.deepEqual(
          j
            .observations(f.actor, ancestor.id)
            .items.filter((o) => o.revision <= oldHistory.items[0]!.revision),
          oldHistory.items,
        );
        assert.deepEqual(c.download(f.actor, selected.id), source);
        assert.deepEqual(f.app.inventory.stock(f.actor), stock);
        assert.deepEqual(f.app.integration.costs.source(f.actor), cursor);
      });

for (const region of ["CA", "US"] as const) {
  test(`${region} an independently cancelled native replacement changes accounts without another original reversal and recovers only committed approval`, (t) => {
    const { f, original, c, j, selected, reviewer, make, approve } =
      journalFixture(t, region, true);
    const source = c.download(f.actor, selected.id);
    const originalFile = f.app.integration.costs.download(f.actor, original.id);
    const stock = f.app.inventory.stock(f.actor);
    const cursor = f.app.integration.costs.source(f.actor);
    const reversal = approve(make("reversal"), "reversal");
    const reversalLease = j.claim(f.actor, reversal.id, "write")!;
    j.beforeWrite(reversalLease);
    j.posted(reversalLease, postedResult(reversalLease, "501"));
    c.observe(
      reviewer,
      "reversal-proof",
      outcomeInput(f, selected.id, "reversal", {
        outcome: "posted",
        postingDate: "2026-10-03",
        externalRef: "501",
      }),
    );
    const replacement = approve(make("replacement"), "replacement");
    const replacementLease = j.claim(f.actor, replacement.id, "write")!;
    j.beforeWrite(replacementLease);
    j.unresolved(replacementLease, "transport-uncertain");
    const proof = c.observe(
      reviewer,
      "replacement-proof",
      outcomeInput(f, selected.id, "replacement", {
        outcome: "cancelled-unposted",
        externalRef: "synthetic-replacement-cancellation",
        evidence:
          "Synthetic final cancellation and verified non-posting of exact native reference",
      }),
    );
    c.configure(f.actor, "changed-mapping", {
      ...policy(1),
      closedThrough: "2026-10-03",
      inventoryAccount: "1202",
    });
    const successorInput = {
      ...input(original, "unposted"),
      policyRevision: 2,
      postingDate: "2026-10-04",
      receiverRef: "quickbooks-sandbox:12345",
      externalRef: "synthetic-replacement-cancellation",
      predecessor: {
        correctionId: selected.id,
        contentHash: selected.contentHash!,
      },
    };
    assert.throws(
      () => c.prepare(f.actor, "uncertain-native", successorInput),
      { code: "COST_CHAIN_OUTCOME" },
    );
    j.cancelCorrectionAttempt(f.actor, "native-final-cancel", {
      journalId: replacement.id,
      requestRef: replacement.requestRef,
      evidenceHash: proof.evidenceHash,
      reason: "Synthetic independent final cancellation review",
    });
    assert.throws(
      () =>
        c.prepare(f.actor, "closed-date", {
          ...successorInput,
          postingDate: "2026-10-03",
        }),
      { code: "COST_PERIOD" },
    );
    const draft = c.prepare(f.actor, "successor", successorInput);
    const decision = {
      correctionId: draft.id,
      reviewHash: draft.reviewHash,
      decision: "approve" as const,
      reason: "Synthetic independent successor review",
    };
    const audit = f.app.platform.audit;
    f.app.platform.audit = function (...args) {
      if (args[1] === "accounting.cost.correction.decide")
        throw new Error("synthetic late approval receipt fault");
      return audit.apply(this, args);
    };
    try {
      assert.throws(
        () => c.decide(reviewer, "exact-decision", decision),
        /synthetic late approval receipt fault/,
      );
      assert.throws(
        () => c.decide(reviewer, "exact-decision", decision),
        /synthetic late approval receipt fault/,
      );
      assert.equal(c.detail(reviewer, draft.id).state, "ready");
      assert.throws(() => c.download(reviewer, draft.id), {
        code: "COST_REVIEW_REQUIRED",
      });
    } finally {
      f.app.platform.audit = audit;
    }
    const successor = c.decide(reviewer, "exact-decision", decision);
    assert.deepEqual(c.decide(reviewer, "exact-decision", decision), successor);
    assert.throws(
      () =>
        c.decide(reviewer, "exact-decision", {
          ...decision,
          reason: "changed body",
        }),
      { code: "IDEMPOTENCY_CONFLICT" },
    );
    const document = JSON.parse(c.download(reviewer, successor.id).bytes);
    assert.deepEqual(document.reversal, []);
    assert.equal(document.replacement[0].account, "1202");
    assert.equal(document.debit, 18000);
    assert.equal(document.credit, 18000);
    assert.equal(document.input.predecessor.correctionId, selected.id);
    assert.equal(j.detail(f.actor, reversal.id).externalId, "501");
    assert.equal(j.detail(f.actor, replacement.id).state, "cancelled");
    assert.deepEqual(c.download(f.actor, selected.id), source);
    assert.deepEqual(
      f.app.integration.costs.download(f.actor, original.id),
      originalFile,
    );
    assert.deepEqual(f.app.inventory.stock(f.actor), stock);
    assert.deepEqual(f.app.integration.costs.source(f.actor), cursor);
  });

  test(`${region} closing a posting period refuses writes while exact permission replacement permits lookup of the retained uncertain journal`, (t) => {
    const { f, c, j, approve, reviewer } = journalFixture(t, region, true);
    const journal = approve();
    const lease = j.claim(f.actor, journal.id, "write")!;
    j.beforeWrite(lease);
    c.configure(f.actor, "close-period", {
      ...policy(1),
      closedThrough: "2026-10-03",
    });
    assert.throws(() => j.beforeWrite(lease), { code: "JOURNAL_POLICY" });
    j.unresolved(lease, "transport-uncertain");
    const residency = f.app.identity.organizationResidency;
    const current = residency.current(f.actor);
    residency.choose(f.actor, "renewed-choice", {
      region,
      revision: current.choice.revision,
      mode: "provider-exception",
      realm: "12345",
      acknowledgment: "Synthetic explicit renewed company choice",
      acceptance: {
        disclosureId: current.terms!.id,
        disclosureHash: current.terms!.hash,
        representative: "Synthetic finance",
        evidenceRef: "synthetic:renewed-choice",
      },
    });
    assert.throws(() => j.claim(f.actor, journal.id, "lookup"), {
      code: "RESIDENCY_CHANGED",
    });
    const review = j.permissionReview(f.actor, journal.id);
    assert.equal(review.mode, "lookup");
    const permissionInput = {
      journalId: journal.id,
      reviewHash: journal.reviewHash,
      previousPermissionHash: review.previousPermissionHash,
      authority: review.authority,
      mode: review.mode,
      reason: "Synthetic separately reviewed lookup permission",
    };
    assert.throws(
      () =>
        j.preparePermission(f.actor, "forged-write", {
          ...permissionInput,
          mode: "write",
        }),
      { code: "JOURNAL_PERMISSION_STATE" },
    );
    const ready = j.preparePermission(
      f.actor,
      "lookup-permission",
      permissionInput,
    );
    j.decidePermission(reviewer, "lookup-approval", {
      journalId: journal.id,
      permissionReviewId: ready.id,
      permissionReviewHash: ready.reviewHash,
      decision: "approve",
      reason: "Synthetic independent lookup approval",
    });
    assert.throws(() => j.claim(f.actor, journal.id, "write"), {
      code: "JOURNAL_STATE",
    });
    const lookup = j.claim(f.actor, journal.id, "lookup")!;
    assert.equal(lookup.effect.reference, lease.effect.reference);
    assert.equal(lookup.effect.payload, lease.effect.payload);
    assert.throws(() => j.beforeWrite(lookup), { code: "JOURNAL_WRITE_ONCE" });
    assert.equal(j.posted(lookup, postedResult(lookup)).state, "posted");
    assert.throws(() => j.posted(lease, postedResult(lease)), {
      code: "JOURNAL_LEASE",
    });
  });
}
