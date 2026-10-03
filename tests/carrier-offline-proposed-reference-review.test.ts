import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Application } from "../src/server/application.ts";
import { Store } from "../src/server/database.ts";
import { canonical, digest } from "../src/server/core.ts";
import type {
  CarrierIntent,
  CanadaPostManifestClient,
} from "../src/server/carrier-bookings.ts";
import { canadaPostConfigurationHash } from "../src/server/canada-post-evidence.ts";
import { fixture, accept, chooseProviders } from "./fixtures.ts";
import { origin } from "./canada-post-fixture.ts";

// Native three-shipment setup preserves the independently reproduced outside-group case.
async function setup(
  t: Parameters<typeof fixture>[0],
  region: "CA" | "US" = "CA",
  currency: "CAD" | "USD" = "CAD",
  reports = false,
  options: {
    differentConfiguration?: boolean;
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

type F = Awaited<ReturnType<typeof setup>>;
const input = (f: F) => ({
  groupId: f.groupId,
  bookingId: f.bookingId,
  providerShipmentId: "PROPOSED_UNUSED_ID",
  tracking: "8888888888888888",
});
const inside = (f: F, proposal: unknown = input(f)) =>
  f.app.carrierOfflineMemberReview.reviewProposedReferencesInTransaction(
    f.actor,
    proposal,
  );
const review = (f: F, proposal: unknown = input(f)) =>
  f.app.database.transaction(() => inside(f, proposal));
const store = (f: F) => f.app.database.owned("integration");
const changes = (f: F) => store(f).get("SELECT total_changes() AS n")!.n;
function frozen(value: unknown): void {
  if (value && typeof value === "object") {
    assert.ok(Object.isFrozen(value));
    Object.values(value).forEach(frozen);
  }
}
function outside(f: F) {
  assert.ok(f.outside);
  return f.outside;
}

for (const [region, currency] of [
  ["CA", "CAD"],
  ["CA", "USD"],
  ["US", "USD"],
] as const)
  test(`${region}/${currency}: exact frozen private-scope commitments, no unrelated rows, no writes, old hashes compatible`, async (t) => {
    const f = await setup(t, region, currency),
      before = changes(f),
      proposal = input(f);
    const result = review(f, proposal);
    assert.equal(changes(f), before);
    assert.equal(
      result.memberReviewHash,
      f.app.database.transaction(() =>
        f.app.carrierOfflineMemberReview.reviewUnknownMemberInTransaction(
          f.actor,
          f.groupId,
          f.bookingId,
        ),
      ).reviewHash,
    );
    assert.deepEqual(result.proposed, proposal);
    assert.notEqual(result.proposed, proposal);
    assert.deepEqual(result.references, {
      members: 2,
      bookings: 0,
      promotedCopies: 0,
      distinct: 2,
    });
    assert.equal(result.configurationHash, f.configurationHash);
    assert.equal(result.region, region);
    assert.equal(result.currency, currency);
    const { reviewHash, ...body } = result;
    assert.equal(reviewHash, digest(canonical(body)));
    assert.match(result.scopeHash, /^[a-f0-9]{64}$/);
    for (const hidden of [
      f.outsideShipmentId,
      f.outsideTracking,
      outside(f).id,
      f.entries[2]!.bookingId,
    ])
      assert.ok(!canonical(result).includes(hidden));
    assert.ok(
      result.blockers.includes(
        "PROVIDER_ACCOUNT_EQUIVALENCE_AND_EXTERNAL_REFERENCES_UNQUALIFIED",
      ),
    );
    frozen(result);
    proposal.tracking = "7777777777777777";
    assert.equal(result.proposed.tracking, "8888888888888888");
    assert.throws(() => {
      (result.proposed as { tracking: string }).tracking = "changed";
    }, TypeError);
    assert.deepEqual(review(f), result);
  });

for (const field of ["providerShipmentId", "tracking"] as const)
  for (const differentConfiguration of [false, true])
    test(`outside-group ${field} conflicts independently, changed configuration=${differentConfiguration}`, async (t) => {
      const f = await setup(t, "CA", "CAD", false, { differentConfiguration }),
        proposal = input(f),
        before = changes(f);
      proposal[field] =
        field === "tracking" ? f.outsideTracking : f.outsideShipmentId;
      assert.throws(() => review(f, proposal), {
        code: "CARRIER_OFFLINE_REFERENCE_CONFLICT",
      });
      assert.equal(changes(f), before);
    });

test("other configuration with nonmatching proposed pair refuses account equivalence rather than manufacturing a new account", async (t) => {
  const f = await setup(t, "CA", "CAD", false, {
    differentConfiguration: true,
  });
  assert.throws(() => review(f), { code: "CARRIER_OFFLINE_ACCOUNT_AMBIGUOUS" });
});

test("actual native manifest promotion is counted once and preserves collision rejection", async (t) => {
  const f = await setup(t, "CA", "CAD", false, { promote: true });
  const result = review(f);
  assert.deepEqual(result.references, {
    members: 2,
    bookings: 1,
    promotedCopies: 1,
    distinct: 2,
  });
  assert.equal(
    store(f).get(
      "SELECT state FROM integration_carrier_bookings WHERE id=?",
      f.entries[2]!.bookingId,
    )!.state,
    "booked",
  );
  assert.throws(() => review(f, { ...input(f), tracking: f.outsideTracking }), {
    code: "CARRIER_OFFLINE_REFERENCE_CONFLICT",
  });
});

test("ordinary Canada Post booking reference without group is searched", async (t) => {
  const f = await setup(t, "CA", "CAD", false, { ordinary: true });
  assert.deepEqual(review(f).references, {
    members: 1,
    bookings: 1,
    promotedCopies: 0,
    distinct: 2,
  });
  for (const proposal of [
    { ...input(f), tracking: f.outsideTracking },
    { ...input(f), providerShipmentId: f.outsideShipmentId },
  ])
    assert.throws(() => review(f, proposal), {
      code: "CARRIER_OFFLINE_REFERENCE_CONFLICT",
    });
});

test("fresh writer, current IAM/password/site/org and raw hold remain mandatory", async (t) => {
  const f = await setup(t),
    iam = f.app.database.owned("iam");
  assert.throws(() => inside(f), { code: "TRANSACTION" });
  for (const assignment of [
    "active=0",
    "role='finance'",
    "org_id='foreign'",
    "role='warehouse',sites='[]'",
  ])
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          iam.run(`UPDATE iam_users SET ${assignment} WHERE id=?`, f.actor.id);
          inside(f);
        }),
      { code: "FORBIDDEN" },
    );
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
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        f.app.database.owned("platform").run("DELETE FROM platform_recovery");
        inside(f);
      }),
    { code: "RECOVERY_HOLD_REQUIRED" },
  );
  assert.throws(
    () =>
      store(f).visit("SELECT id FROM integration_canada_post_groups", [], () =>
        inside(f),
      ),
    { code: "TRANSACTION" },
  );
  assert.ok(review(f));
});

test("input proxy/accessor/prototype/unknown-key refusals run no traps and cannot read inventory", async (t) => {
  const f = await setup(t);
  let traps = 0,
    reads = 0;
  const original = Store.prototype.all;
  t.mock.method(
    Store.prototype,
    "all",
    function (this: Store, ...args: Parameters<Store["all"]>) {
      reads++;
      return original.apply(this, args);
    },
  );
  const p = Proxy.revocable(input(f), {
    get() {
      traps++;
      return undefined;
    },
    getPrototypeOf() {
      traps++;
      return Object.prototype;
    },
    ownKeys() {
      traps++;
      return [];
    },
  });
  const accessor = { ...input(f) };
  Object.defineProperty(accessor, "tracking", {
    enumerable: true,
    get() {
      traps++;
      return f.outsideTracking;
    },
  });
  const nested = new Proxy(
    {},
    {
      get() {
        traps++;
        return undefined;
      },
    },
  );
  for (const value of [
    p.proxy,
    accessor,
    { ...input(f), tracking: nested },
    Object.assign(Object.create({ extra: 1 }), input(f)),
    { ...input(f), collisionFree: true },
    [],
    null,
  ])
    assert.throws(() => review(f, value), { code: "CARRIER_OFFLINE_REVIEW" });
  p.revoke();
  assert.throws(() => review(f, p.proxy), { code: "CARRIER_OFFLINE_REVIEW" });
  assert.equal(traps, 0);
  assert.equal(reads, 0);
});

test("strict scalar bounds reject oversized, numeric, malformed and multi-proposal inputs", async (t) => {
  const f = await setup(t);
  for (const [key, values] of Object.entries({
    groupId: ["x".repeat(129), "\0", 1],
    bookingId: ["", null],
    providerShipmentId: ["x".repeat(33), "bad space", {}],
    tracking: ["1".repeat(17), "1".repeat(10), 12345678901, NaN, Infinity],
  }))
    for (const value of values)
      assert.throws(() => review(f, { ...input(f), [key]: value }), {
        code: "CARRIER_OFFLINE_REVIEW",
      });
  assert.throws(
    () => review(f, { ...input(f), proposals: Array(101).fill(input(f)) }),
    { code: "CARRIER_OFFLINE_REVIEW" },
  );
  assert.ok(
    review(f, {
      ...input(f),
      providerShipmentId: "x".repeat(32),
      tracking: "1".repeat(11),
    }),
  );
});

test("same-writer uncommitted reference change is seen, late caller failure rolls it back, result survives restart detached", async (t) => {
  const f = await setup(t),
    before = review(f),
    s = store(f);
  let during: ReturnType<typeof review> | undefined;
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        s.run(
          "UPDATE integration_canada_post_members SET tracking='7777777777777777' WHERE group_id=?",
          outside(f).id,
        );
        during = inside(f);
        assert.notEqual(during.scopeHash, before.scopeHash);
        assert.throws(
          () => inside(f, { ...input(f), tracking: "7777777777777777" }),
          { code: "CARRIER_OFFLINE_REFERENCE_CONFLICT" },
        );
        throw Error("late caller failure");
      }),
    /late caller failure/,
  );
  assert.deepEqual(review(f), before);
  assert.ok(during);
  frozen(during);
  f.app.close();
  f.app = new Application(f.path);
  f.originalFixture.app = f.app;
  assert.deepEqual(review(f), before);
});

for (const [name, sql] of [
  [
    "copied foreign member",
    "UPDATE integration_canada_post_members SET org_id='foreign' WHERE group_id=?",
  ],
  [
    "inactive created reference",
    "UPDATE integration_canada_post_members SET active=0 WHERE group_id=?",
  ],
  [
    "partial artifact",
    "UPDATE integration_canada_post_members SET tracking=NULL WHERE group_id=?",
  ],
  [
    "invalid PDF",
    "UPDATE integration_canada_post_members SET label_bytes=x'00' WHERE group_id=?",
  ],
] as const)
  test(`${name} cannot disappear behind selection`, async (t) => {
    const f = await setup(t);
    assert.throws(() =>
      f.app.database.transaction(() => {
        store(f).run(sql, outside(f).id);
        inside(f);
      }),
    );
    assert.ok(review(f));
  });

test("copied booking org/intent and orphan group cannot disappear", async (t) => {
  const f = await setup(t),
    s = store(f);
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        s.run(
          "UPDATE integration_carrier_bookings SET org_id='foreign' WHERE id=?",
          f.entries[2]!.bookingId,
        );
        inside(f);
      }),
    { code: "CARRIER_OFFLINE_REVIEW" },
  );
  // Valid SQL owner insert of a disconnected empty group; no FK/authorizer bypass.
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        s.run(
          "INSERT INTO integration_canada_post_groups SELECT 'orphan',org_id,warehouse_id,configuration_hash,'orphan',review_hash,'prepared',NULL,NULL,NULL,NULL,NULL,created_at FROM integration_canada_post_groups WHERE id=?",
          outside(f).id,
        );
        inside(f);
      }),
    { code: "CARRIER_OFFLINE_REVIEW" },
  );
});

test("byte/UTF8/blob/aggregate and unsafe integer budgets refuse before row materialization", async (t) => {
  const f = await setup(t),
    s = store(f),
    original = Store.prototype.all;
  let fetched = 0;
  t.mock.method(
    Store.prototype,
    "all",
    function (this: Store, sql: string, ...args: unknown[]) {
      if (/FROM integration_(carrier|canada_post)/.test(sql)) fetched++;
      return original.call(this, sql, ...(args as never[]));
    },
  );
  for (const [sql, args] of [
    ["UPDATE integration_carrier_bookings SET error=?", ["é".repeat(2049)]],
    ["UPDATE integration_carrier_bookings SET intent=?", ["x".repeat(262145)]],
    [
      "UPDATE integration_canada_post_members SET label_bytes=? WHERE group_id=?",
      [Buffer.alloc(1048577), outside(f).id],
    ],
    ["UPDATE integration_carrier_bookings SET intent=?", ["x".repeat(262144)]],
    [
      "UPDATE integration_canada_post_members SET started_at=9007199254740992 WHERE group_id=?",
      [outside(f).id],
    ],
    [
      "UPDATE integration_carrier_bookings SET sequence=9007199254740992 WHERE id=?",
      [f.entries[2]!.bookingId],
    ],
  ] as [string, (string | Buffer)[]][])
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          s.run(sql, ...args);
          inside(f);
        }),
      { code: "CARRIER_OFFLINE_REVIEW_LIMIT" },
    );
  assert.equal(fetched, 0);
});

test("whole group count bound precedes row materialization", async (t) => {
  const f = await setup(t),
    s = store(f),
    original = Store.prototype.all;
  let fetched = 0;
  t.mock.method(
    Store.prototype,
    "all",
    function (this: Store, ...args: Parameters<Store["all"]>) {
      fetched++;
      return original.apply(this, args);
    },
  );
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        for (let i = 0; i < 127; i++)
          s.run(
            "INSERT INTO integration_canada_post_groups SELECT ?,org_id,warehouse_id,configuration_hash,?,review_hash,'prepared',NULL,NULL,NULL,NULL,NULL,created_at FROM integration_canada_post_groups WHERE id=?",
            `extra-${i}`,
            `extra-${i}`,
            outside(f).id,
          );
        inside(f);
      }),
    { code: "CARRIER_OFFLINE_REVIEW_LIMIT" },
  );
  assert.equal(fetched, 0);
});

test(
  "separate native connection cannot replace references while the reviewer holds the real writer",
  { timeout: 15000 },
  async (t) => {
    const f = await setup(t),
      second = new Application(f.path),
      before = review(f);
    try {
      f.app.database.transaction(() => {
        assert.deepEqual(inside(f), before);
        assert.throws(
          () =>
            second.database.transaction(() => {
              second.database
                .owned("integration")
                .run(
                  "UPDATE integration_canada_post_members SET tracking='8888888888888888' WHERE group_id=?",
                  outside(f).id,
                );
            }),
          /database is locked/,
        );
        assert.deepEqual(inside(f), before);
      });
      second.database.transaction(() =>
        second.database
          .owned("integration")
          .run(
            "UPDATE integration_canada_post_members SET tracking='8888888888888888' WHERE group_id=?",
            outside(f).id,
          ),
      );
      assert.throws(() => review(f), {
        code: "CARRIER_OFFLINE_REFERENCE_CONFLICT",
      });
      assert.equal(before.proposed.tracking, "8888888888888888");
      frozen(before);
    } finally {
      second.close();
    }
  },
);

test("ordinary booked reference with missing configuration refuses unresolved account scope", async (t) => {
  const f = await setup(t, "CA", "CAD", false, { ordinary: true }),
    s = store(f);
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        const b = s.get(
          "SELECT * FROM integration_carrier_bookings WHERE id=?",
          f.entries[2]!.bookingId,
        )!;
        const i = JSON.parse(String(b.intent));
        delete i.configuration;
        delete i.configurationHash;
        const { bookingId, reviewHash: old, ...body } = i;
        i.reviewHash = digest(canonical(body));
        s.run(
          "UPDATE integration_carrier_bookings SET intent=?,review_hash=? WHERE id=?",
          canonical(i),
          i.reviewHash,
          bookingId,
        );
        inside(f);
      }),
    { code: "CARRIER_OFFLINE_ACCOUNT_AMBIGUOUS" },
  );
});

test("incoherent native promotion and malformed ordinary reference refuse without silently deduplicating", async (t) => {
  const f = await setup(t, "CA", "CAD", false, { promote: true }),
    s = store(f);
  for (const sql of [
    "UPDATE integration_carrier_bookings SET tracking='7777777777777777' WHERE id=?",
    "UPDATE integration_carrier_bookings SET label_hash='bad' WHERE id=?",
    "UPDATE integration_carrier_bookings SET reference=NULL WHERE id=?",
  ])
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          s.run(sql, f.entries[2]!.bookingId);
          inside(f);
        }),
      { code: "CARRIER_OFFLINE_REVIEW" },
    );
  assert.equal(review(f).references.promotedCopies, 1);
});

test("promotion cannot deduplicate a copied transmitted state with missing or changed retained manifest", async (t) => {
  const f = await setup(t, "CA", "CAD", false, { promote: true }),
    s = store(f);
  for (const sql of [
    "UPDATE integration_canada_post_groups SET observation=NULL WHERE id=?",
    "UPDATE integration_canada_post_groups SET manifest_bytes=x'00' WHERE id=?",
    "UPDATE integration_canada_post_groups SET observation=json_set(observation,'$.memberHash',?) WHERE id=?",
  ])
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          if (sql.includes("json_set"))
            s.run(sql, "a".repeat(64), outside(f).id);
          else s.run(sql, outside(f).id);
          inside(f);
        }),
      { code: "CARRIER_OFFLINE_REVIEW" },
    );
  assert.equal(review(f).references.promotedCopies, 1);
});

test("ordinary outside booking cannot hide a copied shipment identity inside its retained snapshot", async (t) => {
  const f = await setup(t, "CA", "CAD", false, { ordinary: true }),
    s = store(f);
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        const b = s.get(
          "SELECT * FROM integration_carrier_bookings WHERE id=?",
          f.entries[2]!.bookingId,
        )!;
        const i = JSON.parse(String(b.intent));
        i.nativeSnapshot.id = "copied-other-shipment";
        const { bookingId, reviewHash: old, ...body } = i;
        i.reviewHash = digest(canonical(body));
        s.run(
          "UPDATE integration_carrier_bookings SET intent=?,review_hash=? WHERE id=?",
          canonical(i),
          i.reviewHash,
          bookingId,
        );
        inside(f);
      }),
    { code: "CARRIER_OFFLINE_REVIEW" },
  );
});
