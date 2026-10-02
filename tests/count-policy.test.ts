import { test } from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { createBackup, restoreBackup } from "../src/server/recovery.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import { DomainError, type Actor } from "../src/server/core.ts";
import { readCountReviewPolicy } from "../src/server/count-policy.ts";
import { fixture } from "./fixtures.ts";
const password = "long-test-only-password";
type F = ReturnType<typeof fixture>;
const denied = (code: string, run: () => unknown) =>
  assert.throws(run, (e) => e instanceof DomainError && e.code === code);
function user(f: F, name: string, role: Actor["role"] = "admin") {
  const id = f.app.identity.createUser(f.actor, `user-${name}`, {
    email: `${name}@example.test`,
    name,
    password,
    role,
    sites: role === "admin" ? [] : [f.w1],
    ...(role === "buyer" ? { accountId: f.buyer } : {}),
  }).id;
  return f.app.identity.currentActor({ ...f.actor, id });
}
function count(f: F, starter = f.actor, observer = starter) {
  const productId = f.app.catalog.create(f.actor, "policy-sku", {
    sku: "COUNT-POLICY",
    name: "Synthetic policy lot",
    serialized: false,
    unitPrice: 500,
    taxBasisPoints: 0,
  }).id;
  const poId = f.app.procurement.create(f.actor, "policy-po", {
    supplierId: f.supplier,
    warehouseId: f.w1,
    lines: [{ productId, quantity: 6, unitCost: 125 }],
  }).id;
  const lineId = String(
    f.app.procurement.orders(f.actor).find((p) => p.id === poId)!.lines[0]!.id,
  );
  f.app.procurement.receive(f.actor, "policy-receive", {
    poId,
    lineId,
    quantity: 6,
    serials: [],
    deliveryRef: "POLICY-LOT",
    bin: "P1",
    quarantine: false,
  });
  const unit = f.app.inventory
    .stock(f.actor)
    .find((u) => u.product_id === productId)!;
  const start = {
    unitId: unit.id,
    revision: unit.revision,
    countRef: "POLICY-COUNT",
  };
  const c = f.app.inventory.startCount(starter, "policy-start", start);
  const observation = {
    countId: c.id,
    quantity: 4,
    reason: "Synthetic bin evidence confirms four",
  };
  f.app.inventory.submitCount(observer, "policy-observe", observation);
  return {
    unit,
    start,
    observation,
    approval: {
      countId: c.id,
      decision: "approve" as const,
      reason: "Independent synthetic review",
      policyRevision: 2,
    },
  };
}
function configure(
  f: F,
  mode: "independent" | "administrator" = "independent",
  revision = 1,
  key = "select-policy",
) {
  return f.app.identity.configureCountReview(f.actor, key, {
    mode,
    revision,
    reason: `Synthetic reviewed ${mode} duties`,
  });
}
function update(
  f: F,
  actor: Actor,
  changes: Partial<{ role: Actor["role"]; sites: string[]; active: boolean }>,
) {
  const row = f.app.identity.users(f.actor).find((u) => u.id === actor.id)!;
  return f.app.identity.updateUser(
    f.actor,
    `grant-${actor.id}-${row.revision}`,
    {
      userId: actor.id,
      revision: row.revision,
      email: String(row.email),
      name: String(row.name),
      role: actor.role,
      sites: actor.sites,
      active: true,
      currentPassword: password,
      reason: "Synthetic authorization change",
      ...changes,
    },
  );
}

test("independent policy persists across instances and blocks starter, observer and direct correction without changing original-cost stock", (t) => {
  const f = fixture(t),
    observer = user(f, "observer"),
    reviewer = user(f, "reviewer"),
    c = count(f, f.actor, observer);
  const organization = JSON.parse(f.app.identity.organization(f.actor).policy);
  const policy = configure(f);
  assert.equal(policy.revision, 2);
  const selected = JSON.parse(f.app.identity.organization(f.actor).policy);
  delete selected.inventoryCountReview;
  assert.deepEqual(selected, organization);
  for (const actor of [f.actor, observer])
    denied("SEPARATION_OF_DUTIES", () =>
      f.app.inventory.decideCount(actor, `self-${actor.id}`, c.approval),
    );
  denied("COUNT_REVIEW_REQUIRED", () =>
    f.app.inventory.adjustCount(reviewer, "direct", {
      unitId: c.unit.id,
      revision: c.unit.revision,
      count: 4,
      reason: "Bypass",
    }),
  );
  denied("REVISION", () =>
    f.app.inventory.decideCount(reviewer, "unreviewed", {
      ...c.approval,
      policyRevision: undefined,
    }),
  );
  assert.equal(f.app.inventory.unit(f.actor, c.unit.id).quantity, 6);
  assert.equal(f.app.inventory.counts(f.actor)[0]!.canApprove, false);
  assert.equal(f.app.inventory.counts(reviewer)[0]!.canApprove, true);
  f.app.close();
  f.app = new Application(f.path);
  const approved = f.app.inventory.decideCount(reviewer, "approve", c.approval);
  assert.deepEqual(approved.reviewPolicy, policy);
  assert.equal(approved.adjustment!.valueDelta, -250);
  configure(f, "administrator", 2, "relax");
  assert.deepEqual(
    f.app.inventory.decideCount(reviewer, "approve", c.approval),
    approved,
  );
  assert.deepEqual(
    f.app.inventory.decideCount(reviewer, "lost-response-new-key", c.approval),
    approved,
  );
  const movements = f.app.database
    .owned("inventory")
    .all(
      "SELECT quantity,unit_cost FROM inventory_movements WHERE reference=? AND type='count'",
      c.approval.countId,
    );
  assert.deepEqual(
    movements.map((m) => [m.quantity, m.unit_cost]),
    [[-2, 125]],
  );
  assert.deepEqual(
    f.app.inventory.counts(f.actor)[0]!.result.reviewPolicy,
    policy,
  );
});

test("policy review revisions fence stale approvals after both strengthening and relaxing, while rejection remains available", (t) => {
  const f = fixture(t),
    reviewer = user(f, "reviewer"),
    c = count(f);
  configure(f);
  denied("REVISION", () =>
    f.app.inventory.decideCount(reviewer, "stale", {
      ...c.approval,
      policyRevision: 1,
    }),
  );
  configure(f, "administrator", 2, "relax");
  denied("REVISION", () =>
    f.app.inventory.decideCount(f.actor, "stale-relax", c.approval),
  );
  denied("REVISION", () =>
    f.app.inventory.decideCount(f.actor, "legacy", {
      ...c.approval,
      policyRevision: undefined,
    }),
  );
  const approved = f.app.inventory.decideCount(f.actor, "reviewed-relax", {
    ...c.approval,
    policyRevision: 3,
  });
  assert.equal(approved.adjustment!.quantity, 4);
  assert.equal(approved.reviewPolicy!.mode, "administrator");
  const next = f.app.inventory.startCount(f.actor, "reject-start", {
    unitId: c.unit.id,
    revision: approved.adjustment!.revision,
    countRef: "REJECT-OWN-DRAFT",
  });
  configure(f, "independent", 3, "strengthen-again");
  const rejected = f.app.inventory.decideCount(f.actor, "reject-own", {
    countId: next.id,
    decision: "reject",
    reason: "Invalid snapshot; no stock changes",
  });
  assert.equal(rejected.adjustment, null);
  assert.equal(rejected.reviewPolicy!.revision, 4);
});

test("saved policy and cached count operations re-read actual principals, sites, password restrictions and grants", (t) => {
  const f = fixture(t),
    observer = user(f, "observer", "warehouse"),
    reviewer = user(f, "reviewer"),
    c = count(f, observer);
  const policy = configure(f);
  f.app.inventory.decideCount(reviewer, "approve", c.approval);
  update(f, reviewer, { role: "warehouse", sites: [f.w1] });
  denied("FORBIDDEN", () =>
    f.app.inventory.decideCount(reviewer, "approve", c.approval),
  );
  // Forging the captured role cannot restore the persisted grant.
  denied("FORBIDDEN", () =>
    f.app.identity.configureCountReview(
      { ...observer, role: "admin" },
      "forged",
      { mode: "administrator", revision: 2, reason: "Forged grant" },
    ),
  );
  update(f, observer, { sites: [f.w2] });
  for (const key of ["policy-start", "new-key"])
    denied("FORBIDDEN", () =>
      f.app.inventory.startCount(observer, key, c.start),
    );
  denied("FORBIDDEN", () =>
    f.app.inventory.submitCount(observer, "policy-observe", c.observation),
  );
  assert.equal(f.app.inventory.counts(observer).length, 0);
  update(f, observer, { active: false });
  denied("FORBIDDEN", () => f.app.inventory.counts(observer));
  const restricted = user(f, "restricted");
  f.app.identity.resetPassword(f.actor, "restrict-reviewer", {
    userId: restricted.id,
    revision: 1,
    password: "changed-test-only-password",
    currentPassword: password,
    reason: "Synthetic password reset",
  });
  denied("PASSWORD_CHANGE_REQUIRED", () =>
    f.app.inventory.decideCount(restricted, "restricted", c.approval),
  );
  denied("PASSWORD_CHANGE_REQUIRED", () =>
    f.app.identity.countReviewPolicy(restricted),
  );
  denied("PASSWORD_CHANGE_REQUIRED", () => f.app.inventory.counts(restricted));
  assert.deepEqual(f.app.identity.countReviewPolicy(f.actor), policy);
  // Cached policy replies also require current persisted administrator authority.
  const setter = user(f, "setter");
  const input = {
    mode: "independent" as const,
    revision: 2,
    reason: "Synthetic new review",
  };
  f.app.identity.configureCountReview(setter, "cached-policy", input);
  update(f, setter, { role: "warehouse", sites: [f.w1] });
  denied("FORBIDDEN", () =>
    f.app.identity.configureCountReview(setter, "cached-policy", input),
  );
});

test("policy validation and late audit failure cannot weaken or partially save policy", (t) => {
  const f = fixture(t);
  const before = f.app.identity.organization(f.actor).policy;
  for (const input of [
    { mode: "unknown", revision: 1, reason: "Invalid mode" },
    { mode: "independent", revision: 0, reason: "Invalid revision" },
    { mode: "independent", revision: 1, reason: " " },
  ])
    assert.throws(() =>
      f.app.identity.configureCountReview(f.actor, "invalid", input as any),
    );
  assert.equal(f.app.identity.organization(f.actor).policy, before);
  f.app.database
    .owned("platform")
    .migrate(
      "CREATE TRIGGER platform_count_policy_fault BEFORE INSERT ON platform_audit WHEN new.action='count.policy' BEGIN SELECT RAISE(ABORT,'synthetic late policy failure'); END;",
    );
  assert.throws(() => configure(f), /synthetic late policy failure/);
  assert.equal(f.app.identity.organization(f.actor).policy, before);
  assert.equal(
    f.app.platform
      .events(f.actor)
      .filter((e) => e.type === "CountReviewPolicyChanged").length,
    0,
  );
  f.app.database
    .owned("platform")
    .migrate("DROP TRIGGER platform_count_policy_fault;");
  configure(f);
  const saved = JSON.parse(f.app.identity.organization(f.actor).policy);
  for (const value of [
    null,
    {},
    { mode: "wrong", revision: 2 },
    { mode: "administrator", revision: 0 },
  ])
    assert.throws(() =>
      readCountReviewPolicy({ ...saved, inventoryCountReview: value }),
    );
  assert.throws(() => readCountReviewPolicy(null as any));
});

test("HTTP policy review enforces origin, CSRF, strict payload and role boundaries, with lost-response retry and scoped count controls", async (t) => {
  const f = fixture(t),
    buyer = user(f, "buyer", "buyer"),
    c = count(f);
  const http = await createHttp(f.app, { origin: "http://localhost" });
  t.after(() => http.close());
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin: "http://localhost" },
    payload: { email: "admin@example.test", password },
  });
  const headers = {
    origin: "http://localhost",
    cookie: String(login.headers["set-cookie"]).split(";")[0]!,
    "x-csrf-token": login.json().csrf,
    "idempotency-key": "http-policy",
  };
  const request = {
    method: "POST" as const,
    url: "/api/commands/count.policy",
    headers,
    payload: {
      mode: "independent",
      revision: 1,
      reason: "Synthetic HTTP policy review",
    },
  };
  assert.equal(
    (
      await http.inject({
        ...request,
        headers: { ...headers, origin: "http://foreign" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await http.inject({
        ...request,
        headers: { ...headers, "x-csrf-token": "wrong" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await http.inject({
        ...request,
        payload: { ...request.payload, extra: true },
      })
    ).statusCode,
    400,
  );
  const reply = await http.inject(request);
  assert.equal(reply.statusCode, 200);
  assert.deepEqual((await http.inject(request)).json(), reply.json());
  const rows = (await http.inject({ url: "/api/counts", headers })).json();
  assert.equal(rows[0].canApprove, false);
  assert.equal(rows[0].reviewPolicy.mode, "independent");
  assert.equal(rows[0].id, c.approval.countId);
  assert.equal(
    (await http.inject({ url: "/api/count-review-policy", headers })).json()
      .revision,
    2,
  );
  denied("FORBIDDEN", () => f.app.identity.countReviewPolicy(buyer));
  denied("FORBIDDEN", () =>
    f.app.identity.configureCountReview(
      buyer,
      "buyer-policy",
      request.payload as any,
    ),
  );
  const buyerLogin = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin: "http://localhost" },
    payload: { email: "buyer@example.test", password },
  });
  assert.equal(buyerLogin.statusCode, 200);
  const buyerHeaders = {
    ...headers,
    cookie: String(buyerLogin.headers["set-cookie"]).split(";")[0]!,
    "x-csrf-token": buyerLogin.json().csrf,
  };
  for (const url of ["/api/count-review-policy", "/api/counts"])
    assert.equal(
      (await http.inject({ url, headers: buyerHeaders })).statusCode,
      403,
    );
  assert.equal(
    (await http.inject({ ...request, headers: buyerHeaders })).statusCode,
    403,
  );
});

test("late independent decision failure rolls back movement, snapshot, policy evidence and retry receipt together", (t) => {
  const f = fixture(t),
    reviewer = user(f, "reviewer"),
    c = count(f);
  const policy = configure(f);
  f.app.database
    .owned("platform")
    .migrate(
      "CREATE TRIGGER platform_count_decision_fault BEFORE INSERT ON platform_audit WHEN new.action='count.decide' BEGIN SELECT RAISE(ABORT,'synthetic late decision failure'); END;",
    );
  assert.throws(
    () => f.app.inventory.decideCount(reviewer, "retry-decision", c.approval),
    /synthetic late decision failure/,
  );
  assert.equal(f.app.inventory.unit(f.actor, c.unit.id).quantity, 6);
  assert.equal(
    f.app.inventory.unit(f.actor, c.unit.id).revision,
    c.unit.revision,
  );
  const pending = f.app.inventory.counts(reviewer)[0]!;
  assert.equal(pending.state, "submitted");
  assert.equal(pending.result, null);
  assert.deepEqual(f.app.identity.countReviewPolicy(f.actor), policy);
  assert.equal(
    f.app.database
      .owned("inventory")
      .all(
        "SELECT id FROM inventory_movements WHERE reference=? AND type='count'",
        c.approval.countId,
      ).length,
    0,
  );
  f.app.database
    .owned("platform")
    .migrate("DROP TRIGGER platform_count_decision_fault;");
  const decision = f.app.inventory.decideCount(
    reviewer,
    "retry-decision",
    c.approval,
  );
  assert.deepEqual(decision.reviewPolicy, policy);
  assert.equal(decision.adjustment!.valueDelta, -250);
  assert.deepEqual(
    f.app.inventory.decideCount(reviewer, "retry-decision", c.approval),
    decision,
  );
  assert.equal(
    f.app.database
      .owned("inventory")
      .all(
        "SELECT id FROM inventory_movements WHERE reference=? AND type='count'",
        c.approval.countId,
      ).length,
    1,
  );
});

test("encrypted fresh-file restore retains the selected duties, exact historical decision and one original-cost movement", async (t) => {
  const f = fixture(t),
    reviewer = user(f, "reviewer"),
    c = count(f);
  const policy = configure(f);
  const decision = f.app.inventory.decideCount(
    reviewer,
    "approved-before-backup",
    c.approval,
  );
  const archive = join(dirname(f.path), "count-policy.backup"),
    restored = join(dirname(f.path), "restored.db"),
    key = randomBytes(32);
  await createBackup(f.path, archive, "CA", key);
  await restoreBackup(archive, restored, "CA", key);
  const app = new Application(restored);
  t.after(() => app.close());
  assert.deepEqual(app.identity.countReviewPolicy(f.actor), policy);
  assert.deepEqual(app.inventory.counts(reviewer)[0]!.result, decision);
  assert.deepEqual(
    app.inventory.decideCount(reviewer, "approved-before-backup", c.approval),
    decision,
  );
  assert.deepEqual(
    app.inventory.decideCount(reviewer, "restored-new-key", c.approval),
    decision,
  );
  assert.equal(app.inventory.unit(f.actor, c.unit.id).quantity, 4);
  assert.equal(
    app.database
      .owned("inventory")
      .all(
        "SELECT id FROM inventory_movements WHERE reference=? AND type='count'",
        c.approval.countId,
      ).length,
    1,
  );
  denied("COUNT_REVIEW_REQUIRED", () =>
    app.inventory.adjustCount(reviewer, "restored-direct", {
      unitId: c.unit.id,
      revision: decision.adjustment!.revision,
      count: 3,
      reason: "Synthetic bypass after restore",
    }),
  );
});

async function race(
  t: { after: (fn: () => void) => void },
  f: F,
  operations: {
    actor: Actor;
    operation: "policy" | "approve";
    payload: unknown;
  }[],
) {
  const children: ChildProcess[] = [],
    ready: Promise<void>[] = [],
    results: Promise<any>[] = [];
  operations.forEach((op, i) => {
    const child = fork(
      new URL("./count-policy-child.ts", import.meta.url),
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
        reject(new Error(`Count policy child exit ${code}: ${stderr}`));
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
  "separate-process policy revisions serialize competing choices without lost organization settings",
  { timeout: 10000 },
  async (t) => {
    const f = fixture(t);
    const results = await race(t, f, [
      {
        actor: f.actor,
        operation: "policy",
        payload: { mode: "independent", revision: 1, reason: "First review" },
      },
      {
        actor: f.actor,
        operation: "policy",
        payload: {
          mode: "administrator",
          revision: 1,
          reason: "Second review",
        },
      },
    ]);
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(results.find((r) => !r.ok).code, "REVISION");
    assert.equal(f.app.identity.countReviewPolicy(f.actor).revision, 2);
    assert.equal(
      f.app.platform
        .events(f.actor)
        .filter((e) => e.type === "CountReviewPolicyChanged").length,
      1,
    );
    assert.equal(
      JSON.parse(f.app.identity.organization(f.actor).policy).coverageDays,
      365,
    );
  },
);

test(
  "separate-process strengthening versus self-approval commits only a decision valid under the serialized policy",
  { timeout: 10000 },
  async (t) => {
    const f = fixture(t),
      c = count(f);
    const results = await race(t, f, [
      {
        actor: f.actor,
        operation: "policy",
        payload: {
          mode: "independent",
          revision: 1,
          reason: "Strengthen duties",
        },
      },
      {
        actor: f.actor,
        operation: "approve",
        payload: { ...c.approval, policyRevision: 1 },
      },
    ]);
    assert.equal(results[0].ok, true);
    const row = f.app.inventory.counts(f.actor)[0]!;
    if (results[1].ok) {
      assert.equal(row.state, "approved");
      assert.equal(row.result.reviewPolicy.revision, 1);
      assert.equal(f.app.inventory.unit(f.actor, c.unit.id).quantity, 4);
    } else {
      assert.equal(results[1].code, "REVISION");
      assert.equal(row.state, "submitted");
      assert.equal(f.app.inventory.unit(f.actor, c.unit.id).quantity, 6);
    }
    assert.equal(row.reviewPolicy.mode, "independent");
  },
);
