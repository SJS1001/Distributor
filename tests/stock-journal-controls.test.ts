// Synthetic local finance controls. No provider requests or real approvals.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createHttp } from "../src/server/http.ts";
import { journalFixture } from "./stock-journal-fixture.ts";
import { outcomeInput } from "./cost-correction-fixture.ts";
import { canonical, digest } from "../src/server/core.ts";

function rejectedQueue(t: TestContext) {
  const fixture = journalFixture(t),
    { f, j, make, reviewer } = fixture;
  const ids: string[] = [];
  for (let i = 0; i < 24; i++) {
    const ready = j.prepare(f.actor, `prepare-${i}`, make());
    ids.push(ready.id);
    j.decide(reviewer, `reject-${i}`, {
      journalId: ready.id,
      reviewHash: ready.reviewHash,
      decision: "reject",
      reason: "Synthetic repeated reviewed rejection",
    });
  }
  return { ...fixture, ids };
}
function nativeRows(path: string) {
  const db = new DatabaseSync(path);
  try {
    return digest(
      canonical(
        [
          "integration_stock_journals",
          "integration_stock_journal_observations",
          "integration_stock_journal_references",
          "platform_commands",
          "platform_audit",
          "inventory_movements",
          "integration_cost_packets",
        ].map((name) =>
          db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all(),
        ),
      ),
    );
  } finally {
    db.close();
  }
}
test("twenty-header scoped insertion pages conserve facts and exclude later inserted journals", (t) => {
  const { f, j, make, ids, original } = rejectedQueue(t);
  const before = nativeRows(f.path),
    first = j.queue(f.actor);
  assert.deepEqual(
    first.items.map((r) => r.id),
    ids.slice(4).reverse(),
  );
  assert.ok(first.next);
  for (const item of first.items) {
    assert.equal("plan" in item, false);
    assert.equal(
      "leaseId" in item || "lease_id" in item || "lease_actor" in item,
      false,
    );
  }
  const older = j.queue(f.actor, { after: first.next! });
  assert.deepEqual(
    older.items.map((r) => r.id),
    ids.slice(0, 4).reverse(),
  );
  assert.equal(older.next, null);
  assert.equal(
    j.queue(f.actor, { sourceId: original.id, state: "rejected" }).items.length,
    20,
  );
  assert.deepEqual(j.queue(f.actor, { state: "posted" }), {
    items: [],
    next: null,
  });
  assert.deepEqual(j.queue(f.actor, { sourceId: "missing" }), {
    items: [],
    next: null,
  });
  assert.equal(nativeRows(f.path), before);
  const newest = j.prepare(f.actor, "later", make());
  assert.deepEqual(j.queue(f.actor, { after: first.next! }), older);
  assert.equal(j.queue(f.actor).items[0]!.id, newest.id);
  // Deliberately backdating does not change insertion order.
  const db = new DatabaseSync(f.path);
  db.prepare(
    "UPDATE integration_stock_journals SET created_at='2000-01-01' WHERE id=?",
  ).run(newest.id);
  db.close();
  assert.equal(j.queue(f.actor).items[0]!.id, newest.id);
});

test("queue cursors bind filters, principal and kind; malformed or unavailable anchors refuse", (t) => {
  const { f, j, reviewer, original } = rejectedQueue(t),
    first = j.queue(f.actor),
    cursor = first.next!;
  for (const input of [
    { state: "rejected" as const, after: cursor },
    { sourceId: original.id, after: cursor },
    { after: "%%%" },
    { after: "" },
    { after: cursor + "=" },
    { limit: 100 },
  ]) {
    assert.throws(() => j.queue(f.actor, input), {
      code: "limit" in input ? "JOURNAL_INPUT" : "INVALID_CURSOR",
    });
  }
  assert.throws(() => j.queue(reviewer, { after: cursor }), {
    code: "INVALID_CURSOR",
  });
  assert.throws(() =>
    j.queue({ ...f.actor, orgId: "foreign" }, { after: cursor }),
  );
  assert.throws(() => j.queue(f.actor, { state: null } as any), {
    code: "JOURNAL_INPUT",
  });
  assert.throws(() => j.queue(f.actor, { state: "forged" } as any), {
    code: "JOURNAL_INPUT",
  });
  const token = JSON.parse(Buffer.from(cursor, "base64url").toString());
  token[2] = 999999;
  assert.throws(
    () =>
      j.queue(f.actor, {
        after: Buffer.from(JSON.stringify(token)).toString("base64url"),
      }),
    { code: "INVALID_CURSOR" },
  );
});

test("history beyond the detail cap uses exact hash-checked pages and excludes newer observations", (t) => {
  const { f, j, approve, make, reviewer } = journalFixture(t),
    approved = approve();
  for (let i = 0; i < 106; i++) {
    const lease = j.claim(f.actor, approved.id, i === 0 ? "write" : "lookup")!;
    j.unresolved(lease, "transport-uncertain");
  }
  const before = nativeRows(f.path),
    detail = j.detail(f.actor, approved.id),
    first = j.observations(f.actor, approved.id);
  assert.equal(detail.observations.length, 100);
  assert.equal(detail.olderObservations, true);
  const observed = [...first.items];
  let after = first.next;
  while (after) {
    const page = j.observations(f.actor, approved.id, { after });
    assert.ok(page.items.length <= 20);
    observed.push(...page.items);
    after = page.next;
  }
  assert.deepEqual(
    observed.map((r) => r.revision),
    Array.from({ length: 106 }, (_, i) => 106 - i),
  );
  assert.equal(nativeRows(f.path), before);
  const lease = j.claim(f.actor, approved.id, "lookup")!;
  j.unresolved(lease, "transport-uncertain");
  assert.equal(j.observations(f.actor, approved.id).items[0]!.revision, 107);
  assert.equal(
    j.observations(f.actor, approved.id, { after: first.next! }).items[0]!
      .revision,
    86,
  );
  assert.throws(
    () => j.observations(reviewer, approved.id, { after: first.next! }),
    { code: "INVALID_CURSOR" },
  );
  assert.throws(
    () => j.observations(f.actor, "foreign", { after: first.next! }),
    { code: "NOT_FOUND" },
  );
  // Cursor positions cannot confer access to a different history scope.
  assert.throws(
    () =>
      j.observations(f.actor, approved.id, {
        after: Buffer.from(JSON.stringify([1, 106, 86, "wrong-kind"])).toString(
          "base64url",
        ),
      }),
    { code: "INVALID_CURSOR" },
  );
  assert.throws(
    () => j.observations(f.actor, approved.id, { extra: true } as any),
    { code: "JOURNAL_INPUT" },
  );
  assert.equal(make().sourceHash, approved.sourceHash);
  const db = new DatabaseSync(f.path);
  db.prepare(
    "UPDATE integration_stock_journal_observations SET body='{}' WHERE journal_id=? AND revision=1",
  ).run(approved.id);
  db.close();
  // The recent detail deliberately cannot qualify older uninspected evidence.
  assert.equal(j.detail(f.actor, approved.id).olderObservations, true);
  const token = JSON.parse(Buffer.from(first.next!, "base64url").toString());
  token[2] = 2;
  assert.throws(
    () =>
      j.observations(f.actor, approved.id, {
        after: Buffer.from(JSON.stringify(token)).toString("base64url"),
      }),
    { code: "JOURNAL_INTEGRITY" },
  );
});

for (const change of ["role", "disabled", "password", "buyer-account"] as const)
  test(`every native queue/detail/history read rechecks persisted ${change} authority`, (t) => {
    const { f, j, reviewer, approve } = journalFixture(t),
      approved = approve();
    assert.equal(j.queue(reviewer).items.length, 1);
    const db = new DatabaseSync(f.path);
    if (change === "role")
      db.prepare("UPDATE iam_users SET role='sales' WHERE id=?").run(
        reviewer.id,
      );
    else if (change === "disabled")
      db.prepare("UPDATE iam_users SET active=0 WHERE id=?").run(reviewer.id);
    else if (change === "password")
      db.prepare(
        "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
      ).run(reviewer.id);
    else
      db.prepare("UPDATE iam_users SET account_id=? WHERE id=?").run(
        f.buyer,
        reviewer.id,
      );
    db.close();
    assert.throws(() => j.queue(reviewer));
    assert.throws(() => j.queue(reviewer, { sourceId: "missing" }));
    assert.throws(() => j.detail(reviewer, approved.id));
    assert.throws(() => j.observations(reviewer, approved.id));
  });

test("queue validates frozen source review integrity before returning descriptors", (t) => {
  const { f, j, approve } = journalFixture(t),
    approved = approve(),
    db = new DatabaseSync(f.path);
  db.prepare("UPDATE integration_stock_journals SET plan='{}' WHERE id=?").run(
    approved.id,
  );
  db.close();
  assert.throws(() => j.queue(f.actor), { code: "JOURNAL_INTEGRITY" });
});

async function session(
  http: Awaited<ReturnType<typeof createHttp>>,
  email = "admin@example.test",
  password = "long-test-only-password",
) {
  const response = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin: "http://localhost" },
    payload: { email, password },
  });
  assert.equal(response.statusCode, 200);
  return {
    cookie: response.headers["set-cookie"]!.toString().split(";")[0]!,
    origin: "http://localhost",
    "x-csrf-token": response.json().csrf,
  };
}
for (const region of ["CA", "US"] as const)
  test(`${region} authenticated HTTP review retains exact retries and independent approval without transport`, async (t) => {
    const { f, j, make } = journalFixture(t, region),
      http = await createHttp(f.app, { origin: "http://localhost" });
    t.after(() => void http.close());
    assert.equal(
      (await http.inject({ url: "/api/accounting/journals" })).statusCode,
      401,
    );
    const admin = await session(http),
      reviewer = await session(
        http,
        "finance@example.test",
        "test-only-long-password",
      );
    const post = (
      name: string,
      payload: unknown,
      key: string,
      headers = admin,
    ) =>
      http.inject({
        method: "POST",
        url: `/api/commands/accounting.journal.${name}`,
        headers: { ...headers, "idempotency-key": key },
        payload: payload as any,
      });
    assert.equal(
      (
        await post("prepare", make(), "csrf", {
          ...admin,
          "x-csrf-token": "bad",
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await post("prepare", make(), "origin", {
          ...admin,
          origin: "http://elsewhere",
        })
      ).statusCode,
      403,
    );
    for (const selection of [
      { ...make(), token: "forged" },
      { ...make(), authority: { ...make().authority, token: "forged" } },
      { ...make(), accounts: [{ ...make().accounts[0], extra: true }] },
      { ...make(), attemptId: undefined },
    ])
      assert.equal(
        (await post("prepare", selection, "fields")).statusCode,
        400,
      );
    const prepared = await post("prepare", make(), "prepare");
    assert.equal(prepared.statusCode, 200, prepared.body);
    const ready = prepared.json();
    assert.equal(
      (await post("prepare", make(), "prepare")).json().id,
      ready.id,
    );
    assert.equal(
      (await post("prepare", { ...make(), reason: "changed" }, "prepare"))
        .statusCode,
      409,
    );
    const decision = {
      journalId: ready.id,
      reviewHash: ready.reviewHash,
      decision: "approve",
      reason: "Synthetic separate HTTP approval",
    };
    assert.equal((await post("decide", decision, "self")).statusCode, 403);
    assert.equal(
      (
        await post(
          "decide",
          { ...decision, reviewHash: "0".repeat(64) },
          "hash",
          reviewer,
        )
      ).statusCode,
      409,
    );
    assert.equal(
      (await post("decide", decision, "approve", reviewer)).json().state,
      "pending",
    );
    assert.equal(
      (await post("decide", decision, "approve", reviewer)).json().state,
      "pending",
    );
    const before = nativeRows(f.path);
    for (const url of [
      "/api/accounting/journals",
      `/api/accounting/journals?sourceId=${ready.sourceId}&state=pending`,
      `/api/accounting/journals/${ready.id}`,
      `/api/accounting/journals/${ready.id}/observations`,
    ]) {
      const read = await http.inject({ url, headers: reviewer });
      assert.equal(read.statusCode, 200, read.body);
      assert.equal(read.headers["cache-control"], "no-store");
      for (const key of [
        "lease_id",
        "lease_actor",
        "accessToken",
        "refreshToken",
        "clientSecret",
      ])
        assert.equal(read.body.includes(`"${key}"`), false);
    }
    for (const url of [
      "/api/accounting/journals?limit=100",
      "/api/accounting/journals?state=forged",
      `/api/accounting/journals/${ready.id}?extra=true`,
      `/api/accounting/journals/${ready.id}/observations?limit=100`,
    ])
      assert.equal(
        (await http.inject({ url, headers: admin })).statusCode,
        400,
      );
    assert.equal(
      (
        await http.inject({
          url: "/api/accounting/journals/foreign",
          headers: admin,
        })
      ).statusCode,
      404,
    );
    for (const name of ["run", "claim", "beforeWrite", "posted", "unresolved"])
      assert.equal(
        (await post(name, { journalId: ready.id }, `no-${name}`)).statusCode,
        404,
      );
    assert.equal(nativeRows(f.path), before);
    assert.equal(j.detail(f.actor, ready.id).state, "pending");
    assert.equal(j.detail(f.actor, ready.id).observations.length, 0);
  });

test("HTTP correction cancellation binds separate retained exact evidence", async (t) => {
  const { f, j, c, approve, selected, reviewer } = journalFixture(
      t,
      "CA",
      true,
    ),
    first = approve(),
    lease = j.claim(f.actor, first.id, "write")!;
  j.beforeWrite(lease);
  j.unresolved(lease, "transport-uncertain");
  c.observe(
    reviewer,
    "proof",
    outcomeInput(f, selected.id, "reversal", {
      outcome: "cancelled-unposted",
      externalRef: "synthetic-reversal",
      evidence: "Synthetic independently checked cancellation",
    }),
  );
  const evidence = c
    .outcomes(f.actor, selected.id)
    .legs.find((l) => l.leg === "reversal")!.current!;
  const http = await createHttp(f.app, { origin: "http://localhost" });
  t.after(() => void http.close());
  const admin = await session(http),
    finance = await session(
      http,
      "finance@example.test",
      "test-only-long-password",
    );
  const body = {
    journalId: first.id,
    requestRef: first.requestRef,
    evidenceHash: evidence.evidenceHash,
    reason: "Synthetic separate cancellation binding",
  };
  const post = (payload: unknown, key: string, headers = admin) =>
    http.inject({
      method: "POST",
      url: "/api/commands/accounting.journal.cancel-correction",
      headers: { ...headers, "idempotency-key": key },
      payload: payload as any,
    });
  assert.equal((await post(body, "self", finance)).statusCode, 409);
  assert.equal(
    (await post({ ...body, requestRef: "wrong" }, "wrong")).statusCode,
    409,
  );
  assert.equal((await post(body, "cancel")).json().state, "cancelled");
  assert.equal((await post(body, "cancel")).json().state, "cancelled");
  assert.equal(
    j.observations(f.actor, first.id).items[0]!.body.outcome,
    "cancelled-unposted",
  );
  assert.equal(j.claim(f.actor, first.id, "write"), null);
});

for (const role of ["commercial", "buyer"] as const)
  test(`HTTP ${role} cannot inspect or prepare organization journals`, async (t) => {
    const { f, make, approve } = journalFixture(t),
      approved = approve();
    f.app.identity.createUser(f.actor, "reader", {
      email: "reader@example.test",
      name: "Synthetic restricted reader",
      password: "synthetic-reader-password",
      role,
      ...(role === "buyer" ? { accountId: f.buyer } : {}),
      sites: [],
    });
    const http = await createHttp(f.app, { origin: "http://localhost" });
    t.after(() => void http.close());
    const headers = await session(
      http,
      "reader@example.test",
      "synthetic-reader-password",
    );
    for (const url of [
      "/api/accounting/journals",
      `/api/accounting/journals/${approved.id}`,
      `/api/accounting/journals/${approved.id}/observations`,
    ])
      assert.equal((await http.inject({ url, headers })).statusCode, 403);
    assert.equal(
      (
        await http.inject({
          method: "POST",
          url: "/api/commands/accounting.journal.prepare",
          headers: { ...headers, "idempotency-key": "forbidden" },
          payload: make(),
        })
      ).statusCode,
      403,
    );
  });

test("HTTP reads remain available under restore hold while preparation and decision refuse", async (t) => {
  const { f, j, make, reviewer } = journalFixture(t),
    ready = j.prepare(f.actor, "prepare", make());
  f.app.platform.isolateRestore("0".repeat(64), "2026-10-03T00:00:00.000Z");
  const http = await createHttp(f.app, { origin: "http://localhost" });
  t.after(() => void http.close());
  const headers = await session(
    http,
    "finance@example.test",
    "test-only-long-password",
  );
  assert.equal(
    (await http.inject({ url: "/api/accounting/journals", headers }))
      .statusCode,
    200,
  );
  assert.equal(
    (
      await http.inject({
        url: `/api/accounting/journals/${ready.id}`,
        headers,
      })
    ).statusCode,
    200,
  );
  const post = (name: string, payload: unknown) =>
    http.inject({
      method: "POST",
      url: `/api/commands/accounting.journal.${name}`,
      headers: { ...headers, "idempotency-key": name },
      payload: payload as any,
    });
  assert.equal((await post("prepare", make())).statusCode, 503);
  assert.equal(
    (
      await post("decide", {
        journalId: ready.id,
        reviewHash: ready.reviewHash,
        decision: "approve",
        reason: "Synthetic",
      })
    ).statusCode,
    503,
  );
  assert.equal(j.detail(reviewer, ready.id).state, "ready");
});

for (const change of ["role", "disabled", "password"] as const)
  test(`HTTP session and cached review replay refuse after persisted ${change} change`, async (t) => {
    const { f, make, reviewer } = journalFixture(t),
      http = await createHttp(f.app, { origin: "http://localhost" });
    t.after(() => void http.close());
    const headers = await session(
      http,
      "finance@example.test",
      "test-only-long-password",
    );
    const post = () =>
      http.inject({
        method: "POST",
        url: "/api/commands/accounting.journal.prepare",
        headers: { ...headers, "idempotency-key": "prepare" },
        payload: make(),
      });
    const prepared = await post();
    assert.equal(prepared.statusCode, 200);
    const db = new DatabaseSync(f.path);
    if (change === "role")
      db.prepare("UPDATE iam_users SET role='commercial' WHERE id=?").run(
        reviewer.id,
      );
    else if (change === "disabled")
      db.prepare("UPDATE iam_users SET active=0 WHERE id=?").run(reviewer.id);
    else
      db.prepare(
        "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
      ).run(reviewer.id);
    db.close();
    for (const url of [
      "/api/accounting/journals",
      `/api/accounting/journals/${prepared.json().id}`,
      `/api/accounting/journals/${prepared.json().id}/observations`,
    ])
      assert.equal(
        (await http.inject({ url, headers })).statusCode,
        change === "disabled" ? 401 : 403,
      );
    assert.equal((await post()).statusCode, change === "disabled" ? 401 : 403);
  });

test("HTTP unknown originals cannot borrow the correction cancellation command", async (t) => {
  const { f, j, approve } = journalFixture(t),
    first = approve(),
    lease = j.claim(f.actor, first.id, "write")!;
  j.unresolved(lease, "transport-uncertain");
  const http = await createHttp(f.app, { origin: "http://localhost" });
  t.after(() => void http.close());
  const headers = await session(http);
  const response = await http.inject({
    method: "POST",
    url: "/api/commands/accounting.journal.cancel-correction",
    headers: { ...headers, "idempotency-key": "original-cancel" },
    payload: {
      journalId: first.id,
      requestRef: first.requestRef,
      evidenceHash: "0".repeat(64),
      reason: "Synthetic invalid cancellation",
    },
  });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().code, "JOURNAL_STATE");
  assert.equal(j.detail(f.actor, first.id).state, "unknown");
});

test("HTTP queue and observation cursors round-trip exactly and refuse changed scopes", async (t) => {
  const { f, j, ids, make, approve } = rejectedQueue(t),
    approved = approve(make(), "history");
  for (let i = 0; i < 22; i++)
    j.unresolved(
      j.claim(f.actor, approved.id, i ? "lookup" : "write")!,
      "transport-uncertain",
    );
  const http = await createHttp(f.app, { origin: "http://localhost" });
  t.after(() => void http.close());
  const headers = await session(http),
    first = await http.inject({ url: "/api/accounting/journals", headers });
  assert.equal(first.json().items.length, 20);
  const after = first.json().next;
  assert.equal(typeof after, "string");
  const older = await http.inject({
    url: `/api/accounting/journals?after=${after}`,
    headers,
  });
  assert.deepEqual(
    older.json().items.map((r: { id: string }) => r.id),
    ids.slice(0, 5).reverse(),
  );
  assert.equal(
    (
      await http.inject({
        url: `/api/accounting/journals?state=rejected&after=${after}`,
        headers,
      })
    ).statusCode,
    400,
  );
  const historyUrl = `/api/accounting/journals/${approved.id}/observations`,
    history = await http.inject({ url: historyUrl, headers });
  assert.equal(history.json().items.length, 20);
  assert.deepEqual(
    (
      await http.inject({
        url: `${historyUrl}?after=${history.json().next}`,
        headers,
      })
    )
      .json()
      .items.map((r: { revision: number }) => r.revision),
    [2, 1],
  );
  assert.equal(
    (await http.inject({ url: `${historyUrl}?after=${after}`, headers }))
      .statusCode,
    400,
  );
  assert.equal(
    (
      await http.inject({
        url: `/api/accounting/journals/${ids[0]}/observations?after=${history.json().next}`,
        headers,
      })
    ).statusCode,
    400,
  );
});

test("correction approval binds a single timestamp when the clock advances between retained writes", (t) => {
  const { f, c, reviewer, original, j, make } = journalFixture(t);
  const ready = c.prepare(f.actor, "clock-correction", {
    originalId: original.id,
    originalHash: original.contentHash!,
    policyRevision: 1,
    postingDate: "2026-10-03",
    outcome: "posted",
    receiverRef: "quickbooks-sandbox:12345",
    externalRef: "synthetic-original-clock",
    originalPostingDate: "2026-09-29",
    outcomeEvidence: "Synthetic independent posting evidence",
    cancellationEvidence: null,
    priorPeriodEvidence: "Synthetic accountant review",
    reason: "Synthetic account correction",
  });
  const originalIso = Date.prototype.toISOString,
    base = Date.parse("2026-10-03T01:00:00.000Z");
  let calls = 0;
  t.mock.method(Date.prototype, "toISOString", function () {
    return originalIso.call(new Date(base + calls++));
  });
  const approved = c.decide(reviewer, "clock-review", {
    correctionId: ready.id,
    reviewHash: ready.reviewHash,
    decision: "approve",
    reason: "Synthetic independent clock review",
  });
  const file = c.download(f.actor, approved.id),
    document = JSON.parse(file.bytes);
  assert.equal(document.reviewedAt, approved.decisionAt);
  const sourceAccounts = [
    ...new Set<string>(
      document.reversal.map((r: { account: string }) => r.account),
    ),
  ];
  assert.equal(
    j.prepare(f.actor, "clock-delivery", {
      ...make(),
      sourceId: approved.id,
      sourceHash: file.hash,
      leg: "reversal",
      postingDate: "2026-10-03",
      accounts: sourceAccounts.map((sourceAccount, i) => ({
        sourceAccount,
        accountId: String(10 + i),
      })),
    }).state,
    "ready",
  );
  assert.ok(calls > 1);
});
