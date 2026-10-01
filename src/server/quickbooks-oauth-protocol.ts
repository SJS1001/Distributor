import { check, integer } from "./core.ts";
import {
  type CredentialBinding,
  type TokenBundle,
} from "./provider-credentials.ts";

// Confidential-client sandbox profile. No retries: either grant may be single-use.
export async function exchangeQuickBooksToken(
  binding: CredentialBinding,
  clientSecret: string,
  grant: Record<string, string>,
  previousHardExpiry?: number,
): Promise<TokenBundle> {
  check(
    typeof clientSecret === "string" &&
      /^[\x21-\x7e]{1,8192}$/.test(clientSecret),
    "PROVIDER_CONFIG",
    "QuickBooks client secret is unavailable.",
    503,
  );
  const requestedAt = Date.now();
  const response = await fetch(
    "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: `Basic ${Buffer.from(`${binding.clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "x-include-refresh-token-hard-expires-in": "true",
      },
      body: new URLSearchParams(grant).toString(),
    },
  );
  const result = await readQuickBooksJson(response);
  check(
    result &&
      typeof result === "object" &&
      typeof result.token_type === "string" &&
      result.token_type.toLowerCase() === "bearer",
    "CREDENTIAL_REFRESH",
    "Unsupported token response.",
    503,
  );
  check(
    [result.access_token, result.refresh_token].every(
      (value) =>
        typeof value === "string" && /^[\x21-\x7e]{1,8192}$/.test(value),
    ),
    "CREDENTIAL_INPUT",
    "Invalid provider token.",
  );
  check(
    result.scope === undefined ||
      result.scope === "com.intuit.quickbooks.accounting",
    "OAUTH_SCOPE",
    "Returned authorization scope differs.",
  );
  const seconds = (value: unknown, max: number) =>
    integer(value, "token lifetime", 1, max) * 1000;
  const hardExpiresAt = Math.min(
    previousHardExpiry ?? Infinity,
    result.x_refresh_token_hard_expires_in === undefined
      ? Infinity
      : requestedAt +
          seconds(result.x_refresh_token_hard_expires_in, 366 * 86400),
  );
  const next: TokenBundle = {
    accessToken: result.access_token,
    refreshToken: result.refresh_token,
    accessExpiresAt: requestedAt + seconds(result.expires_in, 86400),
    refreshExpiresAt:
      requestedAt + seconds(result.x_refresh_token_expires_in, 366 * 86400),
    ...(Number.isFinite(hardExpiresAt) ? { hardExpiresAt } : {}),
  };
  check(
    next.accessExpiresAt > Date.now() + 30000,
    "CREDENTIAL_REFRESH",
    "Returned access token is already expiring.",
    503,
  );
  check(
    Math.min(next.refreshExpiresAt, next.hardExpiresAt ?? Infinity) >
      Date.now(),
    "CREDENTIAL_EXPIRED",
    "Returned refresh credentials are already expired.",
    503,
  );
  return next;
}

// Bounded provider bodies are never logged or returned in operational errors.
export async function readQuickBooksJson(response: Response): Promise<any> {
  check(
    response.status === 200 && response.body,
    "CREDENTIAL_REFRESH",
    "QuickBooks response is unavailable.",
    503,
  );
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let bytes = 0,
    raw: Buffer | undefined;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      bytes += value.byteLength;
      check(
        bytes <= 65536,
        "CREDENTIAL_REFRESH",
        "QuickBooks response exceeds the allowed size.",
        503,
      );
    }
    raw = Buffer.concat(chunks);
    return JSON.parse(raw.toString());
  } finally {
    raw?.fill(0);
    for (const chunk of chunks) chunk.fill(0);
    await reader.cancel();
  }
}
