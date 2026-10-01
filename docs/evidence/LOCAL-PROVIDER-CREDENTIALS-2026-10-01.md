# Local managed QuickBooks credentials — 2026-10-01

Partial D-008/D-026/D-036/D-037/D-039 engineering evidence affecting G1/G7/G8. All 44 tasks and 10 gates remain NOT VERIFIED; full-system work remains incomplete. Reviewer: Codex automated synthetic checks, without human security/finance acceptance. Parent local commit `f77d351188f10ccac002e10f715894dbd548d13c`, branch `codex/local-distributor-checkpoint`. The [machine receipt](LOCAL-PROVIDER-CREDENTIALS-2026-10-01.json) binds tested source/test/configuration hashes, documentation, workstation logs and unchanged historical evidence. See [provider operations](../PROVIDERS.md) and [recovery](../RECOVERY.md).

Integration owns encrypted sandbox tokens and durable revision/state/refresh claims. AES-256-GCM authenticates organization/binding/company/client/revision under a separately supplied 32-byte runtime key. Installation/replacement and local disable require the inspected revision, current regional finance worker and transactional metadata-only audit. Protected noninteractive stdin supplies bounded JSON; no credential HTTP route or secret arguments exist. Status exposes metadata only. Local disable discards tokens and fences in-flight completion; provider revocation remains unimplemented.

Managed runtime mode explicitly refuses an environment access-token fallback. Every QuickBooks preflight/send/read obtains a token through current worker password/finance checks, organization scope, named customer choice and restore clearance. Refresh claims serialize across connections and separate operating-system processes. The fixed Intuit token request uses Basic authentication, form encoding, a 20-second timeout, no redirects and bounded response bytes. Returned pairs rotate atomically after current-authority/consent/restore/claim rechecks. Hard deadlines cannot extend. Lost/invalid responses, expired credentials, interrupted claims and late transactional failure require reconnect; ambiguous refresh tokens are never reused. Stale responses cannot overwrite installed/disabled successor credentials.

Restore disables copied credentials, erases encrypted tokens/claims and advances revisions within the existing isolation/session transaction. A snapshot cannot resurrect tokens rotated or revoked after the source cutoff. The restored provider hold remains, with no activation command. Encryption protects stored material, not authorized filesystem operators/process memory; actual key custody/rotation and incident procedures remain unqualified.

## Direct workstation verification

Darwin arm64, Node v24.16.0/npm 11.13.0, synthetic SQLite, separate local child processes, intercepted fetch and loopback headless Chromium. No CI runners, actual credentials or provider network requests.

- Type and format checks: PASS on the final source candidate.
- Expanded focused credentials: 14/14 PASS, no failures/cancellations/skips/todos, 2446.103625 ms.
- Full Node regression: 218/218 PASS, no failures/cancellations/skips/todos, 21015.570709 ms.
- Production build: PASS; all 22 existing Chromium journeys PASS (44.9 seconds). No new browser journey is claimed for this internal credential feature.
- Final planning/link/whitespace/history checks appear in the machine receipt; they do not pass product gates.

Tests cover ciphertext and metadata privacy, persisted database/WAL exclusion, wrong/missing keys, binding mismatch/tamper, revision replay, exact refresh wire contract, restart, simultaneous connections, actual independent-process contention, installation/disable supersession, lost/invalid/oversized responses, retained hard deadlines, abandoned claims, expired lifetimes, grant/password/consent/restore restrictions before and after I/O, atomic operator/audit rollback, encrypted backup restore and protected-stdin CLI. Configured managed runtime exercises a real local accounting reconciliation with intercepted token/query responses; an absent match remains unknown and does not resend accounting data.

## Preserved failures and self-review

The initial type check exposed a possibly undefined union access token; the discriminated cached branch was narrowed. Initial focused checks passed 10/12: a password-change fixture updated a missing security row, and a runtime fixture expected execute to throw although the existing contract records unknown outcomes. The next focused run passed 11/12 (2342.457834 ms); the password fixture replacement had not matched formatted text, leaving the same missing expected rejection. It now inserts/upserts the required security row with timestamp and asserts the unchanged production denial. Runtime checks inspect the durable unknown state. Subsequent 12/12 (2350.765375 ms), expanded 14/14 and full passes supersede those failures. Early failures were observed in tool output and are retained here as summaries; raw logs are included only for runs actually captured to files.

Self-review checked metadata/secret separation, independently current authority at claim/completion, exact binding authentication, expiry arithmetic and hard-deadline preservation, claim fencing and rollback, no ambiguous retry, process concurrency, restore resurrection controls, protected stdin bounds/redaction and honest qualification limits. The process contention uses an IPC barrier; no timing delay pretends to prove a race. Dependencies, lockfile and license notices are unchanged; no third-party code was copied. Initial OAuth authorization, company/scope validation and provider revocation are still separate required work.

Protocol references are Intuit's [official client implementation](https://github.com/intuit/oauth-jsclient/blob/master/src/OAuthClient.js) and [token examples](https://github.com/intuit/oauth-jsclient/blob/master/README.md). These references support protocol design; mocked responses do not establish actual vendor acceptance.

## Limits and continuation

Initial authorization redirect/state/PKCE/callbacks, actual scope/company/US-Canada token contracts, expiry/revocation behavior, transparent key rotation, approved secret custody, physical key/storage/backup residency, process termination during actual requests, production upgrades/load/fault/security/retention and human finance/security acceptance remain open. Lifetime response bounds are a local sandbox profile requiring qualification. Explicit environment-token mode remains available for separately approved short-lived sandbox setup; managed mode cannot fall back to it. Local disable does not revoke upstream access, recall an in-flight call or authorize another accounting send.

Continue accounting credit application/refund/cost/import reconciliation, initial provider authorization, individual carrier adapters, physical devices and business/source/vendor qualification. Local checks cannot supply human or infrastructure acceptance. All tasks/gates remain NOT VERIFIED and the full-system goal remains active.

Direct workstation checks and local commits only; no local/self-hosted/cloud CI job, workflow/registration, push/PR, deployment/purchase, actual provider account/request, live data, publication, settings changes or OPUS/UB integration. Future Distributor CI uses GitHub-hosted runners after separate authorization/qualification. No fresh remote-access claim.
