import type { Application } from "../server/application.ts";
import { check, permit, type Actor } from "../server/core.ts";

/** Family names: https://greehvac.ca/shop/. SKUs, prices and stock are fictional.
 * These are illustrative catalog entries, not manufacturer part numbers or
 * engineered matches. Run only on an offline copy; each native command commits.
 */
export const greeSampleProducts = [
  {
    sku: "SAMPLE-GREE-CHARMO",
    name: "Gree Charmo R32 · single-zone heat pump · SAMPLE",
    price: 149500,
    cost: 95000,
    quantity: 10,
  },
  {
    sku: "SAMPLE-GREE-PULAR",
    name: "Gree Pular R32 · single-zone heat pump · SAMPLE",
    price: 189500,
    cost: 125000,
    quantity: 6,
  },
  {
    sku: "SAMPLE-GREE-AIRY",
    name: "Gree Airy R32 · single-zone heat pump · SAMPLE",
    price: 249500,
    cost: 165000,
    quantity: 5,
  },
  {
    sku: "SAMPLE-GREE-ZENO",
    name: "Gree ZENO R32 · single-zone heat pump · SAMPLE",
    price: 279500,
    cost: 185000,
    quantity: 4,
  },
  {
    sku: "SAMPLE-GREE-MULTI",
    name: "Gree Multi Zone R32 · heat pump · SAMPLE",
    price: 349500,
    cost: 230000,
    quantity: 4,
  },
  {
    sku: "SAMPLE-GREE-FLEXX-ECO",
    name: "Gree FLEXX Eco R32 · central heat pump · SAMPLE",
    price: 429500,
    cost: 285000,
    quantity: 4,
  },
  {
    sku: "SAMPLE-GREE-FLEXX-ULTRA",
    name: "Gree FLEXX Ultra R32 · central heat pump · SAMPLE",
    price: 549500,
    cost: 365000,
    quantity: 3,
  },
  {
    sku: "SAMPLE-GREE-CASSETTE",
    name: "Gree ceiling cassette · indoor equipment · SAMPLE",
    price: 119500,
    cost: 75000,
    quantity: 6,
  },
  {
    sku: "SAMPLE-LINESET",
    name: "HVAC line-set kit · generic accessory · SAMPLE",
    price: 18500,
    cost: 9500,
    quantity: 80,
    bulk: true,
  },
  {
    sku: "SAMPLE-BRACKET",
    name: "Outdoor mounting bracket · generic accessory · SAMPLE",
    price: 9500,
    cost: 4500,
    quantity: 40,
    bulk: true,
  },
  {
    sku: "SAMPLE-CONDENSATE",
    name: "Condensate drain kit · generic accessory · SAMPLE",
    price: 4500,
    cost: 1800,
    quantity: 60,
    bulk: true,
  },
] as const;

/** Official family pages verified in docs/catalog/gree-source-library.json.
 * These references are not exact-model manuals or redistributed binaries.
 */
export const greeFamilyReferencePages = [
  "charmo-r32",
  "pular-r32",
  "airy-r32",
  "zeno-r32",
  "multi-zone-r32",
  "flexx-eco-r32",
  "flexx-ultra-r32",
  "8-way-cassette-indoor-unit-r32",
] as const;

/** Explicit optional step after seedGreePilot on an offline pilot copy. */
export async function seedGreeFamilyReferences(
  app: Application,
  actor: Actor,
  products: readonly string[] | { productIds: readonly string[] },
) {
  const productIds = "productIds" in products ? products.productIds : products;
  actor = app.identity.currentActor(actor);
  permit(actor, []);
  check(
    app.identity.region === "CA" &&
      productIds.length === greeSampleProducts.length &&
      productIds.every(
        (id, index) =>
          app.catalog.product(actor, id).sku === greeSampleProducts[index]!.sku,
      ),
    "SAMPLE_PRODUCTS",
    "Family references require the matching fictional Canadian pilot products.",
  );
  const resources = [];
  for (const [index, page] of greeFamilyReferencePages.entries()) {
    const sample = greeSampleProducts[index]!;
    const productId = productIds[index]!;
    const key = `gree-family-reference-v1-${sample.sku}`;
    const draft = await app.catalogMedia.upload(
      actor,
      `${key}-upload`,
      productId,
      {
        kind: "literature",
        title: `${sample.name.split(" · ")[0]} manufacturer family reference`,
        models:
          "Family reference only; fictional sample SKU, exact model/capacity/voltage not verified.",
        revision: "Family page researched 2026-10-05",
        source:
          "Public Gree Canada family page; docs/catalog/gree-source-library.json. Manuals and images remain on the publisher site; no binary redistribution.",
        externalUrl: `https://greehvac.ca/heacool_services/${page}/`,
      },
    );
    resources.push(
      await app.catalogMedia.publish(
        actor,
        `${key}-publish`,
        productId,
        draft.id,
        {
          expectedVersion: draft.version,
          permissionAffirmed: true,
          permissionBasis:
            "Public manufacturer family-page link only; no image or manual binary redistribution. Exact model applicability requires review.",
        },
      ),
    );
  }
  return resources;
}

export function seedGreePilot(
  app: Application,
  actor: Actor,
  access: {
    buyerEmail: string;
    buyerPassword: string;
    currentPassword: string;
  },
) {
  actor = app.identity.currentActor(actor);
  permit(actor, []);
  check(
    app.identity.region === "CA" &&
      app.identity.organization(actor).currency === "CAD",
    "SAMPLE_REGION",
    "This sample requires CA/CAD.",
  );
  check(
    app.catalog.productPage(actor, undefined, "", "all").items.length === 0 &&
      app.identity.customers(actor).length === 0 &&
      app.inventory.warehouses(actor).length === 0,
    "SAMPLE_NOT_EMPTY",
    "Seed only an empty pilot copy. Never rerun over existing business records.",
  );
  const key = (value: string) => `gree-pilot-v1-${value}`;
  const warehouseId = app.inventory.createWarehouse(actor, key("toronto"), {
    name: "Toronto HVAC · SAMPLE",
  }).id;
  const branchId = app.inventory.createWarehouse(actor, key("ottawa"), {
    name: "Ottawa HVAC · SAMPLE",
  }).id;
  const customers = [
    "Maple Leaf Heating",
    "Lakeside Mechanical",
    "Capital Comfort HVAC",
  ].map(
    (name, i) =>
      app.identity.createCustomer(actor, key(`customer-${i}`), {
        name: `${name} · FICTIONAL SAMPLE`,
        tier: "sample-contractor",
        creditLimit: 10000000,
      }).id,
  );
  for (const accountId of customers)
    app.catalog.setPurchasingPolicy(actor, key(`purchasing-${accountId}`), {
      accountId,
      mode: "all",
      requiresReview: false,
      productIds: [],
      revision: 0,
      reason: "Owner-authorized fictional Gree sample catalog access",
    });
  const supplierId = app.procurement.supplier(actor, key("supplier"), {
    name: "Training HVAC Supply · FICTIONAL SAMPLE",
  }).id;
  const purchase = (
    suffix: string,
    productId: string,
    quantity: number,
    unitCost: number,
  ) => {
    const po = app.procurement.create(actor, key(suffix), {
      supplierId,
      warehouseId,
      lines: [{ productId, quantity, unitCost }],
    });
    const line = app.procurement.orders(actor).find((row) => row.id === po.id)!
      .lines[0]!;
    return { poId: po.id, lineId: String(line.id) };
  };
  const products = greeSampleProducts.map((sample, index) => {
    const serialized = !("bulk" in sample);
    const product = app.catalog.create(actor, key(`product-${index}`), {
      sku: sample.sku,
      name: sample.name,
      serialized,
      unitPrice: sample.price,
      taxBasisPoints: 1300,
    });
    app.catalog.setPrice(actor, key(`price-${index}`), {
      productId: product.id,
      tier: "sample-contractor",
      unitPrice: Math.round(sample.price * 0.9),
    });
    const po = purchase(
      `stock-${index}`,
      product.id,
      sample.quantity,
      sample.cost,
    );
    app.procurement.receive(actor, key(`receipt-${index}`), {
      ...po,
      deliveryRef: `SAMPLE-DELIVERY-${index + 1}`,
      quantity: sample.quantity,
      serials: serialized
        ? Array.from(
            { length: sample.quantity },
            (_, i) => `${sample.sku}-${String(i + 1).padStart(3, "0")}`,
          )
        : [],
      bin: serialized
        ? `HP-${String(index + 1).padStart(2, "0")}`
        : "ACCESSORIES-01",
      quarantine: false,
    });
    return product.id;
  });
  const order = (
    suffix: string,
    accountId: string,
    lines: { productId: string; quantity: number }[],
  ) => {
    const current = app.orders
      .carts(actor)
      .find((cart) => cart.account_id === accountId);
    const cart = app.orders.saveCart(actor, key(`${suffix}-cart`), {
      accountId,
      warehouseId,
      revision: Number(current?.revision ?? 0),
      lines,
    });
    const quote = app.orders.quote(actor, key(`${suffix}-quote`), {
      cartId: cart.id,
      revision: cart.revision,
    });
    return app.orders.accept(actor, key(suffix), {
      quoteId: quote.id,
      allowBackorder: true,
    });
  };
  const supplied = order("supplied", customers[0]!, [
    { productId: products[0]!, quantity: 2 },
  ]);
  const picks = app.fulfillment.picks(actor, supplied.id);
  for (const pick of picks)
    app.fulfillment.pick(actor, key(`pick-${pick.id}`), {
      orderId: supplied.id,
      allocationId: pick.id,
      serial: pick.serial,
    });
  const pack = app.fulfillment.pack(actor, key("pack"), {
    orderId: supplied.id,
    revision: app.orders.order(actor, supplied.id).revision,
    mode: "collection",
    address: "SAMPLE collection counter — no actual delivery",
    lines: picks.map((pick) => ({
      allocationId: pick.id,
      quantity: pick.quantity,
    })),
  });
  const shipment = app.fulfillment.commit(actor, key("collection"), {
    shipmentId: pack.id,
    handoverEvidence: "FICTIONAL SAMPLE handover; no real goods moved",
  });
  app.billing.manualPayment(actor, key("payment"), {
    invoiceId: shipment.invoiceId,
    amount: 100000,
    reference: "SAMPLE-PAYMENT-001",
    reason: "FICTIONAL SAMPLE payment; no funds received",
  });
  const open = order("backorder", customers[0]!, [
    { productId: products[0]!, quantity: 14 },
    { productId: products[8]!, quantity: 5 },
  ]);
  const incoming = purchase(
    "incoming",
    products[0]!,
    12,
    greeSampleProducts[0].cost,
  );
  const review = app.orders.incomingSupply(actor, open.id);
  app.orders.commitIncoming(actor, key("incoming-allocation"), {
    orderId: open.id,
    lineId: review.lines.find((line) => line.productId === products[0])!.lineId,
    revision: review.revision,
    poId: incoming.poId,
    purchaseLineId: incoming.lineId,
    quantity: 6,
    priority: 10,
    reason: "FICTIONAL SAMPLE contractor installation commitment",
  });
  app.procurement.receive(actor, key("incoming-quarantine"), {
    ...incoming,
    deliveryRef: "SAMPLE-INCOMING-PARTIAL",
    quantity: 2,
    serials: ["SAMPLE-INCOMING-001", "SAMPLE-INCOMING-002"],
    bin: "INSPECTION",
    quarantine: true,
  });
  const second = order("central-install", customers[1]!, [
    { productId: products[5]!, quantity: 2 },
    { productId: products[9]!, quantity: 2 },
  ]);
  const third = order("ductless-install", customers[2]!, [
    { productId: products[1]!, quantity: 2 },
    { productId: products[8]!, quantity: 2 },
    { productId: products[10]!, quantity: 2 },
  ]);
  const buyer = app.identity.createUser(actor, key("buyer"), {
    email: access.buyerEmail,
    name: "Sample HVAC contractor",
    password: access.buyerPassword,
    currentPassword: access.currentPassword,
    role: "buyer",
    accountId: customers[0]!,
    sites: [warehouseId, branchId],
    requirePasswordChange: true,
  });
  return {
    productIds: products,
    customerIds: customers,
    warehouseId,
    branchId,
    buyerId: buyer.id,
    orderIds: [supplied.id, open.id, second.id, third.id],
    incomingPoId: incoming.poId,
    invoiceId: shipment.invoiceId,
  };
}
