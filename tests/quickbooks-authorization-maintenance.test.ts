import { test } from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import { QuickBooksBrowser } from "../src/server/quickbooks-browser.ts";
import { fixture, chooseProviders } from "./fixtures.ts";
const key = "ac".repeat(32);
const password = "long-test-only-password";
const origin = "http://127.0.0.1:3000";
const isCode = (code: string) => (error: unknown) =>
  (error as { code: string }).code === code;
function setup(t: Parameters<typeof fixture>[0]) {
  const f = fixture(t, { providerEncryptionKey: key });
  chooseProviders(f, f.actor, "choice", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["quickbooks"],
    version: 1,
    acknowledgment: "Synthetic choice",
  });
  const binding = {
    id: "maintenance-binding",
    orgId: f.actor.orgId,
    workerUserId: f.actor.id,
    accountId: f.buyer,
    realm: "1234",
    clientId: "synthetic-client",
    redirectUri: `${origin}/quickbooks/callback`,
  };
  return Object.assign(f, {
    binding,
    flow: f.app.providerCredentials.authorization,
    store: f.app.database.owned("integration"),
  });
}
function seed(
  f: ReturnType<typeof setup>,
  name: string,
  state: string,
  expires: number,
  started: number | null = null,
  org = f.actor.orgId,
) {
  f.store.run(
    `INSERT INTO integration_authorizations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    name,
    org,
    f.binding.id,
    f.buyer,
    f.actor.id,
    "1234",
    "synthetic-client",
    f.binding.redirectUri,
    name.padStart(64, "0"),
    0,
    1,
    expires,
    state,
    state === "exchanging" ? `claim-${name}` : null,
    started,
    null,
  );
}
function row(f: ReturnType<typeof setup>, name: string) {
  return f.store.get(
    "SELECT * FROM integration_authorizations WHERE id=?",
    name,
  )!;
}
function callback(
  f: ReturnType<typeof setup>,
  start: { authorizationUrl: string },
) {
  const url = new URL(f.binding.redirectUri);
  url.search = new URLSearchParams({
    state: new URL(start.authorizationUrl).searchParams.get("state")!,
    code: "synthetic-code",
    realmId: f.binding.realm,
  }).toString();
  return url.href;
}
function tokens() {
  return Response.json({
    access_token: "synthetic-new-access",
    refresh_token: "synthetic-new-refresh",
    token_type: "bearer",
    expires_in: 3600,
    x_refresh_token_expires_in: 86400,
  });
}
function mock(t: Parameters<typeof fixture>[0], fn: typeof fetch) {
  const original = globalThis.fetch;
  globalThis.fetch = fn;
  t.after(() => {
    globalThis.fetch = original;
  });
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("one batch terminalizes at most 100 combined rows across organizations and retains all metadata", (t) => {
  const f = setup(t),
    now = Date.now();
  t.mock.method(Date, "now", () => now);
  for (let i = 0; i < 205; i++)
    seed(
      f,
      `due-${String(i).padStart(3, "0")}`,
      i % 2 ? "exchanging" : "pending",
      now - 1,
      now - 90001,
      i % 3 ? f.actor.orgId : "other-org",
    );
  seed(f, "future", "pending", now + 1);
  seed(f, "active", "exchanging", now + 100000, now - 90000);
  for (const state of ["completed", "canceled", "denied", "unknown", "expired"])
    seed(f, `terminal-${state}`, state, now - 100000);
  const before = f.store.all(
    "SELECT * FROM integration_authorizations ORDER BY id",
  );
  const a = f.flow.expireAttempts(),
    b = f.flow.expireAttempts(),
    c = f.flow.expireAttempts();
  assert.deepEqual(a, { expired: 50, interrupted: 50 });
  assert.deepEqual(b, { expired: 50, interrupted: 50 });
  assert.deepEqual(c, { expired: 3, interrupted: 2 });
  assert.deepEqual(f.flow.expireAttempts(), { expired: 0, interrupted: 0 });
  for (const prior of before) {
    const after = row(f, String(prior.id));
    if (!String(prior.id).startsWith("due-")) assert.deepEqual(after, prior);
    else
      assert.deepEqual(
        { ...after },
        {
          ...prior,
          state: prior.state === "pending" ? "expired" : "unknown",
          claim: null,
        },
      );
  }
});

test("expiry exact boundary, 90-second exchange boundary, absent start and clock rollback conserve terminal states", (t) => {
  const f = setup(t);
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  seed(f, "due", "pending", now);
  seed(f, "pending-future", "pending", now + 1);
  seed(f, "ninety", "exchanging", now + 100000, now - 90000);
  seed(f, "old", "exchanging", now + 100000, now - 90001);
  seed(f, "null-start", "exchanging", now + 100000);
  seed(f, "deadline", "exchanging", now, now);
  assert.deepEqual(f.flow.expireAttempts(), { expired: 1, interrupted: 3 });
  assert.equal(row(f, "ninety").state, "exchanging");
  now++;
  assert.deepEqual(f.flow.expireAttempts(), { expired: 1, interrupted: 1 });
  const terminal = f.store.all(
    "SELECT * FROM integration_authorizations ORDER BY id",
  );
  now -= 1000000;
  assert.deepEqual(f.flow.expireAttempts(), { expired: 0, interrupted: 0 });
  assert.deepEqual(
    f.store.all("SELECT * FROM integration_authorizations ORDER BY id"),
    terminal,
  );
});

test("cleanup is atomic after a storage fault and retry has no partial transitions", (t) => {
  const f = setup(t);
  seed(f, "a", "pending", 0);
  seed(f, "b", "exchanging", 0, 0);
  f.store
    .migrate(`CREATE TRIGGER integration_maintenance_fault BEFORE UPDATE ON integration_authorizations
    WHEN NEW.id='b' BEGIN SELECT RAISE(ABORT,'synthetic fault'); END;`);
  assert.throws(() => f.flow.expireAttempts());
  assert.equal(row(f, "a").state, "pending");
  assert.equal(row(f, "b").claim, "claim-b");
  f.store.migrate("DROP TRIGGER integration_maintenance_fault");
  assert.deepEqual(f.flow.expireAttempts(), { expired: 1, interrupted: 1 });
});

test("current scoped status repairs its row beyond the batch backlog only after exact worker/binding authority", (t) => {
  const f = setup(t),
    start = f.flow.begin(f.binding, 0);
  f.store.run(
    "UPDATE integration_authorizations SET expires_at=0 WHERE id=?",
    start.id,
  );
  for (let i = 0; i < 105; i++) seed(f, `backlog-${i}`, "pending", -1);
  assert.throws(
    () => f.flow.status({ ...f.binding, realm: "5678" }, start.id),
    isCode("OAUTH_SCOPE"),
  );
  assert.equal(row(f, start.id).state, "pending");
  assert.equal(f.flow.status(f.binding, start.id).state, "expired");
  assert.equal(
    f.store.get(
      "SELECT count(*) AS n FROM integration_authorizations WHERE state='pending'",
    )!.n,
    105,
  );
  assert.throws(() => f.flow.cancel(f.binding, start.id), isCode("OAUTH_USED"));
});

test("browser status expires only this login's latest row, unauthorized login cannot mutate another attempt", (t) => {
  const f = setup(t);
  const first = f.app.identity.login("admin@example.test", password);
  const second = f.app.identity.login("admin@example.test", password);
  const start = f.flow.begin(f.binding, 0, first.token);
  f.store.run(
    "UPDATE integration_authorizations SET expires_at=0 WHERE id=?",
    start.id,
  );
  assert.throws(
    () => f.flow.status(f.binding, start.id, second.token),
    isCode("OAUTH_BROWSER"),
  );
  assert.equal(f.flow.browserStatus(f.binding, second.token).attempt, null);
  assert.equal(row(f, start.id).state, "pending");
  const viewed = f.flow.browserStatus(f.binding, first.token);
  assert.equal(viewed.attempt!.state, "expired");
  assert.deepEqual(
    Object.keys(viewed.attempt!).sort(),
    [
      "bindingId",
      "credentialRevision",
      "expiresAt",
      "id",
      "installedRevision",
      "startedAt",
      "state",
    ].sort(),
  );
});

test("local cleanup survives restart without a provider key or permission and leaves installed encrypted credentials unchanged", (t) => {
  const f = setup(t);
  f.app.providerCredentials.install(f.binding, 0, {
    accessToken: "synthetic-old-access",
    refreshToken: "synthetic-old-refresh",
    accessExpiresAt: Date.now() + 3600000,
    refreshExpiresAt: Date.now() + 86400000,
  });
  const start = f.flow.begin(f.binding, 1);
  f.store.run(
    "UPDATE integration_authorizations SET state='exchanging',claim='synthetic',started_at=0 WHERE id=?",
    start.id,
  );
  const vaultBefore = f.store.all("SELECT * FROM integration_credentials");
  chooseProviders(f, f.actor, "withdraw", {
    accountId: f.buyer,
    region: "CA",
    mode: "strict",
    providers: [],
    version: 2,
    acknowledgment: "Synthetic withdrawal",
  });
  f.app.close();
  f.app = new Application(f.path, "CA");
  const store = f.app.database.owned("integration");
  assert.equal(
    store.get(
      "SELECT state FROM integration_authorizations WHERE id=?",
      start.id,
    )!.state,
    "unknown",
  );
  assert.equal(
    store.get(
      "SELECT claim FROM integration_authorizations WHERE id=?",
      start.id,
    )!.claim,
    null,
  );
  assert.deepEqual(
    store.all("SELECT * FROM integration_credentials"),
    vaultBefore,
  );
  assert.equal(f.app.providerCredentials.available, false);
});

for (const phase of ["token", "company"] as const)
  for (const sweep of [true, false])
    test(`held ${phase} reply beyond 90 seconds cannot install tokens (${sweep ? "cleanup fences claim" : "completion checks deadline"})`, async (t) => {
      const f = setup(t);
      let now = Date.now();
      t.mock.method(Date, "now", () => now);
      f.app.providerCredentials.install(f.binding, 0, {
        accessToken: "synthetic-old-access",
        refreshToken: "synthetic-old-refresh",
        accessExpiresAt: now + 3600000,
        refreshExpiresAt: now + 86400000,
      });
      const vaultBefore = f.store.all("SELECT * FROM integration_credentials");
      const start = f.flow.begin(f.binding, 1),
        entered = deferred(),
        release = deferred();
      let calls = 0;
      mock(t, async () => {
        calls++;
        if (
          (phase === "token" && calls === 1) ||
          (phase === "company" && calls === 2)
        ) {
          entered.resolve();
          await release.promise;
        }
        return calls === 1
          ? tokens()
          : Response.json({ CompanyInfo: { Id: "1234" } });
      });
      const pending = f.flow.complete(
        f.binding,
        start.id,
        "synthetic-secret",
        callback(f, start),
      );
      await entered.promise;
      now += 90001;
      if (sweep)
        assert.deepEqual(f.flow.expireAttempts(), {
          expired: 0,
          interrupted: 1,
        });
      release.resolve();
      await assert.rejects(
        pending,
        isCode(sweep ? "OAUTH_STALE" : "OAUTH_EXPIRED"),
      );
      assert.equal(calls, phase === "token" ? 1 : 2);
      assert.equal(row(f, start.id).state, "unknown");
      assert.equal(row(f, start.id).claim, null);
      assert.deepEqual(
        f.store.all("SELECT * FROM integration_credentials"),
        vaultBefore,
      );
      assert.equal(f.app.providerCredentials.status(f.binding).revision, 1);
      await assert.rejects(
        f.flow.complete(
          f.binding,
          start.id,
          "synthetic-secret",
          callback(f, start),
        ),
        isCode("OAUTH_USED"),
      );
      assert.equal(calls, phase === "token" ? 1 : 2);
    });

test("an active exchange completing at exactly ninety seconds still installs once", async (t) => {
  const f = setup(t);
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const start = f.flow.begin(f.binding, 0);
  let calls = 0;
  mock(t, async () => {
    if (++calls === 1) {
      now += 90000;
      assert.deepEqual(f.flow.expireAttempts(), { expired: 0, interrupted: 0 });
      return tokens();
    }
    return Response.json({ CompanyInfo: { Id: "1234" } });
  });
  assert.equal(
    (
      await f.flow.complete(
        f.binding,
        start.id,
        "synthetic-secret",
        callback(f, start),
      )
    ).state,
    "completed",
  );
  assert.equal(calls, 2);
  assert.equal(f.app.providerCredentials.status(f.binding).revision, 1);
});

test("actual authenticated HTTP status repairs expiry with no provider request or bulk-maintenance route", async (t) => {
  const f = setup(t),
    session = f.app.identity.login("admin@example.test", password);
  const start = f.flow.begin(f.binding, 0, session.token);
  f.store.run(
    "UPDATE integration_authorizations SET expires_at=0 WHERE id=?",
    start.id,
  );
  mock(t, async () => {
    assert.fail("status must make no provider request");
  });
  const http = await createHttp(f.app, {
    origin,
    quickbooksBrowser: new QuickBooksBrowser(
      f.app,
      f.binding,
      "synthetic-secret",
      origin,
    ),
  });
  t.after(() => http.close());
  const cookie = `distributor_session=${session.token}`;
  const refused = await http.inject({
    method: "GET",
    url: "/api/quickbooks/authorization",
  });
  assert.equal(refused.statusCode, 401);
  assert.equal(row(f, start.id).state, "pending");
  const status = await http.inject({
    method: "GET",
    url: "/api/quickbooks/authorization",
    headers: { cookie },
  });
  assert.equal(status.statusCode, 200);
  assert.equal(status.json().attempt.state, "expired");
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: "/api/quickbooks/authorization/maintenance",
        headers: { cookie, origin, "x-csrf-token": session.csrf },
      })
    ).statusCode,
    404,
  );
});

function message(child: ChildProcess, predicate: (value: any) => boolean) {
  return new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Child timed out"));
    }, 15000);
    const receive = (value: any) => {
      if (predicate(value)) {
        cleanup();
        resolve(value);
      }
    };
    const exit = () => {
      cleanup();
      reject(new Error("Child exited before message"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.off("message", receive);
      child.off("exit", exit);
    };
    child.on("message", receive);
    child.once("exit", exit);
  });
}

test("a separate process's in-flight exchange is fenced by local cleanup; release cannot install or read company", async (t) => {
  const f = setup(t),
    start = f.flow.begin(f.binding, 0);
  const child = fork(
    new URL("./quickbooks-authorization-child.ts", import.meta.url),
    {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  t.after(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  });
  let wait = message(child, (m) => m.ready);
  child.send({
    action: "init",
    input: {
      path: f.path,
      key,
      binding: f.binding,
      attemptId: start.id,
      callback: callback(f, start),
    },
  });
  await wait;
  wait = message(child, (m) => m.requested);
  child.send({ action: "go" });
  await wait;
  f.store.run(
    "UPDATE integration_authorizations SET started_at=? WHERE id=?",
    Date.now() - 90001,
    start.id,
  );
  assert.deepEqual(f.flow.expireAttempts(), { expired: 0, interrupted: 1 });
  wait = message(child, (m) => m.ok !== undefined);
  child.send({ action: "release" });
  assert.deepEqual(await wait, { ok: false, code: "OAUTH_STALE", calls: 1 });
  assert.equal(f.app.providerCredentials.status(f.binding).revision, 0);
  assert.equal(row(f, start.id).state, "unknown");
});

test("independent process startup and concurrent batches drain 205 attempts without duplicate transitions", async (t) => {
  const f = setup(t);
  for (let i = 0; i < 205; i++)
    seed(f, `process-${i}`, i % 2 ? "exchanging" : "pending", 0, 0);
  const children = [0, 1].map(() =>
    fork(new URL("./quickbooks-maintenance-child.ts", import.meta.url), {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    }),
  );
  t.after(() => {
    for (const child of children)
      if (child.exitCode === null) child.kill("SIGKILL");
  });
  await Promise.all(
    children.map(async (child) => {
      const ready = message(child, (m) => m.ready);
      child.send({ action: "init", path: f.path });
      await ready;
    }),
  );
  assert.equal(
    f.store.get(
      "SELECT count(*) AS n FROM integration_authorizations WHERE state IN('pending','exchanging')",
    )!.n,
    5,
  );
  const results = await Promise.all(
    children.map(async (child) => {
      const wait = message(child, (m) => m.expired !== undefined);
      child.send({ action: "go" });
      return wait;
    }),
  );
  assert.equal(
    results.reduce((n, r) => n + r.expired + r.interrupted, 0),
    5,
  );
  assert.equal(
    f.store.get(
      "SELECT count(*) AS n FROM integration_authorizations WHERE state='expired'",
    )!.n,
    103,
  );
  assert.equal(
    f.store.get(
      "SELECT count(*) AS n FROM integration_authorizations WHERE state='unknown' AND claim IS NULL",
    )!.n,
    102,
  );
  assert.deepEqual(f.flow.expireAttempts(), { expired: 0, interrupted: 0 });
});

test("revoked worker and restored-provider hold block scoped reads but cannot prevent local expiry maintenance", (t) => {
  const f = setup(t),
    start = f.flow.begin(f.binding, 0);
  f.store.run(
    "UPDATE integration_authorizations SET expires_at=0 WHERE id=?",
    start.id,
  );
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='support' WHERE id=?", f.actor.id);
  f.app.database
    .owned("platform")
    .run(
      "INSERT INTO platform_recovery VALUES(1,'synthetic','synthetic',?)",
      Date.now(),
    );
  assert.throws(() => f.flow.status(f.binding, start.id), isCode("FORBIDDEN"));
  assert.equal(row(f, start.id).state, "pending");
  assert.deepEqual(f.flow.expireAttempts(), { expired: 1, interrupted: 0 });
  assert.equal(row(f, start.id).state, "expired");
});
