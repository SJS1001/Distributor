import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fixture,
  syntheticDisclosure,
  chooseProviders,
  accept,
  ship,
} from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { createBackup, restoreBackup } from "../src/server/recovery.ts";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
const key = "ab".repeat(32);
type T = Parameters<typeof fixture>[0];
function setup(t: T, region: "CA" | "US" = "CA") {
  const f = fixture(t, { providerEncryptionKey: key }, region),
    r = f.app.identity.organizationResidency;
  const { provider: _, ...terms } = syntheticDisclosure(f.app, "quickbooks");
  r.publish(f.actor, "org-terms", terms);
  const binding = {
    id: "synthetic-binding",
    orgId: f.actor.orgId,
    workerUserId: f.actor.id,
    realm: "1234",
    clientId: "synthetic-client",
  };
  r.choose(f.actor, "org-choice", {
    region,
    revision: r.current(f.actor).choice.revision,
    mode: "provider-exception",
    realm: binding.realm,
    acknowledgment: "Synthetic acceptance",
    acceptance: {
      disclosureId: r.current(f.actor).terms!.id,
      disclosureHash: r.current(f.actor).terms!.hash,
      representative: "Synthetic operator",
      evidenceRef: "synthetic:accept",
    },
  });
  const authority = r.permission(f.actor, binding.realm),
    vault = f.app.providerCredentials.ledger;
  vault.install(
    binding,
    0,
    {
      accessToken: "synthetic-org-access",
      refreshToken: "synthetic-org-refresh",
      accessExpiresAt: Date.now() + 3600000,
      refreshExpiresAt: Date.now() + 100 * 86400000,
    },
    authority,
  );
  const withdraw = () =>
    r.choose(f.actor, "withdraw", {
      region,
      revision: r.current(f.actor).choice.revision,
      mode: "strict",
      realm: null,
      acknowledgment: "Synthetic withdrawal",
    });
  return Object.assign(f, {
    binding,
    authority,
    vault,
    withdraw,
    store: f.app.database.owned("integration"),
  });
}
function mock(t: T, fn: typeof fetch) {
  const original = globalThis.fetch;
  globalThis.fetch = fn;
  t.after(() => {
    globalThis.fetch = original;
  });
}
const code = (expected: string) => (e: unknown) =>
  (e as { code: string }).code === expected;
for (const region of ["CA", "US"] as const)
  test(`organization ${region} revocation disables before one request and retains exact replay without buyer credentials`, async (t) => {
    const f = setup(t, region);
    let calls = 0;
    mock(t, async (url, options) => {
      calls++;
      assert.equal(
        String(url),
        "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
      );
      assert.equal(options?.method, "POST");
      assert.equal(options?.redirect, "error");
      assert.deepEqual(JSON.parse(String(options?.body)), {
        token: "synthetic-org-refresh",
      });
      assert.equal(
        new Headers(options?.headers).get("Authorization"),
        "Basic " +
          Buffer.from("synthetic-client:synthetic-secret").toString("base64"),
      );
      assert.equal(f.vault.status(f.binding).state, "disabled");
      return new Response("", { status: 200 });
    });
    const receipt = await f.vault.revocation.revoke(
      f.binding,
      "org-revoke",
      1,
      f.authority,
      "synthetic-secret",
    );
    assert.equal(receipt.state, "confirmed");
    assert.equal(receipt.confirmationSource, "provider-response");
    assert.equal(receipt.disabledRevision, 2);
    assert.deepEqual(
      f.vault.revocation.status(f.binding, "org-revoke"),
      receipt,
    );
    assert.deepEqual(
      await f.vault.revocation.revoke(
        f.binding,
        "org-revoke",
        1,
        f.authority,
        "synthetic-secret",
      ),
      receipt,
    );
    assert.equal(calls, 1);
    assert.equal(f.app.providerCredentials.status(f.binding).state, "missing");
    await assert.rejects(
      f.vault.revocation.revoke(
        f.binding,
        "org-revoke",
        1,
        { ...f.authority, revision: 999 },
        "synthetic-secret",
      ),
      code("IDEMPOTENCY_CONFLICT"),
    );
  });

function bundle() {
  return {
    accessToken: "synthetic-org-access",
    refreshToken: "synthetic-org-refresh",
    accessExpiresAt: Date.now() + 3600000,
    refreshExpiresAt: Date.now() + 100 * 86400000,
  };
}
function noSecrets(f: ReturnType<typeof setup>, result: unknown = {}) {
  const dump = JSON.stringify({
    receipts: f.store.all("SELECT * FROM integration_ledger_revocations"),
    credentials: f.store.all("SELECT * FROM integration_credentials"),
    audit: f.app.database.owned("platform").all("SELECT * FROM platform_audit"),
    commands: f.app.database
      .owned("platform")
      .all("SELECT * FROM platform_commands"),
    result,
  });
  for (const value of [
    "synthetic-org-access",
    "synthetic-org-refresh",
    "synthetic-secret",
    "sensitive-provider-body",
  ]) {
    assert.equal(dump.includes(value), false);
    for (const path of [f.path, f.path + "-wal"])
      assert.equal(readFileSync(path).includes(Buffer.from(value)), false);
  }
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
        (row) =>
          /^(inventory|billing|orders|fulfillment|catalog|returns)_/.test(
            String(row.name),
          ) || row.name === "integration_effects",
      )
      .map((row) => [
        row.name,
        db.prepare(`SELECT * FROM "${row.name}" ORDER BY rowid`).all(),
      ]);
  } finally {
    db.close();
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
function age(f: ReturnType<typeof setup>) {
  f.store.run(
    "UPDATE integration_ledger_revocations SET started_at=?",
    Date.now() - 90001,
  );
}

for (const outcome of ["transport", 204, 302, 400, 503, "oversized"] as const)
  test(`organization revocation ${outcome} remains disabled and unresolved without resend`, async (t) => {
    const f = setup(t);
    let calls = 0;
    mock(t, async () => {
      calls++;
      if (outcome === "transport") throw new Error("sensitive-provider-body");
      return new Response(
        outcome === 204
          ? null
          : outcome === "oversized"
            ? "x".repeat(65537)
            : "sensitive-provider-body",
        { status: typeof outcome === "number" ? outcome : 200 },
      );
    });
    await assert.rejects(
      f.vault.revocation.revoke(
        f.binding,
        "uncertain",
        1,
        f.authority,
        "synthetic-secret",
      ),
      code("REVOCATION_UNKNOWN"),
    );
    assert.equal(f.vault.status(f.binding).state, "disabled");
    const receipt = f.vault.revocation.status(f.binding, "uncertain");
    assert.equal(receipt.state, "unknown");
    assert.equal(receipt.providerRevocationConfirmed, false);
    assert.deepEqual(
      await f.vault.revocation.revoke(
        f.binding,
        "uncertain",
        1,
        f.authority,
        "synthetic-secret",
      ),
      receipt,
    );
    assert.equal(calls, 1);
    assert.throws(
      () => f.vault.install(f.binding, 2, bundle(), f.authority),
      code("REVOCATION_REVIEW"),
    );
    assert.throws(
      () =>
        f.vault.authorization.begin(
          { ...f.binding, redirectUri: "http://127.0.0.1/callback" },
          2,
          f.authority,
        ),
      code("REVOCATION_REVIEW"),
    );
    assert.throws(
      () =>
        f.app.providerCredentials.rotate(
          [{ orgId: f.actor.orgId, workerUserId: f.actor.id }],
          f.app.providerCredentials.keyStatus().generation,
          "cd".repeat(32),
        ),
      code("CREDENTIAL_BUSY"),
    );
    assert.throws(
      () =>
        f.app.database.transaction(() =>
          f.vault.assertVersionInTransaction(f.binding, f.authority, 2),
        ),
      code("REVOCATION_REVIEW"),
    );
    noSecrets(f, receipt);
  });

for (const resolution of [
  "provider-confirmed",
  "provider-unconfirmed",
] as const)
  test(`organization ${resolution} offline review is exact and never reactivates old tokens`, async (t) => {
    const f = setup(t);
    let calls = 0;
    mock(t, async () => {
      calls++;
      throw new Error("synthetic transport");
    });
    await assert.rejects(
      f.vault.revocation.revoke(
        f.binding,
        "review",
        1,
        f.authority,
        "synthetic-secret",
      ),
    );
    f.withdraw();
    assert.throws(
      () =>
        f.vault.revocation.review(
          f.binding,
          "review",
          1,
          resolution,
          "synthetic:evidence",
        ),
      code("REVISION"),
    );
    const receipt = f.vault.revocation.review(
      f.binding,
      "review",
      2,
      resolution,
      "synthetic:evidence",
    );
    assert.equal(
      receipt.state,
      resolution === "provider-confirmed" ? "confirmed" : "released",
    );
    assert.equal(
      receipt.confirmationSource,
      resolution === "provider-confirmed" ? "operator-evidence" : null,
    );
    assert.equal(f.vault.status(f.binding).state, "disabled");
    assert.deepEqual(
      f.vault.revocation.review(
        f.binding,
        "review",
        2,
        resolution,
        "synthetic:evidence",
      ),
      receipt,
    );
    for (const args of [
      [3, resolution, "synthetic:evidence"],
      [2, resolution, "different"],
      [
        2,
        resolution === "provider-confirmed"
          ? "provider-unconfirmed"
          : "provider-confirmed",
        "synthetic:evidence",
      ],
    ] as const)
      assert.throws(
        () =>
          f.vault.revocation.review(
            f.binding,
            "review",
            args[0],
            args[1],
            args[2],
          ),
        code("IDEMPOTENCY_CONFLICT"),
      );
    assert.deepEqual(
      await f.vault.revocation.revoke(
        f.binding,
        "review",
        1,
        f.authority,
        "synthetic-secret",
      ),
      receipt,
    );
    assert.equal(calls, 1);
    noSecrets(f, receipt);
  });

test("organization revocation leaves same-ID buyer tokens and native stock/money intact across restart", async (t) => {
  const f = setup(t);
  ship(f, accept(f).id);
  chooseProviders(f, f.actor, "buyer-choice", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["quickbooks"],
    version: 1,
    acknowledgment: "Synthetic buyer choice",
  });
  f.app.providerCredentials.install(f.binding, 0, {
    ...bundle(),
    accessToken: "synthetic-buyer-access",
  });
  const before = native(f.path);
  mock(t, async () => new Response(null, { status: 200 }));
  const receipt = await f.vault.revocation.revoke(
    f.binding,
    "restart",
    1,
    f.authority,
    "synthetic-secret",
  );
  assert.equal(f.app.providerCredentials.status(f.binding).state, "ready");
  assert.equal(f.app.providerCredentials.status(f.binding).revision, 1);
  assert.deepEqual(native(f.path), before);
  noSecrets(f);
  f.app.close();
  f.app = new Application(f.path, "CA", { providerEncryptionKey: key });
  assert.deepEqual(
    f.app.providerCredentials.ledger.revocation.status(f.binding, "restart"),
    receipt,
  );
  assert.equal(f.app.providerCredentials.status(f.binding).state, "ready");
  assert.deepEqual(native(f.path), before);
  const offline = new Application(f.path, "CA");
  try {
    assert.deepEqual(
      offline.providerCredentials.ledger.revocation.status(
        f.binding,
        "restart",
      ),
      receipt,
    );
  } finally {
    offline.close();
  }
});

for (const change of ["withdraw", "hold", "revision"] as const)
  test(`organization ${change} during provider response prevents confirmation`, async (t) => {
    const f = setup(t),
      reply = deferred<Response>();
    let calls = 0;
    mock(t, async () => {
      calls++;
      return reply.promise;
    });
    const pending = f.vault.revocation.revoke(
        f.binding,
        "drift",
        1,
        f.authority,
        "synthetic-secret",
      ),
      refused = assert.rejects(pending, code("REVOCATION_UNKNOWN"));
    if (change === "withdraw") f.withdraw();
    else if (change === "hold")
      f.app.platform.isolateRestore(
        "synthetic-snapshot",
        new Date().toISOString(),
      );
    else f.vault.disable(f.binding, 2);
    reply.resolve(new Response(null, { status: 200 }));
    await refused;
    assert.equal(
      f.vault.revocation.status(f.binding, "drift").state,
      "unknown",
    );
    assert.equal(calls, 1);
    noSecrets(f);
  });

test("organization active review refuses and deadline review fences the late provider response", async (t) => {
  const f = setup(t),
    reply = deferred<Response>();
  mock(t, async () => reply.promise);
  const pending = f.vault.revocation.revoke(
      f.binding,
      "late",
      1,
      f.authority,
      "synthetic-secret",
    ),
    refused = assert.rejects(pending, code("REVOCATION_UNKNOWN"));
  assert.throws(
    () =>
      f.vault.revocation.review(
        f.binding,
        "late",
        2,
        "provider-unconfirmed",
        "synthetic:evidence",
      ),
    code("CREDENTIAL_BUSY"),
  );
  age(f);
  const reviewed = f.vault.revocation.review(
    f.binding,
    "late",
    2,
    "provider-unconfirmed",
    "synthetic:evidence",
  );
  reply.resolve(new Response(null, { status: 200 }));
  await refused;
  assert.deepEqual(f.vault.revocation.status(f.binding, "late"), reviewed);
  f.vault.install(f.binding, 2, bundle(), f.authority);
  assert.deepEqual(
    f.vault.revocation.review(
      f.binding,
      "late",
      2,
      "provider-unconfirmed",
      "synthetic:evidence",
    ),
    reviewed,
  );
});

test("organization begin and confirm audit failures preserve atomic disable and unresolved evidence", async (t) => {
  const f = setup(t),
    platform = f.app.database.owned("platform");
  let calls = 0;
  mock(t, async () => {
    calls++;
    return new Response(null, { status: 200 });
  });
  const oauth = f.vault.authorization.begin(
    { ...f.binding, redirectUri: "http://127.0.0.1/callback" },
    1,
    f.authority,
  );
  platform.migrate(
    "CREATE TRIGGER platform_org_revoke_fail BEFORE INSERT ON platform_audit WHEN NEW.action='provider.ledger-revocation.begin' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;",
  );
  await assert.rejects(
    f.vault.revocation.revoke(
      f.binding,
      "audit",
      1,
      f.authority,
      "synthetic-secret",
    ),
  );
  assert.equal(calls, 0);
  assert.equal(f.vault.status(f.binding).state, "ready");
  assert.equal(
    f.vault.authorization.status(
      { ...f.binding, redirectUri: "http://127.0.0.1/callback" },
      oauth.id,
    ).state,
    "pending",
  );
  assert.equal(
    f.store.all("SELECT * FROM integration_ledger_revocations").length,
    0,
  );
  platform.migrate(
    "DROP TRIGGER platform_org_revoke_fail; CREATE TRIGGER platform_org_revoke_fail BEFORE INSERT ON platform_audit WHEN NEW.action='provider.ledger-revocation.confirmed' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;",
  );
  await assert.rejects(
    f.vault.revocation.revoke(
      f.binding,
      "audit",
      1,
      f.authority,
      "synthetic-secret",
    ),
    code("REVOCATION_UNKNOWN"),
  );
  assert.equal(calls, 1);
  assert.equal(f.vault.status(f.binding).state, "disabled");
  assert.equal(f.vault.revocation.status(f.binding, "audit").state, "unknown");
  platform.migrate(
    "DROP TRIGGER platform_org_revoke_fail; CREATE TRIGGER platform_org_revoke_fail BEFORE INSERT ON platform_audit WHEN NEW.action='provider.ledger-revocation.review' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;",
  );
  assert.throws(() =>
    f.vault.revocation.review(
      f.binding,
      "audit",
      2,
      "provider-confirmed",
      "synthetic:evidence",
    ),
  );
  assert.equal(f.vault.revocation.status(f.binding, "audit").state, "unknown");
  noSecrets(f);
});

for (const outcome of [200, 503])
  test(`organization late OAuth response after revocation ${outcome} never reactivates credentials`, async (t) => {
    const f = setup(t),
      binding = { ...f.binding, redirectUri: "http://127.0.0.1/callback" },
      flow = f.vault.authorization,
      start = flow.begin(binding, 1, f.authority),
      reply = deferred<Response>(),
      entered = deferred<void>();
    let calls = 0;
    const url = new URL(binding.redirectUri);
    url.search = new URLSearchParams({
      state: new URL(start.authorizationUrl).searchParams.get("state")!,
      realmId: binding.realm,
      code: "synthetic-code",
    }).toString();
    mock(t, async (url) => {
      calls++;
      if (String(url).includes("/tokens/bearer")) {
        entered.resolve();
        return reply.promise;
      }
      return new Response(null, { status: outcome });
    });
    const pending = flow.complete(
        binding,
        start.id,
        "synthetic-secret",
        url.href,
      ),
      refused = assert.rejects(pending, code("OAUTH_STALE"));
    await entered.promise;
    try {
      const revoking = f.vault.revocation.revoke(
        f.binding,
        "oauth-late",
        1,
        f.authority,
        "synthetic-secret",
      );
      if (outcome === 200) await revoking;
      else await assert.rejects(revoking, code("REVOCATION_UNKNOWN"));
    } finally {
      reply.resolve(
        Response.json({
          access_token: "synthetic-org-access",
          refresh_token: "synthetic-org-refresh",
          token_type: "bearer",
          expires_in: 3600,
          x_refresh_token_expires_in: 8640000,
        }),
      );
    }
    await refused;
    assert.equal(flow.status(binding, start.id).state, "canceled");
    assert.equal(f.vault.status(f.binding).state, "disabled");
    assert.equal(calls, 2);
    noSecrets(f);
  });

test("restored sending organization revocation becomes unknown with advanced disabled revision and keyless review", async (t) => {
  const f = setup(t),
    reply = deferred<Response>(),
    archive = join(dirname(f.path), "org.backup"),
    target = join(dirname(f.path), "restored.db"),
    recoveryKey = randomBytes(32);
  let calls = 0;
  mock(t, async () => {
    calls++;
    return reply.promise;
  });
  const pending = f.vault.revocation.revoke(
    f.binding,
    "restore",
    1,
    f.authority,
    "synthetic-secret",
  );
  await createBackup(f.path, archive, "CA", recoveryKey);
  reply.resolve(new Response(null, { status: 200 }));
  await pending;
  await restoreBackup(archive, target, "CA", recoveryKey);
  const restored = new Application(target, "CA");
  try {
    const vault = restored.providerCredentials.ledger,
      receipt = vault.revocation.status(f.binding, "restore");
    assert.equal(receipt.state, "unknown");
    assert.equal(vault.status(f.binding).state, "disabled");
    assert.equal(vault.status(f.binding).revision, 3);
    assert.ok(restored.platform.recoveryHold());
    assert.deepEqual(
      await vault.revocation.revoke(
        f.binding,
        "restore",
        1,
        f.authority,
        "synthetic-secret",
      ),
      receipt,
    );
    assert.equal(calls, 1);
    assert.throws(
      () =>
        vault.revocation.review(
          f.binding,
          "restore",
          2,
          "provider-confirmed",
          "synthetic:evidence",
        ),
      code("REVISION"),
    );
    const review = vault.revocation.review(
      f.binding,
      "restore",
      3,
      "provider-confirmed",
      "synthetic:evidence",
    );
    assert.equal(review.confirmationSource, "operator-evidence");
    assert.equal(vault.status(f.binding).state, "disabled");
    assert.deepEqual(native(target), native(f.path));
  } finally {
    restored.close();
  }
});

for (const restriction of [
  "withdraw",
  "hold",
  "role",
  "inactive",
  "wrong-realm",
  "wrong-client",
  "wrong-key",
  "missing-key",
  "stale-revision",
  "authority-field",
] as const)
  test(`organization ${restriction} before revocation rejects without a request or local disable`, async (t) => {
    const f = setup(t);
    let calls = 0;
    mock(t, async () => {
      calls++;
      throw new Error("unexpected provider IO");
    });
    let binding = f.binding,
      authority = f.authority,
      revision = 1;
    if (restriction === "withdraw") f.withdraw();
    if (restriction === "hold")
      f.app.platform.isolateRestore(
        "synthetic-snapshot",
        new Date().toISOString(),
      );
    if (restriction === "role")
      f.app.database
        .owned("iam")
        .run("UPDATE iam_users SET role='warehouse' WHERE id=?", f.actor.id);
    if (restriction === "inactive")
      f.app.database
        .owned("iam")
        .run("UPDATE iam_users SET active=0 WHERE id=?", f.actor.id);
    if (restriction === "wrong-realm") binding = { ...binding, realm: "9999" };
    if (restriction === "wrong-client")
      binding = { ...binding, clientId: "synthetic-other-client" };
    if (restriction === "stale-revision") revision = 2;
    if (restriction === "authority-field")
      authority = { ...authority, revision: authority.revision + 1 };
    let alternate: Application | undefined;
    try {
      if (restriction === "wrong-key" || restriction === "missing-key")
        alternate = new Application(
          f.path,
          "CA",
          restriction === "wrong-key"
            ? { providerEncryptionKey: "cd".repeat(32) }
            : {},
        );
      await assert.rejects(
        (alternate?.providerCredentials.ledger ?? f.vault).revocation.revoke(
          binding,
          "refused",
          revision,
          authority,
          "synthetic-secret",
        ),
      );
      assert.equal(calls, 0);
      assert.equal(
        f.store.all("SELECT * FROM integration_ledger_revocations").length,
        0,
      );
      const credentials = f.store.get<{ revision: number; state: string }>(
        "SELECT revision,state FROM integration_credentials",
      );
      assert.equal(credentials!.revision, 1);
      assert.equal(credentials!.state, "ready");
    } finally {
      alternate?.close();
    }
  });

test("organization receipt remains restricted to the initiating current finance identity and binding", async (t) => {
  const f = setup(t);
  mock(t, async () => new Response(null, { status: 200 }));
  await f.vault.revocation.revoke(
    f.binding,
    "scope",
    1,
    f.authority,
    "synthetic-secret",
  );
  for (const binding of [
    { ...f.binding, realm: "9999" },
    { ...f.binding, clientId: "synthetic-other-client" },
    { ...f.binding, id: "synthetic-other-binding" },
    { ...f.binding, orgId: "synthetic-other-org" },
  ])
    assert.throws(() => f.vault.revocation.status(binding, "scope"));
  assert.throws(
    () =>
      f.vault.revocation.review(
        f.binding,
        "scope",
        2,
        "provider-confirmed",
        "synthetic:evidence",
      ),
    code("IDEMPOTENCY_CONFLICT"),
  );
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='warehouse' WHERE id=?", f.actor.id);
  assert.throws(
    () => f.vault.revocation.status(f.binding, "scope"),
    code("FORBIDDEN"),
  );
});
