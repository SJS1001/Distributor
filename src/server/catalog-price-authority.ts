import type { Catalog } from "./catalog.ts";
import { Database, type Store } from "./database.ts";
import { Identity } from "./iam.ts";
import { Platform } from "./platform.ts";
import {
  check,
  permit,
  text,
  integer,
  id,
  canonical,
  digest,
  type Actor,
} from "./core.ts";
import { PRICE_AUTHORITY_INITIALIZE } from "./catalog-price-authority-schema.ts";
import type {
  PriceApprovalPolicy,
  PriceApprovalPolicyInput,
  ReviewedUnitCost,
  ReviewedUnitCostInput,
  PriceAuthorityHistoryEntry,
  PriceAuthorityHistoryPage,
} from "../shared/price-authority.ts";
/** Internal pricing evidence only. Never copy assessment/evidence/hash into buyer payloads. */
export type PriceOverrideAssessment = {
  ordinaryUnitPrice: number;
  unitPrice: number;
  taxBasisPoints: number;
  currency: string;
  policyRevision: number;
  costRevision: number;
  requiresApproval: boolean;
  reasons: string[];
  authorityHash: string;
  evidence: {
    unitCostCents: number | null;
    maxDiscountBp: number | null;
    minMarginBp: number | null;
  };
};
export class CatalogPriceAuthority {
  private store: Store;
  constructor(
    private database: Database,
    private platform: Platform,
    private identity: Identity,
    private catalog: Catalog,
  ) {
    this.store = database.owned("catalog");
    this.store.migrate(PRICE_AUTHORITY_INITIALIZE);
  }
  private actor(actor: Actor, assessment = false) {
    actor = this.identity.currentActor(actor);
    permit(actor, assessment ? ["commercial", "buyer"] : []);
    const security = this.identity.security(actor);
    check(
      !security.passwordChangeRequired,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before accessing pricing authority.",
      403,
    );
    check(
      !security.mfa.required || security.mfa.enabled,
      "MFA_ENROLLMENT_REQUIRED",
      "Set up an authenticator before accessing pricing authority.",
      403,
    );
    return actor;
  }
  private policy(orgId: string): PriceApprovalPolicy {
    const r = this.store.get<{
      max_discount_bp: number | null;
      min_margin_bp: number | null;
      revision: number;
    }>(
      "SELECT max_discount_bp,min_margin_bp,revision FROM catalog_price_approval_policy WHERE org_id=?",
      orgId,
    );
    return {
      maxDiscountBp: r?.max_discount_bp ?? null,
      minMarginBp: r?.min_margin_bp ?? null,
      revision: r?.revision ?? 0,
    };
  }
  private cost(actor: Actor, productId: string): ReviewedUnitCost {
    const product = this.catalog.product(actor, productId),
      r = this.store.get<{ unit_cost_cents: number | null; revision: number }>(
        "SELECT unit_cost_cents,revision FROM catalog_reviewed_unit_cost WHERE org_id=? AND product_id=?",
        actor.orgId,
        productId,
      );
    return {
      productId,
      unitCostCents: r?.unit_cost_cents ?? null,
      currency: product.currency,
      revision: r?.revision ?? 0,
    };
  }
  readPolicy(actor: Actor) {
    return this.database.transaction(() => {
      actor = this.actor(actor);
      return this.policy(actor.orgId);
    });
  }
  readCost(actor: Actor, productId: string) {
    return this.database.transaction(() => {
      actor = this.actor(actor);
      return this.cost(actor, text(productId, "Product ID", 128));
    });
  }
  private record(
    actor: Actor,
    kind: PriceAuthorityHistoryEntry["kind"],
    productId: string | null,
    before: unknown,
    after: unknown,
    reason: string,
  ) {
    this.store.run(
      "INSERT INTO catalog_price_authority_history VALUES(?,?,?,?,?,?,?,?,?)",
      id(),
      actor.orgId,
      productId,
      kind,
      JSON.stringify(before),
      JSON.stringify(after),
      reason,
      actor.id,
      new Date().toISOString(),
    );
    this.platform.audit(
      actor,
      `catalog.price-authority.${kind}.changed`,
      productId ?? actor.orgId,
      { before, after, reason },
    );
  }
  setPolicy(actor: Actor, key: string, input: PriceApprovalPolicyInput) {
    return this.platform.command(
      actor,
      "catalog.price-approval-policy.set",
      key,
      input,
      () => {
        actor = this.actor(actor);
      },
      () => {
        integer(
          input.revision,
          "Policy revision",
          0,
          Number.MAX_SAFE_INTEGER - 1,
        );
        check(
          (input.maxDiscountBp === null) === (input.minMarginBp === null),
          "VALIDATION",
          "Configure both discount and margin limits, or clear both.",
          400,
        );
        if (input.maxDiscountBp !== null)
          integer(
            input.maxDiscountBp,
            "Maximum discount basis points",
            0,
            10000,
          );
        if (input.minMarginBp !== null)
          integer(input.minMarginBp, "Minimum margin basis points", 0, 10000);
        const reason = text(input.reason, "Reason", 1000),
          before = this.policy(actor.orgId);
        check(
          before.revision === input.revision,
          "REVISION",
          "Price approval policy changed; reload before saving.",
        );
        this.store.run(
          "INSERT INTO catalog_price_approval_policy VALUES(?,?,?,?) ON CONFLICT(org_id) DO UPDATE SET max_discount_bp=excluded.max_discount_bp,min_margin_bp=excluded.min_margin_bp,revision=excluded.revision",
          actor.orgId,
          input.maxDiscountBp,
          input.minMarginBp,
          input.revision + 1,
        );
        const after = this.policy(actor.orgId);
        this.record(actor, "policy", null, before, after, reason);
        return after;
      },
    );
  }
  setCost(actor: Actor, key: string, input: ReviewedUnitCostInput) {
    return this.platform.command(
      actor,
      "catalog.unit-cost.set",
      key,
      input,
      () => {
        actor = this.actor(actor);
        this.catalog.product(actor, text(input.productId, "Product ID", 128));
      },
      () => {
        integer(
          input.revision,
          "Cost revision",
          0,
          Number.MAX_SAFE_INTEGER - 1,
        );
        if (input.unitCostCents !== null)
          integer(input.unitCostCents, "Reviewed unit cost cents", 0, 1e9);
        const reason = text(input.reason, "Reason", 1000),
          before = this.cost(actor, input.productId);
        check(
          before.revision === input.revision,
          "REVISION",
          "Reviewed unit cost changed; reload before saving.",
        );
        this.store.run(
          "INSERT INTO catalog_reviewed_unit_cost VALUES(?,?,?,?) ON CONFLICT(org_id,product_id) DO UPDATE SET unit_cost_cents=excluded.unit_cost_cents,revision=excluded.revision",
          actor.orgId,
          input.productId,
          input.unitCostCents,
          input.revision + 1,
        );
        const after = this.cost(actor, input.productId);
        this.record(actor, "cost", input.productId, before, after, reason);
        return after;
      },
    );
  }
  history(
    actor: Actor,
    filter: { productId?: string; after?: string },
  ): PriceAuthorityHistoryPage {
    return this.database.transaction(() => {
      actor = this.actor(actor);
      const productId =
        filter.productId === undefined
          ? null
          : text(filter.productId, "Product ID", 128);
      if (productId !== null) this.catalog.product(actor, productId);
      const cursor =
        filter.after === undefined
          ? undefined
          : this.store.get<{ id: string; created_at: string }>(
              "SELECT id,created_at FROM catalog_price_authority_history WHERE org_id=? AND product_id IS ? AND id=?",
              actor.orgId,
              productId,
              text(filter.after, "History cursor", 128),
            );
      check(
        filter.after === undefined || cursor,
        "CURSOR",
        "Price authority history cursor unavailable.",
        400,
      );
      const rows = this.store.all<{
        id: string;
        product_id: string | null;
        kind: PriceAuthorityHistoryEntry["kind"];
        before_json: string;
        after_json: string;
        reason: string;
        actor_id: string;
        created_at: string;
      }>(
        `SELECT * FROM catalog_price_authority_history WHERE org_id=? AND product_id IS ? ${cursor ? "AND (created_at<? OR (created_at=? AND id<?))" : ""} ORDER BY created_at DESC,id DESC LIMIT 21`,
        actor.orgId,
        productId,
        ...(cursor ? [cursor.created_at, cursor.created_at, cursor.id] : []),
      );
      const items = rows.slice(0, 20).map((r) => ({
        id: r.id,
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
  assess(
    actor: Actor,
    accountId: string,
    productId: string,
    unitPrice: number,
  ): PriceOverrideAssessment {
    actor = this.actor(actor, true);
    this.database.requireTransaction();
    integer(unitPrice, "Selling unit price cents", 0, 1e9);
    const priced = this.catalog.price(
        actor,
        text(productId, "Product ID", 128),
        text(accountId, "Customer ID", 128),
      ),
      policy = this.policy(actor.orgId),
      cost = this.cost(actor, productId),
      reasons: string[] = [];
    if (policy.maxDiscountBp === null || policy.minMarginBp === null)
      reasons.push("Price approval limits are not configured.");
    else {
      if (
        BigInt(priced.unitPrice - unitPrice) * 10000n >
        BigInt(priced.unitPrice) * BigInt(policy.maxDiscountBp)
      )
        reasons.push("Discount exceeds the configured limit.");
      if (
        cost.unitCostCents !== null &&
        unitPrice > 0 &&
        BigInt(unitPrice - cost.unitCostCents) * 10000n <
          BigInt(unitPrice) * BigInt(policy.minMarginBp)
      )
        reasons.push("Margin is below the configured minimum.");
    }
    if (unitPrice === 0)
      reasons.push("Margin cannot be established for a zero selling price.");
    if (cost.unitCostCents === null)
      reasons.push("Reviewed unit cost is unknown.");
    const evidence = {
      unitCostCents: cost.unitCostCents,
      maxDiscountBp: policy.maxDiscountBp,
      minMarginBp: policy.minMarginBp,
    };
    const facts = {
      orgId: actor.orgId,
      accountId,
      productId,
      ordinaryUnitPrice: priced.unitPrice,
      unitPrice,
      taxBasisPoints: priced.product.tax_bp,
      currency: priced.product.currency,
      policyRevision: policy.revision,
      costRevision: cost.revision,
      evidence,
    };
    return {
      ordinaryUnitPrice: priced.unitPrice,
      unitPrice,
      taxBasisPoints: priced.product.tax_bp,
      currency: priced.product.currency,
      policyRevision: policy.revision,
      costRevision: cost.revision,
      requiresApproval: reasons.length > 0,
      reasons,
      authorityHash: digest(canonical(facts)),
      evidence,
    };
  }
}
