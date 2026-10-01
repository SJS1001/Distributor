import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { fixture } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import { digest, type Actor } from "../src/server/core.ts";

function source(f: ReturnType<typeof fixture>, batchRef = "OPEN-1") {
  for (const [sku, serialized] of [
    ["OPEN-S", true],
    ["OPEN-B", false],
  ] as const)
    f.app.catalog.create(f.actor, sku, {
      sku,
      name: `Synthetic ${sku}`,
      serialized,
      unitPrice: 10000,
      taxBasisPoints: 1300,
    });
  return {
    version: 1 as const,
    batchRef,
    sourceRef: "SYNTHETIC-CUTOFF",
    sourceHash: digest("Independent synthetic opening source"),
    cutoffAt: "2026-09-01T00:00:00.000Z",
    region: "CA" as const,
    currency: "CAD" as const,
    expectedQuantity: 6,
    expectedValue: 16000,
    acknowledgment:
      "Synthetic fixture rights; stock custody frozen at cutoff; exact SKU/site mapping and source totals reviewed",
    rows: [
      {
        sourceId: "S-A",
        sku: "OPEN-S",
        warehouse: "Toronto",
        bin: "A-1",
        serial: "OPEN-S1",
        quantity: 1,
        unitCost: 6000,
        condition: "usable",
      },
      {
        sourceId: "S-B",
        sku: "OPEN-S",
        warehouse: "Toronto",
        bin: "A-1",
        serial: "OPEN-S2",
        quantity: 1,
        unitCost: 6000,
        condition: "usable",
      },
      {
        sourceId: "B-A",
        sku: "OPEN-B",
        warehouse: "Toronto",
        bin: "B-1",
        serial: null,
        quantity: 3,
        unitCost: 1000,
        condition: "usable",
      },
      {
        sourceId: "B-B",
        sku: "OPEN-B",
        warehouse: "Ottawa",
        bin: "Q-1",
        serial: null,
        quantity: 1,
        unitCost: 1000,
        condition: "quarantine",
      },
    ],
  };
}
function approved(batch: { id: string; reviewHash: string }) {
  return {
    batchId: batch.id,
    reviewHash: batch.reviewHash,
    decision: "approve" as const,
    reason: "Independent synthetic quantity/cost and rights review",
  };
}
function imported(f: ReturnType<typeof fixture>) {
  return f.app.inventory
    .stock(f.actor)
    .filter((u) =>
      f.app.catalog.product(f.actor, u.product_id).sku.startsWith("OPEN-"),
    );
}

test("opening dry runs remain immutable and stock-free; reviewed serial/bulk mapping preserves exact original costs and idempotent custody through restart", (t) => {
  const f = fixture(t),
    input = source(f);
  const batch = f.app.migration.preview(f.actor, "dry-run", input);
  assert.equal(imported(f).length, 0);
  assert.equal(f.app.migration.list(f.actor)[0]!.state, "ready");
  const report = f.app.migration.list(f.actor)[0]!.report;
  assert.deepEqual(
    [report.quantity, report.value, report.issues.length],
    [6, 16000, 0],
  );
  assert.deepEqual(report.bySite, [
    { warehouseId: f.w1, quantity: 5, value: 15000 },
    { warehouseId: f.w2, quantity: 1, value: 1000 },
  ]);
  assert.deepEqual(
    f.app.migration.preview(f.actor, "other-preview", {
      ...input,
      batchRef: " OPEN-1 ",
    }),
    batch,
  );
  assert.throws(
    () =>
      f.app.migration.preview(f.actor, "different-input", {
        ...input,
        expectedValue: 16001,
      }),
    { code: "RECEIPT_CONFLICT" },
  );
  const decision = approved(batch);
  const result = f.app.migration.decide(f.actor, "approve", decision);
  assert.deepEqual(
    [result.quantity, result.value, result.mappings.length],
    [6, 16000, 4],
  );
  assert.equal(
    imported(f).reduce((s, u) => s + u.quantity, 0),
    6,
  );
  assert.equal(
    imported(f).reduce((s, u) => s + u.quantity * u.cost, 0),
    16000,
  );
  assert.equal(
    imported(f).reduce((s, u) => s + u.available, 0),
    5,
  );
  assert.equal(f.app.procurement.orders(f.actor).length, 1);
  assert.equal(f.app.billing.invoices(f.actor).length, 0);
  for (const unit of imported(f))
    assert.equal(f.app.inventory.purchaseOrigin(f.actor, unit.id), null);
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(
    f.app.migration.decide(f.actor, "approve", decision),
    result,
  );
  assert.deepEqual(
    f.app.migration.decide(
      { ...f.actor, id: "another-admin" },
      "new-review-key",
      { ...decision, reason: ` ${decision.reason} ` },
    ),
    result,
  );
  assert.throws(
    () =>
      f.app.migration.decide(f.actor, "change-decision", {
        ...decision,
        decision: "reject",
      }),
    { code: "RECEIPT_CONFLICT" },
  );
  const movements = f.app.database
    .owned("inventory")
    .all("SELECT * FROM inventory_movements WHERE type='opening'");
  assert.equal(movements.length, 4);
  assert.equal(
    f.app.database
      .owned("migration")
      .all("SELECT * FROM migration_opening_sources").length,
    4,
  );
  assert.throws(
    () =>
      f.app.database.owned("migration").all("SELECT * FROM inventory_units"),
    /prohibited|not authorized/,
  );
});

test("a late source mapping failure rolls back the entire opening batch and preserves its review for a safe retry", (t) => {
  const f = fixture(t),
    input = source(f),
    batch = f.app.migration.preview(f.actor, "dry-run", input),
    store = f.app.database.owned("migration");
  store.migrate(
    `CREATE TRIGGER migration_test_reject BEFORE INSERT ON migration_opening_sources WHEN NEW.source_id='B-B' BEGIN SELECT RAISE(ABORT,'Synthetic late source mapping failure'); END;`,
  );
  assert.throws(
    () => f.app.migration.decide(f.actor, "approval", approved(batch)),
    /Synthetic late source mapping failure/,
  );
  assert.equal(imported(f).length, 0);
  assert.equal(store.all("SELECT * FROM migration_opening_sources").length, 0);
  assert.equal(
    f.app.database
      .owned("inventory")
      .all("SELECT * FROM inventory_movements WHERE type='opening'").length,
    0,
  );
  assert.equal(f.app.migration.list(f.actor)[0]!.state, "ready");
  assert.equal(f.app.migration.list(f.actor)[0]!.result, null);
  store.migrate("DROP TRIGGER migration_test_reject");
  const result = f.app.migration.decide(f.actor, "approval", approved(batch));
  assert.deepEqual(
    [result.quantity, result.value, result.mappings.length],
    [6, 16000, 4],
  );
});

test("row rejects and independent total mismatches block the whole batch; correction retains original rejected evidence", (t) => {
  const f = fixture(t),
    input = source(f);
  const bad = {
    ...input,
    batchRef: "BAD-1",
    rows: [
      input.rows[0],
      { ...input.rows[1], sourceId: "S-A", serial: "OPEN-S1" },
      { ...input.rows[2], quantity: 1.5 },
      { ...input.rows[3], warehouse: "Foreign warehouse" },
      { ...input.rows[3], supplierId: "invented" },
      null,
      { ...input.rows[3], sourceId: "BAD-CONDITION", condition: ["usable"] },
    ],
  };
  const preview = f.app.migration.preview(f.actor, "bad", bad),
    report = f.app.migration.list(f.actor)[0]!.report;
  assert.equal(f.app.migration.list(f.actor)[0]!.state, "blocked");
  for (const code of [
    "DUPLICATE_SOURCE_ROW",
    "DUPLICATE_SERIAL",
    "VALIDATION",
    "NOT_FOUND",
    "RECONCILIATION",
  ])
    assert.ok(
      report.issues.some((i) => i.code === code),
      code,
    );
  assert.equal(report.rows.length, 7);
  assert.equal(report.rows[6]!.issues[0]!.code, "VALIDATION");
  assert.throws(
    () => f.app.migration.decide(f.actor, "approve-bad", approved(preview)),
    { code: "IMPORT_REJECTS" },
  );
  assert.equal(imported(f).length, 0);
  f.app.migration.decide(f.actor, "reject-bad", {
    ...approved(preview),
    decision: "reject",
  });
  const mismatch = f.app.migration.preview(f.actor, "mismatch", {
    ...input,
    batchRef: "MISMATCH",
    expectedValue: 16001,
  });
  assert.throws(
    () =>
      f.app.migration.decide(f.actor, "approve-mismatch", approved(mismatch)),
    { code: "IMPORT_REJECTS" },
  );
  const corrected = f.app.migration.preview(f.actor, "corrected", {
    ...input,
    batchRef: "CORRECTED",
  });
  f.app.migration.decide(f.actor, "approve-corrected", approved(corrected));
  assert.equal(
    f.app.migration.list(f.actor).find((b) => b.id === preview.id)!.state,
    "rejected",
  );
  assert.equal(
    imported(f).reduce((s, u) => s + u.quantity * u.cost, 0),
    16000,
  );
});

test("opening approvals recheck cutoff custody atomically and deny stale fingerprints, roles, organizations and reused source identities", (t) => {
  const f = fixture(t),
    input = source(f),
    batch = f.app.migration.preview(f.actor, "preview", input);
  const warehouse: Actor = { ...f.actor, role: "warehouse", sites: [f.w1] };
  assert.throws(() => f.app.migration.list(warehouse), { code: "FORBIDDEN" });
  assert.throws(() => f.app.migration.preview(warehouse, "preview", input), {
    code: "FORBIDDEN",
  });
  assert.throws(
    () => f.app.migration.decide(warehouse, "decision", approved(batch)),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () =>
      f.app.migration.decide(
        { ...f.actor, orgId: "other" },
        "decision",
        approved(batch),
      ),
    { code: "NOT_FOUND" },
  );
  assert.throws(
    () =>
      f.app.migration.decide(f.actor, "wrong-hash", {
        ...approved(batch),
        reviewHash: "wrong",
      }),
    { code: "REVIEW_CHANGED" },
  );
  const concurrent = f.app.migration.preview(f.actor, "other-opening", {
    ...input,
    batchRef: "OTHER",
  });
  f.app.migration.decide(f.actor, "commit-other", approved(concurrent));
  assert.throws(
    () => f.app.migration.decide(f.actor, "commit-old", approved(batch)),
    { code: "IMPORT_STALE" },
  );
  assert.equal(
    imported(f).reduce((s, u) => s + u.quantity, 0),
    6,
  );
  const used = f.app.migration.preview(f.actor, "reuse-source", {
    ...input,
    batchRef: "REUSE",
    expectedQuantity: 1,
    expectedValue: 6000,
    rows: [
      { ...input.rows[0], warehouse: "Ottawa", serial: "DIFFERENT-SERIAL" },
    ],
  });
  assert.ok(
    f.app.migration
      .list(f.actor)
      .find((b) => b.id === used.id)!
      .report.issues.some((i) => i.code === "SOURCE_ALREADY_APPLIED"),
  );
  assert.throws(
    () =>
      f.app.migration.decide(warehouse, "commit-other", approved(concurrent)),
    { code: "FORBIDDEN" },
  );
});

async function compete(
  t: { after: (fn: () => void) => void },
  f: ReturnType<typeof fixture>,
  batches: { id: string; reviewHash: string }[],
) {
  const children = batches.map(() =>
    fork(new URL("./migration-child.ts", import.meta.url), {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    }),
  );
  t.after(() => children.forEach((c) => c.kill()));
  const replies = children.map(
    (child, i) =>
      new Promise<any>((resolve, reject) => {
        let ready = false;
        child.on("message", (m: any) => {
          if (m.ready) {
            ready = true;
            resolve(m);
          }
        });
        child.on("error", reject);
        child.on("exit", (code) => {
          if (!ready) reject(new Error(`Import child exited ${code}`));
        });
        child.send({
          action: "init",
          input: {
            path: f.path,
            actor: { ...f.actor, id: `reviewer-${i}` },
            key: `review-${i}`,
            payload: approved(batches[i]!),
          },
        });
      }),
  );
  await Promise.all(replies);
  const outcomes = children.map(
    (child) =>
      new Promise<any>((resolve, reject) => {
        child.once("message", resolve);
        child.once("error", reject);
      }),
  );
  children.forEach((c) => c.send({ action: "go" }));
  return Promise.all(outcomes);
}
test("separate processes reviewing overlapping opening batches serialize with one application; identical reviews preserve one set of custody mappings", async (t) => {
  const f = fixture(t),
    input = source(f);
  const a = f.app.migration.preview(f.actor, "preview-a", input),
    b = f.app.migration.preview(f.actor, "preview-b", {
      ...input,
      batchRef: "OPEN-2",
    });
  const outcomes = await compete(t, f, [a, b]);
  assert.equal(outcomes.filter((o) => o.ok).length, 1);
  assert.equal(outcomes.find((o) => !o.ok).code, "IMPORT_STALE");
  const winner = outcomes.find((o) => o.ok).result;
  const batch = winner.id === a.id ? a : b;
  const replay = await compete(t, f, [batch, batch]);
  assert.ok(replay.every((o) => o.ok));
  assert.deepEqual(replay[0].result, replay[1].result);
  assert.equal(
    imported(f).reduce((s, u) => s + u.quantity * u.cost, 0),
    16000,
  );
  assert.equal(
    f.app.database
      .owned("migration")
      .all("SELECT * FROM migration_opening_sources").length,
    4,
  );
});

test("opening manifest rejects region/currency/version/size and source claims before creating a batch", (t) => {
  const f = fixture(t),
    input = source(f);
  for (const change of [
    { region: "US" },
    { currency: "USD" },
    { version: 2 },
    { sourceHash: "not-a-hash" },
    { cutoffAt: "2999-01-01T00:00:00.000Z" },
    { cutoffAt: "2026-02-30T00:00:00.000Z" },
    { expectedValue: 1.5 },
    { rows: [] },
    { rows: Array(501).fill(input.rows[0]) },
  ]) {
    assert.throws(() =>
      f.app.migration.preview(f.actor, "bad-manifest", {
        ...input,
        ...change,
      } as any),
    );
  }
  assert.equal(f.app.migration.list(f.actor).length, 0);
  assert.equal(imported(f).length, 0);
});

test("HTTP opening import retains row rejects, strict envelope and reviewed retry authority", async (t) => {
  const f = fixture(t),
    input = source(f),
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
      "idempotency-key": "opening-http",
    };
  const preview = await http.inject({
    method: "POST",
    url: "/api/commands/import.opening.preview",
    headers,
    payload: input,
  });
  assert.equal(preview.statusCode, 200);
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: "/api/commands/import.opening.preview",
        headers,
        payload: { ...input, approvedBy: "injected" },
      })
    ).statusCode,
    400,
  );
  const decision = approved(preview.json()),
    approve = await http.inject({
      method: "POST",
      url: "/api/commands/import.opening.decide",
      headers,
      payload: decision,
    });
  assert.equal(approve.statusCode, 200);
  assert.deepEqual(
    (
      await http.inject({
        method: "POST",
        url: "/api/commands/import.opening.decide",
        headers,
        payload: decision,
      })
    ).json(),
    approve.json(),
  );
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_users SET role='warehouse',sites=? WHERE id=?",
      JSON.stringify([f.w1]),
      f.actor.id,
    );
  assert.equal(
    (await http.inject({ url: "/api/imports/opening", headers })).statusCode,
    403,
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: "/api/commands/import.opening.decide",
        headers,
        payload: decision,
      })
    ).statusCode,
    403,
  );
});
