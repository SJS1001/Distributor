# Canadian storefront release — 2026-10-05

The owner-authorized four-feature increment is active at <https://dstrbtr.ca/>: buyer storefront, administrator product resources, account/product purchasing controls and conditional order approval. This is a small Canadian pilot release, not production acceptance or a verified product gate.

## Version and checks

Base source `4b2c36f8537b9dd2dac5b12559d3451b44ab1cf2` plus the reviewed delta. Frozen 853-input manifest SHA-256 `6ded3bdcb9028fe4659a7af1dc4745f25b4831ec3e726e3275822877de061aaf`; the Linux/amd64 image matches all 339 source files. Image `registry.fly.io/distributor-ca-sjs1001:storefront-schema25-20261005`, registry digest `sha256:50044df5dcd73f0a907c3a665d1a9744ef8595369a683398a2d634bb0a2f6b09`. Schema 25 hash `bcc37c9e243e92f973016c4f2d5ad51b6b9ba117832c0fa3d1657ec4709dd06e` with event reporting enabled, CA region.

[Local verification](LOCAL-STOREFRONT-2026-10-05.md) records the final frozen 5,983/5,983 suite, three storefront browser scenarios, nine navigation checks, TypeScript/build/formatting and bounded reviews. Three native agent assignments and a completed ChatGPT Work contract review contributed; the cloud reviewer had no source access. No CI, runner, remote image builder, PR or merge was used.

## Backup, migration and activation

The writer was stopped on the existing Toronto Machine. The previous schema-24 image created an encrypted archive; it was downloaded to protected local storage and successfully decrypted/restored in an isolated network-disabled old-image container. Snapshot SHA-256 `e936f59b7bcfa00a3e68730e45e463010c514e8bea8c868bf51a0a0f59132ff4`, 2,158,592 bytes. Source schema hash `94505c964f6991277c202fc0c9673563be5e2b0c94d69e70b75a4f15764c2508`. Copied-session invalidation/provider hold were confirmed during the restore check.

A separate schema-25 clone preserved all 165 preexisting nonmetadata tables and 585 rows exactly before explicit sample additions. Integrity and foreign-key checks passed. Native authorized operations then granted three existing fictional sample accounts **selected access to the eleven existing sample products**, with review disabled for those sample grants, and published eight clearly labelled official Gree family-page references. Real accounts are not automatically granted access; migrated accounts default to none.

Original source bytes remained unchanged until reviewed activation. Original database and sidecars were retained under `/data/rollback-schema24-storefront-20261005`; the candidate replaced `/data/distributor.db`. The previous image is `registry.fly.io/distributor-ca-sjs1001:deployment-01M46B0N7V7ZV5MB679FC2VQSX`, digest `sha256:deb84b82401f50a064f1b44c6ba478d18371cc7f4f07e3f0b95c747ed997edb9`. A rollback must pair that image with its schema-24 database and reconcile subsequent activity; never blindly overwrite live data.

The normal application command was restored on Machine `817052c44d9028`, region `yyz`; health became 1/1. One shared CPU, 1 GiB memory and encrypted 3 GB volume `vol_re1jk0pykok3pdd4` remain unchanged. No scaling, scheduled workers or live provider enablement occurred.

## Live observations and retained failures

At 17:36 UTC, 34 read/authentication HTTP checks passed: CA health, homepage and built assets, unauthenticated review-queue refusal, administrator login, eleven products and their purchasing/resource endpoints, eight family references, review queue, dashboard, the existing buyer's selected eleven-product policy, and logout. A live Chromium journey also passed administrator login, Catalog navigation and the Images, Documents and Purchasing rules tabs, with no page errors; signed out afterward. No test orders, uploads, payments or password changes were made in the live system.

The saved initial buyer password returned 401. The independently restored **pre-upgrade** archive already shows that buyer active with security revision 2 and password-change requirement cleared: its initial password had been superseded before this release. All existing identity rows were preserved. No password reset or login bypass was performed; live buyer end-to-end access was not replayed with the user's current password. Local buyer journeys passed separately.

Retained operational failures: the first image update using an explicit digest was rejected by Fly CLI after a doubled digest identifier; the fixed tag retry resolved to the expected digest. A status command used an unsupported JSON flag and was replaced with machine-list JSON. The first private smoke expected an array rather than the documented resource-list envelope; corrected read checks passed. These were deployment/check tooling failures, not silently discarded successful runs.

Private manifests, restore archives, credentials, logs and screenshots remain excluded from Git. GitHub `sjsmithbot` repository permission still reports `pull=true,push=false`; no owner-identity substitution or push was attempted.

## Remaining boundaries

Eight official family links are available; Gree image/manual binaries have not been redistributed. Exact model/revision matching and publication permission remain unresolved. PDF reconstruction loses searchable/accessible text; native renderer containment and deployment capacity still need qualification. Actual iPhone Safari/scanners/printers, live Stripe/QuickBooks/carriers, automated invitation email, scheduled workers, protected recovery authority, full residency/financial/operator acceptance remain separate work. The bounded archive restore and successful cutover do not establish RPO/RTO or disaster recovery acceptance. All formal product gates remain unverified.
