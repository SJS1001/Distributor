import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, chooseProviders } from "./fixtures.ts";
import { configurationFixture } from "./carrier-configuration-fixture.ts";
import {
  replacementCarrierFixture,
  replacementDispatch,
} from "./replacement-carrier-fixture.ts";
import { warrantyUser, warrantyGrants } from "./warranty-authority-fixtures.ts";
import { configuredCarriers } from "../src/server/carrier-config.ts";
import { CarrierRuntime } from "../src/server/carrier-runtime.ts";
import { Application } from "../src/server/application.ts";
import { UpsSandbox } from "../src/server/ups-sandbox.ts";
import { createHttp } from "../src/server/http.ts";
import { DomainError } from "../src/server/core.ts";
import type { CarrierPrepare } from "../src/shared/carrier-booking.ts";
import { allRows } from "./canada-post-fixture.ts";

type F = ReturnType<typeof fixture>;
const never: typeof fetch = async () =>
  assert.fail("Unexpected outbound request");
function origins(f: F) {
  return [f.w1, f.w2].map((warehouseId, i) => ({
    warehouseId,
    shipperNumber: i ? "D4E5F6" : "A1B2C3",
    shipper: {
      name: `Synthetic origin ${i}`,
      line1: `${i + 1} Test Street`,
      line2: "",
      city: i ? "Ottawa" : "Toronto",
      province: "ON",
      postalCode: i ? "K1A 0B1" : "M5V 1A1",
      country: "CA",
      phone: "4165550100",
    },
    services: [{ service: `Synthetic ground ${i}`, code: "03" }],
    clientIdEnv: `UPS_ORIGIN_${i}_ID`,
    clientSecretEnv: `UPS_ORIGIN_${i}_SECRET`,
  }));
}
function environment(f: F): NodeJS.ProcessEnv {
  return {
    CARRIERS_ENABLED: "true",
    CARRIER_ORG_ID: f.actor.orgId,
    UPS_SANDBOX_ENABLED: "true",
    UPS_WAREHOUSES_JSON: JSON.stringify(origins(f)),
    UPS_ORIGIN_0_ID: "synthetic-client-0",
    UPS_ORIGIN_0_SECRET: "must-not-escape-secret-0",
    UPS_ORIGIN_1_ID: "synthetic-client-1",
    UPS_ORIGIN_1_SECRET: "must-not-escape-secret-1",
  };
}
function rows(f: F) {
  return allRows(f as Parameters<typeof allRows>[0]);
}
function invalid(f: F, env: NodeJS.ProcessEnv) {
  const before = rows(f);
  assert.throws(
    () => configuredCarriers(f.app, env, never),
    (error) => {
      assert.ok(error instanceof DomainError);
      assert.equal(error.code, "CARRIER_CONFIG");
      assert.equal(error.status, 500);
      assert.doesNotMatch(error.message, /must-not-escape|synthetic-client/);
      return true;
    },
  );
  assert.deepEqual(rows(f), before);
}
for (const [name, value] of Object.entries({
  empty: [],
  null: null,
  object: {},
  missing: [null],
  tooMany: Array(21).fill({}),
}))
  test(`UPS warehouse startup refuses ${name} list without writes or I/O`, (t) => {
    const f = fixture(t);
    invalid(f, {
      ...environment(f),
      UPS_WAREHOUSES_JSON: JSON.stringify(value),
    });
  });
for (const change of [
  { warehouseId: "foreign" },
  { warehouseId: " " },
  { shipperNumber: 123456 },
  { shipperNumber: "bad" },
  { shipper: null },
  { services: [] },
  { services: [{ service: "ground", code: 3 }] },
  { services: [{ service: "ground", code: "03", extra: "must-not-escape" }] },
  { clientIdEnv: "HOME" },
  { clientSecretEnv: "UPS_ABSENT" },
  { clientSecret: "must-not-escape-secret" },
  { orgId: "foreign" },
  { sandbox: false },
])
  test(`UPS warehouse startup refuses malformed ${JSON.stringify(change)} atomically`, (t) => {
    const f = fixture(t),
      entries = origins(f);
    invalid(f, {
      ...environment(f),
      UPS_WAREHOUSES_JSON: JSON.stringify([
        entries[0],
        { ...entries[1], ...change },
      ]),
    });
  });
test("UPS warehouse startup refuses duplicate IDs, mixed legacy account fields, malformed JSON and credentials", (t) => {
  const f = fixture(t),
    good = environment(f),
    entries = origins(f);
  for (const env of [
    { ...good, UPS_WAREHOUSES_JSON: JSON.stringify([entries[0], entries[0]]) },
    { ...good, UPS_WAREHOUSES_JSON: "{must-not-escape" },
    { ...good, UPS_WAREHOUSES_JSON: JSON.stringify(entries, null, 2) },
    { ...good, UPS_WAREHOUSES_JSON: "x".repeat(16385) },
    { ...good, UPS_ORIGIN_1_SECRET: "must-not-escape\n" },
    ...["UPS_SHIPPER_NUMBER", "UPS_SHIPPER_JSON", "UPS_SERVICES_JSON"].map(
      (name) => ({ ...good, [name]: "" }),
    ),
  ])
    invalid(f, env);
  for (const change of [
    { country: "GB" },
    { phone: 123 },
    { line1: "must-not-escape\n" },
    { extra: "private" },
  ])
    invalid(f, {
      ...good,
      UPS_WAREHOUSES_JSON: JSON.stringify([
        entries[0],
        { ...entries[1], shipper: { ...entries[1]!.shipper, ...change } },
      ]),
    });
});
for (const region of ["CA", "US"] as const)
  test(`UPS ${region} warehouse registrations require native scope, freeze startup values and hide other sites`, (t) => {
    const f = fixture(t, {}, region),
      env = environment(f),
      before = rows(f);
    const runtime = configuredCarriers(f.app, env, never)!;
    assert.equal(runtime.enabled(f.actor, "ups"), false);
    assert.equal(runtime.enabled(f.actor, "ups", f.w1), true);
    assert.equal(runtime.enabled(f.actor, "ups", f.w2), true);
    assert.deepEqual(runtime.configurations(f.actor), []);
    const first = runtime.configurations(f.actor, f.w1),
      second = runtime.configurations(f.actor, f.w2);
    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    assert.match(first[0]!.accountHint, /B2C3/);
    assert.match(second[0]!.accountHint, /E5F6/);
    assert.notEqual(first[0]!.hash, second[0]!.hash);
    env.UPS_WAREHOUSES_JSON = "[]";
    env.UPS_ORIGIN_0_SECRET = "changed";
    assert.deepEqual(runtime.configurations(f.actor, f.w1), first);
    (first[0] as { accountHint: string }).accountHint = "Changed";
    assert.match(runtime.configurations(f.actor, f.w1)[0]!.accountHint, /B2C3/);
    assert.deepEqual(rows(f), before);
    const worker = warrantyUser(f, "warehouse", f.buyer, [f.w1]);
    assert.deepEqual(
      runtime.configurations(worker, f.w1),
      runtime.configurations(f.actor, f.w1),
    );
    assert.throws(() => runtime.configurations(worker, f.w2), {
      code: "FORBIDDEN",
    });
    assert.throws(() => runtime.enabled(worker, "ups", f.w2), {
      code: "FORBIDDEN",
    });
    warrantyGrants(f, worker, { sites: [f.w2] });
    assert.throws(() => runtime.configurations(worker, f.w1), {
      code: "FORBIDDEN",
    });
  });
test("carrier bindings refuse duplicate native sites and mixed global/site registrations", (t) => {
  const f = configurationFixture(t),
    adapter = new UpsSandbox(f.ups, never);
  for (const bindings of [
    [
      { orgId: f.actor.orgId, warehouseId: f.w1, adapter },
      { orgId: f.actor.orgId, warehouseId: f.w1, adapter },
    ],
    [
      { orgId: f.actor.orgId, adapter },
      { orgId: f.actor.orgId, warehouseId: f.w1, adapter },
    ],
    [{ orgId: f.actor.orgId, warehouseId: "foreign", adapter }],
  ])
    assert.throws(() => new CarrierRuntime(f.app, bindings));
  const runtime = new CarrierRuntime(f.app, [
    { orgId: f.actor.orgId, adapter },
  ]);
  assert.equal(runtime.enabled(f.actor, "ups", f.w2), true);
  assert.deepEqual(runtime.configurations(f.actor), [adapter.configuration]);
});

function packed(f: F, warehouseId: string, index: number): CarrierPrepare {
  const cart = f.app.orders.saveCart(f.actor, `ups-cart-${index}`, {
    accountId: f.buyer,
    warehouseId,
    revision: 0,
    lines: [{ productId: f.product, quantity: 1 }],
  });
  const quote = f.app.orders.quote(f.actor, `ups-quote-${index}`, {
    cartId: cart.id,
    revision: cart.revision,
  });
  const orderId = f.app.orders.accept(f.actor, `ups-order-${index}`, {
    quoteId: quote.id,
    allowBackorder: false,
  }).id;
  const picks = f.app.fulfillment.picks(f.actor, orderId);
  for (const p of picks)
    f.app.fulfillment.pick(f.actor, `ups-pick-${p.id}`, {
      orderId,
      allocationId: p.id,
      serial: p.serial,
    });
  const address = `Synthetic reviewed destination ${index}`;
  const shipmentId = f.app.fulfillment.pack(f.actor, `ups-pack-${index}`, {
    orderId,
    revision: f.app.orders.order(f.actor, orderId).revision,
    mode: "carrier",
    address,
    lines: picks.map((p) => ({ allocationId: p.id, quantity: p.quantity })),
  }).id;
  const origin = { ...origins(f)[index]!.shipper, country: "CA" as const };
  return {
    shipmentId,
    previousId: null,
    provider: "ups",
    service: `Synthetic ground ${index}`,
    origin,
    destination: {
      ...origin,
      name: "Synthetic receiver",
      line1: "3 Test Street",
    },
    parcel: { weightGrams: 1000, lengthMm: 300, widthMm: 200, heightMm: 100 },
    reviewedDestination: address,
    acknowledgment: "Synthetic physical origin and account review",
  };
}
function twoSites(t: Parameters<typeof fixture>[0]) {
  const f = fixture(t);
  const unit = f.app.inventory.trace(f.actor, "S3").unit;
  const transfer = f.app.inventory.dispatchTransfer(f.actor, "ups-transfer", {
    unitId: unit.id,
    quantity: 1,
    revision: unit.revision,
    destinationId: f.w2,
    reason: "Synthetic second origin",
  });
  f.app.inventory.receiveTransfer(f.actor, "ups-arrival", {
    transferId: transfer.id,
    lineId: transfer.lineId,
    quantity: 1,
    serial: "S3",
    receiptRef: "UPS-ARRIVAL",
    bin: "B",
    condition: "usable",
    reason: "Synthetic receipt",
  });
  chooseProviders(f, f.actor, "ups-choice", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["ups"],
    version: 1,
    acknowledgment: "Synthetic named provider choice",
  });
  return { f, inputs: [packed(f, f.w1, 0), packed(f, f.w2, 1)] };
}
const gif = Buffer.from(
  "47494638396101000100800000000000ffffff2c00000000010001000002024401003b",
  "hex",
);
function simulator(loseSecond = false) {
  const saved = new Map<
    string,
    { context: string; reference: string; tracking: string }
  >();
  const writes: { account: string; body: any }[] = [],
    recoveries: string[] = [],
    tokens: string[] = [];
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
    });
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input)),
      headers = new Headers(init!.headers);
    assert.equal(url.origin, "https://wwwcie.ups.com");
    if (url.pathname === "/security/v1/oauth/token") {
      const account = headers.get("x-merchant-id")!;
      tokens.push(account);
      const i = account === "A1B2C3" ? 0 : 1;
      assert.equal(
        headers.get("authorization"),
        `Basic ${Buffer.from(`synthetic-client-${i}:must-not-escape-secret-${i}`).toString("base64")}`,
      );
      return json({
        token_type: "Bearer",
        access_token: `synthetic-${account}`,
        expires_in: "14399",
      });
    }
    const account = headers
      .get("authorization")!
      .replace("Bearer synthetic-", "");
    if (url.pathname === "/api/shipments/v2409/ship") {
      const body = JSON.parse(String(init!.body)).ShipmentRequest,
        shipment = body.Shipment;
      assert.equal(shipment.Shipper.ShipperNumber, account);
      assert.equal(
        shipment.PaymentInformation.ShipmentCharge.BillShipper.AccountNumber,
        account,
      );
      const proof = {
        context: body.Request.TransactionReference.CustomerContext,
        reference: (
          shipment.ReferenceNumber ?? shipment.Package.ReferenceNumber
        ).Value,
        tracking:
          account === "A1B2C3" ? "1Z1234567890123456" : "1Z6543210987654321",
      };
      saved.set(account, proof);
      writes.push({ account, body });
      if (loseSecond && account === "D4E5F6")
        throw Error("Synthetic committed response lost");
      return json({
        ShipmentResponse: {
          Response: {
            ResponseStatus: { Code: "1" },
            TransactionReference: { CustomerContext: proof.context },
          },
          ShipmentResults: {
            ShipmentIdentificationNumber: proof.tracking,
            PackageResults: [
              {
                TrackingNumber: proof.tracking,
                ShippingLabel: {
                  ImageFormat: { Code: "GIF" },
                  GraphicImage: gif.toString("base64"),
                },
              },
            ],
          },
        },
      });
    }
    const proof = saved.get(account)!;
    if (url.pathname.startsWith("/api/track/v1/reference/")) {
      assert.equal(url.pathname.split("/").at(-1), proof.reference);
      return json({
        trackResponse: {
          shipment: [
            {
              package: [
                {
                  trackingNumber: proof.tracking,
                  packageCount: 1,
                  referenceNumber: [
                    { number: proof.reference, type: "SHIPMENT" },
                  ],
                },
              ],
            },
          ],
        },
      });
    }
    assert.equal(url.pathname, "/api/labels/v1903/recovery");
    const body = JSON.parse(String(init!.body)).LabelRecoveryRequest;
    assert.equal(body.ReferenceValues.ShipperNumber, account);
    assert.equal(body.ReferenceValues.ReferenceNumber.Value, proof.reference);
    assert.equal(
      body.Request.TransactionReference.CustomerContext,
      proof.context,
    );
    recoveries.push(account);
    return json({
      LabelRecoveryResponse: {
        Response: {
          ResponseStatus: { Code: "1" },
          TransactionReference: { CustomerContext: proof.context },
        },
        LabelResults: [
          {
            TrackingNumber: proof.tracking,
            LabelImage: {
              LabelImageFormat: { Code: "GIF" },
              GraphicImage: gif.toString("base64"),
            },
          },
        ],
      },
    });
  };
  return { transport, writes, recoveries, tokens };
}
const native = (f: F) => ({
  stock: f.app.inventory.stock(f.actor),
  orders: f.app.orders.list(f.actor),
  shipments: f.app.fulfillment.shipments(f.actor),
  invoices: f.app.billing.invoices(f.actor),
});
test("two native UPS warehouse bookings use their own accounts and exact HTTP reviews before independent handovers", async (t) => {
  const { f, inputs } = twoSites(t),
    env = environment(f),
    sim = simulator(),
    before = native(f);
  const runtime = configuredCarriers(f.app, env, sim.transport)!;
  const http = await createHttp(f.app, {
    origin: "http://localhost:3100",
    staticRoot: "/nonexistent-ups-test",
    carriers: runtime,
  });
  t.after(() => http.close());
  const login = f.app.identity.login(
      "admin@example.test",
      "long-test-only-password",
    ),
    headers = { cookie: `distributor_session=${login.token}` };
  for (const [i, input] of inputs.entries()) {
    const view = await http.inject({
      method: "GET",
      url: `/api/shipments/${input.shipmentId}/carrier`,
      headers,
    });
    assert.equal(view.statusCode, 200);
    assert.equal(view.json().warehouseId, [f.w1, f.w2][i]);
    assert.equal(view.json().configurations.length, 1);
    const profile = view.json().configurations[0];
    assert.match(profile.accountHint, i ? /E5F6/ : /B2C3/);
    assert.deepEqual(
      profile.services.map((s: any) => s.service),
      [input.service],
    );
    assert.throws(
      () =>
        runtime.prepare(f.actor, `wrong-${i}`, {
          ...input,
          configurationHash: runtime.configurations(
            f.actor,
            [f.w2, f.w1][i],
          )[0]!.hash,
        }),
      { code: "CARRIER_CONFIG_CHANGED" },
    );
    const receipt = runtime.prepare(f.actor, `ups-prepare-${i}`, {
      ...input,
      configurationHash: profile.hash,
    });
    assert.deepEqual(
      runtime.prepare(f.actor, `ups-prepare-${i}`, {
        ...input,
        configurationHash: profile.hash,
      }),
      receipt,
    );
    await runtime.execute(f.actor, receipt.id);
    assert.deepEqual(f.app.carriers.label(f.actor, receipt.id).bytes, gif);
    assert.equal(
      sim.writes[i]!.body.Shipment.ShipFrom.Address.City,
      input.origin.city,
    );
    assert.deepEqual(native(f), before);
  }
  assert.deepEqual(sim.tokens, ["A1B2C3", "D4E5F6"]);
  assert.equal(sim.writes.length, 2);
  for (const [i, input] of inputs.entries()) {
    const booking = f.app.carriers.review(f.actor, input.shipmentId).booking!;
    f.app.fulfillment.commit(f.actor, `ups-handover-${i}`, {
      shipmentId: input.shipmentId,
      carrier: "ups",
      tracking: booking.tracking!,
      handoverEvidence: "Synthetic physical handover",
    });
  }
  assert.equal(f.app.billing.invoices(f.actor).length, 2);
});
test("lost second-origin UPS reply recovers only with the original native warehouse/account after actual restart", async (t) => {
  const { f, inputs } = twoSites(t),
    env = environment(f),
    sim = simulator(true),
    before = native(f);
  const runtime = configuredCarriers(f.app, env, sim.transport)!;
  const receipt = runtime.prepare(f.actor, "ups-second", {
    ...inputs[1]!,
    configurationHash: runtime.configurations(f.actor, f.w2)[0]!.hash,
  });
  await assert.rejects(() => runtime.execute(f.actor, receipt.id));
  assert.equal(sim.writes.length, 1);
  assert.equal(
    f.app.carriers.review(f.actor, inputs[1]!.shipmentId).booking!.state,
    "unknown",
  );
  f.app.close();
  f.app = new Application(f.path, "CA");
  const missing = {
    ...env,
    UPS_WAREHOUSES_JSON: JSON.stringify([origins(f)[0]]),
  };
  await assert.rejects(
    async () =>
      configuredCarriers(f.app, missing, never)!.reconcile(f.actor, receipt.id),
    { code: "CARRIER_DISABLED" },
  );
  const entries = origins(f);
  entries[1]!.shipperNumber = "G7H8I9";
  await assert.rejects(
    async () =>
      configuredCarriers(
        f.app,
        { ...env, UPS_WAREHOUSES_JSON: JSON.stringify(entries) },
        never,
      )!.reconcile(f.actor, receipt.id),
    { code: "CARRIER_CONFIG_CHANGED" },
  );
  const reordered = {
    ...env,
    UPS_WAREHOUSES_JSON: JSON.stringify(origins(f).reverse()),
  };
  await configuredCarriers(f.app, reordered, sim.transport)!.reconcile(
    f.actor,
    receipt.id,
  );
  assert.equal(sim.writes.length, 1);
  assert.deepEqual(sim.recoveries, ["D4E5F6"]);
  assert.equal(
    f.app.carriers.review(f.actor, inputs[1]!.shipmentId).booking!.state,
    "booked",
  );
  assert.deepEqual(native(f), before);
});
test("replacement carrier review and dispatch select its native warehouse binding and refuse a missing site", async (t) => {
  const f = replacementCarrierFixture(t),
    env = environment(f),
    sim = simulator();
  const runtime = configuredCarriers(f.app, env, sim.transport)!;
  const http = await createHttp(f.app, {
    origin: "http://localhost:3100",
    staticRoot: "/nonexistent-ups-test",
    carriers: runtime,
  });
  t.after(() => http.close());
  const login = f.app.identity.login(
      "admin@example.test",
      "long-test-only-password",
    ),
    headers = { cookie: `distributor_session=${login.token}` };
  const view = await http.inject({
    method: "GET",
    url: `/api/warranty/replacements/${f.replacement.id}/carrier`,
    headers,
  });
  assert.equal(view.statusCode, 200);
  assert.equal(view.json().configurations.length, 1);
  assert.match(view.json().configurations[0].accountHint, /B2C3/);
  const input = {
    ...f.input,
    service: "Synthetic ground 0",
    configurationHash: view.json().configurations[0].hash,
  };
  const missing = configuredCarriers(
    f.app,
    { ...env, UPS_WAREHOUSES_JSON: JSON.stringify([origins(f)[1]]) },
    never,
  )!;
  assert.throws(() => missing.prepare(f.actor, "missing-replacement", input), {
    code: "CARRIER_DISABLED",
  });
  const receipt = runtime.prepare(f.actor, "native-replacement", input),
    before = native(f);
  await runtime.execute(f.actor, receipt.id);
  assert.equal(sim.writes[0]!.account, "A1B2C3");
  assert.deepEqual(native(f), before);
  const booking = f.app.carriers.reviewReplacement(
    f.actor,
    f.replacement.id,
  ).booking!;
  f.app.warranty.dispatchReplacement(f.actor, "ups-replacement-dispatch", {
    ...replacementDispatch(f),
    tracking: booking.tracking!,
  });
  assert.deepEqual(f.app.billing.invoices(f.actor), before.invoices);
  assert.equal(f.app.inventory.trace(f.actor, "S2").unit.state, "sold");
});

test("carrier bindings reject malformed later entries with a configuration error", (t) => {
  const f = configurationFixture(t),
    adapter = new UpsSandbox(f.ups, never);
  for (const malformed of [null, undefined, {}, { orgId: f.actor.orgId }]) {
    assert.throws(
      () =>
        new CarrierRuntime(f.app, [
          { orgId: f.actor.orgId, warehouseId: f.w1, adapter },
          malformed,
        ] as unknown as ConstructorParameters<typeof CarrierRuntime>[1]),
      { code: "CARRIER_CONFIG" },
    );
  }
});
