import { check, integer } from "./core.ts";
import type { Shipment } from "./fulfillment.ts";
import type {
  CarrierAddress,
  CarrierParcel,
  DhlShippingReview,
} from "../shared/carrier-booking.ts";

function record(value: unknown, required: string[], optional: string[] = []) {
  check(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      [Object.prototype, null].includes(Object.getPrototypeOf(value)),
    "VALIDATION",
    "Supply an explicit DHL review object.",
    400,
  );
  const result = value as Record<string, unknown>;
  check(
    Reflect.ownKeys(result).every(
      (key) =>
        typeof key === "string" && [...required, ...optional].includes(key),
    ) && required.every((key) => Object.hasOwn(result, key)),
    "VALIDATION",
    "DHL review fields must match the supported contract exactly.",
    400,
  );
  return result;
}
function exactText(value: unknown, name: string, maximum: number): string {
  check(
    typeof value === "string" &&
      value.length > 0 &&
      value.length <= maximum &&
      value === value.trim() &&
      !/[\u0000-\u001f\u007f]/u.test(value),
    "VALIDATION",
    `${name} must be explicit text without padding or control characters.`,
    400,
  );
  return value;
}
function calendarDate(value: unknown): string {
  const date = exactText(value, "DHL calendar date", 10);
  check(
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      date.slice(0, 4) >= "2000" &&
      Number.isFinite(Date.parse(`${date}T00:00:00Z`)) &&
      new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date,
    "VALIDATION",
    "Supply a valid DHL calendar date (year 2000 or later).",
    400,
  );
  return date;
}
function shippingTime(value: unknown): string {
  const stamp = exactText(value, "DHL planned shipping time", 25);
  check(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(stamp),
    "VALIDATION",
    "Supply a shipping time with seconds and an explicit UTC offset.",
    400,
  );
  calendarDate(stamp.slice(0, 10));
  const hour = Number(stamp.slice(11, 13)),
    minute = Number(stamp.slice(14, 16)),
    second = Number(stamp.slice(17, 19)),
    offsetHour = Number(stamp.slice(20, 22)),
    offsetMinute = Number(stamp.slice(23, 25));
  check(
    hour <= 23 &&
      minute <= 59 &&
      second <= 59 &&
      offsetHour <= 14 &&
      offsetMinute <= 59 &&
      (offsetHour !== 14 || offsetMinute === 0) &&
      !stamp.endsWith("-00:00") &&
      Number.isFinite(Date.parse(stamp)),
    "VALIDATION",
    "Supply a valid clock time and UTC offset.",
    400,
  );
  return stamp;
}

// This captures a goods declaration; it does not classify goods, validate
// customs law, convert currencies or qualify a carrier service. Clock-dependent
// send eligibility belongs at transmission, so recovery can retain old reviews.
export function captureDhlReview(
  value: unknown,
  shipment: Shipment,
  origin: CarrierAddress,
  destination: CarrierAddress,
  parcel: CarrierParcel,
): DhlShippingReview {
  const raw = record(
    value,
    ["plannedShippingAt", "description", "incoterm"],
    ["customs", "companyNames"],
  );
  const plannedShippingAt = shippingTime(raw.plannedShippingAt),
    description = exactText(raw.description, "DHL goods description", 1000);
  check(
    ["DAP", "FCA", "EXW", "CPT", "CIP", "DPU"].includes(raw.incoterm as string),
    "VALIDATION",
    "Choose a supported explicit incoterm; prepaid duties are not supported.",
    400,
  );
  const incoterm = raw.incoterm as DhlShippingReview["incoterm"];
  const company = Object.hasOwn(raw, "companyNames")
    ? record(raw.companyNames, ["shipper", "receiver"])
    : undefined;
  const companyNames = company
    ? {
        shipper: exactText(company.shipper, "DHL shipper company", 100),
        receiver: exactText(company.receiver, "DHL receiver company", 100),
      }
    : undefined;
  const companies = companyNames ? { companyNames } : {};
  const crossBorder = origin.country !== destination.country;
  check(
    Object.hasOwn(raw, "customs") === crossBorder,
    "VALIDATION",
    "Cross-border goods require a declaration; domestic reviews must omit customs.",
    400,
  );
  if (!crossBorder)
    return { ...companies, plannedShippingAt, description, incoterm };
  const customs = record(
    raw.customs,
    [
      "currency",
      "invoiceNumber",
      "invoiceDate",
      "exportReason",
      "acknowledgment",
      "lines",
    ],
    ["invoiceType"],
  );
  check(
    !Object.hasOwn(customs, "invoiceType") ||
      ["commercial", "proforma", "returns"].includes(
        customs.invoiceType as string,
      ),
    "VALIDATION",
    "Choose an explicit supported DHL customs invoice type.",
    400,
  );
  check(
    customs.currency === "USD" || customs.currency === "CAD",
    "VALIDATION",
    "Choose the declaration currency explicitly.",
    400,
  );
  const invoiceNumber = exactText(
      customs.invoiceNumber,
      "DHL declaration invoice number",
      35,
    ),
    invoiceDate = calendarDate(customs.invoiceDate),
    acknowledgment = exactText(
      customs.acknowledgment,
      "DHL declaration acknowledgment",
      1000,
    );
  check(
    invoiceDate <= plannedShippingAt.slice(0, 10),
    "VALIDATION",
    "The declaration invoice date cannot follow the local shipping date.",
    400,
  );
  check(
    [
      "commercial_purpose_or_sale",
      "return",
      "warranty_replacement",
      "sample",
      "gift",
      "temporary",
    ].includes(customs.exportReason as string),
    "VALIDATION",
    "Choose the reviewed export reason.",
    400,
  );
  check(
    Array.isArray(customs.lines) &&
      customs.lines.length > 0 &&
      customs.lines.length <= 100 &&
      Reflect.ownKeys(customs.lines).length === customs.lines.length + 1 &&
      Array.from({ length: customs.lines.length }, (_, index) =>
        Object.hasOwn(customs.lines as unknown[], index),
      ).every(Boolean),
    "VALIDATION",
    "Supply 1–100 explicit declaration lines without gaps or extra properties.",
    400,
  );
  const packed = JSON.parse(shipment.lines) as {
    allocationId: string;
    quantity: number;
  }[];
  const packedById = new Map(
    packed.map((line) => [line.allocationId, line.quantity]),
  );
  const seen = new Set<string>();
  let totalValue = 0n,
    totalNetWeight = 0;
  const lines = Array.from(customs.lines, (value) => {
    const line = record(value, [
      "allocationId",
      "quantity",
      "description",
      "unitValueMinor",
      "manufacturerCountry",
      "commodityCode",
      "netWeightGrams",
    ]);
    const allocationId = exactText(line.allocationId, "Packed allocation", 160),
      quantity = integer(line.quantity, "Declared quantity", 1),
      unitValueMinor = integer(
        line.unitValueMinor,
        "Declared unit value in minor currency units",
        1,
        1e12,
      ),
      netWeightGrams = integer(
        line.netWeightGrams,
        "Total line net weight in grams",
        1,
        parcel.weightGrams,
      ),
      manufacturerCountry = exactText(
        line.manufacturerCountry,
        "Manufacturer country",
        2,
      ),
      commodityCode = exactText(line.commodityCode, "Commodity code", 18),
      lineDescription = exactText(
        line.description,
        "Declared goods description",
        512,
      );
    check(
      !seen.has(allocationId) && packedById.get(allocationId) === quantity,
      "CARRIER_MISMATCH",
      "Each declaration line must match a unique packed allocation and its full quantity.",
    );
    seen.add(allocationId);
    check(
      /^[A-Z]{2}$/.test(manufacturerCountry) &&
        /^\d{6,18}$/.test(commodityCode),
      "VALIDATION",
      "Supply a two-letter origin and a 6–18 digit commodity code; qualification is separate.",
      400,
    );
    totalValue += BigInt(unitValueMinor) * BigInt(quantity);
    totalNetWeight += netWeightGrams;
    return {
      allocationId,
      quantity,
      description: lineDescription,
      unitValueMinor,
      manufacturerCountry,
      commodityCode,
      netWeightGrams,
    };
  });
  check(
    seen.size === packedById.size,
    "CARRIER_MISMATCH",
    "Declare every packed allocation exactly once.",
  );
  check(
    totalValue <= BigInt(Number.MAX_SAFE_INTEGER) &&
      totalNetWeight <= parcel.weightGrams,
    "VALIDATION",
    "Declared totals must be representable and net goods weight cannot exceed gross parcel weight.",
    400,
  );
  return {
    ...companies,
    plannedShippingAt,
    description,
    incoterm,
    customs: {
      ...(Object.hasOwn(customs, "invoiceType")
        ? {
            invoiceType: customs.invoiceType as
              "commercial" | "proforma" | "returns",
          }
        : {}),
      currency: customs.currency,
      invoiceNumber,
      invoiceDate,
      exportReason: customs.exportReason as NonNullable<
        DhlShippingReview["customs"]
      >["exportReason"],
      acknowledgment,
      lines,
    },
  };
}
