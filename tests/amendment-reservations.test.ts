import { test } from "node:test";
import assert from "node:assert/strict";
import { accept, fixture } from "./fixtures.ts";

for (const action of ["amend", "cancel"] as const)
  for (const position of ["first", "last"] as const)
    test(`${action}: preserve ${position} picked/packed unit and release unpicked reservations`, (t) => {
      const f = fixture(t),
        order = accept(f, 3);
      const picks = f.app.fulfillment.picks(f.actor, order.id);
      const first = position === "first" ? picks[0]! : picks.at(-1)!;
      f.app.fulfillment.pick(f.actor, "picked-first", {
        orderId: order.id,
        allocationId: first.id,
        serial: first.serial,
      });
      const packing = f.app.fulfillment.pack(f.actor, "packed-first", {
        orderId: order.id,
        revision: f.app.orders.order(f.actor, order.id).revision,
        mode: "collection",
        address: "Synthetic counter",
        lines: [{ allocationId: first.id, quantity: 1 }],
      });
      const line = f.app.orders.lines(f.actor, order.id)[0]!;
      const base = {
        orderId: order.id,
        lineId: line.id,
        revision: f.app.orders.order(f.actor, order.id).revision,
        reason: "Synthetic buyer reduces only unpicked units",
      };
      if (action === "amend")
        f.app.orders.amend(f.actor, "reduce-unpicked", {
          ...base,
          quantity: 1,
          allowBackorder: false,
        });
      else
        f.app.orders.cancel(f.actor, "reduce-unpicked", {
          ...base,
          quantity: 2,
        });
      const retained = f.app.orders.lines(f.actor, order.id)[0]!;
      assert.equal(retained.allocated, 1);
      assert.equal(retained.shipped, 0);
      assert.equal(retained.canceled, action === "cancel" ? 2 : 0);
      const remaining = f.app.fulfillment.picks(f.actor, order.id);
      assert.equal(remaining.find((a) => a.id === first.id)!.packed, 1);
      assert.equal(
        remaining
          .filter((a) => a.id !== first.id)
          .reduce((n, a) => n + a.quantity - a.consumed - a.released, 0),
        0,
      );
      assert.equal(f.app.billing.exposure(f.actor, f.buyer).total, 11300);
      assert.equal(
        f.app.inventory.stock(f.actor).reduce((n, u) => n + u.available, 0),
        2,
      );
      const shipped = f.app.fulfillment.commit(f.actor, "handover-retained", {
        shipmentId: packing.id,
        handoverEvidence: "Synthetic retained packed unit handed over",
      });
      assert.equal(
        f.app.billing.invoice(f.actor, shipped.invoiceId).total,
        11300,
      );
      assert.equal(f.app.orders.order(f.actor, order.id).state, "closed");
      assert.equal(
        f.app.inventory.trace(f.actor, first.serial!).unit.state,
        "sold",
      );
    });

test("picked shortage rejects before releasing any eligible stock", (t) => {
  const f = fixture(t),
    order = accept(f, 3),
    picks = f.app.fulfillment.picks(f.actor, order.id);
  // Keep one earlier allocation unpicked, so a failure must not leak its release.
  for (const a of picks.slice(1))
    f.app.fulfillment.pick(f.actor, `pick-${a.id}`, {
      orderId: order.id,
      allocationId: a.id,
      serial: a.serial,
    });
  const line = f.app.orders.lines(f.actor, order.id)[0]!;
  assert.throws(
    () =>
      f.app.orders.amend(f.actor, "too-far", {
        orderId: order.id,
        lineId: line.id,
        revision: f.app.orders.order(f.actor, order.id).revision,
        quantity: 1,
        allowBackorder: false,
        reason: "Synthetic reduction would consume a picked unit",
      }),
    { code: "PICKED" },
  );
  assert.equal(
    f.app.fulfillment
      .picks(f.actor, order.id)
      .reduce((n, a) => n + a.released, 0),
    0,
  );
  assert.equal(f.app.orders.lines(f.actor, order.id)[0]!.quantity, 3);
  assert.equal(f.app.billing.exposure(f.actor, f.buyer).total, 33900);
  assert.equal(f.app.orders.amendments(f.actor, order.id).items.length, 0);
});
