import { test } from "node:test";
import assert from "node:assert/strict";
import { Application } from "../src/server/application.ts";
import { Store } from "../src/server/database.ts";
import { createHttp } from "../src/server/http.ts";
import { fork, type ChildProcess } from "node:child_process";
import { fixture } from "./fixtures.ts";

function bulk(f: ReturnType<typeof fixture>, quarantine = true) {
  const productId = f.app.catalog.create(f.actor, "split-product", {
    sku: "PARTIAL-BIN",
    name: "Synthetic partial putaway",
    serialized: false,
    unitPrice: 9999,
    taxBasisPoints: 0,
  }).id;
  const poId = f.app.procurement.create(f.actor, "split-po", {
    supplierId: f.supplier,
    warehouseId: f.w1,
    lines: [{ productId, quantity: 6, unitCost: 125 }],
  }).id;
  const lineId = String(f.app.procurement.order(f.actor, poId).lines[0]!.id);
  f.app.procurement.receive(f.actor, "split-receipt", {
    poId,
    lineId,
    quantity: 6,
    serials: [],
    deliveryRef: "PARTIAL-BIN-DELIVERY",
    bin: "RECEIVING",
    quarantine,
  });
  return f.app.inventory
    .stock(f.actor)
    .find((u) => u.product_id === productId)!;
}

for (const region of ["CA", "US"] as const) {
  test(`${region} partial bin putaway conserves original cost and receipt lineage across repeated splits and restart`, (t) => {
    const f = fixture(t, {}, region),
      u = bulk(f);
    const origin = f.app.inventory.purchaseOrigin(f.actor, u.id);
    const input = {
      unitId: u.id,
      revision: u.revision,
      sourceBin: u.bin,
      bin: "QUARANTINE-B",
      quantity: 2,
      serial: null,
      reason: "Synthetic two-unit putaway",
    };
    const result = f.app.inventory.relocate(f.actor, "split-move", input);
    const source = f.app.inventory.unit(f.actor, u.id),
      destination = f.app.inventory.unit(f.actor, result.id);
    assert.notEqual(destination.id, source.id);
    assert.deepEqual(
      [
        source.quantity,
        source.bin,
        source.cost,
        source.condition,
        source.revision,
      ],
      [4, "RECEIVING", 125, "quarantine", u.revision + 1],
    );
    assert.deepEqual(
      [
        destination.quantity,
        destination.bin,
        destination.cost,
        destination.condition,
        destination.serial,
        destination.warehouse_id,
      ],
      [2, "QUARANTINE-B", 125, "quarantine", null, f.w1],
    );
    assert.equal(
      f.app.inventory.purchaseOrigin(f.actor, destination.id),
      origin,
    );
    assert.equal(f.app.inventory.controlTotals(f.actor).value, "18750");
    assert.equal(f.app.inventory.controlTotals(f.actor).issues.count, 0);
    assert.equal(f.app.inventory.costs.window(f.actor, 0).closingValue, 18750);
    assert.deepEqual(
      f.app.inventory.costs
        .window(f.actor, 0)
        .movements.slice(-2)
        .map((m) => [m.type, m.quantity, m.unitCost, m.valueDelta]),
      [
        ["relocation.split.out", -2, 125, 0],
        ["relocation.split.in", 2, 125, 0],
      ],
    );
    f.app.close();
    f.app = new Application(f.path, region);
    assert.deepEqual(
      f.app.inventory.relocate(f.actor, "split-move", input),
      result,
    );
    assert.equal(
      f.app.inventory
        .stock(f.actor)
        .filter((x) => x.product_id === u.product_id).length,
      2,
    );
    assert.throws(
      () => f.app.inventory.relocate(f.actor, "stale-split", input),
      { code: "REVISION" },
    );
    const next = f.app.inventory.relocate(f.actor, "split-again", {
      unitId: destination.id,
      revision: destination.revision,
      sourceBin: destination.bin,
      bin: "QUARANTINE-C",
      quantity: 1,
      serial: null,
      reason: "Synthetic second putaway",
    });
    assert.equal(f.app.inventory.purchaseOrigin(f.actor, next.id), origin);
    assert.equal(f.app.inventory.controlTotals(f.actor).value, "18750");
    assert.equal(f.app.inventory.costs.window(f.actor, 0).closingValue, 18750);
    const candidates = f.app.procurement
      .receipts(f.actor)
      .find((r) => r.id === origin)!.candidates;
    assert.deepEqual(
      candidates
        .filter((c) => c.product_id === u.product_id)
        .map((c) => c.quantity)
        .sort(),
      [1, 1, 4],
    );
  });
}

test("partial bin moves refuse invalid quantities, stale count decisions and reserved stock without effects", (t) => {
  const f = fixture(t),
    u = bulk(f, false);
  const input = {
    unitId: u.id,
    revision: u.revision,
    sourceBin: u.bin,
    bin: "B",
    quantity: 2,
    serial: null,
    reason: "Synthetic putaway",
  };
  const inventory = f.app.database.owned("inventory");
  const facts = () =>
    inventory.all("SELECT * FROM inventory_units ORDER BY rowid");
  const before = facts();
  for (const [quantity, code] of [
    [0, "VALIDATION"],
    [-1, "VALIDATION"],
    [1.5, "VALIDATION"],
    [7, "STOCK"],
    [100001, "VALIDATION"],
  ] as const) {
    assert.throws(
      () =>
        f.app.inventory.relocate(f.actor, "bad-quantity", {
          ...input,
          quantity,
        }),
      { code },
    );
    assert.deepEqual(facts(), before);
  }
  const count = f.app.inventory.startCount(f.actor, "split-count", {
    unitId: u.id,
    revision: u.revision,
    countRef: "PRE-SPLIT-COUNT",
  });
  f.app.inventory.submitCount(f.actor, "split-observation", {
    countId: count.id,
    quantity: 6,
    reason: "Synthetic physical count",
  });
  f.app.inventory.relocate(f.actor, "split-valid", input);
  assert.throws(
    () =>
      f.app.inventory.decideCount(f.actor, "split-stale-count", {
        countId: count.id,
        decision: "approve",
        reason: "Synthetic stale count",
      }),
    { code: "REVISION" },
  );
  const cart = f.app.orders.saveCart(f.actor, "split-cart", {
    accountId: f.buyer,
    warehouseId: f.w1,
    revision: 0,
    lines: [{ productId: u.product_id, quantity: 1 }],
  });
  const quote = f.app.orders.quote(f.actor, "split-quote", {
    cartId: cart.id,
    revision: cart.revision,
  });
  f.app.orders.accept(f.actor, "split-order", {
    quoteId: quote.id,
    allowBackorder: false,
  });
  const held = f.app.inventory
    .stock(f.actor)
    .find((x) => x.product_id === u.product_id && x.reserved > 0)!;
  const reservedBefore = facts();
  assert.throws(
    () =>
      f.app.inventory.relocate(f.actor, "reserved-split", {
        ...input,
        unitId: held.id,
        revision: held.revision,
        sourceBin: held.bin,
        quantity: 1,
      }),
    { code: "STATE" },
  );
  assert.deepEqual(facts(), reservedBefore);
});

test("partial split rolls back both lots and custody evidence after a late failure", (t) => {
  const f = fixture(t),
    u = bulk(f),
    inventory = f.app.database.owned("inventory");
  const facts = () =>
    [
      "inventory_units",
      "inventory_movements",
      "inventory_cost_sequences",
      "inventory_cost_clock",
    ].map((name) => inventory.all(`SELECT * FROM ${name} ORDER BY rowid`));
  const before = facts(),
    run = Store.prototype.run;
  Store.prototype.run = function (sql, ...args) {
    if (
      sql.includes("INSERT INTO platform_audit") &&
      args.includes("stock.relocated")
    )
      throw Error("Synthetic split audit failure");
    return run.call(this, sql, ...args);
  };
  const input = {
    unitId: u.id,
    revision: u.revision,
    sourceBin: u.bin,
    bin: "B",
    quantity: 2,
    serial: null,
    reason: "Synthetic putaway",
  };
  try {
    assert.throws(
      () => f.app.inventory.relocate(f.actor, "split-fault", input),
      /Synthetic split audit failure/,
    );
  } finally {
    Store.prototype.run = run;
  }
  assert.deepEqual(facts(), before);
  assert.equal(
    f.app.inventory.relocate(f.actor, "split-fault", input).quantity,
    2,
  );
});

test("HTTP partial bin move retains exact response and refuses changed payload or revoked site on retry", async (t) => {
  const f = fixture(t),
    u = bulk(f);
  const user = f.app.identity.createUser(f.actor, "split-worker", {
    email: "split@example.test",
    name: "Synthetic worker",
    role: "warehouse",
    sites: [f.w1],
    password: "long-test-only-password",
  });
  const http = await createHttp(f.app, { origin: "http://localhost" });
  t.after(() => http.close());
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin: "http://localhost" },
    payload: {
      email: "split@example.test",
      password: "long-test-only-password",
    },
  });
  assert.equal(login.statusCode, 200);
  const headers = {
    origin: "http://localhost",
    cookie: `${login.cookies[0]!.name}=${login.cookies[0]!.value}`,
    "x-csrf-token": login.json().csrf,
    "idempotency-key": "http-split",
  };
  const input = {
    unitId: u.id,
    revision: u.revision,
    sourceBin: u.bin,
    bin: "B",
    quantity: 2,
    serial: null,
    reason: "Synthetic putaway",
  };
  const send = (payload: typeof input) =>
    http.inject({
      method: "POST",
      url: "/api/commands/stock.relocate",
      headers,
      payload,
    });
  const reply = await send(input);
  assert.equal(reply.statusCode, 200, reply.body);
  assert.deepEqual((await send(input)).json(), reply.json());
  assert.equal((await send({ ...input, quantity: 3 })).statusCode, 409);
  assert.equal((await send({ ...input, quantity: 1.5 })).statusCode, 400);
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_users SET sites=? WHERE id=?",
      JSON.stringify([f.w2]),
      user.id,
    );
  const retry = await send(input);
  assert.ok([401, 403].includes(retry.statusCode), retry.body);
  assert.equal(f.app.inventory.controlTotals(f.actor).value, "18750");
});

test(
  "independent processes cannot split the same reviewed quantity twice",
  { timeout: 15000 },
  async (t) => {
    const f = fixture(t),
      u = bulk(f),
      children: ChildProcess[] = [];
    t.after(() => children.forEach((child) => child.kill()));
    const ready: Promise<void>[] = [],
      outcomes: Promise<{ ok: boolean; code?: string }>[] = [];
    for (let i = 0; i < 2; i++) {
      const child = fork(
        new URL("./bin-relocation-child.ts", import.meta.url),
        [],
        {
          execArgv: ["--import", "tsx"],
          stdio: ["ignore", "ignore", "pipe", "ipc"],
        },
      );
      children.push(child);
      let onReady!: () => void,
        onOutcome!: (value: { ok: boolean; code?: string }) => void,
        failReady!: (error: Error) => void,
        failOutcome!: (error: Error) => void;
      ready.push(
        new Promise((resolve, reject) => {
          onReady = resolve;
          failReady = reject;
        }),
      );
      outcomes.push(
        new Promise((resolve, reject) => {
          onOutcome = resolve;
          failOutcome = reject;
        }),
      );
      let received = false,
        stderr = "";
      const fail = (error: Error) => {
        failReady(error);
        failOutcome(error);
      };
      child.stderr?.on("data", (data) => {
        stderr += String(data);
      });
      child.on("error", fail);
      child.on("exit", (code) => {
        if (!received) fail(Error(`Split child exited ${code}: ${stderr}`));
      });
      child.on("message", (message: any) => {
        if (message.ready) onReady();
        else {
          received = true;
          onOutcome(message);
        }
      });
      child.send({
        action: "init",
        input: {
          path: f.path,
          actor: f.actor,
          key: `split-race-${i}`,
          dispatch: false,
          payload: {
            unitId: u.id,
            revision: u.revision,
            sourceBin: u.bin,
            bin: `B-${i}`,
            quantity: 2,
            serial: null,
            reason: "Synthetic competing putaway",
          },
        },
      });
    }
    await Promise.all(ready);
    children.forEach((child) => child.send({ action: "go" }));
    const results = await Promise.all(outcomes);
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(results.find((r) => !r.ok)!.code, "REVISION");
    assert.deepEqual(
      f.app.inventory
        .stock(f.actor)
        .filter((x) => x.product_id === u.product_id)
        .map((x) => x.quantity)
        .sort(),
      [2, 4],
    );
    assert.equal(f.app.inventory.costs.window(f.actor, 0).closingValue, 18750);
  },
);
