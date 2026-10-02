import { test } from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { Application } from "../src/server/application.ts";
import { fixture } from "./fixtures.ts";

function user(
  f: ReturnType<typeof fixture>,
  name: string,
  role: "admin" | "warehouse" = "warehouse",
) {
  const id = f.app.identity.createUser(f.actor, `user-${name}`, {
    email: `${name}@example.test`,
    name,
    role,
    sites: [f.w1],
    password: "long-test-only-password",
  }).id;
  return f.app.identity.currentActor({ ...f.actor, id });
}
function sites(f: ReturnType<typeof fixture>, id: string, values: string[]) {
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET sites=? WHERE id=?", JSON.stringify(values), id);
}
function bulk(f: ReturnType<typeof fixture>) {
  const product = f.app.catalog.create(f.actor, "count-bulk", {
    sku: "COUNT-1",
    name: "Synthetic counted supplies",
    serialized: false,
    unitPrice: 2500,
    taxBasisPoints: 1300,
  }).id;
  const po = f.app.procurement.create(f.actor, "count-po", {
    supplierId: f.supplier,
    warehouseId: f.w1,
    lines: [{ productId: product, quantity: 6, unitCost: 1000 }],
  }).id;
  f.app.procurement.receive(f.actor, "count-stock", {
    poId: po,
    lineId: String(
      f.app.procurement.orders(f.actor).find((p) => p.id === po)!.lines[0]!.id,
    ),
    quantity: 6,
    serials: [],
    deliveryRef: "COUNT-STOCK",
    bin: "C-1",
    quarantine: false,
  });
  return f.app.inventory.stock(f.actor).find((u) => u.product_id === product)!;
}
function submitted(
  f: ReturnType<typeof fixture>,
  unitId: string,
  quantity: number,
  reference: string,
) {
  const unit = f.app.inventory.unit(f.actor, unitId);
  const c = f.app.inventory.startCount(f.actor, `start-${reference}`, {
    unitId,
    revision: unit.revision,
    countRef: reference,
  });
  f.app.inventory.submitCount(f.actor, `submit-${reference}`, {
    countId: c.id,
    quantity,
    reason: "Synthetic physical observation",
  });
  return {
    countId: c.id,
    decision: "approve" as const,
    reason: "Synthetic supervisor review",
  };
}
function countMovements(f: ReturnType<typeof fixture>, unitId: string) {
  return f.app.database
    .owned("inventory")
    .all<{ quantity: number; unit_cost: number; reference: string }>(
      "SELECT quantity,unit_cost,reference FROM inventory_movements WHERE unit_id=? AND type='count'",
      unitId,
    );
}

test("saved bulk counts preserve original cost/condition, operator evidence and single approved corrections through restart and lost-response retries", (t) => {
  const f = fixture(t),
    unit = bulk(f);
  f.app.inventory.inspect(f.actor, "quarantine", {
    unitId: unit.id,
    revision: unit.revision,
    condition: "quarantine",
    reason: "Synthetic quarantine",
  });
  const current = f.app.inventory.unit(f.actor, unit.id);
  const operator = user(f, "counter");
  const input = {
    unitId: unit.id,
    revision: current.revision,
    countRef: "COUNT-UP",
  };
  const started = f.app.inventory.startCount(operator, "start", input);
  assert.deepEqual(
    f.app.inventory.startCount(operator, "start-other", {
      ...input,
      countRef: " COUNT-UP ",
    }),
    started,
  );
  assert.throws(
    () =>
      f.app.inventory.startCount(operator, "start-conflict", {
        ...input,
        revision: current.revision + 1,
      }),
    { code: "RECEIPT_CONFLICT" },
  );
  assert.throws(
    () =>
      f.app.inventory.decideCount(f.actor, "early", {
        countId: started.id,
        decision: "approve",
        reason: "No observation",
      }),
    { code: "STATE" },
  );
  const observation = {
    countId: started.id,
    quantity: 8,
    reason: "Two additional cartons confirmed in the bin",
  };
  const observed = f.app.inventory.submitCount(
    operator,
    "observe",
    observation,
  );
  assert.equal(f.app.inventory.unit(f.actor, unit.id).quantity, 6);
  assert.deepEqual(
    f.app.inventory.submitCount(operator, "observe-other", observation),
    observed,
  );
  assert.throws(
    () =>
      f.app.inventory.submitCount(operator, "observe-conflict", {
        ...observation,
        quantity: 7,
      }),
    { code: "RECEIPT_CONFLICT" },
  );
  const decision = {
    countId: started.id,
    decision: "approve" as const,
    reason: "Supervisor reviewed carton evidence",
  };
  assert.throws(
    () => f.app.inventory.decideCount(operator, "operator-approve", decision),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () =>
      f.app.inventory.adjustCount(operator, "bypass", {
        unitId: unit.id,
        revision: current.revision,
        count: 8,
        reason: "Bypass review",
      }),
    { code: "FORBIDDEN" },
  );
  const approved = f.app.inventory.decideCount(f.actor, "approve", decision);
  assert.equal(approved.adjustment!.valueDelta, 2000);
  assert.deepEqual(
    countMovements(f, unit.id).map((m) => [
      m.quantity,
      m.unit_cost,
      m.reference,
    ]),
    [[2, 1000, started.id]],
  );
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(
    f.app.inventory.decideCount(
      user(f, "other-admin", "admin"),
      "new-admin-key",
      decision,
    ),
    approved,
  );
  assert.deepEqual(
    f.app.inventory.submitCount(operator, "new-observation-key", observation),
    observed,
  );
  assert.equal(countMovements(f, unit.id).length, 1);
  assert.throws(
    () =>
      f.app.inventory.decideCount(f.actor, "change-decision", {
        ...decision,
        decision: "reject",
      }),
    { code: "RECEIPT_CONFLICT" },
  );
  assert.throws(
    () => f.app.inventory.decideCount(operator, "approve", decision),
    { code: "FORBIDDEN" },
  );
  sites(f, operator.id, [f.w2]);
  assert.throws(
    () => f.app.inventory.submitCount(operator, "observe", observation),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () =>
      f.app.inventory.decideCount(
        { ...f.actor, orgId: "foreign" },
        "foreign",
        decision,
      ),
    { code: "FORBIDDEN" },
  );
  assert.equal(f.app.inventory.counts(operator).length, 0);
  sites(f, operator.id, [f.w1]);
  const c = f.app.inventory.counts(operator)[0]!;
  assert.equal(c.expected_quantity, 6);
  assert.equal(c.observed_quantity, 8);
  assert.equal(c.condition, "quarantine");
  assert.equal(c.observed_by, operator.id);
  assert.equal(c.decided_by, f.actor.id);
  assert.equal(c.delta, 2);
  const down = submitted(f, unit.id, 5, "COUNT-DOWN");
  f.app.inventory.decideCount(f.actor, "down", down);
  const final = f.app.inventory.stock(f.actor).find((u) => u.id === unit.id)!;
  assert.equal(final.quantity, 5);
  assert.equal(final.quantity * final.cost, 5000);
  assert.equal(final.condition, "quarantine");
  assert.equal(final.available, 0);
  const movements = countMovements(f, unit.id);
  assert.equal(6 + movements.reduce((s, m) => s + m.quantity, 0), 5);
  assert.equal(
    6000 + movements.reduce((s, m) => s + m.quantity * m.unit_cost, 0),
    5000,
  );
  assert.equal(f.app.billing.invoices(f.actor).length, 0);
});

test("stale, reserved, serialized and in-transit counts reject; reviewed rejection retains evidence without physical changes", (t) => {
  const f = fixture(t),
    unit = bulk(f),
    approval = submitted(f, unit.id, 4, "STALE");
  f.app.inventory.inspect(f.actor, "inspect", {
    unitId: unit.id,
    revision: unit.revision,
    condition: "damaged",
    reason: "Physical inspection after cutoff",
  });
  assert.throws(() => f.app.inventory.decideCount(f.actor, "stale", approval), {
    code: "REVISION",
  });
  assert.equal(f.app.inventory.counts(f.actor)[0]!.state, "submitted");
  const reject = {
    ...approval,
    decision: "reject" as const,
    reason: "Stock changed after observation; recount required",
  };
  const rejected = f.app.inventory.decideCount(f.actor, "reject", reject);
  assert.equal(rejected.adjustment, null);
  assert.deepEqual(
    f.app.inventory.decideCount(f.actor, "reject-again", reject),
    rejected,
  );
  assert.equal(f.app.inventory.unit(f.actor, unit.id).quantity, 6);
  assert.equal(countMovements(f, unit.id).length, 0);
  const damaged = f.app.inventory.unit(f.actor, unit.id);
  f.app.inventory.inspect(f.actor, "usable", {
    unitId: unit.id,
    revision: damaged.revision,
    condition: "usable",
    reason: "Reinspection",
  });
  const held = submitted(f, unit.id, 1, "HELD");
  const cart = f.app.orders.saveCart(f.actor, "cart", {
    accountId: f.buyer,
    warehouseId: f.w1,
    revision: 0,
    lines: [{ productId: unit.product_id, quantity: 2 }],
  });
  const quote = f.app.orders.quote(f.actor, "quote", {
    cartId: cart.id,
    revision: cart.revision,
  });
  f.app.orders.accept(f.actor, "accept", {
    quoteId: quote.id,
    allowBackorder: false,
  });
  assert.throws(() => f.app.inventory.decideCount(f.actor, "held", held), {
    code: "ALLOCATION",
  });
  assert.equal(f.app.inventory.unit(f.actor, unit.id).quantity, 6);
  const serial = f.app.inventory.trace(f.actor, "S3").unit;
  assert.throws(
    () =>
      f.app.inventory.startCount(f.actor, "serial", {
        unitId: serial.id,
        revision: serial.revision,
        countRef: "SERIAL",
      }),
    { code: "STATE" },
  );
  const started = f.app.inventory.startCount(f.actor, "draft", {
    unitId: unit.id,
    revision: f.app.inventory.unit(f.actor, unit.id).revision,
    countRef: "UNOBSERVED",
  });
  f.app.inventory.decideCount(f.actor, "draft-reject", {
    countId: started.id,
    decision: "reject",
    reason: "Invalid count location",
  });
  assert.throws(
    () =>
      f.app.inventory.submitCount(f.actor, "late-observation", {
        countId: started.id,
        quantity: 4,
        reason: "Late observation",
      }),
    { code: "RECEIPT_CONFLICT" },
  );
  const tr = f.app.inventory.dispatchTransfer(f.actor, "dispatch", {
    unitId: unit.id,
    revision: f.app.inventory.unit(f.actor, unit.id).revision,
    quantity: 4,
    destinationId: f.w2,
    reason: "Synthetic relocation",
  });
  const transit = f.app.inventory.unit(f.actor, tr.unitId);
  assert.throws(
    () =>
      f.app.inventory.startCount(f.actor, "transit", {
        unitId: transit.id,
        revision: transit.revision,
        countRef: "TRANSIT",
      }),
    { code: "STATE" },
  );
});

type Result = { ok: boolean; code?: string; result?: unknown };
async function race(
  t: { after: (fn: () => void) => void },
  f: ReturnType<typeof fixture>,
  operations: { operation: string; payload: unknown }[],
) {
  const children: ChildProcess[] = [],
    ready: Promise<void>[] = [],
    results: Promise<Result>[] = [];
  operations.forEach((operation, i) => {
    const child = fork(new URL("./count-child.ts", import.meta.url), [], {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    children.push(child);
    let resolveReady: () => void,
      resolveResult: (r: Result) => void,
      reject: (e: Error) => void;
    ready.push(new Promise<void>((r) => (resolveReady = r)));
    results.push(
      new Promise<Result>((r, j) => {
        resolveResult = r;
        reject = j;
      }),
    );
    let stderr = "";
    child.stderr?.on("data", (c) => (stderr += String(c)));
    child.on("message", (m: any) =>
      m.ready ? resolveReady() : resolveResult(m),
    );
    child.on("error", (e) => reject(e));
    child.on("exit", (code) => {
      if (code !== 0) reject(new Error(`Count child exit ${code}: ${stderr}`));
    });
    child.send({
      action: "init",
      input: { path: f.path, actor: f.actor, key: `race-${i}`, ...operation },
    });
  });
  t.after(() => children.forEach((c) => c.kill()));
  await Promise.all(ready);
  children.forEach((c) => c.send({ action: "go" }));
  return Promise.all(results);
}

test(
  "real competing processes serialize count approval versus last-stock allocation and dispatch without over-reservation or lost custody",
  { timeout: 10000 },
  async (t) => {
    for (const operation of ["accept", "dispatch"] as const) {
      const f = fixture(t),
        unit = bulk(f),
        approval = submitted(f, unit.id, 0, `RACE-${operation}`);
      const cart = f.app.orders.saveCart(f.actor, "cart", {
        accountId: f.buyer,
        warehouseId: f.w1,
        revision: 0,
        lines: [{ productId: unit.product_id, quantity: 6 }],
      });
      const quote = f.app.orders.quote(f.actor, "quote", {
        cartId: cart.id,
        revision: cart.revision,
      });
      const payload =
        operation === "accept"
          ? { quoteId: quote.id, allowBackorder: false }
          : {
              unitId: unit.id,
              revision: unit.revision,
              quantity: 6,
              destinationId: f.w2,
              reason: "Competing dispatch",
            };
      const results = await race(t, f, [
        { operation: "approve", payload: approval },
        { operation, payload },
      ]);
      assert.equal(results.filter((r) => r.ok).length, 1);
      const counted = results[0]!.ok,
        loser = results.find((r) => !r.ok)!.code;
      assert.equal(
        loser,
        operation === "accept"
          ? counted
            ? "STOCK"
            : "ALLOCATION"
          : counted
            ? "STATE"
            : "REVISION",
      );
      const stock = f.app.inventory
        .stock(f.actor)
        .filter((u) => u.product_id === unit.product_id);
      assert.equal(
        stock.reduce((s, u) => s + u.quantity, 0),
        counted ? 0 : 6,
      );
      assert.equal(
        stock.reduce((s, u) => s + u.quantity * u.cost, 0),
        counted ? 0 : 6000,
      );
      assert.equal(
        stock.reduce((s, u) => s + u.reserved, 0),
        !counted && operation === "accept" ? 6 : 0,
      );
      assert.equal(countMovements(f, unit.id).length, counted ? 1 : 0);
      if (operation === "dispatch")
        assert.equal(
          f.app.inventory.transfers(f.actor).length,
          counted ? 0 : 1,
        );
    }
  },
);

test(
  "real competing approvals either replay one count or invalidate a second cutoff; stock movement applies once",
  { timeout: 10000 },
  async (t) => {
    for (const same of [true, false]) {
      const f = fixture(t),
        unit = bulk(f),
        a = submitted(f, unit.id, 4, "FIRST"),
        b = same ? a : submitted(f, unit.id, 3, "SECOND");
      const results = await race(t, f, [
        { operation: "approve", payload: a },
        { operation: "approve", payload: b },
      ]);
      assert.equal(results.filter((r) => r.ok).length, same ? 2 : 1);
      if (same) assert.deepEqual(results[0]!.result, results[1]!.result);
      else assert.equal(results.find((r) => !r.ok)!.code, "REVISION");
      const movements = countMovements(f, unit.id),
        final = f.app.inventory.unit(f.actor, unit.id);
      assert.equal(movements.length, 1);
      assert.equal(6 + movements[0]!.quantity, final.quantity);
      assert.equal(
        6000 + movements[0]!.quantity * movements[0]!.unit_cost,
        final.quantity * final.cost,
      );
    }
  },
);

test("count history and retries retain the original site scope after the counted lot moves; revoked original grants deny cached results", (t) => {
  const f = fixture(t),
    unit = bulk(f),
    operator = user(f, "original-counter");
  const input = {
    unitId: unit.id,
    revision: unit.revision,
    countRef: "BEFORE-MOVE",
  };
  const started = f.app.inventory.startCount(operator, "start", input);
  const observation = {
    countId: started.id,
    quantity: 6,
    reason: "Original site verification",
  };
  const result = f.app.inventory.submitCount(operator, "submit", observation);
  f.app.inventory.decideCount(f.actor, "approve", {
    countId: started.id,
    decision: "approve",
    reason: "Verified no correction",
  });
  const current = f.app.inventory.unit(f.actor, unit.id);
  const transfer = f.app.inventory.dispatchTransfer(f.actor, "dispatch", {
    unitId: unit.id,
    revision: current.revision,
    quantity: 6,
    destinationId: f.w2,
    reason: "Move after count",
  });
  f.app.inventory.receiveTransfer(f.actor, "receive", {
    transferId: transfer.id,
    lineId: transfer.lineId,
    quantity: 6,
    serial: null,
    receiptRef: "MOVED",
    bin: "B-1",
    condition: "usable",
    reason: "Destination arrival",
  });
  assert.equal(f.app.inventory.unit(f.actor, unit.id).warehouse_id, f.w2);
  assert.deepEqual(
    f.app.inventory.startCount(operator, "start", input),
    started,
  );
  assert.deepEqual(
    f.app.inventory.startCount(operator, "new-start-key", input),
    started,
  );
  assert.deepEqual(
    f.app.inventory.submitCount(operator, "submit", observation),
    result,
  );
  assert.equal(f.app.inventory.counts(operator)[0]!.warehouse_id, f.w1);
  sites(f, operator.id, [f.w2]);
  const revoked = operator;
  for (const key of ["start", "fresh-key"])
    assert.throws(() => f.app.inventory.startCount(revoked, key, input), {
      code: "FORBIDDEN",
    });
  assert.throws(
    () => f.app.inventory.submitCount(revoked, "submit", observation),
    { code: "FORBIDDEN" },
  );
  assert.equal(f.app.inventory.counts(revoked).length, 0);
});
