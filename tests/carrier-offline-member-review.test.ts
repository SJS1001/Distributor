import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fixture, accept, chooseProviders } from "./fixtures.ts";
import { origin } from "./canada-post-fixture.ts";
import { CarrierOfflineMemberReview } from "../src/server/carrier-offline-member-review.ts";
import { Store } from "../src/server/database.ts";
import { canonical, digest, type Actor } from "../src/server/core.ts";
import { Application } from "../src/server/application.ts";
import { createBackup, restoreBackup } from "../src/server/recovery.ts";
import { canadaPostConfigurationHash } from "../src/server/canada-post-evidence.ts";
import type { CarrierIntent } from "../src/server/carrier-bookings.ts";

async function setup(
  t: Parameters<typeof fixture>[0],
  region: "CA" | "US" = "CA",
  currency: "CAD" | "USD" = "CAD",
  reports = false,
  configured = false,
  history = false,
  rebook = false,
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
  const entries = [0, 1].map((n) => {
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
        ...(configured ? { configurationHash } : {}),
      },
      configured ? configuration : undefined,
    );
    return { bookingId: b.id, reviewHash: b.reviewHash };
  });
  const input = { configurationHash, entries };
  if (history) {
    const g = f.app.carriers.prepareCanadaPostGroup(
      f.actor,
      "earlier-group",
      input,
    );
    f.app.carriers.cancelCanadaPostGroup(f.actor, "cancel-earlier", {
      groupId: g.id,
      reviewHash: g.reviewHash,
      reason: "Unused synthetic preparation",
    });
  }
  if (rebook) {
    assert(history);
    for (let n = 0; n < entries.length; n++) {
      const old = entries[n]!;
      const i = JSON.parse(
        String(
          f.app.database
            .owned("integration")
            .get(
              "SELECT intent FROM integration_carrier_bookings WHERE id=?",
              old.bookingId,
            )!.intent,
        ),
      );
      f.app.carriers.cancel(f.actor, `cancel-old-${n}`, {
        bookingId: old.bookingId,
        reviewHash: old.reviewHash,
        reason: "Synthetic prior unused booking",
      });
      const {
        bookingId: _id,
        reviewHash: _hash,
        nativeSnapshot: _snapshot,
        configuration: config,
        ...prepare
      } = i;
      const next = f.app.carriers.prepare(
        f.actor,
        `rebook-${n}`,
        { ...prepare, previousId: old.bookingId },
        config,
      );
      entries[n] = { bookingId: next.id, reviewHash: next.reviewHash };
    }
  }
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
  f.app.platform.isolateRestore("a".repeat(64), "2026-10-03T00:00:00.000Z");
  return {
    ...f,
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
type F = Awaited<ReturnType<typeof setup>>;
const owner = (f: F) => f.app.carrierOfflineMemberReview;
const inside = (f: F, actor: Actor = f.actor) =>
  owner(f).reviewUnknownMemberInTransaction(actor, f.groupId, f.bookingId);
const review = (f: F, actor: Actor = f.actor) =>
  f.app.database.transaction(() => inside(f, actor));
function frozen(v: unknown) {
  if (v && typeof v === "object") {
    assert(Object.isFrozen(v));
    for (const x of Object.values(v)) frozen(x);
  }
}
function conserved(f: F) {
  return {
    stock: f.app.inventory.stock(f.actor),
    invoices: f.app.billing.invoices(f.actor),
    orders: f.app.orders.list(f.actor),
    bookings: f.app.database
      .owned("integration")
      .all("SELECT * FROM integration_carrier_bookings"),
    groups: f.app.database
      .owned("integration")
      .all("SELECT * FROM integration_canada_post_groups"),
    members: f.app.database
      .owned("integration")
      .all("SELECT * FROM integration_canada_post_members"),
  };
}
function corrupt(f: F, sql: string, ...args: (string | number | Uint8Array)[]) {
  const before = conserved(f);
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        f.app.database.owned("integration").run(sql, ...args);
        inside(f);
      }),
    (e) =>
      !!e &&
      typeof e === "object" &&
      "code" in e &&
      [
        "CARRIER_OFFLINE_REVIEW",
        "CARRIER_OFFLINE_REVIEW_LIMIT",
        "CARRIER_RESULT",
        "FORBIDDEN",
      ].includes(String(e.code)),
  );
  assert.deepEqual(conserved(f), before);
}

for (const [region, currency, reports, configured] of [
  ["CA", "CAD", false, false],
  ["CA", "USD", true, true],
  ["US", "USD", false, false],
  ["US", "CAD", true, true],
] as const)
  test(`native unknown-member review ${region}/${currency}/reports=${reports}/config=${configured}`, async (t) => {
    const f = await setup(t, region, currency, reports, configured, true),
      before = conserved(f);
    const r = review(f);
    frozen(r);
    assert.equal(r.currency, currency);
    assert.equal(r.region, region);
    assert.equal(r.groups.length, 2);
    assert.equal(r.members.length, 4);
    assert.equal(r.bookingHistory.length, 2);
    assert.equal(r.orderedMembers.length, 2);
    assert.deepEqual(
      r.orderedMembers.map((x) => x.bookingId),
      [...f.entries.map((e) => e.bookingId)].sort(),
    );
    const label = r.members.find(
      (m) => m.booking_id === f.createdId && m.state === "created",
    )!.label_bytes as { data: string; sha256: string };
    assert.equal(label.sha256, digest(f.pdf));
    assert.deepEqual(Buffer.from(label.data, "base64"), f.pdf);
    assert(r.blockers.includes("PLATFORM_CARRIER_PROVENANCE_REQUIRED"));
    assert(
      r.blockers.includes(
        "PROVIDER_ACCOUNT_PREIMAGE_AND_QUALIFICATION_REQUIRED",
      ),
    );
    const { reviewHash, ...facts } = r;
    assert.equal(reviewHash, digest(canonical(facts)));
    assert.deepEqual(review(f), r);
    assert.deepEqual(conserved(f), before);
    assert.throws(() => {
      (r.members[0] as any).state = "created";
    }, TypeError);
    await assert.rejects(
      f.app.carriers.reconcileCanadaPostMember(
        f.actor,
        f.groupId,
        f.bookingId,
        {
          testApplication: true,
          configurationHash: f.configurationHash,
          create: async () => {
            throw Error("transport");
          },
          lookup: async () => {
            throw Error("transport");
          },
        },
      ),
      { code: "RECOVERY_HOLD" },
    );
    assert(f.app.platform.recoveryHold());
  });

test("raw hold is a bounded writer read independent of historical permits", (t) => {
  const f = fixture(t),
    p = f.app.platform;
  assert.throws(() => p.rawRecoveryHoldInTransaction(), {
    code: "TRANSACTION",
  });
  assert.equal(
    f.app.database.transaction(() => p.rawRecoveryHoldInTransaction()),
    null,
  );
  p.isolateRestore("b".repeat(64), "2026-10-03T00:00:00.000Z");
  t.mock.method(p.restore, "permits", () => true);
  assert.equal(p.recoveryHold(), null);
  const r = f.app.database.transaction(() => p.rawRecoveryHoldInTransaction())!;
  assert.equal(r.snapshot_hash, "b".repeat(64));
  assert(Object.isFrozen(r));
  assert.throws(() => {
    (r as any).snapshot_hash = "changed";
  }, TypeError);
  assert.deepEqual(
    f.app.database.transaction(() => p.rawRecoveryHoldInTransaction()),
    r,
  );
});

test("raw hold count and UTF8 lengths refuse before variable-width SELECT", (t) => {
  const f = fixture(t);
  f.app.platform.isolateRestore("b".repeat(64), "2026-10-03T00:00:00.000Z");
  const original = Store.prototype.get;
  let fetched = 0;
  t.mock.method(
    Store.prototype,
    "get",
    function (
      this: Store,
      sql: string,
      ...args: Parameters<Store["get"]> extends [string, ...infer P] ? P : never
    ) {
      if (sql.startsWith("SELECT id,snapshot_hash")) fetched++;
      return original.call(this, sql, ...args);
    },
  );
  for (const field of ["snapshot_hash", "restored_at", "source_completed_at"]) {
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          f.app.database
            .owned("platform")
            .run(`UPDATE platform_recovery SET ${field}=?`, "é".repeat(64));
          f.app.platform.rawRecoveryHoldInTransaction();
        }),
      { code: "RAW_RECOVERY_HOLD" },
    );
  }
  assert.equal(fetched, 0);
  for (const value of [
    "2026-02-30T00:00:00.000Z",
    "2026-10-03T00:00:00+0000",
  ]) {
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          f.app.database
            .owned("platform")
            .run("UPDATE platform_recovery SET restored_at=?", value);
          f.app.platform.rawRecoveryHoldInTransaction();
        }),
      { code: "RAW_RECOVERY_HOLD" },
    );
  }
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        f.app.database
          .owned("platform")
          .run("UPDATE platform_recovery SET snapshot_hash=?", "A".repeat(64));
        f.app.platform.rawRecoveryHoldInTransaction();
      }),
    { code: "RAW_RECOVERY_HOLD" },
  );
});

test("fresh same-writer warehouse/password/site/org authority, transaction and raw hold are mandatory", async (t) => {
  const f = await setup(t),
    iam = f.app.database.owned("iam");
  assert.throws(() => inside(f), { code: "TRANSACTION" });
  for (const change of [
    "active=0",
    "role='finance'",
    "org_id='foreign'",
    "role='warehouse',sites='[]'",
  ]) {
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          iam.run(`UPDATE iam_users SET ${change} WHERE id=?`, f.actor.id);
          inside(f);
        }),
      { code: "FORBIDDEN" },
    );
  }
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        iam.run(
          "INSERT INTO iam_user_security(user_id,revision,password_change_required,updated_at) VALUES(?,1,1,'2026-10-03T00:00:00.000Z')",
          f.actor.id,
        );
        inside(f);
      }),
    { code: "PASSWORD_CHANGE_REQUIRED" },
  );
  assert.throws(() => review(f, { ...f.actor, orgId: "foreign" }), {
    code: "FORBIDDEN",
  });
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        f.app.database.owned("platform").run("DELETE FROM platform_recovery");
        inside(f);
      }),
    { code: "RECOVERY_HOLD_REQUIRED" },
  );
  assert.equal(review(f).bookingId, f.bookingId);
});

for (const [name, sql] of [
  [
    "omitted member",
    "DELETE FROM integration_canada_post_members WHERE booking_id=?",
  ],
  [
    "foreign member",
    "UPDATE integration_canada_post_members SET org_id='foreign' WHERE booking_id=?",
  ],
  [
    "inactive member",
    "UPDATE integration_canada_post_members SET active=0 WHERE booking_id=?",
  ],
  [
    "partial claim",
    "UPDATE integration_canada_post_members SET token='claim',started_at=NULL WHERE booking_id=?",
  ],
  [
    "unknown with artifact",
    "UPDATE integration_canada_post_members SET tracking='123456789012' WHERE booking_id=?",
  ],
  [
    "bad intent",
    "UPDATE integration_carrier_bookings SET intent='{' WHERE id=?",
  ],
  [
    "copied booking org",
    "UPDATE integration_carrier_bookings SET org_id='foreign' WHERE id=?",
  ],
  [
    "ordinary booking claim",
    "UPDATE integration_carrier_bookings SET token='claim',started_at=1 WHERE id=?",
  ],
] as const)
  test(`refuses ${name}`, async (t) => {
    const f = await setup(t);
    corrupt(f, sql, f.bookingId);
  });

test("group snapshot hash, created label and manifest contradictions refuse", async (t) => {
  const f = await setup(t);
  corrupt(
    f,
    "UPDATE integration_canada_post_groups SET state='closed' WHERE id=?",
    f.groupId,
  );
  corrupt(
    f,
    "UPDATE integration_canada_post_groups SET review_hash=? WHERE id=?",
    "f".repeat(64),
    f.groupId,
  );
  corrupt(
    f,
    "UPDATE integration_canada_post_groups SET observation='{}' WHERE id=?",
    f.groupId,
  );
  corrupt(
    f,
    "UPDATE integration_canada_post_groups SET token='manifest',started_at=1 WHERE id=?",
    f.groupId,
  );
  corrupt(
    f,
    "UPDATE integration_canada_post_members SET label_hash=? WHERE booking_id=?",
    "f".repeat(64),
    f.createdId,
  );
  corrupt(
    f,
    "UPDATE integration_canada_post_members SET label_bytes=?,label_hash=? WHERE booking_id=?",
    Buffer.from("wrong"),
    digest("wrong"),
    f.createdId,
  );
});

test("all scalar, blob and aggregate bounds precede any carrier row materialization", async (t) => {
  const f = await setup(t),
    original = Store.prototype.all;
  let fetched = 0;
  t.mock.method(
    Store.prototype,
    "all",
    function (
      this: Store,
      sql: string,
      ...args: Parameters<Store["all"]> extends [string, ...infer P] ? P : never
    ) {
      if (/FROM integration_(carrier|canada_post)/.test(sql)) fetched++;
      return original.call(this, sql, ...args);
    },
  );
  for (const [sql, args] of [
    ["UPDATE integration_carrier_bookings SET error=?", ["é".repeat(2049)]],
    ["UPDATE integration_carrier_bookings SET intent=?", [" ".repeat(262145)]],
    [
      "UPDATE integration_canada_post_members SET label_bytes=? WHERE booking_id=?",
      [Buffer.alloc(1048577), f.createdId],
    ],
    ["UPDATE integration_carrier_bookings SET intent=?", ["x".repeat(262144)]],
  ] as [string, (string | Uint8Array)[]][]) {
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          f.app.database.owned("integration").run(sql, ...args);
          inside(f);
        }),
      { code: "CARRIER_OFFLINE_REVIEW_LIMIT" },
    );
  }
  assert.equal(fetched, 0);
});

test("exact retained claims survive writer rollback; prior results are detached", async (t) => {
  const f = await setup(t),
    before = review(f),
    s = f.app.database.owned("integration");
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        s.run(
          "UPDATE integration_canada_post_members SET token='copied-exact',started_at=123 WHERE booking_id=?",
          f.bookingId,
        );
        const r = inside(f);
        assert(r.blockers.includes("RETAINED_MEMBER_CLAIM"));
        assert.equal(
          r.members.find((m) => m.booking_id === f.bookingId)!.token,
          "copied-exact",
        );
        assert.equal(
          before.members.find((m) => m.booking_id === f.bookingId)!.token,
          null,
        );
        assert.notEqual(r.reviewHash, before.reviewHash);
        throw Error("rollback");
      }),
    /rollback/,
  );
  assert.deepEqual(review(f), before);
});

for (const region of ["CA", "US"] as const)
  test(`encrypted restored ${region} retains native unknown history and raw hold`, async (t) => {
    const f = await setup(t, region, "USD", true),
      key = randomBytes(32),
      archive = join(dirname(f.path), "carrier.backup"),
      target = join(dirname(f.path), "restored.db");
    await createBackup(f.path, archive, region, key);
    await restoreBackup(archive, target, region, key);
    const app = new Application(target, region, { eventReports: true });
    try {
      const restored = { ...f, app, path: target },
        before = conserved(restored),
        r = review(restored);
      assert.equal(r.bookingId, f.bookingId);
      assert(r.hold);
      assert.deepEqual(conserved(restored), before);
      assert.deepEqual(review(restored), r);
    } finally {
      app.close();
    }
  });

test("copied booking cannot hide a retained native shipment link by changing SQL subject columns", async (t) => {
  const f = await setup(t);
  corrupt(
    f,
    "INSERT INTO integration_carrier_bookings(id,org_id,shipment_id,state,review_hash,intent,created_at) SELECT 'copied','foreign','changed-subject',state,review_hash,intent,created_at FROM integration_carrier_bookings WHERE id=?",
    f.bookingId,
  );
});

test("count limits precede materialization even for unrelated copied groups", async (t) => {
  const f = await setup(t),
    original = Store.prototype.all;
  let fetched = 0;
  t.mock.method(
    Store.prototype,
    "all",
    function (
      this: Store,
      sql: string,
      ...args: Parameters<Store["all"]> extends [string, ...infer P] ? P : never
    ) {
      if (/FROM integration_(carrier|canada_post)/.test(sql)) fetched++;
      return original.call(this, sql, ...args);
    },
  );
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        const s = f.app.database.owned("integration");
        for (let n = 0; n < 128; n++)
          s.run(
            "INSERT INTO integration_canada_post_groups SELECT ?,org_id,warehouse_id,configuration_hash,?,review_hash,state,token,started_at,observation,manifest_bytes,manifest_hash,created_at FROM integration_canada_post_groups WHERE id=?",
            `copy-${n}`,
            `provider-${n}`,
            f.groupId,
          );
        inside(f);
      }),
    { code: "CARRIER_OFFLINE_REVIEW_LIMIT" },
  );
  assert.equal(fetched, 0);
});

test("raw hold refuses additional singleton rows before materializing any tuple", (t) => {
  const f = fixture(t),
    s = f.app.database.owned("platform"),
    original = Store.prototype.get;
  let fetched = 0;
  f.app.platform.isolateRestore("a".repeat(64), "2026-10-03T00:00:00.000Z");
  t.mock.method(
    Store.prototype,
    "get",
    function (
      this: Store,
      sql: string,
      ...args: Parameters<Store["get"]> extends [string, ...infer P] ? P : never
    ) {
      if (sql.startsWith("SELECT id,snapshot_hash")) fetched++;
      return original.call(this, sql, ...args);
    },
  );
  // Build the corrupt fixture on a separate raw SQLite connection. The
  // application's authorizer correctly forbids disabling its own constraints.
  const raw = new DatabaseSync(f.path);
  try {
    raw.exec("PRAGMA ignore_check_constraints=ON");
    raw.exec(
      "INSERT INTO platform_recovery SELECT 2,snapshot_hash,restored_at,source_completed_at FROM platform_recovery",
    );
  } finally {
    raw.close();
  }
  assert.throws(
    () =>
      f.app.database.transaction(() =>
        f.app.platform.rawRecoveryHoldInTransaction(),
      ),
    { code: "RAW_RECOVERY_HOLD" },
  );
  assert.equal(fetched, 0);
});

test("native canceled booking predecessors and complete inactive groups stay in ordered history", async (t) => {
  const f = await setup(t, "CA", "CAD", false, true, true, true),
    r = review(f);
  assert.equal(r.bookingHistory.length, 4);
  assert.equal(
    r.bookingHistory.filter((b) => b.state === "canceled").length,
    2,
  );
  assert.equal(r.groups.length, 2);
  assert.equal(r.members.length, 4);
  const earlier = r.bookingHistory.find((b) => b.state === "canceled")!;
  corrupt(
    f,
    "UPDATE integration_carrier_bookings SET intent='{}' WHERE id=?",
    String(earlier.id),
  );
});

test("complete ordered membership commitment rejects reversed or extended membership", async (t) => {
  const f = await setup(t),
    s = f.app.database.owned("integration");
  const group = s.get(
    "SELECT * FROM integration_canada_post_groups WHERE id=?",
    f.groupId,
  )!;
  const entries = s
    .all(
      "SELECT booking_id,review_hash FROM integration_canada_post_members WHERE group_id=? ORDER BY booking_id",
      f.groupId,
    )
    .map((m) => ({ bookingId: m.booking_id, reviewHash: m.review_hash }));
  const hash = digest(
    canonical({
      configurationHash: group.configuration_hash,
      providerGroupId: group.provider_group_id,
      warehouseId: group.warehouse_id,
      entries: entries.reverse(),
    }),
  );
  corrupt(
    f,
    "UPDATE integration_canada_post_groups SET review_hash=? WHERE id=?",
    hash,
    f.groupId,
  );
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        s.run(
          "INSERT INTO integration_carrier_bookings(id,org_id,shipment_id,state,review_hash,intent,created_at) SELECT 'extra-booking',org_id,'extra-shipment',state,review_hash,intent,created_at FROM integration_carrier_bookings WHERE id=?",
          f.bookingId,
        );
        s.run(
          "INSERT INTO integration_canada_post_members SELECT group_id,'extra-booking',org_id,review_hash,1,state,token,started_at,provider_shipment_id,tracking,label_bytes,label_hash FROM integration_canada_post_members WHERE booking_id=?",
          f.bookingId,
        );
        inside(f);
      }),
    { code: "CARRIER_OFFLINE_REVIEW" },
  );
});

test("one MiB native PDF remains exact bounded immutable data", async (t) => {
  const f = await setup(t),
    s = f.app.database.owned("integration"),
    pdf = Buffer.alloc(1048576, 32);
  pdf.write("%PDF-");
  f.app.database.transaction(() => {
    s.run(
      "UPDATE integration_canada_post_members SET label_bytes=?,label_hash=? WHERE booking_id=?",
      pdf,
      digest(pdf),
      f.createdId,
    );
    const r = inside(f);
    const label = r.members.find((m) => m.booking_id === f.createdId)!
      .label_bytes as { data: string; bytes: number; sha256: string };
    assert.equal(label.bytes, 1048576);
    assert.equal(digest(Buffer.from(label.data, "base64")), label.sha256);
    frozen(label);
  });
});

test("warehouse-scoped native actor can review and loses access immediately in the same writer", async (t) => {
  const f = await setup(t),
    iam = f.app.database.owned("iam");
  f.app.database.transaction(() => {
    iam.run(
      "UPDATE iam_users SET role='warehouse',sites=? WHERE id=?",
      JSON.stringify([f.w1]),
      f.actor.id,
    );
    assert.equal(inside(f).bookingId, f.bookingId);
    iam.run("UPDATE iam_users SET sites='[]' WHERE id=?", f.actor.id);
    assert.throws(() => inside(f), { code: "FORBIDDEN" });
  });
});

test("other-group provider shipment and tracking reservations are searched before subject filtering", async (t) => {
  const f = await setup(t),
    s = f.app.database.owned("integration");
  for (const collision of ["provider", "tracking"] as const)
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          const b = s.get(
            "SELECT * FROM integration_carrier_bookings WHERE id=?",
            f.createdId,
          )!;
          const i = JSON.parse(String(b.intent));
          i.bookingId = "copy-booking";
          i.shipmentId = "copy-shipment";
          i.nativeSnapshot.id = "copy-shipment";
          const { bookingId, reviewHash: _, ...review } = i;
          i.reviewHash = digest(canonical(review));
          s.run(
            "INSERT INTO integration_carrier_bookings(id,org_id,shipment_id,state,review_hash,intent,created_at) VALUES(?,?,?,'pending',?,?,?)",
            bookingId,
            f.actor.orgId,
            i.shipmentId,
            i.reviewHash,
            canonical(i),
            String(b.created_at),
          );
          const gh = digest(
            canonical({
              configurationHash: f.configurationHash,
              providerGroupId: "copygroup",
              warehouseId: f.w1,
              entries: [{ bookingId, reviewHash: i.reviewHash }],
            }),
          );
          s.run(
            "INSERT INTO integration_canada_post_groups(id,org_id,warehouse_id,configuration_hash,provider_group_id,review_hash,state,created_at) VALUES('copy-group',?,?,?,'copygroup',?,'closed',?)",
            f.actor.orgId,
            f.w1,
            f.configurationHash,
            gh,
            String(b.created_at),
          );
          const m = s.get(
            "SELECT * FROM integration_canada_post_members WHERE booking_id=?",
            f.createdId,
          )!;
          s.run(
            "INSERT INTO integration_canada_post_members VALUES('copy-group',?,?,?,1,'created',NULL,NULL,?,?,?,?)",
            bookingId,
            f.actor.orgId,
            i.reviewHash,
            collision === "provider"
              ? String(m.provider_shipment_id)
              : "different-shipment",
            collision === "tracking" ? String(m.tracking) : "9999999999999999",
            f.pdf,
            digest(f.pdf),
          );
          inside(f);
        }),
      { code: "CARRIER_OFFLINE_REVIEW" },
    );
});
