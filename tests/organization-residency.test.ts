import { test } from "node:test";
import { fork, type ChildProcess } from "node:child_process";
import type { LedgerJob } from "./organization-residency-child.ts";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Application } from "../src/server/application.ts";
import { createBackup, restoreBackup } from "../src/server/recovery.ts";
import { createHttp } from "../src/server/http.ts";
import { upgradeSchema, inspectSchema } from "../src/server/schema-upgrade.ts";
import { fixture, syntheticDisclosure, chooseProviders } from "./fixtures.ts";
import { type Actor, type Role } from "../src/server/core.ts";
import type {
  LedgerChoiceInput,
  LedgerDisclosureInput,
} from "../src/server/organization-residency.ts";

type Outcome = { ok: boolean; result?: unknown; code?: string; error?: string };

// Both independent applications finish initialization before either command is
// released. Completion also waits for clean child exits, not just IPC replies.
async function race(jobs: LedgerJob[]): Promise<Outcome[]> {
  const children: ChildProcess[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<Outcome[]>((resolve, reject) => {
      const ready = new Set<number>(),
        closed = new Set<number>();
      const results: Outcome[] = [],
        stderr: string[] = [];
      timer = setTimeout(
        () => reject(Error("Organization ledger process barrier timed out.")),
        20000,
      );
      for (const [index, job] of jobs.entries()) {
        const child = fork(
          new URL("./organization-residency-child.ts", import.meta.url),
          [],
          {
            execArgv: ["--import", "tsx"],
            stdio: ["ignore", "ignore", "pipe", "ipc"],
          },
        );
        children.push(child);
        stderr[index] = "";
        child.stderr?.on("data", (bytes) => {
          stderr[index] += String(bytes);
        });
        child.on("error", reject);
        child.on("message", (message: Outcome & { ready?: boolean }) => {
          if (message.ready) {
            ready.add(index);
            if (ready.size === jobs.length)
              children.forEach((worker) => worker.send({ action: "go" }));
          } else if (!ready.has(index)) {
            reject(
              Error(
                `Organization ledger child initialization failed: ${message.error}`,
              ),
            );
          } else {
            results[index] = message;
          }
        });
        child.on("close", (code, signal) => {
          if (code !== 0 || !results[index]) {
            reject(
              Error(
                `Organization ledger child ${index} closed ${code}/${signal}: ${stderr[index]}`,
              ),
            );
            return;
          }
          closed.add(index);
          if (closed.size === jobs.length) resolve(results);
        });
        child.send({ action: "init", input: job });
      }
    });
  } finally {
    clearTimeout(timer);
    children.forEach((child) => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    });
  }
}

type F = ReturnType<typeof fixture>;
const residency = (f: F) => f.app.identity.organizationResidency;
const termsInput = (
  f: F,
  previousDisclosureId: string | null = null,
  version = "synthetic-org-v1",
): LedgerDisclosureInput => {
  const { provider: _provider, ...input } = syntheticDisclosure(
    f.app,
    "quickbooks",
    previousDisclosureId,
    version,
  );
  return {
    ...input,
    purposes: "Synthetic organization stock-cost journals only",
    minimumData: [
      "Synthetic journal date, ledger accounts and amounts",
      "Source hash and idempotency reference",
    ],
  };
};
const publish = (
  f: F,
  key = "org-terms",
  previous: string | null = null,
  version = "synthetic-org-v1",
) => residency(f).publish(f.actor, key, termsInput(f, previous, version));
const input = (f: F, revision = 1, realm = "1234"): LedgerChoiceInput => {
  const terms = residency(f).current(f.actor).terms!;
  return {
    region: f.app.identity.region,
    revision,
    mode: "provider-exception",
    realm,
    acknowledgment: "Synthetic organization reviewed processor exception",
    acceptance: {
      disclosureId: terms.id,
      disclosureHash: terms.hash,
      representative: "Synthetic authorized organization representative",
      evidenceRef: "synthetic:org-acceptance",
    },
  };
};
const strict = (f: F, revision: number): LedgerChoiceInput => ({
  region: f.app.identity.region,
  revision,
  mode: "strict",
  realm: null,
  acknowledgment: "Synthetic organization withdraws future ledger permission",
});
function staff(
  f: F,
  role: Role,
  key: string = role,
  requirePasswordChange = false,
) {
  const user = f.app.identity.createUser(f.actor, `org-user-${key}`, {
    email: `org-${key}@example.test`,
    name: `Synthetic ${role}`,
    password: "long-test-only-password",
    role,
    ...(role === "buyer" ? { accountId: f.buyer } : {}),
    sites: [],
    requirePasswordChange,
  });
  return { ...f.actor, id: user.id };
}

for (const region of ["CA", "US"] as const) {
  test(`organization ${region} permission requires its own reviewed terms and exact sandbox realm`, (t) => {
    const f = fixture(t, {}, region),
      r = residency(f);
    assert.equal(r.current(f.actor).choice.revision, 1);
    assert.equal(r.current(f.actor).reason, "strict");
    assert.deepEqual(r.history(f.actor), { items: [], next: null });
    chooseProviders(f, f.actor, "buyer-exception", {
      accountId: f.buyer,
      region,
      mode: "provider-exceptions",
      providers: ["quickbooks"],
      version: 1,
      acknowledgment: "Synthetic buyer accepts",
    });
    assert.equal(
      f.app.identity.providerAllowed(f.actor, f.buyer, "quickbooks"),
      2,
    );
    assert.throws(() => r.permission(f.actor, "1234"), {
      code: "RESIDENCY_BLOCKED",
    });
    const terms = publish(f),
      choice = input(f);
    assert.equal(terms.orgId, f.actor.orgId);
    assert.equal(terms.purpose, "stock-cost-journal");
    assert.equal(terms.environment, "sandbox");
    const buyerTerms = f.app.identity.residency
      .current(f.actor)
      .find((d) => d.provider === "quickbooks")!;
    assert.throws(
      () =>
        r.choose(f.actor, "buyer-terms", {
          ...choice,
          acceptance: {
            ...choice.acceptance!,
            disclosureId: buyerTerms.id,
            disclosureHash: buyerTerms.hash,
          },
        }),
      { code: "NOT_FOUND" },
    );
    const finance = staff(f, "finance"),
      receipt = r.choose(finance, "org-accept", choice);
    assert.equal(receipt.revision, 2);
    assert.equal(receipt.recordedBy, finance.id);
    const stamp = r.permission(finance, "1234");
    assert.equal(stamp.region, region);
    assert.deepEqual(r.assertAllowed(finance, stamp), stamp);
    assert.throws(() => r.permission(finance, "9876"), {
      code: "RESIDENCY_BLOCKED",
    });
    for (const patch of [
      { orgId: "foreign" },
      { region: region === "CA" ? "US" : "CA" },
      { revision: 1 },
      { environment: "production" },
      { purpose: "invoice" },
      { disclosureHash: "a".repeat(64) },
    ])
      assert.throws(
        () => r.assertAllowed(finance, { ...stamp, ...patch } as any),
        { code: "RESIDENCY_CHANGED" },
      );
    assert.equal(
      f.app.identity.customer(f.actor, f.buyer).residency_version,
      2,
    );
    r.choose(finance, "org-strict", strict(f, 2));
    assert.throws(() => r.assertAllowed(finance, stamp), {
      code: "RESIDENCY_BLOCKED",
    });
    assert.equal(
      f.app.identity.providerAllowed(f.actor, f.buyer, "quickbooks"),
      2,
    );
    assert.deepEqual(
      r.choose(finance, "org-accept", choice),
      receipt,
      "exact historical retry does not restore active permission",
    );
    assert.equal(r.current(finance).choice.mode, "strict");
    r.choose(finance, "new-accept", input(f, 3));
    assert.throws(
      () => r.assertAllowed(finance, stamp),
      { code: "RESIDENCY_CHANGED" },
      "later acceptance never revives an old effect stamp",
    );
    assert.deepEqual(
      r.history(finance).items.map((c) => c.revision),
      [4, 3, 2],
    );
  });

  test(`organization ${region} term replacement, withdrawal, exact receipts and restart retain history`, (t) => {
    const f = fixture(t, {}, region),
      r = residency(f),
      first = publish(f),
      accepted = r.choose(f.actor, "accept", input(f)),
      stamp = r.permission(f.actor, "1234");
    const next = publish(f, "update", first.id, "synthetic-org-v2");
    assert.equal(r.current(f.actor).reason, "terms-changed");
    assert.throws(() => r.assertAllowed(f.actor, stamp), {
      code: "RESIDENCY_BLOCKED",
    });
    assert.deepEqual(
      r.choose(f.actor, "accept", inputFrom(accepted)),
      accepted,
    );
    assert.equal(
      r.history(f.actor).items[0]!.acceptance?.disclosureId,
      first.id,
    );
    assert.deepEqual(r.disclosure(f.actor, first.id), first);
    r.choose(f.actor, "accept-current", input(f, 2));
    const withdrawal = r.withdrawDisclosure(f.actor, "withdraw", {
      disclosureId: next.id,
      reason: "Synthetic terms no longer qualified",
    });
    assert.equal(r.current(f.actor).reason, "terms-unavailable");
    assert.throws(() => r.permission(f.actor, "1234"), {
      code: "RESIDENCY_BLOCKED",
    });
    const third = publish(f, "new-terms", null, "synthetic-org-v3");
    assert.deepEqual(
      r.withdrawDisclosure(f.actor, "withdraw", {
        disclosureId: next.id,
        reason: "Synthetic terms no longer qualified",
      }),
      withdrawal,
    );
    assert.equal(
      r.current(f.actor).terms?.id,
      third.id,
      "retry withdrawal cannot withdraw new terms",
    );
    assert.deepEqual(
      r.publish(f.actor, "org-terms", termsInput(f)),
      first,
      "retry publication cannot restore an old head",
    );
    assert.equal(r.current(f.actor).terms?.id, third.id);
    const before = r.current(f.actor),
      history = r.history(f.actor);
    const reopened = new Application(f.path, region);
    try {
      assert.deepEqual(
        reopened.identity.organizationResidency.current(f.actor),
        before,
      );
      assert.deepEqual(
        reopened.identity.organizationResidency.history(f.actor),
        history,
      );
    } finally {
      reopened.close();
    }
  });
}
function inputFrom(
  receipt: ReturnType<ReturnType<typeof residency>["choose"]>,
): LedgerChoiceInput {
  return {
    region: receipt.region,
    revision: receipt.revision - 1,
    mode: receipt.mode,
    realm: receipt.realm,
    acknowledgment: receipt.acknowledgment!,
    ...(receipt.acceptance ? { acceptance: receipt.acceptance } : {}),
  };
}

test("native choices reject incomplete acceptance, stale revisions, regional changes and buyer-shaped permissions", (t) => {
  const f = fixture(t),
    r = residency(f),
    terms = publish(f),
    valid = input(f);
  for (const patch of [
    { acceptance: undefined },
    { acceptance: { ...valid.acceptance!, representative: " " } },
    { acceptance: { ...valid.acceptance!, evidenceRef: " " } },
    { acceptance: { ...valid.acceptance!, disclosureHash: "a".repeat(64) } },
    { realm: "01234" },
    { realm: "1234/extra" },
    { realm: null },
    { mode: "strict" },
    { region: "US" },
    { revision: 0 },
    { revision: 1.2 },
  ])
    assert.throws(() =>
      r.choose(f.actor, "invalid", { ...valid, ...patch } as any),
    );
  assert.equal(r.current(f.actor).choice.revision, 1);
  assert.equal(r.history(f.actor).items.length, 0);
  r.choose(f.actor, "valid", valid);
  assert.throws(() => r.choose(f.actor, "valid", { ...valid, realm: "5678" }), {
    code: "IDEMPOTENCY_CONFLICT",
  });
  assert.throws(() => r.choose(f.actor, "stale", strict(f, 1)), {
    code: "REVISION",
  });
  assert.throws(
    () => r.publish(f.actor, "bad-head", termsInput(f, null, "new")),
    { code: "REVISION" },
  );
  assert.throws(
    () => r.publish(f.actor, "reused-version", termsInput(f, terms.id)),
    { code: "DISCLOSURE_VERSION" },
  );
  assert.throws(
    () =>
      r.withdrawDisclosure(f.actor, "bad-withdraw", {
        disclosureId: "foreign",
        reason: "Test",
      }),
    { code: "NOT_FOUND" },
  );
});

test("current organization principal controls reads, mutations and historical retries before cached results", (t) => {
  const f = fixture(t),
    r = residency(f),
    terms = publish(f),
    valid = input(f),
    finance = staff(f, "finance");
  r.choose(finance, "accept", valid);
  for (const role of [
    "buyer",
    "commercial",
    "warehouse",
    "warranty",
    "support",
  ] as const) {
    const forged = staff(f, role);
    for (const run of [
      () => r.current(forged),
      () => r.history(forged),
      () => r.disclosure(forged, terms.id),
      () => r.choose(forged, "accept", valid),
      () => r.permission(forged, "1234"),
      () => r.publish(forged, "publish", termsInput(f, terms.id, "new")),
      () =>
        r.withdrawDisclosure(forged, "withdraw", {
          disclosureId: terms.id,
          reason: "Test",
        }),
    ])
      assert.throws(run, { code: "FORBIDDEN" });
  }
  assert.throws(
    () => r.publish(finance, "publish", termsInput(f, terms.id, "new")),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () =>
      r.withdrawDisclosure(finance, "withdraw", {
        disclosureId: terms.id,
        reason: "Test",
      }),
    { code: "FORBIDDEN" },
  );
  const password = staff(f, "finance", "password", true);
  assert.throws(() => r.current(password), {
    code: "PASSWORD_CHANGE_REQUIRED",
  });
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='support' WHERE id=?", finance.id);
  assert.throws(
    () => r.choose({ ...finance, role: "admin" }, "accept", valid),
    { code: "FORBIDDEN" },
  );
  assert.throws(() => r.permission(finance, "1234"), { code: "FORBIDDEN" });
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_users SET role='finance',account_id=? WHERE id=?",
      f.buyer,
      finance.id,
    );
  assert.throws(() => r.current(finance), { code: "FORBIDDEN" });
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET active=0 WHERE id=?", finance.id);
  assert.throws(() => r.choose(finance, "accept", valid), {
    code: "FORBIDDEN",
  });
});

test("organization scopes reject foreign terms, authority and history cursors", (t) => {
  const a = fixture(t),
    b = fixture(t),
    first = publish(a),
    foreign = publish(b);
  const r = residency(a),
    valid = input(a);
  assert.throws(() => r.disclosure(a.actor, foreign.id), { code: "NOT_FOUND" });
  assert.throws(
    () =>
      r.choose(a.actor, "foreign", {
        ...valid,
        acceptance: {
          ...valid.acceptance!,
          disclosureId: foreign.id,
          disclosureHash: foreign.hash,
        },
      }),
    { code: "NOT_FOUND" },
  );
  assert.throws(() => r.current({ ...a.actor, orgId: b.actor.orgId }), {
    code: "FORBIDDEN",
  });
  // A second organization in the same regional store is the important isolation boundary.
  const other = b.actor,
    organization = b.app.identity.organization(other),
    user = b.app.database
      .owned("iam")
      .get("SELECT * FROM iam_users WHERE id=?", other.id)!;
  a.app.database
    .owned("iam")
    .run(
      "INSERT INTO iam_organizations VALUES(?,?,?,?,?)",
      organization.id,
      organization.name,
      organization.region,
      organization.currency,
      organization.policy,
    );
  a.app.database
    .owned("iam")
    .run(
      "INSERT INTO iam_users(id,org_id,email,name,account_id,role,sites,salt,password_hash,active) VALUES(?,?,?,?,?,?,?,?,?,?)",
      user.id!,
      user.org_id!,
      "other@example.test",
      user.name!,
      user.account_id!,
      user.role!,
      user.sites!,
      user.salt!,
      user.password_hash!,
      user.active!,
    );
  assert.throws(() => r.disclosure(other, first.id), { code: "NOT_FOUND" });
  assert.equal(r.current(other).terms, null);
  r.choose(a.actor, "strict", strict(a, 1));
  assert.throws(() => r.history(other, 2), { code: "CURSOR" });
  assert.throws(() => r.history(a.actor, 1), { code: "VALIDATION" });
  assert.throws(() => r.history(a.actor, 99), { code: "CURSOR" });
});

test("late audit failures atomically roll back terms, choices and durable command receipts", (t) => {
  const f = fixture(t),
    r = residency(f),
    terms = publish(f),
    valid = input(f);
  const before = r.current(f.actor),
    beforeHistory = r.history(f.actor);
  const mock = t.mock.method(f.app.platform, "audit", () => {
    throw new Error("synthetic late audit failure");
  });
  for (const run of [
    () =>
      r.publish(f.actor, "rollback-publish", termsInput(f, terms.id, "new")),
    () => r.choose(f.actor, "rollback-choice", valid),
    () =>
      r.withdrawDisclosure(f.actor, "rollback-withdraw", {
        disclosureId: terms.id,
        reason: "Test",
      }),
  ])
    assert.throws(run, /synthetic late audit failure/);
  mock.mock.restore();
  assert.deepEqual(r.current(f.actor), before);
  assert.deepEqual(r.history(f.actor), beforeHistory);
  const commands = f.app.database
    .owned("platform")
    .get(
      "SELECT COUNT(*) AS n FROM platform_commands WHERE key LIKE 'rollback-%'",
    );
  assert.equal(commands!.n, 0);
  const accepted = r.choose(f.actor, "rollback-choice", valid);
  assert.equal(accepted.revision, 2);
});

test("paged history retains every strict choice and accepted company without timestamp ordering", (t) => {
  const f = fixture(t),
    r = residency(f);
  publish(f);
  for (let rev = 1; rev <= 45; rev++)
    r.choose(
      f.actor,
      `choice-${rev}`,
      rev % 2 ? input(f, rev, String(1000 + rev)) : strict(f, rev),
    );
  const all: number[] = [];
  let after: number | undefined;
  do {
    const page = r.history(f.actor, after);
    assert.ok(page.items.length <= 20);
    all.push(...page.items.map((i) => i.revision));
    after = page.next ?? undefined;
  } while (after);
  assert.deepEqual(
    all,
    Array.from({ length: 45 }, (_, i) => 46 - i),
  );
  assert.equal(new Set(all).size, all.length);
  assert.equal(r.current(f.actor).choice.realm, "1045");
});

test("tampered disclosure and choice bytes refuse current authority and retain old evidence", (t) => {
  const f = fixture(t),
    r = residency(f),
    terms = publish(f);
  r.choose(f.actor, "accept", input(f));
  const db = f.app.database.owned("iam");
  db.run(
    "UPDATE iam_ledger_disclosures SET body=? WHERE id=?",
    JSON.stringify({ ...terms, purposes: "forged" }),
    terms.id,
  );
  assert.throws(() => r.permission(f.actor, "1234"), {
    code: "DISCLOSURE_INTEGRITY",
  });
  const g = fixture(t),
    s = residency(g);
  publish(g);
  s.choose(g.actor, "accept", input(g));
  g.app.database
    .owned("iam")
    .run(
      "UPDATE iam_ledger_choices SET realm='5678' WHERE org_id=?",
      g.actor.orgId,
    );
  assert.throws(() => s.current(g.actor), { code: "CONSENT_INTEGRITY" });
  assert.throws(() => s.history(g.actor), { code: "CONSENT_INTEGRITY" });
});

for (const region of ["CA", "US"] as const)
  test(`organization ${region} consent survives exact schema clone and encrypted restore while provider hold stays effective`, async (t) => {
    const f = fixture(t, {}, region),
      r = residency(f);
    publish(f);
    r.choose(f.actor, "accept", input(f));
    const stamp = r.permission(f.actor, "1234"),
      current = r.current(f.actor),
      history = r.history(f.actor),
      root = dirname(f.path);
    const clonePath = join(root, "clone.db");
    await upgradeSchema(
      f.path,
      clonePath,
      inspectSchema(f.path).schemaHash,
      region,
    );
    const clone = new Application(clonePath, region);
    try {
      assert.deepEqual(
        clone.identity.organizationResidency.current(f.actor),
        current,
      );
      assert.deepEqual(
        clone.identity.organizationResidency.history(f.actor),
        history,
      );
      assert.deepEqual(
        clone.identity.organizationResidency.assertAllowed(f.actor, stamp),
        stamp,
      );
    } finally {
      clone.close();
    }
    const archive = join(root, "archive.backup"),
      restoredPath = join(root, "restored.db"),
      key = randomBytes(32);
    await createBackup(f.path, archive, region, key);
    r.choose(f.actor, "later-withdrawal", strict(f, 2));
    await restoreBackup(archive, restoredPath, region, key);
    // Inspect immutable evidence before constructors; restore cannot erase saved acceptance.
    const raw = new DatabaseSync(restoredPath, { readOnly: true });
    try {
      assert.equal(
        raw
          .prepare("SELECT revision FROM iam_ledger_choices WHERE org_id=?")
          .get(f.actor.orgId)!.revision,
        2,
      );
      assert.equal(
        raw.prepare("SELECT COUNT(*) AS n FROM platform_recovery").get()!.n,
        1,
      );
    } finally {
      raw.close();
    }
    const restored = new Application(restoredPath, region);
    try {
      assert.deepEqual(
        restored.identity.organizationResidency.current(f.actor),
        current,
      );
      assert.deepEqual(
        restored.identity.organizationResidency.history(f.actor),
        history,
      );
      assert.throws(
        () =>
          restored.identity.organizationResidency.assertAllowed(f.actor, stamp),
        { code: "RECOVERY_HOLD" },
      );
      assert.equal(r.current(f.actor).choice.mode, "strict");
    } finally {
      restored.close();
    }
  });

test("organization HTTP rejects cross-scope extensions, buyer authority, invalid cursors and missing CSRF", async (t) => {
  const f = fixture(t),
    r = residency(f);
  const buyer = staff(f, "buyer"),
    finance = staff(f, "finance");
  const origin = "http://127.0.0.1:3000",
    http = await createHttp(f.app, {
      origin,
      staticRoot: "/nonexistent-distributor-test",
    });
  t.after(() => http.close());
  const login = async (email: string) => {
    const reply = await http.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: { email, password: "long-test-only-password" },
    });
    assert.equal(reply.statusCode, 200, reply.body);
    return {
      origin,
      cookie: `${reply.cookies[0]!.name}=${reply.cookies[0]!.value}`,
      "x-csrf-token": reply.json().csrf,
      "idempotency-key": "org-http",
    };
  };
  const adminHeaders = await login("admin@example.test"),
    buyerHeaders = await login("org-buyer@example.test"),
    financeHeaders = await login("org-finance@example.test");
  const send = (command: string, payload: unknown, headers = adminHeaders) =>
    http.inject({
      method: "POST",
      url: `/api/commands/${command}`,
      headers,
      payload: payload as any,
    });
  const get = (url: string, headers = adminHeaders) =>
    http.inject({ url, headers });
  const publishCommand = "organization.ledger-disclosure.publish",
    chooseCommand = "organization.ledger-residency.choose";
  assert.equal(
    (await send(publishCommand, termsInput(f), financeHeaders)).statusCode,
    403,
  );
  assert.equal(
    (await send(publishCommand, { ...termsInput(f), provider: "quickbooks" }))
      .statusCode,
    400,
  );
  assert.equal(
    (
      await send(publishCommand, termsInput(f), {
        ...adminHeaders,
        "x-csrf-token": "bad",
      })
    ).statusCode,
    403,
  );
  const published = await send(publishCommand, termsInput(f));
  assert.equal(published.statusCode, 200, published.body);
  const valid = input(f);
  assert.equal(
    (await send(chooseCommand, valid, buyerHeaders)).statusCode,
    403,
  );
  assert.equal(
    (
      await send(
        chooseCommand,
        { ...valid, accountId: f.buyer },
        financeHeaders,
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await send(
        chooseCommand,
        { ...valid, acceptance: { ...valid.acceptance!, basis: "buyer" } },
        financeHeaders,
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await send(chooseCommand, valid, {
        ...financeHeaders,
        "x-csrf-token": "bad",
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await send(chooseCommand, valid, financeHeaders)).statusCode,
    200,
  );
  assert.equal(
    (await send(chooseCommand, valid, financeHeaders)).statusCode,
    200,
  );
  for (const path of [
    "/api/organization/ledger-residency",
    "/api/organization/ledger-residency/history",
    `/api/organization/ledger-disclosures/${published.json().id}`,
  ]) {
    assert.equal((await get(path, buyerHeaders)).statusCode, 403);
    assert.equal((await get(path, financeHeaders)).statusCode, 200);
    assert.equal(
      (await get(path + "?accountId=" + f.buyer, financeHeaders)).statusCode,
      400,
    );
  }
  for (const after of ["1", "0", "1.5", "999", "NaN"])
    assert.equal(
      (
        await get(
          `/api/organization/ledger-residency/history?after=${after}`,
          financeHeaders,
        )
      ).statusCode,
      400,
    );
  assert.deepEqual(
    (
      await get(
        "/api/organization/ledger-residency/history?after=2",
        financeHeaders,
      )
    ).json(),
    { items: [], next: null },
  );
  const choice = (
    await get("/api/organization/ledger-residency", financeHeaders)
  ).json();
  assert.equal(choice.choice.recordedBy, finance.id);
  assert.equal(choice.allowed, true);
  const withdrawn = await send("organization.ledger-disclosure.withdraw", {
    disclosureId: published.json().id,
    reason: "Synthetic HTTP withdrawal",
  });
  assert.equal(withdrawn.statusCode, 200, withdrawn.body);
  assert.equal(r.current(f.actor).reason, "terms-unavailable");
  assert.throws(() => r.current({ ...buyer, role: "admin" } as Actor), {
    code: "FORBIDDEN",
  });
});

for (const region of ["CA", "US"] as const) {
  test(`organization ${region} independent applications share one exact consent receipt`, async (t) => {
    const f = fixture(t, {}, region);
    publish(f);
    const job: LedgerJob = {
      path: f.path,
      region,
      actor: f.actor,
      key: "same-consent",
      operation: "choose",
      payload: input(f),
    };
    const results = await race([job, job]);
    assert.equal(
      results.every((r) => r.ok),
      true,
    );
    assert.deepEqual(results[0]!.result, results[1]!.result);
    assert.equal(residency(f).history(f.actor).items.length, 1);
    assert.equal(residency(f).permission(f.actor, "1234").revision, 2);
  });
  test(`organization ${region} concurrent different choices cannot overwrite one reviewed revision`, async (t) => {
    const f = fixture(t, {}, region);
    publish(f);
    const base = {
      path: f.path,
      region,
      actor: f.actor,
      operation: "choose" as const,
    };
    const results = await race([
      { ...base, key: "exception-race", payload: input(f) },
      { ...base, key: "strict-race", payload: strict(f, 1) },
    ]);
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(results.find((r) => !r.ok)!.code, "REVISION");
    assert.equal(residency(f).history(f.actor).items.length, 1);
    const state = residency(f).current(f.actor);
    assert.equal(state.choice.revision, 2);
    assert.equal(state.allowed, results[0]!.ok);
  });
  for (const operation of ["withdraw", "publish"] as const)
    test(`organization ${region} concurrent ${operation} and acceptance cannot retain current permission for obsolete terms`, async (t) => {
      const f = fixture(t, {}, region),
        terms = publish(f),
        choice = input(f);
      const base = { path: f.path, region, actor: f.actor };
      const termsJob: LedgerJob =
        operation === "withdraw"
          ? {
              ...base,
              key: "term-race",
              operation,
              payload: {
                disclosureId: terms.id,
                reason: "Synthetic review withdrawn",
              },
            }
          : {
              ...base,
              key: "term-race",
              operation,
              payload: termsInput(f, terms.id, "synthetic-new-race"),
            };
      const results = await race([
        { ...base, key: "choose-race", operation: "choose", payload: choice },
        termsJob,
      ]);
      assert.equal(results[1]!.ok, true);
      if (!results[0]!.ok) assert.equal(results[0]!.code, "DISCLOSURE_CHANGED");
      assert.equal(residency(f).current(f.actor).allowed, false);
      assert.throws(() => residency(f).permission(f.actor, "1234"), {
        code: "RESIDENCY_BLOCKED",
      });
      assert.deepEqual(residency(f).disclosure(f.actor, terms.id), terms);
      assert.equal(
        residency(f).history(f.actor).items.length,
        results[0]!.ok ? 1 : 0,
      );
    });
}
