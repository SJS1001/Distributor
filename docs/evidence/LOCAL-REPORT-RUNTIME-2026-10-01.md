# Local runtime reporting configuration — 2026-10-01

Status: PASS for bounded local engineering; full system incomplete. D-010/D-011/D-036/D-039, optional-consumer independence and recovery restart. All 44 tasks and 10 product gates remain NOT VERIFIED.

Parent: `b33170151ad7ccf51c7fc02e135d4d8c51f10dcb`; branch `codex/local-distributor-checkpoint`. The [machine companion](LOCAL-REPORT-RUNTIME-2026-10-01.json) binds the tested source, configuration, tests, final runbooks, command intervals/results and private log hashes. Parent performed implementation and self-review; no delegated review or human acceptance is claimed.

## Changed behavior

The shared parser accepts exactly `EVENT_REPORTS=enabled|disabled`, with enabled compatibility default. HTTP startup, bootstrap/demo, provider worker, credential operations and QuickBooks authorization pass it into application construction. Invalid values fail before application database opening and are not echoed. The event worker also requires its separate batch permission; disabled registration refuses before database access and cannot be overridden by `LOCAL_EVENT_REPORTS=enabled`.

Disabled startup preserves a report-disabled schema or historical report-enabled tables/receipts/pending events. Enabled startup may install the supported optional profile atomically. No schema DDL, package dependencies, lockfile, license notices or third-party implementation changed. No provider request is made by these tests.

## Actual checks

Direct workstation: Darwin arm64, Node v24.16.0, npm 11.13.0, native experimental SQLite, synthetic local CA/CAD and US/USD stores. HTTP checks run actual child processes on loopback with provider access disabled; process completion is awaited, with bounded failure cleanup.

- Full `npm test`: PASS 649/649, zero fail/cancel/skip/todo, 21352.51675 ms, exit 0. Command interval and full log hash are in the companion.
- Focused `node --import tsx --test tests/report-runtime.test.ts tests/event-delivery.test.ts tests/recovery-profiles.test.ts`: PASS 32/32, zero fail/cancel/skip/todo, 8433.75125 ms, exit 0.
- Typecheck, format and production build: PASS, exit 0.
- Final planning and whitespace validation are recorded in the companion after receipt creation.

The eight new tests cover exact/ambiguous configuration, all six runtime entry points rejecting invalid values without creating files, CA/US bootstrap and repeated HTTP startup, both stored profiles through all operator commands, historical reports and pending delivery preservation, encrypted report-disabled recovery through normal HTTP startup retaining provider hold, and explicit install/batch permission separation. Stored schema receipts, event rows, report rows, delivery rows and permanent receipts are compared with independent read-only SQLite snapshots. Native currency and administrator sign-in survive disabled startup. Provider credentials status is read without configured secrets; authorization uses an absent synthetic attempt and cannot initiate an exchange.

Parent reviewed every changed runtime construction site, parser error behavior and test failure cleanup; recovery/schema CLIs continue their exact snapshot-profile procedures. Tests run without inherited provider settings. No frontend code changed: the preceding Chromium 42/42 result is historical and was not repeated.

## Retained failures and limits

Private artifacts: `/tmp/distributor-report-runtime-checkpoint`, hashes in the companion; no archival retention guarantee. Initial typecheck failed on a test actor-field typo; the first focused run passed 2/6 with four failures from a wrong test outbox table name. These were test assumptions and corrected before final checks. Intermediate 6/6 passed before additional stored-profile/recovery coverage; retained separately. No failed or superseded run is counted as final evidence. All 133 preceding evidence files remain byte-identical to the parent commit.

Environment configuration must be exported consistently; `.env.example` is not automatically loaded. Omitting the setting retains enabled behavior and may install reporting. Disabling does not delete retained tables/events, revoke provider credentials, clear a recovery hold or qualify physical residency. No scheduler, cloud checkout, CI runner/job/workflow/registration, push/PR, actual provider request/account, deployment/purchase, live customer data, source publication/settings or OPUS/UB integration occurred.

Production schema/cutover compatibility, workload and clock faults, regional infrastructure/key custody/retention, real providers/devices, RPO/RTO and operator acceptance remain open. Reverify after runtime/configuration or schema changes. This receipt is not G1/G7/G8 qualification, human sign-off or release authority.
