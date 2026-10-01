import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, allRows, raw } from "./canada-post-fixture.ts";
import { createHttp } from "../src/server/http.ts";

test("Canada Post candidate pages are bounded, retain original reviews, and permit grouped cursors without missing later bookings", (t) => {
  const f = setup(t, 23),
    before = allRows(f);
  const first = f.app.carriers.canadaPostCandidates(f.actor, f.w1);
  assert.equal(first.items.length, 20);
  assert.equal(first.next, f.input.entries[19]!.bookingId);
  assert.deepEqual(
    first.items.map((b) => ({ bookingId: b.id, reviewHash: b.reviewHash })),
    f.input.entries.slice(0, 20),
  );
  assert.doesNotMatch(
    JSON.stringify(first),
    /label_bytes|nativeSnapshot|org_id/,
  );
  assert.deepEqual(allRows(f), before);
  const g = f.app.carriers.prepareCanadaPostGroup(f.actor, "first-page-group", {
    ...f.input,
    entries: f.input.entries.slice(0, 20),
  });
  const last = f.app.carriers.canadaPostCandidates(f.actor, f.w1, first.next!);
  assert.equal(last.next, null);
  assert.deepEqual(
    last.items.map((b) => b.id),
    f.input.entries.slice(20).map((e) => e.bookingId),
  );
  assert.deepEqual(
    f.app.carriers.canadaPostCandidates(f.actor, f.w1).items.map((b) => b.id),
    last.items.map((b) => b.id),
  );
  f.app.carriers.cancelCanadaPostGroup(f.actor, "cancel-group", {
    groupId: g.id,
    reviewHash: g.reviewHash,
    reason: "Synthetic group cancellation",
  });
  assert.equal(
    f.app.carriers.canadaPostCandidates(f.actor, f.w1).items.length,
    20,
  );
});

test("Canada Post candidates exclude other carriers and canceled bookings and reject cross-site/organization cursors", (t) => {
  const f = setup(t, 3, [{}, { provider: "ups" }, {}]);
  const b = f.input.entries[2]!;
  f.app.carriers.cancel(f.actor, "cancel-last", {
    bookingId: b.bookingId,
    reviewHash: b.reviewHash,
    reason: "Synthetic canceled booking",
  });
  assert.deepEqual(
    f.app.carriers.canadaPostCandidates(f.actor, f.w1).items.map((b) => b.id),
    [f.input.entries[0]!.bookingId],
  );
  assert.equal(
    f.app.carriers.canadaPostCandidates(f.actor, f.w2).items.length,
    0,
  );
  assert.throws(
    () =>
      f.app.carriers.canadaPostCandidates(
        f.actor,
        f.w2,
        f.input.entries[0]!.bookingId,
      ),
    { code: "CURSOR" },
  );
  assert.throws(
    () =>
      f.app.carriers.canadaPostCandidates(
        f.actor,
        f.w1,
        f.input.entries[1]!.bookingId,
      ),
    { code: "CARRIER_MISMATCH" },
  );
  assert.throws(
    () => f.app.carriers.canadaPostCandidates(f.actor, f.w1, "missing"),
    { code: "NOT_FOUND" },
  );
  raw(
    f,
    "UPDATE integration_carrier_bookings SET org_id='foreign' WHERE id=?",
    b.bookingId,
  );
  assert.throws(
    () => f.app.carriers.canadaPostCandidates(f.actor, f.w1, b.bookingId),
    { code: "NOT_FOUND" },
  );
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_users SET role='warehouse',sites=? WHERE id=?",
      JSON.stringify([f.w2]),
      f.actor.id,
    );
  assert.throws(() => f.app.carriers.canadaPostCandidates(f.actor, f.w1), {
    code: "FORBIDDEN",
  });
});

test("Canada Post candidate review rejects corruption and refreshes user authority before exposing addresses", (t) => {
  const f = setup(t);
  raw(
    f,
    "UPDATE integration_carrier_bookings SET review_hash=? WHERE id=?",
    "b".repeat(64),
    f.input.entries[0]!.bookingId,
  );
  assert.throws(() => f.app.carriers.canadaPostCandidates(f.actor, f.w1), {
    code: "CARRIER_MISMATCH",
  });
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET active=0 WHERE id=?", f.actor.id);
  assert.throws(() => f.app.carriers.canadaPostCandidates(f.actor, f.w1));
});

test("HTTP candidate pages require current authenticated warehouse access and exact cursors while provider processing stays disabled", async (t) => {
  const f = setup(t, 2),
    origin = "http://127.0.0.1:3000";
  const http = await createHttp(f.app, {
    origin,
    staticRoot: "/nonexistent-distributor-test",
  });
  await http.ready();
  t.after(() => {
    void http.close();
  });
  const url = `/api/warehouses/${f.w1}/canada-post/candidates`;
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
    headers = { cookie: `${cookie.name}=${cookie.value}` };
  const before = allRows(f);
  const response = await http.inject({ method: "GET", url, headers });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().enabled, false);
  assert.equal(response.json().items.length, 2);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.deepEqual(allRows(f), before);
  for (const query of [
    "?after=",
    "?after=x&extra=true",
    "?after=" + "x".repeat(129),
  ])
    assert.equal(
      (await http.inject({ method: "GET", url: url + query, headers }))
        .statusCode,
      400,
    );
  assert.equal(
    (
      await http.inject({
        method: "GET",
        url: "/api/warehouses/foreign/canada-post/candidates",
        headers,
      })
    ).statusCode,
    404,
  );
  const g = f.app.carriers.prepareCanadaPostGroup(
    f.actor,
    "http-review-group",
    f.input,
  );
  const groupUrl = `/api/canada-post/groups/${g.id}/bookings`;
  const groupBefore = allRows(f);
  assert.equal(
    (await http.inject({ method: "GET", url: groupUrl })).statusCode,
    401,
  );
  const groupReview = await http.inject({
    method: "GET",
    url: groupUrl,
    headers,
  });
  assert.equal(groupReview.statusCode, 200, groupReview.body);
  assert.equal(groupReview.headers["cache-control"], "no-store");
  assert.deepEqual(
    groupReview.json(),
    f.app.carriers
      .reviewCanadaPostGroup(f.actor, g.id)
      .entries.map((e) =>
        response.json().items.find((b: { id: string }) => b.id === e.bookingId),
      ),
  );
  assert.deepEqual(allRows(f), groupBefore);
  assert.equal(
    (await http.inject({ method: "GET", url: groupUrl + "?extra=1", headers }))
      .statusCode,
    400,
  );
  assert.equal(
    (
      await http.inject({
        method: "GET",
        url: "/api/canada-post/groups/foreign/bookings",
        headers,
      })
    ).statusCode,
    404,
  );
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_users SET role='warehouse',sites='[]' WHERE id=?",
      f.actor.id,
    );
  assert.equal(
    (await http.inject({ method: "GET", url, headers })).statusCode,
    403,
  );
  assert.equal(
    (await http.inject({ method: "GET", url: groupUrl, headers })).statusCode,
    403,
  );
});

test("retained Canada Post group booking review returns exact scoped intent without writes and refuses tampering or changed authority", (t) => {
  const f = setup(t, 2);
  const expected = f.app.carriers.canadaPostCandidates(f.actor, f.w1).items;
  const g = f.app.carriers.prepareCanadaPostGroup(
    f.actor,
    "booking-review-group",
    f.input,
  );
  const before = allRows(f);
  assert.deepEqual(
    f.app.carriers.canadaPostGroupBookings(f.actor, g.id),
    f.app.carriers
      .reviewCanadaPostGroup(f.actor, g.id)
      .entries.map((e) => expected.find((b) => b.id === e.bookingId)),
  );
  assert.deepEqual(allRows(f), before);
  assert.throws(
    () => f.app.carriers.canadaPostGroupBookings(f.actor, "foreign"),
    { code: "NOT_FOUND" },
  );
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_users SET role='warehouse',sites=? WHERE id=?",
      JSON.stringify([f.w2]),
      f.actor.id,
    );
  assert.throws(() => f.app.carriers.canadaPostGroupBookings(f.actor, g.id), {
    code: "FORBIDDEN",
  });
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='admin' WHERE id=?", f.actor.id);
  raw(
    f,
    "UPDATE integration_carrier_bookings SET review_hash=? WHERE id=?",
    "c".repeat(64),
    f.input.entries[0]!.bookingId,
  );
  assert.throws(() => f.app.carriers.canadaPostGroupBookings(f.actor, g.id), {
    code: "CARRIER_MISMATCH",
  });
});
