import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, chooseProviders, syntheticDisclosure } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";
import { Application } from "../src/server/application.ts";
import { providerNames } from "../src/shared/provider-choices.ts";

function choose(
  f: ReturnType<typeof fixture>,
  version: number,
  accountId = f.buyer,
  providers = ["stripe", "quickbooks"],
) {
  return chooseProviders(
    f,
    f.actor,
    `acceptance-history-${accountId}-${version}`,
    {
      accountId,
      region: "CA",
      mode: providers.length ? "provider-exceptions" : "strict",
      providers,
      version,
      acknowledgment: "Synthetic recorded customer review",
    },
  );
}
function reader(
  f: ReturnType<typeof fixture>,
  role: "buyer" | "support" | "warehouse" = "buyer",
) {
  const id = f.app.identity.createUser(f.actor, `reader-${role}`, {
    email: `${role}@acceptances.example.test`,
    name: `Synthetic ${role}`,
    password: "long-test-only-password",
    role,
    ...(role === "buyer" ? { accountId: f.buyer } : {}),
    sites: role === "warehouse" ? [f.w1] : [],
  }).id;
  return f.app.identity.currentActor({ ...f.actor, id });
}

test("acceptance versions are scoped, descending and bounded across gaps, new choices, withdrawal and restart", (t) => {
  const f = fixture(t),
    actor = reader(f);
  assert.deepEqual(
    f.app.identity.residency.acceptanceVersions(actor, f.buyer),
    { items: [], next: null },
  );
  for (let version = 1; version < 27; version++)
    choose(
      f,
      version,
      f.buyer,
      version === 12
        ? []
        : version === 26
          ? [...providerNames]
          : ["stripe", "quickbooks"],
    );
  const native = f.app.dashboard(f.actor),
    first = f.app.identity.residency.acceptanceVersions(actor, f.buyer);
  assert.equal(first.items.length, 20);
  assert.deepEqual(
    first.items.map((r) => r.version),
    Array.from({ length: 20 }, (_, i) => 27 - i)
      .filter((v) => v !== 13)
      .concat(7)
      .slice(0, 20),
  );
  assert.equal(first.items[0]!.providerCount, 8);
  assert.equal(first.next, "7");
  choose(f, 27, f.buyer, []);
  choose(f, 28);
  const tail = f.app.identity.residency.acceptanceVersions(
    actor,
    f.buyer,
    Number(first.next),
  );
  assert.deepEqual(
    tail.items.map((r) => r.version),
    [6, 5, 4, 3, 2],
  );
  assert.equal(tail.next, null);
  const newest = f.app.identity.residency.acceptanceVersions(actor, f.buyer);
  assert.equal(newest.items[0]!.version, 29);
  const terms = f.app.identity.residency
    .current(f.actor)
    .find((d) => d.provider === "stripe")!;
  f.app.identity.residency.publish(
    f.actor,
    "revised",
    syntheticDisclosure(f.app, "stripe", terms.id, "synthetic-history-v2"),
  );
  assert.deepEqual(
    f.app.identity.residency.acceptanceVersions(actor, f.buyer),
    newest,
  );
  f.app.identity.residency.withdraw(f.actor, "withdraw", {
    provider: "quickbooks",
    disclosureId: f.app.identity.residency
      .current(f.actor)
      .find((d) => d.provider === "quickbooks")!.id,
    reason: "Synthetic vendor withdrawal",
  });
  assert.deepEqual(
    f.app.identity.residency.acceptanceVersions(actor, f.buyer),
    newest,
  );
  assert.deepEqual(f.app.dashboard(f.actor).stock, native.stock);
  assert.deepEqual(f.app.dashboard(f.actor).orders, native.orders);
  assert.deepEqual(f.app.dashboard(f.actor).invoices, native.invoices);
  f.app.close();
  f.app = new Application(f.path, "CA");
  assert.deepEqual(
    f.app.identity.residency.acceptanceVersions(actor, f.buyer),
    newest,
  );
  assert.equal(
    f.app.identity.residency.disclosure(actor, terms.id).hash,
    terms.hash,
  );
});

test("history uses actual current grants before cursors and refuses forged account/role/org and password changes", (t) => {
  const f = fixture(t),
    actor = reader(f),
    other = f.app.identity.createCustomer(f.actor, "other", {
      name: "Other account",
      tier: "standard",
      creditLimit: 0,
    }).id;
  choose(f, 1);
  choose(f, 1, other);
  choose(f, 2, other);
  assert.throws(
    () => f.app.identity.residency.acceptanceVersions(actor, f.buyer, 3),
    { code: "CURSOR" },
  );
  for (const cursor of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN])
    assert.throws(
      () => f.app.identity.residency.acceptanceVersions(actor, f.buyer, cursor),
      { code: "VALIDATION" },
    );
  assert.throws(
    () =>
      f.app.identity.residency.acceptanceVersions(
        { ...actor, role: "admin", accountId: other },
        other,
      ),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () =>
      f.app.identity.residency.acceptanceVersions(
        { ...actor, orgId: "foreign" },
        f.buyer,
      ),
    { code: "FORBIDDEN" },
  );
  const support = reader(f, "support");
  assert.equal(
    f.app.identity.residency.acceptanceVersions(support, other).items.length,
    2,
  );
  const warehouse = reader(f, "warehouse");
  assert.throws(
    () =>
      f.app.identity.residency.acceptanceVersions(
        { ...warehouse, role: "admin" },
        f.buyer,
      ),
    { code: "FORBIDDEN" },
  );
  const store = f.app.database.owned("iam");
  store.run(
    "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
    actor.id,
  );
  assert.throws(
    () => f.app.identity.residency.acceptanceVersions(actor, f.buyer, 2),
    { code: "PASSWORD_CHANGE_REQUIRED" },
  );
  store.run(
    "UPDATE iam_user_security SET password_change_required=0 WHERE user_id=?",
    actor.id,
  );
  store.run("UPDATE iam_users SET account_id=? WHERE id=?", other, actor.id);
  assert.throws(
    () => f.app.identity.residency.acceptanceVersions(actor, f.buyer),
    { code: "FORBIDDEN" },
  );
  store.run("UPDATE iam_users SET active=0 WHERE id=?", actor.id);
  assert.throws(
    () => f.app.identity.residency.acceptanceVersions(actor, other),
    { code: "FORBIDDEN" },
  );
});

test("HTTP acceptance history rejects invalid queries and foreign cursors without exposing private disclosure evidence", async (t) => {
  const f = fixture(t),
    actor = reader(f),
    other = f.app.identity.createCustomer(f.actor, "other", {
      name: "Other account",
      tier: "standard",
      creditLimit: 0,
    }).id;
  choose(f, 1);
  choose(f, 1, other);
  choose(f, 2, other);
  const origin = "http://127.0.0.1:3000",
    http = await createHttp(f.app, {
      origin,
      staticRoot: "/nonexistent-distributor-test",
    });
  t.after(() => http.close());
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: {
      email: "buyer@acceptances.example.test",
      password: "long-test-only-password",
    },
  });
  assert.equal(login.statusCode, 200);
  const headers = {
      cookie: `${login.cookies[0]!.name}=${login.cookies[0]!.value}`,
    },
    url = `/api/accounts/${f.buyer}/provider-acceptance-versions`;
  assert.equal((await http.inject({ url })).statusCode, 401);
  const result = await http.inject({ url, headers });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(
    result.json(),
    f.app.identity.residency.acceptanceVersions(actor, f.buyer),
  );
  assert.ok(!result.body.includes("review_evidence"));
  assert.ok(!result.body.includes("evidence_ref"));
  assert.equal(
    (await http.inject({ url: `${url}?after=2`, headers })).statusCode,
    200,
  );
  assert.equal(
    (await http.inject({ url: `${url}?after=3`, headers })).statusCode,
    400,
  );
  for (const query of [
    "after=0",
    "after=-1",
    "after=1.5",
    "after=02",
    "after=9007199254740992",
    "after=2&limit=100",
    "after=2&after=3",
  ])
    assert.equal(
      (await http.inject({ url: `${url}?${query}`, headers })).statusCode,
      400,
      query,
    );
  assert.equal(
    (
      await http.inject({
        url: `/api/accounts/${other}/provider-acceptance-versions`,
        headers,
      })
    ).statusCode,
    403,
  );
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET active=0 WHERE id=?", actor.id);
  assert.notEqual((await http.inject({ url, headers })).statusCode, 200);
});
