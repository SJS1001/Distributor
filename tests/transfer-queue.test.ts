import { test } from "node:test";
import assert from "node:assert/strict";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import { Store } from "../src/server/database.ts";
import type { Actor, Row } from "../src/server/core.ts";
import type { SQLInputValue } from "node:sqlite";
import { transferQueueStates } from "../src/shared/transfer-queue.ts";
import { fixture } from "./fixtures.ts";

function transfers(f: ReturnType<typeof fixture>, count = 45) {
  const productId = f.app.catalog.create(f.actor, "queue-product", {
    sku: "TRANSFER-QUEUE",
    name: "Synthetic transfer queue supplies",
    serialized: false,
    unitPrice: 2500,
    taxBasisPoints: 1300,
  }).id;
  const poId = f.app.procurement.create(f.actor, "queue-po", {
    supplierId: f.supplier,
    warehouseId: f.w1,
    lines: [{ productId, quantity: count * 3, unitCost: 1000 }],
  }).id;
  const lineId = String(
    f.app.procurement.orders(f.actor).find((p) => p.id === poId)!.lines[0]!.id,
  );
  f.app.procurement.receive(f.actor, "queue-stock", {
    poId,
    lineId,
    quantity: count * 3,
    serials: [],
    deliveryRef: "SYNTHETIC-QUEUE-STOCK",
    bin: "A-1",
    quarantine: false,
  });
  const source = f.app.inventory
    .stock(f.actor)
    .find((u) => u.product_id === productId)!;
  const result = Array.from({ length: count }, (_, i) =>
    f.app.inventory.dispatchTransfer(f.actor, `queue-dispatch-${i}`, {
      unitId: source.id,
      quantity: 3,
      revision: f.app.inventory.unit(f.actor, source.id).revision,
      destinationId: f.w2,
      reason: "Synthetic queue dispatch",
    }),
  );
  // Freeze header times to qualify insertion-order ties, not wall-clock luck.
  f.app.database
    .owned("inventory")
    .run(
      "UPDATE inventory_transfers SET created_at=? WHERE org_id=?",
      "2026-10-02T12:00:00.000Z",
      f.actor.orgId,
    );
  return result;
}
function facts(f: ReturnType<typeof fixture>) {
  return [
    "units",
    "transfers",
    "transfer_lines",
    "transfer_manifest",
    "transfer_receipts",
    "transfer_losses",
    "transfer_recoveries",
    "movements",
  ]
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
    reason: "Synthetic queue authority change",
  });
}
for (const region of ["CA", "US"] as const) {
  test(`${region} transfer pages traverse tied headers, conserve facts and survive restart without truncating legacy reads`, (t) => {
    const f = fixture(t, {}, region),
      rows = transfers(f),
      before = facts(f);
    const first = f.app.inventory.transferPage(f.actor);
    assert.equal(first.items.length, 20);
    assert.ok(first.next);
    assert.deepEqual(facts(f), before);
    assert.equal(f.app.inventory.transfers(f.actor).length, 45);
    f.app.close();
    f.app = new Application(f.path, region);
    assert.deepEqual(f.app.inventory.transferPage(f.actor), first);
    const second = f.app.inventory.transferPage(f.actor, {
      after: first.next!,
    });
    const third = f.app.inventory.transferPage(f.actor, {
      after: second.next!,
    });
    assert.equal(second.items.length, 20);
    assert.equal(third.items.length, 5);
    assert.equal(third.next, null);
    assert.deepEqual(
      [...first.items, ...second.items, ...third.items].map((r) => r.id),
      rows.map((r) => r.id).reverse(),
    );
    assert.deepEqual(facts(f), before);
  });
  test(`${region} live transfer filters match receipts, unresolved losses and complete recovery before the header limit`, (t) => {
    const f = fixture(t, {}, region),
      rows = transfers(f);
    const receive = (index: number, quantity: number) =>
      f.app.inventory.receiveTransfer(f.actor, `queue-arrival-${index}`, {
        transferId: rows[index]!.id,
        lineId: rows[index]!.lineId,
        quantity,
        serial: null,
        receiptRef: `SYNTHETIC-ARRIVAL-${index}`,
        bin: "B-1",
        condition: "usable",
        reason: "Synthetic arrival evidence",
      });
    receive(0, 1);
    receive(1, 3);
    const loss = (index: number, quantity: number) =>
      f.app.inventory.approveTransferLoss(f.actor, `queue-loss-${index}`, {
        transferId: rows[index]!.id,
        lineId: rows[index]!.lineId,
        quantity,
        revision: f.app.inventory.unit(f.actor, rows[index]!.unitId).revision,
        serial: null,
        lossRef: `SYNTHETIC-LOSS-${index}`,
        reason: "Synthetic retained loss evidence",
      });
    loss(2, 1);
    loss(3, 3);
    const recovered = loss(4, 3);
    f.app.inventory.recoverTransferLoss(f.actor, "queue-recovery", {
      lossId: recovered.lossId,
      quantity: 3,
      serial: null,
      receiptRef: "SYNTHETIC-FOUND",
      bin: "Q-1",
      condition: "quarantine",
      reason: "Synthetic recovery evidence",
    });
    const before = facts(f),
      legacy = f.app.inventory.transfers(f.actor);
    for (const state of transferQueueStates) {
      const page = f.app.inventory.transferPage(f.actor, { state });
      const expected = legacy.filter((r) => r.state === state).map((r) => r.id);
      const actual = [...page.items];
      if (page.next)
        actual.push(
          ...f.app.inventory.transferPage(f.actor, { state, after: page.next })
            .items,
        );
      assert.deepEqual(actual.map((r) => r.id).sort(), expected.sort());
      assert.ok(actual.every((r) => r.state === state));
    }
    assert.deepEqual(facts(f), before);
    const page = f.app.inventory.transferPage(f.actor, { state: "transit" });
    const anchor = rows.find((r) => r.id === page.items[19]!.id)!;
    f.app.inventory.receiveTransfer(f.actor, "queue-anchor-arrival", {
      transferId: anchor.id,
      lineId: anchor.lineId,
      quantity: 3,
      serial: null,
      receiptRef: "SYNTHETIC-ANCHOR",
      bin: "B-2",
      condition: "usable",
      reason: "Synthetic changed anchor",
    });
    const continuation = f.app.inventory.transferPage(f.actor, {
      state: "transit",
      after: page.next!,
    });
    assert.equal(continuation.items.length, 20);
    assert.ok(
      continuation.items.every(
        (r) => r.id !== anchor.id && r.state === "transit",
      ),
    );
  });
}

test("transfer SQL scopes headers before limiting and detail expansion; fresh grants bind continuation", (t) => {
  const f = fixture(t),
    rows = transfers(f);
  const third = f.app.inventory.createWarehouse(f.actor, "queue-third", {
    name: "Synthetic remote warehouse",
  }).id;
  const row = f.app.identity.createUser(f.actor, "queue-operator", {
    email: "queue-operator@example.test",
    name: "Queue operator",
    password: "long-test-only-password",
    role: "warehouse",
    sites: [f.w1],
  });
  const actor = f.app.identity.currentActor({ ...f.actor, id: row.id });
  f.app.database
    .owned("inventory")
    .run(
      "UPDATE inventory_transfers SET source_id=?,destination_id=? WHERE org_id=? AND rowid>25",
      third,
      f.w2,
      f.actor.orgId,
    );
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
  const before = facts(f);
  queries.length = 0;
  try {
    page = f.app.inventory.transferPage({
      ...actor,
      role: "admin",
      sites: [third],
    });
  } finally {
    Store.prototype.all = all;
  }
  assert.equal(page.items.length, 20);
  assert.ok(page.items.every((r) => r.source_id === f.w1));
  const headers = queries.filter((q) =>
    q.sql.includes("FROM inventory_transfers t"),
  );
  assert.equal(headers.length, 1);
  assert.match(headers[0]!.sql, /source_id IN.*destination_id IN/);
  assert.match(headers[0]!.sql, /LIMIT 21/);
  assert.equal(
    queries.filter((q) =>
      q.sql.includes("FROM inventory_transfer_manifest m JOIN"),
    ).length,
    20,
  );
  assert.deepEqual(facts(f), before);
  const admin = f.app.inventory.transferPage(f.actor);
  assert.throws(
    () => f.app.inventory.transferPage(actor, { after: admin.next! }),
    { code: "VALIDATION" },
  );
  assert.throws(
    () =>
      f.app.inventory.transferPage(actor, {
        state: "received",
        after: page.next!,
      }),
    { code: "VALIDATION" },
  );
  for (const after of [
    "not-base64!",
    page.next! + "=",
    " " + page.next!,
    Buffer.from(
      JSON.stringify([
        "transfer-queue",
        1,
        actor.orgId,
        actor.sites,
        null,
        rows[44]!.id,
      ]),
    ).toString("base64url"),
  ]) {
    assert.throws(
      () => f.app.inventory.transferPage(actor, { after }),
      (e: unknown) =>
        ["VALIDATION", "CURSOR"].includes((e as { code: string }).code),
    );
  }
  grant(f, actor, []);
  assert.deepEqual(f.app.inventory.transferPage(actor), {
    items: [],
    next: null,
  });
  assert.throws(
    () => f.app.inventory.transferPage(actor, { after: page.next! }),
    { code: "VALIDATION" },
  );
  grant(f, actor, [f.w1], false);
  assert.throws(() => f.app.inventory.transferPage(actor), {
    code: "FORBIDDEN",
  });
});

test("legacy whole receipt projection and missing cursor anchors are explicit", (t) => {
  const f = fixture(t),
    rows = transfers(f, 21);
  const store = f.app.database.owned("inventory");
  store.run(
    "UPDATE inventory_transfer_lines SET received=1 WHERE org_id=? AND id=?",
    f.actor.orgId,
    rows[0]!.lineId,
  );
  const before = facts(f);
  const partial = f.app.inventory.transferPage(f.actor, {
    state: "partially-received",
  });
  assert.deepEqual(
    partial.items.map((r) => r.id),
    [rows[0]!.id],
  );
  assert.equal(partial.items[0]!.lines[0]!.legacyReceived, true);
  assert.deepEqual(facts(f), before);
  store.run(
    "UPDATE inventory_transfers SET state='received' WHERE org_id=? AND id=?",
    f.actor.orgId,
    rows[0]!.id,
  );
  const received = f.app.inventory.transferPage(f.actor, { state: "received" });
  assert.deepEqual(
    received.items.map((r) => r.id),
    [rows[0]!.id],
  );
  const page = f.app.inventory.transferPage(f.actor);
  const cursor = JSON.parse(
    Buffer.from(page.next!, "base64url").toString("utf8"),
  );
  cursor[5] = "synthetic-missing-anchor";
  assert.throws(
    () =>
      f.app.inventory.transferPage(f.actor, {
        after: Buffer.from(JSON.stringify(cursor)).toString("base64url"),
      }),
    { code: "CURSOR" },
  );
  cursor[2] = "synthetic-other-organization";
  assert.throws(
    () =>
      f.app.inventory.transferPage(f.actor, {
        after: Buffer.from(JSON.stringify(cursor)).toString("base64url"),
      }),
    { code: "VALIDATION" },
  );
});

test("transfer HTTP validates session, filters, cursor bounds and fields while preserving the legacy endpoint", async (t) => {
  const f = fixture(t);
  transfers(f);
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
  const response = await http.inject({ url: "/api/transfers/page", headers });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().items.length, 20);
  assert.equal(response.headers["cache-control"], "no-store");
  const next = await http.inject({
    url: "/api/transfers/page?after=" + response.json().next,
    headers,
  });
  assert.equal(next.statusCode, 200);
  assert.equal(next.json().items.length, 20);
  assert.equal(
    (await http.inject({ url: "/api/transfers", headers })).json().length,
    45,
  );
  for (const suffix of [
    "?limit=100",
    "?state=unknown",
    "?after=",
    "?after=" + "x".repeat(4097),
  ])
    assert.equal(
      (await http.inject({ url: "/api/transfers/page" + suffix, headers }))
        .statusCode,
      400,
    );
  assert.equal(
    (await http.inject({ url: "/api/transfers/page" })).statusCode,
    401,
  );
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET active=0 WHERE id=?", f.actor.id);
  assert.equal(
    (await http.inject({ url: "/api/transfers/page", headers })).statusCode,
    401,
  );
});
