# Local order quantity amendments — 2026-10-01

Status: **PASS for bounded synthetic workstation checks**. Partial D-019/D-020/D-021 engineering relevant to G3 and CH-04/07/08. All 44 tasks and 10 product gates remain NOT VERIFIED; the full system is incomplete. Reviewer: parent Codex integration review plus an independent GPT-6 Astra / High local worker, without customer, warehouse or finance sign-off.

Parent commit `6acfd9566439d5d7ba30a733daad07f804823959`; branch `codex/local-distributor-checkpoint`. The [machine companion](LOCAL-ORDER-AMENDMENTS-2026-10-01.json) binds candidate files, documentation, available local logs/worker events/copied failed traces and byte-identical historical evidence. Its own bytes are excluded from circular hashing; the subsequent actual local commit identifies delivery. See the [runbook](../ORDER-AMENDMENTS.md).

## Behavior and independent oracles

Current authorized commercial/buyer/admin users amend an existing open order line at its current revision. Accepted price, tax, description, warehouse and currency remain locked; the original quote, invoices and cash remain intact. Increasing quantity checks active product, current customer hold, credit and explicit additional backorder choice. Decreasing quantity removes backorder before unpicked reservations, and cannot remove shipped/canceled units. Amended order totals, credit exposure, allocation changes, immutable history, event, audit and exact command receipt commit together. Fresh actual user/organization/password/account/site grants precede history and cached retries.

A three-unit synthetic order uses 10,000-cent unit price plus 1,300-cent tax. Reducing it to one unit releases two unpicked units, preserves the picked/packed unit, leaves 11,300-cent exposure and later produces one 11,300-cent invoice with the retained serial sold. Both allocation insertion orders and cancellation use this oracle. Picked shortage rejects before any eligible stock release. Other tests reconcile price/tax changes, partial shipment/cancellation floors, failed stock/credit/late-audit rollback, scoped history and restart. Two OS-process races exercise conflicting revisions and identical command retries; this adds no new process-kill or production timing proof.

Phone Chromium checks lost committed mutation response and exact retry, accepted money, personal buyer reduction, first/continuation history failures, preserved pages, focus restoration and actual aborted navigation reads. History has 20-row pages and displays the accepted line description. These synthetic reads do not qualify database working memory, production load or retention.

## Actual verification

- Full backend: **466/466 PASS**, zero failures/cancelled/skipped/todo, 24,228.236791 ms, exit 0.
- Full Chromium: **38/38 PASS**, reported 1.3 minutes, exit 0. Production build passed in 140 ms.
- Typecheck and complete source/test/configuration formatting: PASS, exit 0.
- Worker focused backend: 19/19; parent reservation regressions: 5/5; worker focused Chromium: 1/1. Narrow worker checks precede parent integration; full checks above cover the final candidate.
- Planning structure, whitespace, exact hash and historical evidence review follow document creation and are recorded in the companion. No source/test/configuration edits follow the final passing checks.

Three concurrent local coding/review sessions were runtime-verified: GPT-6.1 Sol / Medium for UI and tests, GPT-6 Astra / High for independent review. Parent active runtime is GPT-6.1 Sol / High. All sessions completed. No cloud repository checkout, CI runner job, push/PR, live provider request, deployment, purchase, real customer data or OPUS/UB integration occurred. Future Distributor CI remains GitHub-hosted after separate authorization and qualification.

## Preserved failures and corrections

The independent reviewer reproduced an inherited reservation selection defect: an earlier picked allocation blocked release of enough later unpicked stock. Parent corrected Inventory's owning release API to select sufficient unpicked reservations before writes; both insertion orders are checked. Parent normalized zero allocation delta so immediate and durable retry results agree.

Initial worker backend run passed 14/18; fixture expectations for closed-state naming, released allocations and negative-zero equality failed. Worker corrected the fixtures; parent corrected negative-zero output. Initial browser invocation lacked npm's subprocess PATH, followed by two selector mistakes (SKU versus name; account also present in saved-cart rows). Corrected focused/full runs passed. Two failed browser traces were copied outside disposable test-results. Review's first cookie harness incorrectly treated a string header as an array; corrected targeted HTTP checks passed. Raw failures and corrected worker outputs remain in the local worker event log. Earlier historical receipts remain unchanged.

## Limits and reproduction

Accepted-price reuse for added units remains provisional commercial policy. Reservation expiry, order-wide approval, substitution/repricing/warehouse reassignment and customer notification are incomplete. Actual devices/carriers/Stripe/QuickBooks, customer authority, infrastructure residency and production security/load/retention/upgrade/recovery/human acceptance remain unqualified. Stop old writers before upgrade; mixed versions are unqualified. Dependency versions/lockfile/license notices are unchanged; no third-party implementation was copied.

Reproduce with `node --import tsx --test tests/order-amendments.test.ts tests/amendment-reservations.test.ts`, `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run format:check`, `npm run verify:plan` and `git diff --check`. Backend uses disposable synthetic SQLite and browser uses loopback headless Chromium, not GitHub Actions. Passing these checks does not verify G3 or another product gate.
