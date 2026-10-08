import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, accept, ship } from "./fixtures.ts";

function returned(f: ReturnType<typeof fixture>) {
  ship(f, accept(f).id);
  const unit = f.app.inventory.trace(f.actor, "S1").unit;
  const claim = f.app.warranty.submit(f.actor, "claim", {
    accountId: f.buyer,
    unitId: unit.id,
    type: "warranty",
    issue: "Synthetic failure",
    evidence: "Synthetic evidence",
  });
  f.app.warranty.review(f.actor, "approve", {
    claimId: claim.id,
    approved: true,
    reason: "Synthetic approval",
  });
  f.app.warranty.receive(f.actor, "return", {
    claimId: claim.id,
    warehouseId: f.w1,
    bin: "Q",
    serial: "S1",
  });
  return { claim, unit: f.app.inventory.trace(f.actor, "S1").unit };
}

test("received, inspected and repairing customer serials reject generic stock release and supplier handover without effects", (t) => {
  const f = fixture(t),
    { claim, unit } = returned(f);
  for (const state of ["received", "inspected", "repair"] as const) {
    const before = f.app.inventory.trace(f.actor, "S1");
    const commands = f.app.database
      .owned("platform")
      .all("SELECT * FROM platform_commands");
    assert.throws(
      () =>
        f.app.inventory.inspect(f.actor, `inspect-${state}`, {
          unitId: unit.id,
          revision: before.unit.revision,
          condition: "usable",
          reason: "Generic release",
        }),
      { code: "WARRANTY_CUSTODY" },
    );
    assert.throws(
      () =>
        f.app.database.transaction(() =>
          f.app.inventory.returnToSupplier(
            f.actor,
            {
              unitId: unit.id,
              receiptId: f.app.inventory.purchaseOrigin(f.actor, unit.id)!,
              revision: before.unit.revision,
              quantity: 1,
              serial: "S1",
              reason: "Generic supplier handover",
            },
            `supplier-${state}`,
          ),
        ),
      { code: "WARRANTY_CUSTODY" },
    );
    assert.throws(
      () =>
        f.app.inventory.inspect(f.actor, `damaged-${state}`, {
          unitId: unit.id,
          revision: before.unit.revision,
          condition: "damaged",
          reason: "Generic damage",
        }),
      { code: "WARRANTY_CUSTODY" },
    );
    assert.throws(
      () =>
        f.app.inventory.adjustCount(f.actor, `count-${state}`, {
          unitId: unit.id,
          revision: before.unit.revision,
          count: 0,
          reason: "Generic quantity reduction",
        }),
      { code: "WARRANTY_CUSTODY" },
    );
    assert.throws(
      () =>
        f.app.inventory.quantityCorrections.review(
          f.actor,
          unit.id,
          String(before.movements[0]!.id),
        ),
      { code: "QUANTITY_CUSTODY" },
    );
    assert.throws(
      () =>
        f.app.inventory.dispatchTransfer(f.actor, `transfer-${state}`, {
          destinationId: f.w2,
          unitId: unit.id,
          quantity: 1,
          revision: before.unit.revision,
          reason: "Generic site handover",
        }),
      { code: "WARRANTY_CUSTODY" },
    );
    assert.deepEqual(f.app.inventory.trace(f.actor, "S1"), before);
    assert.deepEqual(
      f.app.database.owned("platform").all("SELECT * FROM platform_commands"),
      commands,
    );
    if (state === "received")
      f.app.warranty.inspect(f.actor, "inspect-return", {
        claimId: claim.id,
        findings: "Repairable",
      });
    if (state === "inspected")
      f.app.warranty.dispose(f.actor, "repair", {
        claimId: claim.id,
        disposition: "repair",
        reason: "Repair approval",
      });
  }
  f.app.warranty.dispose(f.actor, "restock", {
    claimId: claim.id,
    disposition: "restock",
    reason: "Approved restock",
  });
  const current = f.app.inventory.trace(f.actor, "S1").unit;
  f.app.inventory.inspect(f.actor, "after-disposition", {
    unitId: unit.id,
    revision: current.revision,
    condition: "quarantine",
    reason: "Independent stock concern",
  });
  assert.equal(
    f.app.inventory.trace(f.actor, "S1").unit.condition,
    "quarantine",
  );
});

test("generic serial-loss approval cannot consume an active returned customer serial", (t) => {
  const f = fixture(t),
    { claim, unit } = returned(f);
  const review = f.app.inventory.reportSerialMissing(f.actor, "missing", {
    unitId: unit.id,
    revision: unit.revision,
    serial: "S1",
    reviewRef: "SYNTHETIC-LOSS",
    reason: "Synthetic count discrepancy",
  });
  const before = f.app.inventory.trace(f.actor, "S1");
  assert.throws(
    () =>
      f.app.inventory.decideSerialMissing(f.actor, "loss", {
        reviewId: review.id,
        decision: "approve",
        reason: "Generic stock loss",
      }),
    { code: "WARRANTY_CUSTODY" },
  );
  assert.deepEqual(f.app.inventory.trace(f.actor, "S1"), before);
  f.app.inventory.decideSerialMissing(f.actor, "reject-loss", {
    reviewId: review.id,
    decision: "reject",
    reason: "Resolve through customer claim",
  });
  f.app.warranty.inspect(f.actor, "inspect-return", {
    claimId: claim.id,
    findings: "Unrepairable",
  });
  f.app.warranty.dispose(f.actor, "scrap", {
    claimId: claim.id,
    disposition: "scrap",
    reason: "Approved warranty scrap",
  });
  assert.equal(f.app.inventory.trace(f.actor, "S1").unit.state, "scrapped");
});
