// Public order-entry projection. Base prices and other tiers stay internal.
export type CustomerProduct = {
  id: string;
  sku: string;
  name: string;
  serialized: number;
  unit_price: number;
  unit_tax: number;
  tax_bp: number;
  currency: string;
};
