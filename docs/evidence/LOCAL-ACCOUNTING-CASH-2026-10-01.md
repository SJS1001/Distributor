# Local QuickBooks recorded cash handoff — 2026-10-01

Partial D-034/D-035/D-036 engineering evidence affecting G4/G7/G8. All 44 tasks and 10 gates remain NOT VERIFIED; full-system work is incomplete. Reviewer: Codex automated synthetic checks, without human finance/operator acceptance. Parent local commit `b05c49b038126a5997702a1d9e05de7aae763007`, branch `codex/local-distributor-checkpoint`. The [machine receipt](LOCAL-ACCOUNTING-CASH-2026-10-01.json) binds actual source/test/configuration hashes and unchanged historical receipts. See the [provider runbook](../PROVIDERS.md).

Finance can queue a native invoice with explicit QuickBooks customer/item/tax mappings, then queue already recorded cash against its completed QuickBooks invoice. The payment freezes gross cash, original invoice identity/money/currency, customer, deposit account, application amount and stable payment reference. Queue retries recheck current finance authority, credential-change status, customer permission and restore clearance before cached results. Billing owns cash reads; integration owns effect/allocation writes. Cash operations remain hidden from buyers and commercial staff.

Each payment has one immutable allocation reservation. Pending, unknown and completed applications jointly cannot exceed the original invoice total. Reservation and queue/audit/command receipt commit atomically. No automatic cancellation, reallocation or release is implemented: finance must reconcile uncertain effects, external edits, credits and refunds separately. The existing durable provider claims fence sends and reads; lookup absence remains inconclusive and never permits automatic resend.

The sandbox adapter rereads the exact parent invoice before posting, validates its marker/customer/currency/total and available balance, then sends a Payment record with stable request identity, explicit deposit account, UTC recorded cash date and `ProcessPayment: false`. A response must match exact cents, customer, currency, deposit, date, payment reference, effect marker and the precise invoice application/unapplied cash. Invoice responses now also require customer identity and exact cents. Payment identities include an entity prefix to avoid collisions with invoice IDs. These contracts were tested using intercepted fetch responses; no actual provider calls occurred.

## Final direct workstation checks

Environment: macOS arm64, Node 24.16.0/npm 11.13.0, synthetic SQLite fixtures, intercepted fetch/in-memory adapters, independent local child processes and loopback headless Chromium. No CI runners or provider credentials/requests.

- `npm run typecheck`, `npm run format:check`, `git diff --check`: PASS.
- Focused cash/claim/adapter checks: 23 PASS, no failures/cancellations/skips/todos, 1448.558709 ms. This precedes final additions strengthening buyer and foreign-organization fixtures.
- Final `npm test`: 165 PASS, no failures/cancellations/skips/todos, 8176.325333 ms, including eight cash tests and the strengthened fixtures.
- `npm run test:e2e`: production build PASS (118 ms), 20 Chromium journeys PASS (32.7 s), including the new accounting journey (2.0 s).
- Corrected focused accounting browser check: one PASS (3.0 s total).
- `python3 scripts/verify_plan.py --json`: final structural/link result recorded in the machine receipt. This reviews documentation structure, not product gates or actual provider acceptance.

## Observed behavior, failures and review

The cash tests exercise immutable mappings/retries/restart, completed parent requirement, exact integer bounds, current finance/organization/consent/restore checks, private projections, late allocation rollback, lost response reconciliation, duplicate/mismatched provider responses, unapplied cash and strict HTTP fields. Two real child processes contend for 8,000-cent applications against an 11,300-cent invoice: exactly one commits. A separate sequence retains an unknown 8,000-cent reservation, rejects another 8,000, then permits 3,300; the second 8,000-cent receipt retains 4,700 unapplied. Another fixture freezes gross 12,000, applied 11,300 and unapplied 700 CAD cents. Native cash, invoice, order and stock facts remain unchanged by handoffs.

The new browser journey creates a separate synthetic customer/invoice and 11,300-cent recorded payment. Strict residency initially blocks QuickBooks; an explicit named customer exception permits queuing. Committed invoice and payment queue responses are deliberately lost; each retry uses the unchanged key and retains one effect. Synthetic sends record an external outcome then lose their response, becoming unknown without a resend control. Explicit reads reconcile both effects to completed; reload retains completion. Native stock/order/invoice facts equal their pre-handoff snapshots. The browser fixture binds only an in-memory QuickBooks adapter, with no token, Stripe binding or provider network activity.

Preserved initial typecheck failure: `tests/accounting-payments.test.ts(349,12)` and `(349,17)`, TS7006 implicit-any `url`/`init`. Added explicit mock request types without weakening production constraints. The first focused browser run failed at the 60-second timeout because its helper expected a `Continue` button while the dialog correctly used `Queue invoice`. Corrected the test locator; its error context/trace remain in ignored workstation artifacts. An earlier full Node pass (165/165, 10492.948583 ms) is superseded by the final run after review strengthened the actual buyer account and a foreign organization's existing cash row in the same database.

Review checked module ownership, current authorization before retries, atomic allocation/queue writes, immutable payload conflicts, strict response identity and unknown-outcome recovery. It also verified the official Payment/SDK references in the runbook. Historical evidence files remain byte-identical to the parent commit. No dependencies or license notices changed; actual license/source publication qualification remains open. Runtime/build/browser artifacts and session material remain ignored. Standing handover file and project memory index remain absent.

## Limits and execution policy

This is accounting record creation for cash already received. No new charge is requested and native money is not posted again. The external invoice balance read and payment creation cannot be one atomic transaction across systems; external concurrent changes can require reconciliation. UTC posting date, deposit/customer/item/tax mappings and reservation policy need finance acceptance. Strict response assumptions need actual US/Canadian QuickBooks sandbox qualification before activation. The default provider runtime remains disabled and permits sandbox configuration only.

OAuth/refresh/revocation/secret rotation, accounting credits/refunds/import identities, unpaged history, production schema upgrades/indexing/load/retention/fault/restore/security/residency, physical devices/operators and approved business/source/vendor policies remain open. Customer permission does not prove vendor residency. All task/gate statuses remain unchanged.

Direct workstation verification and local commits only. No local/self-hosted/cloud CI job, workflow, runner registration, push, PR, publication, deployment, purchase, provider account/request, live data or OPUS/UB integration occurred. Future Distributor CI uses GitHub-hosted runners after separate authorization/qualification. No fresh remote-access claim is made.
