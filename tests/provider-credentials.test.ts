import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fork, spawn } from "node:child_process";
import { chooseProviders, fixture, accept, ship } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { configuredProviders } from "../src/server/provider-runtime.ts";
import { type Effect } from "../src/server/integration.ts";
import { createBackup, restoreBackup } from "../src/server/recovery.ts";
const key = "ab".repeat(32),
  config = { providerEncryptionKey: key };
function setup(t: Parameters<typeof fixture>[0]) {
  const f = fixture(t, config);
  const binding = {
    id: "synthetic-binding",
    orgId: f.actor.orgId,
    workerUserId: f.actor.id,
    realm: "1234",
    clientId: "synthetic-client",
  };
  chooseProviders(f, f.actor, "choice", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["quickbooks"],
    version: 1,
    acknowledgment: "Synthetic processor choice",
  });
  const effect: Effect = {
    id: "synthetic-effect",
    org_id: f.actor.orgId,
    account_id: f.buyer,
    provider: "quickbooks",
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
  return { ...f, binding, effect };
}
function bundle(expired = false) {
  return {
    accessToken: "synthetic-access-original",
    refreshToken: "synthetic-refresh-original",
    accessExpiresAt: Date.now() + (expired ? -1000 : 3600000),
    refreshExpiresAt: Date.now() + 100 * 86400000,
    hardExpiresAt: Date.now() + 180 * 86400000,
  };
}
function response(overrides: object = {}) {
  return Response.json({
    access_token: "synthetic-access-next",
    refresh_token: "synthetic-refresh-next",
    token_type: "bearer",
    expires_in: 3600,
    x_refresh_token_expires_in: 100 * 86400,
    x_refresh_token_hard_expires_in: 180 * 86400,
    ...overrides,
  });
}
const mocked = new WeakSet<object>();
function mock(t: Parameters<typeof fixture>[0], fn: typeof fetch) {
  const original = globalThis.fetch;
  globalThis.fetch = fn;
  if (!mocked.has(t)) {
    mocked.add(t);
    t.after(() => {
      globalThis.fetch = original;
    });
  }
}
function code(value: string) {
  return (e: unknown) => (e as { code: string }).code === value;
}

test("encrypted tokens bind organization/binding/client/company/revision and remain absent from audit, commands, files and status", async (t) => {
  const f = setup(t),
    vault = f.app.providerCredentials;
  assert.equal(vault.install(f.binding, 0, bundle()).revision, 1);
  assert.equal(
    await vault.access(f.binding, "synthetic-client-secret", f.effect),
    bundle().accessToken,
  );
  const store = f.app.database.owned("integration"),
    row = store.get("SELECT * FROM integration_credentials")!;
  assert.ok(row.material);
  const privateDump = JSON.stringify({
    row,
    status: vault.status(f.binding),
    audit: f.app.database.owned("platform").all("SELECT * FROM platform_audit"),
    commands: f.app.database
      .owned("platform")
      .all("SELECT * FROM platform_commands"),
  });
  for (const secret of [
    bundle().accessToken,
    bundle().refreshToken,
    "synthetic-client-secret",
  ]) {
    assert.ok(!privateDump.includes(secret));
    for (const path of [f.path, f.path + "-wal"])
      assert.ok(!readFileSync(path).includes(Buffer.from(secret)));
  }
  assert.throws(
    () => vault.install({ ...f.binding, realm: "9999" }, 1, bundle()),
    code("CREDENTIAL_SCOPE"),
  );
  assert.throws(
    () =>
      vault.install({ ...f.binding, clientId: "another-client" }, 1, bundle()),
    code("CREDENTIAL_SCOPE"),
  );
  assert.throws(() => vault.install(f.binding, 0, bundle()), code("REVISION"));
  store.run("UPDATE integration_credentials SET revision=revision+1");
  await assert.rejects(
    vault.access(f.binding, "synthetic-client-secret", f.effect),
    code("CREDENTIAL_INTEGRITY"),
  );
});

test("missing/wrong key, tampered ciphertext and incorrect tenant fail closed without outbound calls", async (t) => {
  const f = setup(t);
  f.app.providerCredentials.install(f.binding, 0, bundle());
  let calls = 0;
  mock(t, async () => {
    calls++;
    return response();
  });
  for (const security of [{}, { providerEncryptionKey: "cd".repeat(32) }]) {
    const app = new Application(f.path, "CA", security);
    try {
      await assert.rejects(
        app.providerCredentials.access(f.binding, "secret", f.effect),
        code(
          "providerEncryptionKey" in security
            ? "CREDENTIAL_INTEGRITY"
            : "CREDENTIAL_KEY",
        ),
      );
    } finally {
      app.close();
    }
  }
  await assert.rejects(
    f.app.providerCredentials.access(f.binding, "secret", {
      ...f.effect,
      org_id: "foreign",
    }),
    code("FORBIDDEN"),
  );
  f.app.database
    .owned("integration")
    .run("UPDATE integration_credentials SET material='{}'");
  await assert.rejects(
    f.app.providerCredentials.access(f.binding, "secret", f.effect),
    code("CREDENTIAL_INTEGRITY"),
  );
  assert.equal(calls, 0);
  assert.throws(
    () => new Application(":memory:", "CA", { providerEncryptionKey: "wrong" }),
    code("CREDENTIAL_KEY"),
  );
});

test("refresh posts exact form/Basic credentials once, rotates both encrypted tokens, uses bounded expiries and survives restart", async (t) => {
  const f = setup(t),
    before = bundle(true);
  f.app.providerCredentials.install(f.binding, 0, before);
  let calls = 0;
  mock(t, async (url, init) => {
    calls++;
    assert.equal(
      url,
      "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    );
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    const headers = new Headers(init?.headers);
    assert.equal(
      headers.get("Authorization"),
      `Basic ${Buffer.from("synthetic-client:synthetic-client-secret").toString("base64")}`,
    );
    assert.equal(
      headers.get("Content-Type"),
      "application/x-www-form-urlencoded",
    );
    assert.equal(
      headers.get("x-include-refresh-token-hard-expires-in"),
      "true",
    );
    assert.deepEqual(
      [...new URLSearchParams(String(init?.body))],
      [
        ["grant_type", "refresh_token"],
        ["refresh_token", before.refreshToken],
      ],
    );
    return response();
  });
  assert.equal(
    await f.app.providerCredentials.access(
      f.binding,
      "synthetic-client-secret",
      f.effect,
    ),
    "synthetic-access-next",
  );
  assert.equal(f.app.providerCredentials.status(f.binding).revision, 2);
  const reopened = new Application(f.path, "CA", config);
  try {
    assert.equal(
      await reopened.providerCredentials.access(
        f.binding,
        "synthetic-client-secret",
        f.effect,
      ),
      "synthetic-access-next",
    );
  } finally {
    reopened.close();
  }
  assert.equal(calls, 1);
});

test("overlapping connections never rotate a refresh token twice; current claimant alone commits", async (t) => {
  const f = setup(t),
    other = new Application(f.path, "CA", config);
  t.after(() => other.close());
  f.app.providerCredentials.install(f.binding, 0, bundle(true));
  let finish!: (value: Response) => void,
    calls = 0;
  mock(t, async () => {
    calls++;
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  const first = f.app.providerCredentials.access(f.binding, "secret", f.effect);
  await assert.rejects(
    other.providerCredentials.access(f.binding, "secret", f.effect),
    code("CREDENTIAL_BUSY"),
  );
  finish(response());
  assert.equal(await first, "synthetic-access-next");
  assert.equal(calls, 1);
});

test("token lifetime cannot extend an existing hard deadline and oversized responses discard ambiguous credentials", async (t) => {
  const f = setup(t),
    clock = Date.now;
  let timestamp = clock();
  Date.now = () => timestamp;
  t.after(() => {
    Date.now = clock;
  });
  const original = { ...bundle(true), hardExpiresAt: timestamp + 60000 };
  f.app.providerCredentials.install(f.binding, 0, original);
  let calls = 0;
  mock(t, async () => {
    calls++;
    return response();
  });
  await f.app.providerCredentials.access(f.binding, "secret", f.effect);
  timestamp += 60001;
  await assert.rejects(
    f.app.providerCredentials.access(f.binding, "secret", f.effect),
    code("CREDENTIAL_EXPIRED"),
  );
  assert.equal(calls, 1);
  f.app.providerCredentials.install(f.binding, 2, bundle(true));
  mock(t, async () => new Response("synthetic-secret-body".repeat(4000)));
  await assert.rejects(
    f.app.providerCredentials.access(f.binding, "secret", f.effect),
    code("CREDENTIAL_REFRESH"),
  );
  assert.equal(f.app.providerCredentials.status(f.binding).state, "unknown");
  assert.equal(
    f.app.database
      .owned("integration")
      .get("SELECT material FROM integration_credentials")!.material,
    null,
  );
});

test("operator install and disable roll back material, revision and state when audit fails", async (t) => {
  const f = setup(t),
    audit = f.app.platform.audit;
  const fail = () => {
    throw new Error("synthetic audit failure");
  };
  f.app.platform.audit = fail;
  assert.throws(() =>
    f.app.providerCredentials.install(f.binding, 0, bundle()),
  );
  assert.equal(f.app.providerCredentials.status(f.binding).state, "missing");
  f.app.platform.audit = audit;
  f.app.providerCredentials.install(f.binding, 0, bundle());
  const before = f.app.database
    .owned("integration")
    .get("SELECT * FROM integration_credentials");
  f.app.platform.audit = fail;
  assert.throws(() =>
    f.app.providerCredentials.install(f.binding, 1, {
      ...bundle(),
      accessToken: "synthetic-replacement",
    }),
  );
  assert.deepEqual(
    f.app.database
      .owned("integration")
      .get("SELECT * FROM integration_credentials"),
    before,
  );
  assert.throws(() => f.app.providerCredentials.disable(f.binding, 1));
  assert.deepEqual(
    f.app.database
      .owned("integration")
      .get("SELECT * FROM integration_credentials"),
    before,
  );
  f.app.platform.audit = audit;
});

test("rotation/disable during refresh fences stale completion and cannot overwrite successor credentials", async (t) => {
  const f = setup(t);
  for (const action of ["install", "disable"] as const) {
    const revision = f.app.providerCredentials.status(f.binding).revision;
    f.app.providerCredentials.install(f.binding, revision, bundle(true));
    let finish!: (value: Response) => void;
    mock(
      t,
      async () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = f.app.providerCredentials.access(
      f.binding,
      "secret",
      f.effect,
    );
    const claimedRevision = f.app.providerCredentials.status(
      f.binding,
    ).revision;
    if (action === "install")
      f.app.providerCredentials.install(f.binding, claimedRevision, {
        ...bundle(),
        accessToken: "synthetic-successor-access",
      });
    else f.app.providerCredentials.disable(f.binding, claimedRevision);
    finish(response());
    await assert.rejects(pending, code("CREDENTIAL_STALE"));
    assert.equal(
      f.app.providerCredentials.status(f.binding).state,
      action === "install" ? "ready" : "disabled",
    );
    if (action === "install")
      assert.equal(
        await f.app.providerCredentials.access(f.binding, "secret", f.effect),
        "synthetic-successor-access",
      );
  }
});

test("lost response, invalid response, expiry and late audit rollback require reconnect without retry or secret leakage", async (t) => {
  const f = setup(t);
  const failures: (() => Promise<Response>)[] = [
    async () => {
      throw new Error("synthetic-secret-body-timeout");
    },
    async () => new Response("synthetic-secret-body", { status: 401 }),
    async () => new Response("synthetic-secret-body", { status: 200 }),
    async () => response({ refresh_token: undefined }),
    async () => response({ token_type: "other" }),
    async () => response({ expires_in: "3600" }),
    async () => response({ expires_in: 1 }),
    async () => response({ x_refresh_token_expires_in: 0 }),
    async () => response({ x_refresh_token_hard_expires_in: 0 }),
    async () => new Response("x".repeat(65537)),
  ];
  for (const failure of failures) {
    f.app.providerCredentials.install(
      f.binding,
      f.app.providerCredentials.status(f.binding).revision,
      bundle(true),
    );
    let calls = 0;
    mock(t, async () => {
      calls++;
      return failure();
    });
    await assert.rejects(
      f.app.providerCredentials.access(f.binding, "secret", f.effect),
      (error: unknown) => {
        assert.ok(!String(error).includes("synthetic-secret-body"));
        return true;
      },
    );
    assert.equal(f.app.providerCredentials.status(f.binding).state, "unknown");
    assert.equal(
      f.app.database
        .owned("integration")
        .get("SELECT material FROM integration_credentials")!.material,
      null,
    );
    await assert.rejects(
      f.app.providerCredentials.access(f.binding, "secret", f.effect),
      code("CREDENTIAL_RECONNECT"),
    );
    assert.equal(calls, 1);
  }
  f.app.providerCredentials.install(
    f.binding,
    f.app.providerCredentials.status(f.binding).revision,
    bundle(true),
  );
  mock(t, async () => response());
  const audit = f.app.platform.audit;
  f.app.platform.audit = () => {
    throw new Error("late audit fault");
  };
  await assert.rejects(
    f.app.providerCredentials.access(f.binding, "secret", f.effect),
    code("CREDENTIAL_REFRESH"),
  );
  f.app.platform.audit = audit;
  assert.equal(f.app.providerCredentials.status(f.binding).state, "unknown");
});

test("grant, forced password change, customer consent and restore hold prevent credential use and reject completion after I/O", async (t) => {
  for (const phase of ["before", "after"] as const)
    for (const restriction of [
      "grant",
      "password",
      "consent",
      "restore",
    ] as const) {
      const f = setup(t);
      f.app.providerCredentials.install(
        f.binding,
        0,
        bundle(phase === "after"),
      );
      const restrict = () => {
        if (restriction === "grant")
          f.app.database
            .owned("iam")
            .run("UPDATE iam_users SET active=0 WHERE id=?", f.actor.id);
        if (restriction === "password")
          f.app.database
            .owned("iam")
            .run(
              "INSERT INTO iam_user_security VALUES(?,1,1,?) ON CONFLICT(user_id) DO UPDATE SET password_change_required=1,updated_at=excluded.updated_at",
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
            acknowledgment: "Withdraw synthetic permission",
          });
        if (restriction === "restore")
          f.app.platform.isolateRestore("snapshot", new Date().toISOString());
      };
      let calls = 0;
      mock(t, async () => {
        calls++;
        restrict();
        return response();
      });
      if (phase === "before") restrict();
      await assert.rejects(
        f.app.providerCredentials.access(f.binding, "secret", f.effect),
        code(
          {
            grant: "FORBIDDEN",
            password: "PASSWORD_CHANGE_REQUIRED",
            consent: "RESIDENCY_BLOCKED",
            restore: "RECOVERY_HOLD",
          }[restriction],
        ),
      );
      assert.equal(calls, phase === "before" ? 0 : 1);
      if (phase === "after")
        assert.equal(
          f.app.database
            .owned("integration")
            .get("SELECT state FROM integration_credentials")!.state,
          "unknown",
        );
    }
});

test("abandoned refresh claims become unknown without resend; expired refresh or hard lifetime refuses I/O", async (t) => {
  const f = setup(t),
    clock = Date.now;
  t.after(() => {
    Date.now = clock;
  });
  let timestamp = clock();
  Date.now = () => timestamp;
  let calls = 0;
  mock(t, async () => {
    calls++;
    return response();
  });
  f.app.providerCredentials.install(f.binding, 0, bundle(true));
  f.app.database
    .owned("integration")
    .run(
      "UPDATE integration_credentials SET state='refreshing',claim='abandoned',started_at=?",
      timestamp - 90001,
    );
  await assert.rejects(
    f.app.providerCredentials.access(f.binding, "secret", f.effect),
    code("CREDENTIAL_RECONNECT"),
  );
  assert.equal(f.app.providerCredentials.status(f.binding).state, "unknown");
  for (const expiry of ["refreshExpiresAt", "hardExpiresAt"] as const) {
    f.app.providerCredentials.install(
      f.binding,
      f.app.providerCredentials.status(f.binding).revision,
      { ...bundle(), [expiry]: timestamp + 1000 },
    );
    timestamp += 2000;
    await assert.rejects(
      f.app.providerCredentials.access(f.binding, "secret", f.effect),
      code("CREDENTIAL_EXPIRED"),
    );
  }
  assert.equal(calls, 0);
});

test("restore erases snapshot tokens and cannot resurrect a disabled or rotated credential", async (t) => {
  const f = setup(t),
    backup = join(dirname(f.path), "credentials.distributor-backup"),
    restoredPath = join(dirname(f.path), "restored.db"),
    recoveryKey = randomBytes(32);
  f.app.providerCredentials.install(f.binding, 0, bundle());
  await createBackup(f.path, backup, "CA", recoveryKey);
  f.app.providerCredentials.disable(f.binding, 1);
  await restoreBackup(backup, restoredPath, "CA", recoveryKey);
  const restored = new Application(restoredPath, "CA", config);
  try {
    assert.equal(
      restored.providerCredentials.status(f.binding).state,
      "disabled",
    );
    assert.equal(
      restored.database
        .owned("integration")
        .get("SELECT material FROM integration_credentials")!.material,
      null,
    );
    restored.database.owned("platform").run("DELETE FROM platform_recovery");
    await assert.rejects(
      restored.providerCredentials.access(f.binding, "secret", f.effect),
      code("CREDENTIAL_RECONNECT"),
    );
  } finally {
    restored.close();
  }
});

test("protected stdin CLI installs/disables offline and rejects secret arguments and malformed input without echo", async (t) => {
  const f = setup(t),
    env = {
      ...process.env,
      DATABASE_PATH: f.path,
      DATA_REGION: "CA",
      PROVIDER_BINDING_ID: f.binding.id,
      PROVIDER_ORG_ID: f.binding.orgId,
      PROVIDER_WORKER_USER_ID: f.binding.workerUserId,
      QUICKBOOKS_REALM_ID: f.binding.realm,
      QUICKBOOKS_CLIENT_ID: f.binding.clientId,
      PROVIDER_ENCRYPTION_KEY: key,
    };
  const run = (args: string[], input = "") =>
    new Promise<{ code: number | null; out: string; err: string }>(
      (resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            "--import",
            "tsx",
            "src/server/provider-credentials-cli.ts",
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
  const installed = await run(
    ["install"],
    JSON.stringify({ revision: 0, tokens: bundle() }),
  );
  assert.equal(installed.code, 0);
  assert.equal(JSON.parse(installed.out).revision, 1);
  const status = await run(["status"]);
  assert.equal(status.code, 0);
  assert.equal(JSON.parse(status.out).state, "ready");
  assert.equal(
    (await run(["disable"], JSON.stringify({ revision: 1 }))).code,
    0,
  );
  for (const [args, input] of [
    [["install", "synthetic-secret-body"], ""],
    [["install"], "synthetic-secret-body"],
    [["install"], "x".repeat(32769)],
  ] as [string[], string][]) {
    const result = await run(args, input);
    assert.equal(result.code, 1);
    assert.ok(
      !result.out.includes("synthetic-secret-body") &&
        !result.err.includes("synthetic-secret-body"),
    );
  }
});

test("configured managed runtime refreshes and reuses credentials in a real accounting lookup without a provider network", async (t) => {
  const f = setup(t),
    invoiceId = ship(f, accept(f).id).invoiceId;
  const intent = f.app.integration.accounting(f.actor, "queue", {
    invoiceId,
    customerRef: "customer-1",
    itemRefs: { [f.product]: "item-1" },
    taxCodeRef: "tax-1",
    taxRateRef: "rate-1",
  });
  f.app.providerCredentials.install(f.binding, 0, bundle(true));
  const env = {
    PROVIDERS_ENABLED: "true",
    QUICKBOOKS_CREDENTIAL_MODE: "managed",
    PROVIDER_BINDING_ID: f.binding.id,
    PROVIDER_ORG_ID: f.binding.orgId,
    PROVIDER_WORKER_USER_ID: f.binding.workerUserId,
    QUICKBOOKS_REALM_ID: f.binding.realm,
    QUICKBOOKS_CLIENT_ID: f.binding.clientId,
    QUICKBOOKS_CLIENT_SECRET: "synthetic-client-secret",
  };
  const runtime = configuredProviders(f.app, env)!;
  let calls = 0;
  mock(t, async (url, init) => {
    calls++;
    if (String(url).includes("oauth.platform")) return response();
    assert.ok(
      String(url).startsWith(
        "https://sandbox-quickbooks.api.intuit.com/v3/company/1234/query?",
      ),
    );
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      "Bearer synthetic-access-next",
    );
    return Response.json({ QueryResponse: {} });
  });
  // Claim a send with an uncertain outcome, then exercise the configured runtime read.
  await f.app.integration.execute(f.actor, intent.id, {
    execute: async () => {
      throw new Error("synthetic lost send");
    },
    lookup: async () => null,
  });
  assert.equal(f.app.integration.effect(f.actor, intent.id).state, "unknown");
  await runtime.reconcile(f.actor, intent.id);
  assert.equal(calls, 2);
  assert.equal(f.app.integration.effect(f.actor, intent.id).state, "unknown");
  assert.throws(
    () =>
      configuredProviders(f.app, {
        ...env,
        QUICKBOOKS_ACCESS_TOKEN: "synthetic-env-token",
      }),
    code("PROVIDER_CONFIG"),
  );
  assert.throws(
    () =>
      configuredProviders(f.app, {
        ...env,
        QUICKBOOKS_CREDENTIAL_MODE: "wrong",
      }),
    code("PROVIDER_CONFIG"),
  );
});

test(
  "two operating-system processes obtain only one refresh claim",
  { timeout: 15000 },
  async (t) => {
    const f = setup(t);
    f.app.providerCredentials.install(f.binding, 0, bundle(true));
    let requested: ReturnType<typeof fork> | undefined,
      blocked = false;
    const make = () => {
      const child = fork(
        new URL("./provider-credentials-child.ts", import.meta.url),
        [],
        {
          execArgv: ["--import", "tsx"],
          stdio: ["ignore", "ignore", "pipe", "ipc"],
        },
      );
      t.after(() => child.kill());
      let readyResolve!: () => void,
        resultResolve!: (v: {
          ok: boolean;
          code?: string;
          calls: number;
        }) => void;
      const ready = new Promise<void>((r) => {
          readyResolve = r;
        }),
        result = new Promise<{ ok: boolean; code?: string; calls: number }>(
          (r) => {
            resultResolve = r;
          },
        );
      child.on("message", (m: any) => {
        if (m.ready) readyResolve();
        else if (m.requested) {
          requested = child;
          if (blocked) requested.send({ action: "release" });
        } else {
          if (m.code === "CREDENTIAL_BUSY") {
            blocked = true;
            requested?.send({ action: "release" });
          }
          resultResolve(m);
        }
      });
      child.send({
        action: "init",
        input: { path: f.path, key, binding: f.binding, effect: f.effect },
      });
      return { child, ready, result };
    };
    const a = make(),
      b = make();
    // Both are initialized before releasing the shared start barrier.
    await Promise.all([a.ready, b.ready]);
    a.child.send({ action: "go" });
    b.child.send({ action: "go" });
    const results = await Promise.all([a.result, b.result]);
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(results.filter((r) => r.code === "CREDENTIAL_BUSY").length, 1);
    assert.equal(
      results.reduce((n, r) => n + r.calls, 0),
      1,
    );
  },
);
