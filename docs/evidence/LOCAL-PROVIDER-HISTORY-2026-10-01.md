# Local provider acceptance history — 2026-10-01

Status: **PASS for bounded synthetic workstation checks**. Partial D-008/D-027/D-034 engineering relevant to CH-07. All 44 tasks and 10 product gates remain NOT VERIFIED; the full system is incomplete. Reviewer: Codex source review and workstation checks, without independent customer/operator/vendor acceptance.

Parent local commit `62f94e9a903342e5c2c94671f23e1eaa0e477a95`; branch `codex/local-distributor-checkpoint`. The [machine companion](LOCAL-PROVIDER-HISTORY-2026-10-01.json) binds the candidate, documents, available workstation logs and unchanged historical evidence. It excludes its own bytes from circular hashing; the subsequent actual local commit identifies the deliverable.

## Observed behavior

Customers offers scoped acceptance history to currently authorized staff and buyers. IAM returns at most 20 descending accepted choice versions with timestamp/provider-count metadata and a string continuation cursor. Current active organization, role, account and password grants precede cursor lookup. Exact HTTP query validation rejects duplicate, unknown, malformed and unsafe cursor values. Later choices do not enter an older continuation; strict, initial and legacy unreviewed choices are explicitly explained as possible gaps. Browsing records no new choice or acceptance.

The viewer distinguishes the current customer choice from historical acceptance. Selecting a version reads its retained acceptance records and exact immutable public terms. It compares provider and disclosure hash with acceptance; the server validates canonical disclosure hashes. Private vendor review evidence remains absent. Failed pages retain rows/cursor; failed or mismatched terms display no partial records and allow retry. Changed versions/accounts, navigation, refresh and sign-out abort stale reads. Focus returns to the opener; heading focus and phone-width wrapping are checked. Native stock, order, invoice and provider-operation facts and the current residency choice remain unchanged.

## Verification and preserved failures

All final source/test/configuration edits preceded the final full checks. Document creation followed them.

| Workstation check | Actual result |
| --- | --- |
| Focused backend acceptance/disclosure tests | PASS 13/13, 1525.212 ms, exit 0 |
| `npm test` | PASS 407/407, zero failed/cancelled/skipped/todo; 14463.076041 ms, exit 0 |
| Focused new Chromium journey | PASS 1/1, 5.5 s total, exit 0 |
| `npm run test:e2e` | PASS 35/35, reported 1.1 minutes, exit 0; production build PASS 96 ms |
| `npm run typecheck` | Corrected final PASS, exit 0 |
| `npm run format:check` | Final PASS after the cancellation-test correction, exit 0 |

Planning/link validation, whitespace and independent hash comparisons are recorded in the companion after document creation. Planning validation proves structure only, not product gates or remote access. Temporary workstation logs and copied traces are not a durable production archive.

Preserved intermediate failures include formatting, string/numeric cursor test assumptions and SQLite null-prototype projections. The final API normalizes metadata into plain objects with a string cursor. The first browser journey used an incorrect exact heading. A later failure came from attempting to fulfill an already aborted route; the correction asserts the real browser abort and finishes the held response handler before continuing. An overly broad edit initially put completion variables in another test, producing TypeScript/ReferenceError failures; it was removed from that test and scoped to the new journey before final passing checks. Failed logs and copied traces remain hashed alongside passes; none of these failures is counted as a pass.

Self-review covers fresh authority before reads, owning-module SQL, bounded public projections, exact query shapes, stable descending continuation, retained hash-bound terms, cross-account denial, immutable history, retry/cancellation/focus behavior and native-fact conservation. Dependencies, lockfile and license notices are unchanged; no third-party implementation was copied.

## Remaining qualification

Accepted choice metadata is bounded, but this does not qualify grouping/sorting/indexes/SQLite memory or production load. No actual provider, customer authority, legal consent, vendor terms, country/subprocessor/retention completeness, device, carrier or physical residency is qualified. History does not recover missing legacy acceptance, enable an adapter, recall transmitted data or revoke upstream credentials. Actual hosting, mixed-version upgrade, migration, retention/deletion, tamper resistance, security, backup/recovery, operating policy and independent human acceptance remain open.

Work remains direct workstation checks/local commits only: no CI jobs/runners, workflows/registrations, push/PR, actual provider account/request, live data, deployment/purchase, publication/settings changes or OPUS/UB integration. Future Distributor CI remains GitHub-hosted after separate authorization and qualification. No fresh remote-access claim is made.
