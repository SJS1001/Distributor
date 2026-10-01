import { canonical, check, digest } from "./core.ts";
import {
  validateCarrierLabel,
  type CarrierIntent,
} from "./carrier-bookings.ts";
import type { CarrierAddress } from "../shared/carrier-booking.ts";

export type CanadaPostTestConfig = {
  orgId: string;
  warehouseId: string;
  // Test and production applications use the same gateway. This declaration
  // cannot prove the credential class; actual vendor qualification is required.
  testApplication: true;
  clientId: string;
  clientSecret: string;
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
export type CanadaPostShipmentObservation = {
  bookingId: string;
  reviewHash: string;
  configurationHash: string;
  groupId: string;
  customerRequestId: string;
  shipmentId: string;
  tracking: string;
  status: "created" | "transmitted";
  label: { mediaType: "application/pdf"; bytes: Buffer };
};
// The caller must persist this complete review, close the group to new creates
// and own a durable exclusive claim. These protocol methods do not do that.
export type CanadaPostManifestReview = {
  manifestId: string;
  groupId: string;
  entries: readonly {
    intent: CarrierIntent;
    shipmentId: string;
    tracking: string;
  }[];
};
export type CanadaPostManifestObservation = {
  manifestId: string;
  reviewHash: string;
  configurationHash: string;
  groupId: string;
  customerReference: string;
  poNumber: string;
  shipmentIds: string[];
  manifestDate: string;
  totalCents: number;
  document: { mediaType: "application/pdf"; bytes: Buffer };
};
const gateway =
  "https://api.canadapost-postescanada.ca/prod/devportal-portaildesdeveloppeurs";
const shipping = gateway + "/shipping/v1";
const tokenUrl = gateway + "/cpc-api-native-oauth-provider/oauth2/token";
const maximumJson = 2_097_152;
const maximumLabel = 1_048_576;

// Original JSON/OAuth contract-shipping protocol foundation. Intentionally NOT
// a CarrierAdapter: grouped labels still require a separately claimed manifest
// transmission and qualified recovery before native handover can be enabled.
// There is no default transport, startup registration or production switch.
export class CanadaPostTestClient {
  private readonly config: CanadaPostTestConfig;
  readonly configurationHash: string;
  constructor(
    config: CanadaPostTestConfig,
    private readonly transport: typeof fetch,
  ) {
    check(
      config &&
        config.testApplication === true &&
        valid(config.orgId, 128) &&
        valid(config.warehouseId, 128) &&
        valid(config.clientId, 512) &&
        valid(config.clientSecret, 1024) &&
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
          config.services.length &&
        typeof transport === "function",
      "CARRIER_CONFIG",
      "Supply an explicit test-application transport, organization/warehouse, Canada Post account/contract/company, shipping point and exact domestic service mappings.",
      500,
    );
    this.config = Object.freeze({
      ...config,
      shippingPoint: Object.freeze({ ...config.shippingPoint }),
      services: Object.freeze(
        config.services.map((entry) => Object.freeze({ ...entry })),
      ),
    });
    const { clientId: _id, clientSecret: _secret, ...binding } = this.config;
    this.configurationHash = digest(canonical(binding));
  }
  private review(intent: CarrierIntent, groupId: string) {
    check(
      intent &&
        intent.provider === "canada-post" &&
        intent.nativeSnapshot?.org_id === this.config.orgId &&
        intent.nativeSnapshot.warehouse_id === this.config.warehouseId &&
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
    const service = this.config.services.find(
      (entry) => entry.service === intent.service,
    );
    check(
      service,
      "CARRIER_UNSUPPORTED",
      "Canada Post requires an exactly mapped domestic service; customs and cross-border shipping remain unqualified.",
    );
    const sender = contact(intent.origin),
      destination = contact(intent.destination);
    if (this.config.shippingPoint.kind === "pickup")
      check(
        sender.addressDetails.postalZipCode ===
          this.config.shippingPoint.postalCode,
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
          configurationHash: this.configurationHash,
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
      ...(this.config.shippingPoint.kind === "pickup"
        ? {
            cpcPickupIndicator: true,
            requestedShippingPoint: this.config.shippingPoint.postalCode,
          }
        : { shippingPointId: this.config.shippingPoint.siteId }),
      deliverySpec: {
        serviceCode: service.code,
        sender: {
          name: sender.name,
          company: this.config.company,
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
          paidByCustomer: this.config.customerNumber,
          contractId: this.config.contractId,
          intendedMethodOfPayment: "Account",
        },
      },
    };
    // Capture primitive identity and complete wire data before the first await.
    return { bookingId, reviewHash, groupId, customerRequestId, body };
  }
  private accountPath() {
    return `/${this.config.customerNumber}/${this.config.customerNumber}/shipments`;
  }
  private async token() {
    const response = object(
      await this.json(tokenUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "X-IBM-Client-Id": this.config.clientId,
          "X-IBM-Client-Secret": this.config.clientSecret,
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          scope: "merchant",
        }).toString(),
      }),
    );
    check(
      typeof response.token_type === "string" &&
        response.token_type.toLowerCase() === "bearer" &&
        typeof response.access_token === "string" &&
        /^[A-Za-z0-9._~+/-]+=*$/.test(response.access_token) &&
        response.access_token.length <= 16_384 &&
        Number.isSafeInteger(response.expires_in) &&
        (response.expires_in as number) > 30 &&
        (response.expires_in as number) <= 86_400 &&
        response.scope === "merchant",
      "CARRIER_RESULT",
      "Canada Post returned an invalid authorization response.",
    );
    return response.access_token;
  }
  private headers(token: string) {
    return { authorization: `Bearer ${token}`, "Accept-Language": "en-CA" };
  }
  private async json(
    url: string,
    init: RequestInit,
    beforeWrite?: () => void,
  ): Promise<unknown> {
    const request = {
      ...init,
      headers: { accept: "application/json", ...init.headers },
      redirect: "error" as const,
      signal: AbortSignal.timeout(20_000),
    };
    // No serialization, await, retry or catch between the guard and transport.
    beforeWrite?.();
    try {
      const response = await this.transport(url, request);
      check(
        response.status === 200 &&
          !response.redirected &&
          /^application\/json(?:\s*;|$)/i.test(
            response.headers.get("content-type") ?? "",
          ),
        "CARRIER_TRANSPORT",
        "Canada Post did not return a successful JSON response.",
        502,
      );
      return JSON.parse(
        (await bounded(response, maximumJson)).toString("utf8"),
      ) as unknown;
    } catch {
      check(
        false,
        "CARRIER_TRANSPORT",
        "Canada Post response is unavailable or invalid. Retain uncertainty; do not resend.",
        502,
      );
    }
  }
  async create(
    intent: CarrierIntent,
    groupId: string,
    beforeWrite: () => void,
  ): Promise<CanadaPostShipmentObservation> {
    check(
      typeof beforeWrite === "function",
      "CARRIER_CONFIG",
      "Canada Post creation requires a synchronous durable write guard.",
      500,
    );
    const review = this.review(intent, groupId),
      body = JSON.stringify(review.body);
    const token = await this.token();
    const response = await this.json(
      shipping + this.accountPath(),
      {
        method: "POST",
        headers: { ...this.headers(token), "content-type": "application/json" },
        body,
      },
      beforeWrite,
    );
    // Creation is not manifest transmission, billing completion or handover.
    return this.observe(review, object(response), token, true);
  }
  async lookup(
    intent: CarrierIntent,
    groupId: string,
  ): Promise<CanadaPostShipmentObservation | null> {
    const review = this.review(intent, groupId),
      token = await this.token();
    const links = await this.json(
      shipping +
        this.accountPath() +
        "?" +
        new URLSearchParams({
          "request-id": review.customerRequestId,
          limit: "2",
        }),
      { method: "GET", headers: this.headers(token) },
    );
    check(
      Array.isArray(links) && links.length <= 1,
      "CARRIER_RESULT",
      "Canada Post recovery must identify at most one exact shipment; ambiguous results remain uncertain.",
    );
    if (links.length === 0) return null;
    const link = object(links[0]);
    check(
      link.rel === "shipment" && link.mediaType === "application/json",
      "CARRIER_RESULT",
      "Canada Post recovery returned an invalid shipment link.",
    );
    const path = this.shipmentLink(link.href);
    const response = object(
      await this.json(shipping + path, {
        method: "GET",
        headers: this.headers(token),
      }),
    );
    check(
      path === this.accountPath() + "/" + identifier(response.shipmentId),
      "CARRIER_RESULT",
      "Canada Post recovery changed shipment identity.",
    );
    return this.observe(review, response, token, false);
  }
  private shipmentLink(href: unknown): string {
    check(
      typeof href === "string" &&
        href.startsWith(shipping + this.accountPath() + "/"),
      "CARRIER_RESULT",
      "Canada Post shipment link must use the exact configured account and gateway.",
    );
    const id = identifier(
      href.slice((shipping + this.accountPath() + "/").length),
    );
    return this.accountPath() + "/" + id;
  }
  private async observe(
    review: ReturnType<CanadaPostTestClient["review"]>,
    response: Record<string, unknown>,
    token: string,
    creation: boolean,
  ): Promise<CanadaPostShipmentObservation> {
    const observed = await this.shipmentDetails(
      review,
      response,
      token,
      creation,
    );
    const label = await this.pdf(observed.labelUrl, token);
    return {
      bookingId: review.bookingId,
      reviewHash: review.reviewHash,
      configurationHash: this.configurationHash,
      groupId: review.groupId,
      customerRequestId: review.customerRequestId,
      shipmentId: observed.shipmentId,
      tracking: observed.tracking,
      status: observed.status,
      label,
    };
  }
  private async shipmentDetails(
    review: ReturnType<CanadaPostTestClient["review"]>,
    response: Record<string, unknown>,
    token: string,
    creation: boolean,
  ) {
    const shipmentId = identifier(response.shipmentId),
      tracking = pin(response.trackingPin);
    check(
      response.customerRequestId === review.customerRequestId &&
        (response.shipmentStatus === "created" ||
          (!creation && response.shipmentStatus === "transmitted")),
      "CARRIER_RESULT",
      "Canada Post shipment must match the exact customer request and supported lifecycle state.",
    );
    const status = response.shipmentStatus as "created" | "transmitted";
    check(
      Array.isArray(response.links) && response.links.length <= 20,
      "CARRIER_RESULT",
      "Canada Post shipment links are invalid.",
    );
    const one = (rel: string) => {
      const found = (response.links as unknown[])
        .map(object)
        .filter((link) => link.rel === rel);
      check(
        found.length === 1,
        "CARRIER_RESULT",
        "Canada Post must return one exact shipment, details and label link.",
      );
      return found[0]!;
    };
    const self = one("self"),
      details = one("details"),
      label = one("label"),
      path = this.accountPath() + "/" + shipmentId;
    check(
      self.mediaType === "application/json" &&
        self.href === shipping + path &&
        details.mediaType === "application/json" &&
        details.href === shipping + path + "/details" &&
        label.mediaType === "application/pdf" &&
        label.index === 0 &&
        typeof label.href === "string" &&
        new RegExp(
          "^" +
            escape(shipping) +
            "/artifacts/[A-Za-z0-9_-]{1,32}/shipping/[A-Za-z0-9_-]{1,18}/0$",
        ).test(label.href),
      "CARRIER_RESULT",
      "Canada Post links must identify the exact shipment and one private PDF artifact on the fixed gateway.",
    );
    const detail = object(
      await this.json(shipping + path + "/details", {
        method: "GET",
        headers: this.headers(token),
      }),
    );
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
        (this.config.shippingPoint.kind === "pickup"
          ? detail.cpcPickupIndicator === true &&
            detail.finalShippingPoint ===
              this.config.shippingPoint.postalCode &&
            detail.shippingPointId === undefined
          : detail.shippingPointId === this.config.shippingPoint.siteId &&
            detail.cpcPickupIndicator === undefined),
      "CARRIER_RESULT",
      "Canada Post details must match the reviewed group, contacts, parcel, service, shipping point and settlement account.",
    );
    return { shipmentId, tracking, status, labelUrl: label.href as string };
  }
  private async pdf(url: string, token: string) {
    let bytes: Buffer;
    try {
      const pdf = await this.transport(url, {
        method: "GET",
        headers: { ...this.headers(token), accept: "application/pdf" },
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      });
      check(
        pdf.status === 200 &&
          !pdf.redirected &&
          /^application\/pdf(?:\s*;|$)/i.test(
            pdf.headers.get("content-type") ?? "",
          ),
        "CARRIER_TRANSPORT",
        "Canada Post did not return a private PDF document.",
        502,
      );
      bytes = await bounded(pdf, maximumLabel);
    } catch {
      check(
        false,
        "CARRIER_TRANSPORT",
        "Canada Post document is unavailable or invalid. Retain uncertainty; do not resend.",
        502,
      );
    }
    const qualifiedLabel = { mediaType: "application/pdf" as const, bytes };
    validateCarrierLabel(qualifiedLabel);
    return qualifiedLabel;
  }
  private manifestReview(input: CanadaPostManifestReview) {
    check(
      input &&
        valid(input.manifestId, 128) &&
        Array.isArray(input.entries) &&
        input.entries.length > 0 &&
        input.entries.length <= 100,
      "CARRIER_UNSUPPORTED",
      "Review one closed Canada Post group containing between one and 100 ordinary shipments.",
    );
    const entries = input.entries
      .map((entry) => {
        check(entry, "CARRIER_MISMATCH", "Manifest entry is missing.");
        return {
          review: this.review(entry.intent, input.groupId),
          shipmentId: identifier(entry.shipmentId),
          tracking: pin(entry.tracking),
        };
      })
      .sort((a, b) =>
        a.shipmentId < b.shipmentId ? -1 : a.shipmentId > b.shipmentId ? 1 : 0,
      );
    for (const values of [
      entries.map((entry) => entry.shipmentId),
      entries.map((entry) => entry.tracking),
      entries.map((entry) => entry.review.bookingId),
      input.entries.map((entry) => entry.intent.shipmentId),
    ])
      check(
        new Set(values).size === entries.length,
        "CARRIER_MISMATCH",
        "Manifest entries must have distinct provider shipments, tracking and native booking identities.",
      );
    const sender = entries[0]!.review.body.deliverySpec.sender;
    check(
      entries.every(
        (entry) =>
          canonical(entry.review.body.deliverySpec.sender) ===
          canonical(sender),
      ),
      "CARRIER_MISMATCH",
      "All manifest shipments must have the same reviewed warehouse sender.",
    );
    const manifestId = input.manifestId,
      groupId = input.groupId;
    const reviewHash = digest(
      canonical({
        manifestId,
        groupId,
        configurationHash: this.configurationHash,
        entries,
      }),
    );
    // Published customerRequestId is future use. This reference is correlation,
    // never an idempotency promise; exact membership is additionally required.
    const customerReference = "D" + reviewHash.slice(0, 11).toUpperCase();
    const body = {
      groupIds: [groupId],
      ...(this.config.shippingPoint.kind === "pickup"
        ? {
            cpcPickupIndicator: true,
            requestedShippingPoint: this.config.shippingPoint.postalCode,
          }
        : { shippingPointId: this.config.shippingPoint.siteId }),
      detailedManifests: true,
      methodOfPayment: "Account",
      manifestAddress: {
        manifestCompany: sender.company,
        manifestName: sender.name,
        phoneNumber: sender.contactPhone,
        addressDetails: { ...sender.addressDetails },
      },
      customerReference,
    };
    return {
      manifestId,
      groupId,
      reviewHash,
      customerReference,
      entries,
      body,
    };
  }
  private manifestPath() {
    return `/${this.config.customerNumber}/${this.config.customerNumber}/manifests`;
  }
  manifestIdentity(input: CanadaPostManifestReview) {
    const review = this.manifestReview(input);
    return {
      manifestId: review.manifestId,
      groupId: review.groupId,
      reviewHash: review.reviewHash,
      configurationHash: this.configurationHash,
      customerReference: review.customerReference,
      shipmentIds: review.entries.map((entry) => entry.shipmentId),
    };
  }
  private manifestLink(link: unknown) {
    const value = object(link),
      prefix = shipping + this.manifestPath() + "/";
    check(
      value.rel === "manifest" &&
        value.mediaType === "application/json" &&
        typeof value.href === "string" &&
        value.href.startsWith(prefix),
      "CARRIER_RESULT",
      "Manifest link must use the exact configured account and fixed gateway.",
    );
    return purchaseOrder((value.href as string).slice(prefix.length));
  }
  private async membership(
    review: ReturnType<CanadaPostTestClient["manifestReview"]>,
    token: string,
    filter: { "group-id": string } | { "manifest-id": string },
  ) {
    const result = await this.json(
      shipping +
        this.accountPath() +
        "?" +
        new URLSearchParams({
          ...filter,
          limit: String(review.entries.length + 1),
        }),
      { method: "GET", headers: this.headers(token) },
    );
    check(
      Array.isArray(result) && result.length === review.entries.length,
      "CARRIER_RESULT",
      "Canada Post membership must contain exactly the reviewed shipments; missing, extra or truncated results remain uncertain.",
    );
    const actual = result
      .map((link) => {
        const value = object(link);
        check(
          value.rel === "shipment" && value.mediaType === "application/json",
          "CARRIER_RESULT",
          "Membership must contain exact shipment links.",
        );
        return this.shipmentLink(value.href).slice(
          this.accountPath().length + 1,
        );
      })
      .sort();
    check(
      canonical(actual) ===
        canonical(review.entries.map((entry) => entry.shipmentId).sort()),
      "CARRIER_RESULT",
      "Canada Post membership differs from the frozen reviewed group.",
    );
  }
  private async manifestShipments(
    review: ReturnType<CanadaPostTestClient["manifestReview"]>,
    token: string,
  ) {
    const states: {
      status: "created" | "transmitted";
      poNumber: string | null;
    }[] = [];
    for (const entry of review.entries) {
      const response = object(
        await this.json(
          shipping + this.accountPath() + "/" + entry.shipmentId,
          { method: "GET", headers: this.headers(token) },
        ),
      );
      const detail = await this.shipmentDetails(
        entry.review,
        response,
        token,
        false,
      );
      check(
        detail.shipmentId === entry.shipmentId &&
          detail.tracking === entry.tracking,
        "CARRIER_RESULT",
        "Manifest shipment identity or tracking differs from its retained creation.",
      );
      const poNumber =
        detail.status === "transmitted"
          ? purchaseOrder(response.poNumber)
          : null;
      check(
        detail.status !== "created" || response.poNumber === undefined,
        "CARRIER_RESULT",
        "An untransmitted shipment cannot identify a purchase order.",
      );
      states.push({ status: detail.status, poNumber });
    }
    return states;
  }
  async transmitManifest(
    input: CanadaPostManifestReview,
    beforeWrite: () => void,
  ): Promise<CanadaPostManifestObservation> {
    check(
      typeof beforeWrite === "function",
      "CARRIER_CONFIG",
      "Manifest transmission requires a synchronous durable claim and closed-group write guard.",
      500,
    );
    const review = this.manifestReview(input),
      body = JSON.stringify(review.body),
      token = await this.token();
    await this.membership(review, token, { "group-id": review.groupId });
    const before = await this.manifestShipments(review, token);
    check(
      before.every((state) => state.status === "created"),
      "CARRIER_RESULT",
      "Transmit only the exact untransmitted reviewed group; use read-only recovery for uncertainty.",
    );
    // The API transmits by group, with no atomic shipment allowlist. External
    // group writers remain a qualification risk despite these two fences.
    const links = await this.json(
      shipping + this.manifestPath(),
      {
        method: "POST",
        headers: { ...this.headers(token), "content-type": "application/json" },
        body,
      },
      beforeWrite,
    );
    check(
      Array.isArray(links) && links.length === 1,
      "CARRIER_RESULT",
      "This reviewed ordinary domestic account group must identify exactly one manifest.",
    );
    const poNumber = this.manifestLink(links[0]);
    const after = await this.manifestShipments(review, token);
    check(
      after.every(
        (state) =>
          state.status === "transmitted" && state.poNumber === poNumber,
      ),
      "CARRIER_RESULT",
      "Every reviewed shipment must identify the same transmitted manifest.",
    );
    return this.manifestObservation(review, poNumber, token);
  }
  async recoverManifest(
    input: CanadaPostManifestReview,
  ): Promise<CanadaPostManifestObservation | null> {
    const review = this.manifestReview(input),
      token = await this.token();
    const states = await this.manifestShipments(review, token);
    if (states.every((state) => state.status === "created")) return null;
    const poNumber = states[0]!.poNumber;
    check(
      poNumber !== null &&
        states.every(
          (state) =>
            state.status === "transmitted" && state.poNumber === poNumber,
        ),
      "CARRIER_RESULT",
      "Mixed or different manifest outcomes remain uncertain; never retransmit.",
    );
    return this.manifestObservation(review, poNumber, token);
  }
  private async manifestObservation(
    review: ReturnType<CanadaPostTestClient["manifestReview"]>,
    poNumber: string,
    token: string,
  ): Promise<CanadaPostManifestObservation> {
    const path = this.manifestPath() + "/" + poNumber;
    const response = object(
      await this.json(shipping + path, {
        method: "GET",
        headers: this.headers(token),
      }),
    );
    check(
      response.poNumber === poNumber &&
        Array.isArray(response.links) &&
        response.links.length <= 20,
      "CARRIER_RESULT",
      "Manifest must retain its exact purchase order and bounded private links.",
    );
    const one = (rel: string) => {
      const links = (response.links as unknown[])
        .map(object)
        .filter((link) => link.rel === rel);
      check(
        links.length === 1,
        "CARRIER_RESULT",
        "Manifest must identify one exact details and PDF artifact link.",
      );
      return links[0]!;
    };
    const details = one("details"),
      artifact = one("artifact");
    check(
      details.mediaType === "application/json" &&
        details.href === shipping + path + "/details" &&
        artifact.mediaType === "application/pdf" &&
        typeof artifact.href === "string" &&
        new RegExp(
          "^" +
            escape(shipping + "/artifacts/" + poNumber + "/shipping/") +
            "[A-Za-z0-9_-]{1,18}/0$",
        ).test(artifact.href),
      "CARRIER_RESULT",
      "Manifest links must use the exact account, purchase order and fixed private PDF gateway.",
    );
    const detail = object(
      await this.json(shipping + path + "/details", {
        method: "GET",
        headers: this.headers(token),
      }),
    );
    const address = object(detail.manifestAddress),
      expected = review.body.manifestAddress;
    check(
      detail.poNumber === poNumber &&
        detail.customerRef === review.customerReference &&
        detail.mailedByCustomer === this.config.customerNumber &&
        detail["mailed-on-behalf-of"] === this.config.customerNumber &&
        detail.paidByCustomer === this.config.customerNumber &&
        detail.contractId === this.config.contractId &&
        detail.methodOfPayment === "Account" &&
        detail.ccReceiptDetails === undefined &&
        detail.supplierAccountReceiptDetails === undefined &&
        matches(address, expected) &&
        (expected.addressDetails.addressLine2 !== undefined ||
          object(address.addressDetails).addressLine2 === undefined ||
          object(address.addressDetails).addressLine2 === "") &&
        postal(detail.finalShippingPoint) &&
        valid(detail.shippingPointName, 35) &&
        typeof detail.shippingPointId === "string" &&
        /^[A-Z0-9]{4}$/.test(detail.shippingPointId) &&
        (this.config.shippingPoint.kind === "pickup"
          ? detail.cpcPickupIndicator === true &&
            detail.finalShippingPoint === this.config.shippingPoint.postalCode
          : detail.cpcPickupIndicator === undefined &&
            detail.shippingPointId === this.config.shippingPoint.siteId) &&
        date(detail.manifestDate) &&
        typeof detail.manifestTime === "string" &&
        /^(?:[01]\d|2[0-3]):[0-5]\d [A-Za-z ]{1,20}$/.test(detail.manifestTime),
      "CARRIER_RESULT",
      "Manifest details must match the reviewed reference, Canadian sender, shipping point, contract, payer and account payment.",
    );
    const pricing = object(detail.manifestPricingInfo);
    const totalCents = cents(pricing.totalDueCpc);
    for (const key of ["baseCost", "gst", "pst", "hst"]) cents(pricing[key]);
    for (const key of ["automationDiscount", "optionsAndSurcharges"])
      cents(pricing[key], true);
    // Keep provider pricing as an observation, never native invoice or cash.
    await this.membership(review, token, { "manifest-id": poNumber });
    const document = await this.pdf(artifact.href as string, token);
    return {
      manifestId: review.manifestId,
      reviewHash: review.reviewHash,
      configurationHash: this.configurationHash,
      groupId: review.groupId,
      customerReference: review.customerReference,
      poNumber,
      shipmentIds: review.entries.map((entry) => entry.shipmentId),
      manifestDate: detail.manifestDate as string,
      totalCents,
      document,
    };
  }
}
function purchaseOrder(value: unknown): string {
  check(
    typeof value === "string" && /^[A-Za-z0-9]{1,10}$/.test(value),
    "CARRIER_RESULT",
    "Canada Post manifest purchase order is invalid.",
  );
  return value;
}
function date(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
function cents(value: unknown, signed = false): number {
  check(
    typeof value === "number" &&
      Number.isFinite(value) &&
      Math.abs(value) <= 1_000_000 &&
      (signed || value >= 0) &&
      Math.abs(value * 100 - Math.round(value * 100)) < 0.0000001,
    "CARRIER_RESULT",
    "Manifest pricing must contain bounded exact cent amounts.",
  );
  return Math.round(value * 100);
}
function escape(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
function identifier(value: unknown): string {
  check(
    typeof value === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(value),
    "CARRIER_RESULT",
    "Canada Post shipment identifier is invalid.",
  );
  return value;
}
function pin(value: unknown): string {
  check(
    typeof value === "string" && /^\d{11,16}$/.test(value),
    "CARRIER_RESULT",
    "Canada Post tracking identifier is invalid.",
  );
  return value;
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
async function bounded(response: Response, maximum: number): Promise<Buffer> {
  check(
    response.body,
    "CARRIER_RESULT",
    "Canada Post response body is missing.",
  );
  const reader = response.body.getReader(),
    chunks: Buffer[] = [];
  let size = 0;
  try {
    const length = response.headers.get("content-length");
    check(
      length === null || (/^\d+$/.test(length) && Number(length) <= maximum),
      "CARRIER_RESULT",
      "Canada Post response exceeds the size bound.",
    );
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      check(
        size <= maximum,
        "CARRIER_RESULT",
        "Canada Post response exceeds the size bound.",
      );
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
