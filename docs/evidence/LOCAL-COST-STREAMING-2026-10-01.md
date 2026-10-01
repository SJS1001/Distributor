# Local incremental cost reconciliation — 2026-10-01

Partial D-013/D-034/D-036/D-037 engineering affecting G2/G4/G7/G8. All 44 tasks and ten gates remain **NOT VERIFIED**; full-system work remains incomplete. Reviewer: Codex automated synthetic checks, without human finance/operator acceptance. Parent local commit `eca0152791d5f4e1a19d4abd0c05af722c20bebb`, branch `codex/local-distributor-checkpoint`. The [machine receipt](LOCAL-COST-STREAMING-2026-10-01.json) binds tested source/test/configuration, documentation, direct workstation logs and unchanged historical evidence. See the [cost handoff runbook](../ACCOUNTING-COSTS.md).

The original cost handoff loaded every organization movement and physical unit into arrays. Inventory now selects at most 501 cutoff identities and visits all movements and physical units incrementally through synchronous owning database callbacks. It retains only the selected maximum 500 movement records and type totals. Every movement, including those outside the selected cutoff, still receives direction, original-cost, identity and timestamp checks; BigInt accumulation still reconciles full history with held/transit physical value. Explicit cutoffs must belong to the organization and contain at most 500 movements. Existing review hashes, claims, approvals, regional files, receivers, current authority and restore behavior remain covered by regression.

Database row visitors prepare and consume statements under the owning module, keep the iterator inside that scope, refuse asynchronous return values and finalize statements on callback failure. Nested owning reads restore authorization. An exception in a visitor still rolls back the enclosing business transaction.

The new synthetic stock scenario receives 2,000 serialized units at seven cents through four native purchase receipts, alongside the initial three units at 6,000 cents. It reconciles 2,003 movements/units to 32,000 cents across windows of 500/500/500/500/3, verifies opening/closing continuity and the exhausted cursor, and guards against complete result-array materialization. Explicit rolled-back faults in the last movement's type/timestamp or last physical unit's cost block even the first frozen window. Oversized and missing cutoffs remain refused. Two database tests exercise parameter binding, foreign-table denial, nested owning reads, visitor failure/rollback, statement finalization and asynchronous callback refusal.

Verification used macOS arm64, Node 24.16.0, SQLite 3.53.0, npm 11.13.0, isolated temporary synthetic databases and loopback Chromium. Commands/logs appear in the machine receipt.

- Final type and formatting: PASS.
- Expanded focused checks: 18/18 PASS, zero failures/cancellations/skips/todos. Exact durations appear in the machine receipt.
- Final full Node regression: 277/277 PASS, zero failures/cancellations/skips/todos, 9751.235625 ms.
- Production build: PASS; all 23 existing Chromium journeys PASS (47.8 seconds). No new browser journey is claimed. Subsequent test edits simplified a TypeScript parameter annotation and strengthened the database ownership assertion only; the final backend/typing/format checks include them, while production/browser source is unchanged.
- Planning/link/whitespace checks verify documentation consistency only. All previous evidence receipts remain byte-identical to the parent commit.

There were no failed implementation/type/test/build/browser checks for this increment. Earlier passing focused/regression/format logs remain preserved. A status read looked for the final formatting log before its sequential process had created it; the process subsequently completed and the final check passes. Historical failures from the original handoff stay in its separate unchanged receipt.

Self-review checked bounded application row retention, unchanged full-history validation, safe BigInt accumulation, organization cutoffs, stable packet content, module ownership during statement preparation/iteration/nested reads, iterator finalization and transaction rollback. Dependencies/lockfile/license notices are unchanged; no third-party implementation code was copied.

## Limits and continuation

This does not bound full-history scan time, SQLite working memory or database size. Source and review operations still hold the existing synchronous business transaction while validating all history. Very large histories may block the server event loop and other writers. Actual query plans/indexes, workload/lock/memory measurements, incremental checkpoints/archive retention, migrations, clocks, real termination/recovery, regional hosting and security remain unqualified. The 2,003-record scenario is a functional synthetic check, not a production capacity or latency acceptance.

The exported file and receiver attestation still do not qualify an actual ledger posting, QuickBooks import identity, automatic COGS duplicate-posting policy, chart/period/valuation rules, corrected/reversed journals, original source completeness or independent human controls. No new schema, financial rule, provider request, physical hardware support or gate approval is introduced.

Direct workstation checks and local commits only: no local/self-hosted/cloud CI jobs, workflows/registrations, push/PR, deployment/purchase, actual provider accounts/requests, live data, publication/settings changes or OPUS/UB integration. Future Distributor CI remains GitHub-hosted after separate authorization/qualification. No fresh remote-access claim. Continue accounting refund/import identities, provider authorization/revocation/rotation, individual carriers/devices and human business/source/vendor/security acceptance.
