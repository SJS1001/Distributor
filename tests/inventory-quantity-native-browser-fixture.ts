import { pathToFileURL } from "node:url";
import { canonical } from "../src/server/core.ts";
import { createHttp } from "./browser-http.ts";
import type { Region } from "../src/server/iam.ts";
import { fixture } from "./fixtures.ts";

// Isolated synthetic SQLite/native HTTP fixtures. No provider adapter or worker.
// Readonly facts expose only these generated lots, never a generic table proxy.
export const quantityNativeCases = [
  "approval",
  "rejection",
  "lost-prepare",
  "lost-decision",
  "stale",
  "zero",
  "paging",
  "authorization",
  "refresh",
] as const;
export type QuantityNativeCase = (typeof quantityNativeCases)[number];
export async function inventoryQuantityNativeBrowser(
  after: (fn: () => void) => void,
  port = 3331,
  region: Region = "CA",
  currency: "CAD" | "USD" = region === "CA" ? "CAD" : "USD",
) {
  const f = fixture({ after }, {}, region, currency);
  const reviewerUser = f.app.identity.createUser(f.actor, "quantity-reviewer", {
    email: "quantity-native@example.test",
    name: "Synthetic quantity finance",
    role: "finance",
    sites: [f.w1, f.w2],
    password: "long-test-only-password",
  });
  const preparerUser = f.app.identity.createUser(f.actor, "quantity-preparer", {
    email: "quantity-preparer@example.test",
    name: "Synthetic quantity preparer",
    role: "finance",
    sites: [f.w1, f.w2],
    password: "long-test-only-password",
  });
  const reviewer = f.app.identity.currentActor({
    ...f.actor,
    id: reviewerUser.id,
  });
  const inventory = f.app.database.owned("inventory");
  const lots = new Map<
    string,
    {
      unitId: string;
      productId: string;
      sourceId: string;
      original: Record<string, unknown>;
    }
  >();
  for (const name of quantityNativeCases) {
    const productId = f.app.catalog.create(f.actor, `native-product-${name}`, {
      sku: `Q-NATIVE-${name}`,
      name: `Native quantity ${name}`,
      serialized: false,
      unitPrice: 2500,
      taxBasisPoints: 0,
    }).id;
    const poId = f.app.procurement.create(f.actor, `native-po-${name}`, {
      supplierId: f.supplier,
      warehouseId: f.w1,
      lines: [{ productId, quantity: 6, unitCost: 1000 }],
    }).id;
    const line = f.app.procurement.orders(f.actor).find((p) => p.id === poId)!
      .lines[0]!;
    f.app.procurement.receive(f.actor, `native-receipt-${name}`, {
      poId,
      lineId: String(line.id),
      quantity: 6,
      serials: [],
      deliveryRef: `NATIVE-RECEIPT-${name}`,
      bin: `Q-${name}`,
      quarantine: false,
    });
    const unit = f.app.inventory
      .stock(f.actor)
      .find((u) => u.product_id === productId)!;
    f.app.inventory.valuations.configure(f.actor, `native-policy-${name}`, {
      productId,
      previousRevision: 0,
      policyVersion: "native-synthetic-1",
      establishedBasis: "Synthetic accountant-established receipt-layer basis",
      establishedMethod: "fifo-receipt-layers",
      effectiveFrom: "2026-01-01",
      closedThrough: "2026-08-31",
      financeEvidence: "Synthetic established policy and open-period evidence",
    });
    const source = inventory.get<{ id: string }>(
      "SELECT * FROM inventory_movements WHERE org_id=? AND unit_id=? AND type='receipt'",
      f.actor.orgId,
      unit.id,
    )!;
    lots.set(name, {
      unitId: unit.id,
      productId,
      sourceId: source.id,
      original: { ...source },
    });
    if (name === "zero") {
      const r = f.app.inventory.valuations.review(f.actor, unit.id);
      const v = f.app.inventory.valuations.prepare(
        f.actor,
        "native-zero-value",
        {
          unitId: unit.id,
          reviewHash: r.reviewHash,
          reference: "NATIVE-ZERO-VALUE",
          kind: "write-down",
          targetValue: 4001,
          postingDate: "2026-09-15",
          reason: "Synthetic carrying decrease",
          evidence: "Synthetic carrying assessment",
          accountantEvidence: "Synthetic established basis",
        },
      );
      f.app.inventory.valuations.decide(
        reviewer,
        "native-zero-value-decision",
        {
          valuationId: v.id,
          reviewHash: v.reviewHash,
          decision: "approve",
          reason: "Synthetic independent carrying assessment",
        },
      );
    }
    if (name === "paging") {
      for (let n = 0; n < 21; n++) {
        const r = f.app.inventory.quantityCorrections.review(
          f.actor,
          unit.id,
          source.id,
        );
        const p = f.app.inventory.quantityCorrections.prepare(
          f.actor,
          `native-history-${n}`,
          {
            unitId: unit.id,
            sourceMovementId: source.id,
            reviewHash: r.reviewHash,
            reference: `NATIVE-HISTORY-${String(n).padStart(2, "0")}`,
            targetQuantity: 4,
            postingDate: "2026-10-01",
            reason: "Synthetic rejected preparation",
            physicalEvidence: "Synthetic evidence",
            accountantEvidence: "Synthetic classification",
          },
        );
        f.app.inventory.quantityCorrections.decide(
          reviewer,
          `native-history-decision-${n}`,
          {
            correctionId: p.id,
            reviewHash: p.reviewHash,
            decision: "reject",
            reason: "Synthetic independent historical rejection",
          },
        );
      }
    }
  }
  const http = await createHttp(f.app, { origin: `http://127.0.0.1:${port}` });
  http.get<{ Params: { name: string } }>(
    "/__quantity-native/facts/:name",
    async (request) => {
      const lot = lots.get(request.params.name);
      if (!lot) throw Error("Unknown isolated synthetic quantity case");
      const movements = inventory
        .all(
          "SELECT * FROM inventory_movements WHERE org_id=? AND unit_id=? ORDER BY rowid",
          f.actor.orgId,
          lot.unitId,
        )
        .map((row) => ({ ...row }));
      const source = inventory.get(
        "SELECT * FROM inventory_movements WHERE org_id=? AND id=?",
        f.actor.orgId,
        lot.sourceId,
      );
      const records = inventory
        .all<{ record: string }>(
          "SELECT record FROM inventory_quantity_corrections WHERE org_id=? AND unit_id=? ORDER BY rowid",
          f.actor.orgId,
          lot.unitId,
        )
        .map((row) => JSON.parse(row.record));
      const costs = f.app.inventory.costs.window(f.actor, 0);
      return {
        orgId: f.actor.orgId,
        region,
        currency,
        warehouseId: f.w1,
        accountId: f.buyer,
        preparerId: preparerUser.id,
        reviewerId: reviewerUser.id,
        ...lot,
        unit: { ...f.app.inventory.unit(f.actor, lot.unitId) },
        original: lot.original,
        source: source ? { ...source } : null,
        sourcePreserved: canonical(source) === canonical(lot.original),
        movements,
        records,
        carryingValue: f.app.inventory.quantityCorrections.review(
          f.actor,
          lot.unitId,
          lot.sourceId,
        ).carryingValue,
        costs: {
          closingValue: costs.closingValue,
          throughSequence: costs.throughSequence,
          movements: costs.movements.filter((m) => m.unitId === lot.unitId),
        },
      };
    },
  );
  await http.listen({ host: "127.0.0.1", port });
  return http;
}
export async function inventoryQuantityNativeBrowsers(
  after: (fn: () => void) => void,
) {
  const servers: Awaited<ReturnType<typeof inventoryQuantityNativeBrowser>>[] =
    [];
  try {
    servers.push(
      await inventoryQuantityNativeBrowser(after, 3331, "CA", "CAD"),
    );
    servers.push(
      await inventoryQuantityNativeBrowser(after, 3332, "US", "USD"),
    );
    servers.push(
      await inventoryQuantityNativeBrowser(after, 3333, "CA", "USD"),
    );
    return servers;
  } catch (error) {
    for (const server of servers) await server.close();
    throw error;
  }
}
// Dedicated foreground runner; the browser test group uses these same fixtures.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const cleanup: (() => void)[] = [];
  const servers = await inventoryQuantityNativeBrowsers((fn) =>
    cleanup.push(fn),
  );
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    for (const server of servers) await server.close();
    cleanup.forEach((fn) => fn());
  };
  process.on("SIGTERM", () => void stop());
  process.on("SIGINT", () => void stop());
}
