import { test, expect } from "@playwright/test";

test("explicit pause survives leaving the carousel; navigation remains usable", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/#home");
  const carousel = page.getByRole("region", { name: "Featured systems" });
  const slide = carousel.locator('[aria-roledescription="slide"]');
  const original = await slide.getAttribute("aria-label");
  await carousel.getByRole("button", { name: "Pause rotation" }).click();
  await page.getByRole("link", { name: "Products", exact: true }).focus();
  await page.mouse.move(0, 0);
  await page.clock.fastForward(15000);
  await expect(slide).toHaveAttribute("aria-label", original!);
  await carousel.getByRole("button", { name: "Next →" }).click();
  await expect(slide).not.toHaveAttribute("aria-label", original!);
  await expect(carousel.getByText("2 of 5", { exact: true })).toBeVisible();
  await carousel.getByRole("button", { name: "← Previous" }).click();
  await expect(slide).toHaveAttribute("aria-label", original!);
  await carousel.getByRole("button", { name: "Play rotation" }).click();
  await page.getByRole("link", { name: "Products", exact: true }).focus();
  await page.mouse.move(0, 0);
  await page.clock.fastForward(5001);
  await expect(slide).not.toHaveAttribute("aria-label", original!);
});

test("reduced motion stops rotation initially and when preference changes", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install();
  await page.goto("/#home");
  const carousel = page.getByRole("region", { name: "Featured systems" });
  const slide = carousel.locator('[aria-roledescription="slide"]');
  const original = await slide.getAttribute("aria-label");
  await expect(
    carousel.getByRole("button", { name: "Rotation off" }),
  ).toBeDisabled();
  await page.clock.fastForward(15000);
  await expect(slide).toHaveAttribute("aria-label", original!);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(
    carousel.getByRole("button", { name: "Pause rotation" }),
  ).toBeVisible();
  await page.clock.fastForward(5001);
  await expect(slide).not.toHaveAttribute("aria-label", original!);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(
    carousel.getByRole("button", { name: "Rotation off" }),
  ).toBeDisabled();
  const stopped = await slide.getAttribute("aria-label");
  await page.clock.fastForward(15000);
  await expect(slide).toHaveAttribute("aria-label", stopped!);
});

test("mobile product identity and technical access precede the gallery", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/#product=11146997039271&library=%23products");
  const heading = page.getByRole("heading", { name: "Unix ECO", exact: true });
  await expect(heading).toBeVisible();
  const titleBox = await heading.boundingBox();
  const galleryBox = await page.locator(".gree-gallery-stage").boundingBox();
  expect(titleBox!.y).toBeLessThan(700);
  expect(titleBox!.y).toBeLessThan(galleryBox!.y);
  await expect(page.getByLabel("Model configuration")).toBeVisible();
  await page.getByRole("button", { name: /^Technical documents/ }).click();
  await expect(page.getByRole("tab", { name: /^Documents/ })).toBeFocused();
  await expect(
    page.getByRole("tabpanel", { name: /^Documents/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("reference scope is visible before results and application jumps to its form", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#products");
  const scope = page.getByText(
    /Manufacturer reference information and technical documents/,
  );
  await expect(scope).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "Sign in for account pricing and availability →",
    }),
  ).toHaveAttribute("href", "#customer-sign-in");
  await expect(
    page.locator('nav[aria-label="Public navigation"] a[aria-current="page"]'),
  ).toHaveText("Products");
  await page.goto("/#apply");
  await page.getByRole("link", { name: "Enter business details ↓" }).click();
  await expect(page.locator("#public-entry-form")).toBeFocused();
  expect(
    (await page.locator("#public-entry-form").boundingBox())!.y,
  ).toBeLessThan(100);
});

test("public secondary text and sign-in action meet normal-text contrast", async ({
  page,
}) => {
  const contrast = async (selector: string, background: string) => {
    const foreground = await page
      .locator(selector)
      .first()
      .evaluate((node) => getComputedStyle(node).color);
    const ratio = await page.evaluate(
      ({ foreground, background }) => {
        const luminance = (rgb: string) => {
          const values = rgb
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number)
            .map((value) => {
              const s = value / 255;
              return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
            });
          return (
            values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722
          );
        };
        const a = luminance(foreground),
          b = luminance(background);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      },
      { foreground, background },
    );
    expect(ratio, `${selector} against ${background}`).toBeGreaterThanOrEqual(
      4.5,
    );
  };
  await page.goto("/#home");
  await contrast(".public-feature-caption small", "rgb(255, 255, 255)");
  await contrast(".public-footer p", "rgb(16, 46, 80)");
  await contrast(".public-trade-note .public-text-link", "rgb(243, 247, 251)");
  await page.goto("/#customer-sign-in");
  const background = await page
    .locator(".public-form-card .login button")
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  await contrast(".public-form-card .login button", background);
});
