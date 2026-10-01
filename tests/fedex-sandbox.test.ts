import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { fixture, accept, chooseProviders } from "./fixtures.ts";
import { canonical, digest, DomainError } from "../src/server/core.ts";
import { Application } from "../src/server/application.ts";
import {
  FedexSandbox,
  type FedexSandboxConfig,
} from "../src/server/fedex-sandbox.ts";
import { CarrierRuntime } from "../src/server/carrier-runtime.ts";
import { createHttp } from "../src/server/http.ts";
import type { CarrierIntent } from "../src/server/carrier-bookings.ts";
import type {
  CarrierPrepare,
  CarrierAddress,
} from "../src/shared/carrier-booking.ts";

const tracking = "123456789012";
// Original PDF fixture authored here, without importing a vendor label/sample.
const document = await PDFDocument.create();
document.addPage([288, 432]).drawText("Synthetic local label");
const pdf = Buffer.from(await document.save());
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
    const transfer = f.app.inventory.dispatchTransfer(
      f.actor,
      "fedex-transfer",
      {
        unitId: unit.id,
        quantity: 1,
        revision: unit.revision,
        destinationId: f.w2,
        reason: "Synthetic second origin stock",
      },
    );
    f.app.inventory.receiveTransfer(f.actor, "fedex-arrival", {
      transferId: transfer.id,
      lineId: transfer.lineId,
      quantity: 1,
      serial: "S1",
      receiptRef: "FedEx-SYNTHETIC-TRANSFER",
      bin: "B-1",
      condition: "usable",
      reason: "Synthetic receiving evidence",
    });
  }
  const orderId = accept(secondSite ? { ...f, w1: f.w2 } : f).id;
  chooseProviders(f, f.actor, "fedex-choice", {
    accountId: f.buyer,
    region: country,
    mode: "provider-exceptions",
    providers: ["fedex"],
    version: 1,
    acknowledgment: "Synthetic reviewed FedEx processing exception",
  });
  const picks = f.app.fulfillment.picks(f.actor, orderId);
  for (const pick of picks)
    f.app.fulfillment.pick(f.actor, `fedex-pick-${pick.id}`, {
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
  const shipmentId = f.app.fulfillment.pack(f.actor, "fedex-pack", {
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
    provider: "fedex",
    service: "Reviewed ground",
    origin,
    destination,
    parcel: { weightGrams: 1234, lengthMm: 101, widthMm: 202, heightMm: 303 },
    reviewedDestination: address,
    acknowledgment: "Synthetic actual origin and packed destination review",
  };
  const prepared = f.app.carriers.prepare(f.actor, "fedex-prepare", input);
  const intent = JSON.parse(
    f.app.database
      .owned("integration")
      .get<{ intent: string }>(
        "SELECT intent FROM integration_carrier_bookings WHERE id=?",
        prepared.id,
      )!.intent,
  ) as CarrierIntent;
  const config: FedexSandboxConfig = {
    orgId: f.actor.orgId,
    clientId: "synthetic-fedex-client",
    clientSecret: "synthetic-fedex-secret",
    accountNumber: "123456789",
    country,
    pickupType: "DROPOFF_AT_FEDEX_LOCATION",
    services: [
      { service: "Reviewed ground", code: "FEDEX_GROUND", residential: false },
    ],
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
type Call = { url: URL; init: RequestInit; body: Json | string };
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
    shippingHook?: () => void;
    shipping?: (body: Json) => unknown;
    token?: (body: Json) => unknown;
    raw?: (call: Call) => Response | undefined;
  } = {},
) {
  const calls: Call[] = [];
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://apis-sandbox.fedex.com");
    assert.equal(init!.method, "POST");
    assert.equal(init!.redirect, "error");
    assert.ok(init!.signal instanceof AbortSignal);
    assert.equal(typeof init!.body, "string");
    const body = (init!.body as string).startsWith("{")
      ? JSON.parse(init!.body as string)
      : (init!.body as string);
    const call = { url, init: init!, body };
    calls.push(call);
    const raw = options.raw?.(call);
    if (raw) return raw;
    if (url.pathname === "/oauth/token") {
      options.tokenHook?.();
      const reply = {
        token_type: "bearer",
        access_token: "synthetic-token",
        expires_in: 3600,
      };
      return json(options.token ? options.token(reply) : reply);
    }
    assert.equal(url.pathname, "/ship/v1/shipments");
    assert.equal(
      (init!.headers as Json).authorization,
      "Bearer synthetic-token",
    );
    options.shippingHook?.();
    if (options.loseShipping)
      throw new Error("must-not-escape synthetic lost reply");
    const request = (body as Json).requestedShipment;
    const reply = {
      transactionId: "synthetic-fedex-id",
      customerTransactionId: (init!.headers as Json)[
        "x-customer-transaction-id"
      ],
      output: {
        transactionShipments: [
          {
            serviceType: request.serviceType,
            masterTrackingNumber: tracking,
            pieceResponses: [
              {
                packageSequenceNumber: 1,
                trackingNumber: tracking,
                masterTrackingNumber: tracking,
                customerReferences:
                  request.requestedPackageLineItems[0].customerReferences,
                packageDocuments: [
                  {
                    contentType: "LABEL",
                    docType: "PDF",
                    trackingNumber: tracking,
                    encodedLabel: pdf.toString("base64"),
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    return json(options.shipping ? options.shipping(reply) : reply);
  };
  return { calls, transport };
}

for (const country of ["CA", "US"] as const)
  for (const secondSite of [false, true])
    test(`FedEx ${country} ${secondSite ? "second" : "first"} warehouse maps the reviewed physical origin and preserves native facts until handover`, async (t) => {
      const f = setup(t, country, secondSite),
        sim = simulator(),
        before = native(f);
      const client = new FedexSandbox(f.config, sim.transport);
      // Configuration is captured; mutating the caller cannot change the service/account.
      f.config.accountNumber = "987654321";
      f.config.services[0]!.code = "GROUND_HOME_DELIVERY";
      f.config.services[0]!.residential = true;
      let guards = 0;
      const result = await f.app.carriers.execute(f.actor, f.prepared.id, {
        provider: "fedex",
        sandbox: true,
        book: (intent, beforeWrite) =>
          client.book(intent, () => {
            guards++;
            assert.equal(sim.calls.length, 1);
            assert.equal(sim.calls[0]!.url.pathname, "/oauth/token");
            beforeWrite();
          }),
        lookup: client.lookup.bind(client),
      });
      assert.equal(guards, 1);
      const auth = new URLSearchParams(sim.calls[0]!.body as string);
      assert.deepEqual(Object.fromEntries(auth), {
        grant_type: "client_credentials",
        client_id: "synthetic-fedex-client",
        client_secret: "synthetic-fedex-secret",
      });
      const body = sim.calls[1]!.body as Json,
        shipment = body.requestedShipment;
      assert.deepEqual(body.accountNumber, { value: "123456789" });
      assert.equal(body.processingOptionType, "SYNCHRONOUS_ONLY");
      assert.equal(body.labelResponseOptions, "LABEL");
      assert.equal(body.shipAction, "CONFIRM");
      assert.equal(shipment.pickupType, "DROPOFF_AT_FEDEX_LOCATION");
      assert.equal(shipment.serviceType, "FEDEX_GROUND");
      assert.equal(shipment.packagingType, "YOUR_PACKAGING");
      assert.deepEqual(shipment.shipper.address.streetLines, [
        f.input.origin.line1,
      ]);
      assert.equal(shipment.shipper.address.city, f.input.origin.city);
      assert.equal(shipment.shipper.address.countryCode, country);
      assert.equal(shipment.shipper.contact.phoneNumber, "4165550100");
      assert.equal(shipment.recipients[0].address.residential, false);
      assert.deepEqual(shipment.shippingChargesPayment, {
        paymentType: "SENDER",
      });
      assert.equal(shipment.totalPackageCount, 1);
      assert.equal(shipment.totalWeight, 1.234);
      assert.equal(shipment.requestedPackageLineItems.length, 1);
      const parcel = shipment.requestedPackageLineItems[0];
      assert.deepEqual(parcel.weight, { units: "KG", value: 1.234 });
      assert.deepEqual(parcel.dimensions, {
        length: 11,
        width: 21,
        height: 31,
        units: "CM",
      });
      assert.equal(parcel.sequenceNumber, "1");
      assert.equal(parcel.groupPackageCount, 1);
      assert.deepEqual(parcel.customerReferences, [
        {
          customerReferenceType: "CUSTOMER_REFERENCE",
          value: result.reference,
        },
      ]);
      assert.deepEqual(shipment.labelSpecification, {
        imageType: "PDF",
        labelStockType: "PAPER_4X6",
      });
      assert.ok(result.reference);
      assert.match(result.reference, /^D[A-F0-9]{29}$/);
      assert.equal(result.tracking, tracking);
      assert.equal(result.id, f.prepared.id);
      assert.equal(result.reviewHash, f.prepared.reviewHash);
      const label = f.app.carriers.label(f.actor, f.prepared.id);
      assert.equal(label.mediaType, "application/pdf");
      assert.deepEqual(label.bytes, pdf);
      assert.deepEqual(native(f), before);
      assert.equal(sim.calls.length, 2);
      // Integrated booking and a separate handover create native effects exactly once.
      const handover = {
        shipmentId: f.shipmentId,
        carrier: "fedex",
        tracking,
        handoverEvidence: "Synthetic separately scanned custody",
      };
      const committed = f.app.fulfillment.commit(
        f.actor,
        "fedex-handover",
        handover,
      );
      assert.deepEqual(
        f.app.fulfillment.commit(f.actor, "fedex-handover", handover),
        committed,
      );
      assert.equal(f.app.inventory.trace(f.actor, "S1").unit.state, "sold");
      assert.equal(
        f.app.inventory.trace(f.actor, "S1").unit.warehouse_id,
        secondSite ? f.w2 : f.w1,
      );
      assert.equal(f.app.billing.invoices(f.actor).length, 1);
    });

test("FedEx requires explicit residential US Home Delivery and permits configured Canadian ground residential service", async (t) => {
  for (const country of ["US", "CA"] as const) {
    const f = setup(t, country),
      sim = simulator();
    f.config.services[0] = {
      service: "Reviewed ground",
      code: country === "US" ? "GROUND_HOME_DELIVERY" : "FEDEX_GROUND",
      residential: true,
    };
    f.config.pickupType = "USE_SCHEDULED_PICKUP";
    await new FedexSandbox(f.config, sim.transport).book(f.intent, () => {});
    const shipment = (sim.calls[1]!.body as Json).requestedShipment;
    assert.equal(shipment.recipients[0].address.residential, true);
    assert.equal(shipment.pickupType, "USE_SCHEDULED_PICKUP");
    assert.equal(
      shipment.serviceType,
      country === "US" ? "GROUND_HOME_DELIVERY" : "FEDEX_GROUND",
    );
  }
});

test("FedEx refuses altered identity, hash, service, countries, non-ASCII contacts and out-of-bounds rounded parcels before transport", async (t) => {
  const f = setup(t),
    sim = simulator(),
    client = new FedexSandbox(f.config, sim.transport);
  const bad = [
    { ...f.intent, reviewHash: "0".repeat(64) },
    revise(f.intent, { provider: "ups" }),
    revise(f.intent, {
      nativeSnapshot: { ...f.intent.nativeSnapshot, org_id: "foreign-org" },
    }),
    revise(f.intent, { shipmentId: "foreign-shipment" }),
    revise(f.intent, { service: "Ground" }),
    revise(f.intent, { origin: us, destination: us }),
    revise(f.intent, { destination: us }),
    revise(f.intent, { origin: { ...ca, name: "Montréal" } }),
    revise(f.intent, { destination: { ...ca, line1: "x".repeat(36) } }),
    revise(f.intent, { destination: { ...ca, phone: "+2 416 555 0100" } }),
    revise(f.intent, { destination: { ...ca, phone: "416-555-010" } }),
    revise(f.intent, { destination: { ...ca, phone: "416-555-0100\n" } }),
    revise(f.intent, { destination: { ...ca, postalCode: "not-a-postcode" } }),
    revise(f.intent, {
      destination: { ...ca, phone: "(".repeat(40) + "4165550100" },
    }),
    revise(f.intent, {
      destination: { ...us, postalCode: 14201 } as unknown as CarrierAddress,
    }),
    revise(f.intent, { parcel: { ...f.intent.parcel, weightGrams: 68_001 } }),
    revise(f.intent, { parcel: { ...f.intent.parcel, weightGrams: 1.5 } }),
    revise(f.intent, { parcel: { ...f.intent.parcel, lengthMm: 2741 } }),
    revise(f.intent, {
      parcel: {
        ...f.intent.parcel,
        lengthMm: 2000,
        widthMm: 501,
        heightMm: 499,
      },
    }),
    revise(f.intent, {
      parcel: { ...f.intent.parcel, heightMm: Number.MAX_SAFE_INTEGER + 1 },
    }),
  ];
  for (const intent of bad)
    await assert.rejects(() =>
      client.book(intent, () =>
        assert.fail("Rejected review must not invoke a guard"),
      ),
    );
  assert.equal(sim.calls.length, 0);
});

test("FedEx configuration rejects coercion, sparse/duplicate services and unsupported account/service/pickup/residential combinations", (t) => {
  const f = setup(t),
    sim = simulator();
  const configs = [
    { ...f.config, accountNumber: 123456789 },
    { ...f.config, accountNumber: "12345678" },
    { ...f.config, country: "GB" },
    { ...f.config, clientSecret: "secret\n" },
    { ...f.config, clientId: " client" },
    { ...f.config, pickupType: "CONTACT_FEDEX_TO_SCHEDULE" },
    { ...f.config, services: [] },
    { ...f.config, services: Array(1) },
    { ...f.config, services: [null] },
    { ...f.config, services: [...f.config.services, ...f.config.services] },
    {
      ...f.config,
      services: [
        {
          service: "Reviewed ground",
          code: "INTERNATIONAL_PRIORITY",
          residential: false,
        },
      ],
    },
    {
      ...f.config,
      services: [{ service: "Reviewed ground", code: "FEDEX_GROUND" }],
    },
    {
      ...f.config,
      country: "US",
      services: [
        { service: "Reviewed ground", code: "FEDEX_GROUND", residential: true },
      ],
    },
    {
      ...f.config,
      services: [
        {
          service: "Reviewed ground",
          code: "GROUND_HOME_DELIVERY",
          residential: true,
        },
      ],
    },
    {
      ...f.config,
      country: "US",
      services: [
        {
          service: "Reviewed ground",
          code: "GROUND_HOME_DELIVERY",
          residential: false,
        },
      ],
    },
  ];
  for (const config of configs)
    assert.throws(
      () => new FedexSandbox(config as FedexSandboxConfig, sim.transport),
      { code: "CARRIER_CONFIG" },
    );
  assert.equal(sim.calls.length, 0);
});

test("FedEx opaque correlation changes with organization/account/booking/review and exposes no native IDs", async (t) => {
  const f = setup(t),
    references: string[] = [],
    transactions: string[] = [];
  const cases = [
    { config: f.config, intent: f.intent },
    {
      config: { ...f.config, orgId: "foreign-org" },
      intent: revise(f.intent, {
        nativeSnapshot: { ...f.intent.nativeSnapshot, org_id: "foreign-org" },
      }),
    },
    { config: { ...f.config, accountNumber: "987654321" }, intent: f.intent },
    { config: f.config, intent: { ...f.intent, bookingId: "another-booking" } },
    {
      config: f.config,
      intent: revise(f.intent, {
        parcel: { ...f.intent.parcel, weightGrams: 1235 },
      }),
    },
  ];
  for (const entry of cases) {
    const sim = simulator(),
      result = await new FedexSandbox(entry.config, sim.transport).book(
        entry.intent,
        () => {},
      );
    references.push(result.reference);
    transactions.push(
      (sim.calls[1]!.init.headers as Json)["x-customer-transaction-id"],
    );
    assert.ok(!result.reference.includes(f.shipmentId));
    assert.ok(!result.reference.includes(entry.config.accountNumber));
  }
  assert.equal(new Set(references).size, cases.length);
  assert.equal(new Set(transactions).size, cases.length);
});

const resultFailures: [string, (body: Json) => unknown][] = [
  [
    "transaction",
    (b) => {
      b.customerTransactionId = "foreign";
      return b;
    },
  ],
  [
    "errors",
    (b) => {
      b.errors = [{ message: "must-not-escape" }];
      return b;
    },
  ],
  [
    "async job",
    (b) => {
      b.output.jobId = "unqualified-job";
      return b;
    },
  ],
  [
    "two shipments",
    (b) => {
      b.output.transactionShipments.push(b.output.transactionShipments[0]);
      return b;
    },
  ],
  [
    "no shipment",
    (b) => {
      b.output.transactionShipments = [];
      return b;
    },
  ],
  [
    "two parcels",
    (b) => {
      b.output.transactionShipments[0].pieceResponses.push(
        b.output.transactionShipments[0].pieceResponses[0],
      );
      return b;
    },
  ],
  [
    "service",
    (b) => {
      b.output.transactionShipments[0].serviceType = "INTERNATIONAL_PRIORITY";
      return b;
    },
  ],
  [
    "master tracking",
    (b) => {
      b.output.transactionShipments[0].masterTrackingNumber = "987654321012";
      return b;
    },
  ],
  [
    "sequence",
    (b) => {
      b.output.transactionShipments[0].pieceResponses[0].packageSequenceNumber = 2;
      return b;
    },
  ],
  [
    "parcel master tracking",
    (b) => {
      b.output.transactionShipments[0].pieceResponses[0].masterTrackingNumber =
        "987654321012";
      return b;
    },
  ],
  [
    "tracking URL",
    (b) => {
      b.output.transactionShipments[0].pieceResponses[0].trackingNumber =
        "https://foreign.test";
      return b;
    },
  ],
  [
    "foreign reference",
    (b) => {
      b.output.transactionShipments[0].pieceResponses[0].customerReferences[0].value =
        "foreign";
      return b;
    },
  ],
  [
    "no reference",
    (b) => {
      b.output.transactionShipments[0].pieceResponses[0].customerReferences =
        [];
      return b;
    },
  ],
  [
    "duplicate reference",
    (b) => {
      const p = b.output.transactionShipments[0].pieceResponses[0];
      p.customerReferences.push(p.customerReferences[0]);
      return b;
    },
  ],
  [
    "non-object reference",
    (b) => {
      b.output.transactionShipments[0].pieceResponses[0].customerReferences = [
        null,
      ];
      return b;
    },
  ],
  [
    "foreign label tracking",
    (b) => {
      b.output.transactionShipments[0].pieceResponses[0].packageDocuments[0].trackingNumber =
        "987654321012";
      return b;
    },
  ],
  [
    "non-label document",
    (b) => {
      b.output.transactionShipments[0].pieceResponses[0].packageDocuments[0].contentType =
        "COMMERCIAL_INVOICE";
      return b;
    },
  ],
  [
    "non-PDF document",
    (b) => {
      b.output.transactionShipments[0].pieceResponses[0].packageDocuments[0].docType =
        "PNG";
      return b;
    },
  ],
  [
    "external URL",
    (b) => {
      b.output.transactionShipments[0].pieceResponses[0].packageDocuments[0].url =
        "https://foreign.test/private";
      return b;
    },
  ],
  [
    "multiple labels",
    (b) => {
      const p = b.output.transactionShipments[0].pieceResponses[0];
      p.packageDocuments.push(p.packageDocuments[0]);
      return b;
    },
  ],
  [
    "base64",
    (b) => {
      b.output.transactionShipments[0].pieceResponses[0].packageDocuments[0].encodedLabel =
        "JVBERi0=\n";
      return b;
    },
  ],
  [
    "noncanonical pad bits",
    (b) => {
      b.output.transactionShipments[0].pieceResponses[0].packageDocuments[0].encodedLabel =
        "JVBERi1=";
      return b;
    },
  ],
  [
    "wrong signature",
    (b) => {
      b.output.transactionShipments[0].pieceResponses[0].packageDocuments[0].encodedLabel =
        Buffer.from("not-a-pdf").toString("base64");
      return b;
    },
  ],
  [
    "oversized label",
    (b) => {
      b.output.transactionShipments[0].pieceResponses[0].packageDocuments[0].encodedLabel =
        Buffer.alloc(1_048_577).toString("base64");
      return b;
    },
  ],
];
for (const [name, shipping] of resultFailures)
  test(`FedEx rejects ${name} while retaining durable unknown state and refusing repeat purchase`, async (t) => {
    const f = setup(t),
      before = native(f),
      sim = simulator({ shipping }),
      client = new FedexSandbox(f.config, sim.transport);
    await assert.rejects(
      () => f.app.carriers.execute(f.actor, f.prepared.id, client),
      { code: "CARRIER_RESULT" },
    );
    assert.equal(
      f.app.carriers.review(f.actor, f.shipmentId).booking!.state,
      "unknown",
    );
    await assert.rejects(
      () => f.app.carriers.execute(f.actor, f.prepared.id, client),
      { code: "STATE" },
    );
    await assert.rejects(
      () => f.app.carriers.reconcile(f.actor, f.prepared.id, client),
      { code: "CARRIER_RECOVERY_UNSUPPORTED" },
    );
    assert.equal(sim.calls.length, 2);
    assert.throws(() => f.app.carriers.label(f.actor, f.prepared.id), {
      code: "STATE",
    });
    assert.deepEqual(native(f), before);
  });

for (const kind of [
  "token expiry string",
  "token newline",
  "token expiry too short",
  "401",
  "429",
  "redirect",
  "wrong content type",
  "bad JSON",
  "oversized header",
  "oversized stream",
  "failed stream",
] as const)
  test(`FedEx ${kind} is bounded, sanitized and never automatically retried`, async (t) => {
    const f = setup(t),
      before = native(f);
    const tokenFailure = kind.startsWith("token");
    const sim = simulator({
      token: (b) => {
        if (kind === "token expiry string") b.expires_in = "3600";
        if (kind === "token expiry too short") b.expires_in = 30;
        if (kind === "token newline") b.access_token = "must-not-escape\n";
        return b;
      },
      raw: (call) => {
        if (call.url.pathname === "/oauth/token") return undefined;
        if (kind === "401" || kind === "429")
          return json({ message: "must-not-escape" }, Number(kind));
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
        if (kind === "oversized stream" || kind === "failed stream")
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                if (kind === "failed stream")
                  controller.error(new Error("must-not-escape"));
                else {
                  controller.enqueue(new Uint8Array(2_097_153));
                  controller.close();
                }
              },
            }),
            { headers: { "content-type": "application/json" } },
          );
        return undefined;
      },
    });
    await assert.rejects(
      () =>
        f.app.carriers.execute(
          f.actor,
          f.prepared.id,
          new FedexSandbox(f.config, sim.transport),
        ),
      (error: unknown) => {
        assert.ok(error instanceof DomainError);
        assert.equal(
          error.code,
          tokenFailure ? "CARRIER_RESULT" : "CARRIER_TRANSPORT",
        );
        assert.ok(!error.message.includes("must-not-escape"));
        assert.ok(!error.message.includes(f.config.clientSecret));
        return true;
      },
    );
    assert.equal(sim.calls.length, tokenFailure ? 1 : 2);
    assert.equal(
      f.app.carriers.review(f.actor, f.shipmentId).booking!.state,
      "unknown",
    );
    assert.deepEqual(native(f), before);
  });

test("FedEx cancels an oversized response stream before consuming its advertised body", async (t) => {
  const f = setup(t),
    before = native(f);
  let canceled = false,
    reads = 0;
  const sim = simulator({
    raw: (call) => {
      if (call.url.pathname === "/oauth/token") return undefined;
      return new Response(
        new ReadableStream<Uint8Array>(
          {
            pull() {
              reads++;
            },
            cancel() {
              canceled = true;
            },
          },
          { highWaterMark: 0 },
        ),
        {
          headers: {
            "content-type": "application/json",
            "content-length": "2097153",
          },
        },
      );
    },
  });
  await assert.rejects(
    () =>
      f.app.carriers.execute(
        f.actor,
        f.prepared.id,
        new FedexSandbox(f.config, sim.transport),
      ),
    { code: "CARRIER_TRANSPORT" },
  );
  assert.equal(canceled, true);
  assert.equal(reads, 0);
  assert.equal(sim.calls.length, 2);
  assert.deepEqual(native(f), before);
});

test("FedEx a lost response stays unknown across restart and unsupported reconciliation makes no network calls or native effects", async (t) => {
  const f = setup(t),
    before = native(f),
    sim = simulator({ loseShipping: true });
  await assert.rejects(
    () =>
      f.app.carriers.execute(
        f.actor,
        f.prepared.id,
        new FedexSandbox(f.config, sim.transport),
      ),
    { code: "CARRIER_TRANSPORT" },
  );
  f.app.close();
  f.app = new Application(f.path, "CA");
  const client = new FedexSandbox(f.config, sim.transport);
  for (let i = 0; i < 2; i++)
    await assert.rejects(
      () => f.app.carriers.reconcile(f.actor, f.prepared.id, client),
      { code: "CARRIER_RECOVERY_UNSUPPORTED" },
    );
  await assert.rejects(
    () => f.app.carriers.execute(f.actor, f.prepared.id, client),
    { code: "STATE" },
  );
  assert.throws(
    () =>
      f.app.carriers.cancel(f.actor, "fedex-cancel-unknown", {
        bookingId: f.prepared.id,
        reviewHash: f.prepared.reviewHash,
        reason: "Never authorize resend",
      }),
    { code: "STATE" },
  );
  assert.throws(
    () =>
      f.app.carriers.prepare(f.actor, "fedex-replace-unknown", {
        ...f.input,
        previousId: f.prepared.id,
      }),
    { code: "CARRIER_BOOKING_ACTIVE" },
  );
  assert.throws(() =>
    f.app.fulfillment.commit(f.actor, "fedex-unknown-handover", {
      shipmentId: f.shipmentId,
      carrier: "fedex",
      tracking,
      handoverEvidence: "Unconfirmed label must block handover",
    }),
  );
  assert.equal(sim.calls.length, 2);
  assert.equal(
    f.app.carriers.review(f.actor, f.shipmentId).booking!.state,
    "unknown",
  );
  const row = f.app.database
    .owned("integration")
    .get(
      "SELECT token,started_at FROM integration_carrier_bookings WHERE id=?",
      f.prepared.id,
    )!;
  assert.equal(row.token, null);
  assert.equal(row.started_at, null);
  assert.deepEqual(native(f), before);
});

test("FedEx refuses a missing write guard before authentication or shipping transport", async (t) => {
  const f = setup(t),
    sim = simulator();
  await assert.rejects(
    () =>
      new FedexSandbox(f.config, sim.transport).book(
        f.intent,
        undefined as unknown as () => void,
      ),
    { code: "CARRIER_CONFIG" },
  );
  assert.equal(sim.calls.length, 0);
});

test("FedEx guard denial retains the original error and performs no shipping transport", async (t) => {
  const f = setup(t),
    sim = simulator();
  const denial = new DomainError(
    "SYNTHETIC_DENIAL",
    "Synthetic reviewed guard denial",
    403,
  );
  await assert.rejects(
    () =>
      new FedexSandbox(f.config, sim.transport).book(f.intent, () => {
        throw denial;
      }),
    (error) => error === denial,
  );
  assert.equal(sim.calls.length, 1);
});

test("FedEx withdrawn named customer choice during token retrieval blocks the shipping write", async (t) => {
  const f = setup(t),
    before = native(f),
    sim = simulator({
      tokenHook: () => {
        chooseProviders(f, f.actor, "fedex-withdraw", {
          accountId: f.buyer,
          region: "CA",
          mode: "strict",
          providers: [],
          version: 2,
          acknowledgment: "Synthetic customer withdrawal",
        });
      },
    });
  await assert.rejects(() =>
    f.app.carriers.execute(
      f.actor,
      f.prepared.id,
      new FedexSandbox(f.config, sim.transport),
    ),
  );
  assert.equal(sim.calls.length, 1);
  assert.equal(
    f.app.carriers.review(f.actor, f.shipmentId).booking!.state,
    "unknown",
  );
  assert.deepEqual(native(f), before);
});

test("FedEx retains a matching label after choice changes during the authorized shipping operation", async (t) => {
  const f = setup(t),
    before = native(f),
    sim = simulator({
      shippingHook: () => {
        chooseProviders(f, f.actor, "fedex-late-withdraw", {
          accountId: f.buyer,
          region: "CA",
          mode: "strict",
          providers: [],
          version: 2,
          acknowledgment: "Synthetic customer late withdrawal",
        });
      },
    });
  const booked = await f.app.carriers.execute(
    f.actor,
    f.prepared.id,
    new FedexSandbox(f.config, sim.transport),
  );
  assert.equal(booked.state, "booked");
  assert.equal(booked.tracking, tracking);
  assert.deepEqual(f.app.carriers.label(f.actor, f.prepared.id).bytes, pdf);
  assert.deepEqual(native(f), before);
  assert.equal(sim.calls.length, 2);
});

test("FedEx current principal deactivation after token retrieval blocks the shipping write", async (t) => {
  const f = setup(t),
    before = native(f),
    sim = simulator({
      tokenHook: () => {
        f.app.database
          .owned("iam")
          .run("UPDATE iam_users SET active=0 WHERE id=?", f.actor.id);
      },
    });
  await assert.rejects(() =>
    f.app.carriers.execute(
      f.actor,
      f.prepared.id,
      new FedexSandbox(f.config, sim.transport),
    ),
  );
  assert.equal(sim.calls.length, 1);
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET active=1 WHERE id=?", f.actor.id);
  assert.equal(
    f.app.carriers.review(f.actor, f.shipmentId).booking!.state,
    "unknown",
  );
  assert.deepEqual(native(f), before);
});

test("FedEx HTTP dispatch follows the retained provider and serves only private retained PDF bytes under current authority", async (t) => {
  const f = setup(t),
    sim = simulator(),
    before = native(f);
  const http = await createHttp(f.app, {
    origin: "http://localhost:3100",
    staticRoot: "/nonexistent-fedex-test",
    carriers: new CarrierRuntime(f.app, [
      {
        orgId: f.actor.orgId,
        adapter: new FedexSandbox(f.config, sim.transport),
      },
      {
        orgId: f.actor.orgId,
        adapter: {
          provider: "ups",
          sandbox: true,
          book: async () => assert.fail("Must not dispatch UPS"),
          lookup: async () => assert.fail("Must not reconcile UPS"),
        },
      },
    ]),
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
    origin: "http://localhost:3100",
    "x-csrf-token": login.csrf,
  };
  const sent = await http.inject({
    method: "POST",
    url: `/api/carrier/${f.prepared.id}/send`,
    headers,
    payload: {},
  });
  assert.equal(sent.statusCode, 200, sent.body);
  assert.equal(sent.json().state, "booked");
  const url = `/api/carrier/${f.prepared.id}/label`,
    response = await http.inject({ method: "GET", url, headers });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.rawPayload, pdf);
  assert.equal(response.headers["x-label-media-type"], "application/pdf");
  assert.equal(response.headers["content-type"], "application/octet-stream");
  assert.equal(response.headers["cache-control"], "no-store");
  assert.match(String(response.headers["content-disposition"]), /^attachment;/);
  assert.equal(response.headers["x-document-sha256"], digest(pdf));
  assert.equal((await PDFDocument.load(response.rawPayload)).getPageCount(), 1);
  assert.equal((await http.inject({ method: "GET", url })).statusCode, 401);
  const override = await http.inject({
    method: "POST",
    url: `/api/carrier/${f.prepared.id}/send`,
    headers,
    payload: { provider: "ups" },
  });
  assert.equal(override.statusCode, 400);
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
