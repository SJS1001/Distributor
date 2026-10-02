import { fixture } from "./fixtures.ts";

export function seedSupplierReturns(
  f: ReturnType<typeof fixture>,
  count = 45,
  prefix = "QUEUE",
  warehouseId = f.w1,
) {
  const productId = f.app.catalog.create(f.actor, `product-${prefix}`, {
    sku: prefix,
    name: "Synthetic return queue lot",
    serialized: false,
    unitPrice: 500,
    taxBasisPoints: 0,
  }).id;
  const poId = f.app.procurement.create(f.actor, `po-${prefix}`, {
    supplierId: f.supplier,
    warehouseId,
    lines: [{ productId, quantity: count, unitCost: 250 }],
  }).id;
  const line = f.app.procurement.order(f.actor, poId).lines[0]!;
  const receipt = f.app.procurement.receive(f.actor, `receive-${prefix}`, {
    poId,
    lineId: String(line.id),
    deliveryRef: prefix,
    quantity: count,
    serials: [],
    bin: "QUEUE",
    quarantine: false,
  });
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const unit = f.app.inventory
      .stock(f.actor)
      .find((u) => u.id === receipt.unitIds[0])!;
    const returned = f.app.procurement.returnStock(
      f.actor,
      `return-${prefix}-${i}`,
      {
        receiptId: receipt.id,
        unitId: unit.id,
        revision: unit.revision,
        quantity: 1,
        serial: null,
        returnRef: `${prefix}-${String(i).padStart(3, "0")}`,
        reason: i === 0 ? "Literal defect %_ evidence" : "Synthetic defect",
        handoverEvidence: "Synthetic supplier handover",
      },
    );
    ids.push(returned.id);
    f.app.database
      .owned("procurement")
      .run(
        "UPDATE procurement_returns SET created_at=? WHERE id=?",
        new Date(Date.UTC(2026, 9, 1, 0, 0, i)).toISOString(),
        returned.id,
      );
  }
  return ids;
}
