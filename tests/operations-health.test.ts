import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { fixture } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import { oldest, seedOperationsHealth } from "./operations-health-fixture.ts";
import type { OperationsHealth } from "../src/shared/operations-health.ts";

function queue(report: OperationsHealth, id: string) {
  const found = report.queues.find((q) => q.id === id)!;
  return { ...found, states: found.states.map((row) => ({ ...row })) };
}
function dump(path: string) {
  const db = new DatabaseSync(path);
  try {
    return db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map(({ name }) => ({
        name,
        rows: db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
      }));
  } finally {
    db.close();
  }
}
for (const region of ["CA", "US"] as const)
  test(`operations health: ${region} complete scoped counts, age, due work and redaction survive restart without writes`, (t) => {
    const f = fixture(t, { eventReports: false }, region);
    seedOperationsHealth(f.app, f.actor);
    const before = dump(f.path),
      report = f.app.operationsHealth(f.actor);
    assert.equal(report.region, region);
    assert.equal(report.recoveryHold, false);
    assert.equal(report.queues.length, 11);
    assert.deepEqual(queue(report, "effects-stripe").states, [
      { state: "completed", count: 1, oldestCreatedAt: oldest },
      { state: "pending", count: 34, oldestCreatedAt: oldest },
      { state: "unknown", count: 1, oldestCreatedAt: oldest },
    ]);
    for (const id of [
      "payment-callbacks",
      "refund-callbacks",
      "refund-outcomes",
    ])
      assert.equal(queue(report, id).due, 1);
    for (const id of [
      "carrier-bookings",
      "canada-post-groups",
      "canada-post-members",
      "native-refunds",
    ])
      assert.deepEqual(queue(report, id).states, [
        { state: "unknown", count: 1, oldestCreatedAt: oldest },
      ]);
    const events = queue(report, "event-report");
    assert.equal(events.registered, false);
    assert.equal(events.expiredLeases, 1);
    assert.equal(events.lastCompletedAt, oldest);
    assert.equal(
      events.due,
      events.states.find((s) => s.state === "unclaimed")!.count + 2,
    );
    assert(!JSON.stringify(report).includes("PRIVATE"));
    assert.deepEqual(dump(f.path), before);
    f.app.close();
    f.app = new Application(f.path, region, { eventReports: false });
    assert.deepEqual(f.app.operationsHealth(f.actor).queues, report.queues);
    assert.deepEqual(dump(f.path), before);
  });

test("operations health: current persisted authority precedes empty results, forged roles and cached support access", (t) => {
  const f = fixture(t, { eventReports: false });
  const support = f.app.identity.createUser(f.actor, "health-support", {
    email: "support@example.test",
    name: "Synthetic support",
    password: "long-test-only-password",
    role: "support",
    sites: [],
  });
  const actor = f.app.identity.currentActor({ ...f.actor, id: support.id });
  assert.equal(f.app.operationsHealth(actor).queues.length, 11);
  const iam = f.app.database.owned("iam");
  iam.run("UPDATE iam_users SET role='commercial' WHERE id=?", actor.id);
  assert.throws(
    () => f.app.operationsHealth({ ...actor, role: "admin" }),
    /not permitted/i,
  );
  assert.throws(() => f.app.carriers.health(actor), /not permitted/i);
  assert.throws(
    () => f.app.integration.health(actor, Date.now()),
    /not permitted/i,
  );
  assert.throws(() => f.app.billing.health(actor), /not permitted/i);
  assert.throws(
    () => f.app.eventDelivery.health(actor, "event-report", Date.now()),
    /not permitted/i,
  );
  iam.run("UPDATE iam_users SET role='support',active=0 WHERE id=?", actor.id);
  assert.throws(() => f.app.operationsHealth(actor));
  iam.run("UPDATE iam_users SET active=1 WHERE id=?", actor.id);
  iam.run(
    "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
    actor.id,
  );
  assert.throws(() => f.app.operationsHealth(actor), /Change your password/);
});

test("operations health HTTP: authenticated no-store observations retain recovery hold and register state without processing", async (t) => {
  const f = fixture(t);
  f.app.database
    .owned("platform")
    .run(
      "INSERT INTO platform_recovery VALUES(1,'PRIVATE-SNAPSHOT',?,?)",
      oldest,
      oldest,
    );
  const http = await createHttp(f.app, {
    origin: "http://127.0.0.1:3000",
    staticRoot: "/nonexistent-distributor-test",
  });
  await http.ready();
  t.after(() => http.close());
  assert.equal(
    (await http.inject({ url: "/api/operations/health" })).statusCode,
    401,
  );
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin: "http://127.0.0.1:3000" },
    payload: {
      email: "admin@example.test",
      password: "long-test-only-password",
    },
  });
  assert.equal(login.statusCode, 200);
  const before = dump(f.path);
  const response = await http.inject({
    url: "/api/operations/health",
    headers: { cookie: `${login.cookies[0]!.name}=${login.cookies[0]!.value}` },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.json().recoveryHold, true);
  assert.equal(queue(response.json(), "event-report").registered, true);
  assert(!response.body.includes("PRIVATE"));
  assert.deepEqual(dump(f.path), before);
});
