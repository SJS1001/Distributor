// Synthetic local authority reviews. No provider request or real finance qualification.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import { canonical } from "../src/server/core.ts";
import { journalFixture, postedResult } from "./stock-journal-fixture.ts";
import { policy } from "./cost-correction-fixture.ts";
import type { JournalPermissionInput } from "../src/server/stock-journal-permissions.ts";

function sql(path: string, statement: string, ...values: (number | string)[]) {
  const db = new DatabaseSync(path);
  try {
    db.prepare(statement).run(...values);
  } finally {
    db.close();
  }
}
function business(path: string) {
  const db = new DatabaseSync(path);
  try {
    return canonical(
      [
        "inventory_movements",
        "integration_stock_journals",
        "integration_stock_journal_references",
      ].map((name) => [
        name,
        db.prepare(`SELECT * FROM ${name}`).all().map(canonical).sort(),
      ]),
    );
  } finally {
    db.close();
  }
}
function reaccept(
  f: ReturnType<typeof journalFixture>["f"],
  key = "reaccept",
  realm = "12345",
) {
  const r = f.app.identity.organizationResidency,
    current = r.current(f.actor);
  r.choose(f.actor, key, {
    region: f.app.identity.region,
    revision: current.choice.revision,
    mode: "provider-exception",
    realm,
    acknowledgment: "Synthetic explicitly renewed permission",
    acceptance: {
      disclosureId: current.terms!.id,
      disclosureHash: current.terms!.hash,
      representative: "Synthetic finance",
      evidenceRef: "synthetic:new-choice",
    },
  });
}
function withdraw(f: ReturnType<typeof journalFixture>["f"]) {
  const r = f.app.identity.organizationResidency;
  r.choose(f.actor, `withdraw-${r.current(f.actor).choice.revision}`, {
    region: f.app.identity.region,
    revision: r.current(f.actor).choice.revision,
    mode: "strict",
    realm: null,
    acknowledgment: "Synthetic withdrawal",
  });
}
function input(
  j: ReturnType<typeof journalFixture>["j"],
  f: ReturnType<typeof journalFixture>["f"],
  journalId: string,
): JournalPermissionInput {
  const p = j.permissionReview(f.actor, journalId);
  return {
    journalId,
    reviewHash: p.journal.reviewHash,
    previousPermissionHash: p.previousPermissionHash,
    authority: p.authority,
    mode: p.mode,
    reason: "Synthetic exact replacement review",
  };
}
function decision(
  journalId: string,
  review: ReturnType<
    ReturnType<typeof journalFixture>["j"]["preparePermission"]
  >,
  choice: "approve" | "reject" = "approve",
) {
  return {
    journalId,
    permissionReviewId: review.id,
    permissionReviewHash: review.reviewHash,
    decision: choice,
    reason: "Synthetic independent permission decision",
  };
}
for (const region of ["CA", "US"] as const) {
  test(`${region} independently replaced permission retains exact journal, permanent reference and posting across restart`, (t) => {
    const { f, j, approve, reviewer } = journalFixture(t, region),
      approved = approve();
    withdraw(f);
    assert.throws(() => j.permissionReview(f.actor, approved.id), {
      code: "RESIDENCY_BLOCKED",
    });
    reaccept(f);
    assert.throws(() => j.claim(f.actor, approved.id, "write"), {
      code: "RESIDENCY_CHANGED",
    });
    const before = business(f.path),
      selected = input(j, f, approved.id);
    const review = j.preparePermission(f.actor, "permission", selected);
    assert.equal(business(f.path), before);
    assert.deepEqual(
      j.preparePermission(f.actor, "permission", selected),
      review,
    );
    assert.throws(() => j.claim(f.actor, approved.id, "write"), {
      code: "RESIDENCY_CHANGED",
    });
    const choice = decision(approved.id, review);
    assert.throws(() => j.decidePermission(f.actor, "self", choice), {
      code: "JOURNAL_SEPARATE_REVIEW",
    });
    const receipt = j.decidePermission(reviewer, "decision", choice);
    assert.equal(business(f.path), before);
    assert.deepEqual(j.decidePermission(reviewer, "decision", choice), receipt);
    f.app.close();
    f.app = new Application(f.path, region, { eventReports: false });
    const current = f.app.integration.costs.journals;
    assert.deepEqual(
      current.preparePermission(f.actor, "permission", selected),
      review,
    );
    const lease = current.claim(f.actor, approved.id, "write")!;
    assert.deepEqual(lease.authority, selected.authority);
    assert.equal(lease.effect.residency_version, selected.authority.revision);
    assert.equal(lease.effect.reference, approved.requestRef);
    assert.deepEqual(JSON.parse(lease.effect.payload), approved.plan.intent);
    current.guard(lease);
    current.beforeWrite(lease);
    assert.equal(current.posted(lease, postedResult(lease)).state, "posted");
    assert.deepEqual(current.detail(f.actor, approved.id).plan, approved.plan);
    withdraw(f);
    assert.deepEqual(
      current.decidePermission(reviewer, "decision", choice),
      receipt,
    );
    assert.deepEqual(
      current.permissionHistory(f.actor, approved.id).authority,
      selected.authority,
    );
  });
}
test("unknown permission replacement grants lookup only even after period/policy drift", (t) => {
  const { f, j, c, approve, reviewer } = journalFixture(t),
    approved = approve(),
    old = j.claim(f.actor, approved.id, "write")!;
  j.beforeWrite(old);
  withdraw(f);
  j.unresolved(old, "transport-uncertain");
  reaccept(f);
  c.configure(f.actor, "closed", { ...policy(1), closedThrough: "2026-12-31" });
  const selected = input(j, f, approved.id);
  assert.equal(selected.mode, "lookup");
  assert.throws(
    () =>
      j.preparePermission(f.actor, "write-forge", {
        ...selected,
        mode: "write",
      }),
    { code: "JOURNAL_PERMISSION_STATE" },
  );
  const review = j.preparePermission(f.actor, "lookup", selected);
  j.decidePermission(reviewer, "lookup-approve", decision(approved.id, review));
  assert.throws(() => j.claim(f.actor, approved.id, "write"), {
    code: "JOURNAL_STATE",
  });
  const lease = j.claim(f.actor, approved.id, "lookup")!;
  assert.equal(lease.effect.reference, old.effect.reference);
  j.guard(lease);
  assert.throws(() => j.beforeWrite(lease), { code: "JOURNAL_WRITE_ONCE" });
  assert.equal(j.posted(lease, postedResult(lease)).state, "posted");
});
for (const clock of ["expired", "rollback"] as const)
  test(`${clock} retained running lease may replace permission for lookup without clearing or reissuing a write`, (t) => {
    const { f, j, approve, reviewer } = journalFixture(t),
      approved = approve();
    const old = j.claim(f.actor, approved.id, "write")!;
    reaccept(f);
    assert.throws(() => j.permissionReview(f.actor, approved.id), {
      code: "JOURNAL_PERMISSION_STATE",
    });
    sql(
      f.path,
      "UPDATE integration_stock_journals SET lease_started=? WHERE id=?",
      Date.now() + (clock === "expired" ? -180000 : 180000),
      approved.id,
    );
    const before = business(f.path),
      selected = input(j, f, approved.id);
    assert.equal(selected.mode, "lookup");
    assert.equal(business(f.path), before);
    const review = j.preparePermission(f.actor, "permission", selected);
    j.decidePermission(reviewer, "approve", decision(approved.id, review));
    assert.equal(business(f.path), before);
    assert.throws(() => j.guard(old), { code: "JOURNAL_LEASE" });
    const lease = j.claim(f.actor, approved.id, "lookup")!;
    assert.equal(lease.mode, "lookup");
    j.guard(lease);
    j.unresolved(lease, "transport-uncertain");
    assert.throws(() => j.claim(f.actor, approved.id, "write"), {
      code: "JOURNAL_STATE",
    });
  });
test("competing reviews require the exact preceding approved permission; rejection never grants authority", (t) => {
  const { f, j, approve, reviewer } = journalFixture(t),
    approved = approve();
  reaccept(f);
  const selected = input(j, f, approved.id),
    a = j.preparePermission(f.actor, "a", selected),
    b = j.preparePermission(f.actor, "b", selected);
  const other = new Application(f.path, "CA", { eventReports: false });
  t.after(() => other.close());
  other.integration.costs.journals.decidePermission(
    reviewer,
    "a-approve",
    decision(approved.id, a),
  );
  assert.throws(
    () => j.decidePermission(reviewer, "b-approve", decision(approved.id, b)),
    { code: "JOURNAL_PERMISSION_CHANGED" },
  );
  j.decidePermission(reviewer, "b-reject", decision(approved.id, b, "reject"));
  assert.deepEqual(
    j.permissionHistory(f.actor, approved.id).authority,
    selected.authority,
  );
  reaccept(f, "another-choice");
  const newer = input(j, f, approved.id),
    rejected = j.preparePermission(f.actor, "rejected", newer);
  j.decidePermission(
    reviewer,
    "reject",
    decision(approved.id, rejected, "reject"),
  );
  assert.throws(() => j.claim(f.actor, approved.id, "write"), {
    code: "RESIDENCY_CHANGED",
  });
  assert.throws(
    () =>
      j.decidePermission(
        reviewer,
        "rejected-approve",
        decision(approved.id, rejected),
      ),
    { code: "JOURNAL_PERMISSION_REVIEW" },
  );
});
test("immutable company/scope, exact input/hash, policy and current permission changes refuse replacement", (t) => {
  const { f, j, c, approve, reviewer } = journalFixture(t),
    approved = approve();
  assert.throws(() => j.permissionReview(f.actor, approved.id), {
    code: "JOURNAL_PERMISSION_UNCHANGED",
  });
  reaccept(f);
  const selected = input(j, f, approved.id);
  for (const authority of [
    { ...selected.authority, orgId: "foreign" },
    { ...selected.authority, realm: "999" },
    { ...selected.authority, region: "US" },
    { ...selected.authority, provider: "stripe" },
  ])
    assert.throws(
      () =>
        j.preparePermission(f.actor, "forged", {
          ...selected,
          authority,
        } as any),
      { code: "JOURNAL_PERMISSION_SCOPE" },
    );
  for (const extra of [
    { ...selected, bindingId: "other" },
    { ...selected, reviewHash: "0".repeat(64) },
    { ...selected, previousPermissionHash: "0".repeat(64) },
    { ...selected, reason: "" },
  ])
    assert.throws(() => j.preparePermission(f.actor, "invalid", extra));
  const review = j.preparePermission(f.actor, "valid", selected);
  assert.throws(
    () =>
      j.preparePermission(f.actor, "valid", { ...selected, reason: "changed" }),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  reaccept(f, "company-changed", "999");
  assert.throws(() => j.permissionReview(f.actor, approved.id), {
    code: "JOURNAL_PERMISSION_SCOPE",
  });
  assert.throws(
    () =>
      j.decidePermission(
        reviewer,
        "invalid-permission",
        decision(approved.id, review),
      ),
    { code: "RESIDENCY_BLOCKED" },
  );
  reaccept(f, "back");
  assert.throws(
    () => j.decidePermission(reviewer, "stale", decision(approved.id, review)),
    { code: "RESIDENCY_CHANGED" },
  );
  c.configure(f.actor, "policy-drift", { ...policy(1), closedThrough: null });
  assert.throws(() => j.permissionReview(f.actor, approved.id), {
    code: "JOURNAL_POLICY",
  });
});
test("hold blocks new permission reviews and approvals while original cached receipts and history remain read-only", (t) => {
  const { f, j, approve, reviewer } = journalFixture(t),
    approved = approve();
  reaccept(f);
  const selected = input(j, f, approved.id),
    review = j.preparePermission(f.actor, "ready", selected);
  f.app.platform.isolateRestore("a".repeat(64), "2026-10-03T11:00:00Z");
  const before = business(f.path);
  assert.deepEqual(j.preparePermission(f.actor, "ready", selected), review);
  assert.equal(j.permissionHistory(f.actor, approved.id).reviews.length, 1);
  assert.throws(() => j.permissionReview(f.actor, approved.id), {
    code: "RECOVERY_HOLD",
  });
  assert.throws(() => j.preparePermission(f.actor, "new", selected), {
    code: "RECOVERY_HOLD",
  });
  assert.throws(
    () =>
      j.decidePermission(reviewer, "blocked", decision(approved.id, review)),
    { code: "RECOVERY_HOLD" },
  );
  assert.equal(business(f.path), before);
});
for (const changed of [
  "role",
  "disabled",
  "password",
  "buyer-account",
] as const)
  test(`retained permission reads and replay recheck persisted ${changed}`, (t) => {
    const { f, j, approve } = journalFixture(t),
      approved = approve();
    reaccept(f);
    const selected = input(j, f, approved.id);
    j.preparePermission(f.actor, "retained", selected);
    if (changed === "role")
      sql(f.path, "UPDATE iam_users SET role='sales' WHERE id=?", f.actor.id);
    if (changed === "disabled")
      sql(f.path, "UPDATE iam_users SET active=0 WHERE id=?", f.actor.id);
    if (changed === "buyer-account")
      sql(
        f.path,
        "UPDATE iam_users SET account_id=? WHERE id=?",
        f.buyer,
        f.actor.id,
      );
    if (changed === "password")
      sql(
        f.path,
        "INSERT INTO iam_user_security VALUES(?,2,1,'2026-10-03T12:00:00Z') ON CONFLICT(user_id) DO UPDATE SET password_change_required=1",
        f.actor.id,
      );
    for (const read of [
      () => j.permissionHistory({ ...f.actor, role: "admin" }, approved.id),
      () => j.permissionReview(f.actor, approved.id),
      () => j.preparePermission(f.actor, "retained", selected),
    ])
      assert.throws(read);
  });
test("complete permission chain survives more than one hundred observations with bounded public review descriptors", (t) => {
  const { f, j, approve, reviewer } = journalFixture(t),
    approved = approve();
  reaccept(f);
  const selected = input(j, f, approved.id);
  let first = "";
  for (let i = 0; i < 53; i++) {
    const r = j.preparePermission(f.actor, `r-${i}`, selected);
    if (!i) first = r.id;
    j.decidePermission(
      reviewer,
      `reject-${i}`,
      decision(approved.id, r, "reject"),
    );
  }
  const review = j.preparePermission(f.actor, "final", selected);
  j.decidePermission(reviewer, "final-approve", decision(approved.id, review));
  const history = j.permissionHistory(f.actor, approved.id);
  assert.equal(history.reviews.length, 20);
  assert.equal(history.olderReviews, true);
  assert.equal(
    j.permissionHistory(f.actor, approved.id, first).reviews[0]!.id,
    first,
  );
  assert.throws(() => j.permissionHistory(f.actor, approved.id, "foreign"), {
    code: "NOT_FOUND",
  });
  assert.ok(j.claim(f.actor, approved.id, "write"));
});
test("permission event and cached result integrity are checked; late audit failure rolls back the whole approval", (t) => {
  const { f, j, approve, reviewer } = journalFixture(t),
    approved = approve();
  reaccept(f);
  const selected = input(j, f, approved.id),
    review = j.preparePermission(f.actor, "ready", selected),
    choice = decision(approved.id, review);
  sql(
    f.path,
    "CREATE TRIGGER fail_permission_audit BEFORE INSERT ON platform_audit WHEN NEW.action='accounting.journal.permission.decide' BEGIN SELECT RAISE(ABORT,'synthetic late fault'); END",
  );
  assert.throws(() => j.decidePermission(reviewer, "decision", choice));
  assert.equal(
    j.permissionHistory(f.actor, approved.id).reviews[0]!.decision,
    null,
  );
  assert.throws(() => j.claim(f.actor, approved.id, "write"), {
    code: "RESIDENCY_CHANGED",
  });
  sql(f.path, "DROP TRIGGER fail_permission_audit");
  j.decidePermission(reviewer, "decision", choice);
  sql(
    f.path,
    "UPDATE platform_commands SET result='{}' WHERE name='accounting.journal.permission.prepare'",
  );
  assert.throws(() => j.preparePermission(f.actor, "ready", selected), {
    code: "JOURNAL_INTEGRITY",
  });
  sql(
    f.path,
    "UPDATE integration_stock_journal_observations SET body='{}' WHERE journal_id=? AND revision=1",
    approved.id,
  );
  assert.throws(() => j.permissionHistory(f.actor, approved.id), {
    code: "JOURNAL_INTEGRITY",
  });
  assert.throws(() => j.claim(f.actor, approved.id, "write"), {
    code: "JOURNAL_INTEGRITY",
  });
});
test("permission review requires authenticated strict HTTP fields, CSRF, origin, exact keys and separate finance", async (t) => {
  const { f, j, approve } = journalFixture(t),
    approved = approve();
  reaccept(f);
  const http = await createHttp(f.app, { origin: "http://localhost" });
  t.after(() => void http.close());
  const login = async (email: string, password: string) => {
    const res = await http.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin: "http://localhost" },
      payload: { email, password },
    });
    assert.equal(res.statusCode, 200, res.body);
    return {
      cookie: String(res.headers["set-cookie"]).split(";")[0]!,
      origin: "http://localhost",
      "x-csrf-token": res.json().csrf,
    };
  };
  const admin = await login("admin@example.test", "long-test-only-password"),
    finance = await login("finance@example.test", "test-only-long-password");
  const url = `/api/accounting/journals/${approved.id}/permission-review`;
  assert.equal((await http.inject({ url })).statusCode, 401);
  const read = await http.inject({ url, headers: admin });
  assert.equal(read.statusCode, 200, read.body);
  assert.equal(read.headers["cache-control"], "no-store");
  assert.equal(
    (await http.inject({ url: url + "?extra=x", headers: admin })).statusCode,
    400,
  );
  const post = (name: string, body: unknown, key: string, headers = admin) =>
    http.inject({
      method: "POST",
      url: `/api/commands/accounting.journal.permission.${name}`,
      headers: { ...headers, "idempotency-key": key },
      payload: body as any,
    });
  const selected = input(j, f, approved.id);
  assert.equal(
    (await post("prepare", { ...selected, token: "forged" }, "extra"))
      .statusCode,
    400,
  );
  assert.equal(
    (
      await post(
        "prepare",
        { ...selected, authority: { ...selected.authority, token: "forged" } },
        "extra-authority",
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await post("prepare", selected, "csrf", {
        ...admin,
        "x-csrf-token": "bad",
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await post("prepare", selected, "origin", {
        ...admin,
        origin: "http://elsewhere",
      })
    ).statusCode,
    403,
  );
  const ready = await post("prepare", selected, "prepare");
  assert.equal(ready.statusCode, 200, ready.body);
  const choice = decision(approved.id, ready.json());
  assert.equal((await post("decide", choice, "self")).statusCode, 403);
  assert.equal(
    (await post("decide", choice, "approve", finance)).statusCode,
    200,
  );
  const history = await http.inject({
    url: `/api/accounting/journals/${approved.id}/permissions`,
    headers: admin,
  });
  assert.equal(history.statusCode, 200, history.body);
  assert.equal(history.headers["cache-control"], "no-store");
  assert.equal(
    (
      await http.inject({
        url: `/api/accounting/journals/${approved.id}/permissions?extra=x`,
        headers: admin,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await http.inject({
        url: `/api/accounting/journals/${approved.id}/permissions?reviewId=foreign`,
        headers: admin,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await http.inject({
        url: `/api/accounting/journals/foreign/permissions`,
        headers: admin,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: `/api/accounting/journals/${approved.id}/claim`,
        headers: admin,
      })
    ).statusCode,
    404,
  );
});
test("replacement approval is freshly fenced before dispatch, and an active lease cannot gain later permission", (t) => {
  const { f, j, approve, reviewer } = journalFixture(t),
    approved = approve();
  reaccept(f);
  const selected = input(j, f, approved.id),
    review = j.preparePermission(f.actor, "ready", selected);
  j.decidePermission(reviewer, "approve", decision(approved.id, review));
  const lease = j.claim(f.actor, approved.id, "write")!;
  reaccept(f, "next-choice");
  assert.throws(() => j.guard(lease), { code: "RESIDENCY_CHANGED" });
  assert.throws(() => j.beforeWrite(lease), { code: "RESIDENCY_CHANGED" });
  assert.throws(() => j.permissionReview(f.actor, approved.id), {
    code: "JOURNAL_PERMISSION_STATE",
  });
  j.unresolved(lease, "transport-uncertain");
  const next = input(j, f, approved.id);
  assert.equal(next.mode, "lookup");
  const lookup = j.preparePermission(f.actor, "lookup", next);
  j.decidePermission(reviewer, "lookup-approve", decision(approved.id, lookup));
  assert.equal(j.claim(f.actor, approved.id, "lookup")!.mode, "lookup");
});
test("native invalid permission fields and null cached receipts fail closed", (t) => {
  const { f, j, approve } = journalFixture(t),
    approved = approve();
  reaccept(f);
  const selected = input(j, f, approved.id);
  for (const invalid of [
    null,
    {},
    { ...selected, authority: null },
    { ...selected, authority: { ...selected.authority, extra: "forged" } },
  ])
    assert.throws(
      () => j.preparePermission(f.actor, "invalid", invalid as any),
      { code: "JOURNAL_PERMISSION_INPUT" },
    );
  j.preparePermission(f.actor, "retained", selected);
  sql(
    f.path,
    "UPDATE platform_commands SET result='null' WHERE name='accounting.journal.permission.prepare'",
  );
  assert.throws(() => j.preparePermission(f.actor, "retained", selected), {
    code: "JOURNAL_INTEGRITY",
  });
});
test("withdrawn reviewer and changed posting policy cannot approve a retained permission proposal", (t) => {
  const { f, j, c, approve, reviewer } = journalFixture(t),
    approved = approve();
  reaccept(f);
  const review = j.preparePermission(
    f.actor,
    "retained",
    input(j, f, approved.id),
  );
  sql(f.path, "UPDATE iam_users SET role='sales' WHERE id=?", reviewer.id);
  assert.throws(
    () =>
      j.decidePermission(
        { ...reviewer, role: "finance" },
        "role",
        decision(approved.id, review),
      ),
    { code: "FORBIDDEN" },
  );
  sql(f.path, "UPDATE iam_users SET role='finance' WHERE id=?", reviewer.id);
  c.configure(f.actor, "policy-changed", {
    ...policy(1),
    closedThrough: "2026-12-31",
  });
  assert.throws(
    () => j.decidePermission(reviewer, "policy", decision(approved.id, review)),
    { code: "JOURNAL_POLICY" },
  );
  assert.equal(
    j.permissionHistory(f.actor, approved.id).reviews[0]!.decision,
    null,
  );
});
