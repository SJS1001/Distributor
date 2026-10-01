import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { fixture, accept, ship } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import { createBackup, restoreBackup } from "../src/server/recovery.ts";
import {
  canonical,
  digest,
  type Actor,
  type Role,
} from "../src/server/core.ts";
type Fixture = ReturnType<typeof fixture>;
function carrier(f: Fixture, key = "order", handoverActor = f.actor) {
  const o = accept(f, 1, key),
    picks = f.app.fulfillment.picks(f.actor, o.id);
  for (const a of picks)
    f.app.fulfillment.pick(f.actor, `pick-${a.id}`, {
      orderId: o.id,
      allocationId: a.id,
      serial: a.serial,
    });
  const p = f.app.fulfillment.pack(f.actor, `pack-${o.id}`, {
    orderId: o.id,
    revision: f.app.orders.order(f.actor, o.id).revision,
    mode: "carrier",
    address: "Synthetic destination",
    lines: picks.map((a) => ({ allocationId: a.id, quantity: a.quantity })),
  });
  f.app.fulfillment.commit(handoverActor, `ship-${o.id}`, {
    shipmentId: p.id,
    carrier: "Synthetic carrier",
    tracking: key,
    handoverEvidence: "Synthetic physical handover",
  });
  return p.id;
}
function observation(f: Fixture, shipmentId: string, reference = "REF") {
  return {
    shipmentId,
    revision: f.app.fulfillment
      .shipments(f.actor)
      .find((s) => s.id === shipmentId)!.delivery!.revision,
    state: "delayed" as const,
    reference,
    evidence: "Private delivery evidence",
    observedAt: new Date().toISOString(),
  };
}
function native(f: Fixture) {
  return {
    stock: f.app.inventory.stock(f.actor),
    orders: f.app.orders.list(f.actor),
    invoices: f.app.billing.invoices(f.actor),
    exposure: f.app.billing.exposure(f.actor, f.buyer),
    shipments: f.app.fulfillment
      .shipments(f.actor)
      .map(({ delivery, ...s }) => s),
  };
}
function user(f: Fixture, role: Role, accountId = f.buyer) {
  const u = f.app.identity.createUser(f.actor, `user-${role}`, {
    name: role,
    email: `delivery-${role}@example.test`,
    password: "long-user-test-password",
    role,
    accountId,
    sites: role === "buyer" ? [] : [f.w1],
  });
  return f.app.identity.currentActor({ ...f.actor, id: u.id });
}
function grants(f: Fixture, a: Actor, changes: Record<string, unknown>) {
  const r = f.app.identity.users(f.actor).find((u) => u.id === a.id)!;
  f.app.identity.updateUser(f.actor, `grants-${a.id}-${r.revision}`, {
    userId: a.id,
    revision: Number(r.revision),
    name: a.name,
    email: String(r.email),
    role: a.role,
    accountId: a.accountId ?? undefined,
    sites: a.sites,
    active: true,
    currentPassword: "long-test-only-password",
    reason: "Synthetic change",
    ...changes,
  });
}
test("carrier delivery observations retain native stock, original sale and money; exact retries survive restart and terminal delivery", (t) => {
  const f = fixture(t),
    shipmentId = carrier(f),
    before = native(f),
    p = observation(f, shipmentId);
  assert.deepEqual(f.app.fulfillment.deliveryHistory(f.actor, shipmentId), {
    items: [],
    next: null,
  });
  const result = f.app.fulfillment.updateDelivery(f.actor, "delay", p);
  assert.equal(result.revision, 1);
  for (const state of ["lost", "in_transit", "delivered"] as const)
    f.app.fulfillment.updateDelivery(f.actor, state, {
      ...observation(f, shipmentId, state),
      state,
    });
  assert.deepEqual(native(f), before);
  assert.equal(
    f.app.fulfillment.shipment(f.actor, shipmentId).state,
    "shipped",
  );
  assert.equal(
    f.app.fulfillment.soldUnit(
      f.actor,
      f.app.inventory.trace(f.actor, "S1").unit.id,
      f.buyer,
    ).shipment.id,
    shipmentId,
  );
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(
    f.app.fulfillment.updateDelivery(f.actor, "delay", p),
    result,
  );
  assert.throws(
    () =>
      f.app.fulfillment.updateDelivery(f.actor, "delay", {
        ...p,
        evidence: "changed",
      }),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  assert.throws(
    () =>
      f.app.fulfillment.updateDelivery(
        f.actor,
        "after-terminal",
        observation(f, shipmentId, "after"),
      ),
    { code: "STATE" },
  );
  assert.throws(
    () =>
      f.app.fulfillment.confirmDelivery(f.actor, "legacy-again", {
        shipmentId,
        reference: "again",
        deliveredAt: new Date().toISOString(),
      }),
    { code: "STATE" },
  );
  assert.equal(
    f.app.database
      .owned("fulfillment")
      .all("SELECT * FROM fulfillment_delivery").length,
    1,
  );
  assert.equal(
    f.app.fulfillment.deliveryHistory(f.actor, shipmentId).items.length,
    4,
  );
});
test("delivery revisions, canonical UTC times, permanent normalized references, collection and packed boundaries", (t) => {
  const f = fixture(t),
    shipmentId = carrier(f);
  for (const change of [
    { revision: -1 },
    { revision: 0.5 },
    { state: "unknown" },
    { reference: "" },
    { evidence: "" },
    { observedAt: "bad" },
    { observedAt: "2026-02-30T00:00:00.000Z" },
    { observedAt: "2020-01-01T00:00:00.000Z" },
    { observedAt: "2099-01-01T00:00:00.000Z" },
    { observedAt: "2026-10-01T00:00:00+00:00" },
  ])
    assert.throws(
      () =>
        f.app.fulfillment.updateDelivery(f.actor, "invalid", {
          ...observation(f, shipmentId),
          ...change,
        } as any),
      { code: "VALIDATION" },
    );
  const p = observation(f, shipmentId);
  f.app.fulfillment.updateDelivery(f.actor, "delay", p);
  assert.throws(() => f.app.fulfillment.updateDelivery(f.actor, "stale", p), {
    code: "STALE_DELIVERY",
  });
  assert.throws(
    () =>
      f.app.fulfillment.updateDelivery(f.actor, "ref", {
        ...observation(f, shipmentId),
        reference: " ＲＥＦ ",
      }),
    { code: "DELIVERY_REFERENCE" },
  );
  const before = native(f);
  f.app.fulfillment.updateDelivery(f.actor, "returned", {
    ...observation(f, shipmentId, "return"),
    state: "returned",
  });
  assert.deepEqual(native(f), before);
  assert.throws(
    () =>
      f.app.fulfillment.updateDelivery(
        f.actor,
        "retry-return",
        observation(f, shipmentId, "next"),
      ),
    { code: "STATE" },
  );
  const collection = ship(f, accept(f, 1, "collection").id);
  assert.throws(
    () =>
      f.app.fulfillment.updateDelivery(
        f.actor,
        "collection",
        observation(f, collection.id),
      ),
    { code: "MODE" },
  );
  const o = accept(f, 1, "packed"),
    a = f.app.fulfillment.picks(f.actor, o.id)[0]!;
  f.app.fulfillment.pick(f.actor, "pick-last", {
    orderId: o.id,
    allocationId: a.id,
    serial: a.serial,
  });
  const packed = f.app.fulfillment.pack(f.actor, "pack-last", {
    orderId: o.id,
    revision: f.app.orders.order(f.actor, o.id).revision,
    mode: "carrier",
    address: "Synthetic destination",
    lines: [{ allocationId: a.id, quantity: 1 }],
  });
  assert.throws(
    () =>
      f.app.fulfillment.updateDelivery(f.actor, "not-handed-over", {
        ...p,
        shipmentId: packed.id,
      }),
    { code: "STATE" },
  );
  assert.throws(() => f.app.fulfillment.deliveryHistory(f.actor, packed.id), {
    code: "STATE",
  });
});
test("delivery history pages tied timestamps, rejects bad cursors and hides evidence from actual buyers even with forged roles", (t) => {
  const f = fixture(t),
    shipmentId = carrier(f),
    time = new Date().toISOString();
  for (let i = 0; i < 23; i++)
    f.app.fulfillment.updateDelivery(f.actor, `event-${i}`, {
      ...observation(f, shipmentId, `ref-${i}`),
      observedAt: time,
    });
  const a = f.app.fulfillment.deliveryHistory(f.actor, shipmentId),
    b = f.app.fulfillment.deliveryHistory(f.actor, shipmentId, a.next!);
  assert.equal(a.items.length, 20);
  assert.equal(b.items.length, 3);
  assert.equal(b.next, null);
  assert.deepEqual(
    [...a.items, ...b.items].map((h) => h.revision),
    Array.from({ length: 23 }, (_, i) => i + 1),
  );
  for (const cursor of [0, -1, 24, 1.5])
    assert.throws(
      () => f.app.fulfillment.deliveryHistory(f.actor, shipmentId, cursor),
      { code: "VALIDATION" },
    );
  const buyer = user(f, "buyer"),
    forged = { ...buyer, role: "admin" as const, accountId: null };
  const publicRows = f.app.fulfillment.deliveryHistory(
    forged,
    shipmentId,
  ).items;
  assert.ok(
    publicRows.every(
      (h) =>
        !Object.hasOwn(h, "reference") &&
        !Object.hasOwn(h, "evidence") &&
        !Object.hasOwn(h, "actorId"),
    ),
  );
  assert.ok(
    !JSON.stringify(f.app.fulfillment.shipments(forged)).includes(
      "Private delivery evidence",
    ),
  );
  assert.throws(
    () =>
      f.app.fulfillment.updateDelivery(
        forged,
        "buyer",
        observation(f, shipmentId, "buyer"),
      ),
    { code: "FORBIDDEN" },
  );
  const other = f.app.identity.createCustomer(f.actor, "other", {
    name: "Other",
    tier: "standard",
    creditLimit: 10000,
  }).id;
  grants(f, buyer, { accountId: other });
  assert.throws(() => f.app.fulfillment.deliveryHistory(forged, shipmentId), {
    code: "FORBIDDEN",
  });
  assert.equal(f.app.fulfillment.shipments(forged).length, 0);
  assert.throws(() =>
    f.app.fulfillment.deliveryHistory(
      { ...f.actor, orgId: "foreign" },
      shipmentId,
    ),
  );
});
test("actual current authority, site, active and password grants precede cached observations and handovers", (t) => {
  const f = fixture(t),
    shipmentId = carrier(f),
    warehouse = user(f, "warehouse"),
    p = observation(f, shipmentId);
  const result = f.app.fulfillment.updateDelivery(warehouse, "saved", p);
  grants(f, warehouse, { sites: [f.w2] });
  assert.throws(() => f.app.fulfillment.updateDelivery(warehouse, "saved", p), {
    code: "FORBIDDEN",
  });
  assert.throws(
    () => f.app.fulfillment.deliveryHistory(warehouse, shipmentId),
    { code: "FORBIDDEN" },
  );
  assert.equal(f.app.fulfillment.shipments(warehouse).length, 0);
  grants(f, warehouse, { sites: [f.w1] });
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
      warehouse.id,
    );
  assert.throws(() => f.app.fulfillment.updateDelivery(warehouse, "saved", p), {
    code: "PASSWORD_CHANGE_REQUIRED",
  });
  assert.throws(
    () => f.app.fulfillment.deliveryHistory(warehouse, shipmentId),
    { code: "PASSWORD_CHANGE_REQUIRED" },
  );
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_user_security SET password_change_required=0 WHERE user_id=?",
      warehouse.id,
    );
  assert.deepEqual(
    f.app.fulfillment.updateDelivery(warehouse, "saved", p),
    result,
  );
  grants(f, warehouse, { role: "support" });
  assert.throws(
    () =>
      f.app.fulfillment.updateDelivery(
        { ...warehouse, role: "admin" },
        "saved",
        p,
      ),
    { code: "FORBIDDEN" },
  );
  grants(f, warehouse, { active: false });
  assert.throws(() => f.app.fulfillment.deliveryHistory(warehouse, shipmentId));
  const commercial = user(f, "commercial");
  grants(f, commercial, { sites: [f.w2] });
  assert.throws(
    () =>
      f.app.fulfillment.updateDelivery(
        commercial,
        "foreign-site",
        observation(f, shipmentId, "site"),
      ),
    { code: "FORBIDDEN" },
  );
  const buyer = user(f, "buyer");
  assert.throws(
    () =>
      f.app.fulfillment.commit({ ...buyer, role: "admin" }, "ship-order", {
        shipmentId,
        carrier: "Synthetic carrier",
        tracking: "order",
        handoverEvidence: "Synthetic physical handover",
      }),
    { code: "FORBIDDEN" },
  );
});
test("committed handover retries require current staff grants; compatibility collection delivery saves one terminal fact", (t) => {
  const f = fixture(t),
    warehouse = user(f, "warehouse"),
    shipmentId = carrier(f, "staff", warehouse),
    shipment = f.app.fulfillment.shipment(f.actor, shipmentId),
    input = {
      shipmentId,
      carrier: "Synthetic carrier",
      tracking: "staff",
      handoverEvidence: "Synthetic physical handover",
    },
    key = `ship-${shipment.order_id}`,
    original = { id: shipmentId, invoiceId: shipment.invoice_id };
  grants(f, warehouse, { sites: [f.w2] });
  assert.throws(() => f.app.fulfillment.commit(warehouse, key, input), {
    code: "FORBIDDEN",
  });
  grants(f, warehouse, { sites: [f.w1] });
  assert.deepEqual(f.app.fulfillment.commit(warehouse, key, input), original);
  grants(f, warehouse, { role: "support" });
  assert.throws(
    () => f.app.fulfillment.commit({ ...warehouse, role: "admin" }, key, input),
    { code: "FORBIDDEN" },
  );
  const collection = ship(f, accept(f, 1, "compatibility").id),
    before = native(f),
    observedAt = new Date().toISOString(),
    proof = {
      shipmentId: collection.id,
      reference: "Counter collection proof",
      deliveredAt: observedAt.replace("Z", "+00:00"),
    };
  assert.deepEqual(
    f.app.fulfillment.confirmDelivery(f.actor, "compatibility-proof", proof),
    { id: collection.id },
  );
  assert.deepEqual(
    f.app.fulfillment.confirmDelivery(f.actor, "compatibility-proof", proof),
    { id: collection.id },
  );
  const history = f.app.fulfillment.deliveryHistory(f.actor, collection.id);
  assert.equal(history.items.length, 1);
  assert.equal(history.items[0]!.state, "delivered");
  assert.equal(history.items[0]!.source, "operator");
  assert.equal(history.items[0]!.observedAt, observedAt);
  assert.deepEqual(native(f), before);
});
test("late audit failure rolls delivery, compatibility receipt, event and durable key back together", (t) => {
  const f = fixture(t),
    shipmentId = carrier(f),
    before = native(f),
    p = { ...observation(f, shipmentId), state: "delivered" as const };
  const tables = () =>
    Object.fromEntries(
      [
        "fulfillment_delivery_history",
        "fulfillment_delivery",
        "platform_events",
        "platform_audit",
        "platform_commands",
      ].map((table) => [
        table,
        f.app.database
          .owned(table.startsWith("platform") ? "platform" : "fulfillment")
          .all(`SELECT * FROM ${table}`),
      ]),
    );
  const saved = tables(),
    audit = f.app.platform.audit.bind(f.app.platform);
  f.app.platform.audit = ((...args: Parameters<typeof audit>) => {
    if (args[1] === "fulfillment.delivery.update")
      throw new Error("Synthetic late audit fault");
    return audit(...args);
  }) as typeof audit;
  assert.throws(
    () => f.app.fulfillment.updateDelivery(f.actor, "fault", p),
    /Synthetic late audit fault/,
  );
  assert.deepEqual(tables(), saved);
  assert.deepEqual(native(f), before);
  f.app.platform.audit = audit;
  assert.equal(
    f.app.fulfillment.updateDelivery(f.actor, "fault", p).revision,
    1,
  );
});
test("legacy delivery imports once, keeps original compatibility receipts and remains terminal", (t) => {
  const f = fixture(t),
    shipmentId = carrier(f),
    input = {
      shipmentId,
      reference: "Original POD",
      deliveredAt: new Date().toISOString(),
    },
    store = f.app.database.owned("fulfillment");
  store.run(
    "INSERT INTO fulfillment_delivery VALUES(?,?,?,?,?,?)",
    "legacy-proof",
    f.actor.orgId,
    shipmentId,
    input.reference,
    input.deliveredAt,
    f.actor.id,
  );
  f.app.database
    .owned("platform")
    .run(
      "INSERT INTO platform_commands VALUES(?,?,?,?,?,?,?)",
      f.actor.orgId,
      f.actor.id,
      "fulfillment.delivery",
      "original",
      digest(canonical(input)),
      JSON.stringify({ id: shipmentId }),
      input.deliveredAt,
    );
  const old = store.all("SELECT * FROM fulfillment_delivery");
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(
    f.app.fulfillment.confirmDelivery(f.actor, "original", input),
    { id: shipmentId },
  );
  const history = f.app.fulfillment.deliveryHistory(f.actor, shipmentId);
  assert.equal(history.items.length, 1);
  assert.equal(history.items[0]!.source, "legacy");
  assert.equal(history.items[0]!.observedAt, input.deliveredAt);
  assert.deepEqual(
    f.app.database
      .owned("fulfillment")
      .all("SELECT * FROM fulfillment_delivery"),
    old,
  );
  assert.throws(
    () =>
      f.app.fulfillment.updateDelivery(
        f.actor,
        "alter-legacy",
        observation(f, shipmentId),
      ),
    { code: "STATE" },
  );
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(
    f.app.fulfillment.deliveryHistory(f.actor, shipmentId),
    history,
  );
});
async function race(
  f: Fixture,
  inputs: ReturnType<typeof observation>[],
  keys: string[],
) {
  const children = inputs.map(() =>
    fork(join(import.meta.dirname, "fulfillment-delivery-child.ts"), [], {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    }),
  );
  let stderr = "";
  for (const c of children) c.stderr!.on("data", (v) => (stderr += v));
  const wait = (child: (typeof children)[number], tag: string) =>
    new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error(`Delivery child timeout ${stderr}`));
      }, 15000);
      const listener = (m: any) => {
        if (m.tag === tag) {
          clearTimeout(timeout);
          child.off("message", listener);
          resolve(m);
        }
      };
      child.on("message", listener);
      child.once("error", (e) => {
        clearTimeout(timeout);
        reject(e);
      });
    });
  try {
    const ready = children.map((c) => wait(c, "ready"));
    children.forEach((c, i) =>
      c.send({ path: f.path, actor: f.actor, input: inputs[i], key: keys[i] }),
    );
    await Promise.all(ready);
    const results = children.map((c) => wait(c, "result"));
    children.forEach((c) => c.send({ go: true }));
    return await Promise.all(results);
  } finally {
    for (const c of children) c.kill();
  }
}
test("separate SQLite processes serialize competing delivery observations and same-key retries", async (t) => {
  const f = fixture(t),
    shipmentId = carrier(f),
    p = observation(f, shipmentId);
  const outcomes = await race(
    f,
    [p, { ...p, state: "lost" as any, reference: "lost" }],
    ["first", "second"],
  );
  assert.equal(outcomes.filter((r) => r.ok).length, 1);
  assert.equal(outcomes.find((r) => !r.ok).code, "STALE_DELIVERY");
  const repeated = observation(f, shipmentId, "repeat"),
    results = await race(f, [repeated, repeated], ["same", "same"]);
  assert.ok(results.every((r) => r.ok));
  assert.deepEqual(results[0].result, results[1].result);
  assert.equal(
    f.app.fulfillment.deliveryHistory(f.actor, shipmentId).items.length,
    2,
  );
});
test("HTTP delivery retains sessions, CSRF, shape, buyer ownership and cursor guards", async (t) => {
  const f = fixture(t),
    shipmentId = carrier(f),
    origin = "http://127.0.0.1:3000",
    http = await createHttp(f.app, {
      origin,
      staticRoot: "/nonexistent-distributor-test",
    });
  await http.ready();
  t.after(() => http.close());
  const login = await http.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: {
        email: "admin@example.test",
        password: "long-test-only-password",
      },
    }),
    c = login.cookies[0]!,
    headers = {
      origin,
      cookie: `${c.name}=${c.value}`,
      "x-csrf-token": login.json().csrf,
      "idempotency-key": "http",
    },
    url = "/api/commands/fulfillment.delivery.update",
    p = observation(f, shipmentId);
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url,
        headers: { origin },
        payload: p,
      })
    ).statusCode,
    401,
  );
  for (const change of [
    { "x-csrf-token": "wrong" },
    { origin: "https://foreign.test" },
  ])
    assert.equal(
      (
        await http.inject({
          method: "POST",
          url,
          headers: { ...headers, ...change },
          payload: p,
        })
      ).statusCode,
      403,
    );
  for (const change of [{ extra: true }, { state: "unknown" }])
    assert.equal(
      (
        await http.inject({
          method: "POST",
          url,
          headers,
          payload: { ...p, ...change },
        })
      ).statusCode,
      400,
    );
  assert.equal(
    (await http.inject({ method: "POST", url, headers, payload: p }))
      .statusCode,
    200,
  );
  const history = `/api/shipments/${shipmentId}/delivery/history`;
  assert.equal(
    (await http.inject({ url: history, headers })).json().items.length,
    1,
  );
  for (const query of ["after=0", "after=2", "extra=1"])
    assert.equal(
      (await http.inject({ url: history + "?" + query, headers })).statusCode,
      400,
    );
  user(
    f,
    "buyer",
    f.app.identity.createCustomer(f.actor, "other-http", {
      name: "Other",
      tier: "standard",
      creditLimit: 1000,
    }).id,
  );
  const b = await http.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: {
        email: "delivery-buyer@example.test",
        password: "long-user-test-password",
      },
    }),
    bc = b.cookies[0]!;
  assert.equal(
    (
      await http.inject({
        url: history,
        headers: { cookie: `${bc.name}=${bc.value}` },
      })
    ).statusCode,
    403,
  );
});
test("encrypted restore retains original delivery history and keys and excludes later terminal outcomes", async (t) => {
  const f = fixture(t),
    shipmentId = carrier(f),
    p = observation(f, shipmentId),
    r = f.app.fulfillment.updateDelivery(f.actor, "delay", p),
    before = f.app.fulfillment.deliveryHistory(f.actor, shipmentId),
    archive = join(dirname(f.path), "delivery.backup"),
    target = join(dirname(f.path), "restored.db"),
    key = randomBytes(32);
  await createBackup(f.path, archive, "CA", key);
  f.app.fulfillment.updateDelivery(f.actor, "later", {
    ...observation(f, shipmentId, "later"),
    state: "delivered",
  });
  await restoreBackup(archive, target, "CA", key);
  const restored = new Application(target);
  t.after(() => restored.close());
  assert.deepEqual(
    restored.fulfillment.deliveryHistory(f.actor, shipmentId),
    before,
  );
  assert.deepEqual(restored.fulfillment.updateDelivery(f.actor, "delay", p), r);
  assert.equal(
    restored.fulfillment.shipments(f.actor).find((s) => s.id === shipmentId)!
      .delivery!.state,
    "delayed",
  );
  assert.ok(restored.platform.recoveryHold());
});
