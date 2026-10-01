import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fork, spawn } from "node:child_process";
import { chooseProviders, fixture } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { createBackup, restoreBackup } from "../src/server/recovery.ts";
const key = "ac".repeat(32),
  config = { providerEncryptionKey: key };
function setup(t: Parameters<typeof fixture>[0]) {
  const f = fixture(t, config);
  chooseProviders(f, f.actor, "consent", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["quickbooks"],
    version: 1,
    acknowledgment: "Synthetic processor choice",
  });
  const binding = {
    id: "synthetic-oauth-binding",
    orgId: f.actor.orgId,
    workerUserId: f.actor.id,
    realm: "1234",
    clientId: "synthetic-client",
    accountId: f.buyer,
    redirectUri: "http://127.0.0.1:3000/quickbooks/callback",
  };
  return {
    ...f,
    binding,
    flow: f.app.providerCredentials.authorization,
    store: f.app.database.owned("integration"),
  };
}
function callback(
  start: { authorizationUrl: string },
  binding: ReturnType<typeof setup>["binding"],
  params: Record<string, string> = {},
) {
  const url = new URL(binding.redirectUri);
  url.search = new URLSearchParams({
    state: new URL(start.authorizationUrl).searchParams.get("state")!,
    code: "synthetic-authorization-code",
    realmId: binding.realm,
    ...params,
  }).toString();
  return url.href;
}
function response(overrides: object = {}) {
  return Response.json({
    access_token: "synthetic-authorized-access",
    refresh_token: "synthetic-authorized-refresh",
    token_type: "bearer",
    expires_in: 3600,
    x_refresh_token_expires_in: 100 * 86400,
    x_refresh_token_hard_expires_in: 180 * 86400,
    ...overrides,
  });
}
function mock(t: Parameters<typeof fixture>[0], fn: typeof fetch) {
  const original = globalThis.fetch;
  globalThis.fetch = fn;
  t.after(() => {
    globalThis.fetch = original;
  });
}
const code = (value: string) => (e: unknown) =>
  (e as { code: string }).code === value;
function previous() {
  return {
    accessToken: "synthetic-previous-access",
    refreshToken: "synthetic-previous-refresh",
    accessExpiresAt: Date.now() + 3600000,
    refreshExpiresAt: Date.now() + 86400000,
  };
}

test("authorization freezes exact confidential-client scope/callback, exchanges once, verifies sandbox company, encrypts pair atomically and survives restart", async (t) => {
  const f = setup(t),
    start = f.flow.begin(f.binding, 0),
    auth = new URL(start.authorizationUrl);
  assert.equal(
    auth.origin + auth.pathname,
    "https://appcenter.intuit.com/connect/oauth2",
  );
  assert.deepEqual([...auth.searchParams.keys()].sort(), [
    "client_id",
    "redirect_uri",
    "response_type",
    "scope",
    "state",
  ]);
  assert.equal(
    auth.searchParams.get("scope"),
    "com.intuit.quickbooks.accounting",
  );
  assert.equal(auth.searchParams.get("redirect_uri"), f.binding.redirectUri);
  assert.equal(auth.searchParams.get("response_type"), "code");
  assert.equal(auth.searchParams.get("state")!.length, 43);
  let calls = 0;
  mock(t, async (url, init) => {
    calls++;
    assert.equal(init?.redirect, "error");
    const headers = new Headers(init?.headers);
    if (calls === 1) {
      assert.equal(
        url,
        "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
      );
      assert.equal(init?.method, "POST");
      assert.equal(
        headers.get("Authorization"),
        `Basic ${Buffer.from("synthetic-client:synthetic-client-secret").toString("base64")}`,
      );
      assert.equal(
        headers.get("Content-Type"),
        "application/x-www-form-urlencoded",
      );
      assert.deepEqual(
        [...new URLSearchParams(String(init?.body))],
        [
          ["grant_type", "authorization_code"],
          ["code", "synthetic-authorization-code"],
          ["redirect_uri", f.binding.redirectUri],
        ],
      );
      assert.equal(f.flow.status(f.binding, start.id).state, "exchanging");
      return response();
    }
    assert.equal(
      url,
      "https://sandbox-quickbooks.api.intuit.com/v3/company/1234/companyinfo/1234",
    );
    assert.equal(
      headers.get("Authorization"),
      "Bearer synthetic-authorized-access",
    );
    return Response.json({
      CompanyInfo: {
        Id: "1234",
        CompanyName: "Synthetic private company",
        Email: { Address: "sensitive@example.test" },
      },
    });
  });
  const completed = await f.flow.complete(
    f.binding,
    start.id,
    "synthetic-client-secret",
    callback(start, f.binding),
  );
  assert.equal(completed.state, "completed");
  assert.equal(completed.installedRevision, 1);
  assert.equal(f.app.providerCredentials.status(f.binding).state, "ready");
  await assert.rejects(
    f.flow.complete(
      f.binding,
      start.id,
      "synthetic-client-secret",
      callback(start, f.binding),
    ),
    code("OAUTH_USED"),
  );
  assert.equal(calls, 2);
  const app = new Application(f.path, "CA", config);
  try {
    assert.equal(
      app.providerCredentials.authorization.status(f.binding, start.id).state,
      "completed",
    );
    assert.equal(
      await app.providerCredentials.access(f.binding, "secret", {
        org_id: f.actor.orgId,
        account_id: f.buyer,
        provider: "quickbooks",
      } as any),
      "synthetic-authorized-access",
    );
  } finally {
    app.close();
  }
  const dump = JSON.stringify({
    attempts: f.store.all("SELECT * FROM integration_authorizations"),
    credentials: f.store.all("SELECT * FROM integration_credentials"),
    audit: f.app.database.owned("platform").all("SELECT * FROM platform_audit"),
    status: completed,
  });
  for (const value of [
    "synthetic-authorization-code",
    "synthetic-client-secret",
    "synthetic-authorized-access",
    "synthetic-authorized-refresh",
    auth.searchParams.get("state")!,
    "Synthetic private company",
    "sensitive@example.test",
  ]) {
    assert.ok(!dump.includes(value));
    for (const file of [f.path, f.path + "-wal"])
      assert.ok(!readFileSync(file).includes(Buffer.from(value)));
  }
});

test("invalid configuration, key absence, revisions and strict customer choice prevent begin", (t) => {
  const f = setup(t);
  for (const redirectUri of [
    "https://user:secret@example.test/callback",
    "http://example.test/callback",
    "https://example.test/cb?x=1",
    "https://example.test/cb#hash",
    "not-url",
    "https://example.test",
    "https://example.test/a/../cb",
  ]) {
    assert.throws(
      () => f.flow.begin({ ...f.binding, redirectUri }, 0),
      code("OAUTH_CONFIG"),
    );
  }
  assert.throws(() => f.flow.begin(f.binding, 1), code("REVISION"));
  const unkeyed = new Application(f.path);
  try {
    assert.throws(
      () => unkeyed.providerCredentials.authorization.begin(f.binding, 0),
      code("CREDENTIAL_KEY"),
    );
  } finally {
    unkeyed.close();
  }
  chooseProviders(f, f.actor, "withdraw", {
    accountId: f.buyer,
    region: "CA",
    mode: "strict",
    providers: [],
    version: 2,
    acknowledgment: "Synthetic withdrawal",
  });
  assert.throws(() => f.flow.begin(f.binding, 0), code("RESIDENCY_BLOCKED"));
  assert.equal(
    f.store.all("SELECT * FROM integration_authorizations").length,
    0,
  );
});

test("wrong state, realm, path, origin, duplicate/unexpected parameters and initiating binding never consume or exchange", async (t) => {
  const f = setup(t),
    start = f.flow.begin(f.binding, 0),
    good = callback(start, f.binding);
  let calls = 0;
  mock(t, async () => {
    calls++;
    return response();
  });
  for (const [input, expected] of [
    [callback(start, f.binding, { state: "x".repeat(43) }), "OAUTH_STATE"],
    [callback(start, f.binding, { realmId: "9999" }), "OAUTH_REALM"],
    [good.replace("/quickbooks/callback?", "/other?"), "OAUTH_CALLBACK"],
    [good.replace("127.0.0.1", "localhost"), "OAUTH_CALLBACK"],
    [good + "&state=duplicate", "OAUTH_CALLBACK"],
    [good + "&code=duplicate", "OAUTH_CALLBACK"],
    [good + "&realmId=1234", "OAUTH_CALLBACK"],
    [good + "&unexpected=secret", "OAUTH_CALLBACK"],
    [good + "#fragment", "OAUTH_CALLBACK"],
    ["not-url", "OAUTH_CALLBACK"],
    [callback(start, f.binding, { code: "" }), "OAUTH_CALLBACK"],
    [callback(start, f.binding, { error: "denied" }), "OAUTH_CALLBACK"],
  ])
    await assert.rejects(
      f.flow.complete(f.binding, start.id, "secret", input!),
      code(expected!),
    );
  await assert.rejects(
    f.flow.complete(
      { ...f.binding, clientId: "other-client" },
      start.id,
      "secret",
      good,
    ),
    code("OAUTH_SCOPE"),
  );
  await assert.rejects(
    f.flow.complete(
      { ...f.binding, accountId: "absent" },
      start.id,
      "secret",
      good,
    ),
  );
  assert.equal(calls, 0);
  assert.equal(f.flow.status(f.binding, start.id).state, "pending");
});

test("provider denial consumes only valid state, excludes error details and makes no provider request", async (t) => {
  const f = setup(t),
    start = f.flow.begin(f.binding, 0),
    url = new URL(callback(start, f.binding));
  url.searchParams.delete("code");
  url.searchParams.delete("realmId");
  url.searchParams.set("error", "access_denied");
  url.searchParams.set("error_description", "synthetic-sensitive-error");
  let calls = 0;
  mock(t, async () => {
    calls++;
    return response();
  });
  assert.equal(
    (await f.flow.complete(f.binding, start.id, "", url.href)).state,
    "denied",
  );
  await assert.rejects(
    f.flow.complete(f.binding, start.id, "secret", url.href),
    code("OAUTH_USED"),
  );
  assert.ok(
    !JSON.stringify(
      f.store.all("SELECT * FROM integration_authorizations"),
    ).includes("synthetic-sensitive-error"),
  );
  assert.equal(calls, 0);
});

test("expired state and abandoned exchange become terminal without resending; cancellation remains possible after consent withdrawal or restore hold", async (t) => {
  const f = setup(t),
    start = f.flow.begin(f.binding, 0);
  let calls = 0;
  mock(t, async () => {
    calls++;
    return response();
  });
  f.store.run(
    "UPDATE integration_authorizations SET expires_at=? WHERE id=?",
    Date.now() - 1,
    start.id,
  );
  await assert.rejects(
    f.flow.complete(f.binding, start.id, "secret", callback(start, f.binding)),
    code("OAUTH_EXPIRED"),
  );
  assert.equal(f.flow.status(f.binding, start.id).state, "expired");
  const second = f.flow.begin(f.binding, 0);
  f.store.run(
    "UPDATE integration_authorizations SET state='exchanging',claim='abandoned',started_at=? WHERE id=?",
    Date.now() - 90001,
    second.id,
  );
  await assert.rejects(
    f.flow.complete(
      f.binding,
      second.id,
      "secret",
      callback(second, f.binding),
    ),
    code("OAUTH_EXPIRED"),
  );
  assert.equal(f.flow.status(f.binding, second.id).state, "unknown");
  const third = f.flow.begin(f.binding, 0);
  chooseProviders(f, f.actor, "withdraw", {
    accountId: f.buyer,
    region: "CA",
    mode: "strict",
    providers: [],
    version: 2,
    acknowledgment: "Synthetic withdrawal",
  });
  assert.equal(f.flow.cancel(f.binding, third.id).state, "canceled");
  assert.equal(f.flow.cancel(f.binding, third.id).state, "canceled");
  assert.equal(calls, 0);
});

test("current principal, password, customer permission and restore clearance precede exchange and are rechecked after provider I/O", async (t) => {
  for (const when of ["before", "after"] as const)
    for (const restriction of ["principal", "password", "consent", "restore"]) {
      const f = setup(t),
        start = f.flow.begin(f.binding, 0);
      const restrict = () => {
        if (restriction === "principal")
          f.app.database
            .owned("iam")
            .run("UPDATE iam_users SET role='support' WHERE id=?", f.actor.id);
        if (restriction === "password")
          f.app.database
            .owned("iam")
            .run(
              "INSERT INTO iam_user_security VALUES(?,1,1,?) ON CONFLICT(user_id) DO UPDATE SET password_change_required=1",
              f.actor.id,
              new Date().toISOString(),
            );
        if (restriction === "consent")
          chooseProviders(f, f.actor, "withdraw", {
            accountId: f.buyer,
            region: "CA",
            mode: "strict",
            providers: [],
            version: 2,
            acknowledgment: "Synthetic withdrawal",
          });
        if (restriction === "restore")
          f.app.database
            .owned("platform")
            .run(
              "INSERT INTO platform_recovery VALUES(1,'synthetic','synthetic',?)",
              new Date().toISOString(),
            );
      };
      let calls = 0;
      const original = globalThis.fetch;
      globalThis.fetch = async () => {
        calls++;
        restrict();
        return response();
      };
      try {
        if (when === "before") restrict();
        await assert.rejects(
          f.flow.complete(
            f.binding,
            start.id,
            "secret",
            callback(start, f.binding),
          ),
          code(
            {
              principal: "FORBIDDEN",
              password: "PASSWORD_CHANGE_REQUIRED",
              consent: "RESIDENCY_BLOCKED",
              restore: "RECOVERY_HOLD",
            }[restriction]!,
          ),
        );
        assert.equal(calls, when === "before" ? 0 : 1);
        assert.equal(
          f.store.all("SELECT * FROM integration_credentials").length,
          0,
        );
        assert.equal(
          f.store.get("SELECT state FROM integration_authorizations")!.state,
          when === "before" ? "pending" : "unknown",
        );
      } finally {
        globalThis.fetch = original;
      }
    }
});

test("changed consent revision, missing encryption key and changed credential revision refuse exchange before any request", async (t) => {
  const f = setup(t),
    start = f.flow.begin(f.binding, 0);
  let calls = 0;
  mock(t, async () => {
    calls++;
    return response();
  });
  const unkeyed = new Application(f.path);
  try {
    await assert.rejects(
      unkeyed.providerCredentials.authorization.complete(
        f.binding,
        start.id,
        "secret",
        callback(start, f.binding),
      ),
      code("CREDENTIAL_KEY"),
    );
  } finally {
    unkeyed.close();
  }
  chooseProviders(f, f.actor, "new-choice", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["quickbooks"],
    version: 2,
    acknowledgment: "Synthetic renewed choice",
  });
  await assert.rejects(
    f.flow.complete(f.binding, start.id, "secret", callback(start, f.binding)),
    code("OAUTH_CONSENT"),
  );
  const next = f.flow.begin(f.binding, 0);
  f.app.providerCredentials.install(f.binding, 0, previous());
  await assert.rejects(
    f.flow.complete(f.binding, next.id, "secret", callback(next, f.binding)),
    code("REVISION"),
  );
  assert.equal(calls, 0);
});

test("canceled and superseded exchanges cannot install tokens or make a later company read; previous credentials remain usable", async (t) => {
  for (const mutation of ["cancel", "begin", "install", "disable"]) {
    const f = setup(t);
    f.app.providerCredentials.install(f.binding, 0, previous());
    const start = f.flow.begin(f.binding, 1);
    let calls = 0,
      release!: () => void,
      entered!: () => void;
    const signal = new Promise<void>((resolve) => {
        entered = resolve;
      }),
      original = globalThis.fetch;
    globalThis.fetch = async () => {
      calls++;
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return response();
    };
    try {
      const completing = f.flow.complete(
        f.binding,
        start.id,
        "secret",
        callback(start, f.binding),
      );
      await signal;
      if (mutation === "cancel") f.flow.cancel(f.binding, start.id);
      if (mutation === "begin") f.flow.begin(f.binding, 1);
      if (mutation === "install")
        f.app.providerCredentials.install(f.binding, 1, previous());
      if (mutation === "disable")
        f.app.providerCredentials.disable(f.binding, 1);
      release();
      await assert.rejects(
        completing,
        code(
          ["cancel", "begin"].includes(mutation) ? "OAUTH_STALE" : "REVISION",
        ),
      );
      assert.equal(calls, 1);
      assert.equal(
        f.app.providerCredentials.status(f.binding).revision,
        ["cancel", "begin"].includes(mutation) ? 1 : 2,
      );
      assert.equal(
        f.flow.status(f.binding, start.id).state,
        ["cancel", "begin"].includes(mutation) ? "canceled" : "unknown",
      );
    } finally {
      globalThis.fetch = original;
    }
  }
});

test("lost/invalid/oversized tokens, unexpected scopes and wrong sandbox companies discard the consumed attempt without replacing previous credentials", async (t) => {
  const candidates = [
    () => {
      throw new Error("synthetic-secret-error");
    },
    () => new Response("synthetic-secret-error", { status: 400 }),
    () => new Response("x".repeat(65537)),
    () => response({ access_token: "token\r\ninvalid" }),
    () => response({ scope: "openid" }),
    () => response({ expires_in: 1 }),
    () => Response.json({ token_type: "bearer" }),
  ];
  for (const candidate of candidates) {
    const f = setup(t);
    f.app.providerCredentials.install(f.binding, 0, previous());
    const start = f.flow.begin(f.binding, 1),
      original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return candidate();
    };
    try {
      await assert.rejects(
        f.flow.complete(
          f.binding,
          start.id,
          "secret",
          callback(start, f.binding),
        ),
        (e: any) => !e.message.includes("synthetic-secret-error"),
      );
      assert.equal(f.flow.status(f.binding, start.id).state, "unknown");
      assert.equal(f.app.providerCredentials.status(f.binding).revision, 1);
      await assert.rejects(
        f.flow.complete(
          f.binding,
          start.id,
          "secret",
          callback(start, f.binding),
        ),
        code("OAUTH_USED"),
      );
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = original;
    }
  }
  const f = setup(t),
    start = f.flow.begin(f.binding, 0);
  let calls = 0;
  mock(t, async () => {
    calls++;
    return calls === 1
      ? response()
      : Response.json({ CompanyInfo: { Id: "9999" } });
  });
  await assert.rejects(
    f.flow.complete(f.binding, start.id, "secret", callback(start, f.binding)),
    code("OAUTH_COMPANY"),
  );
  assert.equal(f.app.providerCredentials.status(f.binding).state, "missing");
  assert.equal(f.flow.status(f.binding, start.id).state, "unknown");
  assert.equal(calls, 2);
});

test("late authority changes after sandbox company read and late audit failure roll back installation and mark only the claimed attempt unknown", async (t) => {
  for (const late of ["consent", "audit"]) {
    const f = setup(t);
    f.app.providerCredentials.install(f.binding, 0, previous());
    const before = f.store.get("SELECT * FROM integration_credentials"),
      start = f.flow.begin(f.binding, 1);
    let calls = 0;
    const original = globalThis.fetch;
    globalThis.fetch = async () => {
      calls++;
      if (calls === 1) return response();
      if (late === "consent")
        chooseProviders(f, f.actor, "withdraw", {
          accountId: f.buyer,
          region: "CA",
          mode: "strict",
          providers: [],
          version: 2,
          acknowledgment: "Synthetic withdrawal",
        });
      if (late === "audit")
        f.app.database
          .owned("platform")
          .migrate(
            "CREATE TRIGGER platform_oauth_audit_fail BEFORE INSERT ON platform_audit WHEN NEW.action='provider.authorization.complete' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END;",
          );
      return Response.json({ CompanyInfo: { Id: "1234" } });
    };
    try {
      await assert.rejects(
        f.flow.complete(
          f.binding,
          start.id,
          "secret",
          callback(start, f.binding),
        ),
        code(late === "consent" ? "RESIDENCY_BLOCKED" : "OAUTH_EXCHANGE"),
      );
      assert.deepEqual(
        f.store.get("SELECT * FROM integration_credentials"),
        before,
      );
      assert.equal(
        f.store.get("SELECT state FROM integration_authorizations")!.state,
        "unknown",
      );
      assert.equal(
        f.app.database
          .owned("platform")
          .all(
            "SELECT * FROM platform_audit WHERE action='provider.authorization.complete'",
          ).length,
        0,
      );
    } finally {
      globalThis.fetch = original;
    }
  }
});

test("begin and cancel audit failures preserve original attempts transactionally", (t) => {
  const f = setup(t),
    start = f.flow.begin(f.binding, 0),
    before = f.store.all("SELECT * FROM integration_authorizations");
  f.app.database
    .owned("platform")
    .migrate(
      "CREATE TRIGGER platform_oauth_audit_fail BEFORE INSERT ON platform_audit WHEN NEW.action IN('provider.authorization.begin','provider.authorization.cancel') BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END;",
    );
  assert.throws(() => f.flow.begin(f.binding, 0));
  assert.deepEqual(
    f.store.all("SELECT * FROM integration_authorizations"),
    before,
  );
  assert.throws(() => f.flow.cancel(f.binding, start.id));
  assert.deepEqual(
    f.store.all("SELECT * FROM integration_authorizations"),
    before,
  );
});

test("encrypted restore cancels copied pending authorizations even after a test-only recovery hold is removed", async (t) => {
  const f = setup(t),
    start = f.flow.begin(f.binding, 0),
    backup = join(dirname(f.path), "backup.enc"),
    restoredPath = join(dirname(f.path), "restored.db"),
    backupKey = Buffer.from("de".repeat(32), "hex");
  await createBackup(f.path, backup, "CA", backupKey);
  await restoreBackup(backup, restoredPath, "CA", backupKey);
  const restored = new Application(restoredPath, "CA", config);
  let calls = 0;
  mock(t, async () => {
    calls++;
    return response();
  });
  try {
    assert.equal(
      restored.providerCredentials.authorization.status(f.binding, start.id)
        .state,
      "canceled",
    );
    restored.database.owned("platform").run("DELETE FROM platform_recovery");
    await assert.rejects(
      restored.providerCredentials.authorization.complete(
        f.binding,
        start.id,
        "secret",
        callback(start, f.binding),
      ),
      code("OAUTH_USED"),
    );
    assert.equal(calls, 0);
  } finally {
    restored.close();
  }
});

test("operator CLI prepares URL offline, reports metadata/cancels, rejects secret args/oversized input and defaults outbound complete off", async (t) => {
  const f = setup(t),
    env = {
      ...process.env,
      DATABASE_PATH: f.path,
      DATA_REGION: "CA",
      PROVIDER_BINDING_ID: f.binding.id,
      PROVIDER_ORG_ID: f.binding.orgId,
      PROVIDER_WORKER_USER_ID: f.binding.workerUserId,
      PROVIDER_ACCOUNT_ID: f.buyer,
      QUICKBOOKS_REALM_ID: f.binding.realm,
      QUICKBOOKS_CLIENT_ID: f.binding.clientId,
      QUICKBOOKS_REDIRECT_URI: f.binding.redirectUri,
      PROVIDER_ENCRYPTION_KEY: key,
      PROVIDERS_ENABLED: "false",
      QUICKBOOKS_CLIENT_SECRET: "synthetic-client-secret",
    };
  const run = (args: string[], input: string) =>
    new Promise<{ code: number | null; out: string; err: string }>(
      (resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            "--import",
            "tsx",
            "src/server/quickbooks-authorization-cli.ts",
            ...args,
          ],
          { env, stdio: ["pipe", "pipe", "pipe"] },
        );
        let out = "",
          err = "";
        child.stdout.on("data", (b) => {
          out += b;
        });
        child.stderr.on("data", (b) => {
          err += b;
        });
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, out, err }));
        child.stdin.end(input);
      },
    );
  const started = await run(["begin"], JSON.stringify({ revision: 0 }));
  assert.equal(started.code, 0);
  const start = JSON.parse(started.out);
  assert.equal(
    (await run(["status"], JSON.stringify({ attemptId: start.id }))).code,
    0,
  );
  const blocked = await run(
    ["complete"],
    JSON.stringify({
      attemptId: start.id,
      callbackUrl: callback(start, f.binding),
    }),
  );
  assert.equal(blocked.code, 1);
  assert.ok(blocked.err.includes("PROVIDER_DISABLED"));
  assert.equal(
    (await run(["cancel"], JSON.stringify({ attemptId: start.id }))).code,
    0,
  );
  for (const [args, input] of [
    [["begin", "synthetic-authorization-code"], ""],
    [["begin"], "synthetic-authorization-code"],
    [["begin"], "x".repeat(32769)],
  ] as [string[], string][]) {
    const result = await run(args, input);
    assert.equal(result.code, 1);
    assert.ok(
      !result.out.includes("synthetic-authorization-code") &&
        !result.err.includes("synthetic-authorization-code"),
    );
  }
});

test(
  "independent operating-system processes serialize a single authorization exchange and sandbox company read",
  { timeout: 15000 },
  async (t) => {
    const f = setup(t),
      start = f.flow.begin(f.binding, 0),
      children = [0, 1].map(() =>
        fork(
          new URL("./quickbooks-authorization-child.ts", import.meta.url),
          [],
          {
            execArgv: ["--import", "tsx"],
            stdio: ["ignore", "ignore", "pipe", "ipc"],
          },
        ),
      );
    t.after(() => {
      for (const child of children) if (child.connected) child.kill();
    });
    const input = {
      path: f.path,
      key,
      binding: f.binding,
      attemptId: start.id,
      callback: callback(start, f.binding),
    };
    const outcome = children.map(
      (child) =>
        new Promise<any>((resolve, reject) => {
          child.on("error", reject);
          child.on("message", (value: any) => {
            if (value.ok !== undefined) resolve(value);
          });
          child.on("exit", (exit) => {
            if (exit && exit !== 0) reject(new Error(`Child exit ${exit}`));
          });
        }),
    );
    await Promise.all(
      children.map(
        (child) =>
          new Promise<void>((resolve) => {
            child.on("message", (value: any) => {
              if (value.ready) resolve();
            });
            child.send({ action: "init", input });
          }),
      ),
    );
    const firstRequest = new Promise<number>((resolve) =>
      children.forEach((child, index) =>
        child.on("message", (value: any) => {
          if (value.requested) resolve(index);
        }),
      ),
    );
    for (const child of children) child.send({ action: "go" });
    const winner = await Promise.race([
        firstRequest,
        Promise.all(outcome).then((values) => {
          throw new Error(
            `Both children completed before requesting exchange: ${values.map((value) => value.code ?? "unexpected success").join(", ")}`,
          );
        }),
      ]),
      loser = 1 - winner;
    assert.equal((await outcome[loser]).code, "OAUTH_BUSY");
    children[winner]!.send({ action: "release" });
    const results = await Promise.all(outcome);
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(
      results.reduce((sum, r) => sum + r.calls, 0),
      2,
    );
    assert.equal(f.app.providerCredentials.status(f.binding).revision, 1);
  },
);
