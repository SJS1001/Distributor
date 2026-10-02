import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { fixture, chooseProviders } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { configuredCarriers } from "../src/server/carrier-config.ts";
import { DomainError } from "../src/server/core.ts";
import { allRows } from "./canada-post-fixture.ts";

type F = ReturnType<typeof fixture>;
function origins(f: F) {
  return [f.w1, f.w2].map((warehouseId, i) => ({
    warehouseId,
    customerNumber: i ? "7654321" : "1234567",
    contractId: i ? "654321" : "123456",
    company: i ? "Synthetic Ottawa origin" : "Synthetic Toronto origin",
    shippingPoint: i
      ? { kind: "deposit", siteId: "B2C3" }
      : { kind: "pickup", postalCode: "M5V1A1" },
    services: [{ service: "Synthetic domestic", code: "DOM.RP" }],
    clientIdEnv: `CANADA_POST_ORIGIN_${i}_ID`,
    clientSecretEnv: `CANADA_POST_ORIGIN_${i}_SECRET`,
  }));
}
function environment(f: F): NodeJS.ProcessEnv {
  return {
    CARRIERS_ENABLED: "true",
    CARRIER_ORG_ID: f.actor.orgId,
    CANADA_POST_TEST_ENABLED: "true",
    CANADA_POST_TEST_CREDENTIALS_ACK: "test-application-only",
    CANADA_POST_WAREHOUSES_JSON: JSON.stringify(origins(f)),
    CANADA_POST_ORIGIN_0_ID: "synthetic-client-0",
    CANADA_POST_ORIGIN_0_SECRET: "must-not-escape-secret-0",
    CANADA_POST_ORIGIN_1_ID: "synthetic-client-1",
    CANADA_POST_ORIGIN_1_SECRET: "must-not-escape-secret-1",
  };
}
const never: typeof fetch = async () => assert.fail("Unexpected provider I/O");
function invalid(f: F, env: NodeJS.ProcessEnv) {
  const before = allRows(f as Parameters<typeof allRows>[0]);
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
  assert.deepEqual(allRows(f as Parameters<typeof allRows>[0]), before);
}

for (const [name, value] of Object.entries({
  empty: [],
  null: null,
  object: {},
  missing: [null],
  tooMany: Array(21).fill({}),
}))
  test(`Canada Post multi-origin startup refuses ${name} list atomically`, (t) => {
    const f = fixture(t);
    invalid(f, {
      ...environment(f),
      CANADA_POST_WAREHOUSES_JSON: JSON.stringify(value),
    });
  });
for (const change of [
  { warehouseId: "foreign" },
  { warehouseId: " " },
  { company: "must-not-escape\n" },
  { customerNumber: "secret" },
  { contractId: null },
  { shippingPoint: { kind: "pickup", postalCode: "K1A 0B1" } },
  { shippingPoint: { kind: "deposit", siteId: "bad" } },
  { shippingPoint: { kind: "deposit", siteId: "B2C3", endpoint: "private" } },
  { services: [{ service: "Synthetic domestic", code: "US" }] },
  { services: [{ service: "Synthetic domestic", code: "DOM.RP", extra: 1 }] },
  { services: [] },
  { clientIdEnv: "HOME" },
  { clientSecretEnv: "CANADA_POST_ABSENT" },
  { clientSecretEnv: "must-not-escape-secret" },
  { clientSecret: "must-not-escape-secret" },
  { orgId: "foreign" },
  { testApplication: false },
])
  test(`Canada Post multi-origin startup refuses invalid ${JSON.stringify(change)} without partial registration`, (t) => {
    const f = fixture(t),
      entries = origins(f);
    invalid(f, {
      ...environment(f),
      CANADA_POST_WAREHOUSES_JSON: JSON.stringify([
        entries[0],
        { ...entries[1], ...change },
      ]),
    });
  });

test("Canada Post multi-origin startup rejects duplicate, malformed/oversized JSON, wrong credential values and mixed legacy origin settings", (t) => {
  const f = fixture(t),
    env = environment(f),
    entries = origins(f);
  for (const change of [
    { CANADA_POST_WAREHOUSES_JSON: JSON.stringify([entries[0], entries[0]]) },
    { CANADA_POST_WAREHOUSES_JSON: '{"private":"must-not-escape' },
    { CANADA_POST_WAREHOUSES_JSON: "x".repeat(16385) },
    { CANADA_POST_WAREHOUSES_JSON: "" },
    { CANADA_POST_ORIGIN_1_ID: undefined },
    { CANADA_POST_ORIGIN_1_SECRET: "must-not-escape\n" },
    ...[
      "WAREHOUSE_ID",
      "CUSTOMER_NUMBER",
      "CONTRACT_ID",
      "COMPANY",
      "SHIPPING_POINT_JSON",
      "SERVICES_JSON",
    ].map((suffix) => ({ [`CANADA_POST_${suffix}`]: "" })),
  ])
    invalid(f, { ...env, ...change });
  // No subordinate parsing while either outer or Canada Post selection is off.
  assert.equal(
    configuredCarriers(
      f.app,
      { CANADA_POST_WAREHOUSES_JSON: "invalid" },
      never,
    ),
    undefined,
  );
});

for (const region of ["CA", "US"] as const)
  test(`Canada Post multi-origin startup scopes ${region} regional storage, ignores env mutation and accepts twenty distinct warehouses without writes`, (t) => {
    const f = fixture(t, {}, region),
      env = environment(f),
      entries = origins(f);
    for (let i = 2; i < 20; i++)
      entries.push({
        ...entries[0]!,
        warehouseId: f.app.inventory.createWarehouse(f.actor, `origin-${i}`, {
          name: `Synthetic origin ${i}`,
        }).id,
      });
    env.CANADA_POST_WAREHOUSES_JSON = JSON.stringify(entries);
    const before = allRows(f as Parameters<typeof allRows>[0]);
    const runtime = configuredCarriers(f.app, env, never)!;
    for (const entry of entries)
      assert.equal(runtime.canadaPostEnabled(f.actor, entry.warehouseId), true);
    env.CANADA_POST_WAREHOUSES_JSON = "[]";
    env.CANADA_POST_ORIGIN_0_SECRET = undefined;
    assert.equal(runtime.canadaPostEnabled(f.actor, f.w1), true);
    assert.equal(runtime.enabled(f.actor, "canada-post"), false);
    assert.deepEqual(allRows(f as Parameters<typeof allRows>[0]), before);
    assert.throws(
      () => runtime.canadaPostEnabled({ ...f.actor, orgId: "foreign" }, f.w1),
      { code: "FORBIDDEN" },
    );
    f.app.database
      .owned("iam")
      .run(
        "UPDATE iam_users SET role='warehouse',sites=? WHERE id=?",
        JSON.stringify([f.w1]),
        f.actor.id,
      );
    assert.equal(runtime.canadaPostEnabled(f.actor, f.w1), true);
    assert.throws(() => runtime.canadaPostEnabled(f.actor, f.w2), {
      code: "FORBIDDEN",
    });
  });

function packed(f: F, warehouseId: string, index: number) {
  const key = `origin-order-${index}`,
    cart = f.app.orders.saveCart(f.actor, `${key}-cart`, {
      accountId: f.buyer,
      warehouseId,
      revision: 0,
      lines: [{ productId: f.product, quantity: 1 }],
    }),
    quote = f.app.orders.quote(f.actor, `${key}-quote`, {
      cartId: cart.id,
      revision: cart.revision,
    }),
    orderId = f.app.orders.accept(f.actor, key, {
      quoteId: quote.id,
      allowBackorder: false,
    }).id,
    picks = f.app.fulfillment.picks(f.actor, orderId);
  for (const pick of picks)
    f.app.fulfillment.pick(f.actor, `pick-${pick.id}`, {
      orderId,
      allocationId: pick.id,
      serial: pick.serial,
    });
  const address = "Synthetic receiver, Ottawa ON K1A 0B1, CA";
  const shipmentId = f.app.fulfillment.pack(f.actor, `origin-pack-${index}`, {
    orderId,
    revision: f.app.orders.order(f.actor, orderId).revision,
    mode: "carrier",
    address,
    lines: picks.map((p) => ({ allocationId: p.id, quantity: p.quantity })),
  }).id;
  const booking = f.app.carriers.prepare(f.actor, `origin-prepare-${index}`, {
    shipmentId,
    previousId: null,
    provider: "canada-post",
    service: "Synthetic domestic",
    origin: {
      name: `Synthetic sender ${index}`,
      line1: index ? "3 Test Street" : "1 Test Street",
      line2: "",
      city: index ? "Ottawa" : "Toronto",
      province: "ON",
      postalCode: index ? "K1A 0B1" : "M5V 1A1",
      country: "CA",
      phone: "4165550100",
    },
    destination: {
      name: "Synthetic receiver",
      line1: "2 Test Street",
      line2: "",
      city: "Ottawa",
      province: "ON",
      postalCode: "K1A 0B1",
      country: "CA",
      phone: "4165550101",
    },
    parcel: { weightGrams: 1000, lengthMm: 100, widthMm: 100, heightMm: 100 },
    reviewedDestination: address,
    acknowledgment: "Synthetic origin and destination review",
  });
  return {
    shipmentId,
    entry: { bookingId: booking.id, reviewHash: booking.reviewHash },
  };
}
const doc = await PDFDocument.create();
doc.addPage([288, 432]).drawText("Synthetic multi-origin carrier document");
const pdf = Buffer.from(await doc.save());
const shipping =
  "https://api.canadapost-postescanada.ca/prod/devportal-portaildesdeveloppeurs/shipping/v1";
function simulator(f: F, lost: boolean) {
  const entries = origins(f),
    states = entries.map((entry, i) => ({
      entry,
      i,
      body: null as Record<string, any> | null,
      manifest: null as Record<string, any> | null,
      creates: 0,
      transmits: 0,
    }));
  let loseCreate = lost,
    loseManifest = lost;
  const json = (value: unknown) =>
    new Response(JSON.stringify(value), {
      headers: { "content-type": "application/json" },
    });
  const transport: typeof fetch = async (input, init) => {
    assert.equal(init!.redirect, "error");
    const url = new URL(String(input)),
      headers = init!.headers as Record<string, string>;
    assert.equal(url.origin, "https://api.canadapost-postescanada.ca");
    if (url.pathname.endsWith("/oauth2/token")) {
      const s = states.find(
        (s) => headers["X-IBM-Client-Id"] === `synthetic-client-${s.i}`,
      )!;
      assert.ok(s);
      assert.equal(
        headers["X-IBM-Client-Secret"],
        `must-not-escape-secret-${s.i}`,
      );
      return json({
        token_type: "Bearer",
        access_token: `synthetic-token-${s.i}`,
        expires_in: 3600,
        scope: "merchant",
      });
    }
    const s = states.find(
      (s) => headers.authorization === `Bearer synthetic-token-${s.i}`,
    )!;
    assert.ok(s);
    const base = `${shipping}/${s.entry.customerNumber}/${s.entry.customerNumber}`,
      shipmentId = `origin-shipment-${s.i}`,
      po = `N12345678${s.i}`,
      tracking = `123456789012345${s.i}`,
      href = `${base}/shipments/${shipmentId}`,
      label = `${shipping}/artifacts/${s.entry.customerNumber}/shipping/origin-${s.i}/0`;
    const shipmentInfo = () => ({
      customerRequestId: s.body!.customerRequestId,
      shipmentId,
      trackingPin: tracking,
      shipmentStatus: s.manifest ? "transmitted" : "created",
      ...(s.manifest ? { poNumber: po } : {}),
      links: [
        { rel: "self", mediaType: "application/json", href },
        {
          rel: "details",
          mediaType: "application/json",
          href: href + "/details",
        },
        { rel: "label", mediaType: "application/pdf", index: 0, href: label },
      ],
    });
    const manifestHref = `${base}/manifests/${po}`;
    if (url.href === `${base}/shipments` && init!.method === "POST") {
      s.body = JSON.parse(init!.body as string);
      s.creates++;
      assert.equal(
        s.body!.deliverySpec.settlementInfo.paidByCustomer,
        s.entry.customerNumber,
      );
      assert.equal(
        s.body!.deliverySpec.settlementInfo.contractId,
        s.entry.contractId,
      );
      assert.equal(s.body!.deliverySpec.sender.company, s.entry.company);
      if (s.i === 0) assert.equal(s.body!.requestedShippingPoint, "M5V1A1");
      else assert.equal(s.body!.shippingPointId, "B2C3");
      if (s.i === 1 && loseCreate) {
        loseCreate = false;
        throw new Error("synthetic lost committed creation reply");
      }
      return json(shipmentInfo());
    }
    if (url.href === `${base}/manifests` && init!.method === "POST") {
      s.manifest = JSON.parse(init!.body as string);
      s.transmits++;
      assert.deepEqual(s.manifest!.groupIds, [s.body!.groupId]);
      if (s.i === 1 && loseManifest) {
        loseManifest = false;
        throw new Error("synthetic lost committed manifest reply");
      }
      return json([
        { rel: "manifest", mediaType: "application/json", href: manifestHref },
      ]);
    }
    assert.equal(init!.method, "GET");
    if (
      url.href === label ||
      url.href === `${shipping}/artifacts/${po}/shipping/manifest-${s.i}/0`
    )
      return new Response(pdf, {
        headers: { "content-type": "application/pdf" },
      });
    if (url.href === href) return json(shipmentInfo());
    if (url.href === href + "/details")
      return json({
        customerRequestId: s.body!.customerRequestId,
        trackingPin: tracking,
        shipmentStatus: s.manifest ? "transmitted" : "created",
        ...(s.i === 0
          ? { cpcPickupIndicator: true, finalShippingPoint: "M5V1A1" }
          : { shippingPointId: "B2C3" }),
        shipmentDetail: {
          groupId: s.body!.groupId,
          deliverySpec: s.body!.deliverySpec,
        },
      });
    if (url.pathname === new URL(`${base}/shipments`).pathname) {
      assert.ok(
        url.searchParams.has("request-id") ||
          url.searchParams.has("group-id") ||
          url.searchParams.has("manifest-id"),
      );
      if (url.searchParams.has("request-id"))
        assert.equal(
          url.searchParams.get("request-id"),
          s.body!.customerRequestId,
        );
      if (url.searchParams.has("group-id"))
        assert.equal(url.searchParams.get("group-id"), s.body!.groupId);
      if (url.searchParams.has("manifest-id"))
        assert.equal(url.searchParams.get("manifest-id"), po);
      return json([{ rel: "shipment", mediaType: "application/json", href }]);
    }
    if (url.href === manifestHref)
      return json({
        poNumber: po,
        links: [
          {
            rel: "details",
            mediaType: "application/json",
            href: manifestHref + "/details",
          },
          {
            rel: "artifact",
            mediaType: "application/pdf",
            href: `${shipping}/artifacts/${po}/shipping/manifest-${s.i}/0`,
          },
        ],
      });
    if (url.href === manifestHref + "/details")
      return json({
        poNumber: po,
        customerRef: s.manifest!.customerReference,
        mailedByCustomer: s.entry.customerNumber,
        "mailed-on-behalf-of": s.entry.customerNumber,
        paidByCustomer: s.entry.customerNumber,
        contractId: s.entry.contractId,
        methodOfPayment: "Account",
        manifestAddress: s.manifest!.manifestAddress,
        finalShippingPoint: s.i ? "K1A0B1" : "M5V1A1",
        shippingPointName: "Synthetic shipping point",
        shippingPointId: s.i ? "B2C3" : "A1B2",
        ...(s.i ? {} : { cpcPickupIndicator: true }),
        manifestDate: "2026-10-02",
        manifestTime: "10:00 Eastern",
        manifestPricingInfo: {
          totalDueCpc: 12,
          baseCost: 12,
          gst: 0,
          pst: 0,
          hst: 0,
          automationDiscount: 0,
          optionsAndSurcharges: 0,
        },
      });
    assert.fail(`Unexpected or cross-account transport: ${url.href}`);
  };
  return { states, transport };
}

for (const lost of [false, true])
  test(`two warehouse startup registrations preserve exact accounts through ${lost ? "lost replies, restart and recovery" : "creation, manifests and separate native handover"}`, async (t) => {
    const f = fixture(t);
    chooseProviders(f, f.actor, "origin-choice", {
      accountId: f.buyer,
      region: "CA",
      mode: "provider-exceptions",
      providers: ["canada-post"],
      version: 1,
      acknowledgment: "Synthetic customer choice",
    });
    const unit = f.app.inventory.trace(f.actor, "S3").unit,
      transfer = f.app.inventory.dispatchTransfer(f.actor, "origin-transfer", {
        unitId: unit.id,
        quantity: 1,
        revision: unit.revision,
        destinationId: f.w2,
        reason: "Synthetic origin transfer",
      });
    f.app.inventory.receiveTransfer(f.actor, "origin-arrival", {
      transferId: transfer.id,
      lineId: transfer.lineId,
      quantity: 1,
      serial: "S3",
      receiptRef: "ORIGIN-ARRIVAL",
      bin: "B-1",
      condition: "usable",
      reason: "Synthetic arrival",
    });
    const packedShipments = [packed(f, f.w1, 0), packed(f, f.w2, 1)],
      env = environment(f),
      sim = simulator(f, lost);
    let runtime = configuredCarriers(f.app, env, sim.transport)!;
    const before = {
      stock: f.app.inventory.stock(f.actor),
      invoices: f.app.billing.invoices(f.actor),
      orders: f.app.orders.list(f.actor),
    };
    assert.throws(
      () =>
        runtime.prepareCanadaPostGroup(f.actor, "mixed", {
          warehouseId: f.w1,
          entries: packedShipments.map((p) => p.entry),
        }),
      { code: "CARRIER_MISMATCH" },
    );
    const groups = packedShipments.map((p, i) =>
      runtime.prepareCanadaPostGroup(f.actor, `origin-group-${i}`, {
        warehouseId: i ? f.w2 : f.w1,
        entries: [p.entry],
      }),
    );
    assert.notEqual(
      f.app.carriers.reviewCanadaPostGroup(f.actor, groups[0]!.id)
        .configurationHash,
      f.app.carriers.reviewCanadaPostGroup(f.actor, groups[1]!.id)
        .configurationHash,
    );
    for (let i = 0; i < 2; i++) {
      if (lost && i === 1) {
        await assert.rejects(
          runtime.createCanadaPostMember(
            f.actor,
            groups[i]!.id,
            packedShipments[i]!.entry.bookingId,
          ),
        );
        f.app.close();
        f.app = new Application(f.path);
        const changed = origins(f);
        changed[1]!.contractId = "777777";
        const drift = configuredCarriers(
          f.app,
          { ...env, CANADA_POST_WAREHOUSES_JSON: JSON.stringify(changed) },
          never,
        )!;
        assert.throws(
          () =>
            drift.reconcileCanadaPostMember(
              f.actor,
              groups[i]!.id,
              packedShipments[i]!.entry.bookingId,
            ),
          { code: "CARRIER_MISMATCH" },
        );
        assert.throws(
          () =>
            configuredCarriers(
              f.app,
              {
                ...env,
                CANADA_POST_WAREHOUSES_JSON: JSON.stringify(
                  origins(f).slice(0, 1),
                ),
              },
              never,
            )!.reconcileCanadaPostMember(
              f.actor,
              groups[i]!.id,
              packedShipments[i]!.entry.bookingId,
            ),
          { code: "CARRIER_DISABLED" },
        );
        // Reordering the warehouse list preserves the original exact binding.
        runtime = configuredCarriers(
          f.app,
          {
            ...env,
            CANADA_POST_WAREHOUSES_JSON: JSON.stringify(
              origins(f).toReversed(),
            ),
          },
          sim.transport,
        )!;
        await assert.rejects(
          runtime.createCanadaPostMember(
            f.actor,
            groups[i]!.id,
            packedShipments[i]!.entry.bookingId,
          ),
        );
        await runtime.reconcileCanadaPostMember(
          f.actor,
          groups[i]!.id,
          packedShipments[i]!.entry.bookingId,
        );
      } else
        await runtime.createCanadaPostMember(
          f.actor,
          groups[i]!.id,
          packedShipments[i]!.entry.bookingId,
        );
      const review = runtime.reviewCanadaPostManifest(f.actor, groups[i]!.id);
      if (lost && i === 1) {
        await assert.rejects(
          runtime.transmitCanadaPostManifest(
            f.actor,
            groups[i]!.id,
            review.reviewHash,
          ),
        );
        f.app.close();
        f.app = new Application(f.path);
        runtime = configuredCarriers(f.app, env, sim.transport)!;
        await assert.rejects(
          runtime.transmitCanadaPostManifest(
            f.actor,
            groups[i]!.id,
            review.reviewHash,
          ),
        );
        await runtime.reconcileCanadaPostManifest(
          f.actor,
          groups[i]!.id,
          review.reviewHash,
        );
      } else
        await runtime.transmitCanadaPostManifest(
          f.actor,
          groups[i]!.id,
          review.reviewHash,
        );
    }
    assert.deepEqual(
      {
        stock: f.app.inventory.stock(f.actor),
        invoices: f.app.billing.invoices(f.actor),
        orders: f.app.orders.list(f.actor),
      },
      before,
    );
    assert.deepEqual(
      sim.states.map((s) => [s.creates, s.transmits]),
      [
        [1, 1],
        [1, 1],
      ],
    );
    for (let i = 0; i < 2; i++) {
      const p = packedShipments[i]!;
      assert.deepEqual(
        f.app.carriers.label(f.actor, p.entry.bookingId).bytes,
        pdf,
      );
      assert.deepEqual(
        f.app.carriers.canadaPostManifestDocument(f.actor, groups[i]!.id).bytes,
        pdf,
      );
      f.app.fulfillment.commit(f.actor, `origin-handover-${i}`, {
        shipmentId: p.shipmentId,
        carrier: "canada-post",
        tracking: `123456789012345${i}`,
        handoverEvidence: "Synthetic exact separate handover",
      });
      assert.equal(
        f.app.fulfillment.shipment(f.actor, p.shipmentId).state,
        "shipped",
      );
    }
    assert.equal(f.app.billing.invoices(f.actor).length, 2);
    assert.deepEqual(
      sim.states.map((s) => [s.creates, s.transmits]),
      [
        [1, 1],
        [1, 1],
      ],
    );
  });
