import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { fixture, accept, chooseProviders } from "./fixtures.ts";
import { canonical, digest, DomainError } from "../src/server/core.ts";
import {
  CanadaPostTestClient,
  type CanadaPostTestConfig,
  type CanadaPostManifestReview,
} from "../src/server/canada-post-test.ts";
import { CarrierRuntime } from "../src/server/carrier-runtime.ts";
import type {
  CarrierIntent,
  CarrierAdapter,
} from "../src/server/carrier-bookings.ts";
import type {
  CarrierAddress,
  CarrierPrepare,
} from "../src/shared/carrier-booking.ts";

// Original synthetic label. No vendor sample, account or transport is used.
const document = await PDFDocument.create();
document.addPage([288, 432]).drawText("Synthetic Canada Post protocol fixture");
const pdf = Buffer.from(await document.save());
const gateway =
  "https://api.canadapost-postescanada.ca/prod/devportal-portaildesdeveloppeurs";
const shipping = gateway + "/shipping/v1";
const account = "/1234567/1234567/shipments";
const group = "WAREHOUSE_20261001_A";
const tracking = "1234567890123456";
const id = "synthetic-shipment";
const address: CarrierAddress = {
  name: "Synthetic warehouse",
  line1: "1 Test Street",
  line2: "",
  city: "Toronto",
  province: "ON",
  postalCode: "M5V 1A1",
  country: "CA",
  phone: "+1 (416) 555-0100",
};
function setup(t: Parameters<typeof fixture>[0], pickup = true) {
  const f = fixture(t, {}, "CA"),
    orderId = accept(f).id;
  chooseProviders(f, f.actor, "cp-choice", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["canada-post"],
    version: 1,
    acknowledgment: "Synthetic Canada Post processing choice",
  });
  const picks = f.app.fulfillment.picks(f.actor, orderId);
  for (const pick of picks)
    f.app.fulfillment.pick(f.actor, `cp-pick-${pick.id}`, {
      orderId,
      allocationId: pick.id,
      serial: pick.serial,
    });
  const reviewedDestination = "Synthetic reviewed packed destination";
  const shipmentId = f.app.fulfillment.pack(f.actor, "cp-pack", {
    orderId,
    revision: f.app.orders.order(f.actor, orderId).revision,
    mode: "carrier",
    address: reviewedDestination,
    lines: picks.map((pick) => ({
      allocationId: pick.id,
      quantity: pick.quantity,
    })),
  }).id;
  const input: CarrierPrepare = {
    shipmentId,
    previousId: null,
    provider: "canada-post",
    service: "Reviewed regular parcel",
    origin: { ...address },
    destination: {
      ...address,
      name: "Synthetic receiver",
      line1: "2 Test Street",
    },
    parcel: { weightGrams: 1234, lengthMm: 101, widthMm: 202, heightMm: 303 },
    reviewedDestination,
    acknowledgment: "Synthetic review of actual origin and packed destination",
  };
  const prepared = f.app.carriers.prepare(f.actor, "cp-prepare", input);
  const intent = JSON.parse(
    f.app.database
      .owned("integration")
      .get<{ intent: string }>(
        "SELECT intent FROM integration_carrier_bookings WHERE id=?",
        prepared.id,
      )!.intent,
  ) as CarrierIntent;
  const config: CanadaPostTestConfig = {
    orgId: f.actor.orgId,
    warehouseId: f.w1,
    testApplication: true,
    clientId: "synthetic-cp-client",
    clientSecret: "synthetic-cp-secret",
    customerNumber: "1234567",
    contractId: "123456",
    company: "Synthetic distributor",
    shippingPoint: pickup
      ? { kind: "pickup", postalCode: "M5V1A1" }
      : { kind: "deposit", siteId: "A1B2" },
    services: [{ service: input.service, code: "DOM.RP" }],
  };
  return Object.assign(f, {
    orderId,
    shipmentId,
    input,
    prepared,
    intent,
    config,
  });
}
type F = ReturnType<typeof setup>;
type Json = Record<string, any>;
type Call = { url: URL; init: RequestInit; body: Json | string | undefined };
function native(f: F) {
  return {
    stock: f.app.inventory.stock(f.actor),
    order: f.app.orders.order(f.actor, f.orderId),
    invoices: f.app.billing.invoices(f.actor),
    shipment: f.app.fulfillment.shipment(f.actor, f.shipmentId),
    booking: f.app.carriers.review(f.actor, f.shipmentId),
  };
}
function revise(intent: CarrierIntent, change: Partial<CarrierIntent>) {
  const { bookingId, reviewHash: _old, ...review } = { ...intent, ...change };
  return { ...review, bookingId, reviewHash: digest(canonical(review)) };
}
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
function reference(f: F) {
  const { clientId: _id, clientSecret: _secret, ...binding } = f.config;
  return (
    "D" +
    digest(
      canonical({
        configurationHash: digest(canonical(binding)),
        bookingId: f.intent.bookingId,
        reviewHash: f.intent.reviewHash,
        groupId: group,
      }),
    )
      .slice(0, 31)
      .toUpperCase()
  );
}
function expectedBody(f: F): Json {
  const ref = reference(f);
  const addr = (a: CarrierAddress) => ({
    addressLine1: a.line1,
    ...(a.line2 ? { addressLine2: a.line2 } : {}),
    city: a.city,
    provState: a.province,
    countryCode: a.country,
    postalZipCode: a.postalCode.replace(/ /g, ""),
  });
  return {
    customerRequestId: ref,
    groupId: group,
    ...(f.config.shippingPoint.kind === "pickup"
      ? { cpcPickupIndicator: true, requestedShippingPoint: "M5V1A1" }
      : { shippingPointId: "A1B2" }),
    deliverySpec: {
      serviceCode: "DOM.RP",
      sender: {
        name: f.intent.origin.name,
        company: f.config.company,
        contactPhone: f.intent.origin.phone,
        addressDetails: addr(f.intent.origin),
      },
      destination: {
        name: f.intent.destination.name,
        clientVoiceNumber: f.intent.destination.phone,
        addressDetails: addr(f.intent.destination),
      },
      parcelCharacteristics: {
        weight: 1.234,
        dimensions: { length: 10.1, width: 20.2, height: 30.3 },
      },
      printPreferences: { outputFormat: "4x6", encoding: "PDF" },
      preferences: {
        showPackingInstructions: false,
        showPostageRate: false,
        showInsuredValue: false,
      },
      references: { customerRef1: ref },
      settlementInfo: {
        paidByCustomer: "1234567",
        contractId: "123456",
        intendedMethodOfPayment: "Account",
      },
    },
  };
}
function simulator(
  f: F,
  options: {
    tokenHook?: () => void;
    raw?: (call: Call) => Response | undefined;
    loseCreate?: boolean;
    create?: (reply: Json) => void;
    details?: (reply: Json) => void;
    lookup?: unknown;
    status?: "created" | "transmitted";
  } = {},
) {
  const calls: Call[] = [],
    body = expectedBody(f),
    ref = reference(f),
    status = options.status ?? "created",
    pickup = f.config.shippingPoint.kind === "pickup";
  const info = () => ({
    customerRequestId: ref,
    shipmentId: id,
    shipmentStatus: status,
    trackingPin: tracking,
    links: [
      {
        rel: "self",
        mediaType: "application/json",
        href: shipping + account + "/" + id,
      },
      {
        rel: "details",
        mediaType: "application/json",
        href: shipping + account + "/" + id + "/details",
      },
      {
        rel: "label",
        mediaType: "application/pdf",
        index: 0,
        href: shipping + "/artifacts/1234567/shipping/synthetic-artifact/0",
      },
    ],
  });
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.canadapost-postescanada.ca");
    assert.equal(init!.redirect, "error");
    assert.ok(init!.signal instanceof AbortSignal);
    const call = {
      url,
      init: init!,
      body: init?.body
        ? (init.body as string).startsWith("{")
          ? JSON.parse(init.body as string)
          : (init.body as string)
        : undefined,
    };
    calls.push(call);
    const raw = options.raw?.(call);
    if (raw) return raw;
    if (url.pathname.endsWith("/oauth2/token")) {
      assert.equal(init!.method, "POST");
      options.tokenHook?.();
      return json({
        token_type: "Bearer",
        access_token: "synthetic-token",
        expires_in: 3600,
        scope: "merchant",
      });
    }
    assert.equal(
      (init!.headers as Json).authorization,
      "Bearer synthetic-token",
    );
    if (url.pathname === new URL(shipping + account).pathname) {
      if (init!.method === "POST") {
        if (options.loseCreate)
          throw new Error("synthetic-cp-secret lost reply");
        const reply = info();
        options.create?.(reply);
        return json(reply);
      }
      assert.equal(init!.method, "GET");
      assert.equal(url.searchParams.get("request-id"), ref);
      assert.equal(url.searchParams.get("limit"), "2");
      return json(
        options.lookup ?? [
          {
            rel: "shipment",
            mediaType: "application/json",
            href: shipping + account + "/" + id,
          },
        ],
      );
    }
    assert.equal(init!.method, "GET");
    assert.equal(init!.body, undefined);
    if (url.pathname === new URL(shipping + account + "/" + id).pathname)
      return json(info());
    if (url.pathname.endsWith("/details")) {
      const reply: Json = {
        customerRequestId: ref,
        trackingPin: tracking,
        shipmentStatus: status,
        ...(pickup
          ? { cpcPickupIndicator: true, finalShippingPoint: "M5V1A1" }
          : { shippingPointId: "A1B2" }),
        shipmentDetail: {
          groupId: group,
          deliverySpec: structuredClone(body.deliverySpec),
        },
      };
      options.details?.(reply);
      return json(reply);
    }
    assert.equal(
      url.href,
      shipping + "/artifacts/1234567/shipping/synthetic-artifact/0",
    );
    return new Response(pdf, {
      headers: { "content-type": "application/pdf" },
    });
  };
  return { calls, transport, body };
}
function writes(calls: Call[]) {
  return calls.filter(
    (c) =>
      c.init.method === "POST" && !c.url.pathname.endsWith("/oauth2/token"),
  );
}

for (const pickup of [true, false])
  test(`Canada Post ${pickup ? "pickup" : "deposit"} maps one reviewed domestic grouped parcel without native handover`, async (t) => {
    const f = setup(t, pickup),
      before = native(f),
      sim = simulator(f),
      client = new CanadaPostTestClient(f.config, sim.transport);
    let guards = 0;
    assert.equal(sim.calls.length, 0);
    const result = await client.create(f.intent, group, () => {
      guards++;
      assert.equal(sim.calls.length, 1);
    });
    assert.equal(guards, 1);
    assert.equal(sim.calls.length, 4);
    assert.deepEqual(writes(sim.calls)[0]!.body, sim.body);
    assert.deepEqual(sim.calls[0]!.init.headers, {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
      "X-IBM-Client-Id": "synthetic-cp-client",
      "X-IBM-Client-Secret": "synthetic-cp-secret",
    });
    assert.equal(
      sim.calls[0]!.body,
      "grant_type=client_credentials&scope=merchant",
    );
    assert.equal(result.bookingId, f.prepared.id);
    assert.equal(result.reviewHash, f.prepared.reviewHash);
    assert.equal(result.customerRequestId, reference(f));
    assert.equal(result.customerRequestId.length, 32);
    assert.equal(result.shipmentId, id);
    assert.equal(result.tracking, tracking);
    assert.equal(result.status, "created");
    assert.deepEqual(result.label.bytes, pdf);
    assert.deepEqual(native(f), before);
    assert.equal(
      f.app.carriers.review(f.actor, f.shipmentId).booking!.state,
      "pending",
    );
    assert.throws(
      () =>
        new CarrierRuntime(f.app, [
          {
            orgId: f.actor.orgId,
            adapter: client as unknown as CarrierAdapter,
          },
        ]),
      { code: "CARRIER_CONFIG" },
    );
    assert.throws(() =>
      f.app.fulfillment.commit(f.actor, "cp-no-handover", {
        shipmentId: f.shipmentId,
        carrier: "canada-post",
        tracking,
        handoverEvidence: "Label alone cannot authorize custody",
      }),
    );
    assert.deepEqual(native(f), before);
    assert.ok(sim.calls.every((c) => !c.url.pathname.includes("/manifests")));
  });

test("Canada Post captures reviewed intent, account, service and credentials before token I/O", async (t) => {
  const f = setup(t),
    expected = expectedBody(f),
    original = {
      bookingId: f.intent.bookingId,
      reviewHash: f.intent.reviewHash,
    };
  const sim = simulator(f, {
    tokenHook: () => {
      f.intent.bookingId = "changed";
      f.intent.reviewHash = "f".repeat(64);
      f.intent.origin.line1 = "Changed";
      f.intent.destination.line1 = "Changed";
      f.intent.parcel.weightGrams = 1;
      f.config.customerNumber = "9999999";
      f.config.clientSecret = "changed";
      (f.config.services[0] as { code: string }).code = "DOM.XP";
      f.config.shippingPoint = { kind: "deposit", siteId: "ZZZZ" };
    },
  });
  const client = new CanadaPostTestClient(f.config, sim.transport),
    result = await client.create(f.intent, group, () => {});
  assert.deepEqual(writes(sim.calls)[0]!.body, expected);
  assert.equal(result.bookingId, original.bookingId);
  assert.equal(result.reviewHash, original.reviewHash);
  assert.equal(result.customerRequestId, expected.customerRequestId);
});

test("Canada Post opaque reference remains stable across credential rotation but binds warehouse/group/account", (t) => {
  const f = setup(t),
    sim = simulator(f),
    client = new CanadaPostTestClient(f.config, sim.transport);
  assert.equal(
    new CanadaPostTestClient(
      { ...f.config, clientId: "rotation", clientSecret: "rotation" },
      sim.transport,
    ).configurationHash,
    client.configurationHash,
  );
  for (const change of [
    { warehouseId: f.w2 },
    { customerNumber: "7654321" },
    { contractId: "654321" },
  ])
    assert.notEqual(
      new CanadaPostTestClient({ ...f.config, ...change }, sim.transport)
        .configurationHash,
      client.configurationHash,
    );
  assert.equal(sim.calls.length, 0);
});

for (const status of ["created", "transmitted"] as const)
  test(`Canada Post lost creation reply recovers ${status} observation with read-only shipment requests`, async (t) => {
    const f = setup(t),
      before = native(f),
      lost = simulator(f, { loseCreate: true }),
      client = new CanadaPostTestClient(f.config, lost.transport);
    let guards = 0;
    await assert.rejects(
      client.create(f.intent, group, () => {
        guards++;
      }),
      { code: "CARRIER_TRANSPORT" },
    );
    assert.equal(guards, 1);
    assert.equal(writes(lost.calls).length, 1);
    assert.equal(lost.calls.length, 2);
    const sim = simulator(f, { status }),
      found = await new CanadaPostTestClient(f.config, sim.transport).lookup(
        f.intent,
        group,
      );
    assert.ok(found);
    assert.equal(found.status, status);
    assert.equal(found.customerRequestId, reference(f));
    assert.deepEqual(found.label.bytes, pdf);
    assert.equal(writes(sim.calls).length, 0);
    assert.equal(sim.calls.length, 5);
    assert.deepEqual(native(f), before);
  });
test("Canada Post lookup absence does not authorize creation and ambiguous results do not fetch a shipment", async (t) => {
  const f = setup(t),
    before = native(f),
    empty = simulator(f, { lookup: [] });
  assert.equal(
    await new CanadaPostTestClient(f.config, empty.transport).lookup(
      f.intent,
      group,
    ),
    null,
  );
  assert.equal(empty.calls.length, 2);
  const duplicate = simulator(f, {
    lookup: [{ rel: "shipment" }, { rel: "shipment" }],
  });
  await assert.rejects(
    new CanadaPostTestClient(f.config, duplicate.transport).lookup(
      f.intent,
      group,
    ),
    { code: "CARRIER_RESULT" },
  );
  assert.equal(duplicate.calls.length, 2);
  assert.equal(writes(duplicate.calls).length, 0);
  assert.deepEqual(native(f), before);
});
for (const href of [
  "https://attacker.invalid/shipment",
  shipping + "/9999999/9999999/shipments/" + id,
  shipping + account + "/" + id + "?secret=1",
  shipping + account + "/%2E%2E",
  shipping + account + "/../manifests",
  shipping + account + "/" + id + "#fragment",
])
  test(`Canada Post recovery rejects unbound link ${href}`, async (t) => {
    const f = setup(t),
      sim = simulator(f, {
        lookup: [{ rel: "shipment", mediaType: "application/json", href }],
      });
    await assert.rejects(
      new CanadaPostTestClient(f.config, sim.transport).lookup(f.intent, group),
      { code: "CARRIER_RESULT" },
    );
    assert.equal(sim.calls.length, 2);
    assert.equal(writes(sim.calls).length, 0);
  });

const invalidConfig: [string, (c: Json) => void][] = [
  [
    "numeric deposit site",
    (c) => {
      c.shippingPoint = { kind: "deposit", siteId: 1234 };
    },
  ],
  [
    "production declaration",
    (c) => {
      c.testApplication = false;
    },
  ],
  [
    "warehouse",
    (c) => {
      c.warehouseId = "";
    },
  ],
  [
    "account type",
    (c) => {
      c.customerNumber = 1234567;
    },
  ],
  [
    "contract",
    (c) => {
      c.contractId = "x";
    },
  ],
  [
    "empty credentials",
    (c) => {
      c.clientSecret = "";
    },
  ],
  [
    "pickup postal",
    (c) => {
      c.shippingPoint.postalCode = "M5V 1A1";
    },
  ],
  [
    "deposit site",
    (c) => {
      c.shippingPoint = { kind: "deposit", siteId: "bad" };
    },
  ],
  [
    "unsupported service",
    (c) => {
      c.services[0].code = "INT.XP";
    },
  ],
  [
    "duplicate mapping",
    (c) => {
      c.services.push({ ...c.services[0] });
    },
  ],
  [
    "sparse mapping",
    (c) => {
      c.services = Array(1);
    },
  ],
  [
    "control company",
    (c) => {
      c.company = "secret\nvalue";
    },
  ],
];
for (const [name, change] of invalidConfig)
  test(`Canada Post refuses invalid configuration before I/O: ${name}`, (t) => {
    const f = setup(t),
      sim = simulator(f),
      config = structuredClone(f.config) as Json;
    change(config);
    assert.throws(
      () =>
        new CanadaPostTestClient(config as CanadaPostTestConfig, sim.transport),
      { code: "CARRIER_CONFIG" },
    );
    assert.equal(sim.calls.length, 0);
  });

const invalidIntent: [string, (i: CarrierIntent) => CarrierIntent][] = [
  ["wrong provider", (i) => revise(i, { provider: "ups" })],
  [
    "wrong organization",
    (i) =>
      revise(i, { nativeSnapshot: { ...i.nativeSnapshot, org_id: "other" } }),
  ],
  [
    "wrong warehouse",
    (i) =>
      revise(i, {
        nativeSnapshot: { ...i.nativeSnapshot, warehouse_id: "other" },
      }),
  ],
  ["changed review", (i) => ({ ...i, service: "changed" })],
  ["unmapped service", (i) => revise(i, { service: "Express unknown" })],
  [
    "US destination",
    (i) => revise(i, { destination: { ...i.destination, country: "US" } }),
  ],
  [
    "wrong origin",
    (i) => revise(i, { origin: { ...i.origin, postalCode: "K1A0B1" } }),
  ],
  [
    "invalid phone",
    (i) => revise(i, { destination: { ...i.destination, phone: "416" } }),
  ],
  [
    "invalid postal",
    (i) =>
      revise(i, { destination: { ...i.destination, postalCode: "D1A1A1" } }),
  ],
  [
    "fractional grams",
    (i) => revise(i, { parcel: { ...i.parcel, weightGrams: 1.5 } }),
  ],
  [
    "overweight",
    (i) => revise(i, { parcel: { ...i.parcel, weightGrams: 30001 } }),
  ],
  ["oversize", (i) => revise(i, { parcel: { ...i.parcel, lengthMm: 2001 } })],
  [
    "excess girth",
    (i) =>
      revise(i, {
        parcel: { ...i.parcel, lengthMm: 1000, widthMm: 1000, heightMm: 1000 },
      }),
  ],
];
for (const [name, change] of invalidIntent)
  test(`Canada Post refuses unsupported or unbound intent before I/O: ${name}`, async (t) => {
    const f = setup(t),
      sim = simulator(f),
      client = new CanadaPostTestClient(f.config, sim.transport);
    await assert.rejects(client.create(change(f.intent), group, () => {}));
    assert.equal(sim.calls.length, 0);
  });
for (const invalidGroup of ["", "x".repeat(33), "group/escape", "group\nvalue"])
  test(`Canada Post refuses unsupported group ${JSON.stringify(invalidGroup)} before I/O`, async (t) => {
    const f = setup(t),
      sim = simulator(f);
    await assert.rejects(
      new CanadaPostTestClient(f.config, sim.transport).create(
        f.intent,
        invalidGroup,
        () => {},
      ),
      { code: "CARRIER_UNSUPPORTED" },
    );
    assert.equal(sim.calls.length, 0);
  });

const badInfo: [string, (r: Json) => void][] = [
  [
    "wrong request",
    (r) => {
      r.customerRequestId = "wrong";
    },
  ],
  [
    "missing request",
    (r) => {
      delete r.customerRequestId;
    },
  ],
  [
    "transmitted creation",
    (r) => {
      r.shipmentStatus = "transmitted";
    },
  ],
  [
    "suspended",
    (r) => {
      r.shipmentStatus = "suspended";
    },
  ],
  [
    "invalid tracking",
    (r) => {
      r.trackingPin = "123";
    },
  ],
  [
    "duplicate label",
    (r) => {
      r.links.push({ ...r.links[2] });
    },
  ],
  [
    "foreign details",
    (r) => {
      r.links[1].href = "https://attacker.invalid/details";
    },
  ],
  [
    "foreign artifact",
    (r) => {
      r.links[2].href = "https://attacker.invalid/label";
    },
  ],
  [
    "label query",
    (r) => {
      r.links[2].href += "?token=x";
    },
  ],
  [
    "label index",
    (r) => {
      r.links[2].index = 1;
    },
  ],
  [
    "wrong self",
    (r) => {
      r.links[0].href = shipping + account + "/other";
    },
  ],
];
for (const [name, change] of badInfo)
  test(`Canada Post creation rejects mismatched result without fetching details: ${name}`, async (t) => {
    const f = setup(t),
      sim = simulator(f, { create: change });
    await assert.rejects(
      new CanadaPostTestClient(f.config, sim.transport).create(
        f.intent,
        group,
        () => {},
      ),
      { code: "CARRIER_RESULT" },
    );
    assert.equal(sim.calls.length, 2);
    assert.equal(writes(sim.calls).length, 1);
  });
const badDetails: [string, (r: Json) => void][] = [
  [
    "extra receiver company",
    (r) => {
      r.shipmentDetail.deliverySpec.destination.company = "Different company";
    },
  ],
  [
    "extra delivery instructions",
    (r) => {
      r.shipmentDetail.deliverySpec.destination.additionalAddressInfo =
        "Deliver to another entrance";
    },
  ],
  [
    "unpackaged",
    (r) => {
      r.shipmentDetail.deliverySpec.parcelCharacteristics.unpackaged = true;
    },
  ],
  [
    "oversized flag",
    (r) => {
      r.shipmentDetail.deliverySpec.parcelCharacteristics.oversized = true;
    },
  ],
  [
    "request",
    (r) => {
      r.customerRequestId = "other";
    },
  ],
  [
    "tracking",
    (r) => {
      r.trackingPin = "9999999999999999";
    },
  ],
  [
    "group",
    (r) => {
      r.shipmentDetail.groupId = "other";
    },
  ],
  [
    "immediate transmission",
    (r) => {
      r.shipmentDetail.transmitShipment = true;
    },
  ],
  [
    "service",
    (r) => {
      r.shipmentDetail.deliverySpec.serviceCode = "DOM.XP";
    },
  ],
  [
    "sender",
    (r) => {
      r.shipmentDetail.deliverySpec.sender.addressDetails.addressLine1 =
        "Another origin";
    },
  ],
  [
    "destination",
    (r) => {
      r.shipmentDetail.deliverySpec.destination.addressDetails.addressLine1 =
        "Another destination";
    },
  ],
  [
    "extra address line",
    (r) => {
      r.shipmentDetail.deliverySpec.destination.addressDetails.addressLine2 =
        "Changed suite";
    },
  ],
  [
    "recipient alias",
    (r) => {
      r.shipmentDetail.deliverySpec.recipient = {
        ...r.shipmentDetail.deliverySpec.destination,
        name: "Different receiver",
      };
    },
  ],
  [
    "parcel weight",
    (r) => {
      r.shipmentDetail.deliverySpec.parcelCharacteristics.weight = 10;
    },
  ],
  [
    "parcel tube",
    (r) => {
      r.shipmentDetail.deliverySpec.parcelCharacteristics.mailingTube = true;
    },
  ],
  [
    "paid-by account",
    (r) => {
      r.shipmentDetail.deliverySpec.settlementInfo.paidByCustomer = "9999999";
    },
  ],
  [
    "reference",
    (r) => {
      r.shipmentDetail.deliverySpec.references.customerRef1 = "other";
    },
  ],
  [
    "pickup origin",
    (r) => {
      r.finalShippingPoint = "K1A0B1";
    },
  ],
  [
    "customs",
    (r) => {
      r.shipmentDetail.deliverySpec.customs = {};
    },
  ],
  [
    "extra options",
    (r) => {
      r.shipmentDetail.deliverySpec.options = [{ optionCode: "SO" }];
    },
  ],
  [
    "external notification",
    (r) => {
      r.shipmentDetail.deliverySpec.notification = {
        email: "other@example.invalid",
      };
    },
  ],
  [
    "return label",
    (r) => {
      r.shipmentDetail.returnSpec = {};
    },
  ],
];
for (const [name, change] of badDetails)
  test(`Canada Post mismatched details block artifact retrieval: ${name}`, async (t) => {
    const f = setup(t),
      sim = simulator(f, { details: change }),
      before = native(f);
    await assert.rejects(
      new CanadaPostTestClient(f.config, sim.transport).create(
        f.intent,
        group,
        () => {},
      ),
      { code: "CARRIER_RESULT" },
    );
    assert.equal(sim.calls.length, 3);
    assert.equal(writes(sim.calls).length, 1);
    assert.deepEqual(native(f), before);
  });

test("Canada Post native write guard denial survives sanitization and prevents shipment POST", async (t) => {
  const f = setup(t),
    sim = simulator(f),
    client = new CanadaPostTestClient(f.config, sim.transport);
  const error = new DomainError(
    "FORBIDDEN",
    "Synthetic withdrawn authority",
    403,
  );
  await assert.rejects(
    client.create(f.intent, group, () => {
      throw error;
    }),
    (e) => e === error,
  );
  assert.equal(sim.calls.length, 1);
  assert.equal(writes(sim.calls).length, 0);
});
for (const stage of ["token", "details", "label"] as const)
  test(`Canada Post ${stage} transport failure is sanitized and never retried`, async (t) => {
    const f = setup(t),
      sim = simulator(f, {
        raw: (call) => {
          if (
            stage === "token"
              ? call.url.pathname.endsWith("/oauth2/token")
              : stage === "details"
                ? call.url.pathname.endsWith("/details")
                : call.url.pathname.includes("/artifacts/")
          )
            throw new Error("synthetic-cp-secret provider body");
          return undefined;
        },
      }),
      before = native(f);
    await assert.rejects(
      new CanadaPostTestClient(f.config, sim.transport).create(
        f.intent,
        group,
        () => {},
      ),
      (error) => {
        assert.ok(error instanceof DomainError);
        assert.equal(error.code, "CARRIER_TRANSPORT");
        assert.ok(!error.message.includes("synthetic-cp-secret"));
        return true;
      },
    );
    assert.equal(
      sim.calls.length,
      stage === "token" ? 1 : stage === "details" ? 3 : 4,
    );
    assert.equal(writes(sim.calls).length, stage === "token" ? 0 : 1);
    assert.deepEqual(native(f), before);
  });
for (const [name, reply] of [
  ["asynchronous result", () => json({}, 202)],
  ["provider error", () => json({ secret: "synthetic-cp-secret" }, 429)],
  [
    "HTML",
    () =>
      new Response("synthetic-cp-secret", {
        headers: { "content-type": "text/html" },
      }),
  ],
  [
    "redirected",
    () => {
      const r = json({});
      Object.defineProperty(r, "redirected", { value: true });
      return r;
    },
  ],
  [
    "declared oversize",
    () =>
      new Response("{}", {
        headers: {
          "content-type": "application/json",
          "content-length": "2097153",
        },
      }),
  ],
] as const)
  test(`Canada Post refuses unqualified token transport response: ${name}`, async (t) => {
    const f = setup(t),
      sim = simulator(f, { raw: () => reply() });
    await assert.rejects(
      new CanadaPostTestClient(f.config, sim.transport).create(
        f.intent,
        group,
        () => {},
      ),
      { code: "CARRIER_TRANSPORT" },
    );
    assert.equal(sim.calls.length, 1);
  });
for (const [name, token] of [
  ["wrong scope", { scope: "tracking" }],
  ["short lifetime", { expires_in: 30 }],
  ["missing token", { access_token: "" }],
  ["invalid token", { access_token: "token\r\nsecret" }],
  ["wrong type", { token_type: "Basic" }],
] as const)
  test(`Canada Post invalid token prevents shipment creation: ${name}`, async (t) => {
    const f = setup(t),
      sim = simulator(f, {
        raw: (c) =>
          c.url.pathname.endsWith("/oauth2/token")
            ? json({
                token_type: "Bearer",
                access_token: "synthetic-token",
                expires_in: 3600,
                scope: "merchant",
                ...token,
              })
            : undefined,
      });
    await assert.rejects(
      new CanadaPostTestClient(f.config, sim.transport).create(
        f.intent,
        group,
        () => {},
      ),
      { code: "CARRIER_RESULT" },
    );
    assert.equal(sim.calls.length, 1);
  });
for (const [name, reply] of [
  [
    "HTML body",
    () => new Response("not PDF", { headers: { "content-type": "text/html" } }),
  ],
  [
    "non-PDF bytes",
    () =>
      new Response("not PDF", {
        headers: { "content-type": "application/pdf" },
      }),
  ],
  [
    "declared oversized PDF",
    () =>
      new Response(pdf, {
        headers: {
          "content-type": "application/pdf",
          "content-length": "1048577",
        },
      }),
  ],
] as const)
  test(`Canada Post refuses private label ${name}`, async (t) => {
    const f = setup(t),
      sim = simulator(f, {
        raw: (c) =>
          c.url.pathname.includes("/artifacts/") ? reply() : undefined,
      });
    await assert.rejects(
      new CanadaPostTestClient(f.config, sim.transport).create(
        f.intent,
        group,
        () => {},
      ),
    );
    assert.equal(sim.calls.length, 4);
    assert.equal(writes(sim.calls).length, 1);
  });
test("Canada Post streaming size overflow cancels the reader without relying on Content-Length", async (t) => {
  const f = setup(t);
  let canceled = false;
  const sim = simulator(f, {
    raw: () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(2_097_153));
          },
          cancel() {
            canceled = true;
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
  });
  await assert.rejects(
    new CanadaPostTestClient(f.config, sim.transport).create(
      f.intent,
      group,
      () => {},
    ),
    { code: "CARRIER_TRANSPORT" },
  );
  assert.equal(canceled, true);
  assert.equal(sim.calls.length, 1);
});

test("Canada Post retains reviewed Unicode contacts and second address line with benign empty defaults", async (t) => {
  const f = setup(t);
  f.intent = revise(f.intent, {
    destination: {
      ...f.intent.destination,
      name: "Réception synthétique",
      line2: "Suite 2",
    },
  });
  const sim = simulator(f, {
    details: (r) => {
      const spec = r.shipmentDetail.deliverySpec;
      spec.recipient = structuredClone(spec.destination);
      spec.sender.addressDetails.addressLine2 = "";
      spec.destination.company = "";
      spec.options = [];
      spec.parcelCharacteristics.unpackaged = false;
      spec.parcelCharacteristics.mailingTube = false;
      spec.parcelCharacteristics.oversized = false;
    },
  });
  const result = await new CanadaPostTestClient(f.config, sim.transport).create(
    f.intent,
    group,
    () => {},
  );
  assert.deepEqual(writes(sim.calls)[0]!.body, expectedBody(f));
  assert.equal(result.tracking, tracking);
});
test("Canada Post recovery refuses a changed shipment identifier before details retrieval", async (t) => {
  const f = setup(t),
    sim = simulator(f, {
      raw: (call) =>
        call.url.pathname.endsWith("/" + id)
          ? json({ shipmentId: "different" })
          : undefined,
    });
  await assert.rejects(
    new CanadaPostTestClient(f.config, sim.transport).lookup(f.intent, group),
    { code: "CARRIER_RESULT" },
  );
  assert.equal(sim.calls.length, 3);
  assert.equal(writes(sim.calls).length, 0);
});
test("Canada Post deposit details cannot substitute a pickup or another site", async (t) => {
  const f = setup(t, false);
  for (const change of [
    (r: Json) => {
      r.shippingPointId = "ZZZZ";
    },
    (r: Json) => {
      r.cpcPickupIndicator = true;
    },
  ]) {
    const sim = simulator(f, { details: change });
    await assert.rejects(
      new CanadaPostTestClient(f.config, sim.transport).create(
        f.intent,
        group,
        () => {},
      ),
      { code: "CARRIER_RESULT" },
    );
    assert.equal(sim.calls.length, 3);
  }
});
test("Canada Post streaming PDF overflow cancels retrieval after one creation", async (t) => {
  const f = setup(t);
  let canceled = false;
  const sim = simulator(f, {
    raw: (call) =>
      call.url.pathname.includes("/artifacts/")
        ? new Response(
            new ReadableStream({
              start(c) {
                c.enqueue(new Uint8Array(1_048_577));
              },
              cancel() {
                canceled = true;
              },
            }),
            { headers: { "content-type": "application/pdf" } },
          )
        : undefined,
  });
  await assert.rejects(
    new CanadaPostTestClient(f.config, sim.transport).create(
      f.intent,
      group,
      () => {},
    ),
    { code: "CARRIER_TRANSPORT" },
  );
  assert.equal(canceled, true);
  assert.equal(writes(sim.calls).length, 1);
  assert.equal(sim.calls.length, 4);
});
test("Canada Post requires an explicit transport and synchronous write guard before I/O", async (t) => {
  const f = setup(t),
    sim = simulator(f);
  assert.throws(
    () =>
      new CanadaPostTestClient(f.config, undefined as unknown as typeof fetch),
    { code: "CARRIER_CONFIG" },
  );
  await assert.rejects(
    new CanadaPostTestClient(f.config, sim.transport).create(
      f.intent,
      group,
      undefined as unknown as () => void,
    ),
    { code: "CARRIER_CONFIG" },
  );
  assert.equal(sim.calls.length, 0);
});

function manifestBatch(f: F): CanadaPostManifestReview {
  const second = revise(f.intent, {
    bookingId: "synthetic-booking-two",
    shipmentId: "synthetic-native-two",
    nativeSnapshot: { ...f.intent.nativeSnapshot, id: "synthetic-native-two" },
  });
  return {
    manifestId: "synthetic-manifest-review",
    groupId: group,
    entries: [
      { intent: f.intent, shipmentId: id, tracking },
      {
        intent: second,
        shipmentId: "synthetic-shipment-two",
        tracking: "1234567890123457",
      },
    ],
  };
}
const po = "D906402103";
const manifests = "/1234567/1234567/manifests";
function manifestSimulator(
  f: F,
  batch: CanadaPostManifestReview,
  options: {
    lostReply?: boolean;
    tokenHook?: () => void;
    state?: (entry: number, transmitted: boolean) => "created" | "transmitted";
    po?: (entry: number) => unknown;
    groupLinks?: (links: Json[]) => unknown;
    manifestLinks?: (links: Json[]) => unknown;
    info?: (reply: Json, entry: number) => void;
    shipmentDetail?: (reply: Json, entry: number) => void;
    transmit?: (links: Json[]) => unknown;
    manifest?: (reply: Json) => void;
    detail?: (reply: Json) => void;
    raw?: (call: Call) => Response | undefined;
  } = {},
) {
  const frozen = structuredClone(batch),
    config = structuredClone(f.config),
    wire = expectedBody(f);
  const calls: Call[] = [];
  let transmitted = false,
    reference = "",
    writeCount = 0;
  const links = frozen.entries.map((entry) => ({
    rel: "shipment",
    mediaType: "application/json",
    href: shipping + account + "/" + entry.shipmentId,
  }));
  const requestId = (entry: CanadaPostManifestReview["entries"][number]) => {
    const { clientId: _id, clientSecret: _secret, ...binding } = config;
    return (
      "D" +
      digest(
        canonical({
          configurationHash: digest(canonical(binding)),
          bookingId: entry.intent.bookingId,
          reviewHash: entry.intent.reviewHash,
          groupId: frozen.groupId,
        }),
      )
        .slice(0, 31)
        .toUpperCase()
    );
  };
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input)),
      body =
        init?.body && (init.body as string).startsWith("{")
          ? (JSON.parse(init.body as string) as Json)
          : undefined;
    // Token is form encoded, not JSON.
    const call: Call = { url, init: init!, body };
    calls.push(call);
    assert.equal(init!.redirect, "error");
    assert.ok(init!.signal instanceof AbortSignal);
    const raw = options.raw?.(call);
    if (raw) return raw;
    if (url.pathname.endsWith("/oauth2/token")) {
      options.tokenHook?.();
      return json({
        token_type: "Bearer",
        access_token: "synthetic-token",
        expires_in: 3600,
        scope: "merchant",
      });
    }
    assert.equal(
      (init!.headers as Json).authorization,
      "Bearer synthetic-token",
    );
    if (url.pathname === new URL(shipping + account).pathname) {
      assert.equal(init!.method, "GET");
      assert.equal(
        url.searchParams.get("limit"),
        String(frozen.entries.length + 1),
      );
      if (url.searchParams.has("group-id")) {
        assert.equal(url.searchParams.get("group-id"), frozen.groupId);
        return json(options.groupLinks?.(structuredClone(links)) ?? links);
      }
      assert.equal(url.searchParams.get("manifest-id"), po);
      return json(
        options.manifestLinks?.(structuredClone(links)) ?? links.toReversed(),
      );
    }
    if (url.pathname === new URL(shipping + manifests).pathname) {
      assert.equal(init!.method, "POST");
      writeCount++;
      transmitted = true;
      reference = body!.customerReference;
      assert.match(reference, /^D[A-F0-9]{11}$/);
      assert.deepEqual(body, {
        groupIds: [frozen.groupId],
        ...(config.shippingPoint.kind === "pickup"
          ? {
              cpcPickupIndicator: true,
              requestedShippingPoint: config.shippingPoint.postalCode,
            }
          : { shippingPointId: config.shippingPoint.siteId }),
        detailedManifests: true,
        methodOfPayment: "Account",
        manifestAddress: {
          manifestCompany: config.company,
          manifestName: wire.deliverySpec.sender.name,
          phoneNumber: wire.deliverySpec.sender.contactPhone,
          addressDetails: wire.deliverySpec.sender.addressDetails,
        },
        customerReference: reference,
      });
      if (options.lostReply)
        throw new Error("synthetic-cp-secret lost manifest response");
      const result = [
        {
          rel: "manifest",
          mediaType: "application/json",
          href: shipping + manifests + "/" + po,
        },
      ];
      return json(options.transmit?.(result) ?? result);
    }
    if (url.pathname === new URL(shipping + manifests + "/" + po).pathname) {
      assert.equal(init!.method, "GET");
      const reply: Json = {
        poNumber: po,
        links: [
          {
            rel: "details",
            mediaType: "application/json",
            href: shipping + manifests + "/" + po + "/details",
          },
          {
            rel: "artifact",
            mediaType: "application/pdf",
            href:
              shipping + "/artifacts/" + po + "/shipping/synthetic-manifest/0",
          },
        ],
      };
      options.manifest?.(reply);
      return json(reply);
    }
    if (
      url.pathname ===
      new URL(shipping + manifests + "/" + po + "/details").pathname
    ) {
      const reply: Json = {
        poNumber: po,
        customerRef: reference,
        mailedByCustomer: config.customerNumber,
        "mailed-on-behalf-of": config.customerNumber,
        paidByCustomer: config.customerNumber,
        contractId: config.contractId,
        methodOfPayment: "Account",
        finalShippingPoint: "M5V1A1",
        shippingPointName: "Synthetic shipping point",
        shippingPointId: "A1B2",
        ...(config.shippingPoint.kind === "pickup"
          ? { cpcPickupIndicator: true }
          : {}),
        manifestDate: "2026-10-01",
        manifestTime: "15:00 EDT",
        manifestAddress: {
          manifestCompany: config.company,
          manifestName: wire.deliverySpec.sender.name,
          phoneNumber: wire.deliverySpec.sender.contactPhone,
          addressDetails: structuredClone(
            wire.deliverySpec.sender.addressDetails,
          ),
        },
        manifestPricingInfo: {
          baseCost: 20,
          automationDiscount: -1,
          optionsAndSurcharges: 2,
          gst: 0,
          pst: 0,
          hst: 2.73,
          totalDueCpc: 23.73,
        },
      };
      options.detail?.(reply);
      return json(reply);
    }
    if (
      url.pathname ===
      new URL(shipping + "/artifacts/" + po + "/shipping/synthetic-manifest/0")
        .pathname
    ) {
      assert.equal((init!.headers as Json).accept, "application/pdf");
      return new Response(pdf, {
        headers: { "content-type": "application/pdf" },
      });
    }
    for (let i = 0; i < frozen.entries.length; i++) {
      const entry = frozen.entries[i]!,
        prefix = shipping + account + "/" + entry.shipmentId;
      const state =
        options.state?.(i, transmitted) ??
        (transmitted ? "transmitted" : "created");
      if (url.pathname === new URL(prefix).pathname) {
        const reply: Json = {
          customerRequestId: requestId(entry),
          shipmentId: entry.shipmentId,
          trackingPin: entry.tracking,
          shipmentStatus: state,
          ...(state === "transmitted"
            ? { poNumber: options.po?.(i) ?? po }
            : {}),
          links: [
            { rel: "self", mediaType: "application/json", href: prefix },
            {
              rel: "details",
              mediaType: "application/json",
              href: prefix + "/details",
            },
            {
              rel: "label",
              mediaType: "application/pdf",
              index: 0,
              href:
                shipping + "/artifacts/1234567/shipping/synthetic-artifact/0",
            },
          ],
        };
        options.info?.(reply, i);
        return json(reply);
      }
      if (url.pathname === new URL(prefix + "/details").pathname) {
        const reply: Json = {
          customerRequestId: requestId(entry),
          trackingPin: entry.tracking,
          shipmentStatus: state,
          ...(config.shippingPoint.kind === "pickup"
            ? {
                cpcPickupIndicator: true,
                finalShippingPoint: config.shippingPoint.postalCode,
              }
            : { shippingPointId: config.shippingPoint.siteId }),
          shipmentDetail: {
            groupId: frozen.groupId,
            deliverySpec: structuredClone(wire.deliverySpec),
          },
        };
        reply.shipmentDetail.deliverySpec.references.customerRef1 =
          requestId(entry);
        options.shipmentDetail?.(reply, i);
        return json(reply);
      }
    }
    assert.fail("Unexpected fixture route " + url);
  };
  return {
    calls,
    transport,
    get writes() {
      return writeCount;
    },
    setReference(value: string) {
      reference = value;
    },
  };
}
const manifestWrites = (calls: Call[]) =>
  calls.filter(
    (call) =>
      call.init.method === "POST" && call.url.pathname.endsWith("/manifests"),
  );
for (const pickup of [true, false])
  test(`Canada Post manifest confirms exact two-shipment ${pickup ? "pickup" : "deposit"} batch without native effects`, async (t) => {
    const f = setup(t, pickup),
      batch = manifestBatch(f),
      sim = manifestSimulator(f, batch),
      before = native(f);
    let guards = 0;
    const result = await new CanadaPostTestClient(
      f.config,
      sim.transport,
    ).transmitManifest(batch, () => {
      guards++;
      assert.equal(sim.writes, 0);
    });
    assert.equal(guards, 1);
    assert.equal(sim.writes, 1);
    assert.equal(result.manifestId, batch.manifestId);
    assert.equal(result.groupId, group);
    assert.equal(result.poNumber, po);
    assert.equal(result.totalCents, 2373);
    assert.equal(result.manifestDate, "2026-10-01");
    assert.deepEqual(result.shipmentIds, [id, "synthetic-shipment-two"]);
    assert.deepEqual(result.document.bytes, pdf);
    assert.equal(
      sim.calls.filter((call) => call.url.pathname.includes("/artifacts/"))
        .length,
      1,
    );
    assert.deepEqual(native(f), before);
    const recovery = await new CanadaPostTestClient(
      { ...f.config, clientSecret: "rotated-synthetic-secret" },
      sim.transport,
    ).recoverManifest(batch);
    assert.deepEqual(recovery, result);
    assert.equal(sim.writes, 1);
    assert.deepEqual(native(f), before);
  });
test("Canada Post lost manifest reply recovers through fresh client reads without another write", async (t) => {
  const f = setup(t),
    batch = manifestBatch(f),
    sim = manifestSimulator(f, batch, { lostReply: true }),
    before = native(f);
  await assert.rejects(
    new CanadaPostTestClient(f.config, sim.transport).transmitManifest(
      batch,
      () => {},
    ),
    (error) =>
      error instanceof DomainError &&
      error.code === "CARRIER_TRANSPORT" &&
      !error.message.includes("synthetic-cp-secret"),
  );
  assert.equal(sim.writes, 1);
  const recovered = await new CanadaPostTestClient(
    f.config,
    sim.transport,
  ).recoverManifest(batch);
  assert.equal(recovered!.poNumber, po);
  assert.equal(sim.writes, 1);
  await assert.rejects(
    new CanadaPostTestClient(f.config, sim.transport).transmitManifest(
      batch,
      () => assert.fail("Guard must not be reached"),
    ),
  );
  assert.equal(sim.writes, 1);
  assert.deepEqual(native(f), before);
});
test("Canada Post empty manifest recovery reads all retained shipments and grants no resend", async (t) => {
  const f = setup(t),
    batch = manifestBatch(f),
    sim = manifestSimulator(f, batch);
  assert.equal(
    await new CanadaPostTestClient(f.config, sim.transport).recoverManifest(
      batch,
    ),
    null,
  );
  assert.equal(sim.writes, 0);
  assert.equal(
    sim.calls.filter((call) => call.url.pathname.endsWith("/oauth2/token"))
      .length,
    1,
  );
  assert.equal(
    sim.calls.filter((call) => call.init.method === "GET").length,
    4,
  );
});
test("Canada Post captures whole manifest review/configuration before token await", async (t) => {
  const f = setup(t),
    batch = manifestBatch(f),
    original = structuredClone(batch);
  const sim = manifestSimulator(f, batch, {
    tokenHook: () => {
      batch.manifestId = "changed";
      batch.groupId = "changed";
      batch.entries[0]!.intent.origin.line1 = "Changed warehouse";
      (batch.entries as unknown[]).pop();
      f.config.company = "Changed company";
      f.config.customerNumber = "9999999";
    },
  });
  const client = new CanadaPostTestClient(f.config, sim.transport),
    result = await client.transmitManifest(batch, () => {});
  assert.equal(result.manifestId, original.manifestId);
  assert.equal(result.groupId, original.groupId);
  assert.equal(result.shipmentIds.length, 2);
  assert.equal(sim.writes, 1);
});
test("Canada Post manifest synchronous guard runs after preflight and blocks purchase", async (t) => {
  const f = setup(t),
    batch = manifestBatch(f),
    sim = manifestSimulator(f, batch);
  const denied = new DomainError(
    "CONSENT",
    "Synthetic withdrawn permission",
    403,
  );
  await assert.rejects(
    new CanadaPostTestClient(f.config, sim.transport).transmitManifest(
      batch,
      () => {
        assert.equal(
          sim.calls.filter((call) => call.init.method === "GET").length,
          5,
        );
        throw denied;
      },
    ),
    (error) => error === denied,
  );
  assert.equal(sim.writes, 0);
});
for (const [name, change] of Object.entries({
  empty: (batch: CanadaPostManifestReview) => {
    batch.entries = [];
  },
  oversized: (batch: CanadaPostManifestReview) => {
    batch.entries = Array(101).fill(batch.entries[0]);
  },
  duplicate: (batch: CanadaPostManifestReview) => {
    batch.entries = [batch.entries[0]!, batch.entries[0]!];
  },
  tracking: (batch: CanadaPostManifestReview) => {
    (batch.entries[1] as Json).tracking = batch.entries[0]!.tracking;
  },
  booking: (batch: CanadaPostManifestReview) => {
    batch.entries[1]!.intent = revise(batch.entries[1]!.intent, {
      bookingId: batch.entries[0]!.intent.bookingId,
    });
  },
  native: (batch: CanadaPostManifestReview) => {
    batch.entries[1]!.intent = revise(batch.entries[1]!.intent, {
      shipmentId: batch.entries[0]!.intent.shipmentId,
      nativeSnapshot: batch.entries[0]!.intent.nativeSnapshot,
    });
  },
  sender: (batch: CanadaPostManifestReview) => {
    batch.entries[1]!.intent = revise(batch.entries[1]!.intent, {
      origin: {
        ...batch.entries[1]!.intent.origin,
        line1: "Different reviewed warehouse",
      },
    });
  },
  foreignWarehouse: (batch: CanadaPostManifestReview) => {
    batch.entries[1]!.intent = revise(batch.entries[1]!.intent, {
      nativeSnapshot: {
        ...batch.entries[1]!.intent.nativeSnapshot,
        warehouse_id: "foreign",
      },
    });
  },
  corruptedReview: (batch: CanadaPostManifestReview) => {
    batch.entries[0]!.intent.destination.line1 = "Unreviewed receiver";
  },
  invalidGroup: (batch: CanadaPostManifestReview) => {
    batch.groupId = "bad?group";
  },
  invalidTracking: (batch: CanadaPostManifestReview) => {
    (batch.entries[0] as Json).tracking = "123";
  },
  invalidShipment: (batch: CanadaPostManifestReview) => {
    (batch.entries[0] as Json).shipmentId = "../other";
  },
}))
  test(`Canada Post manifest rejects ${name} before transport`, async (t) => {
    const f = setup(t),
      batch = manifestBatch(f);
    change(batch);
    let calls = 0;
    const client = new CanadaPostTestClient(f.config, async () => {
      calls++;
      assert.fail("No IO before valid complete review");
    });
    await assert.rejects(client.transmitManifest(batch, () => {}));
    await assert.rejects(client.recoverManifest(batch));
    assert.equal(calls, 0);
  });
for (const [name, change] of Object.entries({
  missing: (links: Json[]) => links.slice(0, 1),
  extra: (links: Json[]) => [
    ...links,
    { ...links[0], href: shipping + account + "/extra" },
  ],
  duplicate: (links: Json[]) => [links[0], links[0]],
  changed: (links: Json[]) => [
    { ...links[0], href: shipping + account + "/foreign" },
    links[1],
  ],
  foreignAccount: (links: Json[]) => [
    { ...links[0], href: shipping + "/9999999/9999999/shipments/x" },
    links[1],
  ],
  query: (links: Json[]) => [
    { ...links[0], href: links[0]!.href + "?token=secret" },
    links[1],
  ],
  redirectHost: (links: Json[]) => [
    { ...links[0], href: "https://foreign.invalid/x" },
    links[1],
  ],
}))
  for (const post of [false, true])
    test(`Canada Post ${post ? "post-manifest" : "preflight"} rejects ${name} membership`, async (t) => {
      const f = setup(t),
        batch = manifestBatch(f),
        sim = manifestSimulator(
          f,
          batch,
          post ? { manifestLinks: change } : { groupLinks: change },
        );
      await assert.rejects(
        new CanadaPostTestClient(f.config, sim.transport).transmitManifest(
          batch,
          () => {},
        ),
      );
      assert.equal(sim.writes, post ? 1 : 0);
      assert.equal(
        sim.calls.filter((call) => call.url.pathname.includes("/artifacts/"))
          .length,
        0,
      );
    });
for (const [name, change] of Object.entries({
  reference: (reply: Json) => {
    reply.customerRef = "FOREIGN";
  },
  payer: (reply: Json) => {
    reply.paidByCustomer = "9999999";
  },
  mailedBy: (reply: Json) => {
    reply.mailedByCustomer = "9999999";
  },
  behalf: (reply: Json) => {
    reply["mailed-on-behalf-of"] = "9999999";
  },
  contract: (reply: Json) => {
    reply.contractId = "999999";
  },
  payment: (reply: Json) => {
    reply.methodOfPayment = "CreditCard";
  },
  cardReceipt: (reply: Json) => {
    reply.ccReceiptDetails = {};
  },
  supplierReceipt: (reply: Json) => {
    reply.supplierAccountReceiptDetails = {};
  },
  sender: (reply: Json) => {
    reply.manifestAddress.addressDetails.addressLine1 = "Foreign sender";
  },
  addedLine: (reply: Json) => {
    reply.manifestAddress.addressDetails.addressLine2 = "Foreign line";
  },
  company: (reply: Json) => {
    reply.manifestAddress.manifestCompany = "Foreign company";
  },
  point: (reply: Json) => {
    reply.finalShippingPoint = "K1A0B1";
  },
  pickup: (reply: Json) => delete reply.cpcPickupIndicator,
  date: (reply: Json) => {
    reply.manifestDate = "2026-02-30";
  },
  time: (reply: Json) => {
    reply.manifestTime = "25:61 EST";
  },
  fractionalCent: (reply: Json) => {
    reply.manifestPricingInfo.totalDueCpc = 23.731;
  },
  negativeTotal: (reply: Json) => {
    reply.manifestPricingInfo.totalDueCpc = -1;
  },
  missingPricing: (reply: Json) => delete reply.manifestPricingInfo.baseCost,
  enormousPrice: (reply: Json) => {
    reply.manifestPricingInfo.totalDueCpc = 1000001;
  },
}))
  test(`Canada Post manifest rejects ${name} detail before document retrieval`, async (t) => {
    const f = setup(t),
      batch = manifestBatch(f),
      sim = manifestSimulator(f, batch, { detail: change });
    await assert.rejects(
      new CanadaPostTestClient(f.config, sim.transport).transmitManifest(
        batch,
        () => {},
      ),
    );
    assert.equal(sim.writes, 1);
    assert.equal(
      sim.calls.filter((call) => call.url.pathname.includes("/artifacts/"))
        .length,
      0,
    );
  });
for (const [name, change] of Object.entries({
  foreignAccount: (reply: Json) => {
    reply.links[0].href =
      shipping + "/9999999/9999999/manifests/" + po + "/details";
  },
  foreignArtifact: (reply: Json) => {
    reply.links[1].href = "https://foreign.invalid/artifact";
  },
  wrongOrderArtifact: (reply: Json) => {
    reply.links[1].href =
      shipping + "/artifacts/FOREIGN/shipping/synthetic-manifest/0";
  },
  queryArtifact: (reply: Json) => {
    reply.links[1].href += "?secret=hidden";
  },
  jsonArtifact: (reply: Json) => {
    reply.links[1].mediaType = "application/json";
  },
  duplicateArtifact: (reply: Json) => reply.links.push(reply.links[1]),
  changedOrder: (reply: Json) => {
    reply.poNumber = "OTHER";
  },
}))
  test(`Canada Post manifest rejects ${name} links before retrieval`, async (t) => {
    const f = setup(t),
      batch = manifestBatch(f),
      sim = manifestSimulator(f, batch, { manifest: change });
    await assert.rejects(
      new CanadaPostTestClient(f.config, sim.transport).transmitManifest(
        batch,
        () => {},
      ),
    );
    assert.equal(sim.writes, 1);
    assert.equal(
      sim.calls.filter((call) => call.url.pathname.includes("/artifacts/"))
        .length,
      0,
    );
  });
for (const [name, options] of Object.entries({
  alreadyTransmitted: { state: () => "transmitted" as const },
  mixed: {
    state: (i: number) =>
      i === 0 ? ("created" as const) : ("transmitted" as const),
  },
  changedReference: {
    info: (reply: Json) => {
      reply.customerRequestId = "FOREIGN";
    },
  },
  changedTracking: {
    info: (reply: Json) => {
      reply.trackingPin = "9999999999999999";
    },
  },
  changedParcel: {
    shipmentDetail: (reply: Json) => {
      reply.shipmentDetail.deliverySpec.parcelCharacteristics.weight = 29;
    },
  },
  wrongGroup: {
    shipmentDetail: (reply: Json) => {
      reply.shipmentDetail.groupId = "ForeignGroup";
    },
  },
  createdOrder: {
    info: (reply: Json) => {
      reply.poNumber = po;
    },
  },
}))
  test(`Canada Post rejects ${name} shipment before manifest purchase`, async (t) => {
    const f = setup(t),
      batch = manifestBatch(f),
      sim = manifestSimulator(f, batch, options);
    await assert.rejects(
      new CanadaPostTestClient(f.config, sim.transport).transmitManifest(
        batch,
        () => {},
      ),
    );
    assert.equal(sim.writes, 0);
  });
for (const [name, options] of Object.entries({
  mixed: {
    state: (i: number) =>
      i === 0 ? ("created" as const) : ("transmitted" as const),
  },
  differentOrders: {
    state: () => "transmitted" as const,
    po: (i: number) => (i === 0 ? po : "OTHER"),
  },
  invalidOrder: { state: () => "transmitted" as const, po: () => "../foreign" },
  foreignTracking: {
    info: (reply: Json) => {
      reply.trackingPin = "9999999999999999";
    },
  },
}))
  test(`Canada Post ${name} manifest recovery remains uncertain with zero shipping writes`, async (t) => {
    const f = setup(t),
      batch = manifestBatch(f),
      sim = manifestSimulator(f, batch, options);
    await assert.rejects(
      new CanadaPostTestClient(f.config, sim.transport).recoverManifest(batch),
    );
    assert.equal(sim.writes, 0);
  });
for (const status of [202, 400, 401, 503])
  test(`Canada Post manifest ${status} response never resends`, async (t) => {
    const f = setup(t),
      batch = manifestBatch(f),
      sim = manifestSimulator(f, batch, {
        raw: (call) =>
          call.init.method === "POST" &&
          call.url.pathname.endsWith("/manifests")
            ? json(
                {
                  errors: [
                    { errorCode: "9153", message: "synthetic-cp-secret" },
                  ],
                },
                status,
              )
            : undefined,
      });
    await assert.rejects(
      new CanadaPostTestClient(f.config, sim.transport).transmitManifest(
        batch,
        () => {},
      ),
      (error) =>
        error instanceof DomainError &&
        error.code === "CARRIER_TRANSPORT" &&
        !error.message.includes("synthetic-cp-secret"),
    );
    assert.equal(manifestWrites(sim.calls).length, 1);
  });

test("Canada Post manifest identity is stable across entry order and credential rotation, changes with reviewed scope", (t) => {
  const f = setup(t),
    batch = manifestBatch(f),
    never: typeof fetch = async () => assert.fail("Identity performs no IO");
  const original = new CanadaPostTestClient(f.config, never).manifestIdentity(
    batch,
  );
  assert.deepEqual(
    new CanadaPostTestClient(
      {
        ...f.config,
        clientId: "rotated-client",
        clientSecret: "rotated-secret",
      },
      never,
    ).manifestIdentity({ ...batch, entries: batch.entries.toReversed() }),
    original,
  );
  for (const changed of [
    { ...batch, groupId: "OtherGroup" },
    { ...batch, manifestId: "other-review" },
    { ...batch, entries: batch.entries.slice(0, 1) },
    {
      ...batch,
      entries: batch.entries.map((entry, i) =>
        i
          ? entry
          : {
              ...entry,
              intent: revise(entry.intent, {
                destination: {
                  ...entry.intent.destination,
                  line1: "Other reviewed destination",
                },
              }),
            },
      ),
    },
  ]) {
    assert.notEqual(
      new CanadaPostTestClient(f.config, never).manifestIdentity(changed)
        .reviewHash,
      original.reviewHash,
    );
  }
  assert.notEqual(
    new CanadaPostTestClient(
      { ...f.config, contractId: "999999" },
      never,
    ).manifestIdentity(batch).reviewHash,
    original.reviewHash,
  );
});
test("Canada Post manifest supports complete 100-shipment batch at the explicit bound", async (t) => {
  const f = setup(t),
    base = f.intent,
    batch: CanadaPostManifestReview = {
      manifestId: "synthetic-largest-manifest",
      groupId: group,
      entries: Array.from({ length: 100 }, (_, i) => ({
        intent: revise(base, {
          bookingId: "batch-booking-" + i,
          shipmentId: "batch-native-" + i,
          nativeSnapshot: { ...base.nativeSnapshot, id: "batch-native-" + i },
        }),
        shipmentId: "batch-provider-" + i,
        tracking: String(10000000000 + i),
      })),
    };
  const sim = manifestSimulator(f, batch),
    result = await new CanadaPostTestClient(
      f.config,
      sim.transport,
    ).transmitManifest(batch, () => {});
  assert.equal(result.shipmentIds.length, 100);
  assert.equal(sim.writes, 1);
  assert.equal(
    sim.calls.filter(
      (call) =>
        call.url.searchParams.has("group-id") ||
        call.url.searchParams.has("manifest-id"),
    ).length,
    2,
  );
  assert.equal(
    sim.calls.filter((call) => call.url.pathname.includes("/artifacts/"))
      .length,
    1,
  );
});
for (const [name, change] of Object.entries({
  empty: () => [],
  multiple: (links: Json[]) => [...links, ...links],
  foreign: (links: Json[]) => [
    { ...links[0], href: "https://foreign.invalid/manifest" },
  ],
  account: (links: Json[]) => [
    { ...links[0], href: shipping + "/9999999/9999999/manifests/" + po },
  ],
  query: (links: Json[]) => [
    { ...links[0], href: links[0]!.href + "?secret=hidden" },
  ],
}))
  test(`Canada Post ${name} transmit result remains uncertain after one write`, async (t) => {
    const f = setup(t),
      batch = manifestBatch(f),
      sim = manifestSimulator(f, batch, { transmit: change });
    await assert.rejects(
      new CanadaPostTestClient(f.config, sim.transport).transmitManifest(
        batch,
        () => {},
      ),
    );
    assert.equal(sim.writes, 1);
  });
for (const [name, raw] of Object.entries({
  unavailable: () => json({ message: "synthetic-cp-secret" }, 503),
  wrongType: () =>
    new Response(pdf, { headers: { "content-type": "text/plain" } }),
  invalidSignature: () =>
    new Response("Not a PDF", {
      headers: { "content-type": "application/pdf" },
    }),
  excessiveLength: () =>
    new Response(pdf, {
      headers: {
        "content-type": "application/pdf",
        "content-length": "1048577",
      },
    }),
  excessiveStream: () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Buffer.alloc(1048577));
          controller.close();
        },
      }),
      { headers: { "content-type": "application/pdf" } },
    ),
}))
  test(`Canada Post ${name} manifest document leaves purchase uncertain without retry`, async (t) => {
    const f = setup(t),
      batch = manifestBatch(f),
      sim = manifestSimulator(f, batch, {
        raw: (call) =>
          call.url.pathname.includes("/artifacts/") ? raw() : undefined,
      });
    await assert.rejects(
      new CanadaPostTestClient(f.config, sim.transport).transmitManifest(
        batch,
        () => {},
      ),
      (error) =>
        error instanceof DomainError &&
        !error.message.includes("synthetic-cp-secret"),
    );
    assert.equal(sim.writes, 1);
    await assert.rejects(
      new CanadaPostTestClient(f.config, sim.transport).recoverManifest(batch),
    );
    assert.equal(sim.writes, 1);
  });
test("Canada Post unfinished manifest recovery error is retained, never converted to another transmit", async (t) => {
  const f = setup(t),
    batch = manifestBatch(f),
    sim = manifestSimulator(f, batch, {
      lostReply: true,
      raw: (call) =>
        call.init.method === "GET" &&
        call.url.pathname === new URL(shipping + manifests + "/" + po).pathname
          ? json(
              {
                errors: [{ errorCode: "9153", message: "synthetic-cp-secret" }],
              },
              400,
            )
          : undefined,
    });
  await assert.rejects(
    new CanadaPostTestClient(f.config, sim.transport).transmitManifest(
      batch,
      () => {},
    ),
  );
  for (let i = 0; i < 2; i++)
    await assert.rejects(
      new CanadaPostTestClient(f.config, sim.transport).recoverManifest(batch),
    );
  assert.equal(sim.writes, 1);
});
test("Canada Post changed recovery review cannot accept prior manifest", async (t) => {
  const f = setup(t),
    batch = manifestBatch(f),
    sim = manifestSimulator(f, batch);
  await new CanadaPostTestClient(f.config, sim.transport).transmitManifest(
    batch,
    () => {},
  );
  await assert.rejects(
    new CanadaPostTestClient(f.config, sim.transport).recoverManifest({
      ...batch,
      manifestId: "different-reviewed-attempt",
    }),
  );
  assert.equal(sim.writes, 1);
});
