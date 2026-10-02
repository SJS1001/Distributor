export const invoiceQueueStates = ["unpaid", "settled", "credit"] as const;
export type InvoiceQueueState = (typeof invoiceQueueStates)[number];
export const invoiceQueueLabels: Record<InvoiceQueueState, string> = {
  unpaid: "Unpaid balance",
  settled: "Settled",
  credit: "Credit balance",
};
