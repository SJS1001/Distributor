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
import type {
  InventoryValuations,
  ValuationPolicy,
} from "./inventory-valuations.ts";
import { INVENTORY_QUANTITY_INITIALIZE_DDL } from "./inventory-quantity-schema.ts";
import { quantityRecordShape } from "../shared/inventory-quantity.ts";

type Movement = {
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
  decision: {
    by: string;
    at: string;
    decision: "approve" | "reject";
    reason: string;
  } | null;
  movement: Movement | null;
  valueDelta: number | null;
};
const hash = (value: unknown) => digest(canonical(value));
function date(value: unknown) {
  const result = text(value, "Posting date", 10);
  check(
    /^\d{4}-\d{2}-\d{2}$/.test(result) &&
      Number.isFinite(Date.parse(result)) &&
      new Date(result).toISOString().slice(0, 10) === result,
    "VALIDATION",
    "Use a real posting date.",
    400,
  );
  return result;
}

/** Inventory-owned compensation; never updates the erroneous source movement or a ledger packet. */
export class InventoryQuantityCorrections {
  constructor(
    private database: Database,
    private store: Store,
    private platform: Platform,
    private identity: Identity,
    private valuations: InventoryValuations,
    private applyCount: (
      actor: Actor,
      input: {
        unitId: string;
        revision: number;
        count: number;
        reason: string;
      },
      reference: string,
    ) => unknown,
    private reconcile: (actor: Actor) => void,
  ) {
    store.migrate(INVENTORY_QUANTITY_INITIALIZE_DDL);
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
      "Change your password before quantity-error review.",
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
  private snapshot(
    actor: Actor,
    unitId: string,
    sourceMovementId: string,
  ): QuantityCorrectionReview {
    const unit = this.unit(actor, unitId);
    check(
      unit.state === "stock" && !unit.serial,
      "QUANTITY_CUSTODY",
      "Bulk stock errors use this control; serialized discrepancies require the serial custody review.",
    );
    const source = this.store.get<Movement>(
      "SELECT * FROM inventory_movements WHERE org_id=? AND unit_id=? AND id=?",
      actor.orgId,
      unit.id,
      text(sourceMovementId, "Source movement ID"),
    );
    check(
      source,
      "NOT_FOUND",
      "Source movement not found on this stock layer.",
      404,
    );
    check(
      ["receipt", "opening", "count", "quantity.correction"].includes(
        source.type,
      ) &&
        source.quantity !== 0 &&
        source.unit_cost === unit.cost,
      "QUANTITY_SOURCE",
      "Use an acquisition or physical count error; delivery and transfer errors require their owning workflow.",
    );
    const policy = this.valuations.policySnapshot(actor, unit.id);
    check(
      policy,
      "VALUATION_POLICY",
      "Establish the customer's evidenced accounting policy first.",
    );
    const position = this.valuations.position(actor.orgId, unit.id),
      org = this.identity.organization(actor);
    check(
      !position || position.quantity === unit.quantity,
      "VALUATION_INTEGRITY",
      "Carrying quantity differs from physical stock.",
    );
    const reserved = this.store.get<{ quantity: number }>(
      "SELECT (SELECT COALESCE(SUM(quantity-consumed-released),0) FROM inventory_allocations WHERE org_id=? AND unit_id=?)+(SELECT COALESCE(SUM(quantity-settled),0) FROM inventory_incoming_holds WHERE org_id=? AND unit_id=?) AS quantity",
      actor.orgId,
      unit.id,
      actor.orgId,
      unit.id,
    )!.quantity;
    return {
      orgId: actor.orgId,
      region: org.region,
      currency: org.currency,
      unit,
      source,
      reserved,
      carryingValue:
        position?.value ??
        integer(
          Number(BigInt(unit.cost) * BigInt(unit.quantity)),
          "Original stock value",
          0,
          Number.MAX_SAFE_INTEGER,
        ),
      positionHash: position ? hash(position) : null,
      policy,
    };
  }
  review(actor: Actor, unitId: string, sourceMovementId: string) {
    return this.database.transaction(() => {
      actor = this.actor(actor);
      this.reconcile(actor);
      const review = this.snapshot(actor, unitId, sourceMovementId);
      return { ...review, reviewHash: hash(review) };
    });
  }
  private period(review: QuantityCorrectionReview, postingDate: string) {
    check(
      postingDate >= review.policy.effectiveFrom &&
        (!review.policy.closedThrough ||
          postingDate > review.policy.closedThrough),
      "QUANTITY_PERIOD",
      "Choose an explicitly permitted open accounting date; closed periods are not reopened.",
    );
  }
  prepare(actor: Actor, key: string, input: QuantityCorrectionInput) {
    return this.platform.command(
      actor,
      "inventory.quantity.prepare",
      key,
      input,
      (cached) => {
        actor = this.actor(actor);
        this.platform.assertProviderAccess();
        this.unit(actor, input.unitId);
        if (cached) {
          this.reconcile(actor);
          const retained = this.authorizedRecord(actor, cached.id);
          check(
            cached.createdBy === actor.id &&
              canonical({
                ...retained,
                state: "ready",
                decision: null,
                movement: null,
                valueDelta: null,
              }) === canonical(cached),
            "QUANTITY_INTEGRITY",
            "Cached preparation differs from its original retained record.",
          );
        }
      },
      () => {
        this.reconcile(actor);
        const review = this.snapshot(
          actor,
          input.unitId,
          input.sourceMovementId,
        );
        check(
          hash(review) === input.reviewHash,
          "QUANTITY_STALE",
          "Stock, reservations or accounting policy changed; review again.",
        );
        const targetQuantity = integer(
            input.targetQuantity,
            "Correct physical quantity",
            0,
            100000,
          ),
          postingDate = date(input.postingDate);
        check(
          targetQuantity !== review.unit.quantity,
          "QUANTITY_DIRECTION",
          "A quantity error must change physical quantity.",
        );
        check(
          targetQuantity >= review.reserved,
          "ALLOCATION",
          "Reconcile allocated orders before removing their stock.",
        );
        this.period(review, postingDate);
        const value: QuantityCorrection = {
          id: id(),
          orgId: actor.orgId,
          unitId: review.unit.id,
          reference: text(input.reference, "Error reference"),
          state: "ready",
          input: {
            unitId: review.unit.id,
            sourceMovementId: review.source.id,
            reviewHash: input.reviewHash,
            reference: text(input.reference, "Error reference"),
            targetQuantity,
            postingDate,
            reason: text(input.reason, "Error reason", 1000),
            physicalEvidence: text(
              input.physicalEvidence,
              "Physical evidence",
              2000,
            ),
            accountantEvidence: text(
              input.accountantEvidence,
              "Accountant classification and period evidence",
              2000,
            ),
          },
          review,
          reviewHash: hash(review),
          createdBy: actor.id,
          createdAt: now(),
          decision: null,
          movement: null,
          valueDelta: null,
        };
        check(
          !this.store.get(
            "SELECT id FROM inventory_quantity_corrections WHERE org_id=? AND reference=?",
            actor.orgId,
            value.reference,
          ),
          "QUANTITY_REFERENCE",
          "This error reference is already retained.",
        );
        check(
          !this.store.get(
            "SELECT id FROM inventory_quantity_corrections WHERE org_id=? AND unit_id=? AND state='ready'",
            actor.orgId,
            value.unitId,
          ),
          "QUANTITY_PENDING",
          "Decide the existing prepared correction before preparing another.",
        );
        this.store.run(
          "INSERT INTO inventory_quantity_corrections VALUES(?,?,?,?,?,?,?)",
          value.id,
          value.orgId,
          value.unitId,
          value.reference,
          value.state,
          canonical(value),
          hash(value),
        );
        return value;
      },
    );
  }
  private retained(orgId: string, correctionId: string): QuantityCorrection {
    const row = this.store.get<{
      id: string;
      org_id: string;
      unit_id: string;
      reference: string;
      state: string;
      record: string;
      hash: string;
    }>(
      "SELECT * FROM inventory_quantity_corrections WHERE org_id=? AND id=?",
      orgId,
      correctionId,
    );
    check(row, "NOT_FOUND", "Quantity correction not found.", 404);
    let value: QuantityCorrection;
    try {
      value = JSON.parse(row.record);
    } catch {
      check(
        false,
        "QUANTITY_INTEGRITY",
        "Retained quantity evidence is malformed.",
      );
    }
    check(
      quantityRecordShape(value) &&
        hash(value) === row.hash &&
        value.id === row.id &&
        value.orgId === orgId &&
        value.unitId === row.unit_id &&
        value.reference === row.reference &&
        value.state === row.state &&
        value.reviewHash === hash(value.review) &&
        value.input.reviewHash === value.reviewHash &&
        value.input.unitId === value.unitId &&
        value.input.sourceMovementId === value.review.source.id &&
        value.input.reference === value.reference &&
        value.review.orgId === orgId &&
        value.review.unit.id === value.unitId &&
        value.review.unit.org_id === orgId &&
        value.review.source.org_id === orgId &&
        value.review.source.unit_id === value.unitId &&
        value.review.policy.orgId === orgId &&
        value.review.policy.productId === value.review.unit.product_id,
      "QUANTITY_INTEGRITY",
      "Retained quantity correction binding differs.",
    );
    const source = this.store.get<Movement>(
        "SELECT * FROM inventory_movements WHERE org_id=? AND id=?",
        orgId,
        value.review.source.id,
      ),
      unit = this.store.get<Unit>(
        "SELECT * FROM inventory_units WHERE org_id=? AND id=?",
        orgId,
        value.unitId,
      ),
      policy = this.store.get<{ hash: string; record: string }>(
        "SELECT hash,record FROM inventory_valuation_policies WHERE org_id=? AND product_id=? AND revision=?",
        orgId,
        value.review.unit.product_id,
        value.review.policy.revision,
      );
    const { policyHash, ...policyValue } = value.review.policy;
    check(
      source &&
        canonical(source) === canonical(value.review.source) &&
        unit &&
        unit.cost === value.review.unit.cost &&
        unit.product_id === value.review.unit.product_id &&
        policy &&
        policy.hash === policyHash &&
        policyHash === hash(policyValue) &&
        policy.record === canonical(policyValue),
      "QUANTITY_INTEGRITY",
      "Original movement, acquisition or retained policy differs.",
    );
    check(
      value.state === "ready"
        ? !value.decision && !value.movement && value.valueDelta === null
        : value.decision &&
            value.decision.by !== value.createdBy &&
            (value.state === "rejected"
              ? value.decision.decision === "reject" &&
                !value.movement &&
                value.valueDelta === null
              : value.decision.decision === "approve" &&
                value.movement &&
                Number.isSafeInteger(value.valueDelta)),
      "QUANTITY_INTEGRITY",
      "Independent quantity decision evidence is incomplete.",
    );
    if (value.state === "reviewed") {
      const movement = this.store.get<Movement>(
        "SELECT * FROM inventory_movements WHERE org_id=? AND id=?",
        orgId,
        value.movement!.id,
      );
      check(
        movement &&
          canonical(movement) === canonical(value.movement) &&
          movement.unit_id === value.unitId &&
          movement.type === "quantity.correction" &&
          movement.reference === value.id &&
          movement.quantity ===
            value.input.targetQuantity - value.review.unit.quantity &&
          movement.unit_cost === value.review.unit.cost &&
          movement.actor_id === value.decision!.by &&
          movement.reason === value.input.reason,
        "QUANTITY_INTEGRITY",
        "Compensating movement differs from its independent approval.",
      );
      this.period(value.review, date(value.input.postingDate));
    }
    return value;
  }
  // Caller has refreshed authority inside the enclosing database transaction.
  private authorizedRecord(actor: Actor, correctionId: string) {
    this.database.requireTransaction();
    const value = this.retained(
      actor.orgId,
      text(correctionId, "Correction ID"),
    );
    this.unit(actor, value.unitId);
    return value;
  }
  get(actor: Actor, correctionId: string) {
    return this.database.transaction(() => {
      actor = this.actor(actor);
      const value = this.authorizedRecord(actor, correctionId);
      // A well-shaped record alone cannot prove its carrying effect or ancestry.
      // Read the complete owning evidence in the same snapshot as the response.
      this.reconcile(actor);
      return value;
    });
  }
  history(actor: Actor, unitId: string, afterId?: string) {
    return this.database.transaction(() => {
      actor = this.actor(actor);
      this.unit(actor, unitId);
      if (afterId)
        check(
          this.authorizedRecord(actor, afterId).unitId === unitId,
          "VALIDATION",
          "History cursor belongs to another stock layer.",
          400,
        );
      this.reconcile(actor);
      const rows = this.store.all<{ id: string }>(
        "SELECT id FROM inventory_quantity_corrections WHERE org_id=? AND unit_id=? AND rowid>COALESCE((SELECT rowid FROM inventory_quantity_corrections WHERE org_id=? AND id=?),0) ORDER BY rowid LIMIT 21",
        actor.orgId,
        unitId,
        actor.orgId,
        afterId ?? "",
      );
      return {
        items: rows.slice(0, 20).map((r) => this.authorizedRecord(actor, r.id)),
        next: rows.length > 20 ? rows[19]!.id : null,
      };
    });
  }
  decide(actor: Actor, key: string, input: QuantityCorrectionDecision) {
    return this.platform.command(
      actor,
      "inventory.quantity.decide",
      key,
      input,
      (cached) => {
        actor = this.actor(actor);
        this.platform.assertProviderAccess();
        const value = this.authorizedRecord(actor, input.correctionId);
        if (cached) {
          this.reconcile(actor);
          check(
            canonical(value) === canonical(cached),
            "QUANTITY_INTEGRITY",
            "Cached decision differs from retained evidence.",
          );
        }
      },
      () => {
        const value = this.authorizedRecord(actor, input.correctionId);
        check(
          value.state === "ready",
          "QUANTITY_STATE",
          "This correction already has a decision.",
        );
        check(
          value.createdBy !== actor.id,
          "QUANTITY_SEPARATION",
          "A different current finance principal must approve or reject.",
        );
        check(
          input.reviewHash === value.reviewHash,
          "QUANTITY_STALE",
          "Decision must bind the complete prepared review.",
        );
        check(
          ["approve", "reject"].includes(input.decision),
          "VALIDATION",
          "Choose approve or reject.",
          400,
        );
        this.reconcile(actor);
        if (input.decision === "approve")
          check(
            hash(
              this.snapshot(actor, value.unitId, value.input.sourceMovementId),
            ) === value.reviewHash,
            "QUANTITY_STALE",
            "Stock, reservations or policy changed after preparation.",
          );
        value.decision = {
          by: actor.id,
          at: now(),
          decision: input.decision,
          reason: text(input.reason, "Decision reason", 2000),
        };
        value.state = input.decision === "approve" ? "reviewed" : "rejected";
        if (input.decision === "approve") {
          this.applyCount(
            actor,
            {
              unitId: value.unitId,
              revision: value.review.unit.revision,
              count: value.input.targetQuantity,
              reason: value.input.reason,
            },
            value.id,
          );
          const movements = this.store.all<Movement>(
            "SELECT * FROM inventory_movements WHERE org_id=? AND unit_id=? AND reference=? AND type='quantity.correction'",
            actor.orgId,
            value.unitId,
            value.id,
          );
          check(
            movements.length === 1,
            "QUANTITY_INTEGRITY",
            "Correction must create exactly one native physical movement.",
          );
          value.movement = movements[0]!;
          const after = this.unit(actor, value.unitId),
            position = this.valuations.position(actor.orgId, value.unitId);
          value.valueDelta =
            (position?.value ??
              integer(
                Number(BigInt(after.quantity) * BigInt(after.cost)),
                "Corrected stock value",
                0,
                Number.MAX_SAFE_INTEGER,
              )) - value.review.carryingValue;
        }
        this.store.run(
          "UPDATE inventory_quantity_corrections SET state=?,record=?,hash=? WHERE org_id=? AND id=?",
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
  /** Owning cost export verifies every approved record before choosing a bounded window. */
  evidence(orgId: string) {
    const results = new Map<
      string,
      {
        correctionId: string;
        correctionHash: string;
        accountingDate: string;
        valueDelta: number;
      }
    >();
    for (const row of this.store.all<{ id: string; hash: string }>(
      "SELECT id,hash FROM inventory_quantity_corrections WHERE org_id=? ORDER BY rowid",
      orgId,
    )) {
      const value = this.retained(orgId, row.id);
      if (value.state !== "reviewed") continue;
      check(
        !results.has(value.movement!.id),
        "QUANTITY_INTEGRITY",
        "A physical movement has multiple correction approvals.",
      );
      results.set(value.movement!.id, {
        correctionId: value.id,
        correctionHash: row.hash,
        accountingDate: value.input.postingDate,
        valueDelta: value.valueDelta!,
      });
    }
    return results;
  }
}
