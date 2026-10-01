import { test } from "node:test";
import assert from "node:assert/strict";
import {
  configurationFixture,
  clients,
  nativeConfiguration,
} from "./carrier-configuration-fixture.ts";
import { CarrierRuntime } from "../src/server/carrier-runtime.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import { canonical, digest } from "../src/server/core.ts";
import type { CarrierIntent } from "../src/server/carrier-bookings.ts";
import type { CarrierConfiguration } from "../src/shared/carrier-booking.ts";

const changes = {
  ups: [
    { shipperNumber: "D4E5F6" },
    { clientId: "another-client" },
    { services: [{ service: "Reviewed ground", code: "02" }] },
    {
      shipper: {
        name: "Changed shipper",
        line1: "30 Test Road",
        line2: "",
        city: "Buffalo",
        province: "NY",
        postalCode: "14201",
        country: "US",
        phone: "7165550100",
      },
    },
  ],
  fedex: [
    { accountNumber: "987654321" },
    { clientId: "another-client" },
    { country: "CA" },
    { pickupType: "USE_SCHEDULED_PICKUP" },
    {
      services: [
        {
          service: "Reviewed ground",
          code: "GROUND_HOME_DELIVERY",
          residential: true,
        },
      ],
    },
  ],
  usps: [
    { epsAccount: "98765432" },
    { clientId: "another-client" },
    { crid: "87654321" },
    { mid: "999999" },
    { manifestMid: "999999" },
    { mailingDate: "2026-10-02" },
    {
      services: [
        {
          service: "Reviewed ground",
          code: "PRIORITY_MAIL",
          processingCategory: "MACHINABLE",
        },
      ],
    },
  ],
};
for (const provider of ["ups", "fedex", "usps"] as const) {
  const Client = clients[provider];
  for (const change of changes[provider])
    test(`${provider} restart refuses changed ${Object.keys(change)[0]} before any I/O or claim`, async (t) => {
      const f = configurationFixture(t),
        config = f[provider];
      const client = new Client(config as never);
      const runtime = new CarrierRuntime(f.app, [
        { orgId: f.actor.orgId, adapter: client },
      ]);
      const input = {
        ...f.input,
        provider,
        configurationHash: client.configuration.hash,
      };
      const receipt = runtime.prepare(f.actor, "bound-prepare", input),
        before = nativeConfiguration(f);
      const retained = f.app.carriers.review(f.actor, f.shipmentId).booking;
      const raw = f.app.database
        .owned("integration")
        .get<{ intent: string }>(
          "SELECT intent FROM integration_carrier_bookings WHERE id=?",
          receipt.id,
        )!.intent;
      f.app.close();
      f.app = new Application(f.path, "US");
      let calls = 0;
      const changed = new Client(
        { ...config, ...change } as never,
        async () => {
          calls++;
          throw Error("Unexpected network call");
        },
      );
      const restarted = new CarrierRuntime(f.app, [
        { orgId: f.actor.orgId, adapter: changed },
      ]);
      assert.throws(() => restarted.prepare(f.actor, "bound-prepare", input), {
        code: "CARRIER_CONFIG_CHANGED",
      });
      await assert.rejects(() => restarted.execute(f.actor, receipt.id), {
        code: "CARRIER_CONFIG_CHANGED",
      });
      const intent = JSON.parse(raw) as CarrierIntent;
      await assert.rejects(
        () =>
          changed.book(intent, () => {
            throw Error("Unexpected guard");
          }),
        { code: "CARRIER_CONFIG_CHANGED" },
      );
      await assert.rejects(() => changed.lookup(intent), {
        code: "CARRIER_CONFIG_CHANGED",
      });
      assert.equal(calls, 0);
      assert.deepEqual(
        f.app.carriers.review(f.actor, f.shipmentId).booking,
        retained,
      );
      assert.deepEqual(
        {
          ...f.app.database
            .owned("integration")
            .get(
              "SELECT token,started_at FROM integration_carrier_bookings WHERE id=?",
              receipt.id,
            ),
        },
        { token: null, started_at: null },
      );
      assert.deepEqual(nativeConfiguration(f), before);
      // Restoring reviewed settings permits exact receipt recovery, without I/O.
      const restored = new CarrierRuntime(f.app, [
        { orgId: f.actor.orgId, adapter: new Client(config as never) },
      ]);
      assert.deepEqual(
        restored.prepare(f.actor, "bound-prepare", input),
        receipt,
      );
      f.app.carriers.cancel(f.actor, "cancel-before-new-review", {
        bookingId: receipt.id,
        reviewHash: receipt.reviewHash,
        reason: "Synthetic reviewed configuration change",
      });
      const next = restarted.prepare(f.actor, "review-new-settings", {
        ...input,
        previousId: receipt.id,
        configurationHash: changed.configuration.hash,
      });
      assert.notEqual(next.id, receipt.id);
      const history = f.app.carriers.history(f.actor, f.shipmentId).items;
      assert.equal(
        history.find((b) => b.id === receipt.id)!.configuration!.hash,
        client.configuration.hash,
      );
      assert.equal(
        history.find((b) => b.id === next.id)!.configuration!.hash,
        changed.configuration.hash,
      );
      assert.deepEqual(nativeConfiguration(f), before);
    });
  test(`${provider} secret rotation retains configuration identity while missing/forged reviews refuse direct I/O`, async (t) => {
    const f = configurationFixture(t),
      config = f[provider],
      original = new Client(config as never);
    const rotated = new Client({
      ...config,
      clientSecret: "rotated-synthetic-secret",
    } as never);
    assert.deepEqual(rotated.configuration, original.configuration);
    const runtime = new CarrierRuntime(f.app, [
      { orgId: f.actor.orgId, adapter: original },
    ]);
    const input = {
      ...f.input,
      provider,
      configurationHash: original.configuration.hash,
    };
    const receipt = runtime.prepare(f.actor, "bound-prepare", input);
    const stored = f.app.database
      .owned("integration")
      .get<{ intent: string }>(
        "SELECT intent FROM integration_carrier_bookings WHERE id=?",
        receipt.id,
      )!.intent;
    for (const secret of [
      config.clientId,
      config.clientSecret,
      "rotated-synthetic-secret",
    ])
      assert.ok(!stored.includes(secret));
    const parsed = JSON.parse(stored) as CarrierIntent;
    let calls = 0;
    const guarded = new Client(config as never, async () => {
      calls++;
      throw Error("Unexpected network call");
    });
    for (const modified of [
      Object.fromEntries(
        Object.entries(parsed).filter(
          ([key]) => key !== "configuration" && key !== "configurationHash",
        ),
      ) as CarrierIntent,
      {
        ...parsed,
        configuration: {
          ...parsed.configuration!,
          accountHint: "Forged account",
        },
      },
    ]) {
      // Syntactically valid review hashes must not substitute configuration identity.
      const { bookingId, reviewHash, ...review } = modified;
      const intent = { ...modified, reviewHash: digest(canonical(review)) };
      await assert.rejects(() => guarded.book(intent, () => {}), {
        code: "CARRIER_CONFIG_CHANGED",
      });
    }
    assert.equal(calls, 0);
  });
}

test("HTTP configuration review is scoped, server-owned, exact-retry safe and refuses stale settings before durable prepare", async (t) => {
  const f = configurationFixture(t),
    before = nativeConfiguration(f),
    client = new clients.usps(f.usps);
  const runtime = new CarrierRuntime(f.app, [
    { orgId: f.actor.orgId, adapter: client },
  ]);
  const http = await createHttp(f.app, {
    origin: "http://localhost:3000",
    carriers: runtime,
  });
  t.after(async () => {
    await http.close();
  });
  const login = f.app.identity.login(
    "admin@example.test",
    "long-test-only-password",
  );
  const headers = {
    cookie: `distributor_session=${login.token}`,
    "x-csrf-token": login.csrf,
    origin: "http://localhost:3000",
    "idempotency-key": "configuration-http-prepare",
  };
  const url = `/api/shipments/${f.shipmentId}/carrier`;
  assert.equal((await http.inject({ method: "GET", url })).statusCode, 401);
  const review = await http.inject({ method: "GET", url, headers });
  assert.equal(review.statusCode, 200);
  assert.deepEqual(review.json().configurations, [client.configuration]);
  assert.ok(!review.body.includes(f.usps.clientSecret));
  assert.ok(!review.body.includes(f.usps.clientId));
  const input = { ...f.input, configurationHash: client.configuration.hash };
  const commandUrl = "/api/commands/carrier.prepare";
  for (const payload of [
    f.input,
    { ...input, configurationHash: "0".repeat(64) },
    { ...input, service: "Unmapped service" },
  ]) {
    const refused = await http.inject({
      method: "POST",
      url: commandUrl,
      headers,
      payload,
    });
    assert.equal(refused.statusCode, 409);
    assert.equal(refused.json().code, "CARRIER_CONFIG_CHANGED");
  }
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: commandUrl,
        headers,
        payload: { ...input, configuration: client.configuration },
      })
    ).statusCode,
    400,
  );
  assert.equal(f.app.carriers.review(f.actor, f.shipmentId).booking, null);
  const prepared = await http.inject({
    method: "POST",
    url: commandUrl,
    headers,
    payload: input,
  });
  assert.equal(prepared.statusCode, 200);
  const replay = await http.inject({
    method: "POST",
    url: commandUrl,
    headers,
    payload: input,
  });
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(replay.json(), prepared.json());
  assert.deepEqual(
    f.app.carriers.review(f.actor, f.shipmentId).booking!.configuration,
    client.configuration,
  );
  assert.deepEqual(nativeConfiguration(f), before);
  const scopes = runtime.configurations(f.actor) as CarrierConfiguration[];
  // Caller-owned clones cannot rewrite the registration used by preparation.
  (scopes[0] as { accountHint: string }).accountHint =
    "Changed returned review";
  assert.deepEqual(runtime.configurations(f.actor), [client.configuration]);
});

test("historical unbound bookings refuse real clients without changing receipts; unknown bound bookings cannot use configless adapters", async (t) => {
  const f = configurationFixture(t),
    before = nativeConfiguration(f);
  const receipt = f.app.carriers.prepare(
    f.actor,
    "historical-unbound",
    f.input,
  );
  let calls = 0;
  const client = new clients.usps(f.usps, async () => {
    calls++;
    throw Error("Unexpected network");
  });
  const runtime = new CarrierRuntime(f.app, [
    { orgId: f.actor.orgId, adapter: client },
  ]);
  await assert.rejects(() => runtime.execute(f.actor, receipt.id), {
    code: "CARRIER_CONFIG_CHANGED",
  });
  assert.equal(
    f.app.carriers.review(f.actor, f.shipmentId).booking!.state,
    "pending",
  );
  f.app.carriers.cancel(f.actor, "cancel-unbound", {
    bookingId: receipt.id,
    reviewHash: receipt.reviewHash,
    reason: "Review account and mailing date",
  });
  const next = runtime.prepare(f.actor, "bound-successor", {
    ...f.input,
    previousId: receipt.id,
    configurationHash: client.configuration.hash,
  });
  const uncertain = new CarrierRuntime(f.app, [
    {
      orgId: f.actor.orgId,
      adapter: {
        provider: "usps",
        sandbox: true,
        configuration: client.configuration,
        async book(_intent, guard) {
          guard();
          throw Error("Synthetic lost label reply");
        },
        async lookup() {
          calls++;
          return null;
        },
      },
    },
  ]);
  await assert.rejects(
    () => uncertain.execute(f.actor, next.id),
    /Synthetic lost label reply/,
  );
  const unbound = new CarrierRuntime(f.app, [
    {
      orgId: f.actor.orgId,
      adapter: {
        provider: "usps",
        sandbox: true,
        async book() {
          calls++;
          throw Error("Unexpected write");
        },
        async lookup() {
          calls++;
          return null;
        },
      },
    },
  ]);
  await assert.rejects(() => unbound.reconcile(f.actor, next.id), {
    code: "CARRIER_CONFIG_CHANGED",
  });
  const retained = f.app.carriers.review(f.actor, f.shipmentId).booking;
  f.app.close();
  f.app = new Application(f.path, "US");
  const changed = new CarrierRuntime(f.app, [
    {
      orgId: f.actor.orgId,
      adapter: new clients.usps(
        { ...f.usps, mailingDate: "2026-10-02" },
        async () => {
          calls++;
          throw Error("Unexpected network");
        },
      ),
    },
  ]);
  await assert.rejects(() => changed.reconcile(f.actor, next.id), {
    code: "CARRIER_CONFIG_CHANGED",
  });
  assert.deepEqual(
    f.app.carriers.review(f.actor, f.shipmentId).booking,
    retained,
  );
  assert.throws(
    () =>
      f.app.carriers.cancel(f.actor, "cancel-unknown", {
        bookingId: next.id,
        reviewHash: next.reviewHash,
        reason: "Never replace unknown",
      }),
    { code: "STATE" },
  );
  assert.equal(calls, 0);
  assert.deepEqual(nativeConfiguration(f), before);
});

test("runtime captures immutable bounded carrier reviews and refuses mismatched or extra metadata", (t) => {
  const f = configurationFixture(t);
  const profile = new clients.usps(f.usps).configuration;
  const mutable = {
    ...profile,
    details: [...profile.details],
    services: profile.services.map((entry) => ({ ...entry })),
  };
  const adapter = {
    provider: "usps" as const,
    sandbox: true as const,
    configuration: mutable,
    async book() {
      throw Error("Unexpected provider write");
    },
    async lookup() {
      throw Error("Unexpected provider read");
    },
  };
  const runtime = new CarrierRuntime(f.app, [
    { orgId: f.actor.orgId, adapter },
  ]);
  mutable.details[0] = "Changed after registration";
  mutable.services[0]!.description = "Changed after registration";
  assert.deepEqual(runtime.configurations(f.actor), [profile]);
  for (const configuration of [
    null,
    { ...profile, provider: "ups" },
    { ...profile, hash: "invalid" },
    { ...profile, clientSecret: "synthetic-extra-secret" },
    { ...profile, details: ["x".repeat(2049)] },
    { ...profile, services: [] },
    { ...profile, services: [...profile.services, ...profile.services] },
    { ...profile, services: [{ ...profile.services[0], credential: "extra" }] },
  ]) {
    assert.throws(
      () =>
        new CarrierRuntime(f.app, [
          {
            orgId: f.actor.orgId,
            adapter: {
              ...adapter,
              configuration: configuration as CarrierConfiguration,
            },
          },
        ]),
      { code: "CARRIER_CONFIG" },
    );
  }
});
