# Local event diagnostics interface — 2026-10-01

Status: **PASS for bounded synthetic workstation checks**. Partial D-010/D-011/D-036 engineering for REQ-04/REQ-05 and CH-08/CH-09/CH-11. All 44 tasks and 10 gates remain NOT VERIFIED; full system incomplete. Reviewer: Codex source review and workstation checks, without independent human acceptance.

Parent `24c2474824ecfa0925422514d988431d29c0811d`, branch `codex/local-distributor-checkpoint`. The [machine companion](LOCAL-EVENT-UI-2026-10-01.json) binds the tested source/test/configuration, documents, available logs and unchanged historical evidence. Its own bytes are excluded from circular hashing. The subsequent actual local commit identifies this deliverable.

## Observed behavior

The [runbook](../EVENTS.md#staff-interface) describes the compiled metadata report's administrator/support interface. It shows registered status, unclaimed backlog, state totals, delivery states and lifetime/cycle attempts, with retained attempt history. Delivery and attempt reads use existing scoped pages of 20; continuations retain loaded rows after failure. Delivery rows deduplicate event IDs because the underlying view is live. Refresh remounts the view, and unmount cancels pending reads. No event payload, lease token or arbitrary worker processing control is exposed.

Administrators review a displayed failure/revision and required evidence before queuing a retry. A lost response retains the dialog and exact command key/payload. Current server authority still precedes receipt recovery. A concurrent revision change rejects the stale review, which can be closed with Escape and refreshed. Support has readable diagnostics without retry controls; actual support POST and buyer GET requests are refused. Native stock, orders and invoices remain unchanged by the browser journey.

Rejected commands restore focus inside their dialog when disabling the submit control has moved it outside. The sidebar now scrolls vertically, allowing navigation and Sign out to remain reachable when the expanded menu exceeds a short desktop viewport. Phone-width review dialogs and sign-out remain exercised.

## Verification

| Command | Observed result |
| --- | --- |
| `npm run typecheck` | Final PASS |
| `npm run format:check` | Final PASS |
| `npm test` | PASS 380/380, 12444.191917 ms; zero failed/cancelled/skipped/todo |
| `npm run test:e2e -- --grep 'reviewed customer/catalog imports\|opening dry runs\|event diagnostics'` | Corrected focused PASS 3/3, 7.9 s; new journey 2.2 s |
| `npm run test:e2e` | Final PASS 31/31, 57.8 s; new journey 1.9 s; production build PASS, 172 ms |

Existing backend behavior is exercised by the full 380-test workstation run; this change adds one browser journey. Backend checks preceded the later sidebar CSS correction, with no backend changes afterward. Final type/format and browser checks cover the final source/test/configuration; no subsequent source/test/configuration edits. Planning links, whitespace, candidate hashes and historical-evidence comparison follow document creation and appear in the companion.

## Preserved failures and review

The initial focused diagnostics run failed because a rejected command left focus outside its dialog, so Escape did not close it and the next Refresh click was blocked. A temporary test focus workaround passed an intermediate focused run; the final candidate instead fixes focus restoration in the shared dialog and asserts automatic focus recovery. Do not treat the workaround run as final candidate verification.

The first full browser run passed initial flows but failed customer/catalog imports, opening-stock imports and supplier handover at Sign out: the new navigation item placed the control outside the fixed desktop sidebar's viewport. The run was interrupted after these repeated failures; it is not a completed suite result. Its log and copied failed traces are retained under `/tmp/distributor-event-ui/failed-full-browser-artifacts`. The sidebar correction is covered by reachable Sign out at 1280 × 600 and the corrected focused import journeys. Earlier initial diagnostics trace is copied under `/tmp/distributor-event-ui/failed-browser-artifacts`. Temporary logs/traces are not a durable production archive.

An earlier formatting warning was corrected before final checks; that overwritten raw warning is not claimed as preserved. Guessed stylesheet filename and already-applied patch context errors were harmless command failures without separately preserved raw logs. Self-review checks current role boundaries, fixed consumer path, revision capture, exact lost-response recovery, scoped cursor direction, cancellation, page retention, live-row deduplication, focus recovery and native-fact conservation. Dependencies, lockfile and license notices unchanged; no third-party implementation copied.

## Remaining qualification

This view covers the compiled local metadata consumer, not a dynamic consumer catalog or a production scheduler. Live delivery pages can move while a worker changes rows; refresh for current state. Bounded returned rows do not qualify SQLite scan/sort/counter working memory or production workload. Actual production upgrades, clock/locking/termination/scheduling/monitoring/retention/recovery/security/residency, actual providers/carriers/devices, operating policies and independent human acceptance remain open. No task or gate passes from this receipt.

Direct workstation checks/local commits only. No CI jobs/runners, workflows/registrations, push/PR, actual provider account/request, deployment/purchase, live data/publication/settings change or OPUS/UB integration. Future Distributor CI uses GitHub-hosted runners after separate authorization/qualification; no fresh remote-access claim.
