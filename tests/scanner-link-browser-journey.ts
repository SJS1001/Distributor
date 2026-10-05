import { test, expect } from "@playwright/test";
test("phone scanner delivery recovers a lost accepted response without a duplicate, and allows invalid phone correction", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#scanner");
  await expect(
    page.getByText(/Sign in to the staff workspace to use internal delivery/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send scanner link", exact: true }),
  ).toHaveCount(0);
  await page.goto("/#admin-sign-in");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("#workspace-title")).toBeVisible();
  await page.goto("/#scanner");
  const section = page.locator(
    'section[aria-labelledby="internal-scanner-delivery"]',
  );
  await section.getByLabel("Recipient email").fill("warehouse@example.test");
  const attempts: { key: string | undefined; body: string | null }[] = [];
  await page.route("**/api/scanner-link/send", async (route) => {
    attempts.push({
      key: route.request().headers()["idempotency-key"],
      body: route.request().postData(),
    });
    const response = await route.fetch();
    if (attempts.length === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await section
    .getByRole("button", { name: "Send scanner link", exact: true })
    .click();
  await expect(
    section.getByRole("button", { name: "Check same attempt" }),
  ).toBeEnabled();
  await expect(section.getByLabel("Recipient email")).toBeDisabled();
  await page.reload();
  await section.getByRole("button", { name: "Check same attempt" }).click();
  await expect(
    section.getByText(/accepted the link. Delivery is not yet confirmed/),
  ).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(await (await page.request.get("/test-scanner-sends")).json()).toEqual({
    sends: 1,
  });
  await section.getByLabel("Delivery method").selectOption("sms");
  await section
    .getByLabel("Phone number including country code")
    .fill("invalid");
  await section
    .getByRole("button", { name: "Send scanner link", exact: true })
    .click();
  await expect(
    section.getByLabel("Phone number including country code"),
  ).toBeEnabled();
  await section
    .getByLabel("Phone number including country code")
    .fill("+14165550123");
  await section
    .getByRole("button", { name: "Send scanner link", exact: true })
    .click();
  await expect(
    section.getByText(/accepted the link. Delivery is not yet confirmed/),
  ).toBeVisible();
  expect(await (await page.request.get("/test-scanner-sends")).json()).toEqual({
    sends: 2,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
