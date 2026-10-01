# Local cash refund pagination and history — 2026-10-01

Status: PASS for bounded local engineering; full system incomplete. Partial D-024/D-025/D-036 engineering relevant to CH-07/CH-09 and restart behavior. All 44 tasks and 10 product gates remain NOT VERIFIED.

Parent: `8f526a4fdcd7ff4af3b430a7b97a07d822d28434`; branch `codex/local-distributor-checkpoint`. The [machine companion](LOCAL-REFUND-HISTORY-2026-10-01.json) binds the tested candidate, documentation, command intervals/results and private artifact hashes. Parent implemented and self-reviewed this checkpoint; no delegated or human acceptance claimed.

## Changed behavior

Billing reads the newest 20 native cash refund summaries without eagerly loading observations. The owning module joins original invoice number/currency and exact payment identity. Existing manual/Stripe/QuickBooks actions remain available; their refund amount review uses the joined invoice currency. Separate 20-row history reads expose only observation identity, provider reference/status, historical applied flag and timestamp for the selected native refund. No read contacts a provider, creates a repayment or changes current native money/stock/provider state.

Actual current active finance/support grants and password requirements protect each page and the compatibility refund list inside a transaction. Organization/refund scope applies to records and cursors. Refund creation timestamps and descending identity resolve ties; observation insertion identities order history. The interface distinguishes historical application from retained outcomes, preserves failed pages with retry, returns focus after closing history and cancels pending reads on close, refresh, navigation or sign-out.

## Actual checks

Direct workstation: Darwin arm64, Node v24.16.0, npm 11.13.0, native experimental SQLite, synthetic CA/CAD and US/USD. HTTP tests inject the actual server; browser tests use Chromium and a loopback subprocess with synthetic fixtures/adapters. No external provider request or credentials used.

- Full `npm test`: PASS 656/656, zero fail/cancel/skip/todo, 24008.659042 ms, exit 0.
- Final `npm run test:e2e`: production build PASS; Chromium PASS 43/43, reported 1.5 minutes, exit 0. Final browser runtime/specs include the final history wording. The backend fixture property correction occurred during this run and affects only Node tests; the full backend subsequently verifies that corrected fixture.
- Final typecheck and format: PASS, exit 0.
- Final planning structure and whitespace results are recorded in the companion after receipt creation.

Seven added backend tests traverse 43 tied-timestamp refunds in both regions after restart, exclude a newer arrival from older continuation and verify fresh reads see it; traverse 43 retained observations with applied/unapplied distinction after restart; reject foreign/absent organization/refund/cursor and unsafe cursor values; recheck forged/stale roles, inactive principals and password requirements; and exercise strict actual HTTP queries. Instrumented owning-store reads retain at most 21 rows per page, with no eager observation query for summaries. Independent native invoices, credits, payments, stock, orders and customers are compared before/after history reads. Existing provider tests now explicitly assert password denial and use independent billing-owned database oracles to prove failed completion preserves native refunds and observations.

The new phone browser journey verifies no eager history read, failed initial/older reads and successful retry without losing rows, end-page/close focus, actual pending request cancellation on close/navigation/refresh/sign-out, buyer denial and no browser exceptions. The full suite also reruns existing manual refund and accounting refund journeys.

Parent reviewed scoped joins/cursor bounds, strict HTTP schemas, current identity/password checks, compatibility projection and transaction behavior, existing finance actions and shared page lifecycle. No source/test/configuration edit follows final checks. Candidate hashes remain stable. All 135 historical evidence files remain byte-identical to the parent commit; dependencies, schema and license notices are unchanged, and no third-party implementation was copied.

## Retained failures and limits

Private artifacts: `/tmp/distributor-refund-history-checkpoint`; hashes in the companion, without archival retention guarantee. Retained failures include direct browser launch missing the npm subprocess PATH, selection of a short-history fixture instead of the intended long-history fixture, missing private database field after wrapping the compatibility list in a transaction, intermediate TypeScript errors, and copied browser contexts/traces. The first full backend run passed 654/656 because old tests read refunds after requiring a password change. Their independent oracles were corrected; the next run passed 655/656 and failed typecheck on `refund` instead of the fixture's `refundId`. That typo was corrected before the final 656/656 run. Earlier focused/intermediate passes are superseded and never count as final qualification.

Limits bound returned/application-retained rows, not SQLite scan/sort/index costs, locking or production latency. Multi-request cursor walks are not snapshots; newer records ahead of the cursor appear after refresh and permitted older additions may appear later. Compatibility refund/payment lists and other dashboard collections remain unbounded. There is no observation backfill, archive/cleanup, real Stripe/bank/customer proof, physical device/carrier qualification or human acceptance.

Production security/load/retention/upgrades/recovery, infrastructure/key residency and operating policies remain unresolved. No cloud checkout, CI runner/job/workflow/registration, push/PR, actual provider account/request, live customer data, purchase/deployment/publication/settings or OPUS/UB integration occurred. This receipt does not pass a product gate or authorize a release.
