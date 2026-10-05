import { randomBytes } from "node:crypto";
import type { Application } from "../server/application.ts";
import { carrierNames } from "../shared/carrier-booking.ts";
import type { Role } from "../server/core.ts";

/** Fictional data created exclusively through the unchanged native operations. */
export async function seedNativeDemo(
  app: Application,
  options: { companyName: string; region: "CA" | "US" },
) {
  const accounts: { role: string; email: string; password: string }[] = [];
  const password = () => randomBytes(24).toString("base64url");
  const admin = {
    role: "admin",
    email: "admin@example.test",
    password: password(),
  };
  accounts.push(admin);
  const actor = app.identity.bootstrap(
    options.companyName,
    admin.email,
    admin.password,
    options.region === "CA" ? "CAD" : "USD",
  );
  const w1 = app.inventory.createWarehouse(actor, "demo-warehouse-main", {
    name: options.region === "CA" ? "Toronto · demo" : "Buffalo · demo",
  }).id;
  const w2 = app.inventory.createWarehouse(actor, "demo-warehouse-branch", {
    name: options.region === "CA" ? "Ottawa · demo" : "Rochester · demo",
  }).id;
  const customer = app.identity.createCustomer(actor, "demo-customer-main", {
    name: "Maple Workshop · fictional",
    tier: "standard",
    creditLimit: 100000000,
  }).id;
  const otherCustomer = app.identity.createCustomer(
    actor,
    "demo-customer-other",
    {
      name: "Lakeside Maintenance · fictional",
      tier: "standard",
      creditLimit: 100000000,
    },
  ).id;
  for (const accountId of [customer, otherCustomer])
    app.catalog.setPurchasingPolicy(actor, `demo-purchasing-${accountId}`, {
      accountId,
      mode: "all",
      requiresReview: false,
      productIds: [],
      revision: 0,
      reason: "Fictional demo approved catalog access",
    });
  const demoProviders = ["stripe", "quickbooks", ...carrierNames] as const;
  const disclosures = demoProviders.map((provider) => {
    const disclosure = app.identity.residency.publish(
      actor,
      `demo-${provider}-disclosure`,
      {
        provider,
        region: options.region,
        previousDisclosureId: null,
        version: "fictional-demo-v1",
        purposes:
          "Fictional payment, accounting and shipping simulation; no external processing",
        minimumData: [
          "Fictional invoice amount",
          "Fictional transaction identifier",
          "Fictional shipping address and parcel",
        ],
        processingCountries: ["US", "CA"],
        subprocessors: ["Fictional demo processor"],
        retention: "Erased when this temporary workspace is reset or expires",
        withdrawal:
          "Future simulated processing stops when the customer withdraws permission",
        termsReference: "demo:fictional-terms-not-vendor-qualification",
        reviewEvidence:
          "Fictional acceptance for demonstration only; no actual residency evidence",
      },
    );
    return { provider, disclosureId: disclosure.id };
  });
  app.identity.residencyChoice(actor, "demo-provider-choice", {
    accountId: customer,
    region: options.region,
    mode: "provider-exceptions",
    providers: [...demoProviders],
    version: 1,
    acknowledgment:
      "Fictional customer permits simulated payments, accounting and shipping only",
    acceptance: {
      basis: "recorded",
      representative: "Fictional customer representative",
      evidenceRef: "demo:fictional-customer-acceptance",
      disclosures,
    },
  });
  for (const role of [
    "commercial",
    "warehouse",
    "finance",
    "warranty",
    "buyer",
    "support",
  ] as Role[]) {
    const user = { role, email: `${role}@example.test`, password: password() };
    app.identity.createUser(actor, `demo-user-${role}`, {
      ...user,
      name: `${role} · demo`,
      sites: [w1, w2],
      ...(role === "buyer" ? { accountId: customer } : {}),
      requirePasswordChange: false,
    });
    accounts.push(user);
  }
  const reviewer = {
    role: "finance reviewer",
    email: "reviewer@example.test",
    password: password(),
  };
  app.identity.createUser(actor, "demo-user-reviewer", {
    ...reviewer,
    role: "finance",
    name: "Independent reviewer · demo",
    sites: [w1, w2],
    requirePasswordChange: false,
  });
  accounts.push(reviewer);
  const supplier = app.procurement.supplier(actor, "demo-supplier", {
    name: "Northern Supply · fictional",
  }).id;
  const serialized = app.catalog.create(actor, "demo-equipment", {
    sku: "DEMO-DRILL",
    name: "Workshop drill · demo",
    serialized: true,
    unitPrice: 24900,
    taxBasisPoints: options.region === "CA" ? 1300 : 800,
  }).id;
  const bulk = app.catalog.create(actor, "demo-bulk", {
    sku: "DEMO-BITS",
    name: "Replacement bit kit · demo",
    serialized: false,
    unitPrice: 3500,
    taxBasisPoints: options.region === "CA" ? 1300 : 800,
  }).id;
  const newPurchase = (
    key: string,
    productId: string,
    quantity: number,
    unitCost: number,
  ) => {
    const result = app.procurement.create(actor, key, {
      supplierId: supplier,
      warehouseId: w1,
      lines: [{ productId, quantity, unitCost }],
    });
    const line = app.procurement.orders(actor).find((p) => p.id === result.id)!
      .lines[0]!;
    return { poId: result.id, lineId: String(line.id) };
  };
  const initialSerials = newPurchase(
    "demo-stock-equipment",
    serialized,
    10,
    15000,
  );
  app.procurement.receive(actor, "demo-stock-equipment-receipt", {
    ...initialSerials,
    deliveryRef: "DEMO-DELIVERY-EQUIPMENT",
    quantity: 10,
    serials: Array.from(
      { length: 10 },
      (_, i) => `DEMO-DRILL-${String(i + 1).padStart(3, "0")}`,
    ),
    bin: "A-01",
    quarantine: false,
  });
  const initialBulk = newPurchase("demo-stock-bulk", bulk, 80, 1700);
  app.procurement.receive(actor, "demo-stock-bulk-receipt", {
    ...initialBulk,
    deliveryRef: "DEMO-DELIVERY-BITS",
    quantity: 80,
    serials: [],
    bin: "B-01",
    quarantine: false,
  });
  const accept = (
    key: string,
    lines: { productId: string; quantity: number }[],
    accountId = customer,
  ) => {
    const current = app.orders
      .carts(actor)
      .find((c) => c.account_id === accountId);
    const cart = app.orders.saveCart(actor, `${key}-cart`, {
      accountId,
      warehouseId: w1,
      revision: Number(current?.revision ?? 0),
      lines,
    });
    const quote = app.orders.quote(actor, `${key}-quote`, {
      cartId: cart.id,
      revision: cart.revision,
    });
    return app.orders.accept(actor, key, {
      quoteId: quote.id,
      allowBackorder: true,
    });
  };
  const sold = accept("demo-supplied-order", [
    { productId: serialized, quantity: 2 },
  ]);
  const picks = app.fulfillment.picks(actor, sold.id);
  for (const allocation of picks)
    app.fulfillment.pick(actor, `demo-pick-${allocation.id}`, {
      orderId: sold.id,
      allocationId: allocation.id,
      serial: allocation.serial,
    });
  const packed = app.fulfillment.pack(actor, "demo-pack-supplied", {
    orderId: sold.id,
    revision: app.orders.order(actor, sold.id).revision,
    mode: "collection",
    address: "Fictional demo collection counter",
    lines: picks.map((a) => ({ allocationId: a.id, quantity: a.quantity })),
  });
  const shipped = app.fulfillment.commit(actor, "demo-handover-supplied", {
    shipmentId: packed.id,
    handoverEvidence: "Synthetic demo collection, no real shipment",
  });
  app.billing.manualPayment(actor, "demo-partial-payment", {
    invoiceId: shipped.invoiceId,
    amount: 10000,
    reference: "DEMO-PAYMENT-001",
    reason: "Fictional partial payment, no money moved",
  });
  const soldUnit = app.inventory
    .stock(actor)
    .find((unit) => unit.serial === picks[0]!.serial)!;
  const claim = app.warranty.submit(actor, "demo-return-request", {
    accountId: customer,
    unitId: soldUnit.id,
    type: "return",
    issue: "Fictional customer requests return of unopened drill",
    evidence: "demo:fictional-return-request",
  });
  const open = accept("demo-open-order", [
    { productId: serialized, quantity: 14 },
    { productId: bulk, quantity: 5 },
  ]);
  const incoming = newPurchase(
    "demo-incoming-equipment",
    serialized,
    12,
    15000,
  );
  const review = app.orders.incomingSupply(actor, open.id);
  app.orders.commitIncoming(actor, "demo-incoming-assignment", {
    orderId: open.id,
    lineId: review.lines.find((line) => line.productId === serialized)!.lineId,
    revision: review.revision,
    poId: incoming.poId,
    purchaseLineId: incoming.lineId,
    quantity: 6,
    priority: 10,
    reason: "Fictional customer delivery commitment",
  });
  app.procurement.receive(actor, "demo-incoming-quarantine", {
    ...incoming,
    deliveryRef: "DEMO-PARTIAL-INCOMING",
    quantity: 2,
    serials: ["DEMO-INCOMING-001", "DEMO-INCOMING-002"],
    bin: "INSPECTION",
    quarantine: true,
  });
  const otherOrder = accept(
    "demo-other-order",
    [{ productId: bulk, quantity: 8 }],
    otherCustomer,
  );
  const bulkUnit = app.inventory
    .stock(actor)
    .find((unit) => unit.product_id === bulk && unit.state === "stock")!;
  const transfer = app.inventory.dispatchTransfer(actor, "demo-transfer", {
    destinationId: w2,
    unitId: bulkUnit.id,
    quantity: 10,
    revision: bulkUnit.revision,
    reason: "Fictional branch replenishment",
  });
  const counted = app.inventory.unit(actor, bulkUnit.id);
  const count = app.inventory.startCount(actor, "demo-count", {
    unitId: counted.id,
    revision: counted.revision,
    countRef: "DEMO-COUNT-001",
  });
  app.inventory.submitCount(actor, "demo-count-observation", {
    countId: count.id,
    quantity: counted.quantity - 1,
    reason: "Fictional count discrepancy for independent review",
  });
  return {
    accounts,
    organizationId: actor.orgId,
    actor,
    scenarios: {
      openOrderId: open.id,
      otherOrderId: otherOrder.id,
      incomingPoId: incoming.poId,
      invoiceId: shipped.invoiceId,
      claimId: claim.id,
      transferId: transfer.id,
      countId: count.id,
    },
    note: "All names, quantities, tax examples and transactions are fictional. Regional selection configures demo business rules; it does not establish hosting residency.",
  };
}
