import { test } from "node:test";
import type { SQLInputValue } from "node:sqlite";
import type { Row } from "../src/server/core.ts";
import assert from "node:assert/strict";
import { Application } from "../src/server/application.ts";
import { Store } from "../src/server/database.ts";
import { createHttp } from "../src/server/http.ts";
import { fixture } from "./fixtures.ts";
import { seedClaimQueue } from "./claim-queue-fixture.ts";
import { warrantyUser, warrantyGrants } from "./warranty-authority-fixtures.ts";

const cursor = (id: string, state: string | null = null) =>
  Buffer.from(JSON.stringify([1, state, id])).toString("base64url");
function retained(f: ReturnType<typeof fixture>) {
  return ["warranty", "inventory", "billing", "platform"].map((owner) => {
    const tables = {
      warranty: [
        "claims",
        "decisions",
        "claim_coverage",
        "manufacturer_cases",
        "replacements",
      ],
      inventory: ["units", "movements", "allocations"],
      billing: ["invoices", "credits", "payments"],
      platform: ["commands", "audit", "events"],
    }[owner]!;
    return tables.map((table) =>
      f.app.database
        .owned(owner as "warranty")
        .all(`SELECT * FROM ${owner}_${table} ORDER BY rowid`),
    );
  });
}
test("claim queue has bounded deterministic newest-first pages across tied timestamps, restart and later appends", (t) => {
  const f = fixture(t),
    claims = seedClaimQueue(f);
  f.app.database
    .owned("warranty")
    .run("UPDATE warranty_claims SET created_at='2000-01-01T00:00:00.000Z'");
  const before = retained(f);
  const first = f.app.warranty.claimPage(f.actor);
  assert.equal(first.items.length, 20);
  assert.equal(first.next, cursor(claims[25]!.id));
  assert.deepEqual(f.app.dashboard(f.actor).claims, first.items);
  assert.equal(f.app.dashboard(f.actor).claimNext, first.next);
  f.app.close();
  f.app = new Application(f.path, "CA");
  assert.deepEqual(f.app.warranty.claimPage(f.actor), first);
  assert.deepEqual(retained(f), before);
  seedClaimQueue(f, 1, "later");
  const second = f.app.warranty.claimPage(f.actor, { after: first.next! });
  const third = f.app.warranty.claimPage(f.actor, { after: second.next! });
  assert.equal(second.items.length, 20);
  assert.equal(third.items.length, 5);
  assert.equal(third.next, null);
  assert.deepEqual(
    [...first.items, ...second.items, ...third.items].map((c) => c.id),
    claims.map((c) => c.id).reverse(),
  );
  assert.equal(
    new Set([...first.items, ...second.items, ...third.items].map((c) => c.id))
      .size,
    45,
  );
});
test("state filters bind continuations but cursor state changes do not break traversal; lookahead and claim reads are bounded", (t) => {
  const f = fixture(t),
    claims = seedClaimQueue(f);
  const before = retained(f);
  const original = Store.prototype.all;
  const queries: string[] = [];
  Store.prototype.all = function <T extends Row = Row>(
    sql: string,
    ...parameters: SQLInputValue[]
  ): T[] {
    if (sql.includes("FROM warranty_claims")) queries.push(sql);
    return original.call(this, sql, ...parameters) as T[];
  };
  let first: ReturnType<typeof f.app.warranty.claimPage>;
  try {
    first = f.app.warranty.claimPage(f.actor, { state: "submitted" });
  } finally {
    Store.prototype.all = original;
  }
  assert.equal(first!.items.length, 20);
  assert.ok(first!.items.every((c) => c.state === "submitted"));
  assert.ok(
    queries.length > 0 &&
      queries.every(
        (sql) => sql.includes("LIMIT 21") && sql.includes("state=?"),
      ),
  );
  assert.deepEqual(retained(f), before);
  assert.throws(
    () =>
      f.app.warranty.claimPage(f.actor, {
        state: "rejected",
        after: first!.next!,
      }),
    { code: "VALIDATION" },
  );
  f.app.warranty.review(f.actor, "cursor-review", {
    claimId: first!.items[19]!.id,
    approved: false,
    reason: "Synthetic concurrent review",
  });
  const second = f.app.warranty.claimPage(f.actor, {
    state: "submitted",
    after: first!.next!,
  });
  assert.equal(second.items.length, 10);
  assert.equal(second.next, null);
  assert.deepEqual(
    [...first!.items, ...second.items].map((c) => c.id),
    claims
      .filter((_, i) => i % 3 !== 0)
      .map((c) => c.id)
      .reverse(),
  );
  assert.equal(
    f.app.warranty.claimPage(f.actor, { state: "rejected" }).items.length,
    16,
  );
  assert.deepEqual(f.app.warranty.claimPage(f.actor, { state: "repair" }), {
    items: [],
    next: null,
  });
});
test("warehouse paging skips whole batches outside current custody grants and refuses revoked cursors", (t) => {
  const f = fixture(t),
    own = seedClaimQueue(f, 25);
  seedClaimQueue(f, 25, "other-site", f.w2);
  const warehouse = warrantyUser(f, "warehouse");
  const first = f.app.warranty.claimPage(warehouse),
    second = f.app.warranty.claimPage(warehouse, { after: first.next! });
  assert.deepEqual(
    [...first.items, ...second.items].map((c) => c.id),
    own.map((c) => c.id).reverse(),
  );
  warrantyGrants(f, warehouse, { sites: [f.w2] });
  assert.throws(
    () => f.app.warranty.claimPage(warehouse, { after: first.next! }),
    { code: "FORBIDDEN" },
  );
  assert.equal(f.app.warranty.claimPage(warehouse).items.length, 20);
  warrantyGrants(f, warehouse, { sites: [] });
  assert.deepEqual(f.app.warranty.claimPage(warehouse), {
    items: [],
    next: null,
  });
});
test("buyers cannot traverse another account and fresh identity, role, password and organization authority precede cursor reads", (t) => {
  const f = fixture(t),
    claims = seedClaimQueue(f, 25);
  const other = f.app.identity.createCustomer(f.actor, "other", {
    name: "Other buyer",
    tier: "standard",
    creditLimit: 1000000,
  }).id;
  f.app.catalog.setPurchasingPolicy(f.actor, "explicit-purchasing-" + other, {
    accountId: other,
    mode: "all",
    requiresReview: false,
    productIds: [],
    revision: 0,
    reason: "Explicit synthetic test catalog access",
  });
  const foreign = seedClaimQueue(f, 2, "other-account", f.w1, other);
  const buyer = warrantyUser(f, "buyer");
  assert.equal(f.app.warranty.claimPage(buyer).items.length, 20);
  assert.ok(
    f.app.warranty
      .claimPage(buyer)
      .items.every(
        (c) => c.account_id === f.buyer && c.manufacturerCases.length === 0,
      ),
  );
  assert.throws(
    () => f.app.warranty.claimPage(buyer, { after: cursor(foreign[0]!.id) }),
    { code: "FORBIDDEN" },
  );
  const first = f.app.warranty.claimPage(buyer);
  warrantyGrants(f, buyer, { accountId: other });
  assert.throws(() => f.app.warranty.claimPage(buyer, { after: first.next! }), {
    code: "FORBIDDEN",
  });
  assert.equal(
    f.app.warranty.claimPage({ ...buyer, accountId: f.buyer }).items.length,
    2,
  );
  warrantyGrants(f, buyer, { active: false });
  assert.throws(() => f.app.warranty.claimPage(buyer, { after: "invalid" }), {
    code: "FORBIDDEN",
  });
  const staff = warrantyUser(f, "finance");
  warrantyGrants(f, staff, { role: "support" });
  assert.throws(() => f.app.warranty.claimPage(staff, { after: "invalid" }), {
    code: "FORBIDDEN",
  });
  const forced = warrantyUser(f, "commercial");
  f.app.identity.resetPassword(f.actor, "force", {
    userId: forced.id,
    revision: Number(
      f.app.identity.users(f.actor).find((u) => u.id === forced.id)!.revision,
    ),
    password: "changed-test-password",
    currentPassword: "long-test-only-password",
    reason: "Synthetic reset",
  });
  assert.throws(() => f.app.warranty.claimPage(forced, { after: "invalid" }), {
    code: "PASSWORD_CHANGE_REQUIRED",
  });
  assert.throws(
    () =>
      f.app.warranty.claimPage(
        { ...f.actor, orgId: "foreign" },
        { after: cursor(claims[0]!.id) },
      ),
    { code: "FORBIDDEN" },
  );
});
test("HTTP queue validates exact fields, malformed and unavailable cursors; revoked sessions cannot fetch another page", async (t) => {
  const f = fixture(t);
  seedClaimQueue(f, 25);
  const buyer = warrantyUser(f, "buyer"),
    user = f.app.identity.users(f.actor).find((u) => u.id === buyer.id)!;
  const http = await createHttp(f.app, { origin: "http://localhost" });
  t.after(() => http.close());
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin: "http://localhost" },
    payload: { email: user.email, password: "long-user-test-password" },
  });
  assert.equal(login.statusCode, 200);
  const cookie = login.cookies[0]!,
    headers = { cookie: `${cookie.name}=${cookie.value}` };
  const url = "/api/warranty/claims/page";
  const first = await http.inject({ method: "GET", url, headers });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().items.length, 20);
  assert.ok(
    first
      .json()
      .items.every(
        (c: any) => c.manufacturerCases.length === 0 && !("position" in c),
      ),
  );
  for (const query of [
    "?state=missing",
    "?state=",
    "?after=",
    "?after=" + "a".repeat(513),
    "?after=invalid",
    "?after=" + cursor("missing"),
    "?limit=999",
    "?accountId=foreign",
    "?unknown=1",
  ]) {
    const response = await http.inject({
      method: "GET",
      url: url + query,
      headers,
    });
    assert.ok([400, 404].includes(response.statusCode), query + response.body);
  }
  warrantyGrants(f, buyer, { active: false });
  assert.equal(
    (
      await http.inject({
        method: "GET",
        url: url + "?after=" + first.json().next,
        headers,
      })
    ).statusCode,
    401,
  );
});
