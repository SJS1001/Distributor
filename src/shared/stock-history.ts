export type StockHistoryInput = {
  unitId?: string;
  serial?: string;
  after?: string;
};
export type StockMovement = {
  id: string;
  warehouse_id: string;
  type: string;
  quantity: number;
  unit_cost: number;
  reference: string;
  reason: string;
  actor_id: string;
  currentActorName?: string | null;
  created_at: string;
};
export type StockHistoryPage = {
  unit: {
    id: string;
    product_id: string;
    warehouse_id: string;
    bin: string;
    serial: string | null;
    quantity: number;
    cost: number;
    condition: string;
    state: string;
    revision: number;
  };
  items: StockMovement[];
  next: string | null;
};
