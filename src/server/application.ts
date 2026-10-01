import { check, type Actor } from "./core.ts";
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
import { Warranty } from "./warranty.ts";
import { Integration } from "./integration.ts";
import { ProviderCredentials } from "./provider-credentials.ts";
import { Migration } from "./migration.ts";

export class Application {
  database: Database;
  platform: Platform;
  identity: Identity;
  catalog: Catalog;
  inventory: Inventory;
  labels: StockLabels;
  procurement: Procurement;
  billing: Billing;
  orders: Orders;
  fulfillment: Fulfillment;
  warranty: Warranty;
  integration: Integration;
  migration: Migration;
  providerCredentials: ProviderCredentials;
  constructor(
    path: string,
    region: Region = "CA",
    security: {
      mfaEncryptionKey?: string;
      providerEncryptionKey?: string;
    } = {},
  ) {
    check(
      ["CA", "US"].includes(region),
      "REGION",
      "Runtime residency region must be CA or US.",
      500,
    );
    this.database = new Database(path);
    this.platform = new Platform(this.database);
    this.identity = new Identity(
      this.database,
      this.platform,
      region,
      (actor, sites) => {
        for (const siteId of sites) this.inventory.warehouse(actor, siteId);
      },
      security.mfaEncryptionKey,
    );
    this.providerCredentials = new ProviderCredentials(
      this.database,
      this.platform,
      this.identity,
      security.providerEncryptionKey,
    );
    this.catalog = new Catalog(this.database, this.platform, this.identity);
    this.inventory = new Inventory(this.database, this.platform, this.catalog);
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
    );
    this.billing = new Billing(
      this.database,
      this.platform,
      this.identity,
      this.catalog,
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
    this.integration = new Integration(
      this.database,
      this.platform,
      this.identity,
      this.billing,
    );
    this.migration = new Migration(
      this.database,
      this.platform,
      this.identity,
      this.inventory,
      this.catalog,
      this.billing,
    );
  }
  dashboard(actor: Actor) {
    return {
      organization: this.identity.organization(actor),
      recoveryHold: this.platform.recoveryHold(),
      accounts: this.identity.customers(actor),
      products: this.catalog.products(actor),
      warehouses: this.inventory.warehouses(actor),
      orders: this.orders.list(actor),
      shipments: this.fulfillment.shipments(actor),
      invoices: [
        "admin",
        "finance",
        "commercial",
        "buyer",
        "warranty",
        "support",
      ].includes(actor.role)
        ? this.billing.invoices(actor)
        : [],
      soldUnits: ["admin", "warranty", "commercial", "buyer"].includes(
        actor.role,
      )
        ? this.warranty.soldUnits(actor)
        : [],
      claims: [
        "admin",
        "finance",
        "commercial",
        "buyer",
        "warranty",
        "warehouse",
      ].includes(actor.role)
        ? this.warranty.list(actor)
        : [],
      stock: actor.role === "buyer" ? [] : this.inventory.stock(actor),
    };
  }
  close() {
    this.providerCredentials.close();
    this.database.close();
  }
}
