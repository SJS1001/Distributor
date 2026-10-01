import { test } from "node:test";
import assert from "node:assert/strict";
import { Application } from "../src/server/application.ts";
import { Store } from "../src/server/database.ts";
import { createHttp } from "../src/server/http.ts";
import { fixture, accept, ship } from "./fixtures.ts";
import { warrantyUser, warrantyGrants } from "./warranty-authority-fixtures.ts";
type Fixture = ReturnType<typeof fixture>;

function claim(f: Fixture, serial = "S1") {
  ship(f, accept(f, 1, serial).id);
  return f.app.warranty.submit(f.actor, `claim-${serial}`, {
    accountId: f.buyer,
    unitId: f.app.inventory.trace(f.actor, serial).unit.id,
    type: "warranty",
    issue: "Synthetic warranty",
    evidence: "Synthetic report",
  });
}
function approve(f: Fixture, claimId: string) {
  return f.app.warranty.review(f.actor, `approve-${claimId}`, {
    claimId,
    approved: true,
    reason: "Private approval reason",
  });
}
function manufacturer(f: Fixture, claimId: string, n: number) {
  const maker = f.app.warranty.referManufacturer(
    f.actor,
    `refer-${claimId}-${n}`,
    {
      claimId,
      manufacturer: "Synthetic maker",
      reference: `M-${claimId}-${n}`,
      evidence: "Private referral evidence",
      reason: `Private referral ${n}`,
    },
  );
  f.app.warranty.decideManufacturer(f.actor, `decide-${claimId}-${n}`, {
    caseId: maker.id,
    revision: 1,
    outcome: "cancelled",
    evidence: "Private response evidence",
    reason: `Private cancellation ${n}`,
  });
}
function facts(f: Fixture) {
  const rows: Record<string, unknown> = {};
  for (const [owner, tables] of [
    [
      "warranty",
      [
        "claims",
        "decisions",
        "manufacturer_cases",
        "manufacturer_history",
        "replacements",
      ],
    ],
    ["inventory", ["units", "movements", "allocations"]],
    ["orders", ["orders"]],
    ["fulfillment", ["shipments"]],
    ["billing", ["invoices", "credits", "payments"]],
    ["platform", ["commands", "audit", "audit_order", "audit_clock", "events"]],
  ] as const)
    for (const table of tables) {
      const name = `${owner}_${table}`;
      rows[name] = f.app.database
        .owned(owner)
        .all(`SELECT * FROM ${name} ORDER BY rowid`);
    }
  return rows;
}
test("native submission, receipt, inspection, manufacturer and repair/credit records persist once and history reads change no retained facts", (t) => {
  const f = fixture(t),
    c = claim(f);
  const submitted = f.app.warranty.decisionHistory(f.actor, c.id);
  assert.equal(submitted.items.length, 1);
  assert.equal(submitted.items[0]!.action, "submitted");
  assert.equal(submitted.items[0]!.reason, "Synthetic warranty");
  assert.equal(submitted.next, null);
  approve(f, c.id);
  approve(f, c.id);
  manufacturer(f, c.id, 0);
  manufacturer(f, c.id, 0);
  f.app.warranty.receive(f.actor, "return", {
    claimId: c.id,
    warehouseId: f.w1,
    bin: "Q",
    serial: "S1",
  });
  f.app.warranty.inspect(f.actor, "inspect", {
    claimId: c.id,
    findings: "Synthetic inspection",
  });
  f.app.warranty.dispose(f.actor, "repair", {
    claimId: c.id,
    disposition: "repair",
    reason: "Private repair",
  });
  f.app.warranty.dispose(f.actor, "scrap", {
    claimId: c.id,
    disposition: "scrap",
    reason: "Private completion",
  });
  f.app.warranty.credit(f.actor, "credit", {
    claimId: c.id,
    reason: "Private credit",
  });
  const before = facts(f),
    page = f.app.warranty.decisionHistory(f.actor, c.id);
  assert.deepEqual(
    page.items.map((i) => i.action),
    [
      "submitted",
      "approved",
      "manufacturer.referred",
      "manufacturer.cancelled",
      "received",
      "inspected",
      "disposition.repair",
      "disposition.scrap",
      "credited",
    ],
  );
  assert.equal(page.next, null);
  assert.equal(page.items[1]!.reason, "Private approval reason");
  assert.ok(page.items.every((i) => i.actorId === f.actor.id));
  f.app.close();
  f.app = new Application(f.path, "CA");
  assert.deepEqual(f.app.warranty.decisionHistory(f.actor, c.id), page);
  assert.deepEqual(facts(f), before);
});
test("bounded stable insertion pages cover native decisions with tied timestamps, restart and newly appended decisions", (t) => {
  const f = fixture(t),
    c = claim(f);
  approve(f, c.id);
  for (let i = 0; i < 21; i++) manufacturer(f, c.id, i);
  // Owning-store fixture changes timestamps only, preserving native command evidence and insertion order.
  f.app.database
    .owned("warranty")
    .run(
      "UPDATE warranty_decisions SET created_at='2000-01-01T00:00:00.000Z' WHERE claim_id=?",
      c.id,
    );
  const expected = f.app.database
    .owned("warranty")
    .all<{ id: string }>(
      "SELECT id FROM warranty_decisions WHERE claim_id=? ORDER BY rowid",
      c.id,
    )
    .map((r) => r.id);
  const first = f.app.warranty.decisionHistory(f.actor, c.id);
  assert.equal(first.items.length, 20);
  assert.equal(first.next, expected[19]);
  f.app.close();
  f.app = new Application(f.path, "CA");
  const second = f.app.warranty.decisionHistory(f.actor, c.id, first.next!);
  assert.equal(second.items.length, 20);
  assert.equal(second.next, expected[39]);
  manufacturer(f, c.id, 21);
  const third = f.app.warranty.decisionHistory(f.actor, c.id, second.next!);
  assert.equal(third.items.length, 6);
  assert.equal(third.next, null);
  assert.deepEqual(
    [...first.items, ...second.items, ...third.items.slice(0, 4)].map(
      (i) => i.id,
    ),
    expected,
  );
  assert.deepEqual(
    f.app.warranty.decisionHistory(f.actor, c.id, third.items.at(-1)!.id),
    { items: [], next: null },
  );
  assert.equal(
    new Set([...first.items, ...second.items, ...third.items].map((i) => i.id))
      .size,
    46,
  );
});
test("exact page edge, cursor scope and validation deny foreign claim/organization traversal", (t) => {
  const f = fixture(t),
    c = claim(f),
    other = claim(f, "S2");
  // Submission, approval and twenty native manufacturer decisions exercise both sides of the page edge.
  approve(f, c.id);
  for (let i = 0; i < 10; i++) manufacturer(f, c.id, i);
  const first = f.app.warranty.decisionHistory(f.actor, c.id);
  assert.equal(first.items.length, 20);
  assert.ok(first.next);
  const final = f.app.warranty.decisionHistory(
    f.actor,
    c.id,
    first.items[1]!.id,
  );
  assert.equal(final.items.length, 20);
  assert.equal(final.next, null);
  approve(f, other.id);
  const foreign = f.app.warranty.decisionHistory(f.actor, other.id).items[0]!
    .id;
  const store = f.app.database.owned("warranty");
  store.run(
    "INSERT INTO warranty_decisions VALUES('foreign-org','other-org',?,'approved','Private foreign reason',?,'2000-01-01')",
    c.id,
    f.actor.id,
  );
  for (const cursor of [foreign, "foreign-org", "missing"])
    assert.throws(() => f.app.warranty.decisionHistory(f.actor, c.id, cursor), {
      code: "CURSOR",
    });
  for (const cursor of ["", " ", "x".repeat(129)])
    assert.throws(() => f.app.warranty.decisionHistory(f.actor, c.id, cursor), {
      code: "VALIDATION",
    });
  assert.equal(
    f.app.warranty.decisionHistory(f.actor, c.id, first.next!).items.length,
    2,
  );
});
test("current accounts, roles, sites, disabled users and forced-password restrictions govern every history page", (t) => {
  const f = fixture(t),
    c = claim(f);
  approve(f, c.id);
  const buyer = warrantyUser(f, "buyer"),
    warehouse = warrantyUser(f, "warehouse"),
    support = warrantyUser(f, "support");
  const publicPage = f.app.warranty.decisionHistory(buyer, c.id);
  assert.deepEqual(Object.keys(publicPage.items[0]!).sort(), [
    "action",
    "createdAt",
    "id",
  ]);
  assert.ok(!JSON.stringify(publicPage).includes("Private"));
  assert.throws(() => f.app.warranty.decisionHistory(support, c.id), {
    code: "FORBIDDEN",
  });
  assert.equal(f.app.warranty.decisionHistory(warehouse, c.id).items.length, 2);
  warrantyGrants(f, warehouse, { sites: [f.w2] });
  assert.throws(() => f.app.warranty.decisionHistory(warehouse, c.id), {
    code: "FORBIDDEN",
  });
  const other = f.app.identity.createCustomer(f.actor, "other-account", {
    name: "Other",
    tier: "standard",
    creditLimit: 0,
  });
  warrantyGrants(f, buyer, { accountId: other.id });
  assert.throws(
    () => f.app.warranty.decisionHistory(buyer, c.id, publicPage.items[0]!.id),
    { code: "FORBIDDEN" },
  );
  warrantyGrants(f, buyer, { accountId: f.buyer });
  warrantyGrants(f, buyer, { active: false });
  assert.throws(() => f.app.warranty.decisionHistory(buyer, c.id), {
    code: "FORBIDDEN",
  });
  const staff = warrantyUser(f, "finance");
  warrantyGrants(f, staff, { role: "support" });
  assert.throws(() => f.app.warranty.decisionHistory(staff, c.id), {
    code: "FORBIDDEN",
  });
  const forced = warrantyUser(f, "commercial");
  f.app.identity.resetPassword(f.actor, "reset-history", {
    userId: forced.id,
    revision: Number(
      f.app.identity.users(f.actor).find((u) => u.id === forced.id)!.revision,
    ),
    password: "changed-test-password",
    currentPassword: "long-test-only-password",
    reason: "Synthetic reset",
  });
  assert.throws(() => f.app.warranty.decisionHistory(forced, c.id), {
    code: "PASSWORD_CHANGE_REQUIRED",
  });
});
test("buyer history uses a bounded public-only SQL projection without eager decision materialization", (t) => {
  const f = fixture(t),
    c = claim(f);
  approve(f, c.id);
  const buyer = warrantyUser(f, "buyer"),
    original = Store.prototype.all;
  let reads = 0;
  Store.prototype.all = function (sql, ...params) {
    if (sql.includes("warranty_decisions")) {
      reads++;
      assert.match(sql, /LIMIT 21$/);
      assert.match(sql, /org_id=\? AND claim_id=\? AND rowid>\?/);
      assert.ok(
        !sql.includes("reason") &&
          !sql.includes("actor_id") &&
          !sql.includes("SELECT *"),
      );
    }
    return original.call(this, sql, ...params) as any;
  };
  try {
    f.app.warranty.decisionHistory(buyer, c.id);
    assert.equal(reads, 1);
  } finally {
    Store.prototype.all = original;
  }
});
test("HTTP history enforces strict query, authentication, private projection and current account scope", async (t) => {
  const f = fixture(t),
    c = claim(f);
  approve(f, c.id);
  f.app.warranty.receive(f.actor, "http-receive", {
    claimId: c.id,
    warehouseId: f.w1,
    serial: "S1",
    bin: "Private HTTP quarantine",
  });
  f.app.warranty.inspect(f.actor, "http-inspect", {
    claimId: c.id,
    findings: "Private HTTP inspection",
  });
  const buyer = warrantyUser(f, "buyer");
  const email = String(
    f.app.identity.users(f.actor).find((u) => u.id === buyer.id)!.email,
  );
  const origin = "http://127.0.0.1:3000",
    http = await createHttp(f.app, {
      origin,
      staticRoot: "/nonexistent-distributor-test",
    });
  t.after(() => http.close());
  const url = `/api/warranty/claims/${c.id}/decisions`;
  assert.equal((await http.inject({ method: "GET", url })).statusCode, 401);
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: { email, password: "long-user-test-password" },
  });
  assert.equal(login.statusCode, 200);
  const cookie = login.cookies[0]!,
    headers = { cookie: `${cookie.name}=${cookie.value}` };
  const page = await http.inject({ method: "GET", url, headers });
  assert.equal(page.statusCode, 200);
  assert.deepEqual(
    page.json().items.map((item: { action: string }) => item.action),
    ["submitted", "approved", "received", "inspected"],
  );
  for (const item of page.json().items)
    assert.deepEqual(Object.keys(item).sort(), ["action", "createdAt", "id"]);
  assert.ok(!page.body.includes("Private"));
  assert.ok(!page.body.includes(f.actor.id));
  for (const query of [
    "?after=",
    "?after=" + "x".repeat(129),
    "?limit=999",
    "?unknown=1",
  ])
    assert.equal(
      (await http.inject({ method: "GET", url: url + query, headers }))
        .statusCode,
      400,
    );
  assert.equal(
    (await http.inject({ method: "GET", url: url + "?after=missing", headers }))
      .statusCode,
    400,
  );
  const other = f.app.identity.createCustomer(f.actor, "http-other", {
    name: "Other",
    tier: "standard",
    creditLimit: 0,
  });
  warrantyGrants(f, buyer, { accountId: other.id });
  assert.equal(
    (await http.inject({ method: "GET", url, headers })).statusCode,
    401,
  );
});

test("original long issue and inspection snapshots survive later custody changes without widening decision input limits", (t) => {
  const f = fixture(t);
  ship(f, accept(f).id);
  const unitId = f.app.inventory.trace(f.actor, "S1").unit.id;
  const issue = "Private issue " + "i".repeat(1986);
  const evidence = "Private evidence " + "e".repeat(1983);
  const input = {
    accountId: f.buyer,
    unitId,
    type: "return" as const,
    issue,
    evidence,
  };
  const c = f.app.warranty.submit(f.actor, "long-submit", input);
  assert.deepEqual(f.app.warranty.submit(f.actor, "long-submit", input), c);
  assert.equal(f.app.warranty.claim(f.actor, c.id).evidence, evidence);
  assert.throws(
    () =>
      f.app.warranty.review(f.actor, "too-long", {
        claimId: c.id,
        approved: true,
        reason: "r".repeat(1001),
      }),
    { code: "VALIDATION" },
  );
  assert.equal(f.app.warranty.claim(f.actor, c.id).state, "submitted");
  approve(f, c.id);
  const receipt = {
    claimId: c.id,
    warehouseId: f.w2,
    bin: " Original Q ",
    serial: "S1",
  };
  f.app.warranty.receive(f.actor, "long-receive", receipt);
  f.app.warranty.receive(f.actor, "long-receive", receipt);
  const findings = "Private findings " + "f".repeat(1983);
  const inspection = { claimId: c.id, findings };
  f.app.warranty.inspect(f.actor, "long-inspect", inspection);
  f.app.warranty.inspect(f.actor, "long-inspect", inspection);
  f.app.warranty.dispose(f.actor, "long-restock", {
    claimId: c.id,
    disposition: "restock",
    reason: "Private remedy",
  });
  const page = f.app.warranty.decisionHistory(f.actor, c.id);
  assert.deepEqual(
    page.items.map((i) => i.action),
    ["submitted", "approved", "received", "inspected", "disposition.restock"],
  );
  assert.equal(page.items[0]!.reason, issue);
  assert.equal(
    page.items[2]!.reason,
    `Serial S1 received into quarantine at warehouse ${f.w2}, bin Original Q.`,
  );
  assert.equal(page.items[3]!.reason, findings);
  const audits = f.app.database
    .owned("platform")
    .all<{ detail: string }>(
      "SELECT detail FROM platform_audit WHERE reference=? AND action IN ('warranty.submitted','warranty.received','warranty.inspected') ORDER BY rowid",
      c.id,
    );
  assert.deepEqual(
    audits.map((a) => JSON.parse(a.detail)),
    [0, 2, 3].map((n) => ({ activityId: page.items[n]!.id })),
  );
  assert.equal(f.app.inventory.unit(f.actor, unitId).condition, "usable");
  assert.equal(f.app.warranty.claim(f.actor, c.id).inspection, findings);
  const buyer = warrantyUser(f, "buyer");
  const publicPage = f.app.warranty.decisionHistory(buyer, c.id);
  for (const item of publicPage.items)
    assert.deepEqual(Object.keys(item).sort(), ["action", "createdAt", "id"]);
  assert.ok(!JSON.stringify(publicPage).includes("Private"));
  assert.ok(!JSON.stringify(publicPage).includes("Original Q"));
  assert.ok(!JSON.stringify(publicPage).includes(f.actor.id));
  f.app.close();
  f.app = new Application(f.path, "CA");
  assert.deepEqual(f.app.warranty.decisionHistory(f.actor, c.id), page);
});

for (const phase of ["submit", "receive", "inspect"] as const)
  for (const failure of ["activity audit", "command receipt audit"] as const)
    test(`native ${phase} activity rolls back all module facts on ${failure} failure and retries once`, (t) => {
      const f = fixture(t);
      ship(f, accept(f).id);
      const unitId = f.app.inventory.trace(f.actor, "S1").unit.id;
      const submit = {
        accountId: f.buyer,
        unitId,
        type: "warranty" as const,
        issue: "Private rollback issue",
        evidence: "Private rollback reference",
      };
      const c =
        phase === "submit"
          ? null
          : f.app.warranty.submit(f.actor, "prior-submit", submit);
      if (c) approve(f, c.id);
      const receipt = {
        claimId: c?.id ?? "",
        warehouseId: f.w1,
        bin: "Q",
        serial: "S1",
      };
      if (phase === "inspect")
        f.app.warranty.receive(f.actor, "prior-receive", receipt);
      const perform = () =>
        phase === "submit"
          ? f.app.warranty.submit(f.actor, "activity-key", submit)
          : phase === "receive"
            ? f.app.warranty.receive(f.actor, "activity-key", receipt)
            : f.app.warranty.inspect(f.actor, "activity-key", {
                claimId: c!.id,
                findings: "Private rollback inspection",
              });
      const before = facts(f),
        audit = f.app.platform.audit;
      const action =
        failure === "activity audit"
          ? `warranty.${{ submit: "submitted", receive: "received", inspect: "inspected" }[phase]}`
          : `warranty.${phase}`;
      f.app.platform.audit = function (actor, name, reference, detail) {
        audit.call(this, actor, name, reference, detail);
        if (name === action) throw new Error("Synthetic late activity failure");
      };
      try {
        assert.throws(perform, /Synthetic late activity failure/);
      } finally {
        f.app.platform.audit = audit;
      }
      assert.deepEqual(facts(f), before);
      const result = perform(),
        committed = facts(f);
      assert.deepEqual(perform(), result);
      assert.deepEqual(facts(f), committed);
      const entries = f.app.warranty.decisionHistory(f.actor, result.id).items;
      assert.equal(
        entries.filter(
          (i) =>
            i.action ===
            { submit: "submitted", receive: "received", inspect: "inspected" }[
              phase
            ],
        ).length,
        1,
      );
      const unit = f.app.inventory.unit(f.actor, unitId);
      assert.equal(unit.quantity, phase === "submit" ? 0 : 1);
      assert.equal(
        unit.condition,
        phase === "submit" ? "usable" : "quarantine",
      );
    });

test("legacy claim records and cached old receipts do not fabricate missing activity", (t) => {
  const f = fixture(t),
    c = claim(f);
  // Simulate the previous release: original claim and permanent receipt, no submission activity.
  f.app.database
    .owned("warranty")
    .run("DELETE FROM warranty_decisions WHERE claim_id=?", c.id);
  f.app.close();
  f.app = new Application(f.path, "CA");
  const before = facts(f);
  assert.deepEqual(f.app.warranty.decisionHistory(f.actor, c.id), {
    items: [],
    next: null,
  });
  f.app.warranty.submit(f.actor, "claim-S1", {
    accountId: f.buyer,
    unitId: f.app.inventory.trace(f.actor, "S1").unit.id,
    type: "warranty",
    issue: "Synthetic warranty",
    evidence: "Synthetic report",
  });
  assert.deepEqual(facts(f), before);
  approve(f, c.id);
  assert.deepEqual(
    f.app.warranty.decisionHistory(f.actor, c.id).items.map((i) => i.action),
    ["approved"],
  );
});
