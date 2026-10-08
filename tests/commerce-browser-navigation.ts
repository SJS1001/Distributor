import { expect, type Page } from "@playwright/test";

// Buyer workspaces use the customer header navigation instead of staff
// categories. Overview is labelled "Reports" and Billing "Invoices & payments".
const buyerLabels: Record<string, string> = {
  Overview: "Reports",
  Billing: "Invoices & payments",
};

export function buyerTitle(destination: string) {
  return buyerLabels[destination] ?? destination;
}

// Buyers sign in to the Shop workspace unless the URL names another page.
export async function expectBuyerLanding(page: Page) {
  await expect(page.locator("#workspace-title")).toHaveText("Shop");
}

// Follow the visible customer navigation, including the collapsed phone menu.
export async function navigateBuyerWorkspace(
  page: Page,
  destination: string,
  section?: string,
) {
  const label = buyerTitle(destination);
  const title = page.locator("#workspace-title");
  await expect(title).toBeVisible();
  const button = page
    .getByRole("navigation", { name: "Workspace", exact: true })
    .getByRole("button", { name: label, exact: true });
  if (!(await button.isVisible()))
    await page.getByRole("button", { name: "Menu", exact: true }).click();
  await button.click();
  await expect(title).toHaveText(label);
  if (section)
    await page
      .getByRole("tablist", { name: `${destination} sections`, exact: true })
      .getByRole("tab", { name: section, exact: true })
      .click();
}

// Signing out from a restored workspace location shows the public site, which
// offers sign-in links rather than an immediate sign-in form.
export async function expectSignedOut(page: Page) {
  await expect(
    page
      .getByRole("navigation", { name: "Public navigation", exact: true })
      .getByRole("link", { name: "Sign in", exact: true }),
  ).toBeVisible();
}
