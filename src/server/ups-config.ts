import type { Application } from "./application.ts";
import type { CarrierBinding } from "./carrier-runtime.ts";
import type { CarrierAddress } from "../shared/carrier-booking.ts";
import { check, DomainError } from "./core.ts";
import { UpsSandbox, type UpsSandboxConfig } from "./ups-sandbox.ts";

function object(value: unknown, keys: readonly string[]) {
  check(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === keys.length &&
      keys.every((key) => Object.hasOwn(value, key)),
    "CARRIER_CONFIG",
    "Supply the exact UPS warehouse configuration fields.",
    500,
  );
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  check(
    typeof value === "string",
    "CARRIER_CONFIG",
    "Supply string UPS configuration values.",
    500,
  );
  return value;
}

// Trusted startup configuration only. Credentials are references, never list
// values; construction makes no requests and writes no native/provider facts.
export function configuredUpsBindings(
  app: Application,
  orgId: string,
  env: NodeJS.ProcessEnv,
  transport: typeof fetch,
): CarrierBinding[] {
  check(
    ["UPS_SHIPPER_NUMBER", "UPS_SHIPPER_JSON", "UPS_SERVICES_JSON"].every(
      (name) => env[name] === undefined,
    ),
    "CARRIER_CONFIG",
    "Choose UPS warehouse-list or organization-wide configuration without mixing account fields.",
    500,
  );
  const source = env.UPS_WAREHOUSES_JSON;
  check(
    typeof source === "string" &&
      source.length > 0 &&
      source.length <= 16384 &&
      !/[\u0000-\u001f\u007f]/.test(source),
    "CARRIER_CONFIG",
    "Supply bounded UPS warehouse JSON.",
    500,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new DomainError("CARRIER_CONFIG", "Invalid UPS warehouse JSON.", 500);
  }
  check(
    Array.isArray(parsed) && parsed.length >= 1 && parsed.length <= 20,
    "CARRIER_CONFIG",
    "Configure between one and twenty UPS warehouses.",
    500,
  );
  const seen = new Set<string>();
  return parsed.map((entry: unknown) => {
    const value = object(entry, [
      "warehouseId",
      "shipperNumber",
      "shipper",
      "services",
      "clientIdEnv",
      "clientSecretEnv",
    ]);
    const warehouseId = value.warehouseId;
    check(
      typeof warehouseId === "string" &&
        warehouseId.length > 0 &&
        warehouseId.length <= 128 &&
        warehouseId === warehouseId.trim() &&
        !/[\u0000-\u001f\u007f]/.test(warehouseId) &&
        !seen.has(warehouseId),
      "CARRIER_CONFIG",
      "Supply distinct exact UPS warehouse identities.",
      500,
    );
    seen.add(warehouseId);
    app.inventory.configurationWarehouse(orgId, warehouseId);
    const contact = object(value.shipper, [
      "name",
      "line1",
      "line2",
      "city",
      "province",
      "postalCode",
      "country",
      "phone",
    ]);
    check(
      contact.country === "CA" || contact.country === "US",
      "CARRIER_CONFIG",
      "Supply a supported UPS shipper country.",
      500,
    );
    const shipper: CarrierAddress = {
      name: string(contact.name),
      line1: string(contact.line1),
      line2: string(contact.line2),
      city: string(contact.city),
      province: string(contact.province),
      postalCode: string(contact.postalCode),
      country: contact.country,
      phone: string(contact.phone),
    };
    check(
      Array.isArray(value.services) &&
        value.services.length >= 1 &&
        value.services.length <= 20,
      "CARRIER_CONFIG",
      "Supply between one and twenty UPS service mappings.",
      500,
    );
    const services: UpsSandboxConfig["services"] = value.services.map(
      (entry: unknown) => {
        const service = object(entry, ["service", "code"]);
        return { service: string(service.service), code: string(service.code) };
      },
    );
    const credential = (reference: unknown) => {
      check(
        typeof reference === "string" &&
          /^UPS_[A-Z][A-Z0-9_]{0,95}$/.test(reference),
        "CARRIER_CONFIG",
        "Supply explicit UPS credential environment references.",
        500,
      );
      return string(env[reference]);
    };
    return {
      orgId,
      warehouseId,
      adapter: new UpsSandbox(
        {
          orgId,
          shipper,
          shipperNumber: string(value.shipperNumber),
          services,
          clientId: credential(value.clientIdEnv),
          clientSecret: credential(value.clientSecretEnv),
        },
        transport,
      ),
    };
  });
}
