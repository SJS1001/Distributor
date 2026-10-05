# Public portal and customer redesign — 2026-10-05

The owner-requested redesign is deployed at <https://dstrbtr.ca/>. This receipt covers the public entrance, customer storefront and customer workspace navigation. It does not establish completion of all product gates or external integration qualification.

## Source and release

Source commit `5f62ba6cc3753e4665ac645115524ff5150c669f`. The frozen 340-file source manifest SHA-256 is `3070eac52f139a66c1d6f343181239b09c904333d14c929cac2d33feafffc413`. All source files were compared against the live container after deployment.

Local Linux/amd64 build, image `registry.fly.io/distributor-ca-sjs1001:deployment-01M46KNJ2Y7B9G242TDXHG0ZXR`, registry digest `sha256:c19045ca488664707f0239c73b4133d614c78ee85cb69588ab0504c908c3b34f`. Existing Machine `817052c44d9028`, Toronto `yyz`, one shared CPU, 1 GiB memory and existing encrypted 3 GB volume. Healthy 1/1 after activation at approximately 18:02 UTC. Schema remains 25; backend source and provider settings are unchanged. No migration, new Machine, CI runner, remote builder, PR or merge.

## Delivered experience

- Public site has distinct customer sign-in, trade-account application and administration entrances; early sign-in/application links remain accessible above the mobile illustration.
- Customer header offers Shop, Orders, Invoices & payments and Account, with an expandable phone menu instead of the staff sidebar.
- Manual featured-product carousel, search and categories, clearer product cards, account prices, product gallery, detail tabs and published documents use the existing account-scoped APIs.
- Native approval, entitlement, resource publication and enrollment boundaries are preserved. Choosing the administration entrance does not grant an administrator role; choosing the customer entrance does not restrict a real administrator to a fabricated buyer role.
- Original illustrations are visibly identified as illustrations or unavailable product images. They do not claim to be Gree model photographs or specifications.

## Checks on this source

TypeScript, production build, scoped formatting and whitespace checks passed. Existing bundle-size warning remains (main JavaScript 725.80 kB minified).

Six isolated Chromium public-site scenarios passed: mobile application, three entrances at 1440/390 pixels and legacy sign-in, activation fragment/storage handling, replacement activation token, administrator invitation review and complete application→approval→activation→buyer login. Three storefront scenarios passed: buyer approval/withdrawal/resubmission, administrator image/document publication and purchasing rules, and saved-cart entitlement revocation. Search submission now has an explicit focus assertion. Two workspace-location unit checks passed. The historical 5,983-test suite was not rerun for this presentation change and is not represented as current-release full-suite evidence.

Screenshots of desktop/phone home, sign-in, buyer shop, product detail and desktop billing were inspected. Two refinement passes brought mobile application access earlier and repaired keyboard focus lost when a changed query remounted the search form. Independent source review found that one actionable regression; it was repaired and the browser assertion passed. No additional role, enrollment-token or resource-authorization regression was found in that bounded review.

Live checks passed at approximately 18:02–18:03 UTC: 34 read/authentication HTTP checks; real Chromium administrator login, Catalog Images/Documents/Purchasing rules and logout; public home and all three entrances at desktop and phone widths, without page errors or horizontal overflow. No live orders, product uploads, payments, applications or password changes were made by these checks.

## Backup and rollback

Before deployment, the current schema25 database was backed up through the encrypted native recovery CLI, downloaded to protected owner-local storage and restored to a fresh isolated local database. Snapshot SHA-256 `85320014e7cca07ec9f74cbe0be5d8c17402f62a614d0babb5b41b244e7fbc7e`, 2,330,624 plaintext snapshot bytes; schema hash `bcc37c9e243e92f973016c4f2d5ad51b6b9ba117832c0fa3d1657ec4709dd06e`, reporting enabled, CA. Restore invalidated four copied sessions and applied provider hold. The live database was not replaced or restored. This bounded archive check does not qualify disaster recovery or independent jurisdiction/key-custody requirements.

Previous image `registry.fly.io/distributor-ca-sjs1001:storefront-schema25-20261005`, digest `sha256:50044df5dcd73f0a907c3a665d1a9744ef8595369a683398a2d634bb0a2f6b09`, remains schema-compatible for a code rollback; do not overwrite subsequent live database activity.

## Retained failures and limits

An intermediate build ran before the new storefront stylesheet was written and failed to resolve that import; final frozen build passed. Fly machine status rejected an unsupported JSON flag; machine-list JSON supplied the required state. A local image-source inspection found Fly's temporary deployment tag absent from the local Docker inventory and the unauthenticated pull failed; source comparison was instead performed directly on the live container. These tooling failures were not passing checks.

This redesign used two existing local implementation agents and one existing independent reviewer. No new cloud session or Claude Desktop execution is claimed. The earlier cloud contract review applies to its earlier feature release only.

The live buyer's initial password was previously changed; its current-password login was not replayed. Isolated buyer journeys passed. Physical iPhone Safari, scanners/printers, live Stripe/QuickBooks/carriers, automated email, operational residency/finance/restore qualification and Gree binary publication rights remain open as recorded in [remaining work](../REMAINING-WORK.md). Private credentials, images of live authenticated data, manifests, databases and logs remain excluded from Git.
