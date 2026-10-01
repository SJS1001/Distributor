import {
  carrierConfiguration,
  assertCarrierConfiguration,
} from "./carrier-configuration.ts";
import type { CarrierConfiguration } from "../shared/carrier-booking.ts";
import { canonical, check, digest } from "./core.ts";
import {
  validateCarrierLabel,
  type CarrierAdapter,
  type CarrierIntent,
  type CarrierResult,
} from "./carrier-bookings.ts";
import type { CarrierAddress } from "../shared/carrier-booking.ts";

export type FedexSandboxConfig = {
  orgId: string;
  clientId: string;
  clientSecret: string;
  accountNumber: string;
  country: "US" | "CA";
  pickupType: "DROPOFF_AT_FEDEX_LOCATION" | "USE_SCHEDULED_PICKUP";
  // An exact reviewed service includes the destination's residential status.
  services: {
    service: string;
    code: "FEDEX_GROUND" | "GROUND_HOME_DELIVERY";
    residential: boolean;
  }[];
};
const base = "https://apis-sandbox.fedex.com";
const maximumResponse = 2_097_152;
const maximumLabel = 1_048_576;

// Explicit sandbox configuration only; construction performs no provider I/O.
// Customer transaction/reference values correlate results, not write idempotency.
export class FedexSandbox implements CarrierAdapter {
  readonly provider = "fedex" as const;
  readonly sandbox = true as const;
  readonly configuration: CarrierConfiguration;
  private readonly config: Readonly<
    Omit<FedexSandboxConfig, "services"> & {
      services: readonly Readonly<FedexSandboxConfig["services"][number]>[];
    }
  >;
  constructor(
    config: FedexSandboxConfig,
    private readonly transport: typeof fetch = fetch,
  ) {
    check(
      config &&
        validText(config.orgId, 128) &&
        validText(config.clientId, 512) &&
        validText(config.clientSecret, 1024) &&
        typeof config.accountNumber === "string" &&
        /^\d{9}$/.test(config.accountNumber) &&
        (config.country === "US" || config.country === "CA") &&
        ["DROPOFF_AT_FEDEX_LOCATION", "USE_SCHEDULED_PICKUP"].includes(
          config.pickupType,
        ) &&
        Array.isArray(config.services) &&
        config.services.length > 0 &&
        config.services.length <= 20 &&
        // Array.from also checks holes; a sparse configuration is invalid.
        Array.from(config.services).every(
          (entry) =>
            entry &&
            validText(entry.service, 100) &&
            typeof entry.residential === "boolean" &&
            ((entry.code === "FEDEX_GROUND" &&
              (config.country === "CA" || !entry.residential)) ||
              (entry.code === "GROUND_HOME_DELIVERY" &&
                config.country === "US" &&
                entry.residential)),
        ) &&
        new Set(config.services.map((entry) => entry.service)).size ===
          config.services.length &&
        typeof transport === "function",
      "CARRIER_CONFIG",
      "Supply an organization, FedEx sandbox credentials/account/country, pickup arrangement and exact domestic ground service mappings.",
      500,
    );
    this.config = Object.freeze({
      ...config,
      services: Object.freeze(
        config.services.map((entry) => Object.freeze({ ...entry })),
      ),
    });
    this.configuration = carrierConfiguration(
      this.provider,
      {
        orgId: this.config.orgId,
        endpoint: base,
        clientId: this.config.clientId,
        accountNumber: this.config.accountNumber,
        country: this.config.country,
        pickupType: this.config.pickupType,
        services: this.config.services,
      },
      `FedEx account ending ${this.config.accountNumber.slice(-4)}`,
      [
        "FedEx sandbox",
        `Domestic country: ${this.config.country}`,
        this.config.pickupType === "DROPOFF_AT_FEDEX_LOCATION"
          ? "Drop off at FedEx location"
          : "Use scheduled pickup",
      ],
      this.config.services.map((entry) => ({
        service: entry.service,
        description: `${entry.code} · ${entry.residential ? "Residential" : "Nonresidential"}`,
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
        /^[a-f0-9]{64}$/.test(intent.reviewHash),
      "CARRIER_MISMATCH",
      "FedEx sandbox intent must belong to the configured organization and reviewed shipment.",
    );
    const { bookingId, reviewHash, ...review } = intent;
    check(
      digest(canonical(review)) === reviewHash,
      "CARRIER_MISMATCH",
      "FedEx sandbox intent does not match its review hash.",
    );
    assertCarrierConfiguration(intent, this.configuration);
    const service = this.config.services.find(
      (entry) => entry.service === intent.service,
    );
    check(
      service &&
        intent.origin?.country === this.config.country &&
        intent.destination?.country === this.config.country,
      "CARRIER_UNSUPPORTED",
      "FedEx sandbox requires an exactly mapped domestic ground service in the configured country. Cross-border shipping requires separate qualification.",
    );
    const shipper = contact(intent.origin, false),
      recipient = contact(intent.destination, service.residential),
      p = intent.parcel;
    check(
      p &&
        [p.weightGrams, p.lengthMm, p.widthMm, p.heightMm].every(
          (n) => Number.isSafeInteger(n) && n > 0,
        ) &&
        p.weightGrams <= 68_000,
      "CARRIER_UNSUPPORTED",
      "FedEx sandbox requires one ordinary parcel with positive whole grams/millimeters and at most 68 kg.",
    );
    // FedEx dimensions are whole units. Round upwards, never understate a parcel.
    const dimensions = {
      length: Math.ceil(p.lengthMm / 10),
      width: Math.ceil(p.widthMm / 10),
      height: Math.ceil(p.heightMm / 10),
      units: "CM",
    };
    const sides = [dimensions.length, dimensions.width, dimensions.height],
      longest = Math.max(...sides);
    check(
      longest <= 274 &&
        longest + 2 * (sides.reduce((a, b) => a + b, 0) - longest) <= 400,
      "CARRIER_UNSUPPORTED",
      "FedEx sandbox rounded dimensions exceed the local ordinary-parcel bounds.",
    );
    const identity = canonical({
        orgId: this.config.orgId,
        accountNumber: this.config.accountNumber,
        bookingId,
        reviewHash,
      }),
      reference = "D" + digest(identity).slice(0, 29).toUpperCase(),
      transaction = digest("FedEx:" + identity).slice(0, 32);
    return { shipper, recipient, service, dimensions, reference, transaction };
  }
  private async token() {
    const response = object(
      await this.request(
        "/oauth/token",
        new URLSearchParams({
          grant_type: "client_credentials",
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
        }).toString(),
        { "content-type": "application/x-www-form-urlencoded" },
      ),
    );
    check(
      typeof response.token_type === "string" &&
        response.token_type.toLowerCase() === "bearer" &&
        typeof response.access_token === "string" &&
        /^[A-Za-z0-9._~+/-]+=*$/.test(response.access_token) &&
        response.access_token.length <= 16_384 &&
        Number.isSafeInteger(response.expires_in) &&
        (response.expires_in as number) > 30 &&
        (response.expires_in as number) <= 86_400,
      "CARRIER_RESULT",
      "FedEx sandbox returned an invalid authorization response.",
    );
    return response.access_token;
  }
  private async request(
    path: "/oauth/token" | "/ship/v1/shipments",
    body: string,
    headers: Record<string, string>,
    beforeWrite?: () => void,
  ): Promise<unknown> {
    const url = base + path;
    const init: RequestInit = {
      method: "POST",
      headers: { accept: "application/json", ...headers },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    };
    // Serialization, authentication and timeout creation precede the sole guard.
    // Guard errors keep their native code; no await/retry can precede transport.
    beforeWrite?.();
    try {
      const response = await this.transport(url, init);
      check(
        response.status === 200 &&
          !response.redirected &&
          /^application\/json(?:\s*;|$)/i.test(
            response.headers.get("content-type") ?? "",
          ),
        "CARRIER_TRANSPORT",
        "FedEx sandbox did not return a successful JSON response.",
        502,
      );
      return await readJson(response);
    } catch {
      check(
        false,
        "CARRIER_TRANSPORT",
        "FedEx sandbox response is unavailable or invalid. Keep the outcome uncertain; do not resend.",
        502,
      );
    }
  }
  async book(
    intent: CarrierIntent,
    beforeWrite: () => void,
  ): Promise<CarrierResult> {
    check(
      typeof beforeWrite === "function",
      "CARRIER_CONFIG",
      "FedEx sandbox booking requires the synchronous native write guard.",
      500,
    );
    const review = this.review(intent);
    const body = JSON.stringify({
      accountNumber: { value: this.config.accountNumber },
      labelResponseOptions: "LABEL",
      processingOptionType: "SYNCHRONOUS_ONLY",
      shipAction: "CONFIRM",
      oneLabelAtATime: false,
      requestedShipment: {
        shipper: review.shipper,
        recipients: [review.recipient],
        pickupType: this.config.pickupType,
        serviceType: review.service.code,
        packagingType: "YOUR_PACKAGING",
        shippingChargesPayment: { paymentType: "SENDER" },
        totalWeight: intent.parcel.weightGrams / 1000,
        totalPackageCount: 1,
        labelSpecification: { imageType: "PDF", labelStockType: "PAPER_4X6" },
        requestedPackageLineItems: [
          {
            sequenceNumber: "1",
            groupPackageCount: 1,
            weight: { units: "KG", value: intent.parcel.weightGrams / 1000 },
            dimensions: review.dimensions,
            customerReferences: [
              {
                customerReferenceType: "CUSTOMER_REFERENCE",
                value: review.reference,
              },
            ],
          },
        ],
      },
    });
    const token = await this.token();
    const response = object(
      await this.request(
        "/ship/v1/shipments",
        body,
        {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "x-locale": "en_US",
          "x-customer-transaction-id": review.transaction,
        },
        beforeWrite,
      ),
    );
    check(
      response.customerTransactionId === review.transaction &&
        (response.errors === undefined ||
          (Array.isArray(response.errors) && response.errors.length === 0)),
      "CARRIER_RESULT",
      "FedEx sandbox response does not match this reviewed transaction.",
    );
    const output = object(response.output);
    check(
      output.jobId === undefined,
      "CARRIER_RESULT",
      "FedEx sandbox returned asynchronous processing for a synchronous booking.",
    );
    const shipment = single(output.transactionShipments),
      part = single(shipment.pieceResponses),
      tracking = trackingNumber(part.trackingNumber);
    const references = part.customerReferences;
    check(
      shipment.serviceType === review.service.code &&
        shipment.masterTrackingNumber === tracking &&
        part.packageSequenceNumber === 1 &&
        (part.masterTrackingNumber === undefined ||
          part.masterTrackingNumber === tracking) &&
        Array.isArray(references) &&
        references.filter(
          (entry) =>
            object(entry).customerReferenceType === "CUSTOMER_REFERENCE",
        ).length === 1 &&
        references.some(
          (entry) =>
            object(entry).customerReferenceType === "CUSTOMER_REFERENCE" &&
            object(entry).value === review.reference,
        ),
      "CARRIER_RESULT",
      "FedEx sandbox shipment and parcel must carry this exact service, sequence, tracking and customer reference.",
    );
    const document = single(part.packageDocuments);
    check(
      document.contentType === "LABEL" &&
        document.docType === "PDF" &&
        document.trackingNumber === tracking &&
        document.url === undefined &&
        typeof document.encodedLabel === "string" &&
        document.encodedLabel.length > 0 &&
        document.encodedLabel.length <= 4 * Math.ceil(maximumLabel / 3) &&
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          document.encodedLabel,
        ),
      "CARRIER_RESULT",
      "FedEx sandbox must return one matching inline base64 PDF label, without an external URL.",
    );
    const bytes = Buffer.from(document.encodedLabel, "base64");
    check(
      bytes.toString("base64") === document.encodedLabel,
      "CARRIER_RESULT",
      "FedEx sandbox label encoding is invalid.",
    );
    const label = { mediaType: "application/pdf" as const, bytes };
    validateCarrierLabel(label);
    return {
      bookingId: intent.bookingId,
      reviewHash: intent.reviewHash,
      reference: review.reference,
      tracking,
      label,
    };
  }
  async lookup(intent: CarrierIntent): Promise<CarrierResult | null> {
    this.review(intent);
    // Ship results require a known async job ID; a lost synchronous reply has
    // none. Tracking alone cannot recover the original label. Never repurchase.
    check(
      false,
      "CARRIER_RECOVERY_UNSUPPORTED",
      "FedEx synchronous label recovery is not supported. Keep this booking uncertain; obtain provider reconciliation without purchasing another label.",
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
function object(value: unknown): Record<string, unknown> {
  check(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "CARRIER_RESULT",
    "FedEx sandbox returned an invalid response structure.",
  );
  return value as Record<string, unknown>;
}
function single(value: unknown): Record<string, unknown> {
  check(
    Array.isArray(value) && value.length === 1,
    "CARRIER_RESULT",
    "FedEx sandbox must identify exactly one shipment, parcel and label.",
  );
  return object(value[0]);
}
function trackingNumber(value: unknown): string {
  check(
    typeof value === "string" && /^\d{12,22}$/.test(value),
    "CARRIER_RESULT",
    "FedEx sandbox must return a bounded numeric tracking number.",
  );
  return value;
}
function contact(address: CarrierAddress, residential: boolean) {
  check(
    address &&
      (address.country === "US" || address.country === "CA") &&
      [address.name, address.line1, address.city].every(
        (value) => validText(value, 35) && /^[\x20-\x7e]+$/.test(value),
      ) &&
      typeof address.line2 === "string" &&
      (address.line2 === "" ||
        (validText(address.line2, 35) &&
          /^[\x20-\x7e]+$/.test(address.line2))) &&
      typeof address.province === "string" &&
      /^[A-Z]{2}$/.test(address.province) &&
      typeof address.postalCode === "string" &&
      (address.country === "CA"
        ? /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTVWXYZ] ?\d[ABCEGHJ-NPRSTVWXYZ]\d$/.test(
            address.postalCode,
          )
        : /^\d{5}(-\d{4})?$/.test(address.postalCode)) &&
      validText(address.phone, 32) &&
      /^\+?[0-9 () .-]+$/.test(address.phone) &&
      /^(?:1)?\d{10}$/.test(address.phone.replace(/\D/g, "")),
    "CARRIER_UNSUPPORTED",
    "FedEx sandbox requires bounded ASCII US/Canadian contact/address fields and a ten-digit phone, optionally prefixed by 1.",
  );
  const phone = address.phone.replace(/\D/g, "");
  return {
    contact: {
      personName: address.name,
      phoneNumber: phone.length === 11 ? phone.slice(1) : phone,
    },
    address: {
      streetLines: [address.line1, ...(address.line2 ? [address.line2] : [])],
      city: address.city,
      stateOrProvinceCode: address.province,
      postalCode: address.postalCode.replace(/ /g, ""),
      countryCode: address.country,
      residential,
    },
  };
}
async function readJson(response: Response): Promise<unknown> {
  const length = response.headers.get("content-length");
  check(
    response.body,
    "CARRIER_RESULT",
    "FedEx sandbox response body is missing.",
  );
  const reader = response.body.getReader(),
    chunks: Buffer[] = [];
  let size = 0;
  try {
    check(
      length === null ||
        (/^\d+$/.test(length) && Number(length) <= maximumResponse),
      "CARRIER_RESULT",
      "FedEx sandbox response exceeds the permitted size.",
    );
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      check(
        size <= maximumResponse,
        "CARRIER_RESULT",
        "FedEx sandbox response exceeds the permitted size.",
      );
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
