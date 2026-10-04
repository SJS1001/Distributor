# Native original journal copied-lease retirement

Excluded baseline: `43e6d82fbe98425b4e47a9ab7a76aaa73db63717`, public `SJS1001/Distributor`, branch `codex/local-distributor-checkpoint`; tree `6fabdc80810cb6d2e4fb294fe41216c512fe941b`. Public connector Git objects were reconstructed and independently matched to their exact blob, tree and commit SHA-1 identities before checkout. Prior lane commits were preserved. The closing commit and exact tested file SHA-256 identities accompany the transfer manifest; the documentation does not claim a self-referential commit hash.

This closes one narrow part of [T4](RESTORE-OWNING-MODULE-PLAN-2026-10-03.md#t4-copied-journal-lease-retirement-and-separately-reviewed-offline-ledger-truth): copied **original** running leases can be retired to **unknown** inside the actual enclosing writer. It adds no external posting truth, cancellation, retry, source settlement, import coordinator, transport permission, release or product qualification. The requested model was `gpt-6-astra/high`; effective runtime model/effort controls were unavailable and are unverified. No additional agent/session was launched.

## Exact owning API

[StockJournalDelivery](../src/server/stock-journal-delivery.ts) adds:

- `readOfflineLeaseRetirementInTransaction(actor, journalId): OfflineOriginalLeaseReview`. This fixed original-only running projection requires a native writer, freshly resolved finance/admin staff without account scope or forced password change, and the actual retained raw recovery hold. Its distinct purpose is `distributor-stock-journal-offline-lease-review-v1`; it is detached, deeply frozen, canonically hashed native consistency, not an authority grant.
- `retireOfflineOriginalLeaseInTransaction(actor, input): OfflineOriginalLeaseRetirementReceipt`. `OfflineOriginalLeaseRetirementInput` has exactly thirteen primitive fields: `journalId`, `orgId`, `leaseId`, `leaseActor`, `leaseStarted`, `leaseMode`, `dispatched`, `requestRef`, `sourceId`, `sourceHash`, `attemptId`, `reviewHash`, `expectedFactsHash`. The empty attempt ID denotes the first native original; other IDs use the existing bounded native grammar. Request reference is exactly native `DJ-` plus eighteen lowercase hex characters. Hashes are exactly lowercase SHA-256. Lease start is a safe nonnegative integer bounded below the native expiry arithmetic overflow; mode is write/lookup and dispatched is 0/1. No caller row, Actor grant, JSON payload, callback, source port or SQL is accepted.

The method captures data descriptors before native hooks. Normal/revoked proxies, accessors, hidden/symbol/extra fields, custom input prototypes, nested proxy Actor grants, malformed and oversized primitives refuse without executing traps. Fresh Identity resolution discards supplied grants. It runs the complete current owner review, compares all thirteen fields exactly, then performs a state/lease-token/actor/start/mode/dispatch/review CAS. An unrelated current finance principal may retire a stopped original worker's lease; retirement does not require the historical worker to retain current transport authority. It neither substitutes caller Actor assertions for native IAM nor creates an external provider grant.

Only state `running -> unknown` and the four lease bookkeeping fields change. The existing owning observation/audit path appends exactly:

```json
{
  "outcome": "unknown",
  "cause": "restore-interrupted",
  "leaseId": "<exact retained lease>",
  "requestRef": "<permanent native reference>"
}
```

The ordinary observation hash includes exact journal/org/revision/body/author/time. Platform receives only the existing `accounting.journal.observed` audit through `Platform.audit`. There is no `Platform.command`, task receipt, new schema, provider call or direct foreign-table access. Dispatch marker, external-null identity, permanent request reference, source reservation, plan, policy, permissions, independent preparation decision, predecessors and all existing observations remain unchanged. The implementation refreshes authority and raw hold after the audit and compares complete before/after native projections, permitting only the exact state/lease changes and single new observation. Every exception must escape the caller's outer writer; catching an error and committing partial owner writes is forbidden composition.

The frozen receipt has version 1, purpose `distributor-stock-journal-offline-lease-retirement-v1`, `beforeHash`, exact native `observation`, complete unknown `after` projection and a canonical hash of those fields. Repeated application refuses because the journal is no longer running. The old unknown reader keeps its purpose and existing fact/hash layout; its observation grammar additionally recognizes the exact new native interruption cause. Ordinary `claim`, `beforeWrite`, `posted` and `unresolved` implementations are unchanged. A reconstructed lease still fails the ordinary process-issued WeakSet check.

## Complete bounded profile and conservative refusals

The shared original reader preflights eight fixed Integration-owned table sets globally, before selecting target text or calling the actual IntegrationCosts source API. Counts are complete below the cap and refuse overflow, never truncated history. Fixed-column storage types, NUL, per-field/per-row and aggregate UTF-8 byte checks precede materialization. SQL scalar JSON punctuation/container budgets precede JSON validity and JavaScript parsing; nested source bytes receive a separate SQL preflight. No foreign source table is queried.

| Bound                                     |     Value |
| ----------------------------------------- | --------: |
| Rows per fixed table                      |       128 |
| Aggregate rows                            |       512 |
| Field bytes                               | 2,000,000 |
| Row bytes                                 | 4,000,000 |
| Aggregate native/output bytes             | 8,000,000 |
| Conservative JSON nodes per document      |     8,192 |
| Conservative JSON containers per document |       512 |

The mutation reserves one observation slot before writes and reruns full preflight on retained output. Output expansion over budget raises an error for outer rollback. Complete source/date balances, exact source file and immutable plans, current policy/closed-period rules, permanent references, sequential hashed observations, predecessor cancellation proofs and permission chains use existing owning validators. Global existence checks refuse orphan/cross-org history without returning foreign rows. Another running or posted original sharing the source remains unsupported. The selected lease token must be unique across retained journals and cannot already occur as a completed unknown observation. The selected original must be the single current leaf, with no descendants even in another scope.

This first subtype supports write leases with no observation history and lookup leases with the existing complete native unknown-outcome proof. It deliberately refuses write leases with permission replacement history rather than broadening the original bounded profile. It also retains existing refusal of expiry-only histories lacking the ordinary exact-request outcome required by `originalCancellationFacts`. No timestamps or request references are invented to repair those histories.

**Remaining owning contract gap:** the bounded source/attempt projection is original-only. Correction reversal/replacement retirement requires a separate complete bounded correction source/receipt/reversal-before-replacement proof; this assignment does not pretend the original reader establishes it. The new reader explicitly rejects correction leases. CA/USD originals retain the native QuickBooks profile refusal; CA/CAD and US/USD are supported synthetic profiles. Accepted/superseded sources, stale policies, closed periods, contradictory histories and resource excess remain refused. These restrictions are not evidence that unsupported records are safe to resend.

## Root composition still required

An expected native hash identifies reviewed local state; it does not prove a source has stopped. Root must separately qualify source/candidate interval and generation, source completeness, isolation, all current external/native authority and approvals, and fencing through actual COMMIT before composing this internal primitive. Raw hold identity and historical finance permission are not that proof. This task adds no Application route/HTTP/CLI wiring or qualified coordinator, and ordinary recovery/provider gates remain closed.

The retained observation/audit proves a local native interruption. It does not preserve the entire pre-retirement projection as a durable signed provenance record, independently validate historical Platform claim/dispatch audits, establish physical/infrastructure fencing, or prove provider posting/nonposting. Root must retain/bind its reviewed preimage and qualify cross-owner audit/source evidence. A lost response is not permission to execute again; after reopen the ordinary unknown reader exposes the retained interruption, and the running-only mutation refuses replay. This is no durable replay authorization service.

## Foreground verification and preserved failures

Synthetic file-backed Application SQLite only; Linux x64, Node `v24.19.0`, SQLite `3.53.3`, TypeScript `7.0.2`, Prettier `3.9.9`. No real provider, customer data, account, secret, CI runner, push, PR, merge or deployment was used. Existing tests and shared files were not edited.

Initial receipts retained outside the patch:

1. Baseline-first new test run: 9 tests, 1 pass, 8 failures, exit 1. Ordinary copied-lease refusal passed; all eight new API cases failed because the review method did not exist.
2. First implementation: 9 tests, 1 pass, 8 failures, exit 1. Input parser used an incorrect proposed request-reference spelling. It was corrected to the actual native `DJ-<18 hex>` contract, without changing retained references or weakening comparisons. Corrected basic run: 9/9 pass.
3. Expanded adversarial run: 55 tests, 54 pass, 1 failure, exit 1. The test expected `TRANSACTION_REQUIRED`; the actual Database contract is `TRANSACTION`. The assertion now requires that exact existing error.
4. Initial full TypeScript: exit 1 because ordinary `observe` exposes an unknown body type. The new receipt now exports the exact typed interruption body used by the write, with no parser or runtime relaxation. Subsequent full TypeScript exit 0.

The new native test file covers dispatched/undispatched write and lookup leases, both supported regions, exact identities, old process-issued refusal, raw hold/writer/current IAM boundaries, hostile captures with zero traps, stale/replaced leases, complete malformed histories, UTF-8/NUL/JSON/count/aggregate preflights with zero owning text returned, immutable cancelled ancestors, competing retained owner refusal, copied database reopen, independent SQLite writer exclusion, real late SQLite audit failure after state/observation writes, post-audit authority/hold/native corruption, outer abort, exact unknown readback, replay refusal, detached frozen receipts and stock/Billing/IAM conservation. Historical original cancellation/retry/reconciliation assertions remain unchanged.

Final exact command outcomes are recorded below and in the transfer manifest. No product gate, provider authenticity, stopped-source qualification or accepted operational readiness is inferred.

```sh
node --import tsx --test --test-concurrency=1 \
  tests/stock-journal-offline-lease-retirement.test.ts \
  tests/stock-journal-offline-original-review.test.ts \
  tests/stock-journal-offline-original-evidence.test.ts \
  tests/stock-journal-offline-original-application.test.ts \
  tests/stock-journal-delivery.test.ts \
  tests/stock-journal-original-retry.test.ts \
  tests/stock-journal-reconciliation.test.ts \
  tests/stock-journal-permissions.test.ts \
  tests/stock-journal-transport.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/prettier --check src/server/stock-journal-delivery.ts \
  tests/stock-journal-offline-lease-retirement.test.ts \
  docs/STOCK-JOURNAL-OFFLINE-LEASE-RETIREMENT-2026-10-04.md
git diff --check
```

Final affected run: **349/349 pass**, zero failures/cancellations/skips/todos, exit 0, 73,117.732065 ms. This includes **58 new tests**. Complete TypeScript, owned formatting and whitespace checks pass. The old ordinary lease/transport methods are byte-identical to the excluded baseline; no existing test changed. No full product suite or operational qualification is claimed. The separately numbered transfer manifest binds final file bytes and exact base/closing commit; root independently applies and replays it.
