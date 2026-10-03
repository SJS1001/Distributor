import type {
  Valuation,
  ValuationDecision,
  ValuationInput,
  ValuationPolicy,
  ValuationPolicyInput,
  ValuationReview,
} from "../server/inventory-valuations.ts";

export type PolicyRead = {
  unitId: string;
  productId: string;
  policy: (ValuationPolicy & { policyHash: string }) | null;
};
export type ReviewRead = ValuationReview & { reviewHash: string };
export type ValueAttempt = {
  version: 1;
  key: string;
  orgId: string;
  actorId: string;
  unitId: string;
  fingerprint: string;
} & (
  | { kind: "policy"; snapshot: PolicyRead; payload: ValuationPolicyInput }
  | { kind: "prepare"; snapshot: ReviewRead; payload: ValuationInput }
  | { kind: "decide"; snapshot: Valuation; payload: ValuationDecision }
);
export const recoveryError =
  "Valuation recovery evidence cannot be verified. Restore browser storage and reconcile the previous attempt before creating another valuation command.";
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export async function hash(value: unknown) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonical(value)),
      ),
    ),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
}
export function ensure(value: unknown, message = recoveryError): asserts value {
  if (!value) throw Error(message);
}
const txt = (v: unknown, max = 160): v is string =>
  typeof v === "string" && !!v && v === v.trim() && v.length <= max;
const integer = (v: unknown, min = 0): v is number =>
  Number.isSafeInteger(v) &&
  Number(v) >= min &&
  Number(v) <= Number.MAX_SAFE_INTEGER;
const digest = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export const date = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
const keys = (v: unknown, names: string[]) =>
  !!v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).sort().join() === names.sort().join();
const policyFields = [
  "productId",
  "previousRevision",
  "policyVersion",
  "establishedBasis",
  "establishedMethod",
  "effectiveFrom",
  "closedThrough",
  "financeEvidence",
  "nonInterchangeableEvidence",
];
function policyInput(p: ValuationPolicyInput) {
  ensure(
    keys(p, [...policyFields]) &&
      txt(p.productId) &&
      integer(p.previousRevision) &&
      txt(p.policyVersion) &&
      txt(p.establishedBasis, 2000) &&
      ["specific-identification", "fifo-receipt-layers"].includes(
        p.establishedMethod,
      ) &&
      date(p.effectiveFrom) &&
      (p.closedThrough === null || date(p.closedThrough)) &&
      txt(p.financeEvidence, 2000) &&
      (p.nonInterchangeableEvidence === null ||
        txt(p.nonInterchangeableEvidence, 2000)) &&
      (p.establishedMethod !== "specific-identification" ||
        txt(p.nonInterchangeableEvidence, 2000)),
  );
}
async function policy(p: ValuationPolicy, orgId: string) {
  ensure(
    keys(p, [...policyFields, "orgId", "revision", "createdBy", "createdAt"]),
  );
  const { orgId: org, revision, createdBy, createdAt, ...input } = p;
  policyInput(input);
  ensure(
    org === orgId &&
      revision === input.previousRevision + 1 &&
      txt(createdBy) &&
      txt(createdAt) &&
      Number.isFinite(Date.parse(createdAt)),
  );
}
export async function validatePolicyRead(
  r: PolicyRead,
  orgId: string,
  unitId: string,
) {
  ensure(
    keys(r, ["unitId", "productId", "policy"]) &&
      r.unitId === unitId &&
      txt(r.productId),
  );
  if (r.policy !== null) {
    const { policyHash, ...p } = r.policy;
    await policy(p, orgId);
    ensure(
      p.productId === r.productId &&
        digest(policyHash) &&
        (await hash(p)) === policyHash,
    );
  }
}
async function review(r: ValuationReview, orgId: string, unitId: string) {
  ensure(
    keys(r, [
      "orgId",
      "region",
      "currency",
      "unit",
      "carryingValue",
      "policy",
      "policyHash",
      "positionHash",
    ]),
  );
  const u = r.unit;
  ensure(
    keys(u, [
      "id",
      "org_id",
      "product_id",
      "warehouse_id",
      "bin",
      "serial",
      "quantity",
      "cost",
      "condition",
      "state",
      "revision",
    ]) &&
      r.orgId === orgId &&
      u.id === unitId &&
      u.org_id === orgId &&
      txt(u.product_id) &&
      txt(u.warehouse_id) &&
      txt(u.bin) &&
      (u.serial === null || txt(u.serial)) &&
      integer(u.quantity, 1) &&
      integer(u.cost) &&
      integer(u.revision) &&
      ["stock", "transit"].includes(u.state) &&
      ["usable", "quarantine", "damaged"].includes(u.condition) &&
      integer(r.carryingValue) &&
      ["CA", "US"].includes(r.region) &&
      ["CAD", "USD"].includes(r.currency) &&
      (r.positionHash === null || digest(r.positionHash)),
  );
  await policy(r.policy, orgId);
  ensure(
    r.policy.productId === u.product_id &&
      digest(r.policyHash) &&
      (await hash(r.policy)) === r.policyHash,
  );
}
export async function validateReviewRead(
  r: ReviewRead,
  orgId: string,
  unitId: string,
) {
  const { reviewHash, ...s } = r;
  await review(s, orgId, unitId);
  ensure(digest(reviewHash) && (await hash(s)) === reviewHash);
}
function preparation(
  p: ValuationInput,
  r: ValuationReview,
  reviewHash: string,
) {
  ensure(
    keys(p, [
      "unitId",
      "reviewHash",
      "reference",
      "kind",
      "targetValue",
      "postingDate",
      "reason",
      "evidence",
      "accountantEvidence",
    ]) &&
      p.unitId === r.unit.id &&
      p.reviewHash === reviewHash &&
      txt(p.reference) &&
      integer(p.targetValue) &&
      date(p.postingDate) &&
      p.postingDate >= r.policy.effectiveFrom &&
      (!r.policy.closedThrough || p.postingDate > r.policy.closedThrough) &&
      txt(p.reason, 2000) &&
      txt(p.evidence, 2000) &&
      txt(p.accountantEvidence, 2000),
  );
  const original = BigInt(r.unit.cost) * BigInt(r.unit.quantity);
  ensure(
    p.kind === "write-down"
      ? p.targetValue < r.carryingValue
      : p.kind === "reversal" &&
          r.positionHash &&
          p.targetValue > r.carryingValue &&
          BigInt(p.targetValue) <= original,
  );
}
export async function validateValuation(
  v: Valuation,
  orgId: string,
  unitId: string,
) {
  ensure(
    keys(v, [
      "id",
      "orgId",
      "unitId",
      "reference",
      "state",
      "input",
      "review",
      "reviewHash",
      "createdBy",
      "createdAt",
      "decision",
      "movementId",
    ]) &&
      txt(v.id) &&
      v.orgId === orgId &&
      v.unitId === unitId &&
      v.reference === v.input?.reference &&
      txt(v.createdBy) &&
      txt(v.createdAt) &&
      Number.isFinite(Date.parse(v.createdAt)),
  );
  await review(v.review, orgId, unitId);
  ensure(digest(v.reviewHash) && (await hash(v.review)) === v.reviewHash);
  preparation(v.input, v.review, v.reviewHash);
  if (v.state === "ready") ensure(v.decision === null && v.movementId === null);
  else {
    const d = v.decision;
    ensure(
      d &&
        keys(d, ["by", "at", "reason", "decision"]) &&
        txt(d.by) &&
        d.by !== v.createdBy &&
        txt(d.reason, 2000) &&
        txt(d.at) &&
        Number.isFinite(Date.parse(d.at)),
    );
    ensure(
      v.state === "reviewed"
        ? d.decision === "approve" && txt(v.movementId)
        : v.state === "rejected" &&
            d.decision === "reject" &&
            v.movementId === null,
    );
  }
}
export async function validateAttempt(
  a: ValueAttempt,
  orgId: string,
  actorId: string,
) {
  ensure(
    keys(a, [
      "version",
      "key",
      "orgId",
      "actorId",
      "unitId",
      "fingerprint",
      "kind",
      "snapshot",
      "payload",
    ]) &&
      a.version === 1 &&
      typeof a.key === "string" &&
      /^[a-f0-9-]{36}$/.test(a.key) &&
      a.orgId === orgId &&
      a.actorId === actorId &&
      txt(a.unitId),
  );
  const { fingerprint, ...body } = a;
  ensure(digest(fingerprint) && (await hash(body)) === fingerprint);
  if (a.kind === "policy") {
    await validatePolicyRead(a.snapshot, orgId, a.unitId);
    policyInput(a.payload);
    const old = a.snapshot.policy,
      p = a.payload;
    ensure(
      p.productId === a.snapshot.productId &&
        p.previousRevision === (old?.revision ?? 0) &&
        (!old ||
          (p.establishedBasis === old.establishedBasis &&
            p.establishedMethod === old.establishedMethod &&
            p.effectiveFrom === old.effectiveFrom &&
            (!old.closedThrough ||
              (p.closedThrough && p.closedThrough >= old.closedThrough)))),
    );
  } else if (a.kind === "prepare") {
    await validateReviewRead(a.snapshot, orgId, a.unitId);
    const { reviewHash, ...r } = a.snapshot;
    preparation(a.payload, r, reviewHash);
  } else {
    ensure(a.kind === "decide");
    await validateValuation(a.snapshot, orgId, a.unitId);
    const p = a.payload;
    ensure(
      keys(p, ["valuationId", "reviewHash", "decision", "reason"]) &&
        a.snapshot.state === "ready" &&
        a.snapshot.createdBy !== actorId &&
        p.valuationId === a.snapshot.id &&
        p.reviewHash === a.snapshot.reviewHash &&
        ["approve", "reject"].includes(p.decision) &&
        txt(p.reason, 2000),
    );
  }
}
export async function readAttempt(
  storageKey: string,
  orgId: string,
  actorId: string,
) {
  const raw = localStorage.getItem(storageKey);
  if (raw === null) return null;
  ensure(raw.length > 0 && raw.length <= 100000);
  const a = JSON.parse(raw) as ValueAttempt;
  await validateAttempt(a, orgId, actorId);
  return a;
}
export async function validateReply(result: unknown, a: ValueAttempt) {
  if (a.kind === "policy") {
    const p = result as ValuationPolicy & { policyHash: string };
    await validatePolicyRead(
      { unitId: a.unitId, productId: a.payload.productId, policy: p },
      a.orgId,
      a.unitId,
    );
    const { orgId, revision, createdBy, createdAt, policyHash, ...input } = p;
    ensure(
      canonical(input) === canonical(a.payload) &&
        createdBy === a.actorId &&
        revision === a.payload.previousRevision + 1,
    );
  } else {
    const v = result as Valuation;
    await validateValuation(v, a.orgId, a.unitId);
    if (a.kind === "prepare") {
      const { reviewHash, ...r } = a.snapshot;
      ensure(
        v.state === "ready" &&
          v.createdBy === a.actorId &&
          canonical(v.input) === canonical(a.payload) &&
          canonical(v.review) === canonical(r) &&
          v.reviewHash === reviewHash,
      );
    } else {
      ensure(
        v.decision?.by === a.actorId &&
          v.decision.reason === a.payload.reason &&
          v.decision.decision === a.payload.decision &&
          canonical({
            ...v,
            state: "ready",
            decision: null,
            movementId: null,
          }) === canonical(a.snapshot),
      );
    }
  }
}
