# Reviewed release deployed — 2026-10-08

The owner explicitly authorized deploying the reviewed release and retaining the sample credentials. Application source `cb8dbaa033ca439b38ffe983c4ddbaa9874b9a94` is serving at https://dstrbtr.ca/. This includes the balanced homepage carousel, Orders fulfillment entrance and information bubble, and Safari focus/module-recovery corrections described in the [release review](PUBLIC-RELEASE-REVIEW-2026-10-08.md).

## Installation and preservation

- Image: `registry.fly.io/distributor-ca-sjs1001:public33-20261008`
- Digest: `sha256:17d898b2f9db9cf5d861de55c8755ea2d59262d5e17314eb61c2e550458d223d`
- Existing Machine `817052c44d9028`, Toronto `yyz`, existing volume `vol_re1jk0pykok3pdd4`.
- Schema 33, CA, fingerprint `a0d3fbcc81da4d138eb9d4be40483775796fa937d9d18094274b744eab71509c`; no migration or database replacement.

Built locally for Linux/amd64 from a clean Git archive of the full source SHA. All 513 runtime source/support files match the archive; all 536 runtime/build files match the live Machine. All 23 HTTPS build assets match the image. The Machine configuration compares exactly equal to its prior configuration except for image. Existing secrets and both public sample sign-in options remain intact; credential values are excluded from receipts and Git. External integrations remain disabled. No new Machine, provider, remote builder, CI, PR or merge was created.

## Backup and rollback

A fresh online native SQLite snapshot was encrypted, downloaded to protected local storage and restored with the pinned previous schema33 image, Docker networking disabled. Restored schema/fingerprint, integrity, foreign keys, recovery hold and session invalidation checks passed. Backup SHA256: `aa0a9eda771f3c1bc9ac68451f0be3412020f26fdc5b00a1633116bfae50de89`. Keys, database and archive remain private.

The first private helper attempt used an incorrect restore action argument and failed before restoring. Its receipt remains retained. The corrected isolated restore passed using the same encrypted archive; no live data changed during this failure.

Previous image `audit33-20261008` / `sha256:3ac59426fd5d144168dbbe018336c94a9d9f2f9da4b69de658d7f9e2b4011e32` remains the code rollback target. Both versions use schema33 and there are no intervening native/backend changes. Roll back the image if health or critical sign-in/navigation fails; preserve the current database and reconcile later writes before any archive restore. A restored backup carries recovery hold and requires the documented recovery procedure.

## Live verification

HTTPS health returns `ok`, CA; the existing Machine service check passes. Live database integrity is `ok`, foreign-key violations zero, schema/fingerprint unchanged. Both sample sign-in endpoints return enabled, and actual browser sign-in is verified without publishing credential values.

Public HTTPS checks pass 24/24 across Chromium/WebKit at 1440px and 390px: carousel pause/next/previous, product entrance, catalogue, application, customer/staff sign-in and activation entrances. Administration/customer HTTPS traversal passes 84/84 across the same engines/widths: all 15 administration and 6 customer pages, sign-in/out and signed-out session boundaries, with zero page errors, horizontal overflow or attempted business writes. Business mutations other than sign-in/out are blocked in the live harness; receiving, invoicing and warranty mutation evidence remains the isolated verification in the release review.

These checks verify deployment and bounded live behavior. Physical devices, real-provider qualification, actual-host disaster-recovery/capacity targets, operator acceptance, unidentified product photographs and the recorded static-maintenance backlog retain their separate limitations. Keeping sample credentials is the owner's explicit choice for this sample-data installation; this receipt does not mark private-data access or any product gate accepted.

Private evidence: `local-evidence/release-20261008/public33-*`, with protected backup/restore files under ignored `private-data/fly-ca/`. Earlier receipts and failures are retained.
