import { fixture, ship } from "./fixtures.ts";
export function seedClaimQueue(
  f: ReturnType<typeof fixture>,
  count = 45,
  tag = "queue",
  warehouseId = f.w1,
  accountId = f.buyer,
) {
  const po = f.app.procurement.create(f.actor, `${tag}-po`, {
    supplierId: f.supplier,
    warehouseId,
    lines: [{ productId: f.product, quantity: count, unitCost: 6000 }],
  });
  const line = f.app.procurement.orders(f.actor).find((p) => p.id === po.id)!
    .lines[0]!;
  f.app.procurement.receive(f.actor, `${tag}-receipt`, {
    poId: po.id,
    lineId: String(line.id),
    deliveryRef: `${tag}-delivery`,
    quantity: count,
    serials: Array.from({ length: count }, (_, i) => `${tag}-${i}`),
    bin: "QUEUE",
    quarantine: false,
  });
  const scoped = { ...f, w1: warehouseId, buyer: accountId };
  const cart = f.app.orders.saveCart(f.actor, `${tag}-cart`, {
    accountId,
    warehouseId,
    revision: Number(
      f.app.orders
        .carts(f.actor)
        .find(
          (c) => c.account_id === accountId && c.warehouse_id === warehouseId,
        )?.revision ?? 0,
    ),
    lines: [{ productId: f.product, quantity: count }],
  });
  const quote = f.app.orders.quote(f.actor, `${tag}-quote`, {
    cartId: cart.id,
    revision: cart.revision,
  });
  const order = f.app.orders.accept(f.actor, `${tag}-order`, {
    quoteId: quote.id,
    allowBackorder: false,
  });
  const units = f.app.fulfillment.picks(f.actor, order.id);
  ship(scoped, order.id);
  return units.map((unit, i) => {
    const claim = f.app.warranty.submit(f.actor, `${tag}-claim-${i}`, {
      accountId,
      unitId: unit.unit_id,
      type: "warranty",
      issue: `${tag} issue ${String(i).padStart(2, "0")}`,
      evidence: "Synthetic evidence",
    });
    if (i % 3 === 0)
      f.app.warranty.review(f.actor, `${tag}-deny-${i}`, {
        claimId: claim.id,
        approved: false,
        reason: "Synthetic review",
      });
    return claim;
  });
}
