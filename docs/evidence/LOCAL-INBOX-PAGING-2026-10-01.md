# Local inbox API paging checkpoint

Date: 2026-10-01, America/Toronto. Scope: partial D-025/G4 implementation; all tasks/gates remain NOT VERIFIED. Reviewer: Codex automated checks with synthetic fixtures, no human/operator acceptance. Parent local commit `c1cfe2c`; [machine receipt](LOCAL-INBOX-PAGING-2026-10-01.json) identifies SHA-256 hashes of tested source/tests/dependency manifests. No remote publication or CI runner use.

Direct workstation checks on macOS arm64, Node 24.16.0/npm 11.13.0:

- `npm run typecheck`: PASS after fixing two initially inferred non-null test continuation variables. Initial TS2322 errors at test lines 917/1024 are retained here and in the machine receipt.
- `tsx --test tests/billing-delivery.test.ts`: 10 PASS, zero failures/cancellations/skips/todos, 2753.156375 ms. This run preceded the test-only nullable annotation correction; full regression below uses final source.
- `npm test`: 119 PASS, zero failures/cancellations/skips/todos, 7350.437209 ms.
- `npm run format:check`: PASS.
- `npm run build`: PASS, 87 ms.
- Planning structural check is recorded in the machine receipt after document edits.

Tests exercise 205 actual native publication/withdrawal records, 206 personal plus one colleague prepared requests, more-than-200 enumeration, tied/backdated timestamp fixture, later insertions excluded from continuation, first-page refresh, bounded previews/full counts, personal confirmation isolation, withdrawal retaining history, changed account/deactivated actor and rejected cross-actor/history-kind cursors. HTTP checks cover session-protected no-store reads and invalid/duplicate/unknown query inputs. Stock/order/shipment/money dashboards remain unchanged by delivery activity. Timestamp updates and access changes are explicit synthetic test fixtures, not production data ingestion.

This checkpoint adds APIs only. Existing UI still uses the 200-row compatibility endpoint. UI continuation/history controls and dedicated browser coverage remain pending; no new browser run is claimed. Cursors are scope-bound unsigned positions and always reapply authorization, not frozen mutable-state snapshots. Production load/indexing/retention, physical deletion/rowid reuse/VACUUM, upgrades/recovery/residency, provider integration, hardware and human/legal wording acceptance remain unqualified. No push, PR, deployment, provider request/account, purchase, live data or OPUS/UB integration occurred.
