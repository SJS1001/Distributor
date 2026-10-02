import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rehearsalConfig } from "../scripts/rehearsal-fixture.ts";
import { runRehearsal } from "../scripts/rehearsal.ts";

test("load rehearsal refuses store paths, inherited field names and excessive or fractional workloads", () => {
  for (const input of [
    { databasePath: "/existing/store.db" },
    { toString: 1 },
    { writers: 2.5 },
    { catalogProducts: 1000, unitsPerProductPerWarehouse: 500 },
    { readClients: 33 },
  ])
    assert.throws(() => rehearsalConfig(input));
});

test("load rehearsal checks SKU and warehouse demand including the pending order", () => {
  assert.throws(
    () =>
      rehearsalConfig({
        catalogProducts: 2,
        unitsPerProductPerWarehouse: 2,
        writers: 4,
        ordersPerWriter: 2,
      }),
    /Synthetic stock must cover/,
  );
  assert.doesNotThrow(() =>
    rehearsalConfig({
      catalogProducts: 2,
      unitsPerProductPerWarehouse: 3,
      writers: 4,
      ordersPerWriter: 2,
    }),
  );
});

test(
  "independent regional writers and HTTP readers restore the cutoff without copied sessions or duplicate invoices",
  { timeout: 60000 },
  async () => {
    const outside = await mkdtemp(
      join(tmpdir(), "distributor-rehearsal-existing-"),
    );
    const existing = join(outside, "existing.db"),
      sentinel = "Existing store must remain untouched";
    await writeFile(existing, sentinel, { mode: 0o600 });
    const before = {
      database: process.env.DATABASE_PATH,
      options: process.env.NODE_OPTIONS,
    };
    let receipt: Awaited<ReturnType<typeof runRehearsal>>;
    try {
      process.env.DATABASE_PATH = existing;
      process.env.NODE_OPTIONS =
        "--import=/intentionally-missing-rehearsal-preload.js";
      receipt = await runRehearsal({
        catalogProducts: 4,
        unitsPerProductPerWarehouse: 4,
        writers: 2,
        ordersPerWriter: 2,
        readClients: 1,
        readsPerClient: 6,
        deadlineMs: 60000,
      });
    } finally {
      for (const [key, value] of [
        ["DATABASE_PATH", before.database],
        ["NODE_OPTIONS", before.options],
      ]) {
        if (value === undefined) delete process.env[key!];
        else process.env[key!] = value;
      }
    }
    assert.equal(await readFile(existing, "utf8"), sentinel);
    assert.equal(receipt.status, "PASS", receipt.error);
    assert.equal(receipt.regions.length, 2);
    assert.equal((await stat(receipt.work)).mode & 0o777, 0o700);
    const encoded = await readFile(join(receipt.work, "receipt.json"), "utf8");
    assert(!encoded.includes("distributor_session="));
    assert.equal(
      (await stat(join(receipt.work, "receipt.json"))).mode & 0o777,
      0o600,
    );
    for (const raw of receipt.regions) {
      const region = raw as {
        region: string;
        httpRequests: number;
        overlappedReads: number;
        postCutoffExcludedSales: number;
        processIds: number[];
        copiedSessionRejected: boolean;
        restoredProviderHold: boolean;
        pendingOrderResumedOnce: boolean;
        cutoff: { actual: { billing: { invoices: number } } };
        live: { actual: { billing: { invoices: number } } };
        resumed: { actual: { billing: { invoices: number } } };
      };
      assert.equal(region.httpRequests, 6);
      assert(region.overlappedReads > 0);
      assert.equal(region.postCutoffExcludedSales, 2);
      assert.equal(region.cutoff.actual.billing.invoices, 2);
      assert.equal(region.live.actual.billing.invoices, 4);
      assert.equal(region.resumed.actual.billing.invoices, 3);
      assert(
        region.copiedSessionRejected &&
          region.restoredProviderHold &&
          region.pendingOrderResumedOnce,
      );
      assert.equal(region.processIds.length, 3);
      for (const pid of region.processIds)
        assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
      const samples = JSON.parse(
        await readFile(
          join(receipt.work, region.region, "http-samples.json"),
          "utf8",
        ),
      ) as unknown[];
      assert.equal(samples.length, 6);
    }
  },
);
