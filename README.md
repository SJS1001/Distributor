# Distributor

Independent distributor application and planning workspace for multiple warehouses. Repository: [SJS1001/Distributor](https://github.com/SJS1001/Distributor).

**Status: implementation in progress, 30 September 2026.** The owner authorized the full system after completing the planning package. See [implementation status](docs/IMPLEMENTATION.md) for actual code, commands and remaining qualification. The remote was empty and public when inspected; local files have not been pushed.

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
| [Stock cost accounting handoffs](docs/ACCOUNTING-COSTS.md) | Reviewed original-cost journals, regional files and receiver evidence |
| [Scanning and saved receipt drafts](docs/SCANNING.md) | Camera/manual input, saved evidence and explicit stock confirmation |
| [Fulfillment, delivery and short picks](docs/FULFILLMENT.md) | Packed commitments, delivery history, shortage holds, backorders and separate count review |
| [Warranty and replacements](docs/WARRANTY.md) | Native returns, replacement collection/dispatch, manufacturer evidence and remaining qualification |
| [User access](docs/USER-ACCESS.md) | Staff/buyer grants, password changes, resets, optional MFA and session revocation |
| [Local event reporting](docs/EVENTS.md) | Bounded optional report processing, scoped diagnostics and reviewed failure recovery |
| [Providers, residency and devices](docs/PROVIDERS.md) | Customer choice, major-provider candidates and local provider operations |
| [Evidence instructions](docs/evidence/README.md) | Receipt template for future verification |
| [Handoff](docs/HANDOFF.md) | Historical setup and current implementation continuation |

All product checkpoints are **NOT VERIFIED**. Documentation is not evidence that a business workflow works. Implementation authorization permits engineering work; outstanding discovery decisions still require owner/operator evidence.

Future GitHub Actions workflows will use **GitHub-hosted runners**, as instructed by the owner on 2026-09-30. The repository has no workflows yet; see [the CI decision](docs/DECISIONS.md#ci-runner-decision).

Current work uses direct workstation checks and local commits only, per the owner's instruction. No pushes, PRs or local/cloud CI runner jobs are authorized for this checkpoint.

No product license has been selected. A public repository is not by itself permission to republish OPUS, UB, customer information or third-party code.

The planning package is complete as a reviewable draft. Owner/operator answers and G0 approval remain pending. Validate its links, task/gate dependencies, effort and traceability locally with `python3 scripts/verify_plan.py`; the [historical planning review receipt](docs/evidence/PLANNING-REVIEW-2026-09-30.md) records the content checked before implementation and its limits.

The [latest planning choices/access review](docs/evidence/PLANNING-CHOICES-2026-09-30.md) records customer residency acceptance criteria and fresh read-only GitHub access. Historical implementation receipts remain separate from planning acceptance.
