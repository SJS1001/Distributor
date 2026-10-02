import type { Application } from "./application.ts";
import type { CanadaPostBinding } from "./carrier-runtime.ts";
import { check, DomainError } from "./core.ts";
import {
  CanadaPostTestClient,
  type CanadaPostTestConfig,
} from "./canada-post-test.ts";

const legacyOriginFields = [
  "CANADA_POST_WAREHOUSE_ID",
  "CANADA_POST_CUSTOMER_NUMBER",
  "CANADA_POST_CONTRACT_ID",
  "CANADA_POST_COMPANY",
  "CANADA_POST_SHIPPING_POINT_JSON",
  "CANADA_POST_SERVICES_JSON",
] as const;
const originKeys = [
  "warehouseId",
  "customerNumber",
  "contractId",
  "company",
  "shippingPoint",
  "services",
  "clientIdEnv",
  "clientSecretEnv",
] as const;
function exactObject(value: unknown, keys: readonly string[]) {
  check(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === keys.length &&
      keys.every((key) => Object.hasOwn(value, key)),
    "CARRIER_CONFIG",
    "Supply the exact supported Canada Post configuration fields.",
    500,
  );
  return value as Record<string, unknown>;
}
function parse(source: string | undefined): unknown {
  check(
    typeof source === "string" && source.length > 0 && source.length <= 16384,
    "CARRIER_CONFIG",
    "Supply bounded Canada Post configuration JSON.",
    500,
  );
  try {
    return JSON.parse(source);
  } catch {
    throw new DomainError("CARRIER_CONFIG", "Invalid Canada Post JSON.", 500);
  }
}
function string(value: unknown): string {
  check(
    typeof value === "string",
    "CARRIER_CONFIG",
    "Supply string Canada Post configuration values.",
    500,
  );
  return value;
}

// Called only after the outer test-only flag/acknowledgment and regional org
// validation. Never log JSON or environment values, persist secrets, or do I/O.
export function configuredCanadaPostBindings(
  app: Application,
  orgId: string,
  env: NodeJS.ProcessEnv,
  transport: typeof fetch,
): CanadaPostBinding[] {
  const source = env.CANADA_POST_WAREHOUSES_JSON;
  let origins: unknown[];
  if (source !== undefined) {
    check(
      legacyOriginFields.every((name) => env[name] === undefined),
      "CARRIER_CONFIG",
      "Select Canada Post warehouse-list or single-warehouse configuration without mixing origin fields.",
      500,
    );
    const parsed = parse(source);
    check(
      Array.isArray(parsed) && parsed.length >= 1 && parsed.length <= 20,
      "CARRIER_CONFIG",
      "Configure between one and twenty Canada Post warehouses.",
      500,
    );
    origins = parsed;
  } else {
    origins = [
      {
        warehouseId: env.CANADA_POST_WAREHOUSE_ID,
        customerNumber: env.CANADA_POST_CUSTOMER_NUMBER,
        contractId: env.CANADA_POST_CONTRACT_ID,
        company: env.CANADA_POST_COMPANY,
        shippingPoint: parse(env.CANADA_POST_SHIPPING_POINT_JSON),
        services: parse(env.CANADA_POST_SERVICES_JSON),
        clientIdEnv: "CANADA_POST_CLIENT_ID",
        clientSecretEnv: "CANADA_POST_CLIENT_SECRET",
      },
    ];
  }
  const seen = new Set<string>();
  return origins.map((entry) => {
    const value = exactObject(entry, originKeys);
    check(
      typeof value.warehouseId === "string" &&
        value.warehouseId.length > 0 &&
        value.warehouseId.length <= 128 &&
        value.warehouseId === value.warehouseId.trim() &&
        !/[\u0000-\u001f\u007f]/.test(value.warehouseId) &&
        !seen.has(value.warehouseId),
      "CARRIER_CONFIG",
      "Supply distinct exact Canada Post warehouse identities.",
      500,
    );
    seen.add(value.warehouseId);
    app.inventory.configurationWarehouse(orgId, value.warehouseId);
    const shippingPoint = exactObject(value.shippingPoint, [
      "kind",
      (value.shippingPoint as { kind?: unknown })?.kind === "pickup"
        ? "postalCode"
        : "siteId",
    ]);
    check(
      shippingPoint.kind === "pickup" || shippingPoint.kind === "deposit",
      "CARRIER_CONFIG",
      "Supply a supported Canada Post shipping point.",
      500,
    );
    check(
      Array.isArray(value.services) &&
        value.services.length > 0 &&
        value.services.length <= 20,
      "CARRIER_CONFIG",
      "Supply between one and twenty Canada Post service mappings.",
      500,
    );
    const services = value.services.map(
      (entry: unknown): CanadaPostTestConfig["services"][number] => {
        const service = exactObject(entry, ["service", "code"]);
        const code = service.code;
        check(
          code === "DOM.RP" ||
            code === "DOM.EP" ||
            code === "DOM.XP" ||
            code === "DOM.PC",
          "CARRIER_CONFIG",
          "Supply a supported Canada Post domestic service code.",
          500,
        );
        return { service: string(service.service), code };
      },
    );
    const credential = (reference: unknown) => {
      check(
        typeof reference === "string" &&
          /^CANADA_POST_[A-Z][A-Z0-9_]{0,95}$/.test(reference),
        "CARRIER_CONFIG",
        "Supply explicit Canada Post credential environment references.",
        500,
      );
      return string(env[reference]);
    };
    // The protocol constructor validates every value and freezes nested data.
    // Pick only declared fields; entry values cannot override org/test identity.
    const config: CanadaPostTestConfig = {
      orgId,
      testApplication: true,
      warehouseId: value.warehouseId,
      customerNumber: string(value.customerNumber),
      contractId: string(value.contractId),
      company: string(value.company),
      shippingPoint:
        shippingPoint.kind === "pickup"
          ? { kind: "pickup", postalCode: string(shippingPoint.postalCode) }
          : { kind: "deposit", siteId: string(shippingPoint.siteId) },
      services,
      clientId: credential(value.clientIdEnv),
      clientSecret: credential(value.clientSecretEnv),
    };
    return {
      orgId,
      warehouseId: config.warehouseId,
      client: new CanadaPostTestClient(config, transport),
    };
  });
}
