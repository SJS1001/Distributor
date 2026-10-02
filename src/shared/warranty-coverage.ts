export type CoveragePolicy = {
  revision: number;
  days: number;
  configuredAt: string | null;
};
export type CoveragePolicyReview = CoveragePolicy & {
  reason: string | null;
  configuredBy: string | null;
};
export type ClaimCoverageSnapshot = {
  policy: CoveragePolicy | null;
  source: "current_provisional_policy" | "replacement_inherited";
  shippedAt: string;
  coverageEnd: string;
  inheritedFromClaimId: string | null;
  capturedAt: string;
};
export type ClaimCoverage = {
  claimId: string;
  coverageEnd: string;
  snapshot: ClaimCoverageSnapshot | null;
  coveragePolicyApproved: false;
  eligibility: "requires_review";
};
export type WarrantyCoverage = {
  unitId: string;
  serial: string;
  accountId: string;
  shipmentId: string;
  invoiceId: string;
  shippedAt: string;
  coverageEnd: string;
  assessedAt: string;
  datePosition: "before_start" | "within_dates" | "elapsed";
  source: "current_provisional_policy" | "replacement_inherited";
  provisionalDays: number | null;
  policy: CoveragePolicy | null;
  coveragePolicyApproved: false;
  eligibility: "requires_review";
};
