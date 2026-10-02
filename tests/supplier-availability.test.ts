import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import { inspectSchema, upgradeSchema } from "../src/server/schema-upgrade.ts";
import type { LightMyRequestResponse } from "fastify";

for (const region of ["CA", "US"] as const)
  test(`supplier availability ${region}: stop new purchasing while receiving original commitments, then explicitly resume after restart`, (t) => {
    const f = fixture(t, {}, region);
    const purchase = {
      supplierId: f.supplier,
      warehouseId: f.w1,
      lines: [{ productId: f.product, quantity: 1, unitCost: 4321 }],
    };
    const po = f.app.procurement.create(f.actor, "existing-order", purchase);
    const draft = f.app.procurement.drafts.save(f.actor, "existing-scans", {
      poId: po.id,
      lineId: String(f.app.procurement.order(f.actor, po.id).lines[0]!.id),
      deliveryRef: "EXISTING-COMMITMENT",
      observedSku: "EQ-1",
      quantity: 1,
      serials: ["EXISTING-1"],
      bin: "A-2",
      quarantine: false,
      draftId: null,
      revision: 0,
    });
    assert.deepEqual(f.app.procurement.supplierChoice(f.actor, f.supplier), {
      id: f.supplier,
      name: "Synthetic supplier",
      active: true,
      revision: 0,
    });
    const input = {
      supplierId: f.supplier,
      revision: 0,
      active: false,
      reason: "Synthetic purchasing suspension",
    };
    const stopped = f.app.procurement.supplierAvailability(
      f.actor,
      "stop",
      input,
    );
    assert.equal(stopped.active, false);
    assert.equal(stopped.revision, 1);
    assert.throws(
      () => f.app.procurement.create(f.actor, "new-order", purchase),
      {
        code: "SUPPLIER_INACTIVE",
      },
    );
    assert.deepEqual(
      f.app.procurement.create(f.actor, "existing-order", purchase),
      po,
    );
    const received = f.app.procurement.drafts.confirm(
      f.actor,
      "receive-original",
      {
        draftId: draft.id,
        revision: 1,
      },
    );
    assert.ok(received.id);
    const stock = f.app.inventory
      .stock(f.actor)
      .find((u) => u.serial === "EXISTING-1")!;
    assert.equal(stock.cost, 4321);
    const receipt = f.app.procurement
      .receipts(f.actor)
      .find((r) => r.candidates.some((c) => c.id === stock.id))!;
    const returned = f.app.procurement.returnStock(f.actor, "return-original", {
      receiptId: receipt.id,
      unitId: stock.id,
      revision: stock.revision,
      quantity: 1,
      serial: "EXISTING-1",
      returnRef: "SUSPENDED-SUPPLIER-RETURN",
      reason: "Synthetic original commitment return",
      handoverEvidence: "Synthetic counter handover",
    });
    assert.equal(returned.unitCost, 4321);
    f.app.close();
    f.app = new Application(f.path, region);
    assert.deepEqual(
      f.app.procurement.supplierAvailability(f.actor, "stop", input),
      stopped,
    );
    assert.equal(
      f.app.procurement.supplierChoice(f.actor, f.supplier).active,
      false,
    );
    assert.throws(
      () =>
        f.app.procurement.supplierAvailability(f.actor, "stale", {
          ...input,
          active: true,
          reason: "Stale review",
        }),
      { code: "REVISION" },
    );
    const resumed = f.app.procurement.supplierAvailability(f.actor, "resume", {
      supplierId: f.supplier,
      revision: 1,
      active: true,
      reason: "Synthetic supplier qualified again",
    });
    assert.equal(resumed.active, true);
    assert.equal(resumed.revision, 2);
    assert.ok(
      f.app.procurement.create(f.actor, "new-after-resume", purchase).id,
    );
    const review = f.app.procurement.supplierAvailabilityReview(
      f.actor,
      f.supplier,
    );
    assert.deepEqual(
      review.changes.map((c) => [c.revision, c.active, c.actorId, c.reason]),
      [
        [2, true, f.actor.id, "Synthetic supplier qualified again"],
        [1, false, f.actor.id, "Synthetic purchasing suspension"],
      ],
    );
    assert.equal(review.next, null);
  });

test("supplier availability HTTP uses current sessions, strict reviewed commands and a bounded retained history", async (t) => {
  const f = fixture(t),
    origin = "http://127.0.0.1:3117";
  const http = await createHttp(f.app, { origin });
  t.after(() => http.close());
  const url = `/api/purchases/suppliers/${f.supplier}/availability`;
  assert.equal((await http.inject({ url })).statusCode, 401);
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
    cookie: `${login.cookies[0]!.name}=${login.cookies[0]!.value}`,
    origin,
    "x-csrf-token": login.json().csrf,
    "idempotency-key": "http-stop",
  };
  const review = await http.inject({ url, headers });
  assert.equal(review.statusCode, 200, review.body);
  assert.equal(review.headers["cache-control"], "no-store");
  assert.deepEqual(review.json().changes, []);
  const input = {
    supplierId: f.supplier,
    revision: 0,
    active: false,
    reason: "Synthetic HTTP suspension",
  };
  const stopped = await http.inject({
    method: "POST",
    url: "/api/commands/supplier.availability",
    headers,
    payload: input,
  });
  assert.equal(stopped.statusCode, 200, stopped.body);
  assert.equal(stopped.json().active, false);
  for (const [payload, code] of [
    [{ ...input, extra: 1 }, 400],
    [{ ...input, active: "false" }, 400],
    [{ ...input, revision: 0.5 }, 400],
    [{ ...input, reason: " " }, 400],
    [{ ...input, reason: "x".repeat(1001) }, 400],
    [{ ...input, active: true }, 409],
  ] as const) {
    const result = await http.inject({
      method: "POST",
      url: "/api/commands/supplier.availability",
      headers: { ...headers, "idempotency-key": crypto.randomUUID() },
      payload,
    });
    assert.equal(result.statusCode, code, result.body);
  }
  assert.equal(
    (await http.inject({ url: `${url}?extra=1`, headers })).statusCode,
    400,
  );
  assert.equal(
    (await http.inject({ url: `${url}?after=invalid`, headers })).statusCode,
    400,
  );
  assert.equal(
    (await http.inject({ url: `${url}?after=3`, headers })).statusCode,
    400,
  );
  for (let revision = 1; revision < 43; revision++)
    f.app.procurement.supplierAvailability(f.actor, `change-${revision}`, {
      supplierId: f.supplier,
      revision,
      active: revision % 2 === 1,
      reason: `Synthetic review ${revision}`,
    });
  const revisions: number[] = [];
  let after: string | null = null;
  do {
    const page: LightMyRequestResponse = await http.inject({
      url: url + (after ? `?after=${after}` : ""),
      headers,
    });
    assert.equal(page.statusCode, 200, page.body);
    const body = page.json<{
      changes: { revision: number }[];
      next: string | null;
    }>();
    assert.ok(body.changes.length <= 20);
    revisions.push(...body.changes.map((r) => r.revision));
    after = body.next;
  } while (after);
  assert.deepEqual(
    revisions,
    Array.from({ length: 43 }, (_, n) => 43 - n),
  );
  assert.deepEqual(
    (
      await http.inject({
        method: "POST",
        url: "/api/commands/supplier.availability",
        headers,
        payload: input,
      })
    ).json(),
    stopped.json(),
  );
});

test("supplier availability rechecks persisted commercial authority before cached results and refuses forged scope", (t) => {
  const f = fixture(t);
  const created = f.app.identity.createUser(f.actor, "commercial", {
    email: "commercial@example.test",
    name: "Synthetic commercial",
    password: "long-test-only-password",
    role: "commercial",
    sites: [f.w1],
  });
  const actor = f.app.identity.currentActor({ ...f.actor, id: created.id });
  const input = {
    supplierId: f.supplier,
    revision: 0,
    active: false,
    reason: "Synthetic commercial review",
  };
  const stopped = f.app.procurement.supplierAvailability(
    actor,
    "same-attempt",
    input,
  );
  assert.deepEqual(
    f.app.procurement.supplierAvailability(actor, "same-attempt", input),
    stopped,
  );
  assert.throws(
    () =>
      f.app.procurement.supplierAvailability(actor, "same-attempt", {
        ...input,
        reason: "Changed request",
      }),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  const row = f.app.identity.users(f.actor).find((u) => u.id === actor.id)!;
  f.app.identity.updateUser(f.actor, "demote-commercial", {
    userId: actor.id,
    revision: Number(row.revision),
    name: actor.name,
    email: String(row.email),
    role: "warehouse",
    sites: [f.w1],
    active: true,
    currentPassword: "long-test-only-password",
    reason: "Synthetic authority removal",
  });
  assert.throws(
    () => f.app.procurement.supplierAvailability(actor, "same-attempt", input),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () =>
      f.app.procurement.supplierAvailability(
        { ...actor, role: "admin" },
        "forged",
        input,
      ),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () =>
      f.app.procurement.supplierAvailability(
        { ...f.actor, orgId: "other-org" },
        "foreign",
        input,
      ),
    { code: "FORBIDDEN" },
  );
  const review = f.app.procurement.supplierAvailabilityReview(
    f.actor,
    f.supplier,
  );
  assert.equal(review.changes.length, 1);
  assert.equal(review.changes[0]!.actorId, actor.id);
});

test("supplier availability rolls back a late event failure and retries the same reviewed request once", (t) => {
  const f = fixture(t);
  const input = {
    supplierId: f.supplier,
    revision: 0,
    active: false,
    reason: "Synthetic atomic review",
  };
  f.app.database
    .owned("platform")
    .migrate(
      "CREATE TRIGGER platform_synthetic_supplier_event_failure BEFORE INSERT ON platform_events WHEN NEW.type='supplier.availability.changed' BEGIN SELECT RAISE(ABORT,'synthetic supplier event failure'); END",
    );
  assert.throws(
    () => f.app.procurement.supplierAvailability(f.actor, "late-fault", input),
    /synthetic supplier event failure/,
  );
  assert.deepEqual(
    f.app.procurement.supplierAvailabilityReview(f.actor, f.supplier),
    {
      supplier: {
        id: f.supplier,
        name: "Synthetic supplier",
        active: true,
        revision: 0,
      },
      changes: [],
      next: null,
    },
  );
  f.app.database
    .owned("platform")
    .migrate("DROP TRIGGER platform_synthetic_supplier_event_failure");
  const stopped = f.app.procurement.supplierAvailability(
    f.actor,
    "late-fault",
    input,
  );
  assert.deepEqual(
    f.app.procurement.supplierAvailability(f.actor, "late-fault", input),
    stopped,
  );
  assert.equal(
    f.app.procurement.supplierAvailabilityReview(f.actor, f.supplier).changes
      .length,
    1,
  );
});

test("current fresh-file schema clone retains supplier availability, history and exact retry receipts", async (t) => {
  const f = fixture(t);
  const input = {
    supplierId: f.supplier,
    revision: 0,
    active: false,
    reason: "Synthetic clone review",
  };
  const stopped = f.app.procurement.supplierAvailability(
    f.actor,
    "clone-stop",
    input,
  );
  const source = inspectSchema(f.path);
  const destination = f.path.replace("app.db", "supplier-clone.db");
  await upgradeSchema(f.path, destination, source.schemaHash!, "CA");
  const clone = new Application(destination, "CA");
  try {
    assert.deepEqual(
      clone.procurement.supplierAvailabilityReview(f.actor, f.supplier),
      f.app.procurement.supplierAvailabilityReview(f.actor, f.supplier),
    );
    assert.deepEqual(
      clone.procurement.supplierAvailability(f.actor, "clone-stop", input),
      stopped,
    );
    assert.equal(
      clone.procurement.supplierChoice(f.actor, f.supplier).active,
      false,
    );
    assert.deepEqual(inspectSchema(f.path), source);
  } finally {
    clone.close();
  }
});
