# Local partial transfer engineering receipt

Scope: D-015/CH-03 partial implementation, with related D-008/D-009 site/transaction/retry checks. All tasks and product gates remain NOT VERIFIED. The full-system goal remains active. This is automated synthetic engineering evidence, not human warehouse acceptance.

Candidate: local uncommitted source, no Git HEAD. The [machine receipt](LOCAL-PARTIAL-TRANSFERS-2026-09-30.json) records exact source/configuration/document SHA-256 hashes, environment and check outcomes. Earlier receipts remain historical and unchanged. macOS arm64, Node 24.16.0/npm 11.13.0, native SQLite and local Chromium; all databases and accounts are disposable synthetic fixtures.

## Observed behavior

Transfers retain an immutable dispatch manifest and append quantity/condition/bin/evidence arrival receipts. Bulk partial arrivals split destination lots without changing unit cost. Damaged and quarantined arrivals remain unavailable; missing quantities remain in transit. Serialized receiving requires the exact dispatched serial and one whole unit. Current destination grants are checked even on cached retries. A distinct request key or currently authorized receiver repeating the same portion reference/details receives the original result; conflicting reference reuse rejects without mutation. Dispatch retry authorization follows the immutable original source after arrival rather than the serial's new warehouse.

Local close/reopen preserves partial custody and receipt identity. A legacy fixture with only original tables reconstructs dispatched quantities from movement evidence, preserves old whole-receipt flags and labels missing portion evidence instead of inventing it. Historical quantities remain stable when arrived stock is dispatched onward.

Two real child processes share SQLite and a readiness barrier, then request the final two-unit portion with different references. Exactly one commits; the second rejects STATE. One receipt and exactly two destination units remain. HTTP tests reject omitted/extra fields and the wrong serial, and revoke destination access before replaying a committed receipt. Source users can read organization warehouse names/IDs for dispatch while destination stock stays inaccessible. Stale source counts reject REVISION; counting transit custody rejects STATE.

## Independent fixture reconciliation

The bulk fixture starts with six units costing 1,000 cents each (6,000 total). Dispatching four leaves two source units and four unavailable transit units. Receiving two usable units leaves two transit units; receiving one damaged and one quarantined completes the transfer. Final custody is source usable two, destination usable two, damaged one and quarantine one: six units and 6,000 cents, four saleable units. Transfers create no invoice. The existing three-serial fixture costs another 18,000 cents independently and is not included in this bulk oracle. The two-process fixture starts with two bulk units/2,000 cents and ends with exactly those two units/2,000 cents at the destination.

Four Chromium journeys pass. New transfer journeys dispatch four bulk units, discard a committed receipt response, retry once and finish separate usable/damaged/quarantine portions with exactly three arrival records; then two site-limited synthetic users dispatch/receive S3, reject S2 and verify site-scoped stock. Existing ordering/residency/payment/return/mobile and split-packing journeys remain covered. Sign-out resets the page, dialogs, supplemental data and notices before another operator signs in.

## Actual checks

| Command | Observed outcome |
| --- | --- |
| `npm run typecheck` | Exit 0. |
| `npm test` | Exit 0; 31 passed, zero failed/skipped. |
| `npm run test:e2e` | Exit 0; production build and four Chromium journeys passed on the final code candidate. |
| `npm run format:check` | Exit 0. |
| `npm run verify:plan` | Final structural outcome recorded in the machine receipt after documentation additions. |

Repository access was rechecked under SJS1001: public/active, pull/push/admin/maintain/triage permissions, Actions enabled, all actions allowed, SHA pinning not required and zero workflows. Successful `git ls-remote origin` returned no refs. This confirms access, not hosted runner execution, capacity or costs. GitHub-hosted runners remain the Distributor-specific policy; future PR/merge requires verified sjsmithbot identity. No remote mutation occurred.

## Preserved failures and limits

The initial form patch placed a quantity maximum in cancellation (TS2304); moved it to dispatch. Inferred generic row spreads omitted concrete transfer properties (TS2339); explicit transfer/manifest types corrected that. Both subsequently passed typecheck/tests. The four-journey run initially failed its destination-login Overview expectation because sign-out retained Inventory; sign-out now resets operator presentation and data. The synthetic warehouse-user fixture used null for an optional string account ID (TS2322); omitted that field and reran successfully. Earlier successful three-journey runs preceded the destination-list/sign-out changes and are superseded for this candidate.

Close/reopen is not a kill-during-commit or restore rehearsal. Legacy reconstruction is additive local migration evidence, not a production migration system. Transit shortages/loss reconciliation, supplier returns, broader concurrent-count/adjustment approval rules, real operator evidence, query/load scale, OAuth/secret lifecycle, provider refunds/accounting, documents, carrier/device qualification, imports/recovery, user lifecycle/security and approved operating policies remain outstanding. No provider request, actual device, live data, account purchase, deployment, publication, PR, workflow or repository setting change occurred. Product gates remain NOT VERIFIED.
