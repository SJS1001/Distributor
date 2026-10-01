// Stable policy identifiers. A choice does not qualify or enable an adapter.
export const providerChoices = [
  { id: "stripe", label: "Stripe" },
  { id: "quickbooks", label: "QuickBooks" },
  { id: "ups", label: "UPS" },
  { id: "fedex", label: "FedEx" },
  { id: "usps", label: "USPS" },
  { id: "canada-post", label: "Canada Post" },
  { id: "purolator", label: "Purolator" },
  { id: "dhl-express", label: "DHL Express" },
] as const;
export type ProviderName = (typeof providerChoices)[number]["id"];
export const providerNames = providerChoices.map((provider) => provider.id);
export const isProviderName = (value: unknown): value is ProviderName =>
  providerChoices.some((provider) => provider.id === value);
