# Multi-line purchase entry — local engineering receipt

Partial local engineering, 2026-10-02, D-014. All 44 tasks and 10 gates remain NOT VERIFIED; full-system implementation is incomplete.

## Candidate and environment

Parent `444c7ed23aafe6a8787ab41c1ab70a69691e3473` on `codex/local-distributor-checkpoint`. The [machine receipt](LOCAL-PURCHASE-ENTRY-2026-10-02.json) binds 399 final source/test/configuration inputs, three production assets, command outcomes and retained private artifact hashes. Direct macOS arm64 workstation checks use Node v24.16.0, npm 11.13.0, Chromium and production React/Vite assets. The native suite uses synthetic CA/US fixtures; new purchase browser journeys use synthetic CA HTTP/SQLite on port 3142. No CI runner, delegated/cloud session, live provider or physical device is used.

## Change and verified behavior

[Purchase entry](../PURCHASE-ENTRY.md) supports native twenty-product search pages and up to 100 independently retained product lines. Staff explicitly enter quantities and unit costs, review the exact supplier/site/lines and total, edit or cancel before submission. Selling price is never substituted for cost. Existing native multi-line creation and receipt transactions are unchanged; creating an order does not receive stock.

The browser stores a submitted command key and exact reviewed payload before transport. Account/org-scoped storage survives reload and sign-out; Web Locks serialize same-browser tab submissions. Uncertain responses retain the exact attempt and freeze replacement editing. Another tab adopts the retained review before a separate retry. Damaged or unavailable evidence refuses new transport. Native 400/404 rollback refusals permit correction; authority/key/network/server uncertainty remains retained. Native persisted authority remains decisive before replay or new effects.

Five new production browser journeys verify phone layout, explicit-cost validation, edit/cancel/focus, products beyond the first page, reload and sign-out recovery after lost committed responses, cross-tab adoption, damaged storage refusal and native atomic not-found correction. The existing receipt/scanner journey exercises the new entry controls. Partial receipts at original costs produce three native stock lots `(1,501)`, `(2,501)` and `(2,700)` cents, total 2,903 cents; exact duplicate receipt succeeds without another movement and over-receipt refuses.

## Results and preserved failures

Final complete native suite: **1,899/1,899 pass**. Final complete production Chromium suite: **118/118 pass**. Focused purchase/receiving: **6/6 pass**. TypeScript, formatting and build exit zero. No tested source input changed after these checks. Final documentation structure and whitespace outcomes are recorded in the machine receipt. Production build retains the large-chunk warning.

Changed-file React diagnostics exit 1: existing App complexity, new PurchaseEntry size warning and a reviewed false-positive state-updater error at `src/web/main.tsx:1278`. Its ordinary async `run(work, refreshAfter)` helper awaits work once; it does not pass that callback to a React state setter. No suppression or clean-project claim. Broader historical React findings remain unresolved.

Original focused failures and artifacts remain under `/tmp/distributor-purchase-entry-checkpoint`: relative Playwright API requests used the default fixture instead of port 3142, shared-cookie tabs attempted login again, warehouse needed an explicit accessible label, direct receipt API requests omitted Origin, and stock assertions used `unit_cost` instead of native `cost`. Corrected checks assert actual native responses and facts. Failed/superseded runs remain separately identified; their outcomes are not represented as passes. No fresh isolated production-only runtime result is claimed.

## Publication and limits

The owner authorized publishing the current source/tests/documentation snapshot to SJS1001/Distributor on this codex branch. Read-only repository checks confirm push permission, zero Actions workflows and zero Actions runs before publication. Private logs/traces, dependencies, dist, credentials and runtime data remain excluded. No backend, schema, dependency, license notice or workflow changes. No PR, merge, deployment, settings change or live integration.

Customer catalog retirement still permits purchasing; supplier discontinuation policy remains unresolved. Browser recovery retains descriptions/costs across sign-out and requires storage/Web Locks; shared-device handling and residency need qualification. It does not coordinate different devices or permit changing an uncertain order. Catalog paging is live; supplier/site collections, traversal/locking costs, broader UI work and actual provider/device/production/residency/operator acceptance remain open.
