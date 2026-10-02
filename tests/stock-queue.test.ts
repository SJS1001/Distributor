import { test } from "node:test";
import assert from "node:assert/strict";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import { Store } from "../src/server/database.ts";
import type { Actor, Role, Row } from "../src/server/core.ts";
import type { SQLInputValue } from "node:sqlite";
import { fixture } from "./fixtures.ts";
import { seedStockQueue, inspectedClaim } from "./stock-queue-fixture.ts";
function user(f: ReturnType<typeof fixture>, role: Role, sites = [f.w1]) {
  const row = f.app.identity.createUser(f.actor, `stock-${role}`, {
    email: `stock-${role}@example.test`,
    name: role,
    password: "long-test-only-password",
    role,
    sites: role === "buyer" ? [] : sites,
    accountId: role === "buyer" ? f.buyer : undefined,
  });
  return f.app.identity.currentActor({ ...f.actor, id: row.id });
}
function change(
  f: ReturnType<typeof fixture>,
  actor: Actor,
  changes: Record<string, unknown>,
) {
  const row = f.app.identity.users(f.actor).find((u) => u.id === actor.id)!;
  f.app.identity.updateUser(f.actor, `stock-change-${row.id}-${row.revision}`, {
    userId: actor.id,
    revision: row.revision,
    email: row.email,
    name: actor.name,
    role: actor.role,
    sites: actor.sites,
    accountId: actor.accountId ?? undefined,
    active: true,
    currentPassword: "long-test-only-password",
    reason: "Synthetic stock scope change",
    ...changes,
  });
}
function facts(f: ReturnType<typeof fixture>) {
  return ["units", "allocations", "replacements", "movements", "counts"]
    .map((table) =>
      f.app.database
        .owned("inventory")
        .all(`SELECT * FROM inventory_${table} ORDER BY rowid`),
    )
    .concat(
      ["commands", "audit", "events"].map((table) =>
        f.app.database
          .owned("platform")
          .all(`SELECT * FROM platform_${table} ORDER BY rowid`),
      ),
    );
}
test("stock dashboard bounds rows while overview availability covers the entire scope", (t) => {
  const f = fixture(t);
  seedStockQueue(f);
  const before = facts(f),
    view = f.app.dashboard(f.actor);
  assert.equal(view.stock.length, 20);
  assert.ok(view.stockNext);
  assert.deepEqual(view.stockSummary, { available: 18 });
  assert.notEqual(
    view.stock.reduce((sum, u) => sum + u.available, 0),
    18,
  );
  assert.deepEqual(facts(f), before);
});
test("stock traversal is deterministic across restart and live filters preserve changed anchors", (t) => {
  const f = fixture(t),
    ids = seedStockQueue(f),
    first = f.app.inventory.stockPage(f.actor, { productId: f.product });
  f.app.close();
  f.app = new Application(f.path, "CA");
  assert.deepEqual(
    f.app.inventory.stockPage(f.actor, { productId: f.product }),
    first,
  );
  const second = f.app.inventory.stockPage(f.actor, {
      productId: f.product,
      after: first.next!,
    }),
    third = f.app.inventory.stockPage(f.actor, {
      productId: f.product,
      after: second.next!,
    });
  assert.equal(second.items.length, 20);
  assert.equal(third.items.length, 8);
  assert.equal(third.next, null);
  assert.deepEqual(
    [...first.items, ...second.items, ...third.items]
      .filter((u) => ids.includes(u.id))
      .map((u) => u.id),
    ids,
  );
  const available = f.app.inventory.stockPage(f.actor, { view: "available" });
  seedStockQueue(f, 45, f.w1, "001-stock");
  const page = f.app.inventory.stockPage(f.actor, { view: "available" });
  assert.ok(page.next);
  const anchor = page.items[19]!;
  f.app.inventory.inspect(f.actor, "anchor-quarantine", {
    unitId: anchor.id,
    revision: anchor.revision,
    condition: "quarantine",
    reason: "Synthetic live change",
  });
  const next = f.app.inventory.stockPage(f.actor, {
    view: "available",
    after: page.next!,
  });
  assert.ok(next.items.every((u) => u.id > anchor.id && u.available > 0));
  assert.equal(available.items.length, 18);
});
test("stock filters precede SQL limit, search is literal and native reservations affect pages and totals", (t) => {
  const f = fixture(t),
    ids = seedStockQueue(f, 90),
    before = facts(f),
    all = Store.prototype.all,
    queries: { sql: string; params: SQLInputValue[] }[] = [];
  Store.prototype.all = function <T extends Row = Row>(
    sql: string,
    ...params: SQLInputValue[]
  ): T[] {
    if (sql.includes("FROM inventory_units")) queries.push({ sql, params });
    return all.call(this, sql, ...params) as T[];
  };
  try {
    const page = f.app.inventory.stockPage(f.actor, {
      view: "quarantine",
      productId: f.product,
    });
    assert.equal(page.items.length, 20);
    assert.ok(page.next);
    assert.ok(page.items.every((u) => u.condition === "quarantine"));
  } finally {
    Store.prototype.all = all;
  }
  assert.equal(queries.length, 1);
  assert.match(queries[0]!.sql, /LIMIT 21/);
  assert.match(queries[0]!.sql, /condition='quarantine'/);
  assert.deepEqual(facts(f), before);
  assert.deepEqual(
    f.app.inventory
      .stockPage(f.actor, { query: "QUEUE-000-STOCK-087" })
      .items.map((u) => u.id),
    [ids[87]],
  );
  assert.equal(
    f.app.inventory.stockPage(f.actor, { query: "%" }).items.length,
    0,
  );
  assert.equal(
    f.app.inventory.stockPage(f.actor, { query: "_" }).items.length,
    0,
  );
  assert.equal(
    f.app.inventory.stockPage(f.actor, { query: "B-89" }).items[0]!.id,
    ids[89],
  );
  f.app.database
    .owned("inventory")
    .run(
      "INSERT INTO inventory_replacements VALUES(?,?,?,'reserved')",
      "synthetic-hold",
      f.actor.orgId,
      ids[0]!,
    );
  assert.equal(f.app.inventory.stockSummary(f.actor).available, 32);
  assert.equal(
    f.app.inventory.stockPage(f.actor, {
      query: "QUEUE-000-STOCK-000",
      view: "available",
    }).items.length,
    0,
  );
});
test("stock scope is applied before paging and aggregate, current grants fence cursors and empty sites", (t) => {
  const f = fixture(t);
  seedStockQueue(f, 45, f.w2, "000-hidden");
  seedStockQueue(f, 45, f.w1, "001-visible");
  const actor = user(f, "warehouse"),
    before = facts(f),
    first = f.app.inventory.stockPage({ ...actor, sites: [f.w1, f.w2] });
  assert.equal(first.items.length, 20);
  assert.ok(first.items.every((u) => u.warehouse_id === f.w1));
  assert.deepEqual(f.app.inventory.stockSummary({ ...actor, sites: [f.w2] }), {
    available: 18,
  });
  assert.throws(() => f.app.inventory.stockPage(actor, { warehouseId: f.w2 }), {
    code: "FORBIDDEN",
  });
  const hidden = f.app.inventory.stockPage(f.actor).next!;
  assert.throws(() => f.app.inventory.stockPage(actor, { after: hidden }), {
    code: "FORBIDDEN",
  });
  change(f, actor, { sites: [] });
  assert.equal(f.app.inventory.stockPage(actor).items.length, 0);
  assert.equal(f.app.inventory.stockSummary(actor).available, 0);
  assert.throws(
    () => f.app.inventory.stockPage(actor, { after: first.next! }),
    { code: "FORBIDDEN" },
  );
  // Grant administration writes its own audit; stock reads/denials add none.
  const after = facts(f);
  f.app.inventory.stockPage(actor);
  assert.deepEqual(facts(f), after);
  assert.deepEqual(after.slice(0, 5), before.slice(0, 5));
});
test("stock cursors bind search filters and purpose, reject malformed anchors and allow current staff visibility", (t) => {
  const f = fixture(t);
  seedStockQueue(f, 45);
  const page = f.app.inventory.stockPage(f.actor);
  for (const input of [
    { query: "QUEUE" },
    { productId: f.product },
    { warehouseId: f.w1 },
    { view: "available" as const },
  ])
    assert.throws(
      () => f.app.inventory.stockPage(f.actor, { ...input, after: page.next! }),
      { code: "VALIDATION" },
    );
  for (const after of [
    "!",
    page.next! + "=",
    Buffer.from(
      JSON.stringify([1, "stock", "", null, null, null, "missing"]),
    ).toString("base64url"),
  ])
    assert.throws(() => f.app.inventory.stockPage(f.actor, { after }));
  seedStockQueue(f, 45, f.w2, "001-other-site");
  const finance = user(f, "finance"),
    a = f.app.inventory.stockPage(finance);
  const b = f.app.inventory.stockPage(finance, { after: a.next! });
  assert.ok(b.items.length);
  assert.equal(f.app.inventory.stockSummary(finance).available, 33);
  assert.equal(
    f.app.inventory.stockPage(finance, {
      warehouseId: f.w2,
      query: "QUEUE-001",
    }).items.length,
    20,
  );
});
test("stock pages and totals use persisted identity and password restrictions before reads", (t) => {
  const f = fixture(t);
  seedStockQueue(f);
  const actor = user(f, "support"),
    buyer = user(f, "buyer");
  assert.throws(() => f.app.inventory.stockPage({ ...buyer, role: "admin" }), {
    code: "FORBIDDEN",
  });
  assert.equal(
    f.app.inventory.stockPage({ ...actor, role: "buyer" }).items.length,
    20,
  );
  change(f, actor, { active: false });
  const before = facts(f);
  for (const read of [
    () => f.app.inventory.stockPage(actor),
    () => f.app.inventory.stockSummary(actor),
  ])
    assert.throws(read);
  assert.deepEqual(facts(f), before);
  const passwordActor = user(f, "admin"),
    adminStore = f.app.database.owned("iam");
  adminStore.run(
    "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
    passwordActor.id,
  );
  assert.throws(() => f.app.inventory.stockPage(passwordActor), {
    code: "PASSWORD_CHANGE_REQUIRED",
  });
  assert.throws(() => f.app.inventory.stockSummary(passwordActor), {
    code: "PASSWORD_CHANGE_REQUIRED",
  });
});
test("replacement candidates use original claim product independently of stock pages, site scope and reservation state", (t) => {
  const f = fixture(t),
    claim = inspectedClaim(f);
  seedStockQueue(f, 90);
  seedStockQueue(f, 45, f.w2, "001-hidden");
  const actor = user(f, "warranty"),
    before = facts(f),
    view = f.app.dashboard(actor);
  assert.ok(!view.stock.some((u) => u.id === claim.unitId));
  const first = f.app.warranty.replacementCandidatePage(actor, claim.claimId);
  assert.equal(first.items.length, 20);
  assert.ok(first.next);
  assert.ok(
    first.items.every(
      (u) =>
        u.warehouse_id === f.w1 &&
        u.product_id === f.product &&
        u.available === 1,
    ),
  );
  assert.deepEqual(facts(f), before);
  const candidate = f.app.warranty.replacementCandidatePage(
    actor,
    claim.claimId,
    { query: "QUEUE-000-STOCK-087" },
  ).items[0]!;
  const reserved = f.app.warranty.reserveReplacement(
    actor,
    "off-page-reserve",
    {
      claimId: claim.claimId,
      newUnitId: candidate.id,
      oldDisposition: "scrap",
      coveragePolicy: "inherit_original",
      reason: "Synthetic reviewed replacement",
    },
  );
  assert.equal(reserved.state, "reserved");
  assert.equal(
    f.app.inventory.unit(f.actor, claim.unitId).condition,
    "quarantine",
  );
  assert.throws(
    () => f.app.warranty.replacementCandidatePage(actor, claim.claimId),
    { code: "REMEDY" },
  );
  f.app.warranty.cancelReplacement(actor, "off-page-cancel", {
    replacementId: reserved.id,
    revision: reserved.revision,
    reason: "Synthetic cancelled reservation",
  });
  const next = f.app.warranty.replacementCandidatePage(actor, claim.claimId, {
    after: first.next!,
  });
  assert.ok(
    next.items.every(
      (u) => u.id > first.items[19]!.id && u.warehouse_id === f.w1,
    ),
  );
  assert.throws(
    () => f.app.inventory.stockPage(actor, { after: first.next! }),
    { code: "VALIDATION" },
  );
  change(f, actor, { sites: [f.w2] });
  assert.throws(
    () =>
      f.app.warranty.replacementCandidatePage(actor, claim.claimId, {
        after: first.next!,
      }),
    { code: "FORBIDDEN" },
  );
});
test("stock HTTP validates query fields, uses sessions and refuses forged candidate or expired access", async (t) => {
  const f = fixture(t),
    claim = inspectedClaim(f);
  seedStockQueue(f, 90);
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
  const cookie = login.cookies[0]!,
    headers = { cookie: `${cookie.name}=${cookie.value}` };
  const reply = await http.inject({
    url: "/api/stock/page?view=available",
    headers,
  });
  assert.equal(reply.statusCode, 200);
  assert.equal(reply.json().items.length, 20);
  assert.equal(reply.headers["cache-control"], "no-store");
  for (const suffix of [
    "?limit=999",
    "?view=unknown",
    "?query=" + "x".repeat(101),
    "?after=" + "x".repeat(4097),
    "?warehouseId=",
  ])
    assert.equal(
      (await http.inject({ url: "/api/stock/page" + suffix, headers }))
        .statusCode,
      400,
    );
  assert.equal(
    (
      await http.inject({
        url: `/api/warranty/claims/${claim.claimId}/replacement-candidates?query=087`,
        headers,
      })
    ).json().items.length,
    1,
  );
  assert.equal(
    (
      await http.inject({
        url: `/api/warranty/claims/${claim.claimId}/replacement-candidates?productId=${f.product}`,
        headers,
      })
    ).statusCode,
    400,
  );
  assert.equal((await http.inject({ url: "/api/stock/page" })).statusCode, 401);
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET active=0 WHERE id=?", f.actor.id);
  assert.equal(
    (await http.inject({ url: "/api/stock/page", headers })).statusCode,
    401,
  );
});
test("independent persisted grant changes and restart fence stock continuation and claim candidates without effects", (t) => {
  const f = fixture(t),
    claim = inspectedClaim(f);
  seedStockQueue(f, 90);
  seedStockQueue(f, 45, f.w2, "001-other");
  const warehouse = user(f, "warehouse"),
    warranty = user(f, "warranty"),
    cursor = f.app.inventory.stockPage(warehouse).next!,
    replacementCursor = f.app.warranty.replacementCandidatePage(
      warranty,
      claim.claimId,
    ).next!;
  const second = new Application(f.path, "CA");
  try {
    change({ ...f, app: second }, warehouse, { sites: [f.w2] });
    change({ ...f, app: second }, warranty, { role: "support" });
  } finally {
    second.close();
  }
  const before = facts(f);
  const verify = () => {
    const page = f.app.inventory.stockPage({
      ...warehouse,
      sites: [f.w1, f.w2],
    });
    assert.ok(page.items.every((u) => u.warehouse_id === f.w2));
    assert.equal(f.app.inventory.stockSummary(warehouse).available, 15);
    assert.throws(
      () => f.app.inventory.stockPage(warehouse, { after: cursor }),
      { code: "FORBIDDEN" },
    );
    assert.throws(
      () =>
        f.app.warranty.replacementCandidatePage(
          { ...warranty, role: "admin" },
          claim.claimId,
          { after: replacementCursor },
        ),
      { code: "FORBIDDEN" },
    );
  };
  verify();
  f.app.close();
  f.app = new Application(f.path, "CA");
  verify();
  assert.deepEqual(facts(f), before);
});
test("replacement search excludes held wrong-product and nonusable stock and validates claim and search-bound cursors", (t) => {
  const f = fixture(t),
    claim = inspectedClaim(f);
  seedStockQueue(f, 90);
  const actor = user(f, "warranty"),
    first = f.app.warranty.replacementCandidatePage(actor, claim.claimId);
  assert.throws(
    () =>
      f.app.warranty.replacementCandidatePage(actor, claim.claimId, {
        after: first.next!,
        query: "QUEUE",
      }),
    { code: "VALIDATION" },
  );
  assert.throws(() => f.app.warranty.replacementCandidatePage(actor, "absent"));
  const otherProduct = f.app.catalog.create(
    f.actor,
    "other-candidate-product",
    {
      sku: "OTHER",
      name: "Synthetic other product",
      serialized: true,
      unitPrice: 10000,
      taxBasisPoints: 1300,
    },
  ).id;
  // Synthetic invalid/held states exercise eligibility without pretending these
  // direct fixtures prove stock custody or operator acceptance.
  const store = f.app.database.owned("inventory");
  store.run(
    "UPDATE inventory_units SET product_id=? WHERE id='000-stock-087'",
    otherProduct,
  );
  store.run(
    "INSERT INTO inventory_replacements VALUES(?,?,?,'reserved')",
    "other-claim-hold",
    f.actor.orgId,
    "000-stock-084",
  );
  store.run(
    "UPDATE inventory_units SET state='transit' WHERE id='000-stock-081'",
  );
  const before = facts(f);
  for (const query of ["087", "084", "081", "088", "089"])
    assert.equal(
      f.app.warranty.replacementCandidatePage(actor, claim.claimId, { query })
        .items.length,
      0,
    );
  assert.deepEqual(facts(f), before);
  f.app.database
    .owned("warranty")
    .run(
      "UPDATE warranty_claims SET state='received' WHERE id=?",
      claim.claimId,
    );
  assert.throws(
    () => f.app.warranty.replacementCandidatePage(actor, claim.claimId),
    { code: "STATE" },
  );
});
