import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { setup, native } from "./canada-post-fixture.ts";
import { canonical, digest } from "../src/server/core.ts";
import type { CarrierIntent } from "../src/server/carrier-bookings.ts";
import {
  CanadaPostTestClient,
  type CanadaPostTestConfig,
} from "../src/server/canada-post-test.ts";
import {
  captureCanadaPostAccountBinding,
  canadaPostConfigurationHash,
  reviewCanadaPostShipment,
  captureCanadaPostShipmentDetails,
} from "../src/server/canada-post-evidence.ts";

type Json = Record<string, any>;
const groupId = "SYNTHETIC_GROUP";
const tracking = "1234567890123456";
const shipmentId = "synthetic-shipment";
const gateway =
  "https://api.canadapost-postescanada.ca/prod/devportal-portaildesdeveloppeurs";
const shipping = gateway + "/shipping/v1";
const path = shipping + "/1234567/1234567/shipments";
const labelUrl = shipping + "/artifacts/1234567/shipping/synthetic-label/0";
const pdf = Buffer.from("%PDF-1.7\nSynthetic evidence fixture\n%%EOF");
function fixture(t: Parameters<typeof setup>[0], pickup = true) {
  const f = setup(t);
  const intent = JSON.parse(
    f.app.database
      .owned("integration")
      .get<{ intent: string }>(
        "SELECT intent FROM integration_carrier_bookings WHERE id=?",
        f.input.entries[0]!.bookingId,
      )!.intent,
  ) as CarrierIntent;
  const binding = {
    orgId: f.actor.orgId,
    warehouseId: f.w1,
    testApplication: true as const,
    customerNumber: "1234567",
    contractId: "123456",
    company: "Synthetic distributor",
    shippingPoint: pickup
      ? { kind: "pickup" as const, postalCode: "M5V1A1" }
      : { kind: "deposit" as const, siteId: "A1B2" },
    services: [
      { service: "Other reviewed service", code: "DOM.XP" as const },
      { service: "Synthetic domestic", code: "DOM.RP" as const },
    ],
  };
  const config: CanadaPostTestConfig = {
    ...binding,
    clientId: "synthetic-client",
    clientSecret: "synthetic-secret",
  };
  // Independent canonical encoder/hash; do not derive expected wire data from helpers.
  const encode = (v: any): string =>
    Array.isArray(v)
      ? `[${v.map(encode).join(",")}]`
      : v !== null && typeof v === "object"
        ? `{${Object.keys(v)
            .sort()
            .map((k) => JSON.stringify(k) + ":" + encode(v[k]))
            .join(",")}}`
        : JSON.stringify(v);
  const sha = (v: unknown) =>
    createHash("sha256").update(encode(v)).digest("hex");
  const hash = sha(binding);
  const ref =
    "D" +
    sha({
      configurationHash: hash,
      bookingId: intent.bookingId,
      reviewHash: intent.reviewHash,
      groupId,
    })
      .slice(0, 31)
      .toUpperCase();
  const body = {
    customerRequestId: ref,
    groupId,
    ...(pickup
      ? { cpcPickupIndicator: true, requestedShippingPoint: "M5V1A1" }
      : { shippingPointId: "A1B2" }),
    deliverySpec: {
      serviceCode: "DOM.RP",
      sender: {
        name: "Synthetic warehouse",
        company: "Synthetic distributor",
        contactPhone: "4165550100",
        addressDetails: {
          addressLine1: "1 Test Street",
          city: "Toronto",
          provState: "ON",
          countryCode: "CA",
          postalZipCode: "M5V1A1",
        },
      },
      destination: {
        name: "Synthetic receiver",
        clientVoiceNumber: "4165550100",
        addressDetails: {
          addressLine1: "2 Test Street",
          city: "Ottawa",
          provState: "ON",
          countryCode: "CA",
          postalZipCode: "K1A0B1",
        },
      },
      parcelCharacteristics: {
        weight: 1,
        dimensions: { length: 10, width: 10, height: 10 },
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
  const details = {
    customerRequestId: ref,
    trackingPin: tracking,
    shipmentStatus: "created",
    ...(pickup
      ? { cpcPickupIndicator: true, finalShippingPoint: "M5V1A1" }
      : { shippingPointId: "A1B2" }),
    shipmentDetail: {
      groupId,
      deliverySpec: structuredClone(body.deliverySpec),
    },
  };
  return { ...f, intent, binding, config, hash, ref, body, details };
}
for (const rotated of [false, true])
  for (const pickup of [true, false])
    test(`independent native ${pickup ? "pickup" : "deposit"} review and actual guarded client bytes, rotated=${rotated}`, async (t) => {
      const f = fixture(t, pickup),
        before = native(f);
      if (rotated) {
        f.config.clientId = "rotated-client";
        f.config.clientSecret = "rotated-secret";
      }
      const binding = captureCanadaPostAccountBinding(f.binding);
      assert.equal(canadaPostConfigurationHash(binding), f.hash);
      const review = reviewCanadaPostShipment(binding, f.intent, groupId);
      assert.deepEqual(review, {
        bookingId: f.intent.bookingId,
        reviewHash: f.intent.reviewHash,
        groupId,
        customerRequestId: f.ref,
        body: f.body,
      });
      assert.deepEqual(
        captureCanadaPostShipmentDetails(
          binding,
          review,
          { tracking, status: "created" },
          f.details,
        ),
        { groupId, customerRequestId: f.ref, tracking, status: "created" },
      );
      let guards = 0;
      const calls: { url: string; init: RequestInit }[] = [];
      const client = new CanadaPostTestClient(f.config, async (url, init) => {
        calls.push({ url: String(url), init: init! });
        assert.equal(init!.redirect, "error");
        assert.ok(init!.signal instanceof AbortSignal);
        const json = (v: unknown) =>
          new Response(JSON.stringify(v), {
            headers: { "content-type": "application/json" },
          });
        if (String(url).endsWith("/oauth2/token")) {
          assert.equal(
            (init!.headers as Json)["X-IBM-Client-Id"],
            f.config.clientId,
          );
          assert.equal(
            (init!.headers as Json)["X-IBM-Client-Secret"],
            f.config.clientSecret,
          );
          return json({
            token_type: "Bearer",
            access_token: "synthetic-token",
            expires_in: 3600,
            scope: "merchant",
          });
        }
        if (String(url) === path) {
          assert.equal(guards, 1);
          assert.equal(init!.method, "POST");
          assert.equal(init!.body, JSON.stringify(f.body));
          return json({
            shipmentId,
            trackingPin: tracking,
            customerRequestId: f.ref,
            shipmentStatus: "created",
            links: [
              {
                rel: "self",
                mediaType: "application/json",
                href: path + "/" + shipmentId,
              },
              {
                rel: "details",
                mediaType: "application/json",
                href: path + "/" + shipmentId + "/details",
              },
              {
                rel: "label",
                mediaType: "application/pdf",
                index: 0,
                href: labelUrl,
              },
            ],
          });
        }
        assert.equal(init!.method, "GET");
        if (String(url) === path + "/" + shipmentId + "/details")
          return json(f.details);
        assert.equal(String(url), labelUrl);
        return new Response(pdf, {
          headers: { "content-type": "application/pdf" },
        });
      });
      assert.equal(client.configurationHash, f.hash);
      const result = await client.create(f.intent, groupId, () => {
        assert.equal(calls.length, 1);
        guards++;
      });
      assert.equal(guards, 1);
      assert.equal(calls.length, 4);
      assert.equal(result.customerRequestId, f.ref);
      assert.deepEqual(result.label.bytes, pdf);
      assert.deepEqual(native(f), before);
    });

function rehash(intent: CarrierIntent) {
  const { bookingId, reviewHash: _old, ...review } = intent;
  return { ...review, bookingId, reviewHash: digest(canonical(review)) };
}

test("strict historical descriptor rejects every unsupported account shape", async (t) => {
  const f = fixture(t);
  const changes: [string, (v: Json) => void][] = [
    [
      "secret",
      (v) => {
        v.clientSecret = "forbidden";
      },
    ],
    [
      "client ID",
      (v) => {
        v.clientId = "forbidden";
      },
    ],
    [
      "token",
      (v) => {
        v.access_token = "forbidden";
      },
    ],
    [
      "unknown",
      (v) => {
        v.extra = true;
      },
    ],
    [
      "missing org",
      (v) => {
        delete v.orgId;
      },
    ],
    [
      "blank org",
      (v) => {
        v.orgId = "";
      },
    ],
    [
      "org bound",
      (v) => {
        v.orgId = "x".repeat(129);
      },
    ],
    [
      "site bound",
      (v) => {
        v.warehouseId = "x".repeat(129);
      },
    ],
    [
      "site missing",
      (v) => {
        delete v.warehouseId;
      },
    ],
    [
      "trimmed site",
      (v) => {
        v.warehouseId = " site";
      },
    ],
    [
      "control org",
      (v) => {
        v.orgId = "org\n";
      },
    ],
    [
      "false test marker",
      (v) => {
        v.testApplication = false;
      },
    ],
    [
      "string test marker",
      (v) => {
        v.testApplication = "true";
      },
    ],
    [
      "numeric customer",
      (v) => {
        v.customerNumber = 1234567;
      },
    ],
    [
      "short customer",
      (v) => {
        v.customerNumber = "123456";
      },
    ],
    [
      "long customer",
      (v) => {
        v.customerNumber = "12345678901";
      },
    ],
    [
      "nondigit customer",
      (v) => {
        v.customerNumber = "X234567";
      },
    ],
    [
      "numeric contract",
      (v) => {
        v.contractId = 123456;
      },
    ],
    [
      "empty contract",
      (v) => {
        v.contractId = "";
      },
    ],
    [
      "long contract",
      (v) => {
        v.contractId = "1".repeat(11);
      },
    ],
    [
      "trimmed contract",
      (v) => {
        v.contractId = "123 ";
      },
    ],
    [
      "empty company",
      (v) => {
        v.company = "";
      },
    ],
    [
      "long company",
      (v) => {
        v.company = "x".repeat(45);
      },
    ],
    [
      "control company",
      (v) => {
        v.company = "synthetic\u0000";
      },
    ],
    [
      "point null",
      (v) => {
        v.shippingPoint = null;
      },
    ],
    [
      "point array",
      (v) => {
        v.shippingPoint = [];
      },
    ],
    [
      "point unsupported",
      (v) => {
        v.shippingPoint.kind = "other";
      },
    ],
    [
      "point credential",
      (v) => {
        v.shippingPoint.clientSecret = "forbidden";
      },
    ],
    [
      "point extra deposit",
      (v) => {
        v.shippingPoint.siteId = "A1B2";
      },
    ],
    [
      "point spaced postal",
      (v) => {
        v.shippingPoint.postalCode = "M5V 1A1";
      },
    ],
    [
      "point invalid postal",
      (v) => {
        v.shippingPoint.postalCode = "D5V1A1";
      },
    ],
    [
      "point lowercase postal",
      (v) => {
        v.shippingPoint.postalCode = "m5v1a1";
      },
    ],
    [
      "deposit invalid site",
      (v) => {
        v.shippingPoint = { kind: "deposit", siteId: "abcd" };
      },
    ],
    [
      "deposit extra postal",
      (v) => {
        v.shippingPoint = {
          kind: "deposit",
          siteId: "A1B2",
          postalCode: "M5V1A1",
        };
      },
    ],
    [
      "missing services",
      (v) => {
        delete v.services;
      },
    ],
    [
      "services not array",
      (v) => {
        v.services = {};
      },
    ],
    [
      "empty services",
      (v) => {
        v.services = [];
      },
    ],
    [
      "21 services",
      (v) => {
        v.services = Array.from({ length: 21 }, (_, i) => ({
          service: `s${i}`,
          code: "DOM.RP",
        }));
      },
    ],
    [
      "duplicate service",
      (v) => {
        v.services[1].service = v.services[0].service;
      },
    ],
    [
      "missing service",
      (v) => {
        delete v.services[0].service;
      },
    ],
    [
      "trimmed service",
      (v) => {
        v.services[0].service = " service";
      },
    ],
    [
      "long service",
      (v) => {
        v.services[0].service = "s".repeat(101);
      },
    ],
    [
      "unsupported code",
      (v) => {
        v.services[0].code = "USA.EP";
      },
    ],
    [
      "null service",
      (v) => {
        v.services[0] = null;
      },
    ],
    [
      "array service",
      (v) => {
        v.services[0] = [];
      },
    ],
    [
      "service extra",
      (v) => {
        v.services[0].extra = true;
      },
    ],
    [
      "service secret",
      (v) => {
        v.services[0].clientSecret = "forbidden";
      },
    ],
    [
      "sparse services",
      (v) => {
        delete v.services[0];
      },
    ],
    [
      "array extra",
      (v) => {
        v.services.extra = true;
      },
    ],
  ];
  for (const [name, change] of changes)
    await t.test(name, () => {
      const value: Json = structuredClone(f.binding);
      change(value);
      assert.throws(() => captureCanadaPostAccountBinding(value), {
        code: "CARRIER_CONFIG",
      });
    });
  for (const value of [null, [], "text", 1, new Date()])
    assert.throws(() => captureCanadaPostAccountBinding(value), {
      code: "CARRIER_CONFIG",
    });
  for (const target of ["root", "point", "service", "array"]) {
    const value: Json = structuredClone(f.binding);
    const obj =
      target === "root"
        ? value
        : target === "point"
          ? value.shippingPoint
          : target === "service"
            ? value.services[0]
            : value.services;
    const key =
      target === "root"
        ? "orgId"
        : target === "point"
          ? "kind"
          : target === "service"
            ? "code"
            : "0";
    let invoked = false;
    Object.defineProperty(obj, key, {
      enumerable: true,
      get() {
        invoked = true;
        throw Error("getter invoked");
      },
    });
    assert.throws(() => captureCanadaPostAccountBinding(value), {
      code: "CARRIER_CONFIG",
    });
    assert.equal(invoked, false);
  }
  for (const target of ["root", "point", "service", "array"]) {
    let value: Json = structuredClone(f.binding);
    let invoked = false;
    const wrap = (obj: object) =>
      new Proxy(obj, {
        getPrototypeOf() {
          invoked = true;
          throw Error("proxy trap invoked");
        },
        getOwnPropertyDescriptor() {
          invoked = true;
          throw Error("proxy trap invoked");
        },
        ownKeys() {
          invoked = true;
          throw Error("proxy trap invoked");
        },
        get() {
          invoked = true;
          throw Error("proxy trap invoked");
        },
      });
    if (target === "root") value = wrap(value);
    else if (target === "point")
      value.shippingPoint = wrap(value.shippingPoint);
    else if (target === "service") value.services[0] = wrap(value.services[0]);
    else value.services = wrap(value.services);
    assert.throws(() => captureCanadaPostAccountBinding(value), {
      code: "CARRIER_CONFIG",
    });
    assert.equal(invoked, false);
  }
  const max = {
    ...f.binding,
    orgId: "o".repeat(128),
    warehouseId: "w".repeat(128),
    customerNumber: "1".repeat(10),
    contractId: "2".repeat(10),
    company: "c".repeat(44),
    services: Array.from({ length: 20 }, (_, i) => ({
      service: `s${i}`,
      code: "DOM.RP" as const,
    })),
  };
  assert.deepEqual(captureCanadaPostAccountBinding(max), max);
});

test("binding hash retains service order and legacy extra fields without admitting them as historical descriptors", (t) => {
  const f = fixture(t),
    never: typeof fetch = async () => {
      throw Error("transport called");
    };
  assert.equal(canadaPostConfigurationHash(f.config), f.hash);
  assert.equal(
    canadaPostConfigurationHash({
      ...f.config,
      clientSecret: "rotation",
      clientId: "rotation",
    } as CanadaPostTestConfig),
    f.hash,
  );
  const reversed = {
    ...f.binding,
    services: [...f.binding.services].reverse(),
  };
  assert.notEqual(canadaPostConfigurationHash(reversed), f.hash);
  assert.notEqual(
    new CanadaPostTestClient(
      { ...f.config, services: reversed.services },
      never,
    ).configurationHash,
    f.hash,
  );
  for (const extra of [
    { ...f.config, legacyField: "retained" },
    {
      ...f.config,
      shippingPoint: { ...f.config.shippingPoint, legacyField: "retained" },
    },
    {
      ...f.config,
      services: f.config.services.map((s) => ({
        ...s,
        legacyField: "retained",
      })),
    },
  ]) {
    const { clientId: _id, clientSecret: _secret, ...historical } = extra;
    const expected = digest(canonical(historical));
    assert.equal(
      new CanadaPostTestClient(extra, never).configurationHash,
      expected,
    );
    assert.notEqual(expected, f.hash);
    assert.throws(() => captureCanadaPostAccountBinding(historical), {
      code: "CARRIER_CONFIG",
    });
  }
});

test("detached captures and reviews preserve earlier results across input and output mutation", (t) => {
  const f = fixture(t),
    binding = captureCanadaPostAccountBinding(f.binding);
  const earlier = reviewCanadaPostShipment(binding, f.intent, groupId),
    frozen = structuredClone(earlier);
  const later = reviewCanadaPostShipment(binding, f.intent, groupId);
  later.body.deliverySpec.sender.addressDetails.addressLine1 = "changed output";
  later.body.deliverySpec.parcelCharacteristics.dimensions.width = 99;
  f.intent.origin.line1 = "changed input";
  f.intent.parcel.widthMm = 999;
  f.binding.services[1]!.service = "changed";
  f.binding.company = "changed";
  assert.deepEqual(earlier, frozen);
  assert.equal(canadaPostConfigurationHash(binding), f.hash);
  assert.throws(() => {
    binding.shippingPoint.kind = "deposit";
  }, TypeError);
  assert.throws(() => {
    (binding.services[0] as Json).code = "DOM.PC";
  }, TypeError);
  const observation = { tracking, status: "created" as const };
  const first = captureCanadaPostShipmentDetails(
    binding,
    earlier,
    observation,
    f.details,
  );
  const second = captureCanadaPostShipmentDetails(
    binding,
    earlier,
    observation,
    f.details,
  );
  observation.tracking = "11111111111";
  f.details.trackingPin = "11111111111";
  second.tracking = "22222222222";
  assert.deepEqual(first, {
    tracking,
    status: "created",
    groupId,
    customerRequestId: f.ref,
  });
});

test("native intent identity, reviewed hash and ordinary domestic bounds fail closed", async (t) => {
  const f = fixture(t);
  const cases: [string, (v: Json) => void, string][] = [
    [
      "provider",
      (v) => {
        v.provider = "ups";
      },
      "CARRIER_MISMATCH",
    ],
    [
      "org",
      (v) => {
        v.nativeSnapshot.org_id = "foreign";
      },
      "CARRIER_MISMATCH",
    ],
    [
      "site",
      (v) => {
        v.nativeSnapshot.warehouse_id = "foreign";
      },
      "CARRIER_MISMATCH",
    ],
    [
      "shipment",
      (v) => {
        v.nativeSnapshot.id = "foreign";
      },
      "CARRIER_MISMATCH",
    ],
    [
      "booking",
      (v) => {
        v.bookingId = "";
      },
      "CARRIER_MISMATCH",
    ],
    [
      "service",
      (v) => {
        v.service = "Unmapped";
      },
      "CARRIER_UNSUPPORTED",
    ],
    [
      "origin country",
      (v) => {
        v.origin.country = "US";
      },
      "CARRIER_UNSUPPORTED",
    ],
    [
      "destination country",
      (v) => {
        v.destination.country = "US";
      },
      "CARRIER_UNSUPPORTED",
    ],
    [
      "name length",
      (v) => {
        v.origin.name = "x".repeat(45);
      },
      "CARRIER_UNSUPPORTED",
    ],
    [
      "line1 length",
      (v) => {
        v.destination.line1 = "x".repeat(45);
      },
      "CARRIER_UNSUPPORTED",
    ],
    [
      "line2 type",
      (v) => {
        v.destination.line2 = null;
      },
      "CARRIER_UNSUPPORTED",
    ],
    [
      "city",
      (v) => {
        v.destination.city = "x".repeat(41);
      },
      "CARRIER_UNSUPPORTED",
    ],
    [
      "province",
      (v) => {
        v.destination.province = "XX";
      },
      "CARRIER_UNSUPPORTED",
    ],
    [
      "postal",
      (v) => {
        v.destination.postalCode = "D1A1A1";
      },
      "CARRIER_UNSUPPORTED",
    ],
    [
      "phone",
      (v) => {
        v.origin.phone = "12345";
      },
      "CARRIER_UNSUPPORTED",
    ],
    [
      "pickup origin",
      (v) => {
        v.origin.postalCode = "K1A 0B1";
      },
      "CARRIER_MISMATCH",
    ],
    [
      "weight zero",
      (v) => {
        v.parcel.weightGrams = 0;
      },
      "CARRIER_UNSUPPORTED",
    ],
    [
      "weight limit",
      (v) => {
        v.parcel.weightGrams = 30001;
      },
      "CARRIER_UNSUPPORTED",
    ],
    [
      "fraction dimension",
      (v) => {
        v.parcel.widthMm = 1.5;
      },
      "CARRIER_UNSUPPORTED",
    ],
    [
      "longest dimension",
      (v) => {
        v.parcel.lengthMm = 2001;
      },
      "CARRIER_UNSUPPORTED",
    ],
    [
      "girth",
      (v) => {
        v.parcel = {
          weightGrams: 1,
          lengthMm: 1000,
          widthMm: 501,
          heightMm: 501,
        };
      },
      "CARRIER_UNSUPPORTED",
    ],
  ];
  for (const [name, change, code] of cases)
    await t.test(name, () => {
      const intent = structuredClone(f.intent);
      change(intent);
      assert.throws(
        () => reviewCanadaPostShipment(f.binding, rehash(intent), groupId),
        { code },
      );
    });
  for (const key of ["account_id", "order_id", "lines", "units", "address"]) {
    const intent = structuredClone(f.intent);
    (intent.nativeSnapshot as Json)[key] = "changed";
    assert.throws(() => reviewCanadaPostShipment(f.binding, intent, groupId), {
      code: "CARRIER_MISMATCH",
    });
  }
  for (const invalid of ["", "a".repeat(33), "group/other"])
    assert.throws(
      () => reviewCanadaPostShipment(f.binding, f.intent, invalid),
      { code: "CARRIER_UNSUPPORTED" },
    );
  const atBound = rehash({
    ...f.intent,
    parcel: { weightGrams: 30000, lengthMm: 2000, widthMm: 250, heightMm: 250 },
  });
  assert.equal(
    reviewCanadaPostShipment(f.binding, atBound, groupId).body.deliverySpec
      .parcelCharacteristics.weight,
    30,
  );
  // These helpers cannot compare against the live owning shipment. A coherently
  // rehashed account change is not authenticated by passing a structural check.
  const changed = structuredClone(f.intent);
  changed.nativeSnapshot.account_id = "other";
  assert.doesNotThrow(() =>
    reviewCanadaPostShipment(f.binding, rehash(changed), groupId),
  );
});

for (const pickup of [true, false])
  test(`detail comparison preserves ${pickup ? "pickup" : "deposit"} restrictions and malformed nesting refusal`, async (t) => {
    const f = fixture(t, pickup),
      binding = captureCanadaPostAccountBinding(f.binding),
      review = reviewCanadaPostShipment(binding, f.intent, groupId);
    const cases: [string, (v: Json) => void][] = [
      [
        "request ID",
        (v) => {
          v.customerRequestId = "wrong";
        },
      ],
      [
        "tracking",
        (v) => {
          v.trackingPin = "11111111111";
        },
      ],
      [
        "status",
        (v) => {
          v.shipmentStatus = "transmitted";
        },
      ],
      [
        "group",
        (v) => {
          v.shipmentDetail.groupId = "other";
        },
      ],
      [
        "transmitShipment false",
        (v) => {
          v.shipmentDetail.transmitShipment = false;
        },
      ],
      [
        "service",
        (v) => {
          v.shipmentDetail.deliverySpec.serviceCode = "DOM.EP";
        },
      ],
      [
        "sender company",
        (v) => {
          v.shipmentDetail.deliverySpec.sender.company = "other";
        },
      ],
      [
        "sender phone",
        (v) => {
          v.shipmentDetail.deliverySpec.sender.contactPhone = "1111111111";
        },
      ],
      [
        "destination name",
        (v) => {
          v.shipmentDetail.deliverySpec.destination.name = "other";
        },
      ],
      [
        "destination phone",
        (v) => {
          v.shipmentDetail.deliverySpec.destination.clientVoiceNumber =
            "1111111111";
        },
      ],
      [
        "extra recipient",
        (v) => {
          v.shipmentDetail.deliverySpec.recipient = {};
        },
      ],
      [
        "weight",
        (v) => {
          v.shipmentDetail.deliverySpec.parcelCharacteristics.weight = 2;
        },
      ],
      [
        "dimensions",
        (v) => {
          v.shipmentDetail.deliverySpec.parcelCharacteristics.dimensions.width = 20;
        },
      ],
      [
        "references",
        (v) => {
          v.shipmentDetail.deliverySpec.references.customerRef1 = "wrong";
        },
      ],
      [
        "account",
        (v) => {
          v.shipmentDetail.deliverySpec.settlementInfo.paidByCustomer =
            "7654321";
        },
      ],
      [
        "contract",
        (v) => {
          v.shipmentDetail.deliverySpec.settlementInfo.contractId = "654321";
        },
      ],
      [
        "payment",
        (v) => {
          v.shipmentDetail.deliverySpec.settlementInfo.intendedMethodOfPayment =
            "CreditCard";
        },
      ],
      [
        "customs",
        (v) => {
          v.shipmentDetail.deliverySpec.customs = {};
        },
      ],
      [
        "notification",
        (v) => {
          v.shipmentDetail.deliverySpec.notification = {};
        },
      ],
      [
        "options",
        (v) => {
          v.shipmentDetail.deliverySpec.options = [{}];
        },
      ],
      [
        "options null",
        (v) => {
          v.shipmentDetail.deliverySpec.options = null;
        },
      ],
      [
        "returnSpec",
        (v) => {
          v.shipmentDetail.returnSpec = {};
        },
      ],
      [
        "quickshipLabelRequested",
        (v) => {
          v.shipmentDetail.quickshipLabelRequested = false;
        },
      ],
      [
        "shipmentDetail null",
        (v) => {
          v.shipmentDetail = null;
        },
      ],
      [
        "shipmentDetail array",
        (v) => {
          v.shipmentDetail = [];
        },
      ],
      [
        "deliverySpec null",
        (v) => {
          v.shipmentDetail.deliverySpec = null;
        },
      ],
      [
        "deliverySpec array",
        (v) => {
          v.shipmentDetail.deliverySpec = [];
        },
      ],
      [
        "sender null",
        (v) => {
          v.shipmentDetail.deliverySpec.sender = null;
        },
      ],
      [
        "destination array",
        (v) => {
          v.shipmentDetail.deliverySpec.destination = [];
        },
      ],
      [
        "parcel null",
        (v) => {
          v.shipmentDetail.deliverySpec.parcelCharacteristics = null;
        },
      ],
      [
        "parcel array",
        (v) => {
          v.shipmentDetail.deliverySpec.parcelCharacteristics = [];
        },
      ],
      [
        "settlement null",
        (v) => {
          v.shipmentDetail.deliverySpec.settlementInfo = null;
        },
      ],
      [
        "references null",
        (v) => {
          v.shipmentDetail.deliverySpec.references = null;
        },
      ],
    ];
    for (const flag of ["unpackaged", "mailingTube", "oversized"])
      cases.push([
        flag,
        (v) => {
          v.shipmentDetail.deliverySpec.parcelCharacteristics[flag] = true;
        },
      ]);
    for (const who of ["sender", "destination"]) {
      for (const field of [
        "addressLine1",
        "city",
        "provState",
        "countryCode",
        "postalZipCode",
        "addressLine2",
      ])
        cases.push([
          who + " " + field,
          (v) => {
            v.shipmentDetail.deliverySpec[who].addressDetails[field] = "other";
          },
        ]);
      cases.push([
        who + " extra info",
        (v) => {
          v.shipmentDetail.deliverySpec[who].additionalAddressInfo = "other";
        },
      ]);
    }
    cases.push([
      "destination extra company",
      (v) => {
        v.shipmentDetail.deliverySpec.destination.company = "other";
      },
    ]);
    if (pickup)
      cases.push(
        [
          "pickup flag",
          (v) => {
            v.cpcPickupIndicator = false;
          },
        ],
        [
          "pickup point",
          (v) => {
            v.finalShippingPoint = "K1A0B1";
          },
        ],
        [
          "pickup deposit",
          (v) => {
            v.shippingPointId = "A1B2";
          },
        ],
      );
    else
      cases.push(
        [
          "deposit site",
          (v) => {
            v.shippingPointId = "ZZZZ";
          },
        ],
        [
          "deposit pickup",
          (v) => {
            v.cpcPickupIndicator = false;
          },
        ],
      );
    for (const [name, change] of cases)
      await t.test(name, () => {
        const detail: Json = structuredClone(f.details);
        change(detail);
        assert.throws(
          () =>
            captureCanadaPostShipmentDetails(
              binding,
              review,
              { tracking, status: "created" },
              detail,
            ),
          { code: "CARRIER_RESULT" },
        );
      });
    for (const value of [null, [], "text", 1])
      assert.throws(
        () =>
          captureCanadaPostShipmentDetails(
            binding,
            review,
            { tracking, status: "created" },
            value,
          ),
        { code: "CARRIER_RESULT" },
      );
    const benign: Json = structuredClone(f.details),
      spec = benign.shipmentDetail.deliverySpec;
    spec.destination.company = "";
    spec.destination.additionalAddressInfo = "";
    spec.destination.addressDetails.addressLine2 = "";
    spec.recipient = structuredClone(spec.destination);
    spec.options = [];
    for (const flag of ["unpackaged", "mailingTube", "oversized"])
      spec.parcelCharacteristics[flag] = false;
    benign.providerMetadata =
      "Existing subset matcher permits unrelated metadata";
    assert.doesNotThrow(() =>
      captureCanadaPostShipmentDetails(
        binding,
        review,
        { tracking, status: "created" },
        benign,
      ),
    );
    benign.shipmentStatus = "transmitted";
    assert.equal(
      captureCanadaPostShipmentDetails(
        binding,
        review,
        { tracking, status: "transmitted" },
        benign,
      ).status,
      "transmitted",
    );
    for (const observation of [
      { tracking: "bad", status: "created" },
      { tracking, status: "voided" },
    ])
      assert.throws(
        () =>
          captureCanadaPostShipmentDetails(
            binding,
            review,
            observation as any,
            benign,
          ),
        { code: "CARRIER_RESULT" },
      );
  });

test("legacy accepted metadata keeps constructor-captured request identity despite later caller mutation", async (t) => {
  const f = fixture(t),
    legacy = { ...f.config, annotation: { revision: 1 } };
  const { clientId: _id, clientSecret: _secret, ...nonsecret } = legacy;
  const expectedHash = digest(canonical(nonsecret));
  const expectedRef =
    "D" +
    digest(
      canonical({
        configurationHash: expectedHash,
        bookingId: f.intent.bookingId,
        reviewHash: f.intent.reviewHash,
        groupId,
      }),
    )
      .slice(0, 31)
      .toUpperCase();
  const expectedBody = structuredClone(f.body);
  expectedBody.customerRequestId = expectedRef;
  expectedBody.deliverySpec.references.customerRef1 = expectedRef;
  let guards = 0,
    writes = 0;
  const client = new CanadaPostTestClient(legacy, async (url, init) => {
    if (String(url).endsWith("/oauth2/token")) {
      f.intent.origin.line1 = "changed during await";
      return new Response(
        JSON.stringify({
          token_type: "Bearer",
          access_token: "synthetic-token",
          expires_in: 3600,
          scope: "merchant",
        }),
        { headers: { "content-type": "application/json" } },
      );
    }
    assert.equal(String(url), path);
    assert.equal(guards, 1);
    assert.equal(init!.body, JSON.stringify(expectedBody));
    writes++;
    throw Error("synthetic lost reply");
  });
  legacy.annotation.revision = 2;
  assert.equal(client.configurationHash, expectedHash);
  assert.notEqual(canadaPostConfigurationHash(legacy), expectedHash);
  await assert.rejects(
    client.create(f.intent, groupId, () => {
      guards++;
    }),
    { code: "CARRIER_TRANSPORT" },
  );
  assert.equal(writes, 1);
  assert.equal(guards, 1);
});
