# Local paged staff audit history — 2026-10-01

Status: **PASS for bounded synthetic workstation checks**. Partial D-008/D-036 engineering. All 44 tasks and 10 gates remain NOT VERIFIED; full system incomplete. Reviewer: Codex source review and workstation checks, without independent human acceptance.

Parent `ce21e905c67cadcaeb231cfe1a32213b5c2a1d23`, branch `codex/local-distributor-checkpoint`. The [machine companion](LOCAL-AUDIT-PAGES-2026-10-01.json) binds candidate source/tests/configuration, documents, available logs and unchanged historical evidence. It excludes its own bytes from circular hashing. The subsequent actual local commit identifies this deliverable.

## Observed behavior

The [runbook](../USER-ACCESS.md#audit-history) describes the new current administrator/support view: organization-scoped pages of 20, metadata only, loaded-row preservation after errors and cancellation on Refresh/navigation/sign-out. Browser traversal exceeds 200 unique records, checks phone width and last-page focus, support access and buyer refusal. Backend coverage seeds 241 tied/backdated records, excludes newly appended activity until Refresh and refuses foreign/nonexistent cursors, forged/stale grants, inactive identities and required password changes. The legacy raw audit/event projections retain compatibility while rechecking actual current authority.

An additive platform-owned sequence map/clock/trigger preserves original audit bytes and command receipts. Synthetic restart/backfill and actual SQLite VACUUM preserve page boundaries. Two independent OS subprocesses append 60 distinct audits. An injected sequence-write fault rolls back warehouse mutation, audit and command receipt. Reads preserve stock/orders/invoices. No dependency/lockfile/license change or third-party implementation copy.

## Verification

| Command | Observed result |
| --- | --- |
| `npm run typecheck` | Final PASS |
| `npm run format:check` | Final PASS |
| Focused Node audit tests | Corrected PASS 6/6, 1147.360375 ms |
| `npm test` | PASS 386/386, 13940.000875 ms; zero failed/cancelled/skipped/todo |
| Focused Chromium audit journey | Isolated retry PASS 1/1, 5.2 s |
| `npm run test:e2e` | PASS 32/32, 59.4 s; production build PASS, 82 ms |

No source/test/configuration edits after final passing checks. Planning links, whitespace and independent hash/historical-evidence comparison follow document creation and appear in the companion. Planning validation is structure only, not product or remote-access verification.

## Preserved intermediate failures

Initial typecheck failed because the tests used nonexistent inventory/order read methods and inferred a nonnullable cursor; corrected before final checks. Initial focused backend tests failed during AUTOINCREMENT schema creation: SQLite's internal sequence table is outside the module-owned authorizer. The final sequence uses a platform-owned clock without weakening database ownership. Both failed logs remain under `/tmp/distributor-audit-pages`.

The first focused browser invocation built successfully but ended without a test result or diagnostic. Its raw log is retained as incomplete/unexplained; no product failure cause or pass is inferred. The isolated retry and full suite independently complete successfully. Temporary workstation logs are not a durable production archive.

Self-review covers current authority, metadata projection, scoped cursor errors, durable insertion ordering, transaction rollback, legacy bytes, concurrent allocation, cancelled reads, retained retries, phone layout/focus and native-fact conservation.

## Remaining qualification

Legacy backfill uses current rowids and cannot reconstruct previously lost history. Stop old binaries and back up before upgrades; mixed-version writers are unqualified. Startup scans, production indexing/storage/load/locking/upgrades, audit deletion/retention/export/search, tamper evidence, security/residency, actual providers/devices, operating policies and independent human acceptance remain open. Staff visibility remains the provisional organization policy. No task or gate passes from this receipt.

Direct workstation checks/local commits only. No CI jobs/runners, workflows/registrations, push/PR, actual provider request/account, deployment/purchase, live data/publication/settings change or OPUS/UB integration. Future Distributor CI uses GitHub-hosted runners after separate authorization/qualification; no fresh remote-access claim.
