# Local unpaid-document import and folder review receipt

Local date 2026-09-30; reviewer: Codex automated review. This records the existing local implementation checkpoint for D-022/D-034/D-035 and the latest planning/access review. All 44 tasks and 10 product gates remain NOT VERIFIED. The [machine receipt](LOCAL-DOCUMENT-IMPORTS-2026-09-30.json) binds the uncommitted files, final structural check, environment, failures and preserved historical evidence. There is no Git HEAD or human operator acceptance.

## Reviewed behavior

Migration owns immutable unpaid-document manifests, raw-row reviews, independent controls, administrator decisions and source mappings. Billing owns original invoice/line values and historical credit/payment/refund baselines. The administrator interface exposes raw rows, original numbers, customer mappings, independent financial controls, issues, fingerprint and permanent results. Existing master/provider choices stay separate. See the [import runbook](../IMPORTS.md).

Approval reassesses current masters, document numbers and source mappings within the same transaction as invoices, baselines, mappings, events and audit/command receipts. Any rejected row or mismatched control blocks the whole batch. Changed evidence requires a new review; rejected evidence remains retained. Permanent identical decisions replay across request keys/restart after current role/organization checks. Late mapping failure rolls everything back. Application creates no stock/order/shipment, historical cash identity or provider posting. Opening invoice API links to order/shipment are null. New QuickBooks posting is blocked pending source accounting identity reconciliation.

Current balances include historical and later native entries. Historical credited quantities constrain further credits; imported outstanding participates in credit exposure; native invoice numbering skips original numbers. New manual cash has separate evidence and cannot exceed current outstanding. Historical cash is not an actual refundable payment identity. CSV exposes current refunds and opening source/cutoff provenance. The current print view displays historical provenance, but document delivery/PDF qualification remains pending.

## Checks and independent expectations

- `npm run typecheck`: final PASS, exit 0.
- `npx tsx --test tests/document-imports.test.ts`: previously completed PASS, 10 tests, zero failures/skips, 999.980958 ms; preserved intermediate failures below.
- `npm test`: fresh PASS, 79 tests, zero failures/skips, 1538.187125 ms.
- `npm run test:e2e`: fresh PASS, production build (52 ms) and 10 Chromium journeys (13.8 seconds).
- `npm run format:check`: PASS. `python3 scripts/verify_plan.py --json`: final result in the machine receipt; validates structure/links, never business or product acceptance.

Two independent synthetic CAD invoices carry original net 34,000 and tax 4,100 cents, gross 38,100, historical credits 11,300, payments 12,000 and refunds 2,000. Outstanding is 16,800, across 14,600 and 2,200 invoices. Applying them leaves native payments/credits/refunds, stock, orders, shipments and provider effects unchanged. Further 1,000-cent cash on the second invoice yields paid 3,000 and balance 1,200 after restart. The first invoice's original three units include one historical credited unit; another three-unit credit is denied and two units can be credited. Historical and native quantity limits are visible in the billing interface.

Tests independently cover invalid/extra fields, each control mismatch, dates, original amounts, duplicate/reused identities, conflicting original numbers, current grants/organization/fingerprint, changed masters, separate US/USD imports, credit exposure, numbering and the opening accounting guard. Real child processes applying overlapping reviews yield one winner and one stale review; identical winning decisions replay the same mappings. A trigger aborting the second source mapping after invoice creation leaves invoices/lines/baselines/mappings/audits/events and command receipts unchanged; removing it permits one successful retry. This is transactional fault injection, not a disk/crash qualification.

Encrypted populated-document recovery preserves two original documents, historical baselines, permanent mappings/decisions and the snapshot's later 1,000-cent cash. It excludes cash written after backup; outstanding is 15,800. The recovery provider hold remains active. HTTP tests cover exact envelopes, raw rejected rows, origin/CSRF and revoked authority before cached approval responses.

The new browser journey starts with one 22,600-cent original invoice, credit 11,300, paid 4,000, refund 1,000 and balance 8,300. A supplied 8,301 control blocks approval and is retained as rejected evidence. The corrected review loses its committed approval response, then retries to one document/mapping. No stock/orders/shipments/provider effects change. Remaining credit quantity is one; two is denied. New cash 1,000 yields paid 5,000 and balance 7,300; the CSV retains original source/cutoff and current balance. Warehouse review access is denied. Automated users do not supply customer/finance/operator acceptance.

## Preserved failures and limits

Earlier implementation corrections included uninitialized `opening` and an enriched invoice type incorrectly used as a SQL row. Initial document-test typecheck referenced absent public `billing.payments`/`integration.effects` methods and an insufficiently typed table owner; the first targeted runtime run passed seven and failed three (836.185917 ms), also referencing nonexistent `iam_customers`. Correcting fixture queries to owned tables/`iam_accounts` and `integration.list` yielded all ten passes. Line enrichment initially lost typed invoice-line properties through a generic row spread; an explicit `InvoiceLineRow` fixed typecheck. An intermediate full run had 79 runtime passes (1707.810416 ms) while that typecheck failed. Final typecheck passes separately.

The first browser run passed nine and failed one (14.4 seconds): its CSV expectation omitted quotes around fields. Actual CSV included the correct quoted provenance and financial values. Correcting the two test assertions produced ten passes; no CSV application change was needed. Existing historical receipts remain unchanged.

Limits include bounded same-currency JSON entry, 1–500 invoices, distinct product lines, whole-unit credits, positive unpaid balances, latest-50 review display and provisional administrator self-review. Closed/negative documents, opening credits/general ledger, fractional/discount/rounding formats, source accounting identities, real source rights/freeze/completeness, independent approval duties, financial/tax policies, full legacy purchase reconciliation, production upgrades/load/fault/recovery/cutover and human acceptance remain unqualified. Imported values are not source certification. The full system remains under construction.

## Planning choices and repository access

The planning draft records US/Canada, USD/CAD, Stripe, QuickBooks, major carrier/device candidates and separately named customer residency exceptions. Strict defaults and versioned acceptance/withdrawal are distinct from actual application/backup/log/provider residency. Actual infrastructure/vendor terms, accounting edition, carrier/device models and operating policies still need qualification. The planning package is complete as a reviewable draft; no gate approval is inferred.

Fresh authenticated read-only checks returned SJS1001, public active SJS1001/Distributor, default main, and pull/push/admin/maintain/triage permissions. Actions is enabled/all allowed/no required SHA pinning; workflow count is zero. Origin matches the requested GitHub repository and `git ls-remote origin` succeeded with zero refs. Future `sjsmithbot` PR identity remains unverified.

Distributor uses GitHub-hosted runners under its explicit repository exception. Hosted OS/capability, usage/cost and workflow security qualification precede the first workflow. Local test evidence is not hosted execution evidence. No workflow, runner registration, settings change, remote mutation, push/PR, publication, actual provider request/account, live data, deployment or OPUS/UB integration occurred. Files remain local and uncommitted.
