import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawn, fork, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { Application } from "../src/server/application.ts";
import { createBackup, restoreBackup } from "../src/server/recovery.ts";
import { fixture, syntheticDisclosure, chooseProviders } from "./fixtures.ts";
import type { LedgerAuthority } from "../src/server/organization-residency.ts";
import type { Effect } from "../src/server/integration.ts";

const key = "ab".repeat(32),
  config = { providerEncryptionKey: key };
type T = Parameters<typeof fixture>[0];
function setup(t: T, region: "CA" | "US" = "CA", accepted = true) {
  const f = fixture(t, config, region),
    r = f.app.identity.organizationResidency;
  const { provider: _provider, ...terms } = syntheticDisclosure(
    f.app,
    "quickbooks",
  );
  const disclosure = r.publish(f.actor, "ledger-terms", terms);
  const binding = {
    id: "synthetic-binding",
    orgId: f.actor.orgId,
    workerUserId: f.actor.id,
    realm: "1234",
    clientId: "synthetic-client",
  };
  const accept = () => {
    const current = r.current(f.actor);
    r.choose(f.actor, `ledger-accept-${current.choice.revision}`, {
      region,
      revision: current.choice.revision,
      mode: "provider-exception",
      realm: binding.realm,
      acknowledgment: "Synthetic organization acceptance",
      acceptance: {
        disclosureId: current.terms!.id,
        disclosureHash: current.terms!.hash,
        representative: "Synthetic organization representative",
        evidenceRef: "synthetic:organization-review",
      },
    });
    return r.permission(f.actor, binding.realm);
  };
  const withdraw = () =>
    r.choose(f.actor, `ledger-strict-${r.current(f.actor).choice.revision}`, {
      region,
      revision: r.current(f.actor).choice.revision,
      mode: "strict",
      realm: null,
      acknowledgment: "Synthetic organization withdraws",
    });
  const authority = accepted ? accept() : undefined;
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
  return Object.assign(f, {
    binding,
    authority: authority!,
    accept,
    withdraw,
    disclosure,
    effect,
  });
}
function bundle(expired = false) {
  return {
    accessToken: "synthetic-org-access",
    refreshToken: "synthetic-org-refresh",
    accessExpiresAt: Date.now() + (expired ? -1 : 3600000),
    refreshExpiresAt: Date.now() + 100 * 86400000,
    hardExpiresAt: Date.now() + 180 * 86400000,
  };
}
function response() {
  return Response.json({
    access_token: "synthetic-org-next-access",
    refresh_token: "synthetic-org-next-refresh",
    token_type: "bearer",
    expires_in: 3600,
    x_refresh_token_expires_in: 100 * 86400,
  });
}
function mock(t: T, fn: typeof fetch) {
  const original = globalThis.fetch;
  globalThis.fetch = fn;
  t.after(() => {
    globalThis.fetch = original;
  });
}
function rows(f: ReturnType<typeof setup>) {
  return f.app.database
    .owned("integration")
    .all("SELECT * FROM integration_credentials ORDER BY binding_id");
}
const code = (value: string) => (error: unknown) =>
  (error as { code?: string }).code === value;

for (const region of ["CA", "US"] as const) {
  test(`organization ${region} credentials remain separate from the buyer binding and encrypted across restart`, async (t) => {
    const f = setup(t, region),
      vault = f.app.providerCredentials;
    chooseProviders(f, f.actor, "buyer-choice", {
      accountId: f.buyer,
      region,
      mode: "provider-exceptions",
      providers: ["quickbooks"],
      version: 1,
      acknowledgment: "Synthetic buyer choice",
    });
    vault.install(f.binding, 0, {
      ...bundle(),
      accessToken: "synthetic-buyer-access",
    });
    assert.equal(vault.ledger.status(f.binding).state, "missing");
    assert.equal(
      vault.ledger.install(f.binding, 0, bundle(), f.authority).revision,
      1,
    );
    assert.equal(
      await vault.access(f.binding, "unused", f.effect),
      "synthetic-buyer-access",
    );
    assert.equal(
      await vault.ledger.access(f.binding, "unused", f.authority),
      bundle().accessToken,
    );
    assert.equal(rows(f).length, 2);
    for (const row of rows(f)) {
      if (!String(row.binding_id).startsWith("organization-ledger-sandbox-v1:"))
        continue;
      const raw = { ...f.binding, id: String(row.binding_id) };
      for (const operation of [
        () => vault.status(raw),
        () => vault.install(raw, 1, bundle()),
        () => vault.disable(raw, 1),
        () =>
          vault.authorization.begin(
            {
              ...raw,
              accountId: f.buyer,
              redirectUri: "http://127.0.0.1/callback",
            },
            1,
          ),
        () =>
          vault.revocation.status({ ...raw, accountId: f.buyer }, "synthetic"),
      ])
        assert.throws(operation, code("CREDENTIAL_SCOPE"));
      await assert.rejects(
        vault.access(raw, "unused", f.effect),
        code("CREDENTIAL_SCOPE"),
      );
    }
    const dump = JSON.stringify({
      rows: rows(f),
      status: vault.ledger.status(f.binding),
      audit: f.app.database
        .owned("platform")
        .all("SELECT * FROM platform_audit"),
      commands: f.app.database
        .owned("platform")
        .all("SELECT * FROM platform_commands"),
    });
    for (const token of [
      bundle().accessToken,
      bundle().refreshToken,
      "synthetic-buyer-access",
    ]) {
      assert.ok(!dump.includes(token));
      for (const file of [f.path, f.path + "-wal"])
        assert.ok(!readFileSync(file).includes(Buffer.from(token)));
    }
    f.app.close();
    f.app = new Application(f.path, region, config);
    assert.equal(
      await f.app.providerCredentials.ledger.access(
        f.binding,
        "unused",
        f.authority,
      ),
      bundle().accessToken,
    );
  });
}

test("buyer acceptance cannot install organization tokens; exact stamp scope, realm, revision and terms refuse drift", async (t) => {
  const f = setup(t, "CA", false),
    vault = f.app.providerCredentials;
  chooseProviders(f, f.actor, "buyer-choice", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["quickbooks"],
    version: 1,
    acknowledgment: "Synthetic buyer choice",
  });
  const invented: LedgerAuthority = {
    provider: "quickbooks",
    purpose: "stock-cost-journal",
    environment: "sandbox",
    orgId: f.actor.orgId,
    region: "CA",
    realm: "1234",
    revision: 2,
    disclosureId: f.disclosure.id,
    disclosureHash: f.disclosure.hash,
  };
  assert.throws(
    () => vault.ledger.install(f.binding, 0, bundle(), invented),
    code("RESIDENCY_BLOCKED"),
  );
  const authority = f.accept();
  for (const field of Object.keys(authority)) {
    const stamp = {
      ...authority,
      [field]:
        field === "revision" ? authority.revision + 1 : "synthetic-changed",
    } as LedgerAuthority;
    assert.throws(() => vault.ledger.install(f.binding, 0, bundle(), stamp));
    await assert.rejects(vault.ledger.access(f.binding, "unused", stamp));
  }
  assert.throws(
    () =>
      vault.ledger.install(f.binding, 0, bundle(), {
        ...authority,
        accountId: f.buyer,
      } as LedgerAuthority),
    code("RESIDENCY_CHANGED"),
  );
  assert.equal(rows(f).length, 0);
  vault.ledger.install(f.binding, 0, bundle(), authority);
  f.withdraw();
  await assert.rejects(
    vault.ledger.access(f.binding, "unused", authority),
    code("RESIDENCY_BLOCKED"),
  );
  const replacement = f.accept();
  await assert.rejects(
    vault.ledger.access(f.binding, "unused", authority),
    code("RESIDENCY_CHANGED"),
  );
  assert.equal(
    await vault.ledger.access(f.binding, "unused", replacement),
    bundle().accessToken,
  );
});

test("company and client remain immutable for a durable organization binding; ciphertext cannot cross scope or tenant", async (t) => {
  const f = setup(t),
    vault = f.app.providerCredentials,
    other = setup(t);
  vault.ledger.install(f.binding, 0, bundle(), f.authority);
  for (const changed of [{ realm: "5678" }, { clientId: "other-client" }]) {
    assert.throws(
      () => vault.ledger.status({ ...f.binding, ...changed }),
      code("CREDENTIAL_SCOPE"),
    );
    assert.throws(
      () => vault.ledger.disable({ ...f.binding, ...changed }, 1),
      code("CREDENTIAL_SCOPE"),
    );
  }
  vault.install(f.binding, 0, bundle());
  const ledger = rows(f).find((r) =>
    String(r.binding_id).startsWith("organization-ledger"),
  )!;
  f.app.database
    .owned("integration")
    .run(
      "UPDATE integration_credentials SET material=? WHERE binding_id=?",
      ledger.material!,
      f.binding.id,
    );
  chooseProviders(f, f.actor, "buyer-choice", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["quickbooks"],
    version: 1,
    acknowledgment: "Synthetic buyer choice",
  });
  await assert.rejects(
    vault.access(f.binding, "unused", f.effect),
    code("CREDENTIAL_INTEGRITY"),
  );
  other.app.providerCredentials.ledger.install(
    other.binding,
    0,
    bundle(),
    other.authority,
  );
  other.app.database
    .owned("integration")
    .run("UPDATE integration_credentials SET material=?", ledger.material!);
  await assert.rejects(
    other.app.providerCredentials.ledger.access(
      other.binding,
      "unused",
      other.authority,
    ),
    code("CREDENTIAL_INTEGRITY"),
  );
  for (const realm of ["0", "01234", "1".repeat(41)])
    assert.throws(
      () => vault.ledger.status({ ...f.binding, realm }),
      code("PROVIDER_CONFIG"),
    );
});

test("organization installation and local disable roll back atomically when audit fails", (t) => {
  const f = setup(t),
    vault = f.app.providerCredentials,
    audit = f.app.platform.audit;
  f.app.platform.audit = () => {
    throw Error("synthetic audit failure");
  };
  assert.throws(() =>
    vault.ledger.install(f.binding, 0, bundle(), f.authority),
  );
  assert.deepEqual(rows(f), []);
  assert.equal(vault.keyStatus().generation, 0);
  f.app.platform.audit = audit;
  vault.ledger.install(f.binding, 0, bundle(), f.authority);
  const before = rows(f);
  f.app.platform.audit = () => {
    throw Error("synthetic audit failure");
  };
  assert.throws(() => vault.ledger.disable(f.binding, 1));
  assert.throws(() =>
    vault.ledger.install(f.binding, 1, bundle(), f.authority),
  );
  assert.deepEqual(rows(f), before);
  f.app.platform.audit = audit;
});

test("organization token refresh has one claim and snapshots caller bindings and consent across its asynchronous boundary", async (t) => {
  const f = setup(t),
    vault = f.app.providerCredentials,
    other = new Application(f.path, "CA", config);
  t.after(() => other.close());
  vault.ledger.install(f.binding, 0, bundle(true), f.authority);
  let finish!: (response: Response) => void,
    calls = 0;
  mock(t, async (url, init) => {
    calls++;
    assert.equal(
      String(url),
      "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    );
    assert.equal(
      new URLSearchParams(String(init?.body)).get("refresh_token"),
      bundle().refreshToken,
    );
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  const binding = { ...f.binding },
    stamp = { ...f.authority };
  const pending = vault.ledger.access(
    binding,
    "synthetic-client-secret",
    stamp,
  );
  await assert.rejects(
    other.providerCredentials.ledger.access(
      f.binding,
      "synthetic-client-secret",
      f.authority,
    ),
    code("CREDENTIAL_BUSY"),
  );
  binding.realm = "5678";
  binding.id = "mutated";
  stamp.revision++;
  finish(response());
  assert.equal(await pending, "synthetic-org-next-access");
  assert.equal(vault.ledger.status(f.binding).revision, 2);
  assert.equal(
    vault.ledger.status({ ...f.binding, id: "mutated" }).state,
    "missing",
  );
  assert.equal(
    await vault.ledger.access(f.binding, "unused", f.authority),
    "synthetic-org-next-access",
  );
  assert.equal(calls, 1);
});

for (const change of [
  "consent",
  "terms",
  "disable",
  "replacement",
  "role",
  "hold",
] as const) {
  test(`organization refresh refuses a ${change} change before accepting a late response`, async (t) => {
    const f = setup(t),
      vault = f.app.providerCredentials;
    vault.ledger.install(f.binding, 0, bundle(true), f.authority);
    let finish!: (response: Response) => void,
      calls = 0;
    mock(t, async () => {
      calls++;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    });
    const pending = vault.ledger.access(f.binding, "secret", f.authority);
    if (change === "consent") f.withdraw();
    if (change === "terms")
      f.app.identity.organizationResidency.withdrawDisclosure(
        f.actor,
        "withdraw-terms",
        { disclosureId: f.disclosure.id, reason: "Synthetic withdraw" },
      );
    if (change === "disable") vault.ledger.disable(f.binding, 1);
    if (change === "replacement")
      vault.ledger.install(
        f.binding,
        1,
        { ...bundle(), accessToken: "synthetic-replacement" },
        f.authority,
      );
    if (change === "role")
      f.app.database
        .owned("iam")
        .run("UPDATE iam_users SET role='commercial' WHERE id=?", f.actor.id);
    if (change === "hold")
      f.app.database
        .owned("platform")
        .run(
          "INSERT INTO platform_recovery VALUES(1,?,?,?)",
          "synthetic",
          new Date().toISOString(),
          new Date().toISOString(),
        );
    finish(response());
    await assert.rejects(pending);
    const row = rows(f)[0]!;
    assert.equal(
      row.state,
      change === "replacement"
        ? "ready"
        : change === "disable"
          ? "disabled"
          : "unknown",
    );
    assert.equal(
      row.revision,
      change === "replacement" || change === "disable" ? 2 : 1,
    );
    if (change === "replacement")
      assert.equal(
        await vault.ledger.access(f.binding, "unused", f.authority),
        "synthetic-replacement",
      );
    else assert.equal(row.material, null);
    assert.equal(calls, 1);
  });
}

test("withdrawn consent blocks cached access and reinstallation but permits local removal without key or recovery clearance", async (t) => {
  const f = setup(t),
    vault = f.app.providerCredentials;
  vault.ledger.install(f.binding, 0, bundle(), f.authority);
  f.withdraw();
  assert.throws(
    () => vault.ledger.install(f.binding, 1, bundle(), f.authority),
    code("RESIDENCY_BLOCKED"),
  );
  await assert.rejects(
    vault.ledger.access(f.binding, "unused", f.authority),
    code("RESIDENCY_BLOCKED"),
  );
  f.app.close();
  f.app = new Application(f.path, "CA");
  assert.equal(
    f.app.providerCredentials.ledger.disable(f.binding, 1).state,
    "disabled",
  );
  assert.equal(rows(f)[0]!.material, null);
});

test("rotation covers buyer and organization ciphertext and restored stores erase both while retaining consent history", async (t) => {
  const f = setup(t),
    vault = f.app.providerCredentials;
  vault.install(f.binding, 0, bundle());
  vault.ledger.install(f.binding, 0, bundle(), f.authority);
  const stale = new Application(f.path, "CA", config);
  t.after(() => stale.close());
  assert.equal(
    vault.rotate(
      [{ orgId: f.actor.orgId, workerUserId: f.actor.id }],
      1,
      "cd".repeat(32),
    ).bindings,
    2,
  );
  await assert.rejects(
    stale.providerCredentials.ledger.access(f.binding, "unused", f.authority),
    code("CREDENTIAL_INTEGRITY"),
  );
  assert.equal(
    await vault.ledger.access(f.binding, "unused", f.authority),
    bundle().accessToken,
  );
  assert.equal(vault.ledger.status(f.binding).revision, 2);
  const backupKey = randomBytes(32),
    dir = dirname(f.path),
    target = join(dir, "restored.db");
  await createBackup(
    f.path,
    join(dir, "snapshot.distributor-backup"),
    "CA",
    backupKey,
  );
  await restoreBackup(
    join(dir, "snapshot.distributor-backup"),
    target,
    "CA",
    backupKey,
  );
  const restored = new Application(target, "CA", {
    providerEncryptionKey: "cd".repeat(32),
  });
  t.after(() => restored.close());
  assert.equal(
    restored.identity.organizationResidency.current(f.actor).allowed,
    true,
  );
  assert.equal(
    restored.providerCredentials.ledger.status(f.binding).state,
    "disabled",
  );
  assert.equal(
    restored.providerCredentials.status(f.binding).state,
    "disabled",
  );
  assert.ok(
    restored.database
      .owned("integration")
      .all("SELECT material FROM integration_credentials")
      .every((r) => r.material === null),
  );
  await assert.rejects(
    restored.providerCredentials.ledger.access(
      f.binding,
      "unused",
      f.authority,
    ),
    code("RECOVERY_HOLD"),
  );
  assert.equal(
    restored.providerCredentials.ledger.disable(f.binding, 3).revision,
    4,
  );
});

test("ambiguous and interrupted organization refreshes remove local material and cannot resend", async (t) => {
  const f = setup(t),
    vault = f.app.providerCredentials;
  vault.ledger.install(f.binding, 0, bundle(true), f.authority);
  let calls = 0;
  mock(t, async () => {
    calls++;
    throw Error("synthetic secret response failure");
  });
  await assert.rejects(
    vault.ledger.access(f.binding, "secret", f.authority),
    code("CREDENTIAL_REFRESH"),
  );
  assert.equal(vault.ledger.status(f.binding).state, "unknown");
  await assert.rejects(
    vault.ledger.access(f.binding, "secret", f.authority),
    code("CREDENTIAL_RECONNECT"),
  );
  assert.equal(calls, 1);
  vault.ledger.install(f.binding, 1, bundle(true), f.authority);
  f.app.database
    .owned("integration")
    .run(
      "UPDATE integration_credentials SET state='refreshing',claim='synthetic',started_at=?",
      Date.now() - 90001,
    );
  await assert.rejects(
    vault.ledger.access(f.binding, "secret", f.authority),
    code("CREDENTIAL_RECONNECT"),
  );
  assert.equal(rows(f)[0]!.material, null);
  assert.equal(calls, 1);
});

test("organization credential CLI provides reviewed permission and protected offline installation without exposing material", async (t) => {
  const f = setup(t);
  const env = {
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
  const permission = await run(["ledger-permission"]);
  assert.equal(permission.code, 0);
  assert.deepEqual(JSON.parse(permission.out), f.authority);
  const installed = await run(
    ["ledger-install"],
    JSON.stringify({ revision: 0, tokens: bundle(), authority: f.authority }),
  );
  assert.equal(installed.code, 0);
  assert.equal(JSON.parse(installed.out).revision, 1);
  assert.equal(JSON.parse((await run(["ledger-status"])).out).state, "ready");
  for (const input of [
    { revision: 1, tokens: bundle() },
    {
      revision: 1,
      tokens: bundle(),
      authority: { ...f.authority, revision: 99 },
    },
    {
      revision: 1,
      tokens: bundle(),
      authority: f.authority,
      accountId: f.buyer,
    },
  ]) {
    const result = await run(["ledger-install"], JSON.stringify(input));
    assert.equal(result.code, 1);
    assert.ok(
      !result.out.includes(bundle().accessToken) &&
        !result.err.includes(bundle().accessToken),
    );
  }
  assert.equal((await run(["ledger-install", bundle().refreshToken])).code, 1);
  f.withdraw();
  assert.equal((await run(["ledger-permission"])).code, 1);
  const disabled = await run(
    ["ledger-disable"],
    JSON.stringify({ revision: 1 }),
  );
  assert.equal(disabled.code, 0);
  assert.equal(JSON.parse(disabled.out).state, "disabled");
});

test(
  "independent processes contest one organization refresh claim with exactly one mocked exchange and clean exits",
  { timeout: 20000 },
  async (t) => {
    const f = setup(t);
    f.app.providerCredentials.ledger.install(
      f.binding,
      0,
      bundle(true),
      f.authority,
    );
    const children: ChildProcess[] = [];
    t.after(() =>
      children.forEach((child) => {
        if (child.exitCode === null && child.signalCode === null) child.kill();
      }),
    );
    type Result = { ok: boolean; code?: string; calls: number };
    const make = () => {
      const child = fork(
        new URL("./provider-credentials-child.ts", import.meta.url),
        [],
        {
          execArgv: ["--import", "tsx"],
          stdio: ["ignore", "ignore", "pipe", "ipc"],
        },
      );
      children.push(child);
      let readyResolve!: () => void,
        stderr = "",
        outcome: Result | undefined;
      const ready = new Promise<void>((resolve) => {
        readyResolve = resolve;
      });
      const result = new Promise<Result>((resolve, reject) => {
        child.on("error", reject);
        child.stderr?.on("data", (data) => {
          stderr += String(data);
        });
        child.on("close", (code, signal) =>
          code === 0 && outcome
            ? resolve(outcome)
            : reject(
                Error(`Synthetic child failed ${code}/${signal}: ${stderr}`),
              ),
        );
      });
      // Keep both processes at the claim boundary before releasing any response.
      child.on(
        "message",
        (message: Result & { ready?: boolean; requested?: boolean }) => {
          if (message.ready) readyResolve();
          else if (!message.requested) {
            outcome = message;
            if (!message.ok)
              children.forEach((other) => {
                if (other.connected && other !== child)
                  other.send({ action: "release" });
              });
          }
        },
      );
      child.send({
        action: "init",
        input: {
          path: f.path,
          key,
          binding: f.binding,
          authority: f.authority,
        },
      });
      return { child, ready, result };
    };
    const a = make(),
      b = make();
    await Promise.all([a.ready, b.ready]);
    a.child.send({ action: "go" });
    b.child.send({ action: "go" });
    const outcomes = await Promise.all([a.result, b.result]);
    assert.equal(outcomes.filter((r) => r.ok).length, 1);
    assert.equal(
      outcomes.filter((r) => r.code === "CREDENTIAL_BUSY").length,
      1,
    );
    assert.equal(
      outcomes.reduce((n, r) => n + r.calls, 0),
      1,
    );
  },
);

test("organization native fence joins only an existing business transaction and refuses a stand-alone unguarded read", (t) => {
  const f = setup(t),
    r = f.app.identity.organizationResidency;
  assert.throws(
    () => r.assertAllowedInTransaction(f.actor, f.authority),
    code("TRANSACTION"),
  );
  assert.deepEqual(
    f.app.database.transaction(() =>
      r.assertAllowedInTransaction(f.actor, f.authority),
    ),
    f.authority,
  );
  assert.deepEqual(r.assertAllowed(f.actor, f.authority), f.authority);
});

for (const change of ["inactive", "password", "account", "role"] as const) {
  test(`organization ${change} worker cannot inspect, install, disable or obtain cached tokens with a stale configuration`, async (t) => {
    const f = setup(t),
      vault = f.app.providerCredentials;
    const worker = f.app.identity.createUser(f.actor, "ledger-worker", {
      email: "ledger-worker@example.test",
      name: "Synthetic worker",
      password: "long-test-only-password",
      role: "finance",
      sites: [],
      requirePasswordChange: false,
    });
    const binding = { ...f.binding, workerUserId: worker.id };
    vault.ledger.install(binding, 0, bundle(), f.authority);
    const store = f.app.database.owned("iam");
    if (change === "inactive")
      store.run("UPDATE iam_users SET active=0 WHERE id=?", worker.id);
    if (change === "password")
      store.run(
        "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
        worker.id,
      );
    if (change === "account")
      store.run(
        "UPDATE iam_users SET account_id=? WHERE id=?",
        f.buyer,
        worker.id,
      );
    if (change === "role")
      store.run("UPDATE iam_users SET role='commercial' WHERE id=?", worker.id);
    for (const op of [
      () => vault.ledger.status(binding),
      () => vault.ledger.install(binding, 1, bundle(), f.authority),
      () => vault.ledger.disable(binding, 1),
    ])
      assert.throws(op);
    await assert.rejects(vault.ledger.access(binding, "unused", f.authority));
    assert.equal(vault.ledger.status(f.binding).revision, 1);
  });
}

test("late organization refresh expires its lease instead of returning a token; original hard expiry stays bounded", async (t) => {
  const f = setup(t),
    vault = f.app.providerCredentials,
    clock = Date.now;
  let timestamp = clock();
  Date.now = () => timestamp;
  t.after(() => {
    Date.now = clock;
  });
  vault.ledger.install(
    f.binding,
    0,
    { ...bundle(true), hardExpiresAt: timestamp + 200000 },
    f.authority,
  );
  let finish!: (response: Response) => void,
    calls = 0;
  mock(t, async () => {
    calls++;
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  const pending = vault.ledger.access(f.binding, "secret", f.authority);
  timestamp += 90001;
  finish(response());
  await assert.rejects(pending, code("CREDENTIAL_STALE"));
  assert.equal(rows(f)[0]!.material, null);
  await assert.rejects(
    vault.ledger.access(f.binding, "secret", f.authority),
    code("CREDENTIAL_RECONNECT"),
  );
  assert.equal(calls, 1);
});

test("credential namespace authenticates purpose even if a legacy buyer ciphertext is copied into a ledger row", async (t) => {
  const f = setup(t),
    vault = f.app.providerCredentials;
  vault.install(f.binding, 0, bundle());
  vault.ledger.install(f.binding, 0, bundle(), f.authority);
  const buyer = rows(f).find((r) => r.binding_id === f.binding.id)!,
    ledger = rows(f).find((r) => r.binding_id !== f.binding.id)!;
  f.app.database
    .owned("integration")
    .run(
      "UPDATE integration_credentials SET material=? WHERE binding_id=?",
      buyer.material!,
      ledger.binding_id!,
    );
  await assert.rejects(
    vault.ledger.access(f.binding, "unused", f.authority),
    code("CREDENTIAL_INTEGRITY"),
  );
});
