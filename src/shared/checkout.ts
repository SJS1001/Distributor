export type CheckoutObservation = {
  id: string;
  effectId: string;
  invoiceId: string;
  observedAt: string;
  source: "send" | "reconcile" | "refresh" | "close";
  outcome: "verified" | "not_found" | "unverified";
  reference: string | null;
  amount: number;
  currency: string;
  status: "open" | "complete" | "expired" | null;
  paymentStatus: "unpaid" | "paid" | "no_payment_required" | null;
  expiresAt: number | null;
};
export type CheckoutHistoryPage = {
  items: CheckoutObservation[];
  next: string | null;
};

// Hosted test checkout is the only supported payment navigation target.
export function checkoutUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "checkout.stripe.com" &&
      !url.port &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
