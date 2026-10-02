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
export type Reconciliation = {
  version: 1;
  checkedAt: string;
  currency: string;
  stock: StockControls;
  billing: BillingControls;
};
