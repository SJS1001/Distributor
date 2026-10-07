import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fixture } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import { digest } from "../src/server/core.ts";
import { schemaFingerprint, SCHEMA_VERSION } from "../src/server/schema.ts";
import { inspectSchema, upgradeSchema } from "../src/server/schema-upgrade.ts";
import { sessionDeviceDescription } from "../src/shared/session-details.ts";
const password = "long-test-only-password",
  origin = "http://localhost";
const own = (f: ReturnType<typeof fixture>, token: string) =>
  f.app.identity.security(f.actor, token).sessionDetails!;
const current = (f: ReturnType<typeof fixture>, token: string) =>
  own(f, token).find((s) => s.current)!;
const code = (expected: string) => (error: unknown) =>
  (error as { code?: string }).code === expected;

test("recognition stores server timestamps and bounded browser hints, never IP/raw UA; API activity is sampled and assets excluded", async (t) => {
  const f = fixture(t),
    http = await createHttp(f.app, { origin });
  t.after(() => http.close());
  const ua =
    "Mozilla/5.0 (Windows NT 10.0; synthetic-private-id) Chrome/150.0 Safari/537.36";
  const started = Date.now();
  const response = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin, "user-agent": ua, "x-forwarded-for": "203.0.113.10" },
    payload: { email: "admin@example.test", password },
  });
  assert.equal(response.statusCode, 200);
  const cookie = String(response.headers["set-cookie"]).split(";")[0]!;
  const read = await http.inject({ url: "/api/security", headers: { cookie } });
  const detail = read.json().sessionDetails[0];
  assert.match(detail.reference, /^[a-f0-9]{32}$/);
  assert.equal(detail.deviceDescription, "Chrome on Windows");
  assert.ok(detail.createdAt >= started && detail.createdAt <= Date.now());
  assert.equal(detail.lastActivityAt, detail.createdAt);
  assert.ok(
    !read.body.includes("synthetic-private-id") &&
      !read.body.includes("203.0.113.10"),
  );
  const store = f.app.database.owned("iam");
  store.run(
    "UPDATE iam_session_details SET last_activity_at=?",
    Date.now() - 120000,
  );
  const before = store.get(
    "SELECT last_activity_at FROM iam_session_details",
  )!.last_activity_at;
  assert.equal(typeof before, "number");
  await http.inject({ url: "/favicon.ico", headers: { cookie } });
  assert.equal(
    store.get("SELECT last_activity_at FROM iam_session_details")!
      .last_activity_at,
    before,
  );
  await http.inject({ url: "/api/security", headers: { cookie } });
  const sampled = store.get(
    "SELECT last_activity_at FROM iam_session_details",
  )!.last_activity_at;
  assert.notEqual(sampled, before);
  await http.inject({ url: "/api/security", headers: { cookie } });
  assert.equal(
    store.get("SELECT last_activity_at FROM iam_session_details")!
      .last_activity_at,
    sampled,
  );
  store.run(
    "UPDATE iam_session_details SET last_activity_at=?",
    Number(before),
  );
  f.app.platform.isolateRestore("a".repeat(64), "2026-10-03T00:00:00.000Z");
  await http.inject({ url: "/api/security", headers: { cookie } });
  assert.equal(
    store.get("SELECT last_activity_at FROM iam_session_details")!
      .last_activity_at,
    before,
    "activity must not mutate isolated restored evidence",
  );
  assert.equal(
    sessionDeviceDescription("unrecognized-user-agent secret"),
    null,
  );
  assert.equal(
    sessionDeviceDescription("Chrome/123 " + "x".repeat(2048)),
    null,
  );
});

test("own individual revoke reauthenticates, isolates user/organization, expires, audits once and replays exact inputs", (t) => {
  const f = fixture(t),
    first = f.app.identity.login("admin@example.test", password),
    second = f.app.identity.login("admin@example.test", password);
  const target = current(f, second.token),
    caller = current(f, first.token);
  assert.notEqual(target.reference, caller.reference);
  f.app.identity.createUser(f.actor, "other", {
    email: "other@example.test",
    name: "Other",
    password,
    role: "warehouse",
    sites: [f.w1],
  });
  const other = f.app.identity.login("other@example.test", password);
  const foreign = f.app.identity.security(other.actor, other.token)
    .sessionDetails![0]!;
  const store = f.app.database.owned("iam");
  store.run(
    "INSERT INTO iam_organizations VALUES(?,?,?,?,?)",
    "foreign-org",
    "Foreign",
    "CA",
    "CAD",
    "{}",
  );
  store.run(
    "INSERT INTO iam_users SELECT ?,?,?,name,account_id,role,sites,salt,password_hash,active FROM iam_users WHERE id=?",
    "foreign-user",
    "foreign-org",
    "foreign@example.test",
    f.actor.id,
  );
  const foreignOrg = f.app.identity.login("foreign@example.test", password);
  const foreignOrgReference = f.app.identity.security(
    foreignOrg.actor,
    foreignOrg.token,
  ).sessionDetails![0]!.reference!;
  assert.throws(
    () =>
      f.app.identity.revokeOwnSession(
        f.actor,
        "foreign-org-target",
        { sessionReference: foreignOrgReference, currentPassword: password },
        first.token,
      ),
    code("NOT_FOUND"),
  );
  const payload = {
    sessionReference: target.reference!,
    currentPassword: password,
  };
  assert.throws(
    () =>
      f.app.identity.revokeOwnSession(
        f.actor,
        "wrong-password",
        { ...payload, currentPassword: "wrong" },
        first.token,
      ),
    code("REAUTHENTICATE"),
  );
  assert.throws(
    () =>
      f.app.identity.revokeOwnSession(
        f.actor,
        "wrong-user",
        { ...payload, sessionReference: foreign.reference! },
        first.token,
      ),
    code("NOT_FOUND"),
  );
  assert.throws(
    () =>
      f.app.identity.revokeOwnSession(
        { ...f.actor, orgId: "foreign" },
        "wrong-org",
        payload,
        first.token,
      ),
    code("FORBIDDEN"),
  );
  assert.throws(
    () =>
      f.app.identity.revokeOwnSession(
        f.actor,
        "wrong-caller",
        payload,
        other.token,
      ),
    code("FORBIDDEN"),
  );
  const receipt = f.app.identity.revokeOwnSession(
    f.actor,
    "exact",
    payload,
    first.token,
  );
  assert.equal(receipt.sessionEnded, false);
  assert.equal(receipt.sessionsEnded, 1);
  assert.throws(
    () => f.app.identity.session(second.token),
    code("UNAUTHENTICATED"),
  );
  assert.deepEqual(
    f.app.identity.revokeOwnSession(f.actor, "exact", payload, first.token),
    receipt,
  );
  assert.throws(
    () =>
      f.app.identity.revokeOwnSession(
        f.actor,
        "exact",
        { ...payload, sessionReference: caller.reference! },
        first.token,
      ),
    code("IDEMPOTENCY_CONFLICT"),
  );
  assert.equal(
    f.app.database
      .owned("platform")
      .get(
        "SELECT COUNT(*) AS n FROM platform_audit WHERE action='user.session.ended'",
      )!.n,
    1,
  );
  assert.equal(
    f.app.database
      .owned("iam")
      .get(
        "SELECT COUNT(*) AS n FROM iam_session_details WHERE reference=?",
        target.reference!,
      )!.n,
    0,
  );
  assert.equal(current(f, first.token).reference, caller.reference);
  assert.equal(f.app.identity.session(other.token).actor.id, other.actor.id);
  const expired = f.app.identity.login("admin@example.test", password),
    expiredRef = current(f, expired.token).reference!;
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_sessions SET expires_at=? WHERE hash=?",
      Date.now() - 1,
      digest(expired.token),
    );
  assert.throws(
    () =>
      f.app.identity.revokeOwnSession(
        f.actor,
        "expired",
        { ...payload, sessionReference: expiredRef },
        first.token,
      ),
    code("NOT_FOUND"),
  );
});

test("HTTP current revoke clears cookie; exact replay from a fresh login preserves replacement session and existing security fences", async (t) => {
  const f = fixture(t, {
      mfaEncryptionKey: "a1".repeat(32),
      mfaRequiredRoles: ["admin"],
    }),
    http = await createHttp(f.app, { origin });
  t.after(() => http.close());
  const first = f.app.identity.login("admin@example.test", password),
    reference = current(f, first.token).reference!;
  f.app.database
    .owned("iam")
    .run(
      "INSERT INTO iam_user_security VALUES(?,?,?,?)",
      f.actor.id,
      1,
      1,
      new Date().toISOString(),
    );
  const payload = { sessionReference: reference, currentPassword: password },
    headers = {
      origin,
      cookie: `distributor_session=${first.token}`,
      "x-csrf-token": first.csrf,
      "idempotency-key": "current-exact",
    };
  const csrf = await http.inject({
    method: "POST",
    url: "/api/commands/user.session.end-own",
    headers: { ...headers, "x-csrf-token": "wrong" },
    payload,
  });
  assert.equal(csrf.statusCode, 403);
  const ended = await http.inject({
    method: "POST",
    url: "/api/commands/user.session.end-own",
    headers,
    payload,
  });
  assert.equal(ended.statusCode, 200);
  assert.equal(ended.json().sessionEnded, true);
  assert.match(String(ended.headers["set-cookie"]), /Max-Age=0/);
  assert.equal(
    (await http.inject({ url: "/api/security", headers })).statusCode,
    401,
  );
  const second = f.app.identity.login("admin@example.test", password);
  const replay = await http.inject({
    method: "POST",
    url: "/api/commands/user.session.end-own",
    headers: {
      ...headers,
      cookie: `distributor_session=${second.token}`,
      "x-csrf-token": second.csrf,
    },
    payload,
  });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json().sessionEnded, false);
  assert.equal(replay.headers["set-cookie"], undefined);
  assert.equal(f.app.identity.session(second.token).actor.id, f.actor.id);
  assert.equal(
    (
      await http.inject({
        url: "/api/dashboard",
        headers: { cookie: `distributor_session=${second.token}` },
      })
    ).statusCode,
    403,
  );
});

for (const eventReports of [false, true])
  test(`schema30 to31 preserves all session credentials and historical unknown metadata; reports=${eventReports}`, async (t) => {
    const f = fixture(t, { eventReports });
    const session = f.app.identity.login("admin@example.test", password);
    const source = f.path,
      target = join(dirname(source), "schema31.db");
    f.app.close();
    const db = new DatabaseSync(source);
    db.exec(
      "DROP TABLE iam_session_details; DROP TABLE iam_customer_minimum_orders",
    );
    const hash = schemaFingerprint(db);
    db.prepare(
      "UPDATE platform_schema_version SET version=30,schema_hash=?",
    ).run(hash);
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name<>'platform_schema_version' ORDER BY name",
      )
      .all()
      .map((r) => String(r.name));
    const rows = Object.fromEntries(
      tables.map((table) => [
        table,
        db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
      ]),
    );
    db.close();
    const bytes = readFileSync(source);
    assert.equal(inspectSchema(source).version, 30);
    assert.throws(
      () => new Application(source, "CA", { eventReports }),
      code("SCHEMA_UPGRADE_REQUIRED"),
    );
    const receipt = await upgradeSchema(source, target, hash, "CA");
    assert.equal(receipt.version, SCHEMA_VERSION);
    assert.equal(SCHEMA_VERSION, 32);
    assert.deepEqual(readFileSync(source), bytes);
    const migrated = new DatabaseSync(target);
    for (const table of tables)
      assert.deepEqual(
        migrated.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
        rows[table],
      );
    assert.deepEqual(migrated.prepare("PRAGMA foreign_key_check").all(), []);
    migrated.close();
    f.app = new Application(target, "CA", { eventReports });
    const detail = current(f, session.token);
    assert.match(detail.reference!, /^[a-f0-9]{32}$/);
    assert.equal(detail.createdAt, null);
    assert.equal(detail.lastActivityAt, null);
    assert.equal(detail.deviceDescription, null);
    assert.equal(
      f.app.identity.revokeOwnSession(
        f.actor,
        "old-current",
        { sessionReference: detail.reference!, currentPassword: password },
        session.token,
      ).sessionEnded,
      true,
    );
  });
