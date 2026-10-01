# Sold serial search — local engineering receipt

Date: 2026-10-01. Status: **PASS for the bounded local checks below**. Partial D-008/D-030/D-031 engineering relevant to CH-06/CH-07, REQ-03/REQ-17 and G1/G6. All 44 acceptance tasks and 10 gates remain **NOT VERIFIED**. The full system is incomplete.

Parent `ae2dd5a3831d6b3f78c5b62f230b99d9db35e521`; branch `codex/local-distributor-checkpoint`. The [companion content record](LOCAL-SOLD-SERIAL-PAGES-2026-10-01.json) binds 237 application/test/configuration/license inputs captured at `2026-10-01T20:20:31.870495+00:00`, document hashes, actual command/log hashes and 159 unchanged historical evidence files. The corrected backend capture at `2026-10-01T20:19:11.867529+00:00` differs only in the browser test file; all backend/application inputs are unchanged. Content hashes identify the tested bytes without a self-referential commit field. Parent agent implementation and self-review only; no independent or human acceptance.

## Environment and expected versus observed outcomes

Direct workstation commands in `/Users/stevensmith/Documents/Distributor`, macOS arm64, Node v24.16.0, npm 11.13.0, repository-pinned dependencies, disposable native SQLite and local Chromium. Fixtures use synthetic US/Canadian organizations and actual local receive/order/pick/ship/return/replacement/resale commands. No schema/dependency/license change or third-party source import.

- The dashboard and compatibility soldUnits operation return a first page of at most 20 currently sold serials. The dedicated API supplies a continuation. US and Canadian fixtures each contain 44 eligible serials plus 45 earlier-sorting serials belonging to another account: buyer traversal returns 20/20/4, without duplicates, omissions or another account's rows. Staff account filtering and dashboard continuation are checked. Projections contain only id, productId, serial and accountId.
- Literal ASCII case-insensitive substring matching trims validated input and treats SQL wildcard/quote characters as ordinary text. Unknown, duplicate, empty and oversized HTTP fields reject. Unavailable, foreign-organization, unsold, wrong-account or nonmatching-search cursors reject. Reads return no-store, require a current session and change no retained native facts across restart. Fresh actual account/role/password/status changes govern access; forged actor properties cannot restore it.
- Returned serials disappear; reserved replacements are absent until actual handover. Handed-over replacements resolve their current claim account. Ordinary resale belongs to the new account. Historical fulfillment lookup still resolves the original ordinary shipment after a return, and the newest ordinary sale after resale; the former buyer cannot access the new sale. Coverage and claim commands retain native custody/entitlement checks.
- Claims and coverage share explicit serial search and continuation. Changing search clears selection and coverage. Failed continuation preserves rows, clears selection and retries the same cursor/query. Successful reads focus the selector. Enter in the search input starts a read without submitting a claim. A phone buyer finds a serial beyond the initial dashboard page and submits exactly one native claim with its current account. The exercised journey has no horizontal overflow or JavaScript errors.
- Held browser reads are observed canceled on search changes and panel/dialog exits before responses are released. Coverage checks exercise close, Refresh, navigation and sign-out. Claim Cancel uses a normal pointer click; claim Refresh/navigation/sign-out checks activate background controls using native keyboard Enter. These keyboard checks do not prove that a pointer can reach controls behind the modal or qualify the complete modal focus behavior.

## Actual verification

| Command | Actual outcome |
| --- | --- |
| `npm test` at corrected backend capture | PASS 844/844, zero fail/cancel/skip/todo; TAP 21521.496125 ms; command 21.721455291000893 seconds |
| `npm run test:e2e` at final integrated capture | Production build PASS; Chromium PASS 51/51; command 93.41894670799957 seconds |
| `npm run typecheck` at final integrated capture | PASS, exit 0 |
| `npm run format:check` at final integrated capture | PASS, exit 0 |

The corrected scoped browser/build passed 3/3, including existing replacement collection, existing coverage and the new search journey. Earlier focused checks and captures are retained as intermediate evidence; a focused compatibility command started before strengthened resale assertions and is not the final backend result. Receipt-stage planning/link and whitespace command records follow document preparation. No tested application input changes during receipt preparation.

## Preserved failures and self-review

Initial focused backend FAIL 23/24 expected a session to survive grant editing; established IAM correctly revokes it. The corrected fixture reauthenticates. Initial type checking failed on nullable buyer-account inference; the native text validator now checks that identity. The first full backend FAIL 843/844 used json_each for compatibility sale lookup; the existing owner authorizer correctly rejected virtual-table access. The correction uses an inventory-owned ordinary-shipment reference and an exact fulfillment-owned lookup; authorizer restrictions remain intact.

The first full browser FAIL 50/51 tried to mouse-click Refresh behind the claim modal backdrop. Its trace and context were copied before reruns. Corrected checks use native keyboard activation for background actions; normal Cancel remains a pointer click. No forced pointer click, timeout increase or cancellation assertion removal. The first browser run overlaps the backend correction and is historical only. The first capture included ignored src/.DS_Store; a derived application-only manifest preserved the original capture time and all relevant hashes, followed by the corrected and final captures.

Self-review inspected owner boundaries, fresh IAM/account resolution, current shipment/replacement custody, literal parameterized search, keyset order, cursor rejection, strict HTTP schemas, no-write reads, compatibility lookup, claim-account selection, retry/cancellation/focus handling and meaningful native/browser assertions. There is no independent review or new concurrent grant-revocation race qualification.

## Limits and remaining qualification

Returned pages and candidate batches bound displayed/materialized rows, **not total scan, lookup or lock work**. Sparse accounts can require arbitrarily many candidate batches inside SQLite's immediate transaction. Production indexing, latency/contention/load, security, upgrade/recovery/retention and actual regional infrastructure remain unqualified. Other dashboard collections remain unbounded. ASCII matching is not Unicode case folding; continuation is not a snapshot or signed original-query binding. Cursor validity follows its current search/state/account scope.

Approved coverage/expiry/transferability/remedy policies, physical custody/device evidence, real providers and operator acceptance remain open. Private logs/manifests/failed traces reside under `/tmp/distributor-sold-search-checkpoint`; temporary storage has no archival guarantee. No delegation, CI runner/job/workflow, cloud source transfer, push/PR, actual provider request/account, purchase/deployment/publication, settings/live data or OPUS/UB integration occurred. All tasks/gates remain unverified and the full-system goal remains active.

Receipt-stage planning initially rejected a scenario-shaped substring inside the new receipt filename, then the repeated token in the handoff explanation. Renaming the new evidence pair and rephrasing the explanation corrected those documentation-only failures. Final structure/link checking passed: 44 tasks, 10 gates, 11 scenarios, 14 decision sheets, 22 requirements, 109 Markdown files and 631 links. No application/verifier input changed.
