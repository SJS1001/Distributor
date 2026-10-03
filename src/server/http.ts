import {
  countQueueStates,
  type CountQueueInput,
} from "../shared/count-queue.ts";
import {
  transferQueueStates,
  type TransferQueueInput,
} from "../shared/transfer-queue.ts";
import {
  stockQueueViews,
  type StockQueueInput,
} from "../shared/stock-queue.ts";
import {
  invoiceQueueStates,
  type InvoiceQueueState,
} from "../shared/invoice-queue.ts";
import {
  purchaseQueueStates,
  type PurchaseQueueState,
} from "../shared/purchase-queue.ts";
import {
  orderQueueStates,
  type OrderQueueState,
} from "../shared/order-queue.ts";
import Fastify from "fastify";
import { providerNames } from "../shared/provider-choices.ts";
import { type FastifyError } from "fastify";
import cookie from "@fastify/cookie";
import type { OrganizationQuickBooksBrowser } from "./organization-quickbooks-browser.ts";
import type { LedgerAuthority } from "./organization-residency.ts";
import type { QuickBooksBrowser } from "./quickbooks-browser.ts";
import type { JournalQueueInput } from "./stock-journal-delivery.ts";
import helmet from "@fastify/helmet";
import staticFiles from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { check, DomainError, permit, type Actor } from "./core.ts";
import { Application } from "./application.ts";
import {
  evidenceMaxBytes,
  evidenceMediaTypes,
  type EvidenceUpload,
} from "../shared/warranty-evidence.ts";
import { type ProviderRuntime } from "./provider-runtime.ts";
import { type CarrierRuntime } from "./carrier-runtime.ts";
import { carrierNames } from "../shared/carrier-booking.ts";
import {
  shipmentQueueStates,
  type ShipmentQueueState,
} from "../shared/shipment-queue.ts";

type Schema = Record<string, unknown>;
const str: Schema = { type: "string", minLength: 1, maxLength: 2000 },
  num: Schema = { type: "integer", minimum: 0, maximum: 1e12 },
  bool: Schema = { type: "boolean" };
const ledgerAuthority = () =>
  obj({
    provider: { const: "quickbooks" },
    purpose: { const: "stock-cost-journal" },
    environment: { const: "sandbox" },
    orgId: str,
    region: choice("CA", "US"),
    realm: { type: "string", pattern: "^[1-9][0-9]{0,29}$" },
    revision: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    disclosureId: str,
    disclosureHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
  });
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
export function commands(
  app: Application,
  carriers?: CarrierRuntime,
): Record<string, Spec> {
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
    "operations.reconciliation.prepare": {
      schema: obj({
        expectedHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
      }),
      run: (a, k, p) => app.prepareReconciliation(a, k, p),
    },
    "canada-post.group.prepare": {
      schema: obj({
        warehouseId: str,
        entries: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: obj({
            bookingId: str,
            reviewHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
          }),
        },
      }),
      run: (a, k, p) => {
        check(
          carriers,
          "CARRIER_DISABLED",
          "Canada Post test processing is disabled.",
          503,
        );
        return carriers.prepareCanadaPostGroup(a, k, p);
      },
    },
    "canada-post.group.cancel": {
      schema: obj({
        groupId: str,
        reviewHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
        reason: str,
      }),
      run: (a, k, p) => app.carriers.cancelCanadaPostGroup(a, k, p),
    },
    "carrier.claim.release": {
      schema: obj({
        target: {
          anyOf: [
            obj({ kind: { const: "booking", type: "string" }, bookingId: str }),
            obj({
              kind: { const: "member", type: "string" },
              groupId: str,
              bookingId: str,
            }),
            obj({ kind: { const: "manifest", type: "string" }, groupId: str }),
          ],
        },
        minimumAgeMs: { type: "integer", minimum: 1, maximum: 86400000 },
        claimHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
        reason: str,
      }),
      run: (a, k, p) => app.carriers.releaseClaim(a, k, p),
    },
    "carrier.prepare": {
      schema: obj(
        {
          configurationHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
          dhl: obj(
            {
              companyNames: obj({
                shipper: { type: "string", minLength: 1, maxLength: 100 },
                receiver: { type: "string", minLength: 1, maxLength: 100 },
              }),
              plannedShippingAt: {
                type: "string",
                pattern:
                  "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}[+-]\\d{2}:\\d{2}$",
              },
              description: { type: "string", minLength: 1, maxLength: 1000 },
              incoterm: choice("DAP", "FCA", "EXW", "CPT", "CIP", "DPU"),
              customs: obj(
                {
                  invoiceType: choice("commercial", "proforma", "returns"),
                  currency: choice("USD", "CAD"),
                  invoiceNumber: {
                    type: "string",
                    minLength: 1,
                    maxLength: 35,
                  },
                  invoiceDate: {
                    type: "string",
                    pattern: "^\\d{4}-\\d{2}-\\d{2}$",
                  },
                  exportReason: choice(
                    "commercial_purpose_or_sale",
                    "return",
                    "warranty_replacement",
                    "sample",
                    "gift",
                    "temporary",
                  ),
                  acknowledgment: {
                    type: "string",
                    minLength: 1,
                    maxLength: 1000,
                  },
                  lines: {
                    type: "array",
                    minItems: 1,
                    maxItems: 100,
                    items: obj({
                      allocationId: str,
                      quantity: { type: "integer", minimum: 1, maximum: 1e9 },
                      description: {
                        type: "string",
                        minLength: 1,
                        maxLength: 512,
                      },
                      unitValueMinor: {
                        type: "integer",
                        minimum: 1,
                        maximum: 1e12,
                      },
                      manufacturerCountry: {
                        type: "string",
                        pattern: "^[A-Z]{2}$",
                      },
                      commodityCode: { type: "string", pattern: "^\\d{6,18}$" },
                      netWeightGrams: {
                        type: "integer",
                        minimum: 1,
                        maximum: 1e6,
                      },
                    }),
                  },
                },
                ["invoiceType"],
              ),
            },
            ["customs", "companyNames"],
          ),
          shipmentId: str,
          replacementId: str,
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
        },
        ["configurationHash", "dhl", "replacementId"],
      ),
      run: (a, k, p) =>
        carriers ? carriers.prepare(a, k, p) : app.carriers.prepare(a, k, p),
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
    "accounting.cost.policy": {
      schema: obj({
        previousRevision: costNumber,
        policyVersion: str,
        mappingVersion: str,
        establishedValuation: str,
        period: { const: "monthly" },
        closedThrough: { anyOf: [str, { type: "null" }] },
        inventoryPostingOwner: { const: "distributor" },
        inventoryAccount: str,
        mappings: {
          type: "array",
          minItems: 1,
          maxItems: 30,
          items: obj({ type: str, offsetAccount: str }),
        },
        financeEvidence: str,
      }),
      run: (a, k, p) => app.integration.costs.corrections.configure(a, k, p),
    },
    "accounting.journal.prepare": {
      schema: obj({
        sourceId: str,
        sourceHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
        leg: choice("original", "reversal", "replacement"),
        postingDate: {
          type: "string",
          pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
        },
        attemptId: { anyOf: [{ ...str, maxLength: 160 }, { type: "null" }] },
        bindingId: { ...str, maxLength: 160 },
        realm: { type: "string", pattern: "^[1-9][0-9]{0,29}$" },
        policyRevision: {
          type: "integer",
          minimum: 1,
          maximum: Number.MAX_SAFE_INTEGER,
        },
        authority: obj({
          provider: { const: "quickbooks" },
          purpose: { const: "stock-cost-journal" },
          environment: { const: "sandbox" },
          orgId: str,
          region: choice("CA", "US"),
          realm: { type: "string", pattern: "^[1-9][0-9]{0,29}$" },
          revision: {
            type: "integer",
            minimum: 1,
            maximum: Number.MAX_SAFE_INTEGER,
          },
          disclosureId: str,
          disclosureHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
        }),
        accounts: {
          type: "array",
          minItems: 1,
          maxItems: 30,
          items: obj({
            sourceAccount: str,
            accountId: { type: "string", pattern: "^[1-9][0-9]{0,29}$" },
          }),
        },
        reason: str,
      }),
      run: (a, k, p) => app.integration.costs.journals.prepare(a, k, p),
    },
    "accounting.journal.decide": {
      schema: obj({
        journalId: str,
        reviewHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
        decision: choice("approve", "reject"),
        reason: str,
      }),
      run: (a, k, p) => app.integration.costs.journals.decide(a, k, p),
    },
    "accounting.journal.permission.prepare": {
      schema: obj({
        journalId: { ...str, maxLength: 160 },
        reviewHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
        previousPermissionHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
        authority: ledgerAuthority(),
        mode: choice("write", "lookup"),
        reason: str,
      }),
      run: (a, k, p) =>
        app.integration.costs.journals.preparePermission(a, k, p),
    },
    "accounting.journal.permission.decide": {
      schema: obj({
        journalId: { ...str, maxLength: 160 },
        permissionReviewId: { ...str, maxLength: 160 },
        permissionReviewHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
        decision: choice("approve", "reject"),
        reason: str,
      }),
      run: (a, k, p) =>
        app.integration.costs.journals.decidePermission(a, k, p),
    },
    "accounting.journal.original-cancellation.evidence": {
      schema: obj({
        journalId: { ...str, maxLength: 160 },
        reviewHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
        requestRef: { type: "string", pattern: "^DJ-[a-f0-9]{18}$" },
        externalRef: { ...str, maxLength: 160 },
        evidence: str,
        cancellationFinal: { const: true },
        nonPostingVerified: { const: true },
        noLaterPosting: { const: true },
      }),
      run: (a, k, p) =>
        app.integration.costs.journals.recordOriginalCancellationEvidence(
          a,
          k,
          p,
        ),
    },
    "accounting.journal.cancel-original": {
      schema: obj({
        journalId: { ...str, maxLength: 160 },
        requestRef: { type: "string", pattern: "^DJ-[a-f0-9]{18}$" },
        evidenceHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
        reason: str,
      }),
      run: (a, k, p) =>
        app.integration.costs.journals.cancelOriginalAttempt(a, k, p),
    },
    "accounting.journal.original-retry.prepare": {
      schema: obj({
        journalId: { ...str, maxLength: 160 },
        reviewHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
        reason: str,
      }),
      run: (a, k, p) =>
        app.integration.costs.journals.prepareOriginalRetry(a, k, p),
    },
    "accounting.journal.cancel-correction": {
      schema: obj({
        journalId: str,
        requestRef: str,
        evidenceHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
        reason: str,
      }),
      run: (a, k, p) =>
        app.integration.costs.journals.cancelCorrectionAttempt(a, k, p),
    },
    "accounting.cost.correction.prepare": {
      schema: obj({
        originalId: str,
        originalHash: str,
        policyRevision: costNumber,
        postingDate: str,
        outcome: choice("posted", "unposted", "unknown"),
        receiverRef: str,
        externalRef: str,
        originalPostingDate: { anyOf: [str, { type: "null" }] },
        outcomeEvidence: str,
        cancellationEvidence: { anyOf: [str, { type: "null" }] },
        priorPeriodEvidence: { anyOf: [str, { type: "null" }] },
        reason: str,
      }),
      run: (a, k, p) => app.integration.costs.corrections.prepare(a, k, p),
    },
    "accounting.cost.correction.retry.prepare": {
      schema: obj({
        correctionId: str,
        contentHash: str,
        leg: choice("reversal", "replacement"),
        previousAttemptId: { anyOf: [str, { type: "null" }] },
        previousRevision: costNumber,
        previousEvidenceHash: str,
        policyRevision: costNumber,
        externalRef: str,
        reason: str,
      }),
      run: (a, k, p) => app.integration.costs.corrections.prepareRetry(a, k, p),
    },
    "accounting.cost.correction.retry.decide": {
      schema: obj({
        retryId: str,
        reviewHash: str,
        decision: choice("approve", "reject"),
        reason: str,
      }),
      run: (a, k, p) => app.integration.costs.corrections.decideRetry(a, k, p),
    },
    "accounting.cost.correction.observe": {
      schema: obj(
        {
          attemptId: str,
          correctionId: str,
          contentHash: str,
          leg: choice("reversal", "replacement"),
          previousRevision: costNumber,
          outcome: choice("posted", "cancelled-unposted", "unknown"),
          receiverRef: str,
          receiverRegion: choice("CA", "US"),
          currency: choice("CAD", "USD"),
          externalRef: str,
          debit: costNumber,
          credit: costNumber,
          postingDate: { anyOf: [str, { type: "null" }] },
          evidence: str,
        },
        ["attemptId"],
      ),
      run: (a, k, p) => app.integration.costs.corrections.observe(a, k, p),
    },
    "accounting.cost.correction.decide": {
      schema: obj({
        correctionId: str,
        reviewHash: str,
        decision: choice("approve", "reject"),
        reason: str,
      }),
      run: (a, k, p) => app.integration.costs.corrections.decide(a, k, p),
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
    "accounting.cost.reconcile-journals": {
      schema: obj({
        packetId: { type: "string", minLength: 1, maxLength: 160 },
        contentHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
        reviewHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
        externalRef: { type: "string", minLength: 1, maxLength: 160 },
        reason: str,
        confirmation: { const: "all-dates-reconciled" },
        journals: {
          type: "array",
          minItems: 1,
          maxItems: 500,
          items: obj({
            journalId: { type: "string", minLength: 1, maxLength: 160 },
            postingDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            externalId: { type: "string", pattern: "^[1-9][0-9]{0,29}$" },
            syncToken: { type: "string", pattern: "^[0-9]{1,2000}$" },
            debit: costNumber,
            credit: costNumber,
            evidenceRef: { type: "string", minLength: 1, maxLength: 1000 },
          }),
        },
      }),
      run: (a, k, p) => app.integration.costs.reconcileJournals(a, k, p),
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
    "organization.ledger-disclosure.publish": {
      schema: obj({
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
      run: (a, k, p) => app.identity.organizationResidency.publish(a, k, p),
    },
    "organization.ledger-disclosure.withdraw": {
      schema: obj({ disclosureId: str, reason: str }),
      run: (a, k, p) =>
        app.identity.organizationResidency.withdrawDisclosure(a, k, p),
    },
    "organization.ledger-residency.choose": {
      schema: obj(
        {
          region: choice("CA", "US"),
          revision: {
            type: "integer",
            minimum: 1,
            maximum: Number.MAX_SAFE_INTEGER - 1,
          },
          mode: choice("strict", "provider-exception"),
          realm: {
            anyOf: [
              { type: "string", pattern: "^[1-9][0-9]{0,39}$" },
              { type: "null" },
            ],
          },
          acknowledgment: str,
          acceptance: obj({
            disclosureId: str,
            disclosureHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
            representative: { ...str, maxLength: 200 },
            evidenceRef: str,
          }),
        },
        ["acceptance"],
      ),
      run: (a, k, p) => app.identity.organizationResidency.choose(a, k, p),
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
    "product.retire": {
      schema: obj({
        productId: str,
        expectedHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
        reason: { type: "string", minLength: 1, maxLength: 1000 },
      }),
      run: (a, k, p) => app.catalog.retire(a, k, p),
    },
    "product.reactivate": {
      schema: obj({
        productId: str,
        expectedHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
        reason: { type: "string", minLength: 1, maxLength: 1000 },
      }),
      run: (a, k, p) => app.catalog.reactivate(a, k, p),
    },
    "product.price": {
      schema: obj({ productId: str, tier: str, unitPrice: num }),
      run: (a, k, p) => app.catalog.setPrice(a, k, p),
    },
    "supplier.create": {
      schema: obj({ name: str }),
      run: (a, k, p) => app.procurement.supplier(a, k, p),
    },
    "supplier.availability": {
      schema: obj({
        supplierId: str,
        revision: { type: "integer", minimum: 0, maximum: 99999998 },
        active: { type: "boolean" },
        reason: { type: "string", minLength: 1, maxLength: 1000 },
      }),
      run: (a, k, p) => app.procurement.supplierAvailability(a, k, p),
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
    "stock.relocate": {
      schema: obj(
        {
          unitId: str,
          revision: num,
          sourceBin: str,
          bin: str,
          serial: { anyOf: [str, { type: "null" }] },
          reason: str,
          quantity: { type: "integer", minimum: 1, maximum: 100000 },
        },
        ["quantity"],
      ),
      run: (a, k, p) => app.inventory.relocate(a, k, p),
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
    "count.policy": {
      schema: obj({
        mode: choice("administrator", "independent"),
        revision: num,
        reason: str,
      }),
      run: (a, k, p) => app.identity.configureCountReview(a, k, p),
    },
    "count.submit": {
      schema: obj({ countId: str, quantity: num, reason: str }),
      run: (a, k, p) => app.inventory.submitCount(a, k, p),
    },
    "count.decide": {
      schema: obj(
        {
          countId: str,
          decision: choice("approve", "reject"),
          reason: str,
          policyRevision: num,
        },
        ["policyRevision"],
      ),
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
    "warranty.policy": {
      schema: obj({ days: num, revision: num, reason: str }),
      run: (a, k, p) => app.identity.configureCoverage(a, k, p),
    },
    "warranty.submit": {
      schema: obj(
        {
          accountId: str,
          unitId: str,
          type: choice("warranty", "return"),
          issue: str,
          evidence: str,
          policyRevision: num,
        },
        ["policyRevision"],
      ),
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
    "quickbooks.credit.cancel": {
      schema: obj({
        effectId: str,
        reviewVersion: str,
        amount: { ...num, minimum: 1 },
        reason: { ...str, maxLength: 1000 },
      }),
      run: (a, k, p) => app.integration.cancelCreditApplication(a, k, p),
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
  quickbooksBrowser?: QuickBooksBrowser;
  organizationQuickbooksBrowser?: OrganizationQuickBooksBrowser;
};
export async function createHttp(app: Application, options: HttpOptions) {
  const origin = new URL(options.origin).origin;
  const http = Fastify({
    logger: options.logger
      ? {
          serializers: {
            // Callback queries and session cookies must never enter request logs.
            req: (request: { method: string; url: string }) => ({
              method: request.method,
              url: request.url.split("?")[0],
            }),
          },
        }
      : false,
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
  http.get<{ Querystring: { after?: string; q?: string; state?: string } }>(
    "/api/catalog/products/page",
    {
      schema: {
        querystring: obj(
          {
            after: { type: "string", minLength: 1, maxLength: 128 },
            q: { type: "string", maxLength: 120 },
            state: choice("active", "retired", "all"),
          },
          ["after", "q", "state"],
        ),
      },
    },
    async (request) =>
      app.catalog.productPage(
        actor(request),
        request.query.after,
        request.query.q,
        request.query.state,
      ),
  );
  http.get<{ Params: { id: string } }>(
    "/api/catalog/products/:id/review",
    async (request) =>
      app.catalog.lifecycleReview(actor(request), request.params.id),
  );
  http.get<{ Params: { id: string }; Querystring: { after?: string } }>(
    "/api/catalog/products/:id/history",
    {
      schema: {
        querystring: obj(
          { after: { type: "string", minLength: 1, maxLength: 128 } },
          ["after"],
        ),
      },
    },
    async (request) =>
      app.catalog.lifecycleHistory(
        actor(request),
        request.params.id,
        request.query.after,
      ),
  );
  http.get<{ Querystring: { accountId: string } }>(
    "/api/catalog/customer-products",
    {
      schema: {
        querystring: obj({
          accountId: { type: "string", minLength: 1, maxLength: 128 },
        }),
      },
    },
    async (request) =>
      app.catalog.customerProducts(actor(request), request.query.accountId),
  );
  http.get<{ Querystring: { accountId: string; after?: string; q?: string } }>(
    "/api/catalog/customer-products/page",
    {
      schema: {
        querystring: obj(
          {
            accountId: { type: "string", minLength: 1, maxLength: 128 },
            after: { type: "string", minLength: 1, maxLength: 128 },
            q: { type: "string", maxLength: 120 },
          },
          ["after", "q"],
        ),
      },
    },
    async (request) =>
      app.catalog.customerProductPage(
        actor(request),
        request.query.accountId,
        request.query.after,
        request.query.q,
      ),
  );
  http.get<{ Querystring: { accountId: string; warehouseId: string } }>(
    "/api/carts/selection",
    {
      schema: {
        querystring: obj({
          accountId: { type: "string", minLength: 1, maxLength: 128 },
          warehouseId: { type: "string", minLength: 1, maxLength: 128 },
        }),
      },
    },
    async (request) =>
      app.orders.orderEntry(
        actor(request),
        request.query.accountId,
        request.query.warehouseId,
      ),
  );
  http.get<{ Querystring: { after?: string; state?: OrderQueueState } }>(
    "/api/orders/page",
    {
      schema: {
        querystring: obj(
          {
            after: { type: "string", minLength: 1, maxLength: 128 },
            state: choice(...orderQueueStates),
          },
          ["after", "state"],
        ),
      },
    },
    async (request) =>
      app.orders.orderPage(
        actor(request),
        request.query.after,
        request.query.state,
      ),
  );

  http.get(
    "/api/organization/ledger-residency",
    { schema: { querystring: obj({}) } },
    async (request) =>
      app.identity.organizationResidency.current(actor(request)),
  );
  http.get<{ Querystring: { after?: string } }>(
    "/api/organization/ledger-residency/history",
    {
      schema: {
        querystring: obj(
          {
            after: {
              type: "string",
              pattern: "^[1-9][0-9]{0,15}$",
            },
          },
          ["after"],
        ),
      },
    },
    async (request) =>
      app.identity.organizationResidency.history(
        actor(request),
        request.query.after === undefined
          ? undefined
          : Number(request.query.after),
      ),
  );
  http.get<{ Params: { disclosureId: string } }>(
    "/api/organization/ledger-disclosures/:disclosureId",
    {
      schema: { params: obj({ disclosureId: str }), querystring: obj({}) },
    },
    async (request) =>
      app.identity.organizationResidency.disclosure(
        actor(request),
        request.params.disclosureId,
      ),
  );

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
  http.get<{
    Querystring: { after?: string; accountId?: string; warehouseId?: string };
  }>(
    "/api/carts/page",
    {
      schema: {
        querystring: obj(
          {
            after: { type: "string", minLength: 1, maxLength: 128 },
            accountId: { type: "string", minLength: 1, maxLength: 128 },
            warehouseId: { type: "string", minLength: 1, maxLength: 128 },
          },
          ["after", "accountId", "warehouseId"],
        ),
      },
    },
    async (request) =>
      app.orders.cartPage(
        actor(request),
        request.query.after,
        request.query.accountId,
        request.query.warehouseId,
      ),
  );
  http.get("/api/carts", async (request) => app.orders.carts(actor(request)));
  http.get("/api/purchases", async (request) => {
    const current = actor(request),
      page = app.procurement.orderPage(current),
      returns = app.procurement.returnPage(current),
      suppliers = app.procurement.supplierPage(current);
    return {
      suppliers: suppliers.items,
      supplierNext: suppliers.next,
      orders: page.items,
      orderNext: page.next,
      receipts: app.procurement.receipts(current),
      returns: returns.items,
      returnNext: returns.next,
      drafts: app.procurement.drafts.list(current),
    };
  });
  http.get<{ Querystring: { q?: string; after?: string } }>(
    "/api/purchases/suppliers/page",
    {
      schema: {
        querystring: obj(
          {
            q: { type: "string", maxLength: 120 },
            after: { type: "string", minLength: 1, maxLength: 1024 },
          },
          ["q", "after"],
        ),
      },
    },
    async (request) =>
      app.procurement.supplierPage(actor(request), request.query),
  );
  http.get<{ Params: { supplierId: string } }>(
    "/api/purchases/suppliers/:supplierId",
    { schema: { params: obj({ supplierId: str }) } },
    async (request) =>
      app.procurement.supplierChoice(actor(request), request.params.supplierId),
  );
  http.get<{ Params: { supplierId: string }; Querystring: { after?: string } }>(
    "/api/purchases/suppliers/:supplierId/availability",
    {
      schema: {
        params: obj({ supplierId: str }),
        querystring: obj(
          { after: { type: "string", pattern: "^[1-9][0-9]{0,8}$" } },
          ["after"],
        ),
      },
    },
    async (request) =>
      app.procurement.supplierAvailabilityReview(
        actor(request),
        request.params.supplierId,
        request.query.after,
      ),
  );
  http.get<{ Querystring: { after?: string; state?: PurchaseQueueState } }>(
    "/api/purchases/orders/page",
    {
      schema: {
        querystring: obj(
          {
            after: { type: "string", minLength: 1, maxLength: 512 },
            state: choice(...purchaseQueueStates),
          },
          ["after", "state"],
        ),
      },
    },
    async (request) => app.procurement.orderPage(actor(request), request.query),
  );
  http.get<{ Params: { orderId: string } }>(
    "/api/purchases/orders/:orderId",
    { schema: { params: obj({ orderId: str }) } },
    async (request) =>
      app.procurement.order(actor(request), request.params.orderId),
  );
  http.get<{ Querystring: { after?: string; q?: string } }>(
    "/api/purchases/returns/page",
    {
      schema: {
        querystring: obj(
          {
            after: { type: "string", minLength: 1, maxLength: 512 },
            q: { type: "string", maxLength: 160 },
          },
          ["after", "q"],
        ),
      },
    },
    async (request) =>
      app.procurement.returnPage(actor(request), request.query),
  );
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
  http.get<{ Querystring: TransferQueueInput }>(
    "/api/transfers/page",
    {
      schema: {
        querystring: obj(
          {
            state: { type: "string", enum: [...transferQueueStates] },
            after: { type: "string", minLength: 1, maxLength: 4096 },
          },
          ["state", "after"],
        ),
      },
    },
    async (request) =>
      app.inventory.transferPage(actor(request), request.query),
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
  http.get<{ Querystring: CountQueueInput }>(
    "/api/counts/page",
    {
      schema: {
        querystring: obj(
          {
            state: { type: "string", enum: [...countQueueStates] },
            after: { type: "string", minLength: 1, maxLength: 4096 },
          },
          ["state", "after"],
        ),
      },
    },
    async (request) => app.inventory.countPage(actor(request), request.query),
  );
  http.get("/api/counts", async (request) =>
    app.inventory.counts(actor(request)),
  );
  http.get("/api/count-review-policy", async (request) =>
    app.identity.countReviewPolicy(actor(request)),
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
  http.get<{
    Querystring: { unitId?: string; serial?: string; after?: string };
  }>(
    "/api/stock/history",
    {
      schema: {
        querystring: obj(
          {
            unitId: { type: "string", minLength: 1, maxLength: 128 },
            serial: { type: "string", minLength: 1, maxLength: 160 },
            after: { type: "string", minLength: 1, maxLength: 4096 },
          },
          ["unitId", "serial", "after"],
        ),
      },
    },
    async (request) =>
      app.inventory.movementPage(actor(request), request.query),
  );
  http.get<{ Params: { serial: string } }>(
    "/api/serials/:serial",
    async (request) =>
      app.inventory.trace(actor(request), request.params.serial),
  );
  http.get<{
    Querystring: {
      serial: string;
      movementAfter?: string;
      shipmentAfter?: string;
      claimAfter?: string;
    };
  }>(
    "/api/serials/dossier",
    {
      schema: {
        querystring: obj(
          {
            serial: { type: "string", minLength: 1, maxLength: 160 },
            movementAfter: { type: "string", minLength: 1, maxLength: 4096 },
            shipmentAfter: { type: "string", minLength: 1, maxLength: 4096 },
            claimAfter: { type: "string", minLength: 1, maxLength: 4096 },
          },
          ["movementAfter", "shipmentAfter", "claimAfter"],
        ),
      },
    },
    async (request) => app.serialDossier(actor(request), request.query),
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
  http.get<{ Querystring: import("../shared/claim-queue.ts").ClaimQueueQuery }>(
    "/api/warranty/claims/page",
    {
      schema: {
        querystring: obj(
          {
            state: choice(
              "submitted",
              "approved",
              "rejected",
              "received",
              "inspected",
              "repair",
              "disposed",
            ),
            after: { type: "string", minLength: 1, maxLength: 512 },
          },
          ["state", "after"],
        ),
      },
    },
    async (request) => app.warranty.claimPage(actor(request), request.query),
  );
  http.get(
    "/api/warranty/coverage-policy",
    { schema: { querystring: obj({}) } },
    async (request) =>
      app.database.transaction(() => {
        const current = app.identity.currentActor(actor(request)),
          policy = app.identity.coveragePolicy(current);
        return current.role === "admin"
          ? policy
          : {
              revision: policy.revision,
              days: policy.days,
              configuredAt: policy.configuredAt,
            };
      }),
  );
  http.get<{ Params: { claimId: string } }>(
    "/api/warranty/claims/:claimId/coverage",
    {
      schema: { params: obj({ claimId: str }), querystring: obj({}) },
    },
    async (request) =>
      app.warranty.claimCoverage(actor(request), request.params.claimId),
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
  http.get<{ Querystring: StockQueueInput }>(
    "/api/stock/page",
    {
      schema: {
        querystring: obj(
          {
            after: { type: "string", minLength: 1, maxLength: 4096 },
            query: { type: "string", maxLength: 100 },
            productId: { type: "string", minLength: 1, maxLength: 128 },
            warehouseId: { type: "string", minLength: 1, maxLength: 128 },
            view: choice(...stockQueueViews),
          },
          ["after", "query", "productId", "warehouseId", "view"],
        ),
      },
    },
    async (request) => app.inventory.stockPage(actor(request), request.query),
  );
  http.get<{
    Params: { claimId: string };
    Querystring: { after?: string; query?: string };
  }>(
    "/api/warranty/claims/:claimId/replacement-candidates",
    {
      schema: {
        params: obj({ claimId: str }),
        querystring: obj(
          {
            after: { type: "string", minLength: 1, maxLength: 4096 },
            query: { type: "string", maxLength: 100 },
          },
          ["after", "query"],
        ),
      },
    },
    async (request) =>
      app.warranty.replacementCandidatePage(
        actor(request),
        request.params.claimId,
        request.query,
      ),
  );
  http.get("/api/stock/labels", async (request) =>
    app.labels.downloads(actor(request)),
  );
  http.post<{
    Params: { unitId: string };
    Body: {
      revision: number;
      copies: number;
      output?: "pdf" | "zpl-8" | "zpl-12";
    };
  }>(
    "/api/stock/:unitId/label",
    {
      schema: {
        params: obj({ unitId: str }),
        body: obj(
          {
            revision: { type: "integer", minimum: 1, maximum: 1000000000 },
            copies: { type: "integer", minimum: 1, maximum: 20 },
            output: { type: "string", enum: ["pdf", "zpl-8", "zpl-12"] },
          },
          ["output"],
        ),
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
        .type(
          request.body.output?.startsWith("zpl-")
            ? "application/octet-stream"
            : "application/pdf",
        )
        .header(
          "Content-Disposition",
          `attachment; filename="${result.receipt.filename}"`,
        )
        .header("x-document-sha256", result.receipt.contentHash)
        .header("x-download-receipt", result.receipt.id)
        .send(result.bytes);
    },
  );
  http.get<{ Querystring: { after?: string; state?: InvoiceQueueState } }>(
    "/api/billing/invoices/page",
    {
      schema: {
        querystring: obj(
          {
            after: { type: "string", minLength: 1, maxLength: 512 },
            state: choice(...invoiceQueueStates),
          },
          ["after", "state"],
        ),
      },
    },
    async (request) => app.billing.invoicePage(actor(request), request.query),
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
  http.get<{ Querystring: { after?: string; state?: ShipmentQueueState } }>(
    "/api/shipments/page",
    {
      schema: {
        querystring: obj(
          {
            after: { type: "string", minLength: 1, maxLength: 128 },
            state: choice(...shipmentQueueStates),
          },
          ["after", "state"],
        ),
      },
    },
    async (request) =>
      app.fulfillment.shipmentPage(
        actor(request),
        request.query.after,
        request.query.state,
      ),
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
        configurations:
          options.carriers?.configurations(
            actor(request),
            current.warehouseId,
          ) ?? [],
        enabled: current.booking
          ? (options.carriers?.enabled(
              actor(request),
              current.booking.provider,
              current.warehouseId,
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
  http.get<{ Params: { replacementId: string } }>(
    "/api/warranty/replacements/:replacementId/carrier",
    { schema: { params: obj({ replacementId: str }), querystring: obj({}) } },
    async (request) => {
      const current = app.carriers.reviewReplacement(
        actor(request),
        request.params.replacementId,
      );
      return {
        ...current,
        configurations:
          options.carriers?.configurations(
            actor(request),
            current.warehouseId,
          ) ?? [],
        enabled: current.booking
          ? (options.carriers?.enabled(
              actor(request),
              current.booking.provider,
              current.warehouseId,
            ) ?? false)
          : false,
      };
    },
  );
  http.get<{
    Params: { replacementId: string };
    Querystring: { after?: string };
  }>(
    "/api/warranty/replacements/:replacementId/carrier/history",
    {
      schema: {
        params: obj({ replacementId: str }),
        querystring: obj(
          { after: { type: "string", minLength: 1, maxLength: 128 } },
          ["after"],
        ),
      },
    },
    async (request) =>
      app.carriers.historyReplacement(
        actor(request),
        request.params.replacementId,
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
  http.get<{
    Params: { warehouseId: string };
    Querystring: { after?: string };
  }>(
    "/api/warehouses/:warehouseId/canada-post/candidates",
    {
      schema: {
        params: obj({ warehouseId: str }),
        querystring: obj(
          { after: { type: "string", minLength: 1, maxLength: 128 } },
          ["after"],
        ),
      },
    },
    async (request) => {
      const current = actor(request);
      const page = app.carriers.canadaPostCandidates(
        current,
        request.params.warehouseId,
        request.query.after,
      );
      app.inventory.warehouse(current, request.params.warehouseId);
      return {
        ...page,
        enabled:
          options.carriers?.canadaPostEnabled(
            current,
            request.params.warehouseId,
          ) ?? false,
      };
    },
  );
  http.get<{
    Params: { warehouseId: string };
    Querystring: { after?: string };
  }>(
    "/api/warehouses/:warehouseId/canada-post/groups",
    {
      schema: {
        params: obj({ warehouseId: str }),
        querystring: obj(
          { after: { type: "string", minLength: 1, maxLength: 128 } },
          ["after"],
        ),
      },
    },
    async (request) => {
      const current = actor(request);
      const page = app.carriers.canadaPostGroups(
        current,
        request.params.warehouseId,
        request.query.after,
      );
      return {
        ...page,
        enabled:
          options.carriers?.canadaPostEnabled(
            current,
            request.params.warehouseId,
          ) ?? false,
      };
    },
  );
  http.get<{ Params: { bookingId: string } }>(
    "/api/carrier/:bookingId/canada-post/group",
    { schema: { params: obj({ bookingId: str }), querystring: obj({}) } },
    async (request) =>
      app.carriers.canadaPostGroupForBooking(
        actor(request),
        request.params.bookingId,
      ),
  );
  const claimAgeQuery = obj({
    minimumAgeMs: { type: "string", pattern: "^[1-9][0-9]{0,7}$" },
  });
  http.get<{
    Params: { bookingId: string };
    Querystring: { minimumAgeMs: string };
  }>(
    "/api/carrier/:bookingId/claim",
    { schema: { params: obj({ bookingId: str }), querystring: claimAgeQuery } },
    async (request) =>
      app.carriers.reviewClaim(
        actor(request),
        { kind: "booking", bookingId: request.params.bookingId },
        Number(request.query.minimumAgeMs),
      ),
  );
  http.get<{
    Params: { groupId: string; bookingId: string };
    Querystring: { minimumAgeMs: string };
  }>(
    "/api/canada-post/groups/:groupId/members/:bookingId/claim",
    {
      schema: {
        params: obj({ groupId: str, bookingId: str }),
        querystring: claimAgeQuery,
      },
    },
    async (request) =>
      app.carriers.reviewClaim(
        actor(request),
        { kind: "member", ...request.params },
        Number(request.query.minimumAgeMs),
      ),
  );
  http.get<{
    Params: { groupId: string };
    Querystring: { minimumAgeMs: string };
  }>(
    "/api/canada-post/groups/:groupId/manifest/claim",
    { schema: { params: obj({ groupId: str }), querystring: claimAgeQuery } },
    async (request) =>
      app.carriers.reviewClaim(
        actor(request),
        { kind: "manifest", groupId: request.params.groupId },
        Number(request.query.minimumAgeMs),
      ),
  );
  http.get<{ Params: { groupId: string } }>(
    "/api/canada-post/groups/:groupId",
    { schema: { params: obj({ groupId: str }), querystring: obj({}) } },
    async (request) =>
      app.carriers.reviewCanadaPostGroup(
        actor(request),
        request.params.groupId,
      ),
  );
  http.get<{ Params: { groupId: string } }>(
    "/api/canada-post/groups/:groupId/bookings",
    { schema: { params: obj({ groupId: str }), querystring: obj({}) } },
    async (request) =>
      app.carriers.canadaPostGroupBookings(
        actor(request),
        request.params.groupId,
      ),
  );
  http.get<{ Params: { groupId: string } }>(
    "/api/canada-post/groups/:groupId/manifest/review",
    { schema: { params: obj({ groupId: str }), querystring: obj({}) } },
    async (request) => {
      check(
        options.carriers,
        "CARRIER_DISABLED",
        "Canada Post test processing is disabled.",
        503,
      );
      return options.carriers.reviewCanadaPostManifest(
        actor(request),
        request.params.groupId,
      );
    },
  );
  for (const action of ["create", "reconcile"] as const)
    http.post<{ Params: { groupId: string; bookingId: string } }>(
      `/api/canada-post/groups/:groupId/members/:bookingId/${action}`,
      {
        schema: {
          params: obj({ groupId: str, bookingId: str }),
          body: obj({}),
          querystring: obj({}),
        },
      },
      async (request) => {
        check(
          options.carriers,
          "CARRIER_DISABLED",
          "Canada Post test processing is disabled.",
          503,
        );
        return action === "create"
          ? options.carriers.createCanadaPostMember(
              actor(request),
              request.params.groupId,
              request.params.bookingId,
            )
          : options.carriers.reconcileCanadaPostMember(
              actor(request),
              request.params.groupId,
              request.params.bookingId,
            );
      },
    );
  for (const action of ["transmit", "reconcile"] as const)
    http.post<{ Params: { groupId: string }; Body: { reviewHash: string } }>(
      `/api/canada-post/groups/:groupId/manifest/${action}`,
      {
        schema: {
          params: obj({ groupId: str }),
          body: obj({
            reviewHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
          }),
          querystring: obj({}),
        },
      },
      async (request) => {
        check(
          options.carriers,
          "CARRIER_DISABLED",
          "Canada Post test processing is disabled.",
          503,
        );
        return action === "transmit"
          ? options.carriers.transmitCanadaPostManifest(
              actor(request),
              request.params.groupId,
              request.body.reviewHash,
            )
          : options.carriers.reconcileCanadaPostManifest(
              actor(request),
              request.params.groupId,
              request.body.reviewHash,
            );
      },
    );
  http.get<{ Params: { groupId: string } }>(
    "/api/canada-post/groups/:groupId/manifest/document",
    { schema: { params: obj({ groupId: str }), querystring: obj({}) } },
    async (request, reply) => {
      const document = app.carriers.canadaPostManifestDocument(
        actor(request),
        request.params.groupId,
      );
      return reply
        .header("Content-Type", "application/octet-stream")
        .header(
          "Content-Disposition",
          'attachment; filename="canada-post-manifest.pdf"',
        )
        .header("Cache-Control", "no-store")
        .header("X-Document-Sha256", document.hash)
        .header("X-Document-Media-Type", document.mediaType)
        .send(document.bytes);
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
  http.get("/api/operations/health", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    return app.operationsHealth(actor(request));
  });
  http.get("/api/operations/reconciliation", async (request) =>
    app.reconciliation(actor(request)),
  );
  http.get<{ Querystring: { after?: string } }>(
    "/api/operations/reconciliation/history",
    {
      schema: {
        querystring: obj(
          { after: { type: "string", minLength: 1, maxLength: 128 } },
          ["after"],
        ),
      },
    },
    async (request) =>
      app.platform.reconciliationHistory(actor(request), request.query.after),
  );
  http.get<{ Params: { receiptId: string } }>(
    "/api/operations/reconciliation/:receiptId/document",
    {
      schema: {
        params: obj({
          receiptId: { type: "string", minLength: 1, maxLength: 128 },
        }),
      },
    },
    async (request, reply) => {
      const receipt = app.platform.reconciliationDocument(
        actor(request),
        request.params.receiptId,
      );
      return reply
        .type("application/octet-stream")
        .header("x-document-media-type", "application/json")
        .header(
          "Content-Disposition",
          `attachment; filename="${receipt.filename}"`,
        )
        .header("x-document-sha256", receipt.contentHash)
        .header("x-download-receipt", receipt.id)
        .send(Buffer.from(receipt.content));
    },
  );
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
    "/api/accounting/costs/:packetId/journal-reconciliation",
    { schema: { params: obj({ packetId: str }), querystring: obj({}) } },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      return app.integration.costs.journalReconciliation(
        actor(request),
        request.params.packetId,
      );
    },
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
  http.get("/api/accounting/cost-policy", async (request) =>
    app.integration.costs.corrections.policy(actor(request)),
  );
  http.get<{
    Params: { sourceId: string };
    Querystring: {
      leg: "original" | "reversal" | "replacement";
      postingDate?: string;
    };
  }>(
    "/api/accounting/journal-sources/:sourceId",
    {
      schema: {
        params: obj({ sourceId: { ...str, maxLength: 160 } }),
        querystring: obj(
          {
            leg: choice("original", "reversal", "replacement"),
            postingDate: {
              type: "string",
              pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
            },
          },
          ["postingDate"],
        ),
      },
    },
    (request, reply) => {
      reply.header("Cache-Control", "no-store");
      return app.integration.costs.journals.preparationReview(
        actor(request),
        request.params.sourceId,
        request.query,
      );
    },
  );
  http.get<{ Params: { key: string } }>(
    "/api/accounting/journal-preparations/:key/receipt",
    {
      schema: {
        params: obj({ key: { ...str, maxLength: 128 } }),
        querystring: obj({}),
      },
    },
    (request, reply) => {
      reply.header("Cache-Control", "no-store");
      return app.integration.costs.journals.preparationReceipt(
        actor(request),
        request.params.key,
      );
    },
  );
  http.get<{ Querystring: JournalQueueInput }>(
    "/api/accounting/journals",
    {
      schema: {
        querystring: obj(
          {
            sourceId: { ...str, maxLength: 160 },
            state: choice(
              "ready",
              "rejected",
              "pending",
              "running",
              "unknown",
              "posted",
              "cancelled",
            ),
            after: { type: "string", pattern: "^[A-Za-z0-9_-]{1,512}$" },
          },
          ["sourceId", "state", "after"],
        ),
      },
    },
    (request, reply) => {
      reply.header("Cache-Control", "no-store");
      return app.integration.costs.journals.queue(
        actor(request),
        request.query,
      );
    },
  );
  http.get<{ Params: { journalId: string } }>(
    "/api/accounting/journals/:journalId",
    { schema: { params: obj({ journalId: str }), querystring: obj({}) } },
    (request, reply) => {
      reply.header("Cache-Control", "no-store");
      return app.integration.costs.journals.detail(
        actor(request),
        request.params.journalId,
      );
    },
  );
  http.get<{ Params: { journalId: string } }>(
    "/api/accounting/journals/:journalId/permission-review",
    { schema: { params: obj({ journalId: str }), querystring: obj({}) } },
    (request, reply) => {
      reply.header("Cache-Control", "no-store");
      return app.integration.costs.journals.permissionReview(
        actor(request),
        request.params.journalId,
      );
    },
  );
  http.get<{
    Params: { journalId: string };
    Querystring: { reviewId?: string };
  }>(
    "/api/accounting/journals/:journalId/permissions",
    {
      schema: {
        params: obj({ journalId: str }),
        querystring: obj({ reviewId: { ...str, maxLength: 160 } }, [
          "reviewId",
        ]),
      },
    },
    (request, reply) => {
      reply.header("Cache-Control", "no-store");
      return app.integration.costs.journals.permissionHistory(
        actor(request),
        request.params.journalId,
        request.query.reviewId,
      );
    },
  );
  http.get<{ Params: { journalId: string } }>(
    "/api/accounting/journals/:journalId/original-cancellation-evidence-review",
    { schema: { params: obj({ journalId: str }), querystring: obj({}) } },
    (request, reply) => {
      reply.header("Cache-Control", "no-store");
      return app.integration.costs.journals.originalCancellationEvidenceReview(
        actor(request),
        request.params.journalId,
      );
    },
  );
  http.get<{ Params: { journalId: string } }>(
    "/api/accounting/journals/:journalId/original-cancellation-review",
    { schema: { params: obj({ journalId: str }), querystring: obj({}) } },
    (request, reply) => {
      reply.header("Cache-Control", "no-store");
      return app.integration.costs.journals.originalCancellationReview(
        actor(request),
        request.params.journalId,
      );
    },
  );
  http.get<{ Params: { journalId: string } }>(
    "/api/accounting/journals/:journalId/original-retry-review",
    { schema: { params: obj({ journalId: str }), querystring: obj({}) } },
    (request, reply) => {
      reply.header("Cache-Control", "no-store");
      return app.integration.costs.journals.originalRetryReview(
        actor(request),
        request.params.journalId,
      );
    },
  );
  http.get<{ Params: { journalId: string } }>(
    "/api/accounting/journals/:journalId/cancellation-review",
    { schema: { params: obj({ journalId: str }), querystring: obj({}) } },
    (request, reply) => {
      reply.header("Cache-Control", "no-store");
      return app.integration.costs.journals.cancellationReview(
        actor(request),
        request.params.journalId,
      );
    },
  );
  http.get<{ Params: { journalId: string }; Querystring: { after?: string } }>(
    "/api/accounting/journals/:journalId/observations",
    {
      schema: {
        params: obj({ journalId: str }),
        querystring: obj(
          { after: { type: "string", pattern: "^[A-Za-z0-9_-]{1,512}$" } },
          ["after"],
        ),
      },
    },
    (request, reply) => {
      reply.header("Cache-Control", "no-store");
      return app.integration.costs.journals.observations(
        actor(request),
        request.params.journalId,
        request.query,
      );
    },
  );
  http.get<{ Params: { packetId: string } }>(
    "/api/accounting/costs/:packetId/corrections",
    { schema: { params: obj({ packetId: str }) } },
    async (request) =>
      app.integration.costs.corrections.list(
        actor(request),
        request.params.packetId,
      ),
  );
  http.get<{ Params: { retryId: string } }>(
    "/api/accounting/cost-correction-retries/:retryId",
    { schema: { params: obj({ retryId: str }) } },
    (request, reply) => {
      reply.header("Cache-Control", "no-store");
      return app.integration.costs.corrections.retryDetail(
        actor(request),
        request.params.retryId,
      );
    },
  );
  http.get<{ Params: { correctionId: string } }>(
    "/api/accounting/cost-corrections/:correctionId",
    { schema: { params: obj({ correctionId: str }) } },
    async (request) =>
      app.integration.costs.corrections.detail(
        actor(request),
        request.params.correctionId,
      ),
  );
  http.get<{ Params: { correctionId: string } }>(
    "/api/accounting/cost-corrections/:correctionId/outcomes",
    { schema: { params: obj({ correctionId: str }) } },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      return app.integration.costs.corrections.outcomes(
        actor(request),
        request.params.correctionId,
      );
    },
  );
  http.get<{ Params: { correctionId: string } }>(
    "/api/accounting/cost-corrections/:correctionId/file",
    { schema: { params: obj({ correctionId: str }) } },
    async (request, reply) => {
      const file = app.integration.costs.corrections.download(
        actor(request),
        request.params.correctionId,
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
  for (const [name, spec] of Object.entries(commands(app, options.carriers)))
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
  const authorization = () => {
    check(
      options.quickbooksBrowser,
      "PROVIDER_DISABLED",
      "QuickBooks browser authorization is disabled.",
      503,
    );
    return options.quickbooksBrowser;
  };
  http.get("/api/quickbooks/authorization", async (request) => {
    permit(app.identity.currentActor(actor(request)), ["finance"]);
    return options.quickbooksBrowser
      ? authorization().status(request.cookies.distributor_session!)
      : { enabled: false };
  });
  http.post<{ Body: { revision: number } }>(
    "/api/quickbooks/authorization/begin",
    {
      schema: {
        body: obj({
          revision: { type: "integer", minimum: 0, maximum: 1000000000 },
        }),
      },
    },
    async (request) =>
      authorization().begin(
        request.cookies.distributor_session!,
        request.body.revision,
      ),
  );
  http.post<{ Body: { attemptId: string } }>(
    "/api/quickbooks/authorization/cancel",
    {
      schema: {
        body: obj({
          attemptId: { type: "string", minLength: 1, maxLength: 128 },
        }),
      },
    },
    async (request) =>
      authorization().cancel(
        request.cookies.distributor_session!,
        request.body.attemptId,
      ),
  );
  http.post<{ Body: { revision: number } }>(
    "/api/quickbooks/authorization/disconnect",
    {
      schema: {
        body: obj({
          revision: { type: "integer", minimum: 0, maximum: 1000000000 },
        }),
      },
    },
    async (request) =>
      authorization().disconnect(
        request.cookies.distributor_session!,
        request.body.revision,
      ),
  );
  http.post<{ Body: { attemptId: string; callbackUrl: string } }>(
    "/api/quickbooks/authorization/complete",
    {
      schema: {
        body: obj({
          attemptId: { type: "string", minLength: 1, maxLength: 128 },
          callbackUrl: { type: "string", minLength: 1, maxLength: 16384 },
        }),
      },
    },
    async (request) =>
      authorization().complete(
        request.cookies.distributor_session!,
        request.body.attemptId,
        request.body.callbackUrl,
      ),
  );
  const organizationAuthorization = () => {
    check(
      options.organizationQuickbooksBrowser,
      "PROVIDER_DISABLED",
      "Organization QuickBooks browser authorization is disabled.",
      503,
    );
    return options.organizationQuickbooksBrowser;
  };
  http.post<{
    Body: { receiptId: string; revision: number; authority: LedgerAuthority };
  }>(
    "/api/quickbooks/organization/revocation",
    {
      bodyLimit: 32768,
      schema: {
        body: obj({
          receiptId: { type: "string", minLength: 1, maxLength: 128 },
          revision: {
            type: "integer",
            minimum: 1,
            maximum: Number.MAX_SAFE_INTEGER - 1,
          },
          authority: ledgerAuthority(),
        }),
      },
    },
    async (request) =>
      organizationAuthorization().revoke(
        request.cookies.distributor_session!,
        request.body.receiptId,
        request.body.revision,
        request.body.authority,
      ),
  );
  http.get<{ Querystring: { receiptId: string } }>(
    "/api/quickbooks/organization/revocation",
    {
      schema: {
        querystring: obj({
          receiptId: { type: "string", minLength: 1, maxLength: 128 },
        }),
      },
    },
    async (request) =>
      organizationAuthorization().revocationStatus(
        request.cookies.distributor_session!,
        request.query.receiptId,
      ),
  );
  http.post<{
    Body: {
      receiptId: string;
      revision: number;
      resolution: "provider-confirmed" | "provider-unconfirmed";
      evidence: string;
    };
  }>(
    "/api/quickbooks/organization/revocation/review",
    {
      bodyLimit: 32768,
      schema: {
        body: obj({
          receiptId: { type: "string", minLength: 1, maxLength: 128 },
          revision: {
            type: "integer",
            minimum: 1,
            maximum: Number.MAX_SAFE_INTEGER - 1,
          },
          resolution: choice("provider-confirmed", "provider-unconfirmed"),
          evidence: { type: "string", minLength: 1, maxLength: 2000 },
        }),
      },
    },
    async (request) =>
      organizationAuthorization().reviewRevocation(
        request.cookies.distributor_session!,
        request.body.receiptId,
        request.body.revision,
        request.body.resolution,
        request.body.evidence,
      ),
  );
  http.get("/api/quickbooks/organization/authorization", async (request) => {
    const principal = app.identity.currentActor(actor(request));
    permit(principal, ["finance"]);
    check(
      !principal.accountId,
      "FORBIDDEN",
      "Organization authorization requires unbound finance authority.",
      403,
    );
    return options.organizationQuickbooksBrowser
      ? organizationAuthorization().status(request.cookies.distributor_session!)
      : { enabled: false };
  });
  http.post<{ Body: { revision: number; authority: LedgerAuthority } }>(
    "/api/quickbooks/organization/authorization/begin",
    {
      schema: {
        body: obj({
          revision: { type: "integer", minimum: 0, maximum: 1000000000 },
          authority: ledgerAuthority(),
        }),
      },
    },
    async (request) =>
      organizationAuthorization().begin(
        request.cookies.distributor_session!,
        request.body.revision,
        request.body.authority,
      ),
  );
  http.post<{ Body: { attemptId: string } }>(
    "/api/quickbooks/organization/authorization/cancel",
    {
      schema: {
        body: obj({
          attemptId: { type: "string", minLength: 1, maxLength: 128 },
        }),
      },
    },
    async (request) =>
      organizationAuthorization().cancel(
        request.cookies.distributor_session!,
        request.body.attemptId,
      ),
  );
  http.post<{ Body: { attemptId: string; callbackUrl: string } }>(
    "/api/quickbooks/organization/authorization/complete",
    {
      schema: {
        body: obj({
          attemptId: { type: "string", minLength: 1, maxLength: 128 },
          callbackUrl: { type: "string", minLength: 1, maxLength: 16384 },
        }),
      },
    },
    async (request) =>
      organizationAuthorization().complete(
        request.cookies.distributor_session!,
        request.body.attemptId,
        request.body.callbackUrl,
      ),
  );
  http.post<{ Body: { revision: number } }>(
    "/api/quickbooks/organization/authorization/disconnect",
    {
      schema: {
        body: obj({
          revision: { type: "integer", minimum: 0, maximum: 1000000000 },
        }),
      },
    },
    async (request) =>
      organizationAuthorization().disconnect(
        request.cookies.distributor_session!,
        request.body.revision,
      ),
  );
  // Cross-site landing only serves the dedicated UI; completion remains an
  // explicit same-origin CSRF POST bound to the original live login.
  http.get("/quickbooks/organization/callback", async (_request, reply) => {
    reply.header("Referrer-Policy", "no-referrer");
    if (!options.organizationQuickbooksBrowser || !existsSync(root))
      return reply.code(503).send({
        code: "UNAVAILABLE",
        message: "Organization browser connection is unavailable.",
      });
    reply.header("Cache-Control", "no-store");
    return reply.sendFile("index.html", { cacheControl: false });
  });
  // The cross-site GET performs no exchange. The page removes the query before
  // an explicit authenticated same-origin POST; Strict cookies remain Strict.
  http.get("/quickbooks/callback", async (_request, reply) => {
    reply.header("Referrer-Policy", "no-referrer");
    if (!existsSync(root))
      return reply.code(503).send({
        code: "UNAVAILABLE",
        message: "Build the browser application before connecting QuickBooks.",
      });
    reply.header("Cache-Control", "no-store");
    return reply.sendFile("index.html", { cacheControl: false });
  });
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
