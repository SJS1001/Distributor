import { fixture, accept, ship, chooseProviders } from "./fixtures.ts";
import type { CarrierPrepare } from "../src/shared/carrier-booking.ts";
import type {
  CarrierAdapter,
  CarrierIntent,
  CarrierResult,
} from "../src/server/carrier-bookings.ts";

export function replacementCarrierFixture(t: Parameters<typeof fixture>[0]) {
  const f = fixture(t);
  ship(f, accept(f).id);
  const claim = f.app.warranty.submit(f.actor, "replacement-claim", {
    accountId: f.buyer,
    unitId: f.app.inventory.trace(f.actor, "S1").unit.id,
    type: "warranty",
    issue: "Synthetic equipment failure",
    evidence: "Synthetic customer report",
  });
  f.app.warranty.review(f.actor, "replacement-review", {
    claimId: claim.id,
    approved: true,
    reason: "Synthetic review",
  });
  f.app.warranty.receive(f.actor, "replacement-receive", {
    claimId: claim.id,
    warehouseId: f.w1,
    bin: "Q",
    serial: "S1",
  });
  f.app.warranty.inspect(f.actor, "replacement-inspect", {
    claimId: claim.id,
    findings: "Synthetic inspection",
  });
  const replacement = f.app.warranty.reserveReplacement(
    f.actor,
    "replacement-reserve",
    {
      claimId: claim.id,
      newUnitId: f.app.inventory.trace(f.actor, "S2").unit.id,
      oldDisposition: "scrap",
      coveragePolicy: "inherit_original",
      reason: "Synthetic replacement approval",
    },
  );
  chooseProviders(f, f.actor, "replacement-provider-choice", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["ups", "canada-post", "dhl-express"],
    version: 1,
    acknowledgment: "Synthetic named provider acceptance",
  });
  const origin = {
    name: "Synthetic origin",
    line1: "1 Test Street",
    line2: "",
    city: "Toronto",
    province: "ON",
    postalCode: "M5V 1A1",
    country: "CA" as const,
    phone: "4165550100",
  };
  const input: CarrierPrepare = {
    replacementId: replacement.id,
    shipmentId: replacement.id,
    previousId: null,
    provider: "ups",
    service: "Synthetic ground",
    origin,
    destination: {
      ...origin,
      name: "Synthetic recipient",
      line1: "2 Test Street",
    },
    parcel: { weightGrams: 1000, lengthMm: 300, widthMm: 200, heightMm: 100 },
    reviewedDestination:
      "Synthetic recipient, 2 Test Street, Toronto ON M5V 1A1, CA",
    acknowledgment:
      "Synthetic review of replacement destination, origin and parcel",
  };
  return Object.assign(f, { claim, replacement, input });
}
export function replacementDispatch(
  f: ReturnType<typeof replacementCarrierFixture>,
) {
  return {
    replacementId: f.replacement.id,
    revision: 1,
    serial: "S2",
    recipient: f.input.destination.name,
    address: f.input.reviewedDestination,
    carrier: "ups",
    tracking: "SYN-REPLACEMENT-TRACKING",
    evidence: "Synthetic physical carrier handover",
  };
}
export const replacementLabel = Buffer.from(
  "%PDF-1.7\nSynthetic replacement carrier label\n%%EOF",
);
export const replacementProof = (intent: CarrierIntent): CarrierResult => ({
  bookingId: intent.bookingId,
  reviewHash: intent.reviewHash,
  reference: "SYN-REPLACEMENT-BOOKING",
  tracking: "SYN-REPLACEMENT-TRACKING",
  label: { mediaType: "application/pdf", bytes: replacementLabel },
});
export function replacementAdapter(
  patch: Partial<CarrierAdapter> = {},
): CarrierAdapter {
  return {
    provider: "ups",
    sandbox: true,
    book: async (intent, guard) => {
      guard();
      return replacementProof(intent);
    },
    lookup: async (intent) => replacementProof(intent),
    ...patch,
  };
}
