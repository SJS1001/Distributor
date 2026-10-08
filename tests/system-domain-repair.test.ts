import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, accept, ship } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { warrantyUser, warrantyGrants } from "./warranty-authority-fixtures.ts";

type Fixture = ReturnType<typeof fixture>;
function repair(f: Fixture, serial = "S1", key = "repair") {
  const unitId = f.app.inventory.trace(f.actor, serial).unit.id;
  const claim = f.app.warranty.submit(f.actor, key + "claim", {
    accountId: f.buyer,
    unitId,
    type: "warranty",
    issue: "Synthetic repairable fault",
    evidence: "Synthetic claim",
  });
  f.app.warranty.review(f.actor, key + "approve", {
    claimId: claim.id,
    approved: true,
    reason: "Approved",
  });
  f.app.warranty.receive(f.actor, key + "receive", {
    claimId: claim.id,
    warehouseId: f.w1,
    bin: "Q",
    serial,
  });
  f.app.warranty.inspect(f.actor, key + "inspect", {
    claimId: claim.id,
    findings: "Synthetic repair findings",
  });
  f.app.warranty.dispose(f.actor, key + "disposition", {
    claimId: claim.id,
    disposition: "repair",
    reason: "Synthetic repair approval",
  });
  const review = f.app.warranty.repairReview(f.actor, claim.id);
  return {
    claim,
    review,
    input: {
      claimId: claim.id,
      unitRevision: review.unitRevision,
      serial,
      recipient: "Synthetic recipient",
      evidence: "Synthetic signed repair collection",
      reason: "Repair complete",
    },
  };
}
function money(f: Fixture) {
  return {
    orders: f.app.orders.list(f.actor),
    invoices: f.app.billing.invoices(f.actor),
    shipments: f.app.fulfillment.shipments(f.actor),
    exposure: f.app.billing.exposure(f.actor, f.buyer),
  };
}
function facts(f: Fixture) {
  return {
    money: money(f),
    stock: f.app.inventory.trace(f.actor, "S1"),
    claims: f.app.warranty.list(f.actor),
    decisions: f.app.database
      .owned("warranty")
      .all("SELECT * FROM warranty_decisions"),
    commands: f.app.database
      .owned("platform")
      .all("SELECT * FROM platform_commands"),
    audit: f.app.database.owned("platform").all("SELECT * FROM platform_audit"),
    events: f.app.database
      .owned("platform")
      .all("SELECT * FROM platform_events"),
  };
}
test("original repaired serial hands back once with original coverage and registration identity, no new commercial effect, and survives another repair/restart", (t) => {
  const f = fixture(t),
    shipment = ship(f, accept(f).id),
    unitId = f.app.inventory.trace(f.actor, "S1").unit.id;
  const original = f.app.warranty.coverage(f.actor, unitId, f.buyer);
  const beforeRegistration = f.app.warranty.registration.review(
    f.actor,
    unitId,
    f.buyer,
  );
  f.app.warranty.registration.save(f.actor, "installation", {
    unitId,
    accountId: f.buyer,
    shipmentId: shipment.id,
    ownershipId: beforeRegistration.ownershipId,
    expectedRevision: 0,
    installedOn: original.shippedAt.slice(0, 10),
    installer: "Synthetic installer",
    site: "Synthetic site",
    evidence: "Synthetic installation",
    reason: "Synthetic registration",
  });
  const registration = f.app.warranty.registration.review(
    f.actor,
    unitId,
    f.buyer,
  );
  const { claim, input } = repair(f),
    beforeMoney = money(f),
    beforeCost = f.app.inventory.costs.window(f.actor, 0);
  const receipt = f.app.warranty.handoverRepair(f.actor, "handover", input);
  assert.equal(receipt.shipmentId, shipment.id);
  assert.equal(receipt.invoiceId, shipment.invoiceId);
  assert.equal(receipt.coverageEnd, original.coverageEnd);
  assert.deepEqual(
    f.app.warranty.handoverRepair(f.actor, "handover", input),
    receipt,
  );
  assert.throws(
    () => f.app.warranty.handoverRepair(f.actor, "other-key", input),
    { code: "REMEDY" },
  );
  assert.throws(
    () =>
      f.app.warranty.handoverRepair(f.actor, "handover", {
        ...input,
        recipient: "Other recipient",
      }),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  assert.throws(
    () =>
      f.app.warranty.credit(f.actor, "credit-after-repair", {
        claimId: claim.id,
        reason: "Second remedy",
      }),
    { code: "STATE" },
  );
  assert.deepEqual(money(f), beforeMoney);
  const costWindow = f.app.inventory.costs.window(f.actor, 0);
  const handovers = costWindow.movements.filter(
    (m) => m.type === "repair.handover",
  );
  assert.equal(handovers.length, 1);
  assert.equal(handovers[0]!.quantity, -1);
  assert.equal(handovers[0]!.valueDelta, -handovers[0]!.unitCost);
  assert.equal(handovers[0]!.reference, claim.id);
  assert.equal(
    costWindow.closingValue,
    beforeCost.closingValue - handovers[0]!.unitCost,
  );
  assert.equal(f.app.inventory.controlTotals(f.actor).issues.count, 0);
  const controls = f.app.reconciliation(f.actor);
  assert.equal(controls.stock.issues.count, 0);
  assert.equal(controls.sales.issues.count, 0);
  assert.equal(controls.billing.issues.count, 0);
  const returned = f.app.inventory.trace(f.actor, "S1");
  assert.equal(returned.unit.state, "sold");
  assert.equal(returned.unit.quantity, 0);
  assert.equal(
    returned.movements.filter((m) => m.type === "repair.handover").length,
    1,
  );
  assert.equal(
    f.app.warranty.soldUnits(f.actor).find((u) => u.id === unitId)?.accountId,
    f.buyer,
  );
  const afterRegistration = f.app.warranty.registration.review(
    f.actor,
    unitId,
    f.buyer,
  );
  assert.equal(afterRegistration.ownershipId, registration.ownershipId);
  assert.deepEqual(afterRegistration.registration, registration.registration);
  assert.equal(
    afterRegistration.returnEligibility.startsAt,
    registration.returnEligibility.startsAt,
  );
  const saved = facts(f);
  f.app.close();
  f.app = new Application(f.path, "CA");
  assert.deepEqual(facts(f), saved);
  assert.deepEqual(
    f.app.warranty.handoverRepair(f.actor, "handover", input),
    receipt,
  );
  const again = repair(f, "S1", "again");
  f.app.warranty.handoverRepair(f.actor, "again-handover", again.input);
  assert.equal(
    f.app.warranty.coverage(f.actor, unitId, f.buyer).coverageEnd,
    original.coverageEnd,
  );
  assert.equal(
    f.app.warranty.registration.review(f.actor, unitId, f.buyer).ownershipId,
    registration.ownershipId,
  );
});
test("repair handover removes retained adjusted carrying value without changing acquisition cost", (t) => {
  const f = fixture(t),
    second = warrantyUser(f, "finance"),
    unit = f.app.inventory.trace(f.actor, "S1").unit;
  f.app.inventory.valuations.configure(f.actor, "repair-value-policy", {
    productId: unit.product_id,
    previousRevision: 0,
    policyVersion: "synthetic-repair-value-1",
    establishedBasis: "Synthetic accountant-approved specific value",
    establishedMethod: "specific-identification",
    effectiveFrom: "2026-01-01",
    closedThrough: null,
    financeEvidence: "Synthetic method approval",
    nonInterchangeableEvidence: "Synthetic serial-specific equipment",
  });
  const valueReview = f.app.inventory.valuations.review(f.actor, unit.id);
  const prepared = f.app.inventory.valuations.prepare(f.actor, "repair-value", {
    unitId: unit.id,
    reviewHash: valueReview.reviewHash,
    reference: "REPAIR-VALUE",
    kind: "write-down",
    targetValue: 4000,
    postingDate: "2026-10-03",
    reason: "Synthetic value decrease",
    evidence: "Synthetic recoverable value",
    accountantEvidence: "Synthetic accountant classification",
  });
  f.app.inventory.valuations.decide(second, "repair-value-approve", {
    valuationId: prepared.id,
    reviewHash: prepared.reviewHash,
    decision: "approve",
    reason: "Synthetic independent approval",
  });
  ship(f, accept(f).id);
  const { input } = repair(f),
    before = f.app.inventory.costs.window(f.actor, 0);
  f.app.warranty.handoverRepair(f.actor, "valued-repair-handover", input);
  const after = f.app.inventory.costs.window(f.actor, before.throughSequence);
  assert.equal(after.movements.length, 1);
  assert.equal(after.movements[0]!.type, "repair.handover");
  assert.equal(after.movements[0]!.unitCost, 6000);
  assert.equal(after.movements[0]!.valueDelta, -4000);
  assert.equal(after.closingValue, before.closingValue - 4000);
  assert.equal(f.app.inventory.unit(f.actor, unit.id).cost, 6000);
  assert.equal(f.app.inventory.controlTotals(f.actor).issues.count, 0);
});

test("repair handover rejects stale stock, scans, second remedies and current authority; exact replay reauthorizes", (t) => {
  const f = fixture(t);
  ship(f, accept(f).id);
  const { claim, input, review } = repair(f),
    before = facts(f);
  assert.throws(
    () =>
      f.app.warranty.handoverRepair(f.actor, "stale", {
        ...input,
        unitRevision: input.unitRevision - 1,
      }),
    { code: "REVISION" },
  );
  assert.throws(
    () =>
      f.app.warranty.handoverRepair(f.actor, "wrong", {
        ...input,
        serial: "S2",
      }),
    { code: "SERIAL" },
  );
  assert.throws(
    () =>
      f.app.warranty.handoverRepair(f.actor, "blank", {
        ...input,
        evidence: "",
      }),
    { code: "VALIDATION" },
  );
  assert.deepEqual(facts(f), before);
  const r = f.app.warranty.reserveReplacement(f.actor, "replacement", {
    claimId: claim.id,
    newUnitId: f.app.inventory.trace(f.actor, "S2").unit.id,
    oldDisposition: "scrap",
    coveragePolicy: "inherit_original",
    reason: "Synthetic alternate remedy",
  });
  assert.throws(() => f.app.warranty.repairReview(f.actor, claim.id), {
    code: "REMEDY",
  });
  assert.throws(
    () => f.app.warranty.handoverRepair(f.actor, "conflict", input),
    { code: "REMEDY" },
  );
  f.app.warranty.cancelReplacement(f.actor, "cancel", {
    replacementId: r.id,
    revision: 1,
    reason: "Repair selected",
  });
  const worker = warrantyUser(f, "warehouse"),
    buyer = warrantyUser(f, "buyer");
  assert.deepEqual(f.app.warranty.repairReview(worker, claim.id), review);
  assert.throws(() => f.app.warranty.repairReview(buyer, claim.id), {
    code: "FORBIDDEN",
  });
  const receipt = f.app.warranty.handoverRepair(worker, "handover", input);
  warrantyGrants(f, worker, { sites: [f.w2] });
  assert.throws(
    () => f.app.warranty.handoverRepair(worker, "handover", input),
    { code: "FORBIDDEN" },
  );
  warrantyGrants(f, worker, { sites: [f.w1], active: false });
  assert.throws(
    () => f.app.warranty.handoverRepair(worker, "handover", input),
    { code: "FORBIDDEN" },
  );
  assert.equal(receipt.state, "disposed");
});
test("late repair handover activity/receipt failures roll back stock, claim, money, history and permanent commands", (t) => {
  const f = fixture(t);
  ship(f, accept(f).id);
  const { input } = repair(f);
  const audit = f.app.platform.audit.bind(f.app.platform);
  for (const failureAt of [1, 2]) {
    let matchingAudits = 0;
    const before = facts(f);
    f.app.platform.audit = (actor, name, reference, detail) => {
      if (name === "warranty.repair.handover" && ++matchingAudits === failureAt)
        throw new Error("Synthetic late repair failure");
      audit(actor, name, reference, detail);
    };
    try {
      assert.throws(
        () => f.app.warranty.handoverRepair(f.actor, "handover", input),
        /Synthetic late repair failure/,
      );
    } finally {
      f.app.platform.audit = audit;
    }
    assert.deepEqual(facts(f), before);
  }
  f.app.warranty.handoverRepair(f.actor, "handover", input);
  assert.equal(f.app.inventory.trace(f.actor, "S1").unit.state, "sold");
});

test("repair retains replacement ownership and inherited coverage while buyer projection keeps collection evidence private", (t) => {
  const f = fixture(t);
  const shipment = ship(f, accept(f).id);
  const first = repair(f);
  const reserved = f.app.warranty.reserveReplacement(f.actor, "reserve", {
    claimId: first.claim.id,
    newUnitId: f.app.inventory.trace(f.actor, "S2").unit.id,
    oldDisposition: "scrap",
    coveragePolicy: "inherit_original",
    reason: "Alternate remedy",
  });
  f.app.warranty.handoverReplacement(f.actor, "replace", {
    replacementId: reserved.id,
    revision: 1,
    serial: "S2",
    recipient: "Synthetic recipient",
    evidence: "Replacement collected",
  });
  const original = f.app.warranty.registration.review(
    f.actor,
    f.app.inventory.trace(f.actor, "S2").unit.id,
    f.buyer,
  );
  const next = repair(f, "S2", "second");
  const receipt = f.app.warranty.handoverRepair(
    f.actor,
    "repair-handover",
    next.input,
  );
  const current = f.app.warranty.registration.review(
    f.actor,
    f.app.inventory.trace(f.actor, "S2").unit.id,
    f.buyer,
  );
  assert.equal(current.ownershipId, original.ownershipId);
  assert.equal(
    current.returnEligibility.startsAt,
    original.returnEligibility.startsAt,
  );
  assert.equal(receipt.shipmentId, shipment.id);
  assert.equal(
    receipt.coverageEnd,
    f.app.warranty.coverage(
      f.actor,
      f.app.inventory.trace(f.actor, "S2").unit.id,
      f.buyer,
    ).coverageEnd,
  );
  const buyer = warrantyUser(f, "buyer");
  const staff = f.app.warranty
    .claimPage(f.actor)
    .items.find((c) => c.id === next.claim.id)!;
  const publicClaim = f.app.warranty
    .claimPage(buyer)
    .items.find((c) => c.id === next.claim.id)!;
  assert.deepEqual(staff.repairHandover, receipt);
  assert.equal(publicClaim.repairHandover?.completedAt, receipt.completedAt);
  for (const field of ["recipient", "evidence", "reason"])
    assert.equal(field in publicClaim.repairHandover!, false);
  const successor = f.app.warranty.submit(f.actor, "successor", {
    accountId: f.buyer,
    unitId: f.app.inventory.trace(f.actor, "S2").unit.id,
    type: "warranty",
    issue: "Another fault",
    evidence: "Synthetic follow-up",
  });
  assert.equal(
    f.app.warranty.claimCoverage(f.actor, successor.id).snapshot
      ?.inheritedFromClaimId,
    first.claim.id,
  );
});
