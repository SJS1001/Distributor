# Local QuickBooks unapplied credit handoff — 2026-10-01

Partial D-034/D-035/D-036 engineering evidence affecting G4/G7/G8. All 44 tasks and 10 gates remain NOT VERIFIED; full-system work is incomplete. Reviewer: Codex automated synthetic checks, without human finance/operator acceptance. Parent local commit `199fc63`, branch `codex/local-distributor-checkpoint`. The [machine receipt](LOCAL-ACCOUNTING-CREDITS-2026-10-01.json) binds source/test/configuration hashes and 62 unchanged historical evidence files. See the [provider runbook](../PROVIDERS.md).

Finance queues one unapplied accounting credit from Billing after reconciling its original QuickBooks invoice. The strict command accepts only the native credit ID; billing supplies scoped original credited quantities/prices/tax and integration inherits immutable original customer/item/tax mappings. Internal finance reason/reference and cash data are excluded. Current active grants, credential-change status, named customer permission and restore clearance are checked before cached retries. Queue, audit and command receipt commit atomically. Buyers/commercial staff cannot see credit operations.

The sandbox adapter requires automatic credit application explicitly off, rereads the exact original invoice and posts original credit lines/tax/date with the stable effect request ID. Response identity/marker/date/customer/currency, gross amount, full remaining credit, sales-line multiset and exact tax line must match. A linked/applied credit, discount, duplicate or different amount/line/tax cannot complete the operation. IDs are credit-qualified. Existing exclusive durable send/read claims fence recovery; lookup absence never permits resend. Creating/reconciling the accounting operation does not create another native credit, move stock or repay cash.

## Direct workstation checks

Environment: macOS arm64, Node 24.16.0/npm 11.13.0, synthetic SQLite, independent local child processes, intercepted fetch/in-memory adapters and loopback headless Chromium. No actual provider requests or credentials; no CI runners.

- Final `npm run typecheck`, `npm run format:check`, `git diff --check`: PASS.
- Focused credit/cash checks: 18 PASS, no failures/cancellations/skips/todos, 1098.098833 ms, before a test-only TypeScript annotation correction.
- Final `npm test`: 175 PASS, no failures/cancellations/skips/todos, 7415.130791 ms; includes ten new credit checks and separate-process contention.
- `npm run test:e2e`: production build PASS (186 ms), all 20 Chromium journeys PASS (34.1 s; expanded accounting journey 2.2 s). A later test-only annotation has no browser runtime effect.
- `python3 scripts/verify_plan.py --json`: final structural/link result in machine receipt; documentation checks do not verify product gates.

## Observations, failures and review

Native CAD fixture: original invoice 22,600 cents (20,000 net + 2,600 tax), credit 11,300 (10,000 net + 1,300 tax), one of two original units. Mapping/quantity/price/tax stay frozen across retries/restart. Different command keys and two child processes still yield one effect. Current role/inactive/password-change/consent/restore checks precede cached reads; strict HTTP refuses forged mappings and an actual foreign organization's credit in the same database. A late audit failure rolls back queue and receipt together. Native facts remain unchanged after both lost-send recovery and an externally applied credit response.

Mocked fetch verifies default-disabled behavior, original parent, preferences, minimal POST body, exact response and bounded read. An already-applied credit after creation remains unknown, another send is rejected, and an applied lookup cannot bind completion. Duplicate/substituted/date/decimal/customer/currency/linked/quantity/discount/tax differences fail closed. The browser loses a committed queue response, retries the same key, sends once with a lost synthetic response, reconciles one operation, then reloads the completed state without changing native stock/orders/invoices/credits.

Preserved failed runs:

- First focused run: 0/9 PASS, wrong new query table `billing_invoice_lines`; corrected to the existing billing-owned `billing_lines`.
- Second focused run: 8/9 PASS; expected `RESTORE_ISOLATED` instead of the actual `RECOVERY_HOLD`; corrected fixture expectation.
- First full regression: 173/174 PASS, 8027.085 ms. Existing cash test still listed credit as unsupported; updated its unsupported-kind check to shipment/checkout after implementing credit support.
- Added racing-settings test initially failed typecheck on an implicit mock argument type; added an explicit `RequestInit` argument annotation. No runtime or production constraint was weakened.
- Earlier focused 9/9 PASS, focused browser 1/1 PASS (4.0 s), earlier full browser 20/20 PASS (34.5 s), and 175/175 regression before the annotation correction are superseded by the final reviewed checks. Their workstation logs are hashed in the machine receipt.

Self-review checked module ownership, original line/value reconciliation, current permission before receipts, atomic queue rollback, immutable intent/restart/contention, exact provider money/identity/tax, private projections, fenced recovery and unchanged native facts. Removed a redundant browser fixture credit branch. Official SDK fields for credit remaining amount and automatic credit application are linked in the runbook. Existing source dependencies/license notices are unchanged; full provenance/publication qualification remains open. Runtime/build/browser artifacts stay ignored. Project memory index and standing handover file are absent.

## Limits and execution policy

This creates an unapplied accounting record. Credit application and cash repayment need separate reconciliation and implementation. Company preferences/parent edits cannot be atomically locked across provider I/O; a mismatching returned result requires finance review. Strict one-tax-line contracts intentionally reject unqualified zero-tax/mixed-rate/automatic-tax variants. Actual US/Canadian company behavior, currency rounding, custom numbering, UTC date/closed periods and item mappings—including external QuickBooks inventory effects—need sandbox and human finance qualification. The runtime remains default-disabled and sandbox-only when configured.

OAuth/refresh/revocation/secret rotation, credit application/refund/cost/import identities, production upgrades/indexing/load/backlogs/history/retention/fault/restore/security/residency, physical devices/operators and approved business/source/vendor policies remain open. Named customer permission does not prove physical/vendor residency. All task/gate statuses remain unchanged.

Only direct workstation verification and local commits. No local/self-hosted/cloud CI job, workflow/registration, push, PR, publication, deployment, purchase, provider account/request, live data or OPUS/UB integration. Future Distributor CI uses GitHub-hosted runners after separate authorization/qualification. No fresh remote-access claim.
