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

export type UpsSandboxConfig = {
  orgId: string;
  clientId: string;
  clientSecret: string;
  shipperNumber: string;
  shipper: CarrierAddress;
  // Exact reviewed service text -> selected UPS code. No implicit service default.
  services: { service: string; code: string }[];
};
const base = "https://wwwcie.ups.com";
const maximumLabel = 1_048_576;
const maximumResponse = 2_097_152;

// Explicit sandbox configuration only; construction performs no provider I/O.
// CustomerContext correlates a response; it is NOT vendor write idempotency.
export class UpsSandbox implements CarrierAdapter {
  readonly provider = "ups" as const;
  readonly sandbox = true as const;
  readonly configuration: CarrierConfiguration;
  private readonly config: UpsSandboxConfig;
  constructor(
    config: UpsSandboxConfig,
    private readonly transport: typeof fetch = fetch,
  ) {
    check(
      config &&
        validText(config.orgId, 128) &&
        validText(config.clientId, 512) &&
        !config.clientId.includes(":") &&
        validText(config.clientSecret, 1024) &&
        typeof config.shipperNumber === "string" &&
        /^[A-Z0-9]{6}$/.test(config.shipperNumber) &&
        Array.isArray(config.services) &&
        config.services.length > 0 &&
        config.services.length <= 20 &&
        config.services.every(
          (entry) =>
            entry !== null &&
            typeof entry === "object" &&
            validText(entry.service, 160) &&
            typeof entry.code === "string" &&
            /^(01|02|03|07|08|11|12|13|14|54|59|65)$/.test(entry.code),
        ) &&
        new Set(config.services.map((entry) => entry.service)).size ===
          config.services.length &&
        typeof transport === "function",
      "CARRIER_CONFIG",
      "Supply an organization, UPS sandbox credentials, shipper and exact reviewed service mappings.",
      500,
    );
    contact(config.shipper);
    this.config = {
      ...config,
      shipper: Object.freeze({ ...config.shipper }),
      services: config.services.map((entry) => Object.freeze({ ...entry })),
    };
    Object.freeze(this.config.services);
    Object.freeze(this.config);
    this.configuration = carrierConfiguration(
      this.provider,
      {
        orgId: this.config.orgId,
        endpoint: base,
        clientId: this.config.clientId,
        shipperNumber: this.config.shipperNumber,
        shipper: this.config.shipper,
        services: this.config.services,
      },
      `UPS account ending ${this.config.shipperNumber.slice(-4)}`,
      [
        "UPS sandbox",
        `Registered shipper: ${this.config.shipper.name}, ${this.config.shipper.line1}${this.config.shipper.line2 ? `, ${this.config.shipper.line2}` : ""}, ${this.config.shipper.city}, ${this.config.shipper.province} ${this.config.shipper.postalCode}, ${this.config.shipper.country}`,
        `Registered shipper phone: ${this.config.shipper.phone}`,
      ],
      this.config.services.map((entry) => ({
        service: entry.service,
        description: `UPS service ${entry.code}`,
      })),
    );
  }
  private review(intent: CarrierIntent) {
    check(
      intent.provider === this.provider &&
        intent.nativeSnapshot.org_id === this.config.orgId &&
        intent.shipmentId === intent.nativeSnapshot.id &&
        validText(intent.bookingId, 128) &&
        /^[a-f0-9]{64}$/.test(intent.reviewHash),
      "CARRIER_MISMATCH",
      "UPS sandbox intent must belong to the configured organization and reviewed shipment.",
    );
    const { bookingId, reviewHash, ...review } = intent;
    check(
      digest(canonical(review)) === reviewHash,
      "CARRIER_MISMATCH",
      "UPS sandbox intent does not match its review hash.",
    );
    assertCarrierConfiguration(intent, this.configuration);
    const service = this.config.services.find(
      (entry) => entry.service === intent.service,
    );
    check(
      service &&
        intent.origin.country === this.config.shipper.country &&
        intent.destination.country === intent.origin.country,
      "CARRIER_UNSUPPORTED",
      "UPS sandbox requires a mapped domestic service in the shipper's country. Customs and cross-border shipping need separate qualification.",
    );
    const origin = contact(intent.origin),
      destination = contact(intent.destination);
    const p = intent.parcel;
    check(
      p &&
        [p.weightGrams, p.lengthMm, p.widthMm, p.heightMm].every(
          (n) => Number.isSafeInteger(n) && n > 0,
        ) &&
        p.weightGrams <= 68_000 &&
        Math.max(p.lengthMm, p.widthMm, p.heightMm) <= 2_740 &&
        Math.max(p.lengthMm, p.widthMm, p.heightMm) +
          2 *
            (p.lengthMm +
              p.widthMm +
              p.heightMm -
              Math.max(p.lengthMm, p.widthMm, p.heightMm)) <=
          4_000,
      "CARRIER_UNSUPPORTED",
      "UPS sandbox supports one bounded ordinary parcel; review weight and dimensions.",
    );
    // UPS reference values are limited to 35 characters. Hash binds tenant,
    // selected account, booking and full immutable review, without native IDs/PII.
    const reference =
      "D" +
      digest(
        canonical({
          orgId: this.config.orgId,
          shipperNumber: this.config.shipperNumber,
          bookingId,
          reviewHash,
        }),
      )
        .slice(0, 34)
        .toUpperCase();
    const context = `Distributor:${reference}:${reviewHash}`;
    return { origin, destination, service, reference, context };
  }
  private async token() {
    const auth = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`,
      "utf8",
    ).toString("base64");
    const response = object(
      await this.request(
        "/security/v1/oauth/token",
        "grant_type=client_credentials",
        {
          authorization: `Basic ${auth}`,
          "content-type": "application/x-www-form-urlencoded",
          "x-merchant-id": this.config.shipperNumber,
        },
      ),
    );
    check(
      typeof response.token_type === "string" &&
        response.token_type.toLowerCase() === "bearer" &&
        typeof response.access_token === "string" &&
        /^[A-Za-z0-9._~+/-]+=*$/.test(response.access_token) &&
        response.access_token.length <= 16_384 &&
        typeof response.expires_in === "string" &&
        /^\d{1,8}$/.test(response.expires_in) &&
        Number(response.expires_in) > 30,
      "CARRIER_RESULT",
      "UPS sandbox returned an invalid authorization response.",
    );
    return response.access_token;
  }
  private async request(
    path: string,
    body: string | undefined,
    headers: Record<string, string>,
    beforeWrite?: () => void,
  ): Promise<unknown> {
    const url = base + path;
    const init: RequestInit = {
      method: body === undefined ? "GET" : "POST",
      headers: { accept: "application/json", ...headers },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    };
    // Everything, including token lookup and serialization, precedes this guard.
    // No await/retry/redirect may intervene between authorization and shipping.
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
        "UPS sandbox did not return a successful JSON response. Reconcile; do not resend.",
        502,
      );
      return await readJson(response);
    } catch {
      // Provider text, URLs, addresses, tokens and credentials never escape.
      check(
        false,
        "CARRIER_TRANSPORT",
        "UPS sandbox response is unavailable or invalid. Reconcile; do not resend.",
        502,
      );
    }
  }
  async book(
    intent: CarrierIntent,
    beforeWrite: () => void,
  ): Promise<CarrierResult> {
    const review = this.review(intent);
    const reference = { Value: review.reference };
    const body = JSON.stringify({
      ShipmentRequest: {
        Request: {
          RequestOption: "validate",
          SubVersion: "2205",
          TransactionReference: { CustomerContext: review.context },
        },
        Shipment: {
          Description: "Equipment",
          Shipper: {
            ...contact(this.config.shipper),
            ShipperNumber: this.config.shipperNumber,
          },
          ShipFrom: review.origin,
          ShipTo: review.destination,
          PaymentInformation: {
            ShipmentCharge: {
              Type: "01",
              BillShipper: { AccountNumber: this.config.shipperNumber },
            },
          },
          Service: { Code: review.service.code },
          ...(intent.origin.country === "CA"
            ? { ReferenceNumber: reference }
            : {}),
          Package: {
            Description: "Equipment",
            Packaging: { Code: "02" },
            ...(intent.origin.country === "US"
              ? { ReferenceNumber: reference }
              : {}),
            Dimensions: {
              UnitOfMeasurement: { Code: "CM" },
              Length: decimal(intent.parcel.lengthMm, 10),
              Width: decimal(intent.parcel.widthMm, 10),
              Height: decimal(intent.parcel.heightMm, 10),
            },
            PackageWeight: {
              UnitOfMeasurement: { Code: "KGS" },
              Weight: decimal(intent.parcel.weightGrams, 1000),
            },
          },
        },
        LabelSpecification: {
          LabelImageFormat: { Code: "GIF" },
          HTTPUserAgent: "Distributor",
          LabelStockSize: { Height: "6", Width: "4" },
        },
      },
    });
    const token = await this.token();
    const response = object(
      object(
        await this.request(
          "/api/shipments/v2409/ship",
          body,
          {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            transactionSrc: "Distributor",
            transId: digest(review.context).slice(0, 32),
          },
          beforeWrite,
        ),
      ).ShipmentResponse,
    );
    correlate(response, review.context);
    const results = object(response.ShipmentResults);
    const part = single(results.PackageResults);
    const tracking = trackingNumber(part.TrackingNumber);
    check(
      results.ShipmentIdentificationNumber === tracking,
      "CARRIER_RESULT",
      "UPS sandbox shipment and parcel identifiers disagree.",
    );
    return this.result(
      intent,
      review.reference,
      tracking,
      object(part.ShippingLabel),
      "ImageFormat",
    );
  }
  async lookup(intent: CarrierIntent): Promise<CarrierResult | null> {
    const review = this.review(intent);
    const token = await this.token();
    // A request's echoed CustomerContext is not proof that a recovered label
    // belongs to this booking. Independently find one package by our exact
    // reference and shipper account, then require the same returned reference.
    const query = new URLSearchParams({
      shipperNum: this.config.shipperNumber,
      destCountry: intent.destination.country,
      destZip: intent.destination.postalCode.replace(/ /g, ""),
      refNumType: "SmallPackage",
    });
    const tracked = object(
      object(
        await this.request(
          `/api/track/v1/reference/details/${review.reference}?${query}`,
          undefined,
          {
            authorization: `Bearer ${token}`,
            transactionSrc: "Distributor",
            transId: digest(review.context).slice(0, 32),
          },
        ),
      ).trackResponse,
    );
    check(
      Array.isArray(tracked.shipment) && tracked.shipment.length === 1,
      "CARRIER_RESULT",
      "UPS sandbox reference must identify exactly one shipment.",
    );
    const shipment = object(tracked.shipment[0]);
    check(
      Array.isArray(shipment.package) && shipment.package.length === 1,
      "CARRIER_RESULT",
      "UPS sandbox reference must identify exactly one parcel.",
    );
    const parcel = object(shipment.package[0]);
    check(
      (parcel.packageCount === undefined || parcel.packageCount === 1) &&
        Array.isArray(parcel.referenceNumber) &&
        parcel.referenceNumber.some(
          (entry) => object(entry).number === review.reference,
        ),
      "CARRIER_RESULT",
      "UPS sandbox parcel does not carry this booking's exact reference.",
    );
    const verifiedTracking = trackingNumber(parcel.trackingNumber);
    const body = JSON.stringify({
      LabelRecoveryRequest: {
        Request: {
          RequestOption: "Non_Validate",
          SubVersion: "1903",
          TransactionReference: { CustomerContext: review.context },
        },
        ReferenceValues: {
          ShipperNumber: this.config.shipperNumber,
          ReferenceNumber: { Value: review.reference },
        },
        LabelSpecification: {
          LabelImageFormat: { Code: "GIF" },
          HTTPUserAgent: "Distributor",
          LabelStockSize: { Height: "6", Width: "4" },
        },
        // No LabelDelivery, email, URL, purchase, void or tracking substitution.
      },
    });
    const response = object(
      object(
        await this.request("/api/labels/v1903/recovery", body, {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          transactionSrc: "Distributor",
          transId: digest(review.context).slice(0, 32),
        }),
      ).LabelRecoveryResponse,
    );
    correlate(response, review.context);
    check(
      !response.TrackingCandidate ||
        (Array.isArray(response.TrackingCandidate) &&
          response.TrackingCandidate.length === 0),
      "CARRIER_RESULT",
      "UPS sandbox returned ambiguous tracking candidates. Keep the booking uncertain.",
    );
    const part = single(response.LabelResults);
    const tracking = trackingNumber(part.TrackingNumber);
    check(
      tracking === verifiedTracking &&
        (response.ShipmentIdentificationNumber === undefined ||
          response.ShipmentIdentificationNumber === tracking),
      "CARRIER_RESULT",
      "UPS sandbox recovery identifiers disagree.",
    );
    return this.result(
      intent,
      review.reference,
      tracking,
      object(part.LabelImage),
      "LabelImageFormat",
    );
  }
  private result(
    intent: CarrierIntent,
    reference: string,
    tracking: string,
    image: Record<string, unknown>,
    formatField: string,
  ): CarrierResult {
    check(
      object(image[formatField]).Code === "GIF" &&
        typeof image.GraphicImage === "string" &&
        image.GraphicImage.length <= 4 * Math.ceil(maximumLabel / 3) &&
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          image.GraphicImage,
        ),
      "CARRIER_RESULT",
      "UPS sandbox must return one bounded base64 GIF label.",
    );
    const bytes = Buffer.from(image.GraphicImage, "base64");
    check(
      bytes.toString("base64") === image.GraphicImage,
      "CARRIER_RESULT",
      "UPS sandbox label encoding is invalid.",
    );
    const label = { mediaType: "image/gif" as const, bytes };
    validateCarrierLabel(label);
    return {
      bookingId: intent.bookingId,
      reviewHash: intent.reviewHash,
      reference,
      tracking,
      label,
    };
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
    "UPS sandbox returned an invalid response structure.",
  );
  return value as Record<string, unknown>;
}
function single(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value)) return object(value);
  check(
    value.length === 1,
    "CARRIER_RESULT",
    "UPS sandbox must identify exactly one parcel and label.",
  );
  return object(value[0]);
}
function correlate(response: Record<string, unknown>, context: string) {
  const meta = object(response.Response);
  check(
    object(meta.ResponseStatus).Code === "1" &&
      object(meta.TransactionReference).CustomerContext === context,
    "CARRIER_RESULT",
    "UPS sandbox response does not match this reviewed request.",
  );
}
function trackingNumber(value: unknown): string {
  check(
    typeof value === "string" && /^1Z[A-Z0-9]{16}$/.test(value),
    "CARRIER_RESULT",
    "UPS sandbox must return a canonical ordinary parcel tracking number.",
  );
  return value;
}
function decimal(n: number, divisor: 10 | 1000) {
  const remainder = n % divisor;
  return `${Math.floor(n / divisor)}${
    remainder
      ? "." +
        String(remainder)
          .padStart(divisor === 10 ? 1 : 3, "0")
          .replace(/0+$/, "")
      : ""
  }`;
}
function contact(address: CarrierAddress) {
  check(
    address &&
      (address.country === "US" || address.country === "CA") &&
      validText(address.name, 35) &&
      validText(address.line1, 35) &&
      typeof address.line2 === "string" &&
      (address.line2 === "" || validText(address.line2, 35)) &&
      validText(address.city, 30) &&
      /^[A-Z]{2}$/.test(address.province) &&
      (address.country === "CA"
        ? /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTVWXYZ] ?\d[ABCEGHJ-NPRSTVWXYZ]\d$/.test(
            address.postalCode,
          )
        : /^\d{5}(-\d{4})?$/.test(address.postalCode)) &&
      typeof address.phone === "string" &&
      /^\+?[0-9 () .-]+$/.test(address.phone) &&
      address.phone.replace(/\D/g, "").length >= 10 &&
      address.phone.replace(/\D/g, "").length <= 15,
    "CARRIER_UNSUPPORTED",
    "UPS sandbox requires bounded structured US/Canadian contact and address fields.",
  );
  return {
    Name: address.name,
    AttentionName: address.name,
    Phone: { Number: address.phone.replace(/\D/g, "") },
    Address: {
      AddressLine: [address.line1, ...(address.line2 ? [address.line2] : [])],
      City: address.city,
      StateProvinceCode: address.province,
      PostalCode: address.postalCode.replace(/ /g, ""),
      CountryCode: address.country,
    },
  };
}
async function readJson(response: Response): Promise<unknown> {
  const length = response.headers.get("content-length");
  check(
    length === null ||
      (/^\d+$/.test(length) && Number(length) <= maximumResponse),
    "CARRIER_RESULT",
    "UPS sandbox response exceeds the permitted size.",
  );
  check(response.body, "CARRIER_RESULT", "UPS sandbox response has no body.");
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let count = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      count += value.byteLength;
      check(
        count <= maximumResponse,
        "CARRIER_RESULT",
        "UPS sandbox response exceeds the permitted size.",
      );
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
