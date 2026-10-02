import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.ts";
import { seedSupplierReturns } from "./supplier-return-queue-fixture.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import { Store } from "../src/server/database.ts";
import type { SQLInputValue } from "node:sqlite";
import type { Actor, Role } from "../src/server/core.ts";

const cursor = (id: string, q = "") =>
  Buffer.from(JSON.stringify([1, q, id])).toString("base64url");
function user(f: ReturnType<typeof fixture>, role: Role, sites = [f.w1]) {
  const u = f.app.identity.createUser(f.actor, `${role}-${sites.join()}`, {
    email: `${role}-${sites.join()}@example.test`,
    name: role,
    password: "long-test-only-password",
    role,
    sites: role === "buyer" ? [] : sites,
    ...(role === "buyer" ? { accountId: f.buyer } : {}),
  });
  return f.app.identity.currentActor({ ...f.actor, id: u.id });
}
function grants(
  f: ReturnType<typeof fixture>,
  actor: Actor,
  changes: Record<string, unknown>,
) {
  const u = f.app.identity.users(f.actor).find((u) => u.id === actor.id)!;
  f.app.identity.updateUser(f.actor, `grant-${u.id}-${u.revision}`, {
    userId: actor.id,
    revision: Number(u.revision),
    email: String(u.email),
    name: actor.name,
    role: actor.role,
    sites: actor.sites,
    active: true,
    currentPassword: "long-test-only-password",
    reason: "Synthetic scope review",
    ...changes,
  });
}
function facts(f: ReturnType<typeof fixture>) {
  return ["orders", "lines", "receipts", "returns", "return_followups"]
    .map((table) =>
      f.app.database
        .owned("procurement")
        .all(`SELECT * FROM procurement_${table} ORDER BY rowid`),
    )
    .concat(
      ["units", "movements", "allocations"].map((table) =>
        f.app.database
          .owned("inventory")
          .all(`SELECT * FROM inventory_${table} ORDER BY rowid`),
      ),
      ["commands", "audit", "events"].map((table) =>
        f.app.database
          .owned("platform")
          .all(`SELECT * FROM platform_${table} ORDER BY rowid`),
      ),
    );
}
for (const region of ["CA", "US"] as const)
  test(`supplier return pages are read-only, bounded before summary, deterministic across restart in ${region}`, (t) => {
    const f = fixture(t, {}, region),
      ids = seedSupplierReturns(f);
    f.app.database
      .owned("procurement")
      .run(
        "UPDATE procurement_returns SET created_at='2026-10-01T00:00:00.000Z'",
      );
    const before = facts(f),
      original = Store.prototype.all,
      queries: string[] = [];
    Store.prototype.all = function <T extends Record<string, any>>(
      sql: string,
      ...params: SQLInputValue[]
    ): T[] {
      queries.push(sql);
      return original.call(this, sql, ...params) as T[];
    };
    let first: ReturnType<typeof f.app.procurement.returnPage>;
    try {
      first = f.app.procurement.returnPage(f.actor);
    } finally {
      Store.prototype.all = original;
    }
    assert.equal(first.items.length, 20);
    assert.ok(
      queries.some(
        (q) => q.includes("FROM procurement_returns") && q.endsWith("LIMIT 21"),
      ),
    );
    const summaryIds: string[] = [],
      summary = f.app.procurement.followups.summary.bind(
        f.app.procurement.followups,
      );
    f.app.procurement.followups.summary = (actor, id) => {
      summaryIds.push(id);
      return summary(actor, id);
    };
    assert.deepEqual(f.app.procurement.returnPage(f.actor), first);
    assert.deepEqual(
      summaryIds,
      first.items.map((r) => r.id),
    );
    assert.ok(
      first.items.every(
        (r) =>
          !("input_hash" in r) &&
          r.followup.currency === (region === "CA" ? "CAD" : "USD"),
      ),
    );
    f.app.close();
    f.app = new Application(f.path, region);
    assert.deepEqual(f.app.procurement.returnPage(f.actor), first);
    const second = f.app.procurement.returnPage(f.actor, {
      after: first.next!,
    });
    const third = f.app.procurement.returnPage(f.actor, {
      after: second.next!,
    });
    assert.equal(third.next, null);
    assert.deepEqual(
      [...first.items, ...second.items, ...third.items].map((r) => r.id),
      ids.sort().reverse(),
    );
    assert.deepEqual(facts(f), before);
  });
test("supplier return search is literal, cursor-bound and does not invent financial outcomes", (t) => {
  const f = fixture(t),
    ids = seedSupplierReturns(f);
  const first = f.app.procurement.returnPage(f.actor, { q: "  quEUE  " });
  assert.equal(first.items.length, 20);
  assert.equal(
    f.app.procurement.returnPage(f.actor, { q: "%_" }).items[0]!.id,
    ids[0],
  );
  assert.equal(
    f.app.procurement.returnPage(f.actor, { q: "QUEUE-000" }).items[0]!.id,
    ids[0],
  );
  assert.deepEqual(f.app.procurement.returnPage(f.actor, { q: "missing" }), {
    items: [],
    next: null,
  });
  for (const after of [
    "!",
    first.next! + "=",
    cursor(ids[0]!, "wrong"),
    Buffer.from(JSON.stringify([2, "queue", ids[0]])).toString("base64url"),
  ])
    assert.throws(
      () => f.app.procurement.returnPage(f.actor, { q: "queue", after }),
      { code: "VALIDATION" },
    );
  for (const q of [null, 1, "x".repeat(161)])
    assert.throws(
      () => f.app.procurement.returnPage(f.actor, { q: q as any }),
      { code: "VALIDATION" },
    );
  assert.throws(
    () => f.app.procurement.returnPage(f.actor, { after: cursor("missing") }),
    { code: "NOT_FOUND" },
  );
  f.app.procurement.followups.credit(f.actor, "credit", {
    returnId: ids[0]!,
    revision: 0,
    reference: "CREDIT",
    evidence: "Synthetic credit",
    amount: 300,
    currency: "CAD",
  });
  const r = f.app.procurement.returnPage(f.actor, { q: "QUEUE-000" }).items[0]!;
  assert.equal(r.followup.creditAmount, 300);
  assert.equal(r.followup.originalCost, 250);
  assert.equal(
    f.app.procurement.followups.history(f.actor, r.id).items.length,
    1,
  );
});
test("supplier return queue and anchors recheck organization, role and current site grants even for empty search", (t) => {
  const f = fixture(t),
    ids = seedSupplierReturns(f, 25),
    others = seedSupplierReturns(f, 25, "OTHER", f.w2);
  const warehouse = user(f, "warehouse"),
    finance = user(f, "finance"),
    buyer = user(f, "buyer");
  const first = f.app.procurement.returnPage(warehouse);
  assert.ok(first.items.every((r) => r.warehouse_id === f.w1));
  assert.throws(
    () =>
      f.app.procurement.returnPage(warehouse, { after: cursor(others[0]!) }),
    { code: "NOT_FOUND" },
  );
  assert.throws(() => f.app.procurement.returnPage(buyer, { q: "missing" }), {
    code: "FORBIDDEN",
  });
  assert.equal(f.app.procurement.returnPage(finance).items.length, 20);
  assert.throws(
    () => f.app.procurement.returnPage({ ...warehouse, orgId: "wrong" }),
    { code: "FORBIDDEN" },
  );
  grants(f, warehouse, { sites: [f.w2] });
  assert.throws(
    () => f.app.procurement.returnPage(warehouse, { after: first.next! }),
    { code: "NOT_FOUND" },
  );
  assert.ok(
    f.app.procurement
      .returnPage(warehouse)
      .items.every((r) => r.warehouse_id === f.w2),
  );
  grants(f, finance, { active: false });
  assert.throws(() => f.app.procurement.returnPage(finance, { q: "missing" }), {
    code: "FORBIDDEN",
  });
  assert.ok(ids.length);
});
test("HTTP purchasing exposes twenty return headers, scoped search and strict query validation", async (t) => {
  const f = fixture(t);
  seedSupplierReturns(f);
  const http = await createHttp(f.app, { origin: "http://localhost" });
  t.after(() => http.close());
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin: "http://localhost" },
    payload: {
      email: "admin@example.test",
      password: "long-test-only-password",
    },
  });
  assert.equal(login.statusCode, 200);
  const c = login.cookies[0]!,
    headers = { cookie: `${c.name}=${c.value}` };
  const overview = await http.inject({ url: "/api/purchases", headers });
  assert.equal(overview.statusCode, 200);
  assert.equal(overview.json().returns.length, 20);
  assert.ok(overview.json().returnNext);
  const search = await http.inject({
    url: "/api/purchases/returns/page?q=QUEUE-000",
    headers,
  });
  assert.equal(search.statusCode, 200);
  assert.equal(search.json().items.length, 1);
  for (const suffix of ["?extra=1", "?after=", "?q=" + "x".repeat(161)])
    assert.equal(
      (
        await http.inject({
          url: "/api/purchases/returns/page" + suffix,
          headers,
        })
      ).statusCode,
      400,
    );
  assert.equal(
    (await http.inject({ url: "/api/purchases/returns/page" })).statusCode,
    401,
  );
});
