import { test } from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { Application } from "../src/server/application.ts";
import { Store } from "../src/server/database.ts";
import { createHttp } from "../src/server/http.ts";
import type { Actor, Role } from "../src/server/core.ts";
import { fixture } from "./fixtures.ts";

type Fixture = ReturnType<typeof fixture>;
type Input = Parameters<Application["inventory"]["relocate"]>[2];
function payload(f: Fixture, serial = "S1"): Input {
  const u = f.app.inventory.trace(f.actor, serial).unit;
  return {
    unitId: u.id,
    revision: u.revision,
    sourceBin: u.bin,
    bin: "RACK-B-2",
    serial,
    reason: "Synthetic verified putaway",
  };
}
function user(
  f: Fixture,
  role: Role = "warehouse",
  sites = [f.w1],
  name = role as string,
) {
  const row = f.app.identity.createUser(f.actor, `move-${name}`, {
    email: `move-${name}@example.test`,
    name: role,
    role,
    sites,
    password: "long-test-only-password",
    ...(role === "buyer" ? { accountId: f.buyer } : {}),
  });
  return f.app.identity.currentActor({ ...f.actor, id: row.id });
}
function facts(f: Fixture) {
  return (
    ["inventory", "platform", "procurement", "billing", "orders"] as const
  ).flatMap((module) => {
    const store = f.app.database.owned(module);
    return store
      .all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE ? ORDER BY name",
        `${module}_%`,
      )
      .map((row) => [
        row.name,
        store.all(`SELECT * FROM ${row.name} ORDER BY rowid`),
      ]);
  });
}
function rejected(
  f: Fixture,
  actor: Actor,
  input: Input,
  code: string,
  key = "refused",
) {
  const before = facts(f);
  assert.throws(() => f.app.inventory.relocate(actor, key, input), { code });
  assert.deepEqual(facts(f), before);
}
for (const region of ["CA", "US"] as const)
  test(`${region} bin relocation conserves serial, original cost and purchase lineage across restart/replay`, (t) => {
    const f = fixture(t, {}, region),
      actor = user(f),
      input = payload(f),
      u = f.app.inventory.unit(f.actor, input.unitId),
      origin = f.app.inventory.purchaseOrigin(f.actor, u.id),
      controls = f.app.inventory.controlTotals(f.actor),
      result = f.app.inventory.relocate(actor, "move", input);
    assert.deepEqual(
      { ...f.app.inventory.unit(f.actor, u.id) },
      {
        ...u,
        bin: input.bin,
        revision: u.revision + 1,
      },
    );
    assert.equal(f.app.inventory.purchaseOrigin(f.actor, u.id), origin);
    assert.deepEqual(f.app.inventory.controlTotals(f.actor), {
      ...controls,
      movements: controls.movements + 1,
    });
    const trace = f.app.inventory.trace(f.actor, "S1"),
      last = trace.movements.at(-1)!;
    assert.equal(last.type, "relocation");
    assert.equal(last.quantity, 0);
    assert.equal(last.unit_cost, 6000);
    assert.equal(last.reference, result.relocationId);
    assert.equal(last.reason, '"A-1" → "RACK-B-2": Synthetic verified putaway');
    const audit = f.app.database
      .owned("platform")
      .get<{ detail: string }>(
        "SELECT detail FROM platform_audit WHERE action='stock.relocated' AND reference=?",
        result.relocationId,
      )!;
    assert.deepEqual(JSON.parse(audit.detail), {
      ...result,
      beforeRevision: u.revision,
      reason: input.reason,
    });
    const cost = f.app.inventory.costs.window(f.actor, 0);
    assert.equal(cost.closingValue, 18000);
    assert.equal(cost.movements.at(-1)!.valueDelta, 0);
    const before = facts(f);
    assert.deepEqual(f.app.inventory.relocate(actor, "move", input), result);
    assert.deepEqual(facts(f), before);
    rejected(
      f,
      actor,
      { ...input, bin: "OTHER" },
      "IDEMPOTENCY_CONFLICT",
      "move",
    );
    rejected(f, actor, input, "REVISION", "new-key");
    f.app.close();
    f.app = new Application(f.path, region);
    assert.deepEqual(f.app.inventory.relocate(actor, "move", input), result);
    assert.deepEqual(facts(f), before);
    assert.equal(
      f.app.procurement
        .receipts(f.actor)
        .find((r) => r.id === origin)!
        .candidates.find((c) => c.id === u.id)!.bin,
      input.bin,
    );
  });

test("bulk and quarantined lots move as intact identities; counts become stale and unavailable stock stays unavailable", (t) => {
  const f = fixture(t),
    productId = f.app.catalog.create(f.actor, "bulk", {
      sku: "MOVE-BULK",
      name: "Synthetic bulk",
      serialized: false,
      unitPrice: 500,
      taxBasisPoints: 0,
    }).id,
    poId = f.app.procurement.create(f.actor, "bulk-po", {
      supplierId: f.supplier,
      warehouseId: f.w1,
      lines: [{ productId, quantity: 6, unitCost: 125 }],
    }).id,
    lineId = String(f.app.procurement.order(f.actor, poId).lines[0]!.id);
  f.app.procurement.receive(f.actor, "bulk-receive", {
    poId,
    lineId,
    quantity: 6,
    serials: [],
    deliveryRef: "MOVE-BULK",
    bin: "RECEIVING",
    quarantine: true,
  });
  const u = f.app.inventory
      .stock(f.actor)
      .find((row) => row.product_id === productId)!,
    count = f.app.inventory.startCount(f.actor, "cutoff", {
      unitId: u.id,
      revision: u.revision,
      countRef: "MOVE-COUNT",
    });
  f.app.inventory.submitCount(f.actor, "observe", {
    countId: count.id,
    quantity: 5,
    reason: "Synthetic observation",
  });
  const result = f.app.inventory.relocate(f.actor, "bulk-move", {
    unitId: u.id,
    revision: u.revision,
    sourceBin: "RECEIVING",
    bin: " QUARANTINE-2 ",
    serial: null,
    reason: " Synthetic intact lot putaway ",
  });
  assert.equal(result.quantity, 6);
  assert.equal(result.unitCost, 125);
  assert.equal(result.bin, "QUARANTINE-2");
  assert.deepEqual(
    { ...f.app.inventory.unit(f.actor, u.id) },
    {
      id: u.id,
      org_id: u.org_id,
      product_id: productId,
      warehouse_id: f.w1,
      bin: "QUARANTINE-2",
      serial: null,
      quantity: 6,
      cost: 125,
      condition: "quarantine",
      state: "stock",
      revision: u.revision + 1,
    },
  );
  assert.equal(f.app.inventory.availability(f.actor, productId, f.w1), 0);
  const before = facts(f);
  assert.throws(
    () =>
      f.app.inventory.decideCount(f.actor, "stale", {
        countId: count.id,
        decision: "approve",
        reason: "Old bin count",
      }),
    { code: "REVISION" },
  );
  assert.deepEqual(facts(f), before);
  rejected(
    f,
    f.actor,
    {
      ...payload(f),
      unitId: u.id,
      sourceBin: result.bin,
      revision: result.revision,
    },
    "SERIAL",
  );
});

test("wrong source/serial, same bin, stale revisions and malformed evidence refuse atomically", (t) => {
  const f = fixture(t),
    input = payload(f);
  for (const [change, code] of [
    [{ sourceBin: "OTHER" }, "REVISION"],
    [{ serial: "S2" }, "SERIAL"],
    [{ serial: null }, "SERIAL"],
    [{ bin: "A-1" }, "VALIDATION"],
    [{ bin: " " }, "VALIDATION"],
    [{ reason: "" }, "VALIDATION"],
    [{ reason: "x".repeat(1001) }, "VALIDATION"],
    [{ revision: 0.5 }, "VALIDATION"],
    [{ revision: input.revision + 1 }, "REVISION"],
  ] as const)
    rejected(f, f.actor, { ...input, ...change }, code);
  f.app.inventory.dispatchTransfer(f.actor, "transit", {
    unitId: input.unitId,
    revision: input.revision,
    destinationId: f.w2,
    quantity: 1,
    reason: "Synthetic dispatch",
  });
  rejected(
    f,
    f.actor,
    {
      ...input,
      revision: f.app.inventory.unit(f.actor, input.unitId).revision,
    },
    "STATE",
  );
});

test("sales/replacement reservations and pending missing-serial evidence prevent relocation", (t) => {
  for (const replacement of [false, true]) {
    const f = fixture(t),
      input = payload(f);
    const store = f.app.database.owned("inventory");
    if (replacement)
      store.run(
        "INSERT INTO inventory_replacements VALUES(?,?,?,'reserved')",
        "test-hold",
        f.actor.orgId,
        input.unitId,
      );
    else
      store.run(
        "INSERT INTO inventory_allocations(id,org_id,order_id,product_id,warehouse_id,unit_id,quantity) VALUES(?,?,?,?,?,?,1)",
        "test-allocation",
        f.actor.orgId,
        "test-order",
        f.product,
        f.w1,
        input.unitId,
      );
    rejected(f, f.actor, input, "STATE");
  }
  const f = fixture(t),
    input = payload(f);
  f.app.inventory.inspect(f.actor, "hold", {
    unitId: input.unitId,
    revision: input.revision,
    condition: "quarantine",
    reason: "Synthetic missing-serial search",
  });
  const current = payload(f);
  f.app.inventory.reportSerialMissing(f.actor, "missing", {
    unitId: current.unitId,
    revision: current.revision,
    serial: "S1",
    reviewRef: "MISSING-MOVE",
    reason: "Synthetic missing serial",
  });
  rejected(f, f.actor, current, "STATE");
});

test("relocation refreshes principal/grants/password restrictions before new or cached responses", (t) => {
  const f = fixture(t),
    actor = user(f),
    input = payload(f);
  f.app.inventory.relocate(actor, "move", input);
  const iam = f.app.database.owned("iam");
  iam.run(
    "UPDATE iam_users SET sites=? WHERE id=?",
    JSON.stringify([f.w2]),
    actor.id,
  );
  rejected(
    f,
    { ...actor, role: "admin", sites: [f.w1] },
    input,
    "FORBIDDEN",
    "move",
  );
  iam.run(
    "UPDATE iam_users SET sites=? WHERE id=?",
    JSON.stringify([f.w1]),
    actor.id,
  );
  iam.run(
    "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
    actor.id,
  );
  rejected(f, actor, input, "PASSWORD_CHANGE_REQUIRED", "move");
  iam.run("UPDATE iam_users SET active=0 WHERE id=?", actor.id);
  assert.throws(() => f.app.inventory.relocate(actor, "move", input));
  for (const role of [
    "buyer",
    "finance",
    "commercial",
    "support",
    "warranty",
  ] as const)
    rejected(f, user(f, role), payload(f, "S2"), "FORBIDDEN");
  const hidden = user(f, "warehouse", [f.w2], "hidden-warehouse");
  rejected(f, hidden, payload(f, "S2"), "FORBIDDEN");
  rejected(f, f.actor, { ...input, unitId: "foreign-unit" }, "NOT_FOUND");
});

test("late audit failure rolls back bin, revision, cost sequence, event and command receipt", (t) => {
  const f = fixture(t),
    before = facts(f),
    input = payload(f),
    run = Store.prototype.run;
  Store.prototype.run = function (sql, ...args) {
    if (
      sql.includes("INSERT INTO platform_audit") &&
      args.includes("stock.relocated")
    )
      throw Error("Synthetic late audit failure");
    return run.call(this, sql, ...args);
  };
  try {
    assert.throws(
      () => f.app.inventory.relocate(f.actor, "move", input),
      /Synthetic late audit failure/,
    );
  } finally {
    Store.prototype.run = run;
  }
  assert.deepEqual(facts(f), before);
  assert.equal(f.app.inventory.relocate(f.actor, "move", input).bin, input.bin);
});

test("HTTP relocation requires session/origin/CSRF, exact fields and retains identical retry", async (t) => {
  const f = fixture(t),
    http = await createHttp(f.app, { origin: "http://localhost" });
  t.after(() => http.close());
  const input = payload(f),
    url = "/api/commands/stock.relocate";
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url,
        headers: { origin: "http://localhost" },
        payload: input,
      })
    ).statusCode,
    401,
  );
  const login = await http.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin: "http://localhost" },
      payload: {
        email: "admin@example.test",
        password: "long-test-only-password",
      },
    }),
    cookie = `${login.cookies[0]!.name}=${login.cookies[0]!.value}`,
    headers = {
      cookie,
      origin: "http://localhost",
      "x-csrf-token": login.json().csrf,
      "idempotency-key": "http-move",
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
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url,
        headers,
        payload: { ...input, warehouseId: f.w2 },
      })
    ).statusCode,
    400,
  );
  const reply = await http.inject({
    method: "POST",
    url,
    headers,
    payload: input,
  });
  assert.equal(reply.statusCode, 200, reply.body);
  assert.deepEqual(
    (
      await http.inject({ method: "POST", url, headers, payload: input })
    ).json(),
    reply.json(),
  );
});

type Outcome = { ok: boolean; code?: string };
test(
  "independent processes serialize competing bin moves and transfer dispatch against the same cutoff",
  { timeout: 15000 },
  async (t) => {
    for (const dispatch of [false, true]) {
      const f = fixture(t),
        input = payload(f),
        children: ChildProcess[] = [],
        ready: Promise<void>[] = [],
        results: Promise<Outcome>[] = [];
      t.after(() => children.forEach((child) => child.kill()));
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
        let resolveReady!: () => void,
          resolveResult!: (value: Outcome) => void,
          failReady!: (error: Error) => void,
          failResult!: (error: Error) => void;
        ready.push(
          new Promise((resolve, reject) => {
            resolveReady = resolve;
            failReady = reject;
          }),
        );
        results.push(
          new Promise((resolve, reject) => {
            resolveResult = resolve;
            failResult = reject;
          }),
        );
        let stderr = "",
          received = false;
        const fail = (error: Error) => {
          failReady(error);
          failResult(error);
        };
        child.stderr?.on("data", (value) => {
          stderr += String(value);
        });
        child.on("error", fail);
        child.on("exit", (code) => {
          if (!received)
            fail(Error(`Relocation child exited ${code}: ${stderr}`));
        });
        child.on("message", (message: any) => {
          if (message.ready) resolveReady();
          else {
            received = true;
            resolveResult(message);
          }
        });
        child.send({
          action: "init",
          input: {
            path: f.path,
            actor: f.actor,
            key: `race-${i}`,
            dispatch: dispatch && i === 1,
            payload:
              dispatch && i === 1
                ? {
                    unitId: input.unitId,
                    revision: input.revision,
                    destinationId: f.w2,
                    quantity: 1,
                    reason: "Synthetic competing dispatch",
                  }
                : { ...input, bin: `RACK-${i}` },
          },
        });
      }
      await Promise.all(ready);
      children.forEach((child) => child.send({ action: "go" }));
      const outcomes = await Promise.all(results);
      assert.equal(outcomes.filter((result) => result.ok).length, 1);
      assert.ok(
        ["REVISION", "STATE"].includes(
          outcomes.find((result) => !result.ok)!.code!,
        ),
      );
      const u = f.app.inventory.unit(f.actor, input.unitId);
      assert.equal(u.quantity, 1);
      assert.equal(u.cost, 6000);
      assert.equal(u.revision, input.revision + 1);
      const moves = f.app.database
        .owned("inventory")
        .all(
          "SELECT id FROM inventory_movements WHERE unit_id=? AND type='relocation'",
          u.id,
        );
      assert.equal(moves.length + f.app.inventory.transfers(f.actor).length, 1);
      assert.equal(f.app.inventory.controlTotals(f.actor).value, "18000");
    }
  },
);
