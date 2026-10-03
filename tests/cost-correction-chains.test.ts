import { test } from "node:test";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createBackup, restoreBackup } from "../src/server/recovery.ts";
import { inspectSchema, upgradeSchema } from "../src/server/schema-upgrade.ts";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.ts";
import {
  approvedCorrection,
  input,
  outcomeInput,
  policy,
} from "./cost-correction-fixture.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import { journalFixture, postedResult } from "./stock-journal-fixture.ts";

for (const region of ["CA", "US"] as const)
  test(`${region} later mapping corrections reverse the settled replacement and preserve custody`, async (t) => {
    const f = fixture(t, {}, region),
      { original, reviewer, approved, c } = approvedCorrection(f);
    const rootBytes = f.app.integration.costs.download(
      f.actor,
      original.id,
    ).bytes;
    const firstBytes = c.download(f.actor, approved.id).bytes;
    const stock = f.app.inventory.stock(f.actor),
      cursor = f.app.integration.costs.source(f.actor);
    for (const leg of ["reversal", "replacement"] as const)
      c.observe(
        reviewer,
        `settle-${leg}`,
        outcomeInput(f, approved.id, leg, {
          outcome: "posted",
          postingDate: "2026-10-03",
          evidence: "Synthetic independent posted journal review",
        }),
      );
    c.configure(f.actor, "policy-two", {
      ...policy(1),
      inventoryAccount: "1202",
      mappings: [{ type: "receipt", offsetAccount: "2102" }],
    });
    const body = {
      ...input(original),
      policyRevision: 2,
      postingDate: "2026-10-04",
      originalPostingDate: "2026-10-03",
      externalRef: "synthetic-replacement",
      predecessor: {
        correctionId: approved.id,
        contentHash: approved.contentHash!,
      },
    };
    const p = c.prepare(f.actor, "second", body);
    const competing = c.prepare(f.actor, "competing", body);
    const decision = {
      correctionId: p.id,
      reviewHash: p.reviewHash,
      decision: "approve" as const,
      reason: "Synthetic second independent mapping review",
    };
    assert.throws(() => c.decide(f.actor, "self", decision), {
      code: "COST_SEPARATE_REVIEW",
    });
    const second = c.decide(reviewer, "second-approve", decision);
    assert.throws(
      () =>
        c.decide(reviewer, "competing-approve", {
          ...decision,
          correctionId: competing.id,
          reviewHash: competing.reviewHash,
        }),
      { code: "COST_CORRECTION_CONFLICT" },
    );
    const file = c.download(reviewer, second.id),
      doc = JSON.parse(file.bytes);
    assert.deepEqual(doc.input.predecessor, body.predecessor);
    assert.equal(doc.reversal[0].account, "1201");
    assert.equal(doc.reversal[1].account, "2101");
    assert.equal(doc.reversal[0].credit, 6000);
    assert.equal(doc.replacement[0].account, "1202");
    assert.equal(doc.replacement[1].account, "2102");
    assert.equal(doc.debit, 18000);
    assert.equal(c.download(f.actor, approved.id).bytes, firstBytes);
    assert.equal(
      f.app.integration.costs.download(f.actor, original.id).bytes,
      rootBytes,
    );
    assert.deepEqual(f.app.inventory.stock(f.actor), stock);
    assert.deepEqual(f.app.integration.costs.source(f.actor), cursor);
    assert.deepEqual(c.prepare(f.actor, "second", body), p);
    assert.deepEqual(c.decide(reviewer, "second-approve", decision), second);
    assert.throws(() => c.prepare(f.actor, "old-parent", body), {
      code: "COST_CORRECTION_CONFLICT",
    });
    f.app.close();
    f.app = new Application(f.path, region);
    assert.equal(
      f.app.integration.costs.corrections.download(reviewer, second.id).bytes,
      file.bytes,
    );
    f.app.platform.isolateRestore("a".repeat(64), "2026-10-03T00:00:00.000Z");
    assert.equal(
      f.app.integration.costs.corrections.download(reviewer, second.id).bytes,
      file.bytes,
    );
    assert.throws(
      () =>
        f.app.integration.costs.corrections.prepare(f.actor, "second", body),
      { code: "RECOVERY_HOLD" },
    );
    const outcomes = f.app.integration.costs.corrections.outcomes(
        reviewer,
        approved.id,
      ),
      clone = join(dirname(f.path), "chain-clone.db"),
      restored = join(dirname(f.path), "chain-restored.db"),
      archive = join(dirname(f.path), "chain.backup"),
      key = randomBytes(32);
    await upgradeSchema(
      f.path,
      clone,
      inspectSchema(f.path).schemaHash,
      region,
    );
    await createBackup(f.path, archive, region, key);
    await restoreBackup(archive, restored, region, key);
    for (const path of [clone, restored]) {
      const copy = new Application(path, region);
      try {
        assert.equal(
          copy.integration.costs.corrections.download(reviewer, second.id)
            .bytes,
          file.bytes,
        );
        assert.equal(
          copy.integration.costs.corrections.download(reviewer, approved.id)
            .bytes,
          firstBytes,
        );
        assert.deepEqual(
          copy.integration.costs.corrections.outcomes(reviewer, approved.id),
          outcomes,
        );
        assert.deepEqual(copy.inventory.stock(f.actor), stock);
        assert.deepEqual(copy.integration.costs.source(f.actor), {
          ...cursor,
          recoveryHold: true,
        });
        assert.throws(
          () =>
            copy.integration.costs.corrections.prepare(f.actor, "second", body),
          { code: "RECOVERY_HOLD" },
        );
      } finally {
        copy.close();
      }
    }
    // Inject an ancestor storage fault, then check only the public descendant
    // download boundary. A valid descendant hash cannot hide changed ancestry.
    f.app.close();
    const damaged = new DatabaseSync(f.path);
    damaged
      .prepare(
        "UPDATE integration_cost_corrections SET plan=plan||' ' WHERE id=?",
      )
      .run(approved.id);
    damaged.close();
    f.app = new Application(f.path, region);
    assert.throws(
      () => f.app.integration.costs.corrections.download(reviewer, second.id),
      { code: "COST_INTEGRITY" },
    );
  });

test("a successor refuses an unsettled, cancelled reversal or mismatched predecessor", (t) => {
  const f = fixture(t),
    { original, reviewer, approved, c } = approvedCorrection(f);
  c.configure(f.actor, "policy-two", {
    ...policy(1),
    inventoryAccount: "1202",
  });
  const body = {
    ...input(original),
    policyRevision: 2,
    originalPostingDate: "2026-10-03",
    externalRef: "synthetic-replacement",
    predecessor: {
      correctionId: approved.id,
      contentHash: approved.contentHash!,
    },
  };
  assert.throws(() => c.prepare(f.actor, "unsettled", body), {
    code: "COST_CHAIN_OUTCOME",
  });
  assert.throws(
    () =>
      c.prepare(f.actor, "hash", {
        ...body,
        predecessor: { ...body.predecessor, contentHash: "a".repeat(64) },
      }),
    { code: "COST_INTEGRITY" },
  );
  c.observe(
    reviewer,
    "cancel-reversal",
    outcomeInput(f, approved.id, "reversal", {
      outcome: "cancelled-unposted",
      evidence: "Synthetic independent cancellation",
    }),
  );
  assert.throws(() => c.prepare(f.actor, "cancelled-reversal", body), {
    code: "COST_CHAIN_OUTCOME",
  });
});

test("a finally cancelled replacement can have a changed replacement without reversing the original again", (t) => {
  const f = fixture(t),
    { original, reviewer, approved, c } = approvedCorrection(f);
  c.observe(
    reviewer,
    "reversal-posted",
    outcomeInput(f, approved.id, "reversal", {
      outcome: "posted",
      postingDate: "2026-10-03",
    }),
  );
  const cancelledInput = outcomeInput(f, approved.id, "replacement", {
    outcome: "cancelled-unposted",
    evidence:
      "Synthetic final cancellation and independently verified non-posting",
  });
  const cancelled = c.observe(
    reviewer,
    "replacement-cancelled",
    cancelledInput,
  );
  const retryBody = {
    correctionId: approved.id,
    contentHash: approved.contentHash!,
    leg: "replacement" as const,
    previousAttemptId: null,
    previousRevision: cancelled.revision,
    previousEvidenceHash: cancelled.evidenceHash,
    policyRevision: 1,
    externalRef: "synthetic-cancelled-retry",
    reason: "Synthetic same-journal retry draft",
  };
  const retry = c.prepareRetry(f.actor, "retry-draft", retryBody);
  c.configure(f.actor, "new-policy", {
    ...policy(1),
    inventoryAccount: "1202",
  });
  const body = {
    ...input(original, "unposted"),
    policyRevision: 2,
    externalRef: "synthetic-replacement",
    predecessor: {
      correctionId: approved.id,
      contentHash: approved.contentHash!,
    },
  };
  const p = c.prepare(f.actor, "changed-replacement", body);
  const next = c.decide(reviewer, "changed-approved", {
    correctionId: p.id,
    reviewHash: p.reviewHash,
    decision: "approve",
    reason: "Synthetic changed-journal approval",
  });
  assert.deepEqual(
    JSON.parse(c.download(reviewer, next.id).bytes).reversal,
    [],
  );
  assert.deepEqual(
    c.observe(reviewer, "replacement-cancelled", cancelledInput),
    cancelled,
  );
  assert.throws(() => c.observe(reviewer, "new-observe", cancelledInput), {
    code: "COST_CORRECTION_CONFLICT",
  });
  assert.throws(
    () =>
      c.prepareRetry(f.actor, "fresh-retry", {
        ...retryBody,
        policyRevision: 2,
      }),
    { code: "COST_CORRECTION_CONFLICT" },
  );
  assert.throws(
    () =>
      c.decideRetry(reviewer, "approve-old-retry", {
        retryId: retry.id,
        reviewHash: retry.reviewHash,
        decision: "approve",
        reason: "Synthetic stale retry approval",
      }),
    { code: "COST_CORRECTION_CONFLICT" },
  );
  c.observe(
    reviewer,
    "next-posted",
    outcomeInput(f, next.id, "replacement", {
      outcome: "posted",
      postingDate: "2026-10-03",
      externalRef: "synthetic-second-replacement",
    }),
  );
  c.configure(f.actor, "third-policy", {
    ...policy(2),
    inventoryAccount: "1203",
  });
  const third = c.prepare(f.actor, "third", {
    ...input(original),
    policyRevision: 3,
    originalPostingDate: "2026-10-03",
    externalRef: "synthetic-second-replacement",
    predecessor: { correctionId: next.id, contentHash: next.contentHash! },
  });
  const terminal = c.decide(reviewer, "third-approved", {
    correctionId: third.id,
    reviewHash: third.reviewHash,
    decision: "approve",
    reason: "Synthetic third changed-journal review",
  });
  const document = JSON.parse(c.download(reviewer, terminal.id).bytes);
  assert.equal(document.reversal[0].account, "1202");
  assert.equal(document.replacement[0].account, "1203");
});

test("successor approval refuses a policy changed after its frozen review", (t) => {
  const f = fixture(t),
    { original, reviewer, approved, c } = approvedCorrection(f, "unposted");
  c.observe(
    reviewer,
    "posted",
    outcomeInput(f, approved.id, "replacement", {
      outcome: "posted",
      postingDate: "2026-10-03",
    }),
  );
  c.configure(f.actor, "policy-two", {
    ...policy(1),
    inventoryAccount: "1202",
  });
  const body = {
    ...input(original),
    policyRevision: 2,
    originalPostingDate: "2026-10-03",
    externalRef: "synthetic-replacement",
    predecessor: {
      correctionId: approved.id,
      contentHash: approved.contentHash!,
    },
  };
  const p = c.prepare(f.actor, "changed", body);
  c.configure(f.actor, "policy-three", {
    ...policy(2),
    inventoryAccount: "1203",
  });
  assert.throws(
    () =>
      c.decide(reviewer, "stale", {
        correctionId: p.id,
        reviewHash: p.reviewHash,
        decision: "approve",
        reason: "Synthetic stale successor review",
      }),
    { code: "COST_POLICY" },
  );
});

test("native unresolved delivery cannot be bypassed by a posted manual predecessor attestation", (t) => {
  const { f, original, selected, reviewer, c, approve } = journalFixture(
    t,
    "CA",
    true,
  );
  approve();
  for (const leg of ["reversal", "replacement"] as const)
    c.observe(
      reviewer,
      `manual-${leg}`,
      outcomeInput(f, selected.id, leg, {
        outcome: "posted",
        postingDate: "2026-10-03",
      }),
    );
  c.configure(f.actor, "changed-policy", {
    ...policy(1),
    closedThrough: null,
    inventoryAccount: "1202",
  });
  assert.throws(
    () =>
      c.prepare(f.actor, "bypass-native", {
        ...input(original),
        policyRevision: 2,
        receiverRef: "quickbooks-sandbox:12345",
        externalRef: "synthetic-replacement",
        originalPostingDate: "2026-10-03",
        predecessor: {
          correctionId: selected.id,
          contentHash: selected.contentHash!,
        },
      }),
    { code: "COST_CHAIN_OUTCOME" },
  );
});

test("a native posted successor uses the posted predecessor replacement and current separately approved delivery", (t) => {
  const { f, original, selected, reviewer, c, j, make, approve } =
    journalFixture(t, "CA", true);
  for (const [leg, externalRef] of [
    ["reversal", "501"],
    ["replacement", "502"],
  ] as const) {
    const journal = approve(make(leg), `native-${leg}`),
      lease = j.claim(f.actor, journal.id, "write")!;
    j.beforeWrite(lease);
    j.posted(lease, postedResult(lease, externalRef));
    c.observe(
      reviewer,
      `observed-${leg}`,
      outcomeInput(f, selected.id, leg, {
        outcome: "posted",
        postingDate: "2026-10-03",
        externalRef,
      }),
    );
  }
  c.configure(f.actor, "next-policy", {
    ...policy(1),
    closedThrough: null,
    inventoryAccount: "1202",
  });
  const body = {
    ...input(original),
    policyRevision: 2,
    postingDate: "2026-10-04",
    receiverRef: "quickbooks-sandbox:12345",
    externalRef: "502",
    originalPostingDate: "2026-10-03",
    predecessor: {
      correctionId: selected.id,
      contentHash: selected.contentHash!,
    },
  };
  const p = c.prepare(f.actor, "successor", body),
    next = c.decide(reviewer, "successor-approve", {
      correctionId: p.id,
      reviewHash: p.reviewHash,
      decision: "approve",
      reason: "Synthetic native predecessor reconciliation",
    });
  const file = c.download(f.actor, next.id);
  const draft = j.prepare(f.actor, "next-reversal-delivery", {
    ...make(),
    sourceId: next.id,
    sourceHash: file.hash,
    policyRevision: 2,
    postingDate: "2026-10-04",
    accounts: [
      { sourceAccount: "1201", accountId: "10" },
      { sourceAccount: "2101", accountId: "11" },
    ],
  });
  const journal = j.decide(reviewer, "next-delivery-review", {
    journalId: draft.id,
    reviewHash: draft.reviewHash,
    decision: "approve",
    reason: "Synthetic independent next reversal delivery review",
  });
  const lease = j.claim(f.actor, journal.id, "write")!;
  j.beforeWrite(lease);
  assert.equal(j.posted(lease, postedResult(lease, "503")).state, "posted");
  assert.equal(JSON.parse(file.bytes).reversal[0].account, "1201");
  assert.throws(
    () =>
      j.prepare(f.actor, "superseded-delivery", {
        ...make(),
        policyRevision: 2,
      }),
    { code: "JOURNAL_SUPERSEDED" },
  );
});

test("authenticated HTTP strictly binds an optional predecessor and preserves exact command recovery", async (t) => {
  const f = fixture(t),
    { original, reviewer, approved, c } = approvedCorrection(f, "unposted");
  c.observe(
    reviewer,
    "posted",
    outcomeInput(f, approved.id, "replacement", {
      outcome: "posted",
      postingDate: "2026-10-03",
    }),
  );
  c.configure(f.actor, "policy-two", {
    ...policy(1),
    inventoryAccount: "1202",
  });
  const http = await createHttp(f.app, { origin: "http://localhost" });
  t.after(() => void http.close());
  const login = async (email: string, password: string) => {
    const r = await http.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin: "http://localhost" },
      payload: { email, password },
    });
    assert.equal(r.statusCode, 200);
    return {
      cookie: r.headers["set-cookie"]!.toString().split(";")[0]!,
      origin: "http://localhost",
      "x-csrf-token": r.json().csrf,
    };
  };
  const admin = await login("admin@example.test", "long-test-only-password"),
    finance = await login("finance@example.test", "test-only-long-password");
  const post = (name: string, payload: unknown, key: string, headers = admin) =>
    http.inject({
      method: "POST",
      url: `/api/commands/accounting.cost.correction.${name}`,
      headers: { ...headers, "idempotency-key": key },
      payload: payload as any,
    });
  const body = {
    ...input(original),
    policyRevision: 2,
    postingDate: "2026-10-04",
    originalPostingDate: "2026-10-03",
    externalRef: "synthetic-replacement",
    predecessor: {
      correctionId: approved.id,
      contentHash: approved.contentHash!,
    },
  };
  assert.equal(
    (
      await post(
        "prepare",
        { ...body, predecessor: { ...body.predecessor, forged: true } },
        "extra",
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (await post("prepare", { ...body, predecessor: null }, "null")).statusCode,
    400,
  );
  assert.equal(
    (await post("prepare", body, "csrf", { ...admin, "x-csrf-token": "bad" }))
      .statusCode,
    403,
  );
  const prepared = await post("prepare", body, "prepare");
  assert.equal(prepared.statusCode, 200);
  const p = prepared.json();
  assert.deepEqual(p.input.predecessor, body.predecessor);
  const decision = {
    correctionId: p.id,
    reviewHash: p.reviewHash,
    decision: "approve",
    reason: "Synthetic HTTP independent review",
  };
  assert.equal((await post("decide", decision, "self")).statusCode, 403);
  const result = await post("decide", decision, "http-approve", finance);
  assert.equal(result.statusCode, 200);
  assert.deepEqual((await post("prepare", body, "prepare")).json(), p);
  assert.deepEqual(
    (await post("decide", decision, "http-approve", finance)).json(),
    result.json(),
  );
  assert.equal((await post("prepare", body, "another")).statusCode, 409);
});
