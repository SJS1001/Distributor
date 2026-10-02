// Internal, organization-scoped projections from each owning module. Integers
// remain decimal strings; the application reads all four in one transaction.
export type OrderSalesEvidence = {
  orders: {
    id: string;
    account: string;
    warehouse: string;
    currency: string;
  }[];
  lines: {
    id: string;
    order: string;
    product: string;
    shipped: string;
    price: string;
    tax: string;
  }[];
};
export type FulfillmentSalesEvidence = {
  id: string;
  order: string;
  account: string;
  warehouse: string;
  state: string;
  invoice: string | null;
  lines: string;
  units: string;
}[];
export type InventorySalesEvidence = {
  allocations: {
    id: string;
    order: string;
    product: string;
    warehouse: string;
    unit: string;
    consumed: string;
    unitProduct: string | null;
  }[];
  movements: {
    id: string;
    shipment: string;
    unit: string;
    product: string | null;
    warehouse: string;
    quantity: string;
    cost: string;
  }[];
};
export type BillingSalesEvidence = {
  invoices: {
    id: string;
    order: string;
    shipment: string;
    account: string;
    currency: string;
    opening: number;
  }[];
  lines: {
    id: string;
    invoice: string;
    product: string;
    quantity: string;
    price: string;
    tax: string;
  }[];
};
