import { test } from "node:test";
import assert from "node:assert/strict";
import { fork, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { chooseProviders, fixture, seedDisclosures } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { type Effect } from "../src/server/integration.ts";
const key = "ab".repeat(32),
  nextKey = "cd".repeat(32);
const code = (expected: string) => (error: unknown) =>
  (error as { code: string }).code === expected;
const tokens = () => ({
  accessToken: "synthetic-rotation-access",
  refreshToken: "synthetic-rotation-refresh",
  accessExpiresAt: Date.now() + 3600000,
  refreshExpiresAt: Date.now() + 86400000,
  hardExpiresAt: Date.now() + 172800000,
});
function setup(t: Parameters<typeof fixture>[0]) {
  const f = fixture(t, { providerEncryptionKey: key });
  chooseProviders(f, f.actor, "rotation-choice", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["quickbooks"],
    version: 1,
    acknowledgment: "Synthetic processing permission",
  });
  const binding = {
    id: "rotation-binding",
    orgId: f.actor.orgId,
    workerUserId: f.actor.id,
    realm: "1234",
    clientId: "synthetic-client",
    accountId: f.buyer,
    redirectUri: "http://127.0.0.1:3000/callback",
  };
  const effect = {
    org_id: f.actor.orgId,
    account_id: f.buyer,
    provider: "quickbooks",
  } as Effect;
  return {
    ...f,
    binding,
    effect,
    vault: f.app.providerCredentials,
    store: f.app.database.owned("integration"),
    workers: [{ orgId: f.actor.orgId, workerUserId: f.actor.id }],
  };
}
function state(f: ReturnType<typeof setup>) {
  return {
    credentials: f.store.all(
      "SELECT * FROM integration_credentials ORDER BY org_id,binding_id",
    ),
    marker: f.store.all("SELECT * FROM integration_credential_key"),
    authorizations: f.store.all(
      "SELECT * FROM integration_authorizations ORDER BY id",
    ),
    audit: f.app.database
      .owned("platform")
      .all("SELECT * FROM platform_audit ORDER BY id"),
  };
}

test("atomic vault rotation preserves scoped tokens/deadlines, advances every binding and cancels pending OAuth without outbound I/O", async (t) => {
  const f = setup(t),
    second = { ...f.binding, id: "second-binding", realm: "5678" },
    disabled = { ...f.binding, id: "disabled-binding" };
  f.vault.install(f.binding, 0, tokens());
  f.vault.install(second, 0, tokens());
  f.vault.install(disabled, 0, tokens());
  f.vault.disable(disabled, 1);
  const pending = f.vault.authorization.begin(f.binding, 1),
    before = state(f);
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("Rotation must be offline");
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  assert.deepEqual(f.vault.rotate(f.workers, 1, nextKey), {
    generation: 2,
    bindings: 3,
    canceledAuthorizations: 1,
  });
  assert.equal(f.vault.status(f.binding).revision, 2);
  assert.equal(f.vault.status(disabled).revision, 3);
  assert.equal(f.vault.status(disabled).state, "disabled");
  assert.equal(
    f.vault.authorization.status(f.binding, pending.id).state,
    "canceled",
  );
  const after = state(f);
  assert.notEqual(
    after.credentials.find((r) => r.binding_id === f.binding.id)!.material,
    before.credentials.find((r) => r.binding_id === f.binding.id)!.material,
  );
  assert.equal(
    await f.vault.access(f.binding, "secret", f.effect),
    tokens().accessToken,
  );
  assert.equal(
    await f.vault.access(second, "secret", f.effect),
    tokens().accessToken,
  );
  const reopened = new Application(f.path, "CA", {
    providerEncryptionKey: nextKey,
  });
  t.after(() => reopened.close());
  assert.equal(
    await reopened.providerCredentials.access(f.binding, "secret", f.effect),
    tokens().accessToken,
  );
  const current = f.store.get(
    "SELECT * FROM integration_credentials WHERE binding_id=?",
    f.binding.id,
  )!;
  const originalExpiry = tokens().hardExpiresAt;
  // Prove refresh/hard deadlines were retained rather than silently renewed by rotation.
  const clock = Date.now;
  Date.now = () => originalExpiry + 1000;
  try {
    await assert.rejects(
      f.vault.access(f.binding, "secret", f.effect),
      code("CREDENTIAL_EXPIRED"),
    );
  } finally {
    Date.now = clock;
  }
  assert.equal(current.realm, "1234");
  const serialized = JSON.stringify(after);
  for (const secret of [
    key,
    nextKey,
    tokens().accessToken,
    tokens().refreshToken,
  ]) {
    assert.ok(!serialized.includes(secret));
    for (const path of [f.path, f.path + "-wal"])
      assert.ok(!readFileSync(path).includes(Buffer.from(secret)));
  }
});

test("same-process and restarted stale keys cannot install, refresh or authorize after rotation; key reuse never revives an old generation", async (t) => {
  const f = setup(t);
  f.vault.install(f.binding, 0, tokens());
  const stale = new Application(f.path, "CA", { providerEncryptionKey: key });
  t.after(() => stale.close());
  f.vault.rotate(f.workers, 1, nextKey);
  const restarted = new Application(f.path, "CA", {
    providerEncryptionKey: key,
  });
  t.after(() => restarted.close());
  for (const app of [stale, restarted]) {
    assert.equal(app.providerCredentials.keyStatus().current, false);
    assert.throws(
      () =>
        app.providerCredentials.install(
          { ...f.binding, id: "new" },
          0,
          tokens(),
        ),
      code("CREDENTIAL_INTEGRITY"),
    );
    assert.throws(
      () =>
        app.providerCredentials.authorization.begin(
          { ...f.binding, id: "new" },
          0,
        ),
      code("CREDENTIAL_INTEGRITY"),
    );
    await assert.rejects(
      app.providerCredentials.access(f.binding, "secret", f.effect),
      code("CREDENTIAL_INTEGRITY"),
    );
  }
  f.vault.rotate(f.workers, 2, key);
  assert.throws(
    () =>
      stale.providerCredentials.install(
        { ...f.binding, id: "new" },
        0,
        tokens(),
      ),
    code("CREDENTIAL_INTEGRITY"),
  );
  assert.equal(
    await f.vault.access(f.binding, "secret", f.effect),
    tokens().accessToken,
  );
});

test("integrity and late audit failures roll back all ciphertexts, revisions, cancellation and key marker; old runtime remains usable", async (t) => {
  for (const failure of ["ciphertext", "audit"] as const) {
    const f = setup(t);
    f.vault.install(f.binding, 0, tokens());
    const second = { ...f.binding, id: "zz-last" };
    f.vault.install(second, 0, tokens());
    f.vault.authorization.begin(f.binding, 1);
    if (failure === "ciphertext")
      f.store.run(
        "UPDATE integration_credentials SET material='{}' WHERE binding_id=?",
        second.id,
      );
    const before = state(f),
      original = f.app.platform.audit.bind(f.app.platform);
    if (failure === "audit")
      f.app.platform.audit = (...args) => {
        if (args[1] === "provider.credentials.rotate")
          throw new Error("Synthetic audit failure");
        return original(...args);
      };
    assert.throws(
      () => f.vault.rotate(f.workers, 1, nextKey),
      failure === "ciphertext"
        ? code("CREDENTIAL_INTEGRITY")
        : /Synthetic audit failure/,
    );
    f.app.platform.audit = original;
    assert.deepEqual(state(f), before);
    assert.deepEqual(f.vault.keyStatus(), {
      generation: 1,
      configured: true,
      current: true,
    });
    assert.equal(
      await f.vault.access(f.binding, "secret", f.effect),
      tokens().accessToken,
    );
  }
});

test("current authority/password/restore restrictions and expected generation refuse rotation without changes", (t) => {
  for (const restriction of [
    "grant",
    "password",
    "restore",
    "revision",
    "same-key",
    "duplicate",
  ] as const) {
    const f = setup(t);
    f.vault.install(f.binding, 0, tokens());
    if (restriction === "grant")
      f.app.database
        .owned("iam")
        .run("UPDATE iam_users SET active=0 WHERE id=?", f.actor.id);
    if (restriction === "password")
      f.app.database
        .owned("iam")
        .run(
          "INSERT INTO iam_user_security VALUES(?,1,1,?)",
          f.actor.id,
          new Date().toISOString(),
        );
    if (restriction === "restore")
      f.app.platform.isolateRestore("synthetic", new Date().toISOString());
    const before = state(f);
    assert.throws(
      () =>
        f.vault.rotate(
          restriction === "duplicate"
            ? [...f.workers, ...f.workers]
            : f.workers,
          restriction === "revision" ? 0 : 1,
          restriction === "same-key" ? key : nextKey,
        ),
      code(
        {
          grant: "FORBIDDEN",
          password: "PASSWORD_CHANGE_REQUIRED",
          restore: "RECOVERY_HOLD",
          revision: "REVISION",
          "same-key": "CREDENTIAL_KEY",
          duplicate: "CREDENTIAL_SCOPE",
        }[restriction],
      ),
    );
    assert.deepEqual(state(f), before);
  }
});

test("rotation refuses active/abandoned refresh and exchanging authorization claims until explicitly resolved", (t) => {
  for (const kind of ["refresh", "oauth"] as const) {
    const f = setup(t);
    f.vault.install(f.binding, 0, tokens());
    if (kind === "refresh")
      f.store.run(
        "UPDATE integration_credentials SET state='refreshing',claim='synthetic',started_at=1",
      );
    else {
      const attempt = f.vault.authorization.begin(f.binding, 1);
      f.store.run(
        "UPDATE integration_authorizations SET state='exchanging',claim='synthetic',started_at=1 WHERE id=?",
        attempt.id,
      );
    }
    const before = state(f);
    assert.throws(
      () => f.vault.rotate(f.workers, 1, nextKey),
      code("CREDENTIAL_BUSY"),
    );
    assert.deepEqual(state(f), before);
    if (kind === "refresh") f.vault.disable(f.binding, 1);
    else
      f.vault.authorization.cancel(
        f.binding,
        String(before.authorizations[0]!.id),
      );
    assert.equal(f.vault.rotate(f.workers, 1, nextKey).generation, 2);
  }
});

test("every credential and pending authorization organization requires its own current finance worker", (t) => {
  const f = setup(t),
    foreign = setup(t),
    iam = f.app.database.owned("iam"),
    foreignIam = foreign.app.database.owned("iam");
  const org = foreignIam.get(
      "SELECT * FROM iam_organizations WHERE id=?",
      foreign.actor.orgId,
    )!,
    user = {
      ...foreignIam.get(
        "SELECT * FROM iam_users WHERE id=?",
        foreign.actor.id,
      )!,
      email: "foreign-rotation@example.test",
    },
    account = foreignIam.get(
      "SELECT * FROM iam_accounts WHERE id=?",
      foreign.buyer,
    )!;
  for (const [table, row] of [
    ["iam_organizations", org],
    ["iam_users", user],
    ["iam_accounts", account],
  ] as const)
    iam.run(
      `INSERT INTO ${table}(${Object.keys(row).join(",")}) VALUES(${Object.keys(
        row,
      )
        .map(() => "?")
        .join(",")})`,
      ...Object.values(row),
    );
  // This second organization's copied account needs its own reviewed terms.
  seedDisclosures(f.app, foreign.actor);
  chooseProviders(f, foreign.actor, "foreign-rotation-choice", {
    accountId: foreign.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["quickbooks"],
    version: Number(account.residency_version),
    acknowledgment: "Synthetic foreign customer review",
  });
  const binding = {
    ...f.binding,
    id: "foreign-binding",
    orgId: foreign.actor.orgId,
    workerUserId: foreign.actor.id,
    accountId: foreign.buyer,
  };
  const attempt = f.vault.authorization.begin(binding, 0);
  const pending = state(f);
  assert.throws(
    () => f.vault.rotate(f.workers, 0, nextKey),
    code("CREDENTIAL_SCOPE"),
  );
  assert.deepEqual(state(f), pending);
  f.vault.install(binding, 0, tokens());
  const before = state(f);
  assert.throws(
    () => f.vault.rotate(f.workers, 1, nextKey),
    code("CREDENTIAL_SCOPE"),
  );
  assert.deepEqual(state(f), before);
  assert.throws(
    () =>
      f.vault.rotate(
        [
          ...f.workers,
          { orgId: foreign.actor.orgId, workerUserId: f.actor.id },
        ],
        1,
        nextKey,
      ),
    code("FORBIDDEN"),
  );
  assert.equal(
    f.vault.rotate(
      [
        ...f.workers,
        { orgId: foreign.actor.orgId, workerUserId: foreign.actor.id },
      ],
      1,
      nextKey,
    ).bindings,
    1,
  );
  const audits = f.app.database
    .owned("platform")
    .all(
      "SELECT * FROM platform_audit WHERE action='provider.credentials.rotate'",
    );
  assert.equal(
    f.vault.authorization.status(binding, attempt.id).state,
    "canceled",
  );
  assert.equal(audits.length, 2);
  assert.deepEqual(
    new Set(audits.map((r) => r.org_id)),
    new Set([f.actor.orgId, foreign.actor.orgId]),
  );
});

test("legacy marker registration verifies all existing ciphertext before accepting another binding and bounded rotation refuses oversized vaults", (t) => {
  const f = setup(t);
  f.vault.install(f.binding, 0, tokens());
  f.store.run("DELETE FROM integration_credential_key");
  const wrong = new Application(f.path, "CA", {
    providerEncryptionKey: nextKey,
  });
  t.after(() => wrong.close());
  assert.throws(
    () =>
      wrong.providerCredentials.install(
        { ...f.binding, id: "new" },
        0,
        tokens(),
      ),
    code("CREDENTIAL_INTEGRITY"),
  );
  assert.throws(
    () =>
      wrong.providerCredentials.authorization.begin(
        { ...f.binding, id: "new" },
        0,
      ),
    code("CREDENTIAL_INTEGRITY"),
  );
  assert.equal(f.vault.keyStatus().generation, 0);
  assert.equal(f.vault.status({ ...f.binding, id: "new" }).state, "missing");
  assert.equal(f.vault.rotate(f.workers, 0, nextKey).generation, 1);
  for (let i = 0; i < 1000; i++)
    f.store.run(
      "INSERT INTO integration_credentials VALUES(?,?,?,?,1,'disabled',NULL,NULL,NULL)",
      f.actor.orgId,
      `disabled-${i}`,
      "1234",
      "synthetic-client",
    );
  const before = state(f);
  assert.throws(
    () => f.vault.rotate(f.workers, 1, key),
    code("CREDENTIAL_LIMIT"),
  );
  assert.deepEqual(state(f), before);
});

test(
  "independent process loaded before rotation cannot write old-key credentials, even after key reuse",
  { timeout: 10000 },
  async (t) => {
    const f = setup(t);
    f.vault.install(f.binding, 0, tokens());
    const child = fork("tests/provider-rotation-child.ts", [], {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    t.after(() => child.kill());
    const message = () =>
      new Promise<any>((resolve, reject) => {
        child.once("message", resolve);
        child.once("error", reject);
      });
    const ready = message();
    child.send({ action: "init", path: f.path, key });
    assert.equal((await ready).ready, true);
    f.vault.rotate(f.workers, 1, nextKey);
    f.vault.rotate(f.workers, 2, key);
    const result = message();
    child.send({
      action: "install",
      binding: { ...f.binding, id: "stale-process" },
      tokens: tokens(),
    });
    assert.deepEqual(await result, { ok: false, code: "CREDENTIAL_INTEGRITY" });
    assert.equal(
      f.vault.status({ ...f.binding, id: "stale-process" }).state,
      "missing",
    );
  },
);

test(
  "protected stdin rotation CLI returns only metadata and lost response is recoverable via current key status; malformed/extra/oversized input is redacted",
  { timeout: 20000 },
  async (t) => {
    const f = setup(t);
    f.vault.install(f.binding, 0, tokens());
    const run = (args: string[], input = "", runtimeKey = key) =>
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
            {
              env: {
                ...process.env,
                DATABASE_PATH: f.path,
                DATA_REGION: "CA",
                PROVIDER_ENCRYPTION_KEY: runtimeKey,
              },
              stdio: ["pipe", "pipe", "pipe"],
            },
          );
          let out = "",
            err = "";
          child.stdout.on("data", (b) => (out += b));
          child.stderr.on("data", (b) => (err += b));
          child.on("error", reject);
          child.on("close", (code) => resolve({ code, out, err }));
          child.stdin.end(input);
        },
      );
    assert.deepEqual(JSON.parse((await run(["key-status"])).out), {
      generation: 1,
      configured: true,
      current: true,
    });
    const rotated = await run(
      ["rotate"],
      JSON.stringify({ generation: 1, nextKey, workers: f.workers }),
    );
    assert.equal(rotated.code, 0);
    assert.deepEqual(JSON.parse(rotated.out), {
      generation: 2,
      bindings: 1,
      canceledAuthorizations: 0,
    });
    assert.ok(!rotated.out.includes(nextKey));
    assert.ok(!rotated.err.includes(nextKey));
    assert.deepEqual(JSON.parse((await run(["key-status"], "", nextKey)).out), {
      generation: 2,
      configured: true,
      current: true,
    });
    assert.equal(
      (
        await run(
          ["rotate"],
          JSON.stringify({ generation: 1, nextKey: key, workers: f.workers }),
          nextKey,
        )
      ).code,
      1,
    );
    for (const [args, input] of [
      [["rotate", nextKey], ""],
      [["rotate"], "null"],
      [["rotate"], "x".repeat(32769)],
      [
        ["rotate"],
        JSON.stringify({
          generation: 2,
          nextKey: key,
          workers: f.workers,
          unexpected: nextKey,
        }),
      ],
    ] as [string[], string][]) {
      const result = await run(args, input, nextKey);
      assert.equal(result.code, 1);
      assert.ok(!result.out.includes(nextKey));
      assert.ok(!result.err.includes(nextKey));
    }
  },
);

test("real refresh claim blocks rotation; subsequent refreshed tokens remain valid through rotation and refresh under the new key", async (t) => {
  const f = setup(t),
    old = tokens();
  f.vault.install(f.binding, 0, { ...old, accessExpiresAt: Date.now() - 1000 });
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  let finish!: (response: Response) => void;
  globalThis.fetch = async () =>
    new Promise<Response>((resolve) => {
      finish = resolve;
    });
  const refreshing = f.vault.access(f.binding, "synthetic-secret", f.effect);
  assert.throws(
    () => f.vault.rotate(f.workers, 1, nextKey),
    code("CREDENTIAL_BUSY"),
  );
  finish(
    Response.json({
      access_token: "synthetic-refreshed",
      refresh_token: "synthetic-refresh-new",
      token_type: "bearer",
      expires_in: 3600,
      x_refresh_token_expires_in: 86400,
    }),
  );
  assert.equal(await refreshing, "synthetic-refreshed");
  assert.equal(f.vault.rotate(f.workers, 1, nextKey).generation, 2);
  assert.equal(
    await f.vault.access(f.binding, "secret", f.effect),
    "synthetic-refreshed",
  );
  f.vault.install(f.binding, 3, { ...old, accessExpiresAt: Date.now() - 1000 });
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({
      access_token: "synthetic-new-key-refresh",
      refresh_token: "synthetic-new-key-pair",
      token_type: "bearer",
      expires_in: 3600,
      x_refresh_token_expires_in: 86400,
    });
  };
  assert.equal(
    await f.vault.access(f.binding, "secret", f.effect),
    "synthetic-new-key-refresh",
  );
  assert.equal(calls, 1);
  const reopened = new Application(f.path, "CA", {
    providerEncryptionKey: nextKey,
  });
  t.after(() => reopened.close());
  assert.equal(
    await reopened.providerCredentials.access(f.binding, "secret", f.effect),
    "synthetic-new-key-refresh",
  );
});
