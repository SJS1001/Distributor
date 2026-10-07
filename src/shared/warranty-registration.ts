/** Native local records. Registration is not manufacturer acknowledgement. */
export type ReturnWindowPolicy = {
  revision: number;
  days: number | null;
  updatedAt: string | null;
  reason: string | null;
};
export type ProductWarrantyTerms = {
  productId: string;
  revision: number;
  manufacturer: string | null;
  reference: string | null;
  startsAt: "shipment" | "installation" | null;
  days: number | null;
  notes: string | null;
  updatedAt: string | null;
};
export type InstallationRegistration = {
  revision: number;
  installedOn: string;
  installer: string;
  site: string;
  evidence: string;
  updatedAt: string;
};
export type InstallationRegistrationHistory = InstallationRegistration & {
  reason: string;
  actorId: string;
};
export type ReturnWindowEligibility = {
  policy: ReturnWindowPolicy;
  startsAt: string;
  endAt: string | null;
  assessedAt: string;
  datePosition: "unconfigured" | "before_start" | "within_window" | "elapsed";
  requiresReview: true;
};
export type RegisteredWarrantyEligibility = {
  source: "unconfigured" | "product_terms" | "replacement_inherited";
  startsAt: string | null;
  endAt: string | null;
  assessedAt: string;
  datePosition:
    | "unconfigured"
    | "registration_required"
    | "before_start"
    | "within_dates"
    | "elapsed";
  terms: ProductWarrantyTerms;
  registrationRevision: number;
  provisional: boolean;
  requiresReview: true;
};
export type WarrantyRegistrationReview = {
  unitId: string;
  accountId: string;
  serial: string;
  productId: string;
  shipmentId: string;
  ownershipId: string;
  registration: InstallationRegistration | null;
  history: InstallationRegistrationHistory[];
  terms: ProductWarrantyTerms;
  returnEligibility: ReturnWindowEligibility;
  warrantyEligibility: RegisteredWarrantyEligibility;
};
export type ClaimEligibilitySnapshot = {
  registration: InstallationRegistration | null;
  returnEligibility: ReturnWindowEligibility;
  warrantyEligibility: RegisteredWarrantyEligibility;
  capturedAt: string;
};
export type ClaimEligibilityReview = {
  claimId: string;
  snapshot: ClaimEligibilitySnapshot | null;
  current: ClaimEligibilitySnapshot;
};
export type SaveInstallationRegistration = {
  unitId: string;
  accountId: string;
  shipmentId: string;
  ownershipId: string;
  expectedRevision: number;
  installedOn: string;
  installer: string;
  site: string;
  evidence: string;
  reason: string;
};
export type SaveProductWarrantyTerms = {
  productId: string;
  expectedRevision: number;
  manufacturer: string;
  reference: string;
  startsAt: "shipment" | "installation";
  days: number | null;
  notes: string;
  reason: string;
};
