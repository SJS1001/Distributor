# Distributor task list

Date: 2026-09-30. Full application engineering is authorized and underway. These 44 tasks remain the acceptance baseline; none is VERIFIED. Current implementation coverage and remaining work are tracked in [IMPLEMENTATION.md](IMPLEMENTATION.md). G0 business/operator decisions and product gates remain unresolved. Optional UB work is separately scoped.

Effort is an initial range in developer-days (five days per person-week), excluding QA/operator time and external waits. Responsibility labels are roles, not assignments. Each row requires the evidence receipt defined in [evidence instructions](evidence/README.md); column-specific artifacts supplement that receipt. Re-estimate after G0/G1. Gates and reusable test fixtures are in [checkpoints](CHECKPOINTS.md).

## Phase 0 — scope, approach and financial rules (G0)

| ID | Task / responsibility | Depends on | Days | Acceptance / evidence |
| --- | --- | --- | --- | --- |
| D-001 | Capture real operating scenarios / product + operator | None | 2–4 | Resolve DEC-01/02/03/07/08; at least one order, partial supply, transfer, warranty and return with agreed expected results; scenario workbook and review record. |
| D-002 | Inventory source rights, licenses and dependencies / technical + license reviewer | None | 2–4 | Pin proposed OPUS/open-source files and dependencies; record distribution model, rights/notices/copyleft/enterprise exceptions and maintenance owner; no ambiguous copied-code approval. |
| D-003 | Select build/reuse path / technical + owner | D-001, D-002 | 2–4 | Compare identical G1 outcomes across credible paths; select one inventory authority and record rationale, retained dependencies and proof scope. |
| D-004 | Set commercial/financial rules / finance + product | D-001 | 3–5 | Resolve DEC-04/05/06; independently calculated price/tax/partial-shipment/credit/payment examples and stock-cost reconciliation oracle. |
| D-005 | Assess scanning/hardware/connectivity / warehouse + technical | D-001 | 2–3 | Label and serial semantics, supported device matrix and offline scope documented; choose camera/hardware candidate proof, no purchase assumed. |
| D-006 | Establish targets, cost and staffed schedule / owner + operations | D-001, D-003, D-004, D-005 | 2–4 | Numerical workload/latency/freshness/RPO/RTO/retention/cost targets, access prerequisites and dedicated capacity recorded; revise effort and pilot/production dates. |

## Phase 1 — isolation, foundation and extension (G1)

| ID | Task / responsibility | Depends on | Days | Acceptance / evidence |
| --- | --- | --- | --- | --- |
| D-007 | Create isolated composition and extraction proof / backend | G0 | 6–10 | Fresh local API/worker/UI/database boots independently; real receipt, job-free invoice and limited return/credit; no OPUS/UB endpoints or field-service stand-ins; retain build logs and reconciled values. Proof timebox is two calendar weeks across D-007 plus scoped D-008/D-009. |
| D-008 | Implement authorization/account/warehouse boundaries / backend | D-007 | 6–10 | Buyer A cannot access B; warehouse-restricted role cannot mutate another site; unauthorized bulk/export/worker paths denied; audit and negative-access database tests. Customer residency choice has strict regional defaults, separate named provider exceptions, versioned acceptance and withdrawal tests. |
| D-009 | Establish module and schema ownership / backend | D-007 | 5–8 | Owned models/migrations and task-shaped interfaces documented; architecture checks reject foreign persistence/generic proxies; retained SQL/security artifacts reviewed. |
| D-010 | Implement outbox/inbox and effect recovery / backend | D-008, D-009 | 7–11 | State/publication commit atomically; actual crash/restart, duplicate, poison event and replay preserve one effect; quarantine/operator diagnostics and logs. |
| D-011 | Prove optional module addition/removal / full-stack | D-009, D-010 | 5–8 | Optional projection module registered/versioned; enabled/disabled builds and base contract tests pass without core business rewrites; intentional forbidden import fails. |

## Phase 2 — inventory, procurement and equipment scanning (G2)

| ID | Task / responsibility | Depends on | Days | Acceptance / evidence |
| --- | --- | --- | --- | --- |
| D-012 | Catalog, identifiers and exact units / backend + UI | G1 | 5–8 | Product/serial/location labels distinguished; duplicate/reused serial rules and case conversion validated against G0 examples; tests include rejected ambiguous identifiers. |
| D-013 | Stock positions, movements and valuation / backend | D-012 | 10–15 | Two warehouses/bins and condition states reconcile physical and cost movement; reservations separate from on-hand; opening costs and adjustments have evidence. |
| D-014 | Supplier purchasing and receiving / full-stack | D-013 | 6–10 | Partial PO receipt, inspection, duplicate delivery, unexpected serial and supplier return produce agreed stock/cost outcomes; receiving screens plus reconciliation. |
| D-015 | Transfers and cycle counts / full-stack | D-013, D-014 | 6–10 | Source → in-transit → destination quantities conserved; partial/damaged transfer and concurrent count rules enforced; audit and two-site workflow. |
| D-016 | Reservation concurrency and serial allocation / backend | D-013 | 10–15 | Competing last-unit requests have exactly one winner; expiry/cancel/partial consumption/replay safe; real database concurrency and cost checks. |
| D-017 | Camera/hardware scanning and labels / frontend + operator | D-005, D-012, D-014, D-015, D-016 | 7–11 | Scan receipt/transfer/count and allocated serial with duplicate rejection, wrong product/site refusal, camera denial and manual fallback; physical supported-device/printed-label receipts. |

## Phase 3 — customer orders and buyer portal (G3)

| ID | Task / responsibility | Depends on | Days | Acceptance / evidence |
| --- | --- | --- | --- | --- |
| D-018 | Customer/tier pricing and credit policy / full-stack | D-004, D-008, D-012 | 6–10 | Accepted quote snapshots match independent examples; concurrent orders respect agreed credit exposure; buyer-specific prices cannot leak. |
| D-019 | Sales order state and persistent cart / full-stack | D-016, D-018 | 9–14 | Cart survives restart; accept/hold/amend/backorder/cancel reconciles allocations and immutable accepted facts; duplicate submission creates one order. |
| D-020 | Portal order/payment/history experience / frontend | D-019, D-024 | 8–12 | Buyer completes scoped order and sees correct statuses/history; reload and errors recover; browser end-to-end and account-denial receipts. Payment segment waits for D-024; earlier portal work can proceed. |
| D-021 | Partial supply and cancellation integration / backend + QA | D-019, D-026, D-023 | 6–10 | Split order/shipments/invoices, cancellation after partial shipment and expired allocations reconcile; run CH-03/CH-04 with agreed expected totals. |

## Phase 4 — billing and payments (G4)

| ID | Task / responsibility | Depends on | Days | Acceptance / evidence |
| --- | --- | --- | --- | --- |
| D-022 | Invoice/credit core and exact money / backend | D-004, D-009, D-018 | 8–12 | Commercial evidence generates immutable lines, correct decimals/tax/numbering and credits without jobs; independently calculated fixtures. |
| D-023 | Order/shipment billing lifecycle / backend | D-019, D-022, D-026 | 6–10 | Agreed trigger invoices supplied quantities once; split invoices, canceled lines and credit totals reconcile with shipment/stock evidence. |
| D-024 | Payments/refunds/webhook recovery / backend | D-010, D-022 | 8–12 | Signature verification, duplicate/delayed/conflicting callbacks and uncertain outcome recovery preserve one payment/refund; provider simulator plus selected sandbox before production claims. Stripe requests require current named customer choice; denied/withdrawn consent blocks new outbound work. |
| D-025 | PDFs, delivery, aging and reconciliation / full-stack | D-023, D-024 | 6–10 | Approved invoice/credit samples, authorized delivery, account balances/aging and exception reconciliation match ledger of business documents; export and delivery logs. |

## Phase 5 — fulfillment and logistics (G5)

| ID | Task / responsibility | Depends on | Days | Acceptance / evidence |
| --- | --- | --- | --- | --- |
| D-026 | Pick/pack/shipment states / full-stack | D-016, D-019 | 9–14 | Allocated serial scan, short pick, partial pack, shipment commit and collection have distinct state; issue stock exactly once; serialized end-to-end evidence. |
| D-027 | Carrier adapter, labels and tracking / backend + UI | D-010, D-026 | 7–11 | Selected sandbox creates/reconciles booking; timeout after provider success does not buy duplicate label; correct multi-warehouse origin, tracking and manual fallback. Each selected carrier has its own disclosed customer exception; a family-wide consent cannot enable unrelated carriers. |
| D-028 | Exceptions, delivery and reverse logistics / full-stack | D-026, D-027 | 5–8 | Failed/lost/returned shipment and collection exceptions follow agreed authority; no auto-restock from a tracking status; audit and stock reconciliation. |
| D-029 | Fulfillment operator acceptance / QA + warehouse | D-017, D-021, D-025, D-028 | 4–6 | Operator completes CH-01/03/04/05 on both warehouse origins; timing/error observations meet G0 targets; named observations, no fabricated sign-off. |

## Phase 6 — warranty and returns (G6)

| ID | Task / responsibility | Depends on | Days | Acceptance / evidence |
| --- | --- | --- | --- | --- |
| D-030 | Sold-serial coverage and history / full-stack | D-012, D-023, D-026 | 6–10 | Correct customer/product/serial/coverage trigger; expiry, replacement and ownership rules; no synthetic installed service asset required. |
| D-031 | Claim and manufacturer workflow / full-stack | D-030 | 6–10 | Buyer/staff evidence, authorization, review and manual manufacturer decisions; denied/expired/duplicate claim handling and account isolation. |
| D-032 | RMA inspection/disposition orchestration / backend + UI | D-015, D-028, D-031 | 7–11 | Return receipt quarantines until inspected; repair/restock/scrap/replacement call inventory owner; movement/serial/claim histories reconcile. |
| D-033 | Credit/refund/replacement integration / backend + QA | D-024, D-032 | 6–10 | CH-06 approved disposition causes correct credit/refund/replacement once under retries; credit links original tax evidence and sold serial. |

## Phase 7 — provider handoffs, operations and migration (G7)

| ID | Task / responsibility | Depends on | Days | Acceptance / evidence |
| --- | --- | --- | --- | --- |
| D-034 | Accounting handoff / backend + finance | D-025, D-033 | 7–11 | Selected provider or accepted import format maps invoices/credits/payments/cost handoffs; duplicates, reject/correct/retry and reconciliation proven; no simulated certification. QuickBooks consent/disclosure and minimum data are independently qualified; refusal preserves native documents and a residency-compatible handoff. |
| D-035 | Migration/import and valuation rehearsal / backend + operator | D-014, D-025, D-033 | 8–12 | Dry-run customer/catalog/serial/opening stock-cost/unpaid-document imports with rejected rows and cutover map; source-to-destination counts and amounts reconciled. |
| D-036 | Monitoring, support and recovery / operations + backend | D-010, D-027, D-034 | 6–10 | Backlog/failed effects/freshness/stock-money discrepancies observable; redacted logs, replay/uncertain-outcome procedures and provider outages exercised. |
| D-037 | Dependency/security and CI qualification / technical + operations | D-011, D-020, D-034 | 6–10 | Pinned licenses/notices, dependency review, secrets/access/session tests and reproducible checks; if workflows selected, use GitHub-hosted runners and verify Actions permissions, hosted OS/capabilities, usage/cost limits and workflow security first. |

## Phase 8 — pilot and production readiness (G8)

| ID | Task / responsibility | Depends on | Days | Acceptance / evidence |
| --- | --- | --- | --- | --- |
| D-038 | Full workflow and fault acceptance / QA + domain leads | G2, G3, G4, G5, G6, G7, D-039 | 8–12 | Final integrated CH-01–CH-11 rerun at exact candidate after load/restore rehearsal, with no skipped critical checks; negative permissions, crash/replay and reconciled quantities/money evidence. |
| D-039 | Load/restore and cutover rehearsal / operations + QA | D-035, D-036, G2, G3, G4, G5, G6, G7 | 7–11 | Before D-038 final rerun, test agreed peak workload and RPO/RTO; restore fresh isolated environment and reconcile pending effects; cutover rollback rehearsal without duplicate financial/shipping effects. |
| D-040 | Controlled operator pilot / product + warehouse + QA | D-029, D-033, D-035, D-038, D-039 | 8–12 | Bounded pilot covering all required areas and both warehouse fixtures; observe at least two agreed operating cycles, reconcile exceptions, document feedback and fixes. Live use needs separate deployment/data authority. |
| D-041 | Production readiness review and release plan / owner + operations | D-037, D-040 | 5–8 | G8 receipts current, no unresolved critical defects, support owner/runbooks and training, release/cutover/rollback reviewed; readiness does not authorize deployment. |

## Optional Project UB qualification (G-UB, outside baseline)

| ID | Task / responsibility | Depends on | Days | Acceptance / evidence |
| --- | --- | --- | --- | --- |
| D-042 | Define UB workflow and authority / technical + owner | G0, D-009 | 2–4 | One useful context/import/export workflow, source rights, mapping/freshness and native owner selected; refresh exact UB source and holds. |
| D-043 | Disconnected adapter compatibility proof / backend | D-010, D-042 | 4–7 | Synthetic two-source fixtures, scoped identity, incompatible version, duplicate/stale/replay and unavailable UB; native product still works with adapter disabled. |
| D-044 | Integration decision and separate estimate / owner + technical | D-043 | 2–3 | Record adopt/defer/reject, maintenance cost, real-provider prerequisites and permission boundaries. No live activation, remote writes or automatic ledger/stock authority. |

## Status updates

During authorized execution, record actual owner, task state, blockers, branch/commit and receipt link below the relevant row or in a linked task record. States: NOT STARTED, IN PROGRESS, BLOCKED, READY FOR VERIFICATION, VERIFIED, DEFERRED. Only current valid evidence supports VERIFIED. Initial estimates do not substitute for measured progress.
