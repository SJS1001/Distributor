import type { Application } from "./application.ts";
import { CarrierRuntime, type CarrierBinding } from "./carrier-runtime.ts";
import { check, DomainError } from "./core.ts";
import { UpsSandbox, type UpsSandboxConfig } from "./ups-sandbox.ts";
import { FedexSandbox, type FedexSandboxConfig } from "./fedex-sandbox.ts";

// Trusted workstation/server environment, never request-body configuration.
// Capture all values at startup; no token acquisition, send or background task.
export function configuredCarriers(
  app: Application,
  env: NodeJS.ProcessEnv = process.env,
  transport: typeof fetch = fetch,
): CarrierRuntime | undefined {
  const flag = (name: string) => {
    check(
      env[name] === undefined || ["false", "true"].includes(env[name]!),
      "CARRIER_CONFIG",
      `${name} must be true or false.`,
      500,
    );
    return env[name] === "true";
  };
  if (!flag("CARRIERS_ENABLED")) return undefined;
  const ups = flag("UPS_SANDBOX_ENABLED"),
    fedex = flag("FEDEX_SANDBOX_ENABLED");
  check(
    ups || fedex,
    "CARRIER_CONFIG",
    "Select at least one supported sandbox carrier.",
    500,
  );
  const required = (name: string, maximum = 1024) => {
    const value = env[name];
    check(
      typeof value === "string" &&
        value.length > 0 &&
        value.length <= maximum &&
        value === value.trim() &&
        !/[\u0000-\u001f\u007f]/.test(value),
      "CARRIER_CONFIG",
      `Supply a valid ${name}.`,
      500,
    );
    return value;
  };
  const object = (value: unknown, keys: readonly string[], name: string) => {
    check(
      value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.keys(value).length === keys.length &&
        keys.every((key) => Object.hasOwn(value, key)),
      "CARRIER_CONFIG",
      `Supply the exact supported fields in ${name}.`,
      500,
    );
  };
  const json = (name: string): unknown => {
    const source = required(name, 16384);
    try {
      return JSON.parse(source);
    } catch {
      // JSON parser messages can contain addresses or credentials.
      throw new DomainError("CARRIER_CONFIG", `Invalid ${name} JSON.`, 500);
    }
  };
  const services = (name: string, keys: readonly string[]) => {
    const value = json(name);
    check(
      Array.isArray(value) && value.length > 0 && value.length <= 20,
      "CARRIER_CONFIG",
      `Supply between one and twenty mappings in ${name}.`,
      500,
    );
    for (const entry of value) object(entry, keys, name);
    return value;
  };
  const orgId = required("CARRIER_ORG_ID", 128);
  try {
    app.identity.configurationOrganization(orgId);
  } catch {
    throw new DomainError(
      "CARRIER_CONFIG",
      "CARRIER_ORG_ID must identify an organization in this regional store.",
      500,
    );
  }
  const bindings: CarrierBinding[] = [];
  try {
    if (ups) {
      const shipper = json("UPS_SHIPPER_JSON");
      object(
        shipper,
        [
          "name",
          "line1",
          "line2",
          "city",
          "province",
          "postalCode",
          "country",
          "phone",
        ],
        "UPS_SHIPPER_JSON",
      );
      bindings.push({
        orgId,
        adapter: new UpsSandbox(
          {
            orgId,
            clientId: required("UPS_CLIENT_ID", 512),
            clientSecret: required("UPS_CLIENT_SECRET"),
            shipperNumber: required("UPS_SHIPPER_NUMBER", 6),
            shipper: shipper as UpsSandboxConfig["shipper"],
            services: services("UPS_SERVICES_JSON", [
              "service",
              "code",
            ]) as UpsSandboxConfig["services"],
          },
          transport,
        ),
      });
    }
    if (fedex) {
      bindings.push({
        orgId,
        adapter: new FedexSandbox(
          {
            orgId,
            clientId: required("FEDEX_CLIENT_ID", 512),
            clientSecret: required("FEDEX_CLIENT_SECRET"),
            accountNumber: required("FEDEX_ACCOUNT_NUMBER", 9),
            country: required(
              "FEDEX_COUNTRY",
              2,
            ) as FedexSandboxConfig["country"],
            pickupType: required(
              "FEDEX_PICKUP_TYPE",
              40,
            ) as FedexSandboxConfig["pickupType"],
            services: services("FEDEX_SERVICES_JSON", [
              "service",
              "code",
              "residential",
            ]) as FedexSandboxConfig["services"],
          },
          transport,
        ),
      });
    }
  } catch (error) {
    if (error instanceof DomainError)
      throw new DomainError(
        "CARRIER_CONFIG",
        error.code === "CARRIER_CONFIG"
          ? error.message
          : "Invalid sandbox carrier configuration.",
        500,
      );
    throw error;
  }
  return new CarrierRuntime(app, bindings);
}
