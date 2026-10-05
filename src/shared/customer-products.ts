// Public order-entry projection. Base prices and other tiers stay internal.
export type CustomerProduct = {
  outOfStock: boolean;
  expectedAvailableOn: string | null;
  id: string;
  sku: string;
  name: string;
  serialized: number;
  unit_price: number;
  unit_tax: number;
  tax_bp: number;
  currency: string;
};

export type CustomerProductPage = {
  items: CustomerProduct[];
  next: string | null;
};
export type SelectedCustomerProduct = CustomerProduct & { active: number };
export type CartLine = { productId: string; quantity: number };
export type SavedCartPage = {
  items: {
    id: string;
    account_id: string;
    warehouse_id: string;
    revision: number;
    updated_at: string;
    products: number;
    units: number;
  }[];
  next: string | null;
};
export type OrderEntry = {
  cart: {
    id: string;
    account_id: string;
    warehouse_id: string;
    revision: number;
    lines: CartLine[];
  } | null;
  products: SelectedCustomerProduct[];
};
