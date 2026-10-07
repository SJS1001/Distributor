# Native Gree pilot family photographs — 2026-10-07

The owner confirmed permission to reuse Gree materials on 2026-10-05 and explicitly requested adding the photographs on 2026-10-07. This is the recorded distribution permission basis, not a fabricated vendor/open-source licence. The existing native pilot retains fictional SKUs, prices and business activity. Photographs describe a manufacturer family; they do not establish a supplied manufacturer model, capacity, voltage or configuration.

The helper in `src/demo/gree-family-images.ts` assigns the eight previously reviewed family photographs only to the eight known native seed product IDs. It accepts the original protected seed receipt's 11 `productIds`, permits the exact original SAMPLE aliases or their audited full-pilot GRE/ACC replacements, and refuses a shortened, reordered, duplicate or unrelated product list. No generic string-to-model matching is used. The other 19 products retain their current image state.

## Reviewed associations

Fresh requests on 2026-10-07 returned HTTP 200 for all eight official family pages. Each response contained its exact source photograph URL from [the original manifest](gree-source-library.json). Original filenames, sizes and SHA-256 hashes are pinned in the helper and rechecked against all eight private files before any catalog mutation. The fixed source page/URL/digest, representative designation and review date are retained in native resource metadata. Each image's accessible alternative text also states the family limitation.

| Current pilot SKU | Official family page | Private reviewed source file | Qualification |
| --- | --- | --- | --- |
| GRE-CHARMO-R32 | [Charmo R32](https://greehvac.ca/heacool_services/charmo-r32/) | charmo.png | Wall-mounted indoor family image |
| GRE-PULAR-R32 | [Pular R32](https://greehvac.ca/heacool_services/pular-r32/) | pular.png | Wall-mounted indoor family image |
| GRE-AIRY-R32 | [Airy R32](https://greehvac.ca/heacool_services/airy-r32/) | airy.jpg | Wall-mounted indoor family image |
| GRE-ZENO-R32 | [Zeno R32](https://greehvac.ca/heacool_services/zeno-r32/) | zeno.png | Publisher uses the same photograph as Charmo; retained explicitly |
| GRE-MULTI-R32 | [Multi Zone R32](https://greehvac.ca/heacool_services/multi-zone-r32/) | multi.png | Outdoor family image |
| GRE-FLEXX-ECO-R32 | [FLEXX Eco R32](https://greehvac.ca/heacool_services/flexx-eco-r32/) | flexx-eco.png | Multiple pictured configurations; no supplied-configuration claim |
| GRE-FLEXX-ULTRA-R32 | [FLEXX Ultra R32](https://greehvac.ca/heacool_services/flexx-ultra-r32/) | flexx-ultra.png | Multiple pictured configurations; no supplied-configuration claim |
| GRE-CASSETTE-R32 | [Eight-way cassette R32](https://greehvac.ca/heacool_services/8-way-cassette-indoor-unit-r32/) | cassette.png | Eight-way family representative; exact supplied model remains unverified |

## Native operation and recovery

The authorized operator supplies a current administrator actor from the native identity module, the existing protected original seed receipt and the ignored private image directory:

```ts
import { seedGreeFamilyImages } from "./src/demo/gree-family-images.ts";

const resources = await seedGreeFamilyImages(
  app,
  currentAdministrator,
  originalSeedReceipt, // { productIds: original eleven IDs }
  privateImageDirectory, // reviewed eight files; no PDF files are consumed
);
```

This is an explicit image-only companion operation. Do not rerun `seedGreePilot` or `seedFullPilot`. The helper does not fetch publisher URLs, create products, alter prices or stock, change entitlements or write foreign-owned tables. It requires CA/CAD and current administrator permission before reading assets. Use the existing pilot maintenance/recovery procedure and preserve pre-operation backups/receipts when the parent operator performs a live run.

Each image goes through `catalogMedia.upload` and the existing native decoding/PNG normalization, then through the separate administrator `catalogMedia.publish` command with the recorded owner permission. Original binaries stay ignored; normalized buyer bytes live in Catalog-owned database storage and are served through the existing authenticated resource endpoint. No CSP expansion, external image host admission or schema change is needed for the image operation itself.

Stable version-one keys recover each exact upload/publication receipt. If interrupted, retain the failure and completed receipts and rerun the same original receipt/private files: no duplicate photos are created. If a resource was subsequently edited or retired, the helper refuses to claim historical publication is still current. Review that current resource rather than overriding staff decisions or creating a replacement automatically. Native commands commit separately, so a mid-run failure can leave earlier successfully published photos; the operation does not claim multi-product atomicity.

After execution, retain the eight resource IDs and inspect each current resource state, normalized PNG signature, byte count and content SHA-256 through `catalogMedia.bytes`. Verify buyer entitlement/visibility, actual rendering and unchanged business totals separately. A local test or historic publication receipt does not prove current live availability.

## Actual photograph gap

The remaining 19 pilot items have no named manufacturer or manufacturer part number. Their fictional general descriptions cannot identify a truthful real product photograph. No corresponding exact item was established by the available catalog/source evidence; Gree heat-pump imagery must not be assigned to those unrelated items.

The three serialized equipment gaps are HVAC-HRV-150 (150 CFM heat recovery ventilator), HVAC-FURN-60 (60,000 BTU furnace) and HVAC-AHU-24 (2-ton air handler). The 16 bulk accessory/control gaps are ACC-LINESET-25, ACC-WALL-BRACKET, ACC-CONDENSATE-KIT, ACC-INSTALL-KIT, ACC-PAD-36, ACC-STAND-GROUND, ACC-PUMP-MINI, ACC-DISCONNECT-60, ACC-WHIP-6, ACC-LINE-COVER, ACC-WALL-SLEEVE, ACC-FLARE-KIT, ACC-SURGE, ACC-FILTER-1625, CTL-THERMO-WIFI and CTL-THERMO-BASIC. Staff can upload an actual stocked-item photograph or associate a verified manufacturer/model and its permitted photograph later. Generated or unrelated vendor photographs would misrepresent those products.

## Workstation evidence and limits

Four portable focused tests pass: pinned provenance and alternative-text metadata; substituted-source rejection; complete receipt preflight/no writes on missing files; current administrator and CA/CAD boundaries. A separate isolated native CA/CAD rehearsal used all eight actual private reviewed publisher files on 2026-10-07T17:02:56.226Z. It published eight normalized PNG resources, verified every served signature/length/content digest, reran identical inputs without duplicates, left the three seed accessories without images and refused historical success after retiring the first photo. Seven distinct source images produce eight native associations because the publisher shares Charmo/Zeno imagery. These checks did not touch live data, run CI or advance a product gate.

Private rehearsal source/receipt are under ignored `local-evidence/catalog-images-2026-10-07/`. Live image publication and buyer acceptance are the parent operator's separate responsibility; this document initially records a prepared helper and local evidence only. Exact manufacturer matching, operating rights beyond the owner's recorded reuse authorization and ongoing publisher availability remain limited as described above.
