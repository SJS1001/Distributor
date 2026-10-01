# Local bulk cycle count engineering receipt

Local date 2026-09-30; reviewer: Codex automated engineering checks. Status: PASS for the bounded checks below; every product task/gate remains NOT VERIFIED. Full-system implementation is incomplete and the goal remains active. The [machine receipt](LOCAL-CYCLE-COUNTS-2026-09-30.json) identifies the exact uncommitted content and environment; no Git HEAD exists.

## Scope and behavior

D-015 / CH-03, with D-008/D-009 authority/transaction boundaries and D-016 allocation contention. Inventory owns count snapshots, immutable observations and administrator decisions. Opening records physical quantity/revision, original cost, condition/bin/site, actor/time and an organization-unique count reference. Observation changes no physical quantity. Approval checks the frozen revision and current reservations, then commits one signed stock movement and durable result. Rejection changes no physical stock. Serialized and transit stock require other custody workflows.

Warehouse operators can open/observe counts at granted sites; administrators review them. Direct quantity adjustment is now administrator-only. An administrator may observe and review the same count under this provisional policy. Neither correction path posts an accounting entry or invoice. Snapshots do not freeze stock or reservations. Stale observations cannot overwrite changed physical stock; reject and open a fresh count. Current grants at the original count site control historical opening/observation replay even after the lot moves elsewhere.

The staff interface opens counts, records quantities/reasons, displays expected/observed quantities and signed value differences, and offers administrator approval/rejection. It retains observation/review history across reload and gives a corrective error for stale approval.

## Reproduction and outcomes

- `npm run typecheck`: PASS, exit 0.
- `npm test`: PASS, exit 0; 41 tests, zero failed/skipped. Five count tests cover domain/restart/scope and real process contention; one added HTTP test covers request schemas, current role/site changes and review restrictions.
- `npm run test:e2e`: PASS, exit 0; production build and six local Chromium journeys, 9.2 seconds. The added journey observes as a site-limited warehouse user, reloads, reviews as an administrator, discards a committed approval response and retries, then rejects an observation made stale by inspection. The five prior journeys also pass.
- `npm run format:check`: PASS, exit 0.
- `python3 scripts/verify_plan.py`: final structural/link result recorded in the machine receipt; no product acceptance implied.

## Independent quantities and contention

Domain opening stock is six units at 1,000 cents each, 6,000 cents. It is quarantined before counting. Observation of eight leaves physical stock at six until approval; approval adds two units/2,000 cents. After close/reopen, another administrator/request key returns the same receipt with one movement. A later approved observation of five removes three units/3,000 cents. Final stock is five units/5,000 cents: opening plus signed count movements equals final quantity/value. Original condition remains quarantine and availability remains zero; no invoice exists. Wrong role/site/organization, conflicting references/observations/decisions and unobserved approval reject.

An inspection after the cutoff makes approval stale and leaves its submitted evidence intact. Rejection records a null adjustment and leaves quantity unchanged. Another observation below two currently reserved units rejects with ALLOCATION. Serialized and in-transit openings reject. A rejected unobserved draft cannot acquire a later observation.

Two real child processes initialize separate connections before a shared release barrier. Count-to-zero competes with allocation of all six units or dispatch of all six: exactly one commits. If count wins, physical quantity/value are zero and one count movement exists; allocation/dispatch reject. If allocation wins, six units/6,000 cents remain with six reserved and count rejects. If dispatch wins, six units/6,000 cents remain in transit and count rejects stale revision. Two identical approvals under separate keys both return one result and create one movement. Two different pending counts at the same physical revision allow one approval; the other rejects REVISION. The winner is deliberately unspecified. Signed movements reconcile each final quantity/value to the six-unit/6,000-cent opening.

A no-change approved count followed by a whole-lot transfer retains its original warehouse snapshot. Original-site opening/observation retries work under original authority; a grant switched to the destination cannot read/replay the old count. HTTP tests similarly revoke current administrator/site privileges and deny cached results. Exact request schemas reject caller-supplied approver/cost/observer fields.

Browser stock starts at six/6,000 cents. The committed approval reduces it to five/5,000 cents despite the lost HTTP response and retry. Inspection quarantines that stock, invalidating a later observed-four count. Rejection leaves five units/5,000 cents, zero availability and a null adjustment for the rejected record. Automated users are not human operator acceptance.

## Preserved failure

An intermediate typecheck failed TS2322 and related TS2339 overload inference because the HTTP test helper accepted unknown payloads rather than Fastify-compatible objects. Changed its annotation to `Record<string, unknown>`; subsequent typecheck passed. Earlier receipt failures/hashes remain unchanged. A close/reopen check is not an abrupt crash or backup/restore rehearsal.

## Limits

Count authority, cutoff/reconciliation procedure, separation of duties, direct administrator correction and financial treatment require responsible business review. Large count batches, serialized discrepancies, supplier returns/import valuation, upgrade/fault/restore/load proof, OAuth/secrets/refunds/accounting handoff, document/device and security lifecycle work remain. No provider/device, human operator, production residency or deployment is qualified.

All work is local/uncommitted. No push, PR, publication, workflow, runner registration, repository setting change, account purchase, live-data ingestion, actual provider request or OPUS/UB integration occurred. Distributor CI must use GitHub-hosted runners. Every task/product gate remains NOT VERIFIED.
