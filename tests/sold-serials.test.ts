import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, accept, ship } from "./fixtures.ts";
import { warrantyUser, warrantyGrants } from "./warranty-authority-fixtures.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import type { SoldSerial } from "../src/shared/sold-serials.ts";
type Fixture = ReturnType<typeof fixture>;
function receive(f: Fixture, serials: string[], key: string) {
  const po = f.app.procurement.create(f.actor, key + "po", {
    supplierId: f.supplier,
    warehouseId: f.w1,
    lines: [{ productId: f.product, quantity: serials.length, unitCost: 6000 }],
  });
  const lineId = String(
    f.app.procurement.orders(f.actor).find((p) => p.id === po.id)!.lines[0]!.id,
  );
  f.app.procurement.receive(f.actor, key + "receipt", {
    poId: po.id,
    lineId,
    deliveryRef: key,
    quantity: serials.length,
    serials,
    bin: "PAGE",
    quarantine: false,
  });
}
function facts(f: Fixture) {
  return (
    [
      "iam",
      "inventory",
      "fulfillment",
      "warranty",
      "billing",
      "platform",
    ] as const
  ).map((owner) => {
    const store = f.app.database.owned(owner);
    return store
      .all<{ name: string }>(
        "SELECT name FROM sqlite_schema WHERE type='table' AND name GLOB ? ORDER BY name",
        `${owner}_*`,
      )
      .map(({ name }) => store.all(`SELECT * FROM ${name} ORDER BY rowid`));
  });
}
function customer(f: Fixture, key: string) {
  return f.app.identity.createCustomer(f.actor, key, {
    name: key,
    tier: "standard",
    creditLimit: 1000000,
  }).id;
}
for (const region of ["CA", "US"] as const)
  test(`${region} sold serial pages skip foreign-account batches, conserve facts and restart without omissions`, (t) => {
    const f = fixture(t, {}, region);
    ship(f, accept(f, 3).id);
    receive(
      f,
      Array.from(
        { length: 41 },
        (_, i) => `PAGE-${String(i).padStart(3, "0")}`,
      ),
      "own-pages",
    );
    ship(f, accept(f, 41, "own-pages").id);
    const other = customer(f, "Other page buyer");
    receive(
      f,
      Array.from(
        { length: 45 },
        (_, i) => `AAA-HIDDEN-${String(i).padStart(3, "0")}`,
      ),
      "other-pages",
    );
    ship(
      { ...f, buyer: other },
      accept({ ...f, buyer: other }, 45, "other-pages").id,
    );
    const buyer = warrantyUser(f, "buyer"),
      before = facts(f);
    const page1 = f.app.warranty.soldUnitPage(buyer);
    assert.equal(page1.items.length, 20);
    assert.equal(page1.next, page1.items.at(-1)!.id);
    const dashboard = f.app.dashboard(buyer);
    assert.deepEqual(dashboard.soldUnits, page1.items);
    assert.equal(dashboard.soldUnitNext, page1.next);
    f.app.close();
    f.app = new Application(f.path, region);
    const page2 = f.app.warranty.soldUnitPage(buyer, { after: page1.next! });
    const page3 = f.app.warranty.soldUnitPage(buyer, { after: page2.next! });
    assert.equal(page2.items.length, 20);
    assert.equal(page3.items.length, 4);
    assert.equal(page3.next, null);
    const all = [...page1.items, ...page2.items, ...page3.items];
    assert.equal(new Set(all.map((u) => u.id)).size, 44);
    assert.ok(all.every((u) => u.accountId === f.buyer));
    assert.ok(
      all.every(
        (u) =>
          Object.keys(u).sort().join(",") === "accountId,id,productId,serial",
      ),
    );
    assert.deepEqual(
      all.map((u) => u.serial),
      [
        ...Array.from(
          { length: 41 },
          (_, i) => `PAGE-${String(i).padStart(3, "0")}`,
        ),
        "S1",
        "S2",
        "S3",
      ],
    );
    assert.deepEqual(
      f.app.warranty.soldUnitPage(f.actor, { accountId: f.buyer }),
      page1,
    );
    assert.equal(
      f.app.warranty.soldUnitPage(f.actor, { accountId: other }).items.length,
      20,
    );
    assert.deepEqual(f.app.warranty.soldUnits(buyer), page1.items);
    assert.deepEqual(facts(f), before);
  });
test("serial search is literal, trims the input and rejects unavailable or foreign cursors without writes", (t) => {
  const f = fixture(t);
  ship(f, accept(f, 3).id);
  const serials = ["LITERAL-%_quote'", "LITERAL-other", "UNICODE-É"];
  receive(f, serials, "literal");
  ship(f, accept(f, 3, "literal").id);
  const buyer = warrantyUser(f, "buyer"),
    other = customer(f, "other");
  receive(f, ["FOREIGN-ONLY"], "foreign");
  ship({ ...f, buyer: other }, accept({ ...f, buyer: other }, 1, "foreign").id);
  const foreignId = f.app.inventory.trace(f.actor, "FOREIGN-ONLY").unit.id;
  receive(f, ["UNSOLD"], "unsold");
  const unsoldId = f.app.inventory.trace(f.actor, "UNSOLD").unit.id;
  const otherOrg = fixture(t),
    foreignOrgId = otherOrg.app.inventory.trace(otherOrg.actor, "S1").unit.id;
  const before = facts(f);
  for (const query of ["%_quote'", "  literal-%_QUOTE'  "])
    assert.deepEqual(
      f.app.warranty.soldUnitPage(buyer, { query }).items.map((u) => u.serial),
      [serials[0]],
    );
  assert.equal(
    f.app.warranty.soldUnitPage(buyer, { query: "' OR 1=1 --" }).items.length,
    0,
  );
  assert.equal(
    f.app.warranty.soldUnitPage(buyer, { query: "FOREIGN" }).items.length,
    0,
  );
  assert.throws(
    () =>
      f.app.warranty.soldUnitPage(
        { ...buyer, role: "admin", accountId: other },
        { accountId: other },
      ),
    { code: "FORBIDDEN" },
  );
  for (const after of [foreignId, unsoldId, foreignOrgId, "missing"])
    assert.throws(() => f.app.warranty.soldUnitPage(buyer, { after }), {
      code: "CURSOR",
    });
  const cursor = f.app.warranty.soldUnitPage(buyer).items[0]!.id;
  assert.throws(
    () => f.app.warranty.soldUnitPage(buyer, { after: cursor, query: "S1" }),
    { code: "CURSOR" },
  );
  for (const query of [" ", "x".repeat(101)])
    assert.throws(() => f.app.warranty.soldUnitPage(buyer, { query }), {
      code: "VALIDATION",
    });
  assert.throws(
    () => f.app.warranty.soldUnitPage(buyer, { after: "x".repeat(129) }),
    { code: "VALIDATION" },
  );
  assert.deepEqual(facts(f), before);
});
test("current replacement custody replaces original sale and a resale does not expose the former customer's serial", (t) => {
  const f = fixture(t);
  ship(f, accept(f).id);
  const buyer = warrantyUser(f, "buyer"),
    oldId = f.app.inventory.trace(f.actor, "S1").unit.id;
  const newId = f.app.inventory.trace(f.actor, "S2").unit.id;
  const claim = f.app.warranty.submit(buyer, "claim", {
    accountId: f.buyer,
    unitId: oldId,
    type: "warranty",
    issue: "Synthetic fault",
    evidence: "Synthetic evidence",
  });
  f.app.warranty.review(f.actor, "review", {
    claimId: claim.id,
    approved: true,
    reason: "Synthetic",
  });
  f.app.warranty.receive(f.actor, "return", {
    claimId: claim.id,
    warehouseId: f.w1,
    bin: "Q",
    serial: "S1",
  });
  // Historical ordinary-sale compatibility remains available after native return.
  assert.equal(
    f.app.fulfillment.soldUnit(buyer, oldId, f.buyer).unit.serial,
    "S1",
  );
  assert.deepEqual(f.app.warranty.soldUnitPage(buyer), {
    items: [],
    next: null,
  });
  assert.throws(() => f.app.warranty.soldUnitPage(buyer, { after: oldId }), {
    code: "CURSOR",
  });
  f.app.warranty.inspect(f.actor, "inspect", {
    claimId: claim.id,
    findings: "Synthetic",
  });
  const replacement = f.app.warranty.reserveReplacement(
    f.actor,
    "replacement",
    {
      claimId: claim.id,
      newUnitId: newId,
      oldDisposition: "restock",
      coveragePolicy: "inherit_original",
      reason: "Synthetic",
    },
  );
  assert.deepEqual(f.app.warranty.soldUnitPage(buyer), {
    items: [],
    next: null,
  });
  f.app.warranty.handoverReplacement(f.actor, "handover", {
    replacementId: replacement.id,
    revision: 1,
    serial: "S2",
    recipient: "Synthetic",
    evidence: "Synthetic",
  });
  assert.deepEqual(
    f.app.warranty.soldUnitPage(buyer).items.map((u) => u.serial),
    ["S2"],
  );
  const other = customer(f, "resale-buyer");
  ship({ ...f, buyer: other }, accept({ ...f, buyer: other }, 1, "resale").id);
  const resale = warrantyUser(f, "buyer", other);
  assert.deepEqual(
    f.app.warranty.soldUnitPage(resale).items.map((u) => u.serial),
    ["S1"],
  );
  assert.deepEqual(
    f.app.warranty.soldUnitPage(buyer).items.map((u) => u.serial),
    ["S2"],
  );
  assert.throws(() => f.app.warranty.soldUnitPage(buyer, { after: oldId }), {
    code: "CURSOR",
  });
  const current = f.app.warranty.soldUnitPage(f.actor).items;
  assert.deepEqual(
    current.map((u) => [u.serial, u.accountId]),
    [
      ["S1", other],
      ["S2", f.buyer],
    ],
  );
  assert.equal(
    f.app.fulfillment.soldUnit(resale, oldId, other).unit.serial,
    "S1",
  );
  assert.throws(() => f.app.fulfillment.soldUnit(buyer, oldId, f.buyer), {
    code: "NOT_FOUND",
  });
  const before = facts(f);
  assert.equal(
    f.app.warranty.coverage(buyer, newId, f.buyer).source,
    "replacement_inherited",
  );
  assert.equal(
    f.app.warranty.coverage(resale, oldId, other).source,
    "current_provisional_policy",
  );
  assert.deepEqual(facts(f), before);
});
test("paged search follows actual changed account and role grants, never stale supplied authority", (t) => {
  const f = fixture(t);
  ship(f, accept(f).id);
  const buyer = warrantyUser(f, "buyer"),
    other = customer(f, "other");
  const initial = f.app.warranty.soldUnitPage(buyer);
  warrantyGrants(f, buyer, { accountId: other });
  assert.deepEqual(
    f.app.warranty.soldUnitPage({
      ...buyer,
      role: "admin",
      accountId: f.buyer,
    }),
    { items: [], next: null },
  );
  assert.throws(
    () => f.app.warranty.soldUnitPage(buyer, { after: initial.items[0]!.id }),
    { code: "CURSOR" },
  );
  warrantyGrants(f, buyer, {
    role: "commercial",
    accountId: null,
    sites: [f.w2],
  });
  assert.deepEqual(f.app.warranty.soldUnitPage(buyer), initial);
  for (const role of ["finance", "warehouse", "support"] as const) {
    warrantyGrants(f, buyer, { role });
    assert.throws(
      () => f.app.warranty.soldUnitPage({ ...buyer, role: "admin" }),
      { code: "FORBIDDEN" },
    );
  }
});
test("HTTP serial pages authenticate, reject ambiguous inputs and scope fresh private noncached reads", async (t) => {
  const f = fixture(t);
  ship(f, accept(f, 3).id);
  const buyer = warrantyUser(f, "buyer"),
    origin = "http://127.0.0.1:3000";
  const http = await createHttp(f.app, {
    origin,
    staticRoot: "/nonexistent-distributor-test",
  });
  t.after(() => http.close());
  const url = "/api/warranty/sold-units/page";
  assert.equal((await http.inject({ method: "GET", url })).statusCode, 401);
  const email = f.app.identity
    .users(f.actor)
    .find((u) => u.id === buyer.id)!.email;
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: { email, password: "long-user-test-password" },
  });
  assert.equal(login.statusCode, 200);
  const cookie = login.cookies[0]!,
    headers = { cookie: `${cookie.name}=${cookie.value}` };
  const reply = await http.inject({
    method: "GET",
    url: url + "?query=s1",
    headers,
  });
  assert.equal(reply.statusCode, 200);
  assert.match(reply.headers["cache-control"]!, /no-store/);
  assert.deepEqual(
    reply.json().items.map((u: SoldSerial) => u.serial),
    ["S1"],
  );
  for (const suffix of [
    "?query=",
    "?query=%20",
    "?query=S1&query=S2",
    "?after=a&after=b",
    "?accountId=a&accountId=b",
    "?limit=100",
    "?query=" + "x".repeat(101),
    "?after=" + "x".repeat(129),
    "?accountId=" + "x".repeat(161),
  ])
    assert.equal(
      (await http.inject({ method: "GET", url: url + suffix, headers }))
        .statusCode,
      400,
      suffix,
    );
  const other = customer(f, "http-other");
  assert.equal(
    (
      await http.inject({
        method: "GET",
        url: url + `?accountId=${other}`,
        headers,
      })
    ).statusCode,
    403,
  );
  warrantyGrants(f, buyer, { accountId: other });
  // Grant edits revoke existing HTTP sessions; reauthentication sees the new account.
  assert.equal(
    (await http.inject({ method: "GET", url, headers })).statusCode,
    401,
  );
  const relogin = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: { email, password: "long-user-test-password" },
  });
  assert.equal(relogin.statusCode, 200);
  const freshCookie = relogin.cookies[0]!,
    freshHeaders = { cookie: `${freshCookie.name}=${freshCookie.value}` };
  const fresh = await http.inject({
    method: "GET",
    url,
    headers: freshHeaders,
  });
  assert.equal(fresh.statusCode, 200);
  assert.deepEqual(fresh.json(), { items: [], next: null });
  warrantyGrants(f, buyer, { active: false });
  assert.equal(
    (await http.inject({ method: "GET", url, headers: freshHeaders }))
      .statusCode,
    401,
  );
});
