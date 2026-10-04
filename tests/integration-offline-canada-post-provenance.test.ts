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
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { Store } from "../src/server/database.ts";
import type { Row } from "../src/server/core.ts";
import { createBackup, restoreBackup } from "../src/server/recovery.ts";
const table = "integration_offline_canada_post_members";
type Prepared = Awaited<ReturnType<typeof ready>>;
function retained(f: Prepared, input: unknown = f.envelope) {
  return f.app.database.transaction(() =>
    f.importer.recoverRetainedInTransaction(actor(f), input),
  );
}
// Synthetic corruption only: restore exact DDL so readers must detect the data defect.
function tamper(f: Prepared, sql: string, ...args: SQLInputValue[]) {
  const db = new DatabaseSync(f.path);
  try {
    const triggers = db
      .prepare(
        "SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name=?",
      )
      .all(table);
    db.exec(
      "PRAGMA foreign_keys=OFF; PRAGMA ignore_check_constraints=ON; BEGIN",
    );
    for (const trigger of triggers) db.exec(`DROP TRIGGER "${trigger.name}"`);
    db.prepare(sql).run(...args);
    for (const trigger of triggers) db.exec(String(trigger.sql));
    db.exec("COMMIT");
  } finally {
    db.close();
  }
}
function rawSnapshot(f: Prepared) {
  return canonical(
    (["integration", "platform"] as const).map((owner) => {
      const s = f.app.database.owned(owner);
      return s
        .all<{ name: string }>(
          "SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE ? ORDER BY name",
          owner + "_%",
        )
        .map(({ name }) => [
          name,
          s.all(`SELECT * FROM ${name} ORDER BY rowid`),
        ]);
    }),
  );
}
function store(f: Prepared) {
  return f.app.database.owned("integration");
}
for (const currency of ["CAD", "USD"] as const)
  for (const reports of [false, true])
    test(`${currency} reports=${reports}: exact original durable bytes, no private host/preimage on restart, zero writes`, async (t) => {
      const f = await ready(t, currency, reports),
        applied = f.apply();
      const row = store(f).get(`SELECT * FROM ${table}`)!;
      assert.equal(row.envelope, canonical(f.envelope));
      assert.equal(row.envelope_hash, digest(canonical(f.envelope)));
      assert.equal(row.record, canonical(applied.record));
      assert.equal(row.record_hash, applied.resultHash);
      assert.equal(row.booking_id, f.bookingId);
      assert.equal(row.group_id, f.groupId);
      assert.equal(row.org_id, f.actor.orgId);
      assert.equal(row.request_id, f.envelope.requestId);
      assert.equal(row.binding, offlineTaskBinding(f.envelope));
      const snapshot = f.snapshot();
      fs.rmSync(f.root, { recursive: true, force: true });
      f.app.close();
      const app = new Application(f.path, undefined, { eventReports: reports });
      f.originalFixture.app = app;
      const importer = new IntegrationOfflineCanadaPostMember(
        app.database,
        app.identity,
        app.platform,
        app.fulfillment,
        app.carriers,
      );
      const before = app.database
        .owned("integration")
        .get("SELECT total_changes() AS n")!.n;
      const recovered = app.database.transaction(() =>
        importer.recoverRetainedInTransaction(actor(f), f.envelope),
      );
      frozen(recovered);
      assert.deepEqual(recovered.record, applied.record);
      assert.equal(recovered.resultHash, applied.resultHash);
      assert.deepEqual(recovered.result, applied.record.result);
      assert.equal(
        app.database.owned("integration").get("SELECT total_changes() AS n")!.n,
        before,
      );
      assert.equal(
        app.database.transaction(() =>
          canonical({
            candidate: app.database.captureRestoreCandidateInTransaction(),
            offline: app.platform.offline.readInTransaction(),
          }),
        ),
        snapshot,
      );
    });
for (const mutation of ["UPDATE", "DELETE", "REPLACE"])
  test(`native immutable ${mutation} across independent connections/reopen`, async (t) => {
    const f = await ready(t);
    f.apply();
    const before = f.snapshot();
    const sql =
      mutation === "UPDATE"
        ? `UPDATE ${table} SET record=record`
        : mutation === "DELETE"
          ? `DELETE FROM ${table}`
          : `INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`;
    const second = new Application(f.path, undefined, { eventReports: false });
    try {
      for (const app of [f.app, second])
        assert.throws(
          () =>
            app.database.transaction(() =>
              app.database.owned("integration").run(sql),
            ),
          /append-only/,
        );
    } finally {
      second.close();
    }
    assert.equal(f.snapshot(), before);
    assert.doesNotThrow(() => retained(f));
  });
test("native foreign owner writes and FK orphans refuse", async (t) => {
  const f = await ready(t);
  f.apply();
  const before = f.snapshot();
  assert.throws(() =>
    f.app.database.transaction(() =>
      f.app.database.owned("platform").run(`DELETE FROM ${table}`),
    ),
  );
  assert.throws(
    () =>
      f.app.database.transaction(() =>
        store(f).run(
          `INSERT INTO ${table} SELECT 'orphan',group_id,org_id,'other',?,envelope,envelope_hash,record,record_hash FROM ${table}`,
          digest("other"),
        ),
      ),
    /FOREIGN KEY/,
  );
  assert.equal(f.snapshot(), before);
});
for (const change of [
  `DELETE FROM ${table}`,
  ...["record_hash", "envelope_hash", "binding"].map(
    (c) => `UPDATE ${table} SET ${c}='${"a".repeat(64)}'`,
  ),
  ...["org_id", "group_id", "booking_id", "request_id"].map(
    (c) => `UPDATE ${table} SET ${c}='foreign'`,
  ),
  ...["record", "envelope"].flatMap((c) => [
    `UPDATE ${table} SET ${c}='{}'`,
    `UPDATE ${table} SET ${c}=${c}||' '`,
  ]),
])
  test(`complete provenance refuses ${change}`, async (t) => {
    const f = await ready(t),
      r = f.apply();
    tamper(f, change);
    const before = rawSnapshot(f);
    assert.throws(() => retained(f), { code: "OFFLINE_CANADA_POST_IMPORT" });
    assert.throws(() => f.recover(r), { code: "OFFLINE_CANADA_POST_IMPORT" });
    assert.equal(rawSnapshot(f), before);
  });
for (const [column, value] of [
  ["record", "é".repeat(32769)],
  ["envelope", "é".repeat(32769)],
  ["record", '{"x":"a\0b"}'],
  ["envelope", '{"x":"a\0b"}'],
  ["record", '{"x":' + "[".repeat(1025) + "0" + "]".repeat(1025) + "}"],
  ["envelope", '{"x":[' + "0,".repeat(8000) + "0]}"],
] as const)
  test(`bounded ${column} ${value.length} preflight before retained blobs materialize`, async (t) => {
    const f = await ready(t);
    f.apply();
    tamper(f, `UPDATE ${table} SET ${column}=?`, value);
    const original = Store.prototype.all;
    let fetched = false;
    Store.prototype.all = function <T extends Row = Row>(
      sql: string,
      ...args: SQLInputValue[]
    ): T[] {
      if (sql.includes("AS envelope_bytes")) fetched = true;
      return original.call(this, sql, ...args) as T[];
    };
    try {
      assert.throws(() => retained(f), { code: "OFFLINE_CANADA_POST_IMPORT" });
    } finally {
      Store.prototype.all = original;
    }
    assert.equal(fetched, false);
  });
for (const column of ["record", "envelope"])
  test(`fatal UTF8 and canonical escaped surrogate refuse for ${column}`, async (t) => {
    const f = await ready(t);
    f.apply();
    tamper(
      f,
      `UPDATE ${table} SET ${column}=CAST(x'7B2278223A22EDA080227D' AS TEXT)`,
    );
    assert.throws(() => retained(f), { code: "OFFLINE_CANADA_POST_IMPORT" });
    tamper(f, `UPDATE ${table} SET ${column}=?`, '{"x":"\\ud800"}');
    assert.throws(() => retained(f), { code: "OFFLINE_CANADA_POST_IMPORT" });
  });
test("reverse orphan Platform receipt refuses before a second native effect", async (t) => {
  const f = await ready(t);
  f.app.database.transaction(() => {
    const r = f.app.platform.offline.readInTransaction()!;
    f.app.platform.offline.transitionInTransaction(
      r.state.generation,
      r.anchor,
      {
        kind: "record-task",
        receipt: {
          owner: "integration",
          orgId: f.actor.orgId,
          taskName: canadaPostPrivateTask.name,
          requestId: "orphan",
          binding: digest("orphan"),
          payloadHash: digest("payload"),
          beforeCandidateHash: f.envelope.candidate.logicalHash,
          resultHash: digest("missing"),
        },
      },
      [],
    );
  });
  f.refresh();
  const before = f.snapshot();
  assert.throws(() => f.apply(), { code: "OFFLINE_CANADA_POST_IMPORT" });
  assert.equal(f.snapshot(), before);
});
test("provenance is inserted BEFORE sole Platform receipt; late receipt error rolls all effects back", async (t) => {
  const f = await ready(t),
    before = f.snapshot(),
    h = f.capture();
  let reached = false;
  const original = f.app.platform.offline.transitionInTransaction.bind(
    f.app.platform.offline,
  );
  t.mock.method(
    Object.getPrototypeOf(f.app.platform.offline),
    "transitionInTransaction",
    (...args: Parameters<typeof original>) => {
      if ((args[2] as { kind: string }).kind === "record-task") {
        reached = true;
        const rows = store(f).all(`SELECT * FROM ${table}`);
        assert.equal(rows.length, 1);
        assert.equal(rows[0]!.envelope, canonical(f.envelope));
        assert.equal(
          f.app.platform.offline
            .readInTransaction()!
            .state.sessions.at(-1)!
            .history.filter((x) => x.kind === "record-task").length,
          0,
        );
        original(...args);
        throw Error("synthetic late durable receipt failure");
      }
      return original(...args);
    },
  );
  assert.throws(
    () =>
      f.app.database.transaction(() =>
        f.importer.applyInTransaction(actor(f), h),
      ),
    /synthetic late durable receipt failure/,
  );
  t.mock.restoreAll();
  assert(reached);
  assert.equal(f.snapshot(), before);
  assert.equal(store(f).get(`SELECT COUNT(*) AS n FROM ${table}`)!.n, 0);
});
for (const change of [
  "active=0",
  "role='support'",
  "org_id='foreign'",
  "account_id='foreign'",
])
  test(`retained recovery refreshes IAM: ${change}`, async (t) => {
    const f = await ready(t);
    f.apply();
    const before = f.snapshot();
    assert.throws(() =>
      f.app.database.transaction(() => {
        f.app.database
          .owned("iam")
          .run(`UPDATE iam_users SET ${change} WHERE id=?`, f.actor.id);
        f.importer.recoverRetainedInTransaction(actor(f), f.envelope);
      }),
    );
    assert.equal(f.snapshot(), before);
  });
test("no transaction, hostile inputs, and explicitly changed original all refuse without traps", async (t) => {
  const f = await ready(t),
    r = f.apply(),
    before = f.snapshot();
  let trapped = false;
  const p = new Proxy(
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
      ownKeys() {
        trapped = true;
        throw Error("trap");
      },
    },
  );
  assert.throws(() =>
    f.importer.recoverRetainedInTransaction(actor(f), f.envelope),
  );
  for (const [a, e] of [
    [p, f.envelope],
    [actor(f), p],
  ])
    assert.throws(() =>
      f.app.database.transaction(() =>
        f.importer.recoverRetainedInTransaction(a, e),
      ),
    );
  const changed = structuredClone(r);
  changed.record.nativeJoinHash = digest("forged");
  changed.resultHash = digest(canonical(changed.record));
  assert.throws(() => f.recover(changed));
  assert.equal(trapped, false);
  assert.equal(f.snapshot(), before);
});
test("drained/closed original session retains exact read-only recovery", async (t) => {
  const f = await ready(t),
    r = f.apply();
  for (const kind of ["drain", "close"] as const)
    f.app.database.transaction(() => {
      const s = f.app.platform.offline.readInTransaction()!;
      f.app.platform.offline.transitionInTransaction(
        s.state.generation,
        s.anchor,
        { kind },
        [],
      );
    });
  const before = f.snapshot(),
    n = changes(f);
  assert.equal(retained(f).resultHash, r.resultHash);
  assert.equal(changes(f), n);
  assert.equal(f.snapshot(), before);
});
for (const region of ["CA", "US"] as const)
  for (const reports of [false, true])
    test(`${region} reports=${reports} schema21 encrypted backup retains empty native provenance`, async (t) => {
      const f = fixture(
          t,
          { eventReports: reports },
          region,
          region === "CA" ? "CAD" : "USD",
        ),
        dir = fs.mkdtempSync(join(tmpdir(), "cp-provenance-backup-"));
      t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
      fs.chmodSync(dir, 0o700);
      const key = Buffer.alloc(32, 7),
        file = join(dir, "copy.enc"),
        target = join(dir, "restored.db");
      const b = await createBackup(f.path, file, region, key);
      assert(b);
      await restoreBackup(file, target, region, key);
      const app = new Application(target, region, { eventReports: reports });
      try {
        assert.equal(
          app.database
            .owned("integration")
            .get(`SELECT COUNT(*) AS n FROM ${table}`)!.n,
          0,
        );
      } finally {
        app.close();
        key.fill(0);
      }
    });
for (const budget of ["rows", "aggregate"] as const)
  test(`global ${budget} bound precedes blob materialization and orphan joins`, async (t) => {
    const f = await ready(t);
    f.apply();
    // Distinct synthetic orphan identifiers exercise the global preflight, not a truncated page.
    const n = budget === "rows" ? 1025 : 260,
      payload = budget === "rows" ? "{}" : "é".repeat(32000);
    tamper(
      f,
      `WITH RECURSIVE n(v) AS (SELECT 1 UNION ALL SELECT v+1 FROM n WHERE v<?) INSERT INTO ${table} SELECT 'orphan_'||v,group_id,org_id,'request_'||v,printf('%064x',v),envelope,envelope_hash,?,record_hash FROM n,${table}`,
      n,
      payload,
    );
    const all = Store.prototype.all;
    let fetched = false;
    Store.prototype.all = function <T extends Row = Row>(
      sql: string,
      ...args: SQLInputValue[]
    ): T[] {
      if (sql.includes("AS envelope_bytes")) fetched = true;
      return all.call(this, sql, ...args) as T[];
    };
    try {
      assert.throws(() => retained(f), { code: "OFFLINE_CANADA_POST_IMPORT" });
    } finally {
      Store.prototype.all = all;
    }
    assert.equal(fetched, false);
  });
test("late provenance insertion failure rolls back created member, audit, event and all receipt state", async (t) => {
  const f = await ready(t),
    before = f.snapshot(),
    original = Store.prototype.run;
  let reached = false;
  t.mock.method(
    Store.prototype,
    "run",
    function (this: Store, sql: string, ...args: SQLInputValue[]) {
      if (sql.startsWith(`INSERT INTO ${table}(`)) {
        reached = true;
        assert.equal(
          store(f).get(
            "SELECT state FROM integration_canada_post_members WHERE booking_id=?",
            f.bookingId,
          )!.state,
          "created",
        );
        throw Error("synthetic provenance storage fault");
      }
      return original.call(this, sql, ...args);
    },
  );
  assert.throws(() => f.apply(), /synthetic provenance storage fault/);
  t.mock.restoreAll();
  assert(reached);
  assert.equal(f.snapshot(), before);
});
test("stored original actor and result preimage are immutable even when supplied alternate hash is internally consistent", async (t) => {
  const f = await ready(t),
    r = f.apply(),
    before = f.snapshot();
  for (const mutation of ["actor", "comparison", "result"]) {
    const other = structuredClone(r);
    if (mutation === "actor") other.record.actor.id = "other";
    else if (mutation === "comparison")
      other.record.comparisonHash = digest("other");
    else other.record.result.scopeHash = digest("other");
    other.resultHash = digest(canonical(other.record));
    assert.throws(() => f.recover(other));
  }
  assert.equal(f.snapshot(), before);
});
