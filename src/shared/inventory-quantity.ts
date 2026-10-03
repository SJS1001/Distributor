import type {
  QuantityCorrection,
  QuantityCorrectionInput,
  QuantityCorrectionReview,
} from "../server/inventory-quantity-corrections.ts";

type ObjectValue = Record<string, unknown>;
const object = (v: unknown): v is ObjectValue =>
  !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: unknown, names: string) =>
  object(v) && Object.keys(v).sort().join() === names.split(" ").sort().join();
const text = (v: unknown, max = 160): v is string =>
  typeof v === "string" && !!v && v === v.trim() && v.length <= max;
const integer = (
  v: unknown,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
export const quantityDigest = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export const quantityDate = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
const timestamp = (v: unknown): v is string =>
  text(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
function movement(v: unknown): v is QuantityCorrectionReview["source"] {
  if (
    !keys(
      v,
      "id org_id unit_id warehouse_id type quantity unit_cost reference reason actor_id created_at",
    ) ||
    !object(v)
  )
    return false;
  return (
    text(v.id) &&
    text(v.org_id) &&
    text(v.unit_id) &&
    text(v.warehouse_id) &&
    text(v.type) &&
    integer(v.quantity, -100000, 100000) &&
    v.quantity !== 0 &&
    integer(v.unit_cost) &&
    text(v.reference) &&
    text(v.reason, 1000) &&
    text(v.actor_id) &&
    timestamp(v.created_at)
  );
}
export function quantityReviewShape(v: unknown): v is QuantityCorrectionReview {
  if (
    !keys(
      v,
      "orgId region currency unit source reserved carryingValue positionHash policy",
    ) ||
    !object(v)
  )
    return false;
  const u = v.unit,
    p = v.policy,
    s = v.source;
  if (
    !keys(
      u,
      "id org_id product_id warehouse_id bin serial quantity cost condition state revision",
    ) ||
    !object(u) ||
    !keys(
      p,
      "orgId productId previousRevision policyVersion establishedBasis establishedMethod effectiveFrom closedThrough financeEvidence nonInterchangeableEvidence revision createdBy createdAt policyHash",
    ) ||
    !object(p) ||
    !movement(s)
  )
    return false;
  return (
    text(v.orgId) &&
    ["CA", "US"].includes(String(v.region)) &&
    ["CAD", "USD"].includes(String(v.currency)) &&
    text(u.id) &&
    u.org_id === v.orgId &&
    text(u.product_id) &&
    text(u.warehouse_id) &&
    text(u.bin) &&
    u.serial === null &&
    integer(u.quantity, 0, 100000) &&
    integer(u.cost) &&
    integer(u.revision) &&
    u.state === "stock" &&
    ["usable", "quarantine", "damaged"].includes(String(u.condition)) &&
    integer(v.reserved, 0, Number(u.quantity)) &&
    integer(v.carryingValue) &&
    (v.positionHash === null || quantityDigest(v.positionHash)) &&
    s.org_id === v.orgId &&
    s.unit_id === u.id &&
    s.unit_cost === u.cost &&
    ["receipt", "opening", "count", "quantity.correction"].includes(s.type) &&
    p.orgId === v.orgId &&
    p.productId === u.product_id &&
    integer(p.previousRevision) &&
    p.revision === p.previousRevision + 1 &&
    text(p.policyVersion) &&
    text(p.establishedBasis, 2000) &&
    ["specific-identification", "fifo-receipt-layers"].includes(
      String(p.establishedMethod),
    ) &&
    quantityDate(p.effectiveFrom) &&
    (p.closedThrough === null || quantityDate(p.closedThrough)) &&
    text(p.financeEvidence, 2000) &&
    (p.nonInterchangeableEvidence === null ||
      text(p.nonInterchangeableEvidence, 2000)) &&
    (p.establishedMethod !== "specific-identification" ||
      text(p.nonInterchangeableEvidence, 2000)) &&
    text(p.createdBy) &&
    timestamp(p.createdAt) &&
    quantityDigest(p.policyHash)
  );
}
export function quantityInputShape(
  v: unknown,
  r: QuantityCorrectionReview,
  reviewHash: string,
): v is QuantityCorrectionInput {
  if (
    !keys(
      v,
      "unitId sourceMovementId reviewHash reference targetQuantity postingDate reason physicalEvidence accountantEvidence",
    ) ||
    !object(v)
  )
    return false;
  return (
    v.unitId === r.unit.id &&
    v.sourceMovementId === r.source.id &&
    v.reviewHash === reviewHash &&
    text(v.reference) &&
    integer(v.targetQuantity, r.reserved, 100000) &&
    v.targetQuantity !== r.unit.quantity &&
    quantityDate(v.postingDate) &&
    v.postingDate >= r.policy.effectiveFrom &&
    (!r.policy.closedThrough || v.postingDate > r.policy.closedThrough) &&
    text(v.reason, 1000) &&
    text(v.physicalEvidence, 2000) &&
    text(v.accountantEvidence, 2000)
  );
}
export function quantityRecordShape(v: unknown): v is QuantityCorrection {
  if (
    !keys(
      v,
      "id orgId unitId reference state input review reviewHash createdBy createdAt decision movement valueDelta",
    ) ||
    !object(v) ||
    !quantityReviewShape(v.review) ||
    !quantityDigest(v.reviewHash) ||
    !quantityInputShape(v.input, v.review, v.reviewHash)
  )
    return false;
  if (!(
    text(v.id) &&
    v.orgId === v.review.orgId &&
    v.unitId === v.review.unit.id &&
    v.reference === v.input.reference &&
    text(v.createdBy) &&
    timestamp(v.createdAt)
  ))
    return false;
  if (v.state === "ready")
    return v.decision === null && v.movement === null && v.valueDelta === null;
  const d = v.decision;
  if (
    !keys(d, "by at decision reason") ||
    !object(d) ||
    !text(d.by) ||
    d.by === v.createdBy ||
    !timestamp(d.at) ||
    d.at < v.createdAt ||
    !text(d.reason, 2000)
  )
    return false;
  if (v.state === "rejected")
    return (
      d.decision === "reject" && v.movement === null && v.valueDelta === null
    );
  const m = v.movement;
  return (
    v.state === "reviewed" &&
    d.decision === "approve" &&
    integer(v.valueDelta, -Number.MAX_SAFE_INTEGER) &&
    movement(m) &&
    m.org_id === v.orgId &&
    m.unit_id === v.unitId &&
    m.warehouse_id === v.review.unit.warehouse_id &&
    m.type === "quantity.correction" &&
    m.reference === v.id &&
    m.quantity === v.input.targetQuantity - v.review.unit.quantity &&
    m.unit_cost === v.review.unit.cost &&
    m.actor_id === d.by &&
    m.reason === v.input.reason &&
    m.created_at >= d.at
  );
}
