import { expect, type Page } from "@playwright/test";

// Buyers use the customer portal header instead of staff categories. Its
// buttons name Billing "Invoices & payments" and Overview "Reports"; buyers
// reach their account and residency choices from Account.
const buyerLabels: Record<string, string> = {
  Shop: "Shop",
  Orders: "Orders",
  Billing: "Invoices & payments",
  Overview: "Reports",
  Account: "Account",
};
const buyerSections: Record<string, string> = {
  Orders: "Orders sections",
  Billing: "Billing sections",
  Account: "Customer workspace sections",
};

// Follow the visible buyer portal navigation, including the collapsed phone
// menu, and wait for the destination heading before choosing a section.
export async function navigateBuyer(
  page: Page,
  destination: "Shop" | "Orders" | "Billing" | "Overview" | "Account",
  section?: string,
) {
  const label = buyerLabels[destination]!;
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
      .getByRole("tablist", { name: buyerSections[destination], exact: true })
      .getByRole("tab", { name: section, exact: true })
      .click();
}

// Signing out returns to the public entrance (or to the public sign-in route
// when the page was opened there). Wait for the workspace to close, then open
// the sign-in route explicitly before entering the next credentials.
export async function returnToSignIn(page: Page) {
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toHaveCount(0);
  await page.goto("/#sign-in");
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
}

// A command that ends every session returns an open sign-in route to the
// credentials form with the ended-session notice.
export async function expectSessionsEndedAtSignIn(
  page: Page,
  notice = "Saved. Your sessions have ended. Sign in again.",
) {
  await expect(page.getByText(notice, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toHaveCount(0);
}
