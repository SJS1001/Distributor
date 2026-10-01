# Local invoice checkout access — 2026-10-01

Status: **PASS for bounded synthetic workstation checks**. Partial D-020/D-024 engineering relevant to CH-07/08. All 44 tasks and 10 product gates remain NOT VERIFIED; the full system is incomplete. Reviewer: Codex source review and workstation checks without independent customer/finance/provider acceptance.

Parent local commit `859d7fe`; branch `codex/local-distributor-checkpoint`. The [machine companion](LOCAL-CHECKOUT-ACCESS-2026-10-01.json) binds candidate, documents, available workstation logs and byte-identical historical evidence. JSON excludes its own bytes from circular hashing; the subsequent actual local commit identifies the deliverable.

## Observed behavior and oracle

Billing presents frozen invoice identity/money and retained checkout status/expiry. The generic effects list exposes no checkout bearer URL. Buyer/finance/administrator launch uses a fresh scoped authenticated no-store request and checks real current identity/grants/password, native balance, exact intent money, current named Stripe disclosure acceptance and restore hold. Support/commercial cannot launch. Legacy/malformed receipts, changed balance, expired/finished sessions, unsupported URLs and incomplete refresh block links. Complete/unpaid never creates cash. Leaving the page aborts delayed launch reads; browser navigation validates HTTPS/exact hostname/credentials/port again.

Finance/support refresh retrieves the exact bound test session and never creates a new one. A durable token claim prevents concurrent connection reads, survives connection restart and fences abandoned late results after explicit recovery. Failed lookup or late event rollback blocks the old link; a subsequent exact read can recover it. Substituted references reject without changing the binding. Authorized observed results may survive consent withdrawal during I/O, but further processing/access remains blocked. Pending sending checks current native balance before claiming and immediately before SDK creation through its guarded callback. That callback is fenced by the active token and repeats current authority/permission/restore checks.

The synthetic phone journey signs in independent buyer and administrator sessions. A bank payment of CAD 11,300 cents after a stale ready display blocks launch. Refresh reports expiry without cash; sending a separate pending intent enables its launch. Navigation aborts an intentionally delayed request, retains a reusable button after returning and ultimately reaches an exact Stripe URL fulfilled locally by Playwright. Comparing native invoice projections permits only the explicit bank payment (paid 11,300/balance zero); opening/refreshing causes no other money change. No Stripe network request occurs.

Ten new backend checks cover current restricted/forged/inactive/password identities, account scope, native partial/full payments, legacy/status/expiry/money/URL validation, latest-guard changes, withdrawal/changed terms/restore, competing application connections/restart/forced stale recovery, late transactional rollback and HTTP session/CSRF/exact fields. Existing provider/refund regressions cover guarded SDK writes; the added refund adapter callback test proves its direct capability only. The refund coordinator does not yet supply that callback; its later completion checks alone cannot prevent a changed restriction during preliminary provider I/O. This is a remaining engineering gap for the next checkpoint.

## Checks

| Command | Actual outcome |
| --- | --- |
| `npx tsx --test tests/checkout-access.test.ts tests/refunds.test.ts` | PASS 26/26, zero fail/cancel/skip/todo, 2352.000125 ms, exit 0 |
| `npm test` | PASS 427/427, zero fail/cancel/skip/todo, 15746.7065 ms, exit 0 |
| Focused checkout Chromium | PASS 1/1, 6.4 s, new journey 1.7 s, exit 0 |
| `npm run test:e2e` | PASS 37/37, reported 1.2 minutes, exit 0; build PASS 94 ms |
| `npm run typecheck` | PASS, exit 0 |
| `npm run format:check` | PASS, exit 0 |

Full backend checks precede only the later browser test selectors and browser-server comment correction. Focused Chromium precedes a backend refund-test identity correction; the final full Chromium run covers the final browser candidate. Final type/format checks follow all candidate edits. Planning/link validation, whitespace and independent hashes follow document creation; planning structure verifies no business gate. Temporary logs/traces are available local evidence, not a durable production archive.

Preserved failures: initial Integration property initialization typing; unsupported disclosure region fixture field and SDK typing; duplicate already-created security fixture row; delayed Playwright route fulfillment after abort; two incomplete invoice oracle assertions after the explicit bank payment; full backend regression with forged administrator-as-buyer role instead of real grants; and full browser strict selector matching three invoices after fixture expansion. The corrected test selects the exact invoice and its corresponding checkout effect rather than weakening the assertion. Initial independent hash review also caught the writer hashing its own unfinished status log; that self-mutating status log is excluded, and its failed review is preserved. Copied failed traces/logs remain hashed alongside passes. Earlier runs are narrower/pre-correction evidence and no failure counts as a pass.

Self-review covers owner API boundaries, current authority and account scope, private URL projection, integer money/expiry contracts, claim acquisition/recovery/late fencing, pre-write validation, exact bound reference, rollback, browser cancellation and native-fact conservation. Dependencies/lockfile/license notices are unchanged; no third-party implementation copied.

## Remaining qualification

Latest provider evidence is a mutable projection, not immutable full observation history or instantaneous upstream truth. There is no reviewed renewed-session/amount-revision flow; one existing invoice intent remains bound. Fresh access cannot recall a URL previously given to a customer. Native changes and provider writes share no atomic transaction. New checkout contention uses separate application connections in one process and forced expiry, not new OS termination proof. Existing generic recovery has separate historical process evidence. Production timing/index/load/locking/upgrades/retention/security/recovery/residency and actual provider/contracts/customer/finance acceptance remain open. Stop old writers before upgrades; mixed versions are unqualified.

Direct workstation checks and local commits only: no CI jobs/runners, workflows/registrations, push/PR, actual provider accounts/requests, live data, deployment/purchase, publication/settings changes or OPUS/UB integration. Future CI remains GitHub-hosted after separate authorization and qualification. No fresh remote-access claim is made.
