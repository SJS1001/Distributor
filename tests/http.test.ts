import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, accept, ship } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";

const origin = "http://127.0.0.1:3000";
async function setup(t: { after: (fn: () => void | Promise<void>) => void }) {
  const f = fixture(t),
    http = await createHttp(f.app, {
      origin,
      staticRoot: "/nonexistent-distributor-test",
    });
  await http.ready();
  t.after(() => http.close());
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: {
      email: "admin@example.test",
      password: "long-test-only-password",
    },
  });
  assert.equal(login.statusCode, 200);
  const session = login.json(),
    cookie = login.cookies[0]!;
  return {
    ...f,
    http,
    headers: {
      origin,
      cookie: `${cookie.name}=${cookie.value}`,
      "x-csrf-token": session.csrf,
      "idempotency-key": "http-test",
    },
  };
}
test("HTTP transfer receiving requires exact portion fields and rechecks destination grants before returning a committed receipt", async (t) => {
  const f = await setup(t),
    u = f.app.inventory.trace(f.actor, "S3").unit;
  const transfer = f.app.inventory.dispatchTransfer(f.actor, "dispatch", {
    unitId: u.id,
    quantity: 1,
    revision: u.revision,
    destinationId: f.w2,
    reason: "Synthetic HTTP relocation",
  });
  const payload = {
    transferId: transfer.id,
    lineId: transfer.lineId,
    quantity: 1,
    serial: "S3",
    receiptRef: "HTTP-ARRIVAL",
    bin: "B-1",
    condition: "usable",
    reason: "Synthetic HTTP arrival",
  };
  const url = "/api/commands/transfer.receive";
  assert.equal(
    (
      await f.http.inject({
        method: "POST",
        url,
        headers: f.headers,
        payload: { transferId: transfer.id, bin: "B-1", condition: "usable" },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await f.http.inject({
        method: "POST",
        url,
        headers: f.headers,
        payload: { ...payload, destinationId: f.w1 },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await f.http.inject({
        method: "POST",
        url,
        headers: f.headers,
        payload: { ...payload, serial: "S2" },
      })
    ).statusCode,
    409,
  );
  assert.equal(f.app.inventory.trace(f.actor, "S3").unit.state, "transit");
  const first = await f.http.inject({
    method: "POST",
    url,
    headers: f.headers,
    payload,
  });
  assert.equal(first.statusCode, 200);
  assert.deepEqual(
    (
      await f.http.inject({
        method: "POST",
        url,
        headers: { ...f.headers, "idempotency-key": "different-key" },
        payload,
      })
    ).json(),
    first.json(),
  );
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_users SET role='warehouse',sites=? WHERE id=?",
      JSON.stringify([f.w1]),
      f.actor.id,
    );
  const denied = await f.http.inject({
    method: "POST",
    url,
    headers: f.headers,
    payload,
  });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.json().code, "FORBIDDEN");
  const destinations = await f.http.inject({
    url: "/api/transfer-destinations",
    headers: f.headers,
  });
  assert.deepEqual(
    destinations.json().map((w: any) => w.name),
    ["Ottawa", "Toronto"],
  );
  const dashboard = await f.http.inject({
    url: "/api/dashboard",
    headers: f.headers,
  });
  assert.equal(
    dashboard.json().stock.some((s: any) => s.warehouse_id === f.w2),
    false,
  );
  assert.equal(
    f.app.inventory.transfers(f.actor)[0]!.lines[0]!.receipts.length,
    1,
  );
});
test("HTTP boundary authenticates, validates exact task fields, requires origin/CSRF, and revokes grants on a cached command", async (t) => {
  const f = await setup(t);
  assert.equal((await f.http.inject("/api/health")).statusCode, 200);
  assert.equal((await f.http.inject("/api/dashboard")).statusCode, 401);
  const payload = { name: "HTTP Warehouse" },
    url = "/api/commands/warehouse.create";
  assert.equal(
    (
      await f.http.inject({
        method: "POST",
        url,
        headers: { cookie: f.headers.cookie },
        payload,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await f.http.inject({
        method: "POST",
        url,
        headers: { ...f.headers, "x-csrf-token": "wrong" },
        payload,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await f.http.inject({
        method: "POST",
        url,
        headers: f.headers,
        payload: { ...payload, role: "admin" },
      })
    ).statusCode,
    400,
  );
  const first = await f.http.inject({
    method: "POST",
    url,
    headers: f.headers,
    payload,
  });
  assert.equal(first.statusCode, 200);
  const second = await f.http.inject({
    method: "POST",
    url,
    headers: f.headers,
    payload,
  });
  assert.deepEqual(second.json(), first.json());
  assert.equal(f.app.inventory.warehouses(f.actor).length, 3);
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='support' WHERE id=?", f.actor.id);
  const denied = await f.http.inject({
    method: "POST",
    url,
    headers: f.headers,
    payload,
  });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.json().code, "FORBIDDEN");
  assert.equal(
    f.app.platform
      .audits(f.actor)
      .filter((a) => a.action === "authorization.denied").length,
    2,
  );
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET active=0 WHERE id=?", f.actor.id);
  assert.equal(
    (await f.http.inject({ url: "/api/dashboard", headers: f.headers }))
      .statusCode,
    401,
  );
});
test("buyer HTTP requests cannot read another account or grant provider exceptions to it", async (t) => {
  const f = await setup(t),
    order = accept(f),
    shipment = ship(f, order.id),
    other = f.app.identity.createCustomer(f.actor, "other", {
      name: "Other buyer",
      tier: "standard",
      creditLimit: 1000000,
    }).id;
  f.app.identity.createUser(f.actor, "buyer-user", {
    name: "Other buyer",
    email: "buyer@example.test",
    password: "long-buyer-test-password",
    role: "buyer",
    accountId: other,
    sites: [],
  });
  const login = await f.http.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: {
        email: "buyer@example.test",
        password: "long-buyer-test-password",
      },
    }),
    cookie = login.cookies[0]!;
  const headers = {
    origin,
    cookie: `${cookie.name}=${cookie.value}`,
    "x-csrf-token": login.json().csrf,
    "idempotency-key": "buyer-command",
  };
  const dashboard = await f.http.inject({ url: "/api/dashboard", headers });
  assert.equal(dashboard.statusCode, 200);
  assert.equal(dashboard.json().accounts.length, 1);
  assert.deepEqual(dashboard.json().invoices, []);
  assert.deepEqual(dashboard.json().orders, []);
  const checkout = await f.http.inject({
    method: "POST",
    url: "/api/commands/stripe.checkout",
    headers,
    payload: { invoiceId: shipment.invoiceId },
  });
  assert.equal(checkout.statusCode, 403);
  const residency = await f.http.inject({
    method: "POST",
    url: "/api/commands/account.residency",
    headers,
    payload: {
      accountId: f.buyer,
      region: "CA",
      mode: "provider-exceptions",
      providers: ["stripe"],
      version: 1,
      acknowledgment: "Accepted test exception",
    },
  });
  assert.equal(residency.statusCode, 403);
});

test("HTTP loss/recovery validates exact evidence fields, rejects stale custody and revoked approval authority even on committed retries", async (t) => {
  const f = await setup(t),
    u = f.app.inventory.trace(f.actor, "S3").unit;
  const tr = f.app.inventory.dispatchTransfer(f.actor, "dispatch", {
    unitId: u.id,
    quantity: 1,
    revision: u.revision,
    destinationId: f.w2,
    reason: "HTTP loss fixture",
  });
  const payload = {
    transferId: tr.id,
    lineId: tr.lineId,
    revision: f.app.inventory.unit(f.actor, u.id).revision,
    quantity: 1,
    serial: "S3",
    lossRef: "HTTP-LOSS",
    reason: "Investigation evidence",
  };
  const lossUrl = "/api/commands/transfer.loss";
  for (const invalid of [
    { ...payload, revision: undefined },
    { ...payload, approverId: "invented-admin" },
    { ...payload, quantity: 0 },
  ])
    assert.equal(
      (
        await f.http.inject({
          method: "POST",
          url: lossUrl,
          headers: f.headers,
          payload: invalid,
        })
      ).statusCode,
      400,
    );
  const stale = await f.http.inject({
    method: "POST",
    url: lossUrl,
    headers: f.headers,
    payload: { ...payload, revision: u.revision },
  });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().code, "REVISION");
  assert.equal(f.app.inventory.trace(f.actor, "S3").unit.quantity, 1);
  const loss = await f.http.inject({
    method: "POST",
    url: lossUrl,
    headers: f.headers,
    payload,
  });
  assert.equal(loss.statusCode, 200);
  assert.deepEqual(
    (
      await f.http.inject({
        method: "POST",
        url: lossUrl,
        headers: { ...f.headers, "idempotency-key": "new-loss-key" },
        payload,
      })
    ).json(),
    loss.json(),
  );
  const recoverUrl = "/api/commands/transfer.recover";
  const found = {
    lossId: loss.json().lossId,
    quantity: 1,
    serial: "S3",
    receiptRef: "HTTP-FOUND",
    bin: "Q-1",
    condition: "quarantine",
    reason: "Found serial scanned and inspected",
  };
  assert.equal(
    (
      await f.http.inject({
        method: "POST",
        url: recoverUrl,
        headers: f.headers,
        payload: { ...found, destinationId: f.w1 },
      })
    ).statusCode,
    400,
  );
  const wrong = await f.http.inject({
    method: "POST",
    url: recoverUrl,
    headers: f.headers,
    payload: { ...found, serial: "S2" },
  });
  assert.equal(wrong.statusCode, 409);
  assert.equal(wrong.json().code, "SERIAL");
  const receipt = await f.http.inject({
    method: "POST",
    url: recoverUrl,
    headers: f.headers,
    payload: found,
  });
  assert.equal(receipt.statusCode, 200);
  assert.equal(receipt.json().unitId, u.id);
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_users SET role='warehouse',sites=? WHERE id=?",
      JSON.stringify([f.w1, f.w2]),
      f.actor.id,
    );
  for (const [url, p] of [
    [lossUrl, payload],
    [recoverUrl, found],
  ] as const) {
    const denied = await f.http.inject({
      method: "POST",
      url,
      headers: f.headers,
      payload: p,
    });
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.json().code, "FORBIDDEN");
  }
  const line = f.app.inventory.transfers(f.actor)[0]!.lines[0]!;
  assert.equal(line.losses.length, 1);
  assert.equal(line.losses[0]!.recoveries.length, 1);
  assert.equal(line.receivedQuantity, 1);
  assert.equal(line.lostQuantity, 0);
  assert.equal(f.app.inventory.availability(f.actor, f.product, f.w2), 0);
});

test("HTTP count review uses exact task fields and current administrator/site authority even for committed retries", async (t) => {
  const f = await setup(t);
  const product = f.app.catalog.create(f.actor, "count-product", {
    sku: "COUNT-HTTP",
    name: "Synthetic count lot",
    serialized: false,
    unitPrice: 2500,
    taxBasisPoints: 1300,
  }).id;
  const po = f.app.procurement.create(f.actor, "count-po", {
    supplierId: f.supplier,
    warehouseId: f.w1,
    lines: [{ productId: product, quantity: 4, unitCost: 1000 }],
  }).id;
  f.app.procurement.receive(f.actor, "count-receive", {
    poId: po,
    lineId: String(
      f.app.procurement.orders(f.actor).find((p) => p.id === po)!.lines[0]!.id,
    ),
    deliveryRef: "COUNT-HTTP",
    quantity: 4,
    serials: [],
    bin: "C-1",
    quarantine: false,
  });
  const unit = f.app.inventory
    .stock(f.actor)
    .find((u) => u.product_id === product)!;
  const post = (name: string, payload: Record<string, unknown>, key = name) =>
    f.http.inject({
      method: "POST",
      url: `/api/commands/${name}`,
      headers: { ...f.headers, "idempotency-key": key },
      payload,
    });
  const input = {
    unitId: unit.id,
    revision: unit.revision,
    countRef: "HTTP-COUNT",
  };
  assert.equal(
    (await post("count.start", { ...input, approverId: f.actor.id }))
      .statusCode,
    400,
  );
  const start = await post("count.start", input);
  assert.equal(start.statusCode, 200);
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_users SET role='warehouse',sites=? WHERE id=?",
      JSON.stringify([f.w1]),
      f.actor.id,
    );
  const observation = {
    countId: start.json().id,
    quantity: 3,
    reason: "Synthetic physical count evidence",
  };
  assert.equal(
    (await post("count.submit", { ...observation, unitCost: 1 })).statusCode,
    400,
  );
  assert.equal((await post("count.submit", observation)).statusCode, 200);
  const decision = {
    countId: observation.countId,
    decision: "approve",
    reason: "Synthetic review",
  };
  assert.equal((await post("count.decide", decision)).statusCode, 403);
  assert.equal(
    (
      await post("stock.count", {
        unitId: unit.id,
        revision: unit.revision,
        count: 3,
        reason: "Bypass",
      })
    ).statusCode,
    403,
  );
  assert.equal(f.app.inventory.unit(f.actor, unit.id).quantity, 4);
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='admin' WHERE id=?", f.actor.id);
  assert.equal(
    (await post("count.decide", { ...decision, observedBy: f.actor.id }))
      .statusCode,
    400,
  );
  const approved = await post("count.decide", decision);
  assert.equal(approved.statusCode, 200);
  assert.equal(approved.json().adjustment.valueDelta, -1000);
  assert.deepEqual(
    (await post("count.decide", decision, "new-review-key")).json(),
    approved.json(),
  );
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_users SET role='warehouse',sites=? WHERE id=?",
      JSON.stringify([f.w2]),
      f.actor.id,
    );
  assert.equal((await post("count.decide", decision)).statusCode, 403);
  assert.equal((await post("count.submit", observation)).statusCode, 403);
  assert.equal((await post("count.start", input)).statusCode, 403);
  const counts = await f.http.inject({
    url: "/api/counts",
    headers: f.headers,
  });
  assert.equal(counts.statusCode, 200);
  assert.deepEqual(counts.json(), []);
  assert.equal(f.app.inventory.unit(f.actor, unit.id).quantity, 3);
  assert.equal(
    f.app.database
      .owned("inventory")
      .all(
        "SELECT id FROM inventory_movements WHERE type='count' AND unit_id=?",
        unit.id,
      ).length,
    1,
  );
});

test("HTTP supplier handover rejects caller-supplied cost/identity and revoked role retries while exposing only authorized custody history", async (t) => {
  const f = await setup(t);
  const unit = f.app.inventory.trace(f.actor, "S3").unit;
  const payload = {
    receiptId: f.app.inventory.purchaseOrigin(f.actor, unit.id)!,
    unitId: unit.id,
    revision: unit.revision,
    quantity: 1,
    serial: "S3",
    returnRef: "HTTP-SUPPLIER-RETURN",
    reason: "Synthetic supplier-approved defect",
    handoverEvidence: "Synthetic courier receipt",
  };
  const post = (input: Record<string, unknown>, key = "supplier-return") =>
    f.http.inject({
      method: "POST",
      url: "/api/commands/purchase.return",
      headers: { ...f.headers, "idempotency-key": key },
      payload: input,
    });
  for (const extra of [
    { unitCost: 1 },
    { supplierId: f.supplier },
    { approverId: f.actor.id },
  ]) {
    assert.equal((await post({ ...payload, ...extra })).statusCode, 400);
  }
  assert.equal((await post({ ...payload, serial: "S2" })).statusCode, 409);
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_users SET role='warehouse',sites=? WHERE id=?",
      JSON.stringify([f.w1]),
      f.actor.id,
    );
  assert.equal((await post(payload)).statusCode, 403);
  assert.equal(f.app.inventory.unit(f.actor, unit.id).quantity, 1);
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='admin' WHERE id=?", f.actor.id);
  const committed = await post(payload);
  assert.equal(committed.statusCode, 200);
  assert.equal(committed.json().value, 6000);
  assert.deepEqual((await post(payload, "new-key")).json(), committed.json());
  assert.equal(
    (await post({ ...payload, reason: "Changed evidence" }, "conflict"))
      .statusCode,
    409,
  );
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='finance' WHERE id=?", f.actor.id);
  assert.equal((await post(payload)).statusCode, 403);
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_users SET role='warehouse',sites=? WHERE id=?",
      JSON.stringify([f.w2]),
      f.actor.id,
    );
  const excluded = await f.http.inject({
    url: "/api/purchases",
    headers: f.headers,
  });
  assert.equal(excluded.statusCode, 200);
  assert.deepEqual(excluded.json().returns, []);
  assert.deepEqual(excluded.json().receipts, []);
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_users SET sites=? WHERE id=?",
      JSON.stringify([f.w1]),
      f.actor.id,
    );
  const history = (
    await f.http.inject({ url: "/api/purchases", headers: f.headers })
  ).json();
  assert.equal(history.returns.length, 1);
  assert.equal(history.returns[0].handover_evidence, payload.handoverEvidence);
  assert.equal(history.returns[0].input_hash, undefined);
  assert.equal(history.receipts[0].unit_ids, undefined);
  assert.equal(history.receipts[0].returnedQuantity, 1);
  assert.equal(f.app.inventory.unit(f.actor, unit.id).quantity, 0);
  assert.equal(f.app.billing.invoices(f.actor).length, 0);
  assert.equal(f.app.billing.credits(f.actor).length, 0);
});
