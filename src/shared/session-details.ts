export type SessionDetail = {
  label: string;
  reference: string | null;
  expiresAt: number;
  current: boolean;
  createdAt: number | null;
  lastActivityAt: number | null;
  deviceDescription: string | null;
};

// A recognition hint reported by the client, never proof of a device's identity.
// Store a fixed vocabulary instead of arbitrary user agent text or identifiers.
export function sessionDeviceDescription(userAgent: unknown): string | null {
  if (typeof userAgent !== "string" || userAgent.length > 2048) return null;
  const browser = /Edg(?:A|iOS)?\//.test(userAgent)
    ? "Edge"
    : /(?:Chrome|CriOS)\//.test(userAgent)
      ? "Chrome"
      : /(?:Firefox|FxiOS)\//.test(userAgent)
        ? "Firefox"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : null;
  const device = /iPad/.test(userAgent)
    ? "iPad"
    : /iPhone/.test(userAgent)
      ? "iPhone"
      : /Android/.test(userAgent)
        ? "Android"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Macintosh|Mac OS X/.test(userAgent)
            ? "Mac"
            : /Linux/.test(userAgent)
              ? "Linux"
              : null;
  return browser && device ? `${browser} on ${device}` : (browser ?? device);
}
