import { accept, ship, type fixture } from "./fixtures.ts";
// Deterministic synthetic stock rows for pagination, not inventory acceptance.
export function seedStockQueue(
  f: ReturnType<typeof fixture>,
  count = 45,
  warehouseId = f.w1,
  prefix = "000-stock",
) {
  const store = f.app.database.owned("inventory"),
    ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = `${prefix}-${String(i).padStart(3, "0")}`;
    ids.push(id);
    store.run(
      "INSERT INTO inventory_units VALUES(?,?,?,?,?,?,1,6000,?,'stock',1)",
      id,
      f.actor.orgId,
      f.product,
      warehouseId,
      `B-${i}`,
      `QUEUE-${prefix}-${String(i).padStart(3, "0")}`,
      i % 3 === 1 ? "quarantine" : i % 3 === 2 ? "damaged" : "usable",
    );
  }
  return ids;
}
export function inspectedClaim(f: ReturnType<typeof fixture>) {
  ship(f, accept(f).id);
  const sold = f.app.warranty.soldUnits(f.actor)[0]!;
  const claim = f.app.warranty.submit(f.actor, "queue-claim", {
    unitId: sold.id,
    accountId: f.buyer,
    type: "warranty",
    issue: "Synthetic failure",
    evidence: "Synthetic serial evidence",
  });
  f.app.warranty.review(f.actor, "queue-authorize", {
    claimId: claim.id,
    approved: true,
    reason: "Synthetic approved review",
  });
  f.app.warranty.receive(f.actor, "queue-return", {
    claimId: claim.id,
    serial: sold.serial,
    warehouseId: f.w1,
    bin: "RETURN",
  });
  f.app.warranty.inspect(f.actor, "queue-inspect", {
    claimId: claim.id,
    findings: "Synthetic replacement inspection",
  });
  return { claimId: claim.id, unitId: sold.id };
}
