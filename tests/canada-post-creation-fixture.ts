import { canonical, digest } from "../src/server/core.ts";
import type {
  CanadaPostCreationClient,
  CarrierIntent,
} from "../src/server/carrier-bookings.ts";
import type { CanadaPostShipmentObservation } from "../src/server/canada-post-test.ts";
import { PDFDocument } from "pdf-lib";
export const configurationHash = "a".repeat(64);
const doc = await PDFDocument.create();
doc.addPage([288, 432]).drawText("Synthetic native creation fixture");
const pdf = Buffer.from(await doc.save());
export function observation(
  intent: CarrierIntent,
  groupId: string,
): CanadaPostShipmentObservation {
  return {
    bookingId: intent.bookingId,
    reviewHash: intent.reviewHash,
    configurationHash,
    groupId,
    customerRequestId:
      "D" +
      digest(
        canonical({
          configurationHash,
          bookingId: intent.bookingId,
          reviewHash: intent.reviewHash,
          groupId,
        }),
      )
        .slice(0, 31)
        .toUpperCase(),
    shipmentId: "S" + digest(intent.bookingId).slice(0, 20),
    tracking:
      "12345678901" +
      String(
        parseInt(digest(intent.bookingId).slice(0, 6), 16) % 100000,
      ).padStart(5, "0"),
    status: "created",
    label: { mediaType: "application/pdf", bytes: Buffer.from(pdf) },
  };
}
export function client(): CanadaPostCreationClient & {
  creates: number;
  lookups: number;
} {
  return {
    testApplication: true,
    configurationHash,
    creates: 0,
    lookups: 0,
    async create(intent, groupId, guard) {
      guard();
      this.creates++;
      return observation(intent, groupId);
    },
    async lookup(intent, groupId) {
      this.lookups++;
      return observation(intent, groupId);
    },
  };
}
