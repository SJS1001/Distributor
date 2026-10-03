import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { fixture, accept, chooseProviders } from "./fixtures.ts";
import { origin } from "./canada-post-fixture.ts";
import { canonical, digest } from "../src/server/core.ts";
import type { CarrierIntent } from "../src/server/carrier-bookings.ts";
import {
  canadaPostConfigurationHash,
  captureCanadaPostAccountBinding,
  reviewCanadaPostShipment,
  captureCanadaPostShipmentDetails,
} from "../src/server/canada-post-evidence.ts";
import { readOfflinePrivateEvidence } from "../src/server/restore-offline-private-evidence.ts";

// Contract-gap reproduction, NOT an implemented evidence comparator or import.
// Native setup is derived from the existing owning reader's synthetic fixtures.
async function setup(
  t: Parameters<typeof fixture>[0],
  region: "CA" | "US" = "CA",
  currency: "CAD" | "USD" = "CAD",
  reports = false,
) {
  const f = fixture(t, { eventReports: reports }, region, currency);
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
    customerNumber: "1234567",
    contractId: "123456",
    company: "Synthetic",
    shippingPoint: { kind: "pickup" as const, postalCode: "M5V1A1" },
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
  const entries = [0, 1, 2].map((n) => {
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
        configurationHash,
      },
      configuration,
    );
    return { bookingId: b.id, reviewHash: b.reviewHash };
  });
  const input = { configurationHash, entries: entries.slice(0, 2) };
  const group = f.app.carriers.prepareCanadaPostGroup(f.actor, "group", input);
  const pdf = Buffer.from("%PDF-1.7\nSynthetic native label only\n%%EOF");
  const observation = (intent: CarrierIntent, groupId: string) => ({
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
  const outside = f.app.carriers.prepareCanadaPostGroup(
    f.actor,
    "outside-group",
    {
      configurationHash,
      entries: entries.slice(2),
    },
  );
  const outsideShipmentId = "OUTSIDE_CREATED_SHIPMENT";
  const outsideTracking = "9999999999999999";
  await f.app.carriers.createCanadaPostMember(
    f.actor,
    outside.id,
    entries[2]!.bookingId,
    {
      ...client,
      create: async (i, g, guard) => {
        guard();
        calls++;
        return {
          ...observation(i, g),
          shipmentId: outsideShipmentId,
          tracking: outsideTracking,
        };
      },
    },
  );
  assert.equal(calls, 3);
  f.app.platform.isolateRestore("a".repeat(64), "2026-10-03T00:00:00.000Z");
  return {
    ...f,
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

function privateCapture(
  t: TestContext,
  contents = [Buffer.from("é\0☃"), Buffer.from("private second report")],
) {
  const root = fs.mkdtempSync(join(tmpdir(), "offline-private-"));
  fs.chmodSync(root, 0o700);
  fs.mkdirSync(join(root, "nested"), { mode: 0o700 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const items = contents.map((bytes, i) => ({
    reference: `report-${i.toString().padStart(3, "0")}`,
    sha256: digest(bytes),
    bytes: bytes.length,
  }));
  const manifest = {
    version: 1 as const,
    root,
    files: items.map((item, i) => ({
      reference: item.reference,
      path: `nested/file-${i}`,
    })),
  };
  manifest.files.forEach((file, i) =>
    fs.writeFileSync(join(root, file.path), contents[i]!, { mode: 0o600 }),
  );
  const h = "a".repeat(64),
    at = "2026-10-03T16:00:00.000Z";
  const envelope = {
    version: 1,
    purpose: "distributor-restore-offline-task-v1",
    requestId: "synthetic-request",
    preparedBy: "preparer",
    executorId: "executor",
    preparedAt: at,
    expiresAt: "2026-10-03T16:15:00.000Z",
    recovery: {
      instanceId: "recovery",
      snapshotHash: h,
      restoredAt: at,
      sourceCompletedAt: at,
      schemaHash: h,
      region: "CA",
      organizations: [{ id: "org", currency: "USD" }],
    },
    session: { id: "session", revision: 1, lineageHash: h },
    candidate: { logicalHash: h, file: { dev: 1, ino: 2 } },
    source: {
      identity: "source",
      baseline: { logicalHash: h, durableCursor: "baseline", auditSequence: 1 },
      end: { logicalHash: h, durableCursor: "end", auditSequence: 2 },
      intervalEvidenceHash: h,
    },
    task: {
      name: "carrier.offline-canada-post-creation.v1",
      version: 1,
      owner: "carrier",
      orgId: "org",
      siteIds: [],
      subjectId: "subject",
      expectedRevision: 1,
      expectedStateHash: h,
      payloadHash: h,
      priorClaim: null,
    },
    evidence: {
      setHash: digest(canonical(items)),
      items,
      qualificationHash: h,
    },
    operations: {
      authorityId: "operations",
      revision: 1,
      adapterIdentity: "adapter",
      fenceTokenHash: h,
      observationHash: h,
    },
    trust: { authorityId: "trust", revision: 1, registryHash: h },
  };
  const capture = {
    references: [items[0]!.reference],
    maxBytes: Math.min(4 * 1024 ** 2, contents[0]!.length),
  };
  const read = () => readOfflinePrivateEvidence(envelope, manifest, capture);
  return { root, contents, manifest, envelope, capture, read };
}

// Observe allocations and real file IO, never substitute file contents/results.
function track(t: TestContext) {
  const allocated: Buffer[] = [],
    opened: number[] = [],
    closed: number[] = [];
  const alloc = Buffer.alloc,
    open = fs.openSync,
    close = fs.closeSync;
  t.mock.method(Buffer, "alloc", ((
    ...args: Parameters<typeof Buffer.alloc>
  ) => {
    const buffer = Reflect.apply(alloc, Buffer, args);
    allocated.push(buffer);
    return buffer;
  }) as typeof Buffer.alloc);
  t.mock.method(fs, "openSync", ((...args: Parameters<typeof fs.openSync>) => {
    const fd = Reflect.apply(open, fs, args);
    opened.push(fd);
    return fd;
  }) as typeof fs.openSync);
  t.mock.method(fs, "closeSync", (fd: number) => {
    closed.push(fd);
    close(fd);
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return { allocated, opened, closed };
}
function zero(buffers: Buffer[]) {
  assert.ok(buffers.every((b) => b.every((x) => x === 0)));
}

type Fixture = Awaited<ReturnType<typeof setup>>;
function readJoined(f: Fixture) {
  return f.app.database.transaction(() => {
    const native =
      f.app.carrierOfflineMemberReview.reviewUnknownMemberInTransaction(
        f.actor,
        f.groupId,
        f.bookingId,
      );
    const platform = f.app.platformOfflineCarrierReview.getInTransaction(
      f.actor,
      f.groupId,
      f.bookingId,
    );
    const custody = native.orderedMembers.map((member) => {
      const preparation = native.preparations.find(
        (p) => p.bookingId === member.bookingId,
      )!;
      return f.app.fulfillment.reviewPackedCarrierCustodyInTransaction(
        f.actor,
        preparation.intent.shipmentId,
      );
    });
    return { native, platform, custody };
  });
}
function changes(f: Fixture) {
  return f.app.database.owned("integration").get("SELECT total_changes() AS n")!
    .n;
}
function freezeCheck(value: unknown): void {
  if (value && typeof value === "object") {
    assert.ok(Object.isFrozen(value));
    for (const child of Object.values(value)) freezeCheck(child);
  }
}

for (const currency of ["CAD", "USD"] as const) {
  test(`CA/${currency}: native joins omit a real disconnected same-config reference needed for proposed outcome collision comparison`, async (t) => {
    const f = await setup(t, "CA", currency),
      before = changes(f);
    const { native, platform, custody } = readJoined(f);
    const binding = captureCanadaPostAccountBinding(f.binding);
    assert.equal(canadaPostConfigurationHash(binding), f.configurationHash);
    const preparation = native.preparations.find(
      (p) => p.bookingId === f.bookingId,
    )!;
    const group = native.groups.find((g) => g.id === f.groupId)!;
    assert.equal(group.state, "unknown");
    assert.equal(group.configuration_hash, f.configurationHash);
    assert.equal(native.currency, currency);
    assert.equal(native.members.length, 2);
    assert.equal(custody.length, 2);
    for (const c of custody) {
      const p = native.preparations.find(
        (p) => p.intent.shipmentId === c.shipment.id,
      )!;
      assert.equal(canonical(c.shipment), canonical(p.intent.nativeSnapshot));
      assert.equal(c.shipment.state, "packed");
      assert.deepEqual(c.history, {
        coverage: 0,
        delivery: 0,
        deliveryObservations: 0,
      });
    }
    // Read-only fixture oracle: the real owning store already contains these IDs.
    // No authorizer bypass, fabricated row or post-hold write supplies the case.
    const outside = f.app.database
      .owned("integration")
      .get(
        "SELECT group_id,booking_id,state,provider_shipment_id,tracking FROM integration_canada_post_members WHERE group_id=?",
        f.outside.id,
      )!;
    assert.equal(outside.state, "created");
    assert.equal(outside.provider_shipment_id, f.outsideShipmentId);
    assert.equal(outside.tracking, f.outsideTracking);
    assert.ok(!native.groups.some((g) => g.id === outside.group_id));
    assert.ok(!native.members.some((m) => m.booking_id === outside.booking_id));
    for (const hidden of [
      f.outsideShipmentId,
      f.outsideTracking,
      f.outside.id,
    ]) {
      assert.ok(!canonical({ native, platform, custody }).includes(hidden));
    }
    assert.match(native.duplicateScopeHash, /^[a-f0-9]{64}$/);
    assert.match(native.bookingReferenceScopeHash, /^[a-f0-9]{64}$/);
    assert.match(platform.history.hash, /^[a-f0-9]{64}$/);
    // Existing detail validation cannot substitute for that missing owner join:
    // target request/details can be internally consistent with a reused tracking.
    const request = reviewCanadaPostShipment(
      binding,
      preparation.intent as CarrierIntent,
      String(group.provider_group_id),
    );
    const details = {
      customerRequestId: request.customerRequestId,
      trackingPin: f.outsideTracking,
      shipmentStatus: "created",
      cpcPickupIndicator: true,
      finalShippingPoint: "M5V1A1",
      shipmentDetail: {
        groupId: request.groupId,
        deliverySpec: structuredClone(request.body.deliverySpec),
      },
    };
    assert.equal(
      captureCanadaPostShipmentDetails(
        binding,
        request,
        { tracking: f.outsideTracking, status: "created" },
        details,
      ).tracking,
      f.outsideTracking,
    );
    // Intentionally NO predicate interpreting an opaque scope hash as no collision.
    assert.ok(
      native.blockers.includes("EXHAUSTIVE_EXTERNAL_OUTCOME_EVIDENCE_REQUIRED"),
    );
    assert.ok(
      platform.blockers.includes("GROUP_MEMBERSHIP_ALLOWLIST_NOT_RETAINED"),
    );
    freezeCheck(native);
    freezeCheck(platform);
    custody.forEach(freezeCheck);
    assert.equal(changes(f), before);
    assert.equal(
      canonical(readJoined(f)),
      canonical({ native, platform, custody }),
    );
    assert.equal(changes(f), before);
  });

  test(`CA/${currency}: actual private capture binds native report/PDF but cannot upgrade it to carrier comparison; refusal erases without reopening`, async (t) => {
    const f = await setup(t, "CA", currency),
      before = changes(f);
    const joined = readJoined(f);
    const capture = privateCapture(t, [Buffer.from(canonical(joined)), f.pdf]);
    capture.envelope.recovery.organizations = [{ id: f.actor.orgId, currency }];
    capture.envelope.task.orgId = f.actor.orgId;
    capture.envelope.task.subjectId = f.bookingId;
    capture.capture.references = capture.manifest.files.map(
      (file) => file.reference,
    );
    capture.capture.maxBytes = capture.contents.reduce(
      (n, b) => n + b.length,
      0,
    );
    const io = track(t),
      handle = capture.read();
    const summary = handle.complete();
    assert.equal(summary.qualification, "unverified");
    assert.equal(summary.status, "historical-byte-binding");
    assert.equal(summary.bytes, capture.capture.maxBytes);
    assert.equal(summary.files, 2);
    assert.ok(io.allocated.some((b) => b.equals(capture.contents[0]!)));
    assert.ok(io.allocated.some((b) => b.equals(f.pdf)));
    for (const file of capture.manifest.files)
      fs.unlinkSync(join(capture.root, file.path));
    const opens = io.opened.length;
    assert.throws(
      () => handle.compareFailedRefund(capture.capture.references[0]),
      {
        code: "RESTORE_OFFLINE_PRIVATE_EVIDENCE",
        message: "Offline private evidence binding did not complete.",
      },
    );
    assert.throws(() => handle.complete(), {
      code: "RESTORE_OFFLINE_PRIVATE_EVIDENCE",
    });
    handle.dispose();
    assert.equal(io.opened.length, opens);
    assert.deepEqual(io.opened, io.closed);
    assert.ok(io.allocated.length > 0);
    zero(io.allocated);
    assert.equal(changes(f), before);
  });
}

test("US/USD: current native Platform contract refuses before a joined carrier comparison; preserve regional guard", async (t) => {
  const f = await setup(t, "US", "USD"),
    before = changes(f);
  f.app.database.transaction(() => {
    const native =
      f.app.carrierOfflineMemberReview.reviewUnknownMemberInTransaction(
        f.actor,
        f.groupId,
        f.bookingId,
      );
    assert.equal(native.region, "US");
    assert.throws(
      () =>
        f.app.platformOfflineCarrierReview.getInTransaction(
          f.actor,
          f.groupId,
          f.bookingId,
        ),
      { code: "CARRIER_PROVENANCE_REGION" },
    );
  });
  assert.equal(changes(f), before);
});
