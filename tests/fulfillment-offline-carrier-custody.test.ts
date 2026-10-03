import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { accept, fixture } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { Store, type Owner } from "../src/server/database.ts";
import type { Actor, Role } from "../src/server/core.ts";
import { createBackup, restoreBackup } from "../src/server/recovery.ts";

function setup(
  t: TestContext,
  region: "CA" | "US" = "CA",
  currency: "CAD" | "USD" = "CAD",
) {
  const f = fixture(t, {}, region, currency),
    order = accept(f, 2);
  const picks = f.app.fulfillment.picks(f.actor, order.id);
  for (const p of picks)
    f.app.fulfillment.pick(f.actor, `pick-${p.id}`, {
      orderId: order.id,
      allocationId: p.id,
      serial: p.serial,
    });
  // Exercise native input property order as well as ordered allocation identity.
  const lines = picks.map((p) => ({ quantity: 1, allocationId: p.id }));
  const { id } = f.app.fulfillment.pack(f.actor, "custody-pack", {
    orderId: order.id,
    revision: 1,
    mode: "carrier",
    address: "Synthetic destination",
    lines,
  });
  return { ...f, shipmentId: id, lines };
}
type Fixture = ReturnType<typeof setup>;
function review(f: Fixture, actor = f.actor) {
  return f.app.database.transaction(() =>
    f.app.fulfillment.reviewPackedCarrierCustodyInTransaction(
      actor,
      f.shipmentId,
    ),
  );
}
function conserved(f: Fixture) {
  return (
    [
      [
        "fulfillment",
        [
          "shipments",
          "coverage",
          "delivery",
          "delivery_history",
          "short_picks",
        ],
      ],
      ["inventory", ["units", "allocations", "movements"]],
      ["orders", ["orders", "lines"]],
      ["billing", ["invoices", "lines"]],
      ["platform", ["commands", "audit", "events", "recovery"]],
    ] as [Owner, string[]][]
  ).flatMap(([owner, tables]) =>
    tables.map((table) =>
      f.app.database
        .owned(owner)
        .all(`SELECT * FROM ${owner}_${table} ORDER BY rowid`),
    ),
  );
}
function user(f: Fixture, role: Role = "warehouse") {
  const { id } = f.app.identity.createUser(f.actor, `custody-${role}`, {
    name: "Synthetic custodian",
    email: `${role}@example.test`,
    password: "synthetic-custody-password",
    role,
    sites: [f.w1],
  });
  return f.app.identity.currentActor({ ...f.actor, id });
}
function edit(f: Fixture, field: string, value: string | null) {
  f.app.database
    .owned("fulfillment")
    .run(
      `UPDATE fulfillment_shipments SET ${field}=? WHERE id=?`,
      value,
      f.shipmentId,
    );
}
function withRollback(f: Fixture, action: () => void) {
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        action();
        throw new Error("fixture rollback");
      }),
    /fixture rollback/,
  );
}
function direct(f: Fixture, actor: Actor = f.actor) {
  return f.app.fulfillment.reviewPackedCarrierCustodyInTransaction(
    actor,
    f.shipmentId,
  );
}
function canonicalExpected(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonicalExpected).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonicalExpected((value as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}
for (const region of ["CA", "US"] as const)
  for (const currency of ["CAD", "USD"] as const)
    test(`native packed ${region}/${currency}: exact tuple, independent digest and no writes`, (t) => {
      const f = setup(t, region, currency),
        expected = f.app.fulfillment.shipment(f.actor, f.shipmentId),
        before = conserved(f);
      const r = review(f);
      assert.deepEqual(r.shipment, expected);
      assert.deepEqual(
        r.allocations,
        f.lines.map((l) => ({
          allocationId: l.allocationId,
          quantity: l.quantity,
        })),
      );
      assert.deepEqual(r.history, {
        coverage: 0,
        delivery: 0,
        deliveryObservations: 0,
      });
      const { custodyHash, ...facts } = r;
      assert.equal(
        custodyHash,
        createHash("sha256").update(canonicalExpected(facts)).digest("hex"),
      );
      assert.deepEqual(review(f), r);
      assert.deepEqual(conserved(f), before);
    });

test("requires actual writer transaction, does not start one", (t) => {
  const f = setup(t),
    before = conserved(f);
  assert.throws(() => direct(f), { code: "TRANSACTION" });
  assert.throws(
    () =>
      f.app.database.transaction(() =>
        f.app.fulfillment.reviewPackedCarrierCustodyInTransaction(
          f.actor,
          " absent ",
        ),
      ),
    { code: "VALIDATION" },
  );
  assert.throws(
    () =>
      f.app.database.transaction(() =>
        f.app.fulfillment.reviewPackedCarrierCustodyInTransaction(
          f.actor,
          "absent",
        ),
      ),
    { code: "NOT_FOUND" },
  );
  assert.deepEqual(conserved(f), before);
});

test("fresh native warehouse authority defeats forged cached role, site, org and inactive user", (t) => {
  const f = setup(t),
    actor = user(f),
    iam = f.app.database.owned("iam");
  assert.equal(review(f, actor).shipment.id, f.shipmentId);
  for (const [column, value] of [
    ["role", "finance"],
    ["sites", JSON.stringify([f.w2])],
    ["active", 0],
  ] as const) {
    withRollback(f, () => {
      iam.run(`UPDATE iam_users SET ${column}=? WHERE id=?`, value, actor.id);
      assert.throws(
        () => direct(f, { ...actor, role: "admin", sites: [f.w1] }),
        { code: "FORBIDDEN" },
      );
    });
  }
  assert.throws(() => review(f, { ...actor, orgId: "other-org" }), {
    code: "FORBIDDEN",
  });
  assert.throws(() => review(f, { ...actor, id: "missing" }), {
    code: "FORBIDDEN",
  });
  withRollback(f, () => {
    iam.run(
      "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
      actor.id,
    );
    assert.throws(() => direct(f, actor), { code: "PASSWORD_CHANGE_REQUIRED" });
  });
  withRollback(f, () => {
    edit(f, "org_id", "foreign");
    assert.throws(() => direct(f), { code: "NOT_FOUND" });
  });
  assert.equal(review(f, actor).shipment.id, f.shipmentId);
});

test("every lower staff role is refused and admin uses native site override", (t) => {
  const f = setup(t);
  for (const role of ["commercial", "finance", "warranty", "support"] as const)
    assert.throws(() => review(f, user(f, role)), { code: "FORBIDDEN" });
  assert.equal(review(f, { ...f.actor, sites: [] }).shipment.id, f.shipmentId);
});

test("deep immutable detached facts retain exact bytes through persisted change and rollback", (t) => {
  const f = setup(t),
    r = review(f),
    before = conserved(f);
  for (const value of [
    r,
    r.shipment,
    r.allocations,
    ...r.allocations,
    r.history,
  ])
    assert(Object.isFrozen(value));
  assert.throws(() => {
    (r.shipment as { address: string }).address = "mutated";
  }, TypeError);
  assert.throws(() => {
    (r.allocations[0] as { quantity: number }).quantity = 9;
  }, TypeError);
  assert.throws(() => {
    (r.allocations as unknown[]).push({});
  }, TypeError);
  const ordinary = f.app.fulfillment.shipment(f.actor, f.shipmentId);
  ordinary.address = "caller mutation";
  f.lines[0]!.quantity = 999;
  assert.deepEqual(review(f), r);
  withRollback(f, () => {
    edit(f, "address", "Changed persisted destination");
    assert.notEqual(direct(f).custodyHash, r.custodyHash);
    assert.equal(r.shipment.address, "Synthetic destination");
  });
  assert.deepEqual(review(f), r);
  assert.deepEqual(conserved(f), before);
});

test("current changed site and all handover artifacts refuse without rewriting", (t) => {
  const f = setup(t),
    actor = user(f);
  withRollback(f, () => {
    edit(f, "warehouse_id", f.w2);
    assert.throws(() => direct(f, actor), { code: "FORBIDDEN" });
  });
  for (const [column, value] of [
    ["state", "shipped"],
    ["state", "void"],
    ["mode", "collection"],
    ["tracking", ""],
    ["carrier", "canada-post"],
    ["invoice_id", "copied-invoice"],
    ["shipped_at", "2026-10-03T00:00:00.000Z"],
    ["units", '[{"unitId":"copied"}]'],
    ["units", "[ ]"],
    ["created_at", "2026-02-30T00:00:00.000Z"],
    ["created_at", "2026-10-03"],
    ["address", "  "],
    ["order_id", ""],
    ["account_id", " bad "],
    ["warehouse_id", "bad\0site"],
  ])
    withRollback(f, () => {
      edit(f, column!, value!);
      const before = conserved(f);
      assert.throws(() => direct(f), { code: "CUSTODY_STATE" });
      assert.deepEqual(conserved(f), before);
    });
});

test("malformed, duplicate, oversized, noncompact and coercive allocations refuse", (t) => {
  const f = setup(t),
    a = f.lines[0]!.allocationId;
  const invalid = [
    "{",
    "null",
    "{}",
    "[]",
    "[null]",
    "[[]]",
    "[1]",
    '[{"allocationId":"x","quantity":1,"extra":true}]',
    JSON.stringify([
      { allocationId: a, quantity: 1 },
      { allocationId: a, quantity: 1 },
    ]),
    ...[0, -1, 1.5, 100001, Number.MAX_SAFE_INTEGER + 1, "1", null, {}].map(
      (quantity) => JSON.stringify([{ allocationId: a, quantity }]),
    ),
    JSON.stringify(
      Array.from({ length: 101 }, (_, i) => ({
        allocationId: `a${i}`,
        quantity: 1,
      })),
    ),
    '[{"allocationId":"x","quantity":1,"quantity":2}]',
    '[{"allocationId":"x","quantity":1e0}]',
    ' [{"allocationId":"x","quantity":1}]',
    '[{"allocationId":"","quantity":1}]',
    '[{"allocationId":"x","quantity":1,"__proto__":{}}]',
    JSON.stringify([{ allocationId: "x".repeat(161), quantity: 1 }]),
  ];
  for (const lines of invalid)
    withRollback(f, () => {
      edit(f, "lines", lines);
      assert.throws(() => direct(f), { code: "CUSTODY_LINES" });
    });
});

test("100 distinct positive maximum native allocation quantities remain bounded", (t) => {
  const f = setup(t);
  withRollback(f, () => {
    edit(
      f,
      "lines",
      JSON.stringify(
        Array.from({ length: 100 }, (_, i) => ({
          allocationId: `fixture-allocation-${i}`,
          quantity: 100000,
        })),
      ),
    );
    assert.equal(direct(f).allocations.length, 100);
    // Shape is native custody, not inventory allocation existence/availability.
  });
});

test("complete owning history refuses cross-org, malformed and later hidden observations", (t) => {
  const f = setup(t),
    store = f.app.database.owned("fulfillment");
  for (const org of [f.actor.orgId, "contradictory-org"]) {
    for (const kind of ["coverage", "delivery", "history"] as const)
      withRollback(f, () => {
        if (kind === "coverage")
          store.run(
            "INSERT INTO fulfillment_coverage VALUES(?,?,?)",
            f.shipmentId,
            org,
            "{malformed",
          );
        if (kind === "delivery")
          store.run(
            "INSERT INTO fulfillment_delivery VALUES(?,?,?,?,?,?)",
            "receipt",
            org,
            f.shipmentId,
            "copied",
            "bad-time",
            f.actor.id,
          );
        if (kind === "history")
          for (let i = 1; i <= 30; i++)
            store.run(
              "INSERT INTO fulfillment_delivery_history VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
              `h${i}`,
              org,
              f.shipmentId,
              i,
              "in_transit",
              `r${i}`,
              `r${i}`,
              "bad",
              "bad",
              f.actor.id,
              "bad",
              "legacy",
            );
        const before = conserved(f);
        assert.throws(() => direct(f), { code: "CUSTODY_HISTORY" });
        assert.deepEqual(conserved(f), before);
      });
  }
});

test("native handover then forged packed header cannot erase retained coverage/delivery", (t) => {
  const f = setup(t);
  f.app.fulfillment.commit(f.actor, "native-handover", {
    shipmentId: f.shipmentId,
    carrier: "Synthetic carrier",
    tracking: "SYNTHETIC",
    handoverEvidence: "Synthetic native custody",
  });
  assert.throws(() => review(f), { code: "CUSTODY_HISTORY" });
  const shipped = f.app.fulfillment.shipment(f.actor, f.shipmentId);
  f.app.fulfillment.confirmDelivery(f.actor, "delivered", {
    shipmentId: f.shipmentId,
    reference: "synthetic-delivery",
    deliveredAt: shipped.shipped_at!,
  });
  withRollback(f, () => {
    for (const [k, v] of [
      ["state", "packed"],
      ["tracking", null],
      ["carrier", null],
      ["units", "[]"],
      ["invoice_id", null],
      ["shipped_at", null],
    ] as const)
      edit(f, k, v);
    assert.throws(() => direct(f), { code: "CUSTODY_HISTORY" });
  });
});

test("native void is unsupported; unrelated shipment history is not target custody", (t) => {
  const f = setup(t),
    before = review(f),
    s = f.app.database.owned("fulfillment");
  s.run(
    "INSERT INTO fulfillment_delivery VALUES(?,?,?,?,?,?)",
    "unrelated",
    f.actor.orgId,
    "different-shipment",
    "ref",
    "bad",
    f.actor.id,
  );
  assert.deepEqual(review(f), before);
  f.app.fulfillment.void(f.actor, "void", {
    shipmentId: f.shipmentId,
    reason: "Synthetic correction",
  });
  assert.throws(() => review(f), { code: "CUSTODY_STATE" });
});

test("SQL UTF8 and aggregate preflights precede every shipment payload fetch", (t) => {
  const f = setup(t),
    original = Store.prototype.get;
  let fetched = 0;
  t.mock.method(
    Store.prototype,
    "get",
    function (
      this: Store,
      sql: string,
      ...args: Parameters<Store["get"]> extends [string, ...infer P] ? P : never
    ) {
      if (sql.startsWith("SELECT id,org_id,order_id")) fetched++;
      return original.call(this, sql, ...args);
    },
  );
  for (const column of [
    "id",
    "org_id",
    "order_id",
    "account_id",
    "warehouse_id",
    "address",
    "tracking",
    "carrier",
    "lines",
    "units",
    "invoice_id",
    "created_at",
    "shipped_at",
  ]) {
    // id/org are query anchors; changing them yields absence, not allocation.
    if (["id", "org_id"].includes(column)) continue;
    withRollback(f, () => {
      edit(
        f,
        column,
        "é".repeat(
          column === "address"
            ? 4001
            : column === "lines" || column === "units"
              ? 16385
              : 2049,
        ),
      );
      fetched = 0;
      assert.throws(() => direct(f), { code: "CUSTODY_BOUNDS" });
      assert.equal(fetched, 0, column);
    });
  }
  withRollback(f, () => {
    edit(f, "lines", "x".repeat(30000));
    edit(f, "units", "x".repeat(30000));
    fetched = 0;
    assert.throws(() => direct(f), { code: "CUSTODY_BOUNDS" });
    assert.equal(fetched, 0, "aggregate");
  });
  assert.equal(review(f).shipment.id, f.shipmentId);
  assert.equal(fetched, 1);
});

test("history payloads are never fetched even for huge malformed cross-org evidence", (t) => {
  const f = setup(t),
    originalGet = Store.prototype.get,
    originalAll = Store.prototype.all;
  f.app.database
    .owned("fulfillment")
    .run(
      "INSERT INTO fulfillment_coverage VALUES(?,?,?)",
      f.shipmentId,
      "other",
      "é".repeat(100000),
    );
  let payloads = 0;
  const inspect = (sql: string) => {
    if (
      /FROM fulfillment_(coverage|delivery)/.test(sql) &&
      !sql.includes("count(*)")
    )
      payloads++;
  };
  t.mock.method(
    Store.prototype,
    "get",
    function (
      this: Store,
      sql: string,
      ...args: Parameters<Store["get"]> extends [string, ...infer P] ? P : never
    ) {
      inspect(sql);
      return originalGet.call(this, sql, ...args);
    },
  );
  t.mock.method(
    Store.prototype,
    "all",
    function (
      this: Store,
      sql: string,
      ...args: Parameters<Store["all"]> extends [string, ...infer P] ? P : never
    ) {
      inspect(sql);
      return originalAll.call(this, sql, ...args);
    },
  );
  assert.throws(() => review(f), { code: "CUSTODY_HISTORY" });
  assert.equal(payloads, 0);
});

for (const region of ["CA", "US"] as const)
  test(`encrypted restored/reopened ${region} review preserves hold and business facts`, async (t) => {
    const f = setup(t, region, "USD"),
      original = review(f),
      key = randomBytes(32),
      archive = join(dirname(f.path), "custody.backup"),
      target = join(dirname(f.path), "restored.db");
    await createBackup(f.path, archive, region, key);
    await restoreBackup(archive, target, region, key);
    for (let i = 0; i < 2; i++) {
      const app = new Application(target, region);
      try {
        const restored = { ...f, app },
          before = conserved(restored);
        assert(app.platform.recoveryHold());
        assert.deepEqual(review(restored), original);
        assert.deepEqual(conserved(restored), before);
      } finally {
        app.close();
      }
    }
  });

test("fixed owner SQL and total_changes prove no foreign reader, command or writes", (t) => {
  const f = setup(t),
    db = f.app.database,
    store = db.owned("fulfillment");
  const forbid = () => {
    throw new Error("foreign task invoked");
  };
  t.mock.method(f.app.orders, "order", forbid);
  t.mock.method(f.app.inventory, "allocations", forbid);
  t.mock.method(f.app.billing, "invoice", forbid);
  t.mock.method(f.app.platform, "command", forbid);
  const original = Store.prototype.get,
    queries: string[] = [];
  t.mock.method(
    Store.prototype,
    "get",
    function (
      this: Store,
      sql: string,
      ...args: Parameters<Store["get"]> extends [string, ...infer P] ? P : never
    ) {
      queries.push(sql);
      return original.call(this, sql, ...args);
    },
  );
  db.transaction(() => {
    const before = store.get<{ n: number }>("SELECT total_changes() AS n")!.n;
    direct(f);
    assert.equal(
      store.get<{ n: number }>("SELECT total_changes() AS n")!.n,
      before,
    );
  });
  assert(queries.some((q) => q.includes("length(CAST(lines AS BLOB))")));
  assert(
    queries
      .filter((q) => q.includes("FROM fulfillment_"))
      .every((q) => !q.includes("SELECT *")),
  );
  assert(
    !queries.some((q) =>
      /(?:FROM|JOIN) (?:inventory|orders|billing|integration|platform)_/.test(
        q,
      ),
    ),
  );
});

test("same writer buyer demotion and persisted request changes do not reuse prior review", (t) => {
  const f = setup(t),
    actor = user(f),
    before = review(f, actor),
    iam = f.app.database.owned("iam");
  withRollback(f, () => {
    iam.run(
      "UPDATE iam_users SET role='buyer',account_id=? WHERE id=?",
      f.buyer,
      actor.id,
    );
    assert.throws(() => direct(f, { ...actor, role: "admin" }), {
      code: "FORBIDDEN",
    });
  });
  for (const [field, value] of [
    ["account_id", "other-native-account-reference"],
    ["order_id", "other-native-order-reference"],
    ["created_at", "2026-10-03T00:00:00.000Z"],
    ["lines", JSON.stringify([...f.lines].reverse())],
  ]) {
    withRollback(f, () => {
      edit(f, field!, value!);
      const changed = direct(f);
      assert.notEqual(changed.custodyHash, before.custodyHash);
      assert.equal(
        changed.shipment[field! as keyof typeof changed.shipment],
        value,
      );
    });
  }
  assert.deepEqual(review(f, actor), before);
});

test("native 2000-character Unicode address is preserved rather than silently normalized", (t) => {
  const f = setup(t);
  withRollback(f, () => {
    const address = "é".repeat(2000);
    edit(f, "address", address);
    assert.equal(direct(f).shipment.address, address);
  });
});
