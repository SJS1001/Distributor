import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { fixture, accept, chooseProviders } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { canonical, digest, DomainError } from "../src/server/core.ts";
import { DhlTestClient, type DhlTestConfig } from "../src/server/dhl-test.ts";
import { configuredCarriers } from "../src/server/carrier-config.ts";
import { CarrierRuntime } from "../src/server/carrier-runtime.ts";
import { createHttp } from "../src/server/http.ts";
import type { CarrierIntent } from "../src/server/carrier-bookings.ts";
import type {
  CarrierPrepare,
  CarrierAddress,
} from "../src/shared/carrier-booking.ts";

// Original synthetic documents; no vendor sample, customer data or external I/O.
async function originalPdf(width: number, pages = 1) {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pages; i++)
    pdf
      .addPage([width + i, 432])
      .drawText(`Synthetic document ${width} page ${i + 1}`);
  return Buffer.from(await pdf.save());
}
const transportPdf = await originalPdf(201),
  waybillPdf = await originalPdf(301, 2),
  invoicePdf = await originalPdf(401);
const tracking = "1234567890";
const us: CarrierAddress = {
  name: "Reviewed contact",
  line1: "10 Test Road",
  line2: "",
  city: "Buffalo",
  province: "NY",
  postalCode: "14201",
  country: "US",
  phone: "+1 (716) 555-0100",
};
const ca: CarrierAddress = {
  ...us,
  name: "Émile Test",
  city: "Montréal",
  province: "QC",
  postalCode: "H2X 1Y4",
  country: "CA",
};
function setup(
  t: Parameters<typeof fixture>[0],
  country: "US" | "CA" = "US",
  cross = true,
  bulk = false,
  secondSite = false,
) {
  const f = fixture(t, {}, country);
  if (bulk) {
    f.product = f.app.catalog.create(f.actor, "dhl-bulk", {
      sku: "DHL-BULK",
      name: "Synthetic equipment",
      serialized: false,
      unitPrice: 5000,
      taxBasisPoints: 0,
    }).id;
    const po = f.app.procurement.create(f.actor, "dhl-po", {
      supplierId: f.supplier,
      warehouseId: f.w1,
      lines: [{ productId: f.product, quantity: 3, unitCost: 2500 }],
    }).id;
    const line = f.app.procurement.orders(f.actor).find((p) => p.id === po)!
      .lines[0]!;
    f.app.procurement.receive(f.actor, "dhl-receive", {
      poId: po,
      lineId: String(line.id),
      deliveryRef: "SYNTHETIC-DHL",
      quantity: 3,
      serials: [],
      bin: "B-1",
      quarantine: false,
    });
  }
  if (secondSite) {
    for (const serial of ["S1", "S2"]) {
      const unit = f.app.inventory.trace(f.actor, serial).unit;
      const transfer = f.app.inventory.dispatchTransfer(
        f.actor,
        `dhl-transfer-${serial}`,
        {
          unitId: unit.id,
          quantity: 1,
          revision: unit.revision,
          destinationId: f.w2,
          reason: "Synthetic second origin stock",
        },
      );
      f.app.inventory.receiveTransfer(f.actor, `dhl-arrival-${serial}`, {
        transferId: transfer.id,
        lineId: transfer.lineId,
        quantity: 1,
        serial,
        receiptRef: `SYNTHETIC-DHL-${serial}`,
        bin: "B-1",
        condition: "usable",
        reason: "Synthetic custody",
      });
    }
  }
  const orderId = accept(secondSite ? { ...f, w1: f.w2 } : f, 2).id;
  chooseProviders(f, f.actor, "dhl-choice", {
    accountId: f.buyer,
    region: country,
    mode: "provider-exceptions",
    providers: ["dhl-express"],
    version: 1,
    acknowledgment: "Synthetic named processing exception",
  });
  const picks = f.app.fulfillment.picks(f.actor, orderId);
  for (const p of picks)
    f.app.fulfillment.pick(f.actor, `dhl-pick-${p.id}`, {
      orderId,
      allocationId: p.id,
      serial: p.serial,
    });
  const address = "Synthetic explicitly reviewed packed recipient";
  const shipmentId = f.app.fulfillment.pack(f.actor, "dhl-pack", {
    orderId,
    revision: f.app.orders.order(f.actor, orderId).revision,
    mode: "carrier",
    address,
    lines: picks.map((p) => ({ allocationId: p.id, quantity: p.quantity })),
  }).id;
  const origin = {
      ...(country === "US" ? us : ca),
      ...(secondSite ? { line1: "20 Second Warehouse Road" } : {}),
    },
    destination = {
      ...(cross ? (country === "US" ? ca : us) : origin),
      line1: "30 Recipient Road",
      line2: "Suite 2",
    };
  const config: DhlTestConfig = {
    orgId: f.actor.orgId,
    username: "synthetic-user",
    password: "synthetic-secret",
    accountNumber: "123456789",
    country,
    services: [
      {
        service: "Reviewed explicit product",
        productCode: "P",
        localProductCode: "P",
        destinationCountry: destination.country as "US" | "CA",
      },
    ],
  };
  const clock = () => Date.parse("2026-10-02T14:30:00Z");
  const input: CarrierPrepare = {
    shipmentId,
    previousId: null,
    provider: "dhl-express",
    service: config.services[0]!.service,
    origin,
    destination,
    parcel: { weightGrams: 1234, lengthMm: 101, widthMm: 202, heightMm: 303 },
    reviewedDestination: address,
    acknowledgment: "Synthetic actual origin and recipient review",
    dhl: {
      companyNames: {
        shipper: "Reviewed Shipper Inc",
        receiver: "Société Test",
      },
      plannedShippingAt: "2026-10-03T10:30:00-04:00",
      description: "Reviewed equipment",
      incoterm: "DAP",
      ...(cross
        ? {
            customs: {
              invoiceType: "commercial" as const,
              currency: country === "US" ? ("USD" as const) : ("CAD" as const),
              invoiceNumber: "SYNTHETIC-EXPORT",
              invoiceDate: "2026-10-01",
              exportReason: "commercial_purpose_or_sale" as const,
              acknowledgment: "Synthetic exact goods review",
              lines: picks.map((p, i) => ({
                allocationId: p.id,
                quantity: p.quantity,
                description: `Reviewed goods ${i + 1}`,
                unitValueMinor: 12345 + i,
                manufacturerCountry: "CA",
                commodityCode: "001234",
                netWeightGrams: 250,
              })),
            },
          }
        : {}),
    },
  };
  const configuration = new DhlTestClient(config).configuration;
  input.configurationHash = configuration.hash;
  const prepared = f.app.carriers.prepare(
    f.actor,
    "dhl-prepare",
    input,
    configuration,
  );
  const intent = JSON.parse(
    f.app.database
      .owned("integration")
      .get<{ intent: string }>(
        "SELECT intent FROM integration_carrier_bookings WHERE id=?",
        prepared.id,
      )!.intent,
  ) as CarrierIntent;
  return Object.assign(f, {
    orderId,
    shipmentId,
    config,
    input,
    prepared,
    intent,
    clock,
  });
}
type F = ReturnType<typeof setup>;
type Json = Record<string, any>;
type Call = { url: string; init: RequestInit; body: Json };
function simulator(
  options: {
    reply?: (body: Json) => unknown;
    raw?: (call: Call) => Response;
    hook?: () => void;
    lost?: boolean;
  } = {},
) {
  const calls: Call[] = [];
  const transport: typeof fetch = async (input, init) => {
    assert.equal(
      String(input),
      "https://express.api.dhl.com/mydhlapi/test/shipments",
    );
    assert.equal(init!.method, "POST");
    assert.equal(init!.redirect, "error");
    assert.ok(init!.signal instanceof AbortSignal);
    const call = {
      url: String(input),
      init: init!,
      body: JSON.parse(init!.body as string),
    };
    calls.push(call);
    options.hook?.();
    if (options.lost)
      throw new Error("must-not-escape synthetic-secret lost reply");
    if (options.raw) return options.raw(call);
    const doc = (typeCode: string, pdf: Buffer) => ({
      typeCode,
      imageFormat: "PDF",
      content: pdf.toString("base64"),
      packageReferenceNumber: 1,
    });
    const reply = {
      shipmentTrackingNumber: tracking,
      packages: [
        { referenceNumber: 1, trackingNumber: "JD123456789012345678" },
      ],
      documents: [
        doc("label", transportPdf),
        doc("label", waybillPdf),
        ...(call.body.content.isCustomsDeclarable
          ? [doc("invoice", invoicePdf)]
          : []),
      ],
    };
    return new Response(
      JSON.stringify(options.reply ? options.reply(reply) : reply),
      {
        status: 201,
        headers: {
          "content-type": "application/json",
          "Message-Reference": new Headers(init!.headers).get(
            "Message-Reference",
          )!,
        },
      },
    );
  };
  return { calls, transport };
}
const native = (f: F) => ({
  stock: f.app.inventory.stock(f.actor),
  order: f.app.orders.order(f.actor, f.orderId),
  invoices: f.app.billing.invoices(f.actor),
  shipment: f.app.fulfillment.shipment(f.actor, f.shipmentId),
});
function revise(
  intent: CarrierIntent,
  mutate: (intent: CarrierIntent) => void,
) {
  const value = structuredClone(intent);
  mutate(value);
  const { bookingId, reviewHash: _old, ...review } = value;
  return { ...review, bookingId, reviewHash: digest(canonical(review)) };
}
function environment(f: F): NodeJS.ProcessEnv {
  return {
    CARRIERS_ENABLED: "true",
    DHL_TEST_ENABLED: "true",
    DHL_TEST_CREDENTIALS_ACK: "test-only",
    CARRIER_ORG_ID: f.config.orgId,
    DHL_USERNAME: f.config.username,
    DHL_PASSWORD: f.config.password,
    DHL_ACCOUNT_NUMBER: f.config.accountNumber,
    DHL_COUNTRY: f.config.country,
    DHL_SERVICES_JSON: JSON.stringify(f.config.services),
  };
}

for (const country of ["US", "CA"] as const)
  for (const cross of [false, true])
    test(`DHL ${country} ${cross ? "cross-border" : "domestic"} sends exact review once, retains all PDF pages and separates native handover`, async (t) => {
      const f = setup(t, country, cross, cross, !cross),
        before = native(f),
        sim = simulator(),
        client = new DhlTestClient(f.config, sim.transport, f.clock);
      f.config.password = "caller-mutated";
      f.config.accountNumber = "987654321";
      f.config.services[0]!.productCode = "N";
      let guards = 0;
      const result = await f.app.carriers.execute(f.actor, f.prepared.id, {
        provider: client.provider,
        sandbox: true,
        configuration: client.configuration,
        book: (intent, guard) =>
          client.book(intent, () => {
            guards++;
            assert.equal(sim.calls.length, 0);
            guard();
          }),
        lookup: client.lookup.bind(client),
      });
      assert.equal(guards, 1);
      assert.equal(sim.calls.length, 1);
      const request = sim.calls[0]!.body,
        headers = new Headers(sim.calls[0]!.init.headers);
      assert.equal(
        headers.get("authorization"),
        "Basic " +
          Buffer.from("synthetic-user:synthetic-secret").toString("base64"),
      );
      assert.match(
        headers.get("Message-Reference")!,
        /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/,
      );
      assert.equal(
        request.plannedShippingDateAndTime,
        "2026-10-03T10:30:00 GMT-04:00",
      );
      assert.deepEqual(request.pickup, { isRequested: false });
      assert.equal(request.getRateEstimates, false);
      assert.equal(request.productCode, "P");
      assert.equal(request.localProductCode, "P");
      assert.deepEqual(request.accounts, [
        { typeCode: "shipper", number: "123456789" },
      ]);
      const map = (a: CarrierAddress, companyName: string) => ({
        postalAddress: {
          postalCode: a.postalCode,
          cityName: a.city,
          countryCode: a.country,
          provinceCode: a.province,
          addressLine1: a.line1,
          ...(a.line2 ? { addressLine2: a.line2 } : {}),
        },
        contactInformation: { fullName: a.name, companyName, phone: a.phone },
      });
      assert.deepEqual(request.customerDetails, {
        shipperDetails: map(f.input.origin, f.input.dhl!.companyNames!.shipper),
        receiverDetails: map(
          f.input.destination,
          f.input.dhl!.companyNames!.receiver,
        ),
      });
      assert.deepEqual(request.content.packages, [
        {
          referenceNumber: 1,
          weight: 1.234,
          dimensions: { length: 10.1, width: 20.2, height: 30.3 },
        },
      ]);
      assert.equal(request.content.isCustomsDeclarable, cross);
      assert.equal(request.content.unitOfMeasurement, "metric");
      assert.equal(request.content.description, f.input.dhl!.description);
      assert.equal(request.content.incoterm, "DAP");
      assert.deepEqual(request.customerReferences, [
        { typeCode: "CU", value: result.reference },
      ]);
      assert.match(result.reference!, /^D[A-F0-9]{29}$/);
      const output = request.outputImageProperties;
      assert.equal(output.allDocumentsInOneImage, false);
      assert.equal(output.splitTransportAndWaybillDocLabels, true);
      assert.equal(output.splitDocumentsByPages, false);
      assert.equal(output.splitInvoiceAndReceipt, true);
      assert.equal(output.encodingFormat, "pdf");
      assert.deepEqual(output.imageOptions[1], {
        typeCode: "waybillDoc",
        templateName: "ARCH_8X4",
        isRequested: true,
        hideAccountNumber: true,
        numberOfCopies: 1,
      });
      assert.deepEqual(output.imageOptions.at(-1), {
        typeCode: "shipmentReceipt",
        isRequested: false,
      });
      if (cross) {
        const review = f.input.dhl!.customs!,
          declaration = request.content.exportDeclaration;
        assert.equal(review.lines.length, 1);
        assert.equal(review.lines[0]!.quantity, 2);
        assert.equal(request.content.declaredValue, 246.9);
        assert.equal(request.content.declaredValueCurrency, review.currency);
        assert.deepEqual(declaration.invoice, {
          number: review.invoiceNumber,
          date: review.invoiceDate,
          totalNetWeight: 0.25,
          totalGrossWeight: 1.234,
        });
        assert.equal(declaration.exportReasonType, review.exportReason);
        assert.deepEqual(declaration.lineItems, [
          {
            number: 1,
            description: "Reviewed goods 1",
            price: 123.45,
            quantity: { value: 2, unitOfMeasurement: "PCS" },
            manufacturerCountry: "CA",
            commodityCodes: [{ typeCode: "outbound", value: "001234" }],
            weight: { netValue: 0.25 },
          },
        ]);
        assert.equal(output.imageOptions[2].invoiceType, "commercial");
        assert.ok(
          !JSON.stringify(request).includes(review.lines[0]!.allocationId),
        );
        assert.ok(!JSON.stringify(request).includes(review.acknowledgment));
      } else {
        assert.equal(request.content.exportDeclaration, undefined);
        assert.equal(request.content.declaredValue, undefined);
        assert.equal(output.imageOptions.length, 3);
      }
      const label = f.app.carriers.label(f.actor, f.prepared.id),
        merged = await PDFDocument.load(label.bytes);
      assert.deepEqual(
        merged.getPages().map((p) => p.getWidth()),
        cross ? [201, 301, 302, 401] : [201, 301, 302],
      );
      assert.equal(result.tracking, tracking);
      assert.deepEqual(native(f), before);
      await assert.rejects(
        () => f.app.carriers.execute(f.actor, f.prepared.id, client),
        { code: "STATE" },
      );
      assert.equal(
        f.app.carriers.review(f.actor, f.shipmentId).booking!.tracking,
        result.tracking,
      );
      assert.equal(sim.calls.length, 1);
      const handover = {
        shipmentId: f.shipmentId,
        carrier: "dhl-express",
        tracking,
        handoverEvidence: "Synthetic separately reviewed physical custody",
      };
      const committed = f.app.fulfillment.commit(
        f.actor,
        "dhl-handover",
        handover,
      );
      assert.deepEqual(
        f.app.fulfillment.commit(f.actor, "dhl-handover", handover),
        committed,
      );
      assert.equal(f.app.billing.invoices(f.actor).length, 1);
    });

test("DHL construction captures configuration without I/O, hides credentials, permits password rotation and refuses every identity drift", async (t) => {
  const f = setup(t),
    sim = simulator(),
    original = new DhlTestClient(f.config, sim.transport, f.clock);
  assert.equal(sim.calls.length, 0);
  const visible = JSON.stringify(original.configuration);
  assert.ok(!visible.includes(f.config.password));
  assert.ok(!visible.includes(f.config.username));
  assert.ok(!visible.includes(f.config.accountNumber));
  assert.equal(
    new DhlTestClient({ ...f.config, password: "rotated-password" })
      .configuration.hash,
    original.configuration.hash,
  );
  for (const config of [
    { ...f.config, username: "other-user" },
    { ...f.config, accountNumber: "987654321" },
    { ...f.config, country: "CA" as const },
    { ...f.config, services: [{ ...f.config.services[0]!, productCode: "N" }] },
    {
      ...f.config,
      services: [{ ...f.config.services[0]!, localProductCode: "N" }],
    },
    {
      ...f.config,
      services: [
        { ...f.config.services[0]!, destinationCountry: "US" as const },
      ],
    },
  ]) {
    const client = new DhlTestClient(config, sim.transport, f.clock);
    await assert.rejects(() => client.book(f.intent, () => {}), {
      code: "CARRIER_CONFIG_CHANGED",
    });
  }
  assert.equal(sim.calls.length, 0);
});

test("DHL constructor rejects unsafe credentials, coercion and ambiguous service mappings before I/O", (t) => {
  const f = setup(t),
    sim = simulator();
  for (const mutate of [
    (c: Json) => {
      c.username = "user:other";
    },
    (c: Json) => {
      c.username = "é";
    },
    (c: Json) => {
      c.password = "secret\n";
    },
    (c: Json) => {
      c.accountNumber = 123;
    },
    (c: Json) => {
      c.accountNumber = "1234567890123";
    },
    (c: Json) => {
      c.country = "GB";
    },
    (c: Json) => {
      c.services = [];
    },
    (c: Json) => {
      c.services = Array(1);
    },
    (c: Json) => {
      c.services = [null];
    },
    (c: Json) => {
      c.services.push(c.services[0]);
    },
    (c: Json) => {
      c.services[0].productCode = "lower";
    },
    (c: Json) => {
      c.services[0].localProductCode = "TOOLONG";
    },
    (c: Json) => {
      c.services[0].destinationCountry = "GB";
    },
    (c: Json) => {
      c.services[0].secret = "must-not-escape";
    },
  ]) {
    const config = structuredClone(f.config);
    mutate(config);
    assert.throws(() => new DhlTestClient(config, sim.transport), {
      code: "CARRIER_CONFIG",
    });
  }
  assert.equal(sim.calls.length, 0);
});

const invalidIntents: [string, (i: CarrierIntent) => void][] = [
  [
    "provider",
    (i) => {
      i.provider = "ups";
    },
  ],
  [
    "organization",
    (i) => {
      i.nativeSnapshot.org_id = "foreign";
    },
  ],
  [
    "shipment identity",
    (i) => {
      i.shipmentId = "foreign";
    },
  ],
  [
    "service",
    (i) => {
      i.service = "invented";
    },
  ],
  [
    "countries",
    (i) => {
      i.origin.country = "CA";
    },
  ],
  [
    "missing companies",
    (i) => {
      delete i.dhl!.companyNames;
    },
  ],
  [
    "padded company",
    (i) => {
      i.dhl!.companyNames!.shipper = " padded";
    },
  ],
  [
    "oversized company",
    (i) => {
      i.dhl!.companyNames!.receiver = "X".repeat(101);
    },
  ],
  [
    "company extra field",
    (i) => {
      (i.dhl!.companyNames as Json).secret = "must-not-escape";
    },
  ],
  [
    "missing invoice type",
    (i) => {
      delete i.dhl!.customs!.invoiceType;
    },
  ],
  [
    "invoice type",
    (i) => {
      (i.dhl!.customs as Json).invoiceType = "invented";
    },
  ],
  [
    "truncated description",
    (i) => {
      i.dhl!.description = "X".repeat(71);
    },
  ],
  [
    "wrong packed goods",
    (i) => {
      i.dhl!.customs!.lines[0]!.allocationId = "foreign";
    },
  ],
  [
    "missing phone",
    (i) => {
      i.destination.phone = "";
    },
  ],
  [
    "phone extension",
    (i) => {
      i.destination.phone += " ext 3";
    },
  ],
  [
    "oversized street",
    (i) => {
      i.destination.line1 = "X".repeat(46);
    },
  ],
  [
    "postal country format",
    (i) => {
      i.destination.postalCode = "14201";
    },
  ],
  [
    "parcel weight",
    (i) => {
      i.parcel.weightGrams = 70001;
    },
  ],
  [
    "parcel side",
    (i) => {
      i.parcel.lengthMm = 1201;
    },
  ],
  [
    "fractional units",
    (i) => {
      i.parcel.heightMm = 1.5;
    },
  ],
];
test("DHL revalidates immutable packed review and all transmission bounds before its write guard or transport", async (t) => {
  const f = setup(t),
    sim = simulator(),
    client = new DhlTestClient(f.config, sim.transport, f.clock);
  let guards = 0;
  for (const [name, mutate] of invalidIntents)
    await t.test(name, async () => {
      await assert.rejects(
        () =>
          client.book(revise(f.intent, mutate), () => {
            guards++;
          }),
        DomainError,
      );
    });
  await assert.rejects(
    () =>
      client.book({ ...f.intent, reviewHash: "0".repeat(64) }, () => {
        guards++;
      }),
    { code: "CARRIER_MISMATCH" },
  );
  await assert.rejects(() => client.book(f.intent, undefined as any), {
    code: "CARRIER_CONFIG",
  });
  assert.equal(guards, 0);
  assert.equal(sim.calls.length, 0);
});

test("DHL shipping horizon is checked at send, guard failures escape unchanged and lookup never repurchases even after date expiry", async (t) => {
  const f = setup(t),
    at = Date.parse(f.intent.dhl!.plannedShippingAt),
    sim = simulator();
  let guards = 0;
  for (const now of [at, at + 1, at - 10 * 86400000 - 1, NaN, -1, at - 0.5]) {
    const client = new DhlTestClient(f.config, sim.transport, () => now);
    await assert.rejects(
      () =>
        client.book(f.intent, () => {
          guards++;
        }),
      { code: "CARRIER_UNSUPPORTED" },
    );
    await assert.rejects(() => client.lookup(f.intent), {
      code: "CARRIER_RECOVERY_UNSUPPORTED",
    });
  }
  const client = new DhlTestClient(f.config, sim.transport, f.clock),
    error = new DomainError(
      "RESIDENCY_BLOCKED",
      "Synthetic revoked choice",
      403,
    );
  await assert.rejects(
    () =>
      client.book(f.intent, () => {
        throw error;
      }),
    (e) => e === error,
  );
  assert.equal(guards, 0);
  assert.equal(sim.calls.length, 0);
  await new DhlTestClient(
    f.config,
    sim.transport,
    () => at - 10 * 86400000,
  ).book(f.intent, () => {
    guards++;
  });
  assert.equal(guards, 1);
  assert.equal(sim.calls.length, 1);
});

const invalidResults: [string, (b: Json) => unknown][] = [
  ["null", () => null],
  [
    "explicit errors alongside a shipment",
    (b) => {
      b.errors = ["must-not-escape"];
      return b;
    },
  ],
  [
    "unexpected parcel field",
    (b) => {
      b.packages[0].error = "must-not-escape";
      return b;
    },
  ],
  [
    "no parcel",
    (b) => {
      b.packages = [];
      return b;
    },
  ],
  [
    "multiple parcels",
    (b) => {
      b.packages.push(b.packages[0]);
      return b;
    },
  ],
  [
    "wrong parcel",
    (b) => {
      b.packages[0].referenceNumber = 2;
      return b;
    },
  ],
  [
    "missing waybill",
    (b) => {
      delete b.shipmentTrackingNumber;
      return b;
    },
  ],
  [
    "tracking URL",
    (b) => {
      b.packages[0].trackingNumber = "https://foreign.test/private";
      return b;
    },
  ],
  [
    "pickup",
    (b) => {
      b.dispatchConfirmationNumber = "unexpected";
      return b;
    },
  ],
  [
    "warnings",
    (b) => {
      b.warnings = ["must-not-escape"];
      return b;
    },
  ],
  [
    "per-piece documents",
    (b) => {
      b.packages[0].documents = [];
      return b;
    },
  ],
  [
    "missing invoice",
    (b) => {
      b.documents.pop();
      return b;
    },
  ],
  [
    "extra document",
    (b) => {
      b.documents.push(b.documents[0]);
      return b;
    },
  ],
  [
    "duplicate bytes",
    (b) => {
      b.documents[1].content = b.documents[0].content;
      return b;
    },
  ],
  [
    "wrong role",
    (b) => {
      b.documents[2].typeCode = "label";
      return b;
    },
  ],
  [
    "wrong document parcel",
    (b) => {
      b.documents[0].packageReferenceNumber = 2;
      return b;
    },
  ],
  [
    "external document",
    (b) => {
      b.documents[0].url = "https://foreign.test/private";
      return b;
    },
  ],
  [
    "wrong format",
    (b) => {
      b.documents[0].imageFormat = "PNG";
      return b;
    },
  ],
  [
    "invalid base64",
    (b) => {
      b.documents[0].content += "\n";
      return b;
    },
  ],
  [
    "bad pad bits",
    (b) => {
      b.documents[0].content = "JVBERi1=";
      return b;
    },
  ],
  [
    "corrupt PDF",
    (b) => {
      b.documents[0].content = Buffer.from("%PDF-1.7\nnot a document").toString(
        "base64",
      );
      return b;
    },
  ],
  [
    "wrong PDF signature",
    (b) => {
      b.documents[0].content = Buffer.from("not a PDF").toString("base64");
      return b;
    },
  ],
  [
    "oversized PDF",
    (b) => {
      b.documents[0].content = Buffer.alloc(1048577).toString("base64");
      return b;
    },
  ],
];
for (const [name, reply] of invalidResults)
  test(`DHL ${name} response stays durably unknown and cannot resend`, async (t) => {
    const f = setup(t),
      before = native(f),
      sim = simulator({ reply }),
      client = new DhlTestClient(f.config, sim.transport, f.clock);
    await assert.rejects(
      () => f.app.carriers.execute(f.actor, f.prepared.id, client),
      (e) =>
        e instanceof DomainError &&
        e.code === "CARRIER_RESULT" &&
        !e.message.includes("must-not-escape"),
    );
    assert.equal(
      f.app.carriers.review(f.actor, f.shipmentId).booking!.state,
      "unknown",
    );
    assert.throws(() => f.app.carriers.label(f.actor, f.prepared.id));
    await assert.rejects(
      () => f.app.carriers.execute(f.actor, f.prepared.id, client),
      { code: "STATE" },
    );
    await assert.rejects(
      () => f.app.carriers.reconcile(f.actor, f.prepared.id, client),
      { code: "CARRIER_RECOVERY_UNSUPPORTED" },
    );
    assert.equal(sim.calls.length, 1);
    assert.deepEqual(native(f), before);
  });

test("DHL unavailable/corrupt HTTP replies are sanitized; restart/reconciliation cannot initiate a second purchase", async (t) => {
  const f = setup(t),
    before = native(f),
    sim = simulator({ lost: true }),
    client = new DhlTestClient(f.config, sim.transport, f.clock);
  await assert.rejects(
    () => f.app.carriers.execute(f.actor, f.prepared.id, client),
    (e) =>
      e instanceof DomainError &&
      e.code === "CARRIER_TRANSPORT" &&
      !e.message.includes("synthetic-secret"),
  );
  f.app.close();
  f.app = new Application(f.path, "US");
  const runtime = new CarrierRuntime(f.app, [
    { orgId: f.actor.orgId, adapter: client },
  ]);
  await assert.rejects(() => runtime.execute(f.actor, f.prepared.id), {
    code: "STATE",
  });
  await assert.rejects(() => runtime.reconcile(f.actor, f.prepared.id), {
    code: "CARRIER_RECOVERY_UNSUPPORTED",
  });
  assert.equal(sim.calls.length, 1);
  assert.equal(
    f.app.carriers.review(f.actor, f.shipmentId).booking!.state,
    "unknown",
  );
  assert.deepEqual(native(f), before);
});

for (const kind of [
  "status",
  "content-type",
  "missing reference",
  "foreign reference",
  "redirect",
  "malformed JSON",
  "oversized header",
  "oversized stream",
] as const)
  test(`DHL ${kind} transport failure never leaks body or retries`, async (t) => {
    const f = setup(t),
      before = native(f);
    let canceled = false;
    const sim = simulator({
      raw: (call) => {
        const headers: Record<string, string> = {
          "content-type": "application/json",
          "Message-Reference": new Headers(call.init.headers).get(
            "Message-Reference",
          )!,
        };
        if (kind === "status")
          return new Response("must-not-escape synthetic-secret", {
            status: 400,
            headers,
          });
        if (kind === "content-type") headers["content-type"] = "text/plain";
        if (kind === "missing reference") delete headers["Message-Reference"];
        if (kind === "foreign reference")
          headers["Message-Reference"] = "foreign";
        if (kind === "oversized header") headers["content-length"] = "4194305";
        if (kind === "oversized stream" || kind === "oversized header")
          return new Response(
            new ReadableStream({
              pull(controller) {
                controller.enqueue(new Uint8Array(4194305));
              },
              cancel() {
                canceled = true;
              },
            }),
            { status: 201, headers },
          );
        const response = new Response("must-not-escape synthetic-secret", {
          status: 201,
          headers,
        });
        if (kind === "redirect")
          Object.defineProperty(response, "redirected", { value: true });
        return response;
      },
    });
    const client = new DhlTestClient(f.config, sim.transport, f.clock);
    await assert.rejects(
      () => f.app.carriers.execute(f.actor, f.prepared.id, client),
      (e) =>
        e instanceof DomainError &&
        e.code === "CARRIER_TRANSPORT" &&
        !e.message.includes("must-not-escape") &&
        !e.message.includes("synthetic-secret"),
    );
    if (kind.startsWith("oversized")) assert.equal(canceled, true);
    assert.equal(sim.calls.length, 1);
    assert.deepEqual(native(f), before);
  });

test("DHL empty/page-excess PDF response fails conservatively and no returned URLs are fetched", async (t) => {
  const f = setup(t),
    empty = await PDFDocument.create(),
    emptyBytes = Buffer.from(await empty.save({ addDefaultPage: false })),
    excess = await originalPdf(500, 48);
  for (const bytes of [emptyBytes, excess]) {
    const sim = simulator({
      reply: (b) => {
        b.documents[0].content = bytes.toString("base64");
        b.trackingUrl = "https://foreign.test";
        return b;
      },
    });
    await assert.rejects(
      () =>
        new DhlTestClient(f.config, sim.transport, f.clock).book(
          f.intent,
          () => {},
        ),
      { code: "CARRIER_RESULT" },
    );
    assert.equal(sim.calls.length, 1);
  }
});

for (const restriction of [
  "choice",
  "site",
  "role",
  "inactive",
  "password",
] as const)
  test(`DHL current ${restriction} authority refuses send before transport`, async (t) => {
    const f = setup(t),
      before = native(f),
      sim = simulator(),
      client = new DhlTestClient(f.config, sim.transport, f.clock);
    const user = f.app.identity.createUser(f.actor, "dhl-user", {
      email: "warehouse@dhl.example.test",
      name: "Synthetic warehouse",
      role: "warehouse",
      sites: [f.w1],
      password: "long-test-only-password",
    });
    const actor = f.app.identity.currentActor({ ...f.actor, id: user.id }),
      iam = f.app.database.owned("iam");
    if (restriction === "choice")
      chooseProviders(f, f.actor, "dhl-withdraw", {
        accountId: f.buyer,
        region: "US",
        mode: "strict",
        providers: [],
        version: 2,
        acknowledgment: "Synthetic choice withdrawal",
      });
    if (restriction === "site")
      iam.run("UPDATE iam_users SET sites='[]' WHERE id=?", actor.id);
    if (restriction === "role")
      iam.run("UPDATE iam_users SET role='commercial' WHERE id=?", actor.id);
    if (restriction === "inactive")
      iam.run("UPDATE iam_users SET active=0 WHERE id=?", actor.id);
    if (restriction === "password")
      iam.run(
        "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
        actor.id,
      );
    await assert.rejects(
      () =>
        f.app.carriers.execute(
          { ...actor, role: "admin", sites: [f.w1] },
          f.prepared.id,
          client,
        ),
      DomainError,
    );
    assert.equal(sim.calls.length, 0);
    assert.equal(
      f.app.carriers.review(f.actor, f.shipmentId).booking!.state,
      "pending",
    );
    assert.deepEqual(native(f), before);
  });

test("DHL startup remains disabled by default, validates exact trusted opt-in and captures no request-driven credentials", (t) => {
  const f = setup(t),
    sim = simulator();
  assert.equal(configuredCarriers(f.app, {}, sim.transport), undefined);
  assert.equal(
    configuredCarriers(
      f.app,
      { CARRIERS_ENABLED: "false", DHL_TEST_ENABLED: "invalid" },
      sim.transport,
    ),
    undefined,
  );
  const env = environment(f),
    runtime = configuredCarriers(f.app, env, sim.transport)!;
  assert.equal(runtime.enabled(f.actor, "dhl-express"), true);
  assert.equal(runtime.enabled(f.actor, "ups"), false);
  assert.deepEqual(runtime.configurations(f.actor), [
    new DhlTestClient(f.config).configuration,
  ]);
  env.DHL_PASSWORD = "mutated";
  env.DHL_ACCOUNT_NUMBER = "987654321";
  assert.deepEqual(runtime.configurations(f.actor), [
    new DhlTestClient(f.config).configuration,
  ]);
  const cases: NodeJS.ProcessEnv[] = [
    { CARRIERS_ENABLED: "yes" },
    { CARRIERS_ENABLED: "true" },
    { ...environment(f), DHL_TEST_ENABLED: "yes" },
    { ...environment(f), DHL_TEST_CREDENTIALS_ACK: undefined },
    { ...environment(f), DHL_TEST_CREDENTIALS_ACK: "production" },
    { ...environment(f), DHL_USERNAME: undefined },
    { ...environment(f), DHL_PASSWORD: "secret\n" },
    { ...environment(f), DHL_COUNTRY: "GB" },
    { ...environment(f), CARRIER_ORG_ID: "foreign" },
    { ...environment(f), DHL_SERVICES_JSON: "secret-invalid-json" },
    {
      ...environment(f),
      DHL_SERVICES_JSON: JSON.stringify([
        { ...f.config.services[0], password: "must-not-escape" },
      ]),
    },
  ];
  for (const entry of cases)
    assert.throws(
      () => configuredCarriers(f.app, entry, sim.transport),
      (e) =>
        e instanceof DomainError &&
        e.code === "CARRIER_CONFIG" &&
        !e.message.includes("must-not-escape") &&
        !e.message.includes("secret-invalid-json"),
    );
  assert.equal(sim.calls.length, 0);
});

test("DHL authenticated API retains explicit company/invoice fields, rejects coercion/extras and serves only private complete documents", async (t) => {
  const f = setup(t),
    before = native(f),
    sim = simulator(),
    client = new DhlTestClient(f.config, sim.transport, f.clock),
    runtime = new CarrierRuntime(f.app, [
      { orgId: f.actor.orgId, adapter: client },
    ]);
  // A fresh unsent successor goes through the actual strict HTTP preparation boundary.
  f.app.carriers.cancel(f.actor, "dhl-cancel", {
    bookingId: f.prepared.id,
    reviewHash: f.prepared.reviewHash,
    reason: "Synthetic HTTP successor",
  });
  const input = { ...f.input, previousId: f.prepared.id };
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
    ),
    headers = {
      cookie: `distributor_session=${login.token}`,
      "x-csrf-token": login.csrf,
      origin: "http://localhost:3000",
      "idempotency-key": "dhl-http",
    };
  for (const mutate of [
    (p: Json) => {
      p.dhl.companyNames.shipper = 123;
    },
    (p: Json) => {
      p.dhl.companyNames.receiver = "X".repeat(101);
    },
    (p: Json) => {
      p.dhl.companyNames.extra = "secret";
    },
    (p: Json) => {
      p.dhl.customs.invoiceType = "COMMERCIAL";
    },
    (p: Json) => {
      p.dhl.customs.invoiceType = true;
    },
  ]) {
    const payload = structuredClone(input);
    mutate(payload);
    assert.equal(
      (
        await http.inject({
          method: "POST",
          url: "/api/commands/carrier.prepare",
          headers,
          payload,
        })
      ).statusCode,
      400,
    );
  }
  const prepared = await http.inject({
    method: "POST",
    url: "/api/commands/carrier.prepare",
    headers,
    payload: input,
  });
  assert.equal(prepared.statusCode, 200, prepared.body);
  const id = prepared.json().id,
    url = `/api/carrier/${id}/label`;
  const review = await http.inject({
    method: "GET",
    url: `/api/shipments/${f.shipmentId}/carrier`,
    headers,
  });
  assert.deepEqual(review.json().booking.dhl, input.dhl);
  const sent = await http.inject({
    method: "POST",
    url: `/api/carrier/${id}/send`,
    headers: { ...headers, "idempotency-key": "dhl-send" },
    payload: {},
  });
  assert.equal(sent.statusCode, 200, sent.body);
  assert.equal((await http.inject({ method: "GET", url })).statusCode, 401);
  const label = await http.inject({ method: "GET", url, headers });
  assert.equal(label.statusCode, 200, label.body);
  assert.equal(label.headers["x-label-media-type"], "application/pdf");
  assert.equal(label.headers["content-type"], "application/octet-stream");
  assert.match(label.headers["cache-control"] as string, /no-store/);
  assert.deepEqual(
    (await PDFDocument.load(label.rawPayload))
      .getPages()
      .map((p) => p.getWidth()),
    [201, 301, 302, 401],
  );
  f.app.identity.createUser(f.actor, "dhl-buyer", {
    email: "buyer@example.test",
    name: "Synthetic buyer",
    password: "long-test-only-password",
    role: "buyer",
    accountId: f.buyer,
    sites: [],
  });
  const buyer = f.app.identity.login(
    "buyer@example.test",
    "long-test-only-password",
  );
  assert.equal(
    (
      await http.inject({
        method: "GET",
        url,
        headers: { cookie: `distributor_session=${buyer.token}` },
      })
    ).statusCode,
    403,
  );
  assert.equal(sim.calls.length, 1);
  assert.deepEqual(native(f), before);
});

for (const country of ["US", "CA"] as const)
  test(`DHL ${country} configured startup dispatches with captured credentials and exact reviewed configuration`, async (t) => {
    const f = setup(t, country),
      sim = simulator(),
      before = native(f),
      env = environment(f),
      runtime = configuredCarriers(f.app, env, sim.transport)!;
    assert.equal(sim.calls.length, 0);
    f.app.carriers.cancel(f.actor, "dhl-date-cancel", {
      bookingId: f.prepared.id,
      reviewHash: f.prepared.reviewHash,
      reason: "Synthetic current transmission time",
    });
    const input = structuredClone(f.input);
    input.previousId = f.prepared.id;
    input.dhl!.plannedShippingAt =
      new Date(Date.now() + 86400000).toISOString().slice(0, 19) + "+00:00";
    const prepared = runtime.prepare(f.actor, "dhl-runtime-prepare", input);
    for (const key of Object.keys(env))
      env[key] = "caller-mutated-private-value";
    const result = await runtime.execute(f.actor, prepared.id);
    assert.equal(result.state, "booked");
    assert.equal(sim.calls.length, 1);
    assert.equal(
      new Headers(sim.calls[0]!.init.headers).get("authorization"),
      "Basic " +
        Buffer.from("synthetic-user:synthetic-secret").toString("base64"),
    );
    assert.equal(sim.calls[0]!.body.accounts[0].number, f.config.accountNumber);
    assert.equal(
      f.app.carriers.label(f.actor, prepared.id).mediaType,
      "application/pdf",
    );
    assert.deepEqual(native(f), before);
  });

test("DHL reviewed proforma/returns invoice types and values retain exact cents without inferred currency or FX", async (t) => {
  const f = setup(t);
  for (const invoiceType of ["commercial", "proforma", "returns"] as const) {
    const sim = simulator(),
      intent = revise(f.intent, (i) => {
        i.dhl!.customs!.invoiceType = invoiceType;
        i.dhl!.customs!.currency = "CAD";
        i.dhl!.customs!.lines[0]!.unitValueMinor = 1;
        i.dhl!.customs!.lines[1]!.unitValueMinor = 999999999999;
      });
    await new DhlTestClient(f.config, sim.transport, f.clock).book(
      intent,
      () => {},
    );
    const body = sim.calls[0]!.body;
    assert.equal(body.content.declaredValue, 10000000000);
    assert.equal(body.content.declaredValueCurrency, "CAD");
    assert.deepEqual(
      body.content.exportDeclaration.lineItems.map((l: Json) => l.price),
      [0.01, 9999999999.99],
    );
    assert.equal(
      body.outputImageProperties.imageOptions[2].invoiceType,
      invoiceType,
    );
  }
});

test("DHL refuses cent precision loss on a synthetic large packed snapshot before guard or I/O", async (t) => {
  const f = setup(t),
    sim = simulator();
  let guards = 0;
  // Validator boundary only, not a real warehouse volume/stock acceptance claim.
  const intent = revise(f.intent, (i) => {
    const line = i.dhl!.customs!.lines[0]!;
    line.quantity = 9007;
    line.unitValueMinor = 999999999999;
    i.dhl!.customs!.lines = [line];
    i.nativeSnapshot.lines = JSON.stringify([
      { allocationId: line.allocationId, quantity: line.quantity },
    ]);
  });
  await assert.rejects(
    () =>
      new DhlTestClient(f.config, sim.transport, f.clock).book(intent, () => {
        guards++;
      }),
    { code: "CARRIER_UNSUPPORTED" },
  );
  assert.equal(guards, 0);
  assert.equal(sim.calls.length, 0);
});

test("DHL retains all 50 pages but refuses a combined document over the private PDF size boundary", async (t) => {
  const f = setup(t),
    fifty = await originalPdf(500, 47),
    sim = simulator({
      reply: (b) => {
        b.documents[0].content = fifty.toString("base64");
        return b;
      },
    });
  const result = await new DhlTestClient(f.config, sim.transport, f.clock).book(
    f.intent,
    () => {},
  );
  assert.equal((await PDFDocument.load(result.label.bytes)).getPageCount(), 50);
  async function padded(width: number) {
    const pdf = await PDFDocument.create(),
      page = pdf.addPage([width, 432]);
    // An original PDF comment stream, legal and deliberately uncompressed.
    page.node.addContentStream(
      pdf.context.register(
        pdf.context.stream(Buffer.from("%" + "SYNTHETIC".repeat(62000) + "\n")),
      ),
    );
    return Buffer.from(await pdf.save());
  }
  const first = await padded(501),
    second = await padded(502);
  assert.ok(first.byteLength < 1048576 && second.byteLength < 1048576);
  const bounded = simulator({
    reply: (b) => {
      b.documents[0].content = first.toString("base64");
      b.documents[1].content = second.toString("base64");
      return b;
    },
  });
  await assert.rejects(
    () =>
      new DhlTestClient(f.config, bounded.transport, f.clock).book(
        f.intent,
        () => {},
      ),
    { code: "CARRIER_RESULT" },
  );
  assert.equal(bounded.calls.length, 1);
});

test("DHL native guard observes choice withdrawal between claim and sole write without purchasing", async (t) => {
  const f = setup(t),
    before = native(f),
    sim = simulator(),
    client = new DhlTestClient(f.config, sim.transport, f.clock);
  await assert.rejects(
    () =>
      f.app.carriers.execute(f.actor, f.prepared.id, {
        provider: client.provider,
        sandbox: true,
        configuration: client.configuration,
        lookup: client.lookup.bind(client),
        book: (intent, guard) =>
          client.book(intent, () => {
            chooseProviders(f, f.actor, "dhl-guard-withdraw", {
              accountId: f.buyer,
              region: "US",
              mode: "strict",
              providers: [],
              version: 2,
              acknowledgment: "Synthetic withdrawal immediately before I/O",
            });
            guard();
          }),
      }),
    { code: "RESIDENCY_BLOCKED" },
  );
  assert.equal(sim.calls.length, 0);
  assert.equal(
    f.app.carriers.review(f.actor, f.shipmentId).booking!.state,
    "unknown",
  );
  assert.deepEqual(native(f), before);
});

test("DHL rejects unsuccessful HTTP metadata and cancels unread response streams", async (t) => {
  const f = setup(t);
  let canceled = false;
  const sim = simulator({
    raw: () =>
      new Response(
        new ReadableStream({
          cancel() {
            canceled = true;
          },
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      ),
  });
  await assert.rejects(
    () =>
      new DhlTestClient(f.config, sim.transport, f.clock).book(
        f.intent,
        () => {},
      ),
    { code: "CARRIER_TRANSPORT" },
  );
  assert.equal(canceled, true);
  assert.equal(sim.calls.length, 1);
});
