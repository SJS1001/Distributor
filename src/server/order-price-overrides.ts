import type {
  CartPriceOverrides,
  PriceOverrideInput,
  PriceOverrideDecisionInput,
  PriceOverrideClearInput,
  PriceOverrideStatus,
} from "../shared/price-overrides.ts";
import {
  check,
  digest,
  integer,
  now,
  permit,
  text,
  type Actor,
  type Row,
} from "./core.ts";
import type { Database, Store } from "./database.ts";
import type { Catalog } from "./catalog.ts";
import type { Identity } from "./iam.ts";
import type { Inventory } from "./inventory.ts";
import type { Platform } from "./platform.ts";
import { ORDER_PRICE_OVERRIDES_INITIALIZE } from "./order-price-overrides-schema.ts";
type Assessment = ReturnType<Catalog["assessPriceOverride"]>;
type Cart = {
  id: string;
  account_id: string;
  warehouse_id: string;
  revision: number;
  lines: string;
};
type Override = {
  org_id: string;
  cart_id: string;
  product_id: string;
  revision: number;
  cart_revision: number;
  cart_fingerprint: string;
  status: PriceOverrideStatus;
  unit_price: number | null;
  assessment: string;
  reason: string;
  proposer_id: string;
  actor_id: string;
  created_at: string;
};
export class OrderPriceOverrides {
  private store: Store;
  constructor(
    private db: Database,
    private platform: Platform,
    private identity: Identity,
    private catalog: Catalog,
    private inventory: Inventory,
  ) {
    this.store = db.owned("orders");
    this.store.migrate(ORDER_PRICE_OVERRIDES_INITIALIZE);
  }
  private current(actor: Actor, staff = true) {
    const current = this.identity.currentActor(actor),
      security = this.identity.security(current);
    check(
      !security.passwordChangeRequired,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before reviewing price overrides.",
      403,
    );
    check(
      !security.mfa.required || security.mfa.enabled,
      "MFA_ENROLLMENT_REQUIRED",
      "Set up an authenticator before reviewing price overrides.",
      403,
    );
    permit(current, staff ? ["commercial"] : ["commercial", "buyer"]);
    return current;
  }
  private readCart(actor: Actor, cartId: string) {
    const c = this.store.get<Cart>(
      "SELECT * FROM orders_carts WHERE org_id=? AND id=?",
      actor.orgId,
      text(cartId, "Cart", 128),
    );
    check(c, "NOT_FOUND", "Cart not found.", 404);
    this.identity.customer(actor, c.account_id);
    this.inventory.warehouse(actor, c.warehouse_id);
    return c;
  }
  private latest(actor: Actor, cartId: string, productId: string) {
    return this.store.get<Override>(
      "SELECT * FROM orders_price_overrides WHERE org_id=? AND cart_id=? AND product_id=? ORDER BY revision DESC LIMIT 1",
      actor.orgId,
      cartId,
      productId,
    );
  }
  private consumed(actor: Actor, row: Override) {
    return !!this.store.get(
      "SELECT 1 FROM orders_price_override_snapshots WHERE org_id=? AND cart_id=? AND product_id=? AND override_revision=? AND order_id IS NOT NULL LIMIT 1",
      actor.orgId,
      row.cart_id,
      row.product_id,
      row.revision,
    );
  }
  private assessment(actor: Actor, cart: Cart, row: Override) {
    return this.catalog.assessPriceOverride(
      actor,
      cart.account_id,
      row.product_id,
      row.unit_price!,
    );
  }
  private stale(
    actor: Actor,
    cart: Cart,
    row: Override,
    assessment: Assessment,
  ) {
    return (
      row.cart_fingerprint !== digest(cart.lines) ||
      JSON.parse(row.assessment).authorityHash !== assessment.authorityHash
    );
  }
  cart(actor: Actor, cartId: string): CartPriceOverrides {
    return this.db.transaction(() => {
      actor = this.current(actor);
      const cart = this.readCart(actor, cartId);
      const customer = this.identity.customer(actor, cart.account_id);
      return {
        cartId: cart.id,
        cartRevision: cart.revision,
        currency: customer.currency,
        lines: (
          JSON.parse(cart.lines) as { productId: string; quantity: number }[]
        ).map((line) => {
          const p = this.catalog.price(actor, line.productId, cart.account_id),
            r = this.latest(actor, cart.id, line.productId);
          const a =
            r && r.status !== "cleared"
              ? this.assessment(actor, cart, r)
              : null;
          const stale = !!(r && a && this.stale(actor, cart, r, a)),
            consumed = !!(r && this.consumed(actor, r));
          return {
            ...line,
            description: p.product.name,
            ordinaryUnitPrice: p.unitPrice,
            override: r
              ? {
                  revision: r.revision,
                  unitPrice: r.unit_price ?? p.unitPrice,
                  status: r.status,
                  reason: r.reason,
                  proposerId: r.proposer_id,
                  actorId: r.actor_id,
                  createdAt: r.created_at,
                  stale,
                  consumed,
                  canApprove:
                    actor.role === "admin" &&
                    r.status === "pending" &&
                    r.proposer_id !== actor.id &&
                    !stale &&
                    !consumed,
                  approvalReasons: a?.reasons ?? [],
                }
              : null,
          };
        }),
        history: this.store
          .all<Override>(
            "SELECT * FROM orders_price_overrides WHERE org_id=? AND cart_id=? ORDER BY created_at DESC,revision DESC LIMIT 100",
            actor.orgId,
            cart.id,
          )
          .map((r) => ({
            productId: r.product_id,
            revision: r.revision,
            unitPrice: r.unit_price,
            status: r.status,
            reason: r.reason,
            proposerId: r.proposer_id,
            actorId: r.actor_id,
            createdAt: r.created_at,
          })),
      };
    });
  }
  private target(actor: Actor, input: PriceOverrideClearInput) {
    const cart = this.readCart(actor, input.cartId);
    check(
      cart.revision === integer(input.cartRevision, "Cart revision", 1),
      "REVISION",
      "Cart changed; reload the price review.",
    );
    check(
      (JSON.parse(cart.lines) as { productId: string }[]).some(
        (l) => l.productId === input.productId,
      ),
      "PRODUCT",
      "Product is not in the current cart.",
    );
    this.catalog.authorizePurchase(actor, cart.account_id, input.productId);
    const previous = this.latest(actor, cart.id, input.productId);
    check(
      (previous?.revision ?? 0) ===
        integer(input.revision, "Override revision"),
      "REVISION",
      "Price override changed; reload the review.",
    );
    return { cart, previous };
  }
  private append(
    actor: Actor,
    cart: Cart,
    productId: string,
    revision: number,
    status: PriceOverrideStatus,
    unitPrice: number | null,
    assessment: Assessment | null,
    reason: string,
    proposerId: string,
  ) {
    this.store.run(
      "INSERT INTO orders_price_overrides VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
      actor.orgId,
      cart.id,
      productId,
      revision,
      cart.revision,
      digest(cart.lines),
      status,
      unitPrice,
      JSON.stringify(assessment),
      reason,
      proposerId,
      actor.id,
      now(),
    );
    this.platform.audit(actor, "orders.price-override." + status, cart.id, {
      productId,
      revision,
      unitPrice,
      reason,
      proposerId,
      assessment,
    });
    return { cartId: cart.id, productId, revision, status };
  }
  set(actor: Actor, key: string, input: PriceOverrideInput) {
    return this.platform.command(
      actor,
      "cart.price-override.set",
      key,
      input,
      () => {
        actor = this.current(actor);
        const cart = this.readCart(actor, input.cartId);
        this.catalog.authorizePurchase(actor, cart.account_id, input.productId);
      },
      () => {
        const { cart, previous } = this.target(actor, input),
          reason = text(input.reason, "Override reason", 1000),
          unitPrice = integer(input.unitPrice, "Unit selling price", 0, 1e12),
          assessment = this.catalog.assessPriceOverride(
            actor,
            cart.account_id,
            input.productId,
            unitPrice,
          );
        return this.append(
          actor,
          cart,
          input.productId,
          (previous?.revision ?? 0) + 1,
          assessment.requiresApproval ? "pending" : "active",
          unitPrice,
          assessment,
          reason,
          actor.id,
        );
      },
    );
  }
  clear(actor: Actor, key: string, input: PriceOverrideClearInput) {
    return this.platform.command(
      actor,
      "cart.price-override.clear",
      key,
      input,
      () => {
        actor = this.current(actor);
        const cart = this.readCart(actor, input.cartId);
        this.catalog.authorizePurchase(actor, cart.account_id, input.productId);
      },
      () => {
        const { cart, previous } = this.target(actor, input);
        check(previous, "NOT_FOUND", "No override exists.", 404);
        return this.append(
          actor,
          cart,
          input.productId,
          previous.revision + 1,
          "cleared",
          null,
          null,
          text(input.reason, "Clear reason", 1000),
          actor.id,
        );
      },
    );
  }
  decide(actor: Actor, key: string, input: PriceOverrideDecisionInput) {
    return this.platform.command(
      actor,
      "cart.price-override.decide",
      key,
      input,
      () => {
        actor = this.current(actor);
        permit(actor, ["admin"]);
        const cart = this.readCart(actor, input.cartId);
        this.catalog.authorizePurchase(actor, cart.account_id, input.productId);
      },
      () => {
        const { cart, previous } = this.target(actor, input);
        check(
          previous?.status === "pending",
          "OVERRIDE_STATE",
          "Only the current pending exception can be decided.",
        );
        check(
          previous.proposer_id !== actor.id,
          "SEPARATE_APPROVER",
          "A different administrator must decide this price exception.",
          403,
        );
        check(
          input.decision === "approve" || input.decision === "reject",
          "VALIDATION",
          "Choose approve or reject.",
          400,
        );
        const assessment = this.assessment(actor, cart, previous);
        check(
          !this.stale(actor, cart, previous, assessment),
          "PRICE_OVERRIDE_CHANGED",
          "Price, tax, cost, guardrails or cart changed; submit a fresh override.",
        );
        return this.append(
          actor,
          cart,
          input.productId,
          previous.revision + 1,
          input.decision === "approve" ? "approved" : "rejected",
          previous.unit_price,
          assessment,
          text(input.reason, "Decision reason", 1000),
          previous.proposer_id,
        );
      },
    );
  }
  // Internal quote operation: never return the authority assessment to a customer.
  resolve(actor: Actor, cartId: string) {
    this.db.requireTransaction();
    actor = this.current(actor, false);
    const cart = this.readCart(actor, cartId);
    const result = new Map<
      string,
      {
        unitPrice: number;
        ordinaryUnitPrice: number;
        revision: number;
        row: Override;
      }
    >();
    for (const line of JSON.parse(cart.lines) as { productId: string }[]) {
      const row = this.latest(actor, cart.id, line.productId);
      if (!row || row.status === "cleared") continue;
      check(
        row.status === "active" || row.status === "approved",
        "PRICE_OVERRIDE_PENDING",
        "A price override requires a decision or an explicit return to ordinary pricing before quoting.",
      );
      const assessment = this.assessment(actor, cart, row);
      check(
        !this.stale(actor, cart, row, assessment) && !this.consumed(actor, row),
        "PRICE_OVERRIDE_CHANGED",
        "The one-off price review is stale or already used; review or clear it before a fresh quote.",
      );
      if (assessment.requiresApproval) {
        check(
          row.status === "approved",
          "PRICE_OVERRIDE_PENDING",
          "This price exception requires a separate administrator.",
        );
        const approver = this.identity.currentActor({
          ...actor,
          id: row.actor_id,
        });
        permit(approver, ["admin"]);
        const security = this.identity.security(approver);
        check(
          !security.passwordChangeRequired &&
            (!security.mfa.required || security.mfa.enabled),
          "PRICE_OVERRIDE_CHANGED",
          "The approving administrator must complete their current security requirements before this exception can be used.",
          403,
        );
        check(
          approver.id !== row.proposer_id,
          "SEPARATE_APPROVER",
          "A different administrator must approve the exception.",
          403,
        );
      }
      result.set(line.productId, {
        unitPrice: row.unit_price!,
        ordinaryUnitPrice: assessment.ordinaryUnitPrice,
        revision: row.revision,
        row,
      });
    }
    return result;
  }
  capture(
    actor: Actor,
    quoteId: string,
    cartId: string,
    resolved: ReturnType<OrderPriceOverrides["resolve"]>,
  ) {
    for (const [productId, r] of resolved)
      this.store.run(
        "INSERT INTO orders_price_override_snapshots VALUES(?,?,?,?,?,?,NULL)",
        actor.orgId,
        quoteId,
        cartId,
        productId,
        r.revision,
        JSON.stringify(r.row),
      );
  }
  validate(actor: Actor, quote: Row, cartId: string) {
    const resolved = this.resolve(actor, cartId),
      snapshots = this.store.all<{
        product_id: string;
        override_revision: number;
      }>(
        "SELECT product_id,override_revision FROM orders_price_override_snapshots WHERE org_id=? AND quote_id=?",
        actor.orgId,
        String(quote.id),
      );
    check(
      snapshots.length === resolved.size &&
        snapshots.every(
          (s) => resolved.get(s.product_id)?.revision === s.override_revision,
        ),
      "PRICE_OVERRIDE_CHANGED",
      "Price override changed; obtain and accept a fresh quote.",
    );
    return resolved;
  }
  accepted(actor: Actor, quoteId: string, orderId: string) {
    this.store.run(
      "UPDATE orders_price_override_snapshots SET order_id=? WHERE org_id=? AND quote_id=?",
      orderId,
      actor.orgId,
      quoteId,
    );
  }
}
