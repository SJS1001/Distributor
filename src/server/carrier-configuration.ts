import { canonical, check, digest } from "./core.ts";
import type {
  CarrierConfiguration,
  CarrierName,
} from "../shared/carrier-booking.ts";

// Identity is an explicit non-secret allowlist supplied by each protocol client.
// Credentials may rotate for the same identity without rewriting a booking.
export function carrierConfiguration(
  provider: CarrierName,
  identity: unknown,
  accountHint: string,
  details: string[],
  services: { service: string; description: string }[],
): CarrierConfiguration {
  const summary = { provider, accountHint, details, services };
  return Object.freeze({
    ...summary,
    hash: digest(canonical({ version: 1, identity, ...summary })),
    details: Object.freeze([...details]),
    services: Object.freeze(
      services.map((entry) => Object.freeze({ ...entry })),
    ),
  });
}
export function assertCarrierConfiguration(
  intent: { configurationHash?: string; configuration?: CarrierConfiguration },
  configuration?: CarrierConfiguration,
) {
  check(
    configuration
      ? intent.configurationHash === configuration.hash &&
          canonical(intent.configuration) === canonical(configuration)
      : intent.configurationHash === undefined &&
          intent.configuration === undefined,
    "CARRIER_CONFIG_CHANGED",
    "Carrier account or service settings differ from this booking's review. Cancel an unsent booking and review a new one; never replace or resend an uncertain booking.",
  );
}

// Capture a bounded review contract at startup; never accept extra identity or
// credential fields through an adapter's display metadata.
export function captureCarrierConfiguration(
  value: CarrierConfiguration,
  provider: CarrierName,
): CarrierConfiguration {
  const text = (v: unknown) =>
    typeof v === "string" &&
    v.length > 0 &&
    v.length <= 2048 &&
    v === v.trim() &&
    !/[\u0000-\u001f\u007f]/.test(v);
  check(
    value &&
      Object.keys(value).sort().join(",") ===
        "accountHint,details,hash,provider,services" &&
      value.provider === provider &&
      typeof value.hash === "string" &&
      /^[a-f0-9]{64}$/.test(value.hash) &&
      text(value.accountHint) &&
      Array.isArray(value.details) &&
      value.details.length <= 20 &&
      value.details.every(text) &&
      Array.isArray(value.services) &&
      value.services.length >= 1 &&
      value.services.length <= 20 &&
      value.services.every(
        (entry) =>
          entry &&
          Object.keys(entry).sort().join(",") === "description,service" &&
          text(entry.service) &&
          text(entry.description),
      ) &&
      new Set(value.services.map((entry) => entry.service)).size ===
        value.services.length,
    "CARRIER_CONFIG",
    "A bounded account and exact service review must match the registered carrier.",
    500,
  );
  return Object.freeze({
    hash: value.hash,
    provider: value.provider,
    accountHint: value.accountHint,
    details: Object.freeze([...value.details]),
    services: Object.freeze(
      value.services.map((entry) => Object.freeze({ ...entry })),
    ),
  });
}
