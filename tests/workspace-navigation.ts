import { expect, type Page, type Locator } from "@playwright/test";

const categories: Record<string, string> = {
  Overview: "Workspace",
  Orders: "Sales & customers",
  Customers: "Sales & customers",
  Catalog: "Sales & customers",
  Inventory: "Stock & fulfillment",
  Purchasing: "Stock & fulfillment",
  Returns: "Stock & fulfillment",
  Billing: "Finance",
  Reconciliation: "Finance",
  "Operations health": "System & controls",
  "Audit history": "System & controls",
  "Event reporting": "System & controls",
  Imports: "System & controls",
  Administration: "System & controls",
  Security: "System & controls",
};

// Follow visible navigation, including the collapsed phone menu. Callers choose
// their section explicitly so hidden controls cannot silently satisfy a test.
export async function navigateWorkspace(
  page: Page,
  destination: string,
  section?: string,
) {
  const category = categories[destination];
  if (!category)
    throw new Error(`Unknown workspace destination: ${destination}`);
  await expect(page.locator("#workspace-title")).toBeVisible();
  const pages = page.getByRole("navigation", {
    name: `${category} pages`,
    exact: true,
  });
  if (!(await pages.isVisible())) {
    const menu = page.getByRole("button", { name: "Menu", exact: true });
    if (await menu.isVisible()) await menu.click();
    await page
      .getByRole("navigation", { name: "Workspace", exact: true })
      .getByRole("button", { name: category, exact: true })
      .click();
  }
  // A category with one authorized page opens it directly and shows no page
  // tabs, so wait for either the destination tab or the destination heading.
  const tab = pages.getByRole("button", { name: destination, exact: true });
  const title = page.locator("#workspace-title").filter({
    hasText: new RegExp(
      `^${destination.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
    ),
  });
  await expect(tab.or(title).first()).toBeVisible();
  if (await tab.isVisible()) await tab.click();
  if (section)
    await page
      .getByRole("tablist", { name: `${destination} sections`, exact: true })
      .getByRole("tab", { name: section, exact: true })
      .click();
}

export async function navigateAccounting(
  page: Page,
  section: "QuickBooks connections" | "Inventory costs" | "Stock journals",
) {
  await navigateWorkspace(page, "Billing", "Accounting");
  const disclosure = page.locator("details.workspace-disclosure").filter({
    has: page.locator("summary").filter({ hasText: section }),
  });
  await expect(disclosure).toHaveCount(1);
  if (!(await disclosure.evaluate((element) => element.hasAttribute("open"))))
    await disclosure.locator("summary").click();
}

// Open the same per-row disclosure used by operators, preserving current state.
export async function openStockActions(row: Locator) {
  const actions = row.locator("details.stock-actions");
  await expect(actions).toHaveCount(1);
  if (!(await actions.evaluate((element) => element.hasAttribute("open"))))
    await actions.locator("summary").click();
}

// Order and invoice rows group secondary commands in the same disclosure.
export async function withRowActions(row: Locator) {
  await openStockActions(row);
  return row;
}

// Page-level variant for journeys that act on the first matching row.
export async function openVisibleRowActions(page: Page) {
  const closed = page.locator("details.stock-actions:not([open]) > summary");
  for (const summary of await closed.all())
    if (await summary.isVisible()) await summary.click();
}
