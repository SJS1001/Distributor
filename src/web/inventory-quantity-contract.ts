import type { Unit } from "../server/inventory.ts";
import type { ValuationPolicy } from "../server/inventory-valuations.ts";
import type { StockHistoryPage } from "../shared/stock-history.ts";

// Mirrors the parent-owned native contract. No runtime server imports.
export type Movement = {
  id: string;
  org_id: string;
  unit_id: string;
  warehouse_id: string;
  type: string;
  quantity: number;
  unit_cost: number;
  reference: string;
  reason: string;
  actor_id: string;
  created_at: string;
};
export type QuantityCorrectionReview = {
  orgId: string;
  region: string;
  currency: string;
  unit: Unit;
  source: Movement;
  reserved: number;
  carryingValue: number;
  positionHash: string | null;
  policy: ValuationPolicy & { policyHash: string };
};
export type QuantityCorrectionInput = {
  unitId: string;
  sourceMovementId: string;
  reviewHash: string;
  reference: string;
  targetQuantity: number;
  postingDate: string;
  reason: string;
  physicalEvidence: string;
  accountantEvidence: string;
};
export type QuantityCorrectionDecision = {
  correctionId: string;
  reviewHash: string;
  decision: "approve" | "reject";
  reason: string;
};
export type QuantityCorrection = {
  id: string;
  orgId: string;
  unitId: string;
  reference: string;
  state: "ready" | "reviewed" | "rejected";
  input: QuantityCorrectionInput;
  review: QuantityCorrectionReview;
  reviewHash: string;
  createdBy: string;
  createdAt: string;
  decision: null | {
    by: string;
    at: string;
    decision: "approve" | "reject";
    reason: string;
  };
  movement: Movement | null;
  valueDelta: number | null;
};
export type ReviewRead = {
  review: QuantityCorrectionReview;
  reviewHash: string;
};
export type QuantityPage = { items: QuantityCorrection[]; next: string | null };
export type QuantityAttempt = {
  version: 1;
  key: string;
  orgId: string;
  actorId: string;
  unitId: string;
  fingerprint: string;
} & (
  | { kind: "prepare"; snapshot: ReviewRead; payload: QuantityCorrectionInput }
  | {
      kind: "decide";
      snapshot: QuantityCorrection;
      payload: QuantityCorrectionDecision;
    }
);
export const recoveryError =
  "Quantity recovery evidence cannot be verified. Restore browser storage and reconcile the retained attempt before creating another quantity command.";
export function ensure(v: unknown, message = recoveryError): asserts v {
  if (!v) throw Error(message);
}
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v !== null && typeof v === "object")
    return `{${Object.entries(v)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`)
      .join(",")}}`;
  return JSON.stringify(v);
}
export async function hash(v: unknown) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonical(v)),
      ),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj =>
  !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: unknown, n: string) =>
  object(v) && Object.keys(v).sort().join() === n.split(" ").sort().join();
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
export function movementShape(v: unknown): v is Movement {
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
    !movementShape(s)
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
    movementShape(m) &&
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
export type Scope = {
  orgId: string;
  unitId: string;
  region: string;
  currency: string;
  sites: readonly string[];
  allSites?: boolean;
};
async function validateReview(r: unknown, s: Scope): Promise<void> {
  ensure(quantityReviewShape(r));
  ensure(
    r.orgId === s.orgId &&
      r.unit.id === s.unitId &&
      r.region === s.region &&
      r.currency === s.currency &&
      (s.allSites || s.sites.includes(r.unit.warehouse_id)) &&
      (s.allSites || s.sites.includes(r.source.warehouse_id)),
  );
  const { policyHash, ...policy } = r.policy;
  ensure((await hash(policy)) === policyHash);
}
export async function validateReviewRead(
  v: unknown,
  s: Scope,
): Promise<ReviewRead> {
  ensure(keys(v, "review reviewHash") && object(v));
  await validateReview(v.review, s);
  ensure(
    quantityDigest(v.reviewHash) && (await hash(v.review)) === v.reviewHash,
  );
  return v as ReviewRead;
}
// Published f909227 native HTTP review is flattened; retained attempts use an envelope.
export async function validateReviewResponse(
  v: unknown,
  s: Scope,
): Promise<ReviewRead> {
  ensure(
    keys(
      v,
      "orgId region currency unit source reserved carryingValue positionHash policy reviewHash",
    ) && object(v),
  );
  const { reviewHash, ...review } = v;
  return validateReviewRead({ review, reviewHash }, s);
}
export async function validateRecord(
  v: unknown,
  s: Scope,
): Promise<QuantityCorrection> {
  ensure(quantityRecordShape(v));
  await validateReview(v.review, s);
  ensure((await hash(v.review)) === v.reviewHash);
  return v;
}
export async function validatePage(
  v: unknown,
  s: Scope,
): Promise<QuantityPage> {
  ensure(
    keys(v, "items next") &&
      object(v) &&
      Array.isArray(v.items) &&
      v.items.length <= 20 &&
      (v.next === null || text(v.next, 4000)) &&
      (v.next === null || v.items.length > 0),
  );
  const items = await Promise.all(v.items.map((x) => validateRecord(x, s)));
  ensure(new Set(items.map((x) => x.id)).size === items.length);
  return { items, next: v.next as string | null };
}
export async function validateAttempt(
  v: unknown,
  orgId: string,
  actorId: string,
): Promise<QuantityAttempt> {
  ensure(
    keys(
      v,
      "version key orgId actorId unitId fingerprint kind snapshot payload",
    ) &&
      object(v) &&
      v.version === 1 &&
      text(v.key) &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
        v.key,
      ) &&
      v.orgId === orgId &&
      v.actorId === actorId &&
      text(v.unitId),
  );
  const { fingerprint, ...body } = v;
  ensure(quantityDigest(fingerprint) && (await hash(body)) === fingerprint);
  if (v.kind === "prepare") {
    ensure(object(v.snapshot) && quantityReviewShape(v.snapshot.review));
    const r = v.snapshot.review;
    await validateReviewRead(v.snapshot, {
      orgId,
      unitId: v.unitId,
      region: r.region,
      currency: r.currency,
      sites: [r.unit.warehouse_id, r.source.warehouse_id],
    });
    ensure(quantityInputShape(v.payload, r, String(v.snapshot.reviewHash)));
  } else {
    ensure(v.kind === "decide" && quantityRecordShape(v.snapshot));
    const r = v.snapshot.review;
    await validateRecord(v.snapshot, {
      orgId,
      unitId: v.unitId,
      region: r.region,
      currency: r.currency,
      sites: [r.unit.warehouse_id, r.source.warehouse_id],
    });
    const p = v.payload;
    ensure(
      keys(p, "correctionId reviewHash decision reason") &&
        object(p) &&
        v.snapshot.state === "ready" &&
        v.snapshot.createdBy !== actorId &&
        p.correctionId === v.snapshot.id &&
        p.reviewHash === v.snapshot.reviewHash &&
        ["approve", "reject"].includes(String(p.decision)) &&
        text(p.reason, 2000),
    );
  }
  return v as QuantityAttempt;
}
export async function readAttempt(key: string, orgId: string, actorId: string) {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  ensure(raw.length > 0 && raw.length <= 100000);
  return validateAttempt(JSON.parse(raw), orgId, actorId);
}
export function immutableRecord(v: QuantityCorrection) {
  const { state, decision, movement, valueDelta, ...identity } = v;
  return identity;
}
export async function validateReply(v: unknown, a: QuantityAttempt, s: Scope) {
  const r = await validateRecord(v, s);
  if (a.kind === "prepare")
    ensure(
      r.createdBy === a.actorId &&
        canonical(r.input) === canonical(a.payload) &&
        canonical(r.review) === canonical(a.snapshot.review) &&
        r.reviewHash === a.snapshot.reviewHash,
    );
  else
    ensure(
      r.decision?.by === a.actorId &&
        r.decision.reason === a.payload.reason &&
        r.decision.decision === a.payload.decision &&
        canonical(immutableRecord(r)) ===
          canonical(immutableRecord(a.snapshot)),
    );
  // Preparation replay can return the actual current (already decided) record.
  return r;
}
export function eligibleSource(
  m: StockHistoryPage["items"][number],
  cost: number,
) {
  return (
    ["receipt", "opening", "count", "quantity.correction"].includes(m.type) &&
    integer(m.quantity, -100000, 100000) &&
    m.quantity !== 0 &&
    m.unit_cost === cost
  );
}
export function validateMovements(v: unknown, s: Scope): StockHistoryPage {
  ensure(
    keys(v, "unit items next") &&
      object(v) &&
      object(v.unit) &&
      Array.isArray(v.items) &&
      v.items.length <= 20 &&
      (v.next === null || text(v.next, 4000)) &&
      (v.next === null || v.items.length > 0),
  );
  const u = v.unit;
  ensure(
    keys(
      u,
      "id product_id warehouse_id bin serial quantity cost condition state revision",
    ) &&
      u.id === s.unitId &&
      text(u.product_id) &&
      text(u.warehouse_id) &&
      (s.allSites || s.sites.includes(u.warehouse_id)) &&
      text(u.bin) &&
      u.serial === null &&
      integer(u.quantity, 0, 100000) &&
      integer(u.cost) &&
      integer(u.revision) &&
      u.state === "stock" &&
      ["usable", "quarantine", "damaged"].includes(String(u.condition)),
  );
  for (const m of v.items) {
    ensure(
      object(m) &&
        keys(
          m,
          "id warehouse_id type quantity unit_cost reference reason actor_id created_at",
        ) &&
        text(m.id) &&
        text(m.warehouse_id) &&
        (s.allSites || s.sites.includes(m.warehouse_id)) &&
        text(m.type) &&
        integer(m.quantity, -100000, 100000) &&
        integer(m.unit_cost) &&
        text(m.reference) &&
        text(m.reason, 1000) &&
        text(m.actor_id) &&
        timestamp(m.created_at),
    );
  }
  ensure(new Set(v.items.map((m) => m.id)).size === v.items.length);
  return v as StockHistoryPage;
}
