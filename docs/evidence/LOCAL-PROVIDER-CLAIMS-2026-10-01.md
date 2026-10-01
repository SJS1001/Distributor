# Local provider send/read claims — 2026-10-01

Partial D-034/D-036 engineering evidence affecting G4/G7/G8. All 44 tasks and 10 gates remain NOT VERIFIED; full-system work is incomplete. Reviewer: Codex automated synthetic checks, without human finance/operator acceptance. Parent local commit `546eb06e187c5895f9828e1ace2675209582edeb`, branch `codex/local-distributor-checkpoint`. The [machine receipt](LOCAL-PROVIDER-CLAIMS-2026-10-01.json) binds actual source/test/configuration hashes and unchanged historical receipts. See the [provider runbook](../PROVIDERS.md).

Generic checkout/accounting sends and reconciliation reads now acquire integration-owned durable exclusive token claims. Recovery invalidates abandoned claims, scopes recovery by organization and makes abandoned sends unknown. A late sender/read cannot bind its result, overwrite a successor with an absence, or release a successor claim. Legacy running intents without tokens remain recoverable. Unknown sends cannot automatically resend; provider lookup absence remains inconclusive.

Current active finance/support grants and credential-change status are checked inside claim/completion transactions. Cached checkout/accounting queue results require current grants, named customer consent and restore clearance. Stripe settlement requires fresh finance authority and restore clearance after retrieval, including inside its cash transaction. An already authorized observed outcome may survive consent withdrawal during I/O; subsequent outbound requests remain blocked. Grant revocation or restore isolation during I/O leaves a send unknown for later qualified reconciliation.

## Final direct workstation checks

Environment: macOS arm64, Node 24.16.0/npm 11.13.0, synthetic SQLite fixtures, in-memory adapter responses, independent local child processes and loopback headless Chromium. No actual provider requests or CI runners.

- `npm run typecheck`, `npm run format:check`, `git diff --check`: PASS.
- `npx tsx --test tests/integration-operations.test.ts`: 12 PASS, no failures/cancellations/skips/todos, 1229.904375 ms.
- `npm test`: 157 PASS, no failures/cancellations/skips/todos, 8596.213083 ms.
- `npm run test:e2e`: production build PASS (274 ms), all 19 existing Chromium journeys PASS (32.9 s). This is existing UI regression; no new provider lifecycle browser journey was added.
- `python3 scripts/verify_plan.py`: final structure/link result recorded in the machine receipt; documentation review does not verify a product gate.

## Observed behavior and review

Focused tests cover abandoned senders, exclusive successor reads, a second connection, organization-scoped recovery, stale null responses, current roles/deactivation/password-change status, cached intent guards, consent withdrawal, restore holds during provider/settlement I/O, fresh settlement grants, late-event rollback, lookup failure/absence and legacy running intents. Separate child processes share a disposable database: one read succeeds, the competing read is rejected, and one completion event is retained. Accounting completion adds no native cash. Settlement denied after revoked finance authority or restore isolation adds no cash; a separately qualified synthetic settlement adds exactly 11,300 CAD cents.

Review moved grant checks inside transactions instead of checking only before lock acquisition. A fault-injected transaction acquisition check deactivates the principal immediately before entering the transaction; cached commands, claims and completion reject it. These checks exercise actual module boundaries and state transitions rather than only inspecting stored tokens.

First focused run: nine PASS/two FAIL, 1395.62375 ms. The security fixture omitted the required `iam_user_security.updated_at` field. Corrected the fixture; no production constraint was relaxed. Intermediate rerun: 11 PASS, 1187.721292 ms; superseded by the final expanded 12-test run. Historical receipts remain byte-identical to the parent commit. No dependencies or license notices changed. Runtime/browser outputs and session material remain ignored. Standing handover file and project memory index remain absent.

## Limits and execution policy

Synthetic adapter responses do not demonstrate QuickBooks/Stripe acceptance, actual process termination during provider I/O, external retries, OAuth/refresh/revocation, secret rotation, production migration or payment/bank reconciliation. Claim recovery currently scans expired claims; production indexing/backlog/quota/retention/fault/restore/security/residency needs qualification. Accounting payments/credits/import identity reconciliation, refund webhook/alerts and MFA/recovery remain open. No gate is passed by these checks.

Direct workstation verification and local commits only. No local/self-hosted/cloud CI job, workflow, runner registration, push, PR, publication, deployment, purchase, provider account/request, live data or OPUS/UB integration occurred. Future Distributor CI uses GitHub-hosted runners after separate authorization/qualification. No fresh remote-access claim is made.
