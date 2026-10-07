import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Application } from "../server/application.ts";
import { check, permit, type Actor } from "../server/core.ts";
import { greeSampleProducts } from "./gree-pilot-seed.ts";

/** Fixed source-byte identities from docs/catalog/gree-source-library.json.
 * Family photographs only, not verified manufacturer configurations.
 */
export const greeFamilyImages = [
  {
    sampleSku: "SAMPLE-GREE-CHARMO",
    pilotSku: "GRE-CHARMO-R32",
    name: "Charmo",
    productPage: "https://greehvac.ca/heacool_services/charmo-r32/",
    sourceUrl:
      "https://greehvac.ca/wp-content/uploads/2024/03/charmo-front-side-1.png",
    localFile: "charmo.png",
    bytes: 55146,
    sha256: "3fd149dbf9d6bb1ef8b094f74ef51bc84f39f6cacf1d10c8d00f2fb13428a2ed",
    altText:
      "Gree Charmo wall-mounted indoor heat pump, representative family photograph.",
  },
  {
    sampleSku: "SAMPLE-GREE-PULAR",
    pilotSku: "GRE-PULAR-R32",
    name: "Pular",
    productPage: "https://greehvac.ca/heacool_services/pular-r32/",
    sourceUrl:
      "https://greehvac.ca/wp-content/uploads/2024/03/pular-indoor-1.png",
    localFile: "pular.png",
    bytes: 38234,
    sha256: "2a6da2cf0dacd4cdcf7074d2c0f51c453294e5b1a081a7191ea9be938acaa10c",
    altText:
      "Gree Pular wall-mounted indoor heat pump, representative family photograph.",
  },
  {
    sampleSku: "SAMPLE-GREE-AIRY",
    pilotSku: "GRE-AIRY-R32",
    name: "Airy",
    productPage: "https://greehvac.ca/heacool_services/airy-r32/",
    sourceUrl:
      "https://greehvac.ca/wp-content/uploads/2024/03/e615011bd55d05c654cbf1eee1dd9ec5.jpg",
    localFile: "airy.jpg",
    bytes: 20160,
    sha256: "409d9674566cbfb53b52c7f6f0c75f3d887ccc37f7b0e143527b839ab1697aef",
    altText:
      "Gree Airy wall-mounted indoor heat pump, representative family photograph.",
  },
  {
    sampleSku: "SAMPLE-GREE-ZENO",
    pilotSku: "GRE-ZENO-R32",
    name: "Zeno",
    productPage: "https://greehvac.ca/heacool_services/zeno-r32/",
    sourceUrl:
      "https://greehvac.ca/wp-content/uploads/2024/03/charmo-front-side-1.png",
    localFile: "zeno.png",
    bytes: 55146,
    sha256: "3fd149dbf9d6bb1ef8b094f74ef51bc84f39f6cacf1d10c8d00f2fb13428a2ed",
    altText:
      "Wall-mounted indoor heat pump pictured on the Gree Zeno family page; publisher also uses this photograph for Charmo.",
  },
  {
    sampleSku: "SAMPLE-GREE-MULTI",
    pilotSku: "GRE-MULTI-R32",
    name: "Multi-zone",
    productPage: "https://greehvac.ca/heacool_services/multi-zone-r32/",
    sourceUrl:
      "https://greehvac.ca/wp-content/uploads/2025/03/multi-r32-right-e1741215275833.png",
    localFile: "multi.png",
    bytes: 516412,
    sha256: "91f2c0aa0ea27b91ee1e8eb1c64a1e32a709cde673504a9a59d22aefb4c6f3ef",
    altText:
      "Gree Multi Zone outdoor heat pump unit, representative family photograph.",
  },
  {
    sampleSku: "SAMPLE-GREE-FLEXX-ECO",
    pilotSku: "GRE-FLEXX-ECO-R32",
    name: "FLEXX Eco",
    productPage: "https://greehvac.ca/heacool_services/flexx-eco-r32/",
    sourceUrl: "https://greehvac.ca/wp-content/uploads/2024/03/FLEXX-eco-1.png",
    localFile: "flexx-eco.png",
    bytes: 64415,
    sha256: "0cb2cb7b0d0f2e686fc388886ccfff06d34374df6bb39d52190001bc22f15db0",
    altText:
      "Gree FLEXX Eco central heat pump equipment configurations, representative family photograph.",
  },
  {
    sampleSku: "SAMPLE-GREE-FLEXX-ULTRA",
    pilotSku: "GRE-FLEXX-ULTRA-R32",
    name: "FLEXX Ultra",
    productPage: "https://greehvac.ca/heacool_services/flexx-ultra-r32/",
    sourceUrl:
      "https://greehvac.ca/wp-content/uploads/2024/03/FLEXX-ultra-1.png",
    localFile: "flexx-ultra.png",
    bytes: 98647,
    sha256: "93b3fbdc4f15ae3ad6fce4e183ad28bad6ee30e0034d6717cd65e181666aee39",
    altText:
      "Gree FLEXX Ultra central heat pump equipment configurations, representative family photograph.",
  },
  {
    sampleSku: "SAMPLE-GREE-CASSETTE",
    pilotSku: "GRE-CASSETTE-R32",
    name: "Eight-way cassette",
    productPage:
      "https://greehvac.ca/heacool_services/8-way-cassette-indoor-unit-r32/",
    sourceUrl:
      "https://greehvac.ca/wp-content/uploads/2024/03/cassette-a-1.png",
    localFile: "cassette.png",
    bytes: 184126,
    sha256: "71db540a9f3c43303b6971557792834be3f3deacd8e9b5e4aeb42d8651ee87e4",
    altText:
      "Gree eight-way ceiling cassette indoor unit, representative family photograph; exact supplied model is unverified.",
  },
] as const;

export const greeFamilyImagePermission =
  "Owner confirmed permission to reuse Gree materials on 2026-10-05 and explicitly authorized adding these family photographs on 2026-10-07. Representative fictional pilot family images only; no claim of an open-source licence or exact manufacturer model/configuration.";

/** Validate every local private review file before the first mutation. */
export async function readGreeFamilyImages(directory: string) {
  return Promise.all(
    greeFamilyImages.map(async (image) => {
      const bytes = await readFile(join(directory, image.localFile));
      check(
        bytes.length === image.bytes &&
          createHash("sha256").update(bytes).digest("hex") === image.sha256,
        "GREE_IMAGE_SOURCE",
        "Gree family photograph bytes differ from the reviewed source manifest.",
      );
      return bytes;
    }),
  );
}

/** Explicit administrator operation on existing Canadian pilot products.
 * Pass the protected original seed receipt and the private gree-library folder.
 * Never runs the business seed, downloads URLs or writes foreign-owned tables.
 * A failed run may retain completed native receipts; rerun these exact inputs.
 */
export async function seedGreeFamilyImages(
  app: Application,
  actor: Actor,
  products: readonly string[] | { productIds: readonly string[] },
  directory: string,
) {
  actor = app.identity.currentActor(actor);
  permit(actor, []);
  const productIds = "productIds" in products ? products.productIds : products;
  check(
    app.identity.region === "CA" &&
      app.identity.organization(actor).currency === "CAD" &&
      productIds.length === greeSampleProducts.length &&
      new Set(productIds).size === productIds.length &&
      productIds.every((id, index) => {
        const sku = app.catalog.product(actor, id).sku;
        const image = greeFamilyImages[index];
        const accessoryAliases = [
          "ACC-LINESET-25",
          "ACC-WALL-BRACKET",
          "ACC-CONDENSATE-KIT",
        ];
        return (
          sku === greeSampleProducts[index]!.sku ||
          sku ===
            (image?.pilotSku ??
              accessoryAliases[index - greeFamilyImages.length])
        );
      }),
    "GREE_IMAGE_PRODUCTS",
    "Images require the exact original Canadian pilot product receipt and known family SKUs.",
  );
  const assets = await readGreeFamilyImages(directory);
  const resources = [];
  for (const [index, image] of greeFamilyImages.entries()) {
    const productId = productIds[index]!;
    const key = `gree-family-image-v1-${image.sampleSku}`;
    const draft = await app.catalogMedia.upload(
      actor,
      `${key}-upload`,
      productId,
      {
        kind: "image",
        title: `${image.name} representative family photograph`,
        altText: image.altText,
        models:
          "Representative family only. Fictional pilot SKU; exact manufacturer model, capacity, voltage and supplied configuration are unverified.",
        revision: "Family source rechecked 2026-10-07",
        source: `${image.productPage} | ${image.sourceUrl} | Original SHA-256 ${image.sha256}; reviewed manifest docs/catalog/gree-source-library.json.`,
        position: 0,
        mediaType: image.localFile.endsWith(".jpg")
          ? "image/jpeg"
          : "image/png",
        contentBase64: assets[index]!.toString("base64"),
      },
    );
    const published = await app.catalogMedia.publish(
      actor,
      `${key}-publish`,
      productId,
      draft.id,
      {
        expectedVersion: draft.version,
        permissionAffirmed: true,
        permissionBasis: greeFamilyImagePermission,
      },
    );
    // Read current state rather than claiming the historical replay is current.
    const current = app.catalogMedia
      .list(actor, productId)
      .items.find((row) => row.id === published.id);
    check(
      current?.state === "published" &&
        current.version === published.version &&
        current.contentHash === published.contentHash,
      "GREE_IMAGE_CHANGED",
      "A previously seeded photograph changed; review its current state before continuing.",
    );
    resources.push(current);
  }
  return resources;
}
