import { test } from "node:test";
import assert from "node:assert/strict";
import { fork, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { fixture, accept, ship } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { EventReport } from "../src/server/event-report.ts";
import {
  EventDelivery,
  type EventConsumer,
  type LocalEvent,
} from "../src/server/event-delivery.ts";
import { createHttp } from "../src/server/http.ts";
import { createBackup, restoreBackup } from "../src/server/recovery.ts";

function engine(
  f: ReturnType<typeof fixture>,
  apply?: (event: LocalEvent) => unknown,
  version = 1,
  eventVersions = [1],
) {
  const store = f.app.database.owned("report");
  store.migrate(
    "CREATE TABLE IF NOT EXISTS report_test_effects(event_id TEXT PRIMARY KEY,org_id TEXT NOT NULL) STRICT",
  );
  const consumer: EventConsumer = {
    id: "test-report",
    version,
    eventVersions,
    apply(event) {
      store.run(
        "INSERT INTO report_test_effects VALUES(?,?)",
        event.id,
        event.orgId,
      );
      return apply?.(event);
    },
  };
  return new EventDelivery(f.app.database, f.app.platform, f.app.identity, [
    consumer,
  ]);
}
function outbox(f: ReturnType<typeof fixture>) {
  return f.app.database.owned("platform");
}
function effects(f: ReturnType<typeof fixture>) {
  return f.app.database
    .owned("report")
    .all("SELECT * FROM report_test_effects ORDER BY event_id");
}
function row(
  f: ReturnType<typeof fixture>,
  eventId: string,
  consumer = "test-report",
) {
  return outbox(f).get(
    "SELECT * FROM platform_deliveries WHERE consumer_id=? AND event_id=?",
    consumer,
    eventId,
  )!;
}
function due(f: ReturnType<typeof fixture>, consumer = "test-report") {
  outbox(f).run(
    "UPDATE platform_deliveries SET available_at=0 WHERE consumer_id=? AND state='retry'",
    consumer,
  );
}
function expire(f: ReturnType<typeof fixture>, consumer = "test-report") {
  outbox(f).run(
    "UPDATE platform_deliveries SET lease_until=0 WHERE consumer_id=? AND state='leased'",
    consumer,
  );
}
function native(f: ReturnType<typeof fixture>) {
  return {
    stock: f.app.inventory.stock(f.actor),
    orders: f.app.orders.list(f.actor),
    invoices: f.app.billing.invoices(f.actor),
    exposure: f.app.billing.exposure(f.actor, f.buyer),
    events: outbox(f).all("SELECT * FROM platform_events ORDER BY rowid"),
    historical: outbox(f).all(
      "SELECT * FROM platform_projections ORDER BY event_id",
    ),
  };
}

test("bounded local report processes every committed event across restart and duplicate calls, without native fact changes", (t) => {
  const f = fixture(t);
  ship(f, accept(f).id);
  for (let i = 0; i < 43; i++)
    f.app.database.transaction(() =>
      f.app.platform.event(f.actor, "SyntheticFact", `fact-${i}`, {
        quantity: i,
      }),
    );
  const snapshot = native(f),
    total = snapshot.events.length;
  assert.deepEqual(f.app.eventDelivery.tick("event-report"), {
    claimed: 0,
    completed: 0,
    retry: 0,
    quarantined: 0,
    abandoned: 0,
  });
  assert.equal(f.app.platform.project(false), 0);
  let count = f.app.platform.project(true);
  assert.equal(count, 20);
  f.app.close();
  f.app = new Application(f.path);
  const batches: number[] = [];
  for (let n = 0; n < 10; n++) {
    const done = f.app.platform.project(true);
    batches.push(done);
    count += done;
    if (done === 0) break;
  }
  assert.equal(count, total);
  assert.ok(batches.every((n) => n <= 20));
  assert.equal(batches.at(-1), 0);
  assert.equal(
    f.app.database
      .owned("report")
      .get("SELECT COUNT(*) AS count FROM report_events")?.count,
    total,
  );
  assert.equal(
    outbox(f).get("SELECT COUNT(*) AS count FROM platform_delivery_receipts")
      ?.count,
    total,
  );
  assert.deepEqual(native(f), snapshot);
  const seen: string[] = [];
  let cursor: string | undefined;
  do {
    const page = f.app.eventDelivery.diagnostics(
      f.actor,
      "event-report",
      cursor,
    );
    assert.ok(page.items.length <= 20);
    seen.push(...page.items.map((item) => String(item.event_id)));
    cursor = page.next ?? undefined;
  } while (cursor);
  assert.equal(seen.length, total);
  assert.equal(new Set(seen).size, total);
  assert.throws(
    () =>
      f.app.database
        .owned("report")
        .run("UPDATE inventory_units SET quantity=99"),
    /authorized/,
  );
});

test("changed consumer versions abandon outstanding claims; late receipt faults roll back effects before a safe retry", (t) => {
  const f = fixture(t),
    original = engine(f);
  const old = original.claimBatch("test-report", 1).claims[0]!;
  const upgraded = engine(f, undefined, 2);
  assert.equal(upgraded.deliver(old), "abandoned");
  assert.equal(effects(f).length, 0);
  expire(f);
  const claim = upgraded.claimBatch("test-report", 1).claims[0]!;
  assert.equal(claim.eventId, old.eventId);
  const s = outbox(f);
  s.migrate(
    "CREATE TRIGGER platform_event_receipt_abort BEFORE INSERT ON platform_delivery_receipts BEGIN SELECT RAISE(ABORT,'synthetic late receipt secret'); END;",
  );
  assert.equal(upgraded.deliver(claim), "retry");
  assert.equal(effects(f).length, 0);
  assert.equal(
    s.get("SELECT COUNT(*) AS count FROM platform_delivery_receipts")?.count,
    0,
  );
  assert.equal(row(f, claim.eventId).last_error, "HANDLER_FAILED");
  assert.ok(
    !JSON.stringify(
      upgraded.history(f.actor, "test-report", claim.eventId),
    ).includes("secret"),
  );
  s.migrate("DROP TRIGGER platform_event_receipt_abort");
  due(f);
  assert.equal(
    upgraded.tick("test-report", { enabled: true, limit: 1 }).completed,
    1,
  );
  assert.equal(effects(f).length, 1);
  assert.equal(original.deliver(old), "abandoned");
  assert.equal(
    s.get("SELECT consumer_version FROM platform_delivery_receipts")
      ?.consumer_version,
    2,
  );
});

test("poison and incompatible versions quarantine independently; reviewed compatible upgrade preserves original outbox and completed effects", (t) => {
  const f = fixture(t),
    s = outbox(f);
  const stamp = new Date().toISOString();
  for (const [id, version, payload] of [
    ["bad-json", 1, "{secret broken"],
    ["new-version", 2, '{"next":true}'],
    ["good-after", 1, '{"ok":true}'],
  ] as const)
    s.run(
      "INSERT INTO platform_events VALUES(?,?,?,?,?,?,?)",
      id,
      f.actor.orgId,
      "SyntheticFact",
      version,
      id,
      payload,
      stamp,
    );
  const e = engine(f),
    before = native(f);
  const first = e.tick("test-report", { enabled: true, limit: 100 });
  assert.equal(first.quarantined, 2);
  assert.equal(row(f, "bad-json").last_error, "EVENT_SHAPE");
  assert.equal(row(f, "new-version").last_error, "EVENT_VERSION");
  assert.ok(effects(f).some((r) => r.event_id === "good-after"));
  const r = row(f, "new-version");
  const upgraded = engine(f, undefined, 2, [1, 2]);
  const input = {
    consumerId: "test-report",
    eventId: "new-version",
    revision: Number(r.revision),
    reason: "Synthetic compatible-version review",
  };
  const receipt = upgraded.retry(f.actor, "retry-upgrade", input);
  assert.equal(upgraded.tick("test-report", { enabled: true }).completed, 1);
  assert.deepEqual(upgraded.retry(f.actor, "retry-upgrade", input), receipt);
  assert.equal(upgraded.tick("test-report", { enabled: true }).completed, 0);
  assert.equal(
    upgraded.history(f.actor, "test-report", "new-version").items.length,
    2,
  );
  assert.equal(
    s.get(
      "SELECT consumer_version FROM platform_delivery_receipts WHERE consumer_id='test-report' AND event_id='new-version'",
    )?.consumer_version,
    2,
  );
  assert.throws(
    () =>
      upgraded.retry(f.actor, "completed-replay", {
        ...input,
        revision: Number(row(f, "new-version").revision),
      }),
    { code: "DELIVERY_STATE" },
  );
  assert.deepEqual(native(f), before);
  const diagnostics = JSON.stringify(
    upgraded.diagnostics(f.actor, "test-report"),
  );
  assert.ok(!diagnostics.includes("secret"));
  assert.ok(!diagnostics.includes("lease_token"));
  assert.ok(!diagnostics.includes("payload"));
});

test("transient partial effects roll back, bounded failures quarantine, and explicit review requeues once with history retained", (t) => {
  const f = fixture(t),
    e = engine(f, () => {
      throw Error("private token sk_secret and customer payload");
    });
  const claim = e.claimBatch("test-report", 1).claims[0]!;
  assert.equal(e.deliver(claim), "retry");
  assert.equal(effects(f).length, 0);
  assert.equal(e.tick("test-report", { enabled: true, limit: 1 }).claimed, 1); // Later unclaimed native event remains eligible.
  // Isolate the first event to test its exact bounded retry cycle.
  for (let i = 0; i < 2; i++) {
    due(f);
    const c = e.claimBatch("test-report", 1).claims[0]!;
    assert.equal(c.eventId, claim.eventId);
    e.deliver(c);
  }
  assert.equal(row(f, claim.eventId).state, "quarantined");
  assert.equal(row(f, claim.eventId).attempts, 3);
  assert.equal(row(f, claim.eventId).last_error, "HANDLER_FAILED");
  assert.equal(
    e.history(f.actor, "test-report", claim.eventId).items.length,
    3,
  );
  const good = engine(f),
    input = {
      consumerId: "test-report",
      eventId: claim.eventId,
      revision: Number(row(f, claim.eventId).revision),
      reason: "Reviewed local handler correction",
    };
  const retried = good.retry(f.actor, "review", input);
  assert.deepEqual(good.retry(f.actor, "review", input), retried);
  assert.throws(
    () => good.retry(f.actor, "review", { ...input, reason: "different" }),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  due(f);
  assert.equal(
    good.tick("test-report", { enabled: true, limit: 1 }).completed,
    1,
  );
  assert.equal(effects(f).length, 1);
  assert.equal(row(f, claim.eventId).attempts, 4);
  assert.equal(row(f, claim.eventId).cycle_attempts, 1);
  assert.ok(
    !JSON.stringify(
      good.history(f.actor, "test-report", claim.eventId),
    ).includes("sk_secret"),
  );
});

test("expired and replaced leases fence old completions; repeated abandoned claims become reviewable quarantine", (t) => {
  const f = fixture(t),
    e = engine(f),
    original = e.claimBatch("test-report", 1).claims[0]!;
  expire(f);
  assert.equal(e.deliver(original), "abandoned");
  const successor = e.claimBatch("test-report", 1).claims[0]!;
  assert.equal(successor.eventId, original.eventId);
  assert.notEqual(successor.token, original.token);
  assert.equal(e.deliver(original), "abandoned");
  assert.equal(e.deliver(successor), "completed");
  assert.equal(effects(f).length, 1);
  assert.deepEqual(
    e
      .history(f.actor, "test-report", original.eventId)
      .items.map((r) => r.outcome),
    ["completed", "expired"],
  );
  const next = e.claimBatch("test-report", 1).claims[0]!;
  for (let n = 0; n < 2; n++) {
    expire(f);
    e.claimBatch("test-report", 1);
  }
  expire(f);
  assert.equal(e.claimBatch("test-report", 1).quarantined, 1);
  assert.equal(row(f, next.eventId).last_error, "LEASE_EXHAUSTED");
  assert.equal(row(f, next.eventId).attempts, 3);
});

test("handler crossing its lease boundary rolls back its local effect and retains the expired attempt for recovery", (t) => {
  const f = fixture(t),
    real = Date.now;
  const e = engine(f, () => {
    Date.now = () => real() + 60000;
  });
  const claim = e.claimBatch("test-report", 1).claims[0]!;
  try {
    assert.equal(e.deliver(claim), "abandoned");
    assert.equal(effects(f).length, 0);
  } finally {
    Date.now = real;
  }
  expire(f);
  const good = engine(f),
    successor = good.claimBatch("test-report", 1).claims[0]!;
  assert.equal(good.deliver(successor), "completed");
  assert.equal(effects(f).length, 1);
});

test("current real administrator/support grants and password rules protect diagnostics, scoped cursors and cached review receipts", (t) => {
  const f = fixture(t),
    e = engine(f, () => {
      throw Error("fault");
    });
  const claim = e.claimBatch("test-report", 1).claims[0]!;
  e.deliver(claim);
  const input = {
    consumerId: "test-report",
    eventId: claim.eventId,
    revision: Number(row(f, claim.eventId).revision),
    reason: "Synthetic operator review",
  };
  e.retry(f.actor, "review", input);
  const iam = f.app.database.owned("iam");
  iam.run("UPDATE iam_users SET role='support' WHERE id=?", f.actor.id);
  assert.ok(
    e.diagnostics({ ...f.actor, role: "buyer" }, "test-report").items.length,
  );
  assert.throws(() => e.retry(f.actor, "review", input), { code: "FORBIDDEN" });
  iam.run("UPDATE iam_users SET role='warehouse' WHERE id=?", f.actor.id);
  assert.throws(() => e.history(f.actor, "test-report", claim.eventId), {
    code: "FORBIDDEN",
  });
  iam.run("UPDATE iam_users SET role='admin' WHERE id=?", f.actor.id);
  iam.run(
    "INSERT INTO iam_user_security VALUES(?,1,1,?) ON CONFLICT(user_id) DO UPDATE SET password_change_required=1",
    f.actor.id,
    new Date().toISOString(),
  );
  assert.throws(() => e.diagnostics(f.actor, "test-report"), {
    code: "PASSWORD_CHANGE_REQUIRED",
  });
  assert.throws(() => e.retry(f.actor, "review", input), {
    code: "PASSWORD_CHANGE_REQUIRED",
  });
  iam.run(
    "UPDATE iam_user_security SET password_change_required=0 WHERE user_id=?",
    f.actor.id,
  );
  assert.throws(
    () => e.diagnostics({ ...f.actor, orgId: "foreign" }, "test-report"),
    { code: "FORBIDDEN" },
  );
  assert.throws(() => e.diagnostics(f.actor, "test-report", "foreign-event"), {
    code: "CURSOR",
  });
  iam.run("UPDATE iam_users SET active=0 WHERE id=?", f.actor.id);
  assert.throws(() => e.retry(f.actor, "review", input), { code: "FORBIDDEN" });
});

test("optional consumer removal preserves native startup and workflows, retains receipts and refuses replay until registered", (t) => {
  const f = fixture(t);
  f.app.platform.project(true);
  const original = outbox(f).all(
    "SELECT * FROM platform_delivery_receipts ORDER BY event_id",
  );
  f.app.close();
  f.app = new Application(f.path, "CA", { eventReports: false });
  assert.equal(f.app.platform.project(true), 0);
  ship(f, accept(f).id);
  assert.equal(f.app.billing.invoices(f.actor).length, 1);
  assert.equal(
    f.app.eventDelivery.diagnostics(f.actor, "event-report").registered,
    false,
  );
  assert.throws(() => f.app.eventDelivery.claimBatch("event-report"), {
    code: "CONSUMER_REMOVED",
  });
  assert.deepEqual(
    outbox(f).all("SELECT * FROM platform_delivery_receipts ORDER BY event_id"),
    original,
  );
  f.app.close();
  f.app = new Application(f.path);
  assert.ok(f.app.platform.project(true) > 0);
  assert.equal(f.app.platform.project(true), 0);
});

test("consumer registration rejects duplicate/invalid/async contracts, batches validate bounds, and async returns roll back", (t) => {
  const f = fixture(t),
    c: EventConsumer = {
      id: "test",
      version: 1,
      eventVersions: [1],
      apply: () => {},
    };
  for (const candidates of [
    [c, c],
    [{ ...c, id: "Bad ID" }],
    [{ ...c, version: 0 }],
    [{ ...c, eventVersions: [] }],
    [{ ...c, apply: async () => {} }],
  ])
    assert.throws(
      () =>
        new EventDelivery(
          f.app.database,
          f.app.platform,
          f.app.identity,
          candidates,
        ),
    );
  const e = engine(f, () => Promise.resolve());
  assert.throws(() => e.claimBatch("test-report", 0), { code: "VALIDATION" });
  assert.throws(() => e.claimBatch("test-report", 101), { code: "VALIDATION" });
  const claim = e.claimBatch("test-report", 1).claims[0]!;
  assert.equal(e.deliver(claim), "quarantined");
  assert.equal(effects(f).length, 0);
  assert.equal(row(f, claim.eventId).last_error, "HANDLER_ASYNC");
});

async function child(
  t: { after: (fn: () => void) => void },
  f: ReturnType<typeof fixture>,
  mode: string,
) {
  const p = fork(new URL("./event-delivery-child.ts", import.meta.url), [], {
    execArgv: ["--import", "tsx"],
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  t.after(() => {
    if (p.exitCode === null) p.kill("SIGKILL");
  });
  let stderr = "";
  p.stderr!.on("data", (b) => (stderr += String(b)));
  const ready = new Promise<void>((resolve, reject) => {
    p.on("message", (m: any) => {
      if (m.ready) resolve();
    });
    p.once("error", reject);
    p.once("exit", () =>
      reject(Error(stderr || "Child exited before readiness")),
    );
  });
  p.send({ action: "init", path: f.path, mode });
  await ready;
  return p;
}
function restartEngine(f: ReturnType<typeof fixture>) {
  const report = new EventReport(f.app.database);
  return new EventDelivery(f.app.database, f.app.platform, f.app.identity, [
    {
      id: "process-report",
      version: 1,
      eventVersions: [1],
      apply(e) {
        report.apply(e);
      },
    },
  ]);
}
for (const mode of ["claimed", "during", "after"])
  test(
    `SIGKILL ${mode} effect commit recovers one local effect with durable deduplication`,
    { timeout: 10000 },
    async (t) => {
      const f = fixture(t);
      const total = outbox(f).get(
        "SELECT COUNT(*) AS count FROM platform_events",
      )!.count;
      const p = await child(t, f, mode);
      const phase = new Promise<void>((resolve, reject) => {
        let data = "";
        p.stdout!.on("data", (b) => {
          data += String(b);
          if (data.includes(`"phase":"${mode}"`)) resolve();
        });
        p.once("exit", () => reject(Error("No crash marker")));
      });
      p.send({ action: "go" });
      await phase;
      const exit = once(p, "exit");
      p.kill("SIGKILL");
      const [, signal] = await exit;
      assert.equal(signal, "SIGKILL");
      assert.equal(
        f.app.database
          .owned("report")
          .get("SELECT COUNT(*) AS count FROM report_events")?.count,
        mode === "after" ? 1 : 0,
      );
      expire(f, "process-report");
      f.app.close();
      f.app = new Application(f.path);
      const e = restartEngine(f);
      e.tick("process-report", { enabled: true, limit: 100 });
      assert.equal(
        f.app.database
          .owned("report")
          .get("SELECT COUNT(*) AS count FROM report_events")?.count,
        total,
      );
      assert.equal(
        e.tick("process-report", { enabled: true, limit: 100 }).completed,
        0,
      );
      assert.equal(
        outbox(f).get(
          "SELECT COUNT(*) AS count FROM platform_delivery_receipts WHERE consumer_id='process-report'",
        )?.count,
        total,
      );
    },
  );

test(
  "two independent OS workers claim disjoint batches and commit one report effect per event",
  { timeout: 10000 },
  async (t) => {
    const f = fixture(t);
    for (let n = 0; n < 35; n++)
      f.app.platform.event(f.actor, "SyntheticFact", `concurrent-${n}`, { n });
    const total = Number(
      outbox(f).get("SELECT COUNT(*) AS count FROM platform_events")!.count,
    );
    const ps = await Promise.all([
      child(t, f, "compete"),
      child(t, f, "compete"),
    ]);
    const results = ps.map(
      (p) =>
        new Promise<{ result: { completed: number }; error?: string }>(
          (resolve, reject) => {
            p.on("message", (m: any) => {
              if (m.result || m.error) resolve(m);
            });
            p.once("error", reject);
          },
        ),
    );
    ps.forEach((p) => p.send({ action: "go" }));
    const rs = await Promise.all(results);
    assert.ok(rs.every((r) => !r.error));
    assert.equal(
      rs.reduce((n, r) => n + r.result.completed, 0),
      total,
    );
    await Promise.all(
      ps.filter((p) => p.exitCode === null).map((p) => once(p, "exit")),
    );
    assert.equal(
      f.app.database
        .owned("report")
        .get("SELECT COUNT(*) AS count FROM report_events")?.count,
      total,
    );
  },
);

test("authenticated HTTP diagnostics/history are scoped and shape-strict; reviewed retry requires CSRF and current admin authority", async (t) => {
  const f = fixture(t),
    e = engine(f, () => {
      throw Error("secret");
    });
  // HTTP composition is registered only for its actual optional metadata consumer.
  const s = outbox(f),
    stamp = new Date().toISOString();
  s.run(
    "INSERT INTO platform_events VALUES('http-poison',?,'SyntheticFact',999,'http-poison','{}',?)",
    f.actor.orgId,
    stamp,
  );
  f.app.platform.project(true);
  const http = await createHttp(f.app, {
    origin: "http://127.0.0.1:3000",
    staticRoot: "/nonexistent-distributor-test",
  });
  t.after(() => http.close());
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
  const cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const headers = {
    cookie,
    "x-csrf-token": login.json().csrf,
    "idempotency-key": "http-review",
    origin: "http://127.0.0.1:3000",
  };
  const base = "/api/events/event-report/deliveries";
  assert.equal((await http.inject({ url: base })).statusCode, 401);
  assert.equal(
    (await http.inject({ url: base + "?limit=500", headers: { cookie } }))
      .statusCode,
    400,
  );
  const list = await http.inject({ url: base, headers: { cookie } });
  assert.equal(list.statusCode, 200);
  assert.ok(
    list
      .json()
      .items.some(
        (r: any) =>
          r.event_id === "http-poison" && r.last_error === "EVENT_VERSION",
      ),
  );
  const history = await http.inject({
    url: base + "/http-poison/history",
    headers: { cookie },
  });
  assert.equal(history.statusCode, 200);
  assert.ok(
    !history.body.includes("lease_token") && !history.body.includes("payload"),
  );
  const payload = {
    consumerId: "event-report",
    eventId: "http-poison",
    revision: Number(row(f, "http-poison", "event-report").revision),
    reason: "Operator reviewed unsupported version",
  };
  const url = "/api/commands/events.retry";
  assert.equal(
    (await http.inject({ method: "POST", url, headers: { cookie }, payload }))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url,
        headers,
        payload: { ...payload, role: "admin" },
      })
    ).statusCode,
    400,
  );
  const first = await http.inject({ method: "POST", url, headers, payload });
  assert.equal(first.statusCode, 200);
  assert.deepEqual(
    (await http.inject({ method: "POST", url, headers, payload })).json(),
    first.json(),
  );
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='support' WHERE id=?", f.actor.id);
  assert.equal(
    (await http.inject({ method: "POST", url, headers, payload })).statusCode,
    403,
  );
  assert.equal(
    (await http.inject({ url: base, headers: { cookie } })).statusCode,
    200,
  );
  // Keep the local custom engine referenced to ensure it owns no HTTP worker path.
  assert.equal(e.tick("test-report").claimed, 0);
});

test("encrypted backup keeps report receipts and pending work; isolated restore can rebuild local reports without provider clearance", async (t) => {
  const f = fixture(t);
  f.app.platform.project(true);
  const original = outbox(f).all(
    "SELECT * FROM platform_delivery_receipts ORDER BY event_id",
  );
  ship(f, accept(f).id);
  const archive = join(dirname(f.path), "event-backup.distributor-backup"),
    target = join(dirname(f.path), "event-restored.db"),
    key = randomBytes(32);
  await createBackup(f.path, archive, "CA", key);
  await restoreBackup(archive, target, "CA", key);
  const restored = new Application(target);
  t.after(() => restored.close());
  assert.ok(restored.platform.recoveryHold());
  assert.throws(() => restored.platform.assertProviderAccess(), {
    code: "RECOVERY_HOLD",
  });
  assert.ok(
    restored.eventDelivery.tick("event-report", { enabled: true }).completed >
      0,
  );
  assert.equal(restored.platform.project(true), 0);
  const receipts = restored.database
    .owned("platform")
    .all("SELECT * FROM platform_delivery_receipts ORDER BY event_id");
  for (const r of original)
    assert.deepEqual(
      receipts.find((x) => x.event_id === r.event_id),
      r,
    );
  assert.deepEqual(
    restored.inventory.stock(f.actor),
    f.app.inventory.stock(f.actor),
  );
  assert.deepEqual(
    restored.billing.invoices(f.actor),
    f.app.billing.invoices(f.actor),
  );
});

function worker(
  path: string,
  overrides: Record<string, string | undefined> = {},
  args: string[] = [],
) {
  return new Promise<{ code: number | null; out: string; err: string }>(
    (resolve, reject) => {
      const p = spawn(
        process.execPath,
        ["--import", "tsx", "src/server/event-worker.ts", ...args],
        {
          env: {
            ...process.env,
            DATABASE_PATH: path,
            DATA_REGION: "CA",
            EVENT_REPORTS: "enabled",
            LOCAL_EVENT_REPORTS: "enabled",
            ...overrides,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let out = "",
        err = "";
      p.stdout.on("data", (b) => (out += b));
      p.stderr.on("data", (b) => (err += b));
      p.once("error", reject);
      p.on("close", (code) => resolve({ code, out, err }));
    },
  );
}
test("foreground worker refuses uninitialized files without creating application data", async (t) => {
  const f = fixture(t);
  for (const kind of ["zero-byte", "empty-sqlite", "unrelated-sqlite"]) {
    await t.test(kind, async () => {
      const path = join(dirname(f.path), `${kind}.db`);
      writeFileSync(path, "");
      if (kind !== "zero-byte") {
        const db = new DatabaseSync(path);
        try {
          db.exec(
            kind === "empty-sqlite"
              ? "VACUUM"
              : "CREATE TABLE unrelated(id INTEGER)",
          );
        } finally {
          db.close();
        }
      }
      const before = readFileSync(path);
      const result = await worker(path);
      assert.equal(result.code, 1, result.out);
      assert.equal(result.out, "");
      assert.deepEqual(readFileSync(path), before);
      for (const suffix of ["-wal", "-shm", "-journal"])
        assert.equal(existsSync(path + suffix), false);
    });
  }
});
test("foreground worker fails closed while disabled, validates path/region/arguments and processes one bounded batch without provider setup", async (t) => {
  const f = fixture(t),
    missing = join(dirname(f.path), "never-created.db");
  const disabled = await worker(missing, { LOCAL_EVENT_REPORTS: undefined });
  assert.equal(disabled.code, 1);
  assert.match(disabled.err, /EVENTS_DISABLED/);
  assert.equal(existsSync(missing), false);
  assert.equal((await worker(missing)).code, 1);
  assert.equal(existsSync(missing), false);
  assert.equal((await worker(f.path, { DATA_REGION: "US" })).code, 1);
  assert.equal((await worker(f.path, {}, ["secret-argument"])).code, 1);
  assert.equal(
    outbox(f).get("SELECT COUNT(*) AS count FROM platform_deliveries")?.count,
    0,
  );
  for (let n = 0; n < 30; n++)
    f.app.platform.event(f.actor, "SyntheticFact", `worker-${n}`, { n });
  const first = await worker(f.path);
  assert.equal(first.code, 0);
  assert.equal(JSON.parse(first.out).completed, 20);
  const second = await worker(f.path);
  assert.equal(second.code, 0);
  assert.ok(
    JSON.parse(second.out).completed > 0 &&
      JSON.parse(second.out).completed < 20,
  );
  assert.equal(JSON.parse((await worker(f.path)).out).completed, 0);
});
