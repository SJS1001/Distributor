export const countQueueStates = [
  "draft",
  "submitted",
  "approved",
  "rejected",
] as const;
export type CountQueueState = (typeof countQueueStates)[number];
export type CountQueueInput = { state?: CountQueueState; after?: string };
