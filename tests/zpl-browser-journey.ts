import { navigateWorkspace, openStockActions } from "./workspace-navigation.ts";
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

for (const output of ["zpl-8", "zpl-12"] as const) {
  test(`browser: reviewed ${output} phone download refuses invalid bytes and reuses the committed lost-response receipt`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const errors: string[] = [],
      downloads: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("download", (d) => downloads.push(d.suggestedFilename()));
    await page.goto("/#sign-in");
    await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
    await page
      .getByLabel("Password", { exact: true })
      .fill("long-test-only-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    const before = await (await page.request.get("/api/dashboard")).json();
    const u = before.stock.find(
      (s: any) => s.state === "stock" && s.quantity > 0 && s.serial,
    );
    expect(u).toBeTruthy();
    const history = await (await page.request.get("/api/stock/labels")).json();
    const requests: { key: string; payload: unknown }[] = [];
    let mode = "lost";
    await page.route(`**/api/stock/${u.id}/label`, async (route) => {
      requests.push({
        key: route.request().headers()["idempotency-key"]!,
        payload: route.request().postDataJSON(),
      });
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      if (mode === "lost") {
        await route.abort("failed");
        return;
      }
      const headers = response.headers();
      let body = await response.body();
      if (mode === "media")
        headers["content-type"] = "application/octet-stream-incorrect";
      if (mode === "filename")
        headers["content-disposition"] = 'attachment; filename="foreign.zpl"';
      if (mode === "hash") headers["x-document-sha256"] = "0".repeat(64);
      if (mode === "empty") {
        body = Buffer.alloc(0);
        headers["x-document-sha256"] = createHash("sha256")
          .update(body)
          .digest("hex");
      }
      if (mode === "receipt") delete headers["x-download-receipt"];
      if (mode === "oversize") {
        body = Buffer.alloc(4000001, 65);
        headers["x-document-sha256"] = createHash("sha256")
          .update(body)
          .digest("hex");
      }
      // Fulfilled invalid responses are browser simulations; the actual server
      // has already committed the same immutable preparation before every reply.
      delete headers["content-length"];
      await route.fulfill({ status: 200, headers, body });
    });
    await navigateWorkspace(page, "Inventory", "Stock");
    const row = page.getByRole("row").filter({
      has: page.locator("small", { hasText: `${u.serial} · stock` }),
    });
    await openStockActions(row);
    await row
      .getByRole("button", { name: "Prepare QR label", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Prepare stock QR label",
      exact: true,
    });
    await expect(dialog).toContainText(u.serial);
    await expect(
      dialog.getByLabel("Label output", { exact: true }),
    ).toHaveValue("pdf");
    await dialog
      .getByLabel("Label output", { exact: true })
      .selectOption(output);
    await dialog
      .getByLabel("Copies (including deliberate duplicates)", { exact: true })
      .fill("2");
    const storageKey = `distributor-label:${u.id}:${u.revision}:2:${output}`;
    for (const fault of [
      "lost",
      "media",
      "filename",
      "hash",
      "empty",
      "receipt",
      "oversize",
    ]) {
      mode = fault;
      const count = requests.length;
      await dialog
        .getByRole("button", { name: "Prepare and download", exact: true })
        .click();
      await expect.poll(() => requests.length).toBe(count + 1);
      await expect(
        dialog.getByRole("button", {
          name: "Prepare and download",
          exact: true,
        }),
      ).toBeEnabled();
      await expect(dialog.getByRole("alert")).toBeVisible();
      if (["media", "filename", "hash", "empty"].includes(fault))
        await expect(dialog.getByRole("alert")).toContainText(
          "integrity check failed",
        );
      if (fault === "receipt")
        await expect(dialog.getByRole("alert")).toContainText(
          "receipt is missing",
        );
      if (fault === "oversize")
        await expect(dialog.getByRole("alert")).toContainText(
          "exceeds its size limit",
        );
      expect(
        await page.evaluate((key) => sessionStorage.getItem(key), storageKey),
      ).toBe(requests[0]!.key);
      expect(downloads).toEqual([]);
      const retained = await (
        await page.request.get("/api/stock/labels")
      ).json();
      expect(retained.length).toBe(history.length + 1);
      expect(retained[0].facts.output).toBe(output);
    }
    mode = "ok";
    const downloadEvent = page.waitForEvent("download");
    await dialog
      .getByRole("button", { name: "Prepare and download", exact: true })
      .click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe(`Stock_${u.id}_${output}.zpl`);
    const bytes = await readFile((await download.path())!);
    expect(bytes.toString("ascii").match(/\^XA/g)).toHaveLength(2);
    expect(bytes.toString("ascii")).toContain(
      output === "zpl-8" ? "^PW800\n^LL400" : "^PW1200\n^LL600",
    );
    await expect(dialog).toHaveCount(0);
    expect(requests).toHaveLength(8);
    for (const request of requests) {
      expect(request.key).toBe(requests[0]!.key);
      expect(request.payload).toEqual({
        revision: u.revision,
        copies: 2,
        output,
      });
    }
    expect(
      await page.evaluate((key) => sessionStorage.getItem(key), storageKey),
    ).toBeNull();
    const receipts = await (await page.request.get("/api/stock/labels")).json();
    expect(receipts.length).toBe(history.length + 1);
    expect(receipts[0].copies).toBe(2);
    expect(receipts[0].state).toBe("prepared");
    expect(receipts[0].content_hash).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect(
      (await (await page.request.get("/api/dashboard")).json()).stock,
    ).toEqual(before.stock);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
}
