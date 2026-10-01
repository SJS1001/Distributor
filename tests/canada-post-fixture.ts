import { DatabaseSync } from "node:sqlite";
import { fixture, accept, chooseProviders } from "./fixtures.ts";
import type {
  CarrierAddress,
  CarrierPrepare,
} from "../src/shared/carrier-booking.ts";
import type { CanadaPostGroupPrepare } from "../src/server/carrier-bookings.ts";
export const configurationHash = "a".repeat(64);
export const origin: CarrierAddress = {
  name: "Synthetic warehouse",
  line1: "1 Test Street",
  line2: "",
  city: "Toronto",
  province: "ON",
  postalCode: "M5V 1A1",
  country: "CA",
  phone: "4165550100",
};
export function setup(
  t: Parameters<typeof fixture>[0],
  count = 1,
  overrides: Partial<CarrierPrepare>[] = [],
) {
  const f = fixture(t);
  chooseProviders(f, f.actor, "canada-post-choice", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["canada-post", "ups"],
    version: 1,
    acknowledgment: "Synthetic explicit Canada Post processing choice",
  });
  if (count > 3) {
    const po = f.app.procurement.create(f.actor, "cp-extra-stock", {
      supplierId: f.supplier,
      warehouseId: f.w1,
      lines: [{ productId: f.product, quantity: count - 3, unitCost: 6000 }],
    }).id;
    const line = f.app.procurement.orders(f.actor).find((p) => p.id === po)!
      .lines[0]!;
    f.app.procurement.receive(f.actor, "cp-extra-receipt", {
      poId: po,
      lineId: String(line.id),
      deliveryRef: "CP-EXTRA",
      quantity: count - 3,
      serials: Array.from({ length: count - 3 }, (_, i) => `CP-EXTRA-${i}`),
      bin: "A-1",
      quarantine: false,
    });
  }
  const shipments: string[] = [],
    entries = [];
  for (let i = 0; i < count; i++) {
    const orderId = accept(f, 1, `order-${i}`).id;
    const picks = f.app.fulfillment.picks(f.actor, orderId);
    for (const item of picks)
      f.app.fulfillment.pick(f.actor, `pick-${item.id}`, {
        orderId,
        allocationId: item.id,
        serial: item.serial,
      });
    const address = "Synthetic receiver, 2 Test Street, Ottawa ON K1A 0B1, CA";
    const shipmentId = f.app.fulfillment.pack(f.actor, `pack-${i}`, {
      orderId,
      revision: f.app.orders.order(f.actor, orderId).revision,
      mode: "carrier",
      address,
      lines: picks.map((item) => ({
        allocationId: item.id,
        quantity: item.quantity,
      })),
    }).id;
    const booking = f.app.carriers.prepare(f.actor, `prepare-${i}`, {
      shipmentId,
      previousId: null,
      provider: "canada-post",
      service: "Synthetic domestic",
      origin,
      destination: {
        ...origin,
        name: "Synthetic receiver",
        line1: "2 Test Street",
        city: "Ottawa",
        postalCode: "K1A 0B1",
      },
      parcel: { weightGrams: 1000, lengthMm: 100, widthMm: 100, heightMm: 100 },
      reviewedDestination: address,
      acknowledgment: "Synthetic reviewed shipment and parcel",
      ...overrides[i],
    });
    entries.push({ bookingId: booking.id, reviewHash: booking.reviewHash });
    shipments.push(shipmentId);
  }
  const input: CanadaPostGroupPrepare = { configurationHash, entries };
  return Object.assign(f, { input, shipments });
}
export type F = ReturnType<typeof setup>;
export function native(f: F) {
  return {
    stock: f.app.inventory.stock(f.actor),
    invoices: f.app.billing.invoices(f.actor),
    orders: f.app.orders.list(f.actor),
    shipments: f.shipments.map((id) => f.app.fulfillment.shipment(f.actor, id)),
  };
}
export function raw(f: F, sql: string, ...args: (string | number)[]) {
  const db = new DatabaseSync(f.path);
  try {
    return db.prepare(sql).run(...args);
  } finally {
    db.close();
  }
}

export function allRows(f: F) {
  const db = new DatabaseSync(f.path, { readOnly: true });
  try {
    return Object.fromEntries(
      db
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name",
        )
        .all()
        .map(({ name }) => [
          String(name),
          db
            .prepare(
              `SELECT * FROM "${String(name).replaceAll('"', '""')}" ORDER BY rowid`,
            )
            .all(),
        ]),
    );
  } finally {
    db.close();
  }
}
