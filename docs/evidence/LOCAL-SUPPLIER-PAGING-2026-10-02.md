# Supplier search — local engineering receipt

Partial D-014 engineering, 2026-10-02. All 44 tasks and 10 product gates remain NOT VERIFIED; the full system remains incomplete.

## Candidate and environment

Parent `3533eb9427dfdef02eb5a05aca85e59b4703519e` on `codex/local-distributor-checkpoint`. The [machine receipt](LOCAL-SUPPLIER-PAGING-2026-10-02.json) binds 416 final source/test/configuration inputs, three production assets and retained private command artifacts. Checks run directly on a macOS arm64 workstation with Node v24.16.0, npm 11.13.0, synthetic CA/US native SQLite stores and the CA purchase-entry browser fixture on port 3142. Chromium uses the actual production React/Vite build. No CI runner, cloud session, real provider or physical device is used.

## Verified behavior

The [supplier procedure](../PURCHASE-ENTRY.md#find-a-supplier) describes twenty-descriptor pages and independent off-page selection. Native tests traverse 45 local suppliers without duplicates or foreign organization exposure, verify literal `%_`, trimmed ASCII case matching, canonical organization/query-bound cursors, current scoped detail lookup and restart consistency. Malformed, mismatched, foreign and removed anchors are refused. Whole persisted-table dumps remain equal across reads and restart. Existing authority tests exercise forged, removed, deactivated and password-restricted actors against both new operations. HTTP tests check unauthenticated refusal, no-store responses, strict query validation and the twenty-descriptor dashboard plus next cursor.

The extended multi-line browser journey selects a supplier beyond the first twenty, changes supplier and product searches, reviews and edits while retaining the choice, then loses a committed response and reloads before retrying the exact original request. One native purchase retains that selected supplier and explicit costs; separate partial, duplicate and excessive receipts retain their original stock/cost checks. A new phone journey checks identical failed-page retry, unavailable-option clearing with selected-choice retention, literal search, held responses released after a newer search or editor close, bounded choices, phone-width fit and absence of browser errors.

## Verification

Complete native suite: **1,915/1,915 pass**. Complete production Chromium: **123/123 pass**. Focused supplier/authority native checks: **10/10 pass**; focused browser checks: **2/2 pass**. The focused runs precede the final singular-result text and review/edit assertion; the full suites exercise the final hashed source/test bytes. Final TypeScript and formatting exit zero. Production build exits zero inside the complete browser command and retains its existing large-chunk warning. Changed-file React scans nine files, exits zero and reports no issues. No fresh isolated production-only runtime installation or clean full-project React qualification is claimed.

No native/browser test failure occurred in this checkpoint. The first documentation check misread the original receipt filename as an unknown checkpoint ID; renaming the receipt to PAGING corrects that ambiguity without changing tested inputs. The original failed check remains private. Earlier checkpoint failures remain in their historical receipts. Private logs and diagnostics stay under `/tmp/distributor-supplier-search-checkpoint`; only metadata and hashes are published.

## Review and limits

Self-review checks fresh persisted authority before empty results/anchors, module ownership, strict cursor/query validation, returned-page bounds, native row conservation, review/edit and exact-attempt recovery, cancellation and phone controls. No schema, dependency or workflow change; no third-party or private code copied. Existing notices remain. Selected high-confidence credential-pattern review and staged-input hash checks precede publication; private runtime data, dependencies, dist, credentials and raw verification artifacts remain excluded.

The owner authorized the current original Distributor source/tests/docs snapshot for SJS1001/Distributor. Fresh read-only access checks confirm push permission, zero workflows and zero Actions runs. No PR, merge, deployment, repository setting, provider activation or runner job is started. A published engineering snapshot does not verify business acceptance.

Supplier paging bounds returned descriptors, not SQL scan/sort/locking costs. Cursors are not snapshots or authorization; live directory changes can require restarting a search. Warehouse choices, receipts and other legacy dashboard reads remain unbounded. Browser recovery does not coordinate different browsers/devices or cleared/copied storage. Shared-device policies, broader UI findings, actual infrastructure residency, providers, devices, production load/operations and human acceptance remain outstanding.
