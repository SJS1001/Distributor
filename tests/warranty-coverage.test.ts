import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, accept, ship } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import { warrantyUser, warrantyGrants } from "./warranty-authority-fixtures.ts";
type Fixture = ReturnType<typeof fixture>;
const start = "2024-02-29T12:00:00.000Z";
const end = "2025-02-28T12:00:00.000Z";
function sold(f: Fixture) {
  const shipment = ship(f, accept(f).id);
  // Simulate a pre-version-six sale: no historical handover policy was retained.
  f.app.database
    .owned("fulfillment")
    .run("DELETE FROM fulfillment_coverage WHERE shipment_id=?", shipment.id);
  // Synthetic business timestamp fixture; local command logs retain actual recording dates.
  f.app.database
    .owned("fulfillment")
    .run(
      "UPDATE fulfillment_shipments SET shipped_at=? WHERE id=?",
      start,
      shipment.id,
    );
  return f.app.inventory.trace(f.actor, "S1").unit.id;
}
function duration(f: Fixture, days: unknown) {
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_organizations SET policy=? WHERE id=?",
      JSON.stringify({ version: 1, approved: false, coverageDays: days }),
      f.actor.orgId,
    );
}
function facts(f: Fixture) {
  return (
    ["warranty", "platform", "inventory", "fulfillment", "billing"] as const
  ).map((owner) => {
    const store = f.app.database.owned(owner);
    const tables = store.all<{ name: string }>(
      "SELECT name FROM sqlite_schema WHERE type='table' AND name GLOB ? ORDER BY name",
      `${owner}_*`,
    );
    return tables.map(({ name }) =>
      store.all(`SELECT * FROM ${name} ORDER BY rowid`),
    );
  });
}
test("coverage derives exact UTC shipment duration, explicitly requires review, and reads change no retained facts across restart", (t) => {
  const f = fixture(t),
    unitId = sold(f);
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(start) });
  const before = facts(f);
  const coverage = f.app.warranty.coverage(f.actor, unitId, f.buyer);
  assert.equal(coverage.shippedAt, start);
  assert.equal(coverage.coverageEnd, end);
  assert.equal(coverage.provisionalDays, 365);
  assert.equal(coverage.source, "current_provisional_policy");
  assert.equal(coverage.datePosition, "within_dates");
  assert.equal(coverage.assessedAt, start);
  assert.equal(coverage.eligibility, "requires_review");
  assert.equal(coverage.coveragePolicyApproved, false);
  assert.equal(coverage.serial, "S1");
  f.app.close();
  f.app = new Application(f.path, "CA");
  assert.deepEqual(f.app.warranty.coverage(f.actor, unitId, f.buyer), coverage);
  assert.deepEqual(facts(f), before);
});
test("coverage clock boundaries use UTC instants and never auto-reject elapsed claims", (t) => {
  const f = fixture(t),
    unitId = sold(f);
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(start) - 1 });
  assert.equal(
    f.app.warranty.coverage(f.actor, unitId, f.buyer).datePosition,
    "before_start",
  );
  t.mock.timers.setTime(Date.parse(end) - 1);
  assert.equal(
    f.app.warranty.coverage(f.actor, unitId, f.buyer).datePosition,
    "within_dates",
  );
  t.mock.timers.setTime(Date.parse(end));
  assert.equal(
    f.app.warranty.coverage(f.actor, unitId, f.buyer).datePosition,
    "elapsed",
  );
  const claim = f.app.warranty.submit(f.actor, "elapsed-claim", {
    accountId: f.buyer,
    unitId,
    type: "warranty",
    issue: "Synthetic elapsed date",
    evidence: "Synthetic evidence",
  });
  assert.equal(claim.coverageEnd, end);
  assert.equal(claim.coveragePolicyApproved, false);
  assert.equal(f.app.warranty.claim(f.actor, claim.id).state, "submitted");
});
test("provisional policy changes affect current-sale preview while retained claims and replacement coverage keep original dates", (t) => {
  const f = fixture(t),
    unitId = sold(f);
  const c = f.app.warranty.submit(f.actor, "claim", {
    accountId: f.buyer,
    unitId,
    type: "warranty",
    issue: "Synthetic",
    evidence: "Synthetic",
  });
  duration(f, 730);
  assert.equal(
    f.app.warranty.coverage(f.actor, unitId, f.buyer).coverageEnd,
    "2026-02-28T12:00:00.000Z",
  );
  assert.equal(f.app.warranty.claim(f.actor, c.id).coverage_end, end);
  f.app.warranty.review(f.actor, "review", {
    claimId: c.id,
    approved: true,
    reason: "Synthetic",
  });
  f.app.warranty.receive(f.actor, "receive-return", {
    claimId: c.id,
    warehouseId: f.w1,
    bin: "Q",
    serial: "S1",
  });
  f.app.warranty.inspect(f.actor, "inspect", {
    claimId: c.id,
    findings: "Synthetic",
  });
  const newUnitId = f.app.inventory.trace(f.actor, "S2").unit.id;
  const r = f.app.warranty.reserveReplacement(f.actor, "replace", {
    claimId: c.id,
    newUnitId,
    oldDisposition: "restock",
    coveragePolicy: "inherit_original",
    reason: "Synthetic",
  });
  assert.throws(() => f.app.warranty.coverage(f.actor, newUnitId, f.buyer), {
    code: "STATE",
  });
  f.app.warranty.handoverReplacement(f.actor, "handover", {
    replacementId: r.id,
    revision: 1,
    serial: "S2",
    recipient: "Synthetic",
    evidence: "Synthetic",
  });
  duration(f, "malformed-current-duration");
  const inherited = f.app.warranty.coverage(f.actor, newUnitId, f.buyer);
  assert.equal(inherited.shippedAt, start);
  assert.equal(inherited.coverageEnd, end);
  assert.equal(inherited.source, "replacement_inherited");
  assert.equal(inherited.provisionalDays, null);
  assert.equal(inherited.eligibility, "requires_review");
  duration(f, 365);
  const other = f.app.identity.createCustomer(f.actor, "other", {
    name: "Other synthetic owner",
    tier: "standard",
    creditLimit: 1000000,
  }).id;
  f.app.catalog.setPurchasingPolicy(f.actor, "synthetic-extra-account-access", {
    accountId: other,
    mode: "all",
    requiresReview: false,
    productIds: [],
    revision: 0,
    reason: "Explicit synthetic account access for this test.",
  });
  ship(f, accept({ ...f, buyer: other }, 1, "resale").id);
  const buyer = warrantyUser(f, "buyer");
  assert.throws(() => f.app.warranty.coverage(buyer, unitId, f.buyer), {
    code: "NOT_FOUND",
  });
  const resale = f.app.warranty.coverage(f.actor, unitId, other);
  assert.equal(resale.source, "shipment_policy");
  assert.notEqual(resale.shipmentId, inherited.shipmentId);
  assert.notEqual(resale.invoiceId, inherited.invoiceId);
  assert.notEqual(resale.shippedAt, start);
});
test("coverage uses current grants and account scope despite forged actor properties and earlier successful reads", (t) => {
  const f = fixture(t),
    unitId = sold(f),
    buyer = warrantyUser(f, "buyer");
  assert.equal(f.app.warranty.coverage(buyer, unitId, f.buyer).serial, "S1");
  const other = f.app.identity.createCustomer(f.actor, "other", {
    name: "Other",
    tier: "standard",
    creditLimit: 1000000,
  }).id;
  assert.throws(
    () =>
      f.app.warranty.coverage(
        { ...buyer, role: "admin", accountId: other },
        unitId,
        other,
      ),
    { code: "FORBIDDEN" },
  );
  warrantyGrants(f, buyer, { accountId: other });
  assert.throws(() => f.app.warranty.coverage(buyer, unitId, f.buyer), {
    code: "FORBIDDEN",
  });
  for (const role of ["warehouse", "finance", "support"] as const)
    assert.throws(
      () => f.app.warranty.coverage(warrantyUser(f, role), unitId, f.buyer),
      { code: "FORBIDDEN" },
    );
});
for (const days of [-1, 1.5, "365", null, 36501])
  test(`invalid provisional duration ${JSON.stringify(days)} rejects preview and claim before retained writes`, (t) => {
    const f = fixture(t),
      unitId = sold(f);
    duration(f, days);
    const before = facts(f);
    assert.throws(() => f.app.warranty.coverage(f.actor, unitId, f.buyer), {
      code: "COVERAGE_POLICY",
    });
    assert.throws(
      () =>
        f.app.warranty.submit(f.actor, "invalid", {
          accountId: f.buyer,
          unitId,
          type: "warranty",
          issue: "Synthetic",
          evidence: "Synthetic",
        }),
      { code: "COVERAGE_POLICY" },
    );
    assert.deepEqual(facts(f), before);
  });
test("zero-day provisional duration is valid and malformed/overflowing shipment dates fail without retained writes", (t) => {
  const f = fixture(t),
    unitId = sold(f);
  duration(f, 0);
  assert.equal(
    f.app.warranty.coverage(f.actor, unitId, f.buyer).coverageEnd,
    start,
  );
  duration(f, 365);
  for (const date of [
    "not-a-date",
    "2024-02-29T12:00:00-05:00",
    "+275760-09-13T00:00:00.000Z",
  ]) {
    f.app.database
      .owned("fulfillment")
      .run("UPDATE fulfillment_shipments SET shipped_at=?", date);
    const before = facts(f);
    assert.throws(() => f.app.warranty.coverage(f.actor, unitId, f.buyer), {
      code: "COVERAGE_DATE",
    });
    assert.throws(
      () =>
        f.app.warranty.submit(f.actor, "invalid-date", {
          accountId: f.buyer,
          unitId,
          type: "return",
          issue: "Synthetic",
          evidence: "Synthetic",
        }),
      { code: "COVERAGE_DATE" },
    );
    assert.deepEqual(facts(f), before);
  }
});
test("HTTP coverage requires authentication, strict inputs, fresh buyer scope and private noncached responses", async (t) => {
  const f = fixture(t),
    unitId = sold(f),
    buyer = warrantyUser(f, "buyer");
  const origin = "http://127.0.0.1:3000",
    http = await createHttp(f.app, {
      origin,
      staticRoot: "/nonexistent-distributor-test",
    });
  t.after(() => http.close());
  const url = `/api/warranty/sold-units/${unitId}/coverage?accountId=${f.buyer}`;
  assert.equal((await http.inject({ method: "GET", url })).statusCode, 401);
  const email = f.app.identity
    .users(f.actor)
    .find((u) => u.id === buyer.id)!.email;
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: { email, password: "long-user-test-password" },
  });
  assert.equal(login.statusCode, 200);
  const cookie = login.cookies[0]!,
    headers = { cookie: `${cookie.name}=${cookie.value}` };
  const reply = await http.inject({ method: "GET", url, headers });
  assert.equal(reply.statusCode, 200);
  assert.equal(reply.json().coverageEnd, end);
  assert.equal(reply.json().eligibility, "requires_review");
  assert.equal(reply.headers["cache-control"], "no-store");
  for (const bad of [
    `${url}&unexpected=true`,
    `${url}&accountId=${f.buyer}`,
    `/api/warranty/sold-units/${unitId}/coverage`,
  ])
    assert.equal(
      (await http.inject({ method: "GET", url: bad, headers })).statusCode,
      400,
    );
  warrantyGrants(f, buyer, { active: false });
  assert.equal(
    (await http.inject({ method: "GET", url, headers })).statusCode,
    401,
  );
});
