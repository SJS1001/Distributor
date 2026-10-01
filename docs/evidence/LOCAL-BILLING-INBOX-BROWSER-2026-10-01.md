# Native inbox browser checkpoint — 2026-10-01

D-022–D-025 / G4 candidate; all tasks and product gates remain **NOT VERIFIED**. Parent local commit: `d315c73`. This supplements, without replacing, the [domain/HTTP/process inbox receipt](LOCAL-BILLING-INBOX-2026-10-01.md).

Environment: direct macOS arm64 workstation commands, Node 24.16.0/npm 11.13.0, installed headless Chromium, disposable synthetic SQLite WAL, one browser worker on loopback. No local/self-hosted/cloud CI job, push, PR, live data, provider request or deployment.

## Candidate and intended evidence

The PDF helper requires a nonempty download receipt before offering the file or clearing the permanent retry key. Its existing PDF MIME/SHA checks remain. Re-downloading an already personally confirmed publication does not ask for another receipt confirmation.

The new browser journey sets up a native synthetic 2-unit shipment/invoice through authenticated HTTP commands, creates separate buyer contexts with required password changes, reviews/cancels/publishes an original PDF as an administrator acting with finance authority, injects missing receipt headers and lost committed responses, cancels/confirms buyer receipt, withdraws/retries from finance and rejects a stale buyer page, republishes under a fresh identity and exercises credit PDF publication/confirmation. Independent expected original gross: 22,600 CAD cents; one returned unit credits 11,300, leaving 11,300 outstanding. Publication/download/confirmation/withdrawal alone must leave invoices, stock, orders and shipments unchanged. Buyer colleagues have separate personal receipt evidence; another account has no inbox visibility.

## Preserved checks and failures

- First focused browser run: one failure in 6.3 seconds; the test expected “Change your password before continuing” instead of the actual “Change initial password” heading. Corrected the locator without bypassing forced password change.
- Intermediate focused invoice-only run: one pass, 4.8 seconds total (3.0-second test); superseded by expanded credit/personal-scope candidate.

Human confirmation/legal wording/channel approval, production pagination/retention/security/upgrade/load/recovery and actual regional deployment/provider/device qualification remain pending. Automated clicks do not prove human receipt or consent. No product gate is passed by these checks.
- Expanded browser run: one timeout at 60 seconds; the credit-table locator used the business reference although the table displays its credit number. The invoice, colleague-isolation and stale-withdrawal stages completed before this test-only locator failure. Corrected the locator to the returned original credit number.

## Final local checks

| Command | Observed outcome | Scope |
| --- | --- | --- |
| `npm test` | Exit 0; 117 passed, zero failures/cancellations/skips/todos; 7472.935459 ms. | Full Node domain/HTTP/process regression; no external provider qualification. |
| `npx playwright test --grep 'customer inbox review'` | Exit 0; expanded journey passed, 4.3-second test / 5.8 seconds total. | Focused synthetic invoice/credit inbox browser check after correcting the two test locators above. |
| `npm run test:e2e` | Exit 0; build 95 ms; all 16 Chromium journeys passed in 26.2 seconds. | Final production client bundle served locally; new journey passed in 3.9 seconds alongside the existing regression. |
| `npm run typecheck` and `npm run format:check` | Exit 0. | Final TypeScript candidate and configured formatting scope. |

The [machine receipt](LOCAL-BILLING-INBOX-BROWSER-2026-10-01.json) binds exact source, test, dependency and documentation hashes, plus structural planning validation. It excludes itself, ignored databases/builds/dependencies/test output and incidental workstation metadata. Historical receipts are retained unchanged; they identify earlier tested versions.

The missing-header and dropped-response attempts reuse one PDF request key and one prepared receipt. Canceling publication/receipt creates no publication/acknowledgment respectively; a confirmed buyer's repeat download creates no second acknowledgment or dialog. Another account sees no publication, and a colleague has separate personal evidence. Withdrawal retains the original confirmation and blocks a stale buyer page; republication creates a fresh identity with no inherited acknowledgment. Invoice and credit download bytes match the administrator-reviewed originals. Native credit changes the balance by the expected 11,300 CAD cents; inbox operations leave stock/orders/shipments unchanged.

These are automated synthetic checks, including administrative finance authority; they do not qualify a separate human finance operator, real customer receipt, consent, commercial wording or production deployment. All 44 tasks and 10 product gates remain NOT VERIFIED; the full-system goal remains incomplete. This checkpoint is committed locally only, without any CI runner execution or push.
