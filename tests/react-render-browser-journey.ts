import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { build } from "vite";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";

let bundle = "";
test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: "warn",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      write: false,
      minify: false,
      lib: {
        entry: fileURLToPath(
          new URL("./react-render-browser-fixture.tsx", import.meta.url),
        ),
        name: "RenderFixture",
        formats: ["iife"],
      },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  if (outputs.length !== 1 || !outputs[0] || !("output" in outputs[0]))
    throw Error("Expected one fixture bundle");
  const script = outputs[0].output.find((item) => item.type === "chunk");
  if (!script || script.type !== "chunk") throw Error("Missing fixture script");
  bundle = script.code;
});
async function open(page: Page, info: TestInfo, kind: string, change: string) {
  // Only the intercepted test URL gets this bundle; it is never in product dist.
  const path = info.outputPath("render-fixture.js");
  await writeFile(path, bundle);
  await info.attach("production React fixture", {
    path,
    contentType: "text/javascript",
  });
  await page.route("**/render-fixture.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: bundle }),
  );
  await page.route("**/render-fixture?*", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<meta charset="utf-8"><div id="root"></div><script src="/render-fixture.js"></script>',
    }),
  );
  await page.goto(`/render-fixture?kind=${kind}&change=${change}`);
}
for (const kind of ["order", "claim"]) {
  for (const change of ["source", "active"]) {
    test(`browser: ${kind} queue accepts the visible request during an abandoned ${change} render`, async ({
      page,
    }, info) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await open(page, info, kind, change);
      let release!: () => void, began!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve)),
        started = new Promise<void>((resolve) => (began = resolve));
      await page.route(
        kind === "order"
          ? "**/api/orders/page?*"
          : "**/api/warranty/claims/page?*",
        async (route) => {
          expect(new URL(route.request().url()).searchParams.get("after")).toBe(
            "initial-cursor",
          );
          began();
          await held;
          await route.fulfill({
            json: { items: [{ id: "continued" }], next: null },
          });
        },
      );
      await page
        .getByRole("button", { name: "Continue queue", exact: true })
        .click();
      await started;
      await expect(
        page.getByRole("status", { name: "Queue request", exact: true }),
      ).toHaveText("initial · busy");
      await page
        .getByRole("button", { name: "Suspend update", exact: true })
        .click();
      await page.waitForFunction(() => window.renderFixture.attempts > 0);
      await expect(
        page.getByText("Suspended fallback", { exact: true }),
      ).toHaveCount(0);
      release();
      await expect(
        page.getByRole("status", { name: "Queue request", exact: true }),
      ).toHaveText("initial,continued · idle");
      await page
        .getByRole("button", { name: "Cancel update", exact: true })
        .click();
      await expect(
        page.getByRole("status", { name: "Queue request", exact: true }),
      ).toHaveText("initial,continued · idle");
      expect(errors).toEqual([]);
    });
  }
}
for (const change of ["busy", "callback"]) {
  test(`browser: dialog Escape uses visible ${change} during an abandoned render`, async ({
    page,
  }, info) => {
    await open(page, info, "dialog", change);
    const dialog = page.getByRole("dialog", {
      name: "Review fixture",
      exact: true,
    });
    await expect(dialog.getByLabel("Reason", { exact: true })).toBeFocused();
    await page
      .getByRole("button", { name: "Suspend update", exact: true })
      .click();
    await page.waitForFunction(() => window.renderFixture.attempts > 0);
    await expect(
      dialog.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeEnabled();
    await dialog.getByLabel("Reason", { exact: true }).press("Escape");
    await expect(page.getByLabel("Close actions", { exact: true })).toHaveText(
      "visible",
    );
  });
}

for (const change of ["busy", "callback"]) {
  test(`browser: dialog Escape observes a committed ${change} update`, async ({
    page,
  }, info) => {
    await open(page, info, "dialog", change);
    const dialog = page.getByRole("dialog", {
      name: "Review fixture",
      exact: true,
    });
    await expect(dialog.getByLabel("Reason", { exact: true })).toBeFocused();
    await page
      .getByRole("button", { name: "Commit update", exact: true })
      .click();
    await dialog.getByLabel("Reason", { exact: true }).press("Escape");
    if (change === "busy") {
      await expect(
        dialog.getByRole("button", { name: "Cancel", exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByLabel("Close actions", { exact: true }),
      ).toHaveText("none");
      await page
        .getByRole("button", { name: "Cancel update", exact: true })
        .click();
      await dialog.getByLabel("Reason", { exact: true }).press("Escape");
      await expect(
        page.getByLabel("Close actions", { exact: true }),
      ).toHaveText("visible");
    } else {
      await expect(
        page.getByLabel("Close actions", { exact: true }),
      ).toHaveText("committed");
    }
  });
}
