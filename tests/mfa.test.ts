import { test } from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { Application } from "../src/server/application.ts";
import {
  FactorCipher,
  encodeSecret,
  totp,
  matchingStep,
} from "../src/server/totp.ts";
import { createHttp } from "../src/server/http.ts";
import { createBackup, restoreBackup } from "../src/server/recovery.ts";
import { fixture } from "./fixtures.ts";
import { DomainError } from "../src/server/core.ts";
const encryptionKey = "a1".repeat(32),
  password = "long-test-only-password",
  email = "admin@example.test";
const config = { mfaEncryptionKey: encryptionKey };
function fail(code: string, run: () => unknown) {
  assert.throws(
    run,
    (e: unknown) => e instanceof DomainError && e.code === code,
  );
}
function begin(f: ReturnType<typeof fixture>, key = "setup") {
  return f.app.identity.mfa.begin(f.actor, key, {
    currentPassword: password,
    revision: f.app.identity.security(f.actor).revision,
  });
}
function activate(f: ReturnType<typeof fixture>) {
  const setup = begin(f),
    step = Math.floor(Date.now() / 30000);
  f.app.identity.mfa.confirm(f.actor, {
    currentPassword: password,
    enrollmentId: setup.enrollmentId,
    code: totp(setup.secret, step),
    recoverySaved: true,
  });
  return { ...setup, step };
}
test("TOTP agrees with all SHA-1 RFC 6238 vectors, bounded skew and forward-only replay policy", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  assert.equal(encodeSecret(Buffer.from("12345678901234567890")), secret);
  for (const [seconds, expected] of [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ] as const) {
    const step = Math.floor(seconds / 30);
    assert.equal(totp(secret, step, 8), expected);
    assert.equal(totp(secret, step), expected.slice(-6));
    assert.equal(
      matchingStep(secret, expected.slice(-6), seconds * 1000),
      step,
    );
    assert.equal(
      matchingStep(secret, expected.slice(-6), seconds * 1000, step),
      null,
    );
  }
  assert.equal(matchingStep(secret, totp(secret, 100), 101 * 30000), 100);
  assert.equal(matchingStep(secret, totp(secret, 102), 101 * 30000), 102);
  assert.equal(matchingStep(secret, totp(secret, 98), 101 * 30000), null);
  assert.equal(matchingStep(secret, "0000000", 101 * 30000), null);
});
test("factor encryption authenticates tenant/principal/purpose and refuses wrong keys/tampering", () => {
  fail("CONFIG", () => new FactorCipher("incorrect"));
  const cipher = new FactorCipher(encryptionKey),
    context = "tenant:user:factor",
    value = { secret: "PRIVATE" };
  const encrypted = cipher.encrypt(value, context);
  assert.ok(!encrypted.includes("PRIVATE"));
  assert.deepEqual(cipher.decrypt(encrypted, context), value);
  assert.notEqual(cipher.encrypt(value, context), encrypted);
  for (const wrong of [
    "tenant:other:factor",
    "other:user:factor",
    "tenant:user:pending",
  ])
    fail("MFA_UNAVAILABLE", () => cipher.decrypt(encrypted, wrong));
  fail("MFA_UNAVAILABLE", () =>
    new FactorCipher("b2".repeat(32)).decrypt(encrypted, context),
  );
  fail("MFA_UNAVAILABLE", () =>
    cipher.decrypt(encrypted.slice(0, -4) + "AAAA", context),
  );
});
test("enrollment defaults disabled and enrolled principals fail closed without the runtime key", (t) => {
  const f = fixture(t);
  assert.equal(f.app.identity.security(f.actor).mfa.available, false);
  fail("MFA_UNAVAILABLE", () => begin(f));
  f.app.close();
  f.app = new Application(f.path, "CA", config);
  activate(f);
  f.app.close();
  f.app = new Application(f.path);
  fail("MFA_UNAVAILABLE", () => f.app.identity.login(email, password));
  assert.equal(f.app.identity.security(f.actor).sessions, 0);
});
test("setup retries recover identical encrypted material; replacement, expiry and security revisions invalidate older setup", (t) => {
  const f = fixture(t, config),
    first = begin(f);
  assert.deepEqual(begin(f), first);
  assert.equal(
    f.app.platform
      .audits(f.actor)
      .filter((a) => a.action === "user.mfa.setup.started").length,
    1,
  );
  const store = f.app.database.owned("iam"),
    serialized = JSON.stringify(store.all("SELECT * FROM iam_mfa_pending"));
  assert.ok(!serialized.includes(first.secret));
  for (const code of first.recoveryCodes) assert.ok(!serialized.includes(code));
  const next = begin(f, "new-setup");
  assert.notEqual(next.secret, first.secret);
  fail("MFA_EXPIRED", () =>
    f.app.identity.mfa.confirm(f.actor, {
      currentPassword: password,
      enrollmentId: first.enrollmentId,
      code: totp(first.secret, Math.floor(Date.now() / 30000)),
      recoverySaved: true,
    }),
  );
  store.run("UPDATE iam_mfa_pending SET expires_at=?", Date.now() - 1);
  fail("MFA_EXPIRED", () => begin(f, "new-setup"));
  begin(f, "third-setup");
  f.app.identity.revokeSessions(f.actor, "change-revision", {
    userId: f.actor.id,
    revision: 1,
    currentPassword: password,
    reason: "Synthetic security change",
  });
  fail("MFA_EXPIRED", () =>
    f.app.identity.mfa.confirm(f.actor, {
      currentPassword: password,
      enrollmentId: store.get("SELECT enrollment_id FROM iam_mfa_pending")!
        .enrollment_id as string,
      code: "123456",
      recoverySaved: true,
    }),
  );
});
test("activation requires saved recovery codes, consumes verification code and ends every previous session", (t) => {
  const f = fixture(t, config),
    a = f.app.identity.login(email, password),
    b = f.app.identity.login(email, password),
    setup = begin(f),
    step = Math.floor(Date.now() / 30000),
    code = totp(setup.secret, step);
  fail("VALIDATION", () =>
    f.app.identity.mfa.confirm(f.actor, {
      currentPassword: password,
      enrollmentId: setup.enrollmentId,
      code,
      recoverySaved: false,
    }),
  );
  assert.equal(f.app.identity.security(f.actor).mfa.enabled, false);
  const result = f.app.identity.mfa.confirm(f.actor, {
    currentPassword: password,
    enrollmentId: setup.enrollmentId,
    code,
    recoverySaved: true,
  });
  assert.equal(result.sessionsEnded, 2);
  assert.equal(result.revision, 2);
  for (const token of [a.token, b.token])
    fail("UNAUTHENTICATED", () => f.app.identity.session(token));
  fail("MFA_REQUIRED", () => f.app.identity.login(email, password));
  fail("MFA_INVALID", () => f.app.identity.login(email, password, code));
  const session = f.app.identity.login(
    email,
    password,
    totp(setup.secret, step + 1),
  );
  assert.equal(session.actor.id, f.actor.id);
  fail("MFA_INVALID", () =>
    f.app.identity.login(email, password, totp(setup.secret, step + 1)),
  );
  assert.equal(f.app.identity.security(f.actor).sessions, 1);
});
test("recovery codes are individual single-use factors; audit/command projections contain no enrollment material", (t) => {
  const f = fixture(t, config),
    setup = activate(f);
  assert.equal(new Set(setup.recoveryCodes).size, 10);
  for (const code of setup.recoveryCodes)
    assert.match(code, /^[a-f0-9]{8}(?:-[a-f0-9]{8}){3}$/);
  const session = f.app.identity.login(
    email,
    password,
    setup.recoveryCodes[0]!.toUpperCase(),
  );
  assert.equal(session.actor.id, f.actor.id);
  fail("MFA_INVALID", () =>
    f.app.identity.login(email, password, setup.recoveryCodes[0]),
  );
  assert.equal(f.app.identity.security(f.actor).mfa.recoveryCodesRemaining, 9);
  f.app.close();
  f.app = new Application(f.path, "CA", config);
  fail("MFA_INVALID", () =>
    f.app.identity.login(email, password, setup.recoveryCodes[0]),
  );
  f.app.identity.login(email, password, setup.recoveryCodes[1]);
  const rows = JSON.stringify({
    audits: f.app.platform.audits(f.actor),
    commands: f.app.database
      .owned("platform")
      .all("SELECT * FROM platform_commands"),
    factors: f.app.database.owned("iam").all("SELECT * FROM iam_mfa"),
    recovery: f.app.database.owned("iam").all("SELECT * FROM iam_mfa_recovery"),
  });
  assert.ok(!rows.includes(setup.secret));
  for (const code of setup.recoveryCodes) assert.ok(!rows.includes(code));
  assert.equal(
    f.app.database.owned("iam").all("SELECT * FROM iam_mfa_pending").length,
    0,
  );
});
test("second-factor failures persist outside rollback and current-password reauthentication does not clear the factor throttle", (t) => {
  const f = fixture(t, config),
    setup = begin(f);
  for (let i = 0; i < 8; i++)
    fail("MFA_INVALID", () =>
      f.app.identity.mfa.confirm(f.actor, {
        currentPassword: password,
        enrollmentId: setup.enrollmentId,
        code: "invalid",
        recoverySaved: true,
      }),
    );
  assert.equal(
    f.app.database
      .owned("iam")
      .get("SELECT count FROM iam_attempts WHERE email=?", email)!.count,
    8,
  );
  fail("RATE_LIMIT", () =>
    f.app.identity.mfa.confirm(f.actor, {
      currentPassword: password,
      enrollmentId: setup.enrollmentId,
      code: totp(setup.secret, Math.floor(Date.now() / 30000)),
      recoverySaved: true,
    }),
  );
  assert.equal(f.app.identity.security(f.actor).mfa.enabled, false);
  f.app.database
    .owned("iam")
    .run("UPDATE iam_attempts SET reset_at=?", Date.now() - 1);
  f.app.identity.mfa.confirm(f.actor, {
    currentPassword: password,
    enrollmentId: setup.enrollmentId,
    code: totp(setup.secret, Math.floor(Date.now() / 30000)),
    recoverySaved: true,
  });
  for (let i = 0; i < 8; i++)
    fail("MFA_INVALID", () => f.app.identity.login(email, password, "invalid"));
  fail("RATE_LIMIT", () =>
    f.app.identity.login(email, password, setup.recoveryCodes[0]),
  );
});
test("password resets retain the factor, while authenticated removal consumes proof, advances revision and ends sessions", (t) => {
  const f = fixture(t, config),
    setup = activate(f);
  f.app.identity.resetPassword(f.actor, "reset-mfa", {
    userId: f.actor.id,
    revision: 2,
    password: "new-synthetic-test-password",
    currentPassword: password,
    reason: "Synthetic password reset",
  });
  fail("MFA_REQUIRED", () =>
    f.app.identity.login(email, "new-synthetic-test-password"),
  );
  const restricted = f.app.identity.login(
    email,
    "new-synthetic-test-password",
    setup.recoveryCodes[0],
  );
  assert.equal(restricted.passwordChangeRequired, true);
  fail("PASSWORD_CHANGE_REQUIRED", () =>
    f.app.identity.mfa.disable(restricted.actor, {
      currentPassword: "new-synthetic-test-password",
      code: setup.recoveryCodes[1]!,
      revision: 3,
    }),
  );
  f.app.identity.changePassword(restricted.actor, "change-mfa-password", {
    currentPassword: "new-synthetic-test-password",
    password,
  });
  const session = f.app.identity.login(email, password, setup.recoveryCodes[1]);
  const revision = f.app.identity.security(f.actor).revision;
  fail("STALE_USER", () =>
    f.app.identity.mfa.disable(f.actor, {
      currentPassword: password,
      code: setup.recoveryCodes[2]!,
      revision: revision - 1,
    }),
  );
  const result = f.app.identity.mfa.disable(session.actor, {
    currentPassword: password,
    code: setup.recoveryCodes[2]!,
    revision,
  });
  assert.equal(result.sessionsEnded, 1);
  assert.equal(result.revision, revision + 1);
  fail("UNAUTHENTICATED", () => f.app.identity.session(session.token));
  assert.equal(f.app.identity.security(f.actor).mfa.enabled, false);
  assert.equal(f.app.identity.login(email, password).actor.id, f.actor.id);
});
test("late audit errors roll back factor activation, removal and consumed login proof", (t) => {
  const f = fixture(t, config),
    setup = begin(f),
    step = Math.floor(Date.now() / 30000),
    original = f.app.platform.audit.bind(f.app.platform);
  f.app.platform.audit = (...args) => {
    if (
      ["user.mfa.enabled", "user.mfa.disabled", "session.login"].includes(
        args[1],
      )
    )
      throw new Error("Synthetic late audit fault");
    return original(...args);
  };
  assert.throws(
    () =>
      f.app.identity.mfa.confirm(f.actor, {
        currentPassword: password,
        enrollmentId: setup.enrollmentId,
        code: totp(setup.secret, step),
        recoverySaved: true,
      }),
    /late audit fault/,
  );
  assert.equal(f.app.identity.security(f.actor).mfa.enabled, false);
  f.app.platform.audit = original;
  f.app.identity.mfa.confirm(f.actor, {
    currentPassword: password,
    enrollmentId: setup.enrollmentId,
    code: totp(setup.secret, step),
    recoverySaved: true,
  });
  f.app.platform.audit = (...args) => {
    if (args[1] === "session.login" || args[1] === "user.mfa.disabled")
      throw new Error("Synthetic late audit fault");
    return original(...args);
  };
  assert.throws(
    () => f.app.identity.login(email, password, setup.recoveryCodes[0]),
    /late audit fault/,
  );
  assert.equal(f.app.identity.security(f.actor).mfa.recoveryCodesRemaining, 10);
  assert.throws(
    () =>
      f.app.identity.mfa.disable(f.actor, {
        currentPassword: password,
        code: setup.recoveryCodes[0]!,
        revision: 2,
      }),
    /late audit fault/,
  );
  assert.equal(f.app.identity.security(f.actor).mfa.enabled, true);
  assert.equal(f.app.identity.security(f.actor).mfa.recoveryCodesRemaining, 10);
  f.app.platform.audit = original;
  f.app.identity.login(email, password, setup.recoveryCodes[0]);
});
async function race(
  t: { after: (fn: () => void) => void },
  path: string,
  code: string,
  timestamp: number,
) {
  const children: ChildProcess[] = [],
    ready: Promise<void>[] = [],
    results: Promise<{ ok: boolean; code?: string }>[] = [];
  for (let i = 0; i < 2; i++) {
    const child = fork(new URL("./mfa-child.ts", import.meta.url), [], {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    children.push(child);
    let readyResolve: () => void,
      resolve: (result: any) => void,
      reject: (error: Error) => void;
    ready.push(
      new Promise((r) => {
        readyResolve = r;
      }),
    );
    results.push(
      new Promise((r, j) => {
        resolve = r;
        reject = j;
      }),
    );
    let stderr = "";
    child.stderr?.on("data", (d) => {
      stderr += d;
    });
    child.on("message", (m: any) => {
      if (m.ready) readyResolve();
      else resolve(m);
    });
    child.on("error", (e) => reject(e));
    child.on("exit", (c) => {
      if (c !== 0) reject(new Error(stderr));
    });
    child.send({
      action: "init",
      input: { path, key: encryptionKey, email, password, code, timestamp },
    });
  }
  t.after(() => children.forEach((c) => c.kill()));
  await Promise.all(ready);
  children.forEach((c) => c.send({ action: "go" }));
  return Promise.all(results);
}
test(
  "separate processes issue only one session for the same authenticator or recovery code",
  { timeout: 15000 },
  async (t) => {
    const f = fixture(t, config),
      setup = activate(f),
      timestamp = (setup.step + 1) * 30000;
    for (const code of [
      totp(setup.secret, setup.step + 1),
      setup.recoveryCodes[0]!,
    ]) {
      const results = await race(t, f.path, code, timestamp);
      assert.equal(results.filter((r) => r.ok).length, 1);
      assert.equal(results.find((r) => !r.ok)!.code, "MFA_INVALID");
    }
    assert.equal(f.app.identity.security(f.actor).sessions, 2);
    assert.equal(
      f.app.identity.security(f.actor).mfa.recoveryCodesRemaining,
      9,
    );
  },
);
test("restore invalidates pending enrollment, old recovery codes and current-window authenticator proofs", async (t) => {
  const f = fixture(t, config),
    setup = activate(f),
    key = randomBytes(32),
    archive = join(dirname(f.path), "mfa.distributor-backup"),
    restored = join(dirname(f.path), "mfa-restored.db");
  f.app.identity.login(email, password, setup.recoveryCodes[0]);
  const pendingUser = f.app.identity.createUser(
    f.actor,
    "pending-factor-user",
    {
      name: "Pending authenticator user",
      email: "pending-mfa@example.test",
      password,
      role: "warehouse",
      sites: [f.w1],
    },
  ).id;
  const pendingActor = f.app.identity.login(
    "pending-mfa@example.test",
    password,
  ).actor;
  f.app.identity.mfa.begin(pendingActor, "pending-before-restore", {
    currentPassword: password,
    revision: 1,
  });
  assert.equal(
    f.app.database
      .owned("iam")
      .get("SELECT user_id FROM iam_mfa_pending WHERE user_id=?", pendingUser)!
      .user_id,
    pendingUser,
  );
  await createBackup(f.path, archive, "CA", key);
  await restoreBackup(archive, restored, "CA", key);
  const app = new Application(restored, "CA", config);
  t.after(() => app.close());
  assert.equal(app.identity.security(f.actor).mfa.enabled, true);
  assert.equal(app.identity.security(f.actor).mfa.recoveryCodesRemaining, 0);
  fail("MFA_INVALID", () =>
    app.identity.login(email, password, setup.recoveryCodes[1]),
  );
  fail("MFA_INVALID", () =>
    app.identity.login(email, password, totp(setup.secret, setup.step + 1)),
  );
  assert.equal(app.identity.security(f.actor).sessions, 0);
  assert.equal(
    app.database.owned("iam").all("SELECT * FROM iam_mfa_pending").length,
    0,
  );
});
test("HTTP factor routes require current session, origin/CSRF, strict fields and completed password change; password alone never issues a factor session", async (t) => {
  const f = fixture(t, config),
    origin = "http://localhost",
    http = await createHttp(f.app, { origin, staticRoot: "/not-present" });
  t.after(() => http.close());
  const initial = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: { email, password },
  });
  const headers = {
    origin,
    cookie: String(initial.headers["set-cookie"]).split(";")[0]!,
    "x-csrf-token": initial.json().csrf,
  };
  const payload = { currentPassword: password, revision: 1, key: "http-setup" };
  f.app.identity.createUser(f.actor, "forced-mfa-user", {
    name: "Forced password change user",
    email: "forced-mfa@example.test",
    password,
    role: "warehouse",
    sites: [f.w1],
    requirePasswordChange: true,
  });
  const forced = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: { email: "forced-mfa@example.test", password },
  });
  const deniedSetup = await http.inject({
    method: "POST",
    url: "/api/security/mfa/setup",
    headers: {
      origin,
      cookie: String(forced.headers["set-cookie"]).split(";")[0]!,
      "x-csrf-token": forced.json().csrf,
    },
    payload,
  });
  assert.equal(deniedSetup.statusCode, 403);
  assert.equal(deniedSetup.json().code, "PASSWORD_CHANGE_REQUIRED");

  for (const invalidHeaders of [
    { ...headers, origin: "http://wrong" },
    { ...headers, "x-csrf-token": "wrong" },
    { origin },
  ]) {
    const denied = await http.inject({
      method: "POST",
      url: "/api/security/mfa/setup",
      headers: invalidHeaders,
      payload,
    });
    assert.ok([401, 403].includes(denied.statusCode));
  }
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: "/api/security/mfa/setup",
        headers,
        payload: { ...payload, userId: f.actor.id },
      })
    ).statusCode,
    400,
  );
  const setup = (
    await http.inject({
      method: "POST",
      url: "/api/security/mfa/setup",
      headers,
      payload,
    })
  ).json();
  const confirmed = await http.inject({
    method: "POST",
    url: "/api/security/mfa/confirm",
    headers,
    payload: {
      currentPassword: password,
      enrollmentId: setup.enrollmentId,
      code: totp(setup.secret, Math.floor(Date.now() / 30000)),
      recoverySaved: true,
    },
  });
  assert.equal(confirmed.statusCode, 200);
  assert.ok(confirmed.headers["set-cookie"]);
  assert.equal(
    (await http.inject({ url: "/api/dashboard", headers })).statusCode,
    401,
  );
  const required = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: { email, password },
  });
  assert.equal(required.statusCode, 401);
  assert.equal(required.json().code, "MFA_REQUIRED");
  assert.equal(required.headers["set-cookie"], undefined);
  assert.equal(required.json().actor, undefined);
  const wrongPassword = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: { email, password: "incorrect", code: setup.recoveryCodes[0] },
  });
  assert.equal(wrongPassword.json().code, "LOGIN");
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: { email, password, code: setup.recoveryCodes[0] },
  });
  assert.equal(login.statusCode, 200);
  assert.equal(login.json().actor.id, f.actor.id);
  fail("FORBIDDEN", () =>
    f.app.identity.mfa.begin(
      { ...f.actor, orgId: "foreign" },
      "foreign",
      payload,
    ),
  );
});
