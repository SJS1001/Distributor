import {
  countQueueStates,
  type CountQueueState,
} from "../shared/count-queue.ts";
import {
  orderQueueStates,
  type OrderQueueState,
} from "../shared/order-queue.ts";
import {
  invoiceQueueStates,
  type InvoiceQueueState,
} from "../shared/invoice-queue.ts";
import { stockQueueViews, type StockQueueView } from "../shared/stock-queue.ts";
export const workspacePages = [
  "Shop",
  "Account",
  "Overview",
  "Orders",
  "Inventory",
  "Purchasing",
  "Catalog",
  "Billing",
  "Returns",
  "Customers",
  "Security",
  "Operations health",
  "Audit history",
  "Event reporting",
  "Reconciliation",
  "Imports",
  "Administration",
] as const;
export type Page = (typeof workspacePages)[number];
export const customerTabs = [
  "overview",
  "history",
  "terms",
  "pricing",
  "notes",
  "contacts",
] as const;
export type CustomerTab = (typeof customerTabs)[number];
export type NavigationIntent = {
  page: string;
  section?: string;
  customerId?: string;
  customerTab?: CustomerTab;
  referenceFamily?: string;
  referenceModel?: string;
  productId?: string;
  orderState?: OrderQueueState | "";
  orderReservation?: "overdue" | "";
  invoiceBalance?: InvoiceQueueState | "";
  stockView?: StockQueueView | "";
  warehouseId?: string;
  orderId?: string;
  invoiceId?: string;
  countState?: CountQueueState | "";
};
const sections: Record<string, string[]> = {
  Administration: ["admin-access", "admin-applications"],
  Customers: [
    "customer-accounts",
    "customer-purchasing",
    "customer-pricing",
    "customer-providers",
  ],
  Account: [
    "customer-accounts",
    "customer-purchasing",
    "customer-pricing",
    "customer-providers",
  ],
  Returns: [
    "returns-claims",
    "returns-replacements",
    "returns-manufacturers",
    "returns-policy",
  ],
  Imports: ["imports-opening", "imports-masters", "imports-documents"],
  Orders: ["orders-queue", "orders-requests", "orders-shipments"],
  Inventory: [
    "inventory-stock",
    "inventory-serials",
    "inventory-counts",
    "inventory-transfers",
  ],
  Purchasing: [
    "purchasing-queue",
    "purchasing-incoming",
    "purchasing-drafts",
    "purchasing-receipts",
  ],
  Billing: [
    "billing-invoices",
    "billing-accounting",
    "billing-aging",
    "billing-providers",
  ],
};
const identifier = (value: string | null) =>
  value && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : undefined;
/** Allow only navigation metadata. Drafts, credentials and free-text search never enter URLs. */
export function readNavigation(hash: string): NavigationIntent {
  const query = new URLSearchParams(hash.replace(/^#\/?/, ""));
  const candidate = query.get("page");
  const page = workspacePages.includes(candidate as Page)
    ? candidate!
    : "Overview";
  const route: NavigationIntent = { page };
  if (page === "Shop") {
    route.productId = identifier(query.get("product"));
    route.referenceFamily = identifier(query.get("referenceFamily"));
    if (route.referenceFamily)
      route.referenceModel = identifier(query.get("referenceModel"));
  }
  if (page === "Customers") {
    route.customerId = identifier(query.get("customer"));
    const tab = query.get("customerTab");
    if (route.customerId && customerTabs.includes(tab as CustomerTab))
      route.customerTab = tab as CustomerTab;
  }
  const section = query.get("section");
  if (section && sections[page]?.includes(section)) route.section = section;
  if (page === "Customers" && route.section === "customer-purchasing")
    route.section = "customer-accounts";
  const orderState = query.get("orders"),
    invoiceBalance = query.get("invoices"),
    stockView = query.get("stock");
  if (page === "Orders") {
    if (orderQueueStates.includes(orderState as OrderQueueState))
      route.orderState = orderState as OrderQueueState;
    route.orderId = identifier(query.get("order"));
    if (query.get("reservation") === "overdue")
      route.orderReservation = "overdue";
  }
  if (page === "Billing") {
    if (invoiceQueueStates.includes(invoiceBalance as InvoiceQueueState))
      route.invoiceBalance = invoiceBalance as InvoiceQueueState;
    route.invoiceId = identifier(query.get("invoice"));
  }
  if (page === "Inventory") {
    if (stockQueueViews.includes(stockView as StockQueueView))
      route.stockView = stockView as StockQueueView;
    route.warehouseId = identifier(query.get("warehouse"));
    const countState = query.get("counts");
    if (countQueueStates.includes(countState as CountQueueState))
      route.countState = countState as CountQueueState;
  }
  return route;
}
export function navigationHash(intent: NavigationIntent) {
  const query = new URLSearchParams({ page: intent.page });
  if (intent.customerId) query.set("customer", intent.customerId);
  if (intent.customerTab) query.set("customerTab", intent.customerTab);
  if (intent.productId) query.set("product", intent.productId);
  if (intent.referenceFamily)
    query.set("referenceFamily", intent.referenceFamily);
  if (intent.referenceModel) query.set("referenceModel", intent.referenceModel);
  if (intent.section) query.set("section", intent.section);
  if (intent.orderState) query.set("orders", intent.orderState);
  if (intent.orderReservation)
    query.set("reservation", intent.orderReservation);
  if (intent.invoiceBalance) query.set("invoices", intent.invoiceBalance);
  if (intent.stockView) query.set("stock", intent.stockView);
  if (intent.warehouseId) query.set("warehouse", intent.warehouseId);
  if (intent.orderId) query.set("order", intent.orderId);
  if (intent.invoiceId) query.set("invoice", intent.invoiceId);
  if (intent.countState) query.set("counts", intent.countState);
  const safe = readNavigation(`#${query}`);
  const result = new URLSearchParams({ page: safe.page });
  for (const [key, value] of Object.entries({
    customer: safe.customerId,
    customerTab: safe.customerTab,
    product: safe.productId,
    referenceFamily: safe.referenceFamily,
    referenceModel: safe.referenceModel,
    section: safe.section,
    orders: safe.orderState,
    reservation: safe.orderReservation,
    invoices: safe.invoiceBalance,
    stock: safe.stockView,
    warehouse: safe.warehouseId,
    order: safe.orderId,
    invoice: safe.invoiceId,
    counts: safe.countState,
  }))
    if (value) result.set(key, value);
  return `#${result}`;
}
export function authorizedPages(role: string) {
  const staff = role !== "buyer",
    admin = role === "admin";
  return staff
    ? [
        "Overview",
        "Orders",
        "Inventory",
        "Purchasing",
        "Catalog",
        "Billing",
        "Returns",
        "Customers",
        "Security",
        ...(["admin", "support"].includes(role)
          ? ["Operations health", "Audit history", "Event reporting"]
          : []),
        ...(["admin", "finance"].includes(role) ? ["Reconciliation"] : []),
        ...(admin ? ["Imports", "Administration"] : []),
      ]
    : ["Shop", "Orders", "Billing", "Overview", "Account", "Returns"];
}
export function authorizeNavigation(route: NavigationIntent, pages: string[]) {
  return pages.includes(route.page) ? route : { page: pages[0] ?? "Overview" };
}
