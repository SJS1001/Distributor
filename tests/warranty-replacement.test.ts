import { test } from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { fixture, accept, ship } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import { warrantyUser, warrantyGrants } from "./warranty-authority-fixtures.ts";
import type { Actor } from "../src/server/core.ts";
function inspected(f: ReturnType<typeof fixture>, key = "one") {
  const shipment = ship(f, accept(f, 1, key).id);
  const serial = f.app.fulfillment
    .shipments(f.actor)
    .find((s) => s.id === shipment.id)!.units[0].serial;
  const c = f.app.warranty.submit(f.actor, key + "claim", {
    accountId: f.buyer,
    unitId: f.app.inventory.trace(f.actor, serial).unit.id,
    type: "warranty",
    issue: "Synthetic failed serial",
    evidence: "fixture-issue",
  });
  f.app.warranty.review(f.actor, key + "review", {
    claimId: c.id,
    approved: true,
    reason: "Synthetic authorization",
  });
  f.app.warranty.receive(f.actor, key + "receive", {
    claimId: c.id,
    warehouseId: f.w1,
    bin: "Q",
    serial,
  });
  f.app.warranty.inspect(f.actor, key + "inspect", {
    claimId: c.id,
    findings: "Synthetic inspected failure",
  });
  return c;
}
function reservation(
  f: ReturnType<typeof fixture>,
  claimId: string,
  serial = "S2",
  oldDisposition: "scrap" | "restock" = "scrap",
) {
  return {
    claimId,
    newUnitId: f.app.inventory.trace(f.actor, serial).unit.id,
    oldDisposition,
    coveragePolicy: "inherit_original" as const,
    reason: "Synthetic replacement approval",
  };
}
function handover(replacementId: string) {
  return {
    replacementId,
    revision: 1,
    serial: "S2",
    recipient: "Synthetic recipient",
    evidence: "fixture signed collection",
  };
}
function money(f: ReturnType<typeof fixture>) {
  return {
    invoices: f.app.billing.invoices(f.actor),
    orders: f.app.orders.list(f.actor),
    shipments: f.app.fulfillment.shipments(f.actor),
    exposure: f.app.billing.exposure(f.actor, f.buyer),
  };
}
test("replacement reserves real stock, survives retries/restart, collects once and chains original invoice/coverage without a new sale", (t) => {
  const f = fixture(t),
    c = inspected(f),
    before = money(f),
    input = reservation(f, c.id);
  const r = f.app.warranty.reserveReplacement(f.actor, "reserve", input);
  assert.deepEqual(
    f.app.warranty.reserveReplacement(f.actor, "reserve", input),
    r,
  );
  assert.equal(f.app.inventory.availability(f.actor, f.product, f.w1), 1);
  assert.equal(
    f.app.inventory.stock(f.actor).find((u) => u.id === input.newUnitId)!
      .reserved,
    1,
  );
  assert.equal(
    f.app.inventory.trace(f.actor, "S1").unit.condition,
    "quarantine",
  );
  assert.throws(
    () =>
      f.app.warranty.dispose(f.actor, "dispose", {
        claimId: c.id,
        disposition: "restock",
        reason: "Synthetic",
      }),
    { code: "REMEDY" },
  );
  f.app.close();
  f.app = new Application(f.path);
  const collection = { ...handover(r.id), evidence: "E".repeat(2000) };
  const result = f.app.warranty.handoverReplacement(
    f.actor,
    "handover",
    collection,
  );
  assert.deepEqual(
    f.app.warranty.handoverReplacement(f.actor, "handover", collection),
    result,
  );
  assert.equal(
    f.app.warranty.replacements(f.actor, c.id)[0]!.evidence,
    collection.evidence,
  );
  assert.equal(f.app.inventory.trace(f.actor, "S1").unit.state, "scrapped");
  assert.equal(f.app.inventory.trace(f.actor, "S2").unit.state, "sold");
  assert.equal(f.app.inventory.trace(f.actor, "S2").unit.quantity, 0);
  assert.deepEqual(money(f), before);
  assert.throws(
    () =>
      f.app.warranty.credit(f.actor, "credit", {
        claimId: c.id,
        reason: "Synthetic",
      }),
    { code: "STATE" },
  );
  const successor = f.app.warranty.submit(f.actor, "successor", {
    accountId: f.buyer,
    unitId: input.newUnitId,
    type: "warranty",
    issue: "Synthetic later failure",
    evidence: "successor",
  });
  assert.equal(successor.coverageEnd, c.coverageEnd);
  const original = f.app.warranty.claim(f.actor, c.id),
    next = f.app.warranty.claim(f.actor, successor.id);
  assert.equal(next.invoice_id, original.invoice_id);
  assert.equal(next.shipment_id, original.shipment_id);
  f.app.warranty.review(f.actor, "next-review", {
    claimId: next.id,
    approved: true,
    reason: "Synthetic",
  });
  f.app.warranty.receive(f.actor, "next-receive", {
    claimId: next.id,
    warehouseId: f.w1,
    bin: "Q2",
    serial: "S2",
  });
  f.app.warranty.inspect(f.actor, "next-inspect", {
    claimId: next.id,
    findings: "Synthetic",
  });
  const second = f.app.warranty.reserveReplacement(
    f.actor,
    "second",
    reservation(f, next.id, "S3"),
  );
  f.app.warranty.handoverReplacement(f.actor, "second-handover", {
    ...handover(second.id),
    serial: "S3",
  });
  const third = f.app.warranty.submit(f.actor, "third", {
    accountId: f.buyer,
    unitId: f.app.inventory.trace(f.actor, "S3").unit.id,
    type: "return",
    issue: "Synthetic",
    evidence: "fixture",
  });
  assert.equal(third.coverageEnd, c.coverageEnd);
  assert.equal(
    f.app.warranty.claim(f.actor, third.id).invoice_id,
    original.invoice_id,
  );
  assert.deepEqual(
    f.app.warranty.soldUnits(f.actor).map((u) => u.serial),
    ["S3"],
  );
});
test("cancel releases reservation, retains evidence, allows a new serial or native credit; restock can be sold to a new owner", (t) => {
  const f = fixture(t),
    c = inspected(f),
    input = reservation(f, c.id, "S2", "restock");
  const r = f.app.warranty.reserveReplacement(f.actor, "reserve", input);
  const cancel = {
    replacementId: r.id,
    revision: 1,
    reason: "Synthetic customer cancelled",
  };
  f.app.warranty.cancelReplacement(f.actor, "cancel", cancel);
  assert.equal(f.app.inventory.availability(f.actor, f.product, f.w1), 2);
  assert.equal(f.app.warranty.claim(f.actor, c.id).state, "inspected");
  assert.throws(
    () => f.app.warranty.handoverReplacement(f.actor, "stale", handover(r.id)),
    { code: "STALE_REPLACEMENT" },
  );
  const r2 = f.app.warranty.reserveReplacement(f.actor, "reserve2", input);
  f.app.warranty.handoverReplacement(f.actor, "handover", handover(r2.id));
  assert.equal(f.app.inventory.trace(f.actor, "S1").unit.condition, "usable");
  assert.equal(f.app.inventory.availability(f.actor, f.product, f.w1), 2);
  assert.equal(f.app.warranty.replacements(f.actor, c.id).length, 2);
  assert.deepEqual(
    f.app.warranty.replacements(f.actor, c.id).map((r) => r.history!.length),
    [2, 2],
  );
  // Returned replacement can later re-enter normal sales: current custody wins over past replacement lineage.
  const next = f.app.warranty.submit(f.actor, "next", {
    accountId: f.buyer,
    unitId: input.newUnitId,
    type: "return",
    issue: "Synthetic",
    evidence: "fixture",
  });
  f.app.warranty.review(f.actor, "review2", {
    claimId: next.id,
    approved: true,
    reason: "Synthetic",
  });
  f.app.warranty.receive(f.actor, "receive2", {
    claimId: next.id,
    warehouseId: f.w1,
    bin: "Q",
    serial: "S2",
  });
  f.app.warranty.inspect(f.actor, "inspect2", {
    claimId: next.id,
    findings: "Synthetic",
  });
  f.app.warranty.dispose(f.actor, "restock2", {
    claimId: next.id,
    disposition: "restock",
    reason: "Synthetic repaired",
  });
  const other = f.app.identity.createCustomer(f.actor, "other", {
    name: "Other synthetic buyer",
    tier: "standard",
    creditLimit: 1000000,
  }).id;
  const foreign = { ...f, buyer: other };
  ship(f, accept(foreign, 2, "resale").id);
  const buyer = f.app.identity.createUser(f.actor, "original-buyer", {
    name: "Original buyer",
    email: "original-buyer@example.test",
    password: "long-buyer-test-password",
    role: "buyer",
    accountId: f.buyer,
    sites: [],
  });
  const a = f.app.identity.currentActor({ ...f.actor, id: buyer.id });
  assert.deepEqual(f.app.warranty.soldUnits(a), []);
  assert.deepEqual(
    f.app.warranty.soldUnits({ ...a, role: "admin", accountId: other }),
    [],
  );
  assert.throws(
    () =>
      f.app.warranty.submit(a, "wrong", {
        accountId: f.buyer,
        unitId: input.newUnitId,
        type: "return",
        issue: "Synthetic",
        evidence: "fixture",
      }),
    { code: "NOT_FOUND" },
  );
  const newClaim = f.app.warranty.submit(f.actor, "new-owner", {
    accountId: other,
    unitId: input.newUnitId,
    type: "return",
    issue: "Synthetic",
    evidence: "fixture",
  });
  assert.notEqual(
    f.app.warranty.claim(f.actor, newClaim.id).invoice_id,
    f.app.warranty.claim(f.actor, c.id).invoice_id,
  );
});
test("replacement authority, strict stock/inspection/remedy inputs and cached grants reject invalid attempts", (t) => {
  const f = fixture(t),
    c = inspected(f),
    input = reservation(f, c.id);
  const reviewer = warrantyUser(f, "warranty");
  for (const role of [
    "warehouse",
    "commercial",
    "buyer",
    "finance",
    "support",
  ] as const) {
    const otherRole = warrantyUser(f, role);
    assert.throws(
      () => f.app.warranty.reserveReplacement(otherRole, "reserve", input),
      { code: "FORBIDDEN" },
    );
  }
  for (const payload of [
    { ...input, coveragePolicy: "reset" },
    { ...input, oldDisposition: "repair" },
    { ...input, reason: "" },
  ])
    assert.throws(
      () =>
        f.app.warranty.reserveReplacement(f.actor, "invalid", payload as any),
      { code: "VALIDATION" },
    );
  assert.throws(
    () =>
      f.app.warranty.reserveReplacement(f.actor, "same", {
        ...input,
        newUnitId: f.app.warranty.claim(f.actor, c.id).unit_id,
      }),
    { code: "REPLACEMENT_STOCK" },
  );
  const r = f.app.warranty.reserveReplacement(reviewer, "reserve", input);
  warrantyGrants(f, reviewer, { sites: [f.w2] });
  assert.throws(
    () => f.app.warranty.reserveReplacement(reviewer, "reserve", input),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () =>
      f.app.warranty.reserveReplacement(
        { ...reviewer, orgId: "foreign" },
        "reserve",
        input,
      ),
    { code: "FORBIDDEN" },
  );
  warrantyGrants(f, reviewer, { sites: [f.w1] });
  assert.throws(
    () =>
      f.app.warranty.handoverReplacement(reviewer, "handover", handover(r.id)),
    { code: "FORBIDDEN" },
  );
  const warehouse = warrantyUser(f, "warehouse");
  warrantyGrants(f, warehouse, { sites: [f.w2] });
  assert.throws(
    () =>
      f.app.warranty.handoverReplacement(warehouse, "handover", handover(r.id)),
    { code: "FORBIDDEN" },
  );
  warrantyGrants(f, warehouse, { sites: [f.w1] });
  for (const payload of [
    { ...handover(r.id), serial: "wrong" },
    { ...handover(r.id), revision: 1.5 },
    { ...handover(r.id), recipient: "" },
    { ...handover(r.id), evidence: "" },
  ])
    assert.throws(
      () => f.app.warranty.handoverReplacement(warehouse, "invalid", payload),
      { code: payload.serial === "wrong" ? "SERIAL" : "VALIDATION" },
    );
  f.app.warranty.handoverReplacement(warehouse, "handover", handover(r.id));
  warrantyGrants(f, warehouse, { sites: [] });
  assert.throws(
    () =>
      f.app.warranty.handoverReplacement(warehouse, "handover", handover(r.id)),
    { code: "FORBIDDEN" },
  );
  const buyer = warrantyUser(f, "buyer");
  const own = f.app.warranty.replacements(buyer, c.id)[0]!;
  assert.equal(own.newSerial, "S2");
  assert.equal(own.evidence, undefined);
  assert.equal(own.history, undefined);
  assert.equal(own.recipient, undefined);
  const other = f.app.identity.createCustomer(f.actor, "other", {
    name: "Other buyer",
    tier: "standard",
    creditLimit: 10000,
  }).id;
  warrantyGrants(f, buyer, { accountId: other });
  assert.throws(() => f.app.warranty.replacements(buyer, c.id), {
    code: "FORBIDDEN",
  });
});
test("late replacement failures roll back inventory holds/custody, claim history, receipts and audit together", (t) => {
  const f = fixture(t),
    c = inspected(f),
    input = reservation(f, c.id);
  const snapshot = () => ({
    money: money(f),
    stock: f.app.inventory.stock(f.actor),
    inventory: f.app.database
      .owned("inventory")
      .all("SELECT * FROM inventory_replacements"),
    movements: f.app.database
      .owned("inventory")
      .all("SELECT * FROM inventory_movements"),
    claims: f.app.warranty.list(f.actor),
    decisions: f.app.database
      .owned("warranty")
      .all("SELECT * FROM warranty_decisions"),
    commands: f.app.database
      .owned("platform")
      .all("SELECT * FROM platform_commands"),
    audit: f.app.database.owned("platform").all("SELECT * FROM platform_audit"),
  });
  const audit = f.app.platform.audit.bind(f.app.platform);
  const fail = (name: string, fn: () => unknown) => {
    const before = snapshot();
    f.app.platform.audit = (a, n, r, d) => {
      if (n === name) throw Error("Injected late replacement audit failure");
      audit(a, n, r, d);
    };
    try {
      assert.throws(fn, /Injected late replacement/);
    } finally {
      f.app.platform.audit = audit;
    }
    assert.deepEqual(snapshot(), before);
  };
  fail("warranty.replacement.reserve", () =>
    f.app.warranty.reserveReplacement(f.actor, "reserve", input),
  );
  const r = f.app.warranty.reserveReplacement(f.actor, "reserve", input);
  fail("warranty.replacement.cancel", () =>
    f.app.warranty.cancelReplacement(f.actor, "cancel", {
      replacementId: r.id,
      revision: 1,
      reason: "Synthetic",
    }),
  );
  fail("warranty.replacement.handover", () =>
    f.app.warranty.handoverReplacement(f.actor, "handover", handover(r.id)),
  );
  f.app.warranty.handoverReplacement(f.actor, "handover", handover(r.id));
});
type RaceInput = {
  key: string;
  operation: "reserveReplacement" | "cancelReplacement" | "handoverReplacement";
  payload: unknown;
};
async function race(
  t: { after: (fn: () => void) => void },
  f: ReturnType<typeof fixture>,
  inputs: RaceInput[],
) {
  const children: ChildProcess[] = [],
    ready: Promise<void>[] = [],
    results: Promise<any>[] = [];
  for (const input of inputs) {
    const child = fork(
      new URL("./warranty-replacement-child.ts", import.meta.url),
      [],
      {
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      },
    );
    children.push(child);
    let rr: () => void,
      rj: (e: Error) => void,
      resolve: (v: any) => void,
      reject: (e: Error) => void,
      complete = false,
      stderr = "";
    ready.push(
      new Promise<void>((a, b) => {
        rr = a;
        rj = b;
      }),
    );
    results.push(
      new Promise((a, b) => {
        resolve = a;
        reject = b;
      }),
    );
    child.stderr?.on("data", (c) => (stderr += String(c)));
    child.on("message", (m: any) => {
      if (m.ready) rr();
      else {
        complete = true;
        resolve(m);
      }
    });
    child.on("error", (e) => {
      rj(e);
      reject(e);
    });
    child.on("exit", (code) => {
      if (!complete || code !== 0) {
        const e = Error(`Replacement child exited ${code}: ${stderr}`);
        rj(e);
        reject(e);
      }
    });
    child.send({ action: "init", path: f.path, actor: f.actor, ...input });
  }
  t.after(() => children.forEach((c) => c.kill()));
  await Promise.all(ready);
  children.forEach((c) => c.send({ action: "go" }));
  return Promise.all(results);
}
test(
  "separate processes cannot assign one serial twice or both cancel and collect the same revision",
  { timeout: 20000 },
  async (t) => {
    const f = fixture(t),
      one = inspected(f),
      two = inspected(f, "two");
    // S2 was sold on the second order; S3 is the only eligible replacement.
    const results = await race(
      t,
      f,
      [one, two].map((c, i) => ({
        key: `reserve-${i}`,
        operation: "reserveReplacement",
        payload: reservation(f, c.id, "S3"),
      })),
    );
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(results.find((r) => !r.ok).code, "REPLACEMENT_STOCK");
    const r = results.find((r) => r.ok).result;
    const terminal = await race(t, f, [
      {
        key: "cancel",
        operation: "cancelReplacement",
        payload: { replacementId: r.id, revision: 1, reason: "Synthetic" },
      },
      {
        key: "collect",
        operation: "handoverReplacement",
        payload: { ...handover(r.id), serial: "S3" },
      },
    ]);
    assert.equal(terminal.filter((r) => r.ok).length, 1);
    assert.equal(terminal.find((r) => !r.ok).code, "STALE_REPLACEMENT");
    const replacement = f.app.warranty.replacements(f.actor, r.claimId)[0]!;
    assert.equal(replacement.history!.length, 2);
    assert.equal(
      f.app.inventory.trace(f.actor, "S3").unit.quantity,
      replacement.state === "cancelled" ? 1 : 0,
    );
  },
);
test("HTTP replacement commands enforce session, CSRF, exact shapes, selected policy and revision", async (t) => {
  const f = fixture(t),
    c = inspected(f),
    origin = "http://127.0.0.1:3000",
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
    }),
    cookie = login.cookies[0]!,
    headers = {
      origin,
      cookie: `${cookie.name}=${cookie.value}`,
      "x-csrf-token": login.json().csrf,
      "idempotency-key": "reserve",
    },
    url = "/api/commands/warranty.replacement.reserve",
    payload = reservation(f, c.id);
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
  for (const p of [
    { ...payload, extra: true },
    { ...payload, coveragePolicy: "reset" },
    { ...payload, oldDisposition: "repair" },
  ])
    assert.equal(
      (await http.inject({ method: "POST", url, headers, payload: p }))
        .statusCode,
      400,
    );
  const response = await http.inject({ method: "POST", url, headers, payload });
  assert.equal(response.statusCode, 200);
  const r = response.json();
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: "/api/commands/warranty.replacement.handover",
        headers,
        payload: { ...handover(r.id), revision: 2 },
      })
    ).json().code,
    "STALE_REPLACEMENT",
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: "/api/commands/warranty.replacement.handover",
        headers,
        payload: handover(r.id),
      })
    ).statusCode,
    200,
  );
});
test("holds exclude order allocation and transfers; invalid scans and fields preserve stock, and cancelled remedies allow a native credit", (t) => {
  const f = fixture(t),
    c = inspected(f),
    input = reservation(f, c.id),
    r = f.app.warranty.reserveReplacement(f.actor, "reserve", input);
  assert.throws(
    () =>
      f.app.inventory.dispatchTransfer(f.actor, "transfer", {
        destinationId: f.w2,
        unitId: input.newUnitId,
        quantity: 1,
        revision: f.app.inventory.unit(f.actor, input.newUnitId).revision,
        reason: "Synthetic",
      }),
    { code: "STOCK" },
  );
  const order = accept(f, 1, "other-order"),
    picks = f.app.fulfillment.picks(f.actor, order.id);
  assert.equal(picks[0]!.serial, "S3");
  const before = money(f);
  for (const p of [
    { ...handover(r.id), serial: "S3" },
    { ...handover(r.id), recipient: "" },
    { ...handover(r.id), evidence: "" },
    { ...handover(r.id), revision: 1.1 },
  ])
    assert.throws(() =>
      f.app.warranty.handoverReplacement(f.actor, "invalid", p),
    );
  assert.equal(f.app.inventory.trace(f.actor, "S2").unit.quantity, 1);
  assert.deepEqual(money(f), before);
  // Existing order's allocated S3 cannot be used by a second claim or replacement.
  assert.throws(
    () =>
      f.app.warranty.reserveReplacement(f.actor, "overlap", {
        ...input,
        newUnitId: picks[0]!.unit_id,
      }),
    { code: "REMEDY" },
  );
  f.app.warranty.cancelReplacement(f.actor, "cancel", {
    replacementId: r.id,
    revision: 1,
    reason: "Synthetic choose credit",
  });
  assert.throws(
    () =>
      f.app.warranty.reserveReplacement(f.actor, "allocated", {
        ...input,
        newUnitId: picks[0]!.unit_id,
      }),
    { code: "REPLACEMENT_STOCK" },
  );
  f.app.warranty.dispose(f.actor, "scrap", {
    claimId: c.id,
    disposition: "scrap",
    reason: "Synthetic",
  });
  const credit = f.app.warranty.credit(f.actor, "credit", {
    claimId: c.id,
    reason: "Synthetic refund remedy",
  });
  assert.deepEqual(
    f.app.warranty.credit(f.actor, "credit", {
      claimId: c.id,
      reason: "Synthetic refund remedy",
    }),
    credit,
  );
  assert.equal(f.app.billing.invoices(f.actor)[0]!.balance, 0);
  assert.throws(
    () => f.app.warranty.reserveReplacement(f.actor, "credited", input),
    { code: "STATE" },
  );
});
