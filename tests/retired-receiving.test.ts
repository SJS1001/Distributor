import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import type { DraftInput } from "../src/server/receipt-drafts.ts";

// A customer availability flag must not prevent fulfillment of a native PO.
// Wrong SKU, excessive quantity or repeated serials must still refuse atomically.
for (const region of ["CA", "US"] as const)
  for (const serialized of [true, false])
    test(`retired receiving ${region} ${serialized ? "serial" : "bulk"}: persisted scans receive the purchase cost exactly once without restoring customer availability`, (t) => {
      const f = fixture(t, {}, region);
      const product = f.app.catalog.create(f.actor, "receiving-product", {
        sku: "RETIRED-RECEIVE",
        name: "Synthetic discontinued sales item",
        serialized,
        unitPrice: 99900,
        taxBasisPoints: 0,
      }).id;
      const poId = f.app.procurement.create(f.actor, "receiving-po", {
        supplierId: f.supplier,
        warehouseId: f.w1,
        lines: [{ productId: product, quantity: 3, unitCost: 4321 }],
      }).id;
      const lineId = String(
        f.app.procurement.order(f.actor, poId).lines[0]!.id,
      );
      const input = {
        poId,
        lineId,
        deliveryRef: "FIRST-PART",
        observedSku: "RETIRED-RECEIVE",
        quantity: 2,
        serials: serialized ? ["RETIRED-1"] : [],
        bin: "R-1",
        quarantine: true,
        draftId: null,
        revision: 0,
      };
      const saved = f.app.procurement.drafts.save(
        f.actor,
        "before-retire",
        input,
      );
      f.app.catalog.retire(f.actor, "retire-receiving", {
        productId: product,
        expectedHash: f.app.catalog.lifecycleReview(f.actor, product)
          .expectedHash,
        reason: "Synthetic customer-ordering withdrawal",
      });
      f.app.close();
      f.app = new Application(f.path, region);
      const inventoryBefore = f.app.inventory.stock(f.actor);
      const rejected: [Partial<DraftInput>, string][] = [
        [{ observedSku: "WRONG" }, "SKU"],
        [{ quantity: 4 }, "OVER_RECEIPT"],
      ];
      if (serialized)
        rejected.push(
          [{ serials: ["S1"] }, "DUPLICATE_SERIAL"],
          [{ serials: ["X", "X"] }, "SERIAL"],
        );
      else rejected.push([{ serials: ["X"] }, "SERIAL"]);
      for (const [changes, code] of rejected) {
        assert.throws(
          () =>
            f.app.procurement.drafts.save(f.actor, `refuse-${code}`, {
              ...input,
              draftId: saved.id,
              revision: 1,
              ...changes,
            }),
          { code },
        );
      }
      assert.deepEqual(f.app.inventory.stock(f.actor), inventoryBefore);
      assert.equal(
        f.app.procurement.drafts.list(f.actor).find((d) => d.id === saved.id)!
          .revision,
        1,
      );
      const edited = f.app.procurement.drafts.save(
        f.actor,
        "complete-retired-scans",
        {
          ...input,
          draftId: saved.id,
          revision: 1,
          serials: serialized ? ["RETIRED-1", "RETIRED-2"] : [],
        },
      );
      assert.deepEqual(f.app.inventory.stock(f.actor), inventoryBefore);
      const confirmation = { draftId: saved.id, revision: edited.revision };
      const first = f.app.procurement.drafts.confirm(
        f.actor,
        "receive-retired",
        confirmation,
      );
      assert.deepEqual(
        f.app.procurement.drafts.confirm(
          f.actor,
          "receive-retired",
          confirmation,
        ),
        first,
      );
      assert.deepEqual(
        f.app.procurement.drafts.confirm(
          f.actor,
          "recover-retired",
          confirmation,
        ),
        first,
      );
      const secondDraft = f.app.procurement.drafts.save(
        f.actor,
        "new-retired-draft",
        {
          ...input,
          deliveryRef: "SECOND-PART",
          quantity: 1,
          serials: serialized ? ["RETIRED-3"] : [],
        },
      );
      const second = f.app.procurement.drafts.confirm(
        f.actor,
        "receive-second",
        {
          draftId: secondDraft.id,
          revision: 1,
        },
      );
      const units = [...first.unitIds, ...second.unitIds].map((id) =>
        f.app.inventory.unit(f.actor, id),
      );
      assert.equal(
        units.reduce((n, unit) => n + unit.quantity, 0),
        3,
      );
      assert.equal(
        units.reduce((n, unit) => n + unit.quantity * unit.cost, 0),
        12963,
      );
      assert.ok(
        units.every(
          (unit) =>
            unit.cost === 4321 &&
            unit.condition === "quarantine" &&
            unit.warehouse_id === f.w1,
        ),
      );
      assert.deepEqual(
        units.map((unit) => unit.serial),
        serialized ? ["RETIRED-1", "RETIRED-2", "RETIRED-3"] : [null, null],
      );
      const order = f.app.procurement.order(f.actor, poId);
      assert.equal(order.state, "received");
      assert.equal(order.lines[0]!.received, 3);
      assert.equal(
        f.app.procurement.receipts(f.actor).filter((r) => r.po_id === poId)
          .length,
        2,
      );
      assert.deepEqual(
        f.app.procurement.drafts
          .history(f.actor, saved.id)
          .map((v) => [v.revision, v.state]),
        [
          [1, "draft"],
          [2, "draft"],
          [3, "received"],
        ],
      );
      assert.equal(f.app.catalog.product(f.actor, product).active, 0);
      assert.ok(
        !f.app.catalog
          .customerProductPage(f.actor, f.buyer)
          .items.some((p) => p.id === product),
      );
      assert.equal(f.app.billing.invoices(f.actor).length, 0);
      assert.equal(f.app.orders.list(f.actor).length, 0);
    });
