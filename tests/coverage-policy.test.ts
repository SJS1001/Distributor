import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fork, type ChildProcess } from "node:child_process";
import { fixture, accept, ship } from "./fixtures.ts";
import { warrantyUser, warrantyGrants } from "./warranty-authority-fixtures.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import { createBackup, restoreBackup } from "../src/server/recovery.ts";
import { readCoveragePolicy } from "../src/server/coverage-policy.ts";
import type { Actor } from "../src/server/core.ts";
type F = ReturnType<typeof fixture>;
function sold(f: F) {
  const shipment = ship(f, accept(f).id);
  // Simulate a pre-version-six sale: no historical handover policy was retained.
  f.app.database
    .owned("fulfillment")
    .run("DELETE FROM fulfillment_coverage WHERE shipment_id=?", shipment.id);
  f.app.database
    .owned("fulfillment")
    .run(
      "UPDATE fulfillment_shipments SET shipped_at=? WHERE id=?",
      "2024-02-29T12:00:00.000Z",
      shipment.id,
    );
  return f.app.inventory.trace(f.actor, "S1").unit.id;
}
function input(f: F, unitId: string, policyRevision?: number) {
  return {
    accountId: f.buyer,
    unitId,
    type: "warranty" as const,
    issue: "Synthetic failed unit",
    evidence: "Synthetic evidence",
    ...(policyRevision === undefined ? {} : { policyRevision }),
  };
}
function configure(f: F, days = 730, revision = 1, key = "policy") {
  return f.app.identity.configureCoverage(f.actor, key, {
    days,
    revision,
    reason: "Synthetic reviewed duration",
  });
}
function facts(f: F) {
  return (
    [
      "iam",
      "warranty",
      "platform",
      "inventory",
      "fulfillment",
      "billing",
    ] as const
  ).map((owner) => {
    const store = f.app.database.owned(owner);
    return store
      .all<{ name: string }>(
        "SELECT name FROM sqlite_schema WHERE type='table' AND name GLOB ? ORDER BY name",
        `${owner}_*`,
      )
      .map(({ name }) => store.all(`SELECT * FROM ${name} ORDER BY rowid`));
  });
}
function replace(f: F, claimId: string) {
  f.app.warranty.review(f.actor, "review", {
    claimId,
    approved: true,
    reason: "Synthetic review",
  });
  f.app.warranty.receive(f.actor, "receive", {
    claimId,
    warehouseId: f.w1,
    bin: "Q",
    serial: "S1",
  });
  f.app.warranty.inspect(f.actor, "inspect", {
    claimId,
    findings: "Synthetic inspection",
  });
  const newUnitId = f.app.inventory.trace(f.actor, "S2").unit.id;
  const r = f.app.warranty.reserveReplacement(f.actor, "reserve", {
    claimId,
    newUnitId,
    oldDisposition: "scrap",
    coveragePolicy: "inherit_original",
    reason: "Synthetic replacement",
  });
  f.app.warranty.handoverReplacement(f.actor, "handover", {
    replacementId: r.id,
    revision: 1,
    serial: "S2",
    recipient: "Synthetic owner",
    evidence: "Synthetic receipt",
  });
  return newUnitId;
}

test("reviewed duration persists, preserves other organization policy and replays exactly across subsequent revisions", (t) => {
  const f = fixture(t),
    unitId = sold(f);
  f.app.identity.configureCountReview(f.actor, "count-policy", {
    mode: "independent",
    revision: 1,
    reason: "Synthetic duties",
  });
  const original = JSON.parse(f.app.identity.organization(f.actor).policy);
  assert.deepEqual(f.app.identity.coveragePolicy(f.actor), {
    revision: 1,
    days: 365,
    configuredAt: null,
    reason: null,
    configuredBy: null,
  });
  const first = configure(f);
  assert.equal(first.revision, 2);
  assert.equal(first.configuredBy, f.actor.id);
  assert.equal(
    f.app.warranty.coverage(f.actor, unitId, f.buyer).coverageEnd,
    "2026-02-28T12:00:00.000Z",
  );
  const selected = JSON.parse(f.app.identity.organization(f.actor).policy);
  delete selected.warrantyCoverage;
  assert.deepEqual(selected, original);
  configure(f, 0, 2, "next");
  assert.deepEqual(configure(f), first);
  assert.throws(() => configure(f, 731), { code: "IDEMPOTENCY_CONFLICT" });
  assert.throws(() => configure(f, 100, 1, "stale"), { code: "REVISION" });
  f.app.close();
  f.app = new Application(f.path);
  assert.equal(f.app.identity.coveragePolicy(f.actor).days, 0);
  assert.equal(
    f.app.warranty.coverage(f.actor, unitId, f.buyer).coverageEnd,
    "2024-02-29T12:00:00.000Z",
  );
  assert.deepEqual(configure(f), first);
  assert.equal(
    f.app.platform
      .events(f.actor)
      .filter((e) => e.type === "WarrantyCoveragePolicyChanged").length,
    2,
  );
});

test("claims require the current reviewed version and retain immutable submission-time policy across changes, reads, retry and restart", (t) => {
  const f = fixture(t),
    unitId = sold(f);
  const policy = configure(f);
  const before = facts(f);
  for (const revision of [undefined, 1, 3])
    assert.throws(
      () =>
        f.app.warranty.submit(
          f.actor,
          `stale-${revision}`,
          input(f, unitId, revision),
        ),
      { code: "REVISION" },
    );
  assert.throws(
    () =>
      f.app.warranty.submit(f.actor, "invalid-revision", input(f, unitId, 2.5)),
    { code: "VALIDATION" },
  );
  assert.deepEqual(facts(f), before);
  const payload = input(f, unitId, 2),
    c = f.app.warranty.submit(f.actor, "claim", payload);
  const retained = f.app.warranty.claimCoverage(f.actor, c.id);
  assert.deepEqual(retained.snapshot?.policy, {
    revision: 2,
    days: 730,
    configuredAt: policy.configuredAt,
  });
  assert.equal(retained.snapshot?.shippedAt, "2024-02-29T12:00:00.000Z");
  assert.equal(retained.snapshot?.source, "current_provisional_policy");
  assert.equal(retained.snapshot?.inheritedFromClaimId, null);
  assert.equal(retained.coverageEnd, "2026-02-28T12:00:00.000Z");
  assert.equal(retained.coveragePolicyApproved, false);
  assert.equal(retained.eligibility, "requires_review");
  configure(f, 30, 2, "change-after-claim");
  assert.equal(
    f.app.warranty.coverage(f.actor, unitId, f.buyer).coverageEnd,
    "2024-03-30T12:00:00.000Z",
  );
  assert.deepEqual(f.app.warranty.submit(f.actor, "claim", payload), c);
  assert.deepEqual(f.app.warranty.claimCoverage(f.actor, c.id), retained);
  const unchanged = facts(f);
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(f.app.warranty.claimCoverage(f.actor, c.id), retained);
  assert.deepEqual(facts(f), unchanged);
});

test("replacement claims inherit original policy and end even after current policy changes", (t) => {
  const f = fixture(t),
    unitId = sold(f);
  configure(f);
  const c = f.app.warranty.submit(f.actor, "claim", input(f, unitId, 2));
  const newUnitId = replace(f, c.id);
  configure(f, 30, 2, "change");
  const preview = f.app.warranty.coverage(f.actor, newUnitId, f.buyer);
  assert.equal(preview.policy?.revision, 2);
  assert.equal(preview.coverageEnd, "2026-02-28T12:00:00.000Z");
  assert.throws(
    () => f.app.warranty.submit(f.actor, "wrong", input(f, newUnitId, 3)),
    { code: "REVISION" },
  );
  const next = f.app.warranty.submit(f.actor, "next", input(f, newUnitId, 2));
  const retained = f.app.warranty.claimCoverage(f.actor, next.id);
  assert.equal(retained.snapshot?.inheritedFromClaimId, c.id);
  assert.equal(retained.snapshot?.source, "replacement_inherited");
  assert.deepEqual(
    retained.snapshot?.policy,
    f.app.warranty.claimCoverage(f.actor, c.id).snapshot?.policy,
  );
  assert.equal(retained.coverageEnd, c.coverageEnd);
});

test("legacy claims explicitly lack provenance and their replacement claims do not invent a current policy", (t) => {
  const f = fixture(t),
    unitId = sold(f);
  const c = f.app.warranty.submit(f.actor, "legacy", input(f, unitId));
  // Simulate a version-four claim conserved by a fresh-file upgrade.
  f.app.database
    .owned("warranty")
    .run("DELETE FROM warranty_claim_coverage WHERE claim_id=?", c.id);
  assert.equal(f.app.warranty.claimCoverage(f.actor, c.id).snapshot, null);
  configure(f);
  const replacement = replace(f, c.id);
  assert.equal(
    f.app.warranty.coverage(f.actor, replacement, f.buyer).policy,
    null,
  );
  const next = f.app.warranty.submit(
    f.actor,
    "legacy-replacement",
    input(f, replacement),
  );
  const retained = f.app.warranty.claimCoverage(f.actor, next.id);
  assert.equal(retained.snapshot?.policy, null);
  assert.equal(retained.snapshot?.inheritedFromClaimId, c.id);
  assert.equal(retained.coverageEnd, c.coverageEnd);
});

test("fresh grants, password changes and buyer account boundaries apply before historical policy and claim replay", (t) => {
  const f = fixture(t),
    unitId = sold(f),
    setter = warrantyUser(f, "admin"),
    buyer = warrantyUser(f, "buyer");
  const p = {
    days: 730,
    revision: 1,
    reason: "Synthetic private reviewer reason",
  };
  f.app.identity.configureCoverage(setter, "saved", p);
  const payload = input(f, unitId, 2),
    c = f.app.warranty.submit(buyer, "saved-claim", payload);
  assert.equal(
    f.app.warranty.claimCoverage(buyer, c.id).snapshot?.policy?.revision,
    2,
  );
  warrantyGrants(f, setter, { role: "commercial" });
  assert.throws(
    () =>
      f.app.identity.configureCoverage(
        { ...setter, role: "admin" },
        "saved",
        p,
      ),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () =>
      f.app.identity.configureCoverage(
        { ...buyer, role: "admin" },
        "forged",
        p,
      ),
    { code: "FORBIDDEN" },
  );
  const other = f.app.identity.createCustomer(f.actor, "other", {
    name: "Other",
    tier: "standard",
    creditLimit: 10000,
  }).id;
  warrantyGrants(f, buyer, { accountId: other });
  for (const operation of [
    () => f.app.warranty.claimCoverage({ ...buyer, accountId: f.buyer }, c.id),
    () => f.app.warranty.submit(buyer, "saved-claim", payload),
  ])
    assert.throws(operation, { code: "FORBIDDEN" });
  warrantyGrants(f, buyer, { active: false });
  assert.throws(() => f.app.identity.coveragePolicy(buyer), {
    code: "FORBIDDEN",
  });
  const restricted = warrantyUser(f, "admin");
  f.app.identity.resetPassword(f.actor, "reset", {
    userId: restricted.id,
    revision: 1,
    password: "changed-test-only-password",
    currentPassword: "long-test-only-password",
    reason: "Synthetic reset",
  });
  for (const operation of [
    () => f.app.identity.coveragePolicy(restricted),
    () => f.app.identity.configureCoverage(restricted, "restricted", p),
    () => f.app.warranty.claimCoverage(restricted, c.id),
  ])
    assert.throws(operation, { code: "PASSWORD_CHANGE_REQUIRED" });
});

test("invalid durations, reasons and malformed saved policies fail before any facts change", (t) => {
  const f = fixture(t);
  const before = facts(f);
  for (const days of [-1, 36501, 1.5, "365", null])
    assert.throws(
      () =>
        f.app.identity.configureCoverage(f.actor, "invalid", {
          days: days as number,
          revision: 1,
          reason: "Synthetic",
        }),
      { code: "COVERAGE_POLICY" },
    );
  assert.throws(() =>
    f.app.identity.configureCoverage(f.actor, "blank", {
      days: 365,
      revision: 1,
      reason: " ",
    }),
  );
  assert.deepEqual(facts(f), before);
  for (const saved of [
    null,
    {},
    [],
    {
      revision: 2,
      days: 365,
      configuredAt: "bad",
      reason: "Synthetic",
      configuredBy: f.actor.id,
    },
  ])
    assert.throws(() =>
      readCoveragePolicy({ coverageDays: 365, warrantyCoverage: saved }),
    );
});

test("late audit failures roll back selected policy or claim, snapshot, events and retry receipts atomically", (t) => {
  const f = fixture(t),
    unitId = sold(f);
  const store = f.app.database.owned("platform");
  for (const action of ["warranty.policy", "warranty.submit"]) {
    const before = facts(f);
    store.migrate(
      `CREATE TRIGGER platform_coverage_fault BEFORE INSERT ON platform_audit WHEN new.action='${action}' BEGIN SELECT RAISE(ABORT,'synthetic coverage audit failure'); END;`,
    );
    const operation =
      action === "warranty.policy"
        ? () => configure(f)
        : () => f.app.warranty.submit(f.actor, "claim", input(f, unitId, 2));
    assert.throws(operation, /synthetic coverage audit failure/);
    assert.deepEqual(facts(f), before);
    store.migrate("DROP TRIGGER platform_coverage_fault;");
    operation();
  }
  assert.equal(
    f.app.database
      .owned("warranty")
      .all("SELECT * FROM warranty_claim_coverage").length,
    1,
  );
});

test("malformed retained policy, arithmetic and replacement lineage fail closed without changing facts", (t) => {
  const f = fixture(t),
    unitId = sold(f);
  configure(f);
  const claim = f.app.warranty.submit(f.actor, "claim", input(f, unitId, 2));
  const retained = f.app.warranty.claimCoverage(f.actor, claim.id).snapshot!;
  const store = f.app.database.owned("warranty");
  const corrupt = (claimId: string, value: unknown) =>
    store.run(
      "UPDATE warranty_claim_coverage SET snapshot=? WHERE claim_id=?",
      JSON.stringify(value),
      claimId,
    );
  for (const changed of [
    { ...retained, policy: { ...retained.policy, days: 731 } },
    { ...retained, policy: { ...retained.policy, revision: 1 } },
    { ...retained, shippedAt: "2024-02-30T12:00:00.000Z" },
    { ...retained, coverageEnd: "2026-03-01T12:00:00.000Z" },
    { ...retained, inheritedFromClaimId: claim.id },
    { ...retained, policy: null },
  ]) {
    corrupt(claim.id, changed);
    const before = facts(f);
    assert.throws(() => f.app.warranty.claimCoverage(f.actor, claim.id));
    assert.deepEqual(facts(f), before);
  }
  corrupt(claim.id, retained);
  const replacement = replace(f, claim.id);
  const next = f.app.warranty.submit(
    f.actor,
    "replacement-claim",
    input(f, replacement, 2),
  );
  const inherited = f.app.warranty.claimCoverage(f.actor, next.id).snapshot!;
  for (const parent of [next.id, "nonexistent-predecessor"]) {
    corrupt(next.id, { ...inherited, inheritedFromClaimId: parent });
    const before = facts(f);
    assert.throws(() => f.app.warranty.claimCoverage(f.actor, next.id), {
      code: "COVERAGE_POLICY",
    });
    assert.deepEqual(facts(f), before);
  }
  corrupt(next.id, inherited);
  assert.deepEqual(
    f.app.warranty.claimCoverage(f.actor, next.id).snapshot,
    inherited,
  );
});

test("encrypted restore retains policy and historical claim snapshot independently of changed current assessment", async (t) => {
  const f = fixture(t),
    unitId = sold(f);
  configure(f);
  const c = f.app.warranty.submit(f.actor, "claim", input(f, unitId, 2));
  const retained = f.app.warranty.claimCoverage(f.actor, c.id);
  const policy = configure(f, 30, 2, "change");
  const archive = join(dirname(f.path), "coverage.backup"),
    target = join(dirname(f.path), "restored.db"),
    key = randomBytes(32);
  await createBackup(f.path, archive, "CA", key);
  await restoreBackup(archive, target, "CA", key);
  const app = new Application(target);
  t.after(() => app.close());
  assert.deepEqual(app.identity.coveragePolicy(f.actor), policy);
  assert.deepEqual(app.warranty.claimCoverage(f.actor, c.id), retained);
  assert.deepEqual(
    app.warranty.submit(f.actor, "claim", input(f, unitId, 2)),
    c,
  );
});

test("HTTP coverage policy and snapshots enforce strict requests, CSRF, private projections and current account authority", async (t) => {
  const f = fixture(t),
    unitId = sold(f),
    buyer = warrantyUser(f, "buyer");
  const origin = "http://localhost",
    http = await createHttp(f.app, { origin });
  t.after(() => http.close());
  const login = async (email: string, password: string) => {
    const r = await http.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: { email, password },
    });
    assert.equal(r.statusCode, 200);
    return {
      origin,
      cookie: String(r.headers["set-cookie"]).split(";")[0]!,
      "x-csrf-token": r.json().csrf,
      "idempotency-key": "http-policy",
    };
  };
  const headers = await login("admin@example.test", "long-test-only-password");
  const request = {
    method: "POST" as const,
    url: "/api/commands/warranty.policy",
    headers,
    payload: {
      days: 730,
      revision: 1,
      reason: "Synthetic confidential review reason",
    },
  };
  for (const changed of [
    { ...request, headers: { ...headers, origin: "http://foreign" } },
    { ...request, headers: { ...headers, "x-csrf-token": "bad" } },
  ])
    assert.equal((await http.inject(changed)).statusCode, 403);
  assert.equal(
    (
      await http.inject({
        ...request,
        payload: { ...request.payload, approved: true },
      })
    ).statusCode,
    400,
  );
  const reply = await http.inject(request);
  assert.equal(reply.statusCode, 200);
  assert.deepEqual((await http.inject(request)).json(), reply.json());
  const buyerEmail = f.app.identity
    .users(f.actor)
    .find((u) => u.id === buyer.id)!.email;
  const buyerHeaders = await login(buyerEmail, "long-user-test-password");
  assert.equal(
    (await http.inject({ ...request, headers: buyerHeaders })).statusCode,
    403,
  );
  const policy = await http.inject({
    url: "/api/warranty/coverage-policy",
    headers: buyerHeaders,
  });
  assert.equal(policy.headers["cache-control"], "no-store");
  assert.deepEqual(Object.keys(policy.json()).sort(), [
    "configuredAt",
    "days",
    "revision",
  ]);
  assert.equal(
    (
      await http.inject({
        url: "/api/warranty/coverage-policy?extra=true",
        headers,
      })
    ).statusCode,
    400,
  );
  const payload = input(f, unitId, 2),
    c = f.app.warranty.submit(buyer, "buyer-claim", payload);
  const url = `/api/warranty/claims/${c.id}/coverage`;
  assert.equal((await http.inject({ url })).statusCode, 401);
  const snapshot = await http.inject({ url, headers: buyerHeaders });
  assert.equal(snapshot.statusCode, 200);
  assert.equal(snapshot.headers["cache-control"], "no-store");
  assert.equal(snapshot.body.includes("confidential"), false);
  assert.equal(
    (
      await http.inject({
        url: `${url}?accountId=${f.buyer}`,
        headers: buyerHeaders,
      })
    ).statusCode,
    400,
  );
  const other = f.app.identity.createCustomer(f.actor, "other", {
    name: "Other",
    tier: "standard",
    creditLimit: 10000,
  }).id;
  warrantyGrants(f, buyer, { accountId: other });
  assert.equal(
    (await http.inject({ url, headers: buyerHeaders })).statusCode,
    401,
  );
  const freshBuyerHeaders = await login(buyerEmail, "long-user-test-password");
  assert.equal(
    (await http.inject({ url, headers: freshBuyerHeaders })).statusCode,
    403,
  );
});

async function race(
  t: { after: (fn: () => void) => void },
  f: F,
  operations: {
    actor: Actor;
    operation: "policy" | "submit";
    payload: unknown;
  }[],
) {
  const children: ChildProcess[] = [],
    ready: Promise<void>[] = [],
    results: Promise<any>[] = [];
  operations.forEach((op, i) => {
    const child = fork(
      new URL("./coverage-policy-child.ts", import.meta.url),
      [],
      {
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      },
    );
    children.push(child);
    let resolveReady: () => void,
      resolveResult: (r: any) => void,
      reject: (e: Error) => void;
    ready.push(new Promise((r) => (resolveReady = r)));
    results.push(
      new Promise((r, j) => {
        resolveResult = r;
        reject = j;
      }),
    );
    let stderr = "";
    child.stderr?.on("data", (c) => (stderr += String(c)));
    child.on("message", (m: any) =>
      m.ready ? resolveReady() : resolveResult(m),
    );
    child.on("error", (e) => reject(e));
    child.on("exit", (code) => {
      if (code !== 0)
        reject(new Error(`Coverage policy child exit ${code}: ${stderr}`));
    });
    child.send({
      action: "init",
      input: { path: f.path, key: `race-${i}`, ...op },
    });
  });
  t.after(() => children.forEach((c) => c.kill()));
  await Promise.all(ready);
  children.forEach((c) => c.send({ action: "go" }));
  return Promise.all(results);
}
test(
  "separate-process duration revisions serialize without lost settings",
  { timeout: 10000 },
  async (t) => {
    const f = fixture(t);
    const results = await race(
      t,
      f,
      [730, 30].map((days) => ({
        actor: f.actor,
        operation: "policy" as const,
        payload: { days, revision: 1, reason: "Synthetic concurrent review" },
      })),
    );
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(results.find((r) => !r.ok).code, "REVISION");
    assert.equal(f.app.identity.coveragePolicy(f.actor).revision, 2);
    assert.equal(
      f.app.platform
        .events(f.actor)
        .filter((e) => e.type === "WarrantyCoveragePolicyChanged").length,
      1,
    );
  },
);
test(
  "separate-process claim versus policy change retains the serialized version or refuses stale review",
  { timeout: 10000 },
  async (t) => {
    const f = fixture(t),
      unitId = sold(f);
    configure(f);
    const results = await race(t, f, [
      {
        actor: f.actor,
        operation: "policy",
        payload: {
          days: 30,
          revision: 2,
          reason: "Synthetic concurrent change",
        },
      },
      { actor: f.actor, operation: "submit", payload: input(f, unitId, 2) },
    ]);
    assert.equal(results[0].ok, true);
    if (results[1].ok) {
      const retained = f.app.warranty.claimCoverage(
        f.actor,
        results[1].result.id,
      );
      assert.equal(retained.snapshot?.policy?.revision, 2);
      assert.equal(retained.coverageEnd, "2026-02-28T12:00:00.000Z");
    } else {
      assert.equal(results[1].code, "REVISION");
      assert.equal(f.app.warranty.list(f.actor).length, 0);
      assert.equal(
        f.app.database
          .owned("warranty")
          .all("SELECT * FROM warranty_claim_coverage").length,
        0,
      );
    }
    assert.equal(f.app.identity.coveragePolicy(f.actor).revision, 3);
  },
);
