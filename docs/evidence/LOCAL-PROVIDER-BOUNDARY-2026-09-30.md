# Local provider boundary receipt

2026-09-30. Partial local engineering evidence for D-007–D-011, D-022–D-025 and D-034–D-037. All task and product gates remain **NOT VERIFIED**. The application is still under construction.

## Tested candidate and environment

Local uncommitted files, without a Git HEAD. The [machine receipt](LOCAL-PROVIDER-BOUNDARY-2026-09-30.json) identifies the candidate by SHA-256 hashes of source, tests, configuration and documents. Historical planning and engineering receipts remain unchanged.

macOS arm64, Node 24.16.0, npm 11.13.0; disposable synthetic SQLite databases and local Chromium. Tests use synthetic adapters, a synthetic Stripe signing secret and mocked SDK/fetch responses. No outbound payment/accounting/carrier request, actual provider credential, live customer data, deployment or physical device was used.

## Actual results

| Check | Outcome |
| --- | --- |
| `npm run typecheck` | Exit 0. |
| `npm test` | Exit 0; 23 passed, zero failed/skipped. |
| `npm run test:e2e` | Exit 0; Vite production build and one Chromium journey passed. Latest journey includes the disabled-provider send action. |
| `npm run format:check` | Exit 0 after the final browser assertion; all matched files conform. |
| `npm run verify:plan` | Recorded in the machine receipt after the evidence and handoff additions; validates structure only. |
| `npm audit --omit=dev --json` | Exit 0; zero reported production dependency vulnerabilities at inspection. This is not a security audit of the application. |
| Foreground `npm run worker`, providers disabled, disposable DB | Exit 1 with `PROVIDER_DISABLED`, as expected; no provider call. |

The Node suite covers exact raw webhook bytes and SDK signature validation, invalid/missing/stale signatures, live/connected-account rejection, durable acceptance before processing, duplicate/conflicting callbacks, lost send responses, read-only reconciliation, residency withdrawal, current worker grants, callback retries, stale claims and reopening the database. HTTP tests cover role/CSRF checks and bounded malformed/oversized JSON handling. Separate tests assert Stripe checkout/payment identity and money, safe checkout URLs, and QuickBooks effect marker/number/currency/total matching using synthetic responses.

The browser journey covers serial/bulk ordering and fulfillment, retry after a lost acceptance response, customer residency choice, rejection of an unsupported region change, disabled-provider handling, manual payment, return credit and mobile layout. It does not exercise a real checkout or populated callback table.

## Changes reviewed

Default-disabled regional provider bindings, current finance worker identity, authenticated send/reconcile/callback APIs, a signed raw Stripe test webhook, durable callback attempt states and a bounded foreground worker. Unknown send outcomes are reconciled rather than automatically resent. Settlement requires retrieved identity and received-money checks; duplicate provider payment references do not create cash twice. Provider errors omit external bodies and credentials.

The [provider/device plan](../PROVIDERS.md) records customer-selected named residency exceptions and proposed major US/Canada carrier/device candidates. Each selected carrier requires its own choice, adapter and qualification. Native manual operations remain usable with provider processing disabled.

## Preserved failures

An initial formatting check rejected `src/server/http.ts`; the file was formatted and the check passed. An initial type check rejected two incomplete synthetic Stripe SDK response casts in the new adapter tests; those test fixtures were explicitly cast through `unknown`, and type check plus all 23 Node tests passed. Earlier unrelated local failures remain in the historical [engineering receipt](LOCAL-ENGINEERING-2026-09-30.md).

## Limits and continuation

This is local engineering evidence, not provider certification, external webhook delivery, production security, tax approval or verified data residency. A reopened database test does not prove process termination/recovery during actual provider IO. Durable OAuth/refresh/revocation, provider refunds, full accounting handoffs, actual sandbox qualification, backlog/alerting/rotation and deployment scheduling remain pending. Carrier APIs, camera scans and printers remain unqualified. Exact platform, operator, load, backup/restore and commercial evidence is still required by [CHECKPOINTS](../CHECKPOINTS.md).

Repository access was rechecked: SJS1001 has pull/push/admin/maintain/triage permissions on the public active repository; Actions is enabled with zero workflows, and `git ls-remote origin` succeeds with no refs. No remote write or setting change occurred. Future PR/merge identity still requires verified `sjsmithbot`; Distributor's approved CI policy is GitHub-hosted runners. Local files remain uncommitted and unpublished.
