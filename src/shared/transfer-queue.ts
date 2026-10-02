export const transferQueueStates = [
  "transit",
  "partially-received",
  "partially-reconciled",
  "received",
  "reconciled-with-loss",
] as const;
export type TransferQueueState = (typeof transferQueueStates)[number];
export type TransferQueueInput = { state?: TransferQueueState; after?: string };
