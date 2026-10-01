# Local QuickBooks initial sandbox authorization — 2026-10-01

Partial D-008/D-026/D-036/D-037/D-039 engineering evidence affecting G1/G7/G8. All 44 tasks and 10 gates remain NOT VERIFIED; full-system work remains incomplete. Reviewer: Codex automated synthetic checks without human security/finance acceptance. Parent local commit `2af588d01b8d43b276c10c18c6b5b51e77e7e7c4`, branch `codex/local-distributor-checkpoint`. The [machine receipt](LOCAL-QUICKBOOKS-AUTHORIZATION-2026-10-01.json) binds source/configuration/test hashes, documentation, captured workstation logs and unchanged historical evidence. See [provider operations](../PROVIDERS.md) and [recovery](../RECOVERY.md).

Integration owns a confidential-client sandbox authorization flow through a filesystem-operator CLI. Preparation freezes the exact customer, current finance worker, sandbox company/client/callback, credential revision and named customer-choice version. Random state is returned only in the ephemeral authorization URL; only its hash is persisted with ten-minute expiry. Exact callback origin/path, parameter allowlist/uniqueness, state and company checks precede the single-use exchange claim. Beginning again, cancellation, credential replacement/disable and restore fence stale completions.

Completion makes one fixed-endpoint authorization-code exchange and one exact sandbox CompanyInfo read with intercepted fetch in every check. Basic client authentication, form encoding, refused redirects, twenty-second timeouts, bounded bodies/lifetimes and accounting-only scope are shared with refresh. Current authority/password status, customer choice/version, key, restore clearance, revision and claim are rechecked before I/O and inside atomic encrypted credential installation/completion/audit. Company response fields are discarded. Previous credentials remain unchanged when a new connection fails. A consumed/interrupted attempt becomes unknown and is never resent; status/cancel expose metadata only. Copied pending/exchanging attempts are canceled on isolated restore.

There is no HTTP callback listener or browser integration. The operator supplies a captured callback via protected noninteractive stdin, capped at 32 KiB; secret arguments reject. Completion defaults outbound access off. No PKCE is implemented or claimed. Opening an authorization URL or using actual provider credentials still requires separate authorization; none occurred here.

## Direct workstation verification

Darwin arm64, Node v24.16.0/npm 11.13.0, synthetic SQLite, independent local operating-system child processes, intercepted fetch and loopback headless Chromium. No CI runners or actual provider requests.

- Final type/format checks: PASS.
- Expanded focused authorization/credentials: 28/28 PASS, zero failures/cancellations/skips/todos, 7228.675334 ms. The subsequent process-test failure guard was formatted; the final full regression covers that candidate.
- Final full Node regression: 234/234 PASS, zero failures/cancellations/skips/todos, 10341.460375 ms.
- Final production build: PASS; all 22 existing Chromium journeys PASS (39.7 seconds). No new browser journey is claimed for this operator-only feature.
- Final planning structure/link, whitespace and historical-evidence checks are recorded in the machine receipt; they do not pass product gates.

Fourteen authorization tests cover exact wire parameters, state/callback/company/privacy, restart, denial/replay, expiry and abandoned claims, current authority/consent/password/restore checks, key/version/replacement checks, cancellation/supersession/disable during I/O, invalid/lost/oversized token responses, unexpected scopes/lifetimes, wrong company, late restriction/audit rollback, restore resurrection, protected-stdin/default-off CLI and actual separate-process contention. The contention uses an IPC barrier: one process owns the token request while the second is refused; only the owner then reads CompanyInfo. Credential refresh regression remains covered. The browser suite verifies existing product flows with synthetic local adapters; it does not test an actual Intuit browser authorization.

## Preserved failures and self-review

The first expanded type check found possibly undefined CLI action and incorrect backup/restore argument order/key type in new tests. The initial focused run rejected callbacks because the implementation's client-secret/callback parameters were reversed relative to its callers; its final process fixture waited for an unreachable request. An isolated failing test identified that production argument-order defect. The implementation now matches the callers. The owned hung test process was terminated, and the independent-process test now has a bounded timeout and early-failure guard.

A subsequent focused run passed 12/14 (2674.813833 ms): one recovery fixture inserted six values into the actual four-column table, and another supplied a string instead of the required 32-byte backup Buffer. Fixtures were corrected without weakening production contracts. Later type checks and 28/28 focused and 234/234 full regressions supersede those failures. Captured failed/superseded logs are retained in the machine receipt; no raw log is fabricated for an uncaptured run.

Self-review checked current authority within claim/completion transactions, exact binding/state/callback/scope/company checks, hash-only state persistence, bounded/secret-free operational output, no automatic resend after consumption, encrypted atomic installation/audit, retention of previous credentials on failure, late-write fencing and cancellation after permission withdrawal, restore invalidation and independent-process proof. Final tests include the corrected production parameter order. Dependencies, lockfile and license notices are unchanged; no SDK source was copied.

Protocol references are Intuit's [sandbox discovery](https://developer.intuit.com/.well-known/openid_sandbox_configuration), [official OAuth client](https://github.com/intuit/oauth-jsclient/blob/master/src/OAuthClient.js) and [CompanyInfo SDK operation](https://github.com/intuit/QuickBooks-V3-PHP-SDK/blob/master/src/DataService/DataService.php). These support the selected local protocol design. Actual returned CompanyInfo identity, optional scope and token lifetime contracts still require qualification against approved US/Canadian sandbox companies.

## Limits and continuation

Actual Intuit acceptance/production approval, registered callback operation, confidential-client/PKCE threat-model qualification, upstream revocation, secret custody/rotation, incident response, browser connection workflow, provider/vendor residency terms, real regional infrastructure, retention/index/load/schema upgrades, process termination during actual requests and human security/finance acceptance remain open. JavaScript secret strings cannot be reliably zeroized. Local cancellation/disable cannot revoke already issued upstream tokens or recall a transmitted request. No automatic expiry cleanup or activation of restored stores is provided.

Continue accounting credit application/refund/cost/import reconciliation, individual carrier adapters, physical devices and business/source/vendor qualification under local-only execution. Local checks cannot supply human or infrastructure acceptance. Every task/gate remains NOT VERIFIED and full-system work remains incomplete.

Direct workstation checks/local commits only; no local/self-hosted/cloud CI job, workflow/registration, push/PR, deployment/purchase, provider account/request, live data, publication, settings change or OPUS/UB integration. Future Distributor CI uses GitHub-hosted runners after separate authorization/qualification. No fresh remote-access claim.
