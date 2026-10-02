import { test } from "node:test";
import assert from "node:assert/strict";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import { chooseProviders } from "./fixtures.ts";
import {
  replacementCarrierFixture as fixture,
  replacementAdapter as adapter,
  replacementDispatch as dispatch,
  replacementLabel,
  replacementProof,
} from "./replacement-carrier-fixture.ts";

type F = ReturnType<typeof fixture>;
const current = (f: F) =>
  f.app.carriers.reviewReplacement(f.actor, f.replacement.id).booking!;
const prepare = (f: F) =>
  f.app.carriers.prepare(f.actor, "carrier-prepare", f.input);
const native = (f: F) => ({
  stock: f.app.inventory.stock(f.actor),
  claims: f.app.warranty.list(f.actor),
  orders: f.app.orders.list(f.actor),
  invoices: f.app.billing.invoices(f.actor),
  shipments: f.app.fulfillment.shipments(f.actor),
  exposure: f.app.billing.exposure(f.actor, f.buyer),
});
const money = (f: F) => ({
  orders: f.app.orders.list(f.actor),
  invoices: f.app.billing.invoices(f.actor),
  shipments: f.app.fulfillment.shipments(f.actor),
  exposure: f.app.billing.exposure(f.actor, f.buyer),
});
const cancel = (f: F) =>
  f.app.carriers.cancel(f.actor, "carrier-cancel", {
    bookingId: current(f).id,
    reviewHash: current(f).reviewHash,
    reason: "Synthetic reviewed unsent cancellation",
  });
const nativeCancel = (f: F) =>
  f.app.warranty.cancelReplacement(f.actor, "native-cancel", {
    replacementId: f.replacement.id,
    revision: 1,
    reason: "Synthetic cancellation",
  });
const collect = (f: F) =>
  f.app.warranty.handoverReplacement(f.actor, "native-collect", {
    replacementId: f.replacement.id,
    revision: 1,
    serial: "S2",
    recipient: "Synthetic recipient",
    evidence: "Synthetic collection",
  });

test("replacement carrier review/cancel/reprepare conserves stock and financial facts with distinct scoped history", (t) => {
  const f = fixture(t),
    before = native(f),
    receipt = prepare(f);
  assert.deepEqual(prepare(f), receipt);
  assert.equal(current(f).replacementId, f.replacement.id);
  assert.equal(current(f).shipmentId, f.replacement.id);
  assert.equal(current(f).reviewedDestination, f.input.reviewedDestination);
  assert.deepEqual(
    f.app.carriers.reviewReplacement(f.actor, f.replacement.id).packedGoods,
    [
      {
        allocationId: f.replacement.id,
        quantity: 1,
        description: "Synthetic equipment",
        serial: "S2",
      },
    ],
  );
  assert.throws(() => f.app.carriers.review(f.actor, f.replacement.id), {
    code: "NOT_FOUND",
  });
  assert.throws(
    () => f.app.carriers.review(f.actor, `replacement:${f.replacement.id}`),
    { code: "NOT_FOUND" },
  );
  cancel(f);
  cancel(f);
  const successor = f.app.carriers.prepare(f.actor, "successor", {
    ...f.input,
    previousId: receipt.id,
    reviewedDestination: "Synthetic changed address",
  });
  assert.notEqual(successor.id, receipt.id);
  assert.equal(
    f.app.carriers.historyReplacement(f.actor, f.replacement.id).items.length,
    2,
  );
  assert.deepEqual(native(f), before);
  const events = f.app.database
    .owned("platform")
    .all<{ type: string; payload: string }>(
      "SELECT type,payload FROM platform_events WHERE type LIKE 'carrier.booking.%'",
    );
  assert.equal(events.length, 3);
  for (const event of events) {
    const payload = JSON.parse(event.payload);
    assert.equal(payload.shipmentId, f.replacement.id);
    assert.equal(payload.replacementId, f.replacement.id);
    assert.ok(!JSON.stringify(payload).includes("replacement:"));
  }
});
for (const action of [
  nativeCancel,
  collect,
  (f: F) =>
    f.app.warranty.dispatchReplacement(f.actor, "native-dispatch", dispatch(f)),
])
  test(`pending replacement carrier review blocks ${action.name || "dispatch"} without custody changes`, (t) => {
    const f = fixture(t);
    prepare(f);
    const before = native(f);
    assert.throws(() => action(f), { code: "CARRIER_BOOKING_ACTIVE" });
    assert.deepEqual(native(f), before);
    cancel(f);
    action(f);
    assert.equal(current(f).state, "canceled");
  });

test("booked replacement dispatch binds exact recipient/address/carrier/tracking and preserves invoice lineage after restart", async (t) => {
  const f = fixture(t),
    before = money(f),
    receipt = prepare(f);
  let writes = 0;
  await f.app.carriers.execute(
    f.actor,
    receipt.id,
    adapter({
      book: async (intent, guard) => {
        guard();
        writes++;
        assert.equal(intent.nativeSnapshot.id, f.replacement.id);
        assert.equal("order_id" in intent.nativeSnapshot, false);
        return replacementProof(intent);
      },
    }),
  );
  assert.equal(writes, 1);
  for (const patch of [
    { recipient: "Wrong recipient" },
    { address: "Wrong address" },
    { carrier: "fedex" },
    { tracking: "Wrong tracking" },
    { serial: "S3" },
  ]) {
    const old = native(f);
    assert.throws(() =>
      f.app.warranty.dispatchReplacement(
        f.actor,
        "wrong-" + Object.keys(patch)[0],
        { ...dispatch(f), ...patch },
      ),
    );
    assert.deepEqual(native(f), old);
  }
  assert.throws(() => nativeCancel(f), { code: "CARRIER_BOOKING_ACTIVE" });
  assert.throws(() => collect(f), { code: "CARRIER_BOOKING_ACTIVE" });
  f.app.close();
  f.app = new Application(f.path, "CA");
  const result = f.app.warranty.dispatchReplacement(
    f.actor,
    "dispatch",
    dispatch(f),
  );
  assert.equal(result.state, "handed_over");
  assert.deepEqual(
    f.app.warranty.dispatchReplacement(f.actor, "dispatch", dispatch(f)),
    result,
  );
  assert.deepEqual(money(f), before);
  assert.equal(f.app.inventory.trace(f.actor, "S2").unit.state, "sold");
  assert.equal(f.app.inventory.trace(f.actor, "S1").unit.state, "scrapped");
  assert.equal(
    f.app.warranty.list(f.actor).find((c) => c.id === f.claim.id)!.state,
    "disposed",
  );
  assert.equal(current(f).state, "booked");
  assert.deepEqual(
    f.app.carriers.label(f.actor, receipt.id).bytes,
    replacementLabel,
  );
});

test("uncertain replacement carrier purchase stays blocked across restart and recovers only by exact read-only lookup", async (t) => {
  const f = fixture(t),
    receipt = prepare(f),
    before = native(f);
  let writes = 0,
    reads = 0;
  const uncertain = adapter({
    book: async (_i, guard) => {
      guard();
      writes++;
      throw Error("Synthetic lost response");
    },
    lookup: async (intent) => {
      reads++;
      return replacementProof(intent);
    },
  });
  await assert.rejects(f.app.carriers.execute(f.actor, receipt.id, uncertain));
  f.app.close();
  f.app = new Application(f.path, "CA");
  assert.equal(current(f).state, "unknown");
  assert.throws(() => cancel(f));
  assert.throws(() => nativeCancel(f));
  assert.throws(() => collect(f));
  assert.throws(() =>
    f.app.warranty.dispatchReplacement(
      f.actor,
      "blocked-dispatch",
      dispatch(f),
    ),
  );
  assert.throws(() =>
    f.app.carriers.prepare(f.actor, "blocked-successor", {
      ...f.input,
      previousId: receipt.id,
    }),
  );
  await assert.rejects(f.app.carriers.execute(f.actor, receipt.id, uncertain));
  assert.deepEqual(native(f), before);
  await f.app.carriers.reconcile(f.actor, receipt.id, uncertain);
  assert.equal(writes, 1);
  assert.equal(reads, 1);
  assert.equal(current(f).state, "booked");
  f.app.warranty.dispatchReplacement(
    f.actor,
    "recovered-dispatch",
    dispatch(f),
  );
});

for (const drift of [
  "approval",
  "claim",
  "stock",
  "hold",
  "choice",
  "restore",
] as const)
  test(`replacement ${drift} drift refuses booking before adapter work`, async (t) => {
    const f = fixture(t),
      receipt = prepare(f);
    if (drift === "approval")
      f.app.database
        .owned("warranty")
        .run(
          "UPDATE warranty_replacements SET revision=revision+1 WHERE id=?",
          f.replacement.id,
        );
    if (drift === "claim")
      f.app.database
        .owned("warranty")
        .run(
          "UPDATE warranty_claims SET inspection='Changed review' WHERE id=?",
          f.claim.id,
        );
    if (drift === "stock")
      f.app.database
        .owned("inventory")
        .run(
          "UPDATE inventory_units SET bin='CHANGED',revision=revision+1 WHERE serial='S2'",
        );
    if (drift === "hold")
      f.app.database
        .owned("inventory")
        .run(
          "UPDATE inventory_replacements SET state='cancelled' WHERE id=?",
          f.replacement.id,
        );
    if (drift === "choice")
      chooseProviders(f, f.actor, "withdraw", {
        accountId: f.buyer,
        region: "CA",
        mode: "strict",
        providers: [],
        version: 2,
        acknowledgment: "Synthetic withdrawal",
      });
    if (drift === "restore")
      f.app.platform.isolateRestore(
        "synthetic-restore",
        new Date().toISOString(),
      );
    let attempts = 0;
    await assert.rejects(
      f.app.carriers.execute(
        f.actor,
        receipt.id,
        adapter({
          book: async () => {
            attempts++;
            throw Error("must not enter");
          },
        }),
      ),
    );
    assert.equal(attempts, 0);
    assert.equal(current(f).state, "pending");
  });

for (const restriction of ["sites", "role", "inactive", "password"] as const)
  test(`replacement ${restriction} authority applies to cached preparations, histories and labels`, async (t) => {
    const f = fixture(t);
    const user = f.app.identity.createUser(f.actor, "operator", {
      name: "Operator",
      email: "operator@example.test",
      password: "long-test-only-password",
      role: "warehouse",
      sites: [f.w1],
    });
    const actor = f.app.identity.currentActor({ ...f.actor, id: user.id });
    const receipt = f.app.carriers.prepare(actor, "operator-prepare", f.input);
    await f.app.carriers.execute(actor, receipt.id, adapter());
    const iam = f.app.database.owned("iam");
    if (restriction === "sites")
      iam.run("UPDATE iam_users SET sites='[]' WHERE id=?", actor.id);
    if (restriction === "role")
      iam.run("UPDATE iam_users SET role='support' WHERE id=?", actor.id);
    if (restriction === "inactive")
      iam.run("UPDATE iam_users SET active=0 WHERE id=?", actor.id);
    if (restriction === "password")
      iam.run(
        "INSERT INTO iam_user_security(user_id,revision,password_change_required,updated_at) VALUES(?,1,1,?) ON CONFLICT(user_id) DO UPDATE SET password_change_required=1",
        actor.id,
        new Date().toISOString(),
      );
    for (const operation of [
      () => f.app.carriers.prepare(actor, "operator-prepare", f.input),
      () => f.app.carriers.reviewReplacement(actor, f.replacement.id),
      () => f.app.carriers.historyReplacement(actor, f.replacement.id),
      () => f.app.carriers.label(actor, receipt.id),
    ])
      assert.throws(operation);
  });

test("replacement dispatch and stock dispositions roll back with a late audit failure, retaining booked proof", async (t) => {
  const f = fixture(t),
    receipt = prepare(f);
  await f.app.carriers.execute(f.actor, receipt.id, adapter());
  const before = native(f),
    audit = f.app.platform.audit;
  f.app.platform.audit = () => {
    throw Error("Synthetic late audit failure");
  };
  assert.throws(() =>
    f.app.warranty.dispatchReplacement(f.actor, "dispatch", dispatch(f)),
  );
  f.app.platform.audit = audit;
  assert.deepEqual(native(f), before);
  assert.equal(current(f).state, "booked");
  f.app.warranty.dispatchReplacement(f.actor, "dispatch", dispatch(f));
});

test("replacement target confusion and foreign scopes fail closed", (t) => {
  const f = fixture(t),
    other = fixture(t);
  for (const patch of [
    { replacementId: other.replacement.id },
    { shipmentId: other.replacement.id, replacementId: other.replacement.id },
    { shipmentId: `replacement:${f.replacement.id}` },
    { replacementId: undefined },
    { replacementId: "" },
  ])
    assert.throws(() =>
      f.app.carriers.prepare(f.actor, "invalid-target", {
        ...f.input,
        ...patch,
      }),
    );
  assert.throws(
    () => f.app.carriers.reviewReplacement(f.actor, other.replacement.id),
    { code: "NOT_FOUND" },
  );
  prepare(f);
  assert.throws(
    () =>
      f.app.carriers.historyReplacement(
        f.actor,
        f.replacement.id,
        other.replacement.id,
      ),
    { code: "CURSOR" },
  );
});

test("replacement carrier HTTP uses exact fields, CSRF, scoped history and private label routes", async (t) => {
  const f = fixture(t),
    origin = "http://127.0.0.1:3199";
  const http = await createHttp(f.app, { origin, staticRoot: "/nonexistent" });
  t.after(() => http.close());
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: {
      email: "admin@example.test",
      password: "long-test-only-password",
    },
  });
  const cookie = login.cookies[0]!;
  const headers = {
    origin,
    cookie: `${cookie.name}=${cookie.value}`,
    "x-csrf-token": login.json().csrf,
    "idempotency-key": "http-prepare",
  };
  const route = `/api/warranty/replacements/${f.replacement.id}/carrier`;
  assert.equal(
    (await http.inject({ method: "GET", url: route, headers })).json()
      .replacementId,
    f.replacement.id,
  );
  assert.equal(
    (await http.inject({ method: "GET", url: route + "?extra=1", headers }))
      .statusCode,
    400,
  );
  const command = {
    method: "POST" as const,
    url: "/api/commands/carrier.prepare",
    headers,
    payload: f.input,
  };
  assert.equal(
    (
      await http.inject({
        ...command,
        headers: { ...headers, "x-csrf-token": "wrong" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await http.inject({ ...command, payload: { ...f.input, extra: 1 } }))
      .statusCode,
    400,
  );
  const reply = await http.inject(command);
  assert.equal(reply.statusCode, 200);
  assert.deepEqual((await http.inject(command)).json(), reply.json());
  const history = await http.inject({
    method: "GET",
    url: route + "/history",
    headers,
  });
  assert.equal(history.json().items.length, 1);
  assert.equal(
    history.json().items[0].reviewedDestination,
    f.input.reviewedDestination,
  );
});

test("replacement carrier late pre-write custody drift leaves uncertainty without a provider write", async (t) => {
  const f = fixture(t),
    receipt = prepare(f),
    before = money(f);
  let writes = 0;
  await assert.rejects(
    f.app.carriers.execute(
      f.actor,
      receipt.id,
      adapter({
        async book(intent, guard) {
          f.app.database
            .owned("inventory")
            .run(
              "UPDATE inventory_units SET revision=revision+1 WHERE id=?",
              "kind" in intent.nativeSnapshot
                ? intent.nativeSnapshot.custody.unit.id
                : "missing",
            );
          guard();
          writes++;
          return replacementProof(intent);
        },
      }),
    ),
  );
  assert.equal(writes, 0);
  assert.equal(current(f).state, "unknown");
  assert.throws(() => collect(f), { code: "CARRIER_BOOKING_ACTIVE" });
  assert.deepEqual(money(f), before);
});

test("reviewed multiline replacement delivery and a sales credit hold preserve warranty dispatch without a new sale", async (t) => {
  const f = fixture(t),
    before = money(f);
  f.input.reviewedDestination =
    "Synthetic recipient\n2 Test Street\nToronto ON M5V 1A1, CA";
  f.app.identity.setHold(f.actor, "hold", {
    accountId: f.buyer,
    held: true,
    reason: "Synthetic sales credit hold",
  });
  const receipt = prepare(f);
  await f.app.carriers.execute(f.actor, receipt.id, adapter());
  f.app.warranty.dispatchReplacement(f.actor, "dispatch", dispatch(f));
  assert.deepEqual(money(f), before);
  assert.equal(current(f).reviewedDestination, f.input.reviewedDestination);
});

test("Canada Post replacement group requires a transmitted manifest before exact native dispatch and retains private labels", async (t) => {
  const { client, configurationHash } =
    await import("./canada-post-creation-fixture.ts");
  const { manifestClient } = await import("./canada-post-manifest-fixture.ts");
  const f = fixture(t),
    before = money(f);
  f.input.provider = "canada-post";
  const receipt = prepare(f);
  const group = f.app.carriers.prepareCanadaPostGroup(f.actor, "group", {
    configurationHash,
    entries: [{ bookingId: receipt.id, reviewHash: receipt.reviewHash }],
  }).id;
  const creation = client();
  await f.app.carriers.createCanadaPostMember(
    f.actor,
    group,
    receipt.id,
    creation,
  );
  const m = manifestClient(),
    review = f.app.carriers.reviewCanadaPostManifest(f.actor, group, m);
  const input = {
    ...dispatch(f),
    carrier: "canada-post",
    tracking: "1234567890123456",
  };
  assert.throws(
    () => f.app.warranty.dispatchReplacement(f.actor, "dispatch", input),
    { code: "CARRIER_BOOKING_ACTIVE" },
  );
  await f.app.carriers.transmitCanadaPostManifest(
    f.actor,
    group,
    review.reviewHash,
    m,
  );
  assert.deepEqual(money(f), before);
  assert.equal(current(f).state, "booked");
  input.tracking = current(f).tracking!;
  f.app.warranty.dispatchReplacement(f.actor, "dispatch", input);
  assert.deepEqual(money(f), before);
  assert.equal(creation.creates, 1);
  assert.equal(m.writes, 1);
  assert.ok(f.app.carriers.label(f.actor, receipt.id).bytes.length > 0);
});
