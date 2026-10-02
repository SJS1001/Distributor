export const stockQueueViews = [
  "available",
  "quarantine",
  "damaged",
  "transit",
  "sold",
  "scrapped",
] as const;
export type StockQueueView = (typeof stockQueueViews)[number];
export const stockQueueLabels: Record<StockQueueView, string> = {
  available: "Available usable stock",
  quarantine: "Quarantined stock",
  damaged: "Damaged stock",
  transit: "In transit",
  sold: "Sold",
  scrapped: "Scrapped",
};
export type StockQueueInput = {
  after?: string;
  query?: string;
  productId?: string;
  warehouseId?: string;
  view?: StockQueueView;
};
