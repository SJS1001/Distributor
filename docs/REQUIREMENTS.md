# Distributor requirements and traceability

Date: 2026-09-30. Status: planning package complete; engineering underway, business acceptance pending. [Plan](PLAN.md), [tasks](TASKS.md), [checkpoints](CHECKPOINTS.md), [discovery](DISCOVERY.md).

## Problem and intended users

The owner needs one distributor product connecting purchasing, warehouse stock, online orders, fulfillment, billing and warranty. A disconnected record chain makes it difficult to explain where equipment is, who owns it and which money or stock corrections a return requires. This is the owner's stated product need; no operator interviews or measured current-process baseline have yet been obtained.

Warehouse receivers and pickers need reliable equipment/location identity. Buyers need their own prices, orders and documents. Finance staff need reconciled invoices, credits and payments. Warranty staff need sold-serial history and approved dispositions. Administrators and support operators need permission controls, recovery and evidence of changes.

## Goals and measurement

1. Complete CH-01 from receiving through payment from each of two warehouses, preserving the serial/order/shipment/invoice chain.
2. Conserve quantities and stock cost in CH-02/03/04/06, including concurrent attempts on the last unit; no duplicate authorized allocation or business effect.
3. Deny every enumerated unauthorized account/site operation in CH-07, including exports, files and worker actions.
4. Recover CH-08/09/10 without duplicate irreversible effects, and meet the agreed workload and recovery targets collected in DEC-10.
5. Enable/disable the optional module and UB adapter in CH-11 while native operations remain usable.

For the pilot, observe order completion, scan rejection/recovery, time spent reconciling exceptions, stock/cost discrepancies and provider backlog over at least two agreed operating cycles. Record denominators and comparable baseline operations; D-006 sets numerical performance/adoption targets with the owner. Zero unaccounted stock/money effects is an invariant, not an assumed pilot result. Longer-term measures are repeat buyer use, operator support incidents and time to resolve claims; no promised improvement percentage exists without a baseline.

## Scope priorities

The baseline P0 requirements below all remain in scope. Delivery phases sequence them; an early slice is not a substitute for the complete baseline pilot. P1 candidates are saved lookup/scan drafts offline and richer reporting, subject to separately approved effort. P2 considerations are authoritative offline fulfillment, native mobile, RFID, own-fleet routing, automated manufacturer integrations, EDI and a full general ledger. They are excluded from the baseline estimate as described in PLAN.md. The owner subsequently selected US/Canada, USD/CAD, Stripe, QuickBooks and customer-controlled residency exceptions. Country-specific tax qualification and broad provider/device coverage require re-estimation; the historical baseline did not include that breadth. Optional UB qualification has its own estimate and gate.

## Requirement register

Each row names the decisive acceptance signal. Task-local acceptance in TASKS.md and full scenarios in CHECKPOINTS.md remain required; this table does not replace them.

| ID | Priority | Required outcome and acceptance | Tasks | Verification |
| --- | --- | --- | --- | --- |
| REQ-01 | P0 | Capture operating examples, select licensed build/reuse route, hardware scope, numerical targets, costs and staffing; unresolved inputs remain visible. | D-001, D-002, D-003, D-004, D-005, D-006 | G0; DEC-01–DEC-12 |
| REQ-02 | P0 | Fresh API/worker/UI/database runs without OPUS or UB; real receipt, job-free invoice and return/credit prove the selected approach. | D-007 | G1; CH-01, CH-06, CH-11 at proof depth |
| REQ-03 | P0 | Authenticated account/site permissions apply to every query, command, attachment, export and worker action; audited negative cases deny access. Regional storage is selected separately from each named processor exception; customer acceptance is versioned/audited and checked before outbound work. | D-008 | G1, G2, G3; CH-07 |
| REQ-04 | P0 | Modules own persistence/migrations; optional module registration and removal preserve base operations and reject foreign writes. | D-009, D-011 | G1; CH-11 |
| REQ-05 | P0 | Business commit and publication intent survive failure; duplicate/stale events and crash recovery yield one business effect. | D-010 | G1; CH-08, CH-09 |
| REQ-06 | P0 | Resolve SKU, serial and location identifiers; exact units and duplicate/ambiguous identifiers follow agreed product rules. | D-012 | G2; CH-05 |
| REQ-07 | P0 | Maintain conserved stock positions, movements, serial custody and valuation across two warehouses and quarantine. | D-013 | G2; CH-01, CH-03, CH-06 |
| REQ-08 | P0 | Purchase/receive partially, inspect unexpected equipment and handle supplier returns without duplicate stock/cost receipt. | D-014 | G2; CH-01, CH-05, CH-08 |
| REQ-09 | P0 | Dispatch/receive transfers and count stock with concurrency, shortage/damage and adjustment authority; quantities and costs reconcile. | D-015 | G2; CH-03 |
| REQ-10 | P0 | Reserve/release/consume exact stock separately from physical on-hand; last-unit competition has exactly one winner. | D-016 | G2; CH-02, CH-04, CH-08 |
| REQ-11 | P0 | Camera and selected hardware scan receipt/transfer/count/pick; wrong and duplicate scans are rejected, labels are readable and manual fallback works. | D-017 | G2, G5; CH-05; actual device receipts |
| REQ-12 | P0 | Private customer/tier pricing, credit policy, durable cart and accepted order evidence survive reload and duplicate submission. | D-018, D-019 | G3; CH-01, CH-02, CH-04, CH-07 |
| REQ-13 | P0 | Buyer completes ordering/payment and sees authorized history; partial supply, backorders, cancellation and reservations agree with shipments and invoices. | D-020, D-021 | G3; CH-01, CH-04, CH-07 |
| REQ-14 | P0 | Job-free exact invoice/credit arithmetic and agreed shipment/order trigger produce immutable numbered documents with reconciled quantities. | D-022, D-023 | G4; CH-01, CH-04, CH-06 |
| REQ-15 | P0 | Verified payment/refund outcomes, PDFs/delivery, balances, aging and exceptions reconcile; lost responses and repeated callbacks cannot double effects. | D-024, D-025 | G4; CH-07, CH-08, CH-09 |
| REQ-16 | P0 | Pick, pack, commit shipment or collection once; selected carrier labels/tracking, delivery exceptions and operator cycles work from both warehouse origins. | D-026, D-027, D-028, D-029 | G5; CH-01, CH-03, CH-04, CH-05, CH-09 |
| REQ-17 | P0 | Sold-serial coverage and claim authorization feed inspected RMA disposition, repair/replacement/restock/scrap or credit/refund once. | D-030, D-031, D-032, D-033 | G6; CH-06, CH-07, CH-08 |
| REQ-18 | P0 | Selected accounting API/import handoff maps and reconciles documents, corrections and rejected/duplicate deliveries. QuickBooks processing requires the current customer choice for that named provider. | D-034 | G7; CH-09 |
| REQ-19 | P0 | Import opening stock AND valuation/unpaid documents; monitor uncertain effects and rehearse support/recovery without publishing sensitive data. | D-035, D-036 | G7; CH-08, CH-09, CH-10 |
| REQ-20 | P0 | Review dependencies/licenses/security; qualify reproducible checks on GitHub-hosted runners if workflows are introduced. | D-037 | G7; CH-07, CH-11; CI environment receipts |
| REQ-21 | P0 | Rerun integrated scenarios at one candidate, meet load/restore targets, complete operator cycles and review release/rollback/training. | D-038, D-039, D-040, D-041 | G8; CH-01–CH-11 |
| REQ-22 | Optional | Qualify one useful synthetic UB workflow with scope/version/replay controls; record adopt/defer/reject and preserve disabled-adapter operation. | D-042, D-043, D-044 | G-UB; CH-08, CH-11; DEC-13 |

## User stories and proposed screens

Screen labels are proposed information architecture, not framework or visual-design decisions. Every mutation uses the owning command in [contracts](CONTRACTS.md).

| Persona and story | Entry and result | Empty/error/recovery behavior |
| --- | --- | --- |
| As a receiver, I want to reconcile a delivery to its PO so that only inspected equipment becomes available. | Purchase orders → expected lines → warehouse/bin → scan/enter serial → confirm receipt; links to movements and valuation. | Show remaining quantities; unexpected/duplicate/wrong serial requires correction or approved exception. Persist a draft without claiming stock receipt. |
| As a warehouse worker, I want stock by condition and location so that I do not pick quarantine or transit stock. | Inventory → product/serial history → transfer/count; before/after quantities and adjustment reason. | Clearly distinguish zero, unknown and stale data; reject conflicting revision and reload current state. |
| As a buyer, I want my quote/cart to survive interruption so that I can submit one correct order. | Authorized catalog → cart → review price/terms → submit → order details/history. | Empty cart has an ordering path; changed price/terms requires confirmation; reconnect queries original submission before retrying. |
| As a picker, I want to verify the allocated serial so that the correct customer receives it. | Fulfillment queue → shipment → pick/scan → pack → ship/collect; explicit confirmation and tracking. | Short pick opens an exception; wrong site/serial fails without movement; unknown carrier outcome shows reconciliation action. |
| As finance staff, I want original document/payment links so that I can explain balances and corrections. | Receivables → invoice/PDF → payment allocation → credit/refund → reconciliation. | Numbered documents are corrected by linked documents; pending/unknown payments are distinct from settled; incomplete accounting exports remain visible. |
| As warranty staff, I want sold-serial evidence so that I can approve a claim and its disposition. | Serial history → claim → evidence/review → RMA → inspection → disposition → credit/replacement history. | Unsold/unlinked serial or expired policy requires an explicit denial/review; return stock remains quarantine until inspected. |
| As an administrator/support operator, I want scoped grants and failed-work receipts so that recovery is controlled and auditable. | Accounts/warehouse grants; import rehearsal, outbox/provider exception queue, restore runbook. | No automatic elevation; destructive adjustment/replay presents reason and effect scope; secrets never appear in logs or exports. |

All screens need keyboard operation, clear labels, focus/error association, readable status independent of color, loading/empty/denied states and usable narrow-screen scanning. Test actual camera permissions and hardware focus/suffix behavior. DEC-09 and D-017 select the supported device/browser matrix; this document does not certify any device.

## Open questions and change control

DEC-01–DEC-12 are G0 business/route/resource inputs; DEC-14 controls publication, DEC-13 controls optional UB adoption. [Discovery](DISCOVERY.md) defines their answer artifacts. Technical stack/schema details become executable only after route selection and implementation authorization. A scope change updates this register, task acceptance, scenario expectations, estimate and affected receipts together. No requirement is removed merely to obtain an earlier green check.
