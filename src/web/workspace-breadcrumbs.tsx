import {
  navigationHash,
  readNavigation,
  type NavigationIntent,
} from "./navigation.ts";
import { workspaceGroups } from "./workspace.tsx";
import "./workspace-breadcrumbs.css";

const sectionNames: Record<string, string> = {
  "admin-access": "Staff and buyer access",
  "admin-applications": "Trade applications",
  "customer-accounts": "Accounts",
  "customer-purchasing": "Purchasing access",
  "customer-pricing": "Pricing",
  "customer-providers": "Provider settings",
  "orders-queue": "Orders",
  "orders-requests": "Approval requests",
  "orders-shipments": "Shipments",
  "inventory-stock": "Stock",
  "inventory-serials": "Serial reviews",
  "inventory-counts": "Cycle counts",
  "inventory-transfers": "Transfers",
  "purchasing-queue": "Purchase orders",
  "purchasing-incoming": "Incoming allocations",
  "purchasing-drafts": "Receipt drafts",
  "purchasing-receipts": "Receipts & returns",
  "billing-invoices": "Invoices",
  "billing-accounting": "Accounting",
  "billing-aging": "Account aging",
  "billing-providers": "Provider activity",
  "returns-claims": "Claims and returns",
  "returns-replacements": "Replacements",
  "returns-manufacturers": "Manufacturer cases",
  "returns-policy": "Coverage policy",
  "imports-opening": "Opening stock",
  "imports-masters": "Customers and catalog",
  "imports-documents": "Unpaid documents",
};

export function WorkspaceBreadcrumbs({
  route,
  pages,
  customer,
  onNavigate,
  customerName,
}: {
  route: NavigationIntent;
  pages: string[];
  customer: boolean;
  customerName?: string;
  onNavigate: (intent: NavigationIntent) => void;
}) {
  const homePage = customer ? "Shop" : "Overview";
  const label =
    customer && route.page === "Billing"
      ? "Invoices & payments"
      : customer && route.page === "Overview"
        ? "Reports"
        : route.page;
  const crumbs = [
    { label: "Home", href: "#home" },
    {
      label: customer ? "My workspace" : "Workspace",
      href: navigationHash({ page: homePage }),
    },
  ];
  if (route.page !== homePage) {
    const group =
      !customer &&
      workspaceGroups.find((item) => item.pages.includes(route.page));
    const destination =
      group && group.pages.find((page) => pages.includes(page));
    if (group && destination && group.name !== "Workspace")
      crumbs.push({
        label: group.name,
        href: navigationHash({ page: destination }),
      });
    crumbs.push({
      label,
      href: navigationHash({
        ...route,
        section: undefined,
        orderId: undefined,
        customerId: undefined,
        customerTab: undefined,
      }),
    });
  }
  if (route.customerId) {
    crumbs.push({
      label: customerName ?? "Customer record",
      href: navigationHash({ ...route, customerTab: "overview" }),
    });
    if (route.customerTab && route.customerTab !== "overview")
      crumbs.push({
        label: route.customerTab[0]!.toUpperCase() + route.customerTab.slice(1),
        href: navigationHash(route),
      });
  }
  const section =
    !route.customerId && route.section && sectionNames[route.section];
  if (section && section !== label)
    crumbs.push({
      label: section,
      href: navigationHash({ ...route, orderId: undefined }),
    });
  if (route.orderId) {
    // The parent retains queue filters; no customer data or opaque record ID in the trail.
    const last = crumbs[crumbs.length - 1]!;
    last.href = navigationHash({ ...route, orderId: undefined });
    crumbs.push({ label: "Order details", href: navigationHash(route) });
  }
  return (
    <nav aria-label="Workspace breadcrumb" className="workspace-breadcrumbs">
      <ol>
        {crumbs.map((crumb, index) => (
          <li key={`${index}:${crumb.label}`}>
            {index === crumbs.length - 1 ? (
              <span aria-current="page">{crumb.label}</span>
            ) : (
              <a
                href={crumb.href}
                onClick={(event) => {
                  if (
                    crumb.href === "#home" ||
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  )
                    return;
                  event.preventDefault();
                  onNavigate(readNavigation(crumb.href));
                }}
              >
                {crumb.label}
              </a>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
