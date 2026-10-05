# Decisions and discovery inputs

Date: 2026-09-30. A proposal is not an approved business rule. Owner columns identify responsibilities, not assigned people.

## Accepted continuation — 2026-10-03

The owner accepted the [missing-input recommendations](MISSING-INPUT-RECOMMENDATIONS.md) and instructed implementation to continue. Proceed with qualified manual Purolator shipping pending its current contract, source-bound all-organization restore reconciliation with separate finance/security approval and writer fencing, and immutable ledger-outcome-dependent accounting corrections under explicit monthly/closed-period and posting ownership policies. RPO 15 minutes/RTO four hours are accepted rehearsal design targets, not measured production commitments. Preserve each customer’s established valuation; propose specific identification/FIFO only for new finance-approved deployments. Actual customer mappings, approvers, provider outcomes, contracts, regional infrastructure and release evidence remain to be qualified. This acceptance does not verify a task or product gate.

## Confirmed direction

- One distributor, potentially multiple warehouses.
- Billing, online ordering, inventory, warranty and logistics are required.
- Equipment scanning and open-source reuse must be evaluated.
- Additional modules should be easy to add; evaluate the benefit of Project UB.
- Separate repository: SJS1001/Distributor. Local path: /Users/stevensmith/Documents/Distributor.
- The owner subsequently authorized building the full system on 2026-09-30. This supersedes the earlier planning-only scope without passing discovery or product gates.
- Target countries: US (interpretation of “use”) and Canada, with data residency. Target payments: Stripe. Target accounting: QuickBooks (Online proposed; edition still to confirm). Major carrier/scanner/printer support requested; exact vendors, services and devices require qualification.
- Residency is a customer choice, per the owner's follow-up. Default strict regional storage; named processor exceptions require an explicit customer choice. No claim that a provider exception keeps all processing in Canada. Actual regional hosting/migrations still require qualification.
- The [provider/device qualification plan](PROVIDERS.md) translates major-provider coverage into a proposed candidate matrix. These are engineering candidates, not owner-selected contracts, purchased devices or qualified integrations. Independent named choices and immutable disclosure acceptance/enforcement now exist locally; actual vendor terms, customer authority, services and adapters still need qualification before activation.
- Future CI uses GitHub-hosted runners, per the owner's instruction on 2026-09-30.

## CI runner decision

Current execution restriction: direct workstation checks; no local/self-hosted or cloud CI jobs. On 2026-10-02 the owner explicitly requested committing all work to the GitHub repository, authorizing this Distributor source/test/documentation snapshot to be pushed on the current branch. This supersedes the earlier local-only restriction for this snapshot. No PR, merge, deployment or workflow creation is authorized. The future hosted-runner decision below remains the intended policy once CI is separately authorized.

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
| DEC-14 | Public source versus private implementation; own project license and publication scope? Repo is public; owner authorized the current original Distributor source/test/documentation snapshot on 2026-10-02. No product license chosen; OPUS/UB/private data and broader redistribution remain excluded. | Repository owner | Current snapshot authorized; revisit before further export or distribution |

## Required examples

The [discovery workbook](DISCOVERY.md) provides answer artifacts for all DEC entries, target/cost/staffing fields and a synthetic stock/money walkthrough. Its illustrative tax, valuation, billing and return rules are discussion inputs, not owner-approved decisions. The owner first clarified planning-only scope, then subsequently authorized full implementation. US/Canada, residency, Stripe and QuickBooks are now direction; tax registrations/rules, accounting edition/company mappings, exact carrier/hardware choices and vendor qualification remain unresolved. Customer choice of named processor exceptions is approved direction; specific reviewed terms and qualified processing locations remain pending.

Use synthetic or explicitly approved de-identified samples locally: SKU/customer exports, serial and product labels, purchase order/receipt, order, invoice/credit, packing slip, transfer and warranty claim. Include opening quantities AND valuation layers/cost evidence. Store sensitive material outside tracked files and describe provenance/permission. Do not import live customer information during this planning task.

## Decision record format

For each settled choice record date, responsible reviewer, rationale, considered alternative, affected tasks/contracts, verification signal and revisit trigger. A decision affecting costs or operations is not silently made by a developer. Technical details within a later authorized scope can be selected without reopening settled business choices.

All DEC items above are pending except the confirmed direction. Missing business answers block the relevant gate, not unrelated planning work.

## Researched recommendations — 2026-10-02

The owner asked for research or recommendations for each of the three identified coding prerequisites. [The recommendations](MISSING-INPUT-RECOMMENDATIONS.md) now supply concrete Purolator contract intake/manual interim shipping, restored-store reconciliation/release/rollback controls, and accounting valuation/period/immutable correction proposals. [Purolator research](research/PUROLATOR-CONTRACT-2026-10-02.md) records fresh official-source access limitations and an exact specification checklist.

These are proposed configurable design inputs, not newly confirmed business decisions. They permit bounded policy-model and synthetic engineering work without selecting real approvers, inventing vendor requests, rewriting an established costing method, claiming actual ledger reconciliation or releasing a restored store. DEC-06, DEC-07, DEC-10 and DEC-12 remain pending for actual operational acceptance; all task/gate statuses remain unchanged.


## Initial schema compatibility contract — 2026-10-01

Engineering selection within implementation authority: fresh initialization commits module DDL, constructor backfills and a platform version receipt together. Normal startup validates the exact versioned profile before constructors; nonempty unversioned, changed and future layouts fail closed. A separate local operator CLI can clone only the frozen previous release or supported current layout to a fresh same-region file, adding legacy version metadata without altering business facts. See [schema upgrades](SCHEMA-UPGRADES.md) for review, cutoff, reconciliation and remaining qualification.

This bounded contract replaces implicit startup repair with explicit version evidence. It does not select production writer authority, hosting, RPO/RTO or a cutover policy. Destructive/earlier/rolling migrations require new supported versions and fixtures; authorization and product gate statuses are unchanged. Revisit before any module schema change, restore of an older archive, or qualified production release.


## Code wiring before server qualification — 2026-10-04

The owner requested completion of code-level wiring and correctness checks while deferring server connections and wider operational testing. Distributor already has a Node/Fastify backend, SQLite module-owned persistence and an API-connected React frontend. [Shared runtime composition and the protected restore operator](RUNTIME-WIRING.md) now define the reviewed host configuration point and fixed native dispatch. No synthetic production authority is installed. Actual hosting choices, current-trust/source/provider host implementations, server connections, residency and operational qualification remain deferred until authentic inputs are available; the current Purolator contract and unresolved license/distribution rights remain outstanding. Existing product gates stay NOT VERIFIED. No PR, merge, CI/runner, provider IO or deployment is authorized by this sequencing decision.


## Canadian small-pilot launch — 2026-10-05

Owner direction: focus on the real Canadian application, defer the demo/MVP, use Fly.io for one or two testers, and combine the website, login and contractor purchase application at the GoDaddy-registered dstrbtr.ca. The owner approved the proposed US$10–15 monthly pilot estimate and domain setup, superseding the earlier no-deployment restriction for this bounded installation. One Toronto Machine and persistent volume are deployed; no scale-out, remote builder or CI is configured. This is a pilot infrastructure choice, not formal production acceptance or an assurance that every ancillary processing location is Canadian.

Enrollment follows the recommended staff-approved B2B policy: applications do not create buyers; an administrator reauthenticates to approve explicit commercial terms and issues a private, expiring, single-use activation link. Invitations are handed over manually; no email service or verified email ownership is claimed. The real store contains no demonstration customers/products. See [Fly runbook](FLY-CANADA.md), [enrollment policy](ENROLLMENT.md) and [launch receipt](evidence/LIVE-CANADA-LAUNCH-2026-10-05.md). Revisit hosting, capacity, backup custody, residency and enrollment delivery before valuable customer data or wider release. All task/product gates retain their independent acceptance requirements.


## Public test-pilot administrator login — 2026-10-05

The owner explicitly chose pre-filled credentials for the current pilot after
being told that visitors would receive full administrator access, including data
and user changes. A separate demo was offered and declined; the owner confirmed
that this installation does not yet hold real information. Apply this as an
explicit, default-disabled runtime setting only. Do not change the administrator
password or silently provision a different database/account. Revisit and remove
public access before real data, as documented in [Fly configuration](FLY-CANADA.md).
