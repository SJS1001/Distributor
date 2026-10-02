import type {
  OrderSalesEvidence,
  FulfillmentSalesEvidence,
  InventorySalesEvidence,
} from "./sales-evidence.ts";
import type { IssueCollector } from "./control-issues.ts";

// Owning operations supply one scoped snapshot. These comparisons neither
// correct custody nor decide which conflicting promise is authoritative.
export function reservationControls(
  orders: OrderSalesEvidence,
  shipments: FulfillmentSalesEvidence,
  inventory: InventorySalesEvidence,
  issues: IssueCollector,
) {
  const tuple = (order: string, product: string) =>
      JSON.stringify([order, product]),
    orderMap = new Map(orders.orders.map((o) => [o.id, o])),
    lines = new Map(orders.lines.map((l) => [tuple(l.order, l.product), l])),
    units = new Map(inventory.units.map((u) => [u.id, u])),
    allocations = new Map(inventory.allocations.map((a) => [a.id, a])),
    openByLine = new Map<string, bigint>(),
    openByUnit = new Map<string, bigint>(),
    packedByAllocation = new Map<string, bigint>();
  const add = (map: Map<string, bigint>, id: string, n: bigint) =>
    map.set(id, (map.get(id) ?? 0n) + n);
  const integer = (raw: string, id: string) => {
    const n = BigInt(raw);
    if (
      n > BigInt(Number.MAX_SAFE_INTEGER) ||
      n < -BigInt(Number.MAX_SAFE_INTEGER)
    )
      issues.add("UNSAFE_RESERVATION_INTEGER", id);
    return n;
  };
  for (const a of inventory.allocations) {
    const quantity = integer(a.quantity, a.id),
      consumed = integer(a.consumed, a.id),
      released = integer(a.released, a.id),
      open = quantity - consumed - released,
      order = orderMap.get(a.order),
      unit = units.get(a.unit);
    if (quantity <= 0n || consumed < 0n || released < 0n || open < 0n)
      issues.add("SALE_RESERVATION_RANGE", a.id);
    if (!order) issues.add("SALE_RESERVATION_ORDER", a.id);
    else if (a.warehouse !== order.warehouse)
      issues.add(
        "SALE_RESERVATION_WAREHOUSE",
        a.id,
        order.warehouse,
        a.warehouse,
      );
    if (!lines.has(tuple(a.order, a.product)))
      issues.add("SALE_RESERVATION_LINE", a.id);
    if (a.product !== a.unitProduct)
      issues.add("SALE_RESERVATION_PRODUCT", a.id, a.product, a.unitProduct);
    if (!["reserved", "picked"].includes(a.stage))
      issues.add("SALE_RESERVATION_STAGE", a.id);
    add(openByLine, tuple(a.order, a.product), open);
    if (open > 0n) {
      add(openByUnit, a.unit, open);
      if (!unit) issues.add("SALE_RESERVATION_UNIT", a.id);
      else {
        if (unit.warehouse !== a.warehouse)
          issues.add(
            "SALE_RESERVATION_UNIT_WAREHOUSE",
            a.id,
            a.warehouse,
            unit.warehouse,
          );
        if (unit.state !== "stock" || unit.condition !== "usable")
          issues.add("SALE_RESERVATION_UNAVAILABLE", a.id);
      }
    }
  }
  for (const line of orders.lines) {
    const quantity = integer(line.quantity, line.id),
      shipped = integer(line.shipped, line.id),
      canceled = integer(line.canceled, line.id),
      allocated = integer(line.allocated, line.id);
    if (
      quantity <= 0n ||
      shipped < 0n ||
      canceled < 0n ||
      allocated < 0n ||
      shipped + canceled + allocated > quantity
    )
      issues.add("SALE_ORDER_QUANTITY_RANGE", line.id);
    issues.compare(
      "SALE_ORDER_RESERVED",
      line.id,
      openByLine.get(tuple(line.order, line.product)) ?? 0n,
      allocated,
    );
  }
  for (const hold of inventory.replacementHolds) {
    add(openByUnit, hold.unit, 1n);
    const unit = units.get(hold.unit);
    if (!unit) issues.add("SALE_REPLACEMENT_UNIT", hold.id);
    else if (
      !unit.hasSerial ||
      unit.state !== "stock" ||
      unit.condition !== "usable" ||
      integer(unit.quantity, unit.id) !== 1n
    )
      issues.add("SALE_REPLACEMENT_UNAVAILABLE", hold.id);
  }
  for (const [unitId, promised] of openByUnit) {
    const unit = units.get(unitId);
    if (unit) {
      const quantity = integer(unit.quantity, unit.id);
      if (promised > quantity)
        issues.add("SALE_UNIT_OVERRESERVED", unitId, quantity, promised);
    }
  }
  for (const shipment of shipments) {
    if (shipment.state !== "packed") continue;
    // The general sales checks already report malformed retained JSON. Never
    // expose its contents, and never count void/shipped historical packing.
    let raw: unknown;
    try {
      raw = JSON.parse(shipment.lines);
    } catch {
      continue;
    }
    if (
      !Array.isArray(raw) ||
      !raw.every(
        (l) =>
          l &&
          typeof l === "object" &&
          typeof l.allocationId === "string" &&
          l.allocationId.length > 0 &&
          Number.isSafeInteger(l.quantity) &&
          l.quantity > 0,
      )
    )
      continue;
    const seen = new Set<string>();
    for (const line of raw as { allocationId: string; quantity: number }[]) {
      if (seen.has(line.allocationId))
        issues.add("SALE_PACK_DUPLICATE_ALLOCATION", shipment.id);
      seen.add(line.allocationId);
      add(packedByAllocation, line.allocationId, BigInt(line.quantity));
      const a = allocations.get(line.allocationId);
      if (!a) issues.add("SALE_PACK_ALLOCATION", shipment.id);
      else {
        if (a.order !== shipment.order || a.warehouse !== shipment.warehouse)
          issues.add("SALE_PACK_ALLOCATION_SCOPE", shipment.id);
        if (a.stage !== "picked")
          issues.add("SALE_PACK_NOT_PICKED", shipment.id);
      }
    }
  }
  for (const [allocationId, packed] of packedByAllocation) {
    const a = allocations.get(allocationId);
    if (a) {
      const open = BigInt(a.quantity) - BigInt(a.consumed) - BigInt(a.released);
      if (packed > open)
        issues.add("SALE_PACK_OVERCOMMITTED", a.id, open, packed);
    }
  }
}
