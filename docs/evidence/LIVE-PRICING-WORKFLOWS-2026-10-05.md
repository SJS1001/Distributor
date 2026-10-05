# Canadian pilot: pricing approvals and workflow reporting

Date: 2026-10-05. Owner-authorized existing pilot release. This receipt does not certify product gates or external integrations.

## Release identity

- Source: `d65610e29f35a87b335f099fc6862672bdae75d0`.
- Site: https://dstrbtr.ca.
- Image: `registry.fly.io/distributor-ca-sjs1001:workflow27-20261005`.
- Image digest: `sha256:90fea9be744f197928b2f2a9fdf60306529317a40fa54c773cbbdf1240770ccc`.
- Existing Toronto Machine `817052c44d9028`, existing encrypted volume, one shared CPU and 1 GB RAM. No new infrastructure.
- All388 source/package files in the candidate image matched the frozen tested source before activation. The normal deployment used that same image. Live schema27 inspection and HTTP health passed, regionCA; machine HTTP check passing.

## Delivered behavior

Administrators can enter reviewed wholesale cost and reason in Catalog → Manage product → Pricing. Actual purchase/receipt cost history remains separate. Customers → Pricing has per-account MSRP multipliers and detailed/net-only presentation, plus organization-wide maximum additional discount and minimum-margin settings. Blank limits require independent approval for every override; no business limits or invented costs were seeded.

Saved-cart Selling price allows staff to propose a one-off net price with a reason. Within-limit offers activate; exceptions require a different current authorized administrator. Relevant cart, cost, pricing or policy changes invalidate old approval evidence. Customers see the offered price without wholesale cost, internal margin limits or reasons. Accepted order/invoice prices remain historical and an override cannot be reused for another order.

Explicit included/extra shipping terms and charge/tax survive quote, acceptance and invoicing, with extra shipping charged once over partial shipments. Reports separate historical sales, credits, payments and refunds, with currency/date scope and account isolation. Customer Reports and graphical administrator cards are available. Cards can be hidden, restored and reordered per user/organization/browser. Catalog cursor pages replace prior rows and product maintenance uses a focused tabbed dialog; customer, returns and imports tasks have sub-tabs. Explicit manufacturer-model mappings preserve sign-in context and native purchasing restrictions; no mapping of fictional SKUs was fabricated.

Scanner internal-delivery adapter, HTTP and UI are implemented with exact retry recovery and current authority. The actual relay is unconfigured. No real email or SMS delivery is claimed; QR/copy/device sharing remain available.

## Database conservation

Stopped the old writer, made a fresh encrypted schema26 archive, downloaded it to protected local storage and restored it with the exact previous image in a network-disabled container. Restored snapshot hash: `9e05325d7e04d705c2a5cc72a96326ab2e2aff4d07f03992f7d9a065cb4db904`.

The fresh-clone upgrade verified old fingerprint `923836374fa791ad2c39d3060b13cda2e93e64ac40fa6a401ed474d56f6f05e3`. All806 rows across174 prior nonmetadata tables were equal after upgrade. Integrity and foreign-key checks passed; the original raw-file hash remained unchanged. Current schema27 fingerprint: `c3c2f5ff647406e5d2025583ae2a4539b3c4978a3a8c410839dd5db79d9dcaf4`.

The reviewed candidate was activated only after conservation checks, and the schema26 original and previous image retained. A future rollback requires reconciling post-activation writes; the retained old snapshot is not automatically current. Recovery keys, credentials, database rows and private evidence are excluded from Git.

## Verification

- Frozen workstation suite: **6,038/6,038 passed**, zero failures, skips or cancellations;312.6 seconds.
- Typecheck, production build, scoped formatting, whitespace and plan structural validation passed. Existing main-bundle size warning remains.
- Final browser journeys: price override1/1, shipping1/1, scanner delivery1/1 and reporting5/5. Customer-pricing and manufacturer-reference journeys also passed their final specialist runs. These use local synthetic fixtures.
- Override journey verified normal100 CAD, within-limit90, exception50, independent approval, buyer50 net/113 total, secret-field exclusion, exact retry after lost response and explicit clear back to100. Backend regressions cover current MFA/revocation and stale approval checks.
- Live Chromium at1440px and390px: both prefilled sign-ins and expected roles, admin wholesale-cost controls, approval-setting controls, customer/admin reports,56 manufacturer cards/documents, library reload/return and logout passed; zero JavaScript page errors. Buyer access to staff-user, approval-policy and price-authority-history routes returned403. Screenshots inspected.
- Live pricing checks were read-only: enabling the checkbox to reveal threshold inputs changed only unsaved form state. No customer price, cost, policy or commercial record was modified. End-to-end override mutations were verified locally, not performed on the live sample data.

## Retained failures and limitations

Initial full suite passed6,027/6,038. Corrected stale-cart fixtures, an invoice retry transaction-fence regression and a stale navigation assertion; concurrent source edits caused one recovery-conservation failure. Focused reruns and the final frozen suite passed. Historical receipts remain private.

The initial isolated restore could not fetch the previous image due to missing Docker registry authentication; login/pull repaired it and restore then passed. The first post-deploy inspection ran before the VM was started; the later inspection and health check passed. The first live browser harness assumed optional threshold fields were visible while policy was disabled; it now reveals the unsaved inputs before checking. Both failure logs and passing retries are retained in ignored `local-evidence/workflow-release-20261005/`.

Physical iPhone Safari/camera, real messaging/payment/carrier/accounting providers, contractual/residency qualification and broader operational gates remain unqualified. Public prefilled accounts are the owner-authorized sample pilot. Report preferences remain browser-local. Three Codex subagents contributed; no separate cloud session is claimed. No PR/merge, CI runner or remote build was started.
