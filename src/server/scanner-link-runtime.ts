import { check } from "./core.ts";
import type { ScannerLinkTransport } from "./scanner-link.ts";
/** Trusted deployment configuration for a qualified organization's messaging relay.
 * No request can choose the destination, credential, template or public URL.
 * The relay must distinguish acceptance from confirmed delivery and deduplicate
 * Idempotency-Key. Provider qualification/residency review remains operational.
 */
export function configuredScannerLinks(
  env: NodeJS.ProcessEnv = process.env,
): ScannerLinkTransport | undefined {
  const endpoint = env.SCANNER_LINK_RELAY_URL;
  if (!endpoint) return undefined;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    check(
      false,
      "CONFIG",
      "Scanner relay endpoint must be a valid HTTPS URL.",
      500,
    );
  }
  check(
    url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !url.search &&
      !!env.SCANNER_LINK_RELAY_TOKEN &&
      !!env.SCANNER_LINK_ORGANIZATION_ID,
    "CONFIG",
    "Scanner relay requires HTTPS endpoint, organization and credential.",
    500,
  );
  const channels = (env.SCANNER_LINK_CHANNELS ?? "").split(",").filter(Boolean);
  check(
    channels.length > 0 &&
      channels.every((c) => c === "email" || c === "sms") &&
      new Set(channels).size === channels.length,
    "CONFIG",
    "Scanner relay channels must explicitly select email and/or sms.",
    500,
  );
  return {
    orgId: env.SCANNER_LINK_ORGANIZATION_ID!,
    channels: channels as ("email" | "sms")[],
    async send({ attemptId, channel, recipient, scannerUrl, signal }) {
      const response = await fetch(url, {
        method: "POST",
        redirect: "error",
        signal,
        headers: {
          Authorization: `Bearer ${env.SCANNER_LINK_RELAY_TOKEN}`,
          "Content-Type": "application/json",
          "Idempotency-Key": attemptId,
        },
        body: JSON.stringify({
          template: "distributor-scanner-link",
          channel,
          recipient,
          scannerUrl,
        }),
      });
      // Unqualified HTTP status or malformed response cannot establish delivery.
      const validResponse =
        response.ok &&
        response.headers
          .get("content-type")
          ?.split(";", 1)[0]
          ?.trim()
          .toLowerCase() === "application/json";
      // Discard even an invalid response body: a relay error may stream forever.
      // The enclosing delivery deadline still bounds a stalled cancellation.
      if (!validResponse) await response.body?.cancel().catch(() => {});
      check(
        validResponse,
        "DELIVERY_UNKNOWN",
        "Relay outcome was not confirmed.",
      );
      const reader = response.body?.getReader();
      check(reader, "DELIVERY_UNKNOWN", "Relay outcome was not confirmed.");
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          check(
            length <= 4096,
            "DELIVERY_UNKNOWN",
            "Relay response exceeded its limit.",
          );
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const result = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        state?: string;
      };
      check(
        ["accepted", "confirmed", "rejected"].includes(result.state ?? ""),
        "DELIVERY_UNKNOWN",
        "Relay outcome was not confirmed.",
      );
      return result.state as "accepted" | "confirmed" | "rejected";
    },
  };
}
