import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fixture, accept, chooseProviders } from "./fixtures.ts";
import { origin } from "./canada-post-fixture.ts";
import { canadaPostConfigurationHash } from "../src/server/canada-post-evidence.ts";
import type { CarrierIntent } from "../src/server/carrier-bookings.ts";
import { canonical, digest, type Actor } from "../src/server/core.ts";
import { Store } from "../src/server/database.ts";
import { Fulfillment } from "../src/server/fulfillment.ts";
import { CarrierOfflineMemberReview } from "../src/server/carrier-offline-member-review.ts";
import { Application } from "../src/server/application.ts";
import { PlatformOfflineCanadaPostCommandReviewReader } from "../src/server/platform-offline-canada-post-command-review.ts";
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
  const input = {
    configurationHash,
    entries: [...entries].sort((a, b) =>
      a.bookingId.localeCompare(b.bookingId),
    ),
  };
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
  input.entries = entries;
  input.entries.sort((a, b) => a.bookingId.localeCompare(b.bookingId));
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
  return Object.assign(f, {
    groupId: group.id,
    bookingId: entries[1]!.bookingId,
    createdId: entries[0]!.bookingId,
    entries,
    region,
    currency,
    reports,
    pdf,
    configurationHash,
  });
}

type F = Awaited<ReturnType<typeof setup>>;
const reader = (f: F) =>
  new PlatformOfflineCanadaPostCommandReviewReader(
    f.app.database,
    f.app.identity,
    f.app.platform,
    f.app.fulfillment,
    f.app.carriers,
  );
const read = (f: F, actor = f.actor) =>
  f.app.database.transaction(() =>
    reader(f).getInTransaction(actor, f.groupId, f.bookingId),
  );
function snapshot(f: F) {
  return canonical(
    (["platform", "integration", "fulfillment", "iam"] as const).map((o) => {
      const s = f.app.database.owned(o);
      return s
        .all<{ name: string }>(
          "SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE ? ORDER BY name",
          `${o}_%`,
        )
        .map(({ name }) => [
          name,
          s.all(`SELECT * FROM ${name} ORDER BY rowid`),
        ]);
    }),
  );
}
function frozen(x: unknown) {
  if (x && typeof x === "object") {
    assert(Object.isFrozen(x));
    Object.values(x).forEach(frozen);
  }
}
for (const currency of ["CAD", "USD"] as const)
  for (const reports of [false, true])
    test(`CA/${currency} reports=${reports}: original complete prepare preimages match native command bytes`, async (t) => {
      const f = await setup(t, "CA", currency, reports, true),
        before = snapshot(f),
        r = read(f);
      frozen(r);
      assert.deepEqual(r.blockers, [
        "SOURCE_INTERVAL_AND_PROVIDER_TRUTH_NOT_QUALIFIED",
      ]);
      assert.equal(r.commands.length, 3);
      assert.equal(
        r.nativeReviewHash,
        f.app.database.transaction(() =>
          f.app.carrierOfflineMemberReview.reviewUnknownMemberInTransaction(
            f.actor,
            f.groupId,
            f.bookingId,
          ),
        ).reviewHash,
      );
      for (const c of r.commands)
        assert.equal(digest(canonical(c.payload)), c.requestHash);
      const { factsHash, ...facts } = r;
      assert.equal(factsHash, digest(canonical(facts)));
      assert.deepEqual(read(f), r);
      assert.equal(snapshot(f), before);
    });

const bad = { code: "OFFLINE_CANADA_POST_COMMAND" };
for (const command of ["carrier.prepare", "carrier.canada-post.group.prepare"])
  test(`wrong ${command} request hash with matching command audit is still refused`, async (t) => {
    const f = await setup(t, "CA", "CAD", false, true),
      s = f.app.database.owned("platform");
    const c = s.get(
      "SELECT * FROM platform_commands WHERE name=? ORDER BY key LIMIT 1",
      command,
    )!;
    s.run(
      "UPDATE platform_commands SET hash=? WHERE name=? AND key=?",
      "b".repeat(64),
      command,
      c.key!,
    );
    s.run(
      "UPDATE platform_audit SET detail=? WHERE action=? AND reference=?",
      canonical({ requestHash: "b".repeat(64) }),
      command,
      c.key!,
    );
    const before = snapshot(f);
    assert.throws(() => read(f), bad);
    assert.equal(snapshot(f), before);
  });
for (const history of [true, false])
  test(`unsupported ${history ? "cancellation" : "other native-unjoined preparation"} remains an explicit blocker`, async (t) => {
    const f = await setup(t, "CA", "CAD", false, true, history);
    const s = f.app.database.owned("platform");
    if (!history) {
      // A self-consistent unrelated ordinary preparation with no native retained
      // booking is a Platform-only closure, never supplied as native truth.
      const c = s.get(
        "SELECT * FROM platform_commands WHERE name='carrier.prepare' LIMIT 1",
      )!;
      s.run(
        "INSERT INTO platform_commands VALUES(?,?,?,?,?,?,?)",
        c.org_id!,
        c.actor_id!,
        c.name!,
        "other-prepare",
        c.hash!,
        JSON.stringify({ id: "other-booking", reviewHash: "c".repeat(64) }),
        c.created_at!,
      );
      f.app.platform.audit(f.actor, "carrier.prepare", "other-prepare", {
        requestHash: c.hash,
      });
      f.app.platform.event(
        f.actor,
        "carrier.booking.prepared",
        "other-booking",
        {
          shipmentId: "other-shipment",
          reviewHash: "c".repeat(64),
          provider: "canada-post",
        },
      );
    }
    const r = read(f);
    assert(
      r.blockers.includes(
        history
          ? "CANCELLATION_OR_RELEASE_REQUEST_PREIMAGE_UNSUPPORTED"
          : "OTHER_CARRIER_COMMAND_NOT_NATIVE_JOINED",
      ),
    );
  });
for (const sql of [
  "DELETE FROM platform_commands WHERE name='carrier.prepare'",
  "DELETE FROM platform_events WHERE type='carrier.canada-post.group.prepared'",
  "UPDATE platform_events SET payload='{}' WHERE type='carrier.booking.prepared'",
  "UPDATE platform_commands SET org_id='foreign' WHERE name='carrier.prepare'",
  "UPDATE platform_audit SET org_id='foreign' WHERE action='carrier.prepare'",
  "UPDATE platform_events SET org_id='foreign' WHERE type='carrier.booking.prepared'",
  "UPDATE platform_commands SET name='other.command' WHERE name='carrier.prepare'",
  "UPDATE platform_audit SET action='other.audit' WHERE action='carrier.canada-post.member.unknown'",
  "UPDATE platform_audit SET detail='{}' WHERE action='carrier.canada-post.member.unknown'",
  "UPDATE platform_commands SET result='null' WHERE name='carrier.prepare'",
])
  test(`complete closure rejects ${sql}`, async (t) => {
    const f = await setup(t, "CA", "CAD", false, true);
    f.app.database.owned("platform").run(sql);
    const before = snapshot(f);
    assert.throws(() => read(f));
    assert.equal(snapshot(f), before);
  });
test("orphan audit-order row refuses without guessed tenancy", async (t) => {
  const f = await setup(t, "CA", "CAD", false, true),
    db = new DatabaseSync(f.path);
  db.exec("PRAGMA foreign_keys=OFF");
  db.prepare(
    "INSERT INTO platform_audit_order(sequence,audit_id,org_id) VALUES(99999,'orphan','foreign')",
  ).run();
  db.close();
  assert.throws(() => read(f), bad);
});
test("created sibling event cannot claim a different retained provider shipment", async (t) => {
  const f = await setup(t, "CA", "CAD", false, true),
    s = f.app.database.owned("platform");
  const e = s.get(
    "SELECT * FROM platform_events WHERE type='carrier.canada-post.member.created'",
  )!;
  s.run(
    "UPDATE platform_events SET payload=? WHERE id=?",
    canonical({
      ...JSON.parse(String(e.payload)),
      shipmentId: "OtherProviderShipment",
    }),
    e.id!,
  );
  assert.throws(() => read(f), bad);
});
for (const profile of [
  "utf8",
  "nul",
  "surrogate",
  "json",
  "row",
  "aggregate",
  "count",
] as const)
  test(`fixed ${profile} corruption/resource bound refuses`, async (t) => {
    const f = await setup(t, "CA", "CAD", false, true),
      s = f.app.database.owned("platform");
    if (profile === "utf8")
      s.run(
        "UPDATE platform_commands SET result=CAST(x'7b2261223a22ff227d' AS TEXT) WHERE name='carrier.prepare'",
      );
    if (profile === "nul")
      s.run(
        "UPDATE platform_commands SET key=key||? WHERE name='carrier.prepare'",
        "x\0y",
      );
    if (profile === "surrogate")
      s.run(
        "UPDATE platform_commands SET result=? WHERE name='carrier.prepare'",
        '{"a":"\\ud800"}',
      );
    if (profile === "json")
      s.run(
        "UPDATE platform_commands SET result=? WHERE name='carrier.prepare'",
        "[".repeat(513) + "0" + "]".repeat(513),
      );
    if (profile === "row")
      s.run(
        "UPDATE platform_commands SET result=? WHERE name='carrier.prepare'",
        JSON.stringify({ a: "界".repeat(22000) }),
      );
    if (profile === "aggregate" || profile === "count")
      f.app.database.transaction(() => {
        for (let i = 0; i < (profile === "count" ? 1001 : 150); i++)
          s.run(
            "INSERT INTO platform_commands VALUES(?,?,?,?,?,?,?)",
            f.actor.orgId,
            f.actor.id,
            "other.command",
            `bulk-${i}`,
            "a".repeat(64),
            JSON.stringify({
              value: profile === "count" ? "x" : "界".repeat(20000),
            }),
            "2026-10-04T00:00:00.000Z",
          );
      });
    const before = snapshot(f);
    assert.throws(() => read(f));
    assert.equal(snapshot(f), before);
  });
for (const change of [
  "role='warehouse'",
  "active=0",
  "org_id='foreign'",
  "account_id='buyer'",
])
  test(`fresh authority refuses ${change}`, async (t) => {
    const f = await setup(t, "CA", "CAD", false, true),
      before = snapshot(f);
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          f.app.database
            .owned("iam")
            .run(`UPDATE iam_users SET ${change} WHERE id=?`, f.actor.id);
          reader(f).getInTransaction(f.actor, f.groupId, f.bookingId);
        }),
      { code: "FORBIDDEN" },
    );
    assert.equal(snapshot(f), before);
  });
test("writer, raw hold and current password required; reopen deterministic and outer rollback conserved", async (t) => {
  const f = await setup(t, "CA", "CAD", false, true),
    r = reader(f),
    before = snapshot(f),
    review = read(f);
  assert.throws(() => r.getInTransaction(f.actor, f.groupId, f.bookingId), {
    code: "TRANSACTION",
  });
  for (const variant of ["hold", "password"]) {
    assert.throws(() =>
      f.app.database.transaction(() => {
        if (variant === "hold")
          f.app.database.owned("platform").run("DELETE FROM platform_recovery");
        else
          f.app.database
            .owned("iam")
            .run(
              "INSERT INTO iam_user_security VALUES(?,1,1,'2026-10-04T00:00:00.000Z') ON CONFLICT(user_id) DO UPDATE SET password_change_required=1",
              f.actor.id,
            );
        r.getInTransaction(f.actor, f.groupId, f.bookingId);
      }),
    );
    assert.equal(snapshot(f), before);
  }
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        r.getInTransaction(f.actor, f.groupId, f.bookingId);
        throw Error("outer rollback");
      }),
    /outer rollback/,
  );
  f.app.close();
  f.app = new Application(f.path, "CA", { eventReports: false });
  assert.deepEqual(read(f), review);
  assert.equal(snapshot(f), before);
});
test("proxy/revoked/accessor primitives and actor grants execute zero traps", async (t) => {
  const f = await setup(t, "CA", "CAD", false, true),
    r = reader(f);
  let traps = 0;
  const trap = () => {
    traps++;
    throw Error("trap");
  };
  const p = new Proxy(
      {},
      {
        get: trap,
        getPrototypeOf: trap,
        ownKeys: trap,
        getOwnPropertyDescriptor: trap,
      },
    ),
    revoked = Proxy.revocable({}, {});
  revoked.revoke();
  for (const actor of [
    p,
    revoked.proxy,
    { ...f.actor, sites: p },
    Object.defineProperty({ ...f.actor }, "id", { get: trap }),
    { ...f.actor, [Symbol("x")]: 1 },
  ])
    assert.throws(() =>
      f.app.database.transaction(() =>
        r.getInTransaction(actor as Actor, f.groupId, f.bookingId),
      ),
    );
  for (const id of [
    p,
    revoked.proxy,
    { toString: trap },
    "x".repeat(129),
    "x\0y",
  ])
    assert.throws(() =>
      f.app.database.transaction(() =>
        r.getInTransaction(f.actor, id as string, f.bookingId),
      ),
    );
  assert.equal(traps, 0);
});

test("input array order is not invented from sorted retained membership", async (t) => {
  const f = await setup(t, "CA", "CAD", false, true),
    s = f.app.database.owned("platform"),
    r = read(f);
  const prepared = r.commands.find(
    (c) => c.command === "carrier.canada-post.group.prepare",
  )!;
  const entries = prepared.payload.entries as unknown[];
  assert.equal(entries.length, 2);
  // Represents a legitimate alternate original input order, no retained order
  // preimage. Matching audit/hash alone cannot authorize guessing that order.
  const hash = digest(
    canonical({ ...prepared.payload, entries: [...entries].reverse() }),
  );
  s.run(
    "UPDATE platform_commands SET hash=? WHERE name=?",
    hash,
    prepared.command,
  );
  s.run(
    "UPDATE platform_audit SET detail=? WHERE action=?",
    canonical({ requestHash: hash }),
    prepared.command,
  );
  assert.throws(() => read(f), bad);
});
test("schema-shaped release receipt stays blocked even with its retained audit fields", async (t) => {
  const f = await setup(t, "CA", "CAD", false, true),
    s = f.app.database.owned("platform");
  const target = { kind: "member", groupId: f.groupId, bookingId: f.bookingId },
    claimHash = "e".repeat(64);
  const payload = {
      target,
      minimumAgeMs: 1,
      claimHash,
      reason: "Synthetic historical release",
    },
    hash = digest(canonical(payload));
  // Synthetic retained history; no ordinary release executes through the hold.
  f.app.platform.audit(f.actor, "carrier.claim.released", f.groupId, {
    target,
    minimumAgeMs: 1,
    startedAt: 1,
    claimHash,
    reason: payload.reason,
  });
  f.app.platform.audit(f.actor, "carrier.claim.release", "retained-release", {
    requestHash: hash,
  });
  s.run(
    "INSERT INTO platform_commands VALUES(?,?,?,?,?,?,?)",
    f.actor.orgId,
    f.actor.id,
    "carrier.claim.release",
    "retained-release",
    hash,
    JSON.stringify({ target, state: "unknown", claimHash }),
    "2026-10-04T00:00:00.000Z",
  );
  assert(
    read(f).blockers.includes(
      "CANCELLATION_OR_RELEASE_REQUEST_PREIMAGE_UNSUPPORTED",
    ),
  );
});
test("preflight JSON complexity and UTF8 byte overflow precede Platform row materialization", async (t) => {
  const f = await setup(t, "CA", "CAD", false, true),
    s = f.app.database.owned("platform");
  for (const value of [
    "[".repeat(513) + "0" + "]".repeat(513),
    JSON.stringify({ huge: "界".repeat(22000) }),
  ]) {
    let materialized = 0;
    const all = Store.prototype.all;
    const spy = t.mock.method(
      Store.prototype,
      "all",
      function (this: Store, ...args: Parameters<typeof all>) {
        if (/platform_(commands|audit|events)/.test(args[0])) materialized++;
        return all.apply(this, args);
      },
    );
    try {
      assert.throws(
        () =>
          f.app.database.transaction(() => {
            s.run(
              "UPDATE platform_commands SET result=? WHERE name='carrier.prepare'",
              value,
            );
            reader(f).getInTransaction(f.actor, f.groupId, f.bookingId);
          }),
        { code: "OFFLINE_CANADA_POST_COMMAND_LIMIT" },
      );
      assert.equal(materialized, 0);
    } finally {
      spy.mock.restore();
    }
  }
});
test("reentry refuses before nested owner hooks and the enclosing reader remains usable", async (t) => {
  const f = await setup(t, "CA", "CAD", false, true),
    r = reader(f),
    original =
      CarrierOfflineMemberReview.prototype.reviewUnknownMemberInTransaction;
  let attempts = 0;
  const spy = t.mock.method(
    CarrierOfflineMemberReview.prototype,
    "reviewUnknownMemberInTransaction",
    function (
      this: CarrierOfflineMemberReview,
      ...args: Parameters<typeof original>
    ) {
      attempts++;
      assert.throws(
        () => r.getInTransaction(f.actor, f.groupId, f.bookingId),
        bad,
      );
      return original.apply(this, args);
    },
  );
  try {
    f.app.database.transaction(() =>
      r.getInTransaction(f.actor, f.groupId, f.bookingId),
    );
    assert.equal(attempts, 2);
  } finally {
    spy.mock.restore();
  }
  assert.deepEqual(read(f).blockers, [
    "SOURCE_INTERVAL_AND_PROVIDER_TRUTH_NOT_QUALIFIED",
  ]);
});
for (const fault of ["authority", "hold", "command", "custody"] as const)
  test(`late native callback ${fault} corruption refuses and escapes outer rollback`, async (t) => {
    const f = await setup(t, "CA", "CAD", false, true),
      before = snapshot(f),
      original = Fulfillment.prototype.reviewPackedCarrierCustodyInTransaction;
    let changed = false;
    const spy = t.mock.method(
      Fulfillment.prototype,
      "reviewPackedCarrierCustodyInTransaction",
      function (this: Fulfillment, ...args: Parameters<typeof original>) {
        const result = original.apply(this, args);
        if (!changed) {
          changed = true;
          if (fault === "authority")
            f.app.database
              .owned("iam")
              .run("UPDATE iam_users SET active=0 WHERE id=?", f.actor.id);
          if (fault === "hold")
            f.app.database
              .owned("platform")
              .run("DELETE FROM platform_recovery");
          if (fault === "command")
            f.app.database
              .owned("platform")
              .run(
                "UPDATE platform_commands SET created_at='2026-10-04T01:00:00.000Z' WHERE name='carrier.prepare'",
              );
          if (fault === "custody")
            f.app.database
              .owned("fulfillment")
              .run(
                "UPDATE fulfillment_shipments SET address='changed' WHERE id=?",
                args[1],
              );
        }
        return result;
      },
    );
    try {
      assert.throws(() => read(f));
      assert(changed);
      assert.equal(snapshot(f), before);
    } finally {
      spy.mock.restore();
    }
  });
test("actual fixed owners must share one database; fake/proxy owner rejected without traps", async (t) => {
  const f = await setup(t, "CA", "CAD", false, true);
  let traps = 0;
  const trap = () => {
    traps++;
    throw Error("owner trap");
  };
  const p = new Proxy(f.app.carriers, {
    get: trap,
    getPrototypeOf: trap,
    ownKeys: trap,
    getOwnPropertyDescriptor: trap,
  });
  assert.throws(
    () =>
      new PlatformOfflineCanadaPostCommandReviewReader(
        f.app.database,
        f.app.identity,
        f.app.platform,
        f.app.fulfillment,
        p,
      ),
    bad,
  );
  const other = new Application(f.path, "CA", { eventReports: false });
  try {
    assert.throws(
      () =>
        new PlatformOfflineCanadaPostCommandReviewReader(
          f.app.database,
          f.app.identity,
          f.app.platform,
          other.fulfillment,
          f.app.carriers,
        ),
      bad,
    );
  } finally {
    other.close();
  }
  assert.equal(traps, 0);
});
test("finance-only role cannot bypass existing native warehouse/admin readers", async (t) => {
  const f = await setup(t, "CA", "CAD", false, true),
    before = snapshot(f);
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        f.app.database
          .owned("iam")
          .run("UPDATE iam_users SET role='finance' WHERE id=?", f.actor.id);
        reader(f).getInTransaction(f.actor, f.groupId, f.bookingId);
      }),
    { code: "FORBIDDEN" },
  );
  assert.equal(snapshot(f), before);
});

test("retained predecessor preparations are reconstructed but their cancellation remains blocked", async (t) => {
  const f = await setup(t, "CA", "CAD", false, true, true, true),
    r = read(f);
  assert.equal(
    r.commands.filter((c) => c.command === "carrier.prepare").length,
    4,
  );
  assert.equal(
    r.commands.filter((c) => c.command === "carrier.canada-post.group.prepare")
      .length,
    2,
  );
  assert(
    r.blockers.includes("CANCELLATION_OR_RELEASE_REQUEST_PREIMAGE_UNSUPPORTED"),
  );
  assert(
    r.commands.some(
      (c) => c.command === "carrier.prepare" && c.payload.previousId !== null,
    ),
  );
});
test("all captured history is detached and a stale scalar request hash cannot survive a new call", async (t) => {
  const f = await setup(t, "CA", "CAD", false, true),
    r = read(f),
    saved = canonical(r),
    s = f.app.database.owned("platform");
  assert.throws(
    () => Object.assign(r.commands[0]!.payload, { shipmentId: "forged" }),
    TypeError,
  );
  const c = r.commands[0]!;
  s.run(
    "UPDATE platform_commands SET hash=? WHERE name=? AND key=?",
    "f".repeat(64),
    c.command,
    c.key,
  );
  assert.throws(() => read(f));
  assert.equal(canonical(r), saved);
});

test("retained manifest claim cannot be cleared by merely matching a group identity", async (t) => {
  const f = await setup(t, "CA", "CAD", false, true);
  f.app.platform.audit(
    f.actor,
    "carrier.canada-post.manifest.claimed",
    f.groupId,
    { reviewHash: "a".repeat(64), send: true, memberHash: "b".repeat(64) },
  );
  assert(read(f).blockers.includes("NATIVE_UNJOINED_CARRIER_OUTCOME"));
});
