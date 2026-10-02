import { test } from "node:test";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { createBackup, restoreBackup } from "../src/server/recovery.ts";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { fixture, accept, ship } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import { digest } from "../src/server/core.ts";
import {
  reconciliationCommand,
  reconciliationHash,
} from "../src/server/reconciliation-receipt.ts";
function save(f: ReturnType<typeof fixture>, key = "review") {
  return f.app.prepareReconciliation(f.actor, key, {
    expectedHash: f.app.reconciliation(f.actor).snapshotHash,
  });
}
function dump(path: string, businessOnly = false) {
  const db = new DatabaseSync(path);
  try {
    return db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .filter((r) => !businessOnly || !String(r.name).startsWith("platform_"))
      .map((r) => ({
        name: r.name,
        rows: db.prepare(`SELECT * FROM "${r.name}" ORDER BY rowid`).all(),
      }));
  } finally {
    db.close();
  }
}
for (const region of ["CA", "US"] as const)
  test(`reconciliation receipts: ${region} original bytes, replay and history survive payment and restart`, (t) => {
    const f = fixture(t, {}, region),
      invoiceId = ship(f, accept(f).id).invoiceId;
    const report = f.app.reconciliation(f.actor),
      before = dump(f.path, true);
    const receipt = f.app.prepareReconciliation(f.actor, "review", {
      expectedHash: report.snapshotHash,
    });
    assert(!("content" in receipt));
    assert.deepEqual(dump(f.path, true), before);
    const document = f.app.platform.reconciliationDocument(f.actor, receipt.id),
      bytes = document.content;
    assert.equal(digest(bytes), receipt.contentHash);
    assert.equal(Buffer.byteLength(bytes), receipt.bytes);
    const body = JSON.parse(bytes);
    assert.equal(body.orgId, f.actor.orgId);
    assert.equal(body.report.billing.balance, "11300");
    assert.equal(body.report.stock.quantity, "2");
    assert.equal(body.report.currency, region === "CA" ? "CAD" : "USD");
    assert.equal(body.limits.productGateAcceptance, false);
    f.app.billing.manualPayment(f.actor, "payment", {
      invoiceId,
      amount: 5000,
      reference: "PRIVATE-PAYMENT",
      reason: "PRIVATE-REASON",
    });
    assert.equal(f.app.reconciliation(f.actor).billing.balance, "6300");
    f.app.close();
    f.app = new Application(f.path, region);
    assert.deepEqual(
      f.app.prepareReconciliation(f.actor, "review", {
        expectedHash: report.snapshotHash,
      }),
      receipt,
    );
    assert.equal(
      f.app.platform.reconciliationDocument(f.actor, receipt.id).content,
      bytes,
    );
    assert(!bytes.includes("PRIVATE"));
    assert.deepEqual(f.app.platform.reconciliationHistory(f.actor), {
      items: [receipt],
      next: null,
    });
    const after = dump(f.path);
    f.app.platform.reconciliationDocument(f.actor, receipt.id);
    f.app.platform.reconciliationHistory(f.actor);
    assert.deepEqual(dump(f.path), after);
  });
test("reconciliation receipts: stale review and changed retry payload conserve the complete store", (t) => {
  const f = fixture(t),
    invoiceId = ship(f, accept(f).id).invoiceId;
  const old = f.app.reconciliation(f.actor);
  f.app.billing.manualPayment(f.actor, "payment", {
    invoiceId,
    amount: 1,
    reference: "PRIVATE",
    reason: "Synthetic",
  });
  let before = dump(f.path);
  assert.throws(
    () =>
      f.app.prepareReconciliation(f.actor, "stale", {
        expectedHash: old.snapshotHash,
      }),
    { code: "STALE_RECONCILIATION" },
  );
  assert.deepEqual(dump(f.path), before);
  const receipt = save(f);
  before = dump(f.path);
  assert.throws(
    () =>
      f.app.prepareReconciliation(f.actor, "review", {
        expectedHash: old.snapshotHash,
      }),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  assert.deepEqual(dump(f.path), before);
  assert.equal(
    f.app.platform.reconciliationDocument(f.actor, receipt.id).id,
    receipt.id,
  );
});
test("reconciliation receipts: displayed hash excludes time and binds the displayed controls", (t) => {
  const f = fixture(t),
    old = f.app.reconciliation(f.actor);
  assert.equal(f.app.reconciliation(f.actor).snapshotHash, old.snapshotHash);
  assert.notEqual(reconciliationHash("foreign-org", old), old.snapshotHash);
  const store = f.app.database.owned("inventory");
  store.run("UPDATE inventory_units SET quantity=2 WHERE serial='S1'");
  const first = f.app.reconciliation(f.actor);
  store.run("UPDATE inventory_units SET quantity=1 WHERE serial='S1'");
  store.run("UPDATE inventory_units SET quantity=2 WHERE serial='S2'");
  // Same product-level discrepancy: the displayed control is unchanged.
  assert.equal(f.app.reconciliation(f.actor).snapshotHash, first.snapshotHash);
  store.run("UPDATE inventory_units SET cost=7000 WHERE serial='S2'");
  assert.notEqual(
    f.app.reconciliation(f.actor).snapshotHash,
    first.snapshotHash,
  );
});
test("reconciliation receipts: finance history works while stale roles, disabled users and password changes refuse every operation", (t) => {
  const f = fixture(t),
    expectedHash = f.app.reconciliation(f.actor).snapshotHash,
    receipt = save(f);
  const iam = f.app.database.owned("iam");
  const calls = [
    () => f.app.prepareReconciliation(f.actor, "review", { expectedHash }),
    () => f.app.platform.reconciliationHistory(f.actor),
    () => f.app.platform.reconciliationDocument(f.actor, receipt.id),
  ];
  iam.run("UPDATE iam_users SET role='finance' WHERE id=?", f.actor.id);
  for (const run of calls) assert.doesNotThrow(run);
  for (const role of [
    "buyer",
    "support",
    "warehouse",
    "commercial",
    "warranty",
  ]) {
    iam.run("UPDATE iam_users SET role=? WHERE id=?", role, f.actor.id);
    const before = dump(f.path);
    for (const run of calls) assert.throws(run, { code: "FORBIDDEN" });
    assert.deepEqual(dump(f.path), before);
  }
  iam.run("UPDATE iam_users SET role='admin',active=0 WHERE id=?", f.actor.id);
  for (const run of calls) assert.throws(run);
  iam.run("UPDATE iam_users SET active=1 WHERE id=?", f.actor.id);
  iam.run(
    "INSERT INTO iam_user_security VALUES(?,1,1,?) ON CONFLICT(user_id) DO UPDATE SET password_change_required=1",
    f.actor.id,
    new Date().toISOString(),
  );
  for (const run of calls)
    assert.throws(run, { code: "PASSWORD_CHANGE_REQUIRED" });
});
test("reconciliation receipts: stable history pages ignore clock ties and new reports; cursors bind action and organization", (t) => {
  const f = fixture(t),
    ids: string[] = [];
  for (let i = 0; i < 23; i++) ids.push(save(f, `report-${i}`).id);
  const platform = f.app.database.owned("platform");
  platform.run(
    "UPDATE platform_audit SET created_at='2026-01-01T00:00:00.000Z'",
  );
  const first = f.app.platform.reconciliationHistory(f.actor);
  assert.deepEqual(
    first.items.map((r) => r.id),
    ids.slice(3).reverse(),
  );
  assert(first.next);
  platform.run(
    "INSERT INTO platform_audit VALUES('no-receipt',?,'missing-actor',?,'missing-key','{}','2026-01-01')",
    f.actor.orgId,
    reconciliationCommand,
  );
  assert.throws(
    () => f.app.platform.reconciliationHistory(f.actor, "no-receipt"),
    { code: "CURSOR" },
  );
  save(f, "new-report");
  const next = f.app.platform.reconciliationHistory(f.actor, first.next);
  assert.deepEqual(
    next.items.map((r) => r.id),
    ids.slice(0, 3).reverse(),
  );
  assert.equal(next.next, null);
  const unrelated = platform.get(
    "SELECT id FROM platform_audit WHERE action<>? LIMIT 1",
    reconciliationCommand,
  )!;
  assert.throws(
    () => f.app.platform.reconciliationHistory(f.actor, String(unrelated.id)),
    { code: "CURSOR" },
  );
  platform.run(
    "INSERT INTO platform_audit VALUES('foreign-cursor','foreign-org','foreign-actor',?,'foreign-key','{}','2026-01-01')",
    reconciliationCommand,
  );
  assert.throws(
    () => f.app.platform.reconciliationHistory(f.actor, "foreign-cursor"),
    { code: "CURSOR" },
  );
  assert(
    !JSON.stringify(f.app.platform.reconciliationHistory(f.actor)).includes(
      "foreign",
    ),
  );
});
test("reconciliation receipts: foreign receipt, metadata corruption, content drift and invalid cached JSON fail closed", (t) => {
  const f = fixture(t),
    receipt = save(f),
    platform = f.app.database.owned("platform");
  const result = platform.get(
    "SELECT result FROM platform_commands WHERE name=?",
    reconciliationCommand,
  )!;
  const original = JSON.parse(String(result.result));
  platform.run(
    "INSERT INTO platform_commands VALUES('foreign-org','foreign-actor',?,'foreign-key','hash',?,'2026-01-01')",
    reconciliationCommand,
    JSON.stringify({ ...original, id: "foreign-receipt" }),
  );
  platform.run(
    "INSERT INTO platform_audit VALUES('foreign-audit','foreign-org','foreign-actor',?,'foreign-key','{}','2026-01-01')",
    reconciliationCommand,
  );
  assert.throws(
    () => f.app.platform.reconciliationDocument(f.actor, "foreign-receipt"),
    { code: "NOT_FOUND" },
  );
  for (const altered of [
    {
      ...original,
      content: original.content.replace('"quantity":"3"', '"quantity":"4"'),
    },
    { ...original, bytes: 1 },
    { ...original, currency: "USD" },
    { ...original, preparedBy: "other" },
    { ...original, discrepancies: 99 },
  ]) {
    platform.run(
      "UPDATE platform_commands SET result=? WHERE org_id=? AND name=?",
      JSON.stringify(altered),
      f.actor.orgId,
      reconciliationCommand,
    );
    assert.throws(() => f.app.platform.reconciliationHistory(f.actor), {
      code: "REPORT_INTEGRITY",
    });
    assert.throws(
      () => f.app.platform.reconciliationDocument(f.actor, receipt.id),
      { code: "REPORT_INTEGRITY" },
    );
    assert.throws(
      () =>
        f.app.prepareReconciliation(f.actor, "review", {
          expectedHash: receipt.snapshotHash,
        }),
      { code: "REPORT_INTEGRITY" },
    );
  }
  for (const empty of [null, false, 0, []]) {
    platform.run(
      "UPDATE platform_commands SET result=? WHERE org_id=? AND name=?",
      JSON.stringify(empty),
      f.actor.orgId,
      reconciliationCommand,
    );
    assert.throws(
      () =>
        f.app.prepareReconciliation(f.actor, "review", {
          expectedHash: receipt.snapshotHash,
        }),
      { code: "REPORT_INTEGRITY" },
    );
  }
  platform.run(
    "UPDATE platform_commands SET result='invalid-json' WHERE org_id=? AND name=?",
    f.actor.orgId,
    reconciliationCommand,
  );
  assert.throws(() => f.app.platform.reconciliationHistory(f.actor), {
    code: "REPORT_INTEGRITY",
  });
  assert.throws(
    () =>
      f.app.prepareReconciliation(f.actor, "review", {
        expectedHash: receipt.snapshotHash,
      }),
    { code: "REPORT_INTEGRITY" },
  );
});
test("reconciliation receipts: late audit failure rolls back retained bytes and releases writer lock", (t) => {
  const f = fixture(t),
    before = dump(f.path),
    audit = f.app.platform.audit;
  f.app.platform.audit = () => {
    throw Error("Synthetic late audit failure");
  };
  assert.throws(() => save(f), /Synthetic late audit failure/);
  assert.deepEqual(dump(f.path), before);
  f.app.platform.audit = audit;
  assert.equal(save(f).discrepancies, 0);
});
test("reconciliation receipts: scan failure and oversized report save nothing", (t) => {
  const f = fixture(t),
    before = dump(f.path),
    original = f.app.inventory.controlTotals.bind(f.app.inventory);
  f.app.inventory.controlTotals = () => {
    throw Error("Synthetic scan failure");
  };
  assert.throws(
    () =>
      f.app.prepareReconciliation(f.actor, "fail", {
        expectedHash: "0".repeat(64),
      }),
    /Synthetic scan failure/,
  );
  assert.deepEqual(dump(f.path), before);
  f.app.inventory.controlTotals = original;
  f.app.database
    .owned("inventory")
    .run(
      "UPDATE inventory_units SET product_id=?,quantity=2 WHERE serial='S1'",
      "x".repeat(524288),
    );
  const reviewed = f.app.reconciliation(f.actor),
    changed = dump(f.path);
  assert.throws(
    () =>
      f.app.prepareReconciliation(f.actor, "too-large", {
        expectedHash: reviewed.snapshotHash,
      }),
    { code: "REPORT_SIZE" },
  );
  assert.deepEqual(dump(f.path), changed);
});
test("reconciliation receipts: independent writer cannot change controls between review recheck and receipt commit", (t) => {
  const f = fixture(t),
    expectedHash = f.app.reconciliation(f.actor).snapshotHash;
  const competing = new DatabaseSync(f.path);
  competing.exec("PRAGMA busy_timeout=0");
  const original = f.app.billing.controlTotals.bind(f.app.billing);
  f.app.billing.controlTotals = (actor, currency) => {
    assert.throws(
      () =>
        competing.exec(
          "UPDATE inventory_units SET quantity=2 WHERE serial='S1'",
        ),
      /locked/,
    );
    return original(actor, currency);
  };
  try {
    assert.equal(
      f.app.prepareReconciliation(f.actor, "locked", { expectedHash })
        .discrepancies,
      0,
    );
  } finally {
    competing.close();
  }
});
test("reconciliation receipts: HTTP requires session, CSRF, exact schema and current role; download is private exact bytes", async (t) => {
  const f = fixture(t),
    origin = "http://127.0.0.1:3000",
    http = await createHttp(f.app, { origin, staticRoot: "/nonexistent" });
  t.after(() => http.close());
  for (const url of [
    "/api/operations/reconciliation/history",
    "/api/operations/reconciliation/missing/document",
  ])
    assert.equal((await http.inject({ url })).statusCode, 401);
  const login = await http.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: {
        email: "admin@example.test",
        password: "long-test-only-password",
      },
    }),
    cookie = login.cookies[0]!;
  const headers = {
    origin,
    cookie: `${cookie.name}=${cookie.value}`,
    "x-csrf-token": login.json().csrf,
    "idempotency-key": "http-review",
  };
  const report = (
    await http.inject({ url: "/api/operations/reconciliation", headers })
  ).json();
  const payload = { expectedHash: report.snapshotHash },
    url = `/api/commands/${reconciliationCommand}`;
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url,
        headers: { cookie: headers.cookie, origin },
        payload,
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
        payload: { ...payload, unexpected: true },
      })
    ).statusCode,
    400,
  );
  const saved = await http.inject({ method: "POST", url, headers, payload });
  assert.equal(saved.statusCode, 200);
  const receipt = saved.json();
  assert(!saved.body.includes('"content":'));
  const downloaded = await http.inject({
    url: `/api/operations/reconciliation/${receipt.id}/document`,
    headers,
  });
  assert.equal(downloaded.statusCode, 200);
  assert.equal(downloaded.headers["cache-control"], "no-store");
  assert.equal(
    downloaded.headers["content-disposition"],
    `attachment; filename="${receipt.filename}"`,
  );
  assert.equal(downloaded.headers["x-download-receipt"], receipt.id);
  assert.equal(digest(downloaded.rawPayload), receipt.contentHash);
  assert.equal(
    downloaded.body,
    f.app.platform.reconciliationDocument(f.actor, receipt.id).content,
  );
  assert.equal(
    (
      await http.inject({
        url: "/api/operations/reconciliation/history?after=missing",
        headers,
      })
    ).statusCode,
    400,
  );
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='warehouse' WHERE id=?", f.actor.id);
  for (const path of [
    "/api/operations/reconciliation/history",
    `/api/operations/reconciliation/${receipt.id}/document`,
  ])
    assert.equal((await http.inject({ url: path, headers })).statusCode, 403);
  assert.equal(
    (await http.inject({ method: "POST", url, headers, payload })).statusCode,
    403,
  );
});
test("reconciliation receipts: HTTP MFA policy blocks retained history, bytes and cached save", async (t) => {
  const f = fixture(t, {
      mfaEncryptionKey: "a".repeat(64),
      mfaRequiredRoles: ["admin"],
    }),
    receipt = save(f),
    origin = "http://127.0.0.1:3000",
    http = await createHttp(f.app, { origin, staticRoot: "/nonexistent" });
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
    cookie = login.cookies[0]!;
  const headers = {
    origin,
    cookie: `${cookie.name}=${cookie.value}`,
    "x-csrf-token": login.json().csrf,
    "idempotency-key": "review",
  };
  for (const url of [
    "/api/operations/reconciliation/history",
    `/api/operations/reconciliation/${receipt.id}/document`,
  ]) {
    const r = await http.inject({ url, headers });
    assert.equal(r.statusCode, 403);
    assert.equal(r.json().code, "MFA_ENROLLMENT_REQUIRED");
  }
  const r = await http.inject({
    method: "POST",
    url: `/api/commands/${reconciliationCommand}`,
    headers,
    payload: { expectedHash: receipt.snapshotHash },
  });
  assert.equal(r.statusCode, 403);
  assert.equal(r.json().code, "MFA_ENROLLMENT_REQUIRED");
});

test("reconciliation receipts: encrypted cutoff restore retains original bytes and pages while isolating providers", async (t) => {
  const f = fixture(t),
    original = save(f),
    content = f.app.platform.reconciliationDocument(
      f.actor,
      original.id,
    ).content,
    key = randomBytes(32),
    archive = join(dirname(f.path), "reports.backup"),
    restoredPath = join(dirname(f.path), "reports-restored.db");
  await createBackup(f.path, archive, "CA", key);
  const later = save(f, "after-cutoff");
  await restoreBackup(archive, restoredPath, "CA", key);
  const restored = new Application(restoredPath);
  t.after(() => restored.close());
  assert.deepEqual(restored.platform.reconciliationHistory(f.actor), {
    items: [original],
    next: null,
  });
  assert.equal(
    restored.platform.reconciliationDocument(f.actor, original.id).content,
    content,
  );
  assert.throws(
    () => restored.platform.reconciliationDocument(f.actor, later.id),
    { code: "NOT_FOUND" },
  );
  assert(restored.platform.recoveryHold());
  assert.throws(() => restored.platform.assertProviderAccess(), {
    code: "RECOVERY_HOLD",
  });
  assert.deepEqual(
    restored.prepareReconciliation(f.actor, "review", {
      expectedHash: original.snapshotHash,
    }),
    original,
  );
});
test("reconciliation receipts: exact integer strings, full issue counts and first hundred details remain in exports", (t) => {
  const f = fixture(t),
    billing = f.app.database.owned("billing");
  f.app.database
    .owned("inventory")
    .run(
      "UPDATE inventory_units SET quantity=9007199254740993,cost=9007199254740993",
    );
  for (let i = 0; i < 125; i++)
    billing.run(
      "INSERT INTO billing_payments VALUES(?,?,?,?,?,?,?)",
      `orphan-${i}`,
      f.actor.orgId,
      "missing",
      "manual",
      `PRIVATE-${i}`,
      1,
      new Date().toISOString(),
    );
  const receipt = save(f),
    report = JSON.parse(
      f.app.platform.reconciliationDocument(f.actor, receipt.id).content,
    ).report;
  assert.equal(report.stock.quantity, String(3n * 9007199254740993n));
  assert.equal(report.stock.value, String(3n * 9007199254740993n ** 2n));
  assert.equal(report.billing.issues.count, 125);
  assert.equal(report.billing.issues.items.length, 100);
  assert.equal(report.billing.issues.truncated, true);
  assert.equal(
    receipt.discrepancies,
    report.stock.issues.count +
      report.billing.issues.count +
      report.sales.issues.count,
  );
  assert(!JSON.stringify(report).includes("PRIVATE"));
});
