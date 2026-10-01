# Discovery workbook and G0 packet

Date: 2026-09-30. Status: prepared for owner/operator input; answers and sign-off pending. Supports D-001–D-006; [decision register](DECISIONS.md) is authoritative for settled choices.

## Sessions and outputs

| Session | Participants by responsibility | Inputs and concrete output | Tasks |
| --- | --- | --- | --- |
| Equipment and warehouse cycle | Owner, receiver, warehouse lead, logistics | Approved label/PO/receipt/transfer examples; identifier/UOM and custody rules; two warehouse layouts; shipment and collection exceptions. | D-001, D-005 |
| Order and money cycle | Owner, buyer representative, commercial/finance lead | Quote/order/partial-supply/cancellation/invoice/payment/credit workbook with independently calculated totals and agreed triggers. | D-001, D-004 |
| Warranty and reverse cycle | Warranty, warehouse and finance leads | Sold serial → coverage → claim → inspection → repair/replacement/credit examples; authorized approvers and manufacturer manual process. | D-001, D-004 |
| Source/approach and operating envelope | Owner, technical/license reviewer, operations | Versioned rights/dependency manifest, build/reuse comparison, chosen proof scope, numerical workload/recovery targets, cost inputs and named staffed capacity. | D-002, D-003, D-006 |

Use synthetic examples first. Actual samples require rights/provenance and de-identification review; keep sensitive source material outside git. Sessions can overlap when participants are available; no date or attendance has been promised.

## Answer sheets

For every sheet record answer, rationale, responsible human, date, approved example, affected task/scenario, limitation and revisit trigger. Blank answers remain pending. A proposed default from PLAN.md is not a recorded owner decision.

| Decision | Required answer artifact | Branch in the plan if different |
| --- | --- | --- |
| DEC-01 | Product categories; unit/case conversion; serial uniqueness scope; GTIN/SKU/serial/location label examples; duplicate/reused serial policy. | Fractional units or manufacturer-only identifiers change D-012/013/017 fixtures and effort. |
| DEC-02 | B2B/public buyer types, account onboarding, order approval and permitted purchase/payment methods. | Retail/guest ordering revises account, tax/payment and portal requirements. |
| DEC-03 | A/B warehouses and bins; dispatch/receipt ownership; quarantine; cycle-count cutoffs; shortage/damage and adjustment approvals. | Negative stock or authoritative offline transactions need a revised invariant and estimate. |
| DEC-04 | Price tiers, overrides, discounts, shipping/tax rounding, credit exposure components, holds and quote expiry. | Concurrent credit exposure must be enforced at acceptance; rules affect D-018/019/022. |
| DEC-05 | Invoice trigger; partial/deposit/prepayment handling; cancellation after pick/ship; credit/refund authorization and cutoff. | Change worked fixture triggers and D-021/023/024/033 together. |
| DEC-06 | Country/currency, tax reviewer and authoritative accounting system; posting/import format, reconciliation cutoff and cost valuation method. Confirmed: US/Canada, USD/CAD, Stripe, QuickBooks and customer choice. Required evidence: physical application/backup/log residency and separate provider disclosures, customer acceptance/withdrawal and minimum fields; accounting edition/company mappings remain pending. | Additional tax/currency/general-ledger scope changes estimate and provider qualification. |
| DEC-07 | Selected carrier/collection or own-fleet scope; multi-origin freight, tracking and proof-of-delivery requirements. | Own-fleet routing is separately scoped; manual labels require explicit baseline change. |
| DEC-08 | Coverage start/end, transferability, sold/returned/replacement serial treatment, claim approvals and manufacturer process. | Automated manufacturer integration or different coverage policies revise D-030–D-033. |
| DEC-09 | Camera/browser/scanner/printer/label matrix, suffix/focus behavior, warehouse connectivity and offline authority. | Native/authoritative offline scope requires new security/conflict proof and effort. |
| DEC-10 | Workload and freshness/latency/availability/RPO/RTO/retention/cost target sheet below, including measurement and acceptance reviewer. | Unknown targets prevent load/recovery acceptance; revised targets invalidate relevant receipts. |
| DEC-11 | Chosen build/reuse route, exact source/licenses, distribution model, rights reviewer, maintenance cost and two-week proof scope. | Whole-platform adoption replaces the custom-product architecture/estimate, rather than retaining an unsuitable schedule. |
| DEC-12 | Named people and available days/week; QA/operator coverage, integration access and support/release authority. | Fractional/shared staffing changes sequencing and calendar; no AI staffing multiplier. |
| DEC-13 | One optional UB workflow and its source rights; adopt/defer/reject with prerequisites and separate cost. | Keep G-UB optional unless owner explicitly changes baseline scope. |
| DEC-14 | Public/private publication scope and project license, including permitted reuse/customer materials. | Do not publish/copy ambiguous source; local planning can continue. |

## Operating target sheet

All target values are **TBD by owner/operations in D-006**. Collect both normal and peak windows; define the exact observation method. The receipt must report actual results against selected values.

| Dimension | Record | Used by |
| --- | --- | --- |
| Data envelope | Catalog size, customers, active serials, movement/doc history, attachment bytes, import row count and annual growth. | D-013, D-035, D-039 |
| Workload | Orders/hour, lines/order, scans/minute/site, simultaneous staff/buyers, provider callback bursts and peak duration. | D-016, D-019, D-038, D-039 |
| Performance | p95 command latency; portal page/scan response; projection freshness and maximum exception backlog age, with error-rate threshold. | D-017, D-020, D-036, D-039 |
| Availability | Service hours, acceptable outage duration, maintenance window and degraded/manual operations. | D-036, D-040, D-041 |
| Recovery | RPO, RTO, restore scope, backup interval/retention, pending-effect reconciliation and recovery human. | D-036, D-039, D-041 |
| Security/retention | Account/session requirements, audit/document retention, attachment constraints, log redaction and deletion/legal-hold owner. | D-008, D-025, D-037 |
| Economics | Currency, engineering/QA/operator rates, hardware, monthly hosting/backups/storage/CI limits and provider transaction costs. | D-006, D-037, D-041 |

## Synthetic worked example for discussion

This example demonstrates the oracle format, not approved tax, pricing, valuation, warranty or invoicing rules. It selects whole units, one currency, 10% illustrative tax, shipment-trigger billing and specific serialized cost for discussion only. After G0, replace these choices with approved values while retaining this draft as superseded history. No production inference should use its tax rate.

Opening fixture: organization D; warehouses A/B; buyers C1/C2. A receives S1 and S2, each costing 60.00; B receives S3 costing 70.00. All three are initially usable, total stock value 190.00. Quote C1 two units at 100.00 each; illustrative tax 10.00/unit. Independent expectations:

| Step | A physical / reserved / usable available | B physical / reserved / usable available | Transit units | Financial/cost oracle |
| --- | --- | --- | --- | --- |
| Receipts inspected | 2 / 0 / 2 | 1 / 0 / 1 | 0 | Stock value 190.00; no sale or receivable. |
| Reserve S1/S2 for C1 | 2 / 2 / 0 | 1 / 0 / 1 | 0 | Stock value unchanged; accepted order gross 220.00. |
| Pick/pack S1 | 2 / 2 / 0 | 1 / 0 / 1 | 0 | Custody/location may change; physical stock and invoice unchanged. |
| Commit shipment of S1 | 1 / 1 / 0 | 1 / 0 / 1 | 0 | Stock value 130.00; cost issued 60.00; invoice 100.00 + 10.00 = 110.00. |
| Cancel unshipped S2 | 1 / 0 / 1 | 1 / 0 / 1 | 0 | No second shipment/invoice; order supplied=1, canceled=1. |
| Verified payment 110.00 | 1 / 0 / 1 | 1 / 0 / 1 | 0 | Receivable zero; payment applied once, cash inflow 110.00. |
| Dispatch S2 from A to B | 0 / 0 / 0 | 1 / 0 / 1 | 1 | Total internal stock remains 2 units/value 130.00 including transit. |
| Receive S2 damaged at B | 0 / 0 / 0 | 2 / 0 / 1 | 0 | S2 quarantined, S3 usable; value 130.00 before any separately approved impairment. |
| Receive customer return S1 in B quarantine | 0 / 0 / 0 | 3 / 0 / 1 | 0 | Restore 60.00 stock cost under this fixture's approved-return rule: stock 190.00; no automatic credit/refund. |
| Inspect and approve S1 restock plus full credit/refund | 0 / 0 / 0 | 3 / 0 / 2 | 0 | Credit 110.00; refund 110.00 after verification. Net invoiced, tax, cash and receivable all zero; net cost issued zero. S2 remains quarantined. |

Physical includes quarantine; usable available excludes quarantine and reservations. Reservations only reference usable physical units. Total internal units equals physical across sites plus transit; total stock value includes quarantine/transit under this illustrative valuation rule. Every step has a linked serial movement and actor/evidence. Repeating any committed command with the same key leaves these expectations unchanged.

Separate fault fixtures: two simultaneous orders for only S3 must have one allocation winner; a wrong-site/wrong-serial scan must have no stock effect; C2 must not read C1's order/document; crash after shipment commit must not re-issue S1; lost provider success must be reconciled before a new external effect; damaged transfer quantity must stay visible rather than disappearing into an adjustment.

## Route comparison and source manifest

Score each credible route against the same REQ-02/G1 cases: startup independence, retained field-service dependencies, reservation/cost correctness, source/publication rights, operator fit, extension ownership, maintainability and measured proof effort. Record evidence and disadvantages rather than guessing numerical scores. D-003 records the chosen route and why alternatives lost; failing the two-week proof reopens the choice.

For every reused file/package record upstream URL, commit/release, path/hash, actual license/notices, transitive dependency review, modifications, distribution treatment, rights reviewer, vulnerability/update owner and retained OPUS/UB coupling. REUSE.md is a shortlist and historical assessment; it is not this approved manifest.

## G0 review packet

- D-001: agreed normal/partial/transfer/return/warranty examples, persona approvals and source permission.
- D-002: pinned rights/license/dependency manifest and publication boundaries.
- D-003: selected route, compared alternatives and limited proof with failure/revisit conditions.
- D-004: independently calculated commercial/financial workbook and authorized triggers.
- D-005: selected hardware/label/connectivity scope and candidate qualification matrix.
- D-006: numerical target/cost/staffing sheet and revised calendar.

The responsible humans record their observations/decisions. G0 remains NOT VERIFIED until the packet is actually reviewed; this prepared workbook does not supply answers or signatures. Full engineering was subsequently authorized; this does not supply G0 review, commercial approvals or product acceptance.
