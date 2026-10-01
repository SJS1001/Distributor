# Local transfer loss/recovery engineering receipt

Local date 2026-09-30; reviewer: Codex automated engineering checks. Status: PASS for the bounded checks below; all product tasks/gates remain NOT VERIFIED. Full-system implementation is incomplete and the goal remains active. Exact content identification and environment are in the [machine receipt](LOCAL-TRANSFER-RECONCILIATION-2026-09-30.json). There is no Git HEAD or committed version.

## Scope and actual behavior

D-015 / CH-03, with D-008/D-009 authorization/ownership checks. Inventory now owns durable approved loss and recovery records. An administrator can approve an evidence-backed missing portion only at its current transit revision, matching the dispatch serial and outstanding quantity. Arrival can still receive the unlost remainder. Found goods are received against a specific approved loss into the original destination, with exact serial/quantity/evidence/condition checks and original unit cost. Serialized recovery preserves identity; bulk recovery creates a separate destination lot. The UI defaults found goods to quarantine and keeps loss/recovery history visible.

Neither loss nor recovery creates an invoice, accounting expense, carrier claim or provider request. Existing zero-quantity transit records retain history after full loss; they have no availability/value. The persisted line completion flag means no unresolved transit, while explicit loss records distinguish reconciliation from a physical receipt. The UI derives partially-reconciled/reconciled-with-loss status and retains losses after goods are found.

## Reproduction and observed outcomes

- `npm run typecheck`: PASS, exit 0.
- `npm test`: PASS, exit 0, 35 tests, zero failures/skips. Includes three new domain/process loss tests and one new HTTP test.
- `npm run test:e2e`: PASS, exit 0, production build plus five local Chromium journeys, 8.2 seconds. New journey approves two missing units, discards the committed HTTP response, retries once without duplicating loss, receives the one unlost unit, then recovers one quarantined and one damaged portion. Prior transfer, site-limited serial, ordering/return/mobile and partial packing journeys also pass.
- `npm run format:check`: PASS, exit 0.
- `python3 scripts/verify_plan.py`: final result recorded in the machine receipt; documentation structure only.

## Independent fixture reconciliation

Domain fixture starts with six bulk units costing 1,000 cents each (6,000 cents). Four are dispatched; two remain at source. Approval loses two of the dispatched units. Recovering one to quarantine does not change the other two still in transit. Ordinary arrival receives those two usable units. At that point: source two + destination two usable + destination one quarantine = five physical units, 5,000 cents; unrecovered loss one = 1,000 cents. Physical value plus unrecovered loss is 6,000 cents. Received three + transit zero + net loss one = dispatched four. Recovering the last missing unit as damaged restores six physical units/6,000 cents; loss evidence remains gross two, recovered two. Available quantity stays source two/destination two; quarantine/damage is excluded. Transfer invoices remain zero.

Serialized fixture loses S3, reducing its quantity to zero, and recovers the same stock ID at its original 6,000-cent cost into destination quarantine. Trace preserves dispatch, loss and recovery movements. Wrong serial, over-loss, over-recovery, stale revision, foreign organization, unsupported role and conflicting business-reference reuse reject without inventing custody. New request keys/administrators return the original authorized receipt; revoked administrator authority rejects cached approvals/recoveries.

Two real child processes race an ordinary arrival against loss approval for the same final two transit units. Exactly one operation commits, with one resolution ledger and zero remaining transit. Which operation wins is intentionally unspecified. Another two-process race processes the same missing serialized unit as two different recovery references: exactly one commits, the other fails quantity validation. Restart/reopen retains receipts, costs and remaining quantities; this is not abrupt crash or backup/restore proof.

Browser fixture starts with four bulk units/4,000 cents, dispatches three, loses two, receives one and recovers two into quarantine/damaged lots. Final physical quantity/value is four/4,000 cents; available is two. One loss, one ordinary arrival and two recovery receipts remain. Synthetic browser users do not provide human operator acceptance.

## Preserved failure and correction

The first typecheck failed TS2339 because a generic SQL-row spread did not retain the loss quantity in its inferred type. Added explicit selected loss-row fields; typecheck, focused checks and full Node/browser checks subsequently passed. Prior engineering failures and historical content hashes remain in their original receipts.

## Limits and next work

Administrator-only approval is provisional engineering policy. Responsible operator/finance review, configurable separation of duties, approved loss/recovery financial treatment and carrier claims remain outstanding. No actual provider, physical device, production residency, human acceptance or deployment was qualified. Production upgrade, abrupt fault/restore, scale/security review, count operator flow, broader count concurrency, supplier returns, imports, OAuth/refunds/accounting delivery and remaining product workflows still require work. The full requirements/gates retain their original scope.

All changes remain local and uncommitted. No publication, push, PR, workflow, runner registration, repository settings change, account purchase, live-data ingestion, provider activation or OPUS/UB integration occurred. Future Distributor CI must use GitHub-hosted runners.
