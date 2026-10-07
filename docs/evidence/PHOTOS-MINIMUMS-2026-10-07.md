# Photographs, customer minimums and spacing — 2026-10-07

## Current engineering receipt

The tested working tree is based on `eda07abbd2e75c57b1a2c6d053c4a3424c2aac7c`; the release source is recorded below after its commit. Frozen production manifest: **433 files**, SHA256 `2e6e80406fb5fd1fc1b15e24c15630bf5017666374ad2852e01ad546e6702724`. Source/test/config manifest: **1,027 files**, SHA256 `d2f84c426d37f9b2c8faf253f7205030ba372b96c0f34bc7b2fb223086fa5710`. Both remain unchanged through final checks.

- Full native suite: **6,108/6,108**, 174.8 seconds, no failures/skips/cancellations.
- Default browser regression: **343/343**, 8.7 minutes. All180 UI/build freeze hashes unchanged.
- Customer minimum browser journeys: **2/2**, Chromium/WebKit, native saved policy, both thresholds, scoped buyer visibility and current-policy refusal; includes390px buyer and normalized `2.0` quantity progress.
- Storefront focused journeys: **5/5 per engine** Chromium/WebKit, including published-photo preference and single-spotlight disabled navigation.
- Pricing/media native recheck: **26/26**. Family-image helper tests: **15/15**; private native upload/publication/normalized-byte and replay rehearsal passes.
- Typecheck, build, formatting, planning and diff checks pass. React Doctor81/100 reports22 advisory findings, manually reviewed without an actionable correctness defect. Deliberate sequential native photo operations retain individual receipts. Build retains its existing large-chunk advisory.

Initial native6104/6108 failure identified inconsistent selected-cart image projection; all three native customer projections now agree and publication/retirement lifecycle tests cover them. Initial WebKit storefront failures were caused by HTTPS upgrades in a localhost HTTP fixture. Only that fixture's policy was corrected; production CSP remains unchanged. Historical failed logs/traces remain retained.

Private logs and manifests: `local-evidence/photos-minimums-2026-10-07/`; photo lifecycle rehearsal: `local-evidence/catalog-images-2026-10-07/`. They are excluded from Git.

## Behavior and limits

[Customer minimum orders](../CUSTOMER-MINIMUM-ORDERS.md) documents staff controls, buyer progress, current-policy enforcement and exact recovery. Both merchandise subtotal before tax/freight and serialized equipment units apply. Accessories count toward amount only. Existing customers start with zero thresholds; no business policy is guessed. Accepted orders retain fulfillment/cancellation paths. IAM owns storage and commands; schema32 requires an explicit clone upgrade.

[Family photographs](../catalog/GREE-FAMILY-IMAGES.md) records eight exact known family associations from seven distinct owner-approved assets, native normalized PNG upload and reviewed publication. These represent product families; they do not claim exact model photography. Nineteen generic items still require actual manufacturer/model identity or supplied product photographs. Catalog entry and image upload/URL controls already exist.

Customer and staff headers and Shop/cart spacing are tighter; touch targets remain at least44px where required. The [handoff review](../reviews/task-handoff-blind-spots-2026-10-07.md) separates software controls from operational ownership, manual instructions and stalled-work escalation.

## Existing pilot release

Pending at this receipt's initial commit. Source, image, encrypted backup/restore, conservation, activation and live acceptance are recorded after actual execution. Previous pilot remains schema31 until then. No product gate is advanced. Physical devices, representative-user observation, assistive technology and live payment/accounting/carrier qualification remain unverified.
