# Local managed provider key rotation — 2026-10-01

Partial D-008/D-034/D-036/D-037 engineering affecting G1/G7/G8. All 44 tasks and ten gates remain **NOT VERIFIED**; the full system remains incomplete. Reviewer: Codex automated synthetic checks, without independent human finance/security/operator acceptance. Parent local commit `5b5f2591f0e6b6d4430e22ef5587153647fa64ca`, branch `codex/local-distributor-checkpoint`. The [machine receipt](LOCAL-PROVIDER-KEY-ROTATION-2026-10-01.json) binds source/test/configuration, documentation, direct workstation logs and historical evidence. See [the operator procedure](../PROVIDERS.md#managed-credential-key-rotation).

Previously each managed binding used one runtime encryption key without a persisted generation. Integration now records a domain-separated key fingerprint/generation and refuses a key or process generation inconsistent with that marker. Initial legacy installation/authorization proves every existing encrypted material before registering/using a key; first encrypted installation registers generation one in the same transaction as ciphertext/audit. Metadata status does not itself prove legacy decryption.

Operator rotation requires a distinct 64-character hexadecimal replacement key through protected stdin, inspected generation, restore clearance and current active finance authority for every organization with credentials or pending/exchanging OAuth. It refuses refresh/exchanging claims, corrupt material, stale generation and invalid scope. An exclusive database transaction re-encrypts all ready credentials under new nonces/revisions, advances disabled/unknown revisions without reviving material, cancels pending OAuth, advances generation and records per-organization metadata audits. Lifetimes/hard deadlines are unchanged. Any failure rolls everything back. The runtime switches/zeros its old key after commit; no credentials or fingerprint are exposed through the CLI result or audits.

## Observed verification

| Direct workstation command | Actual outcome |
| --- | --- |
| `npm run typecheck` | PASS; final log retained. |
| `npm exec -- tsx --test tests/provider-rotation.test.ts tests/provider-credentials.test.ts tests/quickbooks-authorization.test.ts` | 38/38 PASS, 3371.184875 ms; zero fail/cancel/skip/todo. |
| `npm test` | 287/287 PASS, 12520.036416 ms; zero fail/cancel/skip/todo. |
| `npm run format:check` | PASS. |
| `npm run test:e2e` | Production build PASS (145 ms); all 23 existing Chromium journeys PASS (47.1 s). No new browser journey. |

Environment: macOS arm64, Node 24.16.0, SQLite 3.53.0, npm 11.13.0. Isolated temporary synthetic databases, loopback headless browser and intercepted fetch only. No actual provider request occurred. Planning/link and whitespace results/hashes are recorded separately in the machine companion; those checks establish document consistency only.

Ten new rotation scenarios establish multi-binding token/deadline preservation and nonce/revision changes; no plaintext secrets in persisted SQLite/journal/audit/status evidence; same-process/restarted key fencing including A→B→A reuse; corrupt-last-binding and late-audit rollback of all earlier writes/cancellation/marker; current worker/password/restore/generation/same-key/duplicate-scope refusal; active/abandoned refresh and OAuth exchange contention; finance authority for both credential and pending-only foreign organizations; legacy wrong-key refusal and oversized vault refusal; an independently initialized OS process failing a late install after key reuse; actual protected-stdin CLI metadata/recovery/redacted malformed-input rejection; and a held intercepted refresh blocking rotation before completing once, followed by successful rotation and refresh under the replacement.

The independent process tests use a ready barrier, distinct SQLite connection and real child process, not two objects claimed as separate processes. Late audit failure rolls back ciphertexts, revisions, marker, pending cancellation and prior audits together; subsequent old-key access remains valid. Original deadline checks still refuse expired material. These tests cover local functional failure/concurrency behavior; they are not production termination, custody, load or vendor acceptance evidence.

## Preserved failures and review

The initial new focused run passed 8/9 and failed because synthetic setup referred to nonexistent `iam_orgs` (`focused-1`, 2899.858958 ms). The second passed 8/9 and failed on duplicate `iam_users.email` (`focused-2`, 2548.845 ms). Both logs remain preserved. Corrected setup uses the actual `iam_organizations` schema and unique synthetic user email, includes the foreign customer account and adds pending-only organization coverage. Subsequent 38/38 focused checks and the full regression pass. No production fix was inferred from those fixture failures.

An intermediate status read requested nonexistent `/tmp/distributor-provider-rotation-test-1.log`; the actual full regression log is `...-regression-1.log` and its complete pass was subsequently inspected. This reporting lookup did not run tests or change source. Existing browser logs include environment color warnings, with build/journeys passing.

Self-review checked owning-table access, transaction boundaries, ciphertext/AAD/nonces, generation fencing after key reuse, legacy proof before provider I/O, cross-organization current authority, claim refusal, rollback/runtime key swap, preserved deadlines and metadata/error secrecy. Dependencies, lockfile and license notices are unchanged; no third-party code was copied. Historical receipt bytes remain unchanged against the parent.

## Limits and continuation

Stop/upgrade all binaries before first migration/rotation: earlier binaries do not implement generation fencing. After commit, distribute the replacement through separately qualified custody and restart API/workers/operators. There is no automatic key distribution, upstream revocation, client-secret rotation, lost-key reset, marker downgrade or automatic rollback. A lost response requires inspecting generation under the replacement/current keys; this command has no separate replay receipt. Status/disable and OAuth cancellation remain available under current identity controls.

The procedure refuses more than 100 distinct organization authorities or 1,000 bindings. Initial legacy ciphertext verification still scans all material before the rotation bound; bounded inputs are not a latency/capacity guarantee. Old ciphertext may remain in journals/backups. Key custody, incident recovery, encrypted storage/retention, migrations, real termination/restart races, provider contracts and actual US/Canadian hosting/security/residency/human finance acceptance remain unqualified. Named customer choice is still required for actual provider processing; local encryption rotation does not grant permission to transmit data.

Direct workstation verification/local commits only: no local/self-hosted/cloud CI jobs, workflows/registrations, pushes/PRs, actual provider accounts/requests, deployments/purchases, live data, publication/settings changes or OPUS/UB integration. Future CI remains GitHub-hosted after separate authorization/qualification. No fresh remote access claim. Continue accounting refund/import identities, provider revocation/qualification, individual carrier/device support, production operations and independent human business/source/vendor acceptance.
