import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, native, configurationHash } from "./canada-post-fixture.ts";
import { client } from "./canada-post-creation-fixture.ts";
import { manifestClient } from "./canada-post-manifest-fixture.ts";
import {
  CarrierRuntime,
  type CanadaPostBinding,
} from "../src/server/carrier-runtime.ts";
import { configuredCarriers } from "../src/server/carrier-config.ts";
import { createHttp } from "../src/server/http.ts";

function binding(f: ReturnType<typeof setup>) {
  const creation = client(),
    manifest = manifestClient();
  // Keep each fixture's receiver/counters intact, like a trusted protocol client.
  return {
    orgId: f.actor.orgId,
    warehouseId: f.w1,
    client: {
      testApplication: true as const,
      configurationHash,
      create: creation.create.bind(creation),
      lookup: creation.lookup.bind(creation),
      manifestIdentity: manifest.manifestIdentity.bind(manifest),
      transmitManifest: manifest.transmitManifest.bind(manifest),
      recoverManifest: manifest.recoverManifest.bind(manifest),
    },
    creation,
    manifest,
  };
}
function environment(f: ReturnType<typeof setup>): NodeJS.ProcessEnv {
  return {
    CARRIERS_ENABLED: "true",
    CANADA_POST_TEST_ENABLED: "true",
    CARRIER_ORG_ID: f.actor.orgId,
    CANADA_POST_WAREHOUSE_ID: f.w1,
    CANADA_POST_TEST_CREDENTIALS_ACK: "test-application-only",
    CANADA_POST_CLIENT_ID: "synthetic-client",
    CANADA_POST_CLIENT_SECRET: "must-not-escape",
    CANADA_POST_CUSTOMER_NUMBER: "1234567",
    CANADA_POST_CONTRACT_ID: "123456",
    CANADA_POST_COMPANY: "Synthetic warehouse",
    CANADA_POST_SHIPPING_POINT_JSON: JSON.stringify({
      kind: "pickup",
      postalCode: "M5V1A1",
    }),
    CANADA_POST_SERVICES_JSON: JSON.stringify([
      { service: "Synthetic domestic", code: "DOM.RP" },
    ]),
  };
}
const noTransport: typeof fetch = async () =>
  assert.fail("No provider request is permitted in configuration tests");

test("Canada Post startup is independently opt-in, captures exact warehouse configuration and makes no requests", (t) => {
  const f = setup(t),
    env = environment(f);
  for (const disabled of [
    {},
    { CARRIERS_ENABLED: "false", CANADA_POST_TEST_ENABLED: "typo" },
  ])
    assert.equal(configuredCarriers(f.app, disabled, noTransport), undefined);
  const r = configuredCarriers(f.app, env, noTransport)!;
  assert.equal(r.enabled(f.actor, "canada-post"), false);
  assert.equal(r.canadaPostEnabled(f.actor, f.w1), true);
  assert.equal(r.canadaPostEnabled(f.actor, f.w2), false);
  const group = r.prepareCanadaPostGroup(f.actor, "configured-group", {
    warehouseId: f.w1,
    entries: f.input.entries,
  });
  assert.notEqual(
    f.app.carriers.reviewCanadaPostGroup(f.actor, group.id).configurationHash,
    configurationHash,
  );
  assert.doesNotMatch(
    JSON.stringify(group),
    /must-not-escape|synthetic-client/,
  );
  env.CANADA_POST_WAREHOUSE_ID = f.w2;
  assert.equal(r.canadaPostEnabled(f.actor, f.w1), true);
  assert.throws(() => r.execute(f.actor, f.input.entries[0]!.bookingId), {
    code: "CARRIER_DISABLED",
  });
});

for (const change of [
  { CANADA_POST_TEST_ENABLED: "TRUE" },
  { CANADA_POST_TEST_CREDENTIALS_ACK: undefined },
  { CANADA_POST_TEST_CREDENTIALS_ACK: "production" },
  { CANADA_POST_WAREHOUSE_ID: "foreign" },
  { CARRIER_ORG_ID: "foreign" },
  { CANADA_POST_CLIENT_SECRET: undefined },
  { CANADA_POST_CLIENT_SECRET: "must-not-escape\n" },
  { CANADA_POST_CUSTOMER_NUMBER: "secret" },
  { CANADA_POST_SHIPPING_POINT_JSON: '{"private":"must-not-escape' },
  {
    CANADA_POST_SHIPPING_POINT_JSON:
      '{"kind":"pickup","postalCode":"M5V 1A1","endpoint":"private"}',
  },
  { CANADA_POST_SHIPPING_POINT_JSON: '{"kind":"deposit","siteId":"bad"}' },
  { CANADA_POST_SERVICES_JSON: "[]" },
  {
    CANADA_POST_SERVICES_JSON: '[{"service":"Synthetic domestic","code":"US"}]',
  },
  {
    CANADA_POST_SERVICES_JSON:
      '[{"service":"Synthetic domestic","code":"DOM.RP","production":true}]',
  },
])
  test(`Canada Post startup refuses invalid ${Object.keys(change)[0]} configuration without leaking input`, (t) => {
    const f = setup(t);
    assert.throws(
      () =>
        configuredCarriers(
          f.app,
          { ...environment(f), ...change },
          noTransport,
        ),
      (error) => {
        assert.equal((error as { code: string }).code, "CARRIER_CONFIG");
        assert.doesNotMatch(
          (error as Error).message,
          /must-not-escape|synthetic-client/,
        );
        return true;
      },
    );
  });

test("Canada Post runtime captures method handles and dispatches a two-member group through exact manifest confirmation", async (t) => {
  const f = setup(t, 2),
    b = binding(f),
    r = new CarrierRuntime(f.app, [], [b]),
    before = native(f);
  const group = r.prepareCanadaPostGroup(f.actor, "group", {
    warehouseId: f.w1,
    entries: f.input.entries,
  });
  b.client.create = async () => assert.fail("Captured method replaced");
  b.client.transmitManifest = async () =>
    assert.fail("Captured method replaced");
  b.orgId = "foreign";
  b.warehouseId = f.w2;
  b.client.configurationHash = "b".repeat(64);
  assert.equal(
    f.app.carriers.canadaPostGroupForBooking(
      f.actor,
      f.input.entries[0]!.bookingId,
    )!.id,
    group.id,
  );
  for (const entry of f.input.entries)
    await r.createCanadaPostMember(f.actor, group.id, entry.bookingId);
  assert.equal(b.creation.creates, 2);
  const identity = r.reviewCanadaPostManifest(f.actor, group.id);
  await assert.rejects(
    r.transmitCanadaPostManifest(f.actor, group.id, "b".repeat(64)),
    { code: "CARRIER_MISMATCH" },
  );
  assert.equal(b.manifest.writes, 0);
  assert.equal(
    (await r.transmitCanadaPostManifest(f.actor, group.id, identity.reviewHash))
      .state,
    "transmitted",
  );
  assert.equal(b.manifest.writes, 1);
  assert.deepEqual(native(f), before);
  for (const id of f.shipments)
    assert.equal(f.app.carriers.review(f.actor, id).booking!.state, "booked");
  await assert.rejects(
    r.transmitCanadaPostManifest(f.actor, group.id, identity.reviewHash),
  );
  assert.equal(b.manifest.writes, 1);
});

for (const restriction of [
  "wrong-warehouse",
  "wrong-configuration",
  "revoked-site",
  "revoked-user",
  "password-change",
  "foreign-organization",
] as const)
  test(`Canada Post runtime refuses ${restriction} before provider hooks`, (t) => {
    const f = setup(t),
      b = binding(f),
      group = f.app.carriers.prepareCanadaPostGroup(f.actor, "group", f.input);
    if (restriction === "wrong-warehouse") b.warehouseId = f.w2;
    if (restriction === "wrong-configuration")
      b.client.configurationHash = "b".repeat(64);
    if (restriction === "foreign-organization") b.orgId = "foreign";
    const r = new CarrierRuntime(f.app, [], [b]);
    if (restriction === "revoked-site")
      f.app.database
        .owned("iam")
        .run(
          "UPDATE iam_users SET role='warehouse',sites='[]' WHERE id=?",
          f.actor.id,
        );
    if (restriction === "revoked-user")
      f.app.database
        .owned("iam")
        .run("UPDATE iam_users SET active=0 WHERE id=?", f.actor.id);
    if (restriction === "password-change")
      f.app.database
        .owned("iam")
        .run(
          "INSERT INTO iam_user_security VALUES(?,1,1,'2026-10-01T00:00:00Z') ON CONFLICT(user_id) DO UPDATE SET password_change_required=1",
          f.actor.id,
        );
    assert.throws(() =>
      r.createCanadaPostMember(
        f.actor,
        group.id,
        f.input.entries[0]!.bookingId,
      ),
    );
    assert.throws(() =>
      r.reconcileCanadaPostMember(
        f.actor,
        group.id,
        f.input.entries[0]!.bookingId,
      ),
    );
    assert.throws(() => r.reviewCanadaPostManifest(f.actor, group.id));
    assert.equal(
      b.creation.creates +
        b.creation.lookups +
        b.manifest.writes +
        b.manifest.reads,
      0,
    );
  });

test("Canada Post registrations reject incomplete, production and duplicate clients", (t) => {
  const f = setup(t),
    good = binding(f);
  for (const bad of [
    { ...good, warehouseId: " " },
    { ...good, orgId: "" },
    { ...good, client: { ...good.client, testApplication: false } },
    { ...good, client: { ...good.client, configurationHash: "invalid" } },
    { ...good, client: { ...good.client, recoverManifest: undefined } },
  ])
    assert.throws(
      () => new CarrierRuntime(f.app, [], [bad as CanadaPostBinding]),
      { code: "CARRIER_CONFIG" },
    );
  assert.throws(() => new CarrierRuntime(f.app, [], [good, good]), {
    code: "CARRIER_CONFIG",
  });
});

test("Canada Post group history is bounded, warehouse-scoped and retains canceled memberships without exposing private evidence", (t) => {
  const f = setup(t),
    b = binding(f),
    r = new CarrierRuntime(f.app, [], [b]);
  for (let i = 0; i < 23; i++) {
    const g = r.prepareCanadaPostGroup(f.actor, `group-${i}`, {
      warehouseId: f.w1,
      entries: f.input.entries,
    });
    f.app.carriers.cancelCanadaPostGroup(f.actor, `cancel-${i}`, {
      groupId: g.id,
      reviewHash: g.reviewHash,
      reason: "Synthetic unsent group cancellation",
    });
  }
  assert.equal(
    f.app.carriers.canadaPostGroupForBooking(
      f.actor,
      f.input.entries[0]!.bookingId,
    ),
    null,
  );
  const first = f.app.carriers.canadaPostGroups(f.actor, f.w1);
  assert.equal(first.items.length, 20);
  assert.ok(first.next);
  const rest = f.app.carriers.canadaPostGroups(f.actor, f.w1, first.next!);
  assert.equal(rest.items.length, 3);
  assert.equal(rest.next, null);
  assert.equal(
    new Set([...first.items, ...rest.items].map((g) => g.id)).size,
    23,
  );
  assert.throws(
    () => f.app.carriers.canadaPostGroups(f.actor, f.w2, first.next!),
    { code: "CARRIER_MISMATCH" },
  );
  assert.throws(
    () => f.app.carriers.canadaPostGroups(f.actor, f.w1, "foreign"),
    { code: "NOT_FOUND" },
  );
  assert.doesNotMatch(
    JSON.stringify(first),
    /label_bytes|manifest_bytes|clientSecret/,
  );
});

const origin = "http://127.0.0.1:3000";
async function httpFixture(t: Parameters<typeof setup>[0], enabled = true) {
  const f = setup(t, 2),
    b = binding(f),
    carriers = enabled ? new CarrierRuntime(f.app, [], [b]) : undefined;
  const http = await createHttp(f.app, {
    origin,
    staticRoot: "/nonexistent-distributor-test",
    carriers,
  });
  await http.ready();
  t.after(() => {
    void http.close();
  });
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
  const cookie = login.cookies[0]!;
  return {
    ...f,
    b,
    carriers,
    http,
    headers: {
      origin,
      cookie: `${cookie.name}=${cookie.value}`,
      "x-csrf-token": login.json().csrf,
      "idempotency-key": "http-group",
    },
  };
}

test("HTTP Canada Post groups require exact schemas, CSRF and current warehouse authorization; default-off has no provider hooks", async (t) => {
  const f = await httpFixture(t, false),
    url = "/api/commands/canada-post.group.prepare",
    payload = { warehouseId: f.w1, entries: f.input.entries };
  assert.equal(
    (await f.http.inject({ method: "POST", url, headers: f.headers, payload }))
      .statusCode,
    503,
  );
  assert.equal(
    (
      await f.http.inject({
        method: "POST",
        url,
        headers: { ...f.headers, "x-csrf-token": "wrong" },
        payload,
      })
    ).statusCode,
    403,
  );
  for (const bad of [
    { ...payload, configurationHash },
    { ...payload, entries: [] },
    { ...payload, entries: Array(101).fill(f.input.entries[0]) },
  ])
    assert.equal(
      (
        await f.http.inject({
          method: "POST",
          url,
          headers: f.headers,
          payload: bad,
        })
      ).statusCode,
      400,
    );
  assert.equal(
    (
      await f.http.inject({
        method: "GET",
        url: `/api/warehouses/${f.w1}/canada-post/groups`,
        headers: f.headers,
      })
    ).json().enabled,
    false,
  );
  const g = f.app.carriers.prepareCanadaPostGroup(f.actor, "direct", f.input);
  assert.equal(
    (
      await f.http.inject({
        method: "POST",
        url: `/api/canada-post/groups/${g.id}/members/${f.input.entries[0]!.bookingId}/create`,
        headers: f.headers,
        payload: {},
      })
    ).statusCode,
    503,
  );
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_users SET role='warehouse',sites='[]' WHERE id=?",
      f.actor.id,
    );
  for (const path of [
    `/api/canada-post/groups/${g.id}`,
    `/api/warehouses/${f.w1}/canada-post/groups`,
    `/api/carrier/${f.input.entries[0]!.bookingId}/canada-post/group`,
  ])
    assert.equal(
      (await f.http.inject({ method: "GET", url: path, headers: f.headers }))
        .statusCode,
      403,
    );
  assert.equal(f.b.creation.creates + f.b.manifest.writes, 0);
});

test("HTTP Canada Post operators can prepare, create all members, review/transmit the manifest and download private evidence", async (t) => {
  const f = await httpFixture(t),
    before = native(f),
    payload = { warehouseId: f.w1, entries: f.input.entries };
  const prepared = await f.http.inject({
    method: "POST",
    url: "/api/commands/canada-post.group.prepare",
    headers: f.headers,
    payload,
  });
  assert.equal(prepared.statusCode, 200, prepared.body);
  const g = prepared.json();
  assert.deepEqual(
    (
      await f.http.inject({
        method: "POST",
        url: "/api/commands/canada-post.group.prepare",
        headers: f.headers,
        payload,
      })
    ).json(),
    g,
  );
  const base = `/api/canada-post/groups/${g.id}`;
  assert.equal(
    (
      await f.http.inject({
        method: "GET",
        url: `/api/carrier/${f.input.entries[0]!.bookingId}/canada-post/group`,
        headers: f.headers,
      })
    ).json().id,
    g.id,
  );
  assert.equal(
    (
      await f.http.inject({
        method: "GET",
        url: `${base}/manifest/document`,
        headers: f.headers,
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await f.http.inject({
        method: "POST",
        url: `/api/carrier/${f.input.entries[0]!.bookingId}/send`,
        headers: f.headers,
        payload: {},
      })
    ).statusCode,
    503,
  );
  for (const entry of f.input.entries) {
    const response = await f.http.inject({
      method: "POST",
      url: `${base}/members/${entry.bookingId}/create`,
      headers: f.headers,
      payload: {},
    });
    assert.equal(response.statusCode, 200, response.body);
  }
  assert.equal(
    (
      await f.http.inject({ method: "GET", url: base, headers: f.headers })
    ).json().state,
    "closed",
  );
  const review = await f.http.inject({
    method: "GET",
    url: `${base}/manifest/review`,
    headers: f.headers,
  });
  assert.equal(review.statusCode, 200, review.body);
  const transmitted = await f.http.inject({
    method: "POST",
    url: `${base}/manifest/transmit`,
    headers: f.headers,
    payload: { reviewHash: review.json().reviewHash },
  });
  assert.equal(transmitted.statusCode, 200, transmitted.body);
  const document = await f.http.inject({
    method: "GET",
    url: `${base}/manifest/document`,
    headers: f.headers,
  });
  assert.equal(document.statusCode, 200, document.body);
  assert.equal(document.headers["cache-control"], "no-store");
  assert.equal(document.headers["content-type"], "application/octet-stream");
  assert.match(String(document.headers["x-document-sha256"]), /^[a-f0-9]{64}$/);
  assert.equal(document.rawPayload.subarray(0, 5).toString(), "%PDF-");
  assert.equal(
    (await f.http.inject({ method: "GET", url: `${base}/manifest/document` }))
      .statusCode,
    401,
  );
  assert.deepEqual(native(f), before);
  assert.equal(f.b.creation.creates, 2);
  assert.equal(f.b.manifest.writes, 1);
});

test("HTTP grouped recovery reads existing effects after lost responses without resending members or manifests", async (t) => {
  const f = setup(t),
    b = binding(f);
  const c = b.client.create,
    m = b.client.transmitManifest;
  b.client.create = async (...args) => {
    await c(...args);
    throw Error("Synthetic lost member response");
  };
  b.client.transmitManifest = async (...args) => {
    await m(...args);
    throw Error("Synthetic lost manifest response");
  };
  const http = await createHttp(f.app, {
    origin,
    staticRoot: "/nonexistent-distributor-test",
    carriers: new CarrierRuntime(f.app, [], [b]),
  });
  await http.ready();
  t.after(() => {
    void http.close();
  });
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: {
      email: "admin@example.test",
      password: "long-test-only-password",
    },
  });
  const cookie = login.cookies[0]!;
  const headers = {
    origin,
    cookie: `${cookie.name}=${cookie.value}`,
    "x-csrf-token": login.json().csrf,
  };
  const g = f.app.carriers.prepareCanadaPostGroup(f.actor, "group", f.input),
    base = `/api/canada-post/groups/${g.id}`;
  const member = `${base}/members/${f.input.entries[0]!.bookingId}`;
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: `${member}/create`,
        headers,
        payload: {},
      })
    ).statusCode,
    500,
  );
  assert.equal(
    f.app.carriers.reviewCanadaPostGroup(f.actor, g.id).entries[0]!.state,
    "unknown",
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: `${member}/create`,
        headers,
        payload: {},
      })
    ).statusCode,
    409,
  );
  assert.equal(b.creation.creates, 1);
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: `${member}/reconcile`,
        headers,
        payload: {},
      })
    ).statusCode,
    200,
  );
  assert.equal(b.creation.lookups, 1);
  const review = (
    await http.inject({
      method: "GET",
      url: `${base}/manifest/review`,
      headers,
    })
  ).json();
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: `${base}/manifest/transmit`,
        headers,
        payload: { reviewHash: review.reviewHash },
      })
    ).statusCode,
    500,
  );
  assert.equal(
    f.app.carriers.reviewCanadaPostGroup(f.actor, g.id).state,
    "unknown",
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: `${base}/manifest/transmit`,
        headers,
        payload: { reviewHash: review.reviewHash },
      })
    ).statusCode,
    409,
  );
  assert.equal(b.manifest.writes, 1);
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: `${base}/manifest/reconcile`,
        headers,
        payload: { reviewHash: review.reviewHash },
      })
    ).statusCode,
    200,
  );
  assert.equal(b.manifest.reads, 1);
  assert.equal(b.manifest.writes, 1);
});

test("HTTP cancellation of an entirely unsent group remains available with provider processing disabled", async (t) => {
  const f = await httpFixture(t, false),
    g = f.app.carriers.prepareCanadaPostGroup(f.actor, "group", f.input);
  const response = await f.http.inject({
    method: "POST",
    url: "/api/commands/canada-post.group.cancel",
    headers: f.headers,
    payload: {
      groupId: g.id,
      reviewHash: g.reviewHash,
      reason: "Synthetic disabled-client cancellation",
    },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(
    f.app.carriers.reviewCanadaPostGroup(f.actor, g.id).state,
    "canceled",
  );
  assert.equal(f.b.creation.creates + f.b.manifest.writes, 0);
});
