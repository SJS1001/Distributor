export type ControlIssue = {
  code: string;
  recordId: string;
  expected: string | null;
  actual: string | null;
};
export type ControlIssues = {
  count: number;
  items: ControlIssue[];
  truncated: boolean;
};
export type StockControls = {
  products: number;
  units: number;
  movements: number;
  quantity: string;
  value: string;
  movementQuantity: string;
  movementValue: string;
  issues: ControlIssues;
};
export type BillingControls = {
  invoices: number;
  credits: number;
  payments: number;
  refunds: number;
  total: string;
  credited: string;
  paid: string;
  refunded: string;
  balance: string;
  pendingRefunds: string;
  uncertainRefunds: string;
  issues: ControlIssues;
};
export type SalesControls = {
  orders: number;
  shipments: number;
  invoices: number;
  openingInvoices: number;
  allocations: number;
  movements: number;
  shippedQuantity: string;
  shippedCost: string;
  movementQuantity: string;
  movementCost: string;
  invoicedQuantity: string;
  invoiceNet: string;
  invoiceTax: string;
  issues: ControlIssues;
};
export type Reconciliation = {
  version: 1;
  checkedAt: string;
  snapshotHash: string;
  currency: string;
  stock: StockControls;
  billing: BillingControls;
  sales: SalesControls;
};

export const reconciliationMaxBytes = 524288;
export type ReconciliationReceipt = {
  id: string;
  checkedAt: string;
  currency: string;
  preparedBy: string;
  snapshotHash: string;
  discrepancies: number;
  filename: string;
  bytes: number;
  contentHash: string;
};
export type ReconciliationHistory = {
  items: ReconciliationReceipt[];
  next: string | null;
};
