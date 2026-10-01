import { fixture, accept, chooseProviders } from "./fixtures.ts";
import type { CarrierPrepare } from "../src/shared/carrier-booking.ts";
import {
  UpsSandbox,
  type UpsSandboxConfig,
} from "../src/server/ups-sandbox.ts";
import {
  FedexSandbox,
  type FedexSandboxConfig,
} from "../src/server/fedex-sandbox.ts";
import {
  UspsSandbox,
  type UspsSandboxConfig,
} from "../src/server/usps-sandbox.ts";

export function configurationFixture(t: Parameters<typeof fixture>[0]) {
  const f = fixture(t, {}, "US"),
    orderId = accept(f).id;
  chooseProviders(f, f.actor, "configuration-choice", {
    accountId: f.buyer,
    region: "US",
    mode: "provider-exceptions",
    providers: ["ups", "fedex", "usps"],
    version: 1,
    acknowledgment: "Synthetic named provider review",
  });
  const picks = f.app.fulfillment.picks(f.actor, orderId);
  for (const pick of picks)
    f.app.fulfillment.pick(f.actor, `configuration-pick-${pick.id}`, {
      orderId,
      allocationId: pick.id,
      serial: pick.serial,
    });
  const address =
    "Synthetic configuration destination, 20 Test Road, Buffalo NY 14201, US";
  const shipmentId = f.app.fulfillment.pack(f.actor, "configuration-pack", {
    orderId,
    revision: f.app.orders.order(f.actor, orderId).revision,
    mode: "carrier",
    address,
    lines: picks.map((p) => ({ allocationId: p.id, quantity: p.quantity })),
  }).id;
  const origin = {
    name: "Synthetic origin",
    line1: "10 Test Road",
    line2: "",
    city: "Buffalo",
    province: "NY",
    postalCode: "14201",
    country: "US" as const,
    phone: "7165550100",
  };
  const input: CarrierPrepare = {
    shipmentId,
    previousId: null,
    provider: "usps",
    service: "Reviewed ground",
    origin,
    destination: {
      ...origin,
      name: "Synthetic recipient",
      line1: "20 Test Road",
    },
    parcel: { weightGrams: 1000, lengthMm: 300, widthMm: 200, heightMm: 100 },
    reviewedDestination: address,
    acknowledgment: "Synthetic actual origin, destination and settings review",
  };
  const ups: UpsSandboxConfig = {
    orgId: f.actor.orgId,
    clientId: "synthetic-ups-client",
    clientSecret: "synthetic-ups-secret",
    shipperNumber: "A1B2C3",
    shipper: origin,
    services: [{ service: input.service, code: "03" }],
  };
  const fedex: FedexSandboxConfig = {
    orgId: f.actor.orgId,
    clientId: "synthetic-fedex-client",
    clientSecret: "synthetic-fedex-secret",
    accountNumber: "123456789",
    country: "US",
    pickupType: "DROPOFF_AT_FEDEX_LOCATION",
    services: [
      { service: input.service, code: "FEDEX_GROUND", residential: false },
    ],
  };
  const usps: UspsSandboxConfig = {
    orgId: f.actor.orgId,
    clientId: "synthetic-usps-client",
    clientSecret: "synthetic-usps-secret",
    crid: "12345678",
    mid: "123456",
    manifestMid: "654321",
    epsAccount: "12345678",
    mailingDate: "2026-10-01",
    services: [
      {
        service: input.service,
        code: "USPS_GROUND_ADVANTAGE",
        processingCategory: "NONSTANDARD",
      },
    ],
  };
  return Object.assign(f, { input, orderId, shipmentId, ups, fedex, usps });
}
export const clients = {
  ups: UpsSandbox,
  fedex: FedexSandbox,
  usps: UspsSandbox,
};
export function nativeConfiguration(
  f: ReturnType<typeof configurationFixture>,
) {
  return {
    stock: f.app.inventory.stock(f.actor),
    order: f.app.orders.order(f.actor, f.orderId),
    invoices: f.app.billing.invoices(f.actor),
    shipment: f.app.fulfillment.shipment(f.actor, f.shipmentId),
  };
}
