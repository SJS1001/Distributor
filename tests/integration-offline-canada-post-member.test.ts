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
  const entries = [0, 1, 2].map((n) => {
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
  const input = { configurationHash, entries: entries.slice(0, 2) };
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
  const outside = options.ordinary
    ? null
    : f.app.carriers.prepareCanadaPostGroup(f.actor, "outside-group", {
        configurationHash: outsideConfigurationHash,
        entries: entries.slice(2),
      });
  const outsideShipmentId = "OUTSIDE_CREATED_SHIPMENT";
  const outsideTracking = "9999999999999999";
  if (outside) {
    await f.app.carriers.createCanadaPostMember(
      f.actor,
      outside.id,
      entries[2]!.bookingId,
      {
        ...client,
        configurationHash: outsideConfigurationHash,
        create: async (i, g, guard) => {
          guard();
          calls++;
          return {
            ...observation(i, g, outsideConfigurationHash),
            shipmentId: outsideShipmentId,
            tracking: outsideTracking,
          };
        },
      },
    );
    if (options.promote) {
      const manifest: CanadaPostManifestClient = {
        testApplication: true,
        configurationHash: outsideConfigurationHash,
        manifestIdentity(input) {
          const reviewHash = digest(
            canonical({
              configurationHash: outsideConfigurationHash,
              ...input,
              entries: input.entries.toSorted((a, b) =>
                a.shipmentId.localeCompare(b.shipmentId),
              ),
            }),
          );
          return {
            manifestId: input.manifestId,
            groupId: input.groupId,
            configurationHash: outsideConfigurationHash,
            reviewHash,
            customerReference: "D" + reviewHash.slice(0, 11).toUpperCase(),
            shipmentIds: input.entries.map((e) => e.shipmentId).sort(),
          };
        },
        async transmitManifest(input, guard) {
          guard();
          return {
            ...this.manifestIdentity(input),
            poNumber: "N123456789",
            manifestDate: "2026-10-01",
            totalCents: 2373,
            document: { mediaType: "application/pdf", bytes: Buffer.from(pdf) },
          };
        },
        async recoverManifest() {
          throw Error("no recovery");
        },
      };
      const reviewed = f.app.carriers.reviewCanadaPostManifest(
        f.actor,
        outside.id,
        manifest,
      );
      await f.app.carriers.transmitCanadaPostManifest(
        f.actor,
        outside.id,
        reviewed.reviewHash,
        manifest,
      );
    }
  } else {
    await f.app.carriers.execute(f.actor, entries[2]!.bookingId, {
      provider: "canada-post",
      sandbox: true,
      configuration: { ...configuration, hash: outsideConfigurationHash },
      async book(i, guard) {
        guard();
        calls++;
        return {
          bookingId: i.bookingId,
          reviewHash: i.reviewHash,
          reference: outsideShipmentId,
          tracking: outsideTracking,
          label: { mediaType: "application/pdf", bytes: Buffer.from(pdf) },
        };
      },
      async lookup() {
        throw Error("no lookup");
      },
    });
  }
  assert.equal(calls, 3);
  if (options.hold !== false)
    f.app.platform.isolateRestore("a".repeat(64), "2026-10-03T00:00:00.000Z");
  return {
    ...f,
    originalFixture: f,
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
async function ready(
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
for (const currency of ["CAD", "USD"] as const)
  for (const reports of [false, true])
    test(`native import ${currency} reports=${reports}: pending bookings, exact one receipt, read-only recovery`, async (t) => {
      const f = await ready(t, currency, reports);
      const store = f.app.database.owned("integration"),
        before = store.all(
          "SELECT * FROM integration_carrier_bookings ORDER BY sequence",
        );
      const businessBefore = business(f);
      const receipt = f.apply();
      frozen(receipt);
      assert.equal(business(f), businessBefore);
      assert.equal(receipt.status, "native-owner-application-only");
      assert.deepEqual(
        store.all(
          "SELECT * FROM integration_carrier_bookings ORDER BY sequence",
        ),
        before,
      );
      const m = store.get(
        "SELECT * FROM integration_canada_post_members WHERE booking_id=?",
        f.bookingId,
      )!;
      assert.equal(m.state, "created");
      assert.equal(m.token, null);
      assert.equal(m.started_at, null);
      assert.equal(m.provider_shipment_id, proposal(f).providerShipmentId);
      assert.equal(m.tracking, proposal(f).tracking);
      assert.equal(m.label_hash, digest(f.pdf));
      assert.deepEqual(Buffer.from(m.label_bytes as Uint8Array), f.pdf);
      assert.equal(
        store.get(
          "SELECT state FROM integration_canada_post_groups WHERE id=?",
          f.groupId,
        )!.state,
        "closed",
      );
      const state = f.app.database.transaction(() =>
        f.app.platform.offline.readInTransaction(),
      )!;
      assert.equal(
        state.state.sessions
          .at(-1)!
          .history.filter((h) => h.kind === "record-task").length,
        1,
      );
      assert.equal(
        state.state.sessions.at(-1)!.history.at(-1)!.receipt!.binding,
        offlineTaskBinding(f.envelope),
      );
      const changesBefore = changes(f),
        recovered = f.recover(receipt);
      frozen(recovered);
      assert.equal(recovered.resultHash, receipt.resultHash);
      assert.equal(changes(f), changesBefore);
      assert.throws(() => f.apply());
      assert.equal(changes(f), changesBefore);
      const closed = f.app;
      closed.close();
      const app = new Application(f.path, undefined, { eventReports: reports });
      f.originalFixture.app = app;
      const restarted = new IntegrationOfflineCanadaPostMember(
        app.database,
        app.identity,
        app.platform,
        app.fulfillment,
        app.carriers,
      );
      const restartedResult = app.database.transaction(() =>
        restarted.recoverInTransaction(
          actor(f),
          f.envelope,
          structuredClone(receipt),
        ),
      );
      assert.equal(restartedResult.resultHash, receipt.resultHash);
    });
test("fake/disposed/foreign captures refused before actor proxy traversal", async (t) => {
  const f = await ready(t);
  let trapped = false;
  const hostile = new Proxy(
    {},
    {
      get() {
        trapped = true;
        throw Error("trap");
      },
      getPrototypeOf() {
        trapped = true;
        throw Error("trap");
      },
    },
  );
  const other = new IntegrationOfflineCanadaPostMember(
    f.app.database,
    f.app.identity,
    f.app.platform,
    f.app.fulfillment,
    f.app.carriers,
  );
  const pending = f.importer.read(f.envelope, f.manifest),
    disposed = f.capture();
  disposed.dispose();
  const valid = f.capture();
  const snap = f.snapshot();
  for (const value of [{}, hostile, disposed, pending])
    assert.throws(() =>
      f.app.database.transaction(() =>
        f.importer.applyInTransaction(hostile, value),
      ),
    );
  assert.throws(() =>
    f.app.database.transaction(() => other.applyInTransaction(hostile, valid)),
  );
  valid.dispose();
  pending.dispose();
  assert.equal(trapped, false);
  assert.equal(f.snapshot(), snap);
});
test("unknown objects and forged prototype owners cannot issue private owner captures", async (t) => {
  const f = await ready(t);
  let trap = false;
  const proxy = new Proxy(f.app.carriers, {
    get() {
      trap = true;
      throw Error("trap");
    },
  });
  for (const owner of [
    proxy,
    Object.assign(
      Object.create(Object.getPrototypeOf(f.app.carriers)),
      f.app.carriers,
    ),
  ])
    assert.throws(
      () =>
        new IntegrationOfflineCanadaPostMember(
          f.app.database,
          f.app.identity,
          f.app.platform,
          f.app.fulfillment,
          owner,
        ),
    );
  assert.equal(trap, false);
  let get = false;
  const h = f.capture();
  assert.throws(() =>
    f.app.database.transaction(() =>
      f.importer.applyInTransaction(
        {
          get id() {
            get = true;
            return f.actor.id;
          },
          orgId: f.actor.orgId,
        },
        h,
      ),
    ),
  );
  assert.equal(get, false);
});
for (const fault of [
  "audit",
  "event",
  "platform",
  "candidate",
  "dispose",
  "reentry",
] as const)
  test(`late ${fault} failure escapes and rolls back ALL native writes`, async (t) => {
    const f = await ready(t),
      h = f.capture(),
      snap = f.snapshot();
    let reached = false;
    if (fault === "audit" || fault === "event") {
      const name = fault,
        original = f.app.platform[name].bind(f.app.platform);
      t.mock.method(
        Object.getPrototypeOf(f.app.platform),
        name,
        (...args: any[]) => {
          Reflect.apply(original, undefined, args);
          if (args[1] === "carrier.canada-post.member.created") {
            reached = true;
            throw Error("synthetic late fault");
          }
        },
      );
    } else if (fault === "platform") {
      const original = f.app.platform.offline.transitionInTransaction.bind(
        f.app.platform.offline,
      );
      t.mock.method(
        Object.getPrototypeOf(f.app.platform.offline),
        "transitionInTransaction",
        (...args: Parameters<typeof original>) => {
          const r = original(...args);
          if ((args[2] as { kind: string }).kind === "record-task") {
            reached = true;
            throw Error("synthetic late receipt");
          }
          return r;
        },
      );
    } else if (fault === "candidate") {
      const original = f.app.database.captureRestoreCandidateInTransaction.bind(
        f.app.database,
      );
      t.mock.method(
        Object.getPrototypeOf(f.app.database),
        "captureRestoreCandidateInTransaction",
        () => {
          const r = original();
          if (
            f.app.database
              .owned("integration")
              .get(
                "SELECT state FROM integration_canada_post_members WHERE booking_id=?",
                f.bookingId,
              )!.state === "created"
          ) {
            reached = true;
            throw Error("synthetic late candidate");
          }
          return r;
        },
      );
    } else {
      const original = f.app.platform.audit.bind(f.app.platform);
      t.mock.method(
        Object.getPrototypeOf(f.app.platform),
        "audit",
        (...args: Parameters<typeof original>) => {
          original(...args);
          if (args[1] === "carrier.canada-post.member.created") {
            reached = true;
            if (fault === "dispose") h.dispose();
            else
              assert.throws(() => f.importer.applyInTransaction(actor(f), h));
          }
        },
      );
    }
    assert.throws(() =>
      f.app.database.transaction(() =>
        f.importer.applyInTransaction(actor(f), h),
      ),
    );
    t.mock.restoreAll();
    assert.ok(reached, "the injected late failure must actually execute");
    assert.equal(f.snapshot(), snap);
    assert.throws(() => h.reviewInTransaction(actor(f)));
  });
for (const kind of [
  "candidate",
  "hold",
  "claim",
  "state",
  "sibling",
  "reference",
  "site",
  "finance",
] as const)
  test(`current ${kind} drift refuses without owner changes`, async (t) => {
    const f = await ready(t),
      h = f.capture();
    if (kind === "candidate") f.envelope.candidate.logicalHash = "b".repeat(64); // capture already detached; mutate actual native candidate below
    f.app.database.transaction(() => {
      const integration = f.app.database.owned("integration"),
        iam = f.app.database.owned("iam");
      if (kind === "claim")
        integration.run(
          "UPDATE integration_canada_post_members SET token='claim',started_at=1 WHERE booking_id=?",
          f.bookingId,
        );
      else if (kind === "state")
        integration.run(
          "UPDATE integration_canada_post_members SET state='creating' WHERE booking_id=?",
          f.bookingId,
        );
      else if (kind === "sibling")
        integration.run(
          "UPDATE integration_canada_post_members SET tracking='7777777777777' WHERE booking_id=?",
          f.createdId,
        );
      else if (kind === "reference")
        integration.run(
          "UPDATE integration_canada_post_members SET tracking=? WHERE booking_id=?",
          proposal(f).tracking,
          f.entries[2]!.bookingId,
        );
      else if (kind === "hold")
        f.app.database
          .owned("platform")
          .run("UPDATE platform_recovery SET snapshot_hash=?", "b".repeat(64));
      else if (kind === "finance")
        iam.run(
          "UPDATE iam_users SET role=? WHERE id=?",
          "warehouse",
          f.actor.id,
        );
      else if (kind === "site")
        iam.run(
          "UPDATE iam_users SET sites=? WHERE id=?",
          JSON.stringify([f.w2]),
          f.actor.id,
        );
      else
        integration.run(
          "UPDATE integration_canada_post_groups SET created_at='2026-10-02T00:00:00.000Z' WHERE id=?",
          f.outside!.id,
        );
    });
    const snap = f.snapshot();
    assert.throws(() =>
      f.app.database.transaction(() =>
        f.importer.applyInTransaction(actor(f), h),
      ),
    );
    assert.equal(f.snapshot(), snap);
  });
test("missing or changed independent original proof cannot be recovered or reconstructed", async (t) => {
  const f = await ready(t),
    r = f.apply(),
    before = changes(f);
  for (const v of [
    undefined,
    null,
    {},
    { ...r, resultHash: "a".repeat(64) },
    { ...r, record: { ...r.record, inputHash: "a".repeat(64) } },
  ])
    assert.throws(() => f.recover(v));
  const changed = structuredClone(f.envelope);
  changed.evidence.qualificationHash = "b".repeat(64);
  assert.throws(() =>
    f.app.database.transaction(() =>
      f.importer.recoverInTransaction(actor(f), changed, r),
    ),
  );
  assert.equal(changes(f), before);
  assert.equal(f.recover(r).resultHash, r.resultHash);
});
test("no outer writer and non-OPEN retained state refuse before mutation", async (t) => {
  const f = await ready(t),
    h = f.capture();
  assert.throws(() => f.importer.applyInTransaction(actor(f), h));
  h.dispose();
  f.app.database.transaction(() => {
    const s = f.app.platform.offline.readInTransaction()!;
    f.app.platform.offline.transitionInTransaction(
      s.state.generation,
      s.anchor,
      { kind: "drain" },
      [],
    );
  });
  f.refresh();
  const snap = f.snapshot();
  assert.throws(() => f.apply());
  assert.equal(f.snapshot(), snap);
});
test("private file change after streaming before completion refuses and disposes", async (t) => {
  const f = await ready(t),
    h = f.importer.read(f.envelope, f.manifest),
    snap = f.snapshot();
  fs.appendFileSync(f.file, " ");
  assert.throws(() => h.complete());
  assert.throws(() =>
    f.app.database.transaction(() =>
      f.importer.applyInTransaction(actor(f), h),
    ),
  );
  assert.equal(f.snapshot(), snap);
});
for (const failure of [false, true])
  test(`owned private allocations erased and never reopened, failure=${failure}`, async (t) => {
    const f = await ready(t),
      allocations: Buffer[] = [],
      decoded: Buffer[] = [],
      copies: Buffer[] = [];
    const alloc = Buffer.alloc,
      from = Buffer.from;
    t.mock.method(Buffer, "alloc", (...args: Parameters<typeof alloc>) => {
      const b = alloc(...args);
      allocations.push(b);
      return b;
    });
    t.mock.method(Buffer, "from", (...args: unknown[]) => {
      const b = Reflect.apply(from, Buffer, args) as Buffer;
      if (args[1] === "base64") decoded.push(b);
      if (args[0] instanceof Uint8Array && decoded.includes(args[0] as Buffer))
        copies.push(b);
      return b;
    });
    const h = f.capture();
    fs.unlinkSync(f.file);
    if (failure) {
      const original = f.app.platform.audit.bind(f.app.platform);
      t.mock.method(
        Object.getPrototypeOf(f.app.platform),
        "audit",
        (...args: Parameters<typeof original>) => {
          original(...args);
          if (args[1] === "carrier.canada-post.member.created")
            throw Error("erase on rollback");
        },
      );
      assert.throws(() =>
        f.app.database.transaction(() =>
          f.importer.applyInTransaction(actor(f), h),
        ),
      );
    } else {
      const receipt = f.app.database.transaction(() =>
        f.importer.applyInTransaction(actor(f), h),
      );
      assert.equal(f.recover(receipt).resultHash, receipt.resultHash);
    }
    assert.ok(
      allocations.length > 0 && decoded.length > 0 && copies.length > 0,
    );
    for (const b of [...allocations, ...decoded, ...copies])
      assert.ok(
        b.every((v) => v === 0),
        "every captured, decoded and validator-owned buffer is erased",
      );
    assert.throws(() => h.complete());
    assert.throws(() =>
      f.app.database.transaction(() =>
        f.importer.applyInTransaction(actor(f), h),
      ),
    );
  });
test("scope bounds refuse before unbounded native row materialization", async (t) => {
  const f = await ready(t),
    h = f.capture();
  f.app.database
    .owned("integration")
    .run(
      "UPDATE integration_carrier_bookings SET intent=? WHERE id=?",
      "x".repeat(65537),
      f.entries[2]!.bookingId,
    );
  const before = changes(f);
  assert.throws(() =>
    f.app.database.transaction(() =>
      f.importer.applyInTransaction(actor(f), h),
    ),
  );
  assert.equal(changes(f), before);
});
test("exact original receipt refuses later sibling changes", async (t) => {
  const f = await ready(t),
    r = f.apply();
  f.app.database
    .owned("integration")
    .run(
      "UPDATE integration_canada_post_members SET tracking='7777777777777' WHERE booking_id=?",
      f.createdId,
    );
  const before = changes(f);
  assert.throws(() => f.recover(r));
  assert.equal(changes(f), before);
});
test("later actor active revocation refuses exact historical recovery", async (t) => {
  const f = await ready(t),
    r = f.apply();
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET active=0 WHERE id=?", f.actor.id);
  const before = changes(f);
  assert.throws(() => f.recover(r));
  assert.equal(changes(f), before);
});
test("both native role duties remain required; finance-only and warehouse-only do not gain a grant", async (t) => {
  for (const role of ["finance", "warehouse"]) {
    const f = await ready(t),
      h = f.capture();
    f.app.database
      .owned("iam")
      .run("UPDATE iam_users SET role=? WHERE id=?", role, f.actor.id);
    const snap = f.snapshot();
    assert.throws(() =>
      f.app.database.transaction(() =>
        f.importer.applyInTransaction(actor(f), h),
      ),
    );
    assert.equal(f.snapshot(), snap);
  }
});
test("same-read input remains detached and another capture cannot replay an already imported target", async (t) => {
  const f = await ready(t),
    one = f.capture(),
    two = f.capture(),
    originalEnvelope = structuredClone(f.envelope);
  f.input.members[0].tracking = "0000000000000";
  f.envelope.task.subjectId = "changed";
  f.manifest.root = "/untrusted";
  const receipt = f.app.database.transaction(() =>
    f.importer.applyInTransaction(actor(f), one),
  );
  assert.equal(receipt.record.binding, offlineTaskBinding(originalEnvelope));
  const before = changes(f);
  assert.throws(() =>
    f.app.database.transaction(() =>
      f.importer.applyInTransaction(actor(f), two),
    ),
  );
  assert.equal(changes(f), before);
});
function business(f: F) {
  return canonical(
    [
      "billing",
      "inventory",
      "fulfillment",
      "orders",
      "procurement",
      "warranty",
      "iam",
    ].map((owner) => {
      const s = f.app.database.owned(
        owner as import("../src/server/database.ts").Owner,
      );
      return s
        .all<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE ? ORDER BY name",
          owner + "_%",
        )
        .map(({ name }) => [name, s.all(`SELECT * FROM ${name}`)]);
    }),
  );
}
for (const drift of ["platform", "password", "file"] as const)
  test(`read-only exact recovery rejects ${drift} drift`, async (t) => {
    const f = await ready(t),
      r = f.apply();
    if (drift === "platform")
      f.app.platform.audit(
        f.actor,
        "carrier.canada-post.member.claimed",
        f.groupId,
        {
          bookingId: f.bookingId,
          reviewHash: f.entries[1]!.reviewHash,
          send: false,
        },
      );
    else if (drift === "password")
      f.app.database
        .owned("iam")
        .run(
          "INSERT INTO iam_user_security(user_id,password_change_required,revision,updated_at) VALUES(?,1,1,'2026-10-03T00:00:00.000Z') ON CONFLICT(user_id) DO UPDATE SET password_change_required=1",
          f.actor.id,
        );
    else {
      fs.renameSync(f.path, f.path + "-old");
      fs.copyFileSync(f.path + "-old", f.path);
      fs.chmodSync(f.path, 0o600);
    }
    const before = changes(f);
    assert.throws(() => f.recover(r));
    assert.equal(changes(f), before);
  });
test("fake independent proof proxies and accessors execute no traps", async (t) => {
  const f = await ready(t),
    r = f.apply();
  let trap = false;
  const proxy = new Proxy(r, {
    get() {
      trap = true;
      throw Error("get");
    },
    getPrototypeOf() {
      trap = true;
      throw Error("proto");
    },
    ownKeys() {
      trap = true;
      throw Error("keys");
    },
  });
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  for (const v of [
    proxy,
    revoked.proxy,
    {
      get record() {
        trap = true;
        return r.record;
      },
    },
  ])
    assert.throws(() => f.recover(v));
  assert.equal(trap, false);
});
test("late actual sibling corruption is detected by the exact original row comparison and rolled back", async (t) => {
  const f = await ready(t),
    h = f.capture(),
    snap = f.snapshot();
  let reached = false;
  const original = f.app.platform.audit.bind(f.app.platform);
  t.mock.method(
    Object.getPrototypeOf(f.app.platform),
    "audit",
    (...args: Parameters<typeof original>) => {
      original(...args);
      if (args[1] === "carrier.canada-post.member.created") {
        reached = true;
        f.app.database
          .owned("integration")
          .run(
            "UPDATE integration_canada_post_members SET tracking='7777777777777' WHERE booking_id=?",
            f.createdId,
          );
      }
    },
  );
  assert.throws(() =>
    f.app.database.transaction(() =>
      f.importer.applyInTransaction(actor(f), h),
    ),
  );
  assert.equal(reached, true);
  t.mock.restoreAll();
  assert.equal(f.snapshot(), snap);
});
test("wrapper refusal without a writer consumes and erases its completed private capture", async (t) => {
  const f = await ready(t),
    h = f.capture();
  assert.throws(() => f.importer.applyInTransaction(actor(f), h));
  assert.throws(
    () => f.app.database.transaction(() => h.reviewInTransaction(actor(f))),
    "a refused application must not leave a reusable completed private capture",
  );
});
