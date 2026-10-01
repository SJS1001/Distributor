import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Application } from "../src/server/application.ts";
import { configuredMfaRoles } from "../src/server/mfa-policy.ts";
import { createHttp } from "../src/server/http.ts";
import { totp } from "../src/server/totp.ts";
import { DomainError, type Role } from "../src/server/core.ts";
import { fixture } from "./fixtures.ts";
const key = "a1".repeat(32),
  password = "long-test-only-password",
  email = "admin@example.test";
const denied = (code: string, run: () => unknown) =>
  assert.throws(run, (e) => e instanceof DomainError && e.code === code);

test("required MFA configuration is exact and rejects unsafe startup before database creation", (t) => {
  assert.deepEqual(configuredMfaRoles(""), []);
  assert.deepEqual(configuredMfaRoles("admin,finance,buyer"), [
    "admin",
    "finance",
    "buyer",
  ]);
  for (const value of [
    "admin,",
    "Admin",
    "admin,admin",
    "admin, finance",
    "none",
    " ",
  ])
    denied("CONFIG", () => configuredMfaRoles(value));
  const directory = mkdtempSync(join(tmpdir(), "mfa-policy-config-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const [i, security] of [
    { mfaRequiredRoles: ["admin"] },
    { mfaRequiredRoles: ["admin"], mfaEncryptionKey: "wrong" },
    { mfaRequiredRoles: ["unknown"], mfaEncryptionKey: key },
    { mfaRequiredRoles: ["admin", "admin"], mfaEncryptionKey: key },
  ].entries()) {
    const path = join(directory, `invalid-${i}.db`);
    denied(
      "CONFIG",
      () =>
        new Application(
          path,
          "CA",
          security as { mfaRequiredRoles: Role[]; mfaEncryptionKey?: string },
        ),
    );
    assert.equal(existsSync(path), false);
  }
  const path = join(directory, "main.db");
  const child = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/server/main.ts"],
    {
      env: {
        ...process.env,
        DATABASE_PATH: path,
        MFA_REQUIRED_ROLES: "admin",
        MFA_ENCRYPTION_KEY: "",
        HOST: "127.0.0.1",
        PORT: "3199",
      },
      encoding: "utf8",
      timeout: 15000,
    },
  );
  assert.equal(child.status, 1, child.stderr);
  assert.equal(existsSync(path), false);
});

test("HTTP enrollment restriction covers business reads and writes and preserves password, CSRF and origin boundaries", async (t) => {
  const f = fixture(t, { mfaEncryptionKey: key, mfaRequiredRoles: ["admin"] });
  const origin = "http://localhost",
    http = await createHttp(f.app, { origin });
  t.after(() => http.close());
  const response = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: { email, password },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().mfaEnrollmentRequired, true);
  const headers = {
    origin,
    cookie: String(response.headers["set-cookie"]).split(";")[0]!,
    "x-csrf-token": response.json().csrf,
  };
  for (const [method, url] of [
    ["GET", "/api/dashboard"],
    ["GET", "/api/users"],
    ["GET", "/api/stock"],
    ["GET", "/api/billing/refunds/page"],
    ["GET", "/api/provider-disclosures"],
    ["POST", "/api/commands/catalog.create"],
    ["POST", "/api/security/mfa/disable"],
    ["POST", "/api/billing/documents/invoice/missing/pdf"],
    ["GET", "/api/security/mfa/setup"],
  ] as const) {
    const result = await http.inject({ method, url, headers });
    // Allowed path with unsupported method still cannot access a business handler.
    if (url === "/api/security/mfa/setup") assert.equal(result.statusCode, 404);
    else {
      assert.equal(result.statusCode, 403, url);
      assert.equal(result.json().code, "MFA_ENROLLMENT_REQUIRED", url);
    }
  }
  assert.equal(
    (await http.inject({ url: "/api/session?fresh=true", headers })).json()
      .mfaEnrollmentRequired,
    true,
  );
  const security = (
    await http.inject({ url: "/api/security", headers })
  ).json();
  assert.equal(security.mfa.required, true);
  assert.equal(security.mfa.enabled, false);
  const payload = {
    currentPassword: password,
    revision: security.revision,
    key: "setup",
  };
  for (const invalid of [
    { ...headers, origin: "http://wrong" },
    { ...headers, "x-csrf-token": "wrong" },
  ]) {
    const result = await http.inject({
      method: "POST",
      url: "/api/security/mfa/setup",
      headers: invalid,
      payload,
    });
    assert.equal(result.statusCode, 403);
    assert.ok(["ORIGIN", "CSRF"].includes(result.json().code));
  }
  const setup = await http.inject({
    method: "POST",
    url: "/api/security/mfa/setup",
    headers,
    payload,
  });
  assert.equal(setup.statusCode, 200);
  const bundle = setup.json();
  const confirm = await http.inject({
    method: "POST",
    url: "/api/security/mfa/confirm",
    headers,
    payload: {
      currentPassword: password,
      enrollmentId: bundle.enrollmentId,
      code: totp(bundle.secret, Math.floor(Date.now() / 30000)),
      recoverySaved: true,
    },
  });
  assert.equal(confirm.statusCode, 200);
  assert.equal(
    (await http.inject({ url: "/api/dashboard", headers })).statusCode,
    401,
  );
  const missing = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: { email, password },
  });
  assert.equal(missing.json().code, "MFA_REQUIRED");
  assert.equal(missing.headers["set-cookie"], undefined);
  const logged = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: { email, password, code: bundle.recoveryCodes[0] },
  });
  assert.equal(logged.statusCode, 200);
  assert.equal(logged.json().mfaEnrollmentRequired, false);
  const full = {
    origin,
    cookie: String(logged.headers["set-cookie"]).split(";")[0]!,
    "x-csrf-token": logged.json().csrf,
  };
  assert.equal(
    (await http.inject({ url: "/api/dashboard", headers: full })).statusCode,
    200,
  );
  const revision = f.app.identity.security(f.actor).revision;
  const removal = {
    currentPassword: password,
    revision,
    code: bundle.recoveryCodes[1],
  };
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: "/api/security/mfa/disable",
        headers: full,
        payload: removal,
      })
    ).json().code,
    "MFA_POLICY",
  );
  denied("MFA_POLICY", () => f.app.identity.mfa.disable(f.actor, removal));
  assert.equal(f.app.identity.security(f.actor).mfa.recoveryCodesRemaining, 9);
  assert.equal(f.app.identity.security(f.actor).mfa.enabled, true);
  assert.equal(f.app.identity.security(f.actor).sessions, 1);
});

test("current role and restart policy restrict existing password sessions; policy arrays cannot change after construction", (t) => {
  const selected: Role[] = [],
    f = fixture(t, { mfaEncryptionKey: key, mfaRequiredRoles: selected });
  const session = f.app.identity.login(email, password);
  selected.push("admin");
  assert.equal(
    f.app.identity.session(session.token).mfaEnrollmentRequired,
    false,
  );
  f.app.close();
  f.app = new Application(f.path, "CA", {
    mfaEncryptionKey: key,
    mfaRequiredRoles: ["admin"],
  });
  assert.equal(
    f.app.identity.session(session.token).mfaEnrollmentRequired,
    true,
  );
  assert.equal(f.app.identity.session(session.token).actor.role, "admin");
  const store = f.app.database.owned("iam");
  store.run("UPDATE iam_users SET role='support' WHERE id=?", f.actor.id);
  assert.equal(
    f.app.identity.session(session.token).mfaEnrollmentRequired,
    false,
  );
  store.run("UPDATE iam_users SET role='admin' WHERE id=?", f.actor.id);
  assert.equal(
    f.app.identity.session(session.token).mfaEnrollmentRequired,
    true,
  );
});

test("required initial password change precedes MFA setup and own-session termination remains available", async (t) => {
  const f = fixture(t, {
    mfaEncryptionKey: key,
    mfaRequiredRoles: ["warehouse"],
  });
  f.app.identity.createUser(f.actor, "required-user", {
    email: "required@example.test",
    name: "Required",
    password,
    role: "warehouse",
    sites: [f.w1],
    requirePasswordChange: true,
  });
  const origin = "http://localhost",
    http = await createHttp(f.app, { origin });
  t.after(() => http.close());
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: { email: "required@example.test", password },
  });
  const headers = {
    origin,
    cookie: String(login.headers["set-cookie"]).split(";")[0]!,
    "x-csrf-token": login.json().csrf,
    "idempotency-key": "end",
  };
  assert.equal(login.json().passwordChangeRequired, true);
  assert.equal(login.json().mfaEnrollmentRequired, true);
  const setup = await http.inject({
    method: "POST",
    url: "/api/security/mfa/setup",
    headers,
    payload: { currentPassword: password, revision: 1, key: "setup" },
  });
  assert.equal(setup.json().code, "PASSWORD_CHANGE_REQUIRED");
  const changed = await http.inject({
    method: "POST",
    url: "/api/commands/user.password.change",
    headers,
    payload: {
      currentPassword: password,
      password: "new-required-long-password",
    },
  });
  assert.equal(changed.statusCode, 200, changed.body);
  const next = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: {
      email: "required@example.test",
      password: "new-required-long-password",
    },
  });
  assert.equal(next.json().passwordChangeRequired, false);
  assert.equal(next.json().mfaEnrollmentRequired, true);
  const ended = await http.inject({
    method: "POST",
    url: "/api/commands/user.sessions.end-own",
    headers: {
      ...headers,
      cookie: String(next.headers["set-cookie"]).split(";")[0]!,
      "x-csrf-token": next.json().csrf,
    },
    payload: {},
  });
  assert.equal(ended.statusCode, 200, ended.body);
});
