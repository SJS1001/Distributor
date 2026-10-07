# Administration and customer usability review — 2026-10-07

## Scope and tested version

Owner-authorized implementation following the public-page and workspace layout work. Base commit: `2639a3ae92adabdd5391a9d3cda4a2f98aa49f2e`. This receipt covers workstation source, isolated synthetic fixtures and local preview; it does not describe a production release or advance a product gate.

Final browser build: `index-DRx3ecJM.js` / `index-BNY86wVX.css`. The final 43-file changed source/test manifest SHA-256 is `d6b9e4e09670d521d10263136aa58ac7d8251abd9795f848c90cb2e688959c1b`; it is retained at `.local/admin-customer-review/changed-source-test-manifest.json`. Private screenshots, browser inventories, traces and command logs remain local.

## Resulting behavior

- Public pages, sign-in and both workspaces use one shared `dstrbtr.` typographic mark with the blue terminal dot. Administration's previous unrelated icon/text lockup is removed; its wordmark returns to the workspace home.
- Administration retains grouped navigation and task tabs. Orders and receiving expose primary actions with supporting instructions collapsed. Catalog actions, account minimums and retained warranty assessments have tighter, aligned grouping; small-screen forms wrap within the viewport.
- All eight account-aging amounts use consistent buttons and open the corresponding invoice investigation. Invoice detail includes the customer checkout request entrance and accurate customer breadcrumbs.
- An order's Actions entrance loads that exact authorized order even when the queue's current filters exclude it. Returning to the queue preserves its filters. Detail refresh retains open history and drafts, with permission/not-found handling that clears inaccessible records.
- Workspace Refresh propagates into order, invoice, customer, enrollment, supply and coverage details. Redundant normal refresh buttons are removed where the shared control owns the operation; explicit failure retries remain. Failed pagination refresh can retry even after a previously exhausted page.
- Refresh preserves edited customer minimums, pending exact requests and the revision originally reviewed. A changed server revision requires explicit review before saving. The same principle protects an in-progress order-approval decision; its staff review prompt is absent from the buyer view.

## Page coverage

Administration: Overview, Orders, Customers, Catalog, Inventory, Purchasing, Returns, Billing, Reconciliation, Operations health, Audit history, Event reporting, Imports, Administration and Security.

Customer: Shop, Orders, Invoices & payments, Reports, Returns & warranty and Account.

The page audit visits each exposed task tab plus selected customer/product/order/invoice details and dialogs, inventories controls, checks shared branding, and inspects layout at 1440, 390 and 320 CSS pixels. It exercises eligible safe controls, navigation, filters, disclosures and refresh. Meaningful command journeys use isolated synthetic fixtures rather than live records.

## Verification

| Check | Actual outcome |
| --- | --- |
| Full native suite | 6,118/6,118 passed; no skipped or cancelled tests |
| Workspace layout | 2/2 passed across Chromium/WebKit |
| UI integration | 7/7 passed |
| Catalog/images | 8/8 passed |
| Receiving | 6/6 passed |
| Detail refresh, draft/revision/retry behavior | 3/3 Chromium checks passed |
| Application/invitation/activation and boundaries | 18/18 passed across Chromium/WebKit at three widths |
| Storefront/order-approval journey | 8/8 passed on `index-DaFKUfN7.js`; subsequent change is narrow form CSS |
| Public application through buyer sign-in | Chromium and fresh-fixture WebKit each passed |
| Full administration/customer traversal | 2/2 passed: Chromium 29.7 seconds, WebKit 28.3 seconds |
| Focused WebKit minimum-order geometry | 1/1 passed at 1440/390/320 widths |
| Typecheck, build, formatting, diff and planning validation | Passed |

The final audit visited 80 surfaces per engine (58 administration, 22 customer), made 240 dimension checks and recorded 130 safe/functional actions per engine. Both engines recorded zero JavaScript errors, unexpected API failures or document overflows. Injected catalog 503 failures recovered through Retry with the search retained. Actions included all eight aging filters, exact-order actions with an excluding queue filter, invoice PDF download, synthetic Stripe checkout, and payment/global-refresh behavior. Final private receipt: `test-results/page-by-page-audit-DRx3ecJM-final/audit-receipt.json`; each engine has its inventory and 240 screenshots. Six Chromium contact sheets and sampled WebKit contact sheets were visually reviewed. The 54 scoped browser checks plus the final two-engine traversal passed, with the focused geometry check recorded separately. Earlier scoped suites preceded the last buyer-only visibility correction and narrow CSS correction; storefront covers buyer visibility and the final page audit covers the resulting build. React Doctor found no errors in the reviewed changes; component size/complexity and related advisory findings remain maintainability debt. The build still reports its existing large-chunk advisory.

## Failures retained and resolved

- Initial native run: 6,108/6,118. Ten failures came from historical schema fixtures retaining later warranty tables or expecting the prior current version. Fixture-only corrections restored valid historical inputs; 59 affected tests and then the entire 6,118-test suite passed. Pinned fingerprint validation was preserved.
- Receiving/enrollment/integration tests contained old labels or old navigation assumptions. They now use the current visible actions and grouped navigation.
- Broad traversal exposed a 320-pixel WebKit Terms-form overflow. Focused computed-box measurements identified the minimum-order legend: an inherited floated 100%-width rule produced a 284-pixel legend inside a 244-pixel fieldset. The scoped legend correction passed at all three widths; speculative purchasing-rule overrides were removed. Earlier audit failures also included nested collapsed-control selection, an ambiguous payment-cell locator and obsolete/audience-mismatched sign-in routes and a sign-out completion race; those harness issues were corrected without weakening the app assertions or changing authentication boundaries.
- The storefront resubmission test attempted a staff decision against an earlier reviewed revision. It now explicitly reviews the latest request before deciding. The accompanying buyer-only staff-prompt defect was corrected and covered.
- A combined public enrollment run reused one applicant email across engines on a shared fixture. WebKit passed with a fresh isolated fixture. Production enrollment behavior was not changed to accommodate the test.

Initial failure logs and traces are retained privately alongside passing receipts.

## Limits

Synthetic browser/provider records establish the exercised application behavior, not live Stripe, carrier, accounting, email delivery or physical warehouse qualification. This audit does not execute every destructive or privileged control in every possible state, nor substitute for physical-device or assistive-technology operator testing. No production data, infrastructure, provider credentials, deployment, CI job, pull request or merge was changed by this review. Existing seed data is retained.
