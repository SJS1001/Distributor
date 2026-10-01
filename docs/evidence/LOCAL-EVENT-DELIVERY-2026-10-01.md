# Local optional event delivery — 2026-10-01

Status: **PASS for bounded synthetic workstation checks**. Partial D-010/D-011/D-036 engineering for REQ-04/REQ-05 and CH-08/CH-09/CH-11. All 44 tasks and 10 gates remain NOT VERIFIED; full system incomplete. Reviewer: Codex source review and workstation checks, without independent human acceptance.

Parent `d4d9a7b0070a743168b461ba628f9a02510a8b8c`, branch `codex/local-distributor-checkpoint`. The [machine companion](LOCAL-EVENT-DELIVERY-2026-10-01.json) binds tested source/test/configuration, documents, available logs and unchanged historical evidence. Its own bytes are excluded from circular hashing. The subsequent actual local commit identifies this deliverable.

## Observed behavior and verification

The [runbook](../EVENTS.md) describes optional metadata processing, permanent consumer/event receipts, fenced token/revision/attempt/implementation-version leases, atomic synchronous effect/receipt completion, redacted failures, bounded retry cycles and reviewed quarantines. Current actual administrator/support grants protect scoped diagnostics/history; CSRF/current administrator authority protect HTTP retries before cached receipts. Removing registration preserves native operations, original events and historical receipts.

| Command | Observed result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run format:check` | PASS |
| `npm exec -- tsx --test tests/event-delivery.test.ts` | Corrected intermediate PASS 15/15, 3117.759542 ms; subsequent coverage included in final full run |
| `npm test` | Final PASS 380/380, 11773.111208 ms; zero failed/cancelled/skipped/todo |
| `npm run test:e2e` | PASS 30/30, 53.1 s; production build PASS, 285 ms |

Final backend includes all 16 new tests, implementation-version fencing, late receipt rollback and diagnostic continuation. No source/test/configuration edits follow final passing checks. No new browser interface is added; existing browser journeys check composition regressions only. Planning/link, whitespace, hashes and historical evidence comparison follow document creation and appear in the companion.

Checks cover restart/drain/deduplication; bounded delivery/diagnostic pages; native stock/order/invoice/exposure conservation; incompatible/poison events without blocking later events; compatible reviewed upgrades; failed partial effects and late receipt insertion rollback; lease expiry/replacement/exhaustion and version changes; current real grants/password rules before cached retries; optional removal; rejected async contracts; authenticated shape-strict HTTP/CSRF; encrypted restored receipts/pending events with provider hold retained; and disabled/path/region/argument CLI behavior.

Separate OS processes exercise SIGKILL after claim commit, during an uncommitted report insertion and after effect/receipt commit. Restart produces one local effect per original event. Two independent workers claim disjoint batches and commit each original report once. Tests force expiry after termination; they do not establish actual production clock/RPO/RTO acceptance.

## Preserved failures and review

Initial type checking rejected optional cursor fields as undefined SQL parameters; scoped cursor values are now explicitly converted. Initial focused tests passed 13/15: a password fixture updated a nonexistent security row, and HTTP login omitted the required origin header. The fixture inserts/upserts actual security state, and login supplies and asserts the accepted origin. Corrected focused and final full checks pass. Available logs remain under `/tmp/distributor-event-delivery`; temporary logs are not a durable production archive. Patch-context mismatches and guessed missing helper paths have no preserved raw logs and are not claimed as test evidence.

Self-review covers transaction boundaries, version/token/revision fences, permanent receipts, current authority before caching, scoped cursors, redacted errors, regional-tag guard, native independence and trusted synchronous code limitations. Dependencies, lockfile and license notices unchanged; no third-party implementation copied.

## Remaining qualification

Version 1 lacks aggregate revision/correlation; mutable projections/rebuilds need separate contracts. Synchronous checks are not a malicious/deferred-plugin sandbox. Diagnostic pages change with worker updates. Batch/page limits do not bound SQLite scans/sorts/counters/memory/large source-row retrieval/index creation. Stop old workers before implementation upgrades. Production migration/load/locking/clock/termination/scheduling/monitoring/retention/recovery/security/residency, actual providers/carriers/devices, operating policies and independent human acceptance remain open. No task or gate passes from this receipt.

Direct workstation checks/local commits only. No CI jobs/runners, workflows/registrations, push/PR, actual provider account/request, deployment/purchase, live data/publication/settings change or OPUS/UB integration. Future Distributor CI uses GitHub-hosted runners after separate authorization/qualification; no fresh remote-access claim.
