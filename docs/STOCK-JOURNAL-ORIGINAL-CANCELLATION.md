# Original stock-journal final cancellation

D-034/D-036/D-039 engineering continuation. The integration-owned native queue now records final non-posting evidence for an uncertain original and accepts a separate finance cancellation decision. Authenticated API and Billing controls expose these local operations. Separately approved fresh original attempts remain dependent work. All tasks and product gates remain NOT VERIFIED.

Only an approved original with native `unknown` state, no posted receiver identity and no active lease is eligible. Review binds the immutable approved source bytes/hash, posting date, company/credential binding, regional currency, positive balanced cent totals, independent original approval and permanent actual `DJ-` reference. It verifies every retained observation and permission-chain revision, including history beyond the newest-one-hundred detail limit. A lookup miss supplies no cancellation authority.

## Record final evidence

`GET /api/accounting/journals/:journalId/original-cancellation-evidence-review` returns the current journal, complete-history snapshot and its SHA-256 review hash. The read requires current persisted internal finance/admin authority and accepts no query fields. It conserves native facts and returns `Cache-Control: no-store`.

Submit `accounting.journal.original-cancellation.evidence` through the authenticated command endpoint with the original idempotency key and exactly `journalId`, `reviewHash`, `requestRef`, `externalRef`, `evidence`, `cancellationFinal`, `nonPostingVerified` and `noLaterPosting`. All three attestations must be literal `true`. The operator must establish final cancellation of this exact receiver request, verified non-posting and prevention of later posting. The external case reference and explanation are retained as manual evidence; the software cannot establish their truth or cancel a provider request.

The operation appends one hash-checked immutable evidence observation and command receipt atomically. It leaves the journal uncertain. Any later lookup/observation or replacement evidence invalidates the previous current review; obtain another fixed review before a new decision. Current facts and the full history are rechecked in the same transaction.

## Independent cancellation

`GET /api/accounting/journals/:journalId/original-cancellation-review` returns the eligible unknown journal, latest final evidence and whether the current principal differs from its recorder. The same read authorization, exact query and no-store requirements apply.

Submit `accounting.journal.cancel-original` with exactly `journalId`, `requestRef`, `evidenceHash` and `reason`. A different current finance/admin principal must confirm the latest evidence hash and permanent native reference. Confirmation appends `cancelled-unposted`, sets the native state to `cancelled` and retains the approved plan, dispatch history, source/date reservation and permanent reference. Posted outcomes, active lookups, stale/substituted evidence, wrong legs/references, missing history and damaged retained receipts refuse. Terminal originals cannot acquire another write/lookup lease.

Both evidence and cancellation remain local operations during a provider/recovery hold. They preserve the hold and grant no provider execution or restored-store activation authority. Existing origin, session CSRF and idempotency controls apply. Extra fields and coerced attestations refuse.

## Billing review and browser recovery

In Billing, load an uncertain original from the journal queue and choose **Load original cancellation evidence review**. The fixed source/date/company/reference, region/currency, balanced cent totals and complete-history hash must validate before evidence entry appears. Enter the exact receiver case reference and explanation and explicitly check all three attestations. **Review original cancellation evidence** opens a read-only confirmation; recording evidence leaves the journal uncertain.

A separate current finance principal chooses **Load final original cancellation evidence**, reads the immutable evidence hash, revision, recorder, timestamp and attestations, then supplies an independent reason. A second read-only review precedes cancellation. The evidence recorder can read the final evidence but cannot use this confirmation form. Native authority, complete current history and latest evidence remain authoritative; a superseded review refuses and requires a fresh review.

The browser retains the exact command key/body and fixed snapshot in an organization/principal-scoped storage record before sending. Same-profile Web Locks, storage read-back and rechecks across asynchronous validation protect competing attempts. On a lost or unverifiable reply, **Review retained original cancellation attempt** and **Recover exact original cancellation attempt** resubmit only the retained original key/body. This can return a historical receipt; it does not undo a later native state. A refused recovery retains the exact attempt for reconciliation, since refusal does not establish that the earlier submission had no effect. A fresh definitive stale-review refusal releases only that newly refused attempt. Closing a review changes no business fact and restores focus. Late responses after leaving Billing cannot clear retained uncertainty. Failed storage or missing Web Locks prevents sending; damaged evidence blocks new submission. There is no discard/reset control.

Browser storage contains unencrypted operator evidence and remains local to that browser profile. Web Locks do not coordinate different devices or profiles. The server enforces fresh authority and atomic effects independently.

## Recovery and remaining work

An exact body/key retry checks fresh persisted authority before returning its retained receipt. Historical evidence recovery reconstructs its original unknown review from retained evidence even after a later lookup or cancellation; it does not restore unknown state or grant another effect. Cancellation recovery verifies its retained final decision. Foreign scope, withdrawn access and corrupted cache/history refuse. Effects, observations, audits and receipt persistence commit or roll back together.

Cancelled source/date reservations remain permanent. Ordinary preparation cannot create a replacement original, and complete original reconciliation reports that date incomplete. A future fresh attempt needs its own immutable predecessor contract and separate approval; it is not authorized by this cancellation. Billing fixed evidence/independent review and durable exact-attempt recovery now exist for this original path.

The [native/API receipt](evidence/LOCAL-STOCK-JOURNAL-ORIGINAL-CANCELLATION-2026-10-03.md) and [browser receipt](evidence/LOCAL-STOCK-JOURNAL-ORIGINAL-CANCELLATION-BROWSER-2026-10-03.md) record synthetic verification and regression limits. Complete-history transaction cost, actual final receiver evidence, finance/provider terms and outcomes, infrastructure residency, recovery and operator acceptance remain unqualified. No provider I/O, workflow, CI runner, account, PR, merge or deployment is introduced.
