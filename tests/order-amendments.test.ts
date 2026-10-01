import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import type { Actor, Role } from "../src/server/core.ts";
import { fixture, accept, ship } from "./fixtures.ts";

type Fixture = ReturnType<typeof fixture>;
const password = "long-test-only-password";
function input(f: Fixture, orderId: string, quantity: number) {
  return {
    orderId,
    lineId: f.app.orders.lines(f.actor, orderId)[0]!.id,
    revision: f.app.orders.order(f.actor, orderId).revision,
    quantity,
    allowBackorder: false,
    reason: "Synthetic customer quantity correction",
  };
}
function facts(f: Fixture, orderId: string) {
  return {
    order: f.app.orders.order(f.actor, orderId),
    lines: f.app.orders.lines(f.actor, orderId),
    allocations: f.app.inventory.allocations(f.actor, orderId),
    stock: f.app.inventory.stock(f.actor),
    exposure: f.app.billing.exposure(f.actor, f.buyer),
    invoices: f.app.billing.invoices(f.actor),
    history: f.app.orders.amendments(f.actor, orderId),
    events: f.app.platform.events(f.actor),
    receipts: f.app.database
      .owned("platform")
      .all("SELECT * FROM platform_commands WHERE name='order.amend'"),
    audit: f.app.database
      .owned("platform")
      .all("SELECT * FROM platform_audit WHERE action='order.amend'"),
  };
}
// The shared ship fixture assumes every historical allocation remains open.
// Quantity reductions retain released allocations, so dispatch only the live ones.
function shipOpen(f: Fixture, orderId: string) {
  const picks = f.app.fulfillment
    .picks(f.actor, orderId)
    .filter((p) => p.quantity > p.consumed + p.released);
  for (const pick of picks)
    f.app.fulfillment.pick(f.actor, `open-pick-${pick.id}`, {
      orderId,
      allocationId: pick.id,
      serial: pick.serial,
    });
  const packed = f.app.fulfillment.pack(f.actor, `open-pack-${orderId}`, {
    orderId,
    revision: f.app.orders.order(f.actor, orderId).revision,
    mode: "collection",
    address: "Synthetic counter",
    lines: picks.map((p) => ({
      allocationId: p.id,
      quantity: p.quantity - p.consumed - p.released,
    })),
  });
  return f.app.fulfillment.commit(f.actor, `open-ship-${orderId}`, {
    shipmentId: packed.id,
    handoverEvidence: "Synthetic test handover",
  });
}
function user(f: Fixture, role: Role, sites: string[] = []) {
  const email = `${role}-${sites.join()}@amendment.example.test`;
  const created = f.app.identity.createUser(f.actor, email, {
    email,
    name: `Synthetic ${role}`,
    password,
    role,
    sites,
    ...(role === "buyer" ? { accountId: f.buyer } : {}),
  });
  return f.app.identity.currentActor({ ...f.actor, id: created.id });
}
function updateUser(
  f: Fixture,
  actor: Actor,
  patch: {
    role?: Role;
    accountId?: string;
    sites?: string[];
    active?: boolean;
  },
) {
  const row = f.app.identity.users(f.actor).find((u) => u.id === actor.id)!;
  return f.app.identity.updateUser(f.actor, `revoke-${actor.id}`, {
    userId: actor.id,
    revision: row.revision,
    email: row.email,
    name: row.name,
    role: actor.role,
    ...(actor.accountId ? { accountId: actor.accountId } : {}),
    sites: actor.sites,
    active: true,
    currentPassword: password,
    reason: "Synthetic access revocation",
    ...patch,
  });
}

test("amendments retain accepted price and unit tax after catalog changes and reconcile stock and credit in both directions", (t) => {
  const f = fixture(t),
    orderId = accept(f).id;
  f.app.catalog.setPrice(f.actor, "new-price", {
    productId: f.product,
    tier: "standard",
    unitPrice: 99000,
  });
  f.app.database
    .owned("catalog")
    .run(
      "UPDATE catalog_products SET tax_bp=500,unit_price=80000 WHERE id=?",
      f.product,
    );
  const increased = f.app.orders.amend(
    f.actor,
    "increase",
    input(f, orderId, 3),
  );
  assert.equal(increased.total, 33900);
  assert.equal(increased.allocatedDelta, 2);
  assert.equal(f.app.billing.exposure(f.actor, f.buyer).holds, 33900);
  assert.equal(f.app.orders.lines(f.actor, orderId)[0]!.allocated, 3);
  const decreased = f.app.orders.amend(
    f.actor,
    "decrease",
    input(f, orderId, 1),
  );
  assert.equal(decreased.total, 11300);
  assert.equal(decreased.allocatedDelta, -2);
  assert.equal(f.app.billing.exposure(f.actor, f.buyer).holds, 11300);
  assert.equal(f.app.orders.lines(f.actor, orderId)[0]!.allocated, 1);
  const history = f.app.orders.amendments(f.actor, orderId).items;
  assert.deepEqual(
    history.map((r) => [
      r.before_quantity,
      r.after_quantity,
      r.unit_price,
      r.unit_tax,
      r.before_total,
      r.after_total,
    ]),
    [
      [3, 1, 10000, 1300, 33900, 11300],
      [1, 3, 10000, 1300, 11300, 33900],
    ],
  );
  shipOpen(f, orderId);
  assert.equal(f.app.billing.invoices(f.actor)[0]!.total, 11300);
  assert.deepEqual(f.app.billing.exposure(f.actor, f.buyer), {
    holds: 0,
    due: 11300,
    total: 11300,
  });
});

test("insufficient additional stock rolls credit and reservations back unless backorder is explicitly chosen; reductions consume backorder first", (t) => {
  const f = fixture(t),
    orderId = accept(f).id,
    before = facts(f, orderId);
  const change = input(f, orderId, 5);
  assert.throws(() => f.app.orders.amend(f.actor, "no-backorder", change), {
    code: "STOCK",
  });
  assert.deepEqual(facts(f, orderId), before);
  const increased = f.app.orders.amend(f.actor, "backorder", {
    ...change,
    allowBackorder: true,
  });
  assert.equal(increased.allocatedDelta, 2);
  assert.equal(f.app.billing.exposure(f.actor, f.buyer).holds, 56500);
  const allocations = f.app.inventory.allocations(f.actor, orderId);
  assert.ok(
    f.app.orders.amend(f.actor, "trim-backorder", input(f, orderId, 3))
      .allocatedDelta === 0,
  );
  assert.deepEqual(f.app.inventory.allocations(f.actor, orderId), allocations);
  assert.equal(
    f.app.orders.amend(f.actor, "release-stock", input(f, orderId, 2))
      .allocatedDelta,
    -1,
  );
  assert.equal(f.app.billing.exposure(f.actor, f.buyer).holds, 22600);
});

test("credit holds and limits reject increases atomically while permitting reductions", (t) => {
  const f = fixture(t),
    orderId = accept(f, 2).id;
  f.app.identity.setHold(f.actor, "hold", {
    accountId: f.buyer,
    held: true,
    reason: "Synthetic hold",
  });
  let before = facts(f, orderId);
  assert.throws(
    () => f.app.orders.amend(f.actor, "held", input(f, orderId, 3)),
    { code: "CREDIT_HOLD" },
  );
  assert.deepEqual(facts(f, orderId), before);
  f.app.orders.amend(f.actor, "held-reduction", input(f, orderId, 1));
  f.app.identity.setHold(f.actor, "unhold", {
    accountId: f.buyer,
    held: false,
    reason: "Synthetic release",
  });
  f.app.database
    .owned("iam")
    .run("UPDATE iam_accounts SET credit_limit=11300 WHERE id=?", f.buyer);
  before = facts(f, orderId);
  assert.throws(
    () => f.app.orders.amend(f.actor, "limit", input(f, orderId, 2)),
    { code: "CREDIT_LIMIT" },
  );
  assert.deepEqual(facts(f, orderId), before);
});

test("zero-price increases still respect customer hold and inactive products block increases but permit reductions", (t) => {
  const f = fixture(t);
  f.app.database
    .owned("catalog")
    .run(
      "UPDATE catalog_products SET unit_price=0,tax_bp=0 WHERE id=?",
      f.product,
    );
  const orderId = accept(f, 2).id;
  f.app.identity.setHold(f.actor, "hold", {
    accountId: f.buyer,
    held: true,
    reason: "Synthetic hold",
  });
  const before = facts(f, orderId);
  assert.throws(
    () => f.app.orders.amend(f.actor, "free-held", input(f, orderId, 3)),
    { code: "CREDIT_HOLD" },
  );
  assert.deepEqual(facts(f, orderId), before);
  f.app.identity.setHold(f.actor, "unhold", {
    accountId: f.buyer,
    held: false,
    reason: "Synthetic release",
  });
  f.app.database
    .owned("catalog")
    .run("UPDATE catalog_products SET active=0 WHERE id=?", f.product);
  assert.throws(
    () => f.app.orders.amend(f.actor, "inactive", input(f, orderId, 3)),
    { code: "PRODUCT" },
  );
  assert.equal(
    f.app.orders.amend(f.actor, "inactive-trim", input(f, orderId, 1)).total,
    0,
  );
});

test("shipped and canceled units form an immutable quantity floor and closed orders reject new amendments", (t) => {
  const f = fixture(t),
    orderId = accept(f, 3).id;
  f.app.orders.cancel(f.actor, "cancel", {
    orderId,
    lineId: input(f, orderId, 3).lineId,
    revision: 1,
    quantity: 2,
    reason: "Synthetic cancellation",
  });
  let before = facts(f, orderId);
  assert.throws(
    () => f.app.orders.amend(f.actor, "below-canceled", input(f, orderId, 1)),
    { code: "QUANTITY" },
  );
  assert.deepEqual(facts(f, orderId), before);
  // Dispatch the one remaining allocated unit; two canceled + one shipped close this order.
  shipOpen(f, orderId);
  before = facts(f, orderId);
  assert.throws(
    () => f.app.orders.amend(f.actor, "closed", input(f, orderId, 4)),
    { code: "REVISION" },
  );
  assert.deepEqual(facts(f, orderId), before);
  assert.equal(f.app.orders.lines(f.actor, orderId)[0]!.canceled, 2);
  assert.equal(f.app.orders.lines(f.actor, orderId)[0]!.shipped, 1);
});

test("partially shipped open orders reject reductions below shipped units without changing invoice or exposure", (t) => {
  const f = fixture(t),
    orderId = accept(f, 2).id;
  f.app.orders.amend(f.actor, "add-backorder", {
    ...input(f, orderId, 4),
    allowBackorder: true,
  });
  ship(f, orderId);
  const before = facts(f, orderId);
  assert.equal(before.order.state, "open");
  assert.equal(before.lines[0]!.shipped, 3);
  assert.throws(
    () => f.app.orders.amend(f.actor, "below-shipped", input(f, orderId, 2)),
    { code: "QUANTITY" },
  );
  assert.deepEqual(facts(f, orderId), before);
  f.app.orders.amend(f.actor, "remove-backorder", input(f, orderId, 3));
  assert.equal(f.app.orders.order(f.actor, orderId).state, "closed");
  assert.equal(f.app.billing.exposure(f.actor, f.buyer).holds, 0);
});

test("combined shipped and canceled units remain the amendment floor on a still-open backorder", (t) => {
  const f = fixture(t),
    orderId = accept(f).id;
  f.app.orders.amend(f.actor, "increase-backorder", {
    ...input(f, orderId, 6),
    allowBackorder: true,
  });
  f.app.orders.cancel(f.actor, "cancel-backorder", {
    orderId,
    lineId: input(f, orderId, 6).lineId,
    revision: f.app.orders.order(f.actor, orderId).revision,
    quantity: 1,
    reason: "Synthetic cancellation of backordered unit",
  });
  ship(f, orderId);
  const before = facts(f, orderId);
  assert.equal(before.order.state, "open");
  assert.equal(before.lines[0]!.shipped, 3);
  assert.equal(before.lines[0]!.canceled, 1);
  assert.throws(
    () =>
      f.app.orders.amend(f.actor, "below-combined-floor", input(f, orderId, 3)),
    { code: "QUANTITY" },
  );
  assert.deepEqual(facts(f, orderId), before);
  f.app.orders.amend(f.actor, "to-combined-floor", input(f, orderId, 4));
  assert.equal(f.app.orders.order(f.actor, orderId).state, "closed");
  assert.deepEqual(f.app.billing.invoices(f.actor), before.invoices);
  assert.equal(f.app.billing.exposure(f.actor, f.buyer).holds, 0);
});

for (const packed of [false, true])
  test(`${packed ? "packed" : "picked"} commitments prevent amendment reductions and preserve shipment evidence`, (t) => {
    const f = fixture(t),
      orderId = accept(f, 2).id,
      picks = f.app.fulfillment.picks(f.actor, orderId);
    for (const pick of picks)
      f.app.fulfillment.pick(f.actor, `pick-${pick.id}`, {
        orderId,
        allocationId: pick.id,
        serial: pick.serial,
      });
    if (packed)
      f.app.fulfillment.pack(f.actor, "pack", {
        orderId,
        revision: f.app.orders.order(f.actor, orderId).revision,
        mode: "collection",
        address: "Synthetic counter",
        lines: picks.map((p) => ({ allocationId: p.id, quantity: p.quantity })),
      });
    const before = facts(f, orderId),
      shipments = f.app.database
        .owned("fulfillment")
        .all("SELECT * FROM fulfillment_shipments");
    assert.throws(
      () => f.app.orders.amend(f.actor, "reduce", input(f, orderId, 1)),
      { code: "PICKED" },
    );
    assert.deepEqual(facts(f, orderId), before);
    assert.deepEqual(
      f.app.database
        .owned("fulfillment")
        .all("SELECT * FROM fulfillment_shipments"),
      shipments,
    );
  });

test("amendment validation, revision conflicts and changed idempotency payloads leave no effects; exact retries survive restart", (t) => {
  const f = fixture(t),
    orderId = accept(f).id,
    change = input(f, orderId, 2),
    before = facts(f, orderId);
  for (const [index, patch] of [
    { quantity: 0 },
    { quantity: 1.5 },
    { quantity: 100001 },
    { quantity: 1 },
    { reason: " " },
    { reason: "x".repeat(1001) },
    { revision: 0 },
    { revision: 1.5 },
    { revision: 999 },
    { allowBackorder: undefined },
    { lineId: "missing" },
  ].entries()) {
    assert.throws(() =>
      f.app.orders.amend(f.actor, `invalid-${index}`, {
        ...change,
        ...patch,
      } as typeof change),
    );
    assert.deepEqual(facts(f, orderId), before);
  }
  const saved = f.app.orders.amend(f.actor, "saved", change);
  const after = facts(f, orderId);
  assert.throws(() => f.app.orders.amend(f.actor, "stale", change), {
    code: "REVISION",
  });
  for (const patch of [
    { quantity: 3 },
    { reason: "Changed reason" },
    { allowBackorder: true },
  ])
    assert.throws(
      () => f.app.orders.amend(f.actor, "saved", { ...change, ...patch }),
      { code: "IDEMPOTENCY_CONFLICT" },
    );
  assert.deepEqual(facts(f, orderId), after);
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(f.app.orders.amend(f.actor, "saved", change), saved);
  assert.deepEqual(facts(f, orderId), after);
});

test("amendment history is descending, bounded, order scoped and durable, with strict cursor validation", (t) => {
  const f = fixture(t),
    orderId = accept(f).id;
  for (let i = 0; i < 25; i++)
    f.app.orders.amend(
      f.actor,
      `page-${i}`,
      input(f, orderId, i % 2 === 0 ? 2 : 1),
    );
  const page = f.app.orders.amendments(f.actor, orderId);
  assert.deepEqual(
    page.items.map((r) => r.revision),
    Array.from({ length: 20 }, (_, i) => 26 - i),
  );
  assert.equal(page.next, "7");
  const rest = f.app.orders.amendments(f.actor, orderId, page.next!);
  assert.deepEqual(
    rest.items.map((r) => r.revision),
    [6, 5, 4, 3, 2],
  );
  assert.equal(rest.next, null);
  const other = accept(f, 1, "other").id;
  assert.deepEqual(f.app.orders.amendments(f.actor, other), {
    items: [],
    next: null,
  });
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
    assert.throws(() => f.app.orders.amendments(f.actor, orderId, cursor), {
      code: "VALIDATION",
    });
  assert.throws(() => f.app.orders.amendments(f.actor, "missing"), {
    code: "NOT_FOUND",
  });
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(f.app.orders.amendments(f.actor, orderId), page);
});

for (const revocation of ["role", "account", "password", "inactive"] as const)
  test(`fresh ${revocation} revocation blocks amendment history and cached command retries from captured or forged actors`, (t) => {
    const f = fixture(t),
      orderId = accept(f).id,
      actor = user(f, "buyer"),
      change = input(f, orderId, 2);
    f.app.orders.amend(actor, "cached", change);
    assert.equal(f.app.orders.amendments(actor, orderId).items.length, 1);
    if (revocation === "role") updateUser(f, actor, { role: "warranty" });
    if (revocation === "account") {
      const other = f.app.identity.createCustomer(f.actor, "other-account", {
        name: "Synthetic other buyer",
        tier: "standard",
        creditLimit: 1000000,
      }).id;
      updateUser(f, actor, { accountId: other });
    }
    if (revocation === "inactive") updateUser(f, actor, { active: false });
    if (revocation === "password")
      f.app.identity.resetPassword(f.actor, "reset", {
        userId: actor.id,
        revision: f.app.identity.users(f.actor).find((u) => u.id === actor.id)!
          .revision,
        password: "different-test-only-password",
        currentPassword: password,
        reason: "Synthetic reset",
      });
    const before = facts(f, orderId),
      code =
        revocation === "password" ? "PASSWORD_CHANGE_REQUIRED" : "FORBIDDEN";
    for (const stale of [
      actor,
      { ...actor, role: "admin" as const, accountId: f.buyer },
    ]) {
      assert.throws(() => f.app.orders.amend(stale, "cached", change), {
        code,
      });
      assert.throws(() => f.app.orders.amendments(stale, orderId), { code });
    }
    assert.deepEqual(facts(f, orderId), before);
  });

test("fresh site and organization scopes deny amendment history after warehouse grant revocation", (t) => {
  const f = fixture(t),
    orderId = accept(f).id,
    warehouse = user(f, "warehouse", [f.w1]);
  f.app.orders.amend(f.actor, "saved", input(f, orderId, 2));
  assert.equal(f.app.orders.amendments(warehouse, orderId).items.length, 1);
  updateUser(f, warehouse, { sites: [f.w2] });
  assert.throws(
    () =>
      f.app.orders.amendments(
        { ...warehouse, sites: [f.w1], role: "admin" },
        orderId,
      ),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () => f.app.orders.amendments({ ...f.actor, orgId: "foreign" }, orderId),
    { code: "FORBIDDEN" },
  );
});

test("late audit failure rolls amendment, stock, credit, event and receipt back together and allows retry", (t) => {
  const f = fixture(t),
    orderId = accept(f).id,
    before = facts(f, orderId),
    change = input(f, orderId, 3);
  const platform = f.app.database.owned("platform");
  platform.migrate(
    "CREATE TRIGGER platform_amendment_fault BEFORE INSERT ON platform_audit WHEN new.action='order.amend' BEGIN SELECT RAISE(ABORT,'synthetic late amendment failure'); END;",
  );
  assert.throws(
    () => f.app.orders.amend(f.actor, "fault", change),
    /synthetic late amendment failure/,
  );
  assert.deepEqual(facts(f, orderId), before);
  platform.migrate("DROP TRIGGER platform_amendment_fault");
  assert.equal(f.app.orders.amend(f.actor, "fault", change).revision, 2);
  assert.equal(f.app.orders.amendments(f.actor, orderId).items.length, 1);
});

test("HTTP amendment commands enforce authentication, CSRF and exact payloads; history validates cursors and revokes cached retries", async (t) => {
  const f = fixture(t),
    orderId = accept(f).id,
    buyer = user(f, "buyer"),
    change = input(f, orderId, 2);
  const http = await createHttp(f.app, {
    origin: "http://localhost:3000",
    staticRoot: "/nonexistent-distributor-test",
  });
  t.after(() => http.close());
  const url = "/api/commands/order.amend",
    history = `/api/orders/${orderId}/amendments`;
  assert.equal((await http.inject({ url: history })).statusCode, 401);
  const email = f.app.identity
    .users(f.actor)
    .find((u) => u.id === buyer.id)!.email;
  const session = f.app.identity.login(email, password),
    cookie = `distributor_session=${session.token}`;
  const headers = {
    cookie,
    "x-csrf-token": session.csrf,
    origin: "http://localhost:3000",
    "idempotency-key": "http-saved",
  };
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url,
        headers: { cookie },
        payload: change,
      })
    ).statusCode,
    403,
  );
  for (const payload of [
    { ...change, extra: true },
    { ...change, allowBackorder: "true" },
    { ...change, quantity: 1.5 },
  ])
    assert.equal(
      (await http.inject({ method: "POST", url, headers, payload })).statusCode,
      400,
    );
  const response = await http.inject({
    method: "POST",
    url,
    headers,
    payload: change,
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(
    (
      await http.inject({ method: "POST", url, headers, payload: change })
    ).json(),
    response.json(),
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url,
        headers,
        payload: { ...change, reason: "Different reason" },
      })
    ).statusCode,
    409,
  );
  const page = await http.inject({ url: history, headers: { cookie } });
  assert.equal(page.statusCode, 200, page.body);
  assert.equal(page.json().items[0].after_quantity, 2);
  for (const query of [
    "after=0",
    "after=01",
    "after=1.5",
    "after=9007199254740992",
    "unexpected=true",
  ])
    assert.equal(
      (await http.inject({ url: `${history}?${query}`, headers: { cookie } }))
        .statusCode,
      400,
    );
  updateUser(f, buyer, { active: false });
  assert.equal(
    (await http.inject({ url: history, headers: { cookie } })).statusCode,
    401,
  );
  assert.equal(
    (await http.inject({ method: "POST", url, headers, payload: change }))
      .statusCode,
    401,
  );
  assert.equal(f.app.orders.amendments(f.actor, orderId).items.length, 1);
});

test(
  "two OS processes serialize competing revisions and exact idempotent retries without duplicated credit or stock",
  { timeout: 15000 },
  async (t) => {
    for (const identical of [false, true]) {
      const f = fixture(t),
        orderId = accept(f).id,
        change = input(f, orderId, 2);
      const children = [0, 1].map(() =>
        fork(new URL("./order-amendment-child.ts", import.meta.url), [], {
          execArgv: ["--import", "tsx"],
          stdio: ["ignore", "ignore", "pipe", "ipc"],
        }),
      );
      t.after(() => children.forEach((c) => c.kill()));
      const ready: Promise<void>[] = [],
        outcomes: Promise<{ ok: boolean; result?: unknown; code?: string }>[] =
          [],
        exits: Promise<void>[] = [];
      children.forEach((child, i) => {
        let signal!: () => void,
          resolve!: (v: any) => void,
          reject!: (e: Error) => void;
        ready.push(
          new Promise((r) => {
            signal = r;
          }),
        );
        outcomes.push(
          new Promise((r, j) => {
            resolve = r;
            reject = j;
          }),
        );
        let stderr = "";
        child.stderr?.on("data", (d) => {
          stderr += String(d);
        });
        child.on("message", (m: any) => (m.ready ? signal() : resolve(m)));
        child.on("error", reject);
        exits.push(
          new Promise((r, j) =>
            child.on("exit", (code) => {
              if (code === 0) r();
              else {
                const error = new Error(`Child exit ${code}: ${stderr}`);
                reject(error);
                j(error);
              }
            }),
          ),
        );
        child.send({
          action: "init",
          path: f.path,
          actor: f.actor,
          key: identical ? "same" : `race-${i}`,
          input: change,
        });
      });
      await Promise.all(ready);
      children.forEach((child) => child.send({ action: "go" }));
      const results = await Promise.all(outcomes);
      await Promise.all(exits);
      assert.equal(results.filter((r) => r.ok).length, identical ? 2 : 1);
      if (identical) assert.deepEqual(results[0]!.result, results[1]!.result);
      else assert.equal(results.find((r) => !r.ok)!.code, "REVISION");
      assert.equal(f.app.orders.order(f.actor, orderId).revision, 2);
      assert.equal(f.app.orders.lines(f.actor, orderId)[0]!.allocated, 2);
      assert.equal(f.app.billing.exposure(f.actor, f.buyer).holds, 22600);
      assert.equal(f.app.orders.amendments(f.actor, orderId).items.length, 1);
      assert.equal(
        f.app.database
          .owned("platform")
          .all("SELECT * FROM platform_commands WHERE name='order.amend'")
          .length,
        1,
      );
    }
  },
);
