import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { fixture } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";

function delivery(
  f: ReturnType<typeof fixture>,
  serials = ["D1"],
  quantity = 2,
) {
  const po = f.app.procurement.create(f.actor, "draft-po", {
    supplierId: f.supplier,
    warehouseId: f.w1,
    lines: [{ productId: f.product, quantity, unitCost: 6000 }],
  }).id;
  const line = f.app.procurement.orders(f.actor).find((p) => p.id === po)!
    .lines[0]!;
  return {
    poId: po,
    lineId: String(line.id),
    deliveryRef: "DRAFT-DELIVERY",
    observedSku: "EQ-1",
    quantity,
    serials,
    bin: "R-1",
    quarantine: true,
    draftId: null,
    revision: 0,
  };
}

test("incomplete receipt scans survive restart without stock; reviewed confirmation receives once at original cost and cached reads recheck site authority", (t) => {
  const f = fixture(t),
    input = delivery(f),
    drafts = () => f.app.procurement.drafts;
  const before = f.app.inventory.stock(f.actor);
  const saved = drafts().save(f.actor, "save", input);
  assert.equal(saved.revision, 1);
  assert.deepEqual(f.app.inventory.stock(f.actor), before);
  assert.equal(
    f.app.procurement.orders(f.actor).find((p) => p.id === input.poId)!
      .lines[0]!.received,
    0,
  );
  assert.throws(
    () =>
      drafts().confirm(f.actor, "incomplete", {
        draftId: saved.id,
        revision: 1,
      }),
    { code: "SERIAL" },
  );
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(drafts().list(f.actor)[0]!.input.serials, ["D1"]);
  const edited = drafts().save(f.actor, "finish", {
    ...input,
    draftId: saved.id,
    revision: 1,
    serials: [" D1 ", "D2"],
  });
  assert.equal(edited.revision, 2);
  const result = drafts().confirm(f.actor, "confirm", {
    draftId: saved.id,
    revision: 2,
  });
  assert.equal(result.unitIds.length, 2);
  assert.deepEqual(
    drafts().confirm(f.actor, "confirm", { draftId: saved.id, revision: 2 }),
    result,
  );
  assert.throws(
    () =>
      drafts().confirm({ ...f.actor, id: "other" }, "fresh-key", {
        draftId: saved.id,
        revision: 2,
      }),
    { code: "FORBIDDEN" },
  );
  const other = f.app.identity.createUser(f.actor, "other-worker", {
    email: "other-worker@example.test",
    name: "Other warehouse worker",
    password: "long-test-only-password",
    role: "warehouse",
    sites: [f.w1],
  });
  assert.deepEqual(
    drafts().confirm(
      f.app.identity.currentActor({ ...f.actor, id: other.id }),
      "fresh-key",
      {
        draftId: saved.id,
        revision: 2,
      },
    ),
    result,
  );
  assert.deepEqual(
    drafts()
      .history(f.actor, saved.id)
      .map((v) => [v.revision, v.state]),
    [
      [1, "draft"],
      [2, "draft"],
      [3, "received"],
    ],
  );
  assert.equal(
    f.app.procurement.receipts(f.actor).filter((r) => r.po_id === input.poId)
      .length,
    1,
  );
  assert.equal(
    f.app.procurement.orders(f.actor).find((p) => p.id === input.poId)!
      .lines[0]!.received,
    2,
  );
  for (const serial of ["D1", "D2"]) {
    const trace = f.app.inventory.trace(f.actor, serial);
    assert.equal(trace.unit.cost, 6000);
    assert.equal(trace.unit.state, "stock");
    assert.equal(trace.unit.condition, "quarantine");
    assert.equal(trace.movements.filter((m) => m.type === "receipt").length, 1);
  }
  const deniedUser = f.app.identity.createUser(f.actor, "other-site", {
    email: "other-site@example.test",
    name: "Other site worker",
    password: "long-test-only-password",
    role: "warehouse",
    sites: [f.w2],
  });
  const denied = f.app.identity.currentActor({ ...f.actor, id: deniedUser.id });
  assert.throws(
    () =>
      drafts().confirm(denied, "confirm", { draftId: saved.id, revision: 2 }),
    { code: "FORBIDDEN" },
  );
  assert.throws(() => drafts().save(denied, "save", input), {
    code: "FORBIDDEN",
  });
  assert.throws(() => drafts().history(denied, saved.id), {
    code: "FORBIDDEN",
  });
  assert.equal(drafts().list(denied).length, 0);
  assert.throws(
    () => drafts().history({ ...f.actor, orgId: "foreign" }, saved.id),
    { code: "FORBIDDEN" },
  );
});

test("draft validation rejects wrong SKU, existing/repeated serials, over-receipt, malformed values and serials on bulk without retaining rejected scans", (t) => {
  const f = fixture(t),
    input = delivery(f),
    drafts = f.app.procurement.drafts;
  const rejects = [
    [{ observedSku: "OTHER" }, "SKU"],
    [{ serials: [" S1 "] }, "DUPLICATE_SERIAL"],
    [{ serials: [" X ", "X"] }, "SERIAL"],
    [{ quantity: 3 }, "OVER_RECEIPT"],
    [{ quantity: 0 }, "VALIDATION"],
    [{ quarantine: "true" }, "VALIDATION"],
    [{ serials: null }, "VALIDATION"],
    [{ serials: Array(501).fill("X") }, "VALIDATION"],
  ] as const;
  for (const [changes, code] of rejects)
    assert.throws(
      () => drafts.save(f.actor, code, { ...input, ...changes } as any),
      { code },
    );
  assert.equal(drafts.list(f.actor).length, 0);
  const bulk = f.app.catalog.create(f.actor, "bulk", {
    sku: "DRAFT-BULK",
    name: "Synthetic bulk",
    serialized: false,
    unitPrice: 1000,
    taxBasisPoints: 0,
  }).id;
  const po = f.app.procurement.create(f.actor, "bulk-po", {
    supplierId: f.supplier,
    warehouseId: f.w1,
    lines: [{ productId: bulk, quantity: 4, unitCost: 250 }],
  }).id;
  const bulkInput = {
    ...input,
    poId: po,
    lineId: String(
      f.app.procurement.orders(f.actor).find((p) => p.id === po)!.lines[0]!.id,
    ),
    observedSku: "DRAFT-BULK",
    quantity: 4,
    serials: ["WRONG"],
  };
  assert.throws(() => drafts.save(f.actor, "bulk-with-serial", bulkInput), {
    code: "SERIAL",
  });
  const saved = drafts.save(f.actor, "bulk-empty", {
    ...bulkInput,
    serials: [],
  });
  const received = drafts.confirm(f.actor, "bulk-confirm", {
    draftId: saved.id,
    revision: 1,
  });
  assert.equal(f.app.inventory.unit(f.actor, received.unitIds[0]!).quantity, 4);
});

test("receipt drafts protect revisions/identity, retain discarded versions and reject confirmation after a competing direct receipt", (t) => {
  const f = fixture(t),
    input = delivery(f),
    drafts = f.app.procurement.drafts;
  const saved = drafts.save(f.actor, "save", input);
  assert.throws(() => drafts.save(f.actor, "repeated-ref", input), {
    code: "DRAFT_EXISTS",
  });
  assert.throws(
    () =>
      drafts.save(f.actor, "changed-ref", {
        ...input,
        draftId: saved.id,
        revision: 1,
        deliveryRef: "OTHER",
      }),
    { code: "DRAFT_IDENTITY" },
  );
  const edited = drafts.save(f.actor, "edit", {
    ...input,
    draftId: saved.id,
    revision: 1,
    bin: "R-2",
  });
  assert.throws(
    () =>
      drafts.save(f.actor, "stale", {
        ...input,
        draftId: saved.id,
        revision: 1,
      }),
    { code: "REVISION" },
  );
  assert.throws(
    () =>
      drafts.confirm(f.actor, "stale-confirm", {
        draftId: saved.id,
        revision: 1,
      }),
    { code: "REVISION" },
  );
  drafts.discard(f.actor, "discard", {
    draftId: saved.id,
    revision: edited.revision,
    reason: "Supplier corrected delivery paperwork",
  });
  assert.equal(
    drafts.history(f.actor, saved.id).at(-1)!.reason,
    "Supplier corrected delivery paperwork",
  );
  assert.throws(
    () =>
      drafts.confirm(f.actor, "discarded-confirm", {
        draftId: saved.id,
        revision: 3,
      }),
    { code: "STATE" },
  );
  assert.throws(
    () =>
      drafts.save(f.actor, "discarded-save", {
        ...input,
        draftId: saved.id,
        revision: 3,
      }),
    { code: "STATE" },
  );
  const newer = drafts.save(f.actor, "new-ref", {
    ...input,
    deliveryRef: "CORRECTED",
    serials: ["D1", "D2"],
  });
  const {
    draftId: _id,
    revision: _revision,
    observedSku: _sku,
    ...direct
  } = { ...input, serials: ["D1", "D2"] };
  f.app.procurement.receive(f.actor, "direct", direct);
  assert.throws(
    () =>
      drafts.confirm(f.actor, "competing", { draftId: newer.id, revision: 1 }),
    { code: "OVER_RECEIPT" },
  );
  assert.equal(
    drafts.list(f.actor).find((d) => d.id === newer.id)!.state,
    "draft",
  );
});

test("a late draft confirmation audit failure rolls back inventory, purchase totals, receipt, version and the command receipt", (t) => {
  const f = fixture(t),
    input = delivery(f, ["D1", "D2"]),
    drafts = f.app.procurement.drafts;
  const saved = drafts.save(f.actor, "save", input),
    before = f.app.inventory.stock(f.actor);
  const audit = f.app.platform.audit;
  f.app.platform.audit = (...args) => {
    if (args[1] === "purchase.draft.confirm")
      throw new Error("Synthetic late audit fault");
    return audit.apply(f.app.platform, args);
  };
  assert.throws(
    () =>
      drafts.confirm(f.actor, "confirm", { draftId: saved.id, revision: 1 }),
    /late audit fault/,
  );
  f.app.platform.audit = audit;
  assert.deepEqual(f.app.inventory.stock(f.actor), before);
  assert.equal(drafts.list(f.actor)[0]!.revision, 1);
  assert.equal(drafts.history(f.actor, saved.id).length, 1);
  assert.equal(
    f.app.procurement.orders(f.actor).find((p) => p.id === input.poId)!
      .lines[0]!.received,
    0,
  );
  assert.equal(
    f.app.procurement.receipts(f.actor).filter((r) => r.po_id === input.poId)
      .length,
    0,
  );
  assert.equal(
    f.app.database
      .owned("platform")
      .all(
        "SELECT key FROM platform_commands WHERE name='purchase.draft.confirm' OR key=?",
        `draft:${saved.id}`,
      ).length,
    0,
  );
  assert.equal(
    drafts.confirm(f.actor, "confirm", { draftId: saved.id, revision: 1 })
      .unitIds.length,
    2,
  );
});

for (const identical of [true, false])
  test(
    `separate processes ${identical ? "retry the same draft" : "compete for a purchase line"} without duplicate stock`,
    { timeout: 15000 },
    async (t) => {
      const f = fixture(t),
        input = delivery(f, ["D1", "D2"]);
      const first = f.app.procurement.drafts.save(f.actor, "save", input);
      const second = identical
        ? first
        : f.app.procurement.drafts.save(f.actor, "second", {
            ...input,
            deliveryRef: "OTHER",
          });
      const children = [first, second].map(() =>
        fork(new URL("./receipt-draft-child.ts", import.meta.url), [], {
          execArgv: ["--import", "tsx"],
          stdio: ["ignore", "ignore", "pipe", "ipc"],
        }),
      );
      t.after(() => children.forEach((child) => child.kill()));
      const ready: Promise<void>[] = [],
        results: Promise<any>[] = [];
      children.forEach((child, i) => {
        let readyResolve: () => void,
          resultResolve: (value: any) => void,
          reject: (error: Error) => void;
        ready.push(
          new Promise<void>((resolve) => {
            readyResolve = resolve;
          }),
        );
        results.push(
          new Promise((resolve, failure) => {
            resultResolve = resolve;
            reject = failure;
          }),
        );
        let stderr = "";
        child.stderr?.on("data", (value) => {
          stderr += String(value);
        });
        child.on("message", (message: any) =>
          message.ready ? readyResolve() : resultResolve(message),
        );
        child.on("error", reject!);
        child.on("exit", (code) => {
          if (code !== 0) reject(new Error(`Child exit ${code}: ${stderr}`));
        });
        child.send({
          action: "init",
          path: f.path,
          actor: f.actor,
          key: identical ? "same-key" : `race-${i}`,
          payload: { draftId: [first, second][i]!.id, revision: 1 },
        });
      });
      await Promise.all(ready);
      children.forEach((child) => child.send({ action: "go" }));
      const outcomes = await Promise.all(results);
      assert.equal(
        outcomes.filter((result) => result.ok).length,
        identical ? 2 : 1,
      );
      if (identical) assert.deepEqual(outcomes[0].result, outcomes[1].result);
      else
        assert.equal(
          outcomes.find((result) => !result.ok).code,
          "OVER_RECEIPT",
        );
      assert.equal(
        f.app.procurement
          .receipts(f.actor)
          .filter((r) => r.po_id === input.poId).length,
        1,
      );
      assert.equal(
        f.app.inventory
          .stock(f.actor)
          .filter((unit) => ["D1", "D2"].includes(unit.serial ?? "")).length,
        2,
      );
    },
  );

test("HTTP receipt drafts enforce exact shape, CSRF, authorized history and current grants before replay", async (t) => {
  const f = fixture(t),
    input = delivery(f),
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
  const headers = {
    origin,
    cookie: `distributor_session=${login.cookies[0]!.value}`,
    "x-csrf-token": login.json().csrf,
    "idempotency-key": "http-draft",
  };
  const save = (payload: any, requestHeaders = headers) =>
    http.inject({
      method: "POST",
      url: "/api/commands/purchase.draft.save",
      headers: requestHeaders,
      payload,
    });
  assert.equal((await save({ ...input, warehouseId: f.w2 })).statusCode, 400);
  assert.equal(
    (await save(input, { ...headers, "x-csrf-token": "wrong" })).statusCode,
    403,
  );
  const response = await save(input);
  assert.equal(response.statusCode, 200);
  assert.equal(
    response.headers["permissions-policy"],
    "camera=(self), microphone=()",
  );
  const url = `/api/purchases/drafts/${response.json().id}/history`;
  assert.equal((await http.inject({ method: "GET", url })).statusCode, 401);
  assert.equal(
    (await http.inject({ method: "GET", url, headers })).json().length,
    1,
  );
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_users SET role='warehouse',sites=? WHERE id=?",
      JSON.stringify([f.w2]),
      f.actor.id,
    );
  assert.equal((await save(input)).statusCode, 403);
  assert.equal(
    (await http.inject({ method: "GET", url, headers })).statusCode,
    403,
  );
});
