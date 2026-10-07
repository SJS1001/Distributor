import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture } from "./fixtures.ts";
import { greeSampleProducts } from "../src/demo/gree-pilot-seed.ts";
import {
  greeFamilyImages,
  greeFamilyImagePermission,
  readGreeFamilyImages,
  seedGreeFamilyImages,
} from "../src/demo/gree-family-images.ts";

function existingProducts(f: ReturnType<typeof fixture>) {
  return greeSampleProducts.map(
    (sample, index) =>
      f.app.catalog.create(f.actor, `photo-product-${index}`, {
        sku: sample.sku,
        name: sample.name,
        serialized: !("bulk" in sample),
        unitPrice: sample.price,
        taxBasisPoints: 1300,
      }).id,
  );
}

test("eight photographs retain exact reviewed source identities and truthful family metadata", () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL("../docs/catalog/gree-source-library.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(greeFamilyImages.length, 8);
  assert.equal(new Set(greeFamilyImages.map((image) => image.sha256)).size, 7);
  for (const [index, image] of greeFamilyImages.entries()) {
    const family = manifest.families[index];
    assert.equal(image.sampleSku, family.sampleSku);
    assert.equal(image.productPage, family.productPage);
    for (const field of ["sourceUrl", "localFile", "sha256", "bytes"] as const)
      assert.equal(image[field], family.images[0][field]);
    assert.match(image.altText, /representative|publisher also uses/);
  }
  assert.match(
    greeFamilyImages[7]!.altText,
    /exact supplied model is unverified/,
  );
  assert.match(greeFamilyImagePermission, /2026-10-05/);
  assert.match(greeFamilyImagePermission, /2026-10-07/);
});

test("private source validation rejects substituted or missing photographs", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "gree-photo-input-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const image of greeFamilyImages)
    writeFileSync(join(directory, image.localFile), Buffer.alloc(image.bytes));
  await assert.rejects(
    readGreeFamilyImages(directory),
    /differ from the reviewed source/,
  );
});

test("photo operation checks the entire original receipt before source reads or native writes", async (t) => {
  const f = fixture(t);
  const ids = existingProducts(f);
  for (const incorrect of [
    ids.slice(0, 8),
    [...ids].reverse(),
    [f.product, ...ids.slice(1)],
    [ids[0]!, ...ids.slice(0, 10)],
  ]) {
    await assert.rejects(
      seedGreeFamilyImages(
        f.app,
        f.actor,
        { productIds: incorrect },
        "/absent-private-photos",
      ),
      /exact original Canadian pilot/,
    );
  }
  for (const id of ids)
    assert.equal(f.app.catalogMedia.list(f.actor, id).items.length, 0);
  await assert.rejects(
    seedGreeFamilyImages(f.app, f.actor, ids, "/absent-private-photos"),
    /ENOENT/,
  );
  for (const id of ids)
    assert.equal(f.app.catalogMedia.list(f.actor, id).items.length, 0);
});

test("photo operation requires current administrator and CA/CAD authority", async (t) => {
  const f = fixture(t);
  const ids = existingProducts(f);
  const user = f.app.identity.createUser(f.actor, "photo-commercial", {
    email: "photo-commercial@example.test",
    name: "Commercial photo test",
    password: "test-only-commercial-password",
    currentPassword: "long-test-only-password",
    role: "commercial",
    sites: [f.w1],
  });
  assert.ok(user.id);
  const commercial = f.app.identity.login(
    "photo-commercial@example.test",
    "test-only-commercial-password",
  ).actor;
  await assert.rejects(
    seedGreeFamilyImages(f.app, commercial, ids, "/absent-private-photos"),
    /not permitted/,
  );
  const us = fixture(t, {}, "US", "USD");
  const usIds = existingProducts(us);
  await assert.rejects(
    seedGreeFamilyImages(us.app, us.actor, usIds, "/absent-private-photos"),
    /exact original Canadian pilot/,
  );
});
