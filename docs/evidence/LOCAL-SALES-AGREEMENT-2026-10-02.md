# Local native sales agreement evidence

Partial D-023/D-036 engineering evidence. All 44 tasks and 10 gates remain NOT VERIFIED. [Hash-bearing companion](LOCAL-SALES-AGREEMENT-2026-10-02.json), [reconciliation procedure](../RECONCILIATION.md) and [acceptance checkpoints](../CHECKPOINTS.md).

Parent `3c58beac1408f04dce9576f136c21c81a6c8a43c`, branch `codex/local-distributor-checkpoint`. Checks ran 2026-10-02 UTC on macOS arm64, Node 24.16.0/npm 11.13.0, using synthetic SQLite and loopback HTTP/production Chromium. The companion records 325 unchanged tested inputs, actual command times/exits/log hashes, conserved historical evidence/license notices and matching private/current production assets. No schema, dependency, license or workflow change. Direct workstation checks only; no CI/cloud/delegation, push/PR, live data, provider/device request or deployment.

| Check | Actual outcome |
| --- | --- |
| `npm test` | PASS 1614/1614; 27 new sales control tests relative to the parent |
| `npm run test:e2e` | PASS 73/73, including enhanced reconciliation phone journey |
| `npm run typecheck` | PASS, exit 0 |
| `npm run format:check` | PASS, exit 0 |
| `npm run verify:runtime` | PASS, exit 0; 202 copied inputs, 69 development-only packages absent, 27 child commands, CA/US startup twice each, native documents and local encrypted backup/restore |
| Focused reconciliation and sales backend | PASS 40/40 |

## Tested behavior

The existing reconciliation operation rechecks persisted identity, role, organization and forced password change before scoped owning-module reads in one transaction. Orders, fulfillment, inventory and billing expose internal evidence from their own tables; the agreement function has no SQL or business writes. An independent SQLite writer is fenced between all four reads. A failed read releases the lock. Whole-store comparisons establish read-side conservation, and copied foreign-organization records remain excluded.

CA/US partial serialized shipments and repeated partial consumption of one bulk allocation reconcile through restart. Committed shipment evidence agrees with order/account/site, packed allocation quantities, allocation consumption, order shipped quantities, per-unit product/site/original-cost inventory deductions and both invoice links. Invoice product quantities and accepted order prices/tax are compared independently of internally balanced billing arithmetic. Historical opening invoices are excluded through their owning provenance, rather than an ID prefix. Packed/void records cannot carry committed unit/invoice evidence. Warranty return/replacement handovers retain the original ordinary sale without adding a second ordinary invoice or sales deduction.

Independent faults detect excess invoice quantity, balanced price/tax drift, consumed allocation/order quantity drift, wrong order/account/site/unit/product references, missing stock deductions and offsetting original-cost errors that preserve overall quantity/value. Invalid retained JSON and unsafe numbers become discrepancies without echoing private evidence. Exact text/BigInt reads preserve SQLite integers beyond JavaScript's safe range; wrong invoice currency is flagged and excluded from regional net/tax without exchange rates. Counts cover the whole scan while only the first 100 sales details are returned.

The 390-by-844 production Chromium journey displays two balanced invoice price/tax discrepancies alongside an existing stock fault, regional amounts and shipment/deduction quantities. Existing manual-payment refresh, failed-read retry, abandoned-response navigation, sign-out refusal, no horizontal overflow and no page-error assertions remain exercised.

## Corrections and conservation

The initial expanded focused run failed because a synthetic inventory-movement insert supplied ten placeholders for eleven columns. Corrected the test fixture to eleven placeholders; production controls and expected outcomes were not weakened. Initial failure and superseded focused logs remain retained privately at `/tmp/distributor-sales-controls-checkpoint` with hashes in the companion.

Self-review checked owning reads, fresh authority, transaction fencing/release, exact arithmetic, tuple-level cost/deduction agreement, immutable commercial prices, opening provenance, regional exclusion, replacement distinctions, private-output limits, read-side conservation and browser stale responses. Structure/local-link and whitespace checks establish documentation consistency only. Existing historical evidence and dependency/license notices are preserved.

## Limits

Agreement does not establish physical existence, current site/bin/serial accuracy, unconsumed reservation/pick accuracy, general ledger, bank/provider balances, tax correctness or customer acceptance. Coordinated changes to all agreeing records can escape the controls. This report does not repair facts or retain an exportable reconciliation receipt.

The synchronous full scan holds `BEGIN IMMEDIATE`; competing writers wait, and memory grows with retained history. Client cancellation stops display, not an already-running server scan. Actual workload/indexing/latency/lock duration, devices/providers, infrastructure residency, production security/load, disk/power recovery, agreed RPO/RTO and human acceptance remain unqualified. The full system remains incomplete.
