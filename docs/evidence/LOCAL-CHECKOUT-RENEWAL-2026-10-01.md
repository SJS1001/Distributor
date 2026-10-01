# Reviewed checkout replacement — local engineering receipt

Date: 2026-10-01. Parent version: `3f03c5f6c9584008e66a863b62ecfc92914ae8fa`; local branch `codex/local-distributor-checkpoint`. The companion [machine receipt](LOCAL-CHECKOUT-RENEWAL-2026-10-01.json) binds final candidate files, documents, retained local logs and byte-identical historical evidence. This receipt identifies a candidate over that parent; verify the actual resulting Git commit separately.

## Scope and outcome

Partial D-020/D-024 and CH-07/08 engineering: finance closure of an exact retained unpaid Stripe test session, reviewed permanent successor intents, current generation resolution and scoped buyer/finance interface. All 44 tasks/10 gates remain **NOT VERIFIED**; full Distributor remains incomplete.

Original invoice/session identity, intent money and callback bindings remain intact. A pending original becomes blocked after replacement; a completed original retains its observed evidence. Renewal requires a current revision, current positive native balance and buyer-visible reason. Only an unsent/error-free pending intent or an error-free completed session explicitly observed expired/unpaid is eligible. Clock expiry alone, running/unknown/paid/complete/unverified receipts and active claims do not permit replacement. A successor stays pending until explicit sending. Exact renewal retries retain the original command receipt after fresh grants/password/acceptance/restore checks. Fresh requests resolve the current intent even after partial/full native payment; send/launch guards reject changed money. Closure and renewal never record native cash.

The test adapter retrieves the exact session before expiry, validates metadata/mode/test/money/status and invokes the fresh finance/acceptance/restore/claim/intent guard immediately before writing. Already expired/unpaid retrieval makes no write. Shared durable claims block launch/concurrent renewal and fence abandoned work. Uncertain closure retains binding and blocks renewal pending qualified reconciliation. Provider and native writes are not atomic. Customer withdrawal during authorized I/O cannot recall it; retaining its qualified observed result authorizes no future processing.

## Environment and authorization

Direct macOS arm64 workstation, Node v24.16.0, npm 11.13.0, SQLite 3.53.0; local SQLite fixtures and loopback headless Chromium. Stripe SDK methods were mocked; no actual upstream request/account or live customer data. Local commits only: no CI jobs/runners/workflows, cloud repository checkout, push/PR, deployment/purchase/publication/settings changes or OPUS/UB integration. Future CI remains separately authorized GitHub-hosted work.

Three bounded local coding sessions completed. Launch/runtime returned GPT-6.1 Sol / Medium for tests and UI/browser work, GPT-6 Astra / High for independent financial/access review. Parent owned server integration, documentation, final checks and commit. Workers owned new test files, main.tsx/appended browser journey and read-only review respectively. Their manifest/events are retained under `/tmp/distributor-checkout-workers`; these are coding sessions, not CI runners. Parent Sol / High was verified in the preceding checkpoint; no fresh parent runtime query is claimed by this receipt.

## Verification

- Worker focused backend PASS 38/38, 4333.57 ms, exit 0; OS-process renewal contention, generation restart/idempotency, frozen original money/binding, strict HTTP/CSRF, current grants/acceptance, failed transactional events, closure claims and mocked SDK guards.
- Corrected independent reproduction plus parent balance regressions PASS 9/9, 5585.112667 ms, no failures/cancellation/skips/todo. Reviewer initially demonstrated 6 pass/1 fail; corrected parent execution retains the exact reproduction and adds partial/full native balance checks.
- Full backend PASS 526/526, 22594.143375 ms, no failures/cancellation/skips/todo.
- Final typecheck and formatting PASS; production build PASS, 161 ms. Full Chromium PASS 40/40, reported 1.4 minutes; the new phone replacement journey passed in 1.4 seconds.

All source/test/configuration edits precede these final checks. Documentation/evidence checks follow. Some completed commands' host responses omitted numeric exit metadata; no numeric code is inferred solely from an empty response. The companion records observed terminal summaries and available metadata. Worker/browser focused results are narrower than the full integrated candidate.

## Findings and retained failures

Independent Astra/High review confirmed one P2: fresh checkout after renewal plus partial native payment rebuilt today’s payload and threw `EFFECT_CONFLICT`. Parent now returns the current generation before constructing a new frozen intent. A parent regression also covers fully paid native invoices, fresh consent rejection and no provider send after amount change. Preserve the original failed reproduction and corrected log.

The initial worker launcher failed before session launch because `common` was undefined; corrected launcher ran once and completed three sessions. Worker backend failures reflected receipt projection/HTTP payload typing and fixture assertions, then passed after correction. Reviewer corrected an intermediate assertion to permit the documented blocked pending predecessor state while preserving original identity/money/result. Browser initially read stale setup state; worker added explicit refresh and retained its trace/context. UI worker’s intermediate typecheck saw concurrent test typing errors; final integrated typecheck passes. The first planning link check failed while the new JSON companion had not yet been created; retain that failed output separately and rerun after creation. Existing earlier checkout logs and all historical receipts are retained; no failed or incomplete run is represented as a pass.

Dependencies, lockfile and license notices are unchanged. No third-party implementation was copied.

## Limits and next work

No actual Stripe session expiry/payment qualification, new process-kill test during closure, independent buyer/finance acceptance, immutable provider-observation archive, delivered customer notification, real carriers/devices or infrastructure residency proof. Synthetic OS-process contention does not prove production timing/load/termination behavior. Schema/index/load/locking/clock/retention/security/upgrade/recovery and business policies remain unqualified; stop old writers before upgrades, and do not mix versions. Old callbacks remain original-money bound; overpayments and concurrent cash/credit outcomes require finance review.

Continue broader native/provider/operator gaps and qualification against tasks/checkpoints. Local checks and this receipt authorize no runner use or publication and do not close a product gate.
