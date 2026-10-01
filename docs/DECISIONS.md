# Decisions and discovery inputs

Date: 2026-09-30. A proposal is not an approved business rule. Owner columns identify responsibilities, not assigned people.

## Confirmed direction

- One distributor, potentially multiple warehouses.
- Billing, online ordering, inventory, warranty and logistics are required.
- Equipment scanning and open-source reuse must be evaluated.
- Additional modules should be easy to add; evaluate the benefit of Project UB.
- Separate repository: SJS1001/Distributor. Local path: /Users/stevensmith/Documents/Distributor.
- The owner subsequently authorized building the full system on 2026-09-30. This supersedes the earlier planning-only scope without passing discovery or product gates.
- Target countries: US (interpretation of “use”) and Canada, with data residency. Target payments: Stripe. Target accounting: QuickBooks (Online proposed; edition still to confirm). Major carrier/scanner/printer support requested; exact vendors, services and devices require qualification.
- Residency is a customer choice, per the owner's follow-up. Default strict regional storage; named processor exceptions require an explicit customer choice. No claim that a provider exception keeps all processing in Canada. Actual regional hosting/migrations still require qualification.
- The [provider/device qualification plan](PROVIDERS.md) translates major-provider coverage into a proposed candidate matrix. These are engineering candidates, not owner-selected contracts, purchased devices or qualified integrations. Independent named carrier choices now exist locally; vendor-specific disclosures, services and adapters still need qualification before activation.
- Future CI uses GitHub-hosted runners, per the owner's instruction on 2026-09-30.

## CI runner decision

Current execution restriction: local commits and direct workstation checks only, per the owner's subsequent instruction. Do not start local/self-hosted or cloud CI jobs or push this work. The future hosted-runner decision below remains the intended policy once CI is separately authorized.

- Date/reviewer: 2026-09-30; repository owner, by explicit instruction in chat.
- Decision/rationale: Distributor will use GitHub-hosted runners. The owner selected GitHub's hosted infrastructure instead of the local fleet; no additional technical rationale was supplied.
- Superseded alternative: the initial self-hosted fleet requirement in AGENTS.md and D-037. This exception applies only to Distributor.
- Affected rules/tasks: AGENTS.md, D-037 and future workflow design. Check hosted OS/capability suitability, Actions permissions, usage/cost limits and workflow security before introducing CI.
- Verification signal: workflow definitions select GitHub-hosted runners and actual runs identify the hosted environment. Actions is currently enabled with zero workflows; no CI run or capacity qualification is claimed.
- Revisit trigger: owner changes direction, hosted capabilities cannot meet requirements, or usage/cost limits require a new decision.

## Decision register

| ID | Question / proposed default | Responsibility | Needed before |
| --- | --- | --- | --- |
| DEC-01 | Product categories, serial uniqueness, label formats, units/case packs and quantities? Default whole-unit equipment is unconfirmed. | Distributor operator | G0 / D-001 |
| DEC-02 | B2B account portal only, public retail, or both? Who can order and approve? | Product owner | G0 / D-001 |
| DEC-03 | Warehouse/bin layout, transfer dispatch/receipt, inspection/quarantine, counts and negative-stock policy? | Warehouse operator | G0 / D-001 |
| DEC-04 | Price tiers, overrides, discounts, shipping/tax, credit exposure/holds and acceptance snapshots? | Commercial/finance owner | G0 / D-004 |
| DEC-05 | Invoice at order, shipment or another trigger? Partial supply, deposits, cancellation, returns and refund rules? | Finance owner | G0 / D-004 |
| DEC-06 | Country/currency/tax obligations; accounting platform and authoritative reconciliation/cutoff? | Finance owner | G0 / D-004 |
| DEC-07 | Carrier/collection versus own fleet; freight labels and proof of delivery requirements? | Logistics owner | G0 / D-001 |
| DEC-08 | Coverage starts at sale/delivery/registration? Transferability, manufacturer process, repair/replacement and returned serial policy? | Warranty owner | G0 / D-001 |
| DEC-09 | Camera, scanner models, printer/label samples, warehouse connectivity, need for native or authoritative offline app? | Warehouse operator | G0 / D-005 |
| DEC-10 | Peak order/scan volume, staff concurrency, catalog/serial sizes, retention, latency/freshness, availability, RPO/RTO and cost ceiling? | Owner + operations | G0 / D-006 |
| DEC-11 | Selected OPUS extraction, permissive custom core, or whole-platform adaptation? Source ownership, publication rights and proprietary versus copyleft delivery? | Owner + technical/license reviewer | G0/G1 / D-002, D-003 |
| DEC-12 | Dedicated team, QA/operator availability, integration access and release responsibility? | Product owner | G0 / D-006 |
| DEC-13 | Optional UB context/mapping now, later, or no UB? Proposed: defer production adoption, preserve adapter seam. | Product owner + technical reviewer | D-042–D-044 |
| DEC-14 | Public source versus private implementation; own project license and publication scope? Repo is currently public; no license chosen. | Repository owner | Before any source export/push |

## Required examples

The [discovery workbook](DISCOVERY.md) provides answer artifacts for all DEC entries, target/cost/staffing fields and a synthetic stock/money walkthrough. Its illustrative tax, valuation, billing and return rules are discussion inputs, not owner-approved decisions. The owner first clarified planning-only scope, then subsequently authorized full implementation. US/Canada, residency, Stripe and QuickBooks are now direction; tax registrations/rules, accounting edition/company mappings, exact carrier/hardware choices and vendor qualification remain unresolved. Customer choice of named processor exceptions is approved direction; specific reviewed terms and qualified processing locations remain pending.

Use synthetic or explicitly approved de-identified samples locally: SKU/customer exports, serial and product labels, purchase order/receipt, order, invoice/credit, packing slip, transfer and warranty claim. Include opening quantities AND valuation layers/cost evidence. Store sensitive material outside tracked files and describe provenance/permission. Do not import live customer information during this planning task.

## Decision record format

For each settled choice record date, responsible reviewer, rationale, considered alternative, affected tasks/contracts, verification signal and revisit trigger. A decision affecting costs or operations is not silently made by a developer. Technical details within a later authorized scope can be selected without reopening settled business choices.

All DEC items above are pending except the confirmed direction. Missing business answers block the relevant gate, not unrelated planning work.
