# Local organization ledger authorization receipt — 2026-10-03

Parent: `688416857956cac311d83e129645e23c6c7c54c6`. Branch: `codex/local-distributor-checkpoint`. Environment: macOS arm64, Node 24.16.0, disposable synthetic CA/US stores. Direct workstation verification only.

[Organization ledger authorization](../ORGANIZATION-LEDGER-AUTHORIZATION.md) adds a native sandbox connection with organization permission, exact company/client/callback binding, one-time state, exclusive exchange, independently checked CompanyInfo and atomic encrypted credential installation. Buyer acceptance and credentials remain separate. Schema 13 adds integration-owned attempt storage; explicit fresh-file upgrades preserve exact historical versions 1–12.

## Verification

Complete native checks pass 2,347/2,347 in 84,139.482291 ms, with zero failures, skips or cancellations. Focused authorization checks pass 28/28, schema upgrades 74/74 and recovery profiles 20/20. TypeScript, formatting and production build pass; the existing large-chunk warning remains. No fresh browser suite or clean full-project static diagnostic result is claimed; React/browser component bytes are unchanged.

Synthetic authorization tests cover CA/US organization authority, exact sandbox company proof, buyer-token separation, callback/state/address/secret refusal before transport, cancellation/supersession/permission withdrawal/independent credential installation, frozen binding during awaits, simultaneous callback exclusion, timeout/clock rollback, retained terminal status across restart, key-rotation scope with no installed credentials, and restore invalidation. Outbound responses use the existing HTTP seam and do not prove actual Intuit behavior.

Isolated production-only installation/build/startup/PDF/ZPL/encrypted restore passes for CA and US: 280 copied runtime inputs, 69 development-only packages absent, 27 retained command outcomes, two startup cycles per region, PDF/ZPL-8/ZPL-12 output and local encrypted restore. Expected disabled-worker/credential/authorization refusals and controlled startup termination remain individual outcomes. All 548 repository-owned source/test/configuration hashes and 280 runtime input hashes match reviewed bytes. The [machine receipt](LOCAL-ORGANIZATION-AUTHORIZATION-2026-10-03.json) binds those inputs and 28 retained private evidence hashes; raw logs, databases, credentials, generated assets and dependency installations remain excluded from Git.

## Retained failures and self-review

The initial red showed the missing native API. Expanded guard verification initially assumed key generation one before registration; it now reads the public current generation. An intermediate frozen historical fixture referenced an undefined variable; its literal version-eleven baseline is restored. The first complete native run retained 16 failures: schema-12 expectations for current recovery and historical archive fixtures that retained the newly added table. Exact schema-13 current assertions and version-specific historical layouts fix those failures, including independent version-12 archive refusal. Every failed log remains retained beside corrected outcomes.

Self-review checked integration-owned storage, fresh persisted finance authority, exact organization permission and credential revision, frozen initiating binding, constant-time digest comparison, strict callback fields, one exclusive claim, current permission/hold/key checks before HTTP and installation, company identity, cancellation/expiry/restore/rotation fences, atomic install/audit/completion and redacted metadata. Source is original work using this repository's native ownership and protocol patterns; dependencies and licenses are unchanged. No foreign project code or runtime dependency is reused.

## Preview and remaining work

The frontend at loopback 5173 and backend at loopback 3000 remain running. The previous synthetic CA schema-12 preview file is preserved; an explicit fresh-file schema-13 clone now serves the preview. Fresh frontend/direct/proxied health checks pass. Private sign-in remains ignored with mode 600; live integrations are disabled. Leave both services running.

Organization browser callback/session flow, operator authorization CLI and remote revocation remain unconnected. Actual Intuit/company outcomes, vendor terms, infrastructure residency, further journal/valuation/quantity correction, durable restore activation/fencing/routing/reconciliation/rollback, authorized Purolator contract, hardware and security/load/recovery/operator/release qualification remain open. All 44 tasks and ten gates remain NOT VERIFIED; the full system is incomplete.

Read-only GitHub checks confirm push permission, zero workflows and zero Actions runs. The reviewed source/tests/docs snapshot is authorized for a normal push on the existing codex branch. No CI runner, workflow, provider IO/account, delegated/cloud session, PR, merge or deployment is started. Exact remote equality must be checked after publication.
