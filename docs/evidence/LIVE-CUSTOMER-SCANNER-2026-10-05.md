# Customer pilot sign-in and phone scanner — 2026-10-05

## Identity and scope

Owner-authorized sample Canadian pilot, source commit
`943af34ab0c097557af3298518136d4e4467b7bd`, schema 25 unchanged.
Direct local-only Docker build/deploy; no CI, remote builder, PR or merge.

- URL: https://dstrbtr.ca/
- App: distributor-ca-sjs1001; Machine 817052c44d9028, Toronto yyz.
- Image: `registry.fly.io/distributor-ca-sjs1001:deployment-01M46NEGEWQCH597XRWKY0DB01`.
- Image digest: `sha256:aeff4bc28145f7a24462a6b6d388c1365bb4938989e2bccd46b9312767b8e768`.
- All 343 tracked live source files match the frozen source manifest, whose SHA-256 is `e2749ec97aed61ddab49abe78e11cc80da79c8c4af95cb79bfd9e6d2d97b5abe`.
- Final live state: one started Machine, one passing health check.

## Changes and checks

Customer pre-fill is independently enabled with its own sample buyer on the
existing approved fictional account. Normal login, role and account/product
permissions apply. The original buyer's changed password and security revision
were preserved. Existing administrator pre-fill is unchanged. Both intentionally
publish sample credentials only under their explicit runtime enablement flags.

The public portal has a Barcode scanner link beneath Administration. Signed-in
Administration also links there. The reader requires no account, changes no stock,
and provides QR/copy/email/text/native-share links containing only its public URL.
Warehouse receiving/picking/moving retain their authenticated task forms. The
shared camera control now has a lazy-loaded bundled decoder when native support
is unavailable. Actual dependency notices ship with the scanner page.

Final workstation TypeScript, production build, scoped formatting, whitespace,
planning validation, 3 backend tests and all 11 public-browser scenarios passed.
Browser scenarios include customer buyer-only login, blank-to-QR synthetic camera
frames decoded by the real bundled library, confirmation before field entry,
camera track release and authenticated scanner navigation/reload. Synthetic camera
frames are not physical camera qualification. Existing build chunk-size warning
remains; no full-suite rerun was claimed for this bounded change.

Live Chromium verification at 1440px and 390px (2026-10-05T18:34Z) passed:

- Both customer and administrator credentials pre-filled; clicking Sign in without
  typing authenticated the expected buyer/admin role. Customer staff-user access
  returned 403. Each session was explicitly signed out.
- Public and signed-in scanner links, reload, QR visibility, correct mailto/sms URL
  payloads and served license notices passed.
- No horizontal overflow or browser page errors. Portal desktop and scanner phone
  screenshots inspected.

Protected local logs, screenshots, manifest and receipts remain under ignored
`local-evidence/customer-scanner-20261005/`; no passwords are included here.

## Recovery and retained failures

Before provisioning/deployment, an encrypted schema25 native backup was downloaded
with mode 0600 and successfully restored in isolation. Snapshot SHA-256:
`0f8f646c745cff5e3d5554369fd97d2569b21dd1f406109a92a6e16ddde5e7e4`;
schema hash `bcc37c9e243e92f973016c4f2d5ad51b6b9ba117832c0fa3d1657ec4709dd06e`.
Live database was not replaced. Prior image digest
`ca251b672287f8b8af4a40e1fbda405499f47d53dba0bf6afff63cea59a4c5fe`
remains the code rollback reference. A rollback must also remove staged/enabled
customer pre-fill configuration as appropriate; the sample user is a native
persistent account and is not removed by reverting code.

Initial browser expected-three-links assertion failed after adding the fourth
link, then was corrected. A harder initial-blank-camera-frame test exposed
minified decoder exception names; stable library getKind handling repaired this
and the final scenario passed. Self-review found authenticated route rewriting;
scanner routing guards and navigation/reload assertions repaired it before
release. The initial live harness used an incorrect relative helper import and
failed before contacting the app; corrected final harness passed. Historical
failure logs remain alongside final receipts. Fly initially showed replacing and
then a temporary health warning; final started/passing state was checked.

## Outstanding limits

Email/text buttons open the device's own composer; they do not send through an
internal Distributor service. No email/SMS provider, automatic delivery, delivery
receipt or actual sent message is verified. Connecting that service remains open.
Physical iPhone Safari scanning, Home Screen behavior, damaged/low-light labels
and all supported barcode formats still require device qualification. QR decoding
in a synthetic Chromium camera stream does not prove those outcomes.

This standalone reader does not perform inventory workflows or offline work.
Before real data, remove both public pre-fill configurations, rotate published
passwords and revoke sessions as described in [Fly runbook](../FLY-CANADA.md).
No product gate, residency assurance or universal feature completion is inferred.
