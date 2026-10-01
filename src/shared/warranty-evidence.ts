export const evidenceMaxBytes = 5 * 1024 * 1024;
export const evidenceMaxFiles = 20;
export const evidencePageSize = 10;
export const evidenceMediaTypes = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
  "text/plain": "txt",
} as const;
export type EvidenceMediaType = keyof typeof evidenceMediaTypes;
export type EvidenceUpload = {
  filename: string;
  mediaType: EvidenceMediaType;
  audience: "customer" | "staff";
  description: string;
  contentBase64: string;
};
export type EvidenceFile = {
  id: string;
  claimId: string;
  filename: string;
  mediaType: EvidenceMediaType;
  audience: "customer" | "staff";
  description: string;
  bytes: number;
  contentHash: string;
  createdAt: string;
};
