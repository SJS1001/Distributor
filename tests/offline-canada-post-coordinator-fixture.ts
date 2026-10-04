import assert from "node:assert/strict";
import test from "node:test";
import { Application } from "../src/server/application.ts";
import { canonical, digest } from "../src/server/core.ts";
import type {
  CarrierIntent,
  CanadaPostManifestClient,
} from "../src/server/carrier-bookings.ts";
import {
  reviewCanadaPostShipment,
  canadaPostConfigurationHash,
} from "../src/server/canada-post-evidence.ts";
import { fixture, accept, chooseProviders } from "./fixtures.ts";
import { origin } from "./canada-post-fixture.ts";

// Synthetic native fixture derived from the published proposed-reference review tests.
async function nativeSetup(
  t: Parameters<typeof fixture>[0],
  region: "CA" | "US" = "CA",
  currency: "CAD" | "USD" = "CAD",
  reports = false,
  options: {
    differentConfiguration?: boolean;
    deposit?: boolean;
    promote?: boolean;
    ordinary?: boolean;
    hold?: boolean;
  } = {},
) {
  const f = fixture(t, { eventReports: reports }, region, currency);
  const preparer = f.app.identity.createUser(f.actor, "coordinator-preparer", {
    email: "preparer@example.test",
    name: "Independent preparer",
    password: "synthetic-preparer-password",
    // Existing native readers require both finance and warehouse capabilities;
    // admin is the actual role intersection. Keep this principal independent.
    role: "admin",
    sites: [f.w1],
    requirePasswordChange: false,
  });
  chooseProviders(f, f.actor, "cp-choice", {
    accountId: f.buyer,
    region,
    mode: "provider-exceptions",
    providers: ["canada-post"],
    version: 1,
    acknowledgment: "Synthetic explicit choice",
  });
  const binding = {
    orgId: f.actor.orgId,
    warehouseId: f.w1,
    testApplication: true as const,
    customerNumber: "6767676",
    contractId: "123456",
    company: "Synthetic",
    shippingPoint: options.deposit
      ? { kind: "deposit" as const, siteId: "A1B2" }
      : { kind: "pickup" as const, postalCode: "M5V1A1" },
    services: [{ service: "DOM.EP", code: "DOM.EP" as const }],
  };
  const configurationHash = canadaPostConfigurationHash(binding);
  const configuration = {
    hash: configurationHash,
    provider: "canada-post" as const,
    accountHint: "Synthetic account",
    details: ["Synthetic domestic"],
    services: [{ service: "DOM.EP", description: "Synthetic service" }],
  };
  const outsideConfigurationHash = options.differentConfiguration
    ? canadaPostConfigurationHash({
        ...binding,
        company: "Other retained company",
      })
    : configurationHash;
  const entries = [0, 1].map((n) => {
    const selectedHash = n === 2 ? outsideConfigurationHash : configurationHash;
    const selectedConfiguration = { ...configuration, hash: selectedHash };
    const orderId = accept(f, 1, `order-${n}`).id;
    const picks = f.app.fulfillment.picks(f.actor, orderId);
    for (const p of picks)
      f.app.fulfillment.pick(f.actor, `pick-${n}-${p.id}`, {
        orderId,
        allocationId: p.id,
        serial: p.serial,
      });
    const address = "Synthetic CA destination";
    const shipmentId = f.app.fulfillment.pack(f.actor, `pack-${n}`, {
      orderId,
      revision: f.app.orders.order(f.actor, orderId).revision,
      mode: "carrier",
      address,
      lines: picks.map((p) => ({ allocationId: p.id, quantity: p.quantity })),
    }).id;
    const b = f.app.carriers.prepare(
      f.actor,
      `booking-${n}`,
      {
        shipmentId,
        previousId: null,
        provider: "canada-post",
        service: "DOM.EP",
        origin,
        destination: { ...origin, name: "Receiver" },
        parcel: {
          weightGrams: 1000,
          lengthMm: 100,
          widthMm: 100,
          heightMm: 100,
        },
        reviewedDestination: address,
        acknowledgment: "Synthetic parcel review",
        configurationHash: selectedHash,
      },
      selectedConfiguration,
    );
    return { bookingId: b.id, reviewHash: b.reviewHash };
  });
  const input = {
    configurationHash,
    entries: [...entries].sort((a, b) =>
      a.bookingId.localeCompare(b.bookingId),
    ),
  };
  const group = f.app.carriers.prepareCanadaPostGroup(f.actor, "group", input);
  const pdf = Buffer.from("%PDF-1.7\nSynthetic native label only\n%%EOF");
  const observation = (
    intent: CarrierIntent,
    groupId: string,
    configurationHash = canadaPostConfigurationHash(binding),
  ) => ({
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
    tracking: "1234567890123456",
    status: "created" as const,
    label: { mediaType: "application/pdf" as const, bytes: Buffer.from(pdf) },
  });
  let calls = 0;
  const client = {
    testApplication: true as const,
    configurationHash,
    create: async (i: CarrierIntent, g: string, guard: () => void) => {
      guard();
      calls++;
      return observation(i, g);
    },
    lookup: async () => {
      throw Error("no lookup");
    },
  };
  await f.app.carriers.createCanadaPostMember(
    f.actor,
    group.id,
    entries[0]!.bookingId,
    client,
  );
  await assert.rejects(
    f.app.carriers.createCanadaPostMember(
      f.actor,
      group.id,
      entries[1]!.bookingId,
      {
        ...client,
        create: async (_i, _g, guard) => {
          guard();
          calls++;
          throw Error("lost synthetic response");
        },
      },
    ),
    /lost synthetic response/,
  );
  assert.equal(calls, 2);
  // Supported original group only; unrelated carrier histories remain refused.
  const outside = null;
  const outsideShipmentId = "OUTSIDE_CREATED_SHIPMENT";
  const outsideTracking = "9999999999999999";
  assert.equal(calls, 2);
  if (options.hold !== false)
    f.app.platform.isolateRestore("a".repeat(64), "2026-10-03T00:00:00.000Z");
  return {
    ...f,
    originalFixture: f,
    preparer,
    binding,
    outside,
    outsideShipmentId,
    outsideTracking,
    groupId: group.id,
    bookingId: entries[1]!.bookingId,
    createdId: entries[0]!.bookingId,
    entries,
    region,
    currency,
    reports,
    pdf,
    configurationHash,
  };
}

import {
  compareCanadaPostOfflineMemberEvidence as compare,
  canadaPostOfflineMemberEvidenceLimits as limits,
} from "../src/server/canada-post-offline-member-evidence.ts";
type F = Awaited<ReturnType<typeof nativeSetup>>;
function proposal(f: F) {
  return {
    groupId: f.groupId,
    bookingId: f.bookingId,
    providerShipmentId: "PROPOSED_UNUSED_ID",
    tracking: "8888888888888888",
  };
}
function inputs(f: F): any {
  return f.app.database.transaction(() => {
    const native =
      f.app.carrierOfflineMemberReview.reviewUnknownMemberInTransaction(
        f.actor,
        f.groupId,
        f.bookingId,
      );
    const proposedReferences =
      f.app.carrierOfflineMemberReview.reviewProposedReferencesInTransaction(
        f.actor,
        proposal(f),
      );
    const platform = native.preparations.map((p) =>
      f.app.platformOfflineCarrierReview.getInTransaction(
        f.actor,
        f.groupId,
        p.bookingId as string,
      ),
    );
    const custody = native.preparations.map((p) =>
      f.app.fulfillment.reviewPackedCarrierCustodyInTransaction(
        f.actor,
        p.intent.shipmentId,
      ),
    );
    const members = native.preparations.map((p) => {
      const request = reviewCanadaPostShipment(
        f.binding,
        structuredClone(p.intent) as CarrierIntent,
        native.groups[0]!.provider_group_id as string,
      );
      const m = native.members.find((m) => m.booking_id === p.bookingId)!;
      const target = p.bookingId === f.bookingId;
      const tracking = target ? proposal(f).tracking : (m.tracking as string);
      return {
        bookingId: p.bookingId,
        reviewHash: p.intent.reviewHash,
        configurationHash: f.configurationHash,
        groupId: request.groupId,
        customerRequestId: request.customerRequestId,
        shipmentId: target
          ? proposal(f).providerShipmentId
          : m.provider_shipment_id,
        tracking,
        status: "created",
        details: {
          customerRequestId: request.customerRequestId,
          trackingPin: tracking,
          shipmentStatus: "created",
          ...(f.binding.shippingPoint.kind === "pickup"
            ? { cpcPickupIndicator: true, finalShippingPoint: "M5V1A1" }
            : { shippingPointId: "A1B2" }),
          shipmentDetail: {
            groupId: request.groupId,
            deliverySpec: structuredClone(request.body.deliverySpec),
          },
        },
        label: {
          encoding: "base64",
          bytes: f.pdf.length,
          sha256: digest(f.pdf),
          data: f.pdf.toString("base64"),
        },
      };
    });
    return structuredClone({
      version: 1,
      native,
      proposedReferences,
      account: f.binding,
      platform,
      custody,
      members,
    });
  });
}
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import {
  RestoreOfflineCanadaPostPrivateEvidence,
  canadaPostPrivateEvidenceBytes,
  canadaPostPrivateTask,
} from "../src/server/restore-offline-canada-post-private-evidence.ts";
import {
  RestoreOfflineCanadaPostNativeJoin,
  isCapturedCanadaPostNativeJoin,
} from "../src/server/restore-offline-canada-post-native-join.ts";
function json(v: any): string {
  if (Array.isArray(v)) return `[${v.map(json).join(",")}]`;
  if (v !== null && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${json(v[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}
const refusal = {
  code: "RESTORE_OFFLINE_CANADA_POST_PRIVATE",
  message: "Canada Post private evidence capture did not complete.",
};
function actor(f: F) {
  return { id: f.actor.id, orgId: f.actor.orgId };
}
function reader(f: F) {
  return new RestoreOfflineCanadaPostPrivateEvidence(
    f.app.database,
    f.app.identity,
    f.app.platform,
    f.app.fulfillment,
  );
}
function changes(f: F) {
  return f.app.database.owned("integration").get("SELECT total_changes() AS n")!
    .n;
}
function frozen(v: unknown): void {
  if (v && typeof v === "object") {
    assert.ok(Object.isFrozen(v));
    Object.values(v).forEach(frozen);
  }
}
async function setup(
  t: TestContext,
  currency: "CAD" | "USD" = "CAD",
  reports = false,
) {
  const f = await nativeSetup(t, "CA", currency, reports);
  fs.chmodSync(f.path, 0o600);
  const input = inputs(f),
    root = fs.mkdtempSync(join(tmpdir(), "cp-private-native-"));
  fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = join(root, "report.json");
  const at = "2026-10-03T16:00:00.000Z",
    h = "a".repeat(64);
  const candidate = f.app.database.transaction(() =>
    f.app.database.captureRestoreCandidateInTransaction(),
  );
  const { logicalHash, ...binding } = candidate,
    stat = fs.lstatSync(f.path);
  const envelope: any = {
    version: 1,
    purpose: "distributor-restore-offline-task-v1",
    requestId: "synthetic-cp-request",
    preparedBy: "preparer",
    executorId: "executor",
    preparedAt: at,
    expiresAt: "2026-10-03T16:15:00.000Z",
    recovery: { instanceId: "instance", ...binding },
    session: { id: "session", revision: 1, lineageHash: h },
    candidate: { logicalHash, file: { dev: stat.dev, ino: stat.ino } },
    source: {
      identity: "source",
      baseline: { logicalHash: h, durableCursor: "start", auditSequence: 1 },
      end: { logicalHash: h, durableCursor: "end", auditSequence: 2 },
      intervalEvidenceHash: h,
    },
    task: {
      ...canadaPostPrivateTask,
      orgId: f.actor.orgId,
      siteIds: [f.w1],
      subjectId: f.bookingId,
      expectedRevision: 0,
      expectedStateHash: input.native.reviewHash,
      payloadHash: digest(canonical(input)),
      priorClaim: null,
    },
    evidence: { setHash: h, items: [], qualificationHash: h },
    operations: {
      authorityId: "operations",
      revision: 1,
      adapterIdentity: "adapter",
      fenceTokenHash: h,
      observationHash: h,
    },
    trust: { authorityId: "trust", revision: 1, registryHash: h },
  };
  const manifest = {
    version: 1 as const,
    root,
    files: [{ reference: "carrier-report", path: "report.json" }],
  };
  const write = (bytes: Buffer = Buffer.from(json(input))) => {
    fs.writeFileSync(file, bytes, { mode: 0o600 });
    envelope.evidence.items = [
      {
        reference: "carrier-report",
        sha256: digest(bytes),
        bytes: bytes.length,
      },
    ];
    envelope.evidence.setHash = digest(canonical(envelope.evidence.items));
    return bytes;
  };
  const bytes = write();
  const r = reader(f);
  const read = () => r.read(envelope, manifest);
  const run = () => {
    const handle = read();
    try {
      handle.complete();
      return f.app.database.transaction(() =>
        handle.reviewInTransaction(actor(f)),
      );
    } finally {
      handle.dispose();
    }
  };
  return {
    ...f,
    f,
    input,
    root,
    file,
    envelope,
    manifest,
    write,
    bytes,
    r,
    read,
    run,
  };
}
import { IntegrationOfflineCanadaPostMember } from "../src/server/integration-offline-canada-post-member.ts";
import { SCHEMA_VERSION } from "../src/server/schema.ts";
import { offlineTaskBinding } from "../src/server/restore-offline-envelope.ts";
export async function readyCanadaPostMember(
  t: TestContext,
  currency: "CAD" | "USD" = "CAD",
  reports = false,
) {
  const f = await setup(t, currency, reports);
  const importer = new IntegrationOfflineCanadaPostMember(
    f.app.database,
    f.app.identity,
    f.app.platform,
    f.app.fulfillment,
    f.app.carriers,
  );
  f.app.database.transaction(() => {
    const { logicalHash: _hash, ...candidate } =
      f.app.database.captureRestoreCandidateInTransaction();
    f.app.platform.offline.createGenerationInTransaction(
      {
        version: 1,
        schemaVersion: SCHEMA_VERSION,
        instanceId: digest("synthetic-instance"),
        ...candidate,
        organizations: candidate.organizations.map((o) => ({
          id: o.id,
          currency: o.currency,
        })),
      },
      null,
      [],
    );
    for (const transition of [
      { kind: "isolate", sessionId: "session" },
      { kind: "open" },
    ] as const) {
      const s = f.app.platform.offline.readInTransaction()!;
      f.app.platform.offline.transitionInTransaction(
        s.state.generation,
        s.anchor,
        transition,
        [],
      );
    }
  });
  const refresh = () =>
    f.app.database.transaction(() => {
      const s = f.app.platform.offline.readInTransaction()!,
        current = s.state.sessions.at(-1)!;
      f.envelope.recovery.instanceId = s.state.generation.instanceId;
      f.envelope.session = {
        id: current.id,
        revision: current.revision,
        lineageHash: current.lineageHash,
      };
      f.envelope.candidate.logicalHash =
        f.app.database.captureRestoreCandidateInTransaction().logicalHash;
    });
  refresh();
  const capture = () => {
    const h = importer.read(f.envelope, f.manifest);
    h.complete();
    return h;
  };
  const apply = () => {
    const h = capture();
    return f.app.database.transaction(() =>
      importer.applyInTransaction(actor(f), h),
    );
  };
  const recover = (original: unknown) =>
    f.app.database.transaction(() =>
      importer.recoverInTransaction(actor(f), f.envelope, original),
    );
  const snapshot = () =>
    f.app.database.transaction(() =>
      canonical({
        candidate: f.app.database.captureRestoreCandidateInTransaction(),
        offline: f.app.platform.offline.readInTransaction(),
      }),
    );
  return { ...f, importer, refresh, capture, apply, recover, snapshot };
}
