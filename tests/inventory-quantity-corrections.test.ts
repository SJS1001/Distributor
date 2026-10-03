import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { canonical, digest } from "../src/server/core.ts";
import { createHttp } from "../src/server/http.ts";
import { createBackup, restoreBackup } from "../src/server/recovery.ts";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";

type Fixture = ReturnType<typeof fixture>;
function setup(
  t: Parameters<typeof fixture>[0],
  region: "CA" | "US" = "CA",
  eventReports = true,
) {
  const f = fixture(t, { eventReports }, region);
  const user = f.app.identity.createUser(f.actor, "quantity-reviewer", {
    email: "quantity@example.test",
    name: "Synthetic finance reviewer",
    password: "long-test-only-password",
    role: "finance",
    sites: [f.w1, f.w2],
  });
  const second = f.app.identity.currentActor({ ...f.actor, id: user.id });
  const productId = f.app.catalog.create(f.actor, "bulk", {
    sku: "ERROR-BULK",
    name: "Synthetic bulk",
    serialized: false,
    unitPrice: 2500,
    taxBasisPoints: 0,
  }).id;
  const poId = f.app.procurement.create(f.actor, "quantity-po", {
    supplierId: f.supplier,
    warehouseId: f.w1,
    lines: [{ productId, quantity: 6, unitCost: 1000 }],
  }).id;
  const line = f.app.procurement.orders(f.actor).find((p) => p.id === poId)!
    .lines[0]!;
  f.app.procurement.receive(f.actor, "receipt", {
    poId,
    lineId: String(line.id),
    quantity: 6,
    serials: [],
    deliveryRef: "SYNTHETIC",
    bin: "B",
    quarantine: false,
  });
  const unit = f.app.inventory
    .stock(f.actor)
    .find((u) => u.product_id === productId)!;
  f.app.inventory.valuations.configure(f.actor, "policy", {
    productId,
    previousRevision: 0,
    policyVersion: "synthetic-1",
    establishedBasis: "Synthetic established basis",
    establishedMethod: "fifo-receipt-layers",
    effectiveFrom: "2026-01-01",
    closedThrough: "2026-08-31",
    financeEvidence: "Synthetic accountant policy evidence",
  });
  const source = f.app.database
    .owned("inventory")
    .get<{ id: string }>(
      "SELECT id FROM inventory_movements WHERE org_id=? AND unit_id=? AND type='receipt'",
      f.actor.orgId,
      unit.id,
    )!.id;
  return { f, second, unit, source };
}
function input(
  s: ReturnType<typeof setup>,
  targetQuantity = 4,
  reference = "ERROR-1",
) {
  const review = s.f.app.inventory.quantityCorrections.review(
    s.f.actor,
    s.unit.id,
    s.source,
  );
  return {
    unitId: s.unit.id,
    sourceMovementId: s.source,
    reviewHash: review.reviewHash,
    reference,
    targetQuantity,
    postingDate: "2026-10-01",
    reason: "Synthetic original quantity error",
    physicalEvidence: "Synthetic independently recounted receipt",
    accountantEvidence: "Synthetic open-period error classification",
  };
}
function decide(
  s: ReturnType<typeof setup>,
  p: ReturnType<Application["inventory"]["quantityCorrections"]["prepare"]>,
  key = "approve",
) {
  return s.f.app.inventory.quantityCorrections.decide(s.second, key, {
    correctionId: p.id,
    reviewHash: p.reviewHash,
    decision: "approve",
    reason: "Synthetic independent approval",
  });
}
for (const region of ["CA", "US"] as const)
  test(`${region} quantity approval appends a dated compensation, preserves original evidence and recovers exact receipts`, (t) => {
    const s = setup(t, region),
      { f } = s,
      store = f.app.database.owned("inventory"),
      original = store.get(
        "SELECT * FROM inventory_movements WHERE id=?",
        s.source,
      ),
      before = f.app.inventory.costs.window(f.actor, 0),
      body = input(s);
    const p = f.app.inventory.quantityCorrections.prepare(
      f.actor,
      "prepare",
      body,
    );
    assert.equal(f.app.inventory.unit(f.actor, s.unit.id).quantity, 6);
    assert.equal(f.app.inventory.costs.window(f.actor, 0).closingValue, 24000);
    assert.throws(
      () =>
        f.app.inventory.quantityCorrections.decide(f.actor, "own", {
          correctionId: p.id,
          reviewHash: p.reviewHash,
          decision: "approve",
          reason: "Synthetic own review",
        }),
      { code: "QUANTITY_SEPARATION" },
    );
    const approved = decide(s, p);
    assert.equal(approved.state, "reviewed");
    assert.equal(approved.valueDelta, -2000);
    assert.equal(f.app.inventory.unit(f.actor, s.unit.id).quantity, 4);
    assert.equal(f.app.inventory.unit(f.actor, s.unit.id).cost, 1000);
    assert.deepEqual(
      store.get("SELECT * FROM inventory_movements WHERE id=?", s.source),
      original,
    );
    const after = f.app.inventory.costs.window(f.actor, before.throughSequence);
    assert.equal(after.movements.length, 1);
    assert.equal(after.closingValue, 22000);
    assert.equal(after.movements[0]!.type, "quantity.correction");
    assert.equal(after.movements[0]!.accountingDate, "2026-10-01");
    assert.equal(after.movements[0]!.quantityCorrectionId, p.id);
    assert.deepEqual(
      {
        ...f.app.inventory.costs.window(f.actor, 0, before.throughSequence),
        more: false,
      },
      before,
    );
    f.app.close();
    f.app = new Application(f.path, region);
    assert.deepEqual(
      canonical(f.app.inventory.quantityCorrections.get(s.second, p.id)),
      canonical(approved),
    );
    assert.equal(canonical(decide(s, p)), canonical(approved));
    assert.deepEqual(
      canonical(
        f.app.inventory.quantityCorrections.prepare(f.actor, "prepare", body),
      ),
      canonical(p),
    );
    assert.deepEqual(
      canonical(
        f.app.inventory.quantityCorrections.history(s.second, s.unit.id).items,
      ),
      canonical([approved]),
    );
  });
for (const region of ["CA", "US"] as const)
  for (const eventReports of [false, true])
    test(`${region} encrypted restore conserves approved/rejected/ready quantity evidence with reports=${eventReports} and holds exact retries`, async (t) => {
      const s = setup(t, region, eventReports),
        { f } = s,
        q = f.app.inventory.quantityCorrections;
      const firstInput = input(s),
        first = q.prepare(f.actor, "restore-first", firstInput),
        approved = decide(s, first),
        rejectedInput = input(s, 5, "ERROR-REJECTED"),
        rejectedPrepared = q.prepare(
          f.actor,
          "restore-rejected",
          rejectedInput,
        ),
        rejected = q.decide(s.second, "restore-reject-decision", {
          correctionId: rejectedPrepared.id,
          reviewHash: rejectedPrepared.reviewHash,
          decision: "reject",
          reason: "Synthetic rejected evidence",
        }),
        pendingInput = input(s, 5, "ERROR-PENDING"),
        pending = q.prepare(f.actor, "restore-pending", pendingInput),
        cutoff = f.app.inventory.costs.window(f.actor, 0),
        archive = join(dirname(f.path), "quantity.backup"),
        target = join(dirname(f.path), "quantity-restored.db"),
        key = randomBytes(32);
      const backup = await createBackup(f.path, archive, region, key);
      decide(s, pending, "post-cutoff-decision");
      assert.equal(f.app.inventory.unit(f.actor, s.unit.id).quantity, 5);
      const restored = await restoreBackup(archive, target, region, key);
      assert.equal(restored.providerHold, true);
      assert.equal(restored.snapshotHash, backup.snapshotHash);
      assert.equal(restored.eventReports, eventReports);
      const candidate = new Application(target, region, {
        eventReports: false,
      });
      t.after(() => candidate.close());
      const actor = candidate.identity.currentActor(f.actor),
        reviewer = candidate.identity.currentActor(s.second),
        restoredQ = candidate.inventory.quantityCorrections;
      assert.equal(candidate.inventory.unit(actor, s.unit.id).quantity, 4);
      assert.equal(
        canonical(restoredQ.history(reviewer, s.unit.id).items),
        canonical([approved, rejected, pending]),
      );
      assert.equal(
        canonical(candidate.inventory.costs.window(actor, 0)),
        canonical(cutoff),
      );
      for (const [attemptKey, body] of [
        ["restore-first", firstInput],
        ["restore-rejected", rejectedInput],
        ["restore-pending", pendingInput],
      ] as const)
        assert.throws(() => restoredQ.prepare(actor, attemptKey, body), {
          code: "RECOVERY_HOLD",
        });
      assert.throws(
        () =>
          restoredQ.decide(reviewer, "approve", {
            correctionId: first.id,
            reviewHash: first.reviewHash,
            decision: "approve",
            reason: "Synthetic independent approval",
          }),
        { code: "RECOVERY_HOLD" },
      );
      assert.throws(
        () =>
          restoredQ.decide(reviewer, "release-pending", {
            correctionId: pending.id,
            reviewHash: pending.reviewHash,
            decision: "approve",
            reason: "Synthetic pending approval",
          }),
        { code: "RECOVERY_HOLD" },
      );
      assert.equal(candidate.inventory.unit(actor, s.unit.id).quantity, 4);
      assert.equal(
        canonical(restoredQ.get(reviewer, pending.id)),
        canonical(pending),
      );
    });

test("valued quantity removal releases the final rounding remainder and increase retains the established basis", (t) => {
  const s = setup(t),
    { f } = s;
  const review = f.app.inventory.valuations.review(f.actor, s.unit.id);
  const vp = f.app.inventory.valuations.prepare(f.actor, "value", {
    unitId: s.unit.id,
    reviewHash: review.reviewHash,
    reference: "VALUE",
    kind: "write-down",
    targetValue: 4001,
    postingDate: "2026-10-01",
    reason: "Synthetic value",
    evidence: "Synthetic recoverable value",
    accountantEvidence: "Synthetic method",
  });
  f.app.inventory.valuations.decide(s.second, "value-approve", {
    valuationId: vp.id,
    reviewHash: vp.reviewHash,
    decision: "approve",
    reason: "Synthetic separate approval",
  });
  const p = f.app.inventory.quantityCorrections.prepare(
    f.actor,
    "remove",
    input(s, 0),
  );
  const a = decide(s, p);
  assert.equal(a.valueDelta, -4001);
  assert.equal(f.app.inventory.costs.window(f.actor, 0).closingValue, 18000);
  const restored = f.app.inventory.quantityCorrections.prepare(
    f.actor,
    "increase",
    input(s, 3, "ERROR-2"),
  );
  const b = decide(s, restored, "increase-approve");
  assert.equal(b.valueDelta, 2000);
  assert.equal(f.app.inventory.unit(f.actor, s.unit.id).cost, 1000);
  assert.equal(f.app.inventory.costs.window(f.actor, 0).closingValue, 20000);
});
test("closed dates, nonexistent dates, unchanged quantities, serialized stock and foreign source layers refuse preparation", (t) => {
  const s = setup(t),
    q = s.f.app.inventory.quantityCorrections,
    body = input(s);
  for (const change of [
    { postingDate: "2026-08-31" },
    { postingDate: "2026-02-30" },
    { targetQuantity: 6 },
    { physicalEvidence: "" },
    { accountantEvidence: "" },
  ])
    assert.throws(() =>
      q.prepare(s.f.actor, canonical(change), { ...body, ...change }),
    );
  const serial = s.f.app.inventory.stock(s.f.actor).find((u) => u.serial)!;
  assert.throws(() => q.review(s.f.actor, serial.id, s.source), {
    code: "QUANTITY_CUSTODY",
  });
  assert.throws(() => q.review(s.f.actor, s.unit.id, "unrelated"), {
    code: "NOT_FOUND",
  });
  assert.equal(q.history(s.f.actor, s.unit.id).items.length, 0);
  assert.equal(s.f.app.inventory.unit(s.f.actor, s.unit.id).quantity, 6);
});
test("stock and policy changes stale approval while rejection keeps immutable evidence", (t) => {
  const s = setup(t),
    q = s.f.app.inventory.quantityCorrections,
    p = q.prepare(s.f.actor, "prepare", input(s));
  s.f.app.inventory.adjustCount(s.f.actor, "later-count", {
    unitId: s.unit.id,
    revision: s.unit.revision,
    count: 5,
    reason: "Synthetic later stock change",
  });
  assert.throws(() => decide(s, p), { code: "QUANTITY_STALE" });
  const rejected = q.decide(s.second, "reject", {
    correctionId: p.id,
    reviewHash: p.reviewHash,
    decision: "reject",
    reason: "Synthetic stale preparation rejected",
  });
  assert.equal(rejected.state, "rejected");
  assert.equal(rejected.movement, null);
  assert.equal(s.f.app.inventory.unit(s.f.actor, s.unit.id).quantity, 5);
  assert.throws(() => q.prepare(s.f.actor, "same-ref", input(s, 3)), {
    code: "QUANTITY_REFERENCE",
  });
  const p2 = q.prepare(s.f.actor, "fresh", input(s, 3, "ERROR-2"));
  s.f.app.inventory.valuations.configure(s.f.actor, "new-policy", {
    ...p2.review.policy,
    previousRevision: 1,
    policyVersion: "synthetic-2",
    closedThrough: "2026-10-01",
  });
  assert.throws(() => decide(s, p2, "stale-policy"), {
    code: "QUANTITY_STALE",
  });
});
test("pending preparations and stale review hashes refuse replacement writes", (t) => {
  const s = setup(t),
    q = s.f.app.inventory.quantityCorrections,
    body = input(s),
    p = q.prepare(s.f.actor, "prepare", body);
  assert.throws(
    () => q.prepare(s.f.actor, "second", { ...body, reference: "ERROR-2" }),
    { code: "QUANTITY_PENDING" },
  );
  assert.throws(
    () =>
      q.decide(s.second, "wrong-review", {
        correctionId: p.id,
        reviewHash: "0".repeat(64),
        decision: "approve",
        reason: "Synthetic review",
      }),
    { code: "QUANTITY_STALE" },
  );
  assert.equal(s.f.app.inventory.unit(s.f.actor, s.unit.id).quantity, 6);
});
test("cached decisions still require current role, site, password and recovery authority", (t) => {
  const s = setup(t),
    { f } = s,
    p = f.app.inventory.quantityCorrections.prepare(
      f.actor,
      "prepare",
      input(s),
    );
  decide(s, p);
  const iam = f.app.database.owned("iam");
  iam.run("UPDATE iam_users SET role='warehouse' WHERE id=?", s.second.id);
  assert.throws(() => decide(s, p), { code: "FORBIDDEN" });
  iam.run(
    "UPDATE iam_users SET role='finance',sites='[]' WHERE id=?",
    s.second.id,
  );
  assert.throws(() => decide(s, p), { code: "FORBIDDEN" });
  iam.run(
    "UPDATE iam_users SET sites=? WHERE id=?",
    JSON.stringify([f.w1]),
    s.second.id,
  );
  iam.run(
    "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
    s.second.id,
  );
  assert.throws(() => decide(s, p), { code: "PASSWORD_CHANGE_REQUIRED" });
  iam.run(
    "UPDATE iam_user_security SET password_change_required=0 WHERE user_id=?",
    s.second.id,
  );
  f.app.platform.isolateRestore(
    "Synthetic isolated restore",
    new Date().toISOString(),
  );
  assert.throws(() => decide(s, p), { code: "RECOVERY_HOLD" });
});
test("live order reservations stale quantity approval and prevent removing allocated stock", (t) => {
  const s = setup(t),
    { f } = s,
    p = f.app.inventory.quantityCorrections.prepare(
      f.actor,
      "prepare",
      input(s),
    );
  const cart = f.app.orders.saveCart(f.actor, "bulk-cart", {
    accountId: f.buyer,
    warehouseId: f.w1,
    revision: 0,
    lines: [{ productId: s.unit.product_id, quantity: 5 }],
  });
  const quote = f.app.orders.quote(f.actor, "bulk-quote", {
    cartId: cart.id,
    revision: cart.revision,
  });
  const order = f.app.orders.accept(f.actor, "bulk-accept", {
    quoteId: quote.id,
    allowBackorder: false,
  });
  assert.equal(f.app.inventory.allocations(f.actor, order.id)[0]!.quantity, 5);
  assert.throws(() => decide(s, p), { code: "QUANTITY_STALE" });
  f.app.inventory.quantityCorrections.decide(s.second, "reject-stale", {
    correctionId: p.id,
    reviewHash: p.reviewHash,
    decision: "reject",
    reason: "Synthetic reservation changed",
  });
  assert.throws(
    () =>
      f.app.inventory.quantityCorrections.prepare(
        f.actor,
        "below-reserved",
        input(s, 4, "ERROR-2"),
      ),
    { code: "ALLOCATION" },
  );
  assert.equal(f.app.inventory.unit(f.actor, s.unit.id).quantity, 6);
});
for (const corruption of [
  "missing",
  "hash",
  "delta",
  "source",
  "shape",
] as const)
  test(`complete cost reconciliation refuses ${corruption} quantity evidence even behind its cursor`, (t) => {
    const s = setup(t),
      { f } = s,
      p = f.app.inventory.quantityCorrections.prepare(
        f.actor,
        "prepare",
        input(s),
      ),
      a = decide(s, p),
      end = f.app.inventory.costs.window(f.actor, 0).throughSequence,
      store = f.app.database.owned("inventory");
    if (corruption === "missing")
      store.run("DELETE FROM inventory_quantity_corrections WHERE id=?", p.id);
    if (corruption === "hash")
      store.run(
        "UPDATE inventory_quantity_corrections SET hash=? WHERE id=?",
        "0".repeat(64),
        p.id,
      );
    if (corruption === "delta") {
      const altered = { ...a, valueDelta: -1999 };
      store.run(
        "UPDATE inventory_quantity_corrections SET record=?,hash=? WHERE id=?",
        canonical(altered),
        digest(canonical(altered)),
        p.id,
      );
    }
    if (corruption === "source")
      store.run(
        "UPDATE inventory_movements SET reason='damaged source' WHERE id=?",
        s.source,
      );
    if (corruption === "shape") {
      const altered = { ...a, review: { ...a.review, policy: null } };
      store.run(
        "UPDATE inventory_quantity_corrections SET record=?,hash=? WHERE id=?",
        canonical(altered),
        digest(canonical(altered)),
        p.id,
      );
    }
    assert.throws(() => f.app.inventory.costs.window(f.actor, end), {
      code: "QUANTITY_INTEGRITY",
    });
  });
test("quantity HTTP uses authenticated strict reviews, CSRF and independent finance decisions", async (t) => {
  const s = setup(t),
    http = await createHttp(s.f.app, {
      origin: "http://localhost",
      secureCookies: false,
    });
  t.after(() => http.close());
  const login = async (email: string) => {
    const r = await http.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin: "http://localhost" },
      payload: { email, password: "long-test-only-password" },
    });
    assert.equal(r.statusCode, 200);
    return {
      origin: "http://localhost",
      cookie: r.headers["set-cookie"]!.toString().split(";")[0]!,
      "x-csrf-token": r.json().csrf,
    };
  };
  const headers = await login("admin@example.test"),
    second = await login("quantity@example.test"),
    url = `/api/stock/${s.unit.id}/quantity-review?sourceMovementId=${s.source}`;
  assert.equal((await http.inject({ url })).statusCode, 401);
  assert.equal(
    (await http.inject({ url: url + "&unexpected=1", headers })).statusCode,
    400,
  );
  const r = await http.inject({ url, headers });
  assert.equal(r.statusCode, 200);
  const body = { ...input(s), reviewHash: r.json().reviewHash };
  const post = (name: string, body: unknown, h = headers) =>
    http.inject({
      method: "POST",
      url: `/api/commands/inventory.quantity.${name}`,
      headers: {
        ...h,
        "content-type": "application/json",
        "idempotency-key": `http-${name}`,
      },
      payload: JSON.stringify(body),
    });
  assert.equal(
    (await post("prepare", body, { ...headers, "x-csrf-token": "wrong" }))
      .statusCode,
    403,
  );
  const prepared = await post("prepare", body);
  assert.equal(prepared.statusCode, 200, prepared.body);
  const p = prepared.json();
  const decision = {
    correctionId: p.id,
    reviewHash: p.reviewHash,
    decision: "approve",
    reason: "Synthetic separate approval",
  };
  assert.equal((await post("decide", decision)).statusCode, 409);
  const approved = await post("decide", decision, second);
  assert.equal(approved.statusCode, 200, approved.body);
  const get = await http.inject({
    url: `/api/stock/quantity-corrections/${p.id}`,
    headers: second,
  });
  assert.equal(get.statusCode, 200);
  assert.equal(get.json().state, "reviewed");
});
