# Local partial fulfillment receipt

2026-09-30. Partial engineering evidence for D-012–D-016, D-018–D-028 and D-038. All task and product gates remain **NOT VERIFIED**. Reviewer: Codex automated engineering review; no operator or independent human acceptance supplied.

## Candidate and environment

Local uncommitted candidate without a Git HEAD; exact file hashes appear in the [machine receipt](LOCAL-PARTIAL-FULFILLMENT-2026-09-30.json). Previous [engineering](LOCAL-ENGINEERING-2026-09-30.md) and [provider](LOCAL-PROVIDER-BOUNDARY-2026-09-30.md) receipts remain historical and unchanged.

macOS arm64, Node 24.16.0, npm 11.13.0, disposable synthetic SQLite and local Chromium. No external provider, live/customer data, physical hardware, deployment, remote write or CI run was involved. GitHub-hosted runners remain the Distributor policy; these local development checks are not runner qualification.

## Behavior and independent expectations

Active packed shipments hold their selected allocation quantities. Later packing subtracts those holds, and unpicking a held allocation requires voiding its active packing first. Packing and voiding do not issue stock or create invoices. Handover consumes stock and creates its invoice in one transaction. Derived holds use fulfillment-owned records and inventory-owned operations; no foreign-table reads or writes were introduced.

The synthetic fixture starts with three serials costing 6,000 cents each and five bulk units costing 1,000 cents each: stock value 23,000 cents. One serial and four bulk units are ordered, using illustrative prices/taxes, for 22,600 cents. Split handovers ship the serial and three bulk units for invoices of 16,950 and 2,825 cents. Canceling the last bulk unit releases 2,825 cents of open-order exposure. Independently expected totals: invoices/exposure 19,775 cents; shipped stock cost 9,000 cents; remaining stock value 14,000 cents; two serials and two bulk units available. The test asserts actual persisted quantities, invoices, exposure and stock value against these fixed expectations.

The database is closed and reopened while two packing holds exist. A void releases its quantity, replacement packing succeeds, handovers may occur in the opposite order, and exact-key retries produce one business result. Overpacking and unpicking held stock fail. A separate-process race starts two writers against the same serial; exactly one packs it, the other receives `QUANTITY`, and neither invoices or removes stock.

A legacy fixture inserts overlapping packing that the previous implementation allowed. Handover fails with `PACKING_CONFLICT`, leaving stock, order quantities, packing and invoices unchanged. Voiding the conflicting shipment allows the same previously failed command key to complete once.

The second browser journey selects one of three bulk units, commits packing while discarding its HTTP response, and retries with the same key. Exactly one packing record exists. The next form shows two remaining units; an all-zero selection fails. Once all units are held, new packing is blocked. Voiding/repacking releases and reacquires two units. Handovers invoice 2,825 then 5,650 cents; the order remains open after the first, closes after the second, and stock decreases by exactly three. The original ordering/residency/payment/return/mobile journey remains covered.

## Actual checks

| Command | Observed outcome |
| --- | --- |
| `npm run typecheck` | Exit 0. |
| `npm test` | Exit 0; 26 passed, zero failed/skipped. |
| `npm run test:e2e` | Exit 0; production build and two Chromium journeys passed. |
| `npm run format:check` | Exit 0. |
| `npm run verify:plan` | Final structural result recorded in the machine receipt after documentation additions. |

## Preserved failures and limitations

The first 25-test run passed the new business assertions but failed cleanup with `database is not open`: the fixture closed the original application again after a restart. Cleanup now follows the fixture's current application. The subsequent 25-test run passed. The new legacy test initially read `revision` from the accept result, which contains only `id`; type check failed with TS2339 and the test rejected packing with `STATE`. The test now reads the actual order revision; type check and all 26 tests passed. A formatting check rejected the browser file; formatting was corrected and the check passed.

Restart evidence is a deliberate close/reopen, not a process kill during a transaction or a restore rehearsal. Packing is derived from JSON shipment lines and has not been load-qualified. The conservative unpick rule covers an entire allocation, including unpacked remainder, until its active shipments are voided or handed over. Short picks, damaged/partial transfers, carrier booking/labels/tracking, device evidence, tax/commercial approval, security review, import/backup/restore and operator cycles remain outstanding. Both-origin human acceptance is still required by [CHECKPOINTS](../CHECKPOINTS.md). Full-system implementation remains active and incomplete.
