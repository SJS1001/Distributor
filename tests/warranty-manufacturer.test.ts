import { test } from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { fixture, accept, ship } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { warrantyUser, warrantyGrants } from "./warranty-authority-fixtures.ts";
import type { Actor } from "../src/server/core.ts";
import { createHttp } from "../src/server/http.ts";

function approved(
  f: ReturnType<typeof fixture>,
  serial = "S1",
  type: "warranty" | "return" = "warranty",
  key = "order",
) {
  ship(f, accept(f, 1, key).id);
  const claim = f.app.warranty.submit(f.actor, key + "claim", {
    accountId: f.buyer,
    unitId: f.app.inventory.trace(f.actor, serial).unit.id,
    type,
    issue: "Synthetic failed equipment",
    evidence: "fixture-issue",
  });
  f.app.warranty.review(f.actor, key + "approve", {
    claimId: claim.id,
    approved: true,
    reason: "Synthetic authorization",
  });
  return claim;
}
function referral(claimId: string, reference = "M-001") {
  return {
    claimId,
    manufacturer: "Synthetic Maker",
    reference,
    evidence: "fixture-referral",
    reason: "Manufacturer review requested externally",
  };
}
function decision(
  caseId: string,
  outcome: "accepted" | "denied" | "cancelled" = "accepted",
) {
  return {
    caseId,
    revision: 1,
    outcome,
    evidence: "fixture-response",
    reason: "Actual synthetic manufacturer response",
  };
}
const finance = (f: ReturnType<typeof fixture>) => ({
  stock: f.app.inventory.stock(f.actor),
  orders: f.app.orders.list(f.actor),
  shipments: f.app.fulfillment.shipments(f.actor),
  invoices: f.app.billing.invoices(f.actor),
  exposure: f.app.billing.exposure(f.actor, f.buyer),
});
test("manufacturer referrals and responses retain immutable history across restart without moving stock or money", (t) => {
  const f = fixture(t),
    claim = approved(f),
    input = referral(claim.id);
  const before = finance(f),
    originalClaim = f.app.warranty.claim(f.actor, claim.id);
  const c = f.app.warranty.referManufacturer(f.actor, "refer", input);
  assert.deepEqual(
    f.app.warranty.referManufacturer(f.actor, "refer", input),
    c,
  );
  assert.deepEqual(finance(f), before);
  assert.deepEqual(f.app.warranty.claim(f.actor, claim.id), originalClaim);
  f.app.warranty.receive(f.actor, "return", {
    claimId: claim.id,
    warehouseId: f.w1,
    bin: "Q-1",
    serial: "S1",
  });
  const received = finance(f);
  const result = f.app.warranty.decideManufacturer(
    f.actor,
    "decide",
    decision(c.id),
  );
  assert.deepEqual(finance(f), received);
  assert.equal(f.app.warranty.claim(f.actor, claim.id).state, "received");
  assert.equal(
    f.app.inventory.trace(f.actor, "S1").unit.condition,
    "quarantine",
  );
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(
    f.app.warranty.decideManufacturer(f.actor, "decide", decision(c.id)),
    result,
  );
  const history = f.app.warranty.manufacturerCases(f.actor, claim.id);
  assert.equal(history.length, 1);
  assert.equal(history[0]!.state, "accepted");
  assert.equal(history[0]!.revision, 2);
  assert.deepEqual(
    history[0]!.history.map((h) => [h.revision, h.state, h.evidence]),
    [
      [1, "pending", "fixture-referral"],
      [2, "accepted", "fixture-response"],
    ],
  );
  assert.deepEqual(finance(f), received);
});
test("manufacturer mutations and cached retries require current role and warehouse grants; buyer history excludes internal cases", (t) => {
  const f = fixture(t),
    claim = approved(f),
    input = referral(claim.id);
  const warranty = warrantyUser(f, "warranty");
  const c = f.app.warranty.referManufacturer(warranty, "refer", input);
  for (const role of [
    "buyer",
    "warehouse",
    "commercial",
    "finance",
    "support",
  ] as const) {
    const a = warrantyUser(f, role);
    assert.throws(() => f.app.warranty.referManufacturer(a, "refer", input), {
      code: "FORBIDDEN",
    });
    assert.throws(
      () => f.app.warranty.decideManufacturer(a, "decide", decision(c.id)),
      { code: "FORBIDDEN" },
    );
  }
  warrantyGrants(f, warranty, { sites: [f.w2] });
  const movedGrant = warranty;
  assert.throws(
    () => f.app.warranty.referManufacturer(movedGrant, "refer", input),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () =>
      f.app.warranty.decideManufacturer(movedGrant, "decide", decision(c.id)),
    { code: "FORBIDDEN" },
  );
  const buyer = warrantyUser(f, "buyer");
  assert.deepEqual(f.app.warranty.list(buyer)[0]!.manufacturerCases, []);
  assert.throws(() => f.app.warranty.manufacturerCases(buyer, claim.id), {
    code: "FORBIDDEN",
  });
  const other = f.app.identity.createCustomer(f.actor, "other", {
    name: "Other buyer",
    tier: "standard",
    creditLimit: 10000,
  }).id;
  const foreign = warrantyUser(f, "buyer", other);
  assert.equal(f.app.warranty.list(foreign).length, 0);
  assert.throws(
    () =>
      f.app.warranty.manufacturerCases(
        { ...f.actor, orgId: "foreign" },
        claim.id,
      ),
    { code: "FORBIDDEN" },
  );
  assert.equal(
    f.app.warranty.list(warrantyUser(f, "warehouse", f.buyer, [f.w2])).length,
    0,
  );
  warrantyGrants(f, warranty, { sites: [f.w1] });
  const response = decision(c.id);
  f.app.warranty.decideManufacturer(warranty, "decide", response);
  warrantyGrants(f, warranty, { sites: [f.w2] });
  assert.throws(
    () => f.app.warranty.decideManufacturer(movedGrant, "decide", response),
    { code: "FORBIDDEN" },
  );
});
test("manual manufacturer identity, claim state, revisions and outcomes reject ambiguous or stale decisions and preserve prior attempts", (t) => {
  const f = fixture(t),
    claim = approved(f),
    input = referral(claim.id);
  assert.throws(
    () =>
      f.app.warranty.referManufacturer(f.actor, "empty", {
        ...input,
        evidence: " ",
      }),
    { code: "VALIDATION" },
  );
  assert.equal(f.app.warranty.manufacturerCases(f.actor, claim.id).length, 0);
  const c = f.app.warranty.referManufacturer(f.actor, "refer", input);
  assert.throws(
    () =>
      f.app.warranty.referManufacturer(
        f.actor,
        "overlap",
        referral(claim.id, "M-002"),
      ),
    { code: "PENDING_MANUFACTURER_CASE" },
  );
  assert.throws(
    () =>
      f.app.warranty.decideManufacturer(f.actor, "stale", {
        ...decision(c.id),
        revision: 2,
      }),
    { code: "STALE_MANUFACTURER_CASE" },
  );
  assert.throws(
    () =>
      f.app.warranty.decideManufacturer(f.actor, "fraction", {
        ...decision(c.id),
        revision: 1.5,
      }),
    { code: "VALIDATION" },
  );
  assert.throws(
    () =>
      f.app.warranty.decideManufacturer(f.actor, "invalid", {
        ...decision(c.id),
        outcome: "replace" as any,
      }),
    { code: "VALIDATION" },
  );
  f.app.warranty.decideManufacturer(
    f.actor,
    "denied",
    decision(c.id, "denied"),
  );
  assert.throws(
    () =>
      f.app.warranty.decideManufacturer(f.actor, "late", {
        ...decision(c.id),
        revision: 2,
      }),
    { code: "STATE" },
  );
  assert.throws(
    () =>
      f.app.warranty.referManufacturer(f.actor, "duplicate", {
        ...input,
        manufacturer: "Ｓynthetic Maker",
        reference: " m-001 ",
      }),
    { code: "MANUFACTURER_REFERENCE" },
  );
  const second = f.app.warranty.referManufacturer(
    f.actor,
    "followup",
    referral(claim.id, "M-002"),
  );
  f.app.warranty.decideManufacturer(
    f.actor,
    "cancelled",
    decision(second.id, "cancelled"),
  );
  assert.deepEqual(
    f.app.warranty
      .manufacturerCases(f.actor, claim.id)
      .map((c) => c.state)
      .sort(),
    ["cancelled", "denied"],
  );
  const returnClaim = approved(f, "S2", "return", "return-order");
  assert.throws(
    () =>
      f.app.warranty.referManufacturer(
        f.actor,
        "return-ref",
        referral(returnClaim.id, "M-003"),
      ),
    { code: "STATE" },
  );
});
test("late manufacturer command audit failures roll back referral or response, evidence and receipt atomically", (t) => {
  const f = fixture(t),
    claim = approved(f),
    input = referral(claim.id),
    before = finance(f);
  const audit = f.app.platform.audit.bind(f.app.platform);
  const fail = (name: string, fn: () => unknown) => {
    const records = f.app.database
      .owned("warranty")
      .all("SELECT * FROM warranty_manufacturer_history");
    const receipts = f.app.database
      .owned("platform")
      .all("SELECT * FROM platform_commands");
    const audits = f.app.database
      .owned("platform")
      .all("SELECT * FROM platform_audit");
    const decisions = f.app.database
      .owned("warranty")
      .all("SELECT * FROM warranty_decisions");
    f.app.platform.audit = (actor, action, ref, detail) => {
      if (action === name) throw new Error("Injected late audit failure");
      audit(actor, action, ref, detail);
    };
    try {
      assert.throws(fn, /Injected late audit failure/);
    } finally {
      f.app.platform.audit = audit;
    }
    assert.deepEqual(
      f.app.database
        .owned("warranty")
        .all("SELECT * FROM warranty_manufacturer_history"),
      records,
    );
    assert.deepEqual(
      f.app.database.owned("warranty").all("SELECT * FROM warranty_decisions"),
      decisions,
    );
    assert.deepEqual(
      f.app.database.owned("platform").all("SELECT * FROM platform_commands"),
      receipts,
    );
    assert.deepEqual(
      f.app.database.owned("platform").all("SELECT * FROM platform_audit"),
      audits,
    );
    assert.deepEqual(finance(f), before);
  };
  fail("warranty.manufacturer.refer", () =>
    f.app.warranty.referManufacturer(f.actor, "refer", input),
  );
  assert.equal(f.app.warranty.manufacturerCases(f.actor, claim.id).length, 0);
  const c = f.app.warranty.referManufacturer(f.actor, "refer", input);
  fail("warranty.manufacturer.decide", () =>
    f.app.warranty.decideManufacturer(f.actor, "decide", decision(c.id)),
  );
  assert.equal(
    f.app.warranty.manufacturerCases(f.actor, claim.id)[0]!.state,
    "pending",
  );
  f.app.warranty.decideManufacturer(f.actor, "decide", decision(c.id));
});
type RaceInput = {
  actor: Actor;
  key: string;
  operation: "referManufacturer" | "decideManufacturer";
  payload: unknown;
};
async function race(
  t: { after: (fn: () => void) => void },
  f: ReturnType<typeof fixture>,
  inputs: RaceInput[],
) {
  const children: ChildProcess[] = [];
  const ready: Promise<void>[] = [],
    outcomes: Promise<{ ok: boolean; result?: any; code?: string }>[] = [];
  for (const input of inputs) {
    const child = fork(
      new URL("./warranty-manufacturer-child.ts", import.meta.url),
      [],
      {
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      },
    );
    children.push(child);
    let readyResolve: () => void,
      resultResolve: (v: any) => void,
      readyReject: (e: Error) => void,
      resultReject: (e: Error) => void;
    ready.push(
      new Promise<void>((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
      }),
    );
    outcomes.push(
      new Promise((resolve, reject) => {
        resultResolve = resolve;
        resultReject = reject;
      }),
    );
    let stderr = "",
      complete = false;
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("message", (message: any) => {
      if (message.ready) readyResolve();
      else {
        complete = true;
        resultResolve(message);
      }
    });
    child.on("error", (e) => {
      readyReject(e);
      resultReject(e);
    });
    child.on("exit", (code) => {
      if (!complete || code !== 0) {
        const e = new Error(`Manufacturer process exited ${code}: ${stderr}`);
        readyReject(e);
        resultReject(e);
      }
    });
    child.send({ action: "init", path: f.path, ...input });
  }
  t.after(() => children.forEach((child) => child.kill()));
  await Promise.all(ready);
  children.forEach((child) => child.send({ action: "go" }));
  return Promise.all(outcomes);
}

test(
  "independent manufacturer processes serialize overlapping referrals and final decisions",
  { timeout: 20000 },
  async (t) => {
    const f = fixture(t),
      claim = approved(f);
    const opened = await race(
      t,
      f,
      [0, 1].map((i) => ({
        actor: f.actor,
        key: `refer-${i}`,
        operation: "referManufacturer",
        payload: referral(claim.id, `M-${i}`),
      })),
    );
    assert.equal(opened.filter((x) => x.ok).length, 1);
    assert.equal(opened.find((x) => !x.ok)!.code, "PENDING_MANUFACTURER_CASE");
    const c = f.app.warranty.manufacturerCases(f.actor, claim.id)[0]!;
    const closed = await race(
      t,
      f,
      ["accepted", "denied"].map((outcome, i) => ({
        actor: f.actor,
        key: `decide-${i}`,
        operation: "decideManufacturer",
        payload: decision(c.id, outcome as "accepted" | "denied"),
      })),
    );
    assert.equal(closed.filter((x) => x.ok).length, 1);
    assert.equal(closed.find((x) => !x.ok)!.code, "STALE_MANUFACTURER_CASE");
    assert.equal(
      f.app.warranty.manufacturerCases(f.actor, claim.id)[0]!.history.length,
      2,
    );
    assert.equal(f.app.billing.invoices(f.actor)[0]!.balance, 11300);
  },
);
test("HTTP manufacturer commands require current session, CSRF, exact fields and allowed outcomes", async (t) => {
  const f = fixture(t),
    claim = approved(f),
    origin = "http://127.0.0.1:3000";
  const http = await createHttp(f.app, {
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
  const cookie = login.cookies[0]!,
    headers = {
      origin,
      cookie: `${cookie.name}=${cookie.value}`,
      "x-csrf-token": login.json().csrf,
      "idempotency-key": "http-referral",
    };
  const url = "/api/commands/warranty.manufacturer.refer",
    payload = referral(claim.id);
  assert.equal(
    (await http.inject({ method: "POST", url, headers: { origin }, payload }))
      .statusCode,
    401,
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url,
        headers: { ...headers, "x-csrf-token": "wrong" },
        payload,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url,
        headers,
        payload: { ...payload, stockQuantity: 1 },
      })
    ).statusCode,
    400,
  );
  const response = await http.inject({ method: "POST", url, headers, payload });
  assert.equal(response.statusCode, 200);
  const c = response.json();
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: "/api/commands/warranty.manufacturer.decide",
        headers,
        payload: { ...decision(c.id), outcome: "replace" },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    f.app.warranty.manufacturerCases(f.actor, claim.id)[0]!.state,
    "pending",
  );
});
