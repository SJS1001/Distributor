import { canonical, check, digest } from "./core.ts";
import {
  validateCarrierLabel,
  type CarrierAdapter,
  type CarrierIntent,
  type CarrierResult,
} from "./carrier-bookings.ts";
import type { CarrierAddress } from "../shared/carrier-booking.ts";

export type UspsSandboxConfig = {
  orgId: string;
  clientId: string;
  clientSecret: string;
  crid: string;
  mid: string;
  manifestMid: string;
  epsAccount: string;
  mailingDate: string;
  // Exact reviewed names, ordinary customer packaging, no extra services/customs.
  services: {
    service: string;
    code: "USPS_GROUND_ADVANTAGE" | "PRIORITY_MAIL";
    processingCategory: "MACHINABLE" | "NONSTANDARD";
  }[];
};
const base = "https://apis-tem.usps.com";
const maximumResponse = 2_097_152;
const maximumLabel = 1_048_576;
const states = new Set(
  "AL AZ AR CA CO CT DE DC FL GA ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(
    " ",
  ),
);

// TEM only. Construction has no I/O. X-Idempotency-Key does NOT deduplicate
// label purchases. Never retry writes or hide finite, stateful reprints as reads.
export class UspsSandbox implements CarrierAdapter {
  readonly provider = "usps" as const;
  readonly sandbox = true as const;
  private readonly config: Readonly<
    Omit<UspsSandboxConfig, "services"> & {
      services: readonly Readonly<UspsSandboxConfig["services"][number]>[];
    }
  >;
  constructor(
    config: UspsSandboxConfig,
    private readonly transport: typeof fetch = fetch,
  ) {
    check(
      config &&
        validText(config.orgId, 128) &&
        validText(config.clientId, 512) &&
        validText(config.clientSecret, 1024) &&
        typeof config.crid === "string" &&
        /^\d{2,18}$/.test(config.crid) &&
        typeof config.mid === "string" &&
        /^(?:\d{6}|\d{9})$/.test(config.mid) &&
        typeof config.manifestMid === "string" &&
        /^(?:\d{6}|\d{9})$/.test(config.manifestMid) &&
        typeof config.epsAccount === "string" &&
        /^\d{1,20}$/.test(config.epsAccount) &&
        typeof config.mailingDate === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(config.mailingDate) &&
        Number.isFinite(Date.parse(config.mailingDate)) &&
        new Date(config.mailingDate).toISOString().slice(0, 10) ===
          config.mailingDate &&
        Array.isArray(config.services) &&
        config.services.length > 0 &&
        config.services.length <= 20 &&
        Array.from(config.services).every(
          (entry) =>
            entry &&
            validText(entry.service, 100) &&
            ["USPS_GROUND_ADVANTAGE", "PRIORITY_MAIL"].includes(entry.code) &&
            ["MACHINABLE", "NONSTANDARD"].includes(entry.processingCategory),
        ) &&
        new Set(config.services.map((entry) => entry.service)).size ===
          config.services.length &&
        typeof transport === "function",
      "CARRIER_CONFIG",
      "Supply exact USPS TEM organization, credentials, EPS payer/label-owner identifiers, mailing date and domestic service mappings.",
      500,
    );
    this.config = Object.freeze({
      ...config,
      services: Object.freeze(
        config.services.map((entry) => Object.freeze({ ...entry })),
      ),
    });
  }
  private review(intent: CarrierIntent) {
    check(
      intent &&
        intent.provider === this.provider &&
        intent.nativeSnapshot?.org_id === this.config.orgId &&
        intent.shipmentId === intent.nativeSnapshot.id &&
        typeof intent.bookingId === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          intent.bookingId,
        ) &&
        /^[a-f0-9]{64}$/.test(intent.reviewHash),
      "CARRIER_MISMATCH",
      "USPS TEM intent must identify this organization's reviewed shipment and random booking UUID.",
    );
    const { bookingId, reviewHash, ...review } = intent;
    check(
      digest(canonical(review)) === reviewHash,
      "CARRIER_MISMATCH",
      "USPS TEM intent does not match its review hash.",
    );
    const service = this.config.services.find(
      (entry) => entry.service === intent.service,
    );
    check(
      service,
      "CARRIER_UNSUPPORTED",
      "USPS TEM requires an exactly mapped domestic service.",
    );
    const fromAddress = contact(intent.origin),
      toAddress = contact(intent.destination),
      p = intent.parcel;
    check(
      p &&
        [p.weightGrams, p.lengthMm, p.widthMm, p.heightMm].every(
          (n) => Number.isSafeInteger(n) && n > 0,
        ),
      "CARRIER_UNSUPPORTED",
      "USPS TEM requires positive whole grams and millimeters.",
    );
    // Round upwards to hundredths of provider units. Never understate dimensions.
    const weight = Math.ceil((p.weightGrams / 453.59237) * 100) / 100;
    const sides = [p.lengthMm, p.widthMm, p.heightMm]
      .map((n) => Math.ceil((n / 25.4) * 100) / 100)
      .sort((a, b) => b - a);
    const length = sides[0]!,
      width = sides[1]!,
      height = sides[2]!;
    check(
      weight <= 70 &&
        length + 2 * (width + height) <= 108 &&
        length >= 6 &&
        width >= 3 &&
        height >= 0.25,
      "CARRIER_UNSUPPORTED",
      "USPS TEM ordinary parcel must satisfy the local 70 lb, 108 inch length/girth and minimum size bounds after rounding.",
    );
    if (service.processingCategory === "MACHINABLE")
      check(
        weight <= 25 && length <= 22 && width <= 18 && height <= 15,
        "CARRIER_UNSUPPORTED",
        "USPS TEM selected machinable service exceeds the local parcel limits.",
      );
    return { fromAddress, toAddress, service, weight, length, width, height };
  }
  private async request(
    path: string,
    body: string,
    headers: Record<string, string>,
    beforeWrite?: () => void,
  ) {
    const init: RequestInit = {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...headers,
      },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    };
    beforeWrite?.();
    try {
      const response = await this.transport(base + path, init);
      check(
        response.status === 200 && !response.redirected,
        "CARRIER_TRANSPORT",
        "USPS TEM did not return a successful response.",
        502,
      );
      const bytes = await readBounded(response);
      return { headers: response.headers, bytes };
    } catch {
      check(
        false,
        "CARRIER_TRANSPORT",
        "USPS TEM response is unavailable or invalid. Keep the outcome uncertain; do not resend.",
        502,
      );
    }
  }
  private async json(
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) {
    const response = await this.request(path, JSON.stringify(body), headers);
    check(
      /^application\/json(?:\s*;|$)/i.test(
        response.headers.get("content-type") ?? "",
      ),
      "CARRIER_RESULT",
      "USPS TEM authorization must return JSON.",
    );
    try {
      return object(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(response.bytes),
        ),
      );
    } catch {
      check(
        false,
        "CARRIER_RESULT",
        "USPS TEM returned invalid authorization JSON.",
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
      "USPS TEM requires the synchronous native write guard.",
      500,
    );
    // Capture all request and result inputs before authentication yields.
    const captured = JSON.parse(canonical(intent)) as CarrierIntent,
      review = this.review(captured);
    const body = JSON.stringify({
      imageInfo: {
        imageType: "PDF",
        labelType: "4X6LABEL",
        receiptOption: "NONE",
        returnLabel: false,
      },
      fromAddress: review.fromAddress,
      toAddress: review.toAddress,
      packageDescription: {
        mailClass: review.service.code,
        processingCategory: review.service.processingCategory,
        rateIndicator: "SP",
        destinationEntryFacilityType: "NONE",
        mailingDate: this.config.mailingDate,
        weightUOM: "lb",
        weight: review.weight,
        dimensionsUOM: "in",
        length: review.length,
        width: review.width,
        height: review.height,
        extraServices: [],
        customerReference: [
          {
            referenceNumber: "D" + digest(captured.bookingId).slice(0, 29),
            printReferenceNumber: true,
          },
        ],
      },
    });
    const auth = await this.json("/oauth2/v3/token", {
      grant_type: "client_credentials",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });
    const expiry =
      typeof auth.expires_in === "string" && /^\d{1,5}$/.test(auth.expires_in)
        ? Number(auth.expires_in)
        : auth.expires_in;
    check(
      typeof auth.token_type === "string" &&
        auth.token_type.toLowerCase() === "bearer" &&
        token(auth.access_token) &&
        typeof expiry === "number" &&
        Number.isSafeInteger(expiry) &&
        expiry > 30 &&
        expiry <= 86400,
      "CARRIER_RESULT",
      "USPS TEM returned invalid OAuth authorization.",
    );
    const identity = {
      CRID: this.config.crid,
      MID: this.config.mid,
      manifestMID: this.config.manifestMid,
    };
    const payment = await this.json(
      "/payments/v3/payment-authorization",
      {
        roles: [
          {
            roleName: "PAYER",
            ...identity,
            accountType: "EPS",
            accountNumber: this.config.epsAccount,
          },
          { roleName: "LABEL_OWNER", ...identity },
        ],
      },
      { authorization: `Bearer ${auth.access_token}` },
    );
    check(
      token(payment.paymentAuthorizationToken),
      "CARRIER_RESULT",
      "USPS TEM returned invalid payment authorization.",
    );
    // A token alone cannot establish which postage account/label MID was authorized.
    checkPaymentRoles(payment.roles, identity, this.config.epsAccount);
    const response = await this.request(
      "/labels/v3/label",
      body,
      {
        accept: "multipart/form-data",
        authorization: `Bearer ${auth.access_token}`,
        "x-payment-authorization-token": payment.paymentAuthorizationToken,
        "x-idempotency-key": captured.bookingId,
      },
      beforeWrite,
    );
    const echoedKey = response.headers.get("x-idempotency-key");
    check(
      echoedKey === null || echoedKey === captured.bookingId,
      "CARRIER_RESULT",
      "USPS TEM returned a different booking correlation key.",
    );
    const parts = multipart(
      response.headers.get("content-type"),
      response.bytes,
    );
    const metadataPart = parts[0]!,
      imagePart = parts[1]!;
    check(
      metadataPart.headers["content-type"]?.toLowerCase().split(";")[0] ===
        "application/json" &&
        /(?:^|;)\s*name="labelMetadata"(?:;|$)/.test(
          metadataPart.headers["content-disposition"] ?? "",
        ),
      "CARRIER_RESULT",
      "USPS TEM must return label metadata followed by the inline PDF.",
    );
    let metadata: Record<string, unknown>;
    try {
      metadata = object(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(metadataPart.bytes),
        ),
      );
    } catch {
      check(
        false,
        "CARRIER_RESULT",
        "USPS TEM returned invalid label metadata.",
      );
    }
    const address = object(metadata.labelAddress);
    // USPS may change case; substantive standardization needs separate review.
    check(
      typeof metadata.trackingNumber === "string" &&
        /^\d{20,34}$/.test(metadata.trackingNumber) &&
        metadata.returnLabel === undefined &&
        metadata.errors === undefined &&
        address.ZIPCode === review.toAddress.ZIPCode &&
        address.state === review.toAddress.state &&
        (address.firm === undefined ||
          sameAddress(address.firm, review.toAddress.firm)) &&
        sameAddress(address.streetAddress, review.toAddress.streetAddress) &&
        sameAddress(address.city, review.toAddress.city) &&
        sameAddress(
          address.secondaryAddress ?? "",
          review.toAddress.secondaryAddress,
        ) &&
        (!review.toAddress.ZIPPlus4 ||
          address.ZIPPlus4 === review.toAddress.ZIPPlus4),
      "CARRIER_RESULT",
      "USPS TEM must identify one outbound tracking number and the reviewed destination.",
    );
    const disposition = imagePart.headers["content-disposition"] ?? "";
    check(
      ["application/pdf", "application/octet-stream"].includes(
        imagePart.headers["content-type"]?.toLowerCase() ?? "",
      ) &&
        /^(?:attachment;\s*filename="[^"\r\n]{1,100}"|form-data;\s*name="labelImage"(?:;\s*filename="[^"\r\n]{1,100}")?)$/.test(
          disposition,
        ) &&
        [undefined, "base64"].includes(
          imagePart.headers["content-transfer-encoding"]?.toLowerCase(),
        ),
      "CARRIER_RESULT",
      "USPS TEM must return a supported inline base64 PDF part.",
    );
    const encoded = imagePart.bytes.toString("ascii").replace(/\r\n/g, "");
    check(
      imagePart.bytes.every((byte) => byte < 128) &&
        encoded.length > 0 &&
        encoded.length <= 4 * Math.ceil(maximumLabel / 3) &&
        encoded.length % 4 === 0 &&
        /^[A-Za-z0-9+/]+={0,2}$/.test(encoded),
      "CARRIER_RESULT",
      "USPS TEM label encoding is invalid.",
    );
    const bytes = Buffer.from(encoded, "base64");
    check(
      bytes.toString("base64") === encoded,
      "CARRIER_RESULT",
      "USPS TEM label encoding is noncanonical.",
    );
    const label = { mediaType: "application/pdf" as const, bytes };
    validateCarrierLabel(label);
    return {
      bookingId: captured.bookingId,
      reviewHash: captured.reviewHash,
      reference: captured.bookingId,
      tracking: metadata.trackingNumber,
      label,
    };
  }
  async lookup(intent: CarrierIntent): Promise<CarrierResult | null> {
    this.review(intent);
    check(
      false,
      "CARRIER_RECOVERY_UNSUPPORTED",
      "USPS reprint consumes a finite allowance and is not a read-only lookup. Keep this booking uncertain; reconcile without another label purchase.",
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
function token(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 16384 &&
    /^[A-Za-z0-9._~+/-]+=*$/.test(value)
  );
}
function object(value: unknown): Record<string, unknown> {
  check(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "CARRIER_RESULT",
    "USPS TEM returned an invalid structure.",
  );
  return value as Record<string, unknown>;
}
function checkPaymentRoles(
  value: unknown,
  identity: { CRID: string; MID: string; manifestMID: string },
  epsAccount: string,
) {
  check(
    Array.isArray(value) && value.length >= 2 && value.length <= 10,
    "CARRIER_RESULT",
    "USPS TEM payment authorization must identify its parties.",
  );
  const roles = value.map(object),
    names = roles.map((role) => role.roleName);
  check(
    new Set(names).size === names.length &&
      names.every((name) =>
        [
          "PAYER",
          "RATE_HOLDER",
          "LABEL_OWNER",
          "SHIPPER",
          "MAIL_OWNER",
          "PLATFORM",
          "RETURN_LABEL_PAYER",
          "RETURN_LABEL_RATE_HOLDER",
          "RETURN_LABEL_OWNER",
          "LABEL_PROVIDER",
        ].includes(name as string),
      ),
    "CARRIER_RESULT",
    "USPS TEM payment authorization roles are invalid or duplicated.",
  );
  const payer = roles.find((role) => role.roleName === "PAYER"),
    owner = roles.find((role) => role.roleName === "LABEL_OWNER");
  check(
    payer &&
      owner &&
      [payer, owner].every(
        (role) =>
          role.CRID === identity.CRID &&
          role.MID === identity.MID &&
          role.manifestMID === identity.manifestMID,
      ) &&
      payer.accountType === "EPS" &&
      payer.accountNumber === epsAccount &&
      payer.sufficientFunds !== false,
    "CARRIER_RESULT",
    "USPS TEM payment authorization does not match the configured payer and label owner.",
  );
}
function sameAddress(a: unknown, b: string) {
  return typeof a === "string" && a.toUpperCase() === b.toUpperCase();
}
function contact(address: CarrierAddress) {
  check(
    address &&
      address.country === "US" &&
      states.has(address.province) &&
      [address.name, address.line1].every(
        (value) => validText(value, 50) && /^[\x20-\x7e]+$/.test(value),
      ) &&
      validText(address.city, 28) &&
      /^[\x20-\x7e]+$/.test(address.city) &&
      typeof address.line2 === "string" &&
      (address.line2 === "" ||
        (validText(address.line2, 50) &&
          /^[\x20-\x7e]+$/.test(address.line2))) &&
      /^\d{5}(?:-\d{4})?$/.test(address.postalCode),
    "CARRIER_UNSUPPORTED",
    "USPS TEM requires bounded ASCII contiguous-US addresses. Canadian, territorial, military and customs shipments need separate qualification.",
  );
  const [ZIPCode, ZIPPlus4] = address.postalCode.split("-");
  return {
    firm: address.name,
    streetAddress: address.line1,
    secondaryAddress: address.line2,
    city: address.city,
    state: address.province,
    ZIPCode,
    ...(ZIPPlus4 ? { ZIPPlus4 } : {}),
  };
}
async function readBounded(response: Response) {
  const length = response.headers.get("content-length");
  check(response.body, "CARRIER_RESULT", "USPS TEM response body is missing.");
  const reader = response.body.getReader();
  try {
    check(
      length === null ||
        (/^\d+$/.test(length) && Number(length) <= maximumResponse),
      "CARRIER_RESULT",
      "USPS TEM response exceeds its local bound.",
    );
    const chunks: Buffer[] = [];
    let size = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      check(
        size <= maximumResponse,
        "CARRIER_RESULT",
        "USPS TEM response exceeds its local bound.",
      );
      chunks.push(Buffer.from(part.value));
    }
    check(
      length === null || Number(length) === size,
      "CARRIER_RESULT",
      "USPS TEM response length is inconsistent.",
    );
    return Buffer.concat(chunks, size);
  } finally {
    try {
      await reader.cancel();
    } catch {}
    reader.releaseLock();
  }
}
// Narrow original MIME decoder: bounded response, exactly two CRLF-framed parts.
// Supports the spec's attachment without a form-data name; never follows URLs.
function multipart(type: string | null, bytes: Buffer) {
  const match =
    /^multipart\/form-data\s*;\s*boundary=(?:"([A-Za-z0-9'()+_,./:=?-]{1,70})"|([A-Za-z0-9'()+_,./:=?-]{1,70}))$/i.exec(
      type ?? "",
    );
  check(
    match,
    "CARRIER_RESULT",
    "USPS TEM must return a bounded multipart label.",
  );
  const boundary = (match[1] ?? match[2])!,
    separator = Buffer.from(`\r\n--${boundary}`);
  check(
    bytes
      .subarray(0, boundary.length + 4)
      .equals(Buffer.from(`--${boundary}\r\n`)),
    "CARRIER_RESULT",
    "USPS TEM multipart opening is invalid.",
  );
  let position = boundary.length + 4;
  const parts: { headers: Record<string, string>; bytes: Buffer }[] = [];
  for (;;) {
    const endHeaders = bytes.indexOf("\r\n\r\n", position);
    check(
      endHeaders >= position && endHeaders - position <= 4096,
      "CARRIER_RESULT",
      "USPS TEM part headers are invalid.",
    );
    const headers: Record<string, string> = Object.create(null);
    const raw = bytes.subarray(position, endHeaders);
    check(
      raw.every((byte) => byte < 128),
      "CARRIER_RESULT",
      "USPS TEM part headers are invalid.",
    );
    for (const line of raw.toString("ascii").split("\r\n")) {
      const entry = /^([A-Za-z-]+):[ \t]*([^\r\n]*)$/.exec(line);
      check(
        entry && !Object.hasOwn(headers, entry[1]!.toLowerCase()),
        "CARRIER_RESULT",
        "USPS TEM part headers are invalid or duplicated.",
      );
      headers[entry[1]!.toLowerCase()] = entry[2]!;
    }
    const end = bytes.indexOf(separator, endHeaders + 4);
    check(
      end >= endHeaders + 4,
      "CARRIER_RESULT",
      "USPS TEM multipart closing is missing.",
    );
    parts.push({ headers, bytes: bytes.subarray(endHeaders + 4, end) });
    check(
      parts.length <= 2,
      "CARRIER_RESULT",
      "USPS TEM must return exactly one metadata and label part.",
    );
    position = end + separator.length;
    if (
      bytes.subarray(position).equals(Buffer.from("--\r\n")) ||
      bytes.subarray(position).equals(Buffer.from("--"))
    )
      break;
    check(
      bytes.subarray(position, position + 2).equals(Buffer.from("\r\n")),
      "CARRIER_RESULT",
      "USPS TEM multipart delimiter is invalid.",
    );
    position += 2;
  }
  check(
    parts.length === 2,
    "CARRIER_RESULT",
    "USPS TEM must return exactly one metadata and label part.",
  );
  return parts;
}
