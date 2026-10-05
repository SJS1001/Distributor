import { OrderPriceOverrides } from "./order-price-overrides.ts";
import { shippingTermsInitialize } from "./shipping-terms-schema.ts";
import {
  unspecifiedShipping,
  type ShippingTerms,
} from "../shared/shipping-terms.ts";
import { purchasingInitialize } from "./purchasing-schema.ts";
import type {
  OrderRequest,
  OrderRequestPage,
  OrderAcceptResult,
  OrderRequestDecisionInput,
  OrderRequestWithdrawInput,
  OrderRequestResubmitInput,
  OrderRequestStatus,
} from "../shared/purchasing.ts";
import type { IncomingSupplyReview } from "../shared/incoming-supply.ts";
import { incomingSupplyInitialize } from "./incoming-supply-schema.ts";
import { Procurement } from "./procurement.ts";
type IncomingRow = {
  id: string;
  org_id: string;
  order_id: string;
  line_id: string;
  po_id: string;
  purchase_line_id: string;
  quantity: number;
  held: number;
  converted: number;
  released: number;
  priority: number;
  reason: string;
  actor_id: string;
  created_at: string;
};
import { analyticsPeriod } from "../shared/operational-analytics.ts";
import type {
  OrderEntry,
  CartLine,
  SavedCartPage,
} from "../shared/customer-products.ts";
import type { SQLInputValue } from "node:sqlite";
import {
  orderQueueStates,
  type OrderQueueState,
} from "../shared/order-queue.ts";
import type { OrderSalesEvidence } from "./sales-evidence.ts";
import {
  account,
  canonical,
  digest,
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
type ReservationHistory = {
  id: string;
  org_id: string;
  order_id: string;
  revision: number;
  action: "deadline" | "expire";
  before_expires_at: number | null;
  expires_at: number | null;
  lines: string;
  reason: string;
  actor_id: string;
  created_at: string;
};
export class Orders {
  private store: Store;
  readonly priceOverrides: OrderPriceOverrides;
  constructor(
    private database: Database,
    private platform: Platform,
    private identity: Identity,
    private catalog: Catalog,
    private inventory: Inventory,
    private billing: Billing,
    private procurement: Procurement,
  ) {
    this.store = database.owned("orders");
    this.priceOverrides = new OrderPriceOverrides(
      database,
      platform,
      identity,
      catalog,
      inventory,
    );
    this.store.migrate(shippingTermsInitialize("orders"));
    this.store.migrate(purchasingInitialize("orders"));
    this.store.migrate(incomingSupplyInitialize("orders"));
    this.store.migrate(`
    CREATE TABLE IF NOT EXISTS orders_carts(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,account_id TEXT NOT NULL,warehouse_id TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,lines TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(org_id,account_id,warehouse_id)) STRICT;
    CREATE TABLE IF NOT EXISTS orders_quotes(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,account_id TEXT NOT NULL,warehouse_id TEXT NOT NULL,cart_revision INTEGER NOT NULL,lines TEXT NOT NULL,currency TEXT NOT NULL,total INTEGER NOT NULL,expires_at INTEGER NOT NULL,order_id TEXT,policy_version TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS orders_orders(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,account_id TEXT NOT NULL,warehouse_id TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'open',revision INTEGER NOT NULL DEFAULT 1,currency TEXT NOT NULL,total INTEGER NOT NULL CHECK(total>=0),created_at TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS orders_lines(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,order_id TEXT NOT NULL,product_id TEXT NOT NULL,description TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0),shipped INTEGER NOT NULL DEFAULT 0,canceled INTEGER NOT NULL DEFAULT 0,allocated INTEGER NOT NULL DEFAULT 0,unit_price INTEGER NOT NULL CHECK(unit_price>=0),unit_tax INTEGER NOT NULL CHECK(unit_tax>=0),CHECK(shipped>=0 AND canceled>=0 AND allocated>=0 AND shipped+canceled+allocated<=quantity),UNIQUE(order_id,product_id)) STRICT;
    CREATE TABLE IF NOT EXISTS orders_amendments(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,order_id TEXT NOT NULL,line_id TEXT NOT NULL,revision INTEGER NOT NULL,before_quantity INTEGER NOT NULL,after_quantity INTEGER NOT NULL,unit_price INTEGER NOT NULL,unit_tax INTEGER NOT NULL,before_total INTEGER NOT NULL,after_total INTEGER NOT NULL,allocated_delta INTEGER NOT NULL,reason TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(order_id,revision)) STRICT;
    CREATE INDEX IF NOT EXISTS orders_amendment_history ON orders_amendments(org_id,order_id,revision);
    CREATE TABLE IF NOT EXISTS orders_reservation_deadlines(org_id TEXT NOT NULL,order_id TEXT NOT NULL,expires_at INTEGER,PRIMARY KEY(org_id,order_id)) STRICT;
    CREATE TABLE IF NOT EXISTS orders_reservation_history(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,order_id TEXT NOT NULL,revision INTEGER NOT NULL,action TEXT NOT NULL CHECK(action IN('deadline','expire')),before_expires_at INTEGER,expires_at INTEGER,lines TEXT NOT NULL,reason TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(order_id,revision)) STRICT;
    CREATE INDEX IF NOT EXISTS orders_reservation_history_page ON orders_reservation_history(org_id,order_id,revision);
  `);
  }
  // Internal sales controls; the caller supplies the owning transaction snapshot.
  salesEvidence(actor: Actor): OrderSalesEvidence {
    actor = this.orderReader(actor);
    permit(actor, ["finance"]);
    return {
      orders: this.store.all(
        `SELECT id,account_id AS account,warehouse_id AS warehouse,currency
         FROM orders_orders WHERE org_id=? ORDER BY rowid`,
        actor.orgId,
      ),
      lines: this.store.all(
        `SELECT id,order_id AS "order",product_id AS product,
         CAST(quantity AS TEXT) AS quantity,CAST(shipped AS TEXT) AS shipped,
         CAST(canceled AS TEXT) AS canceled,CAST(allocated AS TEXT) AS allocated,
         CAST(unit_price AS TEXT) AS price,CAST(unit_tax AS TEXT) AS tax
         FROM orders_lines WHERE org_id=? ORDER BY rowid`,
        actor.orgId,
      ),
    };
  }
  order(actor: Actor, orderId: string): Order {
    actor = this.orderReader(actor);
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
  // Full projection retained for internal controls; operator queues use orderPage.
  list(actor: Actor) {
    actor = this.orderReader(actor);
    const scope = this.orderScope(actor);
    return this.store
      .all<Order>(
        `SELECT * FROM orders_orders WHERE ${scope.where} ORDER BY created_at DESC,id DESC`,
        ...scope.params,
      )
      .map((order) => this.orderView(actor, order));
  }
  orderPage(
    actor: Actor,
    after?: string,
    state?: OrderQueueState,
    reservation?: "overdue",
  ) {
    return this.database.transaction(() => {
      actor = this.orderReader(actor);
      check(
        state === undefined || orderQueueStates.includes(state),
        "VALIDATION",
        "Choose a supported order state.",
        400,
      );
      const scope = this.orderScope(actor);
      const cursor =
        after === undefined
          ? undefined
          : this.store.get<Order>(
              `SELECT * FROM orders_orders WHERE ${scope.where} AND id=?`,
              ...scope.params,
              text(after, "Order cursor", 128),
            );
      check(
        after === undefined || cursor,
        "CURSOR",
        "Order cursor is unavailable in your current scope.",
        400,
      );
      if (state !== undefined) {
        scope.where += " AND state=?";
        scope.params.push(state);
      }
      check(
        reservation === undefined || reservation === "overdue",
        "VALIDATION",
        "Choose a supported reservation filter.",
        400,
      );
      if (reservation === "overdue") {
        scope.where += ` AND state='open' AND ${this.overdueReservationPredicate()}`;
        scope.params.push(Date.now());
      }
      if (cursor) {
        scope.where += " AND (created_at<? OR (created_at=? AND id<?))";
        scope.params.push(cursor.created_at, cursor.created_at, cursor.id);
      }
      const rows = this.store.all<Order>(
        `SELECT * FROM orders_orders WHERE ${scope.where} ORDER BY created_at DESC,id DESC LIMIT 21`,
        ...scope.params,
      );
      const items = rows
        .slice(0, 20)
        .map((order) => this.orderView(actor, order));
      return { items, next: rows.length > 20 ? items.at(-1)!.id : null };
    });
  }
  orderCounts(actor: Actor) {
    return this.database.transaction(() => {
      actor = this.orderReader(actor);
      const scope = this.orderScope(actor);
      const counts = this.store.get<{ total: number; open: number }>(
        `SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN state='open' THEN 1 ELSE 0 END),0) AS open FROM orders_orders WHERE ${scope.where}`,
        ...scope.params,
      )!;
      return { total: counts.total, open: counts.open };
    });
  }
  detail(actor: Actor, orderId: string) {
    return this.database.transaction(() => {
      actor = this.orderReader(actor);
      return this.orderView(
        actor,
        this.order(actor, text(orderId, "Order ID", 128)),
      );
    });
  }
  operationalAnalytics(actor: Actor, asOf = new Date().toISOString()) {
    return this.database.transaction(() => {
      actor = this.orderReader(actor);
      const scope = this.orderScope(actor),
        period = analyticsPeriod(asOf);
      const states = this.store.all<{ state: string; count: number }>(
        `SELECT state,COUNT(*) AS count FROM orders_orders WHERE ${scope.where} GROUP BY state ORDER BY state`,
        ...scope.params,
      );
      const overdue = this.store.get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM orders_orders WHERE ${scope.where} AND state='open' AND ${this.overdueReservationPredicate()}`,
        ...scope.params,
        Date.parse(asOf),
      )!.count;
      const rows = this.store.all<{ date: string; count: number }>(
        `SELECT substr(created_at,1,10) AS date,COUNT(*) AS count FROM orders_orders WHERE ${scope.where} AND created_at>=? AND created_at<? GROUP BY date`,
        ...scope.params,
        period.previousStart,
        period.endExclusive,
      );
      return {
        period,
        states,
        overdueReservations: overdue,
        history: period.days.map((date) => ({
          date,
          count: rows.find((row) => row.date === date)?.count ?? 0,
        })),
      };
    });
  }
  private overdueReservationPredicate() {
    return `(EXISTS(SELECT 1 FROM orders_reservation_deadlines d WHERE d.org_id=orders_orders.org_id AND d.order_id=orders_orders.id AND d.expires_at<=?) OR
      (SELECT h.action FROM orders_reservation_history h WHERE h.org_id=orders_orders.org_id AND h.order_id=orders_orders.id ORDER BY h.revision DESC LIMIT 1)='expire')`;
  }
  private orderReader(actor: Actor) {
    actor = this.identity.currentActor(actor);
    permit(actor, [
      "warehouse",
      "commercial",
      "finance",
      "warranty",
      "support",
      "buyer",
    ]);
    check(
      !this.identity.security(actor).passwordChangeRequired,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before reviewing orders.",
      403,
    );
    return actor;
  }
  private orderScope(actor: Actor) {
    const params: SQLInputValue[] = [actor.orgId];
    let where = "org_id=?";
    if (actor.role === "buyer") {
      where += " AND account_id=?";
      params.push(actor.accountId);
    }
    if (actor.role === "warehouse") {
      where += actor.sites.length
        ? ` AND warehouse_id IN(${actor.sites.map(() => "?").join(",")})`
        : " AND 0";
      params.push(...actor.sites);
    }
    return { where, params };
  }
  private orderView(actor: Actor, order: Order) {
    return {
      ...order,
      shipping: this.shipping(actor, order.id),
      lines: this.lines(actor, order.id),
      reservation: this.reservationStatus(actor, order.id),
    };
  }
  carts(actor: Actor) {
    actor = this.amendmentActor(actor, true);
    return this.store
      .all<Cart>(
        "SELECT * FROM orders_carts WHERE org_id=? AND (?=0 OR account_id=?)",
        actor.orgId,
        actor.role === "buyer" ? 1 : 0,
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
  cartPage(
    actor: Actor,
    after?: string,
    accountId?: string,
    warehouseId?: string,
  ): SavedCartPage {
    return this.database.transaction(() => {
      actor = this.amendmentActor(actor, true);
      // Recheck assignment even for an empty buyer page.
      if (actor.role === "buyer") {
        check(
          actor.accountId,
          "FORBIDDEN",
          "Buyer customer assignment is unavailable.",
          403,
        );
        this.identity.customer(actor, actor.accountId);
      }
      if (accountId !== undefined) {
        accountId = text(accountId, "Customer ID", 128);
        this.identity.customer(actor, accountId);
      }
      if (warehouseId !== undefined) {
        warehouseId = text(warehouseId, "Warehouse ID", 128);
        this.inventory.warehouse(actor, warehouseId);
      }
      const scope = this.orderScope(actor);
      if (accountId !== undefined) {
        scope.where += " AND account_id=?";
        scope.params.push(accountId);
      }
      if (warehouseId !== undefined) {
        scope.where += " AND warehouse_id=?";
        scope.params.push(warehouseId);
      }
      const cursor =
        after === undefined
          ? undefined
          : this.store.get<Cart>(
              `SELECT * FROM orders_carts WHERE ${scope.where} AND id=?`,
              ...scope.params,
              text(after, "Cart cursor", 128),
            );
      check(
        after === undefined || cursor,
        "CURSOR",
        "Cart cursor is unavailable in your current scope or filter.",
        400,
      );
      if (cursor) {
        scope.where += " AND (updated_at<? OR (updated_at=? AND id<?))";
        scope.params.push(cursor.updated_at, cursor.updated_at, cursor.id);
      }
      const rows = this.store.all<Cart>(
        `SELECT * FROM orders_carts WHERE ${scope.where} ORDER BY updated_at DESC,id DESC LIMIT 21`,
        ...scope.params,
      );
      const items = rows.slice(0, 20).map((row) => {
        const lines = JSON.parse(row.lines) as CartLine[];
        check(
          Array.isArray(lines) && lines.length <= 100,
          "VALIDATION",
          "Maximum 100 cart lines.",
          400,
        );
        return {
          id: row.id,
          account_id: row.account_id,
          warehouse_id: row.warehouse_id,
          revision: row.revision,
          updated_at: row.updated_at,
          products: lines.length,
          units: lines.reduce((sum, line) => sum + line.quantity, 0),
        };
      });
      return { items, next: rows.length > 20 ? items.at(-1)!.id : null };
    });
  }
  orderEntry(actor: Actor, accountId: string, warehouseId: string): OrderEntry {
    return this.database.transaction(() => {
      actor = this.amendmentActor(actor, true);
      accountId = text(accountId, "Customer ID", 128);
      warehouseId = text(warehouseId, "Warehouse ID", 128);
      this.identity.customer(actor, accountId);
      this.inventory.warehouse(actor, warehouseId);
      const row = this.store.get<Cart>(
        "SELECT * FROM orders_carts WHERE org_id=? AND account_id=? AND warehouse_id=?",
        actor.orgId,
        accountId,
        warehouseId,
      );
      if (!row) return { cart: null, products: [] };
      const lines = JSON.parse(row.lines) as CartLine[];
      check(
        Array.isArray(lines) && lines.length <= 100,
        "VALIDATION",
        "Maximum 100 cart lines.",
        400,
      );
      const products = this.catalog.selectedCustomerProducts(
        actor,
        accountId,
        lines.map((line) => line.productId),
      );
      return {
        cart: {
          id: row.id,
          account_id: row.account_id,
          warehouse_id: row.warehouse_id,
          revision: row.revision,
          lines,
        },
        products,
      };
    });
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
        actor = this.amendmentActor(actor, true);
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
          this.catalog.authorizePurchase(actor, input.accountId, l.productId);
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
  cartShipping(actor: Actor, cartId: string) {
    actor = this.amendmentActor(actor, true);
    const cart = this.store.get<Cart>(
      "SELECT * FROM orders_carts WHERE org_id=? AND id=?",
      actor.orgId,
      text(cartId, "Cart", 128),
    );
    check(cart, "NOT_FOUND", "Cart not found.", 404);
    this.identity.customer(actor, cart.account_id);
    this.inventory.warehouse(actor, cart.warehouse_id);
    const row = this.store.get<{ terms: string; cart_fingerprint: string }>(
      "SELECT terms,cart_fingerprint FROM orders_cart_shipping WHERE org_id=? AND cart_id=? ORDER BY revision DESC LIMIT 1",
      actor.orgId,
      cart.id,
    );
    return {
      cartRevision: cart.revision,
      shipping:
        row?.cart_fingerprint === digest(cart.lines)
          ? (JSON.parse(row.terms) as ShippingTerms)
          : unspecifiedShipping(),
    };
  }
  setCartShipping(
    actor: Actor,
    key: string,
    input: {
      cartId: string;
      cartRevision: number;
      treatment: ShippingTerms["treatment"];
      net: number;
      tax: number;
      reason: string;
    },
  ) {
    return this.platform.command(
      actor,
      "cart.shipping.set",
      key,
      input,
      () => {
        actor = this.amendmentActor(actor, false);
        permit(actor, ["commercial"]);
        this.cartShipping(actor, input.cartId);
      },
      () => {
        const current = this.cartShipping(actor, input.cartId);
        check(
          current.cartRevision === input.cartRevision,
          "REVISION",
          "Cart changed; review shipping against the current cart.",
        );
        check(
          ["included", "extra", "unspecified"].includes(input.treatment),
          "VALIDATION",
          "Choose shipping treatment.",
          400,
        );
        const net = integer(input.net, "shipping net", 0, 1e12),
          tax = integer(input.tax, "explicit shipping tax", 0, 1e12);
        integer(net + tax, "shipping total", 0, 1e12);
        check(
          input.treatment === "extra" || (net === 0 && tax === 0),
          "VALIDATION",
          "Only extra shipping can have a separate amount or tax.",
          400,
        );
        const revision = Number(
          this.store.get(
            "SELECT COALESCE(MAX(revision),0)+1 AS revision FROM orders_cart_shipping WHERE org_id=? AND cart_id=?",
            actor.orgId,
            input.cartId,
          )!.revision,
        );
        const shipping: ShippingTerms = {
          treatment: input.treatment,
          net,
          tax,
          revision,
          reason: text(
            input.reason,
            "Shipping terms and tax review evidence",
            1000,
          ),
        };
        this.store.run(
          "INSERT INTO orders_cart_shipping VALUES(?,?,?,?,?,?,?,?)",
          actor.orgId,
          input.cartId,
          input.cartRevision,
          digest(
            String(
              this.store.get(
                "SELECT lines FROM orders_carts WHERE org_id=? AND id=?",
                actor.orgId,
                input.cartId,
              )!.lines,
            ),
          ),
          revision,
          JSON.stringify(shipping),
          actor.id,
          now(),
        );
        this.platform.audit(actor, "cart.shipping.set", input.cartId, {
          shipping,
          cartRevision: input.cartRevision,
        });
        return { cartRevision: input.cartRevision, shipping };
      },
    );
  }
  private quoteShipping(actor: Actor, quoteId: string): ShippingTerms {
    const row = this.store.get<{ terms: string }>(
      "SELECT terms FROM orders_shipping_snapshots WHERE org_id=? AND quote_id=?",
      actor.orgId,
      quoteId,
    );
    return row
      ? (JSON.parse(row.terms) as ShippingTerms)
      : unspecifiedShipping();
  }
  shipping(actor: Actor, orderId: string): ShippingTerms {
    this.order(actor, orderId);
    const row = this.store.get<{ terms: string }>(
      "SELECT terms FROM orders_shipping_snapshots WHERE org_id=? AND order_id=?",
      actor.orgId,
      orderId,
    );
    return row
      ? (JSON.parse(row.terms) as ShippingTerms)
      : unspecifiedShipping();
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
      (cached) => {
        actor = this.amendmentActor(actor, true);
        const c = this.store.get(
          "SELECT * FROM orders_carts WHERE org_id=? AND id=?",
          actor.orgId,
          input.cartId,
        );
        check(c, "NOT_FOUND", "Cart not found.", 404);
        this.identity.customer(actor, String(c.account_id));
        const lines =
          cached?.lines ?? (JSON.parse(String(c.lines)) as CartLine[]);
        for (const line of lines)
          this.catalog.authorizePurchase(
            actor,
            String(c.account_id),
            line.productId,
          );
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
        const overrides = this.priceOverrides.resolve(actor, String(cart.id));
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
            unitPrice: overrides.get(l.productId)?.unitPrice ?? p.unitPrice,
            unitTax: tax(
              overrides.get(l.productId)?.unitPrice ?? p.unitPrice,
              p.product.tax_bp,
            ),
            ...(overrides.has(l.productId)
              ? { priceOverride: true, ordinaryUnitPrice: p.unitPrice }
              : {}),
            taxBasisPoints: p.product.tax_bp,
          };
        });
        check(lines.length > 0, "VALIDATION", "Cart is empty.", 400);
        const shipping = this.cartShipping(actor, input.cartId).shipping;
        const total = integer(
            shipping.net +
              shipping.tax +
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
          this.catalog.purchasingSnapshot(
            actor,
            customer.id,
            lines.map((l) => l.productId),
          ).hash,
        );
        this.store.run(
          "INSERT INTO orders_shipping_snapshots VALUES(?,?,?,?,?,?)",
          actor.orgId,
          quoteId,
          input.cartId,
          input.revision,
          null,
          JSON.stringify(shipping),
        );
        this.priceOverrides.capture(actor, quoteId, String(cart.id), overrides);
        return {
          shipping,
          id: quoteId,
          total,
          currency: customer.currency,
          lines,
          expiresAt: Date.now() + 15 * 60000,
          requiresReview: this.catalog.purchasingSnapshot(
            actor,
            customer.id,
            lines.map((l) => l.productId),
          ).requiresReview,
        };
      },
    );
  }
  accept(
    actor: Actor,
    key: string,
    input: { quoteId: string; allowBackorder: boolean },
  ): OrderAcceptResult {
    return this.platform.command(
      actor,
      "order.accept",
      key,
      input,
      () => {
        actor = this.amendmentActor(actor, true);
        this.reviewQuote(actor, input.quoteId);
      },
      () => {
        const q = this.reviewQuote(actor, input.quoteId);
        if (q.order_id)
          return {
            id: String(q.order_id),
            status: "accepted",
            orderId: String(q.order_id),
          };
        const linked = this.store.get<{ request_id: string }>(
          "SELECT request_id FROM orders_review_quotes WHERE org_id=? AND quote_id=?",
          actor.orgId,
          input.quoteId,
        );
        if (linked) {
          const request = this.reviewRequestCurrent(actor, linked.request_id);
          check(
            request.status === "awaiting_approval" &&
              request.quoteId === input.quoteId &&
              request.allowBackorder === input.allowBackorder,
            "REQUEST_STATE",
            "This quote belongs to an existing request; open the request to continue.",
          );
          return {
            id: request.id,
            status: "awaiting_approval",
            requestId: request.id,
          };
        }
        const policy = this.validateAcceptance(actor, q, input.allowBackorder);
        if (!policy.requiresReview)
          return this.acceptQuote(actor, q, input.allowBackorder);
        const requestId = id(),
          timestamp = now();
        this.store.run(
          "INSERT INTO orders_review_requests VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          requestId,
          actor.orgId,
          String(q.account_id),
          String(q.warehouse_id),
          input.quoteId,
          1,
          "awaiting_approval",
          String(q.lines),
          Number(q.total),
          String(q.currency),
          Number(input.allowBackorder),
          Number(q.expires_at),
          policy.hash,
          policy.reviewReason,
          "",
          null,
          timestamp,
          timestamp,
        );
        this.store.run(
          "INSERT INTO orders_review_quotes VALUES(?,?,?)",
          actor.orgId,
          input.quoteId,
          requestId,
        );
        this.recordReview(actor, requestId, "submit", "", "");
        return { id: requestId, status: "awaiting_approval", requestId };
      },
    );
  }
  private reviewQuote(actor: Actor, quoteId: string) {
    const q = this.store.get(
      "SELECT * FROM orders_quotes WHERE org_id=? AND id=?",
      actor.orgId,
      text(quoteId, "Quote ID", 128),
    );
    check(q, "NOT_FOUND", "Quote not found.", 404);
    this.identity.customer(actor, String(q.account_id));
    return q;
  }
  private validateAcceptance(
    actor: Actor,
    q: import("./core.ts").Row,
    allowBackorder: boolean,
  ) {
    check(
      Number(q.expires_at) > Date.now(),
      "QUOTE_EXPIRED",
      "Quote expired; obtain and accept a new quote before resubmitting.",
    );
    check(
      typeof allowBackorder === "boolean",
      "VALIDATION",
      "Backorder choice is required.",
      400,
    );
    const shippingSnapshot = this.store.get<{
      terms: string;
      cart_id: string;
      cart_revision: number;
    }>(
      "SELECT terms,cart_id,cart_revision FROM orders_shipping_snapshots WHERE org_id=? AND quote_id=?",
      actor.orgId,
      String(q.id),
    );
    const overrides = shippingSnapshot
      ? this.priceOverrides.validate(actor, q, shippingSnapshot.cart_id)
      : new Map<string, { unitPrice: number }>();
    if (shippingSnapshot) {
      const current = this.cartShipping(actor, shippingSnapshot.cart_id);
      check(
        current.cartRevision === shippingSnapshot.cart_revision &&
          canonical(current.shipping) ===
            canonical(JSON.parse(shippingSnapshot.terms)),
        "SHIPPING_CHANGED",
        "Cart or shipping terms changed; obtain and accept a fresh quote.",
      );
    }
    const customer = this.identity.customer(actor, String(q.account_id));
    check(!customer.held, "CREDIT_HOLD", "Account is on hold.");
    this.inventory.warehouse(actor, String(q.warehouse_id));
    const lines = JSON.parse(String(q.lines)) as CommercialLine[];
    const policy = this.catalog.purchasingSnapshot(
      actor,
      customer.id,
      lines.map((l) => l.productId),
    );
    check(
      policy.hash === q.policy_version,
      "POLICY_CHANGED",
      "Customer terms or purchasing rules changed; obtain and accept a new quote.",
    );
    for (const line of lines) {
      const current = this.catalog.price(actor, line.productId, customer.id);
      check(
        (overrides.get(line.productId)?.unitPrice ?? current.unitPrice) ===
          line.unitPrice &&
          tax(
            overrides.get(line.productId)?.unitPrice ?? current.unitPrice,
            current.product.tax_bp,
          ) === line.unitTax &&
          current.product.currency === q.currency,
        "PRICE_CHANGED",
        "Price or tax changed; obtain and accept a new quote.",
      );
    }
    return policy;
  }
  private acceptQuote(
    actor: Actor,
    q: import("./core.ts").Row,
    allowBackorder: boolean,
    approval?: { requestId: string; revision: number; expectedHash: string },
  ): OrderAcceptResult {
    this.database.requireTransaction();
    const policy = this.validateAcceptance(actor, q, allowBackorder);
    if (policy.requiresReview || approval) {
      permit(actor, ["commercial"]);
      check(
        approval,
        "REVIEW_REQUIRED",
        "This purchase requires distributor approval.",
      );
      const request = this.reviewRequestCurrent(actor, approval.requestId);
      check(
        request.status === "awaiting_approval" &&
          request.revision === approval.revision &&
          request.expectedHash === approval.expectedHash &&
          request.quoteId === q.id &&
          request.allowBackorder === allowBackorder,
        "REVIEW_CHANGED",
        "The reviewed request changed; reopen it before approving.",
      );
    }
    check(!q.order_id, "REQUEST_STATE", "Quote is already accepted.");
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
    this.store.run(
      "UPDATE orders_shipping_snapshots SET order_id=? WHERE org_id=? AND quote_id=?",
      orderId,
      actor.orgId,
      String(q.id),
    );
    this.priceOverrides.accepted(actor, String(q.id), orderId);
    for (const l of lines) {
      const allocated = this.inventory.reserve(
        actor,
        orderId,
        l.productId,
        String(q.warehouse_id),
        l.quantity,
      );
      check(
        allowBackorder || allocated === l.quantity,
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
      String(q.id),
    );
    this.platform.event(actor, "orders.accepted", orderId, {
      accountId: q.account_id,
      total: q.total,
      currency: q.currency,
    });
    return { id: orderId, status: "accepted", orderId };
  }
  reviewRequests(actor: Actor, after?: string): OrderRequestPage {
    return this.database.transaction(() => {
      actor = this.amendmentActor(actor, true);
      const params: SQLInputValue[] = [actor.orgId];
      let where = "org_id=?";
      if (actor.role === "buyer") {
        this.identity.customer(actor, actor.accountId!);
        where += " AND account_id=?";
        params.push(actor.accountId);
      }
      if (after !== undefined) {
        const cursor = this.reviewRequestCurrent(actor, after);
        where += " AND (created_at<? OR (created_at=? AND id<?))";
        params.push(cursor.createdAt, cursor.createdAt, cursor.id);
      }
      const rows = this.store.all<{ id: string }>(
        `SELECT id FROM orders_review_requests WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT 21`,
        ...params,
      );
      return {
        items: rows
          .slice(0, 20)
          .map((r) => this.reviewRequestCurrent(actor, r.id)),
        next: rows.length > 20 ? rows[19]!.id : null,
      };
    });
  }
  reviewRequest(actor: Actor, requestId: string): OrderRequest {
    return this.database.transaction(() =>
      this.reviewRequestCurrent(actor, requestId),
    );
  }
  private reviewRequestCurrent(actor: Actor, requestId: string): OrderRequest {
    actor = this.amendmentActor(actor, true);
    const r = this.requestRow(actor, requestId);
    // A withdrawn entitlement must still permit reading and withdrawing the retained request.
    const policy = this.catalog.purchasingReviewSnapshot(
      actor,
      String(r.account_id),
      (JSON.parse(String(r.lines)) as CommercialLine[]).map((l) => l.productId),
    );
    const history = this.store
      .all<{
        revision: number;
        action: string;
        message: string;
        staff_note: string;
        actor_id: string;
        created_at: string;
      }>(
        "SELECT revision,action,message,staff_note,actor_id,created_at FROM orders_review_history WHERE org_id=? AND request_id=? ORDER BY revision DESC",
        actor.orgId,
        requestId,
      )
      .map((h) => ({
        revision: h.revision,
        action: h.action,
        message: h.message,
        actorId: h.actor_id,
        createdAt: h.created_at,
        ...(actor.role === "buyer" ? {} : { staffNote: h.staff_note }),
      }));
    return {
      id: String(r.id),
      accountId: String(r.account_id),
      warehouseId: String(r.warehouse_id),
      quoteId: String(r.quote_id),
      revision: Number(r.revision),
      status: String(r.status) as OrderRequestStatus,
      lines: JSON.parse(String(r.lines)),
      shipping: this.quoteShipping(actor, String(r.quote_id)),
      total: Number(r.total),
      currency: String(r.currency),
      allowBackorder: r.allow_backorder === 1,
      expiresAt: Number(r.expires_at),
      reviewReason: String(r.review_reason),
      message: String(r.message),
      orderId: r.order_id === null ? null : String(r.order_id),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      expectedHash: digest(canonical({ r, policy })),
      history,
    };
  }
  private requestRow(actor: Actor, requestId: string) {
    const r = this.store.get(
      "SELECT * FROM orders_review_requests WHERE org_id=? AND id=?",
      actor.orgId,
      text(requestId, "Request ID", 128),
    );
    check(r, "NOT_FOUND", "Order request not found.", 404);
    this.identity.customer(actor, String(r.account_id));
    return r;
  }
  private recordReview(
    actor: Actor,
    requestId: string,
    action: string,
    message: string,
    staffNote: string,
  ) {
    const r = this.requestRow(actor, requestId);
    this.store.run(
      "INSERT INTO orders_review_history VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      actor.orgId,
      requestId,
      Number(r.revision),
      action,
      message,
      staffNote,
      actor.id,
      now(),
      String(r.quote_id),
      String(r.lines),
      Number(r.total),
      String(r.currency),
      Number(r.allow_backorder),
      Number(r.expires_at),
      String(r.policy_hash),
      String(r.review_reason),
    );
    this.platform.audit(actor, "order.request." + action, requestId, {
      revision: r.revision,
    });
  }
  decideReview(actor: Actor, key: string, input: OrderRequestDecisionInput) {
    return this.platform.command(
      actor,
      "order.request.decide",
      key,
      input,
      () => {
        actor = this.amendmentActor(actor, true);
        permit(actor, ["commercial"]);
        this.requestRow(actor, input.requestId);
      },
      () => {
        const request = this.reviewRequestCurrent(actor, input.requestId);
        integer(input.revision, "Request revision", 1, Number.MAX_SAFE_INTEGER);
        check(
          request.status === "awaiting_approval" &&
            request.revision === input.revision &&
            request.expectedHash === input.expectedHash,
          "REVIEW_CHANGED",
          "Request or policy changed; reopen the current review.",
        );
        check(
          ["approve", "decline", "request_information"].includes(input.action),
          "VALIDATION",
          "Choose a review decision.",
          400,
        );
        const message = text(
          input.message,
          "Buyer-visible decision message",
          1000,
        );
        const staffNote =
          input.staffNote === undefined || input.staffNote === ""
            ? ""
            : text(input.staffNote, "Staff note", 2000);
        let orderId: string | null = null;
        if (input.action === "approve") {
          const result = this.acceptQuote(
            actor,
            this.reviewQuote(actor, request.quoteId),
            request.allowBackorder,
            input,
          );
          check(
            result.status === "accepted",
            "REQUEST_STATE",
            "Approval did not accept an order.",
          );
          orderId = result.orderId;
        }
        const status =
          input.action === "approve"
            ? "accepted"
            : input.action === "decline"
              ? "declined"
              : "information_needed";
        this.store.run(
          "UPDATE orders_review_requests SET status=?,revision=revision+1,message=?,order_id=?,updated_at=? WHERE org_id=? AND id=?",
          status,
          message,
          orderId,
          now(),
          actor.orgId,
          request.id,
        );
        this.recordReview(actor, request.id, input.action, message, staffNote);
        return this.reviewRequestCurrent(actor, request.id);
      },
    );
  }
  private reviewReceipt(actor: Actor, request: OrderRequest): OrderRequest {
    // Saved command receipts must follow the caller's current role too.
    if (actor.role !== "buyer") return request;
    return {
      ...request,
      history: request.history.map(
        ({ staffNote: _staffNote, ...entry }) => entry,
      ),
    };
  }
  withdrawReview(actor: Actor, key: string, input: OrderRequestWithdrawInput) {
    const result = this.platform.command(
      actor,
      "order.request.withdraw",
      key,
      input,
      () => {
        actor = this.amendmentActor(actor, true);
        this.requestRow(actor, input.requestId);
      },
      () => {
        const r = this.requestRow(actor, input.requestId);
        check(
          ["awaiting_approval", "information_needed"].includes(
            String(r.status),
          ) && r.revision === input.revision,
          "REVISION",
          "Request changed or cannot be withdrawn.",
        );
        this.store.run(
          "UPDATE orders_review_requests SET status='withdrawn',revision=revision+1,updated_at=? WHERE org_id=? AND id=?",
          now(),
          actor.orgId,
          input.requestId,
        );
        this.recordReview(actor, input.requestId, "withdraw", "Withdrawn", "");
        return this.reviewRequestCurrent(actor, input.requestId);
      },
    );
    return this.reviewReceipt(actor, result);
  }
  resubmitReview(actor: Actor, key: string, input: OrderRequestResubmitInput) {
    const result = this.platform.command(
      actor,
      "order.request.resubmit",
      key,
      input,
      () => {
        actor = this.amendmentActor(actor, true);
        this.requestRow(actor, input.requestId);
        this.reviewQuote(actor, input.quoteId);
      },
      () => {
        const r = this.requestRow(actor, input.requestId),
          q = this.reviewQuote(actor, input.quoteId);
        check(
          [
            "information_needed",
            "withdrawn",
            "declined",
            "awaiting_approval",
          ].includes(String(r.status)) && r.revision === input.revision,
          "REVISION",
          "Request changed or cannot be resubmitted.",
        );
        check(
          q.account_id === r.account_id &&
            q.warehouse_id === r.warehouse_id &&
            !q.order_id,
          "REQUEST_SCOPE",
          "Choose an unaccepted quote for the same customer and warehouse.",
        );
        const linked = this.store.get<{ request_id: string }>(
          "SELECT request_id FROM orders_review_quotes WHERE org_id=? AND quote_id=?",
          actor.orgId,
          input.quoteId,
        );
        check(
          !linked || linked.request_id === input.requestId,
          "REQUEST_STATE",
          "Quote belongs to another request.",
        );
        const policy = this.validateAcceptance(actor, q, input.allowBackorder),
          message = text(input.message, "Resubmission message", 1000);
        this.store.run(
          "UPDATE orders_review_requests SET status='awaiting_approval',quote_id=?,revision=revision+1,lines=?,total=?,currency=?,allow_backorder=?,expires_at=?,policy_hash=?,review_reason=?,message=?,updated_at=? WHERE org_id=? AND id=?",
          input.quoteId,
          String(q.lines),
          Number(q.total),
          String(q.currency),
          Number(input.allowBackorder),
          Number(q.expires_at),
          policy.hash,
          policy.reviewReason ||
            "Renewed submission of a request already in distributor review.",
          message,
          now(),
          actor.orgId,
          input.requestId,
        );
        this.store.run(
          "INSERT INTO orders_review_quotes VALUES(?,?,?) ON CONFLICT(org_id,quote_id) DO NOTHING",
          actor.orgId,
          input.quoteId,
          input.requestId,
        );
        this.recordReview(actor, input.requestId, "resubmit", message, "");
        return this.reviewRequestCurrent(actor, input.requestId);
      },
    );
    return this.reviewReceipt(actor, result);
  }
  private incomingRows(
    actor: Actor,
    orderId?: string,
    purchaseLineId?: string,
  ) {
    return this.store.all<IncomingRow>(
      `SELECT * FROM orders_incoming_commitments WHERE org_id=? ${orderId ? "AND order_id=?" : ""} ${purchaseLineId ? "AND purchase_line_id=?" : ""} ORDER BY priority,created_at,rowid`,
      actor.orgId,
      ...(orderId ? [orderId] : []),
      ...(purchaseLineId ? [purchaseLineId] : []),
    );
  }
  private incomingOpen(actor: Actor, lineId: string) {
    return this.store.get<{ quantity: number }>(
      "SELECT COALESCE(SUM(quantity-converted-released),0) AS quantity FROM orders_incoming_commitments WHERE org_id=? AND line_id=?",
      actor.orgId,
      lineId,
    )!.quantity;
  }
  incomingSupply(actor: Actor, orderId: string): IncomingSupplyReview {
    return this.database.transaction(() => {
      actor = this.orderReader(actor);
      const order = this.order(actor, orderId),
        rows = this.incomingRows(actor, order.id),
        lines = this.lines(actor, order.id);
      const candidates = ["admin", "commercial"].includes(actor.role)
        ? this.procurement
            .incomingSupply(
              actor,
              order.warehouse_id,
              lines.map((l) => l.product_id),
            )
            .map((l) => ({
              ...l,
              availableQuantity:
                l.remainingQuantity -
                this.incomingRows(actor, undefined, l.purchaseLineId).reduce(
                  (sum, c) =>
                    sum + c.quantity - c.held - c.converted - c.released,
                  0,
                ),
            }))
        : [];
      return {
        orderId: order.id,
        revision: order.revision,
        state: order.state,
        lines: lines.map((l) => {
          const commitments = rows.filter((r) => r.line_id === l.id),
            incoming = commitments.reduce(
              (sum, c) => sum + c.quantity - c.held - c.converted - c.released,
              0,
            ),
            held = commitments.reduce((sum, c) => sum + c.held, 0),
            outstanding = l.quantity - l.shipped - l.canceled;
          return {
            lineId: l.id,
            productId: l.product_id,
            description: l.description,
            outstanding,
            allocated: l.allocated,
            incoming,
            held,
            uncovered: outstanding - l.allocated - incoming - held,
          };
        }),
        commitments: rows.map((c) => ({
          id: c.id,
          lineId: c.line_id,
          poId: c.po_id,
          purchaseLineId: c.purchase_line_id,
          quantity: c.quantity,
          pendingQuantity: c.quantity - c.held - c.converted - c.released,
          heldQuantity: c.held,
          convertedQuantity: c.converted,
          releasedQuantity: c.released,
          priority: c.priority,
          reason: c.reason,
          createdAt: c.created_at,
        })),
        candidates,
      };
    });
  }
  private incomingRecord(
    actor: Actor,
    c: IncomingRow,
    action: string,
    quantity: number,
    reference: string,
    reason: string,
  ) {
    this.store.run(
      "INSERT INTO orders_incoming_history VALUES(?,?,?,?,?,?,?,?,?)",
      id(),
      actor.orgId,
      c.id,
      action,
      quantity,
      reference,
      reason,
      actor.id,
      now(),
    );
    this.platform.event(actor, "orders.incoming." + action, c.order_id, {
      commitmentId: c.id,
      quantity,
      reference,
      reason,
    });
  }
  private incomingWritable(actor: Actor, orderId: string, revision: number) {
    const order = this.order(actor, orderId);
    integer(revision, "Order revision", 1, Number.MAX_SAFE_INTEGER);
    check(
      order.state === "open" && order.revision === revision,
      "REVISION",
      "Order changed or is closed; refresh incoming supply.",
    );
    return order;
  }
  commitIncoming(
    actor: Actor,
    key: string,
    input: {
      orderId: string;
      lineId: string;
      revision: number;
      poId: string;
      purchaseLineId: string;
      quantity: number;
      priority: number;
      reason: string;
    },
  ) {
    return this.platform.command(
      actor,
      "order.incoming.commit",
      key,
      input,
      () => {
        actor = this.reservationActor(actor, true);
        this.order(actor, input.orderId);
      },
      () => {
        const order = this.incomingWritable(
            actor,
            input.orderId,
            input.revision,
          ),
          line = this.lines(actor, order.id).find((l) => l.id === input.lineId),
          quantity = integer(input.quantity, "Incoming quantity", 1, 100000),
          priority = integer(input.priority, "Incoming priority", 1, 999),
          reason = text(input.reason, "Incoming commitment reason", 1000);
        check(line, "NOT_FOUND", "Order line not found.", 404);
        this.assertReservationCurrent(actor, order.id);
        check(
          !this.identity.customer(actor, order.account_id).held,
          "CREDIT_HOLD",
          "Account is on hold.",
        );
        check(
          quantity <=
            line.quantity -
              line.shipped -
              line.canceled -
              line.allocated -
              this.incomingOpen(actor, line.id),
          "INCOMING_DEMAND",
          "Incoming quantity exceeds uncovered customer demand.",
        );
        const supply = this.procurement
          .incomingSupply(actor, order.warehouse_id, [line.product_id])
          .find(
            (l) =>
              l.poId === input.poId &&
              l.purchaseLineId === input.purchaseLineId,
          );
        check(
          supply,
          "INCOMING_SUPPLY",
          "Choose an open purchase line for this product and warehouse.",
        );
        const pending = this.incomingRows(
          actor,
          undefined,
          supply.purchaseLineId,
        ).reduce(
          (sum, c) => sum + c.quantity - c.held - c.converted - c.released,
          0,
        );
        check(
          quantity <= supply.remainingQuantity - pending,
          "INCOMING_CAPACITY",
          "Other customer commitments already use that incoming supply. Refresh availability.",
        );
        const commitmentId = id();
        this.store.run(
          "INSERT INTO orders_incoming_commitments(id,org_id,order_id,line_id,po_id,purchase_line_id,quantity,priority,reason,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
          commitmentId,
          actor.orgId,
          order.id,
          line.id,
          supply.poId,
          supply.purchaseLineId,
          quantity,
          priority,
          reason,
          actor.id,
          now(),
        );
        const c = this.incomingRows(actor, order.id).find(
          (r) => r.id === commitmentId,
        )!;
        this.incomingRecord(
          actor,
          c,
          "committed",
          quantity,
          supply.poId,
          reason,
        );
        this.refresh(actor, order.id);
        return {
          id: commitmentId,
          orderId: order.id,
          revision: order.revision + 1,
        };
      },
    );
  }
  private releaseIncomingQuantity(
    actor: Actor,
    c: IncomingRow,
    quantity: number,
    reason: string,
    reference: string,
  ) {
    integer(quantity, "Incoming release quantity", 1, 100000);
    check(
      quantity <= c.quantity - c.converted - c.released,
      "INCOMING_QUANTITY",
      "Release exceeds this commitment's pending and held quantity.",
    );
    let releaseHeld = Math.max(
      0,
      quantity - (c.quantity - c.held - c.converted - c.released),
    );
    const held = releaseHeld;
    for (const h of this.inventory.incomingHolds(actor, c.id)) {
      if (!releaseHeld) break;
      const q = Math.min(releaseHeld, h.quantity - h.settled);
      this.inventory.settleIncomingHold(actor, h.id, q, false);
      releaseHeld -= q;
    }
    check(!releaseHeld, "INCOMING_STOCK", "Incoming hold quantities differ.");
    this.store.run(
      "UPDATE orders_incoming_commitments SET released=released+?,held=held-? WHERE org_id=? AND id=?",
      quantity,
      held,
      actor.orgId,
      c.id,
    );
    this.incomingRecord(actor, c, "released", quantity, reference, reason);
  }
  releaseIncoming(
    actor: Actor,
    key: string,
    input: {
      orderId: string;
      commitmentId: string;
      revision: number;
      quantity: number;
      reason: string;
    },
  ) {
    return this.platform.command(
      actor,
      "order.incoming.release",
      key,
      input,
      () => {
        actor = this.reservationActor(actor, true);
        this.order(actor, input.orderId);
      },
      () => {
        const order = this.incomingWritable(
            actor,
            input.orderId,
            input.revision,
          ),
          c = this.incomingRows(actor, order.id).find(
            (r) => r.id === input.commitmentId,
          );
        check(c, "NOT_FOUND", "Incoming commitment not found.", 404);
        this.releaseIncomingQuantity(
          actor,
          c,
          input.quantity,
          text(input.reason, "Release reason", 1000),
          order.id,
        );
        this.refresh(actor, order.id);
        return { id: c.id, orderId: order.id, revision: order.revision + 1 };
      },
    );
  }
  prioritizeIncoming(
    actor: Actor,
    key: string,
    input: {
      orderId: string;
      commitmentId: string;
      revision: number;
      priority: number;
      reason: string;
    },
  ) {
    return this.platform.command(
      actor,
      "order.incoming.priority",
      key,
      input,
      () => {
        actor = this.reservationActor(actor, true);
        this.order(actor, input.orderId);
      },
      () => {
        const order = this.incomingWritable(
            actor,
            input.orderId,
            input.revision,
          ),
          c = this.incomingRows(actor, order.id).find(
            (r) => r.id === input.commitmentId,
          ),
          priority = integer(input.priority, "Incoming priority", 1, 999),
          reason = text(input.reason, "Priority reason", 1000);
        check(c, "NOT_FOUND", "Incoming commitment not found.", 404);
        check(
          c.quantity > c.held + c.converted + c.released,
          "INCOMING_QUANTITY",
          "Only pending incoming supply can be reprioritized.",
        );
        this.store.run(
          "UPDATE orders_incoming_commitments SET priority=? WHERE org_id=? AND id=?",
          priority,
          actor.orgId,
          c.id,
        );
        this.incomingRecord(actor, c, "priority", 0, String(priority), reason);
        this.refresh(actor, order.id);
        return { id: c.id, orderId: order.id, revision: order.revision + 1 };
      },
    );
  }
  /** Owning receipt task; Procurement calls inside the same stock receipt transaction. */
  receiveIncoming(
    actor: Actor,
    input: {
      poId: string;
      purchaseLineId: string;
      receiptId: string;
      unitIds: string[];
      quantity: number;
    },
  ) {
    this.database.requireTransaction();
    actor = this.orderReader(actor);
    permit(actor, ["warehouse"]);
    let remaining = input.quantity;
    for (const c of this.incomingRows(actor, undefined, input.purchaseLineId)) {
      const pending = c.quantity - c.held - c.converted - c.released;
      if (!pending || !remaining) continue;
      check(
        c.po_id === input.poId,
        "INCOMING_SUPPLY",
        "Incoming purchase identity differs.",
      );
      const order = this.order(actor, c.order_id),
        line = this.lines(actor, order.id).find((l) => l.id === c.line_id)!;
      const quantity = Math.min(pending, remaining);
      this.inventory.holdIncoming(actor, {
        commitmentId: c.id,
        orderId: order.id,
        productId: line.product_id,
        warehouseId: order.warehouse_id,
        unitIds: input.unitIds,
        quantity,
      });
      this.store.run(
        "UPDATE orders_incoming_commitments SET held=held+? WHERE org_id=? AND id=?",
        quantity,
        actor.orgId,
        c.id,
      );
      this.incomingRecord(
        actor,
        c,
        "arrived",
        quantity,
        input.receiptId,
        "Received against the customer's incoming commitment.",
      );
      remaining -= quantity;
      this.settleIncomingCommitment(actor, { ...c, held: c.held + quantity });
      this.refresh(actor, order.id);
    }
  }
  private settleIncomingCommitment(actor: Actor, c: IncomingRow) {
    const order = this.order(actor, c.order_id),
      blocked =
        order.state !== "open" ||
        this.reservationStatus(actor, order.id).overdue ||
        this.identity.customer(actor, order.account_id).held;
    let converted = 0,
      released = 0;
    for (const h of this.inventory.incomingHolds(actor, c.id)) {
      const u = this.inventory.unit(actor, h.unit_id),
        q = h.quantity - h.settled;
      if (u.condition === "damaged") {
        this.inventory.settleIncomingHold(actor, h.id, q, false);
        released += q;
        this.incomingRecord(
          actor,
          c,
          "inspection-released",
          q,
          u.id,
          "Failed inspection released the customer earmark; demand needs replacement supply.",
        );
      } else if (u.condition === "usable" && !blocked) {
        this.inventory.settleIncomingHold(actor, h.id, q, true);
        converted += q;
        this.incomingRecord(
          actor,
          c,
          "reserved",
          q,
          u.id,
          "Inspected usable arrival converted to a physical reservation.",
        );
      }
    }
    if (converted || released)
      this.store.run(
        "UPDATE orders_incoming_commitments SET held=held-?,converted=converted+?,released=released+? WHERE org_id=? AND id=?",
        converted + released,
        converted,
        released,
        actor.orgId,
        c.id,
      );
    if (converted)
      this.store.run(
        "UPDATE orders_lines SET allocated=allocated+? WHERE org_id=? AND id=?",
        converted,
        actor.orgId,
        c.line_id,
      );
    return converted + released;
  }
  inspectIncoming(actor: Actor, unitId: string) {
    this.database.requireTransaction();
    actor = this.orderReader(actor);
    permit(actor, ["warehouse"]);
    const commitments = new Set(
      this.inventory
        .incomingHolds(actor, undefined, unitId)
        .map((h) => h.commitment_id),
    );
    for (const c of this.incomingRows(actor).filter((c) =>
      commitments.has(c.id),
    )) {
      if (this.settleIncomingCommitment(actor, c))
        this.refresh(actor, c.order_id);
    }
  }
  reconcileIncoming(
    actor: Actor,
    key: string,
    input: { orderId: string; revision: number; reason: string },
  ) {
    return this.platform.command(
      actor,
      "order.incoming.reconcile",
      key,
      input,
      () => {
        actor = this.reservationActor(actor, true);
        this.order(actor, input.orderId);
      },
      () => {
        const order = this.incomingWritable(
          actor,
          input.orderId,
          input.revision,
        );
        const reason = text(input.reason, "Reconciliation reason", 1000);
        for (const c of this.incomingRows(actor, order.id))
          this.settleIncomingCommitment(actor, c);
        this.platform.audit(
          actor,
          "order.incoming.reconcile.reason",
          order.id,
          { reason },
        );
        this.refresh(actor, order.id);
        return { id: order.id, revision: order.revision + 1 };
      },
    );
  }
  private trimIncoming(
    actor: Actor,
    lineId: string,
    capacity: number,
    reason: string,
  ) {
    const rows = this.store.all<IncomingRow>(
      "SELECT * FROM orders_incoming_commitments WHERE org_id=? AND line_id=? ORDER BY priority DESC,created_at DESC,rowid DESC",
      actor.orgId,
      lineId,
    );
    let excess = Math.max(
      0,
      rows.reduce((sum, c) => sum + c.quantity - c.converted - c.released, 0) -
        capacity,
    );
    for (const c of rows) {
      const quantity = Math.min(excess, c.quantity - c.converted - c.released);
      if (quantity)
        this.releaseIncomingQuantity(actor, c, quantity, reason, lineId);
      excess -= quantity;
    }
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
        actor = this.reservationActor(actor, true);
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
        this.assertReservationCurrent(actor, order.id);
        for (const l of this.lines(actor, order.id)) {
          const qty = this.inventory.reserve(
            actor,
            order.id,
            l.product_id,
            order.warehouse_id,
            l.quantity -
              l.shipped -
              l.canceled -
              l.allocated -
              this.incomingOpen(actor, l.id),
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
  private reservationActor(actor: Actor, write = false) {
    const current = this.amendmentActor(actor);
    if (write) permit(current, ["commercial"]);
    return current;
  }
  private reservationStatus(actor: Actor, orderId: string) {
    const expiresAt =
      this.store.get<{ expires_at: number | null }>(
        "SELECT expires_at FROM orders_reservation_deadlines WHERE org_id=? AND order_id=?",
        actor.orgId,
        orderId,
      )?.expires_at ?? null;
    const expired =
      this.store.get<{ action: "deadline" | "expire" }>(
        "SELECT action FROM orders_reservation_history WHERE org_id=? AND order_id=? ORDER BY revision DESC LIMIT 1",
        actor.orgId,
        orderId,
      )?.action === "expire";
    return {
      expiresAt,
      overdue: expired || (expiresAt !== null && expiresAt <= Date.now()),
    };
  }
  // Owning operation used by allocation and fulfillment inside their native transaction.
  assertReservationCurrent(actor: Actor, orderId: string) {
    this.order(actor, orderId);
    check(
      !this.reservationStatus(actor, orderId).overdue,
      "RESERVATION_EXPIRED",
      "Reservation deadline passed. Commercial staff must review expiry or renew the deadline before new picks or allocations.",
    );
  }
  reservations(actor: Actor, orderId: string, after?: string) {
    actor = this.reservationActor(actor);
    this.order(actor, orderId);
    check(
      after === undefined || /^[1-9][0-9]{0,15}$/.test(after),
      "VALIDATION",
      "Invalid reservation history cursor.",
      400,
    );
    const cursor =
      after === undefined ? Number.MAX_SAFE_INTEGER : Number(after);
    integer(cursor, "reservation history cursor", 1, Number.MAX_SAFE_INTEGER);
    const rows = this.store.all<ReservationHistory>(
      "SELECT * FROM orders_reservation_history WHERE org_id=? AND order_id=? AND revision<? ORDER BY revision DESC LIMIT 21",
      actor.orgId,
      orderId,
      cursor,
    );
    const items = rows
      .slice(0, 20)
      .map((r) => ({ ...r, lines: JSON.parse(String(r.lines)) }));
    return {
      ...this.reservationStatus(actor, orderId),
      items,
      next: rows.length > 20 ? String(items.at(-1)!.revision) : null,
    };
  }
  reservationDeadline(
    actor: Actor,
    key: string,
    input: {
      orderId: string;
      revision: number;
      expiresAt: number | null;
      reason: string;
    },
  ) {
    return this.platform.command(
      actor,
      "order.reservation.deadline",
      key,
      input,
      () => {
        actor = this.reservationActor(actor, true);
        this.order(actor, input.orderId);
      },
      () => {
        const order = this.order(actor, input.orderId),
          reason = text(input.reason, "buyer-visible reservation reason", 1000),
          previous = this.reservationStatus(actor, order.id).expiresAt;
        integer(input.revision, "order revision", 1, Number.MAX_SAFE_INTEGER);
        check(
          order.state === "open" && order.revision === input.revision,
          "REVISION",
          "Order changed or is closed; refresh before reviewing reservations.",
        );
        if (input.expiresAt !== null) {
          integer(input.expiresAt, "reservation deadline", 1, 253402300799999);
          check(
            input.expiresAt > Date.now(),
            "VALIDATION",
            "Choose a future reservation deadline.",
            400,
          );
        }
        check(
          previous !== input.expiresAt,
          "NO_CHANGE",
          "Reservation deadline must change.",
        );
        this.store.run(
          "INSERT INTO orders_reservation_deadlines VALUES(?,?,?) ON CONFLICT(org_id,order_id) DO UPDATE SET expires_at=excluded.expires_at",
          actor.orgId,
          order.id,
          input.expiresAt,
        );
        this.refresh(actor, order.id);
        return this.recordReservation(
          actor,
          order,
          "deadline",
          previous,
          input.expiresAt,
          [],
          reason,
        );
      },
    );
  }
  expireReservations(
    actor: Actor,
    key: string,
    input: {
      orderId: string;
      revision: number;
      reason: string;
    },
  ) {
    return this.platform.command(
      actor,
      "order.reservation.expire",
      key,
      input,
      () => {
        actor = this.reservationActor(actor, true);
        this.order(actor, input.orderId);
      },
      () => {
        const order = this.order(actor, input.orderId),
          reason = text(input.reason, "buyer-visible expiry reason", 1000),
          status = this.reservationStatus(actor, order.id);
        integer(input.revision, "order revision", 1, Number.MAX_SAFE_INTEGER);
        check(
          order.state === "open" && order.revision === input.revision,
          "REVISION",
          "Order changed or is closed; refresh before reviewing reservations.",
        );
        check(
          status.overdue,
          "NOT_DUE",
          "Reservation deadline has not passed.",
        );
        const allocations = this.inventory.allocations(actor, order.id),
          orderLines = this.lines(actor, order.id);
        check(
          allocations.every(
            (a) =>
              a.quantity === a.consumed + a.released ||
              orderLines.some((l) => l.product_id === a.product_id),
          ),
          "ALLOCATION",
          "Order reservations require reconciliation.",
        );
        const changes = orderLines.map((line) => {
          const open = allocations.filter(
              (a) => a.product_id === line.product_id,
            ),
            released = open.reduce(
              (sum, a) =>
                sum +
                (a.stage === "reserved"
                  ? a.quantity - a.consumed - a.released
                  : 0),
              0,
            ),
            retainedPicked = open.reduce(
              (sum, a) =>
                sum +
                (a.stage === "picked"
                  ? a.quantity - a.consumed - a.released
                  : 0),
              0,
            );
          check(
            released + retainedPicked === line.allocated,
            "ALLOCATION",
            "Order reservations require reconciliation.",
          );
          return {
            lineId: line.id,
            productId: line.product_id,
            released,
            retainedPicked,
          };
        });
        check(
          changes.some((l) => l.released > 0),
          "NO_CHANGE",
          "No unpicked reservations remain to expire. Picked and packed stock is retained.",
        );
        for (const line of changes) {
          check(
            this.inventory.release(
              actor,
              order.id,
              line.productId,
              line.released,
            ) === line.released,
            "ALLOCATION",
            "Reservation release failed.",
          );
          this.store.run(
            "UPDATE orders_lines SET allocated=allocated-? WHERE org_id=? AND id=?",
            line.released,
            actor.orgId,
            line.lineId,
          );
        }
        this.refresh(actor, order.id);
        return this.recordReservation(
          actor,
          order,
          "expire",
          status.expiresAt,
          status.expiresAt,
          changes,
          reason,
        );
      },
    );
  }
  private recordReservation(
    actor: Actor,
    order: Order,
    action: "deadline" | "expire",
    beforeExpiresAt: number | null,
    expiresAt: number | null,
    lines: {
      lineId: string;
      productId: string;
      released: number;
      retainedPicked: number;
    }[],
    reason: string,
  ) {
    const historyId = id(),
      revision = order.revision + 1;
    this.store.run(
      "INSERT INTO orders_reservation_history VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      historyId,
      actor.orgId,
      order.id,
      revision,
      action,
      beforeExpiresAt,
      expiresAt,
      JSON.stringify(lines),
      reason,
      actor.id,
      now(),
    );
    const result = {
      id: order.id,
      historyId,
      revision,
      action,
      expiresAt,
      lines,
    };
    this.platform.event(
      actor,
      `orders.reservation.${action}`,
      order.id,
      result,
    );
    return result;
  }
  private amendmentActor(actor: Actor, write = false) {
    const current = this.identity.currentActor(actor);
    check(
      !this.identity.security(current).passwordChangeRequired,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before reviewing orders.",
      403,
    );
    permit(
      current,
      write
        ? ["commercial", "buyer"]
        : ["commercial", "buyer", "warehouse", "finance", "support"],
    );
    return current;
  }
  amendments(actor: Actor, orderId: string, after?: string) {
    actor = this.amendmentActor(actor);
    this.order(actor, orderId);
    check(
      after === undefined || /^[1-9][0-9]{0,15}$/.test(after),
      "VALIDATION",
      "Invalid amendment cursor.",
      400,
    );
    const cursor =
      after === undefined ? Number.MAX_SAFE_INTEGER : Number(after);
    integer(cursor, "amendment cursor", 1, Number.MAX_SAFE_INTEGER);
    const rows = this.store.all(
      "SELECT * FROM orders_amendments WHERE org_id=? AND order_id=? AND revision<? ORDER BY revision DESC LIMIT 21",
      actor.orgId,
      orderId,
      cursor,
    );
    const items = rows.slice(0, 20);
    return {
      items,
      next: rows.length > 20 ? String(items.at(-1)!.revision) : null,
    };
  }
  amend(
    actor: Actor,
    key: string,
    input: {
      orderId: string;
      lineId: string;
      revision: number;
      quantity: number;
      allowBackorder: boolean;
      reason: string;
    },
  ) {
    return this.platform.command(
      actor,
      "order.amend",
      key,
      input,
      () => {
        actor = this.amendmentActor(actor, true);
        this.order(actor, input.orderId);
      },
      () => {
        const order = this.order(actor, input.orderId),
          line = this.lines(actor, order.id).find((l) => l.id === input.lineId),
          quantity = integer(input.quantity, "amended quantity", 1, 100000),
          reason = text(input.reason, "amendment reason", 1000);
        integer(input.revision, "order revision", 1, Number.MAX_SAFE_INTEGER);
        check(
          typeof input.allowBackorder === "boolean",
          "VALIDATION",
          "Backorder choice is required.",
          400,
        );
        check(line, "NOT_FOUND", "Order line not found.", 404);
        check(
          order.state === "open" && order.revision === input.revision,
          "REVISION",
          "Order changed or is closed; refresh before amending.",
        );
        check(
          quantity !== line.quantity,
          "QUANTITY",
          "Amended quantity must change.",
        );
        check(
          quantity >= line.shipped + line.canceled,
          "QUANTITY",
          "Shipped or canceled units cannot be removed by amendment.",
        );
        const delta = quantity - line.quantity,
          amount = delta * (line.unit_price + line.unit_tax),
          total = integer(order.total + amount, "amended order total", 0, 1e12);
        let allocatedDelta = 0;
        if (delta > 0) {
          const policy = this.catalog.purchasingSnapshot(
            actor,
            order.account_id,
            [line.product_id],
          );
          check(
            !policy.requiresReview,
            "REVIEW_REQUIRED",
            "Additional quantity requires a new reviewed purchase request.",
          );
          this.assertReservationCurrent(actor, order.id);
          check(
            this.catalog.product(actor, line.product_id).active,
            "PRODUCT",
            "Product is inactive.",
          );
          // Even a zero-price increase must respect a current customer hold.
          check(
            !this.identity.customer(actor, order.account_id).held,
            "CREDIT_HOLD",
            "Account is on hold.",
          );
          if (amount > 0)
            this.billing.increaseExposure(
              actor,
              order.account_id,
              order.id,
              amount,
            );
          allocatedDelta = this.inventory.reserve(
            actor,
            order.id,
            line.product_id,
            order.warehouse_id,
            delta,
          );
          check(
            input.allowBackorder || allocatedDelta === delta,
            "STOCK",
            "Insufficient additional stock; approve backorder or change quantity.",
          );
        } else {
          const backorder =
              line.quantity - line.shipped - line.canceled - line.allocated,
            release = Math.max(0, -delta - backorder);
          check(
            this.inventory.release(
              actor,
              order.id,
              line.product_id,
              release,
            ) === release,
            "ALLOCATION",
            "Reservation release failed.",
          );
          allocatedDelta = release === 0 ? 0 : -release;
          this.billing.releaseExposure(actor, order.id, -amount);
        }
        this.store.run(
          "UPDATE orders_lines SET quantity=?,allocated=allocated+? WHERE org_id=? AND id=?",
          quantity,
          allocatedDelta,
          actor.orgId,
          line.id,
        );
        this.store.run(
          "UPDATE orders_orders SET total=? WHERE org_id=? AND id=?",
          total,
          actor.orgId,
          order.id,
        );
        this.trimIncoming(
          actor,
          line.id,
          quantity -
            line.shipped -
            line.canceled -
            line.allocated -
            allocatedDelta,
          "Order quantity reduced: " + reason,
        );
        if (
          this.lines(actor, order.id).every((l) => l.canceled === l.quantity)
        ) {
          const shipping = this.shipping(actor, order.id);
          if (shipping.net + shipping.tax > 0)
            this.billing.releaseExposure(
              actor,
              order.id,
              shipping.net + shipping.tax,
            );
        }
        this.refresh(actor, order.id);
        const amendmentId = id(),
          revision = order.revision + 1;
        this.store.run(
          "INSERT INTO orders_amendments VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          amendmentId,
          actor.orgId,
          order.id,
          line.id,
          revision,
          line.quantity,
          quantity,
          line.unit_price,
          line.unit_tax,
          order.total,
          total,
          allocatedDelta,
          reason,
          actor.id,
          now(),
        );
        this.platform.event(actor, "orders.amended", order.id, {
          amendmentId,
          lineId: line.id,
          revision,
          beforeQuantity: line.quantity,
          quantity,
          total,
          currency: order.currency,
          allocatedDelta,
        });
        return {
          id: order.id,
          amendmentId,
          revision,
          quantity,
          total,
          allocatedDelta,
        };
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
        actor = this.amendmentActor(actor, true);
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
        this.trimIncoming(
          actor,
          line.id,
          line.quantity -
            line.shipped -
            line.canceled -
            qty -
            line.allocated +
            release,
          "Order cancellation: " + input.reason,
        );
        const remaining = this.lines(actor, order.id);
        if (remaining.every((l) => l.canceled === l.quantity)) {
          const shipping = this.shipping(actor, order.id);
          if (shipping.net + shipping.tax > 0)
            this.billing.releaseExposure(
              actor,
              order.id,
              shipping.net + shipping.tax,
            );
        }
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
    actor = this.orderReader(actor);
    permit(actor, ["warehouse"]);
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
    actor = this.orderReader(actor);
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
