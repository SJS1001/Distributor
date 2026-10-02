import { PDFDocument } from "pdf-lib";
import {
  carrierConfiguration,
  assertCarrierConfiguration,
} from "./carrier-configuration.ts";
import { canonical, check, digest } from "./core.ts";
import { captureDhlReview } from "./dhl-shipping-review.ts";
import {
  validateCarrierLabel,
  type CarrierAdapter,
  type CarrierIntent,
  type CarrierResult,
} from "./carrier-bookings.ts";
import type {
  CarrierAddress,
  CarrierConfiguration,
} from "../shared/carrier-booking.ts";

export type DhlTestConfig = {
  orgId: string;
  username: string;
  password: string;
  accountNumber: string;
  country: "US" | "CA";
  services: {
    service: string;
    productCode: string;
    localProductCode: string;
    destinationCountry: "US" | "CA";
  }[];
};
const base = "https://express.api.dhl.com/mydhlapi/test";
const maximumResponse = 4_194_304;
const maximumDocument = 1_048_576;

// Original MyDHL test protocol mapping. Construction never performs I/O.
// Message/customer references correlate replies; neither prevents repurchase.
export class DhlTestClient implements CarrierAdapter {
  readonly provider = "dhl-express" as const;
  readonly sandbox = true as const;
  readonly configuration: CarrierConfiguration;
  private readonly config: Readonly<
    Omit<DhlTestConfig, "services"> & {
      services: readonly Readonly<DhlTestConfig["services"][number]>[];
    }
  >;
  constructor(
    config: DhlTestConfig,
    private readonly transport: typeof fetch = fetch,
    private readonly clock: () => number = Date.now,
  ) {
    check(
      config &&
        validText(config.orgId, 128) &&
        validText(config.username, 512) &&
        /^[\x21-\x39\x3b-\x7e]+$/.test(config.username) &&
        validText(config.password, 1024) &&
        /^[\x20-\x7e]+$/.test(config.password) &&
        typeof config.accountNumber === "string" &&
        /^[A-Za-z0-9]{1,12}$/.test(config.accountNumber) &&
        ["US", "CA"].includes(config.country) &&
        Array.isArray(config.services) &&
        config.services.length > 0 &&
        config.services.length <= 20 &&
        Array.from(config.services).every(
          (s) =>
            s &&
            Object.keys(s).sort().join(",") ===
              "destinationCountry,localProductCode,productCode,service" &&
            validText(s.service, 100) &&
            typeof s.productCode === "string" &&
            /^[A-Z0-9]{1,6}$/.test(s.productCode) &&
            typeof s.localProductCode === "string" &&
            /^[A-Z0-9]{1,3}$/.test(s.localProductCode) &&
            ["US", "CA"].includes(s.destinationCountry),
        ) &&
        new Set(config.services.map((s) => s.service)).size ===
          config.services.length &&
        typeof transport === "function" &&
        typeof clock === "function",
      "CARRIER_CONFIG",
      "Supply explicit DHL test credentials/account/origin country and exact product, local product and destination mappings.",
      500,
    );
    this.config = Object.freeze({
      orgId: config.orgId,
      username: config.username,
      password: config.password,
      accountNumber: config.accountNumber,
      country: config.country,
      services: Object.freeze(
        config.services.map((s) => Object.freeze({ ...s })),
      ),
    });
    this.configuration = carrierConfiguration(
      this.provider,
      {
        orgId: this.config.orgId,
        endpoint: base,
        username: this.config.username,
        accountNumber: this.config.accountNumber,
        country: this.config.country,
        services: this.config.services,
        pickup: false,
        output: "separate-pdf-label-waybill-and-customs-invoice",
      },
      `DHL account ending ${this.config.accountNumber.slice(-4)}`,
      [
        "DHL Express test environment",
        `Origin country: ${this.config.country}`,
        "No pickup request; sender shipping account; no prepaid duties",
        "PDF download retains transport label, waybill and customs invoice pages",
      ],
      this.config.services.map((s) => ({
        service: s.service,
        description: `${s.productCode} · Local ${s.localProductCode} · ${this.config.country} to ${s.destinationCountry}`,
      })),
    );
  }
  private review(intent: CarrierIntent) {
    check(
      intent &&
        intent.provider === this.provider &&
        intent.nativeSnapshot?.org_id === this.config.orgId &&
        intent.shipmentId === intent.nativeSnapshot.id &&
        validText(intent.bookingId, 128) &&
        typeof intent.reviewHash === "string" &&
        /^[a-f0-9]{64}$/.test(intent.reviewHash),
      "CARRIER_MISMATCH",
      "DHL test intent must belong to the configured organization and reviewed shipment.",
    );
    const { bookingId, reviewHash, ...review } = intent;
    check(
      digest(canonical(review)) === reviewHash,
      "CARRIER_MISMATCH",
      "DHL test intent does not match its review hash.",
    );
    assertCarrierConfiguration(intent, this.configuration);
    const service = this.config.services.find(
      (s) => s.service === intent.service,
    );
    check(
      service &&
        intent.origin?.country === this.config.country &&
        intent.destination?.country === service.destinationCountry,
      "CARRIER_UNSUPPORTED",
      "DHL test shipping requires the exact reviewed origin, destination and product mapping.",
    );
    const dhl = captureDhlReview(
      intent.dhl,
      intent.nativeSnapshot,
      intent.origin,
      intent.destination,
      intent.parcel,
    );
    check(
      dhl.companyNames && validText(dhl.description, 70),
      "CARRIER_UNSUPPORTED",
      "DHL transmission requires separately reviewed shipper/receiver companies and a goods description of at most 70 characters. Never infer or truncate them.",
    );
    check(
      !dhl.customs || dhl.customs.invoiceType !== undefined,
      "CARRIER_UNSUPPORTED",
      "DHL customs transmission requires the explicitly reviewed commercial, proforma or returns invoice type.",
    );
    const shipper = contact(intent.origin, dhl.companyNames.shipper),
      receiver = contact(intent.destination, dhl.companyNames.receiver),
      p = intent.parcel;
    check(
      p &&
        [p.weightGrams, p.lengthMm, p.widthMm, p.heightMm].every(
          (v) => Number.isSafeInteger(v) && v > 0,
        ) &&
        p.weightGrams <= 70_000 &&
        [p.lengthMm, p.widthMm, p.heightMm].every((v) => v <= 1200),
      "CARRIER_UNSUPPORTED",
      "The local DHL ordinary-parcel boundary is one parcel of at most 70 kg with each side at most 120 cm; actual product eligibility remains to be qualified.",
    );
    const identity = canonical({
      orgId: this.config.orgId,
      accountNumber: this.config.accountNumber,
      bookingId,
      reviewHash,
    });
    const hex = digest("DHL:" + identity),
      transaction = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`,
      reference = "D" + digest(identity).slice(0, 29).toUpperCase();
    return { service, dhl, shipper, receiver, transaction, reference };
  }
  async book(
    intent: CarrierIntent,
    beforeWrite: () => void,
  ): Promise<CarrierResult> {
    check(
      typeof beforeWrite === "function",
      "CARRIER_CONFIG",
      "DHL test booking requires the synchronous native write guard.",
      500,
    );
    const r = this.review(intent),
      customs = r.dhl.customs,
      p = intent.parcel;
    const total = customs?.lines.reduce(
      (sum, line) => sum + BigInt(line.unitValueMinor) * BigInt(line.quantity),
      0n,
    );
    const body = JSON.stringify({
      plannedShippingDateAndTime:
        r.dhl.plannedShippingAt.slice(0, 19) +
        " GMT" +
        r.dhl.plannedShippingAt.slice(19),
      pickup: { isRequested: false },
      productCode: r.service.productCode,
      localProductCode: r.service.localProductCode,
      getRateEstimates: false,
      accounts: [{ typeCode: "shipper", number: this.config.accountNumber }],
      customerReferences: [{ typeCode: "CU", value: r.reference }],
      customerDetails: {
        shipperDetails: r.shipper,
        receiverDetails: r.receiver,
      },
      content: {
        packages: [
          {
            referenceNumber: 1,
            weight: p.weightGrams / 1000,
            dimensions: {
              length: p.lengthMm / 10,
              width: p.widthMm / 10,
              height: p.heightMm / 10,
            },
          },
        ],
        isCustomsDeclarable: Boolean(customs),
        description: r.dhl.description,
        incoterm: r.dhl.incoterm,
        unitOfMeasurement: "metric",
        ...(customs
          ? {
              declaredValue: minorAmount(total!),
              declaredValueCurrency: customs.currency,
              exportDeclaration: {
                invoice: {
                  number: customs.invoiceNumber,
                  date: customs.invoiceDate,
                  totalNetWeight:
                    customs.lines.reduce(
                      (sum, line) => sum + line.netWeightGrams,
                      0,
                    ) / 1000,
                  totalGrossWeight: p.weightGrams / 1000,
                },
                exportReasonType: customs.exportReason,
                lineItems: customs.lines.map((line, index) => ({
                  number: index + 1,
                  description: line.description,
                  price: minorAmount(BigInt(line.unitValueMinor)),
                  quantity: { value: line.quantity, unitOfMeasurement: "PCS" },
                  manufacturerCountry: line.manufacturerCountry,
                  commodityCodes: [
                    { typeCode: "outbound", value: line.commodityCode },
                  ],
                  weight: { netValue: line.netWeightGrams / 1000 },
                })),
              },
            }
          : {}),
      },
      outputImageProperties: {
        encodingFormat: "pdf",
        imageOptions: [
          { typeCode: "label", templateName: "ECOM26_84_001" },
          {
            typeCode: "waybillDoc",
            templateName: "ARCH_8X4",
            isRequested: true,
            hideAccountNumber: true,
            numberOfCopies: 1,
          },
          ...(customs
            ? [
                {
                  typeCode: "invoice",
                  templateName: "COMMERCIAL_INVOICE_P_10",
                  isRequested: true,
                  invoiceType: customs.invoiceType,
                },
              ]
            : []),
          { typeCode: "shipmentReceipt", isRequested: false },
        ],
        splitTransportAndWaybillDocLabels: true,
        allDocumentsInOneImage: false,
        splitDocumentsByPages: false,
        splitInvoiceAndReceipt: true,
      },
    });
    const init: RequestInit = {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization:
          "Basic " +
          Buffer.from(
            `${this.config.username}:${this.config.password}`,
            "ascii",
          ).toString("base64"),
        "Message-Reference": r.transaction,
      },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    };
    // A stale scheduled review remains recoverable but cannot create a shipment.
    // No await, refresh, retry or other provider action occurs before the write.
    const at = Date.parse(r.dhl.plannedShippingAt),
      current = this.clock();
    check(
      Number.isSafeInteger(current) &&
        current >= 0 &&
        at > current &&
        at - current <= 10 * 86_400_000,
      "CARRIER_UNSUPPORTED",
      "DHL planned tender time must still be in the future and within ten days at transmission. Cancel an unsent review to select a new time.",
    );
    beforeWrite();
    let raw: unknown;
    let received: Response | undefined;
    try {
      const response = await this.transport(base + "/shipments", init);
      received = response;
      check(
        response.status === 201 &&
          !response.redirected &&
          /^application\/json(?:\s*;|$)/i.test(
            response.headers.get("content-type") ?? "",
          ) &&
          response.headers.get("Message-Reference") === r.transaction,
        "CARRIER_TRANSPORT",
        "DHL test response does not identify the successful reviewed request.",
        502,
      );
      raw = await readJson(response);
    } catch {
      // Dispose rejected headers/status bodies without reading or exposing them.
      await received?.body?.cancel().catch(() => {});
      check(
        false,
        "CARRIER_TRANSPORT",
        "DHL test response is unavailable or invalid. Keep the outcome uncertain; do not resend.",
        502,
      );
    }
    const response = object(raw),
      part = single(response.packages);
    check(
      Object.keys(response).every((key) =>
        [
          "url",
          "shipmentTrackingNumber",
          "cancelPickupUrl",
          "trackingUrl",
          "dispatchConfirmationNumber",
          "packages",
          "documents",
          "onDemandDeliveryURL",
          "shipmentDetails",
          "shipmentCharges",
          "barcodeInfo",
          "estimatedDeliveryDate",
          "warnings",
        ].includes(key),
      ) &&
        Object.keys(part).every((key) =>
          [
            "referenceNumber",
            "trackingNumber",
            "trackingUrl",
            "volumetricWeight",
          ].includes(key),
        ) &&
        typeof response.shipmentTrackingNumber === "string" &&
        /^\d{10}$/.test(response.shipmentTrackingNumber) &&
        part.referenceNumber === 1 &&
        typeof part.trackingNumber === "string" &&
        /^[A-Z0-9]{10,35}$/.test(part.trackingNumber) &&
        part.documents === undefined &&
        response.dispatchConfirmationNumber === undefined &&
        response.cancelPickupUrl === undefined &&
        (response.warnings === undefined ||
          (Array.isArray(response.warnings) && response.warnings.length === 0)),
      "CARRIER_RESULT",
      "DHL test must return one matching parcel, a ten-digit waybill and no unexpected fields, pickup, per-piece documents or warning.",
    );
    const label = await documents(response.documents, Boolean(customs));
    return {
      bookingId: intent.bookingId,
      reviewHash: intent.reviewHash,
      reference: r.reference,
      tracking: response.shipmentTrackingNumber,
      label,
    };
  }
  async lookup(intent: CarrierIntent): Promise<CarrierResult | null> {
    this.review(intent);
    // Tracking by a known waybill cannot retrieve a lost shipment's original
    // documents by our customer reference. No invented endpoint or repurchase.
    check(
      false,
      "CARRIER_RECOVERY_UNSUPPORTED",
      "DHL lost-response document recovery is unsupported. Keep this booking uncertain and reconcile with the carrier without purchasing another shipment.",
      409,
    );
  }
}
function validText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}
function contact(a: CarrierAddress, companyName: string) {
  check(
    a &&
      ["US", "CA"].includes(a.country) &&
      validText(a.name, 255) &&
      validText(a.line1, 45) &&
      validText(a.city, 45) &&
      typeof a.line2 === "string" &&
      (a.line2 === "" || validText(a.line2, 45)) &&
      typeof a.province === "string" &&
      /^[A-Z]{2}$/.test(a.province) &&
      typeof a.postalCode === "string" &&
      (a.country === "CA"
        ? /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTVWXYZ] ?\d[ABCEGHJ-NPRSTVWXYZ]\d$/.test(
            a.postalCode,
          )
        : /^\d{5}(-\d{4})?$/.test(a.postalCode)) &&
      validText(a.phone, 32) &&
      /^\+?[0-9 () .-]+$/.test(a.phone) &&
      /^(?:1)?\d{10}$/.test(a.phone.replace(/\D/g, "")),
    "CARRIER_UNSUPPORTED",
    "DHL requires bounded US/Canadian contact/address fields and a ten-digit phone, optionally prefixed by 1.",
  );
  return {
    postalAddress: {
      postalCode: a.postalCode,
      cityName: a.city,
      countryCode: a.country,
      provinceCode: a.province,
      addressLine1: a.line1,
      ...(a.line2 ? { addressLine2: a.line2 } : {}),
    },
    contactInformation: { fullName: a.name, companyName, phone: a.phone },
  };
}
function minorAmount(minor: bigint): number {
  const value = Number(minor) / 100,
    decimal = JSON.stringify(value),
    match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(decimal);
  check(
    match && BigInt(match[1]! + (match[2] ?? "").padEnd(2, "0")) === minor,
    "CARRIER_UNSUPPORTED",
    "DHL declared values must preserve every reviewed minor currency unit in JSON; do not round or convert them.",
  );
  return value;
}
function object(value: unknown): Record<string, unknown> {
  check(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "CARRIER_RESULT",
    "DHL test returned an invalid response structure.",
  );
  return value as Record<string, unknown>;
}
function single(value: unknown) {
  check(
    Array.isArray(value) && value.length === 1,
    "CARRIER_RESULT",
    "DHL test must return exactly one parcel.",
  );
  return object(value[0]);
}
async function documents(
  value: unknown,
  customs: boolean,
): Promise<CarrierResult["label"]> {
  check(
    Array.isArray(value) && value.length === (customs ? 3 : 2),
    "CARRIER_RESULT",
    "DHL must return separate transport/waybill PDFs and, for customs, exactly one invoice; no document may be discarded.",
  );
  const docs = value.map(object);
  check(
    docs.filter((d) => d.typeCode === "label").length === 2 &&
      docs.filter((d) => d.typeCode === "invoice").length === (customs ? 1 : 0),
    "CARRIER_RESULT",
    "DHL document roles do not match the reviewed request.",
  );
  try {
    const merged = await PDFDocument.create(),
      hashes = new Set<string>();
    for (const doc of docs) {
      check(
        Object.keys(doc).every((k) =>
          [
            "imageFormat",
            "content",
            "typeCode",
            "packageReferenceNumber",
          ].includes(k),
        ) &&
          (doc.packageReferenceNumber === undefined ||
            doc.packageReferenceNumber === 1) &&
          doc.imageFormat === "PDF" &&
          typeof doc.content === "string" &&
          doc.content.length > 0 &&
          doc.content.length <= 4 * Math.ceil(maximumDocument / 3) &&
          /^[A-Za-z0-9+/]*={0,2}$/.test(doc.content),
        "CARRIER_RESULT",
        "DHL documents require bounded inline canonical base64 PDFs for this parcel.",
      );
      const bytes = Buffer.from(doc.content, "base64");
      check(
        bytes.toString("base64") === doc.content && !hashes.has(digest(bytes)),
        "CARRIER_RESULT",
        "DHL document encoding or distinct document identity is invalid.",
      );
      hashes.add(digest(bytes));
      validateCarrierLabel({ mediaType: "application/pdf", bytes });
      const original = await PDFDocument.load(bytes, { updateMetadata: false });
      check(
        original.getPageCount() > 0 &&
          merged.getPageCount() + original.getPageCount() <= 50,
        "CARRIER_RESULT",
        "DHL document page count exceeds the local boundary.",
      );
      for (const page of await merged.copyPages(
        original,
        original.getPageIndices(),
      ))
        merged.addPage(page);
    }
    const label = {
      mediaType: "application/pdf" as const,
      bytes: Buffer.from(await merged.save()),
    };
    validateCarrierLabel(label);
    return label;
  } catch {
    check(
      false,
      "CARRIER_RESULT",
      "DHL documents could not be retained completely as a bounded PDF. Keep this booking uncertain; do not resend.",
    );
  }
}
async function readJson(response: Response): Promise<unknown> {
  check(response.body, "CARRIER_RESULT", "DHL test response body is missing.");
  const reader = response.body.getReader(),
    chunks: Buffer[] = [];
  let size = 0;
  try {
    const length = response.headers.get("content-length");
    check(
      length === null ||
        (/^\d+$/.test(length) && Number(length) <= maximumResponse),
      "CARRIER_RESULT",
      "DHL response exceeds the permitted size.",
    );
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      check(
        size <= maximumResponse,
        "CARRIER_RESULT",
        "DHL response exceeds the permitted size.",
      );
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
