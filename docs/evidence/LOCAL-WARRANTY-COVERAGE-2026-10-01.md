# Sold serial coverage lookup — local engineering receipt

Date: 2026-10-01. Status: **PASS for the bounded local checks below**. Partial D-008/D-030/D-031 engineering relevant to CH-06/CH-07, REQ-03/REQ-17 and G1/G6. All 44 acceptance tasks and 10 product gates remain **NOT VERIFIED**. Full system completion and production readiness are not established.

Parent `c755b2383c0b1d5f9ff89b0c328887b4a48a2fd1`; branch `codex/local-distributor-checkpoint`. The [companion content record](LOCAL-WARRANTY-COVERAGE-2026-10-01.json) binds 234 application/test/configuration/license inputs captured at `2026-10-01T19:57:08.662331+00:00`, final documents, actual command/log hashes and 157 unchanged historical evidence files. A subsequent local commit includes this receipt; content hashes identify the tested version without a self-referential commit field. Parent agent implementation and self-review only; no independent review or human sign-off.

## Environment and scope

Direct workstation commands in `/Users/stevensmith/Documents/Distributor`, macOS arm64, Node v24.16.0, npm 11.13.0, repository-pinned dependencies, disposable native SQLite fixtures and local Chromium. Synthetic Canadian fixtures use actual native sale, shipment, claim, replacement and resale operations. No schema, dependency, lockfile or license change; no third-party source import. No delegation, CI runner/job/workflow, cloud source transfer, push/PR, actual provider request/account, deployment, purchase, publication, live data or OPUS/UB integration.

## Expected and observed behavior

- Sold serials resolve the current account's native shipment/invoice. A synthetic shipment at `2024-02-29T12:00:00.000Z` plus 365 UTC days ends at `2025-02-28T12:00:00.000Z`. Assessment immediately before shipment reports before_start, at shipment reports within_dates, and at the end reports elapsed. Every result explicitly requires review and reports unapproved policy. An elapsed claim still submits; date presentation does not approve or deny eligibility.
- Read snapshots across warranty, platform, inventory, fulfillment and billing remain unchanged; an application/database restart returns the same result with a fixed synthetic assessment clock. Current actual role, active status, password requirement and customer account govern reads. Forged actor properties do not restore access, changed grants reject earlier account access, and warehouse/finance/support roles reject. Existing authority tests also exercise the new read under actual current-identity restrictions.
- Changing provisional duration from 365 to 730 days changes the ordinary-sale preview while the existing claim retains its original end. A reserved replacement has no sold entitlement. Actual replacement handover inherits the original claim end and shipment even when the current duration becomes malformed. Restocking and ordinarily reselling the original serial creates a new customer's shipment/invoice; the former buyer cannot access that sale.
- Negative, fractional, string, null and over-limit duration values reject preview and new claim submission without retained writes. Zero days is supported. Invalid and noncanonical shipment timestamps and calculated date overflow reject without retained facts. These are engineering input checks, not approved business coverage rules.
- Authenticated HTTP coverage reads use strict required inputs, reject missing/unknown/duplicate query fields, return no-store and deny a revoked session. Returns opens the panel without a coverage request; an explicit selection/check triggers the scoped read. A simulated 503 retries the same request. Serial changes clear the earlier result. Serial change, close, Refresh, navigation and sign-out each cause an observed request cancellation before the held response is released. Close restores focus to the opener. A buyer at 390×844 sees only its sold serial options and provisional review messaging, with no horizontal overflow or JavaScript errors in the exercised journey.

## Actual verification

| Command at captured final candidate | Actual outcome |
| --- | --- |
| `npm test` | PASS 838/838, zero fail/cancel/skip/todo; TAP 26817.812041 ms |
| `npm run build && npx playwright test` | Build PASS; Chromium PASS 50/50; command 101.08477929100627 seconds |
| `npm run typecheck` | PASS, exit 0 |
| `npx prettier --check 'src/**/*.{ts,tsx,css}' 'tests/**/*.ts' '*.ts'` | PASS, exit 0 |

Focused all-warranty selection passed 61/61 before the final capture; its application/backend test bytes match the final candidate. The corrected scoped browser/build passed 1/1 before capture. The companion retains these exact commands and intermediate records separately. Receipt-stage planning/link and whitespace commands are recorded after document preparation. No tested application input changes during that preparation.

## Preserved failures and self-review

The initial typecheck failed because the test snapshot owner array inferred plain strings; it now uses the actual readonly owner literals. Three focused attempts each failed 24/25 while correcting mismatched NOT_FOUND/FORBIDDEN expectations for account guards and resale; final tests preserve the existing authorization behavior. The initial browser fixture omitted required administrator currentPassword and failed before coverage UI assertions. The refined browser failed on an exact label locator because a wrapping label included option text. Separate explicit htmlFor/id labeling fixed the native accessibility association; no timeout increase or assertion weakening. Both failed browser trace/error-context trees remain copied before reruns. Failed patch context matches and an unknown session poll changed no application inputs.

Self-review inspected fresh identity/account checks, retained replacement lineage, current-policy versus retained-claim semantics, canonical UTC arithmetic, read-only projections, atomic malformed-input rejection, strict HTTP inputs, stale-response suppression and cancellation/focus handling. The explicit accessible label is part of the final captured application. No independent review or concurrent grant-revocation race qualification is claimed.

## Limits and remaining qualification

Ordinary-sale preview derives the current provisional organization duration; it is not a historical approved policy snapshot. Actual trigger/expiry/transferability, product/customer exceptions and remedy rules remain open. The sold-unit dashboard remains unbounded; this lookup does not qualify production indexes, query cost, locking, load, security, retention, upgrade, recovery or infrastructure residency. Real providers, physical hardware and operator/business acceptance remain unqualified. Existing full-suite process tests remain local synthetic evidence; no new production concurrency claim follows from this read.

Private captures, command records/logs and failed traces are under `/tmp/distributor-coverage-lookup-checkpoint`; temporary storage has no archival guarantee. All tasks and gates remain NOT VERIFIED. The full system goal remains active.
