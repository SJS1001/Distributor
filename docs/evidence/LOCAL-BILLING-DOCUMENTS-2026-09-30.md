# Local billing documents checkpoint and folder/access review

Date: 2026-09-30, America/Toronto; execution continued into 2026-10-01 UTC. Candidate: local uncommitted workspace with no Git HEAD. Environment: Darwin 27.0.0 arm64, Node 24.16.0/npm 11.13.0, native SQLite WAL/FULL, local Chromium and disposable synthetic databases. This is bounded D-022–D-025 engineering evidence and a planning/folder review. All 44 tasks and 10 product gates remain NOT VERIFIED.

## Result and candidate

Billing owns versioned issuer/customer profiles, immutable original invoice/credit facts, stored PDF renditions and prepared download receipts. Native issuance captures identity/terms in its existing atomic transaction; later profile or ledger changes do not rewrite original amounts. Imported opening documents retain original financial baselines and source/cutoff provenance, explicitly disclose unavailable historical identity and are reconstructed PDFs. Legacy native terms stay unknown. Credits inherit original invoice identities. Current UTC aging keeps open debt, credit balances, signed net, holds and pending refunds distinct; finance CSV exports retain prepared command/audit evidence and escape formula-leading strings.

Authenticated PDF downloads enforce organization/account/current role, session, origin, CSRF, exact input and an idempotency key. Rendering yields outside a transaction, followed by fresh session/principal authorization. The final transaction selects one immutable rendition and writes one prepared receipt; late receipt faults roll back bytes and request evidence. Lost-response browser retries retain the original key and verify MIME/SHA-256 before offering the bytes. Receipts do not establish that a customer saved, read or accepted a document. See the [runbook](../BILLING-DOCUMENTS.md), [contracts](../CONTRACTS.md), [implementation limits](../IMPLEMENTATION.md) and [dependency notices](../THIRD-PARTY-NOTICES.md).

## Final executed checks

| Check | Actual outcome |
| --- | --- |
| `npm run typecheck` | PASS, exit 0 |
| `npm test` | 87 PASS, 0 failures/cancellations/skips; 7299.102458 ms |
| `npm run test:e2e` | Production build PASS; 11 Chromium journeys PASS, 16.1 seconds |
| `npm run format:check` | PASS after formatting the aging CSV audit block |
| `python3 scripts/verify_plan.py --json` | PASS: 44 tasks, 10 gates, 11 scenarios, 14 decisions, 22 requirements; 35 Markdown files/204 local links; no structural/link errors |
| Actual PDF raster inspection | Static-font synthetic page visibly readable, including English/French identity/address and original amount/tax/terms |
| Automated raster regression | Independent PDF.js/canvas rendering tests more than 500 dark pixels in the invoice heading crop; observed corrected sample 610 versus rejected variable-font sample 282 |

Final formatting and planning structure/link outcomes are recorded in the accompanying [machine receipt](LOCAL-BILLING-DOCUMENTS-2026-09-30.json). Their scope is local source consistency and planning structure, not business/provider/production acceptance. The machine receipt binds current relevant files and confirms historical receipt content is unchanged.

Eight new billing tests independently verify native/imported original money, party identity and terms despite edits/cash/credits/restart; current buyer/foreign-account/organization/role and expired/deactivated authority, including cached requests; simultaneous render retries and injected late receipt rollback; PDF byte/facts corruption; long French pagination, all 40 source lines, text bounds/page numbers and unsupported glyph rejection; stale profile revisions; formula-safe and audited finance CSV; and HTTP authority/input/MIME/hash/retry/logout. Independent PDF.js extraction and rasterization exercise actual PDFs, not renderer-produced metadata alone.

Independent native controls are 20,000 CAD cents net, 2,600 tax and 22,600 gross, customer terms 30 calendar days. A later 10,000 payment and 11,300 credit leave 1,300 current debt while the original invoice PDF remains unchanged. Credit PDF retains 11,300 gross and 1,300 tax. An opening document retains 22,600 original gross with paid 5,000/refunded 1,000 and 18,600 current debt; subsequent payment 8,600 leaves 10,000 without rewriting the PDF. Independent due-date boundary fixtures distinguish -1/0/1/30/31/60/61/90/91 UTC days. Positive debt totals 167,400, credit balance 11,300, signed net 156,100 and pending refunds 3,000; settling that refund changes credit balance to 8,300/net 159,100 and pending to zero.

The eleventh browser journey edits billing profiles, downloads reconstructed original invoice bytes, recovers a committed but lost PDF response with one receipt, parses French/original amounts independently, downloads a credit PDF and finance aging CSV, and displays prepared evidence. The prior ten journeys also pass. No real customer/provider data is used.

## Preserved failures and superseded evidence

- Initial source typecheck failed on four BLOB/digest typing errors; corrected primitive row/digest types. Initial new test typecheck failed on PDF proxy destruction and a nonexistent refund method; corrected loading-task disposal and actual operation.
- First eight-test run: six PASS/two FAIL, 8963.971167 ms. The injected trigger lacked the billing owner prefix and a fixture referenced nonexistent `iam_customers`; corrected the fixture/trigger without weakening owner enforcement. Subsequent targeted eight tests passed, 9296.322333 ms. Intermediate 87-test runs passed at 9468.531208 and 9724.07725 ms but were superseded by the final static-font candidate.
- First 11-journey browser run: nine PASS/two FAIL, approximately 1.3 minutes. The existing invoice-money assertion became ambiguous when aging exposed the same amount; the failed earlier journey then left a credit fixture unavailable. Scoped the existing assertion to its invoice row. Subsequent 11-journey run passed in 16.3 seconds, before the final static-font rerun above.
- Variable Noto Sans passed text extraction and the intermediate suite but failed actual raster inspection: visible glyphs were missing. Preserve the [failed synthetic PDF](BILLING-FAILED-VARIABLE-FONT-2026-09-30.pdf) and [failed raster](BILLING-FAILED-VARIABLE-FONT-2026-09-30.png). Replaced the runtime binary with an unchanged pinned static Noto Sans, retained its actual SIL OFL notice, and added an independent raster heading regression. The [corrected synthetic PDF](BILLING-SYNTHETIC-SAMPLE-2026-09-30.pdf) and [corrected raster](BILLING-SYNTHETIC-SAMPLE-2026-09-30-1.png) remain demonstration artifacts, not approved commercial samples.
- Final formatting initially failed on `billing-documents.ts` after adding export audit evidence. Applied Prettier to that file without semantic changes; the subsequent formatting check passed. No application behavior changed after the final Node/browser checks.

Historical receipts remain unchanged and superseded runs are not presented as final-candidate verification. Final self-review also corrected the pako license inventory to retain both MIT and actual Zlib notices and identify tslib's declared 0BSD terms. Fontkit's absent standalone license, embedded notices and remaining source/packaging qualification are explicit.

## Planning choices and authenticated repository access

Reviewed the folder's planning package and current handoff against the latest owner replies: complete planning package; US/Canada and USD/CAD; Stripe and QuickBooks; major carrier/device candidates with specific qualification pending; customer choice separately for each named provider residency exception. No choice silently grants unrelated providers or changes region residency. The package is complete as a reviewable plan with explicit operating decisions and verification work; product acceptance remains outstanding.

Fresh read-only authenticated API checks returned identity `SJS1001`, public active `SJS1001/Distributor`, default branch `main` and pull/push/admin/maintain/triage permissions. Actions is enabled, allowed actions `all`, required SHA pinning false, and workflow count zero. Origin is `https://github.com/SJS1001/Distributor.git`; `git ls-remote origin` succeeded with zero refs. This confirms current API/Git access. Future required `sjsmithbot` PR/merge identity remains unverified.

Distributor uses GitHub-hosted runners under its explicit repository exception. No local/self-hosted runner, Depot, inherited OPUS label, workflow or registration was created. Hosted OS/capability, cost/usage limits and first-workflow security still require verification before a workflow is introduced. No remote mutation, publication, deployment, provider request/account, purchase, live data ingestion or OPUS/UB integration occurred. Files remain local/uncommitted.

## Limits and next work

Approved legal/tax layouts and required identity fields, commercial terms acceptance, numbering/corrections, finance reconciliation, historical original-file and credit migration, customer delivery/acknowledgment, provider refunds/accounting/OAuth/secret lifecycle, camera/labels and user/security lifecycle remain open. Production schema upgrades, abrupt crash/disk/render-load faults, historical statements, cutover/restore rehearsal, actual infrastructure/provider residency and named device/vendor qualification have not been established. Automated local passing checks do not verify D-025, G4 or the full-system goal. Preserve module ownership, independent native operation, prior failures and all OPUS/UB boundaries.
