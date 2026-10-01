# Local refund exception notices — 2026-10-01

Partial D-020/D-024/D-025/D-036 engineering evidence affecting G3/G4/G7/G8. All 44 tasks and 10 gates remain NOT VERIFIED. Full-system work remains incomplete. Reviewer: Codex automated synthetic checks without human finance/operator acceptance. Parent local commit `84f68226f6be1b202caf42b9a2c0bd303a5405b4`, branch `codex/local-distributor-checkpoint`. The [machine receipt](LOCAL-REFUND-NOTICES-2026-10-01.json) binds the tested source/test/configuration, final documentation and preserved historical evidence. See the [provider runbook](../PROVIDERS.md).

Applied verified refund exceptions create one billing-owned case per refund, with immutable status revisions in the same transaction as native cash/effect/audit changes. Repeated or ignored observations add no revision. Pending/success resolve the earlier exception; pending explicitly states repayment is unconfirmed. A later failed/canceled/customer-action outcome reopens the case. Late verified failure retains observation history while reversing confirmed cash. Acknowledging a notice changes only the current person's read revision; it neither pays nor closes a case. New revisions become unread again, and retries of an old acknowledgment cannot acknowledge them.

Current finance/support authority or buyer invoice-account scope is checked inside every read/command transaction, including before cached command results. Inactive users, changed grants and required password changes fail closed. Buyer projections expose native invoice/refund identity, integer money/currency, status/dates and fixed safe messages; provider identities, raw payloads, staff reasons, refund references, bank details and other customers are excluded. Case/history pages default to 25 and cap at 100, with stable sequence/revision continuations and scoped personal unread counts. No email/SMS/push service or automatic browser polling is included.

Startup transactionally creates tables and backfills current verified exceptions once. Backfilled history is explicitly `existing-state`; it does not reconstruct historical notices. Original refund observations remain authoritative. Restart/read persistence and a disposable old-schema simulation are covered; this is not production schema-upgrade qualification.

## Direct workstation verification

Darwin arm64, Node 24.16.0/npm 11.13.0, synthetic SQLite, independent local child processes, mocked SDK/in-memory providers and loopback headless Chromium. No CI runners, actual provider requests or credentials.

- `npm run typecheck`, `npm run format:check`, `git diff --check`: PASS.
- `node_modules/.bin/tsx --test tests/refund-notices.test.ts tests/refund-callbacks.test.ts`: 19/19 PASS, zero failures/cancellations/skips/todos, 4915.688041 ms.
- `npm test`: 194/194 PASS, zero failures/cancellations/skips/todos, 10140.2205 ms.
- `npm run test:e2e`: production build PASS (72 ms), 21/21 Chromium journeys PASS (37.3 seconds).
- Planning structure/local links and historical evidence preservation are recorded in the machine receipt; these checks do not pass product gates.

Server/HTTP checks cover applied outcomes, deduplication/ignored observations, personal reads, immutable retries, late failure/stale revisions, restart/backfill, fresh grants/password restrictions before cached results, buyer/tenant privacy, strict query/body/session/CSRF, bounded continuation under new inserts and late audit rollback. Separate operating-system processes use different command keys to acknowledge the same revision while retaining one personal read receipt and unchanged cash.

The browser loads 27 notices and 27 revisions over bounded pages. Interrupted page/history reads preserve rows/cursors and retry; history focus returns to the opener. A committed lost acknowledgment response retries the exact key and records one personal read with unchanged native money. Admin and buyer read states remain independent after reload; a 390-pixel buyer view stays within the viewport, and a foreign buyer has no notices/history. Synthetic provider success then late failure produces revisions 28/29: confirmed refund cash rises to 400 cents then returns to zero, the case reopens unread, and original stock/order/invoice facts remain unchanged.

## Preserved failures and review

Earlier type checks caught optional organization fields/generic SQL fixture values; test annotations and exact synthetic organization fields were corrected. An old positional synthetic IAM insert omitted newer columns and produced a NULL password hash; it now names explicit columns. HTTP pagination initially treated non-coerced query values as integers; strict optional digit strings now convert explicitly and the domain rejects unsafe values. Focused/backend regressions exposed those fixtures before final passing runs.

Adding an independent notice account/order made an older global empty-order assertion invalid; it now checks exactly one new order against a captured baseline. That early failure also left an open order affecting the subsequent packing test. Enabling the synthetic Stripe refund adapter changed the older disabled-checkout scenario; the fixture explicitly permits refund operations while keeping checkout disabled. The older balance assertion then matched two invoices; it now selects the new order's actual invoice number, allowing the rendered date inside its cell. These corrections preserve the original order/retry/balance checks.

One accidental overlapping browser launch found the existing loopback port occupied and interfered with trace files/log output; its mixed log is retained as failed evidence, not a valid passing receipt. The final browser run used an isolated foreground invocation after the prior process exited. The final focused/full Node, type/format and browser logs are separate. Historical evidence remains unchanged. Self-review checked module ownership, fresh authorization before cache, transaction rollback, scoped joins, minimal customer projection, stable cursors/retries, focus/unmount cancellation, truthful status wording and acknowledgment without financial effects. Dependencies/licenses are unchanged; source publication rights remain unresolved.

## Limits and continuation

Customer instructions use the usual distributor support channel. Actual provider-specific bank/action procedures, bank repayment, webhook delivery, buyer acceptance and external notification delivery remain unqualified. Current case unread counts are refreshed explicitly, with no push updates. Native payment/refund observations remain unpaged and callback projection caps at 200. Production case indexes/load/backlogs/retention/schema upgrades/fault/restore/security/residency require qualification. A synthetic signed receipt/provider response does not prove external settlement or actual processing location.

Continue OAuth/secret lifecycle, accounting credit application/refund/cost/import identities, MFA/recovery, individual carrier adapters and physical devices, approved business/vendor/source policies and human operator/finance acceptance. All 44 tasks/10 gates remain NOT VERIFIED.

Direct workstation checks and local commits only. No local/self-hosted/cloud CI job, workflow/registration, push/PR, deployment/purchase, provider account/request, live data, source publication, repository setting change or OPUS/UB integration. Future Distributor CI uses GitHub-hosted runners after separate authorization/qualification. No fresh remote-access claim.
