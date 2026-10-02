# Catalog lifecycle — local engineering receipt

Status: partial local engineering, 2026-10-02. No human acceptance or product gate verification. All 44 tasks and 10 gates remain NOT VERIFIED.

## Candidate and environment

Parent `71c8acad5a9daebcefcbd6c50d775a6ff1d3fd3d` on `codex/local-distributor-checkpoint`. The [machine receipt](LOCAL-CATALOG-LIFECYCLE-2026-10-02.json) identifies final source/test/configuration bytes, delivered assets, command outcomes and retained private artifacts. Direct macOS arm64 workstation verification uses Node v24.16.0, npm 11.13.0, local Chromium, production Vite/React assets and synthetic HTTP/SQLite fixtures. No CI runner, delegated/cloud session, provider or physical device is used.

## Changes and independent outcomes

Commercial/admin commands retire and reactivate existing products with a required reason and a hash of the current product plus its latest lifecycle receipt. Current persisted authority is checked before both cached outcomes and new effects. A retire/reactivate cycle invalidates an older review. Exact retries recover original results without repeating effects; changed input with the same key refuses. Native transactions retain product identifiers, prices and other module records. Audit history uses existing durable sequence storage; database schema is unchanged.

Staff search/status and lifecycle history return twenty rows per page. Organization and product scope constrain continuation. Buyer catalog access remains separate and customer-priced. Retirement refuses new quotes and acceptance of an unaccepted quote; already accepted orders retain fulfillability. The UI reviews current facts, appends history pages, preserves filters during catalog continuation and cancels abandoned review/history reads on navigation.

Native tests compare every other module table before and after retirement, verify identical schema across restart and fulfill accepted orders in CA and US. Additional tests exercise ABA/base-price drift, stale role/password/disabled authority, buyer/foreign cursor refusal, tied-time history across restart, malformed recent history, literal search, retired cursor anchors, actual session/CSRF boundaries and read-only refusals. Three production browser journeys cover phone layout, exact lost-response replay, one retained effect, reactivation, 25 history rows, stale review refusal and held-response navigation cancellation.

## Verification and retained failures

Final command outcomes are recorded in the machine receipt and handoff. The complete native suite passes 1,899 tests; focused production-browser checks pass 3/3; complete production-build Chromium passes 113/113; TypeScript and formatting exit zero. The machine receipt binds 397 final tested inputs and three delivered assets. No tested input changed after these final checks.

The final changed-file React scan exits 1 with two reported impure-state-updater errors and the existing App complexity warning. Both errors are reviewed as false positives: `src/web/main.tsx` invokes its ordinary async `run(work, refreshAfter)` helper, which awaits `work()` exactly once inside try/finally; it does not pass either callback to a React state setter. No rule is suppressed. The earlier scan also reported formatter allocation and missing explicit submit type, both corrected before final verification. Historical full-project React findings remain unresolved; this is not a clean-project claim. Production build retains its large-chunk warning.

Original nested-transaction, test typing, missing inactive-product acceptance refusal and browser selector failures are retained. Transaction helpers now separate public transaction entry from internal reads. The acceptance guard runs before billing exposure or order writes. Browser tests use the observed accessible combobox role. Original logs, contexts and traces stay under `/tmp/distributor-catalog-lifecycle-checkpoint`; no failed run is represented as a pass.

## Publication and limits

The owner authorized committing all current work and pushing this Distributor snapshot to SJS1001/Distributor. Read-only checks confirm push permission and the current branch; no Actions workflow exists. Private logs/traces, dependencies, dist and runtime data stay excluded. Added application code is original; existing license notices remain retained. No PR, merge, deployment, repository settings or live integration is changed.

These checks establish local behavior, not actual production throughput, infrastructure/vendor residency, provider/device qualification or operator acceptance. Catalog paging is live rather than an immutable snapshot; SQL scan/sort and lock costs, accumulated browser rows, older corrupt history, supplier discontinuation policy and broader UI work remain open. Full-system implementation remains incomplete.
