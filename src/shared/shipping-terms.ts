export type ShippingTerms = {
  treatment: "included" | "extra" | "unspecified";
  net: number;
  tax: number;
  reason: string;
  revision: number;
};
export type InvoiceShipping = ShippingTerms & {
  charged: boolean;
  lineId: string | null;
};
export const unspecifiedShipping = (): ShippingTerms => ({
  treatment: "unspecified",
  net: 0,
  tax: 0,
  reason: "Shipping terms were not recorded.",
  revision: 0,
});
export function shippingSummary(
  terms: ShippingTerms | undefined,
  currency: string,
) {
  if (!terms || terms.treatment === "unspecified")
    return "Shipping terms unspecified; no separately agreed shipping charge is recorded.";
  if (terms.treatment === "included")
    return "Shipping included in the quoted product prices; no extra shipping charge.";
  const money = (v: number) => `${currency} ${(v / 100).toFixed(2)}`;
  return `Shipping extra: ${money(terms.net)} + ${money(terms.tax)} explicit shipping tax. Charged once on the first shipment invoice; canceled without charge if nothing ships.`;
}
