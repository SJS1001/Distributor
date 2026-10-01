import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { Application } from "../src/server/application.ts";
import {
  QuickBooksBrowser,
  configuredQuickBooksBrowser,
} from "../src/server/quickbooks-browser.ts";
import { createHttp } from "../src/server/http.ts";
import { digest } from "../src/server/core.ts";
import { fixture, chooseProviders } from "./fixtures.ts";

const origin = "http://127.0.0.1:3000";
const password = "long-test-only-password";
const security = { providerEncryptionKey: "ac".repeat(32) };
const isCode = (code: string) => (error: unknown) =>
  (error as { code: string }).code === code;
function setup(t: Parameters<typeof fixture>[0], requiredMfa = false) {
  const f = fixture(t, {
    ...security,
    ...(requiredMfa
      ? {
          mfaEncryptionKey: "ab".repeat(32),
          mfaRequiredRoles: ["finance" as const],
        }
      : {}),
  });
  chooseProviders(f, f.actor, "choice", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["quickbooks"],
    version: 1,
    acknowledgment: "Synthetic reviewed choice",
  });
  f.app.identity.createUser(f.actor, "finance", {
    email: "finance@example.test",
    name: "Synthetic finance",
    password,
    role: "finance",
    sites: [],
  });
  const session = f.app.identity.login("finance@example.test", password);
  const binding = {
    id: "browser-fixture",
    orgId: f.actor.orgId,
    workerUserId: f.actor.id,
    accountId: f.buyer,
    realm: "1234",
    clientId: "synthetic-client",
    redirectUri: `${origin}/quickbooks/callback`,
  };
  const browser = new QuickBooksBrowser(
    f.app,
    binding,
    "synthetic-client-secret",
    origin,
  );
  const flow = f.app.providerCredentials.authorization;
  const store = f.app.database.owned("integration");
  return { ...f, session, binding, browser, flow, store };
}
function callback(
  start: { authorizationUrl: string },
  params: Record<string, string> = {},
) {
  const url = new URL(`${origin}/quickbooks/callback`);
  url.search = new URLSearchParams({
    state: new URL(start.authorizationUrl).searchParams.get("state")!,
    code: "synthetic-code-private",
    realmId: "1234",
    ...params,
  }).toString();
  return url.href;
}
function mock(t: Parameters<typeof fixture>[0], fn: typeof fetch) {
  const original = globalThis.fetch;
  globalThis.fetch = fn;
  t.after(() => {
    globalThis.fetch = original;
  });
}
function tokens() {
  return Response.json({
    access_token: "synthetic-access-private",
    refresh_token: "synthetic-refresh-private",
    token_type: "bearer",
    expires_in: 3600,
    x_refresh_token_expires_in: 86400,
    x_refresh_token_hard_expires_in: 172800,
  });
}
function state(f: ReturnType<typeof setup>, id: string) {
  return f.store.get(
    "SELECT state FROM integration_authorizations WHERE id=?",
    id,
  )!.state;
}

test("browser authorization binds one current login, stores only hashes, isolates CLI attempts, and survives exact-profile restart", async (t) => {
  const f = setup(t),
    token = f.session.token;
  const start = f.browser.begin(token, 0);
  const row = f.store.get(
    "SELECT * FROM integration_authorizations WHERE id=?",
    start.id,
  )!;
  assert.equal(
    row.state_hash,
    `b1:${digest(token)}:${digest(new URL(start.authorizationUrl).searchParams.get("state")!)}`,
  );
  assert.equal(JSON.stringify(row).includes(token), false);
  const second = f.app.identity.login("finance@example.test", password).token;
  assert.equal(f.browser.status(second).attempt, null);
  assert.throws(
    () => f.browser.cancel(second, start.id),
    isCode("OAUTH_BROWSER"),
  );
  await assert.rejects(
    f.browser.complete(second, start.id, callback(start)),
    isCode("OAUTH_BROWSER"),
  );
  await assert.rejects(
    f.flow.complete(
      f.binding,
      start.id,
      "synthetic-client-secret",
      callback(start),
    ),
    isCode("OAUTH_BROWSER"),
  );
  assert.throws(
    () => f.flow.cancel(f.binding, start.id),
    isCode("OAUTH_BROWSER"),
  );
  assert.equal(state(f, start.id), "pending");
  let calls = 0;
  mock(t, async (url, init) => {
    calls++;
    assert.equal(init?.redirect, "error");
    if (calls === 1) {
      assert.equal(
        url,
        "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
      );
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        `Basic ${Buffer.from("synthetic-client:synthetic-client-secret").toString("base64")}`,
      );
      assert.equal(
        new URLSearchParams(String(init?.body)).get("redirect_uri"),
        f.binding.redirectUri,
      );
      return tokens();
    }
    assert.equal(
      url,
      "https://sandbox-quickbooks.api.intuit.com/v3/company/1234/companyinfo/1234",
    );
    return Response.json({
      CompanyInfo: { Id: "1234", CompanyName: "private-company" },
    });
  });
  const reopened = new Application(f.path, "CA", security);
  try {
    const browser = new QuickBooksBrowser(
      reopened,
      f.binding,
      "synthetic-client-secret",
      origin,
    );
    assert.equal(browser.status(token).attempt!.id, start.id);
    assert.equal(
      (await browser.complete(token, start.id, callback(start)))
        .installedRevision,
      1,
    );
    assert.equal(browser.status(token).credentials.state, "ready");
    await assert.rejects(
      browser.complete(token, start.id, callback(start)),
      isCode("OAUTH_USED"),
    );
    assert.equal(calls, 2);
    const publicResult = JSON.stringify(browser.status(token));
    for (const secret of [
      token,
      "synthetic-access-private",
      "synthetic-refresh-private",
      "private-company",
      "synthetic-code-private",
      "state_hash",
    ])
      assert.equal(publicResult.includes(secret), false);
  } finally {
    reopened.close();
  }
  const audits = f.app.database
    .owned("platform")
    .all(
      "SELECT actor_id,action,detail FROM platform_audit WHERE reference=? ORDER BY rowid",
      start.id,
    );
  assert.deepEqual(
    audits.map((r) => r.action),
    [
      "provider.authorization.begin",
      "provider.authorization.exchange",
      "provider.authorization.complete",
    ],
  );
  for (const r of audits.filter((r) =>
    String(r.action).startsWith("provider.authorization."),
  )) {
    assert.equal(r.actor_id, f.session.actor.id);
    assert.deepEqual(JSON.parse(String(r.detail)), {
      provider: "quickbooks",
      environment: "sandbox",
      workerUserId: f.actor.id,
    });
  }
  const installation = f.app.database
    .owned("platform")
    .get(
      "SELECT * FROM platform_audit WHERE action='provider.credentials.install' AND reference=?",
      f.binding.id,
    )!;
  assert.equal(installation.actor_id, f.actor.id);
  const cli = f.flow.begin(f.binding, 1);
  await assert.rejects(
    f.browser.complete(token, cli.id, callback(cli)),
    isCode("OAUTH_BROWSER"),
  );
  assert.equal(state(f, cli.id), "pending");
});

test("browser attempts recheck actual role, session expiry, forced password, MFA, organization and worker authority before acquiring a claim", async (t) => {
  const f = setup(t),
    start = f.browser.begin(f.session.token, 0),
    iam = f.app.database.owned("iam");
  let calls = 0;
  mock(t, async () => {
    calls++;
    throw Error("No IO allowed");
  });
  iam.run("UPDATE iam_users SET role='support' WHERE id=?", f.session.actor.id);
  assert.throws(() => f.browser.status(f.session.token), isCode("FORBIDDEN"));
  await assert.rejects(
    f.browser.complete(f.session.token, start.id, callback(start)),
    isCode("FORBIDDEN"),
  );
  iam.run("UPDATE iam_users SET role='finance' WHERE id=?", f.session.actor.id);
  iam.run(
    "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
    f.session.actor.id,
  );
  await assert.rejects(
    f.browser.complete(f.session.token, start.id, callback(start)),
    isCode("OAUTH_SECURITY"),
  );
  iam.run(
    "UPDATE iam_user_security SET password_change_required=0 WHERE user_id=?",
    f.session.actor.id,
  );
  assert.throws(
    () =>
      f.flow.begin({ ...f.binding, orgId: "other-org" }, 0, f.session.token),
    isCode("FORBIDDEN"),
  );
  iam.run("UPDATE iam_users SET active=0 WHERE id=?", f.actor.id);
  await assert.rejects(
    f.browser.complete(f.session.token, start.id, callback(start)),
    isCode("FORBIDDEN"),
  );
  iam.run("UPDATE iam_users SET active=1 WHERE id=?", f.actor.id);
  iam.run(
    "UPDATE iam_sessions SET expires_at=0 WHERE hash=?",
    digest(f.session.token),
  );
  await assert.rejects(
    f.browser.complete(f.session.token, start.id, callback(start)),
    isCode("UNAUTHENTICATED"),
  );
  assert.equal(state(f, start.id), "pending");
  assert.equal(calls, 0);
  const mfa = setup(t, true);
  assert.throws(
    () => mfa.browser.begin(mfa.session.token, 0),
    isCode("OAUTH_SECURITY"),
  );
});

for (const phase of ["token", "company"] as const) {
  for (const change of [
    "logout",
    "role",
    "password",
    "consent",
    "cancel",
  ] as const) {
    test(`browser authorization fences ${change} after ${phase} response and never installs stale tokens`, async (t) => {
      const f = setup(t),
        start = f.browser.begin(f.session.token, 0);
      let calls = 0;
      const mutate = () => {
        if (change === "logout") f.app.identity.logout(f.session.token);
        if (change === "role")
          f.app.database
            .owned("iam")
            .run(
              "UPDATE iam_users SET role='support' WHERE id=?",
              f.session.actor.id,
            );
        if (change === "password")
          f.app.database
            .owned("iam")
            .run(
              "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
              f.session.actor.id,
            );
        if (change === "consent")
          chooseProviders(f, f.actor, "withdraw", {
            accountId: f.buyer,
            region: "CA",
            mode: "strict",
            providers: [],
            version: 2,
            acknowledgment: "Synthetic withdrawal",
          });
        if (change === "cancel") f.browser.cancel(f.session.token, start.id);
      };
      mock(t, async () => {
        calls++;
        if (
          (phase === "token" && calls === 1) ||
          (phase === "company" && calls === 2)
        )
          mutate();
        return calls === 1
          ? tokens()
          : Response.json({ CompanyInfo: { Id: "1234" } });
      });
      await assert.rejects(
        f.browser.complete(f.session.token, start.id, callback(start)),
        (e) => (e as { status: number }).status === 503,
      );
      assert.equal(calls, phase === "token" ? 1 : 2);
      assert.equal(
        state(f, start.id),
        change === "cancel" ? "canceled" : "unknown",
      );
      assert.equal(f.app.providerCredentials.status(f.binding).revision, 0);
    });
  }
}

test("browser new attempt selects insertion order at tied timestamps, cancels prior claims, and preserves denial and expiry", async (t) => {
  const f = setup(t);
  const first = f.browser.begin(f.session.token, 0),
    second = f.browser.begin(f.session.token, 0);
  f.store.run(
    "UPDATE integration_authorizations SET expires_at=? WHERE id IN (?,?)",
    second.expiresAt,
    first.id,
    second.id,
  );
  assert.equal(f.browser.status(f.session.token).attempt!.id, second.id);
  assert.equal(state(f, first.id), "canceled");
  const denied = new URL(callback(second));
  denied.searchParams.delete("code");
  denied.searchParams.delete("realmId");
  denied.searchParams.set("error", "access_denied");
  assert.equal(
    (await f.browser.complete(f.session.token, second.id, denied.href)).state,
    "denied",
  );
  const third = f.browser.begin(f.session.token, 0);
  f.store.run(
    "UPDATE integration_authorizations SET expires_at=0 WHERE id=?",
    third.id,
  );
  await assert.rejects(
    f.browser.complete(f.session.token, third.id, callback(third)),
    isCode("OAUTH_EXPIRED"),
  );
  assert.equal(state(f, third.id), "expired");
});

test("browser startup is opt-in and rejects missing managed configuration and changed redirect without modifying the exact schema", (t) => {
  const f = setup(t);
  assert.equal(configuredQuickBooksBrowser(f.app, origin, {}), undefined);
  assert.throws(
    () =>
      configuredQuickBooksBrowser(f.app, origin, {
        QUICKBOOKS_BROWSER_AUTH_ENABLED: "true",
      }),
    isCode("OAUTH_CONFIG"),
  );
  assert.throws(
    () =>
      new QuickBooksBrowser(
        f.app,
        { ...f.binding, redirectUri: `${origin}/other` },
        "secret",
        origin,
      ),
    isCode("OAUTH_CONFIG"),
  );
  assert.throws(
    () => new QuickBooksBrowser(f.app, f.binding, "bad\nsecret", origin),
    isCode("OAUTH_CONFIG"),
  );
  const env = {
    QUICKBOOKS_BROWSER_AUTH_ENABLED: "true",
    PROVIDERS_ENABLED: "true",
    QUICKBOOKS_CREDENTIAL_MODE: "managed",
    PROVIDER_BINDING_ID: f.binding.id,
    PROVIDER_ORG_ID: f.binding.orgId,
    PROVIDER_WORKER_USER_ID: f.binding.workerUserId,
    QUICKBOOKS_REALM_ID: f.binding.realm,
    QUICKBOOKS_CLIENT_ID: f.binding.clientId,
    PROVIDER_ACCOUNT_ID: f.binding.accountId,
    QUICKBOOKS_REDIRECT_URI: f.binding.redirectUri,
    QUICKBOOKS_CLIENT_SECRET: "synthetic-client-secret",
  };
  assert.equal(
    configuredQuickBooksBrowser(f.app, origin, env)!.status(f.session.token)
      .enabled,
    true,
  );
  const missing = { ...env, PROVIDER_ACCOUNT_ID: "" };
  assert.throws(
    () => configuredQuickBooksBrowser(f.app, origin, missing),
    isCode("OAUTH_CONFIG"),
  );
});

test("enabled server logging omits callback queries, cookies, authorization headers and POST bodies", () => {
  const child = spawnSync(
    process.execPath,
    ["--import", "tsx", "tests/quickbooks-browser-log.ts"],
    { encoding: "utf8", timeout: 20000 },
  );
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
  const records = child.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.ok(records.some((r) => r.req?.url === "/quickbooks/callback"));
  for (const r of records.filter((r) => r.req))
    assert.deepEqual(Object.keys(r.req).sort(), ["method", "url"]);
  assert.ok(
    records.some(
      (r) => r.req?.url === "/api/quickbooks/authorization/complete",
    ),
  );
  for (const secret of [
    "synthetic-log-code",
    "synthetic-log-state",
    "synthetic-log-cookie",
    "synthetic-log-basic",
    "x-csrf-token",
    "callbackUrl",
    "distributor_session",
  ])
    assert.equal((child.stdout + child.stderr).includes(secret), false);
});

test("HTTP browser authorization requires finance, exact Origin/CSRF and strict configured payloads; callback GET never exchanges", async (t) => {
  const f = setup(t),
    http = await createHttp(f.app, {
      origin,
      staticRoot: "/missing-browser-build",
      quickbooksBrowser: f.browser,
    });
  t.after(() => http.close());
  const headers = {
    origin,
    cookie: `distributor_session=${f.session.token}`,
    "x-csrf-token": f.session.csrf,
  };
  const endpoint = "/api/quickbooks/authorization";
  let calls = 0;
  mock(t, async () => {
    calls++;
    return calls === 1
      ? tokens()
      : Response.json({ CompanyInfo: { Id: "1234" } });
  });
  assert.equal((await http.inject({ url: endpoint })).statusCode, 401);
  for (const badHeaders of [
    { ...headers, origin: "https://evil.example.test" },
    { ...headers, "x-csrf-token": "wrong" },
  ]) {
    assert.equal(
      (
        await http.inject({
          method: "POST",
          url: `${endpoint}/begin`,
          headers: badHeaders,
          payload: { revision: 0 },
        })
      ).statusCode,
      403,
    );
  }
  for (const payload of [
    { revision: "0" },
    { revision: -1 },
    { revision: 0, realm: "different" },
    {},
  ]) {
    assert.equal(
      (
        await http.inject({
          method: "POST",
          url: `${endpoint}/begin`,
          headers,
          payload,
        })
      ).statusCode,
      400,
    );
  }
  assert.equal(
    f.store.get("SELECT COUNT(*) AS total FROM integration_authorizations")!
      .total,
    0,
  );
  const begun = await http.inject({
    method: "POST",
    url: `${endpoint}/begin`,
    headers,
    payload: { revision: 0 },
  });
  assert.equal(begun.statusCode, 200);
  const start = begun.json();
  const landing = await http.inject({ url: callback(start) });
  assert.equal(landing.statusCode, 503);
  assert.equal(landing.headers["referrer-policy"], "no-referrer");
  assert.equal(landing.headers["cache-control"], "no-store");
  assert.equal(calls, 0);
  assert.equal(state(f, start.id), "pending");
  const other = f.app.identity.login("finance@example.test", password);
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: `${endpoint}/complete`,
        headers: {
          ...headers,
          cookie: `distributor_session=${other.token}`,
          "x-csrf-token": other.csrf,
        },
        payload: { attemptId: start.id, callbackUrl: callback(start) },
      })
    ).statusCode,
    403,
  );
  const completed = await http.inject({
    method: "POST",
    url: `${endpoint}/complete`,
    headers,
    payload: { attemptId: start.id, callbackUrl: callback(start) },
  });
  assert.equal(completed.statusCode, 200);
  assert.equal(completed.json().state, "completed");
  assert.equal(calls, 2);
  const summary = await http.inject({ url: endpoint, headers });
  assert.equal(summary.statusCode, 200);
  assert.equal(summary.json().credentials.revision, 1);
  for (const secret of [
    f.session.token,
    "synthetic-access-private",
    "synthetic-refresh-private",
    "synthetic-code-private",
    "synthetic-client-secret",
    "state_hash",
  ])
    assert.equal(summary.body.includes(secret), false);
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='support' WHERE id=?", f.session.actor.id);
  assert.equal((await http.inject({ url: endpoint, headers })).statusCode, 403);
  const disabled = await createHttp(f.app, {
    origin,
    staticRoot: "/missing-browser-build",
  });
  t.after(() => disabled.close());
  const admin = f.app.identity.login("admin@example.test", password);
  const adminHeaders = {
    origin,
    cookie: `distributor_session=${admin.token}`,
    "x-csrf-token": admin.csrf,
  };
  assert.deepEqual(
    (await disabled.inject({ url: endpoint, headers: adminHeaders })).json(),
    { enabled: false },
  );
  assert.equal(
    (
      await disabled.inject({
        method: "POST",
        url: `${endpoint}/begin`,
        headers: adminHeaders,
        payload: { revision: 0 },
      })
    ).statusCode,
    503,
  );
});

function installed(f: ReturnType<typeof setup>, expired = false) {
  f.app.providerCredentials.install(f.binding, 0, {
    accessToken: "synthetic-disconnect-access",
    refreshToken: "synthetic-disconnect-refresh",
    accessExpiresAt: Date.now() + (expired ? -1000 : 3600000),
    refreshExpiresAt: Date.now() + 86400000,
  });
}

test("browser disconnect removes only configured material, cancels all its pending initiators, audits the human and survives restart without IO", async (t) => {
  const f = setup(t);
  installed(f);
  const foreign = { ...f.binding, id: "other-binding" };
  f.app.providerCredentials.install(foreign, 0, {
    accessToken: "synthetic-other-access",
    refreshToken: "synthetic-other-refresh",
    accessExpiresAt: Date.now() + 3600000,
    refreshExpiresAt: Date.now() + 86400000,
  });
  const otherBefore = f.store.get(
    "SELECT * FROM integration_credentials WHERE binding_id=?",
    foreign.id,
  );
  const own = f.browser.begin(f.session.token, 1);
  const cli = f.flow.begin(f.binding, 1);
  const another = f.app.identity.login("finance@example.test", password);
  const latest = f.browser.begin(another.token, 1);
  let calls = 0;
  mock(t, async () => {
    calls++;
    throw Error("No disconnect IO");
  });
  chooseProviders(f, f.actor, "disconnect-withdraw", {
    accountId: f.buyer,
    region: "CA",
    mode: "strict",
    providers: [],
    version: 2,
    acknowledgment: "Synthetic withdrawal",
  });
  assert.equal(f.browser.disconnect(f.session.token, 1).state, "disabled");
  assert.equal(f.browser.status(f.session.token).credentials.revision, 2);
  for (const start of [own, cli, latest])
    assert.equal(state(f, start.id), "canceled");
  const disabled = f.store.get(
    "SELECT * FROM integration_credentials WHERE binding_id=?",
    f.binding.id,
  )!;
  assert.equal(disabled.material, null);
  assert.equal(disabled.claim, null);
  assert.equal(disabled.started_at, null);
  assert.deepEqual(
    f.store.get(
      "SELECT * FROM integration_credentials WHERE binding_id=?",
      foreign.id,
    ),
    otherBefore,
  );
  assert.throws(
    () => f.browser.disconnect(f.session.token, 1),
    isCode("REVISION"),
  );
  const audit = f.app.database
    .owned("platform")
    .get(
      "SELECT * FROM platform_audit WHERE action='provider.authorization.disconnect'",
    )!;
  assert.equal(audit.actor_id, f.session.actor.id);
  assert.deepEqual(JSON.parse(String(audit.detail)), {
    provider: "quickbooks",
    environment: "sandbox",
    workerUserId: f.actor.id,
    revision: 2,
    canceledAttempts: 1,
  });
  const reopened = new Application(f.path, "CA", security);
  try {
    const browser = new QuickBooksBrowser(
      reopened,
      f.binding,
      "synthetic-client-secret",
      origin,
    );
    assert.equal(browser.status(f.session.token).credentials.state, "disabled");
    assert.equal(browser.status(another.token).attempt!.state, "canceled");
  } finally {
    reopened.close();
  }
  assert.equal(calls, 0);
  for (const secret of [
    "synthetic-disconnect-access",
    "synthetic-disconnect-refresh",
  ])
    assert.equal(readFileSync(f.path).includes(Buffer.from(secret)), false);
});

test("browser disconnect rejects stale revisions and current login/role/password/MFA/worker scope before mutations", (t) => {
  const f = setup(t);
  installed(f);
  const start = f.browser.begin(f.session.token, 1);
  const iam = f.app.database.owned("iam");
  const before = f.store.get("SELECT * FROM integration_credentials");
  assert.throws(
    () => f.browser.disconnect(f.session.token, 0),
    isCode("REVISION"),
  );
  assert.throws(
    () =>
      f.flow.disconnect({ ...f.binding, orgId: "other" }, f.session.token, 1),
    isCode("FORBIDDEN"),
  );
  iam.run("UPDATE iam_users SET role='support' WHERE id=?", f.session.actor.id);
  assert.throws(
    () => f.browser.disconnect(f.session.token, 1),
    isCode("FORBIDDEN"),
  );
  iam.run("UPDATE iam_users SET role='finance' WHERE id=?", f.session.actor.id);
  iam.run(
    "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
    f.session.actor.id,
  );
  assert.throws(
    () => f.browser.disconnect(f.session.token, 1),
    isCode("OAUTH_SECURITY"),
  );
  iam.run(
    "UPDATE iam_user_security SET password_change_required=0 WHERE user_id=?",
    f.session.actor.id,
  );
  iam.run("UPDATE iam_users SET active=0 WHERE id=?", f.actor.id);
  assert.throws(
    () => f.browser.disconnect(f.session.token, 1),
    isCode("FORBIDDEN"),
  );
  iam.run("UPDATE iam_users SET active=1 WHERE id=?", f.actor.id);
  f.app.identity.logout(f.session.token);
  assert.throws(
    () => f.browser.disconnect(f.session.token, 1),
    isCode("UNAUTHENTICATED"),
  );
  assert.deepEqual(
    f.store.get("SELECT * FROM integration_credentials"),
    before,
  );
  assert.equal(state(f, start.id), "pending");
  const mfa = setup(t, true);
  installed(mfa);
  assert.throws(
    () => mfa.browser.disconnect(mfa.session.token, 1),
    isCode("OAUTH_SECURITY"),
  );
  assert.equal(mfa.app.providerCredentials.status(mfa.binding).state, "ready");
});

test("late human disconnect audit failure rolls back tokens, revision, canceled attempts and earlier worker audit", (t) => {
  const f = setup(t);
  installed(f);
  const start = f.browser.begin(f.session.token, 1);
  const before = f.store.get("SELECT * FROM integration_credentials");
  const audits = f.app.database
    .owned("platform")
    .all("SELECT * FROM platform_audit ORDER BY rowid");
  const original = f.app.platform.audit;
  f.app.platform.audit = (...args: Parameters<typeof original>) => {
    if (args[1] === "provider.authorization.disconnect")
      throw Error("Synthetic late audit fault");
    return original.apply(f.app.platform, args);
  };
  try {
    assert.throws(
      () => f.browser.disconnect(f.session.token, 1),
      /Synthetic late audit fault/,
    );
  } finally {
    f.app.platform.audit = original;
  }
  assert.deepEqual(
    f.store.get("SELECT * FROM integration_credentials"),
    before,
  );
  assert.equal(state(f, start.id), "pending");
  assert.deepEqual(
    f.app.database
      .owned("platform")
      .all("SELECT * FROM platform_audit ORDER BY rowid"),
    audits,
  );
});

for (const phase of ["token", "company"] as const) {
  test(`disconnect fences an authorization response at ${phase} and cannot reinstall stored tokens`, async (t) => {
    const f = setup(t);
    installed(f);
    const start = f.browser.begin(f.session.token, 1);
    let calls = 0;
    mock(t, async () => {
      calls++;
      if (calls === (phase === "token" ? 1 : 2))
        f.browser.disconnect(f.session.token, 1);
      return calls === 1
        ? tokens()
        : Response.json({ CompanyInfo: { Id: "1234" } });
    });
    await assert.rejects(
      f.browser.complete(f.session.token, start.id, callback(start)),
      (e) => (e as { status: number }).status === 503,
    );
    assert.equal(calls, phase === "token" ? 1 : 2);
    assert.equal(state(f, start.id), "canceled");
    assert.equal(
      f.browser.status(f.session.token).credentials.state,
      "disabled",
    );
    assert.equal(f.browser.status(f.session.token).credentials.revision, 2);
    assert.equal(
      f.store.get("SELECT material FROM integration_credentials")!.material,
      null,
    );
  });
}

test("browser disconnect fences an in-flight refresh and works without a decryption key after restart", async (t) => {
  const f = setup(t);
  installed(f, true);
  mock(t, async () => {
    f.browser.disconnect(f.session.token, 1);
    return tokens();
  });
  const effect = {
    id: "synthetic-effect",
    org_id: f.actor.orgId,
    account_id: f.buyer,
    provider: "quickbooks" as const,
    kind: "invoice",
    reference: "synthetic",
    payload: "{}",
    state: "pending",
    external_ref: null,
    result: null,
    created_at: new Date().toISOString(),
    residency_version: 2,
    started_at: null,
    error: null,
  };
  await assert.rejects(
    f.app.providerCredentials.access(f.binding, "secret", effect),
    isCode("CREDENTIAL_STALE"),
  );
  assert.equal(f.browser.status(f.session.token).credentials.state, "disabled");
  f.app.providerCredentials.install(f.binding, 2, {
    accessToken: "synthetic-new",
    refreshToken: "synthetic-new-refresh",
    accessExpiresAt: Date.now() + 3600000,
    refreshExpiresAt: Date.now() + 86400000,
  });
  const withoutKey = new Application(f.path, "CA");
  try {
    // Native browser-owned command can remove encrypted material without reading it.
    // Normal opted-in browser startup still requires its configured encryption key.
    assert.equal(
      withoutKey.providerCredentials.authorization.disconnect(
        f.binding,
        f.session.token,
        3,
      ).revision,
      4,
    );
    assert.equal(
      withoutKey.providerCredentials.status(f.binding).state,
      "disabled",
    );
  } finally {
    withoutKey.close();
  }
});

test("HTTP disconnect enforces login, strict revision, Origin/CSRF, fixed binding and current finance authority", async (t) => {
  const f = setup(t);
  installed(f);
  const http = await createHttp(f.app, {
    origin,
    quickbooksBrowser: f.browser,
  });
  t.after(() => http.close());
  const headers = {
    origin,
    cookie: `distributor_session=${f.session.token}`,
    "x-csrf-token": f.session.csrf,
  };
  const url = "/api/quickbooks/authorization/disconnect";
  const post = (payload: object, h = headers) =>
    http.inject({ method: "POST", url, headers: h, payload });
  assert.equal(
    (await post({ revision: 1 }, { ...headers, cookie: "" })).statusCode,
    401,
  );
  assert.equal(
    (
      await post(
        { revision: 1 },
        { ...headers, origin: "https://evil.example.test" },
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (await post({ revision: 1 }, { ...headers, "x-csrf-token": "wrong" }))
      .statusCode,
    403,
  );
  for (const payload of [
    {},
    { revision: "1" },
    { revision: -1 },
    { revision: 1, bindingId: "other" },
  ])
    assert.equal((await post(payload)).statusCode, 400);
  assert.equal((await post({ revision: 0 })).json().code, "REVISION");
  assert.equal(f.browser.status(f.session.token).credentials.state, "ready");
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='support' WHERE id=?", f.session.actor.id);
  assert.equal((await post({ revision: 1 })).statusCode, 403);
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='finance' WHERE id=?", f.session.actor.id);
  const result = await post({ revision: 1 });
  assert.equal(result.statusCode, 200);
  assert.equal(result.json().state, "disabled");
  assert.equal(result.json().revision, 2);
  assert.equal(result.body.includes("synthetic-disconnect"), false);
  const disabled = await createHttp(f.app, { origin });
  try {
    assert.equal(
      (
        await disabled.inject({
          method: "POST",
          url,
          headers,
          payload: { revision: 2 },
        })
      ).statusCode,
      503,
    );
  } finally {
    await disabled.close();
  }
});
