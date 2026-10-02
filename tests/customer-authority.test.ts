import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, accept } from "./fixtures.ts";
import type { Actor, Role } from "../src/server/core.ts";
import { Application } from "../src/server/application.ts";

function user(f: ReturnType<typeof fixture>, role: Role, name: string = role) {
  const result = f.app.identity.createUser(f.actor, `customer-${name}`, {
    name,
    email: `customer-${name}@example.test`,
    password: "long-customer-test-password",
    role,
    sites: role === "buyer" ? [] : [f.w1],
    ...(role === "buyer" ? { accountId: f.buyer } : {}),
  });
  return f.app.identity.currentActor({ ...f.actor, id: result.id });
}
function change(
  f: ReturnType<typeof fixture>,
  actor: Actor,
  updates: Record<string, unknown>,
) {
  const row = f.app.identity.users(f.actor).find((u) => u.id === actor.id)!;
  f.app.identity.updateUser(
    f.actor,
    `customer-grant-${actor.id}-${row.revision}`,
    {
      userId: actor.id,
      revision: row.revision,
      name: actor.name,
      email: row.email,
      role: actor.role,
      sites: actor.sites,
      ...(actor.accountId ? { accountId: actor.accountId } : {}),
      active: true,
      currentPassword: "long-test-only-password",
      reason: "Synthetic customer authority change",
      ...updates,
    },
  );
}
function facts(f: ReturnType<typeof fixture>) {
  return [
    f.app.database
      .owned("iam")
      .all("SELECT * FROM iam_accounts ORDER BY rowid"),
    ...["commands", "audit", "audit_order", "audit_clock", "events"].map((n) =>
      f.app.database
        .owned("platform")
        .all(`SELECT * FROM platform_${n} ORDER BY rowid`),
    ),
  ];
}
const input = {
  name: "New synthetic customer",
  tier: "standard",
  creditLimit: 10000,
};
function importRow(f: ReturnType<typeof fixture>) {
  return {
    sourceId: "ACCOUNT-1",
    targetId: f.buyer,
    name: "Synthetic buyer",
    tier: "standard",
    creditLimit: 1000000,
    held: false,
  };
}
function reads(f: ReturnType<typeof fixture>, actor: Actor) {
  return [
    () => f.app.identity.customer(actor, f.buyer),
    () => f.app.identity.customers(actor),
    () => f.app.identity.reviewCustomerImport(actor, importRow(f)),
    () => f.app.identity.applyCustomerImport(actor, importRow(f)),
    () =>
      f.app.identity.applyCustomerImport(actor, {
        ...importRow(f),
        targetId: null,
        name: "Denied import customer",
      }),
  ];
}
function commands(f: ReturnType<typeof fixture>, actor: Actor) {
  const hold = { accountId: f.buyer, held: false, reason: "Synthetic release" };
  f.app.identity.createCustomer(actor, "authority-create", input);
  f.app.identity.setHold(actor, "authority-hold", hold);
  return (prefix: string) => [
    () =>
      f.app.identity.createCustomer(
        actor,
        prefix ? `${prefix}-create` : "authority-create",
        input,
      ),
    () =>
      f.app.identity.setHold(
        actor,
        prefix ? `${prefix}-hold` : "authority-hold",
        hold,
      ),
  ];
}
function denied(operations: (() => unknown)[], code = "FORBIDDEN") {
  for (const operation of operations) assert.throws(operation, { code });
}

test("unavailable customer principals cannot read, import or return old/new command results", (t) => {
  const f = fixture(t),
    actor = user(f, "admin"),
    operations = commands(f, actor);
  change(f, actor, { active: false });
  const before = facts(f);
  denied([...reads(f, actor), ...operations(""), ...operations("new")]);
  for (const invalid of [
    { ...actor, id: "absent-principal" },
    { ...actor, orgId: "foreign-organization" },
  ])
    denied(reads(f, invalid));
  assert.deepEqual(facts(f), before);
});

test("customer command and import authority follows revoked administrator grants before replay", (t) => {
  const f = fixture(t),
    actor = user(f, "admin"),
    operations = commands(f, actor);
  change(f, actor, { role: "buyer", sites: [], accountId: f.buyer });
  const before = facts(f);
  denied([
    ...operations(""),
    ...operations("new"),
    ...reads(f, actor).slice(2),
  ]);
  assert.equal(f.app.identity.customer(actor, f.buyer).id, f.buyer);
  assert.deepEqual(
    f.app.identity.customers(actor).map((c) => c.id),
    [f.buyer],
  );
  assert.deepEqual(facts(f), before);
});

test("forced password changes deny customer reads/imports and both cached/new commands without effects", (t) => {
  const f = fixture(t),
    actor = user(f, "admin"),
    operations = commands(f, actor);
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
      actor.id,
    );
  const before = facts(f);
  denied(
    [...reads(f, actor), ...operations(""), ...operations("new")],
    "PASSWORD_CHANGE_REQUIRED",
  );
  assert.deepEqual(facts(f), before);
});

test("buyer customer reads use current account grants rather than supplied role or account", (t) => {
  const f = fixture(t),
    actor = user(f, "buyer");
  const other = f.app.identity.createCustomer(f.actor, "other-account", {
    ...input,
    name: "Other synthetic customer",
  }).id;
  const forged = { ...actor, role: "admin" as const, accountId: other };
  const before = facts(f);
  denied([() => f.app.identity.customer(forged, other)]);
  assert.deepEqual(
    f.app.identity.customers(forged).map((c) => c.id),
    [f.buyer],
  );
  assert.deepEqual(facts(f), before);
  change(f, actor, { accountId: other });
  const reassigned = facts(f);
  denied([() => f.app.identity.customer(actor, f.buyer)]);
  assert.equal(f.app.identity.customer(actor, other).id, other);
  assert.deepEqual(
    f.app.identity.customers(actor).map((c) => c.id),
    [other],
  );
  assert.deepEqual(facts(f), reassigned);
});

test("an unassigned persisted buyer never receives every customer through the nullable list filter", (t) => {
  const f = fixture(t),
    actor = user(f, "buyer");
  f.app.identity.createCustomer(f.actor, "other-account", input);
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET account_id=NULL WHERE id=?", actor.id);
  const before = facts(f);
  assert.deepEqual(
    f.app.identity.customers({ ...actor, role: "admin", accountId: null }),
    [],
  );
  denied([() => f.app.identity.customer(actor, f.buyer)]);
  assert.deepEqual(facts(f), before);
});

test("persisted finance/commercial grants govern hold/create, and revoked holds cannot release order restrictions", (t) => {
  const f = fixture(t),
    finance = user(f, "finance"),
    commercial = user(f, "commercial");
  const hold = {
    accountId: f.buyer,
    held: true,
    reason: "Synthetic credit restriction",
  };
  f.app.identity.setHold(
    { ...finance, role: "buyer", accountId: f.buyer },
    "hold-on",
    hold,
  );
  assert.equal(f.app.identity.customer(f.actor, f.buyer).held, 1);
  assert.throws(() => accept(f), { code: "CREDIT_HOLD" });
  f.app.identity.createCustomer(
    { ...commercial, role: "buyer", accountId: f.buyer },
    "create-commercial",
    input,
  );
  const release = { ...hold, held: false };
  f.app.identity.setHold(finance, "release-before-revocation", release);
  f.app.identity.setHold(f.actor, "restore-hold", hold);
  change(f, finance, { role: "warehouse" });
  const before = facts(f);
  denied([
    () => f.app.identity.setHold(finance, "release-before-revocation", release),
    () => f.app.identity.setHold(finance, "release-after-revocation", release),
  ]);
  assert.equal(f.app.identity.customer(f.actor, f.buyer).held, 1);
  assert.deepEqual(facts(f), before);
  assert.throws(() => accept(f, 1, "still-held"), { code: "CREDIT_HOLD" });
});

test("independent customer grant changes and actual restart fence both completed commands", (t) => {
  const f = fixture(t),
    actor = user(f, "admin"),
    operations = commands(f, actor);
  const second = new Application(f.path, "CA");
  try {
    change({ ...f, app: second }, actor, { role: "support" });
  } finally {
    second.close();
  }
  const before = facts(f);
  denied([...operations(""), ...operations("new")]);
  f.app.close();
  f.app = new Application(f.path, "CA");
  denied(commandsAfterRestart(f, actor));
  assert.deepEqual(facts(f), before);
});
function commandsAfterRestart(f: ReturnType<typeof fixture>, actor: Actor) {
  return [
    () => f.app.identity.createCustomer(actor, "authority-create", input),
    () =>
      f.app.identity.setHold(actor, "authority-hold", {
        accountId: f.buyer,
        held: false,
        reason: "Synthetic release",
      }),
  ];
}
