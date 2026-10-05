import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Application } from "../src/server/application.ts";
import type { Actor } from "../src/server/core.ts";
import type { Region } from "../src/server/iam.ts";

export type RehearsalConfig = {
  catalogProducts: number;
  unitsPerProductPerWarehouse: number;
  writers: number;
  ordersPerWriter: number;
  readClients: number;
  readsPerClient: number;
  deadlineMs: number;
};
export const defaultRehearsal: RehearsalConfig = {
  catalogProducts: 20,
  unitsPerProductPerWarehouse: 20,
  writers: 4,
  ordersPerWriter: 20,
  readClients: 4,
  readsPerClient: 60,
  deadlineMs: 180000,
};
// Deliberate local resource caps. These are not approved production targets.
export function rehearsalConfig(input: unknown): RehearsalConfig {
  assert(input && typeof input === "object" && !Array.isArray(input));
  const limits = {
    catalogProducts: [2, 1000],
    unitsPerProductPerWarehouse: [2, 500],
    writers: [2, 16],
    ordersPerWriter: [2, 1000],
    readClients: [1, 32],
    readsPerClient: [3, 10000],
    deadlineMs: [10000, 900000],
  } as const;
  const values = { ...defaultRehearsal, ...input };
  assert(
    Object.keys(input).every((key) => Object.hasOwn(limits, key)),
    "Unknown workload field",
  );
  for (const [key, [minimum, maximum]] of Object.entries(limits)) {
    const value = values[key as keyof RehearsalConfig];
    assert(
      Number.isSafeInteger(value) && value >= minimum && value <= maximum,
      `Invalid ${key}`,
    );
  }
  assert(
    values.catalogProducts * values.unitsPerProductPerWarehouse * 2 <= 100000,
    "At most 100000 synthetic units per region",
  );
  // Calculate actual SKU/site demand, including one pending order at the cutoff.
  const demand = new Map<string, number>();
  for (let writer = 0; writer < values.writers; writer++)
    for (let order = 0; order < values.ordersPerWriter; order++) {
      const product =
        (writer * values.ordersPerWriter + order) % values.catalogProducts;
      const key = `${product}:${writer % 2}`;
      demand.set(key, (demand.get(key) ?? 0) + 1);
    }
  demand.set("0:0", (demand.get("0:0") ?? 0) + 1);
  assert(
    [...demand.values()].every(
      (quantity) => quantity <= values.unitsPerProductPerWarehouse,
    ),
    "Synthetic stock must cover the workload and pending order",
  );
  return values;
}
export type Seed = {
  actor: Actor;
  warehouses: string[];
  products: {
    id: string;
    index: number;
    price: number;
    cost: number;
    tax: number;
    serialized: boolean;
  }[];
  customers: string[];
  readers: { email: string; password: string }[];
  serials: string[];
  pending: { id: string; productIndex: number; warehouseIndex: number };
};
export type Sale = {
  id: string;
  invoiceId: string;
  productIndex: number;
  warehouseIndex: number;
  key: string;
  shipmentId: string;
};

export function seedRehearsal(
  app: Application,
  config: RehearsalConfig,
  checkDeadline: () => void = () => {},
): Seed {
  const password = randomBytes(32).toString("hex"),
    actor = app.identity.bootstrap(
      "Synthetic load rehearsal",
      "rehearsal-admin@example.test",
      password,
      app.identity.region === "CA" ? "CAD" : "USD",
    ),
    warehouses = [0, 1].map(
      (i) =>
        app.inventory.createWarehouse(actor, `warehouse-${i}`, {
          name: `Synthetic ${app.identity.region} warehouse ${i}`,
        }).id,
    ),
    supplier = app.procurement.supplier(actor, "supplier", {
      name: "Synthetic supplier",
    }).id,
    products: Seed["products"] = [],
    serials: string[] = [];
  for (let i = 0; i < config.catalogProducts; i++) {
    checkDeadline();
    const product = {
        index: i,
        price: 10000 + i * 100,
        cost: 6000 + i * 50,
        tax: app.identity.region === "CA" ? 1300 : 600,
        serialized: i % 2 === 0,
      },
      id = app.catalog.create(actor, `catalog-${i}`, {
        sku: `SYN-${i}`,
        name: `Synthetic product ${i}`,
        serialized: product.serialized,
        unitPrice: product.price,
        taxBasisPoints: product.tax,
      }).id;
    products.push({ ...product, id });
    for (const [warehouseIndex, warehouseId] of warehouses.entries()) {
      const po = app.procurement.create(
          actor,
          `purchase-${i}-${warehouseIndex}`,
          {
            supplierId: supplier,
            warehouseId,
            lines: [
              {
                productId: id,
                quantity: config.unitsPerProductPerWarehouse,
                unitCost: product.cost,
              },
            ],
          },
        ),
        line = app.procurement.order(actor, po.id).lines[0]!,
        receivedSerials = product.serialized
          ? Array.from(
              { length: config.unitsPerProductPerWarehouse },
              (_, j) =>
                `SYN-${app.identity.region}-${i}-${warehouseIndex}-${j}`,
            )
          : [];
      app.procurement.receive(actor, `receive-${i}-${warehouseIndex}`, {
        poId: po.id,
        lineId: String(line.id),
        deliveryRef: `SYN-${i}-${warehouseIndex}`,
        quantity: config.unitsPerProductPerWarehouse,
        serials: receivedSerials,
        bin: `SYN-${warehouseIndex}`,
        quarantine: false,
      });
      serials.push(...receivedSerials);
    }
  }
  const customers = Array.from(
      { length: config.writers + 1 },
      (_, i) =>
        app.identity.createCustomer(actor, `customer-${i}`, {
          name: `Synthetic customer ${i}`,
          tier: "standard",
          creditLimit: 100000000,
        }).id,
    ),
    readers = Array.from({ length: config.readClients }, (_, i) => {
      checkDeadline();
      const email = `rehearsal-reader-${i}@example.test`,
        password = randomBytes(32).toString("hex");
      app.identity.createUser(actor, `reader-${i}`, {
        email,
        password,
        name: `Synthetic reader ${i}`,
        role: "finance",
        sites: warehouses,
      });
      return { email, password };
    });
  for (const accountId of customers)
    app.catalog.setPurchasingPolicy(
      actor,
      `rehearsal-purchasing-${accountId}`,
      {
        accountId,
        mode: "all",
        requiresReview: false,
        productIds: [],
        revision: 0,
        reason: "Synthetic rehearsal approved catalog access",
      },
    );
  const pending = acceptOrder(
    app,
    actor,
    customers.at(-1)!,
    warehouses[0]!,
    products[0]!.id,
    "pending",
  );
  return {
    actor,
    warehouses,
    products,
    customers,
    readers,
    serials,
    pending: { ...pending, productIndex: 0, warehouseIndex: 0 },
  };
}
function acceptOrder(
  app: Application,
  actor: Actor,
  customer: string,
  warehouse: string,
  product: string,
  key: string,
) {
  const existing = app.orders
      .carts(actor)
      .find(
        (cart) =>
          cart.account_id === customer && cart.warehouse_id === warehouse,
      ),
    cart = app.orders.saveCart(actor, `${key}-cart`, {
      accountId: customer,
      warehouseId: warehouse,
      revision: Number(existing?.revision ?? 0),
      lines: [{ productId: product, quantity: 1 }],
    }),
    quote = app.orders.quote(actor, `${key}-quote`, {
      cartId: cart.id,
      revision: cart.revision,
    });
  return app.orders.accept(actor, `${key}-accept`, {
    quoteId: quote.id,
    allowBackorder: false,
  });
}
export function completeOrder(
  app: Application,
  seed: Seed,
  orderId: string,
  productIndex: number,
  warehouseIndex: number,
  key: string,
): Sale {
  const actor = seed.actor,
    picks = app.fulfillment.picks(actor, orderId);
  for (const allocation of picks)
    app.fulfillment.pick(actor, `${key}-pick-${allocation.id}`, {
      orderId,
      allocationId: allocation.id,
      serial: allocation.serial,
    });
  const order = app.orders.order(actor, orderId),
    packed = app.fulfillment.pack(actor, `${key}-pack`, {
      orderId,
      revision: order.revision,
      mode: "collection",
      address: "Synthetic collection counter",
      lines: picks.map((p) => ({ allocationId: p.id, quantity: p.quantity })),
    }),
    shipment = app.fulfillment.commit(actor, `${key}-ship`, {
      shipmentId: packed.id,
      handoverEvidence: "Synthetic collection only",
    }),
    product = seed.products[productIndex]!,
    amount =
      product.price + Math.floor((product.price * product.tax + 5000) / 10000);
  app.billing.manualPayment(actor, `${key}-payment`, {
    invoiceId: shipment.invoiceId,
    amount,
    reference: `${key}-synthetic-payment`,
    reason: "Synthetic reconciliation evidence, no bank or processor",
  });
  return {
    id: orderId,
    invoiceId: shipment.invoiceId,
    productIndex,
    warehouseIndex,
    key,
    shipmentId: packed.id,
  };
}
export function rehearsalSale(
  app: Application,
  seed: Seed,
  config: RehearsalConfig,
  writer: number,
  sequence: number,
): Sale {
  const productIndex =
      (writer * config.ordersPerWriter + sequence) % config.catalogProducts,
    warehouseIndex = writer % 2,
    key = `writer-${writer}-order-${sequence}`,
    order = acceptOrder(
      app,
      seed.actor,
      seed.customers[writer]!,
      seed.warehouses[warehouseIndex]!,
      seed.products[productIndex]!.id,
      key,
    );
  return completeOrder(app, seed, order.id, productIndex, warehouseIndex, key);
}
export function replaySale(app: Application, seed: Seed, sale: Sale) {
  const shipment = app.fulfillment.commit(seed.actor, `${sale.key}-ship`, {
    shipmentId: sale.shipmentId,
    handoverEvidence: "Synthetic collection only",
  });
  assert.equal(shipment.invoiceId, sale.invoiceId);
  const p = seed.products[sale.productIndex]!;
  return app.billing.manualPayment(seed.actor, `${sale.key}-payment`, {
    invoiceId: sale.invoiceId,
    amount: p.price + Math.floor((p.price * p.tax + 5000) / 10000),
    reference: `${sale.key}-synthetic-payment`,
    reason: "Synthetic reconciliation evidence, no bank or processor",
  });
}
// Independent fixture ledger: no application control-total helper supplies expected values.
export function assertRehearsal(
  app: Application,
  seed: Seed,
  config: RehearsalConfig,
  sales: Sale[],
  pending = true,
) {
  const expected = new Map<string, number>();
  let value = 0n,
    net = 0n,
    tax = 0n,
    soldCost = 0n;
  for (const p of seed.products)
    for (const [w] of seed.warehouses.entries()) {
      expected.set(`${p.index}:${w}`, config.unitsPerProductPerWarehouse);
      value += BigInt(p.cost) * BigInt(config.unitsPerProductPerWarehouse);
    }
  assert.equal(
    new Set(sales.map((sale) => sale.id)).size,
    sales.length,
    "Unique orders",
  );
  assert.equal(
    new Set(sales.map((sale) => sale.invoiceId)).size,
    sales.length,
    "Unique invoices",
  );
  for (const sale of sales) {
    const assignment = /^writer-(\d+)-order-(\d+)$/.exec(sale.key);
    if (sale.key === "pending-completion") {
      assert.equal(sale.id, seed.pending.id);
      assert.equal(sale.productIndex, 0);
      assert.equal(sale.warehouseIndex, 0);
    } else {
      assert(assignment, "Known fixture sale identity");
      const writer = Number(assignment[1]),
        sequence = Number(assignment[2]);
      assert(writer < config.writers && sequence < config.ordersPerWriter);
      assert.equal(
        sale.productIndex,
        (writer * config.ordersPerWriter + sequence) % config.catalogProducts,
      );
      assert.equal(sale.warehouseIndex, writer % 2);
    }
    const p = seed.products[sale.productIndex]!;
    const key = `${p.index}:${sale.warehouseIndex}`;
    expected.set(key, expected.get(key)! - 1);
    value -= BigInt(p.cost);
    soldCost += BigInt(p.cost);
    net += BigInt(p.price);
    tax += (BigInt(p.price) * BigInt(p.tax) + 5000n) / 10000n;
    const invoice = app.billing.invoice(seed.actor, sale.invoiceId);
    const order = app.orders.order(seed.actor, sale.id);
    assert.equal(order.warehouse_id, seed.warehouses[sale.warehouseIndex]);
    assert.equal(
      order.account_id,
      sale.key === "pending-completion"
        ? seed.customers.at(-1)
        : seed.customers[Number(assignment![1])],
    );
    assert.equal(invoice.order_id, sale.id);
    assert.equal(invoice.shipment_id, sale.shipmentId);
    assert.equal(invoice.account_id, order.account_id);
    const lines = app.billing.lines(seed.actor, sale.invoiceId);
    assert.equal(lines.length, 1);
    assert.equal(lines[0]!.product_id, p.id);
    assert.equal(lines[0]!.quantity, 1);
    assert.equal(lines[0]!.unit_price, p.price);
    assert.equal(
      lines[0]!.unit_tax,
      Math.floor((p.price * p.tax + 5000) / 10000),
    );
    assert.equal(
      invoice.total,
      p.price + Math.floor((p.price * p.tax + 5000) / 10000),
    );
    assert.equal(app.billing.totals(seed.actor, sale.invoiceId).balance, 0);
  }
  const actual = new Map<string, number>(),
    stock = app.inventory.stock(seed.actor);
  for (const unit of stock) {
    const p = seed.products.find((p) => p.id === unit.product_id),
      w = seed.warehouses.indexOf(unit.warehouse_id);
    assert(p && w >= 0, "Only fixture products/sites");
    assert.equal(unit.cost, p.cost, "Original unit cost");
    const key = `${p.index}:${w}`;
    actual.set(key, (actual.get(key) ?? 0) + unit.quantity);
    if (p.serialized)
      assert(
        unit.quantity === 0 || unit.quantity === 1,
        "Serialized unit quantity",
      );
  }
  assert.deepEqual(
    [...actual.entries()].sort(),
    [...expected.entries()].sort(),
    "Per-product/site quantities",
  );
  assert.deepEqual(
    stock
      .filter((u) => u.serial !== null)
      .map((u) => u.serial)
      .sort(),
    [...seed.serials].sort(),
    "Exact retained serial identity",
  );
  const r = app.reconciliation(seed.actor),
    total = net + tax;
  assert.equal(r.currency, app.identity.region === "CA" ? "CAD" : "USD");
  assert.equal(
    r.stock.quantity,
    String(
      config.catalogProducts * config.unitsPerProductPerWarehouse * 2 -
        sales.length,
    ),
  );
  assert.equal(r.stock.value, String(value));
  assert.equal(r.billing.invoices, sales.length);
  assert.equal(r.billing.payments, sales.length);
  assert.equal(r.billing.total, String(total));
  assert.equal(r.billing.paid, String(total));
  assert.equal(r.billing.balance, "0");
  assert.equal(r.billing.credited, "0");
  assert.equal(r.billing.refunded, "0");
  assert.equal(r.billing.pendingRefunds, "0");
  assert.equal(r.billing.uncertainRefunds, "0");
  assert.equal(r.sales.orders, sales.length + Number(pending));
  assert.equal(r.sales.shipments, sales.length);
  assert.equal(r.sales.shippedQuantity, String(sales.length));
  assert.equal(r.sales.shippedCost, String(soldCost));
  assert.equal(r.sales.invoiceNet, String(net));
  assert.equal(r.sales.invoiceTax, String(tax));
  for (const control of [r.stock, r.billing, r.sales])
    assert.equal(control.issues.count, 0, JSON.stringify(control.issues));
  if (pending) {
    assert.equal(
      app.fulfillment
        .picks(seed.actor, seed.pending.id)
        .reduce((n, p) => n + p.quantity, 0),
      1,
      "Pending reservation retained",
    );
    assert.equal(app.orders.order(seed.actor, seed.pending.id).state, "open");
  }
  return {
    expected: {
      quantity: String(
        config.catalogProducts * config.unitsPerProductPerWarehouse * 2 -
          sales.length,
      ),
      value: String(value),
      net: String(net),
      tax: String(tax),
      paid: String(total),
      shippedCost: String(soldCost),
      pendingOrders: Number(pending),
    },
    actual: r,
  };
}
export const rehearsalRegions: Region[] = ["CA", "US"];
