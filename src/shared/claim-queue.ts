export const claimStates = [
  "submitted",
  "approved",
  "rejected",
  "received",
  "inspected",
  "repair",
  "disposed",
] as const;
export type ClaimState = (typeof claimStates)[number];
export type ClaimQueueQuery = { state?: ClaimState; after?: string };
