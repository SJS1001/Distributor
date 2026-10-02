export type SupplierChoice = {
  id: string;
  name: string;
  active: boolean;
  revision: number;
};
export type SupplierPage = {
  items: SupplierChoice[];
  next: string | null;
};
export type SupplierAvailabilityChange = {
  id: string;
  revision: number;
  active: boolean;
  actorId: string;
  reason: string;
  createdAt: string;
};
export type SupplierAvailabilityReview = {
  supplier: SupplierChoice;
  changes: SupplierAvailabilityChange[];
  next: string | null;
};
