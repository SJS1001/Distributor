import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import type { Actor, Role } from "../src/server/core.ts";
import { fixture, accept, ship } from "./fixtures.ts";

type Fixture = ReturnType<typeof fixture>;
const password = "long-test-only-password";
const epoch = 1900000000000;
function review(f: Fixture, orderId: string) {
  return {
    orderId,
    revision: f.app.orders.order(f.actor, orderId).revision,
    reason: "Synthetic reviewed buyer-visible stock deadline",
  };
}
function deadline(
  f: Fixture,
  orderId: string,
  key = "deadline",
  expiresAt: number | null = epoch + 1000,
) {
  return f.app.orders.reservationDeadline(f.actor, key, {
    ...review(f, orderId),
    expiresAt,
  });
}
function facts(f: Fixture, orderId: string) {
  return {
    order: f.app.orders.order(f.actor, orderId),
    lines: f.app.orders.lines(f.actor, orderId),
    allocations: f.app.inventory.allocations(f.actor, orderId),
    stock: f.app.inventory.stock(f.actor),
    exposure: f.app.billing.exposure(f.actor, f.buyer),
    invoices: f.app.billing.invoices(f.actor),
    shipments: f.app.fulfillment.shipments(f.actor),
    history: f.app.orders.reservations(f.actor, orderId),
    events: f.app.platform.events(f.actor),
    receipts: f.app.database
      .owned("platform")
      .all(
        "SELECT * FROM platform_commands WHERE name LIKE 'order.reservation.%'",
      ),
    audit: f.app.database
      .owned("platform")
      .all(
        "SELECT * FROM platform_audit WHERE action LIKE 'order.reservation.%'",
      ),
  };
}
function user(
  f: Fixture,
  role: Role,
  sites: string[] = [],
  accountId = f.buyer,
) {
  const email = `${role}-${sites.join()}@expiry.example.test`;
  const created = f.app.identity.createUser(f.actor, email, {
    email,
    name: "Synthetic expiry user",
    password,
    role,
    sites,
    ...(role === "buyer" ? { accountId } : {}),
  });
  return f.app.identity.currentActor({ ...f.actor, id: created.id });
}
function revoke(
  f: Fixture,
  actor: Actor,
  patch: {
    role?: Role;
    active?: boolean;
    sites?: string[];
    accountId?: string;
  },
) {
  const row = f.app.identity.users(f.actor).find((u) => u.id === actor.id)!;
  f.app.identity.updateUser(f.actor, `revoke-${actor.id}`, {
    userId: actor.id,
    revision: row.revision,
    email: row.email,
    name: row.name,
    role: actor.role,
    sites: actor.sites,
    ...(actor.accountId ? { accountId: actor.accountId } : {}),
    active: true,
    currentPassword: password,
    reason: "Synthetic revocation",
    ...patch,
  });
}

test("reservations are unlimited by default; reviewed deadlines renew, clear, revise and retry durably without money or stock effects", (t) => {
  let clock = epoch;
  t.mock.method(Date, "now", () => clock);
  const f = fixture(t),
    id = accept(f, 2).id;
  assert.deepEqual(f.app.orders.reservations(f.actor, id), {
    expiresAt: null,
    overdue: false,
    items: [],
    next: null,
  });
  clock += 100000000;
  assert.equal(f.app.orders.reservations(f.actor, id).overdue, false);
  const initial = facts(f, id),
    input = { ...review(f, id), expiresAt: clock + 1000 };
  const saved = f.app.orders.reservationDeadline(f.actor, "saved", input);
  assert.equal(saved.revision, 2);
  assert.deepEqual(
    f.app.orders.reservationDeadline(f.actor, "saved", input),
    saved,
  );
  assert.throws(
    () => f.app.orders.reservationDeadline(f.actor, "changed", input),
    { code: "REVISION" },
  );
  assert.throws(
    () =>
      f.app.orders.reservationDeadline(f.actor, "saved", {
        ...input,
        reason: "Changed",
      }),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  deadline(f, id, "renew", clock + 2000);
  deadline(f, id, "clear", null);
  const after = facts(f, id);
  for (const key of [
    "lines",
    "allocations",
    "stock",
    "exposure",
    "invoices",
  ] as const)
    assert.deepEqual(after[key], initial[key]);
  assert.deepEqual(
    after.history.items.map((r) => [r.before_expires_at, r.expires_at]),
    [
      [clock + 2000, null],
      [clock + 1000, clock + 2000],
      [null, clock + 1000],
    ],
  );
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(
    f.app.orders.reservationDeadline(f.actor, "saved", input),
    saved,
  );
  assert.deepEqual(facts(f, id), after);
});

for (const position of [0, 2])
  test(`expiry preserves picked/packed serial at FIFO position ${position} and returns only unpicked units to backorder`, (t) => {
    let clock = epoch;
    t.mock.method(Date, "now", () => clock);
    const f = fixture(t),
      id = accept(f, 3).id,
      picked = f.app.fulfillment.picks(f.actor, id)[position]!;
    f.app.fulfillment.pick(f.actor, "pick", {
      orderId: id,
      allocationId: picked.id,
      serial: picked.serial,
    });
    const packed = f.app.fulfillment.pack(f.actor, "pack", {
      orderId: id,
      revision: 1,
      mode: "collection",
      address: "Synthetic counter",
      lines: [{ allocationId: picked.id, quantity: 1 }],
    });
    deadline(f, id);
    clock += 1000;
    const before = facts(f, id),
      input = review(f, id),
      result = f.app.orders.expireReservations(f.actor, "expire", input);
    assert.deepEqual(result.lines, [
      {
        lineId: before.lines[0]!.id,
        productId: f.product,
        released: 2,
        retainedPicked: 1,
      },
    ]);
    assert.deepEqual(
      f.app.orders.expireReservations(f.actor, "expire", input),
      result,
    );
    const after = facts(f, id);
    assert.equal(after.lines[0]!.allocated, 1);
    assert.equal(
      after.lines[0]!.quantity -
        after.lines[0]!.allocated -
        after.lines[0]!.shipped -
        after.lines[0]!.canceled,
      2,
    );
    for (const key of [
      "quantity",
      "unit_price",
      "unit_tax",
      "shipped",
      "canceled",
    ] as const)
      assert.equal(after.lines[0]![key], before.lines[0]![key]);
    assert.equal(after.order.total, before.order.total);
    assert.deepEqual(after.exposure, before.exposure);
    assert.equal(
      after.stock.reduce((n, u) => n + u.available, 0),
      2,
    );
    assert.equal(
      f.app.fulfillment.picks(f.actor, id).find((p) => p.id === picked.id)!
        .packed,
      1,
    );
    const stable = facts(f, id);
    assert.throws(
      () => f.app.orders.expireReservations(f.actor, "again", review(f, id)),
      { code: "NO_CHANGE" },
    );
    assert.deepEqual(facts(f, id), stable);
    const shipped = f.app.fulfillment.commit(f.actor, "ship", {
      shipmentId: packed.id,
      handoverEvidence: "Synthetic overdue packed handover",
    });
    assert.equal(
      f.app.billing.invoice(f.actor, shipped.invoiceId).total,
      11300,
    );
    assert.deepEqual(f.app.billing.exposure(f.actor, f.buyer), {
      holds: 22600,
      due: 11300,
      total: 33900,
    });
    assert.equal(f.app.orders.order(f.actor, id).state, "open");
    assert.equal(
      f.app.inventory.trace(f.actor, picked.serial!).unit.state,
      "sold",
    );
  });

test("due deadlines guard allocation, added quantities and reserved picks; void/unpick permits another explicit expiry and clear permits reallocation", (t) => {
  let clock = epoch;
  t.mock.method(Date, "now", () => clock);
  const f = fixture(t),
    id = accept(f, 2).id,
    picks = f.app.fulfillment.picks(f.actor, id),
    picked = picks[0]!,
    unpicked = picks[1]!;
  f.app.fulfillment.pick(f.actor, "pick", {
    orderId: id,
    allocationId: picked.id,
    serial: picked.serial,
  });
  const packed = f.app.fulfillment.pack(f.actor, "pack", {
    orderId: id,
    revision: 1,
    mode: "collection",
    address: "Synthetic counter",
    lines: [{ allocationId: picked.id, quantity: 1 }],
  });
  deadline(f, id);
  clock += 1000;
  const before = facts(f, id);
  assert.throws(
    () =>
      f.app.orders.allocate(f.actor, "allocate-due", {
        orderId: id,
        revision: review(f, id).revision,
      }),
    { code: "RESERVATION_EXPIRED" },
  );
  assert.throws(
    () =>
      f.app.orders.amend(f.actor, "increase-due", {
        ...review(f, id),
        lineId: before.lines[0]!.id,
        quantity: 3,
        allowBackorder: false,
      }),
    { code: "RESERVATION_EXPIRED" },
  );
  assert.throws(
    () =>
      f.app.fulfillment.pick(f.actor, "pick-due", {
        orderId: id,
        allocationId: unpicked.id,
        serial: unpicked.serial,
      }),
    { code: "RESERVATION_EXPIRED" },
  );
  assert.deepEqual(facts(f, id), before);
  f.app.orders.expireReservations(f.actor, "first-expiry", review(f, id));
  assert.throws(
    () =>
      f.app.fulfillment.pick(f.actor, "unpick-packed", {
        orderId: id,
        allocationId: picked.id,
        serial: picked.serial,
        unpick: true,
      }),
    { code: "PACKED" },
  );
  f.app.fulfillment.void(f.actor, "void", {
    shipmentId: packed.id,
    reason: "Synthetic packing correction",
  });
  f.app.fulfillment.pick(f.actor, "unpick", {
    orderId: id,
    allocationId: picked.id,
    serial: picked.serial,
    unpick: true,
  });
  assert.equal(
    f.app.orders.expireReservations(f.actor, "second-expiry", review(f, id))
      .lines[0]!.released,
    1,
  );
  assert.equal(f.app.orders.lines(f.actor, id)[0]!.allocated, 0);
  deadline(f, id, "clear", null);
  f.app.orders.allocate(f.actor, "reallocate", {
    orderId: id,
    revision: review(f, id).revision,
  });
  assert.equal(f.app.orders.lines(f.actor, id)[0]!.allocated, 2);
  assert.equal(f.app.inventory.availability(f.actor, f.product, f.w1), 1);
});

test("credit hold and accepted exposure survive releasing every reservation", (t) => {
  let clock = epoch;
  t.mock.method(Date, "now", () => clock);
  const f = fixture(t),
    id = accept(f, 3).id;
  deadline(f, id);
  f.app.identity.setHold(f.actor, "hold", {
    accountId: f.buyer,
    held: true,
    reason: "Synthetic finance hold",
  });
  clock += 1000;
  f.app.orders.expireReservations(f.actor, "expire", review(f, id));
  assert.equal(f.app.identity.customer(f.actor, f.buyer).held, 1);
  assert.deepEqual(f.app.billing.exposure(f.actor, f.buyer), {
    holds: 33900,
    due: 0,
    total: 33900,
  });
  assert.equal(f.app.orders.order(f.actor, id).total, 33900);
  assert.equal(f.app.orders.lines(f.actor, id)[0]!.allocated, 0);
  assert.equal(f.app.inventory.availability(f.actor, f.product, f.w1), 3);
});

test("bulk partial shipment and remaining packing retain original invoices/cost; a separate reserved layer expires", (t) => {
  let clock = epoch;
  t.mock.method(Date, "now", () => clock);
  const f = fixture(t);
  f.product = f.app.catalog.create(f.actor, "bulk", {
    sku: "EXP-BULK",
    name: "Synthetic bulk",
    serialized: false,
    unitPrice: 2500,
    taxBasisPoints: 1300,
  }).id;
  for (const [key, quantity, cost] of [
    ["a", 4, 1000],
    ["b", 2, 1700],
  ] as const) {
    const po = f.app.procurement.create(f.actor, `po-${key}`, {
      supplierId: f.supplier,
      warehouseId: f.w1,
      lines: [{ productId: f.product, quantity, unitCost: cost }],
    }).id;
    const line = f.app.procurement.orders(f.actor).find((p) => p.id === po)!
      .lines[0]!;
    f.app.procurement.receive(f.actor, `receive-${key}`, {
      poId: po,
      lineId: String(line.id),
      deliveryRef: `EXP-${key}`,
      quantity,
      serials: [],
      bin: "B-1",
      quarantine: false,
    });
  }
  const id = accept(f, 6).id,
    picks = f.app.fulfillment.picks(f.actor, id),
    first = picks.find((p) => p.quantity === 4)!;
  f.app.fulfillment.pick(f.actor, "bulk-pick", {
    orderId: id,
    allocationId: first.id,
    serial: null,
  });
  const pack = (key: string, quantity: number) =>
    f.app.fulfillment.pack(f.actor, key, {
      orderId: id,
      revision: review(f, id).revision,
      mode: "collection",
      address: "Synthetic counter",
      lines: [{ allocationId: first.id, quantity }],
    });
  const initial = pack("first", 2);
  const shipped = f.app.fulfillment.commit(f.actor, "ship-first", {
    shipmentId: initial.id,
    handoverEvidence: "Synthetic partial handover",
  });
  const retained = pack("remaining", 1);
  deadline(f, id);
  clock += 1000;
  const invoice = f.app.billing.invoice(f.actor, shipped.invoiceId),
    result = f.app.orders.expireReservations(
      f.actor,
      "bulk-expire",
      review(f, id),
    );
  assert.equal(result.lines[0]!.released, 2);
  assert.equal(result.lines[0]!.retainedPicked, 2);
  assert.deepEqual(f.app.billing.invoice(f.actor, shipped.invoiceId), invoice);
  assert.equal(invoice.total, 5650);
  const line = f.app.orders.lines(f.actor, id)[0]!;
  assert.deepEqual(
    [line.quantity, line.shipped, line.allocated, line.canceled],
    [6, 2, 2, 0],
  );
  const bulkStock = f.app.inventory
    .stock(f.actor)
    .filter((u) => u.product_id === f.product);
  assert.equal(
    bulkStock.reduce((n, u) => n + u.quantity, 0),
    4,
  );
  assert.equal(
    bulkStock.reduce((n, u) => n + u.quantity * u.cost, 0),
    5400,
  );
  assert.equal(
    bulkStock.reduce((n, u) => n + u.available, 0),
    2,
  );
  assert.deepEqual(f.app.billing.exposure(f.actor, f.buyer), {
    holds: 11300,
    due: 5650,
    total: 16950,
  });
  const second = f.app.fulfillment.commit(f.actor, "ship-retained", {
    shipmentId: retained.id,
    handoverEvidence: "Synthetic deadline passed handover",
  });
  assert.equal(f.app.billing.invoice(f.actor, second.invoiceId).total, 2825);
  assert.deepEqual(f.app.billing.exposure(f.actor, f.buyer), {
    holds: 8475,
    due: 8475,
    total: 16950,
  });
});

test("deadline and expiry validation, closed/stale rejection and descending strict history cursors are effect-free", (t) => {
  t.mock.method(Date, "now", () => epoch);
  const f = fixture(t),
    id = accept(f).id,
    input = { ...review(f, id), expiresAt: epoch + 1000 },
    before = facts(f, id);
  for (const [i, patch] of [
    { expiresAt: epoch },
    { expiresAt: 0 },
    { expiresAt: epoch + 0.5 },
    { expiresAt: NaN },
    { expiresAt: 253402300800000 },
    { expiresAt: undefined },
    { reason: " " },
    { reason: "x".repeat(1001) },
    { revision: 0 },
    { revision: 1.5 },
    { revision: 99 },
  ].entries()) {
    assert.throws(() =>
      f.app.orders.reservationDeadline(f.actor, `invalid-${i}`, {
        ...input,
        ...patch,
      } as typeof input),
    );
    assert.deepEqual(facts(f, id), before);
  }
  assert.throws(
    () => f.app.orders.expireReservations(f.actor, "unlimited", review(f, id)),
    { code: "NOT_DUE" },
  );
  for (let i = 0; i < 25; i++) deadline(f, id, `page-${i}`, epoch + 1000 + i);
  const page = f.app.orders.reservations(f.actor, id);
  assert.deepEqual(
    page.items.map((r) => r.revision),
    Array.from({ length: 20 }, (_, i) => 26 - i),
  );
  assert.equal(page.next, "7");
  assert.deepEqual(
    f.app.orders
      .reservations(f.actor, id, page.next!)
      .items.map((r) => r.revision),
    [6, 5, 4, 3, 2],
  );
  assert.equal(f.app.orders.reservations(f.actor, id, page.next!).next, null);
  for (const cursor of [
    "0",
    "01",
    "1.5",
    "-1",
    "NaN",
    "9007199254740992",
    " 2",
    "2e1",
  ])
    assert.throws(() => f.app.orders.reservations(f.actor, id, cursor), {
      code: "VALIDATION",
    });
  assert.throws(() => f.app.orders.reservations(f.actor, "missing"), {
    code: "NOT_FOUND",
  });
  assert.throws(
    () => f.app.orders.expireReservations(f.actor, "future", review(f, id)),
    { code: "NOT_DUE" },
  );
  const other = accept(f, 1, "other").id;
  assert.equal(f.app.orders.reservations(f.actor, other).items.length, 0);
  ship(f, other);
  assert.throws(() => deadline(f, other, "closed"), { code: "REVISION" });
  assert.throws(
    () =>
      f.app.orders.expireReservations(
        f.actor,
        "closed-expire",
        review(f, other),
      ),
    { code: "REVISION" },
  );
});

for (const action of ["deadline", "expire"] as const)
  test(`late audit fault rolls ${action}, history, stock, money, event and receipt back together`, (t) => {
    let clock = epoch;
    t.mock.method(Date, "now", () => clock);
    const f = fixture(t),
      id = accept(f, 2).id;
    if (action === "expire") {
      deadline(f, id);
      clock += 1000;
    }
    const before = facts(f, id),
      input = review(f, id),
      platform = f.app.database.owned("platform");
    platform.migrate(
      `CREATE TRIGGER platform_expiry_fault BEFORE INSERT ON platform_audit WHEN new.action='order.reservation.${action}' BEGIN SELECT RAISE(ABORT,'synthetic late expiry failure'); END;`,
    );
    const run = () =>
      action === "expire"
        ? f.app.orders.expireReservations(f.actor, "fault", input)
        : f.app.orders.reservationDeadline(f.actor, "fault", {
            ...input,
            expiresAt: epoch + 1000,
          });
    assert.throws(run, /synthetic late expiry failure/);
    assert.deepEqual(facts(f, id), before);
    platform.migrate("DROP TRIGGER platform_expiry_fault");
    assert.equal(run().revision, input.revision + 1);
  });

for (const revocation of ["role", "password", "inactive"] as const)
  test(`fresh ${revocation} revocation denies reads and cached deadline/expiry receipts despite forged grants`, (t) => {
    let clock = epoch;
    t.mock.method(Date, "now", () => clock);
    const f = fixture(t),
      id = accept(f).id,
      actor = user(f, "commercial"),
      input = { ...review(f, id), expiresAt: epoch + 1000 };
    f.app.orders.reservationDeadline(actor, "cached-deadline", input);
    clock += 1000;
    const expiry = review(f, id);
    f.app.orders.expireReservations(actor, "cached-expiry", expiry);
    if (revocation === "role") revoke(f, actor, { role: "warranty" });
    if (revocation === "inactive") revoke(f, actor, { active: false });
    if (revocation === "password")
      f.app.identity.resetPassword(f.actor, "reset", {
        userId: actor.id,
        revision: f.app.identity.users(f.actor).find((u) => u.id === actor.id)!
          .revision,
        password: "different-test-only-password",
        currentPassword: password,
        reason: "Synthetic reset",
      });
    const before = facts(f, id),
      code =
        revocation === "password" ? "PASSWORD_CHANGE_REQUIRED" : "FORBIDDEN";
    for (const stale of [
      actor,
      { ...actor, role: "admin" as const, sites: [f.w1] },
    ]) {
      assert.throws(
        () => f.app.orders.reservationDeadline(stale, "cached-deadline", input),
        { code },
      );
      assert.throws(
        () => f.app.orders.expireReservations(stale, "cached-expiry", expiry),
        { code },
      );
      assert.throws(() => f.app.orders.reservations(stale, id), { code });
    }
    assert.deepEqual(facts(f, id), before);
  });

test("history exposes buyer-visible reasons only to current account, site and organization scopes; buyers cannot manage deadlines", (t) => {
  t.mock.method(Date, "now", () => epoch);
  const f = fixture(t),
    id = accept(f).id,
    buyer = user(f, "buyer"),
    warehouse = user(f, "warehouse", [f.w1]);
  deadline(f, id);
  assert.equal(
    f.app.orders.reservations(buyer, id).items[0]!.reason,
    review(f, id).reason,
  );
  assert.equal(f.app.orders.reservations(warehouse, id).items.length, 1);
  assert.throws(
    () =>
      f.app.orders.reservationDeadline({ ...buyer, role: "admin" }, "buyer", {
        ...review(f, id),
        expiresAt: null,
      }),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () => f.app.orders.expireReservations(buyer, "buyer-expire", review(f, id)),
    { code: "FORBIDDEN" },
  );
  const other = f.app.identity.createCustomer(f.actor, "other-account", {
    name: "Synthetic foreign buyer",
    tier: "standard",
    creditLimit: 1000000,
  }).id;
  revoke(f, buyer, { accountId: other });
  revoke(f, warehouse, { sites: [f.w2] });
  assert.throws(
    () => f.app.orders.reservations({ ...buyer, accountId: f.buyer }, id),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () => f.app.orders.reservations({ ...warehouse, sites: [f.w1] }, id),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () => f.app.orders.reservations({ ...f.actor, orgId: "foreign" }, id),
    { code: "FORBIDDEN" },
  );
});

test("HTTP exact deadline/expiry payloads enforce sessions, CSRF, cursors and revoked retries", async (t) => {
  let clock = epoch;
  t.mock.method(Date, "now", () => clock);
  const f = fixture(t),
    id = accept(f, 2).id,
    actor = user(f, "commercial"),
    input = { ...review(f, id), expiresAt: epoch + 1000 };
  const http = await createHttp(f.app, {
    origin: "http://localhost:3000",
    staticRoot: "/nonexistent-distributor-test",
  });
  t.after(() => http.close());
  const history = `/api/orders/${id}/reservations`,
    url = "/api/commands/order.reservation.deadline",
    expire = "/api/commands/order.reservation.expire";
  assert.equal((await http.inject({ url: history })).statusCode, 401);
  const session = f.app.identity.login(
      f.app.identity.users(f.actor).find((u) => u.id === actor.id)!.email,
      password,
    ),
    cookie = `distributor_session=${session.token}`;
  const headers = {
    cookie,
    "x-csrf-token": session.csrf,
    origin: "http://localhost:3000",
    "idempotency-key": "http-deadline",
  };
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url,
        headers: { cookie },
        payload: input,
      })
    ).statusCode,
    403,
  );
  for (const payload of [
    { ...input, extra: true },
    { ...input, expiresAt: "1900000001000" },
    { ...input, expiresAt: epoch },
    { ...input, revision: 1.5 },
  ])
    assert.equal(
      (await http.inject({ method: "POST", url, headers, payload })).statusCode,
      400,
    );
  const saved = await http.inject({
    method: "POST",
    url,
    headers,
    payload: input,
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.deepEqual(
    (
      await http.inject({ method: "POST", url, headers, payload: input })
    ).json(),
    saved.json(),
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url,
        headers,
        payload: { ...input, reason: "Changed" },
      })
    ).statusCode,
    409,
  );
  const page = await http.inject({ url: history, headers: { cookie } });
  assert.equal(page.statusCode, 200, page.body);
  assert.equal(page.json().expiresAt, epoch + 1000);
  for (const query of [
    "after=0",
    "after=01",
    "after=1.5",
    "after=9007199254740992",
    "after=2&after=3",
    "unexpected=true",
  ])
    assert.equal(
      (await http.inject({ url: `${history}?${query}`, headers: { cookie } }))
        .statusCode,
      400,
    );
  clock += 1000;
  const expiry = review(f, id),
    expiryHeaders = { ...headers, "idempotency-key": "http-expiry" };
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: expire,
        headers: expiryHeaders,
        payload: { ...expiry, expiresAt: null },
      })
    ).statusCode,
    400,
  );
  const released = await http.inject({
    method: "POST",
    url: expire,
    headers: expiryHeaders,
    payload: expiry,
  });
  assert.equal(released.statusCode, 200, released.body);
  assert.equal(
    (await http.inject({ url: history, headers: { cookie } })).json().overdue,
    true,
  );
  revoke(f, actor, { active: false });
  assert.equal(
    (await http.inject({ url: history, headers: { cookie } })).statusCode,
    401,
  );
  assert.equal(
    (await http.inject({ method: "POST", url, headers, payload: input }))
      .statusCode,
    401,
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: expire,
        headers: expiryHeaders,
        payload: expiry,
      })
    ).statusCode,
    401,
  );
  assert.equal(f.app.orders.reservations(f.actor, id).items.length, 2);
});

test("released FIFO stock can satisfy another order while picked commitments remain excluded from allocator availability", (t) => {
  let clock = epoch;
  t.mock.method(Date, "now", () => clock);
  const f = fixture(t),
    id = accept(f, 3).id;
  const picked = f.app.fulfillment.picks(f.actor, id)[0]!;
  f.app.fulfillment.pick(f.actor, "pick", {
    orderId: id,
    allocationId: picked.id,
    serial: picked.serial,
  });
  deadline(f, id);
  clock += 1000;
  const before = facts(f, id);
  for (const [index, patch] of [
    { reason: " " },
    { reason: "x".repeat(1001) },
    { revision: 1 },
    { revision: 0 },
    { revision: 2.5 },
  ].entries()) {
    assert.throws(() =>
      f.app.orders.expireReservations(f.actor, `bad-expire-${index}`, {
        ...review(f, id),
        ...patch,
      }),
    );
    assert.deepEqual(facts(f, id), before);
  }
  f.app.orders.expireReservations(f.actor, "expire", review(f, id));
  const stable = facts(f, id);
  assert.throws(() => accept(f, 3, "too-many"), { code: "STOCK" });
  assert.deepEqual(
    f.app.inventory.allocations(f.actor, id),
    stable.allocations,
  );
  const second = accept(f, 2, "released-stock").id;
  const allocated = f.app.inventory.allocations(f.actor, second);
  assert.equal(
    allocated.reduce((n, a) => n + a.quantity, 0),
    2,
  );
  assert.ok(allocated.every((a) => a.unit_id !== picked.unit_id));
  assert.equal(f.app.inventory.availability(f.actor, f.product, f.w1), 0);
  assert.equal(
    f.app.fulfillment.picks(f.actor, id).find((p) => p.id === picked.id)!.stage,
    "picked",
  );
  assert.equal(f.app.billing.exposure(f.actor, f.buyer).holds, 56500);
});

for (const mode of ["retry", "cancel", "pick", "picked"] as const)
  test(
    `actual OS processes serialize expiry versus ${mode} without duplicate release or money drift`,
    { timeout: 15000 },
    async (t) => {
      let clock = epoch;
      t.mock.method(Date, "now", () => clock);
      const f = fixture(t),
        id = accept(f, 2).id;
      if (mode === "picked") {
        const picked = f.app.fulfillment.picks(f.actor, id)[0]!;
        f.app.fulfillment.pick(f.actor, "pre-pick", {
          orderId: id,
          allocationId: picked.id,
          serial: picked.serial,
        });
      }
      deadline(f, id);
      clock += 1000;
      const expiry = review(f, id),
        line = f.app.orders.lines(f.actor, id)[0]!,
        allocation = f.app.fulfillment.picks(f.actor, id)[0]!;
      const children = [0, 1].map(() =>
        fork(new URL("./reservation-expiry-child.ts", import.meta.url), [], {
          execArgv: ["--import", "tsx"],
          stdio: ["ignore", "ignore", "pipe", "ipc"],
        }),
      );
      t.after(() => children.forEach((c) => c.kill()));
      const jobs = children.map((child, i) => {
        let readyResolve!: () => void,
          resultResolve!: (v: {
            ok: boolean;
            result?: unknown;
            code?: string;
          }) => void,
          reject!: (e: Error) => void;
        const ready = new Promise<void>((r) => (readyResolve = r)),
          result = new Promise<{
            ok: boolean;
            result?: unknown;
            code?: string;
          }>((r, j) => {
            resultResolve = r;
            reject = j;
          });
        let stderr = "";
        child.stderr?.on("data", (d) => (stderr += String(d)));
        child.on("error", reject);
        const exit = new Promise<void>((r, j) =>
          child.on("exit", (code) => {
            if (code === 0) r();
            else {
              const error = new Error(`Expiry child exit ${code}: ${stderr}`);
              reject(error);
              j(error);
            }
          }),
        );
        child.on("message", (m: any) =>
          m.ready ? readyResolve() : resultResolve(m),
        );
        const action =
          i === 0 || mode === "retry"
            ? "expire"
            : mode === "picked"
              ? "pick"
              : mode;
        const payload =
          action === "expire"
            ? expiry
            : action === "cancel"
              ? { ...expiry, lineId: line.id, quantity: 1 }
              : {
                  orderId: id,
                  allocationId: allocation.id,
                  serial: allocation.serial,
                };
        child.send({
          action: "init",
          path: f.path,
          actor: f.actor,
          key: mode === "retry" ? "same-expiry" : `race-${i}`,
          command: action,
          payload,
          clock,
        });
        return { ready, result, exit };
      });
      await Promise.all(jobs.map((j) => j.ready));
      children.forEach((c) => c.send({ action: "go" }));
      const results = await Promise.all(jobs.map((j) => j.result));
      await Promise.all(jobs.map((j) => j.exit));
      if (mode === "retry") {
        assert.equal(results.filter((r) => r.ok).length, 2);
        assert.deepEqual(results[0]!.result, results[1]!.result);
      }
      if (mode === "cancel") {
        assert.equal(results.filter((r) => r.ok).length, 1);
        assert.equal(
          results.find((r) => !r.ok)!.code,
          results[0]!.ok ? "STATE" : "REVISION",
        );
      }
      if (mode === "pick") {
        assert.equal(results[0]!.ok, true);
        assert.equal(results[1]!.ok, false);
        assert.equal(results[1]!.code, "RESERVATION_EXPIRED");
      }
      if (mode === "picked") {
        assert.equal(results.filter((r) => r.ok).length, 2);
        assert.equal(f.app.orders.lines(f.actor, id)[0]!.allocated, 1);
        assert.equal(
          f.app.inventory
            .allocations(f.actor, id)
            .find((a) => a.id === allocation.id)!.stage,
          "picked",
        );
      }
      const current = f.app.orders.lines(f.actor, id)[0]!;
      assert.equal(current.quantity, 2);
      assert.equal(current.shipped, 0);
      assert.equal(
        f.app.inventory.availability(f.actor, f.product, f.w1),
        3 - current.allocated,
      );
      assert.equal(
        f.app.billing.exposure(f.actor, f.buyer).total,
        (2 - current.canceled) * 11300,
      );
      const released = f.app.inventory
        .allocations(f.actor, id)
        .reduce((n, a) => n + a.released, 0);
      assert.equal(released, 2 - current.allocated);
      assert.equal(
        f.app.orders
          .reservations(f.actor, id)
          .items.filter((r) => r.action === "expire").length,
        mode === "cancel" && !results[0]!.ok ? 0 : 1,
      );
    },
  );
