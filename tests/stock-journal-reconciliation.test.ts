// Synthetic local reconciliation only. No provider I/O or actual ledger qualification.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fork } from "node:child_process";
import { journalFixture, postedResult } from "./stock-journal-fixture.ts";
import { createHttp } from "../src/server/http.ts";
import { Application } from "../src/server/application.ts";
import type { JournalReconciliationInput } from "../src/server/stock-journal-reconciliation.ts";

function mutate(path: string, sql: string, ...values: (string | number)[]) {
  const db = new DatabaseSync(path);
  try {
    db.prepare(sql).run(...values);
  } finally {
    db.close();
  }
}

test("accepted reconciliation refuses a lost permanent batch reference on reads and recovery", (t) => {
  const { f, costs, reviewer, input, review, j } = complete(t);
  const accepted = costs.reconcileJournals(reviewer, "cached", input);
  const journals = review.dates.map((d) => j.detail(reviewer, d.journal!.id));
  mutate(
    f.path,
    "DELETE FROM integration_cost_receipts WHERE packet_id=?",
    input.packetId,
  );
  assert.throws(() => costs.journalReconciliation(reviewer, input.packetId), {
    code: "COST_INTEGRITY",
  });
  for (const key of ["cached", "same-evidence"])
    assert.throws(() => costs.reconcileJournals(reviewer, key, input), {
      code: "COST_INTEGRITY",
    });
  assert.deepEqual(
    costs.detail(reviewer, input.packetId).receipt,
    accepted.receipt,
  );
  assert.deepEqual(
    review.dates.map((d) => j.detail(reviewer, d.journal!.id)),
    journals,
  );
});

test("cached reconciliation cannot substitute a different packet identity", (t) => {
  const { f, costs, reviewer, input } = complete(t);
  costs.reconcileJournals(reviewer, "cached", input);
  mutate(
    f.path,
    "UPDATE platform_commands SET result=json_set(result,'$.id','synthetic-foreign-packet') WHERE name='accounting.cost.reconcile-journals'",
  );
  assert.throws(() => costs.reconcileJournals(reviewer, "cached", input), {
    code: "COST_INTEGRITY",
  });
  assert.equal(costs.detail(reviewer, input.packetId).state, "accepted");
});

test("accepted reconciliation reads refuse changed retained date attestations", (t) => {
  const { f, costs, reviewer, input } = complete(t);
  costs.reconcileJournals(reviewer, "cached", input);
  mutate(
    f.path,
    "UPDATE integration_cost_packets SET receipt=json_set(receipt,'$.nativeReconciliation.journals[0].debit',5999) WHERE id=?",
    input.packetId,
  );
  assert.throws(() => costs.journalReconciliation(reviewer, input.packetId), {
    code: "COST_INTEGRITY",
  });
  assert.throws(() => costs.reconcileJournals(reviewer, "cached", input), {
    code: "COST_INTEGRITY",
  });
});

test("reconciliation rejects whitespace aliases for permanently reserved references", (t) => {
  const { costs, reviewer, input, review } = complete(t);
  assert.throws(
    () =>
      costs.reconcileJournals(reviewer, "reference-alias", {
        ...input,
        externalRef: ` ${review.dates[0]!.journal!.requestRef} `,
      }),
    { code: "COST_RECONCILIATION_INPUT" },
  );
  assert.equal(costs.detail(reviewer, input.packetId).receipt, null);
});

const dates = ["2026-10-01", "2026-10-02", "2026-10-03"] as const;
function complete(
  t: Parameters<typeof journalFixture>[0],
  region: "CA" | "US" = "CA",
  lookupCycles = 0,
) {
  const context = journalFixture(t, region, false, dates);
  for (const [i, date] of dates.entries()) {
    const journal = context.approve(
      { ...context.make(), postingDate: date },
      `date-${i}`,
    );
    let lease = context.j.claim(context.f.actor, journal.id, "write")!;
    context.j.beforeWrite(lease);
    if (i === 0)
      for (let n = 0; n < lookupCycles; n++) {
        context.j.unresolved(lease, "lookup-miss");
        lease = context.j.claim(context.f.actor, journal.id, "lookup")!;
      }
    context.j.posted(lease, postedResult(lease, String(500 + i)));
  }
  const costs = context.f.app.integration.costs;
  const review = costs.journalReconciliation(
    context.reviewer,
    context.original.id,
  );
  const input = {
    packetId: context.original.id,
    contentHash: review.contentHash,
    reviewHash: review.reviewHash,
    externalRef: "synthetic:three-date-reconciliation",
    reason:
      "Synthetic separate finance reconciliation, not actual provider verification",
    confirmation: "all-dates-reconciled" as const,
    journals: review.dates.map((d) => ({
      journalId: d.journal!.id,
      postingDate: d.postingDate,
      externalId: d.journal!.posted!.externalId,
      syncToken: "0",
      debit: 6000,
      credit: 6000,
      evidenceRef: `synthetic:independent-ledger:${d.postingDate}`,
    })),
  };
  return { ...context, costs, review, input };
}

test("original reconciliation accounts for every source date without accepting partial posting", (t) => {
  const { f, original, reviewer, j, make, approve } = journalFixture(
    t,
    "CA",
    false,
    dates,
  );
  const costs = f.app.integration.costs;
  const missing = costs.journalReconciliation(reviewer, original.id);
  assert.equal(missing.canConfirm, false);
  assert.deepEqual(
    missing.dates.map((d) => [d.postingDate, d.debit, d.credit, d.journal]),
    dates.map((date) => [date, 6000, 6000, null]),
  );
  const ids: string[] = [];
  for (const [i, date] of dates.entries()) {
    const journal = approve({ ...make(), postingDate: date }, `date-${i}`);
    ids.push(journal.id);
    const lease = j.claim(f.actor, journal.id, "write")!;
    j.beforeWrite(lease);
    j.posted(lease, postedResult(lease, String(500 + i)));
    const review = costs.journalReconciliation(reviewer, original.id);
    assert.equal(review.canConfirm, i === 2);
    assert.equal(costs.detail(reviewer, original.id).state, "reviewed");
  }
  const review = costs.journalReconciliation(reviewer, original.id);
  assert.equal(review.debit, 18000);
  assert.equal(review.credit, 18000);
  assert.equal(review.receiverRef, "quickbooks-sandbox:12345");
  assert.deepEqual(
    review.dates.map((d) => [d.journal!.id, d.journal!.posted!.externalId]),
    ids.map((id, i) => [id, String(500 + i)]),
  );
  assert.equal(
    costs.journalReconciliation(f.actor, original.id).canConfirm,
    false,
  );
  assert.match(review.reviewHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(costs.journalReconciliation(reviewer, original.id), review);
});

test("legacy acceptance cannot turn one posted date into acceptance of a three-date packet", (t) => {
  const { f, original, reviewer, j, approve, make } = journalFixture(
    t,
    "CA",
    false,
    dates,
  );
  const journal = approve(make());
  const lease = j.claim(f.actor, journal.id, "write")!;
  j.beforeWrite(lease);
  j.posted(lease, postedResult(lease, "500"));
  assert.throws(
    () =>
      f.app.integration.costs.accept(reviewer, "partial-legacy", {
        packetId: original.id,
        contentHash: original.contentHash!,
        receiverRef: "quickbooks-sandbox:12345",
        receiverRegion: "CA",
        externalRef: "500",
        debit: 18000,
        credit: 18000,
        reason: "Synthetic incomplete receiver acceptance must refuse",
      }),
    { code: "COST_NATIVE_OUTCOME" },
  );
  assert.equal(
    f.app.integration.costs.detail(reviewer, original.id).receipt,
    null,
  );
});

for (const region of ["CA", "US"] as const)
  test(`${region} finance accepts all exact source dates and retains one immutable reconciliation receipt`, (t) => {
    const { f, costs, reviewer, original, review, input, j } = complete(
      t,
      region,
    );
    const journals = review.dates.map((d) => j.detail(reviewer, d.journal!.id));
    const accepted = costs.reconcileJournals(reviewer, "reconcile-all", input);
    assert.equal(accepted.state, "accepted");
    assert.equal(accepted.receipt!.receiverRegion, region);
    assert.equal(accepted.receipt!.debit, 18000);
    assert.equal(accepted.receipt!.credit, 18000);
    assert.equal(accepted.receipt!.recordedBy, reviewer.id);
    assert.equal(
      accepted.receipt!.nativeReconciliation!.reviewHash,
      review.reviewHash,
    );
    assert.deepEqual(
      accepted.receipt!.nativeReconciliation!.journals,
      input.journals,
    );
    assert.deepEqual(
      costs.reconcileJournals(reviewer, "reconcile-all", input),
      accepted,
    );
    assert.deepEqual(
      costs.reconcileJournals(reviewer, "same-evidence", input),
      accepted,
    );
    assert.equal(
      costs.journalReconciliation(reviewer, original.id).canConfirm,
      false,
    );
    assert.deepEqual(
      review.dates.map((d) => j.detail(reviewer, d.journal!.id)),
      journals,
    );
    assert.equal(costs.source(f.actor).openingValue, 18000);
    assert.throws(
      () =>
        costs.reconcileJournals(reviewer, "changed-evidence", {
          ...input,
          reason: "Other evidence",
        }),
      { code: "COST_ACCEPTANCE_CONFLICT" },
    );
  });

test("restore hold leaves reconciliation reads available but blocks confirmation", (t) => {
  const { f, costs, reviewer, original, input, review } = complete(t);
  f.app.platform.isolateRestore("a".repeat(64), "2026-10-03T11:00:00Z");
  const held = costs.journalReconciliation(reviewer, original.id);
  assert.equal(held.canConfirm, false);
  assert.ok(held.issues.some((issue) => issue.code === "RECOVERY_HOLD"));
  assert.equal(held.reviewHash, review.reviewHash);
  assert.deepEqual(held.dates, review.dates);
  assert.throws(() => costs.reconcileJournals(reviewer, "held", input), {
    code: "RECOVERY_HOLD",
  });
  assert.equal(costs.detail(reviewer, original.id).receipt, null);
});

test("accepted reconciliation survives restart while a restore hold still refuses its cached command", (t) => {
  const { f, costs, reviewer, input } = complete(t);
  const accepted = costs.reconcileJournals(reviewer, "reconcile", input);
  f.app.close();
  f.app = new Application(f.path, "CA", { eventReports: false });
  const restarted = f.app.integration.costs;
  assert.deepEqual(
    restarted.reconcileJournals(reviewer, "reconcile", input),
    accepted,
  );
  f.app.platform.isolateRestore("a".repeat(64), "2026-10-03T11:00:00Z");
  assert.equal(
    restarted.journalReconciliation(reviewer, input.packetId).accepted,
    true,
  );
  assert.throws(
    () => restarted.reconcileJournals(reviewer, "reconcile", input),
    {
      code: "RECOVERY_HOLD",
    },
  );
  assert.deepEqual(
    restarted.detail(reviewer, input.packetId).receipt,
    accepted.receipt,
  );
});

test("exact controls refuse missing, duplicated, mismatched and malformed independent date evidence", (t) => {
  const { costs, reviewer, input, j, review } = complete(t);
  const journals = review.dates.map((d) => j.detail(reviewer, d.journal!.id));
  const refused = (candidate: JournalReconciliationInput, code: string) => {
    assert.throws(
      () => costs.reconcileJournals(reviewer, "refused", candidate),
      { code },
    );
    assert.equal(costs.detail(reviewer, input.packetId).receipt, null);
    assert.deepEqual(
      review.dates.map((d) => j.detail(reviewer, d.journal!.id)),
      journals,
    );
  };
  refused(
    { ...input, journals: input.journals.slice(1) },
    "COST_RECONCILIATION_CONTROL",
  );
  refused(
    {
      ...input,
      journals: [input.journals[0]!, input.journals[0]!, input.journals[2]!],
    },
    "COST_RECONCILIATION_CONTROL",
  );
  for (const [key, value] of Object.entries({
    journalId: "foreign-native",
    postingDate: "2026-10-04",
    externalId: "900",
    syncToken: "1",
    debit: 5999,
    credit: 6001,
  }))
    refused(
      {
        ...input,
        journals: [
          { ...input.journals[0]!, [key]: value },
          ...input.journals.slice(1),
        ],
      },
      "COST_RECONCILIATION_CONTROL",
    );
  refused(
    { ...input, reviewHash: "a".repeat(64) },
    "COST_RECONCILIATION_STALE",
  );
  refused(
    { ...input, contentHash: "a".repeat(64) },
    "COST_RECONCILIATION_STALE",
  );
  refused(
    { ...input, externalRef: review.dates[0]!.journal!.posted!.externalId },
    "COST_REFERENCE_CONFLICT",
  );
  assert.throws(() =>
    costs.reconcileJournals(reviewer, "native-reference", {
      ...input,
      externalRef: review.dates[0]!.journal!.requestRef,
    }),
  );
  refused(
    {
      ...input,
      journals: [
        { ...input.journals[0]!, evidenceRef: "" },
        ...input.journals.slice(1),
      ],
    },
    "VALIDATION",
  );
  refused(
    {
      ...input,
      journals: [
        { ...input.journals[0]!, debit: 6000.1 },
        ...input.journals.slice(1),
      ],
    },
    "VALIDATION",
  );
  refused(
    { ...input, skipDate: true } as JournalReconciliationInput,
    "COST_RECONCILIATION_INPUT",
  );
  refused(
    {
      ...input,
      journals: [
        { ...input.journals[0]!, skipDate: true },
        ...input.journals.slice(1),
      ],
    } as JournalReconciliationInput,
    "COST_RECONCILIATION_INPUT",
  );
  assert.equal(
    costs.reconcileJournals(reviewer, "refused", input).state,
    "accepted",
  );
});

test("the transport outcome recorder cannot supply their own independent reconciliation", (t) => {
  const { f, costs, reviewer, input } = complete(t);
  assert.throws(() => costs.reconcileJournals(f.actor, "self-confirm", input), {
    code: "COST_NATIVE_OUTCOME",
  });
  assert.equal(costs.detail(reviewer, input.packetId).receipt, null);
});

test("an unknown date cannot be guessed and its final observation invalidates the old review", (t) => {
  const { f, original, reviewer, j, make, approve } = journalFixture(
    t,
    "CA",
    false,
    dates,
  );
  let unknownId = "";
  for (const [i, postingDate] of dates.entries()) {
    const journal = approve({ ...make(), postingDate }, `unknown-${i}`);
    const lease = j.claim(f.actor, journal.id, "write")!;
    j.beforeWrite(lease);
    if (i === 2) {
      unknownId = journal.id;
      j.unresolved(lease, "transport-uncertain");
    } else j.posted(lease, postedResult(lease, String(500 + i)));
  }
  const costs = f.app.integration.costs;
  const before = costs.journalReconciliation(reviewer, original.id);
  assert.equal(before.canConfirm, false);
  assert.ok(before.issues.some((issue) => issue.code === "DATE_INCOMPLETE"));
  const input: JournalReconciliationInput = {
    packetId: original.id,
    contentHash: before.contentHash,
    reviewHash: before.reviewHash,
    externalRef: "synthetic:unknown-date",
    reason: "Synthetic independent ledger review",
    confirmation: "all-dates-reconciled",
    journals: before.dates.map((date, i) => ({
      journalId: date.journal!.id,
      postingDate: date.postingDate,
      externalId: String(500 + i),
      syncToken: "0",
      debit: 6000,
      credit: 6000,
      evidenceRef: `synthetic:date:${i}`,
    })),
  };
  const nativeBefore = j.detail(reviewer, unknownId);
  assert.throws(() => costs.reconcileJournals(reviewer, "unknown", input), {
    code: "COST_NATIVE_OUTCOME",
  });
  assert.deepEqual(j.detail(reviewer, unknownId), nativeBefore);
  assert.equal(costs.detail(reviewer, original.id).receipt, null);
  const lookup = j.claim(f.actor, unknownId, "lookup")!;
  j.posted(lookup, postedResult(lookup, "502"));
  assert.throws(() => costs.reconcileJournals(reviewer, "unknown", input), {
    code: "COST_RECONCILIATION_STALE",
  });
  const fresh = costs.journalReconciliation(reviewer, original.id);
  assert.equal(fresh.canConfirm, true);
  assert.equal(
    costs.reconcileJournals(reviewer, "unknown", {
      ...input,
      reviewHash: fresh.reviewHash,
    }).state,
    "accepted",
  );
});

test("posted dates from different company bindings cannot form one accepted packet", (t) => {
  const { f, original, reviewer, j, make, approve } = journalFixture(
    t,
    "CA",
    false,
    dates,
  );
  for (const [i, postingDate] of dates.entries()) {
    const journal = approve(
      {
        ...make(),
        postingDate,
        bindingId:
          i === 2 ? "synthetic-other-binding" : "synthetic-org-binding",
      },
      `company-${i}`,
    );
    const lease = j.claim(f.actor, journal.id, "write")!;
    j.beforeWrite(lease);
    j.posted(lease, postedResult(lease, String(500 + i)));
  }
  const costs = f.app.integration.costs;
  const review = costs.journalReconciliation(reviewer, original.id);
  assert.equal(review.canConfirm, false);
  assert.equal(review.receiverRef, null);
  assert.ok(review.issues.some((issue) => issue.code === "COMPANY_MISMATCH"));
  assert.throws(
    () =>
      costs.reconcileJournals(reviewer, "mixed", {
        packetId: original.id,
        contentHash: review.contentHash,
        reviewHash: review.reviewHash,
        externalRef: "synthetic:mixed-company",
        reason: "Synthetic independent review",
        confirmation: "all-dates-reconciled",
        journals: review.dates.map((date) => ({
          journalId: date.journal!.id,
          postingDate: date.postingDate,
          externalId: date.journal!.posted!.externalId,
          syncToken: "0",
          debit: 6000,
          credit: 6000,
          evidenceRef: "synthetic:ledger",
        })),
      }),
    { code: "COST_NATIVE_OUTCOME" },
  );
  assert.equal(costs.detail(reviewer, original.id).receipt, null);
});

test("a complete single-date legacy receipt remains recoverable with fresh native integrity", (t) => {
  const { f, original, reviewer, j, approve } = journalFixture(t);
  const journal = approve();
  const lease = j.claim(f.actor, journal.id, "write")!;
  j.beforeWrite(lease);
  j.posted(lease, postedResult(lease, "500"));
  const costs = f.app.integration.costs;
  const input = {
    packetId: original.id,
    contentHash: original.contentHash!,
    receiverRef: "quickbooks-sandbox:12345",
    receiverRegion: "CA" as const,
    externalRef: "500",
    debit: 18000,
    credit: 18000,
    reason: "Synthetic independent single-date reconciliation",
  };
  const before = j.detail(reviewer, journal.id);
  const accepted = costs.accept(reviewer, "legacy-complete", input);
  assert.equal(accepted.state, "accepted");
  assert.deepEqual(costs.accept(reviewer, "legacy-complete", input), accepted);
  assert.deepEqual(j.detail(reviewer, journal.id), before);
  mutate(
    f.path,
    "DELETE FROM integration_stock_journal_references WHERE journal_id=?",
    journal.id,
  );
  assert.throws(() => costs.accept(reviewer, "legacy-complete", input), {
    code: "JOURNAL_INTEGRITY",
  });
});

test("complete-history integrity is checked beyond one hundred observations even before cached recovery", (t) => {
  const { f, costs, reviewer, input, review } = complete(t, "CA", 105);
  assert.equal(review.dates[0]!.journal!.posted!.revision, 106);
  costs.reconcileJournals(reviewer, "cached", input);
  mutate(
    f.path,
    "UPDATE integration_stock_journal_observations SET body='{}' WHERE journal_id=? AND revision=1",
    review.dates[0]!.journal!.id,
  );
  assert.throws(() => costs.journalReconciliation(reviewer, input.packetId), {
    code: "JOURNAL_INTEGRITY",
  });
  assert.throws(() => costs.reconcileJournals(reviewer, "cached", input), {
    code: "JOURNAL_INTEGRITY",
  });
});

test("a late command audit fault rolls back acceptance, reference and retry receipt together", (t) => {
  const { f, costs, reviewer, input, j, review } = complete(t);
  const before = costs.detail(reviewer, input.packetId),
    audits = f.app.platform.audits(f.actor),
    journals = review.dates.map((d) => j.detail(reviewer, d.journal!.id));
  mutate(
    f.path,
    "CREATE TRIGGER fail_reconciliation_audit BEFORE INSERT ON platform_audit WHEN NEW.action='accounting.cost.reconcile-journals' BEGIN SELECT RAISE(ABORT,'synthetic late fault'); END",
  );
  assert.throws(() => costs.reconcileJournals(reviewer, "retry", input));
  assert.deepEqual(costs.detail(reviewer, input.packetId), before);
  assert.deepEqual(f.app.platform.audits(f.actor), audits);
  assert.deepEqual(
    review.dates.map((d) => j.detail(reviewer, d.journal!.id)),
    journals,
  );
  mutate(f.path, "DROP TRIGGER fail_reconciliation_audit");
  assert.equal(
    costs.reconcileJournals(reviewer, "retry", input).state,
    "accepted",
  );
});

test("independent finance processes released together preserve exactly one accepted batch", async (t) => {
  const { f, costs, reviewer, input, review, j } = complete(t);
  const journals = review.dates.map((date) =>
    j.detail(reviewer, date.journal!.id),
  );
  const children = [0, 1].map(() =>
    fork(
      new URL("./stock-journal-reconciliation-child.ts", import.meta.url),
      [],
      {
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "ignore", "pipe", "ipc"],
        env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR },
      },
    ),
  );
  t.after(() =>
    children.forEach((child) => {
      if (child.exitCode === null) child.kill();
    }),
  );
  type Outcome = {
    ok: boolean;
    code?: string;
    result?: ReturnType<typeof costs.reconcileJournals>;
  };
  const outcomes = await new Promise<Outcome[]>((resolve, reject) => {
    const ready = new Set<number>(),
      closed = new Set<number>(),
      results: Outcome[] = [],
      errors = ["", ""];
    const timer = setTimeout(
      () => reject(Error("Synthetic reconciliation process barrier timed out")),
      20000,
    );
    t.after(() => clearTimeout(timer));
    children.forEach((child, i) => {
      child.stderr?.on("data", (bytes) => {
        errors[i] += String(bytes);
      });
      child.on("error", reject);
      child.on("message", (message: Outcome & { ready?: boolean }) => {
        if (message.ready) {
          ready.add(i);
          if (ready.size === children.length)
            children.forEach((c) => c.send({ action: "go" }));
        } else results[i] = message;
      });
      child.on("close", (code) => {
        if (code !== 0 || !results[i]) {
          reject(Error(errors[i] || "Missing synthetic process result"));
          return;
        }
        closed.add(i);
        if (closed.size === children.length) {
          clearTimeout(timer);
          resolve(results);
        }
      });
      child.send({
        action: "init",
        job: {
          path: f.path,
          actor: reviewer,
          key: `process-${i}`,
          input: { ...input, externalRef: `synthetic:competing:${i}` },
        },
      });
    });
  });
  assert.equal(
    outcomes.filter((result) => result.ok).length,
    1,
    JSON.stringify(outcomes),
  );
  assert.equal(
    outcomes.find((result) => !result.ok)!.code,
    "COST_ACCEPTANCE_CONFLICT",
  );
  const winner = outcomes.find((result) => result.ok)!.result!;
  assert.deepEqual(
    costs.detail(reviewer, input.packetId).receipt,
    winner.receipt,
  );
  assert.equal(costs.source(f.actor).openingValue, 18000);
  assert.deepEqual(
    review.dates.map((date) => j.detail(reviewer, date.journal!.id)),
    journals,
  );
  assert.equal(
    f.app.platform
      .audits(f.actor)
      .filter((audit) => audit.action === "accounting.cost.journals-reconciled")
      .length,
    1,
  );
});

for (const change of [
  "role",
  "disabled",
  "password",
  "account",
  "organization",
] as const)
  test(`fresh ${change} authority refuses reconciliation reads and cached command recovery`, (t) => {
    const { f, costs, reviewer, input } = complete(t);
    costs.reconcileJournals(reviewer, "cached", input);
    if (change === "role")
      mutate(
        f.path,
        "UPDATE iam_users SET role='commercial' WHERE id=?",
        reviewer.id,
      );
    else if (change === "disabled")
      mutate(f.path, "UPDATE iam_users SET active=0 WHERE id=?", reviewer.id);
    else if (change === "password")
      mutate(
        f.path,
        "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
        reviewer.id,
      );
    else if (change === "account")
      mutate(
        f.path,
        "UPDATE iam_users SET account_id=? WHERE id=?",
        f.buyer,
        reviewer.id,
      );
    const caller =
      change === "organization" ? { ...reviewer, orgId: "foreign" } : reviewer;
    const code =
      change === "password" ? "PASSWORD_CHANGE_REQUIRED" : "FORBIDDEN";
    assert.throws(() => costs.journalReconciliation(caller, input.packetId), {
      code,
    });
    assert.throws(() => costs.reconcileJournals(caller, "cached", input), {
      code,
    });
    assert.equal(costs.detail(f.actor, input.packetId).state, "accepted");
  });

for (const region of ["CA", "US"] as const)
  test(`${region} authenticated no-store API reviews and confirms the exact complete dossier`, async (t) => {
    const { f, costs, reviewer, original, input, review } = complete(t, region);
    const http = await createHttp(f.app, { origin: "http://localhost" });
    t.after(() => void http.close());
    const url = `/api/accounting/costs/${original.id}/journal-reconciliation`;
    assert.equal((await http.inject({ url })).statusCode, 401);
    const login = await http.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin: "http://localhost" },
      payload: {
        email: "finance@example.test",
        password: "test-only-long-password",
      },
    });
    assert.equal(login.statusCode, 200);
    const headers = {
      origin: "http://localhost",
      cookie: login.headers["set-cookie"]!.toString().split(";")[0]!,
      "x-csrf-token": login.json().csrf,
      "idempotency-key": "api-reconcile",
    };
    const read = await http.inject({ url, headers });
    assert.equal(read.statusCode, 200);
    assert.equal(read.headers["cache-control"], "no-store");
    assert.deepEqual(read.json(), review);
    assert.equal(
      /leaseId|lease_id|source.bytes|accessToken|refreshToken/.test(read.body),
      false,
    );
    assert.equal(
      (await http.inject({ url: url + "?skipDate=1", headers })).statusCode,
      400,
    );
    assert.equal(
      (
        await http.inject({
          url: "/api/accounting/costs/missing/journal-reconciliation",
          headers,
        })
      ).statusCode,
      404,
    );
    const command = {
      method: "POST" as const,
      url: "/api/commands/accounting.cost.reconcile-journals",
      headers,
      payload: input,
    };
    assert.equal(
      (
        await http.inject({
          ...command,
          headers: { ...headers, "x-csrf-token": "bad" },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (await http.inject({ ...command, payload: { ...input, skipDate: true } }))
        .statusCode,
      400,
    );
    assert.equal(
      (
        await http.inject({
          ...command,
          payload: {
            ...input,
            journals: [
              { ...input.journals[0]!, debit: "6000" },
              ...input.journals.slice(1),
            ],
          },
        })
      ).statusCode,
      400,
    );
    assert.equal(costs.detail(reviewer, original.id).receipt, null);
    const accepted = await http.inject(command);
    assert.equal(accepted.statusCode, 200, accepted.body);
    assert.equal(accepted.json().state, "accepted");
    assert.deepEqual((await http.inject(command)).json(), accepted.json());
  });
