import {
  hash,
  type ReviewRead,
  type QuantityCorrection,
  type QuantityCorrectionInput,
} from "../src/web/inventory-quantity-contract.ts";
export async function quantityFixture(
  orgId = "org",
  unitId = "bulk",
): Promise<ReviewRead> {
  const policy = {
    orgId,
    productId: "product",
    previousRevision: 0,
    policyVersion: "test-1",
    establishedBasis: "Synthetic established basis",
    establishedMethod: "fifo-receipt-layers" as const,
    effectiveFrom: "2026-01-01",
    closedThrough: "2026-08-31",
    financeEvidence: "Synthetic accountant evidence",
    nonInterchangeableEvidence: null,
    revision: 1,
    createdBy: "finance",
    createdAt: "2026-09-01T00:00:00.000Z",
  };
  const review = {
    orgId,
    region: "CA",
    currency: "CAD",
    unit: {
      id: unitId,
      org_id: orgId,
      product_id: "product",
      warehouse_id: "warehouse",
      bin: "A1",
      serial: null,
      quantity: 5,
      cost: 100,
      condition: "usable",
      state: "stock",
      revision: 1,
    },
    source: {
      id: "source",
      org_id: orgId,
      unit_id: unitId,
      warehouse_id: "warehouse",
      type: "opening",
      quantity: 5,
      unit_cost: 100,
      reference: "original",
      reason: "Synthetic opening",
      actor_id: "creator",
      created_at: "2026-09-01T00:00:00.000Z",
    },
    reserved: 1,
    carryingValue: 500,
    positionHash: null,
    policy: { ...policy, policyHash: await hash(policy) },
  };
  return { review, reviewHash: await hash(review) };
}
export function quantityInput(r: ReviewRead): QuantityCorrectionInput {
  return {
    unitId: r.review.unit.id,
    sourceMovementId: r.review.source.id,
    reviewHash: r.reviewHash,
    reference: "correction",
    targetQuantity: 3,
    postingDate: "2026-10-03",
    reason: "Synthetic misrecorded quantity",
    physicalEvidence: "Synthetic physical evidence",
    accountantEvidence: "Synthetic classification",
  };
}
export function quantityRecord(
  r: ReviewRead,
  input = quantityInput(r),
): QuantityCorrection {
  return {
    id: "correction-id",
    orgId: r.review.orgId,
    unitId: r.review.unit.id,
    reference: input.reference,
    state: "ready",
    input,
    review: r.review,
    reviewHash: r.reviewHash,
    createdBy: "creator",
    createdAt: "2026-10-03T00:00:00.000Z",
    decision: null,
    movement: null,
    valueDelta: null,
  };
}
export function decided(
  v: QuantityCorrection,
  decision: "approve" | "reject" = "approve",
  by = "finance",
  reason = "Independent evidence",
): QuantityCorrection {
  const d = { by, at: "2026-10-03T01:00:00.000Z", decision, reason };
  return {
    ...v,
    state: decision === "approve" ? "reviewed" : "rejected",
    decision: d,
    movement:
      decision === "reject"
        ? null
        : {
            ...v.review.source,
            id: "correction-movement",
            type: "quantity.correction",
            reference: v.id,
            quantity: v.input.targetQuantity - v.review.unit.quantity,
            actor_id: by,
            reason: v.input.reason,
            created_at: d.at,
          },
    valueDelta:
      decision === "reject"
        ? null
        : (v.input.targetQuantity - v.review.unit.quantity) *
          v.review.unit.cost,
  };
}
