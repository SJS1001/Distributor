import type { ProductAvailability } from "./product-availability.ts";
export type CatalogProduct = {
  availability?: ProductAvailability;
  id: string;
  sku: string;
  name: string;
  serialized: number;
  unit_price: number;
  tax_bp: number;
  currency: string;
  active: number;
};
export type CatalogLifecycleInput = {
  productId: string;
  expectedHash: string;
  reason: string;
};
export type CatalogLifecycleRecord = {
  id: string;
  actorId: string;
  createdAt: string;
  product: CatalogProduct;
  fromActive: number;
  toActive: number;
  reason: string;
  expectedHash: string;
};
export type CatalogLifecyclePage = {
  items: CatalogLifecycleRecord[];
  next: string | null;
};
export type CatalogReview = { product: CatalogProduct; expectedHash: string };
export type CatalogPage = { items: CatalogProduct[]; next: string | null };
