import {
  account,
  check,
  id,
  integer,
  now,
  permit,
  tax,
  text,
  type Actor,
} from "./core.ts";
import { Database, type Store } from "./database.ts";
import { Identity } from "./iam.ts";
import { Catalog } from "./catalog.ts";
import { Inventory } from "./inventory.ts";
import { Billing, type CommercialLine } from "./billing.ts";
import { Platform } from "./platform.ts";
export type Order = {
  id: string;
  org_id: string;
  account_id: string;
  warehouse_id: string;
  state: string;
  revision: number;
  currency: string;
  total: number;
  created_at: string;
};
export type OrderLine = {
  id: string;
  org_id: string;
  order_id: string;
  product_id: string;
  description: string;
  quantity: number;
  shipped: number;
  canceled: number;
  allocated: number;
  unit_price: number;
  unit_tax: number;
};
type Cart = {
  id: string;
  org_id: string;
  account_id: string;
  warehouse_id: string;
  revision: number;
  lines: string;
  updated_at: string;
};
export class Orders {
  private store: Store;
  constructor(
    database: Database,
    private platform: Platform,
    private identity: Identity,
    private catalog: Catalog,
    private inventory: Inventory,
    private billing: Billing,
  ) {
    this.store = database.owned("orders");
    this.store.migrate(`
    CREATE TABLE IF NOT EXISTS orders_carts(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,account_id TEXT NOT NULL,warehouse_id TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,lines TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(org_id,account_id,warehouse_id)) STRICT;
    CREATE TABLE IF NOT EXISTS orders_quotes(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,account_id TEXT NOT NULL,warehouse_id TEXT NOT NULL,cart_revision INTEGER NOT NULL,lines TEXT NOT NULL,currency TEXT NOT NULL,total INTEGER NOT NULL,expires_at INTEGER NOT NULL,order_id TEXT,policy_version TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS orders_orders(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,account_id TEXT NOT NULL,warehouse_id TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'open',revision INTEGER NOT NULL DEFAULT 1,currency TEXT NOT NULL,total INTEGER NOT NULL CHECK(total>=0),created_at TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS orders_lines(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,order_id TEXT NOT NULL,product_id TEXT NOT NULL,description TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0),shipped INTEGER NOT NULL DEFAULT 0,canceled INTEGER NOT NULL DEFAULT 0,allocated INTEGER NOT NULL DEFAULT 0,unit_price INTEGER NOT NULL CHECK(unit_price>=0),unit_tax INTEGER NOT NULL CHECK(unit_tax>=0),CHECK(shipped>=0 AND canceled>=0 AND allocated>=0 AND shipped+canceled+allocated<=quantity),UNIQUE(order_id,product_id)) STRICT;
  `);
  }
  order(actor: Actor, orderId: string): Order {
    const row = this.store.get<Order>(
      "SELECT * FROM orders_orders WHERE org_id=? AND id=?",
      actor.orgId,
      orderId,
    );
    check(row, "NOT_FOUND", "Order not found.", 404);
    account(actor, row.account_id);
    if (actor.role === "warehouse")
      check(
        actor.sites.includes(row.warehouse_id),
        "FORBIDDEN",
        "Warehouse access is not permitted.",
        403,
      );
    return row;
  }
  lines(actor: Actor, orderId: string) {
    this.order(actor, orderId);
    return this.store.all<OrderLine>(
      "SELECT * FROM orders_lines WHERE org_id=? AND order_id=?",
      actor.orgId,
      orderId,
    );
  }
  list(actor: Actor) {
    return this.store
      .all<Order>(
        "SELECT * FROM orders_orders WHERE org_id=? AND (? IS NULL OR account_id=?) ORDER BY created_at DESC",
        actor.orgId,
        actor.role === "buyer" ? actor.accountId : null,
        actor.accountId,
      )
      .filter(
        (o) =>
          actor.role !== "warehouse" || actor.sites.includes(o.warehouse_id),
      )
      .map((o) => ({ ...o, lines: this.lines(actor, o.id) }));
  }
  carts(actor: Actor) {
    permit(actor, ["commercial", "buyer"]);
    return this.store
      .all<Cart>(
        "SELECT * FROM orders_carts WHERE org_id=? AND (? IS NULL OR account_id=?)",
        actor.orgId,
        actor.role === "buyer" ? actor.accountId : null,
        actor.accountId,
      )
      .map((row) => ({
        ...row,
        lines: JSON.parse(row.lines) as {
          productId: string;
          quantity: number;
        }[],
      }));
  }
  saveCart(
    actor: Actor,
    key: string,
    input: {
      accountId: string;
      warehouseId: string;
      revision: number;
      lines: { productId: string; quantity: number }[];
    },
  ) {
    return this.platform.command(
      actor,
      "cart.save",
      key,
      input,
      () => {
        permit(actor, ["commercial", "buyer"]);
        this.identity.customer(actor, input.accountId);
      },
      () => {
        this.inventory.warehouse(actor, input.warehouseId);
        check(
          Array.isArray(input.lines) && input.lines.length <= 100,
          "VALIDATION",
          "Maximum 100 cart lines.",
          400,
        );
        const seen = new Set();
        for (const l of input.lines) {
          this.catalog.product(actor, l.productId);
          check(
            !seen.has(l.productId),
            "VALIDATION",
            "Duplicate product.",
            400,
          );
          seen.add(l.productId);
          integer(l.quantity, "quantity", 1, 100000);
        }
        const old = this.store.get(
          "SELECT * FROM orders_carts WHERE org_id=? AND account_id=? AND warehouse_id=?",
          actor.orgId,
          input.accountId,
          input.warehouseId,
        );
        check(
          Number(old?.revision ?? 0) === input.revision,
          "REVISION",
          "Cart changed; refresh before saving.",
        );
        const cartId = String(old?.id ?? id()),
          revision = input.revision + 1;
        this.store.run(
          "INSERT INTO orders_carts VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,lines=excluded.lines,updated_at=excluded.updated_at",
          cartId,
          actor.orgId,
          input.accountId,
          input.warehouseId,
          revision,
          JSON.stringify(input.lines),
          now(),
        );
        return { id: cartId, revision };
      },
    );
  }
  quote(
    actor: Actor,
    key: string,
    input: { cartId: string; revision: number },
  ) {
    return this.platform.command(
      actor,
      "cart.quote",
      key,
      input,
      () => {
        permit(actor, ["commercial", "buyer"]);
        const c = this.store.get(
          "SELECT * FROM orders_carts WHERE org_id=? AND id=?",
          actor.orgId,
          input.cartId,
        );
        check(c, "NOT_FOUND", "Cart not found.", 404);
        this.identity.customer(actor, String(c.account_id));
      },
      () => {
        const cart = this.store.get(
          "SELECT * FROM orders_carts WHERE org_id=? AND id=?",
          actor.orgId,
          input.cartId,
        )!;
        check(
          cart.revision === input.revision,
          "REVISION",
          "Cart changed; refresh before quoting.",
        );
        const customer = this.identity.customer(actor, String(cart.account_id));
        const lines = (
          JSON.parse(String(cart.lines)) as {
            productId: string;
            quantity: number;
          }[]
        ).map((l) => {
          const p = this.catalog.price(actor, l.productId, customer.id);
          check(p.product.active, "PRODUCT", "Product is inactive.");
          return {
            productId: l.productId,
            description: p.product.name,
            quantity: l.quantity,
            unitPrice: p.unitPrice,
            unitTax: tax(p.unitPrice, p.product.tax_bp),
            taxBasisPoints: p.product.tax_bp,
          };
        });
        check(lines.length > 0, "VALIDATION", "Cart is empty.", 400);
        const total = integer(
            lines.reduce(
              (s, l) => s + l.quantity * (l.unitPrice + l.unitTax),
              0,
            ),
            "quote total",
            0,
            1e12,
          ),
          quoteId = id();
        this.store.run(
          "INSERT INTO orders_quotes VALUES(?,?,?,?,?,?,?,?,?,?,?)",
          quoteId,
          actor.orgId,
          customer.id,
          String(cart.warehouse_id),
          input.revision,
          JSON.stringify(lines),
          customer.currency,
          total,
          Date.now() + 15 * 60000,
          null,
          "unit-tax-v1",
        );
        return {
          id: quoteId,
          total,
          currency: customer.currency,
          lines,
          expiresAt: Date.now() + 15 * 60000,
        };
      },
    );
  }
  accept(
    actor: Actor,
    key: string,
    input: { quoteId: string; allowBackorder: boolean },
  ) {
    return this.platform.command(
      actor,
      "order.accept",
      key,
      input,
      () => {
        permit(actor, ["commercial", "buyer"]);
        const q = this.store.get(
          "SELECT * FROM orders_quotes WHERE org_id=? AND id=?",
          actor.orgId,
          input.quoteId,
        );
        check(q, "NOT_FOUND", "Quote not found.", 404);
        this.identity.customer(actor, String(q.account_id));
      },
      () => {
        const q = this.store.get(
          "SELECT * FROM orders_quotes WHERE org_id=? AND id=?",
          actor.orgId,
          input.quoteId,
        )!;
        if (q.order_id) return { id: String(q.order_id) };
        check(
          Number(q.expires_at) > Date.now(),
          "QUOTE_EXPIRED",
          "Quote expired; request a new quote.",
        );
        check(
          typeof input.allowBackorder === "boolean",
          "VALIDATION",
          "Backorder choice is required.",
          400,
        );
        const orderId = id(),
          lines = JSON.parse(String(q.lines)) as CommercialLine[];
        this.billing.commitExposure(
          actor,
          String(q.account_id),
          orderId,
          Number(q.total),
        );
        this.store.run(
          "INSERT INTO orders_orders(id,org_id,account_id,warehouse_id,currency,total,created_at) VALUES(?,?,?,?,?,?,?)",
          orderId,
          actor.orgId,
          String(q.account_id),
          String(q.warehouse_id),
          String(q.currency),
          Number(q.total),
          now(),
        );
        for (const l of lines) {
          const allocated = this.inventory.reserve(
            actor,
            orderId,
            l.productId,
            String(q.warehouse_id),
            l.quantity,
          );
          check(
            input.allowBackorder || allocated === l.quantity,
            "STOCK",
            "Insufficient stock; approve backorder or change quantities.",
          );
          this.store.run(
            "INSERT INTO orders_lines(id,org_id,order_id,product_id,description,quantity,allocated,unit_price,unit_tax) VALUES(?,?,?,?,?,?,?,?,?)",
            id(),
            actor.orgId,
            orderId,
            l.productId,
            l.description,
            l.quantity,
            allocated,
            l.unitPrice,
            l.unitTax,
          );
        }
        this.store.run(
          "UPDATE orders_quotes SET order_id=? WHERE id=?",
          orderId,
          input.quoteId,
        );
        this.platform.event(actor, "orders.accepted", orderId, {
          accountId: q.account_id,
          total: q.total,
          currency: q.currency,
        });
        return { id: orderId };
      },
    );
  }
  allocate(
    actor: Actor,
    key: string,
    input: { orderId: string; revision: number },
  ) {
    return this.platform.command(
      actor,
      "order.allocate",
      key,
      input,
      () => {
        permit(actor, ["commercial"]);
        this.order(actor, input.orderId);
      },
      () => {
        const order = this.order(actor, input.orderId);
        check(
          order.revision === input.revision && order.state === "open",
          "STATE",
          "Order changed or is closed.",
        );
        check(
          !this.identity.customer(actor, order.account_id).held,
          "CREDIT_HOLD",
          "Account is on hold.",
        );
        for (const l of this.lines(actor, order.id)) {
          const qty = this.inventory.reserve(
            actor,
            order.id,
            l.product_id,
            order.warehouse_id,
            l.quantity - l.shipped - l.canceled - l.allocated,
          );
          this.store.run(
            "UPDATE orders_lines SET allocated=allocated+? WHERE id=?",
            qty,
            l.id,
          );
        }
        this.store.run(
          "UPDATE orders_orders SET revision=revision+1 WHERE id=?",
          order.id,
        );
        return { id: order.id, revision: order.revision + 1 };
      },
    );
  }
  cancel(
    actor: Actor,
    key: string,
    input: {
      orderId: string;
      lineId: string;
      quantity: number;
      revision: number;
      reason: string;
    },
  ) {
    return this.platform.command(
      actor,
      "order.cancel",
      key,
      input,
      () => {
        permit(actor, ["commercial", "buyer"]);
        this.order(actor, input.orderId);
      },
      () => {
        const order = this.order(actor, input.orderId),
          line = this.lines(actor, order.id).find((l) => l.id === input.lineId),
          qty = integer(input.quantity, "canceled quantity", 1, 100000);
        check(line, "NOT_FOUND", "Order line not found.", 404);
        check(
          order.revision === input.revision && order.state === "open",
          "STATE",
          "Order changed or is closed.",
        );
        check(
          qty <= line.quantity - line.shipped - line.canceled,
          "QUANTITY",
          "Cancellation exceeds open quantity.",
        );
        text(input.reason, "cancellation reason", 1000);
        const backorder =
            line.quantity - line.shipped - line.canceled - line.allocated,
          release = Math.max(0, qty - backorder);
        check(
          this.inventory.release(actor, order.id, line.product_id, release) ===
            release,
          "ALLOCATION",
          "Reservation release failed.",
        );
        this.billing.releaseExposure(
          actor,
          order.id,
          qty * (line.unit_price + line.unit_tax),
        );
        this.store.run(
          "UPDATE orders_lines SET canceled=canceled+?,allocated=allocated-? WHERE id=?",
          qty,
          release,
          line.id,
        );
        this.refresh(actor, order.id);
        this.platform.audit(actor, "order.cancel.reason", order.id, {
          reason: input.reason,
          quantity: qty,
        });
        return { id: order.id, revision: order.revision + 1 };
      },
    );
  }
  completeShipment(
    actor: Actor,
    orderId: string,
    quantities: Map<string, number>,
  ): CommercialLine[] {
    const order = this.order(actor, orderId);
    check(order.state === "open", "STATE", "Order is closed.");
    const result: CommercialLine[] = [];
    for (const [productId, qty] of quantities) {
      const l = this.lines(actor, orderId).find(
        (l) => l.product_id === productId,
      );
      check(
        l && l.allocated >= qty,
        "QUANTITY",
        "Shipment exceeds allocated order quantity.",
      );
      this.store.run(
        "UPDATE orders_lines SET allocated=allocated-?,shipped=shipped+? WHERE id=?",
        qty,
        qty,
        l.id,
      );
      result.push({
        productId: l.product_id,
        description: l.description,
        quantity: qty,
        unitPrice: l.unit_price,
        unitTax: l.unit_tax,
      });
    }
    this.refresh(actor, orderId);
    return result;
  }
  shortPick(
    actor: Actor,
    input: {
      orderId: string;
      revision: number;
      allocationId: string;
      unitRevision: number;
      quantity: number;
      reason: string;
    },
    reference: string,
  ) {
    permit(actor, ["warehouse"]);
    const o = this.order(actor, input.orderId);
    check(
      o.state === "open" && o.revision === input.revision,
      "REVISION",
      "Order changed; refresh before reporting a shortage.",
    );
    const a = this.inventory
      .allocations(actor, o.id)
      .find((a) => a.id === input.allocationId);
    check(a, "NOT_FOUND", "Allocation not found on this order.", 404);
    const l = this.lines(actor, o.id).find(
      (l) => l.product_id === a.product_id,
    );
    check(
      l && l.allocated >= input.quantity,
      "QUANTITY",
      "Short quantity exceeds allocated order stock.",
    );
    const held = this.inventory.holdShortPick(actor, input, reference);
    this.store.run(
      "UPDATE orders_lines SET allocated=allocated-? WHERE id=?",
      held.quantity,
      l.id,
    );
    this.refresh(actor, o.id);
    return { ...held, revision: o.revision + 1 };
  }
  private refresh(actor: Actor, orderId: string) {
    const complete = this.lines(actor, orderId).every(
      (l) => l.shipped + l.canceled === l.quantity,
    );
    this.store.run(
      "UPDATE orders_orders SET revision=revision+1,state=? WHERE id=?",
      complete ? "closed" : "open",
      orderId,
    );
  }
}
