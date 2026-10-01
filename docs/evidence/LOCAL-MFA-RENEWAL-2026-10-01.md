# Local recovery-code replacement — 2026-10-01

Status: PASS for bounded local engineering; full system incomplete. Partial D-008 engineering relevant to CH-07/G1. All 44 tasks and 10 product gates remain NOT VERIFIED.

Parent: `0c7f691fd1782138503af639394ac5a49ca290b9`; branch `codex/local-distributor-checkpoint`. The [machine companion](LOCAL-MFA-RENEWAL-2026-10-01.json) binds candidate/document hashes, command intervals/outcomes and private logs. Parent implemented and self-reviewed; no delegation, independent security approval or human acceptance claimed.

## Behavior and review

An enabled user prepares ten inactive random 128-bit recovery codes with their current password, security revision and scoped retry key. The encrypted bundle expires after ten minutes. Exact-key retry returns the identical bundle across server restart; new preparation replaces the pending confirmation identity. Current unused codes remain active until confirmation. Existing enrolled factors and required-role policy are retained.

Confirmation requires current password, saved acknowledgment and an existing unused recovery or authenticator code. One transaction consumes proof, replaces hashes, deletes pending material, advances the security revision, revokes every session and writes safe audit. A late audit fault rolls everything back. Distinct valid proofs from two OS processes cannot both confirm one renewal. Authenticator authorization advances its replay boundary; invalid proofs persist in shared authentication throttling. Encryption is bound to organization/user and a separate `pending-recovery` purpose. Existing expiry cleanup, revision invalidation and isolated restore discard pending material. Restore invalidates copied recovery codes and retains the authenticator with its replay hold.

HTTP routes enforce current session, strict payload, origin/CSRF and no-store responses; successful confirmation clears the calling cookie. Plaintext codes are excluded from audits and ordinary command results. The phone UI keeps codes and credentials in component memory, clears them on expiry/cancel/sign-out, refuses already-expired responses and fences late reads. Canceling a request cannot undo a committed server operation. Lost preparation responses retry exactly; interrupted confirmation is resolved by signing in with retained factor access or saved new codes. Delivered confirmation clears secrets and returns to sign-in.

Parent reviewed fresh identity/password/revision checks, purpose-bound encryption, inactive/active code separation, proof consumption and rollback, session/replay/throttle boundaries, required-role behavior, restoration and browser lifecycle. No source/test/configuration edit followed final checks. No schema, dependency, lockfile or license change; no third-party implementation copied. All 139 historical evidence files remain byte-identical to the baseline.

## Local checks

- Full `npm test`: PASS 670/670, zero fail/cancel/skip/todo, 26553.716834 ms, exit 0.
- Full `npm run test:e2e`: production build PASS; Chromium PASS 45/45, reported 1.6 minutes, exit 0.
- Focused MFA tests, corrected focused phone journey, final type and format checks: PASS. Planning/whitespace checks follow document creation and are bound in the companion.

Ten new backend tests cover retry/restart, activation/revocation, current password/acknowledgment, expiry/replacement/revision invalidation, tenant/purpose refusal, late rollback, persistent throttling/wrong key, exact HTTP access, authenticator replay, encrypted restore and competing actual OS processes. Synthetic CA fixtures do not qualify regional infrastructure or production concurrency/load.

The new 390-pixel browser journey covers required enrollment and retained-factor renewal, cancel/sign-out during committed preparation, synthetic near/past expiry, exact retry after a lost preparation response, acknowledgment enforcement, browser storage/overflow/errors, lost committed confirmation and new-code sign-in, followed by delivered confirmation and another sign-in. Browser deadline manipulation tests the UI; backend tests separately enforce server expiry. Full Chromium reruns existing optional/required MFA and native product journeys.

## Retained failures and qualification limits

Private artifacts: `/tmp/distributor-mfa-renewal-checkpoint`; hashes in the companion, without archival retention guarantee. Initial focused tests passed 4/7 because three assertions expected incorrect denial codes; corrected expectations use the established `REAUTHENTICATE`, `FORBIDDEN` and `RATE_LIMIT` contracts. Initial browser focus failed because its login helper tried to fill a factor field before password submission requested it. The helper was corrected and its trace/error context retained. Two nonexistent/retired process polls supplied no evidence; terminal result records and logs establish actual outcomes. Earlier failing/partial/intermediate checks remain historical.

The first evidence-generator audit stopped before writing the companion because the test-candidate capture omitted two unchanged tracked paths, `.gitignore` and `vite.config.ts`. Both were verified against the parent baseline and explicitly added to the evidence binding. No application source changed; the corrected audit validates candidate, document, historical and private-artifact hashes.

This requires existing factor access. Required-role authenticator replacement, verified lost-device/administrator recovery, actual authenticator qualification, external security-change notifications and independent security review remain open. Production runtime policy/key distribution, TLS, distributed throttling, clock/load/locking/retention, physical SQLite/WAL/backup erasure, key/storage residency and operator acceptance remain unqualified. Component clearing is not memory zeroization; browser scheduling can delay timers, while the server decides expiry. No gate, release or full-system readiness is claimed.

Direct workstation checks/local commit only. No cloud checkout/source export, CI runner/job/workflow/registration, push/PR, provider request/account, live customer data, deployment/purchase/publication/settings or OPUS/UB integration occurred.
