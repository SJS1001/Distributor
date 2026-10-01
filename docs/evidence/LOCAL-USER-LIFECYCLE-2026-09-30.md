# Local user lifecycle checkpoint and planning/access review

Date: 2026-09-30 America/Toronto, continuing into 2026-10-01 UTC. Local uncommitted files with no Git HEAD; Darwin 27 arm64, Node 24.16.0/npm 11.13.0, native SQLite WAL/FULL, local Chromium and disposable synthetic databases. All 44 tasks/10 product gates remain NOT VERIFIED.

## Candidate and executed outcome

Identity-owned administrator grant/status edits, reset and session revocation; self password change/session termination; forced initial/reset password change; credential-free scoped summaries; security revisions; last-active-administrator protection; atomic audit/receipt/session changes. Warehouse/account validation uses owning interfaces. Login rereads credentials/status within its session/audit transaction. Failed-authentication counters increment atomically rather than overwriting concurrent failures. See [access runbook](../USER-ACCESS.md), [contracts](../CONTRACTS.md) and [implementation limits](../IMPLEMENTATION.md).

Final checks: typecheck and formatting PASS (exit 0); full Node suite 96 PASS, zero failures/cancellations/skips, 7178.704041 ms; production build PASS (65 ms), 12 Chromium journeys PASS (19.6 seconds). Final planning structure/link outcome and exact current candidate hashes are in the [machine receipt](LOCAL-USER-LIFECYCLE-2026-09-30.json). No source behavior changed after these final checks.

Nine focused identity tests previously passed (3321.928083 ms); all are included in the final full suite. They verify two actual-process races: competing administrators cannot remove all active administrators, and identical grant updates commit one revision/audit/receipt. An injected late final-audit error restores the original password, sessions, revision and receipt state. Other coverage includes current authority before cached results, stale revisions and key conflicts, organization/site/account scope, inactive-login denial/reactivation, eight failed current-password attempts with expiry, forced-password worker/workspace restriction, CSRF/strict input, self changes and no credential/session material in summaries or command/audit records. Concurrent authentication failure counting is an atomic-source improvement, without a dedicated competing-failure timing test.

The twelfth browser journey provisions a warehouse user, changes the initial password, signs in on two devices, discards a committed grant response and retries one original key, verifies one audit/revision and both sessions ended, deactivates/reactivates, resets/replaces credentials, revokes both sessions and ends all own sessions. Browser fixture versions advance 1→2→3→4→5→6→7→8 through those actions. No page errors were observed. Automated users are not human security approval.

## Preserved failures and superseded results

- Three initial typecheck failures: extra JSX parentheses (TS1005/TS1381); generic command result property access (TS2339); generic SQL row projection losing named DTO fields (TS2339). Corrected syntax, guarded result shape and explicitly selected credential-free user fields.
- First browser run: 11 PASS/one FAIL, 20.3 seconds. The displayed grant revision predated the user's forced password change. STALE_USER/409 correctly rejected it. The test now refreshes and waits for the current revision before grant/revocation reviews; no version invariant was weakened.
- Second browser run: 11 PASS/one timeout, 1.3 minutes. Trace reached administrator revocation v8, then waited for Continue on a fieldless own-session confirmation displaying Close. Added the explicit End sessions action label and matched that label in the test.
- Intermediate 96-test run passed at 7480.630542 ms. An intermediate 12-journey run passed at 19.5 seconds before the final atomic failure-counter improvement. Both are superseded by the final-candidate checks above. Historical receipts and failed outcomes remain preserved.

## Planning and repository review

The reviewable planning package records US/Canada, USD/CAD, Stripe, QuickBooks, major carrier/device candidates and customer choice separately for each named external-provider residency exception. Strict regional application storage is separate from those exceptions; actual storage/backup/log/support/processor locations and specific devices/services need qualification. Planning completion does not pass discovery or a product gate.

Authenticated read-only CLI/API checks confirm SJS1001, public active SJS1001/Distributor, default main and pull/push/admin/maintain/triage permissions. Actions is enabled, allowed actions all, required SHA pinning false; workflow count zero. Origin matches the requested repository and successful git ls-remote returns zero refs. Future sjsmithbot PR identity remains unverified.

Distributor uses GitHub-hosted runners under the explicit repository exception. No workflow/registration, repository settings change, push, PR, publication, actual provider request/account, purchase, live data, deployment or OPUS/UB integration occurred. Hosted OS/capability/security/usage/cost qualification remains pending before the first workflow. Local tests are not hosted CI evidence.

## Limits and continuation

MFA, approved credential delivery/invitations, verified email changes, forgotten-password/admin recovery, password screening, distributed abuse protection, device metadata, human approval duties and production schema/restore/security qualification remain open. Provider OAuth/secret lifecycle, refunds/accounting reconciliation, customer document delivery, camera/labels, complete historical migration and production load/fault/cutover/residency/device qualification also remain incomplete. Full-system goal is active. Preserve independent module ownership and historical evidence; no product readiness claim follows from local passes.
