import {
  canonical,
  check,
  digest,
  id,
  integer,
  now,
  permit,
  site,
  text,
  type Actor,
} from "./core.ts";
import type { Database, Store } from "./database.ts";
import type { Identity } from "./iam.ts";
import type { Platform } from "./platform.ts";
import type { Unit } from "./inventory.ts";
import { INVENTORY_VALUATION_INITIALIZE_DDL } from "./inventory-valuation-schema.ts";

export type ValuationPolicyInput = {
  productId: string;
  previousRevision: number;
  policyVersion: string;
  establishedBasis: string;
  establishedMethod: "specific-identification" | "fifo-receipt-layers";
  effectiveFrom: string;
  closedThrough: string | null;
  financeEvidence: string;
  nonInterchangeableEvidence?: string | null;
};
export type ValuationPolicy = ValuationPolicyInput & {
  orgId: string;
  revision: number;
  createdBy: string;
  createdAt: string;
};
export type ValuationReview = {
  orgId: string;
  region: string;
  currency: string;
  unit: Unit;
  carryingValue: number;
  policy: ValuationPolicy;
  policyHash: string;
  positionHash: string | null;
};
export type ValuationInput = {
  unitId: string;
  reviewHash: string;
  reference: string;
  kind: "write-down" | "reversal";
  targetValue: number;
  postingDate: string;
  reason: string;
  evidence: string;
  accountantEvidence: string;
};
export type ValuationDecision = {
  valuationId: string;
  reviewHash: string;
  decision: "approve" | "reject";
  reason: string;
};
export type Valuation = {
  id: string;
  orgId: string;
  unitId: string;
  reference: string;
  state: "ready" | "reviewed" | "rejected";
  input: ValuationInput;
  review: ValuationReview;
  reviewHash: string;
  createdBy: string;
  createdAt: string;
  decision: {
    by: string;
    at: string;
    reason: string;
    decision: "approve" | "reject";
  } | null;
  movementId: string | null;
};
export type ValuePosition = {
  orgId: string;
  unitId: string;
  quantity: number;
  value: number;
  basisQuantity: number;
  basisValue: number;
  valuationId: string;
  sinceSequence: number;
};
export type ValueEffect = {
  orgId: string;
  movementId: string;
  unitId: string;
  sequence: number;
  type: string;
  quantity: number;
  unitCost: number;
  reference: string;
  createdAt: string;
  valuationId: string;
  before: ValuePosition | null;
  after: ValuePosition;
  valueDelta: number;
  accountingDate?: string;
  recovery?: {
    lossMovementId: string;
    priorQuantity: number;
    lossQuantity: number;
  };
};
type ValueSplit = {
  orgId: string;
  sequence: number;
  before: ValuePosition;
  after: ValuePosition;
  child: ValuePosition;
};
type Stored = { record: string; hash: string };
const hash = (v: unknown) => digest(canonical(v));
const exact = (v: bigint) =>
  integer(Number(v), "Inventory carrying value", 0, Number.MAX_SAFE_INTEGER);
const portion = (value: number, quantity: number, total: number) =>
  exact((BigInt(value) * BigInt(quantity)) / BigInt(total));
function date(value: unknown, name: string) {
  const result = text(value, name, 10);
  check(
    /^\d{4}-\d{2}-\d{2}$/.test(result) &&
      Number.isFinite(Date.parse(result)) &&
      new Date(result).toISOString().slice(0, 10) === result,
    "VALIDATION",
    `${name} requires a real calendar date.`,
    400,
  );
  return result;
}
function read<T>(row: Stored): T {
  let value: T;
  try {
    value = JSON.parse(row.record) as T;
  } catch {
    check(
      false,
      "VALUATION_INTEGRITY",
      "Retained valuation evidence is malformed.",
    );
  }
  check(
    hash(value) === row.hash,
    "VALUATION_INTEGRITY",
    "Retained valuation evidence hash differs.",
  );
  return value;
}

/** Inventory-owned compensating value records. A valuation never rewrites an acquisition. */
export class InventoryValuations {
  constructor(
    private database: Database,
    private store: Store,
    private platform: Platform,
    private identity: Identity,
    private movement: (
      actor: Actor,
      unit: Unit,
      type: string,
      quantity: number,
      reference: string,
      reason: string,
    ) => string,
    private reconcile: (actor: Actor) => void,
  ) {
    store.migrate(INVENTORY_VALUATION_INITIALIZE_DDL);
  }
  private actor(actor: Actor) {
    const current = this.identity.currentActor(actor);
    permit(current, ["finance"]);
    check(
      !current.accountId,
      "FORBIDDEN",
      "An organization finance principal is required.",
      403,
    );
    check(
      !this.identity.security(current).passwordChangeRequired,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before reviewing valuation.",
      403,
    );
    return current;
  }
  private unit(actor: Actor, unitId: string) {
    const unit = this.store.get<Unit>(
      "SELECT * FROM inventory_units WHERE org_id=? AND id=?",
      actor.orgId,
      text(unitId, "Unit ID"),
    );
    check(unit, "NOT_FOUND", "Stock unit not found.", 404);
    site(actor, unit.warehouse_id);
    return unit;
  }
  private policy(actor: Actor, productId: string) {
    const row = this.store.get<Stored & { revision: number }>(
      "SELECT record,hash,revision FROM inventory_valuation_policies WHERE org_id=? AND product_id=? ORDER BY revision DESC LIMIT 1",
      actor.orgId,
      productId,
    );
    check(
      row,
      "VALUATION_POLICY",
      "An established, evidenced valuation policy is required.",
    );
    const value = read<ValuationPolicy>(row);
    check(
      value.orgId === actor.orgId &&
        value.productId === productId &&
        value.revision === row.revision,
      "VALUATION_INTEGRITY",
      "Valuation policy identity differs.",
    );
    return { value, hash: row.hash };
  }
  /** Inventory-owned policy snapshot inside an existing command transaction. */
  policySnapshot(actor: Actor, unitId: string) {
    this.database.requireTransaction();
    actor = this.actor(actor);
    const unit = this.unit(actor, unitId);
    const current = this.policy(actor, unit.product_id);
    return { ...current.value, policyHash: current.hash };
  }
  currentPolicy(actor: Actor, unitId: string) {
    return this.database.transaction(() => {
      actor = this.actor(actor);
      const unit = this.unit(actor, unitId);
      const exists = this.store.get(
        "SELECT revision FROM inventory_valuation_policies WHERE org_id=? AND product_id=? LIMIT 1",
        actor.orgId,
        unit.product_id,
      );
      const current = exists ? this.policy(actor, unit.product_id) : null;
      return {
        unitId: unit.id,
        productId: unit.product_id,
        policy: current ? { ...current.value, policyHash: current.hash } : null,
      };
    });
  }
  configure(actor: Actor, key: string, input: ValuationPolicyInput) {
    return this.platform.command(
      actor,
      "inventory.valuation.policy",
      key,
      input,
      (cached) => {
        actor = this.actor(actor);
        this.platform.assertProviderAccess();
        if (cached) {
          const row = this.store.get<Stored>(
            "SELECT record,hash FROM inventory_valuation_policies WHERE org_id=? AND product_id=? AND revision=?",
            actor.orgId,
            input.productId,
            cached.revision,
          );
          check(
            row &&
              cached.orgId === actor.orgId &&
              cached.productId === input.productId &&
              canonical({
                ...read<ValuationPolicy>(row),
                policyHash: row.hash,
              }) === canonical(cached),
            "VALUATION_INTEGRITY",
            "Cached policy differs from its retained revision.",
          );
        }
      },
      () => {
        integer(input.previousRevision, "Previous policy revision");
        check(
          ["specific-identification", "fifo-receipt-layers"].includes(
            input.establishedMethod,
          ),
          "VALIDATION",
          "Choose an evidenced supported method.",
          400,
        );
        const productId = text(input.productId, "Product ID");
        // Existence is established by inventory-owned custody; no foreign-table reads.
        check(
          this.store.get(
            "SELECT id FROM inventory_units WHERE org_id=? AND product_id=? LIMIT 1",
            actor.orgId,
            productId,
          ),
          "NOT_FOUND",
          "No stock custody exists for this product.",
          404,
        );
        const previousRow = this.store.get<Stored>(
          "SELECT record,hash FROM inventory_valuation_policies WHERE org_id=? AND product_id=? ORDER BY revision DESC LIMIT 1",
          actor.orgId,
          productId,
        );
        const previous = previousRow
          ? read<ValuationPolicy>(previousRow)
          : null;
        check(
          (previous?.revision ?? 0) === input.previousRevision,
          "VALUATION_POLICY_STALE",
          "Policy revision changed; review the current policy.",
        );
        const effectiveFrom = date(input.effectiveFrom, "Effective date"),
          closedThrough =
            input.closedThrough === null
              ? null
              : date(input.closedThrough, "Closed-through date"),
          establishedBasis = text(
            input.establishedBasis,
            "Established basis",
            2000,
          ),
          nonInterchangeableEvidence = input.nonInterchangeableEvidence
            ? text(
                input.nonInterchangeableEvidence,
                "Non-interchangeable evidence",
                2000,
              )
            : null;
        check(
          input.establishedMethod !== "specific-identification" ||
            nonInterchangeableEvidence,
          "VALUATION_POLICY",
          "Serial tracking alone does not evidence non-interchangeability.",
        );
        check(
          !previous ||
            (previous.establishedMethod === input.establishedMethod &&
              previous.establishedBasis === establishedBasis &&
              previous.effectiveFrom === effectiveFrom),
          "VALUATION_METHOD_CHANGE",
          "An established basis or method cannot be changed through ordinary valuation policy maintenance.",
        );
        check(
          !previous?.closedThrough ||
            (closedThrough && closedThrough >= previous.closedThrough),
          "VALUATION_PERIOD",
          "Closed reporting periods cannot be reopened here.",
        );
        const policy: ValuationPolicy = {
          productId,
          previousRevision: input.previousRevision,
          policyVersion: text(input.policyVersion, "Policy version"),
          establishedBasis,
          establishedMethod: input.establishedMethod,
          effectiveFrom,
          closedThrough,
          financeEvidence: text(
            input.financeEvidence,
            "Finance evidence",
            2000,
          ),
          nonInterchangeableEvidence,
          orgId: actor.orgId,
          revision: input.previousRevision + 1,
          createdBy: actor.id,
          createdAt: now(),
        };
        this.store.run(
          "INSERT INTO inventory_valuation_policies VALUES(?,?,?,?,?)",
          actor.orgId,
          productId,
          policy.revision,
          canonical(policy),
          hash(policy),
        );
        return { ...policy, policyHash: hash(policy) };
      },
    );
  }
  private reviewValue(actor: Actor, unitId: string): ValuationReview {
    const unit = this.unit(actor, unitId),
      policy = this.policy(actor, unit.product_id),
      position = this.position(actor.orgId, unit.id),
      org = this.identity.organization(actor);
    check(
      unit.quantity > 0 && ["stock", "transit"].includes(unit.state),
      "VALUATION_CUSTODY",
      "Only physically held or in-transit stock can be valued.",
    );
    check(
      !position || position.quantity === unit.quantity,
      "VALUATION_INTEGRITY",
      "Retained carrying quantity differs from physical stock.",
    );
    return {
      orgId: actor.orgId,
      region: org.region,
      currency: org.currency,
      unit,
      carryingValue:
        position?.value ?? exact(BigInt(unit.cost) * BigInt(unit.quantity)),
      policy: policy.value,
      policyHash: policy.hash,
      positionHash: position ? hash(position) : null,
    };
  }
  review(actor: Actor, unitId: string) {
    return this.database.transaction(() => {
      actor = this.actor(actor);
      this.reconcile(actor);
      const review = this.reviewValue(actor, unitId);
      return { ...review, reviewHash: hash(review) };
    });
  }
  prepare(actor: Actor, key: string, input: ValuationInput) {
    return this.platform.command(
      actor,
      "inventory.valuation.prepare",
      key,
      input,
      (cached) => {
        actor = this.actor(actor);
        this.platform.assertProviderAccess();
        this.unit(actor, input.unitId);
        if (cached) {
          this.reconcile(actor);
          const retained = this.get(actor, cached.id);
          check(
            cached.state === "ready" &&
              cached.createdBy === actor.id &&
              cached.unitId === input.unitId &&
              canonical({
                ...retained,
                state: "ready",
                decision: null,
                movementId: null,
              }) === canonical(cached),
            "VALUATION_INTEGRITY",
            "Cached valuation differs from its original retained preparation.",
          );
        }
      },
      () => {
        this.reconcile(actor);
        const review = this.reviewValue(actor, input.unitId);
        check(
          hash(review) === input.reviewHash,
          "VALUATION_STALE",
          "Stock or policy changed; review it again.",
        );
        const targetValue = integer(
            input.targetValue,
            "Target carrying value",
            0,
            Number.MAX_SAFE_INTEGER,
          ),
          postingDate = date(input.postingDate, "Posting date");
        check(
          postingDate >= review.policy.effectiveFrom &&
            (!review.policy.closedThrough ||
              postingDate > review.policy.closedThrough),
          "VALUATION_PERIOD",
          "Use an explicitly permitted open posting date.",
        );
        check(
          (input.kind === "write-down" && targetValue < review.carryingValue) ||
            (input.kind === "reversal" &&
              targetValue > review.carryingValue &&
              targetValue <=
                exact(
                  BigInt(review.unit.quantity) * BigInt(review.unit.cost),
                ) &&
              review.positionHash),
          "VALUATION_DIRECTION",
          "A write-down must decrease value; a reversal requires a retained decrease and cannot exceed original acquisition cost.",
        );
        const prepared: Valuation = {
          id: id(),
          orgId: actor.orgId,
          unitId: review.unit.id,
          reference: text(input.reference, "Valuation reference"),
          state: "ready",
          input: {
            unitId: review.unit.id,
            reviewHash: input.reviewHash,
            reference: text(input.reference, "Valuation reference"),
            kind: input.kind,
            targetValue,
            postingDate,
            reason: text(input.reason, "Reason", 2000),
            evidence: text(input.evidence, "Value evidence", 2000),
            accountantEvidence: text(
              input.accountantEvidence,
              "Accountant evidence",
              2000,
            ),
          },
          review,
          reviewHash: hash(review),
          createdBy: actor.id,
          createdAt: now(),
          decision: null,
          movementId: null,
        };
        check(
          !this.store.get(
            "SELECT id FROM inventory_valuations WHERE org_id=? AND reference=?",
            actor.orgId,
            prepared.reference,
          ),
          "VALUATION_REFERENCE",
          "This valuation reference is already retained.",
        );
        this.store.run(
          "INSERT INTO inventory_valuations VALUES(?,?,?,?,?,?,?)",
          prepared.id,
          actor.orgId,
          prepared.unitId,
          prepared.reference,
          prepared.state,
          canonical(prepared),
          hash(prepared),
        );
        return prepared;
      },
    );
  }
  get(actor: Actor, valuationId: string): Valuation {
    actor = this.actor(actor);
    const selectedId = text(valuationId, "Valuation ID");
    check(
      this.store.get(
        "SELECT id FROM inventory_valuations WHERE org_id=? AND id=?",
        actor.orgId,
        selectedId,
      ),
      "NOT_FOUND",
      "Valuation not found.",
      404,
    );
    const record = this.retained(actor.orgId, selectedId);
    this.unit(actor, record.unitId);
    return record;
  }
  history(actor: Actor, unitId: string, afterId?: string) {
    return this.database.transaction(() => {
      actor = this.actor(actor);
      this.unit(actor, unitId);
      const cursor = afterId ? this.get(actor, afterId) : null;
      check(
        !cursor || cursor.unitId === unitId,
        "VALIDATION",
        "History cursor belongs to another unit.",
        400,
      );
      const rows = this.store.all<{ id: string }>(
        "SELECT id FROM inventory_valuations WHERE org_id=? AND unit_id=? AND rowid>coalesce((SELECT rowid FROM inventory_valuations WHERE org_id=? AND id=?),0) ORDER BY rowid LIMIT 21",
        actor.orgId,
        unitId,
        actor.orgId,
        afterId ?? null,
      );
      return {
        rows: rows.slice(0, 20).map((r) => this.get(actor, r.id)),
        more: rows.length > 20,
      };
    });
  }
  private retained(orgId: string, valuationId: string) {
    const row = this.store.get<
      Stored & {
        id: string;
        org_id: string;
        unit_id: string;
        reference: string;
        state: string;
      }
    >(
      "SELECT * FROM inventory_valuations WHERE org_id=? AND id=?",
      orgId,
      valuationId,
    );
    check(row, "VALUATION_INTEGRITY", "Retained valuation is missing.");
    const value = read<Valuation>(row);
    check(
      value.id === row.id &&
        value.orgId === row.org_id &&
        value.unitId === row.unit_id &&
        value.reference === row.reference &&
        value.state === row.state &&
        value.reviewHash === hash(value.review) &&
        value.input.reviewHash === value.reviewHash &&
        value.review.orgId === orgId &&
        value.review.unit.id === value.unitId &&
        value.review.policyHash === hash(value.review.policy),
      "VALUATION_INTEGRITY",
      "Retained valuation identities or review binding differ.",
    );
    check(
      value.state === "ready"
        ? !value.decision && !value.movementId
        : value.decision &&
            value.decision.by !== value.createdBy &&
            (value.state === "reviewed"
              ? value.decision.decision === "approve" && value.movementId
              : value.decision.decision === "reject" && !value.movementId),
      "VALUATION_INTEGRITY",
      "Valuation approval evidence is incomplete.",
    );
    const unit = this.store.get<Unit>(
        "SELECT * FROM inventory_units WHERE org_id=? AND id=?",
        orgId,
        value.unitId,
      ),
      policyRow = this.store.get<Stored>(
        "SELECT record,hash FROM inventory_valuation_policies WHERE org_id=? AND product_id=? AND revision=?",
        orgId,
        value.review.unit.product_id,
        value.review.policy.revision,
      );
    check(
      unit &&
        unit.cost === value.review.unit.cost &&
        unit.product_id === value.review.unit.product_id &&
        policyRow &&
        policyRow.hash === value.review.policyHash &&
        canonical(read<ValuationPolicy>(policyRow)) ===
          canonical(value.review.policy),
      "VALUATION_INTEGRITY",
      "Valuation original acquisition or historical policy differs.",
    );
    return value;
  }
  decide(actor: Actor, key: string, input: ValuationDecision) {
    return this.platform.command(
      actor,
      "inventory.valuation.decide",
      key,
      input,
      (cached) => {
        actor = this.actor(actor);
        this.platform.assertProviderAccess();
        const value = this.get(actor, input.valuationId);
        if (cached) {
          this.reconcile(actor);
          check(
            canonical(value) === canonical(cached),
            "VALUATION_INTEGRITY",
            "Cached decision differs from retained evidence.",
          );
        }
      },
      () => {
        const value = this.get(actor, input.valuationId);
        check(
          value.state === "ready",
          "VALUATION_STATE",
          "This valuation already has a decision.",
        );
        check(
          actor.id !== value.createdBy,
          "VALUATION_SEPARATION",
          "A different current finance principal must review this valuation.",
        );
        check(
          input.reviewHash === value.reviewHash,
          "VALUATION_STALE",
          "Decision must bind the prepared review.",
        );
        check(
          input.decision === "approve" || input.decision === "reject",
          "VALIDATION",
          "Choose approve or reject.",
          400,
        );
        this.reconcile(actor);
        if (input.decision === "approve")
          check(
            hash(this.reviewValue(actor, value.unitId)) === value.reviewHash,
            "VALUATION_STALE",
            "Stock or policy changed after preparation.",
          );
        const at = now(),
          reason = text(input.reason, "Decision reason", 2000);
        value.decision = { by: actor.id, at, reason, decision: input.decision };
        value.state = input.decision === "approve" ? "reviewed" : "rejected";
        if (input.decision === "approve") {
          const before = this.position(actor.orgId, value.unitId),
            u = this.unit(actor, value.unitId);
          value.movementId = this.movement(
            actor,
            u,
            "valuation.adjustment",
            0,
            value.id,
            reason,
          );
          const m = this.movementRow(actor.orgId, value.movementId);
          const after: ValuePosition = {
            orgId: actor.orgId,
            unitId: u.id,
            quantity: u.quantity,
            value: value.input.targetValue,
            basisQuantity: u.quantity,
            basisValue: value.input.targetValue,
            valuationId: value.id,
            sinceSequence: before?.sinceSequence ?? m.sequence,
          };
          this.savePosition(after);
          this.saveEffect({
            ...m,
            valuationId: value.id,
            before,
            after,
            valueDelta: value.input.targetValue - value.review.carryingValue,
            accountingDate: value.input.postingDate,
          });
          this.store.run(
            "UPDATE inventory_units SET revision=revision+1 WHERE org_id=? AND id=?",
            actor.orgId,
            u.id,
          );
        }
        this.store.run(
          "UPDATE inventory_valuations SET state=?,record=?,hash=? WHERE org_id=? AND id=?",
          value.state,
          canonical(value),
          hash(value),
          actor.orgId,
          value.id,
        );
        this.reconcile(actor);
        return value;
      },
    );
  }
  position(orgId: string, unitId: string): ValuePosition | null {
    const row = this.store.get<Stored>(
      "SELECT record,hash FROM inventory_valuation_positions WHERE org_id=? AND unit_id=?",
      orgId,
      unitId,
    );
    if (!row) return null;
    const p = read<ValuePosition>(row);
    check(
      p.orgId === orgId &&
        p.unitId === unitId &&
        Number.isSafeInteger(p.quantity) &&
        p.quantity >= 0 &&
        Number.isSafeInteger(p.value) &&
        p.value >= 0 &&
        Number.isSafeInteger(p.basisQuantity) &&
        p.basisQuantity > 0 &&
        Number.isSafeInteger(p.basisValue) &&
        p.basisValue >= 0 &&
        Number.isSafeInteger(p.sinceSequence) &&
        p.sinceSequence > 0,
      "VALUATION_INTEGRITY",
      "Carrying position identity or totals are invalid.",
    );
    return p;
  }
  private savePosition(p: ValuePosition) {
    this.database.requireTransaction();
    this.store.run(
      "INSERT INTO inventory_valuation_positions VALUES(?,?,?,?) ON CONFLICT(org_id,unit_id) DO UPDATE SET record=excluded.record,hash=excluded.hash",
      p.orgId,
      p.unitId,
      canonical(p),
      hash(p),
    );
  }
  private movementRow(orgId: string, movementId: string) {
    const m = this.store.get<
      Omit<
        ValueEffect,
        | "before"
        | "after"
        | "valuationId"
        | "valueDelta"
        | "accountingDate"
        | "recovery"
      >
    >(
      "SELECT s.sequence,m.org_id AS orgId,m.id AS movementId,m.unit_id AS unitId,m.type,m.quantity,m.unit_cost AS unitCost,m.reference,m.created_at AS createdAt FROM inventory_movements m JOIN inventory_cost_sequences s ON s.org_id=m.org_id AND s.movement_id=m.id WHERE m.org_id=? AND m.id=?",
      orgId,
      movementId,
    );
    check(m, "VALUATION_INTEGRITY", "Valuation movement is missing.");
    return m;
  }
  private saveEffect(e: ValueEffect) {
    this.database.requireTransaction();
    this.store.run(
      "INSERT INTO inventory_value_effects VALUES(?,?,?,?,?)",
      e.movementId,
      e.orgId,
      e.unitId,
      canonical(e),
      hash(e),
    );
  }
  /** Called only by the owning inventory operation, in the shared transaction. */
  record(orgId: string, movementId: string) {
    this.database.requireTransaction();
    const m = this.movementRow(orgId, movementId);
    if (m.type === "valuation.adjustment") return;
    const before = this.position(orgId, m.unitId);
    if (!before) return;
    const custody = [
      "relocation.split.out",
      "relocation.split.in",
      "transfer.dispatch",
      "transfer.receive",
    ].includes(m.type);
    let delta = 0;
    let recovery: ValueEffect["recovery"];
    if (m.type === "transfer.recover") {
      const recovered = this.recoveryValue(orgId, m.reference, m.quantity);
      check(
        recovered && recovered.position.valuationId === before.valuationId,
        "VALUATION_INTEGRITY",
        "Recovery has no matching carrying loss.",
      );
      delta = recovered.value;
      recovery = recovered.evidence;
    } else if (!custody && m.quantity < 0) {
      check(
        -m.quantity <= before.quantity && before.quantity > 0,
        "VALUATION_INTEGRITY",
        "Disposed quantity exceeds retained carrying quantity.",
      );
      delta = -portion(before.value, -m.quantity, before.quantity);
    } else if (!custody && m.quantity > 0)
      delta = portion(before.basisValue, m.quantity, before.basisQuantity);
    const after = {
      ...before,
      quantity: before.quantity + (custody ? 0 : m.quantity),
      value: before.value + delta,
    };
    this.savePosition(after);
    this.saveEffect({
      ...m,
      valuationId: before.valuationId,
      before,
      after,
      valueDelta: delta,
      ...(recovery ? { recovery } : {}),
    });
  }
  /** The source and child acquisition layers remain distinct; division keeps the remainder at source. */
  split(orgId: string, sourceId: string, childId: string, quantity: number) {
    this.database.requireTransaction();
    const before = this.position(orgId, sourceId);
    if (!before) return;
    check(
      quantity > 0 && quantity < before.quantity,
      "VALUATION_INTEGRITY",
      "A carrying split requires a proper partial quantity.",
    );
    const value = portion(before.value, quantity, before.quantity),
      sequence =
        this.store.get<{ last_sequence: number }>(
          "SELECT last_sequence FROM inventory_cost_clock WHERE id=1",
        )!.last_sequence + 1,
      after = {
        ...before,
        quantity: before.quantity - quantity,
        value: before.value - value,
      },
      child = {
        ...before,
        unitId: childId,
        quantity,
        value,
        sinceSequence: sequence,
      };
    check(
      !this.position(orgId, childId),
      "VALUATION_INTEGRITY",
      "Split child already carries valuation evidence.",
    );
    const split: ValueSplit = { orgId, sequence, before, after, child };
    this.store.run(
      "INSERT INTO inventory_value_splits VALUES(?,?,?,?,?)",
      childId,
      orgId,
      sequence,
      canonical(split),
      hash(split),
    );
    this.savePosition(after);
    this.savePosition(child);
  }
  private recoveryValue(orgId: string, lossId: string, quantity: number) {
    const lossRow = this.store.get<Stored>(
      "SELECT e.record,e.hash FROM inventory_value_effects e JOIN inventory_movements m ON m.org_id=e.org_id AND m.id=e.movement_id WHERE m.org_id=? AND m.type='transfer.loss' AND m.reference=?",
      orgId,
      lossId,
    );
    if (!lossRow) return null;
    const loss = read<ValueEffect>(lossRow);
    check(
      loss.before && loss.quantity < 0 && loss.valueDelta <= 0,
      "VALUATION_INTEGRITY",
      "Retained loss carrying evidence is invalid.",
    );
    const recovered = this.store.get<{ quantity: number }>(
        "SELECT coalesce(sum(quantity),0) AS quantity FROM inventory_transfer_recoveries WHERE org_id=? AND loss_id=?",
        orgId,
        lossId,
      )!.quantity,
      priorQuantity = recovered - quantity,
      lossQuantity = -loss.quantity;
    check(
      priorQuantity >= 0 && recovered <= lossQuantity,
      "VALUATION_INTEGRITY",
      "Recovered quantity differs from retained loss.",
    );
    const lossValue = -loss.valueDelta,
      value =
        portion(lossValue, recovered, lossQuantity) -
        portion(lossValue, priorQuantity, lossQuantity);
    return {
      value,
      position: loss.before,
      evidence: {
        lossMovementId: loss.movementId,
        priorQuantity,
        lossQuantity,
      },
    };
  }
  /** Initialize a recovered bulk layer from the loss-time carrying value, after the native recovery row is retained. */
  recover(orgId: string, unitId: string, lossId: string, quantity: number) {
    this.database.requireTransaction();
    if (this.position(orgId, unitId)) return;
    const recovered = this.recoveryValue(orgId, lossId, quantity);
    if (!recovered) return;
    const sequence =
      this.store.get<{ last_sequence: number }>(
        "SELECT last_sequence FROM inventory_cost_clock WHERE id=1",
      )!.last_sequence + 1;
    this.savePosition({
      ...recovered.position,
      unitId,
      quantity: 0,
      value: 0,
      basisValue: recovered.value,
      basisQuantity: quantity,
      sinceSequence: sequence,
    });
  }
  /** Full-history validation used by stock-cost export. No historical bytes are rewritten. */
  evidence(orgId: string) {
    const effects = new Map<string, ValueEffect>();
    for (const row of this.store.all<
      Stored & { movement_id: string; unit_id: string }
    >("SELECT * FROM inventory_value_effects WHERE org_id=?", orgId)) {
      const e = read<ValueEffect>(row),
        m = this.movementRow(orgId, row.movement_id),
        root = this.retained(orgId, e.valuationId);
      check(
        root.state === "reviewed" &&
          e.movementId === row.movement_id &&
          e.unitId === row.unit_id &&
          canonical(m) ===
            canonical({
              orgId: e.orgId,
              movementId: e.movementId,
              unitId: e.unitId,
              sequence: e.sequence,
              type: e.type,
              quantity: e.quantity,
              unitCost: e.unitCost,
              reference: e.reference,
              createdAt: e.createdAt,
            }) &&
          Number.isSafeInteger(e.valueDelta),
        "VALUATION_INTEGRITY",
        "Value effect differs from its movement or approved source.",
      );
      if (e.type === "valuation.adjustment")
        check(
          root.movementId === e.movementId &&
            root.unitId === e.unitId &&
            root.input.targetValue === e.after.value &&
            e.valueDelta ===
              root.input.targetValue - root.review.carryingValue &&
            e.accountingDate === root.input.postingDate &&
            e.reference === root.id,
          "VALUATION_INTEGRITY",
          "Approved adjustment differs from its retained review.",
        );
      else
        check(
          e.before && e.after.value - e.before.value === e.valueDelta,
          "VALUATION_INTEGRITY",
          "Carrying movement does not balance.",
        );
      effects.set(e.movementId, e);
    }
    const positions = new Map<string, ValuePosition>();
    for (const row of this.store.all<{ unit_id: string }>(
      "SELECT unit_id FROM inventory_valuation_positions WHERE org_id=?",
      orgId,
    )) {
      const p = this.position(orgId, row.unit_id)!;
      const root = this.retained(orgId, p.valuationId);
      check(
        root.state === "reviewed",
        "VALUATION_INTEGRITY",
        "Carrying position lacks an approved source.",
      );
      positions.set(row.unit_id, p);
    }
    for (const v of this.store.all<{ id: string }>(
      "SELECT id FROM inventory_valuations WHERE org_id=? AND state='reviewed'",
      orgId,
    )) {
      const value = this.retained(orgId, v.id);
      check(
        value.movementId &&
          effects.has(value.movementId) &&
          positions.has(value.unitId),
        "VALUATION_INTEGRITY",
        "Approved valuation effect or carrying position is missing.",
      );
    }
    const splits = new Map<number, ValueSplit[]>();
    for (const row of this.store.all<
      Stored & { child_id: string; sequence: number }
    >(
      "SELECT * FROM inventory_value_splits WHERE org_id=? ORDER BY sequence,child_id",
      orgId,
    )) {
      const split = read<ValueSplit>(row);
      check(
        split.orgId === orgId &&
          split.child.unitId === row.child_id &&
          split.sequence === row.sequence &&
          split.before.unitId === split.after.unitId &&
          split.before.quantity ===
            split.after.quantity + split.child.quantity &&
          split.before.value === split.after.value + split.child.value &&
          split.child.value ===
            portion(
              split.before.value,
              split.child.quantity,
              split.before.quantity,
            ) &&
          split.child.sinceSequence === split.sequence &&
          split.before.valuationId === split.child.valuationId &&
          split.after.valuationId === split.before.valuationId &&
          positions.has(split.before.unitId) &&
          positions.has(split.child.unitId),
        "VALUATION_INTEGRITY",
        "Retained carrying split is missing, unbalanced or invalid.",
      );
      const parent = this.store.get<Unit>(
          "SELECT * FROM inventory_units WHERE org_id=? AND id=?",
          orgId,
          split.before.unitId,
        ),
        child = this.store.get<Unit>(
          "SELECT * FROM inventory_units WHERE org_id=? AND id=?",
          orgId,
          split.child.unitId,
        );
      check(
        parent &&
          child &&
          parent.product_id === child.product_id &&
          parent.cost === child.cost &&
          !parent.serial &&
          !child.serial &&
          split.child.basisQuantity === split.before.basisQuantity &&
          split.child.basisValue === split.before.basisValue &&
          split.after.basisQuantity === split.before.basisQuantity &&
          split.after.basisValue === split.before.basisValue,
        "VALUATION_INTEGRITY",
        "Split changed the acquisition layer or carrying basis.",
      );
      const list = splits.get(row.sequence) ?? [];
      list.push(split);
      splits.set(row.sequence, list);
    }
    const replay = new Map<string, ValuePosition>();
    const recoveredByLoss = new Map<string, number>();
    this.store.visit<{
      movement_id: string;
      unit_id: string;
      sequence: number;
      type: string;
    }>(
      "SELECT s.movement_id,s.sequence,m.unit_id,m.type FROM inventory_cost_sequences s JOIN inventory_movements m ON m.org_id=s.org_id AND m.id=s.movement_id WHERE s.org_id=? ORDER BY s.sequence",
      [orgId],
      (m) => {
        for (const split of splits.get(m.sequence) ?? []) {
          check(
            canonical(replay.get(split.before.unitId)) ===
              canonical(split.before) &&
              !replay.has(split.child.unitId) &&
              [
                "relocation.split.out",
                "shortpick.hold",
                "transfer.dispatch",
                "transfer.receive",
              ].includes(m.type) &&
              [split.before.unitId, split.child.unitId].includes(m.unit_id),
            "VALUATION_INTEGRITY",
            "Split is not bound to current carrying custody.",
          );
          replay.set(split.after.unitId, split.after);
          replay.set(split.child.unitId, split.child);
          splits.delete(m.sequence);
        }
        const e = effects.get(m.movement_id),
          prior = replay.get(m.unit_id);
        if (!e) {
          check(
            !prior && m.type !== "valuation.adjustment",
            "VALUATION_INTEGRITY",
            "A valued custody movement lacks carrying evidence.",
          );
          return;
        }
        check(
          positions.has(e.unitId) &&
            e.orgId === orgId &&
            e.after.orgId === orgId &&
            e.after.unitId === e.unitId &&
            e.after.quantity >= 0 &&
            Number.isSafeInteger(e.after.quantity) &&
            Number.isSafeInteger(e.after.value) &&
            e.after.value >= 0,
          "VALUATION_INTEGRITY",
          "Value effect has no valid retained position.",
        );
        if (e.type === "valuation.adjustment") {
          const root = this.retained(orgId, e.valuationId),
            u = root.review.unit;
          check(
            canonical(prior ?? null) === canonical(e.before) &&
              e.after.quantity === u.quantity &&
              e.after.basisQuantity === u.quantity &&
              e.after.basisValue === root.input.targetValue &&
              e.after.valuationId === root.id &&
              e.after.sinceSequence === (prior?.sinceSequence ?? e.sequence) &&
              root.review.positionHash === (prior ? hash(prior) : null) &&
              root.review.carryingValue ===
                (prior?.value ?? exact(BigInt(u.cost) * BigInt(u.quantity))),
            "VALUATION_INTEGRITY",
            "Adjustment does not follow the approved carrying source.",
          );
        } else {
          check(
            e.before,
            "VALUATION_INTEGRITY",
            "Carrying movement lacks prior evidence.",
          );
          if (!prior)
            check(
              e.type === "transfer.recover" &&
                e.recovery &&
                e.before.quantity === 0 &&
                e.before.value === 0 &&
                e.before.sinceSequence === e.sequence,
              "VALUATION_INTEGRITY",
              "Carrying layer appeared without approval, split or recovery.",
            );
          else
            check(
              canonical(prior) === canonical(e.before),
              "VALUATION_INTEGRITY",
              "Carrying movement source differs from retained lineage.",
            );
          const custody = [
            "relocation.split.out",
            "relocation.split.in",
            "transfer.dispatch",
            "transfer.receive",
          ].includes(e.type);
          let expected = 0;
          if (e.type === "transfer.recover") {
            const loss = e.recovery
              ? effects.get(e.recovery.lossMovementId)
              : null;
            check(
              loss &&
                loss.type === "transfer.loss" &&
                loss.before &&
                loss.sequence < e.sequence &&
                loss.reference === e.reference &&
                e.recovery!.lossQuantity === -loss.quantity &&
                (recoveredByLoss.get(loss.movementId) ?? 0) ===
                  e.recovery!.priorQuantity &&
                e.recovery!.priorQuantity + e.quantity <= -loss.quantity &&
                loss.before.valuationId === e.valuationId,
              "VALUATION_INTEGRITY",
              "Recovery does not conserve the retained loss.",
            );
            const qty = e.recovery!.priorQuantity;
            expected =
              portion(-loss.valueDelta, qty + e.quantity, -loss.quantity) -
              portion(-loss.valueDelta, qty, -loss.quantity);
            recoveredByLoss.set(loss.movementId, qty + e.quantity);
            if (!prior)
              check(
                e.before.basisValue === expected &&
                  e.before.basisQuantity === e.quantity,
                "VALUATION_INTEGRITY",
                "Recovered opening layer differs from loss-time value.",
              );
          } else if (!custody && e.quantity < 0) {
            check(
              e.before.quantity >= -e.quantity && e.before.quantity > 0,
              "VALUATION_INTEGRITY",
              "Carrying disposal exceeds available quantity.",
            );
            expected = -portion(e.before.value, -e.quantity, e.before.quantity);
          } else if (!custody && e.quantity > 0)
            expected = portion(
              e.before.basisValue,
              e.quantity,
              e.before.basisQuantity,
            );
          check(
            e.valueDelta === expected &&
              canonical(e.after) ===
                canonical({
                  ...e.before,
                  quantity: e.before.quantity + (custody ? 0 : e.quantity),
                  value: e.before.value + expected,
                }),
            "VALUATION_INTEGRITY",
            "Carrying arithmetic or retained basis differs.",
          );
        }
        replay.set(e.unitId, e.after);
      },
    );
    check(
      !splits.size && replay.size === positions.size,
      "VALUATION_INTEGRITY",
      "Carrying lineage is incomplete or contains orphan evidence.",
    );
    for (const [unitId, p] of positions)
      check(
        canonical(replay.get(unitId)) === canonical(p),
        "VALUATION_INTEGRITY",
        "Current carrying position differs from retained lineage.",
      );
    return { effects, positions };
  }
}
