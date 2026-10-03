# Local private restore evidence verification — 2026-10-03

Parent `bc43e38a63e43e163c9c4e384900381a53789357`, branch `codex/local-distributor-checkpoint`. Direct workstation verification on macOS arm64, Node 24.16.0, using disposable synthetic CA/US stores with optional event reports enabled/disabled. The [machine receipt](LOCAL-RESTORE-EVIDENCE-2026-10-03.json) binds tested source/configuration and retained private log hashes. Scope: D-035, D-036, D-039 preparatory engineering. All tasks and product gates remain NOT VERIFIED. No CI runner, workflow, delegated/cloud session, provider IO, PR, merge or deployment.

## Implemented behavior

[Private evidence verification](../RESTORE-REVIEW.md#verify-the-private-evidence-files) checks exact signed reference coverage against operator-supplied local files. The version-one manifest maps every unique reference once to a distinct relative file below an absolute private root. Shared signed references require consistent fingerprints. Unsupported fields, unsigned/duplicate/missing references, traversal, links, nonprivate or nonoperator-owned paths, empty/oversized files and mismatched bytes refuse. Limits: 1,000 references, 64 MiB/file, 256 MiB total; bounded 64 KiB read buffers. Nonblocking, no-follow opens refuse changed file types without waiting on a substituted FIFO.

File descriptors and retained metadata detect identity, permissions, size and timestamp changes. Verification reloads external current trust, recaptures the candidate and checks expiry/clock progression after evidence hashing. A final metadata check refuses detected file changes. Receipts expose counts, bytes, a deterministic evidence-set fingerprint and verification time, with signed-review metadata; local paths and evidence bytes are excluded. No database, provider hold, routing or evidence contents are changed. `providerHold: true`, `activationAuthorized: false` remain explicit.

## Actual checks

- Full native suite: **2,055/2,055 passed**, zero failures/skips/cancellations/todos, 80,668.693791 ms; includes all nineteen restore-review tests and eleven added test cases.
- Initial focused restore-review suite: **18/18 passed**, 2,291.966459 ms, before the additional aggregate-size test and final nonblocking-open/clock guards. The full native run covers the final source.
- TypeScript and complete existing formatting check pass on final source. Whitespace review passes.
- Planning structure/link verification passes: 44 tasks, ten gates, 220 Markdown files and 1,224 local links. This checks documentation structure only. The machine receipt binds all 495 tested source/configuration files and six retained private log hashes.
- New CA/US/reporting-profile checks verify exact byte totals, reordered manifest stability, unchanged captured candidate and retained provider holds without outputting private values.
- Refusal checks cover exact coverage/strict fields, traversal, duplicate references/paths, symlink/hard-link paths, empty/changed/oversized/nonprivate evidence, shared-reference hash conflicts, the aggregate 256 MiB limit, late approver revocation, candidate mutation, file/permission changes, expiry and backward clock. CLI subprocess checks verify successful isolated receipts and sanitized mismatch/missing-file errors.

No failed application check occurred in this increment. Earlier failures and receipts remain unchanged. No new browser/build/runtime/React/static-clean, multi-process filesystem-race or production-scale qualification claim is made. Source/test/dependency inputs beyond the three changed/added TypeScript files are preserved.

## Self-review and limitations

Reviewed private publication scope, exact signed binding, complete reference coverage, resource limits, no-follow/nonblocking descriptor reads, metadata rechecks, current external authority reload, fresh candidate and expiry, generic CLI errors, read-only behavior and retained recovery hold. Dependencies, licenses, schema, browser and workflow inputs are unchanged. Private evidence manifests/files, stores and raw logs are excluded from git.

File byte identity does not independently establish reconciliation, report truth, source freeze or fencing/routing. Trusted root ancestors and exclusion of concurrent writers remain operator responsibilities; metadata checks are not an adversarial filesystem lock. External trust registry provenance, signing-key custody, actual records and operators remain qualification inputs. The tool does not persist review approval or grant release authority. Infrastructure-specific activation/fencing/routing, durable transitions/interruption recovery, post-cutoff reconciliation and effect-dependent rollback remain open, alongside ledger/Purolator and broader full-system qualification in the [coding inventory](../CODING-REMAINDER.md). Completion is not claimed.

## Publication

Source/test/documentation commit `8abece6fb217bd69f8b7be5748db7a5cb2984b16` was normally pushed to the authorized current branch. Exact remote equality and a clean checkout were confirmed; all 495 tested inputs match committed bytes and all six private log hashes match retained files. No credential-pattern match, private evidence artifact, dependency/license/schema change or workflow file was included. GitHub access was confirmed under `SJS1001` with push permission, zero workflows and zero Actions runs. This companion publication record does not change tested application source or qualify product gates.
