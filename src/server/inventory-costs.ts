import { check, integer, permit, type Actor } from "./core.ts";
import type { Store } from "./database.ts";

export type CostMovement = {
  sequence: number;
  id: string;
  unitId: string;
  productId: string;
  warehouseId: string;
  serial: string | null;
  type: string;
  quantity: number;
  unitCost: number;
  valueDelta: number;
  reference: string;
  reason: string;
  createdAt: string;
};
export const movementSigns: Record<
  string,
  "positive" | "negative" | "zero" | "either" | "transfer"
> = {
  receipt: "positive",
  opening: "positive",
  shipment: "negative",
  "supplier.return": "negative",
  count: "either",
  inspection: "zero",
  relocation: "zero",
  "shortpick.hold": "zero",
  "serial.loss": "negative",
  "serial.recovery": "positive",
  "transfer.dispatch": "transfer",
  "transfer.receive": "transfer",
  "transfer.loss": "negative",
  "transfer.recover": "positive",
  return: "positive",
  scrap: "negative",
  restock: "zero",
  repair: "zero",
  "replacement.reserve": "zero",
  "replacement.cancel": "zero",
  "replacement.handover": "negative",
};
export type CostWindow = {
  afterSequence: number;
  throughSequence: number;
  movements: CostMovement[];
  openingValue: number;
  closingValue: number;
  increase: number;
  decrease: number;
  byType: { type: string; count: number; increase: number; decrease: number }[];
};

const exact = (n: bigint) => {
  check(
    n >= BigInt(-Number.MAX_SAFE_INTEGER) &&
      n <= BigInt(Number.MAX_SAFE_INTEGER),
    "COST_RANGE",
    "Stock cost exceeds the exact supported integer range.",
  );
  return Number(n);
};

// Inventory owns the interpretation of its custody movements. Transfers move
// value between sites and transit; they do not change organization-wide value.
export class InventoryCosts {
  constructor(private store: Store) {}
  window(
    actor: Actor,
    afterSequence: number,
    throughSequence?: number,
  ): CostWindow & { more: boolean } {
    permit(actor, ["finance"]);
    integer(afterSequence, "Cost cursor", 0, Number.MAX_SAFE_INTEGER);
    if (throughSequence !== undefined)
      integer(
        throughSequence,
        "Cost cutoff",
        afterSequence + 1,
        Number.MAX_SAFE_INTEGER,
      );
    check(
      !this.store.get(
        `SELECT m.id FROM inventory_movements m
      LEFT JOIN inventory_cost_sequences s ON s.org_id=m.org_id AND s.movement_id=m.id
      WHERE m.org_id=? AND s.sequence IS NULL LIMIT 1`,
        actor.orgId,
      ),
      "COST_EVIDENCE",
      "Stock movement sequencing is incomplete; reconcile before export.",
    );
    const selected = this.store.all<{ sequence: number }>(
      `SELECT sequence FROM inventory_cost_sequences
       WHERE org_id=? AND sequence>? AND (? IS NULL OR sequence<=?)
       ORDER BY sequence LIMIT 501`,
      actor.orgId,
      afterSequence,
      throughSequence ?? null,
      throughSequence ?? null,
    );
    check(
      throughSequence === undefined ||
        this.store.get(
          "SELECT sequence FROM inventory_cost_sequences WHERE org_id=? AND sequence=?",
          actor.orgId,
          throughSequence,
        ),
      "COST_CUTOFF",
      "Cost cutoff must identify a movement belonging to this organization.",
    );
    check(
      throughSequence === undefined || selected.length <= 500,
      "COST_BATCH_SIZE",
      "A cost packet supports at most 500 movements.",
    );
    const end =
      throughSequence ??
      selected.slice(0, 500).at(-1)?.sequence ??
      afterSequence;
    let more = false;
    let history = 0n,
      opening = 0n,
      closing = 0n,
      increase = 0n,
      decrease = 0n;
    const movements: CostMovement[] = [],
      byType = new Map<string, CostWindow["byType"][number]>();
    this.store.visit<Omit<CostMovement, "valueDelta">>(
      `SELECT s.sequence,m.id,m.unit_id AS unitId,u.product_id AS productId,
       m.warehouse_id AS warehouseId,u.serial,m.type,m.quantity,m.unit_cost AS unitCost,
       m.reference,m.reason,m.created_at AS createdAt
       FROM inventory_cost_sequences s LEFT JOIN inventory_movements m ON m.org_id=s.org_id AND m.id=s.movement_id
       LEFT JOIN inventory_units u ON u.org_id=m.org_id AND u.id=m.unit_id
       WHERE s.org_id=? ORDER BY s.sequence`,
      [actor.orgId],
      (r) => {
        const sign = Object.hasOwn(movementSigns, r.type)
          ? movementSigns[r.type]
          : undefined;
        check(
          sign &&
            r.id &&
            r.productId &&
            Number.isSafeInteger(r.quantity) &&
            Number.isSafeInteger(r.unitCost) &&
            r.unitCost >= 0,
          "COST_EVIDENCE",
          "Stock movement type, quantity or original cost is unsupported.",
        );
        check(
          sign === "either" ||
            sign === "transfer" ||
            (sign === "zero"
              ? r.quantity === 0
              : sign === "positive"
                ? r.quantity > 0
                : r.quantity < 0),
          "COST_EVIDENCE",
          "Stock movement direction conflicts with its custody operation.",
        );
        check(
          (r.type !== "transfer.dispatch" || r.quantity < 0) &&
            (r.type !== "transfer.receive" || r.quantity > 0) &&
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(r.createdAt) &&
            Number.isFinite(Date.parse(r.createdAt)) &&
            new Date(r.createdAt).toISOString() === r.createdAt,
          "COST_EVIDENCE",
          "Stock movement direction or timestamp is invalid.",
        );
        const delta =
          sign === "transfer" ? 0n : BigInt(r.quantity) * BigInt(r.unitCost);
        history += delta;
        if (r.sequence <= afterSequence) opening += delta;
        if (r.sequence <= end) closing += delta;
        if (r.sequence > end) more = true;
        if (r.sequence <= afterSequence || r.sequence > end) return;
        const valueDelta = exact(delta),
          summary = byType.get(r.type) ?? {
            type: r.type,
            count: 0,
            increase: 0,
            decrease: 0,
          };
        movements.push({ ...r, valueDelta });
        summary.count++;
        if (delta > 0) {
          increase += delta;
          summary.increase = exact(BigInt(summary.increase) + delta);
        }
        if (delta < 0) {
          decrease -= delta;
          summary.decrease = exact(BigInt(summary.decrease) - delta);
        }
        byType.set(r.type, summary);
      },
    );
    let physical = 0n;
    this.store.visit<{
      quantity: number;
      cost: number;
      state: string;
    }>(
      "SELECT quantity,cost,state FROM inventory_units WHERE org_id=?",
      [actor.orgId],
      (u) => {
        check(
          Number.isSafeInteger(u.quantity) &&
            u.quantity >= 0 &&
            Number.isSafeInteger(u.cost) &&
            u.cost >= 0,
          "COST_EVIDENCE",
          "Physical stock cost is invalid.",
        );
        check(
          ["stock", "transit"].includes(u.state) || u.quantity === 0,
          "COST_RECONCILIATION",
          "Nonphysical custody still carries stock value.",
        );
        physical += BigInt(u.quantity) * BigInt(u.cost);
      },
    );
    check(
      history === physical && opening >= 0n && closing >= 0n,
      "COST_RECONCILIATION",
      "Stock movements do not reconcile with held and in-transit original cost. Investigate before preparing a handoff.",
    );
    return {
      afterSequence,
      throughSequence: end,
      movements,
      openingValue: exact(opening),
      closingValue: exact(closing),
      increase: exact(increase),
      decrease: exact(decrease),
      byType: [...byType.values()].sort((a, b) => a.type.localeCompare(b.type)),
      more,
    };
  }
}
