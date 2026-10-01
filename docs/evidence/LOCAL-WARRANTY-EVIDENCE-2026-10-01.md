# Local warranty file evidence — 2026-10-01

Status: **PASS for bounded synthetic workstation checks**. Partial D-030–D-033 engineering evidence relevant to G6. All 44 tasks and 10 gates remain **NOT VERIFIED**; the full-system goal remains incomplete. Reviewer: Codex source review and automated checks, without independent human acceptance.

Parent: `f3191cb8af6f6f513dc2fd6f21e41eaf8e4a31e8`, branch `codex/local-distributor-checkpoint`. The [machine companion](LOCAL-WARRANTY-EVIDENCE-2026-10-01.json) binds the candidate source, tests, configuration, documentation and available workstation logs. It also records byte comparisons of historical evidence against parent git objects. Its own bytes are excluded to avoid circular hashing. The subsequent actual git commit identifies the deliverable; an intended hash is not evidence of a commit.

## Result and invariants

The Returns screen now provides claim file uploads, paged metadata and verified downloads. Supported formats are JPEG, PNG, PDF 1.x and UTF-8 text, from 1 byte to 5 MiB, with a provisional permanent cap of 20 files per claim across both audiences. A description is required. Staff default to staff-only visibility; buyers attach and read only customer-visible evidence on their own account's claims. Finance can read, while support has no evidence access. Current real identity, active status, password requirement, role, organization, account and applicable current unit-site grants precede operations and cached retries.

Warranty owns immutable bytes and metadata. Upload and metadata/audit/receipt commit together. Same-key retries retain the original attachment; identical bytes/audience/metadata under another key reuse it. Altered metadata on those bytes conflicts. Lists select metadata only, with timestamp/ID pages of 10 and cursors restricted to the current claim and audience. Files do not alter native stock, orders, shipments, invoices, claim state or money.

Canonical base64 and bounded decoded bytes are checked before storage. Filenames reject paths and control characters. Signature checks refuse mismatched formats; text requires valid UTF-8 without prohibited controls. These are not full image/PDF parsing or malware detection. Downloads check the stored bytes against size/hash/format and check cached metadata against the current file before returning bytes. Download receipts contain metadata and identity, without base64/file bytes. Fixed identity-based attachment names, octet-stream, no-store, nosniff and sandbox headers avoid inline rendering. Browser hash, size, media, filename and receipt checks precede the download action. A receipt proves prepared bytes, not that a person saved or read them.

The browser retains only retry keys in session storage, indexed by the upload fingerprint or download identity. Reload requires reselecting the same file and description/visibility to retry the same upload. A lost committed response can then recover one attachment. Failed pagination retains loaded rows; corrupted download responses offer an integrity error and preserve the retry key. Closing the panel restores focus, and Escape/narrow-screen behavior is checked.

## Verification

Environment: macOS 27.0 arm64, Node 24.16.0, npm 11.13.0, SQLite 3.53.0, disposable synthetic databases and loopback headless Chromium. Available logs/artifacts are hashed under `/tmp/distributor-warranty-files`; temporary workstation files are not a durable production evidence archive.

| Check | Actual result |
| --- | --- |
| `npm exec -- tsx --test tests/warranty-evidence.test.ts` | PASS 8/8, 1750.893209 ms; `backend-focused.log`. |
| `npm test` | PASS 340/340, 10968.05 ms; zero failed/cancelled/skipped/todo; `backend-full.log`. |
| `npm run typecheck` | PASS, including subsequent `type-clean.log`. |
| `npm run format:check` | PASS, `format-final.log`. |
| Focused browser journey | PASS 1/1, 3.0 seconds; journey 1.4 seconds; `browser-focused-fixed.log`. |
| `npm run test:e2e` | Clean sequential PASS 27/27, 50.6 seconds; attachment journey 1.5 seconds; build 62 ms; `browser-full-clean.log`. |

Planning/link and whitespace checks follow receipt creation and are recorded in the machine companion. No source, test or configuration edits follow the checks above. Documentation consistency does not establish business acceptance.

Eight backend scenarios cover exact bytes and native-fact reconciliation, restart and compact receipts, actual account/site/role/active/password restrictions, canonical encoding and exact 5 MiB boundary, malformed/unsupported formats and unsafe names, claim/audience-scoped pagination and the 20-file cap, late-audit upload/download rollback, corrupt stored bytes and cached metadata, encrypted CA-tagged backup/restore, and actual child-process races. Concurrent same-key uploads save one file; two competing last-slot uploads permit one result and one EVIDENCE_LIMIT. HTTP coverage checks current session/origin/CSRF, exact schemas, upload-specific body allowance, unchanged ordinary limits, and verified no-store download bytes/headers.

The backup test recovers original bytes and upload/download receipt identities, excludes a later attachment, invalidates copied sessions and retains the restore hold. This uses local synthetic storage; the CA metadata tag does not prove actual Canadian hosting. Race tests exercise separate OS processes; audit injection does not establish process-kill, storage-failure or production recovery performance.

The browser creates a serialized sale and claim, loses an already committed private-file upload response, reloads and retries with the same key. It verifies one attachment and 11 customer-visible files, page failure/retry, a deliberately corrupted download followed by an exact-byte download with the same key, and unchanged native stock/order/shipment/invoice/claim facts. Mobile dismissal/focus and no overflow are checked. A real scoped buyer sees only the 11 public files; direct private-file download is refused. This does not exercise a physical scanner or human warranty review.

## Failures retained and review

The first focused browser attempt timed out clicking Sign out while the narrow viewport concealed that button. The test now restores the desktop viewport before sign-out, preserving the mobile assertions. The failed log and available trace/context were copied before later runs.

A duplicate full-suite invocation overlapped another run, reused its output filename and interfered with Playwright's shared artifacts. The duplicate reported port 3117 in use; the first run reported 26 passed and one failure from missing trace files during browser-context cleanup. Its raw mixed log contains NUL gaps and missing earlier output and is **not an authoritative clean result**. The available artifacts and log were copied to `browser-overlap-artifacts` and `browser-full-overlap.log`. After confirming those processes ended, one sequential suite used a separate log and passed all 27 journeys, including unpaid documents. No application change or assertion relaxation was used to resolve the overlap. Future runs must finish or be positively identified as terminal before starting another suite sharing its server/artifact directory; use unique log names.

Earlier working context mentions initial type/prototype defects, but their original raw logs are unavailable under the current log directory. No preserved raw failure evidence is claimed for them. The current source uses own-property media validation and the current checks above are passing.

The first receipt link check ran before the machine companion existed and failed on that missing link. `plan-receipt.json` retains this result; the subsequent complete-package check is recorded separately.

Source review checked ownership, real authorization before cached results, account/site/audience privacy, canonical bounded encoding, duplicate/cap races, transaction rollback, metadata-only pagination, byte integrity, browser retry retention, safe downloads and backup inclusion. Dependencies, lockfile and third-party license notices are unchanged; no third-party implementation code was copied. The instructed global predecessor HANDOVER.md is unavailable at its specified path.

## Remaining scope

Aggregate storage quotas, malware quarantine/review, legal deletion/retention, corrections, links between files and particular inspection/manufacturer decisions, streaming, schema upgrades, production locking/index/load/termination/restore/security, actual regional infrastructure and human warranty acceptance remain open. Evidence authenticity and physical custody are not established by uploading a file. The current cap and formats are provisional engineering limits. Actual provider/carrier/device qualification and all product gates remain open.

Execution remains direct workstation checks and local commits only. No CI runner/job, workflow/registration, push/PR, actual provider account/request, live data, deployment/purchase, source publication/settings change or OPUS/UB integration occurred. Future Distributor CI uses GitHub-hosted runners after separate authorization/qualification; this checkpoint makes no fresh remote-access claim.
