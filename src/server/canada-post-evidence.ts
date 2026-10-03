import { types } from "node:util";
import { canonical, check, digest } from "./core.ts";
import type { CarrierIntent } from "./carrier-bookings.ts";
import type { CarrierAddress } from "../shared/carrier-booking.ts";

// Pure structural/consistency checks only. No authentic provider evidence,
// exhaustive membership, authority, fencing or non-transmission proof is inferred.
export type CanadaPostAccountBinding = {
  orgId: string;
  warehouseId: string;
  // Test and production applications use the same gateway. This declaration
  // cannot prove the credential class; actual vendor qualification is required.
  testApplication: true;
  customerNumber: string;
  contractId: string;
  company: string;
  shippingPoint:
    | { kind: "pickup"; postalCode: string }
    | { kind: "deposit"; siteId: string };
  services: readonly {
    readonly service: string;
    readonly code: "DOM.RP" | "DOM.EP" | "DOM.XP" | "DOM.PC";
  }[];
};

// Historical descriptors are untrusted data. This strict boundary is separate
// from the legacy startup constructor, which historically permits extra fields.
export function captureCanadaPostAccountBinding(
  value: unknown,
): CanadaPostAccountBinding {
  const record = exactRecord(value, [
    "orgId",
    "warehouseId",
    "testApplication",
    "customerNumber",
    "contractId",
    "company",
    "shippingPoint",
    "services",
  ]);
  const point = exactRecord(
    record.shippingPoint,
    isPickup(record.shippingPoint)
      ? ["kind", "postalCode"]
      : ["kind", "siteId"],
  );
  check(
    Array.isArray(record.services) &&
      !types.isProxy(record.services) &&
      Object.getPrototypeOf(record.services) === Array.prototype &&
      record.services.length >= 1 &&
      record.services.length <= 20 &&
      Reflect.ownKeys(record.services).length === record.services.length + 1,
    "CARRIER_CONFIG",
    "Supply one to twenty exact Canada Post services.",
    400,
  );
  for (let index = 0; index < record.services.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(record.services, index);
    check(
      descriptor?.enumerable === true && Object.hasOwn(descriptor, "value"),
      "CARRIER_CONFIG",
      "Canada Post services must be exact data entries.",
      400,
    );
    exactRecord(descriptor.value, ["service", "code"]);
  }
  const config = record as unknown as CanadaPostAccountBinding;
  check(
    config &&
      config.testApplication === true &&
      valid(config.orgId, 128) &&
      valid(config.warehouseId, 128) &&
      typeof config.customerNumber === "string" &&
      /^\d{7,10}$/.test(config.customerNumber) &&
      typeof config.contractId === "string" &&
      /^\d{1,10}$/.test(config.contractId) &&
      valid(config.company, 44) &&
      config.shippingPoint &&
      ((config.shippingPoint.kind === "pickup" &&
        postal(config.shippingPoint.postalCode)) ||
        (config.shippingPoint.kind === "deposit" &&
          typeof config.shippingPoint.siteId === "string" &&
          /^[A-Z0-9]{4}$/.test(config.shippingPoint.siteId))) &&
      Array.isArray(config.services) &&
      config.services.length > 0 &&
      config.services.length <= 20 &&
      Array.from(config.services).every(
        (entry) =>
          entry &&
          valid(entry.service, 100) &&
          ["DOM.RP", "DOM.EP", "DOM.XP", "DOM.PC"].includes(entry.code),
      ) &&
      new Set(config.services.map((entry) => entry.service)).size ===
        config.services.length,
    "CARRIER_CONFIG",
    "Supply an exact non-secret Canada Post test account binding.",
    400,
  );
  // Only validated primitive fields are copied; preserve service order and text.
  return Object.freeze({
    orgId: config.orgId,
    warehouseId: config.warehouseId,
    testApplication: true,
    customerNumber: config.customerNumber,
    contractId: config.contractId,
    company: config.company,
    shippingPoint: Object.freeze(
      point.kind === "pickup"
        ? { kind: "pickup" as const, postalCode: point.postalCode as string }
        : { kind: "deposit" as const, siteId: point.siteId as string },
    ),
    services: Object.freeze(
      config.services.map((entry) =>
        Object.freeze({ service: entry.service, code: entry.code }),
      ),
    ),
  });
}
function isPickup(value: unknown): boolean {
  // Inspect a data descriptor, never invoke an untrusted getter.
  return (
    value !== null &&
    typeof value === "object" &&
    !types.isProxy(value) &&
    Object.getOwnPropertyDescriptor(value, "kind")?.value === "pickup"
  );
}
function exactRecord(value: unknown, keys: string[]): Record<string, unknown> {
  check(
    value !== null &&
      typeof value === "object" &&
      !types.isProxy(value) &&
      (Object.getPrototypeOf(value) === Object.prototype ||
        Object.getPrototypeOf(value) === null) &&
      Reflect.ownKeys(value).length === keys.length &&
      keys.every((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return (
          descriptor?.enumerable === true && Object.hasOwn(descriptor, "value")
        );
      }),
    "CARRIER_CONFIG",
    "Canada Post binding fields must be exact non-secret data.",
    400,
  );
  return value as Record<string, unknown>;
}
// Compatibility hash for already validated client configuration. Do not use it
// as a descriptor parser or as account/provider evidence. Preserve legacy extra
// fields in the hash; removing them would change an existing request identity.
export function canadaPostConfigurationHash(
  config: CanadaPostAccountBinding,
): string {
  const {
    clientId: _id,
    clientSecret: _secret,
    ...binding
  } = config as CanadaPostAccountBinding & {
    clientId?: string;
    clientSecret?: string;
  };
  return digest(canonical(binding));
}

export function reviewCanadaPostShipment(
  config: CanadaPostAccountBinding,
  intent: CarrierIntent,
  groupId: string,
  // Live clients pass their constructor-captured compatibility hash. Offline
  // callers must capture a strict descriptor and use its computed default.
  configurationHash = canadaPostConfigurationHash(config),
) {
  check(
    intent &&
      intent.provider === "canada-post" &&
      intent.nativeSnapshot?.org_id === config.orgId &&
      intent.nativeSnapshot.warehouse_id === config.warehouseId &&
      intent.shipmentId === intent.nativeSnapshot.id &&
      valid(intent.bookingId, 128) &&
      typeof intent.reviewHash === "string" &&
      /^[a-f0-9]{64}$/.test(intent.reviewHash),
    "CARRIER_MISMATCH",
    "Canada Post intent must identify the configured organization and warehouse shipment.",
  );
  const { bookingId, reviewHash, ...review } = intent;
  check(
    digest(canonical(review)) === reviewHash,
    "CARRIER_MISMATCH",
    "Canada Post intent does not match its review hash.",
  );
  check(
    typeof groupId === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(groupId),
    "CARRIER_UNSUPPORTED",
    "Supply a reviewed warehouse/day shipping group.",
  );
  const service = config.services.find(
    (entry) => entry.service === intent.service,
  );
  check(
    service,
    "CARRIER_UNSUPPORTED",
    "Canada Post requires an exactly mapped domestic service; customs and cross-border shipping remain unqualified.",
  );
  const sender = contact(intent.origin),
    destination = contact(intent.destination);
  if (config.shippingPoint.kind === "pickup")
    check(
      sender.addressDetails.postalZipCode === config.shippingPoint.postalCode,
      "CARRIER_MISMATCH",
      "The reviewed warehouse origin must match the configured pickup location.",
    );
  const parcel = intent.parcel;
  check(
    parcel &&
      [
        parcel.weightGrams,
        parcel.lengthMm,
        parcel.widthMm,
        parcel.heightMm,
      ].every((n) => Number.isSafeInteger(n) && n > 0) &&
      parcel.weightGrams <= 30_000,
    "CARRIER_UNSUPPORTED",
    "Canada Post requires one ordinary parcel of at most 30 kg with positive whole grams and millimeters.",
  );
  const sides = [parcel.lengthMm, parcel.widthMm, parcel.heightMm],
    longest = Math.max(...sides);
  check(
    longest <= 2000 &&
      longest + 2 * (sides.reduce((a, b) => a + b, 0) - longest) <= 3000,
    "CARRIER_UNSUPPORTED",
    "Canada Post parcel exceeds the local ordinary-parcel dimensions.",
  );
  // 32 characters also fit the narrower Get Shipments request-id schema.
  // A correlation reference never authorizes a repeat write after uncertainty.
  const customerRequestId =
    "D" +
    digest(
      canonical({
        configurationHash,
        bookingId,
        reviewHash,
        groupId,
      }),
    )
      .slice(0, 31)
      .toUpperCase();
  const body = {
    customerRequestId,
    groupId,
    ...(config.shippingPoint.kind === "pickup"
      ? {
          cpcPickupIndicator: true,
          requestedShippingPoint: config.shippingPoint.postalCode,
        }
      : { shippingPointId: config.shippingPoint.siteId }),
    deliverySpec: {
      serviceCode: service.code,
      sender: {
        name: sender.name,
        company: config.company,
        contactPhone: sender.phone,
        addressDetails: sender.addressDetails,
      },
      destination: {
        name: destination.name,
        clientVoiceNumber: destination.phone,
        addressDetails: destination.addressDetails,
      },
      parcelCharacteristics: {
        weight: parcel.weightGrams / 1000,
        dimensions: {
          length: parcel.lengthMm / 10,
          width: parcel.widthMm / 10,
          height: parcel.heightMm / 10,
        },
      },
      printPreferences: { outputFormat: "4x6", encoding: "PDF" },
      preferences: {
        showPackingInstructions: false,
        showPostageRate: false,
        showInsuredValue: false,
      },
      references: { customerRef1: customerRequestId },
      settlementInfo: {
        paidByCustomer: config.customerNumber,
        contractId: config.contractId,
        intendedMethodOfPayment: "Account",
      },
    },
  };
  // Capture primitive identity and complete wire data before the first await.
  return { bookingId, reviewHash, groupId, customerRequestId, body };
}

export function captureCanadaPostShipmentDetails(
  config: CanadaPostAccountBinding,
  review: ReturnType<typeof reviewCanadaPostShipment>,
  observation: { tracking: string; status: "created" | "transmitted" },
  value: unknown,
) {
  const { tracking, status } = observation;
  check(
    typeof tracking === "string" &&
      /^\d{11,16}$/.test(tracking) &&
      (status === "created" || status === "transmitted"),
    "CARRIER_RESULT",
    "Canada Post detail comparison requires a supported tracking and lifecycle identity.",
  );
  const detail = object(value);
  const shipment = object(detail.shipmentDetail),
    spec = object(shipment.deliverySpec),
    expected = review.body.deliverySpec;
  check(
    detail.customerRequestId === review.customerRequestId &&
      detail.trackingPin === tracking &&
      detail.shipmentStatus === status &&
      shipment.groupId === review.groupId &&
      shipment.transmitShipment === undefined &&
      spec.serviceCode === expected.serviceCode &&
      contactMatches(spec.sender, expected.sender) &&
      contactMatches(spec.destination, expected.destination) &&
      (spec.recipient === undefined ||
        contactMatches(spec.recipient, expected.destination)) &&
      matches(spec.parcelCharacteristics, expected.parcelCharacteristics) &&
      ordinaryParcel(spec.parcelCharacteristics) &&
      matches(spec.references, expected.references) &&
      matches(spec.settlementInfo, expected.settlementInfo) &&
      spec.customs === undefined &&
      spec.notification === undefined &&
      (spec.options === undefined ||
        (Array.isArray(spec.options) && spec.options.length === 0)) &&
      shipment.returnSpec === undefined &&
      shipment.quickshipLabelRequested === undefined &&
      (config.shippingPoint.kind === "pickup"
        ? detail.cpcPickupIndicator === true &&
          detail.finalShippingPoint === config.shippingPoint.postalCode &&
          detail.shippingPointId === undefined
        : detail.shippingPointId === config.shippingPoint.siteId &&
          detail.cpcPickupIndicator === undefined),
    "CARRIER_RESULT",
    "Canada Post details must match the reviewed group, contacts, parcel, service, shipping point and settlement account.",
  );
  return {
    groupId: review.groupId,
    customerRequestId: review.customerRequestId,
    tracking,
    status,
  };
}

function valid(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}
function postal(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTVWXYZ]\d[ABCEGHJ-NPRSTVWXYZ]\d$/.test(
      value,
    )
  );
}
function object(value: unknown): Record<string, unknown> {
  check(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "CARRIER_RESULT",
    "Canada Post returned an invalid response structure.",
  );
  return value as Record<string, unknown>;
}
function contact(address: CarrierAddress) {
  check(
    address &&
      address.country === "CA" &&
      valid(address.name, 44) &&
      valid(address.line1, 44) &&
      typeof address.line2 === "string" &&
      (address.line2 === "" || valid(address.line2, 44)) &&
      valid(address.city, 40) &&
      typeof address.province === "string" &&
      "AB BC MB NB NL NS NT NU ON PE QC SK YT"
        .split(" ")
        .includes(address.province) &&
      typeof address.postalCode === "string" &&
      postal(address.postalCode.replace(/ /g, "")) &&
      valid(address.phone, 25) &&
      /^\+?[0-9 ().-]+$/.test(address.phone) &&
      /^(?:1)?\d{10}$/.test(address.phone.replace(/\D/g, "")),
    "CARRIER_UNSUPPORTED",
    "Canada Post requires bounded Canadian contacts, province/postal codes and ten-digit phone numbers, optionally prefixed by 1.",
  );
  return {
    name: address.name,
    phone: address.phone,
    addressDetails: {
      addressLine1: address.line1,
      ...(address.line2 ? { addressLine2: address.line2 } : {}),
      city: address.city,
      provState: address.province,
      countryCode: "CA",
      postalZipCode: address.postalCode.replace(/ /g, ""),
    },
  };
}
function matches(actual: unknown, expected: unknown): boolean {
  if (
    expected !== null &&
    typeof expected === "object" &&
    !Array.isArray(expected)
  ) {
    if (actual === null || typeof actual !== "object" || Array.isArray(actual))
      return false;
    return Object.entries(expected).every(([key, value]) =>
      matches((actual as Record<string, unknown>)[key], value),
    );
  }
  return actual === expected;
}
function contactMatches(
  actual: unknown,
  expected: { addressDetails: { addressLine2?: string } },
): boolean {
  if (!matches(actual, expected)) return false;
  const detail = actual as Record<string, unknown>,
    address = detail.addressDetails as Record<string, unknown>;
  // A provider-added second address line can change the reviewed destination.
  return (
    (expected.addressDetails.addressLine2 !== undefined ||
      address.addressLine2 === undefined ||
      address.addressLine2 === "") &&
    ["company", "additionalAddressInfo"].every(
      (key) =>
        key in expected || detail[key] === undefined || detail[key] === "",
    )
  );
}
function ordinaryParcel(actual: unknown): boolean {
  const parcel = actual as Record<string, unknown>;
  return ["unpackaged", "mailingTube", "oversized"].every(
    (key) => parcel[key] === undefined || parcel[key] === false,
  );
}
