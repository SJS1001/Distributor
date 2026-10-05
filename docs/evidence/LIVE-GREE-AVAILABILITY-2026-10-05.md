# Canadian pilot: Gree design and product availability

Date: 2026-10-05. Owner-authorized existing pilot deployment; no product gate is inferred from this receipt.

## Tested release

- Source: `84767318d2e959661ec52008bcf292c22e36dc4a`.
- Site: https://dstrbtr.ca.
- Image: `registry.fly.io/distributor-ca-sjs1001:gree-availability-8476731`.
- Image SHA256: `b1724b29016f7c4157a44649b62ac1db29d0a211b2b14d26aef60596fe293112`.
- Existing Fly machine `817052c44d9028`, Toronto `yyz`, existing encrypted volume; one machine, no new infrastructure.
- Live source comparison matched all 356 frozen source/package files. Machine started with its HTTP health check passing; `/api/health` returned `ok`, region `CA`.

## Delivered behavior

The public site has customer, trade-application, administration and scanner entrances. The manufacturer library contains 56 public product pages in 13 navigation categories, 270 configurations, 77 images and 117 distinct official PDFs (166 product/document associations). Product details have image galleries, model-specific specifications and document tabs. The catalog is a dated import; see [source provenance](../catalog/GREE-CA-CATALOG.md).

Customer and administration workspaces share the revised equipment design and have routes to and back from the manufacturer library without losing the session. Existing purchasing permissions and order approval remain enforced by native commands.

In administration, Sales & customers → Catalog has per-product checkboxes for global customer hiding and an advisory out-of-stock badge, plus an optional expected date. Changes require a reason and are revision checked and audited. Hidden native products cannot be newly bought through browsing, cart, quote, stale quote acceptance or request approval. Restoring visibility does not grant account entitlements. Existing orders remain available. The badge and date do not change stock or prohibit backorders.

## Database protection and activation

The old application writer was stopped. A fresh encrypted schema25 archive was downloaded and successfully restored using the actual previous image in a network-isolated container. The restored snapshot hash was `ee2edd34e885a11a5e9eb069c80d36692276eb0c0077e4d7c2e218b5e74e89ff`.

The explicit fresh-file upgrade verified the exact reports-enabled Canadian schema25 profile `bcc37c9e243e92f973016c4f2d5ad51b6b9ba117832c0fa3d1657ec4709dd06e`. Comparison preserved every row of all 173 prior business tables: 768 rows, excluding only the deliberately advanced platform schema receipt. Integrity and foreign-key checks passed and the source file hash remained unchanged. Schema26 fingerprint is `923836374fa791ad2c39d3060b13cda2e93e64ac40fa6a401ed474d56f6f05e3`.

The reviewed clone was activated and the original database retained privately. The existing machine then resumed its normal application command. Future rollback requires reconciling any writes after activation; the retained old database is not automatically current.

## Verification

- TypeScript, production build, scoped formatting and whitespace checks passed.
- Focused native availability/purchasing/lifecycle tests: 42/42.
- Impacted migration, restore and recovery tests: 207/207, including both exact frozen schema25 profiles. These are synthetic local checks.
- Public browser journeys: 13/13. Storefront journeys: 4/4; final compact-row CSS followed by another passing availability journey and typecheck/build.
- Live Chromium at 1440px and 390px: both prefilled sign-ins, expected roles, public product/document navigation, authenticated library/reload/workspace return, admin controls and logout passed. Buyer staff-access request returned403. No page errors. Screenshots inspected; manufacturer images decoded in live checks.
- Local browser roundtrip proves availability save/reload, customer advice and hiding. Live checks were read-only for product availability; no sample product settings were changed for the receipt.
- Private evidence: ignored `local-evidence/gree-availability-20261005/`, including logs, source manifest, migration receipts and screenshots. Recovery keys, archives, database contents and credentials are excluded from Git.

## Retained failures and limits

The first backup attempt refused a newly created mode0755 destination directory. No archive was created; the directory was corrected to0700 and the fresh backup/restore succeeded. The initial live harness waited for a link inside the collapsed mobile menu; the corrected harness uses the visible Menu action and a bounded timeout. Early screenshots preceded image decoding and were recaptured after explicit successful decoding. Local harness assumptions, a shared Playwright output-directory collision and old fixture expectations were corrected; final reruns passed. Historical failure logs are retained privately.

The manufacturer library is public informational content, separate from the preserved fictional saleable catalog. No unverified SKU-to-family mapping was invented; these global native product controls do not hide public manufacturer reference pages. Pricing, stock and purchase entitlement are not imported from Gree.ca. PDF checks verified117 public links returned200 application/pdf; document contents, technical compatibility and restricted professional files are not qualified. Real iPhone Safari/camera use, internal server-sent email/SMS, live provider integrations and full production qualification remain outside this release. The production-build existing large main-chunk warning remains.

Three delegated Codex lanes assisted; no separate Pod/cloud session launch is claimed. Build and verification ran on the workstation. No PR was created or merged, and no CI runner or remote build was started. Repository Actions-settings read returned403 for the publishing identity; this release did not change those settings and does not claim a fresh policy verification.
