import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, accept, chooseProviders } from "./fixtures.ts";
import {
  setup as canadaPostSetup,
  origin,
  native,
} from "./canada-post-fixture.ts";
import {
  DemoCarrier,
  DemoCanadaPost,
  demoCarriers,
} from "../src/demo/carriers.ts";
import { CarrierRuntime } from "../src/server/carrier-runtime.ts";
import type { CarrierIntent } from "../src/server/carrier-bookings.ts";
import { PDFDocument } from "pdf-lib";

function setup(t: Parameters<typeof fixture>[0]) {
  const f = fixture(t);
  chooseProviders(f, f.actor, "consent", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["ups"],
    version: 1,
    acknowledgment: "Fictional carrier only",
  });
  const runtime = demoCarriers(f.app, f.actor);
  const orderId = accept(f).id;
  const picks = f.app.fulfillment.picks(f.actor, orderId);
  for (const pick of picks)
    f.app.fulfillment.pick(f.actor, "pick" + pick.id, {
      orderId,
      allocationId: pick.id,
      serial: pick.serial,
    });
  const address = "Synthetic receiver, 2 Test Street, Ottawa ON K1A 0B1, CA";
  const shipment = f.app.fulfillment.pack(f.actor, "pack", {
    orderId,
    revision: f.app.orders.order(f.actor, orderId).revision,
    mode: "carrier",
    address,
    lines: picks.map((p) => ({ allocationId: p.id, quantity: p.quantity })),
  });
  const booking = runtime.prepare(f.actor, "prepare", {
    shipmentId: shipment.id,
    previousId: null,
    provider: "ups",
    service: "DEMO_GROUND",
    configurationHash: runtime
      .configurations(f.actor, f.w1)
      .find((c) => c.provider === "ups")!.hash,
    origin,
    destination: {
      ...origin,
      name: "Synthetic receiver",
      line1: "2 Test Street",
      city: "Ottawa",
      postalCode: "K1A 0B1",
    },
    parcel: { weightGrams: 1000, lengthMm: 100, widthMm: 100, heightMm: 100 },
    reviewedDestination: address,
    acknowledgment: "Fictional reviewed parcel",
  });
  return { ...f, runtime, shipment, booking, orderId };
}

test("offline carrier booking retains native label, explicit handover and one invoice", async (t) => {
  const f = setup(t);
  assert.equal(f.runtime.configurations(f.actor, f.w1).length, 5);
  const booked = await f.runtime.execute(f.actor, f.booking.id);
  assert.equal(booked.state, "booked");
  assert.match(booked.tracking!, /^DEMO-/);
  assert.equal(
    (
      await PDFDocument.load(f.app.carriers.label(f.actor, f.booking.id).bytes)
    ).getPageCount(),
    1,
  );
  assert.equal(
    f.app.fulfillment.shipment(f.actor, f.shipment.id).state,
    "packed",
  );
  assert.equal(f.app.billing.invoices(f.actor).length, 0);
  await assert.rejects(f.runtime.execute(f.actor, f.booking.id), {
    code: "STATE",
  });
  const input = {
    shipmentId: f.shipment.id,
    carrier: "ups",
    tracking: booked.tracking!,
    handoverEvidence: "Fictional handover",
  };
  const shipped = f.app.fulfillment.commit(f.actor, "handover", input);
  assert.deepEqual(
    f.app.fulfillment.commit(f.actor, "handover", input),
    shipped,
  );
  assert.equal(f.app.billing.invoices(f.actor).length, 1);
  assert.equal(f.app.orders.order(f.actor, f.orderId).state, "closed");
});

test("withdrawn customer permission stops demo carrier dispatch", async (t) => {
  const f = setup(t);
  chooseProviders(f, f.actor, "withdraw", {
    accountId: f.buyer,
    region: "CA",
    mode: "strict",
    providers: [],
    version: 2,
    acknowledgment: "Fictional withdrawal",
  });
  await assert.rejects(f.runtime.execute(f.actor, f.booking.id));
  assert.equal(
    f.app.fulfillment.shipment(f.actor, f.shipment.id).state,
    "packed",
  );
  assert.equal(f.app.billing.invoices(f.actor).length, 0);
  assert.equal(
    f.app.carriers.review(f.actor, f.shipment.id).booking!.hasLabel,
    false,
  );
});

test("offline Canada Post uses grouped creation and manifest before native handover", async (t) => {
  const f = canadaPostSetup(t, 2),
    client = new DemoCanadaPost();
  const runtime = new CarrierRuntime(
    f.app,
    [],
    [{ orgId: f.actor.orgId, warehouseId: f.w1, client }],
  );
  const before = native(f);
  const group = runtime.prepareCanadaPostGroup(f.actor, "group", {
    warehouseId: f.w1,
    entries: f.input.entries,
  });
  for (const entry of f.input.entries)
    await runtime.createCanadaPostMember(f.actor, group.id, entry.bookingId);
  const handover = (i: number) =>
    f.app.fulfillment.commit(f.actor, "handover" + i, {
      shipmentId: f.shipments[i]!,
      carrier: "canada-post",
      tracking: f.app.carriers.review(f.actor, f.shipments[i]!).booking!
        .tracking!,
      handoverEvidence: "Fictional handover",
    });
  assert.throws(() => handover(0));
  const review = runtime.reviewCanadaPostManifest(f.actor, group.id);
  assert.equal(
    (
      await runtime.transmitCanadaPostManifest(
        f.actor,
        group.id,
        review.reviewHash,
      )
    ).state,
    "transmitted",
  );
  assert.equal(
    (
      await PDFDocument.load(
        f.app.carriers.canadaPostManifestDocument(f.actor, group.id).bytes,
      )
    ).getPageCount(),
    1,
  );
  assert.deepEqual(native(f), before);
  for (let i = 0; i < f.shipments.length; i++) {
    assert.equal(
      (
        await PDFDocument.load(
          f.app.carriers.label(f.actor, f.input.entries[i]!.bookingId).bytes,
        )
      ).getPageCount(),
      1,
    );
    handover(i);
  }
  assert.equal(f.app.billing.invoices(f.actor).length, 2);
  await assert.rejects(
    runtime.transmitCanadaPostManifest(f.actor, group.id, review.reviewHash),
  );
});

test("demo carrier refuses failed final guard and isolates lookup results between workspaces", async () => {
  const a = new DemoCarrier("ups"),
    b = new DemoCarrier("ups");
  const intent = {
    bookingId: "fixture-booking",
    reviewHash: "fixture-review",
    provider: "ups",
    configurationHash: a.configuration.hash,
    configuration: a.configuration,
  } as CarrierIntent;
  await assert.rejects(
    a.book(intent, () => {
      throw Error("grant revoked");
    }),
    /grant revoked/,
  );
  assert.equal(await a.lookup(intent), null);
  const result = await a.book(intent, () => {});
  result.label.bytes.fill(0);
  assert.match(
    (await a.lookup(intent))!.label.bytes.toString("ascii", 0, 5),
    /^%PDF-/,
  );
  assert.equal(await b.lookup(intent), null);
  await assert.rejects(a.lookup({ ...intent, reviewHash: "changed" }), {
    code: "CARRIER_MISMATCH",
  });
});

test("Canada Post simulation keeps recovery read-only, checks final permission and rejects foreign manifest members", async () => {
  const client = new DemoCanadaPost(),
    other = new DemoCanadaPost();
  const intent = {
    bookingId: "fixture-booking",
    reviewHash: "fixture-review",
    provider: "canada-post",
  } as CarrierIntent;
  await assert.rejects(
    client.create(intent, "group", () => {
      throw Error("revoked");
    }),
    /revoked/,
  );
  assert.equal(await client.lookup(intent, "group"), null);
  const result = await client.create(intent, "group", () => {});
  assert.equal(await other.lookup(intent, "group"), null);
  const review = {
    manifestId: "manifest",
    groupId: "group",
    entries: [
      { intent, shipmentId: result.shipmentId, tracking: result.tracking },
    ],
  };
  assert.equal(await client.recoverManifest(review), null);
  await assert.rejects(
    other.transmitManifest(review, () => {}),
    { code: "CARRIER_MISMATCH" },
  );
  await assert.rejects(
    client.transmitManifest(review, () => {
      throw Error("revoked");
    }),
    /revoked/,
  );
  assert.equal(await client.recoverManifest(review), null);
  const manifest = await client.transmitManifest(review, () => {});
  manifest.document.bytes.fill(0);
  manifest.shipmentIds.length = 0;
  const retained = (await client.recoverManifest(review))!;
  assert.equal(retained.shipmentIds.length, 1);
  assert.equal(retained.document.bytes.subarray(0, 5).toString(), "%PDF-");
  assert.equal(await other.recoverManifest(review), null);
});

test("native carrier runtime refuses a non-warehouse role even when the booking exists", async (t) => {
  const f = setup(t);
  const user = f.app.identity.createUser(f.actor, "support-user", {
    email: "carrier-support@example.test",
    password: "Fictional-support-password-42!",
    name: "Fictional support",
    role: "support",
    sites: [f.w1],
    requirePasswordChange: false,
  });
  const support = f.app.identity.currentActor({ ...f.actor, id: user.id });
  assert.throws(() => f.runtime.execute(support, f.booking.id), {
    code: "FORBIDDEN",
  });
  assert.equal(
    f.app.carriers.review(f.actor, f.shipment.id).booking!.state,
    "pending",
  );
  assert.equal(f.app.billing.invoices(f.actor).length, 0);
});
