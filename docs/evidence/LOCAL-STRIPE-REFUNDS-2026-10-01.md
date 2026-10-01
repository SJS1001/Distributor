# Local credited cash and Stripe refunds — 2026-10-01

Partial D-024/D-025/D-033/D-036 engineering evidence affecting G4/G6/G7. All 44 tasks and 10 gates remain NOT VERIFIED; the full-system goal is incomplete. Reviewer: Codex automated synthetic checks, without human finance/operator acceptance. Parent local commit `5997fc9` on `codex/local-distributor-checkpoint`. The [machine receipt](LOCAL-STRIPE-REFUNDS-2026-10-01.json) binds source/test/configuration hashes and historical receipts. See [provider operations](../PROVIDERS.md).

Billing owns credited-cash reservations, permanent Stripe refund bindings and retained observations. Integration owns immutable intents, send/read leases and provider operation state. Finance requests against an original payment after an invoice credit; pending/unknown amounts remain reserved. A provider pending/requires_action response is recorded without counting repayment. Verified success counts cash; a later verified failed/canceled result reverses it with all history retained. Older pending or success observations cannot revive a terminal failed/canceled refund.

The default-disabled test adapter retrieves the original settled PaymentIntent, validates test mode, payment identity, received amount and currency, and creates one refund with a stable effect idempotency key and minimum metadata. Lost sends remain unknown and are never automatically resent. Bound refunds use exact identity reads; unbound searches are limited to ten pages of 100, reject duplicates, and treat exhausted/absent results as inconclusive. Known unresolved refunds can be polled at least 30 seconds apart; terminal outcomes require explicit refresh. Existing webhook processing only handles checkout events.

## Final direct workstation checks

Environment: macOS arm64, Node 24.16.0/npm 11.13.0, synthetic SQLite fixtures, mocked Stripe SDK/runtime responses and loopback headless Chromium. No actual provider request, bank repayment or CI runner was used.

- `npm run typecheck`, `npm run format:check`, `git diff --check`: PASS.
- `npx tsx --test tests/refunds.test.ts`: 13 PASS, no failures/cancellations/skips/todos, 1402.719917 ms.
- `npm test`: 145 PASS, no failures/cancellations/skips/todos, 7628.345084 ms.
- `npm run test:e2e`: production build PASS (64 ms), 19 Chromium journeys PASS (30.6 s total; refund journey 990 ms).
- `python3 scripts/verify_plan.py`: final documentation structure/link result is recorded in the machine receipt. This is structural review, not product verification.

## Observed behavior

Thirteen new Node checks cover pending reservations, success and later failure, restart/retry, lost sends, inconclusive reads, duplicate references, mismatched money/currency/payment/effect/refund identities and statuses, current consent before cached results, fresh grants after I/O, recovery holds, lease fencing, late observation audit rollback, actual separate-process read contention, mocked SDK creation/lookup, HTTP authorization/CSRF and bounded runtime polling. The SDK projection is exercised through integration into native billing rather than only testing adapter output. Buyer/commercial effect lists omit internal refund operations; those roles cannot read payment/refund evidence.

Two real child processes contend for one reconciliation lease: one cash application commits, while the other operation rejects. A late audit failure rolls back native totals, binding, observation, operation result and transaction changes together, preserving unknown recovery. Consent withdrawal during I/O allows retaining an already returned outcome but prevents subsequent calls; revoked finance grants prevent completion until another qualified operator reconciles.

The browser creates one separate serialized sale and collection invoice for 11,300 CAD cents, records a synthetic manual payment and full original-line credit, then requests cash. A lost committed request response retries the same key, retaining one reservation; a second request exceeds available cash and rejects. Bank verification also loses its committed response and retries the same key, retaining one repayment. Reload shows completed history: paid 11,300, credited 11,300, refunded 11,300 and balance zero. Refund activity leaves stock, orders and shipments unchanged. No page errors occurred. This browser journey covers manual evidence, not Stripe-hosted customer settlement.

## Preserved failures and review corrections

- Initial typing errors involved a credit command name, row projection, partial Stripe fixture cast and child-process array typing; corrected. First focused run passed 9/10, with cleanup failing because a restarted fixture retained the closed database; cleanup now references the replacement application. Second focused run passed 12/12 (1481.294708 ms).
- Expanded focused run passed 12/13 (1548.752083 ms): a privacy fixture expected an empty effect list despite its existing checkout. The assertion now checks refund operations specifically. Review also restricts internal refund effect visibility to admin/finance/support. Final expanded checks pass 13/13.
- First and second focused browser attempts failed at packing because the fixture used a missing order revision. It now reads the current dashboard order revision before packing; order acceptance itself did not require that revision.
- Third browser attempt timed out (60 seconds) on the wrong Reason label. It now uses the existing Reason / evidence label and Continue action. Fourth timed out (60 seconds) because the UI retained its initial dashboard while API fixtures created a new invoice. Reload before navigating makes the fixture state visible. Final full browser regression passes.
- Initial documentation structure check failed on the machine-receipt link before its JSON file existed (48 Markdown files/316 local links). The file is added before final structural review; this failed result is preserved.
- Code review found the SDK refund projection omitted effectId required by integration. Corrected the projection and added an SDK-to-native application regression with mocked methods. No earlier execution failure is claimed for that missing field.

Earlier results do not substitute for the final candidate. Historical receipts remain byte-identical to the parent commit; the machine receipt lists their hashes. Runtime/browser artifacts and session material remain ignored. No dependency or license changes were introduced. The referenced standing handover file and project memory index remain absent; repository instructions/latest handoff were read.

## Limits and execution policy

No actual Stripe request, payment/bank settlement, bank return, customer required-action instructions or human finance acceptance occurred. Refund webhook handling and automatic late-failure alerts remain pending. Terminal refunds are not automatically polled. Unknown sends require operator reconciliation and cannot be bypassed with a new request. Refund/payment/observation lists remain unpaged. Production volume/indexing/retention/upgrade/fault/restore/security/residency, operating refund/tax/currency rules and provider terms remain unqualified. OAuth/secret lifecycle, accounting payments/credits and MFA/recovery remain outstanding.

Current instruction permits direct workstation checks and local commits only. No local/self-hosted/cloud CI job, workflow, runner registration, push, PR, publication, deployment, purchase, provider account/request, live data or OPUS/UB integration occurred. Future Distributor CI uses GitHub-hosted runners after separate authorization and qualification. No fresh remote-access claim is made.
