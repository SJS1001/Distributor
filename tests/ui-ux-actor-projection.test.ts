import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/server/database.ts";
import { DomainError, type Role } from "../src/server/core.ts";
import { createHttp } from "../src/server/http.ts";
import { fixture } from "./fixtures.ts";

const password = "long-test-only-password";
const origin = "http://localhost";
const routes = [
  "/api/audit/page",
  "/api/stock/history?serial=S1",
  "/api/serials/dossier?serial=S1",
];
function staff(f: ReturnType<typeof fixture>, role: Role, sites = [f.w1]) {
  f.app.identity.createUser(f.actor, `actor-name-${role}`, {
    email: `actor-name-${role}@example.test`,
    name: `Synthetic ${role}`,
    role,
    sites,
    password,
    ...(role === "buyer" ? { accountId: f.buyer } : {}),
  });
  return f.app.identity.login(`actor-name-${role}@example.test`, password);
}
function stripped(items: Record<string, unknown>[]) {
  return items.map(({ currentActorName: _name, ...record }) => record);
}
function wire(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

test("record actor names are current, minimal, bounded and organization scoped, including inactive historical actors", (t) => {
  const f = fixture(t),
    iam = f.app.database.owned("iam"),
    finance = staff(f, "finance");
  iam.run(
    "UPDATE iam_users SET name='Renamed administrator',active=0 WHERE id=?",
    f.actor.id,
  );
  iam.run(
    "INSERT INTO iam_organizations VALUES('foreign-org','Synthetic foreign','CA','CAD','{}')",
  );
  iam.run(
    "INSERT INTO iam_users SELECT 'foreign-user','foreign-org','foreign-actor@example.test','Private foreign name',account_id,role,sites,salt,password_hash,active FROM iam_users WHERE id=?",
    finance.actor.id,
  );
  const records = [
    { actor_id: f.actor.id, id: "retained-audit" },
    { actor_id: "foreign-user", id: "unresolved-foreign-actor" },
    { actor_id: "missing-user", id: "unresolved-actor" },
    { actor_id: f.actor.id, id: "second-retained-audit" },
  ];
  const all = t.mock.method(Store.prototype, "all"),
    before = JSON.stringify(records),
    result = f.app.identity.currentNamesForRecordActors(finance.actor, records);
  assert.deepEqual(
    result.map((r) => r.currentActorName),
    ["Renamed administrator", null, null, "Renamed administrator"],
  );
  assert.equal(JSON.stringify(records), before);
  assert.deepEqual(stripped(result), records);
  assert.equal(all.mock.calls.length, 1);
  assert.deepEqual(all.mock.calls[0]!.arguments.slice(1), [
    f.actor.orgId,
    f.actor.id,
    "foreign-user",
    "missing-user",
    3,
  ]);
  assert.match(
    String(all.mock.calls[0]!.arguments[0]),
    /^SELECT id,name FROM iam_users WHERE org_id=\? AND id IN/,
  );
  assert.deepEqual(Object.keys(result[0]!).sort(), [
    "actor_id",
    "currentActorName",
    "id",
  ]);
  assert.equal(
    f.app.identity.currentNamesForRecordActors(finance.actor, []).length,
    0,
  );
  assert.equal(all.mock.calls.length, 1);
  assert.throws(
    () =>
      f.app.identity.currentNamesForRecordActors(
        finance.actor,
        Array.from({ length: 21 }, () => records[0]!),
      ),
    (error) => error instanceof DomainError && error.code === "LIMIT",
  );
  assert.equal(all.mock.calls.length, 1);
  assert.throws(
    () => f.app.identity.users(finance.actor),
    (error) => error instanceof DomainError && error.code === "FORBIDDEN",
  );
  assert.throws(
    () =>
      f.app.identity.currentNamesForRecordActors(
        { ...finance.actor, orgId: "foreign-org" },
        records,
      ),
    (error) => error instanceof DomainError && error.code === "FORBIDDEN",
  );
});

test("HTTP audit name lookup uses only actual returned rows and preserves immutable native evidence and cursors", async (t) => {
  const f = fixture(t),
    platform = f.app.database.owned("platform"),
    iam = f.app.database.owned("iam"),
    session = f.app.identity.login("admin@example.test", password);
  for (let i = 0; i < 21; i++)
    platform.run(
      "INSERT INTO platform_audit VALUES(?,?,?,?,?,?,?)",
      `actor-audit-${i}`,
      f.actor.orgId,
      `record-actor-${i}`,
      "Synthetic actor audit",
      "reference",
      '{"private":"Private audit detail"}',
      "2026-10-07",
    );
  for (let i = 0; i < 21; i++)
    iam.run(
      "INSERT INTO iam_users SELECT ?,org_id,?,?,account_id,role,sites,salt,password_hash,active FROM iam_users WHERE id=?",
      `record-actor-${i}`,
      `record-actor-${i}@example.test`,
      `Synthetic actor ${i}`,
      f.actor.id,
    );
  const native = f.app.platform.auditPage(f.actor),
    retained = platform.all("SELECT * FROM platform_audit ORDER BY rowid"),
    http = await createHttp(f.app, { origin });
  t.after(() => http.close());
  const all = t.mock.method(Store.prototype, "all"),
    response = await http.inject({
      url: routes[0]!,
      headers: { cookie: `distributor_session=${session.token}` },
    });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().items.length, 20);
  assert.equal(response.json().next, native.next);
  assert.deepEqual(stripped(response.json().items), wire(native.items));
  assert.equal(response.json().items[0].currentActorName, "Synthetic actor 20");
  const nameQueries = all.mock.calls.filter((call) =>
    String(call.arguments[0]).startsWith("SELECT id,name FROM iam_users"),
  );
  assert.equal(nameQueries.length, 1);
  assert.deepEqual(nameQueries[0]!.arguments.slice(1), [
    f.actor.orgId,
    ...native.items.map((r) => r.actor_id),
    20,
  ]);
  assert.ok(
    !response.body.includes("record-actor-0@") &&
      !response.body.includes("Private audit detail"),
  );
  iam.run(
    "UPDATE iam_users SET name='Current renamed actor',active=0 WHERE id='record-actor-20'",
  );
  const renamed = await http.inject({
    url: routes[0]!,
    headers: { cookie: `distributor_session=${session.token}` },
  });
  assert.equal(
    renamed.json().items[0].currentActorName,
    "Current renamed actor",
  );
  assert.equal(renamed.json().items[0].actor_id, "record-actor-20");
  assert.deepEqual(f.app.platform.auditPage(f.actor), native);
  assert.deepEqual(
    platform.all("SELECT * FROM platform_audit ORDER BY rowid"),
    retained,
  );
});

test("HTTP finance stock history and dossier annotate returned movement actors without directory access or native writes", async (t) => {
  const f = fixture(t),
    session = staff(f, "finance"),
    inventory = f.app.database.owned("inventory"),
    native = f.app.inventory.movementPage(session.actor, { serial: "S1" }),
    dossier = f.app.serialDossier(session.actor, { serial: "S1" }),
    before = inventory.all("SELECT * FROM inventory_movements ORDER BY rowid"),
    http = await createHttp(f.app, { origin });
  t.after(() => http.close());
  const headers = { cookie: `distributor_session=${session.token}` };
  for (const url of routes.slice(1)) {
    const response = await http.inject({ url, headers });
    assert.equal(response.statusCode, 200);
    const body = response.json<Record<string, any>>();
    const page = url.includes("dossier") ? body.movements : body;
    assert.deepEqual(stripped(page.items), wire(native.items));
    assert.ok(
      page.items.every(
        (r: { currentActorName: string }) =>
          r.currentActorName === "Administrator",
      ),
    );
    assert.deepEqual({ ...page, items: stripped(page.items) }, wire(native));
    if (url.includes("dossier"))
      assert.deepEqual(
        {
          ...body,
          movements: { ...page, items: stripped(page.items) },
        },
        wire(dossier),
      );
    for (const privateValue of [
      "admin@example.test",
      session.token,
      session.csrf,
      "password_hash",
      "sites",
      "account_id",
    ])
      assert.ok(!response.body.includes(privateValue));
  }
  assert.equal(
    (await http.inject({ url: "/api/users", headers })).statusCode,
    403,
  );
  assert.deepEqual(
    inventory.all("SELECT * FROM inventory_movements ORDER BY rowid"),
    before,
  );
  // Foreign and unavailable recorded identifiers remain visible without name disclosure.
  inventory.run(
    "UPDATE inventory_movements SET actor_id='foreign-user' WHERE unit_id=?",
    native.unit.id,
  );
  const unresolved = await http.inject({ url: routes[1]!, headers });
  assert.ok(
    unresolved
      .json()
      .items.every(
        (r: { actor_id: string; currentActorName: unknown }) =>
          r.actor_id === "foreign-user" && r.currentActorName === null,
      ),
  );
});

test("record guards reject role, site, cursor, password and inactive session before actor names are looked up", async (t) => {
  const f = fixture(t),
    session = staff(f, "warehouse", [f.w2]),
    iam = f.app.database.owned("iam"),
    http = await createHttp(f.app, { origin });
  t.after(() => http.close());
  const projection = t.mock.method(
      f.app.identity,
      "currentNamesForRecordActors",
    ),
    headers = { cookie: `distributor_session=${session.token}` };
  for (const url of routes)
    assert.equal((await http.inject({ url, headers })).statusCode, 403);
  assert.equal(projection.mock.calls.length, 0);
  iam.run("UPDATE iam_users SET role='finance' WHERE id=?", session.actor.id);
  for (const url of [
    "/api/stock/history?serial=S1&after=bad",
    "/api/serials/dossier?serial=S1&movementAfter=bad",
    "/api/audit/page?after=missing",
  ])
    assert.ok(
      [400, 403].includes((await http.inject({ url, headers })).statusCode),
    );
  assert.equal(projection.mock.calls.length, 0);
  iam.run(
    "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
    session.actor.id,
  );
  for (const url of routes)
    assert.equal((await http.inject({ url, headers })).statusCode, 403);
  assert.equal(projection.mock.calls.length, 0);
  iam.run("UPDATE iam_users SET active=0 WHERE id=?", session.actor.id);
  for (const url of routes)
    assert.equal((await http.inject({ url, headers })).statusCode, 401);
  assert.equal(projection.mock.calls.length, 0);
  for (const url of routes)
    assert.equal((await http.inject({ url })).statusCode, 401);
});

test("required MFA prevents all record actor annotations until enrollment", async (t) => {
  const f = fixture(t, {
      mfaEncryptionKey: "a1".repeat(32),
      mfaRequiredRoles: ["admin"],
    }),
    session = f.app.identity.login("admin@example.test", password),
    http = await createHttp(f.app, { origin });
  t.after(() => http.close());
  const projection = t.mock.method(
    f.app.identity,
    "currentNamesForRecordActors",
  );
  for (const url of routes) {
    const response = await http.inject({
      url,
      headers: { cookie: `distributor_session=${session.token}` },
    });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().code, "MFA_ENROLLMENT_REQUIRED");
  }
  assert.equal(projection.mock.calls.length, 0);
});
