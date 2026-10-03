import type { fixture } from "./fixtures.ts";

export function countQueueFixture(
  f: ReturnType<typeof fixture>,
  count = 45,
  hidden = 0,
) {
  const id = f.app.identity.createUser(f.actor, "count-queue-operator", {
    email: "count-queue@example.test",
    name: "Synthetic count operator",
    password: "long-test-only-password",
    role: "warehouse",
    sites: [f.w1],
  }).id;
  const operator = f.app.identity.currentActor({ ...f.actor, id });
  const productId = f.app.catalog.create(f.actor, "count-queue-product", {
    sku: "COUNT-QUEUE",
    name: "Synthetic count queue supplies",
    serialized: false,
    unitPrice: 2500,
    taxBasisPoints: 1300,
  }).id;
  const receive = (warehouseId: string) => {
    const poId = f.app.procurement.create(
      f.actor,
      `count-queue-po-${warehouseId}`,
      {
        supplierId: f.supplier,
        warehouseId,
        lines: [{ productId, quantity: 6, unitCost: 1000 }],
      },
    ).id;
    const lineId = String(
      f.app.procurement.orders(f.actor).find((p) => p.id === poId)!.lines[0]!
        .id,
    );
    f.app.procurement.receive(f.actor, `count-queue-stock-${warehouseId}`, {
      poId,
      lineId,
      quantity: 6,
      serials: [],
      deliveryRef: `SYNTHETIC-COUNT-${warehouseId}`,
      bin: "COUNT-A",
      quarantine: false,
    });
    return f.app.inventory
      .stock(f.actor)
      .find(
        (u) => u.product_id === productId && u.warehouse_id === warehouseId,
      )!;
  };
  const unit = receive(f.w1);
  const rows = Array.from({ length: count }, (_, i) => {
    const row = f.app.inventory.startCount(operator, `queue-start-${i}`, {
      unitId: unit.id,
      revision: f.app.inventory.unit(f.actor, unit.id).revision,
      countRef: `SYNTHETIC-COUNT-${String(i).padStart(2, "0")}`,
    });
    if (i < 2)
      f.app.inventory.submitCount(operator, `queue-observe-${i}`, {
        countId: row.id,
        quantity: i === 0 ? 6 : 8,
        reason: "Synthetic physical observation",
      });
    if (i === 0 || i === 2)
      f.app.inventory.decideCount(f.actor, `queue-decide-${i}`, {
        countId: row.id,
        decision: i === 0 ? "approve" : "reject",
        reason: "Synthetic supervisor evidence",
      });
    return row;
  });
  if (hidden) {
    const remote = receive(f.w2);
    for (let i = 0; i < hidden; i++)
      f.app.inventory.startCount(f.actor, `queue-hidden-${i}`, {
        unitId: remote.id,
        revision: remote.revision,
        countRef: `SYNTHETIC-HIDDEN-COUNT-${i}`,
      });
  }
  // Fixture-only frozen metadata tests insertion ties independently of timing.
  f.app.database
    .owned("inventory")
    .run(
      "UPDATE inventory_counts SET created_at=? WHERE org_id=?",
      "2026-10-02T12:00:00.000Z",
      f.actor.orgId,
    );
  return { rows, unit, operator };
}
