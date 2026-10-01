import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fixture, accept, chooseProviders } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import type {
  CarrierAdapter,
  CarrierIntent,
  CarrierResult,
} from "../src/server/carrier-bookings.ts";
import { createHttp } from "../src/server/http.ts";
import { CarrierRuntime } from "../src/server/carrier-runtime.ts";
import type { Actor, Role } from "../src/server/core.ts";
import type {
  CarrierPrepare,
  CarrierAddress,
} from "../src/shared/carrier-booking.ts";

const origin: CarrierAddress = {
  name: "Synthetic warehouse",
  line1: "1 Test Street",
  line2: "",
  city: "Toronto",
  province: "ON",
  postalCode: "M5V 1A1",
  country: "CA",
  phone: "4165550100",
};
const destination: CarrierAddress = {
  ...origin,
  name: "Synthetic receiver",
  line1: "2 Test Street",
  city: "Ottawa",
  postalCode: "K1A 0B1",
};
function setup(t: Parameters<typeof fixture>[0]) {
  const f = fixture(t),
    orderId = accept(f).id;
  chooseProviders(f, f.actor, "carrier-choice", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["ups"],
    version: 1,
    acknowledgment: "Synthetic named carrier acceptance",
  });
  const picks = f.app.fulfillment.picks(f.actor, orderId);
  for (const a of picks)
    f.app.fulfillment.pick(f.actor, `pick-${a.id}`, {
      orderId,
      allocationId: a.id,
      serial: a.serial,
    });
  const address = "Synthetic receiver, 2 Test Street, Ottawa ON K1A 0B1, CA";
  const shipmentId = f.app.fulfillment.pack(f.actor, "carrier-pack", {
    orderId,
    revision: f.app.orders.order(f.actor, orderId).revision,
    mode: "carrier",
    address,
    lines: picks.map((a) => ({ allocationId: a.id, quantity: a.quantity })),
  }).id;
  const input: CarrierPrepare = {
    shipmentId,
    previousId: null,
    provider: "ups",
    service: "Synthetic ground",
    origin,
    destination,
    parcel: { weightGrams: 1000, lengthMm: 100, widthMm: 100, heightMm: 100 },
    reviewedDestination: address,
    acknowledgment: "Synthetic explicit destination and parcel review",
  };
  return { ...f, orderId, shipmentId, input };
}
type F = ReturnType<typeof setup>;
function user(f: F, role: Role = "warehouse", sites = [f.w1]): Actor {
  const u = f.app.identity.createUser(f.actor, `carrier-user-${role}`, {
    email: `${role}@carrier.example.test`,
    name: "Synthetic carrier user",
    password: "long-test-only-password",
    role,
    sites,
    ...(role === "buyer" ? { accountId: f.buyer } : {}),
  });
  return f.app.identity.currentActor({ ...f.actor, id: u.id });
}
function native(f: F) {
  return {
    stock: f.app.inventory.stock(f.actor),
    order: f.app.orders.order(f.actor, f.orderId),
    invoices: f.app.billing.invoices(f.actor),
    shipment: f.app.fulfillment.shipment(f.actor, f.shipmentId),
  };
}

const current = (f: F) => f.app.carriers.review(f.actor, f.shipmentId).booking!;
const cancellation = (
  f: F,
  reason = "Synthetic unsent booking canceled after review",
) => ({ bookingId: current(f).id, reviewHash: current(f).reviewHash, reason });

test("carrier prepare/cancel exact receipts, conflicting payloads and canceled successor preserve native facts", (t) => {
  const f = setup(t),
    before = native(f);
  const prepared = f.app.carriers.prepare(f.actor, "prepare", f.input);
  assert.deepEqual(
    f.app.carriers.prepare(f.actor, "prepare", f.input),
    prepared,
  );
  assert.throws(
    () =>
      f.app.carriers.prepare(f.actor, "prepare", {
        ...f.input,
        service: "Changed service",
      }),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  assert.throws(() => f.app.carriers.prepare(f.actor, "second-key", f.input));
  assert.equal(f.app.carriers.history(f.actor, f.shipmentId).items.length, 1);
  assert.equal(current(f).state, "pending");
  const cancel = cancellation(f),
    canceled = f.app.carriers.cancel(f.actor, "cancel", cancel);
  assert.deepEqual(f.app.carriers.cancel(f.actor, "cancel", cancel), canceled);
  assert.throws(
    () =>
      f.app.carriers.cancel(f.actor, "cancel", {
        ...cancel,
        reason: "Changed reason",
      }),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  assert.throws(() =>
    f.app.carriers.prepare(f.actor, "without-previous", f.input),
  );
  const next = f.app.carriers.prepare(f.actor, "successor", {
    ...f.input,
    previousId: current(f).id,
    service: "Reviewed successor service",
  });
  assert.notEqual(next.id, prepared.id);
  assert.notEqual(current(f).reviewHash, cancel.reviewHash);
  assert.equal(f.app.carriers.history(f.actor, f.shipmentId).items.length, 2);
  assert.deepEqual(native(f), before);
});

for (const patch of [
  { origin: { ...origin, country: "GB" } },
  { destination: { ...destination, country: "GB" } },
  { parcel: { weightGrams: 0, lengthMm: 100, widthMm: 100, heightMm: 100 } },
  { parcel: { weightGrams: 1000, lengthMm: -1, widthMm: 100, heightMm: 100 } },
  {
    parcel: { weightGrams: 1000.5, lengthMm: 100, widthMm: 100, heightMm: 100 },
  },
  { acknowledgment: "" },
  { reviewedDestination: "Different packed destination" },
])
  test(`carrier validates explicit reviewed addresses/parcel ${JSON.stringify(patch)}`, (t) => {
    const f = setup(t),
      before = native(f);
    assert.throws(() =>
      f.app.carriers.prepare(f.actor, "invalid", {
        ...f.input,
        ...patch,
      } as CarrierPrepare),
    );
    assert.equal(f.app.carriers.review(f.actor, f.shipmentId).booking, null);
    assert.deepEqual(native(f), before);
  });

test("carrier accepts explicit US destination without changing native packed address", (t) => {
  const f = setup(t),
    before = native(f);
  f.app.carriers.prepare(f.actor, "us-destination", {
    ...f.input,
    destination: {
      ...destination,
      country: "US",
      province: "NY",
      city: "Buffalo",
      postalCode: "14201",
    },
  });
  assert.equal(current(f).destination.country, "US");
  assert.deepEqual(native(f), before);
});

for (const restriction of ["role", "site", "inactive", "password"] as const)
  test(`fresh ${restriction} authority blocks cached prepare/cancel and history`, (t) => {
    const f = setup(t),
      actor = user(f);
    const receipt = f.app.carriers.prepare(actor, "cached-prepare", f.input),
      cancel = cancellation(f);
    f.app.carriers.cancel(actor, "cached-cancel", cancel);
    assert.equal(receipt.id, cancel.bookingId);
    restrict(f, actor, restriction);
    const forged = { ...actor, role: "admin" as const, sites: [f.w1] };
    for (const operation of [
      () => f.app.carriers.prepare(forged, "cached-prepare", f.input),
      () => f.app.carriers.cancel(forged, "cached-cancel", cancel),
      () => f.app.carriers.review(forged, f.shipmentId),
      () => f.app.carriers.history(forged, f.shipmentId),
    ])
      assert.throws(operation);
  });
function restrict(f: F, actor: Actor, kind: string) {
  const iam = f.app.database.owned("iam");
  if (kind === "role")
    iam.run(
      "UPDATE iam_users SET role='buyer',account_id=? WHERE id=?",
      f.buyer,
      actor.id,
    );
  if (kind === "site")
    iam.run("UPDATE iam_users SET sites='[]' WHERE id=?", actor.id);
  if (kind === "inactive")
    iam.run("UPDATE iam_users SET active=0 WHERE id=?", actor.id);
  if (kind === "password")
    iam.run(
      "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
      actor.id,
    );
  if (kind === "credit")
    f.app.identity.setHold(f.actor, "carrier-credit-hold", {
      accountId: f.buyer,
      held: true,
      reason: "Synthetic finance hold",
    });
  if (kind === "restore")
    f.app.platform.isolateRestore(
      "synthetic-carrier-restore",
      new Date().toISOString(),
    );
  if (kind === "choice")
    chooseProviders(f, f.actor, "carrier-withdraw", {
      accountId: f.buyer,
      region: "CA",
      mode: "strict",
      providers: [],
      version: 2,
      acknowledgment: "Synthetic withdrawal before carrier processing",
    });
  if (kind === "terms") {
    const terms = f.app.identity.residency
      .current(f.actor)
      .find((d) => d.provider === "ups")!;
    f.app.identity.residency.withdraw(f.actor, "carrier-terms-withdraw", {
      provider: "ups",
      disclosureId: terms.id,
      reason: "Synthetic changed disclosure",
    });
  }
}

const labelBytes = Buffer.from(
  "%PDF-1.7\nSynthetic test label; no actual provider evidence\n%%EOF",
);
const proof = (intent: CarrierIntent): CarrierResult => ({
  bookingId: intent.bookingId,
  reviewHash: intent.reviewHash,
  reference: "SYNTHETIC-BOOKING-1",
  tracking: "SYNTHETIC-TRACKING-1",
  label: { mediaType: "application/pdf", bytes: labelBytes },
});
const adapter = (patch: Partial<CarrierAdapter> = {}): CarrierAdapter => ({
  provider: "ups",
  sandbox: true,
  book: async (intent, guard) => {
    guard();
    return proof(intent);
  },
  lookup: async (intent) => proof(intent),
  ...patch,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function prepare(f: F, actor = f.actor) {
  return f.app.carriers.prepare(actor, "prepare", f.input);
}

for (const restriction of ["credit", "restore", "choice", "terms"] as const)
  test(`carrier ${restriction} blocks preparation and sending before adapter access`, async (t) => {
    const f = setup(t),
      receipt = prepare(f),
      before = native(f);
    restrict(f, f.actor, restriction);
    let books = 0,
      reads = 0;
    const a = adapter({
      book: async () => {
        books++;
        throw Error("must not book");
      },
      lookup: async () => {
        reads++;
        return null;
      },
    });
    await assert.rejects(f.app.carriers.execute(f.actor, receipt.id, a));
    assert.equal(books, 0);
    assert.equal(reads, 0);
    assert.equal(current(f).state, "pending");
    f.app.carriers.cancel(f.actor, "cancel", cancellation(f));
    assert.throws(() =>
      f.app.carriers.prepare(f.actor, "restricted-prepare", {
        ...f.input,
        previousId: receipt.id,
      }),
    );
    assert.deepEqual(native(f), before);
  });

for (const restriction of ["credit", "restore", "choice", "terms"] as const)
  test(`uncertain carrier lookup rechecks current ${restriction} before adapter access`, async (t) => {
    const f = setup(t),
      receipt = prepare(f),
      before = native(f);
    await assert.rejects(
      f.app.carriers.execute(
        f.actor,
        receipt.id,
        adapter({
          book: async (_intent, beforeWrite) => {
            beforeWrite();
            throw Error("Synthetic external outcome unknown");
          },
        }),
      ),
    );
    restrict(f, f.actor, restriction);
    let reads = 0,
      writes = 0;
    await assert.rejects(
      f.app.carriers.reconcile(
        f.actor,
        receipt.id,
        adapter({
          lookup: async () => {
            reads++;
            return null;
          },
          book: async (intent, beforeWrite) => {
            beforeWrite();
            writes++;
            return proof(intent);
          },
        }),
      ),
    );
    assert.equal(reads, 0);
    assert.equal(writes, 0);
    assert.equal(current(f).state, "unknown");
    assert.deepEqual(native(f), before);
  });

for (const restriction of [
  "role",
  "site",
  "inactive",
  "password",
  "credit",
  "restore",
  "choice",
  "terms",
  "lease",
] as const)
  test(`paused carrier callback rechecks ${restriction} before its only external write`, async (t) => {
    const f = setup(t),
      actor = user(f),
      receipt = prepare(f, actor),
      entered = deferred<void>(),
      resume = deferred<void>();
    let writes = 0;
    const sending = f.app.carriers.execute(
      actor,
      receipt.id,
      adapter({
        book: async (intent, guard) => {
          entered.resolve();
          await resume.promise;
          guard();
          writes++;
          return proof(intent);
        },
      }),
    );
    await entered.promise;
    if (restriction === "lease") f.app.carriers.recoverStale(0, f.actor.orgId);
    else restrict(f, actor, restriction);
    resume.resolve();
    await assert.rejects(sending);
    assert.equal(writes, 0);
    const row = f.app.database
      .owned("integration")
      .get(
        "SELECT state,token,reference FROM integration_carrier_bookings WHERE id=?",
        receipt.id,
      )!;
    assert.equal(row.state, "unknown");
    assert.equal(row.token, null);
    assert.equal(row.reference, null);
  });

test("external success with lost reply becomes unknown; lookup recovers once without another booking or native changes", async (t) => {
  const f = setup(t),
    receipt = prepare(f),
    before = native(f);
  let books = 0,
    reads = 0,
    observed!: CarrierResult;
  const a = adapter({
    book: async (intent, guard) => {
      guard();
      books++;
      observed = proof(intent);
      throw Error("Synthetic lost committed provider reply");
    },
    lookup: async () => {
      reads++;
      return observed;
    },
  });
  await assert.rejects(
    f.app.carriers.execute(f.actor, receipt.id, a),
    /lost committed/,
  );
  assert.equal(current(f).state, "unknown");
  await assert.rejects(f.app.carriers.execute(f.actor, receipt.id, a), {
    code: "STATE",
  });
  assert.throws(
    () => f.app.carriers.cancel(f.actor, "cancel", cancellation(f)),
    { code: "STATE" },
  );
  assert.throws(() =>
    f.app.carriers.prepare(f.actor, "duplicate", {
      ...f.input,
      previousId: receipt.id,
    }),
  );
  const recovered = await f.app.carriers.reconcile(f.actor, receipt.id, a);
  assert.equal(recovered.state, "booked");
  assert.equal(recovered.tracking, observed.tracking);
  assert.equal(recovered.hasLabel, true);
  const label = f.app.carriers.label(f.actor, receipt.id);
  assert.deepEqual(label.bytes, labelBytes);
  assert.equal(label.mediaType, "application/pdf");
  assert.equal(
    label.hash,
    createHash("sha256").update(labelBytes).digest("hex"),
  );
  assert.equal(books, 1);
  assert.equal(reads, 1);
  assert.deepEqual(native(f), before);
  const other = new Application(f.path, "CA");
  t.after(() => other.close());
  assert.deepEqual(
    other.carriers.review(f.actor, f.shipmentId),
    f.app.carriers.review(f.actor, f.shipmentId),
  );
  assert.equal(other.carriers.label(f.actor, receipt.id).hash, label.hash);
});

for (const invalid of [
  "null",
  "identity",
  "hash",
  "label",
  "signature",
  "oversized",
  "tracking-url",
] as const)
  test(`unqualified ${invalid} lookup leaves uncertain booking blocked`, async (t) => {
    const f = setup(t),
      receipt = prepare(f),
      before = native(f);
    await assert.rejects(
      f.app.carriers.execute(
        f.actor,
        receipt.id,
        adapter({
          book: async (_intent, guard) => {
            guard();
            throw Error("Synthetic uncertain provider result");
          },
        }),
      ),
    );
    const a = adapter({
      lookup: async (intent) => {
        if (invalid === "null") return null;
        const result = proof(intent);
        if (invalid === "identity") result.bookingId = "different-booking";
        if (invalid === "hash") result.reviewHash = "0".repeat(64);
        if (invalid === "label")
          result.label = {
            mediaType: "text/html",
            bytes: Buffer.from("<script>bad</script>"),
          } as unknown as CarrierResult["label"];
        if (invalid === "signature")
          result.label = {
            mediaType: "application/pdf",
            bytes: Buffer.from("not a PDF"),
          };
        if (invalid === "oversized")
          result.label = {
            mediaType: "application/pdf",
            bytes: Buffer.concat([
              Buffer.from("%PDF-"),
              Buffer.alloc(1_048_576),
            ]),
          };
        if (invalid === "tracking-url")
          result.tracking = "https://example.test/unsafe-tracking";
        return result;
      },
    });
    if (invalid === "null")
      assert.equal(
        (await f.app.carriers.reconcile(f.actor, receipt.id, a)).state,
        "unknown",
      );
    else await assert.rejects(f.app.carriers.reconcile(f.actor, receipt.id, a));
    assert.equal(current(f).state, "unknown");
    assert.equal(current(f).hasLabel, false);
    assert.throws(() => f.app.carriers.label(f.actor, receipt.id), {
      code: "STATE",
    });
    assert.deepEqual(native(f), before);
  });

for (const guard of ["omitted", "twice"] as const)
  test(`carrier rejects ${guard} write callback`, async (t) => {
    const f = setup(t),
      receipt = prepare(f);
    await assert.rejects(
      f.app.carriers.execute(
        f.actor,
        receipt.id,
        adapter({
          book: async (intent, beforeWrite) => {
            if (guard === "twice") {
              beforeWrite();
              beforeWrite();
            }
            return proof(intent);
          },
        }),
      ),
    );
    assert.equal(current(f).state, "unknown");
  });

test("separate SQLite connections contend for one sender and one lookup, fencing an abandoned late sender", async (t) => {
  const f = setup(t),
    receipt = prepare(f),
    other = new Application(f.path, "CA");
  t.after(() => other.close());
  const entered = deferred<void>(),
    resume = deferred<void>();
  let writes = 0;
  const sending = f.app.carriers.execute(
    f.actor,
    receipt.id,
    adapter({
      book: async (intent, guard) => {
        entered.resolve();
        await resume.promise;
        guard();
        writes++;
        return proof(intent);
      },
    }),
  );
  await entered.promise;
  await assert.rejects(other.carriers.execute(f.actor, receipt.id, adapter()), {
    code: "STATE",
  });
  assert.throws(
    () => other.carriers.cancel(f.actor, "cancel-running", cancellation(f)),
    { code: "STATE" },
  );
  assert.equal(other.carriers.recoverStale(0, f.actor.orgId), 1);
  const readingEntered = deferred<void>(),
    readResume = deferred<void>();
  let reads = 0;
  const reading = other.carriers.reconcile(
    f.actor,
    receipt.id,
    adapter({
      lookup: async (intent) => {
        reads++;
        readingEntered.resolve();
        await readResume.promise;
        return proof(intent);
      },
    }),
  );
  await readingEntered.promise;
  const token = other.database
    .owned("integration")
    .get(
      "SELECT token FROM integration_carrier_bookings WHERE id=?",
      receipt.id,
    )!.token;
  await assert.rejects(
    f.app.carriers.reconcile(f.actor, receipt.id, adapter()),
    { code: "STATE" },
  );
  resume.resolve();
  await assert.rejects(sending, { code: "STATE" });
  assert.equal(writes, 0);
  assert.equal(
    other.database
      .owned("integration")
      .get(
        "SELECT token FROM integration_carrier_bookings WHERE id=?",
        receipt.id,
      )!.token,
    token,
  );
  readResume.resolve();
  assert.equal((await reading).state, "booked");
  assert.equal(reads, 1);
});

for (const state of ["pending", "unknown", "booked"] as const)
  test(`${state} booking blocks conflicting handover and packing void; matching booked handover invoices once`, async (t) => {
    const f = setup(t),
      receipt = prepare(f),
      before = native(f);
    if (state === "unknown")
      await assert.rejects(
        f.app.carriers.execute(
          f.actor,
          receipt.id,
          adapter({
            book: async (_i, guard) => {
              guard();
              throw Error("Synthetic uncertain outcome");
            },
          }),
        ),
      );
    if (state === "booked")
      await f.app.carriers.execute(f.actor, receipt.id, adapter());
    const handover = {
      shipmentId: f.shipmentId,
      carrier: "manual-other",
      tracking: "OTHER-TRACKING",
      handoverEvidence: "Synthetic physical custody evidence",
    };
    assert.throws(() =>
      f.app.fulfillment.commit(f.actor, "wrong-handover", handover),
    );
    assert.throws(() =>
      f.app.fulfillment.void(f.actor, "wrong-void", {
        shipmentId: f.shipmentId,
        reason: "Synthetic review",
      }),
    );
    assert.deepEqual(native(f), before);
    if (state === "booked") {
      const exact = {
        ...handover,
        carrier: "ups",
        tracking: current(f).tracking!,
      };
      assert.throws(() =>
        f.app.fulfillment.commit(f.actor, "wrong-tracking", {
          ...exact,
          tracking: "DIFFERENT-TRACKING",
        }),
      );
      assert.throws(() =>
        f.app.fulfillment.commit(f.actor, "wrong-carrier", {
          ...exact,
          carrier: "fedex",
        }),
      );
      const shipped = f.app.fulfillment.commit(
        f.actor,
        "matching-handover",
        exact,
      );
      assert.deepEqual(
        f.app.fulfillment.commit(f.actor, "matching-handover", exact),
        shipped,
      );
      assert.throws(() =>
        f.app.fulfillment.commit(f.actor, "repeat-new-key", exact),
      );
      assert.equal(f.app.billing.invoices(f.actor).length, 1);
      assert.equal(f.app.orders.order(f.actor, f.orderId).state, "closed");
      assert.equal(
        f.app.fulfillment.shipment(f.actor, f.shipmentId).state,
        "shipped",
      );
    }
  });

test("canceled unsent carrier booking permits explicit manual fallback without provider work", (t) => {
  const f = setup(t);
  prepare(f);
  f.app.carriers.cancel(f.actor, "cancel", cancellation(f));
  const receipt = f.app.fulfillment.commit(f.actor, "manual-fallback", {
    shipmentId: f.shipmentId,
    carrier: "Synthetic manual carrier",
    tracking: "MANUAL-TRACKING",
    handoverEvidence: "Synthetic physical manual handover",
  });
  assert.ok(receipt.invoiceId);
  assert.equal(f.app.billing.invoices(f.actor).length, 1);
  assert.equal(current(f).state, "canceled");
});

async function httpFixture(t: Parameters<typeof fixture>[0], enabled = false) {
  const f = setup(t);
  const http = await createHttp(f.app, {
    origin: "http://localhost:3000",
    staticRoot: "/nonexistent-carrier-test",
    ...(enabled
      ? {
          carriers: new CarrierRuntime(f.app, [
            { orgId: f.actor.orgId, adapter: adapter() },
          ]),
        }
      : {}),
  });
  t.after(() => {
    void http.close();
  });
  const login = f.app.identity.login(
    "admin@example.test",
    "long-test-only-password",
  );
  const headers = {
    cookie: `distributor_session=${login.token}`,
    "x-csrf-token": login.csrf,
    origin: "http://localhost:3000",
    "idempotency-key": "http-carrier-prepare",
  };
  return { ...f, http, headers };
}

test("carrier HTTP rejects unknown nested fields, invalid measurements and CSRF before durable preparation", async (t) => {
  const f = await httpFixture(t),
    before = native(f),
    url = "/api/commands/carrier.prepare";
  for (const payload of [
    { ...f.input, unexpected: true },
    { ...f.input, origin: { ...origin, unexpected: true } },
    { ...f.input, destination: { ...destination, unexpected: true } },
    { ...f.input, parcel: { ...f.input.parcel, unexpected: true } },
    { ...f.input, parcel: { ...f.input.parcel, weightGrams: 0 } },
  ])
    assert.equal(
      (
        await f.http.inject({
          method: "POST",
          url,
          headers: f.headers,
          payload,
        })
      ).statusCode,
      400,
    );
  assert.equal(
    (
      await f.http.inject({
        method: "POST",
        url,
        headers: { ...f.headers, "x-csrf-token": "wrong" },
        payload: f.input,
      })
    ).statusCode,
    403,
  );
  assert.equal(f.app.carriers.review(f.actor, f.shipmentId).booking, null);
  assert.deepEqual(native(f), before);
});

test("carrier HTTP exact prepare and cancel expose metadata only; default send/reconcile stay disabled", async (t) => {
  const f = await httpFixture(t),
    before = native(f),
    url = "/api/commands/carrier.prepare";
  const first = await f.http.inject({
    method: "POST",
    url,
    headers: f.headers,
    payload: f.input,
  });
  assert.equal(first.statusCode, 200);
  assert.deepEqual(
    (
      await f.http.inject({
        method: "POST",
        url,
        headers: f.headers,
        payload: f.input,
      })
    ).json(),
    first.json(),
  );
  const booking = first.json();
  const review = (
    await f.http.inject({
      method: "GET",
      url: `/api/shipments/${f.shipmentId}/carrier`,
      headers: f.headers,
    })
  ).json();
  assert.equal(review.enabled, false);
  assert.equal(review.booking.state, "pending");
  for (const internal of [
    "intent",
    "token",
    "nativeSnapshot",
    "label_bytes",
    "labelBytes",
    "label_hash",
  ])
    assert.equal(Object.hasOwn(review.booking, internal), false);
  for (const action of ["send", "reconcile"]) {
    const target = `/api/carrier/${booking.id}/${action}`;
    assert.equal(
      (
        await f.http.inject({
          method: "POST",
          url: target,
          headers: f.headers,
          payload: { unexpected: true },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await f.http.inject({
          method: "POST",
          url: target,
          headers: { ...f.headers, "x-csrf-token": "wrong" },
          payload: {},
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await f.http.inject({
          method: "POST",
          url: target,
          headers: f.headers,
          payload: {},
        })
      ).statusCode,
      503,
    );
  }
  assert.equal(current(f).state, "pending");
  assert.equal(
    (
      await f.http.inject({
        method: "GET",
        url: `/api/shipments/${f.shipmentId}/carrier/history?unexpected=true`,
        headers: f.headers,
      })
    ).statusCode,
    400,
  );
  const cancelHeaders = { ...f.headers, "idempotency-key": "http-cancel" },
    cancel = cancellation(f);
  assert.equal(
    (
      await f.http.inject({
        method: "POST",
        url: "/api/commands/carrier.cancel",
        headers: cancelHeaders,
        payload: { ...cancel, unexpected: true },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await f.http.inject({
        method: "POST",
        url: "/api/commands/carrier.cancel",
        headers: cancelHeaders,
        payload: cancel,
      })
    ).statusCode,
    200,
  );
  assert.equal(current(f).state, "canceled");
  assert.deepEqual(native(f), before);
});

test("explicit synthetic carrier HTTP runtime binds label bytes/hash and current warehouse access", async (t) => {
  const f = await httpFixture(t, true),
    receipt = prepare(f),
    before = native(f);
  const sent = await f.http.inject({
    method: "POST",
    url: `/api/carrier/${receipt.id}/send`,
    headers: f.headers,
    payload: {},
  });
  assert.equal(sent.statusCode, 200);
  assert.equal(sent.json().state, "booked");
  const url = `/api/carrier/${receipt.id}/label`,
    label = await f.http.inject({ method: "GET", url, headers: f.headers });
  assert.equal(label.statusCode, 200);
  assert.deepEqual(label.rawPayload, labelBytes);
  assert.equal(
    label.headers["x-document-sha256"],
    createHash("sha256").update(labelBytes).digest("hex"),
  );
  assert.equal(label.headers["content-type"], "application/octet-stream");
  assert.equal(label.headers["x-label-media-type"], "application/pdf");
  assert.equal(label.headers["cache-control"], "no-store");
  const reader = user(f, "warehouse", [f.w2]),
    login = f.app.identity.login(
      "warehouse@carrier.example.test",
      "long-test-only-password",
    );
  assert.equal(
    (
      await f.http.inject({
        method: "GET",
        url,
        headers: { cookie: `distributor_session=${login.token}` },
      })
    ).statusCode,
    403,
  );
  assert.throws(() => f.app.carriers.label(reader, receipt.id), {
    code: "FORBIDDEN",
  });
  assert.deepEqual(native(f), before);
});

for (const restriction of ["role", "site", "inactive", "password"] as const)
  test(`booked label rechecks actual ${restriction} authority`, async (t) => {
    const f = setup(t),
      actor = user(f),
      receipt = prepare(f, actor);
    await f.app.carriers.execute(actor, receipt.id, adapter());
    restrict(f, actor, restriction);
    assert.throws(() =>
      f.app.carriers.label(
        { ...actor, role: "admin", sites: [f.w1] },
        receipt.id,
      ),
    );
  });

test("carrier history pages retained generations without trusting foreign cursors", (t) => {
  const f = setup(t);
  let previousId: string | null = null;
  for (let i = 0; i < 23; i++) {
    const receipt = f.app.carriers.prepare(f.actor, `prepare-${i}`, {
      ...f.input,
      previousId,
    });
    f.app.carriers.cancel(f.actor, `cancel-${i}`, {
      bookingId: receipt.id,
      reviewHash: receipt.reviewHash,
      reason: `Synthetic cancellation ${i}`,
    });
    previousId = receipt.id;
  }
  const first = f.app.carriers.history(f.actor, f.shipmentId),
    second = f.app.carriers.history(f.actor, f.shipmentId, first.next!);
  assert.equal(first.items.length, 20);
  assert.equal(second.items.length, 3);
  assert.equal(second.next, null);
  assert.equal(
    new Set([...first.items, ...second.items].map((b) => b.id)).size,
    23,
  );
  assert.throws(
    () => f.app.carriers.history(f.actor, f.shipmentId, "not-in-scope"),
    { code: "CURSOR" },
  );
});

test("native packing changes during paused carrier preparation prevent external write", async (t) => {
  const f = setup(t),
    receipt = prepare(f),
    entered = deferred<void>(),
    resume = deferred<void>();
  let writes = 0;
  const sending = f.app.carriers.execute(
    f.actor,
    receipt.id,
    adapter({
      book: async (intent, guard) => {
        entered.resolve();
        await resume.promise;
        guard();
        writes++;
        return proof(intent);
      },
    }),
  );
  await entered.promise;
  // Explicit owning-store fault models a changed durable packed snapshot.
  f.app.database
    .owned("fulfillment")
    .run(
      "UPDATE fulfillment_shipments SET address=? WHERE id=?",
      "Changed native packed destination",
      f.shipmentId,
    );
  resume.resolve();
  await assert.rejects(sending, { code: "CARRIER_MISMATCH" });
  assert.equal(writes, 0);
  assert.equal(current(f).state, "unknown");
});

test("late already-authorized provider success cannot overwrite a successor lookup claim", async (t) => {
  const f = setup(t),
    receipt = prepare(f),
    other = new Application(f.path, "CA");
  t.after(() => other.close());
  const entered = deferred<void>(),
    resume = deferred<void>();
  const sending = f.app.carriers.execute(
    f.actor,
    receipt.id,
    adapter({
      book: async (intent, guard) => {
        guard();
        entered.resolve();
        await resume.promise;
        return proof(intent);
      },
    }),
  );
  await entered.promise;
  other.carriers.recoverStale(0, f.actor.orgId);
  const readingEntered = deferred<void>(),
    readResume = deferred<void>();
  const reading = other.carriers.reconcile(
    f.actor,
    receipt.id,
    adapter({
      lookup: async (intent) => {
        readingEntered.resolve();
        await readResume.promise;
        return proof(intent);
      },
    }),
  );
  await readingEntered.promise;
  const claim = other.database
    .owned("integration")
    .get(
      "SELECT token FROM integration_carrier_bookings WHERE id=?",
      receipt.id,
    )!.token;
  resume.resolve();
  await assert.rejects(sending, { code: "STATE" });
  assert.equal(
    other.database
      .owned("integration")
      .get(
        "SELECT token FROM integration_carrier_bookings WHERE id=?",
        receipt.id,
      )!.token,
    claim,
  );
  assert.equal(current(f).state, "unknown");
  readResume.resolve();
  assert.equal((await reading).state, "booked");
});

test("unavailable or differently named carrier adapters acquire no durable claim", async (t) => {
  const f = setup(t),
    receipt = prepare(f);
  let writes = 0;
  for (const patch of [{ sandbox: false }, { provider: "fedex" }])
    await assert.rejects(
      f.app.carriers.execute(
        f.actor,
        receipt.id,
        adapter({
          ...patch,
          book: async () => {
            writes++;
            throw Error("must not access");
          },
        } as unknown as Partial<CarrierAdapter>),
      ),
      { code: "CARRIER_DISABLED" },
    );
  assert.equal(writes, 0);
  assert.equal(current(f).state, "pending");
  assert.equal(
    f.app.database
      .owned("integration")
      .get(
        "SELECT token FROM integration_carrier_bookings WHERE id=?",
        receipt.id,
      )!.token,
    null,
  );
});

test("retained carrier label refuses byte tampering", async (t) => {
  const f = setup(t),
    receipt = prepare(f);
  await f.app.carriers.execute(f.actor, receipt.id, adapter());
  f.app.database
    .owned("integration")
    .run(
      "UPDATE integration_carrier_bookings SET label_bytes=? WHERE id=?",
      Buffer.from("%PDF-1.7\nTampered synthetic label"),
      receipt.id,
    );
  assert.throws(() => f.app.carriers.label(f.actor, receipt.id), {
    code: "CARRIER_RESULT",
  });
});

test("failed preparation event rolls back booking, receipt and audit together", (t) => {
  const f = setup(t),
    before = native(f),
    events = f.app.platform.events(f.actor),
    audits = f.app.platform.audits(f.actor);
  const fault = t.mock.method(f.app.platform, "event", () => {
    throw Error("Synthetic event persistence failure");
  });
  assert.throws(() => prepare(f), /event persistence/);
  fault.mock.restore();
  assert.equal(f.app.carriers.review(f.actor, f.shipmentId).booking, null);
  assert.deepEqual(f.app.platform.events(f.actor), events);
  assert.deepEqual(f.app.platform.audits(f.actor), audits);
  assert.deepEqual(native(f), before);
  assert.equal(
    f.app.database
      .owned("platform")
      .get(
        "SELECT COUNT(*) AS n FROM platform_commands WHERE name='carrier.prepare'",
      )!.n,
    0,
  );
  assert.ok(prepare(f).id);
});
