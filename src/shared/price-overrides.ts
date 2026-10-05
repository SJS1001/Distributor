export type PriceOverrideStatus =
  "active" | "pending" | "approved" | "rejected" | "cleared";
export type PriceOverrideInput = {
  cartId: string;
  cartRevision: number;
  productId: string;
  revision: number;
  unitPrice: number;
  reason: string;
};
export type PriceOverrideDecisionInput = {
  cartId: string;
  cartRevision: number;
  productId: string;
  revision: number;
  decision: "approve" | "reject";
  reason: string;
};
export type PriceOverrideClearInput = Omit<PriceOverrideInput, "unitPrice">;
export type CartPriceOverrides = {
  cartId: string;
  cartRevision: number;
  currency: string;
  lines: {
    productId: string;
    description: string;
    quantity: number;
    ordinaryUnitPrice: number;
    override: null | {
      revision: number;
      unitPrice: number;
      status: PriceOverrideStatus;
      reason: string;
      proposerId: string;
      actorId: string;
      createdAt: string;
      stale: boolean;
      consumed: boolean;
      canApprove: boolean;
      approvalReasons: string[];
    };
  }[];
  history: {
    productId: string;
    revision: number;
    unitPrice: number | null;
    status: PriceOverrideStatus;
    reason: string;
    proposerId: string;
    actorId: string;
    createdAt: string;
  }[];
};
