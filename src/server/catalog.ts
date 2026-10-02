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
  private store: Store;
  constructor(
    private database: Database,
    private platform: Platform,
    private identity: Identity,
  ) {
    this.store = database.owned("catalog");
    this.store.migrate(`
      CREATE TABLE IF NOT EXISTS catalog_products(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,sku TEXT NOT NULL,name TEXT NOT NULL,serialized INTEGER NOT NULL CHECK(serialized IN(0,1)),unit_price INTEGER NOT NULL CHECK(unit_price>=0),tax_bp INTEGER NOT NULL CHECK(tax_bp BETWEEN 0 AND 10000),currency TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,UNIQUE(org_id,sku)) STRICT;
      CREATE TABLE IF NOT EXISTS catalog_prices(org_id TEXT NOT NULL,product_id TEXT NOT NULL,tier TEXT NOT NULL,unit_price INTEGER NOT NULL CHECK(unit_price>=0),PRIMARY KEY(org_id,product_id,tier)) STRICT;
    `);
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
  product(actor: Actor, productId: string): Product {
    actor = this.catalogReader(actor);
    const row = this.store.get<Product>(
      "SELECT * FROM catalog_products WHERE org_id=? AND id=?",
      actor.orgId,
      productId,
    );
    check(row, "NOT_FOUND", "Product not found.", 404);
    return row;
  }
  products(actor: Actor) {
    actor = this.catalogReader(actor);
    return this.store.all<Product>(
      "SELECT * FROM catalog_products WHERE org_id=? AND active=1 ORDER BY sku",
      actor.orgId,
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
    return product;
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
      const products = this.store.all<Omit<CustomerProduct, "unit_tax">>(
        `SELECT p.id,p.sku,p.name,p.serialized,
         COALESCE(t.unit_price,p.unit_price) AS unit_price,p.tax_bp,p.currency
         FROM catalog_products p LEFT JOIN catalog_prices t
         ON t.org_id=p.org_id AND t.product_id=p.id AND t.tier=?
         WHERE p.org_id=? AND p.active=1 ORDER BY p.sku,p.id`,
        customer.tier,
        actor.orgId,
      );
      return products.map((product) => {
        check(
          product.currency === customer.currency,
          "CURRENCY",
          "Cross-currency ordering is not supported.",
        );
        return {
          ...product,
          unit_tax: tax(product.unit_price, product.tax_bp),
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
      const rows = this.store.all<Omit<CustomerProduct, "unit_tax">>(
        `SELECT p.id,p.sku,p.name,p.serialized,COALESCE(t.unit_price,p.unit_price) AS unit_price,p.tax_bp,p.currency
         FROM catalog_products p LEFT JOIN catalog_prices t ON t.org_id=p.org_id AND t.product_id=p.id AND t.tier=?
         WHERE p.org_id=? AND p.active=1 AND (?='' OR instr(lower(p.sku),lower(?))>0 OR instr(lower(p.name),lower(?))>0)
         ${cursor ? "AND (p.sku>? OR (p.sku=? AND p.id>?))" : ""}
         ORDER BY p.sku,p.id LIMIT 21`,
        customer.tier,
        actor.orgId,
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
        return {
          ...product,
          unit_tax: tax(product.unit_price, product.tax_bp),
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
    const rows = this.store.all<Omit<SelectedCustomerProduct, "unit_tax">>(
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
      return { ...product, unit_tax: tax(product.unit_price, product.tax_bp) };
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
      unitPrice: Number(tier?.unit_price ?? product.unit_price),
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
        this.store.run(
          "INSERT INTO catalog_prices VALUES(?,?,?,?) ON CONFLICT(org_id,product_id,tier) DO UPDATE SET unit_price=excluded.unit_price",
          actor.orgId,
          input.productId,
          text(input.tier, "tier"),
          integer(input.unitPrice, "unit price", 0, 1e9),
        );
        return { id: input.productId };
      },
    );
  }
}
