import { test } from "node:test";
import assert from "node:assert/strict";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Application } from "../src/server/application.ts";
import { fixture } from "./fixtures.ts";
import { CatalogMedia } from "../src/server/catalog-media.ts";
import { normalizeCatalogPdf } from "../src/server/catalog-pdf.ts";
import { catalogImageLinkUrl } from "../src/shared/catalog-media.ts";
const image = () => {
  const canvas = createCanvas(10, 10);
  canvas.getContext("2d").fillRect(0, 0, 10, 10);
  return {
    kind: "image" as const,
    title: "Synthetic equipment",
    altText: "Synthetic equipment unit",
    mediaType: "image/png" as const,
    contentBase64: canvas.toBuffer("image/png").toString("base64"),
  };
};
const permission = {
  permissionAffirmed: true,
  permissionBasis: "Synthetic fixture owned artwork",
};
function media(f: ReturnType<typeof fixture>) {
  return new CatalogMedia(
    f.app.database,
    f.app.identity,
    f.app.platform,
    f.app.catalog,
  );
}
function buyer(f: ReturnType<typeof fixture>) {
  const user = f.app.identity.createUser(f.actor, "media-buyer", {
    name: "buyer",
    email: "buyer@media.test",
    password: "long-test-only-password",
    role: "buyer",
    accountId: f.buyer,
    sites: [],
  });
  return f.app.identity.currentActor({ ...f.actor, id: user.id });
}
test("resource image draft/publish/order/edit/retire and exact retries retain immutable history", async (t) => {
  const f = fixture(t);
  const m = media(f),
    b = buyer(f);
  const input = image();
  const checkPublishedProjection = (expected: boolean) => {
    assert.equal(
      f.app.catalog.customerProducts(b, f.buyer).find((p) => p.id === f.product)
        ?.hasPublishedImage,
      expected,
    );
    assert.equal(
      f.app.catalog
        .customerProductPage(b, f.buyer, undefined, "", "", f.product)
        .items.find((p) => p.id === f.product)?.hasPublishedImage,
      expected,
    );
    assert.equal(
      f.app.catalog.selectedCustomerProducts(b, f.buyer, [f.product])[0]
        ?.hasPublishedImage,
      expected,
    );
  };
  checkPublishedProjection(false);
  const r = await m.upload(f.actor, "upload", f.product, input);
  assert.equal(r.state, "draft");
  assert.equal(r.inspection, "normalized");
  assert.deepEqual(await m.upload(f.actor, "upload", f.product, input), r);
  assert.equal(m.list(b, f.product).items.length, 0);
  checkPublishedProjection(false);
  assert.throws(() => m.bytes(b, f.product, r.id), /not found/);
  await assert.rejects(
    m.publish(f.actor, "bad-permission", f.product, r.id, {
      expectedVersion: 1,
      ...permission,
      permissionAffirmed: false,
    }),
    /Confirm/,
  );
  const published = await m.publish(f.actor, "publish", f.product, r.id, {
    expectedVersion: 1,
    ...permission,
  });
  assert.deepEqual(
    await m.publish(f.actor, "publish", f.product, r.id, {
      expectedVersion: 1,
      ...permission,
    }),
    published,
  );
  assert.equal(m.list(b, f.product).items.length, 1);
  checkPublishedProjection(true);
  assert.equal(m.bytes(b, f.product, r.id).bytes.length, r.bytes);
  assert.throws(
    () =>
      m.update(f.actor, "stale", f.product, r.id, {
        expectedVersion: 1,
        title: "Stale",
      }),
    /changed/,
  );
  const edited = m.update(f.actor, "edit", f.product, r.id, {
    expectedVersion: 2,
    title: "Updated",
    position: 4,
  });
  assert.equal(edited.state, "draft");
  checkPublishedProjection(false);
  assert.equal(m.list(b, f.product).items.length, 0);
  const republished = await m.publish(f.actor, "republish", f.product, r.id, {
    expectedVersion: 3,
    ...permission,
  });
  checkPublishedProjection(true);
  const retired = m.retire(f.actor, "retire", f.product, r.id, {
    expectedVersion: republished.version,
    reason: "Superseded fixture",
  });
  assert.equal(retired.state, "retired");
  checkPublishedProjection(false);
  assert.equal(m.list(b, f.product).items.length, 0);
  assert.throws(() => m.bytes(b, f.product, r.id), /not found/);
  assert.equal(m.history(f.actor, f.product, r.id).items.length, 5);
  assert.throws(
    () =>
      f.app.database
        .owned("catalog")
        .run("DELETE FROM catalog_resource_history"),
    /immutable/,
  );
});
test("resource upload rejects malformed, oversized, active formats and scope escalation", async (t) => {
  const f = fixture(t),
    m = media(f),
    b = buyer(f);
  await assert.rejects(
    m.upload(b, "forbidden", f.product, image()),
    /not permitted/,
  );
  await assert.rejects(
    m.upload(f.actor, "malformed", f.product, {
      ...image(),
      contentBase64: "AAAA",
    }),
    /Bytes/,
  );
  await assert.rejects(
    m.upload(f.actor, "oversized", f.product, {
      ...image(),
      contentBase64: "A".repeat(12 * 1024 * 1024),
    }),
    /limit/,
  );
  await assert.rejects(
    m.upload(f.actor, "canonical", f.product, {
      ...image(),
      contentBase64: "A===",
    }),
    /canonical/,
  );
  await assert.rejects(
    m.upload(f.actor, "svg", f.product, {
      ...image(),
      contentBase64: Buffer.from("<svg/>").toString("base64"),
      mediaType: "image/svg+xml" as never,
    }),
    /JPEG/,
  );
  await assert.rejects(
    m.upload(f.actor, "link-js", f.product, {
      kind: "maintenance",
      title: "Unsafe",
      externalUrl: "javascript:alert(1)",
    }),
    /HTTPS/,
  );
  await assert.rejects(
    m.upload(f.actor, "link-credentials", f.product, {
      kind: "maintenance",
      title: "Unsafe",
      externalUrl: "https://user:pass@example.test/file.pdf",
    }),
    /HTTPS/,
  );
  const r = await m.upload(f.actor, "image", f.product, image());
  assert.throws(() => m.bytes({ ...f.actor, orgId: "other" }, f.product, r.id));
  const p = f.app.catalog.create(f.actor, "other-product", {
    sku: "OTHER",
    name: "Other",
    serialized: false,
    unitPrice: 100,
    taxBasisPoints: 0,
  });
  assert.throws(() => m.bytes(f.actor, p.id, r.id), /not found/);
});
test("HTTPS resource links never fetch, remain draft and require permission", async (t) => {
  const f = fixture(t),
    m = media(f);
  const r = await m.upload(f.actor, "link", f.product, {
    kind: "installation",
    title: "Official link",
    externalUrl: "https://example.invalid/manual.pdf",
    source: "Synthetic source",
  });
  assert.equal(r.externalUrl, "https://example.invalid/manual.pdf");
  assert.equal(r.bytes, 0);
  assert.equal(r.state, "draft");
  await m.publish(f.actor, "link-publish", f.product, r.id, {
    expectedVersion: 1,
    ...permission,
  });
  assert.throws(() => m.bytes(f.actor, f.product, r.id), /external link/);
});
test("linked equipment images retain exact rights-reviewed lifecycle, scope and zero bytes", async (t) => {
  const f = fixture(t),
    m = media(f),
    b = buyer(f);
  let fetches = 0;
  t.mock.method(globalThis, "fetch", async () => {
    fetches++;
    throw new Error("Catalog image links must never fetch");
  });
  const input = {
    kind: "image" as const,
    title: "Official equipment image",
    altText: "Equipment indoor unit and outdoor unit",
    externalUrl: "https://cdn.shopify.com/s/files/fixture/equipment.png?v=1",
    source: "Owner-authorized manufacturer image reference; fixture only",
  };
  const r = await m.upload(f.actor, "linked-image", f.product, input);
  assert.equal(r.state, "draft");
  assert.equal(r.inspection, "link");
  assert.equal(r.mediaType, "text/uri-list");
  assert.equal(r.bytes, 0);
  assert.equal(r.externalUrl, input.externalUrl);
  assert.equal(
    f.app.database
      .owned("catalog")
      .get<{ bytes: number }>(
        "SELECT length(content) AS bytes FROM catalog_resources WHERE id=?",
        r.id,
      )!.bytes,
    0,
  );
  assert.deepEqual(
    await m.upload(f.actor, "linked-image", f.product, input),
    r,
  );
  await assert.rejects(
    m.upload(f.actor, "linked-image", f.product, {
      ...input,
      externalUrl: `${input.externalUrl}2`,
    }),
    /different inputs/,
  );
  assert.deepEqual(m.list(b, f.product).items, []);
  assert.throws(() => m.bytes(b, f.product, r.id), /not found/);
  await assert.rejects(
    m.publish(f.actor, "missing-rights", f.product, r.id, {
      expectedVersion: 1,
      ...permission,
      permissionAffirmed: false,
    }),
    /Confirm/,
  );
  const published = await m.publish(
    f.actor,
    "linked-publish",
    f.product,
    r.id,
    {
      expectedVersion: 1,
      ...permission,
    },
  );
  assert.deepEqual(m.list(b, f.product).items, [published]);
  assert.throws(() => m.bytes(b, f.product, r.id), /external link/);
  assert.throws(() => m.history(b, f.product, r.id), /not permitted/);
  const policy = f.app.catalog.purchasingPolicy(f.actor, f.buyer);
  f.app.catalog.setPurchasingPolicy(f.actor, "linked-revoke", {
    ...policy,
    mode: "none",
    productIds: [],
    reason: "Image access entitlement revoked",
  });
  assert.throws(() => m.list(b, f.product));
  assert.throws(() => m.bytes(b, f.product, r.id));
  f.app.catalog.setPurchasingPolicy(f.actor, "linked-restore", {
    ...policy,
    revision: f.app.catalog.purchasingPolicy(f.actor, f.buyer).revision,
    reason: "Restore fixture image entitlement",
  });
  const p = f.app.catalog.create(f.actor, "linked-other", {
    sku: "LINKED-OTHER",
    name: "Other product",
    serialized: false,
    unitPrice: 100,
    taxBasisPoints: 0,
  });
  assert.throws(() => m.bytes(f.actor, p.id, r.id), /not found/);
  assert.throws(() => m.list({ ...b, orgId: "other" }, f.product));
  assert.throws(
    () =>
      m.update(f.actor, "linked-stale", f.product, r.id, {
        expectedVersion: 1,
        title: "Stale edit",
      }),
    /changed/,
  );
  const updated = m.update(f.actor, "linked-edit", f.product, r.id, {
    expectedVersion: 2,
    position: 5,
  });
  assert.equal(updated.state, "draft");
  assert.deepEqual(m.list(b, f.product).items, []);
  const republished = await m.publish(
    f.actor,
    "linked-republish",
    f.product,
    r.id,
    {
      expectedVersion: updated.version,
      ...permission,
    },
  );
  const retired = m.retire(f.actor, "linked-retire", f.product, r.id, {
    expectedVersion: republished.version,
    reason: "Image source superseded",
  });
  assert.equal(retired.state, "retired");
  assert.deepEqual(m.list(b, f.product).items, []);
  assert.throws(() => m.bytes(b, f.product, r.id), /not found/);
  assert.equal(
    m.list(f.actor, f.product).items[0]!.externalUrl,
    input.externalUrl,
  );
  assert.equal(m.history(f.actor, f.product, r.id).items.length, 5);
  assert.equal(fetches, 0);
});
test("linked images share bounded HTTPS host validation and reject mixed inputs and malicious URLs", async (t) => {
  const f = fixture(t),
    m = media(f),
    b = buyer(f);
  const input = {
    kind: "image" as const,
    title: "Equipment image",
    altText: "Equipment unit",
    externalUrl: "https://cdn.shopify.com/fixture.png",
  };
  assert.equal(
    catalogImageLinkUrl(" HTTPS://CDN.SHOPIFY.COM:443/fixture.png "),
    input.externalUrl,
  );
  const invalid = [
    "http://cdn.shopify.com/fixture.png",
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "//cdn.shopify.com/fixture.png",
    "https:cdn.shopify.com/fixture.png",
    "https://user:pass@cdn.shopify.com/fixture.png",
    "https://cdn.shopify.com@evil.test/fixture.png",
    "https://cdn.shopify.com.evil.test/fixture.png",
    "https://sub.cdn.shopify.com/fixture.png",
    "https://cdn.shopify.com./fixture.png",
    "https://127.0.0.1/fixture.png",
    "https://cdn.shopify.com:444/fixture.png",
    "https://cdn.shopify.com\\@evil.test/fixture.png",
    "https://cdn.shopify.com/fixture\n.png",
    `https://cdn.shopify.com/${"x".repeat(2000)}`,
  ];
  for (const [i, externalUrl] of invalid.entries()) {
    assert.equal(catalogImageLinkUrl(externalUrl), null, externalUrl);
    await assert.rejects(
      m.upload(f.actor, `bad-image-link-${i}`, f.product, {
        ...input,
        externalUrl,
      }),
      /Image links/,
    );
  }
  await assert.rejects(
    m.upload(f.actor, "linked-mixed-bytes", f.product, {
      ...image(),
      externalUrl: input.externalUrl,
    }),
    /Choose one/,
  );
  await assert.rejects(
    m.upload(f.actor, "linked-mixed-type", f.product, {
      ...input,
      mediaType: "image/png",
    }),
    /Choose one/,
  );
  await assert.rejects(
    m.upload(f.actor, "linked-no-alt", f.product, { ...input, altText: "" }),
    /alternative text/,
  );
  await assert.rejects(
    m.upload(b, "linked-buyer", f.product, input),
    /not permitted/,
  );
  assert.deepEqual(m.list(f.actor, f.product).items, []);
});
test("retired linked images remain retained and count toward the product resource quota", async (t) => {
  const f = fixture(t),
    m = media(f);
  const input = {
    kind: "image" as const,
    title: "Equipment image",
    altText: "Equipment unit",
    externalUrl: "https://cdn.shopify.com/fixture.png",
  };
  const first = await m.upload(f.actor, "linked-quota-0", f.product, input);
  m.retire(f.actor, "linked-quota-retire", f.product, first.id, {
    expectedVersion: 1,
    reason: "Retained image source history",
  });
  for (let i = 1; i < 40; i++)
    await m.upload(f.actor, `linked-quota-${i}`, f.product, input);
  await assert.rejects(
    m.upload(f.actor, "linked-quota-overflow", f.product, input),
    /quota/,
  );
  assert.equal(m.list(f.actor, f.product).items.length, 40);
});
test("PDF normalization removes original active actions and admits uploaded manuals after explicit rights", async (t) => {
  const f = fixture(t),
    m = media(f);
  const pdf = await PDFDocument.create();
  pdf
    .addPage([100, 100])
    .drawText("Synthetic manual", { x: 5, y: 50, size: 8 });
  pdf.catalog.set(
    PDFName.of("OpenAction"),
    pdf.context.obj({
      S: PDFName.of("JavaScript"),
      JS: PDFString.of('app.alert("unsafe")'),
    }),
  );
  const raw = Buffer.from(await pdf.save());
  const normalized = await normalizeCatalogPdf(raw);
  const result = await PDFDocument.load(normalized);
  assert.equal(result.getPageCount(), 1);
  assert.equal(result.catalog.get(PDFName.of("OpenAction")), undefined);
  assert.equal(normalized.includes(Buffer.from("unsafe")), false);
  const r = await m.upload(f.actor, "pdf", f.product, {
    kind: "installation",
    title: "Manual",
    mediaType: "application/pdf",
    contentBase64: raw.toString("base64"),
    source: "Synthetic author",
  });
  assert.equal(r.state, "draft");
  assert.equal(r.inspection, "approved");
  await m.publish(f.actor, "pdf-publish", f.product, r.id, {
    expectedVersion: 1,
    ...permission,
  });
  assert.equal(
    m.bytes(f.actor, f.product, r.id).resource.mediaType,
    "application/pdf",
  );
  await assert.rejects(
    m.upload(f.actor, "bad-pdf", f.product, {
      kind: "other",
      title: "Broken",
      mediaType: "application/pdf",
      contentBase64: Buffer.from("%PDF-1.7\nBroken\n%%EOF").toString("base64"),
    }),
    /normalized/,
  );
});

test("published resource access follows fresh entitlement and content integrity", async (t) => {
  const f = fixture(t),
    m = media(f),
    b = buyer(f);
  const r = await m.upload(f.actor, "image", f.product, image());
  await m.publish(f.actor, "pub", f.product, r.id, {
    expectedVersion: 1,
    ...permission,
  });
  const policy = f.app.catalog.purchasingPolicy(f.actor, f.buyer);
  f.app.catalog.setPurchasingPolicy(f.actor, "revoke", {
    ...policy,
    mode: "none",
    productIds: [],
    reason: "Synthetic revocation",
  });
  assert.throws(() => m.list(b, f.product));
  assert.throws(() => m.bytes(b, f.product, r.id));
  f.app.database
    .owned("catalog")
    .run(
      "UPDATE catalog_resources SET content=? WHERE id=?",
      Buffer.alloc(r.bytes, 0),
      r.id,
    );
  assert.throws(() => m.bytes(f.actor, f.product, r.id), /integrity/);
});
test("resource quotas include retired links and dimension bombs are refused before decode", async (t) => {
  const f = fixture(t),
    m = media(f);
  for (let i = 0; i < 40; i++)
    await m.upload(f.actor, `link-${i}`, f.product, {
      kind: "other",
      title: `Link ${i}`,
      externalUrl: `https://example.invalid/${i}`,
    });
  await assert.rejects(
    m.upload(f.actor, "link-overflow", f.product, {
      kind: "other",
      title: "Overflow",
      externalUrl: "https://example.invalid/overflow",
    }),
    /quota/,
  );
  const huge = Buffer.from(image().contentBase64, "base64");
  huge.writeUInt32BE(8192, 16);
  huge.writeUInt32BE(8192, 20);
  await assert.rejects(
    m.upload(f.actor, "pixel-bomb", f.product, {
      ...image(),
      contentBase64: huge.toString("base64"),
    }),
    /megapixel/,
  );
});

test("closed SQLite copy retains coherent published metadata, history and normalized bytes", async (t) => {
  const f = fixture(t),
    m = media(f);
  const r = await m.upload(f.actor, "image", f.product, image());
  await m.publish(f.actor, "pub", f.product, r.id, {
    expectedVersion: 1,
    ...permission,
  });
  const bytes = m.bytes(f.actor, f.product, r.id).bytes;
  f.app.close();
  const snapshot = join(dirname(f.path), "resource-snapshot.db");
  copyFileSync(f.path, snapshot);
  f.app = new Application(snapshot, "CA");
  const recovered = f.app.catalogMedia;
  assert.equal(recovered.list(f.actor, f.product).items[0]!.state, "published");
  assert.deepEqual(recovered.bytes(f.actor, f.product, r.id).bytes, bytes);
  assert.equal(recovered.history(f.actor, f.product, r.id).items.length, 2);
});
