import assert from "node:assert/strict";
import { test } from "node:test";
import { Application } from "../src/server/application.ts";
import type { Role } from "../src/server/core.ts";
import { fixture, accept } from "./fixtures.ts";

type Fixture = ReturnType<typeof fixture>;
function order(f: Fixture, quantity: number, key: string) {
  const cart = f.app.orders.saveCart(f.actor, key + "-cart", {
    accountId: f.buyer,
    warehouseId: f.w1,
    revision:
      (f.app.orders.carts(f.actor).find((c) => c.account_id === f.buyer)
        ?.revision as number) ?? 0,
    lines: [{ productId: f.product, quantity }],
  });
  const quote = f.app.orders.quote(f.actor, key + "-quote", {
    cartId: cart.id,
    revision: cart.revision,
  });
  return f.app.orders.accept(f.actor, key, {
    quoteId: quote.id,
    allowBackorder: true,
  }).id;
}
function supply(f: Fixture, quantity = 6, warehouseId = f.w1) {
  const poId = f.app.procurement.create(
    f.actor,
    `supply-${quantity}-${warehouseId}`,
    {
      supplierId: f.supplier,
      warehouseId,
      lines: [{ productId: f.product, quantity, unitCost: 6000 }],
    },
  ).id;
  return {
    poId,
    purchaseLineId: String(
      f.app.procurement.orders(f.actor).find((p) => p.id === poId)!.lines[0]!
        .id,
    ),
  };
}
function request(
  f: Fixture,
  orderId: string,
  s: ReturnType<typeof supply>,
  quantity: number,
  priority = 5,
) {
  const review = f.app.orders.incomingSupply(f.actor, orderId);
  return {
    orderId,
    lineId: review.lines[0]!.lineId,
    revision: review.revision,
    ...s,
    quantity,
    priority,
    reason: "Synthetic confirmed customer priority",
  };
}
function commit(
  f: Fixture,
  orderId: string,
  s: ReturnType<typeof supply>,
  quantity: number,
  priority = 5,
) {
  return f.app.orders.commitIncoming(
    f.actor,
    `commit-${orderId}-${priority}-${quantity}`,
    request(f, orderId, s, quantity, priority),
  );
}
function receive(
  f: Fixture,
  s: ReturnType<typeof supply>,
  serials: string[],
  quarantine = false,
) {
  return f.app.procurement.receive(f.actor, `receive-${serials.join()}`, {
    poId: s.poId,
    lineId: s.purchaseLineId,
    deliveryRef: `DEL-${serials.join()}`,
    quantity: serials.length,
    serials,
    bin: "INCOMING",
    quarantine,
  });
}
function inspect(f: Fixture, serial: string, condition: "usable" | "damaged") {
  const u = f.app.inventory.stock(f.actor).find((u) => u.serial === serial)!;
  return f.app.inventory.inspect(f.actor, `inspect-${serial}-${condition}`, {
    unitId: u.id,
    revision: u.revision,
    condition,
    reason: "Synthetic goods inspection",
  });
}
function user(f: Fixture, role: Role, sites: string[] = []) {
  const email = `${role}-${sites.join()}@incoming.example.test`;
  const created = f.app.identity.createUser(f.actor, email, {
    email,
    name: role,
    password: "long-test-only-password",
    role,
    sites,
    ...(role === "buyer" ? { accountId: f.buyer } : {}),
  });
  return f.app.identity.currentActor({ ...f.actor, id: created.id });
}

test("incoming supply covers only uncovered demand and unreceived same-site capacity; replay and stale requests are safe", (t) => {
  const f = fixture(t),
    oid = order(f, 8, "one"),
    s = supply(f, 6);
  const input = request(f, oid, s, 4),
    result = f.app.orders.commitIncoming(f.actor, "commit", input);
  assert.deepEqual(
    f.app.orders.commitIncoming(f.actor, "commit", input),
    result,
  );
  assert.throws(
    () =>
      f.app.orders.commitIncoming(f.actor, "commit", { ...input, quantity: 3 }),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  assert.throws(() => f.app.orders.commitIncoming(f.actor, "stale", input), {
    code: "REVISION",
  });
  const r = f.app.orders.incomingSupply(f.actor, oid);
  assert.deepEqual(
    [
      r.lines[0]!.allocated,
      r.lines[0]!.incoming,
      r.lines[0]!.held,
      r.lines[0]!.uncovered,
    ],
    [3, 4, 0, 1],
  );
  assert.equal(
    r.candidates.find((c) => c.poId === s.poId)!.availableQuantity,
    2,
  );
  assert.equal(f.app.inventory.allocations(f.actor, oid).length, 3);
  assert.throws(() => commit(f, oid, s, 2), { code: "INCOMING_DEMAND" });
  assert.throws(() => commit(f, oid, supply(f, 2, f.w2), 1), {
    code: "INCOMING_SUPPLY",
  });
  const other = order(f, 3, "two");
  assert.throws(() => commit(f, other, s, 3), { code: "INCOMING_CAPACITY" });
  const app2 = new Application(f.path, "CA");
  try {
    app2.orders.commitIncoming(
      f.actor,
      "other-connection",
      request(f, other, s, 2),
    );
    assert.equal(
      f.app.orders
        .incomingSupply(f.actor, oid)
        .candidates.find((c) => c.poId === s.poId)!.availableQuantity,
      0,
    );
    assert.throws(() => commit(f, oid, s, 1), { code: "INCOMING_CAPACITY" });
  } finally {
    app2.close();
  }
});

test("partial arrivals obey priority and reserve the arriving units exactly once", (t) => {
  const f = fixture(t);
  accept(f, 3, "exhaust");
  const low = order(f, 3, "low"),
    high = order(f, 3, "high"),
    s = supply(f);
  commit(f, low, s, 3, 9);
  commit(f, high, s, 3, 1);
  const result = receive(f, s, ["A1", "A2"]);
  assert.deepEqual(receive(f, s, ["A1", "A2"]), result);
  assert.deepEqual(
    f.app.orders
      .incomingSupply(f.actor, high)
      .lines.map((l) => [l.allocated, l.incoming]),
    [[2, 1]],
  );
  assert.deepEqual(
    f.app.orders
      .incomingSupply(f.actor, low)
      .lines.map((l) => [l.allocated, l.incoming]),
    [[0, 3]],
  );
  assert.deepEqual(
    f.app.inventory
      .allocations(f.actor, high)
      .map((a) => f.app.inventory.unit(f.actor, a.unit_id).serial)
      .sort(),
    ["A1", "A2"],
  );
  receive(f, s, ["A3", "A4"]);
  assert.equal(
    f.app.orders.incomingSupply(f.actor, high).lines[0]!.allocated,
    3,
  );
  assert.equal(
    f.app.orders.incomingSupply(f.actor, low).lines[0]!.allocated,
    1,
  );
  f.app.orders.allocate(f.actor, "physical-allocation", {
    orderId: low,
    revision: f.app.orders.order(f.actor, low).revision,
  });
  assert.equal(f.app.orders.incomingSupply(f.actor, low).lines[0]!.incoming, 2);
});

test("quarantine retains exclusive holds, inspection converts usable stock and failure exposes a shortage", (t) => {
  const f = fixture(t);
  accept(f, 3, "exhaust");
  const oid = order(f, 3, "held"),
    s = supply(f, 3);
  commit(f, oid, s, 3);
  receive(f, s, ["H1", "H2", "H3"], true);
  let r = f.app.orders.incomingSupply(f.actor, oid);
  assert.deepEqual(
    [
      r.lines[0]!.allocated,
      r.lines[0]!.held,
      r.lines[0]!.incoming,
      r.lines[0]!.uncovered,
    ],
    [0, 3, 0, 0],
  );
  assert.equal(f.app.inventory.allocations(f.actor, oid).length, 0);
  assert.equal(
    f.app.inventory.stock(f.actor).find((u) => u.serial === "H1")!.reserved,
    1,
  );
  const competitor = order(f, 2, "competitor");
  assert.equal(f.app.orders.lines(f.actor, competitor)[0]!.allocated, 0);
  inspect(f, "H1", "usable");
  inspect(f, "H2", "damaged");
  r = f.app.orders.incomingSupply(f.actor, oid);
  assert.deepEqual(
    [r.lines[0]!.allocated, r.lines[0]!.held, r.lines[0]!.uncovered],
    [1, 1, 1],
  );
  assert.deepEqual(
    [r.commitments[0]!.convertedQuantity, r.commitments[0]!.releasedQuantity],
    [1, 1],
  );
  const c = r.commitments[0]!;
  f.app.orders.releaseIncoming(f.actor, "release-held", {
    orderId: oid,
    commitmentId: c.id,
    revision: r.revision,
    quantity: 1,
    reason: "Customer releases held stock",
  });
  inspect(f, "H3", "usable");
  f.app.orders.allocate(f.actor, "competitor-allocate", {
    orderId: competitor,
    revision: f.app.orders.order(f.actor, competitor).revision,
  });
  assert.equal(f.app.orders.lines(f.actor, competitor)[0]!.allocated, 1);
});

test("credit hold retains even usable arrivals until commercial reconciliation", (t) => {
  const f = fixture(t);
  accept(f, 3, "exhaust");
  const oid = order(f, 2, "credit"),
    s = supply(f, 2);
  commit(f, oid, s, 2);
  f.app.identity.setHold(f.actor, "hold", {
    accountId: f.buyer,
    held: true,
    reason: "Synthetic review",
  });
  receive(f, s, ["C1", "C2"]);
  let r = f.app.orders.incomingSupply(f.actor, oid);
  assert.equal(r.lines[0]!.held, 2);
  assert.equal(r.lines[0]!.allocated, 0);
  f.app.identity.setHold(f.actor, "unhold", {
    accountId: f.buyer,
    held: false,
    reason: "Synthetic cleared review",
  });
  f.app.orders.reconcileIncoming(f.actor, "reconcile", {
    orderId: oid,
    revision: r.revision,
    reason: "Account review cleared",
  });
  r = f.app.orders.incomingSupply(f.actor, oid);
  assert.equal(r.lines[0]!.held, 0);
  assert.equal(r.lines[0]!.allocated, 2);
});

test("reduction and cancellation release pending and held commitments without over-covering demand", (t) => {
  const f = fixture(t);
  accept(f, 3, "exhaust");
  const oid = order(f, 6, "amend"),
    s = supply(f, 6);
  commit(f, oid, s, 3, 1);
  commit(f, oid, s, 3, 9);
  receive(f, s, ["R1", "R2"], true);
  let r = f.app.orders.incomingSupply(f.actor, oid);
  f.app.orders.amend(f.actor, "reduce", {
    orderId: oid,
    lineId: r.lines[0]!.lineId,
    revision: r.revision,
    quantity: 2,
    allowBackorder: true,
    reason: "Customer reduces demand",
  });
  r = f.app.orders.incomingSupply(f.actor, oid);
  assert.equal(r.lines[0]!.held, 2);
  assert.equal(r.lines[0]!.incoming, 0);
  assert.equal(r.lines[0]!.uncovered, 0);
  assert.equal(
    r.commitments.find((c) => c.priority === 9)!.releasedQuantity,
    3,
  );
  assert.equal(r.candidates[0]!.availableQuantity, 4);
  f.app.orders.cancel(f.actor, "cancel", {
    orderId: oid,
    lineId: r.lines[0]!.lineId,
    revision: r.revision,
    quantity: 2,
    reason: "Customer cancels remainder",
  });
  r = f.app.orders.incomingSupply(f.actor, oid);
  assert.equal(r.state, "closed");
  assert.equal(r.lines[0]!.held, 0);
  assert.equal(r.lines[0]!.uncovered, 0);
  assert.equal(
    f.app.inventory.stock(f.actor).find((u) => u.serial === "R1")!.reserved,
    0,
  );
});

test("fresh role and site/account scopes apply to reads, commands and cached receipts", (t) => {
  const f = fixture(t),
    oid = order(f, 5, "scope"),
    s = supply(f, 2),
    buyer = user(f, "buyer"),
    warehouse = user(f, "warehouse", [f.w1]),
    wrongSite = user(f, "warehouse", [f.w2]),
    commercial = user(f, "commercial");
  assert.equal(f.app.orders.incomingSupply(buyer, oid).candidates.length, 0);
  assert.equal(
    f.app.orders.incomingSupply(warehouse, oid).candidates.length,
    0,
  );
  assert.throws(() => f.app.orders.incomingSupply(wrongSite, oid), {
    code: "FORBIDDEN",
  });
  const input = request(f, oid, s, 2);
  assert.throws(
    () => f.app.orders.commitIncoming(buyer, "buyer-commit", input),
    { code: "FORBIDDEN" },
  );
  f.app.orders.commitIncoming(commercial, "commercial-commit", input);
  const row = f.app.identity
    .users(f.actor)
    .find((u) => u.id === commercial.id)!;
  f.app.identity.updateUser(f.actor, "revoke", {
    userId: commercial.id,
    revision: row.revision,
    email: row.email,
    name: row.name,
    role: "warehouse",
    sites: [f.w1],
    active: true,
    currentPassword: "long-test-only-password",
    reason: "Synthetic role change",
  });
  assert.throws(
    () => f.app.orders.commitIncoming(commercial, "commercial-commit", input),
    { code: "FORBIDDEN" },
  );
});

test(
  "two processes cannot overbook the same PO capacity for different orders",
  { timeout: 15000 },
  async (t) => {
    const f = fixture(t);
    accept(f, 3, "exhaust");
    const orders = [order(f, 2, "race1"), order(f, 2, "race2")],
      s = supply(f, 2);
    const { fork } = await import("node:child_process");
    const children = orders.map(() =>
      fork(new URL("./incoming-supply-child.ts", import.meta.url), [], {
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      }),
    );
    t.after(() => children.forEach((c) => c.kill()));
    const ready: Promise<void>[] = [],
      outcomes: Promise<{ ok: boolean; code?: string }>[] = [],
      exits: Promise<void>[] = [];
    children.forEach((child, i) => {
      let signal!: () => void,
        resolve!: (value: any) => void,
        reject!: (reason: Error) => void;
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
              const error = new Error(`Child exited ${code}: ${stderr}`);
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
        key: `race-${i}`,
        input: request(f, orders[i]!, s, 2),
      });
    });
    await Promise.all(ready);
    children.forEach((c) => c.send({ action: "go" }));
    const results = await Promise.all(outcomes);
    await Promise.all(exits);
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(results.find((r) => !r.ok)!.code, "INCOMING_CAPACITY");
    assert.equal(
      orders.reduce(
        (sum, id) =>
          sum + f.app.orders.incomingSupply(f.actor, id).lines[0]!.incoming,
        0,
      ),
      2,
    );
  },
);

test("bulk receipts split held quantities across FIFO customers and warehouse inspection converts them atomically", (t) => {
  const f = fixture(t);
  f.product = f.app.catalog.create(f.actor, "bulk", {
    sku: "BULK",
    name: "Synthetic bulk goods",
    serialized: false,
    unitPrice: 100,
    taxBasisPoints: 0,
  }).id;
  const first = order(f, 4, "bulk-first"),
    second = order(f, 4, "bulk-second"),
    s = supply(f, 8);
  commit(f, first, s, 4);
  commit(f, second, s, 4);
  const warehouse = user(f, "warehouse", [f.w1]);
  const receipt = f.app.procurement.receive(warehouse, "bulk-receive", {
    poId: s.poId,
    lineId: s.purchaseLineId,
    deliveryRef: "BULK-1",
    quantity: 6,
    serials: [],
    bin: "BULK",
    quarantine: true,
  });
  assert.equal(f.app.orders.incomingSupply(f.actor, first).lines[0]!.held, 4);
  assert.equal(f.app.orders.incomingSupply(f.actor, second).lines[0]!.held, 2);
  const u = f.app.inventory.unit(f.actor, receipt.unitIds[0]!);
  assert.throws(
    () =>
      f.app.inventory.adjustCount(f.actor, "consume-hold", {
        unitId: u.id,
        revision: u.revision,
        count: 5,
        reason: "Synthetic count",
      }),
    { code: "ALLOCATION" },
  );
  f.app.inventory.inspect(warehouse, "bulk-inspect", {
    unitId: u.id,
    revision: u.revision,
    condition: "usable",
    reason: "Approved bulk delivery",
  });
  assert.equal(
    f.app.orders.incomingSupply(f.actor, first).lines[0]!.allocated,
    4,
  );
  assert.equal(
    f.app.orders.incomingSupply(f.actor, second).lines[0]!.allocated,
    2,
  );
  assert.equal(
    f.app.inventory.stock(f.actor).find((row) => row.id === u.id)!.available,
    0,
  );
});

test("overdue orders retain arriving stock without pick authority; renewal and reconcile make it reservable", (t) => {
  const f = fixture(t);
  accept(f, 3, "exhaust");
  const oid = order(f, 2, "overdue"),
    s = supply(f, 2);
  commit(f, oid, s, 2);
  f.app.database
    .owned("orders")
    .run(
      "INSERT INTO orders_reservation_deadlines VALUES(?,?,?)",
      f.actor.orgId,
      oid,
      Date.now() - 1000,
    );
  receive(f, s, ["D1", "D2"]);
  let r = f.app.orders.incomingSupply(f.actor, oid);
  assert.equal(r.lines[0]!.held, 2);
  assert.equal(r.lines[0]!.allocated, 0);
  f.app.orders.reservationDeadline(f.actor, "renew", {
    orderId: oid,
    revision: r.revision,
    expiresAt: null,
    reason: "Commercial renews incoming supply promise",
  });
  r = f.app.orders.incomingSupply(f.actor, oid);
  f.app.orders.reconcileIncoming(f.actor, "renew-reconcile", {
    orderId: oid,
    revision: r.revision,
    reason: "Deadline reviewed",
  });
  assert.equal(
    f.app.orders.incomingSupply(f.actor, oid).lines[0]!.allocated,
    2,
  );
});

test("supplier return cannot consume a hold; buyer cancellation releases it and stock remains unpickable until inspection", (t) => {
  const f = fixture(t);
  accept(f, 3, "exhaust");
  const oid = order(f, 1, "return"),
    s = supply(f, 1);
  commit(f, oid, s, 1);
  const receipt = receive(f, s, ["RT1"], true),
    u = f.app.inventory.unit(f.actor, receipt.unitIds[0]!);
  const input = {
    receiptId: receipt.id,
    unitId: u.id,
    revision: u.revision,
    quantity: 1,
    serial: u.serial,
    returnRef: "RET-1",
    reason: "Damaged packing",
    handoverEvidence: "Synthetic carrier receipt",
  };
  assert.throws(
    () => f.app.procurement.returnStock(f.actor, "return-held", input),
    { code: "STOCK" },
  );
  const r = f.app.orders.incomingSupply(f.actor, oid),
    buyer = user(f, "buyer");
  f.app.orders.cancel(buyer, "buyer-cancel", {
    orderId: oid,
    lineId: r.lines[0]!.lineId,
    revision: r.revision,
    quantity: 1,
    reason: "Customer no longer needs the item",
  });
  assert.equal(
    f.app.inventory.stock(f.actor).find((row) => row.id === u.id)!.available,
    0,
  );
  f.app.procurement.returnStock(f.actor, "return-released", input);
  assert.equal(f.app.inventory.unit(f.actor, u.id).quantity, 0);
  assert.equal(
    f.app.orders.incomingSupply(f.actor, oid).commitments[0]!.releasedQuantity,
    1,
  );
});

test("late receipt audit failure rolls purchase, stock, incoming history and reservations back together", (t) => {
  const f = fixture(t);
  accept(f, 3, "exhaust");
  const oid = order(f, 2, "rollback"),
    s = supply(f, 2);
  commit(f, oid, s, 2);
  const facts = () => ({
    review: f.app.orders.incomingSupply(f.actor, oid),
    stock: f.app.inventory.stock(f.actor),
    receipts: f.app.procurement.receipts(f.actor),
    allocations: f.app.inventory.allocations(f.actor, oid),
    history: f.app.database
      .owned("orders")
      .all("SELECT * FROM orders_incoming_history"),
    events: f.app.platform.events(f.actor),
    commands: f.app.database
      .owned("platform")
      .all("SELECT * FROM platform_commands"),
  });
  const before = facts(),
    platform = f.app.database.owned("platform");
  platform.migrate(
    "CREATE TRIGGER platform_incoming_fault BEFORE INSERT ON platform_audit WHEN new.action='purchase.receive' BEGIN SELECT RAISE(ABORT,'synthetic late incoming failure'); END;",
  );
  assert.throws(
    () => receive(f, s, ["F1", "F2"]),
    /synthetic late incoming failure/,
  );
  assert.deepEqual(facts(), before);
  platform.migrate("DROP TRIGGER platform_incoming_fault");
  receive(f, s, ["F1", "F2"]);
  assert.equal(
    f.app.orders.incomingSupply(f.actor, oid).lines[0]!.allocated,
    2,
  );
});
