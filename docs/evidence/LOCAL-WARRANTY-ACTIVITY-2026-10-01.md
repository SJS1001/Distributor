# Warranty claim activity — local engineering receipt

Date: 2026-10-01. Status: **PASS for the bounded local checks below**. Partial D-008/D-030–D-033 engineering relevant to CH-06/CH-07/CH-08, REQ-03/REQ-17 and G1/G6. All 44 acceptance tasks and 10 product gates remain **NOT VERIFIED**. Full system completion and production readiness are not established.

Parent `4b2674a2961ad51d5d2a21e9676635c76e194a26`; branch `codex/local-distributor-checkpoint`. The [companion content record](LOCAL-WARRANTY-ACTIVITY-2026-10-01.json) binds 231 application/test/configuration/license inputs captured at `2026-10-01T19:41:50.149227+00:00`, final documents, actual commands/log hashes and 155 unchanged historical evidence files. A subsequent local commit includes this receipt; content hashes identify the tested version without a self-referential commit field. Parent agent implementation and self-review only; no independent review or human sign-off.

## Environment and scope

Direct workstation commands in `/Users/stevensmith/Documents/Distributor`, macOS arm64, Node v24.16.0, npm 11.13.0, repository-pinned dependencies, disposable native SQLite fixtures and local Chromium. Fixtures use synthetic US/Canadian organizations and real local module operations. No actual provider/device or operator qualification. No schema, dependency, lockfile or license change; no third-party source import. No delegation, CI runner/job/workflow, cloud checkout/source transfer, push/PR, provider request/account, deployment, purchase, publication, settings, live data or OPUS/UB integration.

## Expected and observed behavior

- Submission appends the validated original issue; receipt appends the actual native returned serial, warehouse and trimmed quarantine bin; inspection appends validated original findings. Later restock preserves original custody details. Issue/evidence/findings retain their existing 2,000-character limits; a 1,001-character decision reason still rejects. Original evidence references remain on the claim.
- Native submission/receipt/inspection activity, business facts, audits and permanent command receipts share the command transaction. Six injected late failures, after activity or command-receipt audit insertion for each operation, roll back retained module facts including audit order/clock. Same-key retry then commits one record and one native stock effect. Exact successful retries preserve all facts. New activity audits contain only the activity ID; existing decision reason audits retain their prior semantics.
- The nine-action workflow records submission, approval, manufacturer referral/cancellation, receipt, inspection, repair, scrap and credit in recording order. History reads preserve facts and survive database/application restart. Pages cover 20/20/6 records without duplicates, including tied timestamps and appends; exact edges and claim/organization cursor scope remain enforced.
- Fresh IAM/account/site/password checks govern pages and commands, including cached retries. Buyer history materializes only ID/action/time, omitting private issue/inspection/custody/reason/actor details. The authenticated HTTP fixture records all four submission/approval/receipt/inspection actions and asserts that redaction, strict queries and authentication. This assertion concerns activity history; other authorized claim fields are separate contracts.
- A simulated older release retains the claim and cached receipt with no submission activity. Restart/read and cached submission retry leave that gap intact; subsequent approval is the sole new entry. No inferred historical backfill occurs.
- Returns exposes Claim activity on demand: 20, 40 and 46 records; a failed second-page read retains rows and retries the same cursor. Selecting a second claim shows only its own submission. Close, Refresh, navigation and sign-out cancel actual browser requests. Focus restoration, read-only fact retention and absence of browser errors are asserted. Staff long inspection details wrap at a 390×844 viewport; buyer phone history omits staff details/actor and avoids page overflow. Attachment and shipping histories remain separate.

## Commands and outcomes

| Command | Actual outcome | Recorded duration |
| --- | --- | --- |
| `npm test` | Final v2 PASS 827/827, zero fail/cancel/skip/todo, exit 0 | 25.747 seconds |
| `npm run test:e2e` | Final v2 build and Chromium PASS 49/49, exit 0 | 98.872 seconds |
| `npm run typecheck` | Final v2 PASS, exit 0 | 1.174 seconds |
| `npm run format:check` | Final v2 PASS, exit 0 | 5.667 seconds |
| Six warranty files through `./node_modules/.bin/tsx --test` | PASS 50/50 on unchanged relevant backend/test bytes before browser-only synchronization change, exit 0; exact filenames/argv in companion | 4.806 seconds |

Planning/link and whitespace checks follow receipt creation; their actual records are added to the companion. The companion contains exact timestamps, argv, durations and log hashes for final and earlier checks. Test counts do not measure product completion.

## Preserved failures and self-review

Initial focused execution failed 49/50: its pagination oracle omitted the new submission in the final-page prefix. Correcting the expected prefix produced 50/50. A later refined selection passed 35/35 but included two nonexistent filename arguments and did not select all warranty tests; it is not all-warranty evidence. The subsequent actual six-file selection passed 50/50.

The first full browser run failed 48/49: existing provider acceptance history stalled after Refresh while remaining dashboard reads were pending and actions stayed disabled. Its entire test-results tree, error context and trace were copied before reruns. Unchanged full-browser recheck passed 49/49 and focused provider reproduction passed 1/1; no application defect was established. Trace/self-review identified temporary routing removed before the whole dashboard refresh completed. Provider and warranty fixtures now wait for Refresh to be enabled before route removal, without increasing timeouts or weakening assertions. Final v2 differs only in this browser synchronization and passed all full checks above.

Failed patch-context matches changed no files. A redundant candidate capture refused to overwrite existing v2; bound bytes were rechecked. Both original and v2 captures and all failed/intermediate logs remain private under `/tmp/distributor-warranty-activity-checkpoint`, without archival retention guarantee. The companion hashes preserved failed browser artifacts.

The first receipt-stage planning check failed on the old warranty procedure heading anchor in IMPLEMENTATION.md. Its link was corrected to Claim activity; retain the failed record alongside the repeated check. This documentation-only correction changes no tested application input.

Self-review covered native transaction rollback, current authority, separate module ownership, original input limits/custody snapshots, buyer SQL projection, pagination edges, historical gaps and desktop/phone browser behavior. Activity is append-only through the application, not physically immutable SQLite storage. No independently reviewed business oracle, real device or provider evidence was added.

## Remaining qualification and validity

Coverage/expiry/ownership/remedy policies, actual manufacturers/carriers/hardware, named vendor terms/residency and operator/finance/buyer acceptance remain open. Production schema indexing/query scans/sorts/locking/load, concurrent authority changes, migrations/upgrades/retention/security/backups/recovery and actual regional infrastructure remain unqualified. Dashboard collections remain unbounded. No universal claim timeline or historical snapshot/retention guarantee is claimed.

Changes to relevant warranty/inventory/platform/IAM/HTTP/UI/contracts/dependencies/configuration or fixtures invalidate affected checks. Integrated task/gate evidence and human acceptance remain required; this local engineering receipt cannot satisfy them.
