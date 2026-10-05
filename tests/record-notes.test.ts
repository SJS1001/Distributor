import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture, accept, ship } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import type { Actor, Role } from "../src/server/core.ts";
import type { RecordNoteTarget } from "../src/shared/record-notes.ts";
const password = "long-test-only-password";
function user(
  f: ReturnType<typeof fixture>,
  role: Role,
  name: string = role,
  sites = [f.w1],
) {
  const { id } = f.app.identity.createUser(f.actor, `notes-${name}`, {
    name,
    email: `notes-${name}@example.test`,
    password,
    role,
    sites: role === "buyer" ? [] : sites,
    ...(role === "buyer" ? { accountId: f.buyer } : {}),
  });
  return f.app.identity.currentActor({ ...f.actor, id });
}
const target = (f: ReturnType<typeof fixture>): RecordNoteTarget => ({
  kind: "customer",
  recordId: f.buyer,
});
function facts(f: ReturnType<typeof fixture>) {
  return [
    f.app.database
      .owned("notes")
      .all("SELECT * FROM notes_records ORDER BY sequence"),
    f.app.database
      .owned("notes")
      .all("SELECT * FROM notes_verifications ORDER BY rowid"),
  ];
}
test("notes retain server author and time; separate verification, immutable content and exact retries survive restart", (t) => {
  const f = fixture(t),
    reviewer = user(f, "commercial"),
    input = {
      ...target(f),
      body: "Verified the delivery address with the named contact.",
    };
  const before = Date.now();
  const note = f.app.notes.add(
    { ...f.actor, name: "Spoofed name" },
    "add",
    input,
  );
  assert.equal(note.authorId, f.actor.id);
  assert.equal(note.authorName, f.actor.name);
  assert.equal(note.visibility, "staff");
  assert.equal(note.verification, null);
  assert.ok(
    Date.parse(note.createdAt) >= before &&
      Date.parse(note.createdAt) <= Date.now(),
  );
  assert.deepEqual(f.app.notes.add(f.actor, "add", input), note);
  assert.throws(
    () => f.app.notes.add(f.actor, "add", { ...input, body: "Changed" }),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  const verification = { ...target(f), noteId: note.id };
  assert.throws(() => f.app.notes.verify(f.actor, "self", verification), {
    code: "INDEPENDENT_REVIEW",
  });
  const verified = f.app.notes.verify(
    { ...reviewer, name: "Spoofed reviewer" },
    "verify",
    verification,
  );
  assert.equal(verified.verification?.verifierId, reviewer.id);
  assert.equal(verified.verification?.verifierName, reviewer.name);
  assert.ok(Date.parse(verified.verification!.verifiedAt) >= before);
  const store = f.app.database.owned("notes");
  for (const sql of [
    "UPDATE notes_records SET body='changed'",
    "DELETE FROM notes_records",
    "UPDATE notes_verifications SET verifier_name='changed'",
    "DELETE FROM notes_verifications",
    "INSERT OR REPLACE INTO notes_records SELECT * FROM notes_records",
    "INSERT OR REPLACE INTO notes_verifications SELECT * FROM notes_verifications",
  ])
    assert.throws(() => store.run(sql), /append-only/);
  const retained = facts(f);
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(
    f.app.notes.verify(reviewer, "verify", verification),
    verified,
  );
  assert.deepEqual(f.app.notes.add(f.actor, "add", input), note);
  assert.deepEqual(f.app.notes.list(f.actor, target(f)).items, [verified]);
  assert.deepEqual(facts(f), retained);
  assert.throws(
    () => f.app.notes.verify(reviewer, "another-verification", verification),
    { code: "NOTE_ALREADY_VERIFIED" },
  );
});
test("all five record kinds have isolated notes; owner readers enforce organization and warehouse site", (t) => {
  const f = fixture(t),
    order = accept(f),
    shipment = ship(f, order.id),
    invoice = f.app.fulfillment.shipment(f.actor, shipment.id).invoice_id!;
  const targets: RecordNoteTarget[] = [
    target(f),
    { kind: "product", recordId: f.product },
    { kind: "order", recordId: order.id },
    { kind: "shipment", recordId: shipment.id },
    { kind: "invoice", recordId: invoice },
  ];
  for (const item of targets) {
    const note = f.app.notes.add(f.actor, item.kind, {
      ...item,
      body: `Staff ${item.kind} note`,
    });
    assert.deepEqual(f.app.notes.list(f.actor, item).items, [note]);
  }
  const warehouse = user(f, "warehouse"),
    wrongSite = user(f, "warehouse", "wrongsite", [f.w2]);
  for (const item of targets.filter((x) =>
    ["order", "shipment", "invoice"].includes(x.kind),
  )) {
    assert.equal(f.app.notes.list(warehouse, item).items.length, 1);
    assert.throws(() => f.app.notes.list(wrongSite, item), {
      code: "FORBIDDEN",
    });
    assert.throws(
      () =>
        f.app.notes.add(wrongSite, "wrong" + item.kind, {
          ...item,
          body: "No access",
        }),
      { code: "FORBIDDEN" },
    );
  }
  for (const item of targets)
    assert.throws(
      () => f.app.notes.list(f.actor, { ...item, recordId: "unknown-record" }),
      { code: "NOT_FOUND" },
    );
  f.app.database
    .owned("iam")
    .run(
      "INSERT INTO iam_accounts(id,org_id,name,currency,tier,credit_limit) VALUES('foreign','foreign-org','Private','CAD','trade',100000)",
    );
  assert.throws(
    () =>
      f.app.notes.add(f.actor, "foreign", {
        kind: "customer",
        recordId: "foreign",
        body: "Private",
      }),
    { code: "NOT_FOUND" },
  );
});
test("buyers and forged roles cannot read, append or verify staff notes, including other customer IDs", (t) => {
  const f = fixture(t),
    buyer = user(f, "buyer"),
    note = f.app.notes.add(f.actor, "note", {
      ...target(f),
      body: "Private staff detail",
    });
  const other = f.app.identity.createCustomer(f.actor, "other", {
    name: "Other",
    tier: "trade",
    creditLimit: 1000,
  }).id;
  const retained = facts(f);
  for (const actor of [
    buyer,
    { ...buyer, role: "admin" as const, accountId: null, name: "Fake" },
  ])
    for (const recordId of [f.buyer, other]) {
      const input = { kind: "customer" as const, recordId };
      assert.throws(() => f.app.notes.list(actor, input), {
        code: "FORBIDDEN",
      });
      assert.throws(
        () => f.app.notes.add(actor, "buyer-note", { ...input, body: "No" }),
        { code: "FORBIDDEN" },
      );
      assert.throws(
        () =>
          f.app.notes.verify(actor, "buyer-verify", {
            ...input,
            noteId: note.id,
          }),
        { code: "FORBIDDEN" },
      );
    }
  assert.deepEqual(facts(f), retained);
});
test("pagination is stable across timestamp ties and concurrent additions; cursors are bound to the same record", (t) => {
  const f = fixture(t),
    ids: string[] = [];
  for (let i = 0; i < 25; i++)
    ids.push(
      f.app.notes.add(f.actor, String(i), { ...target(f), body: `Note ${i}` })
        .id,
    );
  const first = f.app.notes.list(f.actor, target(f));
  assert.equal(first.items.length, 20);
  assert.equal(first.next, ids[5]);
  f.app.notes.add(f.actor, "newer", { ...target(f), body: "Concurrent note" });
  const second = f.app.notes.list(f.actor, target(f), first.next!);
  assert.deepEqual(
    second.items.map((x) => x.id),
    ids.slice(0, 5).reverse(),
  );
  assert.equal(second.next, null);
  const product = { kind: "product" as const, recordId: f.product };
  assert.throws(() => f.app.notes.list(f.actor, product, first.next!), {
    code: "NOT_FOUND",
  });
  assert.throws(
    () =>
      f.app.notes.verify(user(f, "commercial"), "cross-target", {
        ...product,
        noteId: ids[0]!,
      }),
    { code: "NOT_FOUND" },
  );
  for (const cursor of ["missing", "{}", "x".repeat(129), ""])
    assert.throws(() => f.app.notes.list(f.actor, target(f), cursor));
});
test("native notes revalidate current role, password reset, MFA enrollment and revocation on cached commands", (t) => {
  const f = fixture(t),
    reviewer = user(f, "commercial"),
    support = user(f, "support"),
    note = f.app.notes.add(f.actor, "note", {
      ...target(f),
      body: "Review this note",
    }),
    input = { ...target(f), noteId: note.id };
  assert.equal(f.app.notes.list(support, target(f)).canVerify, false);
  assert.throws(() => f.app.notes.verify(support, "support", input), {
    code: "FORBIDDEN",
  });
  f.app.notes.verify(reviewer, "verify", input);
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_users SET role='buyer',account_id=? WHERE id=?",
      f.buyer,
      reviewer.id,
    );
  assert.throws(() => f.app.notes.verify(reviewer, "verify", input), {
    code: "FORBIDDEN",
  });
  f.app.database
    .owned("iam")
    .run(
      "INSERT INTO iam_user_security VALUES(?,1,1,'2026-10-05T00:00:00.000Z') ON CONFLICT(user_id) DO UPDATE SET password_change_required=1",
      f.actor.id,
    );
  assert.throws(() => f.app.notes.list(f.actor, target(f)), {
    code: "PASSWORD_CHANGE_REQUIRED",
  });
  assert.throws(
    () =>
      f.app.notes.add(f.actor, "note", {
        ...target(f),
        body: "Review this note",
      }),
    { code: "PASSWORD_CHANGE_REQUIRED" },
  );
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_user_security SET password_change_required=0 WHERE user_id=?",
      f.actor.id,
    );
  f.app.close();
  f.app = new Application(f.path, "CA", {
    mfaEncryptionKey: "a".repeat(64),
    mfaRequiredRoles: ["admin"],
  });
  assert.throws(() => f.app.notes.list(f.actor, target(f)), {
    code: "MFA_REQUIRED",
  });
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET active=0 WHERE id=?", f.actor.id);
  assert.throws(() => f.app.notes.list(f.actor, target(f)), {
    code: "FORBIDDEN",
  });
});
test("body bounds and restore holds reject writes without altering notes", (t) => {
  const f = fixture(t),
    retained = facts(f);
  for (const body of ["", "   ", "x".repeat(4001)])
    assert.throws(
      () => f.app.notes.add(f.actor, "bad", { ...target(f), body }),
      { code: "VALIDATION" },
    );
  assert.deepEqual(facts(f), retained);
  f.app.platform.isolateRestore("b".repeat(64), new Date().toISOString());
  assert.throws(() =>
    f.app.notes.add(f.actor, "restore-held", { ...target(f), body: "Held" }),
  );
  assert.deepEqual(facts(f), retained);
});
test("HTTP enforces sessions, CSRF, strict server author/time, body bounds, buyer secrecy and current session revocation", async (t) => {
  const f = fixture(t);
  user(f, "buyer");
  user(f, "commercial");
  const origin = "http://localhost:3210",
    http = await createHttp(f.app, { origin });
  t.after(() => http.close());
  async function login(email: string) {
    const response = await http.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: { email, password },
    });
    assert.equal(response.statusCode, 200, response.body);
    return {
      origin,
      cookie: `${response.cookies[0]!.name}=${response.cookies[0]!.value}`,
      "x-csrf-token": response.json().csrf,
      "idempotency-key": "http-add",
    };
  }
  const admin = await login("admin@example.test"),
    buyer = await login("notes-buyer@example.test"),
    reviewer = await login("notes-commercial@example.test");
  const url = `/api/notes/customer/${f.buyer}`,
    input = { ...target(f), body: "HTTP staff note" };
  assert.equal((await http.inject({ url })).statusCode, 401);
  for (const extra of [
    { authorId: "spoofed" },
    { authorName: "Spoofed" },
    { createdAt: "2020-01-01" },
    { visibility: "customer" },
    { verification: { verifierId: "spoofed" } },
  ])
    assert.equal(
      (
        await http.inject({
          method: "POST",
          url: "/api/commands/notes.add",
          headers: admin,
          payload: { ...input, ...extra },
        })
      ).statusCode,
      400,
    );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: "/api/commands/notes.add",
        headers: { ...admin, "x-csrf-token": "bad" },
        payload: input,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: "/api/commands/notes.add",
        headers: admin,
        payload: { ...input, body: "x".repeat(4001) },
      })
    ).statusCode,
    400,
  );
  const response = await http.inject({
    method: "POST",
    url: "/api/commands/notes.add",
    headers: admin,
    payload: input,
  });
  assert.equal(response.statusCode, 200, response.body);
  const note = response.json();
  const page = await http.inject({ url, headers: admin });
  assert.equal(page.statusCode, 200);
  assert.equal(page.headers["cache-control"], "no-store");
  assert.equal(page.json().items[0].id, note.id);
  const verified = await http.inject({
    method: "POST",
    url: "/api/commands/notes.verify",
    headers: { ...reviewer, "idempotency-key": "http-verify" },
    payload: { ...target(f), noteId: note.id },
  });
  assert.equal(verified.statusCode, 200, verified.body);
  assert.ok(verified.json().verification);
  assert.equal((await http.inject({ url, headers: buyer })).statusCode, 403);
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: "/api/commands/notes.add",
        headers: buyer,
        payload: input,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await http.inject({
        url: url + "?after=" + "x".repeat(129),
        headers: admin,
      })
    ).statusCode,
    400,
  );
  f.app.identity.logout(admin.cookie.split("=")[1]!);
  assert.equal((await http.inject({ url, headers: admin })).statusCode, 401);
});
