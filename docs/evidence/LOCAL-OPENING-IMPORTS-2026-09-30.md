# Local opening import engineering receipt

Local date 2026-09-30; reviewer: Codex automated engineering review. This receipt covers the bounded synthetic opening-stock slice of D-013/D-035. Every task/product gate remains NOT VERIFIED; full-system implementation is incomplete and its goal remains active. The [machine receipt](LOCAL-OPENING-IMPORTS-2026-09-30.json) identifies exact uncommitted files and environment. No Git HEAD exists; historical receipts remain unchanged.

## Scope and behavior

Added a migration owner, current administrator-only API/UI, version 1 source manifests, immutable raw-input/report fingerprints, durable row rejects, independent quantity/value and per-site reconciliation, review decisions and permanent source-to-stock mappings. Catalog/inventory resolve exact SKU/site names and validate custody through owning operations. Dry runs write no stock. Any row issue or unmatched independent totals blocks the whole batch; correction uses a new immutable batch while retaining source namespace/row IDs.

Approval binds the review fingerprint, rechecks current mappings/custody/source identity inside the same transaction, and invokes inventory to create all original-cost serial/bulk stock and `opening` movements. Existing product/site custody, including zero-quantity history, prevents a second opening balance. Identical business decisions replay after restart/new request keys; altered decisions conflict, and current role/organization authority precedes cached results. Rejection preserves original evidence and applies nothing. Opening custody does not invent purchase origin or create a PO, invoice, supplier credit or accounting posting. See the [runbook](../IMPORTS.md).

## Reproduction and outcomes

- `npm run typecheck`: PASS, exit 0.
- `npx tsx --test tests/migration.test.ts`: PASS, seven tests, zero failures/skips; 730.066292 ms at the targeted run.
- `npm test`: PASS, exit 0; 60 tests, zero failures/skips; 1355.769958 ms at the final full run. The preceding run passed 59 tests before the late-write rollback case was added.
- `npm run test:e2e`: PASS, exit 0; production build and eight Chromium journeys, 11.9 seconds. The new import journey checks rejected totals, correction, stock-free dry run, lost-response retry, exact quantity/value/availability, permanent mappings after reload and denied warehouse access.
- `npm run format:check` and `python3 scripts/verify_plan.py`: PASS, exit 0. Planning structure: 44 tasks, 10 gates, 11 scenarios, 14 decision sheets, 22 requirements, 28 Markdown files and 129 local links; effort remains 248–396 baseline plus 8–14 optional UB developer-days. Structure is not business acceptance.

Seven import tests exercise immutable evidence/deduplication, stock-free dry runs, exact original costs, restart, malformed rows, duplicate identities, independent-total mismatch, rejected-review preservation, current role/organization/fingerprint authority, source reuse, regional/currency/version/size/cutoff rejection, strict HTTP envelopes and real competing child-process approvals. A synthetic SQLite trigger aborts the final source mapping after stock insertion and preceding mappings; the transaction leaves no imported stock, opening movement or source mapping, retains its ready review and safely applies once after the fault is removed. This is injected transaction failure, not abrupt crash/disk-fault proof.

## Independent expectations

The source oracle has two serialized units at 6,000 cents each in Toronto, three usable bulk units at 1,000 cents each in Toronto and one quarantined bulk unit at 1,000 cents in Ottawa. Independent total: six units valued at 16,000 CAD cents. Toronto: five/15,000; Ottawa: one/1,000. Successful approval creates four custody records and four mappings, with five units available. Purchase-order count remains the original fixture's one; invoices remain zero. Every imported stock record has no purchase-origin receipt.

Before approval, imported quantity/value is zero. A source total of 16,001 cents blocks approval and leaves stock unchanged; a corrected new review applies 16,000. The browser commits approval then discards the response; unchanged retry/reload preserves four records/mappings and the original rejected review. Two separate processes approving overlapping reviews yield one winner and one `IMPORT_STALE`; two processes replaying the winning review return the same original result without another movement. A reused applied source row at a different empty product/site rejects rather than changing its identity.

## Review, limits and publication

Self-review corrected condition validation to require an actual string; a JSON array containing `usable` cannot be coerced into accepted custody condition. The malformed-row fixture covers this rejection. No failed executed check occurred during this checkpoint. The intentionally raised late SQLite mapping error is a passing negative-path test; previous checkpoint failures/receipts remain preserved.

Supplied source hashes, acknowledgments and cutoff timestamps do not prove actual file contents, publication/data rights, completeness or physical source freeze. Current boundaries: 1–500 rows, one consolidated balance per previously empty product/site, same regional currency, whole units and the latest 50 reviews in the UI. Raw prior evidence persists but historical search/export/retention, populated-import restore rehearsal, abrupt crash/power/disk faults, production schema upgrades/load, legacy purchase lineage, configurable approval duties and human acceptance remain unqualified. An administrator may preview and approve under provisional local policy. Customer/catalog/unpaid-document migration, general-ledger opening balances and full cutover/rollback are separate remaining work; this does not narrow D-035.

Repository read-only access was previously confirmed under SJS1001; this checkpoint made no fresh remote access/permission claim. Distributor uses GitHub-hosted runners. Hosted OS/capability/usage-cost/security qualification and future verified sjsmithbot PR identity remain pending; no workflow or runner registration exists.

All files remain local/uncommitted/unpublished. No remote mutation, push, PR, account, live-data ingestion, actual provider request, deployment or OPUS/UB integration occurred. See [implementation status](../IMPLEMENTATION.md) and [handoff](../HANDOFF.md) for the remaining full-system work.
