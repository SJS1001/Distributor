import type { CustomerProduct } from "./customer-products.ts";
// At most this many add-ons are suggested with one main unit.
export const MAX_ADDONS = 12;
export type ProductAddonEntry = {
  id: string;
  sku: string;
  name: string;
  active: boolean;
};
export type ProductAddons = {
  productId: string;
  addons: ProductAddonEntry[];
  revision: number;
};
export type ProductAddonsInput = {
  productId: string;
  addonIds: string[];
  revision: number;
  reason: string;
};
export type CustomerAddonSuggestions = {
  suggestions: { productId: string; addons: CustomerProduct[] }[];
};
