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
export type NavigationIntent = {
  page: string;
  section?: string;
  orderState?: OrderQueueState | "";
  orderReservation?: "overdue" | "";
  invoiceBalance?: InvoiceQueueState | "";
  stockView?: StockQueueView | "";
  warehouseId?: string;
  orderId?: string;
  countState?: CountQueueState | "";
};
const sections: Record<string, string[]> = {
  Orders: ["orders-queue", "orders-shipments"],
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
  const section = query.get("section");
  if (section && sections[page]?.includes(section)) route.section = section;
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
  if (
    page === "Billing" &&
    invoiceQueueStates.includes(invoiceBalance as InvoiceQueueState)
  )
    route.invoiceBalance = invoiceBalance as InvoiceQueueState;
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
  if (intent.section) query.set("section", intent.section);
  if (intent.orderState) query.set("orders", intent.orderState);
  if (intent.orderReservation)
    query.set("reservation", intent.orderReservation);
  if (intent.invoiceBalance) query.set("invoices", intent.invoiceBalance);
  if (intent.stockView) query.set("stock", intent.stockView);
  if (intent.warehouseId) query.set("warehouse", intent.warehouseId);
  if (intent.orderId) query.set("order", intent.orderId);
  if (intent.countState) query.set("counts", intent.countState);
  const safe = readNavigation(`#${query}`);
  const result = new URLSearchParams({ page: safe.page });
  for (const [key, value] of Object.entries({
    section: safe.section,
    orders: safe.orderState,
    reservation: safe.orderReservation,
    invoices: safe.invoiceBalance,
    stock: safe.stockView,
    warehouse: safe.warehouseId,
    order: safe.orderId,
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
    : ["Overview", "Orders", "Billing", "Returns", "Customers", "Security"];
}
export function authorizeNavigation(route: NavigationIntent, pages: string[]) {
  return pages.includes(route.page) ? route : { page: "Overview" };
}
