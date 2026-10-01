import { test } from "node:test";
import assert from "node:assert/strict";
import { Application } from "../src/server/application.ts";
import { fixture, accept } from "./fixtures.ts";

test("explicit expiry stays blocked across clock rollback and restart until reviewed renewal", (t) => {
  let clock = 1900000000000;
  t.mock.method(Date, "now", () => clock);
  const f = fixture(t),
    orderId = accept(f, 2).id;
  const picks = f.app.fulfillment.picks(f.actor, orderId);
  const retained = picks[0]!;
  f.app.fulfillment.pick(f.actor, "pick", {
    orderId,
    allocationId: retained.id,
    serial: retained.serial,
  });
  const review = () => ({
    orderId,
    revision: f.app.orders.order(f.actor, orderId).revision,
    reason: "Synthetic reviewed expiry",
  });
  f.app.orders.reservationDeadline(f.actor, "deadline", {
    ...review(),
    expiresAt: clock + 100,
  });
  clock += 100;
  f.app.orders.expireReservations(f.actor, "expire", review());
  clock -= 50;
  f.app.close();
  f.app = new Application(f.path);
  assert.equal(f.app.orders.reservations(f.actor, orderId).overdue, true);
  assert.equal(
    f.app.orders.list(f.actor).find((o) => o.id === orderId)!.reservation
      .overdue,
    true,
  );
  f.app.fulfillment.pick(f.actor, "unpick", {
    orderId,
    allocationId: retained.id,
    serial: retained.serial,
    unpick: true,
  });
  const before = f.app.orders.lines(f.actor, orderId);
  const exposure = f.app.billing.exposure(f.actor, f.buyer);
  assert.throws(
    () =>
      f.app.orders.allocate(f.actor, "blocked-allocation", {
        orderId,
        revision: review().revision,
      }),
    { code: "RESERVATION_EXPIRED" },
  );
  assert.throws(
    () =>
      f.app.orders.amend(f.actor, "blocked-amendment", {
        ...review(),
        lineId: before[0]!.id,
        quantity: 3,
        allowBackorder: false,
      }),
    { code: "RESERVATION_EXPIRED" },
  );
  assert.throws(
    () =>
      f.app.fulfillment.pick(f.actor, "blocked-pick", {
        orderId,
        allocationId: retained.id,
        serial: retained.serial,
      }),
    { code: "RESERVATION_EXPIRED" },
  );
  assert.deepEqual(f.app.orders.lines(f.actor, orderId), before);
  assert.deepEqual(f.app.billing.exposure(f.actor, f.buyer), exposure);
  // Another explicit release is still due despite the reversed wall clock.
  f.app.orders.expireReservations(f.actor, "expire-unpicked", review());
  f.app.orders.reservationDeadline(f.actor, "renew", {
    ...review(),
    expiresAt: clock + 1000,
  });
  assert.equal(f.app.orders.reservations(f.actor, orderId).overdue, false);
  f.app.orders.allocate(f.actor, "renewed-allocation", {
    orderId,
    revision: review().revision,
  });
  assert.equal(f.app.orders.lines(f.actor, orderId)[0]!.allocated, 2);
  const live = f.app.fulfillment
    .picks(f.actor, orderId)
    .find((a) => a.quantity > a.released + a.consumed)!;
  f.app.fulfillment.pick(f.actor, "renewed-pick", {
    orderId,
    allocationId: live.id,
    serial: live.serial,
  });
  assert.deepEqual(f.app.billing.exposure(f.actor, f.buyer), exposure);
});
