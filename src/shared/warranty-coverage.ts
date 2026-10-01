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
  coveragePolicyApproved: false;
  eligibility: "requires_review";
};
