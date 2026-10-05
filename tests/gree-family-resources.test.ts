import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "../src/server/application.ts";
import {
  seedGreePilot,
  seedGreeFamilyReferences,
} from "../src/demo/gree-pilot-seed.ts";

test("Gree family references publish scoped official links without binary or exact-model claims", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "gree-resources-"));
  const app = new Application(join(directory, "app.db"), "CA");
  t.after(() => {
    app.close();
    rmSync(directory, { recursive: true });
  });
  const currentPassword = "only-for-local-test-admin";
  const actor = app.identity.bootstrap(
    "Sample pilot",
    "admin@example.test",
    currentPassword,
    "CAD",
  );
  const receipt = seedGreePilot(app, actor, {
    currentPassword,
    buyerEmail: "buyer@example.test",
    buyerPassword: "only-for-local-test-buyer",
  });
  const resources = await seedGreeFamilyReferences(
    app,
    actor,
    receipt.productIds,
  );
  assert.equal(resources.length, 8);
  for (const resource of resources) {
    assert.equal(resource.state, "published");
    assert.equal(resource.bytes, 0);
    assert.equal(resource.inspection, "link");
    assert.match(
      resource.externalUrl!,
      /^https:\/\/greehvac\.ca\/heacool_services\//,
    );
    assert.match(
      resource.models,
      /exact model\/capacity\/voltage not verified/,
    );
    assert.throws(() =>
      app.catalogMedia.bytes(actor, resource.productId, resource.id),
    );
  }
  assert.equal(
    app.catalogMedia.list(actor, receipt.productIds[8]!).items.length,
    0,
  );
  const replay = await seedGreeFamilyReferences(app, actor, receipt);
  assert.deepEqual(replay, resources);
  await assert.rejects(
    seedGreeFamilyReferences(app, actor, [...receipt.productIds].reverse()),
    /matching fictional/,
  );
  assert.equal(app.catalog.products(actor).length, 11);
});
