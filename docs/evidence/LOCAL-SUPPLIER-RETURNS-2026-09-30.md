# Local supplier return engineering receipt

Local date 2026-09-30; reviewer: Codex automated engineering checks. Status: PASS for the bounded checks below; every product task/gate remains NOT VERIFIED. Full-system implementation is incomplete and the goal remains active. The [machine receipt](LOCAL-SUPPLIER-RETURNS-2026-09-30.json) identifies exact uncommitted content and environment; no Git HEAD exists. Historical receipts remain unchanged.

## Scope and behavior

D-012–D-016 / CH-01–CH-03, with D-008/D-009 role/transaction constraints. Procurement owns immutable supplier handover receipts and return-reference deduplication. Inventory owns original purchase provenance, quantity/value removal and signed movements. Current administrator authority, a matching original purchase receipt, exact serial or bulk quantity, expected physical revision, unreserved stock and handover evidence are required. Wrong role/organization, unrelated receipt, serial mismatch, stale revision, reserved/transit stock, conflicting evidence and quantities above the original purchase reject without a return effect.

The new inventory-owned transfer source link retains purchase lineage across bulk split dispatch, partial arrival and recovered loss. Recursive traversal uses durable inventory custody evidence. The first lineage test exposed that prior dispatch movements recorded only the transit lot, losing its source link; the new additive table records that source for new dispatches. Legacy split stock without source evidence cannot invent provenance from product/cost/site similarity; it remains ineligible pending reconciliation. Direct purchase and whole-lot identity remain traceable. Additive creation is not production migration qualification.

Returns preserve original unit cost, bin/condition of remaining bulk stock and PO purchased/received totals/state. Supplier credit, replacement, accounting and carrier financial settlement remain pending. No customer credit/invoice is generated. A fully returned serial retains its zero-quantity stock identity and signed custody history, has zero availability/value, cannot be received as a new serial and does not enter sold-customer return custody. The provisional administrator approval/evidence policy still needs responsible business review.

The Purchasing interface displays purchase receipts, current authorized held lots, cumulative returned quantity and supplier handover history. Only administrators see the handover action. Warehouse views expose originating receipts for authorized held lots or receipts originally received at their granted sites; raw original unit-ID lists are withheld. Return history is scoped to the handover warehouse. Current authority is rechecked before cached command or business-reference results.

## Reproduction and outcomes

- `npm run typecheck`: PASS, exit 0.
- `npm test`: PASS, exit 0; 47 tests, zero failed/skipped. Five supplier-return domain/process tests and one HTTP test join the prior 41 checks. Split lineage survives close/reopen before handover; loss/recovery and partial arrival retain their original cost.
- `npm run test:e2e`: PASS, exit 0; production build and seven local Chromium journeys, 9.9 seconds. The supplier return journey discards a committed handover response, retries, verifies one removal/reference, reloads permanent evidence, and switches to a warehouse operator who can read history without approving a return.
- `npm run format:check`: final outcome recorded in the machine receipt.
- `python3 scripts/verify_plan.py`: final structure/link outcome recorded in the machine receipt. No product acceptance implied.

## Independent quantity/value expectations

Serialized opening stock is three units at 6,000 cents, 18,000 cents. Handing S3 to the supplier removes one/6,000 cents, leaving two physical units/12,000 cents and one signed return movement. Close/reopen and retry under another administrator/key with trimmed reference return the same result; changed evidence conflicts. Purchase remains fully received for three units and no customer invoice/credit exists.

Bulk opening stock is six at 1,000 cents, 6,000 cents. Dispatch splits four units, one partially arrives damaged and another is approved lost then recovered in quarantine. Returning those two lots removes two/2,000 cents from the original purchase. Four physical units/4,000 cents remain across source and transit custody. Opening value equals remaining physical value plus returned value; the temporary loss was fully recovered. PO received remains six. A missing legacy dispatch source link after restart produces null provenance and rejects the return without changing its two-unit lot. A count gain cannot bypass the original purchase return ceiling.

Two real child processes initialize separate database connections before a shared barrier. Dispatch and handover compete for S3: exactly one commits. If return wins, total physical stock is two/12,000 cents and one return exists; if dispatch wins, three/18,000 cents remain including one transit unit and no return exists. Two identical handovers under different keys both succeed with one identical receipt and one physical removal. Outcomes depend on writer order; no winner is prescribed.

The browser fixture starts at six/6,000 cents. After handing over two cartons and losing the HTTP response, retry leaves four/4,000 cents, one two-unit return valued at 2,000 cents and original PO received six. History explicitly says supplier credit pending. Automated users do not provide human handover acceptance. HTTP exact schemas reject injected supplier/cost/approver fields and role changes revoke even committed retries.

## Preserved failures and limits

Intermediate typecheck failures were TS2353 for missing dialog numeric minimum support and TS2339 for inferred generic receipt/return fields; fixed with explicit types. A lineage fixture initially passed a transfer ID instead of its loss ID, producing NOT_FOUND. Correcting the fixture exposed missing split-dispatch source provenance (null purchase origin); the explicit owned source link fixes new dispatches. Relevant checks and then the full suite passed after correction. Historical failures/hashes remain intact.

Close/reopen is not abrupt crash, backup/restore or production upgrade proof. Historic missing lineage reconciliation, large custody graphs, supplier credit/replacement, financial treatment, configurable approval duties, actual supplier/carrier/device handling and human operator acceptance remain unqualified. Opening/import cost, OAuth/secrets/refunds/accounting handoff, document/device, user/security and production load/restore work remains.

All work is local/uncommitted. No push, PR, publication, workflow, runner registration, repository setting change, account purchase, live-data ingestion, actual provider request or OPUS/UB integration occurred. Distributor CI must use GitHub-hosted runners. Every task/product gate remains NOT VERIFIED.
