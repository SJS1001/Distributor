import { test } from "node:test";
import assert from "node:assert/strict";
import { fork, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Application } from "../src/server/application.ts";
import { createBackup, restoreBackup } from "../src/server/recovery.ts";
import { chooseProviders, fixture, accept, ship } from "./fixtures.ts";
import type { Region } from "../src/server/iam.ts";

const encryptionKey = "ac".repeat(32),
  config = { providerEncryptionKey: encryptionKey };
const secret = "synthetic-revocation-secret",
  accessToken = "synthetic-revocation-access",
  refreshToken = "synthetic-revocation-refresh";
const code = (value: string) => (e: unknown) =>
  (e as { code: string }).code === value;
function bundle() {
  return {
    accessToken,
    refreshToken,
    accessExpiresAt: Date.now() + 3600000,
    refreshExpiresAt: Date.now() + 86400000,
  };
}
function setup(t: Parameters<typeof fixture>[0], region: Region = "CA") {
  const f = fixture(t, config, region);
  chooseProviders(f, f.actor, "consent", {
    accountId: f.buyer,
    region,
    mode: "provider-exceptions",
    providers: ["quickbooks"],
    version: 1,
    acknowledgment: "Synthetic processor choice",
  });
  const binding = {
    id: "synthetic-revocation-binding",
    orgId: f.actor.orgId,
    workerUserId: f.actor.id,
    realm: "1234",
    clientId: "synthetic-client",
    accountId: f.buyer,
    redirectUri: "http://127.0.0.1:3000/quickbooks/callback",
  };
  f.app.providerCredentials.install(binding, 0, bundle());
  return {
    ...f,
    binding,
    region,
    vault: f.app.providerCredentials,
    revoke: f.app.providerCredentials.revocation,
    store: f.app.database.owned("integration"),
  };
}
function mock(t: Parameters<typeof fixture>[0], fn: typeof fetch) {
  const previous = globalThis.fetch;
  globalThis.fetch = fn;
  t.after(() => {
    globalThis.fetch = previous;
  });
}
function dump(f: ReturnType<typeof setup>) {
  return JSON.stringify({
    receipts: f.store.all("SELECT * FROM integration_credential_revocations"),
    tokens: f.store.all("SELECT * FROM integration_credentials"),
    audit: f.app.database.owned("platform").all("SELECT * FROM platform_audit"),
    commands: f.app.database
      .owned("platform")
      .all("SELECT * FROM platform_commands"),
  });
}
function noSecrets(f: ReturnType<typeof setup>, result: unknown = {}) {
  for (const value of [
    secret,
    accessToken,
    refreshToken,
    "sensitive-provider-body",
  ])
    assert.equal(
      (dump(f) + JSON.stringify(result)).includes(value),
      false,
      value,
    );
}
function native(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name",
      )
      .all()
      .filter(
        (r) =>
          /^(inventory|billing|orders|fulfillment|catalog|returns)_/.test(
            String(r.name),
          ) || r.name === "integration_effects",
      )
      .map((r) => [
        r.name,
        db.prepare(`SELECT * FROM "${r.name}" ORDER BY rowid`).all(),
      ]);
  } finally {
    db.close();
  }
}
function withdraw(f: ReturnType<typeof setup>) {
  chooseProviders(f, f.actor, "withdraw", {
    accountId: f.buyer,
    region: f.region,
    mode: "strict",
    providers: [],
    version: 2,
    acknowledgment: "Withdraw synthetic processing",
  });
}
function age(f: ReturnType<typeof setup>) {
  f.store.run(
    "UPDATE integration_credential_revocations SET started_at=?",
    Date.now() - 90001,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}

for (const outcome of [200, 503])
  test(`late OAuth exchange cannot reactivate credentials after revocation response ${outcome}`, async (t) => {
    const f = setup(t),
      flow = f.vault.authorization,
      start = flow.begin(f.binding, 1),
      callback = new URL(f.binding.redirectUri),
      tokenResponse = deferred<Response>(),
      entered = deferred<void>(),
      before = native(f.path),
      requests: string[] = [];
    callback.search = new URLSearchParams({
      state: new URL(start.authorizationUrl).searchParams.get("state")!,
      code: "synthetic-late-code",
      realmId: f.binding.realm,
    }).toString();
    mock(t, async (url) => {
      requests.push(String(url));
      if (url === "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer") {
        entered.resolve(undefined);
        return tokenResponse.promise;
      }
      assert.equal(
        url,
        "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
      );
      return new Response(null, { status: outcome });
    });
    const completing = flow.complete(
      f.binding,
      start.id,
      secret,
      callback.href,
    );
    const refused = assert.rejects(completing, code("OAUTH_STALE"));
    await entered.promise;
    assert.equal(flow.status(f.binding, start.id).state, "exchanging");
    try {
      const revoking = f.revoke.revoke(f.binding, "late-oauth", 1, secret);
      if (outcome === 200) assert.equal((await revoking)!.state, "confirmed");
      else await assert.rejects(revoking, code("REVOCATION_UNKNOWN"));
    } finally {
      tokenResponse.resolve(
        Response.json({
          access_token: "synthetic-late-access",
          refresh_token: "synthetic-late-refresh",
          token_type: "bearer",
          expires_in: 3600,
          x_refresh_token_expires_in: 8640000,
        }),
      );
    }
    await refused;
    assert.equal(flow.status(f.binding, start.id).state, "canceled");
    assert.equal(f.vault.status(f.binding).state, "disabled");
    assert.equal(f.vault.status(f.binding).revision, 2);
    assert.equal(
      requests.length,
      2,
      "A late token response must not make a company read.",
    );
    assert.deepEqual(native(f.path), before);
    noSecrets(f);
    assert.equal(dump(f).includes("synthetic-late-access"), false);
    assert.equal(dump(f).includes("synthetic-late-refresh"), false);
  });

for (const region of ["CA", "US"] as const)
  test(`${region} revocation disables locally and cancels OAuth before exact one-shot provider request; receipt survives restart with native stock/money conserved`, async (t) => {
    const f = setup(t, region);
    ship(f, accept(f).id);
    const attempt = f.vault.authorization.begin(f.binding, 1),
      before = native(f.path);
    let calls = 0;
    mock(t, async (url, init) => {
      calls++;
      assert.equal(
        url,
        "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
      );
      assert.equal(init?.method, "POST");
      assert.equal(init?.redirect, "error");
      assert.ok(init?.signal instanceof AbortSignal);
      const headers = new Headers(init?.headers);
      assert.equal(
        headers.get("authorization"),
        `Basic ${Buffer.from(`synthetic-client:${secret}`).toString("base64")}`,
      );
      assert.equal(headers.get("content-type"), "application/json");
      assert.equal(headers.get("accept"), "application/json");
      assert.deepEqual(JSON.parse(String(init?.body)), { token: refreshToken });
      assert.equal(f.vault.status(f.binding).state, "disabled");
      assert.equal(f.vault.status(f.binding).revision, 2);
      assert.deepEqual(
        {
          ...f.store.get(
            "SELECT material,claim,started_at FROM integration_credentials",
          ),
        },
        { material: null, claim: null, started_at: null },
      );
      assert.equal(
        f.vault.authorization.status(f.binding, attempt.id).state,
        "canceled",
      );
      assert.equal(f.revoke.status(f.binding, "r1").state, "sending");
      noSecrets(f);
      return new Response(null, { status: 200 });
    });
    const result = await f.revoke.revoke(f.binding, " r1 ", 1, secret);
    assert.equal(result!.state, "confirmed");
    assert.equal(result!.providerRevocationConfirmed, true);
    assert.equal(result!.confirmationSource, "provider-response");
    assert.equal(result!.credentialRevision, 1);
    assert.equal(result!.disabledRevision, 2);
    assert.deepEqual(native(f.path), before);
    noSecrets(f, result);
    const restarted = new Application(f.path, region, config);
    try {
      assert.deepEqual(
        restarted.providerCredentials.revocation.status(f.binding, "r1"),
        result,
      );
      assert.deepEqual(
        await restarted.providerCredentials.revocation.revoke(
          f.binding,
          "r1",
          1,
          secret,
        ),
        result,
      );
      await assert.rejects(
        restarted.providerCredentials.revocation.revoke(
          f.binding,
          "r1",
          2,
          secret,
        ),
        code("IDEMPOTENCY_CONFLICT"),
      );
      await assert.rejects(
        restarted.providerCredentials.revocation.revoke(
          f.binding,
          "other-id",
          1,
          secret,
        ),
        code("IDEMPOTENCY_CONFLICT"),
      );
      assert.equal(calls, 1);
      restarted.providerCredentials.install(f.binding, 2, {
        ...bundle(),
        refreshToken: "synthetic-successor-refresh",
      });
      assert.deepEqual(
        await restarted.providerCredentials.revocation.revoke(
          f.binding,
          "r1",
          1,
          secret,
        ),
        result,
      );
      assert.equal(
        restarted.providerCredentials.status(f.binding).state,
        "ready",
      );
      assert.equal(calls, 1);
    } finally {
      restarted.close();
    }
  });

for (const failure of [
  "network",
  "500",
  "204",
  "302",
  "oversize",
  "reader",
] as const)
  test(`${failure} response is redacted/unknown, preserves disabled tokens and blocks reconnect/refresh/key rotation without a resend`, async (t) => {
    const f = setup(t),
      before = native(f.path);
    let calls = 0;
    mock(t, async () => {
      calls++;
      if (failure === "network")
        throw Error(`sensitive-provider-body:${secret}`);
      if (failure === "reader")
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.error(Error("sensitive-provider-body"));
            },
          }),
        );
      return new Response(
        failure === "oversize"
          ? "x".repeat(65537)
          : failure === "204"
            ? null
            : "sensitive-provider-body",
        { status: failure === "oversize" ? 200 : Number(failure) },
      );
    });
    await assert.rejects(
      f.revoke.revoke(f.binding, "uncertain", 1, secret),
      (e) =>
        code("REVOCATION_UNKNOWN")(e) &&
        !String(e).includes(secret) &&
        !String(e).includes("sensitive-provider-body"),
    );
    const receipt = f.revoke.status(f.binding, "uncertain");
    assert.equal(receipt.state, "unknown");
    assert.equal(receipt.providerRevocationConfirmed, false);
    assert.equal(receipt.confirmationSource, null);
    assert.deepEqual(
      await f.revoke.revoke(f.binding, "uncertain", 1, secret),
      receipt,
    );
    await assert.rejects(
      f.revoke.revoke(f.binding, "new-id", 1, secret),
      code("REVOCATION_REVIEW"),
    );
    assert.throws(
      () => f.vault.install(f.binding, 2, bundle()),
      code("REVOCATION_REVIEW"),
    );
    assert.throws(
      () => f.vault.authorization.begin(f.binding, 2),
      code("REVOCATION_REVIEW"),
    );
    await assert.rejects(
      f.vault.access(f.binding, secret, {
        org_id: f.actor.orgId,
        account_id: f.buyer,
        provider: "quickbooks",
      } as any),
      code("REVOCATION_REVIEW"),
    );
    assert.throws(
      () =>
        f.vault.rotate(
          [{ orgId: f.actor.orgId, workerUserId: f.actor.id }],
          1,
          "cd".repeat(32),
        ),
      code("CREDENTIAL_BUSY"),
    );
    assert.equal(calls, 1);
    assert.deepEqual(native(f.path), before);
    noSecrets(f, receipt);
  });

for (const resolution of [
  "provider-confirmed",
  "provider-unconfirmed",
] as const)
  test(`${resolution} explicit offline evidence review releases only the fence and never reactivates old credentials`, async (t) => {
    const f = setup(t);
    let calls = 0;
    mock(t, async () => {
      calls++;
      throw Error("lost reply");
    });
    await assert.rejects(
      f.revoke.revoke(f.binding, "reviewed", 1, secret),
      code("REVOCATION_UNKNOWN"),
    );
    assert.throws(
      () =>
        f.revoke.review(
          f.binding,
          "reviewed",
          1,
          resolution,
          "synthetic:console-review",
        ),
      code("REVISION"),
    );
    assert.throws(
      () => f.revoke.review(f.binding, "reviewed", 2, resolution, " "),
      code("VALIDATION"),
    );
    const result = f.revoke.review(
      f.binding,
      "reviewed",
      2,
      resolution,
      "synthetic:console-review",
    );
    assert.equal(
      result.state,
      resolution === "provider-confirmed" ? "confirmed" : "released",
    );
    assert.equal(
      result.confirmationSource,
      resolution === "provider-confirmed" ? "operator-evidence" : null,
    );
    assert.equal(f.vault.status(f.binding).state, "disabled");
    assert.deepEqual(
      f.revoke.review(
        f.binding,
        "reviewed",
        2,
        resolution,
        "synthetic:console-review",
      ),
      result,
    );
    assert.throws(
      () =>
        f.revoke.review(
          f.binding,
          "reviewed",
          2,
          resolution,
          "synthetic:different",
        ),
      code("IDEMPOTENCY_CONFLICT"),
    );
    assert.deepEqual(
      await f.revoke.revoke(f.binding, "reviewed", 1, secret),
      result,
    );
    f.vault.install(f.binding, 2, {
      ...bundle(),
      refreshToken: "synthetic-new-refresh",
    });
    assert.equal(f.vault.status(f.binding).revision, 3);
    assert.equal(calls, 1);
    noSecrets(f, result);
  });

for (const restriction of [
  "grant",
  "password",
  "consent",
  "consent-version",
  "restore",
  "credential-revision",
] as const)
  for (const phase of ["before", "after"] as const)
    test(`${restriction} changed ${phase} request refuses current authority and fences late confirmation`, async (t) => {
      const f = setup(t);
      let calls = 0,
        choiceVersion = 2;
      const restrict = () => {
        if (restriction === "grant")
          f.app.database
            .owned("iam")
            .run("UPDATE iam_users SET active=0 WHERE id=?", f.actor.id);
        if (restriction === "password")
          f.app.database
            .owned("iam")
            .run(
              "INSERT INTO iam_user_security VALUES(?,1,1,?) ON CONFLICT(user_id) DO UPDATE SET password_change_required=1",
              f.actor.id,
              new Date().toISOString(),
            );
        if (restriction === "consent") withdraw(f);
        if (restriction === "consent-version")
          chooseProviders(f, f.actor, `updated-choice-${choiceVersion}`, {
            accountId: f.buyer,
            region: f.region,
            mode: "provider-exceptions",
            providers: ["quickbooks"],
            version: choiceVersion++,
            acknowledgment: "New synthetic processing choice",
          });
        if (restriction === "restore")
          f.app.platform.isolateRestore(
            "synthetic-snapshot",
            new Date().toISOString(),
          );
        if (restriction === "credential-revision")
          f.vault.disable(f.binding, f.vault.status(f.binding).revision);
      };
      mock(t, async () => {
        calls++;
        restrict();
        return Response.json({});
      });
      if (phase === "before") restrict();
      if (phase === "before" && restriction === "consent-version") {
        // A newly reviewed current choice is valid before a claim is created.
        await assert.rejects(
          f.revoke.revoke(f.binding, "changed", 1, secret),
          code("REVOCATION_UNKNOWN"),
        );
        assert.equal(calls, 1);
      } else {
        await assert.rejects(
          f.revoke.revoke(f.binding, "changed", 1, secret),
          code(
            phase === "after"
              ? "REVOCATION_UNKNOWN"
              : (
                  {
                    grant: "FORBIDDEN",
                    password: "PASSWORD_CHANGE_REQUIRED",
                    consent: "RESIDENCY_BLOCKED",
                    restore: "RECOVERY_HOLD",
                    "credential-revision": "REVISION",
                  } as Record<string, string>
                )[restriction]!,
          ),
        );
        assert.equal(calls, phase === "before" ? 0 : 1);
      }
      const row = f.store.get(
        "SELECT state,claim FROM integration_credential_revocations",
      );
      if (calls) {
        assert.equal(row!.state, "unknown");
        assert.equal(row!.claim, null);
      } else assert.equal(row, undefined);
      noSecrets(f);
    });

test("offline status/review remain available after withdrawal and restore hold; neither authorizes outbound or reinstallation", async (t) => {
  const f = setup(t);
  let calls = 0;
  mock(t, async () => {
    calls++;
    throw Error("lost");
  });
  await assert.rejects(
    f.revoke.revoke(f.binding, "offline", 1, secret),
    code("REVOCATION_UNKNOWN"),
  );
  withdraw(f);
  f.app.platform.isolateRestore("synthetic-snapshot", new Date().toISOString());
  assert.equal(f.revoke.status(f.binding, "offline").state, "unknown");
  const reviewed = f.revoke.review(
    f.binding,
    "offline",
    2,
    "provider-unconfirmed",
    "synthetic:manual-cleanup-pending",
  );
  assert.deepEqual(
    await f.revoke.revoke(f.binding, "offline", 1, secret),
    reviewed,
  );
  assert.throws(
    () => f.vault.install(f.binding, 2, bundle()),
    code("RECOVERY_HOLD"),
  );
  assert.equal(calls, 1);
});

test("receipt scope, revision, key and malformed secret failures preserve credentials and make no provider request", async (t) => {
  const f = setup(t);
  let calls = 0;
  mock(t, async () => {
    calls++;
    return Response.json({});
  });
  for (const bad of ["", "x\nprivate", "x".repeat(8193), undefined])
    await assert.rejects(
      f.revoke.revoke(f.binding, "bad", 1, bad as string),
      code("PROVIDER_CONFIG"),
    );
  await assert.rejects(
    f.revoke.revoke(f.binding, "bad", 2, secret),
    code("REVISION"),
  );
  await assert.rejects(
    f.revoke.revoke({ ...f.binding, realm: "9876" }, "bad", 1, secret),
    code("CREDENTIAL_SCOPE"),
  );
  await assert.rejects(
    f.revoke.revoke({ ...f.binding, accountId: "missing" }, "bad", 1, secret),
  );
  assert.equal(f.vault.status(f.binding).revision, 1);
  assert.equal(calls, 0);
  const wrongKey = new Application(f.path, "CA", {
    providerEncryptionKey: "ab".repeat(32),
  });
  try {
    await assert.rejects(
      wrongKey.providerCredentials.revocation.revoke(
        f.binding,
        "bad",
        1,
        secret,
      ),
      code("CREDENTIAL_INTEGRITY"),
    );
  } finally {
    wrongKey.close();
  }
  const noKey = new Application(f.path, "CA");
  try {
    await assert.rejects(
      noKey.providerCredentials.revocation.revoke(f.binding, "bad", 1, secret),
      code("CREDENTIAL_KEY"),
    );
  } finally {
    noKey.close();
  }
  await f.revoke.revoke(f.binding, "good", 1, secret);
  const other = f.app.identity.createCustomer(f.actor, "other-buyer", {
    name: "Other synthetic buyer",
    tier: "standard",
    creditLimit: 1000000,
  }).id;
  assert.throws(
    () => f.revoke.status({ ...f.binding, accountId: other }, "good"),
    code("CREDENTIAL_SCOPE"),
  );
  assert.throws(() => f.revoke.status(f.binding, "missing"), code("NOT_FOUND"));
  assert.equal(calls, 1);
  noSecrets(f);
});

test("interrupted refreshes cannot be revoked using stale encrypted material and never send", async (t) => {
  for (const state of ["refreshing", "unknown", "disabled"]) {
    const f = setup(t);
    let calls = 0;
    mock(t, async () => {
      calls++;
      return Response.json({});
    });
    f.store.run("UPDATE integration_credentials SET state=?", state);
    await assert.rejects(
      f.revoke.revoke(f.binding, "unsafe", 1, secret),
      code("CREDENTIAL_RECONNECT"),
    );
    assert.equal(calls, 0);
    assert.equal(
      f.store.all("SELECT * FROM integration_credential_revocations").length,
      0,
    );
  }
});

test("begin audit failure rolls back local disable, OAuth cancel and receipt before any request; confirmation failure retains uncertainty", async (t) => {
  const f = setup(t),
    start = f.vault.authorization.begin(f.binding, 1),
    platform = f.app.database.owned("platform");
  let calls = 0;
  mock(t, async () => {
    calls++;
    return Response.json({});
  });
  platform.migrate(
    "CREATE TRIGGER platform_revocation_fail BEFORE INSERT ON platform_audit WHEN NEW.action='provider.revocation.begin' BEGIN SELECT RAISE(ABORT,'synthetic fail'); END;",
  );
  const before = dump(f);
  await assert.rejects(f.revoke.revoke(f.binding, "atomic", 1, secret));
  assert.equal(dump(f), before);
  assert.equal(
    f.vault.authorization.status(f.binding, start.id).state,
    "pending",
  );
  assert.equal(calls, 0);
  platform.migrate(
    "DROP TRIGGER platform_revocation_fail; CREATE TRIGGER platform_revocation_fail BEFORE INSERT ON platform_audit WHEN NEW.action='provider.revocation.confirmed' BEGIN SELECT RAISE(ABORT,'synthetic fail'); END;",
  );
  await assert.rejects(
    f.revoke.revoke(f.binding, "atomic", 1, secret),
    code("REVOCATION_UNKNOWN"),
  );
  assert.equal(f.revoke.status(f.binding, "atomic").state, "unknown");
  assert.equal(f.vault.status(f.binding).state, "disabled");
  assert.equal(calls, 1);
  platform.migrate(
    "DROP TRIGGER platform_revocation_fail; CREATE TRIGGER platform_revocation_fail BEFORE INSERT ON platform_audit WHEN NEW.action='provider.revocation.review' BEGIN SELECT RAISE(ABORT,'synthetic fail'); END;",
  );
  const uncertain = dump(f);
  assert.throws(() =>
    f.revoke.review(
      f.binding,
      "atomic",
      2,
      "provider-unconfirmed",
      "synthetic:review",
    ),
  );
  assert.equal(dump(f), uncertain);
  platform.migrate("DROP TRIGGER platform_revocation_fail");
  f.revoke.review(
    f.binding,
    "atomic",
    2,
    "provider-unconfirmed",
    "synthetic:review",
  );
  noSecrets(f);
});

test("active claim cannot be reviewed; deadline review fences a later 200 and leaves the reviewed outcome immutable", async (t) => {
  const f = setup(t);
  let release!: () => void,
    calls = 0;
  mock(t, async () => {
    calls++;
    await new Promise<void>((r) => {
      release = r;
    });
    return Response.json({});
  });
  const pending = f.revoke.revoke(f.binding, "deadline", 1, secret);
  assert.throws(
    () =>
      f.revoke.review(
        f.binding,
        "deadline",
        2,
        "provider-unconfirmed",
        "synthetic:review",
      ),
    code("CREDENTIAL_BUSY"),
  );
  assert.equal(
    (await f.revoke.revoke(f.binding, "deadline", 1, secret))!.state,
    "sending",
  );
  age(f);
  const result = f.revoke.review(
    f.binding,
    "deadline",
    2,
    "provider-unconfirmed",
    "synthetic:review",
  );
  release();
  await assert.rejects(pending, code("REVOCATION_UNKNOWN"));
  assert.deepEqual(f.revoke.status(f.binding, "deadline"), result);
  assert.equal(calls, 1);
  noSecrets(f);
});

test("encrypted backup of a sending revocation restores unknown/disabled with advanced revision, revoked sessions and provider isolation", async (t) => {
  const f = setup(t);
  let release!: () => void,
    calls = 0;
  mock(t, async () => {
    calls++;
    await new Promise<void>((r) => {
      release = r;
    });
    return Response.json({});
  });
  const session = f.app.identity.login(
    "admin@example.test",
    "long-test-only-password",
  );
  const pending = f.revoke.revoke(f.binding, "restored", 1, secret),
    before = native(f.path);
  const archive = join(dirname(f.path), "revocation.backup"),
    target = join(dirname(f.path), "restored.db"),
    recoveryKey = randomBytes(32);
  await createBackup(f.path, archive, "CA", recoveryKey);
  release();
  const original = await pending;
  assert.equal(original!.state, "confirmed");
  await restoreBackup(archive, target, "CA", recoveryKey);
  const restored = new Application(target, "CA", config);
  try {
    const revoke = restored.providerCredentials.revocation,
      receipt = revoke.status(f.binding, "restored");
    assert.equal(receipt.state, "unknown");
    assert.equal(receipt.confirmationSource, null);
    assert.equal(restored.providerCredentials.status(f.binding).revision, 3);
    assert.equal(
      restored.providerCredentials.status(f.binding).state,
      "disabled",
    );
    assert.ok(restored.platform.recoveryHold());
    assert.throws(() => restored.identity.session(session.token));
    assert.deepEqual(native(target), before);
    assert.deepEqual(
      await revoke.revoke(f.binding, "restored", 1, secret),
      receipt,
    );
    assert.equal(calls, 1);
    assert.throws(
      () =>
        revoke.review(
          f.binding,
          "restored",
          2,
          "provider-confirmed",
          "synthetic:console",
        ),
      code("REVISION"),
    );
    const review = revoke.review(
      f.binding,
      "restored",
      3,
      "provider-confirmed",
      "synthetic:console",
    );
    assert.equal(review.confirmationSource, "operator-evidence");
    assert.throws(
      () => restored.providerCredentials.install(f.binding, 3, bundle()),
      code("RECOVERY_HOLD"),
    );
    assert.equal(
      readFileSync(target).includes(Buffer.from(refreshToken)),
      false,
    );
  } finally {
    restored.close();
  }
});

function child(t: Parameters<typeof fixture>[0]) {
  const c = fork(new URL("./quickbooks-revocation-child.ts", import.meta.url), {
    execArgv: ["--import", "tsx"],
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let stderr = "";
  c.stderr?.on("data", (data) => {
    stderr += String(data);
  });
  t.after(() => c.kill());
  return { c, stderr: () => stderr };
}
function reply(c: ChildProcess): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(Error("Child IPC deadline exceeded"));
    }, 20000);
    const message = (m: unknown) => {
        cleanup();
        resolve(m);
      },
      exit = (n: number | null) => {
        cleanup();
        reject(Error(`Child exited before IPC: ${n}`));
      };
    function cleanup() {
      clearTimeout(timer);
      c.off("message", message);
      c.off("exit", exit);
    }
    c.once("message", message);
    c.once("exit", exit);
  });
}
for (const kill of [false, true])
  test(`separate OS process ${kill ? "crash" : "contention"} persists one disabled/send claim and never resends`, async (t) => {
    const f = setup(t),
      processA = child(t),
      processB = child(t);
    for (const process of [processA, processB]) {
      const ready = reply(process.c);
      process.c.send({
        action: "init",
        input: {
          path: f.path,
          key: encryptionKey,
          binding: f.binding,
          receiptId: "process",
          revision: 1,
        },
      });
      assert.equal((await ready).ready, true, process.stderr());
    }
    const sent = reply(processA.c);
    processA.c.send({ action: "go" });
    assert.equal((await sent).requested, true);
    assert.equal(f.vault.status(f.binding).state, "disabled");
    const replay = reply(processB.c);
    processB.c.send({ action: "go" });
    const cached = await replay;
    assert.equal(cached.ok, true);
    assert.equal(cached.calls, 0);
    assert.equal(cached.result.state, "sending");
    if (kill) {
      const exited = new Promise<void>((resolve) =>
        processA.c.once("exit", () => resolve()),
      );
      processA.c.kill("SIGKILL");
      await exited;
      const restarted = new Application(f.path, "CA", config);
      try {
        assert.equal(
          (await restarted.providerCredentials.revocation.revoke(
            f.binding,
            "process",
            1,
            secret,
          ))!.state,
          "sending",
        );
      } finally {
        restarted.close();
      }
      age(f);
      const reviewed = f.revoke.review(
        f.binding,
        "process",
        2,
        "provider-unconfirmed",
        "synthetic:crash-console-review",
      );
      assert.equal(reviewed.state, "released");
    } else {
      const finished = reply(processA.c);
      processA.c.send({ action: "release" });
      const result = await finished;
      assert.equal(result.ok, true);
      assert.equal(result.calls, 1);
      assert.equal(result.result.state, "confirmed");
    }
    assert.equal(
      f.store.all("SELECT * FROM integration_credential_revocations").length,
      1,
    );
    noSecrets(f);
  });

function cli(
  f: ReturnType<typeof setup>,
  action: string,
  input: object | string,
  extra: Record<string, string> = {},
  args: string[] = [],
) {
  return new Promise<{ status: number | null; out: string; err: string }>(
    (resolve, reject) => {
      const env = {
        ...process.env,
        DATABASE_PATH: f.path,
        DATA_REGION: f.region,
        PROVIDER_BINDING_ID: f.binding.id,
        PROVIDER_ORG_ID: f.binding.orgId,
        PROVIDER_WORKER_USER_ID: f.binding.workerUserId,
        PROVIDER_ACCOUNT_ID: f.buyer,
        QUICKBOOKS_REALM_ID: f.binding.realm,
        QUICKBOOKS_CLIENT_ID: f.binding.clientId,
        PROVIDER_ENCRYPTION_KEY: encryptionKey,
        PROVIDERS_ENABLED: "false",
        QUICKBOOKS_CLIENT_SECRET: "",
        ...extra,
      };
      const c = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/server/provider-credentials-cli.ts",
          action,
          ...args,
        ],
        { env, stdio: ["pipe", "pipe", "pipe"] },
      );
      let out = "",
        err = "";
      const timer = setTimeout(() => {
        c.kill("SIGKILL");
        reject(Error("CLI deadline exceeded"));
      }, 20000);
      c.stdout.on("data", (b) => {
        out += String(b);
      });
      c.stderr.on("data", (b) => {
        err += String(b);
      });
      c.on("error", reject);
      c.on("close", (status) => {
        clearTimeout(timer);
        resolve({ status, out, err });
      });
      c.stdin.end(typeof input === "string" ? input : JSON.stringify(input));
    },
  );
}
test("protected operator CLI defaults revoke off and exposes only offline metadata/review with strict input and no secret echo", async (t) => {
  const f = setup(t);
  mock(t, async () => {
    throw Error("lost");
  });
  const off = await cli(f, "revoke", { receiptId: "cli", revision: 1 });
  assert.equal(off.status, 1);
  assert.match(off.err, /PROVIDER_DISABLED/);
  assert.equal(f.vault.status(f.binding).state, "ready");
  const missingSecret = await cli(
    f,
    "revoke",
    { receiptId: "cli", revision: 1 },
    { PROVIDERS_ENABLED: "true" },
  );
  assert.equal(missingSecret.status, 1);
  assert.match(missingSecret.err, /PROVIDER_CONFIG/);
  await assert.rejects(
    f.revoke.revoke(f.binding, "cli", 1, secret),
    code("REVOCATION_UNKNOWN"),
  );
  const status = await cli(f, "revocation-status", { receiptId: "cli" });
  assert.equal(status.status, 0, status.err);
  assert.equal(JSON.parse(status.out).state, "unknown");
  const reviewed = await cli(f, "revocation-review", {
    receiptId: "cli",
    revision: 2,
    resolution: "provider-unconfirmed",
    evidence: "synthetic:offline-console-review",
  });
  assert.equal(reviewed.status, 0, reviewed.err);
  assert.equal(JSON.parse(reviewed.out).state, "released");
  for (const [action, input, args] of [
    ["revocation-status", { receiptId: "cli", secret }, []],
    [
      "revocation-review",
      {
        receiptId: "cli",
        revision: 2,
        resolution: "provider-unconfirmed",
        evidence: "",
      },
      [],
    ],
    ["revocation-status", `["${secret}"]`, []],
    ["revocation-status", "x".repeat(32769) + secret, []],
    ["revoke", {}, [secret]],
  ] as const) {
    const result = await cli(f, action, input, {}, [...args]);
    assert.equal(result.status, 1);
    assert.equal((result.out + result.err).includes(secret), false);
  }
  noSecrets(f, [status, reviewed]);
});
