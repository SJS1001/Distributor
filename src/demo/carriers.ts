import { PDFDocument } from "pdf-lib";
import { canonical, check, digest, type Actor } from "../server/core.ts";
import type { Application } from "../server/application.ts";
import { CarrierRuntime } from "../server/carrier-runtime.ts";
import {
  carrierConfiguration,
  assertCarrierConfiguration,
} from "../server/carrier-configuration.ts";
import type {
  CarrierAdapter,
  CarrierIntent,
  CarrierResult,
  CanadaPostCreationClient,
  CanadaPostManifestClient,
} from "../server/carrier-bookings.ts";
import type {
  CanadaPostManifestReview,
  CanadaPostManifestObservation,
  CanadaPostShipmentObservation,
} from "../server/canada-post-test.ts";
import { carrierNames, type CarrierName } from "../shared/carrier-booking.ts";

// Entirely offline. These classes are imported only by the temporary demo runtime.
async function document(kind: string, reference: string) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([432, 288]);
  page.drawText("SIMULATED - NOT VALID FOR SHIPPING", {
    x: 20,
    y: 250,
    size: 16,
  });
  page.drawText(kind, { x: 20, y: 210, size: 14 });
  page.drawText(reference, { x: 20, y: 175, size: 10 });
  page.drawText("Fictional Distributor demo. No carrier was contacted.", {
    x: 20,
    y: 135,
    size: 11,
  });
  return {
    mediaType: "application/pdf" as const,
    bytes: Buffer.from(await pdf.save()),
  };
}
function copyLabel<T extends { label: CarrierResult["label"] }>(value: T): T {
  return {
    ...value,
    label: { ...value.label, bytes: Buffer.from(value.label.bytes) },
  };
}
export class DemoCarrier implements CarrierAdapter {
  readonly sandbox = true as const;
  readonly configuration;
  private readonly bookings = new Map<string, CarrierResult>();
  constructor(readonly provider: Exclude<CarrierName, "canada-post">) {
    this.configuration = carrierConfiguration(
      provider,
      { demo: true, version: 1 },
      "SIMULATED account - no carrier connection",
      ["Fictional labels; not valid for shipping"],
      [{ service: "DEMO_GROUND", description: "Simulated ground shipment" }],
    );
  }
  async book(intent: CarrierIntent, beforeWrite: () => void) {
    assertCarrierConfiguration(intent, this.configuration);
    check(
      intent.provider === this.provider,
      "CARRIER_MISMATCH",
      "Wrong demo carrier.",
    );
    const label = await document(
      `${this.provider} demo label`,
      intent.bookingId,
    );
    const previous = await this.lookup(intent);
    beforeWrite();
    if (previous) return previous;
    const reference = "DEMO-" + digest(intent.bookingId).slice(0, 24);
    const result = {
      bookingId: intent.bookingId,
      reviewHash: intent.reviewHash,
      reference,
      tracking: reference,
      label,
    };
    this.bookings.set(intent.bookingId, result);
    return copyLabel(result);
  }
  async lookup(intent: CarrierIntent) {
    const value = this.bookings.get(intent.bookingId);
    check(
      !value || value.reviewHash === intent.reviewHash,
      "CARRIER_MISMATCH",
      "Demo booking review changed.",
    );
    return value ? copyLabel(value) : null;
  }
}
export class DemoCanadaPost
  implements CanadaPostCreationClient, CanadaPostManifestClient
{
  readonly testApplication = true as const;
  readonly configurationHash = digest(
    "distributor-offline-canada-post-demo-v1",
  );
  private readonly shipments = new Map<string, CanadaPostShipmentObservation>();
  private readonly manifests = new Map<string, CanadaPostManifestObservation>();
  private key(intent: CarrierIntent, groupId: string) {
    return digest(
      canonical({
        configurationHash: this.configurationHash,
        bookingId: intent.bookingId,
        reviewHash: intent.reviewHash,
        groupId,
      }),
    );
  }
  async create(
    intent: CarrierIntent,
    groupId: string,
    beforeWrite: () => void,
  ) {
    check(
      intent.provider === "canada-post",
      "CARRIER_MISMATCH",
      "Wrong demo carrier.",
    );
    const key = this.key(intent, groupId);
    const label = await document("Canada Post demo label", intent.bookingId);
    beforeWrite();
    const previous = this.shipments.get(key);
    if (previous) return copyLabel(previous);
    const value: CanadaPostShipmentObservation = {
      bookingId: intent.bookingId,
      reviewHash: intent.reviewHash,
      configurationHash: this.configurationHash,
      groupId,
      customerRequestId: "D" + key.slice(0, 31).toUpperCase(),
      shipmentId: "DEMO" + key.slice(0, 20),
      tracking: (BigInt("0x" + key.slice(0, 12)) % 1000000000000000n)
        .toString()
        .padStart(16, "0"),
      status: "created",
      label,
    };
    this.shipments.set(key, value);
    return copyLabel(value);
  }
  async lookup(intent: CarrierIntent, groupId: string) {
    const value = this.shipments.get(this.key(intent, groupId));
    return value ? copyLabel(value) : null;
  }
  manifestIdentity(input: CanadaPostManifestReview) {
    const reviewHash = digest(
      canonical({
        configurationHash: this.configurationHash,
        ...input,
        entries: input.entries.toSorted((a, b) =>
          a.shipmentId.localeCompare(b.shipmentId),
        ),
      }),
    );
    return {
      manifestId: input.manifestId,
      groupId: input.groupId,
      configurationHash: this.configurationHash,
      reviewHash,
      customerReference: "D" + reviewHash.slice(0, 11).toUpperCase(),
      shipmentIds: input.entries.map((e) => e.shipmentId).sort(),
    };
  }
  private copyManifest(value: CanadaPostManifestObservation) {
    return {
      ...value,
      shipmentIds: [...value.shipmentIds],
      document: { ...value.document, bytes: Buffer.from(value.document.bytes) },
    };
  }
  async transmitManifest(
    input: CanadaPostManifestReview,
    beforeWrite: () => void,
  ) {
    const identity = this.manifestIdentity(input);
    check(
      input.entries.length > 0 &&
        input.entries.every((entry) => {
          const shipment = this.shipments.get(
            this.key(entry.intent, input.groupId),
          );
          return (
            shipment?.shipmentId === entry.shipmentId &&
            shipment.tracking === entry.tracking
          );
        }),
      "CARRIER_MISMATCH",
      "Manifest must contain shipments created in this demo workspace.",
    );
    const pdf = await document("Canada Post demo manifest", input.manifestId);
    const previous = await this.recoverManifest(input);
    beforeWrite();
    if (previous) return previous;
    const value = {
      ...identity,
      poNumber: "DEMO" + identity.reviewHash.slice(0, 6),
      manifestDate: new Date().toISOString().slice(0, 10),
      totalCents: 0,
      document: pdf,
    };
    this.manifests.set(input.manifestId, value);
    return this.copyManifest(value);
  }
  async recoverManifest(input: CanadaPostManifestReview) {
    const value = this.manifests.get(input.manifestId);
    check(
      !value || value.reviewHash === this.manifestIdentity(input).reviewHash,
      "CARRIER_MISMATCH",
      "Demo manifest review changed.",
    );
    return value ? this.copyManifest(value) : null;
  }
}
export function demoCarriers(app: Application, actor: Actor) {
  return new CarrierRuntime(
    app,
    carrierNames
      .filter((provider) => provider !== "canada-post")
      .map((provider) => ({
        orgId: actor.orgId,
        adapter: new DemoCarrier(provider),
      })),
    app.inventory.warehouses(actor).map((warehouse) => ({
      orgId: actor.orgId,
      warehouseId: String(warehouse.id),
      client: new DemoCanadaPost(),
    })),
  );
}
