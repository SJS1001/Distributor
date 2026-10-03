import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture, accept, chooseProviders } from "./fixtures.ts";
import {
  setup as nativeSetup,
  origin,
  allRows,
} from "./canada-post-fixture.ts";
import { client } from "./canada-post-creation-fixture.ts";
import { closed } from "./canada-post-manifest-fixture.ts";
import { platformOfflineCarrierReviewLimits as limits } from "../src/server/platform-offline-carrier-review.ts";
import { Store } from "../src/server/database.ts";
import { Application } from "../src/server/application.ts";
import { canonical, digest, type Actor } from "../src/server/core.ts";
const integrity = { code: "CARRIER_PROVENANCE_INTEGRITY" };
function setup(
  t: Parameters<typeof fixture>[0],
  currency: "CAD" | "USD" = "CAD",
) {
  const f = fixture(t, {}, "CA", currency);
  chooseProviders(f, f.actor, "consent", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["canada-post"],
    version: 1,
    acknowledgment: "Synthetic explicit choice",
  });
  const orderId = accept(f, 1).id,
    picks = f.app.fulfillment.picks(f.actor, orderId);
  for (const p of picks)
    f.app.fulfillment.pick(f.actor, `pick-${p.id}`, {
      orderId,
      allocationId: p.id,
      serial: p.serial,
    });
  const address = "Synthetic reviewed destination";
  const shipmentId = f.app.fulfillment.pack(f.actor, "pack", {
    orderId,
    revision: f.app.orders.order(f.actor, orderId).revision,
    mode: "carrier",
    address,
    lines: picks.map((p) => ({ allocationId: p.id, quantity: p.quantity })),
  }).id;
  const booking = f.app.carriers.prepare(f.actor, "booking", {
    shipmentId,
    previousId: null,
    provider: "canada-post",
    service: "Synthetic domestic",
    origin,
    destination: { ...origin, name: "Receiver" },
    parcel: { weightGrams: 1000, lengthMm: 100, widthMm: 100, heightMm: 100 },
    reviewedDestination: address,
    acknowledgment: "Synthetic reviewed parcel",
  });
  const group = f.app.carriers.prepareCanadaPostGroup(f.actor, "group", {
    configurationHash: "a".repeat(64),
    entries: [{ bookingId: booking.id, reviewHash: booking.reviewHash }],
  });
  return Object.assign(f, {
    booking,
    group,
    groupId: group.id,
    bookingId: booking.id,
  });
}
type F = ReturnType<typeof setup>;
const reader = (f: { app: Application }) => f.app.platformOfflineCarrierReview;
const inside = (
  f: Pick<F, "app" | "actor" | "groupId" | "bookingId">,
  actor: Actor = f.actor,
) => reader(f).getInTransaction(actor, f.groupId, f.bookingId);
const read = (
  f: Pick<F, "app" | "actor" | "groupId" | "bookingId">,
  actor: Actor = f.actor,
) => f.app.database.transaction(() => inside(f, actor));
function snapshot(f: F) {
  return canonical({
    platform: f.app.database
      .owned("platform")
      .all("SELECT * FROM platform_commands ORDER BY org_id,actor_id,name,key"),
    audit: f.app.database
      .owned("platform")
      .all("SELECT * FROM platform_audit ORDER BY id"),
    order: f.app.database
      .owned("platform")
      .all("SELECT * FROM platform_audit_order ORDER BY sequence"),
    clock: f.app.database
      .owned("platform")
      .all("SELECT * FROM platform_audit_clock"),
    events: f.app.database
      .owned("platform")
      .all("SELECT * FROM platform_events ORDER BY id"),
    hold: f.app.database
      .owned("platform")
      .all("SELECT * FROM platform_recovery"),
    booking: f.app.database
      .owned("integration")
      .all("SELECT * FROM integration_carrier_bookings ORDER BY id"),
    groups: f.app.database
      .owned("integration")
      .all("SELECT * FROM integration_canada_post_groups ORDER BY id"),
    members: f.app.database
      .owned("integration")
      .all(
        "SELECT * FROM integration_canada_post_members ORDER BY group_id,booking_id",
      ),
  });
}
function frozen(v: unknown) {
  if (v && typeof v === "object") {
    assert(Object.isFrozen(v));
    for (const x of Object.values(v)) frozen(x);
  }
}
for (const currency of ["CAD", "USD"] as const)
  test(`CA/${currency}: native preparations, immutable historical facts and raw hold remain unchanged`, (t) => {
    const f = setup(t, currency);
    f.app.platform.isolateRestore(
      digest("synthetic-hold"),
      "2026-10-03T00:00:00.000Z",
    );
    const before = snapshot(f),
      r = read(f);
    assert.equal(r.history.commands, 2);
    assert.equal(r.history.audits, 2);
    assert.equal(r.history.events, 2);
    assert.equal(r.commands.length, 2);
    assert.equal(r.events.length, 2);
    assert.equal(
      r.commands.find((c) => c.command === "carrier.prepare")!.result
        .reviewHash,
      f.booking.reviewHash,
    );
    assert.equal(
      r.commands.find((c) => c.command === "carrier.canada-post.group.prepare")!
        .result.reviewHash,
      f.group.reviewHash,
    );
    assert(r.blockers.includes("GROUP_MEMBERSHIP_ALLOWLIST_NOT_RETAINED"));
    assert(r.blockers.includes("EVENT_DURABLE_ORDER_AND_ACTOR_NOT_RETAINED"));
    assert.equal("authorized" in r, false);
    frozen(r);
    const { factsHash, ...body } = r;
    assert.equal(factsHash, digest(canonical(body)));
    assert.deepEqual(read(f), r);
    assert.equal(snapshot(f), before);
    assert.throws(
      () => Object.assign(r.commands[0]!.result, { id: "changed" }),
      TypeError,
    );
    f.app.close();
    f.app = new Application(f.path, "CA");
    assert.deepEqual(read(f), r);
    assert.notStrictEqual(read(f).commands[0], r.commands[0]);
  });
test("writer, current IAM, organization, account, password and absent site provenance close before allocations", (t) => {
  const f = setup(t),
    iam = f.app.database.owned("iam"),
    all = t.mock.method(Store.prototype, "all");
  assert.throws(() => inside(f), { code: "TRANSACTION" });
  const u = f.app.identity.createUser(f.actor, "staff", {
    email: "staff@synthetic.test",
    name: "Staff",
    role: "warehouse",
    sites: [f.w1],
    password: "synthetic-only-password",
  });
  const a = { ...f.actor, id: u.id };
  for (const sites of [[f.w1], [], [f.w2]]) {
    iam.run(
      "UPDATE iam_users SET sites=? WHERE id=?",
      JSON.stringify(sites),
      u.id,
    );
    all.mock.resetCalls();
    assert.throws(() => read(f, a), { code: "CARRIER_PROVENANCE_SCOPE" });
    assert.equal(all.mock.calls.length, 0);
  }
  for (const [sql, args, code] of [
    ["UPDATE iam_users SET active=0 WHERE id=?", [u.id], "FORBIDDEN"],
    ["UPDATE iam_users SET role='finance' WHERE id=?", [u.id], "FORBIDDEN"],
    [
      "UPDATE iam_users SET account_id=? WHERE id=?",
      [f.buyer, u.id],
      "FORBIDDEN",
    ],
    [
      "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
      [u.id],
      "PASSWORD_CHANGE_REQUIRED",
    ],
  ] as const) {
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          iam.run(sql, ...args);
          all.mock.resetCalls();
          inside(f, a);
        }),
      { code },
    );
    assert.equal(all.mock.calls.length, 0);
  }
  assert.throws(() => read(f, { ...a, orgId: "foreign" }), {
    code: "FORBIDDEN",
  });
  f.app.database.transaction(() =>
    f.app.database.execute("integration", () =>
      assert.throws(() => inside(f), { code: "TRANSACTION" }),
    ),
  );
});
test("US organization refuses without history allocation; identities do not trim aliases", (t) => {
  const f = fixture(t, {}, "US", "USD"),
    r = reader(f),
    all = t.mock.method(Store.prototype, "all");
  assert.throws(
    () =>
      f.app.database.transaction(() =>
        r.getInTransaction(f.actor, "group", "booking"),
      ),
    { code: "CARRIER_PROVENANCE_REGION" },
  );
  assert.equal(all.mock.calls.length, 0);
  const ca = setup(t);
  for (const id of [" group", "group\u0000", "", "x".repeat(129)])
    assert.throws(
      () =>
        ca.app.database.transaction(() =>
          reader(ca).getInTransaction(ca.actor, id, ca.bookingId),
        ),
      { code: "VALIDATION" },
    );
});
test("actual group/booking cancellation commands bind domain audits, events and durable order", (t) => {
  const f = setup(t);
  f.app.carriers.cancelCanadaPostGroup(f.actor, "cancel-group", {
    groupId: f.groupId,
    reviewHash: f.group.reviewHash,
    reason: "Synthetic cancellation",
  });
  f.app.carriers.cancel(f.actor, "cancel-booking", {
    bookingId: f.bookingId,
    reviewHash: f.booking.reviewHash,
    reason: "Synthetic cancellation",
  });
  const before = snapshot(f),
    r = read(f);
  assert.equal(r.commands.length, 4);
  assert.equal(r.audits.length, 6);
  assert.equal(r.events.length, 4);
  assert.equal(snapshot(f), before);
  const p = f.app.database.owned("platform");
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        p.run(
          "UPDATE platform_audit_order SET sequence=0 WHERE audit_id=?",
          r.commands[0]!.audit.id,
        );
        inside(f);
      }),
    integrity,
  );
  assert.equal(snapshot(f), before);
});
test("native synthetic unknown, recovery claim, created member and transmitted manifest preserve all observations", async (t) => {
  const f = setup(t),
    c = client();
  await assert.rejects(
    f.app.carriers.createCanadaPostMember(f.actor, f.groupId, f.bookingId, {
      ...c,
      async create(_i, _g, guard) {
        guard();
        throw new Error("synthetic lost response");
      },
    }),
    /synthetic lost response/,
  );
  const unknown = read(f);
  assert(unknown.audits.some((a) => a.action.endsWith("member.unknown")));
  assert(unknown.audits.some((a) => a.action.endsWith("member.claimed")));
  await f.app.carriers.reconcileCanadaPostMember(
    f.actor,
    f.groupId,
    f.bookingId,
    c,
  );
  const created = read(f);
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        f.app.database
          .owned("platform")
          .run(
            "UPDATE platform_audit SET detail=json_set(detail,'$.reconciled',json('false')) WHERE action='carrier.canada-post.member.created'",
          );
        inside(f);
      }),
    integrity,
  );
  assert.equal(
    created.audits.filter((a) => a.action.endsWith("member.claimed")).length,
    2,
  );
  assert(created.events.some((e) => e.type.endsWith("member.created")));
  const g = await closed(t, 2);
  await g.app.carriers.transmitCanadaPostManifest(
    g.actor,
    g.groupId,
    g.manifestReview.reviewHash,
    g.m,
  );
  const before = allRows(g);
  const r = read({ ...g, bookingId: g.input.entries[0]!.bookingId });
  assert(r.events.some((e) => e.type === "carrier.booking.booked"));
  assert(r.audits.some((a) => a.action.endsWith("manifest.transmitted")));
  assert.deepEqual(allRows(g), before);
});
test("missing, orphan, duplicate, conflicting and unknown action histories fail closed", (t) => {
  const f = setup(t),
    p = f.app.database.owned("platform"),
    before = snapshot(f);
  const e = p.get(
      "SELECT * FROM platform_events WHERE type='carrier.canada-post.group.prepared'",
    )!,
    a = p.get("SELECT * FROM platform_audit WHERE action='carrier.prepare'")!;
  const corruptions = [
    () => p.run("DELETE FROM platform_events WHERE id=?", e.id!),
    () =>
      p.run(
        "INSERT INTO platform_events SELECT 'duplicate',org_id,type,version,reference,payload,created_at FROM platform_events WHERE id=?",
        e.id!,
      ),
    () =>
      p.run(
        "UPDATE platform_events SET payload=? WHERE id=?",
        canonical({
          count: 1,
          warehouseId: f.w1,
          reviewHash: digest("changed"),
        }),
        e.id!,
      ),
    () => p.run("DELETE FROM platform_commands WHERE name='carrier.prepare'"),
    () =>
      p.run(
        "INSERT INTO platform_commands SELECT org_id,actor_id,name,'duplicate',hash,result,created_at FROM platform_commands WHERE name='carrier.prepare'",
      ),
    () => p.run("DELETE FROM platform_audit_order WHERE audit_id=?", a.id!),
    () =>
      p.run(
        "UPDATE platform_audit_order SET org_id='foreign' WHERE audit_id=?",
        a.id!,
      ),
    () =>
      p.run(
        "UPDATE platform_audit SET detail=? WHERE id=?",
        canonical({ requestHash: digest("changed") }),
        a.id!,
      ),
    () =>
      p.run(
        "UPDATE platform_events SET type='carrier.future.unsupported' WHERE id=?",
        e.id!,
      ),
    () => p.run("UPDATE platform_events SET version=2 WHERE id=?", e.id!),
    () =>
      p.run(
        "UPDATE platform_commands SET result=? WHERE name='carrier.prepare'",
        '{"id":"x","reviewHash":"x","__proto__":{}}',
      ),
  ];
  for (const mutate of corruptions) {
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          mutate();
          inside(f);
        }),
      integrity,
    );
    assert.equal(snapshot(f), before);
  }
});
test("fully paired copied preparation or cancellation cannot masquerade as another native attempt", (t) => {
  const f = setup(t),
    p = f.app.database.owned("platform"),
    r = read(f),
    before = snapshot(f),
    c = r.commands.find((c) => c.command === "carrier.prepare")!;
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        p.run(
          "INSERT INTO platform_commands VALUES(?,?,?,?,?,?,?)",
          f.actor.orgId,
          f.actor.id,
          c.command,
          "copied",
          c.requestHash,
          c.resultJson,
          c.createdAt,
        );
        f.app.platform.audit(f.actor, c.command, "copied", {
          requestHash: c.requestHash,
        });
        inside(f);
      }),
    integrity,
  );
  assert.equal(snapshot(f), before);
});
test("uncommitted native preparation receipt is visible and late refusal conserves all owned rows", (t) => {
  const f = nativeSetup(t),
    before = allRows(f),
    audit = f.app.platform.audit.bind(f.app.platform);
  let observed = false;
  const spy = t.mock.method(
    f.app.platform,
    "audit",
    (...args: Parameters<typeof audit>) => {
      audit(...args);
      if (args[1] === "carrier.canada-post.group.prepare") {
        const p = f.app.database
          .owned("platform")
          .get(
            "SELECT result FROM platform_commands WHERE name='carrier.canada-post.group.prepare'",
          )!;
        const groupId = JSON.parse(String(p.result)).id;
        const r = inside({
          ...f,
          groupId,
          bookingId: f.input.entries[0]!.bookingId,
        });
        assert.equal(r.history.commands, 2);
        observed = true;
        throw new Error("synthetic late rollback");
      }
    },
  );
  try {
    assert.throws(
      () => f.app.carriers.prepareCanadaPostGroup(f.actor, "group", f.input),
      /synthetic late rollback/,
    );
  } finally {
    spy.mock.restore();
  }
  assert(observed);
  assert.deepEqual(allRows(f), before);
});
test("all selected columns including NUL/Unicode/order links preflight before retained fetch and parse", (t) => {
  const f = setup(t),
    p = f.app.database.owned("platform"),
    all = t.mock.method(Store.prototype, "all"),
    parse = t.mock.method(JSON, "parse"),
    large = "budget-marker\u0000" + "😀".repeat(17000);
  for (const [table, column, where] of [
    ["platform_commands", "key", "name='carrier.prepare'"],
    ["platform_commands", "result", "name='carrier.prepare'"],
    ["platform_audit", "detail", "action='carrier.prepare'"],
    ["platform_audit", "reference", "action='carrier.prepare'"],
    [
      "platform_audit_order",
      "org_id",
      "audit_id IN(SELECT id FROM platform_audit WHERE action='carrier.prepare')",
    ],
    ["platform_events", "payload", "type='carrier.booking.prepared'"],
    ["platform_events", "reference", "type='carrier.booking.prepared'"],
  ]) {
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          p.run(`UPDATE ${table} SET ${column}=? WHERE ${where}`, large);
          all.mock.resetCalls();
          parse.mock.resetCalls();
          inside(f);
        }),
      integrity,
    );
    assert.equal(all.mock.calls.length, 0);
    assert.equal(
      parse.mock.calls.filter((c) =>
        String(c.arguments[0]).includes("budget-marker"),
      ).length,
      0,
    );
  }
});
test("count and combined byte excess fail before materialization, unrelated scoped malformed rows cannot hide", (t) => {
  const f = setup(t),
    p = f.app.database.owned("platform"),
    all = t.mock.method(Store.prototype, "all");
  for (const kind of ["commands", "audits", "events", "aggregate"]) {
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          const n =
            kind === "aggregate"
              ? 150
              : limits[kind as "commands" | "audits" | "events"];
          for (let i = 0; i < n; i++) {
            if (kind === "audits")
              p.run(
                "INSERT INTO platform_audit VALUES(?,?,?,?,?,?,?)",
                `extra-${i}`,
                f.actor.orgId,
                f.actor.id,
                "carrier.prepare",
                `extra-${i}`,
                "bad",
                "2026-10-03T00:00:00.000Z",
              );
            else if (kind === "events")
              p.run(
                "INSERT INTO platform_events VALUES(?,?,?,?,?,?,?)",
                `extra-${i}`,
                f.actor.orgId,
                "carrier.booking.prepared",
                1,
                `extra-${i}`,
                "bad",
                "2026-10-03T00:00:00.000Z",
              );
            else
              p.run(
                "INSERT INTO platform_commands VALUES(?,?,?,?,?,?,?)",
                f.actor.orgId,
                f.actor.id,
                "carrier.prepare",
                `extra-${i}`,
                digest("x"),
                kind === "aggregate" ? "x".repeat(60000) : "bad",
                "2026-10-03T00:00:00.000Z",
              );
          }
          all.mock.resetCalls();
          inside(f);
        }),
      integrity,
    );
    assert.equal(all.mock.calls.length, 0, kind);
  }
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        p.run(
          "INSERT INTO platform_commands VALUES(?,?,?,?,?,?,?)",
          f.actor.orgId,
          f.actor.id,
          "carrier.prepare",
          "unrelated",
          digest("x"),
          "not-json",
          "2026-10-03T00:00:00.000Z",
        );
        f.app.platform.audit(f.actor, "carrier.prepare", "unrelated", {
          requestHash: digest("x"),
        });
        inside(f);
      }),
    integrity,
  );
});
test("foreign organization malformed histories do not leak or supply local evidence", (t) => {
  const f = setup(t),
    p = f.app.database.owned("platform"),
    first = read(f);
  p.run(
    "INSERT INTO platform_commands VALUES('foreign','author','carrier.prepare','key','bad','bad','bad')",
  );
  p.run(
    "INSERT INTO platform_events VALUES('foreign','foreign','carrier.booking.prepared',1,'id','bad','bad')",
  );
  p.run(
    "INSERT INTO platform_audit VALUES('foreign','foreign','author','carrier.prepare','id','bad','bad')",
  );
  assert.deepEqual(read(f), first);
  assert.throws(() =>
    f.app.database.owned("integration").all("SELECT * FROM platform_commands"),
  );
});

test("impossible later group/member histories and copied manifest-booking events refuse", async (t) => {
  const f = setup(t),
    p = f.app.database.owned("platform");
  f.app.carriers.cancelCanadaPostGroup(f.actor, "cancel", {
    groupId: f.groupId,
    reviewHash: f.group.reviewHash,
    reason: "Synthetic cancellation",
  });
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        f.app.platform.audit(
          f.actor,
          "carrier.canada-post.member.claimed",
          f.groupId,
          {
            bookingId: f.bookingId,
            reviewHash: f.booking.reviewHash,
            send: true,
          },
        );
        inside(f);
      }),
    integrity,
  );
  const g = await closed(t);
  await g.app.carriers.transmitCanadaPostManifest(
    g.actor,
    g.groupId,
    g.manifestReview.reviewHash,
    g.m,
  );
  const pg = g.app.database.owned("platform"),
    ctx = { ...g, bookingId: g.input.entries[0]!.bookingId };
  assert.throws(
    () =>
      g.app.database.transaction(() => {
        g.app.platform.audit(
          g.actor,
          "carrier.canada-post.manifest.claimed",
          g.groupId,
          {
            reviewHash: g.manifestReview.reviewHash,
            send: false,
            memberHash: digest("synthetic"),
          },
        );
        inside(ctx);
      }),
    integrity,
  );
  assert.throws(
    () =>
      g.app.database.transaction(() => {
        pg.run(
          "DELETE FROM platform_events WHERE type='carrier.canada-post.member.created'",
        );
        inside(ctx);
      }),
    integrity,
  );
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        p.run(
          "UPDATE platform_audit_order SET sequence=9223372036854775807 WHERE audit_id IN(SELECT id FROM platform_audit WHERE action='carrier.prepare')",
        );
        inside(f);
      }),
    integrity,
  );
});

test("exact command count remains complete; numeric preflight and excessive JSON depth refuse", (t) => {
  const f = setup(t),
    p = f.app.database.owned("platform"),
    first = read(f),
    base = first.commands.find((c) => c.command === "carrier.prepare")!;
  f.app.database.transaction(() => {
    for (let n = 0; n < limits.commands - 2; n++) {
      const id = `synthetic-history-${n}`,
        key = `key-${n}`,
        result = { id, reviewHash: digest(id) };
      p.run(
        "INSERT INTO platform_commands VALUES(?,?,?,?,?,?,?)",
        f.actor.orgId,
        f.actor.id,
        "carrier.prepare",
        key,
        digest(key),
        JSON.stringify(result),
        "2026-10-03T00:00:00.000Z",
      );
      f.app.platform.audit(f.actor, "carrier.prepare", key, {
        requestHash: digest(key),
      });
      f.app.platform.event(f.actor, "carrier.booking.prepared", id, {
        shipmentId: `shipment-${n}`,
        reviewHash: result.reviewHash,
        provider: "ups",
      });
    }
  });
  const exact = read(f);
  assert.equal(exact.history.commands, limits.commands);
  assert.equal(exact.commands.length, 2);
  assert.notEqual(exact.history.hash, first.history.hash);
  const all = t.mock.method(Store.prototype, "all");
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        p.run(
          "UPDATE platform_events SET version=9223372036854775807 WHERE reference=?",
          f.bookingId,
        );
        all.mock.resetCalls();
        inside(f);
      }),
    integrity,
  );
  assert.equal(all.mock.calls.length, 0);
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        p.run(
          "UPDATE platform_commands SET result=? WHERE key=?",
          '{"id":' + "[".repeat(50) + '"deep"' + "]".repeat(50) + "}",
          base.key,
        );
        inside(f);
      }),
    integrity,
  );
});

test("actual reviewed member claim release preserves result and audit without treating claim hash as authority", async (t) => {
  const f = setup(t),
    c = client();
  let reject!: (e: Error) => void;
  const gate = new Promise<never>((_resolve, no) => {
    reject = no;
  });
  const running = f.app.carriers.createCanadaPostMember(
    f.actor,
    f.groupId,
    f.bookingId,
    {
      ...c,
      async create() {
        return gate;
      },
    },
  );
  const stopped = assert.rejects(running, /synthetic adapter stopped/);
  try {
    f.app.database
      .owned("integration")
      .run(
        "UPDATE integration_canada_post_members SET started_at=? WHERE group_id=? AND booking_id=?",
        Date.now() - 10000,
        f.groupId,
        f.bookingId,
      );
    const target = {
      kind: "member" as const,
      groupId: f.groupId,
      bookingId: f.bookingId,
    };
    const claim = f.app.carriers.reviewClaim(f.actor, target, 1);
    f.app.carriers.releaseClaim(f.actor, "release-claim", {
      target,
      minimumAgeMs: 1,
      claimHash: claim.claimHash,
      reason: "Synthetic expired exact claim",
    });
    const before = snapshot(f),
      r = read(f),
      receipt = r.commands.find((c) => c.command === "carrier.claim.release")!;
    assert.equal(receipt.result.claimHash, claim.claimHash);
    assert.deepEqual(receipt.result.target, target);
    assert.equal(
      r.audits.filter((a) => a.action === "carrier.claim.released").length,
      1,
    );
    assert.equal(snapshot(f), before);
  } finally {
    reject(new Error("synthetic adapter stopped"));
    await stopped;
  }
});

test("complete scoped history handles ordinary non-Canada-Post unknown/booked events without inventing a claim audit", async (t) => {
  const f = nativeSetup(t, 2, [{ provider: "ups" }, {}]),
    [ups, cp] = f.input.entries;
  const groupId = f.app.carriers.prepareCanadaPostGroup(f.actor, "group", {
    ...f.input,
    entries: [cp!],
  }).id;
  const adapter = {
    provider: "ups" as const,
    sandbox: true as const,
    async book(_i: unknown, guard: () => void) {
      guard();
      throw new Error("synthetic unknown UPS");
    },
    async lookup(
      intent: import("../src/server/carrier-bookings.ts").CarrierIntent,
    ) {
      return {
        bookingId: intent.bookingId,
        reviewHash: intent.reviewHash,
        reference: "synthetic-reference",
        tracking: "synthetic-tracking",
        label: {
          mediaType: "application/pdf" as const,
          bytes: Buffer.from("%PDF-1.7\nSynthetic"),
        },
      };
    },
  };
  await assert.rejects(
    f.app.carriers.execute(f.actor, ups!.bookingId, adapter),
    /synthetic unknown UPS/,
  );
  await f.app.carriers.reconcile(f.actor, ups!.bookingId, adapter);
  const before = allRows(f),
    r = read({ ...f, groupId, bookingId: cp!.bookingId });
  assert.equal(r.history.commands, 3);
  assert.equal(r.commands.length, 2);
  assert.equal(r.history.events, 4);
  assert.deepEqual(allRows(f), before);
});
