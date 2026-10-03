// Synthetic local reviews only; no receiver transport or actual finance evidence.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { journalFixture, postedResult } from "./stock-journal-fixture.ts";
import { policy, outcomeInput } from "./cost-correction-fixture.ts";
import { canonical, digest } from "../src/server/core.ts";
import { createHttp } from "../src/server/http.ts";

function facts(path: string) {
  const db = new DatabaseSync(path);
  try {
    const names = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all();
    return digest(
      canonical(
        names.map(({ name }) => [
          name,
          db
            .prepare(`SELECT * FROM "${String(name).replaceAll('"', '""')}"`)
            .all()
            .map(canonical)
            .sort(),
        ]),
      ),
    );
  } finally {
    db.close();
  }
}
function mutate(path: string, sql: string, ...values: (string | number)[]) {
  const db = new DatabaseSync(path);
  try {
    db.prepare(sql).run(...values);
  } finally {
    db.close();
  }
}
for (const region of ["CA", "US"] as const) {
  test(`${region} journal source review returns exact approved date/accounts/authority without writes`, (t) => {
    const { f, j, make, file, original } = journalFixture(t, region),
      before = facts(f.path),
      input = make();
    const review = j.preparationReview(f.actor, original.id, {
      leg: "original",
    });
    assert.equal(review.sourceHash, file.hash);
    assert.deepEqual(review.lines, JSON.parse(file.bytes).report.journal);
    assert.deepEqual(review.sourceAccounts, ["1200", "2100"]);
    assert.deepEqual(review.authority, input.authority);
    assert.equal(review.currency, region === "CA" ? "CAD" : "USD");
    assert.equal(review.policyRevision, 1);
    assert.equal(review.approvedBy, f.actor.id);
    assert.equal(review.attemptId, null);
    assert.equal("bytes" in review, false);
    assert.equal(facts(f.path), before);
  });
  test(`${region} historical preparation receipt survives decisions and transport outcomes without authorizing a write`, (t) => {
    const { f, j, make, reviewer } = journalFixture(t, region),
      ready = j.prepare(f.actor, "preparation", make());
    const read = (state: string) => {
      const before = facts(f.path);
      assert.deepEqual(j.preparationReceipt(f.actor, "preparation"), {
        receipt: ready,
        currentState: state,
      });
      assert.equal(facts(f.path), before);
    };
    read("ready");
    j.decide(reviewer, "approve", {
      journalId: ready.id,
      reviewHash: ready.reviewHash,
      decision: "approve",
      reason: "Synthetic independent approval",
    });
    read("pending");
    const lease = j.claim(f.actor, ready.id, "write")!;
    read("running");
    j.beforeWrite(lease);
    read("running");
    j.posted(lease, postedResult(lease));
    read("posted");
    const r = f.app.identity.organizationResidency;
    r.choose(f.actor, "withdraw", {
      revision: r.current(f.actor).choice.revision,
      region,
      mode: "strict",
      realm: null,
      acknowledgment: "Synthetic withdrawal",
    });
    read("posted");
    assert.throws(() => j.prepare(f.actor, "preparation", make()));
  });
}
test("source date selection preserves all original dates and refuses closed, absent and fabricated dates", (t) => {
  const { f, j, c, original } = journalFixture(t, "CA", false, [
    "2026-10-01",
    "2026-10-01",
    "2026-10-03",
  ]);
  c.configure(f.actor, "close-period", {
    ...policy(1),
    closedThrough: "2026-10-01",
  });
  const before = facts(f.path),
    review = j.preparationReview(f.actor, original.id, { leg: "original" });
  assert.deepEqual(review.dates, ["2026-10-01", "2026-10-03"]);
  assert.equal(review.postingDate, "2026-10-03");
  assert.equal(review.lines.length, 2);
  assert.equal(
    review.lines.reduce((n, l) => n + l.debit, 0),
    6000,
  );
  for (const postingDate of ["2026-10-01", "2026-10-02", "9999-99-99", ""])
    assert.throws(() =>
      j.preparationReview(f.actor, original.id, {
        leg: "original",
        postingDate,
      }),
    );
  assert.equal(facts(f.path), before);
});
test("both correction legs review their immutable mapping, receiver and current unobserved attempt", (t) => {
  const { f, j, c, selected, file } = journalFixture(t, "US", true),
    before = facts(f.path),
    doc = JSON.parse(file.bytes);
  for (const leg of ["reversal", "replacement"] as const) {
    const review = j.preparationReview(f.actor, selected.id, { leg });
    assert.deepEqual(review.lines, doc[leg]);
    assert.equal(review.sourceHash, file.hash);
    assert.equal(review.attemptId, null);
  }
  assert.equal(facts(f.path), before);
  c.observe(f.actor, "unknown", outcomeInput(f, selected.id, "reversal"));
  const observed = facts(f.path);
  assert.throws(
    () => j.preparationReview(f.actor, selected.id, { leg: "reversal" }),
    { code: "JOURNAL_ATTEMPT" },
  );
  assert.equal(facts(f.path), observed);
});
test("source review refuses superseded originals, mismatched correction policy and invalid selections", (t) => {
  const { f, j, c, selected, original } = journalFixture(t, "CA", true);
  assert.throws(
    () => j.preparationReview(f.actor, original.id, { leg: "original" }),
    { code: "JOURNAL_SUPERSEDED" },
  );
  c.configure(f.actor, "policy-drift", { ...policy(1), closedThrough: null });
  const before = facts(f.path);
  assert.throws(
    () => j.preparationReview(f.actor, selected.id, { leg: "replacement" }),
    { code: "JOURNAL_POLICY" },
  );
  for (const selection of [
    null,
    {},
    { leg: "invented" },
    { leg: "original", extra: true },
  ])
    assert.throws(() =>
      j.preparationReview(f.actor, original.id, selection as any),
    );
  assert.throws(() =>
    j.preparationReview(f.actor, "foreign", { leg: "original" }),
  );
  assert.equal(facts(f.path), before);
});
test("historical receipt is scoped to the preparing principal, organization, command and unchanged receipt bytes", (t) => {
  const { f, j, make, reviewer } = journalFixture(t),
    ready = j.prepare(f.actor, "exact-key", make());
  for (const actor of [reviewer, { ...f.actor, orgId: "foreign" }])
    assert.throws(() => j.preparationReceipt(actor, "exact-key"));
  assert.throws(() => j.preparationReceipt(f.actor, "journal-policy"), {
    code: "NOT_FOUND",
  });
  const before = facts(f.path);
  assert.deepEqual(j.preparationReceipt(f.actor, "exact-key").receipt, ready);
  assert.equal(facts(f.path), before);
  mutate(
    f.path,
    "UPDATE platform_commands SET result=? WHERE name='accounting.journal.prepare' AND key='exact-key'",
    JSON.stringify({ ...ready, bindingId: "tampered" }),
  );
  assert.throws(() => j.preparationReceipt(f.actor, "exact-key"), {
    code: "JOURNAL_INTEGRITY",
  });
});
test("changed command input hash and native plan refuse recovery rather than discard the retained request", (t) => {
  const { f, j, make } = journalFixture(t),
    ready = j.prepare(f.actor, "exact-key", make());
  mutate(
    f.path,
    "UPDATE platform_commands SET hash=? WHERE name='accounting.journal.prepare'",
    "0".repeat(64),
  );
  assert.throws(() => j.preparationReceipt(f.actor, "exact-key"), {
    code: "JOURNAL_INTEGRITY",
  });
  mutate(
    f.path,
    "UPDATE platform_commands SET hash=? WHERE name='accounting.journal.prepare'",
    digest(canonical(make())),
  );
  mutate(
    f.path,
    "UPDATE integration_stock_journals SET review_hash=? WHERE id=?",
    "0".repeat(64),
    ready.id,
  );
  assert.throws(() => j.preparationReceipt(f.actor, "exact-key"), {
    code: "JOURNAL_INTEGRITY",
  });
});
test("recovery hold and closed period block source/new preparation while historical receipts remain read-only", (t) => {
  const { f, j, c, make, original } = journalFixture(t),
    ready = j.prepare(f.actor, "retained", make());
  c.configure(f.actor, "external-owner", {
    ...policy(1),
    closedThrough: "2026-10-31",
  });
  assert.throws(() =>
    j.preparationReview(f.actor, original.id, { leg: "original" }),
  );
  f.app.platform.isolateRestore("a".repeat(64), "2026-10-03T11:00:00Z");
  const before = facts(f.path);
  assert.deepEqual(j.preparationReceipt(f.actor, "retained"), {
    receipt: ready,
    currentState: "ready",
  });
  assert.throws(
    () => j.preparationReview(f.actor, original.id, { leg: "original" }),
    { code: "RECOVERY_HOLD" },
  );
  assert.throws(() => j.prepare(f.actor, "retained", make()), {
    code: "RECOVERY_HOLD",
  });
  assert.equal(facts(f.path), before);
});
for (const change of ["role", "disabled", "password", "buyer-account"] as const)
  test(`source and historical preparation reads recheck persisted ${change} authority`, (t) => {
    const { f, j, make, original } = journalFixture(t);
    j.prepare(f.actor, "retained", make());
    if (change === "role")
      mutate(
        f.path,
        "UPDATE iam_users SET role='sales' WHERE id=?",
        f.actor.id,
      );
    if (change === "disabled")
      mutate(f.path, "UPDATE iam_users SET active=0 WHERE id=?", f.actor.id);
    if (change === "password")
      mutate(
        f.path,
        "INSERT INTO iam_user_security VALUES(?,2,1,'2026-10-03T12:00:00Z') ON CONFLICT(user_id) DO UPDATE SET password_change_required=1",
        f.actor.id,
      );
    if (change === "buyer-account")
      mutate(
        f.path,
        "UPDATE iam_users SET account_id=? WHERE id=?",
        f.buyer,
        f.actor.id,
      );
    const before = facts(f.path);
    assert.throws(() =>
      j.preparationReview({ ...f.actor, role: "admin" }, original.id, {
        leg: "original",
      }),
    );
    assert.throws(() =>
      j.preparationReceipt({ ...f.actor, role: "admin" }, "retained"),
    );
    assert.equal(facts(f.path), before);
  });
test("authenticated source and original receipt HTTP reads enforce exact fields, scope and no-store without execution routes", async (t) => {
  const { f, j, make, original } = journalFixture(t),
    http = await createHttp(f.app, { origin: "http://localhost" });
  t.after(() => void http.close());
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
    cookie: String(login.headers["set-cookie"]).split(";")[0]!,
    origin: "http://localhost",
    "x-csrf-token": login.json().csrf,
  };
  const source = `/api/accounting/journal-sources/${original.id}`;
  assert.equal(
    (await http.inject({ url: source + "?leg=original" })).statusCode,
    401,
  );
  for (const query of [
    "",
    "?leg=original&extra=x",
    "?leg=invented",
    "?leg=original&postingDate=bad",
  ])
    assert.equal(
      (await http.inject({ url: source + query, headers })).statusCode,
      400,
    );
  const read = await http.inject({ url: source + "?leg=original", headers });
  assert.equal(read.statusCode, 200, read.body);
  assert.equal(read.headers["cache-control"], "no-store");
  const ready = j.prepare(f.actor, "retained", make()),
    receipt = "/api/accounting/journal-preparations/retained/receipt";
  const response = await http.inject({ url: receipt, headers });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), { receipt: ready, currentState: "ready" });
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(
    (await http.inject({ url: receipt + "?extra=x", headers })).statusCode,
    400,
  );
  assert.equal(
    (
      await http.inject({
        url: "/api/accounting/journal-preparations/missing/receipt",
        headers,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: "/api/commands/accounting.journal.prepare",
        headers: {
          ...headers,
          "x-csrf-token": "bad",
          "idempotency-key": "new",
        },
        payload: make(),
      })
    ).statusCode,
    403,
  );
  // The rejected CSRF command records the existing security-denial audit.
  const before = facts(f.path);
  for (const action of ["claim", "dispatch", "complete"])
    assert.equal(
      (
        await http.inject({
          method: "POST",
          url: `/api/commands/accounting.journal.${action}`,
          headers: { ...headers, "idempotency-key": "new" },
          payload: {},
        })
      ).statusCode,
      404,
    );
  assert.equal(facts(f.path), before);
});
