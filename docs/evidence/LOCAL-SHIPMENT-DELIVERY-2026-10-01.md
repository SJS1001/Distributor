# Local shipment delivery observations — 2026-10-01

Status: **PASS for bounded synthetic workstation checks**. Partial D-026/D-028 engineering relevant to G5, with sold-serial account isolation relevant to D-030/G6. All 44 tasks and 10 product gates remain **NOT VERIFIED**; the full system is incomplete. Reviewer: Codex automated workstation checks and source review, without independent human acceptance.

Parent: `74f73a935c75d5441011f461969a7b2dfdfb85f2`, branch `codex/local-distributor-checkpoint`. The [machine companion](LOCAL-SHIPMENT-DELIVERY-2026-10-01.json) binds candidate source/tests/configuration, documentation, available logs and unchanged historical evidence. Its own bytes are excluded to avoid circular hashing. The subsequent actual local commit identifies the deliverable.

## Behavior and boundaries

Ordinary carrier shipments show handed_over at revision zero and accept manual in_transit, delayed, lost, returned or delivered observations. Each write requires the current revision, evidence text, a unique normalized per-shipment reference and canonical UTC time between handover/previous observation and the server clock. Equal times remain ordered by revision. Delivered and returned are terminal. Returned records a carrier observation, not a physical warehouse receipt. No observation changes original shipped state, stock/custody, order quantities, invoice, cash, exposure or sold-serial coverage. Remedies require their separate approved native workflows.

Current actual active principal, role, account/site and password restrictions precede history and cached writes. All writers require current site authority; warehouse readers are site-scoped. Other staff retain the existing organization-wide shipment-read policy, pending operating acceptance. Actual buyers see their own account's public state/time/revision/source only; private reference/evidence/actor fields are omitted even under a supplied false administrator role. Sold-unit projections now resolve the actual principal consistently across original shipments and replacements.

History is immutable and ascending in pages of 20. Strict HTTP shapes, session/origin/CSRF and durable keys apply. Exact authorized retries recover their original result after restart or a later terminal observation; changed payloads conflict. History, compatibility delivered fact, event, audit and receipt commit atomically. Browser pagination retains loaded rows after failure and mutations retain the same key after a lost response.

Existing delivered facts import once at startup, retaining original ID/reference/time/actor with source legacy; original rows and saved command results remain intact. Import creation time represents migration time, without inventing an operator event. The compatibility command retains its original payload/result and Date.parse-compatible UTC normalization, including collection receipts. It lacks an expected revision; new carrier clients use the revision-checked command. Stop old writers before upgrading. Startup scans synchronously; production upgrade/concurrent-startup/rollback behavior is not qualified.

## Actual checks

Environment: macOS arm64, Node 24.16.0, npm 11.13.0, SQLite 3.53.0, disposable synthetic databases and loopback headless Chromium. Temporary logs under `/tmp/distributor-shipment-delivery` are hashed in the companion; separate durable archiving remains necessary.

| Command | Observed final result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run format:check` | PASS |
| `npm exec -- tsx --test tests/fulfillment-delivery.test.ts tests/fulfillment.test.ts tests/warranty-replacement.test.ts` | PASS 20/20, 2488.082083 ms |
| `npm test` | PASS 358/358, 14158.104625 ms; zero failed/cancelled/skipped/todo |
| `npm run test:e2e` | PASS 29/29, reported 1.0 minute; new delivery journey 1.7 seconds; production build 284 ms |

No source/test/configuration edits follow these final passing checks. Planning/link, whitespace and content-hash verification follow receipt creation and are recorded in the companion. Earlier focused browser and full 29-journey passes preceded the final compatibility and sold-unit authorization corrections; they are not substituted for the final run.

Ten new backend scenarios cover original stock/money/entitlement conservation; terminal outcomes; strict revisions/times/references; collection/packing boundaries; 20+3 tied-time paging and buyer account isolation; real role/site/active/password restrictions before retries; original handover retries and normalized compatibility collection time; late-audit rollback; unchanged legacy receipts/repeated import; separate-process competing revisions and same-key retries; strict HTTP guards; and encrypted restore retaining original history/keys while excluding later outcomes. These are scenario groups within ten tests. CA backup metadata does not prove regional infrastructure. Injected audit faults and SQLite process contention do not qualify storage failure or process-kill recovery.

The new browser journey creates an original serialized carrier sale, retries a lost committed delay response with the same key, refuses a stale dialog after another observation, recovers failed history pagination, checks narrow-screen Escape/focus/no overflow, records terminal delivery and reconciles native stock/orders/invoices/exposure. A real buyer sees public history without staff evidence. No actual scanner, carrier booking, webhook or physical delivery acknowledgment is exercised.

## Preserved failures and review

The initial partial source edit failed type checking because deliverySummary was not yet defined. Two scripted edit attempts referenced a nonexistent saleForUnit marker; their tool outputs were observed but no raw log files are claimed. The initial focused backend run passed 11/12: its password-change fixture used an unsupported user-update field, so the required restriction was never set. Corrected the synthetic security state through the owning IAM store and retained the failed log. Later focused checks passed 12/12, then 13/13 after an additional handover/collection scenario.

The first full backend regression passed 357/358. An existing replacement resale test supplied the administrator identity with a fabricated buyer role, expecting buyer visibility. Shipment projections now use actual grants, exposing this invalid fixture. Replaced it with a real buyer and added a false-administrator-role/account assertion; sold-unit projections now resolve actual identity consistently. Source review also restored legacy timestamp normalization, with an offset-form compatibility input asserting canonical saved history. Final focused/full backend and browser runs passed. A formatting check warned about fulfillment.ts; formatting was corrected and the final check passed. All available failure logs remain alongside corrected results.

Review checked owning writes, current authority before cache, transaction rollback, native conservation, permanent reference uniqueness, legacy preservation, terminal/time/revision guards, public/private projections and paging/retry behavior. Dependencies, lockfile and license notices are unchanged; no third-party implementation was copied. The instructed predecessor HANDOVER.md is unavailable at its specified path.

## Remaining qualification

Actual carriers/booking/labels/retrieval, physical proof and return receipt, loss/return remedies and corrections, attachments, consolidated packages, approved staff/finance/coverage policies and human operator acceptance remain open. Shipment aggregates remain unpaged and query latest history per shipment. Production workload/index/clock/locking/retention/archive/upgrade/termination/recovery/security/residency and actual hardware/providers remain unqualified. No task or gate passes from this receipt.

Direct workstation checks/local commits only. No CI runner/job, workflow/registration, push/PR, actual provider account/request, live data, deployment/purchase, publication/settings change or OPUS/UB integration. Future CI remains GitHub-hosted after separate authorization/qualification; no fresh remote-access claim.
