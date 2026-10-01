# Local independent named carrier choices — 2026-10-01

Status: **PASS for bounded synthetic workstation checks**. Partial D-008/D-027 engineering and scoped CH-07 evidence. All 44 tasks and 10 gates remain NOT VERIFIED; full system incomplete. Reviewer: Codex source review and workstation checks, without independent customer, operator or vendor acceptance.

Parent `49eeeb1a60d76320fbf4bdc9922813e4d4edf624`, branch `codex/local-distributor-checkpoint`. The [machine companion](LOCAL-NAMED-CARRIERS-2026-10-01.json) binds candidate source/tests/configuration, documents, available logs and unchanged historical evidence. It excludes its own bytes from circular hashing. The subsequent actual local commit identifies this deliverable.

## Observed behavior

The [provider runbook](../PROVIDERS.md#customer-choice) describes eight independent choices: Stripe, QuickBooks, UPS, FedEx, USPS, Canada Post, Purolator and DHL Express. A shared stable identifier catalog supplies the exact HTTP schema and browser checkbox choices. This is application policy eligibility only; no carrier adapter, booking, rate, label, tracking request or vendor qualification is implemented by this change.

Existing `carrier` family entries and original command/audit bytes remain intact through restart. They authorize no named carrier. The browser flags the old exception and selects no carrier automatically; explicit review saves a new version. New HTTP payloads reject the family, unknown names, duplicates and extra fields. Internal authorized receipt replay can return an original historical result without restoring its superseded choice; the HTTP schema rejects legacy family payloads before replay.

Current actual active identity, organization/account access and password-change requirements precede permission and cached choice results. Editing requires actual administrator/commercial/buyer authority. Choice, version, acknowledgment, audit and receipt commit together. Injected late audit failure rolls everything back; a safe retry commits once. Two independent OS processes competing at one expected version produce exactly one choice and one revision refusal.

Tests independently select each of the eight providers, deny all others, withdraw to strict mode, replay an older choice without restoring it and retain original history after restart. A US-region fixture retains USD and rejects a CA region toggle. Choice/withdrawal leave accepted/shipped stock, orders, invoices and existing provider operations unchanged. The phone-width browser journey starts from the legacy family fixture, independently selects UPS/Canada Post, loses a committed response, retries the same key once, reloads the stored selection and withdraws both.

## Verification

| Command | Observed result |
| --- | --- |
| `npm run typecheck` | Final PASS, exit 0 |
| `npm run format:check` | Final PASS, exit 0 |
| Focused integration/identity/residency Node tests | Earlier PASS 19/19, 3905.427917 ms; before the US fixture and final additional assertions |
| Focused residency Node tests | PASS 8/8, 1314.3865 ms; before final additional native-fact/audit assertions |
| `npm test` | Final PASS 394/394, 14843.839917 ms; zero failed/cancelled/skipped/todo, exit 0; includes final assertions |
| Focused Chromium named-choice journey | Earlier PASS 1/1, 4.0 s; before final disclosure paragraph |
| `npm run test:e2e` | Final PASS 33/33, reported 1.1 minutes, exit 0; production build PASS, 137 ms; includes final disclosure paragraph |

No source/test/configuration edits after final passing checks. No failed executed test/check is observed for this change; earlier passing runs have the narrower candidate scope stated above. Temporary workstation logs are not a durable production archive. Planning links, whitespace and independent candidate/historical-evidence comparisons follow document creation and appear in the companion. Planning validation checks structure only, not product gates or remote access.

Self-review covers current authority before cached results, named independence and exact input validation, legacy history, withdrawal/replay, transaction rollback, competing processes, UI retry/reload, regional migration refusal and native-fact conservation. Dependencies, lockfile and license notices are unchanged; no third-party implementation was copied.

## Remaining qualification

Reviewed disclosure versions, processing countries/subprocessors/purposes/minimum data/retention and evidence of actual customer authority still require implementation and vendor/business qualification. A staff acknowledgment alone does not establish customer consent. This version records a free-text acknowledgment, not a reviewed disclosure document/version. Selection does not establish origin/service/account availability or authorize activating an adapter. No actual provider request or residency guarantee is claimed.

Withdrawal blocks later application permission; it cannot erase previously transmitted data or recall in-flight requests. Strict regional hosting, migration/backup/log/support/storage boundaries, real vendors/devices, production upgrades/index/load/locking/security/retention/recovery and independent human acceptance remain unqualified. Stop old application writers before upgrade; mixed versions are unqualified. No task or product gate passes from this receipt.

Direct workstation checks/local commits only. No CI jobs/runners, workflows/registrations, push/PR, actual provider request/account, deployment/purchase, live data/publication/settings change or OPUS/UB integration. Future Distributor CI uses GitHub-hosted runners after separate authorization/qualification; no fresh remote-access claim.
