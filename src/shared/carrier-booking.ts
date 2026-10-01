export const carrierNames = [
  "ups",
  "fedex",
  "usps",
  "canada-post",
  "purolator",
  "dhl-express",
] as const;
export type CarrierName = (typeof carrierNames)[number];
export type CarrierAddress = {
  name: string;
  line1: string;
  line2: string;
  city: string;
  province: string;
  postalCode: string;
  country: "US" | "CA";
  phone: string;
};
export type CarrierParcel = {
  weightGrams: number;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
};
export type CarrierPrepare = {
  shipmentId: string;
  previousId: string | null;
  provider: CarrierName;
  service: string;
  origin: CarrierAddress;
  destination: CarrierAddress;
  parcel: CarrierParcel;
  reviewedDestination: string;
  acknowledgment: string;
};
export type CarrierBookingView = {
  id: string;
  shipmentId: string;
  provider: CarrierName;
  state: "pending" | "running" | "unknown" | "booked" | "canceled";
  reviewHash: string;
  service: string;
  origin: CarrierAddress;
  destination: CarrierAddress;
  parcel: CarrierParcel;
  reference: string | null;
  tracking: string | null;
  hasLabel: boolean;
  error: string | null;
  createdAt: string;
};
export type CarrierReview = {
  shipmentId: string;
  booking: CarrierBookingView | null;
};

export type CanadaPostGroupView = {
  id: string;
  warehouseId: string;
  configurationHash: string;
  providerGroupId: string;
  reviewHash: string;
  state: string;
  entries: { bookingId: string; reviewHash: string; state: string }[];
  createdAt: string;
};
export type CanadaPostManifestIdentity = {
  manifestId: string;
  groupId: string;
  configurationHash: string;
  reviewHash: string;
  customerReference: string;
  shipmentIds: string[];
};

export type CarrierClaimTarget =
  | { kind: "booking"; bookingId: string }
  | { kind: "member"; groupId: string; bookingId: string }
  | { kind: "manifest"; groupId: string };
export type CarrierClaimReview = {
  target: CarrierClaimTarget;
  state: string;
  startedAt: number;
  minimumAgeMs: number;
  eligibleAt: number;
  claimHash: string;
};
