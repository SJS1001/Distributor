import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { createBackup, restoreBackup } from "../src/server/recovery.ts";
import { inspectSchema, upgradeSchema } from "../src/server/schema-upgrade.ts";
import {
  setup,
  policy,
  input,
  approvedCorrection,
  outcomeInput,
} from "./cost-correction-fixture.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, accept, ship } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import {
  accountingDate,
  type CorrectionOutcomeInput,
} from "../src/server/cost-corrections.ts";
import { digest } from "../src/server/core.ts";
import { createHttp } from "../src/server/http.ts";

for (const region of ["CA", "US"] as const)
  for (const outcome of ["posted", "unposted"] as const)
    test(`${region} ${outcome} correction is immutable, balanced and does not consume inventory again`, (t) => {
      const f = fixture(t, {}, region),
        { original, reviewer } = setup(f),
        costs = f.app.integration.costs;
      const originalBytes = costs.download(f.actor, original.id).bytes,
        stock = f.app.inventory.stock(f.actor),
        cursor = costs.source(f.actor);
      costs.corrections.configure(f.actor, "policy", policy());
      const p = costs.corrections.prepare(
        f.actor,
        "correction",
        input(original, outcome),
      );
      assert.equal(p.state, "ready");
      assert.throws(() => costs.corrections.download(f.actor, p.id), {
        code: "COST_REVIEW_REQUIRED",
      });
      const decision = {
        correctionId: p.id,
        reviewHash: p.reviewHash,
        decision: "approve" as const,
        reason: "Synthetic independent finance approval",
      };
      assert.throws(
        () => costs.corrections.decide(f.actor, "same-principal", decision),
        { code: "COST_SEPARATE_REVIEW" },
      );
      const approved = costs.corrections.decide(
        reviewer,
        "approve-correction",
        decision,
      );
      assert.deepEqual(
        costs.corrections.decide(reviewer, "new-key-same-decision", decision),
        approved,
      );
      const file = costs.corrections.download(reviewer, p.id),
        artifact = JSON.parse(file.bytes);
      assert.equal(file.hash, digest(file.bytes));
      assert.equal(artifact.region, region);
      assert.equal(artifact.currency, region === "CA" ? "CAD" : "USD");
      assert.equal(artifact.reversal.length, outcome === "posted" ? 6 : 0);
      assert.equal(artifact.replacement.length, 6);
      for (const journal of [artifact.reversal, artifact.replacement])
        assert.equal(
          journal.reduce((s: number, l: any) => s + l.debit, 0),
          journal.reduce((s: number, l: any) => s + l.credit, 0),
        );
      assert.equal(artifact.replacement[0].account, "1201");
      assert.equal(artifact.replacement[1].account, "2101");
      if (outcome === "posted") {
        assert.equal(artifact.reversal[0].account, "1200");
        assert.equal(artifact.reversal[0].credit, 6000);
      }
      assert.equal(costs.download(f.actor, original.id).bytes, originalBytes);
      assert.deepEqual(f.app.inventory.stock(f.actor), stock);
      assert.deepEqual(costs.source(f.actor), cursor);
      assert.throws(
        () =>
          costs.corrections.prepare(
            f.actor,
            "second-reversal",
            input(original, outcome),
          ),
        { code: "COST_CORRECTION_CONFLICT" },
      );
      f.app.close();
      f.app = new Application(f.path, region);
      assert.equal(
        f.app.integration.costs.corrections.download(reviewer, p.id).bytes,
        file.bytes,
      );
      f.app.platform.isolateRestore("a".repeat(64), "2026-10-03T00:00:00.000Z");
      assert.equal(
        f.app.integration.costs.corrections.download(reviewer, p.id).bytes,
        file.bytes,
      );
      assert.throws(
        () =>
          f.app.integration.costs.corrections.decide(
            reviewer,
            "approve-correction",
            decision,
          ),
        { code: "RECOVERY_HOLD" },
      );
    });
test("unknown outcomes, closed periods, missing cancellation and invalid dates refuse approval", (t) => {
  const f = fixture(t),
    { original, reviewer } = setup(f),
    c = f.app.integration.costs.corrections;
  c.configure(f.actor, "policy", policy());
  assert.throws(
    () =>
      c.prepare(f.actor, "closed", {
        ...input(original),
        postingDate: "2026-09-30",
      }),
    { code: "COST_PERIOD" },
  );
  assert.throws(
    () =>
      c.prepare(f.actor, "prior", {
        ...input(original),
        priorPeriodEvidence: null,
      }),
    { code: "COST_PRIOR_PERIOD" },
  );
  assert.throws(
    () =>
      c.prepare(f.actor, "unposted", {
        ...input(original, "unposted"),
        cancellationEvidence: null,
      }),
    { code: "COST_OUTCOME" },
  );
  for (const date of ["2026-02-30", "2026-99-01", "0000-01-01", "2026-1-1"])
    assert.throws(() => accountingDate(date), { code: "VALIDATION" });
  const blocked = c.prepare(f.actor, "unknown", input(original, "unknown"));
  assert.equal(blocked.state, "blocked");
  assert.throws(
    () =>
      c.decide(reviewer, "approve-unknown", {
        correctionId: blocked.id,
        reviewHash: blocked.reviewHash,
        decision: "approve",
        reason: "Synthetic",
      }),
    { code: "COST_OUTCOME" },
  );
  assert.equal(
    c.decide(reviewer, "reject-unknown", {
      correctionId: blocked.id,
      reviewHash: blocked.reviewHash,
      decision: "reject",
      reason: "Investigate ledger outcome",
    }).state,
    "rejected",
  );
});
test("changed policy and conflicting receiver evidence invalidate frozen review", (t) => {
  const f = fixture(t),
    { original, reviewer } = setup(f),
    c = f.app.integration.costs.corrections;
  c.configure(f.actor, "policy", policy());
  const p = c.prepare(f.actor, "correction", input(original));
  c.configure(f.actor, "policy2", {
    ...policy(1),
    closedThrough: "2026-10-01",
    mappingVersion: "synthetic-v3",
  });
  assert.equal(c.detail(f.actor, p.id).reviewHash, p.reviewHash);
  assert.throws(
    () =>
      c.decide(reviewer, "stale", {
        correctionId: p.id,
        reviewHash: p.reviewHash,
        decision: "approve",
        reason: "Synthetic",
      }),
    { code: "COST_POLICY" },
  );
  assert.throws(
    () => c.configure(f.actor, "reopen", { ...policy(2), closedThrough: null }),
    { code: "COST_PERIOD" },
  );
  f.app.integration.costs.accept(f.actor, "accept-original", {
    packetId: original.id,
    contentHash: original.contentHash!,
    receiverRef: "other-ledger",
    receiverRegion: "CA",
    externalRef: "other-journal",
    debit: 18000,
    credit: 18000,
    reason: "Synthetic receiver proof",
  });
  assert.throws(
    () =>
      c.prepare(f.actor, "conflict", { ...input(original), policyRevision: 2 }),
    { code: "COST_OUTCOME" },
  );
});
test("two drafts cannot approve duplicate reversals and original tampering refuses", (t) => {
  const f = fixture(t),
    { original, reviewer } = setup(f),
    c = f.app.integration.costs.corrections;
  c.configure(f.actor, "policy", policy());
  const a = c.prepare(f.actor, "a", input(original)),
    b = c.prepare(f.actor, "b", input(original));
  c.decide(reviewer, "a-approve", {
    correctionId: a.id,
    reviewHash: a.reviewHash,
    decision: "approve",
    reason: "Synthetic",
  });
  assert.throws(
    () =>
      c.decide(reviewer, "b-approve", {
        correctionId: b.id,
        reviewHash: b.reviewHash,
        decision: "approve",
        reason: "Synthetic",
      }),
    { code: "COST_CORRECTION_CONFLICT" },
  );
  const store = f.app.database.owned("integration"),
    old = store.get(
      "SELECT report FROM integration_cost_packets WHERE id=?",
      original.id,
    )!.report;
  store.run(
    "UPDATE integration_cost_packets SET report='{}' WHERE id=?",
    original.id,
  );
  try {
    assert.throws(() => c.list(f.actor, original.id), {
      code: "COST_INTEGRITY",
    });
  } finally {
    store.run(
      "UPDATE integration_cost_packets SET report=? WHERE id=?",
      old!,
      original.id,
    );
  }
});

test("HTTP correction commands require fresh finance authority, CSRF and strict fields; retries retain exact artifact", async (t) => {
  const f = fixture(t),
    { original } = setup(f),
    http = await createHttp(f.app, { origin: "http://localhost" });
  t.after(() => void http.close());
  const login = async (email: string, password: string) => {
    const result = await http.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin: "http://localhost" },
      payload: { email, password },
    });
    assert.equal(result.statusCode, 200);
    return {
      cookie: result.headers["set-cookie"]!.toString().split(";")[0]!,
      origin: "http://localhost",
      "x-csrf-token": result.json().csrf,
    };
  };
  assert.equal(
    (await http.inject({ url: "/api/accounting/cost-policy" })).statusCode,
    401,
  );
  const admin = await login("admin@example.test", "long-test-only-password"),
    reviewer = await login("finance@example.test", "test-only-long-password");
  const post = (name: string, payload: unknown, key: string, headers = admin) =>
    http.inject({
      method: "POST",
      url: `/api/commands/accounting.cost.${name}`,
      headers: { ...headers, "idempotency-key": key },
      payload: payload as any,
    });
  assert.equal(
    (
      await post("policy", policy(), "bad-csrf", {
        ...admin,
        "x-csrf-token": "bad",
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await post("policy", { ...policy(), artifact: "forged" }, "bad-fields"))
      .statusCode,
    400,
  );
  assert.equal((await post("policy", policy(), "policy")).statusCode, 200);
  assert.equal(
    (
      await http.inject({ url: "/api/accounting/cost-policy", headers: admin })
    ).json().revision,
    1,
  );
  const p = (
    await post("correction.prepare", input(original), "prepare")
  ).json();
  assert.equal(
    (await post("correction.prepare", input(original), "prepare")).json().id,
    p.id,
  );
  assert.equal(
    (
      await post(
        "correction.prepare",
        { ...input(original), reason: "different" },
        "prepare",
      )
    ).statusCode,
    409,
  );
  const decision = {
    correctionId: p.id,
    reviewHash: p.reviewHash,
    decision: "approve",
    reason: "Synthetic HTTP independent review",
  };
  assert.equal(
    (await post("correction.decide", decision, "self")).statusCode,
    403,
  );
  assert.equal(
    (
      await post(
        "correction.decide",
        { ...decision, reviewHash: "0".repeat(64) },
        "hash",
        reviewer,
      )
    ).statusCode,
    409,
  );
  assert.equal(
    (await post("correction.decide", decision, "approve", reviewer)).statusCode,
    200,
  );
  const file = await http.inject({
    url: `/api/accounting/cost-corrections/${p.id}/file`,
    headers: reviewer,
  });
  assert.equal(file.statusCode, 200);
  assert.equal(file.headers["x-document-sha256"], digest(file.rawPayload));
  assert.equal(file.headers["cache-control"], "no-store");
  assert.equal(
    (
      await http.inject({
        url: `/api/accounting/costs/${original.id}/corrections`,
        headers: admin,
      })
    ).json()[0].id,
    p.id,
  );
  assert.equal(
    (
      await http.inject({
        url: `/api/accounting/cost-corrections/${p.id}`,
        headers: admin,
      })
    ).json().state,
    "reviewed",
  );
  const observation = outcomeInput(f, p.id, "reversal");
  assert.equal(
    (
      await post("correction.observe", observation, "observe", {
        ...reviewer,
        "x-csrf-token": "bad",
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await post(
        "correction.observe",
        { ...observation, forged: true },
        "forged",
        reviewer,
      )
    ).statusCode,
    400,
  );
  const recorded = await post(
    "correction.observe",
    observation,
    "observe",
    reviewer,
  );
  assert.equal(recorded.statusCode, 200, recorded.body);
  assert.deepEqual(
    (await post("correction.observe", observation, "observe", reviewer)).json(),
    recorded.json(),
  );
  const history = await http.inject({
    url: `/api/accounting/cost-corrections/${p.id}/outcomes`,
    headers: reviewer,
  });
  assert.equal(history.statusCode, 200);
  assert.equal(history.headers["cache-control"], "no-store");
  assert.equal(history.json().legs[0].current.input.outcome, "unknown");
  const cancelled = await post(
    "correction.observe",
    {
      ...observation,
      previousRevision: 1,
      outcome: "cancelled-unposted",
      evidence:
        "Synthetic final cancellation and independently verified non-posting",
    },
    "cancel",
    reviewer,
  );
  assert.equal(cancelled.statusCode, 200, cancelled.body);
  const retryInput = {
    correctionId: p.id,
    contentHash: observation.contentHash,
    leg: "reversal",
    previousAttemptId: null,
    previousRevision: 2,
    previousEvidenceHash: cancelled.json().evidenceHash,
    policyRevision: 1,
    externalRef: "synthetic-http-retry",
    reason: "Synthetic separately approved retry",
  };
  assert.equal(
    (
      await post("correction.retry.prepare", retryInput, "csrf-retry", {
        ...admin,
        "x-csrf-token": "bad",
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await post(
        "correction.retry.prepare",
        {
          ...retryInput,
          approval: "forged",
        },
        "fields-retry",
      )
    ).statusCode,
    400,
  );
  const retryResponse = await post(
    "correction.retry.prepare",
    retryInput,
    "prepare-retry",
  );
  assert.equal(retryResponse.statusCode, 200, retryResponse.body);
  const retry = retryResponse.json(),
    retryDecision = {
      retryId: retry.id,
      reviewHash: retry.reviewHash,
      decision: "approve",
      reason: "Synthetic separate current finance review",
    };
  assert.equal(
    (await post("correction.retry.decide", retryDecision, "self-retry"))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await post(
        "correction.retry.decide",
        {
          ...retryDecision,
          reviewHash: "0".repeat(64),
        },
        "stale-retry",
        reviewer,
      )
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await post(
        "correction.retry.decide",
        retryDecision,
        "approve-retry",
        reviewer,
      )
    ).statusCode,
    200,
  );
  const retryDetail = await http.inject({
    url: `/api/accounting/cost-correction-retries/${retry.id}`,
    headers: reviewer,
  });
  assert.equal(retryDetail.statusCode, 200);
  assert.equal(retryDetail.headers["cache-control"], "no-store");
  assert.equal(retryDetail.json().state, "reviewed");
  const retryObservation = {
    ...observation,
    attemptId: retry.id,
    previousRevision: 0,
    externalRef: retryInput.externalRef,
  };
  assert.equal(
    (
      await post(
        "correction.observe",
        retryObservation,
        "retry-observation",
        reviewer,
      )
    ).statusCode,
    200,
  );
  const user = f.app.identity
    .users(f.actor)
    .find((u) => u.email === "finance@example.test")!;
  f.app.identity.updateUser(f.actor, "revoke-reviewer", {
    userId: user.id,
    revision: user.revision,
    email: user.email,
    name: user.name,
    role: "warehouse",
    active: true,
    sites: [f.w1],
    currentPassword: "long-test-only-password",
    reason: "Synthetic authority revocation",
  });
  assert.equal(
    (await post("correction.decide", decision, "approve", reviewer)).statusCode,
    401,
  );
  assert.equal(
    (
      await http.inject({
        url: `/api/accounting/cost-corrections/${p.id}/file`,
        headers: reviewer,
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (await post("correction.observe", observation, "observe", reviewer))
      .statusCode,
    401,
  );
  assert.equal(
    (
      await post(
        "correction.retry.decide",
        retryDecision,
        "approve-retry",
        reviewer,
      )
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await post(
        "correction.observe",
        retryObservation,
        "retry-observation",
        reviewer,
      )
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await http.inject({
        url: `/api/accounting/cost-correction-retries/${retry.id}`,
        headers: reviewer,
      })
    ).statusCode,
    401,
  );
});

test("new receiver acceptance invalidates prepared evidence and foreign organization cannot see correction", (t) => {
  const f = fixture(t),
    other = fixture(t),
    { original, reviewer } = setup(f),
    c = f.app.integration.costs.corrections;
  c.configure(f.actor, "policy", policy());
  const p = c.prepare(f.actor, "prepare", input(original));
  assert.throws(() => c.detail(other.actor, p.id), { code: "FORBIDDEN" });
  f.app.integration.costs.accept(f.actor, "accept-original", {
    packetId: original.id,
    contentHash: original.contentHash!,
    receiverRef: "synthetic-ledger",
    receiverRegion: "CA",
    externalRef: "synthetic-journal-1",
    debit: 18000,
    credit: 18000,
    reason: "Synthetic independently received",
  });
  assert.throws(
    () =>
      c.decide(reviewer, "changed-receipt", {
        correctionId: p.id,
        reviewHash: p.reviewHash,
        decision: "approve",
        reason: "Synthetic",
      }),
    { code: "COST_REVIEW_CHANGED" },
  );
  assert.equal(c.detail(f.actor, p.id).state, "ready");
});
test("reviewed corrections fence new original acceptance and policy corruption fails closed", (t) => {
  const f = fixture(t),
    { original, reviewer } = setup(f),
    costs = f.app.integration.costs;
  costs.corrections.configure(f.actor, "policy", policy());
  const p = costs.corrections.prepare(
    f.actor,
    "correction",
    input(original, "unposted"),
  );
  costs.corrections.decide(reviewer, "approve", {
    correctionId: p.id,
    reviewHash: p.reviewHash,
    decision: "approve",
    reason: "Synthetic independent reviewer verified cancellation",
  });
  assert.throws(
    () =>
      costs.accept(f.actor, "late-original-acceptance", {
        packetId: original.id,
        contentHash: original.contentHash!,
        receiverRef: "synthetic-ledger",
        receiverRegion: "CA",
        externalRef: "synthetic-journal-1",
        debit: 18000,
        credit: 18000,
        reason: "Synthetic late original acceptance",
      }),
    { code: "COST_CORRECTION_CONFLICT" },
  );
  const store = f.app.database.owned("integration");
  store.run(
    "UPDATE integration_cost_policies SET policy_hash=? WHERE org_id=?",
    "0".repeat(64),
    f.actor.orgId,
  );
  assert.throws(() => costs.corrections.policy(f.actor), {
    code: "COST_INTEGRITY",
  });
  assert.equal(
    costs.corrections.download(reviewer, p.id).hash,
    costs.corrections.detail(reviewer, p.id).contentHash,
  );
});

for (const region of ["CA", "US"] as const) {
  test(`${region} correction leg outcomes retain uncertainty, partial effects and exact terminal observations without stock or artifact changes`, (t) => {
    const f = fixture(t, {}, region),
      { original, approved, reviewer, c } = approvedCorrection(f);
    const bytes = c.download(f.actor, approved.id).bytes,
      originalBytes = f.app.integration.costs.download(
        f.actor,
        original.id,
      ).bytes,
      stock = f.app.inventory.stock(f.actor),
      cursor = f.app.integration.costs.source(f.actor);
    const replacement = outcomeInput(f, approved.id, "replacement");
    const replacementUnknown = c.observe(
      reviewer,
      "replacement-unknown",
      replacement,
    );
    assert.throws(
      () =>
        c.observe(
          reviewer,
          "early-post",
          outcomeInput(f, approved.id, "replacement", {
            outcome: "posted",
            postingDate: "2026-10-03",
          }),
        ),
      { code: "COST_REVERSAL_REQUIRED" },
    );
    const uncertain = outcomeInput(f, approved.id, "reversal");
    const unknown = c.observe(reviewer, "unknown", uncertain);
    assert.deepEqual(c.observe(reviewer, "unknown", uncertain), unknown);
    assert.deepEqual(
      c.observe(reviewer, "same-evidence-new-key", uncertain),
      unknown,
    );
    assert.throws(
      () =>
        c.observe(reviewer, "changed-key", {
          ...uncertain,
          evidence: "different",
        }),
      { code: "REVISION_CONFLICT" },
    );
    assert.throws(
      () =>
        c.observe(
          reviewer,
          "new-identity",
          outcomeInput(f, approved.id, "reversal", { externalRef: "another" }),
        ),
      { code: "COST_REFERENCE_CONFLICT" },
    );
    const postedInput = outcomeInput(f, approved.id, "reversal", {
      outcome: "posted",
      postingDate: "2026-10-03",
      evidence:
        "Synthetic immutable journal lookup confirms posted exact reversal",
    });
    const posted = c.observe(reviewer, "resolved", postedInput);
    assert.equal(posted.revision, 2);
    assert.equal(
      c.outcomes(f.actor, approved.id).legs[1]!.current!.input.outcome,
      "unknown",
    );
    assert.throws(
      () =>
        c.observe(
          reviewer,
          "overwrite-terminal",
          outcomeInput(f, approved.id, "reversal", {
            outcome: "cancelled-unposted",
          }),
        ),
      { code: "COST_OUTCOME_FINAL" },
    );
    const complete = c.observe(
      reviewer,
      "replacement-posted",
      outcomeInput(f, approved.id, "replacement", {
        outcome: "posted",
        postingDate: "2026-10-03",
        evidence: "Synthetic ledger lookup confirms replacement",
      }),
    );
    assert.equal(complete.revision, 2);
    const history = c.outcomes(f.actor, approved.id);
    assert.deepEqual(
      history.legs[0]!.history.map((o) => o.input.outcome),
      ["unknown", "posted"],
    );
    assert.equal(
      history.legs[1]!.history[0]!.evidenceHash,
      replacementUnknown.evidenceHash,
    );
    assert.equal(c.download(f.actor, approved.id).bytes, bytes);
    assert.equal(
      f.app.integration.costs.download(f.actor, original.id).bytes,
      originalBytes,
    );
    assert.deepEqual(f.app.inventory.stock(f.actor), stock);
    assert.deepEqual(f.app.integration.costs.source(f.actor), cursor);
    f.app.close();
    f.app = new Application(f.path, region);
    assert.deepEqual(
      f.app.integration.costs.corrections.outcomes(reviewer, approved.id),
      history,
    );
    assert.deepEqual(
      f.app.integration.costs.corrections.observe(
        reviewer,
        "resolved",
        postedInput,
      ),
      posted,
    );
    f.app.platform.isolateRestore("a".repeat(64), "2026-10-03T00:00:00.000Z");
    assert.deepEqual(
      f.app.integration.costs.corrections.outcomes(reviewer, approved.id),
      history,
    );
    assert.throws(
      () =>
        f.app.integration.costs.corrections.observe(
          reviewer,
          "resolved",
          postedInput,
        ),
      { code: "RECOVERY_HOLD" },
    );
  });
  test(`${region} cancelled replacement after uncertain original non-posting remains final and retains its reference`, (t) => {
    const f = fixture(t, {}, region),
      { approved, reviewer, c } = approvedCorrection(f, "unposted");
    assert.deepEqual(
      c.outcomes(f.actor, approved.id).legs.map((l) => l.leg),
      ["replacement"],
    );
    assert.throws(
      () =>
        c.observe(reviewer, "absent-reversal", {
          ...outcomeInput(f, approved.id, "replacement"),
          leg: "reversal",
        }),
      { code: "COST_LEG" },
    );
    c.observe(reviewer, "unknown", outcomeInput(f, approved.id, "replacement"));
    const cancel = outcomeInput(f, approved.id, "replacement", {
      outcome: "cancelled-unposted",
      evidence: "Synthetic receiver confirms cancellation and no posting",
    });
    const receipt = c.observe(reviewer, "cancel", cancel);
    assert.deepEqual(c.observe(reviewer, "cancel-again", cancel), receipt);
    assert.throws(
      () =>
        c.observe(
          reviewer,
          "post-cancelled",
          outcomeInput(f, approved.id, "replacement", {
            outcome: "posted",
            postingDate: "2026-10-03",
          }),
        ),
      { code: "COST_OUTCOME_FINAL" },
    );
    assert.throws(
      () =>
        c.assertReferenceAvailable(
          f.actor,
          cancel.receiverRef,
          cancel.externalRef,
        ),
      { code: "COST_REFERENCE_CONFLICT" },
    );
  });
}
test("ledger observations bind exact region, currency, receiver, artifact, leg and intended totals and reserve original identities", (t) => {
  const f = fixture(t),
    { approved, reviewer, c } = approvedCorrection(f),
    valid = outcomeInput(f, approved.id, "reversal");
  for (const [name, overrides, code] of [
    ["hash", { contentHash: "0".repeat(64) }, "COST_INTEGRITY"],
    ["region", { receiverRegion: "US" }, "RESIDENCY"],
    ["currency", { currency: "USD" }, "RESIDENCY"],
    ["receiver", { receiverRef: "other-ledger" }, "RESIDENCY"],
    ["debit", { debit: 1 }, "COST_CONTROL"],
    ["credit", { credit: 1 }, "COST_CONTROL"],
    ["unknown-date", { postingDate: "2026-10-03" }, "COST_CONTROL"],
    ["posted-no-date", { outcome: "posted" }, "COST_CONTROL"],
    [
      "wrong-date",
      { outcome: "posted", postingDate: "2026-10-04" },
      "COST_CONTROL",
    ],
    ["outcome", { outcome: "assumed" }, "VALIDATION"],
    ["evidence", { evidence: " " }, "VALIDATION"],
    ["fraction", { debit: 0.5 }, "VALIDATION"],
    [
      "original-ref",
      { externalRef: "synthetic-journal-1" },
      "COST_REFERENCE_CONFLICT",
    ],
  ] as const)
    assert.throws(
      () =>
        c.observe(reviewer, name, {
          ...valid,
          ...overrides,
        } as CorrectionOutcomeInput),
      { code },
    );
  assert.equal(c.outcomes(f.actor, approved.id).legs[0]!.current, null);
  c.observe(reviewer, "reserve-reversal", valid);
  assert.throws(
    () =>
      c.observe(reviewer, "same-ref-replacement", {
        ...outcomeInput(f, approved.id, "replacement"),
        externalRef: valid.externalRef,
      }),
    { code: "COST_REFERENCE_CONFLICT" },
  );
  const other = fixture(t);
  assert.throws(() => c.outcomes(other.actor, approved.id), {
    code: "FORBIDDEN",
  });
  assert.throws(() => c.observe(other.actor, "foreign", valid), {
    code: "FORBIDDEN",
  });
  const store = f.app.database.owned("integration");
  store.run(
    "UPDATE integration_cost_correction_outcomes SET input=replace(input,'Synthetic','Tampered') WHERE correction_id=?",
    approved.id,
  );
  assert.throws(() => c.outcomes(reviewer, approved.id), {
    code: "COST_INTEGRITY",
  });
  assert.throws(() => c.observe(reviewer, "reserve-reversal", valid), {
    code: "COST_INTEGRITY",
  });
});
test("stale finance authority refuses cached ledger observation receipts", (t) => {
  const f = fixture(t),
    { approved, reviewer, c } = approvedCorrection(f),
    observation = outcomeInput(f, approved.id, "reversal");
  c.observe(reviewer, "observed", observation);
  const user = f.app.identity.users(f.actor).find((u) => u.id === reviewer.id)!;
  f.app.identity.updateUser(f.actor, "revoke", {
    userId: user.id,
    revision: user.revision,
    email: user.email,
    name: user.name,
    role: "warehouse",
    active: true,
    sites: [f.w1],
    currentPassword: "long-test-only-password",
    reason: "Synthetic authority changed",
  });
  assert.throws(() => c.observe(reviewer, "observed", observation), {
    code: "FORBIDDEN",
  });
  assert.throws(() => c.outcomes(reviewer, approved.id), { code: "FORBIDDEN" });
});

for (const region of ["CA", "US"] as const)
  for (const eventReports of [false, true])
    test(`${region}/${eventReports} current clones and encrypted restores preserve nonempty correction observations and permanent references`, async (t) => {
      const f = fixture(t, { eventReports }, region),
        { approved, reviewer, c } = approvedCorrection(f);
      const unknown = outcomeInput(f, approved.id, "reversal");
      c.observe(reviewer, "unknown", unknown);
      c.observe(
        reviewer,
        "posted",
        outcomeInput(f, approved.id, "reversal", {
          outcome: "posted",
          postingDate: "2026-10-03",
          evidence: "Synthetic posted lookup",
        }),
      );
      c.observe(
        reviewer,
        "replacement-unknown",
        outcomeInput(f, approved.id, "replacement"),
      );
      const history = c.outcomes(reviewer, approved.id),
        file = c.download(reviewer, approved.id),
        refs = f.app.database
          .owned("integration")
          .all(
            "SELECT * FROM integration_cost_correction_references ORDER BY leg",
          ),
        key = randomBytes(32),
        dir = dirname(f.path),
        archive = join(dir, "outcomes.backup"),
        restored = join(dir, "restored.db"),
        clone = join(dir, "clone.db");
      f.app.platform.isolateRestore("b".repeat(64), "2026-10-03T00:00:00.000Z");
      const receipt = inspectSchema(f.path);
      await createBackup(f.path, archive, region, key);
      await upgradeSchema(f.path, clone, receipt.schemaHash, region);
      await restoreBackup(archive, restored, region, key);
      for (const path of [clone, restored]) {
        const app = new Application(path, region, { eventReports });
        try {
          const copy = app.integration.costs.corrections;
          assert.deepEqual(copy.outcomes(reviewer, approved.id), history);
          assert.deepEqual(copy.download(reviewer, approved.id), file);
          assert.deepEqual(
            app.database
              .owned("integration")
              .all(
                "SELECT * FROM integration_cost_correction_references ORDER BY leg",
              ),
            refs,
          );
          assert.throws(() => copy.observe(reviewer, "unknown", unknown), {
            code: "RECOVERY_HOLD",
          });
        } finally {
          app.close();
        }
      }
      assert.deepEqual(c.outcomes(reviewer, approved.id), history);
    });
test("correction reservations fence fresh original acceptance and other correction origins", (t) => {
  const f = fixture(t),
    { approved, reviewer, c } = approvedCorrection(f);
  const observed = outcomeInput(f, approved.id, "reversal");
  c.observe(reviewer, "reserve", observed);
  ship(f, accept(f).id);
  const costs = f.app.integration.costs,
    source = costs.source(f.actor);
  const packet = costs.prepare(f.actor, "second-packet", {
    version: 1,
    batchRef: "SYNTHETIC-SECOND",
    afterSequence: 3,
    throughSequence: source.throughSequence,
    inventoryAccount: "1200",
    mappings: [{ type: "shipment", offsetAccount: "5000" }],
    expectedMovements: 1,
    expectedIncrease: 0,
    expectedDecrease: 6000,
    expectedOpeningValue: 18000,
    expectedClosingValue: 12000,
    acknowledgment: "Synthetic independent controls",
  });
  const ready = costs.decide(f.actor, "second-approve", {
    packetId: packet.id,
    reviewHash: packet.reviewHash,
    decision: "approve",
    reason: "Synthetic reviewed",
  });
  assert.throws(
    () =>
      costs.accept(f.actor, "duplicate-leg", {
        packetId: ready.id,
        contentHash: ready.contentHash!,
        receiverRef: observed.receiverRef,
        receiverRegion: "CA",
        externalRef: observed.externalRef,
        debit: 6000,
        credit: 6000,
        reason: "Synthetic duplicate reference",
      }),
    { code: "COST_REFERENCE_CONFLICT" },
  );
  c.configure(f.actor, "policy-2", {
    ...policy(1),
    mappings: [{ type: "shipment", offsetAccount: "5001" }],
  });
  assert.throws(
    () =>
      c.prepare(f.actor, "duplicate-origin", {
        ...input(ready),
        policyRevision: 2,
        externalRef: observed.externalRef,
      }),
    { code: "COST_REFERENCE_CONFLICT" },
  );
  costs.accept(f.actor, "other-original", {
    packetId: ready.id,
    contentHash: ready.contentHash!,
    receiverRef: observed.receiverRef,
    receiverRegion: "CA",
    externalRef: "synthetic-other-original",
    debit: 6000,
    credit: 6000,
    reason: "Synthetic other receipt",
  });
  assert.throws(
    () =>
      c.observe(reviewer, "duplicate-other-original", {
        ...outcomeInput(f, approved.id, "replacement"),
        externalRef: "synthetic-other-original",
      }),
    { code: "COST_REFERENCE_CONFLICT" },
  );
});
