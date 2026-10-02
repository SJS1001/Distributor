# Local supplier concurrency and recovery receipt — 2026-10-02

Parent: `7f8960254770148ea31c4361d98557ee8640ddfe`. Tested source and configuration hashes are recorded in the [machine companion](LOCAL-SUPPLIER-AVAILABILITY-RECOVERY-2026-10-02.json). Environment: macOS arm64, Node 24.16.0, native SQLite, synthetic CA/CAD and US/USD fixtures. Direct workstation verification only; no CI runner, delegated/cloud session, provider request, workflow, PR, merge or deployment.

## Qualification added

Ten new checks cover partial D-014 purchasing and D-036/D-039 recovery. Independent applications initialize in separate child processes before a shared release barrier; the parent waits for replies and clean process exits with a twenty-second bound. Distinct review keys contest the same revision with different reasons: exactly one succeeds and the other refuses `REVISION`. Concurrent exact retries return the same result. Conflicting payloads with one key produce exactly one success and an `IDEMPOTENCY_CONFLICT` refusal. Each case retains only the winning reason, one change, one event, one command receipt and one audit entry. Restart and original request replay conserve the complete captured business/command evidence.

A separate two-process race creates a purchase while suspending its supplier. The legal outcomes are a committed two-unit purchase at 1,234 regional cents per unit or `SUPPLIER_INACTIVE` with no purchase. Suspension always commits once. Fresh purchases refuse afterward; committed exact replay and original-cost receiving remain available. The test accepts either serial order and does not establish that both orders occurred in each invocation.

Each encrypted recovery test creates a two-unit purchase at 4,321 regional cents and 43 alternating supplier changes. A live backup uses a generated local key and a private-mode archive; the archive omits the plaintext synthetic reason. The original store subsequently resumes the supplier and creates another purchase. A fresh-file restore retains the exact cutoff business tables, commands, events and audits, checked through an independent read-only SQLite connection before opening the application. Later writes are absent. CA retains its enabled optional event-report profile; US retains its disabled profile. One copied session is invalidated and the durable provider hold remains present across restart.

History reads recover all 43 changes in bounded pages. Replaying all original change keys and the original purchase returns their original results without further business or receipt writes; a fresh purchase refuses. Receiving one original unit after another restart yields four stock units totaling 22,321 regional cents, with one unit received on the original purchase. Source and restored stores remain isolated. This is native recovery evidence; it does not activate real providers or establish physical Canadian/US hosting.

## Actual commands and outcomes

| Command | Actual outcome |
| --- | --- |
| `npm test` | Exit 0; 1,976 passed, zero failed/cancelled/skipped; 80,762.592625 ms. |
| `npm exec -- tsx --test tests/supplier-availability-recovery.test.ts` | Exit 0; ten passed, zero failed/cancelled/skipped; 3,388.387791 ms. |
| `npm run typecheck` | Exit 0 on final test source. |
| `npm run format:check` | Exit 0 on final test source. |

The machine companion records final command outcomes, tested input hashes and private log hashes. Initial focused verification passed eight checks before the additional same-key/different-payload cases; final focused verification passed ten. Native and type checking invocations passed. The generated companion initially failed JSON formatting; Prettier corrected it and the final check passes. That diagnostic remains in the private log directory. Earlier checkpoint failures and receipts remain preserved separately.

## Review and limits

Self-review checks independent process initialization and bounded cleanup, winning payload retention, exact replay versus conflicting requests, atomic event/command/audit facts, no stock effect from purchase creation, original commitment costs, cutoff equality before constructors, retained history paging, session invalidation, provider hold and source isolation. Runtime source, schema, dependencies, lockfile, licenses and workflows are unchanged. Browser, build and React scans were not rerun for this test-only change; prior browser evidence remains historical.

Production contention, crash schedules, approved RPO/RTO/load targets, physical residency, provider/device qualification, browser storage policy and human acceptance remain open. All 44 tasks and 10 product gates remain NOT VERIFIED; the full system is incomplete. Publication contains original tests and documentation only; synthetic runtime stores, encryption keys and private logs remain local. The owner authorized the current Distributor repository snapshot's normal branch push; no PR, merge or CI execution is included.
