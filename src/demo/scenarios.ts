export const paymentScenarios = [
  "success",
  "unpaid",
  "expired",
  "pending-refund",
  "failed-refund",
] as const;
export type PaymentScenario = (typeof paymentScenarios)[number];
