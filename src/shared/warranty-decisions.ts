export type WarrantyDecision = {
  id: string;
  action: string;
  createdAt: string;
  reason?: string;
  actorId?: string;
};
export type WarrantyDecisionPage = {
  items: WarrantyDecision[];
  next: string | null;
};
