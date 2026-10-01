import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { chooseProviders, fixture, accept, ship } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import { createBackup, restoreBackup } from "../src/server/recovery.ts";
import { digest } from "../src/server/core.ts";
import type { DocumentInput } from "../src/server/document-imports.ts";
import type { OpeningDocument } from "../src/server/billing-opening.ts";

function source(
  f: ReturnType<typeof fixture>,
  batchRef = "DOCUMENTS-1",
): DocumentInput {
  const product = f.app.catalog.create(f.actor, "opening-bulk", {
    sku: "DOC-B",
    name: "Historical bulk",
    serialized: false,
    unitPrice: 2000,
    taxBasisPoints: 500,
  }).id;
  return {
    version: 1,
    batchRef,
    sourceRef: "SYNTHETIC-UNPAID-CUTOFF",
    sourceHash: digest("Independent synthetic unpaid source"),
    cutoffAt: "2026-09-01T00:00:00.000Z",
    region: "CA",
    currency: "CAD",
    expectedQuantity: 2,
    expectedValue: 16800,
    expectedNet: 34000,
    expectedTax: 4100,
    expectedCredited: 11300,
    expectedPaid: 12000,
    expectedRefunded: 2000,
    acknowledgment:
      "Synthetic rights, source freeze, historical settlements and independent balances reviewed",
    rows: [
      {
        sourceId: "DOC-1",
        accountId: f.buyer,
        number: `INV-${new Date().getUTCFullYear()}-000001`,
        issuedAt: "2026-08-01T00:00:00.000Z",
        dueAt: "2026-08-31T00:00:00.000Z",
        net: 30000,
        tax: 3900,
        total: 33900,
        credited: 11300,
        paid: 10000,
        refunded: 2000,
        balance: 14600,
        lines: [
          {
            productId: f.product,
            description: "Original serialized equipment",
            quantity: 3,
            unitPrice: 10000,
            unitTax: 1300,
            creditedQuantity: 1,
          },
        ],
      },
      {
        sourceId: "DOC-2",
        accountId: f.buyer,
        number: "LEGACY-B-002",
        issuedAt: "2026-08-15T00:00:00.000Z",
        dueAt: "2026-09-15T00:00:00.000Z",
        net: 4000,
        tax: 200,
        total: 4200,
        credited: 0,
        paid: 2000,
        refunded: 0,
        balance: 2200,
        lines: [
          {
            productId: product,
            description: "Original bulk equipment",
            quantity: 2,
            unitPrice: 2000,
            unitTax: 100,
            creditedQuantity: 0,
          },
        ],
      },
    ],
  };
}
function approved(b: { id: string; reviewHash: string }) {
  return {
    batchId: b.id,
    reviewHash: b.reviewHash,
    decision: "approve" as const,
    reason:
      "Independent original amounts, credits, settled cash and outstanding balance review",
  };
}
function effects(f: ReturnType<typeof fixture>) {
  return Object.fromEntries(
    (
      [
        ["billing", "billing_payments"],
        ["billing", "billing_credits"],
        ["billing", "billing_refunds"],
        ["orders", "orders_orders"],
        ["fulfillment", "fulfillment_shipments"],
        ["integration", "integration_effects"],
      ] as const
    ).map(([owner, table]) => [
      table!,
      f.app.database.owned(owner!).all(`SELECT * FROM ${table}`).length,
    ]),
  );
}

test("unpaid documents preserve original money, provenance and balances without inventing stock/cash/custody; permanent decisions survive restart", (t) => {
  const f = fixture(t),
    input = source(f),
    stock = f.app.inventory.stock(f.actor),
    before = effects(f),
    b = f.app.migration.documents.preview(f.actor, "preview", input);
  assert.equal(f.app.billing.invoices(f.actor).length, 0);
  const report = f.app.migration.documents.list(f.actor)[0]!;
  assert.equal(report.state, "ready");
  assert.deepEqual(
    [
      report.report.quantity,
      report.report.value,
      report.report.net,
      report.report.tax,
      report.report.credited,
      report.report.paid,
      report.report.refunded,
    ],
    [2, 16800, 34000, 4100, 11300, 12000, 2000],
  );
  assert.deepEqual(
    report.report.rows.map((r) => r.source),
    input.rows,
  );
  assert.deepEqual(
    f.app.migration.documents.preview(f.actor, "new-preview-key", input),
    b,
  );
  assert.throws(
    () =>
      f.app.migration.documents.preview(f.actor, "changed", {
        ...input,
        expectedValue: 16801,
      }),
    { code: "RECEIPT_CONFLICT" },
  );
  const result = f.app.migration.documents.decide(
    f.actor,
    "approve",
    approved(b),
  );
  assert.equal(result.quantity, 2);
  assert.equal(result.value, 16800);
  assert.deepEqual(effects(f), before);
  assert.deepEqual(f.app.inventory.stock(f.actor), stock);
  assert.equal(f.app.billing.exposure(f.actor, f.buyer).total, 16800);
  const invoices = f.app.billing.invoices(f.actor);
  assert.equal(
    invoices.reduce((n, i) => n + i.total, 0),
    38100,
  );
  assert.equal(
    invoices.reduce((n, i) => n + i.balance, 0),
    16800,
  );
  for (const m of result.mappings) {
    const i = f.app.billing.invoice(f.actor, m.invoiceId);
    assert.equal(i.origin, "opening");
    assert.equal(i.order_id, null);
    assert.equal(i.shipment_id, null);
    assert.equal(i.opening!.source_id, m.sourceId);
    assert.equal(i.opening!.source_hash, input.sourceHash);
    assert.equal(i.opening!.cutoff_at, input.cutoffAt);
    assert.equal(f.app.billing.totals(f.actor, i.id).balance, m.balance);
  }
  const id = result.mappings[1]!.invoiceId;
  f.app.billing.manualPayment(f.actor, "new-cash", {
    invoiceId: id,
    amount: 1000,
    reference: "POST-CUTOFF",
    reason: "New verified bank receipt",
  });
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(
    f.app.migration.documents.decide(f.actor, "restart", approved(b)),
    result,
  );
  assert.deepEqual(f.app.billing.totals(f.actor, id), {
    credited: 0,
    paid: 3000,
    refunded: 0,
    balance: 1200,
  });
  assert.equal(f.app.billing.invoices(f.actor).length, 2);
  assert.equal(
    f.app.database
      .owned("migration")
      .all("SELECT * FROM migration_document_sources").length,
    2,
  );
  assert.throws(
    () =>
      f.app.migration.documents.decide(f.actor, "changed-decision", {
        ...approved(b),
        decision: "reject",
      }),
    { code: "RECEIPT_CONFLICT" },
  );
});

test("historical credit/cash quantities constrain new credits/payments; source cash has no synthetic refundable payment identity", (t) => {
  const f = fixture(t),
    b = f.app.migration.documents.preview(f.actor, "preview", source(f)),
    result = f.app.migration.documents.decide(f.actor, "apply", approved(b)),
    invoiceId = result.mappings[0]!.invoiceId,
    lineId = String(f.app.billing.lines(f.actor, invoiceId)[0]!.id);
  const beforeLine = f.app.billing.lines(f.actor, invoiceId)[0]!;
  assert.equal(beforeLine.historical_credited_quantity, 1);
  assert.equal(beforeLine.credited_quantity, 1);
  assert.equal(beforeLine.creditable_quantity, 2);
  assert.throws(
    () =>
      f.app.billing.issueCredit(f.actor, "over", {
        invoiceId,
        reference: "OVER",
        reason: "Too many units",
        lines: [{ lineId, quantity: 3 }],
      }),
    { code: "OVER_CREDIT" },
  );
  const credit = f.app.billing.issueCredit(f.actor, "remaining", {
    invoiceId,
    reference: "REMAINING",
    reason: "New approved return",
    lines: [{ lineId, quantity: 2 }],
  });
  assert.equal(credit.total, 22600);
  const afterLine = f.app.billing.lines(f.actor, invoiceId)[0]!;
  assert.equal(afterLine.historical_credited_quantity, 1);
  assert.equal(afterLine.credited_quantity, 3);
  assert.equal(afterLine.creditable_quantity, 0);
  assert.deepEqual(f.app.billing.totals(f.actor, invoiceId), {
    credited: 33900,
    paid: 10000,
    refunded: 2000,
    balance: -8000,
  });
  assert.throws(
    () =>
      f.app.billing.refundRequest(f.actor, "phantom", {
        invoiceId,
        paymentId: "DOC-1",
        amount: 8000,
        reference: "REFUND",
        reason: "Historical cash is not a new payment proof",
      }),
    { code: "NOT_FOUND" },
  );
  assert.equal(effects(f).billing_payments, 0);
  const other = result.mappings[1]!.invoiceId,
    cash = {
      invoiceId: other,
      amount: 1000,
      reference: "BANK-1",
      reason: "Verified new bank receipt",
    };
  const p = f.app.billing.manualPayment(f.actor, "cash", cash);
  assert.deepEqual(
    f.app.billing.manualPayment(f.actor, "cash-new-key", cash),
    p,
  );
  assert.throws(
    () =>
      f.app.billing.manualPayment(f.actor, "overpayment", {
        ...cash,
        amount: 1201,
        reference: "BANK-2",
      }),
    { code: "OVERPAYMENT" },
  );
  assert.equal(effects(f).billing_payments, 1);
  assert.equal(f.app.billing.totals(f.actor, other).balance, 1200);
});

test("imported debt participates in credit exposure, native numbering skips preserved historical numbers, and customer choice cannot create duplicate accounting", (t) => {
  const f = fixture(t),
    b = f.app.migration.documents.preview(f.actor, "preview", source(f)),
    result = f.app.migration.documents.decide(f.actor, "apply", approved(b)),
    invoiceId = result.mappings[0]!.invoiceId;
  f.app.database
    .owned("iam")
    .run("UPDATE iam_accounts SET credit_limit=26800 WHERE id=?", f.buyer);
  assert.throws(() => accept(f), { code: "CREDIT_LIMIT" });
  f.app.database
    .owned("iam")
    .run("UPDATE iam_accounts SET credit_limit=1000000 WHERE id=?", f.buyer);
  const native = ship(f, accept(f, 1, "native").id);
  assert.equal(
    f.app.billing.invoice(f.actor, native.invoiceId).number,
    `INV-${new Date().getUTCFullYear()}-000002`,
  );
  assert.throws(
    () => f.app.integration.checkout(f.actor, "strict", { invoiceId }),
    { code: "RESIDENCY_BLOCKED" },
  );
  chooseProviders(f, f.actor, "choice", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["stripe", "quickbooks"],
    version: 1,
    acknowledgment: "Separate named processor choices reviewed",
  });
  const effect = f.app.integration.checkout(f.actor, "checkout", { invoiceId });
  assert.equal(
    JSON.parse(
      String(
        f.app.database
          .owned("integration")
          .get("SELECT payload FROM integration_effects WHERE id=?", effect.id)!
          .payload,
      ),
    ).amount,
    14600,
  );
  assert.throws(
    () =>
      f.app.integration.accounting(f.actor, "accounting", {
        invoiceId,
        customerRef: "1",
        itemRefs: { [f.product]: "1" },
        taxCodeRef: "1",
        taxRateRef: "1",
      }),
    { code: "OPENING_ACCOUNTING" },
  );
  assert.equal(f.app.integration.list(f.actor).length, 1);
  const csv = f.app.integration.accountingCsv(f.actor);
  assert.match(csv, /source_ref/);
  assert.match(csv, /SYNTHETIC-UNPAID-CUTOFF/);
  assert.match(csv, /DOC-1/);
  assert.match(csv, /opening/);
});

test("invalid rows and each unmatched control block the whole immutable review; corrected batches retain rejected evidence", (t) => {
  const f = fixture(t),
    input = source(f),
    a = input.rows[0] as OpeningDocument;
  const badRows: unknown[] = [
    null,
    [],
    { ...a, extra: true },
    { ...a, accountId: "foreign" },
    { ...a, balance: 14601 },
    { ...a, total: 33901 },
    { ...a, credited: 0 },
    { ...a, refunded: 10001 },
    { ...a, issuedAt: "2026-09-02T00:00:00.000Z" },
    { ...a, dueAt: "2026-07-01T00:00:00.000Z" },
    { ...a, lines: [{ ...a.lines[0], quantity: 1.5 }] },
    { ...a, lines: [{ ...a.lines[0], productId: "foreign" }] },
    { ...a, lines: [{ ...a.lines[0], creditedQuantity: 4 }] },
    { ...a, lines: [a.lines[0], a.lines[0]] },
    { ...a, paid: 22600, refunded: 0, balance: 0 },
  ];
  for (let i = 0; i < badRows.length; i++) {
    const b = f.app.migration.documents.preview(f.actor, `bad-${i}`, {
      ...input,
      batchRef: `BAD-${i}`,
      rows: [badRows[i], input.rows[1]],
    });
    assert.throws(
      () => f.app.migration.documents.decide(f.actor, `bad-${i}`, approved(b)),
      { code: "IMPORT_REJECTS" },
    );
    assert.equal(
      f.app.migration.documents.list(f.actor).find((r) => r.id === b.id)!.report
        .rows[0]!.issues.length > 0,
      true,
    );
  }
  for (const field of [
    "expectedQuantity",
    "expectedValue",
    "expectedNet",
    "expectedTax",
    "expectedCredited",
    "expectedPaid",
    "expectedRefunded",
  ] as const) {
    const b = f.app.migration.documents.preview(f.actor, field, {
      ...input,
      batchRef: field,
      [field]: input[field] + 1,
    });
    assert.throws(
      () => f.app.migration.documents.decide(f.actor, field, approved(b)),
      { code: "IMPORT_REJECTS" },
    );
  }
  for (const rows of [
    [a, a],
    [a, { ...(input.rows[1] as OpeningDocument), number: a.number }],
    [a, { ...(input.rows[1] as OpeningDocument), sourceId: a.sourceId }],
  ]) {
    const b = f.app.migration.documents.preview(
      f.actor,
      `dup-${rows[1]!.sourceId}-${rows[1]!.number}`,
      {
        ...input,
        batchRef: `DUP-${rows[1]!.sourceId}-${rows[1]!.number}`,
        rows,
      },
    );
    assert.throws(
      () =>
        f.app.migration.documents.decide(f.actor, `dup-${b.id}`, approved(b)),
      { code: "IMPORT_REJECTS" },
    );
  }
  assert.equal(f.app.billing.invoices(f.actor).length, 0);
  const bad = f.app.migration.documents.list(f.actor).at(-1)!;
  f.app.migration.documents.decide(f.actor, "reject", {
    ...approved(bad),
    decision: "reject",
  });
  const saved = f.app.migration.documents
      .list(f.actor)
      .find((b) => b.id === bad.id)!.report,
    good = f.app.migration.documents.preview(f.actor, "corrected", {
      ...input,
      batchRef: "CORRECTED",
    });
  f.app.migration.documents.decide(f.actor, "corrected", approved(good));
  assert.deepEqual(
    f.app.migration.documents.list(f.actor).find((b) => b.id === bad.id)!
      .report,
    saved,
  );
  const again = f.app.migration.documents.preview(f.actor, "reused", {
    ...input,
    batchRef: "REUSED",
    rows: input.rows.map((r: any) => ({ ...r, number: r.number + "-CHANGED" })),
  });
  assert.throws(
    () => f.app.migration.documents.decide(f.actor, "reused", approved(again)),
    { code: "IMPORT_REJECTS" },
  );
  assert.equal(f.app.billing.invoices(f.actor).length, 2);
});

test("current organization/role and fingerprint guard reviews and replays; changed masters or native invoices invalidate approvals", (t) => {
  const f = fixture(t),
    input = source(f),
    b = f.app.migration.documents.preview(f.actor, "preview", input);
  assert.throws(
    () =>
      f.app.migration.documents.decide(f.actor, "hash", {
        ...approved(b),
        reviewHash: "wrong",
      }),
    { code: "REVIEW_CHANGED" },
  );
  assert.throws(
    () =>
      f.app.migration.documents.decide(
        { ...f.actor, orgId: "foreign" },
        "foreign",
        approved(b),
      ),
    { code: "NOT_FOUND" },
  );
  f.app.identity.setHold(f.actor, "hold", {
    accountId: f.buyer,
    held: true,
    reason: "Changed after review",
  });
  assert.throws(
    () => f.app.migration.documents.decide(f.actor, "stale", approved(b)),
    { code: "IMPORT_STALE" },
  );
  f.app.identity.setHold(f.actor, "unhold", {
    accountId: f.buyer,
    held: false,
    reason: "Corrected",
  });
  const c = f.app.migration.documents.preview(f.actor, "new-preview", {
    ...input,
    batchRef: "NEW",
  });
  ship(f, accept(f).id);
  assert.throws(
    () =>
      f.app.migration.documents.decide(f.actor, "native-conflict", approved(c)),
    { code: "IMPORT_STALE" },
  );
  const clean = f.app.migration.documents.preview(f.actor, "clean", {
    ...input,
    batchRef: "CLEAN",
    rows: input.rows.map((r: any) => ({
      ...r,
      number: r.number + "-ORIGINAL",
    })),
  });
  f.app.migration.documents.decide(f.actor, "clean", approved(clean));
  const warehouse = { ...f.actor, role: "warehouse" as const };
  assert.throws(() => f.app.migration.documents.list(warehouse), {
    code: "FORBIDDEN",
  });
  assert.throws(
    () => f.app.migration.documents.decide(warehouse, "clean", approved(clean)),
    { code: "FORBIDDEN" },
  );
  const wrongBuyer = {
    ...f.actor,
    role: "buyer" as const,
    accountId: "foreign",
  };
  assert.throws(
    () =>
      f.app.billing.invoice(
        wrongBuyer,
        f.app.migration.documents.list(f.actor)[0]!.result!.mappings[0]!
          .invoiceId,
      ),
    { code: "FORBIDDEN" },
  );
});

test("late mapping failure rolls back all invoice lines/provenance/events and decisions; the unchanged retry succeeds once", (t) => {
  const f = fixture(t),
    b = f.app.migration.documents.preview(f.actor, "preview", source(f)),
    migration = f.app.database.owned("migration"),
    audits = f.app.platform.audits(f.actor),
    platform = f.app.database.owned("platform"),
    commands = platform.all("SELECT * FROM platform_commands"),
    events = platform.all("SELECT * FROM platform_events");
  migration.migrate(
    "CREATE TRIGGER migration_document_test_reject BEFORE INSERT ON migration_document_sources WHEN NEW.source_id='DOC-2' BEGIN SELECT RAISE(ABORT,'Synthetic late document mapping failure'); END;",
  );
  assert.throws(
    () => f.app.migration.documents.decide(f.actor, "apply", approved(b)),
    /Synthetic late document mapping failure/,
  );
  for (const table of [
    "billing_invoices",
    "billing_lines",
    "billing_opening_documents",
    "billing_opening_lines",
  ])
    assert.equal(
      f.app.database.owned("billing").all(`SELECT * FROM ${table}`).length,
      0,
    );
  assert.equal(
    migration.all("SELECT * FROM migration_document_sources").length,
    0,
  );
  assert.deepEqual(f.app.platform.audits(f.actor), audits);
  assert.deepEqual(platform.all("SELECT * FROM platform_commands"), commands);
  assert.deepEqual(platform.all("SELECT * FROM platform_events"), events);
  assert.equal(f.app.migration.documents.list(f.actor)[0]!.state, "ready");
  migration.migrate("DROP TRIGGER migration_document_test_reject");
  assert.equal(
    f.app.migration.documents.decide(f.actor, "apply", approved(b)).quantity,
    2,
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
  await Promise.all(
    children.map(
      (c, i) =>
        new Promise<void>((resolve, reject) => {
          c.once("message", () => resolve());
          c.once("error", reject);
          c.once("exit", (code) =>
            reject(new Error(`Document child exited ${code}`)),
          );
          c.send({
            action: "init",
            input: {
              path: f.path,
              actor: { ...f.actor, id: `reviewer-${i}` },
              key: `review-${i}`,
              documents: true,
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
          reject(new Error(`Document child exited ${code}`)),
        );
      }),
  );
  children.forEach((c) => c.send({ action: "go" }));
  return Promise.all(results);
}
test("real processes competing for overlapping historical documents have one winner; identical approvals return one permanent result", async (t) => {
  const f = fixture(t),
    input = source(f),
    a = f.app.migration.documents.preview(f.actor, "a", input),
    b = f.app.migration.documents.preview(f.actor, "b", {
      ...input,
      batchRef: "DOCUMENTS-2",
    }),
    outcomes = await compete(t, f, [a, b]);
  assert.equal(outcomes.filter((o) => o.ok).length, 1);
  assert.equal(outcomes.find((o) => !o.ok).code, "IMPORT_STALE");
  const winner = outcomes.find((o) => o.ok).result,
    batch = winner.id === a.id ? a : b,
    replay = await compete(t, f, [batch, batch]);
  assert.ok(replay.every((o) => o.ok));
  assert.deepEqual(replay[0].result, replay[1].result);
  assert.equal(f.app.billing.invoices(f.actor).length, 2);
  assert.equal(f.app.billing.exposure(f.actor, f.buyer).due, 16800);
});

test("manifest rejects foreign region, extra fields and invalid money/bounds; a separate US store imports USD without conversion", (t) => {
  const f = fixture(t),
    input = source(f);
  for (const change of [
    { region: "US" },
    { currency: "USD" },
    { version: 2 },
    { expectedNet: -1 },
    { expectedPaid: 1.5 },
    { expectedRefunded: 1e12 + 1 },
    { sourceHash: "bad" },
    { cutoffAt: "2999-01-01T00:00:00.000Z" },
    { rows: [] },
    { rows: Array(501).fill(input.rows[0]) },
    { providers: ["stripe"] },
  ])
    assert.throws(() =>
      f.app.migration.documents.preview(f.actor, "bad", {
        ...input,
        ...change,
      } as any),
    );
  assert.equal(f.app.migration.documents.list(f.actor).length, 0);
  const us = new Application(join(dirname(f.path), "us.db"), "US");
  try {
    const actor = us.identity.bootstrap(
        "Synthetic US",
        "us@example.test",
        "long-test-only-password",
        "USD",
      ),
      customer = us.identity.createCustomer(actor, "customer", {
        name: "US buyer",
        tier: "standard",
        creditLimit: 100000,
      }).id,
      product = us.catalog.create(actor, "product", {
        sku: "US-P",
        name: "US equipment",
        serialized: true,
        unitPrice: 10000,
        taxBasisPoints: 1300,
      }).id,
      b = us.migration.documents.preview(actor, "us", {
        ...input,
        batchRef: "US",
        region: "US",
        currency: "USD",
        rows: input.rows.map((r: any) => ({
          ...r,
          accountId: customer,
          lines: r.lines.map((l: any) => ({ ...l, productId: product })),
        })),
      }),
      result = us.migration.documents.decide(actor, "us", approved(b));
    assert.equal(result.value, 16800);
    assert.ok(us.billing.invoices(actor).every((i) => i.currency === "USD"));
    assert.equal(
      us.identity.customer(actor, customer).residency_mode,
      "strict",
    );
  } finally {
    us.close();
  }
});

test("encrypted populated-document recovery preserves historical and subsequent snapshot cash/mappings but excludes later cash and retains provider hold", async (t) => {
  const f = fixture(t),
    b = f.app.migration.documents.preview(f.actor, "preview", source(f)),
    result = f.app.migration.documents.decide(f.actor, "apply", approved(b)),
    invoiceId = result.mappings[1]!.invoiceId;
  f.app.billing.manualPayment(f.actor, "before", {
    invoiceId,
    amount: 1000,
    reference: "BEFORE",
    reason: "Before snapshot",
  });
  const key = randomBytes(32),
    archive = join(dirname(f.path), "documents.backup"),
    path = join(dirname(f.path), "restored.db");
  await createBackup(f.path, archive, "CA", key);
  f.app.billing.manualPayment(f.actor, "after", {
    invoiceId,
    amount: 1000,
    reference: "AFTER",
    reason: "After snapshot",
  });
  await restoreBackup(archive, path, "CA", key);
  const restored = new Application(path);
  try {
    assert.deepEqual(
      restored.migration.documents.decide(f.actor, "replay", approved(b)),
      result,
    );
    assert.deepEqual(restored.billing.totals(f.actor, invoiceId), {
      credited: 0,
      paid: 3000,
      refunded: 0,
      balance: 1200,
    });
    assert.equal(
      restored.database.owned("billing").all("SELECT * FROM billing_payments")
        .length,
      1,
    );
    assert.equal(restored.billing.exposure(f.actor, f.buyer).due, 15800);
    assert.ok(restored.platform.recoveryHold());
    assert.throws(
      () => restored.integration.checkout(f.actor, "hold", { invoiceId }),
      { code: "RECOVERY_HOLD" },
    );
  } finally {
    restored.close();
  }
});

test("HTTP validates document envelope, retains rejected source rows and checks origin/CSRF/current role before cached approvals", async (t) => {
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
      "idempotency-key": "documents-http",
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
      await post("import.documents.preview", {
        ...input,
        approvedBy: "injected",
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await post("import.documents.preview", input, { "x-csrf-token": "wrong" }))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await post("import.documents.preview", input, {
        origin: "http://foreign.test",
      })
    ).statusCode,
    403,
  );
  const rejected = await post(
    "import.documents.preview",
    {
      ...input,
      batchRef: "BAD-HTTP",
      rows: [{ ...(input.rows[0] as object), paid: "10000" }, input.rows[1]],
    },
    { "idempotency-key": "bad-rows" },
  );
  assert.equal(rejected.statusCode, 200);
  assert.equal(
    (await http.inject({ url: "/api/imports/documents", headers })).json()[0]
      .state,
    "blocked",
  );
  const preview = await post("import.documents.preview", input);
  assert.equal(preview.statusCode, 200);
  const decision = approved(preview.json()),
    approval = await post("import.documents.decide", decision);
  assert.equal(approval.statusCode, 200);
  assert.deepEqual(
    (
      await post("import.documents.decide", decision, {
        "idempotency-key": "new-key",
      })
    ).json(),
    approval.json(),
  );
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='warehouse' WHERE id=?", f.actor.id);
  assert.equal(
    (await http.inject({ url: "/api/imports/documents", headers })).statusCode,
    403,
  );
  assert.equal(
    (await post("import.documents.decide", decision)).statusCode,
    403,
  );
});
