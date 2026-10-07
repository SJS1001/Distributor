export const resourceKinds = [
  "image",
  "literature",
  "installation",
  "maintenance",
  "other",
] as const;
export type ResourceKind = (typeof resourceKinds)[number];
export type ResourceMetadata = {
  kind: ResourceKind;
  title: string;
  altText?: string;
  models?: string;
  language?: string;
  revision?: string;
  source?: string;
  position?: number;
};
export type ResourceUpload = ResourceMetadata & {
  contentBase64?: string;
  mediaType?: "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
  externalUrl?: string;
};
export type CatalogResource = {
  id: string;
  productId: string;
  kind: ResourceKind;
  title: string;
  altText: string;
  models: string;
  language: string;
  revision: string;
  source: string;
  position: number;
  state: "draft" | "published" | "retired";
  version: number;
  mediaType: string;
  bytes: number;
  contentHash: string;
  externalUrl: string;
  inspection: "normalized" | "quarantined" | "approved" | "link";
  createdAt: string;
  updatedAt: string;
};
export type ResourceChange = Partial<ResourceMetadata> & {
  expectedVersion: number;
};
export type ResourcePublish = {
  expectedVersion: number;
  permissionAffirmed: boolean;
  permissionBasis: string;
};
export const catalogImageMaxBytes = 8 * 1024 * 1024;
export const catalogDocumentMaxBytes = 16 * 1024 * 1024;
export const catalogResourceMaxFiles = 40;
export const catalogOrganizationMaxBytes = 256 * 1024 * 1024;

// Keep aligned with the existing HTTP img-src policy. Adding a host requires a
// separate reviewed policy decision; linked images are never fetched by Catalog.
export const catalogImageLinkHosts = ["cdn.shopify.com"] as const;
export function catalogImageLinkUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const input = value.trim();
  if (
    !/^https:\/\//i.test(input) ||
    input.length > 2000 ||
    /[\u0000-\u001f\u007f\\]/.test(input)
  )
    return null;
  try {
    const url = new URL(input);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !catalogImageLinkHosts.some((host) => url.hostname === host) ||
      url.href.length > 2000
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
