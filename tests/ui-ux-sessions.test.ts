import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { digest, DomainError } from "../src/server/core.ts";
import { createHttp } from "../src/server/http.ts";
import { Store } from "../src/server/database.ts";
import { SessionList } from "../src/web/session-list.tsx";
import { fixture } from "./fixtures.ts";

const password = "long-test-only-password";
const origin = "http://localhost";

test("native security summary does not materialize session rows before business preflight", (t) => {
  const f = fixture(t);
  f.app.identity.login("admin@example.test", password);
  const all = t.mock.method(Store.prototype, "all");
  const summary = f.app.identity.security(f.actor);
  assert.equal(summary.sessions, 1);
  assert.equal(summary.passwordChangeRequired, false);
  assert.equal(all.mock.calls.length, 0);
  assert.equal(summary.sessionDetails, undefined);
});

test("self-scoped sessions exclude other users, organizations and expiry without exposing credentials", (t) => {
  const f = fixture(t);
  const store = f.app.database.owned("iam");
  const first = f.app.identity.login("admin@example.test", password);
  const second = f.app.identity.login("admin@example.test", password);
  const expiry = Date.now() + 60000;
  store.run("UPDATE iam_sessions SET expires_at=?", expiry);
  store.run(
    "INSERT INTO iam_sessions VALUES(?,?,?,?)",
    digest("expired-own-session"),
    f.actor.id,
    "expired-own-csrf",
    Date.now() - 1,
  );
  const otherId = f.app.identity.createUser(f.actor, "other-user", {
    email: "other-user@example.test",
    name: "Other synthetic user",
    password,
    role: "warehouse",
    sites: [f.w1],
  }).id;
  const other = f.app.identity.login("other-user@example.test", password);
  store.run(
    "INSERT INTO iam_organizations VALUES(?,?,?,?,?)",
    "foreign-org",
    "Foreign synthetic organization",
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
  store.run(
    "INSERT INTO iam_sessions VALUES(?,?,?,?)",
    digest("foreign-session"),
    "foreign-user",
    "foreign-csrf",
    expiry,
  );
  const before = store.all("SELECT * FROM iam_sessions ORDER BY hash");
  const security = f.app.identity.security(f.actor, first.token);
  assert.equal(security.sessions, 2);
  assert.ok(security.sessionDetails);
  assert.deepEqual(
    security.sessionDetails.map((session) => session.label),
    ["Session 1", "Session 2"],
  );
  assert.ok(
    security.sessionDetails.every((session) => session.expiresAt === expiry),
  );
  assert.equal(
    security.sessionDetails.filter((session) => session.current).length,
    1,
  );
  for (const session of security.sessionDetails)
    assert.deepEqual(Object.keys(session).sort(), [
      "current",
      "expiresAt",
      "label",
    ]);
  const serialized = JSON.stringify(security);
  for (const secret of [
    first.token,
    second.token,
    first.csrf,
    second.csrf,
    other.token,
    other.csrf,
    digest(first.token),
    digest(second.token),
    "foreign-csrf",
    digest("foreign-session"),
    "expired-own-csrf",
    otherId,
    "foreign-user",
    "foreign@example.test",
  ])
    assert.ok(
      !serialized.includes(secret),
      "Session projection leaked private data",
    );
  assert.deepEqual(
    store.all("SELECT * FROM iam_sessions ORDER BY hash"),
    before,
  );
  assert.deepEqual(f.app.identity.security(f.actor, first.token), security);
  const switched = f.app.identity.security(f.actor, second.token);
  assert.ok(switched.sessionDetails);
  assert.deepEqual(
    switched.sessionDetails.map((session) => session.expiresAt),
    [expiry, expiry],
  );
  assert.notDeepEqual(
    switched.sessionDetails.map((session) => session.current),
    security.sessionDetails.map((session) => session.current),
  );
  for (const token of [other.token, "foreign-session", "expired-own-session"])
    assert.ok(
      f.app.identity
        .security(f.actor, token)
        .sessionDetails?.every((session) => !session.current),
    );
  assert.equal(f.app.identity.security(other.actor, other.token).sessions, 1);
});

test("session list refuses unavailable or forged organization principals", (t) => {
  const f = fixture(t);
  const store = f.app.database.owned("iam");
  f.app.identity.login("admin@example.test", password);
  assert.throws(
    () => f.app.identity.security({ ...f.actor, orgId: "another-org" }),
    (error) => error instanceof DomainError && error.code === "FORBIDDEN",
  );
  store.run("UPDATE iam_users SET active=0 WHERE id=?", f.actor.id);
  assert.throws(
    () => f.app.identity.security(f.actor),
    (error) => error instanceof DomainError && error.code === "FORBIDDEN",
  );
});

test("HTTP session details use only the authenticated actor and exact request session", async (t) => {
  const f = fixture(t);
  const http = await createHttp(f.app, { origin });
  t.after(() => http.close());
  const first = f.app.identity.login("admin@example.test", password);
  const second = f.app.identity.login("admin@example.test", password);
  const cookie = `distributor_session=${first.token}`;
  for (const url of [
    "/api/security",
    "/api/security?userId=foreign-user&orgId=foreign-org&token=wrong",
  ]) {
    const response = await http.inject({ url, headers: { cookie } });
    assert.equal(response.statusCode, 200);
    const security = response.json();
    assert.equal(security.id, f.actor.id);
    assert.equal(security.sessions, 2);
    assert.equal(
      security.sessionDetails.filter(
        (session: { current: boolean }) => session.current,
      ).length,
      1,
    );
    for (const secret of [
      first.token,
      second.token,
      first.csrf,
      second.csrf,
      digest(first.token),
    ])
      assert.ok(!response.body.includes(secret));
  }
  for (const headers of [{}, { cookie: "distributor_session=invalid" }]) {
    const response = await http.inject({ url: "/api/security", headers });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().code, "UNAUTHENTICATED");
    assert.equal(response.json().sessionDetails, undefined);
  }
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_sessions SET expires_at=? WHERE hash=?",
      Date.now() - 1,
      digest(first.token),
    );
  assert.equal(
    (await http.inject({ url: "/api/security", headers: { cookie } }))
      .statusCode,
    401,
  );
  const active = await http.inject({
    url: "/api/security",
    headers: { cookie: `distributor_session=${second.token}` },
  });
  assert.equal(active.json().sessions, 1);
  assert.equal(active.json().sessionDetails[0].current, true);
});

test("bulk ending still revokes all own sessions while preserving another user's sessions and CSRF", async (t) => {
  const f = fixture(t);
  const http = await createHttp(f.app, { origin });
  t.after(() => http.close());
  const first = f.app.identity.login("admin@example.test", password);
  const second = f.app.identity.login("admin@example.test", password);
  f.app.identity.createUser(f.actor, "warehouse-user", {
    email: "warehouse@example.test",
    name: "Warehouse user",
    password,
    role: "warehouse",
    sites: [f.w1],
  });
  const other = f.app.identity.login("warehouse@example.test", password);
  const headers = {
    origin,
    cookie: `distributor_session=${first.token}`,
    "x-csrf-token": first.csrf,
    "idempotency-key": "end-all",
  };
  const refused = await http.inject({
    method: "POST",
    url: "/api/commands/user.sessions.end-own",
    headers: { ...headers, "x-csrf-token": "wrong" },
    payload: {},
  });
  assert.equal(refused.statusCode, 403);
  assert.equal(refused.json().code, "CSRF");
  assert.equal(f.app.identity.security(f.actor).sessions, 2);
  const ended = await http.inject({
    method: "POST",
    url: "/api/commands/user.sessions.end-own",
    headers,
    payload: {},
  });
  assert.equal(ended.statusCode, 200);
  assert.equal(ended.json().sessionsEnded, 2);
  assert.equal(ended.json().sessionEnded, true);
  assert.match(String(ended.headers["set-cookie"]), /Max-Age=0/);
  assert.deepEqual(
    f.app.identity.security(f.actor, first.token).sessionDetails,
    [],
  );
  for (const token of [first.token, second.token])
    assert.throws(
      () => f.app.identity.session(token),
      (error) =>
        error instanceof DomainError && error.code === "UNAUTHENTICATED",
    );
  assert.equal(f.app.identity.session(other.token).actor.id, other.actor.id);
});

test("required MFA and initial-password restrictions still allow only own security reads and existing recovery actions", async (t) => {
  const f = fixture(t, {
    mfaEncryptionKey: "a1".repeat(32),
    mfaRequiredRoles: ["admin"],
  });
  const http = await createHttp(f.app, { origin });
  t.after(() => http.close());
  const session = f.app.identity.login("admin@example.test", password);
  const headers = { cookie: `distributor_session=${session.token}` };
  const security = await http.inject({ url: "/api/security", headers });
  assert.equal(security.statusCode, 200);
  assert.equal(security.json().mfa.required, true);
  assert.equal(security.json().sessionDetails[0].current, true);
  const denied = await http.inject({ url: "/api/users", headers });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.json().code, "MFA_ENROLLMENT_REQUIRED");
  f.app.database
    .owned("iam")
    .run(
      "INSERT INTO iam_user_security VALUES(?,?,?,?)",
      f.actor.id,
      1,
      1,
      new Date().toISOString(),
    );
  const passwordSecurity = await http.inject({ url: "/api/security", headers });
  assert.equal(passwordSecurity.statusCode, 200);
  assert.equal(passwordSecurity.json().passwordChangeRequired, true);
  assert.equal(passwordSecurity.json().sessionDetails[0].current, true);
  const passwordDenied = await http.inject({ url: "/api/dashboard", headers });
  assert.equal(passwordDenied.statusCode, 403);
  assert.equal(passwordDenied.json().code, "PASSWORD_CHANGE_REQUIRED");
});

test("session UI distinguishes current sessions, exposes semantic expiry and states metadata limits honestly", () => {
  const expiresAt = Date.UTC(2026, 9, 7, 12, 30);
  const html = renderToStaticMarkup(
    React.createElement(SessionList, {
      sessions: [
        { label: "Session 1", expiresAt, current: false },
        { label: "Session 2", expiresAt, current: true },
      ],
    }),
  );
  assert.match(html, /aria-label="Your active sessions"/);
  assert.equal((html.match(/This session/g) ?? []).length, 1);
  assert.equal(
    (html.match(/dateTime="2026-10-07T12:30:00.000Z"/g) ?? []).length,
    2,
  );
  assert.match(html, /Device, location and last activity are not recorded/);
  assert.match(html, /may change when the list changes/);
  assert.ok(!html.includes("button"));
  assert.match(
    renderToStaticMarkup(React.createElement(SessionList, { sessions: [] })),
    /No active sessions/,
  );
  assert.match(
    renderToStaticMarkup(React.createElement(SessionList)),
    /Session details are unavailable/,
  );
});
