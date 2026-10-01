import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { Application } from "../src/server/application.ts";
import { fixture } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";

type Fixture = ReturnType<typeof fixture>;
test("supplier reviews reject missing or unsupported resolutions and preserve the open return", (t) => {
  const f = fixture(t),
    returnId = returned(f);
  for (const resolution of [null, "unsupported", "reconciled"]) {
    assert.throws(
      () =>
        f.app.procurement.followups.review(f.actor, `bad-${resolution}`, {
          returnId,
          revision: 0,
          reference: `BAD-${resolution}`,
          evidence: "Synthetic review",
          state: "closed",
          resolution: resolution as any,
        }),
      { code: "RESOLUTION" },
    );
  }
  assert.deepEqual(
    f.app.procurement.followups.history(f.actor, returnId).items,
    [],
  );
  assert.equal(
    f.app.procurement.followups.summary(f.actor, returnId).state,
    "open",
  );
});
test("US supplier credits require USD while CA requires CAD, without inferring FX or cash", (t) => {
  const app = new Application(":memory:", "US");
  t.after(() => app.close());
  const actor = app.identity.bootstrap(
    "Synthetic US",
    "us@example.test",
    "long-test-only-password",
    "USD",
  );
  const warehouseId = app.inventory.createWarehouse(actor, "w", {
    name: "US fixture",
  }).id;
  const supplierId = app.procurement.supplier(actor, "s", {
    name: "US supplier",
  }).id;
  const productId = app.catalog.create(actor, "p", {
    sku: "US-SUP",
    name: "US bulk",
    serialized: false,
    unitPrice: 500,
    taxBasisPoints: 0,
  }).id;
  const poId = app.procurement.create(actor, "po", {
    supplierId,
    warehouseId,
    lines: [{ productId, quantity: 1, unitCost: 250 }],
  }).id;
  const lineId = String(app.procurement.orders(actor)[0]!.lines[0]!.id);
  const receipt = app.procurement.receive(actor, "receive", {
    poId,
    lineId,
    quantity: 1,
    serials: [],
    deliveryRef: "US-DEL",
    bin: "A",
    quarantine: true,
  });
  const unit = app.inventory.stock(actor)[0]!;
  const returnId = app.procurement.returnStock(actor, "return", {
    receiptId: receipt.id,
    unitId: unit.id,
    revision: unit.revision,
    quantity: 1,
    serial: null,
    returnRef: "US-RET",
    reason: "Synthetic defect",
    handoverEvidence: "Synthetic handover",
  }).id;
  assert.throws(
    () =>
      app.procurement.followups.credit(actor, "cad", {
        ...credit(returnId),
        amount: 300,
      }),
    { code: "CURRENCY" },
  );
  const stockBefore = app.inventory.stock(actor);
  app.procurement.followups.credit(actor, "usd", {
    ...credit(returnId),
    currency: "USD",
    amount: 300,
  });
  assert.deepEqual(app.procurement.followups.summary(actor, returnId), {
    revision: 1,
    state: "open",
    resolution: null,
    originalCost: 250,
    creditAmount: 300,
    replacementQuantity: 0,
    currency: "USD",
    activeCount: 1,
  });
  assert.deepEqual(app.inventory.stock(actor), stockBefore);
  assert.deepEqual(app.billing.credits(actor), []);
});
test("received replacements cannot link a different supplier or product", (t) => {
  const f = fixture(t),
    returnId = returned(f);
  const differentSupplier = f.app.procurement.supplier(f.actor, "other-s", {
    name: "Other supplier",
  }).id;
  const differentProduct = f.app.catalog.create(f.actor, "other-p", {
    sku: "OTHER",
    name: "Other equipment",
    serialized: true,
    unitPrice: 10000,
    taxBasisPoints: 0,
  }).id;
  for (const [index, supplierId, productId] of [
    [0, differentSupplier, f.product],
    [1, f.supplier, differentProduct],
  ] as const) {
    const poId = f.app.procurement.create(f.actor, `wrong-po-${index}`, {
      supplierId,
      warehouseId: f.w1,
      lines: [{ productId, quantity: 1, unitCost: 5000 }],
    }).id;
    const lineId = String(
      f.app.procurement.orders(f.actor).find((po) => po.id === poId)!.lines[0]!
        .id,
    );
    const receipt = f.app.procurement.receive(
      f.actor,
      `wrong-receipt-${index}`,
      {
        poId,
        lineId,
        quantity: 1,
        serials: [`WRONG-${index}`],
        deliveryRef: `WRONG-${index}`,
        bin: "A",
        quarantine: true,
      },
    );
    assert.throws(
      () =>
        f.app.procurement.followups.replacement(
          f.actor,
          `wrong-link-${index}`,
          {
            returnId,
            revision: 0,
            reference: `WRONG-${index}`,
            evidence: "Synthetic wrong replacement",
            quantity: 1,
            receiptId: receipt.id,
          },
        ),
      { code: "REPLACEMENT" },
    );
  }
  assert.equal(
    f.app.procurement.followups.summary(f.actor, returnId).revision,
    0,
  );
});
function returned(f: Fixture, serial = "S3") {
  const unit = f.app.inventory.trace(f.actor, serial).unit;
  return f.app.procurement.returnStock(f.actor, `return-${serial}`, {
    receiptId: f.app.inventory.purchaseOrigin(f.actor, unit.id)!,
    unitId: unit.id,
    revision: unit.revision,
    quantity: 1,
    serial,
    returnRef: `RETURN-${serial}`,
    reason: "Synthetic defect",
    handoverEvidence: "Synthetic handover",
  }).id;
}
function user(
  f: Fixture,
  role: "finance" | "warehouse" | "buyer",
  sites: string[] = [],
) {
  const { id } = f.app.identity.createUser(f.actor, `${role}-${sites.join()}`, {
    email: `${role}-${sites.join()}@supplier.example.test`,
    name: `Synthetic ${role}`,
    password: "long-test-only-password",
    role,
    sites,
    ...(role === "buyer" ? { accountId: f.buyer } : {}),
  });
  return f.app.identity.currentActor({ ...f.actor, id });
}
function credit(returnId: string, revision = 0, reference = "CREDIT-1") {
  return {
    returnId,
    revision,
    reference,
    evidence:
      "Synthetic supplier credit note; finance must reconcile separately",
    amount: 6500,
    currency: "CAD",
  };
}
function replacement(f: Fixture, serials = ["REPLACEMENT-1"]) {
  const po = f.app.procurement.create(f.actor, "replacement-po", {
    supplierId: f.supplier,
    warehouseId: f.w2,
    lines: [{ productId: f.product, quantity: serials.length, unitCost: 5000 }],
  }).id;
  const line = f.app.procurement.orders(f.actor).find((p) => p.id === po)!
    .lines[0]!;
  const receipt = f.app.procurement.receive(f.actor, "replacement-receipt", {
    poId: po,
    lineId: String(line.id),
    quantity: serials.length,
    serials,
    deliveryRef: "REPLACEMENT-DELIVERY",
    bin: "R",
    quarantine: true,
  });
  return { po, receipt };
}
function facts(f: Fixture) {
  return {
    stock: f.app.inventory.stock(f.actor),
    orders: f.app.procurement.orders(f.actor),
    invoices: f.app.billing.invoices(f.actor),
    credits: f.app.billing.credits(f.actor),
  };
}

test("supplier credit records external amount independently from original cost; immutable corrections, closure and restart preserve native facts", (t) => {
  const f = fixture(t),
    returnId = returned(f),
    finance = user(f, "finance"),
    input = credit(returnId),
    before = facts(f);
  const result = f.app.procurement.followups.credit(finance, "credit", input);
  assert.equal(
    f.app.procurement.followups.summary(finance, returnId).originalCost,
    6000,
  );
  assert.equal(
    f.app.procurement.followups.summary(finance, returnId).creditAmount,
    6500,
  );
  const closed = {
    returnId,
    revision: 1,
    reference: "REVIEW-1",
    evidence: "Synthetic review of 500-cent difference; no posting implied",
    state: "closed" as const,
    resolution: "reconciled" as const,
  };
  for (const resolution of [null, "unexpected", "no-remedy"]) {
    assert.throws(
      () =>
        f.app.procurement.followups.review(finance, `bad-${resolution}`, {
          ...closed,
          resolution: resolution as typeof closed.resolution,
        }),
      { code: "RESOLUTION" },
    );
  }
  f.app.procurement.followups.review(finance, "review", closed);
  assert.throws(
    () =>
      f.app.procurement.followups.credit(
        finance,
        "closed",
        credit(returnId, 2, "C2"),
      ),
    { code: "STATE" },
  );
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(
    f.app.procurement.followups.credit(finance, "new-key", {
      ...input,
      reference: " credit-1 ",
    }),
    result,
  );
  assert.equal(
    f.app.procurement.followups.summary(finance, returnId).state,
    "closed",
  );
  f.app.procurement.followups.review(finance, "reopen", {
    ...closed,
    revision: 2,
    reference: "REOPEN",
    state: "open",
    resolution: null,
  });
  f.app.procurement.followups.void(finance, "correct", {
    returnId,
    revision: 3,
    reference: "CORRECTION",
    evidence: "Synthetic supplier rescinded note",
    observationId: result.id,
  });
  assert.equal(
    f.app.procurement.followups.summary(finance, returnId).creditAmount,
    0,
  );
  const history = f.app.procurement.followups.history(finance, returnId);
  assert.equal(history.items.length, 4);
  assert.equal(history.items.find((r) => r.id === result.id)!.amount, 6500);
  assert.equal(history.items.find((r) => r.id === result.id)!.voided, 1);
  assert.throws(
    () =>
      f.app.procurement.followups.review(finance, "bad-review", {
        ...closed,
        revision: 4,
        reference: "BAD-REVIEW",
      }),
    { code: "RESOLUTION" },
  );
  f.app.procurement.followups.review(finance, "no-remedy", {
    ...closed,
    revision: 4,
    reference: "NO-REMEDY",
    resolution: "no-remedy",
  });
  assert.deepEqual(facts(f), before);
  assert.equal(
    f.app.procurement.orders(finance).find((p) => p.id === f.po)!.lines[0]!
      .received,
    3,
  );
});

test("replacement links reconcile received same-supplier/product units once across returns without duplicating inventory or reopening purchases", (t) => {
  const f = fixture(t),
    returnId = returned(f),
    other = returned(f, "S2"),
    { receipt } = replacement(f),
    before = facts(f);
  const input = {
    returnId,
    revision: 0,
    reference: "REPLACEMENT-LINK",
    evidence: "Synthetic supplier replacement agreement",
    receiptId: receipt.id,
    quantity: 1,
  };
  const result = f.app.procurement.followups.replacement(
    f.actor,
    "link",
    input,
  );
  assert.equal(
    f.app.procurement.followups.summary(f.actor, returnId).replacementQuantity,
    1,
  );
  assert.throws(
    () =>
      f.app.procurement.followups.replacement(f.actor, "over-return", {
        ...input,
        revision: 1,
        reference: "OVER",
      }),
    { code: "QUANTITY" },
  );
  assert.throws(
    () =>
      f.app.procurement.followups.replacement(f.actor, "reuse", {
        ...input,
        returnId: other,
        reference: "REUSED",
      }),
    { code: "QUANTITY" },
  );
  const oldReceipt = f.app.procurement
    .receipts(f.actor)
    .find((r) => r.po_id === f.po)!.id;
  assert.throws(
    () =>
      f.app.procurement.followups.replacement(f.actor, "old-po", {
        ...input,
        returnId: other,
        reference: "OLD",
        receiptId: oldReceipt,
      }),
    { code: "REPLACEMENT" },
  );
  f.app.procurement.followups.void(f.actor, "void-link", {
    returnId,
    revision: 1,
    reference: "VOID-LINK",
    evidence: "Correct mistaken linkage",
    observationId: result.id,
  });
  f.app.procurement.followups.replacement(f.actor, "correct-link", {
    ...input,
    returnId: other,
    reference: "CORRECTED-LINK",
  });
  assert.deepEqual(facts(f), before);
  assert.throws(
    () =>
      f.app.procurement.followups.void(f.actor, "wrong-return", {
        returnId: other,
        revision: 1,
        reference: "WRONG",
        evidence: "Wrong return",
        observationId: result.id,
      }),
    { code: "NOT_FOUND" },
  );
});

test("fresh actual grants and password requirements precede cached supplier outcomes and warehouse-scoped history; forged roles cannot broaden access", (t) => {
  const f = fixture(t),
    returnId = returned(f),
    finance = user(f, "finance"),
    buyer = user(f, "buyer"),
    w1 = user(f, "warehouse", [f.w1]),
    w2 = user(f, "warehouse", [f.w2]),
    input = credit(returnId);
  f.app.procurement.followups.credit(finance, "saved", input);
  assert.equal(
    f.app.procurement.followups.history(w1, returnId).items.length,
    1,
  );
  for (const actor of [buyer, w1, w2])
    assert.throws(
      () =>
        f.app.procurement.followups.credit(
          { ...actor, role: "admin" },
          "forged",
          input,
        ),
      { code: "FORBIDDEN" },
    );
  assert.throws(() => f.app.procurement.followups.history(w2, returnId), {
    code: "FORBIDDEN",
  });
  assert.equal(f.app.procurement.returns({ ...w2, role: "admin" }).length, 0);
  assert.throws(
    () =>
      f.app.procurement.followups.history(
        { ...buyer, role: "finance" },
        returnId,
      ),
    { code: "FORBIDDEN" },
  );
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
      finance.id,
    );
  assert.throws(
    () => f.app.procurement.followups.credit(finance, "saved", input),
    { code: "PASSWORD_CHANGE_REQUIRED" },
  );
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_user_security SET password_change_required=0 WHERE user_id=?",
      finance.id,
    );
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET active=0 WHERE id=?", finance.id);
  assert.throws(
    () => f.app.procurement.followups.credit(finance, "saved", input),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () =>
      f.app.procurement.followups.history(
        { ...f.actor, orgId: "foreign" },
        returnId,
      ),
    { code: "FORBIDDEN" },
  );
});

test("supplier history pages are bounded, durable and scoped; stale revisions, permanent references, currency and malformed outcomes are rejected", (t) => {
  const f = fixture(t),
    returnId = returned(f),
    other = returned(f, "S2");
  for (let revision = 0; revision < 25; revision++)
    f.app.procurement.followups.credit(
      f.actor,
      `c-${revision}`,
      credit(returnId, revision, `NOTE-${revision}`),
    );
  const first = f.app.procurement.followups.history(f.actor, returnId);
  assert.deepEqual(
    first.items.map((r) => r.revision),
    Array.from({ length: 20 }, (_, i) => 25 - i),
  );
  assert.equal(first.next, "6");
  assert.equal(
    f.app.procurement.followups.history(f.actor, returnId, 6).items.length,
    5,
  );
  assert.throws(() => f.app.procurement.followups.history(f.actor, other, 6), {
    code: "NOT_FOUND",
  });
  assert.throws(
    () =>
      f.app.procurement.followups.credit(
        f.actor,
        "stale",
        credit(returnId, 0, "NEW"),
      ),
    { code: "REVISION" },
  );
  assert.throws(
    () =>
      f.app.procurement.followups.credit(
        f.actor,
        "same-ref",
        credit(other, 0, "NOTE-0"),
      ),
    { code: "RECEIPT_CONFLICT" },
  );
  for (const patch of [
    { currency: "USD" },
    { amount: 0 },
    { amount: 1.5 },
    { evidence: " " },
  ])
    assert.throws(() =>
      f.app.procurement.followups.credit(f.actor, JSON.stringify(patch), {
        ...credit(returnId, 25, "INVALID"),
        ...patch,
      }),
    );
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(
    f.app.procurement.followups.history(f.actor, returnId),
    first,
  );
});

test("late audit failure rolls supplier observation/event/receipt back atomically", (t) => {
  const f = fixture(t),
    returnId = returned(f),
    before = f.app.platform.events(f.actor),
    store = f.app.database.owned("procurement");
  f.app.database
    .owned("platform")
    .migrate(
      `CREATE TRIGGER platform_supplier_fault BEFORE INSERT ON platform_audit WHEN new.action='purchase.return.credit' BEGIN SELECT RAISE(ABORT,'synthetic late failure'); END;`,
    );
  assert.throws(
    () =>
      f.app.procurement.followups.credit(f.actor, "rollback", credit(returnId)),
    /synthetic late failure/,
  );
  assert.equal(
    store.all("SELECT * FROM procurement_return_followups").length,
    0,
  );
  assert.deepEqual(f.app.platform.events(f.actor), before);
  f.app.database
    .owned("platform")
    .migrate("DROP TRIGGER platform_supplier_fault");
  assert.equal(
    f.app.procurement.followups.credit(f.actor, "rollback", credit(returnId))
      .revision,
    1,
  );
});

test("HTTP supplier commands require authentication/CSRF/exact shape and history cursor validates as a scoped integer", async (t) => {
  const f = fixture(t),
    returnId = returned(f),
    http = await createHttp(f.app, {
      origin: "http://localhost:3000",
      staticRoot: "/nonexistent-distributor-test",
    });
  t.after(() => http.close());
  const anonymous = await http.inject({
    method: "GET",
    url: `/api/purchases/returns/${returnId}/history`,
  });
  assert.equal(anonymous.statusCode, 401);
  const session = f.app.identity.login(
    "admin@example.test",
    "long-test-only-password",
  );
  const cookie = `distributor_session=${session.token}`,
    headers = {
      cookie,
      "x-csrf-token": session.csrf,
      origin: "http://localhost:3000",
      "idempotency-key": "http-credit",
    };
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: "/api/commands/purchase.return.credit",
        headers: { cookie },
        payload: credit(returnId),
      })
    ).statusCode,
    403,
  );
  const extra = await http.inject({
    method: "POST",
    url: "/api/commands/purchase.return.credit",
    headers,
    payload: { ...credit(returnId), extra: true },
  });
  assert.equal(extra.statusCode, 400);
  const saved = await http.inject({
    method: "POST",
    url: "/api/commands/purchase.return.credit",
    headers,
    payload: credit(returnId),
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const page = await http.inject({
    url: `/api/purchases/returns/${returnId}/history`,
    headers: { cookie },
  });
  assert.equal(page.json().items[0].amount, 6500);
  assert.equal(page.json().items[0].input_hash, undefined);
  assert.equal(
    (
      await http.inject({
        url: `/api/purchases/returns/${returnId}/history?after=1.5`,
        headers: { cookie },
      })
    ).statusCode,
    400,
  );
});

test(
  "two OS processes enforce supplier revisions, stable references and cross-return replacement capacity",
  { timeout: 15000 },
  async (t) => {
    for (const mode of ["competing", "identical", "replacement"]) {
      const identical = mode === "identical";
      const f = fixture(t),
        returnId = returned(f),
        returnIds =
          mode === "replacement" ? [returnId, returned(f, "S2")] : [returnId],
        receiptId = mode === "replacement" ? replacement(f).receipt.id : null,
        children = [0, 1].map(() =>
          fork(new URL("./supplier-followup-child.ts", import.meta.url), [], {
            execArgv: ["--import", "tsx"],
            stdio: ["ignore", "ignore", "pipe", "ipc"],
          }),
        );
      t.after(() => children.forEach((c) => c.kill()));
      const ready: Promise<void>[] = [],
        results: Promise<{ ok: boolean; result?: unknown; code?: string }>[] =
          [];
      children.forEach((child, i) => {
        let signal: () => void,
          resolve: (v: any) => void,
          reject: (e: Error) => void;
        ready.push(new Promise((r) => (signal = r)));
        results.push(
          new Promise((r, j) => {
            resolve = r;
            reject = j;
          }),
        );
        let stderr = "";
        child.stderr?.on("data", (d) => (stderr += String(d)));
        child.on("message", (m: any) => (m.ready ? signal() : resolve(m)));
        child.on("error", (e) => reject(e));
        child.on("exit", (code) => {
          if (code !== 0) reject(new Error(`Child exit ${code}: ${stderr}`));
        });
        child.send({
          action: "init",
          path: f.path,
          actor: f.actor,
          key: `race-${i}`,
          kind: mode === "replacement" ? "replacement" : "credit",
          input:
            mode === "replacement"
              ? {
                  returnId: returnIds[i],
                  revision: 0,
                  reference: `LINK-${i}`,
                  evidence:
                    "Synthetic one received unit claimed concurrently across returns",
                  receiptId,
                  quantity: 1,
                }
              : credit(returnId, 0, identical ? "SAME" : `RACE-${i}`),
        });
      });
      await Promise.all(ready);
      children.forEach((c) => c.send({ action: "go" }));
      const outcomes = await Promise.all(results);
      assert.equal(outcomes.filter((r) => r.ok).length, identical ? 2 : 1);
      if (identical) assert.deepEqual(outcomes[0]!.result, outcomes[1]!.result);
      else
        assert.equal(
          outcomes.find((r) => !r.ok)!.code,
          mode === "replacement" ? "QUANTITY" : "REVISION",
        );
      assert.equal(
        returnIds.reduce(
          (sum, id) =>
            sum + f.app.procurement.followups.summary(f.actor, id).revision,
          0,
        ),
        1,
      );
    }
  },
);
