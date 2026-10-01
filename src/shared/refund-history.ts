export type RefundSummary = {
  id: string;
  invoice_id: string;
  payment_id: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  reference: string;
  state: string;
  created_at: string;
  provider: string;
  provider_reference: string | null;
  provider_status: string | null;
};
export type RefundPage = { items: RefundSummary[]; next: string | null };
export type RefundObservation = {
  id: number;
  reference: string;
  status: string;
  applied: boolean;
  observedAt: string;
};
export type RefundObservationPage = {
  items: RefundObservation[];
  next: number | null;
};
