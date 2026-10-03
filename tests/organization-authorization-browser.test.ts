import { test } from "node:test";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import assert from "node:assert/strict";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import {
  OrganizationQuickBooksBrowser,
  configuredOrganizationQuickBooksBrowser,
} from "../src/server/organization-quickbooks-browser.ts";
import { fixture, syntheticDisclosure } from "./fixtures.ts";

const origin = "http://127.0.0.1:3000";
const password = "long-test-only-password";
const security = { providerEncryptionKey: "ab".repeat(32) };
type T = Parameters<typeof fixture>[0];
const isCode = (code: string) => (error: unknown) =>
  (error as { code?: string }).code === code;
function setup(t: T, region: "CA" | "US" = "CA") {
  const f = fixture(t, security, region);
  const residency = f.app.identity.organizationResidency;
  const { provider: _provider, ...terms } = syntheticDisclosure(
    f.app,
    "quickbooks",
  );
  residency.publish(f.actor, "org-terms", terms);
  const binding = {
    id: "synthetic-org-browser",
    orgId: f.actor.orgId,
    workerUserId: f.actor.id,
    realm: "1234",
    clientId: "synthetic-client",
    redirectUri: `${origin}/quickbooks/organization/callback`,
  };
  const current = residency.current(f.actor);
  residency.choose(f.actor, "org-choice", {
    region,
    revision: current.choice.revision,
    mode: "provider-exception",
    realm: binding.realm,
    acknowledgment: "Synthetic reviewed organization choice",
    acceptance: {
      disclosureId: current.terms!.id,
      disclosureHash: current.terms!.hash,
      representative: "Synthetic representative",
      evidenceRef: "synthetic:review",
    },
  });
  f.app.identity.createUser(f.actor, "finance", {
    email: "finance@example.test",
    name: "Synthetic finance",
    password,
    role: "finance",
    sites: [],
  });
  return {
    ...f,
    binding,
    authority: residency.permission(f.actor, binding.realm),
    flow: f.app.providerCredentials.ledger.authorization,
    session: f.app.identity.login("finance@example.test", password),
  };
}
function callback(start: { authorizationUrl: string }) {
  const url = new URL(`${origin}/quickbooks/organization/callback`);
  url.search = new URLSearchParams({
    state: new URL(start.authorizationUrl).searchParams.get("state")!,
    code: "synthetic-private-code",
    realmId: "1234",
  }).toString();
  return url.href;
}
function mock(t: T, fn: typeof fetch) {
  const original = globalThis.fetch;
  globalThis.fetch = fn;
  t.after(() => {
    globalThis.fetch = original;
  });
}
function tokens() {
  return Response.json({
    access_token: "synthetic-private-org-access",
    refresh_token: "synthetic-private-org-refresh",
    token_type: "bearer",
    expires_in: 3600,
    x_refresh_token_expires_in: 8640000,
  });
}
test("organization browser attempt belongs to exactly one live login and cannot be taken over by the operator", async (t) => {
  const f = setup(t);
  const start = f.flow.begin(f.binding, 0, f.authority, f.session.token);
  const second = f.app.identity.login("finance@example.test", password);
  assert.throws(
    () => f.flow.status(f.binding, start.id, second.token),
    isCode("OAUTH_BROWSER"),
  );
  assert.throws(
    () => f.flow.status(f.binding, start.id),
    isCode("OAUTH_BROWSER"),
  );
  assert.throws(
    () => f.flow.cancel(f.binding, start.id, second.token),
    isCode("OAUTH_BROWSER"),
  );
  assert.equal(f.flow.browserStatus(f.binding, second.token).attempt, null);
  assert.equal(
    f.flow.browserStatus(f.binding, f.session.token).attempt?.id,
    start.id,
  );
  assert.equal(
    f.flow.status(f.binding, start.id, f.session.token).state,
    "pending",
  );
  const resumed = new Application(f.path, "CA", security);
  try {
    assert.equal(
      resumed.providerCredentials.ledger.authorization.browserStatus(
        f.binding,
        f.session.token,
      ).attempt?.id,
      start.id,
    );
    assert.equal(
      resumed.providerCredentials.ledger.authorization.cancel(
        f.binding,
        start.id,
        f.session.token,
      ).state,
      "canceled",
    );
  } finally {
    resumed.close();
  }
});
test("organization HTTP authorization requires exact reviewed authority, finance, Origin and CSRF; callback GET never exchanges", async (t) => {
  const f = setup(t);
  const browser = new OrganizationQuickBooksBrowser(
    f.app,
    f.binding,
    "synthetic-secret",
    origin,
  );
  const http = await createHttp(f.app, {
    origin,
    staticRoot: "/missing-browser-build",
    organizationQuickbooksBrowser: browser,
  });
  t.after(() => http.close());
  const endpoint = "/api/quickbooks/organization/authorization";
  const headers = {
    origin,
    cookie: `distributor_session=${f.session.token}`,
    "x-csrf-token": f.session.csrf,
  };
  let calls = 0;
  mock(t, async (url, options) => {
    calls++;
    if (calls === 1) {
      assert.equal(
        String(url),
        "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
      );
      assert.equal(options?.method, "POST");
      assert.equal(
        new URLSearchParams(String(options?.body)).get("redirect_uri"),
        `${origin}/quickbooks/organization/callback`,
      );
      return tokens();
    }
    assert.equal(
      String(url),
      "https://sandbox-quickbooks.api.intuit.com/v3/company/1234/companyinfo/1234",
    );
    return Response.json({ CompanyInfo: { Id: "1234" } });
  });
  assert.equal((await http.inject({ url: endpoint })).statusCode, 401);
  assert.equal(
    (await http.inject({ url: endpoint, headers })).json().scope,
    "organization",
  );
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
          payload: { revision: 0, authority: f.authority },
        })
      ).statusCode,
      403,
    );
  }
  for (const payload of [
    { revision: 0 },
    { revision: "0", authority: f.authority },
    { revision: 0, authority: { ...f.authority, accountId: f.buyer } },
    { revision: 0, authority: f.authority, realm: "5678" },
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
  const started = await http.inject({
    method: "POST",
    url: `${endpoint}/begin`,
    headers,
    payload: { revision: 0, authority: f.authority },
  });
  assert.equal(started.statusCode, 200, started.body);
  const start = started.json();
  const landed = await http.inject({ url: callback(start) });
  assert.equal(landed.statusCode, 503);
  assert.equal(landed.headers["referrer-policy"], "no-referrer");
  assert.equal(calls, 0);
  const completed = await http.inject({
    method: "POST",
    url: `${endpoint}/complete`,
    headers,
    payload: { attemptId: start.id, callbackUrl: callback(start) },
  });
  assert.equal(completed.statusCode, 200, completed.body);
  assert.equal(completed.json().state, "completed");
  assert.equal(completed.json().installedRevision, 1);
  assert.equal(calls, 2);
  assert.equal(
    f.app.providerCredentials.ledger.status(f.binding).state,
    "ready",
  );
  assert.equal(f.app.providerCredentials.status(f.binding).state, "missing");
  for (const secret of [
    "synthetic-private-code",
    "synthetic-private-org-access",
    "synthetic-private-org-refresh",
    "synthetic-secret",
    f.session.token,
  ])
    assert.ok(!completed.body.includes(secret));
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: `${endpoint}/complete`,
        headers,
        payload: { attemptId: start.id, callbackUrl: callback(start) },
      })
    ).json().code,
    "OAUTH_USED",
  );
  assert.equal(calls, 2);
});

test("organization HTTP local disconnect is revision-bound, keyless after withdrawal, and cancels pending authorization without touching buyer credentials", async (t) => {
  const f = setup(t);
  f.app.providerCredentials.ledger.install(
    f.binding,
    0,
    {
      accessToken: "synthetic-installed-access",
      refreshToken: "synthetic-installed-refresh",
      accessExpiresAt: Date.now() + 3600000,
      refreshExpiresAt: Date.now() + 86400000,
    },
    f.authority,
  );
  const start = f.flow.begin(f.binding, 1, f.authority, f.session.token);
  const residency = f.app.identity.organizationResidency;
  residency.choose(f.actor, "withdraw", {
    region: "CA",
    revision: residency.current(f.actor).choice.revision,
    mode: "strict",
    realm: null,
    acknowledgment: "Synthetic withdrawal",
  });
  const offline = new Application(f.path, "CA");
  t.after(() => offline.close());
  const browser = new OrganizationQuickBooksBrowser(
    offline,
    f.binding,
    "synthetic-secret",
    origin,
  );
  const http = await createHttp(offline, {
    origin,
    staticRoot: "/missing-browser-build",
    organizationQuickbooksBrowser: browser,
  });
  t.after(() => http.close());
  const endpoint = "/api/quickbooks/organization/authorization/disconnect";
  const headers = {
    origin,
    cookie: `distributor_session=${f.session.token}`,
    "x-csrf-token": f.session.csrf,
  };
  let calls = 0;
  mock(t, async () => {
    calls++;
    throw new Error("No provider IO allowed");
  });
  const stale = await http.inject({
    method: "POST",
    url: endpoint,
    headers,
    payload: { revision: 0 },
  });
  assert.equal(stale.json().code, "REVISION", stale.body);
  assert.equal(
    offline.providerCredentials.ledger.status(f.binding).state,
    "ready",
  );
  assert.equal(
    offline.providerCredentials.ledger.authorization.status(
      f.binding,
      start.id,
      f.session.token,
    ).state,
    "pending",
  );
  for (const payload of [{ revision: "1" }, { revision: 1, realm: "9999" }])
    assert.equal(
      (await http.inject({ method: "POST", url: endpoint, headers, payload }))
        .statusCode,
      400,
    );
  const result = await http.inject({
    method: "POST",
    url: endpoint,
    headers,
    payload: { revision: 1 },
  });
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json().state, "disabled");
  assert.equal(result.json().revision, 2);
  assert.equal(
    offline.providerCredentials.ledger.authorization.status(
      f.binding,
      start.id,
      f.session.token,
    ).state,
    "canceled",
  );
  assert.equal(offline.providerCredentials.status(f.binding).state, "missing");
  assert.equal(calls, 0);
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: endpoint,
        headers,
        payload: { revision: 1 },
      })
    ).json().code,
    "REVISION",
  );
});

for (const region of ["CA", "US"] as const) {
  for (const stage of ["token", "company"] as const) {
    for (const change of ["logout", "withdraw", "disconnect"] as const) {
      test(`${region} organization browser ${change} during ${stage} response fences credential installation`, async (t) => {
        const f = setup(t, region);
        f.app.providerCredentials.ledger.install(
          f.binding,
          0,
          {
            accessToken: "synthetic-prior-access",
            refreshToken: "synthetic-prior-refresh",
            accessExpiresAt: Date.now() + 3600000,
            refreshExpiresAt: Date.now() + 86400000,
          },
          f.authority,
        );
        const start = f.flow.begin(f.binding, 1, f.authority, f.session.token);
        let calls = 0;
        mock(t, async (url) => {
          calls++;
          const isToken = String(url).includes("tokens/bearer");
          if ((stage === "token") === isToken) {
            if (change === "logout") f.app.identity.logout(f.session.token);
            else if (change === "disconnect")
              f.flow.disconnect(f.binding, f.session.token, 1);
            else {
              const residency = f.app.identity.organizationResidency;
              residency.choose(f.actor, "withdraw", {
                region,
                revision: residency.current(f.actor).choice.revision,
                mode: "strict",
                realm: null,
                acknowledgment: "Synthetic withdrawal",
              });
            }
          }
          return isToken
            ? tokens()
            : Response.json({ CompanyInfo: { Id: "1234" } });
        });
        await assert.rejects(
          f.flow.complete(
            f.binding,
            start.id,
            "synthetic-secret",
            callback(start),
            f.session.token,
          ),
        );
        assert.equal(calls, stage === "token" ? 1 : 2);
        const credentials = f.app.providerCredentials.ledger.status(f.binding);
        assert.equal(
          credentials.state,
          change === "disconnect" ? "disabled" : "ready",
        );
        assert.equal(credentials.revision, change === "disconnect" ? 2 : 1);
        if (change !== "logout")
          assert.equal(
            f.flow.status(f.binding, start.id, f.session.token).state,
            change === "disconnect" ? "canceled" : "unknown",
          );
        assert.equal(
          f.app.providerCredentials.status(f.binding).state,
          "missing",
        );
      });
    }
  }
}

test("organization browser configuration is independent, default disabled and refuses insecure non-loopback callbacks", (t) => {
  const f = setup(t);
  const env = {
    QUICKBOOKS_LEDGER_BROWSER_AUTH_ENABLED: "true",
    PROVIDERS_ENABLED: "true",
    LEDGER_PROVIDER_BINDING_ID: f.binding.id,
    LEDGER_PROVIDER_ORG_ID: f.binding.orgId,
    LEDGER_PROVIDER_WORKER_USER_ID: f.binding.workerUserId,
    LEDGER_QUICKBOOKS_REALM_ID: "1234",
    LEDGER_QUICKBOOKS_CLIENT_ID: "synthetic-client",
    LEDGER_QUICKBOOKS_REDIRECT_URI: f.binding.redirectUri,
    LEDGER_QUICKBOOKS_CLIENT_SECRET: "synthetic-secret",
  };
  assert.equal(
    configuredOrganizationQuickBooksBrowser(f.app, origin, {}),
    undefined,
  );
  assert.equal(
    configuredOrganizationQuickBooksBrowser(f.app, origin, {
      PROVIDERS_ENABLED: "true",
      QUICKBOOKS_BROWSER_AUTH_ENABLED: "true",
    }),
    undefined,
  );
  assert.equal(
    configuredOrganizationQuickBooksBrowser(f.app, origin, env)?.status(
      f.session.token,
    ).realm,
    "1234",
  );
  assert.throws(
    () =>
      configuredOrganizationQuickBooksBrowser(f.app, origin, {
        ...env,
        PROVIDERS_ENABLED: "false",
      }),
    isCode("OAUTH_CONFIG"),
  );
  for (const name of Object.keys(env).filter((name) =>
    name.startsWith("LEDGER_"),
  )) {
    assert.throws(
      () =>
        configuredOrganizationQuickBooksBrowser(f.app, origin, {
          ...env,
          [name]: "",
          PROVIDER_BINDING_ID: f.binding.id,
          QUICKBOOKS_CLIENT_SECRET: "synthetic-buyer-secret",
        }),
      isCode("OAUTH_CONFIG"),
    );
  }
  assert.throws(
    () =>
      new OrganizationQuickBooksBrowser(
        f.app,
        { ...f.binding, redirectUri: `${origin}/quickbooks/callback` },
        "synthetic-secret",
        origin,
      ),
    isCode("OAUTH_CONFIG"),
  );
  assert.throws(
    () =>
      new OrganizationQuickBooksBrowser(
        f.app,
        f.binding,
        "secret\nwith-line-break",
        origin,
      ),
    isCode("OAUTH_CONFIG"),
  );
  const insecureOrigin = "http://synthetic.example.test";
  assert.throws(
    () =>
      new OrganizationQuickBooksBrowser(
        f.app,
        {
          ...f.binding,
          redirectUri: `${insecureOrigin}/quickbooks/organization/callback`,
        },
        "synthetic-secret",
        insecureOrigin,
      ),
    isCode("OAUTH_CONFIG"),
  );
});

test("disabled organization callback refuses safely even with a browser build", async (t) => {
  const f = setup(t);
  const root = mkdtempSync(join(tmpdir(), "distributor-org-callback-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    join(root, "index.html"),
    "<html>Unrelated existing workspace</html>",
  );
  const http = await createHttp(f.app, { origin, staticRoot: root });
  t.after(() => http.close());
  let calls = 0;
  mock(t, async () => {
    calls++;
    throw new Error("No provider IO allowed");
  });
  const landing = await http.inject({
    url: "/quickbooks/organization/callback?code=synthetic-private-code&state=synthetic-private-state&realmId=1234",
    headers: { cookie: "distributor_session=invalid-cross-site-cookie" },
  });
  assert.equal(landing.statusCode, 503);
  assert.equal(landing.headers["referrer-policy"], "no-referrer");
  assert.equal(landing.headers["cache-control"], "no-store");
  assert.equal(landing.json().code, "UNAVAILABLE");
  assert.ok(!landing.body.includes("Unrelated existing workspace"));
  assert.ok(!landing.body.includes("synthetic-private"));
  assert.equal(calls, 0);
});

test("enabled organization callback serves its browser shell without provider exchange or callback disclosure", async (t) => {
  const f = setup(t);
  const root = mkdtempSync(join(tmpdir(), "distributor-org-callback-enabled-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    join(root, "index.html"),
    "<html>Organization callback shell</html>",
  );
  const http = await createHttp(f.app, {
    origin,
    staticRoot: root,
    organizationQuickbooksBrowser: new OrganizationQuickBooksBrowser(
      f.app,
      f.binding,
      "synthetic-secret",
      origin,
    ),
  });
  t.after(() => http.close());
  let calls = 0;
  mock(t, async () => {
    calls++;
    throw Error("No provider IO allowed");
  });
  const start = f.flow.begin(f.binding, 0, f.authority, f.session.token);
  const summary = f.flow.browserStatus(f.binding, f.session.token);
  assert.deepEqual((summary.attempt as any).authority, f.authority);
  const landing = await http.inject({ url: callback(start) });
  assert.equal(landing.statusCode, 200);
  assert.equal(landing.headers["cache-control"], "no-store");
  assert.equal(landing.headers["referrer-policy"], "no-referrer");
  assert.match(landing.body, /Organization callback shell/);
  assert.ok(!landing.body.includes("synthetic-private"));
  assert.equal(calls, 0);
});

test("organization logging omits callback query, authentication and completion body", () => {
  const child = spawnSync(
    process.execPath,
    ["--import", "tsx", "tests/organization-quickbooks-browser-log.ts"],
    { env: { PATH: process.env.PATH }, encoding: "utf8", timeout: 20000 },
  );
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
  const records = child.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.ok(
    records.some((r) => r.req?.url === "/quickbooks/organization/callback"),
  );
  assert.ok(
    records.some(
      (r) =>
        r.req?.url === "/api/quickbooks/organization/authorization/complete",
    ),
  );
  for (const r of records.filter((r) => r.req))
    assert.deepEqual(Object.keys(r.req).sort(), ["method", "url"]);
  for (const secret of [
    "synthetic-log-code",
    "synthetic-log-state",
    "synthetic-log-cookie",
    "synthetic-log-basic",
    "x-csrf-token",
    "callbackUrl",
    "distributor_session",
  ])
    assert.ok(!(child.stdout + child.stderr).includes(secret));
});

test("disabled organization HTTP reports status only to unbound finance and refuses every command", async (t) => {
  const f = setup(t);
  f.app.identity.createUser(f.actor, "support", {
    email: "support@example.test",
    name: "Synthetic support",
    password,
    role: "support",
    sites: [],
  });
  const support = f.app.identity.login("support@example.test", password);
  const http = await createHttp(f.app, {
    origin,
    staticRoot: "/missing-browser-build",
  });
  t.after(() => http.close());
  const endpoint = "/api/quickbooks/organization/authorization";
  const headers = {
    origin,
    cookie: `distributor_session=${f.session.token}`,
    "x-csrf-token": f.session.csrf,
  };
  assert.deepEqual((await http.inject({ url: endpoint, headers })).json(), {
    enabled: false,
  });
  assert.equal(
    (
      await http.inject({
        url: endpoint,
        headers: { cookie: `distributor_session=${support.token}` },
      })
    ).statusCode,
    403,
  );
  for (const [action, payload] of [
    ["begin", { revision: 0, authority: f.authority }],
    ["cancel", { attemptId: "synthetic-attempt" }],
    [
      "complete",
      {
        attemptId: "synthetic-attempt",
        callbackUrl: `${origin}/quickbooks/organization/callback`,
      },
    ],
    ["disconnect", { revision: 0 }],
  ] as const)
    assert.equal(
      (
        await http.inject({
          method: "POST",
          url: `${endpoint}/${action}`,
          headers,
          payload,
        })
      ).json().code,
      "PROVIDER_DISABLED",
    );
});

test("organization browser and operator completions cannot substitute each other's login or attempt", async (t) => {
  const f = setup(t);
  let calls = 0;
  mock(t, async () => {
    calls++;
    throw new Error("No provider IO allowed");
  });
  const start = f.flow.begin(f.binding, 0, f.authority, f.session.token);
  const second = f.app.identity.login("finance@example.test", password);
  await assert.rejects(
    f.flow.complete(
      f.binding,
      start.id,
      "synthetic-secret",
      callback(start),
      second.token,
    ),
    isCode("OAUTH_BROWSER"),
  );
  await assert.rejects(
    f.flow.complete(f.binding, start.id, "synthetic-secret", callback(start)),
    isCode("OAUTH_BROWSER"),
  );
  const operator = f.flow.begin(f.binding, 0, f.authority);
  assert.throws(
    () => f.flow.status(f.binding, operator.id, f.session.token),
    isCode("OAUTH_BROWSER"),
  );
  assert.throws(
    () => f.flow.cancel(f.binding, operator.id, f.session.token),
    isCode("OAUTH_BROWSER"),
  );
  await assert.rejects(
    f.flow.complete(
      f.binding,
      operator.id,
      "synthetic-secret",
      callback(operator),
      f.session.token,
    ),
    isCode("OAUTH_BROWSER"),
  );
  assert.equal(
    f.flow.browserStatus(f.binding, f.session.token).attempt?.state,
    "canceled",
  );
  assert.equal(f.flow.status(f.binding, operator.id).state, "pending");
  assert.equal(calls, 0);
});

for (const change of ["role", "password", "mfa"] as const) {
  test(`organization browser ${change} requirements are current at begin and completion`, async (t) => {
    const f = setup(t);
    const start = f.flow.begin(f.binding, 0, f.authority, f.session.token);
    let app = f.app;
    let session = f.session;
    if (change === "mfa") {
      app = new Application(f.path, "CA", {
        ...security,
        mfaEncryptionKey: "cd".repeat(32),
        mfaRequiredRoles: ["finance"],
      });
      t.after(() => app.close());
    } else {
      const user = f.app.identity
        .users(f.actor)
        .find((user) => user.id === f.session.actor.id)!;
      if (change === "role")
        f.app.identity.updateUser(f.actor, "change-role", {
          userId: user.id,
          revision: user.revision,
          email: user.email,
          name: user.name,
          role: "support",
          sites: [],
          active: true,
          currentPassword: password,
          reason: "Synthetic role change",
        });
      else
        f.app.identity.resetPassword(f.actor, "reset-password", {
          userId: user.id,
          revision: user.revision,
          password: "new-synthetic-only-password",
          currentPassword: password,
          reason: "Synthetic reset",
        });
      session = f.app.identity.login(
        "finance@example.test",
        change === "password" ? "new-synthetic-only-password" : password,
      );
      assert.throws(
        () => f.flow.status(f.binding, start.id, f.session.token),
        isCode("UNAUTHENTICATED"),
      );
    }
    const flow = app.providerCredentials.ledger.authorization;
    const code = change === "role" ? "FORBIDDEN" : "OAUTH_SECURITY";
    let calls = 0;
    mock(t, async () => {
      calls++;
      throw new Error("No provider IO allowed");
    });
    assert.throws(
      () => flow.begin(f.binding, 0, f.authority, session.token),
      isCode(code),
    );
    await assert.rejects(
      flow.complete(
        f.binding,
        start.id,
        "synthetic-secret",
        callback(start),
        session.token,
      ),
      isCode(code),
    );
    assert.equal(
      app.providerCredentials.ledger.status(f.binding).state,
      "missing",
    );
    assert.equal(calls, 0);
  });
}

test("organization browser audit identifies the human login separately from the configured worker", async (t) => {
  const f = setup(t);
  mock(t, async (url) =>
    String(url).includes("tokens/bearer")
      ? tokens()
      : Response.json({ CompanyInfo: { Id: "1234" } }),
  );
  const start = f.flow.begin(f.binding, 0, f.authority, f.session.token);
  await f.flow.complete(
    f.binding,
    start.id,
    "synthetic-secret",
    callback(start),
    f.session.token,
  );
  f.flow.disconnect(f.binding, f.session.token, 1);
  const human = f.app.identity.session(f.session.token).actor;
  const audits = f.app.platform
    .audits(f.actor)
    .filter((row) =>
      String(row.action).startsWith("provider.ledger-authorization."),
    );
  assert.equal(audits.length, 4);
  for (const action of ["begin", "exchange", "complete", "disconnect"]) {
    const row = audits.find(
      (row) => row.action === `provider.ledger-authorization.${action}`,
    )!;
    assert.equal(row.actor_id, human.id);
    const detail = JSON.parse(String(row.detail));
    assert.equal(detail.workerUserId, f.actor.id);
    assert.equal(detail.credentialScope, "organization");
    if (action === "disconnect")
      assert.equal(detail.providerRevocationConfirmed, false);
  }
  assert.doesNotMatch(
    JSON.stringify(audits),
    /synthetic-private|synthetic-secret|distributor_session/,
  );
});

test("organization HTTP disconnect refuses unauthenticated, wrong Origin, missing CSRF and nonfinance callers without changing credentials", async (t) => {
  const f = setup(t);
  f.app.providerCredentials.ledger.install(
    f.binding,
    0,
    {
      accessToken: "synthetic-prior-access",
      refreshToken: "synthetic-prior-refresh",
      accessExpiresAt: Date.now() + 3600000,
      refreshExpiresAt: Date.now() + 86400000,
    },
    f.authority,
  );
  f.app.identity.createUser(f.actor, "support", {
    email: "support@example.test",
    name: "Synthetic support",
    password,
    role: "support",
    sites: [],
  });
  const support = f.app.identity.login("support@example.test", password);
  const browser = new OrganizationQuickBooksBrowser(
    f.app,
    f.binding,
    "synthetic-secret",
    origin,
  );
  const http = await createHttp(f.app, {
    origin,
    staticRoot: "/missing-browser-build",
    organizationQuickbooksBrowser: browser,
  });
  t.after(() => http.close());
  const headers = {
    origin,
    cookie: `distributor_session=${f.session.token}`,
    "x-csrf-token": f.session.csrf,
  };
  const cases = [
    { headers: { origin }, status: 401 },
    {
      headers: { ...headers, origin: "https://evil.example.test" },
      status: 403,
    },
    { headers: { origin, cookie: headers.cookie }, status: 403 },
    {
      headers: {
        origin,
        cookie: `distributor_session=${support.token}`,
        "x-csrf-token": support.csrf,
      },
      status: 403,
    },
  ];
  for (const attempt of cases) {
    const result = await http.inject({
      method: "POST",
      url: "/api/quickbooks/organization/authorization/disconnect",
      headers: attempt.headers,
      payload: { revision: 1 },
    });
    assert.equal(result.statusCode, attempt.status, result.body);
    assert.equal(
      f.app.providerCredentials.ledger.status(f.binding).state,
      "ready",
    );
    assert.equal(
      f.app.providerCredentials.ledger.status(f.binding).revision,
      1,
    );
  }
  f.app.identity.logout(f.session.token);
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: "/api/quickbooks/organization/authorization/disconnect",
        headers,
        payload: { revision: 1 },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    f.app.providerCredentials.ledger.status(f.binding).state,
    "ready",
  );
});

test("organization browser refuses a superseded reviewed permission rather than silently substituting the current choice", async (t) => {
  const f = setup(t);
  const start = f.flow.begin(f.binding, 0, f.authority, f.session.token);
  const residency = f.app.identity.organizationResidency,
    current = residency.current(f.actor);
  residency.choose(f.actor, "new-reviewed-choice", {
    region: "CA",
    revision: current.choice.revision,
    mode: "provider-exception",
    realm: "1234",
    acknowledgment: "Synthetic separately reviewed choice",
    acceptance: {
      disclosureId: current.terms!.id,
      disclosureHash: current.terms!.hash,
      representative: "Synthetic representative",
      evidenceRef: "synthetic:new-review",
    },
  });
  let calls = 0;
  mock(t, async () => {
    calls++;
    throw new Error("No provider IO allowed");
  });
  assert.throws(
    () => f.flow.begin(f.binding, 0, f.authority, f.session.token),
    isCode("RESIDENCY_CHANGED"),
  );
  await assert.rejects(
    f.flow.complete(
      f.binding,
      start.id,
      "synthetic-secret",
      callback(start),
      f.session.token,
    ),
    isCode("RESIDENCY_CHANGED"),
  );
  assert.equal(
    f.flow.status(f.binding, start.id, f.session.token).state,
    "pending",
  );
  assert.equal(
    f.app.providerCredentials.ledger.status(f.binding).state,
    "missing",
  );
  assert.equal(calls, 0);
});

test(
  "actual organization-only API startup needs no buyer provider configuration or encryption key for offline status",
  { timeout: 15000 },
  async (t) => {
    const f = setup(t),
      probe = createServer();
    probe.listen(0, "127.0.0.1");
    await once(probe, "listening");
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>((resolve, reject) =>
      probe.close((error) => (error ? reject(error) : resolve())),
    );
    const publicOrigin = `http://127.0.0.1:${port}`;
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "src/server/main.ts"],
      {
        cwd: process.cwd(),
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "production",
          DATABASE_PATH: f.path,
          DATA_REGION: "CA",
          PORT: String(port),
          PUBLIC_ORIGIN: publicOrigin,
          HOST: "127.0.0.1",
          PROVIDERS_ENABLED: "true",
          QUICKBOOKS_LEDGER_BROWSER_AUTH_ENABLED: "true",
          LEDGER_PROVIDER_BINDING_ID: f.binding.id,
          LEDGER_PROVIDER_ORG_ID: f.binding.orgId,
          LEDGER_PROVIDER_WORKER_USER_ID: f.binding.workerUserId,
          LEDGER_QUICKBOOKS_REALM_ID: f.binding.realm,
          LEDGER_QUICKBOOKS_CLIENT_ID: f.binding.clientId,
          LEDGER_QUICKBOOKS_CLIENT_SECRET: "synthetic-secret",
          LEDGER_QUICKBOOKS_REDIRECT_URI: `${publicOrigin}/quickbooks/organization/callback`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.on("data", (data) => {
      if (stderr.length < 65536) stderr += data.toString();
    });
    child.stdout.resume();
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        const exit = once(child, "exit");
        child.kill("SIGKILL");
        await exit;
      }
    });
    let ready = false;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      assert.equal(child.exitCode, null, stderr);
      try {
        ready =
          (
            await fetch(`${publicOrigin}/api/health`, {
              signal: AbortSignal.timeout(500),
            })
          ).status === 200;
      } catch {}
      if (ready) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, "actual organization-only server must start");
    const status = await fetch(
      `${publicOrigin}/api/quickbooks/organization/authorization`,
      {
        headers: { cookie: `distributor_session=${f.session.token}` },
        signal: AbortSignal.timeout(1000),
      },
    );
    assert.equal(status.status, 200);
    assert.deepEqual(
      (
        (await status.json()) as {
          scope: string;
          realm: string;
          credentials: { state: string };
        }
      ).credentials.state,
      "missing",
    );
    const landing = await fetch(
      `${publicOrigin}/quickbooks/organization/callback`,
      { signal: AbortSignal.timeout(1000) },
    );
    assert.equal(landing.status, existsSync("dist/index.html") ? 200 : 503);
    assert.equal(landing.headers.get("cache-control"), "no-store");
    assert.equal(landing.headers.get("referrer-policy"), "no-referrer");
    const exit = once(child, "exit");
    child.kill("SIGTERM");
    const [code, signal] = await exit;
    assert.equal(code, 0, stderr);
    assert.equal(signal, null);
  },
);
