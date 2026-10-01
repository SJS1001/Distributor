import { test } from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { Application } from "../src/server/application.ts";
import { DomainError, type Actor } from "../src/server/core.ts";
import { totp } from "../src/server/totp.ts";
import { fixture } from "./fixtures.ts";

const password = "long-test-only-password",
  encryptionKey = "a1".repeat(32),
  config = { mfaEncryptionKey: encryptionKey };
function fail(code: string, run: () => unknown) {
  assert.throws(
    run,
    (error: unknown) => error instanceof DomainError && error.code === code,
  );
}
function begin(f: ReturnType<typeof fixture>, actor = f.actor, key = "setup") {
  return f.app.identity.mfa.begin(actor, key, {
    currentPassword: password,
    revision: f.app.identity.security(actor).revision,
  });
}
function user(f: ReturnType<typeof fixture>, suffix: string) {
  f.app.identity.createUser(f.actor, `create-${suffix}`, {
    name: "Synthetic pending factor user",
    email: `${suffix}@example.test`,
    password,
    role: "warehouse",
    sites: [f.w1],
  });
  return f.app.identity.login(`${suffix}@example.test`, password).actor;
}
function seed(f: ReturnType<typeof fixture>, count: number, expiresAt: number) {
  const store = f.app.database.owned("iam");
  store.run(
    "INSERT INTO iam_organizations SELECT 'foreign-cleanup',name,region,currency,policy FROM iam_organizations WHERE id=?",
    f.actor.orgId,
  );
  f.app.database.transaction(() => {
    for (let i = 0; i < count; i++) {
      const id = `cleanup-${String(i).padStart(3, "0")}`,
        orgId = i % 2 === 0 ? f.actor.orgId : "foreign-cleanup";
      store.run(
        "INSERT INTO iam_users SELECT ?,?, ?,name,account_id,role,sites,salt,password_hash,active FROM iam_users WHERE id=?",
        id,
        orgId,
        `${id}@example.test`,
        f.actor.id,
      );
      store.run(
        "INSERT INTO iam_mfa_pending VALUES(?,?,?,?,?,?,?)",
        id,
        orgId,
        "synthetic-key",
        `enrollment-${id}`,
        1,
        "synthetic-encrypted-material",
        expiresAt,
      );
    }
  });
}
function facts(f: ReturnType<typeof fixture>) {
  const store = f.app.database.owned("iam");
  return {
    users: store.all("SELECT * FROM iam_users ORDER BY id"),
    factors: store.all("SELECT * FROM iam_mfa ORDER BY user_id"),
    recovery: store.all("SELECT * FROM iam_mfa_recovery ORDER BY user_id,hash"),
    sessions: store.all("SELECT * FROM iam_sessions ORDER BY hash"),
    security: store.all("SELECT * FROM iam_user_security ORDER BY user_id"),
    commands: f.app.database
      .owned("platform")
      .all("SELECT * FROM platform_commands ORDER BY rowid"),
    audits: f.app.platform.audits(f.actor),
    stock: f.app.inventory.stock(f.actor),
  };
}
test("expired enrollment maintenance bounds batches across organizations, needs no key and preserves live identity/stock facts", (t) => {
  const f = fixture(t, config),
    live = begin(f),
    enrolled = user(f, "enrolled-cleanup"),
    active = begin(f, enrolled),
    step = Math.floor(Date.now() / 30000);
  f.app.identity.mfa.confirm(enrolled, {
    currentPassword: password,
    enrollmentId: active.enrollmentId,
    code: totp(active.secret, step),
    recoverySaved: true,
  });
  f.app.identity.login(
    "enrolled-cleanup@example.test",
    password,
    active.recoveryCodes[0],
  );
  seed(f, 205, Date.now() - 1);
  const before = facts(f),
    store = f.app.database.owned("iam");
  assert.deepEqual(f.app.identity.mfa.purgeExpiredEnrollments(), {
    purged: 100,
  });
  assert.equal(
    store.get(
      "SELECT COUNT(*) AS n FROM iam_mfa_pending WHERE material='' AND user_id LIKE 'cleanup-%'",
    )!.n,
    100,
  );
  assert.equal(
    store.get(
      "SELECT material FROM iam_mfa_pending WHERE user_id='cleanup-099'",
    )!.material,
    "",
  );
  assert.notEqual(
    store.get(
      "SELECT material FROM iam_mfa_pending WHERE user_id='cleanup-100'",
    )!.material,
    "",
  );
  assert.deepEqual(facts(f), before);
  assert.deepEqual(begin(f), live);
  f.app.close();
  f.app = new Application(f.path); // Startup purges one further batch without a runtime key.
  assert.equal(
    storeAfter(f).get(
      "SELECT COUNT(*) AS n FROM iam_mfa_pending WHERE material<>'' AND user_id LIKE 'cleanup-%'",
    )!.n,
    5,
  );
  assert.deepEqual(f.app.identity.mfa.purgeExpiredEnrollments(), { purged: 5 });
  assert.deepEqual(f.app.identity.mfa.purgeExpiredEnrollments(), { purged: 0 });
  assert.deepEqual(facts(f), before);
  fail("MFA_UNAVAILABLE", () =>
    f.app.identity.login("enrolled-cleanup@example.test", password),
  );
  f.app.close();
  f.app = new Application(f.path, "CA", config);
  assert.deepEqual(begin(f), live);
  f.app.identity.login(
    "enrolled-cleanup@example.test",
    password,
    active.recoveryCodes[1],
  );
});
function storeAfter(f: ReturnType<typeof fixture>) {
  return f.app.database.owned("iam");
}
test("expiry boundary and restart erase material, retain terminal retry identity and require an explicit new setup", (t) => {
  const f = fixture(t, config),
    setup = begin(f),
    store = storeAfter(f);
  let clock = setup.expiresAt - 1;
  t.mock.method(Date, "now", () => clock);
  assert.deepEqual(f.app.identity.mfa.purgeExpiredEnrollments(), { purged: 0 });
  assert.deepEqual(begin(f), setup);
  clock++;
  f.app.close();
  f.app = new Application(f.path, "CA", config);
  const terminal = storeAfter(f).get(
    "SELECT * FROM iam_mfa_pending WHERE user_id=?",
    f.actor.id,
  )!;
  assert.equal(terminal.material, "");
  assert.equal(terminal.enrollment_id, setup.enrollmentId);
  fail("MFA_EXPIRED", () => begin(f));
  fail("MFA_EXPIRED", () =>
    f.app.identity.mfa.confirm(f.actor, {
      currentPassword: password,
      enrollmentId: setup.enrollmentId,
      code: totp(setup.secret, Math.floor(clock / 30000)),
      recoverySaved: true,
    }),
  );
  // A backward workstation-clock correction cannot resurrect erased material.
  clock = setup.expiresAt - 1;
  fail("MFA_EXPIRED", () => begin(f));
  const fresh = begin(f, f.actor, "new-setup");
  assert.notEqual(fresh.secret, setup.secret);
  assert.notEqual(fresh.enrollmentId, setup.enrollmentId);
  f.app.identity.mfa.confirm(f.actor, {
    currentPassword: password,
    enrollmentId: fresh.enrollmentId,
    code: totp(fresh.secret, Math.floor(clock / 30000)),
    recoverySaved: true,
  });
  assert.equal(f.app.identity.security(f.actor).mfa.enabled, true);
});
test("authenticated expired retries commit own cleanup despite denial, while wrong passwords and foreign actors cannot erase setup", (t) => {
  const f = fixture(t, config),
    other = user(f, "other-cleanup"),
    otherSetup = begin(f, other),
    setup = begin(f),
    store = storeAfter(f);
  store.run("UPDATE iam_mfa_pending SET expires_at=?", Date.now() - 1);
  const before = store.all("SELECT * FROM iam_mfa_pending ORDER BY user_id");
  fail("REAUTHENTICATE", () =>
    f.app.identity.mfa.begin(f.actor, "setup", {
      currentPassword: "wrong",
      revision: 1,
    }),
  );
  fail("FORBIDDEN", () =>
    f.app.identity.mfa.begin({ ...f.actor, orgId: "foreign" }, "setup", {
      currentPassword: password,
      revision: 1,
    }),
  );
  assert.deepEqual(
    store.all("SELECT * FROM iam_mfa_pending ORDER BY user_id"),
    before,
  );
  fail("MFA_EXPIRED", () => begin(f));
  assert.equal(
    store.get(
      "SELECT material FROM iam_mfa_pending WHERE user_id=?",
      f.actor.id,
    )!.material,
    "",
  );
  assert.notEqual(
    store.get("SELECT material FROM iam_mfa_pending WHERE user_id=?", other.id)!
      .material,
    "",
  );
  fail("MFA_EXPIRED", () =>
    f.app.identity.mfa.confirm(other, {
      currentPassword: password,
      enrollmentId: otherSetup.enrollmentId,
      code: "123456",
      recoverySaved: true,
    }),
  );
  assert.equal(
    store.get("SELECT material FROM iam_mfa_pending WHERE user_id=?", other.id)!
      .material,
    "",
  );
  assert.equal(
    store.get(
      "SELECT enrollment_id FROM iam_mfa_pending WHERE user_id=?",
      f.actor.id,
    )!.enrollment_id,
    setup.enrollmentId,
  );
  assert.equal(store.all("SELECT * FROM iam_mfa").length, 0);
});
test("password/access/reset/session revisions immediately erase only the target setup and late audit rollback restores it", (t) => {
  for (const operation of [
    "password",
    "access",
    "reset",
    "sessions",
  ] as const) {
    const f = fixture(t, config),
      target = user(f, `target-${operation}`),
      setup = begin(f, target),
      own = begin(f),
      store = storeAfter(f),
      before = store.get(
        "SELECT * FROM iam_mfa_pending WHERE user_id=?",
        target.id,
      )!,
      audit = f.app.platform.audit.bind(f.app.platform);
    const change = () => {
      if (operation === "password")
        return f.app.identity.changePassword(target, "change", {
          currentPassword: password,
          password: "new-synthetic-password",
        });
      if (operation === "reset")
        return f.app.identity.resetPassword(f.actor, "change", {
          userId: target.id,
          revision: 1,
          currentPassword: password,
          password: "new-synthetic-password",
          reason: "Synthetic reset",
        });
      if (operation === "sessions")
        return f.app.identity.revokeSessions(f.actor, "change", {
          userId: target.id,
          revision: 1,
          currentPassword: password,
          reason: "Synthetic revoke",
        });
      return f.app.identity.updateUser(f.actor, "change", {
        userId: target.id,
        revision: 1,
        name: "Updated synthetic name",
        email: `target-${operation}@example.test`,
        role: "warehouse",
        sites: [f.w1],
        active: true,
        currentPassword: password,
        reason: "Synthetic access edit",
      });
    };
    f.app.platform.audit = (...args) => {
      if (args[1] !== "user.mfa.setup.started")
        throw new Error("Synthetic late audit fault");
      return audit(...args);
    };
    assert.throws(change, /late audit fault/);
    assert.deepEqual(
      store.get("SELECT * FROM iam_mfa_pending WHERE user_id=?", target.id),
      before,
    );
    assert.equal(f.app.identity.security(target).revision, 1);
    assert.equal(f.app.identity.security(target).sessions, 1);
    f.app.platform.audit = audit;
    change();
    assert.equal(
      store.get(
        "SELECT material FROM iam_mfa_pending WHERE user_id=?",
        target.id,
      )!.material,
      "",
    );
    assert.equal(
      store.get(
        "SELECT enrollment_id FROM iam_mfa_pending WHERE user_id=?",
        target.id,
      )!.enrollment_id,
      setup.enrollmentId,
    );
    assert.deepEqual(begin(f), own);
    assert.equal(f.app.identity.security(target).revision, 2);
    assert.equal(f.app.identity.security(target).sessions, 0);
    if (operation === "sessions" || operation === "access") {
      fail("MFA_EXPIRED", () => begin(f, target));
      assert.notEqual(
        begin(f, target, "new-target-setup").secret,
        setup.secret,
      );
    }
  }
});

type ChildInput = {
  path: string;
  timestamp: number;
  actor: Actor;
  action: "purge" | "begin";
};
async function race(
  t: { after: (fn: () => void) => void },
  inputs: ChildInput[],
) {
  const children: ChildProcess[] = [],
    ready: Promise<void>[] = [],
    results: Promise<{
      ok: boolean;
      purged?: number;
      setup?: ReturnType<typeof begin>;
    }>[] = [];
  t.after(() => children.forEach((child) => child.kill()));
  for (const input of inputs) {
    const child = fork(new URL("./mfa-cleanup-child.ts", import.meta.url), [], {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    children.push(child);
    let readyResolve!: () => void,
      readyReject!: (error: Error) => void,
      resultResolve!: (value: any) => void,
      resultReject!: (error: Error) => void;
    ready.push(
      new Promise((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
      }),
    );
    results.push(
      new Promise((resolve, reject) => {
        resultResolve = resolve;
        resultReject = reject;
      }),
    );
    let stderr = "",
      completed = false;
    child.stderr?.on("data", (value) => {
      stderr += value;
    });
    const reject = (error: Error) => {
      readyReject(error);
      resultReject(error);
    };
    child.on("message", (message: any) => {
      if (message.ready) readyResolve();
      else {
        completed = true;
        resultResolve(message);
      }
    });
    child.on("error", reject);
    child.on("exit", () => {
      if (!completed)
        reject(new Error(stderr || "MFA cleanup child ended before a result"));
    });
    child.send({
      action: "init",
      input: { ...input, key: encryptionKey, password },
    });
  }
  // Observe result rejections immediately, including a failure before the barrier.
  const result = Promise.all(results);
  void result.catch(() => {});
  await Promise.all(ready);
  children.forEach((child) => child.send({ action: "go" }));
  return result;
}
test(
  "independent processes share bounded expiry batches and cannot erase a concurrently replaced setup",
  { timeout: 15000 },
  async (t) => {
    const f = fixture(t, config),
      setup = begin(f),
      timestamp = setup.expiresAt,
      input = { path: f.path, timestamp, actor: f.actor };
    seed(f, 205, timestamp - 1);
    const batches = await race(t, [
      { ...input, action: "purge" },
      { ...input, action: "purge" },
    ]);
    assert.ok(batches.every((result) => result.ok && result.purged === 100));
    assert.equal(
      storeAfter(f).get(
        "SELECT COUNT(*) AS n FROM iam_mfa_pending WHERE material<>'' AND user_id LIKE 'cleanup-%'",
      )!.n,
      5,
    );
    // Remove synthetic backlog before racing own expired setup versus a fresh one.
    storeAfter(f).run(
      "UPDATE iam_mfa_pending SET material='' WHERE user_id LIKE 'cleanup-%'",
    );
    const results = await race(t, [
      { ...input, action: "purge" },
      { ...input, action: "begin" },
    ]);
    assert.ok(results.every((result) => result.ok));
    assert.ok([0, 1].includes(results[0]!.purged!));
    const fresh = results[1]!.setup!;
    t.mock.method(Date, "now", () => timestamp);
    assert.deepEqual(begin(f, f.actor, "replacement"), fresh);
    assert.notEqual(fresh.secret, setup.secret);
    fail("MFA_EXPIRED", () =>
      f.app.identity.mfa.confirm(f.actor, {
        currentPassword: password,
        enrollmentId: setup.enrollmentId,
        code: "123456",
        recoverySaved: true,
      }),
    );
    f.app.identity.mfa.confirm(f.actor, {
      currentPassword: password,
      enrollmentId: fresh.enrollmentId,
      code: totp(fresh.secret, Math.floor(timestamp / 30000)),
      recoverySaved: true,
    });
    assert.equal(f.app.identity.security(f.actor).mfa.enabled, true);
  },
);
