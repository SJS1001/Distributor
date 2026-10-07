# Installation registration, return policy and workspace corrections — 2026-10-07

Owner-authorized local implementation and synthetic workstation verification. This is not a production release or a product-gate approval.

## Delivered behavior

- Returns has separate installation registration, ordinary return request and warranty claim entrances. Registration records installation date, installer, site and evidence reference against an exact sold-custody identity. Corrections preserve history. Local registration does not claim manufacturer submission or acceptance.
- Administrators configure an independent ordinary return window and per-product warranty terms, including whether dates start at shipment or installation. Defaults are unconfigured. Ordinary return expiry does not prevent a warranty claim; authorization still requires staff review.
- Claim submission retains an immutable assessment. The claim review shows that assessment separately from current installation/terms/policy calculations. Replacement coverage preserves the predecessor warranty dates.
- Registration and policy mutations retain exact pending requests across lost responses and reloads. Actor/account, ownership and revision guards remain enforced. Definitively rejected installation dates return to editable fields. Workspace refresh updates server reads while preserving drafts, reviewed revisions and pending requests, and calls out stale records before a new save.
- Compact sold-serial lookup and minimum-order summaries, aligned saved-cart controls, staff-only saved filters, Account last in customer navigation, and removal of the workspace GREE library shortcut. Global Refresh also reloads minimum-order requirements; its success notice dismisses after four seconds.
- The isolated localhost preview supports explicit opt-in synthetic credential prefill for administration and customer entrances. This configuration is confined to the preview fixture, not production configuration.

## Verification

Base commit `af86479a51b9d5af38659eec07201f3633575fbb`, existing `codex/local-distributor-checkpoint` branch, macOS workstation and Node24.16.0. Browser checks use built Vite assets and isolated Fastify/SQLite fixtures. Final changed-source/test manifest covers 41 files, SHA-256 `95f55aad10145eaa5a85f42b0ce533690cf8d2adb78a9207b940f90907fd90f0` (sorted relative path, NUL, bytes, NUL). Private per-file manifest is retained under `.local/warranty-registration-review/final-source-manifest.json`. Final assets are `index-NOuILf43.js` and `index-DIj6gkh7.css`.

Backend:233/233 focused warranty/schema/recovery checks passed; see [backend receipt](../WARRANTY-REGISTRATION-BACKEND-VERIFICATION-2026-10-07.md) for exact digest, ownership-cycle, migration and recovery evidence. Schema33 adds six warranty-owned tables and requires an explicit reviewed upgrade; existing production data was not migrated.

Initial scoped browser checks:11/11 passed across new warranty journeys, workspace layouts, customer returns, customer pricing, historical policy and shipment coverage. Final review regressions also check invalid-date correction, preserving drafts during Refresh, exact retry after a lost committed response, and immutable/current assessment differences. Historical failure traces remain in ignored test-results folders.

Final review verification:

- Extended warranty journeys: **2/2 passed**, Chromium and WebKit, 8.1 seconds, `npx playwright test --config tests/warranty-registration.playwright.config.ts --output test-results/warranty-registration-final-accessible-selectors`. Covers future/pre-handover date correction, reviewed policy and dirty terms retained on Refresh, a lost committed registration response with exact idempotent retry, concurrent registration corrections preserving dirty fields, distinct return/warranty requests, immutable submitted versus current assessment, open assessment global refresh and failed-read retry preserving prior results. Layouts fit 1440/390/320 pixels; zero page errors.
- Workspace layout/navigation/minimum-order/refresh notice: **2/2 passed**, Chromium and WebKit, 17.7 seconds, `npx playwright test -c tests/workspace-layout.playwright.config.ts --output=test-results/warranty-workspace-layout-final`.
- Public navigation, authenticated entrances and sign-out: **6/6 passed**, three per engine, outputs `test-results/warranty-public-navigation-chromium` and `test-results/warranty-public-navigation-webkit`. These preceded the final warranty-only refresh additions and used `index-DwarPDzr.js`.
- Final typecheck, Vite build, formatting and diff checks passed. Planning structure check passed (44 tasks, 10 gates, 469 Markdown files, 2264 local links); this checks documentation structure only. Targeted final React Doctor review reports warnings only, with guarded async refresh and component complexity advisories retained.
- Latest localhost administration entrance reopened in the internal browser. Its existing synthetic account fills both fields via the explicit preview option; Sign in remains the user's next action.

## Retained failures and limits

Initial failures included historical schema-fixture table lists, an invalid synthetic timestamp reference, obsolete navigation/heading expectations, collapsed phone navigation in a desktop assertion, and a preview/test server port collision. A real mobile overflow in registration history was corrected with bounded fields and a named scrollable table region. Independent review identified and corrected invalid-date retry lockout, hidden current claim assessment, and missing new-panel refresh signals. Extended checks caught a refresh prop initially wired to the lookup instead of registration; the correct panel is now wired. A textarea assertion was changed to its accessible textbox role after the prior locator failed on the populated field. Passing reruns do not erase the earlier receipts.

These results do not qualify actual manufacturer terms, manufacturer registration acceptance, physical equipment/scanners, assistive technology, representative operator usability, live providers or operational return/shipping procedures. Full-repository native/browser suites were not rerun for this change. React Doctor retains advisory complexity/effect warnings; Vite retains its existing large-chunk advisory. No CI, PR, merge, deployment, live business mutation or product-gate advancement.
