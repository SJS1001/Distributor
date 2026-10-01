# Local atomic schema startup and reviewed upgrade receipt

Date: 2026-10-01. Parent `d93cd0ce926eb0c01bae96abed15f275eb40dc75`; branch `codex/local-distributor-checkpoint`. Candidate is the local file set bound by the [machine companion](LOCAL-SCHEMA-UPGRADES-2026-10-01.json), not an unspecified later HEAD. Tasks D-009/D-036/D-037/D-039 receive bounded engineering evidence only. All 44 tasks/10 gates remain **NOT VERIFIED**; full system incomplete.

## Environment and authority

macOS arm64 workstation, Node v24.16.0, npm 11.13.0, local SQLite and loopback headless Chromium; synthetic data/adapters. Direct workstation checks and local commits only. No cloud repository checkout, CI runner/job/workflow/registration, push/PR, actual provider account/request, live data/publication/settings, deployment/purchase or OPUS/UB integration. Future Distributor CI remains separately authorized GitHub-hosted work. No fresh remote access claim.

Three bounded local sessions completed with launch/runtime-verified model settings: GPT-6 Astra / High for schema architecture/ownership and independent adversarial review, GPT-6.1 Sol / Medium for focused tests. Parent runtime last verified GPT-6.1 Sol / High at 2026-10-01T15:07:39.506Z. Responsibilities, launch manifests, events, completion and verification artifacts remain locally under the paths hashed in the companion; these are not CI runners.

## Tested behavior

Atomic whole-application startup covers constructors/backfills, owner savepoints, sticky caught failure/thenable rollback, receipt publication, optional report installation and restart. Exact frozen preceding/current profiles reject unknown/future/drifted/unversioned nonempty stores before constructors. Timestamp validation rejects impossible dates while accepting a real leap day. Recovery independently rejects corrupt/missing current receipts before encrypted archive publication.

Read-only inspection and reviewed native SQLite backup preserve committed WAL and business table rows, identifiers, sessions, encrypted credentials, uncertain outcomes, receipt/cursor state and recovery holds in a fresh private clone. Only exact supported schema/version/hash/region passes; publication is synchronized, 0600 and exclusive. Fixtures cover competing OS-process publishers, real OS termination during late startup DDL and supported restart, symlinks/existing destination/sidecars, wrong hash/region, unsupported or damaged receipts, failure cleanup and optional report retention. No source application constructor or provider operation is invoked during cloning. Schema hashes identify bytes, not administrator tamper resistance.

Four deliberately incomplete synthetic module fixtures now use their owning constructors before Application restart. They do not establish compatibility with arbitrary historical production schemas. Event process tests now store effects in the supported native EventReport table while retaining interruption, deduplication and competing-worker assertions. Frozen baseline bytes match the preceding release extraction; there are no dependency/lockfile/license changes or third-party implementation copies.

## Verification

| Check | Outcome |
| --- | --- |
| Final full backend, `npm test` | PASS 633/633; zero fail/cancel/skip/todo; 20123.491208 ms; exit 0; 15:04:42–15:05:02 UTC |
| Production build and full Chromium, `npm run test:e2e` | PASS build and 42/42 browser tests; exit 0; 15:04:42–15:06:11 UTC |
| Final focused parent | PASS 75/75; exit 0 |
| Final type / format | PASS; exit 0 |
| Independent corrected focused / ownership / contention safety | PASS 25/25 focused, zero fail/cancel/skip/todo; 6505.126584 ms; all three commands exit 0 |

The companion binds exact commands, times, exit codes and log hashes. All source/test changes preceded final backend/browser/type/format runs. Planning/whitespace checks follow documentation/evidence completion and are recorded in the companion. Logs remain in private temporary directories and are not bundled into the repository; hashes identify them but do not guarantee future retention.

Independent review completed at 15:04:52 UTC with no remaining actionable findings in its bound candidate. It reproduced one P3 impossible-date receipt defect; the parent corrected it and added impossible-day/non-leap-day and valid-leap-day regressions, independently rerun. The completion binding covers affected source/tests; the runbook later adds the final evidence link/results only. Parent reviewed the remaining process-fixture integration and full-suite outcome.

## Retained failures and limits

Initial full backend failed: 621/629 passed, eight failed. Four synthetic constructor fixtures used redundant outer transactions; four process fixtures added an unsupported test-only table. Corrections retain the business assertions. Intermediate core/test failures, impossible-date reproduction, reserved savepoint-name fixture error and a stronger assertion that both simultaneous fresh starts always succeed are retained and hashed; none counts as passing. Concurrent first startup can return database locked for one process. Independent safety/retry probes found valid unchanged winning stores and successful later restart; no automatic retry or production concurrency guarantee is made.

Operators must stop old writers/consumers, trust ancestor storage paths and separately reconcile/authorize activation. A snapshot does not fence later writes or establish writer authority. SIGKILL/power loss may leave private plaintext staging; final synchronization failure may leave a destination despite a command error. Existing encrypted recovery requires the full report-enabled schema; report-disabled recovery and pre-version archives need separately tested procedures. No disk/power-fault, production size/load/security/retention, rolling compatibility, cutover/RPO/RTO, actual provider/device/residency or human qualification. No gate is passed and no deployment is authorized.
