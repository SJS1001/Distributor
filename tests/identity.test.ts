import { test } from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { fixture } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import { DomainError, type Actor, type Role } from "../src/server/core.ts";
const password = "long-test-only-password",
  changed = "changed-synthetic-password";
function user(
  f: ReturnType<typeof fixture>,
  email = "worker@example.test",
  role: Role = "warehouse",
) {
  return f.app.identity.createUser(f.actor, email, {
    email,
    name: email.split("@")[0]!,
    password,
    role,
    sites: [f.w1],
    ...(role === "buyer" ? { accountId: f.buyer } : {}),
  }).id;
}
function update(f: ReturnType<typeof fixture>, userId: string) {
  const u = f.app.identity.users(f.actor).find((u) => u.id === userId)!;
  return {
    userId,
    revision: u.revision as number,
    name: String(u.name),
    email: String(u.email),
    role: u.role as Role,
    sites: u.sites as string[],
    active: u.active,
    ...(u.accountId ? { accountId: String(u.accountId) } : {}),
    currentPassword: password,
    reason: "Synthetic operator access review",
  };
}
function fails(code: string, fn: () => unknown) {
  assert.throws(
    fn,
    (e: unknown) => e instanceof DomainError && e.code === code,
  );
}
test("access revisions, all-session invalidation, deactivation/reactivation, restart and historical retries", (t) => {
  const f = fixture(t),
    uid = user(f),
    a = f.app.identity.login("worker@example.test", password),
    b = f.app.identity.login("worker@example.test", password);
  const payload = {
    ...update(f, uid),
    role: "finance" as const,
    sites: [f.w2],
  };
  const saved = f.app.identity.updateUser(f.actor, "review", payload);
  assert.equal(saved.revision, 2);
  assert.equal(saved.sessionsEnded, 2);
  for (const token of [a.token, b.token])
    fails("UNAUTHENTICATED", () => f.app.identity.session(token));
  assert.deepEqual(
    f.app.identity.updateUser(f.actor, "review", payload),
    saved,
  );
  fails("STALE_USER", () =>
    f.app.identity.updateUser(f.actor, "stale", payload),
  );
  fails("IDEMPOTENCY_CONFLICT", () =>
    f.app.identity.updateUser(f.actor, "review", {
      ...payload,
      name: "Changed input",
    }),
  );
  const session = f.app.identity.login("worker@example.test", password);
  assert.equal(session.actor.role, "finance");
  assert.deepEqual(session.actor.sites, [f.w2]);
  f.app.identity.updateUser(f.actor, "deactivate", {
    ...update(f, uid),
    active: false,
  });
  fails("LOGIN", () => f.app.identity.login("worker@example.test", password));
  fails("UNAUTHENTICATED", () => f.app.identity.session(session.token));
  assert.equal(
    f.app.identity.users(f.actor).find((u) => u.id === uid)!.active,
    false,
  );
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(
    f.app.identity.updateUser(f.actor, "review", payload),
    saved,
  );
  f.app.identity.updateUser(f.actor, "reactivate", {
    ...update(f, uid),
    active: true,
  });
  assert.equal(
    f.app.identity.login("worker@example.test", password).actor.role,
    "finance",
  );
  const reviews = f.app.platform
    .audits(f.actor)
    .filter((a) => a.action === "user.access.changed" && a.reference === uid);
  assert.equal(reviews.length, 3);
  assert.equal(f.app.orders.list(f.actor).length, 0);
});
test("current administrator and organization/site/account scope apply before cached user receipts", (t) => {
  const f = fixture(t),
    uid = user(f),
    payload = update(f, uid);
  f.app.identity.updateUser(f.actor, "change", payload);
  fails("NOT_FOUND", () =>
    f.app.identity.updateUser(f.actor, "foreign-user", {
      ...update(f, uid),
      userId: "other-tenant",
    }),
  );
  fails("NOT_FOUND", () =>
    f.app.identity.updateUser(f.actor, "foreign-site", {
      ...update(f, uid),
      sites: ["other-tenant-site"],
    }),
  );
  fails("NOT_FOUND", () =>
    f.app.identity.updateUser(f.actor, "foreign-account", {
      ...update(f, uid),
      role: "buyer",
      accountId: "other-tenant-account",
    }),
  );
  fails("VALIDATION", () =>
    f.app.identity.updateUser(f.actor, "duplicate-site", {
      ...update(f, uid),
      sites: [f.w1, f.w1],
    }),
  );
  const warehouseActor = f.app.identity.login(
    "worker@example.test",
    password,
  ).actor;
  fails("FORBIDDEN", () => f.app.identity.users(warehouseActor));
  fails("FORBIDDEN", () =>
    f.app.identity.updateUser(warehouseActor, "change", payload),
  );
  const alternate = user(f, "second-admin@example.test", "admin");
  f.app.identity.updateUser(f.actor, "demote", {
    ...update(f, f.actor.id),
    role: "support",
  });
  fails("FORBIDDEN", () =>
    f.app.identity.updateUser(f.actor, "change", payload),
  );
  fails("FORBIDDEN", () =>
    f.app.identity.createUser(f.actor, "worker@example.test", {
      email: "worker@example.test",
      name: "worker",
      password,
      role: "warehouse",
      sites: [f.w1],
    }),
  );
  assert.equal(
    f.app.identity.login("second-admin@example.test", password).actor.id,
    alternate,
  );
});
test("last active administrator survives failed deactivation, demotion and invalid changes", (t) => {
  const f = fixture(t),
    before = update(f, f.actor.id);
  fails("LAST_ADMIN", () =>
    f.app.identity.updateUser(f.actor, "disable-last", {
      ...before,
      active: false,
    }),
  );
  fails("LAST_ADMIN", () =>
    f.app.identity.updateUser(f.actor, "demote-last", {
      ...before,
      role: "finance",
    }),
  );
  assert.equal(f.app.identity.security(f.actor).revision, 1);
  assert.equal(
    f.app.identity.users(f.actor).filter((u) => u.active && u.role === "admin")
      .length,
    1,
  );
  const uid = user(f);
  fails("EMAIL_IN_USE", () =>
    f.app.identity.updateUser(f.actor, "duplicate-email", {
      ...update(f, uid),
      email: "ADMIN@EXAMPLE.TEST",
    }),
  );
  assert.equal(
    f.app.identity.users(f.actor).find((u) => u.id === uid)!.revision,
    1,
  );
});
test("password reset/change revoke sessions, force change, reject reuse and redact credentials from durable receipts", (t) => {
  const f = fixture(t),
    uid = user(f, "finance@example.test", "finance"),
    a = f.app.identity.login("finance@example.test", password),
    b = f.app.identity.login("finance@example.test", password);
  const reset = {
    userId: uid,
    revision: 1,
    currentPassword: password,
    password: "reset-synthetic-password",
    reason: "Synthetic administrator reset",
  };
  const saved = f.app.identity.resetPassword(f.actor, "reset", reset);
  assert.equal(saved.sessionsEnded, 2);
  assert.equal(saved.passwordChangeRequired, true);
  assert.deepEqual(
    f.app.identity.resetPassword(f.actor, "reset", reset),
    saved,
  );
  for (const token of [a.token, b.token])
    fails("UNAUTHENTICATED", () => f.app.identity.session(token));
  fails("LOGIN", () => f.app.identity.login("finance@example.test", password));
  const pending = f.app.identity.login("finance@example.test", reset.password);
  assert.equal(pending.passwordChangeRequired, true);
  fails("PASSWORD_CHANGE_REQUIRED", () =>
    f.app.identity.workerActor(f.actor.orgId, uid),
  );
  fails("PASSWORD_UNCHANGED", () =>
    f.app.identity.changePassword(pending.actor, "reuse", {
      currentPassword: reset.password,
      password: reset.password,
    }),
  );
  fails("REAUTHENTICATE", () =>
    f.app.identity.changePassword(pending.actor, "bad-old", {
      currentPassword: "incorrect-password",
      password: changed,
    }),
  );
  const result = f.app.identity.changePassword(pending.actor, "change", {
    currentPassword: reset.password,
    password: changed,
  });
  assert.equal(result.sessionsEnded, 1);
  assert.equal(result.sessionEnded, true);
  fails("UNAUTHENTICATED", () => f.app.identity.session(pending.token));
  const newSession = f.app.identity.login("finance@example.test", changed);
  assert.equal(newSession.passwordChangeRequired, false);
  assert.equal(f.app.identity.workerActor(f.actor.orgId, uid).role, "finance");
  const rows =
    JSON.stringify(
      f.app.database.owned("platform").all("SELECT * FROM platform_commands"),
    ) +
    JSON.stringify(f.app.platform.audits(f.actor)) +
    JSON.stringify(f.app.identity.users(f.actor));
  for (const secret of [
    password,
    changed,
    reset.password,
    a.token,
    newSession.token,
    newSession.csrf,
  ])
    assert.equal(rows.includes(secret), false);
  assert.equal(rows.includes("password_hash"), false);
  assert.equal(rows.includes('"salt"'), false);
});
test("denied password reauthentication persists throttling outside command rollback and cannot mutate access", (t) => {
  const f = fixture(t),
    uid = user(f),
    input = update(f, uid);
  for (let i = 0; i < 8; i++)
    fails("REAUTHENTICATE", () =>
      f.app.identity.updateUser(f.actor, `guess-${i}`, {
        ...input,
        currentPassword: "incorrect-password",
      }),
    );
  fails("RATE_LIMIT", () => f.app.identity.updateUser(f.actor, "ninth", input));
  fails("RATE_LIMIT", () =>
    f.app.identity.login("admin@example.test", password),
  );
  assert.equal(
    f.app.identity.users(f.actor).find((u) => u.id === uid)!.revision,
    1,
  );
  f.app.database
    .owned("iam")
    .run("UPDATE iam_attempts SET reset_at=?", Date.now() - 1);
  assert.equal(f.app.identity.updateUser(f.actor, "valid", input).revision, 2);
});
test("late audit faults atomically roll back password, session revocation, revision and command receipt", (t) => {
  const f = fixture(t),
    uid = user(f),
    session = f.app.identity.login("worker@example.test", password);
  const original = f.app.platform.audit.bind(f.app.platform);
  f.app.platform.audit = (actor, action, ref, detail) => {
    if (action === "user.password.reset")
      throw new Error("Synthetic final receipt fault");
    original(actor, action, ref, detail);
  };
  const payload = {
    userId: uid,
    revision: 1,
    password: changed,
    currentPassword: password,
    reason: "Synthetic rollback case",
  };
  assert.throws(
    () => f.app.identity.resetPassword(f.actor, "reset", payload),
    /Synthetic final receipt fault/,
  );
  assert.equal(f.app.identity.session(session.token).actor.id, uid);
  assert.equal(
    f.app.identity.users(f.actor).find((u) => u.id === uid)!.revision,
    1,
  );
  assert.equal(
    f.app.identity.login("worker@example.test", password).actor.id,
    uid,
  );
  assert.equal(
    f.app.platform
      .audits(f.actor)
      .filter((a) => String(a.action).startsWith("user.password.reset")).length,
    0,
  );
  f.app.platform.audit = original;
  assert.equal(
    f.app.identity.resetPassword(f.actor, "reset", payload).revision,
    2,
  );
  fails("UNAUTHENTICATED", () => f.app.identity.session(session.token));
});
test("HTTP requires reauthentication/CSRF, blocks initial-password workspace access and clears changed-session cookie", async (t) => {
  const f = fixture(t),
    http = await createHttp(f.app, { origin: "http://localhost" });
  t.after(() => http.close());
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin: "http://localhost" },
    payload: { email: "admin@example.test", password },
  });
  const adminHeaders = {
    cookie: login.headers["set-cookie"]!.toString().split(";")[0]!,
    origin: "http://localhost",
    "x-csrf-token": login.json().csrf,
    "idempotency-key": "create",
  };
  const payload = {
    email: "new@example.test",
    name: "New user",
    password,
    role: "buyer",
    sites: [],
    accountId: f.buyer,
  };
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: "/api/commands/user.create",
        headers: adminHeaders,
        payload,
      })
    ).statusCode,
    400,
  );
  const create = await http.inject({
    method: "POST",
    url: "/api/commands/user.create",
    headers: adminHeaders,
    payload: { ...payload, currentPassword: password },
  });
  assert.equal(create.statusCode, 200);
  const signIn = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin: "http://localhost" },
    payload: { email: payload.email, password },
  });
  const headers = {
    cookie: signIn.headers["set-cookie"]!.toString().split(";")[0]!,
    origin: "http://localhost",
    "x-csrf-token": signIn.json().csrf,
    "idempotency-key": "change",
  };
  assert.equal(signIn.json().passwordChangeRequired, true);
  for (const url of [
    "/api/dashboard",
    "/api/users",
    "/api/billing/aging?asOf=2026-09-30",
  ]) {
    const response = await http.inject({ url, headers });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().code, "PASSWORD_CHANGE_REQUIRED");
  }
  assert.equal(
    (await http.inject({ url: "/api/security", headers })).json().sessions,
    1,
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: "/api/commands/user.password.change",
        headers: { ...headers, "x-csrf-token": "incorrect" },
        payload: { currentPassword: password, password: changed },
      })
    ).statusCode,
    403,
  );
  const response = await http.inject({
    method: "POST",
    url: "/api/commands/user.password.change",
    headers,
    payload: { currentPassword: password, password: changed },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().sessionEnded, true);
  assert.match(String(response.headers["set-cookie"]), /Expires=/);
  assert.equal(
    (await http.inject({ url: "/api/session", headers })).statusCode,
    401,
  );
  const next = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin: "http://localhost" },
    payload: { email: payload.email, password: changed },
  });
  const nextHeaders = {
    ...headers,
    cookie: next.headers["set-cookie"]!.toString().split(";")[0]!,
    "x-csrf-token": next.json().csrf,
  };
  assert.equal(next.json().passwordChangeRequired, false);
  assert.equal(
    (await http.inject({ url: "/api/users", headers: nextHeaders })).statusCode,
    403,
  );
  assert.equal(
    (await http.inject({ url: "/api/dashboard", headers: nextHeaders }))
      .statusCode,
    200,
  );
  const ended = await http.inject({
    method: "POST",
    url: "/api/commands/user.sessions.end-own",
    headers: nextHeaders,
    payload: {},
  });
  assert.equal(ended.json().sessionsEnded, 1);
  assert.equal(
    (await http.inject({ url: "/api/session", headers: nextHeaders }))
      .statusCode,
    401,
  );
});
async function contend(
  t: { after: (fn: () => void) => void },
  f: ReturnType<typeof fixture>,
  inputs: { actor: Actor; payload: ReturnType<typeof update>; key: string }[],
) {
  const children: ChildProcess[] = [],
    ready: Promise<void>[] = [],
    results: Promise<{ ok: boolean; code?: string; result?: unknown }>[] = [];
  for (const input of inputs) {
    const child = fork(new URL("./identity-child.ts", import.meta.url), [], {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    children.push(child);
    let resolveReady: () => void,
      resolveResult: (r: any) => void,
      reject: (e: Error) => void;
    ready.push(new Promise<void>((r) => (resolveReady = r)));
    results.push(
      new Promise((r, j) => {
        resolveResult = r;
        reject = j;
      }),
    );
    let stderr = "";
    child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
    child.on("message", (m: any) =>
      m.ready ? resolveReady() : resolveResult(m),
    );
    child.on("error", (e) => reject(e));
    child.on("exit", (code) => {
      if (code !== 0) reject(new Error(`Identity process ${code}: ${stderr}`));
    });
    child.send({ action: "init", input: { ...input, path: f.path } });
  }
  t.after(() => children.forEach((c) => c.kill()));
  await Promise.all(ready);
  children.forEach((c) => c.send({ action: "go" }));
  return Promise.all(results);
}
test(
  "separate administrators cannot disable each other and leave an organization without an active administrator",
  { timeout: 15000 },
  async (t) => {
    const f = fixture(t),
      secondId = user(f, "second@example.test", "admin"),
      second = f.app.identity.login("second@example.test", password).actor;
    const results = await contend(t, f, [
      {
        actor: f.actor,
        payload: { ...update(f, secondId), active: false },
        key: "disable-second",
      },
      {
        actor: second,
        payload: { ...update(f, f.actor.id), active: false },
        key: "disable-first",
      },
    ]);
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(results.find((r) => !r.ok)?.code, "FORBIDDEN");
    const active = f.app.database
      .owned("iam")
      .all("SELECT id FROM iam_users WHERE active=1 AND role='admin'");
    assert.equal(active.length, 1);
    assert.equal(
      f.app.database
        .owned("platform")
        .all("SELECT * FROM platform_commands WHERE name='user.update'").length,
      1,
    );
  },
);
test(
  "separate process retries commit one access revision and one session invalidation receipt",
  { timeout: 15000 },
  async (t) => {
    const f = fixture(t),
      uid = user(f),
      session = f.app.identity.login("worker@example.test", password),
      input = {
        actor: f.actor,
        payload: { ...update(f, uid), sites: [f.w2] },
        key: "shared-review",
      };
    const results = await contend(t, f, [input, input]);
    assert.ok(results.every((r) => r.ok));
    assert.deepEqual(results[0]?.result, results[1]?.result);
    assert.equal(
      f.app.identity.users(f.actor).find((u) => u.id === uid)!.revision,
      2,
    );
    fails("UNAUTHENTICATED", () => f.app.identity.session(session.token));
    assert.equal(
      f.app.platform
        .audits(f.actor)
        .filter((a) => a.action === "user.access.changed").length,
      1,
    );
  },
);
