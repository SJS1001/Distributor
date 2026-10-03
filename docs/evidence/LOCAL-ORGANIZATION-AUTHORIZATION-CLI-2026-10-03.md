# Local organization authorization operator receipt — 2026-10-03

Parent: `290e17387c56fe39057617a6d7fcbf7f6a0cc261`. Branch: `codex/local-distributor-checkpoint`. Environment: macOS arm64, Node 24.16.0, disposable synthetic CA/US stores. Direct workstation verification only.

[Protected organization authorization](../ORGANIZATION-LEDGER-AUTHORIZATION.md#protected-operator-authorization) now connects begin, explicit completion, status and cancellation to the existing separate native organization service. Exact reviewed organization permission, company/client/callback/worker binding and current native credential fences remain authoritative. Protected bounded UTF-8 stdin, exact operation fields, redacted errors and explicit outbound enablement keep callbacks/codes out of arguments and output. Status/cancellation ignore unavailable or invalid ambient encryption keys. Schema 13, native authorization, browser components, dependencies and retained notices are unchanged.

## Verification

Fresh full native verification passes 2,352/2,352 in 87,617.222583 ms with zero failures, skips or cancellations. Five focused operator checks pass in 9,586.078541 ms: offline begin/status/cancel; CA and US explicit completion and replay refusal; malformed/oversized/invalid-UTF-8/surplus input refusal before a new store opens; explicit enablement/client-secret/current-permission/exact-callback fences and keyless cancellation after withdrawal. Synthetic child-process HTTP responses verify exact token exchange and sandbox CompanyInfo requests, redaction, buyer credential separation and zero-request refusal/replay. No actual provider request occurred.

TypeScript and formatting pass. Planning structure/local links pass: 254 Markdown files and 1,442 local links, structure only. Isolated production build/installation/startup/PDF/ZPL/encrypted restore passes CA and US with 281 matching runtime inputs, 69 development-only packages absent and 31 individual command outcomes. The new command loads without development dependencies and refuses unset outbound enablement in both regions. Two startup cycles per region, both ZPL densities, PDF and local encrypted restore retain the existing packaging coverage. The production build retains its large-chunk warning. No fresh browser suite or clean full-project static diagnostic result is claimed.

The [machine receipt](LOCAL-ORGANIZATION-AUTHORIZATION-CLI-2026-10-03.json) binds 550 current source/test/configuration hashes and matching runtime hashes, generated asset hashes, individual runtime outcomes and 48 retained private evidence hashes. Raw logs, synthetic databases, private runtime installations, credentials, generated assets and dependency directories remain excluded from Git. Retained input hashes identify the tested bytes; documentation and synthetic checks do not establish actual provider or product acceptance.

## Failure history and self-review

The initial offline red identified the missing CLI. The first offline run found unnecessary key loading in status/cancel, which now deliberately omit the key. Completion tests initially lacked their synthetic child-process HTTP fixture; that harness failure is retained and is not claimed as an implementation red. Expanded guard and TypeScript checks found an invalid strict-choice withdrawal fixture supplying `acceptance:null`; strict choice must omit acceptance. The staged-byte audit also caught a later documentation edit to the copied runtime runbook; that edit was withdrawn, preserving the exact verified runtime bytes. Corrected results and every failed log remain retained privately.

Self-review checked exact reviewed permission, organization/buyer separation, protected raw-byte and UTF-8 limits, strict operation fields, no extra argument path, validation before new-store initialization, default-disabled explicit completion, native callback/company/current-authority fences, redacted metadata/errors and keyless offline cancellation after permission withdrawal. The test-only Node preload replaces only the existing HTTP boundary and never permits real outbound requests; production scripts do not import it. Source is original repository-local work; dependency versions and licenses are unchanged. No foreign project code or runtime dependency is reused.

## Preview, publication and remaining work

Frontend loopback 5173 and backend loopback 3000 remain running against the separate ignored synthetic CA schema-13 preview store. Providers remain disabled; private sign-in remains ignored with mode 600. Leave both services running.

Managed browser/callback controls and remote revocation remain unconnected. Actual Intuit/company outcomes, vendor terms, infrastructure residency, further journal/valuation/quantity corrections, durable restore activation/fencing/routing/reconciliation/rollback, authorized Purolator contract, hardware and security/load/recovery/operator/release qualification remain open. All 44 tasks and ten gates remain NOT VERIFIED; the full system is incomplete.

Read-only GitHub checks confirm push permission, zero workflows and zero Actions runs. The current source/tests/docs snapshot is authorized for normal publication on the existing codex branch, followed by exact remote verification. No CI runner/workflow, live provider IO/account, delegated/cloud session, PR, merge or deployment is started.

Source/tests/docs commit `9a841ca2df5a724a7813913a418dc78275aefc43` was normally pushed; exact remote HEAD equality and a clean checkout were confirmed. Staged-byte audit matched 550 tested inputs, 281 runtime inputs and 48 retained private evidence hashes. Zero workflows and zero Actions runs were reconfirmed. This publication record follows in a companion documentation commit; tested input bytes remain unchanged.
