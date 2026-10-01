# Authenticator replacement — local engineering receipt

Date: 2026-10-01. Status: PASS for the bounded local implementation described below. Partial D-008 engineering relevant to CH-07/G1. All 44 tasks and 10 product gates remain NOT VERIFIED; the full system is incomplete.

## Tested version and environment

Parent: `fd2f4ca6b8dfcdb75c99a7f524169c28b810834a`, branch `codex/local-distributor-checkpoint`. The [machine companion](LOCAL-MFA-REPLACEMENT-2026-10-01.json) binds all 216 candidate application/test/configuration files, five reviewed documentation files, actual command outcomes, private log/artifact hashes and 141 unchanged historical evidence files. Documentation and this receipt are excluded from the application candidate; the companion excludes its own hash. Application/backend inputs remained unchanged after the backend run; only exact accessible-name selectors in `tests/browser.spec.ts` changed before the final browser rerun.

Direct workstation environment: Darwin arm64, Node v24.16.0, npm 11.13.0, native SQLite with synthetic CA fixtures and Chromium, including a phone viewport. No external provider IO. Parent implementation and self-review only; no delegation, independent security review, human acceptance or current model/effort attestation is claimed.

## Behavior and coverage

Current password/revision and an exact retry key prepare an encrypted ten-minute inactive authenticator secret and ten recovery codes. Existing factor and recovery codes stay active. Confirmation requires the current password, an existing unused factor, a new authenticator TOTP and saved-code acknowledgment. One transaction consumes proofs, replaces secret/hashes, installs the new replay boundary, removes pending material, advances security revision, ends all sessions and records safe audits. Required and optional MFA remain enabled. Enrollment/recovery renewal/replacement share one pending identity with distinct encryption purposes; expiry, revision changes and restore invalidate pending material.

Focused tests exercise encrypted exact retry after restart, current identity/password/tenant checks, inactive-code rejection, both proofs, old/new replay, stale/expired IDs, wrong key/purpose, persistent throttling, late-audit rollback, encrypted restore, optional/required roles and two actual OS processes competing to confirm one replacement. HTTP coverage checks exact payloads, origin/CSRF/session/no-store/cookie behavior and subsequent login. The phone journey covers stale responses, cancellation, expiry, rejected proofs, lost preparation/confirmation replies and subsequent sign-in. These synthetic scenarios do not qualify real authenticators, production TLS, clocks, load or devices.

Parent self-review inspected fresh identity/password/revision checks, purpose-bound encryption, inactive/active separation, atomic factor/proof/replay/audit/session changes and rollback, persistent throttling, restore behavior, required-role restrictions and browser cancellation/expiry/unmount fences. No schema, dependency, lockfile or license notice changed; no third-party implementation copied.

## Actual outcomes

| Check | Actual outcome |
| --- | --- |
| Focused MFA backend (`mfa`, policy, renewal, replacement) | PASS 38/38, exit 0 |
| Focused replacement browser plus build | PASS 1/1, exit 0 |
| Full backend, 16:24:13–16:24:42 UTC | PASS 682/682; zero failure/cancel/skip/todo; 28748.031208 ms; exit 0 |
| First full browser plus build | Build PASS; browser FAIL 45/46, exit 1; retained failure below |
| Corrected full browser plus build, 16:26:07–16:27:38 UTC | PASS 46/46, reported 1.5 minutes; command 90.936235959 seconds; exit 0 |
| Final corrected type and format checks | PASS, exit 0 |
| Planning and whitespace checks after receipt creation | Actual outcomes bound by the machine companion; structural checks only |

## Retained failures and evidence limits

The first full browser run failed an existing optional-MFA removal test because its substring password selector also matched the new replacement field. Fourteen password selectors now use exact accessible names. The failure log, trace and error context were retained before the passing rerun. Earlier intermediate passes remain separate from final evidence. A continuation poll of the retired terminal session returned an unknown-process error and supplied no test evidence; the completed command's persisted exit record and log were inspected instead. No failed run counts as passing evidence.

Private artifacts live under `/tmp/distributor-mfa-replacement-checkpoint`, without an archival retention guarantee. Hashes bind observed bytes; they do not establish provider attestation or prevent administrative tampering. Historical receipts are unchanged and are not promoted into current qualification.

## Remaining scope and operating boundary

This procedure requires existing factor access. Verified lost-device/administrator recovery, actual authenticator qualification, external security-change notifications, independent security review, approved role policy, consistent runtime key/policy distribution and production TLS/throttling/clock/load/retention/residency/operator acceptance remain open. Browser cancellation does not undo a committed confirmation; interrupted confirmation must be resolved by signing in. SQLite/WAL/backup erasure, JavaScript memory zeroization and runtime-key custody limitations remain.

Direct workstation checks and local commit only. No cloud checkout/source transfer, CI runner/job/workflow/registration, push/PR, provider request/account, live data, purchase/deployment/publication/settings change or OPUS/UB integration. Future GitHub-hosted CI requires separate authorization. This receipt does not pass a product gate or complete the full objective.
