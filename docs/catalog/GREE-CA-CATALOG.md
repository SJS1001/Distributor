# Official GREE Canada public catalogue

The owner authorized reuse of Gree product information, images and official downloadable documents on 5 October 2026. The public website reference now comes from **https://www.gree.ca**, the exact requested site. It is separate from the earlier eight-family `greehvac.ca` research in `gree-source-library.json`; those records and historical download failures remain unchanged. No mapping to fictional sample inventory SKUs is inferred.

The 5 October 2026 import contains all **56 public product pages**, grouped into **13 navigation categories**, with **270 source variant configurations**, **77 images**, **2,860 variant specification rows** and **166 product/document associations representing 117 unique official PDFs**. Descriptions, titles, model option labels and specification units come from the public Shopify product feed and public page metafields. Images stay at the source `cdn.shopify.com` URLs. Product document links include English/French brochures and manuals where published. Official model identifiers are retained from each source variant’s SKU field as `manufacturerModel`, solely for reference. No prices, purchasable inventory SKUs, stock or availability are imported.

| Category                     | Product pages |
| ---------------------------- | ------------: |
| Single Zone Mini Splits      |            10 |
| Multi-zone Mini-Splits       |             3 |
| Indoor Units - All Match R32 |             9 |
| Indoor Units - Free Match    |             8 |
| Central Ducted Systems       |             3 |
| Rooftop Units                |             2 |
| VRF Systems                  |             3 |
| Indoor Units - VRF           |             7 |
| Air-to-Water Systems         |             1 |
| PTACs                        |             3 |
| Window Air Conditioners      |             3 |
| Portable Air Conditioners    |             3 |
| Dehumidifiers                |             1 |

The source exposes an additional Air Purifiers collection with zero public products. Other source collections are cross-category groupings; all 22 collection inventories are retained in the manifest. R410A and R32 source collection membership is preserved. The source Old Products collection is empty, so absence of an old-product tag does not qualify a product as currently manufactured or available.

## Reproduce or update

Run directly on the workstation; no CI or runtime ingestion is involved:

```sh
python3 scripts/import-gree-catalog.py --refresh --verify-documents
```

Outputs are `src/web/gree-catalog-data.json`, the small curated `src/web/gree-catalog-preview.json`, and `docs/catalog/gree-ca-source-manifest.json`. The importer paginates the public products and collection memberships, fetches each product page, extracts its public PDF links and variant metafields, and keeps URL/hash/size evidence for every fetched source. Public raw responses stay in `/tmp/gree-catalog-cache` by default and are not committed. Omit `--refresh` to reparse the same cached responses; `--cache-dir` selects a retained public snapshot. HTTP document checks run only when `--verify-documents` is supplied.

Every imported product has at least one document. All **117 unique document URLs returned HTTP 200 with `application/pdf`** during the import's HEAD checks. This verifies link availability at that time; it does not verify PDF contents, equipment compatibility, revision equivalence or installation suitability. No document binaries are mirrored.

The official [professional technical documents page](https://www.gree.ca/pages/professionnal-documents) requires access for unauthenticated visitors. The import includes the freely published product-page documents and does not bypass that restriction. Three older Free Match wall-mounted pages (LOMO 23, Extreme and Crossover) do not expose variant specification rows in their public metafields; their source descriptions, images and public documents are still included. The GMV Air Handlers page has no public description in the source feed; it retains an empty description and its official specifications, image and documents.

`products[].models` retains each official configuration and its own specification/document associations. Top-level `products[].specifications` describes the **first source configuration with specifications**, for previews; callers must label it accordingly or display the selected model's specification array. Rows retain their source order and unit suffixes. Repeated labels may cover different equipment components or operating modes; use the official product page/PDF for full context.
