import { test } from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { Application } from "../src/server/application.ts";
import type { Actor } from "../src/server/core.ts";
import { createHttp } from "../src/server/http.ts";
import { fixture, accept } from "./fixtures.ts";

type Fixture = ReturnType<typeof fixture>;
function bulk(f: Fixture, quantity = 5, ordered = 4) {
  const product = f.app.catalog.create(f.actor, "bulk", {
    sku: "BULK",
    name: "Synthetic shortage supplies",
    serialized: false,
    unitPrice: 2500,
    taxBasisPoints: 1300,
  }).id;
  const po = f.app.procurement.create(f.actor, "bulk-po", {
    supplierId: f.supplier,
    warehouseId: f.w1,
    lines: [{ productId: product, quantity, unitCost: 1000 }],
  }).id;
  const line = f.app.procurement.orders(f.actor).find((p) => p.id === po)!
    .lines[0]!;
  f.app.procurement.receive(f.actor, "bulk-receipt", {
    poId: po,
    lineId: String(line.id),
    deliveryRef: "BULK-DEL",
    quantity,
    serials: [],
    bin: "B-1",
    quarantine: false,
  });
  const c = f.app.orders.saveCart(f.actor, "bulk-cart", {
    accountId: f.buyer,
    warehouseId: f.w1,
    revision: 0,
    lines: [{ productId: product, quantity: ordered }],
  });
  const q = f.app.orders.quote(f.actor, "bulk-quote", {
    cartId: c.id,
    revision: c.revision,
  });
  const o = f.app.orders.accept(f.actor, "bulk-order", {
    quoteId: q.id,
    allowBackorder: false,
  });
  return {
    product,
    orderId: o.id,
    allocation: f.app.fulfillment.picks(f.actor, o.id)[0]!,
  };
}
function input(
  f: Fixture,
  orderId: string,
  allocationId: string,
  quantity = 1,
) {
  const a = f.app.fulfillment
    .picks(f.actor, orderId)
    .find((a) => a.id === allocationId)!;
  return {
    orderId,
    allocationId,
    revision: f.app.orders.order(f.actor, orderId).revision,
    unitRevision: a.unitRevision,
    quantity,
    reason: "Synthetic stock could not be located",
  };
}
function snapshot(f: Fixture, orderId: string) {
  return {
    stock: f.app.inventory.stock(f.actor),
    lines: f.app.orders.lines(f.actor, orderId),
    order: f.app.orders.order(f.actor, orderId),
    picks: f.app.fulfillment.picks(f.actor, orderId),
    reports: f.app.fulfillment.shortPicks(f.actor, orderId),
    invoices: f.app.billing.invoices(f.actor),
    exposure: f.app.billing.exposure(f.actor, f.buyer),
    costs: f.app.inventory.costs.window(f.actor, 0),
    events: f.app.platform.events(f.actor),
  };
}
function worker(f: Fixture, role: Actor["role"] = "warehouse") {
  const id = f.app.identity.createUser(f.actor, `user-${role}`, {
    email: `${role}@example.test`,
    name: `Synthetic ${role}`,
    password: "long-test-only-password",
    role,
    sites: [f.w1],
    ...(role === "buyer" ? { accountId: f.buyer } : {}),
  }).id;
  return f.app.identity.currentActor({ ...f.actor, id });
}

test("bulk short picks preserve packed supply, cost, exposure and source identity across restart and exact retry", (t) => {
  const f = fixture(t),
    b = bulk(f);
  f.app.fulfillment.pick(f.actor, "pick", {
    orderId: b.orderId,
    allocationId: b.allocation.id,
    serial: null,
  });
  const first = f.app.fulfillment.pack(f.actor, "pack-first", {
    orderId: b.orderId,
    revision: 1,
    mode: "collection",
    address: "Synthetic counter one",
    lines: [{ allocationId: b.allocation.id, quantity: 1 }],
  });
  const before = snapshot(f, b.orderId),
    payload = input(f, b.orderId, b.allocation.id, 2);
  const report = f.app.fulfillment.shortPick(f.actor, "short", payload);
  assert.notEqual(report.heldUnitId, b.allocation.unit_id);
  const source = f.app.inventory.unit(f.actor, b.allocation.unit_id),
    held = f.app.inventory.unit(f.actor, report.heldUnitId);
  assert.deepEqual(
    [source.quantity, held.quantity, held.condition, held.cost, held.bin],
    [3, 2, "quarantine", 1000, "B-1"],
  );
  assert.equal(
    f.app.inventory.purchaseOrigin(f.actor, held.id),
    f.app.inventory.purchaseOrigin(f.actor, source.id),
  );
  assert.equal(
    f.app.inventory.costs.window(f.actor, 0).closingValue,
    before.costs.closingValue,
  );
  assert.deepEqual(f.app.billing.exposure(f.actor, f.buyer), before.exposure);
  assert.equal(f.app.billing.invoices(f.actor).length, 0);
  const p = f.app.fulfillment.picks(f.actor, b.orderId)[0]!;
  assert.deepEqual(
    [p.released, p.packed, p.packable, p.stage],
    [2, 1, 1, "picked"],
  );
  const l = f.app.orders.lines(f.actor, b.orderId)[0]!;
  assert.deepEqual(
    [l.quantity, l.allocated, l.shipped, l.canceled],
    [4, 2, 0, 0],
  );
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(
    f.app.fulfillment.shortPick(f.actor, "short", payload),
    report,
  );
  assert.equal(
    f.app.fulfillment.shortPicks(f.actor, b.orderId).items.length,
    1,
  );
  assert.throws(
    () =>
      f.app.fulfillment.shortPick(f.actor, "short", {
        ...payload,
        reason: "Changed evidence",
      }),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  const second = f.app.fulfillment.pack(f.actor, "pack-second", {
    orderId: b.orderId,
    revision: report.revision,
    mode: "collection",
    address: "Synthetic counter two",
    lines: [{ allocationId: p.id, quantity: 1 }],
  });
  for (const s of [second, first])
    f.app.fulfillment.commit(f.actor, `ship-${s.id}`, {
      shipmentId: s.id,
      handoverEvidence: "Synthetic verified supply",
    });
  f.app.orders.cancel(f.actor, "cancel-backorder", {
    orderId: b.orderId,
    revision: f.app.orders.order(f.actor, b.orderId).revision,
    lineId: l.id,
    quantity: 2,
    reason: "Synthetic customer canceled unavailable units",
  });
  assert.equal(f.app.orders.order(f.actor, b.orderId).state, "closed");
  assert.equal(
    f.app.billing.invoices(f.actor).reduce((sum, i) => sum + i.total, 0),
    5650,
  );
  assert.equal(f.app.billing.exposure(f.actor, f.buyer).total, 5650);
  assert.equal(f.app.inventory.unit(f.actor, held.id).quantity, 2);
  assert.equal(
    f.app.inventory.costs.window(f.actor, 0).closingValue,
    before.costs.closingValue - 2000,
  );
});

test("reported missing book stock changes value only after independently approved bulk count", (t) => {
  const f = fixture(t),
    b = bulk(f),
    before = snapshot(f, b.orderId);
  const report = f.app.fulfillment.shortPick(
    f.actor,
    "short",
    input(f, b.orderId, b.allocation.id, 2),
  );
  const observer = worker(f);
  const held = f.app.inventory.unit(f.actor, report.heldUnitId);
  const count = f.app.inventory.startCount(observer, "count", {
    unitId: held.id,
    revision: held.revision,
    countRef: "SHORT-REVIEW",
  });
  f.app.inventory.submitCount(observer, "observe", {
    countId: count.id,
    quantity: 0,
    reason: "Synthetic whole-bin review confirms missing two units",
  });
  assert.equal(
    f.app.inventory.costs.window(f.actor, 0).closingValue,
    before.costs.closingValue,
  );
  f.app.inventory.decideCount(f.actor, "approve", {
    countId: count.id,
    decision: "approve",
    reason: "Synthetic reviewed shortage evidence",
  });
  assert.equal(
    f.app.inventory.costs.window(f.actor, 0).closingValue,
    before.costs.closingValue - 2000,
  );
  assert.equal(f.app.billing.invoices(f.actor).length, 0);
  assert.deepEqual(f.app.billing.exposure(f.actor, f.buyer), before.exposure);
  assert.equal(f.app.orders.lines(f.actor, b.orderId)[0]!.allocated, 2);
});

test("found bulk stock requires inspection before reallocation; another order's reservation remains supplyable", (t) => {
  const f = fixture(t),
    b = bulk(f, 5, 3);
  const c = f.app.orders.saveCart(f.actor, "other-cart", {
    accountId: f.buyer,
    warehouseId: f.w1,
    revision: f.app.orders.carts(f.actor)[0]!.revision as number,
    lines: [{ productId: b.product, quantity: 2 }],
  });
  const q = f.app.orders.quote(f.actor, "other-quote", {
    cartId: c.id,
    revision: c.revision,
  });
  const other = f.app.orders.accept(f.actor, "other-order", {
    quoteId: q.id,
    allowBackorder: false,
  });
  const otherBefore = f.app.fulfillment.picks(f.actor, other.id);
  const report = f.app.fulfillment.shortPick(
    f.actor,
    "short",
    input(f, b.orderId, b.allocation.id, 2),
  );
  assert.equal(f.app.inventory.availability(f.actor, b.product, f.w1), 0);
  f.app.orders.allocate(f.actor, "still-held", {
    orderId: b.orderId,
    revision: report.revision,
  });
  assert.equal(f.app.orders.lines(f.actor, b.orderId)[0]!.allocated, 1);
  assert.deepEqual(
    f.app.fulfillment
      .picks(f.actor, other.id)
      .map(({ unitRevision, ...a }) => a),
    otherBefore.map(({ unitRevision, ...a }) => a),
  );
  const held = f.app.inventory.unit(f.actor, report.heldUnitId);
  f.app.inventory.inspect(f.actor, "found", {
    unitId: held.id,
    revision: held.revision,
    condition: "usable",
    reason: "Synthetic found and inspected units",
  });
  f.app.orders.allocate(f.actor, "found-allocation", {
    orderId: b.orderId,
    revision: f.app.orders.order(f.actor, b.orderId).revision,
  });
  assert.equal(f.app.orders.lines(f.actor, b.orderId)[0]!.allocated, 3);
  assert.equal(
    f.app.inventory
      .stock(f.actor)
      .filter((u) => u.product_id === b.product)
      .reduce((s, u) => s + u.reserved, 0),
    5,
  );
});

test("serialized shortage preserves custody trace and replacement serial supplies the backorder", (t) => {
  const f = fixture(t),
    o = accept(f),
    a = f.app.fulfillment.picks(f.actor, o.id)[0]!;
  const r = f.app.fulfillment.shortPick(f.actor, "short", input(f, o.id, a.id));
  assert.equal(r.heldUnitId, a.unit_id);
  assert.equal(
    f.app.inventory.trace(f.actor, "S1").unit.condition,
    "quarantine",
  );
  assert.equal(f.app.inventory.availability(f.actor, f.product, f.w1), 2);
  f.app.orders.allocate(f.actor, "replacement-allocation", {
    orderId: o.id,
    revision: r.revision,
  });
  const next = f.app.fulfillment
    .picks(f.actor, o.id)
    .find((a) => a.quantity > a.released)!;
  assert.equal(next.serial, "S2");
  f.app.fulfillment.pick(f.actor, "pick-S2", {
    orderId: o.id,
    allocationId: next.id,
    serial: "S2",
  });
  const p = f.app.fulfillment.pack(f.actor, "pack-S2", {
    orderId: o.id,
    revision: f.app.orders.order(f.actor, o.id).revision,
    mode: "collection",
    address: "Synthetic counter",
    lines: [{ allocationId: next.id, quantity: 1 }],
  });
  f.app.fulfillment.commit(f.actor, "ship-S2", {
    shipmentId: p.id,
    handoverEvidence: "Synthetic replacement supply",
  });
  assert.equal(f.app.inventory.trace(f.actor, "S2").unit.state, "sold");
  assert.deepEqual(
    [
      f.app.inventory.trace(f.actor, "S1").unit.state,
      f.app.inventory.trace(f.actor, "S1").unit.quantity,
    ],
    ["stock", 1],
  );
  assert.equal(f.app.billing.invoices(f.actor)[0]!.total, 11300);
  assert.equal(f.app.fulfillment.shortPicks(f.actor, o.id).items[0]!.id, r.id);
});

test("invalid quantities, evidence, stale revisions and wrong allocations cannot change any native facts", (t) => {
  const f = fixture(t),
    b = bulk(f),
    payload = input(f, b.orderId, b.allocation.id),
    before = snapshot(f, b.orderId);
  const invalid = [
    { quantity: 0 },
    { quantity: -1 },
    { quantity: 0.5 },
    { quantity: 5 },
    { quantity: NaN },
    { reason: " " },
    { reason: "x".repeat(1001) },
    { revision: 999 },
    { unitRevision: 999 },
    { allocationId: "unknown" },
  ];
  for (const [i, change] of invalid.entries()) {
    assert.throws(() =>
      f.app.fulfillment.shortPick(f.actor, `invalid-${i}`, {
        ...payload,
        ...change,
      }),
    );
    assert.deepEqual(snapshot(f, b.orderId), before);
  }
  assert.throws(
    () =>
      f.app.fulfillment.shortPick(
        { ...f.actor, orgId: "other-org" },
        "foreign",
        payload,
      ),
    { code: "FORBIDDEN" },
  );
  assert.deepEqual(snapshot(f, b.orderId), before);
});

test("packed allocations refuse shortages until packing is explicitly voided", (t) => {
  const f = fixture(t),
    o = accept(f),
    a = f.app.fulfillment.picks(f.actor, o.id)[0]!;
  f.app.fulfillment.pick(f.actor, "pick", {
    orderId: o.id,
    allocationId: a.id,
    serial: a.serial,
  });
  const p = f.app.fulfillment.pack(f.actor, "pack", {
    orderId: o.id,
    revision: 1,
    mode: "collection",
    address: "Synthetic counter",
    lines: [{ allocationId: a.id, quantity: 1 }],
  });
  const before = snapshot(f, o.id);
  assert.throws(
    () => f.app.fulfillment.shortPick(f.actor, "short", input(f, o.id, a.id)),
    { code: "PACKED" },
  );
  assert.deepEqual(snapshot(f, o.id), before);
  f.app.fulfillment.void(f.actor, "void", {
    shipmentId: p.id,
    reason: "Synthetic packed stock not physically supplied",
  });
  f.app.fulfillment.shortPick(f.actor, "short", input(f, o.id, a.id));
  assert.equal(f.app.orders.lines(f.actor, o.id)[0]!.allocated, 0);
});

test("late audit failure rolls back shortage allocations, split lots, movement clock, event and report together", (t) => {
  const f = fixture(t),
    b = bulk(f),
    before = snapshot(f, b.orderId),
    payload = input(f, b.orderId, b.allocation.id, 2);
  const original = f.app.platform.audit;
  f.app.platform.audit = (...args) => {
    if (args[1] === "fulfillment.short-pick")
      throw new Error("Synthetic late audit fault");
    return original.apply(f.app.platform, args);
  };
  assert.throws(
    () => f.app.fulfillment.shortPick(f.actor, "short", payload),
    /Synthetic late audit fault/,
  );
  assert.deepEqual(snapshot(f, b.orderId), before);
  f.app.platform.audit = original;
  f.app.fulfillment.shortPick(f.actor, "short", payload);
  assert.equal(
    f.app.fulfillment.shortPicks(f.actor, b.orderId).items.length,
    1,
  );
});

test("cached shortages and histories recheck real role, site, active status and password requirements", (t) => {
  const f = fixture(t),
    o = accept(f),
    a = f.app.fulfillment.picks(f.actor, o.id)[0]!,
    staff = worker(f),
    payload = input(f, o.id, a.id);
  f.app.fulfillment.shortPick(staff, "short", payload);
  const iam = f.app.database.owned("iam");
  for (const sql of [
    "UPDATE iam_users SET role='finance' WHERE id=?",
    "UPDATE iam_users SET sites='[]' WHERE id=?",
    "UPDATE iam_users SET active=0 WHERE id=?",
    "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
  ]) {
    iam.run(sql, staff.id);
    assert.throws(() => f.app.fulfillment.shortPick(staff, "short", payload));
    assert.throws(() => f.app.fulfillment.shortPicks(staff, o.id));
    iam.run(
      "UPDATE iam_users SET role='warehouse',sites=?,active=1 WHERE id=?",
      JSON.stringify([f.w1]),
      staff.id,
    );
    iam.run(
      "UPDATE iam_user_security SET password_change_required=0 WHERE user_id=?",
      staff.id,
    );
  }
  for (const role of ["commercial", "support"] as const)
    assert.equal(
      f.app.fulfillment.shortPicks(worker(f, role), o.id).items.length,
      1,
    );
  assert.throws(() => f.app.fulfillment.shortPicks(worker(f, "buyer"), o.id), {
    code: "FORBIDDEN",
  });
});

test("short-pick history pages by order without losing same-timestamp reports or accepting foreign cursors", (t) => {
  const f = fixture(t),
    b = bulk(f, 25, 25);
  const ids = [];
  for (let i = 0; i < 25; i++)
    ids.push(
      f.app.fulfillment.shortPick(
        f.actor,
        `short-${i}`,
        input(f, b.orderId, b.allocation.id),
      ).id,
    );
  f.app.database
    .owned("fulfillment")
    .run(
      "UPDATE fulfillment_short_picks SET created_at=? WHERE order_id=?",
      "2026-10-01T00:00:00.000Z",
      b.orderId,
    );
  const first = f.app.fulfillment.shortPicks(f.actor, b.orderId);
  assert.equal(first.items.length, 20);
  const second = f.app.fulfillment.shortPicks(
    f.actor,
    b.orderId,
    first.nextCursor!,
  );
  assert.equal(second.items.length, 5);
  assert.equal(second.nextCursor, null);
  assert.deepEqual(
    [...first.items, ...second.items].map((r) => r.id),
    ids.sort(),
  );
  const other = accept(f);
  assert.throws(
    () => f.app.fulfillment.shortPicks(f.actor, other.id, first.nextCursor!),
    { code: "CURSOR" },
  );
});

test("HTTP shortage commands enforce strict payload, CSRF, exact retry and scoped history queries", async (t) => {
  const f = fixture(t),
    o = accept(f),
    a = f.app.fulfillment.picks(f.actor, o.id)[0]!,
    payload = input(f, o.id, a.id);
  const origin = "http://127.0.0.1:3000",
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
  });
  const c = login.cookies[0]!,
    headers = {
      origin,
      cookie: `${c.name}=${c.value}`,
      "x-csrf-token": login.json().csrf,
      "idempotency-key": "short-http",
    };
  const send = (p: Record<string, unknown>, h = headers) =>
    http.inject({
      method: "POST",
      url: "/api/commands/fulfillment.short-pick",
      headers: h,
      payload: p,
    });
  assert.equal((await send({ ...payload, cancelOrder: true })).statusCode, 400);
  assert.equal(
    (await send(payload, { ...headers, "x-csrf-token": "invalid" })).statusCode,
    403,
  );
  assert.equal((await send({ ...payload, unitRevision: "1" })).statusCode, 400);
  const first = await send(payload);
  assert.equal(first.statusCode, 200);
  assert.deepEqual((await send(payload)).json(), first.json());
  const read = await http.inject({
    url: `/api/orders/${o.id}/short-picks`,
    headers,
  });
  assert.equal(read.statusCode, 200);
  assert.equal(read.json().items.length, 1);
  assert.equal(
    (
      await http.inject({
        url: `/api/orders/${o.id}/short-picks?unexpected=1`,
        headers,
      })
    ).statusCode,
    400,
  );
});

test(
  "separate processes racing final serial packing and shortage leave exactly one eligible outcome",
  { timeout: 15000 },
  async (t) => {
    const f = fixture(t),
      o = accept(f),
      a = f.app.fulfillment.picks(f.actor, o.id)[0]!;
    f.app.fulfillment.pick(f.actor, "pick", {
      orderId: o.id,
      allocationId: a.id,
      serial: a.serial,
    });
    const children: ChildProcess[] = [];
    t.after(() =>
      children.forEach((c) => {
        if (c.connected) c.kill();
      }),
    );
    const works = ["pack", "short"].map((action) => {
      const child = fork(
        new URL("./short-pick-child.ts", import.meta.url),
        [],
        {
          execArgv: ["--import", "tsx"],
          stdio: ["ignore", "ignore", "pipe", "ipc"],
        },
      );
      children.push(child);
      let readyResolve: () => void,
        resultResolve: (r: { ok: boolean; code?: string }) => void;
      const ready = new Promise<void>((resolve) => {
        readyResolve = resolve;
      });
      const result = new Promise<{ ok: boolean; code?: string }>(
        (resolve, reject) => {
          resultResolve = resolve;
          let stderr = "";
          child.stderr?.on("data", (x) => {
            stderr += String(x);
          });
          child.on("error", reject);
          child.on("exit", (code) => {
            if (code !== 0)
              reject(new Error(`Short-pick child exit ${code}: ${stderr}`));
          });
        },
      );
      child.on("message", (m: any) =>
        m.ready ? readyResolve() : resultResolve(m),
      );
      child.send({
        action: "init",
        input: {
          path: f.path,
          actor: f.actor,
          action,
          payload:
            action === "short"
              ? input(f, o.id, a.id)
              : {
                  orderId: o.id,
                  revision: 1,
                  mode: "collection",
                  address: "Synthetic counter",
                  lines: [{ allocationId: a.id, quantity: 1 }],
                },
        },
      });
      return { ready, result };
    });
    await Promise.all(works.map((w) => w.ready));
    children.forEach((c) => c.send({ action: "go" }));
    const results = await Promise.all(works.map((w) => w.result));
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.ok(["PACKED", "STATE"].includes(results.find((r) => !r.ok)!.code!));
    const reports = f.app.fulfillment.shortPicks(f.actor, o.id).items,
      shipments = f.app.fulfillment.shipments(f.actor);
    assert.equal(reports.length + shipments.length, 1);
    assert.equal(f.app.inventory.trace(f.actor, "S1").unit.quantity, 1);
    assert.equal(f.app.billing.invoices(f.actor).length, 0);
    assert.equal(f.app.inventory.costs.window(f.actor, 0).closingValue, 18000);
  },
);
