# Local required role MFA — 2026-10-01

Status: PASS for bounded local engineering; full system incomplete. Partial D-008 engineering relevant to CH-07/G1. All 44 tasks and 10 product gates remain NOT VERIFIED.

Parent: `41ff877197e2e593e1f037f727b412cb443799be`; branch `codex/local-distributor-checkpoint`. The [machine companion](LOCAL-MFA-POLICY-2026-10-01.json) binds candidate/document hashes and command intervals/outcomes/private logs. Parent implemented and self-reviewed this checkpoint; no delegated, independent security or human acceptance claimed.

## Behavior and review

The HTTP runtime accepts exact distinct known `MFA_REQUIRED_ROLES` with a valid encryption key, before database opening. An unset/empty policy preserves optional enrollment. Each session lookup derives the restriction from the user's current role and enabled factor, including an existing password session after policy restart. Forced password change precedes enrollment; each change ends sessions. Restricted sessions may read their session/security, sign out, enroll/confirm, change their own password or end their sessions. The central HTTP hook denies other business routes and preserves origin/CSRF requirements.

Enabled-factor login continues to verify authenticator/recovery proof before creating a session. Activation revokes all prior sessions. Required-factor removal returns `MFA_POLICY` before consuming recovery proof, changing revision or revoking sessions; the UI hides removal and explains the requirement. Native modules/workers are a separate trusted service boundary. Runtime configuration is not a database/backup policy record. See the [operator runbook](../USER-ACCESS.md#required-role-policy) for uniform deployment requirements and recovery gaps.

Parent reviewed policy parsing/key validation, immutable copied configuration, current identity/session projection, transactional removal checks, existing factor login/revocation, global HTTP allowlist, forced-password precedence and browser lifecycle. No source/test/configuration edit followed final checks. No schema, dependency, lockfile or license changes; no third-party implementation copied. All 137 historical evidence files remain byte-identical to the parent baseline.

## Local checks

- Full `npm test`: PASS 660/660, zero fail/cancel/skip/todo, 22849.17725 ms, exit 0.
- Full `npm run test:e2e`: production build PASS; Chromium PASS 44/44, reported 1.4 minutes, exit 0. New phone required-MFA journey: 1.1 seconds.
- Focused MFA backend: PASS 21/21, exit 0; focused required-MFA browser/build: PASS 1/1, exit 0.
- Final type and format: PASS, exit 0. Planning structure and whitespace outcomes are recorded in the companion after receipt creation; these do not qualify product workflows.

Four added backend tests reject unsafe startup before database creation (including actual invalid-key HTTP entrypoint), check sampled business read/write denial and mutation origin/CSRF, complete enrollment and factor login, deny required removal without consuming another recovery code or revoking the session, exercise existing sessions after policy restart/current-role change and copied-policy mutation, and enforce forced-password precedence with own-session termination. The full suite also reruns existing optional MFA/throttle/replay/cleanup/recovery tests. These are synthetic CA fixtures, not a regional infrastructure test.

The new 390-pixel browser journey checks no dashboard/users/stock requests during required enrollment, direct dashboard denial, failed security read/retry, reload, cancellation of a paused security read on sign-out and refusal of its late response, no password/secret/codes in browser storage, no horizontal overflow, enrollment/revoked session, factor-required sign-in using one recovery code, required status/no removal and no browser exceptions. Full regression reruns optional enrollment/removal. Local UI/API tests do not establish authenticator hardware/app compatibility or production attack resistance.

## Retained failures and qualification limits

Private artifacts: `/tmp/distributor-mfa-policy-checkpoint`; hashes in the companion, without archival retention guarantee. Initial focus passed 3/4 due to incorrect forced-password fixture property; after correcting it, two focused attempts passed 3/4 because the password-change payload used `newPassword` instead of `password`. Both fixture errors were corrected before the final focused/full checks. A UI edit assertion failed before mutation, and a nonexistent process poll supplied no evidence; actual terminal logs/results establish completion. Earlier type/partial/failing runs remain historical, never final qualification.

Approved role selection, uniform policy/key distribution across processes and restored environments, actual authenticators, factor replacement/recovery-code replenishment and verified lost-device/administrator recovery remain open. Required users cannot use optional remove/re-enroll replenishment; removing a runtime requirement is not a recovery procedure. Production TLS, independent security review, distributed throttling, clock/load/locking/retention, actual infrastructure/key residency and operator acceptance remain unqualified. No gate, release or full-system readiness is claimed.

Direct workstation checks/local commit only. No cloud checkout/source export, CI runner/job/workflow/registration, push/PR, provider request/account, live customer data, deployment/purchase/publication/settings or OPUS/UB integration occurred.
