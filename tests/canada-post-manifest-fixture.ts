import { PDFDocument } from "pdf-lib";
import { canonical, digest } from "../src/server/core.ts";
import type { CanadaPostManifestClient } from "../src/server/carrier-bookings.ts";
import type {
  CanadaPostManifestReview,
  CanadaPostManifestObservation,
} from "../src/server/canada-post-test.ts";
import { setup } from "./canada-post-fixture.ts";
import {
  client as creation,
  configurationHash,
} from "./canada-post-creation-fixture.ts";
const doc = await PDFDocument.create();
doc.addPage([288, 432]).drawText("Synthetic native manifest fixture");
const pdf = Buffer.from(await doc.save());
export function manifestClient(): CanadaPostManifestClient & {
  writes: number;
  reads: number;
} {
  return {
    testApplication: true,
    configurationHash,
    writes: 0,
    reads: 0,
    manifestIdentity(input) {
      const reviewHash = digest(
        canonical({
          configurationHash,
          ...input,
          entries: input.entries.toSorted((a, b) =>
            a.shipmentId.localeCompare(b.shipmentId),
          ),
        }),
      );
      return {
        manifestId: input.manifestId,
        groupId: input.groupId,
        configurationHash,
        reviewHash,
        customerReference: "D" + reviewHash.slice(0, 11).toUpperCase(),
        shipmentIds: input.entries.map((e) => e.shipmentId).sort(),
      };
    },
    async transmitManifest(input, guard) {
      guard();
      this.writes++;
      return manifestObservation(input);
    },
    async recoverManifest(input) {
      this.reads++;
      return manifestObservation(input);
    },
  };
}
export function manifestObservation(
  input: CanadaPostManifestReview,
): CanadaPostManifestObservation {
  return {
    ...manifestClient().manifestIdentity(input),
    poNumber: "N123456789",
    manifestDate: "2026-10-01",
    totalCents: 2373,
    document: { mediaType: "application/pdf", bytes: Buffer.from(pdf) },
  };
}
export async function closed(t: Parameters<typeof setup>[0], count = 1) {
  const f = setup(t, count),
    groupId = f.app.carriers.prepareCanadaPostGroup(
      f.actor,
      "group",
      f.input,
    ).id,
    c = creation();
  for (const entry of f.input.entries)
    await f.app.carriers.createCanadaPostMember(
      f.actor,
      groupId,
      entry.bookingId,
      c,
    );
  const m = manifestClient(),
    review = f.app.carriers.reviewCanadaPostManifest(f.actor, groupId, m);
  return Object.assign(f, { groupId, m, manifestReview: review });
}
export type MF = Awaited<ReturnType<typeof closed>>;
