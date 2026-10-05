import { CatalogPriceAuthority } from "./catalog-price-authority.ts";
import type {
  PriceApprovalPolicyInput,
  ReviewedUnitCostInput,
} from "../shared/price-authority.ts";
import { CATALOG_REFERENCE_INITIALIZE } from "./catalog-reference-schema.ts";
import { validateReference } from "./catalog-reference-index.ts";
import type {
  ProductReference,
  ProductReferenceInput,
  RequestedReference,
  CustomerReferenceResult,
} from "../shared/catalog-reference.ts";
import { CUSTOMER_PRICING_INITIALIZE } from "./customer-pricing-schema.ts";
import type {
  PricingPolicy,
  PricingPolicyInput,
  ProductMsrp,
  ProductMsrpInput,
  PricingHistoryEntry,
} from "../shared/customer-pricing.ts";
import { PRODUCT_AVAILABILITY_INITIALIZE } from "./product-availability-schema.ts";
import type {
  ProductAvailability,
  ProductAvailabilityInput,
} from "../shared/product-availability.ts";
import { purchasingInitialize } from "./purchasing-schema.ts";
import type {
  PurchasingPolicy,
  PurchasingPolicyInput,
  ProductPurchasingPolicy,
  ProductPurchasingPolicyInput,
} from "../shared/purchasing.ts";
import {
  canonical,
  check,
  digest,
  id,
  integer,
  permit,
  tax,
  text,
  type Actor,
  type Role,
} from "./core.ts";
import {
  importFields,
  type MasterMapping,
  type MasterReview,
} from "./import-manifest.ts";
import { Database, type Store } from "./database.ts";
import { Identity } from "./iam.ts";
import { Platform } from "./platform.ts";
import type {
  CustomerProduct,
  CustomerProductPage,
  SelectedCustomerProduct,
} from "../shared/customer-products.ts";
import type {
  CatalogLifecycleInput,
  CatalogLifecyclePage,
  CatalogReview,
  CatalogPage,
  CatalogProduct,
} from "../shared/catalog-lifecycle.ts";
export type Product = {
  id: string;
  org_id: string;
  sku: string;
  name: string;
  serialized: number;
  unit_price: number;
  tax_bp: number;
  currency: string;
  active: number;
};
export class Catalog {
  private priceAuthority: CatalogPriceAuthority;
  private store: Store;
  constructor(
    private database: Database,
    private platform: Platform,
    private identity: Identity,
  ) {
    this.store = database.owned("catalog");
    this.store.migrate(purchasingInitialize("catalog"));
    this.store.migrate(PRODUCT_AVAILABILITY_INITIALIZE);
    this.store.migrate(CUSTOMER_PRICING_INITIALIZE);
    this.store.migrate(CATALOG_REFERENCE_INITIALIZE);
    this.store.migrate(`
      CREATE TABLE IF NOT EXISTS catalog_products(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,sku TEXT NOT NULL,name TEXT NOT NULL,serialized INTEGER NOT NULL CHECK(serialized IN(0,1)),unit_price INTEGER NOT NULL CHECK(unit_price>=0),tax_bp INTEGER NOT NULL CHECK(tax_bp BETWEEN 0 AND 10000),currency TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,UNIQUE(org_id,sku)) STRICT;
      CREATE TABLE IF NOT EXISTS catalog_prices(org_id TEXT NOT NULL,product_id TEXT NOT NULL,tier TEXT NOT NULL,unit_price INTEGER NOT NULL CHECK(unit_price>=0),PRIMARY KEY(org_id,product_id,tier)) STRICT;
    `);
    this.priceAuthority = new CatalogPriceAuthority(
      database,
      platform,
      identity,
      this,
    );
  }
  priceApprovalPolicy(actor: Actor) {
    return this.priceAuthority.readPolicy(actor);
  }
  setPriceApprovalPolicy(
    actor: Actor,
    key: string,
    input: PriceApprovalPolicyInput,
  ) {
    return this.priceAuthority.setPolicy(actor, key, input);
  }
  reviewedUnitCost(actor: Actor, productId: string) {
    return this.priceAuthority.readCost(actor, productId);
  }
  setReviewedUnitCost(actor: Actor, key: string, input: ReviewedUnitCostInput) {
    return this.priceAuthority.setCost(actor, key, input);
  }
  priceAuthorityHistory(
    actor: Actor,
    filter: { productId?: string; after?: string },
  ) {
    return this.priceAuthority.history(actor, filter);
  }
  assessPriceOverride(
    actor: Actor,
    accountId: string,
    productId: string,
    unitPrice: number,
  ) {
    return this.priceAuthority.assess(actor, accountId, productId, unitPrice);
  }
  private catalogActor(actor: Actor, roles: Role[]) {
    actor = this.identity.currentActor(actor);
    permit(actor, roles);
    check(
      !this.identity.security(actor).passwordChangeRequired,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before accessing the catalog.",
      403,
    );
    return actor;
  }
  private catalogReader(actor: Actor) {
    return this.catalogActor(actor, [
      "warehouse",
      "commercial",
      "finance",
      "warranty",
      "support",
      "buyer",
    ]);
  }
  purchasingPolicy(actor: Actor, accountId: string): PurchasingPolicy {
    actor = this.catalogActor(actor, ["commercial", "buyer"]);
    this.identity.customer(actor, text(accountId, "Customer ID", 128));
    const row = this.store.get<{
      mode: PurchasingPolicy["mode"];
      requires_review: number;
      revision: number;
    }>(
      "SELECT mode,requires_review,revision FROM catalog_account_policies WHERE org_id=? AND account_id=?",
      actor.orgId,
      accountId,
    );
    return {
      accountId,
      mode: row?.mode ?? "none",
      requiresReview: row?.requires_review === 1,
      revision: row?.revision ?? 0,
      productIds: this.store
        .all<{ product_id: string }>(
          "SELECT product_id FROM catalog_entitlements WHERE org_id=? AND account_id=? ORDER BY product_id",
          actor.orgId,
          accountId,
        )
        .map((p) => p.product_id),
    };
  }
  setPurchasingPolicy(actor: Actor, key: string, input: PurchasingPolicyInput) {
    return this.platform.command(
      actor,
      "catalog.purchasing.set",
      key,
      input,
      () => {
        actor = this.catalogActor(actor, ["commercial"]);
        this.identity.customer(actor, input.accountId);
      },
      () => {
        const before = this.purchasingPolicy(actor, input.accountId);
        integer(input.revision, "Policy revision", 0, Number.MAX_SAFE_INTEGER);
        check(
          before.revision === input.revision,
          "REVISION",
          "Purchasing policy changed; refresh before saving.",
        );
        check(
          ["none", "all", "selected"].includes(input.mode) &&
            typeof input.requiresReview === "boolean",
          "VALIDATION",
          "Choose an access policy and review requirement.",
          400,
        );
        check(
          Array.isArray(input.productIds) &&
            input.productIds.length <= 1000 &&
            new Set(input.productIds).size === input.productIds.length &&
            (input.mode === "selected" || input.productIds.length === 0),
          "VALIDATION",
          "Choose at most 1000 unique products for selected access.",
          400,
        );
        input.productIds.forEach((p) =>
          this.product(actor, text(p, "Product ID", 128)),
        );
        const reason = text(input.reason, "Policy change reason", 1000);
        this.store.run(
          "INSERT INTO catalog_account_policies VALUES(?,?,?,?,?) ON CONFLICT(org_id,account_id) DO UPDATE SET mode=excluded.mode,requires_review=excluded.requires_review,revision=excluded.revision",
          actor.orgId,
          input.accountId,
          input.mode,
          Number(input.requiresReview),
          input.revision + 1,
        );
        this.store.run(
          "DELETE FROM catalog_entitlements WHERE org_id=? AND account_id=?",
          actor.orgId,
          input.accountId,
        );
        for (const productId of input.productIds)
          this.store.run(
            "INSERT INTO catalog_entitlements VALUES(?,?,?)",
            actor.orgId,
            input.accountId,
            productId,
          );
        const policy = this.purchasingPolicy(actor, input.accountId);
        this.platform.audit(
          actor,
          "catalog.purchasing.changed",
          input.accountId,
          { before, policy, reason },
        );
        return policy;
      },
    );
  }
  productPurchasingPolicy(
    actor: Actor,
    productId: string,
  ): ProductPurchasingPolicy {
    actor = this.catalogActor(actor, ["commercial"]);
    this.product(actor, productId);
    return this.productPolicy(actor, productId);
  }
  private productPolicy(
    actor: Actor,
    productId: string,
  ): ProductPurchasingPolicy {
    const row = this.store.get<{ requires_review: number; revision: number }>(
      "SELECT requires_review,revision FROM catalog_product_policies WHERE org_id=? AND product_id=?",
      actor.orgId,
      productId,
    );
    return {
      productId,
      requiresReview: row?.requires_review === 1,
      revision: row?.revision ?? 0,
    };
  }
  setProductPurchasingPolicy(
    actor: Actor,
    key: string,
    input: ProductPurchasingPolicyInput,
  ) {
    return this.platform.command(
      actor,
      "catalog.product-purchasing.set",
      key,
      input,
      () => {
        actor = this.catalogActor(actor, ["commercial"]);
        this.product(actor, input.productId);
      },
      () => {
        const before = this.productPurchasingPolicy(actor, input.productId);
        integer(input.revision, "Policy revision", 0, Number.MAX_SAFE_INTEGER);
        check(
          input.revision === before.revision,
          "REVISION",
          "Product purchasing policy changed; refresh before saving.",
        );
        check(
          typeof input.requiresReview === "boolean",
          "VALIDATION",
          "Choose a review requirement.",
          400,
        );
        const reason = text(input.reason, "Policy change reason", 1000);
        this.store.run(
          "INSERT INTO catalog_product_policies VALUES(?,?,?,?) ON CONFLICT(org_id,product_id) DO UPDATE SET requires_review=excluded.requires_review,revision=excluded.revision",
          actor.orgId,
          input.productId,
          Number(input.requiresReview),
          input.revision + 1,
        );
        const policy = this.productPurchasingPolicy(actor, input.productId);
        this.platform.audit(
          actor,
          "catalog.product-purchasing.changed",
          input.productId,
          { before, policy, reason },
        );
        return policy;
      },
    );
  }
  private accountPricing(orgId: string, accountId: string): PricingPolicy {
    const row = this.store.get<{
      multiplier_bp: number | null;
      display_mode: PricingPolicy["displayMode"];
      revision: number;
    }>(
      "SELECT multiplier_bp,display_mode,revision FROM catalog_account_pricing WHERE org_id=? AND account_id=?",
      orgId,
      accountId,
    );
    return {
      accountId,
      multiplierBp: row?.multiplier_bp ?? null,
      displayMode: row?.display_mode ?? "net_only",
      revision: row?.revision ?? 0,
    };
  }
  pricingPolicy(actor: Actor, accountId: string): PricingPolicy {
    return this.database.transaction(() => {
      actor = this.catalogActor(actor, []);
      this.identity.customer(actor, text(accountId, "Customer ID", 128));
      return this.accountPricing(actor.orgId, accountId);
    });
  }
  private msrp(orgId: string, productId: string): ProductMsrp {
    const row = this.store.get<{ msrp_cents: number | null; revision: number }>(
      "SELECT msrp_cents,revision FROM catalog_product_msrp WHERE org_id=? AND product_id=?",
      orgId,
      productId,
    );
    return {
      productId,
      msrpCents: row?.msrp_cents ?? null,
      revision: row?.revision ?? 0,
    };
  }
  productMsrp(actor: Actor, productId: string): ProductMsrp {
    return this.database.transaction(() => {
      actor = this.catalogActor(actor, []);
      this.product(actor, text(productId, "Product ID", 128));
      return this.msrp(actor.orgId, productId);
    });
  }
  private pricingHistoryRecord(
    actor: Actor,
    kind: PricingHistoryEntry["kind"],
    accountId: string | null,
    productId: string | null,
    before: unknown,
    after: unknown,
    reason: string,
  ) {
    this.store.run(
      "INSERT INTO catalog_pricing_history VALUES(?,?,?,?,?,?,?,?,?,?)",
      id(),
      actor.orgId,
      accountId,
      productId,
      kind,
      JSON.stringify(before),
      JSON.stringify(after),
      reason,
      actor.id,
      new Date().toISOString(),
    );
  }
  pricingHistory(
    actor: Actor,
    filter: { accountId?: string; productId?: string; after?: string },
  ): { items: PricingHistoryEntry[]; next: string | null } {
    return this.database.transaction(() => {
      actor = this.catalogActor(actor, []);
      check(
        !!filter.accountId !== !!filter.productId,
        "VALIDATION",
        "Choose one customer or product pricing history.",
        400,
      );
      if (filter.accountId)
        this.identity.customer(
          actor,
          text(filter.accountId, "Customer ID", 128),
        );
      if (filter.productId)
        this.product(actor, text(filter.productId, "Product ID", 128));
      const column = filter.accountId ? "account_id" : "product_id",
        value = (filter.accountId ?? filter.productId)!;
      const cursor =
        filter.after === undefined
          ? undefined
          : this.store.get<{ created_at: string; id: string }>(
              `SELECT created_at,id FROM catalog_pricing_history WHERE org_id=? AND ${column}=? AND id=?`,
              actor.orgId,
              value,
              text(filter.after, "History cursor", 128),
            );
      check(
        filter.after === undefined || cursor,
        "CURSOR",
        "Pricing history cursor is unavailable.",
        400,
      );
      const rows = this.store.all<{
        id: string;
        account_id: string | null;
        product_id: string | null;
        kind: PricingHistoryEntry["kind"];
        before_json: string;
        after_json: string;
        reason: string;
        actor_id: string;
        created_at: string;
      }>(
        `SELECT * FROM catalog_pricing_history WHERE org_id=? AND ${column}=? ${cursor ? "AND (created_at<? OR (created_at=? AND id<?))" : ""} ORDER BY created_at DESC,id DESC LIMIT 21`,
        actor.orgId,
        value,
        ...(cursor ? [cursor.created_at, cursor.created_at, cursor.id] : []),
      );
      const items = rows.slice(0, 20).map((r) => ({
        id: r.id,
        accountId: r.account_id,
        productId: r.product_id,
        kind: r.kind,
        before: JSON.parse(r.before_json),
        after: JSON.parse(r.after_json),
        reason: r.reason,
        actorId: r.actor_id,
        createdAt: r.created_at,
      }));
      return { items, next: rows.length > 20 ? items.at(-1)!.id : null };
    });
  }
  setPricingPolicy(actor: Actor, key: string, input: PricingPolicyInput) {
    return this.platform.command(
      actor,
      "catalog.pricing.set",
      key,
      input,
      () => {
        actor = this.catalogActor(actor, []);
        this.identity.customer(
          actor,
          text(input.accountId, "Customer ID", 128),
        );
      },
      () => {
        integer(
          input.revision,
          "Pricing revision",
          0,
          Number.MAX_SAFE_INTEGER - 1,
        );
        if (input.multiplierBp !== null)
          integer(
            input.multiplierBp,
            "Price multiplier basis points",
            0,
            10000,
          );
        check(
          ["detailed", "net_only"].includes(input.displayMode),
          "VALIDATION",
          "Choose detailed or net-only pricing.",
          400,
        );
        const reason = text(input.reason, "Reason", 1000),
          before = this.accountPricing(actor.orgId, input.accountId);
        check(
          before.revision === input.revision,
          "REVISION",
          "Customer pricing changed; reload before saving.",
        );
        if (input.multiplierBp !== null) {
          const missing = this.store.get<{ sku: string }>(
            `SELECT p.sku FROM catalog_products p WHERE p.org_id=? AND p.active=1 AND ${this.entitlementPredicate()} AND NOT EXISTS(SELECT 1 FROM catalog_product_msrp m WHERE m.org_id=p.org_id AND m.product_id=p.id AND m.msrp_cents IS NOT NULL) ORDER BY p.sku LIMIT 1`,
            actor.orgId,
            input.accountId,
          );
          check(
            !missing,
            "PRICING_MSRP_REQUIRED",
            `Set an explicit MSRP for ${missing?.sku ?? "all eligible products"} before enabling a customer multiplier.`,
          );
        }
        this.store.run(
          "INSERT INTO catalog_account_pricing VALUES(?,?,?,?,?) ON CONFLICT(org_id,account_id) DO UPDATE SET multiplier_bp=excluded.multiplier_bp,display_mode=excluded.display_mode,revision=excluded.revision",
          actor.orgId,
          input.accountId,
          input.multiplierBp,
          input.displayMode,
          input.revision + 1,
        );
        const policy = this.accountPricing(actor.orgId, input.accountId);
        this.pricingHistoryRecord(
          actor,
          "policy",
          input.accountId,
          null,
          before,
          policy,
          reason,
        );
        this.platform.audit(actor, "catalog.pricing.changed", input.accountId, {
          before,
          policy,
          reason,
        });
        return policy;
      },
    );
  }
  setProductMsrp(actor: Actor, key: string, input: ProductMsrpInput) {
    return this.platform.command(
      actor,
      "catalog.product-msrp.set",
      key,
      input,
      () => {
        actor = this.catalogActor(actor, []);
        this.product(actor, text(input.productId, "Product ID", 128));
      },
      () => {
        integer(
          input.revision,
          "MSRP revision",
          0,
          Number.MAX_SAFE_INTEGER - 1,
        );
        if (input.msrpCents !== null)
          integer(input.msrpCents, "MSRP cents", 0, 1e9);
        const reason = text(input.reason, "Reason", 1000),
          before = this.msrp(actor.orgId, input.productId);
        check(
          before.revision === input.revision,
          "REVISION",
          "Product MSRP changed; reload before saving.",
        );
        this.store.run(
          "INSERT INTO catalog_product_msrp VALUES(?,?,?,?) ON CONFLICT(org_id,product_id) DO UPDATE SET msrp_cents=excluded.msrp_cents,revision=excluded.revision",
          actor.orgId,
          input.productId,
          input.msrpCents,
          input.revision + 1,
        );
        const msrp = this.msrp(actor.orgId, input.productId);
        this.pricingHistoryRecord(
          actor,
          "msrp",
          null,
          input.productId,
          before,
          msrp,
          reason,
        );
        this.platform.audit(
          actor,
          "catalog.product-msrp.changed",
          input.productId,
          { before, msrp, reason },
        );
        return msrp;
      },
    );
  }
  private reference(orgId: string, productId: string): ProductReference {
    const row = this.store.get<{
      family_id: string | null;
      model_id: string | null;
      revision: number;
    }>(
      "SELECT family_id,model_id,revision FROM catalog_product_references WHERE org_id=? AND product_id=?",
      orgId,
      productId,
    );
    return {
      productId,
      familyId: row?.family_id ?? null,
      modelId: row?.model_id ?? null,
      revision: row?.revision ?? 0,
    };
  }
  productReference(actor: Actor, productId: string): ProductReference {
    return this.database.transaction(() => {
      actor = this.catalogActor(actor, []);
      this.product(actor, text(productId, "Product ID", 128));
      return this.reference(actor.orgId, productId);
    });
  }
  setProductReference(actor: Actor, key: string, input: ProductReferenceInput) {
    return this.platform.command(
      actor,
      "catalog.reference.set",
      key,
      input,
      () => {
        actor = this.catalogActor(actor, []);
        this.product(actor, text(input.productId, "Product ID", 128));
      },
      () => {
        integer(
          input.revision,
          "Reference revision",
          0,
          Number.MAX_SAFE_INTEGER - 1,
        );
        const reason = text(input.reason, "Reason", 1000);
        if (input.familyId === null)
          check(
            input.modelId === null,
            "REFERENCE",
            "Clearing a reference must also clear the model.",
            400,
          );
        else
          validateReference({
            familyId: input.familyId,
            modelId: input.modelId,
          });
        const before = this.reference(actor.orgId, input.productId);
        check(
          before.revision === input.revision,
          "REVISION",
          "Product reference changed; reload before saving.",
        );
        this.store.run(
          "INSERT INTO catalog_product_references VALUES(?,?,?,?,?) ON CONFLICT(org_id,product_id) DO UPDATE SET family_id=excluded.family_id,model_id=excluded.model_id,revision=excluded.revision",
          actor.orgId,
          input.productId,
          input.familyId,
          input.modelId,
          input.revision + 1,
        );
        const reference = this.reference(actor.orgId, input.productId);
        this.platform.audit(
          actor,
          "catalog.reference.changed",
          input.productId,
          { before, reference, reason },
        );
        return reference;
      },
    );
  }
  customerReference(
    actor: Actor,
    input: RequestedReference,
    requestedAccountId?: string,
  ): CustomerReferenceResult {
    return this.database.transaction(() => {
      actor = this.catalogActor(actor, ["buyer"]);
      check(
        actor.role === "buyer" && actor.accountId,
        "FORBIDDEN",
        "A purchasing account is required.",
        403,
      );
      if (requestedAccountId !== undefined)
        this.identity.customer(
          actor,
          text(requestedAccountId, "Customer ID", 128),
        );
      const customer = this.identity.customer(actor, actor.accountId),
        reference = validateReference(input);
      const ids = this.store
        .all<{ id: string }>(
          `SELECT p.id FROM catalog_products p JOIN catalog_product_references r ON r.org_id=p.org_id AND r.product_id=p.id WHERE p.org_id=? AND p.active=1 AND p.currency=? AND r.family_id=? AND r.model_id IS ? AND ${this.entitlementPredicate()} AND ${this.priceablePredicate()} ORDER BY p.id LIMIT 21`,
          actor.orgId,
          customer.currency,
          reference.familyId,
          reference.modelId,
          actor.accountId,
          actor.accountId,
        )
        .map((r) => r.id);
      const products = this.selectedCustomerProducts(
        actor,
        actor.accountId,
        ids.slice(0, 20),
      )
        .map(({ active: _active, ...product }) => product)
        .sort((a, b) => a.id.localeCompare(b.id));
      return {
        products,
        mapped: products.length > 0,
        truncated: ids.length > 20,
      };
    });
  }
  private priceablePredicate() {
    return `NOT EXISTS(SELECT 1 FROM catalog_account_pricing cp WHERE cp.org_id=p.org_id AND cp.account_id=? AND cp.multiplier_bp IS NOT NULL AND NOT EXISTS(SELECT 1 FROM catalog_product_msrp m WHERE m.org_id=p.org_id AND m.product_id=p.id AND m.msrp_cents IS NOT NULL))`;
  }
  private resolvePrice(
    orgId: string,
    accountId: string,
    product: { id: string; sku: string; unit_price: number },
  ) {
    const policy = this.accountPricing(orgId, accountId),
      msrp = this.msrp(orgId, product.id).msrpCents;
    check(
      policy.multiplierBp === null || msrp !== null,
      "PRICING_MSRP_REQUIRED",
      `An explicit MSRP is required to price ${product.sku}; contact an administrator.`,
    );
    const net =
      policy.multiplierBp === null
        ? product.unit_price
        : Number(
            (BigInt(msrp!) * BigInt(policy.multiplierBp) + 5000n) / 10000n,
          );
    const pricing =
      policy.displayMode === "detailed" && msrp !== null && net <= msrp
        ? {
            msrpCents: msrp,
            savingsCents: msrp - net,
            discountBp:
              msrp === 0
                ? 0
                : Number(
                    (BigInt(msrp - net) * 10000n + BigInt(msrp) / 2n) /
                      BigInt(msrp),
                  ),
          }
        : undefined;
    return { unit_price: net, ...(pricing ? { pricing } : {}) };
  }
  private availability(orgId: string, productId: string): ProductAvailability {
    const row = this.store.get<{
      hidden: number;
      out_of_stock: number;
      expected_available_on: string | null;
      revision: number;
    }>(
      "SELECT hidden,out_of_stock,expected_available_on,revision FROM catalog_product_availability WHERE org_id=? AND product_id=?",
      orgId,
      productId,
    );
    return {
      productId,
      hidden: !!row?.hidden,
      outOfStock: !!row?.out_of_stock,
      expectedAvailableOn: row?.expected_available_on ?? null,
      revision: row?.revision ?? 0,
    };
  }
  productAvailability(actor: Actor, productId: string): ProductAvailability {
    actor = this.catalogActor(actor, ["admin"]);
    this.product(actor, text(productId, "Product ID", 128));
    return this.availability(actor.orgId, productId);
  }
  setProductAvailability(
    actor: Actor,
    key: string,
    input: ProductAvailabilityInput,
  ) {
    return this.platform.command(
      actor,
      "catalog.product-availability.set",
      key,
      input,
      () => {
        actor = this.catalogActor(actor, ["admin"]);
        this.product(actor, text(input.productId, "Product ID", 128));
      },
      () => {
        integer(
          input.revision,
          "Availability revision",
          0,
          Number.MAX_SAFE_INTEGER - 1,
        );
        check(
          typeof input.hidden === "boolean" &&
            typeof input.outOfStock === "boolean",
          "VALIDATION",
          "Choose visibility and availability status.",
          400,
        );
        const date = input.expectedAvailableOn;
        check(
          date === null ||
            (typeof date === "string" &&
              /^\d{4}-\d{2}-\d{2}$/.test(date) &&
              Number.isFinite(Date.parse(date + "T00:00:00Z")) &&
              new Date(date + "T00:00:00Z").toISOString().slice(0, 10) ===
                date),
          "VALIDATION",
          "Expected availability must be a valid YYYY-MM-DD date or null.",
          400,
        );
        const reason = text(input.reason, "Reason", 1000);
        const before = this.availability(actor.orgId, input.productId);
        check(
          before.revision === input.revision,
          "REVISION",
          "Product availability changed; reload before saving.",
        );
        this.store.run(
          "INSERT INTO catalog_product_availability VALUES(?,?,?,?,?,?) ON CONFLICT(org_id,product_id) DO UPDATE SET hidden=excluded.hidden,out_of_stock=excluded.out_of_stock,expected_available_on=excluded.expected_available_on,revision=excluded.revision",
          actor.orgId,
          input.productId,
          Number(input.hidden),
          Number(input.outOfStock),
          date,
          input.revision + 1,
        );
        const availability = this.availability(actor.orgId, input.productId);
        this.platform.audit(
          actor,
          "catalog.product-availability.changed",
          input.productId,
          { before, availability, reason },
        );
        return availability;
      },
    );
  }
  private availabilityDisplay(orgId: string, productId: string) {
    const { outOfStock, expectedAvailableOn } = this.availability(
      orgId,
      productId,
    );
    return { outOfStock, expectedAvailableOn };
  }
  private eligible(actor: Actor, accountId: string, productId: string) {
    if (this.availability(actor.orgId, productId).hidden) return false;
    return !!this.store.get(
      `SELECT 1 AS eligible FROM catalog_account_policies a WHERE a.org_id=? AND a.account_id=? AND (a.mode='all' OR (a.mode='selected' AND EXISTS(SELECT 1 FROM catalog_entitlements e WHERE e.org_id=a.org_id AND e.account_id=a.account_id AND e.product_id=?)))`,
      actor.orgId,
      accountId,
      productId,
    );
  }
  private entitlementPredicate() {
    return `NOT EXISTS(SELECT 1 FROM catalog_product_availability v WHERE v.org_id=p.org_id AND v.product_id=p.id AND v.hidden=1) AND EXISTS(SELECT 1 FROM catalog_account_policies a WHERE a.org_id=p.org_id AND a.account_id=? AND (a.mode='all' OR (a.mode='selected' AND EXISTS(SELECT 1 FROM catalog_entitlements e WHERE e.org_id=a.org_id AND e.account_id=a.account_id AND e.product_id=p.id))))`;
  }
  authorizePurchase(actor: Actor, accountId: string, productId: string) {
    actor = this.catalogActor(actor, ["commercial", "buyer"]);
    this.identity.customer(actor, accountId);
    check(
      this.eligible(actor, accountId, productId),
      "PRODUCT_ACCESS",
      "This product is not available for this customer's purchasing account.",
      403,
    );
    const product = this.product(actor, productId);
    check(product.active === 1, "PRODUCT", "Product is inactive.");
    return product;
  }
  purchasingSnapshot(actor: Actor, accountId: string, productIds: string[]) {
    actor = this.catalogActor(actor, ["commercial", "buyer"]);
    productIds.forEach((productId) =>
      this.authorizePurchase(actor, accountId, productId),
    );
    return this.purchasingReviewSnapshot(actor, accountId, productIds);
  }
  purchasingReviewSnapshot(
    actor: Actor,
    accountId: string,
    productIds: string[],
  ) {
    actor = this.catalogActor(actor, ["commercial", "buyer"]);
    const customer = this.identity.customer(actor, accountId);
    const policy = this.purchasingPolicy(actor, accountId);
    const products = [...productIds]
      .sort()
      .map((productId) => this.productPolicy(actor, productId));
    return {
      requiresReview:
        policy.requiresReview || products.some((p) => p.requiresReview),
      reviewReason: [
        policy.requiresReview
          ? "Customer purchasing rule requires distributor approval."
          : "",
        products.some((p) => p.requiresReview)
          ? "Product purchasing rule requires distributor approval."
          : "",
      ]
        .filter(Boolean)
        .join(" "),
      hash: digest(canonical({ policy, products, customer })),
    };
  }
  authorizeResourceAccess(actor: Actor, productId: string): Product {
    actor = this.catalogReader(actor);
    const product = this.product(actor, productId);
    if (actor.role === "buyer")
      check(product.active === 1, "NOT_FOUND", "Product unavailable.", 404);
    return product;
  }
  product(actor: Actor, productId: string): Product {
    actor = this.catalogReader(actor);
    const row = this.store.get<Product>(
      "SELECT * FROM catalog_products WHERE org_id=? AND id=?",
      actor.orgId,
      productId,
    );
    check(row, "NOT_FOUND", "Product not found.", 404);
    if (actor.role === "buyer") {
      this.identity.customer(actor, actor.accountId!);
      check(
        this.eligible(actor, actor.accountId!, productId),
        "PRODUCT_ACCESS",
        "Product unavailable for your purchasing account.",
        403,
      );
    }
    return row;
  }
  products(actor: Actor) {
    actor = this.catalogReader(actor);
    return this.store.all<Product>(
      `SELECT p.* FROM catalog_products p WHERE p.org_id=? AND p.active=1 ${actor.role === "buyer" ? "AND " + this.entitlementPredicate() : ""} ORDER BY p.sku`,
      actor.orgId,
      ...(actor.role === "buyer" ? [actor.accountId] : []),
    );
  }
  private staffReader(actor: Actor) {
    actor = this.catalogReader(actor);
    check(
      actor.role !== "buyer",
      "FORBIDDEN",
      "Staff catalog access is not permitted.",
      403,
    );
    return actor;
  }
  productPage(
    actor: Actor,
    after?: string,
    query = "",
    state = "active",
  ): CatalogPage {
    return this.database.transaction(() => {
      actor = this.staffReader(actor);
      check(
        typeof query === "string" && query.length <= 120,
        "VALIDATION",
        "Catalog search must be at most 120 characters.",
        400,
      );
      check(
        ["active", "retired", "all"].includes(state),
        "VALIDATION",
        "Choose active, retired or all products.",
        400,
      );
      const cursor =
        after === undefined
          ? undefined
          : this.store.get<Product>(
              "SELECT * FROM catalog_products WHERE org_id=? AND id=?",
              actor.orgId,
              text(after, "Catalog cursor", 128),
            );
      check(
        after === undefined || cursor,
        "CURSOR",
        "Catalog cursor is unavailable in your current scope.",
        400,
      );
      const rows = this.store.all<Product>(
        `SELECT * FROM catalog_products WHERE org_id=? ${state === "all" ? "" : "AND active=?"}
         AND (?='' OR instr(lower(sku),lower(?))>0 OR instr(lower(name),lower(?))>0)
         ${cursor ? "AND (sku>? OR (sku=? AND id>?))" : ""} ORDER BY sku,id LIMIT 21`,
        actor.orgId,
        ...(state === "all" ? [] : [state === "active" ? 1 : 0]),
        query.trim(),
        query.trim(),
        query.trim(),
        ...(cursor ? [cursor.sku, cursor.sku, cursor.id] : []),
      );
      return {
        items: rows.slice(0, 20).map((p) => this.descriptor(p)),
        next: rows.length > 20 ? rows[19]!.id : null,
      };
    });
  }
  private descriptor(p: Product): CatalogProduct {
    const { org_id: _orgId, ...product } = p;
    return { ...product, availability: this.availability(p.org_id, p.id) };
  }
  lifecycleHistory(
    actor: Actor,
    productId: string,
    after?: string,
  ): CatalogLifecyclePage {
    return this.database.transaction(() =>
      this.lifecycleHistoryRead(actor, productId, after),
    );
  }
  private lifecycleHistoryRead(
    actor: Actor,
    productId: string,
    after?: string,
  ): CatalogLifecyclePage {
    actor = this.catalogActor(actor, ["commercial"]);
    const product = this.product(actor, text(productId, "Product ID", 128));
    const page = this.platform.catalogLifecyclePage(actor, product.id, after);
    return {
      items: page.items.map((row) => {
        let detail: {
          product: CatalogProduct;
          fromActive: number;
          toActive: number;
          reason: string;
          expectedHash: string;
        };
        try {
          detail = JSON.parse(row.detail);
          check(
            detail.product.id === product.id &&
              typeof detail.product.sku === "string" &&
              detail.product.sku.length > 0 &&
              typeof detail.product.name === "string" &&
              detail.product.name.length > 0 &&
              [0, 1].includes(detail.product.serialized) &&
              Number.isSafeInteger(detail.product.unit_price) &&
              detail.product.unit_price >= 0 &&
              Number.isSafeInteger(detail.product.tax_bp) &&
              detail.product.tax_bp >= 0 &&
              detail.product.tax_bp <= 10000 &&
              ["CAD", "USD"].includes(detail.product.currency) &&
              [0, 1].includes(detail.fromActive) &&
              [0, 1].includes(detail.toActive) &&
              detail.fromActive !== detail.toActive &&
              detail.product.active === detail.fromActive &&
              typeof detail.reason === "string" &&
              detail.reason.trim().length > 0 &&
              detail.reason.length <= 1000 &&
              typeof detail.expectedHash === "string" &&
              /^[a-f0-9]{64}$/.test(detail.expectedHash),
            "HISTORY_INTEGRITY",
            "Catalog history is unavailable. Investigate retained evidence.",
            503,
          );
        } catch {
          check(
            false,
            "HISTORY_INTEGRITY",
            "Catalog history is unavailable. Investigate retained evidence.",
            503,
          );
        }
        return {
          ...detail!,
          id: row.id,
          actorId: row.actorId,
          createdAt: row.createdAt,
        };
      }),
      next: page.next,
    };
  }
  lifecycleReview(actor: Actor, productId: string): CatalogReview {
    return this.database.transaction(() =>
      this.lifecycleReviewRead(actor, productId),
    );
  }
  private lifecycleReviewRead(actor: Actor, productId: string): CatalogReview {
    actor = this.catalogActor(actor, ["commercial"]);
    const product = this.product(actor, text(productId, "Product ID", 128));
    const latest =
      this.lifecycleHistoryRead(actor, product.id).items[0]?.id ?? null;
    return {
      product: this.descriptor(product),
      expectedHash: digest(canonical({ product, latest })),
    };
  }
  retire(actor: Actor, key: string, input: CatalogLifecycleInput) {
    return this.changeActivity(actor, key, input, false);
  }
  reactivate(actor: Actor, key: string, input: CatalogLifecycleInput) {
    return this.changeActivity(actor, key, input, true);
  }
  private changeActivity(
    actor: Actor,
    key: string,
    input: CatalogLifecycleInput,
    active: boolean,
  ) {
    return this.platform.command(
      actor,
      active ? "product.reactivate" : "product.retire",
      key,
      input,
      () => {
        actor = this.catalogActor(actor, ["commercial"]);
        this.product(actor, text(input.productId, "Product ID", 128));
      },
      () => {
        const reason = text(input.reason, "Reason", 1000);
        check(
          typeof input.expectedHash === "string" &&
            /^[a-f0-9]{64}$/.test(input.expectedHash),
          "VALIDATION",
          "Review the current product before changing its status.",
          400,
        );
        const reviewed = this.lifecycleReviewRead(actor, input.productId);
        check(
          reviewed.expectedHash === input.expectedHash,
          "REVIEW_CHANGED",
          "Product or lifecycle history changed; reopen the review.",
        );
        check(
          reviewed.product.active === Number(!active),
          "PRODUCT_STATE",
          active ? "Product is already active." : "Product is already retired.",
        );
        this.store.run(
          "UPDATE catalog_products SET active=? WHERE org_id=? AND id=?",
          Number(active),
          actor.orgId,
          input.productId,
        );
        const detail = {
          product: reviewed.product,
          fromActive: reviewed.product.active,
          toActive: Number(active),
          reason,
          expectedHash: input.expectedHash,
        };
        this.platform.audit(
          actor,
          "product.lifecycle",
          input.productId,
          detail,
        );
        return { id: input.productId, active: Number(active) };
      },
    );
  }
  customerProducts(actor: Actor, accountId: string): CustomerProduct[] {
    return this.database.transaction(() => {
      actor = this.catalogActor(actor, ["commercial", "buyer"]);
      const customer = this.identity.customer(
        actor,
        text(accountId, "Customer ID", 128),
      );
      const products = this.store.all<
        Omit<
          CustomerProduct,
          | "unit_tax"
          | "outOfStock"
          | "expectedAvailableOn"
          | "pricing"
          | "unavailableReason"
        >
      >(
        `SELECT p.id,p.sku,p.name,p.serialized,
         COALESCE(t.unit_price,p.unit_price) AS unit_price,p.tax_bp,p.currency
         FROM catalog_products p LEFT JOIN catalog_prices t
         ON t.org_id=p.org_id AND t.product_id=p.id AND t.tier=?
         WHERE p.org_id=? AND p.active=1 AND ${this.entitlementPredicate()} AND ${this.priceablePredicate()} ORDER BY p.sku,p.id`,
        customer.tier,
        actor.orgId,
        accountId,
        accountId,
      );
      return products.map((product) => {
        check(
          product.currency === customer.currency,
          "CURRENCY",
          "Cross-currency ordering is not supported.",
        );
        const resolved = this.resolvePrice(actor.orgId, accountId, product);
        return {
          ...product,
          ...resolved,
          ...this.availabilityDisplay(actor.orgId, product.id),
          unit_tax: tax(resolved.unit_price, product.tax_bp),
        };
      });
    });
  }
  customerProductPage(
    actor: Actor,
    accountId: string,
    after?: string,
    query = "",
  ): CustomerProductPage {
    return this.database.transaction(() => {
      actor = this.catalogActor(actor, ["commercial", "buyer"]);
      const customer = this.identity.customer(
        actor,
        text(accountId, "Customer ID", 128),
      );
      check(
        typeof query === "string" && query.length <= 120,
        "VALIDATION",
        "Catalog search must be at most 120 characters.",
        400,
      );
      const search = query.trim();
      const cursor =
        after === undefined
          ? undefined
          : this.store.get<Product>(
              `SELECT p.* FROM catalog_products p WHERE p.org_id=? AND p.id=? AND p.active=1 AND ${this.entitlementPredicate()}`,
              actor.orgId,
              text(after, "Catalog cursor", 128),
              accountId,
            );
      check(
        after === undefined || cursor,
        "CURSOR",
        "Catalog cursor is unavailable in your current scope.",
        400,
      );
      const rows = this.store.all<
        Omit<
          CustomerProduct,
          | "unit_tax"
          | "outOfStock"
          | "expectedAvailableOn"
          | "pricing"
          | "unavailableReason"
        >
      >(
        `SELECT p.id,p.sku,p.name,p.serialized,COALESCE(t.unit_price,p.unit_price) AS unit_price,p.tax_bp,p.currency
         FROM catalog_products p LEFT JOIN catalog_prices t ON t.org_id=p.org_id AND t.product_id=p.id AND t.tier=?
         WHERE p.org_id=? AND p.active=1 AND ${this.entitlementPredicate()} AND ${this.priceablePredicate()} AND (?='' OR instr(lower(p.sku),lower(?))>0 OR instr(lower(p.name),lower(?))>0)
         ${cursor ? "AND (p.sku>? OR (p.sku=? AND p.id>?))" : ""}
         ORDER BY p.sku,p.id LIMIT 21`,
        customer.tier,
        actor.orgId,
        accountId,
        accountId,
        search,
        search,
        search,
        ...(cursor ? [cursor.sku, cursor.sku, cursor.id] : []),
      );
      const items = rows.slice(0, 20).map((product) => {
        check(
          product.currency === customer.currency,
          "CURRENCY",
          "Cross-currency ordering is not supported.",
        );
        const resolved = this.resolvePrice(actor.orgId, accountId, product);
        return {
          ...product,
          ...resolved,
          ...this.availabilityDisplay(actor.orgId, product.id),
          unit_tax: tax(resolved.unit_price, product.tax_bp),
        };
      });
      return { items, next: rows.length > 20 ? items.at(-1)!.id : null };
    });
  }
  // Owning exact selection inside the order-entry caller's database transaction.
  // Inactive products remain identifiable; absence from a page is not inactivity.
  selectedCustomerProducts(
    actor: Actor,
    accountId: string,
    ids: string[],
  ): SelectedCustomerProduct[] {
    actor = this.catalogActor(actor, ["commercial", "buyer"]);
    const customer = this.identity.customer(
      actor,
      text(accountId, "Customer ID", 128),
    );
    check(
      Array.isArray(ids) &&
        ids.length <= 100 &&
        new Set(ids).size === ids.length,
      "VALIDATION",
      "Maximum 100 unique selected products.",
      400,
    );
    ids.forEach((value) => text(value, "Product ID", 128));
    if (!ids.length) return [];
    for (const productId of ids)
      check(
        this.eligible(actor, accountId, productId),
        "PRODUCT_ACCESS",
        "Saved product is no longer available to this account; remove it from the cart.",
        403,
      );
    const rows = this.store.all<
      Omit<
        SelectedCustomerProduct,
        | "unit_tax"
        | "outOfStock"
        | "expectedAvailableOn"
        | "pricing"
        | "unavailableReason"
      >
    >(
      `SELECT p.id,p.sku,p.name,p.serialized,p.active,COALESCE(t.unit_price,p.unit_price) AS unit_price,p.tax_bp,p.currency
       FROM catalog_products p LEFT JOIN catalog_prices t ON t.org_id=p.org_id AND t.product_id=p.id AND t.tier=?
       WHERE p.org_id=? AND p.id IN (${ids.map(() => "?").join(",")}) ORDER BY p.sku,p.id`,
      customer.tier,
      actor.orgId,
      ...ids,
    );
    check(
      rows.length === ids.length,
      "NOT_FOUND",
      "Saved product is unavailable in this organization.",
      404,
    );
    return rows.map((product) => {
      check(
        product.active !== 1 || product.currency === customer.currency,
        "CURRENCY",
        "Cross-currency ordering is not supported.",
      );
      const unavailable =
        this.accountPricing(actor.orgId, accountId).multiplierBp !== null &&
        this.msrp(actor.orgId, product.id).msrpCents === null;
      const resolved = unavailable
        ? { unit_price: 0 }
        : this.resolvePrice(actor.orgId, accountId, product);
      return {
        ...product,
        ...resolved,
        ...(unavailable
          ? {
              active: 0,
              unavailableReason:
                "An administrator must set MSRP before this product can be ordered.",
            }
          : {}),
        ...this.availabilityDisplay(actor.orgId, product.id),
        unit_tax: tax(resolved.unit_price, product.tax_bp),
      };
    });
  }
  productBySku(actor: Actor, sku: string) {
    actor = this.catalogActor(actor, []);
    const product = this.store.get<Product>(
      "SELECT * FROM catalog_products WHERE org_id=? AND sku=?",
      actor.orgId,
      text(sku, "SKU"),
    );
    check(
      product,
      "NOT_FOUND",
      "Mapped SKU not found in this organization.",
      404,
    );
    return product;
  }
  price(actor: Actor, productId: string, accountId: string) {
    actor = this.catalogReader(actor);
    const product = this.product(actor, productId),
      customer = this.identity.customer(actor, accountId);
    this.authorizePurchase(actor, accountId, productId);
    check(
      product.currency === customer.currency,
      "CURRENCY",
      "Cross-currency ordering is not supported.",
    );
    const tier = this.store.get(
      "SELECT unit_price FROM catalog_prices WHERE org_id=? AND product_id=? AND tier=?",
      actor.orgId,
      productId,
      customer.tier,
    );
    return {
      product,
      unitPrice: this.resolvePrice(actor.orgId, accountId, {
        ...product,
        unit_price: Number(tier?.unit_price ?? product.unit_price),
      }).unit_price,
    };
  }
  reviewImport(actor: Actor, raw: unknown): MasterReview {
    actor = this.catalogActor(actor, []);
    const r = importFields(raw, [
      "sourceId",
      "targetId",
      "sku",
      "name",
      "serialized",
      "unitPrice",
      "taxBasisPoints",
    ]);
    const sourceId = text(r.sourceId, "source row ID"),
      sku = text(r.sku, "SKU"),
      name = text(r.name, "product name"),
      value = integer(r.unitPrice, "unit price", 0, 1e9),
      taxRate = integer(r.taxBasisPoints, "tax basis points", 0, 10000);
    check(
      typeof r.serialized === "boolean",
      "VALIDATION",
      "serialized must be a boolean.",
      400,
    );
    const targetId =
      r.targetId === null ? null : text(r.targetId, "target product ID");
    let targetHash: string | null = null;
    if (targetId) {
      const p = this.product(actor, targetId);
      check(
        p.active === 1 &&
          p.sku === sku &&
          p.name === name &&
          p.serialized === Number(r.serialized) &&
          p.unit_price === value &&
          p.tax_bp === taxRate &&
          p.currency === this.identity.organization(actor).currency,
        "TARGET_MISMATCH",
        "Selected product must be active and match every reviewed field and currency.",
      );
      targetHash = digest(canonical(p));
    } else {
      check(
        !this.store.get(
          "SELECT id FROM catalog_products WHERE org_id=? AND sku=?",
          actor.orgId,
          sku,
        ),
        "TARGET_EXISTS",
        "SKU already exists; explicitly select its matching target ID.",
      );
    }
    return { sourceId, targetId, targetHash, matchKey: sku, name, value };
  }
  // Owning operation inside the migration command's transaction.
  applyImport(actor: Actor, raw: unknown): MasterMapping {
    actor = this.catalogActor(actor, []);
    const reviewed = this.reviewImport(actor, raw),
      r = raw as Record<string, unknown>;
    const targetId = reviewed.targetId ?? id();
    if (!reviewed.targetId)
      this.store.run(
        "INSERT INTO catalog_products(id,org_id,sku,name,serialized,unit_price,tax_bp,currency) VALUES(?,?,?,?,?,?,?,?)",
        targetId,
        actor.orgId,
        reviewed.matchKey,
        reviewed.name,
        Number(r.serialized),
        reviewed.value,
        Number(r.taxBasisPoints),
        this.identity.organization(actor).currency,
      );
    return {
      sourceId: reviewed.sourceId,
      targetId,
      action: reviewed.targetId ? "match" : "create",
      value: reviewed.value,
    };
  }
  create(
    actor: Actor,
    key: string,
    input: {
      sku: string;
      name: string;
      serialized: boolean;
      unitPrice: number;
      taxBasisPoints: number;
    },
  ) {
    return this.platform.command(
      actor,
      "product.create",
      key,
      input,
      () => {
        actor = this.catalogActor(actor, ["commercial"]);
      },
      () => {
        check(
          typeof input.serialized === "boolean",
          "VALIDATION",
          "serialized must be a boolean.",
          400,
        );
        const productId = id(),
          org = this.identity.organization(actor);
        this.store.run(
          "INSERT INTO catalog_products(id,org_id,sku,name,serialized,unit_price,tax_bp,currency) VALUES(?,?,?,?,?,?,?,?)",
          productId,
          actor.orgId,
          text(input.sku, "SKU"),
          text(input.name, "product name"),
          input.serialized ? 1 : 0,
          integer(input.unitPrice, "unit price", 0, 1e9),
          integer(input.taxBasisPoints, "tax basis points", 0, 10000),
          org.currency,
        );
        return { id: productId };
      },
    );
  }
  setPrice(
    actor: Actor,
    key: string,
    input: { productId: string; tier: string; unitPrice: number },
  ) {
    return this.platform.command(
      actor,
      "product.price",
      key,
      input,
      () => {
        actor = this.catalogActor(actor, ["commercial"]);
        this.product(actor, input.productId);
      },
      () => {
        const tier = text(input.tier, "tier");
        const previous = this.store.get<{ unit_price: number }>(
          "SELECT unit_price FROM catalog_prices WHERE org_id=? AND product_id=? AND tier=?",
          actor.orgId,
          input.productId,
          tier,
        );
        this.store.run(
          "INSERT INTO catalog_prices VALUES(?,?,?,?) ON CONFLICT(org_id,product_id,tier) DO UPDATE SET unit_price=excluded.unit_price",
          actor.orgId,
          input.productId,
          text(input.tier, "tier"),
          integer(input.unitPrice, "unit price", 0, 1e9),
        );
        this.pricingHistoryRecord(
          actor,
          "tier",
          null,
          input.productId,
          { tier, unitPrice: previous?.unit_price ?? null },
          { tier, unitPrice: input.unitPrice },
          "Tier price updated",
        );
        return { id: input.productId };
      },
    );
  }
}
