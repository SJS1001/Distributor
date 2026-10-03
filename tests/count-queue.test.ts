import { test } from "node:test";
import assert from "node:assert/strict";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import { Store } from "../src/server/database.ts";
import type { Actor, Row } from "../src/server/core.ts";
import type { SQLInputValue } from "node:sqlite";
import { countQueueStates } from "../src/shared/count-queue.ts";
import { fixture } from "./fixtures.ts";
import { countQueueFixture } from "./count-queue-fixture.ts";

function facts(f: ReturnType<typeof fixture>) {
  return ["counts", "units", "movements"]
    .map((name) =>
      f.app.database
        .owned("inventory")
        .all(`SELECT * FROM inventory_${name} ORDER BY rowid`),
    )
    .concat(
      ["commands", "audit", "events"].map((name) =>
        f.app.database
          .owned("platform")
          .all(`SELECT * FROM platform_${name} ORDER BY rowid`),
      ),
    );
}
function grant(
  f: ReturnType<typeof fixture>,
  actor: Actor,
  sites: string[],
  active = true,
) {
  const row = f.app.identity.users(f.actor).find((u) => u.id === actor.id)!;
  f.app.identity.updateUser(f.actor, `queue-grant-${row.revision}`, {
    userId: actor.id,
    revision: row.revision,
    email: row.email,
    name: actor.name,
    role: actor.role,
    sites,
    active,
    currentPassword: "long-test-only-password",
    reason: "Synthetic count queue authority change",
  });
}
for (const region of ["CA", "US"] as const) {
  test(`${region} count pages traverse all tied records, retain original review evidence and conserve facts through restart`, (t) => {
    const f = fixture(t, {}, region),
      { rows } = countQueueFixture(f),
      before = facts(f);
    const first = f.app.inventory.countPage(f.actor);
    assert.equal(first.items.length, 20);
    assert.ok(first.next);
    assert.equal(f.app.inventory.counts(f.actor).length, 45);
    f.app.close();
    f.app = new Application(f.path, region);
    assert.deepEqual(f.app.inventory.countPage(f.actor), first);
    const second = f.app.inventory.countPage(f.actor, { after: first.next! });
    const third = f.app.inventory.countPage(f.actor, { after: second.next! });
    assert.equal(second.items.length, 20);
    assert.equal(third.items.length, 5);
    assert.equal(third.next, null);
    assert.deepEqual(
      [...first.items, ...second.items, ...third.items].map((r) => r.id),
      rows.map((r) => r.id).reverse(),
    );
    const approved = third.items.find((r) => r.state === "approved")!;
    assert.equal(approved.result.reviewPolicy.mode, "administrator");
    assert.equal(approved.unit_cost, 1000);
    assert.equal(Object.hasOwn(approved, "start_hash"), false);
    assert.equal(Object.hasOwn(approved, "decision_result"), false);
    assert.equal(Object.hasOwn(approved, "position"), false);
    assert.deepEqual(facts(f), before);
  });
  test(`${region} count state selection applies before limiting and continuation survives a changed anchor state`, (t) => {
    const f = fixture(t, {}, region);
    countQueueFixture(f);
    const legacy = f.app.inventory.counts(f.actor),
      before = facts(f);
    for (const state of countQueueStates) {
      const page = f.app.inventory.countPage(f.actor, { state }),
        items = [...page.items];
      let next = page.next;
      while (next) {
        const page = f.app.inventory.countPage(f.actor, { state, after: next });
        items.push(...page.items);
        next = page.next;
      }
      assert.deepEqual(
        items.map((r) => r.id).sort(),
        legacy
          .filter((r) => r.state === state)
          .map((r) => r.id)
          .sort(),
      );
      assert.ok(items.every((r) => r.state === state));
    }
    assert.deepEqual(facts(f), before);
    const draft = f.app.inventory.countPage(f.actor, { state: "draft" });
    const anchor = draft.items[19]!;
    f.app.inventory.submitCount(f.actor, "changed-anchor", {
      countId: anchor.id,
      quantity: 6,
      reason: "Synthetic changed observation",
    });
    const next = f.app.inventory.countPage(f.actor, {
      state: "draft",
      after: draft.next!,
    });
    assert.equal(next.items.length, 20);
    assert.ok(
      next.items.every((r) => r.state === "draft" && r.id !== anchor.id),
    );
  });
}

test("count SQL scopes before materialization; cursor bindings use current persisted authority and reject inaccessible anchors", (t) => {
  const f = fixture(t),
    { operator } = countQueueFixture(f, 45, 3),
    before = facts(f);
  const queries: { sql: string; params: SQLInputValue[] }[] = [],
    all = Store.prototype.all;
  Store.prototype.all = function <T extends Row = Row>(
    sql: string,
    ...params: SQLInputValue[]
  ): T[] {
    queries.push({ sql, params });
    return all.call(this, sql, ...params) as T[];
  };
  let page;
  try {
    page = f.app.inventory.countPage({
      ...operator,
      role: "admin",
      sites: [f.w2],
    });
  } finally {
    Store.prototype.all = all;
  }
  assert.equal(page.items.length, 20);
  assert.ok(page.items.every((r) => r.warehouse_id === f.w1));
  const headers = queries.filter((q) =>
    q.sql.includes("FROM inventory_counts"),
  );
  assert.equal(headers.length, 1);
  assert.match(headers[0]!.sql, /warehouse_id IN/);
  assert.match(headers[0]!.sql, /LIMIT 21/);
  assert.ok(headers[0]!.params.includes(f.w1));
  assert.deepEqual(facts(f), before);
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const binding = JSON.parse(
    Buffer.from(page.next!, "base64url").toString("utf8"),
  );
  for (const after of [
    "invalid!",
    page.next! + "=",
    " " + page.next!,
    encode(["transfer-queue", ...binding.slice(1)]),
    encode([...binding.slice(0, 2), "foreign", ...binding.slice(3)]),
    Buffer.from(JSON.stringify(binding, null, 2)).toString("base64url"),
  ]) {
    assert.throws(() => f.app.inventory.countPage(operator, { after }), {
      code: "VALIDATION",
    });
  }
  const hidden = f.app.inventory
    .countPage(f.actor)
    .items.find((c) => c.warehouse_id === f.w2)!;
  assert.throws(
    () =>
      f.app.inventory.countPage(operator, {
        after: encode([...binding.slice(0, 5), hidden.id]),
      }),
    { code: "CURSOR" },
  );
  assert.throws(
    () =>
      f.app.inventory.countPage(operator, {
        after: encode([...binding.slice(0, 5), "missing"]),
      }),
    { code: "CURSOR" },
  );
  assert.throws(
    () =>
      f.app.inventory.countPage(operator, {
        state: "approved",
        after: page.next!,
      }),
    { code: "VALIDATION" },
  );
  assert.throws(
    () =>
      f.app.inventory.countPage(operator, {
        after: f.app.inventory.countPage(f.actor).next!,
      }),
    { code: "VALIDATION" },
  );
  grant(f, operator, []);
  assert.deepEqual(f.app.inventory.countPage(operator), {
    items: [],
    next: null,
  });
  assert.equal(f.app.inventory.counts(operator).length, 0);
  assert.throws(
    () => f.app.inventory.countPage(operator, { after: page.next! }),
    { code: "VALIDATION" },
  );
  grant(f, operator, [f.w1], false);
  assert.throws(() => f.app.inventory.countPage(operator), {
    code: "FORBIDDEN",
  });
});

test("count pages project current independent duties and refuse changed roles/passwords before empty results", (t) => {
  const f = fixture(t),
    { rows, operator, unit } = countQueueFixture(f);
  const own = f.app.inventory.startCount(f.actor, "self-count", {
    unitId: unit.id,
    revision: f.app.inventory.unit(f.actor, unit.id).revision,
    countRef: "SYNTHETIC-SELF-COUNT",
  });
  f.app.inventory.submitCount(f.actor, "self-observe", {
    countId: own.id,
    quantity: 6,
    reason: "Synthetic self observation",
  });
  const policy = f.app.identity.configureCountReview(
    f.actor,
    "independent-count-queue",
    { mode: "independent", revision: 1, reason: "Synthetic separate duties" },
  );
  const submitted = f.app.inventory.countPage(f.actor, { state: "submitted" });
  assert.equal(submitted.items.find((r) => r.id === own.id)!.canApprove, false);
  assert.equal(
    submitted.items.find((r) => r.id === rows[1]!.id)!.canApprove,
    true,
  );
  assert.deepEqual(submitted.items[0]!.reviewPolicy, policy);
  const approved = f.app.inventory.countPage(f.actor, { state: "approved" });
  assert.equal(approved.items[0]!.result.reviewPolicy.mode, "administrator");
  assert.equal(
    f.app.inventory.countPage(operator, { state: "submitted" }).items[0]!
      .canApprove,
    false,
  );
  grant(f, operator, []);
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_user_security SET password_change_required=1, updated_at=? WHERE user_id=?",
      "2026-10-02T12:00:00.000Z",
      operator.id,
    );
  assert.throws(() => f.app.inventory.countPage(operator), {
    code: "PASSWORD_CHANGE_REQUIRED",
  });
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_user_security SET password_change_required=0 WHERE user_id=?",
      operator.id,
    );
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='commercial' WHERE id=?", operator.id);
  assert.throws(
    () =>
      f.app.inventory.countPage({ ...operator, role: "admin", sites: [f.w1] }),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () => f.app.inventory.countPage({ ...f.actor, orgId: "foreign" }),
    { code: "FORBIDDEN" },
  );
});

test("count HTTP requires current sessions, validates filters/fields/cursors and preserves complete legacy reads", async (t) => {
  const f = fixture(t);
  countQueueFixture(f);
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
  const response = await http.inject({ url: "/api/counts/page", headers });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().items.length, 20);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(
    (
      await http.inject({
        url: "/api/counts/page?after=" + response.json().next,
        headers,
      })
    ).json().items.length,
    20,
  );
  assert.equal(
    (await http.inject({ url: "/api/counts", headers })).json().length,
    45,
  );
  assert.equal(
    (
      await http.inject({ url: "/api/counts/page?state=submitted", headers })
    ).json().items.length,
    1,
  );
  for (const suffix of [
    "?limit=100",
    "?state=unknown",
    "?after=",
    "?after=" + "x".repeat(4097),
  ])
    assert.equal(
      (await http.inject({ url: "/api/counts/page" + suffix, headers }))
        .statusCode,
      400,
    );
  assert.equal(
    (await http.inject({ url: "/api/counts/page" })).statusCode,
    401,
  );
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET active=0 WHERE id=?", f.actor.id);
  assert.equal(
    (await http.inject({ url: "/api/counts/page", headers })).statusCode,
    401,
  );
});
