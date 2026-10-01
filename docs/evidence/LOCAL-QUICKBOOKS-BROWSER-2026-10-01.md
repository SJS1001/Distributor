# Local QuickBooks browser authorization, 2026-10-01

Status: **PASS for the captured local regression scope only. All 44 acceptance tasks and 10 product gates remain NOT VERIFIED; the full system is incomplete.** Partial D-008/D-034/D-036/D-037 engineering for REQ-03/REQ-18/REQ-19/REQ-20 and CH-07/CH-09; relevant G1/G7 evidence, without gate acceptance. Reviewer: Codex self-review; no independent reviewer or human finance acceptance.

Parent: `a3703abea9e55947af2b0678ada53844d9b54655`, branch `codex/local-distributor-checkpoint`. The pre-test candidate was captured at `2026-10-01T20:40:31.894780+00:00`. The [companion](LOCAL-QUICKBOOKS-BROWSER-2026-10-01.json) binds all 242 application/configuration/test/license inputs, documents, this receipt, command records/logs and 161 unchanged historical evidence files. Application bytes were unchanged during receipt preparation. Environment: macOS arm64, Node v24.16.0, npm 11.13.0, disposable native SQLite, repository-pinned Playwright/local Chromium. All customer, company, secrets and transport responses were synthetic. Browser authorization navigation was intercepted; no actual Intuit account or request was used.

## Final reproduction and observed results

| Command | Observed result |
| --- | --- |
| `npm test` | PASS 860/860; zero failures, cancellations, skips or todos; TAP duration 25133.175833 ms; command elapsed 25.37382016700576 seconds |
| `npm run test:e2e` | Production build PASS and Chromium PASS 52/52; command elapsed 100.08621062501334 seconds |
| `npm run typecheck` | PASS, exit 0; 0.9673538750212174 seconds |
| `npm run format:check` | PASS, exit 0; 7.206025874998886 seconds |

Commands started at approximately `2026-10-01T20:40:31.995Z`; exact timestamps, arguments, outcomes and hashes are in the companion. Receipt-stage planning/local-link and whitespace checks follow receipt creation and are recorded there. Planning checks establish document structure, not product acceptance.

## Expected versus observed

- Browser startup stays disabled by default and requires explicit managed-provider configuration, an available encryption key and the exact canonical origin/callback. Fixed server configuration supplies company, customer, worker, client and secret; browser input cannot replace them. Startup rejects missing customer, unsuitable modes and changed redirects.
- Native storage retains only versioned hashes of the initiating login and random nonce, with the existing exact schema unchanged. A second login for the same person cannot inspect, cancel or consume that attempt. Browser and protected CLI completion/cancellation remain separate. Exact-profile restart preserves the original login/attempt and supports one successful installation; repeated completion is rejected with only two synthetic outbound requests total.
- Current role, organization, worker, active session, expiry and required password/MFA restrictions reject unauthorized claims before I/O. Tests change logout, role, password requirements, customer choice or cancellation during each synthetic token/company request. Subsequent I/O/installation is fenced; prior credentials are retained and uncertain attempts remain unknown or explicitly canceled.
- Completion checks the exact callback, nonce and realm, uses one confidential-client token POST and one exact sandbox CompanyInfo GET with redirects refused, then installs encrypted credentials and completion/audit atomically. Original authorization regressions cover single-use process contention, rollback, supersession and restore fences. New human-initiator assertions verify begin/exchange/complete audits; credential installation remains attributed to the configured worker.
- New attempts select insertion order even at tied timestamps and supersede earlier pending claims. Denial is retained; expired attempts reject completion. Safe status contains no login token, authorization code, access/refresh tokens, private company response or state hash.
- Actual HTTP injection checks session/finance permission, exact Origin/CSRF, strict request shape, no invalid-payload attempt, other-login rejection and default-disabled mutations. Callback GET performs no exchange and returns no-store/no-referrer. Enabled logging is exercised in a separate process: parsed request records contain only method/path and omit callback queries, cookies, authorization/CSRF headers and POST bodies.
- The new phone Chromium journey observes the cross-site callback GET carrying no Strict login cookie, followed by successful same-origin session/CSRF reads. Callback query/code is removed from the address and never rendered. Explicit cancellation and denial work. A completion response is deliberately lost after its native commit: Finish disappears, Check recovers completed/ready revision 1, reload does not resubmit, and exactly one completion request occurs. No observed horizontal overflow or JavaScript page errors.

## Preserved failures and intermediate evidence

Initial native/HTTP and type checks failed because the HTTP handler lacked the `permit` import; corrected focused checks passed 29/29 and type passed. A later audit-focused run failed 29/30 because its new oracle expected a binding-referenced installation event in the attempt-referenced query. The corrected assertion independently checks human authorization events and worker installation; final backend includes it. Logging-focused 30/30, focused browser/build 1/1 and intermediate type results remain historical. A failed extra-assertion patch matched no source and changed no bytes. No final browser failure occurred in this checkpoint.

Private captures and original failed/intermediate/final command logs remain at `/tmp/distributor-quickbooks-browser-checkpoint`; hashes are recorded in the companion. Temporary storage has no archival guarantee. Historical evidence is retained unchanged. Tests do not contain live secrets or customer information.

## Limits and re-verification

This is synthetic local engineering evidence. Actual Intuit registered-client/redirect/CompanyInfo/token lifetime contracts, US/Canadian companies, vendor terms, customer authority, upstream revocation/rotation and secret custody remain unqualified. PKCE is not implemented or claimed; the confidential-client threat model needs security acceptance. No CI runner/job/workflow, delegation, cloud source transfer, push/PR, provider request/account, purchase, deployment/publication/live data or OPUS/UB integration was used.

Application logging controls do not qualify proxy/access logs, browser instrumentation/history synchronization, developer tools or upstream privacy. Browser clearing is not JavaScript zeroization. Secure HTTPS/cookies, actual data residency, retention, indexing/query cost, production concurrency/load, upgrade/downgrade and restore/operator recovery require separate evidence. Insertion-order lookup does not establish production latency or preservation across arbitrary table rebuilds. Older application versions cannot interpret browser state envelopes and must not resume those attempts. Cancel does not disconnect credentials or revoke upstream grants. Multiple configured company/customer bindings and actual finance operator workflow are not qualified.

Reverify after changes to authorization/session enforcement, server origin/binding/configuration, credential/key lifecycle, disclosure/consent, database/restore behavior, callback UI/logging/proxy deployment or provider protocol. See [configuration and procedure](../PROVIDERS.md#quickbooks-browser-connection). No generated receipt supplies human approval or passes a product gate.
