import Fastify from "fastify";
import { providerNames } from "../shared/provider-choices.ts";
import { type FastifyError } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import staticFiles from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { check, DomainError, type Actor } from "./core.ts";
import { Application } from "./application.ts";
import {
  evidenceMaxBytes,
  evidenceMediaTypes,
  type EvidenceUpload,
} from "../shared/warranty-evidence.ts";
import { type ProviderRuntime } from "./provider-runtime.ts";
import { type CarrierRuntime } from "./carrier-runtime.ts";
import { carrierNames } from "../shared/carrier-booking.ts";

type Schema = Record<string, unknown>;
const str: Schema = { type: "string", minLength: 1, maxLength: 2000 },
  num: Schema = { type: "integer", minimum: 0, maximum: 1e12 },
  bool: Schema = { type: "boolean" };
const arr = (items: Schema): Schema => ({
  type: "array",
  items,
  maxItems: 100000,
});
const obj = (
  properties: Record<string, Schema>,
  optional: string[] = [],
): Schema => ({
  type: "object",
  properties,
  required: Object.keys(properties).filter((k) => !optional.includes(k)),
  additionalProperties: false,
});
const choice = (...values: string[]): Schema => ({
  type: "string",
  enum: values,
});
const line = obj({ productId: str, quantity: num });
type Spec = {
  schema: Schema;
  run: (actor: Actor, key: string, payload: any) => unknown;
}; // Schemas validate this boundary before domain dispatch.
export function commands(app: Application): Record<string, Spec> {
  const costNumber: Schema = {
    type: "integer",
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
  };
  const carrierAddress = obj({
    name: str,
    line1: str,
    line2: { type: "string", maxLength: 160 },
    city: str,
    province: str,
    postalCode: str,
    country: choice("US", "CA"),
    phone: str,
  });
  return {
    "carrier.prepare": {
      schema: obj({
        shipmentId: str,
        previousId: { anyOf: [str, { type: "null" }] },
        provider: choice(...carrierNames),
        service: str,
        origin: carrierAddress,
        destination: carrierAddress,
        parcel: obj({
          weightGrams: { type: "integer", minimum: 1, maximum: 2000000 },
          lengthMm: { type: "integer", minimum: 1, maximum: 10000 },
          widthMm: { type: "integer", minimum: 1, maximum: 10000 },
          heightMm: { type: "integer", minimum: 1, maximum: 10000 },
        }),
        reviewedDestination: str,
        acknowledgment: str,
      }),
      run: (a, k, p) => app.carriers.prepare(a, k, p),
    },
    "carrier.cancel": {
      schema: obj({ bookingId: str, reviewHash: str, reason: str }),
      run: (a, k, p) => app.carriers.cancel(a, k, p),
    },
    "events.retry": {
      schema: obj({
        consumerId: str,
        eventId: str,
        revision: num,
        reason: str,
      }),
      run: (a, k, p) => app.eventDelivery.retry(a, k, p),
    },
    "accounting.cost.prepare": {
      schema: obj({
        version: { const: 1, type: "integer" },
        batchRef: str,
        afterSequence: costNumber,
        throughSequence: costNumber,
        inventoryAccount: str,
        mappings: {
          type: "array",
          maxItems: 30,
          items: obj({ type: str, offsetAccount: str }),
        },
        expectedMovements: { type: "integer", minimum: 1, maximum: 500 },
        expectedIncrease: costNumber,
        expectedDecrease: costNumber,
        expectedOpeningValue: costNumber,
        expectedClosingValue: costNumber,
        acknowledgment: str,
      }),
      run: (a, k, p) => app.integration.costs.prepare(a, k, p),
    },
    "accounting.cost.decide": {
      schema: obj({
        packetId: str,
        reviewHash: str,
        decision: choice("approve", "reject"),
        reason: str,
      }),
      run: (a, k, p) => app.integration.costs.decide(a, k, p),
    },
    "accounting.cost.accept": {
      schema: obj({
        packetId: str,
        contentHash: str,
        receiverRef: str,
        receiverRegion: choice("CA", "US"),
        externalRef: str,
        debit: costNumber,
        credit: costNumber,
        reason: str,
      }),
      run: (a, k, p) => app.integration.costs.accept(a, k, p),
    },
    "billing.portal.publish": {
      schema: obj({ downloadId: str, reason: str }),
      run: (a, k, p) => app.billing.delivery.publish(a, k, p),
    },
    "billing.portal.withdraw": {
      schema: obj({ publicationId: str, revision: num, reason: str }),
      run: (a, k, p) => app.billing.delivery.withdraw(a, k, p),
    },
    "billing.portal.acknowledge": {
      schema: obj({
        publicationId: str,
        downloadId: str,
        contentHash: str,
        confirmation: choice("received"),
      }),
      run: (a, k, p) => app.billing.delivery.acknowledge(a, k, p),
    },
    "billing.profile": {
      schema: obj({
        accountId: { anyOf: [str, { type: "null" }] },
        name: str,
        address: { type: "string", maxLength: 1000 },
        taxRegistration: { type: "string", maxLength: 200 },
        termDays: {
          anyOf: [
            { type: "integer", minimum: 0, maximum: 365 },
            { type: "null" },
          ],
        },
        version: num,
        reason: str,
      }),
      run: (a, k, p) => app.billing.documents.configure(a, k, p),
    },
    "import.documents.preview": {
      schema: obj({
        version: { const: 1, type: "integer" },
        batchRef: str,
        sourceRef: str,
        sourceHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
        cutoffAt: str,
        region: choice("CA", "US"),
        currency: choice("CAD", "USD"),
        expectedQuantity: num,
        expectedValue: num,
        expectedNet: num,
        expectedTax: num,
        expectedCredited: num,
        expectedPaid: num,
        expectedRefunded: num,
        acknowledgment: str,
        rows: { type: "array", minItems: 1, maxItems: 500, items: {} },
      }),
      run: (a, k, p) => app.migration.documents.preview(a, k, p),
    },
    "import.documents.decide": {
      schema: obj({
        batchId: str,
        reviewHash: str,
        decision: choice("approve", "reject"),
        reason: str,
      }),
      run: (a, k, p) => app.migration.documents.decide(a, k, p),
    },
    "import.masters.preview": {
      schema: obj({
        kind: choice("customer", "catalog"),
        version: { const: 1, type: "integer" },
        batchRef: str,
        sourceRef: str,
        sourceHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
        cutoffAt: str,
        region: choice("CA", "US"),
        currency: choice("CAD", "USD"),
        expectedQuantity: num,
        expectedValue: num,
        acknowledgment: str,
        rows: { type: "array", minItems: 1, maxItems: 500, items: {} },
      }),
      run: (a, k, p) => app.migration.masters.preview(a, k, p),
    },
    "import.masters.decide": {
      schema: obj({
        batchId: str,
        reviewHash: str,
        decision: choice("approve", "reject"),
        reason: str,
      }),
      run: (a, k, p) => app.migration.masters.decide(a, k, p),
    },
    "import.opening.preview": {
      schema: obj({
        version: { const: 1, type: "integer" },
        batchRef: str,
        sourceRef: str,
        sourceHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
        cutoffAt: str,
        region: choice("CA", "US"),
        currency: choice("CAD", "USD"),
        expectedQuantity: num,
        expectedValue: num,
        acknowledgment: str,
        rows: { type: "array", minItems: 1, maxItems: 500, items: {} },
      }),
      run: (a, k, p) => app.migration.preview(a, k, p),
    },
    "import.opening.decide": {
      schema: obj({
        batchId: str,
        reviewHash: str,
        decision: choice("approve", "reject"),
        reason: str,
      }),
      run: (a, k, p) => app.migration.decide(a, k, p),
    },
    "account.create": {
      schema: obj({ name: str, tier: str, creditLimit: num }),
      run: (a, k, p) => app.identity.createCustomer(a, k, p),
    },
    "account.hold": {
      schema: obj({ accountId: str, held: bool, reason: str }),
      run: (a, k, p) => app.identity.setHold(a, k, p),
    },
    "provider.disclosure.publish": {
      schema: obj({
        provider: choice(...providerNames),
        region: choice("CA", "US"),
        previousDisclosureId: { anyOf: [str, { type: "null" }] },
        version: str,
        purposes: str,
        minimumData: {
          ...arr({ ...str, maxLength: 200 }),
          minItems: 1,
          maxItems: 30,
          uniqueItems: true,
        },
        processingCountries: {
          ...arr({ type: "string", pattern: "^[A-Z]{2}$" }),
          minItems: 1,
          maxItems: 30,
          uniqueItems: true,
        },
        subprocessors: {
          ...arr({ ...str, maxLength: 200 }),
          maxItems: 30,
          uniqueItems: true,
        },
        retention: str,
        withdrawal: str,
        termsReference: str,
        reviewEvidence: str,
      }),
      run: (a, k, p) => app.identity.residency.publish(a, k, p),
    },
    "provider.disclosure.withdraw": {
      schema: obj({
        provider: choice(...providerNames),
        disclosureId: str,
        reason: str,
      }),
      run: (a, k, p) => app.identity.residency.withdraw(a, k, p),
    },
    "account.residency": {
      schema: obj(
        {
          accountId: str,
          region: choice("CA", "US"),
          mode: choice("strict", "provider-exceptions"),
          providers: {
            type: "array",
            items: choice(...providerNames),
            maxItems: providerNames.length,
            uniqueItems: true,
          },
          version: num,
          acknowledgment: str,
          acceptance: obj(
            {
              basis: choice("buyer", "recorded"),
              representative: { ...str, maxLength: 200 },
              evidenceRef: str,
              disclosures: {
                ...arr(
                  obj({
                    provider: choice(...providerNames),
                    disclosureId: str,
                  }),
                ),
                minItems: 1,
                maxItems: 8,
              },
            },
            ["representative", "evidenceRef"],
          ),
        },
        ["acceptance"],
      ),
      run: (a, k, p) => app.identity.residencyChoice(a, k, p),
    },
    "user.create": {
      schema: obj(
        {
          email: str,
          name: str,
          password: { type: "string", minLength: 14, maxLength: 256 },
          role: choice(
            "admin",
            "warehouse",
            "commercial",
            "finance",
            "warranty",
            "buyer",
            "support",
          ),
          accountId: str,
          sites: arr(str),
          currentPassword: { type: "string", maxLength: 256 },
          requirePasswordChange: bool,
        },
        ["accountId", "requirePasswordChange"],
      ),
      run: (a, k, p) =>
        app.identity.createUser(a, k, {
          ...p,
          requirePasswordChange: p.requirePasswordChange ?? true,
        }),
    },
    "user.update": {
      schema: obj(
        {
          userId: str,
          revision: num,
          email: str,
          name: str,
          role: choice(
            "admin",
            "warehouse",
            "commercial",
            "finance",
            "warranty",
            "buyer",
            "support",
          ),
          accountId: str,
          sites: arr(str),
          active: bool,
          currentPassword: { type: "string", maxLength: 256 },
          reason: str,
        },
        ["accountId"],
      ),
      run: (a, k, p) => app.identity.updateUser(a, k, p),
    },
    "user.password.reset": {
      schema: obj({
        userId: str,
        revision: num,
        password: { type: "string", minLength: 14, maxLength: 256 },
        currentPassword: { type: "string", maxLength: 256 },
        reason: str,
      }),
      run: (a, k, p) => app.identity.resetPassword(a, k, p),
    },
    "user.password.change": {
      schema: obj({
        currentPassword: { type: "string", maxLength: 256 },
        password: { type: "string", minLength: 14, maxLength: 256 },
      }),
      run: (a, k, p) => app.identity.changePassword(a, k, p),
    },
    "user.sessions.revoke": {
      schema: obj({
        userId: str,
        revision: num,
        currentPassword: { type: "string", maxLength: 256 },
        reason: str,
      }),
      run: (a, k, p) => app.identity.revokeSessions(a, k, p),
    },
    "user.sessions.end-own": {
      schema: obj({}),
      run: (a, k) => app.identity.revokeOwnSessions(a, k),
    },
    "warehouse.create": {
      schema: obj({ name: str }),
      run: (a, k, p) => app.inventory.createWarehouse(a, k, p),
    },
    "product.create": {
      schema: obj({
        sku: str,
        name: str,
        serialized: bool,
        unitPrice: num,
        taxBasisPoints: num,
      }),
      run: (a, k, p) => app.catalog.create(a, k, p),
    },
    "product.price": {
      schema: obj({ productId: str, tier: str, unitPrice: num }),
      run: (a, k, p) => app.catalog.setPrice(a, k, p),
    },
    "supplier.create": {
      schema: obj({ name: str }),
      run: (a, k, p) => app.procurement.supplier(a, k, p),
    },
    "purchase.create": {
      schema: obj({
        supplierId: str,
        warehouseId: str,
        lines: arr(obj({ productId: str, quantity: num, unitCost: num })),
      }),
      run: (a, k, p) => app.procurement.create(a, k, p),
    },
    "purchase.draft.save": {
      schema: obj({
        draftId: { anyOf: [str, { type: "null" }] },
        revision: num,
        poId: str,
        lineId: str,
        deliveryRef: str,
        observedSku: str,
        quantity: num,
        serials: { type: "array", maxItems: 500, items: str },
        bin: str,
        quarantine: bool,
      }),
      run: (a, k, p) => app.procurement.drafts.save(a, k, p),
    },
    "purchase.draft.confirm": {
      schema: obj({ draftId: str, revision: num }),
      run: (a, k, p) => app.procurement.drafts.confirm(a, k, p),
    },
    "purchase.draft.discard": {
      schema: obj({ draftId: str, revision: num, reason: str }),
      run: (a, k, p) => app.procurement.drafts.discard(a, k, p),
    },
    "purchase.receive": {
      schema: obj({
        poId: str,
        lineId: str,
        deliveryRef: str,
        quantity: num,
        serials: arr(str),
        bin: str,
        quarantine: bool,
      }),
      run: (a, k, p) => app.procurement.receive(a, k, p),
    },
    "purchase.return": {
      schema: obj({
        receiptId: str,
        unitId: str,
        revision: num,
        quantity: num,
        serial: { anyOf: [str, { type: "null" }] },
        returnRef: str,
        reason: str,
        handoverEvidence: str,
      }),
      run: (a, k, p) => app.procurement.returnStock(a, k, p),
    },
    "purchase.return.credit": {
      schema: obj({
        returnId: str,
        revision: num,
        reference: str,
        evidence: str,
        amount: num,
        currency: choice("CAD", "USD"),
      }),
      run: (a, k, p) => app.procurement.followups.credit(a, k, p),
    },
    "purchase.return.replacement": {
      schema: obj({
        returnId: str,
        revision: num,
        reference: str,
        evidence: str,
        receiptId: str,
        quantity: num,
      }),
      run: (a, k, p) => app.procurement.followups.replacement(a, k, p),
    },
    "purchase.return.void": {
      schema: obj({
        returnId: str,
        revision: num,
        reference: str,
        evidence: str,
        observationId: str,
      }),
      run: (a, k, p) => app.procurement.followups.void(a, k, p),
    },
    "purchase.return.review": {
      schema: obj({
        returnId: str,
        revision: num,
        reference: str,
        evidence: str,
        state: choice("open", "closed"),
        resolution: {
          anyOf: [choice("reconciled", "no-remedy"), { type: "null" }],
        },
      }),
      run: (a, k, p) => app.procurement.followups.review(a, k, p),
    },
    "stock.inspect": {
      schema: obj({
        unitId: str,
        revision: num,
        condition: choice("usable", "quarantine", "damaged"),
        reason: str,
      }),
      run: (a, k, p) => app.inventory.inspect(a, k, p),
    },
    "stock.count": {
      schema: obj({ unitId: str, revision: num, count: num, reason: str }),
      run: (a, k, p) => app.inventory.adjustCount(a, k, p),
    },
    "serial.missing.report": {
      schema: obj({
        unitId: str,
        revision: num,
        serial: str,
        reviewRef: str,
        reason: str,
      }),
      run: (a, k, p) => app.inventory.reportSerialMissing(a, k, p),
    },
    "serial.missing.decide": {
      schema: obj({
        reviewId: str,
        decision: choice("approve", "reject"),
        reason: str,
      }),
      run: (a, k, p) => app.inventory.decideSerialMissing(a, k, p),
    },
    "serial.missing.recover": {
      schema: obj({
        reviewId: str,
        revision: num,
        serial: str,
        receiptRef: str,
        bin: str,
        reason: str,
      }),
      run: (a, k, p) => app.inventory.recoverSerialMissing(a, k, p),
    },
    "count.start": {
      schema: obj({ unitId: str, revision: num, countRef: str }),
      run: (a, k, p) => app.inventory.startCount(a, k, p),
    },
    "count.submit": {
      schema: obj({ countId: str, quantity: num, reason: str }),
      run: (a, k, p) => app.inventory.submitCount(a, k, p),
    },
    "count.decide": {
      schema: obj({
        countId: str,
        decision: choice("approve", "reject"),
        reason: str,
      }),
      run: (a, k, p) => app.inventory.decideCount(a, k, p),
    },
    "transfer.dispatch": {
      schema: obj({
        destinationId: str,
        unitId: str,
        quantity: num,
        revision: num,
        reason: str,
      }),
      run: (a, k, p) => app.inventory.dispatchTransfer(a, k, p),
    },
    "transfer.receive": {
      schema: obj({
        transferId: str,
        lineId: str,
        quantity: num,
        serial: { anyOf: [str, { type: "null" }] },
        receiptRef: str,
        bin: str,
        condition: choice("usable", "quarantine", "damaged"),
        reason: str,
      }),
      run: (a, k, p) => app.inventory.receiveTransfer(a, k, p),
    },
    "transfer.loss": {
      schema: obj({
        transferId: str,
        lineId: str,
        revision: num,
        quantity: num,
        serial: { anyOf: [str, { type: "null" }] },
        lossRef: str,
        reason: str,
      }),
      run: (a, k, p) => app.inventory.approveTransferLoss(a, k, p),
    },
    "transfer.recover": {
      schema: obj({
        lossId: str,
        quantity: num,
        serial: { anyOf: [str, { type: "null" }] },
        receiptRef: str,
        bin: str,
        condition: choice("usable", "quarantine", "damaged"),
        reason: str,
      }),
      run: (a, k, p) => app.inventory.recoverTransferLoss(a, k, p),
    },
    "cart.save": {
      schema: obj({
        accountId: str,
        warehouseId: str,
        revision: num,
        lines: arr(line),
      }),
      run: (a, k, p) => app.orders.saveCart(a, k, p),
    },
    "cart.quote": {
      schema: obj({ cartId: str, revision: num }),
      run: (a, k, p) => app.orders.quote(a, k, p),
    },
    "order.accept": {
      schema: obj({ quoteId: str, allowBackorder: bool }),
      run: (a, k, p) => app.orders.accept(a, k, p),
    },
    "order.allocate": {
      schema: obj({ orderId: str, revision: num }),
      run: (a, k, p) => app.orders.allocate(a, k, p),
    },
    "order.cancel": {
      schema: obj({
        orderId: str,
        lineId: str,
        quantity: num,
        revision: num,
        reason: str,
      }),
      run: (a, k, p) => app.orders.cancel(a, k, p),
    },
    "order.amend": {
      schema: obj({
        orderId: str,
        lineId: str,
        revision: num,
        quantity: num,
        allowBackorder: bool,
        reason: str,
      }),
      run: (a, k, p) => app.orders.amend(a, k, p),
    },
    "order.reservation.deadline": {
      schema: obj({
        orderId: str,
        revision: num,
        expiresAt: {
          type: ["integer", "null"],
          minimum: 1,
          maximum: 253402300799999,
        },
        reason: str,
      }),
      run: (a, k, p) => app.orders.reservationDeadline(a, k, p),
    },
    "order.reservation.expire": {
      schema: obj({ orderId: str, revision: num, reason: str }),
      run: (a, k, p) => app.orders.expireReservations(a, k, p),
    },
    "fulfillment.pick": {
      schema: obj(
        {
          orderId: str,
          allocationId: str,
          serial: { type: ["string", "null"], maxLength: 160 },
          unpick: bool,
        },
        ["unpick"],
      ),
      run: (a, k, p) => app.fulfillment.pick(a, k, p),
    },
    "fulfillment.pack": {
      schema: obj({
        orderId: str,
        revision: num,
        mode: choice("carrier", "collection"),
        address: str,
        lines: arr(obj({ allocationId: str, quantity: num })),
      }),
      run: (a, k, p) => app.fulfillment.pack(a, k, p),
    },
    "fulfillment.short-pick": {
      schema: obj({
        orderId: str,
        revision: num,
        allocationId: str,
        unitRevision: num,
        quantity: num,
        reason: str,
      }),
      run: (a, k, p) => app.fulfillment.shortPick(a, k, p),
    },
    "fulfillment.ship": {
      schema: obj(
        { shipmentId: str, carrier: str, tracking: str, handoverEvidence: str },
        ["carrier", "tracking"],
      ),
      run: (a, k, p) => app.fulfillment.commit(a, k, p),
    },
    "fulfillment.void": {
      schema: obj({ shipmentId: str, reason: str }),
      run: (a, k, p) => app.fulfillment.void(a, k, p),
    },
    "fulfillment.delivery.update": {
      schema: obj({
        shipmentId: str,
        revision: num,
        state: choice("in_transit", "delayed", "lost", "returned", "delivered"),
        reference: str,
        evidence: str,
        observedAt: str,
      }),
      run: (a, k, p) => app.fulfillment.updateDelivery(a, k, p),
    },
    "fulfillment.delivery": {
      schema: obj({ shipmentId: str, reference: str, deliveredAt: str }),
      run: (a, k, p) => app.fulfillment.confirmDelivery(a, k, p),
    },
    "billing.credit": {
      schema: obj({
        invoiceId: str,
        reference: str,
        reason: str,
        lines: arr(obj({ lineId: str, quantity: num })),
      }),
      run: (a, k, p) => app.billing.issueCredit(a, k, p),
    },
    "billing.payment.manual": {
      schema: obj({ invoiceId: str, amount: num, reference: str, reason: str }),
      run: (a, k, p) => app.billing.manualPayment(a, k, p),
    },
    "billing.refund.request": {
      schema: obj({
        invoiceId: str,
        paymentId: str,
        amount: num,
        reference: str,
        reason: str,
      }),
      run: (a, k, p) => app.billing.refundRequest(a, k, p),
    },
    "billing.refund.notice.acknowledge": {
      schema: obj({ noticeId: str, revision: num }),
      run: (a, k, p) => app.billing.refunds.alerts.acknowledge(a, k, p),
    },
    "billing.refund.manual": {
      schema: obj({ refundId: str, reference: str, reason: str }),
      run: (a, k, p) => app.billing.manualRefund(a, k, p),
    },
    "warranty.submit": {
      schema: obj({
        accountId: str,
        unitId: str,
        type: choice("warranty", "return"),
        issue: str,
        evidence: str,
      }),
      run: (a, k, p) => app.warranty.submit(a, k, p),
    },
    "warranty.review": {
      schema: obj({ claimId: str, approved: bool, reason: str }),
      run: (a, k, p) => app.warranty.review(a, k, p),
    },
    "warranty.receive": {
      schema: obj({ claimId: str, warehouseId: str, bin: str, serial: str }),
      run: (a, k, p) => app.warranty.receive(a, k, p),
    },
    "warranty.inspect": {
      schema: obj({ claimId: str, findings: str }),
      run: (a, k, p) => app.warranty.inspect(a, k, p),
    },
    "warranty.disposition": {
      schema: obj({
        claimId: str,
        disposition: choice("restock", "scrap", "repair"),
        reason: str,
      }),
      run: (a, k, p) => app.warranty.dispose(a, k, p),
    },
    "warranty.credit": {
      schema: obj({ claimId: str, reason: str }),
      run: (a, k, p) => app.warranty.credit(a, k, p),
    },
    "warranty.replacement.reserve": {
      schema: obj({
        claimId: str,
        newUnitId: str,
        oldDisposition: choice("restock", "scrap"),
        coveragePolicy: choice("inherit_original"),
        reason: str,
      }),
      run: (a, k, p) => app.warranty.reserveReplacement(a, k, p),
    },
    "warranty.replacement.cancel": {
      schema: obj({ replacementId: str, revision: num, reason: str }),
      run: (a, k, p) => app.warranty.cancelReplacement(a, k, p),
    },
    "warranty.replacement.handover": {
      schema: obj({
        replacementId: str,
        revision: num,
        serial: str,
        recipient: str,
        evidence: str,
      }),
      run: (a, k, p) => app.warranty.handoverReplacement(a, k, p),
    },
    "warranty.replacement.dispatch": {
      schema: obj({
        replacementId: str,
        revision: num,
        serial: str,
        recipient: str,
        address: str,
        carrier: str,
        tracking: str,
        evidence: str,
      }),
      run: (a, k, p) => app.warranty.dispatchReplacement(a, k, p),
    },
    "warranty.replacement.shipping.update": {
      schema: obj({
        replacementId: str,
        revision: num,
        state: choice("in_transit", "delayed", "lost", "delivered"),
        reference: str,
        evidence: str,
        observedAt: str,
      }),
      run: (a, k, p) => app.warranty.updateReplacementShipping(a, k, p),
    },
    "warranty.manufacturer.refer": {
      schema: obj({
        claimId: str,
        manufacturer: str,
        reference: str,
        evidence: str,
        reason: str,
      }),
      run: (a, k, p) => app.warranty.referManufacturer(a, k, p),
    },
    "warranty.manufacturer.decide": {
      schema: obj({
        caseId: str,
        revision: num,
        outcome: choice("accepted", "denied", "cancelled"),
        evidence: str,
        reason: str,
      }),
      run: (a, k, p) => app.warranty.decideManufacturer(a, k, p),
    },
    "stripe.refund": {
      schema: obj({ refundId: str }),
      run: (a, k, p) => app.integration.refund(a, k, p),
    },
    "stripe.checkout": {
      schema: obj({ invoiceId: str }),
      run: (a, k, p) => app.integration.checkout(a, k, p),
    },
    "stripe.checkout.renew": {
      schema: obj({
        effectId: str,
        reviewVersion: str,
        amount: num,
        reason: str,
      }),
      run: (a, k, p) => app.integration.renewCheckout(a, k, p),
    },
    "quickbooks.invoice": {
      schema: obj({
        invoiceId: str,
        customerRef: str,
        itemRefs: { type: "object", additionalProperties: str },
        taxCodeRef: str,
        taxRateRef: str,
      }),
      run: (a, k, p) => app.integration.accounting(a, k, p),
    },
    "quickbooks.credit": {
      schema: obj({ creditId: str }),
      run: (a, k, p) => app.integration.accountingCredit(a, k, p),
    },
    "quickbooks.credit.apply": {
      schema: obj({ creditId: str, amount: { ...num, minimum: 1 } }),
      run: (a, k, p) => app.integration.accountingCreditApplication(a, k, p),
    },
    "quickbooks.refund": {
      schema: obj({
        refundId: str,
        creditId: str,
        bankAccountRef: str,
        receivableAccountRef: str,
        nonTaxCodeRef: str,
        expenseDate: str,
      }),
      run: (a, k, p) => app.integration.accountingRefund(a, k, p),
    },
    "quickbooks.refund.apply": {
      schema: obj({ refundId: str }),
      run: (a, k, p) => app.integration.accountingRefundApplication(a, k, p),
    },
    "quickbooks.payment": {
      schema: obj({
        paymentId: str,
        appliedAmount: num,
        depositAccountRef: str,
      }),
      run: (a, k, p) => app.integration.accountingPayment(a, k, p),
    },
  };
}
export type HttpOptions = {
  origin: string;
  secureCookies?: boolean;
  staticRoot?: string;
  logger?: boolean;
  providers?: ProviderRuntime;
  carriers?: CarrierRuntime;
};
export async function createHttp(app: Application, options: HttpOptions) {
  const origin = new URL(options.origin).origin;
  const http = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 256 * 1024,
    ajv: {
      customOptions: {
        removeAdditional: false,
        coerceTypes: false,
        useDefaults: false,
      },
    },
  });
  await http.register(cookie);
  await http.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  });
  const sessions = new WeakMap<
    object,
    {
      actor: Actor;
      csrf: string;
      passwordChangeRequired: boolean;
      mfaEnrollmentRequired: boolean;
    }
  >();
  const actor = (request: object) => sessions.get(request)!.actor;
  const cookieOptions = {
    httpOnly: true,
    secure: options.secureCookies ?? false,
    sameSite: "strict" as const,
    path: "/",
    maxAge: 8 * 3600,
  };
  http.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("Permissions-Policy", "camera=(self), microphone=()");
    if (!request.url.startsWith("/api/") || request.url === "/api/health")
      return;
    if (["POST", "PUT", "DELETE", "PATCH"].includes(request.method))
      check(
        request.headers.origin === origin,
        "ORIGIN",
        "Request origin is not permitted.",
        403,
      );
    if (request.url === "/api/login") return;
    const session = app.identity.session(request.cookies.distributor_session);
    sessions.set(request, session);
    if (request.method !== "GET")
      check(
        request.headers["x-csrf-token"] === session.csrf,
        "CSRF",
        "Session request token is missing or invalid.",
        403,
      );
    check(
      !session.passwordChangeRequired ||
        [
          "/api/session",
          "/api/logout",
          "/api/security",
          "/api/commands/user.password.change",
          "/api/commands/user.sessions.end-own",
        ].includes(request.url.split("?")[0]!),
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before entering the workspace.",
      403,
    );
    check(
      !session.mfaEnrollmentRequired ||
        [
          "/api/session",
          "/api/logout",
          "/api/security",
          "/api/security/mfa/setup",
          "/api/security/mfa/confirm",
          "/api/commands/user.password.change",
          "/api/commands/user.sessions.end-own",
        ].includes(request.url.split("?")[0]!),
      "MFA_ENROLLMENT_REQUIRED",
      "Set up an authenticator before opening the workspace.",
      403,
    );
  });
  http.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainError) {
      const session = sessions.get(request);
      if (session && error.status === 403)
        app.platform.audit(
          session.actor,
          "authorization.denied",
          request.routeOptions.url ?? "",
          { code: error.code },
        );
      return reply.code(error.status).send({
        code: error.code,
        message: error.message,
        requestId: request.id,
      });
    }
    const validation = (error as FastifyError).validation;
    if (validation)
      return reply.code(400).send({
        code: "VALIDATION",
        message: "Request fields are invalid.",
        fields: validation.map((v) => ({
          path: v.instancePath,
          message: v.message,
        })),
        requestId: request.id,
      });
    const status = (error as FastifyError).statusCode;
    if (status && [400, 413, 415].includes(status))
      return reply.code(status).send({
        code: "REQUEST_BODY",
        message: "Request body is invalid, unsupported or too large.",
        requestId: request.id,
      });
    // Do not send SQL, secrets or provider response bodies to clients.
    return reply.code(500).send({
      code: "INTERNAL",
      message:
        "Operation failed. Retry with the same request key after reviewing current state.",
      requestId: request.id,
    });
  });
  http.get("/api/health", async () => ({
    status: "ok",
    region: app.identity.region,
  }));
  http.post(
    "/api/login",
    {
      schema: {
        body: obj(
          {
            email: str,
            password: { type: "string", maxLength: 256 },
            code: { type: "string", minLength: 1, maxLength: 64 },
          },
          ["code"],
        ),
      },
    },
    async (request, reply) => {
      const p = request.body as {
          email: string;
          password: string;
          code?: string;
        },
        session = app.identity.login(p.email, p.password, p.code);
      reply.setCookie("distributor_session", session.token, cookieOptions);
      return {
        actor: session.actor,
        csrf: session.csrf,
        passwordChangeRequired: session.passwordChangeRequired,
        mfaEnrollmentRequired: session.mfaEnrollmentRequired,
      };
    },
  );
  http.post("/api/logout", async (request, reply) => {
    app.identity.logout(request.cookies.distributor_session!);
    reply.clearCookie("distributor_session", { path: "/" });
    return { loggedOut: true };
  });
  http.get("/api/session", async (request) => sessions.get(request));
  http.get("/api/security", async (request) =>
    app.identity.security(actor(request)),
  );
  const factorPassword = { type: "string", maxLength: 256 };
  const factorCode = { type: "string", minLength: 1, maxLength: 64 };
  for (const [operation, schema] of Object.entries({
    setup: obj({
      currentPassword: factorPassword,
      revision: num,
      key: { type: "string", minLength: 1, maxLength: 128 },
    }),
    confirm: obj({
      currentPassword: factorPassword,
      enrollmentId: str,
      code: factorCode,
      recoverySaved: bool,
    }),
    disable: obj({
      currentPassword: factorPassword,
      code: factorCode,
      revision: num,
    }),
    "replacement/prepare": obj({
      currentPassword: factorPassword,
      revision: num,
      key: { type: "string", minLength: 1, maxLength: 128 },
    }),
    "replacement/confirm": obj({
      currentPassword: factorPassword,
      replacementId: str,
      currentCode: factorCode,
      newCode: { type: "string", pattern: "^[0-9]{6}$" },
      recoverySaved: bool,
    }),
    "recovery/prepare": obj({
      currentPassword: factorPassword,
      revision: num,
      key: { type: "string", minLength: 1, maxLength: 128 },
    }),
    "recovery/confirm": obj({
      currentPassword: factorPassword,
      renewalId: str,
      code: factorCode,
      recoverySaved: bool,
    }),
  })) {
    http.post(
      `/api/security/mfa/${operation}`,
      { schema: { body: schema } },
      async (request, reply) => {
        const p = request.body as any;
        const result =
          operation === "setup"
            ? app.identity.mfa.begin(actor(request), p.key, p)
            : operation === "confirm"
              ? app.identity.mfa.confirm(actor(request), p)
              : operation === "recovery/prepare"
                ? app.identity.mfa.prepareRecovery(actor(request), p.key, p)
                : operation === "recovery/confirm"
                  ? app.identity.mfa.confirmRecovery(actor(request), p)
                  : operation === "replacement/prepare"
                    ? app.identity.mfa.prepareReplacement(
                        actor(request),
                        p.key,
                        p,
                      )
                    : operation === "replacement/confirm"
                      ? app.identity.mfa.confirmReplacement(actor(request), p)
                      : app.identity.mfa.disable(actor(request), p);
        if ("sessionEnded" in result && result.sessionEnded)
          reply.clearCookie("distributor_session", { path: "/" });
        return result;
      },
    );
  }
  http.get("/api/users", async (request) => app.identity.users(actor(request)));
  http.get("/api/dashboard", async (request) => app.dashboard(actor(request)));
  http.get("/api/provider-disclosures", async (request) =>
    app.identity.residency.current(actor(request)),
  );
  http.get<{ Params: { disclosureId: string } }>(
    "/api/provider-disclosures/:disclosureId",
    { schema: { params: obj({ disclosureId: str }) } },
    async (request) =>
      app.identity.residency.disclosure(
        actor(request),
        request.params.disclosureId,
      ),
  );
  http.get<{ Params: { accountId: string }; Querystring: { after?: string } }>(
    "/api/accounts/:accountId/provider-acceptance-versions",
    {
      schema: {
        params: obj({ accountId: str }),
        querystring: obj(
          { after: { type: "string", pattern: "^[1-9][0-9]{0,15}$" } },
          ["after"],
        ),
      },
    },
    async (request) =>
      app.identity.residency.acceptanceVersions(
        actor(request),
        request.params.accountId,
        request.query.after === undefined
          ? undefined
          : Number(request.query.after),
      ),
  );
  http.get<{ Params: { accountId: string }; Querystring: { version: string } }>(
    "/api/accounts/:accountId/provider-acceptances",
    {
      schema: {
        params: obj({ accountId: str }),
        querystring: obj({
          version: { type: "string", pattern: "^[1-9][0-9]{0,11}$" },
        }),
      },
    },
    async (request) =>
      app.identity.residency.acceptances(
        actor(request),
        request.params.accountId,
        Number(request.query.version),
      ),
  );
  http.get("/api/carts", async (request) => app.orders.carts(actor(request)));
  http.get("/api/purchases", async (request) => ({
    suppliers: app.procurement.suppliers(actor(request)),
    orders: app.procurement.orders(actor(request)),
    receipts: app.procurement.receipts(actor(request)),
    returns: app.procurement.returns(actor(request)),
    drafts: app.procurement.drafts.list(actor(request)),
  }));
  http.get<{ Params: { returnId: string }; Querystring: { after?: string } }>(
    "/api/purchases/returns/:returnId/history",
    {
      schema: {
        params: obj({ returnId: str }),
        querystring: obj(
          { after: { type: "string", pattern: "^[1-9][0-9]{0,8}$" } },
          ["after"],
        ),
      },
    },
    async (request) =>
      app.procurement.followups.history(
        actor(request),
        request.params.returnId,
        request.query.after === undefined
          ? undefined
          : Number(request.query.after),
      ),
  );
  http.get<{ Params: { draftId: string } }>(
    "/api/purchases/drafts/:draftId/history",
    { schema: { params: obj({ draftId: str }) } },
    async (request) =>
      app.procurement.drafts.history(actor(request), request.params.draftId),
  );
  http.get("/api/transfers", async (request) =>
    app.inventory.transfers(actor(request)),
  );
  http.get<{ Querystring: { after?: string } }>(
    "/api/stock/serial-reviews",
    { schema: { querystring: obj({ after: str }, ["after"]) } },
    async (request) =>
      app.inventory.serialReviews(actor(request), request.query.after),
  );
  http.get("/api/counts", async (request) =>
    app.inventory.counts(actor(request)),
  );
  http.get("/api/imports/opening", async (request) =>
    app.migration.list(actor(request)),
  );
  http.get("/api/imports/documents", async (request) =>
    app.migration.documents.list(actor(request)),
  );
  http.get("/api/imports/masters", async (request) =>
    app.migration.masters.list(actor(request)),
  );
  http.get("/api/transfer-destinations", async (request) =>
    app.inventory.transferDestinations(actor(request)),
  );
  http.get<{ Params: { orderId: string } }>(
    "/api/orders/:orderId/picks",
    async (request) =>
      app.fulfillment.picks(actor(request), request.params.orderId),
  );
  http.get<{ Params: { orderId: string }; Querystring: { after?: string } }>(
    "/api/orders/:orderId/amendments",
    {
      schema: {
        querystring: obj(
          { after: { type: "string", pattern: "^[1-9][0-9]{0,15}$" } },
          ["after"],
        ),
      },
    },
    async (request) =>
      app.orders.amendments(
        actor(request),
        request.params.orderId,
        request.query.after,
      ),
  );
  http.get<{ Params: { orderId: string }; Querystring: { after?: string } }>(
    "/api/orders/:orderId/reservations",
    {
      schema: {
        querystring: obj(
          { after: { type: "string", pattern: "^[1-9][0-9]{0,15}$" } },
          ["after"],
        ),
      },
    },
    async (request) =>
      app.orders.reservations(
        actor(request),
        request.params.orderId,
        request.query.after,
      ),
  );
  http.get<{ Params: { orderId: string }; Querystring: { after?: string } }>(
    "/api/orders/:orderId/short-picks",
    { schema: { querystring: obj({ after: str }, ["after"]) } },
    async (request) =>
      app.fulfillment.shortPicks(
        actor(request),
        request.params.orderId,
        request.query.after,
      ),
  );
  http.get<{ Params: { serial: string } }>(
    "/api/serials/:serial",
    async (request) =>
      app.inventory.trace(actor(request), request.params.serial),
  );
  http.get("/api/credits", async (request) =>
    app.billing.credits(actor(request)),
  );
  http.get("/api/billing/inbox", async (request) =>
    app.billing.delivery.list(actor(request)),
  );
  const inboxQuery = obj(
    {
      after: { type: "string", minLength: 1, maxLength: 512 },
      limit: { type: "string", pattern: "^(?:[1-9][0-9]?|100)$" },
    },
    ["after", "limit"],
  );
  http.get<{
    Querystring: { query?: string; accountId?: string; after?: string };
  }>(
    "/api/warranty/sold-units/page",
    {
      schema: {
        querystring: obj(
          {
            query: { type: "string", minLength: 1, maxLength: 100 },
            accountId: { type: "string", minLength: 1, maxLength: 160 },
            after: { type: "string", minLength: 1, maxLength: 128 },
          },
          ["query", "accountId", "after"],
        ),
      },
    },
    async (request) => app.warranty.soldUnitPage(actor(request), request.query),
  );
  http.get<{ Params: { unitId: string }; Querystring: { accountId: string } }>(
    "/api/warranty/sold-units/:unitId/coverage",
    {
      schema: {
        params: obj({ unitId: str }),
        querystring: obj({ accountId: str }),
      },
    },
    async (request) =>
      app.warranty.coverage(
        actor(request),
        request.params.unitId,
        request.query.accountId,
      ),
  );
  http.get<{ Params: { claimId: string }; Querystring: { after?: string } }>(
    "/api/warranty/claims/:claimId/decisions",
    {
      schema: {
        params: obj({ claimId: str }),
        querystring: obj(
          { after: { type: "string", minLength: 1, maxLength: 128 } },
          ["after"],
        ),
      },
    },
    async (request) =>
      app.warranty.decisionHistory(
        actor(request),
        request.params.claimId,
        request.query.after,
      ),
  );
  http.get<{ Querystring: { after?: string; limit?: string } }>(
    "/api/billing/inbox/page",
    { schema: { querystring: inboxQuery } },
    async (request) =>
      app.billing.delivery.page(actor(request), {
        after: request.query.after,
        limit:
          request.query.limit === undefined
            ? undefined
            : Number(request.query.limit),
      }),
  );
  http.get<{
    Params: { publicationId: string; kind: "downloads" | "acknowledgments" };
    Querystring: { after?: string; limit?: string };
  }>(
    "/api/billing/inbox/:publicationId/history/:kind",
    {
      schema: {
        params: obj({
          publicationId: str,
          kind: choice("downloads", "acknowledgments"),
        }),
        querystring: inboxQuery,
      },
    },
    async (request) =>
      app.billing.delivery.history(
        actor(request),
        request.params.publicationId,
        request.params.kind,
        {
          after: request.query.after,
          limit:
            request.query.limit === undefined
              ? undefined
              : Number(request.query.limit),
        },
      ),
  );
  http.post<{ Params: { publicationId: string } }>(
    "/api/billing/inbox/:publicationId/pdf",
    {
      schema: {
        params: obj({ publicationId: str }),
        body: obj({}),
        headers: {
          type: "object",
          properties: {
            "idempotency-key": { type: "string", minLength: 1, maxLength: 128 },
          },
          required: ["idempotency-key"],
        },
      },
    },
    async (request, reply) => {
      const result = app.billing.delivery.download(
        actor(request),
        String(request.headers["idempotency-key"]),
        request.params.publicationId,
      );
      return reply
        .type("application/pdf")
        .header(
          "Content-Disposition",
          `attachment; filename="${result.receipt.filename}"`,
        )
        .header("x-document-sha256", result.receipt.contentHash)
        .header("x-download-receipt", result.receipt.id)
        .send(result.bytes);
    },
  );
  http.get("/api/billing/profiles", async (request) =>
    app.billing.documents.profiles(actor(request)),
  );
  http.get("/api/billing/aging", async (request) =>
    app.billing.documents.aging(actor(request)),
  );
  http.get("/api/billing/downloads", async (request) =>
    app.billing.documents.downloads(actor(request)),
  );
  http.get("/api/billing/aging.csv", async (request, reply) =>
    reply
      .type("text/csv; charset=utf-8")
      .header(
        "Content-Disposition",
        'attachment; filename="distributor-aging.csv"',
      )
      .send(app.billing.documents.agingCsv(actor(request))),
  );
  http.post<{ Params: { kind: "invoice" | "credit"; documentId: string } }>(
    "/api/billing/documents/:kind/:documentId/pdf",
    {
      schema: {
        params: obj({ kind: choice("invoice", "credit"), documentId: str }),
        body: obj({}),
        headers: {
          type: "object",
          properties: {
            "idempotency-key": { type: "string", minLength: 1, maxLength: 128 },
          },
          required: ["idempotency-key"],
        },
      },
    },
    async (request, reply) => {
      const result = await app.billing.documents.download(
        actor(request),
        String(request.headers["idempotency-key"]),
        request.params.kind,
        request.params.documentId,
        () => app.identity.session(request.cookies.distributor_session).actor,
      );
      return reply
        .type("application/pdf")
        .header(
          "Content-Disposition",
          `attachment; filename="${result.receipt.filename}"`,
        )
        .header("x-document-sha256", result.receipt.contentHash)
        .header("x-download-receipt", result.receipt.id)
        .send(result.bytes);
    },
  );
  http.get("/api/stock/labels", async (request) =>
    app.labels.downloads(actor(request)),
  );
  http.post<{
    Params: { unitId: string };
    Body: { revision: number; copies: number };
  }>(
    "/api/stock/:unitId/label",
    {
      schema: {
        params: obj({ unitId: str }),
        body: obj({
          revision: { type: "integer", minimum: 1, maximum: 1000000000 },
          copies: { type: "integer", minimum: 1, maximum: 20 },
        }),
        headers: {
          type: "object",
          properties: {
            "idempotency-key": { type: "string", minLength: 1, maxLength: 128 },
          },
          required: ["idempotency-key"],
        },
      },
    },
    async (request, reply) => {
      const result = await app.labels.download(
        actor(request),
        String(request.headers["idempotency-key"]),
        request.params.unitId,
        request.body,
        () => app.identity.session(request.cookies.distributor_session).actor,
      );
      return reply
        .type("application/pdf")
        .header(
          "Content-Disposition",
          `attachment; filename="${result.receipt.filename}"`,
        )
        .header("x-document-sha256", result.receipt.contentHash)
        .header("x-download-receipt", result.receipt.id)
        .send(result.bytes);
    },
  );
  http.get("/api/billing/payments", async (request) =>
    app.billing.refunds.payments(actor(request)),
  );
  http.get<{ Querystring: { after?: string } }>(
    "/api/billing/payments/page",
    {
      schema: {
        querystring: obj(
          { after: { type: "string", minLength: 1, maxLength: 128 } },
          ["after"],
        ),
      },
    },
    async (request) =>
      app.billing.paymentHistory.page(actor(request), request.query.after),
  );
  http.get<{ Params: { invoiceId: string }; Querystring: { after?: string } }>(
    "/api/billing/invoices/:invoiceId/payments/page",
    {
      schema: {
        params: obj({
          invoiceId: { type: "string", minLength: 1, maxLength: 128 },
        }),
        querystring: obj(
          { after: { type: "string", minLength: 1, maxLength: 128 } },
          ["after"],
        ),
      },
    },
    async (request) =>
      app.billing.paymentHistory.page(
        actor(request),
        request.query.after,
        request.params.invoiceId,
      ),
  );
  http.get("/api/billing/refunds", async (request) =>
    app.billing.refunds.list(actor(request)),
  );
  http.get<{ Querystring: { after?: string } }>(
    "/api/billing/refunds/page",
    {
      schema: {
        querystring: obj(
          { after: { type: "string", minLength: 1, maxLength: 128 } },
          ["after"],
        ),
      },
    },
    async (request) =>
      app.billing.refunds.history.page(actor(request), request.query.after),
  );
  http.get<{ Params: { refundId: string }; Querystring: { after?: string } }>(
    "/api/billing/refunds/:refundId/observations",
    {
      schema: {
        params: obj({
          refundId: { type: "string", minLength: 1, maxLength: 128 },
        }),
        querystring: obj(
          { after: { type: "string", pattern: "^[1-9][0-9]{0,15}$" } },
          ["after"],
        ),
      },
    },
    async (request) =>
      app.billing.refunds.history.observations(
        actor(request),
        request.params.refundId,
        request.query.after === undefined
          ? undefined
          : Number(request.query.after),
      ),
  );
  const noticeQuery = obj(
    {
      after: { type: "string", pattern: "^[1-9][0-9]{0,15}$" },
      limit: { type: "string", pattern: "^(?:[1-9][0-9]?|100)$" },
    },
    ["after", "limit"],
  );
  const noticePage = (query: { after?: string; limit?: string }) => ({
    after: query.after === undefined ? undefined : Number(query.after),
    limit: query.limit === undefined ? undefined : Number(query.limit),
  });
  http.get<{ Querystring: { after?: string } }>(
    "/api/shipments/page",
    {
      schema: {
        querystring: obj(
          { after: { type: "string", minLength: 1, maxLength: 128 } },
          ["after"],
        ),
      },
    },
    async (request) =>
      app.fulfillment.shipmentPage(actor(request), request.query.after),
  );
  http.get<{ Params: { shipmentId: string } }>(
    "/api/shipments/:shipmentId/carrier",
    { schema: { params: obj({ shipmentId: str }), querystring: obj({}) } },
    async (request) => {
      const current = app.carriers.review(
        actor(request),
        request.params.shipmentId,
      );
      return {
        ...current,
        enabled: current.booking
          ? (options.carriers?.enabled(
              actor(request),
              current.booking.provider,
            ) ?? false)
          : false,
      };
    },
  );
  http.get<{ Params: { shipmentId: string }; Querystring: { after?: string } }>(
    "/api/shipments/:shipmentId/carrier/history",
    {
      schema: {
        params: obj({ shipmentId: str }),
        querystring: obj(
          { after: { type: "string", minLength: 1, maxLength: 128 } },
          ["after"],
        ),
      },
    },
    async (request) =>
      app.carriers.history(
        actor(request),
        request.params.shipmentId,
        request.query.after,
      ),
  );
  for (const action of ["send", "reconcile"] as const)
    http.post<{ Params: { bookingId: string } }>(
      `/api/carrier/:bookingId/${action}`,
      {
        schema: {
          params: obj({ bookingId: str }),
          body: obj({}),
          querystring: obj({}),
        },
      },
      async (request) => {
        check(
          options.carriers,
          "CARRIER_DISABLED",
          "No qualified carrier adapter is configured for this organization.",
          503,
        );
        return action === "send"
          ? options.carriers.execute(actor(request), request.params.bookingId)
          : options.carriers.reconcile(
              actor(request),
              request.params.bookingId,
            );
      },
    );
  http.get<{ Params: { bookingId: string } }>(
    "/api/carrier/:bookingId/label",
    { schema: { params: obj({ bookingId: str }), querystring: obj({}) } },
    async (request, reply) => {
      const label = app.carriers.label(
        actor(request),
        request.params.bookingId,
      );
      return reply
        .header("Content-Type", "application/octet-stream")
        .header(
          "Content-Disposition",
          'attachment; filename="carrier-label.bin"',
        )
        .header("Cache-Control", "no-store")
        .header("X-Document-Sha256", label.hash)
        .header("X-Label-Media-Type", label.mediaType)
        .send(label.bytes);
    },
  );
  http.get<{ Params: { shipmentId: string }; Querystring: { after?: string } }>(
    "/api/shipments/:shipmentId/delivery/history",
    {
      schema: {
        params: obj({ shipmentId: str }),
        querystring: obj(
          { after: { type: "string", pattern: "^[1-9][0-9]{0,8}$" } },
          ["after"],
        ),
      },
    },
    async (request) =>
      app.fulfillment.deliveryHistory(
        actor(request),
        request.params.shipmentId,
        request.query.after === undefined
          ? undefined
          : Number(request.query.after),
      ),
  );
  http.get<{
    Params: { replacementId: string };
    Querystring: { after?: string };
  }>(
    "/api/warranty/replacements/:replacementId/shipping/history",
    {
      schema: {
        params: obj({ replacementId: str }),
        querystring: obj(
          { after: { type: "string", pattern: "^[1-9][0-9]{0,8}$" } },
          ["after"],
        ),
      },
    },
    async (request) =>
      app.warranty.replacementShippingHistory(
        actor(request),
        request.params.replacementId,
        request.query.after === undefined
          ? undefined
          : Number(request.query.after),
      ),
  );
  http.get<{ Querystring: { after?: string; limit?: string } }>(
    "/api/billing/refund-notices",
    { schema: { querystring: noticeQuery } },
    async (request) =>
      app.billing.refunds.alerts.page(
        actor(request),
        noticePage(request.query),
      ),
  );
  http.get<{
    Params: { noticeId: string };
    Querystring: { after?: string; limit?: string };
  }>(
    "/api/billing/refund-notices/:noticeId/history",
    { schema: { params: obj({ noticeId: str }), querystring: noticeQuery } },
    async (request) =>
      app.billing.refunds.alerts.history(
        actor(request),
        request.params.noticeId,
        noticePage(request.query),
      ),
  );
  http.get("/api/effects", async (request) =>
    app.integration.list(actor(request)),
  );
  http.get<{ Params: { effectId: string } }>(
    "/api/effects/:effectId/checkout",
    { schema: { params: obj({ effectId: str }) } },
    async (request) =>
      app.integration.checkouts.open(actor(request), request.params.effectId),
  );
  http.get<{
    Params: { effectId: string };
    Querystring: { after?: string };
  }>(
    "/api/effects/:effectId/checkout/history",
    {
      schema: {
        params: obj({
          effectId: { type: "string", minLength: 1, maxLength: 128 },
        }),
        querystring: obj(
          { after: { type: "string", minLength: 1, maxLength: 128 } },
          ["after"],
        ),
      },
    },
    async (request) =>
      app.integration.checkouts.history(
        actor(request),
        request.params.effectId,
        request.query.after,
      ),
  );
  const providers = () => {
    check(
      options.providers,
      "PROVIDER_DISABLED",
      "Provider access is disabled or not configured.",
      503,
    );
    return options.providers;
  };
  for (const operation of ["execute", "reconcile"] as const)
    http.post<{ Params: { effectId: string } }>(
      `/api/effects/:effectId/${operation}`,
      { schema: { params: obj({ effectId: str }) } },
      async (request) =>
        providers()[operation](actor(request), request.params.effectId),
    );
  http.post<{ Params: { effectId: string } }>(
    "/api/effects/:effectId/close-checkout",
    {
      preValidation: async (request) => {
        check(
          request.body === undefined ||
            (request.body !== null &&
              typeof request.body === "object" &&
              !Array.isArray(request.body) &&
              Object.keys(request.body).length === 0),
          "VALIDATION",
          "Checkout closing accepts no request fields.",
          400,
        );
      },
      schema: { params: obj({ effectId: str }) },
    },
    async (request) =>
      providers().closeCheckout(actor(request), request.params.effectId),
  );
  http.post<{ Params: { effectId: string } }>(
    "/api/effects/:effectId/refresh-checkout",
    {
      preValidation: async (request) => {
        check(
          request.body === undefined ||
            (request.body !== null &&
              typeof request.body === "object" &&
              !Array.isArray(request.body) &&
              Object.keys(request.body).length === 0),
          "VALIDATION",
          "Checkout refresh accepts no request fields.",
          400,
        );
      },
      schema: { params: obj({ effectId: str }) },
    },
    async (request) =>
      providers().refreshCheckout(actor(request), request.params.effectId),
  );
  http.post<{ Params: { effectId: string } }>(
    "/api/effects/:effectId/refresh-refund",
    { schema: { params: obj({ effectId: str }) } },
    async (request) =>
      providers().refreshRefund(actor(request), request.params.effectId),
  );
  http.post<{ Params: { effectId: string } }>(
    "/api/effects/:effectId/balance",
    {
      preValidation: async (request) => {
        check(
          request.body === undefined ||
            (request.body !== null &&
              typeof request.body === "object" &&
              !Array.isArray(request.body) &&
              Object.keys(request.body).length === 0),
          "VALIDATION",
          "Balance checks accept no request fields.",
          400,
        );
      },
      schema: {
        params: obj({ effectId: str }),
        headers: {
          type: "object",
          properties: {
            "idempotency-key": { type: "string", minLength: 1, maxLength: 128 },
          },
          required: ["idempotency-key"],
        },
      },
    },
    async (request) =>
      providers().refreshAccountingBalance(
        actor(request),
        request.params.effectId,
        String(request.headers["idempotency-key"]),
      ),
  );
  http.get<{
    Params: { effectId: string };
    Querystring: { after?: string; limit?: string };
  }>(
    "/api/effects/:effectId/balance-history",
    { schema: { params: obj({ effectId: str }), querystring: noticeQuery } },
    async (request) =>
      app.integration.balances.history(
        actor(request),
        request.params.effectId,
        noticePage(request.query),
      ),
  );
  http.get("/api/provider-callbacks", async (request) =>
    app.integration.callbacks(actor(request)),
  );
  http.post<{ Params: { callbackId: string } }>(
    "/api/provider-callbacks/:callbackId/retry",
    { schema: { params: obj({ callbackId: str }) } },
    async (request) =>
      app.integration.retryCallback(actor(request), request.params.callbackId),
  );
  // Encapsulation keeps the byte-preserving parser away from authenticated JSON commands.
  await http.register(async (webhooks) => {
    webhooks.removeContentTypeParser("application/json");
    webhooks.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (_request, body, done) => done(null, body),
    );
    webhooks.post<{ Params: { bindingId: string }; Body: Buffer }>(
      "/webhooks/stripe/:bindingId",
      { schema: { params: obj({ bindingId: str }) } },
      async (request) =>
        providers().receiveStripe(
          request.params.bindingId,
          request.body,
          request.headers["stripe-signature"],
        ),
    );
  });
  http.get("/api/audit", async (request) =>
    app.platform.audits(actor(request)),
  );
  http.get<{ Querystring: { after?: string } }>(
    "/api/audit/page",
    {
      schema: {
        querystring: obj(
          { after: { type: "string", minLength: 1, maxLength: 128 } },
          ["after"],
        ),
      },
    },
    async (request) =>
      app.platform.auditPage(actor(request), request.query.after),
  );
  http.get<{ Params: { consumerId: string }; Querystring: { after?: string } }>(
    "/api/events/:consumerId/deliveries",
    {
      schema: {
        params: obj({ consumerId: str }),
        querystring: obj({ after: str }, ["after"]),
      },
    },
    async (request) =>
      app.eventDelivery.diagnostics(
        actor(request),
        request.params.consumerId,
        request.query.after,
      ),
  );
  http.get<{
    Params: { consumerId: string; eventId: string };
    Querystring: { before?: string };
  }>(
    "/api/events/:consumerId/deliveries/:eventId/history",
    {
      schema: {
        params: obj({ consumerId: str, eventId: str }),
        querystring: obj(
          { before: { type: "string", pattern: "^[1-9][0-9]{0,9}$" } },
          ["before"],
        ),
      },
    },
    async (request) =>
      app.eventDelivery.history(
        actor(request),
        request.params.consumerId,
        request.params.eventId,
        request.query.before === undefined
          ? undefined
          : Number(request.query.before),
      ),
  );
  http.get("/api/accounting.csv", async (request, reply) =>
    reply
      .type("text/csv")
      .header(
        "Content-Disposition",
        'attachment; filename="distributor-accounting.csv"',
      )
      .send(app.integration.accountingCsv(actor(request))),
  );
  http.get("/api/accounting/cost-source", async (request) =>
    app.integration.costs.source(actor(request)),
  );
  http.get<{ Querystring: { before?: string; limit?: string } }>(
    "/api/accounting/costs",
    {
      schema: {
        querystring: obj(
          {
            before: { type: "string", pattern: "^[1-9][0-9]{0,15}$" },
            limit: { type: "string", pattern: "^[1-9][0-9]{0,2}$" },
          },
          ["before", "limit"],
        ),
      },
    },
    async (request) =>
      app.integration.costs.list(actor(request), {
        before:
          request.query.before === undefined
            ? undefined
            : Number(request.query.before),
        limit:
          request.query.limit === undefined
            ? undefined
            : Number(request.query.limit),
      }),
  );
  http.get<{ Params: { packetId: string } }>(
    "/api/accounting/costs/:packetId",
    { schema: { params: obj({ packetId: str }) } },
    async (request) =>
      app.integration.costs.detail(actor(request), request.params.packetId),
  );
  http.get<{ Params: { packetId: string } }>(
    "/api/accounting/costs/:packetId/file",
    { schema: { params: obj({ packetId: str }) } },
    async (request, reply) => {
      const file = app.integration.costs.download(
        actor(request),
        request.params.packetId,
      );
      return reply
        .type("application/json")
        .header(
          "Content-Disposition",
          `attachment; filename="${file.filename}"`,
        )
        .header("x-document-sha256", file.hash)
        .header("Cache-Control", "no-store")
        .send(file.bytes);
    },
  );
  const evidenceParams = obj({ claimId: str, evidenceId: str });
  http.get<{ Params: { claimId: string }; Querystring: { after?: string } }>(
    "/api/warranty/claims/:claimId/evidence",
    {
      schema: {
        params: obj({ claimId: str }),
        querystring: obj(
          { after: { type: "string", minLength: 1, maxLength: 128 } },
          ["after"],
        ),
      },
    },
    async (request) =>
      app.warranty.evidence.list(
        actor(request),
        request.params.claimId,
        request.query.after,
      ),
  );
  http.post<{ Params: { claimId: string }; Body: EvidenceUpload }>(
    "/api/warranty/claims/:claimId/evidence",
    {
      bodyLimit: 4 * Math.ceil(evidenceMaxBytes / 3) + 16 * 1024,
      schema: {
        params: obj({ claimId: str }),
        body: obj({
          filename: { type: "string", minLength: 1, maxLength: 120 },
          mediaType: choice(...Object.keys(evidenceMediaTypes)),
          audience: choice("customer", "staff"),
          description: { type: "string", minLength: 1, maxLength: 1000 },
          contentBase64: {
            type: "string",
            minLength: 1,
            maxLength: 4 * Math.ceil(evidenceMaxBytes / 3),
          },
        }),
        headers: {
          type: "object",
          properties: {
            "idempotency-key": { type: "string", minLength: 1, maxLength: 128 },
          },
          required: ["idempotency-key"],
        },
      },
    },
    async (request) =>
      app.warranty.evidence.upload(
        actor(request),
        String(request.headers["idempotency-key"]),
        request.params.claimId,
        request.body,
      ),
  );
  http.post<{
    Params: { claimId: string; evidenceId: string };
    Body: Record<string, never>;
  }>(
    "/api/warranty/claims/:claimId/evidence/:evidenceId/download",
    {
      schema: {
        params: evidenceParams,
        body: obj({}),
        headers: {
          type: "object",
          properties: {
            "idempotency-key": { type: "string", minLength: 1, maxLength: 128 },
          },
          required: ["idempotency-key"],
        },
      },
    },
    async (request, reply) => {
      const result = app.warranty.evidence.download(
        actor(request),
        String(request.headers["idempotency-key"]),
        request.params.claimId,
        request.params.evidenceId,
      );
      return reply
        .type("application/octet-stream")
        .header(
          "Content-Disposition",
          `attachment; filename="${result.filename}"`,
        )
        .header("X-Content-Type-Options", "nosniff")
        .header("Content-Security-Policy", "sandbox; default-src 'none'")
        .header("x-evidence-media-type", result.receipt.file.mediaType)
        .header("x-document-sha256", result.receipt.file.contentHash)
        .header("x-download-receipt", result.receipt.id)
        .send(result.bytes);
    },
  );
  for (const [name, spec] of Object.entries(commands(app)))
    http.post(
      `/api/commands/${name}`,
      {
        schema: {
          body: spec.schema,
          headers: {
            type: "object",
            properties: {
              "idempotency-key": {
                type: "string",
                minLength: 1,
                maxLength: 128,
              },
            },
            required: ["idempotency-key"],
          },
        },
      },
      async (request, reply) => {
        const result = await spec.run(
          actor(request),
          String(request.headers["idempotency-key"]),
          request.body,
        );
        if (
          result &&
          typeof result === "object" &&
          "sessionEnded" in result &&
          result.sessionEnded === true
        )
          reply.clearCookie("distributor_session", { path: "/" });
        return result;
      },
    );
  const root = options.staticRoot ?? resolve("dist");
  if (existsSync(root)) {
    await http.register(staticFiles, { root, index: "index.html" });
    http.setNotFoundHandler(async (request, reply) =>
      request.url.startsWith("/api/") || request.url.startsWith("/webhooks/")
        ? reply
            .code(404)
            .send({ code: "NOT_FOUND", message: "Route not found." })
        : reply.sendFile("index.html"),
    );
  }
  return http;
}
