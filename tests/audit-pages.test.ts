import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { fixture } from "./fixtures.ts";
import { Platform } from "../src/server/platform.ts";
import { Application } from "../src/server/application.ts";
import { DomainError, type Actor } from "../src/server/core.ts";
import { createHttp } from "../src/server/http.ts";

function denied(code: string, run: () => unknown) {
  assert.throws(
    run,
    (e: unknown) => e instanceof DomainError && e.code === code,
  );
}
function seed(f: ReturnType<typeof fixture>, count: number) {
  const store = f.app.database.owned("platform");
  for (let i = 0; i < count; i++)
    store.run(
      "INSERT INTO platform_audit VALUES(?,?,?,?,?,?,?)",
      `audit-${i}`,
      f.actor.orgId,
      f.actor.id,
      "SyntheticAudit",
      `ref-${i}`,
      '{"private":"never expose this detail"}',
      i % 2 ? "1999-01-01T00:00:00.000Z" : "2026-10-01T00:00:00.000Z",
    );
}
function native(f: ReturnType<typeof fixture>) {
  return {
    stock: f.app.inventory.stock(f.actor),
    orders: f.app.orders.list(f.actor),
    invoices: f.app.billing.invoices(f.actor),
  };
}
test("audit pages traverse beyond 200 in insertion order, omit details and isolate new activity", (t) => {
  const f = fixture(t);
  seed(f, 241);
  const before = native(f);
  const first = f.app.platform.auditPage(f.actor);
  assert.equal(first.items.length, 20);
  assert.equal(first.items[0]!.id, "audit-240");
  assert.equal(first.next, "audit-221");
  for (const row of first.items)
    assert.deepEqual(Object.keys(row).sort(), [
      "action",
      "actor_id",
      "created_at",
      "id",
      "reference",
    ]);
  assert.ok(!JSON.stringify(first).includes("never expose"));
  f.app.platform.audit(f.actor, "NewActivity", "new", { secret: "private" });
  const collected = [...first.items];
  let next: string | null = first.next;
  while (next) {
    const page = f.app.platform.auditPage(f.actor, next);
    assert.ok(page.items.length > 0 && page.items.length <= 20);
    collected.push(...page.items);
    next = page.next;
  }
  assert.equal(new Set(collected.map((r) => r.id)).size, collected.length);
  assert.deepEqual(
    collected.filter((r) => r.action === "SyntheticAudit").map((r) => r.id),
    Array.from({ length: 241 }, (_, i) => `audit-${240 - i}`),
  );
  assert.ok(!collected.some((r) => r.action === "NewActivity"));
  assert.equal(
    f.app.platform.auditPage(f.actor).items[0]!.action,
    "NewActivity",
  );
  assert.deepEqual(native(f), before);
});
test("audit cursors use actual organization and current role, active and password authority", (t) => {
  const f = fixture(t);
  seed(f, 30);
  const cursor = f.app.platform.auditPage(f.actor).next!;
  const iam = f.app.database.owned("iam"),
    p = f.app.database.owned("platform");
  p.run(
    "INSERT INTO platform_audit VALUES('foreign-audit','foreign-org','foreign-actor','PrivateForeign','private-ref','{}','2026-10-01')",
  );
  denied("CURSOR", () => f.app.platform.auditPage(f.actor, "foreign-audit"));
  denied("CURSOR", () => f.app.platform.auditPage(f.actor, "absent-audit"));
  denied("VALIDATION", () => f.app.platform.auditPage(f.actor, ""));
  denied("VALIDATION", () =>
    f.app.platform.auditPage(f.actor, "a".repeat(129)),
  );
  denied("FORBIDDEN", () =>
    f.app.platform.auditPage({ ...f.actor, orgId: "foreign-org" }, cursor),
  );
  for (const role of ["buyer", "warehouse", "finance", "sales"] as const) {
    iam.run("UPDATE iam_users SET role=? WHERE id=?", role, f.actor.id);
    for (const read of [
      () => f.app.platform.auditPage(f.actor, cursor),
      () => f.app.platform.audits(f.actor),
      () => f.app.platform.events(f.actor),
    ])
      denied("FORBIDDEN", read);
  }
  iam.run("UPDATE iam_users SET role='support' WHERE id=?", f.actor.id);
  assert.equal(
    f.app.platform.auditPage({ ...f.actor, role: "buyer" }, cursor).items
      .length,
    Math.min(
      20,
      Number(
        p.get(
          "SELECT COUNT(*) AS count FROM platform_audit WHERE org_id=?",
          f.actor.orgId,
        )!.count,
      ) - 20,
    ),
  );
  iam.run(
    "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
    f.actor.id,
  );
  // Bootstrap users may predate security rows; insert if absent.
  iam.run(
    "INSERT INTO iam_user_security VALUES(?,1,1,'2026-10-01') ON CONFLICT(user_id) DO UPDATE SET password_change_required=1",
    f.actor.id,
  );
  for (const read of [
    () => f.app.platform.auditPage(f.actor, cursor),
    () => f.app.platform.audits(f.actor),
    () => f.app.platform.events(f.actor),
  ])
    denied("PASSWORD_CHANGE_REQUIRED", read);
  iam.run(
    "UPDATE iam_user_security SET password_change_required=0 WHERE user_id=?",
    f.actor.id,
  );
  iam.run("UPDATE iam_users SET active=0 WHERE id=?", f.actor.id);
  denied("FORBIDDEN", () => f.app.platform.auditPage(f.actor, cursor));
});
test("synthetic Platform audit backfill preserves bytes and cursors across restart and SQLite vacuum", (t) => {
  const f = fixture(t);
  seed(f, 45);
  const p = f.app.database.owned("platform");
  p.migrate(
    "DROP TRIGGER platform_audit_sequence; DROP TABLE platform_audit_order;",
  );
  const old = p.all("SELECT * FROM platform_audit ORDER BY rowid"),
    commands = p.all("SELECT * FROM platform_commands ORDER BY rowid");
  // Restore synthetic missing owned tables before startup validates the current schema.
  new Platform(f.app.database);
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(
    f.app.database
      .owned("platform")
      .all("SELECT * FROM platform_audit ORDER BY rowid"),
    old,
  );
  assert.deepEqual(
    f.app.database
      .owned("platform")
      .all("SELECT * FROM platform_commands ORDER BY rowid"),
    commands,
  );
  const first = f.app.platform.auditPage(f.actor),
    second = f.app.platform.auditPage(f.actor, first.next!);
  f.app.close();
  const sqlite = new DatabaseSync(f.path);
  sqlite.exec("VACUUM");
  sqlite.close();
  f.app = new Application(f.path);
  assert.deepEqual(f.app.platform.auditPage(f.actor), first);
  assert.deepEqual(f.app.platform.auditPage(f.actor, first.next!), second);
  const rows = f.app.database
    .owned("platform")
    .get("SELECT COUNT(*) AS count FROM platform_audit_order")!;
  assert.equal(rows.count, old.length);
  f.app.platform.audit(f.actor, "AfterRestart", "later", {});
  assert.equal(
    f.app.platform.auditPage(f.actor).items[0]!.action,
    "AfterRestart",
  );
});
test("failed sequence insertion rolls back native mutation, receipt and original audit", (t) => {
  const f = fixture(t),
    p = f.app.database.owned("platform");
  const before = {
    warehouses: f.app.inventory.warehouses(f.actor),
    audit: p.all("SELECT * FROM platform_audit"),
    sequence: p.all("SELECT * FROM platform_audit_order"),
    commands: p.all("SELECT * FROM platform_commands"),
  };
  p.migrate(
    "CREATE TRIGGER platform_test_sequence_fault BEFORE INSERT ON platform_audit_order BEGIN SELECT RAISE(ABORT,'synthetic sequence fault'); END;",
  );
  assert.throws(
    () =>
      f.app.inventory.createWarehouse(f.actor, "audit-fault", {
        name: "Must roll back",
      }),
    /synthetic sequence fault/,
  );
  assert.deepEqual(
    {
      warehouses: f.app.inventory.warehouses(f.actor),
      audit: p.all("SELECT * FROM platform_audit"),
      sequence: p.all("SELECT * FROM platform_audit_order"),
      commands: p.all("SELECT * FROM platform_commands"),
    },
    before,
  );
});
test("independent audit writers retain unique sequences and every continuation identity", async (t) => {
  const f = fixture(t),
    original = f.app.database
      .owned("platform")
      .get("SELECT COUNT(*) AS count FROM platform_audit")!.count as number;
  async function writer(label: string) {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "tests/audit-process.ts",
        f.path,
        JSON.stringify(f.actor),
        label,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    child.stderr.on("data", (b) => (output += b));
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(output)),
      );
    });
  }
  await Promise.all([writer("one"), writer("two")]);
  const collected: string[] = [];
  let after: string | undefined;
  do {
    const page = f.app.platform.auditPage(f.actor, after);
    collected.push(...page.items.map((r) => String(r.id)));
    after = page.next ?? undefined;
  } while (after);
  assert.equal(collected.length, original + 60);
  assert.equal(new Set(collected).size, collected.length);
});
test("HTTP audit pages require sessions, enforce exact queries and redact detail with scoped cursors", async (t) => {
  const f = fixture(t);
  seed(f, 45);
  const http = await createHttp(f.app, {
    origin: "http://127.0.0.1:3000",
    staticRoot: "/nonexistent-distributor-test",
  });
  t.after(() => http.close());
  const base = "/api/audit/page";
  assert.equal((await http.inject({ url: base })).statusCode, 401);
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin: "http://127.0.0.1:3000" },
    payload: {
      email: "admin@example.test",
      password: "long-test-only-password",
    },
  });
  assert.equal(login.statusCode, 200);
  const headers = {
    cookie: login.cookies.map((c) => `${c.name}=${c.value}`).join("; "),
  };
  const first = await http.inject({ url: base, headers });
  assert.equal(first.statusCode, 200);
  assert.ok(String(first.headers["cache-control"]).includes("no-store"));
  assert.equal(first.json().items.length, 20);
  assert.ok(
    !first.body.includes("detail") &&
      !first.body.includes("requestHash") &&
      !first.body.includes("never expose"),
  );
  for (const query of [
    "?role=admin",
    "?orgId=foreign",
    "?limit=500",
    "?after=",
    `?after=${"x".repeat(129)}`,
    "?after=missing",
  ])
    assert.equal(
      (await http.inject({ url: base + query, headers })).statusCode,
      400,
    );
  const next = await http.inject({
    url: `${base}?after=${encodeURIComponent(first.json().next)}`,
    headers,
  });
  assert.equal(next.statusCode, 200);
  assert.equal(next.json().items.length, 20);
  assert.ok(
    !next
      .json()
      .items.some((r: any) =>
        first.json().items.some((p: any) => p.id === r.id),
      ),
  );
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='buyer' WHERE id=?", f.actor.id);
  assert.equal((await http.inject({ url: base, headers })).statusCode, 403);
  assert.equal(
    (await http.inject({ url: "/api/audit", headers })).statusCode,
    403,
  );
});
