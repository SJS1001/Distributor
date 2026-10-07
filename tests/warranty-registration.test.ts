import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, accept, ship } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import { warrantyUser, warrantyGrants } from "./warranty-authority-fixtures.ts";
type Fixture = ReturnType<typeof fixture>;
function sold(f: Fixture) {
  const shipment = ship(f, accept(f).id);
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
  const unitId = f.app.inventory.trace(f.actor, "S1").unit.id;
  return {
    unitId,
    accountId: f.buyer,
    shipmentId: shipment.id,
    ownershipId: shipment.id,
    expectedRevision: 0,
    installedOn: "2024-03-01",
    installer: "Synthetic installer",
    site: "Synthetic site",
    evidence: "synthetic:installation",
    reason: "Record installation",
  };
}
function configure(f: Fixture, unitId: string) {
  const productId = f.app.inventory.unit(f.actor, unitId).product_id;
  f.app.warranty.registration.saveReturnPolicy(f.actor, "return-policy", {
    expectedRevision: 0,
    days: 30,
    reason: "Synthetic return policy",
  });
  f.app.warranty.registration.saveTerms(f.actor, "terms", {
    productId,
    expectedRevision: 0,
    manufacturer: "Synthetic manufacturer",
    reference: "synthetic:terms",
    startsAt: "installation",
    days: 3650,
    notes: "Synthetic fixture only",
    reason: "Synthetic warranty term",
  });
  return productId;
}
function rows(f: Fixture) {
  return f.app.database
    .owned("warranty")
    .all<{ name: string }>(
      "SELECT name FROM sqlite_schema WHERE type='table' AND name GLOB 'warranty_*' ORDER BY name",
    )
    .map(({ name }) =>
      f.app.database
        .owned("warranty")
        .all(`SELECT * FROM ${name} ORDER BY rowid`),
    );
}
test("installation registration and configured warranty remain separate from elapsed ordinary returns; claim snapshots and history persist", (t) => {
  const f = fixture(t),
    input = sold(f),
    buyer = warrantyUser(f, "buyer"),
    api = f.app.warranty.registration;
  t.mock.timers.enable({
    apis: ["Date"],
    now: Date.parse("2026-10-07T12:00:00.000Z"),
  });
  const initial = api.review(buyer, input.unitId, f.buyer);
  assert.equal(initial.returnEligibility.datePosition, "unconfigured");
  assert.equal(initial.warrantyEligibility.source, "unconfigured");
  const productId = configure(f, input.unitId);
  assert.equal(
    api.review(buyer, input.unitId, f.buyer).warrantyEligibility.datePosition,
    "registration_required",
  );
  const saved = api.save(buyer, "register", input);
  assert.deepEqual(api.save(buyer, "register", input), saved);
  assert.throws(
    () => api.save(buyer, "register", { ...input, installer: "Different" }),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  const reviewed = api.review(buyer, input.unitId, f.buyer);
  assert.equal(reviewed.returnEligibility.datePosition, "elapsed");
  assert.equal(reviewed.warrantyEligibility.datePosition, "within_dates");
  assert.equal(reviewed.returnEligibility.requiresReview, true);
  assert.equal(
    reviewed.warrantyEligibility.startsAt,
    "2024-03-01T00:00:00.000Z",
  );
  assert.equal(reviewed.warrantyEligibility.endAt, "2034-02-27T00:00:00.000Z");
  const submission = {
    accountId: f.buyer,
    unitId: input.unitId,
    type: "warranty" as const,
    issue: "Synthetic failure",
    evidence: "Synthetic evidence",
    registrationRevision: 1,
    termsRevision: 1,
    returnPolicyRevision: 1,
  };
  const before = rows(f);
  assert.throws(
    () =>
      f.app.warranty.submit(buyer, "stale-claim", {
        ...submission,
        registrationRevision: 0,
      }),
    { code: "REVISION" },
  );
  assert.deepEqual(rows(f), before);
  const claim = f.app.warranty.submit(buyer, "claim", submission),
    snapshot = api.claimAssessment(buyer, claim.id).snapshot;
  assert.equal(f.app.warranty.claim(buyer, claim.id).state, "submitted");
  assert.equal(snapshot!.returnEligibility.datePosition, "elapsed");
  assert.equal(claim.coverageEnd, "2025-02-28T12:00:00.000Z");
  api.save(buyer, "correct", {
    ...input,
    expectedRevision: 1,
    installedOn: "2024-03-02",
    reason: "Correct evidence-backed installation date",
  });
  api.saveReturnPolicy(f.actor, "correct-policy", {
    expectedRevision: 1,
    days: null,
    reason: "Pending policy review",
  });
  const after = api.claimAssessment(buyer, claim.id);
  assert.deepEqual(after.snapshot, snapshot);
  assert.equal(after.current.registration!.revision, 2);
  assert.equal(after.current.returnEligibility.datePosition, "unconfigured");
  assert.deepEqual(
    api.review(buyer, input.unitId, f.buyer).history.map((r) => r.revision),
    [1, 2],
  );
  assert.equal(
    f.app.database
      .owned("warranty")
      .get<{ n: number }>("SELECT COUNT(*) n FROM warranty_manufacturer_cases")!
      .n,
    0,
  );
  f.app.close();
  f.app = new Application(f.path, "CA");
  assert.deepEqual(
    f.app.warranty.registration.claimAssessment(buyer, claim.id).snapshot,
    snapshot,
  );
  assert.equal(
    f.app.warranty.registration.terms(f.actor, productId).revision,
    1,
  );
});
test("registration validates dates, revisions and required evidence with no retained partial writes", (t) => {
  const f = fixture(t),
    input = sold(f),
    api = f.app.warranty.registration;
  for (const invalid of [
    { installedOn: "2024-02-30" },
    { installedOn: "2023-12-01" },
    { installedOn: "2999-01-01" },
    { evidence: "" },
    { reason: "" },
    { expectedRevision: 1 },
  ]) {
    const before = rows(f);
    assert.throws(() =>
      api.save(f.actor, JSON.stringify(invalid), { ...input, ...invalid }),
    );
    assert.deepEqual(rows(f), before);
  }
  for (const days of [-1, 0.5, 36501])
    assert.throws(
      () =>
        api.saveReturnPolicy(f.actor, `bad-${days}`, {
          expectedRevision: 0,
          days,
          reason: "Synthetic",
        }),
      { code: "VALIDATION" },
    );
  api.saveReturnPolicy(f.actor, "zero", {
    expectedRevision: 0,
    days: 0,
    reason: "Synthetic zero-day term",
  });
  t.mock.timers.enable({
    apis: ["Date"],
    now: Date.parse("2024-02-29T12:00:00.000Z"),
  });
  assert.equal(
    api.review(f.actor, input.unitId, f.buyer).returnEligibility.datePosition,
    "elapsed",
  );
});
test("registration and policy commands recheck current actor/account grants on cached replay", (t) => {
  const f = fixture(t),
    input = sold(f),
    buyer = warrantyUser(f, "buyer"),
    api = f.app.warranty.registration;
  api.save(buyer, "cached", input);
  assert.throws(
    () =>
      api.saveReturnPolicy({ ...buyer, role: "admin" }, "forged", {
        expectedRevision: 0,
        days: 30,
        reason: "Synthetic",
      }),
    { code: "FORBIDDEN" },
  );
  const other = f.app.identity.createCustomer(f.actor, "other", {
    name: "Other",
    tier: "standard",
    creditLimit: 1000,
  }).id;
  assert.throws(
    () => api.review({ ...buyer, accountId: other }, input.unitId, other),
    { code: "FORBIDDEN" },
  );
  warrantyGrants(f, buyer, { accountId: other });
  assert.throws(() => api.save(buyer, "cached", input), { code: "FORBIDDEN" });
  assert.throws(() => api.review(buyer, input.unitId, f.buyer), {
    code: "FORBIDDEN",
  });
  for (const role of ["warehouse", "finance", "support"] as const)
    assert.throws(
      () => api.review(warrantyUser(f, role), input.unitId, f.buyer),
      { code: "FORBIDDEN" },
    );
});
test("HTTP registration authenticates, rejects extra fields and stale writes, exposes account-scoped history and assessment", async (t) => {
  const f = fixture(t),
    input = sold(f),
    origin = "http://127.0.0.1:3000",
    http = await createHttp(f.app, {
      origin,
      staticRoot: "/nonexistent-distributor-test",
    });
  t.after(() => http.close());
  const url = `/api/warranty/sold-units/${input.unitId}/registration?accountId=${f.buyer}`;
  assert.equal((await http.inject({ method: "GET", url })).statusCode, 401);
  const login = await http.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: {
        email: "admin@example.test",
        password: "long-test-only-password",
      },
    }),
    cookie = login.cookies[0]!,
    headers = {
      origin,
      cookie: `${cookie.name}=${cookie.value}`,
      "x-csrf-token": login.json().csrf,
      "idempotency-key": "http-register",
    };
  const read = await http.inject({ method: "GET", url, headers });
  assert.equal(read.statusCode, 200);
  assert.equal(read.headers["cache-control"], "no-store");
  assert.equal(
    (await http.inject({ method: "GET", url: `${url}&extra=true`, headers }))
      .statusCode,
    400,
  );
  const command = "/api/commands/warranty.registration.save";
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: command,
        headers,
        payload: { ...input, extra: true },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: command,
        headers: { ...headers, "x-csrf-token": "bad" },
        payload: input,
      })
    ).statusCode,
    403,
  );
  const saved = await http.inject({
    method: "POST",
    url: command,
    headers,
    payload: input,
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().revision, 1);
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: command,
        headers: { ...headers, "idempotency-key": "stale" },
        payload: input,
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (await http.inject({ method: "GET", url, headers })).json().history.length,
    1,
  );
  const c = f.app.warranty.submit(f.actor, "http-claim", {
    accountId: f.buyer,
    unitId: input.unitId,
    type: "return",
    issue: "Synthetic",
    evidence: "Synthetic",
  });
  const assessment = await http.inject({
    method: "GET",
    url: `/api/warranty/claims/${c.id}/assessment`,
    headers,
  });
  assert.equal(assessment.statusCode, 200);
  assert.equal(assessment.json().snapshot.registration.revision, 1);
});
test("replacement retains original warranty dates while ordinary returns start at replacement handover", (t) => {
  const f = fixture(t),
    input = sold(f),
    buyer = warrantyUser(f, "buyer"),
    api = f.app.warranty.registration,
    productId = configure(f, input.unitId);
  t.mock.timers.enable({
    apis: ["Date"],
    now: Date.parse("2026-10-07T12:00:00.000Z"),
  });
  api.save(buyer, "register", input);
  const c = f.app.warranty.submit(buyer, "claim", {
      accountId: f.buyer,
      unitId: input.unitId,
      type: "warranty",
      issue: "Synthetic",
      evidence: "Synthetic",
    }),
    retained = api.claimAssessment(buyer, c.id).snapshot!;
  f.app.warranty.review(f.actor, "review", {
    claimId: c.id,
    approved: true,
    reason: "Synthetic",
  });
  f.app.warranty.receive(f.actor, "receive", {
    claimId: c.id,
    warehouseId: f.w1,
    bin: "Q",
    serial: "S1",
  });
  f.app.warranty.inspect(f.actor, "inspect", {
    claimId: c.id,
    findings: "Synthetic",
  });
  assert.deepEqual(api.claimAssessment(buyer, c.id).snapshot, retained);
  const unitId = f.app.inventory.trace(f.actor, "S2").unit.id,
    r = f.app.warranty.reserveReplacement(f.actor, "replace", {
      claimId: c.id,
      newUnitId: unitId,
      oldDisposition: "restock",
      coveragePolicy: "inherit_original",
      reason: "Synthetic",
    });
  f.app.warranty.handoverReplacement(f.actor, "handover", {
    replacementId: r.id,
    revision: 1,
    serial: "S2",
    recipient: "Synthetic",
    evidence: "Synthetic",
  });
  api.saveTerms(f.actor, "change-terms", {
    productId,
    expectedRevision: 1,
    manufacturer: "Synthetic",
    reference: "synthetic:new",
    startsAt: "shipment",
    days: 1,
    notes: "Synthetic",
    reason: "Synthetic",
  });
  const review = api.review(buyer, unitId, f.buyer);
  assert.equal(review.warrantyEligibility.source, "replacement_inherited");
  assert.equal(
    review.warrantyEligibility.endAt,
    retained.warrantyEligibility.endAt,
  );
  assert.equal(
    review.warrantyEligibility.startsAt,
    retained.warrantyEligibility.startsAt,
  );
  assert.equal(review.returnEligibility.startsAt, "2026-10-07T12:00:00.000Z");
  assert.equal(review.returnEligibility.datePosition, "within_window");
  const next = f.app.warranty.submit(buyer, "successor", {
    accountId: f.buyer,
    unitId,
    type: "warranty",
    issue: "Synthetic",
    evidence: "Synthetic",
  });
  assert.equal(
    api.claimAssessment(buyer, next.id).snapshot!.warrantyEligibility.endAt,
    retained.warrantyEligibility.endAt,
  );
  assert.equal(
    api.claimAssessment(buyer, next.id).current.returnEligibility.startsAt,
    review.returnEligibility.startsAt,
  );
});
test("returned serial reused as replacement has a fresh ownership installation and rejects old cached registration", (t) => {
  const f = fixture(t),
    first = sold(f),
    api = f.app.warranty.registration;
  t.mock.timers.enable({
    apis: ["Date"],
    now: Date.parse("2026-10-07T12:00:00.000Z"),
  });
  api.save(f.actor, "original-install", first);
  function replace(
    unitId: string,
    serial: string,
    newUnitId: string,
    newSerial: string,
    key: string,
  ) {
    const claim = f.app.warranty.submit(f.actor, key + "claim", {
      accountId: f.buyer,
      unitId,
      type: "warranty",
      issue: "Synthetic",
      evidence: "Synthetic",
    });
    f.app.warranty.review(f.actor, key + "review", {
      claimId: claim.id,
      approved: true,
      reason: "Synthetic",
    });
    f.app.warranty.receive(f.actor, key + "receive", {
      claimId: claim.id,
      warehouseId: f.w1,
      bin: "Q",
      serial,
    });
    f.app.warranty.inspect(f.actor, key + "inspect", {
      claimId: claim.id,
      findings: "Synthetic",
    });
    const replacement = f.app.warranty.reserveReplacement(
      f.actor,
      key + "reserve",
      {
        claimId: claim.id,
        newUnitId,
        oldDisposition: "restock",
        coveragePolicy: "inherit_original",
        reason: "Synthetic",
      },
    );
    f.app.warranty.handoverReplacement(f.actor, key + "handover", {
      replacementId: replacement.id,
      revision: 1,
      serial: newSerial,
      recipient: "Synthetic",
      evidence: "Synthetic",
    });
  }
  const second = f.app.inventory.trace(f.actor, "S2").unit.id;
  replace(first.unitId, "S1", second, "S2", "one");
  replace(second, "S2", first.unitId, "S1", "two");
  const review = api.review(f.actor, first.unitId, f.buyer);
  assert.equal(review.shipmentId, first.shipmentId);
  assert.notEqual(review.ownershipId, first.ownershipId);
  assert.equal(review.registration, null);
  assert.deepEqual(review.history, []);
  assert.throws(() => api.save(f.actor, "original-install", first), {
    code: "REVISION",
  });
  api.save(f.actor, "new-install", {
    ...first,
    ownershipId: review.ownershipId,
    installedOn: "2026-10-07",
    reason: "Install reused replacement",
  });
  assert.equal(
    api.review(f.actor, first.unitId, f.buyer).registration!.revision,
    1,
  );
});
test("late audit failure rolls back registration, correction history and command receipt together", (t) => {
  const f = fixture(t),
    input = sold(f),
    before = rows(f),
    platform = f.app.database.owned("platform"),
    commands = platform.all("SELECT * FROM platform_commands ORDER BY rowid");
  t.mock.method(f.app.platform, "audit", () => {
    throw new Error("Synthetic audit failure");
  });
  assert.throws(
    () => f.app.warranty.registration.save(f.actor, "late-failure", input),
    /Synthetic audit failure/,
  );
  assert.deepEqual(rows(f), before);
  assert.deepEqual(
    platform.all("SELECT * FROM platform_commands ORDER BY rowid"),
    commands,
  );
});
