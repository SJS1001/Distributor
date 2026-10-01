# Local engineering receipt — 2026-09-30

Status: PASS for the enumerated local checks only; full-system acceptance remains incomplete. Reviewer: Codex automated engineering checks and screenshot inspection, with no human operator or provider sign-off. All product gates remain NOT VERIFIED.

Exact tested source/configuration content is identified by the adjacent [SHA-256 manifest](LOCAL-ENGINEERING-2026-09-30.json). Files are local and uncommitted; no commit identity exists. The manifest excludes itself and generated/ignored artifacts. Re-run affected checks after source/configuration changes; a file name alone cannot establish validity.

Environment: macOS arm64, Node 24.16.0, npm 11.13.0, native SQLite with WAL/FULL durability, pinned package-lock dependencies and local Playwright Chromium. Disposable synthetic databases; no real customer data or network payment/accounting/carrier operation. The browser server binds loopback HTTP. This is not a production TLS, hosted CI, hardware or residency inspection.

| Command | Actual outcome |
| --- | --- |
| `npm run typecheck` | Exit 0. Strict TypeScript check. |
| `npm test` | Exit 0; 14 passed, zero failed/skipped. Real SQLite workflow/restart, command identity/rollback, current account/site grants, ownership/schema guards, picked cancellation, optional projection, HTTP origin/CSRF validation, buyer isolation, residency withdrawal, uncertain provider reconciliation and three separate-process races. |
| `npm run test:e2e` | Exit 0; build plus one Chromium journey passed. Multi-line order, lost response after acceptance, retry without a duplicate, serial/bulk picks, collection/invoice, strict provider block, regional migration refusal, named Stripe exception, queued intent, manual payment, quarantine return/inspection/restock/credit and mobile dialog Escape. |
| `npm run format:check` | Exit 0. All selected source/test/configuration files formatted. |
| `npm run verify:plan` | Exit 0. Task/gate dependency, traceability and local link checks only. Historical effort remains 248–396 baseline plus 8–14 optional developer-days; expanded country/provider scope needs re-estimation. |
| `npm audit --omit=dev` | Exit 0; zero known production dependency vulnerabilities reported at inspection. Not proof of application security or license compliance. |

Independent assertions use explicit expected cents/quantities. The browser invoice is CA$169.50 (one equipment unit at 100.00 plus two supplies at 25.00, fixture tax 13%); paying 169.50 and crediting the returned equipment 113.00 yields balance -113.00. These provisional tax/commercial fixtures are not approved US/Canadian tax policy. The refund test splits 113.00 into 60.00 and 53.00, rejects reused bank evidence for the second refund, then accepts a separate reference and reconciles to zero. Cross-process tests require one winner for last stock/shared credit and one durable response for the same command key. The planned full 190.00 stock-cost oracle has not yet been exercised.

Historical failures retained as narrative because exact pre-fix source manifests were not captured: CSS data import failed build; initial schema guard denied SQLite-owned auto-index names; a test used reserved SQL alias `escape`; browser selected unstocked Ottawa; exact label lookup failed for wrapped select contents; asynchronous option lookup ran before its dialog loaded; format check flagged two files. The relevant source/tests were corrected and the final commands above rerun. The latest passing receipt does not manufacture versioned evidence for those earlier candidates. Local browser trace paths are overwritten by Playwright and are not historical receipts.

The mobile screenshot at `local-evidence/browser-mobile.png` was visually inspected: form focus is visible, navigation/table content scrolls horizontally at 390px, and the customer choice remains reachable. This single screenshot is not an accessibility audit, full mobile usability acceptance or scanner qualification.

Limits: provider tests use explicit synthetic adapters; actual Stripe/QuickBooks adapters remain disabled/unqualified. No outbound worker/webhook route, OAuth/mapping lifecycle, PDF/delivery/aging, complete partial-transfer/packing UI, camera/label/printer qualification, import/restore/load/cutover, user lifecycle/MFA, replacement/manufacturer workflow or full CH-01–CH-11 acceptance is established by this receipt. Infrastructure region, backups/logs/support/vendor processing, policies and operator approval remain pending. Preserve prior planning receipts as historical; do not relabel them product passes.
