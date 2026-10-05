export const canadianProvinces = [
  "AB",
  "BC",
  "MB",
  "NB",
  "NL",
  "NS",
  "NT",
  "NU",
  "ON",
  "PE",
  "QC",
  "SK",
  "YT",
] as const;
export type EnrollmentConfig = {
  enabled: boolean;
  country: "CA";
  currency: "CAD";
  approvalRequired: true;
};
export type EnrollmentSubmission = {
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
  province: (typeof canadianProvinces)[number];
  businessNumber?: string;
  notes?: string;
  acknowledgment: true;
};
export type EnrollmentApplication = {
  id: string;
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
  province: string;
  businessNumber: string;
  notes: string;
  status: "pending" | "approved" | "rejected" | "activated";
  createdAt: string;
  reviewedAt: string | null;
  reviewReason: string | null;
  tier: string | null;
  creditLimit: number | null;
  accountId: string | null;
  invitationExpiresAt: string | null;
  invitationActive: boolean;
};
export type EnrollmentQueue = {
  items: EnrollmentApplication[];
  next: string | null;
};
export type EnrollmentDecision = {
  decision: "approve" | "reject";
  currentPassword: string;
  reason: string;
  tier?: string;
  creditLimit?: number;
};
export type EnrollmentDecisionResult = {
  id: string;
  status: "approved" | "rejected";
  activationToken?: string;
  expiresAt?: string;
};
export type EnrollmentInvitationAction = {
  action: "reissue" | "revoke";
  currentPassword: string;
  reason: string;
};
