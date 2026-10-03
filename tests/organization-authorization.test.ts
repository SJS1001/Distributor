import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { Application } from "../src/server/application.ts";
import { fixture, syntheticDisclosure } from "./fixtures.ts";

const config = { providerEncryptionKey: "ab".repeat(32) };
type T = Parameters<typeof fixture>[0];
function setup(t: T, region: "CA" | "US" = "CA") {
  const f = fixture(t, config, region),
    r = f.app.identity.organizationResidency;
  const { provider: _provider, ...terms } = syntheticDisclosure(
    f.app,
    "quickbooks",
  );
  r.publish(f.actor, "org-terms", terms);
  const binding = {
    id: "synthetic-org-oauth",
    orgId: f.actor.orgId,
    workerUserId: f.actor.id,
    realm: "1234",
    clientId: "synthetic-client",
    redirectUri: "http://127.0.0.1:3000/organization-callback",
  };
  const current = r.current(f.actor);
  r.choose(f.actor, "org-choice", {
    region,
    revision: current.choice.revision,
    mode: "provider-exception",
    realm: binding.realm,
    acknowledgment: "Synthetic organization approval",
    acceptance: {
      disclosureId: current.terms!.id,
      disclosureHash: current.terms!.hash,
      representative: "Synthetic representative",
      evidenceRef: "synthetic:review",
    },
  });
  return {
    ...f,
    binding,
    authority: r.permission(f.actor, binding.realm),
    flow: f.app.providerCredentials.ledger.authorization,
  };
}
function callback(
  start: { authorizationUrl: string },
  binding: ReturnType<typeof setup>["binding"],
) {
  const url = new URL(binding.redirectUri);
  url.search = new URLSearchParams({
    state: new URL(start.authorizationUrl).searchParams.get("state")!,
    code: "synthetic-code",
    realmId: binding.realm,
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
function token() {
  return Response.json({
    access_token: "synthetic-org-access",
    refresh_token: "synthetic-org-refresh",
    token_type: "bearer",
    expires_in: 3600,
    x_refresh_token_expires_in: 8640000,
  });
}
function operator(f: ReturnType<typeof setup>) {
  const env = {
    PATH: process.env.PATH,
    DATABASE_PATH: f.path,
    DATA_REGION: f.app.identity.region,
    PROVIDER_BINDING_ID: f.binding.id,
    PROVIDER_ORG_ID: f.binding.orgId,
    PROVIDER_WORKER_USER_ID: f.binding.workerUserId,
    QUICKBOOKS_REALM_ID: f.binding.realm,
    QUICKBOOKS_CLIENT_ID: f.binding.clientId,
    QUICKBOOKS_REDIRECT_URI: f.binding.redirectUri,
    PROVIDER_ENCRYPTION_KEY: config.providerEncryptionKey,
    PROVIDERS_ENABLED: "false",
  };
  return (
    args: string[],
    input: string | Buffer,
    overrides: NodeJS.ProcessEnv = {},
    transport = false,
  ) =>
    new Promise<{ code: number | null; out: string; err: string }>(
      (resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            "--import",
            "tsx",
            ...(transport
              ? ["--import", "./tests/organization-authorization-transport.ts"]
              : []),
            "src/server/organization-authorization-cli.ts",
            ...args,
          ],
          { env: { ...env, ...overrides }, stdio: ["pipe", "pipe", "pipe"] },
        );
        let out = "",
          err = "";
        const timeout = setTimeout(() => child.kill(), 15000);
        child.on("error", reject);
        child.stdout.on("data", (data) => (out += String(data)));
        child.stderr.on("data", (data) => (err += String(data)));
        child.on("close", (code) => {
          clearTimeout(timeout);
          resolve({ code, out, err });
        });
        child.stdin.on("error", () => {}); // Refusals may exit before reading stdin.
        child.stdin.end(input);
      },
    );
}
test("organization authorization operator can begin, inspect and cancel offline with exact reviewed authority", async (t) => {
  const f = setup(t),
    run = operator(f);
  const started = await run(
    ["begin"],
    JSON.stringify({ revision: 0, authority: f.authority }),
  );
  assert.equal(started.code, 0, started.err);
  const start = JSON.parse(started.out);
  assert.equal(start.state, "pending");
  assert.equal(
    new URL(start.authorizationUrl).searchParams.get("client_id"),
    "synthetic-client",
  );
  assert.equal(
    new URL(start.authorizationUrl).searchParams.get("scope"),
    "com.intuit.quickbooks.accounting",
  );
  const input = JSON.stringify({ attemptId: start.id });
  const status = await run(["status"], input, { PROVIDER_ENCRYPTION_KEY: "" });
  assert.equal(status.code, 0, status.err);
  assert.equal(JSON.parse(status.out).state, "pending");
  assert.ok(!status.out.includes("authorizationUrl"));
  const canceled = await run(["cancel"], input, {
    PROVIDER_ENCRYPTION_KEY: "",
  });
  assert.equal(canceled.code, 0, canceled.err);
  assert.equal(JSON.parse(canceled.out).state, "canceled");
  assert.equal(f.flow.status(f.binding, start.id).state, "canceled");
  assert.equal(
    f.app.providerCredentials.ledger.status(f.binding).state,
    "missing",
  );
  assert.equal(f.app.providerCredentials.status(f.binding).state, "missing");
});
for (const region of ["CA", "US"] as const)
  test(`${region} organization operator explicitly completes sandbox proof without exposing secrets or installing buyer credentials`, async (t) => {
    const f = setup(t, region),
      run = operator(f),
      start = f.flow.begin(f.binding, 0, f.authority),
      callbackUrl = callback(start, f.binding);
    const input = JSON.stringify({ attemptId: start.id, callbackUrl });
    const completed = await run(
      ["complete"],
      input,
      {
        PROVIDERS_ENABLED: "true",
        QUICKBOOKS_CLIENT_SECRET: "synthetic-secret",
        SYNTHETIC_EXPECT_REQUESTS: "2",
      },
      true,
    );
    assert.equal(completed.code, 0, completed.err);
    assert.equal(JSON.parse(completed.out).state, "completed");
    assert.equal(JSON.parse(completed.out).installedRevision, 1);
    assert.equal(
      f.app.providerCredentials.ledger.status(f.binding).state,
      "ready",
    );
    assert.equal(f.app.providerCredentials.status(f.binding).state, "missing");
    const status = await run(
      ["status"],
      JSON.stringify({ attemptId: start.id }),
    );
    assert.equal(status.code, 0, status.err);
    assert.equal(JSON.parse(status.out).state, "completed");
    const replay = await run(
      ["complete"],
      input,
      {
        PROVIDERS_ENABLED: "true",
        QUICKBOOKS_CLIENT_SECRET: "synthetic-secret",
        SYNTHETIC_EXPECT_REQUESTS: "0",
      },
      true,
    );
    assert.equal(replay.code, 1);
    assert.match(replay.err, /OAUTH_USED:/);
    for (const secret of [
      callbackUrl,
      "synthetic-code",
      "synthetic-secret",
      "synthetic-org-access",
      "synthetic-org-refresh",
    ]) {
      assert.ok(!completed.out.includes(secret));
      assert.ok(!completed.err.includes(secret));
      assert.ok(!status.out.includes(secret));
      assert.ok(!replay.out.includes(secret));
      assert.ok(!replay.err.includes(secret));
    }
  });
test("organization operator refuses malformed, oversized and surplus protected input before opening a new store", async (t) => {
  const f = setup(t),
    run = operator(f),
    path = f.path.replace("app.db", "refused.db"),
    secret = "synthetic-private-callback";
  for (const [args, input] of [
    [
      ["begin", secret],
      JSON.stringify({ revision: 0, authority: f.authority }),
    ],
    [["unknown"], secret],
    [["begin"], "null"],
    [["begin"], "[]"],
    [["begin"], "{"],
    [["begin"], JSON.stringify({ revision: 0 })],
    [["begin"], JSON.stringify({ revision: -1, authority: f.authority })],
    [["begin"], JSON.stringify({ revision: 0, authority: null })],
    [
      ["begin"],
      JSON.stringify({
        revision: 0,
        authority: f.authority,
        accountId: secret,
      }),
    ],
    [["status"], JSON.stringify({ attemptId: "", callbackUrl: secret })],
    [["cancel"], JSON.stringify({ attemptId: "", extra: secret })],
    [["status"], JSON.stringify({ attemptId: secret.repeat(3000) })],
    [["status"], Buffer.from([0xc3, 0x28])],
    [
      ["complete"],
      JSON.stringify({ attemptId: "missing", callbackUrl: secret, secret }),
    ],
    [
      ["complete"],
      JSON.stringify({ attemptId: "missing", callbackUrl: "x".repeat(16385) }),
    ],
  ] as [string[], string | Buffer][]) {
    const refused = await run(
      args,
      input,
      {
        DATABASE_PATH: path,
        PROVIDERS_ENABLED: "true",
        QUICKBOOKS_CLIENT_SECRET: "synthetic-secret",
        SYNTHETIC_EXPECT_REQUESTS: "0",
      },
      true,
    );
    assert.equal(refused.code, 1);
    assert.equal(refused.out, "");
    assert.ok(!refused.err.includes(secret));
    assert.ok(!refused.err.includes("synthetic-secret"));
    assert.equal(existsSync(path), false);
  }
});
test("organization operator completion needs explicit enablement, exact callback and current permission while offline cancellation survives withdrawal", async (t) => {
  const f = setup(t),
    run = operator(f),
    start = f.flow.begin(f.binding, 0, f.authority),
    callbackUrl = callback(start, f.binding),
    input = JSON.stringify({ attemptId: start.id, callbackUrl });
  const disabled = await run(["complete"], input, {
    QUICKBOOKS_CLIENT_SECRET: "synthetic-secret",
  });
  assert.equal(disabled.code, 1);
  assert.match(disabled.err, /PROVIDER_DISABLED:/);
  const noSecret = await run(["complete"], input, {
    PROVIDERS_ENABLED: "true",
  });
  assert.equal(noSecret.code, 1);
  assert.match(noSecret.err, /PROVIDER_CONFIG:/);
  const wrongCallback = await run(
    ["complete"],
    JSON.stringify({
      attemptId: start.id,
      callbackUrl: callbackUrl.replace(
        "organization-callback",
        "buyer-callback",
      ),
    }),
    {
      PROVIDERS_ENABLED: "true",
      QUICKBOOKS_CLIENT_SECRET: "synthetic-secret",
      SYNTHETIC_EXPECT_REQUESTS: "0",
    },
    true,
  );
  assert.equal(wrongCallback.code, 1);
  assert.equal(f.flow.status(f.binding, start.id).state, "pending");
  const stale = await run(
    ["begin"],
    JSON.stringify({
      revision: 0,
      authority: { ...f.authority, revision: 99 },
    }),
  );
  assert.equal(stale.code, 1);
  assert.match(stale.err, /RESIDENCY_CHANGED:/);
  assert.equal(f.flow.status(f.binding, start.id).state, "pending");
  const r = f.app.identity.organizationResidency;
  r.choose(f.actor, "operator-withdraw", {
    region: "CA",
    revision: r.current(f.actor).choice.revision,
    mode: "strict",
    realm: null,
    acknowledgment: "Synthetic withdrawal",
  });
  const withdrawn = await run(
    ["complete"],
    input,
    {
      PROVIDERS_ENABLED: "true",
      QUICKBOOKS_CLIENT_SECRET: "synthetic-secret",
      SYNTHETIC_EXPECT_REQUESTS: "0",
    },
    true,
  );
  assert.equal(withdrawn.code, 1);
  assert.equal(
    f.app.providerCredentials.ledger.status(f.binding).state,
    "missing",
  );
  assert.equal(f.flow.status(f.binding, start.id).state, "pending");
  const status = await run(
    ["status"],
    JSON.stringify({ attemptId: start.id }),
    { PROVIDER_ENCRYPTION_KEY: "invalid" },
  );
  assert.equal(status.code, 0, status.err);
  const canceled = await run(
    ["cancel"],
    JSON.stringify({ attemptId: start.id }),
    { PROVIDER_ENCRYPTION_KEY: "invalid" },
  );
  assert.equal(canceled.code, 0, canceled.err);
  assert.equal(JSON.parse(canceled.out).state, "canceled");
});
test("organization connection verifies its sandbox company and persists independently of buyer credentials", async (t) => {
  const f = setup(t),
    start = f.flow.begin(f.binding, 0, f.authority);
  assert.equal(start.state, "pending");
  let calls = 0;
  mock(t, async (url, init) => {
    calls++;
    if (calls === 1) {
      assert.equal(
        String(url),
        "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
      );
      assert.equal(
        new URLSearchParams(String(init?.body)).get("redirect_uri"),
        f.binding.redirectUri,
      );
      return token();
    }
    assert.equal(
      String(url),
      "https://sandbox-quickbooks.api.intuit.com/v3/company/1234/companyinfo/1234",
    );
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      "Bearer synthetic-org-access",
    );
    return Response.json({ CompanyInfo: { Id: "1234" } });
  });
  const completed = await f.flow.complete(
    f.binding,
    start.id,
    "synthetic-secret",
    callback(start, f.binding),
  );
  assert.equal(completed.state, "completed");
  assert.equal(completed.installedRevision, 1);
  assert.equal(calls, 2);
  assert.equal(f.app.providerCredentials.status(f.binding).state, "missing");
  assert.equal(
    await f.app.providerCredentials.ledger.access(
      f.binding,
      "synthetic-secret",
      f.authority,
    ),
    "synthetic-org-access",
  );
  await assert.rejects(
    f.flow.complete(
      f.binding,
      start.id,
      "synthetic-secret",
      callback(start, f.binding),
    ),
    { code: "OAUTH_USED" },
  );
  assert.equal(calls, 2);
  const reopened = new Application(f.path, "CA", config);
  try {
    assert.equal(
      reopened.providerCredentials.ledger.authorization.status(
        f.binding,
        start.id,
      ).state,
      "completed",
    );
  } finally {
    reopened.close();
  }
});

test("US organization company mismatch consumes the attempt without installing credentials", async (t) => {
  const f = setup(t, "US"),
    start = f.flow.begin(f.binding, 0, f.authority);
  let calls = 0;
  mock(t, async () =>
    ++calls === 1 ? token() : Response.json({ CompanyInfo: { Id: "9999" } }),
  );
  await assert.rejects(
    f.flow.complete(
      f.binding,
      start.id,
      "synthetic-secret",
      callback(start, f.binding),
    ),
    { code: "OAUTH_COMPANY" },
  );
  assert.equal(f.flow.status(f.binding, start.id).state, "unknown");
  assert.equal(
    f.app.providerCredentials.ledger.status(f.binding).state,
    "missing",
  );
  await assert.rejects(
    f.flow.complete(
      f.binding,
      start.id,
      "synthetic-secret",
      callback(start, f.binding),
    ),
    { code: "OAUTH_USED" },
  );
  assert.equal(calls, 2);
});

for (const field of [
  "realm",
  "clientId",
  "workerUserId",
  "redirectUri",
] as const) {
  test(`organization authorization refuses substituted ${field} before transport`, async (t) => {
    const f = setup(t),
      start = f.flow.begin(f.binding, 0, f.authority);
    let calls = 0;
    mock(t, async () => {
      calls++;
      return token();
    });
    const changed = {
      ...f.binding,
      [field]:
        field === "realm"
          ? "9999"
          : field === "redirectUri"
            ? "http://127.0.0.1:3000/other"
            : "synthetic-other",
    };
    await assert.rejects(
      f.flow.complete(
        changed,
        start.id,
        "synthetic-secret",
        callback(start, changed),
      ),
    );
    assert.equal(calls, 0);
    assert.equal(f.flow.status(f.binding, start.id).state, "pending");
  });
}
for (const change of [
  "cancel",
  "supersede",
  "withdraw",
  "credential-install",
  "key-rotation",
  "mutate-binding",
] as const) {
  test(`organization ${change} fences an in-flight code exchange`, async (t) => {
    const f = setup(t),
      start = f.flow.begin(f.binding, 0, f.authority),
      originalBinding = { ...f.binding };
    let calls = 0;
    mock(t, async () => {
      calls++;
      if (change === "cancel") f.flow.cancel(f.binding, start.id);
      if (change === "supersede") f.flow.begin(f.binding, 0, f.authority);
      if (change === "withdraw") {
        const r = f.app.identity.organizationResidency;
        r.choose(f.actor, "withdraw", {
          region: "CA",
          revision: r.current(f.actor).choice.revision,
          mode: "strict",
          realm: null,
          acknowledgment: "Synthetic withdrawal",
        });
      }
      if (change === "credential-install")
        f.app.providerCredentials.ledger.install(
          f.binding,
          0,
          {
            accessToken: "synthetic-independent",
            refreshToken: "synthetic-independent-refresh",
            accessExpiresAt: Date.now() + 3600000,
            refreshExpiresAt: Date.now() + 8640000,
          },
          f.authority,
        );
      if (change === "key-rotation")
        assert.throws(
          () =>
            f.app.providerCredentials.rotate(
              [{ orgId: f.actor.orgId, workerUserId: f.actor.id }],
              f.app.providerCredentials.keyStatus().generation,
              "cd".repeat(32),
            ),
          { code: "CREDENTIAL_BUSY" },
        );
      if (change === "mutate-binding") {
        f.binding.realm = "9999";
        f.binding.redirectUri = "http://127.0.0.1:3000/other";
      }
      return calls === 1
        ? token()
        : Response.json({ CompanyInfo: { Id: "1234" } });
    });
    const completion = f.flow.complete(
      f.binding,
      start.id,
      "synthetic-secret",
      callback(start, f.binding),
    );
    if (["key-rotation", "mutate-binding"].includes(change)) {
      assert.equal((await completion).state, "completed");
      assert.equal(calls, 2);
    } else {
      await assert.rejects(completion);
      assert.equal(calls, 1);
      const state = f.flow.status(originalBinding, start.id).state;
      assert.equal(
        state,
        change === "cancel" || change === "supersede" ? "canceled" : "unknown",
      );
    }
  });
}
test("organization status and cancellation stay available after withdrawal and encryption key loss", (t) => {
  const f = setup(t),
    start = f.flow.begin(f.binding, 0, f.authority);
  const r = f.app.identity.organizationResidency;
  r.choose(f.actor, "withdraw", {
    region: "CA",
    revision: r.current(f.actor).choice.revision,
    mode: "strict",
    realm: null,
    acknowledgment: "Synthetic withdrawal",
  });
  const reopened = new Application(f.path, "CA");
  try {
    assert.equal(
      reopened.providerCredentials.ledger.authorization.status(
        f.binding,
        start.id,
      ).state,
      "pending",
    );
    assert.equal(
      reopened.providerCredentials.ledger.authorization.cancel(
        f.binding,
        start.id,
      ).state,
      "canceled",
    );
  } finally {
    reopened.close();
  }
});
for (const invalid of [
  "state",
  "duplicate",
  "realm",
  "address",
  "fragment",
  "secret",
] as const) {
  test(`organization ${invalid} callback refuses without consuming state or transport`, async (t) => {
    const f = setup(t),
      start = f.flow.begin(f.binding, 0, f.authority),
      url = new URL(callback(start, f.binding));
    if (invalid === "state") url.searchParams.set("state", "x".repeat(43));
    if (invalid === "duplicate") url.searchParams.append("code", "other");
    if (invalid === "realm") url.searchParams.set("realmId", "9999");
    if (invalid === "address") url.pathname = "/other";
    if (invalid === "fragment") url.hash = "unexpected";
    let calls = 0;
    mock(t, async () => {
      calls++;
      return token();
    });
    await assert.rejects(
      f.flow.complete(
        f.binding,
        start.id,
        invalid === "secret" ? "" : "synthetic-secret",
        url.href,
      ),
    );
    assert.equal(calls, 0);
    assert.equal(f.flow.status(f.binding, start.id).state, "pending");
  });
}
test("organization declined authorization is retained without requiring a client secret", async (t) => {
  const f = setup(t),
    start = f.flow.begin(f.binding, 0, f.authority),
    url = new URL(callback(start, f.binding));
  url.searchParams.delete("code");
  url.searchParams.delete("realmId");
  url.searchParams.set("error", "access_denied");
  let calls = 0;
  mock(t, async () => {
    calls++;
    return token();
  });
  assert.equal(
    (await f.flow.complete(f.binding, start.id, "", url.href)).state,
    "denied",
  );
  assert.equal(calls, 0);
});

test("organization concurrent callback claims once and never repeats token exchange", async (t) => {
  const f = setup(t),
    start = f.flow.begin(f.binding, 0, f.authority);
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  mock(t, async () => {
    calls++;
    if (calls === 1) {
      await barrier;
      return token();
    }
    return Response.json({ CompanyInfo: { Id: "1234" } });
  });
  const first = f.flow.complete(
    f.binding,
    start.id,
    "synthetic-secret",
    callback(start, f.binding),
  );
  await assert.rejects(
    f.flow.complete(
      f.binding,
      start.id,
      "synthetic-secret",
      callback(start, f.binding),
    ),
    { code: "OAUTH_BUSY" },
  );
  assert.equal(calls, 1);
  release();
  assert.equal((await first).state, "completed");
  assert.equal(calls, 2);
});

for (const change of [
  "cancel",
  "withdraw",
  "deadline",
  "clock-rollback",
] as const) {
  test(`organization ${change} during company proof cannot retain tokens`, async (t) => {
    const f = setup(t),
      start = f.flow.begin(f.binding, 0, f.authority);
    let calls = 0;
    mock(t, async () => {
      calls++;
      if (calls === 1) return token();
      if (change === "cancel") f.flow.cancel(f.binding, start.id);
      if (change === "withdraw") {
        const r = f.app.identity.organizationResidency;
        r.choose(f.actor, "company-withdraw", {
          region: "CA",
          revision: r.current(f.actor).choice.revision,
          mode: "strict",
          realm: null,
          acknowledgment: "Synthetic withdrawal",
        });
      }
      if (change === "deadline" || change === "clock-rollback") {
        const instant = Date.now() + (change === "deadline" ? 90001 : -90001);
        t.mock.method(Date, "now", () => instant);
      }
      return Response.json({ CompanyInfo: { Id: "1234" } });
    });
    await assert.rejects(
      f.flow.complete(
        f.binding,
        start.id,
        "synthetic-secret",
        callback(start, f.binding),
      ),
    );
    assert.equal(calls, 2);
    assert.equal(
      f.app.providerCredentials.ledger.status(f.binding).state,
      "missing",
    );
    assert.equal(
      f.flow.status(f.binding, start.id).state,
      change === "cancel" ? "canceled" : "unknown",
    );
  });
}

test("organization expired pending callback commits expiry without transport", async (t) => {
  const f = setup(t),
    start = f.flow.begin(f.binding, 0, f.authority);
  t.mock.method(Date, "now", () => start.expiresAt);
  let calls = 0;
  mock(t, async () => {
    calls++;
    return token();
  });
  await assert.rejects(
    f.flow.complete(
      f.binding,
      start.id,
      "synthetic-secret",
      callback(start, f.binding),
    ),
    { code: "OAUTH_EXPIRED" },
  );
  assert.equal(f.flow.status(f.binding, start.id).state, "expired");
  assert.equal(calls, 0);
});

test("organization pending attempt participates in key rotation without existing credentials", (t) => {
  const f = setup(t),
    start = f.flow.begin(f.binding, 0, f.authority);
  assert.throws(() => f.app.providerCredentials.rotate([], 0, "cd".repeat(32)));
  assert.equal(f.flow.status(f.binding, start.id).state, "pending");
  const result = f.app.providerCredentials.rotate(
    [{ orgId: f.actor.orgId, workerUserId: f.actor.id }],
    0,
    "cd".repeat(32),
  );
  assert.equal(result.canceledAuthorizations, 1);
  assert.equal(f.flow.status(f.binding, start.id).state, "canceled");
});

test("organization restored attempts are canceled before any callback can resume", async (t) => {
  const f = setup(t),
    start = f.flow.begin(f.binding, 0, f.authority);
  f.app.providerCredentials.invalidateRestoredCredentials();
  assert.equal(f.flow.status(f.binding, start.id).state, "canceled");
  let calls = 0;
  mock(t, async () => {
    calls++;
    return token();
  });
  await assert.rejects(
    f.flow.complete(
      f.binding,
      start.id,
      "synthetic-secret",
      callback(start, f.binding),
    ),
  );
  assert.equal(calls, 0);
});
