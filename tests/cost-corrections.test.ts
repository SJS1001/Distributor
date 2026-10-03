import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import {
  accountingDate,
  type CorrectionInput,
  type CostPolicyInput,
} from "../src/server/cost-corrections.ts";
import { digest } from "../src/server/core.ts";
import { createHttp } from "../src/server/http.ts";

type Fixture = ReturnType<typeof fixture>;
function setup(f: Fixture) {
  const source = f.app.integration.costs.source(f.actor);
  const prepared = f.app.integration.costs.prepare(f.actor, "original", {
    version: 1,
    batchRef: "ORIGINAL",
    afterSequence: 0,
    throughSequence: source.throughSequence,
    inventoryAccount: "1200",
    mappings: [{ type: "receipt", offsetAccount: "2100" }],
    expectedMovements: 3,
    expectedIncrease: 18000,
    expectedDecrease: 0,
    expectedOpeningValue: 0,
    expectedClosingValue: 18000,
    acknowledgment: "Synthetic independent controls",
  });
  const original = f.app.integration.costs.decide(f.actor, "approve-original", {
    packetId: prepared.id,
    reviewHash: prepared.reviewHash,
    decision: "approve",
    reason: "Synthetic finance review",
  });
  const u = f.app.identity.createUser(f.actor, "reviewer", {
    email: "finance@example.test",
    name: "Synthetic reviewer",
    password: "test-only-long-password",
    role: "finance",
    sites: [],
  });
  const reviewer = f.app.identity.currentActor({ ...f.actor, id: u.id });
  return { original, reviewer };
}
function policy(previousRevision = 0): CostPolicyInput {
  return {
    previousRevision,
    policyVersion: "synthetic-policy-v1",
    mappingVersion: "synthetic-chart-v2",
    establishedValuation:
      "Synthetic established specific identification; no new valuation calculation",
    period: "monthly",
    closedThrough: "2026-09-30",
    inventoryPostingOwner: "distributor",
    inventoryAccount: "1201",
    mappings: [{ type: "receipt", offsetAccount: "2101" }],
    financeEvidence: "Synthetic finance policy approval",
  };
}
function input(
  original: ReturnType<typeof setup>["original"],
  outcome: CorrectionInput["outcome"] = "posted",
): CorrectionInput {
  return {
    originalId: original.id,
    originalHash: original.contentHash!,
    policyRevision: 1,
    postingDate: "2026-10-03",
    outcome,
    receiverRef: "synthetic-ledger",
    externalRef: "synthetic-journal-1",
    originalPostingDate: outcome === "posted" ? "2026-09-29" : null,
    outcomeEvidence: "Synthetic ledger outcome checked independently",
    cancellationEvidence:
      outcome === "unposted"
        ? "Synthetic receiver cancelled original, verified no posting"
        : null,
    priorPeriodEvidence:
      "Synthetic responsible accountant reviewed prior period treatment",
    reason: "Correct two synthetic account mappings",
  };
}
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
