# Distributor planning instructions

Read README.md, docs/PLAN.md, docs/DECISIONS.md and docs/HANDOFF.md before nontrivial work.

## Current scope

The owner completed planning authorization and subsequently authorized building the full Distributor system on 2026-09-30. Implementation may proceed while unresolved operating policies remain explicit and configurable. This does not mark G0 or any product gate verified, and does not authorize purchases, deployments, provider accounts, live data ingestion, source publication or integration with OPUS/Project UB. Targets are US and Canada with data residency, Stripe and QuickBooks; customer choice of named provider residency exceptions is approved direction. Specific carrier/hardware selections, vendor terms and actual infrastructure residency remain to be qualified.

Use docs/TASKS.md for task IDs and docs/CHECKPOINTS.md for verification. Never infer a passed gate from a document, mock, feature name, historical test or an open PR. Evidence must identify the tested version, environment, actual outcome and unresolved limitations. Keep historical failures and superseded receipts.

Preserve other work. This repository must remain independent of OPUS and UB databases, credentials, runtime imports and startup. Do not copy private code or sensitive planning/customer data to the public remote without confirming rights and publication scope. Review actual file/dependency licenses before code reuse; refactoring does not remove license obligations.

Proposed architecture: one modular application initially; each module owns its data and exposes task-shaped operations. No direct foreign-table writes or generic CRUD proxies. Any optional bus must be removable without interrupting native ordering, inventory or billing.

## Later CI and PR work

Current owner instruction: commit locally only. Do not push, create PRs or start local/self-hosted or cloud CI runner jobs for this work. Direct workstation verification commands are permitted. The future runner choice below does not authorize starting CI now.

Use GitHub-hosted runners for Distributor, per the owner's explicit instruction on 2026-09-30. This repository-specific decision supersedes the general self-hosted runner policy for Distributor only. Do not use local/self-hosted runners, Depot or inherited OPUS labels. Before the first workflow, verify Distributor's current Actions permissions, selected hosted runner OS/capabilities, usage/cost limits and workflow security. No workflow or runner registration is created by this plan.

Use `codex/` branch names for future work unless the owner specifies otherwise. Open or merge PRs only under verified `sjsmithbot` identity; preserve branch protection and check the target repository's own current policies. No push or PR is needed for this local planning deliverable.

When delegated work is explicitly authorized, read the owner's canonical delegated model selection rule before launching it. Record responsibilities and preserve concurrent edits. This file does not itself request delegation or background automation.
