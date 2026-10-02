export const orderQueueStates = ["open", "closed"] as const;
export type OrderQueueState = (typeof orderQueueStates)[number];
