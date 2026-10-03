import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { fixture, accept, chooseProviders } from "./fixtures.ts";
import { origin } from "./canada-post-fixture.ts";
import { carrierConfiguration } from "../src/server/carrier-configuration.ts";
import { canonical, digest } from "../src/server/core.ts";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { createBackup, restoreBackup } from "../src/server/recovery.ts";
import { setup as legacySetup } from "./canada-post-fixture.ts";
import { Application } from "../src/server/application.ts";

function setup(
  t: Parameters<typeof fixture>[0],
  reports = false,
  cancelBookings = true,
  keysAreIds = false,
  mismatchedGroupConfiguration = false,
) {
  const f = fixture(t, { eventReports: reports });
  chooseProviders(f, f.actor, "cp-choice", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["canada-post"],
    version: 1,
    acknowledgment: "Synthetic choice",
  });
  const configuration = carrierConfiguration(
    "canada-post",
    { customer: "synthetic-account" },
    "Synthetic account",
    ["CA domestic"],
    [{ service: "DOM.EP", description: "Synthetic service" }],
  );
  const entries = [0, 1].map((i) => {
    const orderId = accept(f, 1, `restore-order-${i}`).id;
    const picks = f.app.fulfillment.picks(f.actor, orderId);
    for (const pick of picks)
      f.app.fulfillment.pick(f.actor, `restore-pick-${i}`, {
        orderId,
        allocationId: pick.id,
        serial: pick.serial,
      });
    const address = "Synthetic CA destination";
    const shipmentId = f.app.fulfillment.pack(f.actor, `restore-pack-${i}`, {
      orderId,
      revision: f.app.orders.order(f.actor, orderId).revision,
      mode: "carrier",
      address,
      lines: picks.map((p) => ({ allocationId: p.id, quantity: p.quantity })),
    }).id;
    const booking = f.app.carriers.prepare(
      f.actor,
      `restore-booking-${i}`,
      {
        shipmentId,
        previousId: null,
        provider: "canada-post",
        service: "DOM.EP",
        origin,
        destination: { ...origin, name: "Synthetic receiver" },
        parcel: {
          weightGrams: 1000,
          lengthMm: 100,
          widthMm: 100,
          heightMm: 100,
        },
        reviewedDestination: address,
        acknowledgment: "Synthetic reviewed parcel",
        configurationHash: configuration.hash,
      },
      configuration,
    );
    return { bookingId: booking.id, reviewHash: booking.reviewHash };
  });
  const group = f.app.carriers.prepareCanadaPostGroup(
    f.actor,
    "restore-group",
    {
      configurationHash: mismatchedGroupConfiguration
        ? "b".repeat(64)
        : configuration.hash,
      entries,
    },
  );
  const cancel = {
    groupId: group.id,
    reviewHash: group.reviewHash,
    reason: "Synthetic wholly unsent group",
  };
  f.app.carriers.cancelCanadaPostGroup(
    f.actor,
    keysAreIds ? group.id : "restore-cancel",
    cancel,
  );
  for (const entry of cancelBookings ? entries : [])
    f.app.carriers.cancel(
      f.actor,
      keysAreIds ? entry.bookingId : `cancel-${entry.bookingId}`,
      {
        ...entry,
        reason: "Synthetic booking canceled separately",
      },
    );
  return { ...f, group, entries, configuration, cancel };
}
type F = ReturnType<typeof setup>;
function sql(f: F, statement: string, ...params: (string | number)[]) {
  const db = new DatabaseSync(f.path);
  try {
    return db.prepare(statement).run(...params);
  } finally {
    db.close();
  }
}
function rows(f: F) {
  const db = new DatabaseSync(f.path, { readOnly: true });
  try {
    return canonical(
      db
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all()
        .map((r) => [
          r.name,
          db.prepare(`SELECT * FROM ${r.name} ORDER BY rowid`).all(),
        ]),
    );
  } finally {
    db.close();
  }
}
function projection(f: F) {
  return f.app.carriers.reviewCanceledCanadaPostMember(
    f.actor,
    f.group.id,
    f.entries[0]!.bookingId,
  );
}

test("native cancellation actually retains inactive pending members after separate booking cancellations", (t) => {
  const f = setup(t),
    db = new DatabaseSync(f.path, { readOnly: true });
  try {
    assert.equal(
      db
        .prepare("SELECT state FROM integration_canada_post_groups WHERE id=?")
        .get(f.group.id)!.state,
      "canceled",
    );
    assert.deepEqual(
      db
        .prepare(
          "SELECT active,state FROM integration_canada_post_members WHERE group_id=?",
        )
        .all(f.group.id)
        .map((r) => ({ ...r })),
      [
        { active: 0, state: "pending" },
        { active: 0, state: "pending" },
      ],
    );
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) n FROM integration_carrier_bookings WHERE state='canceled'",
        )
        .get()!.n,
      2,
    );
  } finally {
    db.close();
  }
});
for (const reports of [false, true])
  test(`CA reporting=${reports}: disposition is exact, read-only, retained under hold and restart`, (t) => {
    const f = setup(t, reports);
    f.app.platform.isolateRestore("synthetic-source", "2026-10-03T00:00:00Z");
    const before = rows(f),
      first = projection(f);
    assert.equal(first.disposition, "canceled-unused-membership");
    assert.equal(first.groupId, f.group.id);
    assert.equal(first.bookingId, f.entries[0]!.bookingId);
    assert.equal(first.members.length, 2);
    assert.equal(first.configurationHash, f.configuration.hash);
    const { evidenceHash, ...body } = first;
    assert.equal(evidenceHash, digest(canonical(body)));
    assert.deepEqual(projection(f), first);
    assert.equal(rows(f), before);
    const reopened = new Application(f.path, "CA", { eventReports: reports });
    try {
      assert.deepEqual(
        reopened.carriers.reviewCanceledCanadaPostMember(
          f.actor,
          f.group.id,
          f.entries[0]!.bookingId,
        ),
        first,
      );
      assert(reopened.platform.recoveryHold());
    } finally {
      reopened.close();
    }
    assert.equal(rows(f), before);
  });

const attacks: [string, (f: F) => void][] = [
  [
    "missing cancellation command",
    (f) => {
      sql(
        f,
        "DELETE FROM platform_commands WHERE name='carrier.canada-post.group.cancel'",
      );
    },
  ],
  [
    "altered cancellation receipt",
    (f) => {
      sql(
        f,
        "UPDATE platform_commands SET hash=? WHERE name='carrier.canada-post.group.cancel'",
        "0".repeat(64),
      );
    },
  ],
  [
    "altered reason",
    (f) => {
      sql(
        f,
        "UPDATE platform_audit SET detail=json_set(detail,'$.reason','different') WHERE action='carrier.canada-post.group.canceled'",
      );
    },
  ],
  [
    "missing command audit",
    (f) => {
      sql(
        f,
        "DELETE FROM platform_audit_order WHERE audit_id IN(SELECT id FROM platform_audit WHERE action='carrier.canada-post.group.cancel')",
      );
      sql(
        f,
        "DELETE FROM platform_audit WHERE action='carrier.canada-post.group.cancel'",
      );
    },
  ],
  [
    "missing preparation event",
    (f) => {
      sql(
        f,
        "DELETE FROM platform_events WHERE type='carrier.canada-post.group.prepared'",
      );
    },
  ],
  [
    "altered cancellation event",
    (f) => {
      sql(
        f,
        "UPDATE platform_events SET payload='{}' WHERE type='carrier.canada-post.group.canceled'",
      );
    },
  ],
  [
    "missing preparation receipt",
    (f) => {
      sql(
        f,
        "DELETE FROM platform_commands WHERE name='carrier.canada-post.group.prepare'",
      );
    },
  ],
  [
    "unknown member",
    (f) => {
      sql(
        f,
        "UPDATE integration_canada_post_members SET state='unknown' WHERE booking_id=?",
        f.entries[0]!.bookingId,
      );
    },
  ],
  [
    "active member",
    (f) => {
      sql(
        f,
        "UPDATE integration_canada_post_members SET active=1 WHERE booking_id=?",
        f.entries[0]!.bookingId,
      );
    },
  ],
  [
    "other member claim",
    (f) => {
      sql(
        f,
        "UPDATE integration_canada_post_members SET token='claim' WHERE booking_id=?",
        f.entries[1]!.bookingId,
      );
    },
  ],
  [
    "member artifact",
    (f) => {
      sql(
        f,
        "UPDATE integration_canada_post_members SET provider_shipment_id='external' WHERE booking_id=?",
        f.entries[1]!.bookingId,
      );
    },
  ],
  [
    "group claim",
    (f) => {
      sql(
        f,
        "UPDATE integration_canada_post_groups SET token='claim' WHERE id=?",
        f.group.id,
      );
    },
  ],
  [
    "group observation",
    (f) => {
      sql(
        f,
        "UPDATE integration_canada_post_groups SET observation='{}' WHERE id=?",
        f.group.id,
      );
    },
  ],
  [
    "booking claim",
    (f) => {
      sql(
        f,
        "UPDATE integration_carrier_bookings SET token='claim' WHERE id=?",
        f.entries[1]!.bookingId,
      );
    },
  ],
  [
    "booking provider artifact",
    (f) => {
      sql(
        f,
        "UPDATE integration_carrier_bookings SET reference='external' WHERE id=?",
        f.entries[1]!.bookingId,
      );
    },
  ],
  [
    "different member set",
    (f) => {
      sql(
        f,
        "DELETE FROM integration_canada_post_members WHERE booking_id=?",
        f.entries[1]!.bookingId,
      );
    },
  ],
  [
    "wrong member organization",
    (f) => {
      sql(
        f,
        "UPDATE integration_canada_post_members SET org_id='other' WHERE booking_id=?",
        f.entries[0]!.bookingId,
      );
    },
  ],
  [
    "wrong group configuration",
    (f) => {
      sql(
        f,
        "UPDATE integration_canada_post_groups SET configuration_hash=? WHERE id=?",
        "b".repeat(64),
        f.group.id,
      );
    },
  ],
  [
    "altered native account",
    (f) => {
      sql(
        f,
        "UPDATE integration_carrier_bookings SET intent=json_set(intent,'$.nativeSnapshot.account_id','other') WHERE id=?",
        f.entries[0]!.bookingId,
      );
    },
  ],
  [
    "hidden transmission history",
    (f) => {
      sql(
        f,
        "INSERT INTO platform_audit VALUES('synthetic-extra',?,?, 'carrier.canada-post.manifest.claimed',?,'{}','2026-10-03')",
        f.actor.orgId,
        f.actor.id,
        f.group.id,
      );
    },
  ],
];
for (const [name, mutate] of attacks)
  test(`${name} refuses disposition without writes`, (t) => {
    const f = setup(t);
    mutate(f);
    const before = rows(f);
    assert.throws(
      () => projection(f),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        [
          "CARRIER_DISPOSITION_UNRESOLVED",
          "CARRIER_MISMATCH",
          "NOT_FOUND",
          "CARRIER_CONFIG",
        ].includes(String(error.code)),
    );
    assert.equal(rows(f), before);
  });

for (const reports of [false, true])
  test(`encrypted restored CA reporting=${reports} retains exact cancellation projection`, async (t) => {
    const f = setup(t, reports),
      before = projection(f),
      key = randomBytes(32);
    const archive = join(dirname(f.path), "carrier.backup"),
      target = join(dirname(f.path), "restored.db");
    await createBackup(f.path, archive, "CA", key);
    await restoreBackup(archive, target, "CA", key);
    const app = new Application(target, "CA", { eventReports: reports });
    try {
      const restored = { ...f, app, path: target },
        snapshot = rows(restored);
      assert.deepEqual(projection(restored), before);
      assert(app.platform.recoveryHold());
      assert.equal(rows(restored), snapshot);
    } finally {
      app.close();
    }
  });
test("member projection does not claim settlement of a still-pending ordinary booking", (t) => {
  const f = setup(t, false, false),
    before = rows(f);
  assert(projection(f).members.every((m) => m.canceled === null));
  assert.equal(rows(f), before);
});
test("native command keys equal to entity IDs do not masquerade as extra transport history", (t) => {
  const f = setup(t, false, true, true);
  assert.equal(projection(f).canceled.key, f.group.id);
});
test("legacy group configuration hash without retained booking account configuration is unresolved", (t) => {
  const f = legacySetup(t, 2),
    group = f.app.carriers.prepareCanadaPostGroup(
      f.actor,
      "legacy-group",
      f.input,
    );
  f.app.carriers.cancelCanadaPostGroup(f.actor, "legacy-cancel", {
    groupId: group.id,
    reviewHash: group.reviewHash,
    reason: "Synthetic legacy",
  });
  assert.throws(
    () =>
      f.app.carriers.reviewCanceledCanadaPostMember(
        f.actor,
        group.id,
        f.input.entries[0]!.bookingId,
      ),
    { code: "CARRIER_DISPOSITION_UNRESOLVED" },
  );
});
test("current actor, site and transaction authority precede retained evidence reads", (t) => {
  const f = setup(t);
  assert.throws(
    () =>
      f.app.carriers.canceledCanadaPostMemberDispositionInTransaction(
        f.actor,
        f.group.id,
        f.entries[0]!.bookingId,
      ),
    { code: "TRANSACTION" },
  );
  assert.deepEqual(
    f.app.database.transaction(() =>
      f.app.carriers.canceledCanadaPostMemberDispositionInTransaction(
        f.actor,
        f.group.id,
        f.entries[0]!.bookingId,
      ),
    ),
    projection(f),
  );
  const reader = f.app.identity.createUser(f.actor, "reader", {
    email: "reader@example.test",
    name: "Reader",
    role: "warehouse",
    sites: [f.w1],
    password: "synthetic-reader-password",
    requirePasswordChange: false,
  });
  const actor = f.app.identity.currentActor({ ...f.actor, id: reader.id });
  assert.equal(
    f.app.carriers.reviewCanceledCanadaPostMember(
      actor,
      f.group.id,
      f.entries[0]!.bookingId,
    ).evidenceHash,
    projection(f).evidenceHash,
  );
  sql(f, "UPDATE iam_users SET sites='[]' WHERE id=?", actor.id);
  assert.throws(
    () =>
      f.app.carriers.reviewCanceledCanadaPostMember(
        actor,
        f.group.id,
        f.entries[0]!.bookingId,
      ),
    { code: "FORBIDDEN" },
  );
  sql(f, "UPDATE iam_users SET active=0 WHERE id=?", actor.id);
  assert.throws(
    () =>
      f.app.carriers.reviewCanceledCanadaPostMember(
        { ...actor, role: "admin" },
        f.group.id,
        f.entries[0]!.bookingId,
      ),
    { code: "FORBIDDEN" },
  );
  assert.throws(() =>
    f.app.carriers.reviewCanceledCanadaPostMember(
      { ...f.actor, orgId: "foreign" },
      f.group.id,
      f.entries[0]!.bookingId,
    ),
  );
});
test("independent connection changes force a fresh read and transport is never called", (t) => {
  const f = setup(t),
    first = projection(f);
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    throw Error("provider IO forbidden");
  });
  const other = new Application(f.path);
  try {
    assert.deepEqual(
      other.carriers.reviewCanceledCanadaPostMember(
        f.actor,
        f.group.id,
        f.entries[0]!.bookingId,
      ),
      first,
    );
    sql(
      f,
      "UPDATE integration_canada_post_members SET token='changed' WHERE booking_id=?",
      f.entries[1]!.bookingId,
    );
    assert.throws(() =>
      other.carriers.reviewCanceledCanadaPostMember(
        f.actor,
        f.group.id,
        f.entries[0]!.bookingId,
      ),
    );
    assert.equal(fetch.mock.callCount(), 0);
  } finally {
    other.close();
  }
});

test("native group cancellation with a different configured booking account remains unresolved", (t) => {
  const f = setup(t, false, true, false, true),
    before = rows(f);
  assert.throws(() => projection(f), {
    code: "CARRIER_DISPOSITION_UNRESOLVED",
  });
  assert.equal(rows(f), before);
});
for (const [table, field, value] of [
  ["integration_canada_post_groups", "started_at", "1"],
  ["integration_canada_post_groups", "manifest_bytes", "X'01'"],
  ["integration_canada_post_groups", "manifest_hash", "'hash'"],
  ["integration_canada_post_members", "started_at", "1"],
  ["integration_canada_post_members", "tracking", "'tracking'"],
  ["integration_canada_post_members", "label_bytes", "X'01'"],
  ["integration_canada_post_members", "label_hash", "'hash'"],
  ["integration_carrier_bookings", "started_at", "1"],
  ["integration_carrier_bookings", "tracking", "'tracking'"],
  ["integration_carrier_bookings", "label_bytes", "X'01'"],
  ["integration_carrier_bookings", "label_type", "'application/pdf'"],
  ["integration_carrier_bookings", "label_hash", "'hash'"],
  ["integration_carrier_bookings", "error", "'uncertain'"],
] as const)
  test(`retained ${table}.${field} is never qualified as unused`, (t) => {
    const f = setup(t);
    sql(f, `UPDATE ${table} SET ${field}=${value}`);
    const before = rows(f);
    assert.throws(() => projection(f), {
      code: "CARRIER_DISPOSITION_UNRESOLVED",
    });
    assert.equal(rows(f), before);
  });
for (const change of [
  "UPDATE platform_commands SET result='{bad' WHERE name='carrier.canada-post.group.cancel'",
  "UPDATE platform_commands SET result=json_set(result,'$.extra',1) WHERE name='carrier.canada-post.group.cancel'",
  "UPDATE platform_audit_order SET sequence=-1 WHERE audit_id IN (SELECT id FROM platform_audit WHERE action='carrier.canada-post.group.canceled')",
  "UPDATE platform_commands SET actor_id='other' WHERE name='carrier.canada-post.group.cancel'",
  "UPDATE platform_events SET payload=json_set(payload,'$.count',1) WHERE type='carrier.canada-post.group.prepared'",
  "UPDATE fulfillment_shipments SET account_id='foreign'",
  "UPDATE fulfillment_shipments SET lines='[]'",
])
  test(`receipt/snapshot corruption refuses: ${change}`, (t) => {
    const f = setup(t);
    sql(f, change);
    const before = rows(f);
    assert.throws(() => projection(f), {
      code: "CARRIER_DISPOSITION_UNRESOLVED",
    });
    assert.equal(rows(f), before);
  });

test("oversized historical receipt metadata cannot produce unbounded disposition evidence", (t) => {
  const f = setup(t),
    key = "k".repeat(129);
  sql(
    f,
    "UPDATE platform_commands SET key=? WHERE name='carrier.canada-post.group.cancel'",
    key,
  );
  sql(
    f,
    "UPDATE platform_audit SET reference=? WHERE action='carrier.canada-post.group.cancel'",
    key,
  );
  assert.throws(() => projection(f), {
    code: "CARRIER_DISPOSITION_UNRESOLVED",
  });
});
