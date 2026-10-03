import { expect, type Locator, type Page } from "@playwright/test";

// Hold the actual initial page read, so review opens in the recovery-only
// render. Completing that read must preserve the same dialog and focus.
export async function reviewDuringInventoryLoad(
  page: Page,
  dialog: Locator,
  open: () => Promise<void>,
) {
  const pattern = "**/api/transfers/page";
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let intercepted = false;
  await page.route(pattern, async (route) => {
    intercepted = true;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await pending;
    await route.fulfill({ response });
  });
  try {
    await page.reload();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Inventory", exact: true })
      .click();
    await expect.poll(() => intercepted).toBe(true);
    const queue = page.getByRole("region", {
      name: "Transfer queue",
      exact: true,
    });
    await expect(queue).toHaveCount(0);
    await open();
    await expect(dialog).toBeVisible();
    const original = await dialog.elementHandle();
    const cancel = dialog.getByRole("button", { name: "Cancel", exact: true });
    await cancel.focus();
    release();
    await expect(queue).toBeVisible();
    await expect(dialog).toBeVisible();
    expect(await original!.evaluate((element) => element.isConnected)).toBe(
      true,
    );
    await expect(cancel).toBeFocused();
  } finally {
    release();
    await page.unroute(pattern);
  }
}
