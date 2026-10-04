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
function tracked(t: TestContext) {
  const allocations: Buffer[] = [],
    decoded: Buffer[] = [],
    opened: number[] = [],
    closed: number[] = [];
  const alloc = Buffer.alloc,
    from = Buffer.from,
    open = fs.openSync,
    close = fs.closeSync;
  t.mock.method(Buffer, "alloc", (...args: Parameters<typeof Buffer.alloc>) => {
    const b = alloc(...args);
    allocations.push(b);
    return b;
  });
  t.mock.method(Buffer, "from", (...args: unknown[]) => {
    const b = Reflect.apply(from, Buffer, args) as Buffer;
    if (args[1] === "base64") decoded.push(b);
    return b;
  });
  t.mock.method(fs, "openSync", (...args: Parameters<typeof fs.openSync>) => {
    const fd = open(...args);
    opened.push(fd);
    return fd;
  });
  t.mock.method(fs, "closeSync", (fd: number) => {
    closed.push(fd);
    return close(fd);
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return { allocations, decoded, opened, closed };
}
for (const currency of ["CAD", "USD"] as const)
  for (const reports of [false, true])
    test(`actual CA/${currency}, reports=${reports}: canonical private bytes plus complete native joins, no writes`, async (t) => {
      const f = await setup(t, currency, reports),
        before = changes(f),
        io = tracked(t),
        handle = f.read();
      assert.equal(io.opened.length, 1);
      assert.deepEqual(io.closed, io.opened);
      const summary = handle.complete();
      assert.equal(summary.qualification, "unverified");
      fs.unlinkSync(f.file); // Already completed capture must not reopen the report.
      const result = f.app.database.transaction(() =>
        handle.reviewInTransaction(actor(f)),
      );
      assert.ok(isCapturedCanadaPostNativeJoin(result));
      assert.equal(
        isCapturedCanadaPostNativeJoin(structuredClone(result)),
        false,
      );
      assert.equal(result.comparison.inputHash, compare(f.input).inputHash);
      frozen(result);
      assert.equal(changes(f), before);
      assert.equal(io.opened.length, 1);
      assert.ok(
        io.allocations
          .filter((b) => b.length === f.bytes.length)
          .every((b) => b.every((n) => n === 0)),
      );
      assert.ok(io.decoded.length > 0);
      assert.ok(io.decoded.every((b) => b.every((n) => n === 0)));
      assert.throws(() => handle.complete(), refusal);
      assert.throws(() => handle.reviewInTransaction(actor(f)), refusal);
      handle.dispose();
      assert.ok(
        result.requiredChecks.includes(
          "qualified-source-candidate-fences-through-commit",
        ),
      );
    });

test("fixed constructor rejects ports, proxy owners and different native databases before envelope traversal", async (t) => {
  const f = await setup(t),
    other = await nativeSetup(t);
  let trap = false;
  const proxy = new Proxy(f.app.database, {
    get() {
      trap = true;
      throw Error("trap");
    },
    getPrototypeOf() {
      trap = true;
      throw Error("trap");
    },
  });
  assert.throws(
    () =>
      new RestoreOfflineCanadaPostPrivateEvidence(
        proxy,
        f.app.identity,
        f.app.platform,
        f.app.fulfillment,
      ),
  );
  assert.equal(trap, false);
  assert.throws(
    () =>
      new RestoreOfflineCanadaPostPrivateEvidence(
        f.app.database,
        other.app.identity,
        f.app.platform,
        f.app.fulfillment,
      ),
  );
  assert.throws(
    () =>
      new RestoreOfflineCanadaPostPrivateEvidence(
        f.app.database,
        f.app.identity,
        f.app.platform,
        other.app.fulfillment,
      ),
  );
  const native = new RestoreOfflineCanadaPostNativeJoin(
    f.app.database,
    f.app.identity,
    f.app.platform,
    f.app.fulfillment,
  );
  const hostile = new Proxy(
    {},
    {
      get() {
        trap = true;
        throw Error("trap");
      },
      ownKeys() {
        trap = true;
        throw Error("trap");
      },
      getPrototypeOf() {
        trap = true;
        throw Error("trap");
      },
    },
  );
  assert.throws(
    () =>
      native.joinCapturedInTransaction(
        hostile,
        hostile,
        hostile as any,
        hostile,
      ),
    { code: "RESTORE_OFFLINE_CANADA_POST_NATIVE" },
  );
  assert.equal(trap, false);
  assert.equal(isCapturedCanadaPostNativeJoin(hostile), false);
  assert.equal(trap, false);
});

test("pending, disposed and repeated lifecycle calls fail and erase owned bytes", async (t) => {
  const f = await setup(t),
    io = tracked(t);
  for (const mode of ["pending", "disposed", "completed-disposed"]) {
    const h = f.read();
    if (mode === "completed-disposed") h.complete();
    if (mode !== "pending") h.dispose();
    assert.throws(
      () => f.app.database.transaction(() => h.reviewInTransaction(actor(f))),
      refusal,
    );
    assert.throws(() => h.complete(), refusal);
  }
  assert.ok(
    io.allocations
      .filter((b) => b.length === f.bytes.length)
      .every((b) => b.every((x) => x === 0)),
  );
  assert.deepEqual(io.opened, io.closed);
});

test("private file replacement, directory replacement, symlink/hardlink/permissions and interrupted read fail closed", async (t) => {
  for (const change of ["replace", "parent", "symlink", "hardlink", "mode"]) {
    await t.test(change, async (t) => {
      const f = await setup(t),
        io = tracked(t),
        h = f.read();
      if (change === "replace") {
        fs.renameSync(f.file, f.file + ".old");
        fs.writeFileSync(f.file, f.bytes, { mode: 0o600 });
      }
      if (change === "parent") {
        fs.renameSync(f.root, f.root + "-old");
        fs.mkdirSync(f.root, { mode: 0o700 });
        fs.writeFileSync(f.file, f.bytes, { mode: 0o600 });
        t.after(() =>
          fs.rmSync(f.root + "-old", { recursive: true, force: true }),
        );
      }
      if (change === "symlink") {
        fs.renameSync(f.file, f.file + ".old");
        fs.symlinkSync(f.file + ".old", f.file);
      }
      if (change === "hardlink") fs.linkSync(f.file, f.file + ".link");
      if (change === "mode") fs.chmodSync(f.file, 0o644);
      assert.throws(() => h.complete(), refusal);
      assert.ok(
        io.allocations
          .filter((b) => b.length === f.bytes.length)
          .every((b) => b.every((x) => x === 0)),
      );
      assert.deepEqual(io.opened, io.closed);
    });
  }
  const f = await setup(t),
    io = tracked(t),
    read = fs.readSync;
  let once = false;
  t.mock.method(fs, "readSync", ((...args: any[]) => {
    if (!once) {
      once = true;
      throw Object.assign(Error("private path"), { code: "EINTR" });
    }
    return Reflect.apply(read, fs, args);
  }) as typeof fs.readSync);
  syncBuiltinESMExports();
  assert.throws(() => f.read(), refusal);
  assert.deepEqual(io.opened, io.closed);
  assert.ok(io.allocations.every((b) => b.every((x) => x === 0)));
});

test("fixed evidence-set and task profile reject wrong hashes, sizes, extra/orphan files and unbound payload", async (t) => {
  const f = await setup(t);
  const cases: [string, (e: any, m: any) => void][] = [
    ["task", (e) => (e.task.name = "other.import")],
    ["owner", (e) => (e.task.owner = "billing")],
    ["version", (e) => (e.task.version = 2)],
    [
      "extra evidence",
      (e) => {
        e.evidence.items.push({ ...e.evidence.items[0], reference: "other" });
        e.evidence.setHash = digest(canonical(e.evidence.items));
      },
    ],
    [
      "extra manifest",
      (_e, m) => m.files.push({ reference: "orphan", path: "orphan" }),
    ],
    ["foreign ref", (_e, m) => (m.files[0].reference = "other")],
    [
      "bytes",
      (e) => {
        e.evidence.items[0].bytes++;
        e.evidence.setHash = digest(canonical(e.evidence.items));
      },
    ],
    [
      "hash",
      (e) => {
        e.evidence.items[0].sha256 = "f".repeat(64);
        e.evidence.setHash = digest(canonical(e.evidence.items));
      },
    ],
    ["sethash", (e) => (e.evidence.setHash = "f".repeat(64))],
    [
      "too large",
      (e) => {
        e.evidence.items[0].bytes = canadaPostPrivateEvidenceBytes + 1;
        e.evidence.setHash = digest(canonical(e.evidence.items));
      },
    ],
    ["path traversal", (_e, m) => (m.files[0].path = "../report.json")],
  ];
  for (const [name, change] of cases)
    await t.test(name, () => {
      const e = structuredClone(f.envelope),
        m = structuredClone(f.manifest);
      change(e, m);
      assert.throws(() => {
        const h = f.r.read(e, m);
        try {
          h.complete();
        } finally {
          h.dispose();
        }
      }, refusal);
    });
  f.envelope.task.payloadHash = "f".repeat(64);
  assert.throws(() => f.run(), refusal);
});

test("strict private JSON refuses alternative encoding, duplicate keys, malformed UTF8/BOM and resource excess", async (t) => {
  const f = await setup(t);
  const cases: [string, Buffer][] = [
    ["pretty", Buffer.from(JSON.stringify(f.input, null, 2))],
    ["newline", Buffer.from(json(f.input) + "\n")],
    [
      "duplicate",
      Buffer.from(
        json(f.input).replace('"version":1', '"version":1,"version":1'),
      ),
    ],
    ["BOM", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), f.bytes])],
    ["invalid UTF8", Buffer.from([0xc3, 0x28])],
    ["lone surrogate", Buffer.from('{"bad":"\\ud800"}')],
    ["wide array", Buffer.from(json({ a: Array(4001).fill(null) }))],
    ["negative zero", Buffer.from('{"a":-0}')],
    ["overflow", Buffer.from('{"a":1e999}')],
    [
      "oversize scalar",
      Buffer.from(json({ a: "x".repeat(limits.string + 1) })),
    ],
    ["depth", Buffer.from("[".repeat(26) + "null" + "]".repeat(26))],
  ];
  for (const [name, bytes] of cases)
    await t.test(name, () => {
      f.write(bytes);
      assert.throws(() => f.run(), refusal);
    });
  f.write();
  assert.ok(f.run());
});

test("current native writer, scoped IAM/password and hold are reread after byte completion", async (t) => {
  const f = await setup(t),
    iam = f.app.database.owned("iam");
  {
    const h = f.read();
    h.complete();
    assert.throws(() => h.reviewInTransaction(actor(f)), refusal);
  }
  for (const assignment of [
    "active=0",
    "role='finance'",
    "org_id='foreign'",
    "role='warehouse',sites='[]'",
  ]) {
    const h = f.read();
    h.complete();
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          iam.run(`UPDATE iam_users SET ${assignment} WHERE id=?`, f.actor.id);
          h.reviewInTransaction(actor(f));
        }),
      refusal,
    );
  }
  for (const mode of ["password", "hold"]) {
    const h = f.read();
    h.complete();
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          if (mode === "password")
            iam.run(
              "INSERT INTO iam_user_security(user_id,revision,password_change_required,updated_at) VALUES(?,1,1,'2026-10-03T00:00:00.000Z')",
              f.actor.id,
            );
          else
            f.app.database
              .owned("platform")
              .run("DELETE FROM platform_recovery");
          h.reviewInTransaction(actor(f));
        }),
      refusal,
    );
  }
  assert.ok(f.run());
});

test("complete recapture refuses stale sibling/custody/Platform history even with fresh candidate envelope", async (t) => {
  for (const kind of [
    "sibling",
    "platform",
    "custody",
    "outside-conflict",
    "orphan",
  ]) {
    await t.test(kind, async (t) => {
      const f = await setup(t);
      const before = f.app.database.transaction(() =>
        f.app.database.captureRestoreCandidateInTransaction(),
      );
      assert.throws(
        () =>
          f.app.database.transaction(() => {
            if (kind === "sibling")
              f.app.database
                .owned("integration")
                .run(
                  "UPDATE integration_canada_post_members SET tracking='7777777777777777' WHERE booking_id=?",
                  f.createdId,
                );
            if (kind === "platform")
              f.app.platform.audit(
                f.actor,
                "carrier.canada-post.member.claimed",
                f.outside!.id,
                {
                  bookingId: f.entries[2]!.bookingId,
                  reviewHash: f.entries[2]!.reviewHash,
                  send: false,
                },
              );
            if (kind === "custody")
              f.app.database
                .owned("fulfillment")
                .run(
                  "UPDATE fulfillment_shipments SET address='Changed custody' WHERE id=?",
                  f.input.custody[0].shipment.id,
                );
            if (kind === "outside-conflict")
              f.app.database
                .owned("integration")
                .run(
                  "UPDATE integration_canada_post_members SET tracking=? WHERE group_id=?",
                  proposal(f).tracking,
                  f.outside!.id,
                );
            if (kind === "orphan")
              f.app.database
                .owned("integration")
                .run(
                  "UPDATE integration_canada_post_members SET org_id='foreign' WHERE group_id=?",
                  f.outside!.id,
                );
            f.envelope.candidate.logicalHash =
              f.app.database.captureRestoreCandidateInTransaction().logicalHash;
            const h = f.read();
            h.complete();
            h.reviewInTransaction(actor(f));
          }),
        refusal,
      );
      f.envelope.candidate.logicalHash = before.logicalHash;
      assert.ok(f.run());
    });
  }
});

test("actor/envelope/manifest proxies and getters never execute; copied native capture brand fails first", async (t) => {
  const f = await setup(t);
  let called = false;
  const proxy = new Proxy(
    {},
    {
      get() {
        called = true;
        throw Error("trap");
      },
      ownKeys() {
        called = true;
        throw Error("trap");
      },
      getPrototypeOf() {
        called = true;
        throw Error("trap");
      },
    },
  );
  const rev = Proxy.revocable([], {});
  rev.revoke();
  for (const bad of [
    proxy,
    rev.proxy,
    Object.defineProperty({}, "id", {
      enumerable: true,
      get() {
        called = true;
        return f.actor.id;
      },
    }),
  ]) {
    assert.throws(() => f.r.read(bad, f.manifest), refusal);
    assert.throws(() => f.r.read(f.envelope, bad), refusal);
    const h = f.read();
    h.complete();
    assert.throws(
      () => f.app.database.transaction(() => h.reviewInTransaction(bad)),
      refusal,
    );
  }
  assert.equal(called, false);
  const h = f.read();
  h.complete();
  assert.throws(
    () =>
      f.app.database.transaction(() =>
        h.reviewInTransaction({ ...actor(f), role: "admin" }),
      ),
    refusal,
  );
});

test("replacement candidate pathname and wrong candidate/hold/task bindings refuse", async (t) => {
  const f = await setup(t);
  for (const change of [
    (e: any) => e.candidate.file.ino++,
    (e: any) => (e.candidate.logicalHash = "b".repeat(64)),
    (e: any) => (e.recovery.snapshotHash = "b".repeat(64)),
    (e: any) => (e.task.expectedRevision = 1),
    (e: any) => (e.task.siteIds = [f.w2]),
    (e: any) => (e.task.subjectId = f.createdId),
  ]) {
    const e = structuredClone(f.envelope);
    change(e);
    const h = f.r.read(e, f.manifest);
    h.complete();
    assert.throws(
      () => f.app.database.transaction(() => h.reviewInTransaction(actor(f))),
      refusal,
    );
  }
  const h = f.read();
  h.complete();
  fs.renameSync(f.path, f.path + ".old");
  fs.copyFileSync(f.path + ".old", f.path);
  fs.chmodSync(f.path, 0o600);
  try {
    assert.throws(
      () => f.app.database.transaction(() => h.reviewInTransaction(actor(f))),
      refusal,
    );
  } finally {
    fs.unlinkSync(f.path);
    fs.renameSync(f.path + ".old", f.path);
  }
});

test("reentry during private streaming poisons the outer capture rather than releasing a usable handle", async (t) => {
  const f = await setup(t),
    io = tracked(t),
    read = fs.readSync;
  let entered = false;
  t.mock.method(fs, "readSync", ((...args: any[]) => {
    if (!entered) {
      entered = true;
      assert.throws(() => f.read(), refusal);
    }
    return Reflect.apply(read, fs, args);
  }) as typeof fs.readSync);
  syncBuiltinESMExports();
  assert.throws(() => f.read(), refusal);
  assert.ok(
    io.allocations
      .filter((b) => b.length === f.bytes.length)
      .every((b) => b.every((x) => x === 0)),
  );
  assert.deepEqual(io.opened, io.closed);
});

test("disposal during native capture cannot return a stale joined result", async (t) => {
  const f = await setup(t),
    h = f.read();
  h.complete();
  const stat = fs.lstatSync;
  let disposed = false;
  t.mock.method(fs, "lstatSync", ((...args: any[]) => {
    if (!disposed && args[0] === f.path) {
      disposed = true;
      h.dispose();
    }
    return Reflect.apply(stat, fs, args);
  }) as typeof fs.lstatSync);
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  assert.throws(
    () => f.app.database.transaction(() => h.reviewInTransaction(actor(f))),
    refusal,
  );
});

test("native restart retains exact joins; copied result loses process provenance and old handle is one-shot", async (t) => {
  const f = await setup(t),
    result = f.run();
  f.app.close();
  f.app = new Application(f.path, f.region, { eventReports: f.reports });
  f.originalFixture.app = f.app;
  const r = reader(f),
    h = r.read(f.envelope, f.manifest);
  h.complete();
  const next = f.app.database.transaction(() =>
    h.reviewInTransaction(actor(f)),
  );
  assert.deepEqual(next, result);
  assert.ok(isCapturedCanadaPostNativeJoin(next));
  assert.equal(isCapturedCanadaPostNativeJoin(structuredClone(next)), false);
});

test("fresh candidate binding cannot bypass current scoped role/site/password or cross-org authority", async (t) => {
  const f = await setup(t),
    before = f.envelope.candidate.logicalHash;
  for (const change of [
    "active=0",
    "role='finance'",
    "role='warehouse',sites='[]'",
    "password",
  ]) {
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          const iam = f.app.database.owned("iam");
          if (change === "password")
            iam.run(
              "INSERT INTO iam_user_security(user_id,revision,password_change_required,updated_at) VALUES(?,1,1,'2026-10-03T00:00:00.000Z')",
              f.actor.id,
            );
          else iam.run(`UPDATE iam_users SET ${change} WHERE id=?`, f.actor.id);
          f.envelope.candidate.logicalHash =
            f.app.database.captureRestoreCandidateInTransaction().logicalHash;
          const h = f.read();
          h.complete();
          h.reviewInTransaction(actor(f));
        }),
      refusal,
    );
    f.envelope.candidate.logicalHash = before;
  }
  for (const locator of [
    { id: f.actor.id, orgId: "foreign" },
    { id: "unavailable", orgId: f.actor.orgId },
  ]) {
    const h = f.read();
    h.complete();
    assert.throws(
      () => f.app.database.transaction(() => h.reviewInTransaction(locator)),
      refusal,
    );
  }
  assert.equal(
    f.app.database.transaction(
      () => f.app.database.captureRestoreCandidateInTransaction().logicalHash,
    ),
    before,
  );
  assert.ok(f.run());
});

test("an owner SQL visit cannot substitute for the actual outer native writer", async (t) => {
  const f = await setup(t),
    h = f.read();
  h.complete();
  assert.throws(
    () =>
      f.app.database.transaction(() =>
        f.app.database
          .owned("integration")
          .visit("SELECT 1 AS n", [], () => h.reviewInTransaction(actor(f))),
      ),
    refusal,
  );
  assert.ok(f.run());
});

test("complete detects directory drift and reentrant disposal without leaving captured bytes", async (t) => {
  const f = await setup(t),
    io = tracked(t),
    h = f.read(),
    stat = fs.lstatSync;
  let disposed = false;
  t.mock.method(fs, "lstatSync", ((...args: any[]) => {
    if (!disposed && args[0] === f.root) {
      disposed = true;
      h.dispose();
    }
    return Reflect.apply(stat, fs, args);
  }) as typeof fs.lstatSync);
  syncBuiltinESMExports();
  assert.throws(() => h.complete(), refusal);
  assert.ok(
    io.allocations
      .filter((b) => b.length === f.bytes.length)
      .every((b) => b.every((x) => x === 0)),
  );
});

test("tampered coherent copied projections are rejected by full native recapture", async (t) => {
  const f = await setup(t),
    base = structuredClone(f.input);
  // A coherent copied raw hold is accepted by the pure comparator, but it is
  // not the actual current owner projection. Matching caller hashes add no trust.
  f.input.native.hold.snapshot_hash = "b".repeat(64);
  f.input.proposedReferences.hold.snapshot_hash = "b".repeat(64);
  const rehash = (v: any, key: string) => {
    const { [key]: _, ...body } = v;
    v[key] = digest(canonical(body));
  };
  rehash(f.input.native, "reviewHash");
  f.input.proposedReferences.memberReviewHash = f.input.native.reviewHash;
  rehash(f.input.proposedReferences, "reviewHash");
  assert.ok(compare(f.input));
  f.envelope.task.expectedStateHash = f.input.native.reviewHash;
  f.envelope.task.payloadHash = digest(canonical(f.input));
  f.write(Buffer.from(json(f.input)));
  assert.throws(() => f.run(), refusal);
  assert.deepEqual(inputs(f), base);
});
