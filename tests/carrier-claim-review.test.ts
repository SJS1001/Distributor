import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, native, raw, allRows } from "./canada-post-fixture.ts";
import { client, observation } from "./canada-post-creation-fixture.ts";
import { closed, manifestObservation } from "./canada-post-manifest-fixture.ts";
import { createHttp } from "../src/server/http.ts";
import { Application } from "../src/server/application.ts";
import type { CarrierClaimTarget } from "../src/shared/carrier-booking.ts";

const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>((r) => {
    release = r;
  });
  return { promise, release };
};
const reason = "Synthetic stopped-process investigation; use lookup only";
const memberSetup = (t: Parameters<typeof setup>[0], count = 1) => {
  const f = setup(t, count);
  const groupId = f.app.carriers.prepareCanadaPostGroup(
    f.actor,
    "group",
    f.input,
  ).id;
  const bookingId = f.input.entries[0]!.bookingId;
  const target: CarrierClaimTarget = { kind: "member", groupId, bookingId };
  return { ...f, groupId, bookingId, target };
};
const ageMember = (f: ReturnType<typeof memberSetup>) =>
  raw(
    f,
    "UPDATE integration_canada_post_members SET started_at=? WHERE group_id=? AND booking_id=?",
    Date.now() - 240000,
    f.groupId,
    f.bookingId,
  );

test("reviewed member release fences an actual late creation, replays once, preserves native facts and requires lookup", async (t) => {
  const f = memberSetup(t),
    c = client(),
    started = gate(),
    late = gate(),
    before = native(f);
  c.create = async (intent, group, guard) => {
    guard();
    c.creates++;
    started.release();
    await late.promise;
    return observation(intent, group);
  };
  const pending = f.app.carriers.createCanadaPostMember(
    f.actor,
    f.groupId,
    f.bookingId,
    c,
  );
  await started.promise;
  ageMember(f);
  const rows = allRows(f),
    review = f.app.carriers.reviewClaim(f.actor, f.target, 120000);
  assert.deepEqual(allRows(f), rows);
  assert.equal(review.state, "creating");
  assert.ok(review.eligibleAt < Date.now());
  assert.equal(JSON.stringify(review).includes('"token"'), false);
  const input = {
    target: f.target,
    minimumAgeMs: 120000,
    claimHash: review.claimHash,
    reason,
  };
  const result = f.app.carriers.releaseClaim(f.actor, "release", input);
  assert.equal(result.state, "unknown");
  const after = allRows(f);
  assert.deepEqual(
    f.app.carriers.releaseClaim(f.actor, "release", input),
    result,
  );
  assert.deepEqual(allRows(f), after);
  late.release();
  await assert.rejects(pending, { code: "STATE" });
  assert.equal(
    f.app.carriers.reviewCanadaPostGroup(f.actor, f.groupId).state,
    "unknown",
  );
  assert.deepEqual(native(f), before);
  await assert.rejects(
    f.app.carriers.createCanadaPostMember(f.actor, f.groupId, f.bookingId, c),
    { code: "STATE" },
  );
  assert.equal(c.creates, 1);
  assert.equal(c.lookups, 0);
  assert.equal(
    (
      await f.app.carriers.reconcileCanadaPostMember(
        f.actor,
        f.groupId,
        f.bookingId,
        c,
      )
    ).state,
    "closed",
  );
  assert.equal(c.lookups, 1);
  assert.equal(c.creates, 1);
});

test("minimum age and successor token invalidate release; no global or sibling claim is affected", async (t) => {
  const f = memberSetup(t, 2),
    started = gate(),
    late = gate(),
    c = client();
  c.create = async (intent, group, guard) => {
    guard();
    started.release();
    await late.promise;
    return observation(intent, group);
  };
  const pending = f.app.carriers.createCanadaPostMember(
    f.actor,
    f.groupId,
    f.bookingId,
    c,
  );
  await started.promise;
  const fresh = f.app.carriers.reviewClaim(f.actor, f.target, 86400000);
  const input = {
    target: f.target,
    minimumAgeMs: fresh.minimumAgeMs,
    claimHash: fresh.claimHash,
    reason,
  };
  const before = allRows(f);
  assert.throws(() => f.app.carriers.releaseClaim(f.actor, "young", input), {
    code: "CLAIM_ACTIVE",
  });
  assert.deepEqual(allRows(f), before);
  ageMember(f);
  const reviewed = f.app.carriers.reviewClaim(f.actor, f.target, 120000);
  raw(
    f,
    "UPDATE integration_canada_post_members SET token='synthetic-successor' WHERE group_id=? AND booking_id=?",
    f.groupId,
    f.bookingId,
  );
  const successor = allRows(f);
  assert.throws(
    () =>
      f.app.carriers.releaseClaim(f.actor, "stale", {
        ...input,
        minimumAgeMs: 120000,
        claimHash: reviewed.claimHash,
      }),
    { code: "STALE_REVIEW" },
  );
  assert.deepEqual(allRows(f), successor);
  late.release();
  await assert.rejects(pending, { code: "STATE" });
  const current = f.app.carriers.reviewClaim(f.actor, f.target, 120000);
  f.app.carriers.releaseClaim(f.actor, "current", {
    ...input,
    minimumAgeMs: 120000,
    claimHash: current.claimHash,
  });
  assert.equal(
    f.app.carriers
      .reviewCanadaPostGroup(f.actor, f.groupId)
      .entries.find((m) => m.bookingId !== f.bookingId)!.state,
    "pending",
  );
});

test("manifest release preserves exact claimed identity and created labels; late transmission cannot replace lookup", async (t) => {
  const f = await closed(t),
    started = gate(),
    late = gate(),
    before = native(f);
  const target: CarrierClaimTarget = { kind: "manifest", groupId: f.groupId };
  f.m.transmitManifest = async (input, guard) => {
    guard();
    f.m.writes++;
    started.release();
    await late.promise;
    return manifestObservation(input);
  };
  const pending = f.app.carriers.transmitCanadaPostManifest(
    f.actor,
    f.groupId,
    f.manifestReview.reviewHash,
    f.m,
  );
  await started.promise;
  raw(
    f,
    "UPDATE integration_canada_post_groups SET started_at=? WHERE id=?",
    Date.now() - 240000,
    f.groupId,
  );
  const store = f.app.database.owned("integration");
  const identity = store.get(
    "SELECT observation FROM integration_canada_post_groups WHERE id=?",
    f.groupId,
  );
  const members = store.all(
    "SELECT * FROM integration_canada_post_members WHERE group_id=?",
    f.groupId,
  );
  const review = f.app.carriers.reviewClaim(f.actor, target, 120000);
  f.app.carriers.releaseClaim(f.actor, "manifest-release", {
    target,
    minimumAgeMs: 120000,
    claimHash: review.claimHash,
    reason,
  });
  assert.deepEqual(
    store.get(
      "SELECT observation FROM integration_canada_post_groups WHERE id=?",
      f.groupId,
    ),
    identity,
  );
  assert.deepEqual(
    store.all(
      "SELECT * FROM integration_canada_post_members WHERE group_id=?",
      f.groupId,
    ),
    members,
  );
  late.release();
  await assert.rejects(pending, { code: "STATE" });
  assert.deepEqual(native(f), before);
  assert.equal(f.m.writes, 1);
  assert.equal(f.m.reads, 0);
  assert.equal(
    (
      await f.app.carriers.reconcileCanadaPostManifest(
        f.actor,
        f.groupId,
        f.manifestReview.reviewHash,
        f.m,
      )
    ).state,
    "transmitted",
  );
  assert.equal(f.m.writes, 1);
  assert.equal(f.m.reads, 1);
  assert.deepEqual(native(f), before);
});

test("ordinary booking release retains uncertainty across restart and makes no provider calls", (t) => {
  const f = setup(t, 1, [{ provider: "ups" }]),
    bookingId = f.input.entries[0]!.bookingId;
  const target: CarrierClaimTarget = { kind: "booking", bookingId };
  raw(
    f,
    "UPDATE integration_carrier_bookings SET state='running',token='synthetic-claim',started_at=? WHERE id=?",
    Date.now() - 240000,
    bookingId,
  );
  const before = native(f),
    review = f.app.carriers.reviewClaim(f.actor, target, 120000);
  const result = f.app.carriers.releaseClaim(f.actor, "ordinary", {
    target,
    minimumAgeMs: 120000,
    claimHash: review.claimHash,
    reason,
  });
  assert.equal(result.state, "unknown");
  assert.deepEqual(native(f), before);
  f.app.close();
  f.app = new Application(f.path);
  assert.equal(
    f.app.carriers.review(f.actor, f.shipments[0]!).booking!.state,
    "unknown",
  );
  assert.throws(() => f.app.carriers.reviewClaim(f.actor, target, 120000), {
    code: "STATE",
  });
});

test("fresh administrator authority precedes reads and cached release; malformed, foreign and tampered targets are refused", (t) => {
  const f = memberSetup(t);
  raw(
    f,
    "UPDATE integration_canada_post_members SET state='creating',token='synthetic-claim',started_at=? WHERE group_id=? AND booking_id=?",
    Date.now() - 240000,
    f.groupId,
    f.bookingId,
  );
  raw(
    f,
    "UPDATE integration_canada_post_groups SET state='creating' WHERE id=?",
    f.groupId,
  );
  const review = f.app.carriers.reviewClaim(f.actor, f.target, 120000),
    input = {
      target: f.target,
      minimumAgeMs: 120000,
      claimHash: review.claimHash,
      reason,
    };
  for (const value of [0, -1, 86400001, NaN, 1.5])
    assert.throws(() => f.app.carriers.reviewClaim(f.actor, f.target, value), {
      code: "VALIDATION",
    });
  assert.throws(
    () =>
      f.app.carriers.reviewClaim(
        f.actor,
        { ...f.target, extra: true } as CarrierClaimTarget,
        120000,
      ),
    { code: "CARRIER_RESULT" },
  );
  assert.throws(
    () =>
      f.app.carriers.reviewClaim(
        f.actor,
        { kind: "manifest", groupId: "foreign" },
        120000,
      ),
    { code: "NOT_FOUND" },
  );
  f.app.carriers.releaseClaim(f.actor, "released", input);
  raw(f, "UPDATE iam_users SET role='warehouse' WHERE id=?", f.actor.id);
  assert.throws(() => f.app.carriers.releaseClaim(f.actor, "released", input), {
    code: "FORBIDDEN",
  });
  assert.throws(() => f.app.carriers.reviewClaim(f.actor, f.target, 120000), {
    code: "FORBIDDEN",
  });
});

test("audit fault rolls back released claim and command receipt", (t) => {
  const f = memberSetup(t);
  raw(
    f,
    "UPDATE integration_canada_post_members SET state='creating',token='synthetic-claim',started_at=? WHERE group_id=? AND booking_id=?",
    Date.now() - 240000,
    f.groupId,
    f.bookingId,
  );
  raw(
    f,
    "UPDATE integration_canada_post_groups SET state='creating' WHERE id=?",
    f.groupId,
  );
  const review = f.app.carriers.reviewClaim(f.actor, f.target, 120000),
    before = allRows(f);
  const original = f.app.platform.audit.bind(f.app.platform);
  f.app.platform.audit = (...args) => {
    if (args[1] === "carrier.claim.released")
      throw Error("Synthetic audit fault");
    return original(...args);
  };
  assert.throws(
    () =>
      f.app.carriers.releaseClaim(f.actor, "fault", {
        target: f.target,
        minimumAgeMs: 120000,
        claimHash: review.claimHash,
        reason,
      }),
    /Synthetic audit fault/,
  );
  assert.deepEqual(allRows(f), before);
});

test("HTTP claim review/release stays available with providers disabled and enforces exact schemas, authentication and CSRF", async (t) => {
  const f = memberSetup(t),
    origin = "http://127.0.0.1:3000";
  raw(
    f,
    "UPDATE integration_canada_post_members SET state='creating',token='synthetic-private-token',started_at=? WHERE group_id=? AND booking_id=?",
    Date.now() - 240000,
    f.groupId,
    f.bookingId,
  );
  raw(
    f,
    "UPDATE integration_canada_post_groups SET state='creating' WHERE id=?",
    f.groupId,
  );
  const http = await createHttp(f.app, {
    origin,
    staticRoot: "/nonexistent-test",
  });
  await http.ready();
  t.after(() => {
    void http.close();
  });
  const url = `/api/canada-post/groups/${f.groupId}/members/${f.bookingId}/claim?minimumAgeMs=120000`;
  assert.equal((await http.inject({ method: "GET", url })).statusCode, 401);
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: {
      email: "admin@example.test",
      password: "long-test-only-password",
    },
  });
  assert.equal(login.statusCode, 200);
  const cookie = login.cookies[0]!,
    headers = {
      cookie: `${cookie.name}=${cookie.value}`,
      origin,
      "x-csrf-token": login.json().csrf,
      "idempotency-key": "http-release",
    };
  const before = allRows(f),
    response = await http.inject({ method: "GET", url, headers });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.body.includes("synthetic-private-token"), false);
  assert.deepEqual(allRows(f), before);
  const payload = {
    target: f.target,
    minimumAgeMs: 120000,
    claimHash: response.json().claimHash,
    reason,
  };
  const write = (body = payload, h = headers) =>
    http.inject({
      method: "POST",
      url: "/api/commands/carrier.claim.release",
      headers: h,
      payload: body,
    });
  assert.equal(
    (await write(payload, { ...headers, "x-csrf-token": "wrong" })).statusCode,
    403,
  );
  assert.equal(
    (
      await write({
        ...payload,
        target: { ...f.target, extra: true },
      } as typeof payload)
    ).statusCode,
    400,
  );
  assert.equal(
    (await http.inject({ method: "GET", url: url + "&extra=true", headers }))
      .statusCode,
    400,
  );
  assert.equal((await write()).statusCode, 200);
  assert.equal((await write()).statusCode, 200);
  assert.equal(
    (await http.inject({ method: "GET", url, headers })).statusCode,
    409,
  );
});

test("ordinary send and read-only recovery claims are each fenced; reviewed release never purchases again", async (t) => {
  const f = setup(t, 1, [{ provider: "ups" }]),
    bookingId = f.input.entries[0]!.bookingId;
  const target: CarrierClaimTarget = { kind: "booking", bookingId },
    started = gate(),
    late = gate();
  const result = (
    intent: import("../src/server/carrier-bookings.ts").CarrierIntent,
  ) => ({
    bookingId: intent.bookingId,
    reviewHash: intent.reviewHash,
    reference: "SYNTHETIC-CLAIM-BOOKING",
    tracking: "SYNTHETIC-CLAIM-TRACKING",
    label: {
      mediaType: "application/pdf" as const,
      bytes: Buffer.from("%PDF-1.7\nSynthetic claim test\n%%EOF"),
    },
  });
  let writes = 0,
    reads = 0;
  const adapter: import("../src/server/carrier-bookings.ts").CarrierAdapter = {
    provider: "ups",
    sandbox: true,
    async book(intent, guard) {
      guard();
      writes++;
      started.release();
      await late.promise;
      return result(intent);
    },
    async lookup(intent) {
      reads++;
      return result(intent);
    },
  };
  const before = native(f),
    pending = f.app.carriers.execute(f.actor, bookingId, adapter);
  await started.promise;
  const release = (key: string) => {
    raw(
      f,
      "UPDATE integration_carrier_bookings SET started_at=? WHERE id=?",
      Date.now() - 240000,
      bookingId,
    );
    const review = f.app.carriers.reviewClaim(f.actor, target, 120000);
    f.app.carriers.releaseClaim(f.actor, key, {
      target,
      minimumAgeMs: 120000,
      claimHash: review.claimHash,
      reason,
    });
  };
  release("send-release");
  late.release();
  await assert.rejects(pending, { code: "STATE" });
  await assert.rejects(f.app.carriers.execute(f.actor, bookingId, adapter), {
    code: "STATE",
  });
  const lookupStarted = gate(),
    lookupLate = gate();
  const reading = f.app.carriers.reconcile(f.actor, bookingId, {
    ...adapter,
    async lookup(intent) {
      reads++;
      lookupStarted.release();
      await lookupLate.promise;
      return result(intent);
    },
  });
  await lookupStarted.promise;
  release("lookup-release");
  assert.equal(
    (await f.app.carriers.reconcile(f.actor, bookingId, adapter)).state,
    "booked",
  );
  lookupLate.release();
  await assert.rejects(reading, { code: "STATE" });
  assert.equal(writes, 1);
  assert.equal(reads, 2);
  const after = native(f);
  assert.deepEqual(after, before);
  assert.equal(
    f.app.carriers.review(f.actor, f.shipments[0]!).booking!.state,
    "booked",
  );
});

for (const restriction of ["inactive", "password", "role"] as const)
  test(`current ${restriction} restriction rejects claim reviews and cached release receipts`, (t) => {
    const f = memberSetup(t);
    raw(
      f,
      "UPDATE integration_canada_post_members SET state='creating',token='synthetic-claim',started_at=? WHERE group_id=? AND booking_id=?",
      Date.now() - 240000,
      f.groupId,
      f.bookingId,
    );
    raw(
      f,
      "UPDATE integration_canada_post_groups SET state='creating' WHERE id=?",
      f.groupId,
    );
    const review = f.app.carriers.reviewClaim(f.actor, f.target, 120000),
      input = {
        target: f.target,
        minimumAgeMs: 120000,
        claimHash: review.claimHash,
        reason,
      };
    f.app.carriers.releaseClaim(f.actor, "authority", input);
    if (restriction === "inactive")
      raw(f, "UPDATE iam_users SET active=0 WHERE id=?", f.actor.id);
    else if (restriction === "password")
      raw(
        f,
        "INSERT INTO iam_user_security VALUES(?,1,1,'2026-10-01T00:00:00Z') ON CONFLICT(user_id) DO UPDATE SET password_change_required=1",
        f.actor.id,
      );
    else raw(f, "UPDATE iam_users SET role='support' WHERE id=?", f.actor.id);
    const before = allRows(f),
      code =
        restriction === "password" ? "PASSWORD_CHANGE_REQUIRED" : "FORBIDDEN";
    assert.throws(() => f.app.carriers.reviewClaim(f.actor, f.target, 120000), {
      code,
    });
    assert.throws(
      () => f.app.carriers.releaseClaim(f.actor, "authority", input),
      { code },
    );
    assert.deepEqual(allRows(f), before);
  });

test("release refuses changed payload, malformed reason/hash, inconsistent group phase and unsafe claim time without effects", (t) => {
  const f = memberSetup(t);
  raw(
    f,
    "UPDATE integration_canada_post_members SET state='creating',token='synthetic-claim',started_at=? WHERE group_id=? AND booking_id=?",
    Date.now() - 240000,
    f.groupId,
    f.bookingId,
  );
  raw(
    f,
    "UPDATE integration_canada_post_groups SET state='creating' WHERE id=?",
    f.groupId,
  );
  const review = f.app.carriers.reviewClaim(f.actor, f.target, 120000),
    input = {
      target: f.target,
      minimumAgeMs: 120000,
      claimHash: review.claimHash,
      reason,
    },
    before = allRows(f);
  for (const patch of [
    { reason: "" },
    { reason: "x".repeat(161) },
    { claimHash: "f".repeat(63) },
    { minimumAgeMs: 0 },
  ]) {
    assert.throws(
      () =>
        f.app.carriers.releaseClaim(f.actor, "invalid", { ...input, ...patch }),
      { code: "VALIDATION" },
    );
    assert.deepEqual(allRows(f), before);
  }
  raw(
    f,
    "UPDATE integration_canada_post_groups SET state='closed' WHERE id=?",
    f.groupId,
  );
  assert.throws(() => f.app.carriers.reviewClaim(f.actor, f.target, 120000), {
    code: "STATE",
  });
  raw(
    f,
    "UPDATE integration_canada_post_groups SET state='creating' WHERE id=?",
    f.groupId,
  );
  for (const value of [-1, Number.MAX_SAFE_INTEGER]) {
    raw(
      f,
      "UPDATE integration_canada_post_members SET started_at=? WHERE group_id=? AND booking_id=?",
      value,
      f.groupId,
      f.bookingId,
    );
    assert.throws(() => f.app.carriers.reviewClaim(f.actor, f.target, 120000), {
      code: "STATE",
    });
  }
  raw(
    f,
    "UPDATE integration_canada_post_members SET started_at=? WHERE group_id=? AND booking_id=?",
    review.startedAt,
    f.groupId,
    f.bookingId,
  );
  const originalHash = f.app.carriers.reviewCanadaPostGroup(
    f.actor,
    f.groupId,
  ).reviewHash;
  raw(
    f,
    "UPDATE integration_canada_post_groups SET review_hash=? WHERE id=?",
    "b".repeat(64),
    f.groupId,
  );
  assert.throws(() => f.app.carriers.reviewClaim(f.actor, f.target, 120000), {
    code: "CARRIER_MISMATCH",
  });
  raw(
    f,
    "UPDATE integration_canada_post_groups SET review_hash=? WHERE id=?",
    originalHash,
    f.groupId,
  );
  f.app.carriers.releaseClaim(f.actor, "exact", input);
  const released = allRows(f);
  assert.throws(
    () =>
      f.app.carriers.releaseClaim(f.actor, "exact", {
        ...input,
        reason: "Changed reason",
      }),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  assert.deepEqual(allRows(f), released);
});

for (const kind of ["booking", "manifest"] as const)
  test(`HTTP ${kind} review/release binds the exact claim without a runtime provider registration`, async (t) => {
    const origin = "http://127.0.0.1:3000",
      started = gate(),
      late = gate();
    let pending: Promise<unknown> | undefined;
    const manifest = kind === "manifest" ? await closed(t) : undefined;
    const f = manifest ?? setup(t, 1, [{ provider: "ups" }]);
    let target: CarrierClaimTarget, url: string;
    if (manifest) {
      manifest.m.transmitManifest = async (input, guard) => {
        guard();
        started.release();
        await late.promise;
        return manifestObservation(input);
      };
      pending = f.app.carriers.transmitCanadaPostManifest(
        f.actor,
        manifest.groupId,
        manifest.manifestReview.reviewHash,
        manifest.m,
      );
      await started.promise;
      raw(
        f,
        "UPDATE integration_canada_post_groups SET started_at=? WHERE id=?",
        Date.now() - 240000,
        manifest.groupId,
      );
      target = { kind: "manifest", groupId: manifest.groupId };
      url = `/api/canada-post/groups/${manifest.groupId}/manifest/claim`;
    } else {
      const bookingId = f.input.entries[0]!.bookingId;
      raw(
        f,
        "UPDATE integration_carrier_bookings SET state='running',token='synthetic-private-token',started_at=? WHERE id=?",
        Date.now() - 240000,
        bookingId,
      );
      target = { kind: "booking", bookingId };
      url = `/api/carrier/${bookingId}/claim`;
    }
    const http = await createHttp(f.app, {
      origin,
      staticRoot: "/nonexistent-test",
    });
    await http.ready();
    t.after(() => {
      void http.close();
    });
    assert.equal(
      (await http.inject({ method: "GET", url: url + "?minimumAgeMs=120000" }))
        .statusCode,
      401,
    );
    const login = await http.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: {
        email: "admin@example.test",
        password: "long-test-only-password",
      },
    });
    assert.equal(login.statusCode, 200, login.body);
    const c = login.cookies[0]!,
      headers = {
        origin,
        cookie: `${c.name}=${c.value}`,
        "x-csrf-token": login.json().csrf,
        "idempotency-key": "http-release",
      };
    for (const query of [
      "",
      "?minimumAgeMs=0",
      "?minimumAgeMs=01",
      "?minimumAgeMs=1.5",
      "?minimumAgeMs=86400001",
      "?minimumAgeMs=NaN",
      "?minimumAgeMs=1&minimumAgeMs=2",
    ])
      assert.equal(
        (await http.inject({ method: "GET", url: url + query, headers }))
          .statusCode,
        400,
        query,
      );
    const before = native(f),
      response = await http.inject({
        method: "GET",
        url: url + "?minimumAgeMs=120000",
        headers,
      });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.deepEqual(native(f), before);
    const payload = {
      target,
      minimumAgeMs: 120000,
      claimHash: response.json().claimHash,
      reason,
    };
    const write = () =>
      http.inject({
        method: "POST",
        url: "/api/commands/carrier.claim.release",
        headers,
        payload,
      });
    assert.equal((await write()).statusCode, 200);
    assert.equal((await write()).statusCode, 200);
    assert.equal(
      (
        await http.inject({
          method: "GET",
          url: url + "?minimumAgeMs=120000",
          headers,
        })
      ).statusCode,
      409,
    );
    if (pending) {
      late.release();
      await assert.rejects(pending, { code: "STATE" });
    }
    assert.deepEqual(native(f), before);
  });
