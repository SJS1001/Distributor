import { test } from "node:test";
import assert from "node:assert/strict";
import {
  quantityFixture,
  quantityInput,
  quantityRecord,
  decided,
} from "./inventory-quantity-fixture.ts";
import {
  hash,
  quantityReviewShape,
  quantityRecordShape,
  quantityInputShape,
  validateReviewRead,
  validateReviewResponse,
  validateRecord,
  validateAttempt,
  validateReply,
  validatePage,
  validateMovements,
  eligibleSource,
  type QuantityAttempt,
  type Scope,
} from "../src/web/inventory-quantity-contract.ts";
const scope: Scope = {
  orgId: "org",
  unitId: "bulk",
  region: "CA",
  currency: "CAD",
  sites: ["warehouse"],
};
async function attempt(
  kind: "prepare" | "decide" = "prepare",
): Promise<QuantityAttempt> {
  const r = await quantityFixture(),
    v = quantityRecord(r);
  const body = {
    version: 1 as const,
    key: "12345678-1234-1234-1234-123456789abc",
    orgId: "org",
    actorId: kind === "prepare" ? "creator" : "finance",
    unitId: "bulk",
    ...(kind === "prepare"
      ? { kind, snapshot: r, payload: quantityInput(r) }
      : {
          kind,
          snapshot: v,
          payload: {
            correctionId: v.id,
            reviewHash: v.reviewHash,
            decision: "approve" as const,
            reason: "Independent evidence",
          },
        }),
  };
  return { ...body, fingerprint: await hash(body) } as QuantityAttempt;
}
test("quantity: supplied shape, zero quantity and both regional currencies are supported", async () => {
  const r = await quantityFixture();
  await validateReviewRead(r, scope);
  r.review.unit.quantity = 0;
  r.review.reserved = 0;
  r.review.carryingValue = 0;
  r.reviewHash = await hash(r.review);
  assert(quantityReviewShape(r.review));
  assert(
    quantityInputShape(
      { ...quantityInput(r), targetQuantity: 1 },
      r.review,
      r.reviewHash,
    ),
  );
  await validateReviewRead(r, scope);
  r.review.currency = "USD";
  r.reviewHash = await hash(r.review);
  await validateReviewRead(r, { ...scope, currency: "USD" });
});
test("quantity: exact org/unit/site/source/policy and canonical hashes fail closed", async () => {
  for (const mutate of [
    (r: any) => (r.review.orgId = "other"),
    (r: any) => (r.review.unit.id = "other"),
    (r: any) => (r.review.unit.serial = "serial"),
    (r: any) => (r.review.source.unit_id = "other"),
    (r: any) => r.review.source.unit_cost++,
    (r: any) => (r.review.source.type = "sale"),
    (r: any) => (r.review.source.quantity = 0),
    (r: any) => (r.review.policy.productId = "other"),
    (r: any) => (r.review.policy.policyHash = "a".repeat(64)),
    (r: any) => (r.reviewHash = "a".repeat(64)),
    (r: any) => (r.review.extra = true),
  ]) {
    const r = await quantityFixture();
    mutate(r);
    await assert.rejects(validateReviewRead(r, scope));
  }
  const r = await quantityFixture();
  for (const s of [
    { ...scope, sites: [] },
    { ...scope, region: "US" },
    { ...scope, currency: "USD" },
  ])
    await assert.rejects(validateReviewRead(r, s));
});
test("quantity: target, reservation, open periods and evidence boundaries", async () => {
  const r = await quantityFixture(),
    p = quantityInput(r);
  for (const patch of [
    { targetQuantity: 0 },
    { targetQuantity: 5 },
    { targetQuantity: 1.5 },
    { targetQuantity: 100001 },
    { postingDate: "2026-08-31" },
    { postingDate: "2026-02-30" },
    { physicalEvidence: "" },
    { reason: "a".repeat(1001) },
    { reference: " x" },
    { sourceMovementId: "other" },
    { count: 3 },
  ])
    assert(!quantityInputShape({ ...p, ...patch }, r.review, r.reviewHash));
  assert(
    quantityInputShape({ ...p, targetQuantity: 1 }, r.review, r.reviewHash),
  );
  assert(
    quantityInputShape(
      { ...p, targetQuantity: 100000 },
      r.review,
      r.reviewHash,
    ),
  );
});
test("quantity: independent rejection and bound approved effects preserve source", async () => {
  const r = await quantityFixture(),
    v = quantityRecord(r),
    a = decided(v),
    d = decided(v, "reject");
  assert(quantityRecordShape(v));
  assert(quantityRecordShape(a));
  assert(quantityRecordShape(d));
  await validateRecord(a, scope);
  assert.deepEqual(a.review.source, r.review.source);
  for (const patch of [
    { decision: { ...a.decision, by: "creator" } },
    { movement: { ...a.movement, type: "count" } },
    { movement: { ...a.movement, quantity: 2 } },
    { movement: { ...a.movement, unit_cost: 99 } },
    { movement: { ...a.movement, reference: "original" } },
    { valueDelta: 0.5 },
    { state: "ready" },
    { extra: true },
  ])
    assert(!quantityRecordShape({ ...a, ...patch }));
});
test("quantity: retained payload/key fingerprint and fresh decided preparation replay", async () => {
  const a = await attempt();
  await validateAttempt(a, "org", "creator");
  await assert.rejects(
    validateAttempt(
      { ...a, key: "22345678-1234-1234-1234-123456789abc" },
      "org",
      "creator",
    ),
  );
  await assert.rejects(validateAttempt(a, "org", "other"));
  await assert.rejects(validateAttempt(a, "other", "creator"));
  if (a.kind !== "prepare") throw Error();
  const v = quantityRecord(a.snapshot, a.payload);
  await validateReply(decided(v), a, scope);
  await assert.rejects(
    validateReply(
      { ...v, input: { ...v.input, reference: "other" } },
      a,
      scope,
    ),
  );
  const d = await attempt("decide");
  await validateReply(decided(v), d, scope);
  await assert.rejects(validateReply(decided(v, "reject"), d, scope));
  await assert.rejects(validateReply(decided({ ...v, id: "other" }), d, scope));
});
test("quantity: bounded pages reject duplicate identity, oversized and malformed cursors", async () => {
  const v = quantityRecord(await quantityFixture());
  await validatePage({ items: [v], next: null }, scope);
  for (const p of [
    { items: [v, v], next: null },
    { items: Array(21).fill(v), next: null },
    { items: [], next: "" },
    { items: [], next: "cursor" },
    { items: [v], next: null, extra: true },
  ])
    await assert.rejects(validatePage(p, scope));
});
test("quantity: movement pages select eligible exact original-cost sources only", async () => {
  const r = await quantityFixture(),
    { org_id, unit_id, ...m } = r.review.source,
    { org_id: org, ...u } = r.review.unit;
  const p = { unit: u, items: [m], next: null };
  assert.equal(validateMovements(p, scope).items[0]?.id, "source");
  assert(eligibleSource(m, 100));
  for (const patch of [
    { type: "shipment" },
    { quantity: 0 },
    { unit_cost: 99 },
  ])
    assert(!eligibleSource({ ...m, ...patch }, 100));
  assert.throws(() => validateMovements({ ...p, items: [m, m] }, scope));
  assert.throws(() =>
    validateMovements({ ...p, unit: { ...u, serial: "S1" } }, scope),
  );
  assert.throws(() => validateMovements(p, { ...scope, sites: [] }));
});

test("quantity: published native flattened wire shape is normalized exactly", async () => {
  const r = await quantityFixture();
  assert.deepEqual(
    await validateReviewResponse(
      { ...r.review, reviewHash: r.reviewHash },
      scope,
    ),
    r,
  );
  await assert.rejects(validateReviewResponse(r, scope));
  await assert.rejects(
    validateReviewResponse(
      { ...r.review, reviewHash: r.reviewHash, extra: true },
      scope,
    ),
  );
});
