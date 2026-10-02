# Local stock and billing reconciliation evidence

Partial D-036 engineering evidence. All 44 tasks and 10 gates remain NOT VERIFIED. [Hash-bearing companion](LOCAL-RECONCILIATION-2026-10-02.json), [reconciliation procedure](../RECONCILIATION.md) and [acceptance checkpoints](../CHECKPOINTS.md).

Parent `052f4b88aade2ac3bb1e3ed34a454c31b10b31e6`, branch `codex/local-distributor-checkpoint`. Checks ran 2026-10-02 UTC on the direct macOS arm64 workstation with Node 24.16.0/npm 11.13.0, synthetic SQLite and loopback HTTP/Chromium. The companion records 322 final tested inputs, actual command times/exits/log hashes, conserved historical evidence/license notices and matching private/current production assets. No schema, dependency, license or workflow changes. No CI/cloud/delegation, provider/device request, push/PR, live data or deployment.

| Check | Actual outcome |
| --- | --- |
| `npm test` | PASS 1587/1587; thirteen new reconciliation tests relative to the parent |
| `npm run test:e2e` | PASS 73/73 with production build, including the phone reconciliation journey |
| `npm run typecheck` | PASS, exit 0 |
| `npm run format:check` | PASS, exit 0 |
| `npm run verify:runtime` | PASS, exit 0; 200 copied inputs, 69 development-only packages absent, 27 child commands, CA/US startup twice each, native documents and local encrypted backup/restore |
| Focused reconciliation backend | PASS 13/13 |

## Tested behavior

The application rechecks persisted identity, role, organization and forced password change before inventory and billing owner reads in one transaction. A separate SQLite connection cannot change stock between stock and money reads; an injected failed read releases the transaction and permits the competing write. Unauthenticated HTTP requests and revoked roles are refused, successful responses use `no-store`, and private descriptions, references, reasons and credentials are excluded. A whole-database comparison establishes that the report does not alter stored facts.

Stock controls preserve original-cost quantity/value across transit and quarantine receipt. Independent same-total product faults remain visible even when organization totals agree. Injected quantity/cost drift, missing movement sequences, unsupported types and invalid timestamps produce discrepancies. SQLite integers outside JavaScript's safe range remain exact through text reads and BigInt calculations, including multiplication above SQLite's aggregate range. Foreign organization records are excluded. Details are limited to the first 100 per module while the count includes the complete scan.

CA and US fixtures cover native shipment, invoice, manual payment, credit, pending refund, verified completed refund and restart. Historical opening credits, payments and refunds remain independent imported facts and reconcile without new documents. Malformed credit/refund origins, line arithmetic, pending/uncertain and completed invoice cash capacity, original payment capacity and wrong currency are observable. Mixed currencies are flagged and excluded from regional totals without exchange rates. Negative balances can legitimately represent credited cash awaiting refund; rejected refunds release reservations.

The 390-by-844 production Chromium journey shows deliberate stock discrepancies, records a native manual payment and refreshes the document balance. An injected failed read clears old controls and permits retry. An abandoned delayed response cannot repopulate the panel after navigation; a new panel loads current results. Sign-out removes the panel and denies subsequent reads. The journey checks horizontal overflow and page errors.

## Corrections and conservation

The first focused run used an update against an absent security row, so its forced-password-change assertion failed. Corrected the persisted test fixture to insert/upsert. An initial TypeScript check found an untyped mocked actor; the fixture now uses the actual Actor type. Neither correction relaxed production checks.

The first complete run passed 1586 backend and 73 browser cases. Source review then identified a gap: an injected completed refund on a paid invoice without credit fit the original payment capacity but incorrectly appeared healthy. A new independent test reproduced that failure. Native completed refunds now check invoice cash entitlement after retained historical refunds; valid opening evidence remains accepted. The first-pass manifest/results, failed fault test and final revised results remain separately retained with hashes. First-pass results are superseded for the revised source.

Self-review checked owning storage, fresh authority and the single snapshot, exact integer arithmetic, original movement signs, scoped parent relationships, opening conservation, refund states/capacity, regional currency exclusion, bounded output, no read-side mutation, and browser failure/cancellation behavior. Structure/link and whitespace checks establish documentation consistency only.

## Limits

These controls do not establish physical existence, site/bin/serial accuracy, allocations, shipment-to-invoice agreement, general-ledger or bank/provider balances, tax correctness or customer acceptance. Equal offsetting errors within one stock product can escape the controls. The report neither corrects facts nor retains an exportable reconciliation receipt.

The synchronous full scan holds `BEGIN IMMEDIATE`; other writers wait, and memory grows with retained product/billing history. Client cancellation discards display but cannot interrupt an already-running server scan. Actual workload, lock duration, indexing and latency remain unqualified. Actual devices, providers, infrastructure residency, production security/load, disk/power recovery, agreed RPO/RTO and human acceptance remain outstanding. The full system remains incomplete.
