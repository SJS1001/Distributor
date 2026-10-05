import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture, accept, ship } from "./fixtures.ts";
import { seedOrderQueue } from "./order-queue-fixture.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import type { Role } from "../src/server/core.ts";
function user(f: ReturnType<typeof fixture>, role: Role) {
  const row = f.app.identity.createUser(f.actor, `contact-${role}`, {
    name: role,
    email: `contact-${role}@example.test`,
    password: "long-contact-test-password",
    role,
    sites: [f.w1],
    accountId: role === "buyer" ? f.buyer : undefined,
  });
  return f.app.identity.currentActor({ ...f.actor, id: row.id });
}
const input = (accountId: string) => ({
  accountId,
  expectedRevision: 0,
  name: "Pat Smith",
  title: "Purchasing",
  email: "pat@example.test",
  phone: "555-0100",
  archived: false,
});
test("contacts persist exact retries, revisions, archive history and authenticated audit across restart", (t) => {
  const f = fixture(t),
    body = input(f.buyer),
    start = Date.now();
  const first = f.app.identity.contacts.save(f.actor, "create-contact", body);
  assert.equal(first.createdBy, f.actor.id);
  assert.equal(first.updatedBy, f.actor.id);
  assert.ok(Date.parse(first.createdAt) >= start);
  assert.equal(first.revision, 1);
  assert.deepEqual(
    f.app.identity.contacts.save(f.actor, "create-contact", body),
    first,
  );
  assert.throws(
    () =>
      f.app.identity.contacts.save(f.actor, "create-contact", {
        ...body,
        name: "Other",
      }),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  const support = user(f, "support"),
    update = {
      ...body,
      contactId: first.id,
      expectedRevision: 1,
      archived: true,
    };
  const archived = f.app.identity.contacts.save(support, "archive", update);
  assert.equal(archived.createdBy, f.actor.id);
  assert.equal(archived.updatedBy, support.id);
  assert.equal(archived.createdAt, first.createdAt);
  assert.equal(archived.revision, 2);
  assert.throws(() => f.app.identity.contacts.save(support, "stale", update), {
    code: "STALE_VERSION",
  });
  const restored = f.app.identity.contacts.save(support, "restore", {
    ...update,
    expectedRevision: 2,
    archived: false,
  });
  assert.equal(restored.revision, 3);
  const details = f.app.database
    .owned("platform")
    .all<{ detail: string; actor_id: string }>(
      "SELECT detail,actor_id FROM platform_audit WHERE action='account.contact.saved'",
    );
  assert.equal(details.length, 3);
  assert.equal(JSON.parse(details[1]!.detail).previous.revision, 1);
  assert.equal(JSON.parse(details[1]!.detail).contact.archived, true);
  assert.equal(details[1]!.actor_id, support.id);
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(f.app.identity.contacts.list(f.actor, f.buyer).items, [
    restored,
  ]);
  assert.deepEqual(
    f.app.identity.contacts.save(f.actor, "create-contact", body),
    first,
  );
  assert.equal(f.app.identity.contacts.list(f.actor, f.buyer).items.length, 1);
});
test("contacts fail closed for buyers, stale grants, foreign scope and malformed input", (t) => {
  const f = fixture(t),
    body = input(f.buyer),
    created = f.app.identity.contacts.save(f.actor, "create", body),
    other = f.app.identity.createCustomer(f.actor, "other", {
      name: "Other",
      tier: "standard",
      creditLimit: 0,
    }).id;
  for (const role of [
    "commercial",
    "finance",
    "support",
    "warehouse",
    "warranty",
    "buyer",
  ] as const) {
    const actor = user(f, role);
    if (role === "buyer") {
      assert.throws(
        () =>
          f.app.identity.contacts.list({ ...actor, role: "admin" }, f.buyer),
        { code: "FORBIDDEN" },
      );
      assert.throws(() => f.app.identity.contacts.save(actor, role, body), {
        code: "FORBIDDEN",
      });
      continue;
    }
    assert.equal(
      f.app.identity.contacts.list(actor, f.buyer).items.length,
      role === "commercial"
        ? 1
        : role === "finance"
          ? 2
          : role === "support"
            ? 3
            : 4,
    );
    if (role === "warehouse" || role === "warranty")
      assert.throws(() => f.app.identity.contacts.save(actor, role, body), {
        code: "FORBIDDEN",
      });
    else f.app.identity.contacts.save(actor, role, body);
  }
  for (const accountId of ["missing", "foreign-account"]) {
    if (accountId === "foreign-account") {
      const foreign = f.app.identity.createCustomer(f.actor, "foreign", {
        name: "Foreign",
        tier: "standard",
        creditLimit: 0,
      });
      f.app.database
        .owned("iam")
        .run(
          "UPDATE iam_accounts SET id=?,org_id='foreign' WHERE id=?",
          accountId,
          foreign.id,
        );
    }
    assert.throws(() => f.app.identity.contacts.list(f.actor, accountId), {
      code: "NOT_FOUND",
    });
    assert.throws(
      () =>
        f.app.identity.contacts.save(f.actor, accountId, {
          ...body,
          accountId,
        }),
      { code: "NOT_FOUND" },
    );
  }
  assert.throws(
    () =>
      f.app.identity.contacts.save(f.actor, "wrong-parent", {
        ...body,
        accountId: other,
        contactId: created.id,
        expectedRevision: 1,
      }),
    { code: "NOT_FOUND" },
  );
  for (const invalid of [
    { accountId: ` ${f.buyer} ` },
    { name: "" },
    { name: "x".repeat(201) },
    { email: "broken" },
    { phone: "x".repeat(81) },
    { expectedRevision: -1 },
    { archived: "false" },
  ])
    assert.throws(
      () =>
        f.app.identity.contacts.save(f.actor, "bad", {
          ...body,
          ...invalid,
        } as typeof body),
      { code: "VALIDATION" },
    );
  const support = f.app.identity
    .users(f.actor)
    .find((u) => u.role === "support")!;
  const actor = f.app.identity.currentActor({
    ...f.actor,
    id: String(support.id),
  });
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
      actor.id,
    );
  assert.throws(() => f.app.identity.contacts.list(actor, f.buyer), {
    code: "PASSWORD_CHANGE_REQUIRED",
  });
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_user_security SET password_change_required=0 WHERE user_id=?",
      actor.id,
    );
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='warehouse' WHERE id=?", actor.id);
  assert.throws(() => f.app.identity.contacts.save(actor, "support", body), {
    code: "FORBIDDEN",
  });
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET active=0 WHERE id=?", actor.id);
  assert.throws(() => f.app.identity.contacts.list(actor, f.buyer), {
    code: "FORBIDDEN",
  });
});
test("contact cap includes archived records while allowing revisioned edits", (t) => {
  const f = fixture(t),
    body = input(f.buyer);
  for (let i = 0; i < 100; i++)
    f.app.identity.contacts.save(f.actor, String(i), {
      ...body,
      archived: true,
    });
  const list = f.app.identity.contacts.list(f.actor, f.buyer);
  assert.equal(list.items.length, 100);
  assert.throws(() => f.app.identity.contacts.save(f.actor, "overflow", body), {
    code: "CONTACT_LIMIT",
  });
  f.app.identity.contacts.save(f.actor, "edit", {
    ...body,
    contactId: list.items[0]!.id,
    expectedRevision: 1,
  });
  assert.equal(
    f.app.identity.contacts.list(f.actor, f.buyer).items.length,
    100,
  );
});
test("customer history filters before pagination and rejects account-crossing cursors and unauthorized money reads", (t) => {
  const f = fixture(t),
    other = f.app.identity.createCustomer(f.actor, "other", {
      name: "Other",
      tier: "standard",
      creditLimit: 0,
    }).id;
  seedOrderQueue(f, 23, "target");
  seedOrderQueue(f, 31, "other", other);
  const first = f.app.orders.orderPage(
      f.actor,
      undefined,
      undefined,
      undefined,
      f.buyer,
    ),
    last = f.app.orders.orderPage(
      f.actor,
      first.next!,
      undefined,
      undefined,
      f.buyer,
    );
  assert.equal(first.items.length, 20);
  assert.equal(last.items.length, 3);
  assert.ok(
    [...first.items, ...last.items].every((o) => o.account_id === f.buyer),
  );
  assert.throws(
    () =>
      f.app.orders.orderPage(f.actor, first.next!, undefined, undefined, other),
    { code: "CURSOR" },
  );
  const invoiceId = ship(f, accept(f).id).invoiceId,
    store = f.app.database.owned("billing"),
    base = store.get<Record<string, any>>(
      "SELECT * FROM billing_invoices WHERE id=?",
      invoiceId,
    )!;
  for (let i = 0; i < 54; i++) {
    const row = {
      ...base,
      id: `invoice-${String(i).padStart(3, "0")}`,
      number: `SYNTHETIC-${i}`,
      shipment_id: `synthetic-shipment-${i}`,
      account_id: i < 23 ? f.buyer : other,
    };
    store.run(
      `INSERT INTO billing_invoices(${Object.keys(row).join(",")}) VALUES(${Object.keys(
        row,
      )
        .map(() => "?")
        .join(",")})`,
      ...Object.values(row),
    );
    f.app.database.transaction(() =>
      f.app.billing.verifiedPayment(
        f.actor,
        row.id,
        1,
        "manual",
        `SYNTHETIC-${i}`,
      ),
    );
  }
  const invoices = f.app.billing.invoicePage(f.actor, { accountId: f.buyer }),
    invoiceLast = f.app.billing.invoicePage(f.actor, {
      accountId: f.buyer,
      after: invoices.next!,
    });
  assert.equal(invoices.items.length, 20);
  assert.equal(invoiceLast.items.length, 4);
  assert.ok(
    [...invoices.items, ...invoiceLast.items].every(
      (i) => i.account_id === f.buyer,
    ),
  );
  assert.throws(
    () =>
      f.app.billing.invoicePage(f.actor, {
        accountId: other,
        after: invoices.next!,
      }),
    { code: "VALIDATION" },
  );
  assert.throws(
    () => f.app.billing.invoicePage(f.actor, { after: invoices.next! }),
    { code: "VALIDATION" },
  );
  for (const after of [
    "bad",
    Buffer.from(JSON.stringify([2, null, "missing", f.buyer])).toString(
      "base64url",
    ),
  ])
    assert.throws(() =>
      f.app.billing.invoicePage(f.actor, { accountId: f.buyer, after }),
    );
  const payments = f.app.billing.paymentHistory.page(
      f.actor,
      undefined,
      undefined,
      f.buyer,
    ),
    paymentLast = f.app.billing.paymentHistory.page(
      f.actor,
      payments.next!,
      undefined,
      f.buyer,
    );
  assert.equal(payments.items.length, 20);
  assert.equal(paymentLast.items.length, 3);
  assert.equal(
    new Set([...payments.items, ...paymentLast.items].map((p) => p.id)).size,
    23,
  );
  assert.throws(
    () =>
      f.app.billing.paymentHistory.page(
        f.actor,
        payments.next!,
        undefined,
        other,
      ),
    { code: "CURSOR" },
  );
  const buyer = user(f, "buyer"),
    warehouse = user(f, "warehouse"),
    commercial = user(f, "commercial");
  assert.equal(
    f.app.orders.orderPage(buyer, undefined, undefined, undefined, f.buyer)
      .items.length,
    20,
  );
  assert.equal(
    f.app.billing.invoicePage(buyer, { accountId: f.buyer }).items.length,
    20,
  );
  assert.throws(
    () => f.app.orders.orderPage(buyer, undefined, undefined, undefined, other),
    { code: "FORBIDDEN" },
  );
  assert.throws(() => f.app.billing.invoicePage(buyer, { accountId: other }), {
    code: "FORBIDDEN",
  });
  for (const actor of [buyer, warehouse, commercial])
    assert.throws(
      () =>
        f.app.billing.paymentHistory.page(actor, undefined, undefined, f.buyer),
      { code: "FORBIDDEN" },
    );
  assert.throws(
    () => f.app.billing.invoicePage(warehouse, { accountId: f.buyer }),
    { code: "FORBIDDEN" },
  );
  f.app.database
    .owned("orders")
    .run(
      "UPDATE orders_orders SET warehouse_id=? WHERE account_id=?",
      f.w2,
      f.buyer,
    );
  assert.equal(
    f.app.orders.orderPage(warehouse, undefined, undefined, undefined, f.buyer)
      .items.length,
    0,
  );
  const padded = ` ${f.buyer} `;
  assert.throws(
    () =>
      f.app.orders.orderPage(f.actor, undefined, undefined, undefined, padded),
    { code: "VALIDATION" },
  );
  assert.throws(
    () => f.app.billing.invoicePage(f.actor, { accountId: padded }),
    { code: "VALIDATION" },
  );
  assert.throws(
    () =>
      f.app.billing.paymentHistory.page(f.actor, undefined, undefined, padded),
    { code: "VALIDATION" },
  );
  for (const accountId of ["missing", other]) {
    if (accountId === other)
      f.app.database
        .owned("iam")
        .run("UPDATE iam_accounts SET org_id='foreign' WHERE id=?", other);
    assert.throws(
      () =>
        f.app.orders.orderPage(
          f.actor,
          undefined,
          undefined,
          undefined,
          accountId,
        ),
      { code: "NOT_FOUND" },
    );
    assert.throws(() => f.app.billing.invoicePage(f.actor, { accountId }), {
      code: "NOT_FOUND",
    });
    assert.throws(
      () =>
        f.app.billing.paymentHistory.page(
          f.actor,
          undefined,
          undefined,
          accountId,
        ),
      { code: "NOT_FOUND" },
    );
  }
});
test("HTTP contacts require session, CSRF, strict server identity fields and current authority", async (t) => {
  const f = fixture(t),
    origin = "http://127.0.0.1:3000",
    http = await createHttp(f.app, {
      origin,
      staticRoot: "/nonexistent-distributor-test",
    });
  await http.ready();
  t.after(() => http.close());
  const url = `/api/accounts/${f.buyer}/contacts`;
  assert.equal((await http.inject({ url })).statusCode, 401);
  const login = await http.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: {
        email: "admin@example.test",
        password: "long-test-only-password",
      },
    }),
    cookie = login.cookies[0]!;
  const headers = {
    origin,
    cookie: `${cookie.name}=${cookie.value}`,
    "x-csrf-token": login.json().csrf,
    "idempotency-key": "http-contact",
  };
  assert.equal(
    (await http.inject({ url, headers })).headers["cache-control"],
    "no-store",
  );
  assert.equal(
    (await http.inject({ url: url + "?limit=500", headers })).statusCode,
    400,
  );
  const command = {
    method: "POST" as const,
    url: "/api/commands/account.contact.save",
    headers,
    payload: input(f.buyer),
  };
  assert.equal(
    (
      await http.inject({
        ...command,
        headers: { ...headers, "x-csrf-token": "bad" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await http.inject({
        ...command,
        payload: { ...command.payload, updatedBy: "spoof" },
      })
    ).statusCode,
    400,
  );
  const save = await http.inject(command);
  assert.equal(save.statusCode, 200, save.body);
  assert.equal((await http.inject(command)).json().id, save.json().id);
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET active=0 WHERE id=?", f.actor.id);
  assert.equal((await http.inject({ url, headers })).statusCode, 401);
});
test("HTTP customer records preserve staff role boundaries and reject cross-account buyer reads", async (t) => {
  const f = fixture(t),
    origin = "http://127.0.0.1:3000",
    other = f.app.identity.createCustomer(f.actor, "other", {
      name: "Other",
      tier: "standard",
      creditLimit: 0,
    }).id;
  const http = await createHttp(f.app, {
    origin,
    staticRoot: "/nonexistent-distributor-test",
  });
  await http.ready();
  t.after(() => http.close());
  for (const role of [
    "commercial",
    "finance",
    "support",
    "warehouse",
    "warranty",
    "buyer",
  ] as const) {
    const actor = user(f, role),
      login = await http.inject({
        method: "POST",
        url: "/api/login",
        headers: { origin },
        payload: {
          email: `contact-${role}@example.test`,
          password: "long-contact-test-password",
        },
      }),
      cookie = login.cookies[0]!;
    assert.equal(login.statusCode, 200);
    const headers = {
      origin,
      cookie: `${cookie.name}=${cookie.value}`,
      "x-csrf-token": login.json().csrf,
      "idempotency-key": role,
    };
    const contacts = await http.inject({
      url: `/api/accounts/${f.buyer}/contacts`,
      headers,
    });
    assert.equal(contacts.statusCode, role === "buyer" ? 403 : 200);
    const write = await http.inject({
      method: "POST",
      url: "/api/commands/account.contact.save",
      headers,
      payload: input(f.buyer),
    });
    assert.equal(
      write.statusCode,
      ["commercial", "finance", "support"].includes(role) ? 200 : 403,
    );
    assert.equal(
      (
        await http.inject({
          url: `/api/billing/payments/page?accountId=${f.buyer}`,
          headers,
        })
      ).statusCode,
      ["finance", "support"].includes(role) ? 200 : 403,
    );
    assert.equal(
      (
        await http.inject({
          url: `/api/billing/invoices/page?accountId=${f.buyer}`,
          headers,
        })
      ).statusCode,
      role === "warehouse" ? 403 : 200,
    );
    if (role === "buyer")
      for (const path of ["orders", "billing/invoices"])
        assert.equal(
          (
            await http.inject({
              url: `/api/${path}/page?accountId=${other}`,
              headers,
            })
          ).statusCode,
          403,
        );
    if (role === "support") {
      f.app.database
        .owned("iam")
        .run("UPDATE iam_users SET role='warehouse' WHERE id=?", actor.id);
      assert.equal(
        (
          await http.inject({
            method: "POST",
            url: "/api/commands/account.contact.save",
            headers,
            payload: input(f.buyer),
          })
        ).statusCode,
        403,
      );
    }
  }
});
