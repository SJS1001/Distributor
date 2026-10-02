export type QueueObservation = {
  id: string;
  label: string;
  states: { state: string; count: number; oldestCreatedAt: string | null }[];
  due?: number;
  registered?: boolean;
  expiredLeases?: number;
  lastCompletedAt?: string | null;
};

export type OperationsHealth = {
  version: 1;
  checkedAt: string;
  region: "CA" | "US";
  recoveryHold: boolean;
  queues: QueueObservation[];
};
