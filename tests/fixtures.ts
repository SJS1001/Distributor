import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "../src/server/application.ts";
import type { Actor } from "../src/server/core.ts";
import type { Region } from "../src/server/iam.ts";
import { providerNames } from "../src/shared/provider-choices.ts";
import type { DisclosureInput } from "../src/server/iam-residency.ts";

export function syntheticDisclosure(
  app: Application,
  provider: DisclosureInput["provider"],
  previousDisclosureId: string | null = null,
  version = "synthetic-v1",
): DisclosureInput {
  return {
    provider,
    region: app.identity.region,
    previousDisclosureId,
    version,
    purposes: "Synthetic test processing only; no vendor qualification",
    minimumData: [
      "Synthetic customer identifier",
      "Synthetic transaction total",
    ],
    processingCountries: ["US", "CA"],
    subprocessors: ["Synthetic processor"],
    retention: "Synthetic fixture retained only during this test",
    withdrawal:
      "Future processing stops; in-flight or previously transmitted data cannot be recalled",
    termsReference: "synthetic:test-only-terms",
    reviewEvidence:
      "Synthetic fixture qualification; not actual vendor evidence",
  };
}
export function seedDisclosures(app: Application, actor: Actor) {
  for (const provider of providerNames)
    app.identity.residency.publish(
      actor,
      `synthetic-disclosure-${provider}`,
      syntheticDisclosure(app, provider),
    );
}
type ChoiceInput = Parameters<Application["identity"]["residencyChoice"]>[2];
export function reviewedChoiceInput(
  app: Application,
  actor: Actor,
  input: ChoiceInput,
): ChoiceInput {
  if (!input.providers.length) return input;
  const current = app.identity.currentActor(actor),
    offers = app.identity.residency.current(current);
  return {
    ...input,
    acceptance: {
      basis: current.role === "buyer" ? "buyer" : "recorded",
      ...(current.role === "buyer"
        ? {}
        : {
            representative: "Synthetic customer representative",
            evidenceRef: "synthetic:explicit-customer-acceptance",
          }),
      disclosures: input.providers.map((provider) => ({
        provider: provider as DisclosureInput["provider"],
        disclosureId:
          offers.find((d) => d.provider === provider)?.id ??
          "synthetic-invalid-disclosure",
      })),
    },
  };
}
export function chooseProviders(
  f: { app: Application },
  actor: Actor,
  key: string,
  input: ChoiceInput,
) {
  return f.app.identity.residencyChoice(
    actor,
    key,
    reviewedChoiceInput(f.app, actor, input),
  );
}
export function fixture(
  t: { after: (fn: () => void) => void },
  security: {
    mfaEncryptionKey?: string;
    providerEncryptionKey?: string;
    eventReports?: boolean;
  } = {},
  region: Region = "CA",
) {
  const directory = mkdtempSync(join(tmpdir(), "distributor-"));
  const path = join(directory, "app.db");
  const app = new Application(path, region, security);
  let current: { app: Application } = { app };
  t.after(() => {
    current.app.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const actor = app.identity.bootstrap(
    "Synthetic Distributor",
    "admin@example.test",
    "long-test-only-password",
    region === "CA" ? "CAD" : "USD",
  );
  seedDisclosures(app, actor);
  const w1 = app.inventory.createWarehouse(actor, "w1", { name: "Toronto" }).id,
    w2 = app.inventory.createWarehouse(actor, "w2", { name: "Ottawa" }).id;
  const buyer = app.identity.createCustomer(actor, "buyer", {
    name: "Synthetic buyer",
    tier: "standard",
    creditLimit: 1000000,
  }).id;
  const product = app.catalog.create(actor, "sku", {
    sku: "EQ-1",
    name: "Synthetic equipment",
    serialized: true,
    unitPrice: 10000,
    taxBasisPoints: 1300,
  }).id;
  const supplier = app.procurement.supplier(actor, "supplier", {
    name: "Synthetic supplier",
  }).id;
  const po = app.procurement.create(actor, "po", {
    supplierId: supplier,
    warehouseId: w1,
    lines: [{ productId: product, quantity: 3, unitCost: 6000 }],
  }).id;
  const line = app.procurement.orders(actor).find((p) => p.id === po)!
    .lines[0]!;
  app.procurement.receive(actor, "receive", {
    poId: po,
    lineId: String(line.id),
    deliveryRef: "DEL-1",
    quantity: 3,
    serials: ["S1", "S2", "S3"],
    bin: "A-1",
    quarantine: false,
  });
  const result = { app, path, actor, w1, w2, buyer, product, supplier, po };
  current = result;
  return result;
}
export function accept(f: ReturnType<typeof fixture>, qty = 1, key = "order") {
  const c = f.app.orders.saveCart(f.actor, key + "cart", {
    accountId: f.buyer,
    warehouseId: f.w1,
    revision:
      (f.app.orders.carts(f.actor).find((c) => c.account_id === f.buyer)
        ?.revision as number) ?? 0,
    lines: [{ productId: f.product, quantity: qty }],
  });
  const quote = f.app.orders.quote(f.actor, key + "quote", {
    cartId: c.id,
    revision: c.revision,
  });
  return f.app.orders.accept(f.actor, key, {
    quoteId: quote.id,
    allowBackorder: false,
  });
}
export function ship(f: ReturnType<typeof fixture>, orderId: string) {
  const picks = f.app.fulfillment.picks(f.actor, orderId);
  for (const a of picks)
    f.app.fulfillment.pick(f.actor, "pick" + a.id, {
      orderId,
      allocationId: a.id,
      serial: a.serial,
    });
  const order = f.app.orders.order(f.actor, orderId);
  const packed = f.app.fulfillment.pack(f.actor, "pack" + orderId, {
    orderId,
    revision: order.revision,
    mode: "collection",
    address: "Synthetic counter",
    lines: picks.map((a) => ({ allocationId: a.id, quantity: a.quantity })),
  });
  return f.app.fulfillment.commit(f.actor, "ship" + orderId, {
    shipmentId: packed.id,
    handoverEvidence: "Synthetic test handover",
  });
}
