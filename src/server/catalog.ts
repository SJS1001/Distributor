import {
  canonical,
  check,
  digest,
  id,
  integer,
  permit,
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
    database: Database,
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
