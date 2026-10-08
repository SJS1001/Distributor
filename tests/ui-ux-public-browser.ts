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
  await page
    .getByRole("link", { name: "Explore products", exact: false })
    .focus();
  await page.mouse.move(0, 0);
  await page.clock.fastForward(15000);
  await expect(slide).toHaveAttribute("aria-label", original!);
  await carousel.getByRole("button", { name: "Next system" }).click();
  await expect(slide).not.toHaveAttribute("aria-label", original!);
  await expect(carousel.locator("[aria-live]")).toContainText("2 of 5:");
  await carousel.getByRole("button", { name: "Previous system" }).click();
  await expect(slide).toHaveAttribute("aria-label", original!);
  await carousel.getByRole("button", { name: "Play rotation" }).click();
  await page
    .getByRole("link", { name: "Explore products", exact: false })
    .focus();
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
    page.locator('nav[aria-label="Breadcrumb"] [aria-current="page"]'),
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
  await contrast(".public-feature-caption strong", "rgb(255, 255, 255)");
  await contrast(".public-footer p", "rgb(255, 255, 255)");
  await contrast(".public-entry-sign-in", "rgb(17, 47, 81)");
  await contrast(".public-entry-apply", "rgb(9, 101, 167)");
  await page.goto("/#customer-sign-in");
  const background = await page
    .locator(".public-form-card .login button")
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  await contrast(".public-form-card .login button", background);
});

test("approved public layout keeps square categories and compact controls below the carousel", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [1440, 1200, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 980 });
    await page.goto("/#home");
    await expect(page.locator(".public-category-card")).toHaveCount(3);
    await expect(page.locator('a[href="#apply"]')).toHaveCount(1);
    await expect(page.locator(".public-header nav a")).toHaveCount(2);
    await expect(page.locator(".public-section-heading > a")).toHaveCSS(
      "white-space",
      "nowrap",
    );
    const signIn = await page.locator(".public-entry-sign-in").boundingBox();
    const apply = await page.locator(".public-entry-apply").boundingBox();
    expect(signIn!.height).toBe(apply!.height);
    expect(signIn!.y).toBe(apply!.y);
    const carousel = await page
      .locator(".public-equipment-feature")
      .boundingBox();
    const controls = await page
      .locator(".public-feature-controls")
      .boundingBox();
    expect(controls!.x).toBeGreaterThanOrEqual(carousel!.x);
    expect(controls!.x + controls!.width).toBeLessThanOrEqual(
      carousel!.x + carousel!.width,
    );
    expect(controls!.y).toBeGreaterThanOrEqual(carousel!.y + carousel!.height);
    const previous = await page
      .getByRole("button", { name: "Previous system" })
      .boundingBox();
    expect(previous!.height).toBe(32);
    await expect(page.locator(".public-equipment-feature button")).toHaveCount(
      0,
    );
    for (const image of await page
      .locator(".public-category-card > div")
      .all()) {
      const box = await image.boundingBox();
      expect(Math.abs(box!.width - box!.height)).toBeLessThan(1);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
    if (width >= 1200) {
      const categories = await page
        .locator(".public-category-grid")
        .boundingBox();
      expect(categories!.y + categories!.height).toBeLessThan(980);
    }
  }
  await page.locator(".public-category-card").first().click();
  await expect(
    page.getByRole("heading", { name: "Ductless mini-splits", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Category")).toHaveValue("ductless");
  await expect(
    page.locator(".gree-product-card").filter({ hasText: "Crossover" }).first(),
  ).toBeVisible();
  await expect(
    page
      .locator(".gree-product-card")
      .filter({ hasText: "Free Match" })
      .first(),
  ).toBeVisible();
});

test("carousel keyboard controls wrap, announce selection and open the selected product", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/#home");
  const carousel = page.getByRole("region", { name: "Featured systems" });
  const slide = carousel.locator('[aria-roledescription="slide"]');
  const status = carousel.locator("[aria-live]");
  await expect(status).toHaveAttribute("aria-live", "off");
  const previous = carousel.getByRole("button", { name: "Previous system" });
  await previous.focus();
  await expect(status).toHaveAttribute("aria-live", "polite");
  await page.keyboard.press("Enter");
  await expect(slide).toHaveAttribute("aria-label", /^5 of 5:/);
  await expect(previous).toBeFocused();
  await expect(status).toHaveText((await slide.getAttribute("aria-label"))!);
  const dots = carousel.locator(".public-feature-dots button");
  for (let index = 0; index < (await dots.count()); index++) {
    await dots.nth(index).focus();
    await page.keyboard.press("Space");
    await expect(dots.nth(index)).toHaveAttribute("aria-current", "true");
    await expect(carousel.locator('[aria-current="true"]')).toHaveCount(1);
    await expect(slide).toHaveAttribute(
      "aria-label",
      new RegExp(`^${index + 1} of 5:`),
    );
    await expect(status).toHaveText((await slide.getAttribute("aria-label"))!);
    await expect(slide.locator("img")).toHaveJSProperty("complete", true);
    expect(
      await slide
        .locator("img")
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    ).toBeGreaterThan(0);
  }
  const selected = await slide.getAttribute("aria-label");
  await page.clock.fastForward(15000);
  await expect(slide).toHaveAttribute("aria-label", selected!);
  await page
    .getByRole("link", { name: "Explore products", exact: false })
    .focus();
  await carousel.hover();
  await page.clock.fastForward(15000);
  await expect(slide).toHaveAttribute("aria-label", selected!);
  const target = await slide.getAttribute("href");
  await slide.click();
  expect(new URL(page.url()).hash).toBe(target);
  await expect(page.locator(".gree-detail h1")).toBeVisible();
});

test("touch carousel fits a narrow phone with usable targets and no empty image strip", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 740 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:3125/#home");
  const carousel = page.getByRole("region", { name: "Featured systems" });
  for (const button of await carousel
    .locator(".public-feature-controls > button")
    .all()) {
    const box = await button.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  const panel = await carousel
    .locator(".public-equipment-feature")
    .boundingBox();
  const caption = await carousel
    .locator(".public-feature-caption")
    .boundingBox();
  expect(
    panel!.y + panel!.height - caption!.y - caption!.height,
  ).toBeLessThanOrEqual(2);
  const controls = await carousel
    .locator(".public-feature-controls")
    .boundingBox();
  expect(controls!.x).toBeGreaterThanOrEqual(panel!.x);
  expect(controls!.x + controls!.width).toBeLessThanOrEqual(
    panel!.x + panel!.width,
  );
  await carousel.getByRole("button", { name: "Next system" }).tap();
  await expect(
    carousel.locator('[aria-roledescription="slide"]'),
  ).toHaveAttribute("aria-label", /^2 of 5:/);
  await carousel.getByRole("button", { name: "Previous system" }).tap();
  await expect(
    carousel.locator('[aria-roledescription="slide"]'),
  ).toHaveAttribute("aria-label", /^1 of 5:/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320,
  );
  expect(errors).toEqual([]);
  await context.close();
});
