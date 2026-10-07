import { test, expect } from "@playwright/test";
import { navigateWorkspace } from "./workspace-navigation.ts";

test("pilot administrator prefill signs in without typing; customer entrance stays blank", async ({
  page,
}) => {
  await page.route("**/api/pilot-sign-in", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        email: "admin@example.test",
        password: "long-test-only-password",
      },
    }),
  );
  await page.goto("/#admin-sign-in");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
    "admin@example.test",
  );
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue(
    "long-test-only-password",
  );
  await page.evaluate(() => {
    location.hash = "#customer-sign-in";
  });
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
  await page.evaluate(() => {
    location.hash = "#admin-sign-in";
  });
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue(
    "long-test-only-password",
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await navigateWorkspace(page, "Administration", "Staff and buyer access");
  await page
    .getByRole("link", { name: "Barcode scanner — open or send to a phone" })
    .click();
  await expect(page).toHaveURL(/#scanner$/);
  await expect(
    page.getByRole("heading", { name: "Barcode scanner.", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/#scanner$/);
  await expect(
    page.getByRole("heading", { name: "Barcode scanner.", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Open staff workspace" }).click();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
});

test("slow pilot prefill does not overwrite typed credentials or fill another entrance", async ({
  page,
}) => {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/pilot-sign-in", async (route) => {
    await ready;
    await route.fulfill({
      json: {
        enabled: true,
        email: "admin@example.test",
        password: "long-test-only-password",
      },
    });
  });
  await page.goto("/#admin-sign-in");
  await page
    .getByLabel("Email", { exact: true })
    .fill("my-account@example.test");
  const response = page.waitForResponse("**/api/pilot-sign-in");
  release();
  await response;
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
    "my-account@example.test",
  );
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
  await page.evaluate(() => {
    location.hash = "#customer-sign-in";
  });
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
});

test("public site: mobile application, approval boundary and sign-in navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/enrollment/config", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        country: "CA",
        currency: "CAD",
        approvalRequired: true,
      },
    }),
  );
  let submission: any;
  await page.route("**/api/enrollment/applications", (route) => {
    submission = route.request().postDataJSON();
    return route.fulfill({ status: 202, json: { received: true } });
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: /Equipment for your.*next installation/,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toHaveCount(0);
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page
    .getByRole("link", { name: "Apply for a trade account" })
    .first()
    .click();
  await page.getByRole("link", { name: "Skip to content" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#apply$/);
  await expect(page.locator("#public-content")).toBeFocused();
  await page
    .getByLabel("Business name", { exact: true })
    .fill("Synthetic Ontario Trades");
  await page.getByLabel("Contact name").fill("Synthetic Buyer");
  await page.getByLabel("Business email").fill("public-ui@example.test");
  await page.getByLabel("Phone", { exact: true }).fill("416-555-0100");
  await page.getByLabel("Province or territory").selectOption("ON");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Submit application" }).click();
  await expect(
    page.getByRole("heading", { name: "Application received." }),
  ).toBeVisible();
  expect(submission).toMatchObject({
    businessName: "Synthetic Ontario Trades",
    email: "public-ui@example.test",
    province: "ON",
    acknowledgment: true,
  });
  await expect(
    page.getByText("Purchasing access is not yet approved.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: /sign in/i })
    .first()
    .click();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Apply for a trade account." }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("public entrances are distinct, fit desktop and phone, and keep legacy sign in", async ({
  page,
}) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const paths = page.locator(".public-header, .public-footer");
    await expect(page.locator(".public-header nav a")).toHaveCount(2);
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", width);
    for (const [href, heading] of [
      ["#customer-sign-in", "Customer sign in."],
      ["#admin-sign-in", "Administration sign in."],
    ]) {
      await paths.locator(`a[href="${href}"]`).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        heading!,
      );
      await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
      await expect(page.locator("body")).toHaveJSProperty("scrollWidth", width);
      await page
        .getByRole("link", { name: "Back to the entrance", exact: false })
        .click();
    }
    await paths.locator('a[href="#apply"]').click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Apply for a trade account.",
    );
  }
  await page.goto("/#sign-in");
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
});

test("public site: activation clears fragment and keeps token/password out of browser storage", async ({
  page,
}) => {
  await page.route("**/api/enrollment/config", (route) =>
    route.fulfill({ json: { enabled: true } }),
  );
  let activation: any;
  await page.route("**/api/enrollment/activate", (route) => {
    activation = route.request().postDataJSON();
    return route.fulfill({ json: { activated: true } });
  });
  await page.goto("/#activate=synthetic-private-token");
  await expect(page).toHaveURL(/#activate$/);
  await page
    .getByLabel("New password (14–256 characters)", { exact: true })
    .fill("synthetic-password-for-ui");
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("different-long-password");
  await page
    .getByRole("button", { name: "Activate account", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Passwords must match.");
  expect(activation).toBeUndefined();
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("synthetic-password-for-ui");
  await page
    .getByRole("button", { name: "Activate account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your account is activated." }),
  ).toBeVisible();
  expect(activation).toEqual({
    token: "synthetic-private-token",
    password: "synthetic-password-for-ui",
  });
  const storage = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  expect(storage).not.toContain("synthetic-private-token");
  expect(storage).not.toContain("synthetic-password-for-ui");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Invitation required" }),
  ).toBeVisible();
});

test("public site: replacement activation link replaces the in-memory token while mounted", async ({
  page,
}) => {
  await page.route("**/api/enrollment/config", (route) =>
    route.fulfill({ json: { enabled: true } }),
  );
  let activation: any;
  await page.route("**/api/enrollment/activate", (route) => {
    activation = route.request().postDataJSON();
    return route.fulfill({ json: { activated: true } });
  });
  await page.goto("/#activate=synthetic-old-invitation");
  await expect(page).toHaveURL(/#activate$/);
  await page
    .getByLabel("New password (14–256 characters)", { exact: true })
    .fill("synthetic-old-invitation-password");
  // A fragment navigation keeps the document mounted, as when opening a reissue.
  await page.evaluate(() => {
    location.hash = "#activate=synthetic-new-invitation";
  });
  await expect(page).toHaveURL(/#activate$/);
  await expect(
    page.getByLabel("New password (14–256 characters)", { exact: true }),
  ).toHaveValue("");
  await page
    .getByLabel("New password (14–256 characters)", { exact: true })
    .fill("synthetic-new-invitation-password");
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("synthetic-new-invitation-password");
  await page
    .getByRole("button", { name: "Activate account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your account is activated." }),
  ).toBeVisible();
  expect(activation).toEqual({
    token: "synthetic-new-invitation",
    password: "synthetic-new-invitation-password",
  });
});

test("public site: admin reviews explicit terms and manually hands off invitation", async ({
  page,
}) => {
  const application = {
    id: "public-ui-application",
    businessName: "Synthetic Ontario Trades",
    contactName: "Buyer",
    email: "buyer@example.test",
    phone: "4165550100",
    province: "ON",
    businessNumber: "",
    notes: "Synthetic UI review only",
    status: "pending",
    createdAt: new Date().toISOString(),
    reviewedAt: null,
    reviewReason: null,
    tier: null,
    creditLimit: null,
    accountId: null,
    invitationExpiresAt: null,
    invitationActive: false,
  };
  await page.route("**/api/enrollment/applications", (route) =>
    route.fulfill({ json: { items: [application], next: null } }),
  );
  let decision: any;
  await page.route(
    "**/api/enrollment/applications/public-ui-application/decision",
    (route) => {
      decision = route.request().postDataJSON();
      application.status = "approved";
      return route.fulfill({
        json: {
          id: application.id,
          status: "approved",
          activationToken: "synthetic-admin-token",
          expiresAt: "2026-12-01T00:00:00.000Z",
        },
      });
    },
  );
  await page.goto("/#sign-in");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await navigateWorkspace(page, "Administration");
  await page
    .getByRole("tab", { name: "Trade applications", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Approve Synthetic Ontario Trades",
      exact: true,
    })
    .click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Reviewed pricing tier").fill("standard");
  await modal.getByLabel("Reviewed credit limit (CAD)").fill("500.25");
  await modal.getByLabel("Review reason").fill("Synthetic approved UI review");
  await modal
    .getByLabel("Your current password")
    .fill("long-test-only-password");
  await modal
    .getByRole("button", { name: "Approve and create invitation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Private invitation for Synthetic Ontario Trades",
    }),
  ).toBeVisible();
  expect(decision).toMatchObject({
    decision: "approve",
    tier: "standard",
    creditLimit: 50025,
    currentPassword: "long-test-only-password",
  });
  await expect(page.getByLabel("Activation link")).toHaveValue(
    /\/#activate=synthetic-admin-token$/,
  );
  await expect(
    page.getByText("No email has been sent.", { exact: false }).first(),
  ).toBeVisible();
  const storage = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  expect(storage).not.toContain("synthetic-admin-token");
  expect(storage).not.toContain("long-test-only-password");
  await page.getByRole("button", { name: "Dismiss private link" }).click();
  await expect(page.getByLabel("Activation link")).toHaveCount(0);
});

test("public site: actual isolated submission, administrator approval, activation and buyer login", async ({
  page,
  browser,
}) => {
  const password = "synthetic-approved-buyer-password";
  const email = "native-enrollment-ui@example.test";
  await page.goto("/#apply");
  await page
    .getByLabel("Business name", { exact: true })
    .fill("Synthetic Native Ontario Trades");
  await page.getByLabel("Contact name").fill("Native Synthetic Buyer");
  await page.getByLabel("Business email").fill(email);
  await page.getByLabel("Phone", { exact: true }).fill("416-555-0101");
  await page.getByLabel("Province or territory").selectOption("ON");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Submit application" }).click();
  await expect(
    page.getByRole("heading", { name: "Application received." }),
  ).toBeVisible();
  // A submitted applicant has no workspace or session yet.
  const before = await page.request.get("/api/session");
  expect(before.status()).toBe(401);
  const adminContext = await browser.newContext({
    baseURL: "http://127.0.0.1:3125",
  });
  try {
    const admin = await adminContext.newPage();
    await admin.goto("/#sign-in");
    await admin.getByLabel("Email", { exact: true }).fill("admin@example.test");
    await admin
      .getByLabel("Password", { exact: true })
      .fill("long-test-only-password");
    await admin.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      admin.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    await navigateWorkspace(admin, "Administration", "Trade applications");
    await admin
      .getByRole("button", {
        name: "Approve Synthetic Native Ontario Trades",
        exact: true,
      })
      .click();
    const modal = admin.getByRole("dialog");
    await modal.getByLabel("Reviewed pricing tier").fill("standard");
    await modal.getByLabel("Reviewed credit limit (CAD)").fill("0");
    await modal
      .getByLabel("Review reason")
      .fill("Isolated synthetic browser evidence only");
    await modal
      .getByLabel("Your current password")
      .fill("long-test-only-password");
    await modal
      .getByRole("button", {
        name: "Approve and create invitation",
        exact: true,
      })
      .click();
    const link = await admin.getByLabel("Activation link").inputValue();
    expect(link).toContain("/#activate=");
    await page.goto(link);
    await expect(page).toHaveURL(/#activate$/);
    await page
      .getByLabel("New password (14–256 characters)", { exact: true })
      .fill(password);
    await page.getByLabel("Confirm password", { exact: true }).fill(password);
    await page
      .getByRole("button", { name: "Activate account", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Your account is activated." }),
    ).toBeVisible();
    const activatedSession = await page.request.get("/api/session");
    expect(activatedSession.status()).toBe(401);
    await page.getByRole("link", { name: "Continue to sign in" }).click();
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    const loginResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/login") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const session = await (await loginResponse).json();
    expect(session.actor.role).toBe("buyer");
    await expect(
      page.getByRole("heading", { name: "Shop", exact: true }),
    ).toBeVisible();
    await expect(page).toHaveTitle("Shop · dstrbtr");
    expect(
      (await page.request.get("/api/enrollment/applications")).status(),
    ).toBe(403);
    // The issued token cannot activate a second password.
    expect(
      (
        await page.request.post("/api/enrollment/activate", {
          data: {
            token: link.split("#activate=")[1],
            password: "synthetic-second-activation-password",
          },
          headers: { origin: "http://127.0.0.1:3125" },
        })
      ).status(),
    ).toBeGreaterThanOrEqual(400);
    await admin.getByRole("button", { name: "Refresh applications" }).click();
    await admin
      .getByRole("combobox", { name: "Application view", exact: true })
      .selectOption("all");
    await expect(
      admin
        .getByRole("row")
        .filter({ hasText: "Synthetic Native Ontario Trades" })
        .getByRole("cell", { name: "Buyer activated", exact: true }),
    ).toBeVisible();
  } finally {
    await adminContext.close();
  }
});

test("customer prefill opens the buyer storefront without typing and preserves role boundaries", async ({
  page,
}) => {
  await page.route("**/api/pilot-sign-in?audience=customer", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        email: "pilot-buyer@example.test",
        password: "synthetic-buyer-password",
      },
    }),
  );
  await page.goto("/#customer-sign-in");
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue(
    "synthetic-buyer-password",
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
  const session = await (await page.request.get("/api/session")).json();
  expect(session.actor.role).toBe("buyer");
  expect((await page.request.get("/api/users")).status()).toBe(403);
});

test("scanner entrance fits a phone and shares only the public scanner address", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("link", { name: /Barcode scanner/ }).click();
  await expect(
    page.getByRole("heading", { name: "Barcode scanner." }),
  ).toBeVisible();
  await expect(
    page.getByAltText("QR code linking to the dstrbtr barcode scanner"),
  ).toBeVisible();
  for (const name of ["Email link", "Text link"]) {
    const href = await page
      .getByRole("link", { name, exact: true })
      .getAttribute("href");
    expect(decodeURIComponent(href!)).toContain(
      "http://127.0.0.1:3125/#scanner",
    );
    expect(href).not.toContain("password");
  }
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await expect(
    page.getByText("Add to Home Screen", { exact: false }),
  ).toBeVisible();
  await page
    .getByLabel("Barcode or serial number", { exact: true })
    .fill("GREE-SAMPLE-001");
  await expect(
    page.getByLabel("Barcode or serial number", { exact: true }),
  ).toHaveValue("GREE-SAMPLE-001");
});

test("bundled camera decoder reads a real QR frame without native BarcodeDetector and stops capture", async ({
  page,
}) => {
  const { default: QRCode } = await import("qrcode");
  const dataUrl = await QRCode.toDataURL("GREE-SAMPLE-CAMERA-001", {
    width: 640,
    margin: 4,
  });
  await page.addInitScript(
    ({ dataUrl }) => {
      Object.defineProperty(window, "BarcodeDetector", { value: undefined });
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        value: async () => {
          const image = new Image();
          image.src = dataUrl;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = 640;
          canvas.height = 640;
          let frames = 0;
          const draw = () => {
            const context = canvas.getContext("2d")!;
            context.fillStyle = "white";
            context.fillRect(0, 0, 640, 640);
            if (++frames > 8) context.drawImage(image, 0, 0);
          };
          draw();
          const stream = canvas.captureStream(10);
          const timer = setInterval(draw, 100);
          (window as any).scannerStream = stream;
          for (const track of stream.getTracks()) {
            const stop = track.stop.bind(track);
            track.stop = () => {
              stop();
              clearInterval(timer);
            };
          }
          return stream;
        },
      });
    },
    { dataUrl },
  );
  await page.goto("/#scanner");
  await page.getByRole("button", { name: "Scan with camera" }).click();
  await expect(
    page.getByText("Detected: GREE-SAMPLE-CAMERA-001"),
  ).toBeVisible();
  // WebKit can return different JS wrappers for the same native track. Verify
  // the actual stream state instead of observing an override on one wrapper.
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).scannerStream
          .getTracks()
          .every((track: MediaStreamTrack) => track.readyState === "ended"),
      ),
    )
    .toBe(true);
  await expect(
    page.getByLabel("Barcode or serial number", { exact: true }),
  ).toHaveValue("");
  await page.getByRole("button", { name: "Use detected value" }).click();
  await expect(
    page.getByLabel("Barcode or serial number", { exact: true }),
  ).toHaveValue("GREE-SAMPLE-CAMERA-001");
});

test("manufacturer library filters, model specifications and document tabs survive deep links", async ({
  page,
}) => {
  const catalog = JSON.parse(
    await (
      await import("node:fs/promises")
    ).readFile(
      new URL("../src/web/gree-catalog-data.json", import.meta.url),
      "utf8",
    ),
  );
  const product = catalog.products.find(
    (p: any) =>
      p.models.length > 1 &&
      p.models[1].manufacturerModel &&
      p.models[1].specifications.length,
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#products");
    const response = await page.request.get("/");
    expect(response.headers()["content-security-policy"]).toContain(
      "img-src 'self' data: https://cdn.shopify.com",
    );
    await expect(page.locator(".gree-product-card")).toHaveCount(
      catalog.products.length,
    );
    await page
      .getByLabel("Search product families")
      .fill(product.models[1].manufacturerModel);
    await expect(
      page.locator(`.gree-product-card[href^="#product=${product.id}&"]`),
    ).toBeVisible();
    await page
      .locator(`.gree-product-card[href^="#product=${product.id}&"]`)
      .click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      product.title,
    );
    await page
      .getByLabel("Model configuration")
      .selectOption(product.models[1].id);
    await expect(page.locator(".gree-model-selector p")).toContainText(
      product.models[1].manufacturerModel,
    );
    await page.locator(".gree-specification-details summary").click();
    await expect(page.locator(".gree-specifications > div")).toHaveCount(
      product.models[1].specifications.length,
    );
    await page.getByRole("tab", { name: /Documents/ }).click();
    await expect(page.locator(".gree-document-groups a")).toHaveCount(
      product.documents.length,
    );
    for (const doc of product.documents)
      await expect(
        page.locator(`.gree-document-groups a[href="${doc.url}"]`).first(),
      ).toHaveAttribute("rel", "noreferrer");
    await expect(page.getByLabel("Model configuration")).toBeVisible();
    await expect(page.getByLabel("Model configuration")).toHaveValue(
      product.models[1].id,
    );
    await page.getByRole("tab", { name: /Documents/ }).press("ArrowLeft");
    await expect(
      page.getByRole("tab", { name: "Overview", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(page.getByLabel("Model configuration")).toHaveValue(
      product.models[1].id,
    );
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      product.title,
    );
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", width);
    await page.goto("/#products?category=rtu");
    await expect(page.locator(".gree-product-card")).toHaveCount(2);
    await page
      .getByLabel("Search product families")
      .fill("no-such-equipment-xyz");
    await expect(
      page.getByRole("heading", { name: "No matching products" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page.locator(".gree-product-card")).toHaveCount(
      catalog.products.length,
    );
  }
  await page.goto("/#product=%invalid");
  await expect(
    page.getByRole("heading", { name: "Product not found" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("signed-in buyer and administrator can browse the library and return to their own workspace", async ({
  page,
}) => {
  for (const [email, password, heading] of [
    ["pilot-buyer@example.test", "synthetic-buyer-password", "Shop"],
    ["admin@example.test", "long-test-only-password", "Overview"],
  ]) {
    await page.goto(
      heading === "Overview" ? "/#admin-sign-in" : "/#customer-sign-in",
    );
    await page.getByLabel("Email", { exact: true }).fill(email!);
    await page.getByLabel("Password", { exact: true }).fill(password!);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator("#workspace-title")).toHaveText(heading!);
    await page.goto("/#products");
    await expect(page).toHaveURL(/#products$/);
    await page.locator(".gree-product-card").first().click();
    await page.reload();
    await expect(page.locator(".gree-detail")).toBeVisible();
    await page
      .getByRole("link", {
        name: heading === "Shop" ? "My workspace" : "Staff workspace",
        exact: true,
      })
      .first()
      .click();
    await expect(page.locator("#workspace-title")).toHaveText(heading!);
    const signedOut = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/logout") && response.status() === 200,
    );
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await signedOut;
    await expect(
      page.getByRole("button", { name: "Sign out", exact: true }),
    ).toBeHidden();
  }
});

test("public navigation follows the actual customer or staff session and logout revokes account access", async ({
  page,
}, testInfo) => {
  const navigation = page.getByRole("navigation", {
    name: "Public navigation",
  });
  await page.goto("/#home");
  await expect(
    navigation.getByRole("link", { name: "My workspace", exact: true }),
  ).toHaveCount(0);
  await expect(
    navigation.getByRole("link", { name: "Apply for a trade account" }),
  ).toBeVisible();
  await page.goto("/#products");
  await expect(
    page.getByRole("link", { name: "View account pricing" }),
  ).toHaveCount(0);
  await expect((await page.request.get("/api/dashboard")).status()).toBe(401);
  for (const [email, password, heading, accountLabel] of [
    [
      "pilot-buyer@example.test",
      "synthetic-buyer-password",
      "Shop",
      "My workspace",
    ],
    [
      "admin@example.test",
      "long-test-only-password",
      "Overview",
      "Staff workspace",
    ],
  ]) {
    await page.goto(
      heading === "Overview" ? "/#admin-sign-in" : "/#customer-sign-in",
    );
    await page.getByLabel("Email", { exact: true }).fill(email!);
    await page.getByLabel("Password", { exact: true }).fill(password!);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator("#workspace-title")).toHaveText(heading!);
    await page.goto("/#products");
    await page.getByRole("link", { name: "dstrbtr home", exact: true }).click();
    await expect(page).toHaveURL(/#home$/);
    await expect(page.locator(".public-hero")).toBeVisible();
    await page.reload();
    await expect(
      navigation.getByRole("link", { name: accountLabel!, exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(/#home$/);
    await page.goto("/");
    await expect(page.locator("#workspace-title")).toHaveText(heading!);
    await page.goto("/#products");
    await page.getByRole("link", { name: "dstrbtr home", exact: true }).click();

    await expect(
      navigation.getByRole("link", { name: accountLabel!, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", {
        name: /Customer sign in|Trade application|Apply for a trade account|Become a trade customer/,
      }),
    ).toHaveCount(0);
    await expect(
      navigation.getByRole("button", { name: "Sign out", exact: true }),
    ).toBeVisible();
    if (heading === "Overview")
      await expect(
        page.getByRole("link", { name: "My workspace", exact: true }),
      ).toHaveCount(0);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(page.locator("body")).toHaveJSProperty("scrollWidth", width);
      await page.screenshot({
        path: testInfo.outputPath(`public-${heading}-${width}.png`),
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    await page
      .getByRole("link", { name: "Explore products", exact: false })
      .click();
    await expect(
      page.getByRole("link", { name: "View account pricing" }),
    ).toHaveCount(heading === "Shop" ? 1 : 0);
    await page.locator(".gree-product-card").first().click();
    await expect(
      page.getByRole("link", {
        name: /Apply for a trade account|Sign in for pricing/,
      }),
    ).toHaveCount(0);
    await page.reload();
    await expect(
      navigation.getByRole("link", { name: accountLabel!, exact: true }),
    ).toBeVisible();
    const productUrl = page.url();
    const productName = await page.locator(".gree-detail h1").innerText();
    const signedOut = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/logout") && response.status() === 200,
    );
    await navigation
      .getByRole("button", { name: "Sign out", exact: true })
      .click();
    await signedOut;
    await expect(
      navigation.getByRole("button", { name: "Sign out", exact: true }),
    ).toHaveCount(0);
    await expect(
      navigation.getByRole("link", { name: "Sign in", exact: true }),
    ).toBeVisible();
    await expect(
      navigation.getByRole("link", { name: accountLabel!, exact: true }),
    ).toHaveCount(0);
    await expect(page).toHaveURL(productUrl);
    await expect(page.locator(".gree-detail h1")).toHaveText(productName);
    await expect(
      page.getByRole("link", { name: "Log in to see pricing", exact: true }),
    ).toHaveCount(2);
    await expect(
      page.getByRole("link", { name: /View account pricing/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Product not found", exact: true }),
    ).toHaveCount(0);
    await expect((await page.request.get("/api/session")).status()).toBe(401);
    await expect((await page.request.get("/api/dashboard")).status()).toBe(401);
    await page.reload();
    await expect(page).toHaveURL(productUrl);
    await expect(page.locator(".gree-detail h1")).toHaveText(productName);
    await expect(
      navigation.getByRole("link", { name: "Sign in", exact: true }),
    ).toBeVisible();
    await page.goto("/#products");
    await expect(
      page.getByRole("link", { name: "View account pricing" }),
    ).toHaveCount(0);
  }
});

test("public sign out retains a failed session for retry and disables duplicate submissions", async ({
  page,
}) => {
  await page.goto("/#customer-sign-in");
  await page
    .getByLabel("Email", { exact: true })
    .fill("pilot-buyer@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic-buyer-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("#workspace-title")).toHaveText("Shop");
  await page.goto("/#products");
  let requests = 0;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/logout", async (route) => {
    requests++;
    if (requests === 1) return route.abort("failed");
    await waiting;
    await route.continue();
  });
  const navigation = page.getByRole("navigation", {
    name: "Public navigation",
  });
  await navigation
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveText(
    "Sign out could not be confirmed. Please try again.",
  );
  await expect(
    navigation.getByRole("link", { name: "My workspace", exact: true }),
  ).toBeVisible();
  expect((await page.request.get("/api/session")).status()).toBe(200);
  await navigation
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  await expect(
    navigation.getByRole("button", { name: "Signing out…", exact: true }),
  ).toBeDisabled();
  expect(requests).toBe(2);
  release();
  await expect(
    navigation.getByRole("link", { name: "Sign in", exact: true }),
  ).toBeVisible();
  expect((await page.request.get("/api/session")).status()).toBe(401);
});

test("public breadcrumbs provide a clear current page and product category return", async ({
  page,
}) => {
  for (const [hash, title] of [
    ["#products", "Products"],
    ["#customer-sign-in", "Customer sign in"],
    ["#admin-sign-in", "Administration sign in"],
    ["#apply", "Trade application"],
    ["#scanner", "Barcode scanner"],
    ["#activate", "Activate account"],
  ]) {
    await page.goto(`/${hash}`);
    const breadcrumb = page.getByRole("navigation", {
      name: "Breadcrumb",
      exact: true,
    });
    await expect(
      breadcrumb.getByRole("link", { name: "Home", exact: true }),
    ).toHaveAttribute("href", "#home");
    await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText(
      title!,
    );
  }
  await page.goto("/#products?category=rtu");
  await page.locator(".gree-product-card").first().click();
  const breadcrumb = page.getByRole("navigation", {
    name: "Breadcrumb",
    exact: true,
  });
  await expect(
    breadcrumb.getByRole("link", { name: "Home", exact: true }),
  ).toBeVisible();
  await expect(
    breadcrumb.getByRole("link", { name: "Products", exact: true }),
  ).toHaveAttribute("href", "#products?category=rtu");
  await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText(
    await page.getByRole("heading", { level: 1 }).innerText(),
  );
  await breadcrumb
    .getByRole("link", { name: "Rooftop Units", exact: true })
    .click();
  await expect(page.locator(".gree-product-card")).toHaveCount(2);
});

test("public product navigation preserves filters, history and keyboard orientation without false missing products", async ({
  page,
}) => {
  await page.goto("/#products");
  const search = page.getByRole("searchbox", {
    name: "Search product families",
  });
  await search.fill("Unix");
  await expect(search).toBeFocused();
  await page.reload();
  await expect(search).toHaveValue("Unix");
  await page.evaluate(() => {
    const observed = window as typeof window & { missingProducts?: string[] };
    observed.missingProducts = [];
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes)
          if (node.textContent?.includes("Product not found"))
            observed.missingProducts!.push(node.textContent);
    }).observe(document.querySelector(".public-main")!, {
      childList: true,
      subtree: true,
    });
  });
  const card = page.locator(".gree-product-card").first();
  const title = await card.locator("h3").innerText();
  await card.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".gree-detail h1")).toHaveText(title);
  await expect(page.locator(".public-main")).toBeFocused();
  await page.goBack();
  await expect(search).toHaveValue("Unix");
  await page.goForward();
  await expect(page.locator(".gree-detail h1")).toHaveText(title);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { missingProducts?: string[] })
          .missingProducts,
    ),
  ).toEqual([]);
  await page.reload();
  await expect(page.locator(".gree-detail h1")).toHaveText(title);
  await page
    .getByRole("navigation", { name: "Breadcrumb", exact: true })
    .getByRole("link", { name: "Products", exact: true })
    .click();
  await expect(search).toHaveValue("Unix");
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { missingProducts?: string[] })
          .missingProducts || [],
    ),
  ).toEqual([]);
});

test("administration tab and breadcrumb survive back forward reload and direct links", async ({
  page,
}) => {
  await page.goto("/#admin-sign-in");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("#workspace-title")).toHaveText("Overview");
  await navigateWorkspace(page, "Administration", "Trade applications");
  const selected = page.getByRole("tab", {
    name: "Trade applications",
    exact: true,
  });
  const trail = page.getByRole("navigation", {
    name: "Workspace breadcrumb",
    exact: true,
  });
  await expect(page).toHaveURL(/section=admin-applications/);
  await expect(trail.locator('[aria-current="page"]')).toHaveText(
    "Trade applications",
  );
  await page.reload();
  await expect(selected).toHaveAttribute("aria-selected", "true");
  await page
    .getByRole("tab", { name: "Staff and buyer access", exact: true })
    .click();
  await page.goBack();
  await expect(selected).toHaveAttribute("aria-selected", "true");
  await page.goForward();
  await expect(trail.locator('[aria-current="page"]')).toHaveText(
    "Staff and buyer access",
  );
  await page.goto("/#page=Administration&section=admin-applications");
  await expect(selected).toHaveAttribute("aria-selected", "true");
});

test("public catalog breadcrumb aligns with content at desktop and phone widths", async ({
  page,
}, testInfo) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#products");
    const trail = page.getByRole("navigation", {
      name: "Breadcrumb",
      exact: true,
    });
    await expect(trail).toBeVisible();
    const breadcrumbBox = await trail.boundingBox();
    const headingBox = await page
      .locator(".gree-library-heading")
      .boundingBox();
    expect(breadcrumbBox!.x).toBeCloseTo(headingBox!.x, 0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`pass1-catalog-${width}.png`),
      fullPage: true,
    });
  }
});

test("public pricing entry preserves equipment for guests and staff and reaches buyer pricing", async ({
  page,
}, testInfo) => {
  await page.goto("/#products");
  await page.locator(".gree-product-card").first().click();
  const pricing = page.getByRole("link", {
    name: "Log in to see pricing",
    exact: true,
  });
  await expect(pricing).toHaveCount(2);
  const href = await pricing.first().getAttribute("href");
  expect(href).toMatch(/^#customer-sign-in\?referenceFamily=/);
  await page.screenshot({
    path: testInfo.outputPath("guest-product-pricing.png"),
    fullPage: true,
  });
  await pricing.first().click();
  await expect(
    page.getByRole("heading", { name: "Customer sign in.", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(
    new RegExp(href!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"),
  );
  await page
    .getByLabel("Email", { exact: true })
    .fill("pilot-buyer@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic-buyer-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("#workspace-title")).toHaveText("Shop");
  const reference = new URLSearchParams(href!.split("?")[1]).get(
    "referenceFamily",
  );
  await expect(page).toHaveURL(new RegExp(`referenceFamily=${reference}`));
  await page.goto("/#home");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      page.locator('.public-header a[href="#page=Shop"]'),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
    await page.screenshot({
      path: testInfo.outputPath(`buyer-card-${width}.png`),
      fullPage: true,
    });
  }
  await page.goto("/#products");
  await page.locator(".gree-product-card").first().click();
  await expect(pricing).toHaveCount(0);
  const buyerPricing = page
    .locator(".gree-detail-actions")
    .getByRole("link", { name: "View account pricing", exact: false });
  await expect(buyerPricing).toHaveAttribute(
    "href",
    /^#page=Shop&referenceFamily=/,
  );
  await page
    .getByRole("navigation", { name: "Public navigation", exact: true })
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  await expect(
    page
      .getByRole("navigation", { name: "Public navigation", exact: true })
      .getByRole("link", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await page.goto("/#admin-sign-in");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("#workspace-title")).toHaveText("Overview");
  await page.goto("/#customer-sign-in");
  await expect(
    page.getByRole("heading", { name: "Customer sign in.", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Customer sign in.", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Public navigation", exact: true })
    .getByRole("link", { name: "Staff workspace", exact: true })
    .click();
  await expect(page.locator("#workspace-title")).toHaveText("Overview");
  await page.goto("/#products");
  await page.locator(".gree-product-card").first().click();
  await expect(pricing).toHaveCount(2);
  await expect(
    page
      .locator(".gree-detail")
      .getByRole("link", { name: "Open staff workspace", exact: false }),
  ).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("staff-product-pricing.png"),
    fullPage: true,
  });
  await pricing.first().click();
  await expect(
    page.getByRole("heading", { name: "Customer sign in.", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("You are signed in to staff operations.", { exact: false }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Customer sign in.", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Use an approved customer account" })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Customer sign in.", exact: true }),
  ).toBeVisible();
  expect(
    (await (await page.request.get("/api/session")).json()).actor.role,
  ).toBe("admin");
  const customerEntry = page.url();
  await page
    .getByRole("navigation", { name: "Public navigation", exact: true })
    .getByRole("link", { name: "Staff workspace", exact: true })
    .click();
  await expect(page.locator("#workspace-title")).toHaveText("Overview");
  await page.goto(customerEntry);
  await expect(
    page.getByRole("heading", { name: "Customer sign in.", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Email", { exact: true })
    .fill("pilot-buyer@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic-buyer-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("#workspace-title")).toHaveText("Shop");
  await expect(page).toHaveURL(new RegExp(`referenceFamily=${reference}`));
  expect(
    (await (await page.request.get("/api/session")).json()).actor.role,
  ).toBe("buyer");
});
