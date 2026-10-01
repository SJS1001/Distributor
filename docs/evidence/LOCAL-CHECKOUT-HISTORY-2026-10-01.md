# Checkout observation history — local engineering receipt

Date: 2026-10-01. Parent version: `b265fc649d5655e9edf6d3aa9ce823ca171bc1c1`; branch `codex/local-distributor-checkpoint`. The [machine companion](LOCAL-CHECKOUT-HISTORY-2026-10-01.json) binds the final candidate, documentation, preserved local artifacts and unchanged historical evidence. Verify the resulting local commit separately.

## Scope and result

Partial checkout integration, billing review and traceability engineering. Authorized staff and own-account buyers can inspect invoice-wide checkout history across retained renewal generations. Pages contain 20 rows ordered by durable insertion sequence with invoice/account-scoped opaque continuation. Fresh actual authority, password requirements, effect and owning invoice identity govern every read. Withdrawal of provider permission preserves authorized historical reads and blocks subsequent provider operations. All 44 tasks/10 gates remain **NOT VERIFIED**; full Distributor remains incomplete.

Integration owns observations appended in the existing fenced completion transaction with result/event/lease release. Late or revoked claim completions and failed I/O add no observation; completion rollback preserves older snapshots and the earlier mutable projection. Qualified local receipts are labeled verified, partial receipts unverified and successful absent lookups not_found. Frozen intended amount/currency and whitelisted reference/status/payment/expiry are retained; no bearer URL, raw response or private claim/actor/account fields enter the public snapshot. Hash and bound identity checks detect changed bytes; this is not provider attestation or a tamper-proof administrative ledger. No native cash is inferred. Older receipts and pending generations are never backfilled.

The phone view supports pagination, failed-continuation retry, reload, empty/partial results, focus return and cancellation on close, changed revision, navigation and sign-out. Existing checkout launch proof now requires actual status/payment strings rather than coerced array values.

## Environment and verification

Direct macOS arm64 workstation, Node v24.16.0, SQLite 3.53.0, isolated synthetic SQLite fixtures and loopback headless Chromium. No actual Stripe/provider request, provider account, live customer data or device qualification. Direct workstation checks/local commit only: no cloud checkout, CI runner/job/workflow/registration, push/PR, publication/settings change, deployment/purchase or OPUS/UB integration. Future Distributor CI remains separately authorized GitHub-hosted work.

Two bounded local coding sessions completed with launch-verified GPT-6.1 Sol / Medium settings for UI and backend tests. Parent's latest verified setting was GPT-6.1 Sol / High at 2026-10-01T14:17:33.641Z. The manifest/events and local artifacts are hashed in the companion. Coding sessions are not CI runners.

- Final full backend PASS **614/614**, zero failures/cancellations/skips/todo, exit 0. This includes 24 new observation tests and six strict-proof/retention/integrity tests.
- Final build and full Chromium PASS **42/42**, exit 0; focused checkout access/replacement/history PASS 3/3 (6.7 seconds).
- Final type, formatting, whitespace and planning checks PASS. Full source/test edits preceded final suite runs; documentation/evidence checks follow.

Fresh grant/account/invoice/organization restrictions, opaque pagination, restart and immutable frozen money, null/partial receipts, withheld consent, malformed status/payment/expiry, late send/refresh/close claims across separate connections, completion rollback, legacy absence, HTTP/session/no-store and UI request cancellation are exercised. Native invoice payment remains unchanged. Parent reviewed transaction fences, module ownership, fresh authorization, exact proof types, safe projection and UI lifecycle. No reproduced source defect remains in this scoped review.

## Preserved failures and limits

Retain the initial parent typecheck failure caused by an incorrect negated typeof edit, corrected explicitly. Initial proof tests expected open to return an unavailable state; it correctly throws CHECKOUT_UNAVAILABLE, and assertions were corrected. Worker HTTP assertions initially expected 400 for an oversized router path (actual 414), and expected route 404 without CSRF (actual 403). Browser fixtures initially used an incorrect foreign-buyer password and then expected 404 rather than the actual account-scope 403. Both browser traces/contexts and all failed/intermediate logs are preserved. No failed/intermediate run counts as a pass.

All earlier tracked evidence remains byte-identical to parent Git objects. Dependencies, lockfile and licenses are unchanged; no third-party implementation copied.

This archive covers completed authorized local observations, not every failed attempt or full upstream history. It does not qualify actual Stripe behavior, signed callbacks, customer notifications, real carriers/devices, infrastructure residency or vendor/customer terms. Separate-connection contention is same-process evidence, not new OS-process termination or production load proof. Provider/native changes remain non-atomic and adapters must honor the guard. Actual security, retention, recovery, upgrades, locking/clock and operator/customer acceptance remain open. Stop old writers before upgrades; mixed versions remain unqualified. Continue broader implementation against the plan; no product gate closes from these checks.
