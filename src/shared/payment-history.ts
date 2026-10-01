export type PaymentSummary = {
  id: string;
  invoice_id: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  provider: string;
  external_ref: string;
  created_at: string;
};
export type PaymentPage = { items: PaymentSummary[]; next: string | null };
