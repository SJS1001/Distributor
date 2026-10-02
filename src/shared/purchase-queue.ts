export const purchaseQueueStates = ["open", "received"] as const;
export type PurchaseQueueState = (typeof purchaseQueueStates)[number];
