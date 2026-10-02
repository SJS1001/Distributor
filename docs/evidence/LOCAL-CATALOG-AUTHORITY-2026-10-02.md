# Local catalog authority — 2026-10-02

Engineering evidence only. All 44 tasks and 10 product gates remain **NOT VERIFIED**; the full system is incomplete. Scope: partial D-008/D-018/D-035 and REQ-03/REQ-06/REQ-12. See [catalog access](../USER-ACCESS.md#current-catalog-authority) and the [machine receipt](LOCAL-CATALOG-AUTHORITY-2026-10-02.json).

## Tested version and environment

Local branch `codex/local-distributor-checkpoint`, parent `6622d14`. The machine receipt identifies every candidate/tested input by SHA256; the subsequent handoff records the local feature commit and committed-byte audit. Workstation macOS arm64, Node v24.16.0, npm 11.13.0; temporary synthetic SQLite stores, actual competing local processes, loopback HTTP and production-build headless Chromium. No customer/provider/device request or CI runner was used. Private logs are retained at `/tmp/distributor-catalog-authority-checkpoint`; they are local evidence, not durable production archives.

## Results

| Check | Actual result |
| --- | --- |
| Full backend regression | PASS 1,773/1,773, including seven new catalog tests |
| Focused catalog/domain/master/document import/order amendment regression | PASS 51/51 |
| Affected browser journeys | PASS 2/2: reviewed customer/catalog imports and buyer multi-line ordering/fulfillment/return |
| Type, format and production build | Exit 0 |
| Isolated production-only runtime installation | PASS; 209 copied inputs, 69 development-only packages absent, 27 child commands; CA/US startup twice and local backup/restore |
| Structure/local links and whitespace | Exit 0 in the final machine receipt; planning structure only |

The full backend command ran 09:08:51–09:10:10 UTC. The machine receipt retains exact command timestamps, exit codes and log hashes, 347 tested input hashes, historical receipts, license notice hashes and matching production assets.

## Behavior and independent evidence

Product lookup/list, administrator SKU mapping, customer price lookup, catalog import review/application and both product creation/tier-price commands derive authority from the active persisted principal. Required password changes refuse reads, import matching/creation and both cached/new command keys. Current administrator/commercial authority precedes cached returns and effects inside the existing immediate command transaction.

Tests use real persisted users, change actual IAM grants and independently compare catalog and platform facts after refusals. They exercise deactivation, unavailable/foreign principals, role changes, forged roles/accounts, required password changes, newly granted commercial authority, exact read-only replay, buyer account reassignment and independent-connection revocation followed by actual SQLite restart. Accepted order prices remain unchanged after a tier-price edit; import matching retains its original product without duplication.

The corrected seven-test suite ran against the original parent catalog and passed only 1/7: six independent authorization regressions reproduced before the fix. Original source was restored in a `finally` block. Earlier email/security fixture failures, type failures and the first 1,772/1,773 full-backend result remain retained. Older competing master/document import fixtures supplied invented users; they now provision/reuse actual administrators. One-winner, stale-refusal, identical-replay and permanent mapping/document assertions remain unchanged. Production guards were not relaxed.

## Limits

Existing organization-wide staff price visibility and buyer base-product projection remain provisional. Tier/default/currency behavior is preserved; this does not approve a complete pricing policy or qualify every module's authorization. Trusted catalog import application remains inside the caller's migration transaction; the whole migration cache boundary is outside this change.

Read collections remain unbounded. Separate identity/data/dashboard reads do not form one coherent snapshot outside commands. Production locking, contention, volume, retention, security and operating policies remain unqualified. Two affected browser journeys were rerun; other browser journeys retain their historical scope.

Actual provider protocols, hardware, tax rules, residency infrastructure, production load/recovery/upgrades and operator acceptance remain pending. No schema/dependency/workflow/UI change, push/PR, publication, deployment, cloud session or delegation occurred.
