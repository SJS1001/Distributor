import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, accept, ship } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";
import { warrantyUser, warrantyGrants } from "./warranty-authority-fixtures.ts";
import type { Actor } from "../src/server/core.ts";

const origin = "http://localhost:3000";
async function setup(t: Parameters<typeof fixture>[0]) {
  const f = fixture(t);
  ship(f, accept(f).id);
  const unitId = f.app.inventory.trace(f.actor, "S1").unit.id;
  const claim = f.app.warranty.submit(f.actor, "claim", {
    accountId: f.buyer,
    unitId,
    type: "warranty",
    issue: "Synthetic fault",
    evidence: "Synthetic submission",
  });
  f.app.warranty.review(f.actor, "review", {
    claimId: claim.id,
    approved: true,
    reason: "Synthetic approval",
  });
  f.app.warranty.receive(f.actor, "receive", {
    claimId: claim.id,
    warehouseId: f.w1,
    bin: "Q",
    serial: "S1",
  });
  f.app.warranty.inspect(f.actor, "inspect", {
    claimId: claim.id,
    findings: "Synthetic repairable fault",
  });
  f.app.warranty.dispose(f.actor, "repair", {
    claimId: claim.id,
    disposition: "repair",
    reason: "Synthetic repair authorization",
  });
  const review = f.app.warranty.repairReview(f.actor, claim.id);
  const input = {
    claimId: claim.id,
    unitRevision: review.unitRevision,
    serial: "S1",
    recipient: "PRIVATE-REPAIR-RECIPIENT",
    evidence: "PRIVATE-REPAIR-COLLECTION-EVIDENCE",
    reason: "PRIVATE-REPAIR-REASON",
  };
  const http = await createHttp(f.app, {
    origin,
    staticRoot: "/nonexistent-security-repair",
  });
  t.after(() => {
    void http.close();
  });
  async function login(actor: Actor) {
    const email = String(
      f.app.identity.users(f.actor).find((u) => u.id === actor.id)!.email,
    );
    const reply = await http.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: {
        email,
        password:
          actor.id === f.actor.id
            ? "long-test-only-password"
            : "long-user-test-password",
      },
    });
    assert.equal(reply.statusCode, 200);
    const cookie = reply.cookies[0]!;
    return {
      origin,
      cookie: `${cookie.name}=${cookie.value}`,
      "x-csrf-token": reply.json().csrf,
      "idempotency-key": "repair-collection",
    };
  }
  return {
    ...f,
    http,
    claim,
    input,
    review,
    login,
    readUrl: `/api/warranty/claims/${claim.id}/repair-review`,
    commandUrl: "/api/commands/warranty.repair.handover",
  };
}

test("repair HTTP requires exact task fields and current warehouse/site authority before review, mutation and cached receipt", async (t) => {
  const f = await setup(t),
    worker = warrantyUser(f, "warehouse"),
    headers = await f.login(worker);
  const before = f.app.inventory.trace(f.actor, "S1"),
    commands = f.app.database
      .owned("platform")
      .all("SELECT * FROM platform_commands WHERE name LIKE 'warranty.%'");
  assert.equal((await f.http.inject(f.readUrl)).statusCode, 401);
  assert.deepEqual(
    (await f.http.inject({ url: f.readUrl, headers })).json(),
    f.review,
  );
  assert.equal(
    (await f.http.inject({ url: f.readUrl + "?accountId=forged", headers }))
      .statusCode,
    400,
  );
  for (const role of [
    "buyer",
    "commercial",
    "finance",
    "warranty",
    "support",
  ] as const) {
    const actor = warrantyUser(f, role),
      deniedHeaders = await f.login(actor);
    assert.equal(
      (await f.http.inject({ url: f.readUrl, headers: deniedHeaders }))
        .statusCode,
      403,
      role,
    );
    assert.equal(
      (
        await f.http.inject({
          method: "POST",
          url: f.commandUrl,
          headers: deniedHeaders,
          payload: f.input,
        })
      ).statusCode,
      403,
      role,
    );
  }
  const outOfSite = warrantyUser(f, "warehouse", f.buyer, [f.w2]),
    siteHeaders = await f.login(outOfSite);
  assert.equal(
    (await f.http.inject({ url: f.readUrl, headers: siteHeaders })).statusCode,
    403,
  );
  assert.equal(
    (
      await f.http.inject({
        method: "POST",
        url: f.commandUrl,
        headers: siteHeaders,
        payload: f.input,
      })
    ).statusCode,
    403,
  );
  for (const payload of [
    { ...f.input, accountId: "forged" },
    { ...f.input, unitId: "forged" },
    { ...f.input, unitRevision: 0 },
    { ...f.input, unitRevision: 1.5 },
    { ...f.input, unitRevision: String(f.input.unitRevision) },
    { ...f.input, unitRevision: 1_000_000_001 },
    { ...f.input, serial: "S".repeat(161) },
    { ...f.input, recipient: " " },
    { ...f.input, evidence: "" },
  ])
    assert.equal(
      (
        await f.http.inject({
          method: "POST",
          url: f.commandUrl,
          headers,
          payload,
        })
      ).statusCode,
      400,
    );
  assert.equal(
    (
      await f.http.inject({
        method: "POST",
        url: f.commandUrl,
        headers: { cookie: headers.cookie },
        payload: f.input,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await f.http.inject({
        method: "POST",
        url: f.commandUrl,
        headers: { ...headers, "x-csrf-token": "wrong" },
        payload: f.input,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await f.http.inject({
        method: "POST",
        url: f.commandUrl,
        headers,
        payload: { ...f.input, serial: "S2" },
      })
    ).statusCode,
    409,
  );
  const other = fixture(t),
    foreignId = other.app.inventory.trace(other.actor, "S1").unit.id;
  assert.equal(
    (
      await f.http.inject({
        url: `/api/warranty/claims/${foreignId}/repair-review`,
        headers,
      })
    ).statusCode,
    404,
  );
  assert.deepEqual(f.app.inventory.trace(f.actor, "S1"), before);
  assert.deepEqual(
    f.app.database
      .owned("platform")
      .all("SELECT * FROM platform_commands WHERE name LIKE 'warranty.%'"),
    commands,
  );
  const first = await f.http.inject({
    method: "POST",
    url: f.commandUrl,
    headers,
    payload: f.input,
  });
  assert.equal(first.statusCode, 200);
  assert.deepEqual(
    (
      await f.http.inject({
        method: "POST",
        url: f.commandUrl,
        headers,
        payload: f.input,
      })
    ).json(),
    first.json(),
  );
  warrantyGrants(f, worker, { sites: [f.w2] });
  assert.equal(
    (await f.http.inject({ url: f.readUrl, headers })).statusCode,
    401,
  );
  const changedSiteHeaders = await f.login(worker);
  assert.equal(
    (
      await f.http.inject({
        method: "POST",
        url: f.commandUrl,
        headers: changedSiteHeaders,
        payload: f.input,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await f.http.inject({ url: f.readUrl, headers: changedSiteHeaders }))
      .statusCode,
    403,
  );
  assert.equal(
    f.app.inventory
      .trace(f.actor, "S1")
      .movements.filter((m) => m.type === "repair.handover").length,
    1,
  );
});

test("repair private receipt stays hidden from buyer queues, decisions and downgraded staff sessions", async (t) => {
  const f = await setup(t),
    worker = warrantyUser(f, "warehouse"),
    headers = await f.login(worker);
  const buyer = warrantyUser(f, "buyer"),
    buyerHeaders = await f.login(buyer);
  f.app.warranty.handoverRepair(worker, "repair-collection", f.input);
  const staffReceipt = f.app.warranty
    .list(f.actor)
    .find((c) => c.id === f.claim.id)!.repairHandover!;
  assert.equal(Reflect.get(staffReceipt, "recipient"), f.input.recipient);
  const buyerReceipt = f.app.warranty
    .list(buyer)
    .find((c) => c.id === f.claim.id)!.repairHandover!;
  assert.equal(buyerReceipt.serial, "S1");
  for (const url of [
    "/api/warranty/claims/page",
    `/api/warranty/claims/${f.claim.id}/decisions`,
  ]) {
    const reply = await f.http.inject({ url, headers: buyerHeaders });
    assert.equal(reply.statusCode, 200);
    for (const marker of [f.input.recipient, f.input.evidence, f.input.reason])
      assert.equal(reply.body.includes(marker), false);
  }
  warrantyGrants(f, worker, { role: "buyer", accountId: f.buyer, sites: [] });
  assert.equal(
    (await f.http.inject({ url: "/api/warranty/claims/page", headers }))
      .statusCode,
    401,
  );
  const downgradedHeaders = await f.login(worker);
  const queue = await f.http.inject({
    url: "/api/warranty/claims/page",
    headers: downgradedHeaders,
  });
  assert.equal(queue.statusCode, 200);
  for (const marker of [f.input.recipient, f.input.evidence, f.input.reason])
    assert.equal(queue.body.includes(marker), false);
  assert.equal(
    (
      await f.http.inject({
        method: "POST",
        url: f.commandUrl,
        headers: downgradedHeaders,
        payload: f.input,
      })
    ).statusCode,
    403,
  );
  const account = f.app.identity.createCustomer(f.actor, "other-account", {
    name: "Other synthetic",
    tier: "standard",
    creditLimit: 1000000,
  }).id;
  warrantyGrants(f, buyer, { accountId: account });
  const changedBuyerHeaders = await f.login(buyer);
  assert.deepEqual(
    (
      await f.http.inject({
        url: "/api/warranty/claims/page",
        headers: changedBuyerHeaders,
      })
    ).json().items,
    [],
  );
  assert.equal(
    (
      await f.http.inject({
        url: `/api/warranty/claims/${f.claim.id}/decisions`,
        headers: changedBuyerHeaders,
      })
    ).statusCode,
    403,
  );
});
