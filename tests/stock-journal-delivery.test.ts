import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { Application } from "../src/server/application.ts";
import { createBackup, restoreBackup } from "../src/server/recovery.ts";
import { journalFixture, postedResult } from "./stock-journal-fixture.ts";
import {
  input as correctionInput,
  policy,
  outcomeInput,
} from "./cost-correction-fixture.ts";
import { stockJournalReceiver } from "../src/server/stock-journal-delivery.ts";

for (const region of ["CA", "US"] as const)
  test(`${region} exact independent native review, immutable source, one write and retained posting survive restart`, (t) => {
    const { f, j, make, approve, original } = journalFixture(t, region);
    const bytes = f.app.integration.costs.download(f.actor, original.id);
    const approved = approve();
    assert.equal(j.prepare(f.actor, "journal-prepare", make()).id, approved.id);
    assert.throws(() => j.prepare(f.actor, "duplicate", make()), {
      code: "JOURNAL_DUPLICATE",
    });
    const lease = j.claim(f.actor, approved.id, "write")!;
    assert.ok(
      Object.isFrozen(lease) &&
        Object.isFrozen(lease.actor) &&
        Object.isFrozen(lease.effect) &&
        Object.isFrozen(lease.authority),
    );
    assert.throws(() => j.guard({ ...lease }), { code: "JOURNAL_LEASE" });
    assert.throws(() => j.posted(lease, postedResult(lease)), {
      code: "JOURNAL_WRITE_REQUIRED",
    });
    j.beforeWrite(lease);
    assert.throws(() => j.beforeWrite(lease), { code: "JOURNAL_WRITE_ONCE" });
    assert.equal(j.posted(lease, postedResult(lease)).state, "posted");
    assert.equal(j.claim(f.actor, approved.id, "write"), null);
    assert.throws(() => j.unresolved(lease, "transport-uncertain"), {
      code: "JOURNAL_LEASE",
    });
    assert.deepEqual(
      f.app.integration.costs.download(f.actor, original.id),
      bytes,
    );
    f.app.close();
    f.app = new Application(f.path, region, { eventReports: false });
    const retained = f.app.integration.costs.journals.detail(
      f.actor,
      approved.id,
    );
    assert.equal(retained.state, "posted");
    assert.equal(retained.externalId, "500");
    assert.equal(retained.observations.length, 1);
    assert.deepEqual(retained.plan, approved.plan);
  });

test("independent review, exact hashes, company/source scope and rejected selection replacement", (t) => {
  const { f, j, make, reviewer } = journalFixture(t);
  const ready = j.prepare(f.actor, "prepare", make());
  assert.throws(
    () =>
      j.decide(f.actor, "self", {
        journalId: ready.id,
        reviewHash: ready.reviewHash,
        decision: "approve",
        reason: "Synthetic",
      }),
    { code: "JOURNAL_SEPARATE_REVIEW" },
  );
  assert.throws(
    () =>
      j.decide(reviewer, "hash", {
        journalId: ready.id,
        reviewHash: "0".repeat(64),
        decision: "approve",
        reason: "Synthetic",
      }),
    { code: "JOURNAL_REVIEW_CHANGED" },
  );
  assert.throws(
    () => j.prepare(f.actor, "company", { ...make(), realm: "999" }),
    { code: "JOURNAL_COMPANY" },
  );
  assert.throws(
    () =>
      j.prepare(f.actor, "source", { ...make(), sourceHash: "0".repeat(64) }),
    { code: "JOURNAL_SOURCE" },
  );
  assert.throws(() => j.detail({ ...f.actor, orgId: "foreign" }, ready.id));
  assert.throws(
    () => j.prepare(f.actor, "accounts", { ...make(), accounts: [] }),
    { code: "JOURNAL_INPUT" },
  );
  j.decide(reviewer, "reject", {
    journalId: ready.id,
    reviewHash: ready.reviewHash,
    decision: "reject",
    reason: "Synthetic rejection",
  });
  assert.equal(j.prepare(f.actor, "new", make()).state, "ready");
});

for (const mode of ["expiry", "rollback"] as const)
  test(`${mode} converts write ownership to unknown durably and fences old workers`, (t) => {
    const { f, j, approve } = journalFixture(t),
      approved = approve(),
      clock = Date.now();
    t.mock.method(Date, "now", () => clock);
    const old = j.claim(f.actor, approved.id, "write")!;
    const other = new Application(f.path, "CA", { eventReports: false });
    t.after(() => other.close());
    assert.equal(
      other.integration.costs.journals.claim(f.actor, approved.id, "write"),
      null,
    );
    t.mock.method(Date, "now", () =>
      mode === "expiry" ? clock + 120000 : clock - 1,
    );
    assert.throws(() => j.beforeWrite(old), { code: "JOURNAL_LEASE" });
    assert.equal(
      other.integration.costs.journals.claim(f.actor, approved.id, "write"),
      null,
    );
    assert.equal(j.detail(f.actor, approved.id).state, "unknown");
    assert.throws(() => j.claim(f.actor, approved.id, "write"), {
      code: "JOURNAL_STATE",
    });
    const lookup = other.integration.costs.journals.claim(
      f.actor,
      approved.id,
      "lookup",
    )!;
    assert.equal(lookup.mode, "lookup");
    assert.throws(() => j.unresolved(old, "transport-uncertain"), {
      code: "JOURNAL_LEASE",
    });
    assert.throws(() => other.integration.costs.journals.beforeWrite(lookup), {
      code: "JOURNAL_WRITE_ONCE",
    });
    other.integration.costs.journals.posted(lookup, postedResult(lookup));
    assert.equal(j.detail(f.actor, approved.id).observations.length, 2);
  });

test("uncertain write and repeated lookup misses never authorize replay; policy changes still allow exact lookup", (t) => {
  const { f, j, c, approve } = journalFixture(t),
    approved = approve(),
    lease = j.claim(f.actor, approved.id, "write")!;
  j.beforeWrite(lease);
  j.unresolved(lease, "transport-uncertain");
  c.configure(f.actor, "new-policy", { ...policy(1), closedThrough: null });
  for (let i = 0; i < 2; i++) {
    const lookup = j.claim(f.actor, approved.id, "lookup")!;
    j.guard(lookup);
    j.unresolved(lookup, "lookup-miss");
  }
  assert.throws(() => j.claim(f.actor, approved.id, "write"), {
    code: "JOURNAL_STATE",
  });
  const lookup = j.claim(f.actor, approved.id, "lookup")!;
  assert.equal(j.posted(lookup, postedResult(lookup)).state, "posted");
  assert.equal(j.detail(f.actor, approved.id).observations.length, 4);
});

test("current policy and closed period fence reviewed writes", (t) => {
  const { f, j, c, approve, make } = journalFixture(t),
    approved = approve();
  c.configure(f.actor, "close", {
    ...policy(1),
    closedThrough: make().postingDate,
  });
  assert.throws(() => j.claim(f.actor, approved.id, "write"), {
    code: "JOURNAL_POLICY",
  });
  assert.equal(j.detail(f.actor, approved.id).state, "pending");
  assert.throws(
    () => j.prepare(f.actor, "closed", { ...make(), policyRevision: 2 }),
    { code: "JOURNAL_PERIOD" },
  );
});

test("withdrawn current organization permission blocks late writes and posted success, but permits local stopping", (t) => {
  const { f, j, approve } = journalFixture(t),
    approved = approve(),
    lease = j.claim(f.actor, approved.id, "write")!;
  const r = f.app.identity.organizationResidency,
    current = r.current(f.actor);
  r.choose(f.actor, "withdraw", {
    region: "CA",
    revision: current.choice.revision,
    mode: "strict",
    realm: null,
    acknowledgment: "Synthetic withdrawal",
  });
  assert.throws(() => j.guard(lease));
  assert.throws(() => j.beforeWrite(lease));
  assert.throws(() => j.posted(lease, postedResult(lease)));
  assert.equal(j.unresolved(lease, "authority-changed").state, "unknown");
  assert.throws(() => j.claim(f.actor, approved.id, "lookup"));
});

test("late native audit failure rolls back write fence and posting observation", (t) => {
  const { f, j, approve } = journalFixture(t),
    approved = approve(),
    lease = j.claim(f.actor, approved.id, "write")!;
  const audit = f.app.platform.audit.bind(f.app.platform);
  t.mock.method(f.app.platform, "audit", () => {
    throw Error("Synthetic audit failure");
  });
  assert.throws(() => j.beforeWrite(lease), /Synthetic audit failure/);
  assert.equal(j.detail(f.actor, approved.id).dispatched, false);
  t.mock.method(f.app.platform, "audit", audit);
  j.beforeWrite(lease);
  t.mock.method(f.app.platform, "audit", () => {
    throw Error("Synthetic audit failure");
  });
  assert.throws(
    () => j.posted(lease, postedResult(lease)),
    /Synthetic audit failure/,
  );
  assert.equal(j.detail(f.actor, approved.id).observations.length, 0);
  t.mock.method(f.app.platform, "audit", audit);
  assert.equal(j.posted(lease, postedResult(lease)).state, "posted");
});

for (const field of [
  "realmId",
  "sourceHash",
  "leg",
  "postingDate",
  "currency",
  "debit",
  "credit",
  "syncToken",
] as const)
  test(`posted observation rejects changed ${field} without consuming ownership`, (t) => {
    const { f, j, approve } = journalFixture(t),
      approved = approve(),
      lease = j.claim(f.actor, approved.id, "write")!;
    j.beforeWrite(lease);
    const result = postedResult(lease);
    result.result[field] =
      field === "debit" || field === "credit" ? 1 : "invalid";
    assert.throws(() => j.posted(lease, result), { code: "JOURNAL_RESPONSE" });
    assert.equal(j.detail(f.actor, approved.id).state, "running");
    assert.equal(j.detail(f.actor, approved.id).observations.length, 0);
    j.posted(lease, postedResult(lease));
  });

test("native original uncertainty prevents manual acceptance and correction approval until exact reconciliation", (t) => {
  const { f, j, c, approve, original } = journalFixture(t),
    approved = approve(),
    lease = j.claim(f.actor, approved.id, "write")!;
  j.beforeWrite(lease);
  j.unresolved(lease, "transport-uncertain");
  assert.throws(
    () =>
      c.prepare(f.actor, "wrong", {
        ...correctionInput(original),
        receiverRef: stockJournalReceiver("12345"),
      }),
    { code: "COST_NATIVE_OUTCOME" },
  );
  assert.throws(
    () =>
      f.app.integration.costs.accept(f.actor, "manual", {
        packetId: original.id,
        contentHash: original.contentHash!,
        receiverRef: stockJournalReceiver("12345"),
        receiverRegion: "CA",
        externalRef: "500",
        debit: 18000,
        credit: 18000,
        reason: "Synthetic",
      }),
    { code: "COST_NATIVE_OUTCOME" },
  );
  const lookup = j.claim(f.actor, approved.id, "lookup")!;
  j.posted(lookup, postedResult(lookup));
  assert.equal(
    c.prepare(f.actor, "correct", {
      ...correctionInput(original),
      receiverRef: stockJournalReceiver("12345"),
      externalRef: "500",
      originalPostingDate: approved.postingDate,
    }).state,
    "ready",
  );
});

test("replacement waits for native reversal and manual claims cannot bypass uncertain native ownership", (t) => {
  const { f, j, c, approve, selected, make, reviewer } = journalFixture(
      t,
      "CA",
      true,
    ),
    reversal = approve(),
    replacement = approve(make("replacement"), "replacement");
  assert.throws(() => j.claim(f.actor, replacement.id, "write"), {
    code: "JOURNAL_REVERSAL_REQUIRED",
  });
  const first = j.claim(f.actor, reversal.id, "write")!;
  j.beforeWrite(first);
  j.unresolved(first, "transport-uncertain");
  c.observe(
    reviewer,
    "manual-posted",
    outcomeInput(f, selected.id, "reversal", {
      outcome: "posted",
      externalRef: "synthetic-reversal",
      postingDate: reversal.postingDate,
      evidence: "Synthetic manual claim",
    }),
  );
  assert.throws(() => j.claim(f.actor, replacement.id, "write"), {
    code: "JOURNAL_REVERSAL_REQUIRED",
  });
  const lookup = j.claim(f.actor, reversal.id, "lookup")!;
  j.posted(lookup, postedResult(lookup));
  const next = j.claim(f.actor, replacement.id, "write")!;
  j.beforeWrite(next);
  j.posted(next, postedResult(next, "501"));
  assert.equal(j.detail(f.actor, replacement.id).state, "posted");
});

test("fresh correction retry needs final cancellation of its exact native predecessor and separate native reference review", (t) => {
  const { f, j, c, approve, selected, make, reviewer } = journalFixture(
      t,
      "CA",
      true,
    ),
    first = approve(),
    lease = j.claim(f.actor, first.id, "write")!;
  j.beforeWrite(lease);
  j.unresolved(lease, "transport-uncertain");
  const proof = c.observe(
    reviewer,
    "cancelled",
    outcomeInput(f, selected.id, "reversal", {
      outcome: "cancelled-unposted",
      externalRef: "synthetic-reversal",
      evidence: "Synthetic final cancellation and verified non-posting",
    }),
  );
  const state = c.outcomes(f.actor, selected.id),
    leg = state.legs.find((l) => l.leg === "reversal")!;
  const ready = c.prepareRetry(f.actor, "retry", {
    correctionId: selected.id,
    contentHash: state.contentHash,
    leg: "reversal",
    previousAttemptId: null,
    previousRevision: leg.current!.revision,
    previousEvidenceHash: leg.current!.evidenceHash,
    policyRevision: 1,
    externalRef: "synthetic-fresh-retry",
    reason: "Synthetic separate fresh attempt",
  });
  const retry = c.decideRetry(reviewer, "retry-approved", {
    retryId: ready.id,
    reviewHash: ready.reviewHash,
    decision: "approve",
    reason: "Synthetic independent retry approval",
  });
  const second = approve(make("reversal", retry.id), "retry-delivery");
  assert.throws(() => j.claim(f.actor, second.id, "write"), {
    code: "JOURNAL_PREDECESSOR",
  });
  const evidenceHash = leg.current!.evidenceHash;
  assert.throws(
    () =>
      j.cancelCorrectionAttempt(reviewer, "self-cancel", {
        journalId: first.id,
        requestRef: first.requestRef,
        evidenceHash,
        reason: "Synthetic",
      }),
    { code: "JOURNAL_CANCELLATION" },
  );
  assert.throws(
    () =>
      j.cancelCorrectionAttempt(f.actor, "wrong-reference", {
        journalId: first.id,
        requestRef: "wrong",
        evidenceHash,
        reason: "Synthetic",
      }),
    { code: "JOURNAL_CANCELLATION" },
  );
  assert.equal(
    j.cancelCorrectionAttempt(f.actor, "cancel", {
      journalId: first.id,
      requestRef: first.requestRef,
      evidenceHash,
      reason:
        "Synthetic separate reviewer binds exact native request to retained cancellation",
    }).state,
    "cancelled",
  );
  const fresh = j.claim(f.actor, second.id, "write")!;
  j.beforeWrite(fresh);
  j.posted(fresh, postedResult(fresh));
  assert.notEqual(second.requestRef, first.requestRef);
  assert.equal(j.detail(f.actor, first.id).state, "cancelled");
});

test("reference reservations survive cancellation and cannot be reused by manual retry approval", (t) => {
  const { f, j, c, approve, selected, reviewer } = journalFixture(
      t,
      "CA",
      true,
    ),
    first = approve(),
    lease = j.claim(f.actor, first.id, "write")!;
  j.unresolved(lease, "transport-uncertain");
  c.observe(
    reviewer,
    "cancelled",
    outcomeInput(f, selected.id, "reversal", {
      outcome: "cancelled-unposted",
      externalRef: "synthetic-reversal",
      evidence: "Synthetic final cancellation",
    }),
  );
  const state = c.outcomes(f.actor, selected.id),
    leg = state.legs[0]!;
  assert.throws(
    () =>
      c.prepareRetry(f.actor, "reserved", {
        correctionId: selected.id,
        contentHash: state.contentHash,
        leg: "reversal",
        previousAttemptId: null,
        previousRevision: leg.current!.revision,
        previousEvidenceHash: leg.current!.evidenceHash,
        policyRevision: 1,
        externalRef: first.requestRef,
        reason: "Synthetic",
      }),
    { code: "COST_REFERENCE_CONFLICT" },
  );
});

test("a receiver journal cannot satisfy two native operations and conflict rolls back its observation", (t) => {
  const { f, j, approve, make } = journalFixture(t, "CA", true),
    reversal = approve(),
    replacement = approve(make("replacement"), "replacement"),
    first = j.claim(f.actor, reversal.id, "write")!;
  j.beforeWrite(first);
  j.posted(first, postedResult(first));
  const second = j.claim(f.actor, replacement.id, "write")!;
  j.beforeWrite(second);
  assert.throws(() => j.posted(second, postedResult(second)));
  assert.equal(j.detail(f.actor, replacement.id).state, "running");
  assert.equal(j.detail(f.actor, replacement.id).observations.length, 0);
  assert.equal(j.posted(second, postedResult(second, "501")).state, "posted");
});

for (const changed of ["body", "recorded_by", "recorded_at"] as const)
  test(`native observation ${changed} integrity fails closed`, (t) => {
    const { f, j, approve } = journalFixture(t),
      approved = approve(),
      lease = j.claim(f.actor, approved.id, "write")!;
    j.unresolved(lease, "transport-uncertain");
    const db = new DatabaseSync(f.path);
    db.prepare(
      `UPDATE integration_stock_journal_observations SET ${changed}=? WHERE journal_id=?`,
    ).run("{}", approved.id);
    db.close();
    assert.throws(() => j.detail(f.actor, approved.id), {
      code: "JOURNAL_INTEGRITY",
    });
  });

test("held encrypted restore and current clone preserve reviewed native ownership and observations", async (t) => {
  const { f, j, approve } = journalFixture(t),
    approved = approve(),
    lease = j.claim(f.actor, approved.id, "write")!;
  j.beforeWrite(lease);
  j.unresolved(lease, "transport-uncertain");
  const key = randomBytes(32),
    archive = join(dirname(f.path), "journal.backup"),
    target = join(dirname(f.path), "journal-restored.db");
  await createBackup(f.path, archive, "CA", key);
  await restoreBackup(archive, target, "CA", key);
  const restored = new Application(target, "CA", { eventReports: false });
  t.after(() => restored.close());
  const retained = restored.integration.costs.journals.detail(
    f.actor,
    approved.id,
  );
  assert.equal(retained.state, "unknown");
  assert.equal(retained.dispatched, true);
  assert.deepEqual(retained.plan, approved.plan);
  assert.equal(retained.observations.length, 1);
  assert.throws(
    () =>
      restored.integration.costs.journals.claim(f.actor, approved.id, "lookup"),
    { code: "RECOVERY_HOLD" },
  );
});

test("independent processes released at a barrier retain exactly one native write owner", async (t) => {
  const { f, j, approve } = journalFixture(t),
    approved = approve();
  const { fork } = await import("node:child_process");
  const children = [0, 1].map(() =>
    fork(new URL("./stock-journal-child.ts", import.meta.url), [], {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    }),
  );
  t.after(() =>
    children.forEach((child) => {
      if (child.exitCode === null) child.kill();
    }),
  );
  const results = await new Promise<{ ok: boolean; claimed: boolean }[]>(
    (resolve, reject) => {
      const ready = new Set<number>(),
        closed = new Set<number>(),
        outcomes: { ok: boolean; claimed: boolean }[] = [],
        errors = ["", ""];
      const timer = setTimeout(
        () => reject(Error("Synthetic journal process barrier timed out")),
        20000,
      );
      t.after(() => clearTimeout(timer));
      children.forEach((child, i) => {
        child.stderr?.on("data", (bytes) => {
          errors[i] += String(bytes);
        });
        child.on("error", reject);
        child.on("message", (message: any) => {
          if (message.ready) {
            ready.add(i);
            if (ready.size === 2)
              children.forEach((c) => c.send({ action: "go" }));
          } else {
            outcomes[i] = message;
          }
        });
        child.on("close", (code) => {
          if (code !== 0 || !outcomes[i]) {
            reject(Error(errors[i]));
            return;
          }
          closed.add(i);
          if (closed.size === 2) {
            clearTimeout(timer);
            resolve(outcomes);
          }
        });
        child.send({
          action: "init",
          job: { path: f.path, actor: f.actor, journalId: approved.id },
        });
      });
    },
  );
  assert.ok(
    results.every((r) => r.ok),
    JSON.stringify(results),
  );
  assert.equal(results.filter((r) => r.claimed).length, 1);
  assert.equal(j.detail(f.actor, approved.id).state, "running");
});

for (const change of ["role", "disabled", "password"] as const)
  test(`persisted ${change} changes fence stale worker authority while allowing local uncertainty`, (t) => {
    const { f, j, approve, reviewer } = journalFixture(t),
      approved = approve(),
      lease = j.claim(reviewer, approved.id, "write")!;
    const db = new DatabaseSync(f.path);
    if (change === "role")
      db.prepare("UPDATE iam_users SET role='sales' WHERE id=?").run(
        reviewer.id,
      );
    else if (change === "disabled")
      db.prepare("UPDATE iam_users SET active=0 WHERE id=?").run(reviewer.id);
    else
      db.prepare(
        "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
      ).run(reviewer.id);
    db.close();
    assert.throws(() => j.guard(lease));
    assert.throws(() => j.beforeWrite(lease));
    assert.throws(() => j.posted(lease, postedResult(lease)));
    assert.equal(j.unresolved(lease, "authority-changed").state, "unknown");
  });

test("policy changes between claim and actual write fence block dispatch and stale success", (t) => {
  const { f, j, c, approve } = journalFixture(t),
    approved = approve(),
    lease = j.claim(f.actor, approved.id, "write")!;
  c.configure(f.actor, "changed", { ...policy(1), closedThrough: null });
  assert.throws(() => j.beforeWrite(lease), { code: "JOURNAL_POLICY" });
  assert.throws(() => j.posted(lease, postedResult(lease)), {
    code: "JOURNAL_POLICY",
  });
  assert.equal(j.detail(f.actor, approved.id).dispatched, false);
  j.unresolved(lease, "authority-changed");
});

test("reviewed source and mapping bytes cannot be changed after selection", (t) => {
  const { f, j, approve, make } = journalFixture(t),
    selection = make(),
    approved = approve(selection);
  selection.accounts[0]!.accountId = "999";
  selection.reason = "Changed after review";
  assert.notEqual(
    j.detail(f.actor, approved.id).plan.input.accounts[0]!.accountId,
    "999",
  );
  const lease = j.claim(f.actor, approved.id, "write")!;
  const db = new DatabaseSync(f.path);
  db.prepare(
    "UPDATE integration_cost_packets SET artifact='{}' WHERE id=?",
  ).run(approved.sourceId);
  db.close();
  assert.throws(() => j.guard(lease));
  assert.throws(() => j.beforeWrite(lease));
  assert.equal(j.detail(f.actor, approved.id).dispatched, false);
});

test("offline current clone retains native posted evidence and permanent references", async (t) => {
  const { f, j, approve } = journalFixture(t),
    approved = approve(),
    lease = j.claim(f.actor, approved.id, "write")!;
  j.beforeWrite(lease);
  j.posted(lease, postedResult(lease));
  const { upgradeSchema, inspectSchema } =
    await import("../src/server/schema-upgrade.ts");
  const destination = join(dirname(f.path), "journal-clone.db");
  await upgradeSchema(
    f.path,
    destination,
    inspectSchema(f.path).schemaHash,
    "CA",
  );
  const cloned = new Application(destination, "CA", { eventReports: false });
  t.after(() => cloned.close());
  const detail = cloned.integration.costs.journals.detail(f.actor, approved.id);
  assert.equal(detail.state, "posted");
  assert.equal(detail.requestRef, approved.requestRef);
  assert.equal(detail.observations[0]!.body.result.reference, "500");
  assert.equal(
    cloned.integration.costs.journals.claim(f.actor, approved.id, "lookup"),
    null,
  );
});
