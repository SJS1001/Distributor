import { test } from "node:test";
import assert from "node:assert/strict";
import type { Actor } from "../src/server/core.ts";
import { Store } from "../src/server/database.ts";
import { Application } from "../src/server/application.ts";
import { fixture, accept, ship } from "./fixtures.ts";
import { warrantyUser, warrantyGrants } from "./warranty-authority-fixtures.ts";
type Fixture = ReturnType<typeof fixture>;
function prepare(f: Fixture, actor = f.actor) {
  ship(f, accept(f).id);
  const unitId = f.app.inventory.trace(f.actor, "S1").unit.id;
  const submit = {
    accountId: f.buyer,
    unitId,
    type: "warranty" as const,
    issue: "Synthetic failure",
    evidence: "Synthetic customer evidence",
  };
  const c = f.app.warranty.submit(actor, "claim", submit);
  const review = { claimId: c.id, approved: true, reason: "Private approval" };
  f.app.warranty.review(actor, "review", review);
  const referral = {
    claimId: c.id,
    manufacturer: "Synthetic maker",
    reference: "M1",
    evidence: "Private manufacturer evidence",
    reason: "Private referral reason",
  };
  const maker = f.app.warranty.referManufacturer(actor, "refer", referral);
  const receive = { claimId: c.id, warehouseId: f.w1, bin: "Q", serial: "S1" };
  f.app.warranty.receive(actor, "receive", receive);
  const inspect = { claimId: c.id, findings: "Synthetic inspection" };
  f.app.warranty.inspect(actor, "inspect", inspect);
  const reserve = {
    claimId: c.id,
    newUnitId: f.app.inventory.trace(f.actor, "S2").unit.id,
    oldDisposition: "scrap" as const,
    coveragePolicy: "inherit_original" as const,
    reason: "Private replacement reason",
  };
  const r = f.app.warranty.reserveReplacement(actor, "reserve", reserve);
  return { c, maker, r, submit, review, referral, receive, inspect, reserve };
}
type Prepared = ReturnType<typeof prepare>;
function reads(f: Fixture, p: Prepared, actor: Actor) {
  return [
    () => f.app.warranty.claim(actor, p.c.id),
    () => f.app.warranty.decisionHistory(actor, p.c.id),
    () => f.app.warranty.list(actor),
    () => f.app.warranty.replacements(actor, p.c.id),
    () => f.app.warranty.manufacturerCases(actor, p.c.id),
    () => f.app.warranty.soldUnits(actor),
    () => f.app.warranty.coverage(actor, p.reserve.newUnitId, f.buyer),
    () => f.app.warranty.replacementShippingHistory(actor, p.r.id),
  ];
}
function commands(f: Fixture, p: Prepared, actor: Actor) {
  const w = f.app.warranty;
  return [
    () => w.submit(actor, "claim", p.submit),
    () => w.review(actor, "review", p.review),
    () => w.receive(actor, "receive", p.receive),
    () => w.inspect(actor, "inspect", p.inspect),
    () =>
      w.dispose(actor, "dispose", {
        claimId: p.c.id,
        disposition: "scrap",
        reason: "Synthetic",
      }),
    () => w.credit(actor, "credit", { claimId: p.c.id, reason: "Synthetic" }),
    () => w.referManufacturer(actor, "refer", p.referral),
    () =>
      w.decideManufacturer(actor, "decide", {
        caseId: p.maker.id,
        revision: 1,
        outcome: "accepted",
        evidence: "Synthetic",
        reason: "Synthetic",
      }),
    () => w.reserveReplacement(actor, "reserve", p.reserve),
    () =>
      w.cancelReplacement(actor, "cancel", {
        replacementId: p.r.id,
        revision: 1,
        reason: "Synthetic",
      }),
    () =>
      w.handoverReplacement(actor, "handover", {
        replacementId: p.r.id,
        revision: 1,
        serial: "S2",
        recipient: "Synthetic",
        evidence: "Synthetic",
      }),
    () =>
      w.dispatchReplacement(actor, "dispatch", {
        replacementId: p.r.id,
        revision: 1,
        serial: "S2",
        recipient: "Synthetic",
        address: "Synthetic",
        carrier: "Synthetic",
        tracking: "T1",
        evidence: "Synthetic",
      }),
    () =>
      w.updateReplacementShipping(actor, "update", {
        replacementId: p.r.id,
        revision: 1,
        state: "delayed",
        reference: "E1",
        evidence: "Synthetic",
        observedAt: new Date().toISOString(),
      }),
  ];
}
function facts(f: Fixture) {
  // Independent retained-row oracle, scoped to each owning test store.
  const rows: Record<string, unknown> = {};
  for (const [owner, tables] of [
    [
      "warranty",
      [
        "claims",
        "decisions",
        "replacements",
        "replacement_history",
        "manufacturer_cases",
        "manufacturer_history",
        "replacement_shipping",
        "replacement_shipping_history",
      ],
    ],
    ["inventory", ["units", "movements", "allocations"]],
    ["orders", ["orders"]],
    ["fulfillment", ["shipments"]],
    ["billing", ["invoices", "credits", "payments"]],
    ["platform", ["commands", "audit", "events"]],
  ] as const)
    for (const table of tables) {
      const name = `${owner}_${table}`;
      rows[name] = f.app.database
        .owned(owner)
        .all(`SELECT * FROM ${name} ORDER BY rowid`);
    }
  return rows;
}
function beforeWarrantyQuery(fn: () => void) {
  const get = Store.prototype.get,
    all = Store.prototype.all;
  Store.prototype.get = function (sql, ...params) {
    assert.ok(
      !sql.includes("warranty_"),
      "Unavailable authority must precede warranty lookup",
    );
    return get.call(this, sql, ...params) as any;
  };
  Store.prototype.all = function (sql, ...params) {
    assert.ok(
      !sql.includes("warranty_"),
      "Unavailable authority must precede warranty listing",
    );
    return all.call(this, sql, ...params) as any;
  };
  try {
    fn();
  } finally {
    Store.prototype.get = get;
    Store.prototype.all = all;
  }
}
for (const restriction of ["inactive", "password"] as const)
  test(`${restriction} actual principal denies all warranty reads and thirteen native commands before business queries, including cached successes`, (t) => {
    const f = fixture(t),
      actor = warrantyUser(f, "admin"),
      p = prepare(f, actor);
    if (restriction === "inactive") warrantyGrants(f, actor, { active: false });
    else
      f.app.identity.resetPassword(f.actor, "reset", {
        userId: actor.id,
        revision: Number(
          f.app.identity.users(f.actor).find((u) => u.id === actor.id)!
            .revision,
        ),
        password: "replacement-long-test-password",
        currentPassword: "long-test-only-password",
        reason: "Synthetic reset",
      });
    const before = facts(f),
      code =
        restriction === "inactive" ? "FORBIDDEN" : "PASSWORD_CHANGE_REQUIRED";
    beforeWarrantyQuery(() => {
      for (const op of [...reads(f, p, actor), ...commands(f, p, actor)])
        assert.throws(op, { code });
    });
    assert.deepEqual(facts(f), before);
    f.app.close();
    f.app = new Application(f.path);
    for (const read of reads(f, p, actor)) assert.throws(read, { code });
    assert.deepEqual(facts(f), before);
  });
test("fresh support role, unknown identity and foreign organization cannot forge warranty access or cached commands", (t) => {
  const f = fixture(t),
    actor = warrantyUser(f, "admin"),
    p = prepare(f, actor);
  warrantyGrants(f, actor, { role: "support" });
  const before = facts(f);
  beforeWarrantyQuery(() => {
    for (const unavailable of [
      actor,
      { ...actor, id: "missing" },
      { ...actor, orgId: "foreign" },
    ])
      for (const op of [
        ...reads(f, p, unavailable),
        ...commands(f, p, unavailable),
      ])
        assert.throws(op, { code: "FORBIDDEN" });
  });
  assert.deepEqual(facts(f), before);
});
test("downgraded staff snapshot uses buyer projections and original replacement entitlement without leaking internal history", (t) => {
  const f = fixture(t),
    actor = warrantyUser(f, "admin"),
    p = prepare(f, actor);
  f.app.warranty.handoverReplacement(f.actor, "collect", {
    replacementId: p.r.id,
    revision: 1,
    serial: "S2",
    recipient: "Private recipient",
    evidence: "Private signature",
  });
  warrantyGrants(f, actor, { role: "buyer", accountId: f.buyer, sites: [] });
  const before = facts(f),
    list = f.app.warranty.list(actor);
  assert.equal(list.length, 1);
  assert.deepEqual(list[0]!.manufacturerCases, []);
  const r = list[0]!.replacements[0]!;
  for (const field of ["reason", "recipient", "evidence", "history"])
    assert.equal(Object.hasOwn(r, field), false);
  assert.equal(r.newSerial, "S2");
  assert.deepEqual(
    f.app.warranty.replacements(actor, p.c.id),
    list[0]!.replacements,
  );
  assert.equal(f.app.warranty.claim(actor, p.c.id).account_id, f.buyer);
  assert.deepEqual(
    f.app.warranty.soldUnits(actor).map((u) => [u.serial, u.accountId]),
    [["S2", f.buyer]],
  );
  assert.throws(() => f.app.warranty.manufacturerCases(actor, p.c.id), {
    code: "FORBIDDEN",
  });
  assert.throws(() => f.app.warranty.review(actor, "review", p.review), {
    code: "FORBIDDEN",
  });
  assert.deepEqual(facts(f), before);
  const next = f.app.warranty.submit(actor, "successor", {
    ...p.submit,
    unitId: p.reserve.newUnitId,
    issue: "Synthetic successor",
  });
  assert.equal(
    f.app.warranty.claim(actor, next.id).invoice_id,
    f.app.warranty.claim(f.actor, p.c.id).invoice_id,
  );
});
test("real buyer account changes scope sold serials, claims and cached submission after restart", (t) => {
  const f = fixture(t),
    p = prepare(f),
    actor = warrantyUser(f, "buyer");
  f.app.warranty.handoverReplacement(f.actor, "collect", {
    replacementId: p.r.id,
    revision: 1,
    serial: "S2",
    recipient: "Synthetic",
    evidence: "Synthetic",
  });
  const submission = {
    ...p.submit,
    unitId: f.app.inventory.trace(f.actor, "S2").unit.id,
  };
  const successor = f.app.warranty.submit(actor, "buyer-cache", submission);
  const other = f.app.identity.createCustomer(f.actor, "other", {
    name: "Other synthetic",
    tier: "standard",
    creditLimit: 1000000,
  }).id;
  ship(f, accept({ ...f, buyer: other }, 1, "other-order").id);
  const u = f.app.warranty
    .soldUnits(f.actor)
    .find((u) => u.accountId === other)!;
  const otherClaim = f.app.warranty.submit(f.actor, "other-claim", {
    ...p.submit,
    accountId: other,
    unitId: u.id,
  });
  assert.equal(f.app.warranty.list(actor).length, 2);
  warrantyGrants(f, actor, { accountId: other });
  const before = facts(f);
  for (let restart = 0; restart < 2; restart++) {
    assert.deepEqual(
      f.app.warranty.list(actor).map((c) => c.id),
      [otherClaim.id],
    );
    assert.deepEqual(
      f.app.warranty.soldUnits(actor).map((u) => u.id),
      [u.id],
    );
    for (const claimId of [p.c.id, successor.id]) {
      assert.throws(() => f.app.warranty.claim(actor, claimId), {
        code: "FORBIDDEN",
      });
      assert.throws(() => f.app.warranty.replacements(actor, claimId), {
        code: "FORBIDDEN",
      });
    }
    assert.throws(
      () => f.app.warranty.submit(actor, "buyer-cache", submission),
      { code: "FORBIDDEN" },
    );
    assert.deepEqual(facts(f), before);
    if (restart === 0) {
      f.app.close();
      f.app = new Application(f.path);
    }
  }
});
test("warehouse replacement overview omits new serials outside current grants even before dispatch", (t) => {
  const f = fixture(t);
  const unit = f.app.inventory.trace(f.actor, "S2").unit;
  const transfer = f.app.inventory.dispatchTransfer(f.actor, "transfer", {
    unitId: unit.id,
    quantity: 1,
    revision: unit.revision,
    destinationId: f.w2,
    reason: "Synthetic",
  });
  f.app.inventory.receiveTransfer(f.actor, "arrival", {
    transferId: transfer.id,
    lineId: transfer.lineId,
    quantity: 1,
    serial: "S2",
    receiptRef: "R1",
    bin: "A",
    condition: "usable",
    reason: "Synthetic",
  });
  const p = prepare(f),
    actor = warrantyUser(f, "warehouse");
  assert.equal(f.app.warranty.claim(actor, p.c.id).id, p.c.id);
  assert.deepEqual(f.app.warranty.replacements(actor, p.c.id), []);
  assert.deepEqual(f.app.warranty.list(actor)[0]!.replacements, []);
  warrantyGrants(f, actor, { sites: [f.w1, f.w2] });
  assert.equal(f.app.warranty.replacements(actor, p.c.id)[0]!.newSerial, "S2");
  warrantyGrants(f, actor, { sites: [f.w2] });
  const before = facts(f);
  assert.deepEqual(f.app.warranty.list(actor), []);
  assert.throws(() => f.app.warranty.claim(actor, p.c.id), {
    code: "FORBIDDEN",
  });
  assert.throws(() => f.app.warranty.decisionHistory(actor, p.c.id), {
    code: "FORBIDDEN",
  });
  assert.deepEqual(facts(f), before);
});
test("current commercial and warranty read policy retains organization overview while fresh warehouse scope narrows it", (t) => {
  const f = fixture(t),
    p = prepare(f),
    actor = warrantyUser(f, "commercial", f.buyer, [f.w2]);
  for (const role of ["commercial", "warranty", "finance"] as const) {
    warrantyGrants(f, actor, { role });
    assert.equal(f.app.warranty.claim(actor, p.c.id).id, p.c.id);
    assert.equal(
      f.app.warranty.manufacturerCases(actor, p.c.id)[0]!.id,
      p.maker.id,
    );
    assert.equal(f.app.warranty.list(actor)[0]!.replacements.length, 1);
  }
  warrantyGrants(f, actor, { role: "warehouse" });
  assert.deepEqual(f.app.warranty.list(actor), []);
  assert.throws(() => f.app.warranty.manufacturerCases(actor, p.c.id), {
    code: "FORBIDDEN",
  });
});
