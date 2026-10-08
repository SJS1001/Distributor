import { fixture, accept, ship } from "./fixtures.ts";
import { createHttp } from "./browser-http.ts";
export async function reconciliationBrowser(after: (fn: () => void) => void) {
  const f = fixture({ after });
  const sale = ship(f, accept(f).id);
  // Internally valid money retains the total but disagrees with order snapshots.
  const billing = f.app.database.owned("billing");
  billing.run(
    "UPDATE billing_lines SET unit_price=9000,unit_tax=2300 WHERE invoice_id=?",
    sale.invoiceId,
  );
  billing.run(
    "UPDATE billing_invoices SET net=9000,tax=2300 WHERE id=?",
    sale.invoiceId,
  );
  const outstanding = accept(f, 1, "outstanding"),
    allocation = f.app.fulfillment.picks(f.actor, outstanding.id)[0]!;
  f.app.fulfillment.pick(f.actor, "outstanding-pick", {
    orderId: outstanding.id,
    allocationId: allocation.id,
    serial: allocation.serial,
  });
  f.app.fulfillment.pack(f.actor, "outstanding-pack", {
    orderId: outstanding.id,
    revision: f.app.orders.order(f.actor, outstanding.id).revision,
    mode: "collection",
    address: "PRIVATE-ADDRESS",
    lines: [{ allocationId: allocation.id, quantity: 1 }],
  });
  // Released stock no longer supports either the recorded order or active pack.
  f.app.database
    .owned("inventory")
    .run(
      "UPDATE inventory_allocations SET released=1 WHERE id=?",
      allocation.id,
    );
  // Deliberate retained stock fault; reporting must never repair it.
  const unit = f.app.inventory.trace(f.actor, "S2").unit;
  f.app.database
    .owned("inventory")
    .run("UPDATE inventory_units SET quantity=2 WHERE id=?", unit.id);
  const http = await createHttp(f.app, { origin: "http://127.0.0.1:3132" });
  await http.listen({ host: "127.0.0.1", port: 3132 });
  return http;
}
