import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { existsSync, rmSync } from "node:fs";
import { ProviderCredentials } from "../src/server/provider-credentials.ts";
import { journalFixture } from "./stock-journal-fixture.ts";
const key = "ab".repeat(32);
const enabled = {
  PROVIDERS_ENABLED: "true",
  QUICKBOOKS_CLIENT_SECRET: "synthetic-secret",
};
function setup(t: TestContext, region: "CA" | "US" = "CA") {
  const f = journalFixture(t, region),
    vault = new ProviderCredentials(
      f.f.app.database,
      f.f.app.platform,
      f.f.app.identity,
      key,
    ),
    binding = {
      id: f.make().bindingId,
      orgId: f.f.actor.orgId,
      workerUserId: f.f.actor.id,
      realm: f.make().realm,
      clientId: "synthetic-client",
    };
  t.after(() => vault.close());
  vault.ledger.install(
    binding,
    0,
    {
      accessToken: "synthetic-journal-access",
      refreshToken: "synthetic-journal-refresh",
      accessExpiresAt: Date.now() + 3600000,
      refreshExpiresAt: Date.now() + 100 * 86400000,
    },
    f.make().authority,
  );
  const run = (
    args: string[],
    input: string | Buffer,
    overrides: NodeJS.ProcessEnv = {},
  ) =>
    new Promise<{ code: number | null; out: string; err: string }>(
      (resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            "--import",
            "tsx",
            "--import",
            "./tests/stock-journal-cli-transport.ts",
            "src/server/stock-journal-transport-cli.ts",
            ...args,
          ],
          {
            env: {
              PATH: process.env.PATH,
              DATABASE_PATH: f.f.path,
              DATA_REGION: region,
              PROVIDER_BINDING_ID: binding.id,
              PROVIDER_ORG_ID: binding.orgId,
              PROVIDER_WORKER_USER_ID: binding.workerUserId,
              QUICKBOOKS_REALM_ID: binding.realm,
              QUICKBOOKS_CLIENT_ID: binding.clientId,
              PROVIDER_ENCRYPTION_KEY: key,
              PROVIDERS_ENABLED: "false",
              SYNTHETIC_JOURNAL_FILE: join(
                dirname(f.f.path),
                "synthetic-receiver.json",
              ),
              SYNTHETIC_EXPECT_READS: "none",
              ...overrides,
            },
            stdio: ["pipe", "pipe", "pipe"],
          },
        );
        let out = "",
          err = "";
        const timeout = setTimeout(() => child.kill("SIGKILL"), 15000);
        child.on("error", reject);
        child.stdout.on("data", (data) => (out += String(data)));
        child.stderr.on("data", (data) => (err += String(data)));
        child.on("close", (code) => {
          clearTimeout(timeout);
          resolve({ code, out, err });
        });
        child.stdin.on("error", () => {});
        child.stdin.end(input);
      },
    );
  return { ...f, vault, binding, run };
}
function noSecrets(result: { out: string; err: string }) {
  for (const secret of [
    "synthetic-journal-access",
    "synthetic-journal-refresh",
    "synthetic-secret",
    "sensitive-provider-body",
  ])
    assert.ok(!(result.out + result.err).includes(secret));
}
for (const region of ["CA", "US"] as const)
  test(`${region} protected journal command posts one exact approved journal and replay stays idle`, async (t) => {
    const f = setup(t, region),
      a = f.approve(),
      input = JSON.stringify({ journalId: a.id, reviewHash: a.reviewHash });
    const before = f.f.app.integration.costs.download(f.f.actor, f.original.id);
    const posted = await f.run(["write"], input, {
      ...enabled,
      SYNTHETIC_EXPECT_WRITES: "1",
      SYNTHETIC_EXPECT_READS: "allowed",
    });
    assert.equal(posted.code, 0, posted.err);
    assert.deepEqual(JSON.parse(posted.out), {
      journalId: a.id,
      outcome: "posted",
      reference: "501",
    });
    const after = f.j.detail(f.f.actor, a.id);
    assert.equal(after.state, "posted");
    assert.equal(after.observations.length, 1);
    assert.deepEqual(
      f.f.app.integration.costs.download(f.f.actor, f.original.id),
      before,
    );
    const replay = await f.run(["write"], input, enabled);
    assert.equal(replay.code, 0, replay.err);
    assert.deepEqual(JSON.parse(replay.out), {
      journalId: a.id,
      outcome: "idle",
    });
    for (const r of [posted, replay]) noSecrets(r);
  });
for (const region of ["CA", "US"] as const)
  test(`${region} lost journal reply survives process restart and only explicit lookup can confirm it`, async (t) => {
    const f = setup(t, region),
      a = f.approve(),
      input = JSON.stringify({ journalId: a.id, reviewHash: a.reviewHash });
    const lost = await f.run(["write"], input, {
      ...enabled,
      SYNTHETIC_EXPECT_WRITES: "1",
      SYNTHETIC_EXPECT_READS: "allowed",
      SYNTHETIC_LOST_REPLY: "true",
    });
    assert.equal(lost.code, 1, lost.err);
    assert.deepEqual(JSON.parse(lost.out), {
      journalId: a.id,
      outcome: "unknown",
      reason: "transport-uncertain",
    });
    assert.equal(f.j.detail(f.f.actor, a.id).state, "unknown");
    const status = await f.run(["status"], JSON.stringify({ journalId: a.id }));
    assert.equal(status.code, 0, status.err);
    assert.equal(JSON.parse(status.out).state, "unknown");
    assert.equal(JSON.parse(status.out).dispatched, true);
    const resend = await f.run(["write"], input, enabled);
    assert.equal(resend.code, 1);
    assert.match(resend.err, /JOURNAL_STATE:/);
    const lookup = await f.run(["lookup"], input, {
      ...enabled,
      SYNTHETIC_EXPECT_READS: "1",
    });
    assert.equal(lookup.code, 0, lookup.err);
    assert.deepEqual(JSON.parse(lookup.out), {
      journalId: a.id,
      outcome: "posted",
      reference: "501",
    });
    assert.deepEqual(
      f.j.detail(f.f.actor, a.id).observations.map((o) => o.body.outcome),
      ["posted", "unknown"],
    );
    for (const r of [lost, status, resend, lookup]) noSecrets(r);
  });
test("journal lookup absence retains uncertainty and SIGTERM before dispatch retains a recoverable native observation", async (t) => {
  const f = setup(t),
    a = f.approve(),
    input = JSON.stringify({ journalId: a.id, reviewHash: a.reviewHash });
  const interruption = await f.run(["write"], input, {
    ...enabled,
    SYNTHETIC_EXPECT_READS: "1",
    SYNTHETIC_INTERRUPT: "true",
  });
  assert.equal(interruption.code, 1, interruption.err);
  assert.deepEqual(JSON.parse(interruption.out), {
    journalId: a.id,
    outcome: "unknown",
    reason: "interrupted",
  });
  assert.equal(f.j.detail(f.f.actor, a.id).dispatched, false);
  rmSync(join(dirname(f.f.path), "synthetic-receiver.json"), { force: true });
  const lookup = await f.run(["lookup"], input, {
    ...enabled,
    SYNTHETIC_EXPECT_READS: "1",
  });
  assert.equal(lookup.code, 1, lookup.err);
  assert.deepEqual(JSON.parse(lookup.out), {
    journalId: a.id,
    outcome: "unknown",
    reason: "lookup-miss",
  });
  const resend = await f.run(["write"], input, enabled);
  assert.equal(resend.code, 1);
  assert.match(resend.err, /JOURNAL_STATE:/);
  assert.equal(f.j.detail(f.f.actor, a.id).state, "unknown");
  for (const r of [interruption, lookup, resend]) noSecrets(r);
});
test("keyless journal status remains available after withdrawal and a restore hold", async (t) => {
  const f = setup(t),
    a = f.approve();
  f.f.app.identity.organizationResidency.choose(f.f.actor, "withdraw", {
    region: "CA",
    revision: f.f.app.identity.organizationResidency.current(f.f.actor).choice
      .revision,
    mode: "strict",
    realm: null,
    acknowledgment: "Synthetic withdrawal",
  });
  f.f.app.platform.isolateRestore(
    "synthetic-snapshot",
    new Date().toISOString(),
  );
  const status = await f.run(["status"], JSON.stringify({ journalId: a.id }), {
    PROVIDER_ENCRYPTION_KEY: "invalid-ambient-key",
    QUICKBOOKS_CLIENT_SECRET: "invalid-ambient-secret",
  });
  assert.equal(status.code, 0, status.err);
  assert.deepEqual(JSON.parse(status.out), {
    journalId: a.id,
    reviewHash: a.reviewHash,
    state: "pending",
    dispatched: false,
    reference: null,
    leaseStarted: null,
    leaseMode: null,
  });
  assert.equal(f.j.detail(f.f.actor, a.id).state, "pending");
  noSecrets(status);
});
test("protected journal input and configuration refusals never initialize a new store or echo private input", async (t) => {
  const f = setup(t),
    a = f.approve(),
    input = JSON.stringify({ journalId: a.id, reviewHash: a.reviewHash }),
    path = join(dirname(f.f.path), "refused.db"),
    privateValue = "synthetic-private-input";
  const invalid: [string[], string | Buffer][] = [
    [["write", privateValue], input],
    [["unsupported"], input],
    [["status"], "null"],
    [["write"], "[]"],
    [["write"], "{"],
    [["write"], Buffer.from([0xc3, 0x28])],
    [["write"], "x".repeat(32769)],
    [["status"], JSON.stringify({ journalId: "" })],
    [["status"], JSON.stringify({ journalId: "x".repeat(129) })],
    [["write"], JSON.stringify({ journalId: a.id })],
    [["write"], JSON.stringify({ journalId: a.id, reviewHash: "bad" })],
    [
      ["write"],
      JSON.stringify({
        journalId: a.id,
        reviewHash: a.reviewHash,
        token: privateValue,
      }),
    ],
    [["status"], JSON.stringify({ journalId: a.id, reviewHash: a.reviewHash })],
  ];
  for (const [args, body] of invalid) {
    const r = await f.run(args, body, { ...enabled, DATABASE_PATH: path });
    assert.equal(r.code, 1);
    assert.equal(r.out, "");
    assert.ok(!r.err.includes(privateValue));
    noSecrets(r);
    assert.equal(existsSync(path), false);
  }
  for (const config of [
    {},
    { ...enabled, PROVIDER_ENCRYPTION_KEY: "bad" },
    { ...enabled, QUICKBOOKS_CLIENT_SECRET: "\n" },
    { ...enabled, QUICKBOOKS_REALM_ID: "012345" },
    { ...enabled, DATA_REGION: "OTHER" },
    { ...enabled, PROVIDER_BINDING_ID: "" },
    enabled,
  ]) {
    const r = await f.run(["write"], input, { ...config, DATABASE_PATH: path });
    assert.equal(r.code, 1);
    assert.equal(r.out, "");
    noSecrets(r);
    assert.equal(existsSync(path), false);
  }
  assert.equal(f.j.detail(f.f.actor, a.id).state, "pending");
});
test("journal execution requires the current worker, immutable review, exact binding and company", async (t) => {
  const f = setup(t),
    a = f.approve(),
    input = JSON.stringify({ journalId: a.id, reviewHash: a.reviewHash });
  for (const config of [
    { PROVIDER_BINDING_ID: "different-binding" },
    { QUICKBOOKS_REALM_ID: "9999" },
    { PROVIDER_ORG_ID: "other-organization" },
    { PROVIDER_WORKER_USER_ID: "missing-worker" },
    { QUICKBOOKS_CLIENT_ID: "different-client" },
    { PROVIDER_ENCRYPTION_KEY: "cd".repeat(32) },
  ]) {
    const r = await f.run(["write"], input, { ...enabled, ...config });
    assert.equal(r.code, 1);
    assert.equal(r.out, "");
    noSecrets(r);
    assert.equal(f.j.detail(f.f.actor, a.id).state, "pending");
  }
  const stale = await f.run(
    ["write"],
    JSON.stringify({ journalId: a.id, reviewHash: "ab".repeat(32) }),
    enabled,
  );
  assert.equal(stale.code, 1);
  assert.match(stale.err, /JOURNAL_REVIEW_CHANGED:/);
  noSecrets(stale);
  const h = setup(t),
    unapproved = h.j.prepare(h.f.actor, "unapproved", h.make());
  const ready = await h.run(
    ["write"],
    JSON.stringify({
      journalId: unapproved.id,
      reviewHash: unapproved.reviewHash,
    }),
    enabled,
  );
  assert.equal(ready.code, 1);
  assert.match(ready.err, /JOURNAL_STATE:/);
  assert.equal(h.j.detail(h.f.actor, unapproved.id).state, "ready");
  noSecrets(ready);
});
