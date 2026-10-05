# Five-pass pilot review

Owner requested five iterative reviews after the navigation/notes update is live. Status: initial release a5ca594/schema28 verified live; Passes 1–4 reviewed; final integration/deployment pending. Each pass records evidence and fixes; external provider and physical-device qualification remain explicit. No CI, PR or merge authorized.

1. **Navigation and orientation:** guest/customer/staff entry points, breadcrumbs, back/forward/reload, mobile layout, keyboard focus. Fix broken paths and misleading state.
2. **Customer purchasing:** approved product discovery, pricing presentation, cart/quote/order, invoices and reports. Compare visible flows with implemented permissions and specifications; exercise synthetic mutations locally.
3. **Administration:** customers, catalog/media/availability, cost and approval policies, shipping and reports, timestamped notes. Check task grouping, empty/error states and small-screen operation.
4. **Permissions and recovery:** tenant/site/customer isolation, stale sessions, independent approval, uncertain writes and retries. Run targeted fault cases, inspect underlying facts, repair confirmed gaps.
5. **Integrated polish:** revisit the corrected journeys, responsive/keyboard/accessibility checks, startup and health, final source/deployment identity. Publish a concise remaining-dependencies list with evidence limits.

## Findings and results

Initial live release passed read-only desktop1440/phone390 guest/customer/admin journeys. Pre-release checks do not count as review passes. Each following pass incorporates the preceding fixes; independent read-only preparation can run concurrently.

## Pass 1 — Navigation and orientation

Completed review against deployed source `a5ca594`, schema 28, at `https://dstrbtr.ca`, with local corrections pending a later owner-authorized deployment.

Live read-only Chromium journeys at 1440 × 900 and 390 × 900 passed for guest, buyer and administrator. Verified session-aware public entry points, buyer-only account pricing links, signed-in application/sign-in CTA exclusion, keyboard product and workspace entry, public/workspace/product breadcrumbs, product back/forward/reload, signed-in public-home refresh, and confirmed logout followed by unauthorized session/dashboard reads and guest state after reload. All five staff note histories were readable; buyer note controls were absent and each captured history endpoint denied access with 403. Screenshots and document-width assertions found no page overflow; zero page errors or attempted business writes occurred. Only login/logout mutated live state. The ignored harness and receipt are `local-evidence/notes-release-20261005/verify-live.mjs`, `live-verification.json` and `live-verification.log`; screenshots are in that same directory. Initial failed receipts remain as `live-verification-failed-first.*` and `live-verification-failed-navigation-helper.*`; the initial complete release receipt is retained as `live-verification-release-pass.*`.

Confirmed and corrected locally:

- A bundled catalog product could briefly render “Product not found” because the parent route and child hash state advanced separately. Product routing now reads a consistent external hash snapshot; genuine invalid product URLs retain their explicit missing-product state.
- Public catalog search/category choices were lost on reload or breadcrumb return. Filters now live in the public hash, search updates replace history while retaining keyboard focus, and product links carry the return context. Back/forward, reload and the Products breadcrumb preserve it.
- Administration tabs were uncontrolled and absent from the navigation section allowlist and breadcrumb names. Trade applications and Staff and buyer access now survive direct links, reload and history navigation with matching current-page breadcrumbs.
- Public catalog breadcrumbs started at the viewport edge. Their 5% horizontal gutter now aligns with catalog content at both reviewed widths.

Local validation: production build passed (existing bundle-size advisory remains), typecheck passed, public browser suite **19/19 passed**, and `git diff --check` passed. React Doctor scanned five changed files with no diagnostics (reported score 63/100); this is not a whole-repository quality claim. Regressions cover false missing-product rendering, search focus/history/reload/return context, Administration deep links/history/reload, and desktop/phone breadcrumb alignment. Local logs and screenshots are retained under `local-evidence/notes-release-20261005/pass1-*`. These corrections are not yet verified live. Review uses desktop Chromium with simulated phone width; physical-device and external-provider qualification remain outside this receipt. Mobile staff-header wrapping is assigned to Pass 3.

## Pass 2 — Customer purchasing

Reviewed the local working tree over source `a5ca594`, schema 28. Corrections remain pending later owner-authorized deployment; this pass performs no live business writes.

Confirmed and corrected:

- Shop categories previously filtered only the loaded first page. Category filtering now runs on the server before the bounded 20-product page, retaining current customer entitlement, availability and pricing predicates. Later-page continuation retains the category.
- Selected Shop products disappeared on reload and could not be shared through a safe workspace location. Shop now accepts an allowlisted product identifier, reads that product through the current approved customer catalog, and preserves detail across Back, Forward and reload. Product detail has a Shop breadcrumb and returns keyboard focus to the original product control. An unavailable or inaccessible selection displays an explicit state and offers no order-preparation action.
- Completing the initial supplemental dashboard reads could remount Shop and erase a newly selected category. Shop now retains its filter state while the current result component refreshes.
- Shop now includes a visible “Resume a saved cart” entry to the Orders queue containing saved carts.

Production files changed for this pass: `src/server/catalog.ts`, `src/server/http.ts`, `src/web/navigation.ts`, the Storefront integration in `src/web/main.tsx`, `src/web/storefront.tsx` and `src/web/storefront.css`. No schema or catalog write operations changed. Test files changed: `tests/storefront-browser-server.ts` (expanded catalog enabled only for the discovery fixture), `tests/storefront-browser-journey.ts` (current modal/tab navigation and persistent-detail assertions), and new `tests/customer-catalog-discovery.test.ts`, `tests/customer-catalog-discovery-browser-journey.ts`, `tests/customer-catalog-discovery.playwright.config.ts`.

Validation: backend discovery, catalog-entry, pricing-policy and safe-navigation tests **16/16 passed**. Tests cover serialized products beyond the first unfiltered page, bulk continuation without duplicate rows, direct hidden/retired/unknown/unapproved selections returning empty results, foreign product exclusion, foreign identity/customer denial, unsupported category rejection, and identical account price/public projection for direct and normal filtered reads. Existing storefront browser journeys **4/4 passed**: mobile native approval/withdrawal/fresh resubmission, permitted resources and retirement, explicit removal of revoked saved items, global availability and refreshed detail. Pricing browser **1/1 passed**, including multiplier, detailed/net-only disclosure, history and ambiguous-response recovery. Reports browser **2/2 passed**, including buyer report access, user-scoped preferences/reload, phone layout and financial transaction/date filters. Discovery browser **1/1 passed**, including a deliberately delayed initial security read to verify category retention after supplemental dashboard completion, an off-first-page category, second page, product Back/Forward/reload/focus/breadcrumb, saved-cart entry, inaccessible direct selection and phone overflow. Typecheck, production build, focused Prettier and `git diff --check` passed; the existing large-bundle advisory remains.

Harness failures remain documented: an early expanded shared fixture moved a legacy administrator test product beyond its first page; the expansion is now isolated to the discovery config. Legacy tests initially attempted navigation through an open modal or editing an unselected customer tab; tests now use the visible intended controls. Parallel suites initially shared Playwright’s default artifact directory, causing `ENOENT` trace cleanup errors despite completed assertions; final suites use distinct output directories. The discovery fixture shares port 3216 with the original storefront fixture and is run sequentially after explicit port-collision rejections. A first race-fix rerun started before the production bundle was rebuilt and reproduced the old failure; the rebuilt bundle passed, including the deliberately delayed-read regression. These failures do not establish production failures.

Limits: synthetic local data, Chromium with simulated 390 × 844 phone dimensions, and current account pricing. No new SKU media mapping, supplier qualification, physical-device or external-provider qualification, payment execution, live write or deployment was performed. Category/search state remains local to the mounted Shop; the selected product identifier survives reload, while those filters are not persisted. Reports and existing order journeys were exercised; this pass does not claim every invoice/payment/provider workflow has been requalified.


## Pass 3 — Administration

Reviewed customer administration, catalog lifecycle, pricing policies, shipping, reports and private notes using local synthetic data. Catalog-management/reporting baseline **5/5 passed**. The customer lane also checks pricing displays and report calculations after its purchasing corrections; those outcomes are recorded in Pass 2.

Confirmed and fixed:

- A successful retry of a failed note-history read left the obsolete error visible. Successful reads now clear transient errors while preserving an unreadable-storage safety lock.
- Discarding a definitively rejected shipping change reloaded current terms but retained the previous conflict alert. Discard now clears that obsolete alert; uncertain attempts still retain exact-retry controls.
- Staff resource links, identity and sign-out competed for one narrow phone row. They now wrap into readable rows at 360, 390 and 768 pixels.
- Staff-note disclosure controls now have a 44px minimum target and explicit keyboard focus. Screenshot inspection found cramped note text in a narrow table action column; the note panel now preserves a readable 16rem minimum within the horizontally scrollable table.

Regression checks reproduced both stale alerts before correction. Notes **2/2** and shipping **2/2** passed after correction, including existing append-only history, independent verification, buyer exclusion, lost-response retry, and exact shipping disclosure. The readable-width assertion initially assumed a 16px root size; actual root size is 15px (16rem = 240px), and the corrected assertion passed in the final notes **2/2** rerun. Header and readable-note screenshots were inspected. Earlier red/harness receipts are retained. Private evidence: `local-evidence/notes-release-20261005/pass3-*`. Phone checks use Chromium viewport emulation; physical Safari remains unqualified.

## Pass 4 — Permissions and recovery

Reviewed the local working tree over `a5ca594`, schema 28, after the Pass 3 corrections. The review covered notes tenant/record/site permissions and server-owned authorship, current sessions and MFA, buyer catalog/pricing disclosure, independent price override approval and uncertain command recovery. No server permission changes were required by this pass.

Confirmed and corrected:

- A lost notes response followed by a 401/403 retry erased its idempotency key before the outcome was resolved. Both add and verification attempts now retain their exact command, payload and key across authorization failures.
- Notes attempts lived only in session storage, which sign-out cleared. Recovery now uses durable browser storage scoped by organization, staff identity and record. Valid legacy attempts migrate only after persistence succeeds. Sign-out preserves the scoped legacy entries even when the user starts from a public page before any notes component mounts; unrelated session entries still clear.
- A stale second tab could overwrite the same actor's pending attempt. Sending now checks the stored attempt before replacing it, and completion only clears the matching saved attempt. Conflicts and unavailable/malformed storage block mutations and preserve the original bytes for recovery. Successful note-history refreshes do not clear those storage locks.

Validation: focused backend catalog/pricing/price-override/notes and customer-discovery suites **54/54 passed**. Recovery browser **8/8 passed**, covering real synthetic commit with a lost response for add and independent verification; exact retry after 401/403, reload, sign-out and reauthentication; buyer 403 and absent pending text/controls; another staff actor not inheriting the attempt; exact legacy migration; malformed durable/legacy storage; conflicting attempts; failed migration; stale second-tab overwrite rejection without a command; and legacy public-page sign-out before migration. The original notes browser **2/2 passed** after these changes, retaining the Pass 3 transient-read-error correction, five-record-kind coverage, independent verification, buyer exclusion and responsive layout assertions. Typecheck, production build, focused formatting and `git diff --check` passed. The existing bundle-size advisory remains.

The red recovery run reproduced loss of the saved retry after 401 before correction. Its initial test harness incorrectly expected an empty note list to have visible dimensions; the corrected failing run and earlier harness receipt are both retained. Private local evidence: `local-evidence/notes-release-20261005/pass4-*`, including `pass4-notes-recovery-red-after-harness.log`, `pass4-notes-recovery-green.log`, `pass4-notes-original.log` and `pass4-permissions-final.log`. New tests are `tests/record-notes-recovery-browser-journey.ts` and `tests/record-notes-recovery.playwright.config.ts`.

Limits: workstation Chromium with synthetic accounts/data and intercepted response faults; no live business writes, deployment, physical-device test or external-provider qualification. Browser storage is scoped application recovery, not encryption or cross-device synchronization. The stale-tab check prevents replacing an already stored different attempt; it is not a general atomic multi-tab transaction mechanism. Source is frozen for the parent’s final integrated checks and later authorized release.

## Pass 5 — Integrated polish

Passes 1–4 are incorporated into a frozen source snapshot. Final public navigation **19/19** and workspace navigation **5/5** passed. Typecheck, full formatting, planning structure and whitespace checks passed. Full backend regression **6,049/6,049 passed**, with no failures, skips or cancellations (166.0s). The local Linux AMD64 image built successfully and matched all 395 source/package hashes; deployed identity checks remain pending. Container input now excludes macOS `.DS_Store` metadata; the source/package manifest contains 395 tracked files.

Final activation and live verification will be recorded below; this intermediate checkpoint is not a deployment or completion claim.
