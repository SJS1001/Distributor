# Cloud restore security integration — 2026-10-03

Parent `1fa8e4188d5cb275b2e4dadaf17cf060a5474f07`, branch `codex/local-distributor-checkpoint`. The existing cloud “Set up Distributor” session completed bounded restore-security coding on published baseline `e3630109e829e787805495227813e0874615693c`, retained local cloud commit `24eedb51e87784a400cd84f3d4f771961675a941` and performed no push. The [machine receipt](LOCAL-CLOUD-RESTORE-SECURITY-2026-10-03.json) binds exact transferred bytes, local tested inputs and private logs. All tasks and product gates remain NOT VERIFIED.

## Changed behavior

[Restore review](../RESTORE-REVIEW.md) now rejects surrounding-whitespace aliases in preparer, approver and signed writer identities. Separate approval must identify exact current finance/security people and keys. Clock checks before candidate capture and after signature review reject elapsed expiry and backwards completion instead of issuing a stale receipt.

Candidate capture compares bigint filesystem identity, size and change timestamps for the main database, WAL and rollback journal. Shared-index identity is checked without treating ordinary SQLite read-mark changes as business writes. SQLite-created empty WAL/shared-index files are retained after opening; concurrent commits or replaced files refuse capture. A filesystem boundary change produces a stable refusal even if SQLite first reports an error. Provider hold remains intact and activation is not authorized.

Only `src/server/restore-review.ts` and `tests/restore-review.test.ts` changed in the cloud patch. Review documentation and this receipt are local integration work. Schema, database layout, HTTP, browser, dependencies, licenses and workflows are unchanged. No private code was copied from another project.

## Actual verification

Cloud reported 31/31 focused restore tests, TypeScript and formatting passing on Node 24.19.0. Requested model/effort was Astra/High; effective settings could not be verified through available controls. These cloud results are separate from local verification.

The cloud patch was transferred in two separate foreground command outputs because the connector truncates a single large response. Decoded bytes total 19,153 and match SHA-256 `0ea99884457cdc85ed2b93219e1314cd8f4f6357e90c1efbdbf4e30aa56bf050`. It applied cleanly against the current schema-16 parent. Private patch metadata and raw outputs remain excluded from git.

Direct local macOS arm64/Node 24.16.0 checks:

- New tests against old production code: **25/31 pass, six failing assertions**, 3,385.619792 ms. Five unsafe acceptances reproduce; the WAL-symlink case was already refused by SQLite but returned a different error category. The red log is retained.
- Exact transferred production fix: **31/31 pass**, 3,252.716291 ms. Added coverage also verifies same-byte evidence replacement by another process, interrupted-read descriptor cleanup, current role/key changes, signed nested evidence, closed-WAL recapture and backwards clocks.
- Complete combined native regression: **2,489/2,489 pass**, zero failures/skips/cancellations, 92,025.582583 ms. This includes current valuation and schema/recovery checks.
- TypeScript and full existing formatting checks pass. All **585 source/test/configuration hashes** remain unchanged through final review.

No fresh Chromium, build, production-only installation or React/static-clean result is claimed for this offline restore-only change. The valuation checkpoint's complete Chromium/runtime checks remain historical; unchanged browser/build inputs do not turn them into a fresh combined run.

## Self-review and limitations

Reviewed exact independent identity, signed authority and evidence binding, real completion-clock rechecks, main/WAL/journal metadata, shared-index identity, SQLite-created sidecars, stable refusal, resource cleanup and retained recovery hold. The evidence verifier's existing post-read current-trust/expiry/file checks are preserved. Private patch/logs and disposable stores remain ignored.

Filesystem metadata checks cannot establish external reconciliation, true report contents, infrastructure writer fencing or a lasting lock. Trusted ancestors, exclusion of writers, distinct actual people, current registry provenance, signing-key custody and measured recovery still need qualification. Durable activation/fencing/routing, post-cutoff reconciliation and effect-dependent rollback remain dependent engineering. Quantity-error treatment and broader provider/device/finance/residency/security/load/operator qualification also remain open. See the [coding inventory](../CODING-REMAINDER.md).

Cloud coding and direct workstation tests used no CI runners. No workflows, provider requests, PR, merge or deployment were started. Full-system completion is not claimed.
