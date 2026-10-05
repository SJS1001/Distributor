export type PurchasingPolicy = {
  accountId: string;
  mode: "none" | "all" | "selected";
  requiresReview: boolean;
  productIds: string[];
  revision: number;
};
export type PurchasingPolicyInput = PurchasingPolicy & { reason: string };
export type ProductPurchasingPolicy = {
  productId: string;
  requiresReview: boolean;
  revision: number;
};
export type ProductPurchasingPolicyInput = ProductPurchasingPolicy & {
  reason: string;
};
export type OrderRequestStatus =
  | "awaiting_approval"
  | "information_needed"
  | "declined"
  | "withdrawn"
  | "accepted";
export type OrderRequestHistory = {
  revision: number;
  action: string;
  message: string;
  actorId: string;
  createdAt: string;
  staffNote?: string;
};
export type OrderRequest = {
  id: string;
  accountId: string;
  warehouseId: string;
  quoteId: string;
  revision: number;
  status: OrderRequestStatus;
  lines: {
    productId: string;
    description: string;
    quantity: number;
    unitPrice: number;
    unitTax: number;
  }[];
  total: number;
  currency: string;
  allowBackorder: boolean;
  expiresAt: number;
  reviewReason: string;
  message: string;
  orderId: string | null;
  createdAt: string;
  updatedAt: string;
  expectedHash: string;
  history: OrderRequestHistory[];
};
export type OrderRequestPage = { items: OrderRequest[]; next: string | null };
export type OrderAcceptResult =
  | { id: string; status: "accepted"; orderId: string }
  | { id: string; status: "awaiting_approval"; requestId: string };
export type OrderRequestDecisionInput = {
  requestId: string;
  revision: number;
  expectedHash: string;
  action: "approve" | "decline" | "request_information";
  message: string;
  staffNote?: string;
};
export type OrderRequestWithdrawInput = { requestId: string; revision: number };
export type OrderRequestResubmitInput = OrderRequestWithdrawInput & {
  quoteId: string;
  allowBackorder: boolean;
  message: string;
};
