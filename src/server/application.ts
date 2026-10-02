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

export class Application {
  database: Database;
  platform!: Platform;
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
  constructor(
    path: string,
    region: Region = "CA",
    security: {
      mfaEncryptionKey?: string;
      mfaRequiredRoles?: readonly Role[];
      providerEncryptionKey?: string;
      eventReports?: boolean;
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
          this.platform = new Platform(this.database);
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
          );
          this.billing = new Billing(
            this.database,
            this.platform,
            this.identity,
            this.catalog,
            (actor, source) =>
              this.fulfillment.authorizeInvoiceSource(actor, source),
          );
          this.orders = new Orders(
            this.database,
            this.platform,
            this.identity,
            this.catalog,
            this.inventory,
            this.billing,
          );
          this.fulfillment = new Fulfillment(
            this.database,
            this.platform,
            this.identity,
            this.inventory,
            this.orders,
            this.billing,
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
      organization: this.identity.organization(actor),
      recoveryHold: this.platform.recoveryHold(),
      accounts: this.identity.customers(actor).map((customer) => ({
        ...customer,
        providerReviews: this.identity.residency.status(actor, customer),
      })),
      providerDisclosures: this.identity.residency.current(actor),
      products: this.catalog.products(actor),
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
