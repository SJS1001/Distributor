import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { fork, type ChildProcess } from "node:child_process";
import { join, dirname } from "node:path";
import { fixture, accept, ship } from "./fixtures.ts";
import { warrantyUser, warrantyGrants } from "./warranty-authority-fixtures.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import { createBackup, restoreBackup } from "../src/server/recovery.ts";
import type { Actor } from "../src/server/core.ts";
const start = "2024-02-29T12:00:00.000Z";
const end = "2026-02-28T12:00:00.000Z";
type F = ReturnType<typeof fixture>;
function configure(f: F, days: number, revision: number, key: string) {
  return f.app.identity.configureCoverage(f.actor, key, {
    days,
    revision,
    reason: "Synthetic reviewed coverage",
  });
}
function claim(f: F, unitId: string, policyRevision: number) {
  return {
    accountId: f.buyer,
    unitId,
    policyRevision,
    type: "warranty" as const,
    issue: "Synthetic defect",
    evidence: "Synthetic evidence",
  };
}
function facts(f: F) {
  return (
    [
      "iam",
      "fulfillment",
      "inventory",
      "orders",
      "billing",
      "warranty",
      "platform",
    ] as const
  ).map((owner) => {
    const store = f.app.database.owned(owner);
    return store
      .all<{ name: string }>(
        "SELECT name FROM sqlite_schema WHERE type='table' AND name GLOB ? ORDER BY name",
        `${owner}_*`,
      )
      .map(({ name }) => store.all(`SELECT * FROM ${name} ORDER BY rowid`));
  });
}
function pack(f: F, orderId: string) {
  const allocations = f.app.fulfillment.picks(f.actor, orderId);
  for (const a of allocations)
    f.app.fulfillment.pick(f.actor, `pick-${a.id}`, {
      orderId: orderId,
      allocationId: a.id,
      serial: a.serial,
    });
  return f.app.fulfillment.pack(f.actor, `pack-${orderId}`, {
    orderId,
    revision: f.app.orders.order(f.actor, orderId).revision,
    mode: "collection",
    address: "Synthetic counter",
    lines: allocations.map((a) => ({
      allocationId: a.id,
      quantity: a.quantity,
    })),
  }).id;
}
test("new shipment policy is retained at exact handover, survives drift/retry/restart, and fences claim review to its original version", (t) => {
  const f = fixture(t);
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(start) });
  configure(f, 730, 1, "original");
  const shipment = ship(f, accept(f).id),
    unitId = f.app.inventory.trace(f.actor, "S1").unit.id;
  const locked = f.app.fulfillment.shipmentCoverage(f.actor, shipment.id)!;
  assert.equal(locked.shippedAt, start);
  assert.equal(locked.coverageEnd, end);
  assert.equal(locked.policy.revision, 2);
  configure(f, 30, 2, "next");
  const coverage = f.app.warranty.coverage(f.actor, unitId, f.buyer);
  assert.equal(coverage.source, "shipment_policy");
  assert.deepEqual(coverage.policy, locked.policy);
  assert.equal(coverage.coverageEnd, end);
  const before = facts(f);
  assert.throws(
    () => f.app.warranty.submit(f.actor, "wrong-version", claim(f, unitId, 3)),
    { code: "REVISION" },
  );
  assert.deepEqual(facts(f), before);
  const payload = claim(f, unitId, 2),
    c = f.app.warranty.submit(f.actor, "claim", payload);
  assert.equal(c.coverageEnd, end);
  const retained = f.app.warranty.claimCoverage(f.actor, c.id);
  assert.equal(retained.snapshot?.source, "shipment_policy");
  assert.deepEqual(retained.snapshot?.policy, locked.policy);
  // Even a broken *current* policy cannot rewrite/read-block an earlier sale.
  f.app.database
    .owned("iam")
    .run("UPDATE iam_organizations SET policy='{}' WHERE id=?", f.actor.orgId);
  const unchanged = facts(f);
  assert.deepEqual(f.app.warranty.coverage(f.actor, unitId, f.buyer), coverage);
  assert.deepEqual(f.app.warranty.submit(f.actor, "claim", payload), c);
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(
    f.app.fulfillment.shipmentCoverage(f.actor, shipment.id),
    locked,
  );
  assert.deepEqual(f.app.warranty.claimCoverage(f.actor, c.id), retained);
  assert.deepEqual(facts(f), unchanged);
});
test("policy is captured at handover rather than order acceptance or packing; partial shipments retain independent durations", (t) => {
  const f = fixture(t);
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(start) });
  const order = accept(f, 2);
  const allocations = f.app.fulfillment.picks(f.actor, order.id);
  for (const a of allocations)
    f.app.fulfillment.pick(f.actor, `pick-${a.id}`, {
      orderId: order.id,
      allocationId: a.id,
      serial: a.serial!,
    });
  const packs = allocations.map((a, i) =>
    f.app.fulfillment.pack(f.actor, `partial-${i}`, {
      orderId: order.id,
      revision: f.app.orders.order(f.actor, order.id).revision,
      mode: "collection",
      address: "Counter",
      lines: [{ allocationId: a.id, quantity: 1 }],
    }),
  );
  assert.throws(
    () => f.app.fulfillment.shipmentCoverage(f.actor, packs[0]!.id),
    { code: "STATE" },
  );
  configure(f, 730, 1, "first");
  const firstInput = {
    shipmentId: packs[0]!.id,
    handoverEvidence: "Synthetic first handover",
  };
  const first = f.app.fulfillment.commit(f.actor, "first", firstInput);
  configure(f, 30, 2, "later");
  assert.deepEqual(
    f.app.fulfillment.commit(f.actor, "first", firstInput),
    first,
  );
  const second = f.app.fulfillment.commit(f.actor, "second", {
    shipmentId: packs[1]!.id,
    handoverEvidence: "Synthetic second handover",
  });
  assert.equal(
    f.app.fulfillment.shipmentCoverage(f.actor, first.id)?.policy.days,
    730,
  );
  assert.equal(
    f.app.fulfillment.shipmentCoverage(f.actor, second.id)?.policy.days,
    30,
  );
  assert.equal(
    f.app.database
      .owned("fulfillment")
      .all("SELECT * FROM fulfillment_coverage").length,
    2,
  );
});
test("coverage insert failure rolls back stock, order, invoice, custody, audit and command receipts before exact retry", (t) => {
  const f = fixture(t),
    shipmentId = pack(f, accept(f).id),
    store = f.app.database.owned("fulfillment");
  store.migrate(
    "CREATE TRIGGER fulfillment_coverage_fault BEFORE INSERT ON fulfillment_coverage BEGIN SELECT RAISE(ABORT,'synthetic coverage failure'); END;",
  );
  const before = facts(f),
    input = { shipmentId, handoverEvidence: "Synthetic handover" };
  assert.throws(
    () => f.app.fulfillment.commit(f.actor, "handover", input),
    /synthetic coverage failure/,
  );
  assert.deepEqual(facts(f), before);
  store.migrate("DROP TRIGGER fulfillment_coverage_fault");
  const result = f.app.fulfillment.commit(f.actor, "handover", input);
  assert.equal(
    f.app.fulfillment.shipment(f.actor, shipmentId).state,
    "shipped",
  );
  assert.ok(f.app.fulfillment.shipmentCoverage(f.actor, result.id));
  const completed = facts(f);
  assert.deepEqual(
    f.app.fulfillment.commit(f.actor, "handover", input),
    result,
  );
  assert.deepEqual(facts(f), completed);
});
test("warehouse policy read requires current site/role/password grants and never returns administrator review notes", (t) => {
  const f = fixture(t),
    warehouse = warrantyUser(f, "warehouse");
  const policy = f.app.identity.shipmentCoveragePolicy(warehouse, f.w1);
  assert.deepEqual(Object.keys(policy).sort(), [
    "configuredAt",
    "days",
    "revision",
  ]);
  warrantyGrants(f, warehouse, { sites: [] });
  assert.throws(
    () =>
      f.app.identity.shipmentCoveragePolicy(
        { ...warehouse, sites: [f.w1], role: "admin" },
        f.w1,
      ),
    { code: "FORBIDDEN" },
  );
  const buyer = warrantyUser(f, "buyer");
  assert.throws(
    () =>
      f.app.identity.shipmentCoveragePolicy(
        { ...buyer, role: "warehouse", sites: [f.w1] },
        f.w1,
      ),
    { code: "FORBIDDEN" },
  );
});
test("shipment coverage keeps current buyer scope and rejects tampered policy/date projections without changes", (t) => {
  const f = fixture(t),
    shipment = ship(f, accept(f).id),
    unitId = f.app.inventory.trace(f.actor, "S1").unit.id;
  const buyer = warrantyUser(f, "buyer"),
    store = f.app.database.owned("fulfillment"),
    locked = f.app.fulfillment.shipmentCoverage(buyer, shipment.id)!;
  const other = f.app.identity.createCustomer(f.actor, "other", {
    name: "Other",
    tier: "standard",
    creditLimit: 1000000,
  }).id;
  warrantyGrants(f, buyer, { accountId: other });
  assert.throws(
    () =>
      f.app.fulfillment.shipmentCoverage(
        { ...buyer, role: "admin", accountId: f.buyer },
        shipment.id,
      ),
    { code: "FORBIDDEN" },
  );
  for (const changed of [
    { ...locked, policy: null },
    { ...locked, policy: { ...locked.policy, days: 366 } },
    { ...locked, policy: { ...locked.policy, revision: 2 } },
    { ...locked, shippedAt: start },
    { ...locked, coverageEnd: "2024-02-30T12:00:00.000Z" },
  ]) {
    store.run(
      "UPDATE fulfillment_coverage SET snapshot=? WHERE shipment_id=?",
      JSON.stringify(changed),
      shipment.id,
    );
    const before = facts(f);
    assert.throws(() => f.app.warranty.coverage(f.actor, unitId, f.buyer));
    assert.deepEqual(facts(f), before);
  }
  store.run(
    "UPDATE fulfillment_coverage SET snapshot=? WHERE shipment_id=?",
    JSON.stringify(locked),
    shipment.id,
  );
  assert.equal(
    f.app.warranty.coverage(f.actor, unitId, f.buyer).source,
    "shipment_policy",
  );
});
test("scoped HTTP coverage and encrypted restore preserve sale policy separately from later organization policy", async (t) => {
  const f = fixture(t);
  configure(f, 730, 1, "before");
  const shipment = ship(f, accept(f).id),
    unitId = f.app.inventory.trace(f.actor, "S1").unit.id,
    locked = f.app.fulfillment.shipmentCoverage(f.actor, shipment.id)!;
  configure(f, 30, 2, "after");
  const buyer = warrantyUser(f, "buyer"),
    http = await createHttp(f.app, { origin: "http://127.0.0.1:3117" });
  t.after(() => http.close());
  const session = f.app.identity.login(
    String(f.app.identity.users(f.actor).find((u) => u.id === buyer.id)!.email),
    "long-user-test-password",
  );
  const reply = await http.inject({
    method: "GET",
    url: `/api/warranty/sold-units/${unitId}/coverage?accountId=${f.buyer}`,
    headers: { cookie: `distributor_session=${session.token}` },
  });
  assert.equal(reply.statusCode, 200);
  assert.equal(reply.json().source, "shipment_policy");
  assert.deepEqual(reply.json().policy, locked.policy);
  assert.equal(reply.json().coverageEnd, locked.coverageEnd);
  const key = randomBytes(32),
    archive = join(dirname(f.path), "sale.enc"),
    target = join(dirname(f.path), "restored.db");
  await createBackup(f.path, archive, "CA", key);
  await restoreBackup(archive, target, "CA", key);
  const restored = new Application(target);
  try {
    assert.deepEqual(
      restored.fulfillment.shipmentCoverage(buyer, shipment.id),
      locked,
    );
    assert.equal(restored.identity.coveragePolicy(f.actor).days, 30);
    assert.equal(
      restored.warranty.coverage(buyer, unitId, f.buyer).coverageEnd,
      locked.coverageEnd,
    );
  } finally {
    restored.close();
  }
});

test("replacement lineage retains the sale policy while a later ordinary resale starts its own handover policy", (t) => {
  const f = fixture(t);
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(start) });
  configure(f, 730, 1, "original");
  const shipment = ship(f, accept(f).id),
    unitId = f.app.inventory.trace(f.actor, "S1").unit.id;
  const original = f.app.warranty.submit(
    f.actor,
    "original-claim",
    claim(f, unitId, 2),
  );
  configure(f, 30, 2, "changed");
  f.app.warranty.review(f.actor, "review", {
    claimId: original.id,
    approved: true,
    reason: "Synthetic review",
  });
  f.app.warranty.receive(f.actor, "return", {
    claimId: original.id,
    warehouseId: f.w1,
    bin: "Q",
    serial: "S1",
  });
  f.app.warranty.inspect(f.actor, "inspect", {
    claimId: original.id,
    findings: "Synthetic inspection",
  });
  const replacementUnit = f.app.inventory.trace(f.actor, "S2").unit.id;
  const replacement = f.app.warranty.reserveReplacement(f.actor, "reserve", {
    claimId: original.id,
    newUnitId: replacementUnit,
    oldDisposition: "restock",
    coveragePolicy: "inherit_original",
    reason: "Synthetic replacement",
  });
  f.app.warranty.handoverReplacement(f.actor, "replace", {
    replacementId: replacement.id,
    revision: 1,
    serial: "S2",
    recipient: "Synthetic buyer",
    evidence: "Synthetic receipt",
  });
  const inherited = f.app.warranty.coverage(f.actor, replacementUnit, f.buyer);
  assert.equal(inherited.source, "replacement_inherited");
  assert.equal(inherited.coverageEnd, end);
  assert.equal(inherited.policy?.revision, 2);
  const secondClaim = f.app.warranty.submit(
    f.actor,
    "replacement-claim",
    claim(f, replacementUnit, 2),
  );
  const snapshot = f.app.warranty.claimCoverage(
    f.actor,
    secondClaim.id,
  ).snapshot!;
  assert.equal(snapshot.inheritedFromClaimId, original.id);
  assert.equal(snapshot.source, "replacement_inherited");
  assert.equal(snapshot.coverageEnd, end);
  const other = f.app.identity.createCustomer(f.actor, "other", {
    name: "New owner",
    tier: "standard",
    creditLimit: 1000000,
  }).id;
  const sale = ship(f, accept({ ...f, buyer: other }, 1, "resale").id);
  const coverage = f.app.warranty.coverage(f.actor, unitId, other);
  assert.equal(coverage.source, "shipment_policy");
  assert.equal(coverage.policy?.revision, 3);
  assert.equal(coverage.coverageEnd, "2024-03-30T12:00:00.000Z");
  assert.equal(coverage.shipmentId, sale.id);
  assert.deepEqual(
    f.app.warranty.claimCoverage(f.actor, original.id).snapshot?.policy,
    f.app.fulfillment.shipmentCoverage(f.actor, shipment.id)?.policy,
  );
  assert.throws(() => f.app.warranty.coverage(f.actor, unitId, f.buyer), {
    code: "NOT_FOUND",
  });
});

test("invalid current policy blocks a new handover before any native fact changes, but an already committed exact retry remains valid", (t) => {
  const f = fixture(t),
    completedOrder = accept(f),
    completed = ship(f, completedOrder.id),
    packed = pack(f, accept(f, 1, "second").id);
  f.app.database
    .owned("iam")
    .run("UPDATE iam_organizations SET policy='{}' WHERE id=?", f.actor.orgId);
  const before = facts(f);
  assert.throws(() =>
    f.app.fulfillment.commit(f.actor, "next-handover", {
      shipmentId: packed,
      handoverEvidence: "Synthetic handover",
    }),
  );
  assert.deepEqual(facts(f), before);
  assert.deepEqual(
    f.app.fulfillment.commit(f.actor, "ship" + completedOrder.id, {
      shipmentId: completed.id,
      handoverEvidence: "Synthetic test handover",
    }),
    completed,
  );
  assert.deepEqual(facts(f), before);
});

test("handover cached retries and coverage reads recheck actual warehouse access, active identity and password restrictions", (t) => {
  const f = fixture(t),
    warehouse = warrantyUser(f, "warehouse"),
    shipmentId = pack(f, accept(f).id),
    input = { shipmentId, handoverEvidence: "Synthetic handover" };
  f.app.fulfillment.commit(warehouse, "handover", input);
  for (const change of [
    { sites: [] },
    { sites: [f.w1], role: "support" },
    { sites: [f.w1], role: "warehouse", active: false },
  ]) {
    warrantyGrants(f, warehouse, change);
    const before = facts(f);
    assert.throws(() =>
      f.app.fulfillment.commit(
        { ...warehouse, role: "admin", sites: [f.w1] },
        "handover",
        input,
      ),
    );
    assert.throws(() =>
      f.app.fulfillment.shipmentCoverage(
        { ...warehouse, role: "admin", sites: [f.w1] },
        shipmentId,
      ),
    );
    assert.deepEqual(facts(f), before);
  }
  warrantyGrants(f, warehouse, {
    active: true,
    role: "warehouse",
    sites: [f.w1],
  });
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
      warehouse.id,
    );
  const before = facts(f);
  assert.throws(() => f.app.fulfillment.commit(warehouse, "handover", input), {
    code: "PASSWORD_CHANGE_REQUIRED",
  });
  assert.throws(
    () => f.app.fulfillment.shipmentCoverage(warehouse, shipmentId),
    { code: "PASSWORD_CHANGE_REQUIRED" },
  );
  assert.throws(() => f.app.identity.shipmentCoveragePolicy(warehouse, f.w1), {
    code: "PASSWORD_CHANGE_REQUIRED",
  });
  assert.deepEqual(facts(f), before);
});

test("zero-day retained policy and elapsed dates require review and never reject a claim automatically", (t) => {
  const f = fixture(t);
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(start) });
  configure(f, 0, 1, "zero");
  ship(f, accept(f).id);
  const unitId = f.app.inventory.trace(f.actor, "S1").unit.id;
  const coverage = f.app.warranty.coverage(f.actor, unitId, f.buyer);
  assert.equal(coverage.coverageEnd, start);
  assert.equal(coverage.datePosition, "elapsed");
  assert.equal(coverage.eligibility, "requires_review");
  configure(f, 365, 2, "later");
  const c = f.app.warranty.submit(f.actor, "elapsed", claim(f, unitId, 2));
  assert.equal(c.coverageEnd, start);
  assert.equal(f.app.warranty.claim(f.actor, c.id).state, "submitted");
});

test(
  "independent policy and handover processes retain one whole serialized policy with the shipment and its retry",
  { timeout: 10000 },
  async (t) => {
    const f = fixture(t),
      shipmentId = pack(f, accept(f).id);
    const operations: {
      actor: Actor;
      operation: "policy" | "ship";
      payload: unknown;
    }[] = [
      {
        actor: f.actor,
        operation: "policy",
        payload: {
          days: 730,
          revision: 1,
          reason: "Synthetic concurrent review",
        },
      },
      {
        actor: f.actor,
        operation: "ship",
        payload: {
          shipmentId,
          handoverEvidence: "Synthetic concurrent handover",
        },
      },
    ];
    const children: ChildProcess[] = [],
      ready: Promise<void>[] = [];
    const results = operations.map((op, i) => {
      const child = fork(
        new URL("./coverage-policy-child.ts", import.meta.url),
        [],
        {
          execArgv: ["--import", "tsx"],
          stdio: ["ignore", "ignore", "pipe", "ipc"],
        },
      );
      children.push(child);
      let markReady: () => void;
      ready.push(
        new Promise<void>((resolve) => {
          markReady = resolve;
        }),
      );
      const result = new Promise<any>((resolve, reject) => {
        let stderr = "";
        child.stderr?.on("data", (chunk) => {
          stderr += String(chunk);
        });
        child.on("message", (message: any) =>
          message.ready ? markReady() : resolve(message),
        );
        child.on("error", reject);
        child.on("exit", (code) => {
          if (code !== 0)
            reject(new Error(`Coverage child exit ${code}: ${stderr}`));
        });
      });
      child.send({
        action: "init",
        input: { path: f.path, key: `sale-race-${i}`, ...op },
      });
      return result;
    });
    t.after(() => children.forEach((child) => child.kill()));
    await Promise.all(ready);
    children.forEach((child) => child.send({ action: "go" }));
    const completed = await Promise.all(results);
    assert.ok(
      completed.every((r) => r.ok),
      JSON.stringify(completed),
    );
    const locked = f.app.fulfillment.shipmentCoverage(f.actor, shipmentId)!;
    assert.ok(
      (locked.policy.revision === 1 &&
        locked.policy.days === 365 &&
        locked.policy.configuredAt === null) ||
        (locked.policy.revision === 2 &&
          locked.policy.days === 730 &&
          locked.policy.configuredAt !== null),
    );
    assert.equal(
      Date.parse(locked.coverageEnd) - Date.parse(locked.shippedAt),
      locked.policy.days * 86400000,
    );
    assert.equal(f.app.identity.coveragePolicy(f.actor).revision, 2);
    const before = facts(f);
    assert.deepEqual(
      f.app.fulfillment.commit(
        f.actor,
        "sale-race-1",
        operations[1]!.payload as Parameters<
          typeof f.app.fulfillment.commit
        >[2],
      ),
      completed[1].result,
    );
    assert.deepEqual(facts(f), before);
  },
);
