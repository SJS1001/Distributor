# Distributor product plan

Date: 2026-09-30. Status: complete planning draft; implementation subsequently authorized, business decisions and gate evidence pending. Companion: [tasks](TASKS.md), [gates](CHECKPOINTS.md), [decisions](DECISIONS.md), [requirements](REQUIREMENTS.md), [contracts](CONTRACTS.md), [discovery workbook](DISCOVERY.md) and [delivery/risk plan](DELIVERY.md).

## Intended outcome

One distributor can receive equipment from suppliers, locate it across warehouses, accept customer orders online, reserve and fulfill stock, bill customers, reconcile payments, and handle warranty claims and returns. A serial's history connects receiving, transfers, sale, shipment, invoice and claim. Additional modules integrate through stable, versioned contracts.

This is a separate product and database. It must run without OPUS or Project UB. The owner subsequently authorized full engineering implementation while G0 remains unresolved; this authorization supersedes the original planning-only sequencing restriction. It does not waive operating, provider, hardware or release acceptance.

## Scope and bounded assumptions

| Area | Baseline to plan and verify |
| --- | --- |
| Organization and access | One distributor; staff roles, warehouse permissions, separate buyer accounts, audit history and account isolation |
| Catalog and procurement | SKUs, serial rules, suppliers, purchase orders, receipt inspection and opening cost evidence |
| Warehouses | Multiple warehouses modeled from the beginning; verify at least two, bins, in-transit transfers, quarantine and count adjustments |
| Equipment scanning | Phone camera and USB/Bluetooth scanner using the same application commands; manual fallback, label printing and serial identity |
| Online ordering | Proposed registered B2B portal, persistent carts, customer/tier prices, terms/credit holds, partial supply, backorders and cancellation |
| Billing | Invoices, credit notes, payments, account terms, price/tax snapshots and a selected external accounting handoff |
| Fulfillment | Pick/pack/ship or collection, partial shipments, labels/tracking with one selected carrier adapter, exception handling |
| Warranty and returns | Sold-serial coverage, claim evidence, approval, inspection, repair/replacement/credit and manual manufacturer handling |
| Extension | Module registration, dependency declarations, permissions, owning APIs, events, migrations and compatibility tests |
| Operations | Import/reconciliation, backups/restore, observability, operator training and controlled rollout |

Confirmed subsequent direction: US/Canada with USD/CAD, Stripe, QuickBooks and customer-controlled residency exceptions. Organizations use their selected regional currency without implicit FX. Major carrier/device coverage is requested, with candidates and qualification still to select. Pending assumptions: primarily whole-unit equipment, no public guest checkout, external accounting as financial system of record and healthy warehouse connectivity. These are not owner-approved requirements. G0 must resolve them; do not hide a required capability behind an assumption.

The [provider/device plan](PROVIDERS.md) defines the proposed major-provider matrix, customer-choice controls and per-service/device evidence required. It does not qualify any vendor or revise the historical effort into a commitment.

Excluded from the initial estimate unless selected at G0: full general ledger, complex rebates/EDI, supplier live feeds, automated manufacturer claims, native mobile app, autonomous offline fulfillment, RFID infrastructure and own-fleet driver/routing application. The historical effort estimate excluded multi-country taxation and broad provider/device coverage. The subsequent US/Canada direction expands qualification scope and requires a revised estimate; do not treat the old range as a commitment. Barcode/QR scanning is included. Read-only lookups and recording scan drafts while disconnected are an option, not evidence of authoritative offline stock reservation.

## Approach and early challenge

Recommended starting design: a modular application with a separate database and worker, shared authentication/audit primitives, and explicitly owned business modules. Do not build a marketplace plugin engine or distributed microservices platform merely to support future modules.

The strongest objection is that extracting OPUS preserves field-service coupling and creates a second maintenance burden. Conversely, assembling several open-source applications can create overlapping stock/order authorities and more integration work than it saves. Resolve this with D-002/D-003 and a two-week engineering proof after G0: demonstrate isolated receiving, a job-free invoice, and a limited return/credit using the candidate approach. Measure retained dependencies, actual effort and failure cases. Timebox the proof; an incomplete result triggers a revised recommendation and estimate rather than endless cleanup.

Compare three paths before committing: selected OPUS reuse; a narrow new core with permissive components; or adapting an existing ERP/inventory platform. The schedule below is for the selected-code/custom modular product, not an estimate for ERPNext configuration. Select only one authoritative inventory owner. If two routes remain plausible, use identical G1 scenarios to compare effort and correctness.

## Delivery sequence and calendar

With three dedicated developers (two backend/domain, one frontend/full-stack), QA at least half-time early and near full-time at pilot, plus weekly distributor operator participation:

| Phase | Indicative window from implementation kickoff | Exit gate |
| --- | --- | --- |
| Discovery and approach | Weeks 1–2 | G0: operating rules, license inventory, scope and measurable targets agreed |
| Independent proof and foundation | Weeks 3–6; proof itself limited to two weeks | G1: independent startup; real database proof; ownership and extension checks |
| Inventory, multi-warehouse and scanning | Weeks 7–15 | G2: conserved stock, concurrency and scanned serial traceability |
| Orders, portal and billing | Weeks 11–23 | G3 and G4: price/account isolation, allocations and reconciled money |
| Fulfillment, warranty and integrations | Weeks 17–28 | G5–G7: shipment/return lifecycle and selected provider sandbox evidence |
| Migration, operator cycles and production preparation | Weeks 26–42 | G8: rehearsals, restore, load and operator acceptance |

Windows overlap only when dependencies and interface contracts permit it. G1 extension work may continue after the initial proof, but inventory/order implementation does not bypass its security/ownership foundation.

**Planning range: a controlled pilot around weeks 26–32; production readiness around weeks 32–42.** The pilot follows integrated workflow and recovery rehearsals; it is not just an inventory demo. The baseline includes selected carrier sandbox qualification and an accepted accounting API/import handoff. If a manual carrier workflow or narrower pilot is chosen, record the changed scope, task acceptance and gate requirements, and re-estimate it separately. All required product areas need a usable bounded workflow at the baseline pilot. Multi-warehouse support and scanning are included, unlike the earlier one-warehouse extraction estimate.

Task effort is recorded in developer-days in TASKS.md: **248–396 days (approximately 50–79 person-weeks) for D-001–D-041**, plus **8–14 days** for optional UB qualification. Those ranges include task-local design, implementation, review and correction. They exclude staffing gaps, provider/certification waits, QA/operator time and optional native-app work. The calendar additionally allows for dependency sequencing, integration, operator availability and contingency. Recalculate the total and calendar after G0/G1; do not divide person-days by developer count to promise a date.

| Available staff | Conditional production planning range |
| --- | --- |
| Three dedicated developers + QA/operator | Approximately 8–10 months |
| Two dedicated developers + QA/operator | Approximately 10–14 months |
| One developer with occasional support | Approximately 16–24 months; pilot requires tighter sequencing |

These are engineering judgments, not measured commitments. AI assistance is not counted as an independent developer or assumed schedule multiplier. Reusable packages for other products, native mobile or production UB connectivity need additional estimates. Do not sum expansion allowances without reviewing overlap.

## Resources, cost and checkpoints

No software subscription or hosting budget is selected. D-006 records one-time engineering cost, hosting/storage/backups, scanner/label hardware, payment and carrier fees, ongoing maintenance and support. Use actual rates and quotes; open-source license fees do not represent total cost of ownership.

Each gate requires the receipts described in CHECKPOINTS.md. Discovery must choose the workload profile, latency/freshness targets, recovery time/recovery point, retention and cost ceiling before load or operations acceptance. Unknown targets are unresolved, not automatic passes.

Planning completion supplies the full requirement-to-task map, proposed workflow/data/command contracts, decision answer sheets, independent synthetic example, delivery packets, cost model and risk controls. It does not answer pending owner decisions or qualify the product. D-039 load/restore rehearsal follows G2–G7 and precedes D-038's final integrated CH-01–CH-11 rerun, then D-040 operator cycles and D-041 readiness review. This resolves the former implicit sequencing conflict without reducing acceptance scope or changing effort totals.

Critical path: business rules → approach/licensing proof → inventory allocation truth → order/fulfillment/billing agreement → selected provider qualification → migration/operator acceptance. Portal presentation and warranty policy design can run in parallel after their owning contracts are established. UB work is outside this critical path.

Re-estimate when the two-week proof fails, provider access is delayed, fractional units/case packs emerge, own-fleet delivery becomes required, or a different commercial delivery/licensing model is chosen. Report concrete impact on shared developer availability before assigning resources. Distributor's future CI uses GitHub-hosted runners under the owner's 2026-09-30 decision; assess hosted capability, usage/cost limits and concurrency before introducing workflows. Do not assume the same developers are fully dedicated to both products.
