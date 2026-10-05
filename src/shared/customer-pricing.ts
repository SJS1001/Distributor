/** Integer basis points: 8000 means MSRP × 0.80; null preserves tier pricing. */
export type PricingPolicy = {
  accountId: string;
  multiplierBp: number | null;
  displayMode: "detailed" | "net_only";
  revision: number;
};
export type PricingPolicyInput = PricingPolicy & { reason: string };
export type ProductMsrp = {
  productId: string;
  msrpCents: number | null;
  revision: number;
};
export type ProductMsrpInput = ProductMsrp & { reason: string };
export type PriceDisplay = {
  msrpCents: number;
  discountBp: number;
  savingsCents: number;
};
export type PricingHistoryEntry = {
  id: string;
  accountId: string | null;
  productId: string | null;
  kind: "policy" | "msrp" | "tier";
  before: unknown;
  after: unknown;
  reason: string;
  actorId: string;
  createdAt: string;
};
