export const shipmentQueueStates = [
  "packed",
  "shipped",
  "void",
  "handed_over",
  "collected",
  "in_transit",
  "delayed",
  "lost",
  "returned",
  "delivered",
] as const;
export type ShipmentQueueState = (typeof shipmentQueueStates)[number];
