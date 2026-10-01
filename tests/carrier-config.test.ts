import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.ts";
import { configuredCarriers } from "../src/server/carrier-config.ts";
import { DomainError } from "../src/server/core.ts";

function environment(orgId: string): NodeJS.ProcessEnv {
  return {
    CARRIERS_ENABLED: "true",
    CARRIER_ORG_ID: orgId,
    UPS_SANDBOX_ENABLED: "true",
    FEDEX_SANDBOX_ENABLED: "true",
    UPS_CLIENT_ID: "synthetic-ups-client",
    UPS_CLIENT_SECRET: "must-not-escape-ups-secret",
    UPS_SHIPPER_NUMBER: "A1B2C3",
    UPS_SHIPPER_JSON: JSON.stringify({
      name: "Synthetic shipper",
      line1: "1 Test Street",
      line2: "",
      city: "Toronto",
      province: "ON",
      postalCode: "M5V 1A1",
      country: "CA",
      phone: "+1 (416) 555-0100",
    }),
    UPS_SERVICES_JSON: JSON.stringify([
      { service: "Reviewed ground", code: "03" },
    ]),
    FEDEX_CLIENT_ID: "synthetic-fedex-client",
    FEDEX_CLIENT_SECRET: "must-not-escape-fedex-secret",
    FEDEX_ACCOUNT_NUMBER: "123456789",
    FEDEX_COUNTRY: "CA",
    FEDEX_PICKUP_TYPE: "DROPOFF_AT_FEDEX_LOCATION",
    FEDEX_SERVICES_JSON: JSON.stringify([
      { service: "Reviewed ground", code: "FEDEX_GROUND", residential: false },
    ]),
  };
}
const noTransport: typeof fetch = async () =>
  assert.fail("Startup must make no provider requests");

test("carrier startup defaults off and ignores incomplete subordinate configuration while disabled", (t) => {
  const f = fixture(t);
  for (const env of [
    {},
    {
      CARRIERS_ENABLED: "false",
      UPS_SANDBOX_ENABLED: "typo",
      UPS_CLIENT_SECRET: "private",
    },
    { PROVIDERS_ENABLED: "true" },
  ])
    assert.equal(configuredCarriers(f.app, env, noTransport), undefined);
});

for (const region of ["CA", "US"] as const)
  test(`carrier startup binds only the exact ${region} organization without requiring payment credentials or persisting secrets`, (t) => {
    const f = fixture(t, {}, region),
      env = environment(f.actor.orgId);
    // Shipping geography is independent of regional data storage.
    const runtime = configuredCarriers(f.app, env, noTransport)!;
    assert.equal(runtime.enabled(f.actor, "ups"), true);
    assert.equal(runtime.enabled(f.actor, "fedex"), true);
    assert.equal(runtime.enabled(f.actor, "canada-post"), false);
    assert.equal(runtime.enabled(f.actor, "usps"), false);
    env.UPS_SANDBOX_ENABLED = "false";
    env.CARRIER_ORG_ID = "different-organization";
    assert.equal(runtime.enabled(f.actor, "ups"), true);
    const rows = f.app.database
      .owned("integration")
      .all("SELECT * FROM integration_carrier_bookings");
    assert.deepEqual(rows, []);
    assert.throws(
      () =>
        runtime.enabled({ ...f.actor, orgId: "different-organization" }, "ups"),
      { code: "FORBIDDEN" },
    );
    f.app.database
      .owned("iam")
      .run("UPDATE iam_users SET active=0 WHERE id=?", f.actor.id);
    assert.throws(() => runtime.enabled(f.actor, "ups"), { code: "FORBIDDEN" });
  });

test("carrier startup rejects malformed flags, absent organization, credentials and exact mapping/address structures without leaking values", (t) => {
  const f = fixture(t),
    good = environment(f.actor.orgId);
  const changes: NodeJS.ProcessEnv[] = [
    { CARRIERS_ENABLED: "TRUE" },
    { CARRIERS_ENABLED: "" },
    { UPS_SANDBOX_ENABLED: "1" },
    { FEDEX_SANDBOX_ENABLED: " true" },
    { UPS_SANDBOX_ENABLED: "false", FEDEX_SANDBOX_ENABLED: "false" },
    { CARRIER_ORG_ID: undefined },
    { CARRIER_ORG_ID: "missing-organization" },
    { UPS_CLIENT_ID: undefined },
    { UPS_CLIENT_SECRET: "must-not-escape-secret\n" },
    { UPS_SHIPPER_NUMBER: "12345" },
    { UPS_SHIPPER_JSON: '{"private":"must-not-escape' },
    { UPS_SHIPPER_JSON: JSON.stringify({ private: "must-not-escape" }) },
    {
      UPS_SHIPPER_JSON: JSON.stringify({
        ...JSON.parse(good.UPS_SHIPPER_JSON!),
        country: "GB",
      }),
    },
    { UPS_SERVICES_JSON: "[]" },
    { UPS_SERVICES_JSON: "null" },
    {
      UPS_SERVICES_JSON:
        '[{"service":"must-not-escape","code":"03","endpoint":"private"}]',
    },
    { UPS_SERVICES_JSON: '[{"service":"Reviewed ground","code":3}]' },
    {
      UPS_SERVICES_JSON: JSON.stringify(
        Array(21).fill({ service: "ground", code: "03" }),
      ),
    },
    {
      UPS_SERVICES_JSON: JSON.stringify(
        Array(2).fill({ service: "ground", code: "03" }),
      ),
    },
    { UPS_SERVICES_JSON: "x".repeat(16385) },
    { FEDEX_CLIENT_SECRET: undefined },
    { FEDEX_ACCOUNT_NUMBER: "12345678" },
    { FEDEX_COUNTRY: "GB" },
    { FEDEX_PICKUP_TYPE: "UNKNOWN" },
    {
      FEDEX_SERVICES_JSON:
        '[{"service":"ground","code":"FEDEX_GROUND","residential":"false"}]',
    },
    {
      FEDEX_SERVICES_JSON:
        '[{"service":"ground","code":"FEDEX_GROUND","residential":false,"production":true}]',
    },
    {
      FEDEX_COUNTRY: "US",
      FEDEX_SERVICES_JSON:
        '[{"service":"ground","code":"FEDEX_GROUND","residential":true}]',
    },
  ];
  for (const change of changes)
    assert.throws(
      () => configuredCarriers(f.app, { ...good, ...change }, noTransport),
      (error) => {
        assert.ok(error instanceof DomainError);
        assert.equal(error.code, "CARRIER_CONFIG");
        assert.equal(error.status, 500);
        assert.doesNotMatch(
          error.message,
          /must-not-escape|synthetic-ups-client|123456789/,
        );
        return true;
      },
    );
});

test("unselected carrier fields cannot enable an adapter and may remain absent", (t) => {
  const f = fixture(t),
    good = environment(f.actor.orgId);
  for (const selected of ["UPS", "FEDEX"]) {
    const env: NodeJS.ProcessEnv = {
      CARRIERS_ENABLED: "true",
      CARRIER_ORG_ID: f.actor.orgId,
    };
    for (const [key, value] of Object.entries(good))
      if (key.startsWith(selected + "_")) env[key] = value;
    const other = selected === "UPS" ? "FEDEX" : "UPS";
    env[other + "_CLIENT_SECRET"] = "must-not-escape-incomplete";
    const runtime = configuredCarriers(f.app, env, noTransport)!;
    assert.equal(
      runtime.enabled(f.actor, selected === "UPS" ? "ups" : "fedex"),
      true,
    );
    assert.equal(
      runtime.enabled(f.actor, selected === "UPS" ? "fedex" : "ups"),
      false,
    );
  }
});
