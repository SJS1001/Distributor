import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fixture, accept, ship } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import { createBackup, restoreBackup } from "../src/server/recovery.ts";
import type { Actor, Role } from "../src/server/core.ts";
type Fixture = ReturnType<typeof fixture>;
function reserved(f: Fixture, serial = "S1", next = "S2") {
  ship(f, accept(f, 1, serial).id);
  const c = f.app.warranty.submit(f.actor, `${serial}-claim`, {
    accountId: f.buyer,
    unitId: f.app.inventory.trace(f.actor, serial).unit.id,
    type: "warranty",
    issue: "Synthetic shipping failure",
    evidence: "issue",
  });
  f.app.warranty.review(f.actor, `${serial}-review`, {
    claimId: c.id,
    approved: true,
    reason: "Synthetic approval",
  });
  f.app.warranty.receive(f.actor, `${serial}-receive`, {
    claimId: c.id,
    warehouseId: f.w1,
    bin: "Q",
    serial,
  });
  f.app.warranty.inspect(f.actor, `${serial}-inspect`, {
    claimId: c.id,
    findings: "Synthetic inspected failure",
  });
  return f.app.warranty.reserveReplacement(f.actor, `${serial}-reserve`, {
    claimId: c.id,
    newUnitId: f.app.inventory.trace(f.actor, next).unit.id,
    oldDisposition: "scrap",
    coveragePolicy: "inherit_original",
    reason: "Synthetic authorization",
  });
}
function dispatch(replacementId: string, serial = "S2") {
  return {
    replacementId,
    revision: 1,
    serial,
    recipient: "Synthetic recipient",
    address: "Synthetic Canadian address",
    carrier: "Synthetic carrier",
    tracking: "SYN-TRACK-1",
    evidence: "Private carrier receipt",
  };
}
function outcome(f: Fixture, replacementId: string, reference = "observation") {
  const r = f.app.warranty
    .list(f.actor)
    .flatMap((c) => c.replacements)
    .find((r) => r.id === replacementId)!;
  return {
    replacementId,
    revision: r.shipping!.revision,
    state: "delayed" as const,
    reference,
    evidence: "Private external observation",
    observedAt: new Date().toISOString(),
  };
}
function money(f: Fixture) {
  return {
    orders: f.app.orders.list(f.actor),
    invoices: f.app.billing.invoices(f.actor),
    shipments: f.app.fulfillment.shipments(f.actor),
    exposure: f.app.billing.exposure(f.actor, f.buyer),
  };
}
function user(f: Fixture, role: Role, accountId = f.buyer) {
  const r = f.app.identity.createUser(f.actor, `user-${role}`, {
    name: role,
    email: `shipping-${role}@example.test`,
    password: "long-user-test-password",
    role,
    accountId,
    sites: role === "buyer" ? [] : [f.w1],
  });
  return f.app.identity.currentActor({ ...f.actor, id: r.id });
}
function grants(f: Fixture, a: Actor, changes: Record<string, unknown>) {
  const r = f.app.identity.users(f.actor).find((u) => u.id === a.id)!;
  f.app.identity.updateUser(f.actor, `grants-${a.id}-${r.revision}`, {
    userId: a.id,
    revision: Number(r.revision),
    email: String(r.email),
    name: a.name,
    role: a.role,
    accountId: a.accountId ?? undefined,
    sites: a.sites,
    active: true,
    currentPassword: "long-test-only-password",
    reason: "Synthetic change",
    ...changes,
  });
}
test("replacement carrier handover consumes reserved stock once, retains original entitlement and money across restart", (t) => {
  const f = fixture(t),
    r = reserved(f),
    before = money(f),
    p = dispatch(r.id);
  const result = f.app.warranty.dispatchReplacement(f.actor, "dispatch", p);
  assert.equal(result.shippingRevision, 1);
  assert.equal(f.app.inventory.trace(f.actor, "S2").unit.state, "sold");
  assert.equal(f.app.inventory.trace(f.actor, "S1").unit.state, "scrapped");
  assert.equal(
    f.app.inventory.stock(f.actor).find((u) => u.serial === "S2")!.reserved,
    0,
  );
  assert.deepEqual(money(f), before);
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(
    f.app.warranty.dispatchReplacement(f.actor, "dispatch", p),
    result,
  );
  assert.throws(
    () =>
      f.app.warranty.dispatchReplacement(f.actor, "dispatch", {
        ...p,
        tracking: "changed",
      }),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  assert.throws(
    () =>
      f.app.warranty.handoverReplacement(f.actor, "collection", {
        replacementId: r.id,
        revision: 1,
        serial: "S2",
        recipient: "counter",
        evidence: "counter",
      }),
    { code: "STALE_REPLACEMENT" },
  );
  const c = f.app.warranty.claim(f.actor, r.claimId);
  const successor = f.app.warranty.submit(f.actor, "next", {
    accountId: f.buyer,
    unitId: f.app.inventory.trace(f.actor, "S2").unit.id,
    type: "warranty",
    issue: "Synthetic successor",
    evidence: "issue",
  });
  const next = f.app.warranty.claim(f.actor, successor.id);
  assert.equal(next.invoice_id, c.invoice_id);
  assert.equal(next.shipment_id, c.shipment_id);
  assert.equal(next.coverage_end, c.coverage_end);
  assert.equal(
    f.app.warranty.replacements(f.actor, c.id)[0]!.shipping!.tracking,
    p.tracking,
  );
  assert.deepEqual(money(f), before);
});
test("delivery exceptions retain sold custody, page immutable observations and refuse stale, reused, nonchronological or terminal changes", (t) => {
  const f = fixture(t),
    r = reserved(f);
  f.app.warranty.dispatchReplacement(f.actor, "dispatch", dispatch(r.id));
  const before = {
    stock: f.app.inventory.stock(f.actor),
    money: money(f),
    claim: f.app.warranty.claim(f.actor, r.claimId),
  };
  const p = outcome(f, r.id);
  const result = f.app.warranty.updateReplacementShipping(f.actor, "update", p);
  assert.deepEqual(
    f.app.warranty.updateReplacementShipping(f.actor, "update", p),
    result,
  );
  assert.throws(
    () => f.app.warranty.updateReplacementShipping(f.actor, "stale", p),
    { code: "STALE_SHIPPING" },
  );
  for (const change of [
    { observedAt: "2020-01-01T00:00:00.000Z" },
    { observedAt: "2099-01-01T00:00:00.000Z" },
    { observedAt: "2026-02-30T00:00:00.000Z" },
    { observedAt: "bad" },
    { state: "unknown" },
    { reference: "" },
    { evidence: "" },
    { revision: 1.5 },
  ])
    assert.throws(
      () =>
        f.app.warranty.updateReplacementShipping(f.actor, "invalid", {
          ...outcome(f, r.id),
          ...change,
        } as any),
      { code: "VALIDATION" },
    );
  assert.throws(
    () =>
      f.app.warranty.updateReplacementShipping(f.actor, "reference", {
        ...outcome(f, r.id),
        reference: " OBSERVATION ",
      }),
    { code: "SHIPPING_REFERENCE" },
  );
  const lost = { ...outcome(f, r.id, "lost"), state: "lost" as const };
  f.app.warranty.updateReplacementShipping(f.actor, "lost", lost);
  for (let i = 0; i < 20; i++)
    f.app.warranty.updateReplacementShipping(f.actor, `more-${i}`, {
      ...outcome(f, r.id, `more-${i}`),
      state: "in_transit",
    });
  const first = f.app.warranty.replacementShippingHistory(f.actor, r.id),
    second = f.app.warranty.replacementShippingHistory(
      f.actor,
      r.id,
      first.next!,
    );
  assert.equal(first.items.length, 20);
  assert.equal(second.items.length, 3);
  assert.equal(second.next, null);
  assert.deepEqual(
    [...first.items, ...second.items].map((h) => h.revision),
    Array.from({ length: 23 }, (_, i) => i + 1),
  );
  const delivered = {
    ...outcome(f, r.id, "delivered"),
    state: "delivered" as const,
  };
  f.app.warranty.updateReplacementShipping(f.actor, "delivered", delivered);
  assert.throws(
    () =>
      f.app.warranty.updateReplacementShipping(
        f.actor,
        "after",
        outcome(f, r.id, "after"),
      ),
    { code: "STATE" },
  );
  assert.throws(
    () => f.app.warranty.replacementShippingHistory(f.actor, r.id, 99),
    { code: "VALIDATION" },
  );
  assert.deepEqual(
    {
      stock: f.app.inventory.stock(f.actor),
      money: money(f),
      claim: f.app.warranty.claim(f.actor, r.claimId),
    },
    before,
  );
  f.app.close();
  f.app = new Application(f.path);
  assert.equal(
    f.app.warranty.replacementShippingHistory(f.actor, r.id).items.length,
    20,
  );
  assert.deepEqual(
    f.app.warranty.updateReplacementShipping(f.actor, "delivered", delivered),
    { id: r.id, state: "delivered", revision: 24 },
  );
});
test("shipping validates exact scan and required fields and permanently prevents duplicate carrier tracking assignment", (t) => {
  const f = fixture(t),
    r = reserved(f),
    before = f.app.inventory.stock(f.actor);
  for (const change of [
    { serial: "S3" },
    { recipient: "" },
    { address: "" },
    { carrier: "" },
    { tracking: "" },
    { evidence: "" },
    { revision: 1.5 },
    { address: "a".repeat(2001) },
  ]) {
    assert.throws(
      () =>
        f.app.warranty.dispatchReplacement(f.actor, "bad", {
          ...dispatch(r.id),
          ...change,
        }),
      { code: change.serial ? "SERIAL" : "VALIDATION" },
    );
    assert.deepEqual(f.app.inventory.stock(f.actor), before);
  }
  f.app.warranty.dispatchReplacement(f.actor, "dispatch", dispatch(r.id));
  // A successor return creates another valid replacement; tracking history remains permanent.
  const next = f.app.warranty.submit(f.actor, "next", {
    accountId: f.buyer,
    unitId: f.app.inventory.trace(f.actor, "S2").unit.id,
    type: "warranty",
    issue: "Synthetic",
    evidence: "Synthetic",
  });
  f.app.warranty.review(f.actor, "review2", {
    claimId: next.id,
    approved: true,
    reason: "Synthetic",
  });
  f.app.warranty.receive(f.actor, "receive2", {
    claimId: next.id,
    warehouseId: f.w1,
    bin: "Q2",
    serial: "S2",
  });
  f.app.warranty.inspect(f.actor, "inspect2", {
    claimId: next.id,
    findings: "Synthetic",
  });
  const r2 = f.app.warranty.reserveReplacement(f.actor, "reserve2", {
    claimId: next.id,
    newUnitId: f.app.inventory.trace(f.actor, "S3").unit.id,
    oldDisposition: "scrap",
    coveragePolicy: "inherit_original",
    reason: "Synthetic",
  });
  assert.throws(
    () =>
      f.app.warranty.dispatchReplacement(f.actor, "duplicate", {
        ...dispatch(r2.id, "S3"),
        carrier: " SYNTHETIC CARRIER ",
        tracking: "ｓｙｎ-ｔｒａｃｋ-１",
      }),
    { code: "TRACKING_REUSED" },
  );
  assert.equal(f.app.inventory.trace(f.actor, "S3").unit.state, "stock");
});
test("real shipping grants precede cached retries and history; buyers see only their tracking and public observations", (t) => {
  const f = fixture(t),
    r = reserved(f),
    warehouse = user(f, "warehouse"),
    buyer = user(f, "buyer"),
    p = dispatch(r.id);
  for (const role of [
    "buyer",
    "commercial",
    "finance",
    "warranty",
    "support",
  ] as const) {
    const a = role === "buyer" ? buyer : user(f, role);
    assert.throws(
      () =>
        f.app.warranty.dispatchReplacement(
          { ...a, role: "admin" },
          "dispatch",
          p,
        ),
      { code: "FORBIDDEN" },
    );
  }
  f.app.warranty.dispatchReplacement(warehouse, "dispatch", p);
  const own = f.app.warranty.replacements(buyer, r.claimId)[0]!;
  assert.equal(own.shipping!.tracking, p.tracking);
  assert.equal(Object.hasOwn(own.shipping!, "address"), false);
  assert.equal(Object.hasOwn(own.shipping!, "recipient"), false);
  assert.equal(Object.hasOwn(own.shipping!, "evidence"), false);
  const forged = f.app.warranty.replacements(
    { ...buyer, role: "admin" },
    r.claimId,
  )[0]!;
  assert.equal(Object.hasOwn(forged, "evidence"), false);
  assert.equal(Object.hasOwn(forged, "recipient"), false);
  assert.equal(Object.hasOwn(forged, "history"), false);
  assert.equal(Object.hasOwn(forged.shipping!, "address"), false);
  const page = f.app.warranty.replacementShippingHistory(buyer, r.id);
  assert.equal(Object.hasOwn(page.items[0]!, "reference"), false);
  assert.equal(Object.hasOwn(page.items[0]!, "actorId"), false);
  assert.equal(Object.hasOwn(page.items[0]!, "evidence"), false);
  grants(f, warehouse, { sites: [] });
  assert.throws(
    () => f.app.warranty.dispatchReplacement(warehouse, "dispatch", p),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () => f.app.warranty.replacementShippingHistory(warehouse, r.id),
    { code: "FORBIDDEN" },
  );
  grants(f, buyer, {
    accountId: f.app.identity.createCustomer(f.actor, "other", {
      name: "Other synthetic",
      tier: "standard",
      creditLimit: 10000,
    }).id,
  });
  assert.throws(() => f.app.warranty.replacementShippingHistory(buyer, r.id), {
    code: "FORBIDDEN",
  });
  grants(f, warehouse, { sites: [f.w1], active: false });
  assert.throws(
    () => f.app.warranty.dispatchReplacement(warehouse, "dispatch", p),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () =>
      f.app.warranty.replacementShippingHistory(
        { ...f.actor, orgId: "foreign" },
        r.id,
      ),
    { code: "FORBIDDEN" },
  );
  const reviewer = f.app.identity.currentActor({
    ...f.actor,
    id: String(
      f.app.identity.users(f.actor).find((u) => u.role === "warranty")!.id,
    ),
  });
  grants(f, reviewer, { sites: [] });
  assert.deepEqual(f.app.warranty.replacements(reviewer, r.claimId), []);
  assert.doesNotThrow(() => f.app.warranty.list(reviewer));
  assert.throws(
    () => f.app.warranty.replacementShippingHistory(reviewer, r.id),
    { code: "FORBIDDEN" },
  );
  const staff = user(f, "admin");
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
      staff.id,
    );
  assert.throws(() => f.app.warranty.replacementShippingHistory(staff, r.id), {
    code: "PASSWORD_CHANGE_REQUIRED",
  });
});
test("late shipping audit failure rolls back custody, disposition, shipping events, movement clock, receipts and audit", (t) => {
  const f = fixture(t),
    r = reserved(f);
  const snapshot = () =>
    Object.fromEntries(
      ["inventory", "warranty", "platform"].map((owner) => [
        owner,
        (owner === "inventory"
          ? [
              "inventory_units",
              "inventory_replacements",
              "inventory_movements",
              "inventory_cost_clock",
              "inventory_cost_sequences",
            ]
          : owner === "warranty"
            ? [
                "warranty_claims",
                "warranty_replacements",
                "warranty_replacement_history",
                "warranty_decisions",
                "warranty_replacement_shipping",
                "warranty_replacement_shipping_history",
              ]
            : ["platform_commands", "platform_audit", "platform_events"]
        ).map((table) =>
          f.app.database.owned(owner as any).all(`SELECT * FROM ${table}`),
        ),
      ]),
    );
  const audit = f.app.platform.audit.bind(f.app.platform);
  function fail(name: string, perform: () => unknown) {
    const before = snapshot();
    f.app.platform.audit = (a, n, k, d) => {
      if (n === name) throw Error("Injected shipping audit failure");
      audit(a, n, k, d);
    };
    try {
      assert.throws(perform, /Injected shipping audit failure/);
    } finally {
      f.app.platform.audit = audit;
    }
    assert.deepEqual(snapshot(), before);
  }
  fail("warranty.replacement.dispatch", () =>
    f.app.warranty.dispatchReplacement(f.actor, "dispatch", dispatch(r.id)),
  );
  f.app.warranty.dispatchReplacement(f.actor, "dispatch", dispatch(r.id));
  const p = outcome(f, r.id);
  fail("warranty.replacement.shipping.update", () =>
    f.app.warranty.updateReplacementShipping(f.actor, "update", p),
  );
  f.app.warranty.updateReplacementShipping(f.actor, "update", p);
});
async function race(
  t: { after: (fn: () => void) => void },
  f: Fixture,
  inputs: { operation: string; key: string; payload: unknown }[],
) {
  const children = inputs.map(() =>
    fork(new URL("./warranty-replacement-child.ts", import.meta.url), [], {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    }),
  );
  t.after(() => children.forEach((c) => c.kill()));
  const ready: Promise<void>[] = [],
    results: Promise<any>[] = [];
  children.forEach((c, i) => {
    let readyResolve: () => void,
      readyReject: (e: Error) => void,
      resolve: (v: unknown) => void,
      reject: (e: Error) => void,
      complete = false,
      stderr = "";
    ready.push(
      new Promise<void>((a, b) => {
        readyResolve = a;
        readyReject = b;
      }),
    );
    results.push(
      new Promise((a, b) => {
        resolve = a;
        reject = b;
      }),
    );
    c.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    c.on("message", (m: any) => {
      if (m.ready) readyResolve();
      else {
        complete = true;
        resolve(m);
      }
    });
    c.on("error", (e) => {
      readyReject(e);
      reject(e);
    });
    c.on("exit", (code) => {
      if (!complete || code !== 0) {
        const e = Error(`Shipping child exited ${code}: ${stderr}`);
        readyReject(e);
        reject(e);
      }
    });
    c.send({ action: "init", path: f.path, actor: f.actor, ...inputs[i] });
  });
  await Promise.all(ready);
  children.forEach((c) => c.send({ action: "go" }));
  return Promise.all(results);
}
test(
  "independent processes serialize dispatch versus collection and competing shipping outcomes",
  { timeout: 20000 },
  async (t) => {
    const f = fixture(t),
      r = reserved(f),
      p = dispatch(r.id);
    const terminal = await race(t, f, [
      { operation: "dispatchReplacement", key: "dispatch", payload: p },
      {
        operation: "handoverReplacement",
        key: "collection",
        payload: {
          replacementId: r.id,
          revision: 1,
          serial: "S2",
          recipient: "counter",
          evidence: "counter",
        },
      },
    ]);
    assert.equal(terminal.filter((r) => r.ok).length, 1);
    assert.equal(terminal.find((r) => !r.ok).code, "STALE_REPLACEMENT");
    // Independent fixture ensures update contention is exercised even if collection won the first race.
    const g = fixture(t),
      next = reserved(g);
    const same = await race(
      t,
      g,
      [0, 1].map(() => ({
        operation: "dispatchReplacement",
        key: "dispatch",
        payload: dispatch(next.id),
      })),
    );
    assert.ok(same.every((r) => r.ok));
    assert.deepEqual(same[0].result, same[1].result);
    const input = outcome(g, next.id);
    const changes = await race(
      t,
      g,
      [0, 1].map((i) => ({
        operation: "updateReplacementShipping",
        key: `outcome-${i}`,
        payload: {
          ...input,
          reference: `race-${i}`,
          state: i ? "delivered" : "lost",
        },
      })),
    );
    assert.equal(changes.filter((r) => r.ok).length, 1);
    assert.equal(changes.find((r) => !r.ok).code, "STALE_SHIPPING");
    assert.equal(
      g.app.warranty.replacementShippingHistory(g.actor, next.id).items.length,
      2,
    );
  },
);
test("HTTP shipping enforces session, CSRF, strict payloads and account-scoped history", async (t) => {
  const f = fixture(t),
    r = reserved(f),
    origin = "http://127.0.0.1:3000",
    p = dispatch(r.id);
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
  const c = login.cookies[0]!,
    headers = {
      origin,
      cookie: `${c.name}=${c.value}`,
      "x-csrf-token": login.json().csrf,
      "idempotency-key": "dispatch",
    },
    url = "/api/commands/warranty.replacement.dispatch";
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url,
        headers: { origin },
        payload: p,
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url,
        headers: { ...headers, "x-csrf-token": "wrong" },
        payload: p,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url,
        headers: { ...headers, origin: "https://foreign.test" },
        payload: p,
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
        payload: { ...p, extra: true },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await http.inject({ method: "POST", url, headers, payload: p }))
      .statusCode,
    200,
  );
  const updateUrl = "/api/commands/warranty.replacement.shipping.update",
    o = outcome(f, r.id);
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: updateUrl,
        headers: { ...headers, "idempotency-key": "outcome" },
        payload: { ...o, state: "unknown" },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: updateUrl,
        headers: { ...headers, "idempotency-key": "outcome" },
        payload: o,
      })
    ).statusCode,
    200,
  );
  const history = `/api/warranty/replacements/${r.id}/shipping/history`;
  assert.equal(
    (await http.inject({ method: "GET", url: history, headers })).json().items
      .length,
    2,
  );
  assert.equal(
    (await http.inject({ method: "GET", url: history + "?after=0", headers }))
      .statusCode,
    400,
  );
  assert.equal(
    (await http.inject({ method: "GET", url: history + "?extra=1", headers }))
      .statusCode,
    400,
  );
});
test("encrypted isolated restore retains dispatch and observations and excludes later delivery", async (t) => {
  const f = fixture(t),
    r = reserved(f);
  const p = dispatch(r.id),
    d = f.app.warranty.dispatchReplacement(f.actor, "dispatch", p),
    o = outcome(f, r.id);
  f.app.warranty.updateReplacementShipping(f.actor, "delay", o);
  const before = f.app.warranty.replacementShippingHistory(f.actor, r.id),
    archive = join(dirname(f.path), "shipping.backup"),
    target = join(dirname(f.path), "restored.db"),
    key = randomBytes(32);
  await createBackup(f.path, archive, "CA", key);
  f.app.warranty.updateReplacementShipping(f.actor, "delivery", {
    ...outcome(f, r.id, "delivery"),
    state: "delivered",
  });
  await restoreBackup(archive, target, "CA", key);
  const restored = new Application(target);
  t.after(() => restored.close());
  assert.deepEqual(
    restored.warranty.dispatchReplacement(f.actor, "dispatch", p),
    d,
  );
  assert.deepEqual(
    restored.warranty.replacementShippingHistory(f.actor, r.id),
    before,
  );
  assert.equal(
    restored.warranty.replacements(f.actor, r.claimId)[0]!.shipping!.state,
    "delayed",
  );
  assert.ok(restored.platform.recoveryHold());
});
