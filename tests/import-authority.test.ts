import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.ts";
import { digest, type Actor, type Role } from "../src/server/core.ts";
import { Application } from "../src/server/application.ts";
import type { Owner } from "../src/server/database.ts";

type Kind = "opening" | "masters" | "catalog" | "documents";
type Batch = { id: string; reviewHash: string };
function user(f: ReturnType<typeof fixture>, role: Role) {
  const result = f.app.identity.createUser(f.actor, `import-${role}`, {
    name: `Import ${role}`,
    email: `import-${role}@example.test`,
    password: "long-import-test-password",
    role,
    sites: role === "buyer" ? [] : [f.w1],
    ...(role === "buyer" ? { accountId: f.buyer } : {}),
  });
  return f.app.identity.currentActor({ ...f.actor, id: result.id });
}
function change(
  f: ReturnType<typeof fixture>,
  actor: Actor,
  updates: Record<string, unknown>,
) {
  const row = f.app.identity.users(f.actor).find((u) => u.id === actor.id)!;
  f.app.identity.updateUser(
    f.actor,
    `import-grant-${actor.id}-${row.revision}`,
    {
      userId: actor.id,
      revision: row.revision,
      name: actor.name,
      email: row.email,
      role: actor.role,
      sites: actor.sites,
      ...(actor.accountId ? { accountId: actor.accountId } : {}),
      active: true,
      currentPassword: "long-test-only-password",
      reason: "Synthetic import authority change",
      ...updates,
    },
  );
}
function port(f: ReturnType<typeof fixture>, kind: Kind) {
  const base = {
    version: 1 as const,
    sourceRef: "AUTH-SOURCE",
    sourceHash: digest("Independent synthetic import source"),
    cutoffAt: "2026-09-01T00:00:00.000Z",
    region: "CA" as const,
    currency: "CAD" as const,
    expectedQuantity: 1,
    acknowledgment:
      "Synthetic rights, frozen cutoff and independent totals reviewed",
  };
  const decision = (b: Batch, choice: "approve" | "reject") => ({
    batchId: b.id,
    reviewHash: b.reviewHash,
    decision: choice,
    reason: "Independent synthetic source review",
  });
  if (kind === "opening") {
    const input = {
      ...base,
      expectedValue: 6000,
      rows: [
        {
          sourceId: "STOCK-1",
          sku: "EQ-1",
          warehouse: "Ottawa",
          bin: "A-1",
          serial: "IMPORT-AUTH-1",
          quantity: 1,
          unitCost: 6000,
          condition: "usable",
        },
      ],
    };
    return {
      list: (a: Actor) => f.app.migration.list(a),
      preview: (a: Actor, key: string, batchRef = "AUTH-1") =>
        f.app.migration.preview(a, key, { ...input, batchRef }),
      decide: (a: Actor, key: string, b: Batch, choice: "approve" | "reject") =>
        f.app.migration.decide(a, key, decision(b, choice)),
    };
  }
  if (kind === "masters" || kind === "catalog") {
    const input = {
      ...base,
      kind: kind === "catalog" ? ("catalog" as const) : ("customer" as const),
      expectedValue: 20000,
      rows:
        kind === "catalog"
          ? [
              {
                sourceId: "PRODUCT-1",
                targetId: null,
                sku: "IMPORT-AUTH",
                name: "Imported authority product",
                serialized: false,
                unitPrice: 20000,
                taxBasisPoints: 1300,
              },
            ]
          : [
              {
                sourceId: "CUSTOMER-1",
                targetId: null,
                name: "Imported authority customer",
                tier: "standard",
                creditLimit: 20000,
                held: false,
              },
            ],
    };
    return {
      list: (a: Actor) => f.app.migration.masters.list(a),
      preview: (a: Actor, key: string, batchRef = "AUTH-1") =>
        f.app.migration.masters.preview(a, key, { ...input, batchRef }),
      decide: (a: Actor, key: string, b: Batch, choice: "approve" | "reject") =>
        f.app.migration.masters.decide(a, key, decision(b, choice)),
    };
  }
  const input = {
    ...base,
    expectedValue: 11300,
    expectedNet: 10000,
    expectedTax: 1300,
    expectedCredited: 0,
    expectedPaid: 0,
    expectedRefunded: 0,
    rows: [
      {
        sourceId: "INVOICE-1",
        accountId: f.buyer,
        number: "LEGACY-AUTH-1",
        issuedAt: "2026-08-01T00:00:00.000Z",
        dueAt: "2026-08-31T00:00:00.000Z",
        net: 10000,
        tax: 1300,
        total: 11300,
        credited: 0,
        paid: 0,
        refunded: 0,
        balance: 11300,
        lines: [
          {
            productId: f.product,
            description: "Original equipment",
            quantity: 1,
            unitPrice: 10000,
            unitTax: 1300,
            creditedQuantity: 0,
          },
        ],
      },
    ],
  };
  return {
    list: (a: Actor) => f.app.migration.documents.list(a),
    preview: (a: Actor, key: string, batchRef = "AUTH-1") =>
      f.app.migration.documents.preview(a, key, { ...input, batchRef }),
    decide: (a: Actor, key: string, b: Batch, choice: "approve" | "reject") =>
      f.app.migration.documents.decide(a, key, decision(b, choice)),
  };
}
function facts(f: ReturnType<typeof fixture>) {
  const owners: [Owner, string[]][] = [
    [
      "migration",
      [
        "opening_batches",
        "opening_sources",
        "master_batches",
        "master_sources",
        "document_batches",
        "document_sources",
      ],
    ],
    ["iam", ["accounts"]],
    ["catalog", ["products"]],
    ["inventory", ["units", "movements", "allocations"]],
    [
      "billing",
      [
        "invoices",
        "lines",
        "opening_documents",
        "opening_lines",
        "payments",
        "credits",
        "refunds",
        "counters",
      ],
    ],
    ["orders", ["orders", "lines"]],
    ["platform", ["commands", "audit", "audit_order", "audit_clock", "events"]],
  ];
  return owners.flatMap(([owner, tables]) =>
    tables.map((table) =>
      f.app.database
        .owned(owner)
        .all(`SELECT * FROM ${owner}_${table} ORDER BY rowid`),
    ),
  );
}
function prepared(p: ReturnType<typeof port>, actor: Actor) {
  const batch = p.preview(actor, "preview");
  assert.equal(p.list(actor).find((b) => b.id === batch.id)!.state, "ready");
  const approved = p.decide(actor, "approve", batch, "approve");
  const rejectedBatch = p.preview(actor, "preview-rejected", "AUTH-REJECTED");
  const rejected = p.decide(actor, "reject", rejectedBatch, "reject");
  const pending = p.preview(actor, "preview-pending", "AUTH-PENDING");
  return { batch, approved, rejectedBatch, rejected, pending };
}
function operations(
  p: ReturnType<typeof port>,
  a: Actor,
  saved: ReturnType<typeof prepared>,
) {
  return [
    () => p.list(a),
    () => p.preview(a, "preview"),
    () => p.preview(a, "new-preview"),
    () => p.preview(a, "new-source", "AUTH-NEW"),
    () => p.decide(a, "approve", saved.batch, "approve"),
    () => p.decide(a, "new-approve", saved.batch, "approve"),
    () => p.decide(a, "reject", saved.rejectedBatch, "reject"),
    () => p.decide(a, "new-reject", saved.rejectedBatch, "reject"),
    () => p.decide(a, "pending-approve", saved.pending, "approve"),
    () => p.decide(a, "pending-reject", saved.pending, "reject"),
  ];
}
function denied(ops: (() => unknown)[], code = "FORBIDDEN") {
  const results = ops.map((op) => {
    try {
      op();
      return "allowed";
    } catch (error) {
      return (error as { code: string }).code;
    }
  });
  assert.deepEqual(
    results,
    ops.map(() => code),
  );
}
for (const kind of ["opening", "masters", "catalog", "documents"] as const) {
  test(`${kind} imports deny unavailable principals before source reports, cached outcomes or new decisions`, (t) => {
    const f = fixture(t),
      a = user(f, "admin"),
      p = port(f, kind),
      saved = prepared(p, a);
    for (const unavailable of [
      { ...a, id: "missing-principal" },
      { ...a, orgId: "foreign" },
    ]) {
      const before = facts(f);
      denied(operations(p, unavailable, saved));
      assert.deepEqual(facts(f), before);
    }
    change(f, a, { active: false });
    const before = facts(f);
    denied(operations(p, a, saved));
    assert.deepEqual(facts(f), before);
  });
  test(`${kind} imports recheck demoted administrators before reports and saved or new preview/approve/reject keys`, (t) => {
    const f = fixture(t),
      a = user(f, "admin"),
      p = port(f, kind),
      saved = prepared(p, a);
    change(f, a, { role: "warehouse", sites: [f.w1] });
    const before = facts(f);
    denied(operations(p, a, saved));
    assert.deepEqual(facts(f), before);
  });
  test(`${kind} imports enforce password-change restrictions before reads and saved or new commands`, (t) => {
    const f = fixture(t),
      a = user(f, "admin"),
      p = port(f, kind),
      saved = prepared(p, a);
    f.app.database
      .owned("iam")
      .run(
        "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
        a.id,
      );
    const before = facts(f);
    denied(operations(p, a, saved), "PASSWORD_CHANGE_REQUIRED");
    assert.deepEqual(facts(f), before);
  });
  test(`${kind} imports use persisted grants rather than supplied roles across independent changes and restart`, (t) => {
    const f = fixture(t),
      a = user(f, "warehouse"),
      p = port(f, kind);
    denied([
      () => p.list({ ...a, role: "admin" }),
      () => p.preview({ ...a, role: "admin" }, "preview"),
    ]);
    const other = new Application(f.path);
    try {
      change({ ...f, app: other }, a, { role: "admin", sites: [] });
      const saved = prepared(p, a);
      assert.deepEqual(p.preview(a, "preview"), saved.batch);
      assert.deepEqual(
        p.decide(a, "approve", saved.batch, "approve"),
        saved.approved,
      );
      assert.deepEqual(
        p.decide(a, "reject", saved.rejectedBatch, "reject"),
        saved.rejected,
      );
      change({ ...f, app: other }, a, { role: "warehouse", sites: [f.w1] });
      const before = facts(f);
      denied(operations(p, { ...a, role: "admin" }, saved));
      assert.deepEqual(facts(f), before);
      f.app.close();
      f.app = new Application(f.path);
      denied(operations(p, { ...a, role: "admin" }, saved));
      assert.deepEqual(facts(f), before);
      change({ ...f, app: other }, a, { role: "admin", sites: [] });
      assert.deepEqual(
        p.decide(a, "approve", saved.batch, "approve"),
        saved.approved,
      );
      assert.deepEqual(
        p.decide(a, "reject", saved.rejectedBatch, "reject"),
        saved.rejected,
      );
    } finally {
      other.close();
    }
  });
}
