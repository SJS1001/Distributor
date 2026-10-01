import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fixture, accept, chooseProviders } from "./fixtures.ts";
import { canonical, digest } from "../src/server/core.ts";
import { Application } from "../src/server/application.ts";
import {
  UpsSandbox,
  type UpsSandboxConfig,
} from "../src/server/ups-sandbox.ts";
import { CarrierRuntime } from "../src/server/carrier-runtime.ts";
import { createHttp } from "../src/server/http.ts";
import type { CarrierIntent } from "../src/server/carrier-bookings.ts";
import type {
  CarrierPrepare,
  CarrierAddress,
} from "../src/shared/carrier-booking.ts";

const tracking = "1Z1234567890123456";
// Original synthetic one-pixel GIF fixture; no vendor label/sample copied.
const gif = Buffer.from(
  "47494638396101000100800000000000ffffff2c00000000010001000002024401003b",
  "hex",
);
const ca: CarrierAddress = {
  name: "Synthetic warehouse",
  line1: "1 Test Street",
  line2: "",
  city: "Toronto",
  province: "ON",
  postalCode: "M5V 1A1",
  country: "CA",
  phone: "+1 (416) 555-0100",
};
const us: CarrierAddress = {
  ...ca,
  city: "Buffalo",
  province: "NY",
  postalCode: "14201",
  country: "US",
};
function setup(
  t: Parameters<typeof fixture>[0],
  country: "US" | "CA" = "CA",
  secondSite = false,
) {
  const f = fixture(t, {}, country);
  if (secondSite) {
    const unit = f.app.inventory.trace(f.actor, "S1").unit;
    const transfer = f.app.inventory.dispatchTransfer(f.actor, "ups-transfer", {
      unitId: unit.id,
      quantity: 1,
      revision: unit.revision,
      destinationId: f.w2,
      reason: "Synthetic second origin stock",
    });
    f.app.inventory.receiveTransfer(f.actor, "ups-arrival", {
      transferId: transfer.id,
      lineId: transfer.lineId,
      quantity: 1,
      serial: "S1",
      receiptRef: "UPS-SYNTHETIC-TRANSFER",
      bin: "B-1",
      condition: "usable",
      reason: "Synthetic receiving evidence",
    });
  }
  const orderId = accept(secondSite ? { ...f, w1: f.w2 } : f).id;
  chooseProviders(f, f.actor, "ups-choice", {
    accountId: f.buyer,
    region: country,
    mode: "provider-exceptions",
    providers: ["ups"],
    version: 1,
    acknowledgment: "Synthetic reviewed UPS processing exception",
  });
  const picks = f.app.fulfillment.picks(f.actor, orderId);
  for (const pick of picks)
    f.app.fulfillment.pick(f.actor, `ups-pick-${pick.id}`, {
      orderId,
      allocationId: pick.id,
      serial: pick.serial,
    });
  const firstOrigin = country === "CA" ? ca : us;
  const origin = secondSite
    ? {
        ...firstOrigin,
        line1: "4 Second Warehouse Street",
        city: country === "CA" ? "Ottawa" : "Rochester",
        postalCode: country === "CA" ? "K1A 0B1" : "14604",
      }
    : firstOrigin;
  const destination = {
    ...origin,
    name: "Synthetic receiver",
    line1: "2 Test Street",
  };
  const address = "Synthetic reviewed packed destination";
  const shipmentId = f.app.fulfillment.pack(f.actor, "ups-pack", {
    orderId,
    revision: f.app.orders.order(f.actor, orderId).revision,
    mode: "carrier",
    address,
    lines: picks.map((pick) => ({
      allocationId: pick.id,
      quantity: pick.quantity,
    })),
  }).id;
  const input: CarrierPrepare = {
    shipmentId,
    previousId: null,
    provider: "ups",
    service: "Reviewed ground",
    origin,
    destination,
    parcel: { weightGrams: 1234, lengthMm: 101, widthMm: 202, heightMm: 303 },
    reviewedDestination: address,
    acknowledgment: "Synthetic actual origin and packed destination review",
  };
  const prepared = f.app.carriers.prepare(f.actor, "ups-prepare", input);
  const intent = JSON.parse(
    f.app.database
      .owned("integration")
      .get<{ intent: string }>(
        "SELECT intent FROM integration_carrier_bookings WHERE id=?",
        prepared.id,
      )!.intent,
  ) as CarrierIntent;
  const config: UpsSandboxConfig = {
    orgId: f.actor.orgId,
    clientId: "synthetic-ups-client",
    clientSecret: "synthetic-ups-secret",
    shipperNumber: "A1B2C3",
    shipper: { ...origin, line1: "3 Registered Account Street" },
    services: [{ service: "Reviewed ground", code: "03" }],
  };
  return Object.assign(f, {
    orderId,
    shipmentId,
    prepared,
    input,
    intent,
    config,
  });
}
type F = ReturnType<typeof setup>;
function native(f: F) {
  return {
    stock: f.app.inventory.stock(f.actor),
    order: f.app.orders.order(f.actor, f.orderId),
    invoices: f.app.billing.invoices(f.actor),
    shipment: f.app.fulfillment.shipment(f.actor, f.shipmentId),
  };
}
function revise(intent: CarrierIntent, change: Partial<CarrierIntent>) {
  const changed = { ...intent, ...change },
    { bookingId, reviewHash: _old, ...review } = changed;
  return { ...review, bookingId, reviewHash: digest(canonical(review)) };
}
type Json = Record<string, any>;
type Call = { url: URL; init: RequestInit; body: Json | string | undefined };
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
function simulator(
  options: {
    loseShipping?: boolean;
    tokenHook?: () => void;
    shipping?: (body: Json) => unknown;
    tracking?: (body: Json) => unknown;
    recovery?: (body: Json) => unknown;
    raw?: (call: Call) => Response | undefined;
  } = {},
) {
  const calls: Call[] = [];
  let saved: { context: string; reference: string } | undefined;
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://wwwcie.ups.com");
    assert.equal(init!.redirect, "error");
    assert.ok(init!.signal instanceof AbortSignal);
    const body =
      typeof init!.body === "string"
        ? init!.body.startsWith("{")
          ? JSON.parse(init!.body)
          : init!.body
        : undefined;
    const call = { url, init: init!, body };
    calls.push(call);
    const raw = options.raw?.(call);
    if (raw) return raw;
    if (url.pathname === "/security/v1/oauth/token") {
      assert.equal(init!.method, "POST");
      options.tokenHook?.();
      return json({
        token_type: "Bearer",
        access_token: "synthetic-token",
        expires_in: "14399",
      });
    }
    assert.equal(
      (init!.headers as Record<string, string>).authorization,
      "Bearer synthetic-token",
    );
    if (url.pathname === "/api/shipments/v2409/ship") {
      assert.equal(init!.method, "POST");
      const request = (body as Json).ShipmentRequest;
      saved = {
        context: request.Request.TransactionReference.CustomerContext,
        reference: (
          request.Shipment.ReferenceNumber ??
          request.Shipment.Package.ReferenceNumber
        ).Value,
      };
      if (options.loseShipping)
        throw new Error(
          "Synthetic committed response lost; private provider detail",
        );
      const response = {
        ShipmentResponse: {
          Response: {
            ResponseStatus: { Code: "1" },
            TransactionReference: { CustomerContext: saved.context },
          },
          ShipmentResults: {
            ShipmentIdentificationNumber: tracking,
            PackageResults: [
              {
                TrackingNumber: tracking,
                ShippingLabel: {
                  ImageFormat: { Code: "GIF" },
                  GraphicImage: gif.toString("base64"),
                },
              },
            ],
          },
        },
      };
      return json(options.shipping ? options.shipping(response) : response);
    }
    if (url.pathname.startsWith("/api/track/v1/reference/details/")) {
      assert.equal(init!.method, "GET");
      assert.equal(body, undefined);
      const reference = url.pathname.split("/").at(-1);
      if (saved) assert.equal(reference, saved.reference);
      const response = {
        trackResponse: {
          shipment: [
            {
              package: [
                {
                  trackingNumber: tracking,
                  packageCount: 1,
                  referenceNumber: [{ number: reference, type: "SHIPMENT" }],
                },
              ],
            },
          ],
        },
      };
      return json(options.tracking ? options.tracking(response) : response);
    }
    if (url.pathname === "/api/labels/v1903/recovery") {
      assert.equal(init!.method, "POST");
      const request = (body as Json).LabelRecoveryRequest;
      if (saved) {
        assert.equal(
          request.ReferenceValues.ReferenceNumber.Value,
          saved.reference,
        );
        assert.equal(
          request.Request.TransactionReference.CustomerContext,
          saved.context,
        );
      }
      const response = {
        LabelRecoveryResponse: {
          Response: {
            ResponseStatus: { Code: "1" },
            TransactionReference: {
              CustomerContext:
                request.Request.TransactionReference.CustomerContext,
            },
          },
          LabelResults: [
            {
              TrackingNumber: tracking,
              LabelImage: {
                LabelImageFormat: { Code: "GIF" },
                GraphicImage: gif.toString("base64"),
              },
            },
          ],
        },
      };
      return json(options.recovery ? options.recovery(response) : response);
    }
    throw new Error(`Unexpected synthetic endpoint ${url.pathname}`);
  };
  return { calls, transport };
}

for (const country of ["CA", "US"] as const)
  test(`UPS maps reviewed ${country} origin, account, service and exact integer units before one guard`, async (t) => {
    const f = setup(t, country),
      sim = simulator(),
      before = native(f);
    const client = new UpsSandbox(f.config, sim.transport);
    f.config.shipper.line1 = "Changed caller address";
    f.config.services[0]!.code = "02";
    let guards = 0;
    const result = await client.book(f.intent, () => {
      guards++;
      assert.equal(sim.calls.length, 1);
      assert.equal(sim.calls[0]!.url.pathname, "/security/v1/oauth/token");
    });
    assert.equal(guards, 1);
    assert.equal(sim.calls.length, 2);
    const oauth = sim.calls[0]!,
      call = sim.calls[1]!,
      request = (call.body as Json).ShipmentRequest;
    assert.equal(oauth.body, "grant_type=client_credentials");
    assert.equal(
      (oauth.init.headers as Json).authorization,
      "Basic " +
        Buffer.from("synthetic-ups-client:synthetic-ups-secret").toString(
          "base64",
        ),
    );
    assert.equal((oauth.init.headers as Json)["x-merchant-id"], "A1B2C3");
    assert.equal(request.Request.RequestOption, "validate");
    assert.equal(request.Shipment.Shipper.ShipperNumber, "A1B2C3");
    assert.deepEqual(request.Shipment.Shipper.Address.AddressLine, [
      "3 Registered Account Street",
    ]);
    assert.deepEqual(request.Shipment.ShipFrom.Address.AddressLine, [
      "1 Test Street",
    ]);
    assert.deepEqual(request.Shipment.ShipTo.Address.AddressLine, [
      "2 Test Street",
    ]);
    assert.equal(request.Shipment.ShipFrom.Address.CountryCode, country);
    assert.equal(request.Shipment.ShipFrom.Phone.Number, "14165550100");
    assert.deepEqual(request.Shipment.Service, { Code: "03" });
    assert.deepEqual(request.Shipment.PaymentInformation, {
      ShipmentCharge: { Type: "01", BillShipper: { AccountNumber: "A1B2C3" } },
    });
    assert.deepEqual(request.Shipment.Package.Dimensions, {
      UnitOfMeasurement: { Code: "CM" },
      Length: "10.1",
      Width: "20.2",
      Height: "30.3",
    });
    assert.deepEqual(request.Shipment.Package.PackageWeight, {
      UnitOfMeasurement: { Code: "KGS" },
      Weight: "1.234",
    });
    assert.equal(request.Shipment.Package.Packaging.Code, "02");
    assert.equal(request.LabelSpecification.LabelImageFormat.Code, "GIF");
    const ref =
      country === "CA"
        ? request.Shipment.ReferenceNumber
        : request.Shipment.Package.ReferenceNumber;
    assert.deepEqual(ref, { Value: result.reference });
    assert.equal(
      country === "CA"
        ? request.Shipment.Package.ReferenceNumber
        : request.Shipment.ReferenceNumber,
      undefined,
    );
    assert.match(result.reference, /^D[A-F0-9]{34}$/);
    assert.equal(result.tracking, tracking);
    assert.equal(result.bookingId, f.prepared.id);
    assert.equal(result.reviewHash, f.prepared.reviewHash);
    assert.deepEqual(result.label, { mediaType: "image/gif", bytes: gif });
    assert.deepEqual(native(f), before);
  });

for (const country of ["CA", "US"] as const)
  test(`UPS ${country} second warehouse uses reviewed physical origin and retains native stock until handover`, async (t) => {
    const f = setup(t, country, true),
      sim = simulator(),
      before = native(f);
    assert.equal(f.intent.nativeSnapshot.warehouse_id, f.w2);
    await f.app.carriers.execute(
      f.actor,
      f.prepared.id,
      new UpsSandbox(f.config, sim.transport),
    );
    const shipment = (sim.calls[1]!.body as Json).ShipmentRequest.Shipment;
    assert.deepEqual(shipment.ShipFrom.Address.AddressLine, [
      "4 Second Warehouse Street",
    ]);
    assert.equal(
      shipment.ShipFrom.Address.City,
      country === "CA" ? "Ottawa" : "Rochester",
    );
    assert.deepEqual(shipment.Shipper.Address.AddressLine, [
      "3 Registered Account Street",
    ]);
    assert.deepEqual(native(f), before);
    f.app.fulfillment.commit(f.actor, "ups-second-handover", {
      shipmentId: f.shipmentId,
      carrier: "ups",
      tracking,
      handoverEvidence: "Synthetic separately scanned second-site custody",
    });
    assert.equal(f.app.inventory.trace(f.actor, "S1").unit.warehouse_id, f.w2);
    assert.equal(f.app.inventory.trace(f.actor, "S1").unit.state, "sold");
    assert.equal(f.app.billing.invoices(f.actor).length, 1);
    assert.equal(sim.calls.length, 2);
  });

test("UPS refuses changed review/org/service/cross-border/parcel before any network request", async (t) => {
  const f = setup(t),
    sim = simulator(),
    client = new UpsSandbox(f.config, sim.transport);
  const bad = [
    { ...f.intent, reviewHash: "0".repeat(64) },
    revise(f.intent, {
      nativeSnapshot: { ...f.intent.nativeSnapshot, org_id: "another-org" },
    }),
    revise(f.intent, { shipmentId: "another-shipment" }),
    revise(f.intent, { service: "Ground" }),
    revise(f.intent, { destination: us }),
    revise(f.intent, { origin: us, destination: us }),
    revise(f.intent, { parcel: { ...f.intent.parcel, weightGrams: 68_001 } }),
    revise(f.intent, { parcel: { ...f.intent.parcel, weightGrams: 1.2 } }),
    revise(f.intent, { parcel: { ...f.intent.parcel, lengthMm: 2_741 } }),
    revise(f.intent, {
      parcel: {
        ...f.intent.parcel,
        lengthMm: 2_000,
        widthMm: 900,
        heightMm: 900,
      },
    }),
    revise(f.intent, { origin: { ...ca, name: "x".repeat(36) } }),
    revise(f.intent, { destination: { ...ca, phone: "bad" } }),
  ];
  for (const intent of bad)
    await assert.rejects(() =>
      client.book(intent, () =>
        assert.fail("Must not guard a rejected intent"),
      ),
    );
  assert.equal(sim.calls.length, 0);
});

test("UPS configuration rejects unsafe/coerced account, service, credential and duplicates", (t) => {
  const f = setup(t),
    sim = simulator();
  const configs = [
    { ...f.config, shipperNumber: 123456 },
    { ...f.config, shipperNumber: "a1b2c3" },
    { ...f.config, clientId: "client:ambiguous" },
    { ...f.config, clientSecret: "secret\n" },
    { ...f.config, services: [{ service: "Reviewed ground", code: 65 }] },
    { ...f.config, services: [null] },
    { ...f.config, services: [] },
    { ...f.config, services: [{ service: "Reviewed ground", code: "99" }] },
    { ...f.config, services: [...f.config.services, ...f.config.services] },
  ];
  for (const config of configs)
    assert.throws(
      () => new UpsSandbox(config as UpsSandboxConfig, sim.transport),
      { code: "CARRIER_CONFIG" },
    );
  assert.equal(sim.calls.length, 0);
});

test("UPS recovery queries account/reference, verifies tracking and never purchases a second label", async (t) => {
  const f = setup(t),
    references: string[] = [];
  for (const [intent, config] of [
    [f.intent, f.config],
    [revise(f.intent, { bookingId: "another-booking" }), f.config],
    [
      revise(f.intent, { parcel: { ...f.intent.parcel, weightGrams: 2000 } }),
      f.config,
    ],
    [f.intent, { ...f.config, shipperNumber: "D4E5F6" }],
  ] as const) {
    const sim = simulator(),
      client = new UpsSandbox(config, sim.transport);
    const bought = await client.book(intent, () => {}),
      recovered = await client.lookup(intent);
    references.push(bought.reference);
    assert.deepEqual(recovered, bought);
    const query = sim.calls[3]!.url;
    assert.equal(query.searchParams.get("shipperNum"), config.shipperNumber);
    assert.equal(query.searchParams.get("destCountry"), "CA");
    assert.equal(query.searchParams.get("destZip"), "M5V1A1");
    assert.equal(query.searchParams.get("refNumType"), "SmallPackage");
    const recovery = (sim.calls[4]!.body as Json).LabelRecoveryRequest;
    assert.equal(recovery.ReferenceValues.ShipperNumber, config.shipperNumber);
    assert.equal(recovery.TrackingNumber, undefined);
    assert.equal(recovery.LabelDelivery, undefined);
    assert.equal(
      sim.calls.filter((c) => c.url.pathname.includes("/shipments/")).length,
      1,
    );
  }
  assert.equal(new Set(references).size, 4);
});

const shippingFailures: [string, (body: Json) => unknown][] = [
  [
    "status",
    (b) => {
      b.ShipmentResponse.Response.ResponseStatus.Code = "0";
      return b;
    },
  ],
  [
    "context",
    (b) => {
      b.ShipmentResponse.Response.TransactionReference.CustomerContext =
        "foreign-context";
      return b;
    },
  ],
  [
    "tracking",
    (b) => {
      b.ShipmentResponse.ShipmentResults.PackageResults[0].TrackingNumber =
        "https://foreign.test";
      return b;
    },
  ],
  [
    "shipment mismatch",
    (b) => {
      b.ShipmentResponse.ShipmentResults.ShipmentIdentificationNumber =
        "1Z6543210987654321";
      return b;
    },
  ],
  [
    "two parcels",
    (b) => {
      b.ShipmentResponse.ShipmentResults.PackageResults.push(
        b.ShipmentResponse.ShipmentResults.PackageResults[0],
      );
      return b;
    },
  ],
  [
    "empty parcels",
    (b) => {
      b.ShipmentResponse.ShipmentResults.PackageResults = [];
      return b;
    },
  ],
  [
    "format",
    (b) => {
      b.ShipmentResponse.ShipmentResults.PackageResults[0].ShippingLabel.ImageFormat.Code =
        "PDF";
      return b;
    },
  ],
  [
    "noncanonical base64",
    (b) => {
      b.ShipmentResponse.ShipmentResults.PackageResults[0].ShippingLabel.GraphicImage =
        "R0lG===\n";
      return b;
    },
  ],
  [
    "wrong signature",
    (b) => {
      b.ShipmentResponse.ShipmentResults.PackageResults[0].ShippingLabel.GraphicImage =
        Buffer.from("%PDF-synthetic").toString("base64");
      return b;
    },
  ],
  [
    "zero width",
    (b) => {
      const bytes = Buffer.from(gif);
      bytes.writeUInt16LE(0, 6);
      b.ShipmentResponse.ShipmentResults.PackageResults[0].ShippingLabel.GraphicImage =
        bytes.toString("base64");
      return b;
    },
  ],
  [
    "missing GIF trailer",
    (b) => {
      b.ShipmentResponse.ShipmentResults.PackageResults[0].ShippingLabel.GraphicImage =
        gif.subarray(0, -1).toString("base64");
      return b;
    },
  ],
  [
    "oversized label",
    (b) => {
      b.ShipmentResponse.ShipmentResults.PackageResults[0].ShippingLabel.GraphicImage =
        Buffer.alloc(1_048_577).toString("base64");
      return b;
    },
  ],
];
for (const [name, shipping] of shippingFailures)
  test(`UPS rejects ${name} result without a second shipment write`, async (t) => {
    const f = setup(t),
      sim = simulator({ shipping });
    await assert.rejects(
      () => new UpsSandbox(f.config, sim.transport).book(f.intent, () => {}),
      { code: "CARRIER_RESULT" },
    );
    assert.equal(sim.calls.length, 2);
  });
const trackingFailures: [string, (body: Json) => unknown][] = [
  [
    "foreign reference",
    (b) => {
      b.trackResponse.shipment[0].package[0].referenceNumber[0].number =
        "another-reference";
      return b;
    },
  ],
  [
    "no references",
    (b) => {
      b.trackResponse.shipment[0].package[0].referenceNumber = [];
      return b;
    },
  ],
  [
    "missing package",
    (b) => {
      b.trackResponse.shipment[0].package = [];
      return b;
    },
  ],
  [
    "another shipment",
    (b) => {
      b.trackResponse.shipment.push(b.trackResponse.shipment[0]);
      return b;
    },
  ],
  [
    "another package",
    (b) => {
      b.trackResponse.shipment[0].package.push(
        b.trackResponse.shipment[0].package[0],
      );
      return b;
    },
  ],
  [
    "hidden second package",
    (b) => {
      b.trackResponse.shipment[0].package[0].packageCount = 2;
      return b;
    },
  ],
  [
    "malformed tracking",
    (b) => {
      b.trackResponse.shipment[0].package[0].trackingNumber = "bad";
      return b;
    },
  ],
];
for (const [name, trackingResult] of trackingFailures)
  test(`UPS recovery rejects ${name} before downloading a label`, async (t) => {
    const f = setup(t),
      sim = simulator({ tracking: trackingResult });
    await assert.rejects(
      () => new UpsSandbox(f.config, sim.transport).lookup(f.intent),
      { code: "CARRIER_RESULT" },
    );
    assert.equal(sim.calls.length, 2);
    assert.equal(sim.calls[1]!.init.method, "GET");
  });
for (const kind of [
  "foreign tracking",
  "candidates",
  "two labels",
  "foreign context",
] as const)
  test(`UPS label recovery rejects ${kind} despite reference query`, async (t) => {
    const f = setup(t),
      sim = simulator({
        recovery: (b) => {
          const r = b.LabelRecoveryResponse;
          if (kind === "foreign tracking")
            r.LabelResults[0].TrackingNumber = "1Z6543210987654321";
          if (kind === "candidates")
            r.TrackingCandidate = [{ TrackingNumber: tracking }];
          if (kind === "two labels") r.LabelResults.push(r.LabelResults[0]);
          if (kind === "foreign context")
            r.Response.TransactionReference.CustomerContext = "foreign-context";
          return b;
        },
      });
    await assert.rejects(
      () => new UpsSandbox(f.config, sim.transport).lookup(f.intent),
      { code: "CARRIER_RESULT" },
    );
    assert.equal(sim.calls.length, 3);
    assert.equal(
      sim.calls.filter((c) => c.url.pathname.includes("/shipments/")).length,
      0,
    );
  });

for (const kind of [
  "401",
  "429",
  "redirect",
  "wrong content type",
  "bad JSON",
  "oversized header",
  "oversized stream",
  "failed stream",
  "invalid token",
] as const)
  test(`UPS ${kind} is bounded/redacted and never retried`, async (t) => {
    const f = setup(t),
      sim = simulator({
        raw: (call) => {
          const token = call.url.pathname.includes("oauth");
          if (kind === "invalid token")
            return token
              ? json({
                  token_type: "Bearer",
                  access_token: "secret\n",
                  expires_in: "14399",
                })
              : undefined;
          if (token) return undefined;
          if (kind === "401" || kind === "429")
            return json({ secret: "must-not-escape" }, Number(kind));
          if (kind === "redirect")
            return new Response("must-not-escape", {
              status: 302,
              headers: { location: "https://foreign.test" },
            });
          if (kind === "wrong content type")
            return new Response("must-not-escape", {
              headers: { "content-type": "text/html" },
            });
          if (kind === "bad JSON")
            return new Response("must-not-escape", {
              headers: { "content-type": "application/json" },
            });
          if (kind === "oversized header")
            return new Response("{}", {
              headers: {
                "content-type": "application/json",
                "content-length": "2097153",
              },
            });
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              if (kind === "failed stream")
                controller.error(new Error("must-not-escape"));
              else {
                controller.enqueue(new Uint8Array(2_097_153));
                controller.close();
              }
            },
          });
          return new Response(stream, {
            headers: { "content-type": "application/json" },
          });
        },
      });
    await assert.rejects(
      () => new UpsSandbox(f.config, sim.transport).book(f.intent, () => {}),
      (error: any) => {
        assert.equal(
          error.code,
          kind === "invalid token" ? "CARRIER_RESULT" : "CARRIER_TRANSPORT",
        );
        assert.doesNotMatch(
          error.message,
          /must-not-escape|secret|foreign\.test/,
        );
        return true;
      },
    );
    assert.equal(sim.calls.length, kind === "invalid token" ? 1 : 2);
  });

test("UPS lost successful response survives restart, recovers exact reference without resend and requires native handover", async (t) => {
  const f = setup(t),
    before = native(f),
    sim = simulator({ loseShipping: true });
  const client = new UpsSandbox(f.config, sim.transport);
  await assert.rejects(
    () => f.app.carriers.execute(f.actor, f.prepared.id, client),
    { code: "CARRIER_TRANSPORT" },
  );
  assert.equal(
    f.app.carriers.review(f.actor, f.shipmentId).booking!.state,
    "unknown",
  );
  assert.deepEqual(native(f), before);
  f.app.close();
  f.app = new Application(f.path, "CA");
  const restarted = new UpsSandbox(f.config, sim.transport);
  await assert.rejects(
    () => f.app.carriers.execute(f.actor, f.prepared.id, restarted),
    { code: "STATE" },
  );
  const recovered = await f.app.carriers.reconcile(
    f.actor,
    f.prepared.id,
    restarted,
  );
  assert.equal(recovered.state, "booked");
  assert.equal(recovered.tracking, tracking);
  assert.equal(
    sim.calls.filter((c) => c.url.pathname.includes("/shipments/")).length,
    1,
  );
  assert.deepEqual(f.app.carriers.label(f.actor, f.prepared.id).bytes, gif);
  assert.deepEqual(native(f), before);
  const handover = {
    shipmentId: f.shipmentId,
    carrier: "ups",
    tracking,
    handoverEvidence: "Synthetic separately scanned physical custody",
  };
  assert.throws(() =>
    f.app.fulfillment.commit(f.actor, "ups-wrong", {
      ...handover,
      tracking: "foreign",
    }),
  );
  const committed = f.app.fulfillment.commit(f.actor, "ups-handover", handover);
  assert.deepEqual(
    f.app.fulfillment.commit(f.actor, "ups-handover", handover),
    committed,
  );
  assert.equal(
    f.app.fulfillment.shipment(f.actor, f.shipmentId).state,
    "shipped",
  );
  assert.equal(f.app.billing.invoices(f.actor).length, 1);
  assert.equal(
    f.app.inventory.stock(f.actor).filter((s) => s.serial === "S1")[0]!.state,
    "sold",
  );
});
for (const kind of ["foreign reference", "not found", "foreign label"] as const)
  test(`UPS ${kind} recovery keeps durable outcome unknown and never authorizes resend`, async (t) => {
    const f = setup(t),
      before = native(f),
      sim = simulator({
        loseShipping: true,
        tracking:
          kind === "foreign reference"
            ? (b) => {
                b.trackResponse.shipment[0].package[0].referenceNumber = [
                  { number: "foreign" },
                ];
                return b;
              }
            : undefined,
        recovery:
          kind === "foreign label"
            ? (b) => {
                b.LabelRecoveryResponse.LabelResults[0].TrackingNumber =
                  "1Z6543210987654321";
                return b;
              }
            : undefined,
        raw:
          kind === "not found"
            ? (c) =>
                c.url.pathname.includes("/track/")
                  ? new Response("private provider detail", { status: 404 })
                  : undefined
            : undefined,
      }),
      client = new UpsSandbox(f.config, sim.transport);
    await assert.rejects(() =>
      f.app.carriers.execute(f.actor, f.prepared.id, client),
    );
    await assert.rejects(() =>
      f.app.carriers.reconcile(f.actor, f.prepared.id, client),
    );
    assert.equal(
      f.app.carriers.review(f.actor, f.shipmentId).booking!.state,
      "unknown",
    );
    await assert.rejects(
      () => f.app.carriers.execute(f.actor, f.prepared.id, client),
      { code: "STATE" },
    );
    await assert.rejects(() =>
      f.app.carriers.reconcile(f.actor, f.prepared.id, client),
    );
    assert.equal(
      sim.calls.filter((c) => c.url.pathname.includes("/shipments/")).length,
      1,
    );
    assert.throws(() => f.app.carriers.label(f.actor, f.prepared.id));
    assert.deepEqual(native(f), before);
  });

test("UPS rechecks withdrawn customer choice after token retrieval before any shipping write", async (t) => {
  const f = setup(t),
    before = native(f),
    sim = simulator({
      tokenHook: () => {
        chooseProviders(f, f.actor, "ups-withdraw", {
          accountId: f.buyer,
          region: "CA",
          mode: "strict",
          providers: [],
          version: 2,
          acknowledgment: "Synthetic customer withdraws exception",
        });
      },
    });
  await assert.rejects(() =>
    f.app.carriers.execute(
      f.actor,
      f.prepared.id,
      new UpsSandbox(f.config, sim.transport),
    ),
  );
  assert.equal(sim.calls.length, 1);
  assert.equal(
    f.app.carriers.review(f.actor, f.shipmentId).booking!.state,
    "unknown",
  );
  assert.deepEqual(native(f), before);
});
test("UPS confirmed GIF download retains exact bytes, private headers and current authority", async (t) => {
  const f = setup(t),
    sim = simulator(),
    client = new UpsSandbox(f.config, sim.transport),
    before = native(f);
  const http = await createHttp(f.app, {
    origin: "http://localhost:3100",
    staticRoot: "/nonexistent-ups-test",
    carriers: new CarrierRuntime(f.app, [
      { orgId: f.actor.orgId, adapter: client },
    ]),
  });
  t.after(async () => {
    await http.close();
  });
  await f.app.carriers.execute(f.actor, f.prepared.id, client);
  const login = f.app.identity.login(
    "admin@example.test",
    "long-test-only-password",
  );
  const headers = { cookie: `distributor_session=${login.token}` },
    url = `/api/carrier/${f.prepared.id}/label`;
  const response = await http.inject({ method: "GET", url, headers });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.rawPayload, gif);
  assert.equal(response.headers["x-label-media-type"], "image/gif");
  assert.equal(response.headers["content-type"], "application/octet-stream");
  assert.equal(response.headers["cache-control"], "no-store");
  assert.match(String(response.headers["content-disposition"]), /^attachment;/);
  assert.equal(
    response.headers["x-document-sha256"],
    createHash("sha256").update(gif).digest("hex"),
  );
  assert.equal((await http.inject({ method: "GET", url })).statusCode, 401);
  assert.deepEqual(native(f), before);
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET active=0 WHERE id=?", f.actor.id);
  assert.equal(
    (await http.inject({ method: "GET", url, headers })).statusCode,
    401,
  );
  assert.equal(sim.calls.length, 2);
});
