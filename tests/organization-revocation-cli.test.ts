import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fixture, syntheticDisclosure } from "./fixtures.ts";
const key = "ab".repeat(32);
type T = Parameters<typeof fixture>[0];
function setup(t: T, region: "CA" | "US" = "CA") {
  const f = fixture(t, { providerEncryptionKey: key }, region);
  const residency = f.app.identity.organizationResidency;
  const { provider: _, ...terms } = syntheticDisclosure(f.app, "quickbooks");
  residency.publish(f.actor, "org-terms", terms);
  const binding = {
    id: "synthetic-binding",
    orgId: f.actor.orgId,
    workerUserId: f.actor.id,
    realm: "1234",
    clientId: "synthetic-client",
  };
  const current = residency.current(f.actor);
  residency.choose(f.actor, "choice", {
    region,
    revision: current.choice.revision,
    mode: "provider-exception",
    realm: binding.realm,
    acknowledgment: "Synthetic acceptance",
    acceptance: {
      disclosureId: current.terms!.id,
      disclosureHash: current.terms!.hash,
      representative: "Synthetic operator",
      evidenceRef: "synthetic:accept",
    },
  });
  const authority = residency.permission(f.actor, binding.realm),
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
            "./tests/organization-revocation-transport.ts",
            "src/server/organization-revocation-cli.ts",
            ...args,
          ],
          {
            env: {
              PATH: process.env.PATH,
              DATABASE_PATH: f.path,
              DATA_REGION: region,
              PROVIDER_BINDING_ID: binding.id,
              PROVIDER_ORG_ID: binding.orgId,
              PROVIDER_WORKER_USER_ID: binding.workerUserId,
              QUICKBOOKS_REALM_ID: binding.realm,
              QUICKBOOKS_CLIENT_ID: binding.clientId,
              PROVIDER_ENCRYPTION_KEY: key,
              PROVIDERS_ENABLED: "false",
              ...overrides,
            },
            stdio: ["pipe", "pipe", "pipe"],
          },
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
        child.stdin.on("error", () => {});
        child.stdin.end(input);
      },
    );
  return { ...f, binding, authority, vault, residency, run };
}
const enabled = {
  PROVIDERS_ENABLED: "true",
  QUICKBOOKS_CLIENT_SECRET: "synthetic-secret",
};
function noSecrets(result: { out: string; err: string }) {
  for (const value of [
    "synthetic-org-access",
    "synthetic-org-refresh",
    "synthetic-secret",
    "sensitive-provider-body",
  ])
    assert.ok(!(result.out + result.err).includes(value));
}
for (const region of ["CA", "US"] as const)
  test(`${region} protected organization revocation requests once and reads exact retained outcome without buyer credentials`, async (t) => {
    const f = setup(t, region),
      input = JSON.stringify({
        receiptId: "reviewed-revoke",
        revision: 1,
        authority: f.authority,
      });
    const revoked = await f.run(["revoke"], input, {
      ...enabled,
      SYNTHETIC_EXPECT_REQUESTS: "1",
    });
    assert.equal(revoked.code, 0, revoked.err);
    const receipt = JSON.parse(revoked.out);
    assert.equal(receipt.state, "confirmed");
    assert.equal(receipt.confirmationSource, "provider-response");
    assert.equal(receipt.credentialScope, "organization");
    assert.equal(receipt.disabledRevision, 2);
    assert.equal(f.vault.status(f.binding).state, "disabled");
    assert.equal(f.app.providerCredentials.status(f.binding).state, "missing");
    const replay = await f.run(["revoke"], input, enabled);
    assert.equal(replay.code, 0, replay.err);
    assert.deepEqual(JSON.parse(replay.out), receipt);
    const status = await f.run(
      ["status"],
      JSON.stringify({ receiptId: receipt.id }),
      { PROVIDER_ENCRYPTION_KEY: "invalid-ambient-key" },
    );
    assert.equal(status.code, 0, status.err);
    assert.deepEqual(JSON.parse(status.out), receipt);
    for (const result of [revoked, replay, status]) noSecrets(result);
  });
for (const region of ["CA", "US"] as const)
  test(`${region} uncertain operator revocation can be reviewed offline after withdrawal and hold without resending`, async (t) => {
    const f = setup(t, region),
      input = JSON.stringify({
        receiptId: "uncertain",
        revision: 1,
        authority: f.authority,
      });
    const unknown = await f.run(["revoke"], input, {
      ...enabled,
      SYNTHETIC_EXPECT_REQUESTS: "1",
      SYNTHETIC_RESPONSE: "failure",
    });
    assert.equal(unknown.code, 1);
    assert.match(unknown.err, /REVOCATION_UNKNOWN:/);
    assert.equal(unknown.out, "");
    noSecrets(unknown);
    f.residency.choose(f.actor, "withdraw", {
      region,
      revision: f.residency.current(f.actor).choice.revision,
      mode: "strict",
      realm: null,
      acknowledgment: "Synthetic withdrawal",
    });
    f.app.platform.isolateRestore(
      "synthetic-snapshot",
      new Date().toISOString(),
    );
    const offline = { PROVIDER_ENCRYPTION_KEY: "invalid-ambient-key" };
    const status = await f.run(
      ["status"],
      JSON.stringify({ receiptId: "uncertain" }),
      offline,
    );
    assert.equal(status.code, 0, status.err);
    assert.equal(JSON.parse(status.out).state, "unknown");
    const review = {
      receiptId: "uncertain",
      revision: 2,
      resolution:
        region === "CA" ? "provider-confirmed" : "provider-unconfirmed",
      evidence: "synthetic:external-evidence-reference",
    };
    const stale = await f.run(
      ["review"],
      JSON.stringify({ ...review, revision: 1 }),
      offline,
    );
    assert.equal(stale.code, 1);
    assert.match(stale.err, /REVISION:/);
    const reviewed = await f.run(["review"], JSON.stringify(review), offline);
    assert.equal(reviewed.code, 0, reviewed.err);
    const receipt = JSON.parse(reviewed.out);
    assert.equal(receipt.state, region === "CA" ? "confirmed" : "released");
    assert.equal(
      receipt.confirmationSource,
      region === "CA" ? "operator-evidence" : null,
    );
    const replay = await f.run(["review"], JSON.stringify(review), offline);
    assert.equal(replay.code, 0, replay.err);
    assert.deepEqual(JSON.parse(replay.out), receipt);
    const conflict = await f.run(
      ["review"],
      JSON.stringify({ ...review, evidence: "synthetic:different" }),
      offline,
    );
    assert.equal(conflict.code, 1);
    assert.match(conflict.err, /IDEMPOTENCY_CONFLICT:/);
    assert.equal(f.vault.status(f.binding).state, "disabled");
    assert.throws(() => f.app.platform.assertProviderAccess());
    for (const result of [status, stale, reviewed, replay, conflict])
      noSecrets(result);
  });
test("protected revocation refuses invalid input and disabled outbound configuration before opening a store", async (t) => {
  const f = setup(t),
    path = f.path.replace("app.db", "refused.db"),
    privateValue = "synthetic-private-input";
  const input = JSON.stringify({
    receiptId: "new",
    revision: 1,
    authority: f.authority,
  });
  const refusals: [string[], string | Buffer][] = [
    [["revoke", privateValue], input],
    [["unsupported"], input],
    [["status"], "null"],
    [["status"], "[]"],
    [["status"], "{"],
    [["status"], Buffer.from([0xc3, 0x28])],
    [["status"], "x".repeat(32769)],
    [["status"], JSON.stringify({ receiptId: "" })],
    [["status"], JSON.stringify({ receiptId: "x".repeat(129) })],
    [["status"], JSON.stringify({ receiptId: "new", accountId: privateValue })],
    [["revoke"], JSON.stringify({ receiptId: "new", revision: 1 })],
    [
      ["revoke"],
      JSON.stringify({ receiptId: "new", revision: 0, authority: f.authority }),
    ],
    [
      ["revoke"],
      JSON.stringify({ receiptId: "new", revision: 1, authority: null }),
    ],
    [
      ["revoke"],
      JSON.stringify({
        receiptId: "new",
        revision: 1,
        authority: { ...f.authority, accountId: privateValue },
      }),
    ],
    [
      ["revoke"],
      JSON.stringify({
        receiptId: "new",
        revision: 1,
        authority: { ...f.authority, disclosureHash: "bad" },
      }),
    ],
    [
      ["review"],
      JSON.stringify({
        receiptId: "new",
        revision: 2,
        resolution: "guessed",
        evidence: privateValue,
      }),
    ],
    [
      ["review"],
      JSON.stringify({
        receiptId: "new",
        revision: 2,
        resolution: "provider-confirmed",
        evidence: "",
      }),
    ],
    [
      ["review"],
      JSON.stringify({
        receiptId: "new",
        revision: 2,
        resolution: "provider-confirmed",
        evidence: "x".repeat(2001),
      }),
    ],
    [
      ["review"],
      JSON.stringify({
        receiptId: "new",
        revision: 2,
        resolution: "provider-confirmed",
        evidence: privateValue,
        token: privateValue,
      }),
    ],
  ];
  for (const [args, body] of refusals) {
    const result = await f.run(args, body, { ...enabled, DATABASE_PATH: path });
    assert.equal(result.code, 1);
    assert.equal(result.out, "");
    assert.ok(!result.err.includes(privateValue));
    noSecrets(result);
    assert.equal(existsSync(path), false);
  }
  for (const config of [
    {},
    { PROVIDERS_ENABLED: "true" },
    { ...enabled, QUICKBOOKS_CLIENT_SECRET: "\n" },
  ]) {
    const result = await f.run(["revoke"], input, {
      ...config,
      DATABASE_PATH: path,
    });
    assert.equal(result.code, 1);
    assert.equal(result.out, "");
    assert.equal(existsSync(path), false);
    noSecrets(result);
  }
  assert.equal(f.vault.status(f.binding).state, "ready");
});
test("operator revocation enforces current organization permission, revision and original receipt binding", async (t) => {
  const f = setup(t);
  for (const changes of [
    { revision: 99, authority: f.authority },
    { revision: 1, authority: { ...f.authority, revision: 99 } },
    { revision: 1, authority: { ...f.authority, realm: "9999" } },
  ]) {
    const result = await f.run(
      ["revoke"],
      JSON.stringify({ receiptId: "current", ...changes }),
      enabled,
    );
    assert.equal(result.code, 1);
    assert.equal(result.out, "");
    noSecrets(result);
    assert.equal(f.vault.status(f.binding).state, "ready");
  }
  const input = JSON.stringify({
    receiptId: "current",
    revision: 1,
    authority: f.authority,
  });
  const created = await f.run(["revoke"], input, {
    ...enabled,
    SYNTHETIC_EXPECT_REQUESTS: "1",
  });
  assert.equal(created.code, 0, created.err);
  const wrongScope = await f.run(
    ["status"],
    JSON.stringify({ receiptId: "current" }),
    { QUICKBOOKS_CLIENT_ID: "different-client" },
  );
  assert.equal(wrongScope.code, 1);
  assert.match(wrongScope.err, /CREDENTIAL_SCOPE:/);
  const confirmedReview = await f.run(
    ["review"],
    JSON.stringify({
      receiptId: "current",
      revision: 2,
      resolution: "provider-confirmed",
      evidence: "synthetic:overwrite",
    }),
  );
  assert.equal(confirmedReview.code, 1);
  assert.match(confirmedReview.err, /IDEMPOTENCY_CONFLICT:/);
});
