# Purchase order queue — local engineering receipt

Date: 2026-10-02. Parent: `e7d4015`; branch: `codex/local-distributor-checkpoint`. Exact candidate/test/runtime inputs and command/log hashes are in the [machine receipt](LOCAL-PURCHASE-QUEUE-2026-10-02.json). All 44 tasks and 10 product gates remain **NOT VERIFIED**.

## Change and evidence

Purchasing now loads twenty scoped headers, with live open/received filters, deterministic timestamp/identifier continuation and independent scoped detail. Persisted authority and line enrichment share one page/detail transaction. Saved receipt drafts can resume and confirm stock while their purchase remains off-page. Supplier replacement selection uses owning receipt product identity. This strengthens partial D-008/D-014 and REQ-03/REQ-08 engineering; it does not qualify load targets or product acceptance. See [the procedure and limits](../PURCHASE-QUEUES.md).

| Direct workstation check | Captured result |
| --- | --- |
| Six final tests with parent HTTP/procurement source and candidate supporting dependencies, private copy | Six failures; reduced module regression reproduction |
| Focused new queue and purchasing authority tests | 12/12 pass |
| Full backend | 1,847/1,847 pass; zero skipped/cancelled |
| Selected production-build Chromium journeys | 6/6 pass |
| Type check, format and production build within browser command | Exit 0 |
| Isolated production-only runtime installation | PASS; 211 inputs, 69 development-only packages absent, 27 commands; CA/US twice, local backup/restore and PDF/ZPL |
| Structure/link validation and whitespace | Final command records in machine receipt |
| React Doctor changed/full final | Exit 1; not clean; triage below |

Six new backend cases exercise twenty-header overview, receipt product identity, tied timestamps/restart/later insertion, selected-state cursors and completed anchors, page-only enrichment, persisted warehouse scope/empty grants, forged/unavailable/password principals, independent grant changes, off-page HTTP detail, strict query validation and continued-session revocation. Owning procurement/inventory/platform fact conservation assertions cover tested read/denial paths; they are not whole-system acceptance.

Three new phone-viewport Chromium journeys exercise 20/40/46 paging, failed-page exact retry, filter failures, focus, older receipt starts, abandoned/superseded responses and off-page saved draft confirmation. Three existing journeys exercise saved scans/camera fallback/receipt retry and supplier finance/handover/correction behavior. The entire browser suite was not rerun.

## Retained failures and diagnostic review

Original regressions and final parent-module reproduction remain private. Synthetic browser account typing, incorrect accessible-name/table selectors and an incorrect expected confirmed state were corrected; native receipt state is received. Final checks use the unchanged 360 captured input hashes. Historical receipts and license notices remain unchanged.

React Doctor's initial deprecated diff option scanned the full project. It found a real new render-time ref assignment, moved to a layout effect; full final diagnostics contain no new-hook findings. Changed scan retains existing App complexity and a JSX-key finding at main.tsx:2587. That span is the sole child of an already-keyed table cell (table helper lines 814–816), so the latter is reviewed as a high-confidence false positive, without suppression. Full final scan has 211 diagnostics, including 41 errors; other historical findings remain unaudited. This receipt does not claim clean static analysis.

## Remaining qualification

Header materialization is bounded; per-order lines, other purchasing collections, accumulated browser rows, SQL scan/sort, internal full-list reads and transaction duration remain unbounded/unqualified. Pages are live, not an immutable multi-page session. Immediate read transactions can contend with writers; dedicated production concurrency/load targets remain unqualified. Actual residency infrastructure, providers, devices, operators and production security/recovery remain open. No schema, dependency, license or workflow change.

Workstation checks/local commits only. No CI runners, cloud sessions, delegation, push, PR, deployment, real provider/device calls, ingestion or publication occurred. Full-system goal remains active.
