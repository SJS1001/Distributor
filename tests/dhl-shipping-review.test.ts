import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, accept, chooseProviders } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import { captureDhlReview } from "../src/server/dhl-shipping-review.ts";
import type {
  CarrierPrepare,
  DhlShippingReview,
} from "../src/shared/carrier-booking.ts";

function dhlFixture(
  t: Parameters<typeof fixture>[0],
  crossBorder = true,
  bulk = false,
) {
  const f = fixture(t, {}, "US");
  if (bulk) {
    f.product = f.app.catalog.create(f.actor, "dhl-bulk-product", {
      sku: "DHL-BULK",
      name: "Synthetic bulk equipment",
      serialized: false,
      unitPrice: 5000,
      taxBasisPoints: 0,
    }).id;
    const poId = f.app.procurement.create(f.actor, "dhl-bulk-po", {
      supplierId: f.supplier,
      warehouseId: f.w1,
      lines: [{ productId: f.product, quantity: 3, unitCost: 2500 }],
    }).id;
    const line = f.app.procurement.orders(f.actor).find((p) => p.id === poId)!
      .lines[0]!;
    f.app.procurement.receive(f.actor, "dhl-bulk-receive", {
      poId,
      lineId: String(line.id),
      deliveryRef: "SYNTHETIC-DHL-BULK",
      quantity: 3,
      serials: [],
      bin: "B-1",
      quarantine: false,
    });
  }
  const orderId = accept(f, 2).id;
  chooseProviders(f, f.actor, "dhl-choice", {
    accountId: f.buyer,
    region: "US",
    mode: "provider-exceptions",
    providers: ["dhl-express", "usps"],
    version: 1,
    acknowledgment: "Synthetic customer choice; no actual terms qualification",
  });
  const picks = f.app.fulfillment.picks(f.actor, orderId);
  for (const pick of picks)
    f.app.fulfillment.pick(f.actor, `dhl-pick-${pick.id}`, {
      orderId,
      allocationId: pick.id,
      serial: pick.serial,
    });
  const address = crossBorder
    ? "Synthetic Toronto recipient reviewed manually"
    : "Synthetic Buffalo recipient reviewed manually";
  const shipmentId = f.app.fulfillment.pack(f.actor, "dhl-pack", {
    orderId,
    revision: f.app.orders.order(f.actor, orderId).revision,
    mode: "carrier",
    address,
    lines: picks.map((p) => ({ allocationId: p.id, quantity: p.quantity })),
  }).id;
  const origin = {
    name: "Synthetic shipper",
    line1: "10 Test Road",
    line2: "",
    city: "Buffalo",
    province: "NY",
    postalCode: "14201",
    country: "US" as const,
    phone: "7165550100",
  };
  const dhl: DhlShippingReview = {
    plannedShippingAt: "2026-10-03T10:30:00-04:00",
    description: "Synthetic equipment",
    incoterm: "DAP",
    ...(crossBorder
      ? {
          customs: {
            currency: "CAD" as const,
            invoiceNumber: "SYNTHETIC-EXPORT-1",
            invoiceDate: "2026-10-01",
            exportReason: "commercial_purpose_or_sale" as const,
            acknowledgment:
              "Synthetic review of classification, origin, values and every packed line",
            lines: picks.map((p, i) => ({
              allocationId: p.id,
              quantity: p.quantity,
              description: `Synthetic equipment ${i + 1}`,
              unitValueMinor: 12345 + i,
              manufacturerCountry: "US",
              commodityCode: "001234",
              netWeightGrams: 250,
            })),
          },
        }
      : {}),
  };
  const input: CarrierPrepare = {
    shipmentId,
    previousId: null,
    provider: "dhl-express",
    service: "Synthetic explicit service",
    origin,
    destination: crossBorder
      ? {
          ...origin,
          name: "Synthetic recipient",
          line1: "20 Test Road",
          city: "Toronto",
          province: "ON",
          postalCode: "M5V 2T6",
          country: "CA",
        }
      : { ...origin, line1: "20 Test Road" },
    parcel: { weightGrams: 1000, lengthMm: 300, widthMm: 200, heightMm: 100 },
    reviewedDestination: address,
    acknowledgment: "Synthetic manually matched address review",
    dhl,
  };
  return Object.assign(f, { orderId, shipmentId, input });
}
const native = (f: ReturnType<typeof dhlFixture>) => ({
  stock: f.app.inventory.stock(f.actor),
  order: f.app.orders.order(f.actor, f.orderId),
  invoices: f.app.billing.invoices(f.actor),
  shipment: f.app.fulfillment.shipment(f.actor, f.shipmentId),
});

test("DHL exact declarations survive real database restart, replay, returned-object mutation and cancellation history without native changes", (t) => {
  const f = dhlFixture(t),
    before = native(f),
    original = structuredClone(f.input);
  const first = f.app.carriers.prepare(f.actor, "dhl-review", f.input);
  assert.deepEqual(
    f.app.carriers.review(f.actor, f.shipmentId).booking!.dhl,
    original.dhl,
  );
  const returned = f.app.carriers.review(f.actor, f.shipmentId).booking!.dhl!;
  returned.customs!.lines[0]!.unitValueMinor = 1;
  f.input.dhl!.customs!.lines[0]!.description =
    "Changed caller-owned description";
  assert.deepEqual(
    f.app.carriers.review(f.actor, f.shipmentId).booking!.dhl,
    original.dhl,
  );
  assert.throws(() => f.app.carriers.prepare(f.actor, "dhl-review", f.input), {
    code: "IDEMPOTENCY_CONFLICT",
  });
  f.app.close();
  f.app = new Application(f.path, "US");
  assert.deepEqual(
    f.app.carriers.prepare(f.actor, "dhl-review", original),
    first,
  );
  assert.deepEqual(native(f), before);
  f.app.carriers.cancel(f.actor, "dhl-cancel", {
    bookingId: first.id,
    reviewHash: first.reviewHash,
    reason: "Synthetic unsent correction",
  });
  const replacement = structuredClone(original);
  replacement.previousId = first.id;
  replacement.dhl!.customs!.lines[0]!.unitValueMinor++;
  const second = f.app.carriers.prepare(
    f.actor,
    "dhl-replacement",
    replacement,
  );
  assert.notEqual(first.reviewHash, second.reviewHash);
  const history = f.app.carriers.history(f.actor, f.shipmentId).items;
  assert.deepEqual(
    history.map((b) => b.state),
    ["canceled", "pending"],
  );
  assert.deepEqual(history[0]!.dhl, original.dhl);
  assert.deepEqual(history[1]!.dhl, replacement.dhl);
  assert.deepEqual(native(f), before);
});

const badReviews: [string, (input: any) => void, string?][] = [
  [
    "missing review",
    (p) => {
      delete p.dhl;
    },
  ],
  [
    "cross-border missing customs",
    (p) => {
      delete p.dhl.customs;
    },
  ],
  [
    "unsupported review field",
    (p) => {
      p.dhl.isDocument = true;
    },
  ],
  [
    "unsupported customs field",
    (p) => {
      p.dhl.customs.automaticTax = true;
    },
  ],
  [
    "unsupported line field",
    (p) => {
      p.dhl.customs.lines[0].sku = "Invented";
    },
  ],
  [
    "unsupported incoterm",
    (p) => {
      p.dhl.incoterm = "DDP";
    },
  ],
  [
    "unknown export reason",
    (p) => {
      p.dhl.customs.exportReason = "sale";
    },
  ],
  [
    "missing offset",
    (p) => {
      p.dhl.plannedShippingAt = "2026-10-03T10:30:00Z";
    },
  ],
  [
    "unknown offset",
    (p) => {
      p.dhl.plannedShippingAt = "2026-10-03T10:30:00-00:00";
    },
  ],
  [
    "calendar rollover",
    (p) => {
      p.dhl.plannedShippingAt = "2026-02-30T10:30:00-04:00";
    },
  ],
  [
    "clock rollover",
    (p) => {
      p.dhl.plannedShippingAt = "2026-10-03T24:30:00-04:00";
    },
  ],
  [
    "offset overflow",
    (p) => {
      p.dhl.plannedShippingAt = "2026-10-03T10:30:00+14:01";
    },
  ],
  [
    "invoice rollover",
    (p) => {
      p.dhl.customs.invoiceDate = "2026-02-30";
    },
  ],
  [
    "future invoice",
    (p) => {
      p.dhl.customs.invoiceDate = "2026-10-04";
    },
  ],
  [
    "currency not explicit",
    (p) => {
      p.dhl.customs.currency = "EUR";
    },
  ],
  [
    "empty invoice",
    (p) => {
      p.dhl.customs.invoiceNumber = " ";
    },
  ],
  [
    "oversized invoice",
    (p) => {
      p.dhl.customs.invoiceNumber = "X".repeat(36);
    },
  ],
  [
    "empty acknowledgment",
    (p) => {
      p.dhl.customs.acknowledgment = "";
    },
  ],
  [
    "control text",
    (p) => {
      p.dhl.description = "Goods\nmore";
    },
  ],
  [
    "padded line description",
    (p) => {
      p.dhl.customs.lines[0].description = " Padded";
    },
  ],
  [
    "foreign allocation",
    (p) => {
      p.dhl.customs.lines[0].allocationId = "foreign";
    },
    "CARRIER_MISMATCH",
  ],
  [
    "omitted allocation",
    (p) => {
      p.dhl.customs.lines.pop();
    },
    "CARRIER_MISMATCH",
  ],
  [
    "duplicate allocation",
    (p) => {
      p.dhl.customs.lines[1] = p.dhl.customs.lines[0];
    },
    "CARRIER_MISMATCH",
  ],
  [
    "altered packed quantity",
    (p) => {
      p.dhl.customs.lines[0].quantity = 2;
    },
    "CARRIER_MISMATCH",
  ],
  [
    "fractional quantity",
    (p) => {
      p.dhl.customs.lines[0].quantity = 0.5;
    },
  ],
  [
    "zero value",
    (p) => {
      p.dhl.customs.lines[0].unitValueMinor = 0;
    },
  ],
  [
    "fractional minor value",
    (p) => {
      p.dhl.customs.lines[0].unitValueMinor = 1.5;
    },
  ],
  [
    "unbounded value",
    (p) => {
      p.dhl.customs.lines[0].unitValueMinor = 1e13;
    },
  ],
  [
    "unsupported origin format",
    (p) => {
      p.dhl.customs.lines[0].manufacturerCountry = "usa";
    },
  ],
  [
    "short commodity code",
    (p) => {
      p.dhl.customs.lines[0].commodityCode = "12345";
    },
  ],
  [
    "nonnumeric commodity code",
    (p) => {
      p.dhl.customs.lines[0].commodityCode = "12A456";
    },
  ],
  [
    "net weight exceeds gross",
    (p) => {
      for (const l of p.dhl.customs.lines) l.netWeightGrams = 600;
    },
  ],
  [
    "sparse lines",
    (p) => {
      delete p.dhl.customs.lines[0];
    },
  ],
  [
    "symbol array property",
    (p) => {
      p.dhl.customs.lines[Symbol("extra")] = true;
    },
  ],
  [
    "excess lines",
    (p) => {
      p.dhl.customs.lines = Array(101).fill(p.dhl.customs.lines[0]);
    },
  ],
  [
    "null customs",
    (p) => {
      p.dhl.customs = null;
    },
  ],
];
test("DHL malformed and native-mismatched declarations fail atomically", async (t) => {
  const f = dhlFixture(t),
    before = native(f);
  for (const [name, mutate, code = "VALIDATION"] of badReviews)
    await t.test(name, () => {
      const input = structuredClone(f.input);
      mutate(input);
      assert.throws(
        () => f.app.carriers.prepare(f.actor, `bad-${name}`, input),
        { code },
      );
      assert.equal(f.app.carriers.review(f.actor, f.shipmentId).booking, null);
      assert.deepEqual(native(f), before);
    });
});

test("DHL domestic reviews omit customs and other carriers cannot silently ignore DHL fields", (t) => {
  const f = dhlFixture(t, false),
    before = native(f);
  const cross = dhlFixture(t);
  assert.throws(
    () =>
      f.app.carriers.prepare(f.actor, "domestic-customs", {
        ...f.input,
        dhl: cross.input.dhl,
      }),
    { code: "VALIDATION" },
  );
  assert.throws(
    () =>
      f.app.carriers.prepare(f.actor, "wrong-carrier", {
        ...f.input,
        provider: "usps",
      }),
    { code: "VALIDATION" },
  );
  const receipt = f.app.carriers.prepare(f.actor, "domestic", f.input);
  assert.equal(
    f.app.carriers.review(f.actor, f.shipmentId).booking!.id,
    receipt.id,
  );
  assert.deepEqual(
    f.app.carriers.review(f.actor, f.shipmentId).booking!.dhl,
    f.input.dhl,
  );
  assert.deepEqual(native(f), before);
});

test("DHL integer value aggregation refuses overflow and static recovery reviews retain past dates", (t) => {
  const f = dhlFixture(t),
    shipment = f.app.fulfillment.shipment(f.actor, f.shipmentId);
  const review = structuredClone(f.input.dhl!);
  review.plannedShippingAt = "2000-02-29T23:59:59+14:00";
  review.customs!.invoiceDate = "2000-02-29";
  assert.deepEqual(
    captureDhlReview(
      review,
      shipment,
      f.input.origin,
      f.input.destination,
      f.input.parcel,
    ),
    review,
  );
  const line = review.customs!.lines[0]!;
  line.quantity = 10000;
  line.unitValueMinor = 1e12;
  review.customs!.lines = [line];
  const bulkSnapshot = {
    ...shipment,
    lines: JSON.stringify([
      { allocationId: line.allocationId, quantity: line.quantity },
    ]),
  };
  assert.throws(
    () =>
      captureDhlReview(
        review,
        bulkSnapshot,
        f.input.origin,
        f.input.destination,
        f.input.parcel,
      ),
    { code: "VALIDATION" },
  );
});

test("DHL bulk declaration matches full native packed quantity with total line weight and explicit currency", (t) => {
  const f = dhlFixture(t, true, true),
    before = native(f);
  assert.equal(f.input.dhl!.customs!.lines.length, 1);
  assert.equal(f.input.dhl!.customs!.lines[0]!.quantity, 2);
  const shortened = structuredClone(f.input);
  shortened.dhl!.customs!.lines[0]!.quantity = 1;
  assert.throws(
    () => f.app.carriers.prepare(f.actor, "bulk-omission", shortened),
    { code: "CARRIER_MISMATCH" },
  );
  f.input.dhl!.customs!.currency = "USD";
  const receipt = f.app.carriers.prepare(f.actor, "bulk-full", f.input);
  const saved = f.app.carriers.review(f.actor, f.shipmentId).booking!;
  assert.equal(saved.id, receipt.id);
  assert.deepEqual(saved.dhl, f.input.dhl);
  assert.equal(saved.dhl!.customs!.lines[0]!.netWeightGrams, 250);
  assert.deepEqual(native(f), before);
});

test("DHL Canadian origin to US destination retains its independently reviewed declaration", (t) => {
  const f = dhlFixture(t),
    before = native(f);
  [f.input.origin, f.input.destination] = [f.input.destination, f.input.origin];
  f.input.dhl!.customs!.lines[0]!.manufacturerCountry = "CA";
  f.app.carriers.prepare(f.actor, "ca-to-us", f.input);
  const saved = f.app.carriers.review(f.actor, f.shipmentId).booking!;
  assert.equal(saved.origin.country, "CA");
  assert.equal(saved.destination.country, "US");
  assert.deepEqual(saved.dhl, f.input.dhl);
  assert.deepEqual(native(f), before);
});

test("DHL retained declarations detect stored tampering", (t) => {
  const f = dhlFixture(t),
    before = native(f),
    receipt = f.app.carriers.prepare(f.actor, "integrity", f.input);
  const store = f.app.database.owned("integration"),
    row = store.get<{ intent: string }>(
      "SELECT intent FROM integration_carrier_bookings WHERE id=?",
      receipt.id,
    )!;
  const intent = JSON.parse(row.intent);
  intent.dhl.customs.lines[0].unitValueMinor++;
  store.run(
    "UPDATE integration_carrier_bookings SET intent=? WHERE id=?",
    JSON.stringify(intent),
    receipt.id,
  );
  assert.throws(() => f.app.carriers.review(f.actor, f.shipmentId), {
    code: "CARRIER_MISMATCH",
  });
  assert.throws(() => f.app.carriers.history(f.actor, f.shipmentId), {
    code: "CARRIER_MISMATCH",
  });
  assert.deepEqual(native(f), before);
});

for (const restriction of ["site", "role", "inactive", "password"] as const)
  test(`DHL declaration review and cached preparation recheck current ${restriction} authority`, (t) => {
    const f = dhlFixture(t),
      before = native(f);
    const user = f.app.identity.createUser(f.actor, `dhl-user-${restriction}`, {
      email: `${restriction}@dhl.example.test`,
      name: "Synthetic warehouse reviewer",
      role: "warehouse",
      sites: [f.w1],
      password: "long-test-only-password",
    });
    const actor = f.app.identity.currentActor({ ...f.actor, id: user.id });
    const receipt = f.app.carriers.prepare(actor, "dhl-scoped", f.input);
    const iam = f.app.database.owned("iam");
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
    const forged = { ...actor, role: "admin" as const, sites: [f.w1] };
    assert.throws(() => f.app.carriers.prepare(forged, "dhl-scoped", f.input));
    assert.throws(() => f.app.carriers.review(forged, f.shipmentId));
    assert.throws(() => f.app.carriers.history(forged, f.shipmentId));
    assert.equal(
      f.app.carriers.review(f.actor, f.shipmentId).booking!.id,
      receipt.id,
    );
    assert.deepEqual(native(f), before);
  });

test("DHL customer withdrawal refuses new declaration capture without creating a booking", (t) => {
  const f = dhlFixture(t),
    before = native(f);
  chooseProviders(f, f.actor, "dhl-withdraw", {
    accountId: f.buyer,
    region: "US",
    mode: "strict",
    providers: [],
    version: 2,
    acknowledgment: "Synthetic withdrawal before preparation",
  });
  assert.throws(() => f.app.carriers.prepare(f.actor, "withdrawn", f.input), {
    code: "RESIDENCY_BLOCKED",
  });
  assert.equal(f.app.carriers.review(f.actor, f.shipmentId).booking, null);
  assert.deepEqual(native(f), before);
});

test("DHL declaration capture rolls back its intent and command when audit persistence fails", (t) => {
  const f = dhlFixture(t),
    before = native(f),
    platform = f.app.database.owned("platform");
  platform.migrate(
    "CREATE TRIGGER platform_test_dhl_audit BEFORE INSERT ON platform_audit BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END;",
  );
  assert.throws(() =>
    f.app.carriers.prepare(f.actor, "audit-rollback", f.input),
  );
  assert.equal(f.app.carriers.review(f.actor, f.shipmentId).booking, null);
  assert.equal(
    platform.get(
      "SELECT 1 FROM platform_commands WHERE name='carrier.prepare' AND key='audit-rollback'",
    ),
    undefined,
  );
  assert.deepEqual(native(f), before);
  platform.migrate("DROP TRIGGER platform_test_dhl_audit;");
  const receipt = f.app.carriers.prepare(f.actor, "audit-rollback", f.input);
  assert.equal(
    f.app.carriers.review(f.actor, f.shipmentId).booking!.id,
    receipt.id,
  );
});

test("DHL declaration API rejects unknown nested fields, missing reviews and CSRF failures; retained review is authenticated", async (t) => {
  const f = dhlFixture(t),
    before = native(f),
    http = await createHttp(f.app, { origin: "http://localhost:3000" });
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
    "idempotency-key": "http-dhl",
  };
  const url = "/api/commands/carrier.prepare";
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url,
        headers: { ...headers, "x-csrf-token": "wrong" },
        payload: f.input,
      })
    ).statusCode,
    403,
  );
  for (const mutate of [
    (p: any) => {
      p.dhl.customs.lines[0].unitValueMinor = "100";
    },
    (p: any) => {
      p.dhl.customs.lines[0].unsupported = true;
    },
    (p: any) => {
      p.dhl.customs.unsupported = true;
    },
    (p: any) => {
      p.dhl.unsupported = true;
    },
    (p: any) => {
      delete p.dhl;
    },
  ]) {
    const payload = structuredClone(f.input);
    mutate(payload);
    assert.equal(
      (await http.inject({ method: "POST", url, headers, payload })).statusCode,
      400,
    );
  }
  const prepared = await http.inject({
    method: "POST",
    url,
    headers,
    payload: f.input,
  });
  assert.equal(prepared.statusCode, 200, prepared.body);
  const replay = await http.inject({
    method: "POST",
    url,
    headers,
    payload: f.input,
  });
  assert.deepEqual(replay.json(), prepared.json());
  const reviewUrl = `/api/shipments/${f.shipmentId}/carrier`;
  assert.equal(
    (await http.inject({ method: "GET", url: reviewUrl })).statusCode,
    401,
  );
  const read = await http.inject({ method: "GET", url: reviewUrl, headers });
  assert.equal(read.statusCode, 200);
  assert.deepEqual(read.json().booking.dhl, f.input.dhl);
  assert.deepEqual(native(f), before);
});
