import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fixture } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { canonical, digest, type Actor } from "../src/server/core.ts";
import type { QuantityCorrection } from "../src/server/inventory-quantity-corrections.ts";

type Fixture = ReturnType<typeof fixture>;
function finance(f: Fixture, name: string) {
  const u = f.app.identity.createUser(f.actor, name, {
    email: `${name}@example.test`,
    name,
    role: "finance",
    sites: [f.w1],
    password: "long-test-only-password",
  });
  return f.app.identity.currentActor({ ...f.actor, id: u.id });
}
function setup(t: Parameters<typeof fixture>[0], region: "CA" | "US" = "CA") {
  const f = fixture(t, {}, region),
    preparer = finance(f, "preparer"),
    reviewer = finance(f, "reviewer");
  const productId = f.app.catalog.create(f.actor, "boundary-product", {
    sku: "BOUNDARY-BULK",
    name: "Synthetic bulk",
    serialized: false,
    unitPrice: 2500,
    taxBasisPoints: 0,
  }).id;
  const poId = f.app.procurement.create(f.actor, "boundary-po", {
    supplierId: f.supplier,
    warehouseId: f.w1,
    lines: [{ productId, quantity: 6, unitCost: 1000 }],
  }).id;
  const line = f.app.procurement.orders(f.actor).find((p) => p.id === poId)!
    .lines[0]!;
  f.app.procurement.receive(f.actor, "boundary-receipt", {
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
  f.app.inventory.valuations.configure(f.actor, "boundary-policy", {
    productId,
    previousRevision: 0,
    policyVersion: "synthetic-1",
    establishedBasis: "Synthetic established basis",
    establishedMethod: "fifo-receipt-layers",
    effectiveFrom: "2026-01-01",
    closedThrough: "2026-08-31",
    financeEvidence: "Synthetic accountant evidence",
  });
  const source = f.app.database
    .owned("inventory")
    .get<{ id: string }>(
      "SELECT id FROM inventory_movements WHERE org_id=? AND unit_id=? AND type='receipt'",
      f.actor.orgId,
      unit.id,
    )!.id;
  return { f, preparer, reviewer, unit, source, region };
}
type Setup = ReturnType<typeof setup>;
function input(
  s: Setup,
  targetQuantity = 4,
  reference = "BOUNDARY-1",
  sourceMovementId = s.source,
) {
  const review = s.f.app.inventory.quantityCorrections.review(
    s.preparer,
    s.unit.id,
    sourceMovementId,
  );
  return {
    unitId: s.unit.id,
    sourceMovementId,
    reviewHash: review.reviewHash,
    reference,
    targetQuantity,
    postingDate: "2026-10-01",
    reason: "Synthetic quantity error",
    physicalEvidence: "Synthetic recount",
    accountantEvidence: "Synthetic open-period classification",
  };
}
const decision = (p: QuantityCorrection) => ({
  correctionId: p.id,
  reviewHash: p.reviewHash,
  decision: "approve" as const,
  reason: "Synthetic separate review",
});
function approve(s: Setup, target = 4, ref = "BOUNDARY-1", source = s.source) {
  const q = s.f.app.inventory.quantityCorrections,
    body = input(s, target, ref, source),
    p = q.prepare(s.preparer, ref, body);
  return { body, p, a: q.decide(s.reviewer, ref, decision(p)) };
}
function valued(s: Setup) {
  const v = s.f.app.inventory.valuations,
    review = v.review(s.preparer, s.unit.id);
  const p = v.prepare(s.preparer, "write-down", {
    unitId: s.unit.id,
    reviewHash: review.reviewHash,
    reference: "SYNTHETIC-VALUE",
    kind: "write-down",
    targetValue: 4001,
    postingDate: "2026-10-01",
    reason: "Synthetic value",
    evidence: "Synthetic recoverable value",
    accountantEvidence: "Synthetic established basis",
  });
  v.decide(s.reviewer, "write-down", {
    valuationId: p.id,
    reviewHash: p.reviewHash,
    decision: "approve",
    reason: "Synthetic separate review",
  });
}
// Capture every business row, including clocks, effects, audit and exact receipts.
function rows(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return canonical(
      db
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all()
        .map((r) => [
          r.name,
          db
            .prepare(
              `SELECT * FROM "${String(r.name).replaceAll('"', '""')}" ORDER BY rowid`,
            )
            .all(),
        ]),
    );
  } finally {
    db.close();
  }
}

for (const corruption of [
  "delta",
  "orphaned predecessor",
  "missing carrying effect",
] as const)
  for (const read of ["get", "history"] as const)
    test(`${read} refuses ${corruption} behind a retained approval`, (t) => {
      const s = setup(t),
        q = s.f.app.inventory.quantityCorrections,
        store = s.f.app.database.owned("inventory");
      if (corruption === "missing carrying effect") valued(s);
      const first = approve(s);
      let selected = first.a;
      if (corruption === "delta") {
        const changed = { ...first.a, valueDelta: first.a.valueDelta! + 1 };
        store.run(
          "UPDATE inventory_quantity_corrections SET record=?,hash=? WHERE id=?",
          canonical(changed),
          digest(canonical(changed)),
          first.a.id,
        );
      } else if (corruption === "orphaned predecessor") {
        selected = approve(s, 3, "BOUNDARY-2", first.a.movement!.id).a;
        store.run(
          "DELETE FROM inventory_quantity_corrections WHERE id=?",
          first.a.id,
        );
      } else {
        store.run(
          "DELETE FROM inventory_value_effects WHERE movement_id=?",
          first.a.movement!.id,
        );
      }
      const cutoff = s.f.app.database
        .owned("inventory")
        .get<{ n: number }>(
          "SELECT MAX(sequence) n FROM inventory_cost_sequences",
        )!.n;
      assert.throws(() => s.f.app.inventory.costs.window(s.f.actor, cutoff));
      const before = rows(s.f.path);
      assert.throws(
        () =>
          read === "get"
            ? q.get(s.reviewer, selected.id)
            : q.history(s.reviewer, s.unit.id),
        (e: unknown) =>
          !!e &&
          typeof e === "object" &&
          "code" in e &&
          ["QUANTITY_INTEGRITY", "VALUATION_INTEGRITY"].includes(
            String(e.code),
          ),
      );
      if (read === "history")
        assert.throws(
          () => q.history(s.reviewer, s.unit.id, selected.id),
          "an empty continuation must still validate prior evidence",
        );
      assert.equal(
        rows(s.f.path),
        before,
        "refused read must not repair or erase evidence",
      );
    });

for (const boundary of ["receipt", "audit"] as const)
  test(`late ${boundary} failure rolls back the complete valued correction and permits exact retry`, (t) => {
    const s = setup(t);
    valued(s);
    const q = s.f.app.inventory.quantityCorrections,
      p = q.prepare(s.preparer, "prepare", input(s)),
      before = rows(s.f.path);
    const platform = s.f.app.database.owned("platform"),
      table = boundary === "receipt" ? "platform_commands" : "platform_audit",
      field = boundary === "receipt" ? "name" : "action";
    platform.migrate(
      `CREATE TRIGGER platform_quantity_test_fault BEFORE INSERT ON ${table} WHEN NEW.${field}='inventory.quantity.decide' BEGIN SELECT RAISE(ABORT,'synthetic late quantity fault'); END;`,
    );
    try {
      assert.throws(
        () => q.decide(s.reviewer, "decision", decision(p)),
        /synthetic late quantity fault/,
      );
      assert.equal(rows(s.f.path), before);
    } finally {
      platform.migrate("DROP TRIGGER platform_quantity_test_fault");
    }
    const a = q.decide(s.reviewer, "decision", decision(p));
    assert.equal(a.valueDelta, -1333);
    assert.equal(s.f.app.inventory.unit(s.f.actor, s.unit.id).quantity, 4);
    assert.equal(
      canonical(q.decide(s.reviewer, "decision", decision(p))),
      canonical(a),
    );
    assert.equal(q.history(s.reviewer, s.unit.id).items.length, 1);
  });

for (const region of ["CA", "US"] as const)
  test(`${region} successive valued corrections conserve acquisition and retained approvals through zero and restart`, (t) => {
    const s = setup(t, region);
    valued(s);
    const original = canonical(
      s.f.app.database
        .owned("inventory")
        .get("SELECT * FROM inventory_movements WHERE id=?", s.source),
    );
    const retained: ReturnType<typeof approve>[] = [];
    let source = s.source;
    // The established carrying basis is 4001/6; rounding remains in the layer.
    for (const [target, delta, value] of [
      [4, -1333, 2668],
      [7, 2000, 4668],
      [0, -4668, 0],
      [3, 2000, 2000],
      [1, -1333, 667],
    ] as const) {
      const r = approve(s, target, `CHAIN-${retained.length}`, source);
      retained.push(r);
      source = r.a.movement!.id;
      assert.equal(r.a.valueDelta, delta);
      assert.equal(
        s.f.app.inventory.unit(s.f.actor, s.unit.id).quantity,
        target,
      );
      assert.equal(s.f.app.inventory.unit(s.f.actor, s.unit.id).cost, 1000);
      assert.equal(
        s.f.app.inventory.costs.window(s.f.actor, 0).closingValue,
        18000 + value,
      );
    }
    s.f.app.close();
    s.f.app = new Application(s.f.path, region);
    const q = s.f.app.inventory.quantityCorrections;
    assert.equal(
      canonical(
        s.f.app.database
          .owned("inventory")
          .get("SELECT * FROM inventory_movements WHERE id=?", s.source),
      ),
      original,
    );
    for (let i = 0; i < retained.length; i++) {
      const r = retained[i]!;
      assert.equal(canonical(q.get(s.reviewer, r.a.id)), canonical(r.a));
      assert.equal(
        canonical(q.prepare(s.preparer, `CHAIN-${i}`, r.body)),
        canonical(r.p),
      );
      assert.equal(
        canonical(q.decide(s.reviewer, `CHAIN-${i}`, decision(r.p))),
        canonical(r.a),
      );
    }
    assert.equal(
      canonical(q.history(s.reviewer, s.unit.id).items),
      canonical(retained.map((r) => r.a)),
    );
  });

for (const boundary of [
  "site",
  "role",
  "inactive",
  "password",
  "customer",
] as const)
  test(`cached preparation rechecks ${boundary} despite forged captured grants`, (t) => {
    const s = setup(t),
      q = s.f.app.inventory.quantityCorrections,
      body = input(s);
    q.prepare(s.preparer, "cached", body);
    const iam = s.f.app.database.owned("iam");
    if (boundary === "site")
      iam.run(
        "UPDATE iam_users SET sites=? WHERE id=?",
        JSON.stringify([s.f.w2]),
        s.preparer.id,
      );
    if (boundary === "role")
      iam.run(
        "UPDATE iam_users SET role='warehouse' WHERE id=?",
        s.preparer.id,
      );
    if (boundary === "inactive")
      iam.run("UPDATE iam_users SET active=0 WHERE id=?", s.preparer.id);
    if (boundary === "password")
      iam.run(
        "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
        s.preparer.id,
      );
    if (boundary === "customer")
      iam.run(
        "UPDATE iam_users SET account_id=? WHERE id=?",
        s.f.buyer,
        s.preparer.id,
      );
    const before = rows(s.f.path);
    assert.throws(
      () =>
        q.prepare(
          { ...s.preparer, role: "admin", sites: [s.f.w1], accountId: null },
          "cached",
          body,
        ),
      {
        code:
          boundary === "password" ? "PASSWORD_CHANGE_REQUIRED" : "FORBIDDEN",
      },
    );
    assert.equal(rows(s.f.path), before);
  });

test("organization/principal receipt keys never grant another principal the prepared or approved result", (t) => {
  const s = setup(t),
    q = s.f.app.inventory.quantityCorrections,
    r = approve(s),
    third = finance(s.f, "third"),
    foreign = setup(t);
  const before = rows(s.f.path);
  for (const actor of [
    foreign.preparer,
    { ...s.preparer, orgId: foreign.preparer.orgId },
    { ...foreign.preparer, orgId: s.preparer.orgId },
  ]) {
    assert.throws(() => q.prepare(actor, "BOUNDARY-1", r.body), {
      code: "FORBIDDEN",
    });
    assert.throws(() => q.decide(actor, "BOUNDARY-1", decision(r.p)), {
      code: "FORBIDDEN",
    });
    assert.throws(() => q.get(actor, r.p.id), { code: "FORBIDDEN" });
  }
  assert.throws(() => q.prepare(third, "BOUNDARY-1", r.body), {
    code: "QUANTITY_STALE",
  });
  assert.throws(() => q.decide(third, "BOUNDARY-1", decision(r.p)), {
    code: "QUANTITY_STATE",
  });
  assert.throws(() => q.decide(s.preparer, "BOUNDARY-1", decision(r.p)), {
    code: "QUANTITY_STATE",
  });
  assert.equal(rows(s.f.path), before);
});

// Independent OS processes/SQLite connections rendezvous after opening, then race
// real public commands. Each child has a bounded lifetime and is reaped before return.
async function race(
  s: Setup,
  jobs: {
    actor: Actor;
    operation: "prepare" | "decide" | "accept";
    key: string;
    input: unknown;
  }[],
) {
  const script = `
    import { Application } from './src/server/application.ts';
    const [path,region,jobText]=process.argv.slice(1), job=JSON.parse(jobText);
    const app=new Application(path,region);
    process.send({ready:true});
    process.once('message',()=>{
      try {const owner=job.operation==='accept'?app.orders:app.inventory.quantityCorrections;
        process.send({result:owner[job.operation](job.actor,job.key,job.input)});
      } catch(e) {process.send({error:e.code??String(e)});}
      finally {app.close();process.disconnect();}
    });`;
  const children = jobs.map((job) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        script,
        s.f.path,
        s.region,
        JSON.stringify(job),
      ],
      { cwd: process.cwd(), stdio: ["ignore", "ignore", "pipe", "ipc"] },
    );
    let stderr = "",
      answer: { result?: QuantityCorrection; error?: string } | undefined;
    child.stderr!.on("data", (data) => {
      stderr += String(data);
    });
    let ready!: () => void;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    child.on(
      "message",
      (m: { ready?: boolean; result?: QuantityCorrection; error?: string }) => {
        if (m.ready) ready();
        else answer = m;
      },
    );
    const done = new Promise<{ result?: QuantityCorrection; error?: string }>(
      (resolve, reject) => {
        child.on("error", reject);
        child.on("exit", (code) => {
          ready();
          code === 0 && answer
            ? resolve(answer)
            : reject(Error(`child ${code}: ${stderr}`));
        });
      },
    );
    return { child, started, done };
  });
  const deadline = setTimeout(
    () => children.forEach((c) => c.child.kill("SIGKILL")),
    15000,
  );
  try {
    await Promise.all(children.map((c) => c.started));
    for (const c of children) if (c.child.connected) c.child.send("go");
    return await Promise.all(children.map((c) => c.done));
  } finally {
    clearTimeout(deadline);
    for (const c of children)
      if (c.child.exitCode === null) c.child.kill("SIGKILL");
    await Promise.allSettled(children.map((c) => c.done));
  }
}
for (const sameReference of [true, false])
  test(`two connections race ${sameReference ? "the permanent reference" : "the pending slot"} with one retained winner`, async (t) => {
    const s = setup(t),
      body = input(s),
      q = s.f.app.inventory.quantityCorrections;
    const results = await race(
      s,
      [s.preparer, s.reviewer].map((actor, i) => ({
        actor,
        operation: "prepare",
        key: `race-${i}`,
        input: {
          ...body,
          reference: sameReference ? body.reference : `RACE-${i}`,
        },
      })),
    );
    assert.equal(results.filter((r) => r.result).length, 1);
    assert.deepEqual(
      results.filter((r) => r.error).map((r) => r.error),
      [sameReference ? "QUANTITY_REFERENCE" : "QUANTITY_PENDING"],
    );
    const p = results.find((r) => r.result)!.result!;
    assert.equal(
      canonical(q.history(s.preparer, s.unit.id).items),
      canonical([p]),
    );
    assert.equal(s.f.app.inventory.unit(s.f.actor, s.unit.id).quantity, 6);
    q.decide(
      p.createdBy === s.preparer.id ? s.reviewer : s.preparer,
      "reject-winner",
      { ...decision(p), decision: "reject" },
    );
    assert.throws(
      () =>
        q.prepare(s.preparer, "reuse-ref", { ...body, reference: p.reference }),
      { code: "QUANTITY_REFERENCE" },
    );
  });

test("two connections race approval against reservation without consuming allocated stock", async (t) => {
  const s = setup(t),
    q = s.f.app.inventory.quantityCorrections,
    p = q.prepare(s.preparer, "prepare", input(s));
  const cart = s.f.app.orders.saveCart(s.f.actor, "cart", {
    accountId: s.f.buyer,
    warehouseId: s.f.w1,
    revision: 0,
    lines: [{ productId: s.unit.product_id, quantity: 5 }],
  });
  const quote = s.f.app.orders.quote(s.f.actor, "quote", {
    cartId: cart.id,
    revision: cart.revision,
  });
  const results = await race(s, [
    {
      actor: s.reviewer,
      operation: "decide",
      key: "decision",
      input: decision(p),
    },
    {
      actor: s.f.actor,
      operation: "accept",
      key: "accept",
      input: { quoteId: quote.id, allowBackorder: false },
    },
  ]);
  assert.equal(results.filter((r) => r.result).length, 1);
  const stock = s.f.app.inventory.unit(s.f.actor, s.unit.id),
    review = q.review(s.preparer, s.unit.id, s.source);
  assert.ok(stock.quantity >= review.reserved);
  if (results[0]!.error) {
    assert.equal(results[0]!.error, "QUANTITY_STALE");
    assert.equal(stock.quantity, 6);
    assert.equal(review.reserved, 5);
    assert.equal(q.get(s.reviewer, p.id).state, "ready");
  } else {
    assert.equal(stock.quantity, 4);
    assert.equal(review.reserved, 0);
    assert.ok(results[1]!.error);
    assert.equal(q.get(s.reviewer, p.id).state, "reviewed");
  }
  s.f.app.inventory.costs.window(s.f.actor, 0);
});

test("rehashed decision identity cannot claim another finance principal's physical effect", (t) => {
  const s = setup(t),
    q = s.f.app.inventory.quantityCorrections,
    r = approve(s),
    third = finance(s.f, "alternate-reviewer");
  const changed = { ...r.a, decision: { ...r.a.decision!, by: third.id } };
  s.f.app.database
    .owned("inventory")
    .run(
      "UPDATE inventory_quantity_corrections SET record=?,hash=? WHERE id=?",
      canonical(changed),
      digest(canonical(changed)),
      r.a.id,
    );
  const before = rows(s.f.path);
  for (const read of [
    () => q.get(s.reviewer, r.a.id),
    () => q.history(s.reviewer, s.unit.id),
    () => q.decide(s.reviewer, "BOUNDARY-1", decision(r.p)),
  ])
    assert.throws(read, { code: "QUANTITY_INTEGRITY" });
  assert.equal(rows(s.f.path), before);
});
