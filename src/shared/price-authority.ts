export type PriceApprovalPolicy = {
  maxDiscountBp: number | null;
  minMarginBp: number | null;
  revision: number;
};
export type PriceApprovalPolicyInput = PriceApprovalPolicy & { reason: string };
export type ReviewedUnitCost = {
  productId: string;
  unitCostCents: number | null;
  currency: string;
  revision: number;
};
export type ReviewedUnitCostInput = Omit<ReviewedUnitCost, "currency"> & {
  reason: string;
};
export type PriceAuthorityHistoryEntry = {
  id: string;
  productId: string | null;
  kind: "cost" | "policy";
  before: unknown;
  after: unknown;
  reason: string;
  actorId: string;
  createdAt: string;
};
export type PriceAuthorityHistoryPage = {
  items: PriceAuthorityHistoryEntry[];
  next: string | null;
};
