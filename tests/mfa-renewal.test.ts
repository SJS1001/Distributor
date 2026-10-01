import { fork, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { createBackup, restoreBackup } from "../src/server/recovery.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Application } from "../src/server/application.ts";
import { DomainError } from "../src/server/core.ts";
import { createHttp } from "../src/server/http.ts";
import { FactorCipher, totp } from "../src/server/totp.ts";
import { fixture } from "./fixtures.ts";
const encryptionKey = "a1".repeat(32),
  password = "long-test-only-password",
  email = "admin@example.test";
const config = {
  mfaEncryptionKey: encryptionKey,
  mfaRequiredRoles: ["admin" as const],
};
const denied = (code: string, run: () => unknown) =>
  assert.throws(run, (e) => e instanceof DomainError && e.code === code);
function activate(f: ReturnType<typeof fixture>) {
  const bundle = f.app.identity.mfa.begin(f.actor, "setup", {
    currentPassword: password,
    revision: 1,
  });
  f.app.identity.mfa.confirm(f.actor, {
    currentPassword: password,
    enrollmentId: bundle.enrollmentId,
    code: totp(bundle.secret, Math.floor(Date.now() / 30000)),
    recoverySaved: true,
  });
  return bundle;
}
function prepare(f: ReturnType<typeof fixture>, key = "renewal") {
  return f.app.identity.mfa.prepareRecovery(f.actor, key, {
    currentPassword: password,
    revision: f.app.identity.security(f.actor).revision,
  });
}
function confirm(
  f: ReturnType<typeof fixture>,
  renewalId: string,
  code: string,
) {
  return f.app.identity.mfa.confirmRecovery(f.actor, {
    currentPassword: password,
    renewalId,
    code,
    recoverySaved: true,
  });
}
test("recovery renewal retries survive restart, keep old codes active until confirmation and revoke every session without removing required MFA", (t) => {
  const f = fixture(t, config),
    old = activate(f),
    session = f.app.identity.login(email, password, old.recoveryCodes[0]);
  const store = f.app.database.owned("iam"),
    factor = store.get("SELECT * FROM iam_mfa"),
    revision = f.app.identity.security(f.actor).revision;
  const next = prepare(f);
  assert.equal(next.recoveryCodes.length, 10);
  assert.equal(new Set(next.recoveryCodes).size, 10);
  assert.deepEqual(prepare(f), next);
  assert.equal(f.app.identity.security(f.actor).mfa.recoveryCodesRemaining, 9);
  f.app.close();
  f.app = new Application(f.path, "CA", config);
  assert.deepEqual(prepare(f), next);
  assert.equal(
    f.app.platform
      .audits(f.actor)
      .filter((a) => a.action === "user.mfa.recovery.prepared").length,
    1,
  );
  denied("MFA_INVALID", () =>
    f.app.identity.login(email, password, next.recoveryCodes[0]),
  );
  f.app.identity.login(email, password, old.recoveryCodes[1]);
  const changed = confirm(f, next.renewalId, old.recoveryCodes[2]!);
  assert.equal(changed.revision, revision + 1);
  assert.equal(changed.sessionsEnded, 2);
  denied("UNAUTHENTICATED", () => f.app.identity.session(session.token));
  assert.deepEqual(
    f.app.database.owned("iam").get("SELECT * FROM iam_mfa"),
    factor,
  );
  assert.equal(f.app.identity.security(f.actor).mfa.required, true);
  assert.equal(f.app.identity.security(f.actor).mfa.recoveryCodesRemaining, 10);
  denied("MFA_REQUIRED", () => f.app.identity.login(email, password));
  denied("MFA_INVALID", () =>
    f.app.identity.login(email, password, old.recoveryCodes[3]),
  );
  f.app.identity.login(email, password, next.recoveryCodes[0]);
  denied("MFA_INVALID", () =>
    f.app.identity.login(email, password, next.recoveryCodes[0]),
  );
  const serialized = JSON.stringify({
    pending: f.app.database.owned("iam").all("SELECT * FROM iam_mfa_pending"),
    recovery: f.app.database.owned("iam").all("SELECT * FROM iam_mfa_recovery"),
    audit: f.app.platform.audits(f.actor),
    commands: f.app.database
      .owned("platform")
      .all("SELECT * FROM platform_commands"),
  });
  for (const code of [...old.recoveryCodes, ...next.recoveryCodes])
    assert.ok(!serialized.includes(code));
  assert.equal(
    f.app.database.owned("iam").all("SELECT * FROM iam_mfa_pending").length,
    0,
  );
});
test("renewal requires current password, saved acknowledgment and an existing unused factor; inactive codes cannot authorize themselves", (t) => {
  const f = fixture(t, config),
    old = activate(f),
    next = prepare(f),
    security = f.app.identity.security(f.actor);
  const input = {
    currentPassword: password,
    renewalId: next.renewalId,
    code: old.recoveryCodes[0]!,
    recoverySaved: true,
  };
  denied("REAUTHENTICATE", () =>
    f.app.identity.mfa.prepareRecovery(f.actor, "bad", {
      currentPassword: "wrong-password",
      revision: security.revision,
    }),
  );
  denied("REAUTHENTICATE", () =>
    f.app.identity.mfa.confirmRecovery(f.actor, {
      ...input,
      currentPassword: "wrong-password",
    }),
  );
  denied("VALIDATION", () =>
    f.app.identity.mfa.confirmRecovery(f.actor, {
      ...input,
      recoverySaved: false,
    }),
  );
  denied("MFA_INVALID", () =>
    f.app.identity.mfa.confirmRecovery(f.actor, {
      ...input,
      code: next.recoveryCodes[0]!,
    }),
  );
  assert.equal(f.app.identity.security(f.actor).mfa.recoveryCodesRemaining, 10);
  assert.equal(f.app.identity.security(f.actor).revision, security.revision);
  confirm(f, next.renewalId, old.recoveryCodes[0]!);
});
test("replaced, expired and revision-invalidated bundles cannot activate or regenerate with their original key", (t) => {
  const f = fixture(t, config),
    old = activate(f),
    first = prepare(f),
    second = prepare(f, "replacement");
  denied("MFA_EXPIRED", () =>
    confirm(f, first.renewalId, old.recoveryCodes[0]!),
  );
  const store = f.app.database.owned("iam");
  store.run("UPDATE iam_mfa_pending SET expires_at=?", Date.now() - 1);
  denied("MFA_EXPIRED", () => prepare(f, "replacement"));
  assert.equal(store.get("SELECT material FROM iam_mfa_pending")!.material, "");
  denied("MFA_EXPIRED", () =>
    confirm(f, second.renewalId, old.recoveryCodes[0]!),
  );
  const third = prepare(f, "third");
  f.app.identity.revokeSessions(f.actor, "revoke", {
    userId: f.actor.id,
    revision: f.app.identity.security(f.actor).revision,
    currentPassword: password,
    reason: "Synthetic security review",
  });
  denied("MFA_EXPIRED", () =>
    confirm(f, third.renewalId, old.recoveryCodes[0]!),
  );
  denied("MFA_EXPIRED", () => prepare(f, "third"));
  assert.equal(f.app.identity.security(f.actor).mfa.recoveryCodesRemaining, 10);
  assert.ok(prepare(f, "fresh").renewalId);
});
test("enrollment and renewal ciphertext cannot cross routes; principal and tenant changes cannot recover a bundle", (t) => {
  const f = fixture(t, config),
    enrollment = f.app.identity.mfa.begin(f.actor, "setup", {
      currentPassword: password,
      revision: 1,
    });
  denied("MFA_DISABLED", () => prepare(f));
  denied("MFA_DISABLED", () =>
    confirm(f, enrollment.enrollmentId, enrollment.recoveryCodes[0]!),
  );
  f.app.identity.mfa.confirm(f.actor, {
    currentPassword: password,
    enrollmentId: enrollment.enrollmentId,
    code: totp(enrollment.secret, Math.floor(Date.now() / 30000)),
    recoverySaved: true,
  });
  const next = prepare(f);
  denied("MFA_ENABLED", () =>
    f.app.identity.mfa.confirm(f.actor, {
      currentPassword: password,
      enrollmentId: next.renewalId,
      code: enrollment.recoveryCodes[0]!,
      recoverySaved: true,
    }),
  );
  denied("FORBIDDEN", () =>
    f.app.identity.mfa.prepareRecovery(
      { ...f.actor, orgId: "other" },
      "renewal",
      { currentPassword: password, revision: 2 },
    ),
  );
  const store = f.app.database.owned("iam");
  // Authenticated encryption prevents interpreting enrollment ciphertext as renewal material.
  store.run(
    "UPDATE iam_mfa_pending SET material=?",
    new FactorCipher(encryptionKey).encrypt(
      { secret: enrollment.secret, recoveryCodes: enrollment.recoveryCodes },
      `${f.actor.orgId}:${f.actor.id}:pending`,
    ),
  );
  denied("MFA_UNAVAILABLE", () => prepare(f));
  denied("MFA_UNAVAILABLE", () =>
    confirm(f, next.renewalId, enrollment.recoveryCodes[0]!),
  );
  assert.equal(f.app.identity.security(f.actor).mfa.recoveryCodesRemaining, 10);
});
test("late audit failure rolls back replaced hashes, consumed proof, pending material, revision and session revocation", (t) => {
  const f = fixture(t, config),
    old = activate(f),
    session = f.app.identity.login(email, password, old.recoveryCodes[0]),
    next = prepare(f);
  const store = f.app.database.owned("iam"),
    before = JSON.stringify({
      codes: store.all("SELECT * FROM iam_mfa_recovery"),
      pending: store.all("SELECT * FROM iam_mfa_pending"),
      factor: store.all("SELECT * FROM iam_mfa"),
    }),
    revision = f.app.identity.security(f.actor).revision,
    original = f.app.platform.audit.bind(f.app.platform);
  f.app.platform.audit = (...args) => {
    if (args[1] === "user.mfa.recovery.replaced")
      throw Error("Synthetic late audit fault");
    return original(...args);
  };
  assert.throws(
    () => confirm(f, next.renewalId, old.recoveryCodes[1]!),
    /late audit fault/,
  );
  assert.equal(
    JSON.stringify({
      codes: store.all("SELECT * FROM iam_mfa_recovery"),
      pending: store.all("SELECT * FROM iam_mfa_pending"),
      factor: store.all("SELECT * FROM iam_mfa"),
    }),
    before,
  );
  assert.equal(f.app.identity.security(f.actor).revision, revision);
  assert.equal(f.app.identity.session(session.token).actor.id, f.actor.id);
  f.app.platform.audit = original;
  confirm(f, next.renewalId, old.recoveryCodes[1]!);
});
test("invalid renewal proofs share persistent authentication throttling and wrong runtime keys fail closed", (t) => {
  const f = fixture(t, config),
    old = activate(f),
    next = prepare(f);
  for (let i = 0; i < 8; i++)
    denied("MFA_INVALID", () => confirm(f, next.renewalId, "invalid-factor"));
  denied("RATE_LIMIT", () => confirm(f, next.renewalId, old.recoveryCodes[0]!));
  assert.equal(f.app.identity.security(f.actor).mfa.recoveryCodesRemaining, 10);
  f.app.database.owned("iam").run("DELETE FROM iam_attempts");
  f.app.close();
  f.app = new Application(f.path, "CA", {
    ...config,
    mfaEncryptionKey: "b2".repeat(32),
  });
  denied("MFA_UNAVAILABLE", () => prepare(f));
  denied("MFA_UNAVAILABLE", () =>
    confirm(f, next.renewalId, old.recoveryCodes[0]!),
  );
  assert.equal(f.app.identity.security(f.actor).mfa.recoveryCodesRemaining, 10);
});
test("HTTP renewal enforces session, current factor, exact payload, origin and CSRF and ends the calling session", async (t) => {
  const f = fixture(t, config),
    old = activate(f),
    origin = "http://localhost",
    http = await createHttp(f.app, { origin });
  t.after(() => http.close());
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: { email, password, code: old.recoveryCodes[0] },
  });
  const headers = {
      origin,
      cookie: String(login.headers["set-cookie"]).split(";")[0]!,
      "x-csrf-token": login.json().csrf,
    },
    payload = {
      currentPassword: password,
      revision: f.app.identity.security(f.actor).revision,
      key: "http-renewal",
    };
  const url = "/api/security/mfa/recovery/prepare";
  assert.equal(
    (await http.inject({ method: "POST", url, headers: { origin }, payload }))
      .statusCode,
    401,
  );
  for (const invalid of [
    { ...headers, origin: "http://wrong" },
    { ...headers, "x-csrf-token": "wrong" },
  ])
    assert.equal(
      (await http.inject({ method: "POST", url, headers: invalid, payload }))
        .statusCode,
      403,
    );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url,
        headers,
        payload: { ...payload, userId: "other" },
      })
    ).statusCode,
    400,
  );
  const response = await http.inject({ method: "POST", url, headers, payload });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers["cache-control"], "no-store");
  const next = response.json(),
    confirmation = {
      currentPassword: password,
      renewalId: next.renewalId,
      code: old.recoveryCodes[1],
      recoverySaved: true,
    };
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: "/api/security/mfa/recovery/confirm",
        headers,
        payload: { ...confirmation, recoverySaved: "true" },
      })
    ).statusCode,
    400,
  );
  const result = await http.inject({
    method: "POST",
    url: "/api/security/mfa/recovery/confirm",
    headers,
    payload: confirmation,
  });
  assert.equal(result.statusCode, 200, result.body);
  assert.match(String(result.headers["set-cookie"]), /distributor_session=;/);
  assert.equal(
    (await http.inject({ url: "/api/security", headers })).statusCode,
    401,
  );
  const missing = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: { email, password },
  });
  assert.equal(missing.json().code, "MFA_REQUIRED");
  const again = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: { email, password, code: next.recoveryCodes[0] },
  });
  assert.equal(again.statusCode, 200, again.body);
});
test("authenticator-authorized replacement advances replay boundary and never allows the same counter again", (t) => {
  const f = fixture(t, config),
    old = activate(f),
    next = prepare(f),
    timestamp = Date.now,
    step = Math.floor(timestamp() / 30000) + 1;
  try {
    Date.now = () => step * 30000;
    confirm(f, next.renewalId, totp(old.secret, step));
    denied("MFA_INVALID", () =>
      f.app.identity.login(email, password, totp(old.secret, step)),
    );
    Date.now = () => (step + 1) * 30000;
    f.app.identity.login(email, password, totp(old.secret, step + 1));
  } finally {
    Date.now = timestamp;
  }
});
test("encrypted restore discards pending replacement codes and can replenish from a retained authenticator after its replay hold", async (t) => {
  const f = fixture(t, config),
    old = activate(f),
    next = prepare(f),
    key = randomBytes(32),
    archive = join(dirname(f.path), "renewal.backup"),
    restored = join(dirname(f.path), "restored.db");
  await createBackup(f.path, archive, "CA", key);
  await restoreBackup(archive, restored, "CA", key);
  f.app.close();
  f.app = new Application(restored, "CA", config);
  denied("MFA_EXPIRED", () =>
    confirm(f, next.renewalId, old.recoveryCodes[0]!),
  );
  assert.equal(f.app.identity.security(f.actor).mfa.recoveryCodesRemaining, 0);
  const fresh = prepare(f, "after-restore"),
    timestamp = Date.now,
    step =
      Number(
        f.app.database.owned("iam").get("SELECT last_step FROM iam_mfa")!
          .last_step,
      ) + 1;
  try {
    Date.now = () => step * 30000;
    confirm(f, fresh.renewalId, totp(old.secret, step));
  } finally {
    Date.now = timestamp;
  }
  f.app.identity.login(email, password, fresh.recoveryCodes[0]);
});
test(
  "two operating system processes cannot both confirm the same replacement even with distinct valid recovery proofs",
  { timeout: 15000 },
  async (t) => {
    const f = fixture(t, config),
      old = activate(f),
      next = prepare(f),
      children: ChildProcess[] = [],
      ready: Promise<void>[] = [],
      results: Promise<{ ok: boolean; code?: string }>[] = [];
    t.after(() => children.forEach((c) => c.kill()));
    for (let i = 0; i < 2; i++) {
      const child = fork(
        new URL("./mfa-renewal-child.ts", import.meta.url),
        [],
        {
          execArgv: ["--import", "tsx"],
          stdio: ["ignore", "ignore", "pipe", "ipc"],
        },
      );
      children.push(child);
      let prepared!: () => void,
        resolve!: (value: any) => void,
        reject!: (error: Error) => void;
      ready.push(new Promise((r) => (prepared = r)));
      results.push(
        new Promise((r, j) => {
          resolve = r;
          reject = j;
        }),
      );
      let stderr = "";
      child.stderr?.on("data", (d) => (stderr += d));
      child.on("error", reject);
      child.on("exit", (c) => {
        if (c !== 0) reject(Error(stderr));
      });
      child.on("message", (m: any) => (m.ready ? prepared() : resolve(m)));
      child.send({
        action: "init",
        path: f.path,
        key: encryptionKey,
        actor: f.actor,
        input: {
          currentPassword: password,
          renewalId: next.renewalId,
          code: old.recoveryCodes[i]!,
          recoverySaved: true,
        },
      });
    }
    await Promise.all(ready);
    children.forEach((c) => c.send({ action: "go" }));
    const outcomes = await Promise.all(results);
    assert.equal(outcomes.filter((r) => r.ok).length, 1);
    assert.equal(outcomes.find((r) => !r.ok)!.code, "MFA_EXPIRED");
    assert.equal(f.app.identity.security(f.actor).revision, 3);
    assert.equal(
      f.app.identity.security(f.actor).mfa.recoveryCodesRemaining,
      10,
    );
    assert.equal(
      f.app.platform
        .audits(f.actor)
        .filter((a) => a.action === "user.mfa.recovery.replaced").length,
      1,
    );
  },
);
