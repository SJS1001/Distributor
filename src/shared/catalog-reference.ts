import type { CustomerProduct } from "./customer-products.ts";
export type RequestedReference = { familyId: string; modelId: string | null };
export type ProductReference = {
  productId: string;
  familyId: string | null;
  modelId: string | null;
  revision: number;
};
export type ProductReferenceInput = ProductReference & { reason: string };
export type CustomerReferenceResult = {
  products: CustomerProduct[];
  mapped: boolean;
  truncated: boolean;
};
