import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";
import {
  hash,
  validateAttempt,
  validateMovements,
  validatePage,
  validateRecord,
  validateReply,
  validateReviewResponse,
  type Scope,
} from "../src/web/inventory-quantity-contract.ts";

// These guards consume real authenticated native HTTP receipts, not browser fixtures.
for (const [region, currency] of [
  ["CA", "CAD"],
  ["US", "USD"],
  ["CA", "USD"],
] as const)
  for (const decision of ["approve", "reject"] as const)
    test(`${region}/${currency} browser quantity guards accept native ${decision} receipts and exact stale preparation replay`, async (t) => {
      const f = fixture(t, {}, region, currency);
      const reviewer = f.app.identity.createUser(f.actor, "quantity-reviewer", {
        email: "quantity-reviewer@example.test",
        name: "Synthetic separate finance",
        password: "long-test-only-password",
        role: "finance",
        sites: [f.w1],
      });
      const productId = f.app.catalog.create(f.actor, "quantity-bulk", {
        sku: "QUANTITY-NATIVE-CONTRACT",
        name: "Synthetic quantity contract bulk",
        serialized: false,
        unitPrice: 2500,
        taxBasisPoints: 0,
      }).id;
      const poId = f.app.procurement.create(f.actor, "quantity-po", {
        supplierId: f.supplier,
        warehouseId: f.w1,
        lines: [{ productId, quantity: 6, unitCost: 1000 }],
      }).id;
      const line = f.app.procurement.orders(f.actor).find((p) => p.id === poId)!
        .lines[0]!;
      f.app.procurement.receive(f.actor, "quantity-receipt", {
        poId,
        lineId: String(line.id),
        quantity: 6,
        serials: [],
        deliveryRef: "SYNTHETIC-CONTRACT",
        bin: "B",
        quarantine: false,
      });
      const unit = f.app.inventory
        .stock(f.actor)
        .find((u) => u.product_id === productId)!;
      f.app.inventory.valuations.configure(f.actor, "quantity-policy", {
        productId,
        previousRevision: 0,
        policyVersion: "synthetic-native-contract-1",
        establishedBasis: "Synthetic established basis",
        establishedMethod: "fifo-receipt-layers",
        effectiveFrom: "2026-01-01",
        closedThrough: "2026-08-31",
        financeEvidence: "Synthetic accountant policy evidence",
      });
      const scope: Scope = {
        orgId: f.actor.orgId,
        unitId: unit.id,
        region,
        currency,
        sites: [f.w1],
      };
      const http = await createHttp(f.app, {
        origin: "http://localhost",
        secureCookies: false,
      });
      t.after(() => http.close());
      const login = async (email: string) => {
        const r = await http.inject({
          method: "POST",
          url: "/api/login",
          headers: { origin: "http://localhost" },
          payload: { email, password: "long-test-only-password" },
        });
        assert.equal(r.statusCode, 200, r.body);
        return {
          origin: "http://localhost",
          cookie: r.headers["set-cookie"]!.toString().split(";")[0]!,
          "x-csrf-token": r.json().csrf,
        };
      };
      const creatorHeaders = await login("admin@example.test"),
        reviewerHeaders = await login("quantity-reviewer@example.test");
      const read = async (url: string) => {
        const r = await http.inject({ url, headers: reviewerHeaders });
        assert.equal(r.statusCode, 200, r.body);
        return r.json();
      };
      const command = async (
        kind: string,
        key: string,
        payload: unknown,
        headers = creatorHeaders,
      ) => {
        const r = await http.inject({
          method: "POST",
          url: `/api/commands/inventory.quantity.${kind}`,
          payload: JSON.stringify(payload),
          headers: {
            ...headers,
            "idempotency-key": key,
            "content-type": "application/json",
          },
        });
        assert.equal(r.statusCode, 200, r.body);
        return r.json();
      };
      const history = validateMovements(
        await read(`/api/stock/history?unitId=${unit.id}`),
        scope,
      );
      const source = history.items.find((m) => m.type === "receipt")!;
      const review = await validateReviewResponse(
        await read(
          `/api/stock/${unit.id}/quantity-review?sourceMovementId=${source.id}`,
        ),
        scope,
      );
      const payload = {
        unitId: unit.id,
        sourceMovementId: source.id,
        reviewHash: review.reviewHash,
        reference: "SYNTHETIC-NATIVE-QUANTITY",
        targetQuantity: 0,
        postingDate: "2026-10-03",
        reason: "Synthetic quantity error",
        physicalEvidence: "Synthetic physical recount",
        accountantEvidence: "Synthetic open-date classification",
      };
      const body = {
        version: 1,
        key: randomUUID(),
        orgId: f.actor.orgId,
        actorId: f.actor.id,
        unitId: unit.id,
        kind: "prepare",
        snapshot: review,
        payload,
      };
      const attempt = await validateAttempt(
        { ...body, fingerprint: await hash(body) },
        f.actor.orgId,
        f.actor.id,
      );
      const prepared = await validateReply(
        await command("prepare", attempt.key, payload),
        attempt,
        scope,
      );
      assert.equal(prepared.state, "ready");
      assert.equal(f.app.inventory.unit(f.actor, unit.id).quantity, 6);
      const decisionBody = {
        version: 1,
        key: randomUUID(),
        orgId: f.actor.orgId,
        actorId: reviewer.id,
        unitId: unit.id,
        kind: "decide",
        snapshot: prepared,
        payload: {
          correctionId: prepared.id,
          reviewHash: prepared.reviewHash,
          decision,
          reason: "Synthetic independent native decision",
        },
      };
      const decisionAttempt = await validateAttempt(
        { ...decisionBody, fingerprint: await hash(decisionBody) },
        f.actor.orgId,
        reviewer.id,
      );
      const decided = await validateReply(
        await command(
          "decide",
          decisionAttempt.key,
          decisionBody.payload,
          reviewerHeaders,
        ),
        decisionAttempt,
        scope,
      );
      assert.equal(
        decided.state,
        decision === "approve" ? "reviewed" : "rejected",
      );
      const actual = await validateRecord(
        await read(`/api/stock/quantity-corrections/${prepared.id}`),
        scope,
      );
      assert.deepEqual(actual, decided);
      const replay = await validateReply(
        await command("prepare", attempt.key, payload),
        attempt,
        scope,
      );
      assert.equal(replay.state, "ready"); // Native idempotency returns the original preparation receipt.
      await validateReply(actual, attempt, scope); // A fresh GET safely preserves its terminal state.
      const page = await validatePage(
        await read(`/api/stock/${unit.id}/quantity-corrections`),
        scope,
      );
      assert.deepEqual(page.items, [decided]);
      const after = validateMovements(
        await read(`/api/stock/history?unitId=${unit.id}`),
        scope,
      );
      assert.deepEqual(
        after.items.find((m) => m.id === source.id),
        source,
      );
      assert.equal(after.unit.cost, 1000);
      assert.equal(after.unit.quantity, decision === "approve" ? 0 : 6);
      assert.equal(
        after.items.filter((m) => m.type === "quantity.correction").length,
        decision === "approve" ? 1 : 0,
      );
      if (decision === "approve") {
        assert.equal(decided.valueDelta, -6000);
        const zeroReview = await validateReviewResponse(
          await read(
            `/api/stock/${unit.id}/quantity-review?sourceMovementId=${decided.movement!.id}`,
          ),
          scope,
        );
        assert.equal(zeroReview.review.unit.quantity, 0);
        assert.equal(zeroReview.review.carryingValue, 0);
        const cost = f.app.inventory.costs
          .window(f.actor, 0)
          .movements.find((m) => m.quantityCorrectionId === decided.id)!;
        assert.equal(cost.accountingDate, payload.postingDate);
        assert.equal(cost.quantity, -6);
      } else {
        assert.equal(decided.movement, null);
        assert.equal(decided.valueDelta, null);
      }
      await assert.rejects(() =>
        validateRecord(decided, { ...scope, orgId: "other-org" }),
      );
      await assert.rejects(() =>
        validateRecord(decided, { ...scope, sites: [] }),
      );
    });
