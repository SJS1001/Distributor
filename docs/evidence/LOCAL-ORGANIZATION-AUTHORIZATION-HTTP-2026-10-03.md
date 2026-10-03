# Local organization authorization HTTP receipt — 2026-10-03

This incremental local candidate adds organization QuickBooks authorization HTTP controls and live initiating-login binding. All 44 tasks and ten gates remain NOT VERIFIED; Distributor is incomplete. Parent: `fb593d87038b08a3e08e68e125527f89106497f9`, branch `codex/local-distributor-checkpoint`.

## Behavior and verification

Organization attempts require the exact initiating live finance login, fixed organization/company/client/worker/callback, separately reviewed current organization permission and credential revision. Logout, changed role/password/MFA, replaced/withdrawn permission, cancellation and disconnect fence later provider responses. Local disconnect atomically disables this binding's material, cancels all its pending/exchanging attempts and audits the human separately from the worker. Metadata/cancel/disconnect are keyless offline. Operator/buyer authority cannot substitute for a browser attempt. Configuration is dedicated and disabled by default. Once validated, organization-only startup needs no buyer-provider credentials; configured buyer credentials still follow existing validation.

Fresh final full native checks pass **2,379/2,379** in **87,546.723042 ms**, with zero failures, skips or cancellations, on macOS arm64/Node 24.16.0. The final focused startup/provider regression passes 33/33, including actual process startup with organization-only configuration and no encryption key. TypeScript and formatting pass. Tests use disposable synthetic CA/US stores and intercepted provider HTTP, including token/company late-response fences, exact live login, strict schemas, Origin/CSRF, role/security checks, audit identity, query/header/body log redaction and built-static callback refusal. No actual provider request occurred.

Isolated production build/install/startup/PDF/ZPL/encrypted restore passes CA/US: **282 matching runtime inputs**, **69 development-only packages absent**, **31 individual command outcomes**, two startup cycles per region, PDF and both ZPL densities. Expected disabled worker/authorization refusals and controlled process shutdown remain explicit in the machine outcomes. The production build retains the existing large-chunk warning. No fresh browser suite or clean full-project static diagnostic result is claimed. Planning structure/local links are checked separately and do not verify business decisions or gates.

The [machine receipt](LOCAL-ORGANIZATION-AUTHORIZATION-HTTP-2026-10-03.json) binds **554 tested input hashes**, runtime inputs/generated assets, actual command outcomes and retained private evidence hashes. Raw logs, synthetic databases, credential files, runtime installations, dependencies and generated assets remain excluded from Git. Schema 13, dependency versions/licenses and React component bytes are unchanged. Source is original repository-local work.

## Retained failures and self-review

The initial missing-adapter harness, strict reviewed-choice fixture failures, missing-disconnect/insecure-origin/static-callback behavior reds, audit assertion using `user_id` instead of public `actor_id`, initial format failure and actual organization-only main startup failure remain private alongside corrected results. Earlier 2,378/2,378 native and runtime success predate the startup fix; their manifest/receipt/logs are preserved and superseded by final verification above.

Self-review checked fresh human and worker authority, immutable configuration and reviewed permission, exact state/login/code binding, separate credential scopes, encryption/revision/claim fences, atomic local disconnect, redacted logs/errors and keyless offline operation. `GET /quickbooks/organization/callback` deliberately returns 503/no-store/no-referrer without exchanging or echoing a code, even with a static build. The dedicated callback/panel UI, query scrubbing and human interaction verification remain dependent work; keep `QUICKBOOKS_LEDGER_BROWSER_AUTH_ENABLED=false`. Local disconnect does not claim upstream token revocation.

## Preview and publication

Frontend `http://127.0.0.1:5173/` and backend `http://127.0.0.1:3000/api/health` remain running against the separate ignored synthetic CA schema-13 preview store. The backend was refreshed with the final verified source. Fresh frontend/direct/proxied health checks pass; external providers/carriers and both browser authorization flags remain disabled. Private sign-in stays ignored, mode 600, and was never read or published. Leave both services running.

Read-only GitHub checks confirm push permission, zero workflows and zero Actions runs. Normal source/tests/docs publication on the current branch is owner-authorized; exact remote verification follows. No CI runner/workflow, actual provider IO/account, new delegated/cloud session, PR, merge or deployment was started.

Dedicated organization UI/remote revocation, further journal/valuation/quantity correction, durable restore activation/fencing/routing/reconciliation/rollback, current authorized Purolator contract and actual provider/company/device/residency/security/load/recovery/operator/release qualification remain open. No full-system completion or product gate is inferred.
