import { test } from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { Application } from "../src/server/application.ts";
import type { Actor } from "../src/server/core.ts";
import { createHttp } from "../src/server/http.ts";
import { fixture, accept } from "./fixtures.ts";
type Fixture = ReturnType<typeof fixture>;
function observer(f: Fixture, role: Actor["role"] = "warehouse") {
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
function held(f: Fixture, serial = "S1") {
  const u = f.app.inventory.trace(f.actor, serial).unit;
  f.app.inventory.inspect(f.actor, `hold-${serial}-${u.revision}`, {
    unitId: u.id,
    revision: u.revision,
    condition: "quarantine",
    reason: "Synthetic missing-stock search hold",
  });
  return f.app.inventory.unit(f.actor, u.id);
}
function reportInput(u: ReturnType<typeof held>, reviewRef = "MISSING-1") {
  return {
    unitId: u.id,
    revision: u.revision,
    serial: u.serial!,
    reviewRef,
    reason: "Synthetic search of bin and staging area found no serial",
  };
}
function recoverInput(
  f: Fixture,
  reviewId: string,
  serial = "S1",
  receiptRef = "FOUND-1",
) {
  return {
    reviewId,
    revision: f.app.inventory.trace(f.actor, serial).unit.revision,
    serial,
    receiptRef,
    bin: "RECOVERY-1",
    reason: "Synthetic physically scanned recovered equipment",
  };
}
function snapshot(f: Fixture) {
  const inventory = f.app.database.owned("inventory"),
    platform = f.app.database.owned("platform");
  return {
    stock: f.app.inventory.stock(f.actor),
    reviews: f.app.inventory.serialReviews(f.actor),
    movements: inventory.all(
      "SELECT * FROM inventory_movements ORDER BY rowid",
    ),
    sequences: inventory.all(
      "SELECT * FROM inventory_cost_sequences ORDER BY sequence",
    ),
    clock: inventory.get("SELECT * FROM inventory_cost_clock"),
    events: platform.all("SELECT * FROM platform_events ORDER BY rowid"),
    audits: platform.all("SELECT * FROM platform_audit ORDER BY rowid"),
    commands: platform.all("SELECT * FROM platform_commands ORDER BY rowid"),
    costs: f.app.inventory.costs.window(f.actor, 0),
    invoices: f.app.billing.invoices(f.actor),
    exposure: f.app.billing.exposure(f.actor, f.buyer),
  };
}
function approve(f: Fixture, id: string, key = "approve") {
  return f.app.inventory.decideSerialMissing(f.actor, key, {
    reviewId: id,
    decision: "approve",
    reason: "Synthetic reviewed serial loss evidence",
  });
}

test("serial observation, independent review and scanned recovery conserve original identity and cost without changing orders or money", (t) => {
  const f = fixture(t),
    o = accept(f),
    a = f.app.fulfillment.picks(f.actor, o.id)[0]!,
    staff = observer(f);
  const shortage = f.app.fulfillment.shortPick(staff, "short", {
    orderId: o.id,
    revision: f.app.orders.order(f.actor, o.id).revision,
    allocationId: a.id,
    unitRevision: a.unitRevision,
    quantity: 1,
    reason: "Synthetic picker could not find S1",
  });
  const originalOrigin = f.app.inventory.purchaseOrigin(f.actor, a.unit_id);
  const u = f.app.inventory.unit(f.actor, shortage.heldUnitId),
    payload = reportInput(u),
    before = snapshot(f);
  const r = f.app.inventory.reportSerialMissing(staff, "report", payload);
  assert.equal(f.app.inventory.unit(f.actor, u.id).quantity, 1);
  assert.equal(f.app.inventory.costs.window(f.actor, 0).closingValue, 18000);
  assert.throws(
    () =>
      f.app.inventory.decideSerialMissing(staff, "forbidden", {
        reviewId: r.id,
        decision: "approve",
        reason: "Self review",
      }),
    { code: "FORBIDDEN" },
  );
  const result = approve(f, r.id);
  assert.deepEqual(
    [result.valueDelta, result.revision],
    [-6000, u.revision + 1],
  );
  assert.deepEqual(
    [
      f.app.inventory.unit(f.actor, u.id).quantity,
      f.app.inventory.unit(f.actor, u.id).state,
    ],
    [0, "stock"],
  );
  assert.equal(f.app.inventory.costs.window(f.actor, 0).closingValue, 12000);
  assert.equal(f.app.inventory.purchaseOrigin(f.actor, u.id), originalOrigin);
  assert.throws(
    () =>
      f.app.inventory.inspect(f.actor, "inspect-missing", {
        unitId: u.id,
        revision: result.revision,
        condition: "usable",
        reason: "Not physical",
      }),
    { code: "STATE" },
  );
  for (const disposition of ["restock", "scrap", "repair"] as const)
    assert.throws(
      () =>
        f.app.inventory.returnDisposition(
          f.actor,
          u.id,
          disposition,
          "absent",
          "Synthetic absent stock",
        ),
      { code: "STATE" },
    );
  const recovery = recoverInput(f, r.id),
    recovered = f.app.inventory.recoverSerialMissing(
      staff,
      "recover",
      recovery,
    );
  assert.equal(recovered.valueDelta, 6000);
  const found = f.app.inventory.unit(f.actor, u.id);
  assert.deepEqual(
    [found.serial, found.quantity, found.cost, found.condition, found.bin],
    ["S1", 1, 6000, "quarantine", "RECOVERY-1"],
  );
  assert.equal(f.app.inventory.costs.window(f.actor, 0).closingValue, 18000);
  assert.equal(f.app.inventory.availability(f.actor, f.product, f.w1), 2);
  assert.equal(f.app.inventory.purchaseOrigin(f.actor, u.id), originalOrigin);
  assert.deepEqual(f.app.billing.invoices(f.actor), before.invoices);
  assert.deepEqual(f.app.billing.exposure(f.actor, f.buyer), before.exposure);
  assert.deepEqual(
    f.app.orders
      .lines(f.actor, o.id)
      .map((l) => [l.quantity, l.allocated, l.shipped, l.canceled]),
    [[1, 0, 0, 0]],
  );
  const review = f.app.inventory.serialReviews(f.actor).items[0]!;
  assert.deepEqual(
    [review.observed_by, review.decided_by, review.recovered_by, review.state],
    [staff.id, f.actor.id, staff.id, "recovered"],
  );
  assert.equal("input_hash" in review, false);
  assert.equal("recovery_hash" in review, false);
  assert.deepEqual(
    f.app.inventory
      .trace(f.actor, "S1")
      .movements.slice(-2)
      .map((m) => [m.type, m.quantity, m.unit_cost, m.reference]),
    [
      ["serial.loss", -1, 6000, r.id],
      ["serial.recovery", 1, 6000, r.id],
    ],
  );
  f.app.inventory.inspect(staff, "inspect-found", {
    unitId: u.id,
    revision: found.revision,
    condition: "usable",
    reason: "Synthetic identity and condition verified",
  });
  f.app.orders.allocate(f.actor, "reallocate", {
    orderId: o.id,
    revision: f.app.orders.order(f.actor, o.id).revision,
  });
  assert.equal(f.app.orders.lines(f.actor, o.id)[0]!.allocated, 1);
  assert.equal(f.app.billing.invoices(f.actor).length, 0);
});

test("durable keys and business references prevent duplicate loss or recovery through restart and repeated custody cycles", (t) => {
  const f = fixture(t),
    staff = observer(f),
    u = held(f),
    payload = reportInput(u);
  const r = f.app.inventory.reportSerialMissing(staff, "report", payload),
    decision = {
      reviewId: r.id,
      decision: "approve" as const,
      reason: "Synthetic reviewed loss",
    };
  const approved = f.app.inventory.decideSerialMissing(
      f.actor,
      "approve",
      decision,
    ),
    recovery = recoverInput(f, r.id),
    found = f.app.inventory.recoverSerialMissing(staff, "found", recovery);
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(
    f.app.inventory.reportSerialMissing(staff, "report", payload),
    r,
  );
  assert.deepEqual(
    f.app.inventory.reportSerialMissing(staff, "new-report-key", {
      ...payload,
      reviewRef: " MISSING-1 ",
    }),
    r,
  );
  assert.deepEqual(
    f.app.inventory.decideSerialMissing(f.actor, "new-decision-key", decision),
    approved,
  );
  assert.deepEqual(
    f.app.inventory.recoverSerialMissing(staff, "new-recovery-key", recovery),
    found,
  );
  for (const [name, run] of [
    [
      "payload",
      () =>
        f.app.inventory.reportSerialMissing(staff, "report", {
          ...payload,
          reason: "Changed",
        }),
    ],
    [
      "reference",
      () =>
        f.app.inventory.reportSerialMissing(staff, "changed-report-key", {
          ...payload,
          reason: "Changed",
        }),
    ],
    [
      "decision",
      () =>
        f.app.inventory.decideSerialMissing(f.actor, "changed-decision", {
          ...decision,
          decision: "reject",
        }),
    ],
    [
      "recovery",
      () =>
        f.app.inventory.recoverSerialMissing(staff, "changed-found", {
          ...recovery,
          bin: "Other",
        }),
    ],
  ] as const)
    assert.throws(run, {
      code: name === "payload" ? "IDEMPOTENCY_CONFLICT" : "RECEIPT_CONFLICT",
    });
  const u2 = f.app.inventory.unit(f.actor, u.id),
    r2 = f.app.inventory.reportSerialMissing(
      staff,
      "report2",
      reportInput(u2, "MISSING-2"),
    );
  approve(f, r2.id, "approve2");
  assert.throws(
    () =>
      f.app.inventory.recoverSerialMissing(
        staff,
        "found2bad",
        recoverInput(f, r2.id),
      ),
    { code: "RECEIPT_CONFLICT" },
  );
  f.app.inventory.recoverSerialMissing(
    staff,
    "found2",
    recoverInput(f, r2.id, "S1", "FOUND-2"),
  );
  const movements = f.app.inventory.trace(f.actor, "S1").movements;
  assert.equal(movements.filter((m) => m.type === "serial.loss").length, 2);
  assert.equal(movements.filter((m) => m.type === "serial.recovery").length, 2);
  assert.equal(f.app.inventory.costs.window(f.actor, 0).closingValue, 18000);
});

test("custody requests reject stale snapshots, wrong identity, duplicate pending reviews and conflicting reservations", (t) => {
  const f = fixture(t),
    u = held(f),
    payload = reportInput(u),
    before = snapshot(f);
  for (const patch of [
    { revision: 0 },
    { revision: 1 },
    { revision: 2.5 },
    { serial: "S2" },
    { reviewRef: " " },
    { reason: "" },
    { reason: "x".repeat(1001) },
  ])
    assert.throws(() =>
      f.app.inventory.reportSerialMissing(f.actor, JSON.stringify(patch), {
        ...payload,
        ...patch,
      }),
    );
  assert.deepEqual(snapshot(f), before);
  const r = f.app.inventory.reportSerialMissing(f.actor, "report", payload);
  assert.throws(
    () =>
      f.app.inventory.reportSerialMissing(f.actor, "pending", {
        ...payload,
        reviewRef: "OTHER",
      }),
    { code: "REVIEW_PENDING" },
  );
  f.app.inventory.inspect(f.actor, "moved-condition", {
    unitId: u.id,
    revision: u.revision,
    condition: "damaged",
    reason: "Synthetic physical inspection differs",
  });
  const changed = snapshot(f);
  assert.throws(() => approve(f, r.id), { code: "REVISION" });
  assert.deepEqual(snapshot(f), changed);
  const rejected = f.app.inventory.decideSerialMissing(f.actor, "reject", {
    reviewId: r.id,
    decision: "reject",
    reason: "Synthetic stale observation rejected",
  });
  assert.equal(rejected.valueDelta, 0);
  assert.throws(
    () =>
      f.app.inventory.recoverSerialMissing(
        f.actor,
        "bad-recover",
        recoverInput(f, r.id),
      ),
    { code: "STATE" },
  );
  assert.equal(f.app.inventory.costs.window(f.actor, 0).closingValue, 18000);
  const s2 = f.app.inventory.trace(f.actor, "S2").unit;
  assert.throws(
    () =>
      f.app.inventory.reportSerialMissing(
        f.actor,
        "usable",
        reportInput(s2, "USABLE"),
      ),
    { code: "STATE" },
  );
  const order = accept(f),
    allocated = f.app.fulfillment.picks(f.actor, order.id)[0]!;
  // Simulate a corrupted/concurrent reservation conflict after a prior quarantine.
  const store = f.app.database.owned("inventory");
  store.run(
    "UPDATE inventory_units SET condition='quarantine' WHERE id=?",
    allocated.unit_id,
  );
  const reserved = f.app.inventory.unit(f.actor, allocated.unit_id);
  assert.throws(
    () =>
      f.app.inventory.reportSerialMissing(
        f.actor,
        "reserved",
        reportInput(reserved, "RESERVED"),
      ),
    { code: "ALLOCATION" },
  );
});

test("approved loss refuses wrong scans, stale recovery, changed original evidence and current replacement reservations", (t) => {
  const f = fixture(t),
    u = held(f),
    r = f.app.inventory.reportSerialMissing(f.actor, "report", reportInput(u));
  approve(f, r.id);
  const payload = recoverInput(f, r.id),
    before = snapshot(f);
  for (const patch of [
    { serial: "S2" },
    { revision: u.revision },
    { receiptRef: "" },
    { bin: " " },
    { reason: "" },
    { reason: "x".repeat(1001) },
  ])
    assert.throws(() =>
      f.app.inventory.recoverSerialMissing(f.actor, JSON.stringify(patch), {
        ...payload,
        ...patch,
      }),
    );
  assert.deepEqual(snapshot(f), before);
  const store = f.app.database.owned("inventory");
  store.run("UPDATE inventory_units SET cost=7000 WHERE id=?", u.id);
  assert.throws(
    () => f.app.inventory.recoverSerialMissing(f.actor, "wrong-cost", payload),
    { code: "STATE" },
  );
  store.run("UPDATE inventory_units SET cost=6000 WHERE id=?", u.id);
  store.run(
    "INSERT INTO inventory_replacements VALUES(?,?,?,'reserved')",
    "synthetic-reservation",
    f.actor.orgId,
    u.id,
  );
  assert.throws(
    () => f.app.inventory.recoverSerialMissing(f.actor, "reserved", payload),
    { code: "ALLOCATION" },
  );
  store.run(
    "DELETE FROM inventory_replacements WHERE id=?",
    "synthetic-reservation",
  );
  f.app.inventory.recoverSerialMissing(f.actor, "found", payload);
  assert.equal(f.app.inventory.costs.window(f.actor, 0).closingValue, 18000);
});

test("serial custody cached commands and history recheck current identity, role, sites and password requirements", (t) => {
  const f = fixture(t),
    staff = observer(f),
    u = held(f),
    payload = reportInput(u),
    r = f.app.inventory.reportSerialMissing(staff, "report", payload);
  approve(f, r.id);
  const recovery = recoverInput(f, r.id);
  f.app.inventory.recoverSerialMissing(staff, "found", recovery);
  const iam = f.app.database.owned("iam");
  for (const sql of [
    "UPDATE iam_users SET role='buyer' WHERE id=?",
    "UPDATE iam_users SET sites='[]' WHERE id=?",
    "UPDATE iam_users SET active=0 WHERE id=?",
    "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
  ]) {
    iam.run(sql, staff.id);
    assert.throws(() =>
      f.app.inventory.reportSerialMissing(staff, "report", payload),
    );
    assert.throws(() =>
      f.app.inventory.recoverSerialMissing(staff, "found", recovery),
    );
    if (sql.includes("sites="))
      assert.deepEqual(f.app.inventory.serialReviews(staff), {
        items: [],
        next: null,
      });
    else assert.throws(() => f.app.inventory.serialReviews(staff));
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
  const fake = { ...staff, id: "fake-admin", role: "admin" as const };
  assert.throws(
    () =>
      f.app.inventory.decideSerialMissing(fake, "fake", {
        reviewId: r.id,
        decision: "approve",
        reason: "Synthetic reviewed serial loss evidence",
      }),
    { code: "FORBIDDEN" },
  );
  const support = observer(f, "support"),
    finance = observer(f, "finance");
  assert.equal(f.app.inventory.serialReviews(support).items.length, 1);
  assert.equal(f.app.inventory.serialReviews(finance).items.length, 1);
  assert.throws(() => f.app.inventory.serialReviews(observer(f, "buyer")), {
    code: "FORBIDDEN",
  });
  assert.throws(
    () => f.app.inventory.serialReviews({ ...f.actor, orgId: "other-org" }),
    { code: "FORBIDDEN" },
  );
});

test("custody history pages exact site-scoped same-time identities and retains rejected evidence", (t) => {
  const f = fixture(t),
    staff = observer(f),
    u = held(f),
    ids: string[] = [];
  for (let i = 0; i < 25; i++) {
    const r = f.app.inventory.reportSerialMissing(
      staff,
      `report${i}`,
      reportInput(u, `REF-${i}`),
    );
    ids.push(r.id);
    f.app.inventory.decideSerialMissing(f.actor, `reject${i}`, {
      reviewId: r.id,
      decision: "reject",
      reason: "Synthetic reviewed insufficient evidence",
    });
  }
  const store = f.app.database.owned("inventory");
  store.run(
    "UPDATE inventory_serial_reviews SET created_at=?",
    "2026-10-01T00:00:00.000Z",
  );
  const first = f.app.inventory.serialReviews(staff),
    second = f.app.inventory.serialReviews(staff, first.next!);
  assert.equal(first.items.length, 20);
  assert.equal(second.items.length, 5);
  assert.equal(second.next, null);
  assert.deepEqual(
    [...first.items, ...second.items].map((r) => r.id),
    ids.sort(),
  );
  assert.throws(() => f.app.inventory.serialReviews(staff, "missing-cursor"), {
    code: "NOT_FOUND",
  });
  const foreign = held(f, "S2");
  store.run(
    "UPDATE inventory_units SET warehouse_id=? WHERE id=?",
    f.w2,
    foreign.id,
  );
  const other = f.app.inventory.reportSerialMissing(
    f.actor,
    "other",
    reportInput(f.app.inventory.unit(f.actor, foreign.id), "OTHER-SITE"),
  );
  assert.equal(f.app.inventory.serialReviews(staff).items.length, 20);
  assert.throws(() => f.app.inventory.serialReviews(staff, other.id), {
    code: "FORBIDDEN",
  });
});

for (const action of ["report", "approve", "recover"] as const)
  test(`late audit failure rolls back ${action} custody facts, clock, events and receipts`, (t) => {
    const f = fixture(t),
      u = held(f);
    const r =
      action !== "report"
        ? f.app.inventory.reportSerialMissing(f.actor, "report", reportInput(u))
        : undefined;
    if (action === "recover") approve(f, r!.id);
    const payload = action === "recover" ? recoverInput(f, r!.id) : undefined,
      before = snapshot(f),
      original = f.app.platform.audit;
    const run = () =>
      action === "report"
        ? f.app.inventory.reportSerialMissing(f.actor, "report", reportInput(u))
        : action === "approve"
          ? approve(f, r!.id)
          : f.app.inventory.recoverSerialMissing(f.actor, "recover", payload!);
    f.app.platform.audit = (...args: Parameters<typeof original>) => {
      if (
        args[1] === `serial.missing.${action === "approve" ? "decide" : action}`
      )
        throw new Error("Synthetic late custody audit failure");
      return original.apply(f.app.platform, args);
    };
    assert.throws(run, /Synthetic late custody audit failure/);
    assert.deepEqual(snapshot(f), before);
    f.app.platform.audit = original;
    run();
    assert.equal(f.app.inventory.serialReviews(f.actor).items.length, 1);
    assert.equal(
      f.app.inventory.costs.window(f.actor, 0).closingValue,
      action === "approve" ? 12000 : 18000,
    );
  });

test("HTTP serial custody has strict schemas, CSRF, exact response retries and paged history", async (t) => {
  const f = fixture(t),
    u = held(f),
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
    c = login.cookies[0]!;
  const headers = {
    origin,
    cookie: `${c.name}=${c.value}`,
    "x-csrf-token": login.json().csrf,
    "idempotency-key": "http-custody",
  };
  const send = (name: string, payload: Record<string, unknown>, h = headers) =>
    http.inject({
      method: "POST",
      url: `/api/commands/serial.missing.${name}`,
      headers: h,
      payload,
    });
  const payload = reportInput(u);
  assert.equal(
    (await send("report", { ...payload, writeoff: true })).statusCode,
    400,
  );
  assert.equal(
    (await send("report", payload, { ...headers, "x-csrf-token": "bad" }))
      .statusCode,
    403,
  );
  const r = await send("report", payload);
  assert.equal(r.statusCode, 200);
  assert.deepEqual((await send("report", payload)).json(), r.json());
  const reviewId = r.json().id;
  const decision = await send("decide", {
    reviewId,
    decision: "approve",
    reason: "Synthetic admin review",
  });
  assert.equal(decision.statusCode, 200);
  const recovery = await send("recover", recoverInput(f, reviewId));
  assert.equal(recovery.statusCode, 200);
  const history = await http.inject({
    url: "/api/stock/serial-reviews",
    headers,
  });
  assert.equal(history.statusCode, 200);
  assert.equal(history.json().items[0].state, "recovered");
  assert.equal(
    (await http.inject({ url: "/api/stock/serial-reviews?unknown=1", headers }))
      .statusCode,
    400,
  );
});

test(
  "separate processes racing recovery receipts restore one serial exactly once",
  { timeout: 15000 },
  async (t) => {
    const f = fixture(t),
      u = held(f),
      r = f.app.inventory.reportSerialMissing(
        f.actor,
        "report",
        reportInput(u),
      );
    approve(f, r.id);
    const children: ChildProcess[] = [];
    t.after(() =>
      children.forEach((c) => {
        if (c.connected) c.kill();
      }),
    );
    const works = ["A", "B"].map((suffix) => {
      const child = fork(
        new URL("./serial-custody-child.ts", import.meta.url),
        [],
        {
          execArgv: ["--import", "tsx"],
          stdio: ["ignore", "ignore", "pipe", "ipc"],
        },
      );
      children.push(child);
      let resolveReady: () => void,
        resolveResult: (r: { ok: boolean; code?: string }) => void;
      const ready = new Promise<void>((resolve) => {
          resolveReady = resolve;
        }),
        result = new Promise<{ ok: boolean; code?: string }>(
          (resolve, reject) => {
            resolveResult = resolve;
            let stderr = "";
            child.stderr?.on("data", (x) => {
              stderr += String(x);
            });
            child.on("error", reject);
            child.on("exit", (code) => {
              if (code !== 0)
                reject(new Error(`Custody child ${code}: ${stderr}`));
            });
          },
        );
      child.on("message", (m: any) =>
        m.ready ? resolveReady() : resolveResult(m),
      );
      child.send({
        action: "init",
        path: f.path,
        actor: f.actor,
        key: `recover-${suffix}`,
        payload: recoverInput(f, r.id, "S1", `FOUND-${suffix}`),
      });
      return { ready, result };
    });
    await Promise.all(works.map((w) => w.ready));
    children.forEach((c) => c.send({ action: "go" }));
    const results = await Promise.all(works.map((w) => w.result));
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(results.find((r) => !r.ok)!.code, "RECEIPT_CONFLICT");
    assert.equal(f.app.inventory.trace(f.actor, "S1").unit.quantity, 1);
    assert.equal(
      f.app.inventory
        .trace(f.actor, "S1")
        .movements.filter((m) => m.type === "serial.recovery").length,
      1,
    );
    assert.equal(f.app.inventory.costs.window(f.actor, 0).closingValue, 18000);
  },
);
