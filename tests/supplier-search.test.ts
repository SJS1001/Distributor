import { test } from "node:test";
import assert from "node:assert/strict";
import type { Owner } from "../src/server/database.ts";
import { fixture } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";

function facts(f: ReturnType<typeof fixture>) {
  return f.app.database
    .owned("platform")
    .all<{ name: string }>(
      "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name",
    )
    .map(({ name }) => [
      name,
      f.app.database
        .owned(name.split("_")[0] as Owner)
        .all(`SELECT * FROM ${name} ORDER BY rowid`),
    ]);
}
function seed(f: ReturnType<typeof fixture>) {
  for (let n = 0; n < 43; n++)
    f.app.procurement.supplier(f.actor, `supplier-${n}`, {
      name: `Z Supplier ${String(n).padStart(2, "0")}`,
    });
  const literal = f.app.procurement.supplier(f.actor, "literal", {
    name: "Z%_ Mixed Case supplier",
  }).id;
  f.app.database
    .owned("procurement")
    .run(
      "INSERT INTO procurement_suppliers VALUES(?,?,?)",
      "foreign-supplier",
      "other-org",
      "Z Supplier 44 private",
    );
  return literal;
}
for (const region of ["CA", "US"] as const)
  test(`supplier search ${region}: bounded literal pages and off-page selection survive restart without changing native facts`, (t) => {
    const f = fixture(t, {}, region),
      literal = seed(f);
    const before = facts(f),
      ids: string[] = [];
    let after: string | undefined;
    do {
      const page = f.app.procurement.supplierPage(f.actor, { after });
      assert.ok(page.items.length <= 20);
      for (const row of page.items)
        assert.deepEqual(Object.keys(row).sort(), [
          "active",
          "id",
          "name",
          "revision",
        ]);
      ids.push(...page.items.map((row) => row.id));
      after = page.next ?? undefined;
    } while (after);
    assert.equal(ids.length, 45);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(!ids.includes("foreign-supplier"));
    assert.equal(f.app.procurement.suppliers(f.actor).length, 20);
    assert.equal(
      f.app.procurement.supplierChoice(f.actor, ids.at(-1)!).id,
      ids.at(-1),
    );
    assert.deepEqual(
      f.app.procurement
        .supplierPage(f.actor, { q: "%_" })
        .items.map((r) => r.id),
      [literal],
    );
    assert.deepEqual(
      f.app.procurement
        .supplierPage(f.actor, { q: "  mIxEd CAse  " })
        .items.map((r) => r.id),
      [literal],
    );
    const first = f.app.procurement.supplierPage(f.actor, { q: " supplier " });
    const second = f.app.procurement.supplierPage(f.actor, {
      q: "SUPPLIER",
      after: first.next!,
    });
    assert.ok(
      !second.items.some((r) => first.items.some((s) => r.id === s.id)),
    );
    assert.deepEqual(facts(f), before);
    f.app.close();
    f.app = new Application(f.path, region);
    assert.deepEqual(
      f.app.procurement.supplierPage(f.actor, {
        q: "supplier",
        after: first.next!,
      }),
      second,
    );
    assert.deepEqual(facts(f), before);
  });

test("supplier search refuses malformed, mismatched, foreign and removed anchors without writes", (t) => {
  const f = fixture(t);
  seed(f);
  const first = f.app.procurement.supplierPage(f.actor, { q: "supplier" });
  const cursor = JSON.parse(
    Buffer.from(first.next!, "base64url").toString(),
  ) as unknown[];
  const encode = (values: unknown[]) =>
    Buffer.from(JSON.stringify(values)).toString("base64url");
  const before = facts(f);
  for (const after of [
    "not-json",
    first.next! + "=",
    encode([2, ...cursor.slice(1)]),
    encode([1, "other-org", cursor[2], cursor[3]]),
    encode([1, f.actor.orgId, cursor[2], "foreign-supplier"]),
    encode([1, f.actor.orgId, cursor[2], "missing"]),
    encode([1, f.actor.orgId, cursor[2], 3]),
  ])
    assert.throws(() =>
      f.app.procurement.supplierPage(f.actor, { q: "supplier", after }),
    );
  assert.throws(
    () =>
      f.app.procurement.supplierPage(f.actor, {
        q: "changed",
        after: first.next!,
      }),
    { code: "VALIDATION" },
  );
  assert.throws(
    () => f.app.procurement.supplierPage(f.actor, { q: "x".repeat(121) }),
    { code: "VALIDATION" },
  );
  assert.throws(
    () => f.app.procurement.supplierChoice(f.actor, "foreign-supplier"),
    { code: "NOT_FOUND" },
  );
  assert.deepEqual(facts(f), before);
  f.app.database
    .owned("procurement")
    .run("DELETE FROM procurement_suppliers WHERE id=?", cursor[3] as string);
  const deleted = facts(f);
  assert.throws(
    () =>
      f.app.procurement.supplierPage(f.actor, {
        q: "supplier",
        after: first.next!,
      }),
    { code: "NOT_FOUND" },
  );
  assert.deepEqual(facts(f), deleted);
});

test("supplier HTTP search requires current authentication, validates query and retains twenty-row dashboard compatibility", async (t) => {
  const f = fixture(t);
  const literal = seed(f);
  const http = await createHttp(f.app, { origin: "http://127.0.0.1:3117" });
  t.after(() => http.close());
  assert.equal(
    (await http.inject({ url: "/api/purchases/suppliers/page" })).statusCode,
    401,
  );
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin: "http://127.0.0.1:3117" },
    payload: {
      email: "admin@example.test",
      password: "long-test-only-password",
    },
  });
  assert.equal(login.statusCode, 200);
  const headers = {
    cookie: `${login.cookies[0]!.name}=${login.cookies[0]!.value}`,
  };
  const result = await http.inject({
    url: "/api/purchases/suppliers/page?q=%25_",
    headers,
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.headers["cache-control"], "no-store");
  assert.deepEqual(
    result.json().items.map((r: { id: string }) => r.id),
    [literal],
  );
  const dashboard = await http.inject({ url: "/api/purchases", headers });
  assert.equal(dashboard.json().suppliers.length, 20);
  assert.ok(dashboard.json().supplierNext);
  assert.equal(
    (await http.inject({ url: `/api/purchases/suppliers/${literal}`, headers }))
      .statusCode,
    200,
  );
  assert.equal(
    (
      await http.inject({
        url: "/api/purchases/suppliers/foreign-supplier",
        headers,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await http.inject({
        url: `/api/purchases/suppliers/page?q=${"x".repeat(121)}`,
        headers,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await http.inject({
        url: "/api/purchases/suppliers/page?after=invalid",
        headers,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await http.inject({
        url: "/api/purchases/suppliers/page?unknown=1",
        headers,
      })
    ).statusCode,
    400,
  );
});
