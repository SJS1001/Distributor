# Distributor

Independent distributor application and planning workspace for multiple warehouses. Repository: [SJS1001/Distributor](https://github.com/SJS1001/Distributor).

**Status: implementation in progress, 2 October 2026.** The owner authorized the full system after completing the planning package. See [implementation status](docs/IMPLEMENTATION.md) for actual code, commands and remaining qualification. The owner-authorized snapshot is published on `codex/local-distributor-checkpoint`; the full system remains incomplete.

The intended product covers billing, online ordering, inventory, equipment scanning, fulfillment/logistics and warranty/returns. Modules should be added through defined interfaces without rewriting the product core. Project UB is a candidate optional integration, not a prerequisite for routine distributor operations.

## Start here

| Document | Purpose |
| --- | --- |
| [Plan and timeline](docs/PLAN.md) | Scope, assumptions, delivery sequence, staffing and realistic ranges |
| [Task list](docs/TASKS.md) | 44 numbered tasks with dependencies, effort, acceptance criteria and evidence |
| [Checkpoints](docs/CHECKPOINTS.md) | Gates, repeatable scenarios, evidence rules and current status |
| [Architecture](docs/ARCHITECTURE.md) | Module ownership, extension contract, scanning and bus boundaries |
| [Requirements and workflows](docs/REQUIREMENTS.md) | Full scope mapped to tasks/checkpoints, personas, screens and acceptance |
| [Proposed domain contracts](docs/CONTRACTS.md) | Records, commands, states, authorization and failure behavior |
| [Discovery workbook](docs/DISCOVERY.md) | Decision answer sheets, target inputs and independent synthetic stock/money example |
| [Delivery and risks](docs/DELIVERY.md) | Review packets, staffing/cost controls, risks, future CI and operating/release plan |
| [Decisions and inputs](docs/DECISIONS.md) | Confirmed direction, proposed choices and unanswered business questions |
| [Reuse assessment](docs/REUSE.md) | OPUS extraction, open-source shortlist, licensing and UB readiness |
| [Billing documents and aging](docs/BILLING-DOCUMENTS.md) | Original invoice/credit PDFs, prepared requests, current balances and qualification limits |
| [Invoice checkout access](docs/CHECKOUT.md) | Fresh scoped payment links, reviewed closure/replacement, retained verification history and native balance checks |
| [Order queue](docs/ORDER-QUEUES.md) | Scoped twenty-header pages, live state filters, full open-order counts and retry/history controls |
| [Catalog lifecycle](docs/CATALOG-LIFECYCLE.md) | Reviewed retirement/reactivation, staff search, retained history and customer-ordering effects |
| [Customer pricing](docs/CUSTOMER-PRICING.md) | Current assigned-customer prices, selected-account quantity editing, fresh quotes and saved cart recovery |
| [Purchase order entry](docs/PURCHASE-ENTRY.md) | Paged supplier/product selection, explicit original costs and retained exact-attempt recovery |
| [Purchase order queue](docs/PURCHASE-QUEUES.md) | Scoped twenty-header pages, live state filters and saved receipt drafts independent of visible orders |
| [Invoice queue](docs/INVOICE-QUEUES.md) | Scoped twenty-header pages, current balance filters, full receivable totals and credit publication independent of visible invoices |
| [Stock and replacement search](docs/STOCK-QUEUES.md) | Scoped twenty-record stock pages, full availability totals and independent eligible replacement serial search |
| [Stock bin movement](docs/BIN-RELOCATION.md) | Reviewed whole or partial bulk relocation, retained locations, exact retries and conserved original cost |
| [Stock movement history](docs/STOCK-HISTORY.md) | Scoped serial/bulk pages, current positions, original movement costs and exact read retry |
| [Transfer queue](docs/TRANSFER-QUEUES.md) | Scoped twenty-header pages, live custody-state filters, reference identifiers and exact page retries |
| [Serial dossier](docs/SERIAL-DOSSIER.md) | Scoped receipt, movement, shipment, invoice and claim lineage with browser paging, retry and refresh |
| [Order reservation deadlines](docs/RESERVATIONS.md) | Reviewed unpicked releases, retained picked stock, explicit renewal and buyer-visible history |
| [Supplier returns and finance follow-up](docs/SUPPLIER-RETURNS.md) | Original-cost handover, supplier credit evidence, received replacement links and reviewed corrections |
| [Unsent accounting credit cancellation](docs/ACCOUNTING-CANCELLATIONS.md) | Reviewed local capacity release, retained history and uncertainty/restore refusals |
| [Stock cost accounting handoffs](docs/ACCOUNTING-COSTS.md) | Reviewed original-cost journals, regional files and receiver evidence |
| [Scanning and saved receipt drafts](docs/SCANNING.md) | Camera/manual input, saved evidence and explicit stock confirmation |
| [Fulfillment, delivery and short picks](docs/FULFILLMENT.md) | Packed commitments, delivery history, shortage holds, backorders and separate count review |
| [Bulk count review duties](docs/COUNT-REVIEWS.md) | Saved organization policy, independent approval, stale review and immutable decision history |
| [Warranty and replacements](docs/WARRANTY.md) | Native returns, replacement collection/dispatch, manufacturer evidence and remaining qualification |
| [Runtime installation](docs/RUNTIME.md) | Production dependencies, required package inputs and isolated local startup checks |
| [Load and recovery rehearsal](docs/LOAD-RECOVERY.md) | Configurable synthetic concurrent writers/readers, cutoff restore and measured local limits |
| [Schema startup and upgrades](docs/SCHEMA-UPGRADES.md) | Atomic initialization, exact supported versions and reviewed fresh-file clones |
| [User access](docs/USER-ACCESS.md) | Staff/buyer grants, password changes, resets, optional/required role MFA and session revocation |
| [Local event reporting](docs/EVENTS.md) | Bounded optional report processing, scoped diagnostics and reviewed failure recovery |
| [Operations health](docs/OPERATIONS-HEALTH.md) | Current organization queue counts, creation age, due checks and recovery hold without processing work |
| [Stock and billing reconciliation](docs/RECONCILIATION.md) | Native control totals, bounded discrepancy details and investigation limits |
| [Providers, residency and devices](docs/PROVIDERS.md) | Customer choice, major-provider candidates and local provider operations |
| [Evidence instructions](docs/evidence/README.md) | Receipt template for future verification |
| [Handoff](docs/HANDOFF.md) | Historical setup and current implementation continuation |

All product checkpoints are **NOT VERIFIED**. Documentation is not evidence that a business workflow works. Implementation authorization permits engineering work; outstanding discovery decisions still require owner/operator evidence.

Future GitHub Actions workflows will use **GitHub-hosted runners**, as instructed by the owner on 2026-09-30. The repository has no workflows yet; see [the CI decision](docs/DECISIONS.md#ci-runner-decision).

The owner authorized committing all work and pushing the current Distributor source, tests and documentation to this repository on 2026-10-02. Verification uses direct workstation commands; PRs and local/cloud CI runner jobs remain unauthorized. No Actions workflow is present. Private runtime data, credentials and private verification artifacts are excluded.

No product license has been selected. A public repository is not by itself permission to republish OPUS, UB, customer information or third-party code.

The planning package is complete as a reviewable draft. Owner/operator answers and G0 approval remain pending. Validate its links, task/gate dependencies, effort and traceability locally with `python3 scripts/verify_plan.py`; the [historical planning review receipt](docs/evidence/PLANNING-REVIEW-2026-09-30.md) records the content checked before implementation and its limits.

The [latest planning choices/access review](docs/evidence/PLANNING-CHOICES-2026-09-30.md) records customer residency acceptance criteria and fresh read-only GitHub access. Historical implementation receipts remain separate from planning acceptance.

Reviewed ordinary carrier booking coordination and its default-disabled adapter boundary are described in [the carrier runbook](docs/CARRIER-BOOKINGS.md). Original default-disabled UPS/FedEx sandbox, USPS TEM and DHL test protocol clients have local synthetic coverage and explicit opt-in server configuration. FedEx, USPS and DHL lost-response recovery remains unsupported and uncertain bookings stay blocked; actual carrier protocols/services and product gates remain unqualified.

Ordinary carrier bookings now retain [reviewed account/service/date configuration](docs/CARRIER-BOOKINGS.md#reviewed-ordinary-carrier-configuration), refuse drift before I/O and show warehouse review/history controls. Local synthetic verification does not qualify actual carriers, devices or product gates.

The [DHL test client](docs/CARRIER-BOOKINGS.md#dhl-express-test-client) retains transport, waybill and customs invoice pages together and checks the exact reviewed companies, goods and tender time. Its warehouse form now collects explicit company, tender and packed-goods declarations and displays retained history; see [the local UI receipt](docs/evidence/LOCAL-DHL-UI-2026-10-01.md). Synthetic fixtures do not qualify customs or actual provider behavior.

The [protected QuickBooks token-revocation procedure](docs/QUICKBOOKS-REVOCATION.md) provides explicit one-shot requests, local disable before transport and retained operator review after crashes. It is default-disabled and locally tested with synthetic responses only. Existing regional stores require a reviewed current-version fresh-file upgrade; no provider request or product acceptance is claimed.

Reserved warranty replacements now use [reviewed carrier booking and private labels](docs/WARRANTY.md#review-a-replacement-carrier-booking), followed by separate exact scanned dispatch. This preserves original invoices and coverage; actual providers and product gates remain unqualified.
