import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { chooseProviders, fixture } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import { createBackup, restoreBackup } from "../src/server/recovery.ts";
import { digest } from "../src/server/core.ts";
import type { MasterInput } from "../src/server/master-imports.ts";

function source(
  kind: MasterInput["kind"] = "customer",
  batchRef = "MASTER-1",
): MasterInput {
  return {
    kind,
    version: 1,
    batchRef,
    sourceRef: "SYNTHETIC-MASTER-CUTOFF",
    sourceHash: digest("Independent synthetic master source"),
    cutoffAt: "2026-09-01T00:00:00.000Z",
    region: "CA",
    currency: "CAD",
    expectedQuantity: 2,
    expectedValue: kind === "customer" ? 300000 : 12000,
    acknowledgment:
      "Synthetic fixture only: source rights, independent controls, fields and cutoff reviewed",
    rows:
      kind === "customer"
        ? [
            {
              sourceId: "C-1",
              targetId: null,
              name: "Imported customer A",
              tier: "standard",
              creditLimit: 100000,
              held: false,
            },
            {
              sourceId: "C-2",
              targetId: null,
              name: "Imported customer B",
              tier: "trade",
              creditLimit: 200000,
              held: true,
            },
          ]
        : [
            {
              sourceId: "P-1",
              targetId: null,
              sku: "MASTER-S",
              name: "Imported serial product",
              serialized: true,
              unitPrice: 10000,
              taxBasisPoints: 1300,
            },
            {
              sourceId: "P-2",
              targetId: null,
              sku: "MASTER-B",
              name: "Imported bulk product",
              serialized: false,
              unitPrice: 2000,
              taxBasisPoints: 0,
            },
          ],
  };
}
function approved(b: { id: string; reviewHash: string }) {
  return {
    batchId: b.id,
    reviewHash: b.reviewHash,
    decision: "approve" as const,
    reason: "Independent master source/fields/control review",
  };
}
function customerMatch(
  f: ReturnType<typeof fixture>,
  batchRef = "MATCH",
): MasterInput {
  return {
    ...source("customer", batchRef),
    expectedQuantity: 1,
    expectedValue: 1000000,
    rows: [
      {
        sourceId: "MATCH-C",
        targetId: f.buyer,
        name: "Synthetic buyer",
        tier: "standard",
        creditLimit: 1000000,
        held: false,
      },
    ],
  };
}
test("customer and catalog dry runs are immutable; atomic creation preserves independent controls, strict residency and durable mappings through restart", (t) => {
  const f = fixture(t),
    before = f.app.dashboard(f.actor),
    users = f.app.database.owned("iam").all("SELECT id FROM iam_users");
  for (const kind of ["customer", "catalog"] as const) {
    const input = source(kind, kind),
      batch = f.app.migration.masters.preview(f.actor, kind, input);
    const saved = f.app.migration.masters
      .list(f.actor)
      .find((b) => b.id === batch.id)!;
    assert.deepEqual(
      [
        saved.report.quantity,
        saved.report.value,
        saved.report.creates,
        saved.report.matches,
        saved.report.issues.length,
      ],
      [2, input.expectedValue, 2, 0, 0],
    );
    assert.deepEqual(
      saved.report.rows.map((r) => r.source),
      input.rows,
    );
    assert.equal(
      f.app.identity.customers(f.actor).length,
      kind === "customer" ? 1 : 3,
    );
    assert.equal(f.app.catalog.products(f.actor).length, 1);
    assert.deepEqual(
      f.app.migration.masters.preview(f.actor, kind + "-retry", {
        ...input,
        batchRef: ` ${kind} `,
      }),
      batch,
    );
    assert.throws(
      () =>
        f.app.migration.masters.preview(f.actor, kind + "-conflict", {
          ...input,
          expectedValue: input.expectedValue + 1,
        }),
      { code: "RECEIPT_CONFLICT" },
    );
    const result = f.app.migration.masters.decide(
      f.actor,
      kind,
      approved(batch),
    );
    assert.deepEqual(
      [result.quantity, result.value, result.mappings.length],
      [2, input.expectedValue, 2],
    );
    assert.ok(result.mappings.every((m) => m.action === "create"));
    assert.equal(new Set(result.mappings.map((m) => m.targetId)).size, 2);
    f.app.close();
    f.app = new Application(f.path);
    assert.deepEqual(
      f.app.migration.masters.decide(f.actor, kind, approved(batch)),
      result,
    );
    assert.deepEqual(
      f.app.migration.masters.decide(
        { ...f.actor, id: "second-admin" },
        kind + "new-key",
        approved(batch),
      ),
      result,
    );
    assert.throws(
      () =>
        f.app.migration.masters.decide(f.actor, "changed-decision", {
          ...approved(batch),
          decision: "reject",
        }),
      { code: "RECEIPT_CONFLICT" },
    );
  }
  const accounts = f.app.identity
    .customers(f.actor)
    .filter((c) => c.name.startsWith("Imported"));
  assert.equal(
    accounts.reduce((s, c) => s + c.credit_limit, 0),
    300000,
  );
  assert.equal(accounts.filter((c) => c.held).length, 1);
  for (const c of accounts)
    assert.deepEqual(
      [c.residency_mode, c.provider_exceptions, c.residency_version],
      ["strict", "[]", 1],
    );
  const products = f.app.catalog
    .products(f.actor)
    .filter((p) => p.sku.startsWith("MASTER"));
  assert.equal(
    products.reduce((s, p) => s + p.unit_price, 0),
    12000,
  );
  assert.equal(products.filter((p) => p.serialized).length, 1);
  assert.deepEqual(f.app.inventory.stock(f.actor), before.stock);
  assert.equal(f.app.billing.invoices(f.actor).length, 0);
  assert.deepEqual(
    f.app.database.owned("iam").all("SELECT id FROM iam_users"),
    users,
  );
  assert.equal(
    f.app.database
      .owned("migration")
      .all("SELECT * FROM migration_master_sources").length,
    4,
  );
  assert.throws(
    () => f.app.database.owned("migration").all("SELECT * FROM iam_accounts"),
    /prohibited|not authorized/,
  );
});

test("explicit exact matches preserve customer choice and catalog/tier prices; duplicate source and target mappings cannot be reassigned", (t) => {
  const f = fixture(t);
  chooseProviders(f, f.actor, "choice", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["stripe"],
    version: 1,
    acknowledgment: "Synthetic reviewed Stripe processing choice",
  });
  f.app.catalog.setPrice(f.actor, "tier", {
    productId: f.product,
    tier: "trade",
    unitPrice: 8000,
  });
  const oldCustomer = f.app.identity.customer(f.actor, f.buyer),
    oldProduct = f.app.catalog.product(f.actor, f.product),
    input = customerMatch(f),
    preview = f.app.migration.masters.preview(f.actor, "match", input);
  const result = f.app.migration.masters.decide(
    f.actor,
    "match",
    approved(preview),
  );
  assert.deepEqual(result.mappings, [
    { sourceId: "MATCH-C", targetId: f.buyer, action: "match", value: 1000000 },
  ]);
  assert.deepEqual(f.app.identity.customer(f.actor, f.buyer), oldCustomer);
  const catalogInput: MasterInput = {
    ...source("catalog", "CAT-MATCH"),
    expectedQuantity: 1,
    expectedValue: 10000,
    rows: [
      {
        sourceId: "MATCH-P",
        targetId: f.product,
        sku: "EQ-1",
        name: "Synthetic equipment",
        serialized: true,
        unitPrice: 10000,
        taxBasisPoints: 1300,
      },
    ],
  };
  f.app.migration.masters.decide(
    f.actor,
    "cat-match",
    approved(
      f.app.migration.masters.preview(f.actor, "cat-match", catalogInput),
    ),
  );
  assert.deepEqual(f.app.catalog.product(f.actor, f.product), oldProduct);
  assert.equal(
    f.app.database
      .owned("catalog")
      .get(
        "SELECT unit_price FROM catalog_prices WHERE product_id=?",
        f.product,
      )?.unit_price,
    8000,
  );
  for (const [batchRef, rowChange, code] of [
    ["SOURCE-REUSE", {}, "SOURCE_ALREADY_APPLIED"],
    ["TARGET-REUSE", { sourceId: "NEW-SOURCE" }, "TARGET_ALREADY_MAPPED"],
  ] as const) {
    const b = f.app.migration.masters.preview(f.actor, batchRef, {
      ...input,
      batchRef,
      rows: [{ ...(input.rows[0] as object), ...rowChange }],
    });
    assert.ok(
      f.app.migration.masters
        .list(f.actor)
        .find((s) => s.id === b.id)!
        .report.issues.some((i) => i.code === code),
    );
    assert.throws(
      () => f.app.migration.masters.decide(f.actor, batchRef, approved(b)),
      { code: "IMPORT_REJECTS" },
    );
  }
  // Another explicitly identified source dataset may match the same native account.
  const next = f.app.migration.masters.preview(f.actor, "new-dataset", {
    ...input,
    batchRef: "NEW-DATASET",
    sourceRef: "OTHER-SOURCE",
  });
  assert.equal(
    f.app.migration.masters.decide(f.actor, "new-dataset", approved(next))
      .mappings[0]!.targetId,
    f.buyer,
  );
  assert.equal(f.app.identity.customers(f.actor).length, 1);
});

test("row rejects and ambiguous matches block the entire batch; control amounts never become balances and rejected evidence survives correction", (t) => {
  const f = fixture(t),
    input = source();
  const first = input.rows[0] as Record<string, unknown>;
  const rows = [
    first,
    { ...first, sourceId: "C-1" },
    { ...first, sourceId: "BAD-HOLD", name: "Bad hold", held: [true] },
    { ...first, sourceId: "INJECT", name: "Injected", providers: ["stripe"] },
    null,
    { ...first, sourceId: "FOREIGN", name: "Foreign", targetId: "foreign-id" },
    {
      ...(customerMatch(f).rows[0] as object),
      sourceId: "MISMATCH",
      creditLimit: 1,
    },
  ];
  const b = f.app.migration.masters.preview(f.actor, "bad", { ...input, rows }),
    saved = f.app.migration.masters.list(f.actor)[0]!;
  assert.equal(saved.state, "blocked");
  for (const code of [
    "DUPLICATE_SOURCE_ROW",
    "DUPLICATE_MASTER_KEY",
    "VALIDATION",
    "NOT_FOUND",
    "TARGET_MISMATCH",
    "RECONCILIATION",
  ])
    assert.ok(
      saved.report.issues.some((i) => i.code === code),
      code,
    );
  assert.throws(
    () => f.app.migration.masters.decide(f.actor, "bad", approved(b)),
    { code: "IMPORT_REJECTS" },
  );
  assert.equal(f.app.identity.customers(f.actor).length, 1);
  assert.deepEqual(
    f.app.migration.masters.decide(f.actor, "reject", {
      ...approved(b),
      decision: "reject",
    }).mappings,
    [],
  );
  const mismatch = f.app.migration.masters.preview(f.actor, "controls", {
    ...input,
    batchRef: "CONTROL-MISMATCH",
    expectedValue: 300001,
  });
  assert.throws(
    () =>
      f.app.migration.masters.decide(f.actor, "controls", approved(mismatch)),
    { code: "IMPORT_REJECTS" },
  );
  const corrected = f.app.migration.masters.preview(f.actor, "corrected", {
    ...input,
    batchRef: "CORRECTED",
  });
  f.app.migration.masters.decide(f.actor, "corrected", approved(corrected));
  assert.deepEqual(
    f.app.migration.masters.list(f.actor).find((s) => s.id === b.id)!.report,
    saved.report,
  );
  assert.equal(f.app.billing.invoices(f.actor).length, 0);
});

test("approval rechecks native creation, holds and residency revisions and rejects forged review hashes and current unauthorized cached callers", (t) => {
  const f = fixture(t),
    input = source(),
    b = f.app.migration.masters.preview(f.actor, "preview", input);
  assert.throws(
    () =>
      f.app.migration.masters.decide(f.actor, "hash", {
        ...approved(b),
        reviewHash: "wrong",
      }),
    { code: "REVIEW_CHANGED" },
  );
  assert.throws(
    () =>
      f.app.migration.masters.decide(
        { ...f.actor, orgId: "foreign" },
        "foreign",
        approved(b),
      ),
    { code: "NOT_FOUND" },
  );
  f.app.identity.createCustomer(f.actor, "native", {
    name: "Imported customer A",
    tier: "standard",
    creditLimit: 100000,
  });
  assert.throws(
    () => f.app.migration.masters.decide(f.actor, "stale-create", approved(b)),
    { code: "IMPORT_STALE" },
  );
  assert.equal(f.app.identity.customers(f.actor).length, 2);
  const m = f.app.migration.masters.preview(
    f.actor,
    "preview-match",
    customerMatch(f),
  );
  chooseProviders(f, f.actor, "choice", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["quickbooks"],
    version: 1,
    acknowledgment: "Changed after review",
  });
  assert.throws(
    () => f.app.migration.masters.decide(f.actor, "stale-choice", approved(m)),
    { code: "IMPORT_STALE" },
  );
  const h = f.app.migration.masters.preview(
    f.actor,
    "preview-hold",
    customerMatch(f, "HOLD"),
  );
  f.app.identity.setHold(f.actor, "hold", {
    accountId: f.buyer,
    held: true,
    reason: "Changed after review",
  });
  assert.throws(
    () => f.app.migration.masters.decide(f.actor, "stale-hold", approved(h)),
    { code: "IMPORT_STALE" },
  );
  const cat = f.app.migration.masters.preview(
    f.actor,
    "cat",
    source("catalog", "CAT"),
  );
  f.app.migration.masters.decide(f.actor, "cat", approved(cat));
  const warehouse = { ...f.actor, role: "warehouse" as const };
  assert.throws(() => f.app.migration.masters.list(warehouse), {
    code: "FORBIDDEN",
  });
  assert.throws(
    () =>
      f.app.migration.masters.preview(
        warehouse,
        "cat",
        source("catalog", "CAT"),
      ),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () => f.app.migration.masters.decide(warehouse, "cat", approved(cat)),
    { code: "FORBIDDEN" },
  );
});

test("late mapping failures roll back customer and catalog creations, command/audit receipts and mappings before a safe retry", (t) => {
  const f = fixture(t),
    store = f.app.database.owned("migration");
  for (const kind of ["customer", "catalog"] as const) {
    const b = f.app.migration.masters.preview(
        f.actor,
        kind,
        source(kind, kind),
      ),
      accounts = f.app.identity.customers(f.actor),
      products = f.app.catalog.products(f.actor),
      audits = f.app.platform.audits(f.actor),
      mappings = store.all("SELECT * FROM migration_master_sources");
    store.migrate(
      `CREATE TRIGGER migration_test_reject BEFORE INSERT ON migration_master_sources WHEN NEW.source_id IN('C-2','P-2') BEGIN SELECT RAISE(ABORT,'Synthetic late master mapping failure'); END;`,
    );
    assert.throws(
      () => f.app.migration.masters.decide(f.actor, kind, approved(b)),
      /Synthetic late master mapping failure/,
    );
    assert.deepEqual(f.app.identity.customers(f.actor), accounts);
    assert.deepEqual(f.app.catalog.products(f.actor), products);
    assert.deepEqual(f.app.platform.audits(f.actor), audits);
    assert.deepEqual(
      store.all("SELECT * FROM migration_master_sources"),
      mappings,
    );
    assert.equal(
      f.app.migration.masters.list(f.actor).find((s) => s.id === b.id)!.state,
      "ready",
    );
    store.migrate("DROP TRIGGER migration_test_reject");
    assert.equal(
      f.app.migration.masters.decide(f.actor, kind, approved(b)).mappings
        .length,
      2,
    );
  }
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
  await Promise.all(
    children.map(
      (c, i) =>
        new Promise<void>((resolve, reject) => {
          c.once("message", () => resolve());
          c.once("error", reject);
          c.once("exit", (code) =>
            reject(new Error(`Master child exited ${code}`)),
          );
          c.send({
            action: "init",
            input: {
              path: f.path,
              actor: { ...f.actor, id: `reviewer-${i}` },
              key: `review-${i}`,
              masters: true,
              payload: approved(batches[i]!),
            },
          });
        }),
    ),
  );
  const results = children.map(
    (c) =>
      new Promise<any>((resolve, reject) => {
        c.once("message", resolve);
        c.once("error", reject);
        c.once("exit", (code) =>
          reject(new Error(`Master child exited ${code}`)),
        );
      }),
  );
  children.forEach((c) => c.send({ action: "go" }));
  return Promise.all(results);
}
test("real competing processes apply overlapping masters once and identical reviews return the same permanent mappings", async (t) => {
  const f = fixture(t),
    input = source("catalog"),
    a = f.app.migration.masters.preview(f.actor, "a", input),
    b = f.app.migration.masters.preview(f.actor, "b", {
      ...input,
      batchRef: "MASTER-2",
    });
  const outcomes = await compete(t, f, [a, b]);
  assert.equal(outcomes.filter((o) => o.ok).length, 1);
  assert.equal(outcomes.find((o) => !o.ok).code, "IMPORT_STALE");
  const winner = outcomes.find((o) => o.ok).result,
    batch = winner.id === a.id ? a : b,
    replay = await compete(t, f, [batch, batch]);
  assert.ok(replay.every((o) => o.ok));
  assert.deepEqual(replay[0].result, replay[1].result);
  assert.equal(f.app.catalog.products(f.actor).length, 3);
  assert.equal(
    f.app.database
      .owned("migration")
      .all("SELECT * FROM migration_master_sources").length,
    2,
  );
});

test("strict manifest rejects foreign region, unknown fields, invalid kinds/claims/controls and batch bounds; separate US runtime imports USD without conversion", (t) => {
  const f = fixture(t),
    input = source();
  for (const change of [
    { region: "US" },
    { currency: "USD" },
    { kind: "users" },
    { version: 2 },
    { sourceHash: "wrong" },
    { cutoffAt: "2999-01-01T00:00:00.000Z" },
    { expectedQuantity: 1.5 },
    { expectedValue: -1 },
    { rows: [] },
    { rows: Array(501).fill(input.rows[0]) },
    { providers: ["stripe"] },
  ])
    assert.throws(() =>
      f.app.migration.masters.preview(f.actor, "bad-manifest", {
        ...input,
        ...change,
      } as any),
    );
  assert.equal(f.app.migration.masters.list(f.actor).length, 0);
  const us = new Application(join(dirname(f.path), "us.db"), "US");
  try {
    const actor = us.identity.bootstrap(
      "Synthetic US",
      "us@example.test",
      "long-test-only-password",
      "USD",
    );
    const batch = us.migration.masters.preview(actor, "us", {
      ...input,
      region: "US",
      currency: "USD",
    });
    assert.equal(
      us.migration.masters.decide(actor, "us", approved(batch)).value,
      300000,
    );
    assert.ok(
      us.identity
        .customers(actor)
        .every((c) => c.currency === "USD" && c.residency_mode === "strict"),
    );
  } finally {
    us.close();
  }
});

test("encrypted populated-master recovery retains source mappings and decisions but excludes later source imports", async (t) => {
  const f = fixture(t),
    input = source(),
    batch = f.app.migration.masters.preview(f.actor, "masters", input),
    result = f.app.migration.masters.decide(
      f.actor,
      "masters",
      approved(batch),
    ),
    key = randomBytes(32),
    archive = join(dirname(f.path), "masters.backup"),
    path = join(dirname(f.path), "restored.db");
  await createBackup(f.path, archive, "CA", key);
  const later = f.app.migration.masters.preview(
    f.actor,
    "later",
    source("catalog", "LATER"),
  );
  f.app.migration.masters.decide(f.actor, "later", approved(later));
  await restoreBackup(archive, path, "CA", key);
  const restored = new Application(path);
  try {
    assert.deepEqual(
      restored.migration.masters.decide(f.actor, "new-key", approved(batch)),
      result,
    );
    assert.equal(restored.identity.customers(f.actor).length, 3);
    assert.equal(restored.catalog.products(f.actor).length, 1);
    assert.equal(
      restored.database
        .owned("migration")
        .all("SELECT * FROM migration_master_sources").length,
      2,
    );
    assert.ok(restored.platform.recoveryHold());
  } finally {
    restored.close();
  }
});

test("HTTP master import validates envelope, preserves row rejects, requires origin/CSRF and rechecks grants before cached approvals", async (t) => {
  const f = fixture(t),
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
      "idempotency-key": "masters-http",
    };
  const post = (
    name: string,
    payload: Record<string, unknown>,
    override = {},
  ) =>
    http.inject({
      method: "POST",
      url: `/api/commands/${name}`,
      headers: { ...headers, ...override },
      payload,
    });
  assert.equal(
    (
      await post("import.masters.preview", {
        ...source(),
        approvedBy: "injected",
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await post("import.masters.preview", source(), {
        "x-csrf-token": "wrong",
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await post("import.masters.preview", source(), {
        origin: "http://foreign.test",
      })
    ).statusCode,
    403,
  );
  const rejected = await post(
    "import.masters.preview",
    {
      ...source(),
      batchRef: "BAD-HTTP",
      rows: [{ ...(source().rows[0] as object), held: "true" }],
    },
    { "idempotency-key": "bad-rows" },
  );
  assert.equal(rejected.statusCode, 200);
  assert.equal(
    (await http.inject({ url: "/api/imports/masters", headers })).json()[0]
      .state,
    "blocked",
  );
  const preview = await post("import.masters.preview", source());
  assert.equal(preview.statusCode, 200);
  const decision = approved(preview.json()),
    approval = await post("import.masters.decide", decision);
  assert.equal(approval.statusCode, 200);
  assert.deepEqual(
    (
      await post("import.masters.decide", decision, {
        "idempotency-key": "new-key",
      })
    ).json(),
    approval.json(),
  );
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='warehouse' WHERE id=?", f.actor.id);
  assert.equal(
    (await http.inject({ url: "/api/imports/masters", headers })).statusCode,
    403,
  );
  assert.equal((await post("import.masters.decide", decision)).statusCode, 403);
});
