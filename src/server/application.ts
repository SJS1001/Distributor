import { PlatformOfflineRefundReviewReader } from "./platform-offline-refund-review.ts";
import { PlatformOfflineCarrierReviewReader } from "./platform-offline-carrier-review.ts";
import { RestoreOfflineNativePhase } from "./restore-offline-native-phase.ts";
import { RestoreOfflineCommitRecoveryReader } from "./restore-offline-commit-recovery.ts";
import { CarrierOfflineMemberReview } from "./carrier-offline-member-review.ts";
import type { RestoreNativeDispositionConfiguration } from "./restore-activation.ts";
import { salesControls } from "./sales-controls.ts";
import { validateMfaPolicy } from "./mfa-policy.ts";
import { check, permit, now, type Actor, type Role } from "./core.ts";
import { reconciliationHash } from "./reconciliation-receipt.ts";
import { Database } from "./database.ts";
import { Platform } from "./platform.ts";
import { Identity, type Region } from "./iam.ts";
import { Catalog } from "./catalog.ts";
import { StockLabels } from "./stock-labels.ts";
import { Inventory } from "./inventory.ts";
import { Procurement } from "./procurement.ts";
import { Billing } from "./billing.ts";
import { Orders } from "./orders.ts";
import { Fulfillment } from "./fulfillment.ts";
import { CarrierBookings } from "./carrier-bookings.ts";
import { Warranty } from "./warranty.ts";
import { Integration } from "./integration.ts";
import { ProviderCredentials } from "./provider-credentials.ts";
import { Migration } from "./migration.ts";
import { EventDelivery } from "./event-delivery.ts";
import { EventReport } from "./event-report.ts";
import type { OperationsHealth } from "../shared/operations-health.ts";
import type {
  SerialDossier,
  SerialDossierInput,
} from "../shared/serial-dossier.ts";

export class Application {
  database: Database;
  platform!: Platform;
  platformOfflineRefundReview!: PlatformOfflineRefundReviewReader;
  platformOfflineCarrierReview!: PlatformOfflineCarrierReviewReader;
  restoreOfflineNativePhase!: RestoreOfflineNativePhase;
  restoreOfflineCommitRecovery!: RestoreOfflineCommitRecoveryReader;
  carrierOfflineMemberReview!: CarrierOfflineMemberReview;
  identity!: Identity;
  catalog!: Catalog;
  inventory!: Inventory;
  labels!: StockLabels;
  procurement!: Procurement;
  billing!: Billing;
  orders!: Orders;
  fulfillment!: Fulfillment;
  carriers!: CarrierBookings;
  warranty!: Warranty;
  integration!: Integration;
  migration!: Migration;
  providerCredentials!: ProviderCredentials;
  eventDelivery!: EventDelivery;
  serialDossier(actor: Actor, input: SerialDossierInput): SerialDossier {
    return this.database.transaction(() => {
      actor = this.identity.currentActor(actor);
      permit(actor, ["warehouse", "commercial", "finance", "warranty"]);
      const movements = this.inventory.stockHistoryEvidence(actor, {
        serial: input.serial,
        after: input.movementAfter,
      });
      const unitId = movements.unit.id;
      const shipments = this.fulfillment.serialShipments(
        actor,
        unitId,
        input.shipmentAfter,
      );
      return {
        movements,
        receipt: this.procurement.serialReceipt(actor, unitId),
        shipments: {
          ...shipments,
          items: shipments.items.map((shipment) => {
            const invoice = shipment.invoiceId
              ? this.billing.invoice(actor, shipment.invoiceId)
              : null;
            check(
              !invoice ||
                (invoice.shipment_id === shipment.id &&
                  invoice.order_id === shipment.orderId &&
                  invoice.account_id === shipment.accountId),
              "SERIAL_LINEAGE",
              "Shipment and invoice lineage differ.",
              409,
            );
            return {
              ...shipment,
              invoice: invoice
                ? {
                    id: invoice.id,
                    number: invoice.number,
                    currency: invoice.currency,
                    total: invoice.total,
                    createdAt: invoice.created_at,
                  }
                : null,
            };
          }),
        },
        claims: this.warranty.serialClaims(actor, unitId, input.claimAfter),
      };
    });
  }
  /** Explicit trusted host composition; no tenant/dossier or environment switch. */
  configureRestoreNativeDispositions(
    configuration?: RestoreNativeDispositionConfiguration,
  ) {
    this.platform.restore.configureNativeDispositions(configuration);
  }
  constructor(
    path: string,
    region: Region = "CA",
    security: {
      mfaEncryptionKey?: string;
      mfaRequiredRoles?: readonly Role[];
      providerEncryptionKey?: string;
      eventReports?: boolean;
      /** Operator inspection must preserve an already captured candidate.
       * Normal services retain startup housekeeping; expiry checks at use remain. */
      startupMaintenance?: boolean;
    } = {},
  ) {
    check(
      ["CA", "US"].includes(region),
      "REGION",
      "Runtime residency region must be CA or US.",
      500,
    );
    const mfaRoles = validateMfaPolicy(
      security.mfaRequiredRoles ?? [],
      security.mfaEncryptionKey,
    );
    this.database = new Database(path);
    try {
      this.database.initializeSchema(
        region,
        security.eventReports !== false,
        () => {
          this.platform = new Platform(
            this.database,
            security.startupMaintenance !== false,
          );
          this.restoreOfflineNativePhase = new RestoreOfflineNativePhase(
            this.database,
            this.platform,
          );
          this.identity = new Identity(
            this.database,
            this.platform,
            region,
            (actor, sites) => {
              for (const siteId of sites)
                this.inventory.warehouse(actor, siteId);
            },
            security.mfaEncryptionKey,
            mfaRoles,
            security.startupMaintenance !== false,
          );
          this.platformOfflineRefundReview =
            new PlatformOfflineRefundReviewReader(this.database, this.identity);
          this.restoreOfflineCommitRecovery =
            new RestoreOfflineCommitRecoveryReader(
              this.database,
              this.platform,
              this.identity,
            );
          this.platformOfflineCarrierReview =
            new PlatformOfflineCarrierReviewReader(
              this.database,
              this.identity,
            );
          this.carrierOfflineMemberReview = new CarrierOfflineMemberReview(
            this.database,
            this.identity,
            this.platform,
          );
          this.platform.configureReadAuthority((actor) => {
            const current = this.identity.currentActor(actor);
            check(
              !this.identity.security(current).passwordChangeRequired,
              "PASSWORD_CHANGE_REQUIRED",
              "Change your password before continuing.",
              403,
            );
            return current;
          });
          this.providerCredentials = new ProviderCredentials(
            this.database,
            this.platform,
            this.identity,
            security.providerEncryptionKey,
            security.startupMaintenance !== false,
          );
          this.catalog = new Catalog(
            this.database,
            this.platform,
            this.identity,
          );
          this.inventory = new Inventory(
            this.database,
            this.platform,
            this.catalog,
            this.identity,
            security.startupMaintenance !== false,
            (actor, unitId) => this.orders.inspectIncoming(actor, unitId),
          );
          this.labels = new StockLabels(
            this.database,
            this.platform,
            this.identity,
            this.inventory,
            this.catalog,
          );
          this.procurement = new Procurement(
            this.database,
            this.platform,
            this.catalog,
            this.inventory,
            this.identity,
            (actor, input) => this.orders.receiveIncoming(actor, input),
          );
          this.billing = new Billing(
            this.database,
            this.platform,
            this.identity,
            this.catalog,
            (actor, source) =>
              this.fulfillment.authorizeInvoiceSource(actor, source),
            security.startupMaintenance !== false,
          );
          this.orders = new Orders(
            this.database,
            this.platform,
            this.identity,
            this.catalog,
            this.inventory,
            this.billing,
            this.procurement,
          );
          this.fulfillment = new Fulfillment(
            this.database,
            this.platform,
            this.identity,
            this.inventory,
            this.orders,
            this.billing,
            security.startupMaintenance !== false,
          );
          this.warranty = new Warranty(
            this.database,
            this.platform,
            this.identity,
            this.inventory,
            this.fulfillment,
            this.billing,
          );
          this.carriers = new CarrierBookings(
            this.database,
            this.platform,
            this.identity,
            this.fulfillment,
            this.warranty,
          );
          this.integration = new Integration(
            this.database,
            this.platform,
            this.identity,
            this.billing,
            this.inventory,
          );
          this.platform.restore.configureNativeDispositionOwners(
            this.integration,
            this.carriers,
            this.identity,
            (actor) => this.platform.integrationDispositionReceipts(actor),
          );
          this.migration = new Migration(
            this.database,
            this.platform,
            this.identity,
            this.inventory,
            this.catalog,
            this.billing,
          );
          this.eventDelivery = new EventDelivery(
            this.database,
            this.platform,
            this.identity,
            security.eventReports === false
              ? []
              : [new EventReport(this.database)],
          );
          this.platform.configureProjection(() =>
            security.eventReports === false
              ? 0
              : this.eventDelivery.tick("event-report", { enabled: true })
                  .completed,
          );
        },
      );
    } catch (error) {
      this.providerCredentials?.close();
      this.database.close();
      throw error;
    }
  }
  operationsHealth(actor: Actor): OperationsHealth {
    return this.database.transaction(() => {
      const current = this.identity.currentActor(actor);
      permit(current, ["support"]);
      check(
        !this.identity.security(current).passwordChangeRequired,
        "PASSWORD_CHANGE_REQUIRED",
        "Change your password before continuing.",
        403,
      );
      const clock = Date.now();
      return {
        version: 1,
        checkedAt: new Date(clock).toISOString(),
        region: this.identity.region,
        recoveryHold: !!this.platform.recoveryHold(),
        queues: [
          this.billing.health(current),
          ...this.integration.health(current, clock),
          ...this.carriers.health(current),
          this.eventDelivery.health(current, "event-report", clock),
        ],
      };
    });
  }
  reconciliation(actor: Actor) {
    return this.database.transaction(() => {
      const current = this.identity.currentActor(actor);
      permit(current, ["finance"]);
      check(
        !this.identity.security(current).passwordChangeRequired,
        "PASSWORD_CHANGE_REQUIRED",
        "Change your password before continuing.",
        403,
      );
      return this.reconciliationSnapshot(current);
    });
  }
  prepareReconciliation(
    actor: Actor,
    key: string,
    input: { expectedHash: string },
  ) {
    return this.platform.prepareReconciliation(actor, key, input, (current) =>
      this.reconciliationSnapshot(current),
    );
  }
  private reconciliationSnapshot(current: Actor) {
    const currency = this.identity.organization(current).currency;
    const report = {
      version: 1 as const,
      checkedAt: now(),
      currency,
      stock: this.inventory.controlTotals(current),
      billing: this.billing.controlTotals(current, currency),
      sales: salesControls(
        this.orders.salesEvidence(current),
        this.fulfillment.salesEvidence(current),
        this.inventory.salesEvidence(current),
        this.billing.salesEvidence(current),
        currency,
      ),
    };
    return {
      ...report,
      snapshotHash: reconciliationHash(current.orgId, report),
    };
  }
  dashboard(actor: Actor) {
    actor = this.identity.currentActor(actor);
    const orders = this.orders.orderPage(actor);
    const shipments = this.fulfillment.shipmentPage(actor);
    const sold = ["admin", "warranty", "commercial", "buyer"].includes(
      actor.role,
    )
      ? this.warranty.soldUnitPage(actor)
      : { items: [], next: null };
    const claims = [
      "admin",
      "finance",
      "commercial",
      "buyer",
      "warranty",
      "warehouse",
    ].includes(actor.role)
      ? this.warranty.claimPage(actor)
      : { items: [], next: null };
    const canReadInvoices = [
      "admin",
      "finance",
      "commercial",
      "buyer",
      "warranty",
      "support",
    ].includes(actor.role);
    const invoices = canReadInvoices
      ? this.billing.invoicePage(actor)
      : { items: [], next: null };
    const stock =
      actor.role === "buyer"
        ? { items: [], next: null }
        : this.inventory.stockPage(actor);
    return {
      analytics: {
        orders: this.orders.operationalAnalytics(actor),
        invoices: canReadInvoices
          ? this.billing.operationalAnalytics(actor)
          : null,
        stock:
          actor.role === "buyer"
            ? null
            : this.inventory.operationalAnalytics(actor),
        countsAwaitingReview: ["admin", "warehouse", "support"].includes(
          actor.role,
        )
          ? this.inventory.countsAwaitingReview(actor)
          : null,
      },
      organization: this.identity.organization(actor),
      recoveryHold: this.platform.recoveryHold(),
      accounts: this.identity.customers(actor).map((customer) => ({
        ...customer,
        providerReviews: this.identity.residency.status(actor, customer),
      })),
      providerDisclosures: this.identity.residency.current(actor),
      products:
        actor.role === "buyer"
          ? actor.accountId
            ? this.catalog.customerProductPage(actor, actor.accountId).items
            : []
          : this.catalog.products(actor),
      warehouses: this.inventory.warehouses(actor),
      orders: orders.items,
      orderNext: orders.next,
      orderCounts: this.orders.orderCounts(actor),
      shipments: shipments.items,
      shipmentNext: shipments.next,
      invoices: invoices.items,
      invoiceNext: invoices.next,
      invoiceSummary: canReadInvoices
        ? this.billing.invoiceSummary(actor)
        : { total: 0, unpaid: 0, settled: 0, credit: 0, due: 0 },
      soldUnits: sold.items,
      soldUnitNext: sold.next,
      claims: claims.items,
      claimNext: claims.next,
      stock: stock.items,
      stockNext: stock.next,
      stockSummary:
        actor.role === "buyer"
          ? { available: 0 }
          : this.inventory.stockSummary(actor),
    };
  }
  close() {
    this.providerCredentials.close();
    this.database.close();
  }
}
